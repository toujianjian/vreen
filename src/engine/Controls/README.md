# Controls Module

> Path: `src/engine/Controls/`
>
> The input-controller subsystem of the `@vreen/engine` kernel. Provides
> camera and character controllers that translate raw DOM / WebXR input
> into camera or avatar motion. Zero-dependency on three.js — every
> controller consumes `PointerEvent` / `KeyboardEvent` / WebXR APIs
> directly. Controllers never call `camera.updateMatrixWorld()` (the
> renderer's job), matching the `OrbitControls` contract.

---

## Overview

```
Non-immersive (desktop / touch)
   OrbitControls          ── spherical coords around `target`, damping, pinch-zoom
       └── MapControls    ── swaps left/right button roles, ground-plane panning
   FlyControls            ── 6-DOF free flight (WASD/RF, arrows, Q/E roll)
   PointerLockControls    ── first-person pointer-lock (YXZ euler, XZ-plane move)

CharacterController       ── kinematic avatar (gravity, jump, steps, slope limit)
                              decoupled from ECS; takes a GroundSampleFn callback

Editor
   TransformControls      ── object-transform gizmo (translate/rotate/scale + snap)
                              axis-end picker hit-testing; pure-data, no Camera mutation

Immersive (WebXR)
   VRController           ── session lifecycle + headset pose + eye params
                              + hand tracking; produces typed data, no Camera mutation
```

All desktop controllers share the lifecycle: construct with `(camera,
domElement, opts?)`, call `update(dt)` per frame, `dispose()` on
teardown. Each exposes `onChange` (plus `onStart` / `onEnd` on
`OrbitControls`) firing when the camera actually moves.

---

## Core Classes

### `OrbitControls` (`OrbitControls.ts`)

| Export | Role |
|--------|------|
| `OrbitControls` | Spherical-coordinate camera around a `target`. Damping-decayed target values resolved inside `update()`. |
| `OrbitControlsOptions` | Optional config: damping, rotate / pan / zoom enables and speeds, distance and angle limits, `preventDefaultGestures`. |
| `PointerEntry` | Tracked pointer record (`id`, `startX/Y`, `curX/Y`, `button`). |

```ts
export interface OrbitControlsOptions {
  enableDamping?: boolean;        dampingFactor?: number;     // true / 0.08
  enableRotate?: boolean;         enablePan?: boolean;        // true / true
  enableZoom?: boolean;           preventDefaultGestures?: boolean; // true / true
  rotateSpeed?: number;           panSpeed?: number;          // 1.0 / 1.0
  zoomSpeed?: number;                                         // 1.0
  minDistance?: number;           maxDistance?: number;       // 0 / Infinity
  minPolarAngle?: number;         maxPolarAngle?: number;     // 0 / π
  minAzimuthAngle?: number;       maxAzimuthAngle?: number;   // -Inf / +Inf
}
```

Public API: `setEnabled(v)`, `stopDamping()` (snap target to current),
`reset()` (re-sync spherical from camera), `dispose()`, `update(): boolean`
(returns whether anything changed), `panByWorldDelta(x, y, z)`,
`setTarget(v)`, `rotateAzimuth(rad)`, `rotatePolar(rad)`, `zoom(scale)`.

Pointer semantics (match three.js): left-drag = rotate, right / middle-
drag = pan, wheel / pinch = dolly. `setPointerCapture` locks the pointer
to the canvas so dragging outside the window does not lose events. Theta
wrap-around uses `MathUtils.angleDelta` for shortest-path lerp.

### `MapControls` (`MapControls.ts`)

Subclass of `OrbitControls` for map / top-down UX.

| Field | Default | Notes |
|-------|---------|-------|
| `screenSpacePanning` | `false` | `false` pans on the world XZ ground plane; `true` falls back to camera-screen panning (parent behaviour). |

```ts
export interface MapControlsOptions extends OrbitControlsOptions {
  screenSpacePanning?: boolean;
}
```

Button mapping is swapped vs. `OrbitControls`: **left = pan**,
**right = rotate**, middle = pan. Ground-plane panning uses the camera's
horizontal forward + right vectors (no `Raycaster` / `Plane` dependency);
it degrades to `(0, 0, 1)` when the camera looks straight down.

### `FlyControls` (`FlyControls.ts`)

| Export | Role |
|--------|------|
| `FlyControls` | 6-DOF free-flight controller. Directly manipulates `camera.position` + `camera.rotation` (quaternion); no `target`. |
| `FlyControlsOptions` | `movementSpeed`, `rollSpeed`, `dragToLook`, `autoForward`. |

```ts
export interface FlyControlsOptions {
  movementSpeed?: number;   // default 1.0
  rollSpeed?: number;       // default 0.005
  dragToLook?: boolean;     // default false (mouse always steers)
  autoForward?: boolean;    // default false
}
```

Keymap (matches three.js `FlyControls`): `W/S/A/D` move, `R/F` up/down,
arrows = pitch/yaw, `Q/E` roll, `Shift` = ×0.1 speed. `dragToLook=false`
→ left mouse = forward, right = back; `dragToLook=true` → mouse steering
only while a pointer is held. Movement is delta-time driven;
`update(delta)` returns whether the pose changed (epsilon-thresholded).

### `PointerLockControls` (`PointerLockControls.ts`)

| Export | Role |
|--------|------|
| `PointerLockControls` | First-person pointer-lock controller. Mouse moves only rotate (`YXZ` euler); `moveForward` / `moveRight` translate on the XZ plane (up = +Y assumed). |
| `PointerLockControlsOptions` | `minPolarAngle`, `maxPolarAngle`, `pointerSpeed`. |

```ts
export interface PointerLockControlsOptions {
  minPolarAngle?: number;   // default 0
  maxPolarAngle?: number;   // default π
  pointerSpeed?: number;    // default 1.0
}
```

Public API: `setEnabled`, `isEnabled`, `lock(unadjustedMovement?)`,
`unlock()`, `getDirection(v)` (writes normalised -Z into `v`),
`moveForward(distance)`, `moveRight(distance)`, `dispose()`. Callbacks:
`onChange`, `onLock`, `onUnlock`. Pitch is clamped to
`[π/2 - maxPolar, π/2 - minPolar]`. `moveForward` projects the camera's
right vector onto the XZ plane via `up × right` so vertical look does
not change Y. Mouse sensitivity is `0.002 × pointerSpeed` per
`movementX` / `movementY`.

### `CharacterController` (`CharacterController.ts`)

Kinematic character controller — decoupled from ECS.

| Export | Role |
|--------|------|
| `CharacterController` | Capsule-body avatar. Self-maintains `position` / `velocity` / `rotation`; unaffected by impulses. |
| `CharacterState` | `'idle' \| 'walking' \| 'running' \| 'jumping' \| 'falling'` — derived in `getState()`. |
| `CharacterControllerOptions` | `height`, `radius`, `stepHeight`, `slopeLimit` (degrees), `moveSpeed`, `runSpeed`, `jumpForce`, `gravity`, `groundTolerance`, `airControl`. |
| `GroundSampleFn` | `(x, z) => number | null` — caller-supplied ground-height query (works for voxel worlds, heightmaps, ECS scenes). |

```ts
export interface CharacterControllerOptions {
  height?: number;          radius?: number;        // 1.8 / 0.4
  stepHeight?: number;      slopeLimit?: number;    // 0.3 / 45°
  moveSpeed?: number;       runSpeed?: number;      // 4.0 / 8.0 m/s
  jumpForce?: number;       gravity?: Vector3;      // 6.0 / (0,-9.81,0)
  groundTolerance?: number; airControl?: number;    // 0.1 / 0.3
}
```

Public API: `move(dir, dt, running?)` (world dir, Y ignored; rotates
avatar to face `dir`), `jump()` (grounded only), `update(dt,
sampleGround)` (Euler → ground sample → step lift → slope limit),
`setRotation(y)`, `getForward/getRight(target?)`, `teleport(v)`,
`getState()`, `getAABB(target?)`. `update()` order: gravity →
horizontal pos → ground sample → vertical pos → collision resolve (snap
/ step-up / air) → slope-limit probe. State priority: `jumping |
falling > running > walking > idle`.

### `VRController` (`VRController.ts`)

WebXR immersion layer.

| Export | Role |
|--------|------|
| `VRController` | Session lifecycle + per-frame pose extraction. Does not modify any `Camera`; produces eye params the renderer consumes in a dual-eye pass. |
| `VRSessionOptions` | `referenceSpace`, `requiredFeatures`, `optionalFeatures`. |
| `XRReferenceSpaceType` | `'local' \| 'local-floor' \| 'viewer' \| 'bounded-floor'`. |
| `VREyeParams` | `projectionMatrix`, `viewMatrix`, `viewport` per eye. |
| `VRHeadsetPose` | `{ position: Vector3; rotation: Quaternion }`. |
| `VRHandController` | Per-hand: `hand`, `pose`, `buttons`, `axes`, `gripMatrix`, `targetRayMatrix`. |
| `VRControllerStats` | Snapshot: `isSupported`, `isPresenting`, `referenceSpace`, `controllerCount`, `frameRate`, `hasHeadsetPose`, `sessionActive`. |

```ts
export class VRController {
  isSupported: boolean;            session: XRSession | null;
  referenceSpace: XRReferenceSpaceType;   // default 'local-floor'
  leftEye: VREyeParams;            rightEye: VREyeParams;
  controllers: VRHandController[]; headsetPose: VRHeadsetPose;
  isPresenting: boolean;           frameRate: number;
  isAvailable(): boolean;
  async requestSession(opts?): Promise<boolean>;   endSession(): void;
  async setReferenceSpace(space): Promise<boolean>;
  setBaseLayer(layer: XRWebGLLayer | null): void;  // calls updateRenderState
  getController(hand): VRHandController | null;
  getEyeParams(eye): VREyeParams;    getHeadsetPose(): VRHeadsetPose;
  update(frame: XRFrame): boolean;   onSessionEnd(cb): () => void;
  getStats(): VRControllerStats;     dispose(): void;
}
```

`update(frame)` decomposes `pose.transform.matrix` into position +
quaternion, copies each `XRView`'s projection + view matrices into
`leftEye` / `rightEye`, and syncs `controllers[]` with
`session.inputSources` by `handedness`. Without `navigator.xr`,
`isAvailable() === false`, `requestSession()` → `false`, `update()` is a
no-op. `VRController` owns no GL resources.

### `TransformControls` (`TransformControls.ts`)

Editor object-transform gizmo — the `three.js` `TransformControls`
counterpart. Unlike the camera controllers above it edits an arbitrary
target `Object3D` (position / rotation / scale) and renders its own
visible gizmo instead of driving a camera.

| Export | Role |
|--------|------|
| `TransformControls` | Attach to an object → visible gizmo + pointer-driven editing of its transform. |
| `TransformMode` | `'translate' \| 'rotate' \| 'scale'` — which transform a drag edits. |
| `TransformSpace` | `'world' \| 'local'` — axis frame for translate / rotate. |
| `TransformAxis` | Hit axis: `'X' \| 'Y' \| 'Z' \| 'XY' \| 'XZ' \| 'YZ' \| 'XYZ'` (and `-X`… for scale). |
| `TransformControlsOptions` | `mode`, `space`, `size`, `translationSnap` / `rotationSnap` / `scaleSnap`, `preventDefaultGestures`, `min/maxX/Y/Z` clamps, `enableHover`. |
| `TransformColors` | Per-axis gizmo colors (`xAxis` / `yAxis` / `zAxis` / `active`). |
| `buildDragPlane` | Pure data: ray-plane intersection for a drag. |
| `computeTranslate` | Pure data: drag → new target position (snap-aware, clamped). |
| `computeScale` | Pure data: drag → new target scale (snap-aware, sign-preserving). |
| `computeRotate` | Pure data: drag → rotation axis + angle (snap-aware). |
| `TranslateContext` / `ScaleContext` / `RotateContext` | Pure-data inputs for the compute functions. |
| `RotateResult` | `{ rotationAxis: Vector3; rotationAngle: number }`. |

```ts
export class TransformControls {
  mode: TransformMode;   space: TransformSpace;   // 'translate' / 'world'
  translationSnap: number | null;  rotationSnap: number | null;
  scaleSnap: number | null;        enabled: boolean;
  axis: TransformAxis | null;      dragging: boolean;
  onChange / onMouseDown / onMouseUp / onObjectChange: (() => void) | null;
  constructor(camera: Camera, domElement: HTMLElement, opts?: TransformControlsOptions);
  getHelper(): Object3D;            // gizmo root — add to the scene to render
  getPicker(mode: TransformMode): Object3D;   // invisible, raycastable
  getGizmo(mode: TransformMode): Object3D;    // visible handles
  attach(object: Object3D): this;   detach(): this;
  getObject(): Object3D | null;
  setMode(mode); setSpace(space); setSize(size);
  setTranslationSnap(v); setRotationSnap(v); setScaleSnap(v);
  setColors(xAxis, yAxis, zAxis, active): void;
  reset(): void;  update(): void;  dispose(): void;
}
```

Pointer flow: `pointerdown` hit-tests the invisible picker subtrees via
`Raycaster` → sets `axis`; `pointermove` projects the drag onto the
drag plane and maps it to the target transform through the pure compute
functions (snap + axis clamps applied); `pointerup` ends the drag and
fires `onMouseUp`. `getHelper()` returns the gizmo root `Object3D` —
add it to the scene once and call `update()` per frame. The gizmo is
built from plain `BufferGeometry` + `MeshBasicMaterial` meshes, so it
renders with any renderer. The pure compute functions are WebGL-free and
unit-tested (47 tests in `TransformControls.test.ts`).

---

## Usage

### OrbitControls (default viewer)

```ts
import { PerspectiveCamera, OrbitControls } from '@vreen/engine';
const camera = new PerspectiveCamera(60, w / h, 0.1, 200);
camera.position.set(4, 3, 6);
const controls = new OrbitControls(camera, canvas, {
  enableDamping: true, dampingFactor: 0.08,
  minDistance: 1, maxDistance: 50, maxPolarAngle: Math.PI * 0.49,
});
// frame loop: if (controls.update()) renderer.render(scene, camera);
controls.dispose();   // teardown
```

### FlyControls + PointerLockControls

```ts
import { FlyControls, PointerLockControls } from '@vreen/engine';
const fly = new FlyControls(camera, canvas, { movementSpeed: 4, rollSpeed: 0.02, dragToLook: true });
// frame loop: fly.update(dt); renderer.render(scene, camera);

const fp = new PointerLockControls(camera, canvas, { minPolarAngle: 0.1, maxPolarAngle: Math.PI - 0.1, pointerSpeed: 1.2 });
fp.onLock = () => hud.showCrosshair(true);   fp.onUnlock = () => hud.showCrosshair(false);
canvas.addEventListener('click', () => fp.lock());
// frame loop: if (fp.isLocked) { keys.KeyW && fp.moveForward(4*dt); ... } renderer.render(scene, camera);
```

### CharacterController on a heightmap

```ts
import { CharacterController, Vector3 } from '@vreen/engine';
const hero = new CharacterController(new Vector3(0, 5, 0), {
  height: 1.8, radius: 0.4, stepHeight: 0.35, slopeLimit: 50, jumpForce: 7,
});
const sampleGround = (x: number, z: number) => heightmap.sample(x, z);  // caller-supplied
// frame loop:
//   hero.move(dir, dt, keys.Shift);  if (keys.Space) hero.jump();
//   hero.update(dt, sampleGround);
//   animFSM.setState(hero.getState());  mesh.position.copy(hero.position);  mesh.rotation.y = hero.rotation;
```

### VRController immersive pass

```ts
import { VRController } from '@vreen/engine';
const vr = new VRController();
if (vr.isAvailable() && await vr.requestSession({ referenceSpace: 'local-floor' })) {
  vr.setBaseLayer(new XRWebGLLayer(vr.session, gl));
  vr.session.requestAnimationFrame(function loop(t, frame) {
    vr.update(frame);
    const L = vr.getEyeParams('left'), R = vr.getEyeParams('right');
    renderer.renderEye(scene, L.projectionMatrix, L.viewMatrix, L.viewport);
    renderer.renderEye(scene, R.projectionMatrix, R.viewMatrix, R.viewport);
    vr.session.requestAnimationFrame(loop);
  });
}
// teardown: vr.dispose();
```

### TransformControls — attach a gizmo to an object

```ts
import { TransformControls } from '@vreen/engine';
const tc = new TransformControls(camera, canvas, { mode: 'translate', space: 'world', translationSnap: 0.5 });
scene.add(tc.getHelper());                  // gizmo renders inside the scene
tc.attach(mesh);                            // start editing `mesh`
tc.onObjectChange = () => outliner.refresh();
// frame loop: tc.update(); renderer.render(scene, camera);
tc.setMode('scale'); tc.setScaleSnap(0.25); // switch mode / snapping at runtime
// teardown: tc.detach(); tc.dispose();
```

---

## Invariants

- Every desktop controller takes `(camera, domElement, opts?)` and requires `dispose()` on teardown (else DOM listeners leak).
- `update(dt)` / `update()` is called once per frame; controllers never
  call `camera.updateMatrixWorld()` (renderer's job). `OrbitControls`
  and `FlyControls` return `boolean` to signal pose change.
- `OrbitControls` theta interpolates along the shortest angular path
  (`MathUtils.angleDelta`); `MapControls` ground-plane panning degrades
  to `(0, 0, 1)` when the camera looks straight down.
- `FlyControls.update(delta)` is delta-time driven; `Shift` ×0.1 speed.
  `PointerLockControls.moveForward` / `moveRight` project onto XZ and
  preserve `y`; pitch clamps to `[π/2 - maxPolar, π/2 - minPolar]`.
- `CharacterController` is kinematic (ignores impulses); ECS `Rigidbody`
  coupling is the caller's job. `update(dt, sampleGround)` requires a
  caller-supplied `GroundSampleFn`; `null` return → free fall.
- `VRController` owns no GL resources; `XRWebGLLayer` is renderer-created
  via `setBaseLayer`. It never mutates a `Camera`. Without `navigator.xr`,
  every method degrades to a safe no-op / `false`.
- All controllers honour `setEnabled(false)`: input ignored, listeners
  remain attached (so `setEnabled(true)` resumes without re-wiring).
- `TransformControls` is the only controller that drives an arbitrary
  `Object3D` (not a camera). It owns no GL resources; the gizmo is a
  plain `Object3D` subtree the caller adds via `getHelper()`. Picker
  meshes stay invisible (`visible=false`) yet remain raycastable — the
  pure compute functions (`buildDragPlane` / `computeTranslate` /
  `computeScale` / `computeRotate`) are unit-tested without WebGL
  (47 tests in `TransformControls.test.ts`).

---

## References

- `src/engine/Cameras/Camera.ts` — camera type every desktop controller drives.
- `src/engine/Math/MathUtils.ts` — `angleDelta`, `wrapAngle`, `clamp`.
- `src/engine/Animation/AnimationStateMachine.ts` — consumes `CharacterController.getState()`.
- `src/engine/ECS/PhysicsComponents.ts` — `Rigidbody` / `Collider` for kinematic coupling.
- three.js `OrbitControls` / `FlyControls` / `PointerLockControls` / `MapControls` / `TransformControls` — input semantics and gizmo editing. WebXR Device API (`navigator.xr`, `XRSession`, `XRFrame`, `XRInputSource` — https://immersive-web.github.io/webxr/).
- `src/engine/Controls/index.ts` — barrel re-exports for the module.
