# Voxel Module

> Path: `src/engine/Voxel/`
>
> The voxel subsystem of the `@vreen/engine` kernel. Provides a
> type-palette registry (`VoxelPalette`), a fixed-size 16³ chunk
> (`VoxelChunk`), two meshing strategies with cross-chunk neighbour
> queries (`VoxelMesher`), a DDA raycaster (`VoxelRaycaster`), and a
> multi-chunk `VoxelWorld` manager with terrain generation, dirty-chunk
> tracking, and a `VoxelNeighborProvider` contract. Chunks are kept
> minimal (a `Uint8Array` of ids) so they serialise and sync cheaply.

---

## Overview

```
   VoxelPalette (id 0..255 → VoxelType { color, transparent, solid, customData })
   defaultPalette: stone / grass / dirt / sand / wood / water / glass (ids 1..7)
        │
        ▼
   VoxelChunk (16³ Uint8Array, idx = x + size*(z + size*y))
   ├── get / set / clear / getVoxelCount
   ├── isDirty / markDirty / clearDirty
   └── toMeshData(palette)              (intra-chunk face cull only)
        │
        │  VoxelNeighborProvider (structural interface)
        │     getVoxelInWorld(lx, ly, lz, ox, oy, oz) → id
        ▼
   VoxelMesher
   ├── simpleMesh(chunk, world, palette)   (per-face quad, cross-chunk cull)
   ├── greedyMesh(chunk, world, palette)   (rectangle merge, ~50% fewer tris)
   └── getAmbientOcclusion(side1, side2, corner) → 0..3
        │
        ▼
   VoxelRaycaster (DDA, Amanatides & Woo)
   ├── cast(world, palette) → this
   └── getHit() → VoxelRayHit { hit, voxel, voxelId, point, normal, distance }
        │
        ▼
   VoxelWorld (chunks: Map<"cx,cy,cz", VoxelChunk>)
   ├── getChunk(cx, cz)            (cy=0 convenience)
   ├── getChunk3D(cx, cy, cz)
   ├── getOrCreateChunk(cx, cy, cz)
   ├── getVoxel / setVoxel         (world coords, auto-routes to chunk)
   ├── getVoxelInWorld             (VoxelNeighborProvider impl)
   ├── generateTerrain(heightmap, grassId, dirtId, stoneId)
   ├── updateDirtyChunks()         (rebuilds greedy meshes for dirty chunks)
   ├── getChunkMesh(chunk)
   ├── raycast(origin, dir, maxDist)   (convenience VoxelRaycaster wrapper)
   └── getStats() → VoxelWorldStats
```

A `VoxelChunk` only stores ids; physical and visual properties are looked up
in a `VoxelPalette`. `VoxelWorld` owns chunks, routes world-space reads/writes
to the correct chunk, implements `VoxelNeighborProvider` so meshers can query
across chunk boundaries, and lazily rebuilds dirty chunk meshes via
`greedyMesh`. The 16³ chunk size is the unit of streaming, edit-remeshing, and
serialization — small enough for fast re-meshing, large enough for good cache
locality.

---

## Core Classes

### VoxelPalette (`VoxelPalette.ts`)

Mutable id→type registry. Id `0` is fixed to `AIR_VOXEL` and cannot be
overridden.

| Export | Role |
|--------|------|
| `VoxelPalette` | `register(type)` / `get(id) → VoxelType` / `getColor(id) → readonly [r, g, b]` / `isTransparent(id) → boolean` / `isSolid(id) → boolean` / `has(id)` / `list()` / `clear()`. |
| `VoxelType` | `{ id, name, color: [r,g,b] (linear 0..1), transparent, solid, customData? }`. |
| `AIR_VOXEL` | The fixed `id: 0` air type (`{ transparent: true, solid: false }`). |
| `defaultPalette` | Process-level singleton pre-registered with ids 1..7 (stone/grass/dirt/sand/wood/water/glass). |

`register` throws `RangeError` for ids outside `0..255`. `get` returns
`AIR_VOXEL` for unknown ids; `isTransparent` / `isSolid` return `false` for
unknown ids (conservative — non-blocking, non-transparent).

### VoxelChunk (`VoxelChunk.ts`)

A 16³ (configurable) `Uint8Array` of voxel ids. Index order
`idx = x + size*(z + size*y)` makes X the fastest axis and Y the slowest,
matching horizontal iteration patterns.

| Export | Role |
|--------|------|
| `VoxelChunk` | `get(x, y, z) → number` / `set(x, y, z, value)` / `index(x, y, z)` / `isDirty()` / `markDirty()` / `clearDirty()` / `clear()` / `getVoxelCount()` / `toMeshData(palette?) → VoxelMeshData`. |
| `VoxelMeshData` | `{ positions, normals, colors, indices, triangleCount }` (plain `number[]` arrays). |

```ts
class VoxelChunk {
  voxels: Uint8Array;
  position: Vector3;          // chunk origin in voxel units (world space)
  size: number;               // edge length in voxels (default 16)
}
```

`get` returns `0` (air) for out-of-bounds reads; `set` ignores out-of-bounds
writes. Both `set` and `clear` mark the chunk dirty only when the value
actually changes. `toMeshData` does *intra-chunk* face culling: a face is
generated when the neighbour in that direction is air, transparent (and a
different id), or out-of-bounds (chunk boundary). Cross-chunk culling is the
mesher's job, not the chunk's.

### VoxelMesher (`VoxelMesher.ts`)

Two meshing strategies plus an ambient-occlusion helper.

| Export | Role |
|--------|------|
| `simpleMesh(chunk, world, palette?)` | One quad per visible face. Cross-chunk neighbour queries via `world`. Same culling rules as `VoxelChunk.toMeshData` but correct at chunk boundaries. |
| `greedyMesh(chunk, world, palette?)` | Greedy rectangle merge (per-axis slice, mask-based) — merges adjacent same-id faces into large quads. Typically halves triangle count on flat terrain. |
| `getAmbientOcclusion(side1, side2, corner)` | Minecraft-style vertex AO. Returns `0..3` (`3` = no occlusion, `0` = fully occluded corner). If `side1 && side2`, returns `0`; else `3 - (side1 + side2 + corner)`. |
| `VoxelNeighborProvider` | Structural interface `getVoxelInWorld(localX, localY, localZ, originX, originY, originZ) → number`. `VoxelWorld` implements it; tests can inject mocks. |

Visibility rule (`isFaceVisible(aId, bId, palette)`): both opaque ⇒ no face;
A opaque, B transparent ⇒ face; A transparent, B opaque ⇒ no face; both
transparent ⇒ face only when ids differ (prevents internal water faces).

`greedyMesh` walks each of the three axes, builds a `size × size` mask of
`+id` / `-id` / `0` values, then greedily expands rectangles first along `u`
(width) then along `v` (height). Each rectangle emits one quad (4 vertices, 2
triangles). Winding is flipped for `-face` quads so normals point the right
way.

### VoxelRaycaster (`VoxelRaycaster.ts`)

Amanatides & Woo DDA voxel ray traversal. Stateless one-shot query:
construct, `cast(world, palette?)`, then `getHit()`.

| Export | Role |
|--------|------|
| `VoxelRaycaster` | `constructor(origin?, direction?, maxDistance?)` (direction normalised internally) / `set(origin, direction, maxDistance?) → this` / `cast(world, palette?) → this` / `getHit() → VoxelRayHit` / `getNormal(target?) → Vector3`. |
| `VoxelRayHit` | `{ hit, voxel: Vector3, voxelId, point: Vector3, normal: Vector3, distance }`. |

The starting voxel is checked first (so the ray can hit immediately when the
origin is inside a solid). Otherwise the algorithm picks the axis with the
smallest `tMax`, advances one voxel, and tracks which axis was crossed so the
hit normal points back toward the ray source (`-step` on the crossed axis).
A safety cap `maxIter = ceil(maxDistance * 3) + 16` prevents infinite loops
on degenerate directions.

### VoxelWorld (`VoxelWorld.ts`)

Multi-chunk world. Owns chunks in a `Map<string, VoxelChunk>` keyed
`"cx,cy,cz"`, plus a parallel `_meshes` cache rebuilt on demand.

| Export | Role |
|--------|------|
| `VoxelWorld` | `getChunk(cx, cz)` (cy=0 convenience) / `getChunk3D(cx, cy, cz)` / `getOrCreateChunk(cx, cy, cz)` / `getVoxel(x, y, z)` / `setVoxel(x, y, z, value)` / `getVoxelInWorld(lx, ly, lz, ox, oy, oz)` (implements `VoxelNeighborProvider`) / `generateTerrain(heightmap, grassId?, dirtId?, stoneId?)` / `updateDirtyChunks()` / `getChunkMesh(chunk)` / `raycast(origin, direction, maxDistance?)` / `getStats()`. |
| `VoxelWorldStats` | `{ chunkCount, voxelCount, triangleCount, dirtyChunkCount }`. |
| `Heightmap` | `number[][] \| Float32Array[] \| Uint16Array[]` — `[x][z] → height in voxels`. |

```ts
class VoxelWorld implements VoxelNeighborProvider {
  chunks: Map<string, VoxelChunk>;
  chunkSize: number;     // default 16
  worldSize: number;     // horizontal chunk count per side (default 4)
  maxHeight: number;     // vertical voxel limit (default 16)
  palette: VoxelPalette;
}
```

`getVoxel` returns `0` for `y < 0` or `y >= maxHeight`, or for missing chunks
— never auto-allocates. `setVoxel` auto-allocates the target chunk via
`getOrCreateChunk`. `generateTerrain` fills `[x][z]` columns from the
heightmap with a top `grass` layer, a `dirt` middle (up to 2 deep), and
`stone` below; heights above `maxHeight` are clamped. `updateDirtyChunks`
runs `greedyMesh(chunk, this, palette)` for each dirty chunk, caches the
result in `_meshes`, and clears the dirty flag.

---

## Usage

### Build a small world and raycast it

```ts
import { VoxelWorld, VoxelPalette, defaultPalette } from '@vreen/engine/voxel';
import { Vector3 } from '@vreen/engine/math';

const world = new VoxelWorld(16, 4, 16, defaultPalette);

// Place a 5x5 stone platform at y=0
for (let x = 0; x < 5; x++) {
  for (let z = 0; z < 5; z++) {
    world.setVoxel(x, 0, z, 1 /* stone */);
  }
}

// Raycast straight down from above
const hit = world.raycast(new Vector3(2, 10, 2), new Vector3(0, -1, 0), 100);
if (hit.hit) {
  console.log(hit.voxel, hit.voxelId, hit.point, hit.normal, hit.distance);
  // → Vector3(2,0,2), 1, (2,1,2), (0,1,0), 9
}
```

### Generate terrain from a heightmap and rebuild meshes

```ts
// Build a 64×64 heightmap (4 chunks × 16 voxels per side)
const heightmap: number[][] = [];
for (let x = 0; x < 64; x++) {
  heightmap[x] = [];
  for (let z = 0; z < 64; z++) {
    heightmap[x][z] = 4 + Math.floor(2 * Math.sin(x * 0.3) * Math.cos(z * 0.3) + 2);
  }
}

world.generateTerrain(heightmap);    // grass top, dirt middle, stone bottom
const rebuilt = world.updateDirtyChunks();   // returns # of chunks re-meshed
const stats = world.getStats();
console.log(stats.chunkCount, stats.voxelCount, stats.triangleCount);
```

### Greedy vs. simple meshing

```ts
import { greedyMesh, simpleMesh } from '@vreen/engine/voxel';

const chunk = world.getChunk(0, 0)!;
const simple = simpleMesh(chunk, world, world.palette);
const greedy = greedyMesh(chunk, world, world.palette);
console.log(simple.triangleCount, greedy.triangleCount);
// Greedy is typically ~50% smaller on flat terrain
```

### Custom palette registration

```ts
const palette = new VoxelPalette();
palette.register({
  id: 10,
  name: 'lava',
  color: [1.0, 0.3, 0.0],
  transparent: false,
  solid: true,
  customData: { damage: 5, sound: 'lava_idle' },
});
const world = new VoxelWorld(16, 4, 16, palette);
```

### Vertex ambient occlusion during meshing

```ts
import { getAmbientOcclusion } from '@vreen/engine/voxel';

// side1 / side2 / corner: 1 if the neighbour is solid, 0 otherwise.
const ao = getAmbientOcclusion(side1Solid, side2Solid, cornerSolid);
// 3 → full bright, 0 → fully occluded corner; map to a vertex colour multiplier.
const shade = 0.5 + 0.5 * (ao / 3);
```

### Direct chunk access (no world)

```ts
import { VoxelChunk } from '@vreen/engine/voxel';
import { Vector3 } from '@vreen/engine/math';

const chunk = new VoxelChunk(new Vector3(0, 0, 0), 16);
chunk.set(0, 0, 0, 1);          // stone at corner
chunk.set(1, 0, 0, 1);
const mesh = chunk.toMeshData();   // intra-chunk cull only; no cross-chunk neighbours
console.log(mesh.triangleCount);
```

---

## Invariants

- **`VoxelPalette` id `0` is always `AIR_VOXEL`.** `clear()` keeps it;
  `register` may overwrite it but no other id can claim `0`. Unknown ids
  resolve to `AIR_VOXEL` from `get` and to `false` from `isSolid` /
  `isTransparent` (conservative).
- **`VoxelChunk` index order is fixed.** `idx = x + size*(z + size*y)` —
  X fastest, Y slowest. Changing the order would break serialization and
  network sync; do not parameterise it.
- **`VoxelChunk.get` is bounds-safe.** Out-of-bounds reads return `0`
  (air). `set` ignores out-of-bounds writes. Neither throws.
- **`VoxelChunk.set` marks dirty only on actual change.** Setting the
  same id twice does not flag the chunk dirty, so no-op edits do not
  trigger re-meshing.
- **`VoxelChunk.toMeshData` does only intra-chunk culling.** Boundary
  faces are always generated; cross-chunk culling requires the mesher
  functions (`simpleMesh` / `greedyMesh`) with a `VoxelNeighborProvider`.
- **`VoxelWorld.getVoxel` never auto-allocates chunks.** Missing chunks
  return `0` (air). `setVoxel` does auto-allocate via
  `getOrCreateChunk` so callers can write freely.
- **`VoxelWorld.getVoxel` returns `0` outside `[0, maxHeight)`.** Y-bounds
  are checked before chunk lookup, so `y < 0` or `y >= maxHeight` is
  always air.
- **`VoxelWorld.updateDirtyChunks` uses `greedyMesh`.** All dirty chunks
  are re-meshed with the greedy strategy via the world itself as the
  `VoxelNeighborProvider`; `simpleMesh` is exposed for callers that want
  the simpler per-face layout (e.g. for debugging).
- **`VoxelRaycaster.cast` checks the origin voxel first.** If the origin
  is inside a solid voxel, the hit is reported with `distance = 0` and
  zero normal. Otherwise DDA advances one voxel at a time and the
  crossed-axis `−step` becomes the hit normal.
- **`VoxelRaycaster` direction is normalised in the constructor / `set`.**
  Callers may pass non-unit directions; `maxDistance` is always in world
  units.
- **`greedyMesh` winding is axis-sign aware.** `+face` quads use one
  winding order, `−face` quads the opposite, so triangle front-faces
  point outward on both sides of a slab.

---

## References

- Amanatides, J. & Woo, A. "A Fast Voxel Traversal Algorithm for Ray
  Tracing" (1987) — DDA algorithm implemented by `VoxelRaycaster`.
- 0fps, "Meshing in a voxel game" — greedy meshing algorithm
  (mask-based rectangle merge) implemented by `greedyMesh`.
- Minecraft-style ambient occlusion — `getAmbientOcclusion(side1, side2,
  corner)` follows the standard corner-occlusion rule.
- Internal: `VoxelWorld` is the only `VoxelNeighborProvider`
  implementation shipped; tests can inject mocks. `VoxelChunk` and
  `VoxelPalette` are deliberately independent of `VoxelWorld` so they can
  be reused in streaming / networked scenarios where chunks arrive
  out-of-order.
- Internal: `Tools/LODManager` can treat each chunk's `VoxelMeshData` as
  a LOD level when streaming large voxel worlds; the 16³ chunk size
  balances re-mesh cost against cache locality.
