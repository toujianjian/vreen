// CCDSolver — Cyclic Coordinate Descent IK solver.
//
// Unlike FABRIK (position-space), CCD works in ROTATION space: the
// segment lengths and joint offsets stay fixed; only the bones' local
// rotations change. Each iteration sweeps from the joint closest to the
// end effector down to the root. At each joint:
//
//   1. Compute current world position of joint and end effector.
//   2. Compute the direction from joint to end effector (curDir).
//   3. Compute the direction from joint to target (tarDir).
//   4. Build a rotation `delta` that aligns curDir → tarDir
//      (shortest-arc quaternion via setFromUnitVectors).
//   5. Update the joint's WORLD rotation to delta * currentWorldRot,
//      then write it back to local via setWorldRotation().
//   6. If the joint has a `JointConstraint`, call applyConstraints()
//      immediately so the clamping takes effect before the next joint.
//
// Because each joint's rotation only affects the chain DOWNSTREAM of it
// (its children), and CCD iterates from the end toward the root, the
// downstream positions are already finalized when we rotate a given
// joint. This makes CCD naturally constraint-friendly: clamping joint[i]
// in step 6 is reflected in the end-effector error at the next iteration.
//
// POLE TARGET: CCD does not consume `chain.poleTarget`. Use FABRIK if you
// need explicit bend-direction control, or apply a post-solve twist
// around the root→target axis.

import { IKChain } from './IKChain';
import { IKBone } from './IKBone';
import { Vector3 } from '../../Math/Vector3';
import { Quaternion } from '../../Math/Quaternion';

// Scratch
const _jointPos = new Vector3();
const _endPos = new Vector3();
const _curDir = new Vector3();
const _tarDir = new Vector3();
const _worldRot = new Quaternion();
const _delta = new Quaternion();

export class CCDSolver {
  /** Default iteration count when `solve()` is called without an explicit value. */
  iterations: number;
  /** Convergence tolerance (distance from end effector to target). */
  tolerance: number;

  constructor(opts: { iterations?: number; tolerance?: number } = {}) {
    this.iterations = opts.iterations ?? 10;
    this.tolerance = opts.tolerance ?? 1e-4;
  }

  /** Solve a single chain via CCD.
   *  @param chain the IK chain to solve (its `target` is used; `poleTarget` is ignored)
   *  @param iterations overrides the solver's default
   *  @returns final distance from end effector to target */
  solve(chain: IKChain, iterations?: number): number {
    const bones = chain.bones;
    const n = bones.length;
    if (n < 2) return 0;
    const iters = iterations ?? this.iterations;
    const target = chain.target;

    let err = this._endEffectorError(bones, target);
    if (err <= this.tolerance) return err;

    for (let iter = 0; iter < iters && err > this.tolerance; iter++) {
      // Sweep from the joint closest to the end (n-2) down to the root (0).
      for (let i = n - 2; i >= 0; i--) {
        const joint = bones[i];
        joint.getWorldPosition(_jointPos);
        bones[n - 1].getWorldPosition(_endPos);

        // curDir = normalize(endPos - jointPos)
        _curDir.copy(_endPos).sub(_jointPos);
        const curLen = _curDir.length();
        if (curLen < 1e-12) continue;
        _curDir.multiplyScalar(1 / curLen);

        // tarDir = normalize(target - jointPos)
        _tarDir.copy(target).sub(_jointPos);
        const tarLen = _tarDir.length();
        if (tarLen < 1e-12) continue;
        _tarDir.multiplyScalar(1 / tarLen);

        // delta aligns curDir → tarDir
        _delta.setFromUnitVectors(_curDir, _tarDir);
        // Skip near-zero rotations: |w| ≈ 1 means rotation angle ≈ 0
        if (Math.abs(_delta.w) > 1 - 1e-12) continue;

        // New world rotation = delta * currentWorldRot
        joint.getWorldRotation(_worldRot);
        _worldRot.premultiply(_delta);
        joint.setWorldRotation(_worldRot);

        // Apply joint constraints immediately
        if (joint.constraints) joint.applyConstraints();
      }

      err = this._endEffectorError(bones, target);
    }

    return err;
  }

  /** Solve multiple chains (convenience — calls solve() on each). */
  solveAll(chains: IKChain[], iterations?: number): number {
    let worst = 0;
    for (const c of chains) {
      const e = this.solve(c, iterations);
      if (e > worst) worst = e;
    }
    return worst;
  }

  private _endEffectorError(bones: IKBone[], target: Vector3): number {
    return bones[bones.length - 1].getWorldPosition(_endPos).distanceTo(target);
  }
}
