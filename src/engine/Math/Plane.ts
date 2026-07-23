// Plane — Hessian 形式平面: normal·point + constant = 0。
// 参考 three.js Plane,适配 VREEN 自研引擎的 TypeScript strict 模式。
// normal 通常应为单位长度(可调用 normalize() 保证);constant 为原点到平面的有符号距离。
// 与 Frustum.ts 共享:Frustum 内部的 6 个裁剪平面使用本 class 实例。

import { Matrix4 } from './Matrix4';
import { Vector3 } from './Vector3';
import type { Sphere } from './Sphere';
import type { Box3 } from './Box3';
import type { Line3 } from './Line3';

const _vector1 = new Vector3();
const _vector2 = new Vector3();

// VREEN 没有 Matrix3 类,用结构类型 `{ elements }` 持有 3x3 法线矩阵。
// Plane.applyMatrix4 复用这个缓冲区以避免每帧分配。
const _normalMatrixElements = new Float32Array(9);
const _normalMatrixLike = { elements: _normalMatrixElements };

export class Plane {
  normal: Vector3;
  constant: number;

  constructor(normal: Vector3 = new Vector3(1, 0, 0), constant: number = 0) {
    this.normal = normal;
    this.constant = constant;
  }

  /** 设置法线和常量。 */
  set(normal: Vector3, constant: number): this {
    this.normal.copy(normal);
    this.constant = constant;
    return this;
  }

  /** 用 (x,y,z) 作法线、w 作常量。 */
  setComponents(x: number, y: number, z: number, w: number): this {
    this.normal.set(x, y, z);
    this.constant = w;
    return this;
  }

  /** 由法线和平面上的点构造平面。 */
  setFromNormalAndCoplanarPoint(normal: Vector3, point: Vector3): this {
    this.normal.copy(normal);
    this.constant = -point.dot(this.normal);
    return this;
  }

  /** 由三个共面点构造平面,法线方向由 (c-b)×(a-b) 决定。 */
  setFromCoplanarPoints(a: Vector3, b: Vector3, c: Vector3): this {
    const normal = _vector1.subVectors(c, b).cross(_vector2.subVectors(a, b)).normalize();
    this.setFromNormalAndCoplanarPoint(normal, a);
    return this;
  }

  copy(plane: Plane): this {
    this.normal.copy(plane.normal);
    this.constant = plane.constant;
    return this;
  }

  clone(): Plane {
    return new Plane().copy(this);
  }

  /** 归一化法线(同时等比缩放 constant)。 */
  normalize(): this {
    const inverseNormalLength = 1 / this.normal.length();
    this.normal.multiplyScalar(inverseNormalLength);
    this.constant *= inverseNormalLength;
    return this;
  }

  /** 法线与常量同时取反。 */
  negate(): this {
    this.constant *= -1;
    this.normal.negate();
    return this;
  }

  /** 点到平面的有符号距离。 */
  distanceToPoint(point: Vector3): number {
    return this.normal.dot(point) + this.constant;
  }

  /** 球心到平面的有符号距离(已减去半径)。 */
  distanceToSphere(sphere: Sphere): number {
    return this.distanceToPoint(sphere.center) - sphere.radius;
  }

  /** 把点投影到平面上,写入 target。 */
  projectPoint(point: Vector3, target: Vector3): Vector3 {
    return target.copy(point).addScaledVector(this.normal, -this.distanceToPoint(point));
  }

  /** 原点在平面上的正交投影向量(与 coplanarPoint 等价)。 */
  orthoPoint(target: Vector3): Vector3 {
    return target.copy(this.normal).multiplyScalar(-this.constant);
  }

  /** 与线段求交。clampToLine=true 时仅在线段 [0,1] 参数区间内有效。
   *  线段共面时返回起点;不相交返回 null。 */
  intersectLine(line: Line3, target: Vector3, clampToLine: boolean = true): Vector3 | null {
    const direction = line.delta(_vector1);
    const denominator = this.normal.dot(direction);
    if (denominator === 0) {
      // 线段与法线垂直:若起点在平面上则共面,返回起点;否则平行不相交
      if (this.distanceToPoint(line.start) === 0) {
        return target.copy(line.start);
      }
      return null;
    }
    const t = -(line.start.dot(this.normal) + this.constant) / denominator;
    if (clampToLine && (t < 0 || t > 1)) {
      return null;
    }
    return target.copy(line.start).addScaledVector(direction, t);
  }

  /** 线段两端点是否在平面异侧(穿越平面)。 */
  intersectsLine(line: Line3): boolean {
    const startSign = this.distanceToPoint(line.start);
    const endSign = this.distanceToPoint(line.end);
    return (startSign < 0 && endSign > 0) || (endSign < 0 && startSign > 0);
  }

  /** 与 AABB 求交(委托给 Box3.intersectsPlane)。 */
  intersectsBox(box: Box3): boolean {
    return box.intersectsPlane(this);
  }

  /** 与球求交(委托给 Sphere.intersectsPlane)。 */
  intersectsSphere(sphere: Sphere): boolean {
    return sphere.intersectsPlane(this);
  }

  /** 返回平面上离原点最近的点(= -normal * constant)。 */
  coplanarPoint(target: Vector3): Vector3 {
    return target.copy(this.normal).multiplyScalar(-this.constant);
  }

  /** 返回平面内一条参考线段:start 为 coplanarPoint,
   *  end 沿与 normal 正交的任意单位方向。用于平面可视化等场景。 */
  coplanarLine(target: Line3): Line3 {
    this.coplanarPoint(target.start);
    const n = this.normal;
    // 选择与 normal 不平行的坐标轴,做 Gram-Schmidt 正交化
    if (Math.abs(n.x) < 0.9) {
      _vector1.set(1, 0, 0);
    } else {
      _vector1.set(0, 1, 0);
    }
    _vector2.copy(n).multiplyScalar(_vector1.dot(n));
    target.end.copy(_vector1).sub(_vector2).normalize().add(target.start);
    return target;
  }

  /** 用 4x4 仿射矩阵变换平面。optionalNormalMatrix 可预计算以提速。
   *  VREEN 的 Matrix4.getNormalMatrix 写入 9 元素 Float32Array。 */
  applyMatrix4(matrix: Matrix4, optionalNormalMatrix?: { elements: Float32Array | number[] }): this {
    const normalMatrix = optionalNormalMatrix ?? _normalMatrixLike;
    if (!optionalNormalMatrix) {
      matrix.getNormalMatrix(_normalMatrixElements);
    }
    const referencePoint = this.coplanarPoint(_vector1).applyMatrix4(matrix);
    const normal = this.normal.applyMatrix3(normalMatrix).normalize();
    this.constant = -referencePoint.dot(normal);
    return this;
  }

  /** 沿 offset 平移平面(只改 constant,不改法线)。 */
  translate(offset: Vector3): this {
    this.constant -= offset.dot(this.normal);
    return this;
  }
}
