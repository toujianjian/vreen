import { describe, it, expect } from 'vitest';
import { Box3 } from './Box3';
import { Vector3 } from './Vector3';
import { Sphere } from './Sphere';
import { Plane } from './Plane';
import { Matrix4 } from './Matrix4';

describe('Box3', () => {
  describe('construction', () => {
    it('default constructs empty (min=+∞, max=-∞)', () => {
      const b = new Box3();
      expect(b.min.x).toBe(Infinity);
      expect(b.max.x).toBe(-Infinity);
      expect(b.isEmpty()).toBe(true);
    });

    it('constructs with min/max', () => {
      const b = new Box3(
        new Vector3(-1, -2, -3),
        new Vector3(1, 2, 3),
      );
      expect(b.min.x).toBe(-1);
      expect(b.min.y).toBe(-2);
      expect(b.min.z).toBe(-3);
      expect(b.max.x).toBe(1);
      expect(b.max.y).toBe(2);
      expect(b.max.z).toBe(3);
      expect(b.isEmpty()).toBe(false);
    });
  });

  describe('set / copy / clone', () => {
    it('set updates min and max and returns this', () => {
      const b = new Box3();
      const ret = b.set(new Vector3(0, 0, 0), new Vector3(5, 5, 5));
      expect(ret).toBe(b);
      expect(b.min.x).toBe(0);
      expect(b.max.x).toBe(5);
    });

    it('copy duplicates fields', () => {
      const a = new Box3(new Vector3(-1, -2, -3), new Vector3(1, 2, 3));
      const b = new Box3().copy(a);
      expect(b.min.x).toBe(-1);
      expect(b.max.z).toBe(3);
      a.min.x = 99;
      expect(b.min.x).toBe(-1);
    });

    it('clone returns independent instance', () => {
      const a = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.min.x).toBe(0);
      expect(b.max.x).toBe(1);
      b.min.x = -5;
      expect(a.min.x).toBe(0);
    });
  });

  describe('makeEmpty / isEmpty', () => {
    it('makeEmpty resets to empty state', () => {
      const b = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      b.makeEmpty();
      expect(b.isEmpty()).toBe(true);
      expect(b.min.x).toBe(Infinity);
      expect(b.max.x).toBe(-Infinity);
    });
  });

  describe('getCenter / getSize', () => {
    it('center is midpoint of min and max', () => {
      const b = new Box3(new Vector3(-1, -2, -3), new Vector3(1, 2, 3));
      const c = new Vector3();
      b.getCenter(c);
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.z).toBe(0);
    });

    it('size is max - min', () => {
      const b = new Box3(new Vector3(-1, -2, -3), new Vector3(1, 2, 3));
      const s = new Vector3();
      b.getSize(s);
      expect(s.x).toBe(2);
      expect(s.y).toBe(4);
      expect(s.z).toBe(6);
    });

    it('empty box returns (0,0,0) for center and size', () => {
      const b = new Box3();
      const c = new Vector3(99, 99, 99);
      const s = new Vector3(99, 99, 99);
      b.getCenter(c);
      b.getSize(s);
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.z).toBe(0);
      expect(s.x).toBe(0);
      expect(s.y).toBe(0);
      expect(s.z).toBe(0);
    });
  });

  describe('expandByPoint / expandByVector / expandByScalar', () => {
    it('expandByPoint grows box to include point', () => {
      const b = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      b.expandByPoint(new Vector3(5, -3, 2));
      expect(b.max.x).toBe(5);
      expect(b.min.y).toBe(-3);
      expect(b.max.z).toBe(2);
    });

    it('expandByVector expands symmetrically', () => {
      const b = new Box3(new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      b.expandByVector(new Vector3(1, 2, 3));
      expect(b.min.x).toBe(-1);
      expect(b.max.x).toBe(1);
      expect(b.min.y).toBe(-2);
      expect(b.max.y).toBe(2);
      expect(b.min.z).toBe(-3);
      expect(b.max.z).toBe(3);
    });

    it('expandByScalar expands uniformly', () => {
      const b = new Box3(new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      b.expandByScalar(2);
      expect(b.min.x).toBe(-2);
      expect(b.max.x).toBe(2);
      expect(b.min.z).toBe(-2);
      expect(b.max.z).toBe(2);
    });
  });

  describe('containsPoint', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));

    it('inside point returns true', () => {
      expect(box.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    });

    it('boundary point returns true (inclusive)', () => {
      expect(box.containsPoint(new Vector3(1, 1, 1))).toBe(true);
      expect(box.containsPoint(new Vector3(-1, -1, -1))).toBe(true);
    });

    it('outside point returns false', () => {
      expect(box.containsPoint(new Vector3(2, 0, 0))).toBe(false);
    });
  });

  describe('containsBox', () => {
    const outer = new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2));

    it('inner box is contained', () => {
      const inner = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(outer.containsBox(inner)).toBe(true);
    });

    it('overlapping box is not contained', () => {
      const overlap = new Box3(new Vector3(-3, 0, 0), new Vector3(0, 1, 1));
      expect(outer.containsBox(overlap)).toBe(false);
    });

    it('larger box is not contained', () => {
      const larger = new Box3(new Vector3(-3, -3, -3), new Vector3(3, 3, 3));
      expect(outer.containsBox(larger)).toBe(false);
    });
  });

  describe('intersectsBox', () => {
    const a = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));

    it('overlapping boxes intersect', () => {
      const b = new Box3(new Vector3(0.5, 0.5, 0.5), new Vector3(2, 2, 2));
      expect(a.intersectsBox(b)).toBe(true);
    });

    it('disjoint boxes do not intersect', () => {
      const b = new Box3(new Vector3(2, 2, 2), new Vector3(3, 3, 3));
      expect(a.intersectsBox(b)).toBe(false);
    });

    it('touching boxes intersect (boundary)', () => {
      const b = new Box3(new Vector3(1, -1, -1), new Vector3(2, 1, 1));
      expect(a.intersectsBox(b)).toBe(true);
    });
  });

  describe('intersectsSphere', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));

    it('sphere inside box intersects', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 0.5);
      expect(box.intersectsSphere(s)).toBe(true);
    });

    it('sphere far outside does not intersect', () => {
      const s = new Sphere(new Vector3(5, 0, 0), 0.5);
      expect(box.intersectsSphere(s)).toBe(false);
    });

    it('sphere overlapping boundary intersects', () => {
      const s = new Sphere(new Vector3(1.5, 0, 0), 1);
      expect(box.intersectsSphere(s)).toBe(true);
    });

    it('sphere tangent to box boundary intersects', () => {
      const s = new Sphere(new Vector3(2, 0, 0), 1);
      expect(box.intersectsSphere(s)).toBe(true);
    });
  });

  describe('intersectsPlane', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));

    it('plane crossing box intersects', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      expect(box.intersectsPlane(p)).toBe(true);
    });

    it('plane outside box does not intersect', () => {
      const p = new Plane(new Vector3(0, 1, 0), -10); // y=10
      expect(box.intersectsPlane(p)).toBe(false);
    });

    it('plane tangent to box face intersects', () => {
      const p = new Plane(new Vector3(0, 1, 0), -1); // y=1, touches +Y face
      expect(box.intersectsPlane(p)).toBe(true);
    });
  });

  describe('clampPoint', () => {
    it('clamps outside point to nearest boundary', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const target = new Vector3();
      box.clampPoint(new Vector3(5, 0, 0), target);
      expect(target.x).toBe(1);
      expect(target.y).toBe(0);
      expect(target.z).toBe(0);
    });

    it('does not move inside points', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const target = new Vector3();
      box.clampPoint(new Vector3(0.5, 0.5, 0.5), target);
      expect(target.x).toBe(0.5);
    });
  });

  describe('distanceToPoint', () => {
    it('0 for point inside box', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(box.distanceToPoint(new Vector3(0, 0, 0))).toBe(0);
    });

    it('positive for point outside box', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(box.distanceToPoint(new Vector3(2, 0, 0))).toBe(1);
    });

    it('3D distance for diagonal outside point', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(box.distanceToPoint(new Vector3(2, 2, 0))).toBeCloseTo(Math.SQRT2, 10);
    });
  });

  describe('getBoundingSphere', () => {
    it('returns sphere centered at box center with radius half-diagonal', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const s = new Sphere();
      box.getBoundingSphere(s);
      expect(s.center.x).toBe(0);
      expect(s.center.y).toBe(0);
      expect(s.center.z).toBe(0);
      expect(s.radius).toBeCloseTo(Math.sqrt(3), 10);
    });

    it('computeBoundingSphere is an alias', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const s = new Sphere();
      box.computeBoundingSphere(s);
      expect(s.radius).toBeCloseTo(Math.sqrt(3), 10);
    });

    it('empty box yields empty sphere', () => {
      const box = new Box3();
      const s = new Sphere(new Vector3(1, 1, 1), 5);
      box.getBoundingSphere(s);
      expect(s.isEmpty()).toBe(true);
    });
  });

  describe('intersect', () => {
    it('returns the overlap region', () => {
      const a = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const b = new Box3(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
      a.intersect(b);
      expect(a.min.x).toBe(0);
      expect(a.min.y).toBe(0);
      expect(a.min.z).toBe(0);
      expect(a.max.x).toBe(1);
      expect(a.max.y).toBe(1);
      expect(a.max.z).toBe(1);
    });

    it('disjoint boxes produce empty result', () => {
      const a = new Box3(new Vector3(-2, -2, -2), new Vector3(-1, -1, -1));
      const b = new Box3(new Vector3(1, 1, 1), new Vector3(2, 2, 2));
      a.intersect(b);
      expect(a.isEmpty()).toBe(true);
    });
  });

  describe('union', () => {
    it('returns the combined bounds', () => {
      const a = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const b = new Box3(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
      a.union(b);
      expect(a.min.x).toBe(-1);
      expect(a.min.y).toBe(-1);
      expect(a.min.z).toBe(-1);
      expect(a.max.x).toBe(2);
      expect(a.max.y).toBe(2);
      expect(a.max.z).toBe(2);
    });
  });

  describe('applyMatrix4', () => {
    it('identity leaves box unchanged', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const before = box.clone();
      box.applyMatrix4(new Matrix4());
      expect(box.min.x).toBeCloseTo(before.min.x, 10);
      expect(box.max.z).toBeCloseTo(before.max.z, 10);
    });

    it('translation moves the box', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const m = new Matrix4();
      m.elements[12] = 10;
      box.applyMatrix4(m);
      expect(box.min.x).toBeCloseTo(9, 10);
      expect(box.max.x).toBeCloseTo(11, 10);
    });

    it('scale enlarges the box', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const m = new Matrix4();
      m.elements[0] = 2; // scale x2
      box.applyMatrix4(m);
      expect(box.min.x).toBeCloseTo(-2, 10);
      expect(box.max.x).toBeCloseTo(2, 10);
    });

    it('empty box stays empty', () => {
      const box = new Box3();
      box.applyMatrix4(new Matrix4());
      expect(box.isEmpty()).toBe(true);
    });
  });

  describe('translate', () => {
    it('shifts min and max by offset', () => {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      box.translate(new Vector3(10, 20, 30));
      expect(box.min.x).toBe(9);
      expect(box.min.y).toBe(19);
      expect(box.min.z).toBe(29);
      expect(box.max.x).toBe(11);
      expect(box.max.y).toBe(21);
      expect(box.max.z).toBe(31);
    });
  });
});
