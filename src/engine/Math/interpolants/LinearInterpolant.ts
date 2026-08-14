// LinearInterpolant — 基础线性插值器。
//
// 适配自 three.js r169 `src/math/interpolants/LinearInterpolant.js`。
// 在落点区间 [t0, t1] 上对采样值做线性插值(C0 连续)。适用于标量/向量/颜色
// 等任意 valueSize 的数值轨道,配合常量 `InterpolateLinear`(2301)使用。
//
// 区间查找由基类承担;本类只覆写 `interpolate_` 计算双线性权重。

import { Interpolant } from '../Interpolant';

/**
 * 线性插值器:在区间内按比例 `(t-t0)/(t1-t0)` 做线性混合。
 */
export class LinearInterpolant extends Interpolant {
  /**
   * @param parameterPositions 参数位置序列。
   * @param sampleValues 采样值序列。
   * @param sampleSize 单个采样值的分量数。
   * @param resultBuffer 可选结果缓冲。
   */
  constructor(
    parameterPositions: Interpolant['parameterPositions'],
    sampleValues: Interpolant['sampleValues'],
    sampleSize: number,
    resultBuffer?: Interpolant['resultBuffer'],
  ) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }

  /**
   * `result = values[i0]*w0 + values[i1]*w1`,其中 `w1=(t-t0)/(t1-t0)`,w0=1-w1。
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

    const offset1 = i1 * stride;
    const offset0 = offset1 - stride;

    const weight1 = (t - t0) / (t1 - t0);
    const weight0 = 1 - weight1;

    for (let i = 0; i !== stride; ++i) {
      result[i] = values[offset0 + i] * weight0 + values[offset1 + i] * weight1;
    }

    return result;
  }
}
