// LocalExposurePass — 局部曝光后处理 Pass。
//
// 与 AutoExposure(全局曝光)互补:
//   - AutoExposure 根据整帧平均亮度调整全局曝光(整画面提亮/压暗)
//   - LocalExposure 在局部区域调整曝光(暗部提亮、亮部压暗),保留细节
//
// 算法(o3de Atom LocalExposurePass / UE5 Eye Adaptation 简化版):
//   1. 局部平均亮度 localLum(小范围邻域,默认 5×5)
//   2. 全局平均亮度 globalLum(大范围邻域,默认 5×5 大步长 stride=8)
//   3. 对数空间差异 logDelta = log(globalLum) - log(localLum)
//      logDelta > 0 → 局部偏暗 → 提亮
//      logDelta < 0 → 局部偏亮 → 压暗
//   4. 曝光补偿 exposureFactor = exp(clamp(logDelta × strength, ±maxComp))
//   5. 细节保留:像素级 detail = pixelLum - localLum 不被曝光压缩
//
// 性能:单 pass,~50 次纹理采样(25 局部 + 25 全局),无降采样/无 mipmap 依赖。
// 与 AutoExposurePass 协同:AutoExposure 先做全局曝光,LocalExposure 再做局部微调。
//
// 参考:
//   - o3de Atom, PostProcessing LocalExposurePass
//   - UE5 "Eye Adaptation" / "Local Exposure"
//   - Reinhard 2005 "Dynamic Range Reduction Inspired by Photographic Exposure"

import { LOCAL_EXPOSURE_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('LocalExposurePass');

export interface LocalExposureOptions {
  /** 曝光调整强度(0..2,默认 1.0,0=无效果,2=强烈调整)。 */
  strength?: number;
  /** 局部采样半径(1..4 texel,默认 2 → 5×5 邻域)。 */
  localRadius?: number;
  /** 全局采样半径(1..4,默认 2 → 5×5 邻域)。 */
  globalRadius?: number;
  /** 全局采样步长(texel 倍数,默认 8 → 全局范围 ±16 texel)。 */
  globalStride?: number;
  /** 最大曝光补偿(ln 域,默认 1.5 → e^1.5 ≈ 4.5x 提亮/压暗上限)。 */
  maxCompensation?: number;
  /** 细节保留率(0..1,默认 0.7,1=完全保留高频细节,0=细节也被曝光调整)。 */
  detailPreservation?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 局部曝光 Pass。在 HDR 颜色上应用对数空间的局部-全局亮度差异驱动曝光补偿。
 *
 * 解决 HDR 场景中"暗部看不清、亮部过曝"的问题:
 *   - 暗部区域(如阴影内)自动提亮,让细节可见
 *   - 亮部区域(如天空附近)自动压暗,避免过曝
 *   - 保留局部对比度(细节不被糊成一片)
 *
 * 与 AutoExposurePass 互补:AutoExposure 做全局曝光,LocalExposure 做局部微调。
 *
 * @example
 * ```ts
 * const localExposure = new LocalExposurePass({
 *   strength: 1.0,
 *   localRadius: 2,
 *   globalStride: 8,
 *   maxCompensation: 1.5,
 *   detailPreservation: 0.7,
 * });
 * // 每帧(在 AutoExposure 之后、Tonemapping 之前):
 * const adjusted = localExposure.apply(gl, hdrColorTexture);
 * ```
 */
export class LocalExposurePass {
  readonly name = 'localexposure';

  strength: number;
  localRadius: number;
  globalRadius: number;
  globalStride: number;
  maxCompensation: number;
  detailPreservation: number;
  enabled: boolean;

  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: LocalExposureOptions = {}) {
    this.strength = opts.strength ?? 1.0;
    this.localRadius = opts.localRadius ?? 2;
    this.globalRadius = opts.globalRadius ?? 2;
    this.globalStride = opts.globalStride ?? 8;
    this.maxCompensation = opts.maxCompensation ?? 1.5;
    this.detailPreservation = opts.detailPreservation ?? 0.7;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用局部曝光。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  HDR 场景颜色纹理(输入)
   * @returns             局部曝光调整后的颜色纹理(禁用时返回输入)
   */
  apply(gl: WebGL2RenderingContext, colorTexture: WebGLTexture): WebGLTexture {
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
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getProgram(gl);
    prog.use();

    // 颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 纹素大小
    prog.setUniform2f('u_texelSize', 1 / w, 1 / h);

    // 曝光参数
    prog.setUniform1f('u_strength', this.strength);
    prog.setUniform1i('u_localRadius', Math.max(1, Math.min(4, Math.floor(this.localRadius))));
    prog.setUniform1i('u_globalRadius', Math.max(1, Math.min(4, Math.floor(this.globalRadius))));
    prog.setUniform1f('u_globalStride', Math.max(1, this.globalStride));
    prog.setUniform1f('u_maxCompensation', this.maxCompensation);
    prog.setUniform1f('u_detailPreservation', this.detailPreservation);
    prog.setUniform1i('u_enabled', this.enabled ? 1 : 0);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

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

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 释放旧资源(分辨率变化时)
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
    }

    // 输出纹理(RGBA16F,与 HDR pipeline 一致)
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 全屏三角形 VAO(只创建一次)
    if (!this._fullscreenQuadVao) {
      this._fullscreenQuadBuf = gl.createBuffer();
      this._fullscreenQuadVao = gl.createVertexArray();
      gl.bindVertexArray(this._fullscreenQuadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
      const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }

    this._width = w;
    this._height = h;
    this._initialized = true;
    log.debug(`init: ${w}×${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT, LOCAL_EXPOSURE_FRAG);
    }
    return this._program;
  }
}
