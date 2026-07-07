<h1 align="center">⚡ VREEN ⚡</h1>
<p align="center">
  🌐 <b>中文</b> · <a href="./english.md">English</a>
</p>

> 面向独立游戏开发与 3D 内容生产的下一代检视平台。
> 自研 WebGL2 引擎内核 · ECS 驱动 · 角色 / 动画 / 资产管线一体化 · 浏览器与桌面端双端可用。
>
> 📝 [更新日志](CHANGELOG.md) · 🌐 [English](english.md)

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react\&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript\&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-r169-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite\&logoColor=white)](https://vitejs.dev)
[![Electron](https://img.shields.io/badge/Electron-桌面便携包-47848f?logo=electron\&logoColor=white)](https://www.electronjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

***

## ✨ 功能特性

| <br /> | <br /> |
| --- | --- |
| 🎨 **赛博朋克 HUD** | 霓虹青 / 品红扫描线美学，全键盘友好的检视界面 |
| 🧊 **多格式加载器** | `GLB` · `GLTF` · `OBJ` · `FBX` · `STL` · `PLY` —— 全部在浏览器端解析 |
| 📷 **9 种人称视角** | 自由 / 等距 / 前 / 后 / 侧 / 顶 / 第一人称 / 第三人称 / 电影感 |
| 🎛️ **可调相机镜头** | FOV (15–90°)、距离倍数、目标高度、阻尼、轨道速度 |
| 🧪 **材质实验室** | 实时编辑基础色 / 金属度 / 粗糙度 / 自发光 / 不透明度 / 线框 |
| 🌅 **HDRI 环境** | 工作室 / 夕阳 / 仓库 / 夜晚 / 城市 —— 支持曝光与背景模式，也可上传自定义 HDR |
| ✨ **后处理特效** | Bloom · 色差 · 暗角 · SMAA —— 全部可独立开关 |
| 📊 **实时场景统计** | FPS、三角面、网格、材质、视角、FOV、动画时间 |
| 🖼️ **一键截图** | 当前帧保存为 PNG（基于 `preserveDrawingBuffer`） |
| 📁 **拖拽上传** | 也可点击选择 —— 立即检视，文件不上传服务器 |
| 🧩 **自研 WebGL2 引擎内核** | Three.js 风格 API 的独立场景图 / 数学库 / PBR 材质 / GPU 骨骼动画，逐步替代外部依赖 |
| 🧩 **ECS 架构** | Entity-Component-System：Transform / Velocity / PlayerInput / AnimState / MeshRef / SkinnedMeshRef 等 |
| 🎮 **角色控制** | `WASD` 移动、`Shift` 奔跑、`Space` 跳跃，输入按相机朝向转换到世界空间 |
| 🎞️ **动画状态机** | Idle / Walk / Run 自动切换，带过渡时间；驱动 ECS 与自研 AnimationMixer |
| 🧬 **场景图 ↔ ECS 同步** | 加载模型后自动生成 ECS entities，ECS 改动实时同步回 three.js 渲染 |
| 📦 **.vreen 包格式** | 自包含 zip：模型 + 场景（相机 / 材质 / 环境 / 后处理）+ ECS World JSON，支持 Java 端 POJO 读写 |
| 🔧 **资产管线** | Loader 抽象 + AssetManager、GLBLoader、TextureLoader、HDRLoader，可扩展 |
| 🖥️ **桌面便携版** | Electron 打包为单文件 `.exe`，无需安装 |

***

## 🚀 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/toujianjian/vreen.git
cd vreen

# 2. 安装依赖（npm / pnpm / yarn 均可）
npm install

# 3. 启动开发服务器
npm run dev
# → 打开 http://localhost:5173

# 4. 生产构建（静态 SPA）
npm run build
# → 输出到 dist/ 目录

# 5. 构建 Windows 桌面便携版
npm run electron:build
# → 输出到 release/VREEN-Portable-0.1.0.exe
```

### 环境要求

- **Node.js** ≥ 18.18
- 支持 **WebGL 2** 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版）

***

## 🗂️ 项目结构

```
vreen/
├── src/
│   ├── components/
│   │   ├── home/          # 主页（Hero、Gallery、Uploader、TerminalLog、Footer）
│   │   ├── viewer/        # 3D 检视器（Stage、SceneContents、Outliner、Inspector、Toolbar、StatusBar、ECSPanel）
│   │   ├── three/         # 迷你 Canvas 辅助（BackgroundScene、PresetPreview）
│   │   └── hud/           # 可复用 HUD 组件（HudPanel、TopBar）
│   ├── engine/            # 自研 WebGL2 引擎内核（Core / Math / Animation / ECS / Loaders / Renderer / Controls / Lights / Cameras / Materials）
│   ├── pages/             # 路由级页面（HomePage、ViewerPage、EngineDemoPage）
│   ├── stores/            # Zustand 状态库（viewer、inspector、ui、world）
│   ├── three/             # three.js 桥接：相机机位、加载器、生成器、归一化、threeToCustomAnim
│   ├── lib/               # 通用工具与格式（cn、format、presets、screenshot、uploadBridge、vreenPack、vreenManifest、roundtripDemo）
│   ├── types/             # 共享 TypeScript 类型
│   ├── styles/            # Tailwind 入口 + 自定义 CSS（HUD、扫描线、本地字体）
│   ├── App.tsx            # 路由外壳
│   └── main.tsx           # React 根组件
├── electron/              # Electron 主进程 / preload / 启动页
├── public/                # 静态资源
├── index.html             # Vite 入口
├── tailwind.config.js     # 自定义霓虹主题配置
├── postcss.config.js      # PostCSS 配置
├── tsconfig.*.json        # TypeScript 项目引用
└── vite.config.ts         # Vite + 手动分块 + woff 清理插件
```

***

## 🎮 使用指南

### 1. 主页

- 把 `.glb` / `.gltf` / `.obj` / `.fbx` / `.stl` / `.ply` 文件拖入 **上传区**
- 或在 **程序化预设画廊** 中挑选（机甲、晶体、树木、飞船、生物、遗迹）
- 或在 **资源画廊** 中点击任意缩略图立即进入检视

### 2. 检视器

资源加载完成后，检视器分三栏展示：

```
┌──────────┬───────────────────────────┬──────────┐
│ 大纲树   │      3D 舞台 (Canvas)     │ 检查器   │
│  搜索    │   • 轨道 / 人称控制       │ 材质     │
│          │   • 实时 HUD 叠加         │ 相机     │
│          │   • 统计 + 动画           │ 环境/FX  │
│          │   • 截图按钮（顶部）      │ 显示     │
│          │                           │ ECS WORLD│
└──────────┴───────────────────────────┴──────────┘
```

#### 人称视角（顶部工具栏）

| 按钮 | 模式 | 说明 |
| --- | --- | --- |
| **FREE** | 自由轨道 | 用户控制，无约束 |
| **ISO** | 等距视角 | 45° 角 —— 检视默认首选 |
| **FRONT / BACK / SIDE** | 轴向 | 锁定到平面，便于技术审阅 |
| **TOP** | 顶视 | 自上而下，极角受限 |
| **1ST** | 第一人称 | 眼高 POV 看向模型 |
| **3RD** | 第三人称 | 模型后上方，FOV 略大 |
| **CINE** | 电影感 | 自动环绕，不接受输入（由 `cinematicSpeed` 驱动） |

#### 键鼠操作

- **左键拖拽** —— 旋转
- **右键拖拽** —— 平移
- **滚轮** —— 推拉镜头
- **Shift + 滚轮** —— 调整 FOV（部分预设可用）
- **W / A / S / D** —— 控制角色前后左右移动（按当前相机朝向）
- **Shift** —— 奔跑
- **Space** —— 跳跃

#### 截图

点击右上角 **CAPTURE** 即可下载当前帧的 PNG。文件名按资源名 + 时间戳自动生成。

#### 项目保存 / 加载

点击顶部 **PROJECT → SAVE .VREEN** 导出当前完整状态（模型 + 场景 + ECS World）。
点击 **LOAD .VREEN** 可恢复状态或导入他人分享的包。

#### ECS WORLD 面板

- 显示当前 World 的实体数、System 列表、Frame 计数
- 列出所有 Entity，点击可查看 Transform / Velocity / PlayerInput / AnimState 等组件
- 显示动画状态机当前 state、transition 倒计时、clip 时间
- 提供 **ECS → RENDER BRIDGE** 开关：打开后 ECS MovementSystem 会直接驱动 three.js root 位移

### 3. 自研引擎演示

访问 `/engine-demo` 路由可预览纯自研 WebGL2 渲染管线：

- 不依赖 three.js
- 展示 PBR 材质、方向光、环境光、平面阴影、自研 OrbitControls
- 后续将逐步迁移为 viewer 主渲染路径

***

## 🧱 技术栈

- **React 18 + TypeScript 5** —— 全链路严格类型
- **Vite 5** —— 亚秒级热更新，手动分块
- **Three.js r169** + **@react-three/fiber** + **@react-three/drei** —— 当前 viewer 渲染后端（逐步被自研引擎替代）
- **自研 WebGL2 引擎** —— 场景图、数学库、PBR 材质、GPU 骨骼动画、GLB/Texture/HDRI 加载器
- **@react-three/postprocessing** —— 现代后处理管线
- **Zustand** —— 极简、易用的状态管理（无 Redux 样板）
- **Tailwind CSS 3** —— 原子化 + 自定义 HUD 主题
- **React Router 6** —— Hash 路由，便于静态部署
- **Lucide React** —— 清晰的 SVG 图标集
- **Framer Motion** —— 细腻的 UI 微动画
- **Electron + electron-builder** —— Windows 便携桌面包
- **fflate** —— 浏览器端 zip 打包 / 解包（.vreen 容器）

***

## ⚙️ 命令脚本

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器，带 HMR |
| `npm run build` | TypeScript 构建 + Vite 生产打包 |
| `npm run preview` | 本地预览构建产物 `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` 严格类型检查 |
| `npm run electron:dev` | 并行启动 Vite + Electron 调试 |
| `npm run electron:build` | 构建生产包 + 打包 Windows 便携 exe |
| `npm run electron:build:dir` | 仅生成未打包的 win-unpacked 目录 |

***

## 🗺️ 路线图

- [x] 多格式加载器（GLB / GLTF / OBJ / FBX / STL / PLY）
- [x] 9 种人称相机系统，全部可调
- [x] 材质实验室，实时更新
- [x] 后处理管线（Bloom、色差、暗角、SMAA）
- [x] 程序化预设画廊
- [x] 一键 PNG 截图
- [x] 赛博朋克 HUD 主题
- [x] 骨骼动画播放（带时间轴拖动）
- [x] 网格选中（点击聚焦大纲树中的部件）
- [x] 真实场景树（从 `THREE.Object3D` 构建）
- [x] HDRI 上传 + 自定义环境贴图
- [x] 项目导出（`.vreen` 包 = 模型 + 相机 + 材质 + 灯光预设 + ECS World）
- [x] 自研 WebGL2 引擎内核（SceneGraph / Math / PBR / Skinning / Animation）
- [x] ECS 架构与常用组件 / 系统
- [x] 角色动画状态机（Idle / Walk / Run）
- [x] WASD + Shift + Space 角色控制
- [x] 场景图 ↔ ECS 双向同步
- [x] Windows 便携桌面版
- [ ] viewer 主渲染切换为自研 WebGL2 管线
- [ ] GLTF Draco / Meshopt 压缩
- [ ] VR / WebXR 模式
- [ ] 多资源对比视图
- [ ] Java 构建期工具（生成 .vreen 包）

***

## 🐛 已知问题

- **FBX** 贴图 / 材质转换取决于源 FBX 本身；部分复杂 PBR 贴图可能无法完美还原。
- 在 Windows + 含非 ASCII 字符的工程路径下，`lucide-react` 的 `replace-all` 图标可能在 install 时丢失 —— 遇到 `Could not read from file ... replace-all.js` 时，见 [setup-git.ps1](./setup-git.ps1) 中的一行 shim。
- 当前 `/viewer` 仍以 three.js 为渲染后端；`/engine-demo` 展示纯自研管线，逐步迁移中。

***

## 📦 部署

VREEN 主应用是 100% 静态 SPA。把 `dist/` 扔到任何静态托管即可：

```bash
npm run build
# 把 dist/ 内容上传到：
#   - GitHub Pages
#   - Vercel
#   - Netlify
#   - Cloudflare Pages
#   - 任意 nginx / Apache / S3
```

> `vite.config.ts` 已设置 `base: './'`，因此构建产物同时支持 HTTP 静态托管与本地 `file://`（Electron）打开。

桌面端由 `electron-builder` 输出到 `release/`：

```bash
npm run electron:build
```

***

## 🤝 参与贡献

欢迎提 Issue 和 PR。较大的改动前请先开 Issue 讨论。

```bash
git checkout -b feat/your-feature
git commit -m "feat: ..."
git push origin feat/your-feature
# 在 GitHub 上发起 Pull Request
```

***

## 📄 开源协议

[MIT](./LICENSE) © 2026 toujianjian

***

## 💌 致谢

- Three.js example loaders（GLTF / OBJ / FBX / STL / PLY） —— MIT
- @react-three 生态 —— MIT
- Lucide Icons —— ISC
- 本地字体：Orbitron、JetBrains Mono、Noto Sans SC（通过 fontsource）
- 灵感来源：Sketchfab、three.js editor、Blender 视口、Unity Editor

> **VREEN** —— 即 "Vector Render Engine ENvironment"（矢量渲染引擎环境）。由 [toujianjian](https://github.com/toujianjian) 用心打造。

***

### 🌐 项目地址

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-toujianjian%2Fvreen-181717?logo=github)](https://github.com/toujianjian/vreen)
[![Gitee](https://img.shields.io/badge/Gitee-toujianjian%2Fvreen-c71d23?logo=gitee)](https://gitee.com/toujianjian/vreen)

**GitHub**: <https://github.com/toujianjian/vreen>
**Gitee**: <https://gitee.com/toujianjian/vreen>

</div>
