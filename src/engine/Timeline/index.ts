// Timeline barrel — 时间轴 / Sequencer 系统统一导出。
//
// 模块组成:
//   - TimelineClip       时间轴片段 (start/duration/data/blendMode/speed)
//   - TimelineTrack      通用轨道 (持有 TimelineClip[],基于片段)
//   - EventTrack         事件轨道 (基于 TimedEvent[],在时间点触发 EventBus 事件)
//   - PropertyTrack      属性轨道 (基于 Keyframe[],动画化 target.propertyPath)
//   - TimelineSequencer  序列器 (聚合三类轨道,play/pause/stop/seek/update/export/import)

export {
  TimelineClip,
  type TimelineClipBlendMode,
  type TimelineClipOptions,
} from './TimelineClip';

export {
  TimelineTrack,
  createClips,
  type TimelineTrackType,
  type TimelineTrackOptions,
} from './TimelineTrack';

export {
  EventTrack,
  type TimedEvent,
  type EventTrackOptions,
} from './EventTrack';

export {
  PropertyTrack,
  type Keyframe,
  type PropertyInterp,
  type PropertyTrackOptions,
} from './PropertyTrack';

export {
  TimelineSequencer,
  type TimelineSequencerOptions,
  type TimelineSequencerJSON,
  type TrackLike,
} from './TimelineSequencer';
