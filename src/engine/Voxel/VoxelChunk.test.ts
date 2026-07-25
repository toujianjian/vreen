// VoxelChunk 单元测试。

import { describe, it, expect } from 'vitest';
import { VoxelChunk } from './VoxelChunk';
import { Vector3 } from '../Math/Vector3';
import { VoxelPalette } from './VoxelPalette';

describe('VoxelChunk', () => {
  it('默认构造 16³ 块，全空气，dirty=true', () => {
    const c = new VoxelChunk();
    expect(c.size).toBe(16);
    expect(c.voxels.length).toBe(16 * 16 * 16);
    expect(c.getVoxelCount()).toBe(0);
    expect(c.isDirty()).toBe(true);
    expect(c.position.equals(new Vector3(0, 0, 0))).toBe(true);
  });

  it('自定义 position 与 size', () => {
    const c = new VoxelChunk(new Vector3(32, 0, 16), 8);
    expect(c.size).toBe(8);
    expect(c.voxels.length).toBe(8 * 8 * 8);
    expect(c.position.x).toBe(32);
    expect(c.position.z).toBe(16);
  });

  it('index 顺序：idx = x + size*(z + size*y)', () => {
    const c = new VoxelChunk(new Vector3(0, 0, 0), 4);
    expect(c.index(0, 0, 0)).toBe(0);
    expect(c.index(1, 0, 0)).toBe(1);
    expect(c.index(0, 0, 1)).toBe(4);
    expect(c.index(0, 1, 0)).toBe(16);
    // y=1, z=1, x=1 → 1 + 4*(1 + 4*1) = 1 + 20 = 21
    expect(c.index(1, 1, 1)).toBe(21);
  });

  it('get/set 体素 + dirty 标记', () => {
    const c = new VoxelChunk();
    c.clearDirty();
    expect(c.isDirty()).toBe(false);

    c.set(0, 0, 0, 1);
    expect(c.get(0, 0, 0)).toBe(1);
    expect(c.isDirty()).toBe(true);

    // 同值不再触发 dirty
    c.clearDirty();
    c.set(0, 0, 0, 1);
    expect(c.isDirty()).toBe(false);
  });

  it('越界 get 返回 0，越界 set 忽略', () => {
    const c = new VoxelChunk(new Vector3(0, 0, 0), 4);
    expect(c.get(-1, 0, 0)).toBe(0);
    expect(c.get(4, 0, 0)).toBe(0);
    expect(c.get(0, 4, 0)).toBe(0);
    c.set(-1, 0, 0, 1);
    c.set(4, 0, 0, 1);
    expect(c.getVoxelCount()).toBe(0);
  });

  it('clear 清空所有体素并标记 dirty', () => {
    const c = new VoxelChunk();
    c.set(0, 0, 0, 1);
    c.set(1, 1, 1, 2);
    expect(c.getVoxelCount()).toBe(2);
    c.clearDirty();

    c.clear();
    expect(c.getVoxelCount()).toBe(0);
    expect(c.get(0, 0, 0)).toBe(0);
    expect(c.isDirty()).toBe(true);
  });

  it('getVoxelCount 统计非空气', () => {
    const c = new VoxelChunk();
    c.set(0, 0, 0, 1);
    c.set(1, 0, 0, 2);
    c.set(2, 0, 0, 0); // 空气不计
    c.set(3, 0, 0, 3);
    expect(c.getVoxelCount()).toBe(3);
  });

  it('markDirty / clearDirty', () => {
    const c = new VoxelChunk();
    c.clearDirty();
    expect(c.isDirty()).toBe(false);
    c.markDirty();
    expect(c.isDirty()).toBe(true);
    c.clearDirty();
    expect(c.isDirty()).toBe(false);
  });

  it('toMeshData：单个孤立体素生成 6 面 12 三角', () => {
    const c = new VoxelChunk();
    c.clear();
    c.set(0, 0, 0, 1); // stone
    const mesh = c.toMeshData();
    // 孤立立方体：6 个可见面，每面 2 三角 = 12 三角，24 顶点
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.positions.length / 3).toBe(24);
    expect(mesh.indices.length).toBe(36);
  });

  it('toMeshData：两个相邻 solid 体素剔除内部面', () => {
    const c = new VoxelChunk();
    c.clear();
    c.set(0, 0, 0, 1);
    c.set(1, 0, 0, 1);
    const mesh = c.toMeshData();
    // 两个立方体相邻：12 面 - 2 内部面 = 10 面 = 20 三角
    expect(mesh.triangleCount).toBe(20);
  });

  it('toMeshData：顶点位置使用世界坐标（含 position 偏移）', () => {
    const c = new VoxelChunk(new Vector3(16, 0, 0));
    c.clear();
    c.set(0, 0, 0, 1);
    const mesh = c.toMeshData();
    // 第一个顶点应在 (16, 0, 0) 附近（+X 面的 v0 = (1,0,0) → 16+1=17? 不，
    // +X 面 corners[0]=[1,0,0]，所以第一个面（+X）顶点 x=16+0+1=17）
    // 我们只校验最小坐标是 16（块原点）。
    let minX = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i] < minX) minX = mesh.positions[i];
    }
    expect(minX).toBe(16);
  });

  it('toMeshData：透明体素与同种透明体素不生成内部分界面', () => {
    const palette = new VoxelPalette();
    palette.register({ id: 6, name: 'water', color: [0.2, 0.4, 0.9], transparent: true, solid: false });
    const c = new VoxelChunk();
    c.clear();
    c.set(0, 0, 0, 6);
    c.set(1, 0, 0, 6);
    const mesh = c.toMeshData(palette);
    // 两个相邻水块：内部 +X 面（水-水）应剔除 → 10 面 20 三角
    expect(mesh.triangleCount).toBe(20);
  });

  it('toMeshData：颜色从调色板查询', () => {
    const palette = new VoxelPalette();
    palette.register({ id: 5, name: 'red', color: [1, 0, 0], transparent: false, solid: true });
    const c = new VoxelChunk();
    c.clear();
    c.set(0, 0, 0, 5);
    const mesh = c.toMeshData(palette);
    expect(mesh.colors[0]).toBe(1);
    expect(mesh.colors[1]).toBe(0);
    expect(mesh.colors[2]).toBe(0);
  });

  it('toMeshData 使用 defaultPalette', () => {
    const c = new VoxelChunk();
    c.clear();
    c.set(0, 0, 0, 1); // defaultPalette 中 stone = [0.5,0.5,0.5]
    const mesh = c.toMeshData();
    expect(mesh.colors[0]).toBeCloseTo(0.5);
  });
});
