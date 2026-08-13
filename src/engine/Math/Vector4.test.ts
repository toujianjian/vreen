import { describe, it, expect } from 'vitest';
import { Vector4 } from './Vector4';
import { Vector3 } from './Vector3';
import { Matrix4 } from './Matrix4';
import { Quaternion } from './Quaternion';
import { BufferAttribute } from '../Core/BufferAttribute';

describe('Vector4', () => {
  describe('construction', () => {
    it('constructs with defaults (0,0,0,1)', () => {
      const v = new Vector4();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
      expect(v.w).toBe(1);
    });

    it('constructs with values', () => {
      const v = new Vector4(1, 2, 3, 4);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
      expect(v.w).toBe(4);
    });

    it('width/height aliases map to z/w', () => {
      const v = new Vector4(0, 0, 5, 7);
      expect(v.width).toBe(5);
      expect(v.height).toBe(7);
      v.width = 50;
      v.height = 70;
      expect(v.z).toBe(50);
      expect(v.w).toBe(70);
    });
  });

  describe('set / setScalar / setX..setW', () => {
    it('set updates all components and returns this', () => {
      const v = new Vector4();
      const ret = v.set(1, 2, 3, 4);
      expect(ret).toBe(v);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
      expect(v.w).toBe(4);
    });

    it('setScalar sets all components', () => {
      const v = new Vector4().setScalar(7);
      expect(v.x).toBe(7);
      expect(v.y).toBe(7);
      expect(v.z).toBe(7);
      expect(v.w).toBe(7);
    });

    it('setX..setW update single components', () => {
      const v = new Vector4().setX(1).setY(2).setZ(3).setW(4);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
      expect(v.w).toBe(4);
    });
  });

  describe('setComponent / getComponent', () => {
    it('sets and gets by index 0..3', () => {
      const v = new Vector4()
        .setComponent(0, 1)
        .setComponent(1, 2)
        .setComponent(2, 3)
        .setComponent(3, 4);
      expect(v.getComponent(0)).toBe(1);
      expect(v.getComponent(1)).toBe(2);
      expect(v.getComponent(2)).toBe(3);
      expect(v.getComponent(3)).toBe(4);
    });

    it('throws on out-of-range index', () => {
      const v = new Vector4();
      expect(() => v.setComponent(4, 1)).toThrow();
      expect(() => v.getComponent(-1)).toThrow();
    });
  });

  describe('clone / copy', () => {
    it('clone returns independent instance', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.x).toBe(1);
      expect(b.y).toBe(2);
      expect(b.z).toBe(3);
      expect(b.w).toBe(4);
      b.x = 99;
      expect(a.x).toBe(1);
    });

    it('copy duplicates fields and returns this', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4();
      const ret = b.copy(a);
      expect(ret).toBe(b);
      expect(b.x).toBe(1);
      expect(b.y).toBe(2);
      expect(b.z).toBe(3);
      expect(b.w).toBe(4);
    });

    it('copy from {x,y,z} (no w) defaults w to 1', () => {
      const v = new Vector4();
      v.copy({ x: 5, y: 6, z: 7 });
      expect(v.x).toBe(5);
      expect(v.y).toBe(6);
      expect(v.z).toBe(7);
      expect(v.w).toBe(1);
    });
  });

  describe('add', () => {
    it('adds component-wise', () => {
      const v = new Vector4(1, 2, 3, 4).add(new Vector4(10, 20, 30, 40));
      expect(v.x).toBe(11);
      expect(v.y).toBe(22);
      expect(v.z).toBe(33);
      expect(v.w).toBe(44);
    });

    it('addScalar', () => {
      const v = new Vector4(1, 2, 3, 4).addScalar(10);
      expect(v.x).toBe(11);
      expect(v.y).toBe(12);
      expect(v.z).toBe(13);
      expect(v.w).toBe(14);
    });

    it('addVectors', () => {
      const v = new Vector4().addVectors(
        new Vector4(1, 2, 3, 4),
        new Vector4(10, 20, 30, 40),
      );
      expect(v.x).toBe(11);
      expect(v.y).toBe(22);
      expect(v.z).toBe(33);
      expect(v.w).toBe(44);
    });

    it('addScaledVector', () => {
      const v = new Vector4(1, 1, 1, 1).addScaledVector(new Vector4(2, 3, 4, 5), 2);
      expect(v.x).toBe(5);
      expect(v.y).toBe(7);
      expect(v.z).toBe(9);
      expect(v.w).toBe(11);
    });
  });

  describe('sub', () => {
    it('subtracts component-wise', () => {
      const v = new Vector4(10, 20, 30, 40).sub(new Vector4(1, 2, 3, 4));
      expect(v.x).toBe(9);
      expect(v.y).toBe(18);
      expect(v.z).toBe(27);
      expect(v.w).toBe(36);
    });

    it('subScalar', () => {
      const v = new Vector4(10, 20, 30, 40).subScalar(1);
      expect(v.x).toBe(9);
      expect(v.y).toBe(19);
      expect(v.z).toBe(29);
      expect(v.w).toBe(39);
    });

    it('subVectors', () => {
      const v = new Vector4().subVectors(
        new Vector4(10, 20, 30, 40),
        new Vector4(1, 2, 3, 4),
      );
      expect(v.x).toBe(9);
      expect(v.y).toBe(18);
      expect(v.z).toBe(27);
      expect(v.w).toBe(36);
    });
  });

  describe('multiply / divide', () => {
    it('multiply component-wise', () => {
      const v = new Vector4(1, 2, 3, 4).multiply(new Vector4(2, 3, 4, 5));
      expect(v.x).toBe(2);
      expect(v.y).toBe(6);
      expect(v.z).toBe(12);
      expect(v.w).toBe(20);
    });

    it('multiplyScalar', () => {
      const v = new Vector4(1, 2, 3, 4).multiplyScalar(2);
      expect(v.x).toBe(2);
      expect(v.y).toBe(4);
      expect(v.z).toBe(6);
      expect(v.w).toBe(8);
    });

    it('divide component-wise', () => {
      const v = new Vector4(2, 6, 12, 20).divide(new Vector4(2, 3, 4, 5));
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
      expect(v.w).toBe(4);
    });

    it('divideScalar', () => {
      const v = new Vector4(2, 4, 6, 8).divideScalar(2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
      expect(v.w).toBe(4);
    });
  });

  describe('applyMatrix4', () => {
    it('identity leaves vector unchanged', () => {
      const m = new Matrix4();
      const v = new Vector4(1, 2, 3, 4).applyMatrix4(m);
      expect(v.x).toBeCloseTo(1, 10);
      expect(v.y).toBeCloseTo(2, 10);
      expect(v.z).toBeCloseTo(3, 10);
      expect(v.w).toBeCloseTo(4, 10);
    });

    it('pure translation moves the point (w=1)', () => {
      const m = new Matrix4();
      m.elements[12] = 10;
      m.elements[13] = 20;
      m.elements[14] = 30;
      const v = new Vector4(1, 2, 3, 1).applyMatrix4(m);
      expect(v.x).toBeCloseTo(11, 10);
      expect(v.y).toBeCloseTo(22, 10);
      expect(v.z).toBeCloseTo(33, 10);
      expect(v.w).toBeCloseTo(1, 10);
    });

    it('scale matrix scales components', () => {
      const m = new Matrix4();
      m.elements[0] = 2;
      m.elements[5] = 3;
      m.elements[10] = 4;
      const v = new Vector4(1, 1, 1, 1).applyMatrix4(m);
      expect(v.x).toBeCloseTo(2, 10);
      expect(v.y).toBeCloseTo(3, 10);
      expect(v.z).toBeCloseTo(4, 10);
      expect(v.w).toBeCloseTo(1, 10);
    });
  });

  describe('negate', () => {
    it('flips signs of all components', () => {
      const v = new Vector4(1, -2, 3, -4).negate();
      expect(v.x).toBe(-1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(-3);
      expect(v.w).toBe(4);
    });
  });

  describe('dot', () => {
    it('returns sum of products', () => {
      expect(new Vector4(1, 2, 3, 4).dot(new Vector4(2, 3, 4, 5))).toBe(40);
    });

    it('dot with zero vector is 0', () => {
      expect(new Vector4(1, 2, 3, 4).dot(new Vector4(0, 0, 0, 0))).toBe(0);
    });
  });

  describe('length / lengthSq / manhattan', () => {
    it('lengthSq is sum of squares', () => {
      expect(new Vector4(1, 2, 3, 4).lengthSq()).toBe(30);
    });

    it('length is sqrt of lengthSq', () => {
      expect(new Vector4(1, 2, 3, 4).length()).toBeCloseTo(Math.sqrt(30), 10);
    });

    it('length is 0 for zero vector', () => {
      expect(new Vector4(0, 0, 0, 0).length()).toBe(0);
    });

    it('manhattanLength is sum of abs', () => {
      expect(new Vector4(1, -2, 3, -4).manhattanLength()).toBe(10);
    });
  });

  describe('normalize', () => {
    it('normalizes to unit length', () => {
      const v = new Vector4(1, 2, 3, 4).normalize();
      expect(v.length()).toBeCloseTo(1, 10);
    });

    it('zero vector does not throw', () => {
      const v = new Vector4(0, 0, 0, 0).normalize();
      // divideScalar(1/0) → Infinity, but the impl uses (length() || 1)
      // so zero-length yields divideScalar(1) → still zero
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
      expect(v.w).toBe(0);
    });
  });

  describe('setLength', () => {
    it('scales to requested length', () => {
      const v = new Vector4(1, 2, 3, 4); // length sqrt(30)
      v.setLength(Math.sqrt(30) * 2);
      expect(v.length()).toBeCloseTo(Math.sqrt(30) * 2, 6);
    });
  });

  describe('distance', () => {
    it('distanceTo is 0 for same point', () => {
      expect(new Vector4(1, 2, 3, 4).distanceTo(new Vector4(1, 2, 3, 4))).toBe(0);
    });

    it('distanceTo matches expected value', () => {
      expect(new Vector4(0, 0, 0, 0).distanceTo(new Vector4(3, 4, 0, 0))).toBe(5);
    });

    it('distanceToSquared', () => {
      expect(new Vector4(0, 0, 0, 0).distanceToSquared(new Vector4(1, 2, 3, 4))).toBe(30);
    });
  });

  describe('lerp / lerpVectors', () => {
    it('alpha=0 leaves unchanged', () => {
      const v = new Vector4(1, 2, 3, 4).lerp(new Vector4(10, 20, 30, 40), 0);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
      expect(v.w).toBe(4);
    });

    it('alpha=1 reaches target', () => {
      const v = new Vector4(1, 2, 3, 4).lerp(new Vector4(10, 20, 30, 40), 1);
      expect(v.x).toBe(10);
      expect(v.y).toBe(20);
      expect(v.z).toBe(30);
      expect(v.w).toBe(40);
    });

    it('alpha=0.5 reaches midpoint', () => {
      const v = new Vector4(0, 0, 0, 0).lerp(new Vector4(2, 4, 6, 8), 0.5);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
      expect(v.w).toBe(4);
    });

    it('lerpVectors interpolates without modifying inputs', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(5, 6, 7, 8);
      const out = new Vector4().lerpVectors(a, b, 0.25);
      expect(out.x).toBe(2);
      expect(out.y).toBe(3);
      expect(out.z).toBe(4);
      expect(out.w).toBe(5);
      expect(a.x).toBe(1);
      expect(b.x).toBe(5);
    });
  });

  describe('equals', () => {
    it('true for equal vectors', () => {
      expect(new Vector4(1, 2, 3, 4).equals(new Vector4(1, 2, 3, 4))).toBe(true);
    });

    it('false when any component differs', () => {
      expect(new Vector4(1, 2, 3, 4).equals(new Vector4(1, 2, 3, 5))).toBe(false);
    });
  });

  describe('toArray / fromArray', () => {
    it('toArray returns [x,y,z,w]', () => {
      expect(new Vector4(1, 2, 3, 4).toArray()).toEqual([1, 2, 3, 4]);
    });

    it('fromArray sets components', () => {
      const v = new Vector4().fromArray([4, 5, 6, 7]);
      expect(v.x).toBe(4);
      expect(v.y).toBe(5);
      expect(v.z).toBe(6);
      expect(v.w).toBe(7);
    });

    it('toArray writes into target array at offset', () => {
      const out: number[] = [0, 0, 0, 0, 0, 0];
      const arr = new Vector4(1, 2, 3, 4).toArray(out, 1);
      expect(arr).toBe(out);
      expect(out).toEqual([0, 1, 2, 3, 4, 0]);
    });

    it('fromArray reads at offset', () => {
      const v = new Vector4().fromArray([99, 1, 2, 3, 4, 99], 1);
      expect(v).toEqual(new Vector4(1, 2, 3, 4));
    });
  });

  describe('min / max', () => {
    it('min keeps component-wise minimum', () => {
      const v = new Vector4(5, 1, 3, 2).min(new Vector4(2, 4, 3, 0));
      expect(v.x).toBe(2);
      expect(v.y).toBe(1);
      expect(v.z).toBe(3);
      expect(v.w).toBe(0);
    });

    it('max keeps component-wise maximum', () => {
      const v = new Vector4(5, 1, 3, 2).max(new Vector4(2, 4, 3, 0));
      expect(v.x).toBe(5);
      expect(v.y).toBe(4);
      expect(v.z).toBe(3);
      expect(v.w).toBe(2);
    });
  });

  describe('clamp / clampScalar / clampLength', () => {
    it('clamp component-wise', () => {
      const v = new Vector4(-1, 0.5, 3, 2).clamp(new Vector4(0, 0, 0, 1), new Vector4(1, 1, 1, 2));
      expect(v.x).toBe(0);
      expect(v.y).toBe(0.5);
      expect(v.z).toBe(1);
      expect(v.w).toBe(2);
    });

    it('clampScalar clamps all components', () => {
      const v = new Vector4(-2, 0.5, 5, 1.5).clampScalar(-1, 1);
      expect(v.x).toBe(-1);
      expect(v.y).toBe(0.5);
      expect(v.z).toBe(1);
      expect(v.w).toBe(1);
    });

    it('clampLength clamps length preserving direction', () => {
      const v = new Vector4(3, 4, 0, 0).clampLength(1, 2);
      expect(v.length()).toBeCloseTo(2);
      expect(v.normalize().dot(new Vector4(0.6, 0.8, 0, 0))).toBeCloseTo(1);
    });

    it('clampLength on zero vector stays zero', () => {
      const v = new Vector4(0, 0, 0, 0).clampLength(1, 2);
      expect(v.length()).toBe(0);
    });
  });

  describe('floor / ceil / round / roundToZero', () => {
    it('floor', () => {
      const v = new Vector4(1.7, -1.7, 2.2, -2.9).floor();
      expect(v.x).toBe(1);
      expect(v.y).toBe(-2);
      expect(v.z).toBe(2);
      expect(v.w).toBe(-3);
    });

    it('ceil', () => {
      const v = new Vector4(1.2, -1.2, 2.8, -2.1).ceil();
      expect(v.x).toBe(2);
      expect(v.y).toBe(-1);
      expect(v.z).toBe(3);
      expect(v.w).toBe(-2);
    });

    it('round', () => {
      const v = new Vector4(1.4, 1.6, -1.4, -1.6).round();
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(-1);
      expect(v.w).toBe(-2);
    });

    it('roundToZero truncates toward zero', () => {
      const v = new Vector4(1.7, -1.7, 2.9, -2.9).roundToZero();
      expect(v.x).toBe(1);
      expect(v.y).toBe(-1);
      expect(v.z).toBe(2);
      expect(v.w).toBe(-2);
    });
  });

  describe('setAxisAngleFromQuaternion', () => {
    it('identity quaternion gives zero angle, arbitrary axis (1,0,0)', () => {
      const q = new Quaternion();
      const v = new Vector4().setAxisAngleFromQuaternion(q);
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
      expect(v.w).toBe(0);
    });

    it('90° around Z gives axis (0,0,1), angle π/2', () => {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
      const v = new Vector4().setAxisAngleFromQuaternion(q);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(0);
      expect(v.z).toBeCloseTo(1);
      expect(v.w).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('setAxisAngleFromRotationMatrix', () => {
    it('identity matrix gives angle 0, axis (1,0,0)', () => {
      const m = new Matrix4();
      const v = new Vector4().setAxisAngleFromRotationMatrix(m);
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
      expect(v.w).toBe(0);
    });

    it('90° rotation around Z gives axis (0,0,1), angle π/2', () => {
      const m = new Matrix4().makeRotationZ(Math.PI / 2);
      const v = new Vector4().setAxisAngleFromRotationMatrix(m);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(0);
      expect(v.z).toBeCloseTo(1);
      expect(v.w).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('setFromMatrixPosition', () => {
    it('reads translation column from matrix', () => {
      const m = new Matrix4().makeTranslation(5, 6, 7);
      const v = new Vector4().setFromMatrixPosition(m);
      expect(v.x).toBe(5);
      expect(v.y).toBe(6);
      expect(v.z).toBe(7);
      expect(v.w).toBe(1);
    });
  });

  describe('fromBufferAttribute', () => {
    it('reads x/y/z/w at index (itemSize 4)', () => {
      const attr = new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]), 4);
      const v = new Vector4().fromBufferAttribute(attr, 1);
      expect(v.x).toBe(5);
      expect(v.y).toBe(6);
      expect(v.z).toBe(7);
      expect(v.w).toBe(8);
    });
  });

  describe('random', () => {
    it('sets all components to [0, 1)', () => {
      const v = new Vector4(9, 9, 9, 9).random();
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThan(1);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeLessThan(1);
      expect(v.z).toBeGreaterThanOrEqual(0);
      expect(v.z).toBeLessThan(1);
      expect(v.w).toBeGreaterThanOrEqual(0);
      expect(v.w).toBeLessThan(1);
    });
  });
});
