# VREEN 引擎项目交接文档（HANDOVER）

> 本文档为**新接管的 Agent** 编写，内容覆盖：项目目标、工程结构、开发流程约定、
> **当前未完成的工作（TransformControls 模块）**、7 个失败测试的根因分析、
> 引擎级深层问题（`Matrix4.multiplyMatrices` 操作数交换）、以及后续推进建议。
> 请务必先通读本文档，再动手修改代码。

---

## 一、项目总览与长期目标

**VREEN** 是一个自研的 3D 游戏引擎（TypeScript 实现，WebGL 渲染，零运行时三方 3D 依赖）。
项目位于 `f:\开发\开源\GitHub\vreen\vreen`（Windows，PowerShell 环境）。

长期目标（用户原始指令，务必保持完整）：

1. 将 **three.js** 与 **o3de**（Open 3D Engine）clone 到本地作为参考源码，
   抄写其中有价值的代码，合理适配到 VREEN 引擎，努力打造成**顶级 3D 游戏引擎**。
2. 每个模块完善 **README**（仿照 o3de 风格：详细、细致、覆盖原理到用法）。
3. 主页支持 **5 种语言**（英语为默认），风格参考现有**赛博朋克样式**（霓虹色系）。
4. 研究 https://github.com/OrenLiu/soup3D 的优点，**争取做得比它更有优势**。
5. 允许自由 clone / git 提交 / 修改。
6. **一步一步来，做一步停一下**——每完成一个模块（代码 + 测试 + README + 主页/多语言 +
   提交）后停下，向用户汇报，等用户确认后再进入下一步。

关键决策约束（用户已明确授权）：
- "之后有事别问我，自己决定"——技术方案可自行判断，用户只反对时再改。
- 沟通语言：中文（代码注释也是中文）。
- 每个新模块必须带 `.test.ts` 单元测试（vitest），且必须通过。

---

## 二、仓库与工程信息

| 项 | 值 |
|---|---|
| 分支 | `main`（本地领先 origin/main 220 个提交） |
| 远端 | `origin` = github.com/toujianjian/vreen.git；`gitee` = gitee.com/toujianjian/vreen.git |
| 包管理 | npm（`package.json` 在仓库根目录） |
| 引擎源码 | `src/engine/**`（自研，不依赖 three.js 运行时） |
| 主页源码 | `src/components/**`（React + Tailwind，含 `src/components/home/Capabilities.tsx`） |
| i18n | `src/i18n/locales/{en,zh,ja,ko,es}.json` |
| 构建 | Vite；类型检查 `npm run typecheck`（= `tsc -b --noEmit`） |
| 测试 | Vitest：`npm test` 或 `npx vitest run`（单文件：`npx vitest run <路径>`） |
| 桌面端 | Electron 可选（`npm run electron:dev`），主入口 `electron/main.cjs` |

常用命令（Windows PowerShell 下注意：**不要用 `&&`**，用 `;` 连接命令）：

```powershell
npm run typecheck                     # 全量类型检查
npx vitest run src/engine/Controls/TransformControls.test.ts   # 单文件测试
npx vitest run                        # 全量测试
git add <具体文件> ; git commit -m "..."    # 提交（按文件粒度）
```

---

## 三、引擎模块结构（src/engine/）

引擎已覆盖约 25 个模块，每个模块均有 `index.ts` 汇总导出、`.test.ts` 单元测试、
o3de 风格 `README.md`。主要模块清单：

- **Math/**：Vector3/Matrix4/Quaternion/Plane/Ray/Box3/Color/Euler/Frustum/OBB/
  ConvexHull/Line3 等数学库
- **Core/**：Object3D（场景图基类）、Mesh、Group、Scene、BufferGeometry、
  BufferAttribute、Material、Raycaster、InstancedMesh、SkinnedMesh、Skeleton、
  Texture 族、Fog、LOD、FrustumCuller、SceneGraphProcessor 等
- **Cameras/**：PerspectiveCamera、OrthographicCamera、CameraRig、CinematicCamera、
  CubeCamera、StereoCamera、SpringArm、PerlinShake、CameraPath、CameraBob
- **Geometries/**：Box/Capsule/Circle/Cone/Cylinder/Sphere/Torus/TorusKnot/Plane/
  Ring/Text/Extrude/Lathe/Polyhedron/Convex/Decal/Teapot/MarchingCubes 等
- **Materials/**：StandardMaterial/AdvancedPBRMaterial/LayeredPBRMaterial/
  MeshBasicMaterial/MeshPhongMaterial/MeshPhysicalMaterial/ShaderMaterial/
  ToonMaterial/MatcapMaterial/FurMaterial/HairMarschnerMaterial/OutlineMaterial/
  LineMaterial/PointsMaterial/WaterMaterial 等 + ShaderChunks/shaders
- **Lights/**：Ambient/Directional/Point/Spot/Hemisphere/RectArea/LightProbe +
  DirectionalLightShadow
- **Loaders/**：GLTF/GLB/FBX/OBJ/STL/PLY/COLLADA/VOX/HDR/EXR/KTX2/TGA/MTL 等
  加载器 + 导出器（GLTFExporter/OBJExporter/PLYExporter/STLExporter）
- **Controls/**：OrbitControls、FlyControls、MapControls、PointerLockControls、
  CharacterController、SweptCharacterController，以及**当前未完成的 TransformControls**
- **Animation/**：AnimationMixer/Clip/Action、状态机、BlendSpace1D/2D、AdditiveBlend、
  RootMotion、Humanoid、IK（CCDSolver/IKChain/TwoBoneIK/FootPlacementIK）、
  SpringSolver、MotionMatching（数据驱动动画选择）
- **AI/**：BehaviorTree、GOAPPlanner、UtilityAI、NavMesh、PathFinder、ORCA（人群避障）、
  SteeringBehavior、SpatialGrid、PerceptionSystem、Agent、CrowdSystem、MLInterface
- **Renderer/**：含 GPUPicking（O(1) 拾取）、FilmGrainPass 等后处理
- **WebXR/**：WebXRManager/Controller/XRLightEstimation/XRPlaneTracker/
  WebXRDepthSensing/BrowserWebXRProvider/WebXRSessionButton（VR/AR/MR 全套）
- **UI/**：RectTransform、布局组、控件（LyShine/UMG/UI Toolkit 级别）
- **ECS/**：World/ComponentType/Components/Systems/QueryBuilder/PhysicsSystems/Prefab
- **Editor/**：SelectionSystem、SnapSystem、TransformGizmo、UndoRedoSystem、
  EditorCommands
- **Environment/**：ProceduralSky/SkyAtmosphere/CloudSystem/VolumetricClouds/
  FFTOcean/WaterSystem/WeatherSystem/VegetationSystem/DecalSystem 等
- 其他：Audio/Input/Events/Curves/Assets/Concurrency/Gameplay/LocalUser/
  Acceleration(BVH/MeshBVH)/Helpers

**主页**：`src/components/home/Capabilities.tsx` 是能力卡片列表，每新增一个引擎
模块，需要在此加一张卡片，并在 5 个语言文件（en/zh/ja/ko/es）补充对应 i18n 词条。

---

## 四、开发流程约定（每完成一个模块的标准步骤）

1. 在对应模块目录写 `Xxx.ts` 核心实现（注释用中文，o3de/three.js 风格详细）。
2. 写 `Xxx.test.ts` 单元测试（vitest，纯数据层，不依赖 WebGL）。
3. 运行单文件测试直到全绿：`npx vitest run <file>`。
4. 运行 `npm run typecheck` 保证类型无误。
5. 更新模块 `index.ts` 导出。
6. 更新主页 `Capabilities.tsx` + 5 语言 i18n。
7. 写 o3de 风格 `README.md`（详细到原理/算法/参数/用法/对比优势）。
8. 全量测试 `npx vitest run` 通过。
9. 按文件粒度 `git add` + `git commit`，commit message 用
   `feat(模块): 一句话摘要` 格式。
10. **停下，向用户汇报，等确认后再进入下一步**（用户偏好"一步一步来，做一步停一下"）。

---

## 五、当前进行中的工作：TransformControls 模块（未完成！）

### 5.1 目标与设计

TransformControls 是编辑器物体变换 gizmo（平移/旋转/缩放），对标 three.js
TransformControls + o3de 编辑器视口交互范式，用于补齐"GPU Picking → 选中 →
gizmo 操控"的编辑闭环。

**已完成的文件**（均未提交，git status 中为 untracked）：
- `src/engine/Controls/TransformControls.ts`（约 1280 行）
- `src/engine/Controls/TransformControls.test.ts`（47 个测试）
- `src/engine/Math/Vector3.ts`（已修改，新增 `multiply/divide/multiplyVectors/angleTo` 方法，git status 中 modified）

**设计要点**：
- 变换数学抽成**纯函数** `computeTranslate/computeRotate/computeScale/buildDragPlane`
  （无 DOM/WebGL 依赖，可在 Node 直接单测）。
- gizmo 分可见子树（`getGizmo(mode)`）与不可见 picker 子树（`getPicker(mode)`），
  picker 用透明材质（opacity=0, depthTest=false）但参与 Raycaster 求交。
- 轴拾取：`pointerHover(NDC)` → `Raycaster.setFromCamera` → 命中 picker 中
  `mesh.name`（'X'/'Y'/'Z'/'XY'/'YZ'/'XZ'/'XYZ'/'E'/'XYZE'）。
- 拖拽：按下时构建"拖拽平面"（`buildDragPlane`），射线-平面求交得拖拽点，
  pointerMove 时按轴/空间投影到物体 position/rotation/scale，支持 snap 吸附与 min/max 钳制。
- 空间：translate/rotate 支持 world/local；scale 强制 local。
- 事件：`enabled` 门控、PointerEvent 一手接入、`dispose` 解绑。

### 5.2 测试状态（关键！）

```
Test Files  1 failed (1)
     Tests  7 failed | 40 passed (47)
```

7 个失败测试（含原因分类）：

| # | 失败测试 | 根因 | 处理建议 |
|---|---|---|---|
| 1 | `computeScale > scaleSnap 为 0 时回退到 snap 本身` | **测试期望值写错**。实现 `round(1.1/0.5)*0.5 = 1.0`，`1.0 \|\| 0.5 === 1.0`（JS 中 1 为 truthy），测试却期望 0.5；测试注释 "1.0 → \|\| 0.5 = 0.5" 自身逻辑矛盾 | 改期望为 1.0，或重写测试意图 |
| 2 | `computeRotate > E 轴(视向)` | **测试符号期望写错**。实现与 three.js 一致：`angle *= cross<0 ? 1 : -1`；测试注释算出 `cross·eye = -1 < 0 → 应乘 1`（即 +π/2），但期望 -π/2，自相矛盾 | 期望改为 +π/2 |
| 3 | `gizmo construction > rotate picker 有 X/Y/Z/E/XYZE` | **Object3D.add 只接受单参数**（见 §5.3），`_root.add(3 个参数)` 只添加第 1 个 → rotate/scale 的 gizmo/picker 根本不在 root 树里 | 修 TransformControls 中的多参 add 调用 |
| 4 | `axis picking > translate 命中 X 轴` | picker 几何重叠：从 X 锥体中心沿 -Z 射线，先命中 Z 轴锥体（半径 0.2 偏胖 + 世界坐标未缩放） | 缩小 picker 命中区半径 / 增大轴间距 / 按"距各自轴线的距离"优化拾取 |
| 5 | `axis picking > translate 命中 Y 轴` | 同上 | 同上 |
| 6 | `pointerHover(NDC) → tc.axis 命中 X` | 同上（NDC 投影的射线未命中 X 锥，返回 null） | 同上 |
| 7 | `end-to-end translate > 物体 position 变化` | 同上（pointerDown 前 axis 就是 null） | 同上 |

### 5.3 已确认的引擎级 Bug A：`Object3D.add` 只接受单参数

`src/engine/Core/Object3D.ts` 的 `add(child)` 是**单参数**签名（three.js 是
`add(...objects)`）。但 TransformControls.ts 中 3 处多参调用：

- 第 875 行：`this._root.add(this._gizmo.translate, this._gizmo.rotate, this._gizmo.scale)`
- 第 876 行：`this._root.add(this._picker.translate, this._picker.rotate, this._picker.scale)`
- 第 964 行：`setColors` 里同样多参 add

**已用诊断脚本验证**：`helper.children` 只有 2 个节点（gizmo.translate + picker.translate），
而不是 6 个。也就是说 **rotate/scale 两种模式的 gizmo 和 picker 从未进入场景树**，
即使修好测试，rotate/scale 模式也无法工作。

修复建议（任选）：
1. 把 `Object3D.add` 改为可变参数 `add(...children: Object3D[])`（与 three.js 对齐，
   需检查全引擎是否有其他依赖单参语义的调用；`remove` 同理检查）；
2. 或仅把 TransformControls 中的多参调用拆成多次 `add`。

**推荐方案 1**，并顺手检查 `remove` 是否也需要可变参数（`setColors` 中调用了
`this._root.remove(oldT, oldR, oldS)`——同样多参！）。

### 5.4 已确认的引擎级问题 B：`Matrix4.multiplyMatrices` 操作数交换（高优先验证）

**数学推导 + 运行时诊断双重确认**：VREEN 的 `multiplyMatrices(a, b)` 实际计算的是
**`b * a`**（three.js 语义是 `a * b`）。

- `src/engine/Math/Matrix4.ts` 第 41-71 行：`e[0] = b11*a11 + b12*a21 + b13*a31 + b14*a41`
  （a 取第 1 列、b 取第 1 列做点积 = B*A 的 [0][0]，而标准 A*B 应 a 取第 1 行、b 取第 1 列）。
- 诊断证据：gizmo root 设置 `scale=2.21` 后，picker 子节点（本地坐标 0.3）的
  `matrixWorld` 平移仍为 0.3——**父级 scale 未传播到子节点世界坐标**，
  正是 L*P（子矩阵×父矩阵）而非 P*L 的表现。

**影响面**：`Object3D.updateMatrixWorld`（`matrixWorld.multiplyMatrices(parent.matrixWorld, this.matrix)`）、
Renderer 的 viewProjection、InstancedMesh、蒙皮、骨骼等全部依赖该语义。
若它真是 bug，修一行会改变全引擎数学行为，**必须非常谨慎**；若它是引擎的
"约定俗成"（所有调用方都按交换序使用），则可能恰好自洽。

**给新 Agent 的行动建议**：
1. 先写一个最小验证：`parent`（旋转+平移+非 1 缩放）× `child`（平移）两层，
   分别用 three.js 与 VREEN 的 `multiplyMatrices` 对比 `matrixWorld` 结果；
2. 检查 Renderer/SceneGraphProcessor 是否对 matrixWorld 做了补偿（如转置/逆序）；
3. 检查现有通过的全部场景图相关测试（Raycaster、InstancedMesh、皮肤、GPUPicking 等），
   判断是"全引擎一致约定"还是"潜在 bug 未暴露"；
4. **在本轮 TransformControls 收尾前不建议动它**——它会使未提交的 47 个测试全部
   重新计算，风险巨大。若最终确认是 bug，应单独开一个提交，且全量回归。

### 5.5 TransformControls 剩余待办（依序执行）

1. 修复 §5.3 的 Object3D.add 多参问题（或拆分调用）。
2. 修正 §5.2 中 2 个测试自身的期望值错误。
3. 解决 picker 几何重叠：建议缩小 picker 锥体半径（0.2→0.08 左右）并检查
   Z 锥与 X/Y 射线路径是否仍重叠；或让 `intersectPicker` 按命中点到
   "各轴几何中心线"的距离加权，优先选择轴向最正的轴。
4. 全绿后：在 `src/engine/Controls/index.ts` 添加 TransformControls 导出
   （含类型 `TransformMode/TransformSpace/TransformAxis` 与纯函数导出）。
5. 主页 `src/components/home/Capabilities.tsx` 加 `transformControls` 卡片
   （参考现有 `motionMatching`/`gpuPicking` 卡片写法，第 86/91 行附近，
   icon 可参考 lucide-react 的 Move3d/RefreshCcw 等，accent 用现有霓虹色）。
6. 5 语言文件补 `transformControls` 词条（en/zh/ja/ko/es）。
7. 写 `src/engine/Controls/README.md` 的 TransformControls 章节（o3de 风格），
   或单独补充。注意 Controls/README.md 已存在，需并入。
8. `npm run typecheck` + 全量 `npx vitest run` 通过。
9. `git add` 具体文件 + commit（message 如
   `feat(Controls): add TransformControls — gizmo translate/rotate/scale manipulation`）。
10. 删除临时文件 `test-output.txt`（根目录，误生成）。

---

## 六、近期已完成模块（供参考风格与上下文）

最新提交（git log 前 8 条）：

```
cc57319 feat(Renderer): add GPUPicking — O(1) object picking via offscreen ID render + readPixels
a37701d feat(Renderer): enhance FilmGrainPass to o3de Atom algorithm — luminance dampening + 24fps + CPU reference
d714d92 feat(WebXR): add WebXR VR/AR/MR — session manager + controller/hand tracking + AR subsystems
30d9afc feat(UI): add complete in-game UI system (LyShine/UMG/UI Toolkit class)
dcd09ef feat(AI): add ORCA collision avoidance — RVO2 velocity-space solver
a201b9e feat(Animation): add MotionMatcher — data-driven animation selection
a459368 feat(i18n): add VariableRateShading capability to homepage in all 5 languages
9c3a923 feat(Renderer): add VariableRateShading — VRS tile classification system
```

每个模块的落地模式（新 Agent 应沿用）：
- **GPUPicking**（Renderer）：24-bit pickId 编码 RGB、离屏 MRT FBO、readPixels O(1) 拾取、
  InstancedMesh 逐实例、pickRect 去重、resolutionScale；对比 soup3D 的 CPU 射线拾取优势。
- **WebXR**（WebXR/）：会话生命周期、控制器/手部 25 关节 + 捏合、AR 光估计/平面检测/深度遮挡、
  Provider 抽象可测试；对比 soup3D（无任何 XR 支持）。
- **MotionMatcher**（Animation）：数据驱动动画选择，权重代价函数，运行时状态机混合，
  4 预设（precise/balanced/performance/cinematic）；对比 soup3D 仅传统状态机。
- **FilmGrainPass**（Renderer）：o3de Atom 算法（4x(1-x) 亮度抑制、24fps、双路径）。
- **VariableRateShading**（Renderer）：VRS tile 分类。

---

## 七、关键经验与注意事项（新 Agent 必读）

1. **Windows PowerShell**：不支持 `&&`；用 `;`。不要用 `cat`/`grep`/`tail`，
   用专用工具（Read/Write/Edit/Grep/Glob）。
2. **测试是纯数据层**：不要在 `.test.ts` 里依赖 WebGL；DOM 用最小 mock
   （TransformControls.test.ts 顶部 `makeDomEl()` 可复用）。
3. **VREEN 的 Object3D 与 three.js 差异**：
   - `rotation` 字段就是 Quaternion（无独立 `quaternion` 字段）；
   - `add/remove` 目前是单参数（见 §5.3）；
   - `position/rotation/scale` 是"绑定"的 `_BoundVector3/_BoundQuaternion`，
     `set/copy` 自动 `markDirty(MATRIX | MATRIX_WORLD)`；直接赋值字段类型仍兼容。
4. **脏标记系统**：`_dirtyFlags`（DirtyFlag.MATRIX/MATRIX_WORLD/BOUNDS/VISIBLE），
   修改 transform 后需 `updateMatrixWorld(true)` 才能保证 raycast 用最新矩阵。
5. **Matrix4.multiplyMatrices 语义与 three.js 相反**（§5.4），改动前先验证全局影响。
6. **i18n 必须 5 语言同步**：只改 en.json 会导致主页其他语言缺词条；有 JSON 校验测试。
7. **commit 粒度**：按文件 add，message 用 conventional 风格；不要 `git add -A`。
8. **参考源码**：本地应有 three.js 与 o3de 的 clone（用户授权 clone）。对照实现时
   优先适配 VREEN 自研 API，不引入 three.js 运行时依赖。
9. **对比 soup3D**：每个新模块的 README/主页文案都要强调相对 soup3D 的优势点。
10. **收尾汇报**：每步完成后停下汇报，等用户确认（用户偏好"一步一步来"）。

---

## 八、下一步建议（TransformControls 收尾后的高价值方向）

按用户目标（超越 soup3D、顶级引擎），可选方向（供新 Agent 判断优先级）：
- 补齐 **网络/多人** 模块（soup3D 未有）；
- **程序化地形** / **植被 GPU 实例化**（Environment 已有 Vegetation 基础）；
- **SSAO / 屏幕空间次表面散射 / 级联阴影** 等渲染进阶（GPUPicking/FilmGrain 已有基础）；
- **物理引擎** 强化（现有 ECS 物理为自研，可对照 o3de PhysX）；
- 若用户已确认 Matrix4 问题，先修复并全量回归。

> 最后提醒：当前工作区未提交的变更只有 `TransformControls.ts/.test.ts`（untracked）
> 与 `Vector3.ts`（modified），以及误生成的 `test-output.txt`（应删除）。
> 接管后第一步：读 §5.3 → 修 add 多参 → 修测试期望 → 解决 picker 重叠 → 全绿。
