# Math Module

> Path: `src/engine/Math/`
>
> The math library of the `@vreen/engine` kernel. Provides vectors
> (`Vector2/3/4`), matrices (`Matrix3/4`), rotations (`Quaternion` /
> `Euler`), geometric primitives (`Box3` / `Sphere` / `Plane` / `Ray` /
> `Line3` / `Triangle` / `Frustum` / `OBB`), `Color`, and a `MathUtils` toolbox.
> Naming and semantics align with the three.js `THREE` namespace to ease
> cross-engine bridging.

---

## Overview

```
Vectors         Matrix4 ─compose→ Quaternion ─→ Euler
Vector2/3/4 ────┤         │
                ├─multiply→ Vector3 (transform)
                └─project → Frustum (clip space)

Geometric primitives (collision / bounds):
   Box3 ─intersects── Sphere ─intersects── Plane
    │                  │                    │
    └─contains──────── Ray ─intersects── Triangle / Line3
   OBB ─SAT── OBB ─intersects── Sphere / Box3 / Ray / Plane

Color ──converts── HSL / RGB / hex
Tonemapping ──ACES/Reinhard/Hable── LDR + sRGB/ACEScg color space
Noise ──ImprovedNoise (Perlin) / SimplexNoise ── fBm / procedural
Spherical / Cylindrical ── coordinate conversion
MathUtils ──helpers── clamp / lerp / degToRad / randInt / smoothstep
```

The library is intentionally stateless: every method either mutates
`this` (returning `this` for chaining) or returns a new value, with no
hidden allocations beyond temporaries. All classes are safe to share
across threads via structured clone of their numeric fields.

---

## Core Classes

### Vectors

| Export | Role |
|--------|------|
| `Vector2` | 2-D vector (`x`, `y`). `set` / `add` / `sub` / `multiplyScalar` / `dot` / `length` / `normalize` / `lerp` / `rotateAround`. |
| `Vector3` | 3-D vector. Adds `cross` / `applyMatrix4` / `applyQuaternion` / `project` / `unproject` / `distanceTo` / `angleTo`. |
| `Vector4` | 4-D vector. Used for homogeneous coordinates and plane equations. |

Mutating methods return `this` for chaining; pure queries (`dot`,
`length`, `distanceTo`, `angleTo`) return numbers.

### Matrices

| Export | Role |
|--------|------|
| `Matrix2` | 2×2 matrix (column-major `elements`). `set` / `identity` / `multiply` / `multiplyMatrices` / `premultiply` / `transpose` / `invert` / `determinant` / `makeRotation` / `makeScale` / `applyToVector`. |
| `Matrix3` | 3×3 matrix (column-major `elements`). `set` / `identity` / `multiply` / `transpose` / `invert` / `getNormalMatrix`. |
| `Matrix4` | 4×4 matrix. `makeTranslation` / `makeRotationX/Y/Z` / `makeScale` / `multiply` / `invert` / `compose(position, quaternion, scale)` / `decompose` / `makePerspective` / `makeOrthographic`. |

```ts
const m = new Matrix4().compose(position, quaternion, scale);
const normalMatrix = new Matrix3().getNormalMatrix(m);
```

### `Matrix2` — 2×2 matrix (`Matrix2.ts`)

Minimal square matrix for 2-D linear algebra — the dimensional peer of
`Matrix3`/`Matrix4`. Like the larger matrices it stores four elements in
column-major order in `elements` while the constructor and `set()` accept
row-major arguments for ergonomic reading: `m.set(11,12, 21,22)` produces
`elements = [11,21, 12,22]`. Adapted from three.js r169
`src/math/Matrix2.js`.

**Beyond three.js `Matrix2`.** The upstream three.js `Matrix2` (r169) ships a
deliberately minimal surface — only the constructor, `set`, `identity` and
`fromArray` (plus the `isMatrix2` flag). It lacks every linear-algebra
operation a 2×2 matrix is actually used for: no `copy`/`clone`, no
`multiply`/`premultiply`/`multiplyMatrices`, no `determinant`, no `invert`,
no `transpose`, no 2-D rotation/scale builders, and no way to apply the
matrix to a vector. VREEN's `Matrix2` fills this surface following the
`Matrix3` method contract, so the class is directly usable for 2-D
transforms, texture UV manipulation, and small-matrix maths without round-
tripping through `Matrix3`.

| Method | Behaviour |
|--------|-----------|
| `set(n11,n12, n21,n22)` | row-major input → column-major store; returns `this` |
| `identity()` / `copy()` / `clone()` | structural |
| `multiply(m)` | post-multiply `this = this * m` |
| `premultiply(m)` | pre-multiply `this = m * this` |
| `multiplyMatrices(a,b)` | `this = a * b` (standard column-major product) |
| `multiplyScalar(s)` | in-place element-wise scale |
| `determinant()` | `n11*n22 - n12*n21` |
| `invert()` | in-place 2×2 inverse; singular (`det=0`) zeroes out, mirroring `Matrix3.invert` |
| `transpose()` / `transposeIntoArray(r)` | swap the off-diagonal pair (`te[1]↔te[2]`) |
| `makeRotation(θ)` | CCW rotation matrix `[[c,-s],[s,c]]` (linear, no translation) |
| `makeScale(x,y)` | diagonal scale matrix |
| `scale(sx,sy)` / `rotate(θ)` | `premultiply(makeScale)` / `premultiply(makeRotation(-θ))` |
| `translate(tx,ty)` | **throws** — a 2×2 *linear* matrix cannot represent translation; use `Matrix3` (affine) instead |
| `applyToVector(v)` | in-place `v = this * v` on a `Vector2` |
| `fromArray` / `toArray` / `equals` | structural, matching `Matrix3` |

**Orthogonality.** `makeRotation` yields an orthogonal matrix, so `invert()`
equals `transpose()` and `determinant()` is `1` (orientation-preserving) —
verified by the unit tests via the round-trip `rotate(+θ)` then `invert()`
and the `m * inv(m) = identity` checks.

**Why a 2×2 at all?** 2-D linear transforms (rotation/scale/shear of a
`Vector2`, or orientation sub-block of a larger affine transform) are
commonplace in texture/SDF math, 2-D physics and UV tools and do not need
the 9/16 elements of `Matrix3`/`Matrix4`. A dedicated `Matrix2` keeps the
hot path allocation-free and the intent obvious.

**Comparison to soup3D** — soup3D has no dedicated 2-D matrix type; 2-D
operations in soup3D must be funnelled through generic 4-D matrices by
hand. VREEN's `Matrix2` provides a complete, allocation-light, three.js-
aligned 2×2 linear-algebra type that three.js itself leaves unfinished, so
imported/engine-internal 2-D maths has first-class support.

### Rotations

| Export | Role |
|--------|------|
| `Quaternion` | Unit quaternion (`x`, `y`, `z`, `w`). `setFromEuler` / `setFromAxisAngle` / `multiply` / `slerp` / `angleTo` / `normalize`. Standard multiplication order with result normalisation. |
| `Euler` | Euler angles (`x`, `y`, `z`, `order: EulerOrder`). Orders: `'XYZ'` / `'YZX'` / `'ZXY'` / `'XZY'` / `'YXZ'` / `'ZYX'`. |

```ts
type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';
```

### Geometric Primitives

| Export | Role |
|--------|------|
| `Box3` | Axis-aligned bounding box (`min`, `max`). `setFromObject` / `setFromPoints` / `union` / `intersect` / `expandByPoint` / `containsPoint` / `intersectsBox` / `intersectsSphere` / `applyMatrix4`. |
| `Sphere` | Bounding sphere (`center`, `radius`). `setFromPoints` / `union` / `intersectsSphere` / `intersectsBox` / `intersectsPlane` / `applyMatrix4`. |
| `Plane` | Plane (`normal`, `constant`). `setFromNormalAndCoplanarPoint` / `normalize` / `distanceToPoint` / `intersectLine` / `intersectsBox` / `intersectsSphere` / `applyMatrix4`. |
| `Ray` | Origin + direction. `at` / `distanceToPoint` / `distanceSqToPoint` / `distanceSqToSegment` / `intersectSphere` / `intersectBox` / `intersectTriangle` / `intersectPlane` / `applyMatrix4`. |
| `Line3` | Two endpoints. `at` / `delta` / `distance` / `closestPointToPoint` / `applyMatrix4`. |
| `Triangle` | Three vertices. `area` / `normal` / `barycoordFromPoint` / `containsPoint` / `intersectsRay`. |
| `Frustum` | Six planes. `setFromProjectionMatrix` / `containsPoint` / `intersectsBox` / `intersectsSphere`. Used by `FrustumCuller`. |
| `OBB` | Oriented bounding box (`center` / `halfSize` / `rotation: Matrix3`). `fromBox3` / `computeBoundingBox` / `containsPoint` / `containsBox` / `intersectsSphere` / `intersectsBox3` / `intersectsPlane` / `intersectsRay` / `intersectsOBB` (SAT 15-axis) / `applyMatrix4` / `translate`. Tighter fit than `Box3` for rotated objects. |
| `ConvexHull` | Standalone convex hull (`ConvexHull.compute(points)`). Incremental QuickHull with horizon-edge detection + outward normals. `ConvexHull.volume(result)` / `ConvexHull.surfaceArea(result)`. Returns structured `{ faces, vertexIndices, vertices }`; consumed by collision, shadow, and LOD pipelines. |
| `ImprovedNoise` | Ken Perlin 2002 improved noise. `noise(x,y,z)` / `noise2D` / `noise1D` / `fbm(x,y,z, octaves?, persistence?, lacunarity?)` / `fbm2D`. Fade `6t⁵-15t⁴+10t³` for C² continuity. |
| `SimplexNoise` | Stefan Gustavson simplex noise. `noise2D` / `noise3D` / `noise4D` / `fbm2D` / `fbm3D`. Skew grid + radial falloff `(0.5-x²-y²-z²)⁴`; no Perlin axis-aligned artifacts, lower cost. |

### `OBB` — Oriented Bounding Box (`OBB.ts`)

Unlike the axis-aligned `Box3`, an `OBB`'s three axes may be arbitrarily
rotated via a `Matrix3`. This produces a tighter fit for tilted objects
(fallen pillars, rotating vehicles), reducing false culls and collision
false positives.

**Representation**:

| Field | Type | Description |
|-------|------|-------------|
| `center` | `Vector3` | Box center (world space). |
| `halfSize` | `Vector3` | Half-extents (x=half-width, y=half-height, z=half-depth); each component ≥ 0. |
| `rotation` | `Matrix3` | 3×3 orthogonal matrix whose columns are the box's three local axes (right / up / forward). Identity = axis-aligned. |

**API**:

| Method | Description |
|--------|-------------|
| `set(center, halfSize, rotation)` | Set all fields (chainable). |
| `copy(obb)` / `clone()` | Deep copy. |
| `getSize(target)` | Full size (non-half) into target. |
| `computeBoundingBox(target)` | AABB of the 8 corners into `Box3`. |
| `fromBox3(box)` | Build OBB from AABB (rotation = identity). |
| `isEmpty()` | True if any half-extent ≤ 0. |
| `containsPoint(point)` | Transform point to local space, check `|p'.i| ≤ hs.i`. |
| `containsBox(obb)` | All 8 corners of other OBB inside this one. |
| `intersectsSphere(sphere)` | Closest-point test in local space. |
| `intersectsBox3(box)` | Delegates to `intersectsOBB` (treats AABB as OBB with identity rotation). |
| `intersectsPlane(plane)` | Effective radius `Σ hs.i · |col_i · normal|` vs centre distance. |
| `intersectsRay(ray, target?)` | Slab method in local space; returns `t ≥ 0` or `null`. |
| `intersectsOBB(obb, epsilon?)` | SAT — 15 candidate axes (3 A face normals + 3 B face normals + 9 cross products). |
| `applyMatrix4(matrix)` | Apply 4×4 transform: centre ← full 4×4, rotation ← upper-left 3×3, halfSize ← column-length scale. |
| `translate(offset)` | Add offset to centre. |
| `equals(obb)` | Value equality. |

**Key algorithm — OBB-OBB SAT (Separating Axis Theorem)**:

For two OBBs A and B, test 15 candidate separating axes:
1. A's 3 face normals (rotation columns).
2. B's 3 face normals.
3. 9 cross products `a_i × b_j`.

For each axis, project both boxes' extents and the centre-to-centre
vector; if the projection intervals do not overlap on any axis, the
boxes do not intersect. This is O(15) per test and is the standard
real-time algorithm (Ericson, *Real-Time Collision Detection* §4.4.4).

```ts
const obb = new OBB(
  new Vector3(0, 0, 0),
  new Vector3(1, 2, 0.5),
  new Matrix3().setFromQuaternion(quaternion),
);
obb.intersectsSphere(sphere);
obb.intersectsOBB(otherOBB);
const aabb = obb.computeBoundingBox(new Box3());
```

### Color

| Export | Role |
|--------|------|
| `Color` | RGB (`r`, `g`, `b` in 0..1). `setHex` / `setRGB` / `setHSL` / `getHSL` / `convertSRGBToLinear` / `convertLinearToSRGB` / `lerp` / `copy`. |
| `HSL` (type) | `{ h: number; s: number; l: number }` returned by `getHSL`. |

### Tonemapping (`Tonemapping.ts`)

HDR → LDR tone-mapping operators + colour space conversion (CPU-side pure
functions). Adapted from three.js `tonemapping_pars_fragment.glsl.js`. Each
operator has a **scalar** version (for luminance / single-channel) and a
**colour** version (per-channel `RGBColor`). Constants are identical to the
GLSL implementation, ensuring CPU preview / offline baking / tests match
GPU rendering numerically.

#### Operators

| `TonemappingOperator` | Formula | Reference |
|-----------------------|---------|-----------|
| `'Linear'` | `clamp₀₁(x)` | Pass-through (no mapping) |
| `'Reinhard'` | `x / (x + 1)` | Reinhard 2002 |
| `'ReinhardExtended'` | `x·(1 + x/Lw²) / (1 + x)` | Reinhard with white point `Lw` (default 11.2) |
| `'ACESFilmic'` | `(x·(2.51x+0.03)) / (x·(2.43x+0.59)+0.14)` | Narkowicz 2015 ACES approximation |
| `'Filmic'` | Hable Uncharted2 curve + exposure bias (2.0) + white scale | Hable 2010 (Uncharted 2) |

#### Scalar functions

| Function | Description |
|----------|-------------|
| `acesFilmicScalar(x)` | ACES Filmic (Narkowicz), `a=2.51 b=0.03 c=2.43 d=0.59 e=0.14` |
| `reinhardScalar(x)` | `x/(x+1)` |
| `reinhardExtendedScalar(x, Lw)` | White-point Reinhard, `Lw` = white luminance |
| `hableCurve(x)` | Raw Hable Uncharted2 curve (pre-normalisation) |
| `filmicScalar(x, exposureBias?)` | Hable + exposure bias + white-scale normalisation |

#### Colour application

| Function | Description |
|----------|-------------|
| `applyTonemapping(color, mode, opts?)` | Apply operator per-channel to `RGBColor`; output clamped to [0,1] |
| `applyExposure(color, stops)` | `color *= 2^stops` (EV stops) |
| `luminance(color, weights?)` | Rec.709 luminance `0.2126R + 0.7152G + 0.0722B` |
| `middleGrayOutput(mode, opts?)` | 18% grey calibration — returns `applyTonemapping({0.18,0.18,0.18}, mode).r` |

#### Colour space conversion

| Function | Description |
|----------|-------------|
| `linearToSRGB(x)` / `sRGBToLinear(x)` | Precise IEC 61966-2-1 transfer function |
| `linearToSRGBGamma(x)` / `sRGBGammaToLinear(x)` | γ 2.2 fast approximation |
| `linearToSRGBColor(c)` / `sRGBToLinearColor(c)` | Per-channel RGB versions |
| `linearSRGBToACEScg(c)` / `acescgToLinearSRGB(c)` | 3×3 AP1 primaries matrix (ampas/aces-dev IDT); inverse computed from forward to guarantee round-trip ≈ 0 error |

#### `ColorManagement` — linear workflow

Three.js-style static colour management. When `enabled = true` (default),
all input colours are auto-converted to the working space; output is
converted back to display sRGB.

| Static field | Default | Description |
|--------------|---------|-------------|
| `enabled` | `true` | Auto-convert input/output colours |
| `workingSpace` | `'sRGB-linear'` | Working space (`'sRGB-linear'` or `'ACEScg'`) |

| Method | Description |
|--------|-------------|
| `fromSRGB(c)` | sRGB display → working space (linear or ACEScg) |
| `toSRGB(c)` | Working space → sRGB display |
| `setWorkingSpace(space)` | Switch working space |
| `setEnabled(bool)` | Enable / disable |

```ts
import { applyTonemapping, ColorManagement, linearToSRGBColor } from '@vreen/engine/math';

ColorManagement.setWorkingSpace('ACEScg');
const hdrColor = { r: 2.5, g: 1.8, b: 0.9 };
const ldr = applyTonemapping(hdrColor, 'ACESFilmic');
const display = linearToSRGBColor(ldr);  // → sRGB for screen output
```

### Spherical / Cylindrical (`Spherical.ts` / `Cylindrical.ts`)

Coordinate conversion utilities for camera orbit controls and polar
parameterisation.

| Export | Fields | Key Methods |
|--------|--------|-------------|
| `Spherical` | `radius`, `phi` (polar from +Y), `theta` (azimuthal from +Z) | `setFromVector3(v)` / `setFromCartesianCoords(x,y,z)` / `makeSafe()` (clamps `phi` to `[ε, π−ε]`) / `applyToVector3(target)` |
| `Cylindrical` | `radius`, `theta` (azimuthal), `y` (height) | `setFromVector3(v)` / `setFromCartesianCoords(x,y,z)` / `applyToVector3(target)` |

### Interpolants (`Interpolant.ts` + `interpolants/`)

Parametric-sample interpolants — the core substrate for keyframe animation
tracks (`KeyframeTrack`, planned). Given a 1-D parameter sequence (typically
time or arc length) and a multi-dimensional sample-value sequence, evaluate a
smooth result at an arbitrary parameter position `t`, writing into a reused
result buffer. Adapted from three.js r169 `src/math/Interpolant.js` and its
five `interpolants/` subclasses.

The base class implements the **interval seek** (Template Method): locate which
two samples `t` falls between, maintaining a cached index so sequential access
is amortised **O(1)** while random access degrades gracefully to
**O(log N)** via a binary-search fallback. Subclasses override
`interpolate_(i1, t0, t, t1)` for the actual blend and optionally
`intervalChanged_` for per-interval precomputation (used by the cubic spline).

| Export | Strategy | Boundary / Polynomial |
|--------|----------|-----------------------|
| `Interpolant` | abstract base | cached-index seek + linear/binary scan |
| `DiscreteInterpolant` | step (hold previous key) | no blending — returns left endpoint |
| `LinearInterpolant` | linear (lerp) | `C⁰`, constant velocity |
| `CubicInterpolant` | cubic Hermite spline | `C¹`, velocity = chord slope between neighbours; endpoint ending policies `ZeroCurvatureEnding` / `ZeroSlopeEnding` / `WrapAroundEnding` |
| `QuaternionLinearInterpolant` | spherical-linear (slerp) | per-4-tuple via `Quaternion.slerpFlat`, keeps unit length (rigid rotation) |
| `BezierInterpolant` | cubic Bézier with explicit in/out tangents | COLLADA/Maya keyframe style; falls back to linear when tangents absent |

**Constants** (values aligned with three.js `constants.js` for serialisation
compatibility): `InterpolateDiscrete` 2300, `InterpolateLinear` 2301,
`InterpolateSmooth` 2302; `ZeroCurvatureEnding` 2400 (natural spline,
`f''=0`), `ZeroSlopeEnding` 2401 (`f'=0`), `WrapAroundEnding` 2402 (wrap to
the other end).

**`Quaternion.slerpFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t)`**
— flat-array slerp (`QuaternionLinearInterpolant` consumes it). Writes the
interpolated unit quaternion directly into a `Float32Array`/`number[]` buffer
at `dstOffset`, reading from two source buffers at `srcOffset0`/`srcOffset1`;
supports aliasing (`src0 === src1`), picks the shorter arc, and degenerates to
normalised linear for near-parallel inputs — no `Quaternion` instance needed,
zero allocation per evaluation. See `Quaternion.ts`.

**Comparison to soup3D** — soup3D has only a naïve state-machine-driven bone
animation mixer; it has no parametric interpolant layer, no continuous cubic
spline or Bézier keyframes, and no flat-buffer quaternion slerp. VREEN's
Interpolant family is the foundation for asset-imported animation curves (GLB
`animation.samplers` map directly to these interpolants by
`INTERPOLATION` = `STEP`/`LINEAR`/`CUBICSPLINE`), giving smooth, artist-faithful
animation with O(1) sequential evaluation.

**Invariants:**

- `parameterPositions` must be **monotonically non-decreasing** (the seek
  assumes forward order); out-of-order input undefined behaviour.
- `valueSize` must be a **positive divisor** of `sampleValues.length` and (for
  `QuaternionLinearInterpolant`) a multiple of 4.
- `BezierInterpolant.inTangents`/`outTangents`, when provided, must have length
  `N * valueSize * 2` (`N` keyframes, `2` = `(time, value)` per control point,
  per component). Missing tangent data degrades safely to linear.
- `CubicInterpolant` reads `settings.endingStart`/`endingEnd` only at the
  first/last segment where the neighbouring sample is absent; interior
  segments always use real neighbours.

### ConvexHull (`ConvexHull.ts`)

Standalone convex hull computation via incremental QuickHull with
horizon-edge detection and outward-facing normals. Adapted from three.js
`ConvexHull.js`. Returns structured face data consumed by collision,
shadow, and LOD pipelines.

| Static method | Returns | Description |
|---------------|---------|-------------|
| `ConvexHull.compute(points: Vector3[])` | `ConvexHullResult` | Build hull from point cloud |
| `ConvexHull.volume(result)` | `number` | Enclosed volume |
| `ConvexHull.surfaceArea(result)` | `number` | Total surface area |

`ConvexHullResult = { faces: ConvexHullFace[], vertexIndices: number[][], vertices: Vector3[] }`
where each `ConvexHullFace = { normal: Vector3, point: Vector3, indices: number[] }`.

### Noise (`ImprovedNoise.ts` / `SimplexNoise.ts`)

Procedural noise primitives for terrain, textures, and volumetric effects.

| Export | Algorithm | Key Methods | Artifacts |
|--------|-----------|-------------|-----------|
| `ImprovedNoise` | Ken Perlin 2002 improved noise (3D) | `noise(x,y,z)` / `noise2D(x,y)` / `noise1D(x)` / `fbm(x,y,z, octaves?, persistence?, lacunarity?)` / `fbm2D(x,y, ...)` | Fade `6t⁵−15t⁴+10t³` (C² continuous); axis-aligned grid artifacts at large scales |
| `SimplexNoise` | Stefan Gustavson simplex (2D/3D/4D) | `noise2D(x,y)` / `noise3D(x,y,z)` / `noise4D(x,y,z,w)` / `fbm2D` / `fbm3D` | Skew grid + radial falloff `(0.5−x²−y²−z²)⁴`; no axis-aligned artifacts; lower computational cost |

**fBm (Fractal Brownian Motion)**: sums `octaves` noise layers with
`persistence` amplitude decay and `lacunarity` frequency growth. Defaults:
`octaves=4`, `persistence=0.5`, `lacunarity=2.0`.

```ts
import { SimplexNoise } from '@vreen/engine/math';
const n = new SimplexNoise();
const height = n.fbm2D(x * 0.01, z * 0.01, 6, 0.5, 2.0);  // 6-octave terrain
```

### Utilities

| Export | Role |
|--------|------|
| `MathUtils` | Namespace with `clamp` / `lerp` / `degToRad` / `radToDeg` / `randInt` / `randFloat` / `smoothstep` / `smootherstep` / `pingpong` / `euclideanModulo` / `generateUUID`. |
| `DataUtils` | Half-float (FP16 ↔ FP32) codec: `toHalfFloat(val)` / `fromHalfFloat(val)` + static `DataUtils` class. Lookup-table IEEE 754 binary16 conversion (Fast Half Float Conversions); module-scope 12 KB tables built once. |

```ts
import { MathUtils, DataUtils } from '@vreen/engine/math';
const id = MathUtils.generateUUID();        // RFC4122 v4 string
const t = MathUtils.clamp(x, 0, 1);
const h = DataUtils.toHalfFloat(1.5);        // 0x3e00 — pack to Uint16Array
const f = DataUtils.fromHalfFloat(0x3e00);  // 1.5  — readback FP32
```

```
FP16 encoding surface (disjoint by exponent band):
  | band (FP32 exp)        | result class            | example
  | e < -27                | ±0                      | tiny → 0x0000 / 0x8000
  | -27 ≤ e < -14          | denormalized            | 2^-24 .. 2^-15
  | -14 ≤ e ≤ 15           | normal (11-bit mantissa)| 1.0 → 0x3c00
  | 15 < e < 128           | ±Infinity               | 0x7c00 / 0xfc00
  | e ≥ 128 (NaN)          | NaN                     | 0x7e00-ish

fromHalfFloat restores 0/-0/Inf/NaN/denorm/normal exactly.
toHalfFloat clamps |val| > 65504 to ±65504 (warn) — Infinity → max representable.
```

---

## Usage Example

```ts
import {
  Vector3, Matrix4, Matrix3, Quaternion, Euler, Box3, Sphere, Ray,
  Frustum, OBB, Color, MathUtils,
} from '@vreen/engine/math';

// Transform composition
const pos = new Vector3(0, 1, 0);
const rot = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
const scl = new Vector3(1, 1, 1);
const model = new Matrix4().compose(pos, rot, scl);

// Apply to a point
const worldPoint = new Vector3(1, 0, 0).applyMatrix4(model);

// Slerp between rotations
const a = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0);
const b = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const mid = a.clone().slerp(b, 0.5);

// Bounds + culling
const box = new Box3().setFromObject(mesh);
const sphere = new Sphere().setFromPoints([v1, v2, v3]);
const frustum = new Frustum().setFromProjectionMatrix(
  camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse),
);
const visible = frustum.intersectBox(box);

// Ray picking
const ray = new Ray(origin, direction);
const hit = ray.intersectSphere(sphere, new Vector3());

// Oriented bounding box (tighter fit for rotated objects)
const obb = new OBB().fromBox3(box);
obb.applyMatrix4(model);          // transform to world space
const hitsOBB = obb.intersectsRay(ray);
const hitsOther = obb.intersectsOBB(otherOBB);

// Color
const base = new Color().setHSL(0.6, 0.8, 0.5);
const linear = base.clone().convertSRGBToLinear();
```

---

## Invariants

- **Column-major storage.** `Matrix3` / `Matrix4` store elements in
  column-major order matching WebGL `uniformMatrix*fv` uploads. Direct
  index access must respect this layout.
- **Quaternion normalisation.** `Quaternion.multiply` normalises the
  result; non-normalised quaternions produce scaled rotations. After
  long chains of `setFromAxisAngle` + `slerp`, callers may still
  `normalize()` defensively.
- **Euler order matters.** `Euler.order` changes the rotation result for
  the same `x/y/z` values; default is `'XYZ'`. Converting
  `Euler → Quaternion → Euler` is order-preserving only if the same
  order is used.
- **`Matrix4.compose` / `decompose` round-trip.** Decomposing a
  composed matrix recovers the original `position` / `quaternion` /
  `scale` exactly for non-sheared transforms; shear is not representable
  and is silently discarded.
- **`Box3.setFromObject` requires `updateWorldMatrix`.** Custom-engine
  `Object3D` must implement `updateWorldMatrix()` (alias for
  `updateMatrixWorld(true)`) or this call throws `TypeError` and may
  trigger WebGL context loss. Use `computeWorldBoxCustom` for
  custom-engine objects.
- **`Frustum.setFromProjectionMatrix` expects `projection * view`.**
  Passing only the projection matrix culls in clip space and produces
  incorrect results.
- **Color range.** `Color` channels are floats in 0..1; `setHex`
  interprets the input as sRGB and converts to linear working space.
  Mixing hex-set and `setRGB` (linear) without conversion produces
  brightness mismatches.
- **No hidden allocations in hot paths.** `intersect*` methods accept an
  optional `target` vector to avoid per-call allocation; callers in
  render loops should always pass one.
- **`OBB.rotation` must be orthogonal.** The constructor does not verify
  that `rotation` columns are unit-length and mutually orthogonal;
  non-orthogonal matrices produce incorrect `intersectsOBB` / `containsPoint`
  results. Use `Matrix3.setFromQuaternion` or manually orthonormalise.
- **`OBB.halfSize` must be non-negative.** Negative half-extents produce
  degenerate boxes; `isEmpty()` returns true when any component ≤ 0.
- **`OBB.intersectsOBB` uses an epsilon.** The 9 cross-product axis tests
  include a small `epsilon` (default `1e-10`) to avoid false negatives on
  parallel edges. Increase for noisy floating-point inputs.

---

## References

- `src/engine/Core/README.md` — `Object3D` / `BufferGeometry` consume
  `Vector3` / `Matrix4` / `Quaternion` for transforms and bounds.
- `src/engine/Renderer/README.md` — `WebGL2Renderer` uploads
  `Matrix4` uniforms and uses `Frustum` for culling.
- `src/engine/Cameras/` — `PerspectiveCamera` / `OrthographicCamera`
  build projection matrices via `Matrix4.makePerspective` /
  `makeOrthographic`.
- `src/engine/Acceleration/MeshBVH` — uses `Box3` / `Ray` /
  `Triangle` for BVH construction and ray traversal.
- three.js `THREE` namespace — naming and semantics are aligned for
  cross-engine bridging (see `src/three/convertCustomToThree.ts`).
- Ericson, C. *Real-Time Collision Detection* ch. 4 — OBB-OBB SAT
  algorithm reference for `OBB.intersectsOBB`.
- three.js `examples/jsm/math/OBB.js` — original OBB implementation
  adapted for `OBB.ts`.
