// VoxelWorld — 体素世界，管理多个 VoxelChunk。
//
// 设计目标：
//   - 用 3D chunk 网格（cx,cy,cz）支持任意高度；getChunk(cx,cz) 是
//     cy=0 的便捷重载，供扁平地形使用。
//   - setVoxel/getVoxel 接受世界体素坐标，自动路由到对应 chunk。
//   - generateTerrain(heightmap) 从二维高度图填充地形：顶层 grass、
//     下面 dirt、底部 stone。
//   - updateDirtyChunks() 重建所有脏块的缓存网格（贪婪合并），
//     供渲染层取用；getStats() 汇总块数 / 体素数 / 三角面数。
//   - 实现 VoxelNeighborProvider 接口，VoxelMesher 可直接消费。
//
// 与 VoxelChunk 的关系：World 拥有 Chunk 的引用，Chunk 不知道 World。
// 跨块邻居查询（mesher 用）通过 World.getVoxelInWorld 路由。

import { Vector3 } from '../Math/Vector3';
import { VoxelChunk, type VoxelMeshData } from './VoxelChunk';
import { defaultPalette, type VoxelPalette } from './VoxelPalette';
import { greedyMesh, type VoxelNeighborProvider } from './VoxelMesher';
import { VoxelRaycaster, type VoxelRayHit } from './VoxelRaycaster';

/** World 统计信息。 */
export interface VoxelWorldStats {
  /** 已分配 chunk 数。 */
  chunkCount: number;
  /** 非空体素总数。 */
  voxelCount: number;
  /** 缓存网格的三角面总数。 */
  triangleCount: number;
  /** 脏块数（待重建网格）。 */
  dirtyChunkCount: number;
}

/** 高度图：[x][z] → 高度（体素数）。 */
export type Heightmap = number[][] | Float32Array[] | Uint16Array[];

export class VoxelWorld implements VoxelNeighborProvider {
  /** chunk 表，键 `${cx},${cy},${cz}`。 */
  chunks: Map<string, VoxelChunk> = new Map();
  /** 每块边长（体素数），默认 16。 */
  chunkSize: number;
  /** 水平方向每边块数（world 是 worldSize×worldSize 块）。 */
  worldSize: number;
  /** 世界最大高度（体素数）。 */
  maxHeight: number;

  /** 每块的缓存网格（键同 chunks）。 */
  private _meshes: Map<string, VoxelMeshData> = new Map();
  /** 调色板。 */
  palette: VoxelPalette;

  constructor(
    chunkSize: number = 16,
    worldSize: number = 4,
    maxHeight: number = 16,
    palette: VoxelPalette = defaultPalette,
  ) {
    this.chunkSize = chunkSize;
    this.worldSize = worldSize;
    this.maxHeight = maxHeight;
    this.palette = palette;
  }

  // ── chunk 索引 ─────────────────────────────────────────────────

  /** chunk key。 */
  private _key(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  /**
   * 获取地面层 chunk（cy=0）。
   * 若 chunk 不存在返回 null（不自动创建，避免读取误分配）。
   */
  getChunk(cx: number, cz: number): VoxelChunk | null {
    return this.chunks.get(this._key(cx, 0, cz)) ?? null;
  }

  /** 获取 3D 索引 chunk。 */
  getChunk3D(cx: number, cy: number, cz: number): VoxelChunk | null {
    return this.chunks.get(this._key(cx, cy, cz)) ?? null;
  }

  /** 获取或创建 chunk（3D）。 */
  getOrCreateChunk(cx: number, cy: number, cz: number): VoxelChunk {
    const key = this._key(cx, cy, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = new VoxelChunk(
        new Vector3(cx * this.chunkSize, cy * this.chunkSize, cz * this.chunkSize),
        this.chunkSize,
      );
      this.chunks.set(key, c);
    }
    return c;
  }

  // ── 体素读写（世界坐标）──────────────────────────────────────

  /**
   * 获取体素 id（世界体素坐标）。越界或 chunk 不存在返回 0（空气）。
   */
  getVoxel(x: number, y: number, z: number): number {
    if (y < 0 || y >= this.maxHeight) return 0;
    const cs = this.chunkSize;
    const cx = Math.floor(x / cs);
    const cy = Math.floor(y / cs);
    const cz = Math.floor(z / cs);
    const chunk = this.chunks.get(this._key(cx, cy, cz));
    if (!chunk) return 0;
    const lx = x - cx * cs;
    const ly = y - cy * cs;
    const lz = z - cz * cs;
    return chunk.get(lx, ly, lz);
  }

  /**
   * 设置体素 id（世界体素坐标）。自动创建 chunk。
   */
  setVoxel(x: number, y: number, z: number, value: number): void {
    if (y < 0 || y >= this.maxHeight) return;
    const cs = this.chunkSize;
    const cx = Math.floor(x / cs);
    const cy = Math.floor(y / cs);
    const cz = Math.floor(z / cs);
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    const lx = x - cx * cs;
    const ly = y - cy * cs;
    const lz = z - cz * cs;
    chunk.set(lx, ly, lz, value);
  }

  /**
   * VoxelNeighborProvider 实现：根据"块内局部坐标 + 块原点"返回体素 id。
   * 越界部分自动走相邻 chunk。
   */
  getVoxelInWorld(
    localX: number, localY: number, localZ: number,
    chunkOriginX: number, chunkOriginY: number, chunkOriginZ: number,
  ): number {
    return this.getVoxel(
      chunkOriginX + localX,
      chunkOriginY + localY,
      chunkOriginZ + localZ,
    );
  }

  // ── 射线检测 ─────────────────────────────────────────────────

  /** DDA 射线检测，便捷封装。 */
  raycast(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number = 100,
  ): VoxelRayHit {
    const caster = new VoxelRaycaster(origin, direction, maxDistance);
    caster.cast(this, this.palette);
    return caster.getHit();
  }

  // ── 地形生成 ─────────────────────────────────────────────────

  /**
   * 从高度图生成地形。
   *
   * @param heightmap [x][z] → 高度（体素数）。heightmap 尺寸应为
   *                       worldSize*chunkSize 的正方形；越界部分忽略。
   * @param grassId   顶层 grass 体素 id（默认 2）。
   * @param dirtId    中层 dirt 体素 id（默认 3）。
   * @param stoneId   底层 stone 体素 id（默认 1）。
   */
  generateTerrain(
    heightmap: Heightmap,
    grassId: number = 2,
    dirtId: number = 3,
    stoneId: number = 1,
  ): void {
    const worldW = this.worldSize * this.chunkSize;
    for (let x = 0; x < worldW; x++) {
      const col = heightmap[x];
      if (!col) continue;
      for (let z = 0; z < worldW; z++) {
        const h = col[z];
        if (!h || h <= 0) continue;
        const top = Math.min(h, this.maxHeight);
        // dirt 层厚度：至多 2，至少留 1 层 stone（top<=2 时退化为 0..1）。
        const dirtDepth = Math.min(2, Math.max(0, top - 2));
        for (let y = 0; y < top; y++) {
          let id: number;
          if (y === top - 1) id = grassId;
          else if (y >= top - 1 - dirtDepth) id = dirtId;
          else id = stoneId;
          this.setVoxel(x, y, z, id);
        }
      }
    }
  }

  // ── 脏块更新 ─────────────────────────────────────────────────

  /**
   * 重建所有脏块的缓存网格（贪婪合并）。返回重建的块数。
   */
  updateDirtyChunks(): number {
    let rebuilt = 0;
    for (const [key, chunk] of this.chunks) {
      if (!chunk.isDirty()) continue;
      const mesh = greedyMesh(chunk, this, this.palette);
      this._meshes.set(key, mesh);
      chunk.clearDirty();
      rebuilt++;
    }
    return rebuilt;
  }

  /** 获取块的缓存网格（需先 updateDirtyChunks）。 */
  getChunkMesh(chunk: VoxelChunk): VoxelMeshData | null {
    for (const [key, c] of this.chunks) {
      if (c === chunk) return this._meshes.get(key) ?? null;
    }
    return null;
  }

  // ── 统计 ─────────────────────────────────────────────────────

  getStats(): VoxelWorldStats {
    let voxelCount = 0;
    let triangleCount = 0;
    let dirtyChunkCount = 0;
    for (const [key, chunk] of this.chunks) {
      voxelCount += chunk.getVoxelCount();
      if (chunk.isDirty()) dirtyChunkCount++;
      const mesh = this._meshes.get(key);
      if (mesh) triangleCount += mesh.triangleCount;
    }
    return {
      chunkCount: this.chunks.size,
      voxelCount,
      triangleCount,
      dirtyChunkCount,
    };
  }
}
