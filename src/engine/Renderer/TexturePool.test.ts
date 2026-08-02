// TexturePool 单元测试。
//
// 验证:
//   1. 构造器默认值与自定义选项
//   2. allocate / free 槽位管理
//   3. update 写入数据到正确层
//   4. 池满时 allocate 返回 -1
//   5. clear 释放所有槽位
//   6. getStats 返回正确统计
//   7. 版本号递增
//   8. DataArrayTexture 集成(layerUpdates + version)

import { describe, it, expect } from 'vitest';
import { TexturePool } from './TexturePool';

describe('TexturePool: construction', () => {
  it('creates with default values', () => {
    const pool = new TexturePool();
    expect(pool.capacity).toBe(512);
    expect(pool.width).toBe(1024);
    expect(pool.height).toBe(1024);
    expect(pool.format).toBe('rgba');
    expect(pool.type).toBe('unsigned-byte');
    expect(pool.allocatedCount).toBe(0);
    expect(pool.freeCount).toBe(512);
  });

  it('accepts custom options', () => {
    const pool = new TexturePool({
      capacity: 64,
      width: 256,
      height: 256,
      format: 'rgb',
      type: 'float',
      generateMipmaps: true,
      colorSpace: 'linear',
    });
    expect(pool.capacity).toBe(64);
    expect(pool.width).toBe(256);
    expect(pool.height).toBe(256);
    expect(pool.format).toBe('rgb');
    expect(pool.type).toBe('float');
    expect(pool.arrayTexture.generateMipmaps).toBe(true);
    expect(pool.arrayTexture.colorSpace).toBe('linear');
  });

  it('clamps capacity to minimum 1', () => {
    const pool = new TexturePool({ capacity: 0 });
    expect(pool.capacity).toBe(1);
  });

  it('creates DataArrayTexture with correct dimensions', () => {
    const pool = new TexturePool({ capacity: 8, width: 32, height: 32 });
    expect(pool.arrayTexture.width).toBe(32);
    expect(pool.arrayTexture.height).toBe(32);
    expect(pool.arrayTexture.depth).toBe(8);
    expect(pool.arrayTexture.data).not.toBeNull();
  });
});

describe('TexturePool: allocate / free', () => {
  it('allocate returns slot indices 0, 1, 2, ...', () => {
    const pool = new TexturePool({ capacity: 4, width: 8, height: 8 });
    expect(pool.allocate()).toBe(0);
    expect(pool.allocate()).toBe(1);
    expect(pool.allocate()).toBe(2);
    expect(pool.allocatedCount).toBe(3);
    expect(pool.freeCount).toBe(1);
  });

  it('allocate with label', () => {
    const pool = new TexturePool({ capacity: 4, width: 8, height: 8 });
    const slot = pool.allocate('diffuse-texture');
    expect(pool.getSlotLabel(slot)).toBe('diffuse-texture');
  });

  it('free releases slot and allows re-allocation', () => {
    const pool = new TexturePool({ capacity: 2, width: 8, height: 8 });
    const s0 = pool.allocate('a');
    const s1 = pool.allocate('b');
    expect(pool.allocatedCount).toBe(2);
    pool.free(s0);
    expect(pool.allocatedCount).toBe(1);
    expect(pool.isAllocated(s0)).toBe(false);
    expect(pool.isAllocated(s1)).toBe(true);
    // 重新分配应复用 s0
    const s2 = pool.allocate('c');
    expect(s2).toBe(s0);
    expect(pool.getSlotLabel(s2)).toBe('c');
  });

  it('returns -1 when pool is full', () => {
    const pool = new TexturePool({ capacity: 2, width: 8, height: 8 });
    pool.allocate();
    pool.allocate();
    expect(pool.allocate()).toBe(-1);
    expect(pool.allocatedCount).toBe(2);
  });

  it('free on already-free slot is no-op', () => {
    const pool = new TexturePool({ capacity: 4, width: 8, height: 8 });
    pool.free(0); // 未分配,应无效果
    expect(pool.allocatedCount).toBe(0);
  });

  it('free on out-of-range slot is no-op', () => {
    const pool = new TexturePool({ capacity: 4, width: 8, height: 8 });
    pool.free(-1);
    pool.free(99);
    expect(pool.allocatedCount).toBe(0);
  });
});

describe('TexturePool: update', () => {
  it('writes texture data to the correct layer offset', () => {
    const pool = new TexturePool({ capacity: 4, width: 2, height: 2, format: 'rgba' });
    const slot = pool.allocate('test');
    // 2×2 RGBA = 16 bytes
    const data = new Uint8Array([
      255, 0, 0, 255,    0, 255, 0, 255,
      0, 0, 255, 255,   255, 255, 0, 255,
    ]);
    pool.update(slot, data);

    // 验证数据写入到 arrayTexture 的正确位置
    const arr = pool.arrayTexture.data as Uint8Array;
    const layerSize = 2 * 2 * 4; // 16
    const offset = slot * layerSize;
    expect(arr[offset]).toBe(255);
    expect(arr[offset + 1]).toBe(0);
    expect(arr[offset + 2]).toBe(0);
    expect(arr[offset + 3]).toBe(255);
    expect(arr[offset + 4]).toBe(0);
    expect(arr[offset + 5]).toBe(255);
    expect(arr[offset + 15]).toBe(255);
  });

  it('marks layerUpdates and bumps version', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    const slot = pool.allocate();
    const v0 = pool.arrayTexture.version;
    pool.update(slot, new Uint8Array(4 * 4 * 4));
    expect(pool.arrayTexture.layerUpdates.has(slot)).toBe(true);
    expect(pool.arrayTexture.version).toBeGreaterThan(v0);
  });

  it('throws on out-of-range slot', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    expect(() => pool.update(99, new Uint8Array(64))).toThrow(/out of range/);
    expect(() => pool.update(-1, new Uint8Array(64))).toThrow(/out of range/);
  });

  it('throws on unallocated slot', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    expect(() => pool.update(0, new Uint8Array(64))).toThrow(/not allocated/);
  });

  it('supports float textures', () => {
    const pool = new TexturePool({
      capacity: 2, width: 2, height: 2,
      format: 'r', type: 'float',
    });
    const slot = pool.allocate('heightmap');
    const data = new Float32Array([1.5, 2.5, 3.5, 4.5]);
    pool.update(slot, data);
    const arr = pool.arrayTexture.data as Float32Array;
    const offset = slot * 4;
    expect(arr[offset]).toBeCloseTo(1.5);
    expect(arr[offset + 3]).toBeCloseTo(4.5);
  });
});

describe('TexturePool: version tracking', () => {
  it('version increments on allocate', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    const v0 = pool.getSlotVersion(0);
    pool.allocate();
    expect(pool.getSlotVersion(0)).toBeGreaterThan(v0);
  });

  it('version increments on update', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    const slot = pool.allocate();
    const v0 = pool.getSlotVersion(slot);
    pool.update(slot, new Uint8Array(4 * 4 * 4));
    expect(pool.getSlotVersion(slot)).toBeGreaterThan(v0);
  });

  it('getSlotVersion returns -1 for invalid slot', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    expect(pool.getSlotVersion(-1)).toBe(-1);
    expect(pool.getSlotVersion(99)).toBe(-1);
  });
});

describe('TexturePool: clear', () => {
  it('frees all slots', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    pool.allocate('a');
    pool.allocate('b');
    pool.allocate('c');
    expect(pool.allocatedCount).toBe(3);
    pool.clear();
    expect(pool.allocatedCount).toBe(0);
    expect(pool.freeCount).toBe(4);
    // 可以重新分配
    expect(pool.allocate()).toBe(0);
  });
});

describe('TexturePool: getStats', () => {
  it('returns correct statistics', () => {
    const pool = new TexturePool({
      capacity: 16, width: 64, height: 64,
      format: 'rg', type: 'half-float',
    });
    pool.allocate('a');
    pool.allocate('b');
    const stats = pool.getStats();
    expect(stats.capacity).toBe(16);
    expect(stats.allocated).toBe(2);
    expect(stats.free).toBe(14);
    expect(stats.width).toBe(64);
    expect(stats.height).toBe(64);
    expect(stats.format).toBe('rg');
    expect(stats.type).toBe('half-float');
  });
});

describe('TexturePool: isAllocated', () => {
  it('returns true for allocated slots', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    const slot = pool.allocate();
    expect(pool.isAllocated(slot)).toBe(true);
    expect(pool.isAllocated(slot + 1)).toBe(false);
  });

  it('returns false for invalid slots', () => {
    const pool = new TexturePool({ capacity: 4, width: 4, height: 4 });
    expect(pool.isAllocated(-1)).toBe(false);
    expect(pool.isAllocated(99)).toBe(false);
  });
});

describe('TexturePool: multiple layers independence', () => {
  it('updating slot 1 does not affect slot 0', () => {
    const pool = new TexturePool({ capacity: 4, width: 2, height: 2, format: 'rgba' });
    const s0 = pool.allocate('first');
    const s1 = pool.allocate('second');

    // 写入 slot 0
    pool.update(s0, new Uint8Array([
      10, 20, 30, 40,  50, 60, 70, 80,
      90, 100, 110, 120,  130, 140, 150, 160,
    ]));

    // 写入 slot 1
    pool.update(s1, new Uint8Array([
      1, 2, 3, 4,  5, 6, 7, 8,
      9, 10, 11, 12,  13, 14, 15, 16,
    ]));

    const arr = pool.arrayTexture.data as Uint8Array;
    const layerSize = 16;

    // slot 0 数据未被 slot 1 覆盖
    expect(arr[s0 * layerSize]).toBe(10);
    expect(arr[s0 * layerSize + 15]).toBe(160);

    // slot 1 数据正确
    expect(arr[s1 * layerSize]).toBe(1);
    expect(arr[s1 * layerSize + 15]).toBe(16);
  });
});
