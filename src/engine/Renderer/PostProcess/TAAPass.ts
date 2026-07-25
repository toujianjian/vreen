// TAAPass — 时间抗锯齿(Temporal Anti-Aliasing)Pass。
//
// 设计目标:
//   - 利用上一帧累积历史 + 当前帧做邻域裁剪(clamp)后混合,实现高质量抗锯齿。
//   - 支持 Halton 低差异序列抖动(调用方在投影矩阵上叠加 sub-pixel jitter)。
//   - 独立管理内部 FBO + 程序(与 SSRPass / VolumetricFogPass 同构),
//     不继承 RenderPass,因为 apply() 签名需要额外的 velocityTexture。
//
// 流程:
//   1. 调用方在主场景渲染前调用 `setJitter(x, y)`,并把 jitter 投影到
//      相机的 projectionMatrix 上(本 Pass 不修改相机,只记录 jitter 值)。
//   2. 每帧调用 `apply(gl, inputTexture, velocityTexture)`,把当前帧颜色 +
//      上一帧 history + 速度缓冲喂给 TAA_FRAG,输出抗锯齿后的颜色。
//   3. 内部 ping-pong 两张 history 纹理:本帧输出 → 下一帧 history。
//
// 不变量:
//   - dispose 后再 apply 自动重建(首帧 history 为黑色,等价于无累积);
//   - 内部纹理为 RGBA16F(浮点精度避免多次混合后衰减失真);
//   - 输出纹理所有权归 Pass,调用方不得释放;
//   - 调用方应在 getJitterPattern 后用 sampleIndex 递增获取下一帧 jitter。
//
// 参考:
//   - "High Quality Temporal Supersampling" (Karis 2014)
//   - three.js examples/jsm/postprocessing/TAAPass(本实现为简化版)

import { Vector2 } from '../../Math';
import { POST_VERT as POST_VERT_SRC, TAA_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('TAAPass');

export interface TAAPassOptions {
  /** 当前帧权重(0..1,默认 0.1)。值越小越平滑,但响应越慢。 */
  blendFactor?: number;
  /** 抖动幅度(像素,默认 1.0;0 关闭 jitter)。 */
  jitterScale?: number;
}

/**
 * 时间抗锯齿 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * 内部维护两张 history 纹理(ping-pong):本帧写入 A,下一帧把 A 当作 history,
 * 同时本帧又写入 B……以此类推。这样 history 与 output 不会冲突。
 */
export class TAAPass {
  readonly name = 'taa';

  /** 当前帧权重(0..1)。 */
  blendFactor: number = 0.1;
  /** 抖动幅度(像素)。 */
  jitterScale: number = 1.0;

  /** 当前帧 jitter(像素单位)。 */
  jitter: Vector2;

  /** 上一帧 history 纹理(供下游读取,只读)。 */
  historyTexture: WebGLTexture | null = null;
  /** 当前帧速度缓冲(由外部 VelocityPass 生成;null 时按 0 速度处理)。 */
  velocityTexture: WebGLTexture | null = null;

  /** 当前输出纹理(apply 后可用)。 */
  private _outputTexture: WebGLTexture | null = null;
  /** history 纹理 B(ping-pong 中的一张)。 */
  private _historyTextureB: WebGLTexture | null = null;
  /** 输出 FBO(绑定 outputTexture)。 */
  private _outputFbo: WebGLFramebuffer | null = null;
  /** history A 的 FBO(绑定 historyTexture)。 */
  private _historyFboA: WebGLFramebuffer | null = null;
  /** history B 的 FBO(绑定 _historyTextureB)。 */
  private _historyFboB: WebGLFramebuffer | null = null;
  /** 标记当前 history 是 A 还是 B(每帧翻转)。 */
  private _historyIsA: boolean = true;

  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: TAAPassOptions = {}) {
    if (opts.blendFactor !== undefined) this.blendFactor = opts.blendFactor;
    if (opts.jitterScale !== undefined) this.jitterScale = opts.jitterScale;
    this.jitter = new Vector2(0, 0);
  }

  /**
   * 设置当前帧 jitter(像素单位)。调用方应在主场景渲染前调用。
   * @param x  X 方向偏移(像素)
   * @param y  Y 方向偏移(像素)
   */
  setJitter(x: number, y: number): void {
    this.jitter.set(x, y);
  }

  /**
   * 获取 Halton 低差异序列抖动。
   * @param sampleIndex  样本索引(0,1,2,...,通常 0..15 或 0..31)
   * @param scale        抖动幅度(像素,默认 jitterScale)
   * @returns            Vector2 {x, y} 范围 [-0.5, 0.5]
   *
   * Halton(2,3) 序列在 [0,1)² 上分布,减去 0.5 后映射到 [-0.5, 0.5]²。
   * 调用方应把此 jitter 缩放到像素后用 setJitter 写入,并把同样的偏移
   * 叠加到相机 projectionMatrix 的 [2][0] / [2][1](NDC xy 偏移)。
   */
  getJitterPattern(sampleIndex: number, scale: number = this.jitterScale): Vector2 {
    const x = halton(sampleIndex, 2) - 0.5;
    const y = halton(sampleIndex, 3) - 0.5;
    return new Vector2(x * scale, y * scale);
  }

  /**
   * 执行 TAA。
   *
   * @param gl              WebGL2 上下文
   * @param inputTexture    当前帧颜色(已用 jitter 投影渲染)
   * @param velocityTexture 速度缓冲(RG = NDC 速度,已乘 0.5);
   *                         若 null 则使用本 Pass 内部缓存的 velocityTexture
   * @returns               TAA 输出纹理(本 Pass 持有,不要释放)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    velocityTexture: WebGLTexture | null,
  ): WebGLTexture {
    const targetW = Math.max(1, gl.canvas.width);
    const targetH = Math.max(1, gl.canvas.height);

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    // 缓存外部传入的 velocityTexture,供下游查询
    if (velocityTexture !== null) {
      this.velocityTexture = velocityTexture;
    }

    // 当前 history = A 或 B 中的一张(只采样,不写)
    const historyTex = this._historyIsA
      ? (this.historyTexture as WebGLTexture)
      : (this._historyTextureB as WebGLTexture);

    // 写入 output FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._outputFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, historyTex);
    prog.setUniformSampler('u_historyMap', 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture as WebGLTexture);
    prog.setUniformSampler('u_velocityMap', 2);

    prog.setUniform1f('u_blendFactor', this.blendFactor);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform2f('u_jitter', this.jitter.x, this.jitter.y);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 把本帧输出复制到下一帧的 history FBO(把 output → 另一张 history)
    // 简化做法:用 blit;若不支持则用 copy shader(此处用 blit,WebGL2 支持)。
    const nextHistoryFbo = this._historyIsA
      ? (this._historyFboB as WebGLFramebuffer)
      : (this._historyFboA as WebGLFramebuffer);
    const nextHistoryTex = this._historyIsA
      ? (this._historyTextureB as WebGLTexture)
      : (this.historyTexture as WebGLTexture);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._outputFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, nextHistoryFbo);
    gl.blitFramebuffer(
      0, 0, this._width, this._height,
      0, 0, this._width, this._height,
      gl.COLOR_BUFFER_BIT, gl.LINEAR,
    );
    // 标记下一帧的 history 是另一张
    void nextHistoryTex;
    this._historyIsA = !this._historyIsA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 设置降采样(本 Pass 不支持降采样,接口保留兼容)。 */
  setResolution(_scale: number): void {
    // TAA 必须在主场景分辨率上运行;不支持降采样。
    void _scale;
  }

  /** 释放内部资源。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._outputTexture) {
      gl.deleteTexture(this._outputTexture);
      this._outputTexture = null;
    }
    if (this.historyTexture) {
      gl.deleteTexture(this.historyTexture);
      this.historyTexture = null;
    }
    if (this._historyTextureB) {
      gl.deleteTexture(this._historyTextureB);
      this._historyTextureB = null;
    }
    if (this._outputFbo) {
      gl.deleteFramebuffer(this._outputFbo);
      this._outputFbo = null;
    }
    if (this._historyFboA) {
      gl.deleteFramebuffer(this._historyFboA);
      this._historyFboA = null;
    }
    if (this._historyFboB) {
      gl.deleteFramebuffer(this._historyFboB);
      this._historyFboB = null;
    }
    if (this._fullscreenQuadVao) {
      gl.deleteVertexArray(this._fullscreenQuadVao);
      this._fullscreenQuadVao = null;
    }
    if (this._fullscreenQuadBuf) {
      gl.deleteBuffer(this._fullscreenQuadBuf);
      this._fullscreenQuadBuf = null;
    }
    if (this._program) {
      this._program.dispose();
      this._program = null;
    }
    this._initialized = false;
    this._width = 0;
    this._height = 0;
    this._dirty = true;
    this._historyIsA = true;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, TAA_FRAG);
    log.info('TAA program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this.historyTexture) gl.deleteTexture(this.historyTexture);
      if (this._historyTextureB) gl.deleteTexture(this._historyTextureB);
      if (this._outputFbo) gl.deleteFramebuffer(this._outputFbo);
      if (this._historyFboA) gl.deleteFramebuffer(this._historyFboA);
      if (this._historyFboB) gl.deleteFramebuffer(this._historyFboB);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // 三张 RGBA16F 纹理:output + historyA + historyB
    this._outputTexture = createHalfFloatTexture(gl, width, height);
    this.historyTexture = createHalfFloatTexture(gl, width, height);
    this._historyTextureB = createHalfFloatTexture(gl, width, height);

    this._outputFbo = createFbo(gl, this._outputTexture);
    this._historyFboA = createFbo(gl, this.historyTexture);
    this._historyFboB = createFbo(gl, this._historyTextureB);

    // 把两张 history 清成黑(避免首帧读到垃圾数据)
    clearFbo(gl, this._historyFboA, width, height);
    clearFbo(gl, this._historyFboB, width, height);

    // 全屏四边形 VAO(position@0 + uv@2,与 POST_VERT 一致)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('TAAPass: createVertexArray/Buffer() returned null');
    const verts = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      1, 1, 1, 1,
      -1, -1, 0, 0,
      1, 1, 1, 1,
      -1, 1, 0, 1,
    ]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`TAA FBOs created: ${width}x${height}`);
  }
}

// ── Halton 序列 ─────────────────────────────────────────────────────
// Halton(i, b):基 b 上的低差异序列,i 从 0 开始。
// 经典实现:把 i 写成基 b 表示,然后按 radical inverse 计算。
function halton(index: number, base: number): number {
  let f = 1.0;
  let r = 0.0;
  let i = Math.max(0, Math.floor(index));
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

// ── 内部工具(与 AfterimagePass 一致) ────────────────────────────────
function createHalfFloatTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('TAAPass: createTexture() returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA16F,
    width, height, 0,
    gl.RGBA, gl.HALF_FLOAT, null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createFbo(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('TAAPass: createFramebuffer() returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
  );
  return fbo;
}

function clearFbo(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  width: number,
  height: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}
