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
- `BlendSpace1D` — 1-D animation blending (Idle ↔ Walk ↔ Run by speed).
- `AnimationLayer` / `AnimationLayerMixer` / `BoneMask` / `AvatarMask` —
  layered playback (upper/lower body split, additive pose blending).
- `AdditiveBlend` / `AnimationSync` — additive pose deltas + clip sync.
- IK subsystem (`IK/` subdirectory) — `IKBone`, `IKChain`, `IKSolver`
  (FABRIK), `CCDSolver`, `IKHumanoid`.

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
