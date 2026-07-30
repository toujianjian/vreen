# Terrain Module

> Path: `src/engine/Terrain/`
>
> The terrain subsystem of the `@vreen/engine` kernel. Generates
> heightmap-driven terrain geometry, procedural heightmaps (Perlin /
> Diamond-Square / Ridge / Flat), texture-layer blending via splatmaps,
> natural erosion (thermal / hydraulic / wind), and an interactive
> brush editor with undo/redo. All classes are decoupled from
> `Material` and `Scene`: they emit `BufferGeometry`, typed arrays or
> operate in place on a `Float32Array` heightmap.

---

## Overview

```
HeightmapGenerator ──static──→ Float32Array (0..1, normalized)
                                    │
                                    ▼
              ┌──────────────────────────────────────────┐
              │            TerrainGeometry               │  extends BufferGeometry
              │  heightmap · width · height · heightScale│
              │  position / normal (central diff) / uv   │
              │  getHeightAt(x, z) — bilinear sample     │
              └─────────┬────────────────────┬───────────┘
                        │                    │
            consumed by │         edited by  │
                        ▼                    ▼
                 TerrainSplat            TerrainEditor  (duck-typed: any
                 │  layers[]             │  { heightmap, width, height,
                 │  RGBA splatmap        │    widthSegments, heightSegments,
                 ▼                       │    heightScale, splatmap? })
              TerrainLayer               │  tools: raise/lower/smooth/flatten
              (texture + rules)          │        /paint/noise/erode
                                         │  undo/redo via TerrainEdit snapshots
                        │                │
                        ▼                ▼
                 TerrainErosion ──in-place──→ heightmap Float32Array
                   thermal / hydraulic / wind
                   erosionMap (net change per cell)
```

Two heightmap conventions coexist:

- **Normalized values** (`Float32Array`, `0..1`) are the canonical
  in-memory representation; world Y = `normalized * heightScale`.
- **8-bit values** (`Uint8Array`, `0..255`) are accepted as input by
  `TerrainGeometry` and auto-normalized (divided by 255), so heightmap
  textures can flow straight in.

---

## Core Classes

### Geometry

| Export | Role |
|--------|------|
| `TerrainGeometry` | Heightmap-driven `BufferGeometry` subclass. Vertices lie on the XZ plane (Y up), with Y sampled from the heightmap. Normals are computed by central difference (smoother than `computeVertexNormals`). Provides `getHeightAt(x, z)` bilinear sampling for camera/character grounding. |

```ts
interface TerrainGeometryOptions {
  width: number; height: number;          // world X / Z size
  widthSegments?: number; heightSegments?: number;  // inferred from square heightmap if omitted
  heightmap: Float32Array | Uint8Array;   // length must equal (seg+1)*(seg+1)
  heightScale?: number;                   // normalized × heightScale = world Y, default 1
}
class TerrainGeometry extends BufferGeometry {
  readonly width, height, widthSegments, heightSegments, heightScale;
  readonly heightmap: Float32Array;       // normalized 0..1
  readonly gridX1, gridY1: number;        // vertex counts (seg + 1)
  getHeightAt(x: number, z: number): number;  // bilinear, clamped to bounds, × heightScale
}
```

If `widthSegments`/`heightSegments` are omitted, the constructor
attempts to infer a square grid via `Math.sqrt(heightmap.length)` and
throws if the length is not a perfect square.

### Heightmap Generation

| Export | Role |
|--------|------|
| `HeightmapGenerator` | Stateless function set. Returns `Float32Array` normalized to `[0, 1]` for direct feed into `TerrainGeometry`. Algorithms: `fromPerlinNoise` (fBm), `fromDiamondSquare` (blocky mountains), `fromRidge` (sharp ridges), `fromFlat` (zero plane). All accept a `seed` routed through `mulberry32`. |

```ts
class HeightmapGenerator {
  static fromPerlinNoise(width, height, options?: {
    scale?: number; octaves?: number; persistence?: number; lacunarity?: number;
    seed?: number; heightScale?: number;
  }): Float32Array;
  static fromDiamondSquare(size, options?: { roughness?: number; seed?: number }): Float32Array;
  static fromRidge(width, height, options?: { scale?: number; octaves?: number; seed?: number }): Float32Array;
  static fromFlat(width, height): Float32Array;
}
```

`HeightmapGenerator` complements `PCG/NoiseGenerator`: the former is a
stateless function set returning ready-to-use heightmaps; the latter is
a stateful instance for ad-hoc sampling. Both share the `mulberry32`
PRNG so seeds are reproducible across the two.

### Texture Layers & Splatting

| Export | Role |
|--------|------|
| `TerrainLayer` | Describes one splat layer: a tileable `Texture` plus `minHeight` / `maxHeight` (world Y) and `maxSlope` (degrees) distribution rules, plus a UV `scale`. |
| `TerrainSplat` | Generates an RGBA `Uint8Array` splatmap (one byte per vertex, 4 channels) by evaluating each layer's height-tent × slope-fit weight, then normalizing so `R+G+B+A = 255` per vertex. Max 4 layers (`MAX_LAYERS`). |

```ts
interface TerrainLayerOptions {
  texture: Texture; scale?: number;        // default 1
  minHeight?: number; maxHeight?: number;  // default ±Infinity
  maxSlope?: number;                       // degrees, default 90
}
class TerrainLayer { texture; scale; minHeight; maxHeight; maxSlope; }

class TerrainSplat {
  static readonly MAX_LAYERS = 4;
  layers: TerrainLayer[];
  splatmap: Uint8Array | null;             // length = vertexCount * 4
  splatmapWidth, splatmapHeight: number;
  addLayer(layer: TerrainLayer): this;     // throws past 4
  generateSplatmap(geometry: TerrainGeometry, layerRules: TerrainLayer[]): Uint8Array;
  getSplatmap(): Uint8Array | null;
}
```

**Weight rule.** For each vertex: `heightFit` is a tent function over
`[minHeight, maxHeight]` (1 inside, linear falloff outside);
`slopeFit` is 1 below `maxSlope` then linearly decays over a 30° band.
`weight = heightFit × slopeFit`. Weights are normalized; if all are
zero, layer 0 gets full weight (avoids holes). The largest-weight
channel absorbs rounding error so the four bytes always sum to 255.

### Erosion

| Export | Role |
|--------|------|
| `TerrainErosion` | In-place heightmap erosion. Three mechanisms — `applyThermalErosion` (gravity/talus angle), `applyHydraulicErosion` (raindrop particle flow with inertia, sediment capacity, deposition), `applyWindErosion` (downwind material transport with wind-shadow). `erode(options)` runs all three in sequence. Tracks per-cell net change in `erosionMap`. |

```ts
interface ErodeOptions {
  thermalIterations?: number;
  hydraulicDrops?: number;
  rainAmount?: number;                     // per-drop initial water
  windDirection?: { x: number; y: number };
  windStrength?: number;                   // 0..1
  seed?: number;                           // default Date.now()-derived
}
interface ErosionStats {
  averageErosion: number;                  // negative = net loss
  maxDeposition: number;                   // positive
  maxErosion: number;                      // negative (min of erosionMap)
  volumeChange: number;                    // Σ erosionMap
  cellCount: number;
}
class TerrainErosion {
  width, height: number;
  heightmap: Float32Array;                 // modified in place
  erosionMap: Float32Array;                // net change since setHeightmap
  thermalErosionRate, hydraulicErosionRate, windErosionRate: number;  // 0..1
  talusAngle: number;                      // degrees, default 35
  iterations: number;                      // default 50
  setHeightmap(data, width, height): this;  // copies in, resets erosionMap
  getHeightmap(): Float32Array;
  applyThermalErosion(): this;
  applyHydraulicErosion(rainAmount?, drops?): this;
  applyWindErosion(direction, strength?): this;
  erode(options?: ErodeOptions): this;     // runs all three
  smooth(iterations?): this;
  getStats(): ErosionStats;
}
```

**Decoupling.** `TerrainErosion` does not hold a `TerrainGeometry`
reference — it operates on a bare `Float32Array`. The caller is
responsible for writing the eroded heightmap back into a geometry
(typically by constructing a new `TerrainGeometry`).

### Interactive Editor

| Export | Role |
|--------|------|
| `TerrainEditor` | Brush-based interactive editor. Duck-typed against any object exposing `{ heightmap, width, height, widthSegments, heightSegments, heightScale, splatmap? }` — works with `TerrainGeometry` or custom terrain implementations. Seven tools, three brush shapes, falloff control, and an undo/redo stack of `TerrainEdit` snapshots. |

```ts
type BrushShape  = 'circle' | 'square' | 'diamond';
type TerrainTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint' | 'noise' | 'erode';
interface TerrainEdit {                    // undo/redo snapshot
  tool: TerrainTool;
  position: { x: number; z: number };
  brushSize, brushStrength: number;
  affectedIndices: number[];              // heightmap indices touched
  beforeData: Float32Array; afterData: Float32Array;  // per-index slices
  splatBefore?: Uint8Array | null; splatAfter?: Uint8Array | null;
}
interface TerrainEditorStats {
  tool, brushSize, brushStrength, historySize, redoSize, totalEdits;
}
class TerrainEditor {
  terrain: any | null;                     // duck-typed TerrainLike
  brushSize, brushStrength, brushFalloff: number;  // 0..1
  brushShape: BrushShape; tool: TerrainTool;
  layerIndex: number;                      // 0..3 for paint
  heightTarget: number;                    // world Y for flatten
  noiseScale, noiseAmplitude: number;      // for noise tool
  history: TerrainEdit[]; maxHistory: number;  // default 50
  setTerrain(t): this; setBrushSize(s): this; setBrushStrength(s): this;
  setBrushFalloff(f): this; setBrushShape(s): this; setTool(t): this;
  setLayer(i): this; setHeightTarget(h): this; setNoiseParams(scale, amp): this;
  computeBrushWeights(x, z): Map<number, number>;  // vertexIndex → weight
  apply(x, z): this;                       // dispatches to current tool, records history
  canUndo(): boolean; undo(): this; canRedo(): boolean; redo(): this;
  getStats(): TerrainEditorStats;
}
```

**Tool semantics.** `raise`/`lower` move height by
`brushStrength × 0.5 × weight`; `smooth` converges to the 3×3
neighborhood mean; `flatten` converges to `heightTarget`;
`paint` redistributes splat weight toward `layerIndex` (subtracting
proportionally from other channels); `noise` adds Perlin-style
perturbation; `erode` is a simplified thermal pass. `paint` records
splat snapshots instead of heightmap slices. The editor mutates
`terrain.heightmap` in place — the caller must notify the render layer
to recompute normals and re-upload to the GPU.

---

## Usage

### Procedural terrain with splatmap

```ts
import {
  TerrainGeometry, HeightmapGenerator, TerrainSplat, TerrainLayer,
} from '@vreen/engine/terrain';
import { Mesh } from '@vreen/engine/core';
import { StandardMaterial } from '@vreen/engine/materials';

const heightmap = HeightmapGenerator.fromPerlinNoise(129, 129, {
  scale: 0.02, octaves: 6, persistence: 0.5, lacunarity: 2, seed: 42,
});
const geometry = new TerrainGeometry({
  width: 100, height: 100, heightmap, heightScale: 20,
});

const splat = new TerrainSplat();
const splatmap = splat.generateSplatmap(geometry, [
  new TerrainLayer({ texture: sandTex,  minHeight: 0,  maxHeight: 2,  maxSlope: 15 }),
  new TerrainLayer({ texture: grassTex, minHeight: 1,  maxHeight: 8,  maxSlope: 35 }),
  new TerrainLayer({ texture: rockTex,  minHeight: 5,  maxHeight: 20, maxSlope: 90 }),
  new TerrainLayer({ texture: snowTex,  minHeight: 15, maxHeight: 30, maxSlope: 25 }),
]);
geometry.setAttribute('splat', new BufferAttribute(splatmap, 4));

const mesh = new Mesh(geometry, new StandardMaterial({ /* splat shader */ }));
scene.add(mesh);

// Ground the camera
const y = geometry.getHeightAt(camera.position.x, camera.position.z);
camera.position.y = y + 1.5;
```

### Erosion pipeline

```ts
import { HeightmapGenerator, TerrainErosion, TerrainGeometry } from '@vreen/engine/terrain';

let heightmap = HeightmapGenerator.fromPerlinNoise(129, 129, { seed: 7, scale: 0.01 });

const erosion = new TerrainErosion();
erosion.talusAngle = 35;
erosion.setHeightmap(heightmap, 129, 129);
erosion.applyThermalErosion();
erosion.applyHydraulicErosion(1.0, 8000);
erosion.applyWindErosion({ x: 1, y: 0.3 }, 0.5);
heightmap = erosion.getHeightmap();           // in-place result
const stats = erosion.getStats();             // { averageErosion, maxDeposition, ... }

const geometry = new TerrainGeometry({
  width: 100, height: 100, heightmap, heightScale: 20,
});
```

### Interactive brush editing

```ts
import { TerrainEditor } from '@vreen/engine/terrain';

const editor = new TerrainEditor();
editor.setTerrain(geometry)        // duck-typed — accepts TerrainGeometry
  .setTool('raise')
  .setBrushSize(5)
  .setBrushStrength(0.6)
  .setBrushFalloff(0.7)
  .setBrushShape('circle');

// On pointer move with mouse down:
editor.apply(worldX, worldZ);
geometry.attributes.normal.needsUpdate = true;   // caller-owned GPU re-upload

// Undo / redo
if (editor.canUndo()) editor.undo();
if (editor.canRedo()) editor.redo();
const stats = editor.getStats();   // { tool, brushSize, historySize, redoSize, totalEdits }
```

---

## Invariants

- **Heightmap length contract.** `TerrainGeometry` requires
  `heightmap.length === (widthSegments + 1) * (heightSegments + 1)`;
  a mismatch throws. If segments are omitted, the length must be a
  perfect square.
- **Normalized heightmap domain.** `TerrainGeometry.heightmap` and
  `TerrainErosion.heightmap` store normalized `[0, 1]` values; world
  Y is always `normalized × heightScale`. `Uint8Array` input is
  divided by 255 on the way in.
- **`getHeightAt` bounds.** Out-of-range `(x, z)` is clamped to the
  terrain boundary, never extrapolated.
- **Splatmap channel sum.** Every vertex's RGBA bytes sum to exactly
  255 (rounding error absorbed into the largest-weight channel); a
  vertex with no layer fit defaults to layer 0 = 255.
- **Splat layer cap.** `TerrainSplat.MAX_LAYERS === 4` (RGBA channels);
  `addLayer` / `generateSplatmap` throw past this limit.
- **Erosion is in-place.** `TerrainErosion.setHeightmap` copies the
  input; subsequent `apply*` calls mutate the internal buffer and
  accumulate into `erosionMap`. `getStats()` reflects net change since
  the last `setHeightmap`.
- **Editor duck-typing.** `TerrainEditor` never imports `TerrainGeometry`;
  it accepts any object with `{ heightmap, width, height,
  widthSegments, heightSegments, heightScale, splatmap? }`. The
  caller owns GPU re-upload and normal recomputation after edits.
- **Editor history cap.** `maxHistory` (default 50) trims the oldest
  `TerrainEdit` when exceeded; `redo` stack clears on any new `apply`.
- **PRNG consistency.** `HeightmapGenerator`, `TerrainErosion` and
  `PCG/NoiseGenerator` all use `mulberry32` so seeds reproduce across
  modules; `TerrainErosion.erode()` re-seeds its internal RNG per call.

---

## References

- `src/engine/PCG/NoiseGenerator.ts` — stateful noise sampler
  complementing `HeightmapGenerator`'s static `Perlin2D`.
- `src/engine/Core/BufferGeometry.ts` / `BufferAttribute.ts` — base
  class and attribute container for `TerrainGeometry`.
- `src/engine/Core/Texture.ts` — `TerrainLayer.texture` type.
- `src/engine/Geometries/PlaneGeometry.ts` — related primitive;
  `TerrainGeometry` differs by lying on XZ (Y up) and sourcing Y from
  a heightmap with central-difference normals.
- `src/engine/Renderer/WebGL2Renderer.ts` — consumes the splatmap
  attribute when shading terrain via the PBR pipeline.
- Mei, Decaudin & Cani, *Fast Hydraulic Erosion Simulation on GPU*
  (2007) — basis for the simplified particle hydraulic erosion.
