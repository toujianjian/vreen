// ScreenSpaceShadowPass — 屏幕空间方向性接触阴影后处理 Pass。
//
// 设计目标:
//   - 沿光照方向在屏幕空间射线步进深度缓冲,产生阴影贴图无法捕捉的
//     小尺度方向性接触阴影(物体与地面接触处的柔和阴影)。
//   - 与 ContactShadowsPass 的区别:ContactShadowsPass 用亮度作为高度代理,
//     无方向性;本 Pass 用实际深度缓冲 + 光照方向,有正确方向性。
//   - 与 PCSS 的区别:PCSS 采样阴影贴图(大范围,受分辨率限制);
//     本 Pass 采样深度缓冲(小范围,像素级精度)。
//   - 不依赖 RenderPass.apply(input, ctx) 抽象,因为需要额外的深度纹理
//     和光照方向,签名不同;本类独立管理内部 FBO + 程序。
//
// 流程:
//   1. apply() 首次调用时分配内部 FBO + RGBA8 颜色纹理 + 编译程序;
//   2. 绑定 FBO + 视口 → 画全屏四边形,fragment shader 读深度纹理,
//      重建视空间位置,沿光向步进,检测遮挡,输出阴影因子(R=G=B=shadow);
//   3. 输出纹理由调用方与场景颜色相乘:finalColor *= shadowFactor。
//
// 不变量:
//   - dispose 后再调用 apply 会重新分配资源(懒重建);
//   - setResolution() 修改降采样比例后,下一帧 apply 自动重建;
//   - 内部纹理为 RGBA8(阴影 0..1,无需浮点);
//   - 输出纹理所有权归 Pass,调用方不得释放。

import type { Camera } from '../../Cameras/Camera';
import type { Vector3 } from '../../Math/Vector3';
import { POST_VERT as POST_VERT_SRC, SSSHADOW_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('ScreenSpaceShadowPass');

export interface ScreenSpaceShadowPassOptions {
  /** 最大步进次数(默认 16)。 */
  maxSteps?: number;
  /** 步长,视空间单位(默认 0.1)。 */
  stepSize?: number;
  /** 厚度容差,视空间(默认 0.05)。值太小会漏检;太大会出现假阴影。 */
  thickness?: number;
  /** 最大射线距离,视空间(默认 1.0)。超过此距离阴影渐消。 */
  maxDistance?: number;
  /** 深度偏移,避免自阴影(默认 0.001)。 */
  bias?: number;
  /** 降采样比例 0..1(默认 0.5)。1.0 = 全分辨率。 */
  resolution?: number;
}

/**
 * 屏幕空间方向性接触阴影 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * apply() 读深度纹理,沿光照方向在屏幕空间射线步进,输出阴影因子纹理
 * (1=无遮挡/完全照亮,0=完全阴影)。调用方将返回的纹理与场景颜色相乘。
 */
export class ScreenSpaceShadowPass {
  readonly name = 'ssshadow';

  /** 最大步进次数(0..64)。 */
  maxSteps: number = 16;
  /** 步长(视空间单位)。控制射线步进的精细程度。 */
  stepSize: number = 0.1;
  /** 厚度容差(视空间)。射线深度与采样深度差在此范围内视为遮挡。 */
  thickness: number = 0.05;
  /** 最大射线距离(视空间)。超过此距离阴影渐消。 */
  maxDistance: number = 1.0;
  /** 深度偏移(避免自阴影)。 */
  bias: number = 0.001;
  /** 降采样比例(0..1)。半分辨率默认以减轻 GPU 负担。 */
  resolution: number = 0.5;

  /** 输出阴影因子纹理。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;

  /** 全屏四边形 VAO。 */
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 当前内部缓冲尺寸(像素)。 */
  private _width: number = 0;
  private _height: number = 0;
  /** 是否已初始化。 */
  private _initialized: boolean = false;
  /** 标记下一帧需要重建。 */
  private _dirty: boolean = true;

  constructor(opts: ScreenSpaceShadowPassOptions = {}) {
    if (opts.maxSteps !== undefined) this.maxSteps = opts.maxSteps;
    if (opts.stepSize !== undefined) this.stepSize = opts.stepSize;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.maxDistance !== undefined) this.maxDistance = opts.maxDistance;
    if (opts.bias !== undefined) this.bias = opts.bias;
    if (opts.resolution !== undefined) this.resolution = opts.resolution;
  }

  /**
   * 执行屏幕空间阴影射线步进。
   *
   * @param gl           WebGL2 上下文
   * @param depthTexture 场景深度纹理
   * @param camera       当前相机(读取 projection / inverseProjection)
   * @param lightDir     世界空间光照方向(指向光源)
   * @returns            阴影因子纹理(1=照亮,0=阴影)
   */
  apply(
    gl: WebGL2RenderingContext,
    depthTexture: WebGLTexture,
    camera: Camera,
    lightDir: Vector3,
  ): WebGLTexture {
    const targetW = Math.max(1, Math.floor(gl.canvas.width * this.resolution));
    const targetH = Math.max(1, Math.floor(gl.canvas.height * this.resolution));

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0); // 默认无遮挡
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 0);

    // 计算视空间光向:世界光向 → 视空间(乘 view 矩阵的 3x3 部分)
    const view = camera.matrixWorldInverse.elements;
    const lightDirVS = {
      x: view[0] * lightDir.x + view[4] * lightDir.y + view[8] * lightDir.z,
      y: view[1] * lightDir.x + view[5] * lightDir.y + view[9] * lightDir.z,
      z: view[2] * lightDir.x + view[6] * lightDir.y + view[10] * lightDir.z,
    };

    // 逆投影矩阵 = inverse(projection)
    const proj = camera.projectionMatrix.elements;
    const invProj = invertMat4(proj);

    prog.setUniformMatrix4fv('u_invProjection', invProj);
    prog.setUniformMatrix4fv('u_projection', proj);
    prog.setUniform3f('u_lightDirVS', lightDirVS.x, lightDirVS.y, lightDirVS.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1i('u_maxSteps', Math.max(0, Math.min(64, Math.floor(this.maxSteps))));
    prog.setUniform1f('u_stepSize', this.stepSize);
    prog.setUniform1f('u_thickness', this.thickness);
    prog.setUniform1f('u_maxDistance', this.maxDistance);
    prog.setUniform1f('u_bias', this.bias);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return this._outputTexture as WebGLTexture;
  }

  /** 设置降采样比例(0.05..1.0)。 */
  setResolution(r: number): void {
    const clamped = Math.max(0.05, Math.min(1.0, r));
    if (clamped !== this.resolution) {
      this.resolution = clamped;
      this._dirty = true;
    }
  }

  /** 释放内部 FBO / 纹理 / VAO / program。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._outputTexture) { gl.deleteTexture(this._outputTexture); this._outputTexture = null; }
    if (this._fbo) { gl.deleteFramebuffer(this._fbo); this._fbo = null; }
    if (this._fullscreenQuadVao) { gl.deleteVertexArray(this._fullscreenQuadVao); this._fullscreenQuadVao = null; }
    if (this._fullscreenQuadBuf) { gl.deleteBuffer(this._fullscreenQuadBuf); this._fullscreenQuadBuf = null; }
    if (this._program) { this._program.dispose(); this._program = null; }
    this._initialized = false;
    this._width = 0;
    this._height = 0;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, SSSHADOW_FRAG);
    log.info('program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RGBA8 输出纹理(阴影因子 0..1,无需浮点)
    const tex = gl.createTexture();
    if (!tex) throw new Error('ScreenSpaceShadowPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('ScreenSpaceShadowPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('ScreenSpaceShadowPass: createVertexArray/Buffer() returned null');
    const verts = new Float32Array([
      -1, -1, 0, 0, 1, -1, 1, 0, 1, 1, 1, 1,
      -1, -1, 0, 0, 1, 1, 1, 1, -1, 1, 0, 1,
    ]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._outputTexture = tex;
    this._fbo = fbo;
    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;
    log.info(`FBO created: ${width}x${height}`);
  }
}

// ── 辅助:4×4 矩阵求逆(列主序) ──────────────────────────────────
function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15] = m;

  const b00 = a0 * a5 - a1 * a4;
  const b01 = a0 * a6 - a2 * a4;
  const b02 = a0 * a7 - a3 * a4;
  const b03 = a1 * a6 - a2 * a5;
  const b04 = a1 * a7 - a3 * a5;
  const b05 = a2 * a7 - a3 * a6;
  const b06 = a8 * a13 - a9 * a12;
  const b07 = a8 * a14 - a10 * a12;
  const b08 = a8 * a15 - a11 * a12;
  const b09 = a9 * a14 - a10 * a13;
  const b10 = a9 * a15 - a11 * a13;
  const b11 = a10 * a15 - a11 * a14;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-10) {
    // 不可逆,返回单位矩阵
    inv[0] = 1; inv[5] = 1; inv[10] = 1; inv[15] = 1;
    return inv;
  }
  det = 1.0 / det;

  inv[0]  = (a5 * b11 - a6 * b10 + a7 * b09) * det;
  inv[1]  = (a2 * b10 - a1 * b11 - a3 * b09) * det;
  inv[2]  = (a13 * b05 - a14 * b04 + a15 * b03) * det;
  inv[3]  = (a10 * b04 - a9 * b05 - a11 * b03) * det;
  inv[4]  = (a6 * b08 - a4 * b11 - a7 * b07) * det;
  inv[5]  = (a0 * b11 - a2 * b08 + a3 * b07) * det;
  inv[6]  = (a14 * b02 - a12 * b05 - a15 * b01) * det;
  inv[7]  = (a8 * b05 - a10 * b02 + a11 * b01) * det;
  inv[8]  = (a4 * b10 - a5 * b08 + a7 * b06) * det;
  inv[9]  = (a1 * b08 - a0 * b10 - a3 * b06) * det;
  inv[10] = (a12 * b04 - a13 * b02 + a15 * b00) * det;
  inv[11] = (a9 * b02 - a8 * b04 - a11 * b00) * det;
  inv[12] = (a5 * b07 - a4 * b09 - a6 * b06) * det;
  inv[13] = (a0 * b09 - a1 * b07 + a2 * b06) * det;
  inv[14] = (a13 * b01 - a12 * b03 - a14 * b00) * det;
  inv[15] = (a8 * b03 - a9 * b01 + a10 * b00) * det;
  return inv;
}
