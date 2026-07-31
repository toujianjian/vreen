# VREEN vs soup3D — 引擎对比分析

> 对比对象:**VREEN**(自研 WebGL2 TypeScript 引擎 + 可视化检视系统)vs **soup3D**(Python + OpenGL + pygame 入门级 3D 引擎)
> 文档目的:分析 soup3D 的优点,明确 VREEN 的差异化优势与超越点,指导后续 UI/功能增强方向。
> 数据来源:soup3D PyPI v5.2.1 (2026-06-07) / GitHub `OrenLiu/soup3D` / 官方文档 `osoup.top/pytool/soup3D`

---

## 1. soup3D 概览

| 属性       | soup3D                                       |
| ---------- | -------------------------------------------- |
| 语言       | Python (>=3.8)                               |
| 图形后端   | OpenGL(经 PyOpenGL)+ pygame 窗口            |
| 定位       | 入门级 3D 引擎,面向 Python 初学者            |
| License    | MIT                                          |
| 最新版本   | 5.2.1 (2026-06-07)                           |
| 包体积     | ~46 KB (wheel)                               |
| 依赖       | pygame / pyglm / pyopengl / numpy / imageio  |
| 安装       | `pip install soup3D`                         |
| 仓库       | github.com/OrenLiu/soup3D / gitee.com/OpenSoup/soup3D |

### 1.1 soup3D 的优点

1. **极低入门门槛** — 面向 Python 初学者,API 设计简洁(三角面/模型/着色器三件套),几行代码即可渲染一个三角形。
2. **纯 Python 生态** — 与 numpy / pygame 等数据科学生态无缝衔接,适合教学演示与数据可视化原型。
3. **轻量级** — wheel 仅 ~46 KB,依赖少,`pip install` 一键安装,零配置。
4. **快速反馈循环** — 解释执行,改完即跑,适合学习阶段的反复试错。
5. **着色器辅助 API** — `soup3D.shader.AutoSP` / `MixChannel` 等高层着色器组合原语,降低 GLSL 直接编写门槛。
6. **MIT 开源** — 商业友好,社区可贡献。
7. **跨平台** — OS Independent,只要 Python + OpenGL 驱动可用即可运行。
8. **活跃迭代** — 2025-09 至 2026-07 持续发布 10 个版本(3.x → 5.2.2),维护积极。

### 1.2 soup3D 的局限

1. **桌面端独占** — 依赖 pygame 桌面窗口,无法在浏览器运行,分发需 Python 环境。
2. **无 ECS / 组件化架构** — 实体管理以 Model/Face 为单位,缺乏数据驱动的大规模实体组织。
3. **无 PBR / IBL** — 着色器为初学者级 Blinn-Phong 风格,无物理渲染管线。
4. **无后处理管线** — 缺少 Bloom / SSAO / ToneMapping / TAA 等现代后处理。
5. **无阴影系统** — 文档未提及 shadow map / 阴影捕获。
6. **无动画系统** — 未提供 AnimationMixer / 骨骼蒙皮 / IK / 形变目标。
7. **无物理引擎** — 未内置刚体/碰撞/约束求解。
8. **无资源管线** — 缺少异步加载 / LRU 缓存 / 引用计数 / LOD 生成。
9. **无序列化 / 存档** — 无场景 ↔ JSON 往返、无多槽位存档。
10. **无网络同步** — 单机运行,无服务器权威同步。
11. **无编辑器 / 检视器 UI** — 纯代码驱动,无可视化场景树/属性检查器/性能 HUD。
12. **无 AI / 行为树 / 导航** — 缺少游戏 AI 基础设施。
13. **无体素 / 地形 / PCG** — 缺少程序化内容生成与体素世界。
14. **测试覆盖未知** — 公开信息未提及测试套件规模。
15. **性能上限受限** — Python 解释执行 + 即时模式渲染,不适合大规模场景。

---

## 2. VREEN 概览

| 属性       | VREEN                                                          |
| ---------- | -------------------------------------------------------------- |
| 语言       | TypeScript 5 (strict)                                          |
| 图形后端   | 自研 WebGL2 引擎 + Three.js r169 双后端                        |
| 定位       | 面向独立游戏开发者与 3D 艺术家的可视化检视系统                  |
| License    | MIT                                                            |
| 代码规模   | 64K+ 行(引擎 + 应用 + 测试)                                  |
| 引擎模块   | 42 个顶层模块                                                  |
| 源码文件   | 430+ (`src/engine/`)                                          |
| 测试       | 4200+ 测试(290+ 文件,42+ 模块)                              |
| 运行时依赖 | 零(@vreen/engine 仅 Draco 为可选 peer)                       |
| 构建工具   | Vite 5 + Tailwind CSS 3                                        |
| 桌面端     | Electron 43 + electron-builder 26(便携 .exe)                |
| 可视化脚本 | Blockly 13                                                     |
| 包格式     | .vreen (ZIP 容器,含 manifest/scene/world + 嵌入资源)        |

---

## 3. 功能对比表(逐项)

### 3.1 渲染与图形

| 功能点                  | soup3D        | VREEN                                              | 优势方 |
| ----------------------- | ------------- | -------------------------------------------------- | ------ |
| 图形 API                | OpenGL(桌面) | WebGL2(浏览器)+ Three.js 双后端                 | VREEN  |
| PBR 物理渲染            | ✗             | ✓ StandardMaterial / MeshPhysicalMaterial          | VREEN  |
| IBL 环境光照            | ✗             | ✓ HDR / CubeTexture / ReflectionProbe              | VREEN  |
| 延迟渲染                | ✗             | ✓ DeferredRenderer + GBuffer(MRT 4 附件)         | VREEN  |
| 阴影贴图                | ✗             | ✓ ShadowMapManager + DirectionalLightShadow        | VREEN  |
| 后处理基础              | ✗             | ✓ Bloom/CA/Vignette/SSAO/FXAA/ToneMap/Gamma/DOF    | VREEN  |
| 后处理增强              | ✗             | ✓ GTAO/SSR/SSSS/TAA/MotionBlur/VolumetricFog/LUT   | VREEN  |
| 路径追踪(CPU 参考)    | ✗             | ✓ PathTracer(Möller–Trumbore + 俄罗斯轮盘)       | VREEN  |
| Forward+ 簇渲染         | ✗             | ✓ ForwardPlusRenderer(3D 簇光源剔除)             | VREEN  |
| 全局光照                | ✗             | ✓ GlobalIllumination(DDGI / 探针体素)            | VREEN  |
| 光线追踪后端            | ✗             | ✓ RayTracingRenderer(反射/阴影/折射混合)         | VREEN  |
| GPU 驱动渲染            | ✗             | ✓ GPUDrivenRenderer(Compute + IndirectDraw)      | VREEN  |
| 接触阴影                | ✗             | ✓ ContactShadowsPass(屏幕空间软阴影)             | VREEN  |
| MRT 多渲染目标          | ✗             | ✓ MRTTarget(N 颜色附件 + 深度/模板)              | VREEN  |
| 反射探针                | ✗             | ✓ ReflectionProbe + Manager(局部 IBL 混合)       | VREEN  |
| 着色器注入              | ✗             | ✓ ShaderMaterial.onBeforeCompile + ShaderChunks    | VREEN  |
| 特殊材质                | ✗             | ✓ Fur/Toon/Matcap/Outline/Water/Wireframe/SSS      | VREEN  |
| 高级 PBR 材质           | ✗             | ✓ AdvancedPBRMaterial(各向异性/Clearcoat)        | VREEN  |
| 次表面散射              | ✗             | ✓ SubsurfaceScatteringMaterial(皮肤/蜡)          | VREEN  |
| Morph Targets           | ✗             | ✓ MorphTargets + MorphTargetAnimation              | VREEN  |
| 文本/精灵               | ✗             | ✓ Text/BitmapText/TextAtlas/Sprite                 | VREEN  |
| 实例化渲染              | ✗             | ✓ InstancedMesh + InstancedBufferAttribute         | VREEN  |
| 毛发渲染                | ✗             | ✓ FurShell 多层 shell                              | VREEN  |

### 3.2 场景与资源

| 功能点            | soup3D          | VREEN                                              | 优势方 |
| ----------------- | --------------- | -------------------------------------------------- | ------ |
| 场景图            | 简单 Model 树   | ✓ Object3D/Scene/Group/Mesh/SkinnedMesh/Bone       | VREEN  |
| 脏标记系统        | ✗               | ✓ DirtyFlag + SceneGraphProcessor                  | VREEN  |
| 视锥剔除          | ✗               | ✓ FrustumCuller                                    | VREEN  |
| BVH 加速          | ✗               | ✓ BVH/MeshBVH(SAH 构建)                          | VREEN  |
| 几何体基元        | 三角面/面片     | ✓ 15 个(Box/Sphere/.../Edges)                   | VREEN  |
| 模型加载器        | ✗(仅自建面)   | ✓ GLB/OBJ/FBX/HDR/KTX2/STL/PLY/TGA/MTL/EXR         | VREEN  |
| 模型导出器        | ✗               | ✓ OBJ/GLTF/STL/PLY 导出器                          | VREEN  |
| 纹理家族          | 基础纹理        | ✓ Cube/Data/Array/Depth/Video/Canvas/Compressed    | VREEN  |
| 资源管线          | ✗               | ✓ AssetPipeline + Texture/Geometry Processor       | VREEN  |
| 资源生命周期      | ✗               | ✓ AssetCache(LRU)+ AssetRegistry(引用计数)      | VREEN  |
| 序列化            | ✗               | ✓ Scene/Geometry/Material ↔ JSON 往返             | VREEN  |
| .vreen 包格式     | ✗               | ✓ ZIP 容器 + manifest + 增量差分包 + 多语言 SDK     | VREEN  |

### 3.3 动画与角色

| 功能点            | soup3D  | VREEN                                              | 优势方 |
| ----------------- | ------- | -------------------------------------------------- | ------ |
| 骨骼动画          | ✗       | ✓ AnimationMixer + SkinnedMesh + Skeleton          | VREEN  |
| 动画状态机        | ✗       | ✓ AnimationStateMachine(Idle/Walk/Run)           | VREEN  |
| BlendSpace        | ✗       | ✓ BlendSpace1D                                     | VREEN  |
| 动画层            | ✗       | ✓ AnimationLayerMixer + BoneMask + Additive        | VREEN  |
| IK 逆向运动学     | ✗       | ✓ FABRIK/CCD/IKHumanoid + 关节约束                  | VREEN  |
| 形变目标          | ✗       | ✓ MorphTargets + MorphTargetAnimation              | VREEN  |
| 时间轴/Sequencer  | ✗       | ✓ Timeline(片段/轨道/事件/属性关键帧)           | VREEN  |

### 3.4 物理与模拟

| 功能点            | soup3D  | VREEN                                              | 优势方 |
| ----------------- | ------- | -------------------------------------------------- | ------ |
| 刚体物理          | ✗       | ✓ semi-implicit Euler + 冲量响应 + Baumgarte       | VREEN  |
| 碰撞检测          | ✗       | ✓ Broadphase + narrowphase(AABB/Sphere/Capsule)  | VREEN  |
| 物理约束          | ✗       | ✓ Ball/Hinge/Slider/Fixed/Distance Joint           | VREEN  |
| 布料模拟          | ✗       | ✓ ClothSimulation(Verlet + PBD)                  | VREEN  |
| 流体模拟          | ✗       | ✓ FluidSimulation(SPH + 空间哈希)                | VREEN  |
| 破坏系统          | ✗       | ✓ VoronoiFracture + DestructionSystem              | VREEN  |
| 粒子系统(高级)  | ✗       | ✓ ParticleSystem2 + Modifier + Curve + Trail       | VREEN  |
| 浮力物理          | ✗       | ✓ Buoyancy(体素化淹没体积 + 浮力/阻力)          | VREEN  |
| 载具物理          | ✗       | ✓ VehiclePhysics(轮胎/悬挂/传动/转向)           | VREEN  |
| 飞行物理          | ✗       | ✓ FlightPhysics(升力/阻力/控制面)               | VREEN  |
| 绳索物理          | ✗       | ✓ RopePhysics(Verlet 距离约束)                    | VREEN  |
| 物理材质          | ✗       | ✓ PhysicsMaterial(摩擦/恢复系数)                  | VREEN  |

### 3.5 架构与系统

| 功能点            | soup3D      | VREEN                                              | 优势方 |
| ----------------- | ----------- | -------------------------------------------------- | ------ |
| ECS 架构          | ✗           | ✓ World + ComponentType + Systems + QueryBuilder   | VREEN  |
| 事件系统          | ✗           | ✓ EventBus + EventQueue + 类型化 GameEvent          | VREEN  |
| 脚本系统          | ✗           | ✓ ScriptComponent + CoroutineSystem                | VREEN  |
| 可视化脚本        | ✗           | ✓ Blockly 13(自定义积木 + 运行时)                | VREEN  |
| 存档系统          | ✗           | ✓ SaveSystem(多槽位 + 自动保存)                  | VREEN  |
| 场景管理          | ✗           | ✓ SceneManager + SceneTransition(Fade/Crossfade)   | VREEN  |
| 输入系统          | pygame 事件 | ✓ InputManager(键盘/鼠标/触摸/手柄 + InputAction) | VREEN  |
| 网络同步          | ✗           | ✓ NetworkSync + Snapshot + Transport + Lerp        | VREEN  |

### 3.6 游戏基础设施

| 功能点            | soup3D  | VREEN                                              | 优势方 |
| ----------------- | ------- | -------------------------------------------------- | ------ |
| AI 导航           | ✗       | ✓ NavMesh + A* PathFinder + SteeringBehavior       | VREEN  |
| 行为树            | ✗       | ✓ BehaviorTree + Blackboard + Decorator            | VREEN  |
| 群体避障          | ✗       | ✓ CrowdSystem(RVO/ORCA 上层封装)                | VREEN  |
| AI 感知系统       | ✗       | ✓ PerceptionSystem(视觉/听觉/触觉/嗅觉)         | VREEN  |
| 机器学习接口      | ✗       | ✓ MLInterface(神经网络/KNN/决策树/SVM 训练)     | VREEN  |
| 环境系统          | ✗       | ✓ Weather/Sky/Cloud/Precipitation/Vegetation/Water | VREEN  |
| FFT 海洋          | ✗       | ✓ FFTOcean(频域海浪合成 + Phillips 谱)          | VREEN  |
| 水面交互          | ✗       | ✓ WaterInteraction(涟漪/水花/泡沫)              | VREEN  |
| 体素世界          | ✗       | ✓ VoxelChunk 16³ + VoxelMesher(贪婪合并)         | VREEN  |
| 编辑器系统        | ✗       | ✓ Selection + TransformGizmo + UndoRedo + Snap     | VREEN  |
| 程序化内容生成    | ✗       | ✓ Noise/Building/City/Dungeon/Tree/Character Gen   | VREEN  |
| 游戏玩法          | ✗       | ✓ Dialogue/Quest/Inventory System                  | VREEN  |
| 地形系统          | ✗       | ✓ TerrainGeometry + Heightmap + Splat + Erosion    | VREEN  |
| 音频系统          | ✗       | ✓ AudioListener + PositionalAudio + AudioAnalyser  | VREEN  |
| 音频效果链        | ✗       | ✓ AudioEffects(Reverb/Echo/Chorus/Distortion...) | VREEN  |
| 程序化音频        | ✗       | ✓ ProceduralAudio(振荡器/合成)                    | VREEN  |
| 空间音频          | ✗       | ✓ SpatialAudio(HRTF + 多普勒)                     | VREEN  |

### 3.7 性能与调试

| 功能点            | soup3D  | VREEN                                              | 优势方 |
| ----------------- | ------- | -------------------------------------------------- | ------ |
| 帧性能分析        | ✗       | ✓ FrameProfiler(FPS/dt/draw call ring buffer)    | VREEN  |
| 系统耗时分析      | ✗       | ✓ SystemProfiler(ECS 系统热点定位)               | VREEN  |
| 内存追踪          | ✗       | ✓ MemoryTracker(资源分配账本 + 泄漏检测)        | VREEN  |
| GPU 性能分析      | ✗       | ✓ GpuProfiler(EXT_disjoint_timer_query)         | VREEN  |
| 性能报告          | ✗       | ✓ PerformanceReport(文本/JSON)                    | VREEN  |
| 控制器            | ✗       | ✓ Orbit/Fly/PointerLock/Map/CharacterController   | VREEN  |
| 控制台命令        | ✗       | ✓ ConsoleCommands(注册/自动补全/历史/别名)      | VREEN  |
| LOD 管理          | ✗       | ✓ LODManager(自动 LOD 切换)                       | VREEN  |
| 渲染图            | ✗       | ✓ RenderGraph(可编排渲染 pass DAG)               | VREEN  |
| 多线程渲染        | ✗       | ✓ ThreadedRenderer(主线程/渲染线程分离)         | VREEN  |
| 渲染管线管理      | ✗       | ✓ RenderPipelineManager(pass 编排)               | VREEN  |

### 3.8 UI 与交付

| 功能点            | soup3D      | VREEN                                              | 优势方 |
| ----------------- | ----------- | -------------------------------------------------- | ------ |
| 浏览器运行        | ✗(桌面)   | ✓ 纯客户端浏览器                                   | VREEN  |
| 桌面打包          | ✗           | ✓ Electron 43 便携 .exe                            | VREEN  |
| 检视器 UI         | ✗           | ✓ Stage/Inspector/Outliner/Toolbar/StatusBar       | VREEN  |
| 性能 HUD          | ✗           | ✓ ProfilerHUD(CPU/GPU/System/Draws tab)          | VREEN  |
| 引擎功能面板      | ✗           | ✓ EngineFeaturesPanel(8 子系统开关)              | VREEN  |
| 引擎模块面板      | ✗           | ✓ EngineModulesPanel(42 模块展示)【新增】        | VREEN  |
| 性能监控面板      | ✗           | ✓ PerformanceMonitor(图表式)【新增】             | VREEN  |
| 国际化            | ✗           | ✓ i18next(5 语言:zh/en/ja/ko/es)               | VREEN  |
| Blockly 脚本面板  | ✗           | ✓ BlocklyPanel                                     | VREEN  |
| ECS 调试面板      | ✗           | ✓ ECSPanel + EntityGraph                          | VREEN  |
| 材质参数编辑器    | ✗           | ✓ ParamEditor + Inspector                          | VREEN  |
| 时间轴 UI         | ✗           | ✓ Timeline.tsx                                     | VREEN  |
| 帧率图表          | ✗           | ✓ FrameChart + SystemTimingChart                   | VREEN  |

---

## 4. 性能对比

> soup3D 未公开基准数据,以下为架构层面的定性推断。

| 维度          | soup3D                          | VREEN                                       | 说明 |
| ------------- | ------------------------------- | ------------------------------------------- | ---- |
| 执行模型      | Python 解释执行                 | TypeScript → Vite 构建 → 浏览器 JIT         | VREEN 启动后接近原生 JIT 性能,Python 持续解释开销 |
| 渲染开销      | 即时模式 OpenGL 调用            | WebGL2 retained mode + 视锥剔除 + BVH       | VREEN 大规模场景剔除后 draw call 显著降低 |
| 内存管理      | Python GC + pygame surface      | 显式 AssetRegistry 引用计数 + MemoryTracker | VREEN 可追踪资源泄漏,Python 依赖 GC 不可控 |
| 大规模实体    | Model 列表遍历                  | ECS archetypes 查询 + System 批量迭代       | VREEN 数据局部性更好,缓存命中率高 |
| GPU 利用率    | 单 pass 直接绘制                | MRT 延迟渲染 + instancing + 后处理管线      | VREEN 多光源场景光数与片元数解耦 |
| 启动延迟      | Python import + pygame init     | Vite HMR / 静态资源 CDN                      | VREEN 浏览器即点即用,无安装 |
| 分发体积      | Python 运行时 + 依赖(~100MB+) | 浏览器:KB 级 / 桌面:Electron 便携包       | VREEN 浏览器端零安装 |

---

## 5. 结论:VREEN 在哪些方面超越 soup3D

### 5.1 维度级超越(全面碾压)

1. **渲染管线完备性** — VREEN 提供 PBR + IBL + 阴影 + 延迟渲染 + 14+ 后处理 Pass + 路径追踪;soup3D 仅为入门级 Blinn-Phong。
2. **动画与角色系统** — VREEN 完整覆盖骨骼/状态机/BlendSpace/动画层/IK/形变/时间轴;soup3D 完全缺失。
3. **物理与模拟** — VREEN 内置刚体/碰撞/约束/布料/流体/破坏/高级粒子;soup3D 完全缺失。
4. **游戏基础设施** — VREEN 提供 AI 导航/行为树/环境/体素/PCG/玩法/地形/音频;soup3D 完全缺失。
5. **架构现代化** — VREEN 采用 ECS + 事件总线 + 脚本系统 + 可视化脚本(Blockly);soup3D 为传统 Model/Face 即时模式。
6. **工具链与调试** — VREEN 提供 5 类 Profiler + 性能报告 + 检视器 UI + 性能 HUD;soup3D 无任何调试工具。
7. **国际化与交付** — VREEN 支持 5 语言 + 浏览器即点即用 + Electron 桌面便携包;soup3D 仅桌面 + 需 Python 环境。
8. **测试与质量** — VREEN 拥有 4200+ 测试覆盖 42+ 模块;soup3D 测试覆盖未公开。
9. **资源生态** — VREEN 支持 11 种加载器 + 4 种导出器 + .vreen 包格式 + 增量差分;soup3D 无资源管线。
10. **文档化架构** — VREEN 拥有 42 模块的详细架构文档(CLAUDE.md)+ API 教程 + 格式规范;soup3D 仅有 README。

### 5.2 soup3D 的不可替代优势(VREEN 不直接竞争)

1. **Python 教学场景** — soup3D 面向 Python 初学者,VREEN 是 TypeScript 产品级引擎,二者目标受众不同。
2. **极简原型** — soup3D 几行代码渲染三角形,适合快速验证图形概念;VREEN 面向完整检视工作流。
3. **数据科学生态** — soup3D 与 numpy/pandas 同语言,适合数据可视化原型;VREEN 需 TypeScript 环境。

### 5.3 VREEN 应继续保持的差异化

1. **UI 检视能力** — 持续增强 EngineModulesPanel / PerformanceMonitor 等检视面板,soup3D 此维度为零。
2. **浏览器零安装** — 保持纯客户端浏览器运行的分发优势。
3. **可视化脚本** — Blockly 面向非程序员,soup3D 无对应能力。
4. **.vreen 包生态** — 多语言 SDK(Java/C#/C++/Unity/Unreal)形成跨引擎互操作,soup3D 无包格式。
5. **测试规模** — 持续扩大 4200+ 测试覆盖,作为质量护城河。

### 5.4 总评

| 评估项       | soup3D | VREEN |
| ------------ | ------ | ----- |
| 功能广度     | ★☆☆☆☆  | ★★★★★ |
| 功能深度     | ★☆☆☆☆  | ★★★★★ |
| 性能上限     | ★★☆☆☆  | ★★★★★ |
| 入门门槛     | ★★★★★  | ★★★☆☆ |
| 交付与分发   | ★★☆☆☆  | ★★★★★ |
| 调试与工具   | ★☆☆☆☆  | ★★★★★ |
| 国际化       | ★☆☆☆☆  | ★★★★★ |
| 测试与质量   | ★★☆☆☆  | ★★★★★ |
| 文档完备性   | ★★☆☆☆  | ★★★★★ |
| 生态与扩展   | ★★☆☆☆  | ★★★★★ |

**结论**:VREEN 在功能完备性、性能、调试工具、交付分发、国际化、测试质量、文档与生态 7 个维度全面超越 soup3D;soup3D 仅在「Python 入门教学」与「极简原型」两个非竞争场景保有优势。VREEN 应继续以「可视化检视 + 浏览器零安装 + 完整引擎模块」作为核心差异化,持续扩大 UI 检视面板与性能监控的领先优势。

---

## 6. 本次 UI 增强(对应 soup3D 零能力区)

为巩固 VREEN 在「调试与工具」维度的领先,本次新增两个组件:

| 组件                      | 路径                                              | 作用 |
| ------------------------- | ------------------------------------------------- | ---- |
| `EngineModulesPanel.tsx`  | `src/components/viewer/EngineModulesPanel.tsx`   | 展示全部 42 个引擎顶层模块,可展开查看核心类与功能,赛博朋克风格 |
| `PerformanceMonitor.tsx`  | `src/components/viewer/PerformanceMonitor.tsx`   | 实时性能监控面板,FPS/帧时间/内存/DrawCall 图表展示,赛博朋克风格 |

新增 i18n key(5 语言):`engineModules.*` / `performanceMonitor.*`(含 `fps` / `frameTime` / `memory` / `drawCalls`)。

---

## 新增引擎能力(2026-07-30 适配 three.js + o3de)

本批次从 three.js 与 o3de 适配 8 个新顶层模块 + 7 处模块扩展,新增 346 测试(总计 877 新模块测试通过)。

| 能力 | 来源 | soup3D | VREEN |
|------|------|--------|-------|
| 曲线系统 (CatmullRom/Bezier/Spline + arc-length + Frenet) | three.js | ❌ | ✅ |
| 2D Path + Shape + Earcut 三角剖分 | three.js | ❌ | ✅ |
| 表面标签系统 (SurfaceData 查询/合并) | o3de | ❌ | ✅ |
| 逻辑形状组件 (8 种 Shape + SDF + 射线相交) | o3de | ❌ | ✅ |
| 可组合植被管线 (6 Filter + 4 Modifier + SpawnerArea) | o3de | ❌ | ✅ |
| 本地多人 (LocalUserManager + 槽位 + 配置) | o3de | ❌ | ✅ |
| 可视化脚本 (ScriptCanvas 18 节点 + 执行引擎) | o3de | ❌ | ✅ |
| WhiteBox greyboxing (半边网格 + CSG) | o3de | ❌ | ✅ |
| 层级渲染管线 (PassGraph 7 pass 类型 + 数据驱动) | o3de | ❌ | ✅ |
| 扫掠角色控制器 (SweptCC + 滑墙 + 坡度判定) | o3de | ❌ | ✅ |
| 根运动提取 (RootMotion 修复滑步) | o3de | ❌ | ✅ |
| 客户端预测 + 和解 (Rewindable + InputHistory) | o3de | ❌ | ✅ |
| 球谐光探针 (LightProbe + SH3 + Ambient/Hemisphere) | three.js | ❌ | ✅ |
| 凸包几何 (QuickHull) | three.js | ❌ | ✅ |
| 贴花几何 (DecalGeometry) | three.js | ❌ | ✅ |
| 管状几何 (TubeGeometry + Frenet 帧) | three.js | ❌ | ✅ |
| 球坐标/柱坐标 (Spherical/Cylindrical) | three.js | ❌ | ✅ |
| 极坐标网格 + Box3/Plane Helper | three.js | ❌ | ✅ |

VREEN 现已覆盖 o3de 10 项核心系统(SurfaceData/Shapes/RootMotion/Vegetation/LocalUser/Rewindable+预测/RPI Pass Tree/Swept CC/ScriptCanvas/WhiteBox)与 three.js 12 项扩展(Curves/Math/Lights/Geometries/Helpers/TubeGeometry),引擎模块总数达 42,测试总数超 4200。
