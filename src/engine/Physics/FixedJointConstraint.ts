// FixedJointConstraint — 固定关节:完全锁定相对位置与旋转。
//
// 求解:
//   1) 点约束(同球关节):位置投影 + 速度修正,锁定锚点相对位置。
//   2) 角约束:锁定相对朝向(使相对角速度 → 0,并 Baumgarte 修正朝向误差)。
//      首次求解时记录初始相对朝向 qRel0,后续以 qErr = qRel * qRel0^-1 作为误差。
//
// 对刚体位置投影 + 朝向投影(对 bodyB 旋转一个小修正四元数)保证收敛。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import {
  Constraint, type RigidbodyLike, type Mat3,
  mat3Inverse, mat3MulVec, computePointEffectiveMass, applyImpulse,
} from './Constraint';

export class FixedJointConstraint extends Constraint {
  /** 锚点 A 在 bodyA 本地空间。 */
  anchorA: Vector3;
  /** 锚点 B 在 bodyB 本地空间。 */
  anchorB: Vector3;
  /** 位置投影因子。 */
  positionBeta: number = 0.5;
  /** 速度 Baumgarte 因子。 */
  velocityBeta: number = 0.2;
  /** 朝向投影因子。 */
  rotationBeta: number = 0.5;
  /** 朝向速度 Baumgarte 因子。 */
  rotationVelBeta: number = 0.2;
  /** 初始相对朝向(qB * qA^-1),惰性记录。 */
  private qRel0: Quaternion | null = null;
  private qRel0Valid: boolean = false;

  constructor(
    bodyA: RigidbodyLike | null = null,
    bodyB: RigidbodyLike | null = null,
    anchorA: Vector3 = new Vector3(),
    anchorB: Vector3 = new Vector3(),
  ) {
    super(bodyA, bodyB);
    this.anchorA = anchorA.clone();
    this.anchorB = anchorB.clone();
  }

  override solve(dt: number): void {
    const A = this.bodyA, B = this.bodyB;
    if (!A || !B || !this.enabled) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;
    const dts = Math.max(dt, 1e-6);

    // ── 1) 点约束(锁定锚点相对位置) ──
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

    // ── 2) 角约束(锁定相对朝向) ──
    // qRel = qB * qA^-1
    const qAInv = A.quaternion.clone().invert();
    const qRel = B.quaternion.clone().multiply(qAInv);
    if (!this.qRel0Valid) {
      this.qRel0 = qRel.clone();
      this.qRel0Valid = true;
    }
    const qRel0Inv = this.qRel0!.clone().invert();
    // qErr = qRel * qRel0^-1 (从期望到当前的旋转)
    const qErr = qRel.clone().multiply(qRel0Inv);
    const axis = new Vector3();
    const angle = qErr.toAxisAngle(axis);
    // 朝向投影:旋转 B(及/或 A)使 angle 减小;按 invInertia 比例分配(这里用 invMass 近似)
    if (angle > 1e-6 && totalInv > 0) {
      const corrAngle = -angle * this.rotationBeta;
      const qCorr = new Quaternion().setFromAxisAngle(axis, corrAngle);
      if (A.invMass > 0 && B.invMass > 0) {
        // 各自旋转一半,方向相反以相互靠拢
        const half = new Quaternion().setFromAxisAngle(axis, corrAngle * 0.5);
        const halfNeg = new Quaternion().setFromAxisAngle(axis, -corrAngle * 0.5);
        B.quaternion.premultiply(half).normalize();
        A.quaternion.premultiply(halfNeg).normalize();
      } else if (B.invMass > 0) {
        B.quaternion.premultiply(qCorr).normalize();
      } else if (A.invMass > 0) {
        A.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, -corrAngle)).normalize();
      }
    }

    // 速度修正:消除相对角速度 + Baumgarte 偏置
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    const angBias = axis.clone().multiplyScalar((this.rotationVelBeta / dts) * angle);
    const angTarget = omegaRel.clone().negate().add(angBias);
    const KAng = angEffectiveMass(A, B);
    const KAngInv = mat3Inverse(KAng);
    if (KAngInv) {
      const L = mat3MulVec(KAngInv, angTarget, new Vector3());
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
