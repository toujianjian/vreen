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
  // IK subsystem (IKBone-based, lower-level)
  IKBone,
  IKChain,
  IKSolver,
  CCDSolver,
  IKHumanoid,
  // IKSystem (Object3D-based, higher-level)
  IKSystem,
  // ProceduralAnimation — 程序化动画系统 (步态生成/头部追踪/二次运动/呼吸/待机摇摆)
  ProceduralAnimation,
  type IKConstraint as IKConstraintBase,
  // ASM types — renamed to avoid conflict with ECS AnimState class
  type AnimState as AnimStateNode,
  type AnimTransition,
  type TransitionCondition,
  type BlendTree,
  type BlendNode,
  type AnimStateMachineGraph,
  type IKChainConfig,
  type IKConstraint,
  type LoopMode,
  type InterpMode,
  type TrackTarget,
  type JointConstraint,
  type IKChainOptions,
  type IKSolverOptions,
  type Side,
  type HumanoidRestPose,
  type ProceduralNodeType,
  type ProceduralNode,
  type ProceduralAnimationStats,
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
  type EmitterColor,
  type EmitterParticle,
  type EmitterShape,
  type EmitterShapeType,
  type EmissionShapeType,
  type ShapeParams,
  type ParticleBurst,
  type MinMaxRange,
  type TrailColorMode,
  type TrailRenderData,
  type ParticleSystemRenderData,
  type SpawnDefaults,
} from './Particles';
export {
  Profiler,
  Profiler2,
  FrameProfiler,
  SystemProfiler,
  MemoryTracker,
  GpuProfiler,
  PerformanceReport,
  LODManager,
  type FrameSample,
  type ProfilerMark,
  type DrawCallSample,
  type ProfileCategory,
  type ProfileEvent,
  type ProfileZone,
  type ProfilerMemoryUsage,
  type Profiler2Options,
  type ProfilerStats,
  type ChromeTraceEvent,
  type ChromeTrace,
  type FrameMetrics,
  type FrameStats,
  type SystemTiming,
  type AllocationRecord,
  type MemorySummary,
  type GpuQuery,
  type PerformanceReportJson,
  type LODGroup,
  type LODLevel,
  type LODStats,
} from './Tools';
export { runEcsDemo, runEcsDemoSilent, type EcsDemoSummary } from './ecsDemo';
// Network — 网络同步基础 (传输抽象 + 快照序列化 + 插值/预测 + 同步管理器)。
export * from './Network';
// Input — 输入系统 (键盘/鼠标/触摸/手柄 统一管理 + 动作映射 + JSON 配置)。
export * from './Input';
// AI — AI 导航系统 (NavMesh 导航网格 + A* 寻路 + Reynolds 转向行为 + Agent 代理)。
export * from './AI';
// Environment — 环境系统 (天气系统 + 天空系统/日夜循环 + 云系统 + 降水系统)。
export * from './Environment';
// Timeline — 时间轴 / Sequencer 系统 (TimelineClip + TimelineTrack + EventTrack + PropertyTrack + TimelineSequencer)。
// 多轨道编排:动画片段 / 事件触发 / 属性关键帧,支持 play/pause/seek/loop/export/import。
export * from './Timeline';
// Voxel — 体素系统 (VoxelChunk 16³ + VoxelWorld 多块管理 + VoxelMesher 贪婪网格合并 + VoxelRaycaster DDA + VoxelPalette 类型表)。
export * from './Voxel';
// Editor — 编辑器系统 (SelectionSystem 选择/拾取 + TransformGizmo 变换手柄 + UndoRedoSystem 撤销重做 + EditorCommands 命令工厂 + SnapSystem 吸附)。
export * from './Editor';
// PCG — 程序化内容生成 (NoiseGenerator 噪声 + BuildingGenerator 建筑 + CityGenerator 城市 + DungeonGenerator 地牢 + TreeGenerator 树木)。
// 多种 PRG 生成器,产出 BufferGeometry / 网格 / 布局元数据,不绑定 Material / Scene。
export * from './PCG';
// Pipeline — 资源管线 (AssetPipeline 步骤序列 + TextureProcessor 纹理处理 + GeometryProcessor 几何体处理 + ImportPipeline 模型导入)。
// 与 Loaders/AssetManager 互补:Loaders 关注解析,Pipeline 关注处理与优化。
export * from './Pipeline';
// Gameplay — 游戏玩法系统 (DialogueSystem 对话 + DialogueTree 对话树 + DialogueParticipant 参与者 + QuestSystem 任务 + InventorySystem 物品栏)。
// 与 Events/Scripting 互补,提供 RPG/NPC 玩法层。
export * from './Gameplay';
