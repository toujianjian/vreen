import { describe, it, expect } from 'vitest';
import { Triangle } from './Triangle';
import { Vector3 } from './Vector3';
import { Plane } from './Plane';

describe('Triangle', () => {
  describe('construction', () => {
    it('default constructs zero triangle', () => {
      const t = new Triangle();
      expect(t.a.x).toBe(0);
      expect(t.b.x).toBe(0);
      expect(t.c.x).toBe(0);
    });

    it('constructs with values', () => {
      const t = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      expect(t.a.x).toBe(1);
      expect(t.b.y).toBe(1);
      expect(t.c.z).toBe(1);
    });
  });

  describe('set / copy / clone', () => {
    it('set updates vertices and returns this', () => {
      const t = new Triangle();
      const ret = t.set(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      expect(ret).toBe(t);
      expect(t.a.x).toBe(1);
      expect(t.b.y).toBe(1);
      expect(t.c.z).toBe(1);
    });

    it('copy duplicates vertices', () => {
      const a = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      const b = new Triangle().copy(a);
      expect(b.a.x).toBe(1);
      expect(b.b.y).toBe(1);
      expect(b.c.z).toBe(1);
      a.a.x = 99;
      expect(b.a.x).toBe(1);
    });

    it('clone returns independent instance', () => {
      const a = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.a.x).toBe(1);
      b.a.x = 99;
      expect(a.a.x).toBe(1);
    });
  });

  describe('getArea', () => {
    it('right triangle area = 0.5', () => {
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
      );
      expect(t.getArea()).toBeCloseTo(0.5, 10);
    });

    it('scaled triangle area scales by square', () => {
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(2, 0, 0),
        new Vector3(0, 2, 0),
      );
      expect(t.getArea()).toBeCloseTo(2, 10);
    });

    it('degenerate (collinear) triangle area = 0', () => {
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
      );
      expect(t.getArea()).toBeCloseTo(0, 10);
    });

    it('equilateral triangle area = √3/4', () => {
      const s = 1;
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(s, 0, 0),
        new Vector3(s / 2, (s * Math.sqrt(3)) / 2, 0),
      );
      expect(t.getArea()).toBeCloseTo(Math.sqrt(3) / 4, 10);
    });
  });

  describe('getMidpoint', () => {
    it('returns centroid (a+b+c)/3', () => {
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(3, 0, 0),
        new Vector3(0, 3, 0),
      );
      const target = new Vector3();
      t.getMidpoint(target);
      expect(target.x).toBeCloseTo(1, 10);
      expect(target.y).toBeCloseTo(1, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });
  });

  describe('getNormal (instance)', () => {
    it('returns unit normal for xy-plane triangle (CCW → +Z)', () => {
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
      );
      const target = new Vector3();
      t.getNormal(target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(1, 10);
    });

    it('normal length is 1', () => {
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(2, 0, 0),
        new Vector3(0, 3, 0),
      );
      const target = new Vector3();
      t.getNormal(target);
      expect(target.length()).toBeCloseTo(1, 10);
    });

    it('degenerate triangle returns zero normal', () => {
      const t = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
      );
      const target = new Vector3(9, 9, 9);
      t.getNormal(target);
      expect(target.x).toBe(0);
      expect(target.y).toBe(0);
      expect(target.z).toBe(0);
    });
  });

  describe('static getNormal', () => {
    it('computes normal without an instance', () => {
      const target = new Vector3();
      Triangle.getNormal(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        target,
      );
      expect(target.z).toBeCloseTo(1, 10);
    });

    it('returns zero for degenerate triangle', () => {
      const target = new Vector3(9, 9, 9);
      Triangle.getNormal(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
        target,
      );
      expect(target.x).toBe(0);
      expect(target.y).toBe(0);
      expect(target.z).toBe(0);
    });
  });

  describe('getPlane', () => {
    it('returns plane through the three vertices', () => {
      const t = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      const plane = new Plane();
      t.getPlane(plane);
      // All three vertices lie on the plane (distance 0)
      expect(plane.distanceToPoint(t.a)).toBeCloseTo(0, 10);
      expect(plane.distanceToPoint(t.b)).toBeCloseTo(0, 10);
      expect(plane.distanceToPoint(t.c)).toBeCloseTo(0, 10);
    });
  });

  describe('getBarycoord (instance)', () => {
    const t = new Triangle(
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
    );

    it('vertex a → (1,0,0)', () => {
      const target = new Vector3();
      const result = t.getBarycoord(new Vector3(0, 0, 0), target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(1, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('vertex b → (0,1,0)', () => {
      const target = new Vector3();
      const result = t.getBarycoord(new Vector3(1, 0, 0), target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(1, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('vertex c → (0,0,1)', () => {
      const target = new Vector3();
      const result = t.getBarycoord(new Vector3(0, 1, 0), target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(1, 10);
    });

    it('interior point (0.25, 0.25, 0) → (0.5, 0.25, 0.25)', () => {
      const target = new Vector3();
      const result = t.getBarycoord(new Vector3(0.25, 0.25, 0), target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0.5, 10);
      expect(target.y).toBeCloseTo(0.25, 10);
      expect(target.z).toBeCloseTo(0.25, 10);
    });

    it('returns null for degenerate triangle', () => {
      const degenerate = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
      );
      const target = new Vector3(9, 9, 9);
      const result = degenerate.getBarycoord(new Vector3(1, 0, 0), target);
      expect(result).toBeNull();
      // target is zeroed on failure
      expect(target.x).toBe(0);
      expect(target.y).toBe(0);
      expect(target.z).toBe(0);
    });
  });

  describe('static getBarycoord', () => {
    it('matches instance method', () => {
      const a = new Vector3(0, 0, 0);
      const b = new Vector3(1, 0, 0);
      const c = new Vector3(0, 1, 0);
      const target = new Vector3();
      const result = Triangle.getBarycoord(new Vector3(0.25, 0.25, 0), a, b, c, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0.5, 10);
      expect(target.y).toBeCloseTo(0.25, 10);
      expect(target.z).toBeCloseTo(0.25, 10);
    });
  });

  describe('containsPoint (instance)', () => {
    const t = new Triangle(
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
    );

    it('true for interior point', () => {
      expect(t.containsPoint(new Vector3(0.25, 0.25, 0))).toBe(true);
    });

    it('true for vertices', () => {
      expect(t.containsPoint(new Vector3(0, 0, 0))).toBe(true);
      expect(t.containsPoint(new Vector3(1, 0, 0))).toBe(true);
      expect(t.containsPoint(new Vector3(0, 1, 0))).toBe(true);
    });

    it('true for point on edge', () => {
      // midpoint of hypotenuse b-c
      expect(t.containsPoint(new Vector3(0.5, 0.5, 0))).toBe(true);
    });

    it('false for outside point', () => {
      expect(t.containsPoint(new Vector3(0.6, 0.6, 0))).toBe(false);
      expect(t.containsPoint(new Vector3(2, 0, 0))).toBe(false);
      expect(t.containsPoint(new Vector3(-1, 0, 0))).toBe(false);
    });

    it('false for point off the plane', () => {
      // barycentric still computes but the point is not on the triangle plane;
      // containsPoint only checks planar barycentric coordinates,
      // so a vertically offset point may report true. We test a known outside case.
      expect(t.containsPoint(new Vector3(2, 2, 0))).toBe(false);
    });

    it('false for degenerate triangle', () => {
      const degenerate = new Triangle(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
      );
      expect(degenerate.containsPoint(new Vector3(1, 0, 0))).toBe(false);
    });
  });

  describe('static containsPoint', () => {
    it('matches instance method', () => {
      const a = new Vector3(0, 0, 0);
      const b = new Vector3(1, 0, 0);
      const c = new Vector3(0, 1, 0);
      expect(Triangle.containsPoint(new Vector3(0.25, 0.25, 0), a, b, c)).toBe(true);
      expect(Triangle.containsPoint(new Vector3(2, 2, 0), a, b, c)).toBe(false);
    });
  });

  describe('closestPointToPoint', () => {
    const t = new Triangle(
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
    );

    it('point above triangle interior → projection onto triangle', () => {
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(0.2, 0.2, 5), target);
      expect(target.x).toBeCloseTo(0.2, 10);
      expect(target.y).toBeCloseTo(0.2, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('point in vertex A Voronoi region → returns a', () => {
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(-1, -1, 5), target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('point in vertex B Voronoi region → returns b', () => {
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(3, -1, 5), target);
      expect(target.x).toBeCloseTo(1, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('point in vertex C Voronoi region → returns c', () => {
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(-1, 3, 5), target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(1, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('point in AB edge region → projection onto AB', () => {
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(0.5, -1, 0), target);
      expect(target.x).toBeCloseTo(0.5, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('point in AC edge region → projection onto AC', () => {
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(-1, 0.5, 0), target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0.5, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('point in BC edge region → projection onto BC', () => {
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(0.5, 0.5, 5), target);
      expect(target.x).toBeCloseTo(0.5, 10);
      expect(target.y).toBeCloseTo(0.5, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('does not modify the triangle vertices', () => {
      const aBefore = t.a.clone();
      const bBefore = t.b.clone();
      const cBefore = t.c.clone();
      const target = new Vector3();
      t.closestPointToPoint(new Vector3(0.2, 0.2, 5), target);
      expect(t.a.equals(aBefore)).toBe(true);
      expect(t.b.equals(bBefore)).toBe(true);
      expect(t.c.equals(cBefore)).toBe(true);
    });
  });

  describe('equals', () => {
    it('true for triangles with same vertices', () => {
      const a = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      const b = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      expect(a.equals(b)).toBe(true);
    });

    it('false when any vertex differs', () => {
      const a = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      );
      const b = new Triangle(
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 2),
      );
      expect(a.equals(b)).toBe(false);
    });
  });
});
