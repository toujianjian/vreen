// WaterSurfacePass — 屏幕空间平面水面渲染 Pass。
//
// 设计目标:
//   - 在不渲染水面几何的情况下,基于 GBuffer 深度 + 相机射线,直接在屏幕空间
//     重建水面交点,绘制带波浪的平面水面(海洋/湖泊/池塘通用)。
//   - 4 组方向 Gerstner 波叠加产生真实波浪位移,有限差分计算法线。
//   - Schlick Fresnel 近似决定反射/折射混合比例,模拟掠射角全反射。
//   - 折射采样场景色(带法线偏移)+ Beer-Lambert 水深吸收着色。
//   - 反射采样天空渐变(天顶/地平线双色),Blint-Phong 太阳镜面高光。
//   - 几何遮挡:若几何在水面之前(sceneDist < tHit),不画水。
//   - 独立管理 FBO + 程序,不继承 RenderPass(需要 depth + camera)。
//
// 算法(参考 GPU Gems 1 Ch.9 + o3de Atom Water):
//   1. 从 depth 纹理重建场景世界位置 + 距离;
//   2. 用远裁面 NDC 重建相机射线方向(处理天空像素);
//   3. 射线-平面求交:y = waterLevel,得到 tHit;
//   4. 几何遮挡剔除:depth < 1.0 且 sceneDist < tHit → 跳过;
//   5. 水面交点 + Gerstner 波高微扰 → 计算法线(中心差分);
//   6. Schlick Fresnel → 反射/折射混合因子;
//   7. 反射:沿反射方向采样天空渐变;
//   8. 折射:偏移 UV 采样场景色 + 水深吸收;
//   9. 太阳 Blinn-Phong 镜面高光;
//  10. 合成:waterColor = mix(refraction, reflection, fresnel) + specular。
//
// 参考:
//   - GPU Gems 1, Ch. 9 "Effective Water Simulation from Physical Models"
//   - o3de Atom Water surface pass
//   - Schlick (1994) Fresnel approximation
//   - Finch (2004) "Effective Water Simulation from Physical Models"

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, WATER_SURFACE_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('WaterSurfacePass');

export interface WaterSurfaceOptions {
  /** 水面高度(世界 Y,默认 0)。射线与 y=waterLevel 平面求交。 */
  waterLevel?: number;
  /** 深水吸收色 RGB(默认 0.02, 0.1, 0.2 = 深蓝)。水下几何被此色染色。 */
  waterColor?: [number, number, number];
  /** 天顶反射色(默认 0.4, 0.6, 0.9 = 浅蓝)。 */
  skyColor?: [number, number, number];
  /** 地平线反射色(默认 0.7, 0.75, 0.8 = 灰蓝)。 */
  horizonColor?: [number, number, number];
  /** 太阳方向(归一化,指向太阳,默认 (0.5, 0.5, -0.3))。 */
  sunDirection?: [number, number, number];
  /** 太阳颜色(默认 1.0, 0.95, 0.8 = 暖白)。 */
  sunColor?: [number, number, number];
  /** 太阳镜面强度(默认 1.0)。 */
  sunSpecular?: number;
  /** Blinn-Phong shininess(默认 200.0,越大高光越锐利)。 */
  sunShininess?: number;
  /** 波幅(默认 0.3)。Gerstner 波垂直位移幅度。 */
  waveAmplitude?: number;
  /** 波频率(默认 0.1)。值越大波纹越密。 */
  waveFrequency?: number;
  /** 波速(默认 1.0)。 */
  waveSpeed?: number;
  /** Fresnel 幂(默认 5.0)。越大掠射角反射越强。 */
  fresnelPower?: number;
  /** Fresnel 偏移(默认 0.02)。垂直入射时的最小反射率。 */
  fresnelBias?: number;
  /** 折射 UV 偏移强度(默认 0.01)。法线对折射采样的偏移。 */
  refractionOffset?: number;
  /** 水深吸收率(默认 0.05)。越深水下颜色越深。 */
  absorption?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 屏幕空间平面水面 Pass。独立管理内部 FBO 与程序。
 *
 * apply() 接收颜色纹理 + 深度纹理 + 相机,输出合成水面后的颜色纹理。
 * 调用者每帧更新 `time` 字段驱动波浪动画。
 *
 * @example
 * ```ts
 * const water = new WaterSurfacePass({ waterLevel: 0, waveAmplitude: 0.4 });
 * pipeline.addGBufferPass(water);
 * // 每帧:
 * water.time = elapsedTime;
 * const out = water.apply(gl, colorTex, depthTex, camera);
 * ```
 */
export class WaterSurfacePass {
  readonly name = 'watersurface';

  waterLevel: number;
  waterColor: [number, number, number];
  skyColor: [number, number, number];
  horizonColor: [number, number, number];
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  sunSpecular: number;
  sunShininess: number;
  waveAmplitude: number;
  waveFrequency: number;
  waveSpeed: number;
  fresnelPower: number;
  fresnelBias: number;
  refractionOffset: number;
  absorption: number;
  enabled: boolean;
  /** 动画时间(秒)。调用者每帧更新。 */
  time: number = 0;

  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: WaterSurfaceOptions = {}) {
    this.waterLevel = opts.waterLevel ?? 0;
    this.waterColor = opts.waterColor ?? [0.02, 0.1, 0.2];
    this.skyColor = opts.skyColor ?? [0.4, 0.6, 0.9];
    this.horizonColor = opts.horizonColor ?? [0.7, 0.75, 0.8];
    this.sunDirection = opts.sunDirection ?? [0.5, 0.5, -0.3];
    this.sunColor = opts.sunColor ?? [1.0, 0.95, 0.8];
    this.sunSpecular = opts.sunSpecular ?? 1.0;
    this.sunShininess = opts.sunShininess ?? 200.0;
    this.waveAmplitude = opts.waveAmplitude ?? 0.3;
    this.waveFrequency = opts.waveFrequency ?? 0.1;
    this.waveSpeed = opts.waveSpeed ?? 1.0;
    this.fresnelPower = opts.fresnelPower ?? 5.0;
    this.fresnelBias = opts.fresnelBias ?? 0.02;
    this.refractionOffset = opts.refractionOffset ?? 0.01;
    this.absorption = opts.absorption ?? 0.05;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 执行水面渲染后处理。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  当前帧颜色纹理(折射源 + 反射 fallback)
   * @param depthTexture  GBuffer 深度纹理(NDC 0..1)
   * @param camera        当前相机(读取 projection / view / position)
   * @returns             合成水面后的颜色纹理;若禁用则原样返回输入
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
    // 禁用 → 直接返回输入(零开销)
    if (!this.enabled) {
      return colorTexture;
    }

    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this._dirty || !this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    // 颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 深度纹理 → unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    // 相机参数
    prog.setUniformMatrix4fv('u_inverseViewProjection', this._computeInverseVP(camera));
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', w, h);

    // 水面参数
    prog.setUniform1f('u_waterLevel', this.waterLevel);
    prog.setUniform3f('u_waterColor', this.waterColor[0], this.waterColor[1], this.waterColor[2]);
    prog.setUniform3f('u_skyColor', this.skyColor[0], this.skyColor[1], this.skyColor[2]);
    prog.setUniform3f('u_horizonColor', this.horizonColor[0], this.horizonColor[1], this.horizonColor[2]);

    // 太阳参数
    const sd = this.sunDirection;
    const sc = this.sunColor;
    prog.setUniform3f('u_sunDirection', sd[0], sd[1], sd[2]);
    prog.setUniform3f('u_sunColor', sc[0], sc[1], sc[2]);
    prog.setUniform1f('u_sunSpecular', this.sunSpecular);
    prog.setUniform1f('u_sunShininess', this.sunShininess);

    // 波浪参数
    prog.setUniform1f('u_waveTime', this.time);
    prog.setUniform1f('u_waveAmplitude', this.waveAmplitude);
    prog.setUniform1f('u_waveFrequency', this.waveFrequency);
    prog.setUniform1f('u_waveSpeed', this.waveSpeed);

    // Fresnel / 折射 / 吸收
    prog.setUniform1f('u_fresnelPower', this.fresnelPower);
    prog.setUniform1f('u_fresnelBias', this.fresnelBias);
    prog.setUniform1f('u_refractionOffset', this.refractionOffset);
    prog.setUniform1f('u_absorption', this.absorption);

    prog.setUniform1i('u_enabled', this.enabled ? 1 : 0);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建(分辨率变更等)。 */
  setDirty(): void { this._dirty = true; }

  /** 释放 GPU 资源。可重复调用。 */
  dispose(gl?: WebGL2RenderingContext): void {
    // 与 CausticsPass 一致:优先用传入的 gl 删除,无 gl 则置空
    if (gl) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._program) this._program.dispose();
    }
    this._outputTexture = null;
    this._fbo = null;
    this._program = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 输出纹理(RGBA16F,水面合成可能产生 HDR 高光)
    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);

    // 全屏三角形 VAO(单个大三角形覆盖 [-1,1]²,与 CausticsPass 一致)
    this._fullscreenQuadBuf = gl.createBuffer();
    this._fullscreenQuadVao = gl.createVertexArray();
    gl.bindVertexArray(this._fullscreenQuadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
    const verts = new Float32Array([
      -1, -1,  3, -1,  -1, 3,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._width = w;
    this._height = h;
    this._initialized = true;
    log.info(`WaterSurface FBO created: ${w}x${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, WATER_SURFACE_FRAG);
    }
    return this._program;
  }

  private _computeInverseVP(camera: Camera): Float32Array {
    const proj = camera.projectionMatrix.elements;
    const view = camera.matrixWorldInverse.elements;
    // VP = proj × view (column-major 矩阵乘法)
    const vp = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += view[k * 4 + r] * proj[c * 4 + k];
        }
        vp[c * 4 + r] = sum;
      }
    }
    return invertMat4(vp);
  }
}

/** 通用 4×4 矩阵求逆(列主序)。 */
function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  const det = (
    m[0]  * (m[5]  * m[10] * m[15] - m[5]  * m[11] * m[14] - m[9]  * m[6]  * m[15] +
             m[9]  * m[7]  * m[14] + m[13] * m[6]  * m[11] - m[13] * m[7]  * m[10]) -
    m[1]  * (m[4]  * m[10] * m[15] - m[4]  * m[11] * m[14] - m[8]  * m[6]  * m[15] +
             m[8]  * m[7]  * m[14] + m[12] * m[6]  * m[11] - m[12] * m[7]  * m[10]) +
    m[2]  * (m[4]  * m[9]  * m[15] - m[4]  * m[11] * m[13] - m[8]  * m[5]  * m[15] +
             m[8]  * m[7]  * m[13] + m[12] * m[5]  * m[11] - m[12] * m[7]  * m[9]) -
    m[3]  * (m[4]  * m[9]  * m[14] - m[4]  * m[10] * m[13] - m[8]  * m[5]  * m[14] +
             m[8]  * m[6]  * m[13] + m[12] * m[5]  * m[10] - m[12] * m[6]  * m[9])
  );

  if (Math.abs(det) < 1e-10) {
    // 退化矩阵,返回 identity
    inv[0] = 1; inv[5] = 1; inv[10] = 1; inv[15] = 1;
    return inv;
  }

  const invDet = 1.0 / det;
  inv[0]  = ( m[5]  * m[10] * m[15] - m[5]  * m[11] * m[14] - m[9]  * m[6]  * m[15] + m[9]  * m[7]  * m[14] + m[13] * m[6]  * m[11] - m[13] * m[7]  * m[10]) * invDet;
  inv[1]  = (-m[1]  * m[10] * m[15] + m[1]  * m[11] * m[14] + m[9]  * m[2]  * m[15] - m[9]  * m[3]  * m[14] - m[13] * m[2]  * m[11] + m[13] * m[3]  * m[10]) * invDet;
  inv[2]  = ( m[1]  * m[6]  * m[15] - m[1]  * m[7]  * m[14] - m[5]  * m[2]  * m[15] + m[5]  * m[3]  * m[14] + m[13] * m[2]  * m[7]  - m[13] * m[3]  * m[6])  * invDet;
  inv[3]  = (-m[1]  * m[6]  * m[11] + m[1]  * m[7]  * m[10] + m[5]  * m[2]  * m[11] - m[5]  * m[3]  * m[10] - m[13] * m[2]  * m[7]  + m[13] * m[3]  * m[6])  * invDet;
  inv[4]  = (-m[4]  * m[10] * m[15] + m[4]  * m[11] * m[14] + m[8]  * m[6]  * m[15] - m[8]  * m[7]  * m[14] - m[12] * m[6]  * m[11] + m[12] * m[7]  * m[10]) * invDet;
  inv[5]  = ( m[0]  * m[10] * m[15] - m[0]  * m[11] * m[14] - m[8]  * m[2]  * m[15] + m[8]  * m[3]  * m[14] + m[12] * m[2]  * m[11] - m[12] * m[3]  * m[10]) * invDet;
  inv[6]  = (-m[0]  * m[6]  * m[15] + m[0]  * m[7]  * m[14] + m[4]  * m[2]  * m[15] - m[4]  * m[3]  * m[14] - m[12] * m[2]  * m[7]  + m[12] * m[3]  * m[6])  * invDet;
  inv[7]  = ( m[0]  * m[6]  * m[11] - m[0]  * m[7]  * m[10] - m[4]  * m[2]  * m[11] + m[4]  * m[3]  * m[10] + m[12] * m[2]  * m[7]  - m[12] * m[3]  * m[6])  * invDet;
  inv[8]  = ( m[4]  * m[9]  * m[15] - m[4]  * m[11] * m[13] - m[8]  * m[5]  * m[15] + m[8]  * m[7]  * m[13] + m[12] * m[5]  * m[11] - m[12] * m[7]  * m[9])  * invDet;
  inv[9]  = (-m[0]  * m[9]  * m[15] + m[0]  * m[11] * m[13] + m[8]  * m[1]  * m[15] - m[8]  * m[3]  * m[13] - m[12] * m[1]  * m[11] + m[12] * m[3]  * m[9])  * invDet;
  inv[10] = ( m[0]  * m[5]  * m[15] - m[0]  * m[7]  * m[13] - m[4]  * m[1]  * m[15] + m[4]  * m[3]  * m[13] + m[12] * m[1]  * m[7]  - m[12] * m[3]  * m[5])  * invDet;
  inv[11] = (-m[0]  * m[5]  * m[11] + m[0]  * m[7]  * m[9]  + m[4]  * m[1]  * m[11] - m[4]  * m[3]  * m[9]  - m[12] * m[1]  * m[7]  + m[12] * m[3]  * m[5])  * invDet;
  inv[12] = (-m[4]  * m[9]  * m[14] + m[4]  * m[10] * m[13] + m[8]  * m[5]  * m[14] - m[8]  * m[6]  * m[13] - m[12] * m[5]  * m[10] + m[12] * m[6]  * m[9])  * invDet;
  inv[13] = ( m[0]  * m[9]  * m[14] - m[0]  * m[10] * m[13] - m[8]  * m[1]  * m[14] + m[8]  * m[2]  * m[13] + m[12] * m[1]  * m[10] - m[12] * m[2]  * m[9])  * invDet;
  inv[14] = (-m[0]  * m[5]  * m[14] + m[0]  * m[6]  * m[13] + m[4]  * m[1]  * m[14] - m[4]  * m[2]  * m[13] - m[12] * m[1]  * m[6]  + m[12] * m[2]  * m[5])  * invDet;
  inv[15] = ( m[0]  * m[5]  * m[10] - m[0]  * m[6]  * m[9]  - m[4]  * m[1]  * m[10] + m[4]  * m[2]  * m[9]  + m[12] * m[1]  * m[6]  - m[12] * m[2]  * m[5])  * invDet;
  return inv;
}
