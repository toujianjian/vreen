// Scene — the root of the scene graph. Holds background color, lights
// catalogue, and the environment. Subclass of Object3D so the same
// traversal/matrix logic applies.

import { Object3D } from './Object3D';

export interface SceneBackground {
  /** Solid color (CSS hex). Used when background is not an env map. */
  color: string;
}

export class Scene extends Object3D {
  override readonly type: string = 'Scene';
  background: SceneBackground = { color: '#000000' };
}
