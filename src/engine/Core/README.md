# Core Module

> Path: `src/engine/Core/`
>
> The foundation of the `@vreen/engine` kernel. Provides the scene graph
> (`Object3D` / `Scene` / `Group` / `Mesh` / `SkinnedMesh`), the buffer
> geometry and attribute layer, the material base class, the texture
> family (2D / cube / data / depth / video / canvas / compressed), morph
> targets, fog, raycasting, frustum culling, scene-graph processing,
> area-weighted surface sampling (`MeshSurfaceSampler`), and the Gem-style
> `ModuleRegistry`.

---

## Overview

```
Object3D ──base──→ Scene
   ├── Group
   ├── Mesh ──holds──→ BufferGeometry + Material
   │     ├── SkinnedMesh ──binds──→ Skeleton + Bone[]
   │     ├── InstancedMesh ──uses──→ InstancedBufferAttribute
   │     └── Sprite (billboard)
   ├── LOD ──switches──→ Mesh[] by distance
   ├── Text / BitmapText ──uses──→ TextAtlas
   └── FurShell ──multi-layer──→ Mesh[] (FurMaterial)

BufferGeometry ──holds──→ BufferAttribute / InstancedBufferAttribute
   └── MorphTargets ──driven by──→ MorphTargetAnimation

Texture family:
   Texture (base) ──→ CubeTexture / DataTexture / DataArrayTexture /
                      DepthTexture / VideoTexture / CanvasTexture /
                      CompressedTexture
   Source ──wraps──→ pixel data (data / width / height / version)

Scene services:
   SceneGraphProcessor ──updates──→ world matrices + dirty propagation
   FrustumCuller ──culls──→ Object3D by Frustum + Box3/Sphere
   SceneStats ──aggregates──→ mesh/light/draw-call/triangle counts
   Raycaster ──uses──→ BVH (preferred) or brute force
   MeshSurfaceSampler ──samples──→ area-weighted points on BufferGeometry
   Fog / FogExp2 ──attached to──→ Scene.fog

ModuleRegistry ──manages──→ EngineModule lifecycle (load/unload/dependencies)
```

---

## Core Classes

### Scene Graph

| Export | Role |
|--------|------|
| `Object3D` | Base node. Holds local `position` / `rotation` / `scale` / `quaternion`, `parent` / `children`, world matrix, and an embedded `DirtyFlag`. |
| `DirtyFlag` | Per-node dirty bits for `transform` / `matrix` / `worldMatrix`; propagated down by `SceneGraphProcessor`. |
| `Scene` | Root node. Owns `background`, `environment`, `fog`, and the renderable child tree. |
| `Group` | Transparent container — no geometry/material, just children. |
| `Mesh` | Renderable leaf. Holds `geometry: BufferGeometry` and `material: Material`. |
| `SkinnedMesh` | Mesh with `skeleton: Skeleton` and `bindMatrix` / `bindMatrixInverse`. Drives GPU skinning. |
| `Bone` | Scene-graph node participating in a `Skeleton`. |
| `Skeleton` | Bone hierarchy + `boneMatrices` UBO data; `update()` recomputes per-bone world matrices. |
| `InstancedMesh` | Mesh drawn N times with per-instance matrices (and optional per-instance colors). |
| `LOD` | Switches child meshes by camera distance against `LODLevel[]` thresholds. |
| `Sprite` | Always-camera-facing billboard. CPU writes camera world rotation in `updateMatrixWorld`. |
| `Text` | 3D text rendered via `TextAtlas` quads + `MeshBasicMaterial`. Supports wrapping/alignment. |
| `BitmapText` | Text using a pre-rendered `TextAtlas` for large shared-atlas batches. |
| `TextAtlas` | Rasterises characters to a canvas + records UVs; emits `CanvasTexture`. Degrades to dry-run without DOM. |
| `FurShell` | Multi-layer shell fur: N concentric shell meshes sharing base geometry, each bound to a `FurMaterial` with `shellLayer` 0..1. |

```ts
interface LODLevel { distance: number; object: Object3D; hysteresis?: number; }
```

### Geometry & Attributes

| Export | Role |
|--------|------|
| `BufferGeometry` | Vertex attribute container + optional index. Carries `boundingBox` / `boundingSphere`, `morphTargets`, optional `bvh`. `version` increments on attribute edits. Supports `addGroup` / `clearGroups` for multi-material draw groups. |
| `BufferAttribute` | Typed-array view over one attribute (`position` / `normal` / `uv` / etc.). `version` increments on `set` / `setXY` / `setXYZ`. |
| `InstancedBufferAttribute` | Per-instance attribute; `meshPerAttribute` maps to `gl.vertexAttribDivisor(loc, N)` (default 1). |

### BufferGeometry Utilities

Adapted from three.js `BufferGeometryUtils.js`. All functions are pure (do not
mutate inputs unless stated); `computeTangents` is the only exception and
mutates the input geometry in place to add the `tangent` attribute.

| Export | Role |
|--------|------|
| `mergeGeometries(geometries, useGroups?)` | Concatenate N geometries into one. Validates attribute consistency (name + itemSize). Indexed/non-indexed must not mix. When `useGroups=true`, emits `addGroup` entries so each input can still use its own material. |
| `weldVertices(geometry, tolerance=1e-4)` | Merge vertices within `tolerance` (position-based). Uses a spatial hash grid for O(n) average-case search (27-neighbour query). Returns a new geometry with compacted index and remapped attributes. Non-indexed inputs are auto-converted via `toIndexed`. |
| `computeTangents(geometry)` | Per-vertex tangent space for normal mapping (Lengyel's method). Requires `position` / `normal` / `uv`. Accumulates tangents per face, then Gram-Schmidt orthogonalises against the normal and applies handedness correction from the bitangent. **Mutates** the input, adds a `tangent` attribute (itemSize=3). |
| `estimateBytesUsed(geometry)` | GPU memory estimate: sums each attribute's `byteLength`, then accounts for the index using `Uint16` (<65536 max index) or `Uint32` per vertex. |
| `interleaveAttributes(attributes)` | Pack N attributes into a single interleaved `Float32Array`. Returns `{ array, stride, offsets }` for `glVertexAttribPointer`. All inputs must share the same `count`. |
| `toIndexed(geometry)` | Convert a non-indexed geometry to indexed by deduplicating position-identical vertices (spatial hash). Indexed inputs return a clone. |
| `deduplicateIndices(geometry)` | Remove duplicate triangles (same 3 indices, any winding) from an indexed geometry. Returns a new geometry. |

### Surface Sampling

`MeshSurfaceSampler` (`MeshSurfaceSampler.ts`) — area-weighted random
surface point sampler. Distributes points uniformly across a mesh's
surface, with larger triangles receiving proportionally more samples.
Supports an optional weight attribute to bias sampling toward high-weight
regions (e.g. dense vegetation on fertile terrain).

Adapted from three.js `examples/jsm/math/MeshSurfaceSampler.js` (r169).

**Algorithm**:

1. `build()` — iterate all triangles, compute area × optional weight,
   build a cumulative distribution function (CDF) normalised to [0, 1].
2. `sample()` — binary-search the CDF to pick a triangle (larger area →
   longer CDF interval → higher hit probability), then use barycentric
   coordinates to sample a uniform point inside that triangle.

**Barycentric uniform sampling** (Osada et al. 2002):
```
u = random(), v = random()
a = 1 - sqrt(u)
b = v * sqrt(u)
c = 1 - a - b          // = sqrt(u) * (1 - v)
point = a*A + b*B + c*C
```
The `sqrt(u)` term is critical — without it, points cluster near the
triangle centroid.

| Export | Role |
|--------|------|
| `MeshSurfaceSampler` | Sampler. Constructor: `(geometry: BufferGeometry)`. |
| `SampleResult` | `{ position: Vector3; normal?: Vector3; color?: [r,g,b] }` returned by sampling. |

| Method | Description |
|--------|-------------|
| `setWeightAttribute(name)` | Bias sampling by a per-vertex attribute (multi-channel attributes use first channel). Must be called before `build()`. |
| `build()` | Compute CDF. Chainable. Throws if `position` attribute is missing. |
| `sample(targetPosition, targetNormal?, targetColor?)` | Sample one point. `targetPosition` is required; normal and color are optional outputs. |
| `sampleBatch(n)` | Sample `n` points, returning a fresh `Vector3[]`. |
| `totalArea` (getter) | Last CDF value (1.0 if normalised, total area otherwise). |
| `triangleCount` (getter) | Number of triangles in the source geometry. |

```ts
const sampler = new MeshSurfaceSampler(terrainGeometry);
sampler.setWeightAttribute('fertility').build();

const positions = sampler.sampleBatch(1000);
for (const p of positions) {
  placeTreeAt(p);
}

// Single sample with normal + color
const pos = new Vector3();
const nrm = new Vector3();
const col: [number, number, number] = [0, 0, 0];
sampler.sample(pos, nrm, col);
```

### Materials

| Export | Role |
|--------|------|
| `BasicMaterial` | Base material with uniforms, textures, `DoubleSide` default, `onBeforeCompile` GLSL injection hook. PBR/physical/basic variants extend this. |
| `Material` (type) | Structural type for the material contract consumed by the renderer. |

### Textures

| Export | Role |
|--------|------|
| `Texture` | Base 2D texture. Sampling state (`wrapS/T`, `minFilter`, `magFilter`, `anisotropy`) + `version`. |
| `CubeTexture` | 6-face environment texture (`px/nx/py/ny/pz/nz`). |
| `DataTexture` | Typed-array backed texture for runtime-generated images. |
| `DataArrayTexture` | 2D-array texture (`wrapR` added). |
| `DepthTexture` | Depth/stencil texture for shadow maps / depth pre-pass; `DepthCompareFunction`. |
| `VideoTexture` | Texture sourced from a playing `HTMLVideoElement`; `update()` polls `video.readyState`. |
| `CanvasTexture` | Texture sourced from a `Canvas`; `update()` re-uploads on version bump. |
| `CompressedTexture` | S3TC / ETC / BPTC / PVRTC / ASTC compressed texture base with mipmap chain. |
| `Source` | Decoupled data source (`data` / `width` / `height` / `version` + `needsUpdate()`). |

### Morph Targets

| Export | Role |
|--------|------|
| `MorphTargets` | Absolute-position targets + weights + name lookup. Application rule: `result[i] = base[i] + Σ(target - base) * influence`. Mounted on `mesh.morphTargets`; renderer calls `update(geometry)` per draw, bumping position `version`. |
| `MorphTargetAnimation` | Driver holding `MorphTargets` + `MorphTargetTrack[]` (times + scalar values, binary-search + lerp). `update(dt)` advances time and writes influences. |
| `MorphTargetTrack` | Single morph track — times + values + target name. |

### Scene Services

| Export | Role |
|--------|------|
| `SceneGraphProcessor` | Traverses the scene: updates world matrices, propagates `DirtyFlag`, flattens render list before draw. Emits `SceneGraphStats`. |
| `SceneStats` | Aggregates mesh / light / draw-call / triangle counts for the Profiler HUD and `PerformanceReport`. |
| `FrustumCuller` | Culls `Object3D` against a `Frustum` using `Box3` / `Sphere` bounds; honours `Object3D.frustumCulled`. Emits `FrustumCullStats`. |
| `Raycaster` | Ray-vs-scene intersection. Prefers `MeshBVH` when attached; falls back to brute-force triangle tests. Exports `intersectGeometry` helper. |
| `Fog` | Linear fog (`near` / `far` / `color`). |
| `FogExp2` | Exponential-squared fog (`density` / `color`). |

### Module Registry

| Export | Role |
|--------|------|
| `ModuleRegistry` | Gem-style engine module registry (inspired by o3de Gems). Manages `EngineModule` load/unload lifecycle, dependency graph, and manifest import. |
| `getDefaultModuleRegistry()` | Process-level singleton accessor. |
| `resetDefaultModuleRegistry()` | Test helper — disposes and recreates the singleton. |

```ts
interface EngineModule {
  name: string;
  dependencies?: string[];
  onLoad?: () => void;
  onUnload?: () => void;
}
```

---

## Usage Example

```ts
import {
  Scene, Group, Mesh, SkinnedMesh, Skeleton, Bone,
  BufferGeometry, BufferAttribute, InstancedMesh,
  BoxGeometry, StandardMaterial, Texture, DataTexture,
  SceneGraphProcessor, FrustumCuller, MorphTargets,
  MeshSurfaceSampler,
} from '@vreen/engine/core';
import { Vector3 } from '@vreen/engine/math';

const scene = new Scene();
const group = new Group();
scene.add(group);

const mesh = new Mesh(
  new BoxGeometry(1, 1, 1),
  new StandardMaterial({ baseColor: { r: 0.8, g: 0.4, b: 0.2 } }),
);
group.add(mesh);

// Skinned mesh
const bones = [new Bone(), new Bone()];
bones[0].add(bones[1]);
const skeleton = new Skeleton(bones);
const skinned = new SkinnedMesh(geometry, material, skeleton);
skeleton.update();

// Instanced rendering
const instanced = new InstancedMesh(geometry, material, 100);
for (let i = 0; i < 100; i++) {
  instanced.setMatrixAt(i, /* model matrix */);
}
instanced.instanceMatrix.needsUpdate = true;

// Morph targets
const morph = new MorphTargets();
morph.addTarget('smile', smilePositions);
morph.setInfluence('smile', 0.5);
mesh.morphTargets = morph;

// Per-frame scene processing
const processor = new SceneGraphProcessor();
processor.process(scene, camera);   // updates world matrices + dirty flags
const culler = new FrustumCuller();
culler.cull(scene, camera);         // marks Object3D.frustumCulled results

// Runtime-generated texture
const data = new Uint8Array(256 * 256 * 4);
const tex = new DataTexture(data, 256, 256);
tex.needsUpdate = true;

// Surface sampling — scatter vegetation on terrain
const sampler = new MeshSurfaceSampler(terrainGeometry).build();
const treePositions = sampler.sampleBatch(500);
for (const p of treePositions) {
  scene.add(makeTreeMesh(p));
}
```

---

## Invariants

- **`updateWorldMatrix` alias.** Custom-engine `Object3D` implements
  `updateWorldMatrix()` as an alias for `updateMatrixWorld(true)` so
  three.js helpers (e.g. `Box3.setFromObject`) do not throw `TypeError`
  and trigger WebGL context loss. Use `computeWorldBoxCustom` for
  custom-engine objects.
- **Dirty propagation.** `DirtyFlag` is *additive* — setting a child's
  transform flag does not clear parent flags. `SceneGraphProcessor` is
  the single authoritative resolver; mutating world matrices outside it
  breaks culling and bounds.
- **Geometry versioning.** `BufferGeometry.version` and per-attribute
  `version` are monotonic. The renderer caches VAOs keyed on
  `geometry.uuid` and re-uploads only when `version` changes; manually
  editing typed arrays without bumping `version` produces stale GPU
  buffers.
- **Morph application rule.** Morphs are absolute-position deltas:
  `result[i] = base[i] + Σ(target - base) * influence`. Reordering base
  and target data or mixing relative deltas produces visible corruption.
- **Material `DoubleSide`.** Materials default to `DoubleSide` to avoid
  backface-culling artefacts on procedural geometry; flipping to
  `FrontSide` requires consistent winding order.
- **Bounds recomputation.** `computeBoundingSphere()` must be called
  after geometry conversion / morph application; the renderer and
  `FrustumCuller` rely on accurate bounds and silently skip meshes with
  empty spheres.
- **`TextAtlas` DOM dependency.** Without a DOM (`jsdom` / SSR / tests)
  `TextAtlas` degrades to dry-run mode — `Text` / `BitmapText` produce
  no visible glyphs. Tests must not assert rendered text in headless
  environments.
- **`ModuleRegistry` singleton.** `getDefaultModuleRegistry()` is
  process-level; tests must call `resetDefaultModuleRegistry()` between
  cases to avoid cross-test module leakage.
- **Texture `version`.** Mutating a texture's `Source` data must be
  followed by `source.needsUpdate()` (or `texture.needsUpdate = true`)
  — the renderer only re-uploads on version change.
- **`MeshSurfaceSampler.build()` must precede `sample()`.** Calling
  `sample()` before `build()` throws; the CDF must be computed first.
  Rebuilding is required if the source geometry's `position` attribute
  changes.
- **`MeshSurfaceSampler` normal output is face normal.** `sample()`
  returns the triangle's face normal via `Triangle.getNormal`, not the
  interpolated vertex normal. Use the geometry's `normal` attribute
  directly if smooth normals are needed.
- **`MeshSurfaceSampler` does not mutate the source geometry.** All
  sampling reads are side-effect-free; the geometry can be shared
  across multiple samplers.

---

## References

- `src/engine/Animation/README.md` — `SkinnedMesh` / `Skeleton` /
  `Bone` are consumed by `AnimationMixer` for GPU skinning.
- `src/engine/Renderer/README.md` — `WebGL2Renderer` caches
  `MeshResources` keyed on `BufferGeometry.uuid` / `version` and
  `ShadowResources` keyed on `DepthTexture` lifecycle.
- `src/engine/Geometries/README.md` — procedural geometries extend
  `BufferGeometry` and populate `position` / `normal` / `uv` attributes.
- `src/engine/Materials/` — `StandardMaterial` / `MeshPhysicalMaterial`
  extend `BasicMaterial` with PBR uniforms.
- `src/engine/Acceleration/MeshBVH` — attached to
  `BufferGeometry.bvh`; consumed by `Raycaster` for accelerated
  ray-triangle tests.
- `src/engine/Tools/PerformanceReport` — consumes `SceneStats` for
  per-frame HUD aggregation.
- three.js `examples/jsm/math/MeshSurfaceSampler.js` — original
  implementation adapted for `MeshSurfaceSampler.ts`.
- Osada et al. "Shape Distributions" (2002) — barycentric uniform
  sampling reference.
