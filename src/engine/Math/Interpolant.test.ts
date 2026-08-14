// Interpolant 全家族单元测试 — 基类区间查找/缓存/边界 + 5 个子类插值正确性。
//
// 适配自 three.js test/unit 之外的独立设计(VREEN 无 KeyframeTrack,故直接测
// Interpolant 各实现的数值正确性)。全部纯数据层,不依赖 WebGL。
// 参考:three.js `src/math/Interpolant.js` 与其 `interpolants/` 五子类算法。

import { describe, it, expect } from 'vitest';
import {
  Interpolant,
  DiscreteInterpolant,
  LinearInterpolant,
  CubicInterpolant,
  QuaternionLinearInterpolant,
  BezierInterpolant,
  InterpolateLinear,
  ZeroCurvatureEnding,
  ZeroSlopeEnding,
  WrapAroundEnding,
} from './index';
import { Quaternion } from './Quaternion';

/** 数组近似比较(容忍浮点误差)。 */
function approx(actual: ArrayLike<number>, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; ++i) {
    expect((actual as ArrayLike<number>)[i]).toBeCloseTo(expected[i], 6);
  }
}

describe('Interpolant 基类 — 区间查找 / 缓存 / 边界', () => {
  // 用 LinearInterpolant 做驱动器,验证基类 evaluate 的查找逻辑(子类只做插值)
  function makeLinear(positions: Float32Array, values: Float32Array, size: number) {
    return new LinearInterpolant(positions, values, size);
  }

  it('首点之前 -> 钳制到第一个采样值', () => {
    const lerp = makeLinear(
      new Float32Array([1, 2, 3]),
      new Float32Array([10, 20, 30]),
      1,
    );
    // t=0 在首点 1 之前,应返回 values[0]=10
    approx(lerp.evaluate(0), [10]);
  });

  it('末点之后 -> 钳制到最后一个采样值', () => {
    const lerp = makeLinear(
      new Float32Array([1, 2, 3]),
      new Float32Array([10, 20, 30]),
      1,
    );
    approx(lerp.evaluate(100), [30]);
  });

  it('恰落区间内 -> 线性混合', () => {
    const lerp = makeLinear(
      new Float32Array([1, 2, 3]),
      new Float32Array([10, 20, 30]),
      1,
    );
    approx(lerp.evaluate(1.5), [15]); // (10+20)/2
    approx(lerp.evaluate(2.5), [25]); // (20+30)/2
  });

  it('缓存下标摊销:顺序增长访问不越界、结果正确', () => {
    const positions = new Float32Array([0, 1, 2, 3, 4, 5]);
    const values = new Float32Array([0, 10, 20, 30, 40, 50]);
    const lerp = makeLinear(positions, values, 1);
    for (let t = 0; t <= 5; t += 0.5) {
      const r = lerp.evaluate(t) as ArrayLike<number>;
      expect(r[0]).toBeCloseTo(t * 10, 6);
    }
  });

  it('随机跳到远处后回退二分查找仍正确', () => {
    const positions = new Float32Array([0, 1, 2, 3, 4, 5]);
    const values = new Float32Array([0, 10, 20, 30, 40, 50]);
    const lerp = makeLinear(positions, values, 1);
    // 缓存先停在末尾,然后跳回开头附近 — 走 backscan + 二分
    approx(lerp.evaluate(4.5), [45]);
    approx(lerp.evaluate(0.25), [2.5]);
    // 然后跳到末尾附近 — 走 forward scan + 二分
    approx(lerp.evaluate(4.75), [47.5]);
  });

  it('缺省 resultBuffer 时自动分配长度=valueSize', () => {
    const lerp = makeLinear(
      new Float32Array([0, 1]),
      new Float32Array([0, 0, 0, 5, 5, 5]),
      3,
    );
    const r = lerp.evaluate(0.5);
    expect(r.length).toBe(3);
    approx(r, [2.5, 2.5, 2.5]);
  });

  it('可外部传入 resultBuffer 做复用(同引用写入)', () => {
    const buf = new Float32Array(2);
    const lerp = new LinearInterpolant(
      new Float32Array([0, 1]),
      new Float32Array([0, 0, 10, 20]),
      2,
      buf,
    );
    const r = lerp.evaluate(0.5);
    expect(r).toBe(buf); // 同一引用,无新分配
    approx(r, [5, 10]);
  });

  it('插值/端点常量数值与 three.js 一致', () => {
    expect(InterpolateLinear).toBe(2301);
    expect(ZeroCurvatureEnding).toBe(2400);
    expect(ZeroSlopeEnding).toBe(2401);
    expect(WrapAroundEnding).toBe(2402);
  });

  it('基类提供默认 intervalChanged_(空实现)与 getSettings_', () => {
    // abstract 不允许实例化基类,但其原型方法存在且为函数
    expect(typeof (Interpolant.prototype as unknown as { intervalChanged_: unknown }).intervalChanged_).toBe('function');
    expect(typeof (Interpolant.prototype as unknown as { getSettings_: unknown }).getSettings_).toBe('function');
  });
});

describe('DiscreteInterpolant — 取左端(阶梯)', () => {
  it('取参数所在区间左端样点(阶梯)', () => {
    const d = new DiscreteInterpolant(
      new Float32Array([0, 1, 2]),
      new Float32Array([100, 200, 300]),
      1,
    );
    // 离散语义:取 t 所落区间的左端 keyframe。t 落在 [0,1) -> values[0]
    approx(d.evaluate(0.0), [100]); // 恰为 keyframe 0
    approx(d.evaluate(0.5), [100]); // 区间 [0,1) 左端 = values[0]
    approx(d.evaluate(1.0), [200]); // 恰为 keyframe 1
    approx(d.evaluate(1.999), [200]); // [1,2) 左端 = values[1]
  });

  it('末点之后钳制到最后一个样点', () => {
    const d = new DiscreteInterpolant(
      new Float32Array([0, 1]),
      new Float32Array([7, 9]),
      1,
    );
    approx(d.evaluate(100), [9]);
  });
});

describe('LinearInterpolant — 双线性混合', () => {
  it('单分量中点为两值平均', () => {
    const l = new LinearInterpolant(
      new Float32Array([0, 1]),
      new Float32Array([10, 30]),
      1,
    );
    approx(l.evaluate(0.25), [15]); // 10*0.75 + 30*0.25
    approx(l.evaluate(0.5), [20]);
    approx(l.evaluate(0.75), [25]);
  });

  it('多分量(valueSize=3)各自独立线性插值', () => {
    const l = new LinearInterpolant(
      new Float32Array([0, 1]),
      new Float32Array([0, 0, 0, 3, 6, 9]),
      3,
    );
    approx(l.evaluate(0.5), [1.5, 3, 4.5]);
  });
});

describe('CubicInterpolant — 三次 Hermite 样条', () => {
  // 取 5 个等距点:位置 0,1,2,3,4,值 0,1,4,9,16(平方),共 3 个内部区间
  const positions = new Float32Array([0, 1, 2, 3, 4]);
  const values = new Float32Array([0, 1, 4, 9, 16]);

  it('区间端点处返回对应采样值(C¹ 插值过点)', () => {
    const c = new CubicInterpolant(positions, values, 1);
    approx(c.evaluate(1), [1]); // t0=1 -> values[1]
    approx(c.evaluate(2), [4]); // t0=2 -> values[2]
    approx(c.evaluate(3), [9]); // t0=3 -> values[3]
  });

  it('区间内部存在插值但仍在两端值之间(单调场景)', () => {
    const c = new CubicInterpolant(positions, values, 1);
    // 区间 [1,2],t=1.5 的真实三次值介于 1 和 4 之间
    const r = (c.evaluate(1.5) as ArrayLike<number>)[0];
    expect(r).toBeGreaterThan(1 - 1e-6);
    expect(r).toBeLessThan(4 + 1e-6);
  });

  it('intervalChanged_ 在跨区间时更新相邻权重/偏移', () => {
    const c = new CubicInterpolant(positions, values, 1);
    // 触发一次落到区间 [1,2]
    c.evaluate(1.5);
    // 验证预计算权重与偏移为合理值(offsetPrev/offsetNext 单位为 stride=1)
    expect(c._weightPrev).not.toBe(-0);
    expect(c._weightNext).not.toBe(-0);
    expect(c._offsetPrev).toBe(0); // iPrev=0 -> 0*1
    expect(c._offsetNext).toBe(3); // iNext=3 -> 3*1
  });

  it('ZeroSlopeEnding:首区间无左邻时 f\'(t0)=0', () => {
    const c = new CubicInterpolant(positions, values, 1);
    c.settings = { endingStart: ZeroSlopeEnding, endingEnd: ZeroCurvatureEnding };
    // 落在首区间 [0,1]:iPrev 经 ZeroSlope -> iPrev=1, tPrev=2*t0-t1
    c.evaluate(0.5);
    // iPrev=1 -> offsetPrev = 1; tPrev = 0+0-... 权重应有限
    expect(c._offsetPrev).toBe(1);
    expect(Number.isFinite(c._weightPrev)).toBe(true);
  });

  it('ZeroCurvatureEnding(默认):首区间无左邻时自然样条', () => {
    const c = new CubicInterpolant(positions, values, 1);
    // 不设 settings -> 走 DefaultSettings_(ZeroCurvatureEnding)
    c.evaluate(0.5);
    // ZeroCurvature -> iPrev=i1, tPrev=t1 -> weightPrev=halfDt/(t0-tPrev)=halfDt/(0-1)=-0.5
    expect(c._weightPrev).toBeCloseTo(-0.5, 6);
  });

  it('WrapAroundEnding:末区间无右邻时回绕到首端', () => {
    const c = new CubicInterpolant(positions, values, 1);
    c.settings = { endingStart: ZeroCurvatureEnding, endingEnd: WrapAroundEnding };
    // 落在末区间 [3,4]:iNext 经 WrapAround -> iNext=1
    c.evaluate(3.5);
    expect(c._offsetNext).toBe(1); // 1*1
    expect(Number.isFinite(c._weightNext)).toBe(true);
  });
});

describe('QuaternionLinearInterpolant — 扁平数组 SLERP', () => {
  // 两个旋转:单位旋转 -> 绕 Y 转 π/2。
  // 绕 Y 轴 θ 的四元数 = (0, sin(θ/2), 0, cos(θ/2));
  // θ=π/2 -> (0, sin(π/4)=√2/2, 0, cos(π/4)=√2/2)。
  const q0 = new Quaternion(0, 0, 0, 1); // 单位
  const q1 = new Quaternion(0, Math.SQRT1_2, 0, Math.SQRT1_2);

  it('t=0 返回 prev、t=1 返回 cur', () => {
    const positions = new Float32Array([0, 1]);
    const values = new Float32Array([
      q0.x, q0.y, q0.z, q0.w,
      q1.x, q1.y, q1.z, q1.w,
    ]);
    const s = new QuaternionLinearInterpolant(positions, values, 4);
    approx(Array.from(s.evaluate(0)), [q0.x, q0.y, q0.z, q0.w]);
    approx(Array.from(s.evaluate(1)), [q1.x, q1.y, q1.z, q1.w]);
  });

  it('t=0.5 的结果为单位四元数(SLERP 保模长=1)', () => {
    const positions = new Float32Array([0, 1]);
    const values = new Float32Array([
      q0.x, q0.y, q0.z, q0.w,
      q1.x, q1.y, q1.z, q1.w,
    ]);
    const s = new QuaternionLinearInterpolant(positions, values, 4);
    const r = s.evaluate(0.5) as ArrayLike<number>;
    const len = Math.sqrt(r[0] ** 2 + r[1] ** 2 + r[2] ** 2 + r[3] ** 2);
    expect(len).toBeCloseTo(1, 6);
  });

  it('与面向对象 Quaternion.slerp 数值一致', () => {
    const positions = new Float32Array([0, 1]);
    const values = new Float32Array([
      q0.x, q0.y, q0.z, q0.w,
      q1.x, q1.y, q1.z, q1.w,
    ]);
    const s = new QuaternionLinearInterpolant(positions, values, 4);
    const r = s.evaluate(0.3) as ArrayLike<number>;
    const ref = new Quaternion().copy(q0).slerp(q1, 0.3);
    approx(Array.from(r), [ref.x, ref.y, ref.z, ref.w]);
  });

  it('最短弧:取负 q1 后结果与正 q1 一致(SLERP 应走短弧)', () => {
    const positions = new Float32Array([0, 1]);
    const valuesPos = new Float32Array([
      q0.x, q0.y, q0.z, q0.w,
      q1.x, q1.y, q1.z, q1.w,
    ]);
    const valuesNeg = new Float32Array([
      q0.x, q0.y, q0.z, q0.w,
      -q1.x, -q1.y, -q1.z, -q1.w, // -q1 表示同一旋转
    ]);
    const sPos = new QuaternionLinearInterpolant(positions, valuesPos, 4);
    const sNeg = new QuaternionLinearInterpolant(positions, valuesNeg, 4);
    const a = sPos.evaluate(0.5) as ArrayLike<number>;
    const b = sNeg.evaluate(0.5) as ArrayLike<number>;
    // 两结果应表示同一旋转:分量相等或全相反
    const same = [0, 1, 2, 3].every((i) => Math.abs(a[i] - b[i]) < 1e-6);
    const opp = [0, 1, 2, 3].every((i) => Math.abs(a[i] + b[i]) < 1e-6);
    expect(same || opp).toBe(true);
  });
});

describe('BezierInterpolant — 三次贝塞尔(显式切线)', () => {
  it('无切线数据时退化为线性插值', () => {
    const b = new BezierInterpolant(
      new Float32Array([0, 1]),
      new Float32Array([0, 10]),
      1,
    );
    // 未设置 inTangents/outTangents -> 走线性分支
    approx(b.evaluate(0.5), [5]);
  });

  it('平直线切线(控制点在采样点上)时退化为线性', () => {
    // 两端点 (0,0) 和 (1,10),N=2 keyframe。
    // tangentStride = stride*2 = 1*2 = 2;每个 tangent 数组长度 = N*tangentStride = 4。
    // 布局 [t0_time, t0_value, t1_time, t1_value];取与直线共线的控制点:
    // keyframe0 的 out tangent (0.5, 5),keyframe1 的 in tangent (0.5, 5)。
    const positions = new Float32Array([0, 1]);
    const values = new Float32Array([0, 10]);
    const outTangents = new Float32Array([0.5, 5, 0.5, 5]); // kg0、kg1 各一组
    const inTangents = new Float32Array([0.5, 5, 0.5, 5]);
    const b = new BezierInterpolant(positions, values, 1);
    b.inTangents = inTangents;
    b.outTangents = outTangents;
    // 控制点恰在直线上 -> 贝塞尔在直线上 -> 线性
    approx(b.evaluate(0.5), [5]);
    approx(b.evaluate(0.25), [2.5]);
  });

  it('端点处返回采样值(贝塞尔过端点)', () => {
    const positions = new Float32Array([0, 1]);
    const values = new Float32Array([0, 10]);
    const b = new BezierInterpolant(positions, values, 1);
    b.inTangents = new Float32Array([0.5, 5, 0.5, 5]);
    b.outTangents = new Float32Array([0.5, 5, 0.5, 5]);
    approx(b.evaluate(0), [0]);
    approx(b.evaluate(1), [10]);
  });

  it('多分量切线各自独立求值', () => {
    // valueSize=2,N=2 keyframe;tangentStride = 2*2 = 4;每数组长度 = 2*4 = 8。
    // 布局(每 keyframe:[c0_time,c0_val,c1_time,c1_val] ×2):
    //   kg0 out: [0.5,5, 0.5,10]   kg1 out: [0.5,5, 0.5,10]
    const positions = new Float32Array([0, 1]);
    const values = new Float32Array([0, 0, 10, 20]);
    const outTangents = new Float32Array([0.5, 5, 0.5, 10, 0.5, 5, 0.5, 10]);
    const inTangents = new Float32Array([0.5, 5, 0.5, 10, 0.5, 5, 0.5, 10]);
    const b = new BezierInterpolant(positions, values, 2);
    b.outTangents = outTangents;
    b.inTangents = inTangents;
    const r = b.evaluate(0.5) as ArrayLike<number>;
    // 两分量控制点都在直线上 -> [5, 10]
    approx(Array.from(r), [5, 10]);
  });
});

describe('Quaternion.slerpFlat — 静态扁平 SLERP', () => {
  it('t=0 拷贝 src0、t=1 拷贝 src1', () => {
    const src0 = new Float32Array([0, 0, 0, 1]);
    const src1 = new Float32Array([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    const dst = new Float32Array(4);
    Quaternion.slerpFlat(dst, 0, src0, 0, src1, 0, 0);
    approx(Array.from(dst), [0, 0, 0, 1]);
    Quaternion.slerpFlat(dst, 0, src0, 0, src1, 0, 1);
    approx(Array.from(dst), [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  });

  it('dstOffset 非零时把结果写到 dst 对应位置(不污染前段)', () => {
    const src0 = new Float32Array([0, 0, 0, 1]);
    const src1 = new Float32Array([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    const dst = new Float32Array(8);
    dst.fill(-7); // 用哨兵值标记前段
    Quaternion.slerpFlat(dst, 3, src0, 0, src1, 0, 0); // t=0 -> 拷贝 src0
    // 前 3 个哨兵保留不变
    expect(dst[0]).toBe(-7);
    expect(dst[1]).toBe(-7);
    expect(dst[2]).toBe(-7);
    // 第 3..6 写入 src0
    approx(Array.from(dst.slice(3, 7)), [0, 0, 0, 1]);
  });

  it('中间插值保模长=1', () => {
    const src0 = new Float32Array([0, 0, 0, 1]);
    const src1 = new Float32Array([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    const dst = new Float32Array(4);
    Quaternion.slerpFlat(dst, 0, src0, 0, src1, 0, 0.5);
    const len = Math.sqrt(dst[0] ** 2 + dst[1] ** 2 + dst[2] ** 2 + dst[3] ** 2);
    expect(len).toBeCloseTo(1, 6);
  });
});
