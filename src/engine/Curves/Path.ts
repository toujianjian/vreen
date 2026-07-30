// Path — 2D 路径构建器,适配自 three.js src/extras/core/Path.js (MIT)。
// 继承 CurvePath<Vector2>,提供 moveTo/lineTo/bezierCurveTo/splineThru/arc 等
// Canvas 2D 风格 API。每条子曲线压入 this.curves,currentPoint 同步更新。

import { Vector2 } from '../Math/Vector2';
import { CurvePath } from './CurvePath';
import { EllipseCurve } from './EllipseCurve';
import { SplineCurve } from './SplineCurve';
import { CubicBezierCurve } from './CubicBezierCurve';
import { QuadraticBezierCurve } from './QuadraticBezierCurve';
import { LineCurve } from './LineCurve';

export class Path extends CurvePath<Vector2> {
  type = 'Path';
  currentPoint: Vector2;

  constructor(points?: Vector2[]) {
    super();
    this.currentPoint = new Vector2();
    if (points) {
      this.setFromPoints(points);
    }
  }

  /** 从点数组构建路径: moveTo 第一个点, lineTo 其余点。 */
  setFromPoints(points: Vector2[]): this {
    this.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.lineTo(points[i].x, points[i].y);
    }
    return this;
  }

  /** 移动画笔(不产生曲线)。 */
  moveTo(x: number, y: number): this {
    this.currentPoint.set(x, y);
    return this;
  }

  /** 从当前点画直线到 (x,y)。 */
  lineTo(x: number, y: number): this {
    const curve = new LineCurve(this.currentPoint.clone(), new Vector2(x, y));
    this.curves.push(curve);
    this.currentPoint.set(x, y);
    return this;
  }

  /** 二次贝塞尔: 当前点 → 控制点(cpx,cpy) → 终点(x,y)。 */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): this {
    const curve = new QuadraticBezierCurve(
      this.currentPoint.clone(),
      new Vector2(cpx, cpy),
      new Vector2(x, y),
    );
    this.curves.push(curve);
    this.currentPoint.set(x, y);
    return this;
  }

  /** 三次贝塞尔: 当前点 → cp1 → cp2 → 终点。 */
  bezierCurveTo(
    cp1x: number, cp1y: number,
    cp2x: number, cp2y: number,
    x: number, y: number,
  ): this {
    const curve = new CubicBezierCurve(
      this.currentPoint.clone(),
      new Vector2(cp1x, cp1y),
      new Vector2(cp2x, cp2y),
      new Vector2(x, y),
    );
    this.curves.push(curve);
    this.currentPoint.set(x, y);
    return this;
  }

  /** Catmull-Rom 样条穿过给定点序列(含当前点)。 */
  splineThru(pts: Vector2[]): this {
    const npts = [this.currentPoint.clone(), ...pts];
    const curve = new SplineCurve(npts);
    this.curves.push(curve);
    this.currentPoint.copy(pts[pts.length - 1]);
    return this;
  }

  /** 相对当前点定位的圆弧。 */
  arc(aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise: boolean): this {
    this.absarc(
      aX + this.currentPoint.x,
      aY + this.currentPoint.y,
      aRadius, aStartAngle, aEndAngle, aClockwise,
    );
    return this;
  }

  /** 绝对定位的圆弧 (xRadius=yRadius=aRadius)。 */
  absarc(aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise: boolean): this {
    this.absellipse(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise, 0);
    return this;
  }

  /** 相对当前点定位的椭圆弧。 */
  ellipse(
    aX: number, aY: number,
    xRadius: number, yRadius: number,
    aStartAngle: number, aEndAngle: number,
    aClockwise: boolean, aRotation: number,
  ): this {
    this.absellipse(
      aX + this.currentPoint.x,
      aY + this.currentPoint.y,
      xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation,
    );
    return this;
  }

  /** 绝对定位的椭圆弧。若弧起点与当前点不重合则自动 lineTo 连接。 */
  absellipse(
    aX: number, aY: number,
    xRadius: number, yRadius: number,
    aStartAngle: number, aEndAngle: number,
    aClockwise: boolean, aRotation: number,
  ): this {
    const curve = new EllipseCurve(
      aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation,
    );
    if (this.curves.length > 0) {
      // 尝试与上一条曲线终点连接
      const firstPoint = curve.getPoint(0);
      if (!firstPoint.equals(this.currentPoint)) {
        this.lineTo(firstPoint.x, firstPoint.y);
      }
    }
    this.curves.push(curve);
    const lastPoint = curve.getPoint(1);
    this.currentPoint.copy(lastPoint);
    return this;
  }

  copy(source: this): this {
    super.copy(source);
    this.currentPoint.copy(source.currentPoint);
    return this;
  }
}
