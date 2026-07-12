# Changelog

All notable changes to VREEN are documented in this file.

## [0.4.0] - 2026-07-12

### Added — Engine
- **PBR + 后处理**: `WebGL2Renderer` 新增 bloom、色差、SSAO 通道参数；StandardMaterial 支持金属度 / 粗糙度程序化纹理
- **ShaderMaterial**: 可编程材质,`ShaderChunks` 共享片元 / 顶点代码块
- **Draco 解码**: `Loaders/DracoDecoder.ts` 通过 `draco3d` 解压 Draco 网格
- **OBJ 导出器**: `Loaders/OBJExporter.ts` 把网格导出为 OBJ 字符串
- **资源管线**:
  - `AssetManager` 新增 LRU 缓存命中 / 未命中 / 淘汰日志与缓存键截断
  - `GLBLoader` 详细分阶段日志(load → read → parseGLB → buildFromGltf)
  - `Loader` 抽象类 fetch 进度回调
- **场景图 + 数学**:
  - `Object3D` 实现 `updateWorldMatrix` 别名兼容 three.js
  - `BufferGeometry` / `BufferAttribute` 新增 `dispose` / `setUsage` / `needsUpdate` 三个 WebGL 资源管理方法

### Added — ECS
- **ComponentType** (`src/engine/ECS/ComponentType.ts`): POJO 组件类型元数据,字符串 ID,避免循环依赖
- **Physics 组件** (`PhysicsComponents.ts`): `Rigidbody` / `Collider` (AABB / Sphere / Capsule) / `Particle` / `ParticleEmitter` / `PhysicsConfig` / `PhysicsDebug`
- **Physics 系统** (`PhysicsSystems.ts`): `PhysicsSystem` (固定步长 semi-implicit Euler + 四元数积分) / `CollisionSystem` (broadphase + narrowphase + 冲量响应 + Baumgarte 矫正) / `ParticleSystem` (CPU 粒子推进 + Emitter spawn) / `PhysicsDebugSystem`
- **Entity Graph**: `EntityGraph.tsx` 实体关系图面板
- **Profiler**: `Tools/Profiler.ts` 环形缓冲(120 帧),CPU / GPU 标记,`profilerStore` + `FrameChart` + `ProfilerHUD` 三件套

### Added — Helpers & Physics Demo
- `Helpers/LineHelper.ts`: 动态 LineMesh,适合 collider / velocity / contact 可视化
- `Helpers/GridHelper.ts`: 程序化网格地面
- `Helpers/PhysicsDebugRenderer.ts`: collider (青色) / contact (黄色 normal+tangent+bitangent+depth) / velocity (品红) 三通道
- `Physics/PhysicsDemo.ts`: 24 个随机 box + 粒子发射器演示场景,ViewerToolbar 新增 `PHYSICS` / `PHYS-DBG` 切换

### Added — 多语言 SDK 生态 (`packages/` & `sdks/`)
- **`@vreen/engine` 包** (`packages/engine/`): 自研引擎打包为独立 npm 包,零依赖,完整公共 API 表面
  - 包含 `examples/minimal.html` + `examples/minimal.ts` 起步示例
  - 自带 `setLoggerSink` / `setMinLevel` 内置日志
- **`.vreen` 包注册表** (`packages/registry/`): `example-index.json` + `schema.json`
- **Unity 编辑器插件** (`packages/unity-package/`): C# 导出 `VreenEditorWindow` / `VreenJson` / `VreenModel` / `VreenLoader`
- **Unreal 引擎插件** (`packages/unreal-plugin/`): C++ 模块 `VreenRuntime` (Public/Private headers + .uplugin)
- **Kotlin/Java 构建期工具** (`packages/vreen-core/`): Maven 项目,`Vreen.kt` / `VreenDiff.kt` / `VreenFormatError.kt` / `Hashing.kt` / `AssetPaths.kt` + 单元测试
- **Java POJO SDK** (`sdks/java/`): Gradle + Maven 双构建系统
  - `VreenPackage` / `VreenManifest` / `VreenScene` / `VreenEntityJson` / `VreenWorldJson` / `VreenAssetEntry` / `VreenFormatVersion` / `VreenPackageException`
  - 完整 round-trip 单元测试 + `RoundTripExample` 示例

### Added — .vreen 包格式规范
- **`docs/format/vreen-format-spec.md`**: 0.2.1 版本的权威规范文档
  - ZIP 容器布局 / 版本迁移规则 / 字段语义
  - `.vreen-delta` 增量包定义

### Added — 工程工具
- **`scripts/vreen-cli.mjs`**: `npm run vreen` 命令,`.vreen` 包的打包 / 解包 / 验证 CLI
- **`scripts/rewrite-engine-imports.cjs`**: `src/engine/import` → `import from '@vreen/engine'` 路径重写器(打包前使用)
- **日志系统** (`src/lib/logger.ts`): 集中式 `createLogger(module)` API,模块标签 + 时间戳,console + UI 双向同步,热路径 (render / world.update) 每 120 帧汇总,UI push 500ms 节流

### Added — UI 增强
- **VreenInspectorPanel**: `.vreen` 包内省面板(包版本 / 资产 / 场景 / 世界摘要)
- **EntityGraph**: 实体关系图
- **FrameChart / ProfilerHUD**: 性能分析可视化
- **physicsDemo** flag in `viewerStore`;`PHYSICS` / `PHYS-DBG` / `PROFILER` 三个工具栏按钮

### Changed
- **构建工具链**:
  - 入口依赖 `draco3d`,提供 Draco 解码
  - `npm run vreen` CLI 脚本
- **ViewerToolbar**: 新增 `PHYSICS` / `PHYS-DBG` / `PROFILER` 按钮,默认沿用 THEME
- **i18n**: 补充物理 / 调试 / 性能相关词条 (`zh.json` / `en.json`)
- **README / english.md**: 更新特性列表,反映 ECS 调试、物理模拟、性能分析、跨语言 SDK

### Fixed
- **类型错误**: `BufferAttribute.setUsage` / `needsUpdate` / `BufferGeometry.dispose` 缺失导致 typecheck 失败
- **类型推断**: `PhysicsDebugRenderer.queryOne` 用泛型 helper 绕过 `queryWith` 类型推断
- **CustomStage**: `assetSource.name` 改为 `assetName`,避免类型错误

### Verification
- `npm run typecheck` 通过(0 错误)
- `npm run build` 通过(2414 modules,≈26.95s,产物大小未变)
- Vite HMR dev server 烟测正常

---

## [0.3.1] - 2026-07-07

### Fixed
- **TypeScript 构建错误**: 修复 10 个 typecheck 错误 (custom stage quaternion 调用、Vector3.sub 参数、AnimState 命名冲突、PlayerInputC 引用、RoundtripReport 接口、Group.rotation 字段)
- **electron-builder 配置**: 移除已弃用的 `signAndEditExecutable` / `signDlls` 选项以适配 electron-builder 26.x
- **依赖**: 补装 `electron@43` + `electron-builder@26` 到 devDependencies

### Changed
- **构建工具链**: Windows 桌面便携版现使用 electron-builder 26.15.3 + Electron 43，输出 `VREEN-Portable-0.1.0.exe` (≈180 MB)

### Verification
- `npm run typecheck` 通过
- `npm run build` 通过 (2383 modules)
- `npx electron-builder --win --x64` 通过,生成 [release/VREEN-Portable-0.1.0.exe](file:///f:/开发/开源/GitHub/vreen/vreen/release/VREEN-Portable-0.1.0.exe)

---

## [0.3.0] - 2026-07-05

### Added
- **自研 WebGL2 引擎** (`src/engine/`): 完整 Three.js 风格 API (Object3D / Group / Mesh / SkinnedMesh / Bone / Skeleton / BufferGeometry / AnimationMixer / AnimationClip / KeyframeTrack)
- **自研 PBR 渲染管线**: Cook-Torrance metallic-roughness material, GPU skinning, shadow mapping
- **ECS 架构** (`src/engine/ECS/`): World / EntityId / ComponentType / System, 对 Java 友好,支持 .vreen 序列化
- **GLB Loader** (`src/engine/Loaders/GLBLoader.ts`): 零 Three.js 依赖的 glTF 2.0 解析器,覆盖 80% 用例 (节点 / 网格 / 蒙皮 / 动画)
- **Custom Stage**: viewer 工具栏新增 "THREE/CUSTOM" 切换,可在自研引擎上预览 GLB
- **ECSPanel**: Inspector 内嵌 ECS 调试面板 (实体列表 / 组件数据 / AnimState 状态机 / PlayerInput 实时状态)
- **PlayerInputSystem**: WASD + Shift + Space 直接驱动 Velocity
- **AnimationStateMachine**: 自动识别 Idle/Walk/Run clip,按 Velocity 切换
- **.vreen 包格式** v0.2.1: zip 容器,内含 manifest / scene / 嵌入资源 / world 状态

### Fixed
- **GLBLoader**: 修复 `isBone` 检测把全部节点都升级成 Bone 的 bug
- **GLBLoader**: 替换 CommonJS `require()` 为 ESM `import` (Vite 兼容)
- **GLBLoader**: TEXCOORD_0 itemSize 改为根据 accessor.type 决定 (VEC2 → 2 而非 4),UV 数据正确
- **ECSPanel**: 修复 `EntityDetail` 引用未声明的 `world`/`version` 导致 `PlayerInputBlock` 永远不渲染
- **MovementSystem**: 修复绕 Y 轴 quaternion 乘法公式错误
- **ViewerToolbar / Inspector**: 用 `useViewerStore` selector 替代 `getState()` 闭包,避免 stale modelFile
- **CustomStage**: 移除无用的 `t` 组件假阳性守卫
- **CustomStage**: 删除 `scene.background` (渲染器用 `clearColor`)
- **worldStore**: 删除 `syncFromSceneGraph` 末尾重复的 version 自增
- **Stage**: 删除未使用的 `useWorldStore` import

### Verification
- `npx tsc --noEmit` 通过
- `npx vite build` 通过 (2383 modules)
- 本地 dev server 烟测正常
