// Engine barrel — single import surface for the new WebGL2 engine.
//
// 注意：AnimationStateMachine 里的 `type AnimState` (状态节点) 跟
// ECS Components 里的 `class AnimState` (ECS 组件) 同名。
// 在 barrel 显式 re-export 并把 type 改名为 `AnimStateNode`，避免冲突。
// 直接 from './Animation' / './ECS' 子 barrel 仍保留原名。

export * from './Math';
export * from './Core';
export * from './Cameras';
export * from './Controls';
export * from './Lights';
export * from './Materials';
export * from './Geometries';
export * from './Loaders';
export * from './Renderer';
export * from './Helpers';
export {
  KeyframeTrack,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
  AnimationClip,
  AnimationAction,
  AnimationMixer,
  AnimationStateMachine,
  buildHumanoid,
  type LoopMode,
  type InterpMode,
  type TrackTarget,
  type AnimMachineState as AnimStateNode,
  type AnimTransition,
} from './Animation';
export * from './ECS';
export { Profiler, type FrameSample, type ProfilerMark, type DrawCallSample } from './Tools/Profiler';
export { runEcsDemo, runEcsDemoSilent, type EcsDemoSummary } from './ecsDemo';
