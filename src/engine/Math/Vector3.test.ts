import { describe, it, expect, afterEach, vi } from 'vitest';
import { Vector3 } from './Vector3';
import { Matrix4 } from './Matrix4';
import { Quaternion } from './Quaternion';

describe('Vector3', () => {
  it('constructs with defaults', () => {
    const v = new Vector3();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('constructs with values', () => {
    const v = new Vector3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  it('set() updates all components and returns this', () => {
    const v = new Vector3().set(4, 5, 6);
    expect(v.x).toBe(4);
    expect(v.y).toBe(5);
    expect(v.z).toBe(6);
  });

  it('copy() copies from another vector', () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3().copy(a);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
    // mutations on b should not affect a
    b.x = 99;
    expect(a.x).toBe(1);
  });

  it('clone() returns a new vector', () => {
    const a = new Vector3(1, 2, 3);
    const b = a.clone();
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.z).toBe(3);
    expect(b).not.toBe(a);
  });

  describe('add', () => {
    it('adds component-wise', () => {
      const a = new Vector3(1, 2, 3);
      a.add(new Vector3(4, 5, 6));
      expect(a.x).toBe(5);
      expect(a.y).toBe(7);
      expect(a.z).toBe(9);
    });

    it('returns this', () => {
      const a = new Vector3(1, 1, 1);
      const ret = a.add(new Vector3(1, 1, 1));
      expect(ret).toBe(a);
    });
  });

  describe('sub', () => {
    it('subtracts component-wise', () => {
      const a = new Vector3(5, 7, 9);
      a.sub(new Vector3(4, 5, 6));
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(a.z).toBe(3);
    });
  });

  describe('multiplyScalar', () => {
    it('multiplies all components', () => {
      const v = new Vector3(2, 3, 4);
      v.multiplyScalar(10);
      expect(v.x).toBe(20);
      expect(v.y).toBe(30);
      expect(v.z).toBe(40);
    });

    it('handles zero', () => {
      const v = new Vector3(1, 2, 3);
      v.multiplyScalar(0);
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });
  });

  describe('divideScalar', () => {
    it('divides all components', () => {
      const v = new Vector3(10, 20, 30);
      v.divideScalar(10);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
    });
  });

  describe('dot', () => {
    it('returns dot product', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      expect(a.dot(b)).toBe(0);
    });

    it('returns correct dot for parallel vectors', () => {
      const a = new Vector3(2, 3, 4);
      const b = new Vector3(2, 3, 4);
      expect(a.dot(b)).toBe(4 + 9 + 16);
    });
  });

  describe('cross', () => {
    it('computes cross product (right-hand)', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      a.cross(b);
      expect(a.x).toBeCloseTo(0);
      expect(a.y).toBeCloseTo(0);
      expect(a.z).toBeCloseTo(1);
    });
  });

  describe('length / lengthSq', () => {
    it('length is 0 for zero vector', () => {
      expect(new Vector3().length()).toBe(0);
    });

    it('length is sqrt of lengthSq', () => {
      const v = new Vector3(3, 4, 0);
      expect(v.lengthSq()).toBe(25);
      expect(v.length()).toBe(5);
    });
  });

  describe('normalize', () => {
    it('normalizes to unit length', () => {
      const v = new Vector3(3, 4, 0);
      v.normalize();
      expect(v.length()).toBeCloseTo(1, 10);
    });

    it('does nothing on zero vector', () => {
      const v = new Vector3();
      v.normalize();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });
  });

  describe('distanceTo / distanceToSquared', () => {
    it('distanceTo is 0 for same point', () => {
      expect(new Vector3(1, 2, 3).distanceTo(new Vector3(1, 2, 3))).toBe(0);
    });

    it('distanceTo works for separated points', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(-1, 0, 0);
      expect(a.distanceTo(b)).toBe(2);
    });
  });

  describe('lerp', () => {
    it('alpha=0 returns unchanged', () => {
      const a = new Vector3(1, 2, 3);
      a.lerp(new Vector3(10, 20, 30), 0);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(a.z).toBe(3);
    });

    it('alpha=1 returns the target', () => {
      const a = new Vector3(1, 2, 3);
      a.lerp(new Vector3(10, 20, 30), 1);
      expect(a.x).toBe(10);
      expect(a.y).toBe(20);
      expect(a.z).toBe(30);
    });

    it('alpha=0.5 returns midpoint', () => {
      const a = new Vector3(0, 0, 0);
      a.lerp(new Vector3(2, 4, 6), 0.5);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(a.z).toBe(3);
    });
  });

  describe('lerpVectors', () => {
    it('interpolates between two vectors without modifying them', () => {
      const a = new Vector3(1, 2, 3);
      const b = new Vector3(5, 6, 7);
      const out = new Vector3().lerpVectors(a, b, 0.25);
      expect(out.x).toBe(2);
      expect(out.y).toBe(3);
      expect(out.z).toBe(4);
      // originals unchanged
      expect(a.x).toBe(1);
      expect(b.x).toBe(5);
    });
  });

  describe('toArray / fromArray', () => {
    it('toArray returns [x, y, z]', () => {
      expect(new Vector3(1, 2, 3).toArray()).toEqual([1, 2, 3]);
    });

    it('fromArray sets from tuple', () => {
      const v = new Vector3().fromArray([4, 5, 6]);
      expect(v.x).toBe(4);
      expect(v.y).toBe(5);
      expect(v.z).toBe(6);
    });

    it('toArray writes at an offset into a caller array', () => {
      const arr = [99, 99, 99, 99];
      new Vector3(1, 2, 3).toArray(arr, 1);
      expect(arr).toEqual([99, 1, 2, 3]);
    });

    it('fromArray reads at an offset', () => {
      const v = new Vector3().fromArray([9, 9, 4, 5, 6], 2);
      expect(v.x).toBe(4);
      expect(v.y).toBe(5);
      expect(v.z).toBe(6);
    });
  });

  describe('setFromMatrix*', () => {
    it('setFromMatrixPosition extracts the translation column', () => {
      const m = new Matrix4();
      m.elements[12] = 10;
      m.elements[13] = 20;
      m.elements[14] = 30;
      const v = new Vector3().setFromMatrixPosition(m);
      expect(v.x).toBe(10);
      expect(v.y).toBe(20);
      expect(v.z).toBe(30);
    });

    it('setFromMatrixColumn extracts a basis column', () => {
      const m = new Matrix4();
      m.elements[0] = 2;  // col 0 x
      m.elements[5] = 3;  // col 1 y
      m.elements[10] = 4; // col 2 z
      expect(new Vector3().setFromMatrixColumn(m, 0)).toEqual(new Vector3(2, 0, 0));
      expect(new Vector3().setFromMatrixColumn(m, 1)).toEqual(new Vector3(0, 3, 0));
      expect(new Vector3().setFromMatrixColumn(m, 2)).toEqual(new Vector3(0, 0, 4));
    });

    it('setFromMatrixScale extracts column lengths (rotation-invariant)', () => {
      const m = new Matrix4().compose(
        { x: 0, y: 0, z: 0 },
        new Quaternion().setFromEuler(0.3, -0.5, 0.2),
        { x: 2, y: 3, z: 4 },
      );
      const v = new Vector3().setFromMatrixScale(m);
      expect(v.x).toBeCloseTo(2, 6);
      expect(v.y).toBeCloseTo(3, 6);
      expect(v.z).toBeCloseTo(4, 6);
    });
  });

  describe('toString', () => {
    it('formats nicely', () => {
      const v = new Vector3(1.5, 2.5, 3.5);
      expect(v.toString()).toMatch(/Vector3\(1\.500,\s*2\.500,\s*3\.500\)/);
    });
  });

  describe('applyMatrix4', () => {
    it('identity matrix leaves point unchanged', () => {
      const m = new Matrix4(); // identity
      const v = new Vector3(1, 2, 3).applyMatrix4(m);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(2);
      expect(v.z).toBeCloseTo(3);
    });

    it('pure translation moves the point', () => {
      const m = new Matrix4();
      m.elements[12] = 10;
      m.elements[13] = 20;
      m.elements[14] = 30;
      const v = new Vector3(1, 2, 3).applyMatrix4(m);
      expect(v.x).toBeCloseTo(11);
      expect(v.y).toBeCloseTo(22);
      expect(v.z).toBeCloseTo(33);
    });

    it('scale matrix scales the point', () => {
      const m = new Matrix4();
      m.elements[0] = 2;  // scale x
      m.elements[5] = 3;  // scale y
      m.elements[10] = 4; // scale z
      const v = new Vector3(1, 1, 1).applyMatrix4(m);
      expect(v.x).toBeCloseTo(2);
      expect(v.y).toBeCloseTo(3);
      expect(v.z).toBeCloseTo(4);
    });

    it('perspective matrix applies perspective divide', () => {
      // 简单透视:把 z=-1 的点投影,w = -z = 1,结果不变(近似)
      const m = new Matrix4();
      m.makePerspective(Math.PI / 2, 1, 0.1, 100);
      const v = new Vector3(0, 0, -1).applyMatrix4(m);
      // 投影后 x,y 应为 0(点在视轴中心),z 在 [-1,1] 范围
      expect(v.x).toBeCloseTo(0, 5);
      expect(v.y).toBeCloseTo(0, 5);
    });
  });

  describe('setScalar / subScalar', () => {
    it('setScalar sets all three components', () => {
      const v = new Vector3().setScalar(9);
      expect(v.x).toBe(9);
      expect(v.y).toBe(9);
      expect(v.z).toBe(9);
    });

    it('subScalar subtracts from each component', () => {
      const v = new Vector3(10, 20, 30).subScalar(5);
      expect(v.x).toBe(5);
      expect(v.y).toBe(15);
      expect(v.z).toBe(25);
    });
  });

  describe('crossVectors', () => {
    it('computes this = a × b without mutating inputs', () => {
      const a = new Vector3(1, 0, 0);
      const b = new Vector3(0, 1, 0);
      const out = new Vector3().crossVectors(a, b);
      expect(out.x).toBe(0);
      expect(out.y).toBe(0);
      expect(out.z).toBe(1);
      expect(a.x).toBe(1);
      expect(b.y).toBe(1);
    });
  });

  describe('applyAxisAngle / applyEuler', () => {
    it('applyAxisAngle rotates about an axis (right-hand)', () => {
      // 绕 Y 轴转 90°:局部 +X → 世界 -Z
      const v = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      expect(v.x).toBeCloseTo(0, 6);
      expect(v.y).toBeCloseTo(0, 6);
      expect(v.z).toBeCloseTo(-1, 6);
    });

    it('applyEuler applies rotation in the given order', () => {
      const v = new Vector3(1, 0, 0).applyEuler({ x: 0, y: Math.PI / 2, z: 0, order: 'XYZ' });
      expect(v.x).toBeCloseTo(0, 6);
      expect(v.z).toBeCloseTo(-1, 6);
    });
  });

  describe('applyNormalMatrix', () => {
    it('transforms then normalizes', () => {
      // 对角缩放 0.5/1/3/0.25 → (2,3,4) 到 (1,1,1),再归一化
      const m = { elements: [0.5, 0, 0, 0, 1 / 3, 0, 0, 0, 0.25] };
      const v = new Vector3(2, 3, 4).applyNormalMatrix(m);
      const expected = 1 / Math.sqrt(3);
      expect(v.x).toBeCloseTo(expected, 6);
      expect(v.y).toBeCloseTo(expected, 6);
      expect(v.z).toBeCloseTo(expected, 6);
      expect(v.length()).toBeCloseTo(1, 6);
    });
  });

  describe('clampScalar / clampLength', () => {
    it('clampScalar clamps each component to [min, max]', () => {
      const v = new Vector3(5, -5, 0).clampScalar(-1, 1);
      expect(v.x).toBe(1);
      expect(v.y).toBe(-1);
      expect(v.z).toBe(0);
    });

    it('clampLength shortens over-long vectors without changing direction', () => {
      const v = new Vector3(3, 4, 0).clampLength(0, 1);
      expect(v.length()).toBeCloseTo(1, 6);
      expect(v.x).toBeCloseTo(3 / 5, 6);
      expect(v.y).toBeCloseTo(4 / 5, 6);
    });

    it('clampLength raises short vectors to the minimum', () => {
      const v = new Vector3(1, 0, 0).clampLength(5, 10);
      expect(v.x).toBeCloseTo(5, 6);
    });

    it('clampLength keeps the zero vector at zero', () => {
      const v = new Vector3().clampLength(1, 2);
      expect(v.length()).toBe(0);
    });
  });

  describe('reflect', () => {
    it('mirrors a vector across a plane', () => {
      const v = new Vector3(1, -1, 0).reflect(new Vector3(0, 1, 0));
      expect(v.x).toBeCloseTo(1, 6);
      expect(v.y).toBeCloseTo(1, 6);
      expect(v.z).toBeCloseTo(0, 6);
    });
  });

  describe('manhattan measures', () => {
    it('distanceToManhattan sums absolute component differences', () => {
      expect(new Vector3(1, 2, 3).distanceToManhattan(new Vector3(2, -1, 4))).toBe(1 + 3 + 1);
    });

    it('lengthManhattan sums absolute components', () => {
      expect(new Vector3(1, -2, 3).lengthManhattan()).toBe(6);
    });
  });

  describe('getComponent / setComponent', () => {
    it('getComponent reads by index', () => {
      const v = new Vector3(1, 2, 3);
      expect(v.getComponent(0)).toBe(1);
      expect(v.getComponent(1)).toBe(2);
      expect(v.getComponent(2)).toBe(3);
    });

    it('setComponent writes by index', () => {
      const v = new Vector3();
      v.setComponent(1, 42);
      expect(v.x).toBe(0);
      expect(v.y).toBe(42);
      expect(v.z).toBe(0);
    });

    it('throws on out-of-range index', () => {
      expect(() => new Vector3().getComponent(3)).toThrow('index is out of range: 3');
      expect(() => new Vector3().getComponent(-1)).toThrow();
      expect(() => new Vector3().setComponent(5, 0)).toThrow('index is out of range: 5');
    });
  });

  describe('project / unproject', () => {
    it('round-trips a point through a camera', () => {
      const matrixWorld = new Matrix4().makeTranslation(10, 20, 30);
      const matrixWorldInverse = new Matrix4().copy(matrixWorld).invert();
      const projectionMatrix = new Matrix4().makePerspective(Math.PI / 2, 1, 0.1, 100);
      const projectionMatrixInverse = new Matrix4().copy(projectionMatrix).invert();
      const camera = { matrixWorld, matrixWorldInverse, projectionMatrix, projectionMatrixInverse };

      // 相机局部 (0,0,-5),在视锥内
      const p = new Vector3(10, 20, 25);
      const roundTripped = p.clone().project(camera).unproject(camera);
      expect(roundTripped.x).toBeCloseTo(p.x, 4);
      expect(roundTripped.y).toBeCloseTo(p.y, 4);
      expect(roundTripped.z).toBeCloseTo(p.z, 4);
    });
  });

  describe('random / randomDirection', () => {
    afterEach(() => vi.restoreAllMocks());

    it('random() fills components in [0, 1)', () => {
      const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.5).mockReturnValueOnce(0.75);
      const v = new Vector3().random();
      expect(v.x).toBe(0.25);
      expect(v.y).toBe(0.5);
      expect(v.z).toBe(0.75);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('randomDirection() returns a unit vector (angle-uniform sampling)', () => {
      // u=0 → 赤道平面;t=π/2 → +Z
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
      const v = new Vector3().randomDirection();
      expect(v.x).toBeCloseTo(0, 10);
      expect(v.y).toBeCloseTo(0, 10);
      expect(v.z).toBeCloseTo(1, 10);
      expect(v.length()).toBeCloseTo(1, 10);
    });
  });

  describe('floor / ceil / round / roundToZero / sign', () => {
    it('floor rounds each component down', () => {
      const v = new Vector3(1.9, -1.1, 0.5).floor();
      expect(v.x).toBe(1);
      expect(v.y).toBe(-2);
      expect(v.z).toBe(0);
    });

    it('ceil rounds each component up', () => {
      const v = new Vector3(1.1, -1.9, 0.2).ceil();
      expect(v.x).toBe(2);
      expect(v.y).toBe(-1);
      expect(v.z).toBe(1);
    });

    it('round rounds to nearest (ties toward +inf)', () => {
      const v = new Vector3(1.4, 1.6, -1.5).round();
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(-1);
    });

    it('roundToZero truncates toward zero', () => {
      const v = new Vector3(1.9, -1.9, 0.4).roundToZero();
      expect(v.x).toBe(1);
      expect(v.y).toBe(-1);
      expect(v.z).toBe(0);
    });

    it('sign returns -1 / 0 / 1 per component', () => {
      const v = new Vector3(-3, 0, 7).sign();
      expect(v.x).toBe(-1);
      expect(v.y).toBe(0);
      expect(v.z).toBe(1);
    });
  });

  describe('setFromSpherical / setFromCylindrical', () => {
    it('setFromSphericalCoords matches (sinφ·sinθ, cosφ, sinφ·cosθ) layout', () => {
      const r = 3, phi = 1.2, theta = 2.1;
      const v = new Vector3().setFromSphericalCoords(r, phi, theta);
      expect(v.x).toBeCloseTo(Math.sin(phi) * Math.sin(theta) * r, 6);
      expect(v.y).toBeCloseTo(Math.cos(phi) * r, 6);
      expect(v.z).toBeCloseTo(Math.sin(phi) * Math.cos(theta) * r, 6);
    });

    it('setFromSpherical delegates to coords form', () => {
      // phi=0 → 北极
      const v = new Vector3().setFromSpherical({ radius: 4, phi: 0, theta: 0 });
      expect(v.x).toBeCloseTo(0, 6);
      expect(v.y).toBeCloseTo(4, 6);
      expect(v.z).toBeCloseTo(0, 6);
    });

    it('setFromCylindricalCoords matches (r·sinθ, y, r·cosθ) layout', () => {
      const v = new Vector3().setFromCylindricalCoords(3, Math.PI / 2, 7);
      expect(v.x).toBeCloseTo(3, 6);
      expect(v.y).toBe(7);
      expect(v.z).toBeCloseTo(0, 6);
    });

    it('setFromCylindrical delegates to coords form', () => {
      const v = new Vector3().setFromCylindrical({ radius: 2, theta: 0, y: 5 });
      expect(v.x).toBeCloseTo(0, 6);
      expect(v.y).toBe(5);
      expect(v.z).toBeCloseTo(2, 6);
    });
  });
});
