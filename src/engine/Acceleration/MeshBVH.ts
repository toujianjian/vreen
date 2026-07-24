// MeshBVH — 网格专用 BVH 包装。
//
// 在 BVH 之上提供面向 Mesh 的查询 API:
//   * raycast(ray)              返回 BVHIntersection[](含 distance/point/face/uv)
//   * closestPointToPoint(p)    返回离查询点最近的网格表面点
//
// 与 Raycaster 的 Intersection 不同,BVHIntersection 不携带 object 引用
// (BVH 与 Object3D 解耦);face 字段包含 a/b/c 顶点索引与归一化法线,
// uv 字段在几何体带 uv 属性时通过重心坐标插值得到。
//
// closestPointToPoint 使用 Box3.distanceToPoint 做子树早出:
// 若查询点到子树 AABB 的距离已超过当前最佳距离,跳过整个子树。

import { BVH } from './BVH';
import type { BVHBuildOptions } from './BVHBuilder';
import { BVHNode } from './BVHNode';
import { Vector3 } from '../Math/Vector3';
import { Vector2 } from '../Math/Vector2';
import { Ray } from '../Math/Ray';
import { Triangle } from '../Math/Triangle';
import type { BufferGeometry } from '../Core/BufferGeometry';

/** 命中三角形的顶点索引与法线。 */
export interface BVHFace {
  a: number;
  b: number;
  c: number;
  normal: Vector3;
}

/** MeshBVH 射线命中结果。 */
export interface BVHIntersection {
  /** 射线 origin 到命中点的距离。 */
  distance: number;
  /** 命中点(几何体局部坐标)。 */
  point: Vector3;
  /** 命中的三角形(顶点索引 + 法线)。 */
  face: BVHFace;
  /** 三角形索引(0-based,对应几何体的三角形顺序)。 */
  faceIndex: number;
  /** 命中点的 UV(若几何体带 uv 属性)。 */
  uv?: Vector2;
}

/** 最近点查询结果。 */
export interface BVHClosestPoint {
  /** 网格表面上的最近点。 */
  point: Vector3;
  /** 查询点到最近点的欧氏距离。 */
  distance: number;
  /** 最近点所在的三角形索引。 */
  faceIndex: number;
}

// 模块内复用的临时变量,避免查询时频繁分配。
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _tri = new Triangle();
const _closest = new Vector3();
const _bary = new Vector3();
const _uvA = new Vector2();
const _uvB = new Vector2();
const _uvC = new Vector2();

export class MeshBVH {
  /** 内部 BVH 实例。 */
  bvh: BVH;
  /** 关联的几何体。 */
  geometry: BufferGeometry;

  constructor(geometry: BufferGeometry, options: BVHBuildOptions = {}) {
    this.geometry = geometry;
    this.bvh = new BVH(options).build(geometry, options);
  }

  /** 射线检测:返回所有相交三角形,按 distance 升序。 */
  raycast(ray: Ray): BVHIntersection[] {
    const hits = this.bvh.raycast(ray);
    const out: BVHIntersection[] = [];
    if (hits.length === 0) return out;

    const posAttr = this.geometry.attributes.position;
    const uvAttr = this.geometry.attributes.uv;
    if (!posAttr) return out;
    const posArr = posAttr.array;
    const uvArr = uvAttr ? uvAttr.array : null;

    for (const hit of hits) {
      const [ia, ib, ic] = this.bvh.getTriangleVertexIndices(hit.triangleIndex);
      _v0.set(posArr[ia * 3], posArr[ia * 3 + 1], posArr[ia * 3 + 2]);
      _v1.set(posArr[ib * 3], posArr[ib * 3 + 1], posArr[ib * 3 + 2]);
      _v2.set(posArr[ic * 3], posArr[ic * 3 + 1], posArr[ic * 3 + 2]);
      const normal = Triangle.getNormal(_v0, _v1, _v2, new Vector3());
      const face: BVHFace = { a: ia, b: ib, c: ic, normal };

      let uv: Vector2 | undefined;
      if (uvArr) {
        _uvA.set(uvArr[ia * 2], uvArr[ia * 2 + 1]);
        _uvB.set(uvArr[ib * 2], uvArr[ib * 2 + 1]);
        _uvC.set(uvArr[ic * 2], uvArr[ic * 2 + 1]);
        const bary = Triangle.getBarycoord(hit.point, _v0, _v1, _v2, _bary);
        if (bary) {
          uv = new Vector2(
            _uvA.x * bary.x + _uvB.x * bary.y + _uvC.x * bary.z,
            _uvA.y * bary.x + _uvB.y * bary.y + _uvC.y * bary.z,
          );
        }
      }

      out.push({ distance: hit.distance, point: hit.point, face, faceIndex: hit.triangleIndex, uv });
    }
    return out;
  }

  /** 最近点查询:返回网格表面离 point 最近的点。无几何体时返回 null。 */
  closestPointToPoint(point: Vector3): BVHClosestPoint | null {
    if (this.bvh.root === null) return null;
    const posAttr = this.geometry.attributes.position;
    if (!posAttr) return null;
    const posArr = posAttr.array;

    const best: { distSq: number; point: Vector3; faceIndex: number } = {
      distSq: Infinity,
      point: new Vector3(),
      faceIndex: -1,
    };

    const walk = (node: BVHNode): void => {
      // 早出:子树 AABB 到查询点的距离平方 >= 当前最佳距离平方
      const boxDist = node.bounds.distanceToPoint(point);
      if (boxDist * boxDist > best.distSq) return;

      if (node.isLeaf() && node.triangles) {
        for (const t of node.triangles) {
          const [ia, ib, ic] = this.bvh.getTriangleVertexIndices(t);
          _v0.set(posArr[ia * 3], posArr[ia * 3 + 1], posArr[ia * 3 + 2]);
          _v1.set(posArr[ib * 3], posArr[ib * 3 + 1], posArr[ib * 3 + 2]);
          _v2.set(posArr[ic * 3], posArr[ic * 3 + 1], posArr[ic * 3 + 2]);
          _tri.set(_v0, _v1, _v2);
          _tri.closestPointToPoint(point, _closest);
          const dx = _closest.x - point.x;
          const dy = _closest.y - point.y;
          const dz = _closest.z - point.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < best.distSq) {
            best.distSq = distSq;
            best.point.copy(_closest);
            best.faceIndex = t;
          }
        }
        return;
      }
      if (node.left) walk(node.left);
      if (node.right) walk(node.right);
    };

    walk(this.bvh.root);
    if (best.faceIndex < 0) return null;
    return { point: best.point, distance: Math.sqrt(best.distSq), faceIndex: best.faceIndex };
  }
}
