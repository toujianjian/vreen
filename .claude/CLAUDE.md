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

- **代码行数**: 228K+ (含引擎 + 应用 + 测试;引擎源码 108K+ + 引擎测试 ~90K + 应用 ~30K)
- **测试数量**: 11600+ (446 个测试文件,全量回归 11606 tests 全绿)
- **引擎模块**: 42 个顶层模块 (本批次新增 8 个:Curves/SurfaceData/Shapes/Vegetation/LocalUser/ScriptCanvas/WhiteBox + PassGraph 作为 Renderer 子模块)
- **源码文件**: 450+ (`src/engine/`, 不含测试) + 440 测试文件
- **Commits**: 73
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
│   ├── Core/                # 场景图 (Object3D/Scene/Group/Mesh/SkinnedMesh/Bone/Skeleton/BufferGeometry/BufferAttribute/InstancedBufferAttribute/Material/InstancedMesh/LOD/Sprite/Text/BitmapText/TextAtlas) + 纹理家族 (Texture/CubeTexture/DataTexture/DataArrayTexture/DepthTexture/VideoTexture/CanvasTexture/CompressedTexture) + Source + MorphTargets/MorphTargetAnimation + Fog/FogExp2 + Raycaster + DirtyFlag/SceneGraphProcessor/FrustumCuller/SceneStats + ModuleRegistry (Gem 风格模块注册)
│   ├── Renderer/            # WebGL2Renderer, ShaderProgram, RenderPass, ShadowMapManager + MRTTarget/GBuffer (延迟渲染) + DeferredRenderer (替代延迟后端) + ForwardPlusRenderer (Forward+ 分块光源剔除) + ReflectionProbe/ReflectionProbeManager (IBL 探针) + GlobalIllumination (光探针 SH2 + VXGI 简化版) + GPUDrivenRenderer (GPU 驱动渲染管线原型) + RenderGraph (Frostbite FrameGraph 风格渲染图,资源依赖+拓扑排序+生命周期) + RenderPipelineManager (Forward/Deferred/Forward+ 管线编排器,质量等级切换) + ContactShadowsPass (接触阴影) + GTAOPass (顶层 GTAO) + 后处理 (基础: Bloom/ChromaticAberration/Vignette/SSAO/FXAA/ToneMapping/Gamma/DOF; PostProcess/ 增强: ColorGrading/LUT/FilmGrain/Afterimage/Pixelation/AutoExposure/DOFEnhanced/GTAO/MotionBlur/SSR/SSSS/TAA/Velocity/VolumetricFog) + PathTracer (CPU 参考路径追踪)
│   │   └── PassGraph/       # Pass, PassAttachment, PassTemplate, PassFactory, PassGraph (7 pass 类型: Forward/Deferred/Shadow/Bloom/SSAO/ToneMap/Debug, 数据驱动渲染管线, o3de Atom/RPI 适配)
│   ├── Materials/           # StandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshNormalMaterial, ShadowMaterial, SpriteMaterial, ShaderMaterial (+onBeforeCompile), ShaderChunks/ 子目录 (10 GLSL 片段 + ShaderChunkRegistry), ShaderLibrary (15 预定义着色器模板), ShaderCompiler (#include 预处理 + chunk 注入 + 编译 + 缓存), ShaderVariant (关键字变体 + LRU 缓存), 高级材质: AdvancedPBRMaterial (各向异性+虹彩+clearcoat+sheen), SubsurfaceScatteringMaterial (次表面散射), 特殊材质: FurMaterial/MatcapMaterial/ToonMaterial/OutlineMaterial/WaterMaterial/WireframeMaterial
│   ├── Math/                # Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Ray, Line3, Triangle, Frustum, MathUtils + Spherical(球坐标) + Cylindrical(柱坐标, three.js 适配)
│   ├── Cameras/             # PerspectiveCamera, OrthographicCamera, CinematicCamera (电影级镜头序列), CameraRig (摇臂/轨道跟随)
│   ├── Lights/              # Ambient/Directional/Point/Spot/Hemisphere/RectArea + DirectionalLightShadow + ShadowMapManager + LightProbe/AmbientLightProbe/HemisphereLightProbe + SphericalHarmonics3 (球谐光探针, three.js 适配)
│   ├── Loaders/             # GLB/OBJ/FBX/HDR/KTX2/STL/PLY/TGA/MTL/EXR Loader + TextureLoader + DracoDecoder + AssetManager + 4 导出器 (OBJExporter/GLTFExporter/STLExporter/PLYExporter) + GLTFExtensionLoader (扩展加载器,支持 DRACO/KTX2 + KHR/EXT 扩展注册)
│   ├── Animation/           # AnimationMixer/AnimationClip/AnimationAction/AnimationStateMachine/BlendSpace1D/Humanoid + AnimationLayer/AnimationLayerMixer/BoneMask/AvatarMask/AdditiveBlend/AnimationSync + IK (IKBone/IKChain/IKSolver(FABRIK)/CCDSolver/IKHumanoid) + IKSystem (高层逆运动学,直接操作 Object3D 关节链,FABRIK/CCD 双求解器) + ProceduralAnimation (程序化动画,8 种节点:headTrack/breathing/walkCycle/runCycle/idleSway/lookAt/reach/secondaryMotion) + RootMotionExtractor (根运动提取,修复角色滑步,o3de EMotionFX 适配)
│   ├── ECS/                 # World, ComponentType, Components, Systems, PhysicsComponents (含 Constraint: Ball/Hinge/Slider/Fixed/Distance), PhysicsSystems (含 ConstraintSolver), Prefab, QueryBuilder, Broadphase
│   ├── Controls/            # OrbitControls, FlyControls, PointerLockControls, MapControls, CharacterController (kinematic 角色), SweptCharacterController (扫掠 CC + 滑墙 + 坡度判定, o3de PhysX 适配), VRController (WebXR VR/XR 支持,头显位姿+双眼视图+手柄追踪)
│   ├── Geometries/          # Box/Sphere/Cylinder/Cone/Torus/Plane/Circle/Ring/Capsule/TorusKnot/Lathe/Extrude/Shape/Wireframe/Edges + InstancedGeometry (实例化几何体) + ConvexGeometry (QuickHull 凸包) + ParametricGeometry (参数曲面) + DecalGeometry (贴花投影) + TubeGeometry (沿 Curve 生成管状几何 + Frenet 帧, three.js 适配) + Primitives barrel
│   ├── Helpers/             # GridHelper, GridHelper3D, AxesHelper, BoxHelper, CameraHelper, ArrowHelper, LineHelper, PhysicsDebugRenderer + PolarGridHelper(极坐标网格) + Box3Helper(Box3 包围盒可视化) + PlaneHelper(平面可视化, three.js 适配)
│   ├── Events/              # EventBus, EventQueue, GameEvent (CollisionEvent/TriggerEvent/SpawnEvent/DestroyEvent/ScoreEvent/CustomEvent) - 类型化 pub/sub
│   ├── Scripting/           # ScriptComponent/ScriptC, ScriptSystem, ScriptRegistry, CoroutineSystem - 代码驱动脚本层 (与 Blockly 互补) + VisualScriptComponent (Script Canvas 风格可视化脚本组件)
│   ├── Particles/           # ParticleSystem2, ParticleEmitter, ParticleModifier (Force/Vortex/Turbulence/ColorOverLife/SizeOverLife/VelocityOverLife/SubEmitters), ParticleCurve (Constant/Linear/Bezier/Random), TrailModule, ParticleData - 高级 CPU 粒子系统 (与 ECS ParticleSystem 分离)
│   ├── Audio/               # AudioListener, Audio, PositionalAudio, AudioLoader, AudioAnalyser, SpatialAudio (HRTF + 距离衰减 + 多普勒效应), AudioEffects (混响/均衡/压缩/低通/回声/合唱效果链)
│   ├── Terrain/             # TerrainGeometry, HeightmapGenerator, TerrainSplat, TerrainLayer, TerrainErosion (热力/水力/风力侵蚀)
│   ├── Acceleration/        # BVH, BVHBuilder, MeshBVH
│   ├── Assets/              # AssetCache (LRU), AssetRegistry (引用计数), AssetLoader (异步加载) - 资源生命周期管理 (与 Loaders/AssetManager 互补) + AssetBundle (资源包打包/加载,依赖清单) + TextureStreaming (纹理流式加载,mipmap 分级按需上传)
│   ├── Serialization/       # SerializerRegistry, GeometrySerializer, MaterialSerializer, SceneSerializer - 场景/几何体/材质 ↔ JSON 往返
│   ├── Tools/               # Profiler (CPU/GPU mark), FrameProfiler (帧级 FPS), SystemProfiler (ECS 系统耗时), MemoryTracker (分配/泄漏), GpuProfiler (timer query), PerformanceReport (文本/JSON 报告) + LODManager (距离/屏幕占比 LOD + HLOD) + Profiler2 (帧/区域/事件 + Chrome Trace 导出) + ConsoleCommands (编辑器控制台命令系统:注册/执行/补全/历史 + 25 预置命令跨 8 分类)
│   ├── Physics/             # PhysicsDemo + ConstraintSolver + Joint 约束 (Ball/Hinge/Slider/Fixed/Distance) + ConstraintSystem (ECS 侧约束系统,可断裂约束,驱动 ConstraintSolver) + CollisionSystem (BVH/SAT/GJK/EPA 三段式碰撞管线,球/盒/胶囊/凸包/网格) + ClothSimulation (Verlet 布料) + RopePhysics (Verlet 链绳索,距离约束+弯曲约束+风力+碰撞) + FluidSimulation (SPH 流体) + DestructionSystem + VoronoiFracture + Buoyancy (浮力模拟,阿基米德原理 + 阻尼 + 波高采样)
│   ├── Network/             # NetworkSync (服务器权威同步) + Snapshot (二进制快照序列化/压缩) + NetworkTransport (WebSocket/Mock 传输抽象) + NetworkLerp (位置/旋转插值 + 预测 + 和解) + StateSync (快照插值 + Delta 压缩,纯数据层) + LagCompensation (历史回溯延迟补偿,服务器命中 rewind + 客户端插值) + NetworkSession (会话生命周期,lobby/loading/playing/paused/ended 状态机,槽位+主机权威) + NetworkTime(网络时间轴+时钟同步) + RewindableObject(可回滚对象包装) + InputHistory(客户端输入环形缓冲) + ClientPrediction(客户端预测+服务器和解, o3de Multiplayer 适配)
│   ├── SaveSystem/          # SaveSystem (多槽位 + 自动保存) + SaveSerializer (Scene+World ↔ SaveData,含压缩) + LocalStorageAdapter (localStorage/内存兜底)
│   ├── SceneManager/        # SceneManager (多场景注册/加载/切换) + SceneTransition (Fade/Crossfade/Slide/Wipe/None 过渡) + SceneStreaming (场景流式加载/卸载,分块按需载入)
│   ├── Input/               # InputManager (统一键盘/鼠标/触摸/手柄) + KeyboardState/MouseState/TouchState/GamepadState + InputAction (动作映射) + InputMap (JSON 配置往返)
│   ├── AI/                  # AI 导航 + 行为树 (NavMesh 导航网格 + A* PathFinder 寻路 + SteeringBehavior 转向行为 + Agent 代理) + 行为树 (BehaviorTree/BTAction/BTComposite/BTCondition/BTDecorator/BTNode + Blackboard 黑板) + CrowdSystem (大规模人群调度 + Reynolds separation 避障) + SpatialGrid (2D XZ 邻域加速) + PerceptionSystem (AI 感知:视觉锥+听觉+LOS+意识等级) + MLInterface (机器学习接口:ModelAdapter 契约 + TFJS 适配 + MLAgent 感知→模型→动作)
│   ├── Environment/         # 环境系统 (WeatherSystem 天气 + SkySystem 天空/日夜循环 + ProceduralSky 程序化天空着色 (Preetham 大气散射) + CloudSystem 云层 + VolumetricClouds 体积云 (Perlin+Worley 噪声 + 光线步进 + Beer-Lambert 透射) + PrecipitationSystem 降水 + VegetationSystem/VegetationType 植被分布 + VegetationRenderer 植被实例化渲染 (LOD+风摆动+季节) + WaterSimulation/WaterSystem 水体 + FFTOcean FFT 海洋 (Tessendorf 统计波浪模型 + Phillips 频谱 + 逆 FFT) + WaterInteraction 水面交互 (双向耦合:物体→涟漪 + 水→浮力))
│   ├── Timeline/            # 时间轴/Sequencer (TimelineClip 片段 + TimelineTrack 轨道 + EventTrack 事件 + PropertyTrack 属性关键帧 + TimelineSequencer 序列器,支持 play/pause/seek/loop/export/import)
│   ├── Voxel/               # VoxelChunk 16³ + VoxelWorld 多块管理 + VoxelMesher 贪婪网格合并 + VoxelRaycaster DDA + VoxelPalette 类型表
│   ├── Editor/              # 编辑器系统:SelectionSystem 选择/拾取 + TransformGizmo 变换手柄 (translate/rotate/scale) + UndoRedoSystem 撤销重做 (含 beginGroup/endGroup) + EditorCommands 命令工厂 (Move/Rotate/Scale/Add/Remove/Property) + SnapSystem 网格/角度/缩放吸附
│   ├── PCG/                 # 程序化内容生成 (NoiseGenerator Perlin/Simplex/Worley/FBM + BuildingGenerator + BuildingGenerator2 (5 风格/4 屋顶/装饰/内部,种子化) + CityGenerator + DungeonGenerator + TreeGenerator + RoadGenerator (Catmull-Rom 样条道路+地形跟随+交叉路口) + CharacterGenerator (人形角色拼装,5 种族/4 体型/服装配饰,带简化 Skeleton)) - 产出 BufferGeometry/布局元数据,不绑定 Material/Scene
│   ├── Pipeline/            # 资源管线 (AssetPipeline 步骤序列 + TextureProcessor 纹理处理 + GeometryProcessor 几何体处理 + ImportPipeline 模型导入) - 与 Loaders/AssetManager 互补:Loaders 关注解析,Pipeline 关注处理与优化
│   ├── Curves/              # Curve 基类 + CurvePath + 9 具体曲线 (CatmullRom/CubicBezier/QuadraticBezier/Line/Arc/Ellipse/SplineCatmullRom 等) + Path (2D 路径) + Shape (2D 轮廓) + ShapeUtils + Earcut (三角剖分, three.js src/extras 适配)
│   ├── SurfaceData/         # SurfaceTag (表面标签位掩码) + SurfacePoint (位置+法线+标签) + SurfaceDataProvider (查询契约) + SurfaceDataSystem (多 Provider 注册/合并) + TerrainSurfaceProvider (地形→表面点, o3de Gems/SurfaceData 适配)
│   ├── Shapes/              # Shape 抽象基类 (SDF + 射线相交 + AABB) + 8 具体形状 (Box/Sphere/Capsule/Cylinder/Disk/Quad/Tube/Compound 复合, o3de Gems/LmbrCentral/Shape 适配)
│   ├── Vegetation/          # VegetationDescriptor (植被描述符) + 6 Filters (Distance/ShapeIntersection/SurfaceMask/Distribution/ShapeSurface/Blocker) + 4 Modifiers (Scale/Rotation/Position/Alignment) + SpawnerArea (生成区域) + AreaBlender (区域混合, o3de Gems/Vegetation 适配)
│   ├── LocalUser/           # LocalUserProfile (本地用户配置) + LocalPlayerSlot (玩家槽位) + LocalUserManager (多用户管理 + 槽位分配, o3de Gems/LocalUser 适配)
│   ├── ScriptCanvas/        # ScriptNode (节点基类) + ScriptGraph (DAG 图) + ScriptExecutor (执行引擎) + 18 内置节点类型 (事件/动作/条件/变量/函数/数学/逻辑/向量/字符串/分支等, o3de Gems/ScriptCanvas 适配)
│   ├── WhiteBox/            # HalfEdgeMesh (半边网格结构) + WhiteBoxShapes (box/tetrahedron/icosahedron/staircase greyboxing 基元) + Csg (union/subtract/intersect 布尔运算, o3de Gems/WhiteBox 适配)
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
- `IKSystem` — 高层逆运动学系统,直接操作 `Object3D[]` 关节链(读写场景图节点 position/rotation);内置 FABRIK(位置空间求解,收敛快)与 CCD(旋转空间求解,天然兼容旋转约束)两种求解器,支持 `poleTarget` 极向量与 `IKConstraint` hinge 关节约束;与 `Animation/IK/` 子模块互补(IK/ 子模块用自研 IKBone 类独立于场景图,IKSystem 直接驱动场景图节点)
- `ProceduralAnimation` — 程序化动画系统,在骨骼动画之上叠加无数据程序化运动(正弦/噪声/物理近似):8 种 `ProceduralNode` 类型 — `headTrack`(头部追踪)/ `breathing`(呼吸)/ `walkCycle`/`runCycle`(步态生成)/ `idleSway`(待机摇摆)/ `lookAt`/ `reach`(简化伸手,精确 IK 用 IKSolver)/ `secondaryMotion`(二次运动);每节点绑定一根骨骼 + 权重 + 参数表,`update(dt, skeleton)` 按 type 分派,权重做 slerp 混合(0=不影响);修改骨骼 LOCAL rotation/position(与 AnimationMixer 一致,后续 updateMatrixWorld 统一算世界矩阵);与 `AnimationMixer` 互补(Mixer 播预录 clip,本类生成程序化微动,二者可串联)

### 物理系统

- 固定步长 semi-implicit Euler 积分 + 四元数旋转积分
- Broadphase + narrowphase 碰撞检测 + 冲量响应 + Baumgarte 矫正
- 支持 AABB/Sphere/Capsule collider
- Constraint 子系统 — `BallJointConstraint` / `HingeJointConstraint` / `SliderJointConstraint` / `FixedJointConstraint` / `DistanceJointConstraint`，由 `ConstraintSolver` 迭代求解 (基于 `Constraint` 基类 + `RigidbodyLike` 接口,与任意刚体实现解耦)
- `ConstraintSystem` — 高层物理约束/关节管理器,与 `ConstraintSolver` 互补:Solver 持 `Constraint` 子类实例面向"组装约束图",System 持扁平 `PhysicsConstraint` 描述符(id 索引)面向"运行时增删/配置/断裂检测"(编辑器/关卡脚本);求解沿用 Sequential Impulse + Baumgarte 稳定化(位置投影修正 + 速度修正冲量);支持可断裂约束(累计本帧冲量超 `breakForce` 标记 `isBroken`,后续 solve 跳过);约束类型 fixed/hinge/ball/slider/spring/cone + `ConstraintLimit`(min/max/bounciness)
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
- `GLTFExtensionLoader` — 增强版 GLTF 加载器 (参考 three.js GLTFLoader):在 `GLBLoader` 之上叠加扩展注册机制 (`registerExtension` 支持 KHR_*/EXT_* 处理器) + DRACO 解码器注入 (`setDRACODecoder`) + KTX2 解码器注入 (`setKTX2Decoder`) + URL→场景缓存 + 细粒度 parse* API;实际 JSON+BIN 解析仍委托 `GLBLoader.parseGLB` + `buildFromGltf`

### 几何体 (Geometries/)

- 15 个程序化基元 — Box / Sphere / Cylinder / Cone / Torus / Plane / Circle / Ring / Capsule / TorusKnot / Lathe / Extrude / Shape(2D 轮廓) / Wireframe / Edges
- `InstancedGeometry` — 实例化几何体 (参考 three.js InstancedBufferGeometry):在 `BufferGeometry` 之上叠加 per-instance `instanceMatrix`(16 float column-major mat4) / `instanceColor`(RGBA) / `customAttributes`(Map<name, Float32Array>);显式 `allocate(n)` / `setInstanceMatrix` / `getInstanceMatrix` API;与 `Core/InstancedMesh` 的差异:InstancedMesh 是场景对象(Mesh + raycast),InstancedGeometry 是纯几何数据(缓冲分配/读写/序列化),渲染器从中读取并配置 `vertexAttribDivisor`
- `Primitives.ts` 统一 barrel 导出

### 控制器 (Controls/)

- `OrbitControls`(默认) / `FlyControls`(自由飞行) / `PointerLockControls`(第一人称) / `MapControls`(俯视地图)

### Helpers (Helpers/)

- `GridHelper` / `GridHelper3D`(3D 体素网格) / `AxesHelper` / `BoxHelper` / `CameraHelper` / `ArrowHelper` / `LineHelper` / `PhysicsDebugRenderer`

### 音频 (Audio/)

- `AudioListener` / `Audio`(非空间) / `PositionalAudio`(3D 空间) / `AudioLoader` / `AudioAnalyser`(FFT)
- `SpatialAudio` — 3D 空间音频 (HRTF + 距离衰减 + 多普勒效应):与 `PositionalAudio`(把空间化交给浏览器 PannerNode 黑盒)不同,本类自行计算 ITD(双耳时间差,Woodworth 公式) + ILD(双耳强度差) + 多普勒频移(`dopplerShift = c/(c + dopplerFactor·vRadial)`),显式驱动 gain / playbackRate / StereoPannerNode.pan;节点链 `source → filters → stereoPanner → gain → listener`;「白盒空间化」便于测试与离线渲染复现,`lastHRTF` 等字段暴露每帧结果;支持 linear/inverse/exponential 三种距离衰减模型
- `AudioEffects` — 离线音频效果链(纯 DSP,不依赖 AudioContext):可任意组合/重排序的样本级效果链 — reverb(Schroeder 4 并联 comb + 2 串联 allpass)/ echo / chorus / distortion(tanh 软削波)/ lowpass / highpass / compressor(feed-forward 峰值检测 + 一阶平滑包络)/ flanger(LFO 调制可变延迟线);输入输出都是 `Float32Array`(单声道 PCM),不绑定 Web Audio 节点图,便于离线预渲染/测试/录音后处理;每效果自带内部状态(延迟线/滤波器状态/LFO 相位),跨 `process` 调用保持连续;与 `Audio`/`PositionalAudio` 互补(后者走浏览器节点图,本类是引擎内纯 JS DSP)
- 共享 `AudioContext`，测试用 `audioContextMock.ts`

### 地形 (Terrain/)

- `TerrainGeometry`(高度场网格) / `HeightmapGenerator`(分形噪声/水力侵蚀) / `TerrainSplat`(splat 贴图混合) / `TerrainLayer`(层元数据)
- `TerrainErosion` — 程序化地形侵蚀系统:在已有高度图上叠加自然侵蚀效果,三种机制互补 — 热力侵蚀(thermal,重力驱动松散物蠕动,坡脚堆积,超休止角部分转移给最低邻居) / 水力侵蚀(hydraulic,雨滴沿最陡下降路径流动,沿途侵蚀与沉积,Particle-based Hydraulic Erosion 简化版) / 风力侵蚀(wind,沿风向搬运表层物质,顺风下坡搬运,迎风坡风影效应);不依赖 `TerrainGeometry`,输入仅为 `Float32Array` 高度图 + 宽高;`erosionMap` 同步记录净侵蚀量;`mulberry32` PRNG 保证种子可控
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
- `VisualScriptComponent` — Script Canvas 风格可视化脚本组件 (参考 o3de Gems/ScriptCanvas):持有 `ScriptNode` 图(`event`/`action`/`condition`/`variable`/`function` 节点类型,经 `ScriptPin` 连接);`start()`/`stop()`/`update(dt)` 触发命名事件,`handleEvent(name, args)` 从匹配的 event 节点沿 exec-output 链执行(function 节点调 `registerFunction` 回调,variable 节点 get/set 共享 `variables`,condition 节点路由到 true/false 分支,action 节点调自定义 handler);带环检测;`exportGraph()`/`importGraph()` 往返 JSON (数据驱动,可序列化进 `.vreen`);与代码驱动的 `ScriptComponent` 互补 (前者面向非程序员,后者处理复杂逻辑)
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
- `AssetBundle` — 资源打包/加载系统 (参考 Unity AssetBundle / O3DE Asset Seed):把多个资源(mesh/texture/audio/animation/material/scene)打包成有名 bundle,带 manifest(资产清单 + 校验 hash + 依赖声明),支持并发加载限流(`maxConcurrentLoads` + 队列)、缓存与卸载;与 `AssetManager` 互补:AssetManager 关注"按 format/source 解析缓存"(细粒度),AssetBundle 关注"按业务包加载/卸载"(粗粒度,一个场景/角色/关卡一个包);数据源由调用方注入(保持零运行时依赖)
- `TextureStreaming` — 纹理流式加载系统(Mipmap streaming + 按需加载):按"距相机距离/屏幕占比"动态决定每张纹理加载到哪个 mip 级别(近处/大占比加载高精度 mip,远处/小占比只加载低精度 mip);`maxMemoryUsage` 上限做 LRU 驱逐(超限卸载低优先级纹理 mip 链);`StreamingTexture` 持 `baseTexture` + `loadedMips`(0..mipLevels),`requestMipLevel`/`update` 后 bump `baseTexture.version` 触发 renderer 重传;与 `AssetRegistry`(引用计数)互补:后者管实例生命周期,本类管 mip 级别动态调度

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
- `LODManager` — 场景级 LOD 管理系统:统一管理多个 `LODGroup`(每个 Group 对应一个 `Object3D` + 多精度级别);两种切换策略 — 距离 LOD(按相机到 Group 世界位置的距离,`lodDistances` 阈值)/ 屏幕占比 LOD(按包围盒在屏幕投影占比,`screenSpaceThreshold`);HLOD(超 `hlodDistance` 隐藏整个 Group,由调用方替换为合并代理 mesh 减远距 draw call);`getLODStats()` 提供统计;与 `Core/LOD` 互补(LOD 是单节点自动切换,LODManager 是场景级多 Group + 全局策略)
- `Profiler2` — 增强版分析器,三层语义:**帧**(per-frame 总量 — FPS/dt/draw calls)/ **区域**(命名 CPU 区间,`beginZone(name)`/`endZone(name)` 线程局部栈嵌套)/ **事件**(一次性时间戳标记 `event(name, payload?)`);ring buffer(默认 10k 事件);`exportChromeTrace()` 导出 `chrome://tracing` JSON schema 供离线分析;补充原始 `Profiler`(per-frame mark 区间) — Profiler2 添加事件时间线视图诊断"帧 N 发生了什么"
- `ConsoleCommands` — 编辑器控制台命令系统(REPL):注册/执行/补全/历史,支撑 `EngineConsole.tsx` 面板。每个 `ConsoleCommand` 声明 `name`/`description`/`usage`/`args`(类型化:string/number/boolean/vector3)/`handler`/`category`。`execute(input)` 分词(支持双引号包裹 + `\"` 转义,可传 JSON)、校验参数、分发 handler、捕获异常返回 `"Error: <msg>"`。支持别名(`registerAlias`)、历史(`addToHistory`/`getHistory`/`maxHistory` 裁剪)、前缀自动补全(`getAutoComplete`)。`registerAllDefaultCommands(world?, scene?)` 幂等注册 25+ 预置命令跨 8 分类(General/Engine/Scene/Entity/Physics/Rendering/Audio/Debug):`help`/`clear`/`history`/`engine.info`/`scene.load`/`scene.save`/`scene.list`/`entity.create`/`entity.delete`/`entity.list`/`entity.count`/`physics.gravity`/`physics.pause`/`physics.resume`/`render.pipeline`/`render.quality`/`render.screenshot`/`audio.volume`/`audio.play`/`audio.stop`/`debug.stats`/`debug.fps`/`debug.profile`/`debug.systems`/`debug.memory`。依赖注入:`setWorld`/`setScene`/`setFrameProfiler`/`setSystemProfiler`/`setMemoryTracker`,debug 命令在缺少 profiler 时优雅退化为 `"(no X bound)"`。`getDefaultConsoleCommands()` 进程级单例。与 `Scripting/ScriptBindings` 互补(后者向 Blockly/脚本暴露类型化 API,ConsoleCommands 面向开发者 REPL 交互)
- **为什么是工具家族而非单一 profiler?** 每个 profiler 形态不同(ring buffer vs. map vs. set vs. async-query),消费者也不同(HUD vs. leak 排查 vs. CI);拆分让每类小巧可测可独立使用,`PerformanceReport` 提供聚合层;`ConsoleCommands` 加入后 Tools 兼具开发者交互层(REPL),与 ScriptBindings(脚本 API 表面)正交

### 场景辅助 (Core/)

- `Fog` / `FogExp2` — 线性雾 / 指数雾
- `Raycaster` / `intersectGeometry` — 射线场景求交 (优先使用 `MeshBVH`)

### 模块注册系统 (Core/ModuleRegistry)

- `ModuleRegistry` — Gem 风格引擎模块注册系统 (参考 [O3DE Gems](https://github.com/o3de/o3de/tree/development/Gems)):每个 `EngineModule` 声明 `name` / `version` / `description` / `dependencies` + `onLoad` / `onUnload` 生命周期回调 (对应 Gem 的 Activate/Deactivate)
- `registerModule` / `loadModule` / `unloadModule` 管理依赖图 — `loadModule` 递归先加载未满足的依赖,拒绝卸载仍被其他已加载模块依赖的模块
- `exportManifest` / `importManifest` 序列化活跃模块集到/从 JSON (对应项目的 active-Gem 列表);`getDefaultModuleRegistry()` 进程级单例
- 与 `Assets/AssetRegistry` 互补且正交:AssetRegistry 管理资源实例生命周期 (引用计数),ModuleRegistry 管理引擎模块生命周期 (依赖图 + Activate/Deactivate)

### 网络同步 (Network/)

- 服务器权威模型 + 客户端插值/预测;`NetworkSync` 管理同步实体注册与每帧 tick
- `NetworkTransport` — 传输抽象契约,内置 `WebSocketTransport`(浏览器)与 `MockTransport`(测试)
- `Snapshot` — 二进制快照序列化 (实体 Transform + 组件状态),支持压缩以降低带宽
- `NetworkLerp` — 位置/旋转插值 + 客户端预测 + 服务器和解 (reconciliation),平滑远程实体运动
- `createNetworkEntity` 工厂 — 注册同步实体并返回 `NetworkEntity` 句柄
- `StateSync` — 纯数据层网络状态同步 (快照插值 + Delta 压缩):与 `NetworkSync` 不同,不依赖 `NetworkTransport`,上层负责投递 `packSnapshot` 结果 / 喂入 `unpackSnapshot`;服务器/客户端对称(`isServer` 区分),服务器 `createSnapshot` 产出权威快照 + `packSnapshot` 做紧凑+Delta 压缩(只打包 `dirty=true` 实体,数值数组格式节省 ~50% 键名开销),客户端 `applySnapshot` 写入 `remoteEntities` + 推入 snapshots 环形缓冲,`update(dt)` 推进插值/外推(渲染时刻 = now - interpolationDelay,超 `next.ts` 沿 velocity 外推,有最大外推时间限制);实体 id 为 number(与 `NetworkSync` 的 string id 区分)

### 存档系统 (SaveSystem/)

- 与 Scene + World 解耦:`save()` 接收实例,`load()` 返回重建实例
- `SaveSystem` — 多槽位管理 (slotId → SaveSlot) + 自动保存 (每 N 秒触发 source) + import/export 跨实例迁移
- `SaveSerializer` — Scene + World + metadata ↔ `SaveData`,含压缩;委托 `SceneSerializer` / `World.toJSON`
- `LocalStorageAdapter` — 字符串键值存储契约,浏览器用 `localStorage`,Node/测试用 `MemoryStorageBackend` 兜底;所有 key 加前缀避免污染
- `StorageAdapter` 契约可被 IndexedDB / FileSystem 实现替换

### 场景管理 (SceneManager/)

- `SceneManager` — 多场景注册 / 按名切换 / 当前场景跟踪;场景以 `Scene` 实例注册,切换时替换渲染根
- `SceneTransition` — 场景过渡效果 (Fade / Crossfade / Slide / Wipe / None),基于 alpha + 缓动函数;`update(dt)` 推进过渡,完成后回调
- `SceneStreaming` — 场景流式加载系统(分块加载/卸载 + 预加载 + 优先级):与 `SceneManager` 互补(SceneManager 管"整个场景"注册/切换,本类管一个场景内部按空间分块的"流式"加载,开放世界/大场景分块);每个 `SceneChunk` 有 AABB 边界 + objects + assets 引用,按相机位置与 `streamRadius` 决定加载/卸载;加载队列按优先级排序(默认距相机越近越高)受 `maxConcurrentLoads` 限流,支持同步/异步两种模式;卸载队列按 LRU 释放;`preload(center, radius)` 主动预加载,`forceLoad`/`forceUnload` 绕过距离判定用于过场/调试
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

### 人群系统 (AI/CrowdSystem + SpatialGrid)

- `CrowdSystem` — 大规模 AI 代理群体调度器,与 `AI/Agent` 互补(Agent 是单代理导航实体,CrowdSystem 是群体调度器);`CrowdAgent` 是轻量数据结构(position/velocity/target/radius/maxSpeed/state),不持 SteeringBehavior 实例,由 CrowdSystem 共享一个 behavior 完成所有转向
- 算法(每帧 update):① 重建 spatial grid(清空+全量插入);② 对每个代理:若有 navMesh 且距上次寻路 > `pathFindInterval` 重算 path(默认 0.5s,路径缓存节流避免每帧重算 A*);沿 path 下一 waypoint 求 arrive 力;若 avoidance 开启查询 spatial grid 邻居求 separation 力(Reynolds 避障);累加力→半隐式 Euler 积分→截断速度→推进位置;到达目标 → state='arrived';③ 更新代理在 spatial grid 中位置(移除旧+插入新)
- 可选 NavMesh 寻路:若设置则代理按 nav 路径走,否则直线 seek 目标;与 ECS 独立,调用方可把 CrowdAgent 同步到 ECS 实体 Transform 或直接读 positions 渲染 instanced mesh
- `SpatialGrid` — 2D XZ 平面邻域查询加速结构:把 XZ 平面划分为 `cellSize × cellSize` 方格,每格维护索引数组;O(1) 插入/移除,O(k) 查询(k=半径覆盖格数,远优于 O(n²));仅 2D(Y 不参与网格划分,人群/避障主要在水平面);网格键 `${cx},${cz}` 字符串 Map 查询,负坐标 floor 处理统一;API: `insert(id, pos)` / `remove(id, pos)` / `query(pos, radius)` / `queryRadius`;与 `Acceleration/BVH` 互补:BVH 关注三角形级射线求交,SpatialGrid 关注点云级邻域

### 环境增强 (Environment/VegetationSystem + WaterSystem)

- `VegetationSystem` + `VegetationType` — 程序化植被分布:基于地形/噪声密度图采样植被位置,按 `VegetationType`(草/灌木/树)实例化 mesh;支持 impostor billboard 远距渲染
- `VegetationRenderer` — 大规模植被渲染数据层(实例化 + LOD + 风摆动 + 季节变化):与 `VegetationSystem` 互补(System 直接构建 InstancedMesh 自包含渲染,本类只产出 `VegetationPatch[]` 渲染数据描述,由调用方映射到具体渲染后端,解耦便于跨引擎移植);4 级 LOD(超 `lodDistances[3]` 剔除);风摆动(每帧推进 `_time`,`swayPhase` + `windDirection`/`windStrength` 决定偏移);季节影响密度乘子与颜色色调;可选 `densityMap` 叠加 `baseDensity`
- `ProceduralSky` — 程序化天空(Preetham 大气散射近似 + 太阳/月亮/星星):与 `SkySystem` 互补(SkySystem 用关键帧插值驱动颜色,本类基于物理近似);太阳/月亮位置由 `timeOfDay` + `latitude` + `dayOfYear` 经天文学公式算(赤纬 + 时角 → 高度角/方位角);大气散射采用 Preetham 1999 解析近似(瑞利散射短波强散射呈蓝色 + 米氏气溶胶前向散射呈太阳白光晕 + 浊度综合气溶胶浓度);星空球面均匀分布 + 亮度幂分布(太阳低于地平线时启用);`getShaderUniforms()` 供材质/天空盒直接消费
- `WaterSimulation` — 水面顶点位移 + 法线扰动 (Gerstner 波) + 折射/反射近似;`getMeshData()` 输出 positions/normals
- `WaterSystem` — 场景级水体管理 (水位/水流方向/水质参数),驱动多个 `WaterSimulation` 实例 + 与 `WaterMaterial` 配合渲染
- 与 `SkySystem` 联动:水面反射天空颜色;与 `WeatherSystem` 联动:雨天波纹增强

### 延迟渲染与反射探针 (Renderer/DeferredRenderer + ReflectionProbe)

- `DeferredRenderer` — 替代 `WebGL2Renderer` 的延迟后端:G-Buffer Pass (4 附件:position/normal/albedo/material) → 全屏 Lighting Pass;光数与片元数解耦,适合多光源场景
- `ReflectionProbe` — 局部 IBL 探针,捕获场景立方体贴图快照 (位置/范围/捕获频率);运行时按相机位置加权混合
- `ReflectionProbeManager` — 探针注册表 + 相机位置查询最近探针 + 跨探针平滑过渡
- 与 `GBuffer`/`MRTTarget` 协作:G-Buffer 是延迟渲染的几何输入;ReflectionProbe 是 IBL 输入;二者都是 FBO/纹理生命周期管理类

### 全局光照 (Renderer/GlobalIllumination)

- `GlobalIllumination` — 全局光照系统 (光探针 SH2 + VXGI 简化版),提供运行时全局辐照度采样,补充 PBR 材质的环境光/间接光
- 两种模式:`'lightprobes'` 基于二阶球谐 (SH2,9 系数,每系数 RGB 共 27 floats) 的光探针,在指定位置烘焙辐照度;`'vxgi'` 简化版体素全局光照,把场景体素化为 3D 纹理供片元采样 (v1 只持数据结构,体素化由调用方灌入)
- `updateProbes(scene)` 遍历场景光源与 mesh emissive 简单辐照度累积 (不做光线追踪,参考 Light Propagation Volumes Lite 简化模型);`getShaderUniforms()` 返回扁平 `Float32Array` 供 renderer 上传到 `u_giProbes`
- 与 `ReflectionProbe`/`ReflectionProbeManager` 互补:ReflectionProbe 解决 specular IBL(立方体反射),GlobalIllumination 解决 diffuse IBL(球谐辐照度)
- 不变量:lightProbes 数量上限 16 (避免 uniform 数组过大);`removeProbe(index)` 越界静默返回 false;`setEnabled(false)` 后 `getShaderUniforms` 返回空数组

### GPU 驱动渲染与接触阴影 (Renderer/GPUDrivenRenderer + ContactShadowsPass)

- `GPUDrivenRenderer` — GPU 驱动渲染管线原型(间接绘制 + Compute Shader 驱动):把"哪些 mesh 可见/用什么材质/LOD"打包成 `DrawCommand` 数组,经视锥剔除/遮挡剔除/排序后写入 indirect buffer,一次性 `gl.multiDrawElementsIndirect` 提交,把 CPU→GPU 切换开销降到最低(海量小 mesh 时 draw-call bound 优化);与 `WebGL2Renderer`(前向逐 mesh 提交)/ `DeferredRenderer`(GBuffer + lighting)互补,适合海量实例(草地/粒子/树木);v1 为纯 CPU 侧调度(不直接绑定 GL,调用方通过 `getIndirectBuffer()` 拿打包数据自行调 indirect draw),保持零运行时依赖与无头测试友好;indirect buffer 布局每 draw command 5 个 uint(20 字节:`indexCount`/`instanceCount`/`firstIndex`/`vertexOffset`/`firstInstance`)
- `ContactShadowsPass` — 接触阴影后处理 Pass:在物体与地面接触处产生柔和阴影增强 grounded 感;不依赖 GBuffer,仅基于输入颜色纹理亮度作为高度代理(与 DOFPass "亮度即深度" 哲学一致);支持高斯/方框两种模糊核(`blurType`),通过 `samples`/`radius`/`distance`/`falloff` 控制阴影形态;`groundHeight` 作为高度场偏移使阴影集中于地面附近;独立管理内部 FBO + 程序(与 SSRPass 同构),`getShadowBuffer()`/`getStats()` 提供缓冲与统计;与 SSAOPass 区别:SSAO 是边缘暗化(邻域亮度对比),本类关注"接触处"柔和阴影

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

### 着色器库与编译器 (Materials/ShaderLibrary + ShaderCompiler)

- `ShaderLibrary` — 预定义着色器模板库:集中管理命名 GLSL 着色器模板 (15 个:unlit/diffuse/phong/pbr 等),每模板含 `vertexSource` / `fragmentSource` / `uniforms`(声明列表 name+type) / `attributes` / `tags`;`get(name)` 按名取模板,`createVariant(name, overrides)` 生成变体 (覆盖源码或 uniform);与 `ShaderChunks` 的区别:ShaderChunks 是 GLSL *片段*(可拼接子字符串),ShaderLibrary 是完整 *着色器*(顶点+片段+元数据,可直接编译);与 `StandardMaterial` 的关系:ShaderLibrary 的 `'pbr'` 模板作为参考实现/验证基线,与 StandardMaterial 内部 shader 等价但不绑定到材质类 (纯字符串模板,供 ShaderMaterial 使用)
- `ShaderCompiler` — 着色器编译器 (预处理 #include + 注入 chunk + 编译 + 缓存):`preprocess(source)` 委托 `ShaderChunkRegistry` 解析 `#include <name>` (纯字符串处理,无 GL 环境可用);`injectChunks(source, chunkNames)` 显式注入多个片段到源码顶部;`compile(gl, vert, frag, defines)` 编译 GLSL 为 `WebGLProgram` 并缓存 (key = FNV-1a hash(vertexSource | fragmentSource | defines));反射 uniform/attribute 位置;与 `ShaderProgram`/`WebGL2Renderer.getProgram` 的关系:ShaderProgram 是低级包装(直接编译+收集 location),renderer 内置 programCache 只对预设 key 缓存,ShaderCompiler 是面向用户的「自带预处理+缓存」编译器,可被 ShaderMaterial/工具脚本直接使用,不依赖 renderer 实例;`clearCache()` 释放缓存,`dispose()` = clearCache + 置空 registry 引用;编译失败抛 Error(含 GL info log)
- `ShaderVariant` — 着色器变体系统(关键字组合 + 变体缓存):提供"关键字 + 值"组合机制(如 `LIGHTING: UNLIT|LAMBERT|PHONG`,`USE_FOG: 0|1`),变体 = 所有关键字取值笛卡尔积中的一个具体组合;`registerKeyword` 声明关键字及取值集合,`getVariant({ KEY: VALUE })` 按 key 取缓存条目(未命中时 `preprocess` 注入 `#define KEY VALUE`/`#define KEY_VALUE 1`,可选调外部 compiler 编译并缓存);`releaseVariant` 递减引用计数,LRU 驱逐(超 `maxVariants` 时驱逐 `refCount==0` 最旧变体);与 `ShaderLibrary`/`ShaderCompiler` 关系:Library 提供静态模板(无关键字/缓存),Compiler 提供 #include 解析+编译缓存(cache key 为源码 hash,不感知"关键字"),ShaderVariant 在二者之上加"关键字 → 变体"映射层;产出 `(vertexSource, fragmentSource)` 对(已注入 #define),调用方可继续交 ShaderCompiler 编译

### 相机预设与电影相机 (Cameras/ + 预设)

- 检视器内置 9 个相机预设 (Free / Iso / Front / Back / Side / Top / 1st-person / 3rd-person / Cinematic),通过 `viewerStore` 切换
- 底层相机类:`PerspectiveCamera` / `OrthographicCamera` 两个基础相机 + `CinematicCamera` / `CameraRig` 两个高级相机
- `CinematicCamera` — 电影级摄像机系统 (镜头序列叙事):持有 `PerspectiveCamera` 实例,按镜头序列 (shots) 驱动其位置/朝向/FOV;镜头切换支持四种过渡类型 — `cut`(硬切) / `fade`(淡入淡出) / `dolly`(推拉,smoothstep 缓动) / `orbit`(轨道,切换期间绕 lookAt 旋转半圈);过渡发生在镜头开头 `transitionDuration` 秒内;景深 (DOF) 字段 `dofEnabled`/`focusDistance`/`aperture`/`focalLength` 供渲染器/后处理 DOF Pass 读取;镜头震动 (shake) 叠加 Perlin 风格噪声到位置与朝向,`shakeDuration` 控制衰减;`exportTimeline()`/`importTimeline()` 往返 JSON 便于存档与编辑器联动
- `CameraRig` — 摄像机摇臂/轨道系统 (实时跟随目标):与 `CinematicCamera` 互补 (Cinematic 关注预定镜头序列叙事,CameraRig 关注实时跟随 Object3D);四种运动模式 — `crane`(摇臂,摄像机吊在 target 上方 height 处可绕垂轴摆动) / `dolly`(轨道,沿 XZ 平面以 speed 匀速移动) / `orbit`(轨道环绕,绕 target 在 radius 上以 speed 角速度旋转) / `fixed`(固定偏移);`damping` 控制位置跟随平滑度 (0=瞬跟,越大越平滑);摄像机始终 `lookAt` target.position + lookAtOffset;与 `OrbitControls` 的区别:OrbitControls 接收用户输入驱动相机 (交互式),CameraRig 按预设规则自动驱动相机 (电影/过场式);二者可组合 (Rig 跟随主角,Cinematic 取 Rig 的相机做镜头切换)

### 计划中模块 (未实现)

- `CrowdSystem` 的高级避障算法 (RVO/ORCA) 当前为 Reynolds separation 简化版,后续可升级到 ORCA 最优避障;现有 CrowdSystem + SpatialGrid 已可处理大规模群体调度
- 见 `ROADMAP.md` Phase 4/5 了解未来模块规划

### 渲染图与管线编排 (Renderer/RenderGraph + RenderPipelineManager + ForwardPlusRenderer)

- `RenderGraph` — Frostbite FrameGraph 风格的渲染图系统 (资源依赖管理 + Pass 调度 + 自动资源回收):把渲染管线拆成若干 `RenderGraphNode`(每节点一次 pass:render/compute/transfer),节点通过 declared inputs/outputs 声明资源依赖;`compile()` 完成拓扑排序(确保依赖先执行)+ 资源生命周期分析(transient 资源在首次写入前分配,在最后读取后释放)+ 未使用节点剔除 + 循环/冲突检测;`execute(ctx)` 按编译顺序调用每个 node.execute(ctx);不绑定具体 GL 资源类型(资源用 string 名标识,实际分配/释放由 ctx.createResource/destroyResource 完成),既可服务于 WebGL2 纹理/FBO,也可服务于 WebGPU buffer,甚至是纯 CPU Float32Array(测试/离线);参考 GDC 2017 FrameGraph + Granite renderer
- `RenderPipelineManager` — 渲染管线管理器(编排器,不直接调 GL):统一管理 Forward/Deferred/Forward+ 三种管线的切换;每个管线由若干 `PipelinePass` 组成,可动态 addPass/removePass/reorderPass/enablePass/disablePass;质量等级(low/medium/high/ultra)影响 Pass 参数(SSAO 采样数、bloom 分辨率、tile 大小),经 `applyQualitySettings` 统一下发;`autoSwitch` 启用时按场景光源数/物体数自动切换管线;可把 passes 编译成 RenderGraph 节点图(高级用法,普通用户直接 `render()` 即可);无 WebGL 环境下可测试(headless/CI),与具体渲染器解耦
- `ForwardPlusRenderer` — Forward+ 渲染管线(前向渲染 + 屏幕分块光源剔除):三段式 — 可选 `depthPrepass`(写深度缓冲,降低过度绘制,供分块剔除读取深度做精确剔除)/ `computeLightTiles`(CPU 侧分块光源剔除,WebGL2 无 compute shader 在 CPU 完成;屏幕划分为 tileSize × tileSize 网格,每 tile 维护影响它的光源索引列表;DirectionalLight/AmbientLight 影响所有 tile,PointLight/SpotLight 投影到屏幕后估算屏幕空间半径决定覆盖 tile 集合)/ `geometryPass`(前向渲染,把分块光源列表以 uniform 数组上传,fragment shader 按 tile 取对应光源列表累加光照);与 `WebGL2Renderer` 前向渲染相比,Forward+ 通过分块光源剔除支持大量点光源(传统前向渲染受 fragment uniform 数组上限制约);与 `DeferredRenderer` 一样不实现 `Renderer` 接口(接口面向单 pass 前向),调用方直接持有并显式调用 `render()`

### 高级 PBR 与次表面散射材质 (Materials/AdvancedPBRMaterial + SubsurfaceScatteringMaterial)

- `AdvancedPBRMaterial` — 高级 PBR 材质(各向异性 + 虹彩 + 透明涂层 + 光泽 + 自发光):适用车漆/碳纤维/光盘虹彩/肥皂泡/贝壳/织物/复合层叠材质;在 StandardMaterial/PhysicalMaterial 之上扩展:① 各向异性 (Anisotropy) 沿切线方向拉伸镜面高光(拉丝金属/头发/光盘),Burley 2012 各向异性 GGX (ax = α × (1 + anisotropy), ay = α / (1 + anisotropy));② 虹彩 (Iridescence) 薄膜干涉,基于相位差计算每波长反射率混合到 Fresnel;③ 透明涂层 (Clearcoat) 第二层 BRDF (Burley clearcoat GGX,roughness 独立,可带法线贴图);④ 光泽 (Sheen) Ashikhmin Charlie 分布布料边缘柔和光;⑤ 自发光 (Emissive);CPU 侧提供 computeAnisotropicBRDF/computeIridescence/computeClearcoat/computeSheen 参考实现与 GLSL 一致;与 `MeshPhysicalMaterial` 区别:PhysicalMaterial 持 clearcoat/sheen/transmission 数据但 shader 集成延后(advisory),本类提供完整 GLSL shader + CPU BRDF 可直接被 renderer 使用,且新增 anisotropy/iridescence
- `SubsurfaceScatteringMaterial` — 次表面散射材质 (SSS):适用皮肤/蜡/玉石/牛奶/大理石/叶子等半透明材质;基于"半透明阴影"近似(d'Eon / Jimenez 简化版,不做完整 BSSRDF 卷积);核心公式:`distortion = 沿法线反向偏移光照方向` → `backLight = pow(saturate(dot(V, -L_distorted)), sssPower) × subsurfaceColor × thickness × translucency` → 前向 `diffuse × subsurfaceColor × subsurfaceMix`;三通道 `subsurfaceRadius` (r/g/b) 不同波长散射半径不同(红光散射最远,皮肤透光呈红色);与 `MeshPhysicalMaterial` 区别:PhysicalMaterial 的 transmission/thickness 是"薄壁折射"模型(玻璃/水),SSSMaterial 关注"内部多次散射"半透明阴影近似适合有机物

### 绳索物理与碰撞系统 (Physics/RopePhysics + CollisionSystem)

- `RopePhysics` — Verlet 链绳索物理(距离约束 + 弯曲约束 + 风力 + 碰撞):段数组(segments)每段存当前 position + 上一帧 prevPosition + 累积 acceleration(Verlet 点);相邻节点间用距离约束保持 segmentLength(PBD 风格位置修正,迭代收敛);弯曲约束对每三个连续节点 (a,b,c) 限制转向角 turn ≤ maxBendAngle(turn = angle(d1, d2),d1 = b-a 入向,d2 = c-b 出向,0 = 直线,π = 折回,超出时把 d2 绕平面法线旋转向 d1 收紧);固定段(pinnedSegments)不参与积分(挂点);风力作为连续加速度累加;`collideWithSphere` 把穿透段推到球面外;`update(dt)` 内部完成:重力 → 风力 → Verlet 积分 → 距离约束 → 弯曲约束;`getPoints()` 返回节点位置数组(共享 Vector3 引用供渲染管线取点);与 `ClothSimulation` 互补:布料是 2D 网格 soft body,绳索是 1D 链 soft body;与 ECS PhysicsSystems(刚体)解耦独立实现
- `CollisionSystem` — 碰撞检测系统 (BVH + SAT + GJK + EPA):Collider 用扁平数据描述(id/type/position/rotation/scale/data/isTrigger),与具体物理后端解耦,便于编辑器拾取/触发器/射线检测复用;三段式管线 `update(dt)` = 宽相(候选对)→ 窄相(精确求交)→ 接触流形;宽相算法 bruteforce (O(n²) AABB) / sweep (排序扫描) / bvh (层次包围盒);窄相算法 sat (分离轴,球/盒精确,其余回退 EPA) / gjk (Minkowski 差,仅判交) / epa (GJK + EPA 扩展,给出精确穿透深度与法线);特化快速路径 testSphereSphere/testSphereBox/testBoxBox (SAT OBB-OBB) 比通用 GJK 更快且数值更稳,窄相入口优先走快速路径;`testRaycast` 支持球/盒/胶囊/凸包/网格返回最近命中(point/normal/distance);manifold.normal 约定从 colliderA 指向 colliderB;凸包/网格碰撞器在窄相走 GJK/EPA 时网格被视为顶点的凸包(非凸网格凹腔被忽略),射线检测对网格做逐三角形精确求交

### VR/XR 支持 (Controls/VRController)

- `VRController` — WebXR VR/XR 支持系统(手柄追踪 + 双眼渲染位姿提取):封装 WebXR Device API 的会话生命周期(requestSession / endSession),把浏览器原生 XRSession / XRFrame / XRView 翻译为引擎强类型数据(Matrix4 / Vector3 / Quaternion),让渲染层不必直接碰 DOM 类型;`update(frame)` 每帧渲染前调用,从 XRFrame 抽取:① 头显(viewer)位姿 → `headsetPose`;② 双眼视图参数 → `leftEye` / `rightEye`(projectionMatrix + viewMatrix + viewport);③ 输入手柄位姿 → `controllers[]`(gripMatrix / targetRayMatrix + buttons + axes);非浏览器环境(测试/SSR/无 navigator.xr)优雅降级:`isSupported=false`,`update()` 静默返回不抛错;不直接持有 WebGL 上下文/GL 资源,XRLayer 由调用方(Renderer)管理;与 `OrbitControls` 关系:OrbitControls 是非沉浸式(桌面鼠标/触屏)相机控制器,VRController 是沉浸式(WebXR)输入 + 双目视图源,二者互斥使用,调用方决定在 VR 会话期间禁用 OrbitControls;VRController 不修改任何 Camera 实例,只产出 eye 参数,由 Renderer 在双眼 pass 中分别套用

### 网络延迟补偿与会话管理 (Network/LagCompensation + NetworkSession)

- `LagCompensation` — 网络延迟补偿系统(客户端预测 / 服务器回滚 / 命中补偿):`historyBuffer` 按时间戳升序排列的快照历史,每条 `HistoryEntry` 持有该时刻全部实体状态的 `Map<entityId, EntityState>`;服务器侧(isServer=true)用于命中补偿:客户端发起命中请求时附带"客户端看到目标时"的时间戳,服务器 `rewindTo(timestamp)` 回滚到该时刻,用 `checkHit` 检测命中,`restoreCurrent()` 恢复权威状态;客户端侧(isServer=false)用于平滑插值:`interpolate(timestamp)` 在历史中找包围该时刻的两条快照,按 t 线性插值得到实体状态(位置/旋转);与 `StateSync` / `NetworkSync` 关系:StateSync/NetworkSync 关注"实时同步"(收包 → 插值当前渲染位置),LagCompensation 关注"历史回溯"(回到过去某时刻做命中判定或调试),二者互补:实时同步负责"现在",延迟补偿负责"过去";不变量:historyBuffer 始终按 timestamp 升序(recordSnapshot 时丢弃乱序/过旧);rewindTo 后必须 restoreCurrent 才能恢复正常模拟;`pruneOldEntries` 删除 timestamp < (newest - historyDuration) 的条目
- `NetworkSession` — 网络会话管理器:与 `NetworkSync` 不同,本模块聚焦"会话生命周期 / 玩家管理 / 房间状态",不负责实体同步或快照插值(那是 NetworkSync / StateSync 的职责);传输层无关:通过 `onSendMessage` 回调把出站消息投递给调用方,由调用方决定如何发送(WebSocket / MockTransport / IPC 等);主机权威:会话状态变更(gameState / kick / ban)仅主机可执行,客户端只能请求加入/离开/准备;槽位管理:玩家进入时分配空槽位,离开时释放,支持设置最大玩家数;状态机:`lobby → loading → playing ⇄ paused → ended`(lobby 等待玩家加入/准备 / loading 主机调用 startGame 后进入,客户端加载场景 / playing 游戏进行中 / paused 主机暂停 / ended 游戏结束,玩家可返回 lobby);支持 SessionType: `host` / `client` / `listen-server`

### 增强性能分析器 (Tools/Profiler2)

- `Profiler2` — 增强版引擎性能分析器:与早期 `Profiler` (ring-buffer + mark/markEnd) 互补,本类提供面向「帧/区域/事件」三层语义的性能数据收集,并支持导出为 Chrome Trace (chrome://tracing) 格式;① 帧级聚合 `beginFrame`/`endFrame` 自动计算 frameTime / fps / 历史曲线;② 区域计时 `beginZone`/`endZone` 累计 enterCount / total / min / max / avg;③ 事件流 `recordEvent` 记录离散事件(分类 cpu/gpu/memory/render/physics/audio/network);④ 录制开关 `startRecording`/`stopRecording` 控制是否累积 events 数组;⑤ 导出 `exportTrace` 产出 Chrome Trace JSON,便于用 chrome://tracing 可视化;内存快照 `MemoryUsage` 跟踪 usedJSHeapSize/totalJSHeapSize/jsHeapSizeLimit;与 `Profiler` 区别:Profiler 是 ring-buffer + mark 区间(单一形态),Profiler2 是三层语义聚合 + Chrome Trace 导出(工具化/可视化友好)

### PCG 扩展 (PCG/RoadGenerator + BuildingGenerator2 + CharacterGenerator)

- `RoadGenerator` — 程序化道路生成器(样条曲线 + 地形跟随 + 交叉路口):由一组控制点驱动 Catmull-Rom 样条,沿样条采样中心线,按路宽向两侧偏移生成路面带状网格;可选地形跟随把中心线 Y 抬升到地形采样高度 + 偏移;交叉路口作为元数据存储(`RoadIntersection`:position/roads/type,便于上层在路口放置衔接几何体);类型 `cross` 十字 / `tjunction` T 字 / `corner` 转角;与 `BuildingGenerator` / `CityGenerator` 差异:本类为**有状态实例**生成器(控制点/宽度/段数等属性可逐步构建),因为道路通常需要交互式编辑控制点;几何约定:中心线在 XZ 平面布局,Y 由控制点或地形跟随决定;UV u 沿道路长度方向(按累计长度归一化到 0..1),v 沿路宽(0..1);顶点布局每段 2 个顶点(左右边缘),共 (segments+1)×2 顶点
- `BuildingGenerator2` — 增强版程序化建筑生成器:与 `BuildingGenerator` 互补,本类提供面向「风格/楼层/窗户/屋顶/装饰/内部」的可配置实例化 API;支持 5 种建筑风格 (`modern` / `classical` / `industrial` / `sci-fi` / `asian`)、4 种屋顶 (`flat` / `pitched` / `dome` / `spire`)、阳台/入口/空调/天线等装饰,以及简化的内部楼板结构;产出顶点/索引/UV/法线/颜色(每顶点颜色,facade/roof/window/accent 四色调色板,免材质即可区分部件)合并数据,不绑定 BufferGeometry / Material / Scene,由调用方自行包装;种子化 PRNG (mulberry32):同种子产出确定性建筑,便于复现/存档;实例化 API:`setStyle`/`setFloors`/... 链式配置,`generate()` 一次性产出
- `CharacterGenerator` — 程序化角色生成器:由 race / gender / height / bodyType / skinColor / hairStyle / hairColor / eyeColor / faceShape / noseShape / mouthShape / clothing / clothingColor / accessories / seed 等参数驱动,程序化拼装一个简单可渲染的人形角色;5 种族 (`human` / `elf` / `dwarf` / `orc` / `robot`)、4 体型 (`slim` / `average` / `muscular` / `heavy`)、5 服装 (`casual` / `formal` / `armor` / `robe` / `sci-fi`);角色由身体/头部/面部/头发/服装/配饰若干部分组成,各部分独立 BufferGeometry,`generate()` 返回合并后的整体几何体;使用 mulberry32 PRNG 保证种子确定性;`generateSkeleton()` 返回简化 Skeleton(pelvis/spine/chest/head + 四肢),与 `Animation/Humanoid` 骨骼层级保持一致,便于后续 skinning;几何约定:角色脚底在 Y=0,头部朝 +Y,面朝 -Z

### 体积云 (Environment/VolumetricClouds)

- `VolumetricClouds` — 体积云渲染系统(噪声生成 + 光线步进 + 照明):与 `ProceduralSky` / `WeatherSystem` / `CloudSystem` 互补(ProceduralSky 提供大气散射 + 简单云量 uniform,WeatherSystem 提供天气参数 + 雷电,CloudSystem 用粒子化云团近似轻量低成本,VolumetricClouds 用光线步进 + 3D 噪声做高质量体积云,面向"写实感云");纯数据 + 计算层,不持有 GL 资源(与 ProceduralSky / WeatherSystem 一致),通过 `getShaderUniforms()` / `getCloudData()` 暴露给 renderer / shader 消费,由调用方在合适的 pass 中绑定 3D 噪声纹理并执行 ray-march;噪声:Perlin (FBM) + Worley 混合,存为 Float32Array(noiseResolution³),Perlin 提供基础密度场,Worley 减法形成"云洞 + 边缘羽化";照明:Beer-Lambert 透射率 + Henyey-Greenstein 前向散射近似,sun direction → march shadow steps → 衰减到云中采样点;风偏移:`update(dt)` 推进 windOffset,云层沿 windDirection 漂移;与 `VolumetricFogPass` 区别:VolumetricFogPass 是后处理 Pass(持有 GL 资源,关注"全屏雾 + 丁达尔"),VolumetricClouds 是数据/计算层(关注"云的密度场 + 光照模型"),可被天空盒 shader 或独立云 pass 消费

### 编辑器 UI 组件 (src/components/editor/ + src/components/viewer/)

- `src/components/editor/` — 编辑器风格 UI 组件集(赛博朋克风,可独立调试):`SceneHierarchy` 场景树/对象层级面板(展开/折叠/选择/拖拽排序/右键菜单/搜索过滤)/ `InspectorPanel` 属性检查器面板 / `EngineConsole` 引擎控制台(日志输出 + 命令输入) / `AssetBrowser` 资源浏览器 / `MaterialEditor` 材质编辑器(节点图风格) / `LevelEditor` 关卡编辑器 / `AnimationEditor` 动画编辑器 / `ParticleEditor` 粒子编辑器
- `src/components/viewer/EngineModulesPanel.tsx` — 引擎模块展示面板:集中展示自研 `@vreen/engine` 的全部 42 个顶层模块,按类别分组(渲染 / 场景与资源 / 动画与角色 / 物理与模拟 / 架构与系统 / 游戏基础设施 / 性能与调试 / UI 与交付),每个模块卡片可展开显示核心类与功能描述;与 `EngineFeaturesPanel` 互补(后者只展示 8 个可开关子系统,本面板展示全部模块用于检视/学习)
- `src/components/viewer/PerformanceMonitor.tsx` — 实时性能监控面板(图表式):与 `ProfilerHUD` 互补(ProfilerHUD 是浮动 overlay tab 切换 CPU/GPU/System/Draws 文本为主,本类是面板式聚焦 4 个核心指标 FPS/帧时间/内存/DrawCall + 折线图);数据源 `profilerStore.latest` + history(FrameSample ring buffer);内存优先使用 `performance.memory` (Chrome),不可用时显示 N/A;图表为纯 SVG 折线图零依赖

### 架构参考与对比文档

- **架构参考**:本项目以两大开源引擎为架构参考 — [Three.js](https://github.com/mrdoob/three.js)(渲染器抽象 / `Object3D` 对象模型 / `BufferGeometry`/`BufferAttribute` API / PBR·IBL 约定 / `InstancedMesh`/`LOD` / 加载器生态)与 [O3DE (Open 3D Engine)](https://github.com/o3de/o3de)(CES 组件-实体深度 / Asset Processor 资源处理模式 / Script Canvas → Blockly 映射 / EMotion FX → `AnimationStateMachine` / Atom 渲染器 Pass 系统 → `RenderPass` 抽象 / Gems → `ModuleRegistry`)。详见 `ARCHITECTURE.md` 的 "Architectural references" 段
- **soup3D 对比**:详见 [`docs/SOUP3D_COMPARISON.md`](../docs/SOUP3D_COMPARISON.md)。VREEN 相对 soup3D(Python + OpenGL + pygame 入门级引擎)的差异化优势:
  - **渲染管线完备性** — VREEN 提供 PBR + IBL + 阴影 + 延迟渲染 + 14+ 后处理 Pass + 路径追踪 + GPU 驱动渲染 + 全局光照;soup3D 仅为入门级 Blinn-Phong
  - **动画与角色系统** — 完整覆盖骨骼/状态机/BlendSpace/动画层/IK/形变/程序化动画/时间轴;soup3D 完全缺失
  - **物理与模拟** — 内置刚体/碰撞/约束(可断裂)/布料/流体/破坏/Voronoi 剖分/高级粒子;soup3D 完全缺失
  - **游戏基础设施** — AI 导航(NavMesh + A*)/行为树/人群系统/ECS/环境(天气·天空·植被·水体)/体素/PCG/RPG 玩法/地形侵蚀/空间音频;soup3D 完全缺失
  - **交付形态** — 浏览器纯客户端运行 + Electron 桌面便携版 + `.vreen` 包格式 + 多语言 SDK;soup3D 桌面端独占需 Python 环境
- **详细架构文档**:`ARCHITECTURE.md`(英文,引擎架构深度文档)、`README.md`(功能矩阵与快速上手)、`ROADMAP.md`(分阶段规划)、`docs/SOUP3D_COMPARISON.md`(引擎对比)、`docs/vreen-format-spec.md`(`.vreen` 格式规范)

### 曲线与 2D 路径 (Curves/)

- 适配自 [three.js `src/extras/`](https://github.com/mrdoob/three.js/tree/r169/src/extras),本批次新增
- `Curve` — 曲线抽象基类:`getPoint(t)` / `getPoints(divisions)` / `getTangent(t)` / `getLength()`(arc-length 累积)/ `getFrenetFrames(segments)`(Frenet 坐标系,TubeGeometry 依赖)
- 9 个具体曲线:`CatmullRomCurve3` / `CubicBezierCurve3` / `QuadraticBezierCurve3` / `LineCurve3` / `ArcCurve` / `EllipseCurve` / `SplineCurve`(2D)等,均继承 `Curve`
- `CurvePath` — 多段曲线拼接,按顺序串联多段 `Curve` 形成复合路径;`Path` — 2D 路径(基于 `CurvePath`,增加 `moveTo`/`lineTo`/`absellipse` 等 Canvas 风格 API);`Shape` — 2D 闭合轮廓(基于 `Path`,含 holes),供 `ExtrudeGeometry`/`DecalGeometry` 消费
- `ShapeUtils` — 2D 几何工具(三角面积 / `triangulateShape` 调用 Earcut);`Earcut` —EarClipping 三角剖分算法([mapbox Earcut](https://github.com/mapbox/earcut) 移植),把带洞多边形剖分为三角形列表
- 与 `Geometries/ExtrudeGeometry`、`Geometries/TubeGeometry`、`Geometries/DecalGeometry` 协作:后者沿 Curve 采样或对 Shape 三角化生成 3D 网格

### 表面标签系统 (SurfaceData/)

- 适配自 [o3de `Gems/SurfaceData`](https://github.com/o3de/o3de/tree/development/Gems/SurfaceData),本批次新增
- `SurfaceTag` — 表面标签位掩码(每个 bit 代表一种表面类型:草地/岩石/沙地/水面/雪地等),用 `number` 位运算合并/查询,支持最多 32 种标签
- `SurfacePoint` — 表面采样点:`position`(Vector3)+ `normal`(Vector3)+ `tags`(SurfaceTag 位掩码);是 Provider 查询的统一输出
- `SurfaceDataProvider` — 查询契约接口:`getSurfacePoints(inPoints, outPoints, tags)` 输入一组查询点,输出对应的 SurfacePoint(含标签);Provider 不绑定具体数据源
- `SurfaceDataSystem` — 系统主控:注册多个 `SurfaceDataProvider`,合并查询结果(多 Provider 对同一点的不同标签做位掩码 OR 合并);`TerrainSurfaceProvider` — 把 `Terrain/TerrainGeometry` 高度场适配为 Provider(查询点投影到地形表面,返回高度+法线+地形标签)
- 与 `Vegetation/` 协作:植被系统按 SurfaceTag 筛选可行走/可生长的表面点;与 `Shapes/` 协作:Shape 可作为 SurfaceMask 过滤区域

### 逻辑形状组件 (Shapes/)

- 适配自 [o3de `Gems/LmbrCentral/Shape`](https://github.com/o3de/o3de/tree/development/Gems/LmbrCentral/Shape),本批次新增
- `Shape` — 抽象基类:统一接口 `getAabb()`(包围盒)/ `getOobb()`(定向包围盒)/ `getBoundingSphere()` / `rayIntersect(ray)`(射线相交)/ `sdf(point)`(有符号距离场,Signed Distance Function)
- 8 个具体形状:`BoxShape` / `SphereShape` / `CapsuleShape` / `CylinderShape` / `DiskShape` / `QuadShape` / `TubeShape` / `CompoundShape`(复合,聚合多 Shape 的 OR/AND 查询)
- 与 `Geometries/` 区别:`Geometries/` 产出 `BufferGeometry`(渲染用三角网格),`Shapes/` 产出逻辑形状描述(SDF + 射线相交 + 包围体,用于游戏逻辑判定而非渲染);一个 Shape 可对应零或多个渲染 Mesh
- SDF 支持使本模块可服务于:碰撞近似(用 SDF 判断点是否在形状内)、AI 寻路(Shape 作为障碍体)、植被分布(Shape 作为生成区域边界)、CSG 运算(WhiteBox CSG 用 SDF 近似)
- 射线相交返回 `{ hit: boolean, point: Vector3, normal: Vector3, distance: number }`,与 `Raycaster` 的 intersect 格式一致便于复用

### 可组合植被管线 (Vegetation/)

- 适配自 [o3de `Gems/Vegetation`](https://github.com/o3de/o3de/tree/development/Gems/Vegetation),本批次新增;与 `Environment/VegetationSystem` 互补(后者是渲染数据层,本模块是可组合的生成管线)
- `VegetationDescriptor` — 植被描述符:mesh 引用 / LOD 阶梯 / 风摆动参数 / 季节颜色 / 密度 / 尺寸范围;一个 Descriptor 描述一种植被(草/灌木/树/岩石)
- 6 个 Filter(过滤器,决定某个候选点是否放置植被):`DistanceFilter`(距相机/中心距离)/ `ShapeIntersectionFilter`(与 Shapes/ 形状求交)/ `SurfaceMaskFilter`(按 SurfaceTag 过滤表面)/ `DistributionFilter`(基于噪声的密度分布)/ `ShapeSurfaceFilter`(形状表面采样)/ `BlockerFilter`(避开障碍物)
- 4 个 Modifier(修改器,调整已放置植被的属性):`ScaleModifier`(尺寸抖动)/ `RotationModifier`(旋转随机化,可沿法线对齐)/ `PositionModifier`(位置偏移,贴附表面)/ `AlignmentModifier`(朝向对齐:法线/世界向上/相机)
- `SpawnerArea` — 生成区域:绑定一个 `VegetationDescriptor` + 一组 Filter + 一组 Modifier,在区域内(Shape 定义)采样候选点 → 过滤 → 修改 → 产出实例化数据;`AreaBlender` — 多区域混合器:解决重叠区域的冲突(优先级/密度合并)
- 管线可序列化为 JSON,数据驱动;与 `SurfaceData/`(提供标签化表面点)、`Shapes/`(提供区域边界)、`Environment/VegetationRenderer`(最终渲染)协作

### 本地多人系统 (LocalUser/)

- 适配自 [o3de `Gems/LocalUser`](https://github.com/o3de/o3de/tree/development/Gems/LocalUser),本批次新增
- `LocalUserProfile` — 本地用户配置:displayName / avatar / 控制偏好(键位映射/手柄死区/灵敏度)/ 音量 / 语言;可序列化到 localStorage,多用户各自独立配置
- `LocalPlayerSlot` — 玩家槽位:绑定一个 `LocalUserProfile` + 输入设备(键盘/手柄 N)+ 当前活动状态(`joined` / `ready` / `playing` / `spectating`);槽位有 index(0-3,支持最多 4 人本地分屏)
- `LocalUserManager` — 多用户管理器:`join(profile, device)` 分配空槽位 / `leave(slotIndex)` 释放 / `getSlot(index)` 查询 / `getActiveSlots()` 返回所有已加入槽位;管理槽位分配与设备独占(一个手柄不能同时被两个槽位占用)
- 与 `Input/InputManager` 协作:InputManager 提供原始输入,LocalUserManager 把输入设备路由到对应槽位的玩家;与 `Network/NetworkSession` 互补(本地多人 + 在线多人可组合:本地槽位作为客户端加入在线会话)
- 与 `Controls/` 协作:每个槽位可绑定独立的相机/控制器,支持分屏渲染

### 可视化脚本系统 (ScriptCanvas/)

- 适配自 [o3de `Gems/ScriptCanvas`](https://github.com/o3de/o3de/tree/development/Gems/ScriptCanvas),本批次新增;与 `Scripting/VisualScriptComponent`(轻量可视化脚本组件)互补 — 本模块是独立的、功能完整的 ScriptCanvas 实现
- `ScriptNode` — 节点基类:`id` / `type`(节点类型)/ `inputs`(ScriptPin 数组)/ `outputs`(ScriptPin 数组)/ `execute(ctx)` 方法;`ScriptPin` 持有名称 + 数据类型 + 可选默认值
- `ScriptGraph` — DAG 图:持有 `nodes: Map<id, ScriptNode>` + 邻接表(exec 边 + data 边);`addNode` / `removeNode` / `connect(from, to)` / `validate()`(环检测 + 类型检查 + 悬空引脚)
- `ScriptExecutor` — 执行引擎:从指定 event 节点入口,沿 exec-output 链深度优先执行;`ScriptContext` 提供黑板变量读写 + 自定义函数注册(`registerFunction(name, fn)`)+ 日志;带递归深度上限防止死循环
- 18 个内置节点类型:`OnEvent`(事件入口)/ `CallFunction`(调用注册函数)/ `Branch`(条件分支)/ `While`/`For`(循环)/ `GetVariable`/`SetVariable`/ `Add`/`Subtract`/`Multiply`/`Divide`(数学)/ `And`/`Or`/`Not`(逻辑)/ `Vector3` 构造/分解/ `StringConcat`/ `Print`/ `Delay`(协程延迟)
- 图可序列化为 JSON(`exportGraph`/`importGraph`),数据驱动,可存档进 `.vreen` 包;与 Blockly(浏览器端可视化编辑)协作:Blockly 积木可编译为 ScriptGraph JSON

### WhiteBox Greyboxing (WhiteBox/)

- 适配自 [o3de `Gems/WhiteBox`](https://github.com/o3de/o3de/tree/development/Gems/WhiteBox),本批次新增
- `HalfEdgeMesh` — 半边网格数据结构:每个顶点 / 边 / 面通过 `HalfEdge` 双向链表互引用,支持高效的拓扑查询(邻接面 / 共享边 / 边界环)与编辑(顶点移动 / 面挤压 / 边倒角);是 WhiteBox 的核心数据结构,比 `BufferGeometry` 的扁平索引数组更适合交互式编辑
- `WhiteBoxShapes` — greyboxing 基元生成器:从 `HalfEdgeMesh` 产出 4 种基础形状 — `box`(立方体)/ `tetrahedron`(四面体)/ `icosahedron`(二十面体,球体近似起点)/ `staircase`(阶梯,参数化台阶数与尺寸)
- `Csg` — 布尔运算(Constructive Solid Geometry):对两个 `HalfEdgeMesh` 执行 `union`(合并)/ `subtract`(A 减 B)/ `intersect`(交集);基于半边网格求交,产出新 HalfEdgeMesh;支持链式组合(多个基元经多次 CSG 形成复杂 greybox 造型)
- 与 `Geometries/` 区别:`Geometries/` 产出最终渲染网格(不可编辑),`WhiteBox/` 产出可编辑的半边网格(关卡设计师迭代造型),最终可 `toBufferGeometry()` 转为渲染网格
- 与 `Editor/` 协作:WhiteBox 网格可挂到 `Object3D`,经 `TransformGizmo` 变换、`UndoRedoSystem` 记录编辑历史;适合关卡设计早期快速搭建关卡体量(blockout)

### 层级渲染管线 (Renderer/PassGraph/)

- 适配自 [o3de `Gems/Atom/RPI`](https://github.com/o3de/o3de/tree/development/Gems/Atom/RPI),本批次新增;与 `Renderer/RenderGraph` 互补 — RenderGraph 是通用资源依赖图(资源生命周期管理),PassGraph 是面向渲染 Pass 的层级化模板系统
- `Pass` — Pass 基类:持 `inputAttachments` / `outputAttachments`(`PassAttachment` 引用)+ `children`(子 Pass,形成层级树)+ `execute(ctx)` 方法;层级结构支持 Pass 嵌套(如 RootPass → ForwardPass → ShadowPass 子树)
- `PassAttachment` — Pass 附件:描述渲染目标(纹理格式 / 尺寸 / 用法 color|depth|stencil / 生命周期 transient|persistent);与 `MRTTarget` 协作(MRTTarget 是 GL 侧 FBO 包装,PassAttachment 是数据描述)
- `PassTemplate` — Pass 模板:声明式描述一个 Pass 的结构(子 Pass 列表 + 附件槽位 + 参数),可序列化为 JSON;`PassFactory` — 工厂:从 `PassTemplate` 实例化 `Pass` 树(递归构建子 Pass + 绑定附件)
- `PassGraph` — Pass 图根节点:持整棵 Pass 树 + 全局附件池;`execute(ctx)` 按层级深度优先遍历执行所有 Pass;支持 7 种内置 Pass 类型:`ForwardPass` / `DeferredPass` / `ShadowPass` / `BloomPass` / `SSAOPass` / `ToneMapPass` / `DebugPass`
- 数据驱动:整个渲染管线可由 JSON 模板描述(无需写代码),运行时由 `PassFactory` 重建;与 `RenderPipelineManager` 协作(后者管 Forward/Deferred/Forward+ 三种管线的运行时切换,PassGraph 提供单管线内部的 Pass 树结构)

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
- 当前测试数量:**11600+**(446 个测试文件,覆盖 Math / Core / ECS / Animation / Physics / Renderer / Loaders / Materials / Particles / Audio / Terrain / Network / SaveSystem / SceneManager / Input / AI / Environment / Timeline / Voxel / Editor / PCG / Pipeline / Gameplay / Tools (含 ConsoleCommands) / Curves / SurfaceData / Shapes / Vegetation / LocalUser / ScriptCanvas / WhiteBox / PassGraph 等 42 个顶层模块)

## 📌&#x20;
