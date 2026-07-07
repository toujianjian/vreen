// Mesh — the only drawable node in our minimal scene graph for now.
// Holds a BufferGeometry + Material (or array of materials when groups
// are in use). Extends Object3D so the same traversal/transform logic
// applies.

import { Object3D } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import type { Material } from './Material';

export class Mesh extends Object3D {
  override readonly type: string = 'Mesh';
  geometry: BufferGeometry;
  material: Material | Material[];

  /** Convenience flag — many loaders (glTF/OBJ) set this. */
  isMesh: boolean = true;
  castShadow: boolean = true;
  receiveShadow: boolean = true;

  constructor(geometry: BufferGeometry, material: Material | Material[]) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}
