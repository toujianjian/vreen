// BezierInterpolant — 三次贝塞尔插值器(COLLADA/Maya 风格)。
//
// 适配自 three.js r169 `src/math/interpolants/BezierInterpolant.js`。
// 每个关键帧携带显式 in/out 切线控制点(2D 坐标 (time,value)),构造过该控制点
// 的三次贝塞尔曲线,而非用相邻样点估算切线(后者是 CubicInterpolant 的做法)。
// 适用于从 DAE(FBX/COLLADA)等美术工具导出的手 K 动画,其切线由美术直接编辑。
//
// 切线数据由外部经 `inTangents` / `outTangents` 字段灌入(由将来的
// KeyframeTrack.InterpolantFactoryMethodBezier 填充)。布局约定(每个分量一组):
// 每个 keyframe、每个 value 分量存 2 个值 (controlTime, controlValue),
// 故单条 tangent 数组长度 = N * stride * 2。
//
// 算法:对给定 t,在每个分量上先用牛顿-拉夫森求得贝塞尔「时间参数 s」使得
// X(s)=t(贝塞尔 X 与时间是单调映射),再用 s 在 Y 上代入三次贝塞尔多项式求值。
// 无切线数据时退化为线性插值,保证总能产出一个合理结果。

import { Interpolant } from '../Interpolant';

/**
 * 三次贝塞尔插值器(显式 in/out 切线)。切线通过实例字段灌入,见类注释。
 */
export class BezierInterpolant extends Interpolant {
  /**
   * in 切线缓冲(per-keyframe × per-value-component 的 2D (time,value) 控制点)。
   * 按需由外部填充;为空时退化为线性插值。
   */
  inTangents?: Interpolant['sampleValues'];

  /**
   * out 切线缓冲(同 inTangents 布局)。
   */
  outTangents?: Interpolant['sampleValues'];

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

    const inTangents = this.inTangents;
    const outTangents = this.outTangents;

    // 无切线数据 -> 退化为线性插值,保证稳健
    if (!inTangents || !outTangents) {
      const weight1 = (t - t0) / (t1 - t0);
      const weight0 = 1 - weight1;

      for (let i = 0; i !== stride; ++i) {
        result[i] = values[offset0 + i] * weight0 + values[offset1 + i] * weight1;
      }

      return result;
    }

    const tangentStride = stride * 2;
    const i0 = i1 - 1;

    for (let i = 0; i !== stride; ++i) {
      const v0 = values[offset0 + i];
      const v1 = values[offset1 + i];

      // 上一 keyframe 的 out 切线(C0)
      const outTangentOffset = i0 * tangentStride + i * 2;
      const c0x = outTangents[outTangentOffset] as number;
      const c0y = outTangents[outTangentOffset + 1] as number;

      // 当前 keyframe 的 in 切线(C1)
      const inTangentOffset = i1 * tangentStride + i * 2;
      const c1x = inTangents[inTangentOffset] as number;
      const c1y = inTangents[inTangentOffset + 1] as number;

      // 求贝塞尔时间参数 s 使 X(s)=t,再用 s 求值 Y(s)
      const s = solveBezierParameter(t, t0, c0x, c1x, t1);

      result[i] = cubicBezier(s, v0, c0y, c1y, v1);
    }

    return result;
  }
}

/** 三次贝塞尔多项式求值。 */
function cubicBezier(
  s: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const k = 1 - s;
  return k * k * k * p0 + 3 * k * k * s * p1 + 3 * k * s * s * p2 + s * s * s * p3;
}

/** 三次贝塞尔时间方向的导数(用于牛顿-拉夫森切线)。 */
function cubicBezierSlope(
  s: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const k = 1 - s;
  return 3 * k * k * (p1 - p0) + 6 * k * s * (p2 - p1) + 3 * s * s * (p3 - p2);
}

/**
 * 牛顿-拉夫森求解 `cubicBezier(s, x0, x1, x2, x3) = x` 在 [0,1] 的根。
 * 贝塞尔时间分量 X(s) 关于 s 通常单调(切线越界会破坏单调但极少),取初值
 * `s ≈ (x-x0)/(x3-x0)` 后迭代 8 次,误差 < 1e-10 则停;导数过小时也停。
 * 结果钳制到 [0,1]。
 */
function solveBezierParameter(
  x: number,
  x0: number,
  x1: number,
  x2: number,
  x3: number,
): number {
  let s = (x - x0) / (x3 - x0);

  for (let i = 0; i < 8; i++) {
    const error = cubicBezier(s, x0, x1, x2, x3) - x;
    if (Math.abs(error) < 1e-10) break;

    const slope = cubicBezierSlope(s, x0, x1, x2, x3);
    if (Math.abs(slope) < 1e-10) break;

    s = Math.max(0, Math.min(1, s - error / slope));
  }

  return s;
}
