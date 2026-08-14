// DiscreteInterpolant — 离散(阶梯)插值器。
//
// 适配自 three.js r169 `src/math/interpolants/DiscreteInterpolant.js`。
// 求值时直接返回「参数位置之前」那个采样值,不做平滑 —— 适用于离散动画
// (如:逐帧切换贴图、触发事件、状态切换轨道)。与 Continuous 插值器对应,
// 配合常量 `InterpolateDiscrete`(2300)使用。
//
// 区间查找仍由基类 {@link Interpolant#evaluate} 完成(承担缓存 + 二分逻辑),
// 本类只覆写 `interpolate_` 取前一个样点拷入结果缓冲。

import { Interpolant } from '../Interpolant';

/**
 * 离散插值器:取参数 `t` 所落入区间「左端」(即前一个)采样值。
 */
export class DiscreteInterpolant extends Interpolant {
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
   * 取区间左端(i1-1)采样值原样拷贝。`t0/t/t1` 对离散插值无意义,从略。
   */
  interpolate_(i1: number): Interpolant['resultBuffer'] {
    return this.copySampleValue_(i1 - 1);
  }
}
