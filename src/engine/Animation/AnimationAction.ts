// AnimationAction — a playing instance of an AnimationClip, with
// playback controls (play, pause, stop, loop, timeScale, weight).
//
// The action's "effective time" is the clip's local time, advanced by
// `timeScale` * `dt`. When `loop` is true, the effective time wraps
// into [0, duration]; when false, it clamps to duration.
//
// Events: when the playhead crosses an event time during update(), the
// action fires registered callbacks. Wrap-around (loop) correctly fires
// events in both the tail [prevTime, duration] and head [0, newTime].

import { AnimationClip, type AnimationEvent } from './AnimationClip';

export type LoopMode = 'once' | 'repeat' | 'pingpong';

/** 事件回调签名。 */
export type AnimationEventCallback = (event: AnimationEvent, action: AnimationAction) => void;

export class AnimationAction {
  clip: AnimationClip;
  timeScale: number = 1;
  weight: number = 1;
  loop: LoopMode = 'repeat';
  /** Current play time (seconds). */
  time: number = 0;
  isPlaying: boolean = false;
  /** Set by Mixer after bind; resolves clip tracks to nodes. */
  isBound: boolean = false;
  /** 事件回调:按事件名注册。'*' = 通配,接收所有事件。 */
  private eventCallbacks: Map<string, AnimationEventCallback[]> = new Map();

  constructor(clip: AnimationClip) {
    this.clip = clip;
  }

  play(): this {
    this.isPlaying = true;
    return this;
  }

  pause(): this {
    this.isPlaying = false;
    return this;
  }

  stop(): this {
    this.isPlaying = false;
    this.time = 0;
    return this;
  }

  reset(): this {
    this.time = 0;
    return this;
  }

  /** 解绑 action 自身:停止播放、重置时间、清空事件回调。
   *  由 Mixer.uncacheAction 调用。track.target 的清理在
   *  AnimationClip.unbind(一个 clip 可能被多个 action 引用,分两层解绑)。 */
  unbind(): this {
    this.isPlaying = false;
    this.time = 0;
    this.isBound = false;
    this.eventCallbacks.clear();
    return this;
  }

  /** 注册事件回调。
   *  - name:事件名;'*' = 通配(接收所有事件)
   *  - 返回一个 unsubscribe 函数 */
  onEvent(name: string, cb: AnimationEventCallback): () => void {
    let arr = this.eventCallbacks.get(name);
    if (!arr) { arr = []; this.eventCallbacks.set(name, arr); }
    arr.push(cb);
    return () => {
      const list = this.eventCallbacks.get(name);
      if (!list) return;
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) this.eventCallbacks.delete(name);
    };
  }

  /** 移除某事件名的所有回调(或所有事件的所有回调,若 name 为 undefined)。 */
  offEvent(name?: string): void {
    if (name === undefined) this.eventCallbacks.clear();
    else this.eventCallbacks.delete(name);
  }

  /** Advance the playhead by `dt` seconds and apply the clip. */
  update(dt: number): void {
    if (!this.isPlaying) return;
    const prevTime = this.time;
    let t = prevTime + this.timeScale * dt;
    const d = this.clip.duration;
    let wrapped = false;
    if (this.loop === 'once') {
      if (t >= d) {
        t = d;
        this.isPlaying = false;
      }
    } else if (this.loop === 'repeat') {
      if (d > 0) {
        // 检测 wrap:原始时间(未取模前)≥ duration 表示穿越了边界
        if (t >= d) wrapped = true;
        t = ((t % d) + d) % d;
      }
    } else if (this.loop === 'pingpong') {
      if (d > 0) {
        const period = 2 * d;
        const phase = ((t % period) + period) % period;
        if (phase > d) {
          t = period - phase;
        } else {
          t = phase;
        }
        // pingpong 在反弹点(boundary)不触发 wrap 事件(简化处理)
      }
    }
    this.time = t;

    // 检测事件穿越(prevTime → t)
    // 注意:e.time > prevTime 是严格大于,所以 time=0 的事件在 prevTime=0 时不会触发
    if (this.clip.events.length > 0) {
      this.fireEvents(prevTime, t, wrapped, d);
    }

    for (const track of this.clip.tracks) track.apply(this.time);
  }

  /** 检测 [prevTime, newTime] 区间(或 wrap 后的两段)内的事件并触发回调。 */
  private fireEvents(prevTime: number, newTime: number, wrapped: boolean, duration: number): void {
    const events = this.clip.events;
    if (events.length === 0) return;

    const fire = (e: AnimationEvent): void => {
      const cbs = this.eventCallbacks.get(e.name);
      if (cbs) for (const cb of cbs) cb(e, this);
      const wildcard = this.eventCallbacks.get('*');
      if (wildcard) for (const cb of wildcard) cb(e, this);
    };

    if (!wrapped) {
      // 普通前进:[prevTime, newTime]
      // 用线性扫描(events 已按 time 升序)
      for (const e of events) {
        if (e.time > prevTime && e.time <= newTime) fire(e);
        else if (e.time > newTime) break;
      }
    } else {
      // wrap:两段 [prevTime, duration] 和 [0, newTime]
      for (const e of events) {
        if (e.time > prevTime && e.time <= duration) fire(e);
        else if (e.time > duration) break;
      }
      for (const e of events) {
        if (e.time <= newTime) fire(e);
        else break;
      }
    }
  }
}
