// Sphere — 包围球,由中心点 center 和半径 radius 定义。
// 参考 three.js Sphere,适配 VREEN 自研引擎的 TypeScript strict 模式。
// 空球约定: radius = -1; isEmpty() 返回 true。

import { Matrix4 } from './Matrix4';
import { Vector3 } from './Vector3';
import type { Box3 } from './Box3';
import type { Plane } from './Plane';

const _v1 = new Vector3();
const _v2 = new Vector3();

export class Sphere {
  center: Vector3;
  radius: number;

  constructor(center: Vector3 = new Vector3(), radius: number = -1) {
    this.center = center;
    this.radius = radius;
  }

  set(center: Vector3, radius: number): this {
    this.center.copy(center);
    this.radius = radius;
    return this;
  }

  copy(sphere: Sphere): this {
    this.center.copy(sphere.center);
    this.radius = sphere.radius;
    return this;
  }

  clone(): Sphere {
    return new Sphere().copy(this);
  }

  /** 置空(center=0, radius=-1)。 */
  makeEmpty(): this {
    this.center.set(0, 0, 0);
    this.radius = -1;
    return this;
  }

  /** 空球判定:radius < 0。 */
  isEmpty(): boolean {
    return this.radius < 0;
  }

  /** 计算包围本球的 AABB(写入 target)。空球返回空盒。 */
  getBoundingBox(target: Box3): Box3 {
    if (this.isEmpty()) {
      target.makeEmpty();
      return target;
    }
    target.set(this.center, this.center);
    target.expandByScalar(this.radius);
    return target;
  }

  /** 用 4x4 矩阵变换球:center 做点变换,radius 乘以矩阵 3x3 部分的最大缩放。 */
  applyMatrix4(matrix: Matrix4): this {
    this.center.applyMatrix4(matrix);
    // 取列长度最大值作为最大轴缩放(等价于 three.js Matrix4.getMaxScaleOnAxis)
    const e = matrix.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    this.radius *= Math.max(sx, sy, sz);
    return this;
  }

  /** 整体平移(center += offset)。 */
  translate(offset: Vector3): this {
    this.center.add(offset);
    return this;
  }

  /** 扩展球以包含 point(计算最小包围球)。 */
  expandByPoint(point: Vector3): this {
    if (this.isEmpty()) {
      this.center.copy(point);
      this.radius = 0;
      return this;
    }
    _v1.subVectors(point, this.center);
    const lengthSq = _v1.lengthSq();
    if (lengthSq > this.radius * this.radius) {
      const length = Math.sqrt(lengthSq);
      const delta = (length - this.radius) * 0.5;
      this.center.addScaledVector(_v1, delta / length);
      this.radius += delta;
    }
    return this;
  }

  /** 扩展球以包含另一个球(计算最小包围球)。 */
  union(sphere: Sphere): this {
    if (sphere.isEmpty()) return this;
    if (this.isEmpty()) {
      this.copy(sphere);
      return this;
    }
    if (this.center.equals(sphere.center)) {
      this.radius = Math.max(this.radius, sphere.radius);
    } else {
      _v2.subVectors(sphere.center, this.center).setLength(sphere.radius);
      this.expandByPoint(_v1.copy(sphere.center).add(_v2));
      this.expandByPoint(_v1.copy(sphere.center).sub(_v2));
    }
    return this;
  }

  /** 与另一个球是否相交(中心距 <= 半径和)。 */
  intersectsSphere(sphere: Sphere): boolean {
    const radiusSum = this.radius + sphere.radius;
    return sphere.center.distanceToSquared(this.center) <= radiusSum * radiusSum;
  }

  /** 与 AABB 是否相交(委托给 Box3.intersectsSphere)。 */
  intersectsBox(box: Box3): boolean {
    return box.intersectsSphere(this);
  }

  /** 与平面是否相交:球心到平面有符号距离的绝对值 <= radius。 */
  intersectsPlane(plane: Plane): boolean {
    return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
  }

  /** 将 point 限制在球面上(球内点不动),结果写入 target。 */
  clampPoint(point: Vector3, target: Vector3): Vector3 {
    const deltaLengthSq = this.center.distanceToSquared(point);
    target.copy(point);
    if (deltaLengthSq > this.radius * this.radius) {
      target.sub(this.center).normalize();
      target.multiplyScalar(this.radius).add(this.center);
    }
    return target;
  }

  /** 点到球面的最近距离(点在球内返回负值)。 */
  distanceToPoint(point: Vector3): number {
    return point.distanceTo(this.center) - this.radius;
  }
}
