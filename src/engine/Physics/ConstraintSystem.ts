// ConstraintSystem — 高层物理约束/关节管理器。
//
// 设计:
//   * 与既有 ConstraintSolver/Constraint 类层级互补:
//     - ConstraintSolver 持有 Constraint 子类实例,面向"组装约束图"的场景;
//     - ConstraintSystem 持有扁平 PhysicsConstraint 描述符 (id 索引),
//       面向"运行时增删 / 配置 / 断裂检测"的场景 (编辑器 / 关卡脚本)。
//   * 求解策略沿用 Sequential Impulse + Baumgarte 稳定化:
//       1) 位置投影直接修正 body.position,使误差几何收敛;
//       2) 速度修正冲量消除约束违反方向的相对速度,并加小量 Baumgarte 速度偏置。
//   * 支持可断裂约束:求解时累计本帧施加的冲量幅值,超过 breakForce 标记 isBroken,
//     断裂约束在后续 solve 中被跳过 (由调用方决定是否移除)。
//   * 复用 Constraint.ts 的 RigidbodyLike 接口与 Mat3 工具,与任意刚体实现解耦。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import {
  type RigidbodyLike, type Mat3,
  mat3Inverse, mat3MulVec, applyImpulse, computePointEffectiveMass,
} from './Constraint';

/** 约束类型。 */
export type ConstraintType = 'fixed' | 'hinge' | 'ball' | 'slider' | 'spring' | 'cone';

/** 约束限制 (角度单位:弧度;距离单位:米)。 */
export interface ConstraintLimit {
  /** 最小值 (角度或距离)。 */
  min: number;
  /** 最大值 (角度或距离)。 */
  max: number;
  /** 反弹系数 (0=无反弹, 1=完全弹性),范围 [0,1]。 */
  bounciness: number;
}

/** 物理约束描述符 (扁平数据,便于序列化与运行时配置)。 */
export interface PhysicsConstraint {
  /** 唯一 id (由 ConstraintSystem 分配)。 */
  id: number;
  /** 约束类型。 */
  type: ConstraintType;
  /** 刚体 A (null 表示连接到世界静态点)。 */
  bodyA: RigidbodyLike | null;
  /** 刚体 B (null 表示连接到世界静态点)。 */
  bodyB: RigidbodyLike | null;
  /** 锚点 A 在 bodyA 本地空间。 */
  anchorA: Vector3;
  /** 锚点 B 在 bodyB 本地空间。 */
  anchorB: Vector3;
  /** 约束轴 (hinge/slider/cone 在 bodyA 本地空间,归一化)。 */
  axis?: Vector3;
  /** 角度/距离限制 (hinge 角度 / slider 距离 / cone 半角)。 */
  limits?: ConstraintLimit;
  /** 弹簧刚度 (N/m,仅 spring 类型)。 */
  stiffness?: number;
  /** 阻尼系数 (N·s/m)。 */
  damping?: number;
  /** 弹簧静止长度 (m,仅 spring 类型;默认为初始锚点距离)。 */
  restLength?: number;
  /** 是否已断裂 (求解时由 checkBreak 设置)。 */
  isBroken: boolean;
  /** 断开力阈值 (冲量幅值超过此值则断裂;undefined 表示不可断裂)。 */
  breakForce?: number;
  /** 本帧施加的冲量幅值 (供 checkBreak 读取)。 */
  lastImpulseMagnitude: number;
  /** 是否启用。 */
  enabled: boolean;
}

/** 约束配置 (创建约束时传入,字段全部可选)。 */
export interface ConstraintConfig {
  anchorA?: Vector3;
  anchorB?: Vector3;
  axis?: Vector3;
  limits?: ConstraintLimit;
  stiffness?: number;
  damping?: number;
  restLength?: number;
  breakForce?: number;
  enabled?: boolean;
}

/** 约束系统统计。 */
export interface ConstraintSystemStats {
  /** 总约束数。 */
  total: number;
  /** 启用约束数。 */
  enabled: number;
  /** 已断裂约束数。 */
  broken: number;
  /** 各类型约束数。 */
  byType: Record<ConstraintType, number>;
  /** 本帧求解次数。 */
  solveCount: number;
  /** 本帧累计施加冲量幅值。 */
  totalImpulse: number;
}

/** 3x3 单位矩阵 (column-major)。 */
const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * 物理约束系统 — 管理约束描述符并按帧求解。
 *
 * 用法:
 *   const sys = new ConstraintSystem();
 *   const id = sys.createConstraint('ball', bodyA, bodyB, { anchorA, anchorB });
 *   sys.solve(dt);          // 每物理步调用
 *   sys.removeConstraint(id);
 */
export class ConstraintSystem {
  /** 注册的约束 (id → constraint)。 */
  constraints: Map<number, PhysicsConstraint> = new Map();
  /** 下一个约束 id (递增)。 */
  nextId: number = 1;
  /** 求解迭代次数 (默认 10)。 */
  iterations: number = 10;
  /** 位置投影因子。 */
  positionBeta: number = 0.5;
  /** 速度 Baumgarte 偏置因子。 */
  velocityBeta: number = 0.2;
  /** 朝向投影因子 (fixed/hinge 角约束)。 */
  rotationBeta: number = 0.5;
  /** 朝向速度 Baumgarte 因子。 */
  rotationVelBeta: number = 0.2;
  /** 本帧求解次数 (统计用)。 */
  private solveCount: number = 0;
  /** 本帧累计冲量幅值 (统计用)。 */
  private totalImpulse: number = 0;

  /**
   * 创建约束。
   * @returns 约束 id。
   */
  createConstraint(
    type: ConstraintType,
    bodyA: RigidbodyLike | null,
    bodyB: RigidbodyLike | null,
    config: ConstraintConfig = {},
  ): number {
    const id = this.nextId++;
    const c: PhysicsConstraint = {
      id,
      type,
      bodyA,
      bodyB,
      anchorA: config.anchorA ? config.anchorA.clone() : new Vector3(),
      anchorB: config.anchorB ? config.anchorB.clone() : new Vector3(),
      axis: config.axis ? config.axis.clone().normalize() : undefined,
      limits: config.limits ? { ...config.limits } : undefined,
      stiffness: config.stiffness,
      damping: config.damping,
      restLength: config.restLength,
      isBroken: false,
      breakForce: config.breakForce,
      lastImpulseMagnitude: 0,
      enabled: config.enabled ?? true,
    };
    // spring 默认 restLength:首次创建时取两锚点世界距离
    if (type === 'spring' && c.restLength === undefined && bodyA && bodyB) {
      const rA = c.anchorA.clone().applyQuaternion(bodyA.quaternion);
      const rB = c.anchorB.clone().applyQuaternion(bodyB.quaternion);
      const pA = bodyA.position.clone().add(rA);
      const pB = bodyB.position.clone().add(rB);
      c.restLength = pA.distanceTo(pB);
    }
    // cone 默认 axis:+Y,limits:半角 π/4
    if (type === 'cone' && !c.axis) {
      c.axis = new Vector3(0, 1, 0);
    }
    if (type === 'cone' && !c.limits) {
      c.limits = { min: 0, max: Math.PI / 4, bounciness: 0 };
    }
    this.constraints.set(id, c);
    return id;
  }

  /** 移除约束。 */
  removeConstraint(id: number): boolean {
    return this.constraints.delete(id);
  }

  /** 获取约束 (返回引用,修改需谨慎)。 */
  getConstraint(id: number): PhysicsConstraint | undefined {
    return this.constraints.get(id);
  }

  /** 获取所有约束 (按 id 升序)。 */
  getConstraints(): PhysicsConstraint[] {
    return Array.from(this.constraints.values()).sort((a, b) => a.id - b.id);
  }

  /** 获取约束数。 */
  getConstraintCount(): number {
    return this.constraints.size;
  }

  /** 设置断开力阈值 (undefined 表示不可断裂)。 */
  setBreakForce(id: number, force: number | undefined): boolean {
    const c = this.constraints.get(id);
    if (!c) return false;
    c.breakForce = force;
    return true;
  }

  /** 设置限制。 */
  setLimits(id: number, limits: ConstraintLimit): boolean {
    const c = this.constraints.get(id);
    if (!c) return false;
    c.limits = { ...limits };
    return true;
  }

  /** 设置弹簧刚度。 */
  setStiffness(id: number, stiffness: number): boolean {
    const c = this.constraints.get(id);
    if (!c) return false;
    c.stiffness = stiffness;
    return true;
  }

  /** 设置阻尼。 */
  setDamping(id: number, damping: number): boolean {
    const c = this.constraints.get(id);
    if (!c) return false;
    c.damping = damping;
    return true;
  }

  /**
   * 检查约束是否应断裂。
   * @param appliedForce 本帧施加的冲量幅值 (与 breakForce 同量纲)。
   * @returns 是否标记为断裂 (已断裂的返回 false)。
   */
  checkBreak(id: number, appliedForce: number): boolean {
    const c = this.constraints.get(id);
    if (!c || c.isBroken) return false;
    if (c.breakForce === undefined) return false;
    if (appliedForce >= c.breakForce) {
      c.isBroken = true;
      return true;
    }
    return false;
  }

  /** 获取所有已断裂约束。 */
  getBrokenConstraints(): PhysicsConstraint[] {
    const out: PhysicsConstraint[] = [];
    for (const c of this.constraints.values()) {
      if (c.isBroken) out.push(c);
    }
    return out;
  }

  /** 清空所有约束 (不重置 nextId,避免 id 复用导致悬空引用)。 */
  clear(): void {
    this.constraints.clear();
  }

  /**
   * 求解所有约束 (迭代 iterations 次)。
   * 每次迭代顺序求解每个约束 (Gauss-Seidel)。
   */
  solve(dt: number): void {
    if (dt <= 0) return;
    this.solveCount++;
    this.totalImpulse = 0;
    const dts = Math.max(dt, 1e-6);
    for (let it = 0; it < this.iterations; it++) {
      for (const c of this.constraints.values()) {
        if (!c.enabled || c.isBroken) continue;
        this.solveOne(c, dts);
      }
    }
    // 求解后统一检查断裂
    for (const c of this.constraints.values()) {
      if (!c.enabled || c.isBroken) continue;
      if (c.breakForce !== undefined && c.lastImpulseMagnitude >= c.breakForce) {
        c.isBroken = true;
      }
    }
  }

  /** 按 type 分派到具体求解器。 */
  private solveOne(c: PhysicsConstraint, dts: number): void {
    switch (c.type) {
      case 'fixed': this.solveFixed(c, dts); break;
      case 'hinge': this.solveHinge(c, dts); break;
      case 'ball': this.solveBall(c, dts); break;
      case 'slider': this.solveSlider(c, dts); break;
      case 'spring': this.solveSpring(c, dts); break;
      case 'cone': this.solveCone(c, dts); break;
    }
  }

  // ── 具体求解器 ──────────────────────────────────────────────

  /** 固定约束:锁定相对位置与旋转 (同 FixedJointConstraint)。 */
  solveFixed(c: PhysicsConstraint, dts: number): void {
    const A = c.bodyA, B = c.bodyB;
    if (!A || !B) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;

    // 1) 点约束
    const rA = c.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = c.anchorB.clone().applyQuaternion(B.quaternion);
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
      this.accumulateImpulse(c, P.length());
    }

    // 2) 角约束 (锁定相对朝向) — 首次求解记录 qRel0
    const qAInv = A.quaternion.clone().invert();
    const qRel = B.quaternion.clone().multiply(qAInv);
    if (!(c as any)._qRel0) {
      (c as any)._qRel0 = qRel.clone();
    }
    const qRel0 = (c as any)._qRel0 as Quaternion;
    const qRel0Inv = qRel0.clone().invert();
    const qErr = qRel.clone().multiply(qRel0Inv);
    const axis = new Vector3();
    const angle = qErr.toAxisAngle(axis);
    if (angle > 1e-6 && totalInv > 0) {
      const corrAngle = -angle * this.rotationBeta;
      if (A.invMass > 0 && B.invMass > 0) {
        const half = new Quaternion().setFromAxisAngle(axis, corrAngle * 0.5);
        const halfNeg = new Quaternion().setFromAxisAngle(axis, -corrAngle * 0.5);
        B.quaternion.premultiply(half).normalize();
        A.quaternion.premultiply(halfNeg).normalize();
      } else if (B.invMass > 0) {
        B.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, corrAngle)).normalize();
      } else if (A.invMass > 0) {
        A.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, -corrAngle)).normalize();
      }
    }
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    const angBias = axis.clone().multiplyScalar((this.rotationVelBeta / dts) * angle);
    const angTarget = omegaRel.clone().negate().add(angBias);
    const KAng = angEffectiveMass(A, B);
    const KAngInv = mat3Inverse(KAng);
    if (KAngInv) {
      const L = mat3MulVec(KAngInv, angTarget, new Vector3());
      applyAngularImpulse(B, L);
      applyAngularImpulse(A, L.clone().negate());
      this.accumulateImpulse(c, L.length());
    }
  }

  /** 铰链约束:只允许绕一个轴旋转 (同 HingeJointConstraint)。 */
  solveHinge(c: PhysicsConstraint, dts: number): void {
    const A = c.bodyA, B = c.bodyB;
    if (!A || !B) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;
    if (!c.axis) return;

    // 1) 点约束
    const rA = c.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = c.anchorB.clone().applyQuaternion(B.quaternion);
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
      this.accumulateImpulse(c, P.length());
    }

    // 2) 轴约束:限制非轴相对旋转
    const aA = c.axis.clone().applyQuaternion(A.quaternion).normalize();
    const aB = c.axis.clone().applyQuaternion(B.quaternion).normalize();
    const dotAA = aA.dot(aB);
    const axisErr = aB.clone().addScaledVector(aA, -dotAA);
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    const omegaRelAxis = omegaRel.dot(aA);
    const omegaRelPerp = omegaRel.clone().addScaledVector(aA, -omegaRelAxis);
    const angBias = axisErr.clone().multiplyScalar(-0.2 / dts);
    const angTarget = omegaRelPerp.clone().negate().add(angBias);
    const KAng = angEffectiveMass(A, B);
    const KAngInv = mat3Inverse(KAng);
    if (KAngInv) {
      let L = mat3MulVec(KAngInv, angTarget, new Vector3());
      const Laxis = L.dot(aA);
      L.addScaledVector(aA, -Laxis);
      applyAngularImpulse(B, L);
      applyAngularImpulse(A, L.clone().negate());
      this.accumulateImpulse(c, L.length());
    }

    // 3) 角度限制 (可选)
    if (c.limits) {
      this.solveHingeLimit(c, A, B, aA, dts);
    }
  }

  /** 铰链角度限制求解。 */
  private solveHingeLimit(
    c: PhysicsConstraint, A: RigidbodyLike, B: RigidbodyLike,
    aA: Vector3, _dts: number,
  ): void {
    if (!c.limits || !c.axis) return;
    // 计算绕轴的相对旋转角 (相对初始)
    if (!(c as any)._hingeRefAxis) {
      // 记录一个垂直于 axis 的参考方向,用于度量旋转角
      const ref = Math.abs(aA.x) < 0.9
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0);
      const r0 = ref.clone().addScaledVector(aA, -ref.dot(aA)).normalize();
      (c as any)._hingeRefAxis = r0;
    }
    const refA = (c as any)._hingeRefAxis as Vector3;
    // B 上的对应参考方向
    const refB = refA.clone().applyQuaternion(
      B.quaternion.clone().multiply(A.quaternion.clone().invert()),
    );
    // 投影到垂直于 aA 的平面
    const refBperp = refB.clone().addScaledVector(aA, -refB.dot(aA)).normalize();
    // 旋转角 = atan2(cross(refA, refBperp)·aA, refA·refBperp)
    const cross = refA.clone().cross(refBperp);
    const sin = cross.dot(aA);
    const cos = refA.dot(refBperp);
    const angle = Math.atan2(sin, cos);
    const { min, max, bounciness } = c.limits;
    if (angle < min) {
      const violation = min - angle;
      this.applyHingeAngleImpulse(c, A, B, aA, violation, +1, bounciness);
    } else if (angle > max) {
      const violation = angle - max;
      this.applyHingeAngleImpulse(c, A, B, aA, violation, -1, bounciness);
    }
  }

  /** 沿铰链轴施加角度限制冲量。 */
  private applyHingeAngleImpulse(
    c: PhysicsConstraint, A: RigidbodyLike, B: RigidbodyLike,
    aA: Vector3, violation: number, dir: number, bounciness: number,
  ): void {
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    const omegaAxis = omegaRel.dot(aA);
    const bias = dir * (this.velocityBeta / Math.max(1e-6, 1 / 60)) * violation * (1 + bounciness);
    const target = bias;
    const delta = target - omegaAxis;
    // 1-DOF 角有效质量
    const kA = mat3MulVec(A.invMass > 0 ? A.invInertia : IDENTITY_MAT3, aA, new Vector3()).dot(aA);
    const kB = mat3MulVec(B.invMass > 0 ? B.invInertia : IDENTITY_MAT3, aA, new Vector3()).dot(aA);
    const Kn = kA + kB;
    if (Kn <= 1e-12) return;
    const p = delta / Kn;
    const L = aA.clone().multiplyScalar(p);
    applyAngularImpulse(B, L);
    applyAngularImpulse(A, L.clone().negate());
    this.accumulateImpulse(c, Math.abs(p));
  }

  /** 球关节:两刚体在锚点连接,可自由旋转 (同 BallJointConstraint)。 */
  solveBall(c: PhysicsConstraint, dts: number): void {
    const A = c.bodyA, B = c.bodyB;
    if (!A || !B) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;

    const rA = c.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = c.anchorB.clone().applyQuaternion(B.quaternion);
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
    const bias = C.clone().multiplyScalar(-this.velocityBeta / dts);
    const target = vRel.clone().negate().add(bias);

    const K = computePointEffectiveMass(rA, rB, A, B);
    const Kinv = mat3Inverse(K);
    if (!Kinv) return;
    const P = mat3MulVec(Kinv, target, new Vector3());
    applyImpulse(B, P, rB);
    applyImpulse(A, P.clone().negate(), rA);
    this.accumulateImpulse(c, P.length());
  }

  /** 滑轨约束:只允许沿一个轴平移,锁定相对旋转 (同 SliderJointConstraint)。 */
  solveSlider(c: PhysicsConstraint, dts: number): void {
    const A = c.bodyA, B = c.bodyB;
    if (!A || !B) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;
    if (!c.axis) return;

    const ax = c.axis.clone().applyQuaternion(A.quaternion).normalize();

    // 1) 角约束:锁定相对旋转
    {
      const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
      const KAng = angEffectiveMass(A, B);
      const KAngInv = mat3Inverse(KAng);
      if (KAngInv) {
        const L = mat3MulVec(KAngInv, omegaRel.clone().negate(), new Vector3());
        applyAngularImpulse(B, L);
        applyAngularImpulse(A, L.clone().negate());
        this.accumulateImpulse(c, L.length());
      }
    }

    // 2) 线约束:消除垂直于轴的位置误差
    const rA = c.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = c.anchorB.clone().applyQuaternion(B.quaternion);
    const pA = A.position.clone().add(rA);
    const pB = B.position.clone().add(rB);
    const C = pB.clone().sub(pA);
    const CAxis = C.dot(ax);
    const CPerp = C.clone().addScaledVector(ax, -CAxis);

    const totalInv = A.invMass + B.invMass;
    if (totalInv > 0) {
      const corr = CPerp.clone().multiplyScalar(this.positionBeta / totalInv);
      A.position.addScaledVector(corr, A.invMass);
      B.position.addScaledVector(corr, -B.invMass);
    }

    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    const vRelPerp = vRel.clone().addScaledVector(ax, -vRel.dot(ax));
    const linBias = CPerp.clone().multiplyScalar(-this.velocityBeta / dts);
    const linTarget = vRelPerp.clone().negate().add(linBias);
    const K = computePointEffectiveMass(rA, rB, A, B);
    const Kinv = mat3Inverse(K);
    if (Kinv) {
      const P = mat3MulVec(Kinv, linTarget, new Vector3());
      applyImpulse(B, P, rB);
      applyImpulse(A, P.clone().negate(), rA);
      this.accumulateImpulse(c, P.length());
    }

    // 3) 距离限制 (沿轴)
    if (c.limits) {
      const dist = CAxis;
      if (dist < c.limits.min) {
        this.solveSliderAxisLimit(c, ax, c.limits.min - dist, +1, A, B, rA, rB, dts, c.limits.bounciness);
      } else if (dist > c.limits.max && Number.isFinite(c.limits.max)) {
        this.solveSliderAxisLimit(c, ax, dist - c.limits.max, -1, A, B, rA, rB, dts, c.limits.bounciness);
      }
    }
  }

  /** 滑轨沿轴距离限制。 */
  private solveSliderAxisLimit(
    c: PhysicsConstraint, ax: Vector3, violation: number, dir: number,
    A: RigidbodyLike, B: RigidbodyLike, rA: Vector3, rB: Vector3, dts: number, bounciness: number,
  ): void {
    const totalInv = A.invMass + B.invMass;
    if (totalInv <= 0) return;
    const corr = ax.clone().multiplyScalar(dir * violation * this.positionBeta);
    A.position.addScaledVector(corr, -A.invMass / totalInv);
    B.position.addScaledVector(corr, B.invMass / totalInv);

    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    const vAxis = vRel.dot(ax);
    const bias = dir * (this.velocityBeta / dts) * violation * (1 + bounciness);
    const deltaV = bias - vAxis;
    const Kn = scalarEffectiveMassAlongAxis(ax, rA, rB, A, B);
    if (Kn <= 1e-12) return;
    const p = deltaV / Kn;
    const P = ax.clone().multiplyScalar(p);
    applyImpulse(B, P, rB);
    applyImpulse(A, P.clone().negate(), rA);
    this.accumulateImpulse(c, Math.abs(p));
  }

  /**
   * 弹簧约束:胡克定律 F = -k*x - c*v。
   * 与 DistanceJointConstraint 的 CFM/ERP 软约束公式等价:
   *   K_eff = Kn + compliance/dt² + damping/dt
   *   p = (-(beta/dt)*C - vRel_n) / K_eff
   * 高刚度时附加位置投影 (Baumgarte) 保证几何收敛;
   * 低刚度时 positionProjectionBeta=0 退化为纯弹簧行为 (由速度软约束驱动)。
   */
  solveSpring(c: PhysicsConstraint, dts: number): void {
    const A = c.bodyA, B = c.bodyB;
    if (!A || !B) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;

    const rA = c.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = c.anchorB.clone().applyQuaternion(B.quaternion);
    const pA = A.position.clone().add(rA);
    const pB = B.position.clone().add(rB);
    const delta = pB.clone().sub(pA);
    let dist = delta.length();
    if (dist < 1e-9) {
      dist = 1e-9;
      delta.set(1, 0, 0);
    }
    const n = delta.clone().divideScalar(dist);
    const rest = c.restLength ?? 0;
    const C = dist - rest;

    const stiffness = c.stiffness ?? 1e6;
    const damping = c.damping ?? 0.5;

    // 位置投影 (高刚度时启用,使距离误差几何收敛)
    const totalInv = A.invMass + B.invMass;
    const isRigid = stiffness >= 1e5;
    const projBeta = isRigid ? this.positionBeta : 0;
    if (totalInv > 0 && projBeta > 0) {
      const corr = n.clone().multiplyScalar(C * projBeta / totalInv);
      A.position.addScaledVector(corr, A.invMass);
      B.position.addScaledVector(corr, -B.invMass);
    }

    const vAnchorA = A.velocity.clone().add(crossOmegaR(A.angularVelocity, rA));
    const vAnchorB = B.velocity.clone().add(crossOmegaR(B.angularVelocity, rB));
    const vRel = vAnchorB.clone().sub(vAnchorA);
    const vRel_n = vRel.dot(n);

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
    const compliance = stiffness > 0 ? 1 / stiffness : 0;
    const Keff = Kn + compliance / (dts * dts) + damping / dts;
    if (Keff <= 1e-12) return;

    const p = (-(this.velocityBeta / dts) * C - vRel_n) / Keff;
    const P = n.clone().multiplyScalar(p);
    applyImpulse(B, P, rB);
    applyImpulse(A, P.clone().negate(), rA);
    this.accumulateImpulse(c, Math.abs(p));
  }

  /**
   * 圆锥约束:限制 bodyB 相对 bodyA 的偏转角在锥角内 (cone twist limit)。
   * axis 为锥的中心轴 (bodyA 本地),limits.max 为半锥角 (弧度)。
   */
  solveCone(c: PhysicsConstraint, dts: number): void {
    const A = c.bodyA, B = c.bodyB;
    if (!A || !B) return;
    if (A.invMass <= 0 && B.invMass <= 0) return;
    if (!c.axis || !c.limits) return;

    // 1) 点约束 (锚点对齐)
    const rA = c.anchorA.clone().applyQuaternion(A.quaternion);
    const rB = c.anchorB.clone().applyQuaternion(B.quaternion);
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
      this.accumulateImpulse(c, P.length());
    }

    // 2) 锥角限制
    const aA = c.axis.clone().applyQuaternion(A.quaternion).normalize();
    const aB = c.axis.clone().applyQuaternion(B.quaternion).normalize();
    const dot = aA.dot(aB);
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
    const maxAngle = c.limits.max;
    if (angle <= maxAngle) return;

    // 误差方向:旋转 aB 回到锥内的旋转轴 = aA × aB
    const rotAxis = aA.clone().cross(aB);
    const axisLen = rotAxis.length();
    if (axisLen < 1e-9) return;
    rotAxis.divideScalar(axisLen);
    const violation = angle - maxAngle;

    // Baumgarte 朝向投影:旋转 B 使 angle 减小
    if (totalInv > 0) {
      const corrAngle = -violation * this.rotationBeta;
      if (A.invMass > 0 && B.invMass > 0) {
        const half = new Quaternion().setFromAxisAngle(rotAxis, corrAngle * 0.5);
        const halfNeg = new Quaternion().setFromAxisAngle(rotAxis, -corrAngle * 0.5);
        B.quaternion.premultiply(half).normalize();
        A.quaternion.premultiply(halfNeg).normalize();
      } else if (B.invMass > 0) {
        B.quaternion.premultiply(new Quaternion().setFromAxisAngle(rotAxis, corrAngle)).normalize();
      } else if (A.invMass > 0) {
        A.quaternion.premultiply(new Quaternion().setFromAxisAngle(rotAxis, -corrAngle)).normalize();
      }
    }

    // 速度修正:消除违反方向的相对角速度 + Baumgarte 偏置
    const omegaRel = B.angularVelocity.clone().sub(A.angularVelocity);
    const omegaAxis = omegaRel.dot(rotAxis); // 沿 rotAxis 的相对角速度 (正值=违反方向)
    const angBias = (this.rotationVelBeta / dts) * violation * (1 + c.limits.bounciness);
    const delta = angBias - omegaAxis;
    const kA = mat3MulVec(A.invMass > 0 ? A.invInertia : IDENTITY_MAT3, rotAxis, new Vector3()).dot(rotAxis);
    const kB = mat3MulVec(B.invMass > 0 ? B.invInertia : IDENTITY_MAT3, rotAxis, new Vector3()).dot(rotAxis);
    const Kn = kA + kB;
    if (Kn <= 1e-12) return;
    const p = delta / Kn;
    const L = rotAxis.clone().multiplyScalar(p);
    applyAngularImpulse(B, L);
    applyAngularImpulse(A, L.clone().negate());
    this.accumulateImpulse(c, Math.abs(p));
  }

  /** 累计本帧冲量幅值 (取单次 solve 内最大值,反映该约束本帧承受的峰值力)。 */
  private accumulateImpulse(c: PhysicsConstraint, mag: number): void {
    if (mag > c.lastImpulseMagnitude) c.lastImpulseMagnitude = mag;
    this.totalImpulse += mag;
  }

  /** 获取统计。 */
  getStats(): ConstraintSystemStats {
    const byType: Record<ConstraintType, number> = {
      fixed: 0, hinge: 0, ball: 0, slider: 0, spring: 0, cone: 0,
    };
    let enabled = 0;
    let broken = 0;
    for (const c of this.constraints.values()) {
      byType[c.type]++;
      if (c.isBroken) broken++;
      // enabled 统计"实际会被求解"的约束:已启用且未断裂
      if (c.enabled && !c.isBroken) enabled++;
    }
    return {
      total: this.constraints.size,
      enabled,
      broken,
      byType,
      solveCount: this.solveCount,
      totalImpulse: this.totalImpulse,
    };
  }
}

// ── 模块内辅助函数 ──────────────────────────────────────────

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

/** cross(r, ax)。 */
function crossR(r: Vector3, ax: Vector3): Vector3 {
  return new Vector3(
    r.y * ax.z - r.z * ax.y,
    r.z * ax.x - r.x * ax.z,
    r.x * ax.y - r.y * ax.x,
  );
}

/** 沿轴的标量有效质量 (含角响应)。 */
function scalarEffectiveMassAlongAxis(
  ax: Vector3, rA: Vector3, rB: Vector3,
  A: RigidbodyLike, B: RigidbodyLike,
): number {
  const rAx = crossR(rA, ax);
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
