# Helpers Module

> Path: `src/engine/Helpers/`
>
> The debug-visualisation subsystem of the `@vreen/engine` kernel. Provides
> in-engine gizmos (axes, grid, box wireframes, camera frustum, arrows),
> dynamic line meshes, a `PhysicsDebugRenderer` reading ECS physics state
> into collider / contact / velocity channels, and a `DebugRenderer` with a
> `drawXxx` API and duration-based lifecycle. All gizmos are `Mesh` instances
> drawn through the renderer's helper bypass (`userData.__helper`), using
> dedicated unlit shaders cached per GL context.

---

## Overview

```
Shader programs (cached per WebGL2RenderingContext)
   getLineProgram() / getVertexColorLineProgram()  ── single-color / per-vertex LINES

Static gizmos (extend Mesh, built once)
   createGridMesh()    ── shader-faded ground plane (single quad)
   AxesHelper          ── X red / Y green / Z blue (6 verts)
   BoxHelper           ── 12-edge wireframe of an Object3D's AABB
   CameraHelper        ── frustum + cone + up + target + cross
   ArrowHelper         ── 5-line arrow (shaft + 4 head edges)
   GridHelper3D        ── 3-plane (XY/YZ/XZ) grid with center-line tint

Light debug gizmos (mirror three.js `helpers/`, per-vertex-coloured LINES)
   DirectionalLightHelper ── square plane (⊥ to light dir) + direction ray
   PointLightHelper      ── wireframe sphere (long+lat) + optional distance ring
   SpotLightHelper       ── cone (5 radial rays + 32-seg base ring)
   HemisphereLightHelper ── octahedron: upper sky-colour / lower ground-colour
   SkeletonHelper        ── one line per bone→parent, blue→green gradient

Dynamic line mesh
   LineMesh / createLineMesh()   ── Dynamic VBO, updateVertices() per frame

Physics / general debug draw
   PhysicsDebugRenderer  ── reads World → collider/contact/velocity LineMeshes
   DebugRenderer         ── drawLine/drawBox/drawSphere/... with durations
```

Every helper `Mesh` carries `userData.__helper`, a cached `program`, and
a `uniforms` bag. The renderer's helper-pass detects this and issues
`gl.LINES` / grid shader instead of the PBR path. Geometry builders
(`buildAxesGeometry`, etc.) are pure-data functions, unit-testable
without WebGL.

---

## Core Classes

### Shader programs (`lineShaders.ts`)

| Export | Role |
|--------|------|
| `getLineProgram(gl)` | Cached single-color `LINES` program. Uniforms: `u_model`, `u_view`, `u_projection`, `u_color`, `u_alpha`. |
| `getVertexColorLineProgram(gl)` | Cached per-vertex-color `LINES` program. Reads `a_color` (location 2). Uniforms: `u_model`, `u_view`, `u_projection`, `u_alpha`. |
| `RGBTuple` | Type alias `[number, number, number]` (linear 0..1). |

Both programs are compiled once per `WebGL2RenderingContext` and reused
across all helpers sharing that context. The GLSL is `#version 300 es`
with `precision highp float`.

### Ground grid (`GridHelper.ts`)

| Export | Role |
|--------|------|
| `createGridMesh(renderer, opts?)` | Build a single-quad `Mesh` shaded as a faded infinite grid (minor cells + major sections). |
| `GridHelperOptions` | `size`, `cellSize`, `sectionSize`, `cellColor`, `sectionColor`, `fadeDistance`, `fadeStrength`, `y`. |

```ts
export interface GridHelperOptions {
  size?: number;          cellSize?: number;      sectionSize?: number;  // 20 / 0.4 / 2
  cellColor?: [n,n,n];    sectionColor?: [n,n,n];  // [0.1,0.225,0.29] / [0,0.94,1]
  fadeDistance?: number;  fadeStrength?: number;   y?: number;            // 18 / 1.4 / 0
}
```

The fragment shader anti-aliases with `fwidth`, fades by distance from
origin; fragments beyond `fadeDistance` are discarded. Mesh rotated
`-90°` on X so the quad lies on the XZ plane.

### `LineMesh` (`LineHelper.ts`)

| Export | Role |
|--------|------|
| `LineMesh` | `Mesh` subclass with `Dynamic`-usage position VBO. `updateVertices(verts)` overwrites the buffer (clamped to `maxSegments`). `frustumCulled = false`. |
| `createLineMesh(renderer, maxSegments, color, alpha?)` | Factory. |

```ts
export class LineMesh extends Mesh {
  readonly maxSegments: number;
  segmentCount: number;
  updateVertices(verts: Float32Array): void;   // 6 floats / segment
}
```

Used for ad-hoc debug lines and as the substrate for
`PhysicsDebugRenderer`'s three channels.

### `AxesHelper` (`AxesHelper.ts`)

| Export | Role |
|--------|------|
| `AxesHelper` | 6-vertex line mesh: X red, Y green, Z blue, each from origin to `size`. |
| `buildAxesGeometry(size?)` | Pure-data geometry builder (no GL). |

Public API: `setColors(xColor, yColor, zColor)` rewrites the `color`
attribute. `frustumCulled = false`. Uses vertex-color line program.

### `BoxHelper` (`BoxHelper.ts`)

| Export | Role |
|--------|------|
| `BoxHelper` | 12-edge wireframe of an `Object3D` subtree's world-space AABB. `update()` recomputes by traversing the subtree, transforming each child geometry's 8 corners by `matrixWorld`. |
| `buildBoxGeometry()` | 8-vertex / 24-index geometry (initial positions all 0). |

Public API: `update()`, `setFromObject(object)`, `setColor(c)`.
`matrixAutoUpdate = false`; vertices hold world coordinates.

### `CameraHelper` (`CameraHelper.ts`)

| Export | Role |
|--------|------|
| `CameraHelper` | Visualises a `Camera`'s frustum: near / far planes, sides, cone, up indicator, target line, cross hairs. |
| `buildCameraHelperGeometry()` | Returns `{ geometry, pointMap }` — `pointMap` maps named NDC points (`'n1'`, `'f4'`, `'p'`, etc.) to vertex indices. |

```ts
export class CameraHelper extends Mesh {
  camera: Camera;    pointMap: Record<string, number[]>;
  setColors(frustum, cone, up, target, cross): this;    update(): void;
}
```

`update()` unprojects each NDC point through `projectionMatrixInverse`
then `matrixWorld`. Default palette: frustum orange, cone red, up blue,
target white, cross grey. WebGL depth convention (near z = -1, far z = +1).

## Light debug gizmos (`LightHelpers.ts`)

Adapted from three.js `src/helpers/{Directional,Point,Spot,Hemisphere}LightHelper.js`.
VREEN has no `Line`/`LineSegments`/`LineBasicMaterial` runtime, so each
helper is a single `Mesh` with a per-vertex-coloured line geometry
(`userData.__helper = 'line'`, drawn via `gl.LINES`). Geometry builders
(`buildXxxGeometry`) are pure-data functions, unit-testable without WebGL.

| Export | Role |
|--------|------|
| `DirectionalLightHelper` | Square frame (⊥ to `light.direction`, half-edge `size`) + a direction ray (length = `size*10`). Uses VREEN's explicit `direction` field rather than `position→target`. `update()` rebuilds world-space verts. |
| `PointLightHelper` | Wireframe sphere (`segments` longitudes × `rings` latitudes) + an outer ring of radius `light.distance` when `distance > 0`. `update()` syncs `this.matrix = light.matrixWorld`. |
| `SpotLightHelper` | Cone: 5 radial rays + 32-seg base ring. Cone length = `distance` (or 1000 fallback), cone width = `length × tan(angle)`. `update()` sets position + `lookAt(target)` so local +Z faces the target. |
| `HemisphereLightHelper` | Octahedron (12 edges, 24 verts); upper edges take `light.color`, lower edges `light.groundColor`. `update()` syncs color + matrix. |

> Override colour: pass an `RGBColor` to the constructor or `build` fn;
> omit it to follow `light.color` (Hemisphere: `light.color` / `groundColor`).

### `SkeletonHelper` (`SkeletonHelper.ts`)

Adapted from three.js `src/helpers/SkeletonHelper.js`. Draws one line per
`bone → parent-bone` link; colour gradient blue→green (root→tip).

| Export | Role |
|--------|------|
| `SkeletonHelper` | Collects all `isBone` nodes under `root` (`collectBones`), allocates 2 verts per parented bone, fills positions in `updateMatrixWorld()` from each bone's world matrix (relative to `root.matrixWorld` inverse). |
| `collectBones(root)` | Recursive depth-first `isBone` collector — exported for reuse by the Outliner. |
| `buildSkeletonHelperGeometry(root, c1?, c2?)` | Pure-data builder: zeroed positions + linear colour gradient; `setColors()` re-recipes the colour attribute. |

```ts
const helper = new SkeletonHelper(renderer, skinnedMesh);
scene.add(helper);
// after skeleton update & world matrix pass:
helper.updateMatrixWorld(true);
helper.setColors(0x0000ff, 0x00ff00);
```

### `ArrowHelper` (`ArrowHelper.ts`)

| Export | Role |
|--------|------|
| `ArrowHelper` | 5-line arrow: 1 shaft + 4 head edges (tip → head-base corners). |
| `buildArrowGeometry()` | 10-vertex empty geometry. |
| `fillArrowVertices(positions, dir, origin, length, headLength, headWidth)` | Pure-data vertex writer; computes two perpendiculars to `dir` and lays out the head quad. |

```ts
export class ArrowHelper extends Mesh {
  dir: Vector3;       origin: Vector3;     length: number;
  headLength: number;  headWidth: number;   color: RGBTuple;  // defaults: len*0.2 / *0.2
  setDirection(dir): this;     setLength(length, headLength?, headWidth?): this;
  setOrigin(origin): this;     setColor(color): this;
}
```

Perpendiculars: `dir × up` and `dir × perp1` (`up` falls back to
`(1,0,0)` when `dir` is nearly parallel to Y).

### `GridHelper3D` (`GridHelper3D.ts`)

| Export | Role |
|--------|------|
| `GridHelper3D` | Three-plane (XY / YZ / XZ) line grid with a distinct center-line color. Fixed line width; suitable for visualising coordinate space (contrast with `createGridMesh`'s shader-faded ground grid). |
| `buildGrid3DGeometry(size?, divisions?, colorCenterLine?, colorGrid?)` | Pure-data builder. |

Each plane emits `2 × (divisions + 1)` lines; center lines (offset ≈ 0)
use `colorCenterLine`, others use `colorGrid`. Default `u_alpha = 0.6`.

### `PhysicsDebugRenderer` (`PhysicsDebugRenderer.ts`)

| Export | Role |
|--------|------|
| `PhysicsDebugRenderer` | Reads ECS `World` each frame and writes three `LineMesh` channels: colliders (cyan), contacts (yellow), velocities (magenta). |
| `PhysicsDebugStats` | `{ colliderCount, contactCount, velocityCount, sleepingCount, totalBodies }`. |

```ts
export class PhysicsDebugRenderer {
  readonly group: Object3D;          // add to scene once
  readonly colliderLines: LineMesh;  readonly contactLines: LineMesh;
  readonly velocityLines: LineMesh;  stats: PhysicsDebugStats;
  update(world: World): void;        dispose(): void;
}
```

Channel budgets: 256 colliders (AABB 12 seg, sphere 24, capsule 32), 64
contacts (5 seg each), 256 velocities (1 seg each). Visibility +
`velocityScale` from ECS `PhysicsDebug` component; absent → all visible
at 0.5. Static (mass ≤ 0) and resting (speed < 1e-4) bodies skipped in
the velocity channel.

### `DebugRenderer` (`DebugRenderer.ts`)

General-purpose, WebGL-agnostic debug-draw manager with duration-based
lifecycle. Complementary to `PhysicsDebugRenderer`: lets callers draw
arbitrary geometry on demand.

| Export | Role |
|--------|------|
| `DebugRenderer` | Accumulates `lines` / `points` / `text` with per-element `remaining` time; `getMeshData()` returns a snapshot for GPU upload. |
| `DebugLine` / `DebugPoint` / `DebugText` | Element interfaces (`from`/`to`/`color`/`remaining`, etc.). |
| `DebugRenderData` | Snapshot: `lineVertices`, `lineColors`, `pointVertices`, `pointColors`, `pointSizes` (+ counts). |
| `DebugRendererStats` | `{ lineCount, pointCount, textCount, totalDrawCalls, enabled }`. |
| `DebugColors` | Named palette: `white`/`red`/`green`/`blue`/`yellow`/`cyan`/`magenta`/`orange`/`purple`/`gray`. |
| `clamp` | Re-exported `MathUtils.clamp`. |

```ts
export class DebugRenderer {
  lines: DebugLine[];   points: DebugPoint[];   text: DebugText[];
  enabled: boolean;     duration: number;   // default per-draw (0 = single frame)
  // drawXxx family — each takes (geometry, color?, duration?):
  drawLine / drawRay / drawBox / drawSphere / drawCircle / drawArrow /
  drawCross / drawGrid / drawPoint / drawText / drawFrustum / drawNormals / drawTriangle
  update(dt): void;    clear(): void;    getMeshData(): DebugRenderData;    getStats(): DebugRendererStats;
}
```

`duration` semantics: `undefined` → `this.duration`; `0` → single frame;
positive → N seconds; negative → `Infinity` (permanent until `clear()`).
`getMeshData()` returns internal buffer refs that grow geometrically —
do not hold across frames. `drawFrustum` solves 8 corners via Cramer's
rule on frustum plane triplets; `drawNormals` reads `position` +
`normal` attributes. Holds no GL state → runs in Node as pure logic.

---

## Usage

### Static gizmos

```ts
import { createGridMesh, AxesHelper, BoxHelper, CameraHelper, ArrowHelper, GridHelper3D } from '@vreen/engine';
scene.add(createGridMesh(renderer, { size: 30, cellSize: 0.5, sectionSize: 2.5 }));
scene.add(new AxesHelper(renderer, 2));
scene.add(new GridHelper3D(renderer, 20, 20, [0, 0.94, 1], [0.25, 0.25, 0.25]));
const box = new BoxHelper(renderer, meshNode, [1, 1, 0]);  scene.add(box);
box.update();                            // refresh after meshNode moves
const camHelper = new CameraHelper(renderer, mainCamera);  scene.add(camHelper);
camHelper.update();                      // refresh after camera fov/pose changes
const arrow = new ArrowHelper(renderer, dir, origin, 1.5, [1, 0.6, 0]);  scene.add(arrow);
arrow.setDirection(newDir);
```

### Dynamic lines + physics overlay

```ts
import { createLineMesh, PhysicsDebugRenderer } from '@vreen/engine';
const traj = createLineMesh(renderer, 2048, [0, 1, 1], 0.8);  scene.add(traj);
// frame loop: traj.updateVertices(sampleTrajectory()); renderer.render(scene, camera);

const physicsDebug = new PhysicsDebugRenderer(renderer);  scene.add(physicsDebug.group);
// frame loop: physicsSystem.step(world, dt); physicsDebug.update(world); renderer.render(scene, camera);
// toggle channels via ECS PhysicsDebug component:
//   dbgComp.showColliders = true; dbgComp.showContacts = false; dbgComp.velocityScale = 0.8;
```

### General debug draw

```ts
import { DebugRenderer, DebugColors } from '@vreen/engine';
const dbg = new DebugRenderer();  dbg.duration = 0;   // single-frame default
// frame loop:
//   dbg.clear();   // or rely on duration expiry
//   dbg.drawBox(mesh.getAABB(), DebugColors.green, 0);       // this frame only
//   dbg.drawRay(ray.origin, ray.dir, DebugColors.yellow, 5, 0.2);
//   dbg.drawSphere(bounds, DebugColors.cyan, 1.0);           // 1 second
//   dbg.drawCross(hitPoint, 0.15, DebugColors.red, -1);      // permanent
//   dbg.drawText(hitPoint, 'hit', DebugColors.white, 0.5);
//   const data = dbg.getMeshData();  dbg.update(dt);  renderer.render(scene, camera);
```

---

## Invariants

- Every helper `Mesh` carries `userData.__helper` (`'line'` / `'grid'`),
  a cached `program`, and a `uniforms` bag; the renderer's helper bypass
  issues `gl.LINES` / grid shader instead of the PBR path.
- Shader programs are cached **per `WebGL2RenderingContext`** — compiled
  at most once per context. Geometry builders (`buildAxesGeometry`,
  `buildBoxGeometry`, `buildCameraHelperGeometry`, `buildArrowGeometry`,
  `buildGrid3DGeometry`, `fillArrowVertices`) are pure-data, no GL.
- `LineMesh.updateVertices(verts)` clamps to `maxSegments`, updates `segmentCount`, marks position `needsUpdate`.
- `BoxHelper` / `CameraHelper` set `matrixAutoUpdate = false` and `frustumCulled = false` (vertices hold world coords). Re-call `update()` after changing `fov` / aspect / pose.
- `PhysicsDebugRenderer` budgets: 256 colliders / 64 contacts / 256 velocities; excess counted in `stats` but not drawn. Visibility from ECS `PhysicsDebug`; absent → all visible, `velocityScale = 0.5`.
- `DebugRenderer` is WebGL-agnostic: `getMeshData()` returns internal buffer refs that may grow — consume same frame, do not retain. `duration`: `undefined` → `this.duration`, `0` → single frame, positive → seconds, negative → `Infinity` (permanent). `drawFrustum` is a no-op if any corner triplet is degenerate.
- Helpers never release GL except `PhysicsDebugRenderer.dispose()` (disposes its three `LineMesh` geometries). Cached programs are singletons tied to context lifetime.

---

## References

- `src/engine/Renderer/WebGL2Renderer.ts` — helper bypass (`_drawHelper`) consuming `userData.__helper`.
- `src/engine/Renderer/ShaderProgram.ts` — `ShaderProgram` wrapper for cached line/grid programs.
- `src/engine/Core/BufferGeometry.ts` / `BufferAttribute.ts` — geometry + attribute storage.
- `src/engine/Math/Box3.ts`, `Sphere.ts`, `Frustum.ts`, `Vector3.ts` — primitives for `BoxHelper`, `drawBox`/`drawSphere`/`drawFrustum`.
- `src/engine/ECS/PhysicsComponents.ts` — `Collider`, `Rigidbody`, `PhysicsDebug` read by `PhysicsDebugRenderer`.
- three.js `AxesHelper` / `BoxHelper` / `CameraHelper` / `ArrowHelper` / `GridHelper` — API conventions.
- `src/engine/Helpers/index.ts` — barrel re-exports for the module.
