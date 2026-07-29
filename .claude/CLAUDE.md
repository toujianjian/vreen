# VREEN 项目文档

## 📋 项目概览

VREEN 是一个基于**自研 WebGL2 渲染引擎**的可视化 3D 模型检视系统，面向独立游戏开发者与 3D 艺术家。

- **语言**: TypeScript 5 (strict mode)
- **前端**: React 18 + React Router 6 (HashRouter) + Zustand 4 + i18next
- **3D**: Three.js r169 + @react-three/fiber + @react-three/drei + postprocessing
- **构建**: Vite 5 + Tailwind CSS 3
- **桌面端**: Electron 43 + electron-builder 26 (便携版 .exe)
- **可视化编程**: Blockly 13 (通过 `src/lib/vreenBlockly.ts` + `BlocklyPanel.tsx`)
- **License**: MIT

## 📊 项目统计

- **代码行数**: 56K+ (含引擎 + 应用 + 测试)
- **测试数量**: 3361+ (200+ 个测试文件)
- **引擎模块**: 34 个顶层模块
- **源码文件**: 390+ (`src/engine/`)
- **零运行时依赖**: `@vreen/engine` 仅 Draco 为可选 peer

## 🗂️ 源码结构

```
src/
├── main.tsx                 # 入口：字体加载、i18n 初始化、挂载 React
├── App.tsx                  # 路由定义：/ /viewer /viewer/:assetId /engine-demo
├── components/
│   ├── home/                # 首页组件 (Hero, Uploader, Gallery, Footer, TerminalLog)
│   ├── hud/                 # 全局 HUD (TopBar, LangSwitcher, HudPanel)
│   ├── three/               # Three.js 辅助组件 (BackgroundScene, PresetPreview, SafeEnvironment)
│   └── viewer/              # 检视器核心组件
│       ├── Stage.tsx         # Three.js R3F 渲染容器 (默认)
│       ├── CustomStage.tsx   # 自研 WebGL2 引擎渲染容器 (支持 THREE/CUSTOM 切换)
│       ├── ViewerToolbar.tsx # 工具栏 (引擎切换/物理/调试/性能/Blockly/材质等)
│       ├── ViewerStatusBar.tsx # 底栏 (FPS、三角面等统计)
│       ├── BlocklyPanel.tsx  # Blockly 可视化脚本面板 (新建)
│       ├── Inspector.tsx     # 属性检查器
│       ├── Outliner.tsx      # 场景大纲树
│       ├── ParamEditor.tsx   # 材质参数编辑器
│       ├── ECSPanel.tsx      # ECS 调试面板
│       ├── EntityGraph.tsx   # 实体关系图
│       ├── TunerPanel.tsx    # 参数调节面板 (M2)
│       ├── SceneContents.tsx # 场景内容浏览
│       ├── GeneratorMarketPanel.tsx # 生成器市场面板
│       ├── ProfilerHUD.tsx   # 性能分析 HUD
│       ├── FrameChart.tsx    # 帧率图表
│       ├── SystemTimingChart.tsx # 系统时序图
│       ├── Timeline.tsx      # 动画时间轴
│       ├── FreeCameraController.tsx # 自由相机控制
│       ├── ColorField.tsx    # 颜色选择器
│       ├── VreenInspectorPanel.tsx # .vreen 包内省面板
│       └── ...
├── engine/                  # 自研 WebGL2 引擎 (@vreen/engine)
│   ├── Core/                # 场景图 (Object3D/Scene/Group/Mesh/SkinnedMesh/Bone/Skeleton/BufferGeometry/BufferAttribute/InstancedBufferAttribute/Material/InstancedMesh/LOD/Sprite/Text/BitmapText/TextAtlas) + 纹理家族 (Texture/CubeTexture/DataTexture/DataArrayTexture/DepthTexture/VideoTexture/CanvasTexture/CompressedTexture) + Source + MorphTargets/MorphTargetAnimation + Fog/FogExp2 + Raycaster + DirtyFlag/SceneGraphProcessor/FrustumCuller/SceneStats
│   ├── Renderer/            # WebGL2Renderer, ShaderProgram, RenderPass, ShadowMapManager + MRTTarget/GBuffer (延迟渲染) + DeferredRenderer (替代延迟后端) + ReflectionProbe/ReflectionProbeManager (IBL 探针) + 后处理 (基础: Bloom/ChromaticAberration/Vignette/SSAO/FXAA/ToneMapping/Gamma/DOF; PostProcess/ 增强: ColorGrading/LUT/FilmGrain/Afterimage/Pixelation/AutoExposure/DOFEnhanced/GTAO/MotionBlur/SSR/SSSS/TAA/Velocity/VolumetricFog) + PathTracer (CPU 参考路径追踪)
│   ├── Materials/           # StandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshNormalMaterial, ShadowMaterial, SpriteMaterial, ShaderMaterial (+onBeforeCompile), ShaderChunks/ 子目录 (10 GLSL 片段 + ShaderChunkRegistry), 特殊材质: FurMaterial/MatcapMaterial/ToonMaterial/OutlineMaterial/WaterMaterial/WireframeMaterial
│   ├── Math/                # Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Ray, Line3, Triangle, Frustum, MathUtils
│   ├── Cameras/             # PerspectiveCamera, OrthographicCamera
│   ├── Lights/              # Ambient/Directional/Point/Spot/Hemisphere/RectArea + DirectionalLightShadow + ShadowMapManager
│   ├── Loaders/             # GLB/OBJ/FBX/HDR/KTX2/STL/PLY/TGA/MTL/EXR Loader + TextureLoader + DracoDecoder + AssetManager + 4 导出器 (OBJExporter/GLTFExporter/STLExporter/PLYExporter)
│   ├── Animation/           # AnimationMixer/AnimationClip/AnimationAction/AnimationStateMachine/BlendSpace1D/Humanoid + AnimationLayer/AnimationLayerMixer/BoneMask/AvatarMask/AdditiveBlend/AnimationSync + IK (IKBone/IKChain/IKSolver(FABRIK)/CCDSolver/IKHumanoid)
│   ├── ECS/                 # World, ComponentType, Components, Systems, PhysicsComponents (含 Constraint: Ball/Hinge/Slider/Fixed/Distance), PhysicsSystems (含 ConstraintSolver), Prefab, QueryBuilder, Broadphase
│   ├── Controls/            # OrbitControls, FlyControls, PointerLockControls, MapControls, CharacterController (kinematic 角色)
│   ├── Geometries/          # Box/Sphere/Cylinder/Cone/Torus/Plane/Circle/Ring/Capsule/TorusKnot/Lathe/Extrude/Shape/Wireframe/Edges + Primitives barrel
│   ├── Helpers/             # GridHelper, GridHelper3D, AxesHelper, BoxHelper, CameraHelper, ArrowHelper, LineHelper, PhysicsDebugRenderer
│   ├── Events/              # EventBus, EventQueue, GameEvent (CollisionEvent/TriggerEvent/SpawnEvent/DestroyEvent/ScoreEvent/CustomEvent) - 类型化 pub/sub
│   ├── Scripting/           # ScriptComponent/ScriptC, ScriptSystem, ScriptRegistry, CoroutineSystem - 代码驱动脚本层 (与 Blockly 互补)
│   ├── Particles/           # ParticleSystem2, ParticleEmitter, ParticleModifier (Force/Vortex/Turbulence/ColorOverLife/SizeOverLife/VelocityOverLife/SubEmitters), ParticleCurve (Constant/Linear/Bezier/Random), TrailModule, ParticleData - 高级 CPU 粒子系统 (与 ECS ParticleSystem 分离)
│   ├── Audio/               # AudioListener, Audio, PositionalAudio, AudioLoader, AudioAnalyser
│   ├── Terrain/             # TerrainGeometry, HeightmapGenerator, TerrainSplat, TerrainLayer
│   ├── Acceleration/        # BVH, BVHBuilder, MeshBVH
│   ├── Assets/              # AssetCache (LRU), AssetRegistry (引用计数), AssetLoader (异步加载) - 资源生命周期管理 (与 Loaders/AssetManager 互补)
│   ├── Serialization/       # SerializerRegistry, GeometrySerializer, MaterialSerializer, SceneSerializer - 场景/几何体/材质 ↔ JSON 往返
│   ├── Tools/               # Profiler (CPU/GPU mark), FrameProfiler (帧级 FPS), SystemProfiler (ECS 系统耗时), MemoryTracker (分配/泄漏), GpuProfiler (timer query), PerformanceReport (文本/JSON 报告)
│   ├── Physics/             # PhysicsDemo + ConstraintSolver + Joint 约束 (Ball/Hinge/Slider/Fixed/Distance) + ClothSimulation (Verlet 布料) + FluidSimulation (SPH 流体) + DestructionSystem + VoronoiFracture
│   ├── Network/             # NetworkSync (服务器权威同步) + Snapshot (二进制快照序列化/压缩) + NetworkTransport (WebSocket/Mock 传输抽象) + NetworkLerp (位置/旋转插值 + 预测 + 和解)
│   ├── SaveSystem/          # SaveSystem (多槽位 + 自动保存) + SaveSerializer (Scene+World ↔ SaveData,含压缩) + LocalStorageAdapter (localStorage/内存兜底)
│   ├── SceneManager/        # SceneManager (多场景注册/加载/切换) + SceneTransition (Fade/Crossfade/Slide/Wipe/None 过渡)
│   ├── Input/               # InputManager (统一键盘/鼠标/触摸/手柄) + KeyboardState/MouseState/TouchState/GamepadState + InputAction (动作映射) + InputMap (JSON 配置往返)
│   ├── AI/                  # AI 导航 + 行为树 (NavMesh 导航网格 + A* PathFinder 寻路 + SteeringBehavior 转向行为 + Agent 代理) + 行为树 (BehaviorTree/BTAction/BTComposite/BTCondition/BTDecorator/BTNode + Blackboard 黑板)
│   ├── Environment/         # 环境系统 (WeatherSystem 天气 + SkySystem 天空/日夜循环 + CloudSystem 云层 + PrecipitationSystem 降水 + VegetationSystem/VegetationType 植被 + WaterSimulation/WaterSystem 水体)
│   ├── Timeline/            # 时间轴/Sequencer (TimelineClip 片段 + TimelineTrack 轨道 + EventTrack 事件 + PropertyTrack 属性关键帧 + TimelineSequencer 序列器,支持 play/pause/seek/loop/export/import)
│   ├── Voxel/               # VoxelChunk 16³ + VoxelWorld 多块管理 + VoxelMesher 贪婪网格合并 + VoxelRaycaster DDA + VoxelPalette 类型表
│   ├── Editor/              # 编辑器系统:SelectionSystem 选择/拾取 + TransformGizmo 变换手柄 (translate/rotate/scale) + UndoRedoSystem 撤销重做 (含 beginGroup/endGroup) + EditorCommands 命令工厂 (Move/Rotate/Scale/Add/Remove/Property) + SnapSystem 网格/角度/缩放吸附
│   ├── PCG/                 # 程序化内容生成 (NoiseGenerator Perlin/Simplex/Worley/FBM + BuildingGenerator + CityGenerator + DungeonGenerator + TreeGenerator) - 产出 BufferGeometry/布局元数据,不绑定 Material/Scene
│   ├── Pipeline/            # 资源管线 (AssetPipeline 步骤序列 + TextureProcessor 纹理处理 + GeometryProcessor 几何体处理 + ImportPipeline 模型导入) - 与 Loaders/AssetManager 互补:Loaders 关注解析,Pipeline 关注处理与优化
│   └── Gameplay/            # 游戏玩法系统 (DialogueSystem 对话 + DialogueTree 对话树 + DialogueParticipant 参与者 + QuestSystem 任务 + InventorySystem 物品栏) - 与 Events/Scripting 互补,提供 RPG/NPC 玩法层
├── pages/                   # 页面组件 (HomePage, ViewerPage, EngineDemoPage)
├── stores/                  # Zustand 状态管理
│   ├── viewerStore.ts       # 资产加载、相机、引擎模式、物理调试、Blockly 开关
│   ├── uiStore.ts           # UI 状态、日志、环境、后处理
│   ├── worldStore.ts        # ECS 世界引用
│   ├── profilerStore.ts     # 性能分析数据
│   └── inspectorStore.ts    # 检视器状态
├── lib/                     # 工具库
│   ├── vreenBlockly.ts      # Blockly 自定义积木定义与运行时 (新建)
│   ├── presets.ts           # 6+1 个预设模型定义
│   ├── vreenManifest.ts     # .vreen 包 manifest 工具
│   ├── vreenPack.ts         # .vreen 打包/解包
│   ├── vreenValidate.ts     # .vreen 验证
│   ├── vreenDiff.ts         # .vreen 增量差分包
│   ├── vreenRegistry.ts     # .vreen 注册表
│   ├── export.ts            # 导出工具
│   ├── format.ts            # 格式化工具
│   ├── logger.ts            # 集中式日志系统
│   ├── screenshot.ts        # 截图工具
│   ├── uploadBridge.ts      # 上传桥接
│   ├── generatorMarket.ts   # 生成器市场
│   ├── generatorProxy.ts    # 生成器代理
│   ├── roundtripDemo.ts     # .vreen 往返测试
│   └── cn.ts                # clsx + tailwind-merge 辅助
├── three/                   # Three.js 辅助
│   ├── generators.ts        # 7 个程序化模型生成器
│   ├── loaders.ts           # Three.js 加载器封装
│   ├── camera.ts            # 相机工具
│   ├── composite.ts         # 组合生成器
│   ├── normalize.ts         # 模型归一化
│   ├── proceduralTextures.ts # 程序化纹理
│   ├── threeToCustomAnim.ts # Three 动画转自定义引擎
│   ├── extractGeometryStats.ts # 几何体统计
│   └── convertCustomToThree.ts # 自定义引擎转 Three.js
├── i18n/                    # 国际化
│   ├── index.ts             # i18next 配置
│   └── locales/             # zh.json, en.json, ja.json, ko.json, es.json (5 语言)
├── types/                   # TypeScript 类型定义
│   └── index.ts             # 共享类型
└── styles/                  # CSS
    └── index.css            # Tailwind + 自定义样式 (赛博朋克主题)
```

## 🧱 核心架构约定

### 渲染模式

- **THREE 模式** (默认): 使用 React Three Fiber (`Stage.tsx`) 渲染
- **CUSTOM 模式**: 使用自研 WebGL2 引擎 (`CustomStage.tsx`) 渲染
- 切换通过 `viewerStore.engineMode` 控制

### ECS 架构 (自研引擎)

- `World` — 实体容器，管理 Entity ID 分配、组件存储、系统迭代
- `ComponentType` — 字符串 ID 标识的组件类型元数据，避免循环依赖
- 内置组件: Transform, Velocity, PlayerInput, AnimState, MeshRef, SkinnedMeshRef, Rigidbody, Collider, Particle 等
- 系统: MovementSystem, AnimationStateMachine, PhysicsSystem, CollisionSystem, ParticleSystem, PhysicsDebugSystem
- 模型加载后自动生成 ECS entities，ECS 改动实时同步回 three.js 渲染

### 动画系统

- `AnimationStateMachine` — Idle/Walk/Run 自动切换，基于 Velocity 大小
- `AnimationMixer` — 驱动 GPU skinning 动画混合
- 输入按相机朝向转换到世界空间 (WASD 自由漫游)
- `BlendSpace1D` — 1D 动画混合 (Idle ↔ Walk ↔ Run)
- IK 子系统 — `IKSolver`(FABRIK) / `CCDSolver` / `IKHumanoid`(双足 IK rig)，含关节约束与极向量

### 物理系统

- 固定步长 semi-implicit Euler 积分 + 四元数旋转积分
- Broadphase + narrowphase 碰撞检测 + 冲量响应 + Baumgarte 矫正
- 支持 AABB/Sphere/Capsule collider
- Constraint 子系统 — `BallJointConstraint` / `HingeJointConstraint` / `SliderJointConstraint` / `FixedJointConstraint` / `DistanceJointConstraint`，由 `ConstraintSolver` 迭代求解 (基于 `Constraint` 基类 + `RigidbodyLike` 接口,与任意刚体实现解耦)
- `ClothSimulation` — Verlet 积分布料模拟 (soft body),粒子网格 + 距离约束 (PBD 风格位置修正) + 球体碰撞 + 固定粒子 (pinned 挂点);`getMeshData()` 输出 positions/indices/normals 灌入 BufferGeometry;与 ECS PhysicsSystems 独立 (soft body 形态差异大)
- CPU 粒子系统 + Emitter spawn
- PhysicsDebugRenderer: collider(青色) / contact(黄色) / velocity(品红) 三通道独立开关

### 渲染与材质

- `WebGL2Renderer` — PBR / IBL / 阴影贴图 / 后处理，GLSL ES 3.0
- 材质家族 — `StandardMaterial`(PBR) / `MeshPhysicalMaterial`(clearcoat+transmission) / `MeshBasicMaterial`(unlit) / `MeshPhongMaterial`(Blinn-Phong) / `MeshNormalMaterial`(法线 debug) / `ShadowMaterial`(阴影捕获) / `SpriteMaterial`(精灵) / `ShaderMaterial`(`onBeforeCompile` GLSL 注入)
- 后处理 — 基础 Pass: Bloom / ChromaticAberration / Vignette / SSAO / FXAA / ToneMapping / Gamma / DOF;增强 Pass (PostProcess/): ColorGrading / LUT / FilmGrain / Afterimage / Pixelation,基于 `RenderPass` 抽象组合
- `MRTTarget` — 多渲染目标 FBO (N 颜色附件 + 可选深度/模板),RGBA16F/RGBA32F/RGBA8 等格式
- `GBuffer` — 基于 MRTTarget 的几何缓冲 (4 附件: position/normal/albedo/material + 深度),用于延迟渲染管线
- `ShadowMapManager` — 阴影贴图 FBO / 纹理生命周期管理
- `ShaderChunks/` 子目录 — 10 个 GLSL 片段 (common/lighting/fog/normal_packing/shadow/envmap/tonemapping/noise/uv_transform/color_space) + `ShaderChunkRegistry` 注册表 (支持 `#include <name>` 解析)

### 纹理系统 (Core/)

- `Texture`(基类) / `CubeTexture`(6 面环境) / `DataTexture`(typed array) / `DataArrayTexture`(2D 数组纹理) / `DepthTexture`(阴影/深度) / `VideoTexture`(视频流) / `CanvasTexture`(canvas 动态源 + `update()`) / `CompressedTexture`(S3TC/ETC/BPTC/PVRTC/ASTC 压缩纹理基类，含 mip 链)
- `Source` — 纹理数据源封装 (`data` / `width` / `height` / `version` + `needsUpdate()`)，与采样状态解耦

### 加载器 (Loaders/)

- `GLBLoader` / `OBJLoader` / `FBXLoader` / `HDRLoader`(per-channel RLE RGBE) / `KTX2Loader`(Basis Universal) / `STLLoader` / `PLYLoader` / `TGALoader` / `MTLLoader` / `EXRLoader` / `TextureLoader` / `DracoDecoder`(可选 peer) / `AssetManager`(LRU 缓存)
- 导出器 (4 个): `OBJExporter`(Wavefront OBJ 字符串) / `GLTFExporter`(glTF-GLB 二进制,含嵌入 buffer/image,与 `GLBLoader` 往返) / `STLExporter`(ASCII/二进制 STL) / `PLYExporter`(ASCII/二进制 PLY)

### 几何体 (Geometries/)

- 15 个程序化基元 — Box / Sphere / Cylinder / Cone / Torus / Plane / Circle / Ring / Capsule / TorusKnot / Lathe / Extrude / Shape(2D 轮廓) / Wireframe / Edges
- `Primitives.ts` 统一 barrel 导出

### 控制器 (Controls/)

- `OrbitControls`(默认) / `FlyControls`(自由飞行) / `PointerLockControls`(第一人称) / `MapControls`(俯视地图)

### Helpers (Helpers/)

- `GridHelper` / `GridHelper3D`(3D 体素网格) / `AxesHelper` / `BoxHelper` / `CameraHelper` / `ArrowHelper` / `LineHelper` / `PhysicsDebugRenderer`

### 音频 (Audio/)

- `AudioListener` / `Audio`(非空间) / `PositionalAudio`(3D 空间) / `AudioLoader` / `AudioAnalyser`(FFT)
- 共享 `AudioContext`，测试用 `audioContextMock.ts`

### 地形 (Terrain/)

- `TerrainGeometry`(高度场网格) / `HeightmapGenerator`(分形噪声/水力侵蚀) / `TerrainSplat`(splat 贴图混合) / `TerrainLayer`(层元数据)
- 与渲染器解耦，产出标准 `BufferGeometry` / `StandardMaterial` / `DataTexture`

### 加速结构 (Acceleration/)

- `BVH`(通用包围盒层次) / `BVHBuilder`(SAH 构建) / `MeshBVH`(三角形感知 BVH，附加到 `BufferGeometry.bvh`，由 `Raycaster` 优先消费)

### 事件系统 (Events/)

- `EventBus` — 同步 topic-based 发布订阅(`on`/`off`/`emit`,listener 按引用移除)
- `EventQueue` — 缓冲 FIFO 队列,`enqueue(event)` / `drain()` 在帧安全点刷新,用于延迟副作用(实体销毁/级联 spawn)
- `GameEvent` — 类型化事件判别联合: `CollisionEvent` / `TriggerEvent` / `SpawnEvent` / `DestroyEvent` / `ScoreEvent` / `CustomEvent`,各携带类型化 `data`

### 脚本系统 (Scripting/)

- `ScriptComponent` (注册为 `ScriptC`) — ECS 组件持有脚本实例 + 生命周期钩子(`onCreate`/`onUpdate`/`onDestroy`/`onCollision`/`onTrigger`),可经 `World.toJSON` 往返
- `ScriptSystem` — 每帧 tick 所有 `ScriptComponent` 实体,分发 collision/trigger 事件
- `ScriptRegistry` — 名称 → `ScriptFactory` 注册表;`scriptRegistry` 为进程级单例(组件存脚本名而非实例,便于序列化)
- `CoroutineSystem` — 协作式协程调度器,`startCoroutine(generator)` 返回 `CoroutineHandle`,协程 yield `CoroutineYield`(帧数/秒数/predicate)后下次匹配 tick 恢复;用于剧情/延迟特效/多步 spawn
- 与 Blockly 视觉脚本互补,二者最终都操作同一 ECS `World`

### 高级粒子系统 (Particles/)

- 与 ECS 中的 `ParticleSystem` **分离**,本模块为高级 CPU 粒子,支持 modifier/curve/sub-emitter/trail
- `ParticleSystem2` — 主模拟器,拥有粒子池,每帧 tick `ParticleModifier`,从一个或多个 `ParticleEmitter` spawn,产出 `ParticleSystemRenderData`
- `ParticleEmitter` — spawn 源,可配置形状(sphere/box/cone/hemisphere/mesh)/rate/burst/lifetime/speed/size `MinMaxRange`(engine barrel 中以 `AdvancedParticleEmitter` 别名导出,避免与 ECS 同名组件冲突)
- `ParticleModifier` — 抽象基类,内置: `ForceFieldModifier` / `VortexModifier` / `TurbulenceModifier` / `ColorOverLifeModifier` / `SizeOverLifeModifier` / `VelocityOverLifeModifier` / `SubEmittersModifier`
- `ParticleCurve` — life-driven 属性采样曲线接口,实现: `ConstantCurve` / `LinearCurve` / `BezierCurve` / `RandomCurve`
- `TrailModule` — 可选 ribbon trail 渲染附件,记录粒子位置历史产出 `TrailRenderData`,支持多 `TrailColorMode`
- `ParticleData` — 单粒子状态结构(position/velocity/size/color/lifetime 等)

### Scene Graph 增强 (Core/)

- `DirtyFlag` — `Object3D` 内嵌的脏标记系统,标记 transform/matrix/worldMatrix 需重算
- `SceneGraphProcessor` — 场景图遍历处理器,统一 world matrix 更新 / dirty 传播 / 渲染前 flatten
- `FrustumCuller` — 视锥剔除器,基于 `Frustum` + 包围盒(`Box3`/`Sphere`)剔除不可见 mesh,与 `Object3D.frustumCulled` 标志配合
- `SceneStats` — 场景统计聚合(mesh/light/draw call/triangles 计数),供 Profiler HUD 与 `PerformanceReport` 消费

### 文本与精灵 (Core/)

- `Sprite` — 始终面向相机的 2D 精灵 (billboard),CPU 在 `updateMatrixWorld` 中写入相机世界旋转,raycast 单位 quad 求交;配合 `SpriteMaterial` 渲染
- `Text` — 3D 文字渲染,通过 `TextAtlas` 光栅化字符为共享纹理图集,每个字符生成 quad 组装 BufferGeometry,用 `MeshBasicMaterial` + atlas texture 渲染;支持换行/对齐
- `BitmapText` — 接受外部预渲染 `TextAtlas` 的位图文字,适合大量文本共享图集场景
- `TextAtlas` — 文字纹理图集,把字符光栅化到 canvas 并记录 UV 坐标,产出 `CanvasTexture`;无 DOM 时退化为 dry-run 模式 (测试/SSR)
- `InstancedBufferAttribute` — 实例化渲染的 per-instance 顶点属性,`meshPerAttribute` 对应 `gl.vertexAttribDivisor(loc, N)`,默认 N=1

### Morph Targets (Core/)

- `MorphTargets` — 形变目标 (面部表情/形变动画),存绝对顶点位置 + 权重数组 + 名称反查表;应用规则 `result[i] = base[i] + Σ(target - base) * influence`;由 `mesh.morphTargets` 挂载,renderer 每帧 draw 前调用 `update(geometry)` 写回 position 并 version++ 触发 GPU 重传
- `MorphTargetAnimation` — 形变目标动画驱动器,持 `MorphTargets` + 多条 `MorphTargetTrack` (times + values 标量序列,二分查找 + 线性插值),`update(dt)` 推进时间采样写回 influence;与 `AnimationMixer` 互补 (骨骼做整体姿态,形变做面部/局部细节)

### 资源管理 (Assets/)

- 与 `Loaders/AssetManager` 互补:`AssetManager` 关注 Promise 缓存,`Assets/` 关注实例生命周期
- `AssetCache` — 同步 LRU 资源实例缓存 (按 key),`get`/`set`/`has`/`delete` + 容量驱逐
- `AssetRegistry` — 资源注册表 + 引用计数,`acquire(key)` 返回 `AssetHandle` (持有引用),`release(handle)` 递减计数,归零时触发 dispose 回调;`getDefaultAssetRegistry()` 进程级单例
- `AssetLoader` — 异步资源加载器 (封装 `AssetManager`),`load(entries)` 批量加载,返回 `AssetBatchResult` (成功/失败分组)

### 序列化 (Serialization/)

- 场景序列化模块,支持 Scene/Geometry/Material ↔ JSON 往返还原
- `SerializerRegistry` — 序列化器注册表 (按 type 分派),`getDefaultSerializerRegistry()` 进程级单例
- `GeometrySerializer` — `BufferGeometry` ↔ `GeometryJSON` (含 attributes/index/morphTargets)
- `MaterialSerializer` — `Material` ↔ `MaterialJSON`,支持 `registerMaterialType` 注册自定义材质类型元数据
- `SceneSerializer` — `Scene` ↔ `SceneJSON` 顶层入口,递归序列化 Object3D 树;支持 `registerObjectHandler` 自定义节点处理器;版本号 `SCENE_SERIALIZER_VERSION`

### 性能分析工具 (Tools/)

- 工具家族,各聚焦不同层级(帧/系统/内存/GPU),可独立使用或经 `PerformanceReport` 聚合
- `Profiler` — 原始 ring-buffer(120 帧)帧分析器,`mark(name)`/`markEnd(name)` 记录 CPU/GPU 区间,集成 `EXT_disjoint_timer_query_webgl2`,每帧 `FrameSample` 含 per-mark 耗时与可选 draw-call 拆解;由 `profilerStore` 与 `FrameChart.tsx` 消费
- `FrameProfiler` — 帧级 FPS/draw-call/triangle 聚合器,ring buffer(默认 120)存 `FrameSample { frame, time, dt, drawCalls, triangles, vertices, memoryMB }`,每 `endFrame(stats)` 重算滚动 `currentFPS`/`avgFPS`/`minFPS`/`maxFPS`;API: `beginFrame()` / `endFrame(stats)` / `getMetrics()` / `getHistory(count)` / `reset()`
- `SystemProfiler` — ECS 系统耗时跟踪器,`begin(name)`/`end(name)` 推/弹开栈,每个 `SystemTiming { name, totalTime, callCount, avgTime, maxTime, lastTime }` 在 `end` 时更新;`getAllTimings()` 按 `totalTime` 降序,`getSlowestSystems(count)` 按 `avgTime` 降序,供 `SystemTimingChart.tsx` 定位热点
- `MemoryTracker` — 引擎显式资源分配账本(**非** JS heap profiler,JS GC 由 V8 管理),`track(type, size, stack?)` 返回 id,`untrack(id)` 释放;`getSummary()` 返回 `byType` 分组与 active/total bytes,`getLeaks(minAgeMs)` 标记超过年龄阈值未释放的疑似泄漏;O(1) 删除(swap-with-tail)
- `GpuProfiler` — 独立 GPU timer-query 封装,`beginQuery(gl, id)`/`endQuery(gl, id)`/`getQueryResult(gl, id)`;内部缓存 `EXT_disjoint_timer_query_webgl2` 扩展,`pollAll(gl)` 非阻塞刷新待决查询并将 ns→ms,处理 `GPU_DISJOINT_EXT`(丢弃结果);扩展不可用时(Safari 等)退化到 CPU 侧计时;`dispose(gl)` 释放所有 `WebGLQuery`
- `PerformanceReport` — 静态报告生成器,`generate(fp?, sp?, mt?)` 产出人类可读文本报告(帧/系统/内存段全部可选),`toJSON(...)` 产出 `PerformanceReportJson` 供工具化/回归追踪
- **为什么是工具家族而非单一 profiler?** 每个 profiler 形态不同(ring buffer vs. map vs. set vs. async-query),消费者也不同(HUD vs. leak 排查 vs. CI);拆分让每类小巧可测可独立使用,`PerformanceReport` 提供聚合层

### 场景辅助 (Core/)

- `Fog` / `FogExp2` — 线性雾 / 指数雾
- `Raycaster` / `intersectGeometry` — 射线场景求交 (优先使用 `MeshBVH`)

### 网络同步 (Network/)

- 服务器权威模型 + 客户端插值/预测;`NetworkSync` 管理同步实体注册与每帧 tick
- `NetworkTransport` — 传输抽象契约,内置 `WebSocketTransport`(浏览器)与 `MockTransport`(测试)
- `Snapshot` — 二进制快照序列化 (实体 Transform + 组件状态),支持压缩以降低带宽
- `NetworkLerp` — 位置/旋转插值 + 客户端预测 + 服务器和解 (reconciliation),平滑远程实体运动
- `createNetworkEntity` 工厂 — 注册同步实体并返回 `NetworkEntity` 句柄

### 存档系统 (SaveSystem/)

- 与 Scene + World 解耦:`save()` 接收实例,`load()` 返回重建实例
- `SaveSystem` — 多槽位管理 (slotId → SaveSlot) + 自动保存 (每 N 秒触发 source) + import/export 跨实例迁移
- `SaveSerializer` — Scene + World + metadata ↔ `SaveData`,含压缩;委托 `SceneSerializer` / `World.toJSON`
- `LocalStorageAdapter` — 字符串键值存储契约,浏览器用 `localStorage`,Node/测试用 `MemoryStorageBackend` 兜底;所有 key 加前缀避免污染
- `StorageAdapter` 契约可被 IndexedDB / FileSystem 实现替换

### 场景管理 (SceneManager/)

- `SceneManager` — 多场景注册 / 按名切换 / 当前场景跟踪;场景以 `Scene` 实例注册,切换时替换渲染根
- `SceneTransition` — 场景过渡效果 (Fade / Crossfade / Slide / Wipe / None),基于 alpha + 缓动函数;`update(dt)` 推进过渡,完成后回调
- 与 `viewerStore` 解耦:SceneManager 是纯引擎层,UI 通过 store 监听切换事件

### 输入系统 (Input/)

- `InputManager` — 统一管理键盘/鼠标/触摸/手柄,`attach(domElement)` 绑定 DOM 事件,`update()` 每帧推进状态 + 手柄轮询;`setEnabled(false)` 暂停采集
- `KeyboardState` — `keysDown` / `keysPressed`(本帧)/ `keysReleased`(本帧)三套集合,键码用 `KeyboardEvent.code`(布局无关);`anyDown` / `allDown` 查询
- `MouseState` — `position` / `delta`(Vector2)+ `buttonsDown` / `buttonsPressed` / `buttonsReleased` + `wheelDelta`;按钮编号遵循 MouseEvent.button (0=左/1=中/2=右)
- `TouchState` — 多点触摸 `Map<id, Touch>`,Touch 携带 `phase`(began/moved/ended/cancelled)+ `position` / `delta`;`getMultiTouchDistance` 支持捏合手势
- `GamepadState` — 封装 `navigator.getGamepads()`,带死区 + 按钮/轴查询 + `rumble`(震动,需 GamepadHapticActuator);无 gamepad API 时退化为未连接
- `InputAction` — 物理输入 → 逻辑动作映射,持多个 `InputBinding`(`type: 'keyboard'|'mouse'|'gamepad'`),`evaluate()` 聚合 `value`(最大绝对值)与 `pressed`(OR)
- `InputMap` — 动作表管理 + `saveToJSON` / `loadFromJSON` 往返,便于存档与配置热重载
- 与 `Controls/` 互补:OrbitControls 等直接消费 DOM 事件做相机;InputManager 提供「本帧快照」式查询,供游戏逻辑 (InputAction) 消费

### 流体模拟 (Physics/FluidSimulation)

- `FluidSimulation` — SPH (Smoothed Particle Hydrodynamics) 风格的不可压缩流体模拟
- 粒子携带 position / velocity / density / pressure;每帧 computeDensityPressure → computeForces → integrate
- 空间哈希加速邻居查询,避免 O(n²);与 ECS `PhysicsSystems` 独立(流体形态与刚体差异大)
- `getMeshData()` 输出粒子位置供渲染;可与 `Particles/` 渲染管线对接

### 破坏系统 (Physics/DestructionSystem + VoronoiFracture)

- `VoronoiFracture` — 用 Voronoi 单元剖分将 `BufferGeometry` 切成多个碎块;每个碎块输出独立 geometry + 中心点
- `DestructionSystem` — 管理碎块刚体生成 + 物理模拟;触发断裂时把原 mesh 替换为碎块集合,各碎块带 Rigidbody + Collider
- 与 `ConstraintSolver` 协作:碎块间可临时用 `DistanceJointConstraint` 模拟粘连
- 适合可破坏墙体 / 玻璃碎裂等效果

### 毛发渲染 (Core/FurShell + Materials/FurMaterial)

- `FurShell` — 多层 shell 毛发渲染:生成 N 个同心 shell mesh 共享基础 geometry,每个绑定 `FurMaterial` 的 `shellLayer` (0..1)
- `generate()` 构建 shell 集合(默认作为基础 mesh 子节点),`update(dt)` 同步 gravity/wind/time/furLength/furColor/density/noiseTexture 到所有 shell;`setShellCount(n)` 重建;`dispose()` 释放
- `FurMaterial` — 顶点沿法线 `shellLayer * furLength` 位移 + 重力/风力偏移;片元按密度阈值 discard(顶层稀疏)+ 根部 occlusion 变暗
- `transparent` / `doubleSided` 默认 true;`renderOrder` 递增保证 back-to-front

### 路径追踪 (Renderer/PathTracer)

- `PathTracer` — CPU 参考路径追踪器,用于 PBR 验证与离线调试(非实时后端)
- Möller–Trumbore 射线-三角形求交 + 余弦加权半球采样 + 直接光照(含阴影射线)+ 俄罗斯轮盘路径终止
- `render(scene, camera)` 每次追踪一 pass,`frameCount` 累积到 Float32 缓冲;`getResult()` 返回 gamma 校正后的 `Uint8ClampedArray`
- 可配 `maxBounces`(默认 8)/ `samplesPerPixel`(默认 4)/ 分辨率;`reset()` 清缓冲;`setBounces` / `setSamples` 运行时调整
- 输出未做 tonemap,调用方可后续处理;完全确定性 + 无头测试友好

### 体素系统 (Voxel/)

- `VoxelPalette` — 体素类型注册表(id → 颜色/透明/固体),`defaultPalette` 预置空气/石头/草地/泥土等
- `VoxelChunk` — 16³ 体素块,单块网格化;`getVoxel`/`setVoxel` 读写,`buildMesh` 产出 `VoxelMeshData`
- `VoxelMesher` — 网格生成器:`greedyMesh`(贪婪合并相邻同面,产面最少)/ `simpleMesh`(逐面)/ `getAmbientOcclusion`(顶点 AO)
- `VoxelRaycaster` — DDA 体素射线遍历,`raycast(world, origin, direction, maxDist)` 返回 `VoxelRayHit`(块坐标 + 面法线 + 距离)
- `VoxelWorld` — 多块世界,跨块读写 / 地形生成(Heightmap)/ 统计 `VoxelWorldStats`
- **为什么是 16³ 块而非世界级单网格?** 块是流式加载/卸载、编辑重网格化的最小单元;16³ 兼顾缓存命中率与重算成本

### 编辑器系统 (Editor/)

- `SelectionSystem` — 选择/悬停/射线拾取,`selected: Set<Object3D>` 管理选中集合;`pick(raycaster, scene)` 按 `multiSelect` 决定替换/追加/toggle;`on(listener)` 派发 `SelectionChangeEvent` 供 UI 刷新
- `TransformGizmo` — 变换手柄(translate/rotate/scale),3 轴端球做命中检测;`handleMouseDown/Move/Up` 处理拖拽,射线投影到轴方向算增量写回 target.position/rotation/scale;`getMeshData()` 产出渲染数据由调用方绘制
- `UndoRedoSystem` — 撤销/重做栈,`execute(action)` 调 redo 并入栈(清空 redo 栈);`beginGroup(name)`/`endGroup()` 把多个操作合并为单个原子 entry(undo 倒序、redo 正序);`maxHistory` 裁剪最旧
- `EditorCommands` — 预定义 `HistoryAction` 工厂:`createMoveCommand`/`createRotateCommand`/`createScaleCommand`/`createAddCommand`/`createRemoveCommand`/`createPropertyCommand`,快照在工厂调用时读取
- `SnapSystem` — 吸附系统,三类独立开关:`gridSnap`(位置,`snapPosition` round 到 `gridSize` 倍数)/`angleSnap`(旋转)/`scaleSnap`(缩放);不修改输入,返回新 Vector3
- **为什么各组件零耦合?** SelectionSystem 不依赖 Gizmo,Gizmo 不依赖 UndoRedoSystem;调用方(UI 层)负责串联:鼠标点击 → pick → 选中 → setTarget → 拖拽 → snap → createCommand → execute

### 程序化内容生成 (PCG/)

- 与 Terrain/、Geometries/ 互补:Terrain 关注高度场,Geometries 关注解析式基元,PCG 关注「内容」生成(建筑/城市/地牢/植被),输出 BufferGeometry + 布局元数据,不绑定 Material/Scene
- `NoiseGenerator` — 噪声采样基类,内置 4 种算法:`Perlin`(梯度噪声)/`Simplex`(改进梯度,无方向伪影)/`Worley`(细胞噪声,适合地形分区)/`FBM`(分形布朗运动,多 octaves 叠加);统一 `noise2D(x, y)` / `noise3D(x, y, z)` 接口,可设 seed/lacunarity/persistence
- `BuildingGenerator` — 程序化建筑:由楼层 + 窗户阵列 + 屋顶构成,输出 `BufferGeometry`(合并 mesh);可配 width/height/floorCount/windowDensity
- `CityGenerator` — 城市布局:基于网格 + 噪声扰动生成街区/道路/地块元数据,输出 `CityLayout`(地块坐标列表),由调用方实例化 BuildingGenerator
- `DungeonGenerator` — 地牢生成:基于 BSP(二叉空间分割)或随机游走房间 + 走廊连接,输出房间矩形列表 + 走廊线段;支持 minRoomSize/maxRooms/density
- `TreeGenerator` — 程序化树木:L-system 风格递归分支 + 叶子点云,输出主干 BufferGeometry + 叶子 MeshData;可配 maxDepth/branchAngle/leafCount
- **为什么独立模块?** PCG 生成的是「内容」而非「几何基元」,涉及布局/规则/随机种子,与纯解析式 Geometries 形态不同;独立模块便于扩展(L-system 植被、Wave Function Collapse 等)

### 资源管线 (Pipeline/)

- 与 Loaders/AssetManager 互补:Loaders 关注「解析」(格式 → 引擎对象),Pipeline 关注「处理与优化」(导入时的转换/压缩/优化);Pipeline 内部可调用 Loaders
- `AssetPipeline` — 步骤序列管线:持有序列化的 `PipelineStep[]`,每步 `process(asset)` 输入/输出 `AssetArtifact`;支持 `addStep`/`removeStep`/`run(asset)` 批量执行;每步可声明 `accepts(predicate)` 决定是否处理
- `TextureProcessor` — 纹理处理:`resize(width, height)`/`compress(format)`/`generateMipmaps()`/`flipY()`/`convertFormat(targetFormat)`;输出处理后的 `Texture` 实例(原地或新实例可配)
- `GeometryProcessor` — 几何体处理:`merge(geometries)`/`optimize(geometry)`(顶点去重 + 索引重排)/`computeNormals()`/`generateLOD(levels)`/`weld(epsilon)`(顶点焊接);输出 `BufferGeometry`
- `ImportPipeline` — 模型导入:封装「加载 → 解析 → 优化 → 注册」完整流程,内部委托 `GLBLoader`/`FBXLoader` 等 + `GeometryProcessor`/`TextureProcessor`;输出 `ImportResult { scene, materials, animations, metadata }`
- **为什么与 Loaders 分离?** Loaders 是「格式适配器」(单一职责:把文件格式变成引擎对象);Pipeline 是「编排器」,组合多个处理步骤(如导入时自动生成 LOD + 压缩纹理 + 顶点焊接),长链路处理跨 Loaders/Assets/Materials,独立模块避免 Loaders 膨胀

### 游戏玩法系统 (Gameplay/)

- 与 Events/、Scripting/ 互补:Events 提供通用 pub/sub,Scripting 提供生命周期钩子,Gameplay 提供上层 RPG 玩法原语(NPC 对话/任务/物品栏),三者组合可构建完整 RPG 玩法
- `DialogueSystem` — 对话系统主控:`start(dialogueId, participantId)` 开始对话 / `advance()` 推进到下一节点 / `chooseOption(idx)` 选择分支 / `end()` 结束;持 `currentDialogue` + `dialogueHistory` + `participants: Map<id, DialogueParticipant>`;通过 `EventBus` 派发 `dialogue:start`/`dialogue:advance`/`dialogue:end` 事件
- `DialogueTree` — 对话树:持 `nodes: Map<id, DialogueNode>` + `rootId` + `entryId`;`DialogueNode { id, speaker, text, options: DialogueOption[], condition?, action?, nextId? }`,`DialogueOption { text, nextId, condition?, action? }`;`loadFromJSON(json)` / `saveToJSON()` 往返序列化;`condition` 为可选谓词函数(运行时注入,不进 JSON)
- `DialogueParticipant` — 对话参与者:`id`/`name`/`portrait`/`mood`/`voice`;`setMood(mood)` / `setVoice(voiceId)` 运行时切换表情与音色
- `QuestSystem` — 任务系统:`quests: Map<id, Quest>` + `activeQuests: Set<id>` + `completedQuests: Set<id>`;`Quest { id, title, description, objectives: QuestObjective[], rewards, state, prerequisites }`,`QuestObjective { id, description, type, target, count, current, completed }`;`startQuest`/`completeObjective`/`abandonQuest`/`progressObjective(questId, objId, amount)`/`canStartQuest`(检查前置);通过 EventBus 派发 `quest:started`/`quest:completed`/`quest:objective` 事件
- `InventorySystem` — 物品栏:`items: Map<id, InventoryItem>` + `maxSlots` + `currency`;`InventoryItem { id, name, count, type, data, stackable }`;`addItem`/`removeItem(id, count)`/`hasItem(id, count?)`/`swap(a, b)`/`addCurrency`/`spendCurrency`;可堆叠物品自动合并,超出 maxSlots 返回 false
- **为什么独立模块?** 对话/任务/物品栏是 RPG 玩法原语,与 ECS 数据组件(Health/Velocity)关注点不同:玩法层有状态机(对话节点/任务流程)与序列化需求(存档),独立模块避免污染 ECS 核心;与 Scripting/ 配合可实现 NPC 脚本驱动对话

### .vreen 包格式

- ZIP 容器: manifest.json + scene.json + 嵌入资源 (GLB/纹理) + world.json
- `.vreen-delta` 增量差分包
- 多语言 SDK: Java POJO, Kotlin, C#, C++, Unity 插件, Unreal 插件

### 行为树 (AI/BehaviorTree + Blackboard)

- 与 NavMesh/PathFinder/SteeringBehavior/Agent 互补:导航解决「怎么走」,行为树解决「做什么」
- `BehaviorTree` — 树状决策结构,从根节点每 tick 评估,返回 `Success` / `Failure` / `Running`
- `BTNode` — 行为树节点基类,子类: `BTAction`(执行动作) / `BTComposite`(组合:Sequence/Selector/Parallel) / `BTCondition`(条件判断) / `BTDecorator`(装饰器:Inverter/Repeater/RetryUntilSuccess)
- `Blackboard` — 共享键值存储 (任意类型值),节点读写以解耦节点间数据流;支持 `get`/`set`/`has`/`unset` + 监听器
- 与 `Scripting/` 互补:行为树是数据驱动的有限状态决策,Scripting 是代码驱动的生命周期钩子;二者都可操作同一 ECS `World`

### 环境增强 (Environment/VegetationSystem + WaterSystem)

- `VegetationSystem` + `VegetationType` — 程序化植被分布:基于地形/噪声密度图采样植被位置,按 `VegetationType`(草/灌木/树)实例化 mesh;支持 impostor billboard 远距渲染
- `WaterSimulation` — 水面顶点位移 + 法线扰动 (Gerstner 波) + 折射/反射近似;`getMeshData()` 输出 positions/normals
- `WaterSystem` — 场景级水体管理 (水位/水流方向/水质参数),驱动多个 `WaterSimulation` 实例 + 与 `WaterMaterial` 配合渲染
- 与 `SkySystem` 联动:水面反射天空颜色;与 `WeatherSystem` 联动:雨天波纹增强

### 延迟渲染与反射探针 (Renderer/DeferredRenderer + ReflectionProbe)

- `DeferredRenderer` — 替代 `WebGL2Renderer` 的延迟后端:G-Buffer Pass (4 附件:position/normal/albedo/material) → 全屏 Lighting Pass;光数与片元数解耦,适合多光源场景
- `ReflectionProbe` — 局部 IBL 探针,捕获场景立方体贴图快照 (位置/范围/捕获频率);运行时按相机位置加权混合
- `ReflectionProbeManager` — 探针注册表 + 相机位置查询最近探针 + 跨探针平滑过渡
- 与 `GBuffer`/`MRTTarget` 协作:G-Buffer 是延迟渲染的几何输入;ReflectionProbe 是 IBL 输入;二者都是 FBO/纹理生命周期管理类

### 高级后处理 Pass (Renderer/PostProcess/ 扩展)

- 在基础 Pass (Bloom/ChromaticAberration/Vignette/SSAO/FXAA/ToneMapping/Gamma/DOF) 之上,扩展了:
  - `AutoExposurePass` — 自动曝光,基于平均亮度自适应曝光值
  - `DOFEnhancedPass` — 增强景深,散景 (bokeh) + 弥散圆 (circle-of-confusion)
  - `GTAOPass` — Ground-Truth Ambient Occlusion (SSAO 的精度提升版)
  - `MotionBlurPass` — 物体/相机运动模糊,消费 `VelocityPass` 速度缓冲
  - `SSRPass` — 屏幕空间反射
  - `SSSSPass` — 屏幕空间次表面散射 (皮肤/蜡质感)
  - `TAAPass` — 时域抗锯齿,需配合 `VelocityPass`
  - `VelocityPass` — 逐像素运动矢量 (TAA/MotionBlur 共用)
  - `VolumetricFogPass` — 体积雾 / 光轴效果
- 所有 Pass 实现 `RenderPass` 接口,组合进同一 `PostProcessingPipeline`

### 特殊用途材质 (Materials/ 扩展)

- 在 PBR 与基础材质之上,扩展了:
  - `MatcapMaterial` — Material Capture,预烘焙法线→颜色球体贴图,无光照快渲染;常用于雕刻软件风格
  - `ToonMaterial` — 卡通渲染 (cel-shading),量化 N·L 为离散色带;可配 `OutlineMaterial` 描边
  - `OutlineMaterial` — 背面外描边,沿法线膨胀 + 平面色;用于卡通/动漫风格
  - `WaterMaterial` — Gerstner 波水面 + 阳光闪烁 + 屏幕折射近似 + 深度泡沫;与 `WaterSystem` 配合
  - `WireframeMaterial` — 风格化线框,与标准材质的 `wireframe: true` 区别:可着色 + 可深度衰减
- 多数继承 `BasicMaterial` 基类 (复用 uniform/texture 基础设施 + 自定义 shader)

### 相机预设与电影相机 (Cameras/ + 预设)

- 检视器内置 9 个相机预设 (Free / Iso / Front / Back / Side / Top / 1st-person / 3rd-person / Cinematic),通过 `viewerStore` 切换
- `CinematicCamera` 不是一个独立模块,而是 Cinematic 预设对应的相机配置:慢速轨道 + FOV 呼吸 + 景深联动 + 后处理过冲,通过组合 `PerspectiveCamera` + `OrbitControls` + 后处理 Pass 实现
- 底层仅 `PerspectiveCamera` / `OrthographicCamera` 两个具体相机类

### 计划中模块 (未实现)

- `CrowdSystem` — 群体避障 (基于 RVO/ORCA + SteeringBehavior 上层封装),计划在 AI/ 子目录下实现,目前尚未落地;现有 Agent + SteeringBehavior 已可处理小规模群体
- 见 `ROADMAP.md` Phase 4/5 了解未来模块规划

### 代码规范

- **ESM 模块** — `import`/`export`，不用 CommonJS
- **命名** — camelCase 变量/函数, PascalCase 类/组件/类型
- **路径别名** — `@/` 映射到 `src/`
- **日志** — 通过 `lib/logger.ts` 的 `createLogger(module)` 统一输出
- **i18n** — 所有用户可见文本走 i18next keys

## 🚀 开发命令

| 命令                       | 说明                          |
| ------------------------ | --------------------------- |
| `npm run dev`            | 启动 Vite 开发服务器               |
| `npm run typecheck`      | TypeScript 类型检查             |
| `npm run build`          | `tsc -b && vite build` 生产构建 |
| `npm run engine:build`   | 构建 @vreen/engine 包          |
| `npm run electron:dev`   | Electron 开发模式               |
| `npm run electron:build` | Electron 生产构建 (.exe)        |
| `npm run vreen`          | .vreen CLI 工具               |

### 测试

- `npm test` / `npm run test:watch` / `npm run test:coverage`
- Vitest 4 + @vitest/coverage-v8;测试文件与源码同目录 `*.test.ts`
- 当前测试数量:**3361+**(200+ 个测试文件,覆盖 Math / Core / ECS / Animation / Physics / Renderer / Loaders / Materials / Particles / Audio / Terrain / Network / SaveSystem / SceneManager / Input / AI / Environment / Timeline / Voxel / Editor / PCG / Pipeline / Gameplay 等 42+ 模块)

## 📌&#x20;
