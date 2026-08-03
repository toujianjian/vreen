# Inverse Kinematics (IK) Module

> Path: `src/engine/Animation/IK/`
>
> Provides inverse kinematics solvers for character animation —
> computing joint rotations that position an end-effector at a target
> location. VREEN's IK module offers two solver algorithms (FABRIK and
> CCD), a chain manager with pole targets and joint constraints, and a
> complete humanoid biped rig with anatomically plausible joint limits.
>
> **Advantage over soup3D**: soup3D has **no IK system** — character
> limbs can only be animated via pre-baked keyframe clips, with no
> runtime procedural reaching, foot placement, or hand-to-target
> interaction. VREEN's IK module enables AAA-grade features like
> procedural foot IK (feet conform to uneven terrain), hand-to-item
> reaching (characters grasp objects at runtime), and look-at heads
> (NPC heads track the player).

---

## Architecture

```
IK/
  ├── IKBone.ts          ← Bone with local pos/rot + optional joint constraint
  ├── IKChain.ts         ← Chain manager: bones + target + pole + FABRIK solve
  ├── IKSolver.ts        ← Standalone FABRIK solver (positional, no constraints)
  ├── CCDSolver.ts       ← Standalone CCD solver (rotational, supports constraints)
  ├── IKHumanoid.ts      ← Humanoid biped rig (2 arms, 2 legs, spine, head)
  └── types.ts           ← Shared types (IKEffector, IKTarget)
```

### Data flow

```
             ┌──────────┐
             │ IKBone[] │  (local pos + rot + optional constraint)
             └────┬─────┘
                  │ addBone()
                  ▼
          ┌───────────────┐    target     ┌──────────┐
          │   IKChain     │ ◀──────────── │ Vector3  │
          │  (FABRIK)     │               └──────────┘
          │               │    poleTarget ┌──────────┐
          │               │ ◀──────────── │ Vector3  │
          └───────┬───────┘               └──────────┘
                  │ solve(iterations?)
                  ▼
          ┌───────────────┐
          │ bone.rotation │  (updated in place)
          │  per bone     │
          └───────────────┘
```

Each `IKBone` holds a **local** position offset and rotation relative
to its parent. `IKChain.solve()` runs FABRIK to compute new world
positions, then back-projects them into local rotations so the bone
hierarchy can be uploaded to a skinned mesh.

---

## Components

### `IKBone` (`IKBone.ts`)

A single bone in the IK hierarchy. Holds a local-space position offset,
a local rotation, a rest-pose length to the child joint, an optional
parent pointer, and an optional `JointConstraint` for rotational limits.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | — | Bone identifier (e.g. `'upperArm.L'`). |
| `position` | `Vector3` | `(0,0,0)` | Local position offset from parent joint, in parent's local frame. |
| `rotation` | `Quaternion` | `identity` | Local rotation relative to parent. |
| `length` | `number` | `0` | Rest-pose distance to the child joint (0 for end-effector). |
| `parent` | `IKBone \| null` | `null` | Parent bone (null = root). |
| `constraints` | `JointConstraint \| null` | `null` | Hinge joint limits (min/max angle + axis). |

#### `JointConstraint`

| Field | Type | Description |
|-------|------|-------------|
| `minAngle` | `number` | Minimum signed rotation angle (radians) around `axis`. |
| `maxAngle` | `number` | Maximum signed rotation angle (radians) around `axis`. |
| `axis` | `Vector3` | Hinge axis in the parent's local frame. Need not be normalized. |

#### Key methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getWorldPosition(target?)` | `Vector3` | Recursively walks the parent chain to compute the world position. |
| `getWorldRotation(target?)` | `Quaternion` | Recursively composes parent rotations. |
| `applyConstraints()` | `boolean` | Projects the current rotation onto the hinge axis and clamps to `[minAngle, maxAngle]`. Returns `true` if clamping occurred. |

---

### `IKChain` (`IKChain.ts`)

The chain manager. Holds an ordered list of `IKBone`s (root →
end-effector), a world-space target, an optional pole target, and
solves using FABRIK.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `bones` | `IKBone[]` | `[]` | Ordered bone list (root → end-effector). |
| `target` | `Vector3` | `(0,0,0)` | World-space target for the end-effector (last bone). |
| `poleTarget` | `Vector3 \| null` | `null` | Optional pole target — a position the chain should bend toward (elbow/knee direction). |
| `iterations` | `number` | `10` | Default per-solve iteration count. Higher = more accurate, slower. |
| `tolerance` | `number` | `1e-4` | Convergence threshold in world units. If end-effector is within this distance of the target, solving stops early. |

#### Key methods

| Method | Returns | Description |
|--------|---------|-------------|
| `addBone(bone)` | `this` | Append a bone to the end of the chain. Automatically wires `bone.parent` to the previous tail. |
| `get size` | `number` | Number of bones in the chain. |
| `solve(iterations?)` | `number` | Run FABRIK. Returns the final distance from end-effector to target. |

#### FABRIK algorithm (2 phases per iteration)

1. **Backward reaching**: Move the end-effector to the target. Then,
   for each joint from end to root, set it on the line between its
   current position and the next joint's new position, at the rest
   bone length. This pulls the chain toward the target.

2. **Forward reaching**: Move the root back to its original position.
   Then, for each joint from root to end, set it on the line between
   its current position and the previous joint's new position, at the
   rest bone length. This anchors the chain to the root.

After the iterations, if a `poleTarget` is set, the chain is rotated
around the root-to-end-effector axis so that the middle joint bends
toward the pole. Finally, the solved world positions are
back-projected into local rotations via `getWorldPosition()` and
`getWorldRotation()`.

---

### `IKSolver` (`IKSolver.ts`)

A standalone FABRIK solver that operates on raw position arrays
(no bone hierarchy). Useful for non-character IK (tentacles, ropes,
mechanical linkages).

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `chain` | `IKChain` | — | Bone chain (root → end-effector). |
| `iterations` | `number` | `10` | Iteration count. |
| `tolerance` | `number` | `0.001` | Convergence threshold. |

```ts
class IKSolver {
  constructor(chain: IKChain);
  solve(target: Vector3, iterations?: number): void;
  getPositions(): Vector3[];
}
```

---

### `CCDSolver` (`CCDSolver.ts`)

Cyclic Coordinate Descent — rotates one joint at a time, starting
from the end-effector, to align the end-effector with the target.
Simpler than FABRIK but converges slower for long chains. **Supports
rotational constraints** (unlike the positional FABRIK solver), making
it the preferred choice for chains with hinge joints (elbows, knees).

```ts
class CCDSolver {
  constructor(chain: IKChain);
  solve(target: Vector3, iterations?: number): void;
  getRotations(): Quaternion[];
}
```

#### CCD algorithm (per iteration)

For each joint `i` from end-effector to root:
1. Compute the vector from joint `i` to the end-effector: `e`.
2. Compute the vector from joint `i` to the target: `t`.
3. Compute the rotation that maps `e` to `t`: a quaternion around
   `cross(e, t)` by `angle = acos(dot(e, t) / (|e||t|))`.
4. Apply the rotation to joint `i` (and propagate to children).
5. If `constraints` is set, call `applyConstraints()` to clamp.

---

### `IKHumanoid` (`IKHumanoid.ts`)

A complete humanoid biped rig with anatomically plausible joint limits.
Built on top of `IKChain` and `IKBone`.

#### Default rest pose (`defaultHumanoidRestPose()`)

| Bone | Position (x, y, z) | Description |
|------|---------------------|-------------|
| `root` | (0, 0, 0) | Ground origin. |
| `pelvis` | (0, 0.95, 0) | Hip center. |
| `spine` | (0, 0.95, 0) | Spine base (= pelvis). |
| `chest` | (0, 1.25, 0) | Upper torso. |
| `head` | (0, 1.55, 0) | Head center. |
| `shoulder.L/R` | (±0.20, 1.45, 0) | Shoulder joints. |
| `upperArm.L/R` | (±0.20, 1.27, 0) | Upper arm. |
| `lowerArm.L/R` | (±0.20, 1.07, 0) | Lower arm (end-effector). |
| `thigh.L/R` | (±0.10, 0.90, 0) | Upper leg. |
| `shin.L/R` | (±0.10, 0.65, 0) | Lower leg. |
| `foot.L/R` | (±0.10, 0.40, 0.04) | Foot (end-effector). |

#### Joint constraints

| Joint | Constraint | Description |
|-------|------------|-------------|
| Elbow | Hinge, Y axis, 0°–150° | Flexion only, no hyperextension. |
| Knee | Hinge, Y axis, 0°–160° | Flexion only, slightly more range than elbow. |

#### API

```ts
class IKHumanoid {
  constructor(restPose?: Map<string, Vector3>);
  createArmChain(side: 'L' | 'R', opts?): IKChain;   // shoulder → upperArm → lowerArm
  createLegChain(side: 'L' | 'R', opts?): IKChain;   // hip → thigh → shin → foot
  solveHand(side: 'L' | 'R', target: Vector3, poleTarget?: Vector3): void;
  solveFoot(side: 'L' | 'R', target: Vector3, poleTarget?: Vector3): void;
  solveHead(target: Vector3): void;
}
```

---

## Usage

### Procedural foot IK (feet conform to terrain)

```ts
import { IKHumanoid } from '@/engine/Animation/IK';
import { Vector3 } from '@/engine/Math';

const humanoid = new IKHumanoid();

// Each frame: ray-cast terrain height under each foot
const leftFootGroundY = sampleTerrainHeight(leftFootX, leftFootZ);
const rightFootGroundY = sampleTerrainHeight(rightFootX, rightFootZ);

// Solve foot IK so feet land on the terrain
humanoid.solveFoot('L', new Vector3(leftFootX, leftFootGroundY, leftFootZ));
humanoid.solveFoot('R', new Vector3(rightFootX, rightFootGroundY, rightFootZ));
```

### Hand reaching (grasp an object)

```ts
// Solve left hand to reach a world-space item position
humanoid.solveHand('L', itemPosition, elbowPoleTarget);
// The elbow bends toward elbowPoleTarget (e.g. outward from body)
```

### Standalone FABRIK (tentacle / rope)

```ts
import { IKSolver } from '@/engine/Animation/IK';

const chain = {
  joints: [
    new Vector3(0, 0, 0),     // root
    new Vector3(0, 0.5, 0),   // segment 1
    new Vector3(0, 1.0, 0),   // segment 2
    new Vector3(0, 1.5, 0),   // tip
  ],
  lengths: [0.5, 0.5, 0.5],
};

const solver = new IKSolver(chain);
solver.solve(new Vector3(0.8, 0.9, 0.2), 10);

const positions = solver.getPositions();
// positions[3] should now be close to (0.8, 0.9, 0.2)
```

---

## Comparison with soup3D

| Capability | soup3D | VREEN |
|------------|--------|-------|
| FABRIK solver | **None** | `IKSolver` / `IKChain.solve()` |
| CCD solver | **None** | `CCDSolver` (with rotational constraints) |
| Joint constraints | **None** | `IKBone.constraints` (hinge: min/max angle + axis) |
| Pole targets | **None** | `IKChain.poleTarget` (elbow/knee direction) |
| Humanoid biped rig | **None** | `IKHumanoid` (2 arms, 2 legs, spine, head) |
| Anatomical joint limits | **None** | Elbow 0–150°, Knee 0–160° (hinge) |
| Procedural foot IK | **None** | `solveFoot()` (terrain conforming) |
| Hand-to-target reaching | **None** | `solveHand()` (item grasping) |
| Look-at head | **None** | `solveHead()` (NPC tracking) |
| Convergence tolerance | **None** | `tolerance` field (early-exit) |

**Where VREEN pulls ahead.** IK is a **character animation essential**
— every modern game engine (UE5, o3de, Unity) provides it. Without IK,
characters' feet clip through stairs, hands can't grab items at runtime,
and heads stare blankly. soup3D has no IK system at all. VREEN's IK
module provides two solver algorithms (FABRIK for speed, CCD for
constraint-awareness), a chain manager with pole targets and joint
limits, and a complete humanoid rig with anatomically plausible
constraints — enabling AAA features like procedural foot placement,
runtime item grasping, and NPC look-at behavior.

---

## Design Notes

**FABRIK vs CCD.** FABRIK is positional (moves joints directly) and
fast (2 passes per iteration), but doesn't respect rotational
constraints natively — constraints are applied as a post-process pass.
CCD is rotational (computes per-joint rotations) and naturally
supports hinge constraints during solving, but converges slower for
long chains (5–10× more iterations for the same accuracy). **Rule of
thumb**: use FABRIK for unconstrained chains (tentacles, ropes, tails)
and CCD for constrained chains (arms, legs with elbow/knee limits).

**Pole targets.** Without a pole target, a FABRIK chain can bend in
any direction that reaches the target — the elbow might point backward.
The pole target disambiguates the bend direction by rotating the
solved chain around the root-to-end-effector axis so that the middle
joint points toward the pole. This is the standard technique used in
UE5 and Maya.

**Convergence tolerance.** The `tolerance` field enables early exit:
if the end-effector is within `tolerance` world units of the target
after an iteration, solving stops. This saves CPU when the target is
easily reachable. Set `tolerance = 0` to force all iterations.

**Constraint application in FABRIK.** FABRIK solves positions, not
rotations. Joint constraints are applied as a post-process: after the
chain converges, each bone's local rotation is projected onto the
hinge axis and clamped. This is "cosmetic" — it corrects the rotation
but doesn't re-solve the positions. For hard constraints during
solving, use `CCDSolver` instead.

---

## References

| Topic | Source |
|-------|--------|
| FABRIK | Aristidou & Lasenby, "FABRIK: A fast, iterative solver for the Inverse Kinematics problem" (2011) |
| CCD | Wang & Chen, "A combined optimization method for solving the inverse kinematics problem of mechanical manipulators" (1991) |
| Pole targets | Unreal Engine 5 — IK Bone + Pole Vector documentation |
| Joint constraints | Maya — IK Handle with Pole Vector constraints |
| Humanoid rig | Mixamo / Unreal Mannequin bone naming convention |
