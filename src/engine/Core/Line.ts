// Line / LineSegments / LineLoop — 线段物体。
//
// 参考 three.js Line.js / LineSegments.js / LineLoop.js。三者共享同一套
// raycast 逻辑(基于 Ray.distanceSqToSegment 的阈值拾取),区别仅在于
// 顶点配对方式(step):
//   - Line         : LINE_STRIP,顶点 0-1-2-3… 首尾相连成折线(step=1)
//   - LineSegments : LINES,顶点两两成段 (0-1)(2-3)(4-5)…(step=2)
//   - LineLoop     : LINE_LOOP,同 Line 但末顶点连回首顶点(step=1 + 闭合边)
//
// 与 three.js 的差异:
//   * three.js 的 raycast 在世界空间做包围球剔除(Sphere.applyMatrix4);
//     VREEN 沿用 Points.raycast 的本地空间策略(把 ray 变到 geometry
//     局部空间,用 boundingSphere.center + radius 做距离平方剔除),
//     避免引入可变 Sphere 类。数值上等价(均匀缩放下完全一致)。
//   * VREEN BufferGeometry 无 drawRange / morphAttributes,因此 raycast
//     遍历完整 index/position 范围,且不实现 updateMorphTargets(空操作)。
//   * computeLineDistances 仅支持非索引几何体(与 three.js 一致);
//     索引几何体打印 warning 并跳过。
//   * 阈值缩放:localThreshold = threshold / mean(scale),与 three.js 完全一致。
//
// 渲染:renderer 走独立的 line shader path(GL_LINES / GL_LINE_STRIP /
// GL_LINE_LOOP),线宽由 LineBasicMaterial.linewidth 提供。注意 WebGL
// 规范 linewidth > 1 在多数实现中被忽略;需要粗线请用 Line2 + LineMaterial
// (屏幕空间四边形扩展,后续模块实现)。

import { Object3D } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';
import { LineBasicMaterial } from '../Materials/LineBasicMaterial';
import type { Raycaster, Intersection } from './Raycaster';

// ── raycast 内部复用的临时变量 ─────────────────────────────────
const _inverseMatrix = new Matrix4();
const _localRay = new Ray();
const _vStart = new Vector3();
const _vEnd = new Vector3();
const _intersectPointOnRay = new Vector3();
const _intersectPointOnSegment = new Vector3();

/**
 * 折线物体 — 顶点按 LINE_STRIP 连接(0-1-2-3…)。
 *
 * 配合 LineBasicMaterial 使用,renderer 发出 gl.drawArrays(gl.LINE_STRIP, …)。
 */
export class Line extends Object3D {
  override readonly type: string = 'Line';
  /** 类型标志:折线(LINE_STRIP)。 */
  isLine: boolean = true;
  /** LineSegments 标志(基类为 false,LineSegments 覆盖为 true)。 */
  isLineSegments: boolean = false;
  /** LineLoop 标志(基类为 false,LineLoop 覆盖为 true)。 */
  isLineLoop: boolean = false;

  geometry: BufferGeometry;
  material: LineBasicMaterial | LineBasicMaterial[];

  constructor(
    geometry: BufferGeometry = new BufferGeometry(),
    material: LineBasicMaterial | LineBasicMaterial[] = new LineBasicMaterial(),
  ) {
    super();
    this.geometry = geometry;
    this.material = material;
  }

  /**
   * 计算逐顶点累计线长(lineDistance 属性),供虚线 / 沿线流动纹理使用。
   * 仅支持非索引几何体;索引几何体打印 warning 并跳过(与 three.js 一致)。
   */
  computeLineDistances(): this {
    const geometry = this.geometry;
    if (geometry.index === null) {
      const position = geometry.attributes.position as BufferAttribute;
      const lineDistances = new Float32Array(position.count);
      lineDistances[0] = 0;
      for (let i = 1; i < position.count; i++) {
        const off0 = (i - 1) * position.itemSize;
        const off1 = i * position.itemSize;
        _vStart.set(position.array[off0], position.array[off0 + 1], position.array[off0 + 2]);
        _vEnd.set(position.array[off1], position.array[off1 + 1], position.array[off1 + 2]);
        lineDistances[i] = lineDistances[i - 1] + _vStart.distanceTo(_vEnd);
      }
      geometry.setAttribute('lineDistance', new BufferAttribute(lineDistances, 1));
    } else {
      console.warn(
        'Line.computeLineDistances(): only non-indexed BufferGeometry is supported.',
      );
    }
    return this;
  }

  /**
   * 射线检测:对每条边调用 Ray.distanceSqToSegment,若最近距离平方
   * ≤ localThresholdSq 则命中。
   *
   * 实现参考 three.js Line.raycast:
   *   1. 本地包围球剔除(本地空间,半径 + localThreshold)。
   *   2. 世界 ray → geometry 局部空间。
   *   3. localThreshold = threshold / mean(scale)。
   *   4. 按 step 遍历边:Line/LineLoop step=1(0-1,1-2,…),LineSegments
   *      step=2(0-1,2-3,…)。LineLoop 额外闭合末→首边。
   *   5. 命中填 distance(世界)、point(线段上最近点的世界坐标)、index(边起点)。
   */
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const geometry = this.geometry;
    const position = geometry.attributes.position as BufferAttribute;
    if (position === undefined) return;

    const threshold = raycaster.params.Line.threshold;

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

    // 包围球(本地空间)与本地射线的距离剔除:
    // 球心到射线距离 > 半径 + 阈值 → 整条折线不可能命中。
    if (
      _localRay.distanceSqToPoint(bs.center) >
      (bs.radius + localThreshold) * (bs.radius + localThreshold)
    ) {
      return;
    }

    const step = this.isLineSegments ? 2 : 1;
    const index = geometry.index;

    if (index !== null) {
      const idxArr = index.array as unknown as ArrayLike<number>;
      const end = idxArr.length;
      for (let i = 0; i < end - 1; i += step) {
        const a = idxArr[i];
        const b = idxArr[i + 1];
        const hit = checkIntersection(
          this,
          raycaster,
          _localRay,
          localThresholdSq,
          a,
          b,
          position,
        );
        if (hit) intersects.push(hit);
      }
      if (this.isLineLoop && end >= 2) {
        const hit = checkIntersection(
          this,
          raycaster,
          _localRay,
          localThresholdSq,
          idxArr[end - 1],
          idxArr[0],
          position,
        );
        if (hit) intersects.push(hit);
      }
    } else {
      const pointCount = position.count;
      for (let i = 0; i < pointCount - 1; i += step) {
        const hit = checkIntersection(
          this,
          raycaster,
          _localRay,
          localThresholdSq,
          i,
          i + 1,
          position,
        );
        if (hit) intersects.push(hit);
      }
      if (this.isLineLoop && pointCount >= 2) {
        const hit = checkIntersection(
          this,
          raycaster,
          _localRay,
          localThresholdSq,
          pointCount - 1,
          0,
          position,
        );
        if (hit) intersects.push(hit);
      }
    }
  }
}

/**
 * 独立线段物体 — 顶点两两成段 (0-1)(2-3)(4-5)…(LINES)。
 *
 * 配合 LineBasicMaterial 使用,renderer 发出 gl.drawArrays(gl.LINES, …)。
 * 与 Line 的区别:raycast step=2,且不闭合。
 */
export class LineSegments extends Line {
  override readonly type: string = 'LineSegments';
  override isLineSegments: boolean = true;

  constructor(
    geometry: BufferGeometry = new BufferGeometry(),
    material: LineBasicMaterial | LineBasicMaterial[] = new LineBasicMaterial(),
  ) {
    super(geometry, material);
  }

  /**
   * 计算每条独立线段的 lineDistance(每段从 0 开始,与 three.js 一致)。
   * 仅支持非索引几何体。
   */
  override computeLineDistances(): this {
    const geometry = this.geometry;
    if (geometry.index === null) {
      const position = geometry.attributes.position as BufferAttribute;
      const lineDistances = new Float32Array(position.count);
      for (let i = 0, l = position.count; i < l; i += 2) {
        const off0 = i * position.itemSize;
        const off1 = (i + 1) * position.itemSize;
        _vStart.set(position.array[off0], position.array[off0 + 1], position.array[off0 + 2]);
        _vEnd.set(position.array[off1], position.array[off1 + 1], position.array[off1 + 2]);
        lineDistances[i] = 0;
        lineDistances[i + 1] = _vStart.distanceTo(_vEnd);
      }
      geometry.setAttribute('lineDistance', new BufferAttribute(lineDistances, 1));
    } else {
      console.warn(
        'LineSegments.computeLineDistances(): only non-indexed BufferGeometry is supported.',
      );
    }
    return this;
  }
}

/**
 * 闭合折线物体 — LINE_STRIP 且末顶点连回首顶点(LINE_LOOP)。
 *
 * 配合 LineBasicMaterial 使用,renderer 发出 gl.drawArrays(gl.LINE_LOOP, …)。
 * 与 Line 的区别:raycast 额外检测末→首闭合边。
 */
export class LineLoop extends Line {
  override readonly type: string = 'LineLoop';
  override isLineLoop: boolean = true;

  constructor(
    geometry: BufferGeometry = new BufferGeometry(),
    material: LineBasicMaterial | LineBasicMaterial[] = new LineBasicMaterial(),
  ) {
    super(geometry, material);
  }
}

// ── raycast 内部:单条边的距离判定 ──────────────────────────────
function checkIntersection(
  object: Line,
  raycaster: Raycaster,
  ray: Ray,
  thresholdSq: number,
  a: number,
  b: number,
  position: BufferAttribute,
): Intersection | null {
  const off0 = a * position.itemSize;
  const off1 = b * position.itemSize;
  _vStart.set(position.array[off0], position.array[off0 + 1], position.array[off0 + 2]);
  _vEnd.set(position.array[off1], position.array[off1 + 1], position.array[off1 + 2]);

  const distSq = ray.distanceSqToSegment(_vStart, _vEnd, _intersectPointOnRay, _intersectPointOnSegment);
  if (distSq > thresholdSq) return null;

  // 射线上最近点 → 世界空间,计算世界距离(供排序与 near/far 过滤)。
  _intersectPointOnRay.applyMatrix4(object.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(_intersectPointOnRay);
  if (distance < raycaster.near || distance > raycaster.far) return null;

  // 命中点取线段上最近点(世界空间),与 three.js 一致。
  return {
    distance,
    point: _intersectPointOnSegment.clone().applyMatrix4(object.matrixWorld),
    index: a,
    object,
  };
}
