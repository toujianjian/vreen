// BVHNode — Bounding Volume Hierarchy 节点。
//
// 每个节点持有一个轴对齐包围盒(bounds)。内部节点的左右子树通过递归二分
// 空间得到;叶子节点持有 triangles: number[] —— 这些是 BVH 三角形列表
// (在 BVH 中扁平存储,每个三角形由 3 个顶点索引构成)的 0-based 索引。
//
// 空节点约定: bounds 为空盒(min=+∞, max=-∞);仅当几何体无 position
// 属性时才会出现这种情况。
//
// 参考: Parker et al. "Fast Ray Tracing with BVH" (SIGGRAPH course);
//       three.js MeshBVH(https://github.com/gkjohnson/three-mesh-bvh)。

import { Box3 } from '../Math/Box3';
import type { Ray } from '../Math/Ray';

export class BVHNode {
  /** 本节点的 AABB(并集为子树所有三角形的外接盒)。 */
  bounds: Box3;
  /** 左子树;叶子节点为 null。 */
  left: BVHNode | null = null;
  /** 右子树;叶子节点为 null。 */
  right: BVHNode | null = null;
  /** 叶子节点的三角形索引列表(0-based,指向 BVH 三角形列表);内部节点为 null。 */
  triangles: number[] | null = null;
  /** 节点在树中的深度,根节点为 0。 */
  depth: number;

  constructor(depth: number = 0) {
    this.bounds = new Box3();
    this.depth = depth;
  }

  /** 叶子判定:无左右子树即叶子。 */
  isLeaf(): boolean {
    return this.left === null && this.right === null;
  }

  /** 射线与节点 AABB 的相交测试(斯拉布斯法,委托 Ray.intersectsBox)。
   *  仅做粗粒度剔除,精确命中需在叶子内做三角形测试。 */
  intersect(ray: Ray): boolean {
    return ray.intersectsBox(this.bounds);
  }
}
