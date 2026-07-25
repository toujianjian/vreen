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
| **Engine kernel** | Self-developed WebGL2 renderer with PBR, IBL, real-time shadows, post-processing (Bloom, chromatic aberration, vignette, SMAA, SSAO, color grading, LUT, film grain, afterimage, pixelation), GPU skinning, morph targets, MRT / GBuffer for deferred rendering, path tracing (CPU reference), and a `Renderer` interface for backend pluggability. |
| **Scene graph** | `Object3D` / `Scene` / `Mesh` / `Group` / `Bone` / `Skeleton` / `SkinnedMesh` / `BufferGeometry` / `BufferAttribute` / `InstancedBufferAttribute` / `Texture` / `InstancedMesh` / `LOD` / `Sprite` / `Text` / `BitmapText` / `TextAtlas`. |
| **Math library** | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Box3`, `Sphere`, `Plane`, `Ray`, `Line3`, `Triangle`, `Frustum`, `Color`, `MathUtils`. |
| **ECS** | `World`, `ComponentType` registry, `QueryBuilder` with caching, `Prefab` templates, `Broadphase` acceleration, and POJO components for serializability. |
| **Physics** | Fixed-step semi-implicit Euler integration, quaternion rotation integration, broadphase + narrowphase collision, impulse response with Baumgarte stabilization, AABB / Sphere / Capsule colliders, 5 joint constraints (Ball / Hinge / Slider / Fixed / Distance) + `ConstraintSolver`, `ClothSimulation` Verlet soft body, CPU particle system with emitters. |
| **Animation** | `AnimationClip`, `AnimationAction`, `AnimationMixer`, `AnimationStateMachine` (Idle / Walk / Run auto-transitions), `BlendSpace1D`, `Humanoid` rig, `KeyframeTrack`, animation event callbacks, `MorphTargets` + `MorphTargetAnimation` for facial / shape animation, animation layers / masks / additive blend / sync. |
| **Loaders** | 12 loaders (`GLBLoader`, `OBJLoader`, `FBXLoader`, `HDRLoader` per-channel RLE RGBE, `KTX2Loader`, `STLLoader`, `PLYLoader`, `TGALoader`, `MTLLoader`, `EXRLoader`, `TextureLoader`, `DracoDecoder`) + 4 exporters (`OBJExporter`, `GLTFExporter`, `STLExporter`, `PLYExporter`) + `AssetManager` LRU cache. |
| **Materials** | `StandardMaterial` (PBR), `MeshPhysicalMaterial` (clearcoat / transmission), `MeshBasicMaterial`, `MeshPhongMaterial`, `MeshNormalMaterial`, `ShadowMaterial`, `SpriteMaterial`, `ShaderMaterial` with `onBeforeCompile` GLSL injection, `ShaderChunks/` subdirectory (10 GLSL fragments + `ShaderChunkRegistry` with `#include` resolution). |
| **Resource management** | `Assets/` module — `AssetCache` (LRU), `AssetRegistry` (reference counting), `AssetLoader` (async batched). |
| **Serialization** | `Serialization/` module — `SceneSerializer` / `GeometrySerializer` / `MaterialSerializer` round-trip Scene / Geometry / Material ↔ JSON. |
| **Inspection UI** | 9 camera presets (Free / Iso / Front / Back / Side / Top / 1st-person / 3rd-person / Cinematic), real-time material lab, HDRI environments, post-FX toggles, PNG capture, drag-and-drop upload. |
| **Debug tooling** | Physics debug renderer (collider / contact / velocity channels), `EntityGraph` relationship visualizer, profiler family — `Profiler` (CPU/GPU marks) / `FrameProfiler` (FPS aggregation) / `SystemProfiler` (ECS hot systems) / `MemoryTracker` (leak detection) / `GpuProfiler` (timer queries) / `PerformanceReport` (text + JSON) — surfaced through `FrameChart` and `ProfilerHUD`. |
| **Visual scripting** | Blockly block editor with Camera / Animation / Scene / Renderer / Physics / Control categories, bound to the live ECS World via `EcsScriptAPI`, with Tick-callback registration. |
| **Package format** | `.vreen` ZIP container (manifest + scene + world + embedded assets), `.vreen-delta` incremental diffs, multi-language SDKs, `vreen` CLI for pack / unpack / validate / diff. |
| **Desktop** | Electron 43 + electron-builder producing a single-file portable Windows `.exe`. |
| **i18n** | First-class zh / en / ja / ko / es via i18next; all user-facing strings flow through translation keys. |

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
│   │   ├── Core/               # Scene graph primitives + Sprite/Text/BitmapText/TextAtlas + texture family (Cube/Data/DataArray/Depth/Video/Canvas/Compressed) + Source + MorphTargets/MorphTargetAnimation + InstancedBufferAttribute + Fog/FogExp2 + Raycaster + DirtyFlag/SceneGraphProcessor/FrustumCuller/SceneStats
│   │   ├── Math/               # Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Ray, Line3, Triangle, Frustum, MathUtils
│   │   ├── Cameras/            # Perspective / Orthographic cameras
│   │   ├── Controls/           # Orbit / Fly / PointerLock / Map controls + CharacterController (kinematic)
│   │   ├── Lights/             # Ambient / Directional / Point / Spot / Hemisphere / RectArea + ShadowMapManager
│   │   ├── Geometries/         # Box / Sphere / Cylinder / Cone / Torus / Plane / Circle / Ring / Capsule / TorusKnot / Lathe / Extrude / Shape / Wireframe / Edges
│   │   ├── Materials/          # Standard / Physical / Basic / Phong / Normal / Shadow / Sprite materials + ShaderMaterial + ShaderChunks/ subdirectory (10 GLSL fragments + ShaderChunkRegistry) + onBeforeCompile
│   │   ├── Renderer/           # WebGL2Renderer, ShaderProgram, RenderPass, ShadowMapManager + MRTTarget / GBuffer (deferred) + post-FX (basic: SSAO / FXAA / ToneMapping / Gamma / DOF; enhanced PostProcess/: ColorGrading / LUT / FilmGrain / Afterimage / Pixelation)
│   │   ├── Loaders/            # GLB / OBJ / FBX / HDR / KTX2 / STL / PLY / TGA / MTL / EXR / Draco / AssetManager + 4 exporters (OBJ / GLTF / STL / PLY)
│   │   ├── Animation/          # Clips, Mixer, StateMachine, BlendSpace1D, Humanoid + layers / masks / additive blend + IK (FABRIK / CCD / IKHumanoid)
│   │   ├── ECS/                # World, ComponentType, Systems, Physics, Prefab, QueryBuilder + Constraint subsystem
│   │   ├── Physics/            # PhysicsDemo + ConstraintSolver + Joint constraints (Ball/Hinge/Slider/Fixed/Distance) + ClothSimulation (Verlet)
│   │   ├── Helpers/            # Grid / Grid3D / Axes / Box / Camera / Arrow helpers + PhysicsDebugRenderer
│   │   ├── Audio/              # AudioListener / PositionalAudio / Audio / AudioLoader / AudioAnalyser
│   │   ├── Terrain/            # TerrainGeometry / HeightmapGenerator / TerrainSplat / TerrainLayer
│   │   ├── Acceleration/       # BVH / BVHBuilder / MeshBVH
│   │   ├── Assets/             # AssetCache (LRU) / AssetRegistry (ref-counting) / AssetLoader (async) — resource lifecycle
│   │   ├── Serialization/      # SerializerRegistry / GeometrySerializer / MaterialSerializer / SceneSerializer — Scene/Geometry/Material ↔ JSON
│   │   ├── Events/             # EventBus / EventQueue / GameEvent (typed pub/sub)
│   │   ├── Scripting/          # ScriptComponent / ScriptSystem / ScriptRegistry / CoroutineSystem
│   │   ├── Particles/          # ParticleSystem2 / ParticleEmitter / ParticleModifier / ParticleCurve / TrailModule
│   │   ├── Network/            # NetworkSync / Snapshot / NetworkTransport (WebSocket/Mock) / NetworkLerp — server-authoritative sync
│   │   ├── SaveSystem/         # SaveSystem (multi-slot + auto-save) / SaveSerializer / LocalStorageAdapter
│   │   ├── SceneManager/       # SceneManager / SceneTransition (Fade/Crossfade/Slide/Wipe/None)
│   │   ├── Input/              # InputManager / KeyboardState / MouseState / TouchState / GamepadState / InputAction / InputMap
│   │   ├── Tools/              # Profiler / FrameProfiler / SystemProfiler / MemoryTracker / GpuProfiler / PerformanceReport
│   │   ├── AI/                 # NavMesh (navigation mesh) + PathFinder (A*) + SteeringBehavior (Reynolds) + Agent
│   │   ├── Environment/        # WeatherSystem + SkySystem (day/night) + CloudSystem + PrecipitationSystem
│   │   ├── Timeline/           # TimelineClip + TimelineTrack + EventTrack + PropertyTrack + TimelineSequencer (play/pause/seek/loop/export/import)
│   │   ├── Voxel/              # VoxelChunk 16³ + VoxelWorld (multi-chunk) + VoxelMesher (greedy meshing) + VoxelRaycaster (DDA) + VoxelPalette
│   │   ├── Editor/             # SelectionSystem (pick/select/hover) + TransformGizmo (translate/rotate/scale) + UndoRedoSystem (with beginGroup/endGroup) + EditorCommands (Move/Rotate/Scale/Add/Remove/Property) + SnapSystem (grid/angle/scale snap)
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
| `Scene` | Root container for renderable objects and lights. Supports `background` (color or `{ envMap }`) and `fog` (`Fog` / `FogExp2`). |
| `Group` | Non-renderable grouping node. |
| `Mesh` | Renderable leaf binding a `BufferGeometry` and a `Material`. |
| `SkinnedMesh` / `Bone` / `Skeleton` | GPU skinning — per-bone matrices uploaded as uniform arrays. |
| `BufferGeometry` / `BufferAttribute` | Vertex / index buffers with `dispose`, `setUsage`, `needsUpdate` for WebGL resource management. |
| `InstancedBufferAttribute` | Per-instance vertex attribute for instanced rendering — `meshPerAttribute` maps to `gl.vertexAttribDivisor(loc, N)` (default 1). |
| `Material` | Abstract material interface. |
| `Texture` | GPU texture wrapper with `version`, `needsUpdate`, format / wrap / filter options. |
| `Texture` family | `CubeTexture` (6-face env maps), `DataTexture` (typed-array backed), `DataArrayTexture` (2D array textures), `DepthTexture` (shadow maps / depth post-FX), `VideoTexture` (HTMLVideoElement frame stream), `CanvasTexture` (HTMLCanvasElement dynamic source with `update()`), `CompressedTexture` (S3TC / ETC / BPTC / PVRTC / ASTC base class with per-mip `{data, width, height}` chain). |
| `Source` | Texture data-source wrapper — `data` / `width` / `height` / `version` with `needsUpdate()` for renderer re-upload. Decouples pixel source from sampling state. |
| `InstancedMesh` | Per-instance matrix array rendered via `gl.drawElementsInstanced`. |
| `LOD` | Multi-level mesh switching based on camera distance. |
| `Sprite` | 2D billboard sprite — always faces the camera. CPU writes camera world rotation into `matrixWorld` during `updateMatrixWorld`; raycast does unit-quad intersection. Pairs with `SpriteMaterial`. |
| `Text` | 3D text rendering — rasterizes characters through `TextAtlas` into a shared texture atlas, generates a quad per character into a `BufferGeometry`, rendered with `MeshBasicMaterial` + atlas texture. Supports newlines and left/center/right alignment. |
| `BitmapText` | Bitmap text — accepts an externally pre-rendered `TextAtlas`, suitable for large amounts of text sharing one atlas. |
| `TextAtlas` | Character texture atlas — rasterizes characters to a canvas, records per-char UV coordinates, produces a `CanvasTexture`. Degrades to dry-run metadata-only mode when DOM is unavailable (tests / SSR). |
| `MorphTargets` | Morph target deformation (facial expressions / shape animation). Stores absolute vertex positions + weight array + name lookup. Application rule: `result[i] = base[i] + Σ(target - base) * influence`. Mounted on `mesh.morphTargets`; renderer calls `update(geometry)` before each draw to write back positions and bump `version`. |
| `MorphTargetAnimation` | Morph target animation driver — holds `MorphTargets` + multiple `MorphTargetTrack`s (times + scalar values, binary search + linear interpolation). `update(dt)` advances time, samples tracks, writes back influences. Complements `AnimationMixer` (skeleton does overall pose, morph does facial / local detail). |
| `FurShell` | Multi-layer shell fur rendering wrapper — generates N concentric `Mesh` shells sharing the base geometry, each with a `FurMaterial` at progressively higher `shellLayer` (0..1). `generate()` builds the shell set, `update(dt)` advances wind / gravity / time uniforms across all shells, `setShellCount(n)` re-generates with a new layer count. Shells attach as children of the base mesh (default) or remain standalone; `dispose()` releases per-shell materials. Pairs with `FurMaterial` for layered shell-based fur / hair. |
| `Fog` / `FogExp2` | Linear and exponential fog; renderer blends fragment color toward fog color by distance. |
| `Raycaster` / `intersectGeometry` | Ray-scene intersection with `Face` / `Intersection` results; reusable `RaycasterParameters`. |

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
| `ShadowMapManager` | Centralized shadow-map FBO / texture lifecycle for cast-shadow lights; per-light depth target reuse and resize policy. |
| `MRTTarget` | Multi-Render Target FBO — N color attachments (`COLOR_ATTACHMENT0..N-1`) + optional depth/stencil. Supports `rgba8` / `rgba16f` / `rgba32f` / `rg16f` / `r16f` internal formats; `bind()` configures `drawBuffers`, `resize()` reallocates textures. Generalizes the SSAO-specific 2-attachment FBO. |
| `GBuffer` | Geometry Buffer for deferred rendering — built on `MRTTarget` with 4 color attachments (position `RGBA16F` / normal `RGBA16F` / albedo+opacity `RGBA8` / metallic+roughness+emissive+AO `RGBA8`) + depth. Provides `positionTexture` / `normalTexture` / `albedoTexture` / `materialTexture` for downstream lighting passes. |
| Post-processing passes (basic) | `BloomPass`, `ChromaticAberrationPass`, `VignettePass`, `FinalComposePass` (built-in) plus `SSAOPass` (screen-space ambient occlusion), `FXAAPass` (fast approximate anti-aliasing), `ToneMappingPass` (ACES filmic / Reinhard), `GammaCorrectPass`, `DOFPass` (depth of field). |
| Post-processing passes (enhanced, `PostProcess/`) | `ColorGradingPass` (ASC-CDL 8-param color grading), `LUTPass` (3D or 2D strip LUT color lookup), `ChromaticAberrationPass` (enhanced — Vector2 offset + radial modulation), `VignettePass` (enhanced — offset/darkness + color tint), `FilmGrainPass` (strength/size/animation), `AfterimagePass` (cross-frame accumulation), `PixelationPass` (mosaic). All implement the `RenderPass` interface and compose into `PostProcessingPipeline`. |
| `PathTracer` | CPU-simplified path tracer for reference / validation rendering — progressive accumulation with `frameCount`, configurable `maxBounces` (default 8) and `samplesPerPixel` (default 4). Möller–Trumbore ray-triangle intersection, direct + indirect lighting, Russian-roulette path termination. `render(scene, camera)` traces one pass per call; `accumulate()` is an alias; `getResult()` returns the accumulated `Uint8ClampedArray`; `reset()` clears the buffer. Slow but useful for ground-truth comparison against the WebGL2 PBR pipeline. |

### Materials (`src/engine/Materials/`)

| Export | Purpose |
|--------|---------|
| `StandardMaterial` | PBR material — base color, metallic, roughness, emissive, opacity, wireframe, procedural texture slots. |
| `MeshPhysicalMaterial` | Extended PBR — adds clearcoat, sheen, IOR, transmission, anisotropy for physically accurate dielectric / glass / fabric surfaces. |
| `MeshBasicMaterial` | Unlit material — flat color / texture, ignores scene lighting. |
| `MeshPhongMaterial` | Legacy Blinn-Phong — specular highlights for non-PBR pipelines / stylistic looks. |
| `MeshNormalMaterial` | Debug material — visualize object-space or world-space normals as RGB. |
| `ShadowMaterial` | Shadow-only material — receives shadow maps without contributing surface color (used for invisible shadow catchers). |
| `SpriteMaterial` | Sprite material — extends `BasicMaterial` with color, map, opacity, rotation, `sizeAttenuation` (perspective near-big-far-small), depth test/write, render order. Pairs with `Sprite`; renderer uses a separate sprite shader path implementing billboard orientation. |
| `ShaderMaterial` | Custom-shader material accepting GLSL strings and a uniform descriptor. Supports `onBeforeCompile` for injecting GLSL snippets into the built-in shaders without rewriting them. |
| `ShaderChunks/` subdirectory | 10 GLSL fragment string constants (`COMMON_CHUNK`, `LIGHTING_CHUNK`, `FOG_CHUNK` / `FOG_EXP2_CHUNK`, `NORMAL_PACK_CHUNK`, `SHADOW_CHUNK`, `ENVMAP_CHUNK`, `TONEMAP_ACES_CHUNK` / `TONEMAP_REINHARD_CHUNK`, `NOISE_CHUNK`, `UV_TRANSFORM_CHUNK`, `COLOR_SPACE_CHUNK`) + `ShaderChunkRegistry` (singleton `shaderChunkRegistry`) supporting `#include <name>` resolution. `registerBuiltinChunks()` registers all built-ins idempotently. |
| `shaders.ts` | Built-in shader source. |

### Lights (`src/engine/Lights/`)

| Export | Purpose |
|--------|---------|
| `Light` | Base class. `color`, `intensity`. |
| `AmbientLight` | Flat ambient term. |
| `DirectionalLight` | Sun-like; `direction`, `castShadow`, `DirectionalLightShadow` config (map size, bias). |
| `PointLight` | Radial point light with distance attenuation. |
| `SpotLight` | Cone with inner / outer angle and penumbra. |
| `HemisphereLight` | Sky / ground two-color ambient. |
| `RectAreaLight` | Rectangular area light for IBL-style fill. |
| `ShadowMapManager` | Renderer-side shadow-map FBO / texture lifecycle (also exported from `Renderer/`). |

The renderer collects lights per-scene via `_collectLights(scene)` with change detection.

### Cameras (`src/engine/Cameras/`)

`Camera` base, `PerspectiveCamera` (FOV / aspect / near / far), `OrthographicCamera`. Both produce view-projection matrices consumed by the renderer and the `Frustum` culler.

### Loaders (`src/engine/Loaders/`)

| Export | Purpose |
|--------|---------|
| `GLBLoader` | Binary glTF parsing with staged logging (load → read → `parseGLB` → `buildFromGltf`); Draco support via `DracoDecoder`. |
| `OBJLoader` / `OBJExporter` | Wavefront OBJ import (`parseOBJ`) and string export (`exportOBJ`). |
| `GLTFExporter` | glTF-GLB binary export — serializes engine `Scene` / `Mesh` / `Material` into a self-contained `.glb` with embedded buffers and images; round-trippable with `GLBLoader`. |
| `STLExporter` | Stereolithography (STL) mesh export — ASCII and binary variants. |
| `PLYExporter` | Polygon File Format (PLY) mesh export — ASCII and binary variants. |
| `FBXLoader` | FBX parsing (model + material + animation extraction). |
| `HDRLoader` | Radiance `.hdr` decoding with **per-channel RLE** RGBE → Float32 conversion; covers compressed, uncompressed, and mixed-encoding scanline variants. |
| `KTX2Loader` | KTX2 / Basis Universal texture decompression for bandwidth reduction. |
| `STLLoader` | Stereolithography (STL) mesh import — ASCII and binary variants. |
| `PLYLoader` | Polygon File Format (PLY) mesh import — ASCII and binary variants. |
| `TGALoader` | Truevision TGA image import (uncompressed + RLE, color-mapped). |
| `MTLLoader` | Wavefront MTL material library parser (paired with `OBJLoader`). |
| `EXRLoader` | OpenEXR float image import for HDR textures and IBL. |
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
| IK subsystem | `IKBone`, `IKChain`, `IKSolver` (FABRIK), `CCDSolver` (Cyclic Coordinate Descent), `IKHumanoid` — full biped IK rig with joint constraints and side chaining. |

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

### Controls (`src/engine/Controls/`)

| Export | Purpose |
|--------|---------|
| `OrbitControls` | Orbit / pan / dolly input handling — the default inspector camera. |
| `FlyControls` | Free-fly camera with roll, no up-vector lock — for level-editor-style navigation. |
| `PointerLockControls` | First-person pointer-lock camera — for 1st-person / walkthrough modes. |
| `MapControls` | Top-down map pan / zoom — orthogonal feel with perspective camera. |

### Geometries (`src/engine/Geometries/`)

Procedural primitive geometry generators. Each produces a `BufferGeometry` with position / normal / uv / index attributes.

| Export | Parameters |
|--------|------------|
| `BoxGeometry` | width, height, depth, widthSegments, … |
| `SphereGeometry` | radius, widthSegments, heightSegments, … |
| `PlaneGeometry` | width, height, widthSegments, heightSegments |
| `CylinderGeometry` | radiusTop, radiusBottom, height, radialSegments, … |
| `ConeGeometry` | radius, height, radialSegments, … |
| `CapsuleGeometry` | radius, length, capSegments, radialSegments |
| `CircleGeometry` | radius, segments |
| `RingGeometry` | innerRadius, outerRadius, thetaSegments |
| `TorusGeometry` | radius, tube, radialSegments, tubularSegments, arc |
| `TorusKnotGeometry` | radius, tube, tubularSegments, radialSegments, p, q |
| `LatheGeometry` | points (Vector2[]), segments — revolve a 2D profile around the Y axis. |
| `ExtrudeGeometry` | shape, depth, bevelEnabled, bevelThickness, … — extrude a 2D `Shape` into 3D. |
| `Shape` | 2D contour builder (moveTo, lineTo, quadraticCurveTo, bezierCurveTo, absarc, holes) used by `ExtrudeGeometry` / `LatheGeometry`. |
| `WireframeGeometry` | Edge-only geometry derived from a source `BufferGeometry` — for debug wireframe rendering. |
| `EdgesGeometry` | Hard-edge-only geometry (crenellation threshold) — for CAD-style edge highlighting. |

`Primitives.ts` re-exports all of the above for convenience.

### Helpers (`src/engine/Helpers/`)

| Export | Purpose |
|--------|---------|
| `GridHelper` | Procedural ground grid. |
| `GridHelper3D` | 3-axis volumetric grid — full 3D cell visualization, not just ground plane. |
| `LineHelper` | Dynamic line mesh for collider / velocity / contact visualization. |
| `AxesHelper` | RGB axis tripod (X red, Y green, Z blue) sized to a unit length. |
| `BoxHelper` | Bounding-box wireframe from an `Object3D` or `Box3`. |
| `CameraHelper` | Frustum visualization — draws near / far planes and corners of a `Camera`. |
| `ArrowHelper` | Direction arrow with origin / direction / length / color, used for normals and force vectors. |
| `PhysicsDebugRenderer` | Three-channel debug overlay — cyan colliders, yellow contact normals / tangents / bitangents / depths, magenta velocity vectors — each independently toggleable. |

### Audio (`src/engine/Audio/`)

WebAudio-based spatial audio subsystem.

| Export | Purpose |
|--------|---------|
| `AudioListener` | Scene-level listener representing the camera / player ears; position and orientation tracked. |
| `Audio` | Non-positional sound (UI SFX, music) bound to a buffer. |
| `PositionalAudio` | 3D positional sound with panner-node distance / cone attenuation. |
| `AudioLoader` | Decode `ArrayBuffer` (mp3 / ogg / wav) into `AudioBuffer`s. |
| `AudioAnalyser` | FFT analyser for visualization (frequency data, waveform). |

### Terrain (`src/engine/Terrain/`)

Procedural terrain system for outdoor scenes.

| Export | Purpose |
|--------|---------|
| `TerrainGeometry` | Height-field mesh — `width × height` quads with per-vertex elevation. |
| `HeightmapGenerator` | Procedural heightmap generators — fractal noise, ridged, hydraulic erosion. |
| `TerrainSplat` | Splat-map based texture blending — up to N layers with alpha masks. |
| `TerrainLayer` | Per-layer metadata (albedo texture, normal texture, tiling, metallic / roughness). |

### Acceleration (`src/engine/Acceleration/`)

Spatial acceleration structures for ray tracing and broad-phase culling.

| Export | Purpose |
|--------|---------|
| `BVH` | Bounding Volume Hierarchy — generic axis-aligned primitive. |
| `BVHBuilder` | SAH-based builder for `BVH` from triangle soups. |
| `MeshBVH` | Triangle-aware `BVH` over a `BufferGeometry` — used by `Raycaster` for sub-linear ray-mesh intersection. |

### Physics (`src/engine/Physics/`)

`PhysicsDemo` ships a 24-body scene with random boxes and a particle emitter, exercisable from the `PHYSICS` and `PHYS-DBG` toolbar toggles.

Constraint subsystem (in `src/engine/Physics/`, based on the `Constraint` base class + `RigidbodyLike` interface, decoupled from any specific rigid-body implementation):

| Constraint | Purpose |
|------------|---------|
| `BallJointConstraint` | Ball-and-socket — 3-DOF rotational, 0-DOF translational. |
| `HingeJointConstraint` | Hinge — 1-DOF rotational about an axis. |
| `SliderJointConstraint` | Slider — 1-DOF translational along an axis. |
| `FixedJointConstraint` | Rigid weld — 0-DOF, fully locks two bodies together. |
| `DistanceJointConstraint` | Maintains a fixed distance between two anchor points. |
| `ConstraintSolver` | Iterative sequential-impulse solver that processes all active constraints each fixed step. |

`ClothSimulation` — Verlet-integration cloth simulator (soft body). Particle grid (`ClothParticle`: position / prevPosition / acceleration / pinned / mass) + distance constraints (`ClothConstraint`: p1 / p2 / restLength / stiffness) solved PBD-style with multiple iterations. Supports sphere collision (`ClothSphere`) and pinned anchor particles. `getMeshData()` outputs flattened positions / indices / normals for upload to `BufferGeometry`. Independent of the ECS `PhysicsSystems` (soft-body shape differs significantly from rigid bodies).

### Assets (`src/engine/Assets/`)

Resource lifecycle management — complements `Loaders/AssetManager` (which focuses on Promise caching). The `Assets/` module focuses on instance lifecycle and reference counting.

| Export | Purpose |
|--------|---------|
| `AssetCache` | Synchronous LRU resource instance cache keyed by string. `get` / `set` / `has` / `delete` with capacity-based eviction. |
| `AssetRegistry` | Resource registry with reference counting. `acquire(key)` returns an `AssetHandle` holding a reference; `release(handle)` decrements the count and triggers a dispose callback when it reaches zero. `getDefaultAssetRegistry()` returns the process-wide singleton. |
| `AssetLoader` | Async resource loader wrapping `AssetManager`. `load(entries)` batches multiple load requests and returns an `AssetBatchResult` (success / failure groups). |

### Serialization (`src/engine/Serialization/`)

Scene serialization module supporting round-trip Scene / Geometry / Material ↔ JSON.

| Export | Purpose |
|--------|---------|
| `SerializerRegistry` | Serializer registry dispatching by type. `getDefaultSerializerRegistry()` returns the process-wide singleton. |
| `GeometrySerializer` | `BufferGeometry` ↔ `GeometryJSON` (attributes / index / morphTargets). |
| `MaterialSerializer` | `Material` ↔ `MaterialJSON`. Supports `registerMaterialType` to register custom material type metadata; `serializeMaterial` / `deserializeMaterial` helpers. |
| `SceneSerializer` | `Scene` ↔ `SceneJSON` top-level entry. Recursively serializes the `Object3D` tree. Supports `registerObjectHandler` for custom node handlers. Versioned via `SCENE_SERIALIZER_VERSION`. |

### Tools (`src/engine/Tools/`)

Performance analysis toolkit — a family of complementary profilers that can be combined or used standalone.

| Export | Purpose |
|--------|---------|
| `Profiler` | Original 120-frame ring-buffer profiler with CPU / GPU mark intervals (`mark` / `markEnd`), nested children, and `EXT_disjoint_timer_query_webgl2` integration. Surfaces per-frame `FrameSample` snapshots consumed by `FrameChart.tsx` and `ProfilerHUD.tsx`. |
| `FrameProfiler` | Frame-level FPS / draw-call / triangle aggregator. Rolling `currentFPS` / `avgFPS` / `minFPS` / `maxFPS` over a configurable ring buffer (default 120). `beginFrame()` / `endFrame(stats)` / `getMetrics()` / `getHistory(count)`. |
| `SystemProfiler` | ECS system timing tracker. `begin(name)` / `end(name)` records `totalTime` / `callCount` / `avgTime` / `maxTime` / `lastTime` per system; `getSlowestSystems(count)` ranks hot systems. |
| `MemoryTracker` | Engine-managed resource allocation ledger. `track(type, size)` returns an id; `untrack(id)` releases it; `getLeaks(minAgeMs)` flags allocations that survived past an age threshold. Maintains `byType` summary for leak triage. |
| `GpuProfiler` | Standalone GPU timer-query wrapper. `beginQuery(gl, id)` / `endQuery(gl, id)` / `getQueryResult(gl, id)`; non-blocking `pollAll(gl)` resolves elapsed ns → ms once the driver reports availability. Silently degrades to CPU-side timing when `EXT_disjoint_timer_query_webgl2` is unavailable. |
| `PerformanceReport` | Static report generator — `generate(fp?, sp?, mt?)` produces a human-readable text report; `toJSON(...)` produces a `PerformanceReportJson` for tooling. |

### Events (`src/engine/Events/`)

Lightweight pub/sub event bus decoupling game logic from systems.

| Export | Purpose |
|--------|---------|
| `EventBus` | Synchronous topic-based dispatcher — `on(topic, listener)` / `off(topic, listener)` / `emit(topic, payload)`. Listener removal by reference. |
| `EventQueue` | Buffered FIFO queue for deferred dispatch — `enqueue(event)` / `drain()` flushes all pending events in order. Used by systems that must defer side effects until safe points in the frame. |
| `GameEvent` | Discriminated union of typed events: `CollisionEvent`, `TriggerEvent`, `SpawnEvent`, `DestroyEvent`, `ScoreEvent`, `CustomEvent`. Each carries a typed `data` payload. |

### Scripting (`src/engine/Scripting/`)

Code-driven scripting layer complementing Blockly visual scripting.

| Export | Purpose |
|--------|---------|
| `ScriptComponent` | ECS component holding a script instance + lifecycle hooks (`onCreate` / `onUpdate` / `onDestroy` / `onCollision` / `onTrigger`). Registered as `ScriptC` ComponentType. |
| `ScriptSystem` | ECS system that ticks all `ScriptComponent` entities each frame, dispatches collision / trigger events, and manages script lifecycle. |
| `ScriptRegistry` | Factory registry mapping a string name → `ScriptFactory`. `scriptRegistry` is the process-wide singleton; scripts look themselves up by name for serialization. |
| `CoroutineSystem` | Cooperative coroutine scheduler — `startCoroutine(generator)` returns a `CoroutineHandle`; coroutines yield `CoroutineYield` values (frame / seconds / predicate) and resume on the next matching tick. Used for sequenced gameplay logic (cutscenes, delayed effects). |

### Particles (`src/engine/Particles/`)

Advanced CPU particle system — separate from the legacy ECS `ParticleSystem`. Supports modifiers, curves, sub-emitters, and trails.

| Export | Purpose |
|--------|---------|
| `ParticleSystem2` | Main simulator — owns a particle pool, runs `ParticleModifier`s each tick, spawns from one or more `ParticleEmitter`s, exports `ParticleSystemRenderData` for the renderer. |
| `ParticleEmitter` | Spawn source — configurable shape (sphere / box / cone / hemisphere / mesh), rate, burst schedule, lifetime / speed / size ranges. (Re-exported as `AdvancedParticleEmitter` from the engine barrel to avoid colliding with the ECS `ParticleEmitter` component.) |
| `ParticleModifier` | Abstract base for per-particle behaviour. Built-ins: `ForceFieldModifier`, `VortexModifier`, `TurbulenceModifier`, `ColorOverLifeModifier`, `SizeOverLifeModifier`, `VelocityOverLifeModifier`, `SubEmittersModifier`. |
| `ParticleCurve` | Sampling curve interface for life-driven properties. Implementations: `ConstantCurve`, `LinearCurve`, `BezierCurve`, `RandomCurve`. |
| `TrailModule` | Optional ribbon-trail renderer attachment — records particle positions over time and produces `TrailRenderData` for the renderer. Supports multiple color modes (`TrailColorMode`). |
| `ParticleData` | Per-particle state struct (position / velocity / size / color / lifetime / etc). |

### AI (`src/engine/AI/`)

AI navigation subsystem for game agents.

| Export | Purpose |
|--------|---------|
| `NavMesh` | Navigation mesh — built from a `BufferGeometry` or convex polygon set; produces a walkable surface graph with polygon clustering and boundary extraction. |
| `PathFinder` | A* pathfinding over a `NavMesh` graph. `findPath(start, end)` returns a `Vector3[]` waypoint list. Supports heuristic tuning and path smoothing. |
| `SteeringBehavior` | Reynolds steering behaviors — Seek / Flee / Arrive / Wander / Pursue / Evade / ObstacleAvoidance / PathFollowing / Separation / Alignment / Cohesion / Flocking. Composable into a steering pipeline. |
| `Agent` | AI agent combining `PathFinder` + `SteeringBehavior`. Holds target / path / velocity / maxSpeed / steeringForce; `update(dt)` advances locomotion. |

### Environment (`src/engine/Environment/`)

Atmospheric and weather environment systems for outdoor scenes.

| Export | Purpose |
|--------|---------|
| `WeatherSystem` | Weather state machine (Clear / Cloudy / Rain / Snow / Storm) with transition interpolation and fog联动. |
| `SkySystem` | Procedural sky + day/night cycle — sun position computed from time-of-day, atmospheric scattering approximation, gradient sky dome. |
| `CloudSystem` | Procedural cloud layer — noise-texture animation with altitude coverage and movement direction. |
| `PrecipitationSystem` | Precipitation particles (rain / snow) driven by a particle system with wind influence. |

### Timeline (`src/engine/Timeline/`)

Multi-track timeline / sequencer system for orchestrating animation clips, events, and property keyframes.

| Export | Purpose |
|--------|---------|
| `TimelineClip` | Timeline clip — `start` / `duration` / `name` / `data` / `blendMode` / `speed`. `contains(time)` and `getLocalTime(time)` map world time to clip-local time (accounting for `speed`). |
| `TimelineTrack` | Track base class — `name` / `type` (`'animation'` / `'event'` / `'audio'` / `'property'`) / `clips[]` / `enabled` / `locked`. `addClip` / `removeClip` / `getClipsAtTime` / `update(time, dt)`. |
| `EventTrack` | Event track — triggers named events at specific times. `TimedEvent { time, eventName, data }`. `getEventsBetween(lastTime, time)` supports loop wrap-around (two-segment detection: `(lastTime, +∞) ∪ [0, time]`). `trigger(time, lastTime, bus)` fires events through `EventBus`. |
| `PropertyTrack` | Property track — animates object properties via keyframes. `Keyframe { time, value, interp? }`. `evaluate(time)` supports `linear` / `step` / `smoothstep` interpolation. `update(time)` writes the sampled value back to `target[propertyPath]` (supports dotted paths like `a.b.c`). |
| `TimelineSequencer` | Sequencer — `play` / `pause` / `stop` / `seek(time)` / `update(dt)` / `addTrack` / `removeTrack` / `getDuration` / `export()` / `import(json)`. Supports `loop` (wrap-around triggers EventTrack two-segment) and `speed` (global time-scale). `lastTime` is public for external playback-head tracking. Complements `AnimationMixer` (per-action bone blending) with per-track multi-type orchestration; nestable via `TimelineTrack.data` holding an `AnimationAction`. |

### Voxel (`src/engine/Voxel/`)

Voxel system for Minecraft-style blocky worlds — chunked storage, greedy meshing, and DDA ray traversal.

| Export | Purpose |
|--------|---------|
| `VoxelPalette` | Voxel type registry — `id → { name, color, transparent, solid }`. `defaultPalette` preloads AIR / Stone / Grass / Dirt / Sand / Wood / Leaves. |
| `VoxelChunk` | 16³ voxel block. `getVoxel` / `setVoxel` on local `[0,15]` coords. `buildMesh(palette)` emits only exposed faces (face culling) → `VoxelMeshData { positions, normals, colors, indices }`. |
| `VoxelMesher` | Mesh generator: `greedyMesh` (merges collinear same-type faces into larger quads, minimises triangle count), `simpleMesh` (one quad per face), `getAmbientOcclusion` (per-vertex AO from neighbour occupancy). |
| `VoxelRaycaster` | DDA voxel ray traversal. `raycast(world, origin, direction, maxDist)` → `VoxelRayHit { blockX/Y/Z, normalX/Y/Z, distance }`. O(distance) regardless of triangle count — far faster than `Core/Raycaster` for blocky worlds. |
| `VoxelWorld` | Multi-chunk world manager. `setVoxel` / `getVoxel` translate world coords to `(chunkCoord, localCoord)`. `generateTerrain(heightmap, palette)` batch-fills from a heightmap. Tracks `VoxelWorldStats`. |

### Editor (`src/engine/Editor/`)

Editor subsystem for in-engine object manipulation — selection, transform gizmo, undo/redo, and snapping. Components are decoupled; the UI layer wires them together.

| Export | Purpose |
|--------|---------|
| `SelectionSystem` | Selection/hover/pick manager. `selected: Set<Object3D>`. `select(obj, additive)` replaces or appends. `pick(raycaster, scene)` ray-picks closest hit and, per `multiSelect`, replaces/appends/toggles. `on(listener)` emits `SelectionChangeEvent` for UI refresh. |
| `TransformGizmo` | Transform handle (translate/rotate/scale). 3 axis-end-spheres act as pick targets. `handleMouseDown/Move/Up(ray)` handle drag; ray projection onto axis computes delta written back to `target.position/rotation/scale`. `getMeshData()` returns `GizmoMeshData` for UI rendering (gizmo itself draws no WebGL). |
| `UndoRedoSystem` | Undo/redo stack with grouping. `execute(action)` calls `redo()` and pushes (clears redo stack). `beginGroup(name)` / `endGroup()` merge multiple actions into one atomic entry (undo reverse-order, redo forward-order). `maxHistory` trims oldest. |
| `EditorCommands` | `HistoryAction` factories: `createMoveCommand` / `createRotateCommand` / `createScaleCommand` / `createAddCommand` / `createRemoveCommand` / `createPropertyCommand`. Snapshots taken at factory-call time. |
| `SnapSystem` | Snapping with three independent toggles: `gridSnap` (position, `snapPosition` rounds to `gridSize`), `angleSnap` (rotation, default 15°), `scaleSnap` (scale). All `snap*` return new `Vector3`, never mutate input. |

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

Unit tests cover the engine foundation (3128+ tests across 192+ engine test files):

| Area | Test files |
|------|-----------|
| Math | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Box3`, `Sphere`, `Plane`, `Ray`, `Line3`, `Triangle`, `Frustum`, `Color` |
| Core | `InstancedMesh`, `LOD`, `InstancedBufferAttribute`, `Sprite`, `TextAtlas`, `MorphTargets`, `CubeTexture`, `DataTexture`, `DataArrayTexture`, `DepthTexture`, `VideoTexture`, `CanvasTexture`, `CompressedTexture`, `Source`, `Fog`, `FogExp2`, `Raycaster`, `FrustumCuller`, `SceneGraphProcessor`, `SceneStats` |
| Geometries | `Box`, `Sphere`, `Plane`, `Cylinder`, `Cone`, `Capsule`, `Circle`, `Ring`, `Torus`, `TorusKnot`, `Lathe`, `Extrude`, `Shape`, `Wireframe`, `Edges` |
| ECS | `World`, `Prefab`, `QueryBuilder`, `Broadphase`, `PhysicsSystems`, `PhysicsBenchmark` |
| Animation | `Animation`, `AnimationEvents`, `BlendSpace1D`, `AnimationLayer`, `AvatarMask`, `BoneMask`, `AdditiveBlend`, `IKBone`, `IKChain`, `IKSolver`, `CCDSolver` |
| Loaders | `GLBLoader`, `HDRLoader`, `FBXLoader`, `KTX2Loader`, `STLLoader`, `PLYLoader`, `TGALoader`, `AssetManager`, `OBJExporter`, `GLTFExporter`, `STLExporter`, `PLYExporter` |
| Renderer | `Renderer`, `RenderPass`, `ShadowMapManager`, `MRTTarget`, `PostProcessPasses`, `PathTracer` |
| Lights | `AmbientLight`, `DirectionalLight`, `PointLight`, `SpotLight`, `HemisphereLight`, `RectAreaLight` |
| Materials | `MeshBasicMaterial`, `MeshNormalMaterial`, `MeshPhongMaterial`, `MeshPhysicalMaterial`, `ShadowMaterial`, `SpriteMaterial`, `ShaderChunkRegistry`, `chunks` |
| Controls | `FlyControls`, `MapControls`, `PointerLockControls` |
| Helpers | `AxesHelper`, `BoxHelper`, `CameraHelper`, `ArrowHelper`, `GridHelper3D` |
| Audio | `Audio`, `AudioAnalyser`, `AudioContext`, `AudioListener`, `AudioLoader`, `PositionalAudio` |
| Terrain | `TerrainGeometry`, `HeightmapGenerator`, `TerrainLayer`, `TerrainSplat` |
| Acceleration | `BVH`, `MeshBVH` |
| Physics | `ClothSimulation`, `Constraints` |
| Assets | `AssetCache`, `AssetRegistry` |
| Serialization | `GeometrySerializer`, `SceneSerializer` |
| Events | `EventBus`, `EventQueue`, `GameEvent` |
| Scripting | `Coroutine`, `ScriptRegistry` |
| Tools | `FrameProfiler`, `SystemProfiler`, `MemoryTracker` |
| Particles | `ParticleSystem2`, `ParticleEmitter`, `ParticleModifier`, `ParticleCurve`, `ParticleData`, `TrailModule` |
| Input | `KeyboardState`, `MouseState`, `InputAction`, `InputMap`, `InputManager` |
| AI | `Agent`, `NavMesh`, `PathFinder`, `SteeringBehavior` |
| Environment | `SkySystem`, `WeatherSystem` |
| Timeline | `TimelineSequencer`, `TimelineTrack`, `EventTrack`, `PropertyTrack` |
| Voxel | `VoxelChunk`, `VoxelWorld`, `VoxelPalette`, `VoxelRaycaster` |
| Editor | `SelectionSystem`, `UndoRedoSystem`, `SnapSystem` |
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

## Comparison with Other Engines

### VREEN vs soup3D

[soup3D](https://github.com/OrenLiu/soup3D) is a Python + pygame + OpenGL 3D engine designed for beginners. VREEN is built on a different foundation — TypeScript + WebGL2 — targeting professional-grade 3D game development with a complete engine architecture.

| Feature | VREEN | soup3D |
|---|---|---|
| Language | TypeScript (WebGL2) | Python (OpenGL + pygame) |
| Runtime | Browser-native + Electron desktop | Desktop only (pygame) |
| Architecture | Full ECS (Entity-Component-System) | Procedural API |
| Rendering | PBR + IBL + Shadow + Post-processing (14 passes) + MRT/GBuffer deferred | Fixed-function + basic shaders |
| Physics | Rigid body + Collision + 5 Joint constraints + ConstraintSolver + Cloth simulation (Verlet) | None |
| Animation | Clip/Mixer/StateMachine + IK (FABRIK/CCD) + Layer blending + Morph Targets | Basic skeleton |
| Geometry | 15 primitives + Terrain + BVH acceleration | Basic primitives |
| Particles | 7-module system (Emitter/Modifier/Curve/Trail) | None |
| Audio | 3D spatial audio + FFT analyser | None |
| Text & Sprites | Text/BitmapText/TextAtlas + Sprite (billboard) | None |
| AI Navigation | NavMesh + A* PathFinder + SteeringBehavior + Agent | None |
| Environment | Weather + Sky (day/night) + Clouds + Precipitation | None |
| Timeline | Multi-track Sequencer (Clips/Events/Property keyframes) | None |
| Voxel | VoxelChunk 16³ + VoxelWorld + Greedy meshing + DDA raycast | None |
| Editor | Selection + TransformGizmo + Undo/Redo + Snap | None |
| Serialization | Scene/Geometry/Material ↔ JSON | None |
| Export | GLTF / OBJ / STL / PLY (4 exporters) | None |
| i18n | 5 languages (en/zh/ja/ko/es) | 2 languages (en/zh) |
| Testing | 3128+ unit tests (192 test files, 390+ source files) | None |
| Visual Scripting | Blockly integration | None |
| Package Format | .vreen (ZIP + delta diff) | None |

### VREEN vs three.js

VREEN bundles a **self-contained WebGL2 engine** alongside Three.js integration. The self-contained engine provides a learning and production path that doesn't depend on Three.js, while the Three.js mode remains available for compatibility.

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
