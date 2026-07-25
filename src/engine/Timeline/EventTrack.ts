// EventTrack — 事件轨道,在特定时间触发命名事件。
//
// 设计原则:
//   - 与 TimelineTrack (基于片段) 不同,EventTrack 基于离散时间点的事件列表;
//   - trigger(time, lastTime, bus) 检测 [lastTime, time] 区间内被穿越的事件,
//     通过 EventBus 触发对应事件名;
//   - 用于剧情触发、音效 cue、特效 spawn、关卡切换等"瞬时事件"。
//
// 不变量:
//   - events 按 time 升序保持排序 (addEvent 后自动排序);
//   - 同一时间多个事件按添加顺序触发;
//   - trigger 检测区间为 (lastTime, time] (左开右闭),避免边界重复触发;
//   - 当 lastTime > time (循环回绕) 时,触发 [lastTime, +∞) 与 [0, time] 两段。
import type { EventBus } from '../Events/EventBus';

/** 时间锚定事件。 */
export interface TimedEvent {
  /** 触发时间(秒,时间轴本地时间)。 */
  time: number;
  /** 事件名 (作为 EventBus 的 topic)。 */
  eventName: string;
  /** 可选负载 (传给监听器)。 */
  data?: unknown;
}

export interface EventTrackOptions {
  name: string;
  events?: TimedEvent[];
  enabled?: boolean;
  locked?: boolean;
}

export class EventTrack {
  name: string;
  events: TimedEvent[];
  enabled: boolean;
  locked: boolean;

  constructor(opts: EventTrackOptions) {
    if (!opts.name) throw new Error('EventTrack: name must be non-empty');
    this.name = opts.name;
    this.events = opts.events ?? [];
    this.enabled = opts.enabled ?? true;
    this.locked = opts.locked ?? false;
    this.events.sort((a, b) => a.time - b.time);
  }

  /** 添加事件并保持按 time 升序。 */
  addEvent(event: TimedEvent): this {
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
    return this;
  }

  /** 移除指定事件 (按引用)。返回是否成功移除。 */
  removeEvent(event: TimedEvent): boolean {
    const idx = this.events.indexOf(event);
    if (idx === -1) return false;
    this.events.splice(idx, 1);
    return true;
  }

  /** 按事件名移除 (同名全部移除)。返回移除的数量。 */
  removeEventByName(eventName: string): number {
    let removed = 0;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].eventName === eventName) {
        this.events.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  /** 返回 (lastTime, time] 区间内被穿越的事件列表 (左开右闭,避免边界重复触发)。
   *  支持循环回绕 (lastTime > time 时分两段检测):
   *    - 第一段 (lastTime, +∞): 时间轴尾部尚未触发的事件;
   *    - 第二段 [0, time]: 时间轴头部回绕后的事件。
   *  回绕时按时间顺序先返回第一段,再返回第二段 (与播放头穿越顺序一致)。 */
  getEventsBetween(lastTime: number, time: number): TimedEvent[] {
    const out: TimedEvent[] = [];
    if (lastTime > time) {
      // 回绕:先收集第一段 (lastTime, +∞),再收集第二段 [0, time]
      for (const e of this.events) {
        if (e.time > lastTime) out.push(e);
      }
      for (const e of this.events) {
        if (e.time <= time) out.push(e);
      }
    } else {
      for (const e of this.events) {
        if (e.time > lastTime && e.time <= time) out.push(e);
      }
    }
    return out;
  }

  /** 检测 [lastTime, time] 区间内的事件并经 EventBus 触发。
   *  事件名作为 EventBus topic;data 作为唯一参数透传给监听器。
   *  若 bus 为 null/undefined 或 enabled=false,直接返回 0。
   *  返回实际触发的事件数量。 */
  trigger(time: number, lastTime: number, bus: EventBus | null): number {
    if (!this.enabled || !bus) return 0;
    const events = this.getEventsBetween(lastTime, time);
    for (const e of events) {
      bus.emit(e.eventName, e.data);
    }
    return events.length;
  }

  /** 轨道总时长 (最后一个事件的 time;空轨道为 0)。 */
  getDuration(): number {
    if (this.events.length === 0) return 0;
    return this.events[this.events.length - 1].time;
  }

  /** 推进轨道:trigger 当前区间的事件。
   *  Sequencer 在 update 中调用此方法,传入 lastTime 与 bus。 */
  update(time: number, lastTime: number, bus: EventBus | null): void {
    this.trigger(time, lastTime, bus);
  }

  /** 序列化为 JSON。 */
  toJSON(): {
    name: string;
    kind: 'event';
    enabled: boolean;
    locked: boolean;
    events: TimedEvent[];
  } {
    return {
      name: this.name,
      kind: 'event',
      enabled: this.enabled,
      locked: this.locked,
      events: this.events.map((e) => ({ ...e })),
    };
  }
}
