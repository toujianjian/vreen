// CausticsPass — 水下焦散后处理 Pass。
//
// 设计目标:
//   - 基于 GBuffer 深度纹理重建世界位置,在水面(waterLevel)以下的几何上
//     叠加程序化焦散光纹,模拟水面折射后的光能聚焦。
//   - 三组方向各异的正弦波叠加 + 幂增强产生锐利亮带(焦散特征)。
//   - 支持 RGB 色散偏移(波长差异折射)和深度衰减(Beer-Lambert)。
//   - 独立管理 FBO + 程序,不继承 RenderPass(需要 depth + camera)。
//
// 算法(参考 GPU Gems 2 Ch.18 "Effective Water Simulation" + o3de Atom Water):
//   1. 从 depth 纹理重建世界位置(逆 viewProjection);
//   2. worldPos.y > waterLevel 或 depth>=1.0(天空)→ 跳过;
//   3. depthAtten = 1 / (1 + depthBelow * absorption);
//   4. caustic = pow(max(0, (sin(三方向) 均值), power);
//   5. RGB 色散:每通道 UV 略偏移;
//   6. outColor = sceneColor + causticColor * caustic * intensity * depthAtten。
//
// 参考:
//   - GPU Gems 2, Ch. 18 "Effective Water Simulation from Physical Models"
//   - o3de Atom Water highlights / caustics pass
//   - ShaderToy "Caustic" by Dave_Hoskins

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, CAUSTICS_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('CausticsPass');

export interface CausticsOptions {
  /** 焦散颜色 RGB(默认 0.2, 0.7, 0.9 = 青蓝)。 */
  causticColor?: [number, number, number];
  /** 焦散强度(默认 0.6)。 */
  causticIntensity?: number;
  /** 水面高度(世界 Y,默认 0)。世界 Y 低于此值的区域应用焦散。 */
  waterLevel?: number;
  /** 世界→UV 缩放(默认 8)。值越大焦散纹路越密。 */
  worldScale?: number;
  /** 波纹动画速度(默认 0.8)。 */
  waveSpeed?: number;
  /** 波纹频率(默认 8)。 */
  waveFrequency?: number;
  /** 相位偏移(默认 0)。 */
  wavePhase?: number;
  /** 深度吸收率(默认 0.02)。越深焦散越弱。 */
  absorption?: number;
  /** RGB 色散偏移(默认 0.3)。0 = 无色散。 */
  dispersion?: number;
  /** 聚焦幂(默认 3.0)。越大亮带越锐利。 */
  power?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 水下焦散 Pass。独立管理内部 FBO 与程序。
 *
 * apply() 接收颜色纹理 + 深度纹理 + 相机,输出叠加焦散后的颜色纹理。
 * 调用者每帧更新 `time` 字段驱动波纹动画。
 */
export class CausticsPass {
  readonly name = 'caustics';

  causticColor: [number, number, number];
  causticIntensity: number;
  waterLevel: number;
  worldScale: number;
  waveSpeed: number;
  waveFrequency: number;
  wavePhase: number;
  absorption: number;
  dispersion: number;
  power: number;
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

  constructor(opts: CausticsOptions = {}) {
    this.causticColor = opts.causticColor ?? [0.2, 0.7, 0.9];
    this.causticIntensity = opts.causticIntensity ?? 0.6;
    this.waterLevel = opts.waterLevel ?? 0;
    this.worldScale = opts.worldScale ?? 8;
    this.waveSpeed = opts.waveSpeed ?? 0.8;
    this.waveFrequency = opts.waveFrequency ?? 8;
    this.wavePhase = opts.wavePhase ?? 0;
    this.absorption = opts.absorption ?? 0.02;
    this.dispersion = opts.dispersion ?? 0.3;
    this.power = opts.power ?? 3.0;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 执行焦散后处理。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  当前帧颜色纹理
   * @param depthTexture  GBuffer 深度纹理
   * @param camera        当前相机(读取 projection / view)
   * @returns             叠加焦散后的颜色纹理;若禁用则原样返回输入
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

    // 焦散参数
    prog.setUniform3f('u_causticColor', this.causticColor[0], this.causticColor[1], this.causticColor[2]);
    prog.setUniform1f('u_causticIntensity', this.causticIntensity);
    prog.setUniform1f('u_waterLevel', this.waterLevel);
    prog.setUniform1f('u_worldScale', this.worldScale);
    prog.setUniform1f('u_waveSpeed', this.waveSpeed);
    prog.setUniform1f('u_waveFrequency', this.waveFrequency);
    prog.setUniform1f('u_wavePhase', this.wavePhase);
    prog.setUniform1f('u_absorption', this.absorption);
    prog.setUniform1f('u_dispersion', this.dispersion);
    prog.setUniform1f('u_power', this.power);
    prog.setUniform1f('u_time', this.time);
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
    // 与 HeightFogPass 一致:优先用传入的 gl 删除,无 gl 则置空
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
    // 输出纹理(RGBA16F,焦散加性合成可能产生 HDR 亮度)
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

    // 全屏三角形 VAO(单个大三角形覆盖 [-1,1]²,与 HeightFogPass 一致)
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
    log.info(`Caustics FBO created: ${w}x${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, CAUSTICS_FRAG);
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
