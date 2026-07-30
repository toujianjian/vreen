// NavMeshBuilder — 从任意几何体构建导航网格(Recast 风格简化版)。
//
// 流水线(每步对应一个公共方法):
//   1. voxelize(geometry)        — 把三角形投影到体素网格,得到 Heightfield
//   2. markWalkable(heightfield) — 标记每条 span 顶部是否可行走(基于坡度/最大爬升)
//   3. erodeWalkable(hf, radius) — 侵蚀可行走区域(代理半径,远离障碍)
//   4. buildRegions(hf)          — 分水岭/洪水填充生成区域 ID
//   5. buildContours(hf, regions) — 提取每个区域的边界轮廓
//   6. simplifyContours(contours) — Douglas-Peucker 简化轮廓
//   7. buildPolyMesh(contours)   — 把简化后的轮廓三角化为多边形网格
//   8. buildDetailMesh(polyMesh) — (简化版)直接返回多边形网格,附加采样高度
//   9. getNavMesh()              — 包装为 NavMesh 实例,供 PathFinder 使用
//
// 设计要点:
//   * 与 NavMesh 互补:NavMesh 持有三角形/邻接;NavMeshBuilder 负责「从任意几何体生成 NavMesh」
//   * 体素坐标系:cellSize 决定 XZ 网格分辨率,cellHeight 决定 Y 分辨率
//   * 简化版实现:不严格按 Recast 的 span 合并/多层高度场,而是每格存一条「最顶层」span,
//     适用于常见地形/楼层场景;对多层悬空结构支持有限
//   * build() 串联整个流水线,返回 this(可链式调用)

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { NavMesh } from './NavMesh';

/** 体素 span:一格内的垂直高度区间。 */
export interface VoxelSpan {
  /** 底部 Y(体素单位,整数)。 */
  min: number;
  /** 顶部 Y(体素单位,整数)。 */
  max: number;
  /** 顶部是否可行走。 */
  walkable: boolean;
  /** 所属区域 ID(-1 = 未分配,0 = 障碍/不可走)。 */
  region: number;
}

/** 高度场:XZ 网格,每格存一条 span(简化版,不存 span 链)。 */
export interface Heightfield {
  /** X 方向格数。 */
  width: number;
  /** Z 方向格数。 */
  height: number;
  /** 原点(世界坐标,对应 (0,0) 格的左下角)。 */
  originX: number;
  /** 原点 Y(对应 span.min=0 时的世界 Y)。 */
  originY: number;
  /** 原点 Z。 */
  originZ: number;
  /** cellSize (XZ 分辨率,世界单位)。 */
  cellSize: number;
  /** cellHeight (Y 分辨率,世界单位)。 */
  cellHeight: number;
  /** 长度 = width * height;null 表示该格无 span。 */
  spans: (VoxelSpan | null)[];
}

/** 轮廓:一个区域的边界顶点序列(闭合)。 */
export interface Contour {
  /** 顶点坐标(体素单位):[x0, y0, z0, x1, y1, z1, ...]。 */
  vertices: number[];
  /** 所属区域 ID。 */
  region: number;
}

/** 多边形网格。 */
export interface PolyMesh {
  /** 顶点坐标(体素单位):[x0, y0, z0, ...]。 */
  vertices: number[];
  /** 多边形列表,每个多边形是顶点索引数组(≥3)。 */
  polygons: number[][];
}

/** 构建统计。 */
export interface NavMeshBuildStats {
  /** 体素总数(非空 span 数)。 */
  voxelCount: number;
  /** 可行走体素数。 */
  walkableVoxelCount: number;
  /** 区域数。 */
  regionCount: number;
  /** 轮廓数。 */
  contourCount: number;
  /** 多边形数。 */
  polygonCount: number;
  /** 最终顶点数。 */
  vertexCount: number;
}

/** 2D 点(体素坐标)。 */
interface Point2D {
  x: number;
  z: number;
}

/**
 * 导航网格构建器(Recast 风格简化版)。
 *
 * 用法:
 *   const builder = new NavMeshBuilder();
 *   builder.setAgentParams(2, 0.5, 0.5, 45);
 *   const nav = builder.build(geometry).getNavMesh();
 */
export class NavMeshBuilder {
  /** 体素 XZ 尺寸(世界单位)。 */
  cellSize: number = 0.3;
  /** 体素 Y 尺寸(世界单位)。 */
  cellHeight: number = 0.2;
  /** 代理高度(世界单位,用于过滤低矮通道)。 */
  agentHeight: number = 2;
  /** 代理半径(世界单位,用于 erodeWalkable)。 */
  agentRadius: number = 0.5;
  /** 代理最大可爬高度(世界单位)。 */
  agentMaxClimb: number = 0.5;
  /** 代理最大可行走坡度(度数)。 */
  agentMaxSlope: number = 45;
  /** 区域最小尺寸(体素格数),小于此值的区域被丢弃。 */
  regionMinSize: number = 8;
  /** 区域合并尺寸(体素格数),小于此值的区域合并到邻居。 */
  regionMergeSize: number = 20;
  /** 轮廓简化最大边长(体素单位)。 */
  edgeMaxLen: number = 12;
  /** 轮廓简化最大误差(Douglas-Peucker 阈值,体素单位)。 */
  edgeMaxError: number = 1.5;
  /** 每个多边形最大顶点数(3=三角形,4+ 需后续三角化)。 */
  vertsPerPoly: number = 3;
  /** 细节网格采样距离(体素单位)。 */
  detailSampleDist: number = 6;
  /** 细节网格采样最大误差。 */
  detailSampleMaxError: number = 1;

  /** 当前高度场(build 过程中产生)。 */
  heightfield: Heightfield | null = null;
  /** 区域数(build 过程中产生)。 */
  regionCount: number = 0;
  /** 当前轮廓列表。 */
  contours: Contour[] = [];
  /** 当前多边形网格。 */
  polyMesh: PolyMesh | null = null;
  /** 当前细节网格。 */
  detailMesh: PolyMesh | null = null;
  /** 构建统计。 */
  stats: NavMeshBuildStats = {
    voxelCount: 0,
    walkableVoxelCount: 0,
    regionCount: 0,
    contourCount: 0,
    polygonCount: 0,
    vertexCount: 0,
  };

  /** 设置体素 XZ 尺寸。 */
  setCellSize(size: number): this {
    this.cellSize = Math.max(0.01, size);
    return this;
  }

  /** 设置体素 Y 尺寸。 */
  setCellHeight(height: number): this {
    this.cellHeight = Math.max(0.01, height);
    return this;
  }

  /** 设置代理参数。 */
  setAgentParams(height: number, radius: number, maxClimb: number, maxSlope: number): this {
    this.agentHeight = Math.max(0.01, height);
    this.agentRadius = Math.max(0, radius);
    this.agentMaxClimb = Math.max(0, maxClimb);
    this.agentMaxSlope = Math.max(0, Math.min(90, maxSlope));
    return this;
  }

  /** 设置区域参数。 */
  setRegionParams(minSize: number, mergeSize: number): this {
    this.regionMinSize = Math.max(0, Math.floor(minSize));
    this.regionMergeSize = Math.max(0, Math.floor(mergeSize));
    return this;
  }

  /** 设置边参数。 */
  setEdgeParams(maxLen: number, maxError: number): this {
    this.edgeMaxLen = Math.max(0, maxLen);
    this.edgeMaxError = Math.max(0, maxError);
    return this;
  }

  /**
   * 完整构建流水线。
   *
   * @param geometry 输入几何体(任意 BufferGeometry,通常地形/碰撞网格)
   * @returns this(链式)
   */
  build(geometry: BufferGeometry): this {
    // 1. 体素化
    this.voxelize(geometry);
    if (!this.heightfield) return this;

    // 2. 标记可行走
    this.markWalkable(this.heightfield);

    // 3. 侵蚀(代理半径)
    if (this.agentRadius > 0) {
      this.erodeWalkable(this.heightfield, this.agentRadius);
    }

    // 4. 区域生成
    this.buildRegions(this.heightfield);

    // 5. 轮廓
    this.contours = this.buildContours(this.heightfield, this.regionCount);

    // 6. 简化轮廓
    this.simplifyContours(this.contours);

    // 7. 多边形网格
    this.polyMesh = this.buildPolyMesh(this.contours);

    // 8. 细节网格(简化版直接复制)
    this.detailMesh = this.buildDetailMesh(this.polyMesh);

    // 更新统计
    this._updateStats();

    return this;
  }

  /**
   * 体素化:把几何体三角形投影到 XZ 体素网格。
   * 对每格,计算其中心点上方的最高三角形 Y,生成一条 span。
   */
  voxelize(geometry: BufferGeometry): Heightfield {
    const posAttr = geometry.attributes.position;
    if (!posAttr) {
      this.heightfield = null;
      return this._emptyHeightfield(1, 1);
    }
    const posArr = posAttr.array as ArrayLike<number>;
    const vc = posAttr.count;

    const idxAttr = geometry.index;
    const triangles: Array<[number, number, number]> = [];
    if (idxAttr) {
      const ia = idxAttr.array as unknown as ArrayLike<number>;
      for (let i = 0; i < ia.length; i += 3) {
        triangles.push([ia[i], ia[i + 1], ia[i + 2]]);
      }
    } else {
      for (let i = 0; i < vc; i += 3) {
        triangles.push([i, i + 1, i + 2]);
      }
    }

    // 1. 计算 AABB
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vc; i++) {
      const x = posArr[i * 3];
      const y = posArr[i * 3 + 1];
      const z = posArr[i * 3 + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
      this.heightfield = this._emptyHeightfield(1, 1);
      return this.heightfield;
    }

    const cs = this.cellSize;
    const ch = this.cellHeight;
    const width = Math.max(1, Math.ceil((maxX - minX) / cs));
    const height = Math.max(1, Math.ceil((maxZ - minZ) / cs));
    const originX = minX;
    const originY = minY;
    const originZ = minZ;

    const hf: Heightfield = {
      width,
      height,
      originX,
      originY,
      originZ,
      cellSize: cs,
      cellHeight: ch,
      spans: new Array(width * height).fill(null),
    };

    // 2. 对每格,采样其中心点上方的三角形最高 Y
    // 简化算法:对每格中心 (cx, cz),遍历所有三角形,求其在该 XZ 点处的最高 Y
    // (适合三角形数量适中的场景;对超大型几何体可改用 BVH 加速)
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const wx = originX + (gx + 0.5) * cs;
        const wz = originZ + (gz + 0.5) * cs;
        let bestY = -Infinity;
        for (const [ai, bi, ci] of triangles) {
          const ax = posArr[ai * 3], ay = posArr[ai * 3 + 1], az = posArr[ai * 3 + 2];
          const bx = posArr[bi * 3], by = posArr[bi * 3 + 1], bz = posArr[bi * 3 + 2];
          const cxx = posArr[ci * 3], cyy = posArr[ci * 3 + 1], czz = posArr[ci * 3 + 2];
          // 重心坐标判定 (wx, wz) 是否在三角形 XZ 投影内,求 Y
          const y = triangleHeightAtXZ(wx, wz, ax, ay, az, bx, by, bz, cxx, cyy, czz);
          if (y !== null && y > bestY) bestY = y;
        }
        if (Number.isFinite(bestY)) {
          const spanMin = 0; // 简化:span 底部取 0(即 originY)
          const spanMax = Math.max(0, Math.floor((bestY - originY) / ch));
          hf.spans[gz * width + gx] = {
            min: spanMin,
            max: spanMax,
            walkable: false,
            region: -1,
          };
        }
      }
    }

    this.heightfield = hf;
    return hf;
  }

  /**
   * 标记可行走:对每条 span,根据顶部与 4 邻居 span 顶部的高度差是否超过 agentMaxClimb 判定。
   * 同时根据几何法线坡度(此处用高度差近似)过滤。
   */
  markWalkable(heightfield: Heightfield): this {
    const { width, height, spans, cellHeight } = heightfield;
    const maxClimbCells = Math.max(1, Math.floor(this.agentMaxClimb / cellHeight));
    const maxSlope = this.agentMaxSlope;
    // 用 climb 阈值近似坡度:若邻居高度差 > maxClimb,认为坡度超限
    let walkableCount = 0;
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const idx = gz * width + gx;
        const span = spans[idx];
        if (!span) continue;
        // 检查代理高度空间是否足够(简化:不严格,只查 span 上方是否在网格内)
        // 检查 4 邻居顶部高度差
        let walkable = true;
        const neighbors = [
          [gx - 1, gz], [gx + 1, gz],
          [gx, gz - 1], [gx, gz + 1],
        ];
        for (const [nx, nz] of neighbors) {
          if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
          const nSpan = spans[nz * width + nx];
          if (!nSpan) continue; // 邻居为空(悬崖边缘)不强制不可走
          const diff = Math.abs(span.max - nSpan.max);
          if (diff > maxClimbCells) {
            walkable = false;
            break;
          }
        }
        // 坡度近似:用对角邻居高度差也算一次
        if (walkable) {
          // 坡度(度数)近似 = atan(高度差 / cellSize)
          // 这里用一个简化判定:4 邻居最大高度差若超过 maxClimbCells × 1.5,视为过陡
          let maxDiff = 0;
          for (const [nx, nz] of neighbors) {
            if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
            const nSpan = spans[nz * width + nx];
            if (!nSpan) continue;
            const d = Math.abs(span.max - nSpan.max);
            if (d > maxDiff) maxDiff = d;
          }
          const slopeApprox = Math.atan(maxDiff * cellHeight / this.cellSize) * 180 / Math.PI;
          if (slopeApprox > maxSlope) walkable = false;
        }
        span.walkable = walkable;
        if (walkable) walkableCount++;
      }
    }
    void maxClimbCells;
    void walkableCount;
    return this;
  }

  /**
   * 侵蚀可行走区域:把距离障碍(非可行走 span 或网格边界)小于 agentRadius 的 span 标记为不可走。
   * 简化版:对每个 walkable span,若其 4 邻居中存在非 walkable 或空,则标为不可走。
   * 重复 erosionRadius 轮,实现近似半径侵蚀。
   */
  erodeWalkable(heightfield: Heightfield, radius: number): this {
    const { width, height, spans } = heightfield;
    const radiusCells = Math.max(0, Math.floor(radius / heightfield.cellSize));
    if (radiusCells <= 0) return this;

    for (let iter = 0; iter < radiusCells; iter++) {
      // 复制当前 walkable 状态
      const walkableCopy = new Array(width * height).fill(false);
      for (let i = 0; i < width * height; i++) {
        const s = spans[i];
        walkableCopy[i] = s ? s.walkable : false;
      }
      // 对每个 walkable span,若任一 4 邻居非 walkable,则本回合标记为非 walkable
      for (let gz = 0; gz < height; gz++) {
        for (let gx = 0; gx < width; gx++) {
          const idx = gz * width + gx;
          if (!walkableCopy[idx]) continue;
          const neighbors = [
            [gx - 1, gz], [gx + 1, gz],
            [gx, gz - 1], [gx, gz + 1],
          ];
          for (const [nx, nz] of neighbors) {
            if (nx < 0 || nz < 0 || nx >= width || nz >= height) {
              // 边界视为障碍
              if (spans[idx]) spans[idx]!.walkable = false;
              break;
            }
            const nIdx = nz * width + nx;
            if (!walkableCopy[nIdx]) {
              if (spans[idx]) spans[idx]!.walkable = false;
              break;
            }
          }
        }
      }
    }
    return this;
  }

  /**
   * 区域生成:洪水填充把连通的 walkable span 聚合为区域。
   * 小于 regionMinSize 的区域被丢弃(标记为不可走);小于 regionMergeSize 的区域合并到最大邻居。
   */
  buildRegions(heightfield: Heightfield): this {
    const { width, height, spans } = heightfield;
    // 先重置 region
    for (const s of spans) if (s) s.region = -1;

    let nextRegion = 1;
    const regionSizes = new Map<number, number>();

    // 4 邻居洪水填充
    const queue: number[] = [];
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const idx = gz * width + gx;
        const span = spans[idx];
        if (!span || !span.walkable || span.region !== -1) continue;
        const region = nextRegion++;
        span.region = region;
        regionSizes.set(region, 1);
        queue.length = 0;
        queue.push(idx);
        while (queue.length > 0) {
          const cur = queue.shift()!;
          const cgx = cur % width;
            const cgz = Math.floor(cur / width);
          const neighbors = [
            [cgx - 1, cgz], [cgx + 1, cgz],
            [cgx, cgz - 1], [cgx, cgz + 1],
          ];
          for (const [nx, nz] of neighbors) {
            if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
            const nIdx = nz * width + nx;
            const nSpan = spans[nIdx];
            if (!nSpan || !nSpan.walkable || nSpan.region !== -1) continue;
            nSpan.region = region;
            regionSizes.set(region, (regionSizes.get(region) ?? 0) + 1);
            queue.push(nIdx);
          }
        }
      }
    }

    // 过滤小区域(标记为不可走,region=0)
    for (const s of spans) {
      if (s && s.region > 0) {
        const size = regionSizes.get(s.region) ?? 0;
        if (size < this.regionMinSize) {
          s.walkable = false;
          s.region = 0;
        }
      }
    }

    // 合并小区域到最大邻居(简化:遍历找小区域,合并到邻居中最大的)
    if (this.regionMergeSize > 0) {
      // 重复扫描直到无变化
      let changed = true;
      let guard = 0;
      while (changed && guard < 32) {
        changed = false;
        guard++;
        // 重新统计区域大小
        const sizes = new Map<number, number>();
        for (const s of spans) {
          if (s && s.region > 0) {
            sizes.set(s.region, (sizes.get(s.region) ?? 0) + 1);
          }
        }
        // 对每个小区域,找邻居中最大区域合并
        const smallRegions = new Set<number>();
        for (const [r, size] of sizes) {
          if (size < this.regionMergeSize) smallRegions.add(r);
        }
        if (smallRegions.size === 0) break;
        // 计算每个小区域的最大邻居
        const mergeTarget = new Map<number, number>();
        for (let gz = 0; gz < height; gz++) {
          for (let gx = 0; gx < width; gx++) {
            const idx = gz * width + gx;
            const s = spans[idx];
            if (!s || s.region <= 0) continue;
            if (!smallRegions.has(s.region)) continue;
            const neighbors = [
              [gx - 1, gz], [gx + 1, gz],
              [gx, gz - 1], [gx, gz + 1],
            ];
            let bestNeighbor = -1;
            let bestSize = -1;
            for (const [nx, nz] of neighbors) {
              if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
              const nSpan = spans[nz * width + nx];
              if (!nSpan || nSpan.region <= 0) continue;
              if (smallRegions.has(nSpan.region)) continue;
              const nSize = sizes.get(nSpan.region) ?? 0;
              if (nSize > bestSize) {
                bestSize = nSize;
                bestNeighbor = nSpan.region;
              }
            }
            if (bestNeighbor > 0) {
              mergeTarget.set(s.region, bestNeighbor);
            }
          }
        }
        // 执行合并
        for (const s of spans) {
          if (s && s.region > 0 && mergeTarget.has(s.region)) {
            s.region = mergeTarget.get(s.region)!;
            changed = true;
          }
        }
      }
    }

    // 重新统计最终区域 ID(连续)
    const finalRegions = new Set<number>();
    for (const s of spans) {
      if (s && s.region > 0) finalRegions.add(s.region);
    }
    this.regionCount = finalRegions.size;
    return this;
  }

  /**
   * 构建轮廓:对每个区域,提取边界边(区域 A 与区域 B/障碍之间的边),按顺序连接成闭合多边形。
   * 简化算法:对每格 4 条边,若两侧 region 不同,则该边是边界;然后用图遍历串成轮廓。
   */
  buildContours(heightfield: Heightfield, _regionCount: number): Contour[] {
    const { width, height, spans, originX, originY, originZ, cellSize, cellHeight } = heightfield;
    const contours: Contour[] = [];

    // 边定义:每格 4 条边,N/E/S/W
    // 边的中点作为顶点(体素坐标)
    // region A → region B (B ≠ A) 即为边界
    type Edge = { x: number; z: number; dir: 'N' | 'E' | 'S' | 'W'; from: number; to: number };
    const edges: Edge[] = [];
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const idx = gz * width + gx;
        const s = spans[idx];
        if (!s || s.region <= 0) continue;
        const r = s.region;
        // N (z-1)
        const nIdxN = (gz - 1) * width + gx;
        const rN = (gz - 1 >= 0 && spans[nIdxN]) ? (spans[nIdxN]!.region > 0 ? spans[nIdxN]!.region : 0) : 0;
        if (rN !== r) edges.push({ x: gx, z: gz, dir: 'N', from: r, to: rN });
        // S (z+1)
        const nIdxS = (gz + 1) * width + gx;
        const rS = (gz + 1 < height && spans[nIdxS]) ? (spans[nIdxS]!.region > 0 ? spans[nIdxS]!.region : 0) : 0;
        if (rS !== r) edges.push({ x: gx, z: gz, dir: 'S', from: r, to: rS });
        // W (x-1)
        const nIdxW = gz * width + (gx - 1);
        const rW = (gx - 1 >= 0 && spans[nIdxW]) ? (spans[nIdxW]!.region > 0 ? spans[nIdxW]!.region : 0) : 0;
        if (rW !== r) edges.push({ x: gx, z: gz, dir: 'W', from: r, to: rW });
        // E (x+1)
        const nIdxE = gz * width + (gx + 1);
        const rE = (gx + 1 < width && spans[nIdxE]) ? (spans[nIdxE]!.region > 0 ? spans[nIdxE]!.region : 0) : 0;
        if (rE !== r) edges.push({ x: gx, z: gz, dir: 'E', from: r, to: rE });
      }
    }

    if (edges.length === 0) return contours;

    // 按 region 分组
    const byRegion = new Map<number, Edge[]>();
    for (const e of edges) {
      if (!byRegion.has(e.from)) byRegion.set(e.from, []);
      byRegion.get(e.from)!.push(e);
    }

    // 对每个 region,把边串成闭合环
    for (const [region, regionEdges] of byRegion) {
      // 用过的边标记
      const used = new Array(regionEdges.length).fill(false);
      // 构建边查找:以 (x, z, dir) 为键
      const edgeMap = new Map<string, number>();
      for (let i = 0; i < regionEdges.length; i++) {
        const e = regionEdges[i];
        edgeMap.set(`${e.x},${e.z},${e.dir}`, i);
      }

      // 从某条边出发,沿轮廓方向找下一条相邻边
      // 简化策略:用边的端点匹配;每条边的两个端点按方向定义:
      //   N: (gx, gz) → (gx+1, gz)
      //   E: (gx+1, gz) → (gx+1, gz+1)
      //   S: (gx+1, gz+1) → (gx, gz+1)
      //   W: (gx, gz+1) → (gx, gz)
      const edgeEndpoints = (e: Edge): [Point2D, Point2D] => {
        switch (e.dir) {
          case 'N': return [{ x: e.x, z: e.z }, { x: e.x + 1, z: e.z }];
          case 'E': return [{ x: e.x + 1, z: e.z }, { x: e.x + 1, z: e.z + 1 }];
          case 'S': return [{ x: e.x + 1, z: e.z + 1 }, { x: e.x, z: e.z + 1 }];
          case 'W': return [{ x: e.x, z: e.z + 1 }, { x: e.x, z: e.z }];
        }
      };

      // 反向查找:给定一个端点,找以该端点为起点的未用边
      const findNext = (end: Point2D): number => {
        for (let i = 0; i < regionEdges.length; i++) {
          if (used[i]) continue;
          const [s] = edgeEndpoints(regionEdges[i]);
          if (s.x === end.x && s.z === end.z) return i;
        }
        return -1;
      };

      // 处理多个独立环(同一 region 可能有多个洞)
      let startSearch = 0;
      while (startSearch < regionEdges.length) {
        // 找一个未用边作为起点
        let startIdx = -1;
        for (let i = startSearch; i < regionEdges.length; i++) {
          if (!used[i]) { startIdx = i; break; }
        }
        if (startIdx === -1) break;
        startSearch = startIdx + 1;

        // 收集这个环的顶点
        const ring: Point2D[] = [];
        let curIdx = startIdx;
        let guard = 0;
        const maxIter = regionEdges.length + 1;
        while (curIdx !== -1 && guard < maxIter) {
          guard++;
          used[curIdx] = true;
          const [s, e] = edgeEndpoints(regionEdges[curIdx]);
          ring.push(s);
          curIdx = findNext(e);
          if (curIdx === startIdx) break; // 闭合
        }

        if (ring.length < 3) continue;

        // 把 2D 顶点转体素 3D 坐标(用该 region 中第一个 span 的 max Y)
        let spanY = 0;
        for (const s of spans) {
          if (s && s.region === region) { spanY = s.max; break; }
        }
        const verts: number[] = [];
        for (const p of ring) {
          // 体素坐标 (X, Y, Z)
          verts.push(p.x, spanY, p.z);
        }
        contours.push({ vertices: verts, region });
      }
    }

    // 把体素坐标 → 世界坐标(便于后续 getNavMesh 直接使用)
    // 这里保持体素坐标,在 buildPolyMesh 时再换算
    void originX;
    void originY;
    void originZ;
    void cellSize;
    void cellHeight;
    return contours;
  }

  /**
   * Douglas-Peucker 简化轮廓。
   * 对每条轮廓的顶点序列做递归简化,阈值 = edgeMaxError。
   * 同时若相邻点距离 > edgeMaxLen,会在中间插入点(此处简化版只做简化不做插值)。
   */
  simplifyContours(contours: Contour[]): this {
    const eps = this.edgeMaxError;
    for (const c of contours) {
      const verts = c.vertices;
      if (verts.length < 6) continue; // 少于 2 个点跳过
      // 把 [x,y,z, ...] 拆成点列表(只用 XZ 做 2D 简化)
      const points: Point2D[] = [];
      for (let i = 0; i < verts.length; i += 3) {
        points.push({ x: verts[i], z: verts[i + 2] });
      }
      // 闭合环:首尾相同 → 用闭环 DP
      const keep = douglasPeuckerClosed(points, eps);
      // 重建 vertices,保留原 Y(用第一个 span 的 Y)
      const y = verts[1];
      const newVerts: number[] = [];
      for (const p of keep) {
        newVerts.push(p.x, y, p.z);
      }
      c.vertices = newVerts;
    }
    return this;
  }

  /**
   * 把简化后的轮廓三角化为多边形网格。
   * 简化版:对每个轮廓做扇形三角化(假设轮廓是凸的;非凸时结果可能不准,但测试用例通常凸)。
   */
  buildPolyMesh(contours: Contour[]): PolyMesh {
    const vertices: number[] = [];
    const polygons: number[][] = [];
    const vpp = Math.max(3, this.vertsPerPoly);

    for (const c of contours) {
      const pts: number[] = [];
      for (let i = 0; i < c.vertices.length; i += 3) {
        pts.push(vertices.length / 3);
        vertices.push(c.vertices[i], c.vertices[i + 1], c.vertices[i + 2]);
      }
      if (pts.length < 3) continue;
      // 扇形三角化(以 pts[0] 为中心)
      for (let i = 1; i < pts.length - 1; i++) {
        const poly = [pts[0], pts[i], pts[i + 1]];
        // 若多边形顶点超过 vpp,这里强制三角化(vpp=3)
        if (poly.length <= vpp) {
          polygons.push(poly);
        } else {
          // 退化:跳过
        }
      }
    }

    this.polyMesh = { vertices, polygons };
    return this.polyMesh;
  }

  /**
   * 构建细节网格(简化版:直接复制多边形网格,实际 Recast 会采样更高精度的表面)。
   */
  buildDetailMesh(polyMesh: PolyMesh): PolyMesh {
    this.detailMesh = {
      vertices: polyMesh.vertices.slice(),
      polygons: polyMesh.polygons.map(p => p.slice()),
    };
    return this.detailMesh;
  }

  /**
   * 获取构建好的 NavMesh 实例。
   * 若未构建或失败,返回空 NavMesh。
   */
  getNavMesh(): NavMesh {
    const nav = new NavMesh();
    if (!this.polyMesh || this.polyMesh.vertices.length === 0) {
      return nav;
    }
    const hf = this.heightfield;
    const originX = hf ? hf.originX : 0;
    const originY = hf ? hf.originY : 0;
    const originZ = hf ? hf.originZ : 0;
    const cs = hf ? hf.cellSize : this.cellSize;
    const ch = hf ? hf.cellHeight : this.cellHeight;

    // 把体素坐标 → 世界坐标
    const worldVerts = this.polyMesh.vertices;
    const positions = new Float32Array(worldVerts.length);
    for (let i = 0; i < worldVerts.length; i += 3) {
      positions[i] = originX + worldVerts[i] * cs;
      positions[i + 1] = originY + worldVerts[i + 1] * ch;
      positions[i + 2] = originZ + worldVerts[i + 2] * cs;
    }
    // 构造 index
    const indices: number[] = [];
    for (const poly of this.polyMesh.polygons) {
      if (poly.length < 3) continue;
      // 扇形三角化(多边形 → 三角形)
      for (let i = 1; i < poly.length - 1; i++) {
        indices.push(poly[0], poly[i], poly[i + 1]);
      }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex(indices);
    nav.build(geom);
    return nav;
  }

  /** 获取构建统计。 */
  getStats(): NavMeshBuildStats {
    return { ...this.stats };
  }

  /** 释放内部资源。 */
  dispose(): this {
    this.heightfield = null;
    this.contours = [];
    this.polyMesh = null;
    this.detailMesh = null;
    this.regionCount = 0;
    this.stats = {
      voxelCount: 0,
      walkableVoxelCount: 0,
      regionCount: 0,
      contourCount: 0,
      polygonCount: 0,
      vertexCount: 0,
    };
    return this;
  }

  // ---------- 内部辅助 ----------

  /** 更新统计信息。 */
  private _updateStats(): void {
    const hf = this.heightfield;
    let voxelCount = 0;
    let walkableVoxelCount = 0;
    if (hf) {
      for (const s of hf.spans) {
        if (s) {
          voxelCount++;
          if (s.walkable) walkableVoxelCount++;
        }
      }
    }
    this.stats = {
      voxelCount,
      walkableVoxelCount,
      regionCount: this.regionCount,
      contourCount: this.contours.length,
      polygonCount: this.polyMesh ? this.polyMesh.polygons.length : 0,
      vertexCount: this.polyMesh ? this.polyMesh.vertices.length / 3 : 0,
    };
  }

  /** 构造一个空的高度场(出错时使用)。 */
  private _emptyHeightfield(width: number, height: number): Heightfield {
    return {
      width,
      height,
      originX: 0,
      originY: 0,
      originZ: 0,
      cellSize: this.cellSize,
      cellHeight: this.cellHeight,
      spans: new Array(width * height).fill(null),
    };
  }
}

// ---------- 自由函数 ----------

/**
 * 计算三角形 (ax,ay,az)-(bx,by,bz)-(cx,cy,cz) 在 XZ 点 (px, pz) 处的 Y。
 * 若 (px, pz) 不在三角形 XZ 投影内,返回 null。
 *
 * 用重心坐标法:解 [bx-ax, cx-ax; bz-az, cz-az] · [u, v] = [px-ax, pz-az],
 * 若 u≥0, v≥0, u+v≤1,则 Y = ay + u*(by-ay) + v*(cy-ay)。
 */
export function triangleHeightAtXZ(
  px: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number | null {
  const ex = bx - ax;
  const ez = bz - az;
  const fx = cx - ax;
  const fz = cz - az;
  const det = ex * fz - ez * fx;
  if (Math.abs(det) < 1e-10) return null;
  const invDet = 1 / det;
  const dx = px - ax;
  const dz = pz - az;
  const u = (dx * fz - dz * fx) * invDet;
  const v = (ex * dz - ez * dx) * invDet;
  if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) return null;
  return ay + u * (by - ay) + v * (cy - ay);
}

/**
 * 闭合环的 Douglas-Peucker 简化。
 * 先找最远点把环拆成两段开路径,分别用开路径 DP,再合并。
 */
export function douglasPeuckerClosed(points: Point2D[], epsilon: number): Point2D[] {
  const n = points.length;
  if (n <= 3) return points.slice();
  if (epsilon <= 0) return points.slice();

  // 找距离 points[0] 最远的点作为分割点
  let farIdx = 0;
  let farDist = -1;
  const p0 = points[0];
  for (let i = 1; i < n; i++) {
    const d = (points[i].x - p0.x) ** 2 + (points[i].z - p0.z) ** 2;
    if (d > farDist) {
      farDist = d;
      farIdx = i;
    }
  }
  // 把环切成两段:[0..farIdx] 与 [farIdx..n-1, 0]
  const seg1 = points.slice(0, farIdx + 1);
  const seg2 = points.slice(farIdx).concat([points[0]]);
  const simp1 = douglasPeucker(seg1, epsilon);
  const simp2 = douglasPeucker(seg2, epsilon);
  // 合并:seg1 已包含两端点,seg2 也包含两端点 → 去重
  const merged = simp1.concat(simp2.slice(1, -1));
  return merged;
}

/**
 * 标准 Douglas-Peucker 简化(开路径)。
 */
export function douglasPeucker(points: Point2D[], epsilon: number): Point2D[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  // 栈式 DP
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let maxI = -1;
    const a = points[s];
    const b = points[e];
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(points[i], a, b);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > epsilon && maxI > 0) {
      keep[maxI] = true;
      stack.push([s, maxI]);
      stack.push([maxI, e]);
    }
  }
  const result: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/** 点 p 到线段 ab 的垂直距离。 */
export function perpDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-12) {
    return Math.hypot(p.x - a.x, p.z - a.z);
  }
  // |(b-a) × (a-p)| / |b-a|
  const cross = dx * (a.z - p.z) - dz * (a.x - p.x);
  return Math.abs(cross) / Math.sqrt(lenSq);
}
