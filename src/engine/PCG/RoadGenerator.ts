// RoadGenerator — 程序化道路生成器(样条曲线 + 地形跟随 + 交叉路口)。
//
// 由一组控制点驱动 Catmull-Rom 样条,沿样条采样中心线,按路宽向两侧偏移
// 生成路面带状网格。可选地形跟随:把中心线 Y 抬升到地形采样高度 + 偏移。
// 交叉路口作为元数据存储,便于上层在路口放置衔接几何体。
//
// 与 BuildingGenerator / CityGenerator 的差异:本类为**有状态实例**生成器
// (控制点 / 宽度 / 段数等属性可逐步构建),因为道路通常需要交互式编辑控制点。
//
// 几何约定:
//   * 中心线在 XZ 平面布局,Y 由控制点或地形跟随决定
//   * 路面法线默认朝上 (+Y),地形跟随时由相邻中心点差分重算
//   * UV:u 沿道路长度方向(按累计长度归一化到 0..1),v 沿路宽(0..1)
//   * 顶点布局:每段 2 个顶点(左右边缘),共 (segments+1)*2 顶点
//
// 设计取向:与 NoiseGenerator / BuildingGenerator 一致,产出纯几何
// (BufferGeometry / 顶点-索引-UV 数组),不绑定 Material / Scene。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math/Vector3';

/** 交叉路口类型。 */
export type IntersectionType = 'cross' | 'tjunction' | 'corner';

/**
 * 交叉路口元数据。
 *
 * 命名为 RoadIntersection 以避免与 Core/Raycaster 的 Intersection(射线命中结果)冲突。
 */
export interface RoadIntersection {
  /** 路口中心位置。 */
  position: Vector3;
  /** 关联的道路索引列表(多道路交汇时由调用方填写)。 */
  roads: number[];
  /** 路口类型:cross 十字 / tjunction T 字 / corner 转角。 */
  type: IntersectionType;
}

/** 地形采样器结构类型(兼容 TerrainGeometry)。 */
export interface TerrainSampler {
  /** 返回世界坐标 (x, z) 处的地形高度 Y。 */
  getHeightAt(x: number, z: number): number;
}

/** 道路生成结果(原始数组形式)。 */
export interface RoadGeometryData {
  /** 顶点位置数组(Float32Array,x*3)。 */
  positions: Float32Array;
  /** 顶点法线数组(Float32Array,x*3)。 */
  normals: Float32Array;
  /** 顶点 UV 数组(Float32Array,x*2)。 */
  uvs: Float32Array;
  /** 索引数组(Uint16/Uint32)。 */
  indices: Uint16Array | Uint32Array;
  /** 顶点数。 */
  vertexCount: number;
  /** 三角形数。 */
  triangleCount: number;
}

/** 道路统计。 */
export interface RoadStats {
  /** 控制点数量。 */
  controlPointCount: number;
  /** 细分段数。 */
  segmentCount: number;
  /** 道路总长度(世界单位)。 */
  roadLength: number;
  /** 路宽。 */
  width: number;
  /** 顶点数。 */
  vertexCount: number;
  /** 三角形数。 */
  triangleCount: number;
  /** 交叉路口数量。 */
  intersectionCount: number;
  /** 是否启用地形跟随。 */
  terrainFollow: boolean;
}

/**
 * 程序化道路生成器(有状态实例)。
 *
 * 用法:
 *   const road = new RoadGenerator();
 *   road.setWidth(8).setSegments(64);
 *   road.addControlPoint(new Vector3(0, 0, 0));
 *   road.addControlPoint(new Vector3(20, 0, 5));
 *   road.addControlPoint(new Vector3(40, 0, 0));
 *   const mesh = road.generateMesh();
 *   scene.add(new Mesh(mesh, roadMaterial));
 *
 * 地形跟随:
 *   road.setTerrainFollow(true, 0.2);
 *   road.setTerrain(terrainGeometry); // 任意含 getHeightAt 的对象
 *   const mesh = road.generateMesh();
 */
export class RoadGenerator {
  /** 控制点列表(至少 2 个才能生成样条)。 */
  private _controlPoints: Vector3[] = [];
  /** 路宽(世界单位)。 */
  private _width: number;
  /** 曲线细分段数。 */
  private _segments: number;
  /** 平滑度(Catmull-Rom 切线系数,0.5 = 标准 CR;越大切线越强)。 */
  private _smoothness: number;
  /** 是否启用地形跟随。 */
  private _terrainFollow: boolean;
  /** 路面高于地形的高度。 */
  private _terrainOffset: number;
  /** 地形采样器(可选)。 */
  private _terrain: TerrainSampler | null = null;
  /** 交叉路口列表。 */
  private _intersections: RoadIntersection[] = [];

  constructor(options?: {
    width?: number;
    segments?: number;
    smoothness?: number;
    controlPoints?: Vector3[];
  }) {
    this._width = options?.width ?? 8;
    this._segments = options?.segments ?? 32;
    this._smoothness = options?.smoothness ?? 0.5;
    this._terrainFollow = false;
    this._terrainOffset = 0.1;
    if (options?.controlPoints) {
      this._controlPoints = options.controlPoints.map((p) => p.clone());
    }
  }

  // ── 控制点 ──────────────────────────────────────────────

  /** 添加控制点。 */
  addControlPoint(point: Vector3): this {
    this._controlPoints.push(point.clone());
    return this;
  }

  /** 移除指定索引的控制点。 */
  removeControlPoint(index: number): this {
    if (index < 0 || index >= this._controlPoints.length) {
      throw new Error(`RoadGenerator: 控制点索引越界 ${index}`);
    }
    this._controlPoints.splice(index, 1);
    return this;
  }

  /** 设置指定索引的控制点。 */
  setControlPoint(index: number, point: Vector3): this {
    if (index < 0 || index >= this._controlPoints.length) {
      throw new Error(`RoadGenerator: 控制点索引越界 ${index}`);
    }
    this._controlPoints[index].copy(point);
    return this;
  }

  /** 获取控制点列表(返回副本)。 */
  getControlPoints(): Vector3[] {
    return this._controlPoints.map((p) => p.clone());
  }

  // ── 参数 ────────────────────────────────────────────────

  /** 设置路宽。 */
  setWidth(width: number): this {
    if (width <= 0) throw new Error(`RoadGenerator: width 必须为正数`);
    this._width = width;
    return this;
  }

  /** 设置细分段数。 */
  setSegments(segments: number): this {
    if (segments < 1) throw new Error(`RoadGenerator: segments 必须 >= 1`);
    this._segments = Math.floor(segments);
    return this;
  }

  /** 设置平滑度(切线系数)。 */
  setSmoothness(smoothness: number): this {
    if (smoothness <= 0) throw new Error(`RoadGenerator: smoothness 必须为正数`);
    this._smoothness = smoothness;
    return this;
  }

  /** 设置地形跟随。 */
  setTerrainFollow(enabled: boolean, offset: number = 0.1): this {
    this._terrainFollow = enabled;
    this._terrainOffset = offset;
    return this;
  }

  /** 设置地形采样器(用于地形跟随)。 */
  setTerrain(terrain: TerrainSampler | null): this {
    this._terrain = terrain;
    return this;
  }

  // ── 交叉路口 ────────────────────────────────────────────

  /** 添加交叉路口。 */
  addIntersection(position: Vector3, type: IntersectionType = 'cross'): this {
    this._intersections.push({
      position: position.clone(),
      roads: [],
      type,
    });
    return this;
  }

  /** 移除指定索引的交叉路口。 */
  removeIntersection(index: number): this {
    if (index < 0 || index >= this._intersections.length) {
      throw new Error(`RoadGenerator: 交叉路口索引越界 ${index}`);
    }
    this._intersections.splice(index, 1);
    return this;
  }

  /** 获取交叉路口列表(返回副本)。 */
  getIntersections(): RoadIntersection[] {
    return this._intersections.map((it) => ({
      position: it.position.clone(),
      roads: it.roads.slice(),
      type: it.type,
    }));
  }

  // ── 样条曲线 ────────────────────────────────────────────

  /**
   * 采样样条曲线在参数 t 处的点(0 = 起点,1 = 终点)。
   * 使用 Catmull-Rom(端点钳制:首尾控制点复制)。
   *
   * @param t 参数 [0, 1]
   * @returns 采样点(Vector3)
   */
  sampleSpline(t: number): Vector3 {
    const cps = this._controlPoints;
    if (cps.length === 0) throw new Error(`RoadGenerator: 无控制点`);
    if (cps.length === 1) return cps[0].clone();

    const n = cps.length - 1; // 段数
    // 把 t 映射到 [0, n]
    let ct = t;
    if (ct < 0) ct = 0;
    if (ct > 1) ct = 1;
    const scaled = ct * n;
    let segIdx = Math.floor(scaled);
    if (segIdx >= n) segIdx = n - 1;
    const localT = scaled - segIdx;

    // 端点钳制:p0 = cps[i-1] 或 cps[0],p3 = cps[i+2] 或 cps[last]
    const p0 = cps[segIdx > 0 ? segIdx - 1 : 0];
    const p1 = cps[segIdx];
    const p2 = cps[segIdx + 1];
    const p3 = cps[segIdx + 2 < cps.length ? segIdx + 2 : cps.length - 1];

    return catmullRom(p0, p1, p2, p3, localT, this._smoothness);
  }

  /**
   * 生成样条曲线采样点(沿整条曲线均匀采样 segments+1 个点)。
   * @returns 采样点数组
   */
  generateSpline(): Vector3[] {
    if (this._controlPoints.length < 2) {
      throw new Error(`RoadGenerator: 至少需要 2 个控制点,当前 ${this._controlPoints.length}`);
    }
    const points: Vector3[] = [];
    const segs = this._segments;
    for (let i = 0; i <= segs; i++) {
      points.push(this.sampleSpline(i / segs));
    }
    return points;
  }

  /** 获取道路采样点(同 generateSpline,语义别名)。 */
  getRoadPoints(): Vector3[] {
    return this.generateSpline();
  }

  /** 计算道路总长度(相邻采样点距离之和)。 */
  getRoadLength(): number {
    if (this._controlPoints.length < 2) return 0;
    const pts = this.generateSpline();
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += pts[i].distanceTo(pts[i - 1]);
    }
    return len;
  }

  // ── 几何生成 ────────────────────────────────────────────

  /**
   * 生成道路(返回顶点/索引/UV 原始数组)。
   *
   * 沿中心线每段生成 2 个边缘顶点(左右),共 (segments+1)*2 顶点。
   * 地形跟随启用时,Y 由地形采样器决定 + terrainOffset。
   */
  generate(): RoadGeometryData {
    if (this._controlPoints.length < 2) {
      throw new Error(`RoadGenerator: 至少需要 2 个控制点,当前 ${this._controlPoints.length}`);
    }

    const center = this.generateSpline();
    const segCount = center.length - 1;
    const vertexCount = (segCount + 1) * 2;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    // 累计长度(用于 UV u 方向)
    const cumLen: number[] = [0];
    for (let i = 1; i < center.length; i++) {
      cumLen[i] = cumLen[i - 1] + center[i].distanceTo(center[i - 1]);
    }
    const totalLen = cumLen[segCount] || 1;

    const halfW = this._width / 2;
    const up = new Vector3(0, 1, 0);
    const tmpTangent = new Vector3();
    const tmpRight = new Vector3();

    for (let i = 0; i <= segCount; i++) {
      // 切线:中心差分(端点单侧差分)
      const prev = center[i > 0 ? i - 1 : i];
      const next = center[i < segCount ? i + 1 : i];
      tmpTangent.subVectors(next, prev);
      if (tmpTangent.lengthSq() < 1e-12) {
        tmpTangent.set(1, 0, 0);
      }
      tmpTangent.normalize();

      // 右方向 = tangent × up(在 XZ 平面)
      crossInto(tmpTangent, up, tmpRight);
      if (tmpRight.lengthSq() < 1e-12) {
        // 切线与 up 平行(垂直爬坡),退化用 X 轴
        tmpRight.set(1, 0, 0);
      }
      tmpRight.normalize();

      // 中心点(地形跟随)
      const cx = center[i].x;
      let cy = center[i].y;
      const cz = center[i].z;
      if (this._terrainFollow && this._terrain) {
        cy = this._terrain.getHeightAt(cx, cz) + this._terrainOffset;
      }

      // 左右边缘顶点
      const lx = cx - tmpRight.x * halfW;
      const lz = cz - tmpRight.z * halfW;
      const rx = cx + tmpRight.x * halfW;
      const rz = cz + tmpRight.z * halfW;

      const vi = i * 2;
      const pi = vi * 3;
      // 左
      positions[pi] = lx;
      positions[pi + 1] = cy;
      positions[pi + 2] = lz;
      // 右
      positions[pi + 3] = rx;
      positions[pi + 4] = cy;
      positions[pi + 5] = rz;

      // 法线:默认朝上;地形跟随时由切线/右向叉积重算
      let nx = 0, ny = 1, nz = 0;
      if (this._terrainFollow) {
        // surface normal = right × tangent
        const sx = tmpRight.y * tmpTangent.z - tmpRight.z * tmpTangent.y;
        const sy = tmpRight.z * tmpTangent.x - tmpRight.x * tmpTangent.z;
        const sz = tmpRight.x * tmpTangent.y - tmpRight.y * tmpTangent.x;
        const sl = Math.hypot(sx, sy, sz) || 1;
        nx = sx / sl; ny = sy / sl; nz = sz / sl;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      }
      normals[pi] = nx;
      normals[pi + 1] = ny;
      normals[pi + 2] = nz;
      normals[pi + 3] = nx;
      normals[pi + 4] = ny;
      normals[pi + 5] = nz;

      // UV:u 沿长度,v 沿宽度(左 0 / 右 1)
      const u = cumLen[i] / totalLen;
      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = 0;
      uvs[vi * 2 + 2] = u;
      uvs[vi * 2 + 3] = 1;
    }

    // 索引:每段两个三角形
    const triangleCount = segCount * 2;
    const indexArr = vertexCount < 65536
      ? new Uint16Array(triangleCount * 3)
      : new Uint32Array(triangleCount * 3);
    let ii = 0;
    for (let i = 0; i < segCount; i++) {
      const a = i * 2;       // 左 i
      const b = i * 2 + 1;   // 右 i
      const c = (i + 1) * 2; // 左 i+1
      const d = (i + 1) * 2 + 1; // 右 i+1
      // 从上方俯视(+Y)CCW:(a, c, b) (b, c, d)
      indexArr[ii++] = a;
      indexArr[ii++] = c;
      indexArr[ii++] = b;
      indexArr[ii++] = b;
      indexArr[ii++] = c;
      indexArr[ii++] = d;
    }

    return {
      positions,
      normals,
      uvs,
      indices: indexArr,
      vertexCount,
      triangleCount,
    };
  }

  /**
   * 生成道路网格(BufferGeometry)。
   * 等价于 generate() 的结果封装为 BufferGeometry。
   */
  generateMesh(): BufferGeometry {
    const data = this.generate();
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geo.setAttribute('uv', new BufferAttribute(data.uvs, 2));
    geo.setIndex(data.indices);
    geo.computeBoundingBox();
    return geo;
  }

  // ── 统计 ────────────────────────────────────────────────

  /** 获取道路统计。 */
  getStats(): RoadStats {
    let vertexCount = 0;
    let triangleCount = 0;
    if (this._controlPoints.length >= 2) {
      vertexCount = (this._segments + 1) * 2;
      triangleCount = this._segments * 2;
    }
    return {
      controlPointCount: this._controlPoints.length,
      segmentCount: this._controlPoints.length >= 2 ? this._segments : 0,
      roadLength: this.getRoadLength(),
      width: this._width,
      vertexCount,
      triangleCount,
      intersectionCount: this._intersections.length,
      terrainFollow: this._terrainFollow,
    };
  }
}

// ── 内部工具 ──────────────────────────────────────────────

/**
 * Catmull-Rom 样条采样(带张力系数)。
 *
 * 使用 Hermite 基形式:
 *   point = h00*p1 + h01*p2 + smoothness*(h10*(p2-p0) + h11*(p3-p1))
 * 其中:
 *   h00 = 2t³-3t²+1  (p1 基,保证 t=0 时 point=p1)
 *   h01 = 3t²-2t³    (p2 基,保证 t=1 时 point=p2)
 *   h10 = t³-2t²+t   (m1 切线基)
 *   h11 = t³-t²      (m2 切线基)
 *
 * smoothness = 0.5 时等价于标准 Catmull-Rom(切线 = 0.5*(p2-p0));
 * smoothness = 0 时退化为 smoothstep 直线(p1→p2)。
 *
 * @param p0 前一控制点(端点钳制)
 * @param p1 当前段起点
 * @param p2 当前段终点
 * @param p3 后一控制点(端点钳制)
 * @param t  段内参数 [0, 1]
 * @param smoothness 切线系数(0.5 = 标准 Catmull-Rom)
 */
function catmullRom(
  p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3,
  t: number, smoothness: number,
): Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h01 = 3 * t2 - 2 * t3;
  const h10 = t3 - 2 * t2 + t;
  const h11 = t3 - t2;
  const x = h00 * p1.x + h01 * p2.x +
    smoothness * (h10 * (p2.x - p0.x) + h11 * (p3.x - p1.x));
  const y = h00 * p1.y + h01 * p2.y +
    smoothness * (h10 * (p2.y - p0.y) + h11 * (p3.y - p1.y));
  const z = h00 * p1.z + h01 * p2.z +
    smoothness * (h10 * (p2.z - p0.z) + h11 * (p3.z - p1.z));
  return new Vector3(x, y, z);
}

/** tmp = a × b(避免分配新 Vector3)。 */
function crossInto(a: Vector3, b: Vector3, out: Vector3): void {
  const ax = a.x, ay = a.y, az = a.z;
  const bx = b.x, by = b.y, bz = b.z;
  out.x = ay * bz - az * by;
  out.y = az * bx - ax * bz;
  out.z = ax * by - ay * bx;
}
