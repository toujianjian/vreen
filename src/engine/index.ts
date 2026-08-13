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
// 显式重导出 LightProbe 类,解决 ./Lights (class) 与 ./Renderer (interface)
// 之间的命名冲突。显式 re-export 优先于 `export *`。
export { LightProbe, SphericalHarmonics3, AmbientLightProbe, HemisphereLightProbe } from './Lights';
export * from './Materials';
export * from './Geometries';
// Modifiers — 几何体修饰器 (TessellateModifier 细分 + SimplifyModifier 简化)。
export * from './Modifiers';
export * from './Loaders';
export * from './Audio';
export * from './Renderer';
export * from './Helpers';
export * from './Terrain';
export * from './Acceleration';
// Assets — 资源管理 (AssetCache LRU / AssetRegistry 引用计数 / AssetLoader 异步加载)。
// 与 Loaders/AssetManager 互补：AssetManager 关注 Promise 缓存；Assets 关注实例生命周期。
export * from './Assets';
// Concurrency — Worker 池管理器 (并行任务调度,three.js WorkerPool 适配)。
export * from './Concurrency';
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
  // Animation retargeting
  AnimationRetargeting,
  extractBindPose,
  type BindTransform,
  type BoneMapping,
  type RetargetConfig,
  // SkeletonUtils (three.js examples/jsm/utils 适配)
  retarget,
  retargetClip,
  clone,
  type RetargetOptions,
  // Two-bone IK + LookAt IK
  TwoBoneIKSolver,
  LookAtIK,
  type TwoBoneIKInput,
  type TwoBoneIKOutput,
  type LookAtIKInput,
  type LookAtIKOutput,
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
  GPUParticleSystem,
  type GPUParticleOptions,
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
  ConsoleCommands,
  getDefaultConsoleCommands,
  resetDefaultConsoleCommands,
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
  type ConsoleCommand,
  type ConsoleArg,
  type ConsoleArgType,
  type ConsoleCommandCategory,
  type AutoCompleteSuggestion,
  type HelpEntry,
  type GroupedHelp,
  type ConsoleCommandsStats,
  type ExecuteResult,
  type ParsedArgValue,
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
// PCG — 程序化内容生成 (NoiseGenerator 噪声 + BuildingGenerator 建筑 + BuildingGenerator2 增强建筑 + CityGenerator 城市 + CityGenerator2 增强城市 + DungeonGenerator 地牢 + TreeGenerator 树木)。
// 多种 PRG 生成器,产出 BufferGeometry / 网格 / 布局元数据,不绑定 Material / Scene。
export * from './PCG';
// Pipeline — 资源管线 (AssetPipeline 步骤序列 + TextureProcessor 纹理处理 + GeometryProcessor 几何体处理 + ImportPipeline 模型导入)。
// 与 Loaders/AssetManager 互补:Loaders 关注解析,Pipeline 关注处理与优化。
export * from './Pipeline';
// Gameplay — 游戏玩法系统 (DialogueSystem 对话 + DialogueTree 对话树 + DialogueParticipant 参与者 + QuestSystem 任务 + InventorySystem 物品栏)。
// 与 Events/Scripting 互补,提供 RPG/NPC 玩法层。
export * from './Gameplay';
// SurfaceData — 表面数据系统 (SurfaceTag 标签 + SurfacePoint 采样点 + Provider 注册表 +
// SurfaceDataSystem 查询 + TerrainSurfaceProvider 地形适配)。参考 o3de Gems/SurfaceData。
export * from './SurfaceData';
// Shapes — 形状组件 (Box/Sphere/Capsule/Cylinder/Disk/Quad/Tube/Compound),供碰撞拾取、
// SurfaceData 采样、ECS 触发器复用。参考 o3de Gems/LmbrCentral/Shape。
// 注意:./Shapes 与 ./Geometries 都导出 `Shape` (前者是抽象形状基类,后者是路径几何)。
// 显式 re-export Geometries.Shape 优先于 export *,避免歧义导致根 barrel 的 Shape 静默消失
// (与上方 LightProbe 处理 ./Lights ↔ ./Renderer 冲突的写法一致)。
export * from './Shapes';
export { Shape } from './Geometries';
// Curves — 曲线/路径系统 (Curve 抽象基类 + CurvePath 集合 + CatmullRom/CubicBezier/QuadraticBezier/
// LineCurve3/EllipseCurve/SplineCurve 具体曲线 + Path 2D 路径构建器 + Shape 带 holes 形状 +
// ShapeUtils 三角剖分 + Earcut)。参考 three.js src/extras/。
// 注意:./Curves 也导出 `Shape` (2D 路径形状),与 ./Geometries `Shape` 同名。
// 此处显式列出 Curves 的全部导出(除 Shape 外),避免与上方 Geometries.Shape 冲突。
export {
  Curve,
  CurvePath,
  LineCurve3,
  QuadraticBezierCurve3,
  CubicBezierCurve3,
  CatmullRomCurve3,
  LineCurve,
  QuadraticBezierCurve,
  CubicBezierCurve,
  SplineCurve,
  EllipseCurve,
  Path,
  ShapeUtils,
  Earcut,
  CatmullRom,
  QuadraticBezier,
  CubicBezier,
  type CurvePoint,
  type FrenetFrames,
  type CatmullRomCurveType,
  type ExtractPointsResult,
} from './Curves';
// Animation — Root Motion 提取器 (参考 o3de EMotionFX RepositioningLayerPass)。
// 从根骨节提取相对位移/旋转增量,应用到角色世界变换而非骨节,修复滑步。
export { RootMotionExtractor, DEFAULT_ROOT_MOTION_CONFIG, type RootMotionConfig } from './Animation';
// Vegetation — 可组合植被管线 (Spawner + Filters + Modifiers + Descriptors + AreaBlender)。
// 与 Environment/VegetationSystem 互补:VegetationSystem 是一体化系统,本模块是可组合管线。
// 参考 o3de Gems/Vegetation。
export * from './Vegetation';
// LocalUser — 本地多用户管理 (Profile + Slot + Manager)。
// 参考 o3de Gems/LocalUser。
export * from './LocalUser';
// ScriptCanvas — 可视化脚本运行时 (节点图数据模型 + 执行引擎,无 UI 画布)。
// 参考 o3de Gems/ScriptCanvas。与 lib/vreenBlockly.ts (Blockly UI 编辑器) 互补:
// ScriptCanvas 提供 JSON 可序列化节点图 + 运行时执行器,Blockly 负责可视化编辑。
// 注意:./ScriptCanvas 与 ./Scripting 都导出 `ScriptPin` / `ScriptGraphJSON` (前者是
// ScriptCanvas 运行时的 pin/图 JSON,后者是 VisualScriptComponent 的 ECS 组件 pin/图 JSON,
// 形态不同)。与上方 ./Curves 排除 `Shape` 同理:此处显式列出 ScriptCanvas 的全部导出
// (排除重名的 ScriptPin / ScriptGraphJSON),让根 barrel 保留 Scripting 的版本;
// ScriptCanvas 自己的 ScriptPin / ScriptGraphJSON 经子 barrel `./ScriptCanvas` 直接导出。
export {
  type ScriptValueType,
  type ScriptValue,
  type ScriptNodeDescriptor,
  NodeRegistry,
  defaultNodeRegistry,
  registerBuiltinNodes,
  type ScriptGraphEdge,
  type ScriptGraphNode,
  ScriptGraph,
  type ScriptExecutionContext,
  ScriptExecutor,
} from './ScriptCanvas';
// WhiteBox — 半边网格 + 基元 + CSG,面向编辑器 greyboxing。
// 参考 o3de Gems/WhiteBox。产出 HalfEdgeMesh (拓扑感知) + BufferGeometry (可渲染)。
// 注意:./WhiteBox 的 `Face` 接口与 ./Core 的 `Face` 重名,此处显式列出 WhiteBox 的全部
// 导出 (排除 Face),让根 barrel 保留 Core 的版本;WhiteBox 的 Face 经子 barrel 直接导出。
export {
  type Vertex,
  type HalfEdge,
  HalfEdgeMesh,
  createBox,
  createTetrahedron,
  createIcosahedron,
  createStaircase,
  type CsgOperation,
  csg,
} from './WhiteBox';
// UI — 游戏内 UI 系统 (Canvas / Widget / Layout / Input / Animation)。
// 仿 o3de LyShine、UE5 UMG、Unity UI Toolkit。屏幕空间 + 世界空间画布,
// RectTransform 锚点/枢轴/拉伸布局,Horizontal/Vertical/Grid 布局组,
// Button/Slider/Toggle/Dropdown/ScrollRect 控件,指针/键盘/拖拽/焦点输入,
// Tween 动画 (fade/scale/slide/color + 12 缓动函数 + 序列)。
// 纯 CPU 布局/命中/动画逻辑,渲染层消费 UIDrawCommand 绘制。
export * from './UI';
// WebXR — VR/AR/MR 会话管理 (WebXR Device API)。
// 适配 three.js WebXR (WebXRManager/Controller + VRButton/ARButton) + o3de Atom XR pass。
// 会话生命周期 / 参考空间 / 帧循环 / 控制器 (目标射线+握持+手部25关节+捏合检测) /
// AR 子系统 (光照估计+平面检测+深度感知遮挡)。纯逻辑可测试 (Provider 抽象注入)。
export * from './WebXR';
