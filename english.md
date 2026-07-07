<h1 align="center">⚡ VREEN ⚡</h1>

<p align="center">
  🌐 <a href="./README.md">中文</a> · <b>English</b>
</p>

> A next-generation inspection platform for indie game development and 3D content production.
> Custom WebGL2 engine core · ECS-driven · Character / animation / asset pipeline in one place · Browser + desktop dual deployment.

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-r169-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![Electron](https://img.shields.io/badge/Electron-Portable_Exe-47848f?logo=electron&logoColor=white)](https://www.electronjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ Features

| | |
|---|---|
| 🎨 **Cyberpunk HUD** | Neon cyan / magenta scanline aesthetic with a fully keyboard-friendly inspector |
| 🧊 **Multi-format loader** | `GLB` · `GLTF` · `OBJ` · `FBX` · `STL` · `PLY` — all parsed client-side |
| 📷 **9 point-of-view modes** | Free / Iso / Front / Back / Side / Top / First-Person / Third-Person / Cinematic |
| 🎛️ **Tunable camera lens** | FOV (15–90°), distance multiplier, target height, damping, orbit speed |
| 🧪 **Material lab** | Live edit base color / metalness / roughness / emissive / opacity / wireframe |
| 🌅 **HDRI environments** | Studio / Sunset / Warehouse / Night / City — exposure + background mode, plus custom HDR upload |
| ✨ **Post-processing** | Bloom · Chromatic Aberration · Vignette · SMAA — all individually toggleable |
| 📊 **Real-time scene stats** | FPS, triangles, meshes, materials, POV, FOV, animation time |
| 🖼️ **One-click screenshot** | Saves current frame as PNG (via `preserveDrawingBuffer`) |
| 📁 **Drag-and-drop upload** | Click-to-pick also supported — inspected instantly, never uploaded to a server |
| 🧩 **Custom WebGL2 engine core** | Three.js-style API with independent scene graph / math library / PBR materials / GPU skinning, gradually replacing external dependencies |
| 🧩 **ECS architecture** | Entity-Component-System: Transform / Velocity / PlayerInput / AnimState / MeshRef / SkinnedMeshRef and more |
| 🎮 **Character control** | `WASD` movement, `Shift` run, `Space` jump — input rotated by current camera heading |
| 🎞️ **Animation state machine** | Idle / Walk / Run automatic switching with transition timing; drives ECS and custom AnimationMixer |
| 🧬 **Scene graph ↔ ECS sync** | Auto-generates ECS entities on model load; ECS changes sync back to three.js rendering in real time |
| 📦 **.vreen package format** | Self-contained zip: model + scene (camera / materials / env / postFX) + ECS World JSON, Java-friendly POJO serialization |
| 🔧 **Asset pipeline** | Loader abstraction + AssetManager, GLBLoader, TextureLoader, HDRLoader — extensible |
| 🖥️ **Desktop portable build** | Electron single-file `.exe`, no install required |

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/toujianjian/vreen.git
cd vreen

# 2. Install (npm / pnpm / yarn all work)
npm install

# 3. Start dev server
npm run dev
# → open http://localhost:5173

# 4. Production build (static SPA)
npm run build
# → outputs to dist/

# 5. Build Windows portable executable
npm run electron:build
# → outputs release/VREEN-Portable-0.1.0.exe
```

### Requirements
- **Node.js** ≥ 18.18
- A modern browser with **WebGL 2** support (latest Chrome / Edge / Firefox / Safari)

---

## 🗂️ Project Structure

```
vreen/
├── src/
│   ├── components/
│   │   ├── home/          # Homepage (Hero, Gallery, Uploader, TerminalLog, Footer)
│   │   ├── viewer/        # 3D inspector (Stage, SceneContents, Outliner, Inspector, Toolbar, StatusBar, ECSPanel)
│   │   ├── three/         # Mini-canvas helpers (BackgroundScene, PresetPreview)
│   │   └── hud/           # Reusable HUD components (HudPanel, TopBar)
│   ├── engine/            # Custom WebGL2 engine core (Core / Math / Animation / ECS / Loaders / Renderer / Controls / Lights / Cameras / Materials)
│   ├── pages/             # Routed pages (HomePage, ViewerPage, EngineDemoPage)
│   ├── stores/            # Zustand stores (viewer, inspector, ui, world)
│   ├── three/             # three.js bridge: camera rig, loaders, generators, normalization, threeToCustomAnim
│   ├── lib/               # Utilities and formats (cn, format, presets, screenshot, uploadBridge, vreenPack, vreenManifest, roundtripDemo)
│   ├── types/             # Shared TypeScript types
│   ├── styles/            # Tailwind entry + custom CSS (HUD, scanlines, local fonts)
│   ├── App.tsx            # Router shell
│   └── main.tsx           # React root
├── electron/              # Electron main process / preload / splash
├── public/                # Static assets
├── index.html             # Vite entry
├── tailwind.config.js     # Custom neon theme
├── postcss.config.js      # PostCSS config
├── tsconfig.*.json        # TypeScript project references
└── vite.config.ts         # Vite + manual chunks + woff-drop plugin
```

---

## 🎮 Usage Guide

### 1. Homepage
- Drop a `.glb` / `.gltf` / `.obj` / `.fbx` / `.stl` / `.ply` file into the **Uploader zone**
- Or pick a procedural preset (Mech, Crystal, Tree, Ship, Creature, Relic) from the **Preset Gallery**
- Or click any thumbnail in the **Asset Gallery** to jump straight into the inspector

### 2. Inspector
Once an asset is loaded, the inspector shows three columns:

```
┌──────────┬───────────────────────────┬──────────┐
│ Outliner │      3D Stage (Canvas)    │ Inspector│
│  Search  │   • Orbit / POV control   │ Material │
│          │   • Live HUD overlay      │ Camera   │
│          │   • Stats + animation     │ Env / FX │
│          │   • Screenshot button     │ Display  │
│          │                           │ ECS WORLD│
└──────────┴───────────────────────────┴──────────┘
```

#### POV Modes (top toolbar)
| Button | Mode | Description |
|---|---|---|
| **FREE** | Free orbit | User-driven, no constraints |
| **ISO** | Isometric | 45° angle — go-to for inspection |
| **FRONT / BACK / SIDE** | Axis | Locked to a plane for technical review |
| **TOP** | Top-down | Looking straight down, polar limited |
| **1ST** | First-person | Eye-height POV looking at the model |
| **3RD** | Third-person | Behind-and-above, wider FOV |
| **CINE** | Cinematic | Auto-orbit, no input (driven by `cinematicSpeed`) |

#### Mouse / Keyboard
- **Left drag** — rotate
- **Right drag** — pan
- **Wheel** — dolly
- **Shift + Wheel** — adjust FOV (when supported by the current preset)
- **W / A / S / D** — move character forward / left / back / right (relative to current camera heading)
- **Shift** — run
- **Space** — jump

#### Screenshot
Click the **CAPTURE** button at the top right to download the current frame as a PNG. The filename is auto-generated from the asset name + timestamp.

#### Project Save / Load
Click **PROJECT → SAVE .VREEN** to export the full state (model + scene + ECS World).
Click **LOAD .VREEN** to restore a saved state or import a package shared by someone else.

#### ECS WORLD Panel
- Shows current World entity count, System list, and Frame counter
- Lists all Entities; click one to inspect Transform / Velocity / PlayerInput / AnimState components
- Displays animation state machine current state, transition countdown, and clip time
- **ECS → RENDER BRIDGE** toggle: when ON, ECS MovementSystem directly drives the three.js root transform

### 3. Custom Engine Demo
Visit the `/engine-demo` route to preview the pure custom WebGL2 rendering pipeline:
- No three.js dependency
- Demonstrates PBR materials, directional / ambient light, planar shadow, custom OrbitControls
- Will gradually become the main viewer rendering path

---

## 🧱 Tech Stack

- **React 18 + TypeScript 5** — strict typing end-to-end
- **Vite 5** — sub-second HMR with manual chunking
- **Three.js r169** + **@react-three/fiber** + **@react-three/drei** — current viewer rendering backend (gradually replaced by the custom engine)
- **Custom WebGL2 Engine** — scene graph, math library, PBR materials, GPU skinning, GLB/Texture/HDRI loaders
- **@react-three/postprocessing** — modern post-processing pipeline
- **Zustand** — minimal, ergonomic state (no Redux boilerplate)
- **Tailwind CSS 3** — utility-first with a custom HUD theme
- **React Router 6** — hash routing for static-friendly deploys
- **Lucide React** — clean SVG icon set
- **Framer Motion** — tasteful UI micro-animations
- **Electron + electron-builder** — Windows portable desktop build
- **fflate** — browser-side zip pack/unpack (`.vreen` container)

---

## ⚙️ Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | TypeScript build + Vite production bundle |
| `npm run preview` | Locally preview the built `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` strict type-check |
| `npm run electron:dev` | Run Vite + Electron side-by-side for debugging |
| `npm run electron:build` | Build production bundle + package Windows portable exe |
| `npm run electron:build:dir` | Generate unpacked `win-unpacked/` only |

---

## 🗺️ Roadmap

- [x] Multi-format loader (GLB / GLTF / OBJ / FBX / STL / PLY)
- [x] 9-mode tunable camera system
- [x] Live material lab
- [x] Post-processing pipeline (Bloom, Chromatic, Vignette, SMAA)
- [x] Procedural preset gallery
- [x] One-click PNG screenshot
- [x] Cyberpunk HUD theme
- [x] Skeletal animation playback (with timeline scrubbing)
- [x] Mesh picking (click a part to focus the outliner)
- [x] Real scene tree (built from `THREE.Object3D`)
- [x] HDRI upload + custom environment maps
- [x] Project export (`.vreen` package = model + camera + materials + lighting preset + ECS World)
- [x] Custom WebGL2 engine core (SceneGraph / Math / PBR / Skinning / Animation)
- [x] ECS architecture with common components / systems
- [x] Character animation state machine (Idle / Walk / Run)
- [x] WASD + Shift + Space character control
- [x] Scene graph ↔ ECS two-way sync
- [x] Windows portable desktop build
- [ ] Switch viewer main rendering to custom WebGL2 pipeline
- [ ] GLTF Draco / Meshopt compression
- [ ] VR / WebXR mode
- [ ] Multi-asset comparison view
- [ ] Java build-time tool (generate `.vreen` packages)

---

## 🐛 Known Limitations
- **FBX** material conversion depends on the source FBX — some complex PBR textures may not transfer perfectly.
- On Windows + project paths containing non-ASCII characters, the `lucide-react` `replace-all` icon may be lost during install — if you see `Could not read from file ... replace-all.js`, see the one-liner shim in [setup-git.ps1](./setup-git.ps1).
- Current `/viewer` still uses three.js as the rendering backend; `/engine-demo` shows the pure custom pipeline, migration in progress.

---

## 📦 Deployment

The main VREEN app is a 100% static SPA. Drop `dist/` onto any static host:

```bash
npm run build
# Upload the contents of dist/ to:
#   - GitHub Pages
#   - Vercel
#   - Netlify
#   - Cloudflare Pages
#   - Any nginx / Apache / S3
```

> `vite.config.ts` already sets `base: './'`, so the build works under both HTTP static hosting and local `file://` (Electron).

Desktop builds are produced by `electron-builder` into `release/`:

```bash
npm run electron:build
```

---

## 🤝 Contributing

Issues and PRs are welcome. For larger changes please open an Issue first to discuss.

```bash
git checkout -b feat/your-feature
git commit -m "feat: ..."
git push origin feat/your-feature
# Open a Pull Request on GitHub
```

---

## 📄 License

[MIT](./LICENSE) © 2026 toujianjian

---

## 💌 Credits

- Three.js example loaders (GLTF / OBJ / FBX / STL / PLY) — MIT
- @react-three ecosystem — MIT
- Lucide Icons — ISC
- Local fonts: Orbitron, JetBrains Mono, Noto Sans SC (via fontsource)
- Inspired by Sketchfab, three.js editor, Blender viewport, Unity Editor

> **VREEN** — **V**ector **R**ender **E**ngine **EN**vironment. Built with care by [toujianjian](https://github.com/toujianjian).

---

### 🌐 Repository Links

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-toujianjian%2Fvreen-181717?logo=github)](https://github.com/toujianjian/vreen)
[![Gitee](https://img.shields.io/badge/Gitee-toujianjian%2Fvreen-c71d23?logo=gitee)](https://gitee.com/toujianjian/vreen)

**GitHub**: https://github.com/toujianjian/vreen
**Gitee**: https://gitee.com/toujianjian/vreen

</div>
