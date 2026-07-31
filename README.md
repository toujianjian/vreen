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
| **Engine kernel** | Self-developed WebGL2 renderer with PBR, IBL, real-time shadows, post-processing (Bloom, chromatic aberration, vignette, SMAA, SSAO, color grading, LUT, film grain, afterimage, pixelation, auto-exposure, enhanced DOF, GTAO, motion blur, SSR, SSSS, TAA, velocity, volumetric fog), GPU skinning, morph targets, MRT / GBuffer for deferred rendering + `DeferredRenderer` alternative backend + `ForwardPlusRenderer` (tiled light culling) + `ReflectionProbe`/`ReflectionProbeManager` for local IBL + `GlobalIllumination` (light probes SH2 + VXGI simplified) + `GPUDrivenRenderer` (indirect draw) + `RenderGraph` (Frostbite FrameGraph-style) + `RenderPipelineManager` (Forward/Deferred/Forward+ orchestrator) + `ShaderLibrary`/`ShaderCompiler` (#include + chunk injection + cache) + `ShaderVariant` (keyword variants + LRU cache), path tracing (CPU reference), and a `Renderer` interface for backend pluggability. |
| **Scene graph** | `Object3D` / `Scene` / `Mesh` / `Group` / `Bone` / `Skeleton` / `SkinnedMesh` / `BufferGeometry` / `BufferAttribute` / `InstancedBufferAttribute` / `Texture` / `InstancedMesh` / `LOD` / `Sprite` / `Text` / `BitmapText` / `TextAtlas` + `ModuleRegistry` (Gem-style engine module registry, inspired by O3DE Gems). |
| **Math library** | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Box3`, `Sphere`, `Plane`, `Ray`, `Line3`, `Triangle`, `Frustum`, `Color`, `MathUtils`. |
| **ECS** | `World`, `ComponentType` registry, `QueryBuilder` with caching, `Prefab` templates, `Broadphase` acceleration, and POJO components for serializability. |
| **Physics** | Fixed-step semi-implicit Euler integration, quaternion rotation integration, broadphase + narrowphase collision, impulse response with Baumgarte stabilization, AABB / Sphere / Capsule colliders, 5 joint constraints (Ball / Hinge / Slider / Fixed / Distance) + `ConstraintSolver` + `ConstraintSystem` (runtime config + breakable), `CollisionSystem` (BVH / SAT / GJK / EPA pipeline with sphere / box / capsule / convex / mesh colliders), `ClothSimulation` Verlet soft body, `RopePhysics` Verlet chain (distance + bending constraints + wind), `FluidSimulation` (SPH), `DestructionSystem` + `VoronoiFracture`, CPU particle system with emitters. |
| **Animation** | `AnimationClip`, `AnimationAction`, `AnimationMixer`, `AnimationStateMachine` (Idle / Walk / Run auto-transitions), `BlendSpace1D`, `Humanoid` rig, `KeyframeTrack`, animation event callbacks, `MorphTargets` + `MorphTargetAnimation` for facial / shape animation, animation layers / masks / additive blend / sync, IK subsystem (`IKBone` / `IKChain` / `IKSolver` FABRIK / `CCDSolver` / `IKHumanoid`) + high-level `IKSystem` driving scene-graph joints directly + `ProceduralAnimation` (8 procedural node types: head-track / breathing / walk-cycle / run-cycle / idle-sway / look-at / reach / secondary-motion). |
| **Loaders** | 12 loaders (`GLBLoader`, `OBJLoader`, `FBXLoader`, `HDRLoader` per-channel RLE RGBE, `KTX2Loader`, `STLLoader`, `PLYLoader`, `TGALoader`, `MTLLoader`, `EXRLoader`, `TextureLoader`, `DracoDecoder`) + 4 exporters (`OBJExporter`, `GLTFExporter`, `STLExporter`, `PLYExporter`) + `AssetManager` LRU cache + `GLTFExtensionLoader` (DRACO / KTX2 + KHR/EXT extension registry). |
| **Materials** | `StandardMaterial` (PBR), `MeshPhysicalMaterial` (clearcoat / transmission), `MeshBasicMaterial`, `MeshPhongMaterial`, `MeshNormalMaterial`, `ShadowMaterial`, `SpriteMaterial`, `ShaderMaterial` with `onBeforeCompile` GLSL injection, `ShaderChunks/` subdirectory (10 GLSL fragments + `ShaderChunkRegistry` with `#include` resolution) + `ShaderLibrary` (15 predefined shader templates) + `ShaderCompiler` (preprocess + chunk injection + compile + cache) + `ShaderVariant` (keyword variants + LRU cache). Advanced: `AdvancedPBRMaterial` (anisotropy + iridescence + clearcoat + sheen), `SubsurfaceScatteringMaterial` (SSS). Special-purpose: `FurMaterial`, `MatcapMaterial`, `ToonMaterial`, `OutlineMaterial`, `WaterMaterial`, `WireframeMaterial`. |
| **Resource management** | `Assets/` module — `AssetCache` (LRU), `AssetRegistry` (reference counting), `AssetLoader` (async batched). |
| **Serialization** | `Serialization/` module — `SceneSerializer` / `GeometrySerializer` / `MaterialSerializer` round-trip Scene / Geometry / Material ↔ JSON. |
| **Cameras** | `PerspectiveCamera` / `OrthographicCamera` + `CinematicCamera` (shot sequence with `cut` / `fade` / `dolly` / `orbit` transitions, DOF, Perlin shake, timeline import/export) + `CameraRig` (crane / dolly / orbit / fixed modes with damping follow). |
| **Inspection UI** | 9 camera presets (Free / Iso / Front / Back / Side / Top / 1st-person / 3rd-person / Cinematic), real-time material lab, HDRI environments, post-FX toggles, PNG capture, drag-and-drop upload. |
| **Debug tooling** | Physics debug renderer (collider / contact / velocity channels), `EntityGraph` relationship visualizer, profiler family — `Profiler` (CPU/GPU marks) / `FrameProfiler` (FPS aggregation) / `SystemProfiler` (ECS hot systems) / `MemoryTracker` (leak detection) / `GpuProfiler` (timer queries) / `PerformanceReport` (text + JSON) — surfaced through `FrameChart` and `ProfilerHUD`. `ConsoleCommands` editor REPL — register / execute / auto-complete / history / aliases, 25+ preset commands across 8 categories (General / Engine / Scene / Entity / Physics / Rendering / Audio / Debug), backing the `EngineConsole.tsx` UI panel. |
| **Visual scripting** | Blockly block editor with Camera / Animation / Scene / Renderer / Physics / Control categories, bound to the live ECS World via `EcsScriptAPI`, with Tick-callback registration. Complemented by `VisualScriptComponent` (Script-Canvas-style node graph component, inspired by O3DE Script Canvas). |
| **Package format** | `.vreen` ZIP container (manifest + scene + world + embedded assets), `.vreen-delta` incremental diffs, multi-language SDKs, `vreen` CLI for pack / unpack / validate / diff. |
| **Desktop** | Electron 43 + electron-builder producing a single-file portable Windows `.exe`. |
| **i18n** | First-class zh / en / ja / ko / es via i18next; all user-facing strings flow through translation keys. |
| **Audio** | `AudioListener` / `Audio` / `PositionalAudio` / `AudioLoader` / `AudioAnalyser` + `SpatialAudio` (HRTF + distance attenuation + Doppler effect). |
| **Terrain** | `TerrainGeometry` / `HeightmapGenerator` / `TerrainSplat` / `TerrainLayer` + `TerrainErosion` (thermal / hydraulic / wind erosion). |
| **AI** | `NavMesh` + `PathFinder` (A*) + `SteeringBehavior` (Reynolds) + `Agent` + `BehaviorTree` / `BTNode` / `BTAction` / `BTComposite` / `BTCondition` / `BTDecorator` + `Blackboard` + `CrowdSystem` (large-scale crowd调度 + Reynolds separation) + `SpatialGrid` (2D XZ neighbourhood acceleration). |
| **Network** | `NetworkSync` (server-authoritative) + `Snapshot` (binary serialization) + `NetworkTransport` (WebSocket/Mock) + `NetworkLerp` (interpolation + prediction + reconciliation) + `StateSync` (snapshot interpolation + Delta compression, pure data layer) + `LagCompensation` (server rewind + hit-check, client interpolation) + `NetworkSession` (lobby / loading / playing / paused / ended state machine, host-authoritative, slot management). |
| **Geometries** | 15 primitives (Box / Sphere / Cylinder / Cone / Torus / Plane / Circle / Ring / Capsule / TorusKnot / Lathe / Extrude / Shape / Wireframe / Edges) + `InstancedGeometry` (instanced geometry, modeled after three.js `InstancedBufferGeometry`). |
| **PCG** | Procedural Content Generation — `NoiseGenerator` (Perlin / Simplex / Worley / FBM), `BuildingGenerator`, `BuildingGenerator2` (5 styles + 4 roofs + decorations + interior), `CityGenerator`, `DungeonGenerator` (BSP / random walk), `TreeGenerator` (L-system), `RoadGenerator` (Catmull-Rom spline + terrain follow + intersections), `CharacterGenerator` (5 races + 4 body types + clothing + simplified Skeleton). |
| **Pipeline** | Asset pipeline — `AssetPipeline` (step sequence), `TextureProcessor` (resize / compress / mipmap), `GeometryProcessor` (merge / optimize / weld / LOD), `ImportPipeline` (load → parse → optimize → register). |
| **Gameplay** | RPG gameplay primitives — `DialogueSystem` + `DialogueTree` + `DialogueParticipant` (NPC dialogue with options / conditions), `QuestSystem` (objectives / prerequisites / state machine), `InventorySystem` (stackable items / currency / slots). |
| **VR/XR** | `VRController` — WebXR VR/XR support (headset pose + dual-eye view params + hand-controller tracking), graceful degradation in non-WebXR environments. Complementary to `OrbitControls` (non-immersive) — the two are mutually exclusive. |
| **Editor UI** | Cyberpunk-themed editor components under `src/components/editor/` — `SceneHierarchy`, `InspectorPanel`, `EngineConsole`, `AssetBrowser`, `MaterialEditor`, `LevelEditor`, `AnimationEditor`, `ParticleEditor`. Plus `EngineModulesPanel` (all 34 engine modules catalog) and `PerformanceMonitor` (FPS / frame-time / memory / draw-call SVG charts) under `src/components/viewer/`. |

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
│   ├── engine/                 # Self-developed WebGL2 engine (mirrored to packages/engine/src) — 34 top-level modules, 411 source files (non-test) + 270 test files
│   │   ├── Core/               # Scene graph primitives + Sprite/Text/BitmapText/TextAtlas + texture family (Cube/Data/DataArray/Depth/Video/Canvas/Compressed) + Source + MorphTargets/MorphTargetAnimation + InstancedBufferAttribute + Fog/FogExp2 + Raycaster + DirtyFlag/SceneGraphProcessor/FrustumCuller/SceneStats + ModuleRegistry (Gem-style module registry)
│   │   ├── Math/               # Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Ray, Line3, Triangle, Frustum, MathUtils
│   │   ├── Cameras/            # Perspective / Orthographic cameras + CinematicCamera (shot sequence) + CameraRig (crane/dolly/orbit/fixed)
│   │   ├── Controls/           # Orbit / Fly / PointerLock / Map controls + CharacterController (kinematic) + VRController (WebXR VR/XR support)
│   │   ├── Lights/             # Ambient / Directional / Point / Spot / Hemisphere / RectArea + ShadowMapManager
│   │   ├── Geometries/         # Box / Sphere / Cylinder / Cone / Torus / Plane / Circle / Ring / Capsule / TorusKnot / Lathe / Extrude / Shape / Wireframe / Edges + InstancedGeometry
│   │   ├── Materials/          # Standard / Physical / Basic / Phong / Normal / Shadow / Sprite materials + ShaderMaterial + ShaderChunks/ subdirectory (10 GLSL fragments + ShaderChunkRegistry) + ShaderLibrary (15 templates) + ShaderCompiler (#include + cache) + ShaderVariant (keyword variants + LRU cache) + AdvancedPBRMaterial (anisotropy + iridescence + clearcoat + sheen) + SubsurfaceScatteringMaterial (SSS) + onBeforeCompile + special: Fur / Matcap / Toon / Outline / Water / Wireframe
│   │   ├── Renderer/           # WebGL2Renderer, ShaderProgram, RenderPass, ShadowMapManager + MRTTarget / GBuffer (deferred) + DeferredRenderer alternative + ForwardPlusRenderer (tiled light culling) + ReflectionProbe / ReflectionProbeManager + GlobalIllumination (lightprobes SH2 + VXGI) + GPUDrivenRenderer (indirect draw) + RenderGraph (Frostbite FrameGraph-style) + RenderPipelineManager (Forward/Deferred/Forward+ orchestrator + quality levels) + ContactShadowsPass + GTAOPass + post-FX (basic: SSAO / FXAA / ToneMapping / Gamma / DOF; enhanced PostProcess/: ColorGrading / LUT / FilmGrain / Afterimage / Pixelation; advanced: AutoExposure / DOFEnhanced / GTAO / MotionBlur / SSR / SSSS / TAA / Velocity / VolumetricFog) + PathTracer
│   │   ├── Loaders/            # GLB / OBJ / FBX / HDR / KTX2 / STL / PLY / TGA / MTL / EXR / Draco / AssetManager + 4 exporters (OBJ / GLTF / STL / PLY) + GLTFExtensionLoader (DRACO/KTX2 + KHR/EXT extension registry)
│   │   ├── Animation/          # Clips, Mixer, StateMachine, BlendSpace1D, Humanoid + layers / masks / additive blend + IK (FABRIK / CCD / IKHumanoid) + IKSystem (high-level scene-graph IK driver) + ProceduralAnimation (gait/breathing/head-track/secondary motion)
│   │   ├── ECS/                # World, ComponentType, Systems, Physics, Prefab, QueryBuilder + Constraint subsystem
│   │   ├── Physics/            # PhysicsDemo + ConstraintSolver + Joint constraints (Ball/Hinge/Slider/Fixed/Distance) + ConstraintSystem (runtime constraint config + breakable) + CollisionSystem (BVH/SAT/GJK/EPA pipeline) + ClothSimulation (Verlet) + RopePhysics (Verlet chain) + FluidSimulation (SPH) + DestructionSystem + VoronoiFracture
│   │   ├── Helpers/            # Grid / Grid3D / Axes / Box / Camera / Arrow helpers + PhysicsDebugRenderer
│   │   ├── Audio/              # AudioListener / PositionalAudio / Audio / AudioLoader / AudioAnalyser + SpatialAudio (HRTF + distance attenuation + Doppler) + AudioEffects (offline DSP chain: reverb/echo/chorus/distortion/compressor)
│   │   ├── Terrain/            # TerrainGeometry / HeightmapGenerator / TerrainSplat / TerrainLayer + TerrainErosion (thermal/hydraulic/wind)
│   │   ├── Acceleration/       # BVH / BVHBuilder / MeshBVH
│   │   ├── Assets/             # AssetCache (LRU) / AssetRegistry (ref-counting) / AssetLoader (async) — resource lifecycle + AssetBundle (pack/load) + TextureStreaming (mipmap streaming)
│   │   ├── Serialization/      # SerializerRegistry / GeometrySerializer / MaterialSerializer / SceneSerializer — Scene/Geometry/Material ↔ JSON
│   │   ├── Events/             # EventBus / EventQueue / GameEvent (typed pub/sub)
│   │   ├── Scripting/          # ScriptComponent / ScriptSystem / ScriptRegistry / CoroutineSystem + VisualScriptComponent (Script Canvas-style node graph)
│   │   ├── Particles/          # ParticleSystem2 / ParticleEmitter / ParticleModifier / ParticleCurve / TrailModule
│   │   ├── Network/            # NetworkSync / Snapshot / NetworkTransport (WebSocket/Mock) / NetworkLerp — server-authoritative sync + StateSync (snapshot interpolation + Delta compression) + LagCompensation (rewind + hit-check) + NetworkSession (lobby/playing state machine)
│   │   ├── SaveSystem/         # SaveSystem (multi-slot + auto-save) / SaveSerializer / LocalStorageAdapter
│   │   ├── SceneManager/       # SceneManager / SceneTransition (Fade/Crossfade/Slide/Wipe/None) + SceneStreaming (chunked streaming load/unload)
│   │   ├── Input/              # InputManager / KeyboardState / MouseState / TouchState / GamepadState / InputAction / InputMap
│   │   ├── Tools/              # Profiler / FrameProfiler / SystemProfiler / MemoryTracker / GpuProfiler / PerformanceReport + LODManager (distance/screen-space LOD + HLOD) + Profiler2 (frame/zone/event + Chrome Trace export) + ConsoleCommands (editor REPL: register/execute/auto-complete/history/aliases + 25+ preset commands across 8 categories)
│   │   ├── AI/                 # NavMesh (navigation mesh) + PathFinder (A*) + SteeringBehavior (Reynolds) + Agent + BehaviorTree + Blackboard + CrowdSystem (large-scale crowd + Reynolds separation) + SpatialGrid (2D XZ neighbourhood acceleration)
│   │   ├── Environment/        # WeatherSystem + SkySystem (day/night) + ProceduralSky (Preetham atmosphere) + CloudSystem + VolumetricClouds (ray-march + 3D noise) + PrecipitationSystem + VegetationSystem + VegetationRenderer (instanced + wind + season) + WaterSimulation + WaterSystem
│   │   ├── Timeline/           # TimelineClip + TimelineTrack + EventTrack + PropertyTrack + TimelineSequencer (play/pause/seek/loop/export/import)
│   │   ├── Voxel/              # VoxelChunk 16³ + VoxelWorld (multi-chunk) + VoxelMesher (greedy meshing) + VoxelRaycaster (DDA) + VoxelPalette
│   │   ├── Editor/             # SelectionSystem (pick/select/hover) + TransformGizmo (translate/rotate/scale) + UndoRedoSystem (with beginGroup/endGroup) + EditorCommands (Move/Rotate/Scale/Add/Remove/Property) + SnapSystem (grid/angle/scale snap)
│   │   ├── PCG/                # Procedural Content Generation — NoiseGenerator (Perlin/Simplex/Worley/FBM) + BuildingGenerator + BuildingGenerator2 (5 styles + 4 roofs + decorations) + CityGenerator + DungeonGenerator + TreeGenerator + RoadGenerator (Catmull-Rom spline + terrain follow) + CharacterGenerator (5 races + 4 body types + simplified skeleton)
│   │   ├── Pipeline/           # Asset pipeline — AssetPipeline (step sequence) + TextureProcessor + GeometryProcessor + ImportPipeline
│   │   ├── Gameplay/           # RPG gameplay — DialogueSystem + DialogueTree + DialogueParticipant + QuestSystem + InventorySystem
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
| `EngineFeaturesPanel.tsx` | Engine feature toggle panel — exposes 8 runtime subsystems (physics, IK, particles, post-FX, etc.) as on/off switches. |
| `EngineModulesPanel.tsx` | Engine modules catalog — lists all 34 top-level engine modules grouped by category (rendering / scene / animation / physics / architecture / gameplay / profiling / UI), each card expandable to show core classes + descriptions. Pairs with `EngineFeaturesPanel` (the former shows all modules for inspection; the latter exposes the switchable subset). |
| `PerformanceMonitor.tsx` | Real-time performance panel — 4 stat cards (FPS / frame-time / memory / draw-calls) + SVG sparkline charts fed by `profilerStore` history. Complements `ProfilerHUD` (which is a floating overlay with tab-based CPU/GPU/System/Draws views); `PerformanceMonitor` is a panel-style component focused on the 4 core metrics with trend charts. |

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
| `ModuleRegistry` | **Gem-style engine module registry** (inspired by [O3DE Gems](https://github.com/o3de/o3de/tree/development/Gems)). Each `EngineModule` declares `name` / `version` / `description` / `dependencies` plus `onLoad` / `onUnload` lifecycle callbacks (analogous to a Gem's `Activate` / `Deactivate`). `registerModule` / `loadModule` / `unloadModule` manage the dependency graph — `loadModule` recursively loads unmet dependencies first and refuses to unload a module still depended on by another loaded module. `exportManifest` / `importManifest` serialize the active module set to / from JSON (analogous to a project's active-Gem list). `getDefaultModuleRegistry()` provides a process-wide singleton. Complements `Assets/AssetRegistry` (resource lifecycle) — the two are orthogonal and composable. |
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
| Post-processing passes (advanced, `PostProcess/`) | `AutoExposurePass` (luminance-based auto exposure), `DOFEnhancedPass` (bokeh + circle-of-confusion), `GTAOPass` (ground-truth AO), `MotionBlurPass` (consumes `VelocityPass`), `SSRPass` (screen-space reflections), `SSSSPass` (screen-space subsurface scattering), `TAAPass` (temporal AA, needs `VelocityPass`), `VelocityPass` (per-pixel motion vectors), `VolumetricFogPass` (volumetric fog / light shafts). All implement the `RenderPass` interface. |
| `DeferredRenderer` | Alternative deferred-rendering backend — G-Buffer pass (4 attachments: position / normal / albedo / material) → fullscreen lighting pass. Light count decoupled from fragment work; suitable for many-light scenes. Trade-offs: no native transparency, no native MSAA, fixed material attribute set. |
| `ReflectionProbe` / `ReflectionProbeManager` | Local IBL probes — `ReflectionProbe` captures a cube-map snapshot at a position with a bounding range; `ReflectionProbeManager` registers probes, finds the camera-position-weighted active probe, and blends between probes for smooth transitions. |
| `GlobalIllumination` | Global illumination system with two modes: `'lightprobes'` (second-order spherical harmonics SH2, 9 coefficients × RGB = 27 floats per probe, baked irradiance at sampled positions) and `'vxgi'` (simplified voxel global illumination — scene voxelized into a 3D texture for fragment sampling; v1 holds the data structure only, voxelization is caller-supplied). Supplements the PBR pipeline's ambient / indirect light. |
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
| `ShaderLibrary` | Predefined shader template library — 15 built-in shader templates (unlit / lambert / blinn-phong / PBR / normal / depth / shadow / sprite / fur / matcap / toon / outline / water / wireframe / fullscreen-quad) keyed by name. `getTemplate(name)` returns a `ShaderTemplate` with vertex/fragment source + uniform descriptors; `registerTemplate` allows user extension. Eliminates boilerplate for common shading tasks. |
| `ShaderCompiler` | Shader compiler — preprocesses GLSL source (`#include <name>` resolution via `ShaderChunkRegistry`), injects `ShaderChunk` fragments, compiles vertex + fragment shaders via `WebGL2RenderingContext`, links a `WebGLProgram`, and caches the compiled program by source hash. `compile(gl, vertexSrc, fragmentSrc)` returns a cached `ShaderProgram`; `clearCache()` evicts entries. Pairs with `ShaderLibrary` for one-shot template → program compilation. |
| `FurMaterial` | Shell-based fur / hair material — vertex displacement along `a_normal` by `shellLayer * furLength` + gravity / wind offset; fragment discard by density threshold + root occlusion. Pairs with `FurShell`. |
| `MatcapMaterial` | Material Capture — pre-baked sphere normal→color texture, no lighting; popular in 3D sculpting tools. |
| `ToonMaterial` | Cel-shaded cartoon material — quantises N·L into discrete bands. Pair with `OutlineMaterial` for anime-style outlines. |
| `OutlineMaterial` | Back-side outline pass — extrudes vertices along normals with flat color; drawn before the front-pass material. |
| `WaterMaterial` | Animated water surface — Gerstner waves + sun glint + refraction approximation + depth-based foam. Pairs with `WaterSystem`. |
| `WireframeMaterial` | Stylised wireframe — coloured triangle edges with optional depth-fade, distinct from `wireframe: true` on a standard material. |
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

| Export | Purpose |
|--------|---------|
| `CinematicCamera` | Cinematic-grade camera driving a `PerspectiveCamera` through a shot sequence (`CameraShot[]` — position / lookAt / fov / duration / transition). Four transition types: `cut` (hard), `fade`, `dolly` (smoothstep), `orbit` (half-revolution around lookAt during transition). DOF fields (`dofEnabled` / `focusDistance` / `aperture` / `focalLength`) feed downstream DOF passes; Perlin-style `shake` adds noise to position/orientation with `shakeDuration` decay. `exportTimeline()` / `importTimeline()` round-trip JSON. Complements `CameraRig` (sequence-driven vs. follow-driven). |
| `CameraRig` | Camera jib / dolly system that follows an `Object3D` target in real time. Four motion modes: `crane` (jib, camera hoisted above target by `height`, swing around vertical axis), `dolly` (track, constant-speed XZ translation), `orbit` (revolve around target at `radius` with angular `speed`), `fixed` (static offset). `damping` controls position-follow smoothness (0 = instant, larger = smoother). Always `lookAt` target + `lookAtOffset`. Unlike `OrbitControls` (user-input driven, interactive), `CameraRig` drives the camera by preset rules (cinematic / cutscene). Composable with `CinematicCamera` (Rig follows the protagonist, Cinematic takes the Rig's camera for shot switching). |

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
| `GLTFExtensionLoader` | Enhanced GLTF loader built on top of `GLBLoader` (modeled after three.js `GLTFLoader`). Adds an extension registry (`registerExtension` accepts `KHR_*` / `EXT_*` handlers), DRACO decoder injection (`setDRACODecoder`), and KTX2 decoder injection (`setKTX2Decoder`). Each registered extension's `beforeRoot` / `afterRoot` / `mesh` / `material` / `texture` / `node` hooks are dispatched during parsing, enabling custom mesh / material / texture / node handling without forking the core loader. |

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
| `IKSystem` | High-level inverse kinematics system that drives scene-graph `Object3D[]` joint chains directly (reads / writes node `position` / `rotation`). Built-in solvers: FABRIK (position-space, fast convergence, supports `poleTarget` for bend direction) and CCD (rotation-space, naturally compatible with rotation constraints). Supports `IKConstraint` hinge-joint constraints (axis + angle range). Complements the `Animation/IK/` sub-module (which uses a self-contained `IKBone` class independent of the scene graph); `IKSystem` is the right choice when integrating IK into an existing scene-graph hierarchy. |

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
| `InstancedGeometry` | Instanced geometry wrapper (modeled after three.js `InstancedBufferGeometry`) — binds a base `BufferGeometry` plus per-instance attributes (`instanceMatrix` / `instanceColor` / custom). `setInstanceCount(n)` controls draw count; `setMatrixAt(i, m)` / `getMatrixAt(i)` mutate the instance matrix buffer. Renderer draws via `gl.drawElementsInstanced`. Pairs with `InstancedMesh` for vegetation / crowds / repeated props. |

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
| `SpatialAudio` | 3D spatial audio extension — HRTF (Head-Related Transfer Function) panning model for realistic directional audio, distance attenuation (linear / inverse / exponential models), and Doppler effect (pitch shift based on relative velocity between source and listener). Builds on `PositionalAudio` with a richer spatialization model; suitable for FPS / VR scenarios where accurate audio localization matters. |

### Terrain (`src/engine/Terrain/`)

Procedural terrain system for outdoor scenes.

| Export | Purpose |
|--------|---------|
| `TerrainGeometry` | Height-field mesh — `width × height` quads with per-vertex elevation. |
| `HeightmapGenerator` | Procedural heightmap generators — fractal noise, ridged, hydraulic erosion. |
| `TerrainSplat` | Splat-map based texture blending — up to N layers with alpha masks. |
| `TerrainLayer` | Per-layer metadata (albedo texture, normal texture, tiling, metallic / roughness). |
| `TerrainErosion` | Terrain erosion simulator — three erosion algorithms: **thermal** (gravity-driven material redistribution on steep slopes, produces talus aprons), **hydraulic** (water-drop simulation — rain drops flow downhill carrying sediment, depositing on gentle slopes, carves realistic river valleys), **wind** (Aeolian erosion — wind transports sediment with preferential deposition in wind shadows). Each algorithm reads / writes a heightmap `Float32Array` and is configurable (iteration count, erosion strength, deposition rate). Decoupled from `TerrainGeometry` — output heightmap is fed back via `TerrainGeometry.setHeightAt`. |

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
| `ConsoleCommands` | **Editor console command system** — REPL-style text command registry backing the `EngineConsole.tsx` UI panel. Each `ConsoleCommand` declares `name` / `description` / `usage` / `args` (typed: `string` / `number` / `boolean` / `vector3`) / `handler` / `category`. `execute(input)` tokenizes (supporting double-quoted args with `\"` escapes for JSON), validates args, dispatches to the handler, and catches throws → `"Error: <msg>"`. Supports aliases (`registerAlias`), history (`addToHistory` / `getHistory`, `maxHistory` capped), auto-complete (`getAutoComplete` — prefix match over names + aliases), and grouped help (`getHelp`). `registerAllDefaultCommands(world?, scene?)` is idempotent and registers 25+ preset commands across 8 categories: **General** (`help` / `clear` / `history` + `?` / `cls` / `h` aliases), **Engine** (`engine.info` / `engine.commands` / `engine.categories`), **Scene** (`scene.load` / `scene.save` / `scene.list` + `ls` alias, delegates `SceneSerializer`), **Entity** (`entity.create` / `entity.delete` / `entity.list` / `entity.count`, delegates `World`), **Physics** (`physics.gravity` / `physics.pause` / `physics.resume` + `pause` / `resume` aliases), **Rendering** (`render.pipeline` / `render.quality` / `render.screenshot` + `ss` alias), **Audio** (`audio.volume` / `audio.play` / `audio.stop`), **Debug** (`debug.stats` / `debug.fps` / `debug.profile` / `debug.systems` / `debug.memory`, delegates `FrameProfiler` / `SystemProfiler` / `MemoryTracker`). Dependency injection via `setWorld` / `setScene` / `setFrameProfiler` / `setSystemProfiler` / `setMemoryTracker`. `getDefaultConsoleCommands()` / `resetDefaultConsoleCommands()` manage a process-wide singleton. Complements `Editor/EditorCommands` (undo/redo factory) and `Scripting/ScriptBindings` (Blockly API surface) — see `ConsoleCommands.test.ts` for full coverage. |

### Events (`src/engine/Events/`)

Lightweight pub/sub event bus decoupling game logic from systems.

| Export | Purpose |
|--------|---------|
| `EventBus` | Synchronous topic-based dispatcher — `on(topic, listener)` / `off(topic, listener)` / `emit(topic, payload)`. Listener removal by reference. |
| `EventQueue` | Buffered FIFO queue for deferred dispatch — `enqueue(event)` / `drain()` flushes all pending events in order. Used by systems that must defer side effects until safe points in the frame. |
| `GameEvent` | Discriminated union of typed events: `CollisionEvent`, `TriggerEvent`, `SpawnEvent`, `DestroyEvent`, `ScoreEvent`, `CustomEvent`. Each carries a typed `data` payload. |

### Scripting (`src/engine/Scripting/`)

Code-driven scripting layer (lifecycle `ScriptComponent`) plus a data-driven visual scripting graph (`VisualScriptComponent`), complementing the Blockly block editor.

| Export | Purpose |
|--------|---------|
| `ScriptComponent` | ECS component holding a script instance + lifecycle hooks (`onCreate` / `onUpdate` / `onDestroy` / `onCollision` / `onTrigger`). Registered as `ScriptC` ComponentType. Code-driven, non-POJO, not serialized into `.vreen`. |
| `VisualScriptComponent` | **Script-Canvas-style visual scripting component** (inspired by [O3DE Script Canvas](https://github.com/o3de/o3de/tree/development/Gems/ScriptCanvas)). Holds a `scriptGraph` of `ScriptNode`s (`event` / `action` / `condition` / `variable` / `function` types) wired together through `ScriptPin` connections. `start()` / `stop()` / `update(dt)` fire named events; `handleEvent(name, args)` walks the exec-output chain from each matching `event` node, executing `function` nodes (calling `registerFunction` callbacks), `variable` nodes (get/set shared `variables`), `condition` nodes (routing to `true` / `false` branch pins), and `action` nodes (custom `data.handler`). Cycle-guarded. `exportGraph()` / `importGraph()` round-trip the graph as JSON — data-driven, serializes into `.vreen`. Complements the code-driven `ScriptComponent` (the former for non-programmers, the latter for complex logic). |
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

### Network (`src/engine/Network/`)

Server-authoritative network synchronisation foundation. Decoupled from the ECS `World` — reads / writes `Transform`-like state via the `NetworkEntity` handle, so it can layer on top of any entity system.

| Export | Purpose |
|--------|---------|
| `NetworkTransport` | Transport contract (`send` / `onMessage` / `connect` / `close`). Built-in implementations: `WebSocketTransport` (browser) and `MockTransport` (in-process loopback for tests). |
| `Snapshot` | Binary snapshot serialisation — packs per-entity transform + component state into a compact buffer with optional compression. The wire format is versioned for forward compatibility. |
| `NetworkLerp` | Client-side interpolation / prediction / reconciliation. Buffers snapshots, interpolates remote entity positions / rotations, and reconciles local prediction errors when a server snapshot arrives. |
| `NetworkSync` | Top-level sync manager. `createNetworkEntity` registers an entity for synchronisation; `update(dt)` ticks snapshot send (server) / receive + interpolate (client). `NetworkSyncOptions` configures send rate, interpolation delay, and ownership. |
| `StateSync` | Pure-data-layer state synchronisation — snapshot interpolation (buffered remote state sampled at a configurable render delay) + Delta compression (only changed fields are transmitted, reducing bandwidth). Decoupled from any transport implementation: the caller wires `StateSync` to a `NetworkTransport` and feeds received snapshots in. Complements the higher-level `NetworkSync` (which owns the entity lifecycle) — `StateSync` is the reusable data layer that `NetworkSync` is built on, and can be used standalone for custom sync schemes. |

### AI (`src/engine/AI/`)

AI navigation + behavior-tree subsystem for game agents.

| Export | Purpose |
|--------|---------|
| `NavMesh` | Navigation mesh — built from a `BufferGeometry` or convex polygon set; produces a walkable surface graph with polygon clustering and boundary extraction. |
| `PathFinder` | A* pathfinding over a `NavMesh` graph. `findPath(start, end)` returns a `Vector3[]` waypoint list. Supports heuristic tuning and path smoothing. |
| `SteeringBehavior` | Reynolds steering behaviors — Seek / Flee / Arrive / Wander / Pursue / Evade / ObstacleAvoidance / PathFollowing / Separation / Alignment / Cohesion / Flocking. Composable into a steering pipeline. |
| `Agent` | AI agent combining `PathFinder` + `SteeringBehavior`. Holds target / path / velocity / maxSpeed / steeringForce; `update(dt)` advances locomotion. |
| `BehaviorTree` | Tree-shaped decision structure — root node evaluated each tick, returns `Success` / `Failure` / `Running`. Complements navigation (which solves "how to move") by deciding "what to do". |
| `BTNode` / `BTAction` / `BTComposite` / `BTCondition` / `BTDecorator` | Behavior-tree node taxonomy: `BTAction` (execute), `BTComposite` (Sequence / Selector / Parallel), `BTCondition` (predicate), `BTDecorator` (Inverter / Repeater / RetryUntilSuccess). |
| `Blackboard` | Shared key-value store (any typed value) read/written by BT nodes — decouples node-to-node data flow. Supports `get` / `set` / `has` / `unset` + change listeners. |
| `CrowdSystem` | Large-scale crowd simulation — schedules many `Agent`s with Reynolds **separation** steering (local avoidance between nearby agents), NavMesh-based pathfinding, and per-agent path-cache throttling (re-path only every N frames or on target move). Supports agent radius / max speed / avoidance radius. Scales to hundreds of agents by reusing one `NavMesh` and amortizing pathfinding cost. Complements single-agent `Agent` + `SteeringBehavior` (which lacks local avoidance). |
| `SpatialGrid` | 2D (XZ-plane) uniform spatial hash grid for neighbourhood queries. `insert(id, x, z)` / `remove(id)` / `update(id, x, z)` maintain the cell buckets; `query(x, z)` returns ids in the same cell; `queryRadius(x, z, r)` returns ids within a circular range. Cell size is configurable (default 1). Used by `CrowdSystem` for O(1) neighbour lookup instead of O(n²) all-pairs scans; also reusable for broadphase collision culling and proximity triggers. |

### Environment (`src/engine/Environment/`)

Atmospheric, weather, vegetation, and water systems for outdoor scenes.

| Export | Purpose |
|--------|---------|
| `WeatherSystem` | Weather state machine (Clear / Cloudy / Rain / Snow / Storm) with transition interpolation and fog联动. |
| `SkySystem` | Procedural sky + day/night cycle — sun position computed from time-of-day, atmospheric scattering approximation, gradient sky dome. |
| `CloudSystem` | Procedural cloud layer — noise-texture animation with altitude coverage and movement direction. |
| `PrecipitationSystem` | Precipitation particles (rain / snow) driven by a particle system with wind influence. |
| `VegetationSystem` + `VegetationType` | Procedural vegetation distribution — samples positions from a density map (terrain + noise), instantiates meshes per `VegetationType` (grass / bush / tree); supports impostor billboards for distant rendering. |
| `WaterSimulation` | Water surface — vertex displacement (Gerstner waves) + normal perturbation + refraction/reflection approximation; `getMeshData()` outputs positions / normals. |
| `WaterSystem` | Scene-level water manager — water level / flow direction / quality params; drives multiple `WaterSimulation` instances and pairs with `WaterMaterial`. Reflects `SkySystem` colors; ripples intensify during `WeatherSystem` rain. |

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

### PCG (`src/engine/PCG/`)

Procedural Content Generation — complements `Terrain/` (height fields) and `Geometries/` (analytic primitives) by generating "content" (buildings, cities, dungeons, vegetation) as `BufferGeometry` + layout metadata. Does not bind `Material` or `Scene`.

| Export | Purpose |
|--------|---------|
| `NoiseGenerator` | Noise sampling with 4 algorithms: `Perlin` (gradient), `Simplex` (improved gradient, no directional artifacts), `Worley` (cellular, suited for terrain partitioning), `FBM` (Fractal Brownian Motion, multi-octave stacking). Unified `noise2D(x, y)` / `noise3D(x, y, z)` API; configurable seed / lacunarity / persistence. |
| `BuildingGenerator` | Procedural building — floors + window grid + roof composed into a merged `BufferGeometry`. Configurable width / height / floorCount / windowDensity. |
| `CityGenerator` | City layout — grid + noise perturbation produces block / road / lot metadata, outputting a `CityLayout` (lot coordinate list). Callers instantiate `BuildingGenerator` per lot. |
| `DungeonGenerator` | Dungeon generation — BSP (binary space partition) or random-walk rooms + corridor connections. Outputs room rectangles + corridor segments; configurable minRoomSize / maxRooms / density. |
| `TreeGenerator` | Procedural trees — L-system style recursive branching + leaf point cloud. Outputs trunk `BufferGeometry` + leaf `MeshData`; configurable maxDepth / branchAngle / leafCount. |

### Pipeline (`src/engine/Pipeline/`)

Asset pipeline — complements `Loaders/AssetManager` (which focus on parsing) by orchestrating multi-step processing (conversion / compression / optimization) at import time. Pipeline steps may invoke Loaders internally.

| Export | Purpose |
|--------|---------|
| `AssetPipeline` | Sequential step pipeline — holds a serialized `PipelineStep[]`; each step's `process(asset)` consumes and produces an `AssetArtifact`. Supports `addStep` / `removeStep` / `run(asset)` batch execution; each step declares `accepts(predicate)` to opt in/out. |
| `TextureProcessor` | Texture processing — `resize(w, h)` / `compress(format)` / `generateMipmaps()` / `flipY()` / `convertFormat(targetFormat)`. Outputs the processed `Texture` (in-place or new instance, configurable). |
| `GeometryProcessor` | Geometry processing — `merge(geometries)` / `optimize(geometry)` (vertex dedup + index reorder) / `computeNormals()` / `generateLOD(levels)` / `weld(epsilon)` (vertex welding). Outputs `BufferGeometry`. |
| `ImportPipeline` | Model import — wraps the full "load → parse → optimize → register" flow, internally delegating to `GLBLoader` / `FBXLoader` etc. + `GeometryProcessor` / `TextureProcessor`. Outputs `ImportResult { scene, materials, animations, metadata }`. |

### Gameplay (`src/engine/Gameplay/`)

RPG gameplay primitives — complements `Events/` (generic pub/sub) and `Scripting/` (lifecycle hooks) with higher-level dialogue / quest / inventory systems. Combined with `Scripting/` you can build complete NPC-driven RPG gameplay.

| Export | Purpose |
|--------|---------|
| `DialogueSystem` | Dialogue state machine — `start(dialogueId, participantId)` / `advance()` / `chooseOption(idx)` / `end()` / `isActive()` / `getCurrentNode()` / `getOptions()` / `getHistory()`. Holds `currentDialogue` + `dialogueHistory` + `participants: Map<id, DialogueParticipant>`. Dispatches `dialogue:start` / `dialogue:advance` / `dialogue:choose` / `dialogue:end` events through `EventBus`. |
| `DialogueTree` | Dialogue tree — `nodes: Map<id, DialogueNode>` + `rootId` + `entryId`. `DialogueNode { id, speaker, text, options, condition?, action?, nextId? }`, `DialogueOption { text, nextId, condition?, action? }`. `addNode` / `getNode` / `getRoot` / `getOptions` / `loadFromJSON(json)` / `saveToJSON()`. `condition` is an optional runtime predicate (not serialized). |
| `DialogueParticipant` | Dialogue participant — `id` / `name` / `portrait` / `mood` / `voice`; `setMood(mood)` / `setVoice(voiceId)` for runtime expression / voice switching. |
| `QuestSystem` | Quest state machine — `quests: Map<id, Quest>` + `activeQuests: Set<id>` + `completedQuests: Set<id>`. `Quest { id, title, description, objectives, rewards, state, prerequisites }`; `QuestObjective { id, description, type, target, count, current, completed }`. `startQuest` / `completeObjective` / `abandonQuest` / `progressObjective(questId, objId, amount)` / `canStartQuest` (checks prerequisites). Dispatches `quest:started` / `quest:completed` / `quest:objective` events. |
| `InventorySystem` | Inventory — `items: Map<id, InventoryItem>` + `maxSlots` + `currency`. `InventoryItem { id, name, count, type, data, stackable }`. `addItem` / `removeItem(id, count)` / `getItem` / `hasItem(id, count?)` / `swap(a, b)` / `getItems` / `getCurrency` / `addCurrency` / `spendCurrency`. Stackable items auto-merge; returns `false` when `maxSlots` exceeded. |

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

Unit tests cover the engine foundation (6100+ tests across 270 test files, 34 top-level modules):

| Area | Test files |
|------|-----------|
| Math | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Box3`, `Sphere`, `Plane`, `Ray`, `Line3`, `Triangle`, `Frustum`, `Color` |
| Core | `InstancedMesh`, `LOD`, `InstancedBufferAttribute`, `Sprite`, `TextAtlas`, `MorphTargets`, `CubeTexture`, `DataTexture`, `DataArrayTexture`, `DepthTexture`, `VideoTexture`, `CanvasTexture`, `CompressedTexture`, `Source`, `Fog`, `FogExp2`, `Raycaster`, `FrustumCuller`, `SceneGraphProcessor`, `SceneStats`, `ModuleRegistry`, `FurShell` |
| Geometries | `Box`, `Sphere`, `Plane`, `Cylinder`, `Cone`, `Capsule`, `Circle`, `Ring`, `Torus`, `TorusKnot`, `Lathe`, `Extrude`, `Shape`, `Wireframe`, `Edges` |
| ECS | `World`, `Prefab`, `QueryBuilder`, `Broadphase`, `PhysicsSystems`, `PhysicsBenchmark` |
| Animation | `Animation`, `AnimationEvents`, `BlendSpace1D`, `AnimationLayer`, `AvatarMask`, `BoneMask`, `AdditiveBlend`, `IKBone`, `IKChain`, `IKSolver`, `CCDSolver`, `IKSystem`, `ProceduralAnimation` |
| Loaders | `GLBLoader`, `HDRLoader`, `FBXLoader`, `KTX2Loader`, `STLLoader`, `PLYLoader`, `TGALoader`, `AssetManager`, `OBJExporter`, `GLTFExporter`, `STLExporter`, `PLYExporter` |
| Renderer | `Renderer`, `RenderPass`, `ShadowMapManager`, `MRTTarget`, `GBuffer`, `PostProcessPasses`, `PathTracer`, `DeferredRenderer`, `ReflectionProbe`, `ReflectionProbeManager`, `GlobalIllumination`, `ForwardPlusRenderer`, `RenderGraph`, `RenderPipelineManager`, `GPUDrivenRenderer`, `ContactShadowsPass`, `GTAOPass`, `AutoExposurePass`, `DOFEnhancedPass`, `MotionBlurPass`, `SSRPass`, `SSSSPass`, `TAAPass`, `VelocityPass`, `VolumetricFogPass` |
| Lights | `AmbientLight`, `DirectionalLight`, `PointLight`, `SpotLight`, `HemisphereLight`, `RectAreaLight` |
| Materials | `MeshBasicMaterial`, `MeshNormalMaterial`, `MeshPhongMaterial`, `MeshPhysicalMaterial`, `ShadowMaterial`, `SpriteMaterial`, `ShaderChunkRegistry`, `chunks`, `ShaderLibrary`, `ShaderCompiler`, `ShaderVariant`, `AdvancedPBRMaterial`, `SubsurfaceScatteringMaterial`, `FurMaterial`, `MatcapMaterial`, `ToonMaterial`, `OutlineMaterial`, `WaterMaterial`, `WireframeMaterial` |
| Controls | `FlyControls`, `MapControls`, `PointerLockControls`, `CharacterController`, `VRController` |
| Helpers | `AxesHelper`, `BoxHelper`, `CameraHelper`, `ArrowHelper`, `GridHelper3D` |
| Audio | `Audio`, `AudioAnalyser`, `AudioContext`, `AudioListener`, `AudioLoader`, `PositionalAudio`, `SpatialAudio`, `AudioEffects` |
| Terrain | `TerrainGeometry`, `HeightmapGenerator`, `TerrainLayer`, `TerrainSplat`, `TerrainErosion` |
| Acceleration | `BVH`, `MeshBVH` |
| Physics | `ClothSimulation`, `Constraints`, `FluidSimulation`, `DestructionSystem`, `VoronoiFracture`, `CollisionSystem`, `ConstraintSystem`, `RopePhysics`, `Buoyancy`, `FlightPhysics`, `VehiclePhysics`, `PhysicsMaterial` |
| Assets | `AssetCache`, `AssetRegistry`, `AssetLoader`, `AssetBundle`, `TextureStreaming` |
| Serialization | `GeometrySerializer`, `SceneSerializer` |
| Events | `EventBus`, `EventQueue`, `GameEvent` |
| Scripting | `Coroutine`, `ScriptRegistry`, `VisualScriptComponent` |
| Tools | `FrameProfiler`, `SystemProfiler`, `MemoryTracker`, `LODManager`, `Profiler2`, `ConsoleCommands` |
| Particles | `ParticleSystem2`, `ParticleEmitter`, `ParticleModifier`, `ParticleCurve`, `ParticleData`, `TrailModule` |
| Input | `KeyboardState`, `MouseState`, `InputAction`, `InputMap`, `InputManager` |
| AI | `Agent`, `NavMesh`, `PathFinder`, `SteeringBehavior`, `BehaviorTree`, `Blackboard`, `CrowdSystem`, `SpatialGrid` |
| Environment | `SkySystem`, `WeatherSystem`, `VegetationSystem`, `WaterSimulation`, `WaterSystem`, `ProceduralSky`, `VolumetricClouds`, `VegetationRenderer`, `FFTOcean`, `WaterInteraction` |
| Timeline | `TimelineSequencer`, `TimelineTrack`, `EventTrack`, `PropertyTrack` |
| Voxel | `VoxelChunk`, `VoxelWorld`, `VoxelPalette`, `VoxelRaycaster` |
| Editor | `SelectionSystem`, `UndoRedoSystem`, `SnapSystem`, `TransformGizmo`, `EditorCommands` |
| PCG | `NoiseGenerator`, `BuildingGenerator`, `BuildingGenerator2`, `DungeonGenerator`, `TreeGenerator`, `RoadGenerator`, `CharacterGenerator` |
| Pipeline | `AssetPipeline`, `GeometryProcessor`, `TextureProcessor`, `ImportPipeline` |
| Gameplay | `DialogueSystem`, `DialogueTree`, `QuestSystem`, `InventorySystem` |
| Network | `NetworkSync`, `Snapshot`, `NetworkTransport`, `NetworkLerp`, `StateSync`, `LagCompensation`, `NetworkSession` |
| Cameras | `PerspectiveCamera`, `OrthographicCamera`, `CinematicCamera`, `CameraRig` |
| SceneManager | `SceneManager`, `SceneTransition`, `SceneStreaming` |
| SaveSystem | `SaveSystem`, `SaveSerializer`, `LocalStorageAdapter` |
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

> A more detailed comparison (including feature-by-feature breakdowns, design-philosophy contrasts, and target-audience analysis) is maintained in [`docs/SOUP3D_COMPARISON.md`](./docs/SOUP3D_COMPARISON.md).

### VREEN vs soup3D

[soup3D](https://github.com/OrenLiu/soup3D) is a Python + pygame + OpenGL 3D engine designed for beginners. VREEN is built on a different foundation — TypeScript + WebGL2 — targeting professional-grade 3D game development with a complete engine architecture.

| Feature | VREEN | soup3D |
|---|---|---|
| Language | TypeScript (WebGL2) | Python (OpenGL + pygame) |
| Runtime | Browser-native + Electron desktop | Desktop only (pygame) |
| Architecture | Full ECS (Entity-Component-System) | Procedural API |
| Rendering | PBR + IBL + Shadow + Post-processing (23+ passes) + MRT/GBuffer deferred + `DeferredRenderer` alternative backend + `ReflectionProbe`/`ReflectionProbeManager` local IBL + `GlobalIllumination` (SH2 + VXGI) + `PathTracer` CPU reference | Fixed-function + basic shaders |
| Physics | Rigid body + Collision + 5 Joint constraints + ConstraintSolver + Cloth (Verlet) + Fluid (SPH) + Destruction (Voronoi) | None |
| Animation | Clip/Mixer/StateMachine + IK (FABRIK/CCD/Humanoid + IKSystem) + Layer blending + Morph Targets + BlendSpace1D | Basic skeleton |
| Geometry | 15 primitives + InstancedGeometry + Terrain + BVH acceleration | Basic primitives |
| Materials | PBR/Physical/Basic/Phong/Normal/Shadow/Sprite + Shader(onBeforeCompile) + Fur/Matcap/Toon/Outline/Water/Wireframe + ShaderChunks registry + ShaderLibrary + ShaderCompiler | Single material |
| Particles | 7-module system (Emitter/Modifier/Curve/Trail) | None |
| Audio | 3D spatial audio + FFT analyser + SpatialAudio (HRTF + Doppler) | None |
| Text & Sprites | Text/BitmapText/TextAtlas + Sprite (billboard) | None |
| AI Navigation | NavMesh + A* PathFinder + SteeringBehavior + Agent + BehaviorTree + Blackboard + CrowdSystem + SpatialGrid | None |
| Environment | Weather + Sky (day/night) + Clouds + Precipitation + Vegetation + Water | None |
| Timeline | Multi-track Sequencer (Clips/Events/Property keyframes) | None |
| Voxel | VoxelChunk 16³ + VoxelWorld + Greedy meshing + DDA raycast | None |
| Editor | Selection + TransformGizmo + Undo/Redo + Snap | None |
| Serialization | Scene/Geometry/Material ↔ JSON | None |
| SaveSystem | Multi-slot + auto-save + localStorage/memory fallback | None |
| Network | Server-authoritative sync + Snapshot + WebSocket transport + Lerp/Prediction | None |
| Input | Unified keyboard/mouse/touch/gamepad + InputAction + InputMap | None |
| Scripting | ScriptComponent + CoroutineSystem + ScriptRegistry | None |
| Export | GLTF / OBJ / STL / PLY (4 exporters) | None |
| i18n | 5 languages (en/zh/ja/ko/es) | 2 languages (en/zh) |
| Testing | 6100+ unit tests (270 test files, 411 source files non-test, 220K+ LOC, 34 top-level modules) | None |
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

- **[O3DE (Open 3D Engine)](https://github.com/o3de/o3de)** — CES depth, Asset Processor, Script Canvas, EMotionFX, Atom renderer pass system. VREEN's ECS, Blockly scripting, and `RenderPass` abstractions are modeled after O3DE's design. Two recent additions draw directly from O3DE's Gem system: `Core/ModuleRegistry` adapts the [Gem manifest + Activate/Deactivate lifecycle](https://github.com/o3de/o3de/tree/development/Gems) (`EngineModule` mirrors a `gem.json`'s `name` / `version` / `dependencies`, with `onLoad` / `onUnload` standing in for a Gem's C++ Activate / Deactivate); `Scripting/VisualScriptComponent` adapts the [Script Canvas](https://github.com/o3de/o3de/tree/development/Gems/ScriptCanvas) node-graph execution model (`event` / `action` / `condition` / `variable` / `function` node types, exec-pin chaining, branch routing, cycle guard).
- **[Three.js](https://github.com/mrdoob/three.js)** — Renderer abstraction, `NodeMaterial`, loader ecosystem, `InstancedMesh`, frustum culling. The legacy viewer path is built on Three.js + React Three Fiber; the self-developed engine path (`src/engine/Core`) deliberately mirrors Three.js' `Object3D` / `Scene` / `Mesh` / `BufferGeometry` object model so assets and mental models transfer between the two backends.

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
