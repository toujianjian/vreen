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
    this.bones = bones;
    this.boneInverses = boneInverses;
    this.boneMatrices = new Float32Array(Math.max(1, bones.length) * 16);
  }

  /**
   * Rebuild `boneMatrices` from the current world transforms of each
   * bone. Call once per frame after the skeleton has been posed.
   */
  computeBoneMatrices(): void {
    const n = this.bones.length;
    if (n === 0) {
      // No bones — keep a single identity matrix so the uniform array
      // is always a valid pointer.
      this.boneMatrices[0] = 1;
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
