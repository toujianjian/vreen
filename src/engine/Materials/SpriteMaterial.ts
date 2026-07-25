// SpriteMaterial — 精灵材质,用于 2D 始终面向相机的精灵渲染。
//
// 参考 three.js SpriteMaterial。继承 BasicMaterial 基类,增加颜色、贴图、
// 透明度、旋转、sizeAttenuation 等属性。Renderer 走独立的 sprite shader
// path(后续集成),与 MeshBasicMaterial 的 unlit 路径平行但顶点着色器
// 实现 billboard 朝向相机逻辑。
//
// 约定:
//   - `color` 为线性 RGB(各通道 0..1),与 map 相乘
//   - `rotation` 为绕精灵中心的旋转角度(弧度),在 shader 中应用
//   - `transparent` 默认 true(精灵通常带 alpha 通道)
//   - `sizeAttenuation` 控制透视相机下是否近大远小(默认 true)
//   - 不实现 alphaMap/fog(保持文件精简,可后续按需扩展)

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface SpriteMaterialOptions {
  color?: RGB;
  map?: Texture | null;
  opacity?: number;
  rotation?: number;
  transparent?: boolean;
  sizeAttenuation?: boolean;
  depthTest?: boolean;
  depthWrite?: boolean;
  wireframe?: boolean;
  renderOrder?: number;
}

/**
 * 精灵材质 — 配合 {@link Sprite} 使用。
 *
 * ```ts
 * const mat = new SpriteMaterial({ map: texture, color: { r: 1, g: 1, b: 1 } });
 * const sprite = new Sprite(mat);
 * scene.add(sprite);
 * ```
 */
export class SpriteMaterial extends BasicMaterial {
  override readonly type: string = 'SpriteMaterial';
  /** 类型标志,用于 instanceof 替代与跨子类 duck-type 检测。 */
  readonly isSpriteMaterial: boolean = true;

  /** 漫反射颜色,与 map 相乘。线性 0..1,默认白。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 颜色贴图(可选),与 color 相乘。 */
  map: Texture | null = null;
  /** 透明度 0..1。仅当 transparent=true 时由 renderer 生效。 */
  opacity: number = 1;
  /** 绕精灵中心的旋转角度(弧度)。在 shader / raycast 中应用。 */
  rotation: number = 0;
  /** 是否透明(精灵通常带 alpha 通道,默认 true)。 */
  transparent: boolean = true;
  /** 是否受相机距离影响(透视相机下的近大远小)。 */
  sizeAttenuation: boolean = true;

  constructor(opts: SpriteMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.map !== undefined) this.map = opts.map;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.rotation !== undefined) this.rotation = opts.rotation;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.sizeAttenuation !== undefined) this.sizeAttenuation = opts.sizeAttenuation;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.renderOrder !== undefined) this.renderOrder = opts.renderOrder;
  }

  /** 便捷构造:#rrggbb → 设置 color。 */
  static fromHex(hex: string): SpriteMaterial {
    const m = new SpriteMaterial();
    m.color = hexToRgb(hex);
    return m;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: SpriteMaterial): this {
    // BasicMaterial 没有 copy 方法,这里手动复制 Material 接口字段。
    this.color = { ...source.color };
    this.map = source.map;
    this.opacity = source.opacity;
    this.rotation = source.rotation;
    this.transparent = source.transparent;
    this.sizeAttenuation = source.sizeAttenuation;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): SpriteMaterial {
    return new SpriteMaterial().copy(this);
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
