// BVH — Bounding Volume Hierarchy 加速结构。
//
// 顶层 API:
//   * build(geometry)         从 BufferGeometry 构建 BVH
//   * raycast(ray)            射线检测,返回所有相交三角形(按 distance 升序)
//   * raycastFirst(ray)       射线检测,仅返回最近相交
//   * intersectsFrustum(f)    视锥裁剪,返回所有可见三角形索引
//   * getBounds()             返回整树 AABB
//   * traverse(callback)     深度优先遍历所有节点
//   * getStats()              返回节点数/叶子数/深度统计
//
// 内部缓存 build 时提取的扁平三角形顶点索引 + position 缓冲,
// 供 raycast / intersectsFrustum 复用,避免每次查询都重读几何体。
//
// 视锥 - AABB 相交测试采用"p-vertex"保守剔除法(对每个裁剪平面取
// 盒子在该平面法线方向最远的角点,若该角点仍在平面外侧则整盒在外),
// 不产生假阴性(漏检),但可能产生少量假阳性(假可见),适合保守剔除场景。

import { Box3 } from '../Math/Box3';
import { Vector3 } from '../Math/Vector3';
import { Ray } from '../Math/Ray';
import type { Frustum } from '../Math/Frustum';
import type { BufferGeometry } from '../Core/BufferGeometry';
import { BVHNode } from './BVHNode';
import {
  buildBVH,
  BVHBuildStrategy,
  type BVHBuildOptions,
} from './BVHBuilder';

/** 射线命中三角形的查询结果。 */
export interface BVHRayHit {
  /** 命中三角形在 BVH 三角形列表中的索引(0-based)。 */
  triangleIndex: number;
  /** 射线 origin 到命中点的距离。 */
  distance: number;
  /** 命中点(局部坐标)。 */
  point: Vector3;
}

/** BVH 统计信息。 */
export interface BVHStats {
  /** 树中节点总数(内部 + 叶子)。 */
  totalNodes: number;
  /** 叶子节点数。 */
  leafCount: number;
  /** 内部节点数。 */
  interiorCount: number;
  /** 树的最大深度(根节点深度为 0)。 */
  maxDepth: number;
  /** 叶子节点平均深度。 */
  avgDepth: number;
  /** 所有叶子包含的三角形总数(应等于几何体三角形数)。 */
  totalTriangles: number;
  /** 叶子节点中三角形数的最大值。 */
  maxLeafSize: number;
}

// 模块内复用的临时变量,避免 raycast 调用栈中频繁分配。
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _hit = new Vector3();

export class BVH {
  /** 根节点;空几何体或未构建时为 null。 */
  root: BVHNode | null = null;
  /** 构建时配置的最大深度。 */
  maxDepth: number;
  /** 构建时配置的叶子最大三角形数。 */
  maxLeafSize: number;

  // 内部缓存:扁平三角形顶点索引与位置缓冲,供查询复用。
  private _triangles: Uint32Array = new Uint32Array(0);
  private _positions: Float32Array = new Float32Array(0);
  private _triangleCount: number = 0;

  constructor(options: BVHBuildOptions = {}) {
    this.maxDepth = options.maxDepth ?? 32;
    this.maxLeafSize = options.maxLeafSize ?? 8;
  }

  /** 从 BufferGeometry 构建 BVH。返回 this 以支持链式调用。 */
  build(geometry: BufferGeometry, options: BVHBuildOptions = {}): this {
    const result = buildBVH(geometry, options);
    this.root = result.root;
    this._triangles = result.triangles;
    this._positions = result.positions;
    this._triangleCount = result.triangleCount;
    this.maxDepth = options.maxDepth ?? 32;
    this.maxLeafSize = options.maxLeafSize ?? 8;
    return this;
  }

  /** 射线检测:返回所有相交三角形,按 distance 升序。
   *  空树返回空数组。 */
  raycast(ray: Ray): BVHRayHit[] {
    const hits: BVHRayHit[] = [];
    if (this.root === null) return hits;
    this._raycastNode(this.root, ray, hits);
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  /** 射线检测:仅返回最近相交。无相交返回 null。 */
  raycastFirst(ray: Ray): BVHRayHit | null {
    if (this.root === null) return null;
    const holder: { hit: BVHRayHit | null; bestDist: number } = { hit: null, bestDist: Infinity };
    this._raycastFirstNode(this.root, ray, holder);
    return holder.hit;
  }

  /** 视锥裁剪:返回所有"潜在可见"的三角形索引(保守剔除)。
   *  返回的索引可能包含实际不可见的三角形,但不会漏检可见三角形。 */
  intersectsFrustum(frustum: Frustum): number[] {
    const visible: number[] = [];
    if (this.root === null) return visible;
    this._frustumNode(this.root, frustum, visible);
    return visible;
  }

  /** 返回整树 AABB(根节点 bounds 的克隆);空树返回空盒。 */
  getBounds(target: Box3 = new Box3()): Box3 {
    if (this.root === null) {
      target.makeEmpty();
      return target;
    }
    target.copy(this.root.bounds);
    return target;
  }

  /** 深度优先遍历所有节点。callback 接收 (node, depth)。 */
  traverse(callback: (node: BVHNode, depth: number) => void): void {
    if (this.root === null) return;
    this._traverseNode(this.root, callback);
  }

  /** 返回三角形 t 的 3 个顶点索引(指向 position 缓冲)。
   *  供 MeshBVH 等外部使用者读取三角形几何信息。 */
  getTriangleVertexIndices(t: number): readonly [number, number, number] {
    return [this._triangles[t * 3], this._triangles[t * 3 + 1], this._triangles[t * 3 + 2]];
  }

  /** 返回三角形总数。 */
  get triangleCount(): number {
    return this._triangleCount;
  }

  /** 返回统计信息。空树返回零值。 */
  getStats(): BVHStats {
    const stats: BVHStats = {
      totalNodes: 0,
      leafCount: 0,
      interiorCount: 0,
      maxDepth: 0,
      avgDepth: 0,
      totalTriangles: 0,
      maxLeafSize: 0,
    };
    if (this.root === null) return stats;
    let depthSum = 0;
    const walk = (node: BVHNode): void => {
      stats.totalNodes++;
      if (node.depth > stats.maxDepth) stats.maxDepth = node.depth;
      if (node.isLeaf()) {
        stats.leafCount++;
        depthSum += node.depth;
        const tris = node.triangles ? node.triangles.length : 0;
        stats.totalTriangles += tris;
        if (tris > stats.maxLeafSize) stats.maxLeafSize = tris;
      } else {
        stats.interiorCount++;
        if (node.left) walk(node.left);
        if (node.right) walk(node.right);
      }
    };
    walk(this.root);
    stats.avgDepth = stats.leafCount > 0 ? depthSum / stats.leafCount : 0;
    return stats;
  }

  // ── 内部递归实现 ───────────────────────────────────────────────

  private _raycastNode(node: BVHNode, ray: Ray, hits: BVHRayHit[]): void {
    if (!ray.intersectsBox(node.bounds)) return;
    if (node.isLeaf() && node.triangles) {
      for (const t of node.triangles) {
        this._intersectTriangle(ray, t, hits);
      }
      return;
    }
    if (node.left) this._raycastNode(node.left, ray, hits);
    if (node.right) this._raycastNode(node.right, ray, hits);
  }

  private _raycastFirstNode(
    node: BVHNode,
    ray: Ray,
    holder: { hit: BVHRayHit | null; bestDist: number },
  ): void {
    // 早出:若子树 AABB 的射线进入距离已超过当前最佳命中,跳过整个子树。
    const near = this._boxRayNear(node.bounds, ray);
    if (near === Infinity) return; // 射线与 AABB 不相交
    if (near > holder.bestDist) return; // 子树必然比当前最佳更远
    if (node.isLeaf() && node.triangles) {
      for (const t of node.triangles) {
        const hit = this._intersectTriangleFirst(ray, t, holder.bestDist);
        if (hit !== null) {
          holder.bestDist = hit.distance;
          holder.hit = hit;
        }
      }
      return;
    }
    // 优先访问更近的子节点:比较两个子节点 AABB 的射线进入距离。
    if (node.left && node.right) {
      const leftNear = this._boxRayNear(node.left.bounds, ray);
      const rightNear = this._boxRayNear(node.right.bounds, ray);
      if (leftNear <= rightNear) {
        this._raycastFirstNode(node.left, ray, holder);
        this._raycastFirstNode(node.right, ray, holder);
      } else {
        this._raycastFirstNode(node.right, ray, holder);
        this._raycastFirstNode(node.left, ray, holder);
      }
    } else if (node.left) {
      this._raycastFirstNode(node.left, ray, holder);
    } else if (node.right) {
      this._raycastFirstNode(node.right, ray, holder);
    }
  }

  private _frustumNode(node: BVHNode, frustum: Frustum, visible: number[]): void {
    if (!this._boxIntersectsFrustum(node.bounds, frustum)) return;
    if (node.isLeaf() && node.triangles) {
      for (const t of node.triangles) visible.push(t);
      return;
    }
    if (node.left) this._frustumNode(node.left, frustum, visible);
    if (node.right) this._frustumNode(node.right, frustum, visible);
  }

  private _traverseNode(node: BVHNode, callback: (node: BVHNode, depth: number) => void): void {
    callback(node, node.depth);
    if (node.left) this._traverseNode(node.left, callback);
    if (node.right) this._traverseNode(node.right, callback);
  }

  /** 射线与三角形 t 的相交测试,所有命中追加到 hits。 */
  private _intersectTriangle(ray: Ray, t: number, hits: BVHRayHit[]): void {
    this._readTriangle(t, _v0, _v1, _v2);
    const p = ray.intersectTriangle(_v0, _v1, _v2, false, _hit);
    if (p === null) return;
    hits.push({
      triangleIndex: t,
      distance: p.distanceTo(ray.origin),
      point: p.clone(),
    });
  }

  /** 射线与三角形 t 的相交测试,仅当 distance < bestDistance 时返回结果。 */
  private _intersectTriangleFirst(ray: Ray, t: number, bestDistance: number): BVHRayHit | null {
    this._readTriangle(t, _v0, _v1, _v2);
    const p = ray.intersectTriangle(_v0, _v1, _v2, false, _hit);
    if (p === null) return null;
    const dist = p.distanceTo(ray.origin);
    if (dist >= bestDistance) return null;
    return { triangleIndex: t, distance: dist, point: p.clone() };
  }

  /** 读取三角形 t 的 3 个顶点,写入 a/b/c。 */
  private _readTriangle(t: number, a: Vector3, b: Vector3, c: Vector3): void {
    const tri = this._triangles;
    const pos = this._positions;
    const i0 = tri[t * 3] * 3;
    const i1 = tri[t * 3 + 1] * 3;
    const i2 = tri[t * 3 + 2] * 3;
    a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
    b.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
    c.set(pos[i2], pos[i2 + 1], pos[i2 + 2]);
  }

  /** 射线进入 AABB 的最近参数 t(斯拉布斯法,仅返回 tmin)。
   *  不相交返回 +∞。用于 raycastFirst 时优先访问更近子节点。 */
  private _boxRayNear(box: Box3, ray: Ray): number {
    const invdx = 1 / ray.direction.x;
    const invdy = 1 / ray.direction.y;
    const invdz = 1 / ray.direction.z;
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    let tmin: number;
    const tx1 = (box.min.x - ox) * invdx;
    const tx2 = (box.max.x - ox) * invdx;
    const ty1 = (box.min.y - oy) * invdy;
    const ty2 = (box.max.y - oy) * invdy;
    const tz1 = (box.min.z - oz) * invdz;
    const tz2 = (box.max.z - oz) * invdz;
    const txa = Math.min(tx1, tx2);
    const txb = Math.max(tx1, tx2);
    const tya = Math.min(ty1, ty2);
    const tyb = Math.max(ty1, ty2);
    const tza = Math.min(tz1, tz2);
    const tzb = Math.max(tz1, tz2);
    tmin = Math.max(txa, tya, tza);
    const tmax = Math.min(txb, tyb, tzb);
    if (tmax < 0 || tmin > tmax) return Infinity;
    return tmin >= 0 ? tmin : 0;
  }

  /** AABB 与视锥体的保守相交测试(p-vertex 法)。
   *  对每个裁剪平面取盒子在该平面法线方向最远的角点;若该角点在平面
   *  外侧,整盒被剔除。不产生假阴性,但可能有少量假阳性。 */
  private _boxIntersectsFrustum(box: Box3, frustum: Frustum): boolean {
    const planes = frustum.planes;
    for (let i = 0; i < 6; i++) {
      const p = planes[i];
      const nx = p.normal.x, ny = p.normal.y, nz = p.normal.z;
      // p-vertex: 法线方向上最远的角点
      const px = nx >= 0 ? box.max.x : box.min.x;
      const py = ny >= 0 ? box.max.y : box.min.y;
      const pz = nz >= 0 ? box.max.z : box.min.z;
      const dist = nx * px + ny * py + nz * pz + p.constant;
      if (dist < 0) return false;
    }
    return true;
  }
}

export { BVHBuildStrategy };
export type { BVHBuildOptions };
