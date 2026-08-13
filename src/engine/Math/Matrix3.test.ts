import { describe, it, expect } from 'vitest';
import { Matrix3 } from './Matrix3';
import { Matrix4 } from './Matrix4';
import { Vector2 } from './Vector2';
import { Vector3 } from './Vector3';

describe('Matrix3', () => {
  describe('construction', () => {
    it('default constructor produces identity', () => {
      const m = new Matrix3();
      expect(m.elements).toEqual([
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ]);
    });

    it('9-arg constructor sets elements (row-major input)', () => {
      // set(1,2,3, 4,5,6, 7,8,9) means matrix:
      //   [1 2 3]
      //   [4 5 6]
      //   [7 8 9]
      // stored column-major as [1,4,7, 2,5,8, 3,6,9]
      const m = new Matrix3(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      expect(m.elements).toEqual([
        1, 4, 7,
        2, 5, 8,
        3, 6, 9,
      ]);
    });
  });

  describe('set', () => {
    it('row-major input → column-major storage', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      expect(m.elements).toEqual([
        1, 4, 7,
        2, 5, 8,
        3, 6, 9,
      ]);
    });

    it('returns this', () => {
      const m = new Matrix3();
      const ret = m.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
      expect(ret).toBe(m);
    });
  });

  describe('identity', () => {
    it('resets to identity', () => {
      const m = new Matrix3();
      m.elements[0] = 99;
      m.identity();
      expect(m.elements).toEqual([
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ]);
    });
  });

  describe('copy / clone', () => {
    it('copy duplicates elements', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().copy(a);
      expect(b.elements).toEqual(a.elements);
      a.elements[0] = 99;
      expect(b.elements[0]).toBe(1);
    });

    it('clone returns independent instance', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.elements).toEqual(a.elements);
      b.elements[0] = 0;
      expect(a.elements[0]).toBe(1);
    });
  });

  describe('setFromMatrix4', () => {
    it('extracts upper-left 3x3 from Matrix4', () => {
      const m4 = new Matrix4();
      m4.elements[0] = 2;
      m4.elements[5] = 3;
      m4.elements[10] = 4;
      const m3 = new Matrix3().setFromMatrix4(m4);
      // column-major: [2,0,0, 0,3,0, 0,0,4]
      expect(m3.elements).toEqual([
        2, 0, 0,
        0, 3, 0,
        0, 0, 4,
      ]);
    });
  });

  describe('determinant', () => {
    it('identity has determinant 1', () => {
      expect(new Matrix3().determinant()).toBe(1);
    });

    it('diagonal matrix det = product of diagonal', () => {
      const m = new Matrix3().set(
        2, 0, 0,
        0, 3, 0,
        0, 0, 4,
      );
      expect(m.determinant()).toBe(24);
    });

    it('singular matrix det = 0', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      expect(m.determinant()).toBe(0);
    });

    it('known 3x3 determinant', () => {
      // det([1 2 3; 0 4 5; 1 0 6]) = 1*(24-0) - 2*(0-5) + 3*(0-4) = 24+10-12 = 22
      const m = new Matrix3().set(
        1, 2, 3,
        0, 4, 5,
        1, 0, 6,
      );
      expect(m.determinant()).toBe(22);
    });
  });

  describe('multiplyMatrices', () => {
    it('identity × identity = identity', () => {
      const out = new Matrix3().multiplyMatrices(new Matrix3(), new Matrix3());
      expect(out.elements).toEqual(new Matrix3().elements);
    });

    it('A × A^-1 = identity', () => {
      const a = new Matrix3().set(
        4, 2, 0,
        0, 2, 1,
        1, 0, 3,
      );
      const inv = new Matrix3().copy(a).invert();
      const prod = new Matrix3().multiplyMatrices(a, inv);
      // expect identity
      expect(prod.elements[0]).toBeCloseTo(1, 10);
      expect(prod.elements[4]).toBeCloseTo(1, 10);
      expect(prod.elements[8]).toBeCloseTo(1, 10);
      expect(prod.elements[1]).toBeCloseTo(0, 10);
      expect(prod.elements[3]).toBeCloseTo(0, 10);
      expect(prod.elements[5]).toBeCloseTo(0, 10);
      expect(prod.elements[7]).toBeCloseTo(0, 10);
    });

    it('known matrix product', () => {
      const a = new Matrix3().set(
        1, 2, 3,
        0, 1, 4,
        5, 6, 0,
      );
      const b = new Matrix3().set(
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      );
      const out = new Matrix3().multiplyMatrices(a, b);
      // A × I = A
      expect(out.elements).toEqual(a.elements);
    });
  });

  describe('multiply / premultiply', () => {
    it('multiply is this = this * m', () => {
      const a = new Matrix3().set(
        1, 2, 0,
        0, 1, 0,
        0, 0, 1,
      );
      const b = new Matrix3().set(
        1, 0, 0,
        3, 1, 0,
        0, 0, 1,
      );
      const expected = new Matrix3().multiplyMatrices(a, b);
      const result = new Matrix3().copy(a).multiply(b);
      expect(result.elements).toEqual(expected.elements);
    });

    it('premultiply is this = m * this', () => {
      const a = new Matrix3().set(
        1, 2, 0,
        0, 1, 0,
        0, 0, 1,
      );
      const b = new Matrix3().set(
        1, 0, 0,
        3, 1, 0,
        0, 0, 1,
      );
      const expected = new Matrix3().multiplyMatrices(b, a);
      const result = new Matrix3().copy(a).premultiply(b);
      expect(result.elements).toEqual(expected.elements);
    });
  });

  describe('multiplyScalar', () => {
    it('scales all elements', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      m.multiplyScalar(2);
      expect(m.elements).toEqual([
        2, 8, 14,
        4, 10, 16,
        6, 12, 18,
      ]);
    });
  });

  describe('invert', () => {
    it('inverse of identity is identity', () => {
      const inv = new Matrix3().invert();
      expect(inv.elements).toEqual(new Matrix3().elements);
    });

    it('A × A^-1 = identity for general matrix', () => {
      const a = new Matrix3().set(
        4, 2, 0,
        0, 2, 1,
        1, 0, 3,
      );
      const inv = new Matrix3().copy(a).invert();
      const prod = new Matrix3().multiplyMatrices(a, inv);
      expect(prod.elements[0]).toBeCloseTo(1, 10);
      expect(prod.elements[4]).toBeCloseTo(1, 10);
      expect(prod.elements[8]).toBeCloseTo(1, 10);
      expect(prod.elements[1]).toBeCloseTo(0, 10);
      expect(prod.elements[2]).toBeCloseTo(0, 10);
      expect(prod.elements[3]).toBeCloseTo(0, 10);
      expect(prod.elements[5]).toBeCloseTo(0, 10);
      expect(prod.elements[6]).toBeCloseTo(0, 10);
      expect(prod.elements[7]).toBeCloseTo(0, 10);
    });

    it('singular matrix becomes zero matrix', () => {
      const a = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      a.invert();
      for (let i = 0; i < 9; i++) {
        expect(a.elements[i]).toBe(0);
      }
    });

    it('inverse of diagonal matrix is reciprocals', () => {
      const a = new Matrix3().set(
        2, 0, 0,
        0, 4, 0,
        0, 0, 8,
      );
      a.invert();
      // column-major: [0.5,0,0, 0,0.25,0, 0,0,0.125]
      expect(a.elements[0]).toBeCloseTo(0.5, 10);
      expect(a.elements[4]).toBeCloseTo(0.25, 10);
      expect(a.elements[8]).toBeCloseTo(0.125, 10);
    });
  });

  describe('transpose', () => {
    it('transposes symmetric matrix → unchanged', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        2, 4, 5,
        3, 5, 6,
      );
      const before = m.elements.slice();
      m.transpose();
      expect(m.elements).toEqual(before);
    });

    it('transposes asymmetric matrix', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      // column-major before: [1,4,7, 2,5,8, 3,6,9]
      // transpose → [1,2,3, 4,5,6, 7,8,9]
      m.transpose();
      expect(m.elements).toEqual([
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      ]);
    });

    it('double transpose returns to original', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      const original = m.elements.slice();
      m.transpose().transpose();
      expect(m.elements).toEqual(original);
    });
  });

  describe('transposeIntoArray', () => {
    it('writes transpose into target without modifying this', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      const before = m.elements.slice();
      const r: number[] = new Array(9);
      m.transposeIntoArray(r);
      // expect column-major transpose
      expect(r).toEqual([
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      ]);
      expect(m.elements).toEqual(before);
    });
  });

  describe('getNormalMatrix', () => {
    it('identity matrix → identity normal matrix', () => {
      const m4 = new Matrix4();
      const m3 = new Matrix3().getNormalMatrix(m4);
      expect(m3.elements).toEqual(new Matrix3().elements);
    });

    it('scale matrix → inverse scale (since inverse-transpose of diagonal is reciprocal diagonal)', () => {
      const m4 = new Matrix4();
      m4.elements[0] = 2; // scale x by 2
      m4.elements[5] = 4; // scale y by 4
      m4.elements[10] = 8; // scale z by 8
      const m3 = new Matrix3().getNormalMatrix(m4);
      // diagonal of [1/2, 1/4, 1/8]
      expect(m3.elements[0]).toBeCloseTo(0.5, 10);
      expect(m3.elements[4]).toBeCloseTo(0.25, 10);
      expect(m3.elements[8]).toBeCloseTo(0.125, 10);
    });
  });

  describe('fromArray / toArray', () => {
    it('round-trips through array', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      const arr = m.toArray();
      expect(arr).toEqual(m.elements);
      const m2 = new Matrix3().fromArray(arr);
      expect(m2.elements).toEqual(m.elements);
    });

    it('toArray writes into provided array at offset', () => {
      const m = new Matrix3().set(
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      );
      const arr: number[] = new Array(11).fill(0);
      m.toArray(arr, 1);
      expect(arr[0]).toBe(0);
      for (let i = 0; i < 9; i++) {
        expect(arr[i + 1]).toBe(m.elements[i]);
      }
      expect(arr[10]).toBe(0);
    });

    it('fromArray reads from offset', () => {
      const src = [99, 1, 4, 7, 2, 5, 8, 3, 6, 9, 99];
      const m = new Matrix3().fromArray(src, 1);
      expect(m.elements).toEqual([
        1, 4, 7,
        2, 5, 8,
        3, 6, 9,
      ]);
    });
  });

  describe('extractBasis', () => {
    it('extracts basis columns into vectors', () => {
      const c = Math.cos(Math.PI / 4);
      const s = Math.sin(Math.PI / 4);
      const m = new Matrix3().makeRotation(Math.PI / 4);
      const x = new Vector3();
      const y = new Vector3();
      const z = new Vector3();
      m.extractBasis(x, y, z);
      // makeRotation column-major: [c, s, 0, -s, c, 0, 0, 0, 1]
      expect(x.x).toBeCloseTo(c, 10);
      expect(x.y).toBeCloseTo(s, 10);
      expect(x.z).toBeCloseTo(0, 10);
      expect(y.x).toBeCloseTo(-s, 10);
      expect(y.y).toBeCloseTo(c, 10);
      expect(y.z).toBeCloseTo(0, 10);
      expect(z.x).toBeCloseTo(0, 10);
      expect(z.y).toBeCloseTo(0, 10);
      expect(z.z).toBeCloseTo(1, 10);
    });

    it('returns this', () => {
      const m = new Matrix3();
      const x = new Vector3(), y = new Vector3(), z = new Vector3();
      expect(m.extractBasis(x, y, z)).toBe(m);
    });
  });

  describe('setUvTransform', () => {
    it('no rotation about origin produces scale+translate', () => {
      const m = new Matrix3().setUvTransform(2, 3, 2, 4, 0, 0, 0);
      // row-major: [2,0,2; 0,4,3; 0,0,1] → column-major [2,0,0, 0,4,0, 2,3,1]
      expect(m.elements[0]).toBe(2);
      expect(m.elements[4]).toBe(4);
      expect(m.elements[6]).toBe(2);
      expect(m.elements[7]).toBe(3);
      expect(m.elements[8]).toBe(1);
    });

    it('rotation 90° about center is a pure rotation matrix', () => {
      const m = new Matrix3().setUvTransform(0, 0, 1, 1, Math.PI / 2, 0, 0);
      // row-major: [cos90, sin90, 0; -sin90, cos90, 0; 0,0,1] = [0,1,0; -1,0,0; 0,0,1]
      expect(m.elements[0]).toBeCloseTo(0, 10);
      expect(m.elements[1]).toBeCloseTo(-1, 10);
      expect(m.elements[3]).toBeCloseTo(1, 10);
      expect(m.elements[4]).toBeCloseTo(0, 10);
      expect(m.elements[8]).toBeCloseTo(1, 10);
    });
  });

  describe('makeTranslation', () => {
    it('number form', () => {
      const m = new Matrix3().makeTranslation(2, 3);
      // row-major: [1,0,2; 0,1,3; 0,0,1] → column-major [1,0,0, 0,1,0, 2,3,1]
      expect(m.elements).toEqual([1, 0, 0, 0, 1, 0, 2, 3, 1]);
    });

    it('Vector2 form', () => {
      const m = new Matrix3().makeTranslation(new Vector2(2, 3));
      expect(m.elements).toEqual([1, 0, 0, 0, 1, 0, 2, 3, 1]);
    });
  });

  describe('makeRotation', () => {
    it('90° counterclockwise', () => {
      const m = new Matrix3().makeRotation(Math.PI / 2);
      // row-major: [0,-1,0; 1,0,0; 0,0,1] → column-major [0,1,0, -1,0,0, 0,0,1]
      expect(m.elements[0]).toBeCloseTo(0, 10);
      expect(m.elements[1]).toBeCloseTo(1, 10);
      expect(m.elements[3]).toBeCloseTo(-1, 10);
      expect(m.elements[4]).toBeCloseTo(0, 10);
      expect(m.elements[8]).toBe(1);
    });
  });

  describe('makeScale', () => {
    it('produces diagonal scale', () => {
      const m = new Matrix3().makeScale(2, 3);
      expect(m.elements).toEqual([2, 0, 0, 0, 3, 0, 0, 0, 1]);
    });
  });

  describe('scale / rotate / translate', () => {
    it('scale premultiplies a scale onto identity', () => {
      const m = new Matrix3().scale(2, 3);
      expect(m.elements).toEqual([2, 0, 0, 0, 3, 0, 0, 0, 1]);
    });

    it('rotate premultiplies a rotation onto identity', () => {
      // rotate(θ) → premultiply makeRotation(-θ); makeRotation(-π/2) column-major = [0,-1,0, 1,0,0, 0,0,1]
      const m = new Matrix3().rotate(Math.PI / 2);
      expect(m.elements[0]).toBeCloseTo(0, 10);
      expect(m.elements[1]).toBeCloseTo(-1, 10);
      expect(m.elements[3]).toBeCloseTo(1, 10);
      expect(m.elements[4]).toBeCloseTo(0, 10);
    });

    it('translate premultiplies a translation onto identity', () => {
      const m = new Matrix3().translate(2, 3);
      expect(m.elements).toEqual([1, 0, 0, 0, 1, 0, 2, 3, 1]);
    });

    it('matches explicit makeScale on non-identity', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const expected = new Matrix3().multiplyMatrices(
        new Matrix3().makeScale(2, 4),
        a,
      );
      const result = new Matrix3().copy(a).scale(2, 4);
      expect(result.elements).toEqual(expected.elements);
    });

    it('chained rotate matches premultiply order', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      // a.scale(2,3).rotate(0.5) => rot(-0.5) * scale(2,3) * a
      const expected = new Matrix3()
        .multiplyMatrices(new Matrix3().makeScale(2, 3), a)
        .premultiply(new Matrix3().makeRotation(-0.5));
      const result = new Matrix3().copy(a).scale(2, 3).rotate(0.5);
      expect(result.elements[0]).toBeCloseTo(expected.elements[0], 10);
      expect(result.elements[1]).toBeCloseTo(expected.elements[1], 10);
      expect(result.elements[4]).toBeCloseTo(expected.elements[4], 10);
      expect(result.elements[8]).toBeCloseTo(expected.elements[8], 10);
    });
  });

  describe('equals', () => {
    it('equal matrices', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      expect(a.equals(b)).toBe(true);
    });

    it('different matrices', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 0);
      expect(a.equals(b)).toBe(false);
    });
  });
});
