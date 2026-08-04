// LensDistortionPass — 镜头畸变后处理 Pass。
//
// 模拟真实相机镜头的几何畸变,提升画面"摄影感":
//   - 桶形畸变 (barrel, k1 > 0):画面边缘向外膨胀,类似广角/鱼眼
//   - 枕形畸变 (pincushion, k1 < 0):画面边缘向内收缩,类似长焦
//   - RGB 色差 (chromatic aberration):三通道用不同畸变系数,模拟镜头色散
//
// 算法 (Brown-Conrady 径向畸变模型,与 OpenCV / o3de Atom LensDistortion 对齐):
//   distort(uv) = center + (uv - center) * (1 + k1*r² + k2*r⁴) / scale
//   其中 r² = dot(uv - center, uv - center)
//
// 色差:R 通道畸变 +(ca),G 通道标准,B 通道畸变 -(ca),
// 模拟红光折射角小(畸变更强)、蓝光折射角大(畸变更弱)的物理现象。
//
// 性能:单 pass,无色差 1 次纹理采样,有色差 3 次采样。无降采样依赖。
// 适合在 Tonemapping 之后、最终输出之前应用。
//
// 参考:
//   - OpenCV calib3d: Brown-Conrady 模型
//   - o3de Atom: PostProcessing/LensDistortionPass
//   - UE5: Lens Distortion post-process material
//   - three.js: LensDistortionPlugin (示例着色器)

import { LENS_DISTORTION_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('LensDistortionPass');

/** 畸变中心 UV 坐标([0,1] 区间)。 */
export type PrincipalPoint = [x: number, y: number];

export interface LensDistortionOptions {
  /**
   * 畸变中心 UV(默认 [0.5, 0.5] = 画面正中)。
   * 偏移中心可模拟 off-axis 镜头或传感器装配误差。
   */
  principalPoint?: PrincipalPoint;
  /**
   * 一阶径向畸变系数 k1(默认 0.1)。
   * 正值 = 桶形畸变(广角),负值 = 枕形畸变(长焦),0 = 无畸变。
   */
  distortion?: number;
  /**
   * 二阶径向畸变系数 k2(默认 0)。
   * 用于在高畸变区域(边缘)细化曲线形状。
   */
  distortion2?: number;
  /**
   * 缩放补偿(默认 1.0)。
   * >1 放大采样范围避免畸变后边缘出现黑边;<1 缩小(会暴露更多黑边)。
   */
  scale?: number;
  /**
   * RGB 色差强度(默认 0)。
   * >0 启用三通道分离畸变,值越大色散越明显。
   */
  chromaticAberration?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 镜头畸变 Pass。在最终颜色上应用 Brown-Conrady 径向畸变 + RGB 色差。
 *
 * 让渲染画面带有真实镜头的几何失真特征,增强"被拍摄"的摄影质感。
 * 常与 FilmGrain / Vignette / ChromaticAberration 组合使用,模拟特定镜头性格。
 *
 * @example
 * ```ts
 * const lens = new LensDistortionPass({
 *   distortion: 0.15,        // 轻微桶形畸变
 *   chromaticAberration: 0.02, // 轻微色差
 *   scale: 1.05,             // 补偿黑边
 * });
 * // 每帧(Tonemapping 之后):
 * const distorted = lens.apply(gl, finalColorTexture);
 * ```
 */
export class LensDistortionPass {
  readonly name = 'lensdistortion';

  principalPoint: PrincipalPoint;
  distortion: number;
  distortion2: number;
  scale: number;
  chromaticAberration: number;
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

  constructor(opts: LensDistortionOptions = {}) {
    this.principalPoint = opts.principalPoint ?? [0.5, 0.5];
    this.distortion = opts.distortion ?? 0.1;
    this.distortion2 = opts.distortion2 ?? 0;
    this.scale = opts.scale ?? 1.0;
    this.chromaticAberration = opts.chromaticAberration ?? 0;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用镜头畸变。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  输入颜色纹理(通常为 Tonemapping 后的 LDR)
   * @returns             畸变后的颜色纹理(禁用时返回输入)
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

    // 畸变参数
    prog.setUniform2f('u_principalPoint', this.principalPoint[0], this.principalPoint[1]);
    prog.setUniform1f('u_distortion', this.distortion);
    prog.setUniform1f('u_distortion2', this.distortion2);
    prog.setUniform1f('u_scale', this.scale);
    prog.setUniform1f('u_chromaticAberration', this.chromaticAberration);
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

    // 输出纹理(默认 LDR pipeline,RGBA8;若上游为 HDR 可改 RGBA16F)
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
      this._program = new ShaderProgram(gl, POST_VERT, LENS_DISTORTION_FRAG);
    }
    return this._program;
  }
}
