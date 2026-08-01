# Cameras Module

> Path: `src/engine/Cameras/`
>
> The camera subsystem of the `@vreen/engine` kernel. Provides the two
> concrete projection modes (`PerspectiveCamera`, `OrthographicCamera`)
> used by the renderer, an abstract `Camera` base carrying the world
> transform plus a cached `projectionMatrix` / `projectionMatrixInverse`,
> a `CinematicCamera` that drives a `PerspectiveCamera` through a
> scripted shot sequence with transitions / DOF / shake, a `CameraRig`
> that follows a target object in real time using crane / dolly / orbit /
> fixed motion modes, a `StereoCamera` for off-axis dual-eye VR / 3D
> rendering, and a `CubeCamera` that captures 6-face environment maps
> for real-time IBL / reflections / refractions.

---

## Overview

```
Camera (abstract, extends Object3D)
   ├── projectionMatrix: Matrix4
   ├── projectionMatrixInverse: Matrix4
   ├── getWorldDirection(target)
   │
   ├── PerspectiveCamera      ── fov° / aspect / near / far
   └── OrthographicCamera     ── left / right / top / bottom / near / far

CinematicCamera               ── owns a PerspectiveCamera + shot sequence
   ├── shots: CameraShot[]        (name, position, lookAt, fov, duration, transitionType)
   ├── transitions: cut / fade / dolly / orbit  (smoothstep-eased over transitionDuration)
   ├── DOF: dofEnabled / focusDistance / aperture / focalLength
   ├── shake: shake() / shakeAmount / shakeFrequency  (Perlin-style noise, linear decay)
   └── exportTimeline() / importTimeline()  (round-trip JSON)

CameraRig                      ── real-time target follower
   ├── type: 'crane' | 'dolly' | 'orbit' | 'fixed'
   ├── follow(target: Object3D)  (crane = overhead swing, dolly = XZ rail,
   │                               orbit = circular, fixed = offset lock)
   └── damping  (0 = instant, 1 ≈ frozen; typical 0.05..0.2)

StereoCamera                   ── off-axis dual-eye (Kooima 2008)
   ├── eyeSep / focalLength       (IPD + convergence plane)
   ├── cameraL / cameraR          (two PerspectiveCamera, eye offset on local X)
   └── update(camera)             (copy intrinsics + apply asymmetric frustum)

CubeCamera                     ── 6-face 90° environment map capture
   ├── cameras: PerspectiveCamera[6]   (px, nx, py, ny, pz, nz)
   ├── renderTarget: CubeRenderTarget  (resolution / format / mipmap / colorSpace)
   ├── update(renderer, scene)         (delegates GL work to renderer.updateCubeCamera)
   └── autoUpdate / version            (matrixWorld sync + dirty tracking)
```

`CinematicCamera` and `CameraRig` are complementary: the former plays a
*scripted* shot sequence (predetermined poses over time), the latter
*reactively* follows a live `Object3D` (player / vehicle). They compose —
a rig can follow the player while a cinematic camera cuts between rigs.
`CubeCamera` is orthogonal: it captures the scene into a cube map rather
than rendering a single view, and its output feeds the material system's
`envMap` / IBL pipeline.

---

## Core Classes

### `Camera` (`Camera.ts`)

Abstract base. Subclasses own projection; the base owns only the world
transform inherited from `Object3D` and the two cached projection
matrices the renderer reads.

```ts
export abstract class Camera extends Object3D {
  projectionMatrix: Matrix4;
  projectionMatrixInverse: Matrix4;
  getWorldDirection(target): { x; y; z };  // local -Z axis in world space
  abstract updateProjectionMatrix(): void;
}
```

Invariants:
- `getWorldDirection` reads `matrixWorld.elements` directly — the scene
  graph must be up to date before it is called (the renderer does this
  in `render()`).
- The camera's local `-Z` axis is the look direction, matching the
  three.js / WebGL convention.

### `PerspectiveCamera` (`PerspectiveCamera.ts`)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `fov` | `number` | `50` | Vertical field of view in **degrees**. |
| `aspect` | `number` | `1` | Width / height; refreshed each frame by the renderer. |
| `near` | `number` | `0.1` | Near plane. |
| `far` | `number` | `1000` | Far plane. |

```ts
const cam = new PerspectiveCamera(60, w / h, 0.1, 100);
cam.position.set(0, 1, 3);
cam.lookAt(0, 0, 0);
```

`updateProjectionMatrix()` delegates to `Matrix4.makePerspective` with a
symmetric frustum (no film offset) and WebGL depth range `[-1, 1]`.

### `OrthographicCamera` (`OrthographicCamera.ts`)

| Field | Type | Default |
|-------|------|---------|
| `left` / `right` / `top` / `bottom` | `number` | `-1` / `1` / `1` / `-1` |
| `near` / `far` | `number` | `0.1` / `1000` |

Used for 2D HUDs, blueprint views, and shadow-camera math. The projection
matrix is written directly into `elements` and the inverse is recomputed
on every `updateProjectionMatrix()` call.

### `CinematicCamera` (`CinematicCamera.ts`)

A shot-sequencer that drives an owned `PerspectiveCamera`.

| Export | Role |
|--------|------|
| `CinematicCamera` | Shot-sequence driver. Owns `camera: PerspectiveCamera`, `shots: CameraShot[]`, transition / DOF / shake state. |
| `CameraShot` | Interface: `name`, `position`, `lookAt`, `fov`, `duration`, `transitionType`. |
| `ShotTransitionType` | `'cut' \| 'fade' \| 'dolly' \| 'orbit'`. |
| `ShotInfo` | Runtime snapshot: `index`, `name`, `elapsed`, `duration`, `transitionProgress`, `playing`, `inTransition`. |
| `CameraTimelineJSON` | Serialization shape for `exportTimeline()` / `importTimeline()`. |

```ts
export class CinematicCamera {
  camera: PerspectiveCamera;
  shots: CameraShot[];
  currentShot: number;
  shotTime: number;
  transitionDuration: number;     // seconds, shared across shots
  dofEnabled: boolean;
  focusDistance: number;          // world units
  aperture: number;               // f-number (lower = more blur)
  focalLength: number;            // mm
  shakeAmount: number;
  shakeFrequency: number;         // Hz
  loop: boolean;

  addShot(shot): this;
  removeShot(index): boolean;
  play(): this;                   // begin from currentShot
  stop(): this;                   // freeze current frame
  nextShot(): number;             // returns new index (-1 if empty)
  prevShot(): number;
  seekShot(index): boolean;
  shake(amount, duration): this;  // override current shake
  setDOF(enabled, focus?, aperture?): this;
  update(dt): this;               // advance timeline, apply pose to camera
  getShotInfo(): ShotInfo;
  exportTimeline(): CameraTimelineJSON;
  importTimeline(data): this;
}
```

Transition semantics (applied during the first `transitionDuration`
seconds of a shot):
- `cut` — instant snap, no interpolation.
- `fade` — linear lerp of position + lookAt (renderer may overlay alpha).
- `dolly` — smoothstep-eased lerp of position + lookAt.
- `orbit` — camera travels along a circular arc around the previous
  shot's `lookAt`, ending aligned with the new shot's position; uses the
  shortest yaw delta in `[-π, π]`.

`shake()` adds Perlin-style sinusoidal noise to position (3 axes, with a
0.7 amplitude reduction on Y) and **linearly decays** over `duration`.
FOV is interpolated with `smoothstep` during transitions; outside
transitions it snaps to the shot's `fov`.

### `CameraRig` (`CameraRig.ts`)

Real-time target follower.

| Export | Role |
|--------|------|
| `CameraRig` | Drives a bound `Camera` to follow `target: Object3D` by a motion mode. |
| `CameraRigType` | `'crane' \| 'dolly' \| 'orbit' \| 'fixed'`. |

```ts
export class CameraRig {
  camera: Camera | null;    type: CameraRigType;   target: Object3D | null;
  offset: Vector3;          // default (0, 0, 5)
  height: number;           // crane / orbit lift, default 5
  radius: number;           // orbit / crane swing radius, default 10
  speed: number;            // rad/s or units/s, default 0.5
  damping: number;          // 0 = instant, default 0.1
  lookAtOffset: Vector3;    // relative to target, default (0, 1, 0)
  position: Vector3;        lookAt: Vector3;       // current (readable)
  follow(target): this;     setType(type): this;   // snap-align on attach
  setOffset(v): this;       setLookAtOffset(v): this;
  orbit(angleRad): this;    orbitBy(deltaRad): this;  // overwrite / delta
  update(dt): this;         attachCamera(camera): this;  detachCamera(): void;
}
```

Motion modes (all compute a desired position, then `lerp` toward it with
`alpha = 1 - damping`):
- `fixed` — `position = target.position + offset`.
- `crane` — overhead swing: `orbitAngle += speed × dt`; Y = `target.y +
  height`; XZ on a circle of `radius`.
- `orbit` — circular orbit at `offset.y` height, radius `radius`, angular
  speed `speed`.
- `dolly` — rail motion along XZ with a sinusoidal back-and-forth of
  amplitude `radius`.

`follow()` immediately copies `target.position + offset` into `position`
to avoid a large initial jump; subsequent `update(dt)` calls apply
damping.

### `StereoCamera` (`StereoCamera.ts`)

Dual-eye stereo camera for VR / 3D display rendering. Models the
**off-axis asymmetric frustum** technique (Kooima 2008) so the left and
right eye projections converge at a configurable `focalLength` plane
without vertical parallax artifacts. Owns two child `PerspectiveCamera`s
(`cameraL`, `cameraR`) whose fov / aspect / near / far mirror a source
camera; only the horizontal projection offset and eye position differ.

| Field | Type | Role |
|-------|------|------|
| `eyeSep` | `number` | Inter-pupillary distance (world units). Typical 0.064. |
| `focalLength` | `number` | Convergence distance: where the two eye axes meet. |
| `cameraL` / `cameraR` | `PerspectiveCamera` | Cached left / right eye cameras. |
| `aspect` | `number` | Per-eye aspect (caller sets, usually `aspect / 2` for side-by-side). |

`update(camera)` copies the source camera's intrinsics, applies the eye
offset matrix along the camera's local X, and recomputes each eye's
asymmetric projection. `render(renderer, scene)` is left to the caller
in the headless engine convention; the renderer submits left then right.

Adapted from three.js `StereoCamera.js`. CPU math only — no WebGL
dependency, headless-testable; complements `AnaglyphEffect` and
`ParallaxBarrierEffect` in the Renderer module.

### `CubeCamera` (`CubeCamera.ts`)

Six-face 90° `PerspectiveCamera` rig that captures the scene into a cube
map for real-time environment lighting (IBL), reflections, refractions,
dynamic skyboxes, and point-light shadow maps. Adapted from three.js
`CubeCamera.js` with the VREEN headless convention: the camera owns only
**data** (position, orientation, projection, render-target descriptor) —
no GL calls. The actual 6-face render-to-cube is performed by
`WebGL2Renderer.updateCubeCamera(camera, scene)`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `cameras` | `PerspectiveCamera[6]` | — | One per face, order `px, nx, py, ny, pz, nz`. |
| `renderTarget` | `CubeRenderTarget` | `{256,'rgba8',true,'srgb'}` | Resolution / format / mipmap / colorSpace descriptor (no GL handle). |
| `near` / `far` | `number` | `0.1` / `1000` | Shared by all 6 cameras; `setNear()` / `setFar()` propagate. |
| `autoUpdate` | `boolean` | `true` | When `true`, `update()` calls `updateMatrixWorld(true)` before rendering. |
| `version` | `number` | `0` | Incremented after each `update()` — lets callers cache / invalidate. |
| `isCubeCamera` | `boolean` | `true` | Type flag. |
| `type` | `string` | `'CubeCamera'` | Object3D type tag. |

| Export | Role |
|--------|------|
| `CubeCamera` | The camera class. |
| `CUBE_FACES` | `readonly ['px','nx','py','ny','pz','nz']` — face index order. |
| `CubeFace` | Union type of the 6 face names. |
| `CubeRenderTarget` | Interface: `resolution`, `format`, `generateMipmaps`, `colorSpace`. |

```ts
export class CubeCamera extends Object3D {
  cameras: PerspectiveCamera[];          // length 6
  renderTarget: CubeRenderTarget;
  near: number;  far: number;
  autoUpdate: boolean;  version: number;

  constructor(opts?: {
    near?: number;  far?: number;  resolution?: number;
    format?: 'rgba8' | 'rgba16f' | 'rgba32f' | 'r11g11b10';
    generateMipmaps?: boolean;  colorSpace?: 'srgb' | 'linear';
  }): CubeCamera;

  setNear(n): this;          // propagate to all 6 cameras + updateProjectionMatrix
  setFar(n): this;           // ditto
  setResolution(res): this;  // update renderTarget.resolution (min 1, floored)
  updateCameras(): void;     // recompute 6-camera position + orientation from this.position
  update(renderer, scene): void;   // delegate to renderer.updateCubeCamera(this, scene)
}
```

**Face orientation table** (OpenGL cubemap convention):

| Face | dir (forward) | up | Resulting -Z axis |
|------|---------------|----|--------------------|
| `px` (+X right)  | `( 1, 0, 0)` | `(0,-1, 0)` | camera looks +X |
| `nx` (−X left)   | `(-1, 0, 0)` | `(0,-1, 0)` | camera looks −X |
| `py` (+Y top)    | `( 0, 1, 0)` | `(0, 0, 1)` | camera looks +Y |
| `ny` (−Y bottom) | `( 0,-1, 0)` | `(0, 0,-1)` | camera looks −Y |
| `pz` (+Z front)  | `( 0, 0, 1)` | `(0,-1, 0)` | camera looks +Z |
| `nz` (−Z back)   | `( 0, 0,-1)` | `(0,-1, 0)` | camera looks −Z |

**Direction math** — `_updateCameras()` builds a view matrix per face via
`Matrix4.makeLookAt(eye=pos, target=pos+dir, up=faceUp)`, then extracts
the world-rotation quaternion by transposing the view rotation (orthogonal
inverse = transpose) and converting with a Shoemake 1987
matrix→quaternion routine. This bypasses `Object3D.lookAt`, which hard-codes
`up=(0,1,0)` and would degenerate for the ±Y faces where forward is
parallel to (0,1,0).

**`update(renderer, scene)` flow**:
1. If `autoUpdate`, call `this.updateMatrixWorld(true)` (which triggers
   the override → `_updateCameras()`).
2. Call `_updateCameras()` unconditionally (cheap; idempotent).
3. Delegate GL work: `renderer.updateCubeCamera(this, scene)` — the
   renderer iterates `cameras[6]`, sets each as active, renders the scene
   into the corresponding cube-map face.
4. Increment `version` (lets material / texture systems invalidate caches).

**Differences from three.js**:
- three.js `CubeCamera` holds a `WebGLCubeRenderTarget` (live GL handle)
  and its `update()` directly calls `renderer.setRenderTarget()` +
  `renderer.render()` 6 times. VREEN `CubeCamera` holds only a
  `CubeRenderTarget` *descriptor* (plain data, no GL handle); the
  renderer owns the GL framebuffer and performs the 6-face render.
- three.js uses `Object3D.lookAt(target)` with the camera's `up` field
  set per-face. VREEN's `Object3D.lookAt` hard-codes `up=(0,1,0)`, so
  `CubeCamera` computes the rotation directly from `Matrix4.makeLookAt`
  with the per-face up vector (see "Direction math" above).
- Headless-testable: all 6 cameras' positions, directions, and
  projection matrices can be verified in Node without a GL context.

**Limitations**:
- `_updateCameras()` reads `this.position` (local), not the world
  position. When the CubeCamera is a child of a transformed parent, place
  it at the root or call `updateMatrixWorld(true)` before relying on the
  6-camera positions. (Matches three.js behavior where the CubeCamera is
  typically a root-level scene node.)
- The 6 child cameras are **not** added to `this.children`; they do not
  participate in scene-graph traversal or frustum culling. The renderer
  renders them explicitly via `updateCubeCamera`.
- `update()` does not skip rendering when `version` is unchanged —
  callers decide cadence (every frame, on-demand, or throttled).

---

## Usage

### Perspective + orthographic basics

```ts
import { PerspectiveCamera, OrthographicCamera } from '@vreen/engine';

const main = new PerspectiveCamera(60, 16 / 9, 0.1, 200);
main.position.set(0, 2, 6);
main.lookAt(0, 0, 0);

const hud = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
hud.position.set(0, 0, 5);
```

### Cinematic shot sequence

```ts
import { CinematicCamera, Vector3 } from '@vreen/engine';

const cine = new CinematicCamera();
cine.transitionDuration = 0.6;
cine.addShot({ name: 'Wide',  position: new Vector3(0, 6, 12), lookAt: new Vector3(0,1,0), fov: 50, duration: 4, transitionType: 'cut' })
    .addShot({ name: 'Dolly', position: new Vector3(4, 2, 6),  lookAt: new Vector3(0,1,0), fov: 35, duration: 3, transitionType: 'dolly' })
    .addShot({ name: 'Orbit', position: new Vector3(-5, 3, 5), lookAt: new Vector3(0,1,0), fov: 50, duration: 3, transitionType: 'orbit' });
cine.setDOF(true, 8, 2.8);  cine.loop = true;  cine.play();
// frame loop: cine.update(dt); renderer.render(scene, cine.camera);
cine.shake(0.4, 0.6);   // external event: explosion
```

### CameraRig following a player

```ts
import { CameraRig, PerspectiveCamera } from '@vreen/engine';

const rig = new CameraRig(new PerspectiveCamera(60, 16/9, 0.1, 200));
rig.follow(playerEntity).setType('orbit')
   .setOffset(new Vector3(0, 2, 0)).setLookAtOffset(new Vector3(0, 1.5, 0));
rig.radius = 6;  rig.speed = 0.3;  rig.damping = 0.12;
// frame loop: rig.update(dt); renderer.render(scene, rig.camera);
```

The nine camera presets used by the viewer (Free / Iso / Front / Back /
Side / Top / 1st-person / 3rd-person / Cinematic) are configurations of
`PerspectiveCamera` + `OrbitControls` + post-processing; the Cinematic
preset additionally enables `CinematicCamera`'s slow orbit + FOV
breathing + DOF.

### CubeCamera for real-time environment maps

```ts
import { CubeCamera } from '@vreen/engine';

// 256×256 RGBA8 cube map, mipmap-enabled, sRGB color space
const cubeCam = new CubeCamera({ near: 0.1, far: 100, resolution: 256 });
cubeCam.position.set(0, 5, 0);
scene.add(cubeCam);

// Each frame (or throttled): render 6 faces → cube map
cubeCam.update(renderer, scene);

// Manual cadence (e.g. every 6th frame for cost control):
if (frame % 6 === 0) cubeCam.update(renderer, scene);

// After update, the renderer's cube-map texture is ready for IBL / reflections
// (renderer exposes the cube texture; see WebGL2Renderer.updateCubeCamera)
```

Common patterns:
- **IBL / reflections**: place the `CubeCamera` at the reflective object's
  position, call `update()` once per frame (or throttled), feed the
  resulting cube texture to `material.envMap`.
- **Dynamic skybox**: parent the `CubeCamera` to the player; update every
  frame so the skybox tracks player motion.
- **Point-light shadow map**: use a `CubeCamera` at the light position
  with `far` tuned to the light's range; the renderer's shadow pass reads
  the cube depth texture.
- **On-demand capture**: set `autoUpdate = false`, call `update()` only
  when the scene changes (door opens, light moves), checking `version`
  to invalidate downstream caches.

---

## Invariants

- `Camera` is abstract; only `PerspectiveCamera` and
  `OrthographicCamera` are directly constructible as projections.
- `updateProjectionMatrix()` must be called after any of `fov` / `aspect`
  / `near` / `far` (perspective) or `left` / `right` / `top` / `bottom`
  / `near` / `far` (orthographic) change. The constructors call it once;
  `CinematicCamera` re-calls it when a shot's `fov` changes.
- `projectionMatrixInverse` is always kept in sync with
  `projectionMatrix` — both `PerspectiveCamera` and
  `OrthographicCamera` recompute the inverse inside
  `updateProjectionMatrix()`.
- `getWorldDirection()` reads `matrixWorld` directly; the scene graph
  must be current (the renderer calls `updateWorldMatrix` before
  rendering).
- `CinematicCamera.update(dt)` is a no-op when `shots.length === 0`;
  `play()` is a no-op on an empty sequence.
- `CinematicCamera` never calls `camera.updateMatrixWorld()` — that is
  the renderer's responsibility, mirroring `OrbitControls`.
- `CameraRig.update(dt)` is a no-op when `target === null`; if
  `camera === null` it still updates its internal `position` / `lookAt`
  fields for external consumption.
- `CameraRig.follow()` snaps to the target immediately to avoid a
  damping-induced initial jump; subsequent motion is damped.
- `CameraTimelineJSON` round-trips losslessly: `importTimeline(
  exportTimeline())` reproduces the shots, transition duration, and all
  DOF parameters.
- `CubeCamera.cameras` always has exactly 6 entries in the order
  `px, nx, py, ny, pz, nz` (matching `CUBE_FACES`); each is a
  `PerspectiveCamera` with `fov=90`, `aspect=1`.
- `CubeCamera._updateCameras()` is called by the `updateMatrixWorld`
  override and by `update()` — the 6 child cameras' positions and
  rotations always reflect the CubeCamera's current `position`.
- The 6 child cameras are **not** in `this.children`; they are not
  traversed by the scene graph and must be rendered explicitly via
  `renderer.updateCubeCamera()`.
- `CubeCamera.update()` always increments `version`, even if the scene
  is unchanged — callers decide cadence.
- `setNear()` / `setFar()` propagate to all 6 cameras and recompute
  their `projectionMatrix` immediately.
- `setResolution()` floors to an integer and clamps to a minimum of 1;
  it does not recreate any GL resource (the renderer reads
  `renderTarget.resolution` on next `updateCubeCamera`).
- The ±Y face rotations use `up=(0,0,±1)`; the ±X / ±Z faces use
  `up=(0,-1,0)`. `Object3D.lookAt` (which hard-codes `up=(0,1,0)`) is
  **not** used — `_updateCameras()` builds the rotation directly from
  `Matrix4.makeLookAt` to support the per-face up vectors.

---

## References

- `src/engine/Renderer/WebGL2Renderer.ts` — reads `projectionMatrix`
  and `matrixWorld` from the camera each frame, sets the renderer's
  aspect ratio from the canvas.
- `src/engine/Controls/OrbitControls.ts` — manipulates a `Camera` via
  spherical coordinates around a `target`.
- `src/engine/Helpers/CameraHelper.ts` — visualises a `Camera`'s
  frustum using `projectionMatrixInverse` + `matrixWorld`.
- `src/engine/Renderer/PostProcess/DOFEnhancedPass.ts` — consumes
  `CinematicCamera` DOF parameters.
- three.js `PerspectiveCamera`, `OrthographicCamera` — projection
  matrix conventions (symmetric frustum, WebGL depth `[-1, 1]`).
- three.js `CubeCamera.js` / `WebGLCubeRenderTarget` — cube-map capture
  conventions and 6-face orientation table (OpenGL spec §8.13.1).
- o3de Atom `ReflectionProbe` — runtime IBL probe system that uses a
  cube camera as its capture primitive.
- Ken Shoemake, "Quaternion Calculus and Fast Animation" (1987) — the
  rotation-matrix → quaternion algorithm used in `_updateCameras()`.
- `src/engine/Cameras/index.ts` — barrel re-exports for the module.
