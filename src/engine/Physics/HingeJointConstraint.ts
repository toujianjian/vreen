// HingeJointConstraint — 铰链关节:只允许绕一个轴旋转。
//
// 求解:
//   1) 点约束(同球关节):位置投影 + 速度修正,使两锚点对齐。
//   2) 轴约束:限制非轴方向的相对旋转。
//      - 将相对角速度投影到铰链轴的垂直平面,施加角冲量消除之。
//      - Baumgarte 偏置修正世界轴 misalignment(aA 与 aB 不平行时驱动回平行)。
//
// 旋转轴 axisA/axisB 在各自本地空间(默认为各自 +x 或调用方设置)。
// 通常 axisA、axisB 为同一方向,求解器会保证两世界轴平行。

import { Vector3 } from '../Math/Vector3';
import {
  Constraint, type RigidbodyLike, type Mat3,
  mat3Inverse, mat3MulVec,
  computePointEffectiveMass, applyImpulse,
} from './Constraint';

export class HingeJointConstraint extends Constraint {
  /** 锚点 A 在 bodyA 本地空间。 */
  anchorA: Vector3;
  /** 锚点 B 在 bodyB 本地空间。 */
  anchorB: Vector3;
  /** 旋转轴在 bodyA 本地空间(归一化)。 */
  axisA: Vector3;
  /** 旋转轴在 bodyB 本地空间(归一化)。 */
  axisB: Vector3;
  /** 位置投影因子。 */
  positionBeta: number = 0.5;
  /** 速度 Baumgarte 因子。 */
  velocityBeta: number = 0.2;
  /** 轴对齐 Baumgarte 因子。 */
  axisBeta: number = 0.2;

  constructor(
    bodyA: RigidbodyLike | null = null,
    bodyB: RigidbodyLike | null = null,
    anchorA: Vector3 = new Vector3(),
    anchorB: Vector3 = new Vector3(),
    axisA: Vector3 = new Vector3(1, 0, 0),
    axisB: Vector3 = new Vector3(1, 0, 0),
  ) {
    super(bodyA, bodyB);
    this.anchorA = anchorA.clone();
    this.anchorB = anchorB.clone();
    this.axisA = axisA.clone().normalize();
    this.axisB = axisB.clone().normalize();
  }

  override solve(dt: number): void {
    const A = this.bodyA, B = this.bodyB;
    if (!A || !B || !this.enabled) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;
    const dts = Math.max(dt, 1e-6);

    // ── 1) 点约束(同球关节) ──
    const rA = this.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = this.anchorB.clone().applyQuaternion(B.quaternion);
    const pA = A.position.clone().add(rA);
    const pB = B.position.clone().add(rB);
    const C = pB.clone().sub(pA);

    const totalInv = A.invMass + B.invMass;
    if (totalInv > 0) {
      const corr = C.clone().multiplyScalar(this.positionBeta / totalInv);
      A.position.addScaledVector(corr, A.invMass);
      B.position.addScaledVector(corr, -B.invMass);
    }

    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    const linBias = C.clone().multiplyScalar(-this.velocityBeta / dts);
    const linTarget = vRel.clone().negate().add(linBias);
    const K = computePointEffectiveMass(rA, rB, A, B);
    const Kinv = mat3Inverse(K);
    if (Kinv) {
      const P = mat3MulVec(Kinv, linTarget, new Vector3());
      applyImpulse(B, P, rB);
      applyImpulse(A, P.clone().negate(), rA);
    }

    // ── 2) 轴约束:限制非轴相对旋转 ──
    const aA = this.axisA.clone().applyQuaternion(A.quaternion).normalize();
    const aB = this.axisB.clone().applyQuaternion(B.quaternion).normalize();
    // 轴误差向量:aB 在 aA 垂直平面的投影(应趋近 0)
    const dotAA = aA.dot(aB);
    const axisErr = aB.clone().addScaledVector(aA, -dotAA); // aB - (aB·aA)*aA,垂直于 aA
    // 相对角速度
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    // 自由分量:沿 aA 的角速度差(铰链允许);约束分量:垂直平面
    const omegaRelAxis = omegaRel.clone().dot(aA); // 标量(沿轴的相对角速度)
    const omegaRelPerp = omegaRel.clone().addScaledVector(aA, -omegaRelAxis); // 垂直分量
    // Baumgarte 偏置:驱动 axisErr → 0
    const angBias = axisErr.clone().multiplyScalar(-this.axisBeta / dts);
    // 目标:使垂直分量变为 angBias
    const angTarget = omegaRelPerp.clone().negate().add(angBias);
    // 有效质量:仅角响应,K = invInertiaA + invInertiaB(3x3,完整求解后投影到垂直平面)
    const KAng = angEffectiveMass(A, B);
    const KAngInv = mat3Inverse(KAng);
    if (KAngInv) {
      let L = mat3MulVec(KAngInv, angTarget, new Vector3());
      // 移除沿铰链轴分量,避免阻碍允许的旋转
      const Laxis = L.dot(aA);
      L.addScaledVector(aA, -Laxis);
      // 应用:omegaB += invInertiaB * L, omegaA -= invInertiaA * L
      applyAngularImpulse(B, L);
      applyAngularImpulse(A, L.clone().negate());
    }
  }
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

/** cross(omega, r)。 */
function crossOmegaR(omega: Vector3, r: Vector3): Vector3 {
  return new Vector3(
    omega.y * r.z - omega.z * r.y,
    omega.z * r.x - omega.x * r.z,
    omega.x * r.y - omega.y * r.x,
  );
}
