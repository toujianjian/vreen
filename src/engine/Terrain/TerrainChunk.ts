// TerrainChunk — 地形 LOD 分块(含 skirt 缝合)。
//
// 适配:
//   - o3de Atom TerrainSystem / TerrainSpawner (分块 + LOD + skirt)
//   - GPU Gems 1 Ch.38 "Terrain LOD" (chunked LOD with skirts)
//
// 每个分块是一个 BufferGeometry,LOD 级别决定分段数:
//   LOD 0 = baseSegments,LOD N = baseSegments / 2^N(最低 1)。
// 包含 skirt(裙边)几何:沿四边向下延伸 skirtHeight,
// 消除相邻分块不同 LOD 间的可见缝隙。
//
// 不变量:
//   - LOD 0 分段 = baseSegments,LOD N 分段 = max(1, baseSegments / 2^N);
//   - skirt 顶点 = 边缘顶点副本,Y 下移 skirtHeight;
//   - skirt 三角形连接边缘顶点和对应 skirt 顶点;
//   - 分块世界位置由 (chunkX, chunkZ) + size 决定,中心在 (chunkX+size/2, _, chunkZ+size/2)。
//
// 参考:
//   - o3de Gem::Terrain (TerrainWorld / TerrainSpawner)
//   - GPU Gems 1 Ch.38 "Terrain Level of Detail Strategies"

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math/Vector3';
import type { HeightFunction } from './FBMNoise';

/** TerrainChunk 构造选项。 */
export interface TerrainChunkOptions {
  /** 分块在世界中的 X 坐标(左上角)。 */
  chunkX: number;
  /** 分块在世界中的 Z 坐标(左上角)。 */
  chunkZ: number;
  /** 分块边长(世界单位)。 */
  size: number;
  /** LOD 级别(0 = 最高精度)。 */
  lod: number;
  /** 高度函数(世界 x, z → 世界 y)。 */
  heightFunction: HeightFunction;
  /** 基础分段数(LOD 0 时的分段)。默认 64。 */
  baseSegments?: number;
  /** skirt 高度(向下延伸消除 LOD 缝隙)。默认 1。 */
  skirtHeight?: number;
  /** UV 重复次数。默认 1。 */
  uvRepeat?: number;
}

/**
 * 单个地形 LOD 分块。
 *
 * 每个分块是一个 BufferGeometry,包含:
 *   - position / normal / uv 顶点属性
 *   - 索引(地形网格 + skirt 三角形)
 *   - 计算包围盒
 *
 * LOD 级别决定网格分辨率:LOD 0 = baseSegments,LOD N = baseSegments / 2^N。
 * skirt 沿四边向下延伸,消除相邻分块不同 LOD 间的可见缝隙。
 */
export class TerrainChunk extends BufferGeometry {
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly size: number;
  readonly lod: number;
  readonly skirtHeight: number;
  readonly segments: number;

  constructor(options: TerrainChunkOptions) {
    super();

    this.chunkX = options.chunkX;
    this.chunkZ = options.chunkZ;
    this.size = options.size;
    this.lod = options.lod;
    this.skirtHeight = options.skirtHeight ?? 1;

    const baseSegments = options.baseSegments ?? 64;
    // LOD N 的分段数 = baseSegments / 2^N,最低 1
    this.segments = Math.max(1, Math.floor(baseSegments / Math.pow(2, options.lod)));
    const uvRepeat = options.uvRepeat ?? 1;

    this._buildMesh(options.heightFunction, uvRepeat);

    if (this.skirtHeight > 0) {
      this._addSkirt();
    }
  }

  /** 构建地形网格(position / index / normal / uv)。 */
  private _buildMesh(heightFunction: HeightFunction, uvRepeat: number): void {
    const seg = this.segments;
    const seg1 = seg + 1;
    const x0 = this.chunkX;
    const z0 = this.chunkZ;
    const dx = this.size / seg;
    const dz = this.size / seg;

    const positions = new Float32Array(seg1 * seg1 * 3);
    const uvs = new Float32Array(seg1 * seg1 * 2);
    const indices: number[] = [];

    // 顶点 + UV
    for (let iz = 0; iz < seg1; iz++) {
      for (let ix = 0; ix < seg1; ix++) {
        const wx = x0 + ix * dx;
        const wz = z0 + iz * dz;
        const wy = heightFunction(wx, wz);
        const vi = (iz * seg1 + ix) * 3;
        const ui = (iz * seg1 + ix) * 2;
        positions[vi] = wx;
        positions[vi + 1] = wy;
        positions[vi + 2] = wz;
        uvs[ui] = (ix / seg) * uvRepeat;
        uvs[ui + 1] = (iz / seg) * uvRepeat;
      }
    }

    // 索引(两个三角形 per grid cell,逆时针)
    for (let iz = 0; iz < seg; iz++) {
      for (let ix = 0; ix < seg; ix++) {
        const a = iz * seg1 + ix;
        const b = iz * seg1 + ix + 1;
        const c = (iz + 1) * seg1 + ix;
        const d = (iz + 1) * seg1 + ix + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(positions, 3));
    this.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.computeVertexNormals();
    this.computeBoundingBox();
  }

  /** 沿四边添加裙边顶点,消除 LOD 缝隙。 */
  private _addSkirt(): void {
    const pos = this.getAttribute('position');
    if (!pos) return;
    const uv = this.getAttribute('uv');
    const seg1 = this.segments + 1;
    const originalCount = seg1 * seg1;

    // 收集四边顶点索引(去重角点:上边+下边含角点,左右边跳过角点)
    const edgeIndices: number[] = [];
    // 上边 (iz=0)
    for (let ix = 0; ix < seg1; ix++) edgeIndices.push(ix);
    // 下边 (iz=seg1-1)
    for (let ix = 0; ix < seg1; ix++) edgeIndices.push((seg1 - 1) * seg1 + ix);
    // 左边 (ix=0),跳过角点
    for (let iz = 1; iz < seg1 - 1; iz++) edgeIndices.push(iz * seg1);
    // 右边 (ix=seg1-1),跳过角点
    for (let iz = 1; iz < seg1 - 1; iz++) edgeIndices.push(iz * seg1 + seg1 - 1);

    const skirtCount = edgeIndices.length;
    const oldPos = pos.array as Float32Array;
    const oldUV = uv ? (uv.array as Float32Array) : null;
    const newPos = new Float32Array(oldPos.length + skirtCount * 3);
    const newUV = oldUV ? new Float32Array(oldUV.length + skirtCount * 2) : null;

    newPos.set(oldPos);
    if (newUV && oldUV) newUV.set(oldUV);

    // 复制边缘顶点并向下位移
    for (let i = 0; i < skirtCount; i++) {
      const srcIdx = edgeIndices[i];
      const dstIdx = originalCount + i;
      newPos[dstIdx * 3] = oldPos[srcIdx * 3];
      newPos[dstIdx * 3 + 1] = oldPos[srcIdx * 3 + 1] - this.skirtHeight;
      newPos[dstIdx * 3 + 2] = oldPos[srcIdx * 3 + 2];
      if (newUV && oldUV) {
        newUV[dstIdx * 2] = oldUV[srcIdx * 2];
        newUV[dstIdx * 2 + 1] = oldUV[srcIdx * 2 + 1];
      }
    }

    this.setAttribute('position', new BufferAttribute(newPos, 3));
    if (newUV) {
      this.setAttribute('uv', new BufferAttribute(newUV, 2));
    }

    // 添加 skirt 三角索引
    const idx = this.index;
    if (idx) {
      const oldIndices = Array.from(idx.array as unknown as ArrayLike<number>);
      const newIndices: number[] = [...oldIndices];

      // 按边顺序连接相邻边缘顶点对
      // edgeIndices 布局: [0..seg1-1]=上边, [seg1..2*seg1-1]=下边,
      //                   [2*seg1..2*seg1+segZ1-3]=左边, [..]=右边
      const topEnd = seg1;
      const bottomEnd = topEnd + seg1;
      const leftEnd = bottomEnd + (seg1 - 2);
      const rightEnd = leftEnd + (seg1 - 2);

      // 连接相邻的 (edgeIdx[i], edgeIdx[i+1]) 添加两个三角形
      const connectEdge = (start: number, end: number) => {
        for (let i = start; i < end - 1; i++) {
          const a = edgeIndices[i];
          const b = edgeIndices[i + 1];
          const sa = originalCount + i;
          const sb = originalCount + i + 1;
          newIndices.push(a, sa, b);
          newIndices.push(b, sa, sb);
        }
      };

      connectEdge(0, topEnd);
      connectEdge(topEnd, bottomEnd);
      connectEdge(bottomEnd, leftEnd);
      connectEdge(leftEnd, rightEnd);

      this.setIndex(newIndices);
    }

    this.computeVertexNormals();
    this.computeBoundingBox();
  }

  /** 分块中心世界坐标(XZ 平面)。 */
  getCenter(): Vector3 {
    return new Vector3(
      this.chunkX + this.size / 2,
      0,
      this.chunkZ + this.size / 2,
    );
  }

  /** 相机到分块中心的水平距离。 */
  distanceTo(cameraX: number, cameraZ: number): number {
    const cx = this.chunkX + this.size / 2;
    const cz = this.chunkZ + this.size / 2;
    return Math.hypot(cameraX - cx, cameraZ - cz);
  }
}
