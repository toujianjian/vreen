// TimelineClip — 时间轴上的一个片段。
//
// 设计原则:
//   - 片段是时间轴的最小调度单元:由 start/duration 决定占据的时间窗口,
//     speed 决定内部时间流逝速率,blendMode 决定与同轨其他片段的混合方式。
//   - contains(time) 判定时间点是否落在片段窗口内 (左闭右开 [start, start+duration))。
//   - getLocalTime(time) 把全局时间换算为片段本地时间 (考虑 speed 与 clamp),
//     返回值范围 [0, duration]。
//   - clone() 深拷贝 (data 字段做浅拷贝,调用方负责深拷贝复杂负载)。
//
// 不变量:
//   - start >= 0;duration > 0;speed > 0。构造时不强制,但 update/getLocalTime
//     对非法值会退化为 0 处理。
//   - data 可为任意结构 (AnimationClip 引用、事件负载、音频 buffer 等),由
//     消费方解释。TimelineClip 本身不解释 data。
export type TimelineClipBlendMode = 'none' | 'crossfade' | 'mix' | 'additive';

export interface TimelineClipOptions {
  /** 片段在时间轴上的起始时间(秒)。 */
  start: number;
  /** 片段持续时间(秒)。 */
  duration: number;
  /** 片段名 (诊断用)。 */
  name?: string;
  /** 片段负载 (AnimationClip / 事件 / 音频 buffer 等),由消费方解释。 */
  data?: unknown;
  /** 混合模式 (默认 'none')。 */
  blendMode?: TimelineClipBlendMode;
  /** 播放速度倍数 (默认 1)。 */
  speed?: number;
}

export class TimelineClip {
  start: number;
  duration: number;
  name: string;
  data: unknown;
  blendMode: TimelineClipBlendMode;
  speed: number;

  constructor(opts: TimelineClipOptions) {
    this.start = opts.start;
    this.duration = opts.duration;
    this.name = opts.name ?? '';
    this.data = opts.data;
    this.blendMode = opts.blendMode ?? 'none';
    this.speed = opts.speed ?? 1;
  }

  /** 片段的结束时间 (start + duration)。 */
  get end(): number {
    return this.start + this.duration;
  }

  /** 判定时间点是否落在片段窗口内 [start, end)。
   *  左闭右开便于相邻片段不重叠触发。 */
  contains(time: number): boolean {
    return time >= this.start && time < this.end;
  }

  /** 把全局时间换算为片段本地时间。
   *  - 若 time < start,返回 0 (片段尚未开始);
   *  - 若 time >= end,返回 duration (片段已结束);
   *  - 否则返回 (time - start) * speed,clamp 到 [0, duration]。
   *  speed <= 0 时退化为 1 处理。 */
  getLocalTime(time: number): number {
    if (time <= this.start) return 0;
    if (time >= this.end) return this.duration;
    const s = this.speed > 0 ? this.speed : 1;
    const local = (time - this.start) * s;
    return local < 0 ? 0 : local > this.duration ? this.duration : local;
  }

  /** 浅拷贝 (data 字段按引用共享,调用方负责深拷贝负载)。 */
  clone(): TimelineClip {
    return new TimelineClip({
      start: this.start,
      duration: this.duration,
      name: this.name,
      data: this.data,
      blendMode: this.blendMode,
      speed: this.speed,
    });
  }

  /** 序列化为 JSON (用于 TimelineSequencer.export)。 */
  toJSON(): TimelineClipOptions & { end: number } {
    return {
      start: this.start,
      duration: this.duration,
      name: this.name,
      data: this.data,
      blendMode: this.blendMode,
      speed: this.speed,
      end: this.end,
    };
  }
}
