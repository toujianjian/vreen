// SliderJointConstraint — 滑动关节:只允许沿一个轴平移,锁定相对旋转。
//
// 求解:
//   1) 角约束:锁定相对旋转(使相对角速度 → 0,并 Baumgarte 修正朝向误差)。
//   2) 线约束(垂直平面):锚点位置误差 C 投影到与 axis 垂直的平面,消除之。
//   3) 距离限制:沿 axis 的相对位移若超出 [minDistance, maxDistance],
//      按 1-DOF 距离约束施加冲量(类似 DistanceJoint 的硬限制)。
// 轴 axis 在 bodyA 本地空间(典型为相对参考方向)。

import { Vector3 } from '../Math/Vector3';
import {
  Constraint, type RigidbodyLike, type Mat3,
  mat3Inverse, mat3MulVec, applyImpulse, computePointEffectiveMass,
} from './Constraint';

export class SliderJointConstraint extends Constraint {
  /** 锚点 A 在 bodyA 本地空间。 */
  anchorA: Vector3;
  /** 锚点 B 在 bodyB 本地空间。 */
  anchorB: Vector3;
  /** 滑动轴在 bodyA 本地空间(归一化)。 */
  axis: Vector3;
  /** 沿轴允许的最小相对位移(0 表示同点)。 */
  minDistance: number = 0;
  /** 沿轴允许的最大相对位移。 */
  maxDistance: number = Number.POSITIVE_INFINITY;
  /** 位置投影因子。 */
  positionBeta: number = 0.5;
  /** 速度 Baumgarte 因子。 */
  velocityBeta: number = 0.2;

  constructor(
    bodyA: RigidbodyLike | null = null,
    bodyB: RigidbodyLike | null = null,
    anchorA: Vector3 = new Vector3(),
    anchorB: Vector3 = new Vector3(),
    axis: Vector3 = new Vector3(1, 0, 0),
  ) {
    super(bodyA, bodyB);
    this.anchorA = anchorA.clone();
    this.anchorB = anchorB.clone();
    this.axis = axis.clone().normalize();
  }

  override solve(dt: number): void {
    const A = this.bodyA, B = this.bodyB;
    if (!A || !B || !this.enabled) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;
    const dts = Math.max(dt, 1e-6);

    // 世界轴
    const ax = this.axis.clone().applyQuaternion(A.quaternion).normalize();

    // ── 1) 角约束:锁定相对旋转 ──
    {
      const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
      const KAng = angEffectiveMass(A, B);
      const KAngInv = mat3Inverse(KAng);
      if (KAngInv) {
        const L = mat3MulVec(KAngInv, omegaRel.clone().negate(), new Vector3());
        applyAngularImpulse(B, L);
        applyAngularImpulse(A, L.clone().negate());
      }
    }

    // ── 2) 线约束:消除垂直于轴的位置误差 ──
    const rA = this.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = this.anchorB.clone().applyQuaternion(B.quaternion);
    const pA = A.position.clone().add(rA);
    const pB = B.position.clone().add(rB);
    const C = pB.clone().sub(pA); // 位置误差
    // 投影到垂直平面:C_perp = C - (C·ax)*ax
    const CAxis = C.dot(ax);
    const CPerp = C.clone().addScaledVector(ax, -CAxis);

    const totalInv = A.invMass + B.invMass;
    if (totalInv > 0) {
      const corr = CPerp.clone().multiplyScalar(this.positionBeta / totalInv);
      A.position.addScaledVector(corr, A.invMass);
      B.position.addScaledVector(corr, -B.invMass);
    }

    // 速度修正(垂直平面)
    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    const vRelPerp = vRel.clone().addScaledVector(ax, -vRel.dot(ax));
    const linBias = CPerp.clone().multiplyScalar(-this.velocityBeta / dts);
    const linTarget = vRelPerp.clone().negate().add(linBias);
    const K = computePointEffectiveMassPerp(rA, rB, A, B, ax);
    const Kinv = mat3Inverse(K);
    if (Kinv) {
      const P = mat3MulVec(Kinv, linTarget, new Vector3());
      applyImpulse(B, P, rB);
      applyImpulse(A, P.clone().negate(), rA);
    }

    // ── 3) 距离限制(沿轴 1-DOF) ──
    // 仅当超出 [min, max] 时,按硬限制求解
    const dist = CAxis;
    if (dist < this.minDistance) {
      // 过近:推开(沿 -ax,使 dist 增大)
      this.solveAxisLimit(ax, this.minDistance - dist, /*pushDirection*/ +1, A, B, rA, rB, dts);
    } else if (dist > this.maxDistance && Number.isFinite(this.maxDistance)) {
      // 过远:拉近(沿 +ax 拉回,使 dist 减小)
      this.solveAxisLimit(ax, dist - this.maxDistance, /*pushDirection*/ -1, A, B, rA, rB, dts);
    }
  }

  /** 1-DOF 沿轴距离限制。violation>0,dir=+1 表示需沿 +ax 推开,dir=-1 表示沿 -ax 拉回。 */
  private solveAxisLimit(
    ax: Vector3, violation: number, dir: number,
    A: RigidbodyLike, B: RigidbodyLike, rA: Vector3, rB: Vector3, dts: number,
  ): void {
    const totalInv = A.invMass + B.invMass;
    if (totalInv <= 0) return;
    // 位置投影
    const corr = ax.clone().multiplyScalar(dir * violation * this.positionBeta);
    A.position.addScaledVector(corr, -A.invMass / totalInv);
    B.position.addScaledVector(corr, B.invMass / totalInv);
    // 速度:消除沿轴的相对速度(若正在违反方向移动)+ Baumgarte 偏置
    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    const vAxis = vRel.dot(ax); // B 相对 A 沿轴速度
    // dir=+1:需 dist 增大 → 目标 vAxis > 0(+bias);dir=-1:需 dist 减小 → 目标 vAxis < 0(-bias)
    const bias = dir * (this.velocityBeta / dts) * violation;
    const targetVAxis = bias;
    const deltaV = targetVAxis - vAxis; // 沿 ax 的速度变化
    // 1-DOF 有效质量(线性部分 + 角响应在锚点)
    const Kn = scalarEffectiveMassAlongAxis(ax, rA, rB, A, B);
    if (Kn <= 1e-12) return;
    const p = deltaV / Kn; // 冲量标量,沿 ax
    const P = ax.clone().multiplyScalar(p);
    applyImpulse(B, P, rB);
    applyImpulse(A, P.clone().negate(), rA);
  }
}

/** 沿轴的标量有效质量(含角响应):Kn = invMassA+invMassB + (rA×ax)·invInertiaA·(rA×ax) + (rB×ax)·invInertiaB·(rB×ax)。 */
function scalarEffectiveMassAlongAxis(
  ax: Vector3, rA: Vector3, rB: Vector3,
  A: RigidbodyLike, B: RigidbodyLike,
): number {
  const rAx = crossR(rA, ax); // rA × ax
  const rBx = crossR(rB, ax);
  let k = A.invMass + B.invMass;
  if (A.invMass > 0) {
    const t = mat3MulVec(A.invInertia, rAx, new Vector3());
    k += rAx.dot(t);
  }
  if (B.invMass > 0) {
    const t = mat3MulVec(B.invInertia, rBx, new Vector3());
    k += rBx.dot(t);
  }
  return k;
}

/** 垂直平面有效质量:K = 点约束有效质量 - (ax⊗ax)项近似。
 *  完整垂直平面约束可用,此处沿用 3x3 点约束 K(目标已投影到垂直平面,ax 分量被天然弱化)。 */
function computePointEffectiveMassPerp(
  rA: Vector3, rB: Vector3,
  A: RigidbodyLike, B: RigidbodyLike, _ax: Vector3,
): Mat3 {
  // 复用点约束 3x3 K。目标 vRelPerp 已无轴分量,3x3 求解后冲量在垂直平面主导。
  return computePointEffectiveMass(rA, rB, A, B);
}

/** 角约束有效质量:K = invInertiaA + invInertiaB。 */
function angEffectiveMass(A: RigidbodyLike, B: RigidbodyLike): Mat3 {
  const k = (A.invMass > 0 ? A.invInertia : [0, 0, 0, 0, 0, 0, 0, 0, 0]).slice();
  if (B.invMass > 0) {
    const bi = B.invInertia;
    k[0] += bi[0]; k[1] += bi[1]; k[2] += bi[2];
    k[3] += bi[3]; k[4] += bi[4]; k[5] += bi[5];
    k[6] += bi[6]; k[7] += bi[7]; k[8] += bi[8];
  }
  return k;
}

/** 纯角冲量:omega += invInertia * L。 */
function applyAngularImpulse(body: RigidbodyLike, L: Vector3): void {
  if (body.invMass <= 0) return;
  const dOmega = mat3MulVec(body.invInertia, L, new Vector3());
  body.angularVelocity.x += dOmega.x;
  body.angularVelocity.y += dOmega.y;
  body.angularVelocity.z += dOmega.z;
}

/** cross(r, ax)。 */
function crossR(r: Vector3, ax: Vector3): Vector3 {
  return new Vector3(
    r.y * ax.z - r.z * ax.y,
    r.z * ax.x - r.x * ax.z,
    r.x * ax.y - r.y * ax.x,
  );
}

/** cross(omega, r)。 */
function crossOmegaR(omega: Vector3, r: Vector3): Vector3 {
  return new Vector3(
    omega.y * r.z - omega.z * r.y,
    omega.z * r.x - omega.x * r.z,
    omega.x * r.y - omega.y * r.x,
  );
}
