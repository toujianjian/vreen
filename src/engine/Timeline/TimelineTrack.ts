// TimelineTrack — 时间轴轨道,持有 TimelineClip 列表。
//
// 设计原则:
//   - 轨道是片段的容器,负责片段的增删与按时间检索;
//   - enabled=false 时轨道被跳过 (静音/隐藏),locked=true 时禁止编辑 (UI 提示);
//   - update(time, dt) 推进轨道:遍历 clips,对当前活跃的片段调用其 data 上
//     的 update (若 data 实现了 update 接口)。
//
// 轨道类型:
//   - 'animation' — 通用动画片段 (data 持有 AnimationClip / AnimationAction)
//   - 'event'     — 事件型轨道 (建议使用 EventTrack 而非此类型)
//   - 'audio'     — 音频片段 (data 持有 Audio / AudioBuffer)
//   - 'property'  — 属性动画 (建议使用 PropertyTrack)
//
// 不变量:
//   - clips 按 start 升序保持排序 (addClip 后自动排序)。
//   - 同一时间可以有多个片段重叠 (允许,混合由消费方处理)。
//   - getClipsAtTime 返回所有包含 time 的片段 (可能为空数组)。
import { TimelineClip, type TimelineClipOptions } from './TimelineClip';

export type TimelineTrackType = 'animation' | 'event' | 'audio' | 'property';

export interface TimelineTrackOptions {
  name: string;
  type?: TimelineTrackType;
  clips?: TimelineClip[];
  enabled?: boolean;
  locked?: boolean;
}

export class TimelineTrack {
  name: string;
  type: TimelineTrackType;
  clips: TimelineClip[];
  enabled: boolean;
  locked: boolean;

  constructor(opts: TimelineTrackOptions) {
    if (!opts.name) throw new Error('TimelineTrack: name must be non-empty');
    this.name = opts.name;
    this.type = opts.type ?? 'animation';
    this.clips = opts.clips ?? [];
    this.enabled = opts.enabled ?? true;
    this.locked = opts.locked ?? false;
    // 保持升序
    this.clips.sort((a, b) => a.start - b.start);
  }

  /** 添加片段并保持按 start 升序。 */
  addClip(clip: TimelineClip): this {
    this.clips.push(clip);
    this.clips.sort((a, b) => a.start - b.start);
    return this;
  }

  /** 移除指定片段 (按引用)。返回是否成功移除。 */
  removeClip(clip: TimelineClip): boolean {
    const idx = this.clips.indexOf(clip);
    if (idx === -1) return false;
    this.clips.splice(idx, 1);
    return true;
  }

  /** 按名称移除片段 (同名全部移除)。返回移除的数量。 */
  removeClipByName(name: string): number {
    let removed = 0;
    for (let i = this.clips.length - 1; i >= 0; i--) {
      if (this.clips[i].name === name) {
        this.clips.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  /** 返回所有包含 time 的片段 (可能为空)。 */
  getClipsAtTime(time: number): TimelineClip[] {
    return this.clips.filter((c) => c.contains(time));
  }

  /** 轨道总时长 (最后一个片段的 end;空轨道为 0)。 */
  getDuration(): number {
    let end = 0;
    for (const c of this.clips) {
      const e = c.end;
      if (e > end) end = e;
    }
    return end;
  }

  /** 推进轨道:遍历所有活跃片段,若 data 实现了 update(localTime, dt) 接口
   *  则调用之。非活跃片段的 data 不被调用。
   *  enabled=false 时直接返回。 */
  update(time: number, dt: number): void {
    if (!this.enabled) return;
    for (const clip of this.clips) {
      if (!clip.contains(time)) continue;
      const localTime = clip.getLocalTime(time);
      const data = clip.data as
        | { update?: (localTime: number, dt: number) => void }
        | null
        | undefined;
      if (data && typeof data.update === 'function') {
        data.update(localTime, dt);
      }
    }
  }

  /** 序列化为 JSON (用于 TimelineSequencer.export)。 */
  toJSON(): {
    name: string;
    type: TimelineTrackType;
    enabled: boolean;
    locked: boolean;
    clips: ReturnType<TimelineClip['toJSON']>[];
  } {
    return {
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      locked: this.locked,
      clips: this.clips.map((c) => c.toJSON()),
    };
  }
}

/** 便捷工厂:从选项数组构造 clips。 */
export function createClips(opts: TimelineClipOptions[]): TimelineClip[] {
  return opts.map((o) => new TimelineClip(o));
}
