// LineSegments2 / Line2 — 粗线物体,配合 LineSegmentsGeometry / LineGeometry + LineMaterial。
//
// 参考 three.js examples/jsm/lines/LineSegments2.js / Line2.js。与 Core/Line 的区别:
//   - Line/LineSegments/LineLoop 用 GL_LINE_STRIP / GL_LINES / GL_LINE_LOOP,
//     受 gl.lineWidth=1 限制,只能画 1 像素细线。
//   - LineSegments2 / Line2 用屏幕空间四边形扩展(实例化绘制),可画任意像素
//     宽度的抗锯齿粗线,支持端点圆角帽、虚线、逐顶点颜色、worldUnits 模式。
//
// 继承关系:
//   LineSegments2 (Object3D) — 独立线段粗线物体,几何体为 LineSegmentsGeometry
//     └─ Line2 — 折线粗线物体,几何体为 LineGeometry(折线链→线段对)
//
// computeLineDistances:
//   - LineSegments2:每段独立,起点 lineDistance=0,终点 lineDistance=段长
//   - Line2:折线累计,顶点 0 的 lineDistance=0,后续逐段累加(与 Line 一致)
//   写入 LineSegmentsGeometry 的 instanceDistanceStart / instanceDistanceEnd
//   自定义属性(itemSize=1),供 LineMaterial 的虚线 discard 使用。
//
// raycast:
//   与 Line.raycast 同算法(Ray.distanceSqToSegment 阈值拾取),区别在于:
//   - 顶点数据来自 instanceStart / instanceEnd 自定义属性,而非 position 属性。
//   - 阈值来自 raycaster.params.Line2.threshold(若未配置则回退到 params.Line.threshold)。
//   - worldUnits=true 时阈值按世界空间解释(material.linewidth/2 作为下限)。
//
// 与 three.js 的差异:
//   - three.js LineSegments2 extends Mesh,VREEN 直接 extends Object3D(与 Line 一致)。
//   - three.js 在 raycast 中用 geometry.attributes.instanceStart/instanceEnd
//     (InterleavedBufferAttribute),VREEN 用 InstancedGeometry.customAttributes。
//   - VREEN 不依赖 renderer,raycast 完全在数据层完成,可无头测试。

import { Object3D } from './Object3D';
import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';
import { LineSegmentsGeometry } from '../Geometries/LineSegmentsGeometry';
import { LineGeometry } from '../Geometries/LineGeometry';
import { LineMaterial } from '../Materials/LineMaterial';
import type { Raycaster, Intersection } from './Raycaster';

// ── raycast 内部复用的临时变量 ─────────────────────────────────
const _inverseMatrix = new Matrix4();
const _localRay = new Ray();
const _vStart = new Vector3();
const _vEnd = new Vector3();
const _intersectPointOnRay = new Vector3();
const _intersectPointOnSegment = new Vector3();

/**
 * 粗线段物体 — 用屏幕空间四边形扩展绘制带宽度的独立线段。
 *
 * 配合 LineSegmentsGeometry + LineMaterial 使用。renderer 把每条线段作为
 * 一个实例,用模板四边形实例化绘制,顶点着色器在屏幕空间扩展成带宽度的线段。
 *
 * ```ts
 * const geom = new LineSegmentsGeometry();
 * geom.setPositions([0,0,0, 1,0,0,  1,0,0, 1,1,0]);
 * const mat = new LineMaterial({ color: { r: 0, g: 1, b: 0.8 }, linewidth: 3 });
 * mat.resolution = new Vector2(1920, 1080);
 * const line = new LineSegments2(geom, mat);
 * line.computeLineDistances();
 * scene.add(line);
 * ```
 */
export class LineSegments2 extends Object3D {
  override readonly type: string = 'LineSegments2';
  /** 类型标志:粗线段物体。 */
  isLineSegments2: boolean = true;
  /** Line2 标志(基类为 false,Line2 覆盖为 true)。 */
  isLine2: boolean = false;

  geometry: LineSegmentsGeometry;
  material: LineMaterial | LineMaterial[];

  constructor(
    geometry: LineSegmentsGeometry = new LineSegmentsGeometry(),
    material: LineMaterial | LineMaterial[] = new LineMaterial(),
  ) {
    super();
    this.geometry = geometry;
    this.material = material;
  }

  /**
   * 计算每条独立线段的 lineDistance,写入 instanceDistanceStart / instanceDistanceEnd
   * 自定义属性。每段起点 lineDistance=0,终点 lineDistance=段长。
   * 供 LineMaterial 的虚线 discard 使用(需 material.dashed=true)。
   */
  computeLineDistances(): this {
    const geometry = this.geometry;
    const start = geometry.customAttributes.get('instanceStart');
    const end = geometry.customAttributes.get('instanceEnd');
    if (!start || !end) return this;

    const segmentCount = geometry.instanceCount;
    const distStart = new Float32Array(segmentCount);
    const distEnd = new Float32Array(segmentCount);

    for (let i = 0; i < segmentCount; i++) {
      const o = i * 3;
      _vStart.set(start[o], start[o + 1], start[o + 2]);
      _vEnd.set(end[o], end[o + 1], end[o + 2]);
      distStart[i] = 0;
      distEnd[i] = _vStart.distanceTo(_vEnd);
    }

    geometry.customAttributes.set('instanceDistanceStart', distStart);
    geometry.customAttributeSizes.set('instanceDistanceStart', 1);
    geometry.customAttributeVersions.set(
      'instanceDistanceStart',
      (geometry.customAttributeVersions.get('instanceDistanceStart') ?? 0) + 1,
    );
    geometry.customAttributes.set('instanceDistanceEnd', distEnd);
    geometry.customAttributeSizes.set('instanceDistanceEnd', 1);
    geometry.customAttributeVersions.set(
      'instanceDistanceEnd',
      (geometry.customAttributeVersions.get('instanceDistanceEnd') ?? 0) + 1,
    );
    return this;
  }

  /**
   * 射线检测:对每条线段实例调用 Ray.distanceSqToSegment,若最近距离平方
   * ≤ localThresholdSq 则命中。
   *
   * 算法参考 three.js LineSegments2.raycast(与 Line.raycast 同源):
   *   1. 本地包围球剔除(本地空间,半径 + localThreshold)。
   *   2. 世界 ray → geometry 局部空间。
   *   3. localThreshold = threshold / mean(scale)。
   *   4. 遍历每个实例:从 instanceStart/instanceEnd 读取线段端点,
   *      调用 Ray.distanceSqToSegment 判定。
   *   5. 命中填 distance(世界)、point(线段上最近点的世界坐标)、index(段索引)。
   *
   * 阈值来源:raycaster.params.Line2.threshold,若未配置则回退到 params.Line.threshold。
   */
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const geometry = this.geometry;
    const start = geometry.customAttributes.get('instanceStart');
    const end = geometry.customAttributes.get('instanceEnd');
    if (!start || !end) return;

    // 阈值:优先用 params.Line2,回退到 params.Line。
    const threshold = raycaster.params.Line2
      ? raycaster.params.Line2.threshold
      : raycaster.params.Line.threshold;

    // 本地包围球剔除。
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const bs = geometry.boundingSphere;
    if (bs === null) return;

    // 世界 ray → geometry 局部空间。
    _inverseMatrix.getInverse(this.matrixWorld);
    _localRay.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

    // 本地阈值 = 世界阈值 / 平均缩放。
    const me = this.matrixWorld.elements;
    const sx = Math.hypot(me[0], me[1], me[2]);
    const sy = Math.hypot(me[4], me[5], me[6]);
    const sz = Math.hypot(me[8], me[9], me[10]);
    const meanScale = (sx + sy + sz) / 3;
    const localThreshold = meanScale > 0 ? threshold / meanScale : threshold;
    const localThresholdSq = localThreshold * localThreshold;

    // 包围球(本地空间)与本地射线的距离剔除。
    if (
      _localRay.distanceSqToPoint(bs.center) >
      (bs.radius + localThreshold) * (bs.radius + localThreshold)
    ) {
      return;
    }

    const segmentCount = geometry.instanceCount;
    for (let i = 0; i < segmentCount; i++) {
      const o = i * 3;
      _vStart.set(start[o], start[o + 1], start[o + 2]);
      _vEnd.set(end[o], end[o + 1], end[o + 2]);

      const distSq = _localRay.distanceSqToSegment(
        _vStart,
        _vEnd,
        _intersectPointOnRay,
        _intersectPointOnSegment,
      );
      if (distSq > localThresholdSq) continue;

      // 射线上最近点 → 世界空间,计算世界距离(供排序与 near/far 过滤)。
      _intersectPointOnRay.applyMatrix4(this.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(_intersectPointOnRay);
      if (distance < raycaster.near || distance > raycaster.far) continue;

      // 命中点取线段上最近点(世界空间),与 three.js 一致。
      intersects.push({
        distance,
        point: _intersectPointOnSegment.clone().applyMatrix4(this.matrixWorld),
        index: i,
        object: this,
      });
    }
  }
}

/**
 * 折线粗线物体 — 用屏幕空间四边形扩展绘制带宽度的连续折线。
 *
 * 配合 LineGeometry + LineMaterial 使用。LineGeometry 把折线顶点链
 * [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] 转换为线段端点对格式,这样 Line2
 * 就能像 LineSegments2 一样用实例化四边形扩展绘制连续粗折线。
 *
 * 与 LineSegments2 的区别:
 *   - 几何体为 LineGeometry(折线链→线段对),而非 LineSegmentsGeometry(独立线段对)。
 *   - computeLineDistances 计算累计线长(折线从头到尾的累计距离),而非每段独立。
 *
 * ```ts
 * const geom = new LineGeometry();
 * geom.setPositions([0,0,0, 1,0,0, 1,1,0, 0,1,0]); // 4 顶点折线 → 3 段
 * const mat = new LineMaterial({ color: { r: 0.2, g: 1, b: 0.8 }, linewidth: 4 });
 * mat.resolution = new Vector2(1920, 1080);
 * const line = new Line2(geom, mat);
 * line.computeLineDistances();
 * scene.add(line);
 * ```
 */
export class Line2 extends LineSegments2 {
  override readonly type: string = 'Line2';
  override isLine2: boolean = true;

  constructor(
    geometry: LineGeometry = new LineGeometry(),
    material: LineMaterial | LineMaterial[] = new LineMaterial(),
  ) {
    super(geometry, material);
  }

  /**
   * 计算折线的累计 lineDistance,写入 instanceDistanceStart / instanceDistanceEnd
   * 自定义属性。折线顶点 0 的 lineDistance=0,后续逐段累加(与 Line.computeLineDistances 一致)。
   * 供 LineMaterial 的虚线 discard 使用(需 material.dashed=true)。
   *
   * 与 LineSegments2.computeLineDistances 的区别:每段的 instanceDistanceStart
   * 不再是 0,而是前一段的 instanceDistanceEnd(累计距离)。
   */
  override computeLineDistances(): this {
    const geometry = this.geometry;
    const start = geometry.customAttributes.get('instanceStart');
    const end = geometry.customAttributes.get('instanceEnd');
    if (!start || !end) return this;

    const segmentCount = geometry.instanceCount;
    const distStart = new Float32Array(segmentCount);
    const distEnd = new Float32Array(segmentCount);

    let cumulative = 0;
    for (let i = 0; i < segmentCount; i++) {
      const o = i * 3;
      _vStart.set(start[o], start[o + 1], start[o + 2]);
      _vEnd.set(end[o], end[o + 1], end[o + 2]);
      const segLen = _vStart.distanceTo(_vEnd);
      distStart[i] = cumulative;
      cumulative += segLen;
      distEnd[i] = cumulative;
    }

    geometry.customAttributes.set('instanceDistanceStart', distStart);
    geometry.customAttributeSizes.set('instanceDistanceStart', 1);
    geometry.customAttributeVersions.set(
      'instanceDistanceStart',
      (geometry.customAttributeVersions.get('instanceDistanceStart') ?? 0) + 1,
    );
    geometry.customAttributes.set('instanceDistanceEnd', distEnd);
    geometry.customAttributeSizes.set('instanceDistanceEnd', 1);
    geometry.customAttributeVersions.set(
      'instanceDistanceEnd',
      (geometry.customAttributeVersions.get('instanceDistanceEnd') ?? 0) + 1,
    );
    return this;
  }
}
