import { describe, it, expect } from 'vitest';
import { Matrix4, WebGLCoordinateSystem, WebGPUCoordinateSystem } from './Matrix4';
import { Euler, type EulerOrder } from './Euler';
import { Quaternion } from './Quaternion';
import { Vector3 } from './Vector3';

describe('Matrix4', () => {
  it('constructs as identity', () => {
    const m = new Matrix4();
    const e = m.elements;
    expect(e[0]).toBe(1);  expect(e[1]).toBe(0);
    expect(e[4]).toBe(0);  expect(e[5]).toBe(1);
    expect(e[10]).toBe(1); expect(e[15]).toBe(1);
    for (let i = 0; i < 16; i++) {
      if (i === 0 || i === 5 || i === 10 || i === 15) continue;
      expect(e[i]).toBe(0);
    }
  });

  it('identity() resets to identity', () => {
    const m = new Matrix4();
    m.elements[0] = 99;
    m.identity();
    expect(m.elements[0]).toBe(1);
    expect(m.elements[5]).toBe(1);
    expect(m.elements[10]).toBe(1);
    expect(m.elements[15]).toBe(1);
  });

  it('copy() copies elements independently', () => {
    const a = new Matrix4();
    const b = new Matrix4();
    a.elements[0] = 42;
    b.copy(a);
    expect(b.elements[0]).toBe(42);
    a.elements[0] = 1;
    expect(b.elements[0]).toBe(42);
  });

  it('clone() returns a copy', () => {
    const a = new Matrix4();
    a.elements[12] = 100;
    const b = a.clone();
    expect(b.elements[12]).toBe(100);
    expect(b).not.toBe(a);
  });

  describe('multiplyMatrices', () => {
    it('multiplies two identity matrices → identity', () => {
      const a = new Matrix4();
      const b = new Matrix4();
      const out = new Matrix4().multiplyMatrices(a, b);
      expect(out.elements).toEqual(new Matrix4().elements);
    });

    it('multiply translation × identity → translation', () => {
      const t = new Matrix4();
      t.elements[12] = 5;
      t.elements[13] = 10;
      t.elements[14] = -3;
      const result = new Matrix4().multiplyMatrices(t, new Matrix4());
      expect(result.elements[12]).toBe(5);
      expect(result.elements[13]).toBe(10);
      expect(result.elements[14]).toBe(-3);
    });
  });

  describe('makeLookAt', () => {
    it('eye at origin looking down -Z', () => {
      const m = new Matrix4().makeLookAt(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 1, z: 0 },
      );
      // Engine convention: Z = eye - target = (0,0,1) → e[10] = 1
      expect(m.elements[10]).toBeCloseTo(1);
      expect(m.elements[12]).toBeCloseTo(0);
      expect(m.elements[13]).toBeCloseTo(0);
      expect(m.elements[14]).toBeCloseTo(0);
    });
  });

  describe('compose', () => {
    it('composes identity transform', () => {
      const m = new Matrix4().compose(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 1, y: 1, z: 1 },
      );
      expect(m.elements[0]).toBe(1);
      expect(m.elements[5]).toBe(1);
      expect(m.elements[10]).toBe(1);
      expect(m.elements[12]).toBe(0);
    });

    it('composes translation', () => {
      const m = new Matrix4().compose(
        { x: 10, y: 20, z: 30 },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 1, y: 1, z: 1 },
      );
      expect(m.elements[12]).toBe(10);
      expect(m.elements[13]).toBe(20);
      expect(m.elements[14]).toBe(30);
    });
  });

  describe('getInverse', () => {
    it('inverse of identity is identity', () => {
      const m = new Matrix4();
      const inv = new Matrix4().getInverse(m);
      expect(inv.elements).toEqual(m.elements);
    });

    it('inverse of translation × translation ≈ identity', () => {
      const t = new Matrix4();
      t.elements[12] = 5;
      t.elements[13] = 10;
      t.elements[14] = 15;
      const inv = new Matrix4().getInverse(t);
      const result = new Matrix4().multiplyMatrices(t, inv);
      expect(result.elements[0]).toBeCloseTo(1);
      expect(result.elements[5]).toBeCloseTo(1);
      expect(result.elements[10]).toBeCloseTo(1);
      expect(result.elements[15]).toBeCloseTo(1);
      expect(result.elements[12]).toBeCloseTo(0);
    });

    it('returns identity for singular matrix', () => {
      const singular = new Matrix4();
      singular.elements[0] = 0; // zero scale → det=0
      const inv = new Matrix4().getInverse(singular);
      expect(inv.elements[0]).toBe(1); // identity
      expect(inv.elements[5]).toBe(1);
    });
  });

  describe('makePerspective', () => {
    it('produces a valid projection matrix', () => {
      const top = 0.1 * Math.tan(Math.PI / 8);
      const right = top * (16 / 9);
      const m = new Matrix4().makePerspective(-right, right, top, -top, 0.1, 100);
      expect(m.elements[11]).toBe(-1); // right-handed flag
      expect(m.elements[5]).toBeGreaterThan(0); // vertical FOV factor
      expect(m.elements[0]).toBeGreaterThan(0); // horizontal FOV factor
    });

    it('WebGL depth maps to [-1, 1]', () => {
      const top = 0.1 * Math.tan(Math.PI / 8);
      const m = new Matrix4().makePerspective(-top, top, top, -top, 0.1, 100, WebGLCoordinateSystem);
      // z_near=-1, z_far=+1 映射:c = -(far+near)/(far-near), d = -2·far·near/(far-near)
      expect(m.elements[10]).toBeCloseTo(-(100 + 0.1) / (100 - 0.1), 6);
      expect(m.elements[14]).toBeCloseTo((-2 * 100 * 0.1) / (100 - 0.1), 6);
    });

    it('WebGPU depth maps to [0, 1]', () => {
      const top = 0.1 * Math.tan(Math.PI / 8);
      const m = new Matrix4().makePerspective(-top, top, top, -top, 0.1, 100, WebGPUCoordinateSystem);
      expect(m.elements[10]).toBeCloseTo(-100 / (100 - 0.1), 6);
      expect(m.elements[14]).toBeCloseTo((-100 * 0.1) / (100 - 0.1), 6);
    });

    it('throws on unknown coordinate system', () => {
      const top = 0.1 * Math.tan(Math.PI / 8);
      expect(() =>
        new Matrix4().makePerspective(-top, top, top, -top, 0.1, 100, 9999),
      ).toThrow(/Invalid coordinate system/);
    });
  });

  describe('makeOrthographic', () => {
    it('produces a valid orthographic projection', () => {
      const m = new Matrix4().makeOrthographic(-2, 2, 2, -2, 0.1, 100);
      expect(m.elements[0]).toBeCloseTo(2 / (2 - -2), 10); // 2/(right-left)
      expect(m.elements[5]).toBeCloseTo(2 / (2 - -2), 10); // 2/(top-bottom)
      expect(m.elements[10]).toBeCloseTo(-2 / (100 - 0.1), 6); // GL depth: -2p
      expect(m.elements[12]).toBeCloseTo(0, 10);
      expect(m.elements[13]).toBeCloseTo(0, 10);
      expect(m.elements[14]).toBeCloseTo(-(100 + 0.1) / (100 - 0.1), 6); // -(far+near)p
    });

    it('WebGPU depth maps to [0, 1]', () => {
      const m = new Matrix4().makeOrthographic(-2, 2, 2, -2, 0.1, 100, WebGPUCoordinateSystem);
      expect(m.elements[10]).toBeCloseTo(-1 / (100 - 0.1), 6); // WebGPU: -p
      expect(m.elements[14]).toBeCloseTo(-0.1 / (100 - 0.1), 6); // -near·p
    });
  });

  describe('getNormalMatrix', () => {
    it('returns identity for identity matrix', () => {
      const out = new Float32Array(9);
      new Matrix4().getNormalMatrix(out);
      expect(out[0]).toBe(1);
      expect(out[4]).toBe(1);
      expect(out[8]).toBe(1);
    });

    it('returns identity for singular matrix', () => {
      const m = new Matrix4();
      m.elements[0] = 0;
      const out = new Float32Array(9);
      m.getNormalMatrix(out);
      expect(out[0]).toBe(1);
      expect(out[4]).toBe(1);
      expect(out[8]).toBe(1);
    });
  });

  describe('toArray', () => {
    it('returns 16 elements', () => {
      const arr = new Matrix4().toArray();
      expect(arr).toHaveLength(16);
      expect(arr[0]).toBe(1);
      expect(arr[15]).toBe(1);
    });
  });

  describe('copyPosition', () => {
    it('copies only the translation column, leaving rotation/scale intact', () => {
      const src = new Matrix4().compose(
        { x: 5, y: 10, z: -3 },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 2, y: 3, z: 4 },
      );
      const out = new Matrix4();
      out.copyPosition(src);
      expect(out.elements[12]).toBe(5);
      expect(out.elements[13]).toBe(10);
      expect(out.elements[14]).toBe(-3);
      // 旋转/缩放列不受影响(仍是 identity)
      expect(out.elements[0]).toBe(1);
      expect(out.elements[5]).toBe(1);
      expect(out.elements[10]).toBe(1);
    });
  });

  describe('scale', () => {
    it('scales the 3 basis columns in place, leaving translation', () => {
      const m = new Matrix4().compose(
        { x: 5, y: 10, z: -3 },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 1, y: 1, z: 1 },
      );
      m.scale({ x: 2, y: 3, z: 4 });
      expect(m.elements[0]).toBeCloseTo(2);
      expect(m.elements[5]).toBeCloseTo(3);
      expect(m.elements[10]).toBeCloseTo(4);
      // 平移列保持
      expect(m.elements[12]).toBe(5);
      expect(m.elements[13]).toBe(10);
      expect(m.elements[14]).toBe(-3);
    });
  });

  describe('set', () => {
    it('writes all 16 elements column-major and returns this', () => {
      const m = new Matrix4();
      const ret = m.set(
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
      );
      expect(ret).toBe(m);
      const e = m.elements;
      expect(e[0]).toBe(1);  expect(e[4]).toBe(2);  expect(e[8]).toBe(3);  expect(e[12]).toBe(4);
      expect(e[1]).toBe(5);  expect(e[5]).toBe(6);  expect(e[9]).toBe(7);  expect(e[13]).toBe(8);
      expect(e[2]).toBe(9);  expect(e[6]).toBe(10); expect(e[10]).toBe(11); expect(e[14]).toBe(12);
      expect(e[3]).toBe(13); expect(e[7]).toBe(14); expect(e[11]).toBe(15); expect(e[15]).toBe(16);
    });
  });

  describe('setFromMatrix3', () => {
    it('embeds 3x3 into upper-left with identity 4th row/col', () => {
      const m3 = { elements: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
      const m = new Matrix4().setFromMatrix3(m3);
      const e = m.elements;
      expect(e[0]).toBe(1);  expect(e[4]).toBe(4);  expect(e[8]).toBe(7);  expect(e[12]).toBe(0);
      expect(e[1]).toBe(2);  expect(e[5]).toBe(5);  expect(e[9]).toBe(8);  expect(e[13]).toBe(0);
      expect(e[2]).toBe(3);  expect(e[6]).toBe(6);  expect(e[10]).toBe(9); expect(e[14]).toBe(0);
      expect(e[3]).toBe(0);  expect(e[7]).toBe(0);  expect(e[11]).toBe(0); expect(e[15]).toBe(1);
    });
  });

  describe('extractBasis / makeBasis', () => {
    it('makeBasis then extractBasis round-trips axis vectors', () => {
      const x = new Vector3(1, 0, 0);
      const y = new Vector3(0, 1, 0);
      const z = new Vector3(0, 0, 1);
      const m = new Matrix4().makeBasis(
        new Vector3(0, 0, -1),
        new Vector3(0, 1, 0),
        new Vector3(1, 0, 0),
      );
      m.extractBasis(x, y, z);
      expect(x.x).toBeCloseTo(0, 10); expect(x.z).toBeCloseTo(-1, 10);
      expect(y.y).toBeCloseTo(1, 10);
      expect(z.x).toBeCloseTo(1, 10);
    });

    it('makeBasis composes columns from axes', () => {
      const m = new Matrix4().makeBasis(
        { x: 1, y: 2, z: 3 },
        { x: 4, y: 5, z: 6 },
        { x: 7, y: 8, z: 9 },
      );
      expect(m.elements[0]).toBe(1);  expect(m.elements[4]).toBe(4);  expect(m.elements[8]).toBe(7);
      expect(m.elements[1]).toBe(2);  expect(m.elements[5]).toBe(5);  expect(m.elements[9]).toBe(8);
      expect(m.elements[2]).toBe(3);  expect(m.elements[6]).toBe(6);  expect(m.elements[10]).toBe(9);
    });
  });

  describe('extractRotation', () => {
    it('removes scale and translation, keeps orientation', () => {
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
      const src = new Matrix4().compose(
        { x: 7, y: 8, z: 9 },
        q,
        { x: 2, y: 3, z: 4 },
      );
      const rot = new Matrix4().extractRotation(src);
      expect(rot.elements[12]).toBe(0);
      expect(rot.elements[13]).toBe(0);
      expect(rot.elements[14]).toBe(0);
      // 提取后应为纯旋转,基向量为单位长
      const colX = new Vector3().setFromMatrixColumn(rot, 0);
      expect(colX.length()).toBeCloseTo(1, 10);
      // 与 makeRotationFromQuaternion 等价
      const expected = new Matrix4().makeRotationFromQuaternion(q);
      expect(rot.equals(expected)).toBe(true);
    });
  });

  describe('makeRotationFromEuler', () => {
    const orders: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];

    it.each(orders)('round-trips with Euler.setFromRotationMatrix (order %s)', (order) => {
      const angles = { x: 0.3, y: -0.5, z: 0.9 };
      const euler = new Euler(angles.x, angles.y, angles.z, order);
      const m = new Matrix4().makeRotationFromEuler(euler);
      const back = new Euler().setFromRotationMatrix(m, order);
      expect(back.x).toBeCloseTo(angles.x, 6);
      expect(back.y).toBeCloseTo(angles.y, 6);
      expect(back.z).toBeCloseTo(angles.z, 6);
    });

    it('identity angles give identity matrix for every order', () => {
      const ordersAll: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];
      for (const order of ordersAll) {
        const m = new Matrix4().makeRotationFromEuler(new Euler(0, 0, 0, order));
        expect(m.elements[0]).toBeCloseTo(1, 10);
        expect(m.elements[5]).toBeCloseTo(1, 10);
        expect(m.elements[10]).toBeCloseTo(1, 10);
        expect(m.elements[15]).toBeCloseTo(1, 10);
      }
    });

    it('pure Z rotation for XYZ yields same matrix as makeRotationZ', () => {
      const m = new Matrix4().makeRotationFromEuler(new Euler(0, 0, Math.PI / 4, 'XYZ'));
      const rz = new Matrix4().makeRotationZ(Math.PI / 4);
      expect(m.equals(rz)).toBe(true);
    });
  });

  describe('lookAt', () => {
    it('builds rotation basis without touching translation', () => {
      const m = new Matrix4().makeTranslation(5, 6, 7);
      m.lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
      // forward = -Z → 第三基列应为 (0,0,-1)
      expect(m.elements[8]).toBeCloseTo(0, 10);
      expect(m.elements[9]).toBeCloseTo(0, 10);
      expect(m.elements[10]).toBeCloseTo(1, 10); // z = eye−target = (0,0,1)
      // 平移列不被 touch
      expect(m.elements[12]).toBe(5);
      expect(m.elements[13]).toBe(6);
      expect(m.elements[14]).toBe(7);
    });

    it('degenerate eye==target falls back to +Z forward', () => {
      const m = new Matrix4().lookAt(
        { x: 1, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 },
        { x: 0, y: 1, z: 0 },
      );
      // 退化时 z = (0,0,1)
      expect(m.elements[8]).toBeCloseTo(0, 10);
      expect(m.elements[9]).toBeCloseTo(0, 10);
      expect(m.elements[10]).toBeCloseTo(1, 10);
    });
  });

  describe('multiplyScalar', () => {
    it('scales every element', () => {
      const m = new Matrix4();
      m.elements[15] = 2;
      m.multiplyScalar(3);
      expect(m.elements[0]).toBe(3);
      expect(m.elements[15]).toBe(6);
      expect(m.elements[5]).toBe(3);
    });
  });

  describe('determinant', () => {
    it('identity → 1', () => {
      expect(new Matrix4().determinant()).toBeCloseTo(1, 10);
    });

    it('pure rotation → 1', () => {
      const m = new Matrix4().makeRotationY(Math.PI / 3);
      expect(m.determinant()).toBeCloseTo(1, 6);
    });

    it('scale matrix → product of scales', () => {
      const m = new Matrix4().makeScale(2, 3, 4);
      expect(m.determinant()).toBeCloseTo(24, 10);
    });

    it('zeroed scale column → 0', () => {
      const m = new Matrix4();
      m.elements[0] = 0;
      m.elements[1] = 0;
      m.elements[2] = 0;
      expect(m.determinant()).toBeCloseTo(0, 10);
    });
  });

  describe('transpose', () => {
    it('transpose squared returns original', () => {
      const m = new Matrix4().makeRotationAxis({ x: 1, y: 2, z: 3 }, 0.7);
      const original = m.clone();
      m.transpose().transpose();
      expect(m.equals(original)).toBe(true);
    });

    it('symmetric matrix unchanged', () => {
      const m = new Matrix4().set(
        1, 2, 3, 4,
        2, 5, 6, 7,
        3, 6, 8, 9,
        4, 7, 9, 10,
      );
      const before = m.clone();
      m.transpose();
      expect(m.equals(before)).toBe(true);
    });
  });

  describe('setPosition', () => {
    it('accepts a Vector3', () => {
      const m = new Matrix4().setPosition(new Vector3(1, 2, 3));
      expect(m.elements[12]).toBe(1);
      expect(m.elements[13]).toBe(2);
      expect(m.elements[14]).toBe(3);
    });

    it('accepts three numbers', () => {
      const m = new Matrix4().setPosition(4, 5, 6);
      expect(m.elements[12]).toBe(4);
      expect(m.elements[13]).toBe(5);
      expect(m.elements[14]).toBe(6);
    });

    it('leaves rotation/scaling untouched', () => {
      const m = new Matrix4().makeScale(2, 2, 2);
      m.setPosition(9, 9, 9);
      expect(m.elements[0]).toBe(2);
      expect(m.elements[5]).toBe(2);
      expect(m.elements[10]).toBe(2);
    });
  });

  describe('getMaxScaleOnAxis', () => {
    it('returns largest basis-column length', () => {
      const m = new Matrix4().makeScale(2, 5, 3);
      expect(m.getMaxScaleOnAxis()).toBeCloseTo(5, 10);
    });

    it('identity → 1', () => {
      expect(new Matrix4().getMaxScaleOnAxis()).toBeCloseTo(1, 10);
    });
  });

  describe('makeRotationX/Y/Z', () => {
    it('90° around X maps Y→Z', () => {
      const m = new Matrix4().makeRotationX(Math.PI / 2);
      expect(m.elements[5]).toBeCloseTo(0, 10);   // cos
      expect(m.elements[6]).toBeCloseTo(1, 10);   // sin
      expect(m.elements[9]).toBeCloseTo(-1, 10);  // -sin
      expect(m.elements[10]).toBeCloseTo(0, 10);  // cos
    });

    it('90° around Y maps Z→X', () => {
      const m = new Matrix4().makeRotationY(Math.PI / 2);
      expect(m.elements[0]).toBeCloseTo(0, 10);
      expect(m.elements[2]).toBeCloseTo(-1, 10);  // -sin
      expect(m.elements[8]).toBeCloseTo(1, 10);   // sin
      expect(m.elements[10]).toBeCloseTo(0, 10);
    });

    it('90° around Z maps X→Y', () => {
      const m = new Matrix4().makeRotationZ(Math.PI / 2);
      expect(m.elements[0]).toBeCloseTo(0, 10);
      expect(m.elements[1]).toBeCloseTo(1, 10);
      expect(m.elements[4]).toBeCloseTo(-1, 10);
      expect(m.elements[5]).toBeCloseTo(0, 10);
    });
  });

  describe('makeRotationAxis', () => {
    it('matches makeRotationX for the X axis', () => {
      const a = new Matrix4().makeRotationAxis({ x: 1, y: 0, z: 0 }, 0.6);
      const b = new Matrix4().makeRotationX(0.6);
      expect(a.equals(b)).toBe(true);
    });

    it('rotates a point around Z axis correctly', () => {
      const m = new Matrix4().makeRotationAxis({ x: 0, y: 0, z: 1 }, Math.PI / 2);
      const p = new Vector3(1, 0, 0).applyMatrix4(m);
      expect(p.x).toBeCloseTo(0, 10);
      expect(p.y).toBeCloseTo(1, 10);
    });
  });

  describe('makeShear', () => {
    it('moves X by y shear', () => {
      const m = new Matrix4().makeShear(0, 0, 2, 0, 0, 0); // yx = 2: X += 2Y
      const p = new Vector3(0, 1, 0).applyMatrix4(m);
      expect(p.x).toBeCloseTo(2, 10);
      expect(p.y).toBeCloseTo(1, 10);
    });
  });

  describe('equals', () => {
    it('true for identical, false for different', () => {
      const a = new Matrix4().makeScale(1, 2, 3);
      const b = new Matrix4().makeScale(1, 2, 3);
      const c = new Matrix4().makeScale(1, 2, 4);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });

  describe('fromArray', () => {
    it('reads 16 elements with offset', () => {
      const arr = new Array<number>(20).fill(0);
      for (let i = 0; i < 16; i++) arr[i + 3] = i + 1;
      const m = new Matrix4().fromArray(arr, 3);
      expect(m.elements[0]).toBe(1);
      expect(m.elements[15]).toBe(16);
    });

    it('round-trips with toArray', () => {
      const m = new Matrix4().makeTranslation(3, 4, 5);
      const arr = m.toArray();
      const back = new Matrix4().fromArray(arr);
      expect(back.equals(m)).toBe(true);
    });
  });
});