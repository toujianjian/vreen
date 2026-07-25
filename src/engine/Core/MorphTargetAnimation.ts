// MorphTargetAnimation — 形变目标动画驱动器。
//
// 设计:
//   - 持有一个 MorphTargets 实例(形变目标数据 + 权重)
//   - 每个形变目标对应一条轨道 MorphTargetTrack(times + values 标量序列)
//   - update(dt) 推进时间,按线性插值采样每条轨道,写回 morphTargets 的 influence
//   - 应用规则:result_position = base + Σ(target - base) * influence(由 MorphTargets.applyToGeometry 完成)
//
// 与 AnimationMixer 的关系:
//   - AnimationMixer 驱动 Object3D 的 position/quaternion/scale/bones
//   - MorphTargetAnimation 驱动 MorphTargets 的标量权重
//   - 两者互补:骨骼动画做整体姿态,形变动画做面部表情 / 局部细节
//
// 不复用 KeyframeTrack:
//   KeyframeTrack 绑定 TrackTarget(node + property),property 字面量类型
//   不包含 morph influence。这里用轻量 MorphTargetTrack 直接写 MorphTargets,
//   避免 KeyframeTrack / Object3D 的反向依赖。

import { MorphTargets } from './MorphTargets';

/** 单个形变目标的标量轨道(times 升序秒 + values 权重,线性插值)。 */
export class MorphTargetTrack {
  name: string;
  times: Float32Array;
  values: Float32Array;

  constructor(name: string, times: ArrayLike<number>, values: ArrayLike<number>) {
    this.name = name;
    this.times = Float32Array.from(times);
    this.values = Float32Array.from(values);
    if (this.times.length !== this.values.length) {
      throw new Error(
        `MorphTargetTrack("${name}"): times.length (${this.times.length}) must equal values.length (${this.values.length})`,
      );
    }
  }

  /** 在 time 处采样,返回线性插值后的权重。time 超出范围则 clamp 到首/末值。 */
  sample(time: number): number {
    const n = this.times.length;
    if (n === 0) return 0;
    if (n === 1) return this.values[0];
    if (time <= this.times[0]) return this.values[0];
    if (time >= this.times[n - 1]) return this.values[n - 1];
    // 二分查找 [t0, t1]
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= time) lo = mid;
      else hi = mid;
    }
    const t0 = this.times[lo];
    const t1 = this.times[hi];
    const alpha = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
    return this.values[lo] * (1 - alpha) + this.values[hi] * alpha;
  }
}

export class MorphTargetAnimation {
  /** 被驱动的 MorphTargets(必须已添加同名目标)。 */
  morphTargets: MorphTargets;
  /** 形变目标名 → 轨道。 */
  tracks: Map<string, MorphTargetTrack> = new Map();
  /** 当前播放时间(秒)。 */
  time: number = 0;
  /** 总时长(秒);update 超过此值时停止 / 循环。 */
  duration: number = 0;
  /** 是否在播放。 */
  isPlaying: boolean = false;
  /** 循环模式。 */
  loop: 'once' | 'repeat' = 'once';
  /** 播放速率(1 = 实时)。 */
  timeScale: number = 1;

  constructor(morphTargets: MorphTargets, duration: number = 0) {
    this.morphTargets = morphTargets;
    this.duration = duration;
  }

  /** 添加轨道。轨道名应与 MorphTargets 中的目标名对应。
   *  轨道时长自动扩展 duration(取 times 最后一个值与当前 duration 的最大值)。 */
  addTrack(name: string, times: ArrayLike<number>, values: ArrayLike<number>): this {
    const track = new MorphTargetTrack(name, times, values);
    this.tracks.set(name, track);
    const trackDur = times.length > 0 ? times[times.length - 1] : 0;
    if (trackDur > this.duration) this.duration = trackDur;
    return this;
  }

  /** 开始播放(不重置 time)。 */
  play(): this {
    this.isPlaying = true;
    return this;
  }

  /** 停止播放(不重置 time)。 */
  stop(): this {
    this.isPlaying = false;
    return this;
  }

  /** 重置 time 为 0,清除所有 influence。 */
  reset(): this {
    this.time = 0;
    this.morphTargets.resetInfluences();
    return this;
  }

  /** 推进时间并采样所有轨道,写回 morphTargets.influence。
   *  返回 this.isPlaying(loop=once 且到达 duration 时会自动停止)。 */
  update(dt: number): boolean {
    if (!this.isPlaying) return false;
    let t = this.time + this.timeScale * dt;
    const d = this.duration;
    if (this.loop === 'once' && d > 0 && t >= d) {
      t = d;
      this.isPlaying = false;
    } else if (this.loop === 'repeat' && d > 0) {
      t = ((t % d) + d) % d;
    }
    this.time = t;

    // 采样每条轨道并写回对应 influence。
    for (const [name, track] of this.tracks) {
      const w = track.sample(t);
      this.morphTargets.setMorphInfluence(name, w);
    }
    return this.isPlaying;
  }

  /** 应用当前 time 的采样结果到 geometry(等价于先 update(0) 再 applyToGeometry)。
   *  常用于跳转播放头 / 单帧预览。 */
  applyToGeometry(geometry: import('./BufferGeometry').BufferGeometry): void {
    for (const [name, track] of this.tracks) {
      this.morphTargets.setMorphInfluence(name, track.sample(this.time));
    }
    this.morphTargets.applyToGeometry(geometry);
  }
}
