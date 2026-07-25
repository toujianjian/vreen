// VoxelPalette 单元测试。

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelPalette, AIR_VOXEL, defaultPalette } from './VoxelPalette';

describe('VoxelPalette', () => {
  let palette: VoxelPalette;

  beforeEach(() => {
    palette = new VoxelPalette();
  });

  it('构造时 AIR (id=0) 已注册', () => {
    const air = palette.get(0);
    expect(air.id).toBe(0);
    expect(air.name).toBe('air');
    expect(air.solid).toBe(false);
    expect(air.transparent).toBe(true);
    expect(AIR_VOXEL.id).toBe(0);
  });

  it('register / get 注册并查询类型', () => {
    palette.register({
      id: 10,
      name: 'custom',
      color: [0.1, 0.2, 0.3],
      transparent: false,
      solid: true,
    });
    const t = palette.get(10);
    expect(t.id).toBe(10);
    expect(t.name).toBe('custom');
    expect(t.color).toEqual([0.1, 0.2, 0.3]);
  });

  it('未注册的 id 返回 AIR', () => {
    const t = palette.get(99);
    expect(t.id).toBe(0);
    expect(t.solid).toBe(false);
  });

  it('register 拒绝越界 id', () => {
    expect(() => palette.register({ id: -1, name: 'x', color: [0, 0, 0], transparent: false, solid: false }))
      .toThrow(RangeError);
    expect(() => palette.register({ id: 256, name: 'x', color: [0, 0, 0], transparent: false, solid: false }))
      .toThrow(RangeError);
  });

  it('getColor / isTransparent / isSolid', () => {
    palette.register({ id: 5, name: 'water', color: [0.2, 0.4, 0.9], transparent: true, solid: false });
    palette.register({ id: 6, name: 'stone', color: [0.5, 0.5, 0.5], transparent: false, solid: true });

    expect(palette.getColor(5)).toEqual([0.2, 0.4, 0.9]);
    expect(palette.isTransparent(5)).toBe(true);
    expect(palette.isSolid(5)).toBe(false);

    expect(palette.isTransparent(6)).toBe(false);
    expect(palette.isSolid(6)).toBe(true);

    // 未注册：保守判定
    expect(palette.isTransparent(99)).toBe(false);
    expect(palette.isSolid(99)).toBe(false);
  });

  it('register 覆盖同 id', () => {
    palette.register({ id: 1, name: 'a', color: [1, 0, 0], transparent: false, solid: true });
    palette.register({ id: 1, name: 'b', color: [0, 1, 0], transparent: true, solid: false });
    expect(palette.get(1).name).toBe('b');
    expect(palette.isSolid(1)).toBe(false);
  });

  it('has / list / clear', () => {
    palette.register({ id: 1, name: 'a', color: [1, 0, 0], transparent: false, solid: true });
    palette.register({ id: 2, name: 'b', color: [0, 1, 0], transparent: false, solid: true });
    expect(palette.has(1)).toBe(true);
    expect(palette.has(99)).toBe(false);
    expect(palette.list().length).toBe(3); // AIR + 1 + 2

    palette.clear();
    expect(palette.has(1)).toBe(false);
    expect(palette.has(0)).toBe(true); // AIR 保留
    expect(palette.list().length).toBe(1);
  });

  it('defaultPalette 预置常见类型', () => {
    expect(defaultPalette.has(1)).toBe(true); // stone
    expect(defaultPalette.has(2)).toBe(true); // grass
    expect(defaultPalette.has(6)).toBe(true); // water
    expect(defaultPalette.isSolid(6)).toBe(false); // 水非固体
    expect(defaultPalette.isTransparent(6)).toBe(true);
    expect(defaultPalette.isSolid(7)).toBe(true); // glass 固体
  });
});
