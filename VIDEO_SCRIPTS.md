# VREEN 宣传视频文案库

---

## 版本 A：硬核技术向（适合 B 站 / 技术大会 / GitHub README 顶部）
**时长建议**：60-90 秒  
**风格**：快节奏、代码特写、终端输出、无废话

---

### [0:00-0:08] 冷开场
> **画面**：黑屏，绿色扫描线扫过，终端打字音  
> **字幕**（逐字打出）：
> ```
> npm install
> npm run dev
> ```
> **旁白/字幕**：下一代 3D 检视平台。浏览器打开，即用。

---

### [0:08-0:20] 核心能力速切（每镜头 1.5-2 秒）
| 镜头 | 画面内容 | 叠加关键词 |
|------|----------|------------|
| 1 | 拖入 .glb → 瞬间渲染，HUD 亮起 | **零配置 · 拖拽即检** |
| 2 | 9 种相机按钮极速切换：FREE→ISO→1ST→CINE | **9 人称 · 全可调** |
| 3 | 材质实验室：BaseColor/Metalness/Roughness 实时拖动 | **PBR 实时调** |
| 4 | HDRI 环境一键切：Studio→Sunset→Warehouse→Custom HDR | **IBL 就绪** |
| 5 | 后处理堆栈：Bloom/Chromatic/Vignette/SMAA/SSAO 独立开关 | **后处理全栈** |
| 6 | 截图按钮 → PNG 落入下载栏 | **一键出图** |

---

### [0:20-0:35] 引擎内核特写
> **画面**：代码编辑器滚动 `@vreen/engine` 源码  
> **字幕同步**：
> - SceneGraph / Math / PBR / IBL / Skinning / Animation / SSAO
> - **自研 WebGL2 内核**，零 three.js 依赖
> - `npm i @vreen/engine` 即可复用

> **画面**：ECS World 面板 — Entity 列表、Component 树、System 执行序  
> **字幕**：ECS 原生架构，World/ComponentType/System 全自研

---

### [0:35-0:50] 角色与物理
| 镜头 | 画面 | 字幕 |
|------|------|------|
| 1 | WASD 移动、Shift 奔跑、Space 跳跃，相机朝向映射世界空间 | **相机向移动 · 状态机驱动** |
| 2 | Animation State Machine：Idle↔Walk↔Run 平滑过渡 | **GPU Skinning + StateMachine** |
| 3 | 物理调试器：青色 Collider、黄色 Contact、品红 Velocity 三通道 | **Fixed-step 物理 · 可视化调试** |
| 4 | Entity Graph：实体-组件依赖图可搜索/高亮 | **全场景拓扑可视化** |

---

### [0:50-1:05] 多端与生态
> **画面分屏**：
> - 左：Chrome `localhost:5173` 运行
> - 右：Windows `VREEN-Portable.exe` 双击即用
> **字幕**：浏览器 / 桌面便携包 双端同源

> **画面快闪 SDK Logo**：
> - `@vreen/engine` (TS)
> - `vreen-core` (Kotlin/Java)
> - Unity Package (C#)
> - Unreal Plugin (C++)
> **字幕**：一份资产，五语言 SDK，引擎无关

---

### [1:05-1:15] 收尾
> **画面**：VREEN Logo + 扫描线淡出  
> **字幕**：
> ```
> GitHub: github.com/toujianjian/vreen
> MIT License · Star 一下
> ```
> **音效**：合成器收尾音

---

## 版本 B：创作者/独立游戏开发视角（适合 itch.io / IndieDB / 小红书 / 抖音）
**时长建议**：45-60 秒  
**风格**：赛博朋克美学、强调“省时间”、“好看”、“能用”

---

### [0:00-0:05] 痛点钩子
> **画面**：开发者对着 Blender/Unity 发呆，切到浏览器拖入模型 → 秒开  
> **字幕**：还在开重型编辑器只为看个模型？

---

### [0:05-0:20] “拿来就能用”的高光时刻
| 场景 | 画面 | 文案 |
|------|------|------|
| 素材审阅 | 拖入 FBX/GLB/OBJ/STL → 瞬间可旋转/截图 | **7 格式拖拽即看，文件不上传服务器** |
| 美术对齐 | ISO/Top/Front 切换、FOV 调节、网格贴图检查 | **技术审阅视角一键到位** |
| 氛围定调 | HDRI 环境切换、Bloom 开关、色差/暗角调节 | **赛博朋克风格，也是你的概念图参考器** |
| 动画验收 | 拖动时间轴、Idle/Walk/Run 状态机自动切换 | **骨骼动画播放器，拖拽即验** |
| 协作交付 | 点击 SAVE .vreen → 发给程序/美术/策划 | **一份文件 = 模型+相机+材质+灯光+ECS 状态** |

---

### [0:20-0:30] 硬核底子（一笔带过建立信任）
> **画面快闪**：
> - `@vreen/engine` npm 包
> - ECS World 面板
> - Profiler 120 帧环形缓冲
> - Electron 打包单 exe
> **字幕**：自研引擎 · ECS · 物理 · 性能分析 · 桌面便携版  
> **旁白**：想深入，全都有；不想深，开网页就用。

---

### [0:30-0:40] 社区与免费
> **画面**：GitHub Stars/Contributors/Forks 实时数字滚动  
> **字幕**：MIT 开源 · 社区驱动 · 欢迎 PR

---

### [0:40-0:45] CTA
> **画面**：二维码/链接 + 赛博朋克扫描线  
> **字幕**：
> ```
> 现在打开 github.com/toujianjian/vreen
> npm run dev → 30 秒上手
> ```

---

## 版本 C：极简 15 秒短视频（适合 Reels / Shorts / TikTok / 微信视频号）
**节奏**：每镜头 1 秒，配节奏感电子乐，无旁白全靠字幕

| 秒数 | 画面 | 字幕（大号、居中、赛博朋克字体） |
|------|------|----------------------------------|
| 0-1 | 黑屏→终端 `npm run dev` | **下一代 3D 检视平台** |
| 1-2 | 拖入模型 → 瞬间渲染 | **浏览器打开，拖拽即用** |
| 2-3 | 9 相机按钮极速切 | **9 视角 · 全可调** |
| 3-4 | 材质实验室拖动参数 | **PBR 实时调** |
| 4-5 | HDRI 环境切换 | **IBL 一键换** |
| 5-6 | 后处理开关堆栈 | **后处理全开** |
| 6-7 | WASD 控制角色跑跳 | **自带角色控制器** |
| 7-8 | 动画状态机切换 | **GPU 骨骼 + 状态机** |
| 8-9 | 物理调试器三通道 | **自研物理可视化** |
| 9-10 | ECS World + Entity Graph | **ECS 原生架构** |
| 10-11 | Profiler 火焰图 | **性能分析器就位** |
| 11-12 | Electron exe 双击启动 | **桌面便携版** |
| 12-13 | 5 个 SDK Logo 飞入 | **TS/Java/C#/C++/Kotlin** |
| 13-14 | GitHub 页面 Star 数字滚动 | **MIT 开源 · Star 支持** |
| 14-15 | Logo 定格 + 链接 | **github.com/toujianjian/vreen** |

---

## 通用制作提示

### 视觉统一规范
- **配色**：霓虹青 `#00ffff` / 品红 `#ff00ff` / 深灰 `#0d0d0d` / 纯黑 `#000000`
- **字体**：Orbitron (标题) + JetBrains Mono (代码/终端) + Noto Sans SC (中文正文)
- **HUD 元素**：扫描线、六角形边框、角标括号 `【 】`、数据标签风
- **转场**：故障风、RGB 分离、快速切换、帧冻结

### 音频建议
| 版本 | BGM 风格 | 音效层 |
|------|----------|--------|
| A | Dark Synth / Cyberpunk Industrial | 机械键盘敲击、终端哔声、UI 确认音 |
| B | Chill Synthwave / Lo-fi Cyberpunk | 环境风、页面翻动、拖拽呼啸 |
| C | 高 BPM (140-160) Glitch / Neurofunk | 每切镜头一击 kick、UI 尖锐 blip |

### 素材准备清单（建议提前录制）
- [ ] 主页拖拽上传全过程（含加载动画）
- [ ] Viewer 九宫格相机切换演示
- [ ] 材质实验室各参数拖动
- [ ] HDRI 环境切换 4-5 个预设
- [ ] 后处理开关前后对比
- [ ] 截图按钮 → 下载栏出现
- [ ] ECS World 面板展开/折叠、Entity 点击展开组件
- [ ] Entity Graph 搜索/高亮/缩放
- [ ] Profiler HUD 实时波动
- [ ] WASD 角色移动、跳跃、奔跑
- [ ] Animation State Machine 状态切换
- [ ] 物理调试器三通道开关
- [ ] Electron exe 双击启动桌面版
- [ ] `npm run dev` 终端输出、Vite 热更新
- [ ] GitHub 仓库页面滚动

---

## 发布渠道与配套文案

| 渠道 | 视频版本 | 配文要点 |
|------|----------|----------|
| GitHub README | A (嵌入 GIF/视频) | 顶部展示核心能力，链接完整视频 |
| B 站 / YouTube | A 完整版 | 简介放时间轴、项目地址、章节跳转 |
| Twitter/X | C (竖屏裁剪) | #gamedev #webgl #opensource #indiedev |
| 小红书 / 抖音 / 视频号 | B/C | 标题：独立游戏开发必备的免费 3D 检视工具 |
| itch.io / IndieDB | B | 配合项目页面截图 |
| Discord / 社区 | 任意 | 发布时 @相关技术社区 |

---

## 一句话 Slogan 备选（用于缩略图/封面/海报）
1. **VREEN — 自研内核，浏览器即开的 3D 检视站**
2. **拖拽即检，ECS 原生，自带物理与角色的 WebGL2 平台**
3. **从模型到游戏原型，只差一个 VREEN**
4. **MIT 开源 · 赛博朋克美学 · 五语言 SDK 生态**
5. **不想开 Unity/Blender 只为看模型？VREEN 秒开。**

---

> 文案已就绪，建议先用版本 C 做 15 秒短视频测试流量，再投入制作版本 A 完整版。