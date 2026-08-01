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
   │     ├── BatchedMesh ──merges──→ N geometries into 1 buffer
   │     ├── Sprite (billboard)
   │     └── Points (GL_POINTS point cloud)
   ├── Line ──LINE_STRIP──→ BufferGeometry vertex chain
   │     ├── LineSegments ──LINES──→ vertex pairs (0-1)(2-3)…
   │     └── LineLoop ──LINE_LOOP──→ Line + closing edge (last→first)
   ├── LineSegments2 ──screen-space quad──→ LineSegmentsGeometry + LineMaterial
   │     └── Line2 ──polyline chain──→ LineGeometry + LineMaterial
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
| `BatchedMesh` | Dynamic multi-geometry batching — merges N different geometries into one vertex/index buffer for reduced draw calls. Per-batch matrix / visibility / bounding box. |
| `LOD` | Switches child meshes by camera distance against `LODLevel[]` thresholds. |
| `Sprite` | Always-camera-facing billboard. CPU writes camera world rotation in `updateMatrixWorld`. |
| `Points` | Point-cloud / point-sprite node. Renders every `position` vertex as a `GL_POINTS` primitive via `PointsMaterial`. Supports threshold-based raycast picking. |
| `Line` / `LineSegments` / `LineLoop` | Line nodes. `Line` = `GL_LINE_STRIP` (connected chain), `LineSegments` = `GL_LINES` (independent pairs), `LineLoop` = `GL_LINE_LOOP` (chain + closing edge). Threshold-based edge raycast via `Ray.distanceSqToSegment`. |
| `LineSegments2` / `Line2` | Thick-line nodes (screen-space quad expansion). `LineSegments2` = independent thick segments, `Line2` = thick polyline. Breaks `gl.lineWidth=1` cap via instanced quad expansion + `LineMaterial`. Threshold-based raycast via `Raycaster.params.Line2`. |
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
| `BufferGeometry` | Vertex attribute container + optional index. Carries `boundingBox` / `boundingSphere`, `morphTargets`, optional `bvh`. `version` increments on attribute edits. Supports `addGroup` / `clearGroups` for multi-material draw groups. Instance methods: `computeVertexNormals()` (flat + averaged normals), `computeTangents()` (MikkTSpace tangent space, vec4 with handedness w), `computeBoundingBox()` / `computeBoundingSphere()`, `applyMatrix4()`, `clone()`, `toJSON()`, `dispose()`. |
| `BufferAttribute` | Typed-array view over one attribute (`position` / `normal` / `uv` / etc.). `version` increments on `set` / `setXY` / `setXYZ`. |
| `InstancedBufferAttribute` | Per-instance attribute; `meshPerAttribute` maps to `gl.vertexAttribDivisor(loc, N)` (default 1). |

### Tangent Space (Normal Mapping)

VREEN provides **two** tangent-space implementations. The instance method is
the recommended primary API (matches three.js / Unreal / Unity convention);
the utility function is kept as a legacy alternative.

#### `BufferGeometry.computeTangents()` — MikkTSpace (recommended)

Implements the MikkTSpace algorithm (Morten S. Mikkelsen,
"Generating Tangent Space Basis Vectors for an Arbitrary Mesh", 2011).
This is the industry-standard tangent space used by three.js, Unreal Engine,
Unity, and the de-facto reference for content-authoring tools (Blender,
Substance Painter, Marmoset Toolbag). Using MikkTSpace on both engine and
authoring sides guarantees that normal maps authored in any DCC tool render
without lighting seams or mirrored-tangent artifacts.

**API**:
```ts
class BufferGeometry {
  computeTangents(): void;
}
```

**Requirements**: `position`, `normal`, and `uv` attributes (any of these
missing → no-op, no throw). Works on both indexed and non-indexed geometries.

**Output**: `tangent` attribute, `itemSize = 4`:
- `xyz` = tangent direction (unit vector, Gram-Schmidt orthogonalised
  against the vertex normal so `dot(t, n) ≈ 0`)
- `w`   = handedness sign `±1` (encodes bitangent direction:
  `bitangent = w * cross(normal, tangent.xyz)`)

**Algorithm** (per triangle):
1. Compute position edges `e1 = v1 - v0`, `e2 = v2 - v0`.
2. Compute UV deltas `dUV1 = uv1 - uv0`, `dUV2 = uv2 - uv0`.
3. Determinant `det = dUV1.x * dUV2.y - dUV1.y * dUV2.x`.
4. **Degenerate UV fallback**: if `|det| < 1e-10` (zero-area or mirrored UV
   triangle), substitute identity deltas `(1,0),(0,1)` and `det = 1`. This
   keeps tangent generation robust on meshes with bad UVs.
5. `tangent    = (dUV2.y * e1 - dUV1.y * e2) / det`
6. `bitangent  = (dUV1.x * e2 - dUV2.x * e1) / det`
7. Accumulate `tangent` into the 3 vertex slots; accumulate handedness
   sign `dot(cross(faceNormal, tangent), bitangent) < 0 ? -1 : +1`.
8. Per-vertex Gram-Schmidt: `t = normalize(t - n * dot(n, t))`.
9. Final `w = (accumulated handedness < 0) ? -1 : +1`.

**Why vec4 + separate `w`** (not vec3 with `w` baked into direction):
Baking handedness into the direction (multiplying `t.xyz` by `w`) is
incorrect for mirrored UVs — it flips the tangent axis, which the shader
cannot distinguish from a 180° rotation, producing wrong lighting on
mirrored sub-meshes (e.g. symmetric character faces). Storing `w` as a
separate component lets the shader reconstruct the true bitangent:
`bitangent = w * cross(normal, tangent.xyz)`.

**Differences from three.js `BufferGeometry.computeTangents()`**:
- Identical algorithm and output layout (vec4, `w = ±1`).
- VREEN adds the **degenerate UV fallback** (three.js skips degenerate
  faces entirely, leaving zero tangents; VREEN substitutes identity deltas
  so every vertex gets a valid tangent).
- VREEN uses face-normal approximation from averaged vertex normals for
  handedness, instead of recomputing geometric face normals — this keeps
  the implementation O(1) per face and avoids needing position-only edges.

**Test coverage** (`BufferGeometry.test.ts`, 16 tests):
- Missing attribute safety (position / normal / uv).
- itemSize = 4, correct vertex count.
- Tangent ⟂ normal (`dot ≈ 0`).
- Tangent unit length (`‖t‖ ≈ 1`).
- Tangent direction aligns with `+u` UV axis.
- Handedness `w ∈ {+1, -1}`.
- Standard UV → `w = +1`; mirrored UV (u flipped) → `w = -1`.
- Degenerate UV (zero-area) → valid tangent via identity fallback.
- Indexed vs non-indexed produce identical results on same topology.
- Version increment; idempotent on repeated calls.
- 3D cube: tangents stay orthogonal to per-face normals.

#### `computeTangents(geometry)` — Lengyel (legacy utility)

Kept in `BufferGeometryUtils.ts` for backwards compatibility. Uses Eric
Lengyel's method ("Computing Tangent Space Basis Vectors for an Arbitrary
Mesh", Terathon 2011) — mathematically equivalent to MikkTSpace but stores
the result as `itemSize = 3` with handedness **baked into the tangent
direction** (`t.xyz *= w`). This convention is incorrect for mirrored UVs
(see note above) and is **not recommended** for new content. New code
should call the instance method `geometry.computeTangents()` instead.

### BufferGeometry Utilities

Adapted from three.js `BufferGeometryUtils.js`. All functions are pure (do not
mutate inputs unless stated); `computeTangents` is the only exception and
mutates the input geometry in place to add the `tangent` attribute.

| Export | Role |
|--------|------|
| `mergeGeometries(geometries, useGroups?)` | Concatenate N geometries into one. Validates attribute consistency (name + itemSize). Indexed/non-indexed must not mix. When `useGroups=true`, emits `addGroup` entries so each input can still use its own material. |
| `weldVertices(geometry, tolerance=1e-4)` | Merge vertices within `tolerance` (position-based). Uses a spatial hash grid for O(n) average-case search (27-neighbour query). Returns a new geometry with compacted index and remapped attributes. Non-indexed inputs are auto-converted via `toIndexed`. |
| `computeTangents(geometry)` | **Legacy** Lengyel tangent space (itemSize=3, handedness baked into direction). Prefer `geometry.computeTangents()` (MikkTSpace, vec4) for new code. Requires `position` / `normal` / `uv`; auto-converts non-indexed via `toIndexed`. **Mutates** the input. See "Tangent Space" section above for the full comparison. |
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

### Scene Graph Utilities & Special Nodes

#### `Points` (`Points.ts`)

Point-cloud / point-sprite node — renders every `position` vertex of a
`BufferGeometry` as a single `GL_POINTS` primitive. Used for particle
systems, scanned point-cloud data, starfields, debug markers, and any
effect that needs thousands of independent dots.

Extends `Object3D`; holds `geometry: BufferGeometry` and
`material: PointsMaterial | PointsMaterial[]`. The geometry's `index`
is ignored — points are drawn in `position` vertex order.

**Raycast** (threshold-based picking): for each vertex, computes the
distance from the ray to the point (in geometry-local space) and keeps
the hit if `distance² ≤ localThreshold²`. `localThreshold` is derived
from `raycaster.params.Points.threshold` divided by the mean of the
three axis scales (`meanScale = (sx+sy+sz)/3`), so a uniformly scaled-up
cloud needs a larger world-space threshold to pick — matching three.js
behaviour. Each hit fills `distance` (world-space ray-origin→hit),
`distanceToRay` (local perpendicular distance), `point` (world-space
closest point on ray), and `index` (the vertex index). A local-space
bounding-sphere test rejects the whole cloud early when the ray is far
away.

| Property | Type | Default | Role |
|----------|------|---------|------|
| `geometry` | `BufferGeometry` | `new BufferGeometry()` | Source of point positions. Only `position` is read. |
| `material` | `PointsMaterial \| PointsMaterial[]` | `new PointsMaterial()` | Render parameters (size, map, attenuation…). |
| `isPoints` | `boolean` | `true` | Duck-type flag. |
| `castShadow` / `receiveShadow` | `boolean` | `false` / `false` | Points never cast/receive shadows (matches three.js). |

```ts
import { Points, BufferGeometry, BufferAttribute } from '@vreen/engine/core';
import { PointsMaterial } from '@vreen/engine/materials';

const N = 5000;
const positions = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  // random points on a unit sphere
  const u = Math.random(), v = Math.random();
  const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
  positions[i * 3]     = Math.sin(phi) * Math.cos(theta);
  positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
  positions[i * 3 + 2] = Math.cos(phi);
}
const geo = new BufferGeometry();
geo.setAttribute('position', new BufferAttribute(positions, 3));

const points = new Points(geo, new PointsMaterial({
  color: { r: 0.3, g: 0.7, b: 1 },
  size: 0.04,
  sizeAttenuation: true,
}));
scene.add(points);

// Picking — threshold = 0.2 world units
const raycaster = createRaycasterFromMouse(...);
raycaster.params.Points.threshold = 0.2;
const hits = raycaster.intersectObject(points, false);
if (hits.length > 0) console.log('picked vertex', hits[0].index);
```

**Differences from three.js `Points`**:

- The bounding-sphere rejection test is done in **geometry-local space**
  (ray transformed by `matrixWorld⁻¹`), reusing VREEN's existing
  `Ray.distanceSqToPoint` + raw `boundingSphere` shape, instead of
  three.js's world-space `Sphere.applyMatrix4` path. Numerically
  equivalent.
- `castShadow` / `receiveShadow` are explicitly `false` by default
  (three.js leaves them `true` but the shadow map pass ignores Points
  anyway; VREEN makes the intent explicit).
- The local threshold fallback when `meanScale === 0` is the world
  `threshold` (avoids `Infinity`); three.js would produce `Infinity`
  and never hit, which is rarely the desired behaviour for a degenerate
  scale.

Adapted from three.js `src/objects/Points.js`.

#### `Line` / `LineSegments` / `LineLoop` (`Line.ts`)

Line nodes — render a `BufferGeometry`'s vertices as connected lines.
The three subclasses differ only in how vertices are paired into
segments (the `step` used by raycast and the GL primitive the renderer
issues):

| Class | GL primitive | Vertex pairing | `isLine` / `isLineSegments` / `isLineLoop` |
|-------|-------------|----------------|--------------------------------------------|
| `Line` | `GL_LINE_STRIP` | chain: 0-1, 1-2, 2-3, … | `true` / `false` / `false` |
| `LineSegments` | `GL_LINES` | pairs: 0-1, 2-3, 4-5, … | `true` / `true` / `false` |
| `LineLoop` | `GL_LINE_LOOP` | chain + closing edge (last→first) | `true` / `false` / `true` |

Extends `Object3D`; holds `geometry: BufferGeometry` and
`material: LineBasicMaterial | LineBasicMaterial[]`. Both indexed and
non-indexed geometry are supported. Used for wireframe overlays, debug
gizmos, CAD edge highlighting, graph edges, and any effect that needs
thin 1px lines. (For thick anti-aliased lines, use `Line2` +
`LineMaterial` — screen-space quad expansion; see `Line2` below.)

**Raycast** (threshold-based edge picking): for each segment, computes
the closest distance between the ray and the segment via
`Ray.distanceSqToSegment` (GeometricTools `DistRay3Segment3`, 6-region
clamping of `(s0, s1)`), in geometry-local space. A segment is kept if
`distSq ≤ localThresholdSq`, where `localThreshold = threshold /
meanScale`. A local-space bounding-sphere test rejects the whole line
early. Each hit fills `distance` (world-space ray-origin→closest-point-on-ray),
`point` (closest point on the segment, world space), and `index` (the
segment's start vertex index).

| Property | Type | Default | Role |
|----------|------|---------|------|
| `geometry` | `BufferGeometry` | `new BufferGeometry()` | Source of line vertices (`position`); `index` used if present. |
| `material` | `LineBasicMaterial \| LineBasicMaterial[]` | `new LineBasicMaterial()` | Color, linewidth, dashed params. |
| `isLine` / `isLineSegments` / `isLineLoop` | `boolean` | `true` / `false` / `false` | Duck-type flags driving the `step` and closing-edge logic. |

**`computeLineDistances()`**: populates a `lineDistance` attribute used
by dashed materials. For `Line`/`LineLoop` it stores the *cumulative*
distance from vertex 0 (0, d₀₁, d₀₁+d₁₂, …); for `LineSegments` each
pair resets to (0, length). Only non-indexed geometry is supported
(indexed geometry logs a warning and skips), matching three.js.

```ts
import { LineSegments, BufferGeometry, BufferAttribute } from '@vreen/engine/core';
import { LineBasicMaterial } from '@vreen/engine/materials';

// Box edge overlay: 12 edges = 24 vertices (pairs)
const edgePositions = new Float32Array([
  // bottom rectangle
  -1,-1,-1,  1,-1,-1,   1,-1,-1,  1, 1,-1,   1, 1,-1,  -1, 1,-1,   -1, 1,-1,  -1,-1,-1,
  // top rectangle
  -1,-1, 1,  1,-1, 1,   1,-1, 1,  1, 1, 1,   1, 1, 1,  -1, 1, 1,   -1, 1, 1,  -1,-1, 1,
  // verticals
  -1,-1,-1, -1,-1, 1,   1,-1,-1,  1,-1, 1,   1, 1,-1,  1, 1, 1,   -1, 1,-1, -1, 1, 1,
]);
const geo = new BufferGeometry();
geo.setAttribute('position', new BufferAttribute(edgePositions, 3));
const edges = new LineSegments(geo, new LineBasicMaterial({
  color: { r: 0.2, g: 1, b: 0.8 },
}));
scene.add(edges);

// Picking — threshold = 0.2 world units
const raycaster = createRaycasterFromMouse(...);
raycaster.params.Line.threshold = 0.2;
const hits = raycaster.intersectObject(edges, false);
```

**Differences from three.js `Line`**:

- The bounding-sphere rejection test is done in **geometry-local space**
  (ray transformed by `matrixWorld⁻¹`, sphere radius inflated by
  `localThreshold`), reusing VREEN's existing `Ray.distanceSqToPoint`
  + raw `boundingSphere` shape, instead of three.js's world-space
  `Sphere.applyMatrix4` path. Numerically equivalent for uniform scale.
- VREEN `BufferGeometry` has no `drawRange` or `morphAttributes`, so
  raycast iterates the full index/position range and
  `updateMorphTargets` is omitted (no morph-target support on lines).
- `computeLineDistances` writes a `Float32Array`-backed `BufferAttribute`
  (three.js uses `Float32BufferAttribute`); the layout is identical.
- `LineSegments.computeLineDistances` resets each pair to `(0, length)`
  — matching three.js — so dashed patterns restart per segment.

Adapted from three.js `src/objects/Line.js`, `LineSegments.js`, and
`LineLoop.js`.

#### `LineSegments2` / `Line2` (`Line2.ts`)

Thick-line nodes — render arbitrary-pixel-width anti-aliased lines via
**screen-space quad expansion**. Each line segment becomes one instance
of a shared 8-vertex template quad (`LineSegmentsGeometry` /
`LineGeometry`); the vertex shader (`LineMaterial`) expands the quad in
screen space to the desired `linewidth`, bypassing the WebGL
`gl.lineWidth = 1` cap.

| Class | Geometry | Pairing | `isLineSegments2` / `isLine2` |
|-------|----------|---------|--------------------------------|
| `LineSegments2` | `LineSegmentsGeometry` | Independent segments (6 floats each). | `true` / `false` |
| `Line2` | `LineGeometry` | Polyline chain (3 floats per vertex → N−1 segments). | `true` / `true` |

Extends `Object3D`; holds `geometry: LineSegmentsGeometry` (or
`LineGeometry` for `Line2`) and `material: LineMaterial | LineMaterial[]`.

**`computeLineDistances()`**: populates `instanceDistanceStart` /
`instanceDistanceEnd` custom attributes (itemSize=1) on the geometry,
used by `LineMaterial`'s dashed-fragment discard. For `LineSegments2`
each segment is independent (start=0, end=length); for `Line2` distances
accumulate across the polyline (matching `Line.computeLineDistances`).

**Raycast**: same algorithm as `Line.raycast`
(`Ray.distanceSqToSegment`, local-space threshold, bounding-sphere
rejection), but iterates per-instance `instanceStart` / `instanceEnd`
custom attributes instead of the `position` attribute. Threshold comes
from `raycaster.params.Line2.threshold` (default 1); if `params.Line2`
is absent it falls back to `params.Line.threshold`.

| Property | Type | Default | Role |
|----------|------|---------|------|
| `geometry` | `LineSegmentsGeometry` / `LineGeometry` | `new LineSegmentsGeometry()` / `new LineGeometry()` | Source of per-segment `instanceStart` / `instanceEnd`. |
| `material` | `LineMaterial \| LineMaterial[]` | `new LineMaterial()` | Color, linewidth, resolution, dashed params. |
| `isLineSegments2` / `isLine2` | `boolean` | `true` / `false` | Duck-type flags. |

```ts
import { Line2 } from '@vreen/engine/core';
import { LineGeometry } from '@vreen/engine/geometries';
import { LineMaterial } from '@vreen/engine/materials';
import { Vector2 } from '@vreen/engine/math';

// Thick dashed polyline
const geo = new LineGeometry();
geo.setPositions([0, 0, 0, 3, 0, 0, 3, 4, 0, 3, 4, 12]);

const mat = new LineMaterial({
  color: { r: 0.2, g: 1, b: 0.8 },
  linewidth: 4,
  resolution: new Vector2(1920, 1080),
  dashed: true,
  dashSize: 2,
  gapSize: 1,
});

const line = new Line2(geo, mat);
line.computeLineDistances();
scene.add(line);

// Picking
raycaster.params.Line2 = { threshold: 0.5 };
const hits = raycaster.intersectObject(line, false);
```

**Differences from three.js `LineSegments2` / `Line2`**:

- three.js `LineSegments2` extends `Mesh`; VREEN extends `Object3D`
  directly (matching VREEN's `Line` pattern), since thick lines don't
  use the Mesh triangle-rendering path.
- Per-segment data comes from `InstancedGeometry.customAttributes`
  (`instanceStart` / `instanceEnd` as itemSize=3 custom attributes);
  three.js uses `InstancedInterleavedBuffer` +
  `InterleavedBufferAttribute`.
- `RaycasterParameters` adds an optional `Line2?: { threshold: number }`
  field; three.js reuses `Line.threshold`.
- `computeLineDistances` writes to `instanceDistanceStart` /
  `instanceDistanceEnd` custom attributes (itemSize=1); three.js writes
  to `instanceDistanceStart` / `instanceDistanceEnd` interleaved
  buffers.
- `raycast` reads `instanceStart` / `instanceEnd` from
  `customAttributes` (not `geometry.attributes`), matching the VREEN
  `InstancedGeometry` data model.

**Limitations**:

- The renderer must bind `instanceStart` / `instanceEnd` /
  `instanceColorStart` / `instanceColorEnd` /
  `instanceDistanceStart` / `instanceDistanceEnd` as instanced vertex
  attribs (via `InstancedGeometry.customAttributes`); this is handled by
  the `WebGL2Renderer` instanced custom-attribute path.
- `material.resolution` must be updated on viewport resize; otherwise
  screen-space expansion uses stale dimensions.
- `computeLineDistances` must be called before enabling `dashed: true`
  on the material, or all fragments fall in the dash region.
- `Line2` does not close the loop (no `LineLoop2`); use `LineSegments2`
  with explicit closing segments if a loop is needed.

Adapted from three.js `examples/jsm/lines/LineSegments2.js` and
`examples/jsm/lines/Line2.js`.

#### `SceneUtils` (`SceneUtils.ts`)

Scene-graph helpers that preserve world transforms when reparenting,
plus multi-material and ordering utilities.

| Method | Signature | Role |
|--------|-----------|------|
| `detach` | `(child, parent) → child` | Remove `child` from `parent`, baking its world matrix back into a local position/quaternion/scale so it stays put in world space. |
| `attach` | `(child, parent) → child` | Add `child` to `parent`, recomputing the local transform as `parent.worldMatrix⁻¹ · child.worldMatrix` so the world transform is unchanged. |
| `createMultiMaterialObject` | `(geometry, materials) → Group` | Clone `geometry` once per material and wrap in a `Group` (three.js multi-material pattern). |
| `sortRadial` | `(objects, origin) → objects` | Sort transparent objects back-to-front by distance to `origin`. |

Also augments `Object3D` with a `renderOrder: number` field used by the
renderer to sequence draw calls (opaque front-to-back by renderOrder,
then opaque-by-distance; transparent back-to-front).

#### `Gyroscope` (`Gyroscope.ts`)

An `Object3D` whose world **rotation is locked** while its position
follows its parent. `updateMatrixWorld()` recomposes the world matrix
from the parent's world position and the node's own last-known world
rotation — producing a "compass / horizon / HUD" node that stays level
regardless of parent orientation. Differs from a plain `Object3D` whose
rotation is parent-relative; here rotation is forcibly world-absolute.

#### `FlakesTexture` (`FlakesTexture.ts`)

Procedural metal-flake texture for car-paint / flake-finish rendering.
Generates a deterministic flake pattern (seeded RNG), tiles seamlessly
(`wrap` modulo), anti-aliases flake edges via a distance field, and can
convert the height field to a tangent-space normal map for use as a
micro-surface normal input to PBR materials.

| Method | Signature | Role |
|--------|-----------|------|
| `generate` | `(opts?) → { data, width, height }` | Produce RGBA flake height texture. |
| `toNormalMap` | `(heightMap, strength?) → { data, width, height }` | Convert height → tangent-space normal map. |

Adapted from three.js `FlakesTexture.js`. Pure CPU — no WebGL dependency.

#### `PreIntegratedSkinLUT` (`PreIntegratedSkinLUT.ts`)

Pre-Integrated Skin diffuse LUT generator (Penner & Borshukov 2011),
using the d'Eon & van Latta 2007 skin scattering profile (sum of
Gaussians). Produces a 2D RGB lookup texture indexed by
`(N·L, curvature)` that captures the curvature-dependent diffuse
response of skin — including the characteristic red bleed across the
terminator (light/shadow boundary) on high-curvature regions (nose
tip, ears, lips).

Complementary to `SubsurfaceScatteringMaterial` (which approximates
thin-wall back transmission): the SSS material handles light passing
*through* thin skin (ears), while this LUT modulates the *front*
diffuse response based on local curvature. Combining both yields a
complete real-time skin model.

| Export | Signature | Role |
|--------|-----------|------|
| `generatePreIntegratedSkinLUT` | `(opts?) → { data, width, height, maxCurvature }` | Generate 2D RGB Float32 LUT. `data` ∈ [0,1], uploadable as RGB16F texture. |
| `samplePreIntegratedSkinLUT` | `(lut, NdotL, curvature) → SkinColor` | Bilinear sample with `NdotL` clamped to [-1,1], `curvature` clamped to [0, maxCurvature]. |
| `skinScatterProfile` | `(distanceMM) → SkinColor` | d'Eon 2007 scattering profile `R_d(s) = Σ a_k·exp(−s²/2v_k)` per channel. Red has the long-range Gaussian (`v=0.842`). |
| `curvatureFromRadius` | `(radiusMM) → number` | Convenience `1/radius` (mm⁻¹). |

**Integration model.** For each texel `(NdotL, curvature)`:
1. `radius = 1/curvature`; `θ = acos(NdotL)`.
2. Sample surface distance `s ∈ [−maxScatter, +maxScatter]`; angle
   `φ = s/radius`.
3. Accumulate `max(cos(θ+φ), 0) · R_d(|s|)`, normalize by `Σ R_d(|s|)`.

**Invariants (tested):**
- Flat surface (`curvature→0`) → standard Lambert `max(N·L, 0)`.
- Flat full-lit (`N·L=1`, `curvature=0`) → exactly `1.0`; curved
  full-lit `< 1.0` (arc-averaged cos) but remains the row maximum.
- At the terminator (`N·L≈0`) on high-curvature rows: `R > G > B`
  (red-shift), and red bleed increases monotonically with curvature.
- `R_d(s)` monotonically decreasing; red decays slower than blue.

| Option | Default | Description |
|--------|---------|-------------|
| `width` / `height` | `256` | LUT resolution. |
| `maxCurvature` | `2.0` | mm⁻¹ at V=1 (radius 0.5mm, nose-tip scale). V=0 is flat. |
| `maxScatter` | `4.0` | mm; arc integration surface-distance range. |
| `samples` | `64` | Arc integration sample count. |

```ts
import { generatePreIntegratedSkinLUT, samplePreIntegratedSkinLUT } from '@vreen/engine/core';

const lut = generatePreIntegratedSkinLUT({ width: 256, height: 256 });
// Upload lut.data as RGB16F texture; in shader:
//   vec3 diffuse = texture(skinLUT, vec2(NdotL*0.5+0.5, curvature/2.0)).rgb;
// CPU preview:
const c = samplePreIntegratedSkinLUT(lut, 0.0 /*terminator*/, 2.0 /*nose tip*/);
// c.r > c.g > c.b  (red-shift at shadow edge)
```

Adapted from Penner 2011 + d'Eon 2007 (GPU Gems 3 Ch.14). Pure CPU —
no WebGL dependency. No direct three.js equivalent; fills VREEN's
skin-rendering gap relative to o3de Atom's `Skin` material.

#### `SeparableSSS` (`SeparableSSS.ts`)

Separable Screen-Space Subsurface Scattering kernel generator
(Jimenez 2015) + CPU reference convolution + GLSL chunk. Generates a
per-channel RGB 1D half-kernel from the d'Eon/Jimenez skin diffusion
profile (sum of Gaussians), where the red channel carries more weight
in the wider Gaussians → red scatters further. Two 1D passes
(horizontal + vertical) approximate the 2D radial diffusion at
`O(2N)` instead of `O(N²)`.

This closes VREEN's skin pipeline:
`SubsurfaceScatteringMaterial` (thin-wall back transmission) +
`PreIntegratedSkinLUT` (front curvature red-shift) +
`SeparableSSS` (screen-space diffusion blur). The existing
`SSSSPass` uses a single scalar Gaussian (same spread for R/G/B);
upgrading it to consume `generateSeparableSSSKernel` +
`kernelToUniforms` yields the full Jimenez 2015 quality.

| Export | Signature | Role |
|--------|-----------|------|
| `generateSeparableSSSKernel` | `(opts?) → { samples, halfSize, fullSize, strength }` | Generate symmetric RGB half-kernel. |
| `sampleSSSProfile` | `(profile, distanceMM) → SkinColor` | Diffusion profile `Σ color·exp(−d²/2σ²)` per channel. |
| `convolve1D` | `(row, width, kernel) → Float32Array` | CPU reference 1D symmetric convolution (RGBA). |
| `convolve2DSeparable` | `(image, w, h, kernel) → Float32Array` | CPU reference H+V two-pass convolution. |
| `kernelVariance` | `(kernel) → SkinColor` | Per-channel effective variance (verify red>green>blue). |
| `kernelToUniforms` | `(kernel) → { offsets, weightsR/G/B }` | Flatten to GLSL uniform arrays. |
| `SKIN_PROFILE_JIMENEZ` | `SSSGaussianComponent[]` | d3xter/separable-sss skin profile (6 Gaussians). |
| `SEPARABLE_SSS_FRAG` / `_VERT` | GLSL strings | Depth-aware separable blur shader (RGB kernel, two passes). |

**Kernel generation.** Half-kernel samples at uniform distances
`d ∈ [0, spread]` (default `spread = 3·maxσ`). Weight
`w_c(d) = Σ_k color_{c,k}·exp(−d²/2σ_k²)`. Per-channel normalization:
full symmetric sum `= 1` (center once, others twice) → 2D separable
energy `(Σ w_c)² = 1` conserved. Offsets scaled by `strength`
(pixels/mm).

**Invariants (tested):**
- Per-channel full symmetric sum `= 1` (energy conservation).
- Kernel variance `R > G > B` (red scatters furthest).
- `convolve1D` constant input → constant output (interior); delta
  response `= kernel weights`.
- `convolve2DSeparable` constant image → constant output (interior);
  delta center `= w0²`; red spreads wider than blue.
- `sampleSSSProfile` monotonic; red decays slower than blue.

| Option | Default | Description |
|--------|---------|-------------|
| `samples` | `11` | Half-kernel size (incl. center). Full kernel `= 2·samples−1`. |
| `strength` | `1.0` | Pixels per mm (scattering radius scale). |
| `spread` | `3·maxσ` | Max sampling distance (mm). |
| `profile` | `SKIN_PROFILE_JIMENEZ` | Diffusion profile (Gaussian components). |

```ts
import { generateSeparableSSSKernel, kernelToUniforms } from '@vreen/engine/core';

const kernel = generateSeparableSSSKernel({ samples: 17, strength: 0.012 /*mm→px*/ });
const { offsets, weightsR, weightsG, weightsB } = kernelToUniforms(kernel);
// Upload to SEPARABLE_SSS_FRAG: pass 1 blurDir=(1,0), pass 2 blurDir=(0,1).
// Red channel blurs wider than blue → warm skin diffusion.
```

Adapted from Jimenez 2015 "Separable Subsurface Scattering" +
d3xter/separable-sss. Pure CPU core (no WebGL dependency) + GLSL chunk
for the GPU two-pass path.

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

// Batched rendering — merge different geometries into one draw call
const batched = new BatchedMesh(10000, 30000, material);
const id1 = batched.addGeometry(boxGeometry);    // different geometries
const id2 = batched.addGeometry(sphereGeometry);  // in one buffer
const id3 = batched.addGeometry(cylinderGeometry);
batched.setMatrixAt(id1, new Matrix4().makeTranslation(0, 0, 0));
batched.setMatrixAt(id2, new Matrix4().makeTranslation(5, 0, 0));
batched.setMatrixAt(id3, new Matrix4().makeTranslation(10, 0, 0));
batched.setVisibleAt(id2, false); // hide one batch
// Renderer iterates batched.getDrawRanges() to submit draw calls

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
