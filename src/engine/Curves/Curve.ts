// Curve — 抽象基类,适配自 three.js src/extras/core/Curve.js (MIT)。
// 提供 arc-length 参数化、切线计算、Frenet 标架等通用曲线能力。
//
// 与 three.js 的差异:
//  • 泛型 <TVector extends CurvePoint> 让子类返回具体向量类型。
//  • 默认 getTangent 用 pt1.clone() 创建返回值,无需 isVector2 运行时标记。
//  • computeFrenetFrames 用 Quaternion.setFromAxisAngle + applyQuaternion
//    替代 three.js 的 Matrix4.makeRotationAxis(VREEN Matrix4 未实现该方法)。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { clamp } from '../Math/MathUtils';

/**
 * 曲线点所需的最小结构接口。Vector2 与 Vector3 均结构性满足此约束,
 * 因此 Curve<Vector3> 与 Curve<Vector2> 都可实例化。
 */
export interface CurvePoint {
  x: number;
  y: number;
  copy(v: this): this;
  clone(): this;
  add(v: this): this;
  sub(v: this): this;
  subVectors(a: this, b: this): this;
  multiplyScalar(s: number): this;
  divideScalar(s: number): this;
  distanceTo(v: this): number;
  distanceToSquared(v: this): number;
  normalize(): this;
  equals(v: this): boolean;
  length(): number;
  dot(v: this): number;
}

/** Frenet 标架结果。 */
export interface FrenetFrames {
  tangents: Vector3[];
  normals: Vector3[];
  binormals: Vector3[];
}

/**
 * 可扩展曲线对象。
 *
 * 子类需实现 getPoint(t, optionalTarget)。其余方法(getPointAt / getLength /
 * getTangent / computeFrenetFrames 等)由基类提供默认实现。
 *
 * @typeParam TVector - 曲线返回的向量类型(Vector2 或 Vector3)。
 */
export abstract class Curve<TVector extends CurvePoint = CurvePoint> {
  type = 'Curve';

  /** arc-length 查找表分段数,越大越精确但越慢。 */
  arcLengthDivisions = 200;

  // — 子类运行时类型判别标记 (各子类设为 true) —
  isCurve?: boolean;
  isCurvePath?: boolean;
  isLineCurve?: boolean;
  isLineCurve3?: boolean;
  isEllipseCurve?: boolean;
  isSplineCurve?: boolean;
  isCatmullRomCurve3?: boolean;
  isQuadraticBezierCurve?: boolean;
  isQuadraticBezierCurve3?: boolean;
  isCubicBezierCurve?: boolean;
  isCubicBezierCurve3?: boolean;
  isPath?: boolean;
  isShape?: boolean;

  /** @internal arc-length 缓存。 */
  protected cacheArcLengths: number[] | null = null;
  /** @internal 缓存是否需要重建。 */
  protected needsUpdate = false;

  /**
   * 返回参数 t∈[0,1] 处的曲线点。子类必须实现。
   * 如果提供了 optionalTarget 则写入其中并返回,否则创建新向量。
   */
  abstract getPoint(t: number, optionalTarget?: TVector): TVector;

  /**
   * 按弧长比例 u∈[0,1] 取点。内部先做 arc-length → t 映射再调 getPoint。
   */
  getPointAt(u: number, optionalTarget?: TVector): TVector {
    const t = this.getUtoTmapping(u);
    return this.getPoint(t, optionalTarget);
  }

  /**
   * 均匀采样 divisions+1 个点(按参数 t 等分,非弧长等分)。
   */
  getPoints(divisions = 5): TVector[] {
    const points: TVector[] = [];
    for (let d = 0; d <= divisions; d++) {
      points.push(this.getPoint(d / divisions));
    }
    return points;
  }

  /**
   * 按弧长均匀采样 divisions+1 个点。
   */
  getSpacedPoints(divisions = 5): TVector[] {
    const points: TVector[] = [];
    for (let d = 0; d <= divisions; d++) {
      points.push(this.getPointAt(d / divisions));
    }
    return points;
  }

  /** 曲线总弧长。 */
  getLength(): number {
    const lengths = this.getLengths();
    return lengths[lengths.length - 1];
  }

  /**
   * 返回 divisions+1 个累积弧长 [0, ..., totalLength]。
   * 结果带缓存;若曲线改变需调 updateArcLengths()。
   */
  getLengths(divisions = this.arcLengthDivisions): number[] {
    if (
      this.cacheArcLengths &&
      this.cacheArcLengths.length === divisions + 1 &&
      !this.needsUpdate
    ) {
      return this.cacheArcLengths;
    }

    this.needsUpdate = false;

    const cache: number[] = [];
    let current: TVector;
    let last = this.getPoint(0);
    let sum = 0;
    cache.push(0);

    for (let p = 1; p <= divisions; p++) {
      current = this.getPoint(p / divisions);
      sum += current.distanceTo(last);
      cache.push(sum);
      last = current;
    }

    this.cacheArcLengths = cache;
    return cache;
  }

  /** 标记 arc-length 缓存失效并重建。 */
  updateArcLengths(): void {
    this.needsUpdate = true;
    this.getLengths();
  }

  /**
   * 给定归一化弧长 u∈[0,1](或绝对距离 distance),返回对应的参数 t∈[0,1]。
   * 用二分查找在 arc-length 查找表中定位,再做线性插值。
   */
  getUtoTmapping(u: number, distance?: number): number {
    const arcLengths = this.getLengths();
    const il = arcLengths.length;

    let targetArcLength: number;
    if (distance !== undefined) {
      targetArcLength = distance;
    } else {
      targetArcLength = u * arcLengths[il - 1];
    }

    // 二分查找: 找到 <= targetArcLength 的最大下标
    let low = 0;
    let high = il - 1;
    let i = 0;

    while (low <= high) {
      i = Math.floor(low + (high - low) / 2);
      const comparison = arcLengths[i] - targetArcLength;
      if (comparison < 0) {
        low = i + 1;
      } else if (comparison > 0) {
        high = i - 1;
      } else {
        high = i;
        break;
      }
    }

    i = high;

    if (arcLengths[i] === targetArcLength) {
      return i / (il - 1);
    }

    // 在 [i, i+1] 段内做线性插值
    const lengthBefore = arcLengths[i];
    const lengthAfter = arcLengths[i + 1];
    const segmentLength = lengthAfter - lengthBefore;
    const segmentFraction = (targetArcLength - lengthBefore) / segmentLength;
    return (i + segmentFraction) / (il - 1);
  }

  /**
   * 返回 t 处的单位切线。默认用数值微分(delta=0.0001)近似。
   * 子类可覆写以提供解析切线。
   */
  getTangent(t: number, optionalTarget?: TVector): TVector {
    const delta = 0.0001;
    let t1 = t - delta;
    let t2 = t + delta;
    if (t1 < 0) t1 = 0;
    if (t2 > 1) t2 = 1;

    const pt1 = this.getPoint(t1);
    const pt2 = this.getPoint(t2);

    const tangent = (optionalTarget ?? pt1.clone()) as TVector;
    tangent.copy(pt2 as unknown as TVector).sub(pt1).normalize();
    return tangent;
  }

  /** 按弧长比例 u 取切线。 */
  getTangentAt(u: number, optionalTarget?: TVector): TVector {
    const t = this.getUtoTmapping(u);
    return this.getTangent(t, optionalTarget);
  }

  /**
   * 计算 Frenet 标架 (tangent / normal / binormal),用于 tube/extrude 几何体。
   * 返回三个长度均为 segments+1 的数组。仅适用于 3D 曲线。
   *
   * 算法参考: http://www.cs.indiana.edu/pub/techreports/TR425.pdf
   */
  computeFrenetFrames(segments: number, closed: boolean): FrenetFrames {
    const normal = new Vector3();
    const tangents: Vector3[] = [];
    const normals: Vector3[] = [];
    const binormals: Vector3[] = [];

    const vec = new Vector3();
    const quat = new Quaternion();

    // 1. 逐段切线
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      // computeFrenetFrames 仅用于 3D 曲线,getTangentAt 返回 Vector3
      tangents[i] = this.getTangentAt(u) as unknown as Vector3;
    }

    // 2. 选初始法线: 与首切线垂直,取切线最小分量方向
    normals[0] = new Vector3();
    binormals[0] = new Vector3();
    let min = Number.MAX_VALUE;
    const tx = Math.abs(tangents[0].x);
    const ty = Math.abs(tangents[0].y);
    const tz = Math.abs(tangents[0].z);

    if (tx <= min) {
      min = tx;
      normal.set(1, 0, 0);
    }
    if (ty <= min) {
      min = ty;
      normal.set(0, 1, 0);
    }
    if (tz <= min) {
      normal.set(0, 0, 1);
    }

    // vec = tangent[0] × normal
    vec.copy(tangents[0]).cross(normal).normalize();
    // normals[0] = tangent[0] × vec
    normals[0].copy(tangents[0]).cross(vec);
    // binormals[0] = tangent[0] × normals[0]
    binormals[0].copy(tangents[0]).cross(normals[0]);

    // 3. 逐段传播法线/副法线 (parallel transport)
    for (let i = 1; i <= segments; i++) {
      normals[i] = normals[i - 1].clone();
      binormals[i] = binormals[i - 1].clone();

      // vec = tangents[i-1] × tangents[i]
      vec.copy(tangents[i - 1]).cross(tangents[i]);

      if (vec.length() > Number.EPSILON) {
        vec.normalize();
        const theta = Math.acos(
          clamp(tangents[i - 1].dot(tangents[i]), -1, 1),
        );
        // 绕 vec 旋转 theta
        quat.setFromAxisAngle(vec, theta);
        normals[i].applyQuaternion(quat);
      }

      binormals[i].copy(tangents[i]).cross(normals[i]);
    }

    // 4. 闭合曲线: 修正首末法线一致
    if (closed === true) {
      let theta = Math.acos(
        clamp(normals[0].dot(normals[segments]), -1, 1),
      );
      theta /= segments;

      // vec = normals[0] × normals[segments]
      vec.copy(normals[0]).cross(normals[segments]);
      if (tangents[0].dot(vec) > 0) {
        theta = -theta;
      }

      for (let i = 1; i <= segments; i++) {
        quat.setFromAxisAngle(tangents[i], theta * i);
        normals[i].applyQuaternion(quat);
        binormals[i].copy(tangents[i]).cross(normals[i]);
      }
    }

    return { tangents, normals, binormals };
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  copy(source: this): this {
    this.arcLengthDivisions = source.arcLengthDivisions;
    return this;
  }
}
