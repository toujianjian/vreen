<h1 align="center">⚡ VREEN ⚡</h1>

<p align="center">
  🌐 <b>中文</b> · <a href="./english.md">English</a>
</p>


> 全息级别的 3D 模型检视与展示平台,为独立游戏开发者和 3D 艺术家打造。
> 检视 · 调节 · 截图 —— 浏览器即开即用,无需安装。

![VREEN banner](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=futuristic%20holographic%20display%20showing%20a%20floating%20geometric%203D%20crystal%2C%20surrounded%20by%20neon%20cyan%20and%20magenta%20HUD%20interface%20elements%2C%20dark%20space%20background%20with%20subtle%20stars%2C%20scanning%20grid%20below%2C%20volumetric%20light%20rays%2C%20cinematic%208K%20hyper%20detailed%20digital%20art&image_size=landscape_16_9)

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-r169-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ 功能特性

| | |
|---|---|
| 🎨 **赛博朋克 HUD** | 霓虹青/品红扫描线美学,全键盘友好的检视界面 |
| 🧊 **多格式加载器** | `GLB` · `GLTF` · `OBJ` · `FBX` · `STL` · `PLY` —— 全部在浏览器端解析 |
| 📷 **9 种人称视角** | 自由 / 等距 / 前 / 后 / 侧 / 顶 / 第一人称 / 第三人称 / 电影感 |
| 🎛️ **可调相机镜头** | FOV (15–90°)、距离倍数、目标高度、阻尼、轨道速度 |
| 🧪 **材质实验室** | 实时编辑基础色 / 金属度 / 粗糙度 / 自发光 / 不透明度 / 线框 |
| 🌅 **HDRI 环境** | 工作室 / 夕阳 / 仓库 / 夜晚 / 城市 —— 支持曝光与背景模式 |
| ✨ **后处理特效** | Bloom · 色差 · 暗角 · SMAA —— 全部可独立开关 |
| 📊 **实时场景统计** | FPS、三角面、网格、材质、视角、FOV、动画时间 |
| 🖼️ **一键截图** | 当前帧保存为 PNG(基于 `preserveDrawingBuffer`) |
| 📁 **拖拽上传** | 也可点击选择 —— 立即检视,文件不上传服务器 |
| ⚡ **零后端** | 100% 静态 —— 可托管在 GitHub Pages、Vercel、Netlify 等任何平台 |

---

## 🚀 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/toujianjian/vreen.git
cd vreen

# 2. 安装依赖(npm / pnpm / yarn 均可)
npm install

# 3. 启动开发服务器
npm run dev
# → 打开 http://localhost:5173

# 4. 生产构建
npm run build
# → 输出到 dist/ 目录
```

### 环境要求
- **Node.js** ≥ 18.18
- 支持 **WebGL 2** 的现代浏览器(Chrome / Edge / Firefox / Safari 最新版)

---

## 🗂️ 项目结构

```
vreen/
├── src/
│   ├── components/
│   │   ├── home/          # 主页(Hero、Gallery、Uploader、TerminalLog、Footer)
│   │   ├── viewer/        # 3D 检视器(Stage、SceneContents、Outliner、Inspector、Toolbar、StatusBar)
│   │   ├── three/         # 迷你 Canvas 辅助(BackgroundScene、PresetPreview)
│   │   └── hud/           # 可复用 HUD 组件(HudPanel、TopBar)
│   ├── pages/             # 路由级页面(HomePage、ViewerPage)
│   ├── stores/            # Zustand 状态库(viewer、inspector、ui)
│   ├── three/             # 3D 核心:相机机位、加载器、生成器、归一化
│   ├── lib/               # 通用工具(cn、format、presets、screenshot、uploadBridge)
│   ├── types/             # 共享 TypeScript 类型
│   ├── styles/            # Tailwind 入口 + 自定义 CSS(HUD、扫描线、字体)
│   ├── App.tsx            # 路由外壳
│   └── main.tsx           # React 根组件
├── .trae/documents/       # PRD 与技术架构文档
├── public/                # 静态资源
├── index.html             # Vite 入口
├── tailwind.config.js     # 自定义霓虹主题配置
├── tsconfig.*.json        # TypeScript 项目引用
└── vite.config.ts         # Vite + 手动分块(three / r3f / post)
```

---

## 🎮 使用指南

### 1. 主页
- 把 `.glb` / `.gltf` / `.obj` / `.fbx` / `.stl` / `.ply` 文件拖入 **上传区**
- 或在 **程序化预设画廊** 中挑选(机器人、机甲、载具、建筑、场景、晶体)
- 或在 **资源画廊** 中点击任意缩略图立即进入检视

### 2. 检视器
资源加载完成后,检视器分三栏展示:

```
┌──────────┬───────────────────────────┬──────────┐
│ 大纲树   │      3D 舞台 (Canvas)     │ 检查器   │
│  搜索    │   • 轨道 / 人称控制       │ 材质     │
│          │   • 实时 HUD 叠加         │ 相机     │
│          │   • 统计 + 动画           │ 环境/FX  │
│          │   • 截图按钮(顶部)       │ 显示     │
└──────────┴───────────────────────────┴──────────┘
```

#### 人称视角(顶部工具栏)
| 按钮 | 模式 | 说明 |
|---|---|---|
| **FREE** | 自由轨道 | 用户控制,无约束 |
| **ISO** | 等距视角 | 45° 角 —— 检视默认首选 |
| **FRONT / BACK / SIDE** | 轴向 | 锁定到平面,便于技术审阅 |
| **TOP** | 顶视 | 自上而下,极角受限 |
| **1ST** | 第一人称 | 眼高 POV 看向模型 |
| **3RD** | 第三人称 | 模型后上方,FOV 略大 |
| **CINE** | 电影感 | 自动环绕,不接受输入(由 `cinematicSpeed` 驱动) |

#### 键鼠操作
- **左键拖拽** —— 旋转
- **右键拖拽** —— 平移
- **滚轮** —— 推拉镜头
- **Shift + 滚轮** —— 调整 FOV(部分预设可用)

#### 截图
点击右上角 **CAPTURE** 即可下载当前帧的 PNG。文件名按资源名 + 时间戳自动生成。

---

## 🧱 技术栈

- **React 18 + TypeScript 5** —— 全链路严格类型
- **Vite 5** —— 亚秒级热更新,手动分块
- **Three.js r169** + **@react-three/fiber** + **@react-three/drei** —— 声明式 3D
- **@react-three/postprocessing** —— 现代后处理管线
- **Zustand** —— 极简、易用的状态管理(无 Redux 样板)
- **Tailwind CSS 3** —— 原子化 + 自定义 HUD 主题
- **React Router 6** —— Hash 路由,便于静态部署
- **Lucide React** —— 清晰的 SVG 图标集
- **Framer Motion** —— 细腻的 UI 微动画

---

## ⚙️ 命令脚本

| 脚本 | 作用 |
|---|---|
| `npm run dev` | 启动 Vite 开发服务器,带 HMR |
| `npm run build` | TypeScript 构建 + Vite 生产打包 |
| `npm run preview` | 本地预览构建产物 `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` 严格类型检查 |

---

## 🗺️ 路线图

- [x] 多格式加载器(GLB / GLTF / OBJ / FBX / STL / PLY)
- [x] 9 种人称相机系统,全部可调
- [x] 材质实验室,实时更新
- [x] 后处理管线(Bloom、色差、暗角、SMAA)
- [x] 程序化预设画廊
- [x] 一键 PNG 截图
- [x] 赛博朋克 HUD 主题
- [ ] 骨骼动画播放(带时间轴拖动)
- [ ] 网格选中(点击聚焦大纲树中的部件)
- [ ] 真实场景树(从 `THREE.Object3D` 构建,目前为示意树)
- [ ] HDRI 上传 + 自定义环境贴图
- [ ] GLTF Draco / Meshopt 压缩
- [ ] VR / WebXR 模式
- [ ] 多资源对比视图
- [ ] 项目导出(`.vreen` 包 = 模型 + 相机 + 材质 + 灯光预设)

---

## 🐛 已知问题
- **大纲树**目前为示意树,非实时 `THREE` 场景图。后续版本将接入真实树。
- **FBX** 贴图/材质转换取决于源 FBX 本身;部分复杂 PBR 贴图可能无法完美还原。
- 在 Windows + 含非 ASCII 字符的工程路径下,`lucide-react` 的 `replace-all` 图标可能在 install 时丢失 —— 遇到 `Could not read from file ... replace-all.js` 时,见 [setup-git.ps1](./setup-git.ps1) 中的一行 shim。

---

## 📦 部署

VREEN 是 100% 静态 SPA。把 `dist/` 扔到任何静态托管即可:

```bash
npm run build
# 把 dist/ 内容上传到:
#   - GitHub Pages
#   - Vercel
#   - Netlify
#   - Cloudflare Pages
#   - 任意 nginx / Apache / S3
```

> 若部署到 GitHub Pages,请在 `vite.config.ts` 中设置 `base: '/vreen/'`。

---

## 🤝 参与贡献

欢迎提 Issue 和 PR。较大的改动前请先开 Issue 讨论。

```bash
git checkout -b feat/your-feature
git commit -m "feat: ..."
git push origin feat/your-feature
# 在 GitHub 上发起 Pull Request
```

---

## 📄 开源协议

[MIT](./LICENSE) © 2026 toujianjian

---

## 💌 致谢

- Three.js example loaders(GLTF / OBJ / FBX / STL / PLY) —— MIT
- Lucide Icons —— ISC
- @react-three 生态 —— MIT
- 灵感来源:Sketchfab、three.js editor、Blender 视口

> "VREEN" —— 即 "Vector Render Engine ENvironment"(矢量渲染引擎环境)。由 [toujianjian](https://github.com/toujianjian) 用心打造。
