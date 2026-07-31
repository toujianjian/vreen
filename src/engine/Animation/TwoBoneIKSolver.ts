// TwoBoneIKSolver — solve a two-bone IK chain (root → mid → target) so the
// end effector reaches a target position. This is the workhorse IK pattern
// used in Unreal Engine, Godot, and o3de EMotionFX for arms and legs.
//
// Algorithm:
//   1. Compute the two bone lengths (len1 = |mid - root|, len2 = |end - mid|).
//   2. Clamp the target to the reachable sphere (radius = len1 + len2).
//   3. Use the law of cosines to find the elbow ("mid") angle:
//        cosA = (len1² + d² - len2²) / (2·len1·d)
//      where d = |target - root|. The mid joint is placed on the circle
//      around (root→target) at angle A, biased toward the pole vector.
//   4. Orient root bone to point at the (clamped) target.
//   5. Orient mid bone to point at the end effector position.
//
// Pole vector (hint direction): disambiguates which way the elbow/knee
// bends. Commonly set to the world up, or a dedicated pole target.
//
// This solver works on abstract {position, quaternion} triplets and does
// NOT touch Object3D / scene graph. It is intentionally pure so it can be
// composed into ProceduralAnimation, AnimationMixer post-solve, or ECS.

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

export interface TwoBoneIKInput {
  /** Root joint world position (e.g. shoulder / hip). */
  rootPos: Vector3;
  /** Mid joint world position (e.g. elbow / knee). */
  midPos: Vector3;
  /** End effector world position (e.g. hand / foot) — the chain's current tip. */
  endPos: Vector3;
  /** Desired target world position for the end effector. */
  targetPos: Vector3;
  /** Optional pole / hint position — the mid joint is biased toward this.
   *  If omitted, falls back to the current midPos direction. */
  polePos?: Vector3;
  /** Softness: 0 = hard clamp to reachable sphere, >0 = smooth falloff
   *  near the limit. Helps avoid sudden pops. Default 0. */
  softness?: number;
  /** Weight: 0 = no IK (return identities), 1 = full IK. Default 1. */
  weight?: number;
}

export interface TwoBoneIKOutput {
  /** New root rotation (world-space) that points root→midNew. */
  rootQuat: Quaternion;
  /** New mid rotation (world-space) that points mid→endNew. */
  midQuat: Quaternion;
  /** Computed mid position (where the elbow/knee ends up). */
  midPos: Vector3;
  /** Computed end position (= clamped target). */
  endPos: Vector3;
}

// scratch
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _vUp = new Vector3();
const _vFwd = new Vector3();
const _vRight = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _qId = new Quaternion(0, 0, 0, 1);

/** 返回从 from 方向旋转到 to 方向的四元数(最短弧)。
 *  使用 Melax 公式:q = (cross(from,to), 1+dot) 然后归一化。
 *  对单位向量,这给出 axis*sin(θ/2), cos(θ/2) 的正确最短弧旋转。 */
function quatFromTo(from: Vector3, to: Vector3, out: Quaternion): Quaternion {
  const fx = from.x, fy = from.y, fz = from.z;
  const tx = to.x, ty = to.y, tz = to.z;
  const dot = fx * tx + fy * ty + fz * tz;
  // 平行(同向)→ 单位
  if (dot > 0.999999) {
    out.copy(_qId);
    return out;
  }
  // 反平行 → 180° 旋转,选一个正交轴
  if (dot < -0.999999) {
    // 选与 from 不平行的轴
    let ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz);
    let rx = 1, ry = 0, rz = 0;
    if (ax < ay) { if (ax < az) { rx = 0; ry = 1; } else { rx = 0; rz = 1; } }
    else { if (ay < az) { rx = 0; ry = 1; } }
    // cross(from, axis) → 旋转轴
    out.x = fy * rz - fz * ry;
    out.y = fz * rx - fx * rz;
    out.z = fx * ry - fy * rx;
    out.w = 0;
    out.normalize();
    return out;
  }
  // Melax 公式:q = (cross, 1+dot),归一化后是最短弧
  out.x = fy * tz - fz * ty;
  out.y = fz * tx - fx * tz;
  out.z = fx * ty - fy * tx;
  out.w = 1 + dot;
  out.normalize();
  return out;
}

export class TwoBoneIKSolver {
  /**
   * 求解两段骨 IK。
   *
   * 返回的 rootQuat / midQuat 是**世界空间**旋转,可直接写入 Bone.matrixWorld
   * 或经父节点逆变换转回局部空间。
   */
  solve(input: TwoBoneIKInput, out: TwoBoneIKOutput): TwoBoneIKOutput {
    const w = input.weight ?? 1;
    if (w <= 0) {
      // 无权重 → 返回单位旋转,位置保持原样
      out.rootQuat.copy(_qId);
      out.midQuat.copy(_qId);
      out.midPos.copy(input.midPos);
      out.endPos.copy(input.endPos);
      return out;
    }

    const root = input.rootPos;
    const mid = input.midPos;
    const end = input.endPos;
    const target = input.targetPos;

    // 1. 骨长
    _v1.copy(mid).sub(root);
    const len1 = _v1.length();
    _v2.copy(end).sub(mid);
    const len2 = _v2.length();

    if (len1 < 1e-8 || len2 < 1e-8) {
      // 退化:某段骨长为零 → 只旋转 root 指向 target
      _v3.copy(target).sub(root).normalize();
      _vUp.set(0, 0, 1);
      if (Math.abs(_v3.dot(_vUp)) > 0.999) _vUp.set(1, 0, 0);
      quatFromTo(_vUp, _v3, out.rootQuat);
      out.midQuat.copy(_qId);
      out.midPos.copy(mid);
      out.endPos.copy(target);
      return out;
    }

    // 2. 限幅到可达球
    _v3.copy(target).sub(root);
    let d = _v3.length();
    const maxReach = len1 + len2 - (input.softness ?? 0);
    const minReach = Math.abs(len1 - len2) + (input.softness ?? 0);
    let clamped = false;
    if (d > maxReach) {
      d = maxReach;
      clamped = true;
    } else if (d < minReach) {
      d = minReach;
      clamped = true;
    }
    // 计算限幅后的目标位置
    let endX: number, endY: number, endZ: number;
    if (clamped) {
      _v3.normalize().multiplyScalar(d);
      endX = root.x + _v3.x;
      endY = root.y + _v3.y;
      endZ = root.z + _v3.z;
    } else {
      endX = target.x;
      endY = target.y;
      endZ = target.z;
    }
    out.endPos.set(endX, endY, endZ);

    // 3. 余弦定理求 mid 角度
    //    cosA = (len1² + d² - len2²) / (2·len1·d)
    const cosA = (len1 * len1 + d * d - len2 * len2) / (2 * len1 * Math.max(d, 1e-8));
    const angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));
    // mid 沿 root→target 方向的距离
    const midDist = len1 * Math.cos(angleA);
    // mid 偏离 root→target 轴的高度
    const midHeight = len1 * Math.sin(angleA);

    // 4. 建立局部坐标系:forward = (target - root).normalize, up = pole
    _vFwd.copy(out.endPos).sub(root).normalize();
    // pole 方向
    if (input.polePos) {
      _vUp.copy(input.polePos).sub(root);
    } else {
      _vUp.copy(mid).sub(root);
    }
    // 投影 pole 到 forward 的正交平面
    const fdot = _vUp.dot(_vFwd);
    _vUp.sub(_vFwd.clone().multiplyScalar(fdot));
    if (_vUp.lengthSq() < 1e-12) {
      _vUp.set(0, 1, 0);
      if (Math.abs(_vFwd.dot(_vUp)) > 0.999) _vUp.set(1, 0, 0);
    }
    _vUp.normalize();
    _vRight.cross(_vUp).copy(_vUp).cross(_vFwd).normalize(); // right = up × fwd

    // 5. mid 位置 = root + fwd*midDist + up*midHeight
    out.midPos.set(
      root.x + _vFwd.x * midDist + _vUp.x * midHeight,
      root.y + _vFwd.y * midDist + _vUp.y * midHeight,
      root.z + _vFwd.z * midDist + _vUp.z * midHeight,
    );

    // 6. root 旋转:从原 root→mid 方向 → 新 root→mid 方向
    _v1.copy(mid).sub(root).normalize(); // 原方向
    _v2.copy(out.midPos).sub(root).normalize(); // 新方向
    quatFromTo(_v1, _v2, out.rootQuat);

    // 7. mid 旋转:从原 mid→end 方向 → 新 mid→end 方向
    _v1.copy(end).sub(mid).normalize();
    _v2.copy(out.endPos).sub(out.midPos).normalize();
    quatFromTo(_v1, _v2, out.midQuat);

    // 8. 权重混合
    if (w < 1) {
      out.rootQuat.copy(_q1.copy(_qId).slerp(out.rootQuat, w));
      out.midQuat.copy(_q2.copy(_qId).slerp(out.midQuat, w));
    }

    return out;
  }
}

// ── LookAtIK ─────────────────────────────────────────────────────

/** LookAtIK — 旋转一个骨骼使其 +Z(或自定义前向轴)指向目标。
 *  常用于头部追踪、眼睛注视、炮塔瞄准。与 TwoBoneIK 不同,它只改
 *  一个骨骼的旋转,不改位置。
 *
 *  参考 o3de EMotionFX LookAtIKNode / Unreal "Look At" 节点。 */

export interface LookAtIKInput {
  /** 骨骼当前世界位置。 */
  bonePos: Vector3;
  /** 骨骼当前世界四元数。 */
  boneQuat: Quaternion;
  /** 注视目标世界位置。 */
  targetPos: Vector3;
  /** 骨骼的"前向"轴(局部空间),默认 (0,0,1)。 */
  forwardAxis?: Vector3;
  /** 权重 0..1,默认 1。 */
  weight?: number;
  /** 最大旋转角度(弧度),默认 Infinity(不限)。 */
  maxAngle?: number;
  /** 平滑系数 0..1,默认 0(无平滑,直接到达)。每帧用 slerp 按
   *  这个系数向目标旋转靠近。 */
  smooth?: number;
}

export interface LookAtIKOutput {
  /** 旋转后的世界四元数。 */
  quat: Quaternion;
}

export class LookAtIK {
  /** 内部状态(用于 smooth 平滑)。 */
  private _current = new Quaternion(0, 0, 0, 1);
  private _hasCurrent = false;

  reset(): void {
    this._hasCurrent = false;
  }

  solve(input: LookAtIKInput, out: LookAtIKOutput): LookAtIKOutput {
    const w = input.weight ?? 1;
    if (w <= 0) {
      out.quat.copy(input.boneQuat);
      return out;
    }

    // 前向轴(默认 +Z)
    const fwd = input.forwardAxis ?? _vFwd;
    if (!input.forwardAxis) _vFwd.set(0, 0, 1);

    // 当前前向(世界空间)= boneQuat * forwardAxis
    _v1.copy(fwd).applyQuaternion(input.boneQuat);

    // 期望前向(世界空间)= (target - bonePos).normalize
    _v2.copy(input.targetPos).sub(input.bonePos);
    if (_v2.lengthSq() < 1e-12) {
      out.quat.copy(input.boneQuat);
      return out;
    }
    _v2.normalize();

    // 旋转增量:从 currentFwd → desiredFwd
    quatFromTo(_v1, _v2, _q1);

    // maxAngle 限幅(限制 delta 的大小)
    if (input.maxAngle !== undefined && input.maxAngle < Math.PI) {
      const angle = 2 * Math.acos(Math.max(-1, Math.min(1, _q1.w)));
      if (angle > input.maxAngle) {
        const t = input.maxAngle / angle;
        // _q1 = identity.slerp(delta, t) — 用 _q2 暂存 delta 避免别名
        _q2.copy(_q1);
        _q1.copy(_qId).slerp(_q2, t);
      }
    }

    // 目标旋转 = delta * boneQuat
    _q2.copy(_q1).multiply(input.boneQuat);

    // 权重混合:从 boneQuat slerp 到目标(用 _q1 暂存目标避免别名)
    if (w < 1) {
      _q1.copy(_q2); // _q1 = target
      _q2.copy(input.boneQuat).slerp(_q1, w);
    }

    // 平滑
    if (input.smooth && input.smooth > 0) {
      if (!this._hasCurrent) {
        // 首帧:从骨骼当前旋转开始,而非直接跳到目标
        this._current.copy(input.boneQuat);
        this._hasCurrent = true;
      }
      // 每帧向目标移动 (1 - smooth) 比例
      this._current.copy(this._current).slerp(_q2, 1 - input.smooth);
      out.quat.copy(this._current);
    } else {
      out.quat.copy(_q2);
      this._hasCurrent = false;
    }

    return out;
  }
}
