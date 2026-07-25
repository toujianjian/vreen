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
│   ├── Renderer/            # WebGL2Renderer, ShaderProgram, RenderPass, ShadowMapManager + MRTTarget/GBuffer (延迟渲染) + 后处理 (Bloom/ChromaticAberration/Vignette/SSAO/FXAA/ToneMapping/Gamma/DOF + PostProcess/ 增强 Pass: ColorGrading/LUT/ FilmGrain/Afterimage/Pixelation)
│   ├── Materials/           # StandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshNormalMaterial, ShadowMaterial, SpriteMaterial, ShaderMaterial (+onBeforeCompile), ShaderChunks/ 子目录 (10 GLSL 片段 + ShaderChunkRegistry)
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
│   ├── AI/                  # AI 导航 (NavMesh 导航网格 + A* PathFinder 寻路 + SteeringBehavior 转向行为 + Agent 代理)
│   ├── Environment/         # 环境系统 (WeatherSystem 天气 + SkySystem 天空/日夜循环 + CloudSystem 云层 + PrecipitationSystem 降水)
│   ├── Timeline/            # 时间轴/Sequencer (TimelineClip 片段 + TimelineTrack 轨道 + EventTrack 事件 + PropertyTrack 属性关键帧 + TimelineSequencer 序列器,支持 play/pause/seek/loop/export/import)
│   ├── Voxel/               # VoxelChunk 16³ + VoxelWorld 多块管理 + VoxelMesher 贪婪网格合并 + VoxelRaycaster DDA + VoxelPalette 类型表
│   └── Editor/              # 编辑器系统:SelectionSystem 选择/拾取 + TransformGizmo 变换手柄 (translate/rotate/scale) + UndoRedoSystem 撤销重做 (含 beginGroup/endGroup) + EditorCommands 命令工厂 (Move/Rotate/Scale/Add/Remove/Property) + SnapSystem 网格/角度/缩放吸附
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

### .vreen 包格式

- ZIP 容器: manifest.json + scene.json + 嵌入资源 (GLB/纹理) + world.json
- `.vreen-delta` 增量差分包
- 多语言 SDK: Java POJO, Kotlin, C#, C++, Unity 插件, Unreal 插件

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
- 当前测试数量:**3128+**(192 个测试文件,覆盖 Math / Core / ECS / Animation / Physics / Renderer / Loaders / Materials / Particles / Audio / Terrain / Network / SaveSystem / SceneManager / Input / AI / Environment / Timeline / Voxel / Editor 等 39+ 模块)

## 📌&#x20;
