// SpringSolver 单元测试 —— 验证二次骨骼弹簧物理。
//
// 覆盖:
//   - 构造默认值(gravity / fixedDt / maxSubsteps)
//   - addBone / removeBone / getBone / clear
//   - 无骨骼 update 不崩溃
//   - 重力作用 1 秒 → offset.y < 0(下落)
//   - 刚度拉回:位移后 offset 随时间减小
//   - 阻尼衰减:速度模长每帧递减
//   - reset 清零 offset 与 velocity
//   - 子步进:dt=1 + fixedDt=1/60 → 受 maxSubsteps 上限
//   - 多骨骼独立更新

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { SpringSolver, type SpringBone } from './SpringSolver';

/** 构造一个 SpringBone,允许覆盖默认参数。 */
function makeBone(name: string, overrides: Partial<SpringBone> = {}): SpringBone {
  return {
    name,
    stiffness: 100,
    damping: 0.3,
    gravity: 9.81,
    length: 0.1,
    offset: new Vector3(0, 0, 0),
    velocity: new Vector3(0, 0, 0),
    restDirection: new Vector3(0, 1, 0),
    ...overrides,
  };
}

/** 返回固定 rest 姿态的 getBoneTransform,可记录调用次数。 */
function makeTransformSink(rest = new Vector3(0, 1, 0)) {
  let calls = 0;
  const getBoneTransform = (_name: string) => {
    calls++;
    return { position: rest, rotation: new Quaternion() };
  };
  const setBoneTransform = () => { /* no-op */ };
  return { getBoneTransform, setBoneTransform, calls: () => calls };
}

describe('SpringSolver', () => {
  describe('构造与默认值', () => {
    it('默认 gravity = (0, -9.81, 0), fixedDt = 1/60, maxSubsteps = 4', () => {
      const s = new SpringSolver();
      expect(s.gravity.x).toBe(0);
      expect(s.gravity.y).toBeCloseTo(-9.81, 6);
      expect(s.gravity.z).toBe(0);
      expect(s.fixedDt).toBeCloseTo(1 / 60, 8);
      expect(s.maxSubsteps).toBe(4);
    });

    it('自定义选项生效', () => {
      const s = new SpringSolver({
        gravity: new Vector3(0, -5, 0),
        fixedDt: 0.02,
        maxSubsteps: 8,
      });
      expect(s.gravity.y).toBe(-5);
      expect(s.fixedDt).toBe(0.02);
      expect(s.maxSubsteps).toBe(8);
    });

    it('maxSubsteps 至少为 1', () => {
      const s = new SpringSolver({ maxSubsteps: 0 });
      expect(s.maxSubsteps).toBe(1);
    });
  });

  describe('骨骼管理', () => {
    it('addBone / getBone / removeBone / clear', () => {
      const s = new SpringSolver();
      const b = makeBone('Hair');
      s.addBone(b);
      expect(s.getBone('Hair')).toBe(b);
      expect(s.removeBone('Hair')).toBe(true);
      expect(s.getBone('Hair')).toBeUndefined();
      expect(s.removeBone('Hair')).toBe(false);

      s.addBone(makeBone('A'));
      s.addBone(makeBone('B'));
      s.clear();
      expect(s.bones.size).toBe(0);
    });
  });

  describe('update 行为', () => {
    it('无骨骼 update 不崩溃', () => {
      const s = new SpringSolver();
      const sink = makeTransformSink();
      expect(() => s.update(0.1, sink.getBoneTransform, sink.setBoneTransform)).not.toThrow();
    });

    it('dt <= 0 不调用回调', () => {
      const s = new SpringSolver();
      s.addBone(makeBone('B'));
      const sink = makeTransformSink();
      s.update(0, sink.getBoneTransform, sink.setBoneTransform);
      expect(sink.calls()).toBe(0);
    });

    it('重力作用 1 秒 → offset.y < 0(下落)', () => {
      const s = new SpringSolver({ maxSubsteps: 120 });
      // 无刚度、无阻尼,纯自由落体。
      const b = makeBone('Ear', { stiffness: 0, damping: 0 });
      s.addBone(b);
      const sink = makeTransformSink();
      s.update(1, sink.getBoneTransform, sink.setBoneTransform);
      expect(b.offset.y).toBeLessThan(0);
      // 自由落体 1s 解析解 0.5*-9.81*1^2 = -4.905;半隐式 Euler 略偏大。
      // 容差 0.5(一个量级)覆盖积分误差。
      expect(b.offset.y).toBeCloseTo(-4.905, 0);
    });

    it('刚度拉回:位移后 offset 随时间单调减小(过阻尼)', () => {
      const s = new SpringSolver({ gravity: new Vector3(0, 0, 0), maxSubsteps: 60 });
      // 过阻尼系统:damping=30, stiffness=100 → ζ=1.5 > 1,单调衰减无振荡。
      const b = makeBone('Tail', { stiffness: 100, damping: 30, offset: new Vector3(1, 0, 0) });
      s.addBone(b);
      const sink = makeTransformSink();
      s.update(0.1, sink.getBoneTransform, sink.setBoneTransform);
      const after1 = b.offset.x;
      expect(after1).toBeLessThan(1);
      expect(after1).toBeGreaterThan(0);
      s.update(0.1, sink.getBoneTransform, sink.setBoneTransform);
      const after2 = b.offset.x;
      // 单调递减
      expect(after2).toBeLessThan(after1);
    });

    it('阻尼衰减速度:无刚度/重力时速度模长每帧递减', () => {
      const s = new SpringSolver({ gravity: new Vector3(0, 0, 0) });
      const b = makeBone('Hair', { stiffness: 0, damping: 1, velocity: new Vector3(1, 0, 0) });
      s.addBone(b);
      const sink = makeTransformSink();
      const v0 = b.velocity.length();
      s.update(1 / 60, sink.getBoneTransform, sink.setBoneTransform);
      const v1 = b.velocity.length();
      s.update(1 / 60, sink.getBoneTransform, sink.setBoneTransform);
      const v2 = b.velocity.length();
      expect(v1).toBeLessThan(v0);
      expect(v2).toBeLessThan(v1);
    });

    it('reset 清零 offset 与 velocity', () => {
      const s = new SpringSolver();
      const b = makeBone('Hair', {
        offset: new Vector3(1, 2, 3),
        velocity: new Vector3(4, 5, 6),
      });
      s.addBone(b);
      s.reset();
      expect(b.offset.x).toBe(0);
      expect(b.offset.y).toBe(0);
      expect(b.offset.z).toBe(0);
      expect(b.velocity.x).toBe(0);
      expect(b.velocity.y).toBe(0);
      expect(b.velocity.z).toBe(0);
    });

    it('子步进:dt=1 + fixedDt=1/60 受 maxSubsteps 上限', () => {
      const s = new SpringSolver({ fixedDt: 1 / 60, maxSubsteps: 4 });
      s.addBone(makeBone('Hair'));
      const sink = makeTransformSink();
      s.update(1, sink.getBoneTransform, sink.setBoneTransform);
      // 每子步每骨骼调用一次 getBoneTransform,上限 4 次。
      expect(sink.calls()).toBe(4);
    });

    it('子步进:小 dt 不被截断', () => {
      const s = new SpringSolver({ fixedDt: 1 / 60, maxSubsteps: 4 });
      s.addBone(makeBone('Hair'));
      const sink = makeTransformSink();
      s.update(1 / 60, sink.getBoneTransform, sink.setBoneTransform);
      expect(sink.calls()).toBe(1);
    });

    it('多骨骼独立更新', () => {
      const s = new SpringSolver({ gravity: new Vector3(0, 0, 0), maxSubsteps: 60 });
      const a = makeBone('A', { stiffness: 100, damping: 30, offset: new Vector3(1, 0, 0) });
      const b = makeBone('B', { stiffness: 0, damping: 0, offset: new Vector3(0, 0, 0), velocity: new Vector3(0, 2, 0) });
      s.addBone(a);
      s.addBone(b);
      const sink = makeTransformSink();
      s.update(0.1, sink.getBoneTransform, sink.setBoneTransform);
      // A 被刚度拉回(x 减小),B 受初速度沿 y 运动(y 增加)
      expect(a.offset.x).toBeLessThan(1);
      expect(b.offset.y).toBeGreaterThan(0);
    });
  });
});
