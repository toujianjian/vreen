# Modifiers Module

> Path: `src/engine/Modifiers/`
>
> Geometry modification algorithms for the `@vreen/engine` kernel. Provides
> procedural mesh post-processors that subdivide or simplify a
> `BufferGeometry` without touching the original data. Each modifier reads
> the input geometry's `position` (and optionally `normal` / `uv`)
> attributes and returns a fresh `BufferGeometry` with the processed
> attribute streams.

The module currently exposes four complementary operators:

- `TessellateModifier` refines a mesh by splitting long edges until every
  edge falls under a length budget. Use it to densify coarse input meshes
  before displacement mapping, normal mapping, or vertex animation.
- `SimplifyModifier` reduces vertex count by collapsing the shortest edges
  first. Use it to generate LOD (level-of-detail) proxies or to strip
  redundant geometry from imported assets.
- `SubdivisionModifier` applies Catmull-Clark subdivision surfaces to
  smooth a mesh. Each iteration adds face points (centroids), edge points
  (midpoint + adjacent face-point average), and repositions original
  vertices via the `(Q + 2R + (n-3)S) / n` interior rule or the
  `3/4·S + 1/8·(m₁+m₂)` boundary rule. UV attributes are interpolated
  with the same weights; normals are recomputed as smooth vertex normals.
  Use it to produce organic, smooth shapes from coarse cages.
- `EdgeSplitModifier` splits edges where the angle between adjacent face
  normals exceeds a threshold, duplicating vertices at sharp edges to
  produce hard-edge normals. Faces sharing a non-sharp edge at a vertex
  are grouped via BFS (smooth groups); each group gets its own averaged
  normal. Use it to add hard-surface detail to smooth-shaded meshes or
  to repair normals on imported assets.

All modifiers are ported from the `three.js` `examples/jsm/modifiers/`
folder (and Blender / o3de Atom for the subdivision and edge-split
algorithms) and adapted to VREEN's zero-dependency `BufferGeometry` /
`BufferAttribute` core. The algorithms favour simplicity and predictable
output over peak numerical optimality, mirroring the upstream behaviour.

---

## Overview

```
                     BufferGeometry (input)
                              │
                              ▼
            ┌──────────────────────────────────┐
            │   position / normal / uv arrays  │
            │   (+ optional index)             │
            └──────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   TessellateModifier              SimplifyModifier
   ─────────────────────           ──────────────────
   while edge > max:               collect unique edges
     split longest edge            sort by length (asc)
     at midpoint                   collapse shortest via
     interpolate normal/uv         union-find merge
   until maxIterations             until ratio reached
              │                               │
              └───────────────┬───────────────┘
                              ▼
            ┌──────────────────────────────────┐
            │   new BufferGeometry (output)    │
            │   original geometry untouched    │
            └──────────────────────────────────┘
```

The pipeline is one-shot and stateless: a modifier instance holds only its
configuration (`maxEdgeLength`, `ratio`, ...), never a reference to the
geometry it last processed. Call `modify(geometry)` repeatedly on different
inputs; each call allocates and returns a new `BufferGeometry`.

---

## Core Classes

### TessellateModifier

Splits triangle faces whose longest edge exceeds `maxEdgeLength`. Each
iteration scans every triangle, measures the three squared edge lengths,
and when the budget is exceeded the longest edge is bisected at its
midpoint, producing two new triangles. Normals and UVs are linearly
interpolated at the midpoint. The loop stops as soon as no edge exceeds
the budget or `maxIterations` is reached.

| Export | Role |
|--------|------|
| `TessellateModifier` | Refine a `BufferGeometry` by edge-length-driven triangle splitting. Constructor accepts `TessellateOptions`. |
| `TessellateOptions` | `{ maxEdgeLength?: number; triangles?: boolean; maxIterations?: number }`. `maxEdgeLength` default `0.1`, `triangles` default `true` (output is always triangles), `maxIterations` default `10`. |

Behaviour notes:

- Input is expanded to a non-indexed triangle list internally; the output
  is always non-indexed (one position per triangle vertex).
- `normal` is interpolated if present, otherwise `computeVertexNormals` is
  called on the result.
- `uv` is interpolated at split midpoints when the source has a `uv`
  attribute.
- `maxIterations` caps total work; combined with `maxEdgeLength` it bounds
  both runtime and output size.

### SimplifyModifier

Reduces vertex count by repeatedly collapsing the shortest edge in the
mesh. Edges are gathered, sorted ascending by length, and merged via a
union-find structure until the surviving vertex count reaches
`floor(count * ratio)`. Boundary vertices and UV-seam vertices can be
protected so silhouette and texture mapping are preserved.

| Export | Role |
|--------|------|
| `SimplifyModifier` | Reduce a `BufferGeometry` vertex count via shortest-edge collapse. Constructor accepts `SimplifyOptions`. |
| `SimplifyOptions` | `{ ratio?: number; preserveBoundaries?: boolean; preserveUVSeams?: boolean }`. `ratio` clamped to `[0, 1]`, default `0.5`. Both preservation flags default `true`. |

Behaviour notes:

- This is a simplified Melax-style progressive mesh, not a full quadric
  error metric (QEM) implementation. Edge cost is purely geometric length.
- Boundary edges (referenced by exactly one face) have both endpoints
  locked when `preserveBoundaries` is set.
- An edge whose endpoints disagree in UV (beyond `1e-6`) is skipped when
  `preserveUVSeams` is set, keeping texture atlas seams intact.
- Degenerate faces (two corners collapse to the same root) are dropped;
  the index is rebuilt and vertices are compacted.
- The output recompute normals via `computeVertexNormals` and recomputes
  the bounding box.

### Options Reference

`TessellateOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxEdgeLength` | `number` | `0.1` | Squared edge length threshold. Any triangle with an edge whose squared length exceeds `maxEdgeLength²` is split. Smaller values produce denser output. |
| `triangles` | `boolean` | `true` | Reserved for API parity with three.js. VREEN always emits triangles; setting `false` has no effect. |
| `maxIterations` | `number` | `10` | Upper bound on refinement passes. `Math.max(1, floor(value))` is stored, so `0` becomes `1`. |

`SimplifyOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ratio` | `number` | `0.5` | Target vertex retention in `[0, 1]`. `0.25` keeps 25% of vertices. Clamped on construction. |
| `preserveBoundaries` | `boolean` | `true` | When `true`, vertices on open-silhouette edges (referenced by exactly one face) are never collapsed. |
| `preserveUVSeams` | `boolean` | `true` | When `true`, an edge whose endpoints have differing UVs (beyond `1e-6`) is skipped, preserving texture atlas seams. |

---

## Algorithm Details

### Tessellation

The tessellator is an iterative edge-bisection loop. Each pass walks the
non-indexed triangle list and, for every triangle, computes the three
squared edge lengths (`ab`, `bc`, `ac`). If any exceeds
`maxEdgeLength²`, the longest edge is selected and split at its midpoint:

- The triangle is replaced by two triangles that share the new midpoint
  vertex. The exact pairing depends on which edge was split (`ab`, `bc`,
  or `ac`) so the new triangulation stays watertight.
- Normals at the midpoint are the arithmetic mean of the two endpoint
  normals, preserving smooth shading across the seam.
- UVs at the midpoint are the arithmetic mean of the two endpoint UVs,
  keeping the texture parameterisation continuous.
- Passes repeat while any edge still violates the budget and the
  iteration counter is below `maxIterations`.

Because each split can at most halve the longest edge, the iteration
count bounds the maximum refinement factor logarithmically. Callers
needing a hard vertex budget should pair the tessellator with the
simplifier (see "Combining both" below).

### Simplification

The simplifier implements a reduced Melax progressive mesh. The pipeline
is:

1. **Index normalisation.** If the source is non-indexed, a synthetic
   `[0, 1, 2, ...]` index is generated so the rest of the algorithm
   operates uniformly.
2. **Short-circuit.** If `floor(count * ratio) >= count`, the source is
   deep-copied (position / normal / uv / index) and returned unchanged.
3. **Edge collection.** Unique undirected edges are gathered from the
   face list, keyed by `min*vc + max` to deduplicate.
4. **Boundary marking.** Edges referenced by exactly one face are
   boundary edges; both endpoints are flagged when
   `preserveBoundaries` is set.
5. **Edge sorting.** Edges are sorted ascending by squared length, so
   the shortest (least visually significant) edges collapse first.
6. **Union-find collapse.** Edges are consumed in order. For each edge,
   the two endpoint roots are found; if distinct, not boundary-locked,
   and UV-compatible (when `preserveUVSeams` is set), they are merged.
   The loop stops once the surviving vertex count reaches the target.
7. **Face compaction.** Faces whose two corners collapse to the same
   root (degenerate) are dropped. Surviving faces are re-indexed into a
   compacted vertex buffer.
8. **Normal recompute.** `computeVertexNormals` and
   `computeBoundingBox` are called on the result.

This is intentionally not a full QEM solver: edge cost is purely
geometric length, which is fast and deterministic but can collapse
topologically important short edges. For assets where this matters,
prefer authoring LODs offline and loading them directly.

---

## Usage

### Tessellating a plane

```ts
import { PlaneGeometry } from '../Geometries/PlaneGeometry';
import { TessellateModifier } from './TessellateModifier';

// A 1×1 plane with a single quad (4 vertices, 2 triangles).
const plane = new PlaneGeometry(1, 1, 1, 1);

// Refine so no edge is longer than 0.05; allow up to 8 iterations.
const tess = new TessellateModifier({ maxEdgeLength: 0.05, maxIterations: 8 });
const refined = tess.modify(plane);

// `refined` is a new BufferGeometry; `plane` is unchanged.
console.log(refined.attributes.position.count); // > 6
console.log(plane.attributes.position.count);   // still 6

// A displacement shader can now sample a height map per vertex without
// faceting, because the mesh is dense enough for the detail frequency.
```

### Simplifying a high-poly mesh

```ts
import { BufferGeometry } from '../Core/BufferGeometry';
import { SimplifyModifier } from './SimplifyModifier';

// `heavy` is a high-poly mesh imported from a glTF asset.
const heavy: BufferGeometry = loadAsset('hero.glb').geometry;

// Keep 25% of the vertices, lock silhouette and UV seams.
const simplify = new SimplifyModifier({
  ratio: 0.25,
  preserveBoundaries: true,
  preserveUVSeams: true,
});
const lod1 = simplify.modify(heavy);

// Build a coarser LOD by simplifying further.
const lod2 = new SimplifyModifier({ ratio: 0.1 }).modify(heavy);

// `heavy` is untouched; lod1 / lod2 are independent geometries that can be
// swapped in based on distance to camera.
```

### Combining both

It is common to tessellate first (to guarantee uniform edge lengths) and
then simplify to a target budget, which yields a more regular topology
than simplifying irregular input directly:

```ts
const uniform = new TessellateModifier({ maxEdgeLength: 0.1 }).modify(source);
const lod = new SimplifyModifier({ ratio: 0.3 }).modify(uniform);
```

---

## Invariants

- **Returns a new geometry.** `modify()` never mutates the input
  `BufferGeometry`; its `position`, `normal`, `uv`, and `index` arrays are
  only read. Callers can safely keep using the source mesh.
- **`ratio` clamped to `[0, 1]`.** `SimplifyModifier` clamps the option in
  its constructor. `ratio >= 1` short-circuits to a full deep copy of the
  source geometry (no simplification, but still a fresh instance).
- **`maxIterations` limits work.** `TessellateModifier` stops after the
  configured iteration count even if edges still exceed `maxEdgeLength`,
  guaranteeing bounded runtime for pathological inputs.
- **Output is always triangles.** Both modifiers operate on triangle
  faces (3 indices per face) and emit triangle-only output.
- **Index handling.** `TessellateModifier` always emits non-indexed
  geometry (it duplicates vertices at split points). `SimplifyModifier`
  preserves indexed form, compacting and re-indexing only the surviving
  vertices.
- **Attribute preservation.** `normal` and `uv` are carried through when
  present on the source. When `normal` is absent the tessellator computes
  it; the simplifier always recomputes normals on the result.
- **Bounding box.** Both modifiers call `computeBoundingBox()` on the
  output so it is immediately usable for culling and ray intersection.
- **No internal caching.** Modifier instances hold only configuration.
  Reusing one instance across geometries is safe and side-effect free.
- **Deterministic order.** Edge sorting in `SimplifyModifier` is a stable
  ascending length sort; identical inputs produce identical outputs.

---

## References

- `src/engine/Core/BufferGeometry.ts` — input/output container consumed by
  both modifiers.
- `src/engine/Core/BufferAttribute.ts` — typed attribute storage
  (`position`, `normal`, `uv`) read and written by the modifiers.
- `src/engine/Geometries/PlaneGeometry.ts` — common input used in the
  tessellation example and unit tests.
- three.js `examples/jsm/modifiers/TessellateModifier.js` — upstream
  edge-split algorithm this class is ported from.
- three.js `examples/jsm/modifiers/SimplifyModifier.js` — upstream
  shortest-edge-collapse (simplified Melax progressive mesh) reference.
- o3de EMotionFX mesh processing utilities — reference for the
  geometry-pipeline conventions (non-destructive operators returning new
  buffers) adopted here.
