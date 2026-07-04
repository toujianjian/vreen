# VREEN

> A holographic-grade 3D model inspector & showcase for indie game developers and 3D artists.
> Inspect · Adjust · Capture — directly in the browser, no installs.

![VREEN banner](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cyberpunk%20HUD%20style%203D%20model%20viewer%20interface%20with%20neon%20cyan%20and%20magenta%20accents%2C%20dark%20space%20background%2C%20holographic%20display%2C%20futuristic%20inspector%20UI&image_size=landscape_16_9)

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-r169-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ Features

| | |
|---|---|
| 🎨 **Cyberpunk HUD** | Neon-cyan/magenta scanline aesthetic, full keyboard-friendly inspector |
| 🧊 **Multi-format loader** | `GLB` · `GLTF` · `OBJ` · `FBX` · `STL` · `PLY` — all parsed client-side |
| 📷 **9-camera POV system** | Free · Iso · Front · Back · Side · Top · First-person · Third-person · Cinematic |
| 🎛️ **Tunable camera lens** | FOV (15–90°), distance multiplier, target height, damping, orbit speed |
| 🧪 **Material Lab** | Edit base color / metalness / roughness / emissive / opacity / wireframe live |
| 🌅 **HDRI environment** | Studio · Sunset · Warehouse · Night · City — with exposure + background mode |
| ✨ **Post-FX** | Bloom · Chromatic Aberration · Vignette · SMAA — all toggleable |
| 📊 **Live scene stats** | FPS, triangles, meshes, materials, POV, FOV, animation time |
| 🖼️ **One-click capture** | Save the current frame as PNG (uses `preserveDrawingBuffer`) |
| 📁 **Drag & drop upload** | Or click to pick — instant model inspection, no upload to server |
| ⚡ **No backend** | 100% static — host on GitHub Pages, Vercel, Netlify, anywhere |

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/toujianjian/vreen.git
cd vreen

# 2. Install dependencies (npm / pnpm / yarn all work)
npm install

# 3. Run dev server
npm run dev
# → open http://localhost:5173

# 4. Production build
npm run build
# → outputs to dist/
```

### Requirements
- **Node.js** ≥ 18.18
- A modern browser with **WebGL 2** support (Chrome/Edge/Firefox/Safari latest)

---

## 🗂️ Project Structure

```
vreen/
├── src/
│   ├── components/
│   │   ├── home/          # Landing page (Hero, Gallery, Uploader, TerminalLog, Footer)
│   │   ├── viewer/        # 3D inspector (Stage, SceneContents, Outliner, Inspector, Toolbar, StatusBar)
│   │   ├── three/         # Mini Canvas helpers (BackgroundScene, PresetPreview)
│   │   └── hud/           # Reusable HUD primitives (HudPanel, TopBar)
│   ├── pages/             # Route-level pages (HomePage, ViewerPage)
│   ├── stores/            # Zustand stores (viewer, inspector, ui)
│   ├── three/             # 3D core: camera rigs, loaders, generators, normalize
│   ├── lib/               # Cross-cutting helpers (cn, format, presets, screenshot, uploadBridge)
│   ├── types/             # Shared TypeScript types
│   ├── styles/            # Tailwind entry + custom CSS (HUD, scanlines, fonts)
│   ├── App.tsx            # Router shell
│   └── main.tsx           # React root
├── .trae/documents/       # PRD & Technical Architecture
├── public/                # Static assets
├── index.html             # Vite entry
├── tailwind.config.js     # Custom neon theme tokens
├── tsconfig.*.json        # TypeScript project references
└── vite.config.ts         # Vite + manual chunks (three / r3f / post)
```

---

## 🎮 Usage

### 1. Home page
- Drag a `.glb` / `.gltf` / `.obj` / `.fbx` / `.stl` / `.ply` file into the **Uploader** drop zone
- Or pick from the **procedural preset gallery** (Robot, Mech, Vehicle, Structure, Diorama, Crystal)
- Or click any tile in the **Asset Gallery** to instantly inspect

### 2. Viewer
Once an asset is loaded, the viewer opens with three columns:

```
┌──────────┬───────────────────────────┬──────────┐
│ OUTLINER │      3D STAGE (Canvas)    │ INSPECTOR│
│  Tree    │   • Orbit / POV controls  │ Material │
│  Search  │   • Live HUD overlay      │ Camera   │
│          │   • Stats + Animation     │ Env / FX │
│          │   • Capture button (top)  │ Display  │
└──────────┴───────────────────────────┴──────────┘
```

#### Camera POV (top toolbar)
| Button | Mode | Description |
|---|---|---|
| **FREE** | Free orbit | User-controlled, no constraints |
| **ISO** | Isometric | 45° angle — great default for inspection |
| **FRONT / BACK / SIDE** | Axis | Locked to a plane for technical review |
| **TOP** | Plan | Top-down with polar limit |
| **1ST** | First-person | Eye-level POV looking at the model |
| **3RD** | Third-person | Behind & above, slight FOV boost |
| **CINE** | Cinematic | Auto-orbits, no user input (driven by `cinematicSpeed`) |

#### Keyboard / mouse
- **Left-drag** — orbit
- **Right-drag** — pan
- **Wheel** — dolly in/out
- **Shift + Wheel** — adjust FOV (in some presets)

#### Capture
Click **CAPTURE** in the top-right to download a PNG of the current frame. Filename is auto-generated from the asset name + timestamp.

---

## 🧱 Tech Stack

- **React 18 + TypeScript 5** — strict typing end-to-end
- **Vite 5** — sub-second HMR, manual chunk splitting
- **Three.js r169** + **@react-three/fiber** + **@react-three/drei** — declarative 3D
- **@react-three/postprocessing** — modern post-FX pipeline
- **Zustand** — minimal, ergonomic state management (no Redux boilerplate)
- **Tailwind CSS 3** — utility-first + custom HUD theme tokens
- **React Router 6** — hash routing for static deployment
- **Lucide React** — crisp SVG icon set
- **Framer Motion** — subtle UI micro-animations

---

## ⚙️ Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | TypeScript build + Vite production bundle |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run typecheck` | `tsc -b --noEmit` strict check |

---

## 🗺️ Roadmap

- [x] Multi-format loader (GLB / GLTF / OBJ / FBX / STL / PLY)
- [x] 9-camera POV system with full tunables
- [x] Material Lab with live updates
- [x] Post-FX pipeline (Bloom, Chromatic, Vignette, SMAA)
- [x] Procedural preset gallery
- [x] One-click PNG capture
- [x] Cyberpunk HUD theme
- [ ] Skeletal animation playback (with timeline scrubber)
- [ ] Mesh selection (click to focus a part in Outliner)
- [ ] Real scene-tree from `THREE.Object3D` (Outliner currently uses a representative tree)
- [ ] HDRI upload + custom environment map
- [ ] GLTF Draco / Meshopt compression
- [ ] VR / WebXR mode
- [ ] Multi-asset comparison view
- [ ] Project export (`.vreen` package = model + camera + materials + lighting preset)

---

## 🐛 Known limitations
- **Outliner** displays a representative tree, not the live `THREE` scene graph. Adding a real tree pass is on the roadmap.
- **FBX** texture/material conversion depends on the source FBX; some complex PBR maps may not round-trip perfectly.
- On Windows with non-ASCII project paths, the lucide-react `replace-all` icon can be lost during install — see [setup-git.ps1](./setup-git.ps1) for the one-line shim if you hit `Could not read from file ... replace-all.js`.

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
#   - Any nginx / Apache / S3 setup
```

> If deploying to GitHub Pages, set `base: '/vreen/'` in `vite.config.ts`.

---

## 🤝 Contributing

Issues and PRs are welcome. For larger changes, please open an issue first to discuss.

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
- Inspired by tools like Sketchfab, three.js editor, and Blender's viewport

> "VREEN" — short for "Vector Render Engine ENvironment". Built with care by [toujianjian](https://github.com/toujianjian).
