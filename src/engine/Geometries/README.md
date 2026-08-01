# Geometries Module

> Path: `src/engine/Geometries/`
>
> The procedural geometry library of the `@vreen/engine` kernel. Provides
> 15 analytic primitives (`Box` / `Sphere` / `Cylinder` / `Cone` /
> `Torus` / `Plane` / `Circle` / `Ring` / `Capsule` / `TorusKnot` /
> `Lathe` / `Extrude` / `Shape` / `Wireframe` / `Edges`) ported from
> three.js and adapted to the VREEN `BufferGeometry`, plus
> `InstancedGeometry` for per-instance matrix / color / custom attribute
> rendering, and `MarchingCubes` for iso-surface extraction from density
> fields or metaballs.

---

## Overview

```
BufferGeometry (Core) ──base──→ all primitives
   ├── BoxGeometry
   ├── SphereGeometry
   ├── CylinderGeometry ──extended by──→ ConeGeometry (radiusTop = 0)
   ├── TorusGeometry
   ├── PlaneGeometry
   ├── CircleGeometry
   ├── RingGeometry
   ├── CapsuleGeometry
   ├── TorusKnotGeometry
   ├── LatheGeometry ──revolves──→ Vector2[] profile
   ├── Shape (2-D contour) ──input to──→ ExtrudeGeometry
   ├── WireframeGeometry ──derived from──→ BufferGeometry
   ├── EdgesGeometry ──derived from──→ BufferGeometry (hard-edge filter)
   └── ExtrudeGeometry ──extrudes──→ Shape along +Z

InstancedGeometry ──extends BufferGeometry──→ per-instance:
   instanceMatrix (Matrix4), instanceColor (Color), custom attributes

MarchingCubes ──extracts──→ iso-surface BufferGeometry from:
   density function (x,y,z) → number  |  metaballs[]  |  raw Float32Array field
```

Every primitive populates `position` / `normal` / `uv` attributes and
calls `computeBoundingBox()` in its constructor. Indices are
`Uint16` / `Uint32` depending on vertex count. All primitives are
origin-centred (unless noted) and axis-aligned to the Y axis (cylinders,
cones, capsules) or the XY plane (plane, circle, ring, shape).

---

## Core Classes

### Primitives

| Export | Role |
|--------|------|
| `BoxGeometry` | Box `(width, height, depth, widthSegments, heightSegments, depthSegments)`. Origin-centred, faces along ±X/Y/Z. |
| `SphereGeometry` | UV sphere `(radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength)`. Pole UVs offset by `0.5/widthSegments` to avoid degenerate UVs. Degenerate triangles at poles are skipped. |
| `CylinderGeometry` | Cylinder `(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength)`. Y-axis, origin-centred. **Default `openEnded=false` produces complete top/bottom cap faces.** Side triangles skipped when a radius collapses to zero. |
| `ConeGeometry` | Cone — subclass of `CylinderGeometry` with `radiusTop = 0`. Inherits complete base cap. |
| `TorusGeometry` | Torus `(radius, tube, radialSegments, tubularSegments, arc)`. Normals computed as `vertex - centerOnRing`. |
| `PlaneGeometry` | Plane on XY, normal +Z, `(width, height, widthSegments, heightSegments)`. |
| `CircleGeometry` | Disc on XY, normal +Z, `(radius, segments, thetaStart, thetaLength)`. |
| `RingGeometry` | Annulus on XY `(innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength)`. |
| `CapsuleGeometry` | Capsule (cylinder + two hemispheres) `(radius, length, capSegments, radialSegments)`. Y-axis. |
| `TorusKnotGeometry` | Torus knot `(radius, tube, tubularSegments, radialSegments, p, q)`. |
| `LatheGeometry` | Surface of revolution `(points: Vector2[], segments, phiStart, phiLength)`. Revolves a 2-D profile around the Y axis. |
| `Shape` | 2-D contour (lineTo / quadraticCurveTo / bezierCurveTo / absarc). Input to `ExtrudeGeometry`. |
| `ExtrudeGeometry` | Extrudes a `Shape` along +Z `(shape, depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments, steps)`. |
| `WireframeGeometry` | Builds line-segment geometry from a source `BufferGeometry` — every triangle edge becomes a line. |
| `EdgesGeometry` | Builds line-segment geometry keeping only edges whose adjacent-face angle exceeds `thresholdAngle` (default 1°). |
| `MarchingCubes` | Iso-surface extraction from a 3D scalar field (Lorensen & Cline 1987). Accepts a density function, metaball list, or raw `Float32Array` field. Outputs non-indexed triangles + face normals. Resolution 2..256, configurable `isoLevel`. |

### Instanced Geometry

| Export | Role |
|--------|------|
| `InstancedGeometry` | `BufferGeometry` with explicit instance buffers: `setInstanceMatrix(i, Matrix4)` / `setInstanceColor(i, Color)` / `setCustomAttribute(name, i, value)`. `meshPerAttribute` defaults to 1. |

```ts
const geo = new InstancedGeometry(new BoxGeometry(1, 1, 1), 100);
for (let i = 0; i < 100; i++) {
  geo.setInstanceMatrix(i, composeMatrix(/* per-instance transform */));
}
geo.instanceMatrix.needsUpdate = true;
```

### `MarchingCubes` (`MarchingCubes.ts`)

Iso-surface extraction from a 3D scalar field using the Marching Cubes
algorithm (Lorensen & Cline, SIGGRAPH 1987). Given a density function
(or metaballs, or a raw sampled field), it produces a `BufferGeometry`
mesh approximating the surface where density equals `isoLevel`.

Adapted from three.js `examples/jsm/objects/MarchingCubes.js` and
reconstructed as a geometry generator.

**Use cases**: metaball rendering (fluid-like fused spheres), voxel
terrain iso-surface extraction, medical imaging (CT/MRI) surface
reconstruction, procedural mesh generation from noise fields.

**Algorithm**:

1. Sample the density field onto a uniform `(resolution+1)³` grid.
2. For each grid cell (cube with 8 corner values):
   - Compute a 8-bit `cubeIndex` (bit i set if corner i < `isoLevel`).
   - Look up `EDGE_TABLE[cubeIndex]` — a 12-bit mask indicating which
     edges the iso-surface crosses.
   - For each crossed edge, linearly interpolate the vertex position
     between the two corners: `t = (isoLevel − v_a) / (v_b − v_a)`.
   - Look up `TRI_TABLE[cubeIndex]` — a list of edge indices forming
     0–5 triangles for that cube configuration.
3. Normals are computed as face normals (cross product of triangle edges),
   pointing toward decreasing density (outward).

**Three input modes**:

| Method | Input | Use case |
|--------|-------|----------|
| `fromDensity(fn)` | `(x, y, z) => number` | Procedural fields (noise, SDF, mathematical surfaces) |
| `MarchingCubes.fromMetaballs(balls, opts)` | `Metaball[]` (static) | Fused-sphere metaball rendering |
| `fromField(field, N)` | `Float32Array` of size `N³` | Pre-sampled data (CT/MRI, simulation output) |

**Metaball density**: each ball contributes
`d += radiusSq / (distSq + radiusSq)`. Multiple overlapping balls
produce smooth fusion — the defining property of metaballs.

| Export | Role |
|--------|------|
| `MarchingCubes` | Extractor. Constructor: `(opts?: MarchingCubesOptions)`. |
| `MarchingCubesOptions` | `{ resolution?, isoLevel?, size?, offset?, computeNormals? }`. |
| `Metaball` | `{ center: Vector3; radiusSq: number }` — one metaball. |

| Option | Default | Description |
|--------|---------|-------------|
| `resolution` | `32` | Grid cells per axis (clamped 2..256). Higher = smoother but slower. |
| `isoLevel` | `0.5` | Threshold; corners with value > `isoLevel` are "inside". |
| `size` | `1.0` | Total world-space length per axis. |
| `offset` | `(0, 0, 0)` | World-space origin of the grid. |
| `computeNormals` | `true` | Whether to compute face normals. |

```ts
// From a density function — sphere of radius 0.6
const mc = new MarchingCubes({
  resolution: 32,
  isoLevel: 0.5,
  size: 2,
  offset: new Vector3(-1, -1, -1),
});
const sphereGeo = mc.fromDensity((x, y, z) => {
  const r = Math.sqrt(x * x + y * y + z * z);
  return 1 - r;   // > 0.5 inside, < 0.5 outside
});

// From metaballs — fused organic blobs
const metaballGeo = MarchingCubes.fromMetaballs(
  [
    { center: new Vector3(-0.3, 0, 0), radiusSq: 0.4 },
    { center: new Vector3(0.3, 0, 0), radiusSq: 0.4 },
    { center: new Vector3(0, 0.4, 0), radiusSq: 0.3 },
  ],
  { resolution: 48, size: 2, offset: new Vector3(-1, -1, -1) },
);

// Render
scene.add(new Mesh(metaballGeo, new StandardMaterial({ ... })));
```

### `RoundedBoxGeometry` (`RoundedBoxGeometry.ts`)

A `BoxGeometry` variant whose 12 edges and 8 corners are rounded with
spherical / cylindrical transitions, producing a fully smoothed box.
Useful for stylized UI meshes, buttons, soft-edged props, and any case
where sharp box corners read poorly under PBR lighting.

| Param | Type | Default | Role |
|-------|------|---------|------|
| `width` | `number` | `1` | Box width. |
| `height` | `number` | `1` | Box height. |
| `depth` | `number` | `1` | Box depth. |
| `segments` | `number` | `2` | Round-edge subdivisions (higher = smoother). |
| `radius` | `number` | `0.1` | Corner radius (clamped to `≤ min(w,h,d)/2`). |

Vertex normals are the true surface normals of the transition curves,
so lighting is continuous with no hard edge seams. Outputs indexed
positions / normals / uvs.

Adapted from three.js `RoundedBoxGeometry.js`.

### `ConvexGeometry` (`ConvexGeometry.ts`)

Builds the convex hull of an arbitrary 3D point set and emits it as a
non-indexed triangle mesh with flat (per-face) normals — matching
three.js `ConvexGeometry` behavior. Powered by the incremental QuickHull
algorithm (initial tetrahedron from extreme points → per-point visible-
face removal → horizon-edge fan → outward normals via centroid
reference). Degenerate inputs (< 4 points, collinear, or coplanar)
yield an empty geometry.

```ts
import { ConvexGeometry, Vector3 } from '@vreen/engine';
const geo = new ConvexGeometry([
  new Vector3(-1, -1, -1), new Vector3(1, -1, -1),
  new Vector3(-1, 1, -1), new Vector3(-1, -1, 1),
  new Vector3(0.5, 0.5, 0.5), // interior point, ignored by hull
]);
// geo.attributes.position / normal populated; flat-shaded hull mesh.
```

The standalone `ConvexHull` (in the Math module) exposes the structured
result (`{ faces, vertexIndices, vertices }`) plus `volume()` /
`surfaceArea()` for collision and shadow use; `ConvexGeometry` is the
geometry-builder convenience wrapper.

Adapted from three.js `ConvexGeometry.js` + `ConvexHull.js`.

---

## Usage Example

```ts
import {
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry,
  TorusGeometry, PlaneGeometry, CapsuleGeometry, TorusKnotGeometry,
  LatheGeometry, Shape, ExtrudeGeometry, EdgesGeometry,
  InstancedGeometry, MarchingCubes,
} from '@vreen/engine/geometries';
import { Mesh, StandardMaterial } from '@vreen/engine/core';
import { Vector2, Vector3 } from '@vreen/engine/math';

const box = new Mesh(
  new BoxGeometry(1, 1, 1),
  new StandardMaterial({ baseColor: { r: 0.8, g: 0.4, b: 0.2 } }),
);

const sphere = new SphereGeometry(0.5, 32, 16);

// Cylinder with complete caps (VREEN default)
const cylinder = new CylinderGeometry(0.5, 0.5, 1, 32, 1, false);
const cone = new ConeGeometry(0.5, 1, 32);

const torus = new TorusGeometry(1, 0.4, 12, 48);
const plane = new PlaneGeometry(2, 2, 4, 4);
const capsule = new CapsuleGeometry(0.4, 1.0, 8, 16);
const knot = new TorusKnotGeometry(0.8, 0.25, 128, 16, 2, 3);

// Lathe from a 2-D profile
const profile = [
  new Vector2(0.1, 0),
  new Vector2(0.5, 0.2),
  new Vector2(0.4, 0.8),
  new Vector2(0.1, 1.0),
];
const vase = new LatheGeometry(profile, 32);

// Extrude a 2-D shape
const shape = new Shape();
shape.moveTo(-0.5, -0.5);
shape.lineTo(0.5, -0.5);
shape.lineTo(0.5, 0.5);
shape.lineTo(-0.5, 0.5);
shape.lineTo(-0.5, -0.5);
const extruded = new ExtrudeGeometry(shape, {
  depth: 0.2,
  bevelEnabled: true,
  bevelThickness: 0.02,
  bevelSize: 0.02,
  bevelSegments: 2,
});

// Hard-edge wireframe
const edges = new EdgesGeometry(box.geometry, 15);

// Instanced forest
const treeGeo = new InstancedGeometry(new ConeGeometry(0.5, 1, 8), 500);
for (let i = 0; i < 500; i++) {
  treeGeo.setInstanceMatrix(i, /* per-tree transform */);
}
treeGeo.instanceMatrix.needsUpdate = true;

// Marching Cubes — metaball blob
const blobGeo = MarchingCubes.fromMetaballs(
  [
    { center: new Vector3(0, 0, 0), radiusSq: 0.5 },
    { center: new Vector3(0.4, 0, 0), radiusSq: 0.3 },
  ],
  { resolution: 32, size: 2, offset: new Vector3(-1, -1, -1) },
);
const blob = new Mesh(blobGeo, new StandardMaterial({ baseColor: { r: 0.3, g: 0.7, b: 0.9 } }));
```

---

## Invariants

- **Complete cap faces.** `CylinderGeometry` / `ConeGeometry` default to
  `openEnded=false` and emit complete top/bottom cap fan strips. This is
  a deliberate divergence from three.js — VREEN rebuilds caps using
  native constructors to guarantee no missing faces. Setting
  `openEnded=true` produces a tube only.
- **Degenerate triangle skipping.** `SphereGeometry` skips triangles at
  collapsed poles; `CylinderGeometry` skips triangles when a radius
  collapses to zero. Vertex counts are therefore not always
  `(segments+1)²`.
- **`computeBoundingBox()` in constructor.** Every primitive calls
  `computeBoundingBox()` after building attributes; callers must call
  `computeBoundingSphere()` separately if they need spherical bounds for
  frustum culling.
- **Y-axis convention.** Cylinders, cones, capsules, and lathe surfaces
  are aligned to the Y axis; planes, circles, rings, and shapes lie on
  the XY plane with normal +Z. Rotate the mesh, not the geometry, to
  reorient.
- **`DoubleSide` recommended.** Procedural primitives may produce
  inconsistent winding on caps / poles; materials should default to
  `DoubleSide` to avoid backface-culling artefacts.
- **Index type.** Index arrays are `Uint16Array` when vertex count ≤
  65535, otherwise `Uint32Array`. Callers must not assume a fixed typed
  array class.
- **`WireframeGeometry` vs `EdgesGeometry`.** `WireframeGeometry`
  emits every triangle edge (dense); `EdgesGeometry` keeps only hard
  edges above `thresholdAngle` (sparse). Choose based on visual intent.
- **`InstancedGeometry` requires explicit `needsUpdate`.** After
  writing per-instance matrices / colors / custom attributes, set
  `instanceMatrix.needsUpdate = true` (or the attribute's `version` will
  not bump and the GPU buffer stays stale).
- **`Shape` winding.** `ExtrudeGeometry` expects counter-clockwise
  outer contours; clockwise winding produces inverted face normals.
  Holes are punched via `shape.holes` with opposite winding.
- **`MarchingCubes` output is non-indexed.** Each triangle emits 3
  independent vertices (no index buffer). Weld vertices with
  `weldVertices` (from `BufferGeometryUtils`) if indexed topology is
  required for rendering or export.
- **`MarchingCubes` normals are face normals.** Normals are computed
  per-triangle via cross product, producing a faceted look. For smooth
  shading, recompute normals with `geometry.computeVertexNormals()` or
  use the density-field gradient (central differences) externally.
- **`MarchingCubes` resolution vs. memory.** Memory is
  `O((resolution+1)³)` for the field plus `O(triangles · 3)` for the
  output. Resolution 256 produces a 257³ ≈ 16.9M-cell field — use
  cautiously. The constructor clamps to `[2, 256]`.
- **`MarchingCubes.fromField` expects `N³` layout.** The field array
  must be indexed `[z*N*N + y*N + x]` with `N = resolution + 1`.
  Mismatched dimensions produce out-of-bounds reads or garbage geometry.

---

## References

- `src/engine/Core/README.md` — `BufferGeometry` / `BufferAttribute` /
  `InstancedBufferAttribute` define the storage layer these primitives
  populate.
- `src/engine/Materials/` — `StandardMaterial` / `MeshPhysicalMaterial`
  consume `position` / `normal` / `uv` attributes for PBR shading.
- `src/engine/Renderer/README.md` — `WebGL2Renderer` caches VAOs keyed
  on `BufferGeometry.uuid` / `version`; geometry edits must bump
  `version` to trigger re-upload.
- three.js `src/geometries/` — original implementations; VREEN ports
  preserve parameter names and UV conventions for asset compatibility.
- `src/three/convertCustomToThree.ts` — converts custom-engine
  `BufferGeometry` to three.js `BufferGeometry` for the THREE render
  path.
- Lorensen & Cline "Marching Cubes: A High Resolution 3D Surface
  Construction Algorithm" (SIGGRAPH 1987) — original algorithm reference
  for `MarchingCubes.ts`.
- three.js `examples/jsm/objects/MarchingCubes.js` — original
  implementation adapted for `MarchingCubes.ts`.
- Paul Bourke "Polygonising a Scalar Field" — alternative reference for
  the edge / triangle lookup tables.
