// AutoExposurePass — 自动曝光(眼适应 / Eye Adaptation)Pass。
//
// 设计目标:
//   - 计算场景平均亮度(降采样到 1x1 + 对数空间平均,避免高亮像素主导);
//   - 根据平均亮度计算目标曝光,以 adaptationSpeed 速率向目标平滑过渡;
//   - 把当前曝光作为 uniform 喂给 apply shader,把场景色调向曝光适应。
//
// 流程:
//   1. computeLuminance(gl, inputTexture) — 多级降采样到 1x1,得到对数平均亮度。
//      实现策略:在 1x1 之前的若干级用 GPU 降采样(每级 2x2 → 1x1),
//      最后用 readPixels 读取 1x1 的 R 通道得到 logLuminance。
//   2. CPU 端:avgLuminance = exp(logLum);targetExposure = -log2(avgLum) * keyFactor;
//      currentExposure = mix(currentExposure, targetExposure, 1 - exp(-adaptationSpeed * dt));
//   3. apply(gl, inputTexture) — 把 currentExposure 喂给 AUTO_EXPOSURE_APPLY_FRAG,
//      输出 color * exp2(currentExposure)。
//
// 不变量:
//   - dispose 后再 apply 自动重建;
//   - 降采样级数 = ceil(log2(max(w, h)));中间纹理按 mipmap 链分配;
//   - 内部 luminanceTexture 为 1x1 R32F(或 RGBA16F 回退);
//   - 输出纹理所有权归 Pass,调用方不得释放;
//   - 调用方每帧 apply 前应调用 setDeltaTime(dt) 以驱动适应速率;
//     未调用时按 dt=1/60 估算。
//
// 参考:
//   - "Average Luminance" (Mittring 2007)
//   - GPU Pro 5 "Next-Generation Post Processing in Call of Duty: Advanced Warfare"

import { POST_VERT as POST_VERT_SRC, AUTO_EXPOSURE_LUMINANCE_FRAG, AUTO_EXPOSURE_APPLY_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('AutoExposurePass');

export interface AutoExposurePassOptions {
  /** 适应速度(默认 1.5;值越大适应越快)。 */
  adaptationSpeed?: number;
  /** 最小曝光 EV(默认 -2)。 */
  minExposure?: number;
  /** 最大曝光 EV(默认 2)。 */
  maxExposure?: number;
  /** 初始曝光(默认 0)。 */
  initialExposure?: number;
  /** 曝光目标关键值(0..1,默认 0.5;越小越暗)。 */
  key?: number;
}

/**
 * 自动曝光 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * 调用方职责:
 *   1. 每帧 apply 前可选地调用 `setDeltaTime(dt)` 喂入帧间隔(秒);
 *   2. 调用 `apply(gl, inputTexture)` → 返回曝光后的输出纹理;
 *   3. 通过 `currentExposure` 读取当前曝光值(供 UI / 调试用)。
 */
export class AutoExposurePass {
  readonly name = 'auto-exposure';

  /** 适应速度(默认 1.5)。 */
  adaptationSpeed: number = 1.5;
  /** 最小曝光 EV(默认 -2)。 */
  minExposure: number = -2;
  /** 最大曝光 EV(默认 2)。 */
  maxExposure: number = 2;
  /** 当前曝光 EV(初始 0)。 */
  currentExposure: number = 0;
  /** 曝光目标关键值(0..1,默认 0.5)。 */
  key: number = 0.5;

  /** 1x1 亮度纹理(对数平均亮度,R = logLum)。 */
  luminanceTexture: WebGLTexture | null = null;

  /** 帧间隔(秒)。 */
  private _deltaTime: number = 1 / 60;

  /** 输出纹理(曝光后场景)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _outputFbo: WebGLFramebuffer | null = null;
  /** 1x1 luminance FBO。 */
  private _luminanceFbo: WebGLFramebuffer | null = null;
  /** 降采样中间纹理链(从大到小,最后一级 = 1x1 = luminanceTexture)。 */
  private _mipTextures: WebGLTexture[] = [];
  private _mipFbos: WebGLFramebuffer[] = [];
  private _mipSizes: Array<{ w: number; h: number }> = [];

  private _luminanceProgram: ShaderProgram | null = null;
  private _applyProgram: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;

  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  /** 1x1 readPixels 缓存。 */
  private _readBuf: Float32Array = new Float32Array(4);

  constructor(opts: AutoExposurePassOptions = {}) {
    if (opts.adaptationSpeed !== undefined) this.adaptationSpeed = opts.adaptationSpeed;
    if (opts.minExposure !== undefined) this.minExposure = opts.minExposure;
    if (opts.maxExposure !== undefined) this.maxExposure = opts.maxExposure;
    if (opts.initialExposure !== undefined) this.currentExposure = opts.initialExposure;
    if (opts.key !== undefined) this.key = opts.key;
  }

  /**
   * 设置帧间隔(秒)。调用方应在 apply 前调用。
   */
  setDeltaTime(dt: number): void {
    this._deltaTime = Math.max(0, dt);
  }

  /**
   * 直接设置当前曝光值(覆盖适应结果)。
   * @param ev  曝光 EV;会被 clamp 到 [minExposure, maxExposure]。
   */
  setExposure(ev: number): void {
    this.currentExposure = Math.max(this.minExposure, Math.min(this.maxExposure, ev));
  }

  /**
   * 计算平均亮度(降采样到 1x1)。
   *
   * @param gl            WebGL2 上下文
   * @param inputTexture  当前帧颜色纹理
   * @returns             1x1 luminanceTexture(R = logLum);调用方一般不直接读
   */
  computeLuminance(gl: WebGL2RenderingContext, inputTexture: WebGLTexture): WebGLTexture {
    if (this._mipTextures.length === 0) {
      // 未初始化或尺寸变更
      this._initResources(gl, Math.max(1, gl.canvas.width), Math.max(1, gl.canvas.height));
    }

    const prog = this._getLuminanceProgram(gl);
    prog.use();

    // 第一级:从 inputTexture 降采样到 mips[0]
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._mipFbos[0]);
    gl.viewport(0, 0, this._mipSizes[0].w, this._mipSizes[0].h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform2f('u_screenSize', this._width, this._height);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 后续级别:从前一级降采样
    for (let i = 1; i < this._mipFbos.length; i++) {
      const prevTex = this._mipTextures[i - 1];
      const sz = this._mipSizes[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._mipFbos[i]);
      gl.viewport(0, 0, sz.w, sz.h);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      prog.setUniformSampler('u_colorMap', 0);
      prog.setUniform2f('u_screenSize', this._mipSizes[i - 1].w, this._mipSizes[i - 1].h);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // 最后一级 = 1x1 = luminanceTexture
    return this.luminanceTexture as WebGLTexture;
  }

  /**
   * 执行自动曝光。
   *
   * @param gl            WebGL2 上下文
   * @param inputTexture  当前帧颜色(HDR)
   * @returns             曝光后输出纹理(本 Pass 持有)
   */
  apply(gl: WebGL2RenderingContext, inputTexture: WebGLTexture): WebGLTexture {
    const targetW = Math.max(1, gl.canvas.width);
    const targetH = Math.max(1, gl.canvas.height);

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    // 1. 多级降采样到 1x1
    this.computeLuminance(gl, inputTexture);

    // 2. CPU 端 readPixels 读取 1x1 logLum,计算目标曝光 + 适应
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._luminanceFbo as WebGLFramebuffer);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this._readBuf);

    const logLum = this._readBuf[0] ?? -9.21; // exp(-9.21) ≈ 1e-4
    const avgLum = Math.exp(logLum);
    // 目标曝光:targetEV = log2(key / avgLum)
    const safeAvg = Math.max(avgLum, 1e-6);
    const targetEV = Math.log2(this.key / safeAvg);
    const clampedTarget = Math.max(this.minExposure, Math.min(this.maxExposure, targetEV));

    // 指数适应:alpha = 1 - exp(-adaptationSpeed * dt)
    const alpha = 1 - Math.exp(-this.adaptationSpeed * Math.max(0, this._deltaTime));
    this.currentExposure = this.currentExposure + (clampedTarget - this.currentExposure) * alpha;

    // 3. 把曝光应用回场景
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._outputFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const applyProg = this._getApplyProgram(gl);
    applyProg.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    applyProg.setUniformSampler('u_colorMap', 0);
    applyProg.setUniform1f('u_exposure', this.currentExposure);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 释放内部资源。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._outputTexture) {
      gl.deleteTexture(this._outputTexture);
      this._outputTexture = null;
    }
    for (const tex of this._mipTextures) gl.deleteTexture(tex);
    this._mipTextures = [];
    this.luminanceTexture = null;

    if (this._outputFbo) {
      gl.deleteFramebuffer(this._outputFbo);
      this._outputFbo = null;
    }
    for (const fbo of this._mipFbos) gl.deleteFramebuffer(fbo);
    this._mipFbos = [];
    this._luminanceFbo = null;

    if (this._fullscreenQuadVao) {
      gl.deleteVertexArray(this._fullscreenQuadVao);
      this._fullscreenQuadVao = null;
    }
    if (this._fullscreenQuadBuf) {
      gl.deleteBuffer(this._fullscreenQuadBuf);
      this._fullscreenQuadBuf = null;
    }
    if (this._luminanceProgram) {
      this._luminanceProgram.dispose();
      this._luminanceProgram = null;
    }
    if (this._applyProgram) {
      this._applyProgram.dispose();
      this._applyProgram = null;
    }
    this._mipSizes = [];
    this._initialized = false;
    this._width = 0;
    this._height = 0;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getLuminanceProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._luminanceProgram) return this._luminanceProgram;
    this._luminanceProgram = new ShaderProgram(gl, POST_VERT_SRC, AUTO_EXPOSURE_LUMINANCE_FRAG);
    log.info('AutoExposure luminance program compiled');
    return this._luminanceProgram;
  }

  private _getApplyProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._applyProgram) return this._applyProgram;
    this._applyProgram = new ShaderProgram(gl, POST_VERT_SRC, AUTO_EXPOSURE_APPLY_FRAG);
    log.info('AutoExposure apply program compiled');
    return this._applyProgram;
  }

  /**
   * (重新)分配内部资源:
   *   - 输出纹理(RGBA16F)+ FBO
   *   - 降采样中间纹理链:从 max(1, ceil(w/2)) x ... 到 1x1
   *   - 全屏四边形 VAO
   */
  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      for (const tex of this._mipTextures) gl.deleteTexture(tex);
      if (this._outputFbo) gl.deleteFramebuffer(this._outputFbo);
      for (const fbo of this._mipFbos) gl.deleteFramebuffer(fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      this._mipTextures = [];
      this._mipFbos = [];
      this._mipSizes = [];
      this.luminanceTexture = null;
      this._luminanceFbo = null;
    }

    // 输出纹理
    this._outputTexture = createHalfFloatTexture(gl, width, height);
    this._outputFbo = createFbo(gl, this._outputTexture);

    // 降采样链:每次 max(1, w/2) / max(1, h/2),直到 1x1
    let curW = Math.max(1, Math.floor(width / 2));
    let curH = Math.max(1, Math.floor(height / 2));
    while (true) {
      const tex = createHalfFloatTexture(gl, curW, curH);
      const fbo = createFbo(gl, tex);
      this._mipTextures.push(tex);
      this._mipFbos.push(fbo);
      this._mipSizes.push({ w: curW, h: curH });

      if (curW === 1 && curH === 1) break;
      curW = Math.max(1, Math.floor(curW / 2));
      curH = Math.max(1, Math.floor(curH / 2));
      // 安全保护:避免无限循环
      if (this._mipTextures.length > 24) break;
    }

    // 最后一级就是 luminanceTexture(1x1,对数平均亮度)
    const lastTex = this._mipTextures[this._mipTextures.length - 1];
    const lastFbo = this._mipFbos[this._mipFbos.length - 1];
    this.luminanceTexture = lastTex;
    this._luminanceFbo = lastFbo;

    // 全屏四边形 VAO
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('AutoExposurePass: createVertexArray/Buffer() returned null');
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

    log.info(`AutoExposure FBOs created: ${width}x${height}, mip levels=${this._mipTextures.length}`);
  }
}

// ── 内部工具 ─────────────────────────────────────────────────────────

function createHalfFloatTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('AutoExposurePass: createTexture() returned null');
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
  if (!fbo) throw new Error('AutoExposurePass: createFramebuffer() returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
  );
  return fbo;
}
