# WhiteBox Module

> Path: `src/engine/WhiteBox/`
>
> The in-editor greyboxing subsystem of the `@vreen/engine` kernel. Provides a
> topology-aware `HalfEdgeMesh` data structure (vertices / half-edges / faces
> with twin links and CCW outward normals), four primitive creators
> (`createBox` / `createTetrahedron` / `createIcosahedron` / `createStaircase`),
> and a simplified boolean-ops API (`csg`) supporting `union`, `subtract`, and
> `intersect` over convex meshes. Produces a renderable `BufferGeometry` via
> `HalfEdgeMesh.toBufferGeometry()`.

---

## Overview

```
WhiteBoxShapes ──create*──→ HalfEdgeMesh
   │  createBox(size)            │  vertices: Vertex[]      { id, position, halfEdge (outgoing) }
   │  createTetrahedron(r)       │  halfEdges: HalfEdge[]   { id, from, to, face, twin, next, prev }
   │  createIcosahedron(r)       │  faces: Face[]           { id, halfEdge, normal }
   │  createStaircase(...)       │
   ▼                             ▼
Csg ──op──→ HalfEdgeMesh        HalfEdgeMesh ──toBufferGeometry──→ BufferGeometry (flat-shaded)
   │  union      = merge(a, b)        │  addVertex / addFace (CCW ring, auto twin-link, normal via cross)
   │  subtract   = drop A faces       │  removeVertex / removeFace (twins detached, vertex.halfEdge repaired)
   │              inside B            │  findEdge / getVertexEdges / getFaceVertices (topology queries)
   │  intersect  = keep A faces       │  computeFaceNormals / getBoundingBox / clone / merge
   │              inside B            │  fan triangulation, per-face vertex duplication for flat normals
   ▼
HalfEdgeMesh (result)
```

The half-edge structure is the canonical in-memory representation: every
face stores a CCW ring of half-edges, every half-edge stores its `twin`
(the reverse edge of the adjacent face, or `-1` if boundary), and every
vertex stores one outgoing `halfEdge`. This makes neighbourhood queries
(`getVertexEdges`, `getFaceVertices`, twin traversal) O(ring-size) and
enables CSG face classification without rebuilding connectivity.

`BufferGeometry` (from `Core/`) is the *output* format — flat-shaded,
fan-triangulated, per-face vertex duplication — produced only when a mesh
is ready to render. Editing operations happen on the `HalfEdgeMesh`.

---

## Core Classes

### HalfEdgeMesh (`HalfEdgeMesh.ts`)

The half-edge mesh container and topology API.

| Export | Role |
|--------|------|
| `Vertex` | Interface — `{ id, position: Vector3, halfEdge }` where `halfEdge` is one outgoing edge (or `-1`). |
| `HalfEdge` | Interface — `{ id, from, to, face, twin, next, prev }`. `twin` is the reverse-direction edge of the neighbouring face, or `-1` for a boundary edge. |
| `Face` | Interface — `{ id, halfEdge, normal: Vector3 }`. `halfEdge` is any edge of the face's CCW ring; `normal` is the outward unit normal. |
| `HalfEdgeMesh` | Class — owns `vertices` / `halfEdges` / `faces` arrays and a monotonic `nextId`. |

```ts
export interface Vertex   { id: number; position: Vector3; halfEdge: number; }
export interface HalfEdge { id: number; from: number; to: number; face: number;
                            twin: number; next: number; prev: number; }
export interface Face     { id: number; halfEdge: number; normal: Vector3; }

export class HalfEdgeMesh {
  vertices: Vertex[];
  halfEdges: HalfEdge[];
  faces: Face[];

  addVertex(position: Vector3): number;
  addFace(vertexIds: number[]): number;            // CCW ring; auto-links next/prev, twins, normal
  removeVertex(id: number): void;                  // also removes incident faces
  removeFace(id: number): void;                    // detaches twins, repairs vertex.halfEdge
  findEdge(from: number, to: number): number;      // -1 if absent
  getVertexEdges(vid: number): number[];           // outgoing half-edge ids
  getFaceVertices(fid: number): number[];          // CCW vertex ids
  computeFaceNormals(): void;                      // recompute from positions
  getBoundingBox(): Box3;
  toBufferGeometry(): BufferGeometry;              // flat-shaded, fan-triangulated
  clone(): HalfEdgeMesh;                           // deep copy, ids preserved
  merge(other: HalfEdgeMesh): HalfEdgeMesh;        // union: append with remapped ids
}
```

`addFace` performs four steps: (1) allocate a half-edge per ring edge with
`next` / `prev` linked around the ring; (2) assign `vertex.halfEdge` for any
vertex that currently has none; (3) link `twin` pointers by searching for
an existing reverse edge (`findEdge(to, from)`); (4) compute the outward
normal as `(v1 - v0) × (v2 - v0)` normalised (degenerate falls back to
`+Y`). The face's half-edges form a closed CCW ring — traversing `next`
from `face.halfEdge` returns to the start.

`toBufferGeometry` emits one position per face-vertex (vertices are
duplicated across faces so each face has its own flat normal) and
triangulates n-gons with a fan `(0, i, i+1)`. The result has `position`,
`normal`, and `index` attributes suitable for `StandardMaterial` /
`Mesh`.

### WhiteBoxShapes (`WhiteBoxShapes.ts`)

Primitive creators that return a freshly-built `HalfEdgeMesh`. All faces
are wound CCW outward (verified by cross product) so the result is directly
usable by CSG and flat-shaded rendering.

| Export | Role |
|--------|------|
| `createBox(size: Vector3)` | Axis-aligned box centred at origin. 8 vertices, 6 quad faces (12 triangles after triangulation). `size` is the full extent per axis. |
| `createTetrahedron(radius: number)` | Regular tetrahedron centred at origin. 4 vertices on the unit sphere scaled to `radius`, 4 triangular faces. |
| `createIcosahedron(radius: number)` | Regular icosahedron centred at origin. 12 vertices (golden-ratio rectangle corners scaled to `radius`), 20 triangular faces. |
| `createStaircase(steps, stepWidth, stepHeight, stepDepth)` | Staircase of `steps` boxes. Step `i` sits at `y = i*stepHeight + stepHeight/2` and `z = i*stepDepth`. Built by merging per-step boxes via `HalfEdgeMesh.merge`. |

```ts
import { createBox, createStaircase } from '@vreen/engine/whitebox';
import { Vector3 } from '@vreen/engine';

const wall  = createBox(new Vector3(4, 3, 0.2));
const stairs = createStaircase(8, 1.2, 0.25, 0.4);
```

`createStaircase` is the only composite creator: it builds one box per
step, offsets each by `(0, i*stepHeight + stepHeight/2, i*stepDepth)`,
calls `computeFaceNormals()` on the offset box, and folds them together
with `merge`. The first step seeds the accumulator; an empty `steps` value
returns an empty `HalfEdgeMesh`.

### Csg (`Csg.ts`)

Boolean operations on two `HalfEdgeMesh` instances.

| Export | Role |
|--------|------|
| `CsgOperation` | Type union: `'union'` \| `'subtract'` \| `'intersect'`. |
| `csg(a, b, op)` | Returns a new `HalfEdgeMesh`. `a` is the primary; `b` is the operand. `b` should be convex for accurate `subtract` / `intersect`. |

```ts
export type CsgOperation = 'union' | 'subtract' | 'intersect';
export function csg(a: HalfEdgeMesh, b: HalfEdgeMesh, op: CsgOperation): HalfEdgeMesh;
```

| Operation | Strategy | Result |
|-----------|----------|--------|
| `union` | `a.merge(b)` — append `b`'s vertices / half-edges / faces with remapped ids. No intersection curve is computed. | Concatenation of both meshes; correct when `a` and `b` do not overlap. |
| `subtract` | Clone `a`; for each face of `a`, compute its centroid and remove the face if the centroid lies inside `b`. | `a` with the portion inside `b` carved out (B must be convex). |
| `intersect` | Clone `a`; for each face of `a`, remove the face if its centroid is **not** inside `b`. | The complement of `subtract` — only the inside-`b` portion of `a` remains. |

**Point-in-convex-mesh test.** A point `p` is inside `b` iff, for every
face of `b` with outward normal `n` and vertex `v0`, the scalar
`(p - v0) · n <= 0`. If any face classifies `p` as outside its half-space
(`> 1e-9`), the point is outside. This is the standard separating-plane
test for convex polyhedra and is exact when `b` is convex (box,
tetrahedron, icosahedron). For concave `b`, the result is an approximation
— callers should decompose concave operands into convex parts first.

---

## Usage Example

Create a wall, subtract a smaller box (a hole), and convert to a renderable
geometry:

```ts
import {
  HalfEdgeMesh, createBox, csg,
} from '@vreen/engine/whitebox';
import { Vector3 } from '@vreen/engine';
import { Mesh, StandardMaterial, WebGL2Renderer, Scene, PerspectiveCamera } from '@vreen/engine';

// 1. Build the primary mesh: a 4 x 3 x 0.2 wall.
const wall = createBox(new Vector3(4, 3, 0.2));

// 2. Build the cutter: a 1 x 1 x 1 box positioned where the hole should be.
//    createBox is centred at origin, so translate it after creation.
const cutter = createBox(new Vector3(1, 1, 1));
for (const v of cutter.vertices) {
  v.position.y += 1.0;   // raise the hole to mid-height
}
cutter.computeFaceNormals();

// 3. Subtract: removes the wall faces whose centroid lies inside the cutter.
const drilled = csg(wall, cutter, 'subtract');

// 4. Convert to a renderable BufferGeometry and add to the scene.
const geometry = drilled.toBufferGeometry();
const mesh = new Mesh(geometry, new StandardMaterial({ color: [0.7, 0.7, 0.7] }));

const scene = new Scene();
scene.add(mesh);

const camera = new PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 1.5, 6);

// 5. (Optional) Union with a staircase to compose a larger greybox.
import { createStaircase } from '@vreen/engine/whitebox';
const stairs = createStaircase(6, 1.0, 0.25, 0.35);
// Position the staircase in front of the wall, then merge.
for (const v of stairs.vertices) v.position.z += 1.5;
stairs.computeFaceNormals();
const composite = csg(drilled, stairs, 'union');
const compositeGeo = composite.toBufferGeometry();
```

Inspecting topology — iterate a face's vertices and walk its edge ring:

```ts
const faceIds = drilled.faces.map(f => f.id);
for (const fid of faceIds) {
  const verts = drilled.getFaceVertices(fid);   // CCW vertex ids
  const edges = drilled.getVertexEdges(verts[0]); // outgoing half-edges from first vertex
  for (const heId of edges) {
    const he = drilled.halfEdges.find(h => h.id === heId);
    if (he && he.twin !== -1) {
      const twin = drilled.halfEdges.find(h => h.id === he.twin)!;
      // twin.to === he.from  — the adjacent face's reverse edge
    }
  }
}
```

---

## Invariants

- **CCW outward winding.** Every face created by `addFace` (and therefore
  every primitive from `WhiteBoxShapes`) is wound so that
  `(v1 - v0) × (v2 - v0)` points away from the mesh interior. CSG and
  flat-shaded rendering both rely on this.
- **Stable ids across removal.** Vertex / half-edge / face `id`s are
  allocated monotonically from `nextId` and never change. Removals
  `splice` the dense arrays; lookups fall back to a linear scan when
  `array[id].id !== id` (O(1) on freshly built meshes, O(n) after
  removals).
- **Twin consistency.** If `he.twin = k` then `halfEdges[k].twin = he.id`.
  Boundary edges have `twin = -1`. `removeFace` detaches twins of removed
  edges (sets the counterpart's `twin` back to `-1`) so the invariant is
  preserved after partial deletion.
- **`vertex.halfEdge` always valid or `-1`.** After `removeFace`,
  vertices whose outgoing edge was removed are reassigned to any other
  outgoing edge, or `-1` if none remain. `addFace` populates `halfEdge`
  lazily only when it is currently `-1`.
- **`toBufferGeometry` is non-indexed by face-vertex.** Vertices are
  duplicated per face so each face carries its own flat normal; the
  resulting `BufferGeometry` has `position` and `normal` arrays of length
  `3 * sum(faceVertexCount)` and an index buffer for the fan triangles.
- **CSG does not compute intersection curves.** `union` is a plain merge
  (correct for non-overlapping inputs); `subtract` / `intersect` classify
  faces by centroid and require `b` to be convex for exact results.
  Overlapping `union` inputs produce coplanar z-fighting faces that the
  caller must resolve.
- **`merge` preserves `a` and `b`.** Both operands are unchanged; the
  returned mesh is a new `HalfEdgeMesh` with `a`'s topology cloned and
  `b`'s appended with remapped ids.
- **`createStaircase` is the only composite.** Other creators return
  single primitives; composition is the caller's responsibility (via
  `merge` or `csg`).

---

## Design Notes

**Why half-edges instead of a plain indexed mesh?** A flat indexed
`BufferGeometry` cannot answer neighbourhood queries ("which faces share
this edge?", "what's the adjacent face across this edge?") without
rebuilding connectivity — exactly the queries CSG and topology-aware
editing need. The half-edge structure stores `twin` / `next` / `prev`
explicitly so those queries are O(ring-size), at the cost of ~6x the
memory of a bare index buffer. The trade is justified for an editing
context where the mesh is small (greyboxing primitives) and queries are
frequent; the render path collapses back to a flat `BufferGeometry` via
`toBufferGeometry()`.

**Why simplified CSG?** A full boolean CSG (compute the intersection
curve of two meshes, split faces along it, keep/discard pieces per op) is
algorithmically heavy and rarely needed for greyboxing where operands are
convex primitives. The centroid half-space test is exact for convex `b`
and produces watertight-enough results for editor preview. Callers needing
production-grade booleans should compose the result from convex pieces or
export to an external tool.

**Why per-face vertex duplication in `toBufferGeometry`?** Flat shading
requires each face to have its own normal, which requires each face's
vertices to be distinct from its neighbours'. Duplicating per face is the
simplest way to guarantee this without a normal-splitting pass; the cost
(3-4x more vertices than an indexed mesh) is acceptable for the small
greyboxing meshes this module targets.

**Complementary to `Geometries/`.** `Geometries/` produces analytic
primitives (`BoxGeometry`, `SphereGeometry`, …) directly as flat
`BufferGeometry` for rendering. `WhiteBox/` produces topology-aware
`HalfEdgeMesh` for editing, then converts to `BufferGeometry` only at the
end. The two never share a base class: their consumers and lifecycles
differ.

---

## References

- o3de WhiteBox Gem — `Gems/WhiteBox/Core/WhiteBoxMesh` (reference
  architecture for the half-edge mesh and CSG).
- `Core/BufferGeometry` / `Core/BufferAttribute` — the renderable output
  format produced by `HalfEdgeMesh.toBufferGeometry()`.
- `Math/Vector3` / `Math/Box3` — vector arithmetic and bounding-box
  queries used throughout.
- `Geometries/` — analytic primitive geometry module (complementary,
  render-first rather than edit-first).
- `WhiteBox.test.ts` — primitive creation, CSG, and topology round-trip
  tests.
