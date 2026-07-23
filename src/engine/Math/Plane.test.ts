import { describe, it, expect } from 'vitest';
import { Plane } from './Plane';
import { Vector3 } from './Vector3';
import { Line3 } from './Line3';
import { Sphere } from './Sphere';
import { Box3 } from './Box3';
import { Matrix4 } from './Matrix4';

describe('Plane', () => {
  describe('construction', () => {
    it('constructs with defaults (normal +X, constant 0)', () => {
      const p = new Plane();
      expect(p.normal.x).toBe(1);
      expect(p.normal.y).toBe(0);
      expect(p.normal.z).toBe(0);
      expect(p.constant).toBe(0);
    });

    it('constructs with values', () => {
      const n = new Vector3(0, 1, 0);
      const p = new Plane(n, -5);
      expect(p.normal.y).toBe(1);
      expect(p.constant).toBe(-5);
    });
  });

  describe('set', () => {
    it('sets normal and constant and returns this', () => {
      const p = new Plane();
      const ret = p.set(new Vector3(0, 1, 0), -5);
      expect(ret).toBe(p);
      expect(p.normal.y).toBe(1);
      expect(p.constant).toBe(-5);
    });
  });

  describe('setComponents', () => {
    it('sets normal(x,y,z) and constant w', () => {
      const p = new Plane().setComponents(0, 2, 0, -10);
      expect(p.normal.x).toBe(0);
      expect(p.normal.y).toBe(2);
      expect(p.normal.z).toBe(0);
      expect(p.constant).toBe(-10);
    });
  });

  describe('setFromNormalAndCoplanarPoint', () => {
    it('constant = -point·normal', () => {
      const p = new Plane().setFromNormalAndCoplanarPoint(
        new Vector3(0, 1, 0),
        new Vector3(0, 5, 0),
      );
      expect(p.normal.y).toBe(1);
      expect(p.constant).toBe(-5);
    });
  });

  describe('setFromCoplanarPoints', () => {
    it('triangle in x+y+z=1 plane → normal (1,1,1)/√3, constant -1/√3', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      const c = new Vector3(0, 0, 1);
      const p = new Plane().setFromCoplanarPoints(a, b, c);
      const inv = 1 / Math.sqrt(3);
      expect(p.normal.x).toBeCloseTo(inv, 10);
      expect(p.normal.y).toBeCloseTo(inv, 10);
      expect(p.normal.z).toBeCloseTo(inv, 10);
      expect(p.constant).toBeCloseTo(-inv, 10);
    });

    it('origin distance to x+y+z=1 plane is -1/√3', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      const c = new Vector3(0, 0, 1);
      const p = new Plane().setFromCoplanarPoints(a, b, c);
      expect(p.distanceToPoint(new Vector3(0, 0, 0))).toBeCloseTo(-1 / Math.sqrt(3), 10);
    });

    it('each input vertex has distance 0 to the plane', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      const c = new Vector3(0, 0, 1);
      const p = new Plane().setFromCoplanarPoints(a, b, c);
      expect(p.distanceToPoint(a)).toBeCloseTo(0, 10);
      expect(p.distanceToPoint(b)).toBeCloseTo(0, 10);
      expect(p.distanceToPoint(c)).toBeCloseTo(0, 10);
    });
  });

  describe('copy / clone', () => {
    it('clone returns independent instance', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const q = p.clone();
      expect(q).not.toBe(p);
      expect(q.normal.y).toBe(1);
      expect(q.constant).toBe(-5);
      q.constant = 0;
      expect(p.constant).toBe(-5);
    });

    it('copy duplicates fields', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const q = new Plane().copy(p);
      expect(q.normal.y).toBe(1);
      expect(q.constant).toBe(-5);
    });
  });

  describe('normalize', () => {
    it('scales normal to unit length and adjusts constant', () => {
      const p = new Plane().setComponents(0, 2, 0, -10); // normal len 2
      p.normalize();
      expect(p.normal.y).toBeCloseTo(1, 10);
      expect(p.constant).toBeCloseTo(-5, 10);
    });

    it('preserves the geometric plane (on-plane points stay on plane)', () => {
      // distanceToPoint returns a value scaled by |normal|, so the raw number
      // changes after normalize. But points ON the plane must stay at distance 0.
      const p = new Plane().setComponents(0, 2, 0, -10); // y=5
      const pointOnPlane = new Vector3(7, 5, 9);
      expect(p.distanceToPoint(pointOnPlane)).toBeCloseTo(0, 10);
      p.normalize();
      expect(p.distanceToPoint(pointOnPlane)).toBeCloseTo(0, 10);
    });
  });

  describe('negate', () => {
    it('flips both normal and constant', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      p.negate();
      expect(p.normal.y).toBe(-1);
      expect(p.constant).toBe(5);
    });

    it('preserves the geometric plane', () => {
      // same set of points satisfies the equation
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const point = new Vector3(7, 5, 9); // on y=5 plane
      expect(p.distanceToPoint(point)).toBe(0);
      p.negate();
      expect(p.distanceToPoint(point)).toBe(0);
    });
  });

  describe('distanceToPoint', () => {
    it('returns 0 for points on the plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      expect(p.distanceToPoint(new Vector3(7, 5, 9))).toBeCloseTo(0, 10);
    });

    it('returns signed distance for points off the plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      expect(p.distanceToPoint(new Vector3(0, 10, 0))).toBeCloseTo(5, 10);
      expect(p.distanceToPoint(new Vector3(0, 0, 0))).toBeCloseTo(-5, 10);
    });
  });

  describe('distanceToSphere', () => {
    it('returns center distance minus radius', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      const sphere = new Sphere(new Vector3(0, 10, 0), 2);
      expect(p.distanceToSphere(sphere)).toBeCloseTo(3, 10);
    });

    it('negative when sphere overlaps plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const sphere = new Sphere(new Vector3(0, 5, 0), 2); // centered on plane
      expect(p.distanceToSphere(sphere)).toBeCloseTo(-2, 10);
    });
  });

  describe('projectPoint', () => {
    it('projects a point onto the plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      const target = new Vector3();
      p.projectPoint(new Vector3(0, 10, 0), target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(5, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });
  });

  describe('orthoPoint', () => {
    it('returns -constant * normal (closest point to origin)', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const target = new Vector3();
      p.orthoPoint(target);
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(5, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });
  });

  describe('coplanarPoint', () => {
    it('returns a point on the plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const target = new Vector3();
      p.coplanarPoint(target);
      expect(p.distanceToPoint(target)).toBeCloseTo(0, 10);
    });
  });

  describe('coplanarLine', () => {
    it('returns a line fully inside the plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const line = new Line3();
      p.coplanarLine(line);
      expect(p.distanceToPoint(line.start)).toBeCloseTo(0, 10);
      expect(p.distanceToPoint(line.end)).toBeCloseTo(0, 10);
    });

    it('end - start has unit length and is orthogonal to normal', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const line = new Line3();
      p.coplanarLine(line);
      const dir = new Vector3().subVectors(line.end, line.start);
      expect(dir.length()).toBeCloseTo(1, 10);
      expect(dir.dot(p.normal)).toBeCloseTo(0, 10);
    });
  });

  describe('intersectLine', () => {
    it('returns the crossing point', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      const line = new Line3(new Vector3(0, 0, 0), new Vector3(0, 10, 0));
      const target = new Vector3();
      const result = p.intersectLine(line, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(0, 10);
      expect(target.y).toBeCloseTo(5, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('returns null when line is parallel and not coplanar', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      const line = new Line3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
      const target = new Vector3();
      const result = p.intersectLine(line, target);
      expect(result).toBeNull();
    });

    it('returns line start when line is coplanar', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const line = new Line3(new Vector3(1, 5, 0), new Vector3(10, 5, 0));
      const target = new Vector3();
      const result = p.intersectLine(line, target);
      expect(result).not.toBeNull();
      expect(target.x).toBeCloseTo(1, 10);
      expect(target.y).toBeCloseTo(5, 10);
      expect(target.z).toBeCloseTo(0, 10);
    });

    it('clampToLine=false returns intersection even outside segment', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      // segment from (0,0,0) to (0,4,0) — intersection is at y=5, outside
      const line = new Line3(new Vector3(0, 0, 0), new Vector3(0, 4, 0));
      const target = new Vector3();
      const result = p.intersectLine(line, target, false);
      expect(result).not.toBeNull();
      expect(target.y).toBeCloseTo(5, 10);
    });

    it('clampToLine=true returns null when intersection outside segment', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      const line = new Line3(new Vector3(0, 0, 0), new Vector3(0, 4, 0));
      const target = new Vector3();
      const result = p.intersectLine(line, target, true);
      expect(result).toBeNull();
    });
  });

  describe('intersectsLine', () => {
    it('true when endpoints on opposite sides', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const line = new Line3(new Vector3(0, 0, 0), new Vector3(0, 10, 0));
      expect(p.intersectsLine(line)).toBe(true);
    });

    it('false when endpoints on same side', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      const line = new Line3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
      expect(p.intersectsLine(line)).toBe(false);
    });
  });

  describe('intersectsBox', () => {
    it('true when plane crosses the box', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(p.intersectsBox(box)).toBe(true);
    });

    it('false when box entirely on one side', () => {
      const p = new Plane(new Vector3(0, 1, 0), -10); // y=10
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(p.intersectsBox(box)).toBe(false);
    });
  });

  describe('intersectsSphere', () => {
    it('true when sphere overlaps plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      const s = new Sphere(new Vector3(0, 0, 0), 1);
      expect(p.intersectsSphere(s)).toBe(true);
    });

    it('false when sphere too far', () => {
      const p = new Plane(new Vector3(0, 1, 0), -10); // y=10
      const s = new Sphere(new Vector3(0, 0, 0), 1);
      expect(p.intersectsSphere(s)).toBe(false);
    });

    it('true when sphere just touches plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      const s = new Sphere(new Vector3(0, 1, 0), 1); // touches y=0
      expect(p.intersectsSphere(s)).toBe(true);
    });
  });

  describe('applyMatrix4', () => {
    it('identity leaves plane unchanged', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      p.applyMatrix4(new Matrix4());
      expect(p.normal.y).toBeCloseTo(1, 10);
      expect(p.constant).toBeCloseTo(-5, 10);
    });

    it('translation moves the plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      const m = new Matrix4();
      m.elements[13] = 10; // translate +10 on Y
      p.applyMatrix4(m);
      // Plane should now be y=15, i.e. normal=(0,1,0), constant=-15
      expect(p.normal.y).toBeCloseTo(1, 10);
      expect(p.constant).toBeCloseTo(-15, 10);
    });
  });

  describe('translate', () => {
    it('shifts the plane along offset without changing normal', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5); // y=5
      p.translate(new Vector3(0, 10, 0));
      expect(p.normal.y).toBeCloseTo(1, 10);
      expect(p.constant).toBeCloseTo(-15, 10);
    });

    it('only the offset component along normal matters', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      p.translate(new Vector3(100, 0, 0)); // perpendicular to normal
      expect(p.constant).toBeCloseTo(-5, 10);
    });
  });
});
