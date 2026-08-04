// MotionBlurEnhancedPass — 高质量运动模糊后处理 Pass。
//
// 在基础 MotionBlurPass 之上增加三项关键改进,达到 UE5 / o3de Atom 级别:
//   1. **深度感知采样** — 沿速度向量采样时对比采样点深度与中心深度,
//      深度差超过阈值时拒绝该样本。消除前景快速运动物体把背景颜色
//      拖入前景的"鬼影"伪影。
//   2. **邻域速度最小钳制** — 取 3×3 邻域内速度的最小长度作为有效速度,
//      消除速度边界处的"条纹"伪影(物体边缘速度突变导致模糊长度跳变)。
//   3. **Halton 抖动采样** — 用 frameIndex 驱动的 halton(2,3) 抖动偏移
//      采样位置,等效 2× 超采样,减少 banding 条纹。
//
// 与 MotionBlurPass(基础版)的区别:
//   - MotionBlurPass 只需 color + velocity,盲采样,无深度感知;
//   - MotionBlurEnhancedPass 额外需要 depth 纹理,采样时深度拒绝 +
//     邻域速度钳制 + 抖动,质量显著更高,代价是多一次深度纹理采样 +
//     8 次邻域速度采样(3×3 - 1)。
//
// 性能:
//   - 单 pass 全屏,每像素最多 maxSamples 次颜色采样 + 1 次深度采样;
//   - 3×3 邻域速度采样 = 8 次纹理采样(仅在速度 > 0.5 像素时执行);
//   - 速度 < 0.5 像素时直接输出中心颜色(零采样,低运动区域免费);
//   - 输出 RGBA16F(HDR 兼容)。
//
// 参考:
//   - McGuire et al. "Real-Time Motion Blur" (Journal of Graphics Tools 2012)
//   - UE5 MotionBlur post-process
//   - o3de Atom MotionBlurPass
//   - three.js examples MotionBlurPass
//   - Jimenez et al. "Temporal Supersampling" (2012) — halton jitter

import { MOTION_BLUR_ENHANCED_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('MotionBlurEnhancedPass');

export interface MotionBlurEnhancedOptions {
  /**
   * 模糊强度(0..1+,默认 1.0)。
   * 值越大模糊越明显。乘到像素速度上。
   */
  strength?: number;
  /**
   * 最大采样数(1..64,默认 16)。
   * 实际采样数随有效速度自适应(clamp 到此值)。
   */
  maxSamples?: number;
  /**
   * 深度拒绝阈值(0..1,默认 0.05)。
   * 采样点深度与中心深度差超过此值时,拒绝该样本。
   * 值越小越严格(更少鬼影,但可能过度拒绝);
   * 值越大越宽松(更多采样,但可能引入边缘鬼影)。
   * 典型值:0.02(严格).. 0.1(宽松)。
   */
  depthThreshold?: number;
  /**
   * 抖动强度(0..1,默认 0.5)。
   * 0 = 禁用抖动(与基础版一致);
   * 1 = 全量 halton 抖动(等效 2× 超采样);
   * 0.5 = 半量抖动(默认,banding 与噪声的平衡)。
   */
  jitter?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 高质量运动模糊 Pass。独立管理内部 FBO / 程序 / 全屏 VAO。
 *
 * 与 MotionBlurPass(基础版)配套使用:
 * ```ts
 * const velocityPass = new VelocityPass();
 * const motionBlur = new MotionBlurEnhancedPass({
 *   maxSamples: 24,
 *   depthThreshold: 0.03,
 *   jitter: 0.5,
 * });
 * // 每帧:
 * velocityPass.apply(gl, currentColorTex, prevVP, currVP);
 * const blurred = motionBlur.apply(gl, currentColorTex, velocityPass.output, depthTex);
 * motionBlur.frameIndex++;  // 推进抖动动画
 * ```
 *
 * apply() 把 color + velocity + depth 纹理喂给
 * MOTION_BLUR_ENHANCED_FRAG fragment shader,执行深度感知 + 邻域钳制 +
 * 抖动采样,输出模糊后的 RGBA16F 颜色纹理(本 Pass 持有)。
 */
export class MotionBlurEnhancedPass {
  readonly name = 'motion-blur-enhanced';

  /** 模糊强度(0..1+)。 */
  strength: number;
  /** 最大采样数(1..64)。 */
  maxSamples: number;
  /** 深度拒绝阈值(0..1)。 */
  depthThreshold: number;
  /** 抖动强度(0..1)。0 = 禁用。 */
  jitter: number;
  /** 是否启用。 */
  enabled: boolean;

  /**
   * 帧序号(用于 halton 抖动动画)。
   * 调用方每帧递增此值以驱动抖动序列。
   */
  frameIndex: number = 0;

  /** 当前输出纹理。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: MotionBlurEnhancedOptions = {}) {
    this.strength = opts.strength ?? 1.0;
    this.maxSamples = opts.maxSamples ?? 16;
    this.depthThreshold = opts.depthThreshold ?? 0.05;
    this.jitter = opts.jitter ?? 0.5;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 设置模糊强度。
   * @param s  强度(0..1+);负值会被 clamp 到 0。
   */
  setStrength(s: number): void {
    this.strength = Math.max(0, s);
  }

  /**
   * 设置最大采样数。
   * @param n  采样数(1..64);超范围会被 clamp。
   */
  setMaxSamples(n: number): void {
    this.maxSamples = Math.max(1, Math.min(64, Math.floor(n)));
  }

  /**
   * 设置深度拒绝阈值。
   * @param t  阈值(0..1);负值会被 clamp 到 0。
   */
  setDepthThreshold(t: number): void {
    this.depthThreshold = Math.max(0, t);
  }

  /**
   * 设置抖动强度。
   * @param j  强度(0..1);超范围会被 clamp。
   */
  setJitter(j: number): void {
    this.jitter = Math.max(0, Math.min(1, j));
  }

  /**
   * 执行高质量运动模糊。
   *
   * @param gl              WebGL2 上下文
   * @param inputTexture    当前帧颜色纹理
   * @param velocityTexture 速度缓冲(RG = NDC 速度)
   * @param depthTexture    NDC 深度纹理(0..1)
   * @returns               模糊后的颜色纹理(禁用时返回输入)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    velocityTexture: WebGLTexture,
    depthTexture: WebGLTexture,
  ): WebGLTexture {
    if (!this.enabled) {
      return inputTexture;
    }

    const targetW = Math.max(1, gl.canvas.width);
    const targetH = Math.max(1, gl.canvas.height);

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getProgram(gl);
    prog.use();

    // 颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 速度纹理 → unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
    prog.setUniformSampler('u_velocityMap', 1);

    // 深度纹理 → unit 2
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 2);

    // 参数
    prog.setUniform1f('u_strength', this.strength);
    prog.setUniform1i('u_maxSamples', Math.max(1, Math.min(64, Math.floor(this.maxSamples))));
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_depthThreshold', this.depthThreshold);
    prog.setUniform1i('u_frameIndex', this.frameIndex & 0x7fffffff);
    prog.setUniform1f('u_jitter', this.jitter);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建资源(分辨率变化/上下文丢失等)。 */
  setDirty(): void {
    this._dirty = true;
  }

  /** 释放 GPU 资源。可重复调用。 */
  dispose(gl?: WebGL2RenderingContext): void {
    if (gl) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._program) this._program.dispose();
    }
    this._outputTexture = null;
    this._fbo = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._program = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    // 释放旧资源(分辨率变化时)
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
    }

    // RGBA16F 输出纹理(模糊过程中可能出现 HDR 像素)
    this._outputTexture = gl.createTexture();
    if (!this._outputTexture) throw new Error('MotionBlurEnhancedPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA16F,
      width, height, 0,
      gl.RGBA, gl.HALF_FLOAT, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    this._fbo = gl.createFramebuffer();
    if (!this._fbo) throw new Error('MotionBlurEnhancedPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 全屏四边形 VAO(2 个三角形覆盖 [-1,1]²,带 UV)
    if (!this._fullscreenQuadVao) {
      this._fullscreenQuadBuf = gl.createBuffer();
      this._fullscreenQuadVao = gl.createVertexArray();
      if (!this._fullscreenQuadVao || !this._fullscreenQuadBuf) {
        throw new Error('MotionBlurEnhancedPass: createVertexArray/Buffer() returned null');
      }
      const verts = new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        1, 1, 1, 1,
        -1, -1, 0, 0,
        1, 1, 1, 1,
        -1, 1, 0, 1,
      ]);
      gl.bindVertexArray(this._fullscreenQuadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);
      gl.bindVertexArray(null);
    }

    this._width = width;
    this._height = height;
    this._initialized = true;
    log.debug(`init: ${width}×${height}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT, MOTION_BLUR_ENHANCED_FRAG);
      log.info('MotionBlurEnhanced program compiled');
    }
    return this._program;
  }
}
