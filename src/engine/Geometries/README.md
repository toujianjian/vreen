# Geometries Module

> Path: `src/engine/Geometries/`
>
> The procedural geometry library of the `@vreen/engine` kernel. Provides
> 15 analytic primitives (`Box` / `Sphere` / `Cylinder` / `Cone` /
> `Torus` / `Plane` / `Circle` / `Ring` / `Capsule` / `TorusKnot` /
> `Lathe` / `Extrude` / `Shape` / `Wireframe` / `Edges`) ported from
> three.js and adapted to the VREEN `BufferGeometry`, the 4 Platonic
> solids (`Tetrahedron` / `Octahedron` / `Dodecahedron` / `Icosahedron`)
> via the `PolyhedronGeometry` subdividable base class, plus
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
   ├── ExtrudeGeometry ──extrudes──→ Shape along +Z
   ├── DecalGeometry ──projects──→ target mesh triangles → clipped box
   └── PolyhedronGeometry ──subdivides──→ 4 Platonic solids (Tetrahedron/Octahedron/Dodecahedron/Icosahedron)

InstancedGeometry ──extends BufferGeometry──→ per-instance:
   instanceMatrix (Matrix4), instanceColor (Color), custom attributes

LineSegmentsGeometry ──extends InstancedGeometry──→ per-segment:
   instanceStart (Vector3), instanceEnd (Vector3), instanceColorStart/End, instanceDistanceStart/End
   └── LineGeometry ──polyline chain──→ N-1 segment pairs (Line2 thick polyline)

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

### Thick Line Geometry (`LineSegmentsGeometry.ts` / `LineGeometry.ts`)

Screen-space quad-expansion geometry for rendering thick (≥ 1 px) lines.
Each line segment becomes one **instance** drawn with a shared 8-vertex /
18-index template quad; the vertex shader expands the quad in screen
space to the desired `linewidth` (see `LineMaterial` + `LineSegments2` /
`Line2` in `Core`).

Adapted from three.js `examples/jsm/lines/LineSegmentsGeometry.js` and
`LineGeometry.js`. The VREEN port stores per-segment data in
`InstancedGeometry.customAttributes` (`instanceStart` / `instanceEnd` /
optional `instanceColorStart` / `instanceColorEnd` /
`instanceDistanceStart` / `instanceDistanceEnd`) instead of three.js's
`InstancedInterleavedBuffer`.

**Template geometry** (three.js original values — the shader depends on
these, do **not** modify):

| Attribute | Values |
|-----------|--------|
| `position` | `[-1,2,0, 1,2,0, -1,1,0, 1,1,0, -1,0,0, 1,0,0, -1,-1,0, 1,-1,0]` |
| `uv` | `[-1,2, 1,2, -1,1, 1,1, -1,-1, 1,-1, -1,-2, 1,-2]` |
| `index` | `[0,2,1, 2,3,1, 2,4,3, 4,5,3, 4,6,5, 6,7,5]` |

`position.x ∈ {-1, 1}` controls left/right offset perpendicular to the
segment; `position.y ∈ {-1, 0, 1, 2}` (with matching `uv.y`) controls
position along the segment and the round end-cap extension.

| Export | Role |
|--------|------|
| `LineSegmentsGeometry` | Independent thick segments. `setPositions([x0,y0,z0, x1,y1,z1, …])` — every 6 floats = one segment (`instanceStart` + `instanceEnd`). `setColors([r0,g0,b0, r1,g1,b1, …])` — per-segment vertex colors. |
| `LineGeometry` | Thick polyline (extends `LineSegmentsGeometry`). `setPositions([x0,y0,z0, x1,y1,z1, x2,y2,z2, …])` — N vertices → N−1 segments; internally converts the chain to segment pairs. `setColors` likewise takes a per-vertex color chain. |

**Custom attributes** (populated by `setPositions` / `setColors` /
`computeLineDistances`):

| Name | itemSize | Source | Purpose |
|------|---------:|--------|---------|
| `instanceStart` | 3 | `setPositions` | Segment start point (local space). |
| `instanceEnd` | 3 | `setPositions` | Segment end point (local space). |
| `instanceColorStart` | 3 | `setColors` | Start vertex color (linear RGB). |
| `instanceColorEnd` | 3 | `setColors` | End vertex color (linear RGB). |
| `instanceDistanceStart` | 1 | `LineSegments2.computeLineDistances` | Cumulative line distance at segment start (for dashed rendering). |
| `instanceDistanceEnd` | 1 | `LineSegments2.computeLineDistances` | Cumulative line distance at segment end. |

```ts
import { LineSegmentsGeometry, LineGeometry } from '@vreen/engine/geometries';
import { LineSegments2, Line2 } from '@vreen/engine/core';
import { LineMaterial } from '@vreen/engine/materials';
import { Vector2 } from '@vreen/engine/math';

// Independent thick segments
const segGeo = new LineSegmentsGeometry();
segGeo.setPositions([
  0, 0, 0, 3, 0, 0,   // segment 0
  0, 0, 0, 0, 4, 0,   // segment 1
]);
segGeo.setColors([
  1, 0, 0, 0, 1, 0,   // segment 0: red → green
  0, 0, 1, 1, 1, 0,   // segment 1: blue → yellow
]);

// Thick polyline (4 vertices → 3 segments)
const lineGeo = new LineGeometry();
lineGeo.setPositions([0, 0, 0, 3, 0, 0, 3, 4, 0, 3, 4, 12]);

const mat = new LineMaterial({
  color: { r: 0.2, g: 1, b: 0.8 },
  linewidth: 4,
  resolution: new Vector2(1920, 1080),
});

const line = new Line2(lineGeo, mat);
line.computeLineDistances();   // populate instanceDistanceStart/End for dashed mode
scene.add(line);
```

**Differences from three.js**:

- three.js uses `InstancedInterleavedBuffer` + `InterleavedBufferAttribute`
  for `instanceStart` / `instanceEnd` (interleaved `xyz,xyz`); VREEN stores
  them as two separate `InstancedGeometry.customAttributes` (itemSize=3),
  which the renderer binds as instanced vertex attribs.
- `instanceMatrix` is kept as identity (per-instance) — segment endpoints
  come directly from `instanceStart` / `instanceEnd`, transformed to world
  space by the object's `matrixWorld` in the vertex shader.
- `applyMatrix4` transforms `instanceStart` / `instanceEnd` in-place
  (three.js does the same on its interleaved buffer).
- `computeBoundingBox` / `computeBoundingSphere` iterate the per-segment
  start/end arrays directly (no `Box3.setFromPoints` — uses `makeEmpty` +
  `expandByPoint` loop).

**Limitations**:

- The template quad has no `normal` attribute; lighting in `LineMaterial`
  is unlit (`BasicMaterial`-based). For lit thick lines, extend the
  fragment shader with a hard-coded normal (e.g. screen-facing `(0,0,1)`).
- `setColors` expects the same segment count as `setPositions`; passing
  a mismatched count throws.
- Raycasting is handled by `LineSegments2.raycast` / `Line2.raycast`
  (in `Core/Line2.ts`), not by the geometry itself.
- The `resolution` uniform must be updated on viewport resize; otherwise
  screen-space expansion uses stale dimensions and line width appears
  wrong.

Adapted from three.js `examples/jsm/lines/LineSegmentsGeometry.js` and
`examples/jsm/lines/LineGeometry.js`.

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

### `DecalGeometry` (`DecalGeometry.ts`)

Projects a target mesh's triangles into a local projector space and
clips them against a 3-axis-aligned box, producing a new triangle mesh
that conforms exactly to the target surface within the projector volume.
Used for bullet holes, blood splatter, scratches, graffiti, projected
textures, and any effect that needs to "paint" geometry onto existing
surfaces.

**Algorithm** (Sutherland–Hodgman triangle-against-box clipping):

1. Build `projectorMatrix = T(position) × R(orientation)` and invert.
2. For each triangle of the target (indexed or non-indexed), transform
   every vertex to **projector-local space** via
   `projectorMatrixInverse × mesh.matrixWorld × vertexLocal`; transform
   normals to **world space** via `transformDirection(mesh.matrixWorld)`.
3. Clip the triangle against 6 axis-aligned planes (±X, ±Y, ±Z) in
   sequence. Each plane uses threshold
   `s = 0.5 × |size · planeNormal|`; a vertex with
   `position · plane − s > 0` is outside. After each plane, the
   triangle is re-triangulated:
   - 0 vertices outside → keep (1 triangle)
   - 1 vertex outside  → quad split into 2 triangles
   - 2 vertices outside → 1 triangle
   - 3 vertices outside → discarded
4. Output: UV = `(0.5 + localX/size.x, 0.5 + localY/size.y)`;
   position transformed back to **world space** via `projectorMatrix`;
   normal kept in world space (interpolated across clipped edges).

| Param | Type | Role |
|-------|------|------|
| `target` | `Object3D` | Mesh whose triangles are projected. Must have `geometry.attributes.position`; `normal` is used if present (fallback `(0,0,1)`). |
| `position` | `Vector3` | Decal projector centre in world space. |
| `orientation` | `Quaternion` | Decal projector orientation (unit quaternion). |
| `size` | `Vector3` | Decal box dimensions `(sx, sy, sz)`. Any zero component → empty geometry. |

```ts
import { DecalGeometry } from '@vreen/engine/geometries';
import { Vector3, Quaternion } from '@vreen/engine/math';

// Project a bullet-hole decal onto a wall mesh
const decal = DecalGeometry.create(
  wallMesh,
  new Vector3(0, 1.5, -0.5),          // world-space hit point
  new Quaternion(0, 0, 0, 1),          // identity orientation
  new Vector3(0.5, 0.5, 0.5),          // 50cm × 50cm × 50cm box
);
const decalMesh = new Mesh(decal, decalMaterial);
scene.add(decalMesh);
```

**Differences from three.js `DecalGeometry`**:

- `orientation` is a `Quaternion` (three.js uses `Euler`); the
  projector matrix is built via `Matrix4.compose(position, quat, (1,1,1))`.
- When the target geometry lacks a `normal` attribute, VREEN falls back
  to `(0, 0, 1)` instead of throwing.
- Output is non-indexed (same as three.js): every clipped triangle emits
  3 independent vertices.
- Output positions are in **world space** (same as three.js); UVs are
  computed in projector-local space before the world transform.

**Limitations**:

- Decal projections can distort around sharp corners (same fundamental
  limitation as three.js; see
  [Decal projections without distortions](https://github.com/mrdoob/three.js/issues/21187)).
- Boundary vertices (exactly on `±s`) are classified as inside
  (`d > 0` test); floating-point rotation matrices may push a boundary
  vertex slightly outside, triggering unexpected clipping. Use a slightly
  larger `size` when projecting onto geometry with vertices at exact
  box boundaries.
- The projector box is axis-aligned in **projector-local space**, not
  world space — use `orientation` to rotate the box.

Adapted from three.js `src/geometries/DecalGeometry.js` and the
[Wolfire decal projection article](http://blog.wolfire.com/2009/06/how-to-project-decals/).

### `PolyhedronGeometry` (`PolyhedronGeometry.ts`)

Base class for the five Platonic solids and arbitrary subdividable
polyhedra. Given a vertex array and a triangle index array, it builds a
non-indexed mesh with `position` / `normal` / `uv` attributes, with
optional face subdivision, spherical projection, and seam-corrected UVs.

The four subclasses provide ready-made vertex/index data for the regular
polyhedra:

| Class | Faces | Vertices | Notes |
|-------|------:|---------:|-------|
| `TetrahedronGeometry` | 4 triangles | 4 | Simplest Platonic solid. |
| `OctahedronGeometry` | 8 triangles | 6 | Two square pyramids base-to-base. |
| `DodecahedronGeometry` | 12 pentagons → 36 triangles | 20 | Built with the golden ratio φ = (1+√5)/2. |
| `IcosahedronGeometry` | 20 triangles | 12 | Highest-resolution Platonic solid; subdivides to a uniform sphere. |

**Algorithm** (4 stages, all running in the constructor):

1. **`subdivide(detail)`** — Recursively subdivide every source triangle
   into a `(detail+1)²` grid of smaller triangles. `detail=0` keeps the
   source face intact; `detail=1` splits it into 4, `detail=2` into 9,
   `detail=n` into `(n+1)²`. Subdivision happens in **source space**
   (before spherical projection), so each sub-vertex is later projected
   independently — this is what makes high-detail icosahedra approach a
   perfect sphere.
2. **`applyRadius(radius)`** — Normalize every vertex to length `radius`.
   After this step all vertices lie exactly on a sphere of radius `r`.
3. **`generateUVs()`** — Spherical UV mapping:
   - `u = 0.5 + azimuth(v) / (2π)`
   - `v = 0.5 + inclination(v) / π` (flipped to `1 - v` for texture V-down)
   - `correctUVs()` fixes pole vertices (where `x=z=0`) by replacing `u`
     with the centroid azimuth, avoiding degenerate UVs at the poles.
   - `correctSeam()` detects triangles that straddle the U=0/U=1 seam
     (`max > 0.9 && min < 0.2`) and adds 1 to the low-side UVs so the
     triangle samples a contiguous region of the texture.
4. **Normals** — `detail=0` uses `computeVertexNormals()` (flat shading:
   each face's three vertices share that face's normal). `detail>0` uses
   `normalizeNormals()` (smooth shading: each vertex normal = its
   normalized position, which is correct because every vertex is on the
   sphere). The smooth path is the reason subdivided icosahedra render
   as glossy spheres.

| Param | Type | Default | Role |
|-------|------|---------|------|
| `vertices` | `number[]` | `[]` | Flat vertex array `[x0,y0,z0, x1,y1,z1, …]`. Used only by the base class. |
| `indices` | `number[]` | `[]` | Flat triangle index array `[i0,i1,i2, …]`. Used only by the base class. |
| `radius` | `number` | `1` | Sphere radius all vertices are projected onto. |
| `detail` | `number` | `0` | Subdivision level. `detail=n` produces `(n+1)²` sub-triangles per source face. |

**Subclass vertex counts** (for verification):

| Class | detail=0 | detail=1 | detail=2 | detail=3 |
|-------|---------:|---------:|---------:|---------:|
| Tetrahedron (4 faces)  | 12  | 48  | 108 | 192 |
| Octahedron (8 faces)   | 24  | 96  | 216 | 384 |
| Dodecahedron (36 tris) | 108 | 432 | 972 | 1728 |
| Icosahedron (20 faces) | 60  | 240 | 540 | 960 |

```ts
import {
  TetrahedronGeometry, OctahedronGeometry,
  DodecahedronGeometry, IcosahedronGeometry,
  PolyhedronGeometry,
} from '@vreen/engine/geometries';
import { Vector3 } from '@vreen/engine/math';

// Flat-shaded icosahedron (low-poly aesthetic)
const lowPoly = new IcosahedronGeometry(1, 0);   // 60 verts, flat normals

// Smooth-shaded icosphere for a planet or marble
const icoSphere = new IcosahedronGeometry(1, 3); // 960 verts, smooth normals

// Custom subdividable polyhedron from arbitrary triangle soup
const custom = new PolyhedronGeometry(
  [1, 0, 0, 0, 1, 0, 0, 0, 1], // 3 vertices
  [0, 1, 2],                    // 1 triangle
  1.5,                          // radius
  2,                            // detail → 9 sub-triangles
);
```

**Differences from three.js `PolyhedronGeometry`**:

- VREEN uses `BufferAttribute` directly instead of three.js's `Float32BufferAttribute`;
  the on-the-wire layout is identical.
- The base class accepts `vertices`/`indices` as plain `number[]` (three.js
  uses the same signature); subclasses inherit unchanged.
- `computeVertexNormals()` is invoked only at `detail=0` for flat shading;
  the smooth-shading path uses an inlined `normalizeNormals()` that matches
  three.js's `normalizeNormals()` exactly.
- UV seam correction uses the same `0.9 / 0.2` thresholds as three.js;
  pole-vertex UVs are corrected via centroid azimuth identical to upstream.

**Limitations**:

- UVs use spherical mapping, so textures are heavily distorted near the
  poles (inherent to any sphere UV). For texture-less PBR materials this
  is invisible; for textured materials consider cubemap sampling instead.
- Subdivision is uniform per face; there is no adaptive subdivision. A
  `detail=3` icosahedron produces 960 vertices regardless of whether the
  camera is close or far. Use LOD swapping for distant objects.
- The base class does not deduplicate vertices along shared edges after
  subdivision — output is non-indexed. This is the same as three.js and
  is what enables per-face flat shading at `detail=0`.

Adapted from three.js `src/geometries/PolyhedronGeometry.js` and its
subclasses `TetrahedronGeometry.js` / `OctahedronGeometry.js` /
`DodecahedronGeometry.js` / `IcosahedronGeometry.js`.

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
- **`DecalGeometry` output is non-indexed world-space.** Every clipped
  triangle emits 3 independent vertices; positions are in world space
  (not projector-local). UVs are `[0,1]`-normalised within the projector
  box. The output `BufferGeometry` has no index buffer.
- **`DecalGeometry` mutates neither target nor projector.** The target
  mesh's `matrixWorld` is updated via `updateMatrixWorld(true)` before
  projection; the original geometry attributes are read-only.

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
