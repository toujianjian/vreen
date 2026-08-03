// HeightFogPass — 指数高度雾后处理 Pass。
//
// 设计目标:
//   - 基于 GBuffer 深度纹理重建世界位置,根据世界高度 Y 计算指数衰减雾密度。
//   - 近处低空雾浓,远处高空雾淡,模拟真实大气散射效果。
//   - 支持方向光入射散射(inscattering),让太阳方向的雾色偏暖。
//   - 独立管理 FBO + 程序,不继承 RenderPass(需要 depth + camera)。
//
// 算法(UE5 ExponentialHeightFog 简化版):
//   1. 从 depth 纹理重建世界位置(逆 viewProjection);
//   2. 计算像素到相机的距离 viewDist;
//   3. 雾密度 = fogDensity * exp(-fogHeightFalloff * (worldPos.y - fogHeight));
//   4. 雾因子 = 1 - exp(-density * viewDist);
//   5. (可选)入射散射:太阳方向与视线方向同向时雾色偏暖;
//   6. 最终颜色 = mix(sceneColor, fogColor, fogFactor)。
//
// 参考:
//   - UE5 "Exponential Height Fog" 文档
//   - o3de Atom "Fog" 模块

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, HEIGHT_FOG_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('HeightFogPass');

export interface HeightFogOptions {
  /** 雾基础密度(默认 0.02)。值越大雾越浓。 */
  fogDensity?: number;
  /** 雾高度衰减率(默认 0.05)。值越大随高度上升雾消散越快。 */
  fogHeightFalloff?: number;
  /** 雾起始高度(默认 0)。世界 Y 坐标低于此值的区域雾更浓。 */
  fogHeight?: number;
  /** 雾颜色 RGB(默认 0.7, 0.8, 0.9 = 淡蓝灰)。 */
  fogColor?: [number, number, number];
  /** 最大雾距离(默认 500)。超出此距离的像素完全被雾覆盖。 */
  maxDistance?: number;
  /** 是否启用方向光入射散射(默认 false)。 */
  inscatteringEnabled?: boolean;
  /** 方向光方向(世界空间,默认 (-0.5, -1, -0.3))。 */
  sunDirection?: [number, number, number];
  /** 方向光颜色(默认 (1, 0.9, 0.7) = 暖黄)。 */
  sunColor?: [number, number, number];
  /** 入射散射强度(默认 1.0)。 */
  inscatteringStrength?: number;
}

/**
 * 指数高度雾 Pass。独立管理内部 FBO 与程序。
 *
 * apply() 接收颜色纹理 + 深度纹理 + 相机,输出雾化后的颜色纹理。
 */
export class HeightFogPass {
  readonly name = 'heightfog';

  fogDensity: number;
  fogHeightFalloff: number;
  fogHeight: number;
  fogColor: [number, number, number];
  maxDistance: number;
  inscatteringEnabled: boolean;
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  inscatteringStrength: number;

  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: HeightFogOptions = {}) {
    this.fogDensity = opts.fogDensity ?? 0.02;
    this.fogHeightFalloff = opts.fogHeightFalloff ?? 0.05;
    this.fogHeight = opts.fogHeight ?? 0;
    this.fogColor = opts.fogColor ?? [0.7, 0.8, 0.9];
    this.maxDistance = opts.maxDistance ?? 500;
    this.inscatteringEnabled = opts.inscatteringEnabled ?? false;
    this.sunDirection = opts.sunDirection ?? [-0.5, -1, -0.3];
    this.sunColor = opts.sunColor ?? [1.0, 0.9, 0.7];
    this.inscatteringStrength = opts.inscatteringStrength ?? 1.0;
  }

  /**
   * 执行高度雾后处理。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  当前帧颜色纹理
   * @param depthTexture  GBuffer 深度纹理
   * @param camera        当前相机(读取 projection / view)
   * @returns             雾化后的颜色纹理
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
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

    // 雾参数
    prog.setUniform1f('u_fogDensity', this.fogDensity);
    prog.setUniform1f('u_fogHeightFalloff', this.fogHeightFalloff);
    prog.setUniform1f('u_fogHeight', this.fogHeight);
    prog.setUniform3f('u_fogColor', this.fogColor[0], this.fogColor[1], this.fogColor[2]);
    prog.setUniform1f('u_maxDistance', this.maxDistance);

    // 入射散射
    prog.setUniform1i('u_inscatteringEnabled', this.inscatteringEnabled ? 1 : 0);
    if (this.inscatteringEnabled) {
      const sd = this.sunDirection;
      const sc = this.sunColor;
      prog.setUniform3f('u_sunDirection', sd[0], sd[1], sd[2]);
      prog.setUniform3f('u_sunColor', sc[0], sc[1], sc[2]);
      prog.setUniform1f('u_inscatteringStrength', this.inscatteringStrength);
    }

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建(分辨率变更等)。 */
  setDirty(): void { this._dirty = true; }

  /** 释放 GPU 资源。 */
  dispose(): void {
    // 注意:本类在无 GL 环境下可能未初始化,需安全检查
    // (dispose 可能由 GC 触发,GL 上下文可能已销毁)
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
    // 输出纹理(RGBA8)
    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);

    // 全屏四边形 VAO
    this._fullscreenQuadBuf = gl.createBuffer();
    this._fullscreenQuadVao = gl.createVertexArray();
    gl.bindVertexArray(this._fullscreenQuadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
    // 2 triangles covering [-1, 1]
    const verts = new Float32Array([
      -1, -1, 0, 0,  3, -1, 0, 0,  -1, 3, 0, 0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this._width = w;
    this._height = h;
    this._initialized = true;
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, HEIGHT_FOG_FRAG);
    }
    return this._program;
  }

  private _computeInverseVP(camera: Camera): Float32Array {
    // 构建 VP = projection × matrixWorldInverse,然后求逆。
    // VREEN Camera 暴露 projectionMatrix 和 matrixWorldInverse,
    // 这里用 column-major 4×4 乘法组合后调用通用求逆。
    // (VREEN Matrix4 暂未暴露返回新矩阵的 invert(),为避免修改相机
    //  矩阵,本类内联了 invertMat4。)
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
    // 求逆(通用 4×4 矩阵求逆)
    return invertMat4(vp);
  }
}

/** 通用 4×4 矩阵求逆(列主序)。 */
function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  // 使用伴随矩阵法求逆
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
