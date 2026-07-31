# `@vreen/engine` — WebGL2 Game Engine Kernel

> Path: `src/engine/`
>
> The kernel of the VREEN engine: a TypeScript-first, zero-runtime-dependency
> WebGL2 rendering and simulation stack aimed at indie game developers and
> 3D artists. The kernel exposes 42 top-level modules through a single barrel
> (`src/engine/index.ts`) and ships **4290+ tests** across **290+ test files**.

---

## Overview

```
                       ┌─────────────────────────────────────────────┐
                       │              @vreen/engine barrel            │
                       └─────────────────────────────────────────────┘
                                         │
   ┌───────────┬───────────┬─────────────┼─────────────┬───────────┬───────────┐
   ▼           ▼           ▼             ▼             ▼           ▼           ▼
 Math        Core       Cameras       Lights       Materials    Geometries   Loaders
 Vector·Mtx  Scene·Mesh  Persp·Ortho   7 light     Standard·PBR  18 prim     GLB·FBX·
 Quat·Box    Texture·    Cinematic     types +     Toon·Fur·      + Shape    OBJ·STL·
 Frustum     Skeleton    CameraRig     shadows      SSS·Water  Convex·Decal  PLY·HDR
             Morph                                  + ShaderChunks
 Spher·Cyl                              LightProbe
   │           │           │             │             │           │           │
   ▼           ▼           ▼             ▼             ▼           ▼           ▼
 Renderer   Helpers     Controls      ECS           Animation    Audio        Particles
 WebGL2·    Grid·Axes·  Orbit·Fly·    World·        Mixer·      Listener·    ParticleSystem2
 Deferred·  Box·Gizmo·  Pointer·      Component·    BlendSpace·  Positional·  Emitter·
 Forward+   Debug       Map·Char·     System·       IK (FABRIK/  Effects·     Modifier·
 PathTracer Renderer    VRController  Prefab·       CCD)·        Analyzer     Curve·Trail
 PostProcess             QueryBuilder  Physics       Procedural                SubEmitters
                         Broadphase    Systems       Animation
           PolarGrid·                              RootMotion
   │           │           │             │             │           │           │
   ▼           ▼           ▼             ▼             ▼           ▼           ▼
 Physics    Scripting    Events         AI            Environment Timeline     Voxel
 Rigid·     ScriptC·     EventBus·      NavMesh·      Sky·Cloud·  Clip·Track· Chunk 16³·
 Cloth·     Coroutine·   EventQueue·    PathFinder·   Weather·    Sequencer·  Mesher·
 Fluid·     Registry·    GameEvent      Steering·     Vegetation· Event·      Raycaster·
 Buoyancy·  VisualScript (typed)       Perception·   Water·      Property·   World·
 Vehicle·                              BehaviorTree·  FFT Ocean   Track       Palette
 Flight·                               Crowd·ML
   │           │           │             │             │           │           │
   ▼           ▼           ▼             ▼             ▼           ▼           ▼
 Editor      Tools        Acceleration   Assets        Pipeline    Serialization SaveSystem
 Selection·  Profiler·    BVH·          AssetCache·   AssetPipe·  Registry·    SaveSystem·
 Gizmo·      Frame·       MeshBVH        Registry·     Texture·    Geometry·    SaveSerializer·
 UndoRedo·   System·                     Loader·       Geometry·   Material·    LocalStorage
 Snap·       Memory·                     Bundle·       Import·     Scene·
             GPU·Console                 HotReload·    Pipeline    Serializer
             LOD                         Streaming
   │
   ▼
 SceneManager    Network          Input            Gameplay        Terrain        PCG
 Scene register  Transport·       Keyboard·        Dialogue·       TerrainGeo·    Noise·
 Transition·     Snapshot·        Mouse·           Quest·          Heightmap·     Building·
 Streaming·      LagComp·         Touch·           Inventory       Splat·Layer    City·
                 StateSync        Gamepad·                                        Dungeon·
                                  Action·Map                                       Tree·Character
   │
   ▼
Curves           SurfaceData             Shapes
Curve·CurvePath  SurfaceTag·Point        Shape(abs)·Box·Sphere
CatmullRom·      SurfaceDataProvider     Capsule·Cylinder·Disk
Bezier·Line·     SurfaceDataSystem       Quad·Tube·Compound
Ellipse·Spline·  TerrainSurfaceProvider
Path·Shape·ShapeUtils
   │
   ▼
Vegetation       LocalUser
Descriptor·      LocalUserProfile·
Filter·Modifier  LocalPlayerSlot·
SpawnerArea·     LocalUserManager
AreaBlender
   │
   ▼
ScriptCanvas     WhiteBox
ScriptGraph·     HalfEdgeMesh·
ScriptExecutor·  WhiteBoxShapes·
NodeRegistry     Csg
```

The barrel re-exports **every** module's public surface; users import from a
single entry point:

```ts
import { Scene, PerspectiveCamera, WebGL2Renderer, BoxGeometry, StandardMaterial } from '@vreen/engine';
```

---

## Module Index

| Module | Path | Purpose | README |
|--------|------|---------|--------|
| Math | `Math/` | Vector · Matrix · Quaternion · Color · Frustum · Spherical · Cylindrical primitives | [Math/README.md](./Math/README.md) |
| Core | `Core/` | Scene graph · Object3D · Mesh · Textures · Morph · Fog · Raycaster | [Core/README.md](./Core/README.md) |
| Cameras | `Cameras/` | PerspectiveCamera · OrthographicCamera · CinematicCamera · CameraRig | [Cameras/README.md](./Cameras/README.md) |
| Controls | `Controls/` | Orbit · Fly · PointerLock · Map · CharacterController · VRController | [Controls/README.md](./Controls/README.md) |
| Lights | `Lights/` | Ambient · Directional · Point · Spot · Hemisphere · RectArea · LightProbe · AmbientLightProbe · HemisphereLightProbe · SphericalHarmonics3 + shadows | [Lights/README.md](./Lights/README.md) |
| Materials | `Materials/` | Standard · Physical · Phong · Toon · Fur · SSS · Water · ShaderChunks · MaterialGraph · AdvancedPBR | [Materials/README.md](./Materials/README.md) |
| Geometries | `Geometries/` | 18 procedural primitives + Shape + Extrude + Wireframe + Edges + ConvexGeometry + ParametricGeometry + DecalGeometry | [Geometries/README.md](./Geometries/README.md) |
| Loaders | `Loaders/` | GLB · OBJ · FBX · STL · PLY · TGA · HDR · KTX2 · EXR + 4 exporters | [Loaders/README.md](./Loaders/README.md) |
| Audio | `Audio/` | Listener · Positional · Effects · Analyzer · Procedural · Spatial | [Audio/README.md](./Audio/README.md) |
| Renderer | `Renderer/` | WebGL2 · Deferred · Forward+ · PathTracer · PostProcess · GI · RT · LightmapBaker · RenderGraph | [Renderer/README.md](./Renderer/README.md) |
| Helpers | `Helpers/` | Grid · Axes · Box · Arrow · Camera · Line · Debug · PhysicsDebug · PolarGridHelper · Box3Helper · PlaneHelper | [Helpers/README.md](./Helpers/README.md) |
| Terrain | `Terrain/` | TerrainGeometry · Heightmap · Splat · Layer · Erosion · Editor | [Terrain/README.md](./Terrain/README.md) |
| Acceleration | `Acceleration/` | BVH · BVHBuilder (SAH) · MeshBVH (Raycaster acceleration) | [Acceleration/README.md](./Acceleration/README.md) |
| Assets | `Assets/` | AssetCache (LRU) · Registry (refcount) · Loader · Bundle · Streaming | [Assets/README.md](./Assets/README.md) |
| Serialization | `Serialization/` | Registry · Geometry · Material · Scene ↔ JSON round-trip | [Serialization/README.md](./Serialization/README.md) |
| SaveSystem | `SaveSystem/` | Multi-slot saves · Auto-save · LocalStorage adapter | [SaveSystem/README.md](./SaveSystem/README.md) |
| SceneManager | `SceneManager/` | Multi-scene register/switch · Transition · Streaming | [SceneManager/README.md](./SceneManager/README.md) |
| Animation | `Animation/` | Clip · Mixer · StateMachine · BlendSpace · Layer · IK · Procedural · RootMotion · BoneAttachment · Retargeting · SpringSolver · TwoBoneIK | [Animation/README.md](./Animation/README.md) |
| ECS | `ECS/` | World · ComponentType · Systems · QueryBuilder · Broadphase · Prefab | [ECS/README.md](./ECS/README.md) |
| Physics | `Physics/` | Rigid · Cloth · Fluid · Buoyancy · Vehicle · Flight · Constraints · Ragdoll · SoftBody · Rope | [Physics/README.md](./Physics/README.md) |
| Events | `Events/` | EventBus · EventQueue · typed GameEvent hierarchy | [Events/README.md](./Events/README.md) |
| Scripting | `Scripting/` | ScriptC · ScriptSystem · Registry · Coroutine · Bindings · VisualScript | [Scripting/README.md](./Scripting/README.md) |
| Particles | `Particles/` | ParticleSystem2 · Emitter · Modifier · Curve · Trail · SubEmitters | [Particles/README.md](./Particles/README.md) |
| Tools | `Tools/` | Profiler · FrameProfiler · SystemProfiler · MemoryTracker · Console | [Tools/README.md](./Tools/README.md) |
| Network | `Network/` | Transport · Snapshot · NetworkSync · LagComp · Session · StateSync | [Network/README.md](./Network/README.md) |
| Input | `Input/` | Keyboard · Mouse · Touch · Gamepad · InputAction · InputMap | [Input/README.md](./Input/README.md) |
| AI | `AI/` | NavMesh · PathFinder · Steering · Perception · BehaviorTree · ML · GOAP · UtilityAI | [AI/README.md](./AI/README.md) |
| Environment | `Environment/` | Sky · Cloud · Weather · Vegetation · Water · FFT Ocean | [Environment/README.md](./Environment/README.md) |
| Timeline | `Timeline/` | Clip · Track · Event · Property · Sequencer (play/seek/export) | [Timeline/README.md](./Timeline/README.md) |
| Voxel | `Voxel/` | Chunk 16³ · World · Mesher (greedy) · Raycaster (DDA) · Palette | [Voxel/README.md](./Voxel/README.md) |
| Editor | `Editor/` | Selection · TransformGizmo · UndoRedo · EditorCommands · Snap | [Editor/README.md](./Editor/README.md) |
| PCG | `PCG/` | Noise · Building · City · Dungeon · Road · Tree · Character | [PCG/README.md](./PCG/README.md) |
| Pipeline | `Pipeline/` | AssetPipeline · TextureProcessor · GeometryProcessor · Import | [Pipeline/README.md](./Pipeline/README.md) |
| Gameplay | `Gameplay/` | Dialogue · Quest · Inventory · DialogueParticipant | [Gameplay/README.md](./Gameplay/README.md) |
| Curves | `Curves/` | Curve · CurvePath · CatmullRomCurve3 · CubicBezierCurve3 · QuadraticBezierCurve3 · LineCurve3 · EllipseCurve · SplineCurve · Path · Shape · ShapeUtils | [Curves/README.md](./Curves/README.md) |
| SurfaceData | `SurfaceData/` | SurfaceTag · SurfacePoint · SurfaceDataProvider · SurfaceDataSystem · TerrainSurfaceProvider | [SurfaceData/README.md](./SurfaceData/README.md) |
| Shapes | `Shapes/` | Shape (abstract) · BoxShape · SphereShape · CapsuleShape · CylinderShape · DiskShape · QuadShape · TubeShape · CompoundShape | [Shapes/README.md](./Shapes/README.md) |
| Vegetation | `Vegetation/` | VegetationDescriptor · VegetationFilter (altitude/slope/mask/distance/shape/distribution) · VegetationModifier (position/rotation/scale/slopeAlignment) · SpawnerArea · AreaBlender | [Vegetation/README.md](./Vegetation/README.md) |
| LocalUser | `LocalUser/` | LocalUserProfile · LocalPlayerSlot · PlayerSlotState · LocalUserManager | [LocalUser/README.md](./LocalUser/README.md) |
| ScriptCanvas | `ScriptCanvas/` | ScriptGraph · ScriptExecutor · NodeRegistry · 18 built-in nodes (start/print/branch/math/event/variable/delay) | [ScriptCanvas/README.md](./ScriptCanvas/README.md) |
| WhiteBox | `WhiteBox/` | HalfEdgeMesh · WhiteBoxShapes (box/tetrahedron/icosahedron/staircase) · Csg (union/subtract/intersect) | [WhiteBox/README.md](./WhiteBox/README.md) |

---

## Key Properties

- **Language**: TypeScript 5 strict mode, ESM only (`import`/`export`); no `require()`.
- **Zero runtime deps** in the published `@vreen/engine` package (Draco is an
  optional peer). Three.js is used as a polyfill/fallback path, never a hard
  runtime requirement of the kernel.
- **Backend-agnostic Renderer interface** — `WebGL2Renderer` is the concrete
  backend; the seam is reserved for a future WebGPU backend and for headless
  software renderers used in unit tests.
- **ECS-first gameplay** — `World` + `ComponentType` + `Systems` drive
  per-frame simulation; the renderer consumes the same scene graph the ECS
  mutates, so changes are visible without an extra sync step.
- **Deterministic and headless-friendly** — every module that touches
  randomness accepts a seed; tests run under Node with no GPU.
- **Round-trippable** — `SceneSerializer` + `SaveSerializer` + `World.toJSON`
  together support Scene + World + metadata ↔ JSON ↔ reconstructed instances.
- **5-language UI** — the engine itself is locale-agnostic, but the React
  shell exposes English (default), 中文, 日本語, 한국어, Español via i18next.

---

## Getting Started

### Minimal render loop (WebGL2 backend)

```ts
import {
  Scene, PerspectiveCamera, WebGL2Renderer,
  BoxGeometry, StandardMaterial, Mesh,
  DirectionalLight, AmbientLight,
  OrbitControls,
} from '@vreen/engine';

const canvas = document.querySelector('canvas')!;
const renderer = new WebGL2Renderer({ canvas, antialias: true });
renderer.resize(canvas.width, canvas.height);

const scene = new Scene();
scene.background = [0.02, 0.03, 0.05];

const camera = new PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 100);
camera.position.set(3, 2, 5);

const controls = new OrbitControls(camera, canvas);

const mesh = new Mesh(
  new BoxGeometry(1, 1, 1),
  new StandardMaterial({ color: [0.7, 0.8, 0.9], metalness: 0.4, roughness: 0.5 }),
);
scene.add(mesh);

scene.add(new AmbientLight(0.2));
const sun = new DirectionalLight([1, 1, 1], 1.2);
sun.position.set(5, 8, 4);
sun.castShadow = true;
scene.add(sun);

function frame() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
```

### ECS simulation

```ts
import { World, ComponentType, Systems } from '@vreen/engine';

const world = new World();
const eid = world.createEntity();
world.addComponent(eid, ComponentType.Transform, { position: [0, 0, 0] });
world.addComponent(eid, ComponentType.Velocity, { x: 0, y: 0, z: -1 });

// Built-in system iterates Transform + Velocity each tick
world.addSystem(Systems.MovementSystem);

world.tick(1 / 60);
```

See [`packages/engine/examples/minimal.ts`](../../packages/engine/examples/minimal.ts)
for a runnable single-file demo and the per-module READMEs linked above for
detailed API tables, invariants, and usage patterns.

---

## Architectural Conventions

1. **Single import surface** — every public class/type is re-exported from
   `src/engine/index.ts`. Sub-barrels (`Math/index.ts`, `Renderer/index.ts`,
   ...) exist for granular imports but the top-level barrel is the canonical
   entry.
2. **Decoupled modules** — modules depend only on `Math/`, `Core/`, and
   `Events/`. Cross-module dependencies flow downward in the diagram above;
   the renderer never imports `ECS/`, `Physics/` never imports `Renderer/`.
3. **Tests live next to source** — `Foo.ts` is tested by `Foo.test.ts` in
   the same directory. Vitest is the runner; `npm test` collects every
   `*.test.ts` under `src/`.
4. **Logging** — all runtime logging goes through `lib/logger.ts`'s
   `createLogger(module)`; the kernel uses module tags like `'Renderer'`,
   `'ECS'`, `'Physics'`.
5. **No silent fallbacks** — functions either succeed, throw with a typed
   error, or document the fallback in their JSDoc. The engine never swallows
   an exception to "keep running".
6. **CPU-first, GPU-optional** — every algorithm that has a CPU and a GPU
   variant (TAA, GI, BVH, path tracing) ships the CPU variant as the source
   of truth; GPU variants are optimizations layered on top.

---

## Build & Test

```bash
npm run typecheck        # tsc -b --noEmit (strict mode)
npm test                 # vitest run
npm run test:coverage    # vitest run --coverage
npm run engine:build     # build @vreen/engine package
npm run build            # tsc -b && vite build (full app)
```

The kernel is consumed by the React shell (`src/`) and by the standalone
`packages/engine` distribution. The React shell adds the editor UI, the
viewer, the Blockly visual-scripting panel, the i18n layer, and the
Electron desktop wrapper.

---

## References

- Project root README — `README.md` (top-level project overview).
- Architecture deep-dive — `ARCHITECTURE.md`.
- Roadmap — `ROADMAP.md` (Phase 4/5 modules: CrowdSystem, WebGPU, etc.).
- soup3D comparison — `docs/SOUP3D_COMPARISON.md`.
- Format spec — `docs/format/vreen-format-spec.md` (`.vreen` package format).
- Contributing — `CONTRIBUTING.md`.
- License — `LICENSE` (MIT).
