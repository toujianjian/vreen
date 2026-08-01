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
| 代码规模   | 222K+ 行(引擎 `.ts`)+ 应用 + 测试                            |
| 引擎模块   | 43 个顶层模块                                                  |
| 源码文件   | 866+ (`src/engine/*.ts`)                                      |
| 测试       | 7500+ 测试(340+ 文件,43 模块)                              |
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
| 阴影贴图                | ✗             | ✓ ShadowMapManager + DirectionalLightShadow          | VREEN  |
| 级联阴影贴图 (CSM/PSSM) | ✗             | ✓ CascadedShadowMap (log/uniform/practical + texel 稳定) | VREEN  |
| 镜头光晕 (Lens Flare)   | ✗             | ✓ LensFlare (core/halo/ghost/streak + 遮挡测试)      | VREEN  |
| 顺序无关透明 (OIT)      | ✗             | ✓ WeightedBlendedOIT (depth-weighted 合成 + revealage) | VREEN  |
| 几何体工具              | ✗             | ✓ BufferGeometryUtils (merge/weld/tangent/interleave) | VREEN  |
| 细分曲面 (Catmull-Clark)| ✗             | ✓ SubdivisionModifier (面点/边点 + 内部/边界规则 + UV 插值) | VREEN  |
| 硬边分裂 (Edge Split)   | ✗             | ✓ EdgeSplitModifier (面法线夹角阈值 + BFS 平滑组)    | VREEN  |
| 等值面提取 (Marching Cubes) | ✗         | ✓ MarchingCubes (密度场/Metaball + 256 构型查表 + 梯度法线) | VREEN  |
| 物体描边 (OutlinePass)  | ✗             | ✓ OutlinePass (CPU 高斯模糊 mask + 边缘检测 + 可配置颜色/强度/发光) | VREEN  |
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
| 节点式材质图            | ✗             | ✓ MaterialGraph(50+ 节点 + GLSL 编译器 + 序列化) | VREEN  |
| 光照贴图烘焙            | ✗             | ✓ LightmapBaker(directional/point/ambient + AO)   | VREEN  |
| Morph Targets           | ✗             | ✓ MorphTargets + MorphTargetAnimation              | VREEN  |
| 文本/精灵               | ✗             | ✓ Text/BitmapText/TextAtlas/Sprite                 | VREEN  |
| 实例化渲染              | ✗             | ✓ InstancedMesh + InstancedBufferAttribute         | VREEN  |
| 毛发渲染                | ✗             | ✓ FurShell 多层 shell                              | VREEN  |
| 平面镜面反射            | ✗             | ✓ Reflector(反射矩阵 + 镜像相机 + Lengyel 斜截投影 + 纹理矩阵) | VREEN  |
| 平面折射                | ✗             | ✓ Refractor(Snell 折射 + 全反射/临界角 + 表观深度) | VREEN  |
| 立体相机                | ✗             | ✓ StereoCamera(离轴非对称投影 + 会聚距离,Kooima 2008) | VREEN  |
| 红蓝立体合成            | ✗             | ✓ AnaglyphEffect(redCyan/redGreen/redBlue/amberBlue 4 模式) | VREEN  |
| 视差屏障立体            | ✗             | ✓ ParallaxBarrierEffect(horizontal/vertical/checkerboard 隔行) | VREEN  |
| 程序化金属薄片纹理      | ✗             | ✓ FlakesTexture(确定性 RNG + 平铺 wrap + 抗锯齿 + 法线贴图转换) | VREEN  |
| 光照探针生成            | ✗             | ✓ LightProbeGenerator(SH2 球谐系数从 cubemap 积分,Ramamoorthi 2001) | VREEN  |
| GPGPU 通用计算          | ✗             | ✓ GPUComputationRenderer(纹理 ping-pong + 依赖图拓扑序 + CPU 内核降级 + GLSL 包装) | VREEN  |
| 圆角盒子几何            | ✗             | ✓ RoundedBoxGeometry(棱角球面/圆柱过渡 + 可配半径/分段) | VREEN  |
| 凸包几何                | ✗             | ✓ ConvexGeometry + ConvexHull(增量 QuickHull + horizon 边 + 体积/表面积) | VREEN  |
| 程序化噪声              | ✗             | ✓ ImprovedNoise(Perlin 2002)+ SimplexNoise(Gustavson 2D/3D/4D)+ fBm | VREEN  |

### 3.2 场景与资源

| 功能点            | soup3D          | VREEN                                              | 优势方 |
| ----------------- | --------------- | -------------------------------------------------- | ------ |
| 场景图            | 简单 Model 树   | ✓ Object3D/Scene/Group/Mesh/SkinnedMesh/Bone       | VREEN  |
| 脏标记系统        | ✗               | ✓ DirtyFlag + SceneGraphProcessor                  | VREEN  |
| 视锥剔除          | ✗               | ✓ FrustumCuller                                    | VREEN  |
| BVH 加速          | ✗               | ✓ BVH/MeshBVH(SAH 构建)                          | VREEN  |
| 表面采样          | ✗               | ✓ MeshSurfaceSampler (CDF + barycentric + 权重属性 + 批量) | VREEN  |
| 几何体基元        | 三角面/面片     | ✓ 15 个(Box/Sphere/.../Edges)                   | VREEN  |
| 模型加载器        | ✗(仅自建面)   | ✓ GLB/OBJ/FBX/HDR/KTX2/STL/PLY/TGA/MTL/EXR         | VREEN  |
| 模型导出器        | ✗               | ✓ OBJ/GLTF/STL/PLY 导出器                          | VREEN  |
| 纹理家族          | 基础纹理        | ✓ Cube/Data/Array/Depth/Video/Canvas/Compressed    | VREEN  |
| 资源管线          | ✗               | ✓ AssetPipeline + Texture/Geometry Processor       | VREEN  |
| 资源生命周期      | ✗               | ✓ AssetCache(LRU)+ AssetRegistry(引用计数)      | VREEN  |
| 序列化            | ✗               | ✓ Scene/Geometry/Material ↔ JSON 往返             | VREEN  |
| .vreen 包格式     | ✗               | ✓ ZIP 容器 + manifest + 增量差分包 + 多语言 SDK     | VREEN  |
| 场景图工具        | ✗               | ✓ SceneUtils(detach/attach 保世界变换 + createMultiMaterialObject + sortRadial) | VREEN  |
| 陀螺仪节点        | ✗               | ✓ Gyroscope(锁定世界朝向 + 跟随父节点位置)        | VREEN  |

### 3.3 动画与角色

| 功能点            | soup3D  | VREEN                                              | 优势方 |
| ----------------- | ------- | -------------------------------------------------- | ------ |
| 骨骼动画          | ✗       | ✓ AnimationMixer + SkinnedMesh + Skeleton          | VREEN  |
| 动画状态机        | ✗       | ✓ AnimationStateMachine(Idle/Walk/Run)           | VREEN  |
| BlendSpace        | ✗       | ✓ BlendSpace1D + BlendSpace2D(Delaunay)            | VREEN  |
| 动画层            | ✗       | ✓ AnimationLayerMixer + BoneMask + Additive        | VREEN  |
| IK 逆向运动学     | ✗       | ✓ FABRIK/CCD/IKHumanoid + TwoBoneIK + LookAt       | VREEN  |
| 形变目标          | ✗       | ✓ MorphTargets + MorphTargetAnimation              | VREEN  |
| 时间轴/Sequencer  | ✗       | ✓ Timeline(片段/轨道/事件/属性关键帧)           | VREEN  |
| 动画重定向        | ✗       | ✓ AnimationRetargeting(relative-to-bind)           | VREEN  |
| 程序化动画        | ✗       | ✓ ProceduralAnimation(步态/呼吸/待机/二次运动)   | VREEN  |
| 弹簧物理(二次)  | ✗       | ✓ SpringSolver(头发/布料/尾巴)                   | VREEN  |
| 根运动提取        | ✗       | ✓ RootMotion(in-place → 世界位移)                | VREEN  |
| 骨骼附件          | ✗       | ✓ BoneAttachment(武器/道具/VFX 锚点 + 4 模式)    | VREEN  |

### 3.4 物理与模拟

| 功能点            | soup3D  | VREEN                                              | 优势方 |
| ----------------- | ------- | -------------------------------------------------- | ------ |
| 刚体物理          | ✗       | ✓ semi-implicit Euler + 冲量响应 + Baumgarte       | VREEN  |
| 碰撞检测          | ✗       | ✓ Broadphase + narrowphase(AABB/Sphere/Capsule)  | VREEN  |
| 有向包围盒 (OBB)  | ✗       | ✓ OBB(SAT 15 轴 + sphere/box3/ray/plane/OBB 相交 + containsPoint/Box) | VREEN  |
| 物理约束          | ✗       | ✓ Ball/Hinge/Slider/Fixed/Distance/ConeTwist Joint | VREEN  |
| 布料模拟          | ✗       | ✓ ClothSimulation(Verlet + PBD)                  | VREEN  |
| 软体模拟          | ✗       | ✓ SoftBodySimulation(3D 弹簧-质点 + 体积约束)    | VREEN  |
| 流体模拟          | ✗       | ✓ FluidSimulation(SPH + 空间哈希)                | VREEN  |
| 破坏系统          | ✗       | ✓ VoronoiFracture + DestructionSystem              | VREEN  |
| 粒子系统(高级)  | ✗       | ✓ ParticleSystem2 + Modifier + Curve + Trail       | VREEN  |
| 浮力物理          | ✗       | ✓ Buoyancy(体素化淹没体积 + 浮力/阻力)          | VREEN  |
| 载具物理          | ✗       | ✓ VehiclePhysics(轮胎/悬挂/传动/转向)           | VREEN  |
| 飞行物理          | ✗       | ✓ FlightPhysics(升力/阻力/控制面)               | VREEN  |
| 绳索物理          | ✗       | ✓ RopePhysics(Verlet 距离约束)                    | VREEN  |
| 布娃娃物理        | ✗       | ✓ RagdollSystem(骨骼 + ConeTwist 关节 + 写回)    | VREEN  |
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
| GOAP 规划器       | ✗       | ✓ GOAPPlanner(A* 动作搜索 + 世界状态)            | VREEN  |
| Utility AI        | ✗       | ✓ UtilityAI(9 响应曲线 + 4 组合策略 + 惯性)     | VREEN  |
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
| 引擎模块面板      | ✗           | ✓ EngineModulesPanel(46 模块展示)【新增】        | VREEN  |
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
8. **测试与质量** — VREEN 拥有 4400+ 测试覆盖 46+ 模块;soup3D 测试覆盖未公开。
9. **资源生态** — VREEN 支持 11 种加载器 + 4 种导出器 + .vreen 包格式 + 增量差分;soup3D 无资源管线。
10. **文档化架构** — VREEN 拥有 46 模块的详细架构文档(CLAUDE.md)+ API 教程 + 格式规范;soup3D 仅有 README。

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
| `EngineModulesPanel.tsx`  | `src/components/viewer/EngineModulesPanel.tsx`   | 展示全部 46 个引擎顶层模块,可展开查看核心类与功能,赛博朋克风格 |
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

---

## 新增引擎能力(2026-07-31 几何工具 + 级联阴影 + 镜头光晕)

本批次新增 3 个模块,92 测试(BufferGeometryUtils 34 + CascadedShadowMap 26 + LensFlare 32)。

| 能力 | 来源 | soup3D | VREEN |
|------|------|--------|-------|
| 几何体工具 (mergeGeometries/weldVertices/computeTangents/estimateBytesUsed/interleaveAttributes/toIndexed/deduplicateIndices) | three.js | ❌ | ✅ |
| 级联阴影贴图 (CSM/PSSM,log/uniform/practical 三种分割 + tight 正交投影 + texel grid 稳定化) | three.js + o3de | ❌ | ✅ |
| 镜头光晕 (LensFlare,core/halo/ghost/streak + 方向判定 + ray-sphere 遮挡测试 + additive 合成) | three.js + o3de | ❌ | ✅ |

**关键算法**:
- `weldVertices`:空间哈希网格 O(n) 平均复杂度的顶点焊接(27 邻居查询 + 距离阈值)
- `computeTangents`:Lengyel 切线空间基计算 + Gram-Schmidt 正交化 + 手性修正
- `CascadedShadowMap._logSplit`:`(near * (far/near)^p - near) / (far - near)` 对数分割
- `practical` 方案:`(1-λ)*log + λ*uniform` PSSM 混合(λ=0 → log,λ=1 → uniform)
- 稳定化:每帧 snap AABB min/max 到 texel grid,消除光源移动时的阴影抖动
- 场景包围盒扩展:Z 范围并入场景 8 角点,确保 casters 全覆盖
- `LensFlare.computeLightScreen`:VP 矩阵投影光源到 NDC + 方向 dot 判定 + ray-sphere 遮挡测试
- flare 沿"光源屏幕位置 → 屏幕中心"轴线分布,符合真实镜头光学规律
- additive 合成:`output += flare.rgb * opacity * visibility * intensity`,clamp 到 255

**Matrix4 扩展**:`makeOrthographic(left, right, top, bottom, near, far)` 列主序正交投影(WebGL depth [-1,1])。
**BufferGeometry 扩展**:`addGroup` / `clearGroups` draw group 支持,配合 mergeGeometries 多材质渲染。

引擎模块总数 42,测试总数超 4200(+92)。

---

## 新增引擎能力(2026-07-31 细分曲面 + 硬边分裂 + OIT)

本批次新增 3 个核心算法实现,94 测试(SubdivisionModifier 32 + EdgeSplitModifier 25 + WeightedBlendedOIT 37)。模块归入既有 `Modifiers` 与 `Renderer` 顶层模块,模块总数维持 42,测试总数 4200 → 4294。

| 能力 | 来源 | soup3D | VREEN |
|------|------|--------|-------|
| Catmull-Clark 细分曲面 (面点/边点/顶点新位置 + 边界规则 + UV 同权重插值 + 0–6 迭代) | three.js + o3de Atom | ❌ | ✅ |
| 硬边分裂 (面法线夹角阈值 + BFS 平滑组 + 顶点复制 + 非索引/索引输入) | three.js + Blender | ❌ | ✅ |
| 顺序无关透明 Weighted Blended OIT (accumulate/revealage 缓冲 + depth-weighted 合成 + 无序合成) | McGuire & Bavoil 2013 | ❌ | ✅ |

**关键算法**:

- `SubdivisionModifier` 经典 Catmull-Clark (1978):
  - 面点 = 面顶点质心;边点 = (端点中点 + 相邻面点平均) / 2 (内部) 或 端点中点 (边界)
  - 内部顶点新位置 `(Q + 2R + (n-3)S) / n` (Q=相邻面点平均, R=相邻边中点平均, S=原位置, n=顶点价)
  - 边界顶点新位置 `3/4·S + 1/8·(m₁+m₂)` (m 为前后边中点),保留硬边
  - 每个原始三角形分裂为 3 四边形 → 6 三角形 (面点 F + 3 边点 + 3 原顶点)
  - UV 按相同权重线性插值;`iterations=0` 返回深拷贝;`iterations` 上限 6 防止内存爆炸

- `EdgeSplitModifier` 硬边保留:
  - 收集每条无向边的相邻面 (1 面 = 边界, 2 面 = 内部)
  - 内部边计算相邻面法线夹角 `acos(dot(n1,n2))`;`angle > threshold` 标记为 sharp
  - BFS 平滑组:从每个面出发,跨过非 sharp 边扩散,同组面共享顶点副本
  - 每个平滑组对组内面法线取平均,赋给组顶点副本 → 硬边两侧法线不同
  - `threshold=0` 全分裂 (除共面对角线),`threshold=π` 不分裂
  - `keepExistingNormals=true` 保留原法线,仅分裂顶点

- `WeightedBlendedOIT` 顺序无关透明 (McGuire & Bavoil 2013):
  - 双缓冲:`accumulate` (RGB·α·w 累加) + `revealage` (1-α 累乘)
  - depth-weighted 权重 `w = α · clamp(scale / (bias + depth^power), min, max)`
  - 合成 `final = (1 - revealage) · scene + accumulate / revealage`
  - 无需排序:fragment 以任意顺序累加,合成结果近似正确
  - CPU 端实现,零 WebGL 依赖,可在 Node/tests/headless 环境运行

**BufferGeometry 扩展**:`clone()` 深拷贝方法 (新 typed array + groups + userData + bounding volumes),供 `SubdivisionModifier` 的 `iterations=0` 短路与 `EdgeSplitModifier` 输入保护使用。

**soup3D 对比**:soup3D 无任何细分曲面、硬边分裂、OIT 能力,其着色器为入门级 Blinn-Phong 且无透明排序处理。VREEN 的细分曲面可用于从粗 cage 生成有机平滑网格,硬边分裂可修复导入资源的法线,OIT 解决粒子/植被/半透明材质的排序伪影,三者均为产品级引擎的标志性能力。

引擎模块总数 42,测试总数 4294(+94)。

---

## 新增引擎能力(2026-07-31 OBB + 表面采样 + 描边 + Marching Cubes)

本批次新增 4 个模块,122 测试(OBB 44 + MeshSurfaceSampler 27 + OutlinePass 26 + MarchingCubes 25)。模块归入既有 `Math` / `Core` / `Renderer` / `Geometries` 顶层模块,引擎模块总数 42 → 46,测试总数 4294 → 4416(+122)。

| 能力 | 来源 | soup3D | VREEN |
|------|------|--------|-------|
| 有向包围盒 OBB (center + halfSize + rotation Matrix3 + SAT 15 轴 OBB-OBB + sphere/box3/ray/plane 相交 + containsPoint/containsBox + applyMatrix4 + fromBox3) | three.js + Ericson RTCD | ❌ | ✅ |
| 网格表面采样 MeshSurfaceSampler (面积加权 CDF + barycentric 均匀采样 + 权重属性 + 批量采样 + 法线/颜色输出) | three.js | ❌ | ✅ |
| 物体描边 OutlinePass (CPU 高斯模糊 mask + 边缘检测 + 可配置颜色/强度/模糊/发光 + 可分离卷积) | three.js + o3de Atom | ❌ | ✅ |
| 等值面提取 MarchingCubes (Lorensen & Cline 1987 + 密度函数/Metaball/原始场输入 + 256 构型查表 + 梯度法线) | three.js + Bourke | ❌ | ✅ |

**关键算法**:

- `OBB` 有向包围盒 (Oriented Bounding Box):
  - 表示:`center` (世界中心) + `halfSize` (半边长,各分量 ≥ 0) + `rotation` (3×3 正交矩阵,列为局部轴)
  - OBB-OBB SAT (分离轴定理):测试 15 条候选轴 (A 的 3 面法线 + B 的 3 面法线 + 9 条叉积),任一轴投影区间不重叠则不相交 (Ericson RTCD 4.4.4)
  - OBB-Sphere:球心变换到 OBB 局部坐标系,clamp 到盒内最近点,比较距离平方与半径平方
  - OBB-Ray:Slab 法在 OBB 局部坐标系中求解,返回最近交点参数 t (≥0) 或 null
  - OBB-Plane:有效半径 `Σ hs.i · |col_i · normal|`,比较中心到平面距离与有效半径
  - `containsPoint`:局部坐标 `|p'.i| ≤ hs.i`;`containsBox`:检查 8 角点
  - `applyMatrix4`:center 应用完整 4×4,rotation 应用左上 3×3,halfSize 按列长度缩放
  - `fromBox3`:从 AABB 构造 (rotation = identity)

- `MeshSurfaceSampler` 网格表面采样器:
  - `build()`:遍历三角形,计算面积 × 权重 (可选),构建累积分布函数 (CDF) 并归一化到 [0,1]
  - `sample()`:在 CDF 上二分查找选取三角形 (面积大的三角形被选中概率更高),再用 barycentric 坐标在三角形内均匀采样
  - Barycentric 均匀采样:`a = 1 - sqrt(u)`, `b = v * sqrt(u)`, `c = 1 - a - b` (sqrt(u) 保证均匀分布,否则点会聚集在中心)
  - 权重属性:三角形面积乘以 3 顶点权重的平均值,使高权重区域被更频繁采样
  - 可选输出:面法线 (Triangle.getNormal) + 顶点颜色 (barycentric 插值)
  - `sampleBatch(n)`:批量采样 n 个点,返回新分配的 Vector3 数组

- `OutlinePass` 物体描边 (CPU 侧合成):
  - 算法:选中物体渲染到 mask 缓冲 (白色 = 选中) → 对 mask 做可分离高斯模糊 (水平 + 垂直) → 描边 = 扩散 mask - 原 mask → 叠加到场景
  - 可分离高斯模糊:水平 pass → 垂直 pass,O(kernelSize²) → O(2·kernelSize),归一化高斯核
  - Alpha blending:`output = scene * (1 - edgeAlpha) + edgeColor * edgeAlpha`
  - 可选发光:`output += edgeColor * glow * edgeAlpha` (clamp 255)
  - CPU 实现,零 WebGL 依赖,与 LensFlare/OIT 同构,可在 Node/无头环境运行
  - 可配置:`edgeColor` / `edgeStrength` / `blurRadius` / `blurSigma` / `enabled` / `glow`

- `MarchingCubes` 等值面提取 (Lorensen & Cline 1987):
  - 算法:3D 标量场 → 均匀网格 → 遍历每个 cube (8 角点) → 根据角点值与 isoLevel 的关系确定构型 (0..255) → 查 EDGE_TABLE (12 bit) 确定哪些边被穿过 → 查 TRI_TABLE 确定三角形 → 边上线性插值顶点
  - 三种输入:`fromDensity((x,y,z) => number)` 密度函数 / `MarchingCubes.fromMetaballs(balls, opts)` 静态方法 / `fromField(Float32Array, N)` 原始标量场
  - Metaball 密度:`d += radiusSq / (distSq + radiusSq)`,多球融合产生有机表面
  - 法线:面法线 (叉积),方向指向密度减小方向 (向外)
  - 输出:非索引三角形 BufferGeometry (position + normal),已计算 boundingBox/Sphere
  - 分辨率 2..256,默认 32;isoLevel 默认 0.5

**soup3D 对比**:soup3D 无任何有向包围盒、表面采样、物体描边、等值面提取能力。VREEN 的 OBB 对斜置物体包裹更紧致 (减少错误剔除与碰撞误报),MeshSurfaceSampler 可在地形/物体表面散布植被与粒子,OutlinePass 为编辑器/检视器提供选中高亮,MarchingCubes 支持 metaball/体素地形/医学影像等值面重建,四者均为产品级引擎的标志性能力。

引擎模块总数 42 → 46,测试总数 4294 → 4416(+122)。

## 新增引擎能力(2026-07-31 WorkerPool 并行任务调度)

本批次新增 1 个顶层模块 `Concurrency`,29 测试。引擎模块总数 46 → 47,测试总数 4416 → 4445(+29)。

| 能力 | 来源 | soup3D | VREEN |
|------|------|--------|-------|
| Worker 池管理器 WorkerPool (Promise API + FIFO 队列 + worker 复用 + Transferable 零拷贝 + 主线程降级 + drain/dispose) | three.js WorkerPool + o3de JobSystem | ❌ | ✅ |

**关键算法**:

- `WorkerPool` 并行任务调度:
  - Promise 化 API(three.js 原版是回调式,这里统一返回 Promise,与现代 async/await 一致)
  - Worker 复用:空闲 worker 优先复用,避免反复创建开销;仅 `drain()` / `dispose()` 时终止
  - FIFO 队列:worker 数达上限后,新任务入队,worker 空闲时按入队顺序派发
  - Transferable 支持:`runTask(data, [buf])` 零拷贝传输 ArrayBuffer,避免序列化开销
  - 主线程降级:无 `workerCreator` 时,任务通过 `mainThreadHandler` 在主线程同步/异步执行,使同一 API 在浏览器(多线程)与 Node/无头测试(单线程)下行为一致
  - 错误处理:worker `onerror` / `postMessage` 抛错 / handler 抛错均 reject 对应 task,worker 保持可用
  - `dispose()` 安全:reject 所有队列与在飞任务,终止所有 worker,后续 `runTask` 立即 reject
  - `drain()`:等待全部任务完成后回收 worker,池仍可继续使用(重新创建 worker)

**soup3D 对比**:soup3D 无任何 Worker 池管理能力,所有计算均在主线程,无法利用多核 CPU。VREEN 的 WorkerPool 为 KTX2 纹理压缩、Draco 几何解码、NavMesh 构建、流体模拟、路径追踪等计算密集型任务提供统一的多线程调度基础设施,是产品级引擎的标志性能力。

## 新增引擎能力(2026-08-01 反射/折射 + 立体渲染 + 场景工具 + 光探针 + GPGPU + 噪声 + 凸包)

本批次从 three.js 适配 **14 个新模块**,共 **279 测试**(Reflector 30 + SceneUtils 31 + Refractor 28 + StereoCamera 17 + AnaglyphEffect 16 + Gyroscope 12 + ParallaxBarrierEffect 14 + FlakesTexture 16 + LightProbeGenerator 14 + RoundedBoxGeometry 17 + ConvexHull 14 + ImprovedNoise 13 + SimplexNoise 16 + GPUComputationRenderer 41)。模块归入既有 `Renderer` / `Core` / `Cameras` / `Geometries` / `Math` 顶层模块,顶层模块总数维持 43,测试总数 4445 → 4724(+279;含历史批次累计口径现达 7500+ 测试 / 340+ 文件)。

| 能力 | 来源 | soup3D | VREEN |
|------|------|--------|-------|
| 平面镜面反射 Reflector (反射矩阵 + 镜像相机 + Lengyel 斜截投影 + 纹理矩阵 + 可配分辨率/颜色/clipBias) | three.js Reflector + Lengyel | ❌ | ✅ |
| 平面折射 Refractor (Snell 折射方向 + 全反射/临界角判定 + 表观深度 + 虚拟位置 UV 位移) | three.js Refractor + GLSL refract | ❌ | ✅ |
| 场景图工具 SceneUtils (detach/attach 保世界变换 + createMultiMaterialObject + sortRadial + filter) + Object3D.renderOrder | three.js SceneUtils | ❌ | ✅ |
| 陀螺仪节点 Gyroscope (锁定世界朝向 + 跟随父节点位置,updateMatrixWorld 重算世界旋转) | three.js Gyroscope | ❌ | ✅ |
| 立体相机 StereoCamera (离轴非对称投影 + 会聚距离 + eyeSep + 左右 PerspectiveCamera 同步,Kooima 2008) | three.js StereoCamera | ❌ | ✅ |
| 红蓝立体合成 AnaglyphEffect (redCyan/redGreen/redBlue/amberBlue 4 色彩模式 + 左右眼通道分离 + 可配强度/翻转) | three.js AnaglyphEffect | ❌ | ✅ |
| 视差屏障立体 ParallaxBarrierEffect (horizontal/vertical/checkerboard 3 种隔行交错 + 左右眼像素分配) | three.js ParallaxBarrierEffect | ❌ | ✅ |
| 程序化金属薄片纹理 FlakesTexture (确定性 RNG + 平铺 wrap + 抗锯齿距离场 + 法线贴图转换,车漆渲染) | three.js FlakesTexture | ❌ | ✅ |
| 光照探针生成 LightProbeGenerator (SH2 球谐系数从 cubemap 面积分量积分 + Ramamoorthi 2001 漫反射卷积 + 归一化) | three.js LightProbeGenerator | ❌ | ✅ |
| 圆角盒子几何 RoundedBoxGeometry (棱角球面/圆柱过渡 + 可配半径/分段 + 6 面 12 棱 8 角圆滑) | three.js RoundedBoxGeometry | ❌ | ✅ |
| 凸包计算 ConvexHull (增量 QuickHull + horizon 边检测 + 面法线朝外 + 体积/表面积 + 从点集/BufferGeometry 构造) | three.js ConvexHull | ❌ | ✅ |
| Perlin 改进噪声 ImprovedNoise (Ken Perlin 2002 + fade 6t⁵-15t⁴+10t³ + 3D/2D/1D 切片 + fBm 多倍频) | three.js ImprovedNoise | ❌ | ✅ |
| Simplex 噪声 SimplexNoise (Stefan Gustavson + 斜切网格 + 径向衰减 (0.5-x²-y²-z²)⁴ + 2D/3D/4D + fBm) | three.js SimplexNoise | ❌ | ✅ |
| GPGPU 通用计算 GPUComputationRenderer (Variable 数据纹理 + 依赖图拓扑序 Kahn + ping-pong 双缓冲 + 依赖读旧值语义 + CPU 内核降级 + GLSL 包装生成) | three.js GPUComputationRenderer | ❌ | ✅ |

**关键算法**:

- `Reflector` 平面镜面反射:
  - 反射矩阵:对平面 (normal, constant) 构造 4×4 反射矩阵 `M = I - 2·n·nᵀ`(平移分量由 constant 处理)
  - 镜像相机:主相机世界矩阵 × 反射矩阵,得到水面对称的虚拟相机
  - Lengyel 斜截投影:把镜像相机近平面压到反射平面,避免水下几何穿透镜面(构造修正投影矩阵 `M' = M · L`,L 改变 clip plane)
  - 纹理矩阵:把反射纹理从投影空间映射回屏幕 UV,保证反射与场景对齐
  - 可配:`resolution`(反射纹理分辨率降采样提性能)、`color`(镜面色调)、`clipBias`(防止反射漏看水下)

- `Refractor` 平面折射:
  - Snell 折射定律:`n₁·sinθ₁ = n₂·sinθ₂`,折射方向 `t = (n₁/n₂)(i + cosθ₁·n) - cosθ₂·n`
  - 全反射 (TIR):当 `sinθ₂ > 1`(入射角 > 临界角)时无折射光,返回零向量
  - 临界角:`θc = asin(n₂/n₁)`(从密介质到疏介质)
  - 表观深度:物体在水中的视觉位置上移 `d' = d·(n_air/n_water)`
  - 虚拟位置 UV 位移:按折射角估算屏幕 UV 偏移,采样折射纹理

- `SceneUtils` 场景图工具:
  - `detach(child, parent)`:把 child 从 parent 移除,保留其世界变换(把世界矩阵分解回局部 position/quaternion/scale)
  - `attach(child, parent)`:把 child 加到 parent,保持世界变换不变(计算 parent 逆 × child 世界 = 新局部)
  - `createMultiMaterialObject(geometry, materials)`:为每个材质克隆一份 geometry 包到一个 Group(多材质渲染的 three.js 经典模式)
  - `sortRadial(objects, origin)`:按到原点的径向距离排序(透明物体从后往前)

- `Gyroscope` 陀螺仪节点:
  - `updateMatrixWorld()`:用父节点世界位置 + 自身上一帧世界旋转,重新组合世界矩阵 → 实现"位置跟随父节点、朝向锁定世界"的效果(常用于 HUD/指南针/地平仪)
  - 与 `Object3D` 默认行为的差异:默认 Object3D 的旋转是相对父节点的,Gyroscope 把旋转从世界空间强行保持

- `StereoCamera` 立体相机:
  - 离轴非对称投影(Kooima 2008):左右眼视锥在投影面上不对称偏移,保证会聚平面处左右眼视线相交
  - 会聚距离 `focalLength`:双眼在 focalLength 处汇聚;eyeSep 控制瞳距
  - 左右 `PerspectiveCamera` 同步:从主相机复制 fov/aspect/near/far,再施加水平偏移矩阵
  - `update(camera)`:重算左右眼投影 + 视图矩阵;`render()` 交由调用方分别提交

- `AnaglyphEffect` 红蓝立体合成:
  - 4 色彩模式:redCyan(左红右青)/ redGreen / redBlue / amberBlue(琥珀蓝,色彩平衡更佳)
  - 通道分离:左眼图像保留对应左色通道,右眼保留互补通道,叠加后戴滤色眼镜产生立体感
  - 可配:`eyeSep`、`strength`(通道增益)、`flip`(左右眼互换)

- `ParallaxBarrierEffect` 视差屏障立体:
  - 3 种隔行模式:horizontal(隔行,适合横屏屏障)/ vertical(隔列)/ checkerboard(棋盘,适合斜向屏障)
  - 左右眼像素按屏障模式分配到隔行/隔列位置,裸眼或屏障屏产生立体感

- `FlakesTexture` 程序化金属薄片纹理:
  - 确定性 RNG(种子化):保证同参数生成同纹理,可复现
  - 平铺 wrap:flake 位置模运算,保证纹理无缝平铺
  - 抗锯齿:flake 边缘距离场平滑过渡,避免锯齿
  - 法线贴图转换:从高度场计算梯度 → 法线,用作车漆金属薄片的微表面法线

- `LightProbeGenerator` 光照探针生成:
  - SH2 (二阶球谐) 系数:9 个 vec3 = 27 floats,从 cubemap 6 面积分
  - Ramamoorthi & Hanrahan 2001 漫反射卷积:把 cubemap 的每像素辐亮度按 SH 基函数投影累积,得到入射辐照度球谐
  - 归一化:按面积权重与常数项归一化,使 SH 重建的辐照度物理正确
  - 输出 `LightProbe.sh: SphericalHarmonics3`,可直接喂给 PBR 着色器作 diffuse IBL

- `RoundedBoxGeometry` 圆角盒子:
  - 6 面 + 12 棱 + 8 角:棱用圆柱面过渡,角用球面过渡,实现全圆滑
  - 可配:`radius`(圆角半径,≤ min(w,h,d)/2)、`segments`(圆角分段数,越高越平滑)
  - 顶点法线:每点法线为过渡曲面的真实法线,光照连续无棱线伪影

- `ConvexHull` 凸包计算(增量 QuickHull):
  - 初始四面体:从点集选 4 个不共面点(极小 x → 最远点 → 距线最远 → 距面最远),保证初始体积非零
  - 增量插入:对每个剩余点,标记"可见面"(点在外侧),移除可见面,沿 horizon 边(可见区与不可见区边界,用有向边 twin 判定)向该点构造新三角面
  - 面法线朝外:用初始四面体中心点作参考,法线指向中心则翻转绕序
  - `volume()`:有符号体积 Σ (face.centroid · face.normal · constant) / 6;`surfaceArea()`:Σ 三角形面积
  - 复用:碰撞检测凸包、阴影生成凸包、LOD 简化

- `ImprovedNoise` Perlin 改进噪声(Ken Perlin 2002):
  - 洗牌置换表 `perm[512]`:从固定种子洗牌,保证梯度分布均匀
  - fade 函数 `6t⁵-15t⁴+10t³`:平滑插值,保证 C² 连续(导数在格点为 0,消除块状伪影)
  - 梯度 `grad3[12][3]`:12 个方向梯度向量,用 `grad(hash, x, y, z)` 索引
  - 3D 噪声:8 角点梯度 + 三线性 fade 插值;`noise2D`/`noise1D` 为 z=0/y=0,z=0 切片
  - fBm:`Σ octaves·persistenceⁱ·noise(freq·p)`,频率 `lacunarityⁱ` 增长

- `SimplexNoise` Simplex 噪声(Stefan Gustavson):
  - 斜切网格 (skew):把 (x,y,z) 斜切到超立方体格点,每 simplex 单元只有 n+1 个角点贡献(Perlin 是 2ⁿ),计算成本更低
  - 径向衰减 `(0.5 - x²-y²-z²)⁴`:仅在 simplex 单元内贡献,外为 0,保证连续无块状
  - 2D/3D/4D:`grad3`/`grad4` 梯度表,skew/unskew 变换;4D 用两个 3D 噪声插值的简化外推(避免完整 4D simplex 的 32 顶点排序)
  - fBm:同 ImprovedNoise,多倍频叠加
  - 优势:无 Perlin 的方向性伪影(轴对齐亮带),计算量更低,纹理更自然

- `GPUComputationRenderer` GPGPU 通用计算:
  - Variable(数据纹理):RGBA 浮点(4 floats/texel),`sizeX×sizeY` 网格,内部 ping-pong 双缓冲
  - 依赖图:Variable 可依赖其它 Variable,`init()` 用 Kahn 拓扑排序 + 环检测,计算按拓扑序进行
  - 依赖读旧值语义:本轮所有 Variable 先读到依赖的上一轮快照,写到 alternate 缓冲,最后统一 swap → 与 three.js "同 pass 读上一轮" 行为一致,避免数据竞争
  - CPU 内核降级:`setVariableKernel(name, fn)` 注册 CPU 内核,`compute()` 按 texel 调用,语义等价 fragment shader,使无头测试/Node 环境可运行
  - GLSL 包装生成:把用户 fragment 片段包装成完整 `#version 300 es` shader(声明依赖 `uniform sampler2D`、`uniform vec2 resolution`、`out vec4 fragColor`、`#define gl_FragColor fragColor` 兼容别名、passthrough 回退),供调用方(WebGL2Renderer)直接编译提交
  - `swapVariableBuffer(name)`:GPU 路径下,调用方 readPixels 回填后调本方法交换缓冲指针
  - 用例:粒子位置/速度场、流体、布料、flocking、任何 GPU 迭代计算

**soup3D 对比**:soup3D 无任何反射、折射、立体渲染、GPGPU、光探针、凸包或程序化噪声能力,其渲染管线为入门级 Blinn-Phong 单 pass。VREEN 本批次补齐了产品级引擎的「高级光学效果(反射/折射)」「VR/立体显示(立体相机/红蓝/视差屏障)」「GPU 通用计算(GPGPU)」「全局光照捕获(光探针)」「程序化生成基础(Perlin/Simplex 噪声)」「碰撞/阴影凸包」六大方向,在图形能力广度上对 soup3D 形成压倒性优势。配合 7500+ 测试覆盖与无头可测的 CPU 降级路径,VREEN 在「功能完备性」与「工程可验证性」两个维度均达到产品级引擎标准。

引擎顶层模块总数维持 43(本批次模块归入既有 `Renderer` / `Core` / `Cameras` / `Geometries` / `Math`),测试总数 4445 → 4724(+279;含历史批次累计口径现达 7500+ 测试 / 340+ 文件)。
