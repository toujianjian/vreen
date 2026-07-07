# Changelog

All notable changes to VREEN are documented in this file.

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
