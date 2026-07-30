// InstancedGeometry 单元测试。
// 验证 per-instance 矩阵 / 颜色 / 自定义属性的分配、读写、克隆、序列化。

import { describe, it, expect } from 'vitest';
import { InstancedGeometry } from './InstancedGeometry';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';

describe('InstancedGeometry', () => {
  it('constructs with zero instances by default', () => {
    const g = new InstancedGeometry();
    expect(g.isInstancedGeometry).toBe(true);
    expect(g.instanceCount).toBe(0);
    expect(g.instanceMatrix.length).toBe(0);
    expect(g.instanceColor).toBeNull();
    expect(g.customAttributes.size).toBe(0);
  });

  it('is a BufferGeometry subclass (inherited attributes/index API)', () => {
    const g = new InstancedGeometry();
    expect(g instanceof BufferGeometry).toBe(true);
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    expect(g.attributes.position.count).toBe(3);
    expect(g.getAttribute('position')).toBeDefined();
  });

  describe('allocate', () => {
    it('allocates instanceMatrix sized count*16', () => {
      const g = new InstancedGeometry();
      g.allocate(10);
      expect(g.instanceCount).toBe(10);
      expect(g.instanceMatrix.length).toBe(10 * 16);
    });

    it('initializes all instance matrices to identity', () => {
      const g = new InstancedGeometry();
      g.allocate(3);
      for (let i = 0; i < 3; i++) {
        const off = i * 16;
        // identity: 1 at (0,5,10,15), 0 elsewhere
        expect(g.instanceMatrix[off + 0]).toBe(1);
        expect(g.instanceMatrix[off + 5]).toBe(1);
        expect(g.instanceMatrix[off + 10]).toBe(1);
        expect(g.instanceMatrix[off + 15]).toBe(1);
        expect(g.instanceMatrix[off + 1]).toBe(0);
        expect(g.instanceMatrix[off + 7]).toBe(0);
      }
    });

    it('clamps negative count to 0', () => {
      const g = new InstancedGeometry();
      g.allocate(-5);
      expect(g.instanceCount).toBe(0);
    });

    it('clamps float count to floor', () => {
      const g = new InstancedGeometry();
      g.allocate(4.9);
      expect(g.instanceCount).toBe(4);
      expect(g.instanceMatrix.length).toBe(4 * 16);
    });

    it('bumps instanceMatrixVersion on allocate', () => {
      const g = new InstancedGeometry();
      const v = g.instanceMatrixVersion;
      g.allocate(2);
      expect(g.instanceMatrixVersion).toBeGreaterThan(v);
    });

    it('preserves instanceColor allocation flag (still null when never set)', () => {
      const g = new InstancedGeometry();
      g.allocate(5);
      expect(g.instanceColor).toBeNull();
    });

    it('reallocates instanceColor as white when previously set', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setInstanceColor(0, 0.5, 0.5, 0.5, 1);
      expect(g.instanceColor).not.toBeNull();
      const oldColor = g.instanceColor!;
      g.allocate(4);
      // 重新分配后所有实例应为白色
      expect(g.instanceColor).not.toBeNull();
      expect(g.instanceColor!.length).toBe(4 * 4);
      // 新分配,实例 0 不再是 0.5
      expect(g.instanceColor![0]).toBe(1);
      expect(oldColor).not.toBe(g.instanceColor); // 新数组,不是旧引用
    });
  });

  describe('setInstanceCount / getInstanceCount', () => {
    it('setInstanceCount is alias for allocate', () => {
      const g = new InstancedGeometry();
      g.setInstanceCount(7);
      expect(g.getInstanceCount()).toBe(7);
      expect(g.instanceMatrix.length).toBe(7 * 16);
    });
  });

  describe('setInstanceMatrix / getInstanceMatrix', () => {
    it('writes and reads a mat4 correctly', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      const m = [
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
      ];
      g.setInstanceMatrix(1, m);
      const out = new Float32Array(16);
      g.getInstanceMatrix(1, out);
      for (let k = 0; k < 16; k++) {
        expect(out[k]).toBe(m[k]);
      }
    });

    it('allocates a new array when no out param', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setInstanceMatrix(0, new Array(16).fill(2));
      const out = g.getInstanceMatrix(0) as Float32Array;
      expect(out.length).toBe(16);
      for (let k = 0; k < 16; k++) expect(out[k]).toBe(2);
    });

    it('bumps instanceMatrixVersion on write', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      const v = g.instanceMatrixVersion;
      g.setInstanceMatrix(0, new Array(16).fill(0));
      expect(g.instanceMatrixVersion).toBeGreaterThan(v);
    });

    it('throws RangeError on out-of-bounds index', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      expect(() => g.setInstanceMatrix(-1, new Array(16))).toThrow(RangeError);
      expect(() => g.setInstanceMatrix(2, new Array(16))).toThrow(RangeError);
      expect(() => g.getInstanceMatrix(-1)).toThrow(RangeError);
      expect(() => g.getInstanceMatrix(5)).toThrow(RangeError);
    });

    it('throws RangeError when matrix length < 16', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      expect(() => g.setInstanceMatrix(0, [1, 2, 3])).toThrow(RangeError);
    });
  });

  describe('setInstanceColor / getInstanceColor', () => {
    it('lazily allocates instanceColor on first write', () => {
      const g = new InstancedGeometry();
      g.allocate(3);
      expect(g.instanceColor).toBeNull();
      g.setInstanceColor(1, 0.5, 0.25, 0.1, 0.9);
      expect(g.instanceColor).not.toBeNull();
      expect(g.instanceColor!.length).toBe(3 * 4);
    });

    it('writes RGBA at the correct offset', () => {
      const g = new InstancedGeometry();
      g.allocate(3);
      g.setInstanceColor(2, 0.1, 0.2, 0.3, 0.4);
      const off = 2 * 4;
      expect(g.instanceColor![off]).toBeCloseTo(0.1);
      expect(g.instanceColor![off + 1]).toBeCloseTo(0.2);
      expect(g.instanceColor![off + 2]).toBeCloseTo(0.3);
      expect(g.instanceColor![off + 3]).toBeCloseTo(0.4);
    });

    it('defaults alpha to 1 when omitted', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      g.setInstanceColor(0, 1, 0, 0);
      expect(g.instanceColor![3]).toBe(1);
    });

    it('returns white (1,1,1,1) when instanceColor is null', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      const out = g.getInstanceColor(0) as Float32Array;
      expect(out[0]).toBe(1);
      expect(out[1]).toBe(1);
      expect(out[2]).toBe(1);
      expect(out[3]).toBe(1);
    });

    it('bumps instanceColorVersion on write', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      const v = g.instanceColorVersion;
      g.setInstanceColor(0, 0, 0, 0);
      expect(g.instanceColorVersion).toBeGreaterThan(v);
    });

    it('throws RangeError on out-of-bounds index', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      expect(() => g.setInstanceColor(5, 0, 0, 0)).toThrow(RangeError);
      expect(() => g.getInstanceColor(-1)).toThrow(RangeError);
    });
  });

  describe('setCustomAttribute / getCustomAttribute', () => {
    it('infers itemSize from first write and allocates array', () => {
      const g = new InstancedGeometry();
      g.allocate(4);
      g.setCustomAttribute('a_offset', 0, [0.5, 0.5]);
      const buf = g.getCustomAttribute('a_offset');
      expect(buf).toBeDefined();
      expect(buf!.length).toBe(4 * 2); // count * itemSize
      // first instance data
      expect(buf![0]).toBe(0.5);
      expect(buf![1]).toBe(0.5);
      // other instances default 0
      expect(buf![2]).toBe(0);
    });

    it('writes at correct offset for subsequent instances', () => {
      const g = new InstancedGeometry();
      g.allocate(3);
      g.setCustomAttribute('a_id', 1, [42]);
      const buf = g.getCustomAttribute('a_id')!;
      expect(buf[1]).toBe(42); // index 1, itemSize 1 → offset 1
    });

    it('supports variable itemSize (1, 2, 3, 4)', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setCustomAttribute('a1', 0, [1]);
      g.setCustomAttribute('a2', 0, [1, 2]);
      g.setCustomAttribute('a3', 0, [1, 2, 3]);
      g.setCustomAttribute('a4', 0, [1, 2, 3, 4]);
      expect(g.getCustomAttributeSize('a1')).toBe(1);
      expect(g.getCustomAttributeSize('a2')).toBe(2);
      expect(g.getCustomAttributeSize('a3')).toBe(3);
      expect(g.getCustomAttributeSize('a4')).toBe(4);
    });

    it('throws on itemSize mismatch for existing attribute', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setCustomAttribute('a_x', 0, [1, 2]);
      expect(() => g.setCustomAttribute('a_x', 1, [1, 2, 3])).toThrow(Error);
    });

    it('throws on empty values array', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      expect(() => g.setCustomAttribute('a_empty', 0, [])).toThrow(Error);
    });

    it('throws RangeError on out-of-bounds index', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      expect(() => g.setCustomAttribute('a_x', 5, [1])).toThrow(RangeError);
    });

    it('getCustomAttributes lists all attribute names', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setCustomAttribute('a1', 0, [1]);
      g.setCustomAttribute('a2', 0, [1, 2]);
      const names = g.getCustomAttributes();
      expect(names).toContain('a1');
      expect(names).toContain('a2');
      expect(names.length).toBe(2);
    });

    it('deleteCustomAttribute removes the attribute', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setCustomAttribute('a_x', 0, [1]);
      g.deleteCustomAttribute('a_x');
      expect(g.getCustomAttribute('a_x')).toBeUndefined();
      expect(g.getCustomAttributes().length).toBe(0);
    });

    it('getCustomAttribute returns undefined for unknown name', () => {
      const g = new InstancedGeometry();
      expect(g.getCustomAttribute('nonexistent')).toBeUndefined();
      expect(g.getCustomAttributeSize('nonexistent')).toBeUndefined();
    });

    it('bumps version on write', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setCustomAttribute('a_x', 0, [1]);
      const v1 = g.customAttributeVersions.get('a_x') ?? 0;
      g.setCustomAttribute('a_x', 1, [2]);
      const v2 = g.customAttributeVersions.get('a_x') ?? 0;
      expect(v2).toBeGreaterThan(v1);
    });
  });

  describe('setIdentityInstance', () => {
    it('resets matrix to identity', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      g.setInstanceMatrix(0, new Array(16).fill(9));
      g.setIdentityInstance(0);
      const out = g.getInstanceMatrix(0) as Float32Array;
      expect(out[0]).toBe(1);
      expect(out[5]).toBe(1);
      expect(out[10]).toBe(1);
      expect(out[15]).toBe(1);
      expect(out[1]).toBe(0);
    });
  });

  describe('updateInstanceMatrix / updateInstanceColor', () => {
    it('updateInstanceMatrix bumps version', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      const v = g.instanceMatrixVersion;
      g.updateInstanceMatrix();
      expect(g.instanceMatrixVersion).toBe(v + 1);
    });

    it('updateInstanceColor is no-op when instanceColor is null', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      const v = g.instanceColorVersion;
      g.updateInstanceColor();
      expect(g.instanceColorVersion).toBe(v);
    });

    it('updateInstanceColor bumps version when instanceColor allocated', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      g.setInstanceColor(0, 1, 0, 0);
      const v = g.instanceColorVersion;
      g.updateInstanceColor();
      expect(g.instanceColorVersion).toBe(v + 1);
    });
  });

  describe('copy / clone', () => {
    it('copy duplicates all per-instance data', () => {
      const src = new InstancedGeometry();
      src.allocate(3);
      src.setInstanceMatrix(1, new Array(16).fill(7));
      src.setInstanceColor(0, 0.5, 0.5, 0.5, 1);
      src.setCustomAttribute('a_x', 0, [42]);

      const dst = new InstancedGeometry();
      dst.copy(src);
      expect(dst.instanceCount).toBe(3);
      // 矩阵
      const m = dst.getInstanceMatrix(1) as Float32Array;
      expect(m[0]).toBe(7);
      // 颜色
      const c = dst.getInstanceColor(0) as Float32Array;
      expect(c[0]).toBeCloseTo(0.5);
      // 自定义属性
      const buf = dst.getCustomAttribute('a_x')!;
      expect(buf[0]).toBe(42);
    });

    it('copy produces independent arrays (deep copy)', () => {
      const src = new InstancedGeometry();
      src.allocate(1);
      src.setInstanceMatrix(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const dst = new InstancedGeometry();
      dst.copy(src);
      // 修改 dst 不影响 src
      dst.instanceMatrix[0] = 99;
      expect(src.instanceMatrix[0]).toBe(1);
    });

    it('copy copies null instanceColor correctly', () => {
      const src = new InstancedGeometry();
      src.allocate(1);
      const dst = new InstancedGeometry();
      dst.copy(src);
      expect(dst.instanceColor).toBeNull();
    });

    it('clone returns independent instance with same data', () => {
      const src = new InstancedGeometry();
      src.allocate(2);
      src.setInstanceMatrix(0, new Array(16).fill(3));
      const c = src.clone();
      expect(c).not.toBe(src);
      expect(c.instanceCount).toBe(2);
      expect(c.instanceMatrix).not.toBe(src.instanceMatrix);
      const m = c.getInstanceMatrix(0) as Float32Array;
      expect(m[0]).toBe(3);
    });
  });

  describe('toJSON', () => {
    it('serializes instanceCount and instanceMatrix', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      const json = g.toJSON() as Record<string, unknown>;
      expect(json.instanceCount).toBe(2);
      expect(Array.isArray(json.instanceMatrix)).toBe(true);
      expect((json.instanceMatrix as number[]).length).toBe(2 * 16);
      expect(json.isInstancedGeometry).toBe(true);
    });

    it('includes instanceColor when set', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      g.setInstanceColor(0, 0.5, 0.5, 0.5, 1);
      const json = g.toJSON() as Record<string, unknown>;
      expect(json.instanceColor).toBeDefined();
      expect(Array.isArray(json.instanceColor)).toBe(true);
    });

    it('omits instanceColor when null', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      const json = g.toJSON() as Record<string, unknown>;
      expect(json.instanceColor).toBeUndefined();
    });

    it('includes customAttributes when present', () => {
      const g = new InstancedGeometry();
      g.allocate(2);
      g.setCustomAttribute('a_x', 0, [42]);
      const json = g.toJSON() as Record<string, unknown>;
      const customs = json.customAttributes as Record<string, { itemSize: number; array: number[] }>;
      expect(customs).toBeDefined();
      expect(customs.a_x.itemSize).toBe(1);
      expect(customs.a_x.array[0]).toBe(42);
    });
  });

  describe('dispose', () => {
    it('clears all per-instance data', () => {
      const g = new InstancedGeometry();
      g.allocate(3);
      g.setInstanceColor(0, 1, 0, 0, 1);
      g.setCustomAttribute('a_x', 0, [1]);
      g.dispose();
      expect(g.instanceCount).toBe(0);
      expect(g.instanceMatrix.length).toBe(0);
      expect(g.instanceColor).toBeNull();
      expect(g.customAttributes.size).toBe(0);
    });

    it('bumps versions on dispose', () => {
      const g = new InstancedGeometry();
      g.allocate(1);
      const vm = g.instanceMatrixVersion;
      g.dispose();
      expect(g.instanceMatrixVersion).toBeGreaterThan(vm);
    });
  });
});
