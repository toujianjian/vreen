// CatmullRomCurve3 — 3D Catmull-Rom 样条曲线 (N 控制点,可选闭合)。
// Adapted from three.js src/extras/curves/CatmullRomCurve3.js (MIT)。
// 支持 centripetal / chordal / catmullrom 三种参数化。
// 参考: http://www.cemyuksel.com/research/catmullrom_param/catmullrom.pdf

import { Curve } from './Curve';
import { Vector3 } from '../Math/Vector3';

export type CatmullRomCurveType = 'centripetal' | 'chordal' | 'catmullrom';

/**
 * 三次多项式 p(s) = c0 + c1·s + c2·s² + c3·s³
 * 满足 p(0)=x0, p(1)=x1, p'(0)=t0, p'(1)=t1。
 */
class CubicPoly {
  private c0 = 0;
  private c1 = 0;
  private c2 = 0;
  private c3 = 0;

  init(x0: number, x1: number, t0: number, t1: number): void {
    this.c0 = x0;
    this.c1 = t0;
    this.c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
    this.c3 = 2 * x0 - 2 * x1 + t0 + t1;
  }

  initCatmullRom(x0: number, x1: number, x2: number, x3: number, tension: number): void {
    this.init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
  }

  initNonuniformCatmullRom(
    x0: number, x1: number, x2: number, x3: number,
    dt0: number, dt1: number, dt2: number,
  ): void {
    // 计算 [t1, t2] 参数化下的切线
    let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
    let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
    // 重缩放至 [0,1] 参数化
    t1 *= dt1;
    t2 *= dt1;
    this.init(x1, x2, t1, t2);
  }

  calc(t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return this.c0 + this.c1 * t + this.c2 * t2 + this.c3 * t3;
  }
}

// 模块级复用临时变量,避免每次 getPoint 分配
const tmp = /* @__PURE__ */ new Vector3();
const px = /* @__PURE__ */ new CubicPoly();
const py = /* @__PURE__ */ new CubicPoly();
const pz = /* @__PURE__ */ new CubicPoly();

export class CatmullRomCurve3 extends Curve<Vector3> {
  isCatmullRomCurve3 = true;
  type = 'CatmullRomCurve3';

  points: Vector3[];
  closed: boolean;
  curveType: CatmullRomCurveType;
  tension: number;

  constructor(
    points: Vector3[] = [],
    closed = false,
    curveType: CatmullRomCurveType = 'centripetal',
    tension = 0.5,
  ) {
    super();
    this.points = points;
    this.closed = closed;
    this.curveType = curveType;
    this.tension = tension;
  }

  getPoint(t: number, optionalTarget: Vector3 = new Vector3()): Vector3 {
    const point = optionalTarget;
    const points = this.points;
    const l = points.length;

    const p = (l - (this.closed ? 0 : 1)) * t;
    let intPoint = Math.floor(p);
    let weight = p - intPoint;

    if (this.closed) {
      intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
    } else if (weight === 0 && intPoint === l - 1) {
      intPoint = l - 2;
      weight = 1;
    }

    let p0: Vector3;
    let p3: Vector3;

    if (this.closed || intPoint > 0) {
      p0 = points[(intPoint - 1) % l];
    } else {
      // 外推首点
      tmp.subVectors(points[0], points[1]).add(points[0]);
      p0 = tmp;
    }

    const p1 = points[intPoint % l];
    const p2 = points[(intPoint + 1) % l];

    if (this.closed || intPoint + 2 < l) {
      p3 = points[(intPoint + 2) % l];
    } else {
      // 外推末点
      tmp.subVectors(points[l - 1], points[l - 2]).add(points[l - 1]);
      p3 = tmp;
    }

    if (this.curveType === 'centripetal' || this.curveType === 'chordal') {
      const pow = this.curveType === 'chordal' ? 0.5 : 0.25;
      let dt0 = Math.pow(p0.distanceToSquared(p1), pow);
      let dt1 = Math.pow(p1.distanceToSquared(p2), pow);
      let dt2 = Math.pow(p2.distanceToSquared(p3), pow);

      // 重复点安全检查
      if (dt1 < 1e-4) dt1 = 1.0;
      if (dt0 < 1e-4) dt0 = dt1;
      if (dt2 < 1e-4) dt2 = dt1;

      px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
      py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
      pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
    } else if (this.curveType === 'catmullrom') {
      px.initCatmullRom(p0.x, p1.x, p2.x, p3.x, this.tension);
      py.initCatmullRom(p0.y, p1.y, p2.y, p3.y, this.tension);
      pz.initCatmullRom(p0.z, p1.z, p2.z, p3.z, this.tension);
    }

    point.set(px.calc(weight), py.calc(weight), pz.calc(weight));
    return point;
  }

  copy(source: this): this {
    super.copy(source);
    this.points = [];
    for (const p of source.points) {
      this.points.push(p.clone());
    }
    this.closed = source.closed;
    this.curveType = source.curveType;
    this.tension = source.tension;
    return this;
  }
}
