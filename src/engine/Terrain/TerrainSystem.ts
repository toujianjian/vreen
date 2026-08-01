// TerrainSystem — 多分块地形管理 + 距离 LOD 选择 + 全局高度查询。
//
// 适配:
//   - o3de Atom TerrainSystem / TerrainWorld (分块管理 + LOD + 高度查询)
//   - GPU Gems 1 Ch.38 "Terrain LOD" (chunked LOD)
//
// 每帧 update(cameraX, cameraZ) 时:
//   1. 计算相机周围 viewDistance 范围内的分块坐标;
//   2. 按距离选择 LOD 级别;
//   3. 创建/更新/回收分块;
//   4. 返回可见分块列表(供渲染器提交)。
//
// 高度查询 getHeightAt(x, z) 直接调用 heightFunction,不依赖分块几何,
// 因此即使分块尚未生成也能返回准确高度。
//
// 不变量:
//   - 同一 (chunkX, chunkZ) 坐标的分块在 LOD 不变时缓存复用;
//   - LOD 变化时重建分块(旧分块被丢弃);
//   - 不可见分块(viewDistance 外)被回收,防止内存无限增长;
//   - getHeightAt / getNormalAt 不依赖分块,直接调用 heightFunction。
//
// 参考:
//   - o3de Gem::Terrain (TerrainWorld)
//   - GPU Gems 1 Ch.38

import { Vector3 } from '../Math/Vector3';
import { TerrainChunk, type TerrainChunkOptions } from './TerrainChunk';
import type { HeightFunction } from './FBMNoise';

/** TerrainSystem 构造选项。 */
export interface TerrainSystemOptions {
  /** 高度函数(整个地形系统共用)。 */
  heightFunction: HeightFunction;
  /** 分块边长(世界单位)。默认 64。 */
  chunkSize?: number;
  /** 基础分段数(LOD 0)。默认 64。 */
  baseSegments?: number;
  /** LOD 层数。默认 4(LOD 0..3)。 */
  lodLevels?: number;
  /** LOD 切换距离(每个 LOD 的最小相机距离,递增)。默认 [0, 64, 128, 256]。 */
  lodDistances?: number[];
  /** skirt 高度。默认 1。 */
  skirtHeight?: number;
  /** 渲染范围(相机周围多少单位内的分块可见)。默认 256。 */
  viewDistance?: number;
  /** UV 重复次数(每个分块)。默认 1。 */
  uvRepeat?: number;
}

/**
 * 地形系统:管理多个分块 + 距离 LOD 选择 + 全局高度查询。
 *
 * 每帧调用 update(cameraX, cameraZ) 更新可见分块列表。
 * 调用 getHeightAt(x, z) / getNormalAt(x, z) 进行全局高度/法线查询。
 */
export class TerrainSystem {
  readonly heightFunction: HeightFunction;
  readonly chunkSize: number;
  readonly baseSegments: number;
  readonly lodLevels: number;
  readonly lodDistances: number[];
  readonly skirtHeight: number;
  readonly viewDistance: number;
  readonly uvRepeat: number;

  private chunks: Map<string, TerrainChunk> = new Map();

  constructor(options: TerrainSystemOptions) {
    this.heightFunction = options.heightFunction;
    this.chunkSize = options.chunkSize ?? 64;
    this.baseSegments = options.baseSegments ?? 64;
    this.lodLevels = options.lodLevels ?? 4;
    this.lodDistances = options.lodDistances ?? [0, 64, 128, 256];
    this.skirtHeight = options.skirtHeight ?? 1;
    this.viewDistance = options.viewDistance ?? 256;
    this.uvRepeat = options.uvRepeat ?? 1;
  }

  /** 生成分块键 "cx,cz"。 */
  private _chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  /** 根据距离选择 LOD 级别。 */
  private _selectLOD(distance: number): number {
    for (let l = this.lodLevels - 1; l >= 0; l--) {
      if (distance >= this.lodDistances[l]) return l;
    }
    return 0;
  }

  /**
   * 每帧更新:计算可见分块 + 选择 LOD。
   *
   * @param cameraX 相机世界 X
   * @param cameraZ 相机世界 Z
   * @returns 可见分块数组
   */
  update(cameraX: number, cameraZ: number): TerrainChunk[] {
    const halfView = this.viewDistance;
    const minCX = Math.floor((cameraX - halfView) / this.chunkSize) * this.chunkSize;
    const maxCX = Math.floor((cameraX + halfView) / this.chunkSize) * this.chunkSize;
    const minCZ = Math.floor((cameraZ - halfView) / this.chunkSize) * this.chunkSize;
    const maxCZ = Math.floor((cameraZ + halfView) / this.chunkSize) * this.chunkSize;

    const visibleKeys = new Set<string>();
    const result: TerrainChunk[] = [];

    for (let cx = minCX; cx <= maxCX; cx += this.chunkSize) {
      for (let cz = minCZ; cz <= maxCZ; cz += this.chunkSize) {
        const centerX = cx + this.chunkSize / 2;
        const centerZ = cz + this.chunkSize / 2;
        const dist = Math.hypot(cameraX - centerX, cameraZ - centerZ);
        if (dist > this.viewDistance + this.chunkSize) continue;

        const lod = this._selectLOD(dist);
        const key = this._chunkKey(cx, cz);
        visibleKeys.add(key);

        let chunk = this.chunks.get(key);
        if (!chunk || chunk.lod !== lod) {
          const chunkOpts: TerrainChunkOptions = {
            chunkX: cx,
            chunkZ: cz,
            size: this.chunkSize,
            lod,
            heightFunction: this.heightFunction,
            baseSegments: this.baseSegments,
            skirtHeight: this.skirtHeight,
            uvRepeat: this.uvRepeat,
          };
          chunk = new TerrainChunk(chunkOpts);
          this.chunks.set(key, chunk);
        }
        result.push(chunk);
      }
    }

    // 回收不可见分块
    for (const [key] of this.chunks) {
      if (!visibleKeys.has(key)) {
        this.chunks.delete(key);
      }
    }

    return result;
  }

  /** 获取当前所有活跃分块。 */
  getActiveChunks(): TerrainChunk[] {
    return Array.from(this.chunks.values());
  }

  /**
   * 全局高度查询(直接调用 heightFunction,不依赖分块几何)。
   *
   * @param x 世界 X
   * @param z 世界 Z
   * @returns 高度值
   */
  getHeightAt(x: number, z: number): number {
    return this.heightFunction(x, z);
  }

  /**
   * 全局法线查询(中心差分)。
   *
   * @param x 世界 X
   * @param z 世界 Z
   * @returns 归一化法线
   */
  getNormalAt(x: number, z: number): Vector3 {
    const eps = 1;
    const hL = this.heightFunction(x - eps, z);
    const hR = this.heightFunction(x + eps, z);
    const hD = this.heightFunction(x, z - eps);
    const hU = this.heightFunction(x, z + eps);
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return new Vector3(nx / len, ny / len, nz / len);
  }

  /**
   * 全局坡度查询(弧度)。
   *
   * @param x 世界 X
   * @param z 世界 Z
   * @returns 坡度弧度,0 = 平面,π/2 = 垂直
   */
  getSlopeAt(x: number, z: number): number {
    const n = this.getNormalAt(x, z);
    const dot = n.y < -1 ? -1 : n.y > 1 ? 1 : n.y;
    return Math.acos(dot);
  }

  /** 清理所有分块。 */
  dispose(): void {
    this.chunks.clear();
  }
}
