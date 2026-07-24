// TerrainGeometry — 从高度图数据生成的地形几何体。
//
// 与 PlaneGeometry 的区别:
//   * 顶点位于 XZ 平面(Y 向上),而非 XY 平面(Z 向上)
//   * Y 由高度图驱动:position.y = normalizedHeight(x,z) * heightScale
//   * 法线由相邻高度的中心差分计算,比 computeVertexNormals 的面法线平均更平滑
//   * 提供 getHeightAt(x, z) 双线性插值采样,用于角色/相机贴地
//
// 约定:
//   * heightmap 长度必须等于 (widthSegments+1) * (heightSegments+1)
//   * Uint8Array 视为 0..255,内部归一化到 0..1(除以 255)
//   * Float32Array 视为已归一化(0..1),调用方自行控制值域
//   * 归一化高度统一乘以 heightScale 得到世界 Y
//
// 顶点布局(俯视 XZ 平面,Y 朝上):
//
//      z=-heightHalf  ┌──────────────────┐
//                    │ iy=0              │
//                    │ ...               │
//                    │ iy=heightSegments │
//      z=+heightHalf  └──────────────────┘
//       x=-widthHalf                   x=+widthHalf
//
// 索引顺序与 PlaneGeometry 一致(每个 grid cell 两个三角形)。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** TerrainGeometry 构造参数。 */
export interface TerrainGeometryOptions {
  /** 地形在世界 X 方向的尺寸。 */
  width: number;
  /** 地形在世界 Z 方向的尺寸。 */
  height: number;
  /** X 方向网格分段数,默认从高度图推断。 */
  widthSegments?: number;
  /** Z 方向网格分段数,默认从高度图推断。 */
  heightSegments?: number;
  /** 高度数据,长度需为 (widthSegments+1)*(heightSegments+1)。 */
  heightmap: Float32Array | Uint8Array;
  /** 高度缩放(归一化高度 × heightScale = 世界 Y)。 */
  heightScale?: number;
}

/**
 * 高度图地形几何体。
 *
 * 生成 position / normal / uv / index 四个 attribute,并计算包围盒。
 * 法线通过对高度图中心差分得到,保证地形着色平滑。
 */
export class TerrainGeometry extends BufferGeometry {
  /** 世界 X 尺寸。 */
  readonly width: number;
  /** 世界 Z 尺寸。 */
  readonly height: number;
  /** X 方向分段数。 */
  readonly widthSegments: number;
  /** Z 方向分段数。 */
  readonly heightSegments: number;
  /** 高度缩放。 */
  readonly heightScale: number;
  /** 归一化高度图(0..1),长度 = gridX1 * gridY1。 */
  readonly heightmap: Float32Array;
  /** X 方向顶点数(gridX + 1)。 */
  readonly gridX1: number;
  /** Z 方向顶点数(gridY + 1)。 */
  readonly gridY1: number;

  constructor(opts: TerrainGeometryOptions) {
    super();

    const width = opts.width;
    const height = opts.height;
    const rawMap = opts.heightmap;

    // 若未指定分段,尝试从高度图推断:需要一个完全平方数。
    let widthSegments = opts.widthSegments;
    let heightSegments = opts.heightSegments;
    if (widthSegments === undefined || heightSegments === undefined) {
      const guess = Math.round(Math.sqrt(rawMap.length));
      if (guess * guess !== rawMap.length) {
        throw new Error(
          `TerrainGeometry: 无法从长度 ${rawMap.length} 推断正方形高度图尺寸,请显式传入 widthSegments/heightSegments`,
        );
      }
      if (widthSegments === undefined) widthSegments = guess - 1;
      if (heightSegments === undefined) heightSegments = guess - 1;
    }

    const gridX = Math.max(1, Math.floor(widthSegments));
    const gridY = Math.max(1, Math.floor(heightSegments));
    const gridX1 = gridX + 1;
    const gridY1 = gridY + 1;

    if (rawMap.length !== gridX1 * gridY1) {
      throw new Error(
        `TerrainGeometry: heightmap 长度 ${rawMap.length} 与顶点网格 ${gridX1}*${gridY1}=${gridX1 * gridY1} 不匹配`,
      );
    }

    const heightScale = opts.heightScale ?? 1;
    const widthHalf = width / 2;
    const heightHalf = height / 2;
    const segW = width / gridX;
    const segH = height / gridY;

    // 归一化高度图到 0..1 的 Float32Array
    const heightmap = new Float32Array(rawMap.length);
    if (rawMap instanceof Uint8Array) {
      for (let i = 0; i < rawMap.length; i++) heightmap[i] = rawMap[i] / 255;
    } else {
      heightmap.set(rawMap);
    }

    this.width = width;
    this.height = height;
    this.widthSegments = gridX;
    this.heightSegments = gridY;
    this.heightScale = heightScale;
    this.heightmap = heightmap;
    this.gridX1 = gridX1;
    this.gridY1 = gridY1;

    // ---- position / uv ----
    const positions = new Float32Array(gridX1 * gridY1 * 3);
    const uvs = new Float32Array(gridX1 * gridY1 * 2);
    for (let iy = 0; iy < gridY1; iy++) {
      const z = iy * segH - heightHalf;
      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segW - widthHalf;
        const idx = iy * gridX1 + ix;
        const y = heightmap[idx] * heightScale;
        const p = idx * 3;
        positions[p] = x;
        positions[p + 1] = y;
        positions[p + 2] = z;
        const uv = idx * 2;
        uvs[uv] = ix / gridX;
        uvs[uv + 1] = 1 - iy / gridY;
      }
    }

    // ---- index ----
    const indices: number[] = [];
    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = ix + gridX1 * iy;
        const b = ix + gridX1 * (iy + 1);
        const c = ix + 1 + gridX1 * (iy + 1);
        const d = ix + 1 + gridX1 * iy;
        // 注意绕序:从 +Y 俯视时 CCW 为正面
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    // ---- normal(中心差分) ----
    const normals = new Float32Array(gridX1 * gridY1 * 3);
    for (let iy = 0; iy < gridY1; iy++) {
      for (let ix = 0; ix < gridX1; ix++) {
        const idx = iy * gridX1 + ix;
        // 邻接高度(边界处向外延伸采样自身)
        const ixL = ix > 0 ? ix - 1 : ix;
        const ixR = ix < gridX1 - 1 ? ix + 1 : ix;
        const iyD = iy > 0 ? iy - 1 : iy;
        const iyU = iy < gridY1 - 1 ? iy + 1 : iy;
        const hL = heightmap[iy * gridX1 + ixL] * heightScale;
        const hR = heightmap[iy * gridX1 + ixR] * heightScale;
        const hD = heightmap[iyD * gridX1 + ix] * heightScale;
        const hU = heightmap[iyU * gridX1 + ix] * heightScale;
        // dh/dx ≈ (hR - hL) / (Δx),Δx = (ixR-ixL)*segW
        const dx = (ixR - ixL) * segW;
        const dz = (iyU - iyD) * segH;
        const dhdx = dx > 0 ? (hR - hL) / dx : 0;
        const dhdz = dz > 0 ? (hU - hD) / dz : 0;
        // 法线 ∝ (-dh/dx, 1, -dh/dz)
        let nx = -dhdx;
        let ny = 1;
        let nz = -dhdz;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const p = idx * 3;
        normals[p] = nx;
        normals[p + 1] = ny;
        normals[p + 2] = nz;
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(positions, 3));
    this.setAttribute('normal', new BufferAttribute(normals, 3));
    this.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.computeBoundingBox();
  }

  /**
   * 双线性插值获取某点的世界高度。
   *
   * @param x 世界 X(超出范围会被钳制到边界)
   * @param z 世界 Z(超出范围会被钳制到边界)
   * @returns 该点的世界 Y(已乘 heightScale)
   */
  getHeightAt(x: number, z: number): number {
    const { width, height, widthSegments, heightSegments, heightScale, heightmap, gridX1 } = this;
    const widthHalf = width / 2;
    const heightHalf = height / 2;
    const segW = width / widthSegments;
    const segH = height / heightSegments;

    // 世界 → 网格浮点坐标
    let fx = (x + widthHalf) / segW;
    let fz = (z + heightHalf) / segH;
    // 钳制到 [0, segments]
    if (fx < 0) fx = 0;
    else if (fx > widthSegments) fx = widthSegments;
    if (fz < 0) fz = 0;
    else if (fz > heightSegments) fz = heightSegments;

    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    // 处理右下边界:正好落在 segments 时退化为左上角
    const ix0 = Math.min(ix, widthSegments - 1);
    const iz0 = Math.min(iz, heightSegments - 1);
    const ix1 = ix0 + 1;
    const iz1 = iz0 + 1;
    const tx = fx - ix0;
    const tz = fz - iz0;

    const h00 = heightmap[iz0 * gridX1 + ix0];
    const h10 = heightmap[iz0 * gridX1 + ix1];
    const h01 = heightmap[iz1 * gridX1 + ix0];
    const h11 = heightmap[iz1 * gridX1 + ix1];

    // 双线性插值(高度仍为归一化值)
    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    const h = h0 + (h1 - h0) * tz;
    return h * heightScale;
  }
}
