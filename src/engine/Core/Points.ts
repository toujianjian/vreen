// Points — 点云 / 点精灵物体。把 BufferGeometry 的每个顶点作为一个
// 屏幕空间点(或世界空间圆点)绘制,常用于粒子系统、点云扫描数据、
// 调试可视化、星空等。
//
// 参考 three.js Points.js。继承 Object3D,持有 geometry + PointsMaterial。
// 与 three.js 的差异:
//   * three.js 的 raycast 用 Sphere 做世界空间包围球剔除;VREEN 沿用
//     Mesh.raycast 的本地空间策略(把 ray 变到 geometry 局部空间,用
//     boundingSphere.center + radius 做距离平方剔除),避免引入 Sphere 类。
//   * 阈值缩放:three.js 用 `threshold / mean(scale)`;VREEN 完全一致,
//     scale 取 matrixWorld 上 3x3 列向量长度的平均值。
//   * 命中结果填 `distanceToRay`(本地点到射线的距离平方根)与 `index`,
//     与 three.js Intersection 结构对齐(VREEN Intersection 已有 distanceToRay 字段)。
//
// 注意:
//   * Points 不投射阴影(castShadow 无效),与 three.js 一致。
//   * 几何体的 index 被忽略 — 点云按 position 顶点顺序逐点绘制。
//   * sizeAttenuation / size / map 等渲染参数在 PointsMaterial 中定义,
//     renderer 走独立的 points shader path。

import { Object3D } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';
import { PointsMaterial } from '../Materials/PointsMaterial';
import type { Raycaster, Intersection } from './Raycaster';

// ── raycast 内部复用的临时变量(避免每次分配) ─────────────────────
const _inverseMatrix = new Matrix4();
const _localRay = new Ray();
const _localPoint = new Vector3();
const _closestPoint = new Vector3();
const _worldPoint = new Vector3();

/**
 * 点云物体 — 把 geometry 的每个顶点绘制为一个点。
 *
 * 典型用法:
 * ```ts
 * const geo = new BufferGeometry();
 * geo.setAttribute('position', new BufferAttribute(positions, 3));
 * const mat = new PointsMaterial({ color: { r: 1, g: 0.6, b: 0.2 }, size: 0.1 });
 * const points = new Points(geo, mat);
 * scene.add(points);
 * ```
 */
export class Points extends Object3D {
  override readonly type: string = 'Points';
  /** 类型标志,用于 duck-type 检测。 */
  isPoints: boolean = true;

  geometry: BufferGeometry;
  material: PointsMaterial | PointsMaterial[];

  /** Points 不投射阴影(与 three.js 一致)。字段保留以兼容场景图 API。 */
  castShadow: boolean = false;
  receiveShadow: boolean = false;

  constructor(
    geometry: BufferGeometry = new BufferGeometry(),
    material: PointsMaterial | PointsMaterial[] = new PointsMaterial(),
  ) {
    super();
    this.geometry = geometry;
    this.material = material;
  }

  /**
   * 射线检测:对每个顶点,计算射线到该点的最近距离,若 ≤ threshold 则命中。
   *
   * 实现参考 three.js Points.raycast:
   *   1. localThreshold = threshold / mean(scale);scale 取 matrixWorld 列长。
   *   2. 把世界 ray 变到 geometry 局部空间。
   *   3. 本地包围球剔除(ray 到 boundingSphere.center 的距离平方 > r² 则返回)。
   *   4. 逐顶点:distanceSq = localRay.distanceSqToPoint(localPoint);
   *      若 > localThresholdSq 跳过;否则取 localRay.closestPointToPoint 作为
   *      命中点,变换到世界空间,计算世界距离,按 near/far 过滤。
   *
   * @param raycaster  射线检测器(读 params.Points.threshold、near、far)
   * @param intersects 命中结果累加数组
   */
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const geometry = this.geometry;
    const position = geometry.attributes.position;
    if (position === undefined) return;

    const threshold = raycaster.params.Points.threshold;
    // 本地阈值 = 世界阈值 / 平均缩放(点云在本地空间测试)。
    const me = this.matrixWorld.elements;
    const sx = Math.hypot(me[0], me[1], me[2]);
    const sy = Math.hypot(me[4], me[5], me[6]);
    const sz = Math.hypot(me[8], me[9], me[10]);
    const meanScale = (sx + sy + sz) / 3;
    // 退化缩放(0)时退化为世界阈值,避免除零产生 Inf。
    const localThreshold = meanScale > 0 ? threshold / meanScale : threshold;
    const localThresholdSq = localThreshold * localThreshold;

    // 本地包围球剔除。
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const bs = geometry.boundingSphere;
    if (bs === null) return;

    // 世界 ray → geometry 局部空间。
    _inverseMatrix.getInverse(this.matrixWorld);
    _localRay.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

    // 包围球(本地空间)与本地射线的距离剔除:
    // 球心到射线距离 > 半径 + 阈值 → 整个点云不可能命中,直接返回。
    if (_localRay.distanceSqToPoint(bs.center) > bs.radius * bs.radius + localThresholdSq) {
      return;
    }

    const array = position.array;
    const stride = position.itemSize;
    const pointCount = position.count;

    for (let i = 0; i < pointCount; i++) {
      const off = i * stride;
      _localPoint.set(array[off], array[off + 1], array[off + 2]);

      const distanceSq = _localRay.distanceSqToPoint(_localPoint);
      if (distanceSq > localThresholdSq) continue;

      // 本地命中点 = 射线上离 localPoint 最近的点。
      _localRay.closestPointToPoint(_localPoint, _closestPoint);
      // 变换到世界空间计算世界距离(供排序与 near/far 过滤)。
      _worldPoint.copy(_closestPoint).applyMatrix4(this.matrixWorld);

      const distance = raycaster.ray.origin.distanceTo(_worldPoint);
      if (distance < raycaster.near || distance > raycaster.far) continue;

      intersects.push({
        distance,
        distanceToRay: Math.sqrt(distanceSq),
        point: _worldPoint.clone(),
        index: i,
        object: this,
      });
    }
  }

  /** 更新 matrixWorld 后顺带让 geometry 的 boundingSphere / boundingBox 可用。 */
  override updateMatrixWorld(force: boolean = false): void {
    super.updateMatrixWorld(force);
    if (this.geometry.boundingSphere === null) this.geometry.computeBoundingSphere();
  }
}
