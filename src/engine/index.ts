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
// Assets — 资源管理 (AssetCache LRU / AssetRegistry 引用计数 / AssetLoader 异步加载)。
// 与 Loaders/AssetManager 互补：AssetManager 关注 Promise 缓存；Assets 关注实例生命周期。
export * from './Assets';
// Serialization — 场景序列化 (Scene/Geometry/Material ↔ JSON)，支持往返还原。
export * from './Serialization';
// SaveSystem — 多槽位存档系统 + 自动保存 + 持久化适配器 (localStorage / 内存)。
export * from './SaveSystem';
// SceneManager — 多场景注册 / 加载 / 切换 + 场景过渡 (Fade/Crossfade/Slide/Wipe/None)。
export * from './SceneManager';
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
// Network — 网络同步基础 (传输抽象 + 快照序列化 + 插值/预测 + 同步管理器)。
export * from './Network';
// Input — 输入系统 (键盘/鼠标/触摸/手柄 统一管理 + 动作映射 + JSON 配置)。
export * from './Input';
