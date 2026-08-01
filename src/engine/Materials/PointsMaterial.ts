// PointsMaterial — 点云 / 点精灵材质,配合 {@link Points} 使用。
//
// 参考 three.js PointsMaterial。继承 BasicMaterial 基类,增加颜色、贴图、
// 点大小、sizeAttenuation、alphaMap 等属性。Renderer 走独立的 points
// shader path(GL_POINTS + gl_PointSize),与 MeshBasicMaterial 的 unlit
// 三角形路径平行。
//
// 约定:
//   - `color` 为线性 RGB(各通道 0..1),与 map 相乘
//   - `size` 为点大小(世界单位 when sizeAttenuation=true,像素 when false)
//   - `sizeAttenuation` 控制透视相机下是否近大远小(默认 true)
//   - `transparent` 默认 true(点云常带 alpha 通道,如粒子衰减)
//   - `map` 采样时使用 gl_PointCoord 作为 UV(0..1 覆盖单个点精灵)
//   - `alphaTest` 用于裁切点精灵边缘(如圆形粒子贴图),默认 0
//
// 不实现:vertexColors / fog / toneMapped(保持文件精简,可后续按需扩展)。

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface PointsMaterialOptions {
  color?: RGB;
  map?: Texture | null;
  alphaMap?: Texture | null;
  size?: number;
  sizeAttenuation?: boolean;
  opacity?: number;
  transparent?: boolean;
  alphaTest?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  wireframe?: boolean;
  renderOrder?: number;
}

/**
 * 点云材质 — 配合 {@link Points} 使用。
 *
 * ```ts
 * const mat = new PointsMaterial({
 *   color: { r: 0.2, g: 0.8, b: 1 },
 *   size: 0.15,
 *   sizeAttenuation: true,
 *   map: circleTexture,
 *   alphaTest: 0.5,
 * });
 * const points = new Points(geometry, mat);
 * scene.add(points);
 * ```
 */
export class PointsMaterial extends BasicMaterial {
  override readonly type: string = 'PointsMaterial';
  /** 类型标志,用于 instanceof 替代与跨子类 duck-type 检测。 */
  readonly isPointsMaterial: boolean = true;

  /** 漫反射颜色,与 map 相乘。线性 0..1,默认白。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 颜色贴图(可选)。采样时用 gl_PointCoord 作为 UV。 */
  map: Texture | null = null;
  /** Alpha 贴图(可选)。采样 .r 通道作为 alpha,与 opacity 相乘。 */
  alphaMap: Texture | null = null;
  /** 点大小。sizeAttenuation=true 时为世界单位,false 时为像素。默认 1。 */
  size: number = 1;
  /** 透视相机下是否近大远小。默认 true。 */
  sizeAttenuation: boolean = true;
  /** 透明度 0..1。仅当 transparent=true 时由 renderer 生效。 */
  opacity: number = 1;
  /** 是否透明(点云常带 alpha 通道,默认 true)。 */
  transparent: boolean = true;
  /** Alpha 测试阈值 0..1。片段 alpha < alphaTest 被丢弃。默认 0(禁用)。 */
  alphaTest: number = 0;

  constructor(opts: PointsMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.map !== undefined) this.map = opts.map;
    if (opts.alphaMap !== undefined) this.alphaMap = opts.alphaMap;
    if (opts.size !== undefined) this.size = opts.size;
    if (opts.sizeAttenuation !== undefined) this.sizeAttenuation = opts.sizeAttenuation;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.alphaTest !== undefined) this.alphaTest = opts.alphaTest;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.renderOrder !== undefined) this.renderOrder = opts.renderOrder;
  }

  /** 便捷构造:#rrggbb → 设置 color。 */
  static fromHex(hex: string): PointsMaterial {
    const m = new PointsMaterial();
    m.color = hexToRgb(hex);
    return m;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: PointsMaterial): this {
    this.color = { ...source.color };
    this.map = source.map;
    this.alphaMap = source.alphaMap;
    this.size = source.size;
    this.sizeAttenuation = source.sizeAttenuation;
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
  clone(): PointsMaterial {
    return new PointsMaterial().copy(this);
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
