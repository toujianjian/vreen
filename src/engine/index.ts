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
export * from './Audio';
export * from './Renderer';
export * from './Helpers';
export * from './Terrain';
export * from './Acceleration';
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
  // IK subsystem
  IKBone,
  IKChain,
  IKSolver,
  CCDSolver,
  IKHumanoid,
  type LoopMode,
  type InterpMode,
  type TrackTarget,
  type AnimMachineState as AnimStateNode,
  type AnimTransition,
  type JointConstraint,
  type IKChainOptions,
  type IKSolverOptions,
  type Side,
  type HumanoidRestPose,
} from './Animation';
export * from './ECS';
export * from './Physics';
export * from './Events';
export * from './Scripting';
// Particles — 高级 CPU 粒子系统。ParticleEmitter 与 ECS 中的同名组件冲突,
// 这里以 AdvancedParticleEmitter 别名导出。其余类原名导出。
export {
  ParticleSystem2,
  ParticleData,
  ParticleEmitter as AdvancedParticleEmitter,
  ForceFieldModifier,
  VortexModifier,
  TurbulenceModifier,
  ColorOverLifeModifier,
  SizeOverLifeModifier,
  VelocityOverLifeModifier,
  SubEmittersModifier,
  ParticleModifier,
  ConstantCurve,
  LinearCurve,
  BezierCurve,
  RandomCurve,
  TrailModule,
  type ParticleCurve,
  type EmitterShape,
  type EmitterShapeType,
  type ParticleBurst,
  type MinMaxRange,
  type TrailColorMode,
  type TrailRenderData,
  type ParticleSystemRenderData,
  type SpawnDefaults,
} from './Particles';
export {
  Profiler,
  FrameProfiler,
  SystemProfiler,
  MemoryTracker,
  GpuProfiler,
  PerformanceReport,
  type FrameSample,
  type ProfilerMark,
  type DrawCallSample,
  type FrameMetrics,
  type FrameStats,
  type SystemTiming,
  type AllocationRecord,
  type MemorySummary,
  type GpuQuery,
  type PerformanceReportJson,
} from './Tools';
export { runEcsDemo, runEcsDemoSilent, type EcsDemoSummary } from './ecsDemo';
