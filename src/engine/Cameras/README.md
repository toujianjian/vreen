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
> fixed motion modes, a `CameraPath` that animates a camera along a
> Catmull-Rom keyframed spline (uniform or centripetal) with loop modes
> / easing / auto-look / handheld noise, a `PerlinShake` that produces
> trauma²-decayed multi-octave Perlin noise camera shake (6 independent
> translation/rotation channels), a `StereoCamera` for off-axis dual-eye
> VR / 3D rendering, a `CubeCamera` that captures 6-face environment
> maps for real-time IBL / reflections / refractions, a `SpringArm`
> that drives a third-person camera with collision-aware boom retraction
> (ray or sphere probe) and frame-rate-independent exponential smoothing
> of arm length / target position / look-at point, and a `CameraBob`
> that produces speed-driven periodic head bob (sine-based vertical bob
> + half-frequency lateral sway + sin⁶ footstep impulse) for
> first-person / third-person walking game feel.

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

CameraPath                     ── keyframed Catmull-Rom spline path
   ├── keyframes: CameraPathKeyframe[]  (time / position / lookAt / fov / roll)
   ├── parametrization: 'uniform' | 'centripetal'   (centripetal avoids cusps)
   ├── loopMode: 'once' | 'loop' | 'pingpong'
   ├── easing: (t) => t   (smoothstep / easeInOutCubic / custom)
   ├── autoLookAlongPath  (lookAt derived from spline tangent, ignores kfs)
   ├── enableHandheldNoise(amount, freq)   (Perlin jitter on position)
   └── sample(out?) → CameraPose  (position / lookAt / fov / roll)

PerlinShake                    ── trauma² multi-octave Perlin camera shake
   ├── trauma ∈ [0, 1]    (addTrauma stacks; setTrauma clamps)
   ├── amount = trauma²   (non-linear decay: heavy hit → soft tail)
   ├── 6 independent noise channels  (translation xyz + rotation xyz)
   ├── per-axis frequency (1.0/1.3/1.7× base — avoids axis sync)
   ├── seedable            (deterministic playback / recording)
   └── presets: handheld / recoil / explosion / impact / earthquake

StereoCamera                   ── off-axis dual-eye (Kooima 2008)
   ├── eyeSep / focalLength       (IPD + convergence plane)
   ├── cameraL / cameraR          (two PerspectiveCamera, eye offset on local X)
   └── update(camera)             (copy intrinsics + apply asymmetric frustum)

CubeCamera                     ── 6-face 90° environment map capture
   ├── cameras: PerspectiveCamera[6]   (px, nx, py, ny, pz, nz)
   ├── renderTarget: CubeRenderTarget  (resolution / format / mipmap / colorSpace)
   ├── update(renderer, scene)         (delegates GL work to renderer.updateCubeCamera)
   └── autoUpdate / version            (matrixWorld sync + dirty tracking)

SpringArm                      ── collision-aware third-person boom
   ├── target: Object3D | null         (player / vehicle to follow)
   ├── armOffset: Vector3              (default (0, 2, -5); length → maxDistance)
   ├── targetOffset: Vector3           (lookAt point relative to target, default (0, 1.5, 0))
   ├── probeType: 'ray' | 'sphere'     (default 'sphere'; sphere avoids thin-wall clipping)
   ├── probeRadius: number             (default 0.3; >0 → sphere probe approximation)
   ├── collisionMargin: number         (default 0.2; camera stops hitDist - margin - probeRadius)
   ├── probe: ProbeFn | null           (custom collision probe; falls back to Raycaster)
   ├── collisionObjects: Object3D[]    (used by default Raycaster probe)
   ├── exponential smoothing           (alpha = 1 - exp(-rate * dt * 60); no overshoot)
   │   ├── springStiffness / springDamping       (arm length smoothing, 0.35 / 0.65)
   │   ├── lookAtStiffness / lookAtDamping       (lookAt point smoothing, 0.4 / 0.6)
   │   └── positionStiffness / positionDamping   (target position smoothing, 0.5 / 0.5)
   └── presets: thirdPerson / overShoulder / farFollow / firstPerson

CameraBob                      ── speed-driven periodic head bob
   ├── phase: number                    (accumulates: dt * speed * freq * 2π)
   ├── bobFrequency: number             (Hz, default 0.5 = 1 step/sec)
   ├── bobAmount / swayAmount           (meters, 0.05 / 0.03)
   ├── footstepAmount: number           (meters, 0.02; sin⁶ peaked impulse)
   ├── rotationAmount: number           (radians roll, 0.01)
   ├── maxSpeed: number                 (m/s normalization, default 5)
   ├── crouchScale: number              (0..1 amplitude multiplier, default 0.4)
   ├── smoothedSpeedFactor              (exponential smoothing, no instant jump)
   ├── bobY = sin(phase) * bobAmount    (vertical bob, full freq)
   ├── swayX = cos(phase*0.5) * sway    (lateral sway, half freq — 2 steps per cycle)
   ├── footstep = sin⁺(phase)⁶ * amount (sharp impact spike at each step peak)
   └── presets: fpsWalk / fpsRun / fpsCrouch / tpsWalk / spectator
```

`CinematicCamera`, `CameraRig`, `CameraPath`, and `SpringArm` are
complementary: `CinematicCamera` plays a *scripted* shot sequence
(predetermined discrete poses with transitions between them),
`CameraPath` plays a *continuous* keyframed spline (smooth motion
through control points with no shot boundaries), `CameraRig`
*reactively* follows a live `Object3D` (player / vehicle) with a
choice of motion modes, and `SpringArm` *reactively* follows a target
while preventing the camera from clipping through geometry. They
compose — a `CameraRig` can drive a `SpringArm.target` (rig decides
where the camera should orbit, arm retracts it from walls); a
`CinematicCamera` can cut between rigs; a `CameraPath` can drive a
flythrough while `PerlinShake` overlays explosion shake. `PerlinShake` is independent of all four: it produces a per-frame
`ShakeOffset` (translation + rotation) that the caller adds to any
camera's pose. `CameraBob` is similarly independent: it produces a
per-frame `CameraBobOffset` (translation + rotation + speed factor)
that the caller adds to any camera's pose. `PerlinShake` and
`CameraBob` compose — `CameraBob` provides the periodic walking
rhythm while `PerlinShake` overlays random impact feedback (the
two are additive and do not interfere). `CubeCamera` is orthogonal:
it captures the scene into a cube map rather than rendering a single
view, and its output feeds the material system's `envMap` / IBL
pipeline.

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

### `CameraPath` (`CameraPath.ts`)

Keyframed Catmull-Rom spline path animation. Drives a camera through a
sequence of `CameraPathKeyframe`s with smooth C¹-continuous interpolation
of position and lookAt, plus linear interpolation of `fov` and `roll`.
Adapted from o3de Track View / Sequence Cinematics and Unity Timeline
Cinemachine Path, with the underlying spline math from three.js
`CatmullRomCurve3`.

| Export | Role |
|--------|------|
| `CameraPath` | Spline path driver. Owns `keyframes`, `loopMode`, `parametrization`, `easing`, playback state. |
| `CameraPathKeyframe` | Interface: `time`, `position`, `lookAt`, `fov`, `roll`. |
| `CameraPose` | Sampling result: `position`, `lookAt`, `fov`, `roll`. |
| `PathLoopMode` | `'once' \| 'loop' \| 'pingpong'`. |
| `SplineParametrization` | `'uniform' \| 'centripetal'`. |
| `EasingFn` | `(t: number) => number` — applied to per-segment normalized progress. |
| `CameraPathJSON` | Serialization shape for `exportJSON()` / `importJSON()`. |
| `smoothstepEasing` / `easeInOutCubic` | Built-in easing functions. |

```ts
export class CameraPath {
  keyframes: CameraPathKeyframe[];
  loopMode: PathLoopMode;                 // default 'once'
  parametrization: SplineParametrization; // default 'centripetal'
  easing: EasingFn;                       // default identity
  enableRoll: boolean;                    // default true
  autoLookAlongPath: boolean;             // default false (use kf.lookAt)
  autoLookDistance: number;               // default 10 (world units ahead)

  addKeyframe(kf): this;                  // inserts in time order
  setKeyframes(kfs): this;                // bulk replace
  removeKeyframe(index): boolean;
  clear(): this;
  play(): this;  pause(): this;  stop(): this;
  seek(timeSec): this;                    // clamp to [0, duration]
  getDuration(): number;                  // last.time - first.time
  getCurrentTime(): number;
  getProgress(): number;                  // [0,1]
  isPlaying(): boolean;
  update(dt): this;                       // advance time, apply loop mode
  sample(out?): CameraPose;               // interpolate pose at currentTime
  enableHandheldNoise(amount, freq?): this;
  disableHandheldNoise(): this;
  exportJSON(): CameraPathJSON;
  importJSON(data): this;
}
```

**Catmull-Rom math** — for a segment between control points `P1` and
`P2`, the spline uses the four points `P0, P1, P2, P3` (where `P0` is
the previous control point and `P3` is the next). At segment endpoints
the boundary control point is duplicated (natural end condition).

- **uniform (α=0)**: classic Catmull-Rom. Fast, but can produce cusps
  and self-intersections when control points are unevenly spaced:
  ```
  q(t) = 0.5 · [(2·P1) + (-P0+P2)·t + (2·P0-5·P1+4·P2-P3)·t² + (-P0+3·P1-3·P2+P3)·t³]
  ```
- **centripetal (α=0.5)**: node parameters are `t_i = t_{i-1} + √|P_i - P_{i-1}|`.
  Eliminates cusps and self-intersections, guarantees no overshoot, and
  is the recommended default for camera paths. Implemented via the
  Barry-Goldman recursive blending algorithm (parameter-independent CR
  evaluation).

**Time mapping** — each keyframe carries an absolute `time` (seconds,
non-decreasing). To sample at world time `t`:
1. Locate the segment `[k_i, k_{i+1}]` such that
   `k_i.time ≤ t ≤ k_{i+1}.time` (binary search, with a hot-path
   optimization that checks `lastSegment` and `lastSegment+1` first).
2. Compute `localT = (t - k_i.time) / (k_{i+1}.time - k_i.time)`.
3. Apply easing: `easedT = easing(localT)`.
4. Evaluate the Catmull-Rom spline at `easedT` for position and lookAt.
5. Linearly interpolate `fov` and `roll` at `localT` (not `easedT` —
   FOV/roll should not be eased, to avoid visual distortion).

**Loop modes**:
- `once` — plays from 0 to `duration`, then stops (time clamps to
  `duration`, `isPlaying()` returns false).
- `loop` — wraps: `time -= duration` when exceeding, so playback
  restarts from the beginning. The wrap is instantaneous (no crossfade);
  for seamless loops ensure the first and last keyframes have identical
  poses.
- `pingpong` — reverses direction at each endpoint. `pingpongDir`
  tracks the current direction (+1 forward, -1 reverse).

**`autoLookAlongPath`** — when enabled, ignores the keyframes' `lookAt`
fields and instead computes the lookAt point as
`position + normalize(spline_tangent(t)) * autoLookDistance`. The
tangent is estimated by central differencing of the position spline at
`t ± ε` (ε = 1e-3). Useful for flythroughs where the camera should
always face the direction of motion.

**`enableHandheldNoise(amount, freq)`** — adds Perlin-noise jitter to
the sampled position (not lookAt, to keep the focus point stable).
Internally uses `ImprovedNoise` from `Math/`. The phase advances at
`freq` Hz. Typical for documentary-style handheld camera effects.

**`sample(out?)`** — returns a `CameraPose`. If `out` is provided,
fills it instead of allocating a new object (useful in hot loops).
The returned `lookAt` is a world-space point; the caller calls
`camera.lookAt(lookAt.x, lookAt.y, lookAt.z)`.

**`exportJSON()` / `importJSON()`** — round-trips the keyframes, loop
mode, parametrization, and duration. Time values, positions, lookAts,
FOVs, and rolls are all preserved exactly. `easing` and
`enableHandheldNoise` state are **not** serialized (functions cannot
be JSON-encoded; the caller re-applies them after import).

### `PerlinShake` (`PerlinShake.ts`)

High-quality camera shake based on the **trauma² model** with
multi-octave Perlin noise. Adapted from NVIDIA GDC 2016
"Mission Improbable: A Gentle Introduction to Camera Shake" and
o3de AzFramework Camera Shake Component.

The trauma² model addresses a fundamental flaw in linear-amplitude
decay: when amplitude decays linearly, the tail of the shake feels
artificially energetic (the eye perceives a constant-frequency
wobble). By decaying `trauma` linearly and computing
`amount = trauma²`, the effective shake amplitude drops quickly after
the initial impact but lingers as a subtle tremor — matching how real
cameras respond to impulses.

| Export | Role |
|--------|------|
| `PerlinShake` | Shake generator. Owns `trauma`, config, internal `ImprovedNoise`. |
| `ShakeOffset` | Output: `translation: Vector3`, `rotation: Vector3` (radians), `amount: number`. |
| `PerlinShakeJSON` | Serialization shape. |
| `PerlinShakePresets` | Factory object with `handheld()`, `recoil()`, `explosion()`, `impact()`, `earthquake()`. |

```ts
export class PerlinShake {
  maxOffset: number;     // meters, default 0.5
  maxAngle: number;      // radians, default 0.05 (~2.9°)
  frequency: number;     // Hz, default 1.0
  decay: number;         // trauma per second, default 1.5
  octaves: number;       // Perlin octave count, default 3
  persistence: number;   // amplitude decay per octave, default 0.5
  lacunarity: number;    // frequency growth per octave, default 2.0
  trauma: number;        // [0,1] current trauma
  seed: number;          // noise seed (changes pattern completely)

  constructor(seed?: number);
  addTrauma(amount): number;   // stack, clamp to [0,1]; returns new trauma
  setTrauma(value): this;      // clamp to [0,1]
  reset(): this;               // trauma = 0, time = 0
  isActive(): boolean;         // trauma > 0
  getAmount(): number;         // trauma²
  update(dt): this;            // advance time + decay trauma
  getOffset(out?): ShakeOffset;
  exportJSON(): PerlinShakeJSON;
  importJSON(data): this;
}
```

**Noise channel layout** — `getOffset()` samples six independent Perlin
noise channels, each at a distinct frequency and phase offset to avoid
axis synchronization (synchronized axes look "mechanical"):

| Channel | Frequency multiplier | Phase offset |
|---------|----------------------|--------------|
| translation.x | 1.0× | `seed + 0` |
| translation.y | 1.3× | `seed + 100` |
| translation.z | 1.7× | `seed + 200` |
| rotation.x (pitch) | 1.1× | `seed + 300` |
| rotation.y (yaw)   | 1.5× | `seed + 400` |
| rotation.z (roll)  | 1.9× | `seed + 500` |

Each channel is multi-octave fBm (fractal Brownian motion): low
frequencies provide the main impact, high frequencies add detail
"chatter". The final offset is `noise_value * max * amount` where
`amount = trauma²`.

**`addTrauma(amount)`** — stacks trauma (clamped to 1.0). Multiple
shake events in quick succession (e.g. a burst of explosions) produce
cumulative intensity up to the cap, then `decay` bleeds it off.

**`getOffset(out?)`** — returns the per-frame offset. When
`trauma === 0`, returns all zeros without invoking the noise function
(early-out). The `out` parameter enables zero-allocation hot loops.

**Presets**:
- `handheld()` — small offset (0.05), slow decay (0.5), 2 octaves,
  `trauma=1.0` (continuous; caller resets when done). For
  documentary-style constant handheld jitter.
- `recoil()` — tiny offset (0.02), small angle (0.03), high frequency
  (8 Hz), fast decay (4.0). For per-shot weapon recoil.
- `explosion()` — large offset (0.4), large angle (0.08), medium
  frequency (2.5 Hz), 4 octaves, medium decay (1.2). For nearby
  explosions.
- `impact()` — medium offset (0.3), medium angle (0.06), high
  frequency (5 Hz), medium decay (2.5). For vehicle collisions / falls.
- `earthquake()` — small offset (0.15), tiny angle (0.02), low
  frequency (0.6 Hz), very slow decay (0.3). For environmental ambience.

**Composition with `CinematicCamera.shake()`** — `CinematicCamera` has
its own simpler sine-based `shake()` for quick one-off events. For
professional-quality shake (explosions, combat, collisions), use
`PerlinShake` separately and add its offset to the camera after
`CinematicCamera.update()` has written the base pose:

```ts
cine.update(dt);
shake.update(dt);
const offset = shake.getOffset();
cine.camera.position.add(offset.translation);
// apply rotation offset to camera quaternion (caller responsibility)
```

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

### `SpringArm` (`SpringArm.ts`)

Collision-aware camera boom with frame-rate-independent exponential
smoothing. Prevents third-person cameras from clipping through geometry
by retracting the boom when obstructed, using ray or sphere probes.
Adapted from Unreal `SpringArmComponent`, Unity Cinemachine Collider,
and o3de AtomCamera collision probe conventions.

| Export | Role |
|--------|------|
| `SpringArm` | Boom driver. Owns `target`, `armOffset`, `probeType`, smoothing parameters, and runtime collision state. |
| `ProbeFn` | Custom collision probe function type: `(origin, direction, maxDist) => hitDist \| null`. |
| `ProbeType` | `'ray' \| 'sphere'` — probe shape. |
| `SpringArmJSON` | Serialization shape (excludes `target` / `camera` references). |
| `SpringArmPresets` | Factory object with `thirdPerson()`, `overShoulder()`, `farFollow()`, `firstPerson()`. |

```ts
export class SpringArm {
  camera: Camera | null;             // driven camera (null = internal-only)
  target: Object3D | null;           // follow target (null → update is no-op)
  armOffset: Vector3;                // default (0, 2, -5)
  targetOffset: Vector3;             // lookAt offset relative to target, default (0, 1.5, 0)
  maxDistance: number;               // derived from armOffset.length(), overridable
  probeRadius: number;               // default 0.3 (sphere radius; 0 = ray)
  collisionMargin: number;           // default 0.2 (retract buffer)
  probeType: ProbeType;              // default 'sphere'
  springStiffness: number;           // default 0.35 (arm length smoothing rate)
  springDamping: number;             // default 0.65 (arm length smoothing lag)
  lookAtStiffness: number;           // default 0.4
  lookAtDamping: number;             // default 0.6
  positionStiffness: number;         // default 0.5 (target position smoothing)
  positionDamping: number;           // default 0.5
  currentLength: number;             // smoothed arm length (readable)
  probe: ProbeFn | null;             // custom probe; null → Raycaster
  collisionObjects: Object3D[];      // Raycaster collision list

  constructor(camera?: Camera | null);
  follow(target: Object3D): this;              // snap-align smoothing state
  setArmOffset(offset: Vector3): this;         // recompute maxDistance
  setCollisionObjects(objects: Object3D[]): this;
  setProbe(probe: ProbeFn | null): this;
  update(dt: number): this;                    // probe + smooth + write camera
  exportJSON(): SpringArmJSON;
  importJSON(data: SpringArmJSON): this;
}
```

**`update(dt)` flow** (per frame):
1. Smooth `target.position` → `smoothedTargetPos` (exponential, frame-rate-independent).
2. Compute arm direction = normalized `armOffset`.
3. Probe origin = `smoothedTargetPos + targetOffset`.
4. Run collision probe along arm direction up to `maxDistance`.
5. If hit: `targetLength = hitDist - collisionMargin - probeRadius`
   (clamped to `[0, maxDistance]`). If miss: `targetLength = maxDistance`.
6. Smooth `currentLength` toward `targetLength` using exponential smoothing.
7. Final camera position = `probeOrigin + armDir * currentLength`.
8. Smooth lookAt point = `smoothedTargetPos + targetOffset` → write `camera.lookAt`.

**Probe types**:
- `ray` — single ray cast. Fast, but can clip through thin geometry
  (e.g. monoleaf walls) when the camera center misses the wall but
  the camera frustum intersects it.
- `sphere` — approximates a sphere sweep by reserving `probeRadius`
  behind the hit point. This is a conservative approximation: it does
  not perform a true swept-sphere test, but in practice eliminates
  the most common thin-wall clipping artifacts. For a true sphere
  sweep, inject a custom `probe` function backed by a swept-sphere
  physics engine.

**Exponential smoothing** — all three smoothing channels (arm length,
lookAt, target position) use the same formula:

```
alpha = 1 - exp(-rate * dt * 60)
rate  = stiffness * (1 - damping * 0.5)
value += (target - value) * alpha
```

This is frame-rate independent (the `* 60` factor normalizes to a
60 Hz reference) and monotonic — it never overshoots, which is
critical for camera distance smoothing (overshoot would cause the
camera to dip past a wall before settling). At 60 fps with
`stiffness=0.35`, `damping=0.65`, `alpha ≈ 0.21`, converging to 95%
in ~0.5 seconds. This matches Unreal's `bEnableCameraLag` +
`CameraLagSpeed` behavior and is more stable than a velocity-based
spring (which can oscillate).

**`follow(target)`** — immediately copies `target.position` into
`smoothedTargetPos` and resets `currentLength = maxDistance`. This
avoids a large initial jump from the origin (0, 0, 0) to the target.
Subsequent `update(dt)` calls apply smoothing.

**`setArmOffset(offset)`** — copies the offset and recomputes
`maxDistance = offset.length()`. Does not resize `currentLength`
(the next `update()` will smooth toward the new `maxDistance`).

**Custom probe injection** — the default probe uses `Raycaster`
against `collisionObjects`. For engines with bespoke collision
(VREEN Voxel DDA, physics engine swept tests, NavMesh boundaries),
inject `probe`:

```ts
arm.setProbe((origin, dir, max) => voxelWorld.raycast(origin, dir, max));
```

When `probe` is non-null, `collisionObjects` and `probeType` are
ignored. The probe contract is `(origin, normalizedDir, maxDist) =>
hitDist | null` — returning `null` (miss) lets the arm extend to
`maxDistance`.

**Presets**:
- `thirdPerson()` — `(0, 2.5, -6)` arm, sphere probe radius 0.35,
  margin 0.25, stiffness 0.4 / damping 0.6. The default for action /
  adventure third-person games.
- `overShoulder()` — `(1.2, 1.8, -3.5)` offset (right shoulder),
  shorter arm, stiffer spring (0.5 / 0.5) for tighter aim-camera feel.
- `farFollow()` — `(0, 5, -12)` arm, larger probe radius 0.5, softer
  spring (0.25 / 0.75) for vehicle / mount following.
- `firstPerson()` — zero arm length, `probeType = 'ray'`, stiffness
  1.0 / damping 0.0 (instant). Only the lookAt smoothing is active;
  the camera sits at the target position.

**Composition with `CameraRig`** — `CameraRig` provides orbit / crane
motion; `SpringArm` provides collision retraction. To combine, drive
`SpringArm.target` from `CameraRig.position`:

```ts
const rig = new CameraRig(/* camera= */ null);
rig.follow(playerEntity).setType('orbit');
rig.radius = 6;

const arm = new SpringArm(mainCamera);
arm.setCollisionObjects(levelGeometry);

// frame loop:
rig.update(dt);              // compute rig.position (orbit around player)
arm.target.position.copy(rig.position);  // feed rig output to arm
arm.update(dt);              // arm retracts from walls, writes mainCamera
```

This is preferable to running `CameraRig.update(dt)` directly on the
camera when the rig's orbit path can clip through walls.

**Composition with `PerlinShake`** — `PerlinShake` should be applied
*after* `SpringArm.update()` so the shake offset is in camera-local
space:

```ts
arm.update(dt);
shake.update(dt);
const offset = shake.getOffset();
arm.camera!.position.add(offset.translation);
// apply rotation offset to camera quaternion (caller responsibility)
```

### `CameraBob` (`CameraBob.ts`)

Speed-driven periodic camera head bob for first-person / third-person
walking game feel. Produces a per-frame `CameraBobOffset` (translation
+ rotation) that the caller adds to the camera's local-space pose.
Adapted from UE `PlayerCameraManager::ApplyCameraBob`, Unity community
Head Bob scripts, and o3de AzFramework Camera Bob Component.

The core insight from GDC 2020 "Game Feel in Half-Life: Alyx": bob
amplitude should map **non-linearly** to speed (not just linearly),
and the footstep impulse should be a sharp spike (sin⁶), not a smooth
sine — this is what makes walking feel "weighty" rather than
"floaty".

| Export | Role |
|--------|------|
| `CameraBob` | Bob generator. Owns `phase`, config, internal smoothed speed factor. |
| `CameraBobOffset` | Output: `translation: Vector3`, `rotation: Vector3` (radians), `speedFactor: number`, `isFootstep: boolean`. |
| `CameraBobJSON` | Serialization shape. |
| `CameraBobPresets` | Factory object with `fpsWalk()`, `fpsRun()`, `fpsCrouch()`, `tpsWalk()`, `spectator()`. |

```ts
export class CameraBob {
  bobFrequency: number;       // Hz, default 0.5 (1 step/sec)
  bobAmount: number;          // meters, default 0.05
  swayAmount: number;         // meters, default 0.03
  footstepAmount: number;     // meters, default 0.02
  rotationAmount: number;     // radians (roll), default 0.01
  maxSpeed: number;           // m/s normalization, default 5
  crouchScale: number;        // 0..1, default 0.4
  phase: number;              // accumulated phase (radians)
  footstepThreshold: number;  // default 0.5

  update(dt: number, speed: number, crouching?: boolean): this;
  getOffset(out?: CameraBobOffset): CameraBobOffset;
  reset(): this;
  exportJSON(): CameraBobJSON;
  importJSON(data: CameraBobJSON): this;
}
```

**Waveform math** — the offset is computed from a single accumulated
`phase` value, producing four correlated signals:

| Signal | Formula | Frequency | Purpose |
|--------|---------|-----------|---------|
| `bobY` (vertical) | `sin(phase) × bobAmount × sf` | full | camera moves up/down with each step |
| `swayX` (lateral) | `cos(phase × 0.5) × swayAmount × sf` | half | camera sways left/right; one full sway per two steps (simulates left-right-left-right alternation) |
| `roll` | `cos(phase × 0.5) × rotationAmount × sf` | half | camera tilts in sync with sway |
| `footstep` | `sin⁺(phase)⁶ × footstepAmount × sf` | full (spike) | sharp downward impulse at each step peak |

Where `sf` = `smoothedSpeedFactor ∈ [0, 1]` (speed / maxSpeed,
crouch-scaled, exponentially smoothed).

**Frequency ratio (2:1)** — `bobY` uses `sin(phase)` (full frequency)
while `swayX` uses `cos(phase × 0.5)` (half frequency). This means
two `bobY` peaks occur per one `swayX` cycle, simulating the
left-foot / right-foot alternation: each step produces a bob peak,
and the sway completes a full left-right-left cycle over two steps.

**Footstep impulse (sin⁶)** — `max(0, sin(phase))⁶` produces a very
sharp spike at `phase = π/2 + 2πn` (the top of each bob peak) and is
near-zero everywhere else. At `sin = 0.707`, `sin⁶ ≈ 0.125`; at
`sin = 0.5`, `sin⁶ ≈ 0.016`. This creates a brief, weighty "thud"
at each step landing — far more convincing than a smooth sine, which
feels "floaty". The impulse is applied as a downward translation
(subtracted from `translation.y`) and a small pitch-down rotation.

**Speed-dependent phase** — the phase advances at
`dt × speed × bobFrequency × 2π`, so higher speed = faster steps
(running has a higher step frequency than walking). At speed = 0,
the phase does not advance, so the bob freezes at its current
position (no phantom bobbing while standing still).

**Smoothed speed factor** — the raw speed / maxSpeed ratio is
exponentially smoothed (`alpha = 1 - exp(-8 × dt)`) before being
applied to the amplitude. This prevents the bob amplitude from
snapping instantly when the player starts/stops moving — instead it
fades in/out over ~0.2 seconds, which feels natural.

**Crouch mode** — when `crouching = true`, the amplitude is scaled by
`crouchScale` (default 0.4). The frequency is unchanged (step
frequency stays the same; only step amplitude decreases, matching
real crouch-walking biomechanics).

**`update(dt, speed, crouching)`** — advances the phase and updates
the smoothed speed factor. `speed` is typically the player's
horizontal velocity magnitude (`velocity.xz.length()`). Negative
speeds are treated as zero (no reverse bobbing).

**`getOffset(out?)`** — returns the current offset. When
`smoothedSpeedFactor ≤ 0.0001`, returns all zeros (early-out, no
trig evaluation). The `out` parameter enables zero-allocation hot
loops. The `isFootstep` flag is true when the footstep impulse
exceeds `footstepThreshold × footstepAmount × sf` — use it to
trigger footstep sound effects.

**`reset()`** — zeros the phase and smoothed speed factor. Call after
teleportation / respawn to avoid the bob resuming mid-cycle from a
stale phase.

**Presets**:
- `fpsWalk()` — 0.5 Hz, 5cm bob, 3cm sway, 2cm footstep. Standard
  first-person walking.
- `fpsRun()` — 0.7 Hz, 8cm bob, 5cm sway, 4cm footstep, maxSpeed 8.
  Higher frequency + larger amplitude + stronger footstep for running.
- `fpsCrouch()` — 0.4 Hz, 2cm bob, 1cm sway, 0.5cm footstep,
  maxSpeed 2.5. Subtle, low-amplitude crouch-walking.
- `tpsWalk()` — 0.5 Hz, 3cm bob, 2cm sway, 1cm footstep. Smaller
  than FPS because the camera is farther away (large bob looks
  unnatural at a distance).
- `spectator()` — 0.3 Hz, 1cm bob, 0.5cm sway, 0 footstep, maxSpeed
  10. Minimal bob for observer/free-fly modes; preserves speed sense
  without footstep impact.

**Composition with `PerlinShake`** — `CameraBob` (periodic, speed-driven)
and `PerlinShake` (random, impulse-driven) are additive and do not
interfere:

```ts
bob.update(dt, playerSpeed, isCrouching);
shake.update(dt);
const bobOffset = bob.getOffset();
const shakeOffset = shake.getOffset();
camera.position.add(bobOffset.translation);
camera.position.add(shakeOffset.translation);
// apply rotation offsets to camera quaternion (caller responsibility)
```

**Composition with `SpringArm`** — apply `CameraBob` *after*
`SpringArm.update()` so the bob is in camera-local space:

```ts
arm.update(dt);
bob.update(dt, speed, crouching);
const bobOffset = bob.getOffset();
arm.camera!.position.add(bobOffset.translation);
```

For first-person cameras (no SpringArm), apply directly:

```ts
bob.update(dt, speed, crouching);
const offset = bob.getOffset();
camera.position.add(offset.translation);
// apply offset.rotation to camera quaternion
```

**Footstep sound trigger** — use `isFootstep` to drive audio:

```ts
bob.update(dt, speed, crouching);
const offset = bob.getOffset();
if (offset.isFootstep && !prevFootstep) {
  audio.playFootstep(surfaceType);
}
prevFootstep = offset.isFootstep;
```

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

### CameraPath flythrough with cinematic spline

```ts
import { CameraPath, Vector3, smoothstepEasing } from '@vreen/engine';

const path = new CameraPath();
path.loopMode = 'once';
path.parametrization = 'centripetal';   // no cusps, no overshoot
path.easing = smoothstepEasing;          // slow-in / slow-out per segment
path.addKeyframe({ time: 0,  position: new Vector3(0, 5, 15),  lookAt: new Vector3(0, 1, 0), fov: 50, roll: 0 })
    .addKeyframe({ time: 3,  position: new Vector3(12, 3, 8),  lookAt: new Vector3(0, 1, 0), fov: 50, roll: 0 })
    .addKeyframe({ time: 6,  position: new Vector3(0, 8, -10), lookAt: new Vector3(0, 1, 0), fov: 60, roll: 5 })
    .addKeyframe({ time: 9,  position: new Vector3(-12, 3, 8), lookAt: new Vector3(0, 1, 0), fov: 50, roll: 0 })
    .addKeyframe({ time: 12, position: new Vector3(0, 5, 15),  lookAt: new Vector3(0, 1, 0), fov: 50, roll: 0 });
path.play();

// frame loop:
path.update(dt);
const pose = path.sample();
camera.position.copy(pose.position);
camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
// (apply pose.roll to camera.up / quaternion if enableRoll is true)
```

For seamless looping, set `path.loopMode = 'loop'` and ensure the first
and last keyframes have identical position / lookAt / fov / roll (as
above). For a back-and-forth review, use `'pingpong'`.

For a flythrough where the camera always faces forward (no scripted
lookAt), enable `autoLookAlongPath` and skip the `lookAt` field:

```ts
path.autoLookAlongPath = true;
path.autoLookDistance = 8;   // look 8 units ahead along the tangent
```

For a documentary-style handheld jitter, layer noise on top:

```ts
path.enableHandheldNoise(0.15, 1.2);  // 15cm jitter at 1.2 Hz
```

### PerlinShake for impact / explosion feedback

```ts
import { PerlinShake, PerlinShakePresets } from '@vreen/engine';

// Use a preset for quick setup:
const shake = PerlinShakePresets.explosion();
// or configure manually:
// const shake = new PerlinShake(/* seed */ 42);
// shake.maxOffset = 0.4;  shake.maxAngle = 0.08;  shake.decay = 1.2;

// Trigger on event (explosion / collision / weapon fire):
function onExplosion(intensity: number) {
  shake.addTrauma(intensity);   // stacks, clamps to 1.0
}

// frame loop:
shake.update(dt);
if (shake.isActive()) {
  const offset = shake.getOffset();
  camera.position.add(offset.translation);
  // rotation: apply offset.rotation (pitch / yaw / roll) to camera quaternion
  // e.g. camera.quaternion.multiply(quaternionFromEuler(offset.rotation));
}
```

Multiple events stack trauma up to 1.0, so a burst of three explosions
feels heavier than one. The `decay` bleeds trauma off linearly, but
because the visible `amount = trauma²`, the perceived shake drops fast
after impact and lingers as a subtle tail — matching real camera
behavior.

To compose with `CinematicCamera`:

```ts
cine.update(dt);
shake.update(dt);
const offset = shake.getOffset();
cine.camera.position.add(offset.translation);
// (apply rotation offset to cine.camera quaternion)
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

### SpringArm for third-person collision-aware camera

```ts
import { SpringArm, SpringArmPresets, PerspectiveCamera } from '@vreen/engine';

// 1. Create with a preset (or new SpringArm(camera) + manual config)
const mainCamera = new PerspectiveCamera(60, 16 / 9, 0.1, 200);
const arm = SpringArmPresets.thirdPerson();
arm.camera = mainCamera;

// 2. Bind to the player + level geometry
arm.follow(playerEntity);
arm.setCollisionObjects([levelGeometry, props, staticMeshes]);

// 3. Optional: inject a custom probe (e.g. VREEN Voxel DDA)
// arm.setProbe((origin, dir, max) => voxelWorld.raycast(origin, dir, max));

// 4. Frame loop
arm.update(dt);
renderer.render(scene, arm.camera);
```

For an over-shoulder aim camera, swap the preset and tighten the spring:

```ts
const aimArm = SpringArmPresets.overShoulder();
aimArm.camera = mainCamera;
aimArm.follow(playerEntity);
aimArm.setCollisionObjects(levelGeometry);
// aimArm.springStiffness = 0.6;  // tighter
```

To detect that the camera is currently retracted (e.g. for UI fade or
crosshair state), compare `currentLength` against `maxDistance`:

```ts
arm.update(dt);
const retracted = arm.currentLength < arm.maxDistance - 0.05;
if (retracted) hud.fadeOutCrosshair();
```

To combine with `PerlinShake`, apply the shake offset *after* the arm
has written the camera pose:

```ts
arm.update(dt);
shake.update(dt);
const offset = shake.getOffset();
mainCamera.position.add(offset.translation);
// apply rotation offset to camera quaternion (caller responsibility)
```

### CameraBob for walking head bob

```ts
import { CameraBob, CameraBobPresets, PerspectiveCamera } from '@vreen/engine';

// 1. Create with a preset (or new CameraBob() + manual config)
const bob = CameraBobPresets.fpsWalk();
bob.maxSpeed = 5;  // match player's walk speed

// 2. Frame loop
const speed = playerVelocity.length();  // horizontal speed (m/s)
bob.update(dt, speed, isCrouching);
const offset = bob.getOffset();
camera.position.add(offset.translation);
// apply offset.rotation (pitch / yaw / roll) to camera quaternion

// 3. Footstep audio trigger
if (offset.isFootstep && !prevFootstep) {
  audio.playFootstep(currentSurface);
}
prevFootstep = offset.isFootstep;
```

To stack all three camera effects (SpringArm + CameraBob + PerlinShake),
apply them in order — arm first (writes base pose), then bob (walking
rhythm), then shake (impact feedback):

```ts
arm.update(dt);
bob.update(dt, speed, crouching);
shake.update(dt);

arm.camera!.position.add(bob.getOffset().translation);
arm.camera!.position.add(shake.getOffset().translation);
// apply rotation offsets to camera quaternion
```

For running, swap the preset (frequency + amplitude increase):

```ts
const runBob = CameraBobPresets.fpsRun();
// or adjust dynamically:
// bob.bobFrequency = isRunning ? 0.7 : 0.5;
// bob.bobAmount = isRunning ? 0.08 : 0.05;
```

For spectator / free-fly modes, use the minimal preset:

```ts
const bob = CameraBobPresets.spectator();
// no footstep impulse, very small amplitude — just speed sense
```

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
- `CameraPath.keyframes` is always sorted ascending by `time` after
  `addKeyframe()` / `setKeyframes()` / `removeKeyframe()`; `getDuration()`
  returns `last.time - first.time` (0 if fewer than 2 keyframes).
- `CameraPath.update(dt)` is a no-op when `duration <= 0` or not playing;
  `play()` is a no-op on an empty path.
- `CameraPath.sample()` returns a zero pose when `keyframes.length === 0`
  and the single keyframe's pose when `length === 1` (no spline eval).
- `CameraPath` Catmull-Rom boundary: at the first / last segment, the
  missing previous / next control point is duplicated (natural end
  condition), so the spline passes exactly through the first and last
  keyframes.
- `CameraPath` segment lookup uses a hot-path optimization: it first
  checks `lastSegment` and `lastSegment + 1`, falling back to binary
  search. This assumes monotonic time progression — random `seek()` to
  distant times still works but triggers the binary-search fallback.
- `CameraPath.exportJSON()` does **not** serialize `easing` (function)
  or `enableHandheldNoise` state; callers re-apply them after
  `importJSON()`.
- `PerlinShake.trauma` is always in `[0, 1]`; `addTrauma()` and
  `setTrauma()` clamp. `getAmount()` returns `trauma²`.
- `PerlinShake.getOffset()` returns all zeros when `trauma === 0`
  (early-out, no noise evaluation).
- `PerlinShake` is deterministic: two instances with the same `seed`,
  `trauma`, and `update()` history produce identical offsets.
- `PerlinShakePresets` factories use a random `seed` (`Math.random() *
  1000`) so each preset instance has a distinct noise pattern. Pass an
  explicit seed via `new PerlinShake(seed)` for deterministic playback.
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
- `SpringArm.update(dt)` is a no-op when `target === null`; if
  `camera === null` it still updates internal state (`currentLength`,
  `smoothedTargetPos`, `smoothedLookAt`) for external consumption.
- `SpringArm.follow(target)` immediately copies `target.position` into
  `smoothedTargetPos` and resets `currentLength = maxDistance` to
  avoid a large initial jump from the origin; subsequent `update(dt)`
  calls apply smoothing.
- `SpringArm.maxDistance` is derived from `armOffset.length()` in the
  constructor and `setArmOffset()`; it can be manually overridden but
  must remain `>= 0`. `currentLength` is always clamped to
  `[0, maxDistance]` after each `update()`.
- Collision retraction formula: `targetLength = max(0, min(maxDistance,
  hitDist - collisionMargin - probeRadius))`. The `probeRadius` term
  is **always** subtracted regardless of `probeType`. When switching
  to `probeType = 'ray'`, callers should set `probeRadius = 0` to
  avoid over-retraction (the presets' `firstPerson()` does this).
- Exponential smoothing uses `alpha = 1 - exp(-rate * dt * 60)` where
  `rate = stiffness * (1 - damping * 0.5)`. At `dt = 0`, `alpha = 0`
  (no integration); as `dt → ∞`, `alpha → 1` (instant snap). The
  smoothing is monotonic — it never overshoots.
- When `probe` is non-null, `collisionObjects` and `probeType` are
  ignored — the custom probe is the sole source of collision truth.
- When `probe` is null and `collisionObjects.length === 0`, the probe
  returns `null` (no collision) and the arm extends to `maxDistance`.
- `SpringArm.exportJSON()` does **not** serialize `target` or `camera`
  references (they are object identities, not data); callers re-bind
  them after `importJSON()`.
- `SpringArmPresets` factories do **not** bind a camera — the caller
  must set `arm.camera` or pass it via `new SpringArm(camera)` after
  cloning the preset's config.
- `CameraBob.update(dt, speed, crouching)` advances `phase` by
  `dt × speed × bobFrequency × 2π`. At `speed = 0`, phase does not
  advance (no phantom bobbing while standing still). At `dt = 0`,
  phase and `smoothedSpeedFactor` are unchanged (no integration).
- `CameraBob.getOffset()` returns all zeros when
  `smoothedSpeedFactor ≤ 0.0001` (early-out, no trig evaluation).
- `CameraBob.smoothedSpeedFactor` is always in `[0, 1]`; the raw
  `speed / maxSpeed` ratio is clamped to `[0, 1]` before smoothing,
  and negative speeds produce `rawFactor = 0` (no reverse bobbing).
- The `bobY` / `swayX` frequency ratio is always 2:1 — `bobY` uses
  `sin(phase)` (full frequency) while `swayX` uses
  `cos(phase × 0.5)` (half frequency). This is hardcoded in the
  waveform formulas and cannot be changed without subclassing.
- The footstep impulse is `max(0, sin(phase))⁶ × footstepAmount × sf`
  — the exponent 6 is hardcoded to produce a sharp spike. At
  `sin = 0` (mid-stride), the impulse is 0; at `sin = 1` (step peak),
  it reaches `footstepAmount × sf`.
- `isFootstep` is `true` when `footstep > footstepThreshold ×
  footstepAmount × sf` (default threshold 0.5). This simplifies to
  `sin⁺(phase)⁶ > 0.5`, i.e., `sin(phase) > 0.5^(1/6) ≈ 0.891`.
  The flag is true for ~15% of each step cycle (a brief spike around
  the peak), suitable for triggering footstep sound effects.
- `CameraBob.exportJSON()` serializes `phase` but **not**
  `smoothedSpeedFactor` (it is derived from the speed history and
  will re-converge after a few frames of `update()`). Call `reset()`
  after `importJSON()` if you want a clean start.
- `CameraBobPresets` factories do **not** bind to any camera —
  `CameraBob` is stateless with respect to the camera object; it only
  produces offsets that the caller applies.
- `CameraBob` and `PerlinShake` are additive — their offsets can be
  summed without interference. `CameraBob` provides periodic
  speed-driven rhythm; `PerlinShake` provides random impulse-driven
  feedback. The recommended application order is: base camera pose →
  `CameraBob` → `PerlinShake`.

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
- three.js `CatmullRomCurve3` — Catmull-Rom spline math underlying
  `CameraPath` (uniform and centripetal parameterizations).
- three.js `CubeCamera.js` / `WebGLCubeRenderTarget` — cube-map capture
  conventions and 6-face orientation table (OpenGL spec §8.13.1).
- o3de Atom `ReflectionProbe` — runtime IBL probe system that uses a
  cube camera as its capture primitive.
- o3de Track View / Sequence Cinematics — keyframed camera path
  animation conventions inspiring `CameraPath`.
- o3de AzFramework Camera Shake Component — trauma-based camera shake
  inspiring `PerlinShake`.
- o3de AzFramework Camera Bob Component — speed-driven periodic camera
  bob inspiring `CameraBob`.
- Unreal `PlayerCameraManager::ApplyCameraBob` — the camera bob
  framework convention inspiring `CameraBob`.
- Unity community Head Bob scripts — common FPS head bob implementation
  patterns inspiring `CameraBob`.
- GDC 2020, "Game Feel in Half-Life: Alyx" — the non-linear
  amplitude mapping and sin⁶ footstep impulse design rationale.
- Unity Timeline Cinemachine Path / Cinemachine BasicDamping —
  keyframed spline path and shake-damping conventions.
- NVIDIA GDC 2016, "Mission Improbable: A Gentle Introduction to
  Camera Shake" — the trauma² decay model used in `PerlinShake`.
- Ken Perlin, "Improving Noise" (SIGGRAPH 2002) — the improved Perlin
  noise algorithm used by `ImprovedNoise` (consumed by both
  `CameraPath` handheld noise and `PerlinShake`).
- Ken Shoemake, "Quaternion Calculus and Fast Animation" (1987) — the
  rotation-matrix → quaternion algorithm used in `_updateCameras()`.
- `src/engine/Cameras/index.ts` — barrel re-exports for the module.
