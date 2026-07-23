import { describe, it, expect } from 'vitest';
import { Euler, type EulerOrder } from './Euler';
import { Quaternion } from './Quaternion';

// 90° 绕 Z 轴旋转矩阵 (column-major 16 元素):
//   [ 0 -1 0 0 ]
//   [ 1  0 0 0 ]
//   [ 0  0 1 0 ]
//   [ 0  0 0 1 ]
const ROT_Z_90_ELEMENTS: number[] = [
  0, 1, 0, 0,
  -1, 0, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// 单位矩阵元素 (column-major)。
const IDENTITY_ELEMENTS: number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

describe('Euler', () => {
  describe('construction', () => {
    it('constructs with defaults', () => {
      const e = new Euler();
      expect(e.x).toBe(0);
      expect(e.y).toBe(0);
      expect(e.z).toBe(0);
      expect(e.order).toBe('XYZ');
    });

    it('constructs with values and order', () => {
      const e = new Euler(0.1, 0.2, 0.3, 'YXZ');
      expect(e.x).toBe(0.1);
      expect(e.y).toBe(0.2);
      expect(e.z).toBe(0.3);
      expect(e.order).toBe('YXZ');
    });

    it('DEFAULT_ORDER is XYZ', () => {
      expect(Euler.DEFAULT_ORDER).toBe('XYZ');
    });
  });

  describe('set', () => {
    it('updates all components and returns this', () => {
      const e = new Euler();
      const ret = e.set(1, 2, 3, 'ZXY');
      expect(ret).toBe(e);
      expect(e.x).toBe(1);
      expect(e.y).toBe(2);
      expect(e.z).toBe(3);
      expect(e.order).toBe('ZXY');
    });

    it('omits order → keeps current order', () => {
      const e = new Euler(0, 0, 0, 'YZX');
      e.set(5, 6, 7);
      expect(e.order).toBe('YZX');
    });
  });

  describe('clone / copy', () => {
    it('clone returns independent instance', () => {
      const a = new Euler(1, 2, 3, 'XZY');
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.x).toBe(1);
      expect(b.y).toBe(2);
      expect(b.z).toBe(3);
      expect(b.order).toBe('XZY');
      b.x = 99;
      expect(a.x).toBe(1);
    });

    it('copy duplicates fields and returns this', () => {
      const a = new Euler(1, 2, 3, 'ZYX');
      const b = new Euler();
      const ret = b.copy(a);
      expect(ret).toBe(b);
      expect(b.x).toBe(1);
      expect(b.y).toBe(2);
      expect(b.z).toBe(3);
      expect(b.order).toBe('ZYX');
    });
  });

  describe('equals', () => {
    it('true for same components and order', () => {
      expect(new Euler(1, 2, 3, 'XYZ').equals(new Euler(1, 2, 3, 'XYZ'))).toBe(true);
    });

    it('false when components differ', () => {
      expect(new Euler(1, 2, 3, 'XYZ').equals(new Euler(1, 2, 4, 'XYZ'))).toBe(false);
    });

    it('false when order differs', () => {
      expect(new Euler(1, 2, 3, 'XYZ').equals(new Euler(1, 2, 3, 'YXZ'))).toBe(false);
    });
  });

  describe('toArray / fromArray', () => {
    it('toArray returns [x, y, z, order]', () => {
      const arr = new Euler(1, 2, 3, 'ZXY').toArray();
      expect(arr).toEqual([1, 2, 3, 'ZXY']);
    });

    it('fromArray round-trips', () => {
      const e = new Euler().fromArray([4, 5, 6, 'YZX']);
      expect(e.x).toBe(4);
      expect(e.y).toBe(5);
      expect(e.z).toBe(6);
      expect(e.order).toBe('YZX');
    });
  });

  describe('setFromRotationMatrix', () => {
    it('identity matrix → zero euler', () => {
      const e = new Euler().setFromRotationMatrix({ elements: IDENTITY_ELEMENTS }, 'XYZ');
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(0, 10);
      expect(e.order).toBe('XYZ');
    });

    it('90° Z rotation matrix → (0, 0, π/2) for XYZ', () => {
      const e = new Euler().setFromRotationMatrix(
        { elements: ROT_Z_90_ELEMENTS },
        'XYZ',
      );
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(Math.PI / 2, 10);
    });

    it('90° Z rotation matrix → (0, 0, π/2) for ZYX', () => {
      const e = new Euler().setFromRotationMatrix(
        { elements: ROT_Z_90_ELEMENTS },
        'ZYX',
      );
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(Math.PI / 2, 10);
    });

    it('uses current order when not specified', () => {
      const e = new Euler(0, 0, 0, 'XYZ');
      e.setFromRotationMatrix({ elements: ROT_Z_90_ELEMENTS });
      expect(e.z).toBeCloseTo(Math.PI / 2, 10);
      expect(e.order).toBe('XYZ');
    });
  });

  describe('setFromQuaternion', () => {
    it('identity quaternion → zero euler', () => {
      const q = new Quaternion(0, 0, 0, 1);
      const e = new Euler().setFromQuaternion(q, 'XYZ');
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(0, 10);
    });

    it('90° Z quaternion → (0, 0, π/2) for XYZ', () => {
      const s = Math.SQRT1_2;
      const q = new Quaternion(0, 0, s, s); // 90° around Z
      const e = new Euler().setFromQuaternion(q, 'XYZ');
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(Math.PI / 2, 10);
    });

    it('90° X quaternion → (π/2, 0, 0) for XYZ', () => {
      const s = Math.SQRT1_2;
      const q = new Quaternion(s, 0, 0, s); // 90° around X
      const e = new Euler().setFromQuaternion(q, 'XYZ');
      expect(e.x).toBeCloseTo(Math.PI / 2, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(0, 10);
    });

    it('uses current order when not specified', () => {
      const e = new Euler(0, 0, 0, 'YXZ');
      const s = Math.SQRT1_2;
      const q = new Quaternion(0, 0, s, s);
      e.setFromQuaternion(q);
      expect(e.order).toBe('YXZ');
      // 纯 Z 旋转在 YXZ 顺序下也应得到 z=π/2
      expect(e.z).toBeCloseTo(Math.PI / 2, 10);
    });
  });

  describe('reorder', () => {
    it('identity is no-op across reorder', () => {
      const e = new Euler(0, 0, 0, 'XYZ');
      e.reorder('YXZ');
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(0, 10);
      expect(e.order).toBe('YXZ');
    });

    it('pure Z rotation preserved when reordering XYZ → ZYX', () => {
      const e = new Euler(0, 0, Math.PI / 4, 'XYZ');
      e.reorder('ZYX');
      expect(e.order).toBe('ZYX');
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(Math.PI / 4, 10);
    });

    it('pure X rotation preserved when reordering XYZ → YXZ', () => {
      const e = new Euler(Math.PI / 4, 0, 0, 'XYZ');
      e.reorder('YXZ');
      expect(e.order).toBe('YXZ');
      expect(e.x).toBeCloseTo(Math.PI / 4, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(0, 10);
    });

    it('reorder to same order returns equivalent rotation', () => {
      // 选择三个轴都有非零角的情况,验证 reorder 到同序号保持不变
      const e = new Euler(0.1, 0.2, 0.3, 'XYZ');
      e.reorder('XYZ');
      expect(e.order).toBe('XYZ');
      expect(e.x).toBeCloseTo(0.1, 6);
      expect(e.y).toBeCloseTo(0.2, 6);
      expect(e.z).toBeCloseTo(0.3, 6);
    });

    it('double reorder round-trips for non-gimlock angles', () => {
      const original = new Euler(0.15, -0.25, 0.4, 'XYZ');
      const roundTrip = original.clone();
      roundTrip.reorder('ZYX');
      roundTrip.reorder('XYZ');
      expect(roundTrip.x).toBeCloseTo(original.x, 6);
      expect(roundTrip.y).toBeCloseTo(original.y, 6);
      expect(roundTrip.z).toBeCloseTo(original.z, 6);
    });
  });

  describe('order coverage', () => {
    // 确保所有 6 种顺序都能从对应单轴旋转矩阵正确还原角度。
    const orders: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];

    it.each(orders)('order %s accepts identity without throwing', (order) => {
      const e = new Euler().setFromRotationMatrix({ elements: IDENTITY_ELEMENTS }, order);
      expect(e.x).toBeCloseTo(0, 10);
      expect(e.y).toBeCloseTo(0, 10);
      expect(e.z).toBeCloseTo(0, 10);
      expect(e.order).toBe(order);
    });
  });
});
