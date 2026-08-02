# Loaders Module

> Path: `src/engine/Loaders/`
>
> The asset I/O subsystem of the `@vreen/engine` kernel. Provides typed
> `Loader<T>` implementations for every supported source format
> (glTF / GLB / OBJ / FBX / STL / PLY / TGA / EXR / HDR / KTX2 / PNG-JPG-WebP
> / MTL), a central `AssetManager` for promise-level caching and LRU
> eviction, an extension-aware `GLTFExtensionLoader` (DRACO + KTX2 +
> runtime KHR / EXT hooks), and four model exporters
> (`OBJExporter` / `GLTFExporter` / `STLExporter` / `PLYExporter`) that
> round-trip engine objects back to interchange formats.

---

## Overview

```
                       AssetSource (string | URL | File | Blob | ArrayBuffer | Uint8Array)
                                  │
                                  ▼
              Loader<T>.load(source, ctx?) ── yields ──→ T (engine object)
                  ▲                                           │
                  │ implements                                 │ feeds
                  │                                            ▼
   ┌──────────────┴────────────────────────────┐           Scene / Texture / Geometry
   │              │         │         │         │
 GLBLoader   OBJLoader   FBXLoader  STLLoader  PLYLoader
   │              │         │
 HDRLoader   KTX2Loader  TextureLoader
   │
 TGALoader   EXRLoader   MTLLoader
   │
 GLTFExtensionLoader ── registers ──→ GLTFExtensionHandler[] (KHR_* / EXT_*)
                  │
                  ▼
        AssetManager ── caches ──→ Promise<T> by (format, source)
                  │
                  ├── registerLoader(format, loader)
                  ├── load<T>(format, source, ctx?)
                  ├── prefetch / prewarm / invalidate / invalidateAll
                  └── getStats() → CacheStats (hits / misses / evictions)

 Exporters (reverse direction):
   OBJExporter  ─ parse(Object3D) → string
   GLTFExporter ─ parse(Scene) → { json, bin }; parseGLB(Scene) → Uint8Array
   STLExporter  ─ parse(Object3D, { binary? }) → string | Uint8Array
   PLYExporter  ─ parse(Object3D, { binary? }) → string | Uint8Array
```

The loaders are pure parsers — they never touch the GL context. Geometry
loaders emit `BufferGeometry` / `Group`, texture loaders emit `Texture`,
and the `AssetManager` sits in front of all of them deduplicating
in-flight promises and applying LRU eviction by entry count.

---

## Core Classes

### Loader abstraction (`Loader.ts`)

| Export | Role |
|--------|------|
| `Loader<T>` | Generic interface every format implements. `format: string`, optional `canLoad(source, hints)`, `load(source, ctx?): Promise<T>`. |
| `AssetSource` | Source union: `string \| URL \| File \| Blob \| ArrayBuffer \| Uint8Array`. |
| `LoaderContext` | Per-load context: `signal?: AbortSignal`, `onProgress?: (p: LoaderProgress) => void`, `hints?: Record<string, unknown>`. |
| `LoaderProgress` | `{ loaded, total, ratio }` reported by streaming fetch. |
| `cacheKeyFor(source)` | Deterministic cache key per source kind (`str:` / `url:` / `file:` / `blob:` / `u8:` / `ab:`). |
| `fetchAsArrayBuffer(url, onProgress?, signal?)` | Streaming `fetch` with progress reporting. |
| `toArrayBuffer(source)` | Normalise Blob / ArrayBuffer / Uint8Array to `ArrayBuffer`. |
| `isAbortError(e)` | Cross-environment abort detection (`AbortError` name or `ABORT_ERR` code). |

```ts
export interface Loader<T> {
  readonly format: string;
  canLoad?(source: AssetSource, hints?: Record<string, unknown>): boolean;
  load(source: AssetSource, ctx?: LoaderContext): Promise<T>;
}
```

### Geometry & scene loaders

| Export | Result type | Role |
|--------|-------------|------|
| `GLBLoader` | `LoadedGLB` | glTF 2.0 binary container parser. Produces `Group` + `AnimationClip[]` + `StandardMaterial[]`. Supports POSITION / NORMAL / TANGENT / TEXCOORD_0 / COLOR_0, indices, PBR factors, skin (joints + inverseBindMatrices → `SkinnedMesh`), and TRS animation tracks. Skips morph targets and sparse accessors. |
| `parseGLB(buf)` | `{ json, bin }` | Stateless GLB header + chunk parser (JSON + BIN). |
| `OBJLoader` / `parseOBJ(text)` | `ParsedOBJ` | Wavefront OBJ parser. Emits one `Mesh` per `o` / `g` block; handles `v` / `vn` / `vt`, `f v/vt/vn` / `v//vn` / `v`, triangle and quad faces, 1-based and negative indices. Records `usemtl` refs but does not parse MTL. |
| `FBXLoader` | `LoadedFBX` | Binary FBX parser (v7003+). Node tree, Properties70 (Lcl Translation / Rotation / Scaling), Geometry (Vertices / PolygonVertexIndex / LayerElementNormal / LayerElementUV / LayerElementMaterial), OO / OP connections. zlib-compressed arrays via `fflate`. No textures / animation / skinning / ASCII. |
| `sniffFbxBinary(buf)` / `parseFbxBinary(buf)` | `boolean` / parsed | Format sniffer and direct parser entry points. |
| `STLLoader` / `parseSTL(data)` | `BufferGeometry` | STL parser (auto-detect binary vs ASCII). Non-indexed output with `position` + `normal`; binary colour extension attaches `color` attribute. |
| `PLYLoader` / `parsePLY(buf)` | `BufferGeometry` | PLY parser (ASCII / binary LE / binary BE). Indexed output; recognises position / normal / uv / color vertex properties and `list ... vertex_indices` faces. |

```ts
export interface LoadedGLB {
  root: Group;
  animations: AnimationClip[];
  materials: StandardMaterial[];
}
export interface LoadedFBX {
  root: Group;
  materials: StandardMaterial[];
  version: number;          // 7003 / 7100 / ... / 7700
  skipped: Record<string, number>;
}
export interface ParsedOBJ {
  root: Group;
  materials: Record<string, OBJMaterialRef>;
}
```

### Texture loaders

| Export | Result type | Role |
|--------|-------------|------|
| `TextureLoader` | `Texture` | PNG / JPG / WebP / GIF / BMP via `createImageBitmap` (off-main-thread decode). Honours `ctx.hints.textureOptions` and `ctx.hints.mime`. |
| `HDRLoader` | `LoadedHDR` | Radiance `.hdr` (RGBE) → linear `RGBA32F` `Texture`. Handles uncompressed scanlines and per-channel RLE. |
| `KTX2Loader` | `Texture` | Khronos KTX 2.0 container parser. Uncompressed `R8G8B8A8_{UNORM,SRGB}` / `R8G8_UNORM` / `R8_UNORM`; Basis Universal (`supercompressionScheme=1`) and Zstd (`=2`) require external transcoders injected via `setBasisTranscoder` / `setZstdDecoder`. Output is written to `Texture.compressedLevels` for the renderer. |
| `sniffKtx2(buf)` / `parseKtx2Container(buf)` | `boolean` / `ParsedKtx2` | Sniffer + container-level parser. |
| `TGALoader` / `parseTGA(buf)` | `TGAResult` | Truevision TGA parser. Uncompressed and RLE RGB / GREY / INDEXED, 8/16/24/32-bit, all four origin orientations. Output is always RGBA8, origin normalised to lower-left. |
| `EXRLoader` / `parseEXR(buf)` | `EXRResult` | OpenEXR parser (scanline, HALF / FLOAT, NO / RLE / ZIPS / ZIP compression, RGB / RGBA / Y-RY-BY channels). Output is linear RGBA `Float32Array`. No tiled / deep / multi-part / PIZ / B44 / DWA. |
| `LUTCubeLoader` / `parseCube(text)` | `LUTCubeResult` | **Adobe Cube LUT 1.0** parser (IRIDAS `.cube` format — DaVinci Resolve / Photoshop / Premiere / After Effects LUT export). Supports both 1D and 3D LUTs, `TITLE`, `DOMAIN_MIN` / `DOMAIN_MAX` (incl. HDR extended ranges like `-0.125 → 1.125`), `#` comments, auto size inference (no `LUT_SIZE` header), mixed whitespace. Provides `cube3DToStrip()` / `stripToCube3D()` helpers for TEXTURE_3D ↔ TEXTURE_2D strip layout conversion, and `toData3DTexture()` for zero-copy conversion to `Data3DTexture` (TEXTURE_3D). Pairs directly with `Renderer/PostProcess/LUTPass.ts` for cinematic color grading. |

```ts
export interface LoadedHDR { texture: Texture; width: number; height: number; }
export interface TGAResult { width: number; height: number; data: Uint8Array; /* RGBA8 */ }
export interface EXRResult { width: number; height: number; data: Float32Array; /* RGBA linear */ }
export interface LUTCubeResult {
  type: '1D' | '3D';
  size: number;                 // per-axis grid points (16, 33, 64 typical)
  data: Float32Array;          // RGB, row-major: R-slow → G-mid → B-fast
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  title: string;
  texture: Texture;            // 2D strip layout for TEXTURE_2D fallback
}
// Layout helpers:
function cube3DToStrip(data: Float32Array, size: number): Float32Array;  // 3D → size × size² strip
function stripToCube3D(strip: Float32Array, size: number): Float32Array; // strip → 3D
function toData3DTexture(parsed: Omit<LUTCubeResult, 'texture'>): Data3DTexture; // 3D LUT → TEXTURE_3D (zero-copy)
```

### Material & extension loader

| Export | Role |
|--------|------|
| `MTLLoader` / `parseMTL(text)` | Wavefront MTL parser. Emits `MaterialDescription[]` (one per `newmtl`). Supports Ka / Kd / Ks / Ke / Tf / Ns / Ni / d / Tr / illum and `map_*` references with `-s` / `-o` / `-bm` / `-imfchan` / `-cc` / `-clamp` options. Does not instantiate `StandardMaterial`; caller converts. |
| `GLTFExtensionLoader` | Enhanced GLTF loader wrapping `GLBLoader`. Adds: extension registry (`registerExtension(name, handler)`), DRACO decoder injection (`setDRACODecoder`), KTX2 decoder injection (`setKTX2Decoder`), per-URL scene cache, fine-grained `parse*` helpers. Mirrors three.js `GLTFLoader` plugin model with a `GLTFExtensionHandler` interface (`beforeParse` / `afterParseNode` / `afterParseMesh` / `afterParseMaterial` / `dispose`). |

```ts
export interface GLTFExtensionHandler {
  name: string;
  beforeParse?(json: GLTFJson, bin: Uint8Array | null): GLTFJson | void;
  afterParseNode?(node: Object3D, ctx: GLTFExtensionContext): void;
  afterParseMesh?(mesh: unknown, ctx: GLTFExtensionContext): void;
  afterParseMaterial?(material: unknown, ctx: GLTFExtensionContext): void;
  dispose?(): void;
}
```

### `DracoDecoder`

| Export | Role |
|--------|------|
| `decodeDraco(bytes, attributeSpecs)` | Lazy-loaded `draco3d` singleton wrapper. Returns writable `BufferAttribute`s (`positions` / `normals` / `uvs` / `indices`) for `GLBLoader` KHR_draco_mesh_compression. |
| `DracoAttributeSpec` | Per-attribute spec (`name` + glTF attribute semantic). |

`draco3d` is an optional peer dependency; calling `decodeDraco` without it
installed throws a clear error.

### `AssetManager` (`AssetManager.ts`)

| Export | Role |
|--------|------|
| `AssetManager` | Format registry + promise cache. `registerLoader(format, loader)` / `load<T>(format, source, ctx?)` / `invalidate(format, source)` / `invalidateAll(predicate?)` / `clear()`. LRU eviction by `maxEntries` (default 64) using `(hits, createdAt)` ordering. |
| `getDefaultAssetManager()` / `resetDefaultAssetManager()` | Process-level singleton + test reset. |
| `AssetManagerOptions` | `{ maxEntries?: number }` (0 = unlimited). |
| `CacheStats` | `entries` / `maxEntries` / `hits` / `misses` / `evictions` / `totalBytes` / `hitRate`. |
| `PrewarmEntry` | `{ format, source }` for `prewarm([...])`. |

```ts
class AssetManager {
  registerLoader<T>(format: string, loader: Loader<T>): void;
  load<T>(format: string, source: AssetSource, ctx?: LoaderContext): Promise<T>;
  prefetch(format: string, source: AssetSource, ctx?: LoaderContext): Promise<void>;
  prewarm(entries: PrewarmEntry[]): Promise<{ loaded: number; failed: number }>;
  invalidate(format: string, source: AssetSource): void;
  invalidateAll(predicate?: (format: string, source: AssetSource) => boolean): number;
  getStats(): CacheStats;
}
```

`prefetch` is best-effort (swallows errors). `prewarm` uses
`Promise.allSettled` so a single failure does not abort the batch.
Failed loads are removed from the cache so the next call retries.

### Exporters

| Export | Output | Role |
|--------|--------|------|
| `OBJExporter` / `exportOBJ(root)` | `string` | Walks a `Group` / `Mesh` tree and emits Wavefront OBJ. One `o <name>` block per mesh; global `v` / `vn` / `vt` counters shared across meshes (OBJ convention); `usemtl` references; faces emitted as `f v/vt/vn` (degrades to `f v//vn` or `f v` when missing). |
| `GLTFExporter` | `GLTFResult` (`{ json, bin }`) | Serialises `Scene` / `Mesh` / `StandardMaterial` to glTF 2.0 JSON + 4-byte-aligned BIN. Supports PBR factors (baseColor / metalness / roughness / emissive), TRS transforms, node hierarchy. `parseGLB(scene)` packs into a GLB `Uint8Array` (12B header + JSON chunk + BIN chunk). No images / animation / cameras / lights. |
| `STLExporter` | `string \| Uint8Array` | Triangle fan-out across an `Object3D` subtree. ASCII (default) or binary via `{ binary: true }`. No colour extension; 80B binary header zeroed. |
| `PLYExporter` | `string \| Uint8Array` | Merges all subtree meshes into a single vertex / face table. ASCII (default) or binary LE via `{ binary: true }`. Vertex attributes: position (required) + normal / uv if present. Faces: `list uchar int vertex_indices` (triangles only). |

```ts
export interface GLTFOptions { binary?: boolean; onlyVisible?: boolean; embedImages?: boolean; }
export interface GLTFResult { json: Record<string, unknown>; bin: Uint8Array; }
export interface STLExportOptions { binary?: boolean; }
export interface PLYExportOptions { binary?: boolean; }
```

`GLBLoader` ↔ `GLTFExporter` round-trip is covered by the engine test
suite (see `lib/roundtripDemo.ts`).

---

## Usage Example

### Loading a GLB with cache + progress + abort

```ts
import { AssetManager, GLBLoader, type LoadedGLB } from '@vreen/engine/loaders';

const am = new AssetManager({ maxEntries: 32 });
am.registerLoader('glb', new GLBLoader());

const ctrl = new AbortController();
const loaded = await am.load<LoadedGLB>('glb', 'assets/character.glb', {
  signal: ctrl.signal,
  onProgress: (p) => console.log(`${Math.round(p.ratio * 100)}%`),
});

scene.add(loaded.root);
const mixer = new AnimationMixer(loaded.root);
loaded.animations.forEach((clip) => mixer.clipAction(clip).play());

// Later: invalidate so the next load re-fetches.
am.invalidate('glb', 'assets/character.glb');
```

### Prewarming a scene transition

```ts
await am.prewarm([
  { format: 'glb', source: 'assets/level2.glb' },
  { format: 'texture', source: 'assets/level2/sky.png' },
]);
```

### Extension-aware GLTF with DRACO + KTX2

```ts
import { GLTFExtensionLoader } from '@vreen/engine/loaders';

const loader = new GLTFExtensionLoader();
loader.setDRACODecoder(await import('draco3d').then((m) => m.createDecoderModule()));
loader.setKTX2Decoder(await import('ktx-parse'));

loader.registerExtension('KHR_materials_unlit', {
  name: 'KHR_materials_unlit',
  afterParseMaterial: (mat, ctx) => {
    // Flip the material to an unlit variant
    (mat as StandardMaterial).unlit = true;
  },
});

const result = await loader.loadAsync('assets/draco.glb');
scene.add(result.root);
```

### Exporting a scene to GLB and OBJ

```ts
import { GLTFExporter, OBJExporter } from '@vreen/engine/loaders';

const glb = new GLTFExporter().parseGLB(scene);  // Uint8Array
const obj = new OBJExporter().parse(scene);       // string
```

---

## Invariants

- **Pure parsers.** Loaders never touch WebGL state; they only produce
  engine objects (`BufferGeometry` / `Texture` / `Group` / `Material`).
  GPU upload is the renderer's responsibility.
- **Cache identity.** `(format, source)` is the unique cache key, computed
  via `cacheKeyFor(source)`. `File` keys include name + size + type;
  `Uint8Array` / `ArrayBuffer` keys include byte length + 8-byte head
  sample.
- **Single-flight.** Concurrent `load(format, source)` calls for the same
  key share one in-flight promise; the loader runs exactly once.
- **Failure evicts.** A rejected load is removed from the cache so the
  next call retries; aborts (`AbortError`) likewise do not poison the
  cache.
- **LRU bound.** `maxEntries` (default 64, 0 = unlimited) is enforced by
  evicting the lowest-`hits` (then oldest-`createdAt`) entries until the
  cache fits.
- **Exporters round-trip.** `GLTFExporter` output is consumable by
  `GLBLoader`; `OBJExporter` output is consumable by `OBJLoader`. Triangle
  winding, attribute layout, and material parameters survive the
  round trip within the supported feature subset.
- **Zero three.js dependency.** All loaders target the self-authored
  `@vreen/engine` core (`Group` / `Mesh` / `BufferGeometry` /
  `StandardMaterial` / `Texture`), not three.js types.
- **Optional Draco.** `draco3d` is a peer dependency; `decodeDraco` is
  only invoked when a glTF primitive declares `KHR_draco_mesh_compression`.

---

## Design Notes

**Why a `Loader<T>` interface instead of class inheritance?** Each format
has wildly different construction parameters and result types (geometry
vs texture vs scene). A generic interface with a `format` discriminator
lets `AssetManager` treat all loaders uniformly through a single
`Map<string, Loader<unknown>>`, while callers keep the typed result.

**Why `GLTFExtensionLoader` wraps `GLBLoader`?** The base `GLBLoader` is
a pure container parser — no DRACO, no KTX2, no extension hooks. Layering
the extension system on top keeps `GLBLoader` small and testable, while
`GLTFExtensionLoader` mirrors the three.js plugin model that glTF
tooling expects. Extension handlers run at well-defined seams
(`beforeParse` / `afterParse*`), keeping the parsing pipeline
deterministic.

**Why LRU by entry count, not bytes?** Accurate byte accounting would
require every loader to report its result size, which is awkward for
`Group` trees containing shared geometries. Entry-count LRU is
predictable, easy to reason about, and sufficient for the typical
asset-budget range (tens to low hundreds of assets per scene). For
texture-specific byte-bounded streaming, see the `Assets/TextureStreaming`
module.

**Why four separate exporters?** glTF, OBJ, STL, and PLY target
different toolchains (game engines / DCC / 3D printing / scientific).
Their output shapes (JSON+BIN vs ASCII text vs binary), feature sets
(PBR vs flat colour vs triangle-only), and consumers are distinct enough
that a single "universal exporter" would be larger than four focused
ones.

---

## References

- glTF 2.0 spec — https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- KTX 2.0 spec — https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
- FBX binary spec — https://github.com/blenderfbx/blob/master/fbx-binary-spec.txt
- Wavefront OBJ — https://en.wikipedia.org/wiki/Wavefront_.obj_file
- Wavefront MTL — https://en.wikipedia.org/wiki/Wavefront_.obj_file#Material_template_library
- STL format — https://en.wikipedia.org/wiki/STL_(file_format)
- PLY format — http://paulbourke.net/dataformats/ply/
- Radiance RGBE — https://www.graphics.cornell.edu/~bjw/rgbe/rgbe_image.html
- OpenEXR — https://openexr.readthedocs.io/
- Truevision TGA — https://en.wikipedia.org/wiki/Truevision_TGA
- Adobe Cube LUT 1.0 — https://wwwimages2.adobe.com/content/dam/acom/en/products/speedgrade/cc/pdfs/cube-lut-specification-1.0.pdf
- Draco3D — https://github.com/google/draco
- `Assets/` module — instance-level caching, reference counting, streaming
- `Pipeline/` module — import-time optimisation, format conversion
- `lib/roundtripDemo.ts` — GLBLoader ↔ GLTFExporter round-trip demo
