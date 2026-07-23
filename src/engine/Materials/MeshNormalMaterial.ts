// NormalMaterial — 用法线作为颜色的材质(调试用)。
//
// 参考 three.js MeshNormalMaterial。继承 BasicMaterial,属性精简:
// flatShading 控制是否用面法线,wireframe 继承自基类。Renderer 走
// normal-debug shader path(后续集成)。不受光照影响。

import { BasicMaterial } from '../Core/Material';

export interface NormalMaterialOptions {
  flatShading?: boolean;
  wireframe?: boolean;
  depthTest?: boolean;
  depthWrite?: boolean;
  transparent?: boolean;
  opacity?: number;
}

export class NormalMaterial extends BasicMaterial {
  override readonly type: string = 'Normal';

  /** 是否使用平面着色(面法线)。默认 false(平滑法线)。 */
  flatShading: boolean = false;
  /** 透明度 0..1。默认 1。 */
  opacity: number = 1;
  /** 是否透明。默认 false。 */
  transparent: boolean = false;

  constructor(opts: NormalMaterialOptions = {}) {
    super();
    if (opts.flatShading !== undefined) this.flatShading = opts.flatShading;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
  }
}
