# Animation Module

> Path: `src/engine/Animation/`
>
> The animation subsystem of the `@vreen/engine` kernel. Provides clip
> playback, GPU skinning via `AnimationMixer`, an `AnimationStateMachine`
> with auto Idle/Walk/Run transitions, `BlendSpace1D` for speed-driven
> blending, layered animation with masks, additive blend, IK solvers
> (FABRIK / CCD / biped rig), and a `Humanoid` rig definition.

---

## Overview

```
AnimationClip ──holds──→ KeyframeTrack[] ──typed by──→ Number | Vector | Quaternion
     │
     ▼
AnimationAction ──played by──→ AnimationMixer ──drives──→ SkinnedMesh bone matrices
     │
     ▼
AnimationStateMachine ──binds to──→ AnimationMixer
     │  states: AnimMachineState { name, clip, loop }
     │  transitions: AnimTransition { from, to, condition, durationMs }
     ▼
AnimStateSystem (ECS) ──ticks per frame──→ AnimationStateMachine
```

Complementary systems:
- `BlendSpace1D` / `BlendSpace2D` — 1-D (speed) and 2-D (speed + strafe)
  animation blending via Delaunay + barycentric weights.
- `AnimationLayer` / `AnimationLayerMixer` / `BoneMask` / `AvatarMask` —
  layered playback (upper/lower body split, additive pose blending).
- `AdditiveBlend` / `AnimationSync` — additive pose deltas + clip sync.
- `ProceduralAnimation` — dataless procedural overlay (gait / breathing /
  head track / idle sway / secondary motion).
- `AnimationRetargeting` — adapt clips across skeletons of different
  proportions (relative-to-bind-pose, o3de EMotionFX style).
- `TwoBoneIKSolver` / `LookAtIK` — analytic arm/leg IK + aim IK.
- `SpringSolver` — secondary bone spring physics (hair / cloth / tail).
- `RootMotionExtractor` — root-motion extraction (in-place clips drive
  the actor forward, o3de `RepositioningLayerPass` style).
- `IKSystem` — high-level scene-graph IK (FABRIK + CCD) operating on
  `Object3D[]` joints.
- IK subsystem (`IK/` subdirectory) — `IKBone`, `IKChain`, `IKSolver`
  (FABRIK), `CCDSolver`, `IKHumanoid` (self-contained, no scene-graph dep).
- `BoneAttachment` / `BoneAttachmentManager` — attach props/weapons/VFX
  to bones (Godot `BoneAttachment` / UE `AttachToComponent` analogue).

---

## Core Classes

### Clip & Track

| Export | Role |
|--------|------|
| `KeyframeTrack` | Base keyframe track with `InterpMode` (linear / step / cubic). |
| `NumberKeyframeTrack` / `VectorKeyframeTrack` / `QuaternionKeyframeTrack` | Typed keyframe tracks. |
| `AnimationClip` | Clip = track collection + duration + `AnimationEvent[]` (time-anchored callbacks). |

### Playback

| Export | Role |
|--------|------|
| `AnimationAction` | Per-clip playback control. `play` / `pause` / `stop` / `seek` / `timeScale` / `LoopMode`. |
| `AnimationMixer` | Drives GPU skinning matrices on a root `Object3D`. Supports blending. |
| `AnimationEvents` | Time-anchored callbacks (e.g. footstep triggers) firing during `AnimationAction.update`. |

### State Machine

| Export | Role |
|--------|------|
| `AnimationStateMachine` | Idle / Walk / Run automatic transitions driven by `Velocity` magnitude, with configurable transition times. Holds `AnimMachineState` nodes + `AnimTransition` edges. |

```ts
interface AnimMachineState { name: string; clip: AnimationClip; loop: LoopMode; }
interface AnimTransition {
  from: string;
  to: string;
  condition: (world: World, entity: EntityId) => boolean;
  durationMs: number;
}
```

The ECS `AnimStateSystem` ticks the state machine each frame based on
the entity's `Velocity` component magnitude; transitions are
cross-faded over `durationMs`.

### Blend Space

| Export | Role |
|--------|------|
| `BlendSpace1D` | Smooth 1-D animation blending by speed. Sample at speed `v` to get a weighted pair of clips (Idle ↔ Walk ↔ Run). |

### Layered Animation

| Export | Role |
|--------|------|
| `AnimationLayer` | Single layer with a mask + weight + blend mode (override / additive). |
| `AnimationLayerMixer` | Multi-layer mixer — composes layers onto the base pose. |
| `BoneMask` | Per-bone include/exclude mask. |
| `AvatarMask` | Body-part-grouped mask (e.g. "upper body", "lower body"). |
| `AdditiveBlend` | Apply additive pose deltas (e.g. aim offset, lean). |
| `AnimationSync` | Synchronise clip times across layers (e.g. footstep lock). |

### Humanoid Rig

| Export | Role |
|--------|------|
| `buildHumanoid()` | Returns a `HumanoidBundle` defining the canonical biped bone hierarchy (hips → spine → chest → neck → head; shoulders → upper arms → lower arms → hands; hips → upper legs → lower legs → feet). Used by `IKHumanoid` and the mixer. |

### IK Subsystem (`IK/` subdirectory)

| Export | Role |
|--------|------|
| `IKBone` | Single IK bone with joint constraint (angle limit, axis). |
| `IKChain` | Sequence of `IKBone`s with target + optional pole vector. |
| `IKSolver` | FABRIK (Forward And Backward Reaching Inverse Kinematics) — general-purpose chain solver. Iterative, fast, smooth. |
| `CCDSolver` | Cyclic Coordinate Descent IK solver — alternative to FABRIK for stiff chains; per-iteration angle-limited. |
| `IKHumanoid` | Full biped IK rig — left/right arm, left/right leg, spine chains with side chaining and pole vectors. |

```ts
import { IKSolver, IKChain, IKBone } from '@vreen/engine/animation';

const chain = new IKChain([
  new IKBone({ length: 0.4, axis: 'y' }),
  new IKBone({ length: 0.3, axis: 'y' }),
  new IKBone({ length: 0.2, axis: 'y' }),
]);
chain.setTarget(new Vector3(0.5, 1.0, 0));
chain.setPole(new Vector3(0, 1, 0));

const solver = new IKSolver({ iterations: 10 });
solver.solve(chain); // chain.bones now hold solved rotations
```

---

## Advanced Animation Subsystems

The following subsystems extend clip-based playback with **procedural motion,
cross-skeleton retargeting, analytic IK, 2D blend spaces, secondary spring
physics, root-motion extraction, scene-graph IK, and bone-attached props**.
Each is decoupled and composes with `AnimationMixer` (Mixer poses the
skeleton first, then these layers add/modify transforms).

### `ProceduralAnimation` (`ProceduralAnimation.ts`)

Overlays **dataless procedural motion** on top of keyframed poses — gait
cycles, head tracking, breathing, idle sway, secondary motion. Complementary
to `AnimationMixer` (which plays recorded clips).

Node model: each `ProceduralNode` binds to a bone (by name), carries a
`type` + `weight` (slerp blend, 0 = no effect) + `params: Map<string,
number>`. `update(dt, skeleton)` iterates enabled nodes and dispatches by
type. External inputs (target/speed/velocity) are fed via `setNodeParam`.

| `ProceduralNodeType` | Inputs (params) | Output |
|----------------------|------------------|--------|
| `headTrack` | `targetX/Y/Z` | Bone yaw+pitch toward target |
| `breathing` | — | Sinusoidal spine scale/rotation |
| `walkCycle` | `speed` | Phase-locked sin hip/shoulder sway |
| `runCycle` | `speed` | Amplified walkCycle + lean |
| `idleSway` | — | Perlin-noise weight shift |
| `lookAt` | `targetX/Y/Z` | Full-bone aim (vs headTrack = head only) |
| `reach` | `targetX/Y/Z` | Simplified hand position lerp (not full IK) |
| `secondaryMotion` | `velX/Y/Z` | Velocity-driven inertia overshoot |

`reach` is a simplified "hand reach" (position lerp); for exact chain IK use
`IKSolver` / `IKHumanoid`.

### `AnimationRetargeting` (`AnimationRetargeting.ts`)

Adapts a clip authored for one skeleton (source) to a different skeleton
(target) with different proportions. Adapted from o3de EMotionFX
`RetargetingFile` and Unreal IK Rig retargeter.

**Relative-to-bind-pose strategy** — preserves animation intent ("raise arm
45°") while respecting target proportions:

| Track type | Delta | Apply |
|-----------|-------|-------|
| Quaternion | `δ = animQ · srcBindQ⁻¹` | `tgt = δ · tgtBindQ` |
| Position | `δ = animPos − srcBindPos` | `tgt = tgtBindPos + δ · scaleFactor` |
| Scale | `ratio = animScale / srcBindScale` | `tgt = ratio · tgtBindScale` |

Position `scaleFactor` is per-bone, computed from the parent→child joint
length ratio (source vs. target); root falls back to overall skeleton height
ratio. `BoneMapping[]` maps source→target bone names;
`extractBindPose(skeleton)` snapshots the rest pose.

```ts
const retarget = new AnimationRetargeting({
  sourceSkeleton, targetSkeleton,
  boneMapping: [{ source: 'upper_arm.L', target: 'arm_upper_L' }, /* ... */],
});
const adaptedClip = retarget.retarget(walkClip);
```

### `TwoBoneIKSolver` / `LookAtIK` (`TwoBoneIKSolver.ts`)

Analytic two-bone IK (root → mid → end) + aim IK — the workhorse pattern
from Unreal / Godot / o3de EMotionFX for arms and legs. **Pure** (operates
on abstract `{position, quaternion}` triplets, no scene-graph touch) so it
composes into `ProceduralAnimation`, mixer post-solve, or ECS.

Algorithm: (1) clamp target to reachable sphere (radius = len1+len2);
(2) law of cosines for elbow angle `cosA = (len1² + d² − len2²)/(2·len1·d)`;
(3) place mid joint on the circle around (root→target) at angle A, biased
toward the **pole vector** (hint direction for elbow/knee bend);
(4) orient root → target, mid → end.

| `TwoBoneIKInput` | Description |
|------------------|-------------|
| `rootPos` / `midPos` / `endPos` | Current joint world positions |
| `targetPos` | Desired end-effector position |
| `polePos?` | Hint — mid joint biased toward this |
| `softness?` | 0 = hard clamp, >0 = smooth falloff near limit |
| `weight?` | 0 = identity, 1 = full IK |

`LookAtIK` rotates a bone to aim its forward axis at a target (head
tracking, turret aiming), with `weight` blend and optional axis constraint.

### `BlendSpace2D` (`BlendSpace2D.ts`)

2D animation blend space — extends `BlendSpace1D` (single speed axis) to a
2D plane (forward speed + strafe speed), enabling directional locomotion
(forward/back/strafe-left/right and any diagonal).

Algorithm (adapted from o3de EMotionFX `BlendSpace2DNode`):
1. **Delaunay triangulation** (Bowyer-Watson incremental) of sample points.
2. Find the triangle containing the query point.
3. **Barycentric coordinates** → 3 vertex weights.
4. Outside convex hull → project to nearest edge, interpolate 2 endpoints.
5. Colinear samples (no triangle) → find nearest segment, interpolate.

Returns up to 3 `{clipId, weight}` samples (sum to 1). Does not drive
playhead directly — caller composes weights with `AnimationMixer` (decoupled
like `BlendSpace1D`).

### `SpringSolver` (`SpringSolver.ts`)

Secondary bone **spring physics** for follow-through (hair / cloth / ears /
tail). Adapted from o3de EMotionFX `SpringSolver`. Runs *after* the mixer
poses the main skeleton — adds spring force to registered bones for natural
secondary motion without hand-authoring in clips.

Per-bone forces: `F_spring = −stiffness · offset` (pull to rest direction),
`F_damp = −damping · velocity`, `F_gravity = gravity · mass`.
Integration: **semi-implicit (symplectic) Euler** with fixed timestep +
substepping for stability; when `dt > fixedDt · maxSubsteps` only
`fixedDt · maxSubsteps` is simulated (avoids death spiral), surplus dropped.

| `SpringBone` field | Default | Description |
|--------------------|---------|-------------|
| `stiffness` | 100 | Spring stiffness (higher = snappier) |
| `damping` | 0.3 | 0 = none, 1 = critical |
| `gravity` | 9.81 | Gravity magnitude |
| `length` | 0.1 | Bone length (child position) |
| `restDirection` | +Y | Rest direction (bone local) |

### `RootMotion` / `RootMotionExtractor` (`RootMotion.ts`)

Extracts the root bone's per-frame delta from a played clip and redirects it
to the actor's world transform (instead of the bone), so in-place walk/run
clips drive the character forward with correct foot planting. Adapted from
o3de EMotionFX `RepositioningLayerPass`.

Flow: (1) `AnimationMixer.update()` poses the skeleton; (2) `extract()`
reads the root bone's current local transform, computes the per-frame delta
from the previous frame, **subtracts it from the bone** (bone stays planted)
and accumulates internally; (3) `CharacterController` consumes
`consumeDelta()` and applies it to the actor's world transform.

| `RootMotionConfig` | Default | Description |
|--------------------|---------|-------------|
| `rootBoneName` | `'Root'` | Bone whose transform drives the actor |
| `enabled` | true | Apply delta to actor + subtract from bone |
| `scale` | 1 | 0 = disable, 1 = authored speed, >1 = faster |
| `horizontalOnly` | true | XZ only (Y ignored — non-flying characters) |

### `IKSystem` (`IKSystem.ts`)

High-level IK operating directly on `Object3D[]` joint chains (reads/writes
scene-graph `position` / `rotation`). Complementary to the `IK/` subdirectory
(`IKBone`/`IKChain`/`IKSolver`, self-contained, no scene-graph dependency) —
`IKSystem` is for integrating into an existing scene-graph hierarchy.

Two solvers: **FABRIK** (position-space, backward+forward passes, fast for
multi-bone chains, `poleTarget` for bend direction) and **CCD**
(rotation-space, per-joint rotate, naturally compatible with hinge
constraints). `IKConstraint` (hinge joint): axis + `[minAngle, maxAngle]`.

```ts
const ik = new IKSystem();
ik.setSolver('fabrik');
ik.addChain({
  name: 'arm',
  joints: [shoulder, elbow, hand],   // Object3D[]
  target: new Vector3(1, 1, 0),
  poleTarget: new Vector3(0, 2, 0),
});
ik.update(0.016);
```

### `BoneAttachment` / `BoneAttachmentManager` (`BoneAttachment.ts`)

Attaches any `Object3D` to a bone so it follows the bone's world transform —
for weapons / props / equipment slots / VFX anchors / cameras. Analogous to
Godot `BoneAttachment` / UE `AttachToComponent` / o3de `ActorComponent`.

Unlike parenting to a `Bone`: `BoneAttachment` explicitly syncs the target's
world matrix in `update()` (no scene-graph parent dependency — can attach
across subtrees), supports an `offset` (local transform relative to bone),
4 follow modes, and smoothing.

| `FollowMode` | Description |
|--------------|-------------|
| `world` | Full world transform (position + rotation) |
| `position` | Position only (rotation stays independent) |
| `rotation` | Rotation only (position stays independent) |
| `snap` | Instant snap (no smoothing) |

`smoothing ∈ [0,1)`: 0 = instant, >0 = exponential decay lerp.
`BoneAttachmentManager` batches multiple attachments.

```ts
const sword = new Mesh(geom, mat);
const att = new BoneAttachment({
  target: sword, bone: rightHandBone,
  offset: new Matrix4().makeTranslation(0.1, 0, 0),
  followMode: 'world', smoothing: 0.15,
});
// each frame, after bone updateMatrixWorld, before render:
att.update(dt);
```

### Subsystem Map

| Subsystem | File | Layer | o3de / industry analogue |
|-----------|------|-------|--------------------------|
| `KeyframeTrack` / `AnimationClip` / `AnimationAction` / `AnimationMixer` | `KeyframeTrack.ts` etc. | clip playback | EMotionFX `AnimClip` / `MotionInstance` |
| `AnimationStateMachine` | `AnimationStateMachine.ts` | FSM | EMotionFX `StateMachine` / UE AnimBP |
| `BlendSpace1D` / `BlendSpace2D` | `BlendSpace1D.ts` / `BlendSpace2D.ts` | blend | EMotionFX `BlendSpace*Node` |
| `AnimationLayer` / `AnimationLayerMixer` / `BoneMask` / `AvatarMask` | `AnimationLayer.ts` etc. | layering | UE AnimBP layers / EMotionFX `MotionLayer` |
| `AdditiveBlend` / `AnimationSync` | `AdditiveBlend.ts` / `AnimationSync.ts` | additive + sync | UE additive pose / EMotionFX sync |
| `ProceduralAnimation` | `ProceduralAnimation.ts` | procedural overlay | UE AnimDynamics / EMotionFX procedural |
| `AnimationRetargeting` | `AnimationRetargeting.ts` | retarget | EMotionFX `RetargetingFile` / UE IK Rig |
| `TwoBoneIKSolver` / `LookAtIK` | `TwoBoneIKSolver.ts` | analytic IK | UE `FAnimNode_TwoBoneIK` |
| `SpringSolver` | `SpringSolver.ts` | secondary physics | EMotionFX `SpringSolver` |
| `RootMotionExtractor` | `RootMotion.ts` | root motion | EMotionFX `RepositioningLayerPass` |
| `IKSystem` | `IKSystem.ts` | scene-graph IK | EMotionFX `IKSolver` (Object3D) |
| `IK/` (`IKBone`/`IKChain`/`IKSolver`/`CCDSolver`/`IKHumanoid`) | `IK/` subdirectory | self-contained IK | — |
| `BoneAttachment` / `BoneAttachmentManager` | `BoneAttachment.ts` | prop attach | Godot `BoneAttachment` / UE `AttachToComponent` |

---

## Usage Example

```ts
import { AnimationMixer, AnimationClip, AnimationAction, AnimationStateMachine } from '@vreen/engine/animation';
import { World, VelocityC, AnimStateC } from '@vreen/engine/ecs';

const mixer = new AnimationMixer(skinnedMesh);
const idle = mixer.clipAction(idleClip);
const walk = mixer.clipAction(walkClip);
const run  = mixer.clipAction(runClip);

const fsm = new AnimationStateMachine({
  states: [
    { name: 'Idle', clip: idleClip, loop: LoopMode.Repeat },
    { name: 'Walk', clip: walkClip, loop: LoopMode.Repeat },
    { name: 'Run',  clip: runClip,  loop: LoopMode.Repeat },
  ],
  transitions: [
    { from: 'Idle', to: 'Walk', condition: (w, e) => speedOf(e, w) > 0.5,  durationMs: 200 },
    { from: 'Walk', to: 'Run',  condition: (w, e) => speedOf(e, w) > 3.0,  durationMs: 150 },
    { from: 'Run',  to: 'Walk', condition: (w, e) => speedOf(e, w) < 3.0,  durationMs: 150 },
    { from: 'Walk', to: 'Idle', condition: (w, e) => speedOf(e, w) < 0.5,  durationMs: 200 },
  ],
  initial: 'Idle',
});
fsm.bind(mixer);

function frame(dt: number) {
  fsm.update(world, entity, dt);
  mixer.update(dt);
}
```

Layered animation:

```ts
import { AnimationLayerMixer, AnimationLayer, AvatarMask } from '@vreen/engine/animation';

const layerMixer = new AnimationLayerMixer(skinnedMesh);
layerMixer.addLayer(new AnimationLayer({
  clip: baseWalkClip,
  weight: 1.0,
  mode: 'override',
}));
layerMixer.addLayer(new AnimationLayer({
  clip: aimOffsetClip,
  weight: 0.7,
  mode: 'additive',
  mask: new AvatarMask({ groups: ['upperBody', 'head'] }),
}));

layerMixer.update(dt);
```

---

## Design Notes

**`AnimState` name collision.** The animation FSM exposes a *type*
`AnimMachineState` (a state node) while the ECS exposes a *class*
`AnimState` (an ECS component). The engine root barrel re-exports the
type as `AnimStateNode` to disambiguate; sub-barrels preserve the
original names.

**Why FABRIK + CCD?** FABRIK produces smoother, more natural poses for
multi-bone chains (arms, legs); CCD converges faster for stiff chains
(robotic arms, tentacles with constrained joints). `IKHumanoid`
internally uses FABRIK for limbs; CCD is available as a per-chain
override.

**Why is the IK subsystem under `Animation/`?** IK solves bone rotations
to satisfy target constraints — it's a pose-computing layer that runs
*before* the mixer uploads final matrices to the GPU. Keeping it under
`Animation/` reflects that dependency ordering and avoids a separate
top-level module for a tightly-coupled concept.

**Camera-relative input.** The ECS `PlayerInputSystem` translates
`PlayerInput.move` (WASD) into world-space `Velocity` based on the
active camera's yaw. This keeps character motion intuitive across the
nine camera presets (Free / Iso / 1st-person / 3rd-person / Cinematic
etc.).
