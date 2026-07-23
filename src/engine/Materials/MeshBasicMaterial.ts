// MeshBasicMaterial — 不受光照影响的材质(纯色/贴图)。
//
// 参考 three.js MeshBasicMaterial。继承 BasicMaterial 基类,增加颜色、
// 贴图、透明度等属性。Renderer 走独立的 unlit shader path(后续集成)。
//
// 注意:Core/Material.ts 中的 BasicMaterial 是最小基类(供 ShaderMaterial
// 等继承);本类是 three.js 风格的"无光照"材质,二者概念不同,故保留
// Mesh* 前缀避免命名冲突。

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface MeshBasicMaterialOptions {
  color?: RGB;
  map?: Texture | null;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;
  depthTest?: boolean;
  depthWrite?: boolean;
}

export class MeshBasicMaterial extends BasicMaterial {
  override readonly type: string = 'MeshBasic';

  /** 漫反射颜色,与 map 相乘。线性 0..1,默认白。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 颜色贴图(可选),与 color 相乘。 */
  map: Texture | null = null;
  /** 透明度 0..1。仅当 transparent=true 时由 renderer 生效。 */
  opacity: number = 1;
  /** 是否透明(影响渲染队列与混合)。 */
  transparent: boolean = false;

  constructor(opts: MeshBasicMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.map !== undefined) this.map = opts.map;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
  }

  /** 便捷构造:#rrggbb → 设置 color。 */
  static fromHex(hex: string): MeshBasicMaterial {
    const m = new MeshBasicMaterial();
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
