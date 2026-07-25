// VoxelWorld 单元测试。

import { describe, it, expect } from 'vitest';
import { VoxelWorld } from './VoxelWorld';
import { VoxelChunk } from './VoxelChunk';
import { Vector3 } from '../Math/Vector3';
import { VoxelPalette } from './VoxelPalette';

describe('VoxelWorld', () => {
  it('默认构造', () => {
    const w = new VoxelWorld();
    expect(w.chunkSize).toBe(16);
    expect(w.worldSize).toBe(4);
    expect(w.maxHeight).toBe(16);
    expect(w.chunks.size).toBe(0);
  });

  it('getVoxel 越界（y<0 / y>=maxHeight）返回 0', () => {
    const w = new VoxelWorld(16, 1, 16);
    expect(w.getVoxel(0, -1, 0)).toBe(0);
    expect(w.getVoxel(0, 16, 0)).toBe(0);
  });

  it('setVoxel 自动创建 chunk', () => {
    const w = new VoxelWorld(16, 2, 16);
    w.setVoxel(0, 0, 0, 1);
    expect(w.chunks.size).toBe(1);
    expect(w.getVoxel(0, 0, 0)).toBe(1);
  });

  it('setVoxel 跨 chunk 写入', () => {
    const w = new VoxelWorld(16, 2, 32);
    w.setVoxel(0, 0, 0, 1);
    w.setVoxel(16, 0, 0, 2); // 下一个 chunk
    w.setVoxel(0, 0, 16, 3); // 下一个 chunk (z 方向)
    expect(w.getVoxel(0, 0, 0)).toBe(1);
    expect(w.getVoxel(16, 0, 0)).toBe(2);
    expect(w.getVoxel(0, 0, 16)).toBe(3);
    expect(w.chunks.size).toBe(3);
  });

  it('getChunk 返回地面层 chunk', () => {
    const w = new VoxelWorld(16, 2, 16);
    w.setVoxel(0, 0, 0, 1);
    const c = w.getChunk(0, 0);
    expect(c).not.toBeNull();
    expect(c!.get(0, 0, 0)).toBe(1);
    // 不存在的 chunk
    expect(w.getChunk(5, 5)).toBeNull();
  });

  it('getChunk3D / getOrCreateChunk', () => {
    const w = new VoxelWorld(16, 1, 32);
    const c = w.getOrCreateChunk(0, 0, 1);
    expect(c).toBeInstanceOf(VoxelChunk);
    expect(c.position.z).toBe(16);
    // 二次获取同一对象
    expect(w.getOrCreateChunk(0, 0, 1)).toBe(c);
    expect(w.getChunk3D(0, 0, 1)).toBe(c);
  });

  it('getVoxelInWorld 实现跨块邻居查询', () => {
    const w = new VoxelWorld(16, 1, 32);
    // chunk (0,0,0) 原点 (0,0,0)，在它的边界外（localX=16）查相邻 chunk
    w.setVoxel(16, 0, 0, 7); // 相邻 chunk 的 (0,0,0)
    const id = w.getVoxelInWorld(16, 0, 0, 0, 0, 0);
    expect(id).toBe(7);
    // 块内查询
    w.setVoxel(5, 0, 5, 3);
    expect(w.getVoxelInWorld(5, 0, 5, 0, 0, 0)).toBe(3);
  });

  it('generateTerrain 从高度图生成地形', () => {
    const w = new VoxelWorld(4, 1, 16); // 4*4=16 体素宽
    // 构造 16x16 高度图，全部高 3
    const hm: number[][] = [];
    for (let x = 0; x < 16; x++) {
      hm[x] = [];
      for (let z = 0; z < 16; z++) {
        hm[x][z] = 3;
      }
    }
    w.generateTerrain(hm);
    // 顶层 (y=2) 应是 grass (id=2)
    expect(w.getVoxel(0, 2, 0)).toBe(2);
    // 中层 (y=1) 应是 dirt (id=3)
    expect(w.getVoxel(0, 1, 0)).toBe(3);
    // 底层 (y=0) 应是 stone (id=1)
    expect(w.getVoxel(0, 0, 0)).toBe(1);
    // y=3 应是空气
    expect(w.getVoxel(0, 3, 0)).toBe(0);
  });

  it('generateTerrain 自定义 id', () => {
    const w = new VoxelWorld(2, 1, 8);
    const hm: number[][] = [];
    for (let x = 0; x < 8; x++) {
      hm[x] = [];
      for (let z = 0; z < 8; z++) hm[x][z] = 3;
    }
    w.generateTerrain(hm, 10, 11, 12);
    // height=3：顶层 grass(10)、中层 dirt(11)、底层 stone(12)
    expect(w.getVoxel(0, 2, 0)).toBe(10);
    expect(w.getVoxel(0, 1, 0)).toBe(11);
    expect(w.getVoxel(0, 0, 0)).toBe(12);
  });

  it('updateDirtyChunks 重建网格并清 dirty', () => {
    const w = new VoxelWorld(16, 1, 16);
    w.setVoxel(0, 0, 0, 1);
    w.setVoxel(1, 0, 0, 1);
    // 所有 chunk 应该是 dirty
    let dirtyCount = 0;
    for (const c of w.chunks.values()) if (c.isDirty()) dirtyCount++;
    expect(dirtyCount).toBe(1);

    const rebuilt = w.updateDirtyChunks();
    expect(rebuilt).toBe(1);

    // 重建后应清 dirty
    for (const c of w.chunks.values()) {
      expect(c.isDirty()).toBe(false);
    }
  });

  it('updateDirtyChunks 仅重建脏块', () => {
    const w = new VoxelWorld(16, 1, 16);
    w.setVoxel(0, 0, 0, 1);
    w.updateDirtyChunks(); // 全部清 dirty
    const rebuilt1 = w.updateDirtyChunks();
    expect(rebuilt1).toBe(0);

    w.setVoxel(1, 0, 0, 1);
    const rebuilt2 = w.updateDirtyChunks();
    expect(rebuilt2).toBe(1);
  });

  it('getStats 返回块数/体素数/三角面数', () => {
    const w = new VoxelWorld(16, 1, 16);
    w.setVoxel(0, 0, 0, 1);
    w.setVoxel(1, 0, 0, 1);
    w.updateDirtyChunks();
    const stats = w.getStats();
    expect(stats.chunkCount).toBe(1);
    expect(stats.voxelCount).toBe(2);
    expect(stats.triangleCount).toBeGreaterThan(0);
    expect(stats.dirtyChunkCount).toBe(0);
  });

  it('raycast 便捷封装命中', () => {
    const w = new VoxelWorld(16, 1, 16);
    w.setVoxel(0, 0, 0, 1);
    const hit = w.raycast(
      new Vector3(0.5, 5, 0.5),
      new Vector3(0, -1, 0),
      100,
    );
    expect(hit.hit).toBe(true);
    expect(hit.voxel.y).toBe(0);
  });

  it('可注入自定义 palette', () => {
    const palette = new VoxelPalette();
    palette.register({ id: 50, name: 'custom', color: [0.1, 0.2, 0.3], transparent: false, solid: true });
    const w = new VoxelWorld(16, 1, 16, palette);
    w.setVoxel(0, 0, 0, 50);
    // 通过 raycast 验证 solid 判定使用注入的 palette
    const hit = w.raycast(new Vector3(0.5, 5, 0.5), new Vector3(0, -1, 0), 100);
    expect(hit.hit).toBe(true);
    expect(hit.voxelId).toBe(50);
  });
});
