# SurfaceData Module

> Path: `src/engine/SurfaceData/`
>
> The surface data subsystem of the `@vreen/engine` kernel. Provides
> weighted `SurfaceTag` labels, a `SurfacePoint` sample structure
> (position + normal + tags), a `SurfaceDataProvider` interface with a
> process-level `SurfaceDataProviderRegistry`, a `SurfaceDataSystem` that
> merges every provider's points into one canonical `SurfacePoint`, and a
> `TerrainSurfaceProvider` adapter that tags terrain by altitude and
> slope bands. Drives terrain material blending, footstep audio, particle
> triggers, and vegetation filtering.

---

## Overview

Surface data decouples "what surface am I standing on?" from the systems
that produce it. Producers (terrain, water, vegetation, decals) register
as `SurfaceDataProvider`s; consumers (audio, gameplay, vegetation, AI)
ask the `SurfaceDataSystem` a single question — `query(worldPosition)` —
and get back one merged `SurfacePoint` whose tags carry the combined
weights of every provider that had an opinion at that point.

```
SurfaceDataProvider (interface)            ── registered into ──┐
   ├── TerrainSurfaceProvider              (altitude/slope bands)│
   ├── (water provider)                    (caller-supplied)     │
   └── (vegetation provider)               (caller-supplied)     │
                                                               ▼
                                          SurfaceDataProviderRegistry
                                                  (Map<id, provider>)
                                                               │
                                                               ▼
                                          SurfaceDataSystem(registry)
                                               │            │            │
                                  query(pos) ──┘            │            └── queryBatch(poss)
                                       │                    │
                                       ▼                    ▼
                            merges all provider points    one query per pos
                             (sum + clamp tag weights,
                              first position, first non-zero normal)
                                       │
                                       ▼
                             SurfacePoint { position, normal, tags[] }
                                       │
                          getDominantTag / getTagWeight
                                       │
                                       ▼
                          'grass' | 'rock' | 'sand' | ... | null
```

Tags are plain strings (`SurfaceTagId = string`) so they are JSON-friendly
and need no symbol table. Each tag carries a `weight` in `[0, 1]`;
providers assign weights by their own rules (terrain uses 0/1 band
membership, blending providers may interpolate). The system sums weights
per tag id across providers and clamps to 1.

---

## Core Classes

### Tags

| Export | Role |
|--------|------|
| `SurfaceTagId` | Type alias for `string`. Human-readable tag id. |
| `SurfaceTag` | Interface: `id: SurfaceTagId`, `weight: number` (0..1). |
| `TAG_GRASS` / `TAG_ROCK` / `TAG_SAND` / `TAG_WATER` / `TAG_ICE` / `TAG_METAL` / `TAG_WOOD` / `TAG_DIRT` / `TAG_SNOW` | Predefined tag id constants (`'grass'`, `'rock'`, ...). |
| `DEFAULT_TAGS` | Array of the nine predefined tag ids. |

```ts
export type SurfaceTagId = string;
export interface SurfaceTag { id: SurfaceTagId; weight: number; }
```

Custom tags are arbitrary strings — the registry does not validate
against `DEFAULT_TAGS`. Use the constants only to avoid typos in common
cases.

### Surface Point

| Export | Role |
|--------|------|
| `SurfacePoint` | Interface: `position: Vector3`, `normal: Vector3`, `tags: SurfaceTag[]`. |
| `createSurfacePoint(position, normal, tags?)` | Factory that **clones** `position` and `normal` so the returned point owns its vectors. |
| `getDominantTag(point)` | Returns the id of the highest-weight tag, or `null` if there are no tags or all weights are 0. |
| `getTagWeight(point, id)` | Returns the weight of `id` on `point`, or `0` if absent. |

```ts
export interface SurfacePoint {
  position: Vector3;
  normal: Vector3;
  tags: SurfaceTag[];
}
```

### Provider & Registry

| Export | Role |
|--------|------|
| `SurfaceDataProvider` | Interface: `id: string`, `getSurfacePoints(worldPosition, maxPoints): SurfacePoint[]`. Returns empty array when the provider has no surface at that point. |
| `SurfaceDataProviderRegistry` | `register(provider)` / `unregister(id)` / `get(id)` / `getAll()` / `clear()`. Backed by a `Map`. Last `register` for an id wins. |
| `defaultSurfaceDataRegistry` | Process-level singleton `SurfaceDataProviderRegistry` for apps that want one global registry. |

```ts
export interface SurfaceDataProvider {
  readonly id: string;
  getSurfacePoints(worldPosition: Vector3, maxPoints: number): SurfacePoint[];
}
```

### System

| Export | Role |
|--------|------|
| `SurfaceDataSystem` | Constructed with a `SurfaceDataProviderRegistry`. `query(pos, maxPointsPerProvider = 4)` returns the merged `SurfacePoint` or `null`. `queryTag(pos)` returns the dominant tag id. `queryBatch(poss)` maps `query` over an array. |

Merge rules for `query()`:
- **Tags** — summed per id across all returned points, clamped to `[0, 1]`.
- **Position** — the first non-null point's position (provider order is
  `Map` insertion order).
- **Normal** — the first point with a non-zero normal; falls back to
  `(0, 1, 0)` if every normal is zero.
- **Empty** — if no provider returns any point, returns `null`.

```ts
export class SurfaceDataSystem {
  constructor(registry: SurfaceDataProviderRegistry);
  query(worldPosition: Vector3, maxPointsPerProvider?: number): SurfacePoint | null;
  queryTag(worldPosition: Vector3): string | null;
  queryBatch(positions: Vector3[]): (SurfacePoint | null)[];
}
```

### Terrain Adapter

| Export | Role |
|--------|------|
| `TerrainSurfaceConfig` | Interface: `altitudeBands` (tag + min/max altitude) and optional `slopeBands` (tag + min/max slope in radians). |
| `TerrainSurfaceProvider` | Implements `SurfaceDataProvider`. Constructed with `id`, `getHeightAt(x,z)`, `getNormalAt(x,z)`, and a `TerrainSurfaceConfig`. Tags the surface with weight 1 for every band the point falls into. |

```ts
export interface TerrainSurfaceConfig {
  altitudeBands: Array<{ tag: string; minAltitude: number; maxAltitude: number }>;
  slopeBands?: Array<{ tag: string; minSlope: number; maxSlope: number }>;
}
```

`TerrainSurfaceProvider` injects `getHeightAt` / `getNormalAt` callbacks
rather than importing `TerrainGeometry` directly, so it has no hard
dependency on the `Terrain` module and is trivially mockable in unit
tests. Slope is computed as `acos(normal.y)` (assuming a normalized
normal and up = `(0, 1, 0)`), clamped to `[-1, 1]` before `acos`.

---

## Usage

### Register a terrain provider and query it

```ts
import {
  SurfaceDataSystem, TerrainSurfaceProvider, defaultSurfaceDataRegistry,
  TAG_GRASS, TAG_ROCK, TAG_SNOW, TAG_SAND,
} from '@vreen/engine/surfacedata';
import { Vector3 } from '@vreen/engine';

const terrain = new TerrainSurfaceProvider(
  'terrain',
  (x, z) => terrainGeometry.getHeightAt(x, z),
  (x, z) => terrainGeometry.getNormalAt(x, z),
  {
    altitudeBands: [
      { tag: TAG_SAND,  minAltitude: 0,   maxAltitude: 2 },
      { tag: TAG_GRASS, minAltitude: 2,   maxAltitude: 30 },
      { tag: TAG_ROCK,  minAltitude: 30,  maxAltitude: 60 },
      { tag: TAG_SNOW,  minAltitude: 60,  maxAltitude: 200 },
    ],
    slopeBands: [
      { tag: TAG_ROCK, minSlope: Math.PI / 4, maxSlope: Math.PI / 2 }, // >45° → rock
    ],
  },
);
defaultSurfaceDataRegistry.register(terrain);

const system = new SurfaceDataSystem(defaultSurfaceDataRegistry);
const point = system.query(new Vector3(10, 0, 5));
if (point) {
  console.log(getDominantTag(point));           // 'grass'
  console.log(getTagWeight(point, TAG_ROCK));    // 0 or 1
}
```

### Custom provider (water surface)

```ts
import {
  SurfaceDataProvider, defaultSurfaceDataRegistry,
  createSurfacePoint, TAG_WATER,
} from '@vreen/engine/surfacedata';

const water: SurfaceDataProvider = {
  id: 'water',
  getSurfacePoints(worldPosition, maxPoints) {
    if (maxPoints <= 0) return [];
    if (worldPosition.y <= waterLevel) {
      return [createSurfacePoint(
        new Vector3(worldPosition.x, waterLevel, worldPosition.z),
        new Vector3(0, 1, 0),
        [{ id: TAG_WATER, weight: 1 }],
      )];
    }
    return [];
  },
};
defaultSurfaceDataRegistry.register(water);
// system.query() now merges terrain + water: a point at y=1 gets both
// grass (terrain) and water tags, with each weight clamped to 1.
```

### Footstep audio lookup

```ts
const surface = system.query(avatar.position);
const tag = system.queryTag(avatar.position) ?? TAG_DIRT;
audio.play(`footstep/${tag}`);
```

---

## Invariants

- **Tag weights are clamped.** `query()` sums weights per id and clamps
  to `[0, 1]`; a single provider may return weight > 1 but it is
  normalized at merge time.
- **`createSurfacePoint` clones its inputs.** The returned `position` and
  `normal` are independent of the caller's vectors; later mutation of the
  originals does not affect the point.
- **Provider order is insertion order.** `getAll()` returns providers in
  `Map` insertion order, so the "first position" / "first non-zero
  normal" in the merge is deterministic given a stable registration
  sequence. Re-registering an id does not move it.
- **`query` never throws for an empty registry.** With no providers it
  returns `null`; consumers must null-check.
- **`getDominantTag` returns `null` for zero weights.** A point whose
  tags all have weight 0 (or that has no tags) yields `null`, not a
  fallback tag.
- **`TerrainSurfaceProvider` emits at most one point per query.** It
  honors `maxPoints <= 0` by returning `[]`, otherwise returns exactly
  one `SurfacePoint` with every matching band as a separate tag entry.
- **`defaultSurfaceDataRegistry` is process-global.** Tests that mutate
  it must call `clear()` in teardown to avoid cross-test leakage; production
  code may alternatively construct a private `SurfaceDataProviderRegistry`.
- **Slope uses normalized normals.** `TerrainSurfaceProvider` assumes
  `getNormalAt` returns a unit vector; the `acos` argument is still
  clamped to `[-1, 1]` to guard against float drift.

---

## Design Notes

**Why strings for tags instead of an enum?** A runtime enum would force
every consumer to depend on the surface data module's symbol table, and
would block data-driven tag sets (modded surfaces, level-specific
materials). Plain strings are JSON-serializable, comparable across
process boundaries, and need no registration. The predefined `TAG_*`
constants are conveniences, not a closed set.

**Why merge instead of "first provider wins"?** Real surfaces are rarely
owned by one system: a shoreline point is both water and sand, a mossy
rock is both rock and grass. Summing weights (then clamping) lets
consumers ask "how much grass is here?" with `getTagWeight` and pick the
strongest signal with `getDominantTag`. Clamp-at-1 keeps the value in a
useful `[0, 1]` range for shader/audio blending.

**Why callback injection in `TerrainSurfaceProvider`?** Importing
`TerrainGeometry` directly would create a circular concern (`Terrain`
already depends on `Math`/`Core`; `SurfaceData` should stay leaf-ish) and
would couple the provider to one geometry implementation. Callbacks let
the same provider wrap a heightmap, a procedural function, or a test
stub, and keep `SurfaceData` free of a `Terrain` import.

**Why a singleton `defaultSurfaceDataRegistry`?** Most apps want one
global surface truth; the singleton removes boilerplate. The
`SurfaceDataSystem` still takes a registry in its constructor, so tests
and multi-world setups can pass a private registry and avoid the
singleton entirely.

---

## References

- o3de Gems/SurfaceData — `SurfaceTag`, `SurfacePoint`,
  `SurfaceDataProvider`, `SurfaceDataSystem`,
  `TerrainSurfaceDataModifier` design reference.
- `src/engine/Terrain/README.md` — `TerrainGeometry.getHeightAt` /
  `getNormalAt` wrapped by `TerrainSurfaceProvider`.
- `src/engine/Vegetation/README.md` — `SurfaceMaskFilter` reads
  `getTagWeight` from this module.
- `src/engine/Audio/README.md` — footstep selection by dominant tag.
- Top-level barrel — `src/engine/index.ts` re-exports this module.
