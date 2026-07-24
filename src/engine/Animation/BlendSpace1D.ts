// BlendSpace1D — 1D animation blend space.
//
// 根据单个输入参数(通常是角色速度 m/s)在多个 AnimationClip 之间平滑混合。
// 典型用法:Idle (speed=0) → Walk (speed=1.5) → Run (speed=5.0)。
//
// 设计要点:
//   • 样本按 speed 升序排列;add() 会自动重新排序。
//   • update(speed, dt) 找到 bracket [a, b],用 alpha 线性混合两个 clip 的当前帧。
//   • 两个 clip 的 playhead 独立推进(各自带 timeScale),保证循环不漂移。
//   • 混合策略:
//       - Vector3 / Number:线性 lerp  out = a*(1-α) + b*α
//       - Quaternion:slerp(用四元数点积 + 球面插值)
//   • 超出范围(speed < min 或 > max):只播放最近的 clip,权重=1。
//   • 假设同一 BlendSpace 内所有 clip 的 track 布局一致(同名、同 target)。
//     这是角色动画的常见约束(同一骨架的不同动作)。
//
// 与 AnimationStateMachine 的区别:
//   StateMachine 是离散状态 + 触发式过渡;BlendSpace1D 是连续混合。
//   两者可组合:一个 State 的 clip 可以由 BlendSpace1D 驱动(Phase 3.4 再整合)。

import { AnimationClip } from './AnimationClip';
import { KeyframeTrack } from './KeyframeTrack';
import { AnimationMixer } from './AnimationMixer';

export interface BlendSpaceSample {
  /** 输入参数值(如速度 m/s)。必须唯一且升序(由 add 自动维护)。 */
  speed: number;
  /** 此 speed 对应的动画 clip。 */
  clip: AnimationClip;
  /** 可选播放速率缩放(如 Run clip 在 speed=5 时 timeScale=1.2 让步伐匹配)。 */
  timeScale?: number;
}

/** 内部运行时样本:带独立 playhead。 */
interface RuntimeSample extends BlendSpaceSample {
  /** 当前播放时间(秒),已 wrap 到 [0, duration]。 */
  playhead: number;
}

export class BlendSpace1D {
  private readonly mixer: AnimationMixer;
  private samples: RuntimeSample[] = [];
  /** 复用的采样缓冲区(按最大 valueSize 分配)。 */
  private readonly _bufA: number[] = [0, 0, 0, 1];
  private readonly _bufB: number[] = [0, 0, 0, 1];
  private readonly _out: number[] = [0, 0, 0, 1];

  constructor(mixer: AnimationMixer) {
    this.mixer = mixer;
  }

  /** 添加一个样本。会按 speed 升序保持排序。重复 speed 会覆盖旧 clip。
   *  clip 会被绑定到 mixer.root(通过 actionFor 触发)。 */
  add(sample: BlendSpaceSample): this {
    // 去重:同 speed 替换
    const existing = this.samples.findIndex(s => s.speed === sample.speed);
    if (existing >= 0) {
      this.samples[existing] = { ...sample, playhead: 0 };
    } else {
      this.samples.push({ ...sample, playhead: 0 });
    }
    this.samples.sort((a, b) => a.speed - b.speed);
    // 触发 bind(通过 mixer.actionFor 内部 clip.bind(root))
    this.mixer.actionFor(sample.clip);
    return this;
  }

  /** 当前样本数。 */
  size(): number {
    return this.samples.length;
  }

  /** 列出所有样本(只读视图)。 */
  list(): readonly Readonly<RuntimeSample>[] {
    return this.samples;
  }

  /** 重置所有 playhead 到 0。 */
  reset(): void {
    for (const s of this.samples) s.playhead = 0;
  }

  /** 推进混合:根据 speed 在样本间插值,把混合结果写到 target。
   *  speed = 当前输入参数(如角色速度)。dt = 帧时间(秒)。 */
  update(speed: number, dt: number): void {
    const n = this.samples.length;
    if (n === 0) return;

    // 单样本:直接播放
    if (n === 1) {
      const s = this.samples[0];
      s.playhead = this.advance(s, dt);
      this.applySingle(s);
      return;
    }

    // 找到 bracket [i, i+1]
    const { lo, hi, alpha } = this.findBracket(speed);

    // 两个样本重合或越界:单播放
    if (lo === hi) {
      const s = this.samples[lo];
      s.playhead = this.advance(s, dt);
      this.applySingle(s);
      return;
    }

    // 推进两个 playhead
    const a = this.samples[lo];
    const b = this.samples[hi];
    a.playhead = this.advance(a, dt);
    b.playhead = this.advance(b, dt);

    // 混合:iterate over a.clip.tracks(假设与 b.clip.tracks 同布局)
    const tracksA = a.clip.tracks;
    const tracksB = b.clip.tracks;
    const count = Math.min(tracksA.length, tracksB.length);
    for (let i = 0; i < count; i++) {
      this.blendTracks(tracksA[i], a.playhead, tracksB[i], b.playhead, alpha);
    }
  }

  /** 找到 speed 所在的 bracket [lo, hi] 和插值因子 alpha。
   *  越界时 lo === hi(指向最近的端点样本)。 */
  private findBracket(speed: number): { lo: number; hi: number; alpha: number } {
    const n = this.samples.length;
    if (speed <= this.samples[0].speed) return { lo: 0, hi: 0, alpha: 0 };
    if (speed >= this.samples[n - 1].speed) return { lo: n - 1, hi: n - 1, alpha: 0 };
    for (let i = 0; i < n - 1; i++) {
      const s0 = this.samples[i].speed;
      const s1 = this.samples[i + 1].speed;
      if (speed >= s0 && speed <= s1) {
        const range = s1 - s0;
        return { lo: i, hi: i + 1, alpha: range > 0 ? (speed - s0) / range : 0 };
      }
    }
    return { lo: 0, hi: 0, alpha: 0 };
  }

  /** 推进 playhead,wrap 到 [0, duration]。 */
  private advance(s: RuntimeSample, dt: number): number {
    const scale = s.timeScale ?? 1;
    let t = s.playhead + dt * scale;
    const d = s.clip.duration;
    if (d > 0) t = ((t % d) + d) % d;
    else t = 0;
    return t;
  }

  /** 单样本播放:直接 apply 所有 track。 */
  private applySingle(s: RuntimeSample): void {
    for (const track of s.clip.tracks) track.apply(s.playhead);
  }

  /** 混合两个 track:sample A、sample B,lerp/slerp 后写到 A.target(假设与 B 同 target)。 */
  private blendTracks(
    trackA: KeyframeTrack, timeA: number,
    trackB: KeyframeTrack, timeB: number,
    alpha: number,
  ): void {
    const size = trackA.valueSize;
    // 确保缓冲区足够大
    if (this._bufA.length < size) { this._bufA.length = size; this._bufB.length = size; this._out.length = size; }
    trackA.sample(timeA, this._bufA);
    trackB.sample(timeB, this._bufB);

    if (size === 4 && trackA.interp !== 'step') {
      // Quaternion: slerp
      slerpQuat(this._bufA, this._bufB, alpha, this._out);
    } else {
      // Linear lerp(Number / Vector3 / step quat)
      const inv = 1 - alpha;
      for (let i = 0; i < size; i++) {
        this._out[i] = this._bufA[i] * inv + this._bufB[i] * alpha;
      }
    }
    trackA.applyValue(this._out);
  }
}

/** 对两个四元数(raw [x,y,z,w])做 slerp,结果写入 out。 */
function slerpQuat(
  a: ArrayLike<number>, b: ArrayLike<number>,
  t: number,
  out: number[],
): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (1 - cos > 1e-5) {
    const omega = Math.acos(cos);
    const sinOm = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sinOm;
    s1 = Math.sin(t * omega) / sinOm;
  } else {
    s0 = 1 - t; s1 = t;
  }
  out[0] = s0 * ax + s1 * bx;
  out[1] = s0 * ay + s1 * by;
  out[2] = s0 * az + s1 * bz;
  out[3] = s0 * aw + s1 * bw;
}
