# @vreen/engine

Self-developed WebGL2 3D engine kernel. Zero runtime dependencies. PBR + IBL +
shadow map + SSAO + post-processing (Bloom / Gaussian blur / chromatic
aberration / vignetting) + ECS + physics + animation.

Used by the [vreen web app](../../) (Vite + React) and packaged here for
re-use in other tools (headless server-side rendering, build pipelines,
Minecraft mod tools, Godot plugin, etc.).

## Status

**v0.1.0** — first publishable cut. Source of truth: `src/engine/` in the
vreen web app. This package is a re-packaging with a clean public API surface
and a built-in logger (no dependency on the web app's logger).

## Install

```sh
# from local file (for development in the vreen monorepo)
npm install file:../packages/engine

# or once published to a registry
npm install @vreen/engine
```

## Build

```sh
cd packages/engine
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm run watch       # tsc --watch
```

Build output goes to `dist/`. The package consumes its own `dist/index.js`
+ `dist/index.d.ts` as the public entry.

## Quick start

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

Full example: [examples/minimal.html](examples/minimal.html) +
[examples/minimal.ts](examples/minimal.ts).

## Public API

Re-exported from the top-level `index.ts`. Anything not re-exported is
internal and may change without notice.

| Module | Highlights |
| ------ | ---------- |
| `Core` | `Object3D`, `Scene`, `Mesh`, `Group`, `BufferGeometry`, `BufferAttribute`, `Material`, `Bone`, `Skeleton`, `SkinnedMesh`, `Texture` |
| `Math` | `Vector3`, `Quaternion`, `Matrix4`, `MathUtils` |
| `Cameras` | `Camera`, `PerspectiveCamera`, `OrthographicCamera` |
| `Controls` | `OrbitControls` |
| `Lights` | `Light`, `AmbientLight`, `DirectionalLight` |
| `Geometries` | `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, etc. (see `Primitives.ts`) |
| `Materials` | `StandardMaterial` (PBR), `ShaderMaterial`, raw shader chunks |
| `Loaders` | `GLBLoader`, `OBJLoader`, `HDRLoader`, `TextureLoader`, `AssetManager`, `OBJExporter`, `DracoDecoder` (`getDracoModule`, `decodeDraco`) |
| `Animation` | `AnimationClip`, `AnimationAction`, `AnimationMixer`, `AnimationStateMachine`, `Humanoid`, `KeyframeTrack` |
| `ECS` | `World`, `System`, `ComponentType`, `defineComponentType`, plus all built-in components / systems |
| `Physics` | `createPhysicsDemo`, `installPhysicsSystems`, `syncMeshesFromTransforms` |
| `Helpers` | `createGridMesh`, `createLineMesh`, `LineMesh`, `PhysicsDebugRenderer` |
| `Renderer` | `WebGL2Renderer`, `ShaderProgram` |
| `Tools` | `Profiler` |
| — | `createLogger`, `setLoggerSink`, `setMinLevel`, `getMinLevel` |

For per-class / per-function signatures see [API.md](API.md).

## Render pipeline

`WebGL2Renderer.render(scene, camera)` runs four passes per frame:

1. **Shadow pass** — for each `DirectionalLight` with `castShadow = true`,
   render the scene's shadow casters from the light's POV into a depth FBO
   (PCF 16-tap Poisson in the fragment shader).
2. **SSAO pass** *(optional)* — write linear depth + view normals into a
   half-res FBO, then sample a 16-tap kernel to produce an AO texture.
3. **Main pass** — every visible `Mesh` is drawn with the standard PBR
   shader (`StandardMaterial`) or its own `ShaderMaterial`. Lights,
   shadow map, IBL envMap, and SSAO are bound as uniforms.
4. **Post-processing pass** *(optional)* — when `postProcessingEnabled` is
   on, the main pass writes to an offscreen FBO which is then composed via
   Bloom → Chromatic Aberration → Vignette → Final compose.

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
renderer.stats.drawCalls        // total draw calls this frame
renderer.stats.triangles        // total triangles
renderer.stats.shadowPasses     // number of shadow passes (== cast-shadow lights)
renderer.stats.programs         // size of the program cache
renderer.stats.drawCallBreakdown // per-mesh breakdown
```

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
`PlayerInputSystem`, `LifetimeSystem`. Physics adds `Collider`, `Rigidbody`,
`Particle`, `ParticleEmitter`, `PhysicsDebug` with `PhysicsSystem`,
`CollisionSystem`, `ParticleSystem`, `PhysicsDebugSystem`.

Bridge an entity's `Transform` to a `Mesh`'s world matrix once per frame:

```ts
import { syncMeshesFromTransforms } from '@vreen/engine';
syncMeshesFromTransforms(world); // updates every MeshRef / SkinnedMeshRef
```

## Animation

`AnimationMixer` plays `AnimationClip`s on a root `Object3D`. Tracks are
`VectorKeyframeTrack` / `QuaternionKeyframeTrack` / `NumberKeyframeTrack`.
For game-style FSM, build a `AnimationStateMachine` and let the
`AnimStateSystem` tick it from the ECS:

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

## Profiling

`Profiler` collects per-frame timing and draw-call samples in a ring buffer
(60 frames by default). UI code subscribes to `onSample` and renders a
frame-time chart, system-execution timeline, etc.

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

## Loaders

`GLBLoader` and `OBJLoader` produce a `Group` you can drop into a `Scene`.
`HDRLoader` produces a linear `Texture` ready to be assigned to
`scene.background.envMap` (the PBR shader reads it for image-based
lighting). `AssetManager` deduplicates fetches and caches by URL.

```ts
import { GLBLoader, HDRLoader, AssetManager } from '@vreen/engine';

const mgr = new AssetManager();
mgr.register('hdr', new HDRLoader());
mgr.register('glb', new GLBLoader());

const hdr = await mgr.load('hdr', '/env.hdr');
scene.background = { envMap: hdr.texture, ... };

const glb = await mgr.load('glb', '/hero.glb');
scene.add(glb.root);
glb.animations.forEach((c) => mixer.actionFor(c).play());
```

Draco-compressed GLBs are decoded transparently when `draco3d` is
installed. It's an optional peer dependency.

## Custom shaders

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

## Logger

The engine ships with a small built-in logger so it has no external deps.
By default it writes to `console` with a `[module]` prefix.

```ts
import { setLoggerSink, setMinLevel, type LogEntry } from '@vreen/engine';

// Forward to your monitoring / UI state.
setLoggerSink((e: LogEntry) => {
  if (e.level === 'error') myErrorBus.push(e);
});

// Crank it down in production.
setMinLevel('warn');
```

Console output is always preserved (sink is additive). To silence console too,
just don't set a sink and set the level to `'error'` or `'silent'`.

You can also set a global level before import:

```html
<script>window.__VREEN_ENGINE_LOG_LEVEL__ = 'silent';</script>
<script type="module" src="..."></script>
```

## Browser requirements

- WebGL 2 (any modern browser; Chrome 56+, Firefox 51+, Safari 15+)
- ES2022

## Limitations

- `BufferAttribute.needsUpdate` / `setUsage` are no-op API compat shims — the
  renderer always re-uploads dynamic position attributes via `gl.bufferData`.
  If you need partial updates, add a `gl.bufferSubData` path.
- No partial tree culling. Frustum culling per `Mesh` is on by default.
- Shadow map is single directional light only.
- `Disposal` (`BufferGeometry.dispose()`) drops cached bounding volumes + GL
  state; the renderer owns WebGL buffers.

## License

MIT.
