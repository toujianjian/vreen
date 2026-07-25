// VoxelRaycaster — 体素 DDA 射线检测（Amanatides & Woo 算法）。
//
// 给定起点 origin + 单位方向 direction + 最大距离 maxDistance，逐步穿越
// 体素网格，命中第一个 solid 体素即返回。
//
// 与 VoxelWorld.raycast 的关系：VoxelRaycaster 是无状态查询器（一次构造
// 一次 cast），VoxelWorld.raycast 是便捷封装，内部 new VoxelRaycaster 调用。
//
// 法线计算：DDA 每次跨过某轴的体素边界，那个轴方向（带 step 符号）就是
// 命中面的法线（朝向射线源）。
//
// 注意：direction 不需要归一化（构造时强制归一化），但 maxDistance 是
// 世界单位长度。

import { Vector3 } from '../Math/Vector3';
import { defaultPalette, type VoxelPalette } from './VoxelPalette';
import type { VoxelWorld } from './VoxelWorld';

export interface VoxelRayHit {
  /** 是否命中。 */
  hit: boolean;
  /** 命中体素的世界坐标（体素单元，整数）。未命中时为 (0,0,0)。 */
  voxel: Vector3;
  /** 命中体素的 id。未命中时为 0。 */
  voxelId: number;
  /** 命中点世界坐标（射线交点）。 */
  point: Vector3;
  /** 命中面法线（指向射线源方向）。 */
  normal: Vector3;
  /** 射线行进距离。 */
  distance: number;
}

/** 空命中结果。 */
function emptyHit(): VoxelRayHit {
  return {
    hit: false,
    voxel: new Vector3(0, 0, 0),
    voxelId: 0,
    point: new Vector3(0, 0, 0),
    normal: new Vector3(0, 0, 0),
    distance: 0,
  };
}

export class VoxelRaycaster {
  origin: Vector3;
  direction: Vector3;
  maxDistance: number;

  private _hit: VoxelRayHit = emptyHit();

  constructor(
    origin: Vector3 = new Vector3(0, 0, 0),
    direction: Vector3 = new Vector3(0, 0, -1),
    maxDistance: number = 100,
  ) {
    this.origin = origin.clone();
    this.direction = direction.clone().normalize();
    this.maxDistance = maxDistance;
  }

  /** 设置射线参数。 */
  set(origin: Vector3, direction: Vector3, maxDistance: number = this.maxDistance): this {
    this.origin.copy(origin);
    this.direction.copy(direction).normalize();
    this.maxDistance = maxDistance;
    return this;
  }

  /**
   * 执行 DDA 射线检测。
   * @param world 体素世界（提供 getVoxel 查询）。
   * @param palette 调色板（用于判定 solid；默认 defaultPalette）。
   * @returns this，便于链式调用 getHit() / getNormal()。
   */
  cast(world: VoxelWorld, palette: VoxelPalette = defaultPalette): this {
    const hit = emptyHit();
    this._hit = hit;

    const ox = this.origin.x;
    const oy = this.origin.y;
    const oz = this.origin.z;
    const dx = this.direction.x;
    const dy = this.direction.y;
    const dz = this.direction.z;

    // 当前体素坐标（整数）
    let ix = Math.floor(ox);
    let iy = Math.floor(oy);
    let iz = Math.floor(oz);

    // step 方向
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    // 到下一个体素边界的距离（参数 t）
    const cellBoundaryX = stepX > 0 ? ix + 1 : ix;
    const cellBoundaryY = stepY > 0 ? iy + 1 : iy;
    const cellBoundaryZ = stepZ > 0 ? iz + 1 : iz;

    // tMax：射线到达下一个边界的 t 值
    let tMaxX = stepX !== 0
      ? (cellBoundaryX - ox) / dx
      : Infinity;
    let tMaxY = stepY !== 0
      ? (cellBoundaryY - oy) / dy
      : Infinity;
    let tMaxZ = stepZ !== 0
      ? (cellBoundaryZ - oz) / dz
      : Infinity;

    // tDelta：穿越一个体素的 t 增量
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

    // 法线 = 上次跨越的轴方向（指向射线源，即 -step）
    let normalAxis: 0 | 1 | 2 = 0;
    let normalSign = 0;
    let t = 0;

    // 起始体素先判定一次（若 origin 在 solid 内也算命中）
    let voxelId = world.getVoxel(ix, iy, iz);
    if (voxelId !== 0 && palette.isSolid(voxelId)) {
      hit.hit = true;
      hit.voxel.set(ix, iy, iz);
      hit.voxelId = voxelId;
      hit.point.set(ox, oy, oz);
      hit.normal.set(0, 0, 0);
      hit.distance = 0;
      return this;
    }

    const maxIter = Math.ceil(this.maxDistance * 3) + 16; // 安全上限
    for (let i = 0; i < maxIter; i++) {
      // 选 tMax 最小的轴推进
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          t = tMaxX;
          ix += stepX;
          tMaxX += tDeltaX;
          normalAxis = 0;
          normalSign = -stepX;
        } else {
          t = tMaxZ;
          iz += stepZ;
          tMaxZ += tDeltaZ;
          normalAxis = 2;
          normalSign = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          t = tMaxY;
          iy += stepY;
          tMaxY += tDeltaY;
          normalAxis = 1;
          normalSign = -stepY;
        } else {
          t = tMaxZ;
          iz += stepZ;
          tMaxZ += tDeltaZ;
          normalAxis = 2;
          normalSign = -stepZ;
        }
      }

      if (t > this.maxDistance) break;

      voxelId = world.getVoxel(ix, iy, iz);
      if (voxelId !== 0 && palette.isSolid(voxelId)) {
        hit.hit = true;
        hit.voxel.set(ix, iy, iz);
        hit.voxelId = voxelId;
        hit.point.set(ox + dx * t, oy + dy * t, oz + dz * t);
        hit.normal.set(
          normalAxis === 0 ? normalSign : 0,
          normalAxis === 1 ? normalSign : 0,
          normalAxis === 2 ? normalSign : 0,
        );
        hit.distance = t;
        return this;
      }
    }

    return this;
  }

  /** 上次 cast 的命中结果。 */
  getHit(): VoxelRayHit {
    return this._hit;
  }

  /** 上次命中面法线。未命中返回 (0,0,0)。 */
  getNormal(target: Vector3 = new Vector3()): Vector3 {
    return target.copy(this._hit.normal);
  }
}
