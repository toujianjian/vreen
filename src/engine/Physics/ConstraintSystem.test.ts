// ConstraintSystem.test.ts — 物理约束系统 (ConstraintSystem) 测试。
//
// 复用 Constraints.test.ts 的 MockRigidbody 模式,验证:
//   * createConstraint / removeConstraint / getConstraint / getConstraints 管理
//   * 各类型约束 (fixed/hinge/ball/slider/spring/cone) 求解不抛错且收敛
//   * 断裂检测 (breakForce) 与 getBrokenConstraints
//   * setBreakForce / setLimits / setStiffness / setDamping 配置
//   * getStats 统计
//   * clear 清空

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import type { RigidbodyLike } from './Constraint';
import {
  ConstraintSystem,
  type ConstraintType,
} from './ConstraintSystem';

const IDENTITY_INV_INERTIA = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO_INV_INERTIA = [0, 0, 0, 0, 0, 0, 0, 0, 0];

interface MockOpts {
  position?: [number, number, number];
  mass?: number;
  velocity?: [number, number, number];
}

class MockRigidbody implements RigidbodyLike {
  position: Vector3;
  quaternion: Quaternion = new Quaternion();
  velocity: Vector3;
  angularVelocity: Vector3 = new Vector3();
  mass: number;
  invMass: number;
  invInertia: number[];

  constructor(opts: MockOpts = {}) {
    const p = opts.position ?? [0, 0, 0];
    this.position = new Vector3(p[0], p[1], p[2]);
    const v = opts.velocity ?? [0, 0, 0];
    this.velocity = new Vector3(v[0], v[1], v[2]);
    this.mass = opts.mass ?? 1;
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.invInertia = this.invMass > 0 ? IDENTITY_INV_INERTIA.slice() : ZERO_INV_INERTIA.slice();
  }
}

const DT = 1 / 60;

describe('ConstraintSystem — 管理接口', () => {
  it('默认构造空系统', () => {
    const sys = new ConstraintSystem();
    expect(sys.getConstraintCount()).toBe(0);
    expect(sys.getConstraints()).toHaveLength(0);
    expect(sys.nextId).toBe(1);
  });

  it('createConstraint 返回递增 id', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id1 = sys.createConstraint('ball', A, B, {});
    const id2 = sys.createConstraint('fixed', A, B, {});
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(sys.getConstraintCount()).toBe(2);
  });

  it('getConstraint 返回正确约束', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('ball', A, B, { anchorA: new Vector3(1, 0, 0) });
    const c = sys.getConstraint(id);
    expect(c).toBeDefined();
    expect(c!.type).toBe('ball');
    expect(c!.anchorA.x).toBe(1);
    expect(c!.bodyA).toBe(A);
    expect(c!.bodyB).toBe(B);
  });

  it('getConstraint 不存在的 id 返回 undefined', () => {
    const sys = new ConstraintSystem();
    expect(sys.getConstraint(999)).toBeUndefined();
  });

  it('getConstraints 按 id 升序返回', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    sys.createConstraint('ball', A, B, {});
    sys.createConstraint('fixed', A, B, {});
    sys.createConstraint('hinge', A, B, {});
    const list = sys.getConstraints();
    expect(list.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('removeConstraint 移除并返回 true/false', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('ball', A, B, {});
    expect(sys.removeConstraint(id)).toBe(true);
    expect(sys.getConstraintCount()).toBe(0);
    expect(sys.removeConstraint(id)).toBe(false);
    expect(sys.removeConstraint(999)).toBe(false);
  });

  it('clear 清空所有约束', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    sys.createConstraint('ball', A, B, {});
    sys.createConstraint('fixed', A, B, {});
    sys.clear();
    expect(sys.getConstraintCount()).toBe(0);
  });

  it('cone 类型默认 axis 为 +Y,limits 半角 π/4', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('cone', A, B, {});
    const c = sys.getConstraint(id);
    expect(c!.axis).toBeDefined();
    expect(c!.axis!.y).toBeCloseTo(1, 5);
    expect(c!.limits).toBeDefined();
    expect(c!.limits!.max).toBeCloseTo(Math.PI / 4, 5);
  });

  it('spring 类型默认 restLength 取初始锚点距离', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 1 });
    const B = new MockRigidbody({ position: [5, 0, 0], mass: 1 });
    const id = sys.createConstraint('spring', A, B, {});
    const c = sys.getConstraint(id);
    expect(c!.restLength).toBeCloseTo(5, 5);
  });
});

describe('ConstraintSystem — 配置接口', () => {
  it('setBreakForce 设置断开力', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('ball', A, B, {});
    expect(sys.setBreakForce(id, 100)).toBe(true);
    expect(sys.getConstraint(id)!.breakForce).toBe(100);
    expect(sys.setBreakForce(id, undefined)).toBe(true);
    expect(sys.getConstraint(id)!.breakForce).toBeUndefined();
    expect(sys.setBreakForce(999, 100)).toBe(false);
  });

  it('setLimits 设置限制', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('hinge', A, B, {});
    expect(sys.setLimits(id, { min: -1, max: 1, bounciness: 0.5 })).toBe(true);
    const c = sys.getConstraint(id)!;
    expect(c.limits).toEqual({ min: -1, max: 1, bounciness: 0.5 });
    expect(sys.setLimits(999, { min: 0, max: 1, bounciness: 0 })).toBe(false);
  });

  it('setStiffness 设置刚度', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('spring', A, B, {});
    expect(sys.setStiffness(id, 500)).toBe(true);
    expect(sys.getConstraint(id)!.stiffness).toBe(500);
    expect(sys.setStiffness(999, 100)).toBe(false);
  });

  it('setDamping 设置阻尼', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('spring', A, B, {});
    expect(sys.setDamping(id, 0.8)).toBe(true);
    expect(sys.getConstraint(id)!.damping).toBe(0.8);
    expect(sys.setDamping(999, 0.5)).toBe(false);
  });

  it('checkBreak 标记断裂并返回 true', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('ball', A, B, { breakForce: 50 });
    expect(sys.checkBreak(id, 30)).toBe(false);
    expect(sys.getConstraint(id)!.isBroken).toBe(false);
    expect(sys.checkBreak(id, 60)).toBe(true);
    expect(sys.getConstraint(id)!.isBroken).toBe(true);
    // 已断裂的再次检查返回 false
    expect(sys.checkBreak(id, 100)).toBe(false);
  });

  it('checkBreak 不可断裂约束返回 false', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id = sys.createConstraint('ball', A, B, {}); // 无 breakForce
    expect(sys.checkBreak(id, 1e9)).toBe(false);
    expect(sys.getConstraint(id)!.isBroken).toBe(false);
  });

  it('getBrokenConstraints 返回所有已断裂约束', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const id1 = sys.createConstraint('ball', A, B, { breakForce: 10 });
    const id2 = sys.createConstraint('fixed', A, B, { breakForce: 10 });
    sys.checkBreak(id1, 20);
    sys.checkBreak(id2, 20);
    const broken = sys.getBrokenConstraints();
    expect(broken).toHaveLength(2);
    expect(broken.map((c) => c.id).sort()).toEqual([1, 2]);
  });
});

describe('ConstraintSystem — 求解 (各类型收敛)', () => {
  it('solve 跳过 disabled 与已断裂约束', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    const id = sys.createConstraint('ball', A, B, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
    });
    const c = sys.getConstraint(id)!;
    c.enabled = false;
    sys.solve(DT);
    // B 不应移动
    expect(B.position.x).toBeCloseTo(3, 5);
    // 启用后再求解应收敛
    c.enabled = true;
    sys.solve(DT);
    expect(B.position.x).toBeCloseTo(2, 1);
  });

  it('ball 约束:两锚点世界位置收敛', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    sys.createConstraint('ball', A, B, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
    });
    sys.solve(DT);
    const anchorA = new Vector3(1, 0, 0).applyQuaternion(A.quaternion).add(A.position);
    const anchorB = new Vector3(-1, 0, 0).applyQuaternion(B.quaternion).add(B.position);
    expect(anchorA.distanceTo(anchorB)).toBeLessThan(0.01);
    expect(B.position.x).toBeCloseTo(2, 1);
  });

  it('ball 约束:两动态刚体按质量比收敛', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 1 });
    const B = new MockRigidbody({ position: [4, 0, 0], mass: 1 });
    sys.createConstraint('ball', A, B, {});
    sys.solve(DT);
    expect(A.position.x).toBeCloseTo(2, 1);
    expect(B.position.x).toBeCloseTo(2, 1);
  });

  it('fixed 约束:锁定相对位置', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [2, 0, 0], mass: 1 });
    sys.createConstraint('fixed', A, B, {});
    sys.solve(DT);
    expect(B.position.length()).toBeLessThan(0.05);
  });

  it('fixed 约束:锁定相对朝向', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [0, 0, 0], mass: 1 });
    B.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
    sys.createConstraint('fixed', A, B, {});
    for (let i = 0; i < 10; i++) sys.solve(DT);
    const axis = new Vector3();
    const angle = B.quaternion.toAxisAngle(axis);
    expect(Math.abs(angle - 0.3)).toBeLessThan(0.1);
  });

  it('hinge 约束:不抛错且锚点收敛', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    sys.createConstraint('hinge', A, B, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
      axis: new Vector3(1, 0, 0),
    });
    expect(() => sys.solve(DT)).not.toThrow();
    const anchorA = new Vector3(1, 0, 0).applyQuaternion(A.quaternion).add(A.position);
    const anchorB = new Vector3(-1, 0, 0).applyQuaternion(B.quaternion).add(B.position);
    expect(anchorA.distanceTo(anchorB)).toBeLessThan(0.1);
  });

  it('slider 约束:锁定垂直偏移', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [2, 1, 0], mass: 1 });
    sys.createConstraint('slider', A, B, {
      axis: new Vector3(1, 0, 0),
      limits: { min: 0, max: 1, bounciness: 0 },
    });
    sys.solve(DT);
    expect(Math.abs(B.position.y)).toBeLessThan(0.15);
  });

  it('spring 约束:高刚度维持静止长度', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [5, 0, 0], mass: 1 });
    const id = sys.createConstraint('spring', A, B, {
      stiffness: 1e6,
      damping: 0.5,
      restLength: 3,
    });
    // 修正 restLength (因为创建时自动取了初始距离 5,这里覆盖回 3)
    sys.getConstraint(id)!.restLength = 3;
    sys.solve(DT);
    const dist = A.position.distanceTo(B.position);
    expect(Math.abs(dist - 3)).toBeLessThan(0.5);
  });

  it('cone 约束:不抛错', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [0, 1, 0], mass: 1 });
    sys.createConstraint('cone', A, B, {
      axis: new Vector3(0, 1, 0),
      limits: { min: 0, max: Math.PI / 6, bounciness: 0 },
    });
    expect(() => sys.solve(DT)).not.toThrow();
  });

  it('solve 对 dt<=0 不操作', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    sys.createConstraint('ball', A, B, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
    });
    sys.solve(0);
    sys.solve(-1);
    expect(B.position.x).toBeCloseTo(3, 5);
  });

  it('solve 跳过两静态刚体', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 0 });
    sys.createConstraint('ball', A, B, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
    });
    expect(() => sys.solve(DT)).not.toThrow();
    expect(B.position.x).toBeCloseTo(3, 5);
  });
});

describe('ConstraintSystem — 断裂求解', () => {
  it('solve 自动检测断裂 (冲量超 breakForce)', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [10, 0, 0], mass: 1, velocity: [0, 0, 0] });
    // 极小的 breakForce,求解时冲量必定超过 → 断裂
    sys.createConstraint('ball', A, B, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
      breakForce: 1e-9,
    });
    sys.solve(DT);
    const broken = sys.getBrokenConstraints();
    expect(broken.length).toBeGreaterThanOrEqual(1);
  });

  it('断裂后的约束在后续 solve 中被跳过', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    const id = sys.createConstraint('ball', A, B, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
    });
    // 手动标记断裂
    sys.getConstraint(id)!.isBroken = true;
    sys.solve(DT);
    // B 不应移动
    expect(B.position.x).toBeCloseTo(3, 5);
  });
});

describe('ConstraintSystem — 统计', () => {
  it('getStats 返回正确统计', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    sys.createConstraint('ball', A, B, {});
    sys.createConstraint('fixed', A, B, {});
    sys.createConstraint('spring', A, B, {});
    const id4 = sys.createConstraint('hinge', A, B, { breakForce: 1 });
    sys.createConstraint('cone', A, B, {});
    sys.createConstraint('slider', A, B, {});

    sys.checkBreak(id4, 100); // 标记断裂

    const stats = sys.getStats();
    expect(stats.total).toBe(6);
    expect(stats.enabled).toBe(5); // 断裂的也算 enabled (除非显式 disable)
    expect(stats.broken).toBe(1);
    expect(stats.byType.ball).toBe(1);
    expect(stats.byType.fixed).toBe(1);
    expect(stats.byType.spring).toBe(1);
    expect(stats.byType.hinge).toBe(1);
    expect(stats.byType.cone).toBe(1);
    expect(stats.byType.slider).toBe(1);
    expect(stats.solveCount).toBe(0);
  });

  it('solveCount 在 solve 后递增', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    sys.createConstraint('ball', A, B, {});
    sys.solve(DT);
    sys.solve(DT);
    expect(sys.getStats().solveCount).toBe(2);
  });

  it('byType 初始全为 0', () => {
    const sys = new ConstraintSystem();
    const stats = sys.getStats();
    const types: ConstraintType[] = ['fixed', 'hinge', 'ball', 'slider', 'spring', 'cone'];
    for (const t of types) {
      expect(stats.byType[t]).toBe(0);
    }
  });
});

describe('ConstraintSystem — 多约束链式求解', () => {
  it('三体球关节链收敛', () => {
    const sys = new ConstraintSystem();
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B1 = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    const B2 = new MockRigidbody({ position: [6, 0, 0], mass: 1 });

    sys.createConstraint('ball', A, B1, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
    });
    sys.createConstraint('ball', B1, B2, {
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
    });

    sys.iterations = 20;
    sys.solve(DT);

    expect(B1.position.x).toBeCloseTo(2, 1);
    expect(B2.position.x).toBeCloseTo(4, 1);
  });
});
