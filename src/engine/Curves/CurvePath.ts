// CurvePath — 曲线集合,适配自 three.js src/extras/core/CurvePath.js (MIT)。
// 将多条首尾相连的子曲线视为一条复合曲线,保留 Curve 的 API。
// 额外提供 toGeometry(divisions) 生成 line-strip BufferGeometry。

import { Curve, type CurvePoint } from './Curve';
import { Vector2 } from '../Math/Vector2';
import { Vector3 } from '../Math/Vector3';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { LineCurve } from './LineCurve';
import { LineCurve3 } from './LineCurve3';

export class CurvePath<TVector extends CurvePoint = CurvePoint> extends Curve<TVector> {
  type = 'CurvePath';

  curves: Curve<TVector>[] = [];
  autoClose = false;

  /** @internal 子曲线长度缓存。 */
  private cacheLengths: number[] | null = null;

  add(curve: Curve<TVector>): this {
    this.curves.push(curve);
    return this;
  }

  /** 若首尾不重合,追加一条直线段闭合路径。 */
  closePath(): this {
    const startPoint = this.curves[0]?.getPoint(0);
    const endPoint = this.curves[this.curves.length - 1]?.getPoint(1);
    if (!startPoint || !endPoint) return this;
    if (!startPoint.equals(endPoint)) {
      // 根据 2D/3D 选择对应直线类
      const is2D = startPoint instanceof Vector2;
      const line = (is2D
        ? new LineCurve(endPoint as unknown as Vector2, startPoint as unknown as Vector2)
        : new LineCurve3(endPoint as unknown as Vector3, startPoint as unknown as Vector3)
      ) as unknown as Curve<TVector>;
      this.curves.push(line);
    }
    return this;
  }

  /**
   * 按复合路径总弧长比例 t 取点。
   * 1. 算各子曲线累积长度; 2. 定位 t 对应的子曲线; 3. 在子曲线上取点。
   */
  getPoint(t: number, optionalTarget?: TVector): TVector {
    const d = t * this.getLength();
    const curveLengths = this.getCurveLengths();
    let i = 0;
    while (i < curveLengths.length) {
      if (curveLengths[i] >= d) {
        const diff = curveLengths[i] - d;
        const curve = this.curves[i];
        const segmentLength = curve.getLength();
        const u = segmentLength === 0 ? 0 : 1 - diff / segmentLength;
        return curve.getPointAt(u, optionalTarget);
      }
      i++;
    }
    // 兜底: 返回最后一条曲线的终点
    return this.curves[this.curves.length - 1]?.getPoint(1, optionalTarget);
  }

  /** 复合路径总弧长。 */
  getLength(): number {
    const lens = this.getCurveLengths();
    return lens[lens.length - 1];
  }

  /** 标记缓存失效。 */
  updateArcLengths(): void {
    this.needsUpdate = true;
    this.cacheLengths = null;
    this.getCurveLengths();
  }

  /** 累积子曲线长度 [len0, len0+len1, ...]。 */
  getCurveLengths(): number[] {
    if (this.cacheLengths && this.cacheLengths.length === this.curves.length) {
      return this.cacheLengths;
    }
    const lengths: number[] = [];
    let sums = 0;
    for (const curve of this.curves) {
      sums += curve.getLength();
      lengths.push(sums);
    }
    this.cacheLengths = lengths;
    return lengths;
  }

  /** 按弧长均匀采样 divisions+1 个点(闭合时追加首点)。 */
  getSpacedPoints(divisions = 40): TVector[] {
    const points: TVector[] = [];
    for (let i = 0; i <= divisions; i++) {
      points.push(this.getPoint(i / divisions));
    }
    if (this.autoClose) {
      points.push(points[0]);
    }
    return points;
  }

  /**
   * 按参数采样: 各子曲线独立等分,自动跳过相邻重复点。
   * 不同曲线类型的默认分段数不同 (Ellipse×2, Line=1, Spline×N)。
   */
  getPoints(divisions = 12): TVector[] {
    const points: TVector[] = [];
    let last: TVector | null = null;

    for (const curve of this.curves) {
      const resolution = curve.isEllipseCurve
        ? divisions * 2
        : curve.isLineCurve || curve.isLineCurve3
          ? 1
          : curve.isSplineCurve
            ? divisions * (curve as unknown as { points: unknown[] }).points.length
            : curve.isCatmullRomCurve3
              ? divisions * (curve as unknown as { points: unknown[] }).points.length
              : divisions;

      const pts = curve.getPoints(resolution);
      for (const point of pts) {
        if (last && last.equals(point)) continue;
        points.push(point);
        last = point;
      }
    }

    if (this.autoClose && points.length > 1 && !points[points.length - 1].equals(points[0])) {
      points.push(points[0]);
    }

    return points;
  }

  /**
   * 生成 line-strip BufferGeometry。
   * 采样 divisions+1 个点(弧长均匀),写入 position 属性。
   * Vector2 点的 z=0。返回非索引几何体,渲染时用 gl.LINE_STRIP。
   */
  toGeometry(divisions = 40): BufferGeometry {
    const points = this.getSpacedPoints(divisions);
    const count = points.length;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = points[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = (p as unknown as { z?: number }).z ?? 0;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    return geo;
  }

  copy(source: this): this {
    super.copy(source);
    this.curves = [];
    for (const curve of source.curves) {
      this.curves.push(curve.clone() as Curve<TVector>);
    }
    this.autoClose = source.autoClose;
    return this;
  }
}
