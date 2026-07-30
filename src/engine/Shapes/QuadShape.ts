// QuadShape — 平面矩形 (center + halfWidth + halfHeight + normal)。
// 参考 o3de QuadShapeComponent。normal 默认 up;u/v 为面内正交基
// (由 normal 派生),containsPoint 要求点在平面内且 |projU|≤halfWidth、|projV|≤halfHeight。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class QuadShape extends Shape {
  readonly type = 'quad';
  center: Vector3;
  halfWidth: number;
  halfHeight: number;
  normal: Vector3;

  constructor(
    center: Vector3 = new Vector3(),
    halfWidth: number = 0.5,
    halfHeight: number = 0.5,
    normal: Vector3 = new Vector3(0, 1, 0),
  ) {
    super();
    this.center = center;
    this.halfWidth = halfWidth;
    this.halfHeight = halfHeight;
    this.normal = normal;
  }

  /** 由 normal 派生面内正交基 {n, u, v}。 */
  private basis(): { u: Vector3; v: Vector3 } {
    const n = this.normal.lengthSq() > 0 ? this.normal.clone().normalize() : new Vector3(0, 1, 0);
    const ref = Math.abs(n.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const u = new Vector3().copy(n).cross(ref).normalize();
    const v = new Vector3().copy(n).cross(u).normalize();
    return { u, v };
  }

  getAabb(): Box3 {
    const { u, v } = this.basis();
    const hw = this.halfWidth;
    const hh = this.halfHeight;
    const ex = hw * Math.abs(u.x) + hh * Math.abs(v.x);
    const ey = hw * Math.abs(u.y) + hh * Math.abs(v.y);
    const ez = hw * Math.abs(u.z) + hh * Math.abs(v.z);
    const c = this.center;
    return new Box3(
      new Vector3(c.x - ex, c.y - ey, c.z - ez),
      new Vector3(c.x + ex, c.y + ey, c.z + ez),
    );
  }

  intersectRay(ray: Ray): number | null {
    const n = this.normal.lengthSq() > 0 ? this.normal.clone().normalize() : new Vector3(0, 1, 0);
    const denom = n.dot(ray.direction);
    if (Math.abs(denom) < 1e-12) return null;
    const t = (n.dot(this.center) - n.dot(ray.origin)) / denom;
    if (t < 0) return null;
    const hx = ray.origin.x + ray.direction.x * t;
    const hy = ray.origin.y + ray.direction.y * t;
    const hz = ray.origin.z + ray.direction.z * t;
    return this.containsPoint(new Vector3(hx, hy, hz)) ? t : null;
  }

  containsPoint(p: Vector3): boolean {
    const { u, v } = this.basis();
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const dz = p.z - this.center.z;
    const n = new Vector3().copy(u).cross(v); // u×v = ±n (已归一化)
    if (Math.abs(n.x * dx + n.y * dy + n.z * dz) > 1e-9) return false;
    const pu = u.x * dx + u.y * dy + u.z * dz;
    const pv = v.x * dx + v.y * dy + v.z * dz;
    return Math.abs(pu) <= this.halfWidth && Math.abs(pv) <= this.halfHeight;
  }

  distanceToPoint(p: Vector3): number {
    const { u, v } = this.basis();
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const dz = p.z - this.center.z;
    let pu = u.x * dx + u.y * dy + u.z * dz;
    let pv = v.x * dx + v.y * dy + v.z * dz;
    if (pu > this.halfWidth) pu = this.halfWidth;
    else if (pu < -this.halfWidth) pu = -this.halfWidth;
    if (pv > this.halfHeight) pv = this.halfHeight;
    else if (pv < -this.halfHeight) pv = -this.halfHeight;
    // 矩形上离 p 最近点
    const closestX = this.center.x + u.x * pu + v.x * pv;
    const closestY = this.center.y + u.y * pu + v.y * pv;
    const closestZ = this.center.z + u.z * pu + v.z * pv;
    const dpx = p.x - closestX;
    const dpy = p.y - closestY;
    const dpz = p.z - closestZ;
    return Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz);
  }

  clone(): QuadShape {
    return new QuadShape(this.center.clone(), this.halfWidth, this.halfHeight, this.normal.clone());
  }
}
