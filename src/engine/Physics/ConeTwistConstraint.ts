// ConeTwistConstraint — 锥-扭关节:球关节 + 锥角(swing)限制 + 扭转(twist)限制。
//
// 适用:ragdoll 肩/髋/颈等需要"绕轴自由摆动但不超过最大锥角,绕自身轴扭转也受限"的关节。
// 与 HingeJointConstraint 的区别:hinge 只允许 1-DOF 旋转(膝盖/肘);
// cone-twist 允许 2-DOF swing(锥内任意方向)+ 1-DOF twist(绕轴旋转),共 3-DOF 但带角度上限。
//
// 求解(每步):
//   1) 点约束(同 BallJointConstraint):位置投影 + 速度修正,使两锚点对齐。
//   2) Swing 锥角限制:
//      - 计算相对旋转 qRel = qA^-1 * qB
//      - 分解为 swing(垂直轴分量)与 twist(沿轴分量)
//      - swing 轴与世界锥轴 aA 的夹角若 > swingLimit,施加角冲量推回锥内
//   3) Twist 限制:
//      - 提取绕 aA 的 twist 角(atan2 投影法)
//      - 若超出 [twistMin, twistMax],施加角冲量推回
//
// 参考:
//   - Bullet btConeTwistConstraint
//   - o3de PhysX D6 joint with cone-twist limit
//   - Müller et al., "Position Based Dynamics", 2006

import { Vector3 } from '../Math/Vector3';
import {
  Constraint, type RigidbodyLike,
  mat3Inverse, mat3MulVec, applyImpulse, computePointEffectiveMass,
} from './Constraint';

export class ConeTwistConstraint extends Constraint {
  /** 锚点 A 在 bodyA 本地空间。 */
  anchorA: Vector3;
  /** 锚点 B 在 bodyB 本地空间。 */
  anchorB: Vector3;
  /** 锥轴在 bodyA 本地空间(归一化,锥开口方向)。 */
  axisA: Vector3;
  /** 锥轴在 bodyB 本地空间(归一化,默认与 axisA 同向)。 */
  axisB: Vector3;
  /** Swing 锥角上限(弧度,半锥角)。0 = 锁死旋转,π = 自由。 */
  swingLimit: number;
  /** Twist 最小角(弧度,绕 axisA)。 */
  twistMin: number;
  /** Twist 最大角(弧度)。 */
  twistMax: number;
  /** 是否启用 swing 限制。 */
  swingEnabled: boolean;
  /** 是否启用 twist 限制。 */
  twistEnabled: boolean;
  /** 位置投影因子。 */
  positionBeta: number = 0.5;
  /** 速度 Baumgarte 因子。 */
  velocityBeta: number = 0.2;
  /** 角限制 Baumgarte 因子。 */
  angleBeta: number = 0.3;
  /** 软约束:角限制冲量衰减(0=硬限制,1=完全不限制)。 */
  softness: number = 0;

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
    this.swingLimit = Math.PI / 4; // 默认 45°
    this.twistMin = -Math.PI / 4;
    this.twistMax = Math.PI / 4;
    this.swingEnabled = true;
    this.twistEnabled = false;
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

    // ── 2) Swing 锥角限制 ──
    if (this.swingEnabled && this.swingLimit < Math.PI - 1e-6) {
      this.solveSwingLimit(A, B, dts);
    }

    // ── 3) Twist 限制 ──
    if (this.twistEnabled) {
      this.solveTwistLimit(A, B, dts);
    }
  }

  /** Swing 锥角限制:把 bodyB 的轴 aB 限制在以 bodyA 的轴 aA 为中心、半锥角 swingLimit 的锥内。 */
  private solveSwingLimit(A: RigidbodyLike, B: RigidbodyLike, dts: number): void {
    // 世界轴
    const aAw = this.axisA.clone().applyQuaternion(A.quaternion).normalize();
    const aBw = this.axisB.clone().applyQuaternion(B.quaternion).normalize();
    const dot = aAw.dot(aBw);
    // 夹角 θ = acos(dot)
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const angle = Math.acos(clampedDot);
    if (angle <= this.swingLimit + 1e-6) return; // 在锥内,无需修正

    // 修正方向:垂直于 aA 的 aB 分量(把 aB 推回锥内)
    const perp = aBw.clone().addScaledVector(aAw, -dot); // aB - (aB·aA)*aA
    if (perp.lengthSq() < 1e-12) return;
    perp.normalize();
    // 违反量
    const violation = angle - this.swingLimit;
    // 角冲量方向:perp(将 aB 沿此方向旋转,减小与 aA 的夹角)
    // 注意:对 bodyB 施加 +L(沿 perp),对 bodyA 施加 -L
    // Baumgarte 偏置:目标相对角速度 = -(angleBeta/dt) * violation * perp
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    // 沿 perp 方向的相对角速度(应被消除)
    const omegaRelPerp = omegaRel.dot(perp);
    const bias = -this.angleBeta * violation / dts;
    // 目标:消除当前沿 perp 的相对角速度,并叠加 bias
    const targetDelta = bias - omegaRelPerp;
    // 软约束:冲量缩放
    const soft = 1 - this.softness;
    // 有效质量(角响应,沿 perp 的标量)
    const KAng = angEffectiveMassScalar(perp, A, B);
    if (KAng < 1e-12) return;
    const Lscalar = (targetDelta / KAng) * soft;
    const L = perp.clone().multiplyScalar(Lscalar);
    applyAngularImpulse(B, L);
    applyAngularImpulse(A, L.clone().negate());
  }

  /** Twist 限制:绕 aA 轴的相对扭转角限制在 [twistMin, twistMax]。 */
  private solveTwistLimit(A: RigidbodyLike, B: RigidbodyLike, dts: number): void {
    // 世界轴
    const aAw = this.axisA.clone().applyQuaternion(A.quaternion).normalize();
    // 相对旋转 qRel = qA^-1 * qB
    const qAinv = A.quaternion.clone().invert();
    const qRel = qAinv.multiply(B.quaternion.clone());
    qRel.normalize();
    // 提取 twist:把 qRel 投影到 axisA(本地空间)
    // twist quaternion:沿 axisA 的旋转分量
    // qTwist = normalize( (qRel · axisA) * axisA + qRel.w )
    const ax = this.axisA; // 本地空间轴
    const proj = qRel.x * ax.x + qRel.y * ax.y + qRel.z * ax.z;
    let twistAngle = 2 * Math.atan2(proj, qRel.w);
    // 包装到 [-π, π]
    while (twistAngle > Math.PI) twistAngle -= 2 * Math.PI;
    while (twistAngle < -Math.PI) twistAngle += 2 * Math.PI;

    let violation = 0;
    let dir = 0;
    if (twistAngle < this.twistMin) {
      violation = this.twistMin - twistAngle;
      dir = +1; // 需要正向扭转(增大 twistAngle)
    } else if (twistAngle > this.twistMax) {
      violation = twistAngle - this.twistMax;
      dir = -1; // 需要反向扭转(减小 twistAngle)
    } else {
      return; // 在限制内
    }

    // 角冲量沿 aAw(世界空间),方向 dir
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    const omegaRelAxis = omegaRel.dot(aAw);
    const bias = -this.angleBeta * violation * dir / dts;
    const targetDelta = bias - omegaRelAxis * dir;
    const soft = 1 - this.softness;
    const KAng = angEffectiveMassScalar(aAw, A, B);
    if (KAng < 1e-12) return;
    const Lscalar = (targetDelta / KAng) * soft;
    const L = aAw.clone().multiplyScalar(Lscalar * dir);
    applyAngularImpulse(B, L);
    applyAngularImpulse(A, L.clone().negate());
  }
}

/** 沿单轴 n 的角有效质量标量:K = n·(invInertiaA + invInertiaB)·n。 */
function angEffectiveMassScalar(n: Vector3, A: RigidbodyLike, B: RigidbodyLike): number {
  let k = 0;
  if (A.invMass > 0) {
    const t = mat3MulVec(A.invInertia, n, new Vector3());
    k += n.dot(t);
  }
  if (B.invMass > 0) {
    const t = mat3MulVec(B.invInertia, n, new Vector3());
    k += n.dot(t);
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
