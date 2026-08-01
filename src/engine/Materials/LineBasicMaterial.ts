// LineBasicMaterial — 线段材质,配合 Line / LineSegments / LineLoop 使用。
//
// 参考 three.js LineBasicMaterial。继承 BasicMaterial 基类,增加颜色、
// 贴图、线宽、虚线控制。Renderer 走独立的 line shader path
// (GL_LINES / GL_LINE_STRIP / GL_LINE_LOOP)。
//
// 约定:
//   - `color` 为线性 RGB(各通道 0..1),与 map 相乘
//   - `linewidth` 线宽(像素)。注意 WebGL 规范 linewidth>1 在多数桌面
//     实现中被钳为 1;需要粗线请用 Line2 + LineMaterial(屏幕空间四边形
//     扩展,后续模块)。这里保留字段以兼容 three.js API。
//   - `map` 采样时用顶点 uv(若几何体提供);lineDashedMaterial 风格的
//     虚线需配合 Line.computeLineDistances() 生成的 lineDistance 属性。
//   - `dashed` / `dashSize` / `gapSize` / `scale` 控制虚线模式(由
//     LineDashedMaterial 扩展,本类提供基础字段)。
//
// 不实现:fog / toneMapped / vertexColors(保持精简)。

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface LineBasicMaterialOptions {
  color?: RGB;
  map?: Texture | null;
  linewidth?: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
  scale?: number;
  opacity?: number;
  transparent?: boolean;
  alphaTest?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  wireframe?: boolean;
  renderOrder?: number;
}

/**
 * 线段材质 — 配合 Line / LineSegments / LineLoop 使用。
 *
 * ```ts
 * const mat = new LineBasicMaterial({
 *   color: { r: 0.2, g: 1, b: 0.8 },
 *   linewidth: 1,
 * });
 * const line = new LineSegments(geometry, mat);
 * scene.add(line);
 * ```
 */
export class LineBasicMaterial extends BasicMaterial {
  override readonly type: string = 'LineBasicMaterial';
  /** 类型标志,用于 instanceof 替代与跨子类 duck-type 检测。 */
  readonly isLineBasicMaterial: boolean = true;

  /** 漫反射颜色,与 map 相乘。线性 0..1,默认白。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 颜色贴图(可选)。采样时用顶点 uv。 */
  map: Texture | null = null;
  /** 线宽(像素)。WebGL 多数实现中 >1 被钳为 1。默认 1。 */
  linewidth: number = 1;
  /** 是否启用虚线模式。默认 false。 */
  dashed: boolean = false;
  /** 虚线段长度(世界单位 × scale)。默认 1。 */
  dashSize: number = 1;
  /** 虚线间隔长度(世界单位 × scale)。默认 1。 */
  gapSize: number = 1;
  /** 虚线缩放系数。默认 1。 */
  scale: number = 1;
  /** 透明度 0..1。仅当 transparent=true 时由 renderer 生效。 */
  opacity: number = 1;
  /** 是否透明。默认 false(线段通常不需要 alpha 混合)。 */
  transparent: boolean = false;
  /** Alpha 测试阈值 0..1。默认 0(禁用)。 */
  alphaTest: number = 0;

  constructor(opts: LineBasicMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.map !== undefined) this.map = opts.map;
    if (opts.linewidth !== undefined) this.linewidth = opts.linewidth;
    if (opts.dashed !== undefined) this.dashed = opts.dashed;
    if (opts.dashSize !== undefined) this.dashSize = opts.dashSize;
    if (opts.gapSize !== undefined) this.gapSize = opts.gapSize;
    if (opts.scale !== undefined) this.scale = opts.scale;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.alphaTest !== undefined) this.alphaTest = opts.alphaTest;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.renderOrder !== undefined) this.renderOrder = opts.renderOrder;
  }

  /** 便捷构造:#rrggbb → 设置 color。 */
  static fromHex(hex: string): LineBasicMaterial {
    const m = new LineBasicMaterial();
    m.color = hexToRgb(hex);
    return m;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: LineBasicMaterial): this {
    this.color = { ...source.color };
    this.map = source.map;
    this.linewidth = source.linewidth;
    this.dashed = source.dashed;
    this.dashSize = source.dashSize;
    this.gapSize = source.gapSize;
    this.scale = source.scale;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.alphaTest = source.alphaTest;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): LineBasicMaterial {
    return new LineBasicMaterial().copy(this);
  }
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}
