// Skeleton — an ordered list of bones, plus their inverse bind matrices.
// The renderer packs `boneMatrices[i] = currentWorld[i] * inverseBind[i]`
// into a uniform array; the vertex shader uses these to skin positions.

import { Bone } from './Bone';
import { Matrix4 } from '../Math';

export class Skeleton {
  /** Bones in the order they appear in the GPU bone-matrix array. */
  bones: Bone[] = [];
  /** Inverse of each bone's world matrix at bind time. */
  boneInverses: Matrix4[] = [];

  /** Cached, packed array (Float32Array of 16 floats per bone) — refreshed by computeBoneMatrices(). */
  boneMatrices: Float32Array;
  /** True when computeBoneMatrices has been called at least once. */
  private _init = false;

  constructor(bones: Bone[] = [], boneInverses: Matrix4[] = []) {
    // three.js 语义:直接持有调用方数组引用(不防御拷贝),使 clone 共享 bones 数组。
    this.bones = bones;
    this.boneInverses = boneInverses;
    this.boneMatrices = new Float32Array(Math.max(1, bones.length) * 16);
    // three.js Skeleton 语义:未提供 boneInverses 时按当前骨骼 world matrix
    // 自动计算绑定逆矩阵(需调用方先 updateMatrixWorld 保证 matrixWorld 最新)。
    // 同时修复空 inverses 时 computeBoneMatrices 产生 NaN 的隐患。
    if (bones.length === 0) return;
    if (boneInverses.length === 0) {
      this.calculateInverses();
    }
  }

  /** 按各骨骼当前 matrixWorld 计算绑定逆矩阵(three.js Skeleton.calculateInverses)。 */
  calculateInverses(): void {
    this.boneInverses = this.bones.map(
      (bone) => new Matrix4().copy(bone.matrixWorld).invert(),
    );
  }

  /** 把骨骼恢复为绑定姿态(three.js Skeleton.pose 两遍算法)。
   *  第一遍恢复每个骨骼的绑定 matrixWorld;第二遍按父级骨骼重算本地
   *  matrix 并 decompose 回 position/rotation/scale(供编辑器重置姿态)。
   *  与 SkinnedMesh.pose 配合使用。 */
  pose(): void {
    const bones = this.bones;
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      // 绑定姿态的 matrixWorld = inverse(boneInverse)
      bone.matrixWorld.copy(this.boneInverses[i]).invert();
    }
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const parent = bone.parent;
      if (parent !== null && (parent as Bone).isBone === true) {
        bone.matrix.copy(parent.matrixWorld).invert();
        bone.matrix.multiply(bone.matrixWorld);
      } else {
        bone.matrix.copy(bone.matrixWorld);
      }
      // VREEN 的 Object3D 用 `rotation` 字段承载四元数(three.js 用 `quaternion`)。
      bone.matrix.decompose(bone.position, bone.rotation, bone.scale);
    }
  }

  /** 返回骨骼浅拷贝的新 Skeleton(共享 bones/boneInverses 数组引用,
   *  three.js Skeleton.clone 语义)。 */
  clone(): Skeleton {
    return new Skeleton(this.bones, this.boneInverses);
  }

  /** Rebuild `boneMatrices` from the current world transforms of each
   *  bone. Call once per frame after the skeleton has been posed.
   *  three.js 兼容别名:update() = computeBoneMatrices()。 */
  update(): void {
    this.computeBoneMatrices();
  }

  /**
   * Rebuild `boneMatrices` from the current world transforms of each
   * bone. Call once per frame after the skeleton has been posed.
   */
  computeBoneMatrices(): void {
    const n = this.bones.length;
    if (n === 0) {
      // No bones — keep a single identity matrix so the uniform array
      // is always a valid pointer(对角线全 1)。
      this.boneMatrices[0] = 1;
      this.boneMatrices[5] = 1;
      this.boneMatrices[10] = 1;
      this.boneMatrices[15] = 1;
      return;
    }
    if (!this._init) {
      this.boneMatrices = new Float32Array(n * 16);
      this._init = true;
    }
    for (let i = 0; i < n; i++) {
      const bone = this.bones[i];
      const inv = this.boneInverses[i];
      // boneMatrices[i] = bone.matrixWorld * inv
      const out = new Matrix4();
      out.multiplyMatrices(bone.matrixWorld, inv);
      this.boneMatrices.set(out.elements, i * 16);
    }
  }
}
