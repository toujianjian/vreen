# Shapes Module

> Path: `src/engine/Shapes/`
>
> The shape component subsystem of the `@vreen/engine` kernel. Provides an
> abstract `Shape` contract (AABB / ray intersection / point containment /
> point distance) and eight concrete implementations — `BoxShape`,
> `SphereShape`, `CapsuleShape`, `CylinderShape`, `DiskShape`,
> `QuadShape`, `TubeShape`, and the composite `CompoundShape`. Shapes are
> semantic, transformable volumes reused by collision picking, ECS
> triggers, `SurfaceData` sampling, and vegetation filtering.

---

## Overview

A `Shape` is a queryable volume. Unlike the `Math/Box3` / `Math/Sphere`
value objects (pure geometry), a `Shape` carries a `type` tag, is meant
to be embedded as a component, and exposes the four queries every
collision/trigger system needs: an axis-aligned bounding box, a ray hit,
a point-in-volume test, and a signed-ish distance. Every concrete shape
implements all four; `CompoundShape` delegates to its children.

```
Shape (abstract) ── getAabb / intersectRay / containsPoint / distanceToPoint / clone
   │
   ├── BoxShape          min..max (AABB), slab-method ray test
   ├── SphereShape       center + radius, quadratic ray test
   ├── CapsuleShape      Y-axis cylinder + two hemispheres
   ├── CylinderShape     Y-axis solid cylinder (lateral + end caps)
   ├── DiskShape         zero-thickness circle (center + radius + normal)
   ├── QuadShape         zero-thickness rectangle (center + halfW/H + normal)
   ├── TubeShape         Y-axis annulus extruded (outer − inner cylinder)
   └── CompoundShape     union of shapes (AABB union, min distance, any-hit)
```

All shapes are axis-friendly: capsules, cylinders, and tubes are aligned
to the Y axis. Disks and quads may carry an arbitrary `normal` (default
up). The four queries are pure functions of the shape's fields — no
world transform is applied, so callers compose world space by translating
the shape's `center`/`min`/`max` fields.

---

## Core Classes

### `Shape` (abstract base)

| Member | Role |
|--------|------|
| `type: string` | Discriminator (`'box'`, `'sphere'`, `'capsule'`, `'cylinder'`, `'disk'`, `'quad'`, `'tube'`, `'compound'`). |
| `getAabb(): Box3` | Axis-aligned bounding box. |
| `intersectRay(ray: Ray): number \| null` | Ray hit parameter `t >= 0`, or `null`. Returns the nearest entry `t` (or exit `t` when the origin is inside). |
| `containsPoint(point: Vector3): boolean` | Point-in-volume (boundary inclusive). |
| `distanceToPoint(point: Vector3): number` | Shortest distance to the surface; `0` when inside. |
| `clone(): Shape` | Base returns `this`; concrete shapes return an independent copy. |

```ts
export abstract class Shape {
  abstract readonly type: string;
  abstract getAabb(): Box3;
  abstract intersectRay(ray: Ray): number | null;
  abstract containsPoint(point: Vector3): boolean;
  abstract distanceToPoint(point: Vector3): number;
  clone(): Shape { return this; }
}
```

### Concrete Shapes

| Export | Constructor | Ray test method |
|--------|-------------|-----------------|
| `BoxShape` | `(min, max)` defaults ±0.5 | Slab method per axis; handles parallel rays. |
| `SphereShape` | `(center, radius)` default r=0.5 | Quadratic; returns entry or exit `t`. |
| `CapsuleShape` | `(center, radius, halfHeight)` defaults r=0.4, hh=0.6 | Finite Y-cylinder + two hemispheres (only accepts hemisphere hits in their cap region). |
| `CylinderShape` | `(center, radius, halfHeight)` defaults r=0.5, hh=0.5 | Finite Y-cylinder lateral + two disk end caps. |
| `DiskShape` | `(center, radius, normal)` default normal up | Plane intersection + radial test; zero thickness. |
| `QuadShape` | `(center, halfWidth, halfHeight, normal)` | Plane intersection + in-rectangle test; in-plane basis `{u, v}` derived from `normal`. |
| `TubeShape` | `(center, outerRadius, innerRadius, halfHeight)` | Outer + inner cylinder lateral + two annulus end caps; hollow inner cavity. |
| `CompoundShape` | `(shapes: Shape[])` | Delegates: AABB union, nearest ray hit, any-contain, min distance. `add(shape)` mutates. |

```ts
export class BoxShape extends Shape {
  min: Vector3; max: Vector3;
  constructor(min?: Vector3, max?: Vector3);
}

export class SphereShape extends Shape {
  center: Vector3; radius: number;
  constructor(center?: Vector3, radius?: number);
}

export class CapsuleShape extends Shape {
  center: Vector3; radius: number; halfHeight: number;
  // total height = 2*halfHeight + 2*radius; hemisphere centers at center.y ∓ halfHeight
}

export class CylinderShape extends Shape {
  center: Vector3; radius: number; halfHeight: number;
}

export class DiskShape extends Shape {
  center: Vector3; radius: number; normal: Vector3; // zero thickness
}

export class QuadShape extends Shape {
  center: Vector3; halfWidth: number; halfHeight: number; normal: Vector3;
}

export class TubeShape extends Shape {
  center: Vector3; outerRadius: number; innerRadius: number; halfHeight: number;
  // cavity: radial < innerRadius AND |y - center.y| <= halfHeight is NOT solid
}

export class CompoundShape extends Shape {
  shapes: Shape[];
  add(shape: Shape): this;
}
```

### Distance semantics

`distanceToPoint` is the canonical SDF-style query:
- Returns `0` when the point is inside (or on) the shape.
- For `DiskShape` / `QuadShape` (zero thickness), returns the distance to
  the nearest in-surface point: the planar offset when the projection
  lands inside, or the 3-D distance to the edge when it lands outside.
- For `TubeShape`, uses the exact annulus-extruded SDF
  `max(|rad - midR| - thickness, |y - cy| - halfHeight)`.
- `CompoundShape` returns the minimum of its children's distances
  (`0` if `shapes` is empty).

---

## Usage

### Picking with `intersectRay`

```ts
import { BoxShape, SphereShape, Ray, Vector3 } from '@vreen/engine';

const box = new BoxShape(new Vector3(-1, 0, -1), new Vector3(1, 2, 1));
const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
const t = box.intersectRay(ray); // 3.0 — entry at top face (y = 2)
if (t !== null) {
  const hit = ray.at(t);
}
```

### ECS trigger volume

```ts
import { SphereShape, CompoundShape, BoxShape } from '@vreen/engine';
import { World, ComponentType } from '@vreen/engine';

// A trigger that fires when an entity enters the union of two zones.
const trigger = new CompoundShape([
  new SphereShape(new Vector3(0, 1, 0), 2),
  new BoxShape(new Vector3(8, 0, 8), new Vector3(12, 4, 12)),
]);

for (const eid of world.query(ComponentType.Transform)) {
  const pos = world.get(eid, ComponentType.Transform).position;
  if (trigger.containsPoint(pos)) {
    events.emit('enterZone', { entity: eid });
  }
}
```

### Vegetation shape filter

```ts
import { ShapeIntersectionFilter } from '@vreen/engine/vegetation';
import { CylinderShape } from '@vreen/engine/shapes';
import { Vector3 } from '@vreen/engine';

// Only spawn vegetation inside a cylindrical clearing.
const clearing = new CylinderShape(new Vector3(0, 0, 0), 10, 50);
const filter = new ShapeIntersectionFilter([clearing]);
```

### Closest-surface query

```ts
// Pick the nearest of several obstacles for AI steering.
const nearest = obstacles.reduce((best, obs) => {
  const d = obs.shape.distanceToPoint(agent.position);
  return d < best.d ? { d, obs } : best;
}, { d: Infinity, obs: null });
```

---

## Invariants

- **`intersectRay` returns `t >= 0` or `null`.** Hits behind the ray
  origin are never reported. When the origin is inside a volume, the
  exit `t` is returned (so the caller still gets a positive distance to
  the surface in the ray direction).
- **`containsPoint` is boundary-inclusive.** Points exactly on the
  surface return `true`; distance queries for such points return `0`.
- **`distanceToPoint` is non-negative.** It is `0` inside or on the
  surface and the Euclidean distance to the nearest surface point
  outside.
- **Y-axis alignment for capsules, cylinders, and tubes.** Their lateral
  surfaces are circles in the XZ plane; rotating them requires
  pre-transforming the query point into the shape's local frame.
- **`DiskShape` / `QuadShape` are zero-thickness.** `containsPoint`
  requires the point to lie in the plane (within a `1e-9` tolerance) and
  inside the radial/rectangular bounds; off-plane points are never
  contained.
- **`normal` is tolerant of zero.** `DiskShape` and `QuadShape` fall
  back to `(0, 1, 0)` when given a zero-length normal, both for the
  in-plane basis derivation and for ray/containment tests.
- **`clone` produces independent copies** for every concrete shape
  (vectors are cloned). The abstract `Shape.clone` returns `this`, so
  callers should always dispatch through a concrete instance.
- **`CompoundShape` with no children** returns an empty AABB (via
  `Box3` union default), `null` for `intersectRay`, `false` for
  `containsPoint`, and `0` for `distanceToPoint`.
- **Pure functions of fields.** No query mutates the shape; concurrent
  reads are safe. World-space composition is the caller's responsibility
  (translate `center`/`min`/`max`).

---

## Design Notes

**Why not reuse `Math/Box3` / `Math/Sphere` directly?** Those are value
objects: lightweight, immutable-in-spirit, and query-poor. A `Shape` is
a *component* — it carries a `type` tag for serialization, is meant to be
embedded in an entity, and exposes the four queries (ray, contain,
distance, AABB) that trigger/collision/picking systems need in one
contract. `getAabb()` returns `Math/Box3` instances, so the two layers
interoperate rather than duplicate.

**Why Y-axis alignment for the round solids?** Capsules, cylinders, and
tubes are overwhelmingly used as character colliders and vertical
triggers; axis alignment makes the ray and distance math closed-form
(no per-frame matrix inversion) and keeps the hot loops branch-light.
For arbitrarily-oriented volumes, transform the query point into the
shape's local frame, or compose a `CompoundShape` of axis-aligned
pieces.

**Why does `intersectRay` return the exit `t` when the origin is inside?**
For picking, the entry is what you want; for volume traversal
(slab-based culling, "is this ray escaping a trigger?"), the exit is the
useful value. Returning a non-null `t` in both cases keeps the caller's
null-check meaningful ("did the ray hit at all?") without a second API
for interior queries.

**Why an exact SDF for `TubeShape`?** The annulus-extruded SDF
`max(|rad - midR| - thickness, |y - cy| - halfHeight)` is cheap, exact,
and gives smooth gradients for AI steering and shader-based effects,
avoiding the per-piece min/disjunction that a compound-of-two-cylinders
approximation would require.

**Name collision with `Geometries/Shape`.** `Shapes/Shape` (abstract
volume) and `Geometries/Shape` (2-D path geometry for extrusion) share a
name. The top-level barrel resolves this by explicitly re-exporting
`Geometries/Shape` after `export * from './Shapes'`; sub-barrel imports
(`@vreen/engine/shapes` vs `@vreen/engine/geometries`) keep them
unambiguous.

---

## References

- o3de Gems/LmbrCentral/Shape — `ShapeComponent`,
  `BoxShapeComponent`, `SphereShapeComponent`, `CapsuleShapeComponent`,
  `CylinderShapeComponent`, `DiskShapeComponent`, `QuadShapeComponent`,
  `CompoundShapeComponent` design reference.
- `src/engine/Math/README.md` — `Box3`, `Sphere`, `Ray`, `Vector3`
  value objects consumed by every shape.
- `src/engine/Acceleration/README.md` — `MeshBVH` for accelerated
  ray-triangle tests against arbitrary geometry (vs the analytic shape
  tests here).
- `src/engine/Vegetation/README.md` — `ShapeIntersectionFilter` consumes
  `Shape.containsPoint`.
- Top-level barrel — `src/engine/index.ts` re-exports this module
  (resolving the `Shape` name collision with `Geometries`).
