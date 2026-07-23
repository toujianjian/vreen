import { describe, it, expect } from 'vitest';
import { Quaternion } from './Quaternion';

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

  describe('toArray', () => {
    it('returns [x, y, z, w]', () => {
      const q = new Quaternion(1, 2, 3, 4);
      expect(q.toArray()).toEqual([1, 2, 3, 4]);
    });
  });
});