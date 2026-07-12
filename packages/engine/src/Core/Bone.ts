// Bone — a node in a Skeleton. Identical to Object3D in terms of
// transform storage; the `isBone` flag lets the Outliner / Renderer
// special-case it.

import { Object3D } from './Object3D';

export class Bone extends Object3D {
  override readonly type: string = 'Bone';
  isBone: boolean = true;
}
