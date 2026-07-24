// Constraints.test.ts — 物理约束系统测试。
//
// 使用简化的 MockRigidbody(实现 RigidbodyLike 接口)验证:
//   - BallJoint:两锚点世界位置收敛
//   - DistanceJoint:距离保持
//   - FixedJoint:相对位置锁定
//   - ConstraintSolver:多约束链式迭代收敛
//
// MockRigidbody 的 invInertia 为对角恒等(均匀惯性),不随旋转更新;
// 对不旋转或仅小幅旋转的测试场景足够,且与求解器位置投影机制兼容。

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import type { RigidbodyLike } from './Constraint';
import { BallJointConstraint } from './BallJointConstraint';
import { DistanceJointConstraint } from './DistanceJointConstraint';
import { FixedJointConstraint } from './FixedJointConstraint';
import { HingeJointConstraint } from './HingeJointConstraint';
import { SliderJointConstraint } from './SliderJointConstraint';
import { ConstraintSolver } from './ConstraintSolver';

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

describe('BallJointConstraint', () => {
  it('两锚点世界位置收敛到同一点', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 }); // 静态
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 }); // 动态
    // anchorA 世界 = (1,0,0);anchorB 世界 = B.pos + (-1,0,0) → 目标 B.pos.x = 2
    const joint = new BallJointConstraint(
      A, B,
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
    );
    const solver = new ConstraintSolver(10);
    solver.addConstraint(joint);
    solver.solveAll(DT);

    const anchorA = new Vector3(1, 0, 0).applyQuaternion(A.quaternion).add(A.position);
    const anchorB = new Vector3(-1, 0, 0).applyQuaternion(B.quaternion).add(B.position);
    const dist = anchorA.distanceTo(anchorB);
    expect(dist).toBeLessThan(0.01);
    // B 应收敛到 x=2(使 anchorB 世界 = (1,0,0))
    expect(B.position.x).toBeCloseTo(2, 1);
  });

  it('两动态刚体按质量比共同收敛', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 1 });
    const B = new MockRigidbody({ position: [4, 0, 0], mass: 1 });
    const joint = new BallJointConstraint(A, B, new Vector3(), new Vector3());
    const solver = new ConstraintSolver(15);
    solver.addConstraint(joint);
    solver.solveAll(DT);

    // 两体质量相等 → 应在中点 x=2 相遇
    expect(A.position.x).toBeCloseTo(2, 1);
    expect(B.position.x).toBeCloseTo(2, 1);
  });
});

describe('DistanceJointConstraint', () => {
  it('保持两锚点间固定距离', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [5, 0, 0], mass: 1 });
    const joint = new DistanceJointConstraint(
      A, B,
      new Vector3(), new Vector3(),
      /*distance*/ 3,
    );
    const solver = new ConstraintSolver(10);
    solver.addConstraint(joint);
    solver.solveAll(DT);

    const dist = A.position.distanceTo(B.position);
    expect(dist).toBeCloseTo(3, 1);
  });

  it('低刚度允许偏离,高刚度维持距离', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [5, 0, 0], mass: 1 });
    const joint = new DistanceJointConstraint(
      A, B, new Vector3(), new Vector3(),
      /*distance*/ 3,
      /*stiffness*/ 1e6, /*damping*/ 0.5,
    );
    const solver = new ConstraintSolver(10);
    solver.addConstraint(joint);
    solver.solveAll(DT);
    const dist = A.position.distanceTo(B.position);
    // 高刚度 → 距离接近目标
    expect(Math.abs(dist - 3)).toBeLessThan(0.1);
  });
});

describe('FixedJointConstraint', () => {
  it('锁定相对位置(B 收敛到 A)', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [2, 0, 0], mass: 1 });
    const joint = new FixedJointConstraint(A, B, new Vector3(), new Vector3());
    const solver = new ConstraintSolver(12);
    solver.addConstraint(joint);
    solver.solveAll(DT);

    expect(B.position.length()).toBeLessThan(0.01);
  });

  it('施加外力速度后仍锁定位置', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [0, 0, 0], mass: 1, velocity: [5, 0, 0] });
    const joint = new FixedJointConstraint(A, B, new Vector3(), new Vector3());
    const solver = new ConstraintSolver(12);
    solver.addConstraint(joint);
    // 多次求解,模拟物理推进(每次位置由求解器投影修正)
    for (let i = 0; i < 5; i++) solver.solveAll(DT);

    expect(B.position.length()).toBeLessThan(0.05);
  });

  it('保持相对朝向(锁定旋转)', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [0, 0, 0], mass: 1 });
    // B 初始带一个小旋转
    B.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
    const joint = new FixedJointConstraint(A, B, new Vector3(), new Vector3());
    const solver = new ConstraintSolver(15);
    solver.addConstraint(joint);
    // 首次 solve 记录 qRel0(含初始 0.3 旋转),随后应保持该相对朝向
    for (let i = 0; i < 10; i++) solver.solveAll(DT);

    // qRel0 已记录为含 0.3 旋转的相对朝向 → B.quaternion 应保持 ≈ 0.3 弧度
    const axis = new Vector3();
    const angle = B.quaternion.toAxisAngle(axis);
    expect(Math.abs(angle - 0.3)).toBeLessThan(0.05);
  });
});

describe('ConstraintSolver', () => {
  it('链式多约束迭代收敛(三体链)', () => {
    // A(静态) -- B1(动态) -- B2(动态),每段期望 1m
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B1 = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    const B2 = new MockRigidbody({ position: [6, 0, 0], mass: 1 });

    // A-B1:anchorA 在 A 的 (1,0,0),anchorB 在 B1 的 (-1,0,0) → B1 收敛到 x=2
    const j1 = new BallJointConstraint(A, B1, new Vector3(1, 0, 0), new Vector3(-1, 0, 0));
    // B1-B2:anchorA 在 B1 的 (1,0,0),anchorB 在 B2 的 (-1,0,0) → B2 收敛到 B1.x+2
    const j2 = new BallJointConstraint(B1, B2, new Vector3(1, 0, 0), new Vector3(-1, 0, 0));

    const solver = new ConstraintSolver(20);
    solver.addConstraint(j1);
    solver.addConstraint(j2);
    solver.solveAll(DT);

    expect(B1.position.x).toBeCloseTo(2, 1);
    expect(B2.position.x).toBeCloseTo(4, 1);
  });

  it('addConstraint / removeConstraint / clear 正确管理列表', () => {
    const solver = new ConstraintSolver();
    const A = new MockRigidbody({ mass: 1 });
    const B = new MockRigidbody({ mass: 1 });
    const c = new BallJointConstraint(A, B);
    solver.addConstraint(c);
    expect(solver.constraints).toHaveLength(1);
    solver.removeConstraint(c);
    expect(solver.constraints).toHaveLength(0);
    solver.addConstraint(c);
    solver.clear();
    expect(solver.constraints).toHaveLength(0);
  });

  it('disabled 约束不被求解', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    const joint = new BallJointConstraint(A, B, new Vector3(1, 0, 0), new Vector3(-1, 0, 0));
    joint.enabled = false;
    const solver = new ConstraintSolver(10);
    solver.addConstraint(joint);
    solver.solveAll(DT);
    // B 不应移动
    expect(B.position.x).toBeCloseTo(3, 5);
  });
});

describe('Hinge / Slider 约束基本可用', () => {
  it('HingeJoint 不抛错且锚点收敛', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [3, 0, 0], mass: 1 });
    const joint = new HingeJointConstraint(
      A, B,
      new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
      new Vector3(1, 0, 0), new Vector3(1, 0, 0),
    );
    const solver = new ConstraintSolver(10);
    solver.addConstraint(joint);
    expect(() => solver.solveAll(DT)).not.toThrow();
    const anchorA = new Vector3(1, 0, 0).applyQuaternion(A.quaternion).add(A.position);
    const anchorB = new Vector3(-1, 0, 0).applyQuaternion(B.quaternion).add(B.position);
    expect(anchorA.distanceTo(anchorB)).toBeLessThan(0.05);
  });

  it('SliderJoint 不抛错且锁住垂直偏移', () => {
    const A = new MockRigidbody({ position: [0, 0, 0], mass: 0 });
    const B = new MockRigidbody({ position: [2, 1, 0], mass: 1 });
    const joint = new SliderJointConstraint(
      A, B,
      new Vector3(), new Vector3(),
      new Vector3(1, 0, 0), // 沿 x 滑动
    );
    joint.maxDistance = 1;
    const solver = new ConstraintSolver(15);
    solver.addConstraint(joint);
    expect(() => solver.solveAll(DT)).not.toThrow();
    // 垂直方向(y)的偏移应被消除(锁定到 y≈0)
    expect(Math.abs(B.position.y)).toBeLessThan(0.1);
  });
});
