// Acceleration barrel — 空间加速结构(BVH)的统一导出出口。
//
// 提供的 API:
//   * BVHNode       BVH 树节点
//   * BVH           通用 BVH 树(build / raycast / raycastFirst /
//                  intersectsFrustum / getBounds / traverse / getStats)
//   * BVHBuilder    构建策略枚举(BVHBuildStrategy)与构建产物类型
//   * MeshBVH       网格专用 BVH 包装(raycast / closestPointToPoint)

export { BVHNode } from './BVHNode';
export {
  BVH,
  type BVHRayHit,
  type BVHStats,
} from './BVH';
export {
  BVHBuildStrategy,
  buildBVH,
  extractTriangles,
  type BVHBuildOptions,
  type BVHBuildResult,
} from './BVHBuilder';
export {
  MeshBVH,
  type BVHFace,
  type BVHIntersection,
  type BVHClosestPoint,
} from './MeshBVH';
