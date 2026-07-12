// Group — a non-drawable container for child Object3Ds. Behaves exactly
// like a plain Object3D except it's typed, so Outliner / Inspector can
// quickly distinguish it from Mesh / Light.

import { Object3D } from './Object3D';

export class Group extends Object3D {
  override readonly type: string = 'Group';
  isGroup: boolean = true;
}
