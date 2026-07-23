import { describe, it, expect } from 'vitest';
import { Ray } from './Ray';
import { Vector3 } from './Vector3';
import { Sphere } from './Sphere';
import { Plane } from './Plane';
import { Box3 } from './Box3';
import { Matrix4 } from './Matrix4';

describe('Ray', () => {
  describe('construction', () => {
    it('default origin at origin, direction -Z', () => {
      const r = new Ray();
      expect(r.origin.x).toBe(0);
      expect(r.origin.y).toBe(0);
      expect(r.origin.z).toBe(0);
      expect(r.direction.x).toBe(0);
      expect(r.direction.y).toBe(0);
      expect(r.direction.z).toBe(-1);
    });

    it('constructs with values', () => {
      const r = new Ray(new Vector3(1, 2, 3), new Vector3(0, 1, 0));
      expect(r.origin.x).toBe(1);
      expect(r.direction.y).toBe(1);
    });
  });

  describe('set / copy / clone', () => {
    it('set updates origin and direction and returns this', () => {
      const r = new Ray();
      const ret = r.set(new Vector3(1, 2, 3), new Vector3(0, 1, 0));
      expect(ret).toBe(r);
      expect(r.origin.x).toBe(1);
      expect(r.direction.y).toBe(1);
    });

    it('copy duplicates fields', () => {
      const a = new Ray(new Vector3(1, 2, 3), new Vector3(0, 1, 0));
      const b = new Ray().copy(a);
      expect(b.origin.x).toBe(1);
      expect(b.direction.y).toBe(1);
      a.origin.x = 99;
      expect(b.origin.x).toBe(1);
    });

    it('clone returns independent instance', () => {
      const a = new Ray(new Vector3(1, 2, 3), new Vector3(0, 1, 0));
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.origin.x).toBe(1);
      expect(b.direction.y).toBe(1);
      b.origin.x = 99;
      expect(a.origin.x).toBe(1);
    });
  });

  describe('at', () => {
    it('returns origin + direction * t', () => {
      const r = new Ray(new Vector3(1, 0, 0), new Vector3(1, 0, 0));
      const target = new Vector3();
      r.at(5, target);
      expect(target.x).toBe(6);
      expect(target.y).toBe(0);
      expect(target.z).toBe(0);
    });

    it('t=0 returns origin', () => {
      const r = new Ray(new Vector3(7, 8, 9), new Vector3(1, 0, 0));
      const target = new Vector3();
      r.at(0, target);
      expect(target.x).toBe(7);
      expect(target.y).toBe(8);
      expect(target.z).toBe(9);
    });
  });

  describe('lookAt', () => {
    it('sets direction from origin toward target', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      r.lookAt(new Vector3(5, 0, 0));
      expect(r.direction.x).toBeCloseTo(1, 10);
      expect(r.direction.y).toBeCloseTo(0, 10);
      expect(r.direction.z).toBeCloseTo(0, 10);
    });
  });

  describe('recast', () => {
    it('moves origin along direction by t', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      r.recast(5);
      expect(r.origin.x).toBeCloseTo(5, 10);
      expect(r.origin.y).toBeCloseTo(0, 10);
      expect(r.origin.z).toBeCloseTo(0, 10);
    });

    it('does not change direction', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      r.recast(3);
      expect(r.direction.z).toBe(-1);
    });
  });

  describe('closestPointToPoint', () => {
    it('returns projection for point in front of origin', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const target = new Vector3();
      r.closestPointToPoint(new Vector3(5, 3, 0), target);
      expect(target.x).toBeCloseTo(5, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('returns origin for point behind ray', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const target = new Vector3();
      r.closestPointToPoint(new Vector3(-5, 3, 0), target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });
  });

  describe('distanceToPoint / distanceSqToPoint', () => {
    const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));

    it('distance is 0 for points on the ray', () => {
      expect(r.distanceToPoint(new Vector3(5, 0, 0))).toBe(0);
    });

    it('distance is the perpendicular for points off the ray', () => {
      expect(r.distanceToPoint(new Vector3(5, 3, 0))).toBeCloseTo(3, 10);
    });

    it('distance is euclidean for points behind the ray', () => {
      expect(r.distanceToPoint(new Vector3(-3, 0, 0))).toBeCloseTo(3, 10);
    });

    it('distanceSqToPoint matches squared distance', () => {
      expect(r.distanceSqToPoint(new Vector3(5, 3, 0))).toBeCloseTo(9, 10);
    });
  });

  describe('intersectsSphere', () => {
    const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));

    it('true when ray hits sphere', () => {
      expect(r.intersectsSphere(new Sphere(new Vector3(5, 0, 0), 1))).toBe(true);
    });

    it('false when ray misses sphere', () => {
      expect(r.intersectsSphere(new Sphere(new Vector3(5, 5, 0), 1))).toBe(false);
    });

    it('true when sphere is tangent to ray', () => {
      expect(r.intersectsSphere(new Sphere(new Vector3(5, 1, 0), 1))).toBe(true);
    });

    it('false for empty sphere', () => {
      expect(r.intersectsSphere(new Sphere(new Vector3(5, 0, 0), -1))).toBe(false);
    });
  });

  describe('intersectSphere', () => {
    it('returns entry point when ray hits from outside', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const target = new Vector3();
      const result = r.intersectSphere(new Sphere(new Vector3(5, 0, 0), 1), target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(4, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('returns exit point when origin is inside sphere', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const target = new Vector3();
      const result = r.intersectSphere(new Sphere(new Vector3(0, 0, 0), 5), target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(5, 10);
    });

    it('returns null when sphere is behind ray', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const target = new Vector3();
      const result = r.intersectSphere(new Sphere(new Vector3(-5, 0, 0), 1), target);
      expect(result).toBeNull();
    });

    it('returns null when ray misses sphere', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const target = new Vector3();
      const result = r.intersectSphere(new Sphere(new Vector3(5, 5, 0), 1), target);
      expect(result).toBeNull();
    });
  });

  describe('intersectsPlane', () => {
    it('true when ray hits plane', () => {
      const r = new Ray(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      expect(r.intersectsPlane(p)).toBe(true);
    });

    it('false when ray points away from plane', () => {
      const r = new Ray(new Vector3(0, 5, 0), new Vector3(0, 1, 0));
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      expect(r.intersectsPlane(p)).toBe(false);
    });

    it('true when origin is on the plane', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      expect(r.intersectsPlane(p)).toBe(true);
    });
  });

  describe('intersectPlane', () => {
    it('returns the intersection point', () => {
      const r = new Ray(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      const target = new Vector3();
      const result = r.intersectPlane(p, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('returns null when ray is parallel and not coplanar', () => {
      const r = new Ray(new Vector3(0, 5, 0), new Vector3(1, 0, 0));
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      const target = new Vector3();
      const result = r.intersectPlane(p, target);
      expect(result).toBeNull();
    });

    it('returns origin when ray is coplanar with plane', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0, ray in this plane
      const target = new Vector3();
      const result = r.intersectPlane(p, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('returns null when plane is behind the ray', () => {
      const r = new Ray(new Vector3(0, 5, 0), new Vector3(0, 1, 0));
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      const target = new Vector3();
      const result = r.intersectPlane(p, target);
      expect(result).toBeNull();
    });
  });

  describe('intersectsBox / intersectBox', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));

    it('intersectsBox true when ray hits box', () => {
      const r = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      expect(r.intersectsBox(box)).toBe(true);
    });

    it('intersectsBox false when ray misses box', () => {
      const r = new Ray(new Vector3(5, 5, 5), new Vector3(0, 0, -1));
      expect(r.intersectsBox(box)).toBe(false);
    });

    it('intersectBox returns near entry point', () => {
      const r = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const target = new Vector3();
      const result = r.intersectBox(box, target);
      expect(result).not.toBeNull();
      expect(target.z).toBeCloseTo(1, 10);
    });

    it('intersectBox returns null on miss', () => {
      const r = new Ray(new Vector3(5, 5, 5), new Vector3(0, 0, -1));
      const target = new Vector3();
      const result = r.intersectBox(box, target);
      expect(result).toBeNull();
    });

    it('intersectBox returns far point when origin inside box', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const target = new Vector3();
      const result = r.intersectBox(box, target);
      expect(result).not.toBeNull();
      expect(target.z).toBeCloseTo(-1, 10);
    });
  });

  describe('intersectsTriangle / intersectTriangle', () => {
    // Triangle in xy-plane (z=0), CCW from +z
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 0, 0);
    const c = new Vector3(0, 1, 0);

    it('front-face hit returns intersection point', () => {
      const r = new Ray(new Vector3(0.25, 0.25, 5), new Vector3(0, 0, -1));
      const target = new Vector3();
      const result = r.intersectTriangle(a, b, c, false, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0.25, 10);
      expect(target.y).toBeCloseTo(0.25, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('ray miss returns null', () => {
      const r = new Ray(new Vector3(5, 5, 5), new Vector3(0, 0, -1));
      const target = new Vector3();
      const result = r.intersectTriangle(a, b, c, false, target);
      expect(result).toBeNull();
    });

    it('backface culling rejects back-face hits', () => {
      const r = new Ray(new Vector3(0.25, 0.25, -5), new Vector3(0, 0, 1));
      const target = new Vector3();
      const result = r.intersectTriangle(a, b, c, true, target);
      expect(result).toBeNull();
    });

    it('without backface culling, back-face hits return intersection', () => {
      const r = new Ray(new Vector3(0.25, 0.25, -5), new Vector3(0, 0, 1));
      const target = new Vector3();
      const result = r.intersectTriangle(a, b, c, false, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0.25, 10);
      expect(target.y).toBeCloseTo(0.25, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('covers X-dominant ray direction (triangle in yz-plane)', () => {
      // Triangle in yz-plane (x=0), CCW from +x
      const ta = new Vector3(0, 0, 0);
      const tb = new Vector3(0, 1, 0);
      const tc = new Vector3(0, 0, 1);
      const r = new Ray(new Vector3(5, 0.25, 0.25), new Vector3(-1, 0, 0));
      const target = new Vector3();
      const result = r.intersectTriangle(ta, tb, tc, false, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0.25, 10);
      expect(target.z).toBeCloseTo(0.25, 10);
    });

    it('covers Y-dominant ray direction (triangle in xz-plane)', () => {
      // Triangle in xz-plane (y=0), CCW from +y
      const ta = new Vector3(0, 0, 0);
      const tb = new Vector3(0, 0, 1);
      const tc = new Vector3(1, 0, 0);
      const r = new Ray(new Vector3(0.25, 5, 0.25), new Vector3(0, -1, 0));
      const target = new Vector3();
      const result = r.intersectTriangle(ta, tb, tc, false, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0.25, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0.25, 10);
    });

    it('intersectsTriangle boolean wrapper matches intersectTriangle', () => {
      const r = new Ray(new Vector3(0.25, 0.25, 5), new Vector3(0, 0, -1));
      expect(r.intersectsTriangle(a, b, c, false)).toBe(true);
      expect(r.intersectsTriangle(a, b, c, true)).toBe(true);
    });

    it('returns null when triangle is behind the ray', () => {
      const r = new Ray(new Vector3(0.25, 0.25, -5), new Vector3(0, 0, -1));
      const target = new Vector3();
      const result = r.intersectTriangle(a, b, c, false, target);
      expect(result).toBeNull();
    });
  });

  describe('applyMatrix4', () => {
    it('identity leaves ray unchanged', () => {
      const r = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, -1));
      r.applyMatrix4(new Matrix4());
      expect(r.origin.x).toBeCloseTo(1, 10);
      expect(r.origin.y).toBeCloseTo(2, 10);
      expect(r.origin.z).toBeCloseTo(3, 10);
      expect(r.direction.x).toBeCloseTo(0, 10);
      expect(r.direction.y).toBeCloseTo(0, 10);
      expect(r.direction.z).toBeCloseTo(-1, 10);
    });

    it('translation moves origin, direction stays normalized', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const m = new Matrix4();
      m.elements[12] = 10;
      r.applyMatrix4(m);
      expect(r.origin.x).toBeCloseTo(10, 10);
      // direction is normalized by transformDirection
      expect(r.direction.length()).toBeCloseTo(1, 10);
      expect(r.direction.z).toBeCloseTo(-1, 10);
    });
  });
});
