import { describe, it, expect } from 'vitest';
import { Vector3 } from './Vector3';

describe('Vector3', () => {
  it('constructs with defaults', () => {
    const v = new Vector3();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('constructs with values', () => {
    const v = new Vector3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  it('set() updates all components and returns this', () => {
    const v = new Vector3().set(4, 5, 6);
    expect(v.x).toBe(4);
    expect(v.y).toBe(5);
    expect(v.z).toBe(6);
  });

  it('copy() copies from another vector', () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3().copy(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
    // mutations on b should not affect a
    b.x = 99;
    expect(a.x).toBe(1);
  });

  it('clone() returns a new vector', () => {
    const a = new Vector3(1, 2, 3);
    const b = a.clone();
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
    expect(b).not.toBe(a);
  });

  describe('add', () => {
    it('adds component-wise', () => {
      const a = new Vector3(1, 2, 3);
      a.add(new Vector3(4, 5, 6));
      expect(a.x).toBe(5);
      expect(a.y).toBe(7);
      expect(a.z).toBe(9);
    });

    it('returns this', () => {
      const a = new Vector3(1, 1, 1);
      const ret = a.add(new Vector3(1, 1, 1));
      expect(ret).toBe(a);
    });
  });

  describe('sub', () => {
    it('subtracts component-wise', () => {
      const a = new Vector3(5, 7, 9);
      a.sub(new Vector3(4, 5, 6));
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(a.z).toBe(3);
    });
  });

  describe('multiplyScalar', () => {
    it('multiplies all components', () => {
      const v = new Vector3(2, 3, 4);
      v.multiplyScalar(10);
      expect(v.x).toBe(20);
      expect(v.y).toBe(30);
      expect(v.z).toBe(40);
    });

    it('handles zero', () => {
      const v = new Vector3(1, 2, 3);
      v.multiplyScalar(0);
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });
  });

  describe('divideScalar', () => {
    it('divides all components', () => {
      const v = new Vector3(10, 20, 30);
      v.divideScalar(10);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
    });
  });

  describe('dot', () => {
    it('returns dot product', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      expect(a.dot(b)).toBe(0);
    });

    it('returns correct dot for parallel vectors', () => {
      const a = new Vector3(2, 3, 4);
      const b = new Vector3(2, 3, 4);
      expect(a.dot(b)).toBe(4 + 9 + 16);
    });
  });

  describe('cross', () => {
    it('computes cross product (right-hand)', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      a.cross(b);
      expect(a.x).toBeCloseTo(0);
      expect(a.y).toBeCloseTo(0);
      expect(a.z).toBeCloseTo(1);
    });
  });

  describe('length / lengthSq', () => {
    it('length is 0 for zero vector', () => {
      expect(new Vector3().length()).toBe(0);
    });

    it('length is sqrt of lengthSq', () => {
      const v = new Vector3(3, 4, 0);
      expect(v.lengthSq()).toBe(25);
      expect(v.length()).toBe(5);
    });
  });

  describe('normalize', () => {
    it('normalizes to unit length', () => {
      const v = new Vector3(3, 4, 0);
      v.normalize();
      expect(v.length()).toBeCloseTo(1, 10);
    });

    it('does nothing on zero vector', () => {
      const v = new Vector3();
      v.normalize();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });
  });

  describe('distanceTo / distanceToSquared', () => {
    it('distanceTo is 0 for same point', () => {
      expect(new Vector3(1, 2, 3).distanceTo(new Vector3(1, 2, 3))).toBe(0);
    });

    it('distanceTo works for separated points', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(-1, 0, 0);
      expect(a.distanceTo(b)).toBe(2);
    });
  });

  describe('lerp', () => {
    it('alpha=0 returns unchanged', () => {
      const a = new Vector3(1, 2, 3);
      a.lerp(new Vector3(10, 20, 30), 0);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(a.z).toBe(3);
    });

    it('alpha=1 returns the target', () => {
      const a = new Vector3(1, 2, 3);
      a.lerp(new Vector3(10, 20, 30), 1);
      expect(a.x).toBe(10);
      expect(a.y).toBe(20);
      expect(a.z).toBe(30);
    });

    it('alpha=0.5 returns midpoint', () => {
      const a = new Vector3(0, 0, 0);
      a.lerp(new Vector3(2, 4, 6), 0.5);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(a.z).toBe(3);
    });
  });

  describe('lerpVectors', () => {
    it('interpolates between two vectors without modifying them', () => {
      const a = new Vector3(1, 2, 3);
      const b = new Vector3(5, 6, 7);
      const out = new Vector3().lerpVectors(a, b, 0.25);
      expect(out.x).toBe(2);
      expect(out.y).toBe(3);
      expect(out.z).toBe(4);
      // originals unchanged
      expect(a.x).toBe(1);
      expect(b.x).toBe(5);
    });
  });

  describe('toArray / fromArray', () => {
    it('toArray returns [x, y, z]', () => {
      expect(new Vector3(1, 2, 3).toArray()).toEqual([1, 2, 3]);
    });

    it('fromArray sets from tuple', () => {
      const v = new Vector3().fromArray([4, 5, 6]);
      expect(v.x).toBe(4);
      expect(v.y).toBe(5);
      expect(v.z).toBe(6);
    });
  });

  describe('toString', () => {
    it('formats nicely', () => {
      const v = new Vector3(1.5, 2.5, 3.5);
      expect(v.toString()).toMatch(/Vector3\(1\.500,\s*2\.500,\s*3\.500\)/);
    });
  });
});
