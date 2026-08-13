// Spherical 单元测试 — 球坐标转换与限制。
// 参考 three.js test/unit/math/Spherical.tests.js,适配 VREEN 的 restrictPhi/restrictTheta。

import { describe, it, expect } from 'vitest';
import { Spherical } from './Spherical';
import { Vector3 } from './Vector3';

describe('Spherical', () => {
  it('默认构造 radius=1, phi=0, theta=0', () => {
    const s = new Spherical();
    expect(s.radius).toBe(1);
    expect(s.phi).toBe(0);
    expect(s.theta).toBe(0);
  });

  it('set 设置三个分量', () => {
    const s = new Spherical();
    s.set(2, 0.5, 1.2);
    expect(s.radius).toBe(2);
    expect(s.phi).toBe(0.5);
    expect(s.theta).toBe(1.2);
  });

  it('copy 复制另一个 Spherical', () => {
    const a = new Spherical(3, 0.7, -0.4);
    const b = new Spherical();
    b.copy(a);
    expect(b.radius).toBe(3);
    expect(b.phi).toBe(0.7);
    expect(b.theta).toBe(-0.4);
  });

  it('clone 返回独立的副本', () => {
    const a = new Spherical(5, 1, 2);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.radius).toBe(5);
    expect(b.phi).toBe(1);
    expect(b.theta).toBe(2);
    // 修改 b 不影响 a
    b.radius = 99;
    expect(a.radius).toBe(5);
  });

  describe('setFromVector3', () => {
    it('(1,0,0) → radius=1, theta=π/2, phi=π/2', () => {
      const s = new Spherical().setFromVector3(new Vector3(1, 0, 0));
      expect(s.radius).toBeCloseTo(1, 6);
      expect(s.theta).toBeCloseTo(Math.PI / 2, 6);
      expect(s.phi).toBeCloseTo(Math.PI / 2, 6);
    });

    it('(0,1,0) → phi=0 (正 y 轴)', () => {
      const s = new Spherical().setFromVector3(new Vector3(0, 1, 0));
      expect(s.radius).toBeCloseTo(1, 6);
      expect(s.phi).toBeCloseTo(0, 6);
      // theta = atan2(0, 0) = 0
      expect(s.theta).toBeCloseTo(0, 6);
    });

    it('(0,0,1) → theta=0 (正 z 轴)', () => {
      const s = new Spherical().setFromVector3(new Vector3(0, 0, 1));
      expect(s.radius).toBeCloseTo(1, 6);
      expect(s.theta).toBeCloseTo(0, 6);
      expect(s.phi).toBeCloseTo(Math.PI / 2, 6);
    });

    it('原点 (0,0,0) → radius=0, phi=0, theta=0 (避免 NaN)', () => {
      const s = new Spherical().setFromVector3(new Vector3(0, 0, 0));
      expect(s.radius).toBe(0);
      expect(s.phi).toBe(0);
      expect(s.theta).toBe(0);
    });
  });

  describe('makeSafe', () => {
    it('phi=0 被钳制到 EPS', () => {
      const s = new Spherical(1, 0, 0);
      s.makeSafe();
      expect(s.phi).toBeCloseTo(0.000001, 9);
    });

    it('phi=π 被钳制到 π-EPS', () => {
      const s = new Spherical(1, Math.PI, 0);
      s.makeSafe();
      expect(s.phi).toBeCloseTo(Math.PI - 0.000001, 9);
    });

    it('phi 在安全范围保持不变', () => {
      const s = new Spherical(1, Math.PI / 2, 0);
      s.makeSafe();
      expect(s.phi).toBeCloseTo(Math.PI / 2, 9);
    });

    it('返回 this 支持链式', () => {
      const s = new Spherical(1, 0, 0);
      expect(s.makeSafe()).toBe(s);
    });
  });

  describe('restrictPhi', () => {
    it('将 phi 限制在 [min, max] 范围内', () => {
      const s = new Spherical(1, 0.5, 0);
      s.restrictPhi(0.6, 1.0);
      expect(s.phi).toBeCloseTo(0.6, 6);
    });

    it('phi 在范围内时不改变', () => {
      const s = new Spherical(1, 0.8, 0);
      s.restrictPhi(0.6, 1.0);
      expect(s.phi).toBeCloseTo(0.8, 6);
    });

    it('phi 超过上界时被截断', () => {
      const s = new Spherical(1, 1.5, 0);
      s.restrictPhi(0.6, 1.0);
      expect(s.phi).toBeCloseTo(1.0, 6);
    });
  });

  describe('restrictTheta', () => {
    it('将 theta 限制在 [min, max] 范围内', () => {
      const s = new Spherical(1, 0, -1.5);
      s.restrictTheta(-1.0, 1.0);
      expect(s.theta).toBeCloseTo(-1.0, 6);
    });

    it('theta 在范围内时不改变', () => {
      const s = new Spherical(1, 0, 0.3);
      s.restrictTheta(-1.0, 1.0);
      expect(s.theta).toBeCloseTo(0.3, 6);
    });

    it('theta 超过上界时被截断', () => {
      const s = new Spherical(1, 0, 2.5);
      s.restrictTheta(-1.0, 1.0);
      expect(s.theta).toBeCloseTo(1.0, 6);
    });
  });
});
