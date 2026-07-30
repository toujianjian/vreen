# Math Module

> Path: `src/engine/Math/`
>
> The math library of the `@vreen/engine` kernel. Provides vectors
> (`Vector2/3/4`), matrices (`Matrix3/4`), rotations (`Quaternion` /
> `Euler`), geometric primitives (`Box3` / `Sphere` / `Plane` / `Ray` /
> `Line3` / `Triangle` / `Frustum`), `Color`, and a `MathUtils` toolbox.
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

Color ──converts── HSL / RGB / hex
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
| `Matrix3` | 3×3 matrix (column-major `elements`). `set` / `identity` / `multiply` / `transpose` / `invert` / `getNormalMatrix`. |
| `Matrix4` | 4×4 matrix. `makeTranslation` / `makeRotationX/Y/Z` / `makeScale` / `multiply` / `invert` / `compose(position, quaternion, scale)` / `decompose` / `makePerspective` / `makeOrthographic`. |

```ts
const m = new Matrix4().compose(position, quaternion, scale);
const normalMatrix = new Matrix3().getNormalMatrix(m);
```

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
| `Ray` | Origin + direction. `at` / `distanceToPoint` / `distanceSqToPoint` / `intersectSphere` / `intersectBox` / `intersectTriangle` / `intersectPlane` / `applyMatrix4`. |
| `Line3` | Two endpoints. `at` / `delta` / `distance` / `closestPointToPoint` / `applyMatrix4`. |
| `Triangle` | Three vertices. `area` / `normal` / `barycoordFromPoint` / `containsPoint` / `intersectsRay`. |
| `Frustum` | Six planes. `setFromProjectionMatrix` / `containsPoint` / `intersectsBox` / `intersectsSphere`. Used by `FrustumCuller`. |

### Color

| Export | Role |
|--------|------|
| `Color` | RGB (`r`, `g`, `b` in 0..1). `setHex` / `setRGB` / `setHSL` / `getHSL` / `convertSRGBToLinear` / `convertLinearToSRGB` / `lerp` / `copy`. |
| `HSL` (type) | `{ h: number; s: number; l: number }` returned by `getHSL`. |

### Utilities

| Export | Role |
|--------|------|
| `MathUtils` | Namespace with `clamp` / `lerp` / `degToRad` / `radToDeg` / `randInt` / `randFloat` / `smoothstep` / `smootherstep` / `pingpong` / `euclideanModulo` / `generateUUID`. |

```ts
import { MathUtils } from '@vreen/engine/math';
const id = MathUtils.generateUUID();        // RFC4122 v4 string
const t = MathUtils.clamp(x, 0, 1);
```

---

## Usage Example

```ts
import {
  Vector3, Matrix4, Quaternion, Euler, Box3, Sphere, Ray,
  Frustum, Color, MathUtils,
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
const visible = frustum.intersectsBox(box);

// Ray picking
const ray = new Ray(origin, direction);
const hit = ray.intersectSphere(sphere, new Vector3());

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
