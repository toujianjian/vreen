import { describe, it, expect } from 'vitest';
import { Sphere } from './Sphere';
import { Vector3 } from './Vector3';
import { Box3 } from './Box3';
import { Plane } from './Plane';
import { Matrix4 } from './Matrix4';

describe('Sphere', () => {
  describe('construction', () => {
    it('default constructs empty (center=0, radius=-1)', () => {
      const s = new Sphere();
      expect(s.center.x).toBe(0);
      expect(s.center.y).toBe(0);
      expect(s.center.z).toBe(0);
      expect(s.radius).toBe(-1);
      expect(s.isEmpty()).toBe(true);
    });

    it('constructs with center and radius', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 5);
      expect(s.center.x).toBe(1);
      expect(s.center.y).toBe(2);
      expect(s.center.z).toBe(3);
      expect(s.radius).toBe(5);
      expect(s.isEmpty()).toBe(false);
    });
  });

  describe('set / copy / clone', () => {
    it('set updates center and radius and returns this', () => {
      const s = new Sphere();
      const ret = s.set(new Vector3(1, 2, 3), 5);
      expect(ret).toBe(s);
      expect(s.center.x).toBe(1);
      expect(s.radius).toBe(5);
    });

    it('copy duplicates fields', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = new Sphere().copy(a);
      expect(b.center.x).toBe(1);
      expect(b.radius).toBe(5);
      a.radius = 99;
      expect(b.radius).toBe(5);
    });

    it('clone returns independent instance', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.center.x).toBe(1);
      expect(b.radius).toBe(5);
      b.radius = 0;
      expect(a.radius).toBe(5);
    });
  });

  describe('makeEmpty / isEmpty', () => {
    it('makeEmpty resets to (0,0,0,-1)', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 5);
      s.makeEmpty();
      expect(s.isEmpty()).toBe(true);
      expect(s.radius).toBe(-1);
      expect(s.center.x).toBe(0);
    });
  });

  describe('getBoundingBox', () => {
    it('returns AABB of the sphere', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 2);
      const box = new Box3();
      s.getBoundingBox(box);
      expect(box.min.x).toBe(-1);
      expect(box.min.y).toBe(0);
      expect(box.min.z).toBe(1);
      expect(box.max.x).toBe(3);
      expect(box.max.y).toBe(4);
      expect(box.max.z).toBe(5);
    });

    it('empty sphere returns empty box', () => {
      const s = new Sphere();
      const box = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      s.getBoundingBox(box);
      expect(box.isEmpty()).toBe(true);
    });
  });

  describe('applyMatrix4', () => {
    it('identity leaves sphere unchanged', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 5);
      s.applyMatrix4(new Matrix4());
      expect(s.center.x).toBeCloseTo(1, 10);
      expect(s.center.y).toBeCloseTo(2, 10);
      expect(s.center.z).toBeCloseTo(3, 10);
      expect(s.radius).toBeCloseTo(5, 10);
    });

    it('translation moves center, radius unchanged', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      const m = new Matrix4();
      m.elements[12] = 10;
      s.applyMatrix4(m);
      expect(s.center.x).toBeCloseTo(10, 10);
      expect(s.radius).toBeCloseTo(5, 10);
    });

    it('uniform scale scales radius', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      const m = new Matrix4();
      m.elements[0] = 2;
      m.elements[5] = 2;
      m.elements[10] = 2;
      s.applyMatrix4(m);
      expect(s.radius).toBeCloseTo(10, 10);
    });

    it('non-uniform scale uses max axis scale', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      const m = new Matrix4();
      m.elements[0] = 2;
      m.elements[5] = 3;
      m.elements[10] = 4;
      s.applyMatrix4(m);
      expect(s.radius).toBeCloseTo(20, 10); // 5 * 4
    });
  });

  describe('translate', () => {
    it('shifts center by offset', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      s.translate(new Vector3(10, 20, 30));
      expect(s.center.x).toBe(10);
      expect(s.center.y).toBe(20);
      expect(s.center.z).toBe(30);
      expect(s.radius).toBe(5);
    });
  });

  describe('expandByPoint', () => {
    it('empty sphere becomes a point', () => {
      const s = new Sphere();
      s.expandByPoint(new Vector3(3, 0, 0));
      expect(s.center.x).toBe(3);
      expect(s.radius).toBe(0);
    });

    it('grows to include outside point', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      s.expandByPoint(new Vector3(10, 0, 0));
      // Expected: center=(2.5,0,0), radius=7.5
      expect(s.center.x).toBeCloseTo(2.5, 10);
      expect(s.radius).toBeCloseTo(7.5, 10);
    });

    it('point already inside leaves sphere unchanged', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      s.expandByPoint(new Vector3(1, 0, 0));
      expect(s.center.x).toBeCloseTo(0, 10);
      expect(s.radius).toBeCloseTo(5, 10);
    });

    it('expanded point lies on the new sphere surface', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      const p = new Vector3(10, 0, 0);
      s.expandByPoint(p);
      expect(s.distanceToPoint(p)).toBeCloseTo(0, 10);
    });
  });

  describe('union', () => {
    it('empty + non-empty = non-empty', () => {
      const a = new Sphere();
      const b = new Sphere(new Vector3(1, 2, 3), 5);
      a.union(b);
      expect(a.center.x).toBe(1);
      expect(a.radius).toBe(5);
    });

    it('non-empty + empty stays unchanged', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = new Sphere();
      a.union(b);
      expect(a.center.x).toBe(1);
      expect(a.radius).toBe(5);
    });

    it('concentric spheres → max radius', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 3);
      const b = new Sphere(new Vector3(0, 0, 0), 5);
      a.union(b);
      expect(a.radius).toBe(5);
    });

    it('two separated spheres → minimal bounding sphere', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 1);
      const b = new Sphere(new Vector3(3, 0, 0), 1);
      a.union(b);
      // Expected: center (1.5, 0, 0), radius 2.5
      expect(a.center.x).toBeCloseTo(1.5, 10);
      expect(a.radius).toBeCloseTo(2.5, 10);
      // Both original centers should be inside the new sphere
      expect(a.distanceToPoint(new Vector3(0, 0, 0))).toBeLessThanOrEqual(0);
      expect(a.distanceToPoint(new Vector3(3, 0, 0))).toBeLessThanOrEqual(0);
    });
  });

  describe('intersectsSphere', () => {
    it('overlapping spheres intersect', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 1);
      const b = new Sphere(new Vector3(0, 0, 0), 1);
      expect(a.intersectsSphere(b)).toBe(true);
    });

    it('separated spheres do not intersect', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 1);
      const b = new Sphere(new Vector3(5, 0, 0), 1);
      expect(a.intersectsSphere(b)).toBe(false);
    });

    it('touching spheres intersect', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 1);
      const b = new Sphere(new Vector3(2, 0, 0), 1);
      expect(a.intersectsSphere(b)).toBe(true);
    });
  });

  describe('intersectsBox', () => {
    it('sphere containing box intersects', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(s.intersectsBox(box)).toBe(true);
    });

    it('sphere far from box does not intersect', () => {
      const s = new Sphere(new Vector3(10, 0, 0), 1);
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(s.intersectsBox(box)).toBe(false);
    });

    it('sphere overlapping box corner intersects', () => {
      const s = new Sphere(new Vector3(2, 0, 0), 1.5);
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(s.intersectsBox(box)).toBe(true);
    });
  });

  describe('intersectsPlane', () => {
    it('sphere crossing plane intersects', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 1);
      const p = new Plane(new Vector3(0, 1, 0), 0);
      expect(s.intersectsPlane(p)).toBe(true);
    });

    it('sphere too far from plane does not intersect', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 1);
      const p = new Plane(new Vector3(0, 1, 0), -10);
      expect(s.intersectsPlane(p)).toBe(false);
    });

    it('sphere tangent to plane intersects', () => {
      const s = new Sphere(new Vector3(0, 1, 0), 1);
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      expect(s.intersectsPlane(p)).toBe(true);
    });
  });

  describe('clampPoint', () => {
    it('outside point clamped to surface', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 1);
      const target = new Vector3();
      s.clampPoint(new Vector3(5, 0, 0), target);
      expect(target.x).toBeCloseTo(1, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('inside point stays unchanged', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 2);
      const target = new Vector3();
      s.clampPoint(new Vector3(0.5, 0.5, 0.5), target);
      expect(target.x).toBeCloseTo(0.5, 10);
      expect(target.y).toBeCloseTo(0.5, 10);
      expect(target.z).toBeCloseTo(0.5, 10);
    });
  });

  describe('distanceToPoint', () => {
    it('positive for outside point', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 1);
      expect(s.distanceToPoint(new Vector3(5, 0, 0))).toBe(4);
    });

    it('zero for surface point', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 1);
      expect(s.distanceToPoint(new Vector3(1, 0, 0))).toBe(0);
    });

    it('negative for inside point', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 2);
      expect(s.distanceToPoint(new Vector3(0, 0, 0))).toBe(-2);
    });
  });
});
