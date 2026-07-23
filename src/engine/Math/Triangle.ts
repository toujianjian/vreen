// Triangle — 三角形,由三个顶点 a/b/c 定义。
// 参考 three.js Triangle,适配 VREEN 自研引擎的 TypeScript strict 模式。
// 静态方法 getNormal/getBarycoord/containsPoint 可独立使用;实例方法委托给静态方法。

import { Vector3 } from './Vector3';
import type { Plane } from './Plane';

// 模块级复用的临时向量,避免方法调用时频繁分配
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _vab = new Vector3();
const _vac = new Vector3();
const _vbc = new Vector3();
const _vap = new Vector3();
const _vbp = new Vector3();
const _vcp = new Vector3();

export class Triangle {
  a: Vector3;
  b: Vector3;
  c: Vector3;

  constructor(
    a: Vector3 = new Vector3(),
    b: Vector3 = new Vector3(),
    c: Vector3 = new Vector3(),
  ) {
    this.a = a;
    this.b = b;
    this.c = c;
  }

  set(a: Vector3, b: Vector3, c: Vector3): this {
    this.a.copy(a);
    this.b.copy(b);
    this.c.copy(c);
    return this;
  }

  copy(triangle: Triangle): this {
    this.a.copy(triangle.a);
    this.b.copy(triangle.b);
    this.c.copy(triangle.c);
    return this;
  }

  clone(): Triangle {
    return new Triangle().copy(this);
  }

  /** 三角形面积(= |(c-b)×(a-b)| / 2)。 */
  getArea(): number {
    _v0.subVectors(this.c, this.b);
    _v1.subVectors(this.a, this.b);
    return _v0.cross(_v1).length() * 0.5;
  }

  /** 重心写入 target(= (a+b+c)/3)。 */
  getMidpoint(target: Vector3): Vector3 {
    return target.addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3);
  }

  /** 法线写入 target(归一化)。 */
  getNormal(target: Vector3): Vector3 {
    return Triangle.getNormal(this.a, this.b, this.c, target);
  }

  /** 三角形所在平面写入 target。 */
  getPlane(target: Plane): Plane {
    return target.setFromCoplanarPoints(this.a, this.b, this.c);
  }

  /** 计算 point 在三角形上的重心坐标,写入 target。
   *  退化三角形返回 null(此时 target 被置 0)。 */
  getBarycoord(point: Vector3, target: Vector3): Vector3 | null {
    return Triangle.getBarycoord(point, this.a, this.b, this.c, target);
  }

  /** point 投影到三角形平面后是否落在三角形内。 */
  containsPoint(point: Vector3): boolean {
    return Triangle.containsPoint(point, this.a, this.b, this.c);
  }

  /** 点到三角形最近点,写入 target。
   *  算法来自 Christer Ericson《Real-Time Collision Detection》5.1.5,
   *  区分点在三角形的哪个 Voronoi 区域。 */
  closestPointToPoint(p: Vector3, target: Vector3): Vector3 {
    const a = this.a, b = this.b, c = this.c;
    let v: number, w: number;

    _vab.subVectors(b, a);
    _vac.subVectors(c, a);
    _vap.subVectors(p, a);
    const d1 = _vab.dot(_vap);
    const d2 = _vac.dot(_vap);
    if (d1 <= 0 && d2 <= 0) {
      // 顶点 A 的 Voronoi 区域
      return target.copy(a);
    }

    _vbp.subVectors(p, b);
    const d3 = _vab.dot(_vbp);
    const d4 = _vac.dot(_vbp);
    if (d3 >= 0 && d4 <= d3) {
      // 顶点 B 的 Voronoi 区域
      return target.copy(b);
    }

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      v = d1 / (d1 - d3);
      // AB 边区域
      return target.copy(a).addScaledVector(_vab, v);
    }

    _vcp.subVectors(p, c);
    const d5 = _vab.dot(_vcp);
    const d6 = _vac.dot(_vcp);
    if (d6 >= 0 && d5 <= d6) {
      // 顶点 C 的 Voronoi 区域
      return target.copy(c);
    }

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      w = d2 / (d2 - d6);
      // AC 边区域
      return target.copy(a).addScaledVector(_vac, w);
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      _vbc.subVectors(c, b);
      w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      // BC 边区域
      return target.copy(b).addScaledVector(_vbc, w);
    }

    // 面内区域:用重心坐标插值
    const denom = 1 / (va + vb + vc);
    v = vb * denom;
    w = vc * denom;
    return target.copy(a).addScaledVector(_vab, v).addScaledVector(_vac, w);
  }

  /** 值相等比较。 */
  equals(triangle: Triangle): boolean {
    return triangle.a.equals(this.a) && triangle.b.equals(this.b) && triangle.c.equals(this.c);
  }

  /** 计算三角形法线,写入 target(归一化)。退化三角形返回 (0,0,0)。 */
  static getNormal(a: Vector3, b: Vector3, c: Vector3, target: Vector3): Vector3 {
    target.subVectors(c, b);
    _v0.subVectors(a, b);
    target.cross(_v0);
    const targetLengthSq = target.lengthSq();
    if (targetLengthSq > 0) {
      return target.multiplyScalar(1 / Math.sqrt(targetLengthSq));
    }
    return target.set(0, 0, 0);
  }

  /** 计算 point 在三角形 (a,b,c) 上的重心坐标,写入 target。
   *  退化三角形返回 null(此时 target 被置 0)。
   *  基于 http://www.blackpawn.com/texts/pointinpoly/ 的方法。 */
  static getBarycoord(
    point: Vector3,
    a: Vector3,
    b: Vector3,
    c: Vector3,
    target: Vector3,
  ): Vector3 | null {
    _v0.subVectors(c, a);
    _v1.subVectors(b, a);
    _v2.subVectors(point, a);

    const dot00 = _v0.dot(_v0);
    const dot01 = _v0.dot(_v1);
    const dot02 = _v0.dot(_v2);
    const dot11 = _v1.dot(_v1);
    const dot12 = _v1.dot(_v2);

    const denom = dot00 * dot11 - dot01 * dot01;
    if (denom === 0) {
      // 共线或退化三角形
      target.set(0, 0, 0);
      return null;
    }
    const invDenom = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    // 重心坐标之和恒为 1
    return target.set(1 - u - v, v, u);
  }

  /** point 投影到三角形平面后是否落在三角形内。退化三角形返回 false。 */
  static containsPoint(point: Vector3, a: Vector3, b: Vector3, c: Vector3): boolean {
    if (Triangle.getBarycoord(point, a, b, c, _v3) === null) {
      return false;
    }
    return _v3.x >= 0 && _v3.y >= 0 && _v3.x + _v3.y <= 1;
  }
}
