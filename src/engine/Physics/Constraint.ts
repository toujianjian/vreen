// Constraint — 物理约束基类与刚体解耦接口。
//
// 设计:
// - RigidbodyLike 接口暴露约束求解所需的最小字段,不依赖具体 Rigidbody 类
//   (可对接 ECS Rigidbody、自定义 Mock、或外部物理后端)。
// - invInertia 使用 column-major 9 元组(与引擎 Matrix3.elements 一致),
//   约束求解内部按 column-major 处理。
// - 约束求解采用 Sequential Impulse + 位置投影(Baumgarte 稳定化):
//     a) 位置投影直接修正 body.position,使误差几何收敛
//     b) 速度修正冲量消除约束违反方向的相对速度,并加小量 Baumgarte 速度偏置
//   两步同用一份位置误差 C,保证求解器迭代单调收敛。
// - 约束系统是独立的,不修改现有 PhysicsDemo / PhysicsSystems。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 3x3 矩阵,column-major 9 元组(与 Matrix3.elements 布局一致)。 */
export type Mat3 = number[];

/** 约束求解所需的最小刚体接口。 */
export interface RigidbodyLike {
  /** 世界空间位置(求解器会修改)。 */
  position: Vector3;
  /** 朝向四元数(求解器会修改)。 */
  quaternion: Quaternion;
  /** 线速度 (m/s)。 */
  velocity: Vector3;
  /** 角速度向量 (rad/s),绕世界坐标轴。 */
  angularVelocity: Vector3;
  /** 质量 (kg);0 = 静态。 */
  mass: number;
  /** 逆质量 (1/mass);静态为 0。 */
  invMass: number;
  /** 世界空间逆惯性张量,column-major 9 元组。 */
  invInertia: Mat3;
}

/** 物理约束基类。 */
export abstract class Constraint {
  bodyA: RigidbodyLike | null;
  bodyB: RigidbodyLike | null;
  enabled: boolean = true;

  constructor(bodyA: RigidbodyLike | null = null, bodyB: RigidbodyLike | null = null) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
  }

  /** 约束求解(子类实现)。 */
  abstract solve(dt: number): void;
}

// ── Mat3 辅助(column-major,模块内共享) ─────────────────────────

/** skew(r):使 skew(r) * v = cross(r, v)。返回 column-major 9 元组。 */
export function skewMat(r: Vector3): Mat3 {
  const x = r.x, y = r.y, z = r.z;
  return [
    0,  z, -y,
   -z,  0,  x,
    y, -x,  0,
  ];
}

/** m * v,m 为 column-major。结果写入 out 并返回。 */
export function mat3MulVec(m: Mat3, v: Vector3, out: Vector3): Vector3 {
  out.x = m[0] * v.x + m[3] * v.y + m[6] * v.z;
  out.y = m[1] * v.x + m[4] * v.y + m[7] * v.z;
  out.z = m[2] * v.x + m[5] * v.y + m[8] * v.z;
  return out;
}

/** a * b,均为 column-major。返回新 Mat3。 */
export function mat3MulMat3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[k * 3 + i] * b[j * 3 + k];
      r[j * 3 + i] = s;
    }
  }
  return r;
}

/** 3x3 求逆(伴随矩阵法)。奇异返回 null。 */
export function mat3Inverse(m: Mat3): Mat3 | null {
  // column-major: m[col*3 + row]
  const a11 = m[0], a21 = m[1], a31 = m[2];
  const a12 = m[3], a22 = m[4], a32 = m[5];
  const a13 = m[6], a23 = m[7], a33 = m[8];
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  // 行主序逆元 b_ij,再转 column-major
  const b11 = (a22 * a33 - a23 * a32) * inv;
  const b12 = -(a12 * a33 - a13 * a32) * inv;
  const b13 = (a12 * a23 - a13 * a22) * inv;
  const b21 = -(a21 * a33 - a23 * a31) * inv;
  const b22 = (a11 * a33 - a13 * a31) * inv;
  const b23 = -(a11 * a23 - a13 * a21) * inv;
  const b31 = (a21 * a32 - a22 * a31) * inv;
  const b32 = -(a11 * a32 - a12 * a31) * inv;
  const b33 = (a11 * a22 - a12 * a21) * inv;
  return [
    b11, b21, b31,
    b12, b22, b32,
    b13, b23, b33,
  ];
}

/** 单位矩阵(column-major)。 */
export function mat3Identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/** 缩放单位矩阵 by s。 */
function mat3ScaleI(s: number): Mat3 {
  return [s, 0, 0, 0, s, 0, 0, 0, s];
}

/**
 * 计算点约束(point-to-point)的有效质量矩阵:
 *   K = (invMassA + invMassB) * I3
 *       - skew(rA) * invInertiaA * skew(rA)
 *       - skew(rB) * invInertiaB * skew(rB)
 * 返回 column-major 9 元组。
 */
export function computePointEffectiveMass(
  rA: Vector3, rB: Vector3,
  A: RigidbodyLike, B: RigidbodyLike,
): Mat3 {
  const totalInv = A.invMass + B.invMass;
  const k = mat3ScaleI(totalInv);
  if (A.invMass > 0) {
    const sA = skewMat(rA);
    const termA = mat3MulMat3(mat3MulMat3(sA, A.invInertia), sA);
    for (let i = 0; i < 9; i++) k[i] -= termA[i];
  }
  if (B.invMass > 0) {
    const sB = skewMat(rB);
    const termB = mat3MulMat3(mat3MulMat3(sB, B.invInertia), sB);
    for (let i = 0; i < 9; i++) k[i] -= termB[i];
  }
  return k;
}

/**
 * 在锚点(world-space offset r)对刚体施加冲量 P:
 *   v += invMass * P
 *   omega += invInertia * cross(r, P)
 * 静态(invMass<=0)直接跳过。
 */
export function applyImpulse(body: RigidbodyLike, P: Vector3, r: Vector3): void {
  if (body.invMass <= 0) return;
  body.velocity.x += P.x * body.invMass;
  body.velocity.y += P.y * body.invMass;
  body.velocity.z += P.z * body.invMass;
  // torque = r × P → Δω = invInertia * torque
  const tx = r.y * P.z - r.z * P.y;
  const ty = r.z * P.x - r.x * P.z;
  const tz = r.x * P.y - r.y * P.x;
  const torque = new Vector3(tx, ty, tz);
  const dOmega = mat3MulVec(body.invInertia, torque, new Vector3());
  body.angularVelocity.x += dOmega.x;
  body.angularVelocity.y += dOmega.y;
  body.angularVelocity.z += dOmega.z;
}
