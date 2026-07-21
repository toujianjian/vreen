import { describe, it, expect } from 'vitest';
import { Matrix4 } from './Matrix4';

describe('Matrix4', () => {
  it('constructs as identity', () => {
    const m = new Matrix4();
    const e = m.elements;
    expect(e[0]).toBe(1);  expect(e[1]).toBe(0);
    expect(e[4]).toBe(0);  expect(e[5]).toBe(1);
    expect(e[10]).toBe(1); expect(e[15]).toBe(1);
    for (let i = 0; i < 16; i++) {
      if (i === 0 || i === 5 || i === 10 || i === 15) continue;
      expect(e[i]).toBe(0);
    }
  });

  it('identity() resets to identity', () => {
    const m = new Matrix4();
    m.elements[0] = 99;
    m.identity();
    expect(m.elements[0]).toBe(1);
    expect(m.elements[5]).toBe(1);
    expect(m.elements[10]).toBe(1);
    expect(m.elements[15]).toBe(1);
  });

  it('copy() copies elements independently', () => {
    const a = new Matrix4();
    const b = new Matrix4();
    a.elements[0] = 42;
    b.copy(a);
    expect(b.elements[0]).toBe(42);
    a.elements[0] = 1;
    expect(b.elements[0]).toBe(42);
  });

  it('clone() returns a copy', () => {
    const a = new Matrix4();
    a.elements[12] = 100;
    const b = a.clone();
    expect(b.elements[12]).toBe(100);
    expect(b).not.toBe(a);
  });

  describe('multiplyMatrices', () => {
    it('multiplies two identity matrices → identity', () => {
      const a = new Matrix4();
      const b = new Matrix4();
      const out = new Matrix4().multiplyMatrices(a, b);
      expect(out.elements).toEqual(new Matrix4().elements);
    });

    it('multiply translation × identity → translation', () => {
      const t = new Matrix4();
      t.elements[12] = 5;
      t.elements[13] = 10;
      t.elements[14] = -3;
      const result = new Matrix4().multiplyMatrices(t, new Matrix4());
      expect(result.elements[12]).toBe(5);
      expect(result.elements[13]).toBe(10);
      expect(result.elements[14]).toBe(-3);
    });
  });

  describe('makeLookAt', () => {
    it('eye at origin looking down -Z', () => {
      const m = new Matrix4().makeLookAt(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 1, z: 0 },
      );
      // Engine convention: Z = eye - target = (0,0,1) → e[10] = 1
      expect(m.elements[10]).toBeCloseTo(1);
      expect(m.elements[12]).toBeCloseTo(0);
      expect(m.elements[13]).toBeCloseTo(0);
      expect(m.elements[14]).toBeCloseTo(0);
    });
  });

  describe('compose', () => {
    it('composes identity transform', () => {
      const m = new Matrix4().compose(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 1, y: 1, z: 1 },
      );
      expect(m.elements[0]).toBe(1);
      expect(m.elements[5]).toBe(1);
      expect(m.elements[10]).toBe(1);
      expect(m.elements[12]).toBe(0);
    });

    it('composes translation', () => {
      const m = new Matrix4().compose(
        { x: 10, y: 20, z: 30 },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 1, y: 1, z: 1 },
      );
      expect(m.elements[12]).toBe(10);
      expect(m.elements[13]).toBe(20);
      expect(m.elements[14]).toBe(30);
    });
  });

  describe('getInverse', () => {
    it('inverse of identity is identity', () => {
      const m = new Matrix4();
      const inv = new Matrix4().getInverse(m);
      expect(inv.elements).toEqual(m.elements);
    });

    it('inverse of translation × translation ≈ identity', () => {
      const t = new Matrix4();
      t.elements[12] = 5;
      t.elements[13] = 10;
      t.elements[14] = 15;
      const inv = new Matrix4().getInverse(t);
      const result = new Matrix4().multiplyMatrices(t, inv);
      expect(result.elements[0]).toBeCloseTo(1);
      expect(result.elements[5]).toBeCloseTo(1);
      expect(result.elements[10]).toBeCloseTo(1);
      expect(result.elements[15]).toBeCloseTo(1);
      expect(result.elements[12]).toBeCloseTo(0);
    });

    it('returns identity for singular matrix', () => {
      const singular = new Matrix4();
      singular.elements[0] = 0; // zero scale → det=0
      const inv = new Matrix4().getInverse(singular);
      expect(inv.elements[0]).toBe(1); // identity
      expect(inv.elements[5]).toBe(1);
    });
  });

  describe('makePerspective', () => {
    it('produces a valid projection matrix', () => {
      const m = new Matrix4().makePerspective(Math.PI / 4, 16 / 9, 0.1, 100);
      expect(m.elements[11]).toBe(-1); // right-handed flag
      expect(m.elements[5]).toBeGreaterThan(0); // vertical FOV factor
      expect(m.elements[0]).toBeGreaterThan(0); // horizontal FOV factor
    });
  });

  describe('getNormalMatrix', () => {
    it('returns identity for identity matrix', () => {
      const out = new Float32Array(9);
      new Matrix4().getNormalMatrix(out);
      expect(out[0]).toBe(1);
      expect(out[4]).toBe(1);
      expect(out[8]).toBe(1);
    });

    it('returns identity for singular matrix', () => {
      const m = new Matrix4();
      m.elements[0] = 0;
      const out = new Float32Array(9);
      m.getNormalMatrix(out);
      expect(out[0]).toBe(1);
      expect(out[4]).toBe(1);
      expect(out[8]).toBe(1);
    });
  });

  describe('toArray', () => {
    it('returns 16 elements', () => {
      const arr = new Matrix4().toArray();
      expect(arr).toHaveLength(16);
      expect(arr[0]).toBe(1);
      expect(arr[15]).toBe(1);
    });
  });
});