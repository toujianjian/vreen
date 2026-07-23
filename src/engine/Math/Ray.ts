// Ray — 射线,由起点 origin 和(归一化的)方向 direction 定义。
// 参考 three.js Ray,适配 VREEN 自研引擎的 TypeScript strict 模式。
// 用于鼠标拾取、视线碰撞检测等。

import { Vector3 } from './Vector3';
import { Matrix4 } from './Matrix4';
import type { Sphere } from './Sphere';
import type { Plane } from './Plane';
import type { Box3 } from './Box3';

const _vector = new Vector3();

export class Ray {
  origin: Vector3;
  direction: Vector3;

  constructor(
    origin: Vector3 = new Vector3(),
    direction: Vector3 = new Vector3(0, 0, -1),
  ) {
    this.origin = origin;
    this.direction = direction;
  }

  set(origin: Vector3, direction: Vector3): this {
    this.origin.copy(origin);
    this.direction.copy(direction);
    return this;
  }

  copy(ray: Ray): this {
    this.origin.copy(ray.origin);
    this.direction.copy(ray.direction);
    return this;
  }

  clone(): Ray {
    return new Ray().copy(this);
  }

  /** 返回参数 t 处的点(origin + direction * t),写入 target。 */
  at(t: number, target: Vector3): Vector3 {
    return target.copy(this.origin).addScaledVector(this.direction, t);
  }

  /** 调整方向使其指向 v(从 origin 出发)。 */
  lookAt(v: Vector3): this {
    this.direction.copy(v).sub(this.origin).normalize();
    return this;
  }

  /** 沿射线方向把 origin 移动距离 t。 */
  recast(t: number): this {
    this.origin.copy(this.at(t, _vector));
    return this;
  }

  /** 射线上离 point 最近的点,写入 target。 */
  closestPointToPoint(point: Vector3, target: Vector3): Vector3 {
    target.subVectors(point, this.origin);
    const directionDistance = target.dot(this.direction);
    if (directionDistance < 0) {
      // point 在 origin 后方
      return target.copy(this.origin);
    }
    return target.copy(this.origin).addScaledVector(this.direction, directionDistance);
  }

  /** 射线上离 point 的距离(欧氏)。 */
  distanceToPoint(point: Vector3): number {
    return Math.sqrt(this.distanceSqToPoint(point));
  }

  /** 射线上离 point 的距离平方。 */
  distanceSqToPoint(point: Vector3): number {
    const directionDistance = _vector.subVectors(point, this.origin).dot(this.direction);
    if (directionDistance < 0) {
      // point 在 origin 后方
      return this.origin.distanceToSquared(point);
    }
    _vector.copy(this.origin).addScaledVector(this.direction, directionDistance);
    return _vector.distanceToSquared(point);
  }

  /** 射线与球是否相交。 */
  intersectsSphere(sphere: Sphere): boolean {
    if (sphere.radius < 0) return false; // 空球
    return this.distanceSqToPoint(sphere.center) <= sphere.radius * sphere.radius;
  }

  /** 射线与球求交点,写入 target。不相交返回 null。
   *  射线在球内时返回离 origin 最近的正向出口。 */
  intersectSphere(sphere: Sphere, target: Vector3): Vector3 | null {
    if (sphere.radius < 0) return null; // 空球
    _vector.subVectors(sphere.center, this.origin);
    const tca = _vector.dot(this.direction);
    const d2 = _vector.dot(_vector) - tca * tca;
    const radius2 = sphere.radius * sphere.radius;
    if (d2 > radius2) return null;
    const thc = Math.sqrt(radius2 - d2);
    const t0 = tca - thc; // 前入射点
    const t1 = tca + thc; // 后出射点
    if (t1 < 0) return null; // 整个球在射线后方
    if (t0 < 0) return this.at(t1, target); // origin 在球内,返回出口
    return this.at(t0, target); // 返回入射点
  }

  /** 射线与平面是否相交(或共面)。 */
  intersectsPlane(plane: Plane): boolean {
    const distToPoint = plane.distanceToPoint(this.origin);
    if (distToPoint === 0) return true; // origin 在平面上
    const denominator = plane.normal.dot(this.direction);
    return denominator * distToPoint < 0;
  }

  /** 射线到平面的距离(沿方向参数 t)。不相交返回 null。
   *  共面且 origin 在平面上时返回 0。 */
  private _distanceToPlane(plane: Plane): number | null {
    const denominator = plane.normal.dot(this.direction);
    if (denominator === 0) {
      // 射线方向与法线垂直:共面则返回 0,否则平行不相交
      if (plane.distanceToPoint(this.origin) === 0) return 0;
      return null;
    }
    const t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;
    return t >= 0 ? t : null;
  }

  /** 射线与平面求交点,写入 target。不相交返回 null。 */
  intersectPlane(plane: Plane, target: Vector3): Vector3 | null {
    const t = this._distanceToPlane(plane);
    if (t === null) return null;
    return this.at(t, target);
  }

  /** 射线与 AABB 是否相交。 */
  intersectsBox(box: Box3): boolean {
    return this.intersectBox(box, _vector) !== null;
  }

  /** 射线与 AABB 求交点(斯拉布斯法),写入 target。不相交返回 null。
   *  返回离 origin 最近的正向交点。 */
  intersectBox(box: Box3, target: Vector3): Vector3 | null {
    let tmin: number, tmax: number, tymin: number, tymax: number, tzmin: number, tzmax: number;

    const invdirx = 1 / this.direction.x;
    const invdiry = 1 / this.direction.y;
    const invdirz = 1 / this.direction.z;
    const origin = this.origin;

    if (invdirx >= 0) {
      tmin = (box.min.x - origin.x) * invdirx;
      tmax = (box.max.x - origin.x) * invdirx;
    } else {
      tmin = (box.max.x - origin.x) * invdirx;
      tmax = (box.min.x - origin.x) * invdirx;
    }

    if (invdiry >= 0) {
      tymin = (box.min.y - origin.y) * invdiry;
      tymax = (box.max.y - origin.y) * invdiry;
    } else {
      tymin = (box.max.y - origin.y) * invdiry;
      tymax = (box.min.y - origin.y) * invdiry;
    }

    if (tmin > tymax || tymin > tmax) return null;
    if (tymin > tmin || Number.isNaN(tmin)) tmin = tymin;
    if (tymax < tmax || Number.isNaN(tmax)) tmax = tymax;

    if (invdirz >= 0) {
      tzmin = (box.min.z - origin.z) * invdirz;
      tzmax = (box.max.z - origin.z) * invdirz;
    } else {
      tzmin = (box.max.z - origin.z) * invdirz;
      tzmax = (box.min.z - origin.z) * invdirz;
    }

    if (tmin > tzmax || tzmin > tmax) return null;
    if (tzmin > tmin || tmin !== tmin) tmin = tzmin; // tmin !== tmin 检测 NaN
    if (tzmax < tmax || tmax !== tmax) tmax = tzmax;

    if (tmax < 0) return null; // 整个盒在射线后方

    return this.at(tmin >= 0 ? tmin : tmax, target);
  }

  /** 射线与三角形是否相交。 */
  intersectsTriangle(a: Vector3, b: Vector3, c: Vector3, backfaceCulling: boolean): boolean {
    return this.intersectTriangle(a, b, c, backfaceCulling, _vector) !== null;
  }

  /** 射线与三角形求交点,写入 target。不相交返回 null。
   *  使用 Watertight 算法(Woop, Benthin, Wald, JCGT 2013),
   *  选取射线方向绝对值最大的轴作为投影轴以保证共享边的相邻三角形
   *  求交结果一致(无漏检)。 */
  intersectTriangle(
    a: Vector3,
    b: Vector3,
    c: Vector3,
    backfaceCulling: boolean,
    target: Vector3,
  ): Vector3 | null {
    const origin = this.origin;
    const direction = this.direction;

    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;

    // 三角形顶点相对射线 origin 的坐标
    const aox = a.x - origin.x, aoy = a.y - origin.y, aoz = a.z - origin.z;
    const box = b.x - origin.x, boy = b.y - origin.y, boz = b.z - origin.z;
    const cox = c.x - origin.x, coy = c.y - origin.y, coz = c.z - origin.z;

    // 选取 |direction| 最大的轴作为 kz,并把分量按 (kx, ky, kz) 顺序排列。
    // 当 kz 分量为负时交换 kx/ky 以保持三角形绕序。
    const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);

    let dkx: number, dky: number, dkz: number;
    let akx: number, aky: number, akz: number;
    let bkx: number, bky: number, bkz: number;
    let ckx: number, cky: number, ckz: number;

    if (adx >= ady && adx >= adz) {
      dkz = dx; akz = aox; bkz = box; ckz = cox;
      if (dx >= 0) {
        dkx = dy; dky = dz;
        akx = aoy; aky = aoz; bkx = boy; bky = boz; ckx = coy; cky = coz;
      } else {
        dkx = dz; dky = dy;
        akx = aoz; aky = aoy; bkx = boz; bky = boy; ckx = coz; cky = coy;
      }
    } else if (ady >= adz) {
      dkz = dy; akz = aoy; bkz = boy; ckz = coy;
      if (dy >= 0) {
        dkx = dz; dky = dx;
        akx = aoz; aky = aox; bkx = boz; bky = box; ckx = coz; cky = cox;
      } else {
        dkx = dx; dky = dz;
        akx = aox; aky = aoz; bkx = box; bky = boz; ckx = cox; cky = coz;
      }
    } else {
      dkz = dz; akz = aoz; bkz = boz; ckz = coz;
      if (dz >= 0) {
        dkx = dx; dky = dy;
        akx = aox; aky = aoy; bkx = box; bky = boy; ckx = cox; cky = coy;
      } else {
        dkx = dy; dky = dx;
        akx = aoy; aky = aox; bkx = boy; bky = box; ckx = coy; cky = cox;
      }
    }

    // 零方向无最大轴,不可能相交
    if (dkz === 0) return null;

    // 剪切常数:把射线对齐到 +kz 轴
    const sx = dkx / dkz, sy = dky / dkz, sz = 1 / dkz;

    // 剪切并缩放后的顶点坐标
    const ax = akx - sx * akz, ay = aky - sy * akz;
    const bx = bkx - sx * bkz, by = bky - sy * bkz;
    const cx = ckx - sx * ckz, cy = cky - sy * ckz;

    // 缩放后的重心坐标(带符号的边函数);剪切使共享边的相邻三角形
    // 求交结果完全一致,射线不会落在两三角形之间
    const u = cx * by - cy * bx;
    const v = ax * cy - ay * cx;
    const w = bx * ay - by * ax;

    if (backfaceCulling) {
      if (u < 0 || v < 0 || w < 0) return null;
    } else {
      if ((u < 0 || v < 0 || w < 0) && (u > 0 || v > 0 || w > 0)) return null;
    }

    const det = u + v + w;
    // 射线与三角形共面
    if (det === 0) return null;

    // 缩放后的命中距离;t = tScaled / det 必须在 origin 前方
    const tScaled = sz * (u * akz + v * bkz + w * ckz);
    if (det > 0 ? tScaled < 0 : tScaled > 0) return null;

    return this.at(tScaled / det, target);
  }

  /** 用 4x4 矩阵变换射线:origin 做点变换,direction 做方向变换。 */
  applyMatrix4(matrix4: Matrix4): this {
    this.origin.applyMatrix4(matrix4);
    this.direction.transformDirection(matrix4);
    return this;
  }
}
