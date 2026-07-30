// EllipseCurve — 2D 椭圆弧,适配自 three.js src/extras/curves/EllipseCurve.js (MIT)。
// 参数: 中心(aX,aY)、半径(xRadius,yRadius)、起始/终止角度、顺逆时针、整体旋转。

import { Curve } from './Curve';
import { Vector2 } from '../Math/Vector2';

export class EllipseCurve extends Curve<Vector2> {
  isEllipseCurve = true;
  type = 'EllipseCurve';

  aX: number;
  aY: number;
  xRadius: number;
  yRadius: number;
  aStartAngle: number;
  aEndAngle: number;
  aClockwise: boolean;
  aRotation: number;

  constructor(
    aX = 0,
    aY = 0,
    xRadius = 1,
    yRadius = 1,
    aStartAngle = 0,
    aEndAngle = Math.PI * 2,
    aClockwise = false,
    aRotation = 0,
  ) {
    super();
    this.aX = aX;
    this.aY = aY;
    this.xRadius = xRadius;
    this.yRadius = yRadius;
    this.aStartAngle = aStartAngle;
    this.aEndAngle = aEndAngle;
    this.aClockwise = aClockwise;
    this.aRotation = aRotation;
  }

  getPoint(t: number, optionalTarget: Vector2 = new Vector2()): Vector2 {
    const point = optionalTarget;
    const twoPi = Math.PI * 2;
    let deltaAngle = this.aEndAngle - this.aStartAngle;
    const samePoints = Math.abs(deltaAngle) < Number.EPSILON;

    // 确保 deltaAngle 在 [0, 2π]
    while (deltaAngle < 0) deltaAngle += twoPi;
    while (deltaAngle > twoPi) deltaAngle -= twoPi;

    if (deltaAngle < Number.EPSILON) {
      if (samePoints) {
        deltaAngle = 0;
      } else {
        deltaAngle = twoPi;
      }
    }

    if (this.aClockwise === true && !samePoints) {
      if (deltaAngle === twoPi) {
        deltaAngle = -twoPi;
      } else {
        deltaAngle = deltaAngle - twoPi;
      }
    }

    const angle = this.aStartAngle + t * deltaAngle;
    let x = this.aX + this.xRadius * Math.cos(angle);
    let y = this.aY + this.yRadius * Math.sin(angle);

    if (this.aRotation !== 0) {
      const cos = Math.cos(this.aRotation);
      const sin = Math.sin(this.aRotation);
      const tx = x - this.aX;
      const ty = y - this.aY;
      x = tx * cos - ty * sin + this.aX;
      y = tx * sin + ty * cos + this.aY;
    }

    return point.set(x, y);
  }

  copy(source: this): this {
    super.copy(source);
    this.aX = source.aX;
    this.aY = source.aY;
    this.xRadius = source.xRadius;
    this.yRadius = source.yRadius;
    this.aStartAngle = source.aStartAngle;
    this.aEndAngle = source.aEndAngle;
    this.aClockwise = source.aClockwise;
    this.aRotation = source.aRotation;
    return this;
  }
}
