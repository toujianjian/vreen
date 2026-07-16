# @vreen/engine — API Reference

> Auto-curated reference. Where the README uses narrative, this file is
> the lookup table. All signatures are in TypeScript.

## Module map

| Path | Purpose |
| ---- | ------- |
| `Math` | `Vector3`, `Quaternion`, `Matrix4`, `MathUtils` |
| `Core` | `Object3D`, `Scene`, `Group`, `Mesh`, `SkinnedMesh`, `Bone`, `Skeleton`, `BufferGeometry`, `BufferAttribute`, `Material`, `BasicMaterial`, `Texture` |
| `Cameras` | `Camera`, `PerspectiveCamera`, `OrthographicCamera` |
| `Controls` | `OrbitControls` |
| `Lights` | `Light`, `AmbientLight`, `DirectionalLight` |
| `Geometries` | `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry` |
| `Materials` | `StandardMaterial`, `ShaderMaterial`, `STANDARD_VERTEX_SRC`, `STANDARD_FRAGMENT_SRC`, `PBR_VERT`, `PBR_FRAG` |
| `Loaders` | `GLBLoader`, `HDRLoader`, `TextureLoader`, `parseOBJ` / `exportOBJ`, `AssetManager`, `getDracoModule` / `decodeDraco` |
| `Animation` | `KeyframeTrack`, `AnimationClip`, `AnimationAction`, `AnimationMixer`, `AnimationStateMachine`, `buildHumanoid` |
| `ECS` | `World`, `System`, `defineComponentType`, plus built-in component types and systems |
| `Physics` | `installPhysicsSystems`, `createPhysicsConfigEntity`, `createPhysicsDemo`, `syncMeshesFromTransforms` |
| `Helpers` | `createGridMesh`, `createLineMesh`, `LineMesh`, `PhysicsDebugRenderer` |
| `Renderer` | `WebGL2Renderer`, `ShaderProgram` |
| `Tools` | `Profiler` |

## `WebGL2Renderer`

```ts
class WebGL2Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  stats: RendererStats;

  clearColor: { r, g, b, a };
  pixelRatio: number;

  ssaoEnabled: boolean;
  ssaoRadius: number;
  ssaoBias: number;

  postProcessingEnabled: boolean;
  bloomEnabled: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  chromaticAberrationEnabled: boolean;
  chromaticAberrationOffset: number;
  vignetteEnabled: boolean;
  vignetteDarkness: number;
  vignetteOffset: number;

  constructor(canvas: HTMLCanvasElement, opts?: { antialias?: boolean });
  resize(width: number, height: number): void;
  render(scene: Scene, camera: Camera): void;
  clear(): void;
  getProgram(key: string, vert: string, frag: string, defines?: string[]): ShaderProgram;
  dispose(): void;
}
```

| `RendererStats` | |
| --------------- | --- |
| `drawCalls: number` | total draw calls last frame |
| `triangles: number` | total triangles last frame |
| `shadowPasses: number` | number of shadow passes |
| `programs: number` | shader-program cache size |
| `drawCallBreakdown: Record<string, DrawCallEntry>` | per-mesh breakdown (`{calls, triangles, passes:{main, shadow, ssao, helper}}`) |

## `StandardMaterial`

```ts
class StandardMaterial implements Material {
  uuid: string;
  type: 'Standard';
  baseColor: { r, g, b };
  metallic: number;       // 0..1
  roughness: number;      // 0..1
  emissive: { r, g, b };
  emissiveIntensity: number;
  opacity: number;        // 0..1
  receiveShadow: boolean;

  // PBR maps (WebGL2 texture objects, lazily uploaded)
  map: Texture | null;
  normalMap: Texture | null;
  metallicRoughnessMap: Texture | null; // glTF convention: G=roughness, B=metallic
  emissiveMap: Texture | null;

  program: ShaderProgram | null;
  static fromHex(hex: string): StandardMaterial;
}
```

`ShaderMaterial` extends `BasicMaterial` and adds `vertexSrc`, `fragmentSrc`,
`defines`, `uniforms` (a `Record<string, number | boolean | [number, number, number] | Texture>`).

## `Scene`, `Group`, `Mesh`, `Object3D`

```ts
class Object3D {
  uuid: string; name: string;
  position: Vector3; rotation: Quaternion; scale: Vector3;
  matrix: Matrix4; matrixWorld: Matrix4;
  parent: Object3D | null; children: Object3D[];
  visible: boolean; userData: Record<string, unknown>;
  add(child: Object3D | Object3D[]): this;
  remove(child: Object3D): this;
  traverse(visitor: (o: Object3D) => void): void;
  updateMatrixWorld(force?: boolean): void;
  lookAt(x: number | Vector3, y?: number, z?: number): void;
}
class Group extends Object3D { type: 'Group' }
class Mesh extends Object3D {
  geometry: BufferGeometry;
  material: Material | Material[];
  castShadow: boolean; receiveShadow: boolean;
}
class Scene extends Object3D { type: 'Scene' }
```

## `BufferGeometry` / `BufferAttribute`

```ts
class BufferAttribute {
  array: Float32Array | Uint16Array | Uint32Array | ...;
  itemSize: number; count: number; version: number;
  usage: number; // gl.STATIC_DRAW / DYNAMIC_DRAW
  needsUpdate: boolean; // hint; renderer always re-uploads dynamic position
  setUsage(hint: number): this;
}
class BufferGeometry {
  attributes: Record<string, BufferAttribute>;
  index: BufferAttribute | null;
  setAttribute(name: string, attr: BufferAttribute): this;
  getAttribute(name: string): BufferAttribute | undefined;
  setIndex(attr: BufferAttribute | Uint16Array | Uint32Array | null): this;
  computeBoundingSphere(): void;
  dispose(): void;
}
```

## Cameras

```ts
class Camera extends Object3D {
  projectionMatrix: Matrix4;
  projectionMatrixInverse: Matrix4;
  matrixWorldInverse: Matrix4;
  updateProjectionMatrix(): void;
}
class PerspectiveCamera extends Camera {
  fov: number; aspect: number; near: number; far: number;
}
class OrthographicCamera extends Camera {
  left: number; right: number; top: number; bottom: number; near: number; far: number;
}
```

## Controls

```ts
class OrbitControls {
  constructor(camera: Camera, domElement: HTMLElement);
  enableDamping: boolean; dampingFactor: number;
  minDistance: number; maxDistance: number;
  target: Vector3;
  update(): void;
  dispose(): void;
}
```

## Lights

```ts
class Light extends Object3D {
  color: { r, g, b };
  intensity: number;
}
class AmbientLight extends Light { type: 'AmbientLight' }
class DirectionalLight extends Light {
  type: 'DirectionalLight';
  direction: { x, y, z }; // light TRAVELS in (three.js convention)
  castShadow: boolean;
  shadowMapSize: number;       // square FBO; default 1024
  shadowHalfSize: number;      // ortho frustum half-extent
  shadowNear: number; shadowFar: number;
  shadowBias: number;
}
```

## Geometries

| Class | Args |
| ----- | ---- |
| `BoxGeometry` | `(width, height, depth, widthSeg?, heightSeg?, depthSeg?)` |
| `SphereGeometry` | `(radius, widthSeg?, heightSeg?)` |
| `PlaneGeometry` | `(width, height, widthSeg?, heightSeg?)` |
| `CylinderGeometry` | `(radiusTop, radiusBottom, height, radialSeg?, heightSeg?)` |
| `ConeGeometry` | `(radius, height, radialSeg?)` (internally a Cylinder with top=0) |
| `TorusGeometry` | `(radius, tube, radialSeg?, tubularSeg?)` |

## Loaders

```ts
class GLBLoader implements Loader<LoadedGLB> {
  load(source: AssetSource, ctx?: LoaderContext): Promise<LoadedGLB>;
}
type LoadedGLB = { root: Group; animations: AnimationClip[]; materials: StandardMaterial[] };

class HDRLoader implements Loader<LoadedHDR> {
  load(source: AssetSource, ctx?: LoaderContext): Promise<LoadedHDR>;
}
type LoadedHDR = { texture: Texture; width: number; height: number };

class TextureLoader implements Loader<Texture> { ... }

function parseOBJ(text: string): ParsedOBJ;
function exportOBJ(group: Group, opts?: { flipY?: boolean }): string;
function getDracoModule(): Promise<DracoModule>;
function decodeDraco(bytes: Uint8Array, attrs: DracoAttributeSpec[]): Promise<DecodedMesh>;

class AssetManager {
  register(kind: string, loader: Loader<unknown>): void;
  load<T>(kind: string, source: AssetSource, ctx?: LoaderContext): Promise<T>;
  getCacheStats(): { hits: number; misses: number; evictions: number; size: number };
}
```

## Animation

```ts
class AnimationMixer {
  constructor(root: Object3D);
  actionFor(clip: AnimationClip): AnimationAction;
  update(dt: number): void;
}
class AnimationAction {
  play(): this; stop(): this; reset(): this;
  loop: 'once' | 'repeat' | 'pingpong';
  timeScale: number; weight: number;
}
class AnimationStateMachine {
  addState(s: AnimMachineState): this;
  setInitial(name: string): this;
  addTransition(t: AnimTransition): this;
  bind(mixer: AnimationMixer): void;
  tick(world: World, entityId: number, dt: number): void;
}
function buildHumanoid(opts?: { scale?: number; skinColor?: { r, g, b } }): HumanoidBundle;
```

## ECS

```ts
class World {
  constructor(opts?: WorldOptions);
  createEntity(name?: string): EntityId;
  destroyEntity(id: EntityId): void;
  addComponent<T>(id: EntityId, comp: T & { type: string }): void;
  removeComponent(id: EntityId, type: string): void;
  getComponent<T>(id: EntityId, type: string): T | undefined;
  query(...types: string[]): EntityId[];
  addSystem(system: System): this;
  update(dt: number): void;
  serialize(): WorldJson;
  static deserialize(json: WorldJson): World;
  snapshot(): WorldSnapshot;
}
abstract class System {
  readonly name: string;
  priority: number; // smaller runs first
  abstract update(world: World, dt: number): void;
}

function defineComponentType<T>(defaults: () => T): ComponentType<T>;
```

### Built-in components

`Transform`, `Velocity`, `MeshRef`, `SkinnedMeshRef`, `AnimState`, `Health`,
`Tag`, `Lifetime`, `PlayerInput`, plus the physics set: `Collider`,
`Rigidbody`, `PhysicsConfig`, `Particle`, `ParticleEmitter`, `PhysicsDebug`.

### Built-in systems

`MovementSystem`, `AnimationTickSystem`, `AnimStateSystem`,
`PlayerInputSystem`, `LifetimeSystem`, `PhysicsSystem`, `CollisionSystem`,
`ParticleSystem`, `PhysicsDebugSystem`.

## Physics

```ts
function installPhysicsSystems(world: World): void;
function createPhysicsConfigEntity(world: World): EntityId;
function createPhysicsDemo(world: World, opts?: PhysicsDemoOptions): EntityId[];
function syncMeshesFromTransforms(world: World): void;
```

## Helpers

```ts
function createGridMesh(renderer: WebGL2Renderer, opts: GridHelperOptions): Mesh;
function createLineMesh(opts: { positions: Float32Array; colors?: Float32Array; program: ShaderProgram }): LineMesh;
class PhysicsDebugRenderer {
  attach(world: World): void;
  detach(): void;
  enabled: boolean;
  stats: PhysicsDebugStats;
}
```

## `Profiler`

```ts
class Profiler {
  start(): void; stop(): void;
  beginFrame(): void; endFrame(): void;
  markCpu(name: string): void; markCpuEnd(name: string): void;
  markGpu(name: string): void; markGpuEnd(name: string): void;
  recordDrawCall(sample: DrawCallSample): void;
  readonly samples: FrameSample[];   // ring buffer (capacity = 60 by default)
  readonly onSample: Set<(s: FrameSample) => void>;
}
```

## Logger

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
interface LogEntry { level: LogLevel; module: string; message: string; timestamp: number; }
type LogSink = (entry: LogEntry) => void;

function createLogger(module: string): Logger;
function setLoggerSink(sink: LogSink | null): void;
function setMinLevel(level: LogLevel): void;
function getMinLevel(): LogLevel;
```

Set a global default before the bundle loads via
`window.__VREEN_ENGINE_LOG_LEVEL__` to silence the console in production.

## Math

```ts
class Vector3 { x, y, z; set, copy, add, sub, multiplyScalar, length, normalize, ... }
class Quaternion { x, y, z, w; setFromEuler, setFromAxisAngle, multiply, normalize, slerp, ... }
class Matrix4 {
  elements: Float32Array(16);
  setPosition, lookAt, multiply, multiplyMatrices, invert, getNormalMatrix,
  makeTranslation, makeRotationFromQuaternion, makeScale, compose, decompose, ...
}
class MathUtils { clamp, lerp, smoothstep, degToRad, radToDeg, generateUUID, ... }
```

## Conventions

- `null` vs `undefined`: textures are `null` until assigned.
- All `Object3D.position` is a real `Vector3` instance — mutate it
  (`mesh.position.x = 1`) and call `updateMatrixWorld(true)` to push.
- The renderer is fully reentrant-safe: no global state, two renderers
  can co-exist (one per canvas).
- All `WebGL2` programs use `layout(location = N)` for attributes; the
  VAO cache uses fixed locations `0=position, 1=normal, 2=uv, 3=color,
  4=tangent, 5=skinIndex, 6=skinWeight`.
