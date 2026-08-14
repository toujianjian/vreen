import { describe, it, expect } from 'vitest';
import { Matrix2 } from './Matrix2';
import { Vector2 } from './Vector2';

describe('Matrix2', () => {
  describe('construction', () => {
    it('default constructor produces identity', () => {
      const m = new Matrix2();
      expect(m.elements).toEqual([
        1, 0,
        0, 1,
      ]);
      expect(m.isMatrix2).toBe(true);
    });

    it('4-arg constructor sets elements (row-major input)', () => {
      // set(11,12, 21,22) means matrix:
      //   [11 12]
      //   [21 22]
      // stored column-major as [11,21, 12,22]
      const m = new Matrix2(
        11, 12,
        21, 22,
      );
      expect(m.elements).toEqual([
        11, 21,
        12, 22,
      ]);
    });
  });

  describe('set', () => {
    it('row-major input → column-major storage', () => {
      const m = new Matrix2().set(
        11, 12,
        21, 22,
      );
      expect(m.elements).toEqual([
        11, 21,
        12, 22,
      ]);
    });

    it('returns this', () => {
      const m = new Matrix2();
      const ret = m.set(1, 0, 0, 1);
      expect(ret).toBe(m);
    });
  });

  describe('identity', () => {
    it('resets to identity', () => {
      const m = new Matrix2();
      m.elements[0] = 99;
      m.identity();
      expect(m.elements).toEqual([
        1, 0,
        0, 1,
      ]);
    });
  });

  describe('copy / clone', () => {
    it('copy duplicates elements and returns this', () => {
      const src = new Matrix2(2, 3, 4, 5);
      const dst = new Matrix2();
      const ret = dst.copy(src);
      expect(dst.elements).toEqual([2, 4, 3, 5]);
      expect(ret).toBe(dst);
    });

    it('clone produces equal but independent copy', () => {
      const src = new Matrix2(1, 2, 3, 4);
      const c = src.clone();
      expect(c.elements).toEqual(src.elements);
      expect(c).not.toBe(src);
      // mutation of clone does not affect source
      c.elements[0] = 999;
      expect(src.elements[0]).toBe(1);
    });
  });

  describe('multiply / premultiply / multiplyMatrices', () => {
    it('multiplyMatrices computes a*b (column-major)', () => {
      // A = [1 2]   B = [5 6]   A*B = [1*5+2*7  1*6+2*8] = [19 22]
      //     [3 4]       [7 8]         [3*5+4*7  3*6+4*8]   [43 50]
      // col-major A = [1,3, 2,4], B = [5,7, 6,8], result = [19,43, 22,50]
      const a = new Matrix2(1, 2, 3, 4);
      const b = new Matrix2(5, 6, 7, 8);
      const r = new Matrix2().multiplyMatrices(a, b);
      expect(r.elements).toEqual([19, 43, 22, 50]);
    });

    it('multiply is post-multiply: m = this * m', () => {
      const m = new Matrix2(1, 2, 3, 4);
      const rhs = new Matrix2(1, 0, 0, 1); // identity
      // m * I = m
      m.multiply(rhs);
      expect(m.elements).toEqual([1, 3, 2, 4]);
    });

    it('premultiply is pre-multiply: m = m * this', () => {
      const m = new Matrix2(1, 2, 3, 4);
      const lhs = new Matrix2(1, 0, 0, 1); // identity
      // I * m = m
      m.premultiply(lhs);
      expect(m.elements).toEqual([1, 3, 2, 4]);
    });

    it('multiply by identity is a no-op', () => {
      const m = new Matrix2(2, 3, 4, 5);
      m.multiply(new Matrix2()); // identity
      expect(m.elements).toEqual([2, 4, 3, 5]);
    });
  });

  describe('multiplyScalar', () => {
    it('scales every element', () => {
      const m = new Matrix2(1, 2, 3, 4);
      m.multiplyScalar(2);
      expect(m.elements).toEqual([2, 6, 4, 8]);
    });

    it('returns this', () => {
      const m = new Matrix2();
      expect(m.multiplyScalar(3)).toBe(m);
    });
  });

  describe('determinant', () => {
    it('det = n11*n22 - n12*n21', () => {
      // [1 2; 3 4] → det = 1*4 - 2*3 = -2
      const m = new Matrix2(1, 2, 3, 4);
      expect(m.determinant()).toBe(-2);
    });

    it('det of identity is 1', () => {
      expect(new Matrix2().determinant()).toBe(1);
    });

    it('det of singular matrix is 0', () => {
      // 两个列成比例 → 奇异
      const m = new Matrix2(2, 4, 1, 2);
      expect(m.determinant()).toBe(0);
    });

    it('det of rotation matrix is 1 (preserves orientation)', () => {
      const m = new Matrix2().makeRotation(Math.PI / 3);
      expect(m.determinant()).toBeCloseTo(1, 10);
    });
  });

  describe('invert', () => {
    it('inverse of [a b; c d] is (1/det)[d -b; -c a]', () => {
      // m = [4 7; 2 6], det = 24-14=10, inv = (1/10)[6 -7; -2 4]
      const m = new Matrix2(4, 7, 2, 6);
      m.invert();
      expect(m.elements[0]).toBeCloseTo(0.6, 10);
      expect(m.elements[1]).toBeCloseTo(-0.2, 10);
      expect(m.elements[2]).toBeCloseTo(-0.7, 10);
      expect(m.elements[3]).toBeCloseTo(0.4, 10);
    });

    it('m * inv(m) = identity', () => {
      const orig = new Matrix2(4, 7, 2, 6);
      const inv = new Matrix2(4, 7, 2, 6).invert();
      const product = new Matrix2().multiplyMatrices(orig, inv);
      expect(product.elements[0]).toBeCloseTo(1, 10);
      expect(product.elements[1]).toBeCloseTo(0, 10);
      expect(product.elements[2]).toBeCloseTo(0, 10);
      expect(product.elements[3]).toBeCloseTo(1, 10);
    });

    it('singular matrix (det=0) zeroes out and returns this', () => {
      const m = new Matrix2(2, 4, 1, 2); // det=0
      const ret = m.invert();
      expect(m.elements).toEqual([0, 0, 0, 0]);
      expect(ret).toBe(m);
    });

    it('inverse of rotation is its transpose (orthogonal)', () => {
      const theta = Math.PI / 5;
      const inv = new Matrix2().makeRotation(theta).invert();
      const trans = new Matrix2().makeRotation(theta).transpose();
      for (let i = 0; i < 4; i++) {
        expect(inv.elements[i]).toBeCloseTo(trans.elements[i], 10);
      }
    });
  });

  describe('transpose / transposeIntoArray', () => {
    it('transpose swaps off-diagonal elements (te[1] <-> te[2])', () => {
      // [1 2; 3 4] col-major [1,3,2,4] → transpose [1 3; 2 4] col-major [1,2,3,4]
      const m = new Matrix2(1, 2, 3, 4);
      m.transpose();
      expect(m.elements).toEqual([1, 2, 3, 4]);
    });

    it('transpose of symmetric matrix is unchanged', () => {
      const m = new Matrix2(1, 2, 2, 5);
      m.transpose();
      expect(m.elements).toEqual([1, 2, 2, 5]);
    });

    it('transpose is its own inverse', () => {
      const orig = new Matrix2(1, 2, 3, 4);
      const m = new Matrix2(1, 2, 3, 4);
      m.transpose().transpose();
      expect(m.elements).toEqual(orig.elements);
    });

    it('transposeIntoArray writes transpose into r without mutating this', () => {
      const m = new Matrix2(1, 2, 3, 4);
      const r: number[] = [];
      m.transposeIntoArray(r);
      // transpose of [1 2; 3 4] is [1 3; 2 4], col-major [1,2,3,4]
      expect(r).toEqual([1, 2, 3, 4]);
      // this unchanged
      expect(m.elements).toEqual([1, 3, 2, 4]);
    });
  });

  describe('scale / rotate (affine builders)', () => {
    it('makeScale builds a diagonal scale matrix', () => {
      const m = new Matrix2().makeScale(2, 3);
      expect(m.elements).toEqual([2, 0, 0, 3]);
    });

    it('makeRotation builds a CCW rotation matrix', () => {
      const m = new Matrix2().makeRotation(Math.PI / 2);
      // cos(π/2)=0, sin(π/2)=1 → set(c,-s,s,c)=set(0,-1,1,0)
      // col-major [0,1, -1,0]
      expect(m.elements[0]).toBeCloseTo(0, 10);
      expect(m.elements[1]).toBeCloseTo(1, 10);
      expect(m.elements[2]).toBeCloseTo(-1, 10);
      expect(m.elements[3]).toBeCloseTo(0, 10);
    });

    it('makeRotation preserves vector length', () => {
      const r = new Matrix2().makeRotation(Math.PI / 4);
      const v = new Vector2(3, 4); // length 5
      r.applyToVector(v);
      expect(v.length()).toBeCloseTo(5, 10);
    });

    it('scale(sx,sy) = premultiply makeScale', () => {
      // this = makeScale * this
      const m = new Matrix2(1, 2, 3, 4);
      m.scale(2, 3);
      const ref = new Matrix2(1, 2, 3, 4);
      ref.premultiply(new Matrix2().makeScale(2, 3));
      expect(m.elements).toEqual(ref.elements);
    });

    it('rotate(theta) = premultiply makeRotation(-theta)', () => {
      const m = new Matrix2(1, 2, 3, 4);
      m.rotate(Math.PI / 6);
      const ref = new Matrix2(1, 2, 3, 4);
      ref.premultiply(new Matrix2().makeRotation(-Math.PI / 6));
      expect(m.elements).toEqual(ref.elements);
    });

    it('rotating a vector by +θ then by -θ returns it (round-trip)', () => {
      const v = new Vector2(2, 5);
      const orig = new Vector2(2, 5);
      const r = new Matrix2().makeRotation(Math.PI / 3);
      r.applyToVector(v);
      const rInv = new Matrix2().makeRotation(Math.PI / 3).invert();
      rInv.applyToVector(v);
      expect(v.x).toBeCloseTo(orig.x, 10);
      expect(v.y).toBeCloseTo(orig.y, 10);
    });
  });

  describe('translate (linear-only, throws)', () => {
    it('throws because 2x2 linear matrices cannot represent translation', () => {
      const m = new Matrix2();
      expect(() => m.translate(1, 2)).toThrowError(/translation/);
    });
  });

  describe('fromArray / toArray', () => {
    it('fromArray reads 4 column-major elements', () => {
      const m = new Matrix2();
      m.fromArray([11, 21, 12, 22]);
      expect(m.elements).toEqual([11, 21, 12, 22]);
    });

    it('fromArray respects offset', () => {
      const m = new Matrix2();
      m.fromArray([0, 0, 11, 21, 12, 22], 2);
      expect(m.elements).toEqual([11, 21, 12, 22]);
    });

    it('toArray writes into a new array by default', () => {
      const m = new Matrix2(11, 12, 21, 22);
      expect(m.toArray()).toEqual([11, 21, 12, 22]);
    });

    it('toArray writes into provided array at offset', () => {
      const m = new Matrix2(11, 12, 21, 22);
      const out = [0, 0, 0, 0, 0, 0];
      m.toArray(out, 2);
      expect(out).toEqual([0, 0, 11, 21, 12, 22]);
    });

    it('toArray / fromArray round-trips', () => {
      const m = new Matrix2(1, 2, 3, 4);
      const arr = m.toArray();
      const m2 = new Matrix2().fromArray(arr);
      expect(m2.elements).toEqual(m.elements);
    });
  });

  describe('equals', () => {
    it('equal matrices compare true', () => {
      const a = new Matrix2(1, 2, 3, 4);
      const b = new Matrix2(1, 2, 3, 4);
      expect(a.equals(b)).toBe(true);
    });

    it('differing matrices compare false', () => {
      const a = new Matrix2(1, 2, 3, 4);
      const b = new Matrix2(1, 2, 3, 5);
      expect(a.equals(b)).toBe(false);
    });

    it('identity equals identity', () => {
      expect(new Matrix2().equals(new Matrix2())).toBe(true);
    });
  });

  describe('applyToVector', () => {
    it('identity leaves vector unchanged', () => {
      const m = new Matrix2();
      const v = new Vector2(3, 4);
      m.applyToVector(v);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('scale matrix scales a vector', () => {
      const m = new Matrix2().makeScale(2, 3);
      const v = new Vector2(1, 1);
      m.applyToVector(v);
      expect(v.x).toBe(2);
      expect(v.y).toBe(3);
    });

    it('rotation by 90° CCW maps (1,0) -> (0,1)', () => {
      const m = new Matrix2().makeRotation(Math.PI / 2);
      const v = new Vector2(1, 0);
      m.applyToVector(v);
      expect(v.x).toBeCloseTo(0, 10);
      expect(v.y).toBeCloseTo(1, 10);
    });

    it('returns the mutated vector (this-friendly)', () => {
      const m = new Matrix2();
      const v = new Vector2(1, 1);
      expect(m.applyToVector(v)).toBe(v);
    });
  });

  describe('properties / semantics', () => {
    it('isMatrix2 flag is true', () => {
      expect(new Matrix2().isMatrix2).toBe(true);
    });

    it('is not flagged as another matrix type (no isMatrix3/isMatrix4)', () => {
      const m = new Matrix2();
      expect((m as unknown as Record<string, unknown>).isMatrix3).toBeUndefined();
      expect((m as unknown as Record<string, unknown>).isMatrix4).toBeUndefined();
    });
  });
});
