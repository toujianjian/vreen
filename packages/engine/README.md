# @vreen/engine

> **Self-developed WebGL2 3D engine kernel.** Zero runtime dependencies.
> PBR + IBL + shadow mapping + SSAO + post-processing + GPU skinning +
> Entity-Component-System + fixed-step physics + animation state machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![WebGL 2](https://img.shields.io/badge/WebGL-2-red)](https://www.khronos.org/webgl/)

`@vreen/engine` is the standalone, npm-installable form of the VREEN
engine kernel. It is the strategic core of the
[VREEN project](../../) — a browser-first 3D engine and asset inspection
platform. The engine is developed in-tree at `src/engine/` and mirrored
to `packages/engine/src/` for standalone publishing, so it carries no
dependency on React, Zustand, i18next, or any application code.

---

## Table of Contents

1. [Status](#status)
2. [Install](#install)
3. [Quick Start](#quick-start)
4. [Public API Overview](#public-api-overview)
5. [Engine Module Manifest](#engine-module-manifest)
6. [Render Pipeline](#render-pipeline)
7. [ECS](#ecs)
8. [Animation](#animation)
9. [Loaders](#loaders)
10. [Custom Shaders](#custom-shaders)
11. [Profiling](#profiling)
12. [Logger](#logger)
13. [Compatibility with Three.js](#compatibility-with-threejs)
14. [Build, Package, and Publish](#build-package-and-publish)
15. [Browser Requirements](#browser-requirements)
16. [Limitations](#limitations)
17. [License](#license)

---

## Status

**v0.1.0** — first publishable cut. The source of truth lives at
`src/engine/` in the VREEN web app. This package is a curated
re-packaging with a clean public API surface and a built-in logger (no
dependency on the web app's logger).

> **Note on surface scope.** The in-tree `src/engine/` contains a wider
> set of modules than this package currently re-exports (additional
> math types, `InstancedMesh` / `LOD`, more lights, the `RenderPass`
> abstraction, more geometries). The package surface is curated to
> stable, documented API. As in-tree modules stabilize and gain test
> coverage, they are mirrored in via `npm run engine:sync`. See
> [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the full in-tree
> module map.

---

## Install

```sh
# from GitHub repository (requires GitHub SSH key configured)
npm install github:vreen/vreen/packages/engine

# or via SSH (requires SSH key added to GitHub account)
npm install git+ssh://git@github.com:vreen/vreen.git#master

# from local file (for development in the vreen monorepo, recommended for now)
npm install file:../packages/engine
```

> **Note:** GitHub SSH installation requires your SSH public key to be
> added to your GitHub account. See
> https://github.com/settings/keys to add your key. Currently, local
> file installation is the most reliable method.

`draco3d` is an **optional peer dependency**. Install it if you need to
load Draco-compressed GLB files:

```sh
npm install draco3d
```

---

## Quick Start

```ts
import {
  WebGL2Renderer, Scene, PerspectiveCamera,
  Mesh, BoxGeometry, StandardMaterial,
  AmbientLight, DirectionalLight, OrbitControls,
  createGridMesh,
} from '@vreen/engine';

const canvas = document.querySelector('canvas')!;
const renderer = new WebGL2Renderer(canvas);
renderer.resize(window.innerWidth, window.innerHeight);

const scene = new Scene();
const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.5, 1.8, 3.0);
camera.lookAt(0, 0.5, 0);

const controls = new OrbitControls(camera, canvas);

scene.add(new AmbientLight(0xffffff, 0.4));
scene.add(new DirectionalLight(0xfff0dd, 1.2, { x: 3, y: 4, z: 2 }));
scene.add(createGridMesh(renderer, { size: 10, cellSize: 0.5 }));

const mat = new StandardMaterial();
mat.baseColor = { r: 0.6, g: 0.7, b: 1.0 };
mat.metallic = 0.6;
mat.roughness = 0.3;
const box = new Mesh(new BoxGeometry(1, 1, 1), mat);
box.position.set(0, 0.5, 0);
scene.add(box);

function frame() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

A runnable version of this example is in
[`examples/minimal.html`](./examples/minimal.html) +
[`examples/minimal.ts`](./examples/minimal.ts).

---

## Public API Overview

The public API is re-exported from the top-level
[`src/index.ts`](./src/index.ts). Anything not re-exported is internal
and may change without notice between minor versions.

```ts
// All of these come from the package root:
import {
  // Math
  Vector3, Matrix4, Quaternion, MathUtils,
  // Core
  Object3D, Scene, Group, Mesh, SkinnedMesh, Bone, Skeleton,
  BufferGeometry, BufferAttribute, BasicMaterial, Texture,
  // Cameras
  PerspectiveCamera, OrthographicCamera,
  // Controls
  OrbitControls,
  // Lights
  AmbientLight, DirectionalLight,
  // Geometries
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry,
  TorusGeometry, PlaneGeometry,
  // Materials
  StandardMaterial, ShaderMaterial, STANDARD_VERTEX_SRC, STANDARD_FRAGMENT_SRC,
  // Loaders
  GLBLoader, HDRLoader, TextureLoader, AssetManager,
  parseOBJ, exportOBJ, getDracoModule, decodeDraco,
  // Renderer
  WebGL2Renderer, ShaderProgram,
  // Animation
  AnimationClip, AnimationAction, AnimationMixer, AnimationStateMachine,
  KeyframeTrack, NumberKeyframeTrack, VectorKeyframeTrack, QuaternionKeyframeTrack,
  buildHumanoid,
  // ECS
  World, System, defineComponentType,
  // Physics
  createPhysicsDemo, installPhysicsSystems, syncMeshesFromTransforms,
  // Helpers
  createGridMesh, createLineMesh, LineMesh, PhysicsDebugRenderer,
  // Tools
  Profiler,
  // Logger
  createLogger, setLoggerSink, setMinLevel, getMinLevel,
} from '@vreen/engine';
```

For per-class / per-function signatures, see [`API.md`](./API.md).

---

## Engine Module Manifest

| Module | Exports | Highlights |
| ------ | ------- | ---------- |
| `Math` | `Vector3`, `Matrix4`, `Quaternion`, `MathUtils` | Column-major `Float32Array` matrices; mutating + non-mutating variants; `MathUtils` exported as a namespace. |
| `Core` | `Object3D`, `Scene`, `Group`, `Mesh`, `SkinnedMesh`, `Bone`, `Skeleton`, `BufferGeometry`, `BufferAttribute`, `BasicMaterial` (`Material` interface), `Texture` | Scene-graph primitives; versioned invalidation via `version` / `needsUpdate`; GPU skinning via per-bone uniform arrays. |
| `Cameras` | `PerspectiveCamera`, `OrthographicCamera` | Produce view / projection / view-projection matrices consumed by the renderer. |
| `Controls` | `OrbitControls` | Orbit / pan / dolly input handling with damping. |
| `Lights` | `AmbientLight`, `DirectionalLight` (with `DirectionalLightShadow`) | Per-scene light collection; `DirectionalLight` supports `castShadow`. |
| `Geometries` | `BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry`, `PlaneGeometry` | Procedural primitive generators producing `BufferGeometry` with position / normal / uv / index attributes. |
| `Materials` | `StandardMaterial` (PBR), `ShaderMaterial`, `STANDARD_VERTEX_SRC`, `STANDARD_FRAGMENT_SRC`, `PBR_VERT`, `PBR_FRAG`, `SHADOW_VERT`, `SHADOW_FRAG` | PBR with base color / metallic / roughness / emissive / opacity / wireframe; custom GLSL ES 3.0 shaders via `ShaderMaterial`. |
| `Loaders` | `GLBLoader`, `HDRLoader`, `TextureLoader`, `AssetManager`, `parseOBJ` / `exportOBJ`, `getDracoModule` / `decodeDraco` | LRU-cached `AssetManager`; per-channel RLE RGBE `.hdr` decode; Draco via optional `draco3d` peer. |
| `Renderer` | `WebGL2Renderer`, `ShaderProgram` (and `RendererStats` type) | PBR / IBL / shadow mapping / SSAO / post-processing; VAO + shadow FBO + post-processing FBO caches keyed on `version` counters. |
| `Animation` | `KeyframeTrack` (+ `Number` / `Vector` / `Quaternion` variants), `AnimationClip`, `AnimationAction`, `AnimationMixer`, `AnimationStateMachine`, `buildHumanoid` | GPU skinning driver; FSM with Idle / Walk / Run auto-transitions; animation events. |
| `ECS` | `World`, `System`, `defineComponentType`, built-in components (`Transform`, `Velocity`, `MeshRef`, `SkinnedMeshRef`, `AnimState`, `Health`, `Tag`, `Lifetime`, `PlayerInput`), built-in systems (`MovementSystem`, `AnimationTickSystem`, `AnimStateSystem`, `PlayerInputSystem`, `LifetimeSystem`) | POJO components; 32-bit packed `EntityId`; `toJSON` / `loadJSON` round-trip. |
| `Physics` | `installPhysicsSystems`, `createPhysicsConfigEntity`, `createPhysicsDemo`, `syncMeshesFromTransforms` | Fixed-step semi-implicit Euler + quaternion rotation; AABB / Sphere / Capsule colliders; impulse response + Baumgarte stabilization; CPU particle system. |
| `Helpers` | `createGridMesh`, `createLineMesh`, `LineMesh`, `PhysicsDebugRenderer` | Three-channel debug overlay (cyan colliders / yellow contacts / magenta velocities). |
| `Tools` | `Profiler` | 120-frame ring buffer; CPU / GPU / draw-call samples. |
| — (logger) | `createLogger`, `setLoggerSink`, `setMinLevel`, `getMinLevel` | Built-in logger so the package has no external deps. Console output is always preserved (sink is additive). |

---

## Render Pipeline

`WebGL2Renderer.render(scene, camera)` runs four passes per frame:

1. **Shadow pass** — for each `DirectionalLight` with `castShadow = true`,
   render the scene's shadow casters from the light's POV into a depth
   FBO (PCF 16-tap Poisson in the fragment shader).
2. **SSAO pass** *(optional)* — write linear depth + view normals into a
   half-res FBO, then sample a 16-tap kernel to produce an AO texture.
3. **Main pass** — every visible `Mesh` is drawn with the standard PBR
   shader (`StandardMaterial`) or its own `ShaderMaterial`. Lights,
   shadow map, IBL envMap, and SSAO are bound as uniforms.
4. **Post-processing pass** *(optional)* — when `postProcessingEnabled`
   is on, the main pass writes to an offscreen FBO which is then
   composed via Bloom → Chromatic Aberration → Vignette → Final compose.

```ts
renderer.ssaoEnabled = true;
renderer.postProcessingEnabled = true;
renderer.bloomEnabled = true;
renderer.bloomIntensity = 0.7;
renderer.bloomThreshold = 0.85;
renderer.chromaticAberrationEnabled = true;
renderer.chromaticAberrationOffset = 0.001;
renderer.vignetteEnabled = true;
renderer.vignetteDarkness = 0.5;
```

The renderer also exposes per-frame stats:

```ts
renderer.stats.drawCalls         // total draw calls this frame
renderer.stats.triangles         // total triangles
renderer.stats.shadowPasses      // number of shadow passes (== cast-shadow lights)
renderer.stats.programs          // size of the program cache
renderer.stats.drawCallBreakdown // per-mesh breakdown
```

---

## ECS

The engine has a small, fast Entity-Component-System implementation that
plays well with the scene graph. Components are POJOs; systems are plain
classes with a `priority` and an `update(world, dt)` method.

```ts
import { World, Transform, Velocity, MovementSystem } from '@vreen/engine';

const world = new World();
world.addSystem(new MovementSystem());

const e = world.createEntity('Player');
world.addComponent(e, new Transform({ x: 0, y: 0, z: 0 }));
world.addComponent(e, new Velocity({ x: 1, y: 0, z: 0 }));

function tick(dt: number) { world.update(dt); }
```

Built-in components / systems cover: `Transform`, `Velocity`, `MeshRef`,
`SkinnedMeshRef`, `AnimState`, `Health`, `Tag`, `Lifetime`, `PlayerInput`,
plus `MovementSystem`, `AnimationTickSystem`, `AnimStateSystem`,
`PlayerInputSystem`, `LifetimeSystem`. Physics adds `Collider`,
`Rigidbody`, `Particle`, `ParticleEmitter`, `PhysicsDebug` with
`PhysicsSystem`, `CollisionSystem`, `ParticleSystem`,
`PhysicsDebugSystem`.

Bridge an entity's `Transform` to a `Mesh`'s world matrix once per
frame:

```ts
import { syncMeshesFromTransforms } from '@vreen/engine';
syncMeshesFromTransforms(world); // updates every MeshRef / SkinnedMeshRef
```

The ECS ↔ scene-graph bridge keeps the renderer completely ECS-unaware —
it just walks the scene graph — and lets the ECS drive game logic
without entangling itself with GPU resources.

---

## Animation

`AnimationMixer` plays `AnimationClip`s on a root `Object3D`. Tracks are
`VectorKeyframeTrack` / `QuaternionKeyframeTrack` /
`NumberKeyframeTrack`. For game-style FSM, build a
`AnimationStateMachine` and let the `AnimStateSystem` tick it from the
ECS:

```ts
import {
  AnimationStateMachine, AnimationMixer, AnimStateNode, AnimTransition,
} from '@vreen/engine';

const sm = new AnimationStateMachine();
const idle: AnimStateNode = { name: 'idle', clip: idleClip, loop: true };
const run:  AnimStateNode = { name: 'run',  clip: runClip,  loop: true };
sm.addState(idle).addState(run).setInitial('idle');
sm.addTransition({ from: 'idle', to: 'run',  condition: (w, e) => w.getComponent(e, VelocityC).vx > 0.1, durationMs: 200 });
sm.addTransition({ from: 'run',  to: 'idle', condition: (w, e) => w.getComponent(e, VelocityC).vx < 0.1, durationMs: 200 });
const mixer = new AnimationMixer(root);
sm.bind(mixer);
```

---

## Loaders

`GLBLoader` and `parseOBJ` produce a `Group` you can drop into a
`Scene`. `HDRLoader` produces a linear `Texture` ready to be assigned to
`scene.background.envMap` (the PBR shader reads it for image-based
lighting). `AssetManager` deduplicates fetches and caches by URL.

```ts
import { GLBLoader, HDRLoader, AssetManager } from '@vreen/engine';

const mgr = new AssetManager();
mgr.register('hdr', new HDRLoader());
mgr.register('glb', new GLBLoader());

const hdr = await mgr.load('hdr', '/env.hdr');
scene.background = { envMap: hdr.texture, /* … */ };

const glb = await mgr.load('glb', '/hero.glb');
scene.add(glb.root);
glb.animations.forEach((c) => mixer.actionFor(c).play());
```

Draco-compressed GLBs are decoded transparently when `draco3d` is
installed. It's an optional peer dependency.

---

## Custom Shaders

`ShaderMaterial` lets you write a full GLSL ES 3.0 vertex/fragment pair.
The renderer feeds `u_time`, `u_model`, `u_view`, `u_projection`,
`u_normalMatrix`, and `u_cameraPos` automatically; you supply additional
uniforms via `mat.uniforms`.

```ts
import { ShaderMaterial, Mesh, BoxGeometry } from '@vreen/engine';

const mat = new ShaderMaterial({
  vertexSrc: `#version 300 es
    in vec3 a_position;
    uniform mat4 u_model, u_view, u_projection;
    void main() { gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0); }
  `,
  fragmentSrc: `#version 300 es
    precision highp float;
    uniform float u_time;
    out vec4 outColor;
    void main() { outColor = vec4(0.5 + 0.5 * sin(u_time), 0.4, 0.7, 1.0); }
  `,
  uniforms: { u_time: 0 },
});
scene.add(new Mesh(new BoxGeometry(1, 1, 1), mat));
```

---

## Profiling

`Profiler` collects per-frame timing and draw-call samples in a ring
buffer (60 frames by default). UI code subscribes to `onSample` and
renders a frame-time chart, system-execution timeline, etc.

```ts
import { Profiler } from '@vreen/engine';

const profiler = new Profiler();
profiler.start();
profiler.markCpu('update');
// ... do work ...
profiler.markCpuEnd('update');
profiler.beginFrame();
renderer.render(scene, camera);
profiler.endFrame();
```

---

## Logger

The engine ships with a small built-in logger so it has no external
deps. By default it writes to `console` with a `[module]` prefix.

```ts
import { setLoggerSink, setMinLevel, type LogEntry } from '@vreen/engine';

// Forward to your monitoring / UI state.
setLoggerSink((e: LogEntry) => {
  if (e.level === 'error') myErrorBus.push(e);
});

// Crank it down in production.
setMinLevel('warn');
```

Console output is always preserved (sink is additive). To silence
console too, just don't set a sink and set the level to `'error'` or
`'silent'`.

You can also set a global level before import:

```html
<script>window.__VREEN_ENGINE_LOG_LEVEL__ = 'silent';</script>
<script type="module" src="..."></script>
```

---

## Compatibility with Three.js

`@vreen/engine` is **not** a Three.js plugin, wrapper, or replacement.
It is an independent engine kernel that happens to share API surface
conventions with Three.js for ease of adoption. The two can coexist in
the same project — the VREEN web app itself uses both
(Three.js for the legacy viewer path, `@vreen/engine` for the strategic
custom path).

### Shared conventions

| Convention | Three.js | `@vreen/engine` |
|------------|----------|------------------|
| Coordinate system | Right-handed, +Y up, -Z forward | Same |
| `Object3D` API | `position` / `rotation` / `scale` / `matrixWorld` / `lookAt` / `traverse` | Same shape |
| `BufferGeometry` / `BufferAttribute` | `version` / `needsUpdate` / `setUsage` | Same shape (some shims) |
| PBR material parameters | `MeshStandardMaterial` (`metallic`, `roughness`, …) | `StandardMaterial` with the same field names |
| Camera matrices | `PerspectiveCamera` / `OrthographicCamera` produce `projectionMatrix` | Same |

### Where they differ

| Aspect | Three.js | `@vreen/engine` |
|--------|----------|------------------|
| Module shape | `THREE` namespace or ESM import | ESM-only, named exports |
| Renderer | `WebGLRenderer` / `WebGPURenderer` | `WebGL2Renderer` (implements the `Renderer` interface — see in-tree `src/engine/Renderer/Renderer.ts`) |
| Material model | `Material` → `MeshStandardMaterial` → `MeshPhysicalMaterial` inheritance tree | `Material` interface + `StandardMaterial` / `ShaderMaterial` flat classes |
| Loader registry | `LoadingManager` + per-format loaders | `AssetManager` with `register(ext, loader)` and LRU cache |
| Scene graph extras | `InstancedMesh`, `LOD`, `Skeleton`/`SkinnedMesh` (in-tree only — not yet mirrored to package) | In-tree: yes. Package: not yet. |
| Dependencies | Pulls in many helpers | Zero runtime deps (Draco optional) |

### Bridging between the two

The VREEN web app ships adapters in `src/three/`:

- `threeToCustomAnim.ts` — Three.js `AnimationClip` → engine
  `AnimationClip`.
- `convertCustomToThree.ts` — engine `Scene` → Three.js scene (for the
  legacy viewer path's preview of engine-built scenes).

These adapters are **not** part of the `@vreen/engine` package (they
would create a Three.js dependency). They live in the web app.

### When to use which

| Use case | Recommendation |
|----------|----------------|
| You need maximum loader / extension ecosystem coverage | Use Three.js |
| You need a zero-dependency, inspectable engine kernel for headless / server-side / build-pipeline use | Use `@vreen/engine` |
| You want to learn how a 3D engine works internally | Use `@vreen/engine` |
| You need WebGPU today | Use Three.js (`WebGPURenderer`); VREEN's WebGPU backend is Phase 5.1 |
| You need VREEN's `.vreen` package format and ECS depth | Use `@vreen/engine` |

---

## Build, Package, and Publish

### Build

```sh
cd packages/engine
npm run build       # tsc → dist/ + esbuild bundle
npm run typecheck   # tsc --noEmit
npm run watch       # tsc --watch
```

The build has two steps (see `package.json`):

1. **`build:types`** — `tsc -p tsconfig.json` emits `.d.ts` declaration
   files into `dist/`.
2. **`build:bundle`** — `esbuild src/index.ts --bundle --format=esm
   --target=es2022 --outfile=dist/index.js --platform=browser
   --sourcemap --external:draco3d` produces a single ESM bundle.

Build output goes to `dist/`. The package consumes its own
`dist/index.js` + `dist/index.d.ts` as the public entry
(see `package.json` `main` / `types` / `exports`).

### Sync from the source of truth

The engine's source of truth is `src/engine/` in the VREEN web app.
`packages/engine/src/` is a curated mirror. To sync after editing the
in-tree engine:

```sh
# from the repository root
npm run engine:sync         # copies src/engine/ → packages/engine/src/
                            # and rewrites @/lib/logger → ./logger.ts
npm run engine:typecheck    # verify the package still compiles
npm run engine:build        # verify the bundle still builds
```

> **Do not edit `packages/engine/src/` directly.** It is generated and
> will be overwritten on the next `engine:sync`. Always edit
> `src/engine/` in the web app.

### Package layout

```json
{
  "name": "@vreen/engine",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "sideEffects": false,
  "engines": { "node": ">=18" },
  "peerDependencies": { "draco3d": "^1.5.7" },
  "peerDependenciesMeta": { "draco3d": { "optional": true } }
}
```

`sideEffects: false` enables safe tree-shaking. `files` restricts what
npm publishes to `dist/` + `README.md` (source maps and `API.md` are
included via `dist/`).

### Publish

There is no automated publish pipeline yet (tracked in
[`ROADMAP.md`](../../ROADMAP.md) tech-debt). For now, publishing is
manual:

```sh
cd packages/engine
npm version patch        # or minor / major
npm run build
npm publish --access public
```

> The maintainer intends to gate npm publishing behind API stability
> review and a GitHub Actions release workflow. See `ROADMAP.md` for
> the current plan.

---

## Browser Requirements

- **WebGL 2** — any modern browser; Chrome 56+, Firefox 51+, Safari 15+.
- **ES2022** — the bundle targets ES2022 syntax.

---

## Limitations

- `BufferAttribute.needsUpdate` / `setUsage` are no-op API compat shims —
  the renderer always re-uploads dynamic position attributes via
  `gl.bufferData`. If you need partial updates, add a `gl.bufferSubData`
  path.
- Frustum culling per `Mesh` is enabled by default; partial tree culling
  is not supported.
- Shadow map is single directional light only.
- `BufferGeometry.dispose()` drops cached bounding volumes + GL state;
  the renderer owns WebGL buffers.
- The package surface is a curated subset of the in-tree engine. See
  [Status](#status) above.

---

## License

[MIT](../../LICENSE) — Copyright (c) 2026 toujianjian.

---

## See Also

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — full system architecture,
  subsystem deep-dives, and design decisions.
- [`ROADMAP.md`](../../ROADMAP.md) — phased plan, tech-debt list,
  performance audit.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — contribution workflow
  and code conventions.
- [`API.md`](./API.md) — per-class / per-function TypeScript signatures.
- [`examples/minimal.html`](./examples/minimal.html) +
  [`examples/minimal.ts`](./examples/minimal.ts) — minimal runnable
  example.
