// Acceleration barrel — 空间加速结构(BVH / Octree)的统一导出出口。
//
// 提供的 API:
//   * BVHNode       BVH 树节点
//   * BVH           通用 BVH 树(build / raycast / raycastFirst /
//                  intersectsFrustum / getBounds / traverse / getStats)
//   * BVHBuilder    构建策略枚举(BVHBuildStrategy)与构建产物类型
//   * MeshBVH       网格专用 BVH 包装(raycast / closestPointToPoint)
//   * Octree        八叉树(分割 + 胶囊/球/盒/射线 vs 三角形体碰撞)
//   * Capsule       胶囊碰撞器(Octree 的体碰撞合作器)
//   * OctreeHelper  Octree 可视化数据产出(子盒/叶子盒收集)

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
// Octree — 八叉树体碰撞结构(three.js jsm/math/Octree 适配)。与 BVH 互补:
// BVH 优化单次射线查询,Octree 优化高频体(胶囊/球/盒)采样碰撞。
export {
  Octree,
  type OctreeCollision,
  type OctreeRayHit,
} from './Octree';
// Capsule — 胶囊碰撞几何(three.js jsm/math/Capsule 适配),Octree 的体碰撞器。
export { Capsule } from './Capsule';
// OctreeHelper — Octree 可视化数据产出(three.js jsm/helpers/OctreeHelper 适配)。
export { OctreeHelper } from './OctreeHelper';
