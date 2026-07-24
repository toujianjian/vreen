// ParticleCurve — 粒子生命周期曲线评估。
//
// 设计:
// - 所有曲线实现统一接口 `ParticleCurve.evaluate(t)`,t ∈ [0,1]
// - 四种内置曲线:Constant / Linear / Bezier / Random
// - 用于 ColorOverLife / SizeOverLife / VelocityOverLife 等修改器,
//   也用于发射器内部的速度/寿命抖动
// - 评估无副作用:同 t 多次 evaluate 返回一致结果(RandomCurve 除外,
//   其语义就是每次抽样带随机扰动)
//
// 为未来 GPU 粒子预留:曲线可序列化为 {type, params} JSON,
// 着色器端用 uniform 数组重建采样函数。

import { clamp, lerp } from '../Math/MathUtils';

/** 粒子曲线统一接口。 */
export interface ParticleCurve {
  /** 在 t∈[0,1] 处采样,返回曲线值。 */
  evaluate(t: number): number;
}

/** 常数曲线:evaluate 永远返回 value。 */
export class ConstantCurve implements ParticleCurve {
  constructor(public value: number = 1) {}
  evaluate(_t: number): number {
    return this.value;
  }
}

/** 线性曲线:在 [from, to] 之间按 t 线性插值。 */
export class LinearCurve implements ParticleCurve {
  constructor(public from: number = 0, public to: number = 1) {}
  evaluate(t: number): number {
    return lerp(this.from, this.to, clamp(t, 0, 1));
  }
}

/** 二次贝塞尔曲线:p0 → p1 → p2。 */
export class BezierCurve implements ParticleCurve {
  constructor(
    public p0: number = 0,
    public p1: number = 0.5,
    public p2: number = 1,
  ) {}
  evaluate(t: number): number {
    const ct = clamp(t, 0, 1);
    const it = 1 - ct;
    return it * it * this.p0 + 2 * it * ct * this.p1 + ct * ct * this.p2;
  }
}

/** 随机曲线:在 [min, max] 之间随机抽样,可叠加 inner 曲线作为基线。
 *  - inner 为 null 时:返回 min + random*(max-min)
 *  - inner 非空时:返回 lerp(min, max, inner.evaluate(t)) * random
 *  每次 evaluate 都重新抽样(适合抖动型属性,不适合需要逐粒子
 *  一致性的属性——后者应在 spawn 时一次性抽样存入 customData)。 */
export class RandomCurve implements ParticleCurve {
  constructor(
    public min: number = 0,
    public max: number = 1,
    public inner: ParticleCurve | null = null,
  ) {}
  evaluate(t: number): number {
    if (this.inner) {
      return lerp(this.min, this.max, this.inner.evaluate(t)) * Math.random();
    }
    return this.min + Math.random() * (this.max - this.min);
  }
}

/** 工厂:从简洁描述符构造曲线,方便从 JSON 重建。 */
export function createCurve(desc: {
  type: 'constant' | 'linear' | 'bezier' | 'random';
  value?: number;
  from?: number;
  to?: number;
  p0?: number;
  p1?: number;
  p2?: number;
  min?: number;
  max?: number;
  inner?: ParticleCurve | null;
}): ParticleCurve {
  switch (desc.type) {
    case 'constant':
      return new ConstantCurve(desc.value ?? 1);
    case 'linear':
      return new LinearCurve(desc.from ?? 0, desc.to ?? 1);
    case 'bezier':
      return new BezierCurve(desc.p0 ?? 0, desc.p1 ?? 0.5, desc.p2 ?? 1);
    case 'random':
      return new RandomCurve(desc.min ?? 0, desc.max ?? 1, desc.inner ?? null);
  }
}
