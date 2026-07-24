// IKBone — a single joint in an inverse-kinematics chain.
//
// Each bone stores a LOCAL transform relative to its parent:
//   • `position` — translational offset from the parent joint, expressed
//     in the parent's local frame (so it is rotated by the parent's
//     rotation when accumulated into world space).
//   • `rotation` — local rotation relative to the parent.
//
// `length` is the rest-pose distance from this joint to its child joint;
// FABRIK uses it to re-establish segment lengths after each reaching pass.
// The end-effector bone typically has `length = 0`.
//
// `constraints`, if set, restrict the local rotation to a hinge-like
// range: a single `axis` with an allowed angle interval [minAngle, maxAngle].
// `applyConstraints()` projects the current rotation onto that hinge and
// clamps the angle, returning true when clamping occurred.

import { Vector3 } from '../../Math/Vector3';
import { Quaternion } from '../../Math/Quaternion';

export interface JointConstraint {
  /** Minimum signed rotation angle (radians) around `axis`. */
  minAngle: number;
  /** Maximum signed rotation angle (radians) around `axis`. */
  maxAngle: number;
  /** The hinge axis in the parent's local frame. Need not be normalized;
   *  `applyConstraints` normalizes internally. */
  axis: Vector3;
}

/** Scratch vectors / quaternions reused across calls to avoid GC churn. */
const _v0 = new Vector3();
const _q0 = new Quaternion();
const _q1 = new Quaternion();
const _axisN = new Vector3();

export class IKBone {
  name: string;
  /** LOCAL position offset from the parent joint, in parent's local frame. */
  position: Vector3;
  /** LOCAL rotation relative to the parent. */
  rotation: Quaternion;
  /** Rest-pose distance to the child joint (0 for end-effector). */
  length: number;
  parent: IKBone | null = null;
  constraints: JointConstraint | null = null;

  constructor(
    name: string,
    position: Vector3 = new Vector3(),
    rotation: Quaternion = new Quaternion(),
    length = 0,
    parent: IKBone | null = null,
    constraints: JointConstraint | null = null,
  ) {
    this.name = name;
    this.position = position.clone();
    this.rotation = rotation.clone();
    this.length = length;
    this.parent = parent;
    this.constraints = constraints;
  }

  /** Recompute the world position by walking the parent chain.
   *  World position of bone = parent.worldPos + parent.worldRot * this.position.
   *  Writes into `target` (a fresh Vector3 if omitted) and returns it. */
  getWorldPosition(target: Vector3 = new Vector3()): Vector3 {
    if (this.parent) {
      this.parent.getWorldPosition(target);
      const parentRot = this.parent.getWorldRotation(_q0);
      // offset = parentRot * this.position. Use a CLONE so we don't clobber
      // any scratch the caller might be sharing with the recursive call.
      const offset = this.position.clone().applyQuaternion(parentRot);
      target.add(offset);
    } else {
      target.copy(this.position);
    }
    return target;
  }

  /** Recompute the world rotation by walking the parent chain.
   *  World rotation = parent.worldRot * this.rotation.
   *  Writes into `target` (a fresh Quaternion if omitted) and returns it. */
  getWorldRotation(target: Quaternion = new Quaternion()): Quaternion {
    if (this.parent) {
      this.parent.getWorldRotation(target);
      target.multiply(this.rotation);
    } else {
      target.copy(this.rotation);
    }
    return target;
  }

  /** Set the world position of this joint by updating `position` (local offset).
   *  Caller must ensure the parent's cached world transform is up to date. */
  setWorldPosition(worldPos: Vector3): void {
    if (this.parent) {
      const parentWorldPos = this.parent.getWorldPosition(_v0);
      const parentWorldRot = this.parent.getWorldRotation(_q0);
      // this.position = inverse(parentWorldRot) * (worldPos - parentWorldPos)
      const inv = _q1.copy(parentWorldRot).invert();
      const delta = parentWorldPos.clone().negate().add(worldPos);
      this.position.copy(delta).applyQuaternion(inv);
    } else {
      this.position.copy(worldPos);
    }
  }

  /** Set the world rotation by updating `rotation` (local rotation).
   *  Caller must ensure the parent's cached world rotation is up to date. */
  setWorldRotation(worldRot: Quaternion): void {
    if (this.parent) {
      const parentWorldRot = this.parent.getWorldRotation(_q0);
      // localRot = inverse(parentWorldRot) * worldRot
      const inv = _q1.copy(parentWorldRot).invert();
      this.rotation.copy(inv).multiply(worldRot);
    } else {
      this.rotation.copy(worldRot);
    }
  }

  /** Project the current local rotation onto the constraint hinge and clamp
   *  the angle to [minAngle, maxAngle]. Returns true if the rotation was
   *  modified (clamped or re-projected onto the axis).
   *
   *  The projection finds the signed angle that the current rotation turns
   *  around `axis`, then rebuilds the rotation as a pure axis rotation with
   *  the clamped angle. Off-axis components are discarded — this is the
   *  standard "hinge joint" behavior. */
  applyConstraints(): boolean {
    if (!this.constraints) return false;
    const { axis, minAngle, maxAngle } = this.constraints;
    _axisN.copy(axis).normalize();

    // For a rotation q = (sin(θ/2)*axis, cos(θ/2)), the signed angle around
    // the (unit) axis is θ = 2 * atan2(q.xyz · axis, q.w). If q contains
    // off-axis rotation, this still recovers the projected angle.
    const proj = this.rotation.x * _axisN.x + this.rotation.y * _axisN.y + this.rotation.z * _axisN.z;
    let angle = 2 * Math.atan2(proj, this.rotation.w);
    // Wrap to [-π, π]
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;

    const clamped = Math.max(minAngle, Math.min(maxAngle, angle));
    const half = clamped / 2;
    const s = Math.sin(half);
    const c = Math.cos(half);

    // Always rebuild — even if angle is unchanged, projecting onto the hinge
    // discards any off-axis component. We consider it "modified" only when
    // the angle was actually clamped OR the rotation had a non-axis component.
    const hadOffAxis =
      Math.abs(this.rotation.x - _axisN.x * s) > 1e-9 ||
      Math.abs(this.rotation.y - _axisN.y * s) > 1e-9 ||
      Math.abs(this.rotation.z - _axisN.z * s) > 1e-9 ||
      Math.abs(this.rotation.w - c) > 1e-9;

    this.rotation.x = _axisN.x * s;
    this.rotation.y = _axisN.y * s;
    this.rotation.z = _axisN.z * s;
    this.rotation.w = c;

    return hadOffAxis;
  }
}
