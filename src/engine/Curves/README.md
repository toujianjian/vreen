# Curves Module

> Path: `src/engine/Curves/`
>
> The curve and 2D path subsystem of the `@vreen/engine` kernel. Provides
> spline and parametric curves (Line / Quadratic & Cubic Bezier /
> Catmull-Rom / Ellipse / Spline), composite `CurvePath` chains, a
> Canvas-style `Path` builder, hole-aware `Shape` contours, earcut-based
> triangulation via `ShapeUtils`, arc-length parameterization for
> uniform-speed sampling, and Frenet frame computation for tube / extrude
> geometry. Adapted from the three.js extras/curves library (MIT) with a
> typed generic base class and `Quaternion`-based frame propagation.

---

## Overview

```
Curve<TVector>            ← abstract base: getPoint / getPointAt / getLength /
   │                          getUtoTmapping / getTangent / computeFrenetFrames
   ├── CurvePath<TVector>  ← composite of N sub-curves chained head-to-tail
   │      └── Path         ← Canvas 2D style API (moveTo / lineTo / bezierCurveTo / arc)
   │              └── Shape ← Path + holes: Path[] for hollow 2D contours
   │
   └── (concrete leaf curves)
          ├── LineCurve3        ← straight segment in 3D
          ├── QuadraticBezierCurve3 ← 3 control points, 3D
          ├── CubicBezierCurve3  ← 4 control points, 3D
          ├── CatmullRomCurve3   ← N control points, 3D (centripetal / chordal / catmullrom)
          ├── EllipseCurve       ← 2D elliptical arc
          ├── SplineCurve        ← 2D Catmull-Rom spline
          ├── LineCurve          ← 2D straight segment
          ├── QuadraticBezierCurve ← 2D quadratic Bezier
          └── CubicBezierCurve   ← 2D cubic Bezier
```

Complementary utilities:
- `ShapeUtils` — polygon signed area, winding test, earcut
  triangulation of contours with holes.
- `Earcut` — the earcut triangulation engine (flat `number[]` in,
  triangle index list out).
- `Interpolations` — bare polynomial basis functions
  (`CatmullRom`, `QuadraticBezier`, `CubicBezier` and the per-point
  `*P0..P3` helpers) used by the concrete curve classes.

---

## Core Classes

### `Curve<TVector>` (`Curve.ts`)

Abstract generic base. `TVector` is constrained to `CurvePoint` — a
structural interface satisfied by both `Vector2` and `Vector3`, so
`Curve<Vector3>` and `Curve<Vector2>` are both instantiable without
runtime type tags.

```ts
export interface CurvePoint {
  x: number; y: number;
  copy(v: this): this; clone(): this;
  add(v: this): this; sub(v: this): this; subVectors(a: this, b: this): this;
  multiplyScalar(s: number): this; divideScalar(s: number): this;
  distanceTo(v: this): number; distanceToSquared(v: this): number;
  normalize(): this; equals(v: this): boolean; length(): number; dot(v: this): number;
}

export abstract class Curve<TVector extends CurvePoint = CurvePoint> {
  arcLengthDivisions = 200;
  abstract getPoint(t: number, optionalTarget?: TVector): TVector;
  getPointAt(u: number, optionalTarget?: TVector): TVector;   // arc-length param
  getPoints(divisions?: number): TVector[];                   // uniform in t
  getSpacedPoints(divisions?: number): TVector[];             // uniform in arc length
  getLength(): number;
  getLengths(divisions?: number): number[];                   // cached cumulative
  updateArcLengths(): void;
  getUtoTmapping(u: number, distance?: number): number;       // [0,1] → [0,1]
  getTangent(t: number, optionalTarget?: TVector): TVector;   // numerical, delta 1e-4
  getTangentAt(u: number, optionalTarget?: TVector): TVector;
  computeFrenetFrames(segments: number, closed: boolean): FrenetFrames;
  clone(): this; copy(source: this): this;
}
```

| Method | Role |
|--------|------|
| `getPoint(t)` | Parametric evaluation at `t∈[0,1]`. Subclasses must implement. |
| `getPointAt(u)` | Arc-length parameterized evaluation; maps `u` → `t` via `getUtoTmapping` then calls `getPoint`. |
| `getLength()` / `getLengths()` | Total / cumulative arc length, cached at `arcLengthDivisions` resolution. |
| `getUtoTmapping(u, distance?)` | Binary-search the arc-length LUT to invert `t→length`; linearly interpolates between segments. |
| `getTangent(t)` | Central difference (`delta = 0.0001`) normalized; subclasses may override analytically. |
| `computeFrenetFrames(segments, closed)` | Parallel-transport Frenet frames for tube / extrude geometry; returns `segments+1` tangents / normals / binormals. |

### `CurvePath<TVector>` (`CurvePath.ts`)

Composite curve — treats an ordered list of sub-curves as one logical
curve. Sub-curves are expected to chain head-to-tail; `getPoint(t)`
locates the sub-curve covering arc-length fraction `t` and delegates.

| Export | Role |
|--------|------|
| `add(curve)` | Append a sub-curve. |
| `closePath()` | If endpoints disagree, append a `LineCurve` / `LineCurve3` closing segment. |
| `getCurveLengths()` | Cumulative sub-curve lengths (cached). |
| `toGeometry(divisions)` | Sample `divisions+1` spaced points into a `BufferGeometry` position attribute (for `gl.LINE_STRIP`). |
| `autoClose` | When true, `getSpacedPoints` / `getPoints` append the first point to close the loop. |

### `Path` (`Path.ts`)

`CurvePath<Vector2>` with a Canvas 2D style imperative API. Each command
appends a sub-curve to `this.curves` and advances `currentPoint`.

| Method | Sub-curve pushed |
|--------|------------------|
| `moveTo(x, y)` | none (repositions pen) |
| `lineTo(x, y)` | `LineCurve` |
| `quadraticCurveTo(cpx, cpy, x, y)` | `QuadraticBezierCurve` |
| `bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)` | `CubicBezierCurve` |
| `splineThru(pts)` | `SplineCurve` (passes through `currentPoint` + `pts`) |
| `arc / absarc / ellipse / absellipse` | `EllipseCurve`; `absellipse` auto-`lineTo`s the arc start if it differs from `currentPoint` |

### `Shape` (`Shape.ts`)

`Path` extended with `holes: Path[]`. `extractPoints(divisions)` returns
the sampled outer contour plus each sampled hole — the input format
expected by `ShapeUtils.triangulateShape`.

```ts
export interface ExtractPointsResult {
  shape: Vector2[];
  holes: Vector2[][];
}
```

### Concrete Curves

| Export | Dimension | Role |
|--------|-----------|------|
| `LineCurve3` | 3D | Linear interpolation `p0 → p1`. Analytic tangent. |
| `QuadraticBezierCurve3` | 3D | Quadratic Bezier (3 control points). |
| `CubicBezierCurve3` | 3D | Cubic Bezier (4 control points). |
| `CatmullRomCurve3` | 3D | N-point Catmull-Rom spline; `curveType: 'centripetal' \| 'chordal' \| 'catmullrom'`; optional `closed`. |
| `LineCurve` | 2D | Linear segment. |
| `QuadraticBezierCurve` | 2D | Quadratic Bezier. |
| `CubicBezierCurve` | 2D | Cubic Bezier. |
| `SplineCurve` | 2D | Catmull-Rom spline through N points. |
| `EllipseCurve` | 2D | Elliptical arc with optional rotation; basis for `Path.arc` / `ellipse`. |

### `CatmullRomCurve3` parameterization

| `curveType` | Exponent | Behaviour |
|-------------|----------|-----------|
| `'centripetal'` (default) | 0.25 | No cusps / self-intersections; safest general choice. |
| `'chordal'` | 0.5 | Faster parameterization; can overshoot on uneven spacing. |
| `'catmullrom'` | — | Uniform; uses `tension` (default 0.5). |

### `ShapeUtils` (`ShapeUtils.ts`)

| Static method | Role |
|---------------|------|
| `area(contour)` | Signed polygon area (`>0` = CCW, `<0` = CW). |
| `isClockWise(pts)` | `area(pts) < 0`. |
| `triangulateShape(contour, holes)` | Earcut triangulation; returns `number[][]` of `[a, b, c]` vertex indices into the flattened `contour + holes` array. |

---

## Usage

### 1. Sample a Catmull-Rom spline

```ts
import { CatmullRomCurve3 } from '@vreen/engine/curves';
import { Vector3 } from '@vreen/engine/math';

const spline = new CatmullRomCurve3([
  new Vector3(0, 0, 0),
  new Vector3(1, 1, 0),
  new Vector3(2, 0, 1),
  new Vector3(3, 1, 0),
], /* closed */ false, /* type */ 'centripetal');

// 21 uniformly-spaced-in-t points (NOT arc-length uniform)
const polyline = spline.getPoints(20);

// 21 arc-length-uniform points — constant speed along the curve
const spaced = spline.getSpacedPoints(20);

// Evaluate at half the curve's arc length
const mid = spline.getPointAt(0.5);
```

### 2. Build a 2D Path and triangulate it with ShapeUtils

```ts
import { Shape, ShapeUtils } from '@vreen/engine/curves';
import { Vector2 } from '@vreen/engine/math';

// Outer contour: rounded rectangle
const shape = new Shape();
shape.moveTo(-1, -0.5);
shape.lineTo( 1, -0.5);
shape.lineTo( 1,  0.5);
shape.lineTo(-1,  0.5);
shape.lineTo(-1, -0.5);

// Hole: small square inside
const hole = new Shape();
hole.moveTo(-0.2, -0.2);
hole.lineTo( 0.2, -0.2);
hole.lineTo( 0.2,  0.2);
hole.lineTo(-0.2,  0.2);
hole.lineTo(-0.2, -0.2);
shape.holes.push(hole);

const { shape: outer, holes } = shape.extractPoints(12);
const faces = ShapeUtils.triangulateShape(outer, holes);
// faces: number[][] of [a, b, c] indices into outer.concat(...holes)
```

### 3. Arc-length parameterization with `getUtoTmapping`

```ts
import { CatmullRomCurve3 } from '@vreen/engine/curves';

const curve = new CatmullRomCurve3(/* ...control points... */);

// Move an entity along the curve at constant world speed.
// 'u' is arc-length fraction in [0,1]; getUtoTmapping converts it to
// the parametric 't' the curve actually evaluates.
function sampleAtDistance(distance: number): Vector3 {
  const total = curve.getLength();
  const u = distance / total;                 // [0,1] arc-length fraction
  const t = curve.getUtoTmapping(u);          // → parametric t
  return curve.getPoint(t);                   // point at that distance
}

// Equivalently, getPointAt does both steps:
function sampleAtDistance2(distance: number): Vector3 {
  return curve.getPointAt(distance / curve.getLength());
}

// Frenet frames for a tube geometry along the curve (segments+1 frames)
const frames = curve.computeFrenetFrames(64, /* closed */ false);
// frames.tangents.length  === 65
// frames.normals.length   === 65
// frames.binormals.length === 65
```

---

## Invariants

- **Endpoints:** For a non-closed curve, `getPoint(0)` returns the start
  and `getPoint(1)` returns the end. For a closed `CatmullRomCurve3`,
  `getPoint(1)` wraps back to `getPoint(0)` of the next period.
- **Arc-length mapping monotonicity:** `getUtoTmapping(u)` is monotonically
  non-decreasing on `u ∈ [0,1]`, with `getUtoTmapping(0) === 0` and
  `getUtoTmapping(1) === 1` (modulo floating-point error at the LUT
  boundary). It is the inverse of the cumulative-arc-length function
  sampled at `arcLengthDivisions` resolution.
- **Frenet frame count:** `computeFrenetFrames(segments, closed)` always
  returns three arrays each of length `segments + 1`. For `closed === true`
  the first and last frames are coerced toward consistency by spreading a
  residual rotation `theta / segments` across all frames.
- **Tangent continuity:** `getTangent` uses central differences clamped
  at the endpoints (`t1 = max(0, t - 1e-4)`, `t2 = min(1, t + 1e-4)`); at
  the exact endpoints it degenerates to a one-sided difference, so the
  tangent is still well-defined.
- **Cache invalidation:** The arc-length LUT is rebuilt only when
  `needsUpdate` is set. Mutating a curve's control points does NOT
  automatically invalidate the cache — callers must invoke
  `updateArcLengths()` after mutation. `CurvePath` overrides this to also
  clear its `cacheLengths`.
- **Triangulation index space:** `ShapeUtils.triangulateShape` returns
  indices into the concatenation `[contour, ...holes]` (after removing a
  duplicated closing vertex from each ring). Holes are flattened in array
  order; callers must build their vertex buffer in the same order.
- **2D / 3D dispatch in `CurvePath.closePath`:** The closing segment type
  is chosen by `instanceof Vector2` on the endpoint. Mixing 2D and 3D
  sub-curves in one `CurvePath` is unsupported.

---

## References

- Source files:
  - `src/engine/Curves/Curve.ts` — abstract base class, arc-length LUT,
    Frenet frames.
  - `src/engine/Curves/CurvePath.ts` — composite curve + `toGeometry`.
  - `src/engine/Curves/Path.ts` — Canvas 2D style path builder.
  - `src/engine/Curves/Shape.ts` — hole-aware 2D shape.
  - `src/engine/Curves/ShapeUtils.ts` — area / winding / earcut
    triangulation entry point.
  - `src/engine/Curves/Earcut.ts` — earcut triangulation engine.
  - `src/engine/Curves/CatmullRomCurve3.ts` — 3D Catmull-Rom spline
    (centripetal / chordal / catmullrom).
  - `src/engine/Curves/LineCurve.ts`, `LineCurve3.ts`,
    `QuadraticBezierCurve.ts`, `QuadraticBezierCurve3.ts`,
    `CubicBezierCurve.ts`, `CubicBezierCurve3.ts`, `SplineCurve.ts`,
    `EllipseCurve.ts` — concrete leaf curves.
  - `src/engine/Curves/Interpolations.ts` — polynomial basis functions.
  - `src/engine/Curves/index.ts` — barrel re-exports.
- Algorithm references:
  - Frenet frame parallel-transport:
    http://www.cs.indiana.edu/pub/techreports/TR425.pdf
  - Catmull-Rom parameterization (centripetal vs chordal):
    http://www.cemyuksel.com/research/catmullrom_param/catmullrom.pdf
  - Earcut triangulation: https://github.com/mapbox/earcut
- Upstream: three.js `src/extras/core/Curve.js`, `CurvePath.js`,
  `Path.js`, `Shape.js`, `ShapeUtils.js`, `Earcut.js` and
  `src/extras/curves/*` (MIT). VREEN's port adds a generic
  `TVector extends CurvePoint` type parameter, replaces three.js's
  `Matrix4.makeRotationAxis` (unimplemented on VREEN's `Matrix4`) with
  `Quaternion.setFromAxisAngle` + `applyQuaternion` in
  `computeFrenetFrames`, and drops the runtime `isVector2` /
  `isVector3` guards in favour of the structural `CurvePoint` interface.
