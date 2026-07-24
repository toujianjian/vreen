// IKChain — a chain of IKBones solved by FABRIK.
//
// FABRIK (Forward And Backward Reaching Inverse Kinematics) is a
// position-space IK algorithm. Each iteration performs two passes:
//
//   1. BACKWARD PASS — pin the end effector to the target, then walk
//      from the end toward the root. For each joint i, reposition it on
//      the line through joint[i+1] such that |joint[i] - joint[i+1]|
//      equals the rest segment length.
//
//   2. FORWARD PASS — pin the root to its original (pre-solve) position,
//      then walk from the root toward the end. For each joint i, place
//      it on the line through joint[i-1] at the rest segment distance.
//
// Iterating these two passes converges quickly. Convergence is checked
// against `tolerance` (distance from end effector to target).
//
// POLE TARGET (optional): after each iteration the chain is bent toward
// the pole while preserving how far along the root→end axis each joint
// sits. A short forward pass then re-establishes segment lengths. This
// resolves the ambiguity of which way a multi-bone chain should bend.
//
// CONSTRAINTS: after the final iteration, `applyConstraints()` is called
// on each bone that has a `JointConstraint`. Because FABRIK works on
// positions and the constraints act on local rotation, this pass only
// touches the rotations, not the solved positions — it is cosmetic with
// respect to the chain shape. For hard rotational constraints during
// solving, use `CCDSolver` instead.

import { IKBone } from './IKBone';
import { Vector3 } from '../../Math/Vector3';

export interface IKChainOptions {
  /** Default per-solve iteration count (default 10). */
  iterations?: number;
  /** Convergence tolerance in world units (default 1e-4). */
  tolerance?: number;
}

// Scratch
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

export class IKChain {
  bones: IKBone[] = [];
  /** World-space target for the end effector (last bone). */
  target: Vector3 = new Vector3();
  /** Optional pole target: a position the chain should bend toward. */
  poleTarget: Vector3 | null = null;
  iterations: number;
  tolerance: number;

  /** Working world positions, refreshed at the start of each solve(). */
  private _world: Vector3[] = [];
  /** Rest segment lengths: lengths[i] = distance from bone[i] to bone[i+1]. */
  private _lengths: number[] = [];
  /** Sum of all segment lengths. */
  private _totalLength = 0;

  constructor(opts: IKChainOptions = {}) {
    this.iterations = opts.iterations ?? 10;
    this.tolerance = opts.tolerance ?? 1e-4;
  }

  /** Append a bone to the end of the chain. The bone's `parent` is wired
   *  to the previous tail (or null for the first bone). */
  addBone(bone: IKBone): this {
    if (this.bones.length > 0) {
      bone.parent = this.bones[this.bones.length - 1];
    }
    this.bones.push(bone);
    return this;
  }

  /** Number of bones in the chain. */
  get size(): number {
    return this.bones.length;
  }

  /** Refresh the working arrays from the current bone transforms. */
  private _refreshCache(): void {
    const n = this.bones.length;
    this._world = new Array(n);
    this._lengths = new Array(n);
    this._totalLength = 0;
    for (let i = 0; i < n; i++) {
      this._world[i] = this.bones[i].getWorldPosition(new Vector3());
    }
    for (let i = 0; i < n - 1; i++) {
      const d = this._world[i].distanceTo(this._world[i + 1]);
      this._lengths[i] = d;
      this._totalLength += d;
    }
    this._lengths[n - 1] = 0;
  }

  /** Solve IK using FABRIK.
   *  @param iterations overrides the chain's default iteration count.
   *  @returns final distance from end effector to target. */
  solve(iterations?: number): number {
    const n = this.bones.length;
    if (n < 2) return 0;
    const iters = iterations ?? this.iterations;
    this._refreshCache();

    const rootOrig = this._world[0].clone();
    const target = this.target;
    const totalLen = this._totalLength;

    // Unreachable target: stretch straight toward it.
    const rootToTarget = _v0.copy(target).sub(rootOrig);
    const dist = rootToTarget.length();
    if (dist > totalLen + 1e-9) {
      const dir = rootToTarget.normalize();
      for (let i = 0; i < n - 1; i++) {
        this._world[i + 1].copy(this._world[i]).addScaledVector(dir, this._lengths[i]);
      }
      this._commitPositions();
      return Math.abs(dist - totalLen);
    }

    let err = this._world[n - 1].distanceTo(target);
    for (let iter = 0; iter < iters && err > this.tolerance; iter++) {
      // Backward: end → root
      this._world[n - 1].copy(target);
      for (let i = n - 2; i >= 0; i--) {
        const dir = _v1.copy(this._world[i + 1]).sub(this._world[i]).normalize();
        // Place bone[i] on the line through bone[i+1] at distance lengths[i]
        this._world[i].copy(this._world[i + 1]).addScaledVector(dir, -this._lengths[i]);
      }
      // Forward: root → end
      this._world[0].copy(rootOrig);
      for (let i = 1; i < n; i++) {
        const dir = _v2.copy(this._world[i]).sub(this._world[i - 1]).normalize();
        this._world[i].copy(this._world[i - 1]).addScaledVector(dir, this._lengths[i - 1]);
      }
      if (this.poleTarget) this._applyPole(rootOrig);
      err = this._world[n - 1].distanceTo(target);
    }

    this._commitPositions();
    this._applyConstraintsPass();
    return this._world[n - 1].distanceTo(target);
  }

  /** Bend middle joints toward the pole while preserving the chain's
   *  root→end axis projection, then re-establish segment lengths. */
  private _applyPole(rootOrig: Vector3): void {
    const n = this.bones.length;
    if (n < 3 || !this.poleTarget) return;

    const end = this._world[n - 1];
    // Chain direction (root → end), unit
    const chainDir = _v1.copy(end).sub(rootOrig);
    const chainLen = chainDir.length();
    if (chainLen < 1e-9) return;
    chainDir.multiplyScalar(1 / chainLen);

    // Pole vector perpendicular to chainDir, pointing toward poleTarget
    const poleVec = _v2.copy(this.poleTarget).sub(rootOrig);
    const along = poleVec.dot(chainDir);
    poleVec.addScaledVector(chainDir, -along); // remove component along chainDir
    if (poleVec.lengthSq() < 1e-18) return; // pole is on the chain axis — no bend
    poleVec.normalize();

    // For each middle joint, replace its perpendicular component with the
    // pole direction (preserving its projection along the chain axis).
    for (let i = 1; i < n - 1; i++) {
      const rj = _v3.copy(this._world[i]).sub(rootOrig);
      const a = rj.dot(chainDir);
      const perp = _v0.copy(rj).addScaledVector(chainDir, -a);
      const perpLen = perp.length();
      this._world[i].copy(rootOrig).addScaledVector(chainDir, a).addScaledVector(poleVec, perpLen);
    }

    // Re-establish segment lengths via a forward pass (root pinned)
    this._world[0].copy(rootOrig);
    for (let i = 1; i < n; i++) {
      const dir = _v1.copy(this._world[i]).sub(this._world[i - 1]);
      const dl = dir.length();
      if (dl < 1e-12) continue;
      dir.multiplyScalar(1 / dl);
      this._world[i].copy(this._world[i - 1]).addScaledVector(dir, this._lengths[i - 1]);
    }
  }

  /** Write the solved world positions back to the bones' local positions. */
  private _commitPositions(): void {
    const n = this.bones.length;
    // Parents must be committed before children so setWorldPosition can
    // read an up-to-date parent world transform. The chain is in order
    // root → end, so iterating front-to-back is correct.
    for (let i = 0; i < n; i++) {
      this.bones[i].setWorldPosition(this._world[i]);
    }
  }

  /** Call applyConstraints() on each bone that has a constraint. */
  private _applyConstraintsPass(): void {
    for (const bone of this.bones) {
      if (bone.constraints) bone.applyConstraints();
    }
  }
}
