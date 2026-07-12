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
| `Loaders` | `GLBLoader`, `OBJLoader`, `HDRLoader`, `TextureLoader`, `AssetManager`, `OBJExporter`, `DracoDecoder` |
| `Animation` | `AnimationClip`, `AnimationAction`, `AnimationMixer`, `AnimationStateMachine`, `Humanoid`, `KeyframeTrack` |
| `ECS` | `World`, `System`, `ComponentType`, `defineComponentType`, plus all built-in components / systems |
| `Physics` | `createPhysicsDemo`, `installPhysicsSystems`, `syncMeshesFromTransforms` |
| `Helpers` | `createGridMesh`, `createLineMesh`, `LineMesh`, `PhysicsDebugRenderer` |
| `Renderer` | `WebGL2Renderer`, `ShaderProgram` |
| `Tools` | `Profiler` |
| — | `createLogger`, `setLoggerSink`, `setMinLevel`, `getMinLevel` |

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
