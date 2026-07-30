# PCG Module

> Path: `src/engine/PCG/`
>
> The procedural content generation subsystem of the `@vreen/engine`
> kernel. Provides seed-controlled noise sampling (Perlin / Simplex /
> Worley / fBm / Ridge) and a family of layout generators that emit
> `BufferGeometry` or structured layout metadata — buildings, cities,
> dungeons, roads, trees and characters. All generators stay
> geometry/data-only: they never bind a `Material` or attach to a
> `Scene`, leaving rendering concerns to the caller.

---

## Overview

```
NoiseGenerator ──seeded PRNG──→ perm[] ──samples──→ perlin2D/3D · simplex2D/3D · worley2D/3D · fbm2D/3D · ridgenoise
     │
     ▼ consumed by
CityGenerator · CityGenerator2 · TreeGenerator · CharacterGenerator

BuildingGenerator ──static──→ BuildingResult { geometry, windows, doors }
BuildingGenerator2 ──instance──→ BuildingGenerator2Result { positions, indices, uvs, normals, colors, parts }
CityGenerator     ──static──→ CityResult { roads:BufferGeometry, buildings[], parks[] }
CityGenerator2    ──instance──→ CityData2 { zones, roads, buildings, landmarks, streetLights, parks }
DungeonGenerator  ──static──→ DungeonResult { grid:Uint8Array, rooms, corridors, doors }
RoadGenerator     ──instance──→ RoadGeometryData { positions, normals, uvs, indices } + intersections[]
TreeGenerator     ──static──→ TreeResult { geometry, branches[], leafCount }
CharacterGenerator──static──→ CharacterResult { geometry, body, head, face, hair, clothing, accessories, skeleton }
```

Two output shapes coexist by design:

- **Geometry-emitting generators** (`BuildingGenerator`, `CityGenerator`,
  `TreeGenerator`, `CharacterGenerator`) return ready-to-render
  `BufferGeometry` so a single `Mesh` can wrap the result.
- **Data-emitting generators** (`BuildingGenerator2`, `CityGenerator2`,
  `DungeonGenerator`, `RoadGenerator`) return raw typed arrays or tile
  grids, deferring mesh construction to the caller. This avoids
  allocating huge merged meshes up front and lets the caller pick a
  rendering strategy (instancing, voxel, tilemap).

---

## Core Classes

### Noise

| Export | Role |
|--------|------|
| `NoiseGenerator` | Stateful, seed-controlled noise sampler. Builds a 512-entry permutation table from `mulberry32(seed)`; exposes Perlin / Simplex / Worley / fBm / Ridge in 2D and 3D. |

```ts
class NoiseGenerator {
  constructor(seed?: number);        // default 0
  getSeed(): number;
  setSeed(seed: number): void;
  perlin2D(x, y): number;            // ≈ [-1, 1]
  perlin3D(x, y, z): number;
  simplex2D(x, y): number;           // ≈ [-1, 1]
  simplex3D(x, y, z): number;
  worley2D(x, y): number;            // ≈ [0, 1] — F1 distance
  worley3D(x, y, z): number;
  fbm2D(x, y, octaves?, persistence?, lacunarity?): number;  // ≈ [-1, 1]
  fbm3D(x, y, z, octaves?, persistence?, lacunarity?): number;
  ridgenoise(x, y, octaves?): number;  // ≈ [0, 1] — sharp ridges
}
```

`NoiseGenerator` complements `Terrain/HeightmapGenerator`'s static
`Perlin2D`: the latter is a stateless function set, while this class is
a reusable instance whose seed can be hot-swapped without rebuilding
call sites.

### Buildings

| Export | Role |
|--------|------|
| `BuildingGenerator` | Static generator. Emits merged `BufferGeometry` (walls + roof) plus separate `windows` / `doors` geometries. Roofs: `flat` / `peaked` / `gabled`. |
| `BuildingGenerator2` | Enhanced instance generator. Chainable config (`setStyle` / `setFloors` / `setDimensions` / `setRoof` …), 5 styles, 4 roof types, balconies / entrance / AC / antenna decorations, and per-vertex `colors` so parts are distinguishable without materials. Emits raw typed arrays. |

```ts
// Static API
interface BuildingOptions {
  width: number; depth: number; floors: number; floorHeight: number;
  roof?: RoofType;           // 'flat' | 'peaked' | 'gabled'
  style?: BuildingStyle;     // 'modern' | 'classic' | 'industrial'
  windowsPerFloor?: number;  // default 3
  seed?: number;
}
interface BuildingResult {
  geometry: BufferGeometry; windows: BufferGeometry; doors: BufferGeometry;
  floorYs: number[]; totalHeight: number; roof: RoofType; style: BuildingStyle;
}
BuildingGenerator.generate(options: BuildingOptions): BuildingResult;

// Instance API (BuildingGenerator2)
type BuildingStyle2 = 'modern' | 'classical' | 'industrial' | 'sci-fi' | 'asian';
type RoofType2     = 'flat' | 'pitched' | 'dome' | 'spire';
interface BuildingGenerator2Result {
  positions: Float32Array; indices: Uint32Array; uvs: Float32Array;
  normals: Float32Array; colors: Float32Array; parts: BuildingPartInfo[];
  totalHeight: number; floorCount: number; stats: BuildingStats;
}
const gen = new BuildingGenerator2()
  .setStyle('sci-fi').setFloors(20).setDimensions(12, 10).setRoof('spire', 8);
const result = gen.generate();
```

### Cities

| Export | Role |
|--------|------|
| `CityGenerator` | Static generator. Lays a `gridSize × gridSize` block grid, emits merged road `BufferGeometry` plus `CityBuilding[]` / `CityPark[]` layout metadata (no building geometry — caller reuses `BuildingGenerator`). |
| `CityGenerator2` | Enhanced instance generator. 4 styles (`modern` / `medieval` / `cyberpunk` / `classical`), 5 zone types driven by noise (`residential` / `commercial` / `industrial` / `park` / `downtown`), organic road network (grid + node jitter), landmarks and street lights. Emits pure structured data, no geometry. |

```ts
// Static API
interface CityOptions {
  gridSize: number; blockSize: number; roadWidth: number;
  buildingDensity: number;  // 0..1
  seed?: number; maxFloors?: number;
}
interface CityResult {
  roads: BufferGeometry; buildings: CityBuilding[]; parks: CityPark[]; stats: CityStats;
}
CityGenerator.generate(options: CityOptions): CityResult;

// Instance API (CityGenerator2)
type CityStyle = 'modern' | 'medieval' | 'cyberpunk' | 'classical';
type ZoneType  = 'residential' | 'commercial' | 'industrial' | 'park' | 'downtown';
interface CityData2 {
  zones: CityZone[]; roads: CityRoad[]; buildings: CityBuilding[];
  landmarks: CityLandmark[]; streetLights: StreetLight[]; parks: CityPark2[];
  stats: CityStats2;
}
const city = new CityGenerator2()
  .setCitySize(200).setBlockSize(30).setStyle('cyberpunk').setSeed(42)
  .generate();
```

### Dungeons

| Export | Role |
|--------|------|
| `DungeonGenerator` | Static generator. Places non-overlapping rooms on a `width × height` tile grid, connects them via a minimum spanning tree (plus extra loop edges), carves L-shaped corridors and doors. Output is a `Uint8Array` tile grid plus room/corridor/door metadata. |

```ts
interface DungeonOptions {
  width: number; height: number; roomCount: number;
  minRoomSize?: number; maxRoomSize?: number;
  seed?: number; extraPathRatio?: number;  // 0..1 loop edges over MST
}
interface DungeonResult {
  grid: Uint8Array;            // 0=empty, 1=wall, 2=room, 3=corridor, 4=door
  rooms: DungeonRoom[]; corridors: DungeonCorridor[]; doors: DungeonDoor[];
  width: number; height: number;
}
// Tile constants
TILE_EMPTY = 0; TILE_WALL = 1; TILE_ROOM = 2; TILE_CORRIDOR = 3; TILE_DOOR = 4;
DungeonGenerator.generate(options: DungeonOptions): DungeonResult;
```

The tile grid is rendering-agnostic: callers may build a tilemap,
extrude it into a voxel volume (`Voxel/`), or triangulate it into a
3D mesh.

### Roads

| Export | Role |
|--------|------|
| `RoadGenerator` | Stateful instance generator. Driven by control points sampled through a Catmull-Rom spline, with optional terrain following (via a `TerrainSampler` duck-typed to `TerrainGeometry.getHeightAt`). Records intersection metadata for cross/t-junction/corner placement. |

```ts
interface TerrainSampler { getHeightAt(x: number, z: number): number; }
interface RoadGeometryData {
  positions: Float32Array; normals: Float32Array; uvs: Float32Array;
  indices: Uint16Array | Uint32Array; vertexCount: number; triangleCount: number;
}
interface RoadIntersection {
  position: Vector3; roads: number[]; type: 'cross' | 'tjunction' | 'corner';
}
const road = new RoadGenerator();
road.setWidth(8).setSegments(64).setTerrainFollow(terrainGeometry);
road.addControlPoint(new Vector3(0, 0, 0));
road.addControlPoint(new Vector3(20, 0, 5));
const data: RoadGeometryData = road.generate();
const stats: RoadStats = road.getStats();
```

`RoadGenerator` is the only stateful geometry generator besides
`BuildingGenerator2` / `CityGenerator2`, because roads are typically
edited interactively (control point drag) before being baked.

### Trees

| Export | Role |
|--------|------|
| `TreeGenerator` | Static generator. L-system-style recursive branching: trunk cylinder → child branches with length/radius decay → billboard leaves at terminal branches. Returns a single merged `BufferGeometry` plus branch metadata. |

```ts
interface TreeOptions {
  trunkHeight: number; trunkRadius: number; branchLevels: number;  // 1..5
  branchCount?: number;            // children per parent, default 3
  branchLengthDecay?: number;      // 0..1, default 0.7
  branchRadiusDecay?: number;      // 0..1, default 0.7
  leafSize: number; leafCount?: number; seed?: number;
}
interface TreeResult {
  geometry: BufferGeometry; branches: TreeBranch[]; leafCount: number;
}
TreeGenerator.generate(seed?: number, options: TreeOptions): TreeResult;
```

### Characters

| Export | Role |
|--------|------|
| `CharacterGenerator` | Static generator. Assembles a humanoid from axis-aligned boxes (torso / arms / legs / head) plus facial feature planes, hair shell, clothing and accessories. Also emits a 16-bone `Skeleton` matching the `Animation/Humanoid` hierarchy so the result is ready for skinning. |

```ts
type CharacterRace     = 'human' | 'elf' | 'dwarf' | 'orc' | 'robot';
type CharacterGender   = 'male' | 'female';
type CharacterBodyType = 'slim' | 'average' | 'muscular' | 'heavy';
type CharacterClothing = 'casual' | 'formal' | 'armor' | 'robe' | 'sci-fi';
interface CharacterResult {
  geometry: BufferGeometry;       // merged whole character
  body: BufferGeometry; head: BufferGeometry; face: BufferGeometry;
  hair: BufferGeometry; clothing: BufferGeometry; accessories: BufferGeometry;
  skeleton: Skeleton;             // 16 bones, Humanoid-compatible
  height: number; vertexCount: number; triangleCount: number;
  stats: CharacterStats;
}
```

---

## Usage

### Noise-driven terrain texture

```ts
import { NoiseGenerator } from '@vreen/engine/pcg';

const ng = new NoiseGenerator(42);
for (let y = 0; y < 128; y++) {
  for (let x = 0; x < 128; x++) {
    // fBm for base terrain, Worley for cellular regions
    const base   = ng.fbm2D(x * 0.02, y * 0.02, 6, 0.5, 2);
    const cells  = ng.worley2D(x * 0.1, y * 0.1);
    const ridge  = ng.ridgenoise(x * 0.01, y * 0.01, 5);
  }
}
ng.setSeed(99);  // hot-swap seed, reuse instance
```

### Building + city composition

```ts
import { CityGenerator, BuildingGenerator } from '@vreen/engine/pcg';
import { Mesh } from '@vreen/engine/core';

const city = CityGenerator.generate({
  gridSize: 8, blockSize: 30, roadWidth: 6,
  buildingDensity: 0.7, seed: 7, maxFloors: 12,
});
scene.add(new Mesh(city.roads, roadMaterial));

for (const b of city.buildings) {
  const result = BuildingGenerator.generate({
    width: b.width, depth: b.depth, floors: b.floors, floorHeight: b.floorHeight,
    roof: 'peaked', seed: (b.x * 31 + b.z) | 0,
  });
  const mesh = new Mesh(result.geometry, wallMaterial);
  mesh.position.set(b.x, 0, b.z);
  mesh.rotation.y = b.rotationY;
  scene.add(mesh);
}
```

### Dungeon to voxel volume

```ts
import { DungeonGenerator, TILE_ROOM, TILE_CORRIDOR, TILE_DOOR } from '@vreen/engine/pcg';

const d = DungeonGenerator.generate({
  width: 64, height: 64, roomCount: 12, seed: 42, extraPathRatio: 0.15,
});
for (let y = 0; y < d.height; y++) {
  for (let x = 0; x < d.width; x++) {
    const t = d.grid[y * d.width + x];
    if (t === TILE_ROOM || t === TILE_CORRIDOR || t === TILE_DOOR) {
      voxelWorld.setVoxel(x, 0, y, palette.stoneFloor);
    }
  }
}
```

### Road with terrain following

```ts
import { RoadGenerator } from '@vreen/engine/pcg';
import { Vector3 } from '@vreen/engine/math';

const road = new RoadGenerator();
road.setWidth(6).setSegments(96).setTerrainFollow(terrainGeometry);
road.addControlPoint(new Vector3(-50, 0, -20));
road.addControlPoint(new Vector3(0, 0, 5));
road.addControlPoint(new Vector3(50, 0, 20));
const data = road.generate();
// data.positions / normals / uvs / indices -> wrap in BufferGeometry
```

---

## Invariants

- **Geometry-only output.** No PCG class imports `Material` or attaches
  to a `Scene`; callers own rendering. `BuildingGenerator2` /
  `CityGenerator2` / `RoadGenerator` go further and emit raw typed
  arrays, avoiding even `BufferGeometry` allocation.
- **Seed determinism.** Every generator routes randomness through
  `mulberry32(seed)`. Same seed + same options ⇒ identical output
  across runs, enabling reproducible builds and save-file replay.
- **Non-negative dimensions.** `BuildingGenerator`, `CityGenerator`,
  `RoadGenerator` throw on `width`/`depth`/`floors`/`floorHeight`/`
  blockSize`/`roadWidth` ≤ 0; `buildingDensity` must lie in `[0, 1]`.
- **Sorted collections.** `TimelineTrack`-adjacent invariants apply
  where relevant: dungeon rooms are placed non-overlapping (with a
  1-cell buffer), city blocks tile the grid without gaps.
- **Tile grid contract.** `DungeonGenerator` output `grid` is a
  `Uint8Array` of length `width * height` with values restricted to
  `TILE_EMPTY..TILE_DOOR`; callers must not write other values back.
- **Character skeleton compatibility.** `CharacterGenerator`'s 16-bone
  `Skeleton` mirrors the `Animation/Humanoid` hierarchy so animation
  clips authored for `Humanoid` retarget without remapping.

---

## References

- `src/engine/Terrain/HeightmapGenerator.ts` — stateless Perlin /
  Diamond-Square / Ridge companion to `NoiseGenerator`.
- `src/engine/Animation/Humanoid.ts` — `buildHumanoid()` rig definition
  matched by `CharacterGenerator`'s skeleton.
- `src/engine/Voxel/VoxelWorld.ts` — consumer of `DungeonGenerator`
  tile grids when dungeons are extruded into 3D.
- `src/engine/Core/BufferGeometry.ts` / `BufferAttribute.ts` — output
  container for the geometry-emitting generators.
- `src/engine/Math/Vector3.ts` — control-point type for `RoadGenerator`.
- Ken Perlin, *Improving Noise* (2002); Stefan Gustavson, *Simplex
  noise demystified* (2005) — algorithmic basis for `NoiseGenerator`.
