# Vegetation Module

> Path: `src/engine/Vegetation/`
>
> The composable vegetation spawning pipeline of the `@vreen/engine` kernel.
> Provides weighted `VegetationDescriptor` metadata, a chainable
> `VegetationFilter` family (altitude / slope / surface mask / distance /
> shape intersection / distribution), a chainable `VegetationModifier`
> family (position jitter / rotation / scale / slope alignment),
> `SpawnerArea` performing rejection sampling against `SurfaceDataSystem`,
> and `AreaBlender` for priority-ordered multi-area spawning. The module
> produces backend-agnostic `SpawnedInstance[]` arrays that the caller maps
> onto an `InstancedMesh` or any other renderer.

---

## Overview

The vegetation pipeline is a four-stage dataflow: descriptor selection →
candidate sampling → filter chain → modifier chain. Each stage is
composable and deterministic (seeded `mulberry32` PRNG), so identical
inputs reproduce identical spawns.

```
VegetationDescriptor[] ──weighted pick──┐
                                        ▼
SpawnerArea.spawn(surfaceData) ──rejection sampling──→ candidate position
        │                                              │
        │              ┌───────────────────────────────┘
        │              ▼
        │   VegetationFilterContext { position, surface, normal, slope,
        │                             altitude, descriptor }
        │              │
        │              ▼
        │   VegetationFilter[] (chain, short-circuit on first reject)
        │     ├─ SurfaceAltitudeFilter
        │     ├─ SurfaceSlopeFilter
        │     ├─ SurfaceMaskFilter        (reads SurfaceData tags)
        │     ├─ DistanceBetweenFilter    (mutates shared `placed[]`)
        │     ├─ ShapeIntersectionFilter  (reads Shapes module)
        │     └─ DistributionFilter       (seeded random accept)
        │              │ all pass
        │              ▼
        │   VegetationModifierContext { position, rotation, scale, ... }
        │              │
        │              ▼
        │   VegetationModifier[] (chain, each mutates ctx in place)
        │     ├─ PositionModifier
        │     ├─ RotationModifier
        │     ├─ ScaleModifier
        │     └─ SlopeAlignmentModifier
        │              │
        ▼              ▼
   SpawnedInstance { descriptorId, position, rotation, scale }
        │
        ▼
   AreaBlender.spawnAll(surfaceData) ── runs each SpawnerArea in array order
```

This module is complementary to `Environment/VegetationSystem`:
`VegetationSystem` is an integrated system that builds an `InstancedMesh`
directly, while `Vegetation/` is a composable pipeline whose
`SpawnerArea` emits `SpawnedInstance[]` for the caller to map onto any
rendering backend. Filters and modifiers read surface data from the
`SurfaceData` module and geometry from the `Shapes` module.

---

## Core Classes

### Descriptors

| Export | Role |
|--------|------|
| `VegetationDescriptor` | Interface describing one vegetation kind: `id`, `meshKey`, `weight`, `minScale`/`maxScale`, optional `lodDistances`, `castShadow`/`receiveShadow`. |
| `createDescriptor(id, meshKey, opts?)` | Factory returning a descriptor with sane defaults (`weight: 1`, `minScale: 0.8`, `maxScale: 1.2`, `castShadow: true`, `receiveShadow: false`). `opts` overrides any field. |

```ts
export interface VegetationDescriptor {
  id: string;
  meshKey: string;
  weight: number;            // higher = more likely in weighted pick
  minScale: number;
  maxScale: number;
  lodDistances?: number[];   // near→far; empty = single LOD
  castShadow?: boolean;
  receiveShadow?: boolean;
}
```

### Filters

`VegetationFilter` is the abstract base. Each concrete filter inspects a
`VegetationFilterContext` and returns a boolean. Disabled filters
(`enabled = false`) are skipped by `SpawnerArea`. Filters short-circuit:
the first reject aborts the candidate.

| Export | Role |
|--------|------|
| `VegetationFilter` | Abstract base: `type: string`, `accept(ctx): boolean`, `enabled: boolean`. |
| `SurfaceAltitudeFilter` | Accept points whose `altitude` (y) is within `[min, max]`. |
| `SurfaceSlopeFilter` | Accept points whose `slope` (radians from up) is within `[min, max]`. |
| `SurfaceMaskFilter` | Accept points whose `SurfacePoint` has `tag` weight `>= minWeight` (default 0.5). Rejects when `ctx.surface` is null. |
| `DistanceBetweenFilter` | Reject points within `minDistance` of any already-placed instance. Mutates a shared `placed: Vector3[]` that `SpawnerArea` appends to after each accepted spawn. |
| `ShapeIntersectionFilter` | Accept points inside any of `shapes: Shape[]` (union). |
| `DistributionFilter` | Deterministic seeded pseudo-random accept with probability `probability` (mulberry32, default seed 12345). |

```ts
export interface VegetationFilterContext {
  position: Vector3;            // candidate spawn position (world)
  surface: SurfacePoint | null; // may be null if no provider
  normal: Vector3;              // surface normal at position
  slope: number;                // radians from up
  altitude: number;             // y coordinate
  descriptor: VegetationDescriptor;
}

export abstract class VegetationFilter {
  abstract readonly type: string;
  abstract accept(ctx: VegetationFilterContext): boolean;
  enabled: boolean = true;
}
```

### Modifiers

`VegetationModifier` is the abstract base. Each concrete modifier
mutates a `VegetationModifierContext` in place. Modifiers run in array
order after all filters pass.

| Export | Role |
|--------|------|
| `VegetationModifier` | Abstract base: `type: string`, `apply(ctx): void`, `enabled: boolean`. |
| `PositionModifier` | Add random jitter to `position.x`/`.z` within `radius` (seeded mulberry32, range `[-1, 1]`). |
| `RotationModifier` | Set `rotation` to a random Y-axis angle in `[min, max]` radians (default full turn). |
| `ScaleModifier` | Set `scale` to a uniform random value in `[min, max]` (default 0.8–1.2). |
| `SlopeAlignmentModifier` | Slerp `rotation` toward the surface-normal alignment by `factor` (0 = none, 1 = fully aligned). |

```ts
export interface VegetationModifierContext extends VegetationFilterContext {
  position: Vector3;    // mutated in place
  rotation: Quaternion; // mutated in place
  scale: Vector3;       // mutated in place
}
```

### Spawner

| Export | Role |
|--------|------|
| `SpawnedInstance` | Interface: `descriptorId`, `position`, `rotation`, `scale`. The unit of output. |
| `SpawnerAreaConfig` | Interface: `id`, `bounds: Box3`, optional `shape`, `density` (instances per square unit), `descriptors`, `filters`, `modifiers`, `maxInstances`, optional `seed`. |
| `SpawnerArea` | Runs rejection sampling over `bounds`. `spawn(surfaceData)` returns newly-spawned instances and appends them to `this.instances`. `clear()` resets instances and any `DistanceBetweenFilter.placed` list. |

```ts
export interface SpawnedInstance {
  descriptorId: string;
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}
```

`spawn()` flow:
1. `targetCount = min(maxInstances, floor(area * density))` where
   `area = bounds.size.x * bounds.size.z`.
2. Up to `targetCount * 10` attempts: pick a uniform random `(x, z)` in
   `bounds`; query `surfaceData` for `y`, `normal`, `SurfacePoint`;
   compute `slope = acos(normal · up)`.
3. Optional `config.shape.containsPoint` check.
4. Pick a descriptor by `weight` (weighted pick using the PRNG).
5. Build `VegetationFilterContext`; run enabled filters (short-circuit).
6. On accept: build `VegetationModifierContext` (cloned position), run
   enabled modifiers, push a `SpawnedInstance`, and append the position
   to any `DistanceBetweenFilter.placed`.
7. Stop once `newInstances.length === targetCount`.

### Area Blender

| Export | Role |
|--------|------|
| `AreaBlender` | Holds `areas: SpawnerArea[]`. `add(area)` / `remove(id)` / `spawnAll(surfaceData)` runs each area in array (priority) order and concatenates results. `clearAll()` clears every area. |

`AreaBlender` resolves overlapping areas by priority: earlier array
entries spawn first, so later areas see an already-populated
`DistanceBetweenFilter.placed` list and naturally avoid clumping.

---

## Usage

### Single area with filter + modifier chains

```ts
import {
  SpawnerArea, AreaBlender, createDescriptor,
  SurfaceAltitudeFilter, SurfaceSlopeFilter, SurfaceMaskFilter,
  DistanceBetweenFilter, DistributionFilter,
  PositionModifier, RotationModifier, ScaleModifier, SlopeAlignmentModifier,
} from '@vreen/engine/vegetation';
import { Box3, Vector3 } from '@vreen/engine';
import { TAG_GRASS } from '@vreen/engine/surfacedata';

const grass = createDescriptor('grass', 'mesh/grass.json', { weight: 3, minScale: 0.7, maxScale: 1.3 });
const bush  = createDescriptor('bush',  'mesh/bush.json',  { weight: 1, minScale: 0.6, maxScale: 1.1 });

const distFilter = new DistanceBetweenFilter(0.6);

const area = new SpawnerArea({
  id: 'field',
  bounds: new Box3(new Vector3(-50, 0, -50), new Vector3(50, 20, 50)),
  density: 0.5,
  descriptors: [grass, bush],
  maxInstances: 2000,
  seed: 42,
  filters: [
    new SurfaceAltitudeFilter(0, 30),
    new SurfaceSlopeFilter(0, Math.PI / 6),          // up to 30°
    new SurfaceMaskFilter(TAG_GRASS, 0.5),
    distFilter,
    new DistributionFilter(0.8, 12345),               // 80% keep rate
  ],
  modifiers: [
    new PositionModifier(0.15, 7),
    new RotationModifier(0, Math.PI * 2),
    new ScaleModifier(0.8, 1.2),
    new SlopeAlignmentModifier(0.3),
  ],
});

const instances = area.spawn(surfaceDataSystem);
// map `instances` onto an InstancedMesh template per descriptorId
```

### Multi-area priority blending

```ts
const blender = new AreaBlender();
blender
  .add(denseForestArea)   // spawns first; fills DistanceBetweenFilter.placed
  .add(scatteredRockArea) // sees forest placements, avoids clumping
  .add(clearingArea);

const all = blender.spawnAll(surfaceDataSystem);
blender.clearAll(); // reset before re-rolling
```

---

## Invariants

- **Determinism.** Given the same `seed`, `bounds`, `density`,
  `descriptors`, `filters`, and `modifiers`, `spawn()` produces
  byte-identical `SpawnedInstance[]` output. `PositionModifier` and
  `DistributionFilter` use mulberry32; `RotationModifier` and
  `ScaleModifier` use `Math.random()` and are therefore **not**
  deterministic — wrap them in a seeded source if reproducibility is
  required.
- **Filter short-circuit.** The first filter whose `accept()` returns
  `false` aborts the candidate; no later filter runs for that candidate.
- **Disabled stages skipped.** Filters and modifiers with
  `enabled === false` are never invoked.
- **`DistanceBetweenFilter` is stateful.** `SpawnerArea.spawn()`
  appends every accepted position to each `DistanceBetweenFilter.placed`
  list, and `clear()` empties it. Sharing one filter across areas couples
  them; clone per area for isolation.
- **Descriptor weighted pick is total.** `pickWeighted` always returns a
  descriptor (falls back to the last) even if all weights are zero, so
  empty-weight configurations still spawn rather than throw.
- **`SurfaceMaskFilter` rejects null surfaces.** When `ctx.surface` is
  `null` (no `SurfaceDataProvider` registered) the filter returns `false`
  rather than silently accepting.
- **Output ownership.** `SpawnedInstance.position` is the mutated
  modifier-context clone; callers may store it without further copying.
  `SpawnerArea.instances` aliases the same objects returned by `spawn()`.
- **`maxInstances` cap.** `targetCount` is clamped to `maxInstances` and
  bounded by `density * area`; the rejection loop never exceeds
  `targetCount * 10` attempts.

---

## Design Notes

**Why a separate pipeline from `Environment/VegetationSystem`?**
`VegetationSystem` is an integrated, opinionated system that owns its
`InstancedMesh`. The `Vegetation/` module decouples spawning from
rendering: `SpawnerArea` emits plain data (`SpawnedInstance[]`) that any
backend — instanced mesh, GPU instancing, ECS component population,
offline baking — can consume. Filters and modifiers are also individually
composable, whereas `VegetationSystem` bakes its own rule set.

**Why mulberry32?** It is a tiny, fast, fully deterministic 32-bit PRNG
with no allocations, suitable for per-candidate sampling inside a hot
loop. Seeding per `SpawnerArea` makes vegetation rolls reproducible for
testing and for stable world generation across sessions.

**Why does `DistanceBetweenFilter` mutate shared state?** Keeping the
`placed[]` list on the filter (rather than inside `SpawnerArea`) lets
`AreaBlender` enforce inter-area spacing without a coordinating object:
each area appends to the same filter instance, and later areas see the
earlier placements. The cost is that `clear()` must be called on the area
(not just the filter) to keep state consistent.

---

## References

- o3de Gems/Vegetation — `Descriptor`, `Filter`, `Modifier`, `SpawnerArea`,
  `AreaBlender` design reference.
- `src/engine/SurfaceData/README.md` — `SurfacePoint` and tag weights
  consumed by `SurfaceMaskFilter`.
- `src/engine/Shapes/README.md` — `Shape.containsPoint` used by
  `ShapeIntersectionFilter`.
- `src/engine/Environment/VegetationSystem.ts` — the integrated
  vegetation system this pipeline complements.
- Top-level barrel — `src/engine/index.ts` re-exports this module.
