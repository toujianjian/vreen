// DistanceJointConstraint — 距离关节:保持两锚点间固定距离(弹簧软约束)。
//
// 采用 CFM/ERP(Compliance / Error Reduction Parameter)软约束公式:
//   - K_n:沿连线方向 n 的标量有效质量(含角响应)。
//   - compliance = 1/stiffness,刚度越高(compliance→0)越接近刚性。
//   - K_eff = K_n + compliance/dt² + damping/dt
//   - p = (-(beta/dt)*C - vRel_n) / K_eff   (C = dist - target,标量)
//   - 冲量 P = n * p,施加于 B(+P)与 A(-P)。
// 高刚度时表现为刚性距离约束;低刚度时表现为软弹簧。
//
// 由于求解器不内含积分器(直接读写 position),额外做位置投影(Baumgarte)
//   以保证多次迭代后距离误差几何收敛——对刚性配置(positionBeta 默认 0.5)
//   单调收敛,适合测试。纯弹簧行为可将 positionBeta 设为 0。

import { Vector3 } from '../Math/Vector3';
import {
  Constraint, type RigidbodyLike,
  mat3MulVec, applyImpulse,
} from './Constraint';

export class DistanceJointConstraint extends Constraint {
  /** 锚点 A 在 bodyA 本地空间。 */
  anchorA: Vector3;
  /** 锚点 B 在 bodyB 本地空间。 */
  anchorB: Vector3;
  /** 期望距离 (m)。 */
  distance: number;
  /** 刚度 (N/m);越大越接近刚性。0 或 Infinity 视为完全刚性。 */
  stiffness: number;
  /** 阻尼 (N·s/m)。 */
  damping: number;
  /** 位置投影因子。 */
  positionBeta: number = 0.5;
  /** 速度 Baumgarte 因子。 */
  velocityBeta: number = 0.2;

  constructor(
    bodyA: RigidbodyLike | null = null,
    bodyB: RigidbodyLike | null = null,
    anchorA: Vector3 = new Vector3(),
    anchorB: Vector3 = new Vector3(),
    distance: number = 0,
    stiffness: number = 1e6,
    damping: number = 0.5,
  ) {
    super(bodyA, bodyB);
    this.anchorA = anchorA.clone();
    this.anchorB = anchorB.clone();
    this.distance = distance;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  override solve(dt: number): void {
    const A = this.bodyA, B = this.bodyB;
    if (!A || !B || !this.enabled) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;
    const dts = Math.max(dt, 1e-6);

    const rA = this.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = this.anchorB.clone().applyQuaternion(B.quaternion);
    const pA = A.position.clone().add(rA);
    const pB = B.position.clone().add(rB);
    const delta = pB.clone().sub(pA); // A → B
    let dist = delta.length();
    if (dist < 1e-9) {
      // 重合:取任意轴避免除零
      dist = 1e-9;
      delta.set(1, 0, 0);
    }
    const n = delta.clone().divideScalar(dist); // 单位向量 A → B
    const C = dist - this.distance; // >0 拉伸,<0 压缩

    // ── 位置投影(沿 n 按比例消除误差) ──
    const totalInv = A.invMass + B.invMass;
    if (totalInv > 0 && this.positionBeta > 0) {
      const corr = n.clone().multiplyScalar(C * this.positionBeta / totalInv);
      // C>0(太远):A 沿 +n 靠近,B 沿 -n 靠近 → 缩短距离
      A.position.addScaledVector(corr, A.invMass);
      B.position.addScaledVector(corr, -B.invMass);
    }

    // ── 速度软约束(CFM/ERP) ──
    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    const vRel_n = vRel.dot(n); // B 相对 A 沿 n 速度(>0 远离)

    // 沿 n 的标量有效质量(含角响应):
    //   Kn = invMassA + invMassB + (rA×n)·invInertiaA·(rA×n) + (rB×n)·invInertiaB·(rB×n)
    const rAxN = crossR(rA, n);
    const rBxN = crossR(rB, n);
    let Kn = A.invMass + B.invMass;
    if (A.invMass > 0) {
      const t = mat3MulVec(A.invInertia, rAxN, new Vector3());
      Kn += rAxN.dot(t);
    }
    if (B.invMass > 0) {
      const t = mat3MulVec(B.invInertia, rBxN, new Vector3());
      Kn += rBxN.dot(t);
    }
    const compliance = this.stiffness > 0 ? 1 / this.stiffness : 0;
    const Keff = Kn + compliance / (dts * dts) + this.damping / dts;
    if (Keff <= 1e-12) return;

    // 目标:drive C → 0。p = (-(beta/dt)*C - vRel_n) / Keff
    const p = (-(this.velocityBeta / dts) * C - vRel_n) / Keff;
    const P = n.clone().multiplyScalar(p);
    applyImpulse(B, P, rB);
    applyImpulse(A, P.clone().negate(), rA);
  }
}

/** cross(r, n)。 */
function crossR(r: Vector3, n: Vector3): Vector3 {
  return new Vector3(
    r.y * n.z - r.z * n.y,
    r.z * n.x - r.x * n.z,
    r.x * n.y - r.y * n.x,
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
