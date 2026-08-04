// PaniniProjectionPass — Panini 宽 FOV 圆柱投影后处理 Pass。
//
// Panini 投影是一种圆柱投影,在保持垂直线垂直的同时允许更宽的水平视场,
// 不会产生普通透视投影在广角下的"边缘拉伸"失真。适用于:
//   - 建筑可视化(保持垂直线垂直,符合人眼感知)
//   - 全景 / 超宽 FOV 渲染(无边缘拉伸)
//   - 电影广角镜头模拟(带有"被压缩"的纵深感)
//   - VR 宽 FOV 畸变补偿
//
// 算法(基于 Sharpless et al. "Panini" 投影论文,与 o3de Atom PaniniProjectionPass 对齐):
//   1. uv = (pixel - center) / center         // 转中心化 UV
//   2. ol = 1 / sqrt(2 - uv.x²)               // 互补 uv.x²
//   3. pspl = (d + 1) / (d + ol)              // 缩放比
//   4. coords.x = uv.x * (ol * pspl)          // 水平投影
//   5. coords = coords / crop * center + center  // 缩放补偿 + 映射回 [0,1]
//
// depth (d) 参数控制投影强度:
//   d = 0:   接近普通透视投影
//   d = 1.0: 标准 Panini 投影(默认,o3de 推荐值)
//   d > 1:   更强的圆柱投影效果,适合超宽 FOV
//
// 性能:单 pass,1 次纹理采样。无降采样依赖。
// 适合在 Tonemapping 之后、最终输出之前应用。
//
// 参考:
//   - Sharpless et al., "Pannini: A New Projection for Rendering Paintings"
//     http://tksharpless.net/vedutismo/Pannini/panini.pdf
//   - o3de Atom: PostProcessing/PaniniProjectionPass
//   - UE5: Panini Projection post-process material

import { PANINI_PROJECTION_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('PaniniProjectionPass');

/** 投影中心 UV 坐标([0,1] 区间)。 */
export type ProjectionCenter = [x: number, y: number];

export interface PaniniProjectionOptions {
  /**
   * 投影中心 UV(默认 [0.5, 0.5] = 画面正中)。
   * 偏移中心可模拟 off-axis 投影或传感器装配误差。
   */
  center?: ProjectionCenter;
  /**
   * 投影深度参数 d(默认 1.0,o3de 推荐值)。
   * 0 = 接近普通透视,1 = 标准 Panini,>1 = 更强圆柱投影。
   */
  depth?: number;
  /**
   * 是否对 Y 轴也应用 Panini 投影(默认 false)。
   * false = 仅水平投影(标准 Panini,保持垂直线垂直)。
   * true = 水平+垂直投影(适用于全景 / 360° 渲染)。
   */
  vertical?: boolean;
  /**
   * 裁剪补偿(默认 1.0)。
   * >1 放大采样范围避免投影后边缘出现黑边;<1 缩小(暴露更多黑边)。
   */
  crop?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * Panini 投影的核心数学(CPU 纯函数,与 GLSL `PANINI_PROJECTION_FRAG` 1:1 对应)。
 *
 * 给定一个输出像素的 UV 坐标(0..1),计算应该从输入纹理的哪个 UV 采样。
 * 禁用时返回输入 uv(恒等映射)。
 *
 * @param uv       输出像素 UV([0,1] 区间)
 * @param center   投影中心 UV(默认 [0.5, 0.5])
 * @param depth    投影深度 d(默认 1.0)
 * @param vertical 是否对 Y 轴也投影(默认 false)
 * @param crop     裁剪补偿(默认 1.0)
 * @returns        输入纹理采样 UV;`inside` 标记是否在 [0,1] 范围内
 */
export function paniniProject(
  uv: [number, number] | { x: number; y: number } | { 0: number; 1: number },
  center: ProjectionCenter = [0.5, 0.5],
  depth: number = 1.0,
  vertical: boolean = false,
  crop: number = 1.0,
): { x: number; y: number; inside: boolean } {
  // 兼容 [x, y] 元组与 {x, y} 对象两种形式
  const uvx = Array.isArray(uv) ? uv[0] : (uv as { x: number }).x;
  const uvy = Array.isArray(uv) ? uv[1] : (uv as { y: number }).y;
  const ux = (uvx - center[0]) / center[0];
  const uy = (uvy - center[1]) / center[1];

  // 水平 Panini 投影
  // ol = 1 / sqrt(2 - ux²) — 互补 ux² 用于裁剪控制
  const ol_x = 1.0 / Math.sqrt(2.0 - ux * ux);
  const pspl_x = (depth + 1.0) / (depth + ol_x);
  let coordsX = ux * (ol_x * pspl_x);

  // 垂直投影(可选)
  let coordsY = uy;
  if (vertical) {
    const ol_y = 1.0 / Math.sqrt(2.0 - uy * uy);
    const pspl_y = (depth + 1.0) / (depth + ol_y);
    coordsY = uy * (ol_y * pspl_y);
  }

  // 缩放补偿 + 映射回 [0,1] UV 空间
  coordsX = coordsX / crop;
  coordsY = coordsY / crop;
  const outX = coordsX * center[0] + center[0];
  const outY = coordsY * center[1] + center[1];

  const inside = outX >= 0.0 && outX <= 1.0 && outY >= 0.0 && outY <= 1.0;
  return { x: outX, y: outY, inside };
}

/**
 * Panini 投影 Pass。在最终颜色上应用 Panini 圆柱投影。
 *
 * 让广角渲染画面保持垂直线垂直,消除边缘拉伸,增强"被压缩"的纵深感。
 * 常用于建筑可视化、全景渲染、电影广角镜头模拟。
 *
 * @example
 * ```ts
 * const panini = new PaniniProjectionPass({
 *   depth: 1.0,        // 标准 Panini 投影
 *   vertical: false,   // 仅水平(保持垂直线垂直)
 *   crop: 1.1,         // 轻微放大避免黑边
 * });
 * // 每帧(Tonemapping 之后):
 * const projected = panini.apply(gl, finalColorTexture);
 * ```
 */
export class PaniniProjectionPass {
  readonly name = 'paniniprojection';

  center: ProjectionCenter;
  depth: number;
  vertical: boolean;
  crop: number;
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

  constructor(opts: PaniniProjectionOptions = {}) {
    this.center = opts.center ?? [0.5, 0.5];
    this.depth = opts.depth ?? 1.0;
    this.vertical = opts.vertical ?? false;
    this.crop = opts.crop ?? 1.0;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用 Panini 投影。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  输入颜色纹理(通常为 Tonemapping 后的 LDR)
   * @returns             投影后的颜色纹理(禁用时返回输入)
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

    // 投影参数
    prog.setUniform2f('u_center', this.center[0], this.center[1]);
    prog.setUniform1f('u_depth', this.depth);
    prog.setUniform1i('u_vertical', this.vertical ? 1 : 0);
    prog.setUniform1f('u_crop', this.crop);

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
      this._program = new ShaderProgram(gl, POST_VERT, PANINI_PROJECTION_FRAG);
    }
    return this._program;
  }
}
