// ConvexHull — 凸包计算 (convex hull computation)。
//
// 适配 three.js `examples/jsm/math/ConvexHull.js` 并重构为独立数学类。
// 与 Geometries/ConvexGeometry 互补:ConvexGeometry 输出 BufferGeometry(渲染用),
// ConvexHull 输出结构化面数据(碰撞检测/物理/阴影用)。
//
// 算法: 增量式凸包 (incremental convex hull, QuickHull 变体):
//   1. 从输入点集选出 4 个不共面的点,构造初始四面体(4 个外法向三角面);
//   2. 对每个剩余点,标记所有"可见"面(点在外侧),移除它们,
//      并沿 horizon 边向该点构造新三角面;
//   3. 使用有向边 (a→b) 的 twin 判定保证新面法线朝外。
//
// 用途:
//   - 碰撞检测 (凸包作为碰撞形状)
//   - 物理引擎 (刚体碰撞代理)
//   - 阴影网格 (简化凸包投射阴影)
//   - 包围体积计算 (比 AABB/OBB更精确)
//
// 不变量:
//   - 输入点 ≥ 4 个且不共面时,输出为闭合凸包;
//   - 所有面法线朝外;
//   - 输入点不被修改。
//
// 参考:
//   - three.js examples/jsm/math/ConvexHull.js
//   - C.B. Barber et al. "The Quickhull Algorithm for Convex Hulls"

import { Vector3 } from './Vector3';

/** 凸包的一个三角面。 */
export interface ConvexHullFace {
  /** 顶点 A (索引指向输入点数组)。 */
  a: number;
  /** 顶点 B (索引)。 */
  b: number;
  /** 顶点 C (索引)。 */
  c: number;
  /** 面法线 (单位向量,朝外)。 */
  normal: Vector3;
  /** 面质心。 */
  centroid: Vector3;
  /** 原点到平面的距离 (normal · anyVertex)。 */
  constant: number;
}

/** 凸包计算结果。 */
export interface ConvexHullResult {
  /** 三角面列表。 */
  faces: ConvexHullFace[];
  /** 凸包上的顶点索引 (输入点数组的子集)。 */
  vertexIndices: number[];
  /** 凸包顶点坐标。 */
  vertices: Vector3[];
}

const EPS = 1e-9;

// 临时向量
const _ab = new Vector3();
const _ac = new Vector3();
const _nrm = new Vector3();

/**
 * 凸包计算器。
 *
 * 从一组三维点构建凸包,返回结构化面数据。
 * 不依赖 WebGL,可在 Node/无头环境运行。
 */
export class ConvexHull {
  /**
   * 从点集计算凸包。
   *
   * @param points 输入点集。
   * @returns 凸包结果(面 + 顶点)。
   */
  static compute(points: Vector3[]): ConvexHullResult {
    const n = points.length;

    if (n < 4) {
      return { faces: [], vertexIndices: [], vertices: [] };
    }

    // 克隆点以避免修改输入
    const pts = points.map((p) => p.clone());

    // 1. 找初始四面体
    const initial = ConvexHull._findInitialTetrahedron(pts);
    if (initial === null) {
      return { faces: [], vertexIndices: [], vertices: [] };
    }

    // 2. 构建初始面
    let faces = ConvexHull._createInitialFaces(pts, initial);

    // 3. 增量添加剩余点
    const usedIndices = new Set(initial);
    for (let i = 0; i < n; i++) {
      if (usedIndices.has(i)) continue;
      faces = ConvexHull._addPoint(pts, i, faces);
      usedIndices.add(i);
    }

    // 4. 提取顶点索引
    const vertexIndicesSet = new Set<number>();
    for (const f of faces) {
      vertexIndicesSet.add(f.a);
      vertexIndicesSet.add(f.b);
      vertexIndicesSet.add(f.c);
    }
    const vertexIndices = Array.from(vertexIndicesSet).sort((a, b) => a - b);
    const vertices = vertexIndices.map((i) => pts[i].clone());

    return { faces, vertexIndices, vertices };
  }

  /**
   * 找到 4 个不共面的点构成初始四面体。
   * 策略:找 X 极值、Y 极值、Z 极值、距前三个点构成平面最远的点。
   */
  private static _findInitialTetrahedron(pts: Vector3[]): number[] | null {
    const n = pts.length;
    if (n < 4) return null;

    // 找 X 方向极值
    let minX = 0, maxX = 0;
    for (let i = 1; i < n; i++) {
      if (pts[i].x < pts[minX].x) minX = i;
      if (pts[i].x > pts[maxX].x) maxX = i;
    }
    if (minX === maxX) return null;

    // 找距 (minX, maxX) 直线最远的点
    let maxY = -1;
    let maxDist = 0;
    for (let i = 0; i < n; i++) {
      if (i === minX || i === maxX) continue;
      const d = ConvexHull._distanceToLine(pts[i], pts[minX], pts[maxX]);
      if (d > maxDist) {
        maxDist = d;
        maxY = i;
      }
    }
    if (maxY < 0) return null;

    // 找距 (minX, maxX, maxY) 平面最远的点
    let maxZ = -1;
    maxDist = 0;
    for (let i = 0; i < n; i++) {
      if (i === minX || i === maxX || i === maxY) continue;
      const d = Math.abs(ConvexHull._signedDistanceToPlane(pts[i], pts[minX], pts[maxX], pts[maxY]));
      if (d > maxDist) {
        maxDist = d;
        maxZ = i;
      }
    }
    if (maxZ < 0) return null;

    return [minX, maxX, maxY, maxZ];
  }

  /**
   * 从初始四面体创建 4 个外法向面。
   */
  private static _createInitialFaces(pts: Vector3[], tetra: number[]): ConvexHullFace[] {
    const [a, b, c, d] = tetra;
    const pa = pts[a], pb = pts[b], pc = pts[c], pd = pts[d];

    // 4 个面,确保法线朝外(远离四面体中心)
    const center = new Vector3()
      .add(pa).add(pb).add(pc).add(pd)
      .multiplyScalar(0.25);

    const faceDefs: [number, number, number][] = [
      [a, b, c],
      [a, d, b],
      [b, d, c],
      [c, d, a],
    ];

    const faces: ConvexHullFace[] = [];
    for (const [ia, ib, ic] of faceDefs) {
      const f = ConvexHull._makeFace(pts, ia, ib, ic);
      // 检查法线方向:如果法线指向中心(内侧),翻转
      const toCenter = new Vector3().subVectors(center, f.centroid);
      if (f.normal.dot(toCenter) > 0) {
        // 翻转面:交换 b 和 c,翻转法线,重新计算 constant
        const tmp = f.b;
        f.b = f.c;
        f.c = tmp;
        f.normal.negate();
        f.constant = f.normal.dot(pts[f.a]);
      }
      faces.push(f);
    }

    return faces;
  }

  /**
   * 添加一个点到凸包。
   * 移除该点可见的面,沿 horizon 边创建新面。
   */
  private static _addPoint(
    pts: Vector3[],
    pointIdx: number,
    faces: ConvexHullFace[],
  ): ConvexHullFace[] {
    const p = pts[pointIdx];

    // 找出所有可见面(点在外侧)
    const visibleFaces: ConvexHullFace[] = [];
    const remainingFaces: ConvexHullFace[] = [];

    for (const f of faces) {
      const dist = f.normal.dot(p) - f.constant;
      if (dist > EPS) {
        visibleFaces.push(f);
      } else {
        remainingFaces.push(f);
      }
    }

    if (visibleFaces.length === 0) {
      // 点在凸包内部,不需要修改
      return faces;
    }

    // 找 horizon 边(可见面与不可见面的边界)
    // horizon 边 = 可见面中不被另一个可见面共享的边
    const horizonEdges: [number, number][] = [];
    for (const vf of visibleFaces) {
      const edges: [number, number][] = [
        [vf.a, vf.b],
        [vf.b, vf.c],
        [vf.c, vf.a],
      ];
      for (const edge of edges) {
        // 检查反向边是否在另一个可见面中
        const [a, b] = edge;
        const reverseEdge: [number, number] = [b, a];
        let shared = false;
        for (const other of visibleFaces) {
          if (other === vf) continue;
          const otherEdges: [number, number][] = [
            [other.a, other.b],
            [other.b, other.c],
            [other.c, other.a],
          ];
          for (const oe of otherEdges) {
            if (oe[0] === reverseEdge[0] && oe[1] === reverseEdge[1]) {
              shared = true;
              break;
            }
          }
          if (shared) break;
        }
        if (!shared) {
          horizonEdges.push(edge);
        }
      }
    }

    // 从 horizon 边创建新面
    const newFaces: ConvexHullFace[] = [];
    for (const [a, b] of horizonEdges) {
      const f = ConvexHull._makeFace(pts, a, b, pointIdx);
      newFaces.push(f);
    }

    return [...remainingFaces, ...newFaces];
  }

  /**
   * 创建一个面,计算法线、质心、常数。
   */
  private static _makeFace(pts: Vector3[], ia: number, ib: number, ic: number): ConvexHullFace {
    const a = pts[ia], b = pts[ib], c = pts[ic];

    _ab.subVectors(b, a);
    _ac.subVectors(c, a);
    _nrm.copy(_ab).cross(_ac);
    const len = _nrm.length();
    if (len > EPS) {
      _nrm.multiplyScalar(1 / len);
    }

    const centroid = new Vector3()
      .add(a).add(b).add(c)
      .multiplyScalar(1 / 3);

    return {
      a: ia,
      b: ib,
      c: ic,
      normal: _nrm.clone(),
      centroid,
      constant: _nrm.dot(a),
    };
  }

  /**
   * 点到直线的距离。
   */
  private static _distanceToLine(p: Vector3, a: Vector3, b: Vector3): number {
    _ab.subVectors(b, a);
    _ac.subVectors(p, a);
    _nrm.copy(_ab).cross(_ac);
    const segLen = _ab.length();
    if (segLen < EPS) return 0;
    return _nrm.length() / segLen;
  }

  /**
   * 点到平面的有符号距离。
   */
  private static _signedDistanceToPlane(p: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
    _ab.subVectors(b, a);
    _ac.subVectors(c, a);
    _nrm.copy(_ab).cross(_ac);
    const len = _nrm.length();
    if (len < EPS) return 0;
    _nrm.multiplyScalar(1 / len);
    return _nrm.dot(p) - _nrm.dot(a);
  }

  /**
   * 计算凸包的体积。
   *
   * @param result 凸包结果。
   * @returns 体积(立方单位)。
   */
  static volume(result: ConvexHullResult): number {
    let vol = 0;
    const vMap = new Map<number, Vector3>();
    for (let i = 0; i < result.vertexIndices.length; i++) {
      vMap.set(result.vertexIndices[i], result.vertices[i]);
    }

    for (const f of result.faces) {
      const va = vMap.get(f.a)!;
      const vb = vMap.get(f.b)!;
      const vc = vMap.get(f.c)!;
      // 四面体体积 = |(a · (b × c))| / 6
      const cross = new Vector3().copy(vb).cross(vc);
      vol += va.dot(cross);
    }
    return Math.abs(vol) / 6;
  }

  /**
   * 计算凸包的表面积。
   *
   * @param result 凸包结果。
   * @returns 表面积(平方单位)。
   */
  static surfaceArea(result: ConvexHullResult): number {
    let area = 0;
    // 构建 vertexIndex → vertex 映射
    const vMap = new Map<number, Vector3>();
    for (let i = 0; i < result.vertexIndices.length; i++) {
      vMap.set(result.vertexIndices[i], result.vertices[i]);
    }

    for (const f of result.faces) {
      const a = vMap.get(f.a)!;
      const b = vMap.get(f.b)!;
      const c = vMap.get(f.c)!;
      _ab.subVectors(b, a);
      _ac.subVectors(c, a);
      _nrm.copy(_ab).cross(_ac);
      area += _nrm.length() * 0.5;
    }
    return area;
  }
}
