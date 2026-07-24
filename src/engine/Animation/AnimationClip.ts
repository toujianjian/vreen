// AnimationClip — a named collection of KeyframeTracks with a total
// duration. Tracks reference Object3D nodes by name (UUID).
//
// The binding step (called by AnimationMixer before the first frame)
// walks a target root and looks up nodes by `name`. The first matching
// node is bound; collisions are warned about.
//
// Events: clip.events is a list of {time, name, payload} sorted by time.
// AnimationAction detects when the playhead crosses an event time during
// update() and fires registered callbacks. Used for "foot step" audio,
// VFX triggers, gameplay hits, etc.

import { KeyframeTrack, TrackTarget } from './KeyframeTrack';
import { Object3D } from '../Core/Object3D';

/** 动画事件:在 clip 的某个时间点触发的命名事件。
 *  典型用例:脚落地音效(0.2s, 0.7s)、攻击命中(0.5s)、特效 spawn(0.3s)。 */
export interface AnimationEvent {
  /** 触发时间(秒,clip 本地时间)。 */
  time: number;
  /** 事件名(如 'footstep', 'hit', 'spawn_vfx')。 */
  name: string;
  /** 可选负载(任意数据,传给回调)。 */
  payload?: unknown;
}

export class AnimationClip {
  name: string;
  duration: number;
  tracks: KeyframeTrack[] = [];
  /** 动画事件列表(按 time 升序)。AnimationAction.update 检测穿越时触发。 */
  events: AnimationEvent[] = [];

  constructor(name: string, duration: number, tracks: KeyframeTrack[] = []) {
    this.name = name;
    this.duration = duration;
    this.tracks = tracks;
  }

  /** 添加一个事件。会按 time 升序保持排序。
   *  同一时间多个事件按添加顺序触发。 */
  addEvent(event: AnimationEvent): this {
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
    return this;
  }

  /** 便捷批量添加。 */
  addEvents(events: AnimationEvent[]): this {
    for (const e of events) this.events.push(e);
    this.events.sort((a, b) => a.time - b.time);
    return this;
  }

  /** Bind tracks to concrete nodes under `root`. Each track's name is
   *  parsed as "<nodeName>.<property>" and looked up in the root's
   *  descendants. */
  bind(root: Object3D): void {
    for (const track of this.tracks) {
      const dot = track.name.lastIndexOf('.');
      if (dot < 0) continue;
      const nodeName = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1) as TrackTarget['property'];
      const node = root.getObjectByName(nodeName);
      if (!node) continue;
      track.target = { node, property };
    }
  }
}
