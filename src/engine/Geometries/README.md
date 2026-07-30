# Geometries Module

> Path: `src/engine/Geometries/`
>
> The procedural geometry library of the `@vreen/engine` kernel. Provides
> 15 analytic primitives (`Box` / `Sphere` / `Cylinder` / `Cone` /
> `Torus` / `Plane` / `Circle` / `Ring` / `Capsule` / `TorusKnot` /
> `Lathe` / `Extrude` / `Shape` / `Wireframe` / `Edges`) ported from
> three.js and adapted to the VREEN `BufferGeometry`, plus
> `InstancedGeometry` for per-instance matrix / color / custom attribute
> rendering.

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

---

## Usage Example

```ts
import {
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry,
  TorusGeometry, PlaneGeometry, CapsuleGeometry, TorusKnotGeometry,
  LatheGeometry, Shape, ExtrudeGeometry, EdgesGeometry,
  InstancedGeometry,
} from '@vreen/engine/geometries';
import { Mesh, StandardMaterial } from '@vreen/engine/core';
import { Vector2 } from '@vreen/engine/math';

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
