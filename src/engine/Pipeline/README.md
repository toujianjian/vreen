# Pipeline Module

> Path: `src/engine/Pipeline/`
>
> The asset processing subsystem of the `@vreen/engine` kernel. Where
> `Loaders/` parses file formats into engine objects and `Assets/` manages
> instance lifetimes, `Pipeline/` orchestrates the multi-step
> transformations that turn freshly-parsed assets into optimised,
> validated, GPU-ready forms: an ordered `AssetPipeline` of composable
> `PipelineStep`s, two stateless processors (`TextureProcessor`,
> `GeometryProcessor`) that operate on engine types with no GL coupling,
> and an `ImportPipeline` that ties format loading to normalisation and
> validation for GLTF / OBJ / FBX.

---

## Overview

```
   AssetSource ── Loaders/ ──→ raw engine objects (Group / BufferGeometry / Texture)
                                     │
                                     ▼
                          ImportPipeline.importGLTF / importOBJ / importFBX
                                     │   ├── normalise (centre + scale to [-1, 1] cube)
                                     │   └── validate  (count meshes / tris / verts; warn)
                                     ▼
                          ImportResult { root, materials, meta, validation }
                                     │
                                     ▼
                          AssetPipeline.process(asset)  ── runs PipelineStep[] in order
                                     │   ├── TextureProcessor.*        (static methods)
                                     │   ├── GeometryProcessor.*       (static methods)
                                     │   └── caller-supplied steps
                                     ▼
                          PipelineAsset { type, data, metadata?, name? }


  Stateless processors (also usable outside the pipeline):
       TextureProcessor   ── compress / resize / generateMipmaps / flipY / convertFormat / premultiplyAlpha
       GeometryProcessor  ── merge / simplify / computeNormals / computeTangents / computeBoundingBox / weld
```

The pipeline is **not** a parser and **not** a renderer. It consumes
already-parsed engine objects and produces transformed engine objects of
the same type. Processors are pure static methods; the pipeline itself
only adds ordering, error aggregation, and an optional name-keyed cache.

---

## Core Classes

### `AssetPipeline` (`AssetPipeline.ts`)

| Export | Role |
|--------|------|
| `AssetPipeline` | Ordered list of `PipelineStep`s. `addStep` appends (or replaces by name); `process(asset)` runs them sequentially; `processBatch(assets)` aggregates failures into a `BatchResult`. |
| `PipelineAsset` | The object flowing through the pipeline: `{ type, data, metadata?, name? }`. `type` is a free-form tag (`'geometry'` / `'texture'` / `'gltf'`); `data` is the engine object; `metadata` is a free-form bag steps can read and write. |
| `PipelineStep` | `{ name, process(asset): PipelineAsset \| Promise<PipelineAsset> }`. Steps may be sync or async. |
| `BatchResult` | `{ succeeded: PipelineAsset[], failed: Array<{ asset, error }> }`. |

```ts
class AssetPipeline {
  addStep(step: PipelineStep): this;                       // replaces if name exists
  removeStep(name: string): boolean;                       // rebuilds name index
  getStep(name: string): PipelineStep | undefined;
  get stepCount(): number;
  getStepNames(): string[];
  process(asset: PipelineAsset): Promise<PipelineAsset>;   // throws on step failure
  processBatch(assets: PipelineAsset[]): Promise<BatchResult>;
  getAsset(name: string): PipelineAsset | undefined;       // from name-keyed cache
  clearAssets(): void;
}
```

`process` throws on the first failing step (with the step name in the
error message); `processBatch` is lenient — each asset is processed
independently and failures land in `failed[]` while successes land in
`succeeded[]`. Assets with a `name` are cached after `process`, so
follow-up `getAsset(name)` calls return the transformed result without
re-running the pipeline.

### `TextureProcessor` (`TextureProcessor.ts`)

All methods are static; the class is never instantiated. Per-texture
metadata is held in a module-level `WeakMap<Texture, Record<string, unknown>>`
so the `Texture` class itself stays free of processing state.

| Export | Role |
|--------|------|
| `TextureProcessor.compress(texture, format)` | Marks a `Texture` with the requested `CompressedFormat` (`'s3tc'` / `'bptc'` / `'etc2'` / `'astc'` / `'pvrtc'` / `'none'`). Actual encoding is delegated to `KTX2Loader` / the renderer's compressed path; this method writes metadata and bumps `texture.version`. |
| `TextureProcessor.resize(texture, width, height)` | Async. Resizes via `OffscreenCanvas` / `createImageBitmap` in the browser; nearest-neighbour resample for `RGBA32F` data textures. Returns the same `Texture` (mutated) or a new one depending on the path. |
| `TextureProcessor.generateMipmaps(texture)` | Ensures the `Texture` will request mipmaps on next GPU upload (sets `needsMipmaps = true`, bumps version). |
| `TextureProcessor.flipY(texture)` | Flips the image vertically (browser path: re-encode via canvas; data path: in-place row swap). |
| `TextureProcessor.convertFormat(texture, target)` | Converts pixel format to a `TargetFormat` (`'rgba8'` / `'rgb8'` / `'rgba32f'` / `'r8'`). |
| `TextureProcessor.premultiplyAlpha(texture)` | Multiplies RGB by alpha in place. |
| `CompressedFormat` | `'s3tc' \| 'bptc' \| 'etc2' \| 'astc' \| 'pvrtc' \| 'none'` — aligns with WebGL2 extension names. |
| `TargetFormat` | `'rgba8' \| 'rgb8' \| 'rgba32f' \| 'r8'`. |

```ts
class TextureProcessor {
  static compress(texture: Texture, format: CompressedFormat): Texture;
  static resize(texture: Texture, width: number, height: number): Promise<Texture>;
  static generateMipmaps(texture: Texture): Texture;
  static flipY(texture: Texture): Texture;
  static convertFormat(texture: Texture, target: TargetFormat): Texture;
  static premultiplyAlpha(texture: Texture): Texture;
}
```

Every mutating call increments `texture.version` so the renderer's
texture cache re-uploads on the next draw.

### `GeometryProcessor` (`GeometryProcessor.ts`)

All methods are static; the class is never instantiated. Operates on
`BufferGeometry` only — no Material / Scene / GL dependencies.

| Export | Role |
|--------|------|
| `GeometryProcessor.merge(geometries)` | Concatenates `position` / `normal` / `uv` arrays and offsets indices into a single `BufferGeometry`. Missing attributes on a sub-geometry are zero-filled so the merged output stays consistent. |
| `GeometryProcessor.simplify(geometry, ratio)` | Edge-collapse simplification (a Quadric Error Metric flavour — edge-length-first + normal-consistency check). Reduces triangle count toward `ratio` of the original. |
| `GeometryProcessor.computeNormals(geometry)` | Recomputes `normal` attribute from positions + indices (face normal averaging). |
| `GeometryProcessor.computeTangents(geometry)` | Recomputes `tangent` attribute (MikkTSpace-style) from positions / uvs / normals. |
| `GeometryProcessor.computeBoundingBox(geometry)` | Sets `geometry.boundingBox` from `position` min / max. |
| `GeometryProcessor.weld(geometry, threshold)` | Spatial-hash vertex welding. Quantises positions to a `threshold` grid and merges coincident vertices; reindexes. Average case O(n). |

```ts
class GeometryProcessor {
  static merge(geometries: BufferGeometry[]): BufferGeometry;
  static simplify(geometry: BufferGeometry, ratio: number): BufferGeometry;
  static computeNormals(geometry: BufferGeometry): BufferGeometry;
  static computeTangents(geometry: BufferGeometry): BufferGeometry;
  static computeBoundingBox(geometry: BufferGeometry): BufferGeometry;
  static weld(geometry: BufferGeometry, threshold: number): BufferGeometry;
}
```

`weld` directly reduces `Raycaster.intersectGeometry` work, so the
processing pipeline and the picking / BVH path benefit from each other.

### `ImportPipeline` (`ImportPipeline.ts`)

| Export | Role |
|--------|------|
| `ImportPipeline` | One instance per import context. Owns a `GLBLoader` and an `FBXLoader`. Each `import*` method runs: format-specific load → `normalize(root)` (centre + scale to `[-1, 1]` cube) → `validate(root)` (count meshes / triangles / vertices, detect missing `position` / `normal` / `uv`). |
| `ImportResult<T>` | `{ root: Group, materials: unknown[], meta?: T, validation?: ValidationReport }`. `meta` is the loader-specific result (`LoadedGLB` / `ParsedOBJ` / `LoadedFBX`). |
| `ValidationReport` | `{ ok, warnings[], errors[], meshCount, triangleCount, vertexCount }`. |

```ts
class ImportPipeline {
  importGLTF(url: AssetSource): Promise<ImportResult<LoadedGLB>>;
  importOBJ(url: AssetSource): Promise<ImportResult<ParsedOBJ>>;
  importFBX(url: AssetSource): Promise<ImportResult<LoadedFBX>>;
  normalize(root: Group): Group;                          // public; also called internally
  validate(root: Group | Object3D): ValidationReport;     // public; also called internally
}
```

`normalize` walks every `Mesh` in the hierarchy, computes the union
AABB, and applies a combined translate + uniform-scale matrix to `root`
so the whole model fits in a unit cube. `validate` reports per-mesh
missing attributes as warnings and missing `position` as an error.

---

## Usage Example

### Building an optimisation pipeline

```ts
import { AssetPipeline, GeometryProcessor, TextureProcessor } from '@vreen/engine/pipeline';

const pipeline = new AssetPipeline();

pipeline.addStep({
  name: 'weld-vertices',
  process: (asset) => {
    if (asset.type === 'geometry') {
      asset.data = GeometryProcessor.weld(asset.data as BufferGeometry, 1e-4);
    }
    return asset;
  },
});

pipeline.addStep({
  name: 'compute-normals',
  process: (asset) => {
    if (asset.type === 'geometry') {
      asset.data = GeometryProcessor.computeNormals(asset.data as BufferGeometry);
    }
    return asset;
  },
});

pipeline.addStep({
  name: 'simplify',
  process: async (asset) => {
    if (asset.type === 'geometry') {
      asset.data = GeometryProcessor.simplify(asset.data as BufferGeometry, 0.5);
    }
    return asset;
  },
});

pipeline.addStep({
  name: 'compress-textures',
  process: (asset) => {
    if (asset.type === 'texture') {
      TextureProcessor.compress(asset.data as Texture, 'bc7');
    }
    return asset;
  },
});

const out = await pipeline.process({
  type: 'geometry',
  data: loadedGeometry,
  name: 'hero-mesh',
});
const optimised = pipeline.getAsset('hero-mesh')!;
```

### Batch processing with error aggregation

```ts
const batch = await pipeline.processBatch([
  { type: 'geometry', data: meshA, name: 'meshA' },
  { type: 'geometry', data: meshB, name: 'meshB' },
  { type: 'texture',  data: texA,  name: 'texA'  },
]);
console.log(`ok=${batch.succeeded.length} fail=${batch.failed.length}`);
for (const f of batch.failed) console.error(f.asset.name, f.error.message);
```

### End-to-end import + optimise

```ts
import { ImportPipeline, AssetPipeline, GeometryProcessor } from '@vreen/engine/pipeline';

const importer = new ImportPipeline();
const { root, validation } = await importer.importGLTF('hero.glb');
if (!validation.ok) console.warn('validation errors:', validation.errors);

const optimiser = new AssetPipeline();
optimiser.addStep({
  name: 'weld-and-normalise',
  process: (asset) => {
    if (asset.type !== 'geometry') return asset;
    let g = asset.data as BufferGeometry;
    g = GeometryProcessor.weld(g, 1e-4);
    g = GeometryProcessor.computeNormals(g);
    return { ...asset, data: g };
  },
});

root.traverse((obj) => {
  if (obj.isMesh) {
    optimiser.process({ type: 'geometry', data: obj.geometry, name: obj.name });
  }
});
```

### Standalone texture processing

```ts
import { TextureProcessor } from '@vreen/engine/pipeline';

const tex = await new TextureLoader().load('hero/albedo.png');
await TextureProcessor.resize(tex, 1024, 1024);
TextureProcessor.generateMipmaps(tex);
TextureProcessor.premultiplyAlpha(tex);
TextureProcessor.compress(tex, 'astc');
// tex.version has been bumped 4 times; renderer re-uploads on next draw.
```

---

## Invariants

- **Pipeline is order-preserving.** `process(asset)` runs `PipelineStep`s
  in the order they were added. Each step receives the output of the
  previous step (or the original asset for the first step).
- **Steps are type-tagged, not type-checked.** A step is responsible for
  inspecting `asset.type` and deciding whether to act. Steps that don't
  match the type must return the asset unchanged.
- **Pure static processors.** `TextureProcessor` and `GeometryProcessor`
  never touch GL state. They mutate engine objects in place (and bump
  `version`) but never upload to the GPU. The renderer picks up changes
  via version checks.
- **`process` throws; `processBatch` collects.** A failing step in
  `process` aborts the pipeline with a descriptive error. `processBatch`
  isolates per-asset failures so one bad asset does not abort the batch.
- **`ImportPipeline` always normalises.** `importGLTF` / `importOBJ` /
  `importFBX` call `normalize(root)` and `validate(root)` before
  returning. Callers wanting the raw loader output should use the
  underlying loader directly.
- **Normalisation is uniform.** `normalize` finds the longest AABB axis
  and scales the whole hierarchy by `2 / maxSize`, translating the AABB
  centre to the origin. Aspect ratio is preserved.
- **No I/O in processors.** `TextureProcessor` and `GeometryProcessor`
  do not fetch, decode, or read files. The only I/O in the module is in
  `ImportPipeline`, which delegates to `Loaders/`.
- **Cache is name-keyed.** Only assets with a `name` are cached by
  `AssetPipeline.process`. `clearAssets()` wipes the cache without
  affecting the step list.

---

## Design Notes

**Why a separate `Pipeline/` module?** `Loaders/` are format adapters —
one class per file format, single responsibility: parse bytes into
engine objects. Real asset workflows need more than parsing: imported
models get welded, simplified, re-normaled; textures get resized,
compressed, mipmapped. Putting those transforms in `Loaders/` would
bloat every loader with cross-cutting concerns. `Pipeline/` is the
orchestration layer that composes those transforms into a reusable
sequence.

**Why stateless static methods on the processors?** Each processor call
is independent (`weld` doesn't depend on previous `merge` state;
`compress` doesn't depend on previous `resize` state). Making them
static methods on a stateless class keeps the API surface trivial,
composable, and testable — there's no instance to configure, no order
dependency, no hidden state. When a stateful sequence is needed, wrap
the calls in a `PipelineStep`.

**Why does `compress` only write metadata?** Real texture compression
(Basis Universal / BCn / ETC / ASTC) requires either a GPU encode pass
or a heavy WASM transcoder. Doing that inline would couple the pipeline
to a specific encoder and blow up bundle size. Instead, `compress`
records the requested format in a `WeakMap` and bumps `texture.version`;
the renderer's texture-upload path (or a downstream KTX2 encoder step)
reads that metadata and chooses the correct compressed path.

**Why edge-collapse simplification?** QEM (Quadric Error Metric) is the
standard answer for "preserve silhouette while reducing triangles." The
implementation here is a simplified flavour — edge-length-first
selection plus normal-consistency check — which is fast, deterministic,
and good enough for LOD generation. Full Garland-Heckbert QEM is a
future enhancement.

**Why does `ImportPipeline` own its own loaders?** Each `ImportPipeline`
instance creates fresh `GLBLoader` / `FBXLoader` instances so import
state (extension handlers, decoder injections) doesn't leak between
import contexts. Sharing one global loader would make per-import DRACO
or KTX2 configuration impossible.

---

## References

- `Loaders/` module — `GLBLoader`, `parseOBJ`, `FBXLoader`, `AssetSource`
- `Core/BufferGeometry` / `Core/BufferAttribute` — geometry data model
- `Core/Texture` — texture data model and `version` invalidation
- `Renderer/` module — texture re-upload on `version` change
- `Acceleration/BVH` — benefits from `weld` / `simplify` reducing triangle count
- Garland-Heckbert QEM — https://www.cs.cmu.edu/~garland/quadrics/
- MikkTSpace tangent space — http://www.mikktspace.com/
- glTF asset pipeline — https://github.com/KhronosGroup/glTF-Asset-Generator
