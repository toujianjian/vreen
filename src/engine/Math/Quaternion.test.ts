import { describe, it, expect, vi, afterEach } from 'vitest';
import { Quaternion } from './Quaternion';
import { Matrix4 } from './Matrix4';
import { Vector3 } from './Vector3';
import { Vector2 } from './Vector2';
import { BufferAttribute } from '../Core/BufferAttribute';

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

  describe('angleTo / rotateTowards', () => {
    it('angleTo identity → identity is 0', () => {
      expect(new Quaternion().angleTo(new Quaternion())).toBeCloseTo(0, 10);
    });

    it('angleTo identity → 90°Z is π/2', () => {
      const q = new Quaternion().setFromEuler(0, 0, Math.PI / 2);
      expect(new Quaternion().angleTo(q)).toBeCloseTo(Math.PI / 2, 10);
    });

    it('angleTo is symmetric', () => {
      const a = new Quaternion().setFromEuler(0.2, -0.4, 0.7);
      const b = new Quaternion().setFromEuler(-0.1, 0.9, 0.3);
      expect(a.angleTo(b)).toBeCloseTo(b.angleTo(a), 10);
    });

    it('rotateTowards moves halfway when step = half angle', () => {
      const q = new Quaternion().setFromEuler(0, 0, Math.PI / 2);
      const out = new Quaternion().rotateTowards(q, Math.PI / 4);
      // 半程 = 45°Z → z/w = sin(π/8)/cos(π/8)
      const s = Math.sin(Math.PI / 8);
      const c = Math.cos(Math.PI / 8);
      expect(out.z).toBeCloseTo(s, 6);
      expect(out.w).toBeCloseTo(c, 6);
    });

    it('rotateTowards clamps t to 1 when step ≥ angle', () => {
      const q = new Quaternion().setFromEuler(0, 0, Math.PI / 2);
      const out = new Quaternion().rotateTowards(q, Math.PI);
      expect(out.z).toBeCloseTo(Math.SQRT1_2, 10);
      expect(out.w).toBeCloseTo(Math.SQRT1_2, 10);
    });

    it('rotateTowards with step 0 leaves unchanged', () => {
      const a = new Quaternion().setFromEuler(0.2, 0.3, 0.4);
      const before = a.clone();
      a.rotateTowards(new Quaternion(), 0);
      expect(a.equals(before)).toBe(true);
    });
  });

  describe('lengthSq / length', () => {
    it('lengthSq = x²+y²+z²+w²', () => {
      const q = new Quaternion(1, 2, 3, 4);
      expect(q.lengthSq()).toBe(30);
    });

    it('length = √lengthSq', () => {
      const q = new Quaternion(1, 2, 3, 4);
      expect(q.length()).toBeCloseTo(Math.sqrt(30), 10);
    });

    it('identity has length 1', () => {
      expect(new Quaternion().length()).toBeCloseTo(1, 10);
    });
  });

  describe('slerpQuaternions', () => {
    it('computes midpoint of identity → 90°Z', () => {
      const a = new Quaternion();
      const b = new Quaternion().setFromEuler(0, 0, Math.PI / 2);
      const out = new Quaternion().slerpQuaternions(a, b, 0.5);
      const s = Math.sin(Math.PI / 8);
      const c = Math.cos(Math.PI / 8);
      expect(out.z).toBeCloseTo(s, 6);
      expect(out.w).toBeCloseTo(c, 6);
    });

    it('does not mutate inputs', () => {
      const a = new Quaternion(0.1, 0.2, 0.3, 0.4).normalize();
      const b = new Quaternion(0.5, -0.5, 0.5, 0.5).normalize();
      const a0 = a.clone();
      const b0 = b.clone();
      new Quaternion().slerpQuaternions(a, b, 0.3);
      expect(a.equals(a0)).toBe(true);
      expect(b.equals(b0)).toBe(true);
    });
  });

  describe('random', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('produces a unit quaternion', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const q = new Quaternion().random();
      expect(q.length()).toBeCloseTo(1, 10);
    });

    it('is deterministic under stubbed Math.random', () => {
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.5) // theta1
        .mockReturnValueOnce(0.5) // theta2
        .mockReturnValueOnce(0.25); // x0
      const q = new Quaternion().random();
      // theta1=θ2=π, x0=0.25 → r1=√0.75, r2=√0.25
      expect(q.x).toBeCloseTo(0, 10);
      expect(q.y).toBeCloseTo(-Math.sqrt(0.75), 10);
      expect(q.z).toBeCloseTo(0, 10);
      expect(q.w).toBeCloseTo(-0.5, 10);
    });
  });

  describe('fromBufferAttribute + BufferAttribute getters', () => {
    it('BufferAttribute.getX/Y/Z/W read at itemSize stride', () => {
      const attr = new BufferAttribute([1, 2, 3, 4, 5, 6, 7, 8], 4);
      expect(attr.getX(0)).toBe(1);
      expect(attr.getY(0)).toBe(2);
      expect(attr.getZ(0)).toBe(3);
      expect(attr.getW(0)).toBe(4);
      expect(attr.getX(1)).toBe(5);
      expect(attr.getY(1)).toBe(6);
      expect(attr.getZ(1)).toBe(7);
      expect(attr.getW(1)).toBe(8);
    });

    it('Quaternion.fromBufferAttribute reads x/y/z/w at index', () => {
      const attr = new BufferAttribute([9, 9, 9, 9, 0.5, 0.25, 0.125, 0.0625], 4);
      const q = new Quaternion().fromBufferAttribute(attr, 1);
      expect(q.x).toBeCloseTo(0.5, 10);
      expect(q.y).toBeCloseTo(0.25, 10);
      expect(q.z).toBeCloseTo(0.125, 10);
      expect(q.w).toBeCloseTo(0.0625, 10);
    });

    it('Vector3.fromBufferAttribute reads x/y/z at index', () => {
      const attr = new BufferAttribute([0, 0, 0, 5, 5, 5, 1, 2, 3], 3);
      const v = new Vector3().fromBufferAttribute(attr, 2);
      expect(v.x).toBeCloseTo(1, 10);
      expect(v.y).toBeCloseTo(2, 10);
      expect(v.z).toBeCloseTo(3, 10);
    });

    it('Vector2.fromBufferAttribute reads x/y at index', () => {
      const attr = new BufferAttribute([0, 0, 4, 5], 2);
      const v = new Vector2().fromBufferAttribute(attr, 1);
      expect(v.x).toBeCloseTo(4, 10);
      expect(v.y).toBeCloseTo(5, 10);
    });

    it('BufferAttribute.getXY/XYZ/XYZW fill caller targets', () => {
      const attr = new BufferAttribute([1, 2, 3, 4, 5, 6, 7, 8], 4);
      const xy = attr.getXY(1, new Vector2());
      expect(xy.x).toBe(5);
      expect(xy.y).toBe(6);
      const xyz = attr.getXYZ(1, new Vector3());
      expect(xyz.x).toBe(5);
      expect(xyz.y).toBe(6);
      expect(xyz.z).toBe(7);
      const xyzw = attr.getXYZW(1, new Quaternion());
      expect(xyzw.x).toBe(5);
      expect(xyzw.y).toBe(6);
      expect(xyzw.z).toBe(7);
      expect(xyzw.w).toBe(8);
    });
  });

  describe('toJSON', () => {
    it('returns [x, y, z, w] array', () => {
      expect(new Quaternion(1, 2, 3, 4).toJSON()).toEqual([1, 2, 3, 4]);
    });
  });
});