// BallJointConstraint — 球关节:两刚体在锚点连接,可自由旋转。
//
// 求解:
//   1) 位置投影:将两锚点世界位置按 invMass 比例拉到一起(Baumgarte 稳定化)。
//   2) 速度修正:消除锚点相对速度,并加小量 Baumgarte 速度偏置修正残余位置误差。
//      有效质量 K 为 3x3,完整考虑角响应(invInertia 与锚点偏移)。

import { Vector3 } from '../Math/Vector3';
import {
  Constraint, type RigidbodyLike,
  computePointEffectiveMass, mat3Inverse, mat3MulVec, applyImpulse,
} from './Constraint';

export class BallJointConstraint extends Constraint {
  /** 锚点 A 在 bodyA 本地空间。 */
  anchorA: Vector3;
  /** 锚点 B 在 bodyB 本地空间。 */
  anchorB: Vector3;
  /** 位置投影因子(每次求解将误差按此比例消除)。 */
  positionBeta: number = 0.5;
  /** 速度 Baumgarte 偏置因子。 */
  velocityBeta: number = 0.2;

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

    // 锚点世界偏移(仅依赖朝向)
    const rA = this.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = this.anchorB.clone().applyQuaternion(B.quaternion);
    // 锚点世界位置
    const pA = A.position.clone().add(rA);
    const pB = B.position.clone().add(rB);
    // 位置误差 C = pB - pA
    const C = pB.clone().sub(pA);

    // ── 位置投影 ──
    const totalInv = A.invMass + B.invMass;
    if (totalInv > 0) {
      const corr = C.clone().multiplyScalar(this.positionBeta / totalInv);
      A.position.addScaledVector(corr, A.invMass);
      B.position.addScaledVector(corr, -B.invMass);
    }

    // ── 速度修正(Baumgarte 偏置) ──
    // 锚点速度 v_anchor = v + cross(omega, r)
    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    // 偏置:drive C → 0,目标 vRel = -(beta/dt) * C
    const bias = C.clone().multiplyScalar(-this.velocityBeta / dts);
    const target = vRel.clone().negate().add(bias); // -vRel - (beta/dt)*C

    const K = computePointEffectiveMass(rA, rB, A, B);
    const Kinv = mat3Inverse(K);
    if (!Kinv) return;
    const P = mat3MulVec(Kinv, target, new Vector3());
    applyImpulse(B, P, rB);
    applyImpulse(A, P.clone().negate(), rA);
  }
}

/** cross(omega, r) 的便捷封装。 */
function crossOmegaR(omega: Vector3, r: Vector3): Vector3 {
  // omega × r
  return new Vector3(
    omega.y * r.z - omega.z * r.y,
    omega.z * r.x - omega.x * r.z,
    omega.x * r.y - omega.y * r.x,
  );
}
