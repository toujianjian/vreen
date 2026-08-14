// QuaternionLinearInterpolant — 球面线性单位四元数插值器。
//
// 适配自 three.js r169 `src/math/interpolants/QuaternionLinearInterpolant.js`。
// 专用于四元数旋转轨道:在区间内做 SLERP(球面线性插值)而非普通线性插值,
// 保证插值结果始终为单位四元数(旋转),避免线性插值导致的非刚体缩放漂移。
// 通常 valueSize 为 4(单个四元数)或其倍数(多个旋转通道并存于同一缓冲)。
//
// 关键:逐分量 SLERP 在「扁平数组」上完成 —— 调用 {@link Quaternion.slerpFlat},
// 与 AnimationMixer 在 GPU skinning 前向 buffer 写入四元数的流程契合,
// 无需构造中间 Quaternion 实例,零分配。
//
// 区间查找由基类承担;本类只覆写 `interpolate_`,按 alpha=slerp 权重推进。

import { Interpolant } from '../Interpolant';
import { Quaternion } from '../Quaternion';

/**
 * 四元数 SLERP 插值器:valueSize 应为 4 的倍数(每 4 个 float 一个四元数)。
 */
export class QuaternionLinearInterpolant extends Interpolant {
  constructor(
    parameterPositions: Interpolant['parameterPositions'],
    sampleValues: Interpolant['sampleValues'],
    sampleSize: number,
    resultBuffer?: Interpolant['resultBuffer'],
  ) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }

  interpolate_(
    i1: number,
    t0: number,
    t: number,
    t1: number,
  ): Interpolant['resultBuffer'] {
    const result = this.resultBuffer;
    const values = this.sampleValues;
    const stride = this.valueSize;

    const alpha = (t - t0) / (t1 - t0);

    let offset = i1 * stride;

    // 对每个连续的 4 元组四元数做一次 slerp(result ← slerp(prev, cur, alpha))
    for (let end = offset + stride; offset !== end; offset += 4) {
      Quaternion.slerpFlat(
        result,
        0,
        values,
        offset - stride,
        values,
        offset,
        alpha,
      );
    }

    return result;
  }
}
