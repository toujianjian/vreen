// SkinnedMesh — Mesh whose vertices are deformed on the GPU by a
// Skeleton's bone matrices. Requires the `skinning=true` shader variant.
//
// Two extra vertex attributes per vertex:
//   - skinIndex:  vec4 — four bone indices (stored as float; the shader
//                 does `int(a_skinIndex.x)` to recover the integer).
//   - skinWeight: vec4 — four weights (sum to 1).
//
// `bindMatrix` and `bindMatrixInverse` mirror the world transform of
// the SkinnedMesh at the time the model was bound to the skeleton.
// `bindMatrixInverse` is applied in the shader before skinning.

import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { Bone } from './Bone';
import { Skeleton } from './Skeleton';
import { Matrix4 } from '../Math';
import type { Material } from './Material';

export class SkinnedMesh extends Mesh {
  override readonly type: string = 'SkinnedMesh';
  isSkinnedMesh: boolean = true;
  bindMode: 'attached' | 'detached' = 'attached';
  /** World transform of the SkinnedMesh at bind time. */
  bindMatrix: Matrix4 = new Matrix4().identity();
  /** Inverse of bindMatrix. */
  bindMatrixInverse: Matrix4 = new Matrix4().identity();
  skeleton: Skeleton | null = null;

  constructor(geometry: BufferGeometry, material: Material | Material[]) {
    super(geometry, material);
  }

  /** Add a bone + its inverse bind matrix. Must match the number of
   *  entries in the `skinIndex` attribute. */
  addBone(bone: Bone, inverseBind: Matrix4): this {
    if (!this.skeleton) this.skeleton = new Skeleton();
    this.skeleton.bones.push(bone);
    this.skeleton.boneInverses.push(inverseBind);
    return this;
  }

  /** Rebuild the skeleton's packed matrix array. Call after posing. */
  updateSkeleton(): void {
    this.skeleton?.computeBoneMatrices();
  }
}
