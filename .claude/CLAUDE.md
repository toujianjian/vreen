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
│   ├── Core/                # 场景图 (Object3D/Scene/Group/Mesh/SkinnedMesh/Bone/Skeleton/BufferGeometry/BufferAttribute/Material/InstancedMesh/LOD) + 纹理家族 (Texture/CubeTexture/DataTexture/DataArrayTexture/DepthTexture/VideoTexture/CanvasTexture/CompressedTexture) + Source + Fog/FogExp2 + Raycaster
│   ├── Renderer/            # WebGL2Renderer, ShaderProgram, RenderPass, ShadowMapManager + 后处理 (Bloom/ChromaticAberration/Vignette/SSAO/FXAA/ToneMapping/Gamma/DOF)
│   ├── Materials/           # StandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshNormalMaterial, ShadowMaterial, ShaderMaterial (+onBeforeCompile), ShaderChunks
│   ├── Math/                # Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Ray, Line3, Triangle, Frustum, MathUtils
│   ├── Cameras/             # PerspectiveCamera, OrthographicCamera
│   ├── Lights/              # Ambient/Directional/Point/Spot/Hemisphere/RectArea + DirectionalLightShadow + ShadowMapManager
│   ├── Loaders/             # GLB/OBJ/FBX/HDR/KTX2/STL/PLY/TGA/MTL/EXR Loader + TextureLoader + DracoDecoder + AssetManager + OBJExporter
│   ├── Animation/           # AnimationMixer/AnimationClip/AnimationAction/AnimationStateMachine/BlendSpace1D/Humanoid + IK (IKBone/IKChain/IKSolver(FABRIK)/CCDSolver/IKHumanoid)
│   ├── ECS/                 # World, ComponentType, Components, Systems, PhysicsComponents (含 Constraint: Ball/Hinge/Slider/Fixed/Distance), PhysicsSystems (含 ConstraintSolver), Prefab, QueryBuilder, Broadphase
│   ├── Controls/            # OrbitControls, FlyControls, PointerLockControls, MapControls
│   ├── Geometries/          # Box/Sphere/Cylinder/Cone/Torus/Plane/Circle/Ring/Capsule/TorusKnot/Lathe/Extrude/Shape/Wireframe/Edges + Primitives barrel
│   ├── Helpers/             # GridHelper, GridHelper3D, AxesHelper, BoxHelper, CameraHelper, ArrowHelper, LineHelper, PhysicsDebugRenderer
│   ├── Audio/               # AudioListener, Audio, PositionalAudio, AudioLoader, AudioAnalyser
│   ├── Terrain/             # TerrainGeometry, HeightmapGenerator, TerrainSplat, TerrainLayer
│   ├── Acceleration/        # BVH, BVHBuilder, MeshBVH
│   ├── Tools/               # Profiler
│   └── Physics/             # PhysicsDemo + ConstraintSolver 集成
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
│   └── locales/             # zh.json, en.json
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
- Constraint 子系统 — `BallConstraint` / `HingeConstraint` / `SliderConstraint` / `FixedConstraint` / `DistanceConstraint`，由 `ConstraintSolver` 迭代求解
- CPU 粒子系统 + Emitter spawn
- PhysicsDebugRenderer: collider(青色) / contact(黄色) / velocity(品红) 三通道独立开关

### 渲染与材质

- `WebGL2Renderer` — PBR / IBL / 阴影贴图 / 后处理，GLSL ES 3.0
- 材质家族 — `StandardMaterial`(PBR) / `MeshPhysicalMaterial`(clearcoat+transmission) / `MeshBasicMaterial`(unlit) / `MeshPhongMaterial`(Blinn-Phong) / `MeshNormalMaterial`(法线 debug) / `ShadowMaterial`(阴影捕获) / `ShaderMaterial`(`onBeforeCompile` GLSL 注入)
- 后处理 — Bloom / ChromaticAberration / Vignette / SSAO / FXAA / ToneMapping / Gamma / DOF，基于 `RenderPass` 抽象组合
- `ShadowMapManager` — 阴影贴图 FBO / 纹理生命周期管理

### 纹理系统 (Core/)

- `Texture`(基类) / `CubeTexture`(6 面环境) / `DataTexture`(typed array) / `DataArrayTexture`(2D 数组纹理) / `DepthTexture`(阴影/深度) / `VideoTexture`(视频流) / `CanvasTexture`(canvas 动态源 + `update()`) / `CompressedTexture`(S3TC/ETC/BPTC/PVRTC/ASTC 压缩纹理基类，含 mip 链)
- `Source` — 纹理数据源封装 (`data` / `width` / `height` / `version` + `needsUpdate()`)，与采样状态解耦

### 加载器 (Loaders/)

- `GLBLoader` / `OBJLoader`+`OBJExporter` / `FBXLoader` / `HDRLoader`(per-channel RLE RGBE) / `KTX2Loader`(Basis Universal) / `STLLoader` / `PLYLoader` / `TGALoader` / `MTLLoader` / `EXRLoader` / `TextureLoader` / `DracoDecoder`(可选 peer) / `AssetManager`(LRU 缓存)

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

### 场景辅助 (Core/)

- `Fog` / `FogExp2` — 线性雾 / 指数雾
- `Raycaster` / `intersectGeometry` — 射线场景求交 (优先使用 `MeshBVH`)

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

## 📌&#x20;
