// NavMesh — 导航网格,由三角形面片构成的可行走区域。
//
// 设计要点:
//   * 三角形作为最小寻路单元,相邻三角形通过共享边连接
//   * 每条边记录左/右两侧三角形索引,便于邻接遍历
//   * 顶点位置以 XZ 平面投影为主(2.5D),Y 分量保留用于爬坡高度判定
//   * 可行走性判定:点是否落在某三角形内(含边缘)
//   * A* 寻路委托 PathFinder 实现;本类只提供网格查询
//
// 与 Terrain 的关系:
//   * build(geometry) 直接消费 BufferGeometry 的 position/index
//   * buildFromHeightmap(heights, w, h, scale) 把规则高度网格三角化为两个三角形/格

import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';
import { Box3 } from '../Math';
import { PathFinder } from './PathFinder';

/** 导航三角形:三个顶点索引 + 邻居三角形索引列表 + 缓存的几何信息。 */
export interface NavTriangle {
  /** 顶点 a 的索引(在 NavMesh.vertices 中)。 */
  a: number;
  /** 顶点 b 的索引。 */
  b: number;
  /** 顶点 c 的索引。 */
  c: number;
  /** 三角形中心,用于 A* 启发式与邻居遍历。 */
  center: Vector3;
  /** 三角形面积(= |ab × ac| / 2),用于面积过滤。 */
  area: number;
  /** 法线(已归一化),用于坡度过滤。 */
  normal: Vector3;
  /** 邻接三角形索引列表(最多 3 个)。 */
  neighbors: number[];
}

/** 导航边:两个顶点索引 + 左右两侧三角形索引(-1 表示无三角形)。 */
export interface NavEdge {
  /** 顶点 a 的索引。 */
  a: number;
  /** 顶点 b 的索引。 */
  b: number;
  /** 左侧三角形索引(按 a→b 方向)。 */
  leftTri: number;
  /** 右侧三角形索引。 */
  rightTri: number;
}

/** 可行走区域的最大坡度(法线 Y 分量,>= 此值才可行走)。 */
const DEFAULT_WALKABLE_NORMAL_Y = 0.7; // cos(约 45°)

/** NavMesh 序列化结构(往返 JSON)。 */
export interface NavMeshJSON {
  vertices: number[][]; // [[x,y,z], ...]
  triangles: Array<{
    a: number;
    b: number;
    c: number;
    neighbors: number[];
  }>;
}

/** 重心坐标判定 point 是否在三角形 (a, b, c) 内(投影到 XZ 平面)。 */
function pointInTriangleXZ(
  px: number,
  pz: number,
  ax: number, az: number,
  bx: number, bz: number,
  cx: number, cz: number,
): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * 导航网格 — 三角形面片集合 + 邻接关系 + 寻路查询。
 *
 * 用法:
 *   const nav = new NavMesh();
 *   nav.build(geometry);
 *   const path = nav.findPath(start, end);
 */
export class NavMesh {
  /** 三角形列表,索引即三角形 ID。 */
  triangles: NavTriangle[] = [];
  /** 顶点列表(共享)。 */
  vertices: Vector3[] = [];
  /** 邻接边列表(共享边的去重视图)。 */
  edges: NavEdge[] = [];
  /** 包围盒(构建后由 computeBoundingBox 计算)。 */
  boundingBox: Box3 = new Box3();
  /** 可行走法线 Y 最小值,小于此值的三角形视为障碍。 */
  walkableNormalY: number = DEFAULT_WALKABLE_NORMAL_Y;
  /** 可行走三角形最大面积(0 表示不限制)。 */
  maxTriangleArea: number = 0;

  /** 从 BufferGeometry 构建导航网格。 */
  build(geometry: BufferGeometry): this {
    this.clear();

    const posAttr = geometry.attributes.position;
    if (!posAttr) return this;
    const idxAttr = geometry.index;

    // 1. 拷贝顶点
    const posArr = posAttr.array;
    const vc = posAttr.count;
    this.vertices = new Array(vc);
    for (let i = 0; i < vc; i++) {
      this.vertices[i] = new Vector3(
        posArr[i * 3],
        posArr[i * 3 + 1],
        posArr[i * 3 + 2],
      );
    }

    // 2. 构造三角形
    const addTri = (a: number, b: number, c: number) => {
      const va = this.vertices[a];
      const vb = this.vertices[b];
      const vc2 = this.vertices[c];
      if (!va || !vb || !vc2) return;
      // 退化三角形(零面积)跳过
      const ex = vb.x - va.x, ey = vb.y - va.y, ez = vb.z - va.z;
      const fx = vc2.x - va.x, fy = vc2.y - va.y, fz = vc2.z - va.z;
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;
      const areaSq = nx * nx + ny * ny + nz * nz;
      if (areaSq < 1e-10) return;
      const area = Math.sqrt(areaSq) * 0.5;
      const invLen = 1 / (area * 2);
      this.triangles.push({
        a, b, c,
        center: new Vector3(
          (va.x + vb.x + vc2.x) / 3,
          (va.y + vb.y + vc2.y) / 3,
          (va.z + vb.z + vc2.z) / 3,
        ),
        area,
        normal: new Vector3(nx * invLen, ny * invLen, nz * invLen),
        neighbors: [],
      });
    };

    if (idxAttr) {
      const ia = idxAttr.array as unknown as ArrayLike<number>;
      for (let i = 0; i < ia.length; i += 3) {
        addTri(ia[i], ia[i + 1], ia[i + 2]);
      }
    } else {
      for (let i = 0; i < vc; i += 3) {
        addTri(i, i + 1, i + 2);
      }
    }

    this.computeBoundingBox();
    this.buildAdjacency();
    return this;
  }

  /** 从规则高度图构建导航网格。
   *  heights: 长度 = width * height 的网格高度数据
   *  scale: 每格的世界尺寸(米/格)
   *  高度直接取 heights[i] 作为 Y 坐标 */
  buildFromHeightmap(
    heights: ArrayLike<number>,
    width: number,
    height: number,
    scale: number,
  ): this {
    if (width < 2 || height < 2) {
      throw new Error(`NavMesh.buildFromHeightmap: 网格至少 2x2,收到 ${width}x${height}`);
    }
    if (heights.length < width * height) {
      throw new Error(`NavMesh.buildFromHeightmap: 高度数据长度 ${heights.length} < ${width * height}`);
    }

    this.clear();

    // 1. 顶点
    const halfW = (width - 1) * scale * 0.5;
    const halfH = (height - 1) * scale * 0.5;
    this.vertices = new Array(width * height);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const idx = j * width + i;
        this.vertices[idx] = new Vector3(
          i * scale - halfW,
          heights[idx],
          j * scale - halfH,
        );
      }
    }

    // 2. 三角形(每格 2 个三角形)
    for (let j = 0; j < height - 1; j++) {
      for (let i = 0; i < width - 1; i++) {
        const a = j * width + i;
        const b = (j + 1) * width + i;
        const c = (j + 1) * width + (i + 1);
        const d = j * width + (i + 1);
        // 三角形 1: a, b, c
        this.pushTriangle(a, b, c);
        // 三角形 2: a, c, d
        this.pushTriangle(a, c, d);
      }
    }

    this.computeBoundingBox();
    this.buildAdjacency();
    return this;
  }

  /** 内部:压入一个三角形(假设顶点已存在)。 */
  private pushTriangle(ai: number, bi: number, ci: number): void {
    const va = this.vertices[ai];
    const vb = this.vertices[bi];
    const vc = this.vertices[ci];
    if (!va || !vb || !vc) return;
    const ex = vb.x - va.x, ey = vb.y - va.y, ez = vb.z - va.z;
    const fx = vc.x - va.x, fy = vc.y - va.y, fz = vc.z - va.z;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const areaSq = nx * nx + ny * ny + nz * nz;
    if (areaSq < 1e-10) return;
    const area = Math.sqrt(areaSq) * 0.5;
    const invLen = 1 / (area * 2);
    this.triangles.push({
      a: ai, b: bi, c: ci,
      center: new Vector3(
        (va.x + vb.x + vc.x) / 3,
        (va.y + vb.y + vc.y) / 3,
        (va.z + vb.z + vc.z) / 3,
      ),
      area,
      normal: new Vector3(nx * invLen, ny * invLen, nz * invLen),
      neighbors: [],
    });
  }

  /** 构建邻接关系:对每个三角形,找到共享边的相邻三角形。
   *  同时构建去重后的 edges 列表。
   *  调用前会先清空所有 neighbors 数组,因此 deserialize 后调用是幂等的。 */
  private buildAdjacency(): void {
    // 先清空 neighbors(deserialize 时已从 JSON 还原,这里重建覆盖)
    for (const tri of this.triangles) tri.neighbors.length = 0;

    // 边键:小索引在前,逗号分隔。值:第一次遇到此边的三角形索引。
    const edgeMap = new Map<string, { tri: number; a: number; b: number }>();
    this.edges = [];

    for (let ti = 0; ti < this.triangles.length; ti++) {
      const tri = this.triangles[ti];
      const idx = [tri.a, tri.b, tri.c];
      for (let e = 0; e < 3; e++) {
        const a = idx[e];
        const b = idx[(e + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const existing = edgeMap.get(key);
        if (existing) {
          // 双向连接邻居(去重:确保不重复加入同一邻居)
          if (!tri.neighbors.includes(existing.tri) && tri.neighbors.length < 3) {
            tri.neighbors.push(existing.tri);
          }
          const other = this.triangles[existing.tri];
          if (other && !other.neighbors.includes(ti) && other.neighbors.length < 3) {
            other.neighbors.push(ti);
          }
          this.edges.push({
            a: existing.a,
            b: existing.b,
            leftTri: existing.tri,
            rightTri: ti,
          });
          // 已处理的边从 map 移除,后续不会再被识别为边界边
          edgeMap.delete(key);
        } else {
          edgeMap.set(key, { tri: ti, a: a < b ? a : b, b: a < b ? b : a });
        }
      }
    }

    // 剩余在 edgeMap 中的是无邻居的边界边
    for (const [, info] of edgeMap) {
      this.edges.push({
        a: info.a,
        b: info.b,
        leftTri: info.tri,
        rightTri: -1,
      });
    }
  }

  /** 重算包围盒。 */
  computeBoundingBox(): void {
    this.boundingBox.makeEmpty();
    for (const v of this.vertices) this.boundingBox.expandByPoint(v);
  }

  /** 清空所有数据。 */
  clear(): this {
    this.triangles = [];
    this.vertices = [];
    this.edges = [];
    this.boundingBox.makeEmpty();
    return this;
  }

  /** 获取所有三角形(只读视图)。 */
  getTriangles(): readonly NavTriangle[] {
    return this.triangles;
  }

  /** 判断点是否可行走(在某三角形内,且三角形坡度/面积满足限制)。 */
  isWalkable(point: Vector3): boolean {
    const tri = this.findTriangle(point);
    if (tri === -1) return false;
    const t = this.triangles[tri];
    if (t.normal.y < this.walkableNormalY) return false;
    if (this.maxTriangleArea > 0 && t.area > this.maxTriangleArea) return false;
    return true;
  }

  /** 找到包含 point 的三角形索引(投影到 XZ 平面判定);找不到返回 -1。 */
  findTriangle(point: Vector3): number {
    for (let i = 0; i < this.triangles.length; i++) {
      const t = this.triangles[i];
      const va = this.vertices[t.a];
      const vb = this.vertices[t.b];
      const vc = this.vertices[t.c];
      if (!va || !vb || !vc) continue;
      if (pointInTriangleXZ(
        point.x, point.z,
        va.x, va.z,
        vb.x, vb.z,
        vc.x, vc.z,
      )) {
        return i;
      }
    }
    return -1;
  }

  /** 获取离 point 最近的可行走点。
   *  若 point 在可行走三角形内,直接返回 point.clone。
   *  否则寻找三角形中心离 point 最近的可行走三角形,返回其中心。 */
  getClosestPoint(point: Vector3): Vector3 {
    if (this.isWalkable(point)) return point.clone();

    let bestTri = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.triangles.length; i++) {
      const t = this.triangles[i];
      if (t.normal.y < this.walkableNormalY) continue;
      if (this.maxTriangleArea > 0 && t.area > this.maxTriangleArea) continue;
      const d = t.center.distanceToSquared(point);
      if (d < bestDist) {
        bestDist = d;
        bestTri = i;
      }
    }
    if (bestTri === -1) return point.clone();
    return this.triangles[bestTri].center.clone();
  }

  /** A* 寻路:start→end,返回世界坐标路径点数组。
   *  若起终点任一不在导航网格上,先吸附到最近可行走点。 */
  findPath(start: Vector3, end: Vector3): Vector3[] {
    const finder = new PathFinder(this);
    return finder.findPath(start, end);
  }

  /** 序列化为 JSON(往返还原)。 */
  serialize(): NavMeshJSON {
    return {
      vertices: this.vertices.map(v => [v.x, v.y, v.z]),
      triangles: this.triangles.map(t => ({
        a: t.a, b: t.b, c: t.c, neighbors: t.neighbors.slice(),
      })),
    };
  }

  /** 从 JSON 反序列化(替换当前数据)。 */
  deserialize(data: NavMeshJSON): this {
    this.clear();
    this.vertices = data.vertices.map(arr => new Vector3(arr[0], arr[1], arr[2]));
    this.triangles = data.triangles.map(td => {
      const va = this.vertices[td.a];
      const vb = this.vertices[td.b];
      const vc = this.vertices[td.c];
      const ex = vb.x - va.x, ey = vb.y - va.y, ez = vb.z - va.z;
      const fx = vc.x - va.x, fy = vc.y - va.y, fz = vc.z - va.z;
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;
      const area = Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
      const invLen = area > 1e-10 ? 1 / (area * 2) : 0;
      return {
        a: td.a, b: td.b, c: td.c,
        center: new Vector3(
          (va.x + vb.x + vc.x) / 3,
          (va.y + vb.y + vc.y) / 3,
          (va.z + vb.z + vc.z) / 3,
        ),
        area,
        normal: new Vector3(nx * invLen, ny * invLen, nz * invLen),
        neighbors: td.neighbors.slice(),
      };
    });
    this.computeBoundingBox();
    this.buildAdjacency();
    return this;
  }
}
