# Cameras Module

> Path: `src/engine/Cameras/`
>
> The camera subsystem of the `@vreen/engine` kernel. Provides the two
> concrete projection modes (`PerspectiveCamera`, `OrthographicCamera`)
> used by the renderer, an abstract `Camera` base carrying the world
> transform plus a cached `projectionMatrix` / `projectionMatrixInverse`,
> a `CinematicCamera` that drives a `PerspectiveCamera` through a
> scripted shot sequence with transitions / DOF / shake, and a `CameraRig`
> that follows a target object in real time using crane / dolly / orbit /
> fixed motion modes.

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
```

`CinematicCamera` and `CameraRig` are complementary: the former plays a
*scripted* shot sequence (predetermined poses over time), the latter
*reactively* follows a live `Object3D` (player / vehicle). They compose —
a rig can follow the player while a cinematic camera cuts between rigs.

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
- `src/engine/Cameras/index.ts` — barrel re-exports for the module.
