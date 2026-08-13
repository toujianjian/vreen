import { describe, it, expect } from 'vitest';
import { Quaternion } from './Quaternion';
import { Matrix4 } from './Matrix4';

describe('Quaternion', () => {
  it('constructs with default identity', () => {
    const q = new Quaternion();
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(1);
  });

  it('constructs with values', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    expect(q.x).toBe(0.1);
    expect(q.y).toBe(0.2);
    expect(q.z).toBe(0.3);
    expect(q.w).toBe(0.4);
  });

  it('set() updates all components', () => {
    const q = new Quaternion().set(1, 2, 3, 4);
    expect(q.x).toBe(1);
    expect(q.y).toBe(2);
    expect(q.z).toBe(3);
    expect(q.w).toBe(4);
  });

  it('identity() resets to identity', () => {
    const q = new Quaternion(1, 2, 3, 4);
    q.identity();
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(1);
  });

  it('copy() copies components', () => {
    const a = new Quaternion(1, 2, 3, 4);
    const b = new Quaternion().copy(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
    expect(b.w).toBe(4);
  });

  it('clone() returns a new quaternion', () => {
    const a = new Quaternion(1, 2, 3, 4);
    const b = a.clone();
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
    expect(b.w).toBe(4);
    expect(b).not.toBe(a);
  });

  describe('setFromEuler', () => {
    it('XYZ (0,0,0) → identity', () => {
      const q = new Quaternion().setFromEuler(0, 0, 0, 'XYZ');
      expect(q.x).toBe(0);
      expect(q.y).toBe(0);
      expect(q.z).toBe(0);
      expect(q.w).toBe(1);
    });

    it('XYZ (90° around Z) → points along Z axis', () => {
      const q = new Quaternion().setFromEuler(0, 0, Math.PI / 2, 'XYZ');
      // 90° around Z: (0, 0, sin(45°), cos(45°))
      const s = Math.SQRT1_2; // sin(π/4) = cos(π/4) = √2/2
      expect(q.x).toBeCloseTo(0);
      expect(q.y).toBeCloseTo(0);
      expect(q.z).toBeCloseTo(s);
      expect(q.w).toBeCloseTo(s);
    });
  });

  describe('multiply', () => {
    it('identity × identity = identity', () => {
      const a = new Quaternion();
      const b = new Quaternion();
      a.multiply(b);
      expect(a.x).toBe(0);
      expect(a.y).toBe(0);
      expect(a.z).toBe(0);
      expect(a.w).toBe(1);
    });

    it('q × q⁻¹ ≈ identity', () => {
      // A quaternion and its inverse/conjugate
      const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
      q.normalize();
      const inv = new Quaternion(-q.x, -q.y, -q.z, q.w);
      inv.normalize();
      q.multiply(inv);
      expect(q.w).toBeCloseTo(1, 5);
      expect(q.x).toBeCloseTo(0, 5);
      expect(q.y).toBeCloseTo(0, 5);
      expect(q.z).toBeCloseTo(0, 5);
    });
  });

  describe('normalize', () => {
    it('produces unit length', () => {
      const q = new Quaternion(1, 2, 3, 4);
      q.normalize();
      const len = Math.hypot(q.x, q.y, q.z, q.w);
      expect(len).toBeCloseTo(1, 10);
    });

    it('handles zero quaternion', () => {
      const q = new Quaternion(0, 0, 0, 0);
      q.normalize();
      expect(q.w).toBe(1); // falls back to identity
    });
  });

  describe('toArray / fromArray', () => {
    it('returns [x, y, z, w]', () => {
      const q = new Quaternion(1, 2, 3, 4);
      expect(q.toArray()).toEqual([1, 2, 3, 4]);
    });

    it('toArray writes at an offset into a caller array', () => {
      const arr = [0, 0, 0, 0, 0, 0];
      new Quaternion(1, 2, 3, 4).toArray(arr, 2);
      expect(arr).toEqual([0, 0, 1, 2, 3, 4]);
    });

    it('fromArray reads at an offset', () => {
      const q = new Quaternion().fromArray([9, 9, 9, 9, 1, 2, 3, 4], 4);
      expect(q.x).toBe(1);
      expect(q.y).toBe(2);
      expect(q.z).toBe(3);
      expect(q.w).toBe(4);
    });
  });

  describe('setFromRotationMatrix', () => {
    it('extracts 90° around Z', () => {
      const m = new Matrix4().makeRotationFromQuaternion(
        new Quaternion().setFromEuler(0, 0, Math.PI / 2, 'XYZ'),
      );
      const q = new Quaternion().setFromRotationMatrix(m);
      expect(q.z).toBeCloseTo(Math.SQRT1_2, 10);
      expect(q.w).toBeCloseTo(Math.SQRT1_2, 10);
    });

    it('roundtrips arbitrary rotation', () => {
      const q1 = new Quaternion().setFromEuler(0.3, -0.5, 0.2);
      const m = new Matrix4().makeRotationFromQuaternion(q1);
      const q2 = new Quaternion().setFromRotationMatrix(m);
      // 从矩阵重新 compose,验证编码同一旋转(不受 ±q 等价影响)
      const m2 = new Matrix4().compose({ x: 0, y: 0, z: 0 }, q2, { x: 1, y: 1, z: 1 });
      for (let i = 0; i < 16; i++) {
        expect(m2.elements[i]).toBeCloseTo(m.elements[i], 6);
      }
    });
  });
});