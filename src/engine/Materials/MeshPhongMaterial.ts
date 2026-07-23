// PhongMaterial — 经典 Blinn-Phong 光照模型(非 PBR)。
//
// 参考 three.js MeshPhongMaterial。继承 BasicMaterial,提供 color、
// specular、shininess、emissive、map 等属性。Renderer 走 Phong shader
// path(后续集成)。性能优于 PBR,精度略低。

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface PhongMaterialOptions {
  color?: RGB;
  specular?: RGB;
  shininess?: number;
  emissive?: RGB;
  emissiveIntensity?: number;
  map?: Texture | null;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;
  flatShading?: boolean;
}

export class PhongMaterial extends BasicMaterial {
  override readonly type: string = 'Phong';

  /** 漫反射颜色。线性 0..1,默认白。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 镜面反射颜色。默认 0x111111(深灰)。 */
  specular: RGB = { r: 17 / 255, g: 17 / 255, b: 17 / 255 };
  /** 高光锐度,越大高光越集中。默认 30。 */
  shininess: number = 30;
  /** 自发光颜色。默认黑(不发光)。 */
  emissive: RGB = { r: 0, g: 0, b: 0 };
  /** 自发光强度,调制 emissive。默认 1。 */
  emissiveIntensity: number = 1;
  /** 漫反射贴图。 */
  map: Texture | null = null;
  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 是否透明。 */
  transparent: boolean = false;
  /** 是否平面着色(面法线)。默认 false。 */
  flatShading: boolean = false;

  constructor(opts: PhongMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.specular) this.specular = { ...opts.specular };
    if (opts.shininess !== undefined) this.shininess = opts.shininess;
    if (opts.emissive) this.emissive = { ...opts.emissive };
    if (opts.emissiveIntensity !== undefined) this.emissiveIntensity = opts.emissiveIntensity;
    if (opts.map !== undefined) this.map = opts.map;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.flatShading !== undefined) this.flatShading = opts.flatShading;
  }

  /** 便捷构造:#rrggbb → 设置 color。 */
  static fromHex(hex: string): PhongMaterial {
    const m = new PhongMaterial();
    m.color = hexToRgb(hex);
    return m;
  }
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}
