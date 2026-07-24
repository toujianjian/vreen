// Scene — the root of the scene graph. Mirrors three.js: a Scene is an
// Object3D that additionally carries background / environment / fog /
// overrideMaterial, which the Renderer consults during the draw pass.

import { Object3D } from './Object3D';
import { Color } from '../Math/Color';
import { CubeTexture } from './CubeTexture';
import type { Fog } from './Fog';
import type { FogExp2 } from './FogExp2';
import type { Material } from './Material';

/** 场景背景:可以是纯色(Color / 十六进制字符串)或 null(透明,由 clearColor 决定)。 */
export type SceneBackground = Color | string | null;

export class Scene extends Object3D {
  override readonly type: string = 'Scene';
  isScene: boolean = true;

  /** 背景色/纹理。Color 或 '#rrggbb' 字符串;null 表示透明(交给 Renderer 的 clearColor)。 */
  background: SceneBackground = null;
  /** 环境贴图(IBL),用于所有 physical 材质。null 表示无环境光照。 */
  environment: CubeTexture | null = null;
  /** 场景雾。null 表示无雾。 */
  fog: Fog | FogExp2 | null = null;
  /** 强制场景内所有物体使用此材质渲染;null 表示用各自材质。 */
  overrideMaterial: Material | null = null;
}
