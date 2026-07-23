import { describe, it, expect } from 'vitest';
import { Line3 } from './Line3';
import { Vector3 } from './Vector3';
import { Matrix4 } from './Matrix4';

describe('Line3', () => {
  describe('construction', () => {
    it('default constructs zero line', () => {
      const l = new Line3();
      expect(l.start.x).toBe(0);
      expect(l.start.y).toBe(0);
      expect(l.start.z).toBe(0);
      expect(l.end.x).toBe(0);
      expect(l.end.y).toBe(0);
      expect(l.end.z).toBe(0);
    });

    it('constructs with values', () => {
      const l = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      expect(l.start.x).toBe(1);
      expect(l.end.x).toBe(4);
    });
  });

  describe('set / copy / clone', () => {
    it('set updates endpoints and returns this', () => {
      const l = new Line3();
      const ret = l.set(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      expect(ret).toBe(l);
      expect(l.start.x).toBe(1);
      expect(l.end.x).toBe(4);
    });

    it('copy duplicates fields', () => {
      const a = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = new Line3().copy(a);
      expect(b.start.x).toBe(1);
      expect(b.end.x).toBe(4);
      a.start.x = 99;
      expect(b.start.x).toBe(1);
    });

    it('clone returns independent instance', () => {
      const a = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.start.x).toBe(1);
      expect(b.end.x).toBe(4);
      b.start.x = 0;
      expect(a.start.x).toBe(1);
    });
  });

  describe('getCenter', () => {
    it('returns midpoint of endpoints', () => {
      const l = new Line3(new Vector3(0, 0, 0), new Vector3(2, 4, 6));
      const target = new Vector3();
      l.getCenter(target);
      expect(target.x).toBe(1);
      expect(target.y).toBe(2);
      expect(target.z).toBe(3);
    });
  });

  describe('delta', () => {
    it('returns end - start', () => {
      const l = new Line3(new Vector3(1, 2, 3), new Vector3(4, 6, 8));
      const target = new Vector3();
      l.delta(target);
      expect(target.x).toBe(3);
      expect(target.y).toBe(4);
      expect(target.z).toBe(5);
    });
  });

  describe('distance / distanceSq', () => {
    it('distance is euclidean length', () => {
      const l = new Line3(new Vector3(0, 0, 0), new Vector3(3, 4, 0));
      expect(l.distance()).toBe(5);
    });

    it('distanceSq is sum of squares', () => {
      const l = new Line3(new Vector3(0, 0, 0), new Vector3(3, 4, 0));
      expect(l.distanceSq()).toBe(25);
    });

    it('distance is 0 for degenerate line', () => {
      const l = new Line3(new Vector3(5, 5, 5), new Vector3(5, 5, 5));
      expect(l.distance()).toBe(0);
    });
  });

  describe('at', () => {
    it('t=0 returns start', () => {
      const l = new Line3(new Vector3(1, 2, 3), new Vector3(5, 6, 7));
      const target = new Vector3();
      l.at(0, target);
      expect(target.x).toBe(1);
      expect(target.y).toBe(2);
      expect(target.z).toBe(3);
    });

    it('t=1 returns end', () => {
      const l = new Line3(new Vector3(1, 2, 3), new Vector3(5, 6, 7));
      const target = new Vector3();
      l.at(1, target);
      expect(target.x).toBe(5);
      expect(target.y).toBe(6);
      expect(target.z).toBe(7);
    });

    it('t=0.5 returns midpoint', () => {
      const l = new Line3(new Vector3(0, 0, 0), new Vector3(2, 4, 6));
      const target = new Vector3();
      l.at(0.5, target);
      expect(target.x).toBe(1);
      expect(target.y).toBe(2);
      expect(target.z).toBe(3);
    });
  });

  describe('closestPointToPoint', () => {
    const line = new Line3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));

    it('clamps to start for point before start', () => {
      const target = new Vector3();
      line.closestPointToPoint(new Vector3(-5, 5, 0), true, target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('clamps to end for point after end', () => {
      const target = new Vector3();
      line.closestPointToPoint(new Vector3(15, 5, 0), true, target);
      expect(target.x).toBeCloseTo(10, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('returns projection for point within segment', () => {
      const target = new Vector3();
      line.closestPointToPoint(new Vector3(5, 5, 0), true, target);
      expect(target.x).toBeCloseTo(5, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('clampToLine=false returns projection even outside segment', () => {
      const target = new Vector3();
      line.closestPointToPoint(new Vector3(-5, 0, 0), false, target);
      expect(target.x).toBeCloseTo(-5, 10);
      expect(target.y).toBeCloseTo(0, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('degenerate line returns start', () => {
      const l = new Line3(new Vector3(5, 5, 5), new Vector3(5, 5, 5));
      const target = new Vector3();
      l.closestPointToPoint(new Vector3(0, 0, 0), true, target);
      expect(target.x).toBe(5);
      expect(target.y).toBe(5);
      expect(target.z).toBe(5);
    });
  });

  describe('applyMatrix4', () => {
    it('identity leaves line unchanged', () => {
      const l = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      l.applyMatrix4(new Matrix4());
      expect(l.start.x).toBeCloseTo(1, 10);
      expect(l.end.z).toBeCloseTo(6, 10);
    });

    it('translation moves both endpoints', () => {
      const l = new Line3(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      const m = new Matrix4();
      m.elements[12] = 10;
      m.elements[13] = 20;
      m.elements[14] = 30;
      l.applyMatrix4(m);
      expect(l.start.x).toBeCloseTo(10, 10);
      expect(l.start.y).toBeCloseTo(20, 10);
      expect(l.start.z).toBeCloseTo(30, 10);
      expect(l.end.x).toBeCloseTo(11, 10);
    });
  });

  describe('equals', () => {
    it('true for lines with same endpoints', () => {
      const a = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      expect(a.equals(b)).toBe(true);
    });

    it('false when start differs', () => {
      const a = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = new Line3(new Vector3(0, 2, 3), new Vector3(4, 5, 6));
      expect(a.equals(b)).toBe(false);
    });

    it('false when end differs', () => {
      const a = new Line3(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = new Line3(new Vector3(1, 2, 3), new Vector3(0, 5, 6));
      expect(a.equals(b)).toBe(false);
    });
  });
});
