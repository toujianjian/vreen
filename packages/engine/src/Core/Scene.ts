// Scene — the root of the scene graph. Holds background color, lights
// catalogue, and the environment. Subclass of Object3D so the same
// traversal/matrix logic applies.

import { Object3D } from './Object3D';
import { Texture } from './Texture';

export interface SceneBackground {
  color: string;
  envMap?: Texture;
}

export class Scene extends Object3D {
  override readonly type: string = 'Scene';
  background: SceneBackground = { color: '#000000' };
}
