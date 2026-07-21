# VREEN 发展规划 v2

> 单人维护 · 轻量游戏引擎定位 · 不定期开发节奏 · 质量建设优先
>
> 参考 [Three.js](https://github.com/mrdoob/three.js) 与 [O3DE (Open 3D Engine)](https://github.com/o3de/o3de) 的架构设计。
>
> **版本**: 2.0 · **更新**: 2026-07-21

---

## 一、定位与原则

### 定位：轻量 Web 游戏引擎

VREEN 不是"另一个 3D 检视器"——检视器只是展示层。核心是 **自研 WebGL2 引擎 + ECS + 物理 + 动画** 这一套完整的游戏引擎基础能力。对标的是 Godot / 早期 Unity 的 Web 实现。

### 开发原则（单人 + 不定期）

| 原则 | 含义 |
|------|------|
| 🎯 **任务原子化** | 每个任务 1-3 小时可完成，随到随停 |
| 🧱 **先建地基** | 没有测试/CI 保护的功能，随时可能被后续改动破坏 |
| 🔁 **持续集成** | 单人维护更需要 CI 自动检查，不然久了就忘了 |
| 🚫 **不追大功能** | 不做需要连续投入 2 周以上的大模块，拆成可独立交付的子任务 |
| 📝 **文档即代码** | 改代码同步改文档，不然下次连自己都看不懂 |

---

## 二、参考项目分析

### Three.js 值得学习的

| 能力 | 描述 | VREEN 差距 |
|------|------|------------|
| **可扩展渲染器** | Renderer 接口抽象，WebGL/WebGPU 可插拔 | `WebGL2Renderer` 是具体类，无抽象接口 |
| **NodeMaterial 材质图** | 节点图 → Shader 自动生成，r155+ 正式版 | `ShaderMaterial` 只接收 GLSL 字符串 |
| **加载器生态** | 几十个官方加载器 (GLTF/OBJ/FBX/STL/PLY/KTX2) | 只有 4 个格式，无 KTX2/Basis |
| **LOD 系统** | Level of Detail 自动切换 | 无 |
| **InstancedMesh** | 批量渲染同一几何体 | 无 |
| **Frustum culling** | 内置场景图剔除 | 无 |
| **WebGPU 支持** | r170+ 已稳定 | 无 |

### O3DE 值得学习的

| 能力 | 描述 | VREEN 差距 |
|------|------|------------|
| **CES 深度** | 组件驱动实体，Prefab 嵌套，网络同步 | ECS 基础架构已有，但缺 Prefab/序列化/Snapshot 同步 |
| **Asset Processor** | 导入时预编译 (FBX→网格/纹理压缩/着色器缓存) | 全部运行时加载，无预编译步骤 |
| **Script Canvas** | 可视化脚本 → Component 绑定 → Tick 事件驱动 | Blockly 已有，但脚本独立运行，不与 ECS 绑定 |
| **EMotionFX** | Blend Space / Anim Graph / Motion Matching | 只有基础状态机 |
| **Atom Renderer** | Pass 系统 + RDG + 多后端 | 后处理 5 个 Pass 手动串联 |

---

## 三、VREEN 当前状态（截至 2026-07-20）

### Git 当前分支

**未提交的变更**：14 个修改文件 + 4 个新文件
- 自研引擎改进：HDRLoader RLE 重构、CustomStage Canvas resize 修复、WebGL2 着色器版本升级
- Blockly 面板：`vreenBlockly.ts` (473行) + `BlocklyPanel.tsx` (193行) + 工具栏按钮 + i18n 词条
- 启动日志扩展为 8 条

### 各模块成熟度

```
模块                      成熟度      说明
─────────────────────────────────────────────────
WebGL2Renderer            ██████░░    PBR + 后处理 + 阴影，缺抽象接口
ECS                       ██████░░    基础 World + ComponentType + System 完备
物理 (刚体/碰撞/粒子)      █████░░░    semi-implicit Euler + 冲量响应，演示级
动画 (Mixer + StateMachine)██████░░    动画混合 + 状态机 + Humanoid
Blockly 脚本              ██░░░░░░    刚写完，未验证
.vreen 包 + CLI           ██████░░    打包/解包/验证/多语言 SDK
Three.js 渲染 (R3F)       ████████    成熟，直接复用 @react-three/fiber
加载器 (GLB/HDR/OBJ)      ██████░░    核心场景覆盖，缺 KTX2/FBX
Math 库 (Vec3/Mat4/Quat)  ██████░░    基础完备，缺插值/切割/投影等工具方法
单元测试                   ░░░░░░░░    完全没有
CI/CD                     ░░░░░░░░    完全没有
Electron 桌面              ██████░░    便携版可构建
```

---

## 四、路线图

### Phase 0 — 当前积压清理（1-3 天）

这些是已经写完但未提交的代码，先验证、修复、合入。

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 0.1 | 🔥 **验证 Blockly 面板**：打开浏览器，拖积木，点 Run，看 3D 场景有没有反应 | 2h | 开发服务器运行中 | 确认 Blockly 可用 / 发现 Bug |
| 0.2 | **审阅 HDRLoader 改动**：检查 per-channel RLE 解码是否覆盖了所有 .hdr 变体 | 1h | — | 确认无回归 |
| 0.3 | **审阅 CustomStage 改动**：Canvas resize 逻辑、render() try-catch、clearColor 修正 | 1h | — | 确认无回归 |
| 0.4 | **提交 Phase 0 所有变更**：git commit + push | 0.5h | 0.1-0.3 完成 | 未提交代码入库 |

**合入后新版本建议**: v0.5.1 (小版本维护)

---

### Phase 1 — 质量地基（2-4 周，核心！）

**为何先做这些**：单人维护 + 不定期开发 = 两次开发间隔期间你可能会忘掉细节。没有测试/CI 保护，改 A 坏 B 是必然的。质量地基不是"锦上添花"，是**生存前提**。

#### 1.1 单元测试框架搭建

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 1.1.1 | **安装 Vitest + 配置**：`vitest` 与 Vite 共享配置，零额外配置 | 0.5h | — | `npm run test` 可用 |
| 1.1.2 | **Math 库测试**：Vector3 (add/sub/cross/dot/length/normalize)，Matrix4 (multiply/inverse/transpose)，Quaternion (multiply/slerp/rotateVector) | 2h | 1.1.1 | `src/engine/Math/*.test.ts` |
| 1.1.3 | **ECS 核心测试**：World.createEntity/destroyEntity 生命周期、setComponent/getComponent/removeComponent、query() 正确性、toJSON/loadJSON 往返 | 2h | 1.1.1 | `src/engine/ECS/World.test.ts` |
| 1.1.4 | **HDRLoader 测试**：用一小段已知正确的 .hdr 二进制数据做解码测试，验证 RGBE→Float32 转换正确性 | 1.5h | 1.1.1 | `src/engine/Loaders/HDRLoader.test.ts` |
| 1.1.5 | **GLBLoader 测试**：构造最小 GLB 二进制 buffer，验证解析不抛异常 | 1.5h | 1.1.1 | `src/engine/Loaders/GLBLoader.test.ts` |
| 1.1.6 | **Animation 测试**：AnimationClip 创建、AnimationMixer 播放/暂停/跳转、StateMachine 状态切换 | 2h | 1.1.1 | `src/engine/Animation/*.test.ts` |
| 1.1.7 | **Physics 测试**：CollisionSystem overlap 检测、冲量响应方向正确性、ParticleSystem 推进 | 2h | 1.1.1 | `src/engine/ECS/PhysicsSystems.test.ts` |

**Phase 1 总计**: ~11.5h（按不定期节奏，约 2-4 周完成）

#### 1.2 CI 持续集成

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 1.2.1 | **配置 GitHub Actions**：`.github/workflows/ci.yml`，push 和 PR 触发 | 1h | — | 每次 push 自动跑 typecheck + build + test |
| 1.2.2 | **配置 Git Hooks 辅助**：`husky` + `lint-staged`，commit 前自动 typecheck 改动的文件 | 0.5h | — | 提交前快速检查 |

#### 1.3 类型安全加固

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 1.3.1 | **扫描 `any` 逃生口**：`grep -r 'as any' src/engine/`，逐个评估能否用更精确的类型替代 | 1h | — | 减少类型不安全点 |
| 1.3.2 | **启用 `noUnusedLocals` 和 `noUnusedParameters`**：当前 tsconfig 禁用了这两项，打开后清理未使用变量 | 0.5h | — | 更严格的类型检查 |

---

### Phase 2 — 引擎核心增强（4-8 周）

有了测试保护后，可以放心改引擎代码了。

#### 2.1 渲染器抽象

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 2.1.1 | **抽象 `Renderer` 接口**：`interface Renderer { render(scene, camera): void; resize(w, h): void; canvas: HTMLCanvasElement }`，让 `WebGL2Renderer` 实现它 | 2h | — | 后续可插拔 WebGPU 后端 |
| 2.1.2 | **RenderPass 抽象**：每个后处理效果抽象为 `class RenderPass { apply(input, output): void }`，用数组编排 | 3h | — | 后处理管线可扩展，不再硬编码 5 个 Pass |

#### 2.2 性能优化

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 2.2.1 | **Frustum culling**：在 `WebGL2Renderer.render()` 中遍历 scene 时，用 camera 的 view-projection 矩阵做视锥体裁剪 | 3h | 2.1.1 | 大场景渲染性能提升 |
| 2.2.2 | **InstancedMesh**：新增 `InstancedMesh` 类（继承 Mesh），维护 per-instance 矩阵数组，用 `gl.drawElementsInstanced` 渲染 | 3h | 2.1.1 | 批量物体渲染性能提升 |
| 2.2.3 | **LOD 系统**：新增 `LOD` 类，持有多级 Mesh，根据与相机的距离自动切换 | 3h | 2.1.1 | 大场景 LOD 控制 |

#### 2.3 ECS 增强

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 2.3.1 | **ECS → .vreen 序列化端到端验证**：确保 World.toJSON() + loadJSON() 包含所有 POJO 组件，round-trip 后数据一致 | 2h | 1.1.3 | 保存/加载完整场景 |
| 2.3.2 | **Prefab 基础**：`Prefab` 类，持有一组 Entity 模板（组件 + 变换），`instantiate(world): EntityId[]` | 3h | 2.3.1 | 实体模板化复用 |
| 2.3.3 | **QueryBuilder 缓存**：当前 `query()` 每次新建数组，为高频查询场景加缓存 | 2h | 1.1.3 | 高频查询性能提升 |

#### 2.4 物理增强

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 2.4.1 | **物理引擎 Benchmark 测试**：压测 100/500/1000 个刚体碰撞的性能拐点，确定当前引擎的规模上限 | 2h | 1.1.7 | 了解物理引擎瓶颈 |
| 2.4.2 | **Broadphase 优化**：当前暴力 O(n²) 检测，可加空间哈希 / Sweep-and-Prune | 4h | 2.4.1 | 大规模碰撞性能提升 |

#### 2.5 动画增强

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 2.5.1 | **Blend Space 1D**：根据速度值混合两个动画 clip，Idle→Walk→Run 平滑过渡 | 3h | — | 更自然的动画过渡 |
| 2.5.2 | **动画事件回调**：在 AnimationClip 的时间点注册回调（如"脚落地时播放音效"） | 1.5h | — | 动画事件系统 |

---

### Phase 3 — Blockly 深度集成（4-6 周）

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 3.1 | **Blockly 积木 → ECS Component 绑定**：新增积木"添加组件/设置组件值"，运行时操作 ECS World | 3h | 0.1 | 脚本可控制 ECS 实体 |
| 3.2 | **Tick 事件积木**：`on tick → do ...`，脚本注册到每帧更新循环 | 3h | 3.1 | 脚本参与每帧逻辑 |
| 3.3 | **材质图积木**：Blockly 积木拼接 → `ShaderMaterial` 的 GLSL 自动生成（基础版：颜色 + 金属度 + 粗糙度节点） | 4h | — | 无需写 GLSL 改材质 |
| 3.4 | **动画蓝图积木**：可视化搭建动画状态机（状态 + 过渡 + Guard） | 3h | 3.1 | 可视化动画控制 |
| 3.5 | **Blockly 脚本保存/加载**：脚本序列化到 .vreen 包中 | 2h | 3.1 | 脚本可持久化 |

---

### Phase 4 — 加载器与资产管线（4-6 周）

| # | 任务 | 估计 | 前置 | 产出 |
|---|------|------|------|------|
| 4.1 | **KTX2/Basis 纹理压缩支持**：用 `three/examples/jsm/loaders/KTX2Loader` 或自研实现 | 3h | — | 减少纹理带宽 |
| 4.2 | **FBX 加载器**：使用 Three.js 的 FBXLoader 或自研解析器 | 3h | — | 覆盖更多格式 |
| 4.3 | **.vreen 发布模式**：`npm run vreen publish` → 打包时预编译 Shader、压缩纹理、生成 LOD 级别 | 4h | — | 运行时加载速度提升 |
| 4.4 | **AssetManager 缓存策略完善**：当前 LRU 缓存已实现，但缺少缓存预热/预加载 API | 2h | — | 更智能的资产管理 |

---

### Phase 5 — 长期愿景（12 周+）

| # | 任务 | 估计 | 前置 | 说明 |
|---|------|------|------|------|
| 5.1 | **WebGPU 渲染后端** | 高 | 2.1.1 | 面向未来，等 WebGPU 浏览器覆盖率达到 80%+ |
| 5.2 | **多人协作编辑** | 高 | 2.3.3 | WebSocket 同步 ECS World 状态 |
| 5.3 | **AI 辅助场景生成** | 探索 | 3.2 | LLM + Blockly，用户说"创建一个森林场景"自动生成积木脚本 |
| 5.4 | **在线模型市场** | 极高 | 4.3 | 用户上传/分享 .vreen 包 |

---

## 五、技术债务清单

以下问题暂不列入路线图，但值得记录：

| 问题 | 位置 | 影响 | 建议时机 |
|------|------|------|----------|
| `tsconfig` 禁用了 `noUnusedLocals` 和 `noUnusedParameters` | `tsconfig.app.json` | 可能在代码中遗留死代码 | Phase 1.3.2 |
| `CustomStage.tsx` 中 `render()` 的 try-catch 刚刚加入，没有错误恢复机制 | `CustomStage.tsx` | 渲染崩溃后直接停止渲染循环 | 可在 Phase 0.3 审查时讨论 |
| `BlocklyPanel.tsx` 的 `handleStop()` 只是设了 running=false，没有真中止能力 | `BlocklyPanel.tsx` | 长脚本无法中断 | Phase 3.2 时一并解决 |
| 没有错误边界组件 (React ErrorBoundary) | 全局 | 任意组件崩溃 → 白屏 | 可单独作为一个 1h 任务 |
| 没有 `@vreen/engine` 包的 npm 发布流程 | `packages/engine/` | 只能通过 GitHub 安装 | 等引擎 API 稳定后 |

---

## 六、建议优先级汇总

```
现在           Phase 0          Phase 1           Phase 2          Phase 3
├──────────────┼────────────────┼──────────────────┼────────────────┤
│  Blockly验证  │  测试框架      │  渲染器抽象       │  Blockly+ECS  │
│  代码审查     │  Math 测试     │  Frustum culling │  Tick 绑定     │
│  提交合入     │  ECS 测试      │  InstancedMesh   │  材质图        │
│              │  Loader 测试   │  LOD             │               │
│              │  CI/CD         │  ECS 序列化       │               │
│              │  类型加固       │  Prefab          │               │
│              │                │  Blend Space     │               │
│              │                │  物理 Benchmark   │               │
└──────────────┴────────────────┴──────────────────┴────────────────┘
    1-3 天          2-4 周          4-8 周           4-6 周
```

### 我推荐的第一优先级

```
Phase 0 (1-3天) → Phase 1 (2-4周) → 然后看情况选 Phase 2 或 Phase 3
```

- **Phase 0 是"把已经写了的代码真正跑起来"**，不费什么力气
- **Phase 1 是"让以后不会改坏自己的代码"**，单人不定期开发最需要这个
- 之后 Phase 2（引擎深度）和 Phase 3（Blockly 集成）可以根据你当时的心情切换

---

## 七、长期愿景

```
Three.js 渲染灵活性  ────┐
                         ├──→ VREEN —— Web 原生 3D 创作工具链
O3DE 架构工程深度     ────┘
                         │
Blockly 零代码脚本     ──┘

├── 面向开发者: @vreen/engine 零依赖引擎包
├── 面向艺术家: 浏览器内检视 + 材质编辑 + .vreen 发布
└── 面向所有人: Blockly 拖拽编程控制 3D 场景
```

---

*本规划基于 VREEN v0.5.0 代码分析 (2026-07-20)*
*参考项目: [Three.js](https://github.com/mrdoob/three.js) · [O3DE](https://github.com/o3de/o3de)*