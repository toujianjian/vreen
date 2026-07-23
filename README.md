# VREEN

**VREEN** (Vector Render Engine ENvironment) is an open-source, browser-first 3D engine and asset inspection platform built around a self-developed WebGL2 rendering kernel. It combines a from-scratch scene graph, math library, PBR/IBL pipeline, GPU skinning, an Entity-Component-System (ECS), a fixed-step physics simulator, a visual scripting layer, and a portable `.vreen` package format with multi-language SDKs — targeting indie game developers and 3D artists who need a holographic-grade inspector and a lightweight Web game engine in one toolchain.

VREEN runs both in the browser (as a static SPA) and on the desktop (as a portable single-file Electron build), with no commercial obligations under the MIT license.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Three.js](https://img.shields.io/badge/Three.js-r169-black?logo=three.js&logoColor=white)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![Electron](https://img.shields.io/badge/Electron-43-47848f?logo=electron&logoColor=white)](https://www.electronjs.org)
[![Blockly](https://img.shields.io/badge/Blockly-13-yellow)](https://developers.google.com/blockly)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](./.github/workflows/ci.yml)

---

## Table of Contents

1. [Overview](#overview)
2. [Feature Overview](#feature-overview)
3. [Technology Stack](#technology-stack)
4. [Quick Start](#quick-start)
5. [Project Architecture](#project-architecture)
6. [Engine Module Reference](#engine-module-reference)
7. [The `.vreen` Package Format](#the-vreen-package-format)
8. [Blockly Visual Scripting](#blockly-visual-scripting)
9. [Desktop Builds (Electron)](#desktop-builds-electron)
10. [Development Guide](#development-guide)
11. [Testing](#testing)
12. [CI/CD](#cicd)
13. [Roadmap](#roadmap)
14. [Known Issues](#known-issues)
15. [Deployment](#deployment)
16. [Contributing](#contributing)
17. [License](#license)
18. [Related Projects and Acknowledgements](#related-projects-and-acknowledgements)

---

## Overview

VREEN is **not** "yet another 3D viewer." The inspector is the presentation layer; the core deliverable is a complete, self-hosted WebGL2 game-engine foundation — scene graph, math, PBR/IBL, GPU skinning, ECS, physics, animation state machine, and a visual scripting surface — that can be reused independently as the npm package [`@vreen/engine`](./packages/engine).

### Design Goals

| Goal | Description |
|------|-------------|
| **Self-developed engine kernel** | A from-scratch WebGL2 renderer, scene graph, math library, and material system — no black-box dependency on Three.js for the engine path. |
| **ECS-driven architecture** | World / ComponentType / System model with Transform, Velocity, PlayerInput, AnimState, MeshRef, Rigidbody, Collider, Particle, and more. |
| **Dual rendering backends** | A mature Three.js + React Three Fiber path (`Stage.tsx`) and an in-house WebGL2 path (`CustomStage.tsx`), switchable at runtime via `viewerStore.engineMode`. |
| **Round-trippable asset pipeline** | The `.vreen` ZIP container captures model + scene + ECS world state, with a `.vreen-delta` incremental format and SDKs in TypeScript, Java, Kotlin, C#, and C++. |
| **Visual scripting** | Blockly-based block editor bound to the ECS World and renderer, lowering the barrier for non-programmers. |
| **Browser + desktop parity** | 100% static SPA for web hosting; identical UI shipped as a portable Windows `.exe` via Electron. |

### Positioning

VREEN is positioned as a **lightweight Web game engine** — comparable in scope to an early Unity-on-Web or a Godot Web export — rather than a full AAA runtime. It is engineered for solo and small-team development with an irregular release cadence, prioritizing a quality foundation (tests, CI, type safety) over feature breadth.

---

## Feature Overview

| Category | Capability |
|----------|-----------|
| **Engine kernel** | Self-developed WebGL2 renderer with PBR, IBL, real-time shadows, post-processing (Bloom, chromatic aberration, vignette, SMAA, SSAO), GPU skinning, and a `Renderer` interface for backend pluggability. |
| **Scene graph** | `Object3D` / `Scene` / `Mesh` / `Group` / `Bone` / `Skeleton` / `SkinnedMesh` / `BufferGeometry` / `BufferAttribute` / `Texture` / `InstancedMesh` / `LOD`. |
| **Math library** | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Box3`, `Sphere`, `Plane`, `Ray`, `Line3`, `Triangle`, `Frustum`, `Color`, `MathUtils`. |
| **ECS** | `World`, `ComponentType` registry, `QueryBuilder` with caching, `Prefab` templates, `Broadphase` acceleration, and POJO components for serializability. |
| **Physics** | Fixed-step semi-implicit Euler integration, quaternion rotation integration, broadphase + narrowphase collision, impulse response with Baumgarte stabilization, AABB / Sphere / Capsule colliders, CPU particle system with emitters. |
| **Animation** | `AnimationClip`, `AnimationAction`, `AnimationMixer`, `AnimationStateMachine` (Idle / Walk / Run auto-transitions), `BlendSpace1D`, `Humanoid` rig, `KeyframeTrack`, animation event callbacks. |
| **Loaders** | `GLBLoader`, `OBJLoader`, `FBXLoader`, `HDRLoader` (per-channel RLE RGBE decode), `KTX2Loader`, `TextureLoader`, `DracoDecoder`, `AssetManager` with LRU cache, `OBJExporter`. |
| **Materials** | `StandardMaterial` (PBR: base color, metallic, roughness, emissive, opacity, wireframe), `ShaderMaterial` with GLSL injection, `ShaderChunks` shared GLSL blocks. |
| **Inspection UI** | 9 camera presets (Free / Iso / Front / Back / Side / Top / 1st-person / 3rd-person / Cinematic), real-time material lab, HDRI environments, post-FX toggles, PNG capture, drag-and-drop upload. |
| **Debug tooling** | Physics debug renderer (collider / contact / velocity channels), `EntityGraph` relationship visualizer, 120-frame ring-buffer profiler with CPU / GPU / System timing views and `FrameChart`. |
| **Visual scripting** | Blockly block editor with Camera / Animation / Scene / Renderer / Physics / Control categories, bound to the live ECS World via `EcsScriptAPI`, with Tick-callback registration. |
| **Package format** | `.vreen` ZIP container (manifest + scene + world + embedded assets), `.vreen-delta` incremental diffs, multi-language SDKs, `vreen` CLI for pack / unpack / validate / diff. |
| **Desktop** | Electron 43 + electron-builder producing a single-file portable Windows `.exe`. |
| **i18n** | First-class zh / en via i18next; all user-facing strings flow through translation keys. |

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5 (strict mode, `noUnusedLocals`, `noUnusedParameters`) |
| UI framework | React 18 + React Router 6 (HashRouter) |
| State management | Zustand 4 |
| 3D (legacy/viewer path) | Three.js r169 + @react-three/fiber + @react-three/drei + @react-three/postprocessing |
| 3D (engine path) | Self-developed WebGL2 engine `@vreen/engine` (zero runtime deps, esbuild-bundled ESM) |
| Visual scripting | Blockly 13 |
| Build tooling | Vite 5 + Tailwind CSS 3 + PostCSS |
| Desktop | Electron 43 + electron-builder 26 |
| Mesh compression | draco3d (browser-side Draco decoding) |
| ZIP container | fflate (in-browser pack / unpack for `.vreen`) |
| Animation / icons | Framer Motion, Lucide React |
| Testing | Vitest 4 + @vitest/coverage-v8 |
| CI / hooks | GitHub Actions, Husky 9, lint-staged 17 |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18.18 (Node 20 recommended, used in CI)
- A modern browser with **WebGL 2** support (latest Chrome / Edge / Firefox / Safari)

### Install and run

```bash
# 1. Clone the repository
git clone https://github.com/toujianjian/vreen.git
cd vreen

# 2. Install dependencies
npm install

# 3. Start the development server (HMR)
npm run dev
# → open http://localhost:5173
```

### Common commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server with HMR. |
| `npm run build` | `tsc -b && vite build` — type-check then produce a static SPA in `dist/`. |
| `npm run preview` | Locally preview the production build from `dist/`. |
| `npm run typecheck` | `tsc -b --noEmit` — strict type check (also runs in CI and Husky pre-commit). |
| `npm run test` | `vitest run` — run the unit test suite once. |
| `npm run test:watch` | `vitest` — watch-mode tests. |
| `npm run test:coverage` | `vitest run --coverage` — coverage report via v8. |
| `npm run engine:build` | Build the `@vreen/engine` standalone package (`packages/engine`). |
| `npm run engine:typecheck` | Type-check the engine package in isolation. |
| `npm run engine:sync` | Sync `src/engine/` into `packages/engine/src/` for publishing. |
| `npm run electron:dev` | Run Vite + Electron concurrently in dev mode. |
| `npm run electron:build` | Build the SPA and package a portable Windows `.exe` into `release/`. |
| `npm run electron:build:dir` | Produce an unpacked `win-unpacked/` directory (faster iteration). |
| `npm run vreen` | `.vreen` CLI — pack / unpack / validate / diff packages. |

---

## Project Architecture

```
vreen/
├── src/                        # Main Vite application
│   ├── components/
│   │   ├── home/               # Landing page (Hero / Uploader / Gallery / TerminalLog / Footer)
│   │   ├── viewer/             # 3D inspector core (see below)
│   │   ├── three/              # Mini-canvas helpers (BackgroundScene / PresetPreview / SafeEnvironment)
│   │   └── hud/                # Reusable HUD widgets (HudPanel / TopBar / LangSwitcher)
│   ├── engine/                 # Self-developed WebGL2 engine (mirrored to packages/engine/src)
│   │   ├── Core/               # Scene graph primitives
│   │   ├── Math/               # Vectors, matrices, quaternions, geometry primitives
│   │   ├── Cameras/            # Perspective / Orthographic cameras
│   │   ├── Controls/           # OrbitControls
│   │   ├── Lights/             # Light types
│   │   ├── Geometries/         # Procedural primitive geometry
│   │   ├── Materials/          # PBR / Shader materials and GLSL chunks
│   │   ├── Renderer/           # WebGL2Renderer, ShaderProgram, RenderPass, Renderer interface
│   │   ├── Loaders/            # GLB / OBJ / FBX / HDR / KTX2 / Draco / AssetManager
│   │   ├── Animation/          # Clips, Mixer, StateMachine, BlendSpace1D, Humanoid
│   │   ├── ECS/                # World, ComponentType, Systems, Physics, Prefab, QueryBuilder
│   │   ├── Physics/            # PhysicsDemo
│   │   ├── Helpers/            # GridHelper / LineHelper / PhysicsDebugRenderer
│   │   ├── Tools/              # Profiler
│   │   └── ecsDemo.ts          # ECS demo entry
│   ├── pages/                  # Route-level pages (HomePage / ViewerPage / EngineDemoPage)
│   ├── stores/                 # Zustand stores (viewer / ui / world / profiler / inspector)
│   ├── three/                  # Three.js bridges (loaders / generators / normalize / anim / texture)
│   ├── lib/                    # Utilities (logger / presets / screenshot / vreenPack / Blockly / ECS API)
│   ├── types/                  # Shared TypeScript types
│   ├── i18n/                   # i18next config + zh / en locales
│   ├── styles/                 # Tailwind entry + cyberpunk HUD theme CSS
│   ├── App.tsx                 # Route shell
│   └── main.tsx                # React root (fonts / i18n init / mount)
├── packages/                   # Multi-language SDK ecosystem
│   ├── engine/                 # @vreen/engine — standalone npm package (zero deps)
│   ├── registry/               # .vreen package registry schema + reference server
│   ├── unity-package/          # Unity editor plugin (C#)
│   ├── unreal-plugin/          # Unreal Engine plugin (C++)
│   └── vreen-core/             # Kotlin/Java build-time tools (Maven)
├── sdks/
│   └── java/                   # Java POJO SDK for .vreen (Gradle + Maven)
├── docs/
│   ├── format/                 # .vreen format specification (v0.2.1)
│   └── vreen-api-tutorial.md
├── scripts/                    # vreen-cli.mjs / sync-engine-package.mjs / rewrite-engine-imports.cjs / check-i18n-keys.cjs
├── electron/                   # Electron main process / preload / splash
├── public/                     # Static assets (HDRI / favicon)
├── .github/workflows/          # CI pipeline
├── .husky/                     # Git hooks (pre-commit)
├── index.html                  # Vite entry
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.*.json
└── package.json
```

### Inspector component responsibilities (`src/components/viewer/`)

| Component | Responsibility |
|-----------|---------------|
| `Stage.tsx` | Three.js / React Three Fiber render container (default backend). |
| `CustomStage.tsx` | Self-developed WebGL2 engine render container; supports THREE / CUSTOM switching. |
| `ViewerToolbar.tsx` | Top toolbar — engine switch, physics, debug, profiler, Blockly, material editor. |
| `ViewerStatusBar.tsx` | Bottom bar — FPS, triangle count, draw calls. |
| `BlocklyPanel.tsx` | Blockly workspace UI with Run / Stop / Save / Load. |
| `Inspector.tsx` | Property inspector (material / camera / environment / display / ECS). |
| `Outliner.tsx` | Scene outline tree built from `THREE.Object3D`. |
| `ParamEditor.tsx` | Material parameter editor. |
| `ECSPanel.tsx` | ECS debug panel — entity count, system list, frame counter, per-entity components. |
| `EntityGraph.tsx` | Entity-component relationship graph with search / filter / selection. |
| `TunerPanel.tsx` | Parameter tuning panel (M2). |
| `SceneContents.tsx` | Scene content browser. |
| `GeneratorMarketPanel.tsx` | Procedural generator marketplace panel. |
| `ProfilerHUD.tsx` / `FrameChart.tsx` / `SystemTimingChart.tsx` | Profiler visualization trio. |
| `Timeline.tsx` | Animation timeline with scrubbing. |
| `FreeCameraController.tsx` | Free-camera input handling. |
| `ColorField.tsx` | Color picker widget. |
| `VreenInspectorPanel.tsx` | `.vreen` package introspection panel. |

### State stores (`src/stores/`)

| Store | Domain |
|-------|--------|
| `viewerStore.ts` | Asset loading, camera, engine mode (`THREE` / `CUSTOM`), physics / debug / Blockly toggles. |
| `uiStore.ts` | UI state, logs, environment, post-processing, startup log. |
| `worldStore.ts` | ECS `World` reference shared with React. |
| `profilerStore.ts` | Profiler ring-buffer samples. |
| `inspectorStore.ts` | Inspector selection state. |

---

## Engine Module Reference

The engine lives under `src/engine/` (development source) and is mirrored to `packages/engine/src/` for standalone publishing as `@vreen/engine`. It is written in strict TypeScript, targets ES2020+, and ships with zero runtime dependencies (Draco decoding is an optional peer dependency).

### Core (`src/engine/Core/`)

The scene-graph foundation, modeled after Three.js' object model but implemented from scratch.

| Export | Purpose |
|--------|---------|
| `Object3D` | Base node — transform (position / rotation / scale), world matrix, `updateWorldMatrix`, `lookAt`, `traverse`, parent / children, `frustumCulled` flag. |
| `Scene` | Root container for renderable objects and lights. |
| `Group` | Non-renderable grouping node. |
| `Mesh` | Renderable leaf binding a `BufferGeometry` and a `Material`. |
| `SkinnedMesh` / `Bone` / `Skeleton` | GPU skinning — per-bone matrices uploaded as uniform arrays. |
| `BufferGeometry` / `BufferAttribute` | Vertex / index buffers with `dispose`, `setUsage`, `needsUpdate` for WebGL resource management. |
| `Material` | Abstract material interface. |
| `Texture` | GPU texture wrapper. |
| `InstancedMesh` | Per-instance matrix array rendered via `gl.drawElementsInstanced`. |
| `LOD` | Multi-level mesh switching based on camera distance. |

### Math (`src/engine/Math/`)

A complete math library with scratch-object reuse to minimize per-frame allocations.

| Export | Purpose |
|--------|---------|
| `Vector2` / `Vector3` / `Vector4` | Component vectors with add / sub / dot / cross / length / normalize / lerp / clamp. |
| `Matrix3` / `Matrix4` | Matrices with multiply / inverse / transpose / `makeLookAt` / `makePerspective` / `makeOrthographic`. |
| `Quaternion` | Unit quaternions with multiply / slerp / `rotateVector` / Euler conversion. |
| `Euler` | Euler-angle representation with order support. |
| `Box3` / `Sphere` / `Plane` / `Ray` / `Line3` / `Triangle` | Bounding and intersection primitives. |
| `Frustum` | View-projection frustum for culling tests. |
| `Color` | Linear / sRGB color with convert helpers. |
| `MathUtils` | Constants, `clamp`, `lerp`, `degToRad`, `randFloat`, etc. |

### Renderer (`src/engine/Renderer/`)

| Export | Purpose |
|--------|---------|
| `Renderer` | Abstract interface (`render(scene, camera)`, `resize(w, h)`, `canvas`) enabling backend pluggability (WebGPU future). |
| `WebGL2Renderer` | Concrete implementation — PBR / IBL / shadow mapping, post-processing pipeline, GLSL `#version 300 es` shaders. |
| `ShaderProgram` | Program cache, uniform type-safe setters (`setUniform1i` / `setUniformMatrix4fv` etc.), `computeHash` for variant caching. |
| `RenderPass` | Abstract pass (`apply(input, output)`) for composable post-processing — replaces the previously hard-coded 5-pass chain. |

### Materials (`src/engine/Materials/`)

| Export | Purpose |
|--------|---------|
| `StandardMaterial` | PBR material — base color, metallic, roughness, emissive, opacity, wireframe, procedural texture slots. |
| `ShaderMaterial` | Custom-shader material accepting GLSL strings and a uniform descriptor. |
| `ShaderChunks` | Shared vertex / fragment GLSL blocks injected into generated shaders. |
| `shaders.ts` | Built-in shader source. |

### Lights (`src/engine/Lights/`)

`Light` base class with `AmbientLight` and `DirectionalLight` (shadow-casting) implementations; the renderer collects lights per-scene with change detection.

### Cameras (`src/engine/Cameras/`)

`Camera` base, `PerspectiveCamera` (FOV / aspect / near / far), `OrthographicCamera`. Both produce view-projection matrices consumed by the renderer and the `Frustum` culler.

### Loaders (`src/engine/Loaders/`)

| Export | Purpose |
|--------|---------|
| `GLBLoader` | Binary glTF parsing with staged logging (load → read → `parseGLB` → `buildFromGltf`); Draco support via `DracoDecoder`. |
| `OBJLoader` / `OBJExporter` | Wavefront OBJ import and string export. |
| `FBXLoader` | FBX parsing (model + material + animation extraction). |
| `HDRLoader` | Radiance `.hdr` decoding with **per-channel RLE** RGBE → Float32 conversion; covers compressed, uncompressed, and mixed-encoding scanline variants. |
| `KTX2Loader` | KTX2 / Basis Universal texture decompression for bandwidth reduction. |
| `TextureLoader` | Image texture loading. |
| `DracoDecoder` | `draco3d` wrapper. |
| `AssetManager` | LRU cache with hit / miss / eviction logging and cache-key truncation. |

### Animation (`src/engine/Animation/`)

| Export | Purpose |
|--------|---------|
| `AnimationClip` / `KeyframeTrack` | Clip + track data model. |
| `AnimationAction` | Per-clip playback control (play / pause / seek / time-scale). |
| `AnimationMixer` | Drives GPU skinning matrices; supports blending. |
| `AnimationStateMachine` | Idle / Walk / Run automatic transitions driven by `Velocity` magnitude, with configurable transition times. |
| `BlendSpace1D` | Smooth 1-D animation blending by speed. |
| `Humanoid` | Humanoid rig definitions. |
| Animation events | Time-anchored callbacks (e.g. footstep triggers). |

### ECS (`src/engine/ECS/`)

The Entity-Component-System core, modeled on O3DE's CES principles with POJO components for serializability.

| Export | Purpose |
|--------|---------|
| `World` | Entity container — ID allocation, component storage, system iteration, `toJSON` / `loadJSON` round-trip. |
| `ComponentType` | String-ID component registry avoiding circular dependencies. |
| `Components` | Built-in components: `Transform`, `Velocity`, `PlayerInput`, `AnimState`, `MeshRef`, `SkinnedMeshRef`, `Health`, `Tag`, `Lifetime`. |
| `Systems` | `MovementSystem`, `AnimationStateMachine` system, and others driven by `World.update(dt)`. |
| `PhysicsComponents` | `Rigidbody`, `Collider` (AABB / Sphere / Capsule), `Particle`, `ParticleEmitter`, `PhysicsConfig`, `PhysicsDebug`. |
| `PhysicsSystems` | `PhysicsSystem` (fixed-step semi-implicit Euler + quaternion integration), `CollisionSystem` (broadphase + narrowphase + impulse response + Baumgarte stabilization), `ParticleSystem` (CPU particle advance + emitter spawn), `PhysicsDebugSystem`. |
| `Prefab` | Entity templates (components + transforms) with `instantiate(world): EntityId[]`. |
| `QueryBuilder` | Cached queries for high-frequency system iteration. |
| `Broadphase` | Spatial acceleration for collision detection (replaces naive O(n²)). |

Loaded models auto-generate ECS entities; ECS mutations are synchronized back to the Three.js render root in real time via the ECS → render bridge.

### Physics (`src/engine/Physics/`)

`PhysicsDemo` ships a 24-body scene with random boxes and a particle emitter, exercisable from the `PHYSICS` and `PHYS-DBG` toolbar toggles.

### Controls (`src/engine/Controls/`)

`OrbitControls` — orbit / pan / dolly input handling for the self-developed engine path.

### Geometries (`src/engine/Geometries/`)

Procedural primitives: `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`, `ConeGeometry`, `CapsuleGeometry`, `CircleGeometry`, `RingGeometry`, `TorusGeometry`, `TorusKnotGeometry`.

### Helpers (`src/engine/Helpers/`)

| Export | Purpose |
|--------|---------|
| `GridHelper` | Procedural ground grid. |
| `LineHelper` | Dynamic line mesh for collider / velocity / contact visualization. |
| `PhysicsDebugRenderer` | Three-channel debug overlay — cyan colliders, yellow contact normals / tangents / bitangents / depths, magenta velocity vectors — each independently toggleable. |

### Tools (`src/engine/Tools/`)

`Profiler` — 120-frame ring buffer with CPU / GPU / System timing markers, surfaced through `profilerStore`, `FrameChart`, and `ProfilerHUD`.

---

## The `.vreen` Package Format

A `.vreen` file is a **ZIP container** (RFC 1951 DEFLATE, standard ZIP local headers — compatible with `unzip`) capturing a complete 3D project state. The authoritative specification is [`docs/format/vreen-format-spec.md`](./docs/format/vreen-format-spec.md); current version **0.2.1**.

### Container layout

```
<name>.vreen
├── manifest.json             required — inventory + metadata (see schema below)
├── scene.json                required — camera, animation, environment, post-FX, materials
├── project.json              optional — legacy 0.1.x state (mirror of scene.json)
├── world.json                optional — embedded ECS world (deterministic game state)
└── assets/
    ├── model.glb             primary 3D model (any extension)
    ├── model.fbx             additional models
    ├── textures/             image textures (<id>.png / .jpg)
    ├── hdri/                 environment maps (<id>.hdr)
    └── audio/                sound files (reserved, <id>.ogg)
```

Rules: UTF-8 throughout (no BOM), `/` path separator, `manifest.json` + `scene.json` required for 0.2.x. Readers auto-migrate 0.1.x containers (single `project.json` or plain JSON) by sniffing the first 4 bytes (`PK\x03\x04` vs `{` / `[`).

### `manifest.json` schema (abridged)

```json
{
  "$schema": "https://vreen.dev/schemas/manifest-0.2.json",
  "version": "0.2.1",
  "exportedAt": "2026-07-11T08:30:00.000Z",
  "name": "My Project",
  "assetName": "robot.glb",
  "generator": "VREEN Engine 0.2.1",
  "primaryModelId": "ab12cd34...",
  "assets": [
    { "id": "ab12cd34...", "kind": "model", "path": "assets/model.glb" }
  ]
}
```

The format is **forward-compatible**: implementations MUST ignore unknown fields; old versions are auto-migrated by current readers.

### `.vreen-delta` incremental packages

A `.vreen-delta` is a ZIP containing only the **changes** from a base `.vreen` plus enough metadata to reconstruct the head. Used for bandwidth-efficient asset updates and collaboration workflows.

### Multi-language SDKs

| Language / Platform | Path | Build system | Purpose |
|---------------------|------|--------------|---------|
| TypeScript | `packages/engine/` (`@vreen/engine`) | esbuild + tsc | Engine + format library, zero runtime deps |
| Java POJO | `sdks/java/` | Gradle + Maven | `.vreen` read / write, round-trip tested |
| Kotlin | `packages/vreen-core/` | Maven | Build-time `.vreen` tools, diff, registry |
| C# / Unity | `packages/unity-package/` | Unity package | Editor export plugin (`VreenEditorWindow`, `VreenExporter`) |
| C++ / Unreal | `packages/unreal-plugin/` | Unreal `.uplugin` | `VreenRuntime` + `VreenEditor` modules |

### CLI

```bash
npm run vreen -- pack    <project-dir> <out.vreen>
npm run vreen -- unpack  <in.vreen>    <out-dir>
npm run vreen -- validate <in.vreen>
npm run vreen -- diff    <base.vreen> <head.vreen> <out.vreen-delta>
```

---

## Blockly Visual Scripting

VREEN embeds [Blockly 13](https://developers.google.com/blockly) as a visual scripting layer bridging non-programmers to the live engine state. The architecture is:

```
Block Definitions (JSON)  →  JavaScript Generator  →  VREEN Runtime API
                                                        │
                                       ┌────────────────┴───────────────┐
                                       │                               │
                              EcsScriptAPI                      Renderer / Camera API
                            (World binding)                    (THREE + custom engine)
```

### Block categories (`src/lib/vreenBlockly.ts`)

| Category | Color | Covers |
|----------|-------|--------|
| **Camera** | blue | Preset switching (iso / front / back / side / top / free / 1st / 3rd / cine), position, state logging. |
| **Animation** | green | Play / pause / stop, clip selection, state queries. |
| **Scene** | — | Entity creation, transform manipulation, scene queries. |
| **Renderer** | — | Engine-mode switch, post-FX toggles, environment control. |
| **Physics** | — | Rigidbody impulses, collider queries, particle emitter config. |
| **Control** | — | Flow control — loops, conditionals, Tick registration. |

### ECS binding (`src/lib/ecsScriptApi.ts`)

`EcsScriptAPI` is a pure-logic bridge (no React / Zustand dependency) that lets generated scripts operate on the live `World`:

- Entity lifecycle — `createEntity` / `destroyEntity` / `isAlive`.
- Component access — typed getters / setters for `Transform`, `Velocity`, `Health`, `Tag`, `Lifetime`, `PlayerInput`, `MeshRef`, `SkinnedMeshRef`, `AnimState`.
- Material mutation — `StandardMaterial` parameter updates.
- Animation control — `AnimationStateMachine` transitions, clip selection.
- Tick callbacks — `onTick(cb)` registration for per-frame script logic (Phase 3.2).

Component data is exchanged as JSON strings because Blockly blocks only support `string` / `number` / `array` value types.

### Roadmap integration

Planned deeper integrations include material-graph blocks (Blockly → GLSL generation) and animation-blueprint blocks (visual state-machine authoring). See the [Roadmap](#roadmap) Phase 3.

---

## Desktop Builds (Electron)

VREEN ships as a single-file portable Windows executable via Electron 43 and electron-builder 26.

```bash
# Full portable build → release/VREEN-Portable-<version>.exe
npm run electron:build

# Faster iteration: unpacked directory only
npm run electron:build:dir
```

Build configuration (in `package.json` under `build`):

- `appId`: `com.toujianjian.vreen`
- `productName`: `VREEN`
- Target: `portable` (win-x64)
- Output: `release/`
- Bundled files: `dist/**`, `electron/**`, `package.json`

The Electron entry (`electron/main.cjs`) loads the built SPA; `electron/preload.cjs` exposes a minimal bridge; `electron/splash.html` shows a launch splash. Because `vite.config.ts` sets `base: './'`, the same `dist/` works for HTTP hosting and local `file://` access.

For dev mode, `npm run electron:dev` runs Vite and Electron concurrently with `wait-on` synchronizing the Electron launch to the Vite server.

---

## Development Guide

### Code conventions

- **ESM only** — `import` / `export`; no CommonJS in application source.
- **Naming** — `camelCase` for variables / functions, `PascalCase` for classes / components / types.
- **Strict TypeScript** — `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` are all enabled in `tsconfig.app.json`.
- **Path alias** — `@/` maps to `src/` (configured in `tsconfig.app.json` and `vite.config.ts`).
- **Logging** — use `createLogger(module)` from `lib/logger.ts`. Hot paths (render / `world.update`) aggregate every 120 frames; UI log pushes are throttled to 500 ms. The engine package exposes `setLoggerSink` / `setMinLevel` for sink redirection.
- **i18n** — all user-visible strings must go through i18next keys (`src/i18n/locales/{en,zh}.json`). A `scripts/check-i18n-keys.cjs` helper audits key coverage.

### Rendering mode switch

The inspector runs in two rendering modes, toggled at runtime via `viewerStore.engineMode`:

| Mode | Container | Backend | Status |
|------|-----------|---------|--------|
| `THREE` (default) | `Stage.tsx` | React Three Fiber + Three.js r169 | Mature; current main render path. |
| `CUSTOM` | `CustomStage.tsx` | Self-developed WebGL2 engine | Functional; `/engine-demo` showcases the pure custom pipeline, with ongoing migration toward becoming the main path. |

### Cyberpunk HUD theme

The UI follows a neon-cyan / magenta scanline aesthetic defined in `src/styles/index.css` (Tailwind base + custom HUD classes). Local fonts (Orbitron, JetBrains Mono, Noto Sans SC) are bundled via `@fontsource`.

---

## Testing

VREEN uses **Vitest 4** with the Vite-shared config (zero extra configuration) and `@vitest/coverage-v8` for coverage.

```bash
npm run test              # single run
npm run test:watch        # watch mode
npm run test:coverage     # coverage report
```

### Coverage

Unit tests cover the engine foundation:

| Area | Test files |
|------|-----------|
| Math | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Box3`, `Sphere`, `Plane`, `Ray`, `Line3`, `Triangle`, `Frustum`, `Color` |
| Core | `InstancedMesh`, `LOD` |
| Geometries | `Box`, `Sphere`, `Plane`, `Cylinder`, `Cone`, `Capsule`, `Circle`, `Ring`, `Torus`, `TorusKnot` |
| ECS | `World`, `Prefab`, `QueryBuilder`, `Broadphase`, `PhysicsSystems`, `PhysicsBenchmark` |
| Animation | `Animation`, `AnimationEvents`, `BlendSpace1D` |
| Loaders | `GLBLoader`, `HDRLoader`, `FBXLoader`, `KTX2Loader`, `AssetManager` |
| Renderer | `Renderer`, `RenderPass` |
| Lib | `vreenPack`, `vreenPublish`, `blocklyScriptStore`, `ecsScriptApi` (animsm / material / base), `vreenBlockly.tick` |

Tests live alongside source files as `*.test.ts` and are picked up automatically by Vitest's default glob.

---

## CI/CD

### GitHub Actions (`.github/workflows/ci.yml`)

Triggered on every push and pull request to `main`:

1. Checkout (Node 20, npm cache)
2. `npm ci` — deterministic install
3. `npm run typecheck` — strict type check
4. `npm run build` — production build
5. `npm test` — unit test suite

A failed step blocks merge.

### Husky + lint-staged (`.husky/pre-commit`)

The `prepare` script installs Husky on `npm install`. The `pre-commit` hook runs `lint-staged`, which currently echoes staged `.ts` / `.tsx` files as a placeholder for future lint rules. Type checking runs via the CI gate.

---

## Roadmap

VREEN follows a phased roadmap documented in [`ROADMAP.md`](./ROADMAP.md). The summary below reflects the plan as of v0.5.0 (2026-07-21).

| Phase | Theme | Status |
|-------|-------|--------|
| **Phase 0** | Backlog clearance — validate Blockly panel, review HDRLoader / CustomStage changes, commit pending work. | Largely complete |
| **Phase 1** | Quality foundation — Vitest setup, Math / ECS / Loader / Animation / Physics tests, GitHub Actions CI, Husky hooks, `noUnusedLocals` / `noUnusedParameters` enablement. | Largely complete |
| **Phase 2** | Engine core — `Renderer` interface, `RenderPass` abstraction, frustum culling, `InstancedMesh`, `LOD`, ECS serialization, `Prefab`, `QueryBuilder` caching, `BlendSpace1D`, physics benchmark, broadphase optimization. | In progress |
| **Phase 3** | Blockly deep integration — ECS component-binding blocks, Tick event blocks, material-graph blocks (Blockly → GLSL), animation-blueprint blocks, script persistence in `.vreen`. | In progress (`EcsScriptAPI` + Tick callbacks landed) |
| **Phase 4** | Loaders and asset pipeline — KTX2 / Basis, FBX loader, `.vreen` publish mode (shader pre-compile, texture compression, LOD generation), `AssetManager` cache prewarming. | KTX2 / FBX landed; publish mode pending |
| **Phase 5** | Long-term vision — WebGPU backend, multi-user collaborative editing (WebSocket ECS sync), AI-assisted scene generation (LLM + Blockly), online `.vreen` marketplace. | Future |

### Architectural references

The roadmap explicitly benchmarks against [Three.js](https://github.com/mrdoob/three.js) (renderer abstraction, `NodeMaterial`, loader ecosystem, `InstancedMesh`, frustum culling, WebGPU) and [O3DE](https://github.com/o3de/o3de) (CES depth, Asset Processor, Script Canvas, EMotionFX, Atom renderer pass system).

---

## Known Issues

- **FBX texture / material conversion** fidelity depends on the source FBX; complex PBR maps may not be perfectly reproduced.
- On Windows with non-ASCII project paths, `lucide-react`'s `replace-all` icon can fail to install (`Could not read from file ... replace-all.js`). See [`setup-git.ps1`](./setup-git.ps1) for a one-line shim.
- `/viewer` still defaults to the Three.js backend; `/engine-demo` demonstrates the pure self-developed pipeline. Migration to make the custom engine the default viewer path is tracked in Phase 2 / Phase 5.
- `CustomStage.tsx` retains some temporary diagnostics (tick first-frame log, `window.__vreenStage` exposure) pending cleanup.
- `BlocklyPanel.handleStop()` currently sets `running=false` without true mid-script interruption — long scripts cannot be hard-stopped yet (planned for Phase 3.2).

---

## Deployment

The VREEN main app is a 100% static SPA. After `npm run build`, upload the contents of `dist/` to any static host:

- GitHub Pages
- Vercel
- Netlify
- Cloudflare Pages
- Any nginx / Apache / S3 bucket

`vite.config.ts` sets `base: './'`, so the build output works for both HTTP static hosting and local `file://` access (used by the Electron portable build).

For the desktop portable build:

```bash
npm run electron:build
# → release/VREEN-Portable-<version>.exe
```

---

## Contributing

Issues and pull requests are welcome. For non-trivial changes, please open an issue first to discuss the approach.

```bash
git checkout -b feat/your-feature
git commit -m "feat: ..."
git push origin feat/your-feature
# Open a Pull Request on GitHub
```

### Conventions

- Follow the [code conventions](#development-guide) above.
- Keep changes atomic and well-scoped; the project favors 1–3 hour tasks (see `ROADMAP.md`).
- Run `npm run typecheck` and `npm test` before pushing — CI will enforce both.
- Update documentation alongside code ("docs as code" principle).

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 toujianjian.

---

## Related Projects and Acknowledgements

VREEN stands on the shoulders of several open-source projects and draws architectural inspiration from industry-grade engines.

### Architectural references

- **[O3DE (Open 3D Engine)](https://github.com/o3de/o3de)** — CES depth, Asset Processor, Script Canvas, EMotionFX, Atom renderer pass system. VREEN's ECS, Blockly scripting, and `RenderPass` abstractions are modeled after O3DE's design.
- **[Three.js](https://github.com/mrdoob/three.js)** — Renderer abstraction, `NodeMaterial`, loader ecosystem, `InstancedMesh`, frustum culling. The legacy viewer path is built on Three.js + React Three Fiber.

### Library acknowledgements

- [@react-three](https://github.com/pmndrs/react-three-fiber) ecosystem — R3F / drei / postprocessing (MIT)
- Three.js example loaders (GLTF / OBJ / FBX / STL / PLY) — MIT
- [Blockly](https://developers.google.com/blockly) — Apache 2.0
- [Lucide Icons](https://lucide.dev) — ISC
- [fflate](https://github.com/101arrowz/fflate) — MIT
- [draco3d](https://github.com/google/draco) — Apache 2.0
- Local fonts via [fontsource](https://fontsource.org): Orbitron, JetBrains Mono, Noto Sans SC

### Inspiration

Sketchfab, the three.js editor, the Blender viewport, and the Unity Editor.

---

> **VREEN** — *Vector Render Engine ENvironment*. Built by [toujianjian](https://github.com/toujianjian).

**GitHub**: <https://github.com/toujianjian/vreen>
**Gitee**: <https://gitee.com/toujianjian/vreen>
