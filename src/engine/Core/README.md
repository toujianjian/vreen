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
   │     ├── Sprite (billboard)
   │     └── Points (GL_POINTS point cloud)
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
| `Points` | Point-cloud / point-sprite node. Renders every `position` vertex as a `GL_POINTS` primitive via `PointsMaterial`. Supports threshold-based raycast picking. |
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
