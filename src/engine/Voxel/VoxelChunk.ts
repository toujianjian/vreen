// VoxelChunk — 体素块（16×16×16 体素单元）。
//
// 设计目标：
//   - 单块用 Uint8Array(4096) 存 id 序列，0 = 空气。
//   - 索引顺序 idx = x + size*(z + size*y)：X 最快、Y 最慢，便于水平迭代。
//   - dirty 标记驱动 VoxelWorld.updateDirtyChunks() 重算网格。
//   - toMeshData() 是"块内简单面剔除"：仅剔除两相邻 solid 体素之间的
//     内部面，不合并相邻同色面（合并由 VoxelMesher.greedyMesh 负责）。
//     边界面（chunk 边界）默认全部生成，由 VoxelWorld 配合相邻 chunk
//     调用 VoxelMesher 处理跨块剔除。
//
// 与 VoxelWorld 的关系：Chunk 不知道自己属于哪个世界，所有跨块查询
// 走 VoxelWorld.getVoxel。Chunk.position 是块在世界中的左下角坐标
// （体素单位），与 chunkSize 配合得到世界 AABB。

import { Vector3 } from '../Math/Vector3';
import { defaultPalette, type VoxelPalette } from './VoxelPalette';

/** 体素块生成的网格数据（直接可写入 BufferGeometry）。 */
export interface VoxelMeshData {
  /** 顶点位置（每顶点 3 个 float）。 */
  positions: number[];
  /** 顶点法线（每顶点 3 个 float）。 */
  normals: number[];
  /** 顶点颜色（每顶点 3 个 float，线性 0..1）。 */
  colors: number[];
  /** 三角形索引。 */
  indices: number[];
  /** 三角面数。 */
  triangleCount: number;
}

/** 6 个面的方向 + 4 个角点（CCW from outside）。 */
interface FaceDef {
  dir: [number, number, number];
  corners: [number, number, number][];
}

const FACES: FaceDef[] = [
  { // +X
    dir: [1, 0, 0],
    corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  },
  { // -X
    dir: [-1, 0, 0],
    corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  },
  { // +Y (top)
    dir: [0, 1, 0],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  { // -Y (bottom)
    dir: [0, -1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  { // +Z (front)
    dir: [0, 0, 1],
    corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  },
  { // -Z (back)
    dir: [0, 0, -1],
    corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
  },
];

export class VoxelChunk {
  /** 体素 id 数组（0 = 空气）。 */
  voxels: Uint8Array;
  /** 块在世界中的左下角坐标（体素单位）。 */
  position: Vector3;
  /** 块尺寸（每边体素数），默认 16。 */
  size: number;
  /** 是否需要重建网格。 */
  private _dirty: boolean;

  constructor(
    position: Vector3 = new Vector3(0, 0, 0),
    size: number = 16,
  ) {
    this.voxels = new Uint8Array(size * size * size);
    this.position = position.clone();
    this.size = size;
    this._dirty = true;
  }

  /** 索引计算：idx = x + size*(z + size*y)。 */
  index(x: number, y: number, z: number): number {
    return x + this.size * (z + this.size * y);
  }

  /**
   * 获取体素 id。越界返回 0（空气）。
   * 注：跨块查询应由 VoxelWorld.getVoxel 处理，本方法只服务块内。
   */
  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.size || y >= this.size || z >= this.size) {
      return 0;
    }
    return this.voxels[this.index(x, y, z)];
  }

  /** 设置体素 id。越界忽略。自动标记 dirty。 */
  set(x: number, y: number, z: number, value: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.size || y >= this.size || z >= this.size) {
      return;
    }
    const idx = this.index(x, y, z);
    if (this.voxels[idx] !== value) {
      this.voxels[idx] = value;
      this._dirty = true;
    }
  }

  /** 是否需要重建网格。 */
  isDirty(): boolean {
    return this._dirty;
  }

  /** 标记为已构建（VoxelWorld.updateDirtyChunks 调用）。 */
  clearDirty(): void {
    this._dirty = false;
  }

  /** 标记为脏，强制重建网格。 */
  markDirty(): void {
    this._dirty = true;
  }

  /** 清空所有体素为空气。 */
  clear(): void {
    this.voxels.fill(0);
    this._dirty = true;
  }

  /** 统计非空气体素数。 */
  getVoxelCount(): number {
    let count = 0;
    const v = this.voxels;
    for (let i = 0; i < v.length; i++) {
      if (v[i] !== 0) count++;
    }
    return count;
  }

  /**
   * 简单网格生成（块内面剔除）。
   *
   * 规则：对每个非空体素的每个面，若该面相邻方向上的体素是空气或透明，
   * 则生成该面。块边界处相邻方向越界视为空气（即边界面会被生成）；
   * 跨块剔除由 VoxelMesher 配合 VoxelWorld 处理。
   *
   * @param palette 颜色查表（默认 defaultPalette）。
   */
  toMeshData(palette: VoxelPalette = defaultPalette): VoxelMeshData {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const size = this.size;
    const baseX = this.position.x;
    const baseY = this.position.y;
    const baseZ = this.position.z;

    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
          const id = this.get(x, y, z);
          if (id === 0) continue;
          const selfTransparent = palette.isTransparent(id);
          const col = palette.getColor(id);

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];
            const neighborId = this.get(nx, ny, nz);

            // 剔除规则：
            //   - 邻居为空气 → 生成面
            //   - 邻居为固体非透明 → 剔除
            //   - 邻居为透明且当前也透明（同种液体）→ 剔除（避免水内部面）
            //   - 邻居为透明且当前非透明 → 生成面
            if (neighborId !== 0) {
              const nSolid = palette.isSolid(neighborId);
              const nTransparent = palette.isTransparent(neighborId);
              if (nSolid && !nTransparent) continue;
              if (nTransparent && selfTransparent && neighborId === id) continue;
            }

            // 生成 4 顶点 quad
            const v0 = face.corners[0];
            const v1 = face.corners[1];
            const v2 = face.corners[2];
            const v3 = face.corners[3];
            const startIdx = positions.length / 3;

            positions.push(
              baseX + x + v0[0], baseY + y + v0[1], baseZ + z + v0[2],
              baseX + x + v1[0], baseY + y + v1[1], baseZ + z + v1[2],
              baseX + x + v2[0], baseY + y + v2[1], baseZ + z + v2[2],
              baseX + x + v3[0], baseY + y + v3[1], baseZ + z + v3[2],
            );
            for (let k = 0; k < 4; k++) {
              normals.push(face.dir[0], face.dir[1], face.dir[2]);
              colors.push(col[0], col[1], col[2]);
            }
            indices.push(
              startIdx, startIdx + 1, startIdx + 2,
              startIdx, startIdx + 2, startIdx + 3,
            );
          }
        }
      }
    }

    return {
      positions,
      normals,
      colors,
      indices,
      triangleCount: indices.length / 3,
    };
  }
}
