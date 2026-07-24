// Shape — 简化版 2D 形状/路径,从 three.js 的 Path+CurvePath+Shape 体系简化而来。
// 仅支持平面 2D 曲线段:直线、二次贝塞尔、三次贝塞尔、椭圆弧。
// 提供 Canvas 风格的 moveTo/lineTo/quadraticCurveTo/bezierCurveTo/absarc/closePath。
// getPoints(divisions) 沿所有曲线段采样并去重相邻重复点,返回 Vector2[]。
// 参考: three.js/src/extras/core/Shape.js / Path.js / CurvePath.js

import { Vector2 } from '../Math';

/** 曲线段类型标识。 */
type CurveType = 'line' | 'quadraticBezier' | 'cubicBezier' | 'arc';

/** 2D 曲线段:用判别联合表示四种曲线。
 *  - line: P0 → P1
 *  - quadraticBezier: P0, CP, P1(二次贝塞尔)
 *  - cubicBezier: P0, CP1, CP2, P1(三次贝塞尔)
 *  - arc: 椭圆弧(中心 aX/aY,半径 xRadius/yRadius,起止角,绕向) */
interface CurveSegment {
  type: CurveType;
  p0: Vector2;
  p1: Vector2;
  cp1?: Vector2;
  cp2?: Vector2;
  // 椭圆弧参数
  aX?: number;
  aY?: number;
  xRadius?: number;
  yRadius?: number;
  aStartAngle?: number;
  aEndAngle?: number;
  aClockwise?: boolean;
}

/** 简化版 2D 形状。 */
export class Shape {
  /** 当前路径的所有曲线段。 */
  curves: CurveSegment[] = [];
  /** 当前画笔位置;moveTo/lineTo 等方法从此点出发。 */
  currentPoint: Vector2 = new Vector2();
  /** 形状的孔洞列表(每个孔洞本身也是一个 Shape)。 */
  holes: Shape[] = [];
  /** 是否在 getPoints 时自动闭合(追加首点)。 */
  autoClose = false;

  constructor(points?: Vector2[]) {
    if (points && points.length > 0) {
      this.setFromPoints(points);
    }
  }

  /** 用一组点初始化路径:moveTo 第一点,后续点用 lineTo 连接。 */
  setFromPoints(points: Vector2[]): this {
    this.moveTo(points[0].x, points[0].y);
    for (let i = 1, l = points.length; i < l; i++) {
      this.lineTo(points[i].x, points[i].y);
    }
    return this;
  }

  /** 移动画笔到 (x, y),不添加曲线段。 */
  moveTo(x: number, y: number): this {
    this.currentPoint.set(x, y);
    return this;
  }

  /** 从当前点画一条直线到 (x, y)。 */
  lineTo(x: number, y: number): this {
    this.curves.push({
      type: 'line',
      p0: this.currentPoint.clone(),
      p1: new Vector2(x, y),
    });
    this.currentPoint.set(x, y);
    return this;
  }

  /** 从当前点画一条二次贝塞尔曲线到 (aX, aY),(aCPx,aCPy) 为控制点。 */
  quadraticCurveTo(aCPx: number, aCPy: number, aX: number, aY: number): this {
    this.curves.push({
      type: 'quadraticBezier',
      p0: this.currentPoint.clone(),
      cp1: new Vector2(aCPx, aCPy),
      p1: new Vector2(aX, aY),
    });
    this.currentPoint.set(aX, aY);
    return this;
  }

  /** 从当前点画一条三次贝塞尔曲线到 (aX, aY),(aCP1x,aCP1y)/(aCP2x,aCP2y) 为控制点。 */
  bezierCurveTo(
    aCP1x: number,
    aCP1y: number,
    aCP2x: number,
    aCP2y: number,
    aX: number,
    aY: number,
  ): this {
    this.curves.push({
      type: 'cubicBezier',
      p0: this.currentPoint.clone(),
      cp1: new Vector2(aCP1x, aCP1y),
      cp2: new Vector2(aCP2x, aCP2y),
      p1: new Vector2(aX, aY),
    });
    this.currentPoint.set(aX, aY);
    return this;
  }

  /** 添加一个绝对定位的圆弧(等价于 absellipse 且 xRadius=yRadius)。 */
  absarc(
    aX: number,
    aY: number,
    aRadius: number,
    aStartAngle: number,
    aEndAngle: number,
    aClockwise = false,
  ): this {
    return this.absellipse(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise);
  }

  /** 添加一个绝对定位的椭圆弧。若与当前点不衔接,会自动插入一条直线连接。 */
  absellipse(
    aX: number,
    aY: number,
    xRadius: number,
    yRadius: number,
    aStartAngle: number,
    aEndAngle: number,
    aClockwise = false,
  ): this {
    const arc: CurveSegment = {
      type: 'arc',
      p0: new Vector2(), // 占位,稍后计算
      p1: new Vector2(),
      aX,
      aY,
      xRadius,
      yRadius,
      aStartAngle,
      aEndAngle,
      aClockwise,
    };
    // 起点 = arc 在 t=0 处的采样
    arc.p0 = sampleArc(arc, 0);
    // 终点 = arc 在 t=1 处的采样
    arc.p1 = sampleArc(arc, 1);

    if (this.curves.length > 0) {
      // 若前一段的终点与当前弧起点不重合,自动补一条直线
      if (!arc.p0.equals(this.currentPoint)) {
        this.lineTo(arc.p0.x, arc.p0.y);
      }
    }

    this.curves.push(arc);
    this.currentPoint.copy(arc.p1);
    return this;
  }

  /** 闭合路径:若末尾点与起始点不重合,补一条直线回到起点。 */
  closePath(): this {
    if (this.curves.length === 0) return this;
    const startPoint = this.curves[0].p0;
    if (!startPoint.equals(this.currentPoint)) {
      this.lineTo(startPoint.x, startPoint.y);
    }
    return this;
  }

  /** 沿所有曲线段采样,合并并去重相邻重复点。
   *  直线段不分段(返回 1 个点,即终点);曲线段按 divisions 等分采样。 */
  getPoints(divisions = 12): Vector2[] {
    const points: Vector2[] = [];
    let last: Vector2 | null = null;

    for (const curve of this.curves) {
      let resolution: number;
      switch (curve.type) {
        case 'line':
          resolution = 1;
          break;
        case 'arc':
          // 椭圆弧细分两倍,与 three.js 一致
          resolution = divisions * 2;
          break;
        default:
          resolution = divisions;
      }

      const pts = sampleCurve(curve, resolution);
      for (const p of pts) {
        if (last && last.equals(p)) continue;
        points.push(p);
        last = p;
      }
    }

    if (this.autoClose && points.length > 1) {
      const first = points[0];
      const lastP = points[points.length - 1];
      if (!lastP.equals(first)) {
        points.push(first.clone());
      }
    }

    return points;
  }

  /** 返回所有孔洞的采样点列表(每个孔洞是一个 Vector2[])。 */
  getPointsHoles(divisions: number): Vector2[][] {
    const holesPts: Vector2[][] = [];
    for (const hole of this.holes) {
      holesPts.push(hole.getPoints(divisions));
    }
    return holesPts;
  }

  /** 同时返回形状外轮廓与孔洞的采样点。 */
  extractPoints(divisions: number): {
    shape: Vector2[];
    holes: Vector2[][];
  } {
    return {
      shape: this.getPoints(divisions),
      holes: this.getPointsHoles(divisions),
    };
  }

  /** 在外轮廓上添加一个孔洞。 */
  addHole(hole: Shape): this {
    this.holes.push(hole);
    return this;
  }
}

/** 对一段曲线按分辨率采样,返回点数组(不含起点,含终点)。 */
function sampleCurve(curve: CurveSegment, resolution: number): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 1; i <= resolution; i++) {
    const t = i / resolution;
    pts.push(sampleCurveAt(curve, t));
  }
  // 把起点补到数组头部,使调用者得到完整 [p0, p1, ..., pN]
  pts.unshift(curve.p0.clone());
  return pts;
}

/** 按参数 t∈[0,1] 采样曲线上的点。 */
function sampleCurveAt(curve: CurveSegment, t: number): Vector2 {
  switch (curve.type) {
    case 'line': {
      return new Vector2(
        curve.p0.x + (curve.p1.x - curve.p0.x) * t,
        curve.p0.y + (curve.p1.y - curve.p0.y) * t,
      );
    }
    case 'quadraticBezier': {
      const cp = curve.cp1!;
      const inv = 1 - t;
      const b0 = inv * inv;
      const b1 = 2 * inv * t;
      const b2 = t * t;
      return new Vector2(
        b0 * curve.p0.x + b1 * cp.x + b2 * curve.p1.x,
        b0 * curve.p0.y + b1 * cp.y + b2 * curve.p1.y,
      );
    }
    case 'cubicBezier': {
      const cp1 = curve.cp1!;
      const cp2 = curve.cp2!;
      const inv = 1 - t;
      const b0 = inv * inv * inv;
      const b1 = 3 * inv * inv * t;
      const b2 = 3 * inv * t * t;
      const b3 = t * t * t;
      return new Vector2(
        b0 * curve.p0.x + b1 * cp1.x + b2 * cp2.x + b3 * curve.p1.x,
        b0 * curve.p0.y + b1 * cp1.y + b2 * cp2.y + b3 * curve.p1.y,
      );
    }
    case 'arc': {
      return sampleArc(curve, t);
    }
  }
}

/** 椭圆弧采样:t=0 → 起点,t=1 → 终点。
 *  逆时针扫过 aStartAngle → aEndAngle;若 aClockwise=true 则反向扫过。 */
function sampleArc(curve: CurveSegment, t: number): Vector2 {
  const aX = curve.aX ?? 0;
  const aY = curve.aY ?? 0;
  const xR = curve.xRadius ?? 0;
  const yR = curve.yRadius ?? 0;
  const start = curve.aStartAngle ?? 0;
  const end = curve.aEndAngle ?? Math.PI * 2;
  const clockwise = curve.aClockwise ?? false;

  let delta = end - start;
  if (clockwise) delta = -Math.abs(delta);
  else delta = Math.abs(delta);

  const angle = start + t * delta;
  return new Vector2(
    aX + xR * Math.cos(angle),
    aY + yR * Math.sin(angle),
  );
}
