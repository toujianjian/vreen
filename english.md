<h1 align="center">⚡ VREEN ⚡</h1>

<p align="center">
  🌐 <a href="./README.md">中文</a> · <b>English</b>
</p>


> A holographic-grade 3D model inspector and showcase platform built for indie game developers and 3D artists.
> Inspect · Tune · Screenshot — zero install, runs entirely in the browser.

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-r169-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
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
| 🌅 **HDRI environments** | Studio / Sunset / Warehouse / Night / City — exposure + background mode |
| ✨ **Post-processing** | Bloom · Chromatic Aberration · Vignette · SMAA — all individually toggleable |
| 📊 **Real-time scene stats** | FPS, triangles, meshes, materials, POV, FOV, animation time |
| 🖼️ **One-click screenshot** | Saves current frame as PNG (via `preserveDrawingBuffer`) |
| 📁 **Drag-and-drop upload** | Click-to-pick also supported — inspected instantly, never uploaded to a server |
| ⚡ **Zero backend** | 100% static — deploys to GitHub Pages, Vercel, Netlify, anywhere |

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

# 4. Production build
npm run build
# → outputs to dist/
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
│   │   ├── viewer/        # 3D inspector (Stage, SceneContents, Outliner, Inspector, Toolbar, StatusBar)
│   │   ├── three/         # Mini-canvas helpers (BackgroundScene, PresetPreview)
│   │   └── hud/           # Reusable HUD components (HudPanel, TopBar)
│   ├── pages/             # Routed pages (HomePage, ViewerPage)
│   ├── stores/            # Zustand stores (viewer, inspector, ui)
│   ├── three/             # 3D core: camera rig, loaders, generators, normalization
│   ├── lib/               # Utilities (cn, format, presets, screenshot, uploadBridge)
│   ├── types/             # Shared TypeScript types
│   ├── styles/            # Tailwind entry + custom CSS (HUD, scanlines, fonts)
│   ├── App.tsx            # Router shell
│   └── main.tsx           # React root
├── .trae/documents/       # PRD and technical-architecture docs
├── public/                # Static assets
├── index.html             # Vite entry
├── tailwind.config.js     # Custom neon theme
├── tsconfig.*.json        # TypeScript project references
└── vite.config.ts         # Vite + manual chunks (three / r3f / post)
```

---

## 🎮 Usage Guide

### 1. Homepage
- Drop a `.glb` / `.gltf` / `.obj` / `.fbx` / `.stl` / `.ply` file into the **Uploader zone**
- Or pick a procedural preset (Robot, Mecha, Vehicle, Architecture, Scene, Crystal) from the **Preset Gallery**
- Or click any thumbnail in the **Asset Gallery** to jump straight into the inspector

### 2. Inspector
Once an asset is loaded, the inspector shows three columns:

```
┌──────────┬───────────────────────────┬──────────┐
│ Outliner │      3D Stage (Canvas)    │ Inspector│
│  Search  │   • Orbit / POV control  │ Material │
│          │   • Live HUD overlay     │ Camera   │
│          │   • Stats + animation    │ Env / FX │
│          │   • Screenshot button    │ Display  │
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

#### Screenshot
Click the **CAPTURE** button at the top right to download the current frame as a PNG. The filename is auto-generated from the asset name + timestamp.

---

## 🧱 Tech Stack

- **React 18 + TypeScript 5** — strict typing end-to-end
- **Vite 5** — sub-second HMR with manual chunking
- **Three.js r169** + **@react-three/fiber** + **@react-three/drei** — declarative 3D
- **@react-three/postprocessing** — modern post-processing pipeline
- **Zustand** — minimal, ergonomic state (no Redux boilerplate)
- **Tailwind CSS 3** — utility-first with a custom HUD theme
- **React Router 6** — hash routing for static-friendly deploys
- **Lucide React** — clean SVG icon set
- **Framer Motion** — tasteful UI micro-animations

---

## ⚙️ Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | TypeScript build + Vite production bundle |
| `npm run preview` | Locally preview the built `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` strict type-check |

---

## 🗺️ Roadmap

- [x] Multi-format loader (GLB / GLTF / OBJ / FBX / STL / PLY)
- [x] 9-mode tunable camera system
- [x] Live material lab
- [x] Post-processing pipeline (Bloom, Chromatic, Vignette, SMAA)
- [x] Procedural preset gallery
- [x] One-click PNG screenshot
- [x] Cyberpunk HUD theme
- [ ] Skeletal animation playback (with timeline scrubbing)
- [ ] Mesh picking (click a part to focus the outliner)
- [ ] Real scene tree (built from `THREE.Object3D` — currently illustrative)
- [ ] HDRI upload + custom environment maps
- [ ] GLTF Draco / Meshopt compression
- [ ] VR / WebXR mode
- [ ] Multi-asset comparison view
- [ ] Project export (`.vreen` package = model + camera + materials + lighting preset)

---

## 🐛 Known Limitations
- The **Outliner** is currently an illustrative tree, not a live `THREE` scene graph. A real tree is on the roadmap.
- **FBX** material conversion depends on the source FBX — some complex PBR textures may not transfer perfectly.
- On Windows + project paths containing non-ASCII characters, the `lucide-react` `replace-all` icon may be lost during install — if you see `Could not read from file ... replace-all.js`, see the one-liner shim in [setup-git.ps1](./setup-git.ps1).

---

## 📦 Deployment

VREEN is a 100% static SPA. Drop `dist/` onto any static host:

```bash
npm run build
# Upload the contents of dist/ to:
#   - GitHub Pages
#   - Vercel
#   - Netlify
#   - Cloudflare Pages
#   - Any nginx / Apache / S3
```

> If deploying to GitHub Pages, set `base: '/vreen/'` in `vite.config.ts`.

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
- Lucide Icons — ISC
- @react-three ecosystem — MIT
- Inspired by Sketchfab, three.js editor, and the Blender viewport

> "VREEN" — **V**ector **R**ender **E**ngine **EN**vironment. Built with care by [toujianjian](https://github.com/toujianjian).
