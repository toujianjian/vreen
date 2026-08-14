// Box3 — 轴对齐包围盒(AABB),由 min/max 两个 Vector3 定义。
// 参考 three.js Box3,适配 VREEN 自研引擎的 TypeScript strict 模式。
// 空盒约定: min=(+∞,+∞,+∞), max=(-∞,-∞,-∞); isEmpty() 返回 true。

import { Matrix4 } from './Matrix4';
import { Vector3 } from './Vector3';
import type { Sphere } from './Sphere';
import type { Plane } from './Plane';
import type { Triangle } from './Triangle';

// applyMatrix4 复用 8 个角点缓冲区,避免每帧分配
const _points: Vector3[] = [
  new Vector3(), new Vector3(), new Vector3(), new Vector3(),
  new Vector3(), new Vector3(), new Vector3(), new Vector3(),
];
const _vector = new Vector3();

// intersectsTriangle (SAT) 复用缓冲区,避免每次调用分配
const _boxCenter = new Vector3();
const _extents = new Vector3();
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _f0 = new Vector3();
const _f1 = new Vector3();
const _f2 = new Vector3();
const _testAxis = new Vector3();
const _triangleNormal = new Vector3();

/**
 * 对一条候选分离轴执行 SAT 投影测试。
 * 把 AABB 半径与三角形三顶点都投影到 axis 上,若三角形投影区间完全在 ±r 之外,
 * 则该轴为分离轴 → 返回 false(不相交)。
 * 适配 three.js r169 `src/math/Box3.js` 的 `satForAxes`(私有辅助)。
 */
function satForAxes(
  axes: number[],
  v0: Vector3, v1: Vector3, v2: Vector3,
  extents: Vector3,
): boolean {
  for (let i = 0, j = axes.length - 3; i <= j; i += 3) {
    _testAxis.set(axes[i], axes[i + 1], axes[i + 2]);
    // AABB 在该轴上的投影半长 r = Σ |extent_k| * |axis_k|
    const r =
      extents.x * Math.abs(_testAxis.x) +
      extents.y * Math.abs(_testAxis.y) +
      extents.z * Math.abs(_testAxis.z);
    // 三角形三顶点在该轴上的投影
    const p0 = v0.dot(_testAxis);
    const p1 = v1.dot(_testAxis);
    const p2 = v2.dot(_testAxis);
    // 若 max(−max(p), min(p)) > r ⇒ 三角形投影区间完全在 ±r 之外 → 分离
    if (Math.max(-Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r) {
      return false;
    }
  }
  return true;
}

export class Box3 {
  min: Vector3;
  max: Vector3;

  constructor(
    min: Vector3 = new Vector3(+Infinity, +Infinity, +Infinity),
    max: Vector3 = new Vector3(-Infinity, -Infinity, -Infinity),
  ) {
    this.min = min;
    this.max = max;
  }

  set(min: Vector3, max: Vector3): this {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }

  copy(box: Box3): this {
    this.min.copy(box.min);
    this.max.copy(box.max);
    return this;
  }

  clone(): Box3 {
    return new Box3().copy(this);
  }

  /** 置空(min=+∞, max=-∞)。 */
  makeEmpty(): this {
    this.min.x = this.min.y = this.min.z = +Infinity;
    this.max.x = this.max.y = this.max.z = -Infinity;
    return this;
  }

  /** 空盒判定:max 任一分量 < min 对应分量。 */
  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  /** 中心点写入 target。空盒返回 (0,0,0)。 */
  getCenter(target: Vector3): Vector3 {
    return this.isEmpty()
      ? target.set(0, 0, 0)
      : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }

  /** 尺寸(max - min)写入 target。空盒返回 (0,0,0)。 */
  getSize(target: Vector3): Vector3 {
    return this.isEmpty()
      ? target.set(0, 0, 0)
      : target.subVectors(this.max, this.min);
  }

  /** 扩展边界以包含 point。 */
  expandByPoint(point: Vector3): this {
    this.min.min(point);
    this.max.max(point);
    return this;
  }

  /** 双向扩展: min -= vector, max += vector。 */
  expandByVector(vector: Vector3): this {
    this.min.sub(vector);
    this.max.add(vector);
    return this;
  }

  /** 各方向按 scalar 扩展(min -= scalar, max += scalar)。 */
  expandByScalar(scalar: number): this {
    this.min.addScalar(-scalar);
    this.max.addScalar(scalar);
    return this;
  }

  /** 点是否在盒内(含边界)。 */
  containsPoint(point: Vector3): boolean {
    return point.x >= this.min.x && point.x <= this.max.x
      && point.y >= this.min.y && point.y <= this.max.y
      && point.z >= this.min.z && point.z <= this.max.z;
  }

  /** box 是否完全在本盒内(含边界)。 */
  containsBox(box: Box3): boolean {
    return this.min.x <= box.min.x && box.max.x <= this.max.x
      && this.min.y <= box.min.y && box.max.y <= this.max.y
      && this.min.z <= box.min.z && box.max.z <= this.max.z;
  }

  /** 与另一个 AABB 是否相交(6 个分离面测试)。 */
  intersectsBox(box: Box3): boolean {
    return box.max.x >= this.min.x && box.min.x <= this.max.x
      && box.max.y >= this.min.y && box.min.y <= this.max.y
      && box.max.z >= this.min.z && box.min.z <= this.max.z;
  }

  /** 与球是否相交:取 AABB 上离球心最近的点,若该点在球内则相交。 */
  intersectsSphere(sphere: Sphere): boolean {
    this.clampPoint(sphere.center, _vector);
    return _vector.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
  }

  /**
   * 与三角形是否相交(SAT 分离轴测试)。
   *
   * 适配 three.js r169 `src/math/Box3.js` 的 `intersectsTriangle`,把 AABB 平移到
   * 原点用 (center, extents) 表示,对 13 条候选分离轴做投影:9 条 AABB 边 ×
   * 三角形边的叉积轴、3 条 AABB 面法线轴 (世界 X/Y/Z)、1 条三角形面法线轴。
   * 任一轴能把两者在轴上投影区间分开 → 不相交。全部 13 条无分离 → 相交。
   *
   * @param triangle 待测三角形(只读 a/b/c 顶点)。
   * @returns 相交返回 true;空盒或分离返回 false。
   */
  intersectsTriangle(triangle: Triangle): boolean {
    if (this.isEmpty()) return false;

    // 把 AABB 用中心 + 半边长表示
    this.getCenter(_boxCenter);
    _extents.subVectors(this.max, _boxCenter);

    // 三角形顶点平移到以 AABB 中心为原点
    _v0.subVectors(triangle.a, _boxCenter);
    _v1.subVectors(triangle.b, _boxCenter);
    _v2.subVectors(triangle.c, _boxCenter);

    // 三角形三条边向量
    _f0.subVectors(_v1, _v0);
    _f1.subVectors(_v2, _v1);
    _f2.subVectors(_v0, _v2);

    // 9 条候选分离轴:AABB 三条边(=世界 X/Y/Z)与三角形三条边的叉积
    // axis_ij = u_i × f_j (u0,u1,u2 = X,Y,Z 单位向量,因 AABB 轴对齐)
    let axes = [
      0, -_f0.z, _f0.y, 0, -_f1.z, _f1.y, 0, -_f2.z, _f2.y,
      _f0.z, 0, -_f0.x, _f1.z, 0, -_f1.x, _f2.z, 0, -_f2.x,
      -_f0.y, _f0.x, 0, -_f1.y, _f1.x, 0, -_f2.y, _f2.x, 0,
    ];
    if (!satForAxes(axes, _v0, _v1, _v2, _extents)) return false;

    // 3 条 AABB 面法线轴(世界 X/Y/Z)
    axes = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (!satForAxes(axes, _v0, _v1, _v2, _extents)) return false;

    // 三角形面法线轴(cross(f0, f1))
    _triangleNormal.crossVectors(_f0, _f1);
    axes = [_triangleNormal.x, _triangleNormal.y, _triangleNormal.z];
    return satForAxes(axes, _v0, _v1, _v2, _extents);
  }

  /** 与平面是否相交:计算法线点积的 min/max,若跨过 -constant 则相交。 */
  intersectsPlane(plane: Plane): boolean {
    let min: number, max: number;
    if (plane.normal.x > 0) {
      min = plane.normal.x * this.min.x;
      max = plane.normal.x * this.max.x;
    } else {
      min = plane.normal.x * this.max.x;
      max = plane.normal.x * this.min.x;
    }
    if (plane.normal.y > 0) {
      min += plane.normal.y * this.min.y;
      max += plane.normal.y * this.max.y;
    } else {
      min += plane.normal.y * this.max.y;
      max += plane.normal.y * this.min.y;
    }
    if (plane.normal.z > 0) {
      min += plane.normal.z * this.min.z;
      max += plane.normal.z * this.max.z;
    } else {
      min += plane.normal.z * this.max.z;
      max += plane.normal.z * this.min.z;
    }
    return min <= -plane.constant && max >= -plane.constant;
  }

  /** 将 point 限制在盒内,结果写入 target。 */
  clampPoint(point: Vector3, target: Vector3): Vector3 {
    return target.copy(point).clamp(this.min, this.max);
  }

  /** 点到盒边界最近点的距离(点在盒内返回 0)。 */
  distanceToPoint(point: Vector3): number {
    return this.clampPoint(point, _vector).distanceTo(point);
  }

  /** 计算包围本盒的最小球(写入 target)。 */
  getBoundingSphere(target: Sphere): Sphere {
    if (this.isEmpty()) {
      target.makeEmpty();
    } else {
      this.getCenter(target.center);
      target.radius = this.getSize(_vector).length() * 0.5;
    }
    return target;
  }

  /** 同 getBoundingSphere 的语义化别名。 */
  computeBoundingSphere(target: Sphere): Sphere {
    return this.getBoundingSphere(target);
  }

  /** 与 box 求交,结果存入 this。无重叠时置空。 */
  intersect(box: Box3): this {
    this.min.max(box.min);
    this.max.min(box.max);
    if (this.isEmpty()) this.makeEmpty();
    return this;
  }

  /** 与 box 求并,结果存入 this。 */
  union(box: Box3): this {
    this.min.min(box.min);
    this.max.max(box.max);
    return this;
  }

  /** 用 4x4 矩阵变换包围盒(变换 8 个角点后重新包围)。
   *  空盒变换仍为空盒。 */
  applyMatrix4(matrix: Matrix4): this {
    if (this.isEmpty()) return this;
    // 8 个角点分别变换后重新包围
    _points[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(matrix); // 000
    _points[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(matrix); // 001
    _points[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(matrix); // 010
    _points[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(matrix); // 011
    _points[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(matrix); // 100
    _points[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(matrix); // 101
    _points[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(matrix); // 110
    _points[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(matrix); // 111
    this.makeEmpty();
    for (let i = 0; i < 8; i++) this.expandByPoint(_points[i]);
    return this;
  }

  /** 整体平移(min 和 max 都加 offset)。 */
  translate(offset: Vector3): this {
    this.min.add(offset);
    this.max.add(offset);
    return this;
  }
}
