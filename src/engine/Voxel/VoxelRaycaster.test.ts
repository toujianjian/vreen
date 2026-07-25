// VoxelRaycaster 单元测试。

import { describe, it, expect } from 'vitest';
import { VoxelRaycaster } from './VoxelRaycaster';
import { VoxelWorld } from './VoxelWorld';
import { Vector3 } from '../Math/Vector3';

describe('VoxelRaycaster', () => {
  it('默认构造 + set 链式调用', () => {
    const r = new VoxelRaycaster();
    expect(r.maxDistance).toBe(100);
    const ret = r.set(new Vector3(0, 5, 0), new Vector3(0, -1, 0), 50);
    expect(ret).toBe(r);
    expect(r.maxDistance).toBe(50);
    expect(r.origin.y).toBe(5);
    // direction 归一化
    expect(r.direction.length()).toBeCloseTo(1);
  });

  it('cast：向下射线命中地面体素', () => {
    const world = new VoxelWorld(16, 1, 16);
    // 在 (0,0,0) 体素放一块 stone
    world.setVoxel(0, 0, 0, 1);
    // 从 (0.5, 5, 0.5) 向下射
    const r = new VoxelRaycaster(
      new Vector3(0.5, 5, 0.5),
      new Vector3(0, -1, 0),
      100,
    );
    r.cast(world);
    const hit = r.getHit();
    expect(hit.hit).toBe(true);
    expect(hit.voxel.x).toBe(0);
    expect(hit.voxel.y).toBe(0);
    expect(hit.voxel.z).toBe(0);
    expect(hit.voxelId).toBe(1);
    expect(hit.normal.y).toBe(1); // 命中 +Y 面，法线指向射线源（+Y）
    expect(hit.distance).toBeCloseTo(4, 1);
  });

  it('cast：未命中返回 hit=false', () => {
    const world = new VoxelWorld(16, 1, 16);
    // 空世界
    const r = new VoxelRaycaster(
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      5,
    );
    r.cast(world);
    const hit = r.getHit();
    expect(hit.hit).toBe(false);
    expect(hit.voxelId).toBe(0);
  });

  it('cast：+X 方向命中 -X 面（法线 -X）', () => {
    const world = new VoxelWorld(16, 1, 16);
    world.setVoxel(3, 0, 0, 1);
    const r = new VoxelRaycaster(
      new Vector3(0, 0.5, 0.5),
      new Vector3(1, 0, 0),
      100,
    );
    r.cast(world);
    const hit = r.getHit();
    expect(hit.hit).toBe(true);
    expect(hit.voxel.x).toBe(3);
    expect(hit.normal.x).toBe(-1); // 命中 -X 面
    expect(hit.point.x).toBeCloseTo(3, 5);
  });

  it('cast：origin 已在 solid 体素内立即命中', () => {
    const world = new VoxelWorld(16, 1, 16);
    world.setVoxel(0, 0, 0, 1);
    const r = new VoxelRaycaster(
      new Vector3(0.5, 0.5, 0.5),
      new Vector3(0, 1, 0),
      10,
    );
    r.cast(world);
    const hit = r.getHit();
    expect(hit.hit).toBe(true);
    expect(hit.distance).toBe(0);
  });

  it('cast：maxDistance 限制射程', () => {
    const world = new VoxelWorld(16, 1, 16);
    world.setVoxel(10, 0, 0, 1);
    const r = new VoxelRaycaster(
      new Vector3(0, 0.5, 0.5),
      new Vector3(1, 0, 0),
      5, // 距离 10 > 5
    );
    r.cast(world);
    expect(r.getHit().hit).toBe(false);
  });

  it('getNormal 默认 target 返回副本', () => {
    const r = new VoxelRaycaster();
    const n = r.getNormal();
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    expect(n.z).toBe(0);
  });

  it('cast：斜向射线（45°）命中', () => {
    const world = new VoxelWorld(16, 1, 16);
    world.setVoxel(2, 0, 2, 1);
    // 从 (0,0.5,0) 朝 (1,0,1) 方向射（45° 在 XZ 平面）
    const r = new VoxelRaycaster(
      new Vector3(0.5, 0.5, 0.5),
      new Vector3(1, 0, 1),
      50,
    );
    r.cast(world);
    const hit = r.getHit();
    expect(hit.hit).toBe(true);
    // 应命中 (2,0,2) 的某个面
    expect(hit.voxel.x).toBe(2);
    expect(hit.voxel.z).toBe(2);
  });

  it('cast：跳过非 solid 体素（水）', () => {
    const world = new VoxelWorld(16, 1, 16);
    world.setVoxel(0, 0, 0, 6); // water（非 solid）
    world.setVoxel(0, 1, 0, 1); // stone（在 y=1）
    const r = new VoxelRaycaster(
      new Vector3(0.5, 5, 0.5),
      new Vector3(0, -1, 0),
      100,
    );
    r.cast(world);
    const hit = r.getHit();
    expect(hit.hit).toBe(true);
    expect(hit.voxel.y).toBe(1); // 跳过 y=0 的水，命中 y=1 的 stone
  });
});
