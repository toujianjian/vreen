// ConvexGeometry — 凸包几何体,从一组三维点构建凸包并输出三角网格。
// 参考: three.js/src/geometries/ConvexGeometry.js + three.js/src/math/ConvexHull.js
//
// 算法: 增量式凸包 (incremental convex hull),等价于 three.js QuickHull 的核心思想:
//   1. 从输入点集中选出 4 个不共面的点,构造初始四面体(4 个外法向三角面)。
//   2. 对每个剩余点,标记所有"可见"面(点在外侧),移除它们,
//      并沿 horizon 边(可见区与不可见区的边界)向该点构造新三角面。
//      使用有向边 (a→b) 的 twin 判定保证新面法线朝外。
//   3. 初始四面体的中心点位于最终凸包内部,用作所有面外法线方向的参考。
//
// 输出: 非索引几何体(每个三角面 3 个独立顶点),顶点法线为平面着色(flat),
// 与 three.js ConvexGeometry 行为一致。
//
// 性能: O(n·F),F 为当前面数;对 ≤ 1000 点的小规模点集足够。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math/Vector3';

/** 凸包的一个三角面,顶点为指向输入点数组的索引。 */
interface Face {
  a: number;
  b: number;
  c: number;
  normal: Vector3;
}

const EPS = 1e-9;

// 复用临时向量,避免内循环分配。
const _ab = new Vector3();
const _ac = new Vector3();
const _nrm = new Vector3();
const _toP = new Vector3();

/** 计算三角形 (a,b,c) 的单位法线,写入 out。退化三角形返回零向量。 */
function computeNormal(a: Vector3, b: Vector3, c: Vector3, out: Vector3): void {
  _ab.subVectors(b, a);
  _ac.subVectors(c, a);
  out.copy(_ab).cross(_ac);
  const len = out.length();
  if (len > EPS) out.multiplyScalar(1 / len);
}

/** 点 p 到直线 (a→b) 的距离 = |(p-a) × (b-a)| / |b-a|。 */
function distanceToLine(p: Vector3, a: Vector3, b: Vector3): number {
  _ab.subVectors(b, a);
  _ac.subVectors(p, a);
  _nrm.copy(_ab).cross(_ac);
  const segLen = _ab.length();
  if (segLen < EPS) return 0;
  return _nrm.length() / segLen;
}

/** 点 p 到平面 (a,b,c) 的有符号距离(法线方向由 (b-a)×(c-a) 决定)。 */
function signedDistanceToPlane(p: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  computeNormal(a, b, c, _nrm);
  if (_nrm.lengthSq() < EPS * EPS) return 0;
  return _nrm.dot(p) - _nrm.dot(a);
}

/**
 * 凸包几何体。从一组三维点构建凸包,输出三角网格 + 平面法线。
 *
 * @example
 * const geo = new ConvexGeometry([new Vector3(0,0,0), ...]);
 */
export class ConvexGeometry extends BufferGeometry {
  constructor(points: Vector3[] = []) {
    super();

    const pts = points.map((p) => p.clone());
    const n = pts.length;

    // 退化情形:不足 4 个点无法构成凸包 → 输出空几何体。
    if (n < 4) {
      this.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      this.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
      return;
    }

    // ── 步骤 1: 选取初始四面体的 4 个顶点 ──────────────────────
    // p0 = 极端点(最小 x,其次最小 y、z)
    let i0 = 0;
    for (let i = 1; i < n; i++) {
      const a = pts[i];
      const b = pts[i0];
      if (a.x < b.x || (a.x === b.x && (a.y < b.y || (a.y === b.y && a.z < b.z)))) {
        i0 = i;
      }
    }
    // p1 = 距 p0 最远的点
    let i1 = -1;
    let maxD = -1;
    for (let i = 0; i < n; i++) {
      if (i === i0) continue;
      const d = pts[i].distanceToSquared(pts[i0]);
      if (d > maxD) {
        maxD = d;
        i1 = i;
      }
    }
    if (i1 < 0 || maxD < EPS) {
      this.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      this.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
      return;
    }
    // p2 = 距直线 p0-p1 最远的点
    let i2 = -1;
    maxD = -1;
    for (let i = 0; i < n; i++) {
      if (i === i0 || i === i1) continue;
      const d = distanceToLine(pts[i], pts[i0], pts[i1]);
      if (d > maxD) {
        maxD = d;
        i2 = i;
      }
    }
    if (i2 < 0 || maxD < EPS) {
      // 所有点共线 → 退化,输出空几何体。
      this.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      this.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
      return;
    }
    // p3 = 距平面 p0-p1-p2 最远(绝对值)的点
    let i3 = -1;
    maxD = -1;
    for (let i = 0; i < n; i++) {
      if (i === i0 || i === i1 || i === i2) continue;
      const d = Math.abs(signedDistanceToPlane(pts[i], pts[i0], pts[i1], pts[i2]));
      if (d > maxD) {
        maxD = d;
        i3 = i;
      }
    }
    if (i3 < 0 || maxD < EPS) {
      // 所有点共面 → 退化(非闭合 3D 凸包),输出空几何体。
      this.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      this.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
      return;
    }

    // 初始四面体的中心点,位于最终凸包内部,用作所有面外法线方向的参考。
    const centroid = new Vector3()
      .add(pts[i0])
      .add(pts[i1])
      .add(pts[i2])
      .add(pts[i3])
      .multiplyScalar(0.25);

    const faces: Face[] = [];

    /** 添加一个三角面 (a,b,c),并通过 centroid 参考保证法线朝外。 */
    const addFace = (a: number, b: number, c: number): void => {
      const normal = new Vector3();
      computeNormal(pts[a], pts[b], pts[c], normal);
      if (normal.lengthSq() < EPS * EPS) return; // 退化三角形,跳过
      // 若法线指向 centroid(内侧),翻转绕序使其朝外。
      _toP.subVectors(centroid, pts[a]);
      if (_toP.dot(normal) > EPS) {
        // 翻转:交换 b 与 c
        const tmp = b;
        b = c;
        c = tmp;
        normal.negate();
      }
      faces.push({ a, b, c, normal });
    };

    // 四面体的 4 个面(每个面省略一个顶点)。
    addFace(i0, i1, i2);
    addFace(i0, i1, i3);
    addFace(i0, i2, i3);
    addFace(i1, i2, i3);

    const used = new Set<number>([i0, i1, i2, i3]);

    // ── 步骤 2: 增量插入剩余点 ──────────────────────────────────
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const p = pts[i];

      // 标记可见面:点在面的外侧(法线方向)。
      const visible: Face[] = [];
      for (const f of faces) {
        _toP.subVectors(p, pts[f.a]);
        if (_toP.dot(f.normal) > EPS) visible.push(f);
      }
      if (visible.length === 0) continue; // 点在内部,跳过。

      // 从面列表中移除可见面。
      for (const f of visible) {
        const idx = faces.indexOf(f);
        if (idx >= 0) faces.splice(idx, 1);
      }

      // 收集所有可见面的有向边集合。
      const directedEdges = new Set<string>();
      for (const f of visible) {
        directedEdges.add(`${f.a}->${f.b}`);
        directedEdges.add(`${f.b}->${f.c}`);
        directedEdges.add(`${f.c}->${f.a}`);
      }

      // horizon 边:有向边 (a→b),其 twin (b→a) 不在可见面集合中。
      // 沿每条 horizon 边构造新面 (a, b, i)。
      for (const f of visible) {
        const edges: Array<[number, number]> = [
          [f.a, f.b],
          [f.b, f.c],
          [f.c, f.a],
        ];
        for (const [a, b] of edges) {
          if (!directedEdges.has(`${b}->${a}`)) {
            addFace(a, b, i);
          }
        }
      }
    }

    // ── 步骤 3: 收集三角面 → 非索引顶点 + 平面法线 ───────────────
    const positions: number[] = [];
    const normals: number[] = [];
    for (const f of faces) {
      const a = pts[f.a];
      const b = pts[f.b];
      const c = pts[f.c];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      for (let k = 0; k < 3; k++) {
        normals.push(f.normal.x, f.normal.y, f.normal.z);
      }
    }

    this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.computeBoundingBox();
    this.computeBoundingSphere();
  }
}
