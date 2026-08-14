// CubicInterpolant — 快速三次样条插值器。
//
// 适配自 three.js r169 `src/math/interpolants/CubicInterpolant.js`。
// 由 Hermite 构造派生:在每对相邻样点处,把一阶导数取为「跨该参数区间
// 相邻样点连线的斜率」(中心差分式切线),从而得到一条 C¹ 连续的三次曲线。
// 相对 LinearInterpolant 更平滑(无折角),适用于位置/缩放等连续量,配合
// 常量 `InterpolateSmooth`(2302)使用。
//
// 端点策略(常量见 Interpolant.ts 顶部):
// - ZeroCurvatureEnding(默认):自然样条,二阶导 f''(端点)=0
// - ZeroSlopeEnding:一阶导 f'(端点)=0(平切线)
// - WrapAroundEnding:用曲线另一端的样点外延(循环动画)
// 这些策略仅在样点不足(首尾区间无左/右邻)时决定如何虚拟外延邻样点。
//
// 区间查找由基类承担;每次跨入新区间时 `intervalChanged_` 预计算四个相关样点
// (prev / cur / next 之对称)的权重与偏移,`interpolate_` 用三次 Hermite 基多项式组合。

import {
  Interpolant,
  ZeroCurvatureEnding,
  ZeroSlopeEnding,
  WrapAroundEnding,
} from '../Interpolant';

/**
 * 中心差分式三次 Hermite 样条插值器。
 */
export class CubicInterpolant extends Interpolant {
  /** 区间左邻(cur-1)在该区间下的权重(预计算)。 */
  _weightPrev = -0;
  /** 区间左邻在 sampleValues 中的字节偏移(预计算)。 */
  _offsetPrev = -0;
  /** 区间右邻(cur+1)在该区间下的权重(预计算)。 */
  _weightNext = -0;
  /** 区间右邻在 sampleValues 中的字节偏移(预计算)。 */
  _offsetNext = -0;

  constructor(
    parameterPositions: Interpolant['parameterPositions'],
    sampleValues: Interpolant['sampleValues'],
    sampleSize: number,
    resultBuffer?: Interpolant['resultBuffer'],
  ) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);

    // 默认两端均用自然样条(二阶导为 0)
    this.DefaultSettings_ = {
      endingStart: ZeroCurvatureEnding,
      endingEnd: ZeroCurvatureEnding,
    };
  }

  /**
   * 区间切换时预计算 prev/next 样点的索引与权重。
   * 当 prev/next 越界(无样点)时按 `endingStart`/`endingEnd` 策略虚拟外延。
   */
  intervalChanged_(i1: number, t0: number, t1: number): void {
    const pp = this.parameterPositions;
    let iPrev = i1 - 2;
    let iNext = i1 + 1;

    let tPrev = pp[iPrev] as number;
    let tNext = pp[iNext] as number;

    if (tPrev === undefined) {
      switch (this.getSettings_().endingStart) {
        case ZeroSlopeEnding:
          // f'(t0) = 0:镜像当前区间制造零斜率虚拟点
          iPrev = i1;
          tPrev = 2 * t0 - t1;
          break;

        case WrapAroundEnding:
          // 循环:取曲线另一端
          iPrev = pp.length - 2;
          tPrev = t0 + pp[iPrev] - (pp[iPrev + 1] as number);
          break;

        default: // ZeroCurvatureEnding —— 自然样条:f''(t0)=0
          iPrev = i1;
          tPrev = t1;
      }
    }

    if (tNext === undefined) {
      switch (this.getSettings_().endingEnd) {
        case ZeroSlopeEnding:
          // f'(tN) = 0
          iNext = i1;
          tNext = 2 * t1 - t0;
          break;

        case WrapAroundEnding:
          // 循环:取曲线首端
          iNext = 1;
          tNext = t1 + (pp[1] as number) - (pp[0] as number);
          break;

        default: // ZeroCurvatureEnding —— 自然样条:f''(tN)=0
          iNext = i1 - 1;
          tNext = t0;
      }
    }

    const halfDt = (t1 - t0) * 0.5;
    const stride = this.valueSize;

    this._weightPrev = halfDt / (t0 - tPrev);
    this._weightNext = halfDt / (tNext - t1);
    this._offsetPrev = iPrev * stride;
    this._offsetNext = iNext * stride;
  }

  /**
   * 用三次 Hermite 基多项式组合 prev/cur0/cur1/next 四个样点。
   * 基函数系数与 three.js 一致(sP/s0/s1/sN 对应四点权重多项式)。
   */
  interpolate_(
    i1: number,
    t0: number,
    t: number,
    t1: number,
  ): Interpolant['resultBuffer'] {
    const result = this.resultBuffer;
    const values = this.sampleValues;
    const stride = this.valueSize;

    const o1 = i1 * stride;
    const o0 = o1 - stride;
    const oP = this._offsetPrev;
    const oN = this._offsetNext;
    const wP = this._weightPrev;
    const wN = this._weightNext;

    const p = (t - t0) / (t1 - t0);
    const pp = p * p;
    const ppp = pp * p;

    // 四条基多项式(对四个样点的权重)
    const sP = -wP * ppp + 2 * wP * pp - wP * p;
    const s0 = (1 + wP) * ppp + (-1.5 - 2 * wP) * pp + (-0.5 + wP) * p + 1;
    const s1 = (-1 - wN) * ppp + (1.5 + wN) * pp + 0.5 * p;
    const sN = wN * ppp - wN * pp;

    // 线性组合四个样点
    for (let i = 0; i !== stride; ++i) {
      result[i] =
        sP * values[oP + i] +
        s0 * values[o0 + i] +
        s1 * values[o1 + i] +
        sN * values[oN + i];
    }

    return result;
  }
}
