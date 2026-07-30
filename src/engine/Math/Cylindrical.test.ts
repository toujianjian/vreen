// Cylindrical 单元测试 — 柱坐标转换。
// 参考 three.js test/unit/math/Cylindrical.tests.js。

import { describe, it, expect } from 'vitest';
import { Cylindrical } from './Cylindrical';
import { Vector3 } from './Vector3';

describe('Cylindrical', () => {
  it('默认构造 radius=1, theta=0, y=0', () => {
    const c = new Cylindrical();
    expect(c.radius).toBe(1);
    expect(c.theta).toBe(0);
    expect(c.y).toBe(0);
  });

  it('set 设置三个分量', () => {
    const c = new Cylindrical();
    c.set(2, 0.5, 3);
    expect(c.radius).toBe(2);
    expect(c.theta).toBe(0.5);
    expect(c.y).toBe(3);
  });

  it('copy 复制另一个 Cylindrical', () => {
    const a = new Cylindrical(3, 0.7, 4);
    const b = new Cylindrical();
    b.copy(a);
    expect(b.radius).toBe(3);
    expect(b.theta).toBe(0.7);
    expect(b.y).toBe(4);
  });

  it('clone 返回独立的副本', () => {
    const a = new Cylindrical(5, 1, 2);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.radius).toBe(5);
    expect(b.theta).toBe(1);
    expect(b.y).toBe(2);
    b.radius = 99;
    expect(a.radius).toBe(5);
  });

  describe('setFromVector3', () => {
    it('(3,4,0) → radius=3, theta=π/2, y=4', () => {
      const c = new Cylindrical().setFromVector3(new Vector3(3, 4, 0));
      expect(c.radius).toBeCloseTo(3, 6);
      // theta = atan2(x, z) = atan2(3, 0) = π/2
      expect(c.theta).toBeCloseTo(Math.PI / 2, 6);
      expect(c.y).toBeCloseTo(4, 6);
    });

    it('(0,5,0) → radius=0, theta=0, y=5 (沿 y 轴)', () => {
      const c = new Cylindrical().setFromVector3(new Vector3(0, 5, 0));
      expect(c.radius).toBeCloseTo(0, 6);
      expect(c.theta).toBeCloseTo(0, 6);
      expect(c.y).toBeCloseTo(5, 6);
    });

    it('(0,0,2) → radius=2, theta=0, y=0 (沿 +z 轴)', () => {
      const c = new Cylindrical().setFromVector3(new Vector3(0, 0, 2));
      expect(c.radius).toBeCloseTo(2, 6);
      // atan2(0, 2) = 0
      expect(c.theta).toBeCloseTo(0, 6);
      expect(c.y).toBeCloseTo(0, 6);
    });

    it('(-2,0,0) → radius=2, theta=-π/2 (沿 -x 轴)', () => {
      const c = new Cylindrical().setFromVector3(new Vector3(-2, 0, 0));
      expect(c.radius).toBeCloseTo(2, 6);
      // atan2(-2, 0) = -π/2
      expect(c.theta).toBeCloseTo(-Math.PI / 2, 6);
    });
  });
});
