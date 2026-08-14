# Acceleration Module

> Path: `src/engine/Acceleration/`
>
> The spatial acceleration subsystem of the `@vreen/engine` kernel. Provides
> a Bounding Volume Hierarchy (`BVH`) over triangle meshes, three build
> strategies (`MIDDLE` / `MEDIAN_AXIS` / `SAH`), a `BVHBuilder` toolkit, a
> general-purpose `BVH` query API (raycast / raycastFirst /
> intersectsFrustum / traverse / stats), and a mesh-specialised `MeshBVH`
> wrapper that adds face/normal/uv intersection records and a
> closest-point query. `BVHNode` is the recursive tree node type.

---

## Overview

```
   BufferGeometry
        │
        ▼
   extractTriangles()                  (BVHBuilder.ts)
        │  triangles: Uint32Array (3 indices per tri)
        │  positions: Float32Array
        ▼
   buildBVH(geometry, options) ──► BVHBuildResult { root, triangles, positions, triangleCount }
        │
        │   strategy: MIDDLE | SAH | MEDIAN_AXIS
        │   maxLeafSize (default 8), maxDepth (default 32), sahBinCount (default 12)
        ▼
   BVHNode (recursive)
   ├── bounds: Box3              (union of subtree triangle AABBs)
   ├── left / right: BVHNode | null
   ├── triangles: number[] | null   (leaf only; indices into the flat triangle list)
   └── depth: number
        │
        ▼
   BVH (root + cached triangles/positions)
   ├── raycast(ray)             ──► BVHRayHit[] (all hits, distance-sorted)
   ├── raycastFirst(ray)        ──► BVHRayHit | null (nearest, with subtree early-out)
   ├── intersectsFrustum(frust) ──► number[] (potentially-visible triangle indices)
   ├── getBounds(target?)       ──► Box3
   ├── traverse(cb)             ──► DFS over all nodes
   └── getStats()               ──► BVHStats { totalNodes, leafCount, maxDepth, ... }
        │
        ▼
   MeshBVH (geometry + BVH wrapper)
   ├── raycast(ray)             ──► BVHIntersection[] { distance, point, face, faceIndex, uv? }
   └── closestPointToPoint(p)   ──► BVHClosestPoint | null
```

`BVH` is the general-purpose engine: it owns the root node plus a cached flat
`Uint32Array` of triangle vertex indices and a `Float32Array` of positions,
so raycast / frustum queries do not re-read the geometry. `MeshBVH` is a thin
wrapper that re-reads the original `BufferGeometry` (for `position` and `uv`
attributes) to enrich hits with `face` (a/b/c + normal) and `uv`. The
`Raycaster` in `Core/` prefers an attached `MeshBVH` when one is present on
`BufferGeometry.bvh`.

---

## Core Classes

### BVHNode (`BVHNode.ts`)

The recursive tree node. Both internal and leaf nodes carry `bounds`; only
leaves carry `triangles`.

| Export | Role |
|--------|------|
| `BVHNode` | `bounds: Box3` / `left: BVHNode \| null` / `right: BVHNode \| null` / `triangles: number[] \| null` / `depth: number`. `isLeaf()` returns true when both children are `null`. `intersect(ray)` is a thin delegate to `Ray.intersectsBox` for coarse culling. |

An *empty* node (geometry with no `position` attribute) has
`bounds = { min: +∞, max: -∞ }`; this only occurs for empty geometries and is
preserved so callers can treat `root === null` as the singular empty case.

### BVH (`BVH.ts`)

General-purpose BVH over a `BufferGeometry`. Owns the root node plus cached
triangle/position buffers used by every query.

| Export | Role |
|--------|------|
| `BVH` | `build(geometry, options?) → this` / `raycast(ray) → BVHRayHit[]` / `raycastFirst(ray) → BVHRayHit \| null` / `intersectsFrustum(frustum) → number[]` / `getBounds(target?) → Box3` / `traverse(cb) → void` / `getTriangleVertexIndices(t) → [number, number, number]` / `getStats() → BVHStats`. |
| `BVHRayHit` | `{ triangleIndex, distance, point }`. |
| `BVHStats` | `{ totalNodes, leafCount, interiorCount, maxDepth, avgDepth, totalTriangles, maxLeafSize }`. |

```ts
class BVH {
  root: BVHNode | null;
  readonly maxDepth: number;       // configured upper bound (default 32)
  readonly maxLeafSize: number;    // configured leaf size (default 8)
  get triangleCount(): number;
}
```

`raycast` walks every node whose `bounds` the ray intersects and collects all
triangle hits via Möller-style `Ray.intersectTriangle`; the result is sorted
by `distance` ascending. `raycastFirst` uses AABB entry-distance early-out
(per-subtree `tmin > bestDist` ⇒ skip) and orders child traversal by
`_boxRayNear` so the near subtree is visited first — this prunes most of the
far tree. `intersectsFrustum` uses the conservative p-vertex test (no false
negatives; a few false positives acceptable for culling).

### BVHBuilder (`BVHBuilder.ts`)

Build toolkit: triangle extraction, three split strategies, recursive build.

| Export | Role |
|--------|------|
| `BVHBuildStrategy` | Enum: `MIDDLE = 0` / `SAH = 1` / `MEDIAN_AXIS = 2`. |
| `buildBVH(geometry, options?) → BVHBuildResult` | Top-level entry. Returns `{ root, triangles, positions, triangleCount }`. Empty geometry ⇒ `root = null`. |
| `extractTriangles(geometry)` | Extracts the flat `Uint32Array` of triangle vertex indices and `Float32Array` of positions. Honours `geometry.index` when present, else synthesises `3t / 3t+1 / 3t+2`. |
| `BVHBuildOptions` | `{ maxLeafSize?, maxDepth?, strategy?, sahBinCount? }`. |
| `BVHBuildResult` | `{ root, triangles, positions, triangleCount }`. |

| Strategy | Behaviour | Fallback |
|----------|-----------|----------|
| `MIDDLE` (default) | Split at the midpoint of the centroid bounds on the longest axis. | Falls back to `MEDIAN_AXIS` when one side comes out empty (degenerate). |
| `MEDIAN_AXIS` | Sort triangle centroids along the longest axis and split at the median index. Guaranteed count-balanced. | None (always produces a split). |
| `SAH` | K-bin (default 12) Surface Area Heuristic sweep on the first axis with a valid split; picks the lowest-cost split. | Falls back to `MEDIAN_AXIS` when all axes are degenerate. |

Node `bounds` are computed as the union of subtree triangle AABBs (not the
centroid bounds) so the ray-AABB test is tight. Recursion terminates when
`triCount <= maxLeafSize` or `depth >= maxDepth`; the leaf then stores the
slice of triangle indices it covers.

### MeshBVH (`MeshBVH.ts`)

Mesh-specialised wrapper around `BVH`. Enriches hits with `face` (vertex
indices + normal) and `uv` (via barycentric interpolation when the geometry
has a `uv` attribute). Adds `closestPointToPoint`.

| Export | Role |
|--------|------|
| `MeshBVH` | `constructor(geometry, options?)` builds the inner `BVH` immediately. `raycast(ray) → BVHIntersection[]` / `closestPointToPoint(point) → BVHClosestPoint \| null`. |
| `BVHFace` | `{ a, b, c, normal: Vector3 }` — vertex indices into the position attribute plus the triangle normal. |
| `BVHIntersection` | `{ distance, point, face, faceIndex, uv? }`. `uv` is present only when the geometry has a `uv` attribute. |
| `BVHClosestPoint` | `{ point, distance, faceIndex }`. |

```ts
class MeshBVH {
  readonly bvh: BVH;
  readonly geometry: BufferGeometry;
}
```

`closestPointToPoint` walks the tree with subtree early-out: if the
squared distance from the query point to `node.bounds` already exceeds the
current best squared distance, the subtree is skipped. Inside leaves it uses
`Triangle.closestPointToPoint` per triangle and keeps the minimum.

---

### Octree (`Octree.ts` + `Capsule.ts` + `OctreeHelper.ts`)

Another spatial-acceleration structure — but where BVH/MeshBVH optimise
**single-shot ray queries** (picking, occlusion tests), the Octree optimises
**repeated volume-vs-mesh collisions** (a player capsule sampling the world
every frame). Adapted from three.js r169 `examples/jsm/math/Octree.js`, the
official Three.js character-controller collision solution, with the o3de Atom
voxel/grid acceleration philosophy in mind.

| Export | Role |
|--------|------|
| `Octree` | Recursive 8-way subdivision of scene triangles. `build()` / `fromGraphNode(root)` / `capsuleIntersect` / `sphereIntersect` / `boxIntersect` / `rayIntersect`. |
| `Capsule` | Swept-sphere collider `start` + `end` + `radius`. `translate` / `getCenter` / `intersectsBox`. |
| `OctreeHelper` | Tree visualisation data: `getBoxes(maxDepth?)` / `getLeafBoxes()` / `getNodeCount()` / `getLeafTriangleCount()`. No GL resources — emits `Box3[]` for the caller to draw. |

**How a query works.** `capsuleIntersect(collider)` first does a *broad-phase*
walk: recurse only into subtrees whose `box` the capsule's AABB overlaps
(`Capsule.intersectsBox` × `box`), collecting candidate leaf triangles. Then
the *narrow-phase* `triangleCapsuleIntersect` tests each candidate:
planes-distance early-out, in-plane point containment, then closest-line-pairs
between the capsule axis and the triangle's three edges. Each hit ` translates`
the working capsule copy out of the surface; after all hits the total
displacement becomes the returned `{ normal, depth }`. Calling code resolves
the collision with `collider.translate(hit.normal.multiplyScalar(hit.depth))`.

**Tuning.** `trianglesPerLeaf` (default 8) and `maxLevel` (default 16) bound
leaf density and tree depth. Lower `trianglesPerLeaf` → more subdivision,
faster narrow-phase at the cost of tree size.

**Prerequisite.** `Octree.split` relies on `Box3.intersectsTriangle` (SAT,
this module's contribution to `Math/Box3`) to assign each triangle to the
child octants it overlaps; that 13-axis separating-axis test was ported from
three.js `Box3.intersectsTriangle` and is unit-tested on its own.

```ts
const octree = new Octree().fromGraphNode(sceneMesh);
const player = new Capsule(new Vector3(0, 1.0, 0), new Vector3(0, 1.8, 0), 0.35);
const hit = octree.capsuleIntersect(player);
if (hit) player.translate(hit.normal.clone().multiplyScalar(hit.depth));

// visualise the tree ( daughters drawn by the renderer):
const boxes = new OctreeHelper(octree).getLeafBoxes();
```

**Comparison to soup3D** — soup3D has *no* collision or spatial-acceleration
code at all (no broad-phase, no narrow-phase, no character controller). Its
only geometry primitives are `Face`/`Model`; round-tripping a mesh into a
queryable collision proxy is not possible. VREEN's Octree ships the full
character-collision pipeline (tree build + broad-phase AABB prune + swept-sphere
narrow-phase + aggregate push-out resolution) the Three.js community uses for
walk-on-terrain gameplay — soup3D simply has no analogue.

**Why Octree alongside BVH?** Both are trees; they do not overlap:
`BVH`/`MeshBVH` build per-mesh and answer `raycast`/`closestPointToPoint`
(point queries, O(log N) per call). `Octree` builds per-world and answers
volume queries (capsule/sphere/box) where the query is *itself* a region —
the per-frame collision pattern of a moving body. The two coexist: pick with
`MeshBVH`, walk with `Octree`.

---

## Usage

### Build and raycast a mesh

```ts
import { MeshBVH } from '@vreen/engine/acceleration';
import { Ray, Vector3 } from '@vreen/engine/math';

const meshBvh = new MeshBVH(geometry, { strategy: 1 /* SAH */, maxLeafSize: 8 });
const ray = new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
const hits = meshBvh.raycast(ray);
for (const h of hits) {
  console.log(h.faceIndex, h.distance, h.face.normal, h.uv);
}
```

### Querying the raw `BVH` (no `MeshBVH` wrapper)

```ts
import { BVH, BVHBuildStrategy } from '@vreen/engine/acceleration';

const bvh = new BVH({ maxLeafSize: 4, maxDepth: 24 });
bvh.build(geometry, { strategy: BVHBuildStrategy.SAH, sahBinCount: 16 });

const first = bvh.raycastFirst(ray);          // BVHRayHit | null
const all   = bvh.raycast(ray);               // BVHRayHit[] (distance-sorted)
const visible = bvh.intersectsFrustum(camera.frustum);  // number[] of triangle indices

const stats = bvh.getStats();
console.log(stats.totalNodes, stats.leafCount, stats.maxDepth, stats.avgDepth);

bvh.traverse((node, depth) => {
  if (node.isLeaf()) drawBox(node.bounds, '#0f0');
});
```

### Closest-point query (useful for snapping, decal placement)

```ts
const result = meshBvh.closestPointToPoint(queryPoint);
if (result) {
  console.log(result.point, result.distance, result.faceIndex);
}
```

### Attaching a `MeshBVH` for `Raycaster` acceleration

```ts
import { MeshBVH } from '@vreen/engine/acceleration';

// The Core Raycaster checks BufferGeometry.bvh first and routes raycast
// through it when present, falling back to brute-force otherwise.
(geometry as any).bvh = new MeshBVH(geometry);
const hits = raycaster.intersectObject(mesh, true);
```

### Choosing a build strategy

```ts
// Editor / authoring: build quality matters less than build time
new MeshBVH(geometry, { strategy: BVHBuildStrategy.MIDDLE });

// Static scene / shipped asset: best runtime raycast performance
new MeshBVH(geometry, { strategy: BVHBuildStrategy.SAH, sahBinCount: 12 });

// Highly non-uniform triangle distribution (e.g. one dense cluster + sparse rest)
new MeshBVH(geometry, { strategy: BVHBuildStrategy.MEDIAN_AXIS });
```

---

## Invariants

- **Empty geometry ⇒ `root === null`.** `buildBVH` returns
  `{ root: null, triangles: Uint32Array(0), positions: Float32Array(0), triangleCount: 0 }`.
  Every `BVH` query method handles `root === null` by returning an empty
  result.
- **`BVHNode.bounds` is the union of subtree triangle AABBs.** Not the
  centroid bounds — this keeps ray-AABB tests tight and reduces false
  positives during traversal.
- **`raycast` returns hits sorted by `distance` ascending.** `raycastFirst`
  returns the nearest hit only; both use the same triangle-intersection
  routine (`Ray.intersectTriangle` with `backfaceCulling = false`).
- **`raycastFirst` early-out is sound.** A subtree is skipped only when the
  ray's entry parameter into its AABB exceeds the current best hit
  distance. Near subtree is visited first so the best distance tightens
  quickly.
- **`intersectsFrustum` is conservative.** The p-vertex test produces no
  false negatives (every visible triangle is returned) but may include a
  few false positives. Callers that need exact visibility must do
  per-triangle clipping afterwards.
- **`BVHBuildStrategy.MIDDLE` falls back to `MEDIAN_AXIS`.** When the
  midpoint split leaves one side empty (degenerate centroid bounds), the
  builder transparently switches to median-index split so the recursion
  always makes progress.
- **`BVHBuildStrategy.SAH` falls back to `MEDIAN_AXIS`.** When no axis
  produces a valid bin split, the median-index strategy guarantees a
  balanced tree.
- **`MeshBVH.closestPointToPoint` returns `null` for empty geometry.** The
  walk starts with `best.distSq = +Infinity`; if no triangle is ever
  visited, the result is `null`.
- **`MeshBVH.raycast` `uv` is optional.** It is computed only when the
  geometry has a `uv` attribute; otherwise the field is omitted.
- **`BVH.triangleCount` matches `BVHStats.totalTriangles`.** The sum of
  every leaf's `triangles.length` equals the configured triangle count, so
  `getStats` can be used to verify build integrity.

---

## References

- Parker, Bigler, et al. "Understanding the Efficiency of Ray Traversal on
  GPUs." (Conservative p-vertex frustum culling used by
  `intersectsFrustum`.)
- MacDonald & Booth, "Heuristics for ray tracing using space subdivision"
  (1990) — Surface Area Heuristic used by `BVHBuildStrategy.SAH`.
- Amanatides & Woo — DDA grid traversal (used by `Voxel.VoxelRaycaster`, the
  voxel-counterpart to this module's triangle BVH).
- three-mesh-bvh (https://github.com/gkjohnson/three-mesh-bvh) — reference
  implementation for `MeshBVH` face/uv enrichment and `closestPointToPoint`
  subtree early-out.
- Internal: `Core/Raycaster` checks `BufferGeometry.bvh` first and routes
  raycasts through `MeshBVH` when present. `Core/BufferGeometry.bvh` is the
  attachment point.
