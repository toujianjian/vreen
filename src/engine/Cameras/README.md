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
> VR / 3D rendering, and a `CubeCamera` that captures 6-face environment
> maps for real-time IBL / reflections / refractions.

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
```

`CinematicCamera`, `CameraRig`, and `CameraPath` are complementary:
`CinematicCamera` plays a *scripted* shot sequence (predetermined
discrete poses with transitions between them), `CameraPath` plays a
*continuous* keyframed spline (smooth motion through control points
with no shot boundaries), and `CameraRig` *reactively* follows a live
`Object3D` (player / vehicle). They compose — a rig can follow the
player while a cinematic camera cuts between rigs, or a `CameraPath`
can drive a flythrough while `PerlinShake` overlays explosion shake.
`PerlinShake` is independent of all three: it produces a per-frame
`ShakeOffset` (translation + rotation) that the caller adds to any
camera's pose. `CubeCamera` is orthogonal: it captures the scene into
a cube map rather than rendering a single view, and its output feeds
the material system's `envMap` / IBL pipeline.

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
