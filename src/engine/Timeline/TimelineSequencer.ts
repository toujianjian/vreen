// TimelineSequencer — 时间轴序列器,管理多条轨道并按时间推进。
//
// 设计原则:
//   - 聚合 TimelineTrack / EventTrack / PropertyTrack 三类轨道;
//   - 提供播放控制 (play/pause/stop/seek) 与每帧 update(dt);
//   - 支持循环 (loop=true 时到达 duration 后回绕到 0);
//   - 支持倍速 (speed 全局缩放 dt);
//   - 提供 export/import JSON 用于持久化。
//
// 轨道类型聚合:
//   三类轨道共享 name / enabled / locked / getDuration / update 接口,
//   通过 TrackLike 联合类型聚合。Sequencer 不关心具体类型,只调用 update。
//
// 不变量:
//   - time ∈ [0, duration];seek 超出范围会被 clamp;
//   - isPlaying=false 时 update 不推进 time (但仍调用 track.update 以便静默刷新);
//     实际上 isPlaying=false 时 update 直接返回,不更新任何轨道;
//   - 循环回绕时,lastTime > time,EventTrack 会触发两段事件。
//
// 与 AnimationMixer 的关系:
//   - AnimationMixer 关注骨骼动画混合,粒度细 (per-action);
//   - TimelineSequencer 关注多类型轨道编排,粒度粗 (per-track);
//   - 可嵌套使用:TimelineTrack.data 持有 AnimationAction,update 时调用 action.update(localTime)。
import { TimelineTrack } from './TimelineTrack';
import { EventTrack } from './EventTrack';
import { PropertyTrack } from './PropertyTrack';
import type { EventBus } from '../Events/EventBus';
import { createLogger } from '@/lib/logger';

const log = createLogger('Timeline.Sequencer');

/** Sequencer 接受的轨道类型联合。 */
export type TrackLike = TimelineTrack | EventTrack | PropertyTrack;

/** Sequencer 序列化格式。 */
export interface TimelineSequencerJSON {
  version: string;
  time: number;
  duration: number;
  loop: boolean;
  speed: number;
  tracks: unknown[];
}

export interface TimelineSequencerOptions {
  duration?: number;
  loop?: boolean;
  speed?: number;
  eventBus?: EventBus | null;
}

export class TimelineSequencer {
  /** 轨道列表 (按添加顺序)。 */
  tracks: TrackLike[] = [];
  /** 当前播放头时间(秒)。 */
  time: number = 0;
  /** 序列器总时长 (秒)。0 表示由轨道自动计算。 */
  duration: number;
  /** 是否正在播放。 */
  isPlaying: boolean = false;
  /** 是否循环。 */
  loop: boolean;
  /** 全局倍速 (dt * speed 推进 time)。 */
  speed: number;
  /** EventBus 用于 EventTrack 触发。可为 null (EventTrack 静默)。 */
  eventBus: EventBus | null;

  /** 上一帧的 time (用于 EventTrack 区间检测 / 外部查询播放头变化)。
   *  每次 update / seek 后同步更新。 */
  lastTime: number = 0;

  constructor(opts: TimelineSequencerOptions = {}) {
    this.duration = opts.duration ?? 0;
    this.loop = opts.loop ?? false;
    this.speed = opts.speed ?? 1;
    this.eventBus = opts.eventBus ?? null;
  }

  /** 设置 / 替换 EventBus。 */
  setEventBus(bus: EventBus | null): this {
    this.eventBus = bus;
    return this;
  }

  /** 播放 (从当前 time 继续;若已到 duration 且非 loop,先 seek(0))。 */
  play(): this {
    if (!this.loop && this.duration > 0 && this.time >= this.duration) {
      this.seek(0);
    }
    this.isPlaying = true;
    log.info(`play — time=${this.time.toFixed(3)}s`);
    return this;
  }

  /** 暂停 (保持 time 不变)。 */
  pause(): this {
    if (!this.isPlaying) return this;
    this.isPlaying = false;
    log.info(`pause — time=${this.time.toFixed(3)}s`);
    return this;
  }

  /** 停止 (暂停并 seek(0))。 */
  stop(): this {
    this.isPlaying = false;
    this.seek(0);
    log.info('stop — reset to 0');
    return this;
  }

  /** 跳转到指定时间 (clamp 到 [0, duration])。
   *  seek 后 lastTime = time,避免 EventTrack 触发区间事件。 */
  seek(time: number): this {
    const t = Math.max(0, Math.min(time, this.duration));
    this.time = t;
    this.lastTime = t;
    return this;
  }

  /** 添加轨道。同名轨道允许 (UI 可按引用区分)。 */
  addTrack(track: TrackLike): this {
    this.tracks.push(track);
    // 自动扩展 duration
    const td = track.getDuration();
    if (td > this.duration) this.duration = td;
    log.info(`addTrack — "${track.name}" (track duration=${td}s)`);
    return this;
  }

  /** 按名移除轨道 (同名全部移除)。返回移除的数量。 */
  removeTrack(name: string): number {
    let removed = 0;
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      if (this.tracks[i].name === name) {
        this.tracks.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) {
      log.info(`removeTrack — "${name}" (${removed} tracks)`);
      // 重新计算 duration
      this.duration = this.computeDuration();
    }
    return removed;
  }

  /** 按名查找轨道 (返回第一个匹配)。 */
  getTrack(name: string): TrackLike | null {
    return this.tracks.find((t) => t.name === name) ?? null;
  }

  /** 计算所有轨道的最大时长 (用于自动 duration)。 */
  private computeDuration(): number {
    let max = 0;
    for (const t of this.tracks) {
      const d = t.getDuration();
      if (d > max) max = d;
    }
    return max;
  }

  /** 获取序列器总时长。
   *  若构造时显式指定 duration > 0,直接返回;
   *  否则取所有轨道最大时长。 */
  getDuration(): number {
    const computed = this.computeDuration();
    return Math.max(this.duration, computed);
  }

  /** 每帧推进。调用方应在主循环中调用 update(dt)。
   *  - isPlaying=false 时直接返回;
   *  - time += dt * speed;
   *  - loop=true:超过 duration 后回绕 (time %= duration),触发 EventTrack 两段;
   *  - loop=false:到达 duration 后 pause,clamp time=duration。 */
  update(dt: number): void {
    if (!this.isPlaying) return;
    const scaledDt = dt * this.speed;
    const prevTime = this.time;
    let nextTime = prevTime + scaledDt;

    if (this.duration > 0) {
      if (this.loop) {
        if (nextTime >= this.duration) {
          // 回绕:下一帧 time 取模,但 lastTime 保留 prevTime
          nextTime = nextTime % this.duration;
          // 推进所有轨道 (lastTime > nextTime,EventTrack 会触发两段)
          this.time = nextTime;
          this.advanceTracks(nextTime, prevTime, scaledDt);
          this.lastTime = nextTime;
          return;
        }
      } else {
        if (nextTime >= this.duration) {
          nextTime = this.duration;
          this.time = nextTime;
          this.advanceTracks(nextTime, prevTime, scaledDt);
          this.lastTime = nextTime;
          this.isPlaying = false;
          log.info(`update — reached duration, auto-pause at ${nextTime.toFixed(3)}s`);
          return;
        }
      }
    }

    this.time = nextTime;
    this.advanceTracks(nextTime, prevTime, scaledDt);
    this.lastTime = nextTime;
  }

  /** 推进所有 enabled 轨道。 */
  private advanceTracks(time: number, lastTime: number, dt: number): void {
    for (const track of this.tracks) {
      if (!track.enabled) continue;
      if (track instanceof EventTrack) {
        track.update(time, lastTime, this.eventBus);
      } else if (track instanceof PropertyTrack) {
        track.update(time);
      } else {
        (track as TimelineTrack).update(time, dt);
      }
    }
  }

  /** 导出为 JSON (轨道按各自 toJSON 序列化)。
   *  注意:导出的 JSON 不含 target / data 等运行时引用,仅含可序列化字段。 */
  export(): TimelineSequencerJSON {
    return {
      version: '0.1.0',
      time: this.time,
      duration: this.duration,
      loop: this.loop,
      speed: this.speed,
      tracks: this.tracks.map((t) => t.toJSON()),
    };
  }

  /** 从 JSON 导入。仅恢复 time / duration / loop / speed 与轨道结构。
   *  轨道实例按 kind 字段重建:
   *   - 无 kind / kind='animation' / 'audio' → TimelineTrack
   *   - kind='event' → EventTrack
   *   - kind='property' → PropertyTrack
   *  target / data 等运行时引用需调用方在导入后重新绑定。
   *  返回 this 以便链式调用。 */
  import(json: TimelineSequencerJSON): this {
    this.time = json.time ?? 0;
    this.duration = json.duration ?? 0;
    this.loop = json.loop ?? false;
    this.speed = json.speed ?? 1;
    this.tracks = [];
    this.lastTime = this.time;
    for (const tJson of json.tracks ?? []) {
      const t = tJson as { kind?: string; name?: string };
      if (!t || !t.name) continue;
      try {
        if (t.kind === 'event') {
          this.tracks.push(new EventTrack(t as any));
        } else if (t.kind === 'property') {
          this.tracks.push(new PropertyTrack(t as any));
        } else {
          this.tracks.push(new TimelineTrack(t as any));
        }
      } catch (e) {
        log.warn(`import — failed to rebuild track "${t.name}":`, e);
      }
    }
    log.info(`import — ${this.tracks.length} tracks, duration=${this.duration}s`);
    return this;
  }
}
