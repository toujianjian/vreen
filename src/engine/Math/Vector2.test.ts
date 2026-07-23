import { describe, it, expect } from 'vitest';
import { Vector2 } from './Vector2';

describe('Vector2', () => {
  describe('construction', () => {
    it('constructs with defaults', () => {
      const v = new Vector2();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });

    it('constructs with values', () => {
      const v = new Vector2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('width/height aliases map to x/y', () => {
      const v = new Vector2(2, 5);
      expect(v.width).toBe(2);
      expect(v.height).toBe(5);
      v.width = 10;
      v.height = 20;
      expect(v.x).toBe(10);
      expect(v.y).toBe(20);
    });
  });

  describe('set / setScalar / setX / setY', () => {
    it('set updates components and returns this', () => {
      const v = new Vector2();
      const ret = v.set(7, 8);
      expect(ret).toBe(v);
      expect(v.x).toBe(7);
      expect(v.y).toBe(8);
    });

    it('setScalar sets both components', () => {
      const v = new Vector2().setScalar(9);
      expect(v.x).toBe(9);
      expect(v.y).toBe(9);
    });

    it('setX / setY update single components', () => {
      const v = new Vector2().setX(1).setY(2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
    });
  });

  describe('setComponent / getComponent', () => {
    it('sets and gets by index', () => {
      const v = new Vector2().setComponent(0, 5).setComponent(1, 6);
      expect(v.getComponent(0)).toBe(5);
      expect(v.getComponent(1)).toBe(6);
    });

    it('throws on out-of-range index', () => {
      const v = new Vector2();
      expect(() => v.setComponent(2, 1)).toThrow();
      expect(() => v.getComponent(-1)).toThrow();
    });
  });

  describe('clone / copy', () => {
    it('clone returns independent instance', () => {
      const a = new Vector2(1, 2);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.x).toBe(1);
      expect(b.y).toBe(2);
      b.x = 99;
      expect(a.x).toBe(1);
    });

    it('copy duplicates and returns this', () => {
      const a = new Vector2(1, 2);
      const b = new Vector2();
      const ret = b.copy(a);
      expect(ret).toBe(b);
      expect(b.x).toBe(1);
      expect(b.y).toBe(2);
    });
  });

  describe('add', () => {
    it('adds component-wise', () => {
      const v = new Vector2(1, 2).add(new Vector2(3, 4));
      expect(v.x).toBe(4);
      expect(v.y).toBe(6);
    });

    it('addScalar adds to both components', () => {
      const v = new Vector2(1, 2).addScalar(10);
      expect(v.x).toBe(11);
      expect(v.y).toBe(12);
    });

    it('addVectors sets a+b', () => {
      const v = new Vector2().addVectors(new Vector2(1, 2), new Vector2(3, 4));
      expect(v.x).toBe(4);
      expect(v.y).toBe(6);
    });

    it('addScaledVector adds v*s', () => {
      const v = new Vector2(1, 1).addScaledVector(new Vector2(2, 3), 2);
      expect(v.x).toBe(5);
      expect(v.y).toBe(7);
    });
  });

  describe('sub', () => {
    it('subtracts component-wise', () => {
      const v = new Vector2(5, 7).sub(new Vector2(2, 3));
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('subScalar subtracts from both', () => {
      const v = new Vector2(5, 7).subScalar(2);
      expect(v.x).toBe(3);
      expect(v.y).toBe(5);
    });

    it('subVectors sets a-b', () => {
      const v = new Vector2().subVectors(new Vector2(5, 7), new Vector2(2, 3));
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('multiply / divide', () => {
    it('multiply component-wise', () => {
      const v = new Vector2(2, 3).multiply(new Vector2(4, 5));
      expect(v.x).toBe(8);
      expect(v.y).toBe(15);
    });

    it('multiplyScalar scales both', () => {
      const v = new Vector2(2, 3).multiplyScalar(4);
      expect(v.x).toBe(8);
      expect(v.y).toBe(12);
    });

    it('divide component-wise', () => {
      const v = new Vector2(8, 15).divide(new Vector2(2, 5));
      expect(v.x).toBe(4);
      expect(v.y).toBe(3);
    });

    it('divideScalar scales by 1/s', () => {
      const v = new Vector2(10, 20).divideScalar(5);
      expect(v.x).toBe(2);
      expect(v.y).toBe(4);
    });
  });

  describe('min / max / clamp', () => {
    it('min takes component-wise minimum', () => {
      const v = new Vector2(3, 1).min(new Vector2(2, 4));
      expect(v.x).toBe(2);
      expect(v.y).toBe(1);
    });

    it('max takes component-wise maximum', () => {
      const v = new Vector2(3, 1).max(new Vector2(2, 4));
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('clamp restricts to range', () => {
      const v = new Vector2(-5, 15).clamp(new Vector2(0, 0), new Vector2(10, 10));
      expect(v.x).toBe(0);
      expect(v.y).toBe(10);
    });

    it('clampScalar restricts both to scalar range', () => {
      const v = new Vector2(-5, 15).clampScalar(0, 10);
      expect(v.x).toBe(0);
      expect(v.y).toBe(10);
    });

    it('clampLength restricts length but keeps direction', () => {
      const v = new Vector2(3, 4); // length 5
      v.clampLength(0, 2.5);
      expect(v.length()).toBeCloseTo(2.5, 10);
      expect(v.x).toBeCloseTo(1.5, 10);
      expect(v.y).toBeCloseTo(2.0, 10);
    });
  });

  describe('floor / ceil / round / roundToZero', () => {
    it('floor rounds down', () => {
      const v = new Vector2(1.7, -1.2).floor();
      expect(v.x).toBe(1);
      expect(v.y).toBe(-2);
    });

    it('ceil rounds up', () => {
      const v = new Vector2(1.2, -1.7).ceil();
      expect(v.x).toBe(2);
      expect(v.y).toBe(-1);
    });

    it('round rounds to nearest', () => {
      const v = new Vector2(1.4, 1.6).round();
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
    });

    it('roundToZero truncates toward zero', () => {
      const v = new Vector2(-1.7, 1.7).roundToZero();
      expect(v.x).toBe(-1);
      expect(v.y).toBe(1);
    });
  });

  describe('negate', () => {
    it('flips signs', () => {
      const v = new Vector2(3, -4).negate();
      expect(v.x).toBe(-3);
      expect(v.y).toBe(4);
    });
  });

  describe('dot / cross', () => {
    it('dot returns x1*x2 + y1*y2', () => {
      expect(new Vector2(1, 2).dot(new Vector2(3, 4))).toBe(11);
    });

    it('cross returns scalar x1*y2 - y1*x2', () => {
      // (1,0) × (0,1) = 1*1 - 0*0 = 1
      expect(new Vector2(1, 0).cross(new Vector2(0, 1))).toBe(1);
      // (0,1) × (1,0) = 0*0 - 1*1 = -1
      expect(new Vector2(0, 1).cross(new Vector2(1, 0))).toBe(-1);
    });
  });

  describe('length / lengthSq / manhattan', () => {
    it('lengthSq is x²+y²', () => {
      expect(new Vector2(3, 4).lengthSq()).toBe(25);
    });

    it('length is sqrt(lengthSq)', () => {
      expect(new Vector2(3, 4).length()).toBe(5);
    });

    it('length is 0 for zero vector', () => {
      expect(new Vector2().length()).toBe(0);
    });

    it('manhattanLength is |x|+|y|', () => {
      expect(new Vector2(-3, 4).manhattanLength()).toBe(7);
    });
  });

  describe('normalize', () => {
    it('normalizes to unit length', () => {
      const v = new Vector2(3, 4).normalize();
      expect(v.length()).toBeCloseTo(1, 10);
      expect(v.x).toBeCloseTo(0.6, 10);
      expect(v.y).toBeCloseTo(0.8, 10);
    });

    it('does not throw on zero vector', () => {
      const v = new Vector2().normalize();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });
  });

  describe('angle', () => {
    it('angle of (1,0) is 0', () => {
      expect(new Vector2(1, 0).angle()).toBeCloseTo(0, 10);
    });

    it('angle of (0,1) is π/2', () => {
      expect(new Vector2(0, 1).angle()).toBeCloseTo(Math.PI / 2, 10);
    });

    it('angle of (-1,0) is π', () => {
      expect(new Vector2(-1, 0).angle()).toBeCloseTo(Math.PI, 10);
    });
  });

  describe('angleTo', () => {
    it('angle between (1,0) and (0,1) is π/2', () => {
      expect(new Vector2(1, 0).angleTo(new Vector2(0, 1))).toBeCloseTo(Math.PI / 2, 10);
    });

    it('angle between parallel vectors is 0', () => {
      expect(new Vector2(2, 0).angleTo(new Vector2(3, 0))).toBeCloseTo(0, 10);
    });

    it('angle between opposite vectors is π', () => {
      expect(new Vector2(1, 0).angleTo(new Vector2(-1, 0))).toBeCloseTo(Math.PI, 10);
    });

    it('returns π/2 when one vector is zero', () => {
      expect(new Vector2(0, 0).angleTo(new Vector2(1, 0))).toBeCloseTo(Math.PI / 2, 10);
    });
  });

  describe('distance / manhattan distance', () => {
    it('distanceTo is 0 for same point', () => {
      expect(new Vector2(1, 1).distanceTo(new Vector2(1, 1))).toBe(0);
    });

    it('distanceTo works for separated points', () => {
      expect(new Vector2(0, 0).distanceTo(new Vector2(3, 4))).toBe(5);
    });

    it('distanceToSquared', () => {
      expect(new Vector2(0, 0).distanceToSquared(new Vector2(3, 4))).toBe(25);
    });

    it('manhattanDistanceTo', () => {
      expect(new Vector2(0, 0).manhattanDistanceTo(new Vector2(3, 4))).toBe(7);
    });
  });

  describe('setLength', () => {
    it('scales to requested length preserving direction', () => {
      const v = new Vector2(3, 4); // length 5
      v.setLength(10);
      expect(v.length()).toBeCloseTo(10, 10);
      expect(v.x).toBeCloseTo(6, 10);
      expect(v.y).toBeCloseTo(8, 10);
    });
  });

  describe('lerp / lerpVectors', () => {
    it('alpha=0 leaves unchanged', () => {
      const v = new Vector2(1, 2).lerp(new Vector2(10, 20), 0);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
    });

    it('alpha=1 reaches target', () => {
      const v = new Vector2(1, 2).lerp(new Vector2(10, 20), 1);
      expect(v.x).toBe(10);
      expect(v.y).toBe(20);
    });

    it('alpha=0.5 reaches midpoint', () => {
      const v = new Vector2(0, 0).lerp(new Vector2(2, 4), 0.5);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
    });

    it('lerpVectors interpolates without modifying inputs', () => {
      const a = new Vector2(1, 2);
      const b = new Vector2(5, 6);
      const out = new Vector2().lerpVectors(a, b, 0.25);
      expect(out.x).toBe(2);
      expect(out.y).toBe(3);
      expect(a.x).toBe(1);
      expect(b.x).toBe(5);
    });
  });

  describe('equals', () => {
    it('true for equal vectors', () => {
      expect(new Vector2(1, 2).equals(new Vector2(1, 2))).toBe(true);
    });

    it('false when any component differs', () => {
      expect(new Vector2(1, 2).equals(new Vector2(1, 3))).toBe(false);
    });
  });

  describe('toArray / fromArray', () => {
    it('toArray returns [x, y]', () => {
      expect(new Vector2(1, 2).toArray()).toEqual([1, 2]);
    });

    it('fromArray sets components', () => {
      const v = new Vector2().fromArray([4, 5]);
      expect(v.x).toBe(4);
      expect(v.y).toBe(5);
    });
  });

  describe('applyMatrix3', () => {
    it('identity matrix leaves vector unchanged', () => {
      // column-major identity 3x3
      const ident = { elements: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
      const v = new Vector2(2, 3).applyMatrix3(ident);
      expect(v.x).toBeCloseTo(2, 10);
      expect(v.y).toBeCloseTo(3, 10);
    });

    it('translation matrix moves the point', () => {
      // 2D affine: identity linear + translation (5, -2)
      // column-major: [1,0,0, 0,1,0, 5,-2,1]
      const m = { elements: [1, 0, 0, 0, 1, 0, 5, -2, 1] };
      const v = new Vector2(1, 1).applyMatrix3(m);
      expect(v.x).toBeCloseTo(6, 10);
      expect(v.y).toBeCloseTo(-1, 10);
    });

    it('scale matrix scales the point', () => {
      // column-major scale (2, 3): [2,0,0, 0,3,0, 0,0,1]
      const m = { elements: [2, 0, 0, 0, 3, 0, 0, 0, 1] };
      const v = new Vector2(1, 1).applyMatrix3(m);
      expect(v.x).toBeCloseTo(2, 10);
      expect(v.y).toBeCloseTo(3, 10);
    });
  });

  describe('rotateAround', () => {
    it('rotates (1,0) by π/2 around origin → (0,1)', () => {
      const v = new Vector2(1, 0).rotateAround(new Vector2(0, 0), Math.PI / 2);
      expect(v.x).toBeCloseTo(0, 10);
      expect(v.y).toBeCloseTo(1, 10);
    });

    it('rotation by 2π returns to start', () => {
      const v = new Vector2(3, 4).rotateAround(new Vector2(1, 1), Math.PI * 2);
      expect(v.x).toBeCloseTo(3, 6);
      expect(v.y).toBeCloseTo(4, 6);
    });

    it('rotation around non-origin center', () => {
      // point (2,0) rotated by π around (1,0) → (0,0)
      const v = new Vector2(2, 0).rotateAround(new Vector2(1, 0), Math.PI);
      expect(v.x).toBeCloseTo(0, 6);
      expect(v.y).toBeCloseTo(0, 6);
    });
  });
});
