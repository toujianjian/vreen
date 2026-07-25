// VoxelMesher — 体素网格生成器。
//
// 提供两种网格化策略：
//   - simpleMesh(chunk, world):  简单网格，每个可见面一个 quad（4 顶点 2 三角）。
//                                与 VoxelChunk.toMeshData 类似，但支持跨块邻居查询。
//   - greedyMesh(chunk, world):  贪婪网格合并（参考 0fps "Meshing in a voxel game"）。
//                                把相邻同 id 的可见面合并为大 quad，大幅减少三角面数。
//                                适合大块平整地形（典型可减少 50%+ 三角面）。
//
// getAmbientOcclusion(...): 顶点级 AO，由调用方在生成顶点时调用。
//
// VoxelNeighborProvider 是结构性接口，VoxelWorld 实现了它；测试里可以
// 注入 mock，避免依赖完整 World。

import type { VoxelChunk, VoxelMeshData } from './VoxelChunk';
import { defaultPalette, type VoxelPalette } from './VoxelPalette';

/**
 * 体素邻居提供者：根据"块内体素坐标"（可越界）返回体素 id。
 * VoxelWorld 实现此接口；越界查询走相邻 chunk。
 */
export interface VoxelNeighborProvider {
  /**
   * @param cx,cy,cz 块内体素坐标（可越界，越界部分由 world 查相邻 chunk）。
   * @param chunkOriginX/Y/Z 块在世界中的左下角体素坐标。
   */
  getVoxelInWorld(localX: number, localY: number, localZ: number,
    chunkOriginX: number, chunkOriginY: number, chunkOriginZ: number): number;
}

/** 6 个面：3 个轴 × 2 个方向。 */
const FACE_DIRS = [
  { d: 0, sign: 1 },   // +X
  { d: 0, sign: -1 },  // -X
  { d: 1, sign: 1 },   // +Y
  { d: 1, sign: -1 },  // -Y
  { d: 2, sign: 1 },   // +Z
  { d: 2, sign: -1 },  // -Z
] as const;

/** 方向向量。索引顺序与 FACE_DIRS 对齐。 */
const DIR_VEC: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/**
 * 计算顶点环境光遮蔽等级。
 *
 * @param side1  顶点一侧的邻居是否为固体阻挡（0 或 1）。
 * @param side2  顶点另一侧的邻居是否为固体阻挡（0 或 1）。
 * @param corner 顶点对角处的邻居是否为固体阻挡（0 或 1）。
 * @returns 0..3，3 = 无遮蔽（最亮），0 = 全遮蔽（最暗）。
 *
 * 规则（Minecraft 风格）：
 *   - 若 side1 与 side2 都阻挡：返回 0（角被完全遮挡）。
 *   - 否则：返回 3 - (side1 + side2 + corner)。
 */
export function getAmbientOcclusion(side1: number, side2: number, corner: number): number {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

/** 判定 A 的 +face 朝向 B 是否可见。 */
function isFaceVisible(aId: number, bId: number, palette: VoxelPalette): boolean {
  if (aId === 0) return false;
  if (bId === 0) return true;
  const aT = palette.isTransparent(aId);
  const bT = palette.isTransparent(bId);
  if (aT && !bT) return false;       // A 透明 B 不透明：A 的 +face 被 B 遮挡（从 B 侧看不到）
  if (!aT && bT) return true;        // A 不透明 B 透明：A 的 +face 透过 B 可见
  if (aT && bT) return aId !== bId;  // 都透明：仅不同 id 之间生成面
  return false;                       // 都不透明：无面
}

/**
 * 简单网格：每个可见面一个 quad，使用跨块邻居查询。
 *
 * 与 VoxelChunk.toMeshData 的区别：本方法通过 world 查询块边界外的邻居，
 * 能正确剔除跨块相邻 solid 体素之间的面。
 */
export function simpleMesh(
  chunk: VoxelChunk,
  world: VoxelNeighborProvider,
  palette: VoxelPalette = defaultPalette,
): VoxelMeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const size = chunk.size;
  const ox = chunk.position.x;
  const oy = chunk.position.y;
  const oz = chunk.position.z;

  const FACES = [
    { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] as [number, number, number][] },
    { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] as [number, number, number][] },
    { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] as [number, number, number][] },
    { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] as [number, number, number][] },
    { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] as [number, number, number][] },
    { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] as [number, number, number][] },
  ];

  for (let y = 0; y < size; y++) {
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const id = chunk.get(x, y, z);
        if (id === 0) continue;
        const col = palette.getColor(id);

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          const neighborId = world.getVoxelInWorld(nx, ny, nz, ox, oy, oz);
          if (!isFaceVisible(id, neighborId, palette)) continue;

          const startIdx = positions.length / 3;
          for (let k = 0; k < 4; k++) {
            const c = face.corners[k];
            positions.push(ox + x + c[0], oy + y + c[1], oz + z + c[2]);
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

  return { positions, normals, colors, indices, triangleCount: indices.length / 3 };
}

/**
 * 贪婪网格合并：把同 id 同方向相邻的可见面合并为大 quad。
 *
 * 算法（每轴每个 d-slice）：
 *   1. 构造 2D mask[u*size+v]，每格存 "+id"（A 的 +face 可见）或 "-id"
 *      （B 的 -face 可见）或 0（无面）。
 *   2. 在 mask 上贪心搜索最大矩形（先向 u 扩展宽度，再向 v 扩展高度），
 *      找到一个矩形后发射 quad 并把 mask 对应位置清零。
 *
 * 合并后每个矩形 quad 仅 4 顶点 2 三角，远比简单网格省。
 */
export function greedyMesh(
  chunk: VoxelChunk,
  world: VoxelNeighborProvider,
  palette: VoxelPalette = defaultPalette,
): VoxelMeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const size = chunk.size;
  const ox = chunk.position.x;
  const oy = chunk.position.y;
  const oz = chunk.position.z;

  // 三个轴向：0=X, 1=Y, 2=Z
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const sizeArr = [0, 0, 0];
    sizeArr[0] = size; sizeArr[1] = size; sizeArr[2] = size;

    // 块内坐标数组复用
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;

    // mask：存 id（>0 = +face，<0 = -face，0 = 无面）
    const mask = new Int32Array(size * size);

    // 遍历 d 轴上的"切片边界"，从 -1 到 size（含两端，处理边界 -face 与 +face）
    for (x[d] = -1; x[d] < size; ) {
      // 计算 mask
      let n = 0;
      for (x[v] = 0; x[v] < size; x[v]++) {
        for (x[u] = 0; x[u] < size; x[u]++) {
          // a = 体素在 x[d] 处（若 x[d] < 0 视为空气）
          const aId = x[d] >= 0 ? chunk.get(x[0], x[1], x[2]) : 0;
          // b = 体素在 x[d]+1 处（若越界走 world）
          let bId: number;
          if (x[d] + 1 < size) {
            bId = chunk.get(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          } else {
            bId = world.getVoxelInWorld(
              x[0] + q[0], x[1] + q[1], x[2] + q[2],
              ox, oy, oz,
            );
          }

          // +face of a (toward b) visible?
          if (isFaceVisible(aId, bId, palette)) {
            mask[n] = aId;
          } else if (isFaceVisible(bId, aId, palette)) {
            mask[n] = -bId;
          } else {
            mask[n] = 0;
          }
          n++;
        }
      }

      x[d]++;

      // 在 mask 上贪心合并矩形
      n = 0;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; ) {
          const c = mask[n];
          if (c !== 0) {
            // 计算宽度 w（沿 u 方向）
            let w = 1;
            while (i + w < size && mask[n + w] === c) w++;

            // 计算高度 h（沿 v 方向）
            let h = 1;
            let done = false;
            while (j + h < size) {
              for (let k = 0; k < w; k++) {
                if (mask[n + k + h * size] !== c) { done = true; break; }
              }
              if (done) break;
              h++;
            }

            // 发射 quad
            // 当前切片在 d 方向上的位置：x[d]（已 +1）表示"+face 在 x[d]-1 体素"
            // 即：面位于 d 轴坐标 x[d] 处
            x[u] = i;
            x[v] = j;

            const du = [0, 0, 0]; du[u] = w;
            const dv = [0, 0, 0]; dv[v] = h;

            // 4 顶点
            const base = [0, 0, 0];
            base[0] = ox + x[0];
            base[1] = oy + x[1];
            base[2] = oz + x[2];

            const p0 = base.slice();
            const p1 = [base[0] + du[0], base[1] + du[1], base[2] + du[2]];
            const p2 = [base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2]];
            const p3 = [base[0] + dv[0], base[1] + dv[1], base[2] + dv[2]];

            const startIdx = positions.length / 3;
            positions.push(p0[0], p0[1], p0[2]);
            positions.push(p1[0], p1[1], p1[2]);
            positions.push(p2[0], p2[1], p2[2]);
            positions.push(p3[0], p3[1], p3[2]);

            // 法线 + 颜色（取 |c| 作为 id 查颜色）
            const idAbs = Math.abs(c);
            const col = palette.getColor(idAbs);
            const sign = c > 0 ? 1 : -1;
            const normal = [0, 0, 0];
            normal[d] = sign;
            for (let k = 0; k < 4; k++) {
              normals.push(normal[0], normal[1], normal[2]);
              colors.push(col[0], col[1], col[2]);
            }

            // 索引：+face 与 -face 的 winding 相反，确保法线方向正确
            if (sign > 0) {
              indices.push(startIdx, startIdx + 1, startIdx + 2,
                startIdx, startIdx + 2, startIdx + 3);
            } else {
              indices.push(startIdx, startIdx + 2, startIdx + 1,
                startIdx, startIdx + 3, startIdx + 2);
            }

            // 清零 mask
            for (let l = 0; l < h; l++) {
              for (let k = 0; k < w; k++) {
                mask[n + k + l * size] = 0;
              }
            }

            i += w;
            n += w;
          } else {
            i++;
            n++;
          }
        }
      }
    }
  }

  return { positions, normals, colors, indices, triangleCount: indices.length / 3 };
}

// 显式重新导出 FACE_DIRS 防止 tree-shake 时被误删（仅供调试用）。
void FACE_DIRS;
void DIR_VEC;
