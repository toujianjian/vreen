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

  /** 绑定骨骼到 mesh(three.js SkinnedMesh.bind 语义)。
   *  - 未提供 bindMatrix 时:先更新 world matrix,再让 skeleton 按当前
   *    骨骼 world matrix 重算绑定逆矩阵,并取 mesh 自身 matrixWorld 作为
   *    bindMatrix(attached 模式)。
   *  - 提供 bindMatrix 时:保持骨骼已有绑定逆矩阵不变(detached/复用场景)。
   *  随后缓存 bindMatrixInverse = bindMatrix⁻¹。 */
  bind(skeleton: Skeleton, bindMatrix?: Matrix4): void {
    this.skeleton = skeleton;
    if (bindMatrix === undefined) {
      this.updateMatrixWorld(true);
      skeleton.calculateInverses();
      bindMatrix = this.matrixWorld;
    }
    this.bindMatrix.copy(bindMatrix);
    this.bindMatrixInverse.copy(bindMatrix).invert();
  }

  /** 把骨骼恢复为绑定姿态,委托 Skeleton.pose(three.js SkinnedMesh.pose)。 */
  pose(): void {
    if (this.skeleton !== null) this.skeleton.pose();
  }

  /** 刷新骨骼矩阵并回写 boneMatrices(three.js SkinnedMesh.updateSkeleton)。
   *  渲染器在每帧绘制蒙皮 mesh 前调用,确保 u_boneMatrices 与当前骨骼
   *  world matrix 同步;skeleton 为 null 时静默返回(未绑定骨骼)。 */
  updateSkeleton(): void {
    if (this.skeleton !== null) this.skeleton.update();
  }

  /** 复制源 SkinnedMesh 到 this。在 Mesh.copy 之上复制 bindMode /
   *  bindMatrix / bindMatrixInverse / skeleton(共享骨骼,three.js 语义)。 */
  override copy(source: SkinnedMesh, recursive: boolean = true): this {
    super.copy(source, recursive);
    this.bindMode = source.bindMode;
    this.bindMatrix.copy(source.bindMatrix);
    this.bindMatrixInverse.copy(source.bindMatrixInverse);
    this.skeleton = source.skeleton;
    return this;
  }
}
