# Physics Module

> Path: `src/engine/Physics/`
>
> The physics subsystem of the `@vreen/engine` kernel. A fixed-step
> semi-implicit Euler integrator with quaternion rotation integration,
> broadphase + narrowphase collision detection, impulse-based response
> with Baumgarte stabilization, joint constraints, Verlet cloth, SPH
> fluid, and Voronoi fracture destruction.

---

## Overview

The physics simulator is **not** a third-party engine — it is implemented
from scratch for educational transparency and to keep the runtime
dependency surface at zero. The pipeline (per fixed step) is:

```
1. PhysicsSystem.integrate     ─→  apply forces → velocity → position → quaternion
2. Broadphase.update           ─→  build candidate pairs
3. CollisionSystem.narrowphase ─→  AABB / Sphere / Capsule contact manifold
4. CollisionSystem.resolve     ─→  impulse response + Baumgarte stabilization
5. ParticleSystem.update       ─→  advance particles, spawn from emitters
6. PhysicsDebugSystem.record   ─→  push lines / contacts to PhysicsDebugRenderer
```

The ECS-driven `PhysicsSystem` / `CollisionSystem` / `ParticleSystem`
live in `src/engine/ECS/PhysicsSystems.ts`. The standalone
`src/engine/Physics/` module ships the constraint subsystem, soft-body
simulators, advanced collision detection, vehicle/flight/buoyancy
dynamics, ragdoll, and the demo scene.

### Subsystem Map

| Subsystem | File | Shape | Coupling |
|-----------|------|-------|----------|
| `ConstraintSolver` + 5 joints | `ConstraintSolver.ts` | rigid-body graph | ECS `PhysicsSystems` (post-collision) |
| `ConstraintSystem` | `ConstraintSystem.ts` | flat descriptors | standalone (breakable joints) |
| `PhysicsMaterial` | `PhysicsMaterial.ts` | pure data | referenced by collision/destruction |
| `ClothSimulation` | `ClothSimulation.ts` | 2D surface grid | standalone (Verlet + PBD) |
| `RopePhysics` | `RopePhysics.ts` | 1D chain | standalone (Verlet + bend) |
| `FluidSimulation` | `FluidSimulation.ts` | SPH particles | standalone (Poly6/Spiky) |
| `SoftBodySimulation` | `SoftBodySimulation.ts` | 3D volume | standalone (shape matching) |
| `AdvancedCollisionSystem` | `CollisionSystem.ts` | any collider | standalone (BVH+SAT+GJK+EPA) |
| `DestructionSystem` + `VoronoiFracture` | `DestructionSystem.ts` | mesh chunks | standalone |
| `VehiclePhysics` | `VehiclePhysics.ts` | multi-body | standalone (Pacejka tire) |
| `FlightPhysics` | `FlightPhysics.ts` | 6DOF aircraft | standalone (thin-airfoil) |
| `Buoyancy` | `Buoyancy.ts` | floating body | standalone (Archimedes) |
| `RagdollSystem` + `ConeTwistConstraint` | `RagdollSystem.ts` | skeleton→rigidbody | standalone (write-back to Bone) |

---

## Core Classes

### Constraint Subsystem

Based on the `Constraint` base class + `RigidbodyLike` interface,
**decoupled from any specific rigid-body implementation**. An iterative
sequential-impulse `ConstraintSolver` runs after `CollisionSystem.resolve`
each fixed step.

| Constraint | DOF Locked | Use Case |
|------------|------------|----------|
| `BallJointConstraint` | 3 rot free, 3 trans locked | Ragdoll shoulders / hips, chain links. |
| `HingeJointConstraint` | 1 rot about axis, 3 trans locked | Doors, knees, elbows. |
| `SliderJointConstraint` | 1 trans along axis, 3 rot locked | Pistons, drawers, elevators. |
| `FixedJointConstraint` | All 6 DOF locked | Rigid welds (compound bodies). |
| `DistanceJointConstraint` | Maintains fixed anchor distance | Ropes, springs, culling volumes. |

Each constraint references two `RigidbodyLike` entities plus local-space
anchor offsets. The solver iterates `iterations` times per step (default
10) and applies position correction via Baumgarte stabilization, the same
scheme used for collision response. The `Constraint` base class exposes
shared helpers: `computePointEffectiveMass`, `applyImpulse`, `skewMat`,
`mat3MulVec`, `mat3MulMat3`, `mat3Inverse`, `mat3Identity`.

### `ClothSimulation` (`ClothSimulation.ts`)

Verlet-integration cloth simulator (soft body). **Independent of the ECS
`PhysicsSystems`** — soft-body shape differs significantly from rigid
bodies.

Particle grid (`ClothParticle`: `position` / `prevPosition` /
`acceleration` / `pinned` / `mass` / `invMass`) + distance constraints
(`ClothConstraint`: `p1` / `p2` / `restLength` / `stiffness`) solved
PBD-style with multiple iterations per step:

```
next = pos + (pos - prev) * (1 - damping) + accel * dt²
```

Supports:
- Sphere collision (`ClothSphere`)
- Pinned anchor particles (held fixed during integration)
- `getMeshData()` outputs flattened `positions` / `indices` / `normals`
  for upload to a `BufferGeometry`; the caller syncs the data to
  `Mesh.geometry` each frame.

### `FluidSimulation` (`FluidSimulation.ts`)

SPH (Smoothed Particle Hydrodynamics) style incompressible fluid
simulation. Particles carry `position` / `velocity` / `density` /
`pressure`. Each frame:

```
computeDensityPressure → computeForces → integrate
```

Spatial hash accelerates neighbour queries, avoiding O(n²). Independent
of the ECS `PhysicsSystems` (fluid shape differs from rigid bodies).
`getMeshData()` outputs particle positions for rendering; can be paired
with `Particles/` rendering pipeline.

### `DestructionSystem` + `VoronoiFracture`

- `VoronoiFracture` — uses Voronoi cell partitioning to slice a
  `BufferGeometry` into multiple chunks; each chunk outputs an
  independent geometry + center point.
- `DestructionSystem` — manages chunk rigid-body generation + physics
  simulation. On fracture trigger, replaces the original mesh with the
  chunk set; each chunk carries `Rigidbody` + `Collider`.
- Cooperates with `ConstraintSolver`: chunks can temporarily use
  `DistanceJointConstraint` to simulate adhesion.
- Suitable for destructible walls / glass shattering effects.

### `PhysicsDemo` (`PhysicsDemo.ts`)

Ships a 24-body scene with random boxes and a particle emitter,
exercisable from the `PHYSICS` and `PHYS-DBG` toolbar toggles in the
inspector.

---

## Advanced Physics Subsystems

The following subsystems are **decoupled from the ECS `PhysicsSystems`**
because their shape (1D chains, 2D surfaces, 3D volumes, 6DOF aircraft,
multi-body vehicles) differs significantly from single-transform rigid
bodies. Each ships its own `update(dt)` loop; the caller syncs
`position`/`orientation` to render meshes.

### `PhysicsMaterial` (`PhysicsMaterial.ts`)

Pure-data material describing **what a body is made of** — decoupled from
render materials. Covers both *contact mechanics* (friction/restitution)
and *continuum mechanics* (Young's modulus, Poisson ratio, yield/tensile/
compressive strength, fracture toughness) for the destruction system.

| Field | Unit | Description |
|-------|------|-------------|
| `friction` / `dynamicFriction` | — | Static / kinetic friction (≥0) |
| `restitution` | [0,1] | 0 = inelastic, 1 = perfectly elastic |
| `density` | kg/m³ | `computeMass(volume) = density × volume` |
| `youngsModulus` | Pa | Elastic deformation stiffness |
| `poissonsRatio` | [-1,0.5] | Lateral/longitudinal strain |
| `yieldStrength` / `tensile` / `compressive` | Pa | Plastic / failure thresholds |
| `fractureToughness` | Pa·√m | Crack-growth critical stress intensity |
| `damping` | [0,1] | Kinetic energy dissipation |
| `isPlastic` / `plasticThreshold` | — | Permanent deformation after yield |

`combine(other, mode)` produces contact-equivalent friction/restitution;
`mode ∈ average | min | max | multiply`. Preset factories:
`createMetal / createWood / createRubber / createGlass / createConcrete /
createIce / createFlesh` (values from engineering handbooks).

```ts
const steel = PhysicsMaterial.createMetal();
steel.setRestitution(0.3).setFriction(0.6, 0.5);
const mass = steel.computeMass(0.5); // 0.5 m³ steel → ~3950 kg
const eq = steel.combine(glass, 'average'); // contact-equivalent params
```

### `ConstraintSystem` (`ConstraintSystem.ts`)

High-level constraint **manager** — complements the low-level
`ConstraintSolver` (which holds `Constraint` subclass instances for
assembling a constraint graph). `ConstraintSystem` holds flat
`PhysicsConstraint` descriptors (id-indexed) for **runtime add/remove,
configuration, and breakage detection** (editor / level-script use).

- **Solve strategy**: Sequential Impulse + Baumgarte — (1) position
  projection directly corrects `body.position` for geometric convergence;
  (2) velocity-correction impulse removes constraint-violating relative
  velocity + a small Baumgarte velocity bias.
- **Breakable constraints**: accumulates per-frame applied impulse
  magnitude; exceeding `breakForce` marks `isBroken` (skipped in
  subsequent solves; caller decides removal).
- `ConstraintType ∈ fixed | hinge | ball | slider | spring | cone`;
  `ConstraintLimit { min, max, bounciness }`.

```ts
const sys = new ConstraintSystem({ iterations: 12 });
const id = sys.addConstraint({
  type: 'hinge', bodyA, bodyB,
  anchorA: new Vector3(0,0.5,0), anchorB: new Vector3(0,-0.5,0),
  axis: new Vector3(0,1,0),
  limits: { min: -Math.PI/2, max: Math.PI/2, bounciness: 0 },
  breakForce: 5000,
});
sys.solve(dt);
if (sys.getConstraint(id)!.isBroken) sys.removeConstraint(id);
```

### `RopePhysics` (`RopePhysics.ts`)

1D Verlet-chain soft body — complements `ClothSimulation` (2D surface).
Segments carry `position` / `prevPosition` / `acceleration`.

- **Distance constraints** (PBD, iterated) keep `segmentLength` between
  adjacent nodes.
- **Bending constraints**: for each triple (a,b,c), clamps turn angle
  `angle(d1,d2)` to `maxBendAngle` (0 = straight, π = fold-back).
- **Wind** accumulates as continuous acceleration on non-pinned segments.
- **Collision**: `collideWithSphere` pushes penetrating segments to the
  sphere surface.
- Pinned segments (`pin(i, pos?)`) are excluded from integration.

| Option | Default | Description |
|--------|---------|-------------|
| `gravity` | (0,-9.8,0) | Gravitational acceleration |
| `wind` | (0,0,0) | Wind acceleration |
| `damping` | 0.01 | Verlet velocity damping [0,1] |
| `stiffness` | 1.0 | Distance-constraint stiffness [0,1] |
| `iterations` | 4 | Constraint-solve iterations |
| `thickness` | 0.05 | Rope radius (render/collision) |
| `maxBendAngle` | π | Max turn angle (rad) |

### `AdvancedCollisionSystem` (`CollisionSystem.ts`)

Standalone 3-stage collision detection (decoupled from ECS
`PhysicsSystems` — pure detection, no integration/impulse response).
Re-exported as `AdvancedCollisionSystem` to avoid a name clash with the
ECS `CollisionSystem`.

| Stage | Algorithms |
|-------|-----------|
| Broadphase | `bruteforce` (O(n²) AABB) / `sweep` (sort-sweep) / `bvh` (hierarchy) |
| Narrowphase | `sat` (sphere/box exact) / `gjk` (Minkowski diff, intersect-only) / `epa` (GJK+EPA, exact penetration depth + normal) |
| Manifold | Contact points + normal (A→B convention) |

Specialized fast paths `testSphereSphere` / `testSphereBox` / `testBoxBox`
(SAT OBB-OBB) are faster and more numerically stable than generic GJK;
the narrowphase entry prefers them. `testRaycast` supports
sphere/box/capsule/convex/mesh (mesh = per-triangle), returning nearest
`{ point, normal, distance }`.

`ColliderType ∈ sphere | box | capsule | convex | mesh`. Convex/mesh in
GJK/EPA treat the mesh as a vertex convex hull (concavities ignored);
raycast does exact per-triangle intersection.

### `VehiclePhysics` (`VehiclePhysics.ts`)

Multi-body vehicle: chassis + wheels (suspension + tire).

- **Suspension** (spring-damper): per-wheel `suspensionForce =
  k·compression − d·velocity` along `contactNormal`.
- **Tire** (simplified Pacejka):
  `F = D·sin(C·atan(B·slip − E·(B·slip − atan(B·slip))))`, with
  `D = μ·load`. `slipAngle = atan2(lateralVel, longVel)`,
  `slipRatio = (wheelSpinVel·r − vLong)/max(|vLong|, ε)`.
- **Engine**: `rpm = maxRPM·|throttle|` (idle `idleRPM`), torque curve.
- **Drivetrain**: `gearRatio[gear] × differentialRatio` maps wheel
  torque ↔ engine rpm; `clutch ∈ [0,1]` scales transferred torque.
- **Steering**: `steeringInput(-1..1)` advances `targetAngle` at
  `steeringSpeed`; front wheels deflect by `steeringAngle`.
- **Braking**: `brakeInput` / `handbrake` → `wheel.brakingForce`.
- **Aerodynamics**: `downforce = ½·ρ·v²·Cl·A`, `drag = ½·ρ·v²·Cd·A`.

`Wheel` carries `position / radius / steering / driven / braking /
suspensionRest / suspensionStiffness / suspensionDamping /
suspensionForce / tireGrip / slip / slipRatio / isGrounded / contactPoint`.

### `FlightPhysics` (`FlightPhysics.ts`)

6DOF aircraft dynamics. Body frame: +X right (wingspan), +Y up, −Z forward
(nose). `orientation` (Quaternion) maps body→world.

- **Lift** (Bernoulli): `L = ½·ρ·v²·Cl·A`, perpendicular to airflow.
  `Cl = Cl0 + 2π·sin(AOA)` (thin-airfoil linear); **stall** clamps Cl
  beyond `stallAngle`.
- **Drag**: `D = ½·ρ·v²·Cd·A`, `Cd = Cd0 + k·Cl²` (induced).
- **Thrust**: along body −Z, `throttle ∈ [0,1] → thrust ∈ [0, maxThrust]`.
- **Gravity**: world −Y, `F = m·g`.
- **Control surfaces**: `aileron` (roll) / `elevator` (pitch) /
  `rudder` (yaw) / `flap` (extra lift) / `spoiler` (lift-kill + drag).
  Moment `M = ½·ρ·v²·Cm·A·chord` about the corresponding axis.
- **AOA / sideslip**: angle between body forward and airflow
  (pitch / yaw plane). **G-force** = `|a| / 9.81`.

`ControlSurface { type, deflection, maxDeflection, effectiveness, area, arm }`.

### `Buoyancy` (`Buoyancy.ts`)

Vertical long-range force system (decoupled — shape differs from
impulse-based rigid-body response).

- `computeSubmergedVolume`: voxelizes the rotated AABB (N samples),
  transforms to world, counts `y < fluidHeight` ratio.
- `computeBuoyancy`: Archimedes `F = ρ_fluid · V_sub · g` (upward).
- `computeDrag`: `F = −linearDrag · v · submergedRatio` (only submerged
  part experiences water drag).
- `computeStability`: restoring torque pulling a capsized body upright —
  `τ ∝ cross(bodyUp, worldUp) · submergedRatio`.
- `update(dt)`: semi-implicit Euler integration of position/velocity/
  rotation/angularVelocity.

```ts
const b = new Buoyancy({ fluidLevel: 0 });
b.registerBody('boat', {
  mass: 100, volume: 0.5, halfExtents: new Vector3(1, 0.5, 2),
  position: new Vector3(0, 1, 0), /* ... */
});
b.update(dt);
const ratio = b.getSubmergedRatio('boat'); // 0..1
```

### `SoftBodySimulation` (`SoftBodySimulation.ts`)

3D volumetric soft body — complements `ClothSimulation` (2D surface).
Mass-spring (tetrahedral mesh) + **volume preservation** + **shape
matching** (Müller et al. 2005).

- **Shape matching**: pulls deformed particles back to the optimal rigid
  transform of the rest pose → elastic-plastic blend. `β=0` fully rigid,
  `β=1` free deformation.
- **Internal pressure** (inflation): balloon/sphere — pressure pushes the
  surface outward.
- Integration: Verlet (stable, energy-conserving); constraints: PBD
  position correction, iterated.

`SoftBodyParticle { position, prevPosition, acceleration, mass, invMass,
pinned, goalPosition }`. `SpringType ∈ structural | shear | bend`.
`VolumeConstraint { a, b, c, d, restVolume, stiffness }` (tetrahedron).

References: Müller et al. PBD 2006; Müller et al. Shape Matching 2005;
o3de PhysX SoftBody.

### `ConeTwistConstraint` (`ConeTwistConstraint.ts`)

Ball joint + **swing cone** limit + **twist** limit. Used for ragdoll
shoulders/hips/spine/neck where bi-directional swing + axial twist
limits are needed. Extends `Constraint` (reuses `computePointEffectiveMass`
/ `applyImpulse` / Mat3 helpers). Limits: `swingCone` (half-angle, rad),
`twistMin` / `twistMax` (rad).

### `RagdollSystem` (`RagdollSystem.ts`)

Skeleton → rigidbody pipeline: converts `Bone`s to `RigidbodyLike`
(sphere/capsule/box) + `ConeTwistConstraint` (shoulder/hip/spine) or
`HingeJointConstraint` (knee/elbow), simulates gravity/collision, then
**writes world transforms back to `Bone`** local space (accounting for
parent world transform) and calls `updateMatrixWorld()`.

- Sim step: gravity → velocity → angular velocity (quaternion) →
  `ConstraintSolver` → optional ground collision.
- `collideWithSphere` / `collideWithBox` optional external interaction.
- `createHumanoidRagdollConfig(skeleton)` factory builds a standard
  biped config (head/torso/upper-arm/forearm/thigh/shin).

`RagdollBoneConfig { boneName, parentBone, shape, radius?, halfExtents?,
length?, mass, joint?, parentAnchor?, ... }`. `joint ∈ cone | hinge |
fixed | ball`.

References: o3de PhysX `RagdollConfiguration` / `RagdollInstance`;
Unreal `FAnimNode_Ragdoll`; three.js AmmoJS ragdoll demo.

```ts
const rag = new RagdollSystem(skeleton, { gravity: new Vector3(0,-9.8,0) });
rag.createBones(createHumanoidRagdollConfig(skeleton));
rag.applyImpulse('spine_01', new Vector3(2, 0, 0)); // shove
function frame(dt: number) {
  rag.update(dt);
  rag.writeBackToBones(); // syncs Bone transforms for skinned mesh
}
```

---

## Colliders

Supported by the ECS `CollisionSystem`:

| Collider | Fields |
|----------|--------|
| `AABB` | `min` / `max` (`Vector3`) |
| `Sphere` | `center` / `radius` |
| `Capsule` | `start` / `end` / `radius` |

---

## Integration

```ts
import { World, PhysicsSystem, CollisionSystem } from '@vreen/engine/ecs';
import { ConstraintSolver, BallJointConstraint } from '@vreen/engine/physics';

const world = new World();
const physics = new PhysicsSystem({ fixedStep: 1 / 60 });
const solver = new ConstraintSolver({ iterations: 10 });

// Register systems (priority ordered)
world.addSystem(physics);
world.addSystem(new CollisionSystem());
world.addSystem(solver);

// Create two rigidbodies connected by a ball joint
const a = world.createEntity();
world.addComponent(a, new Transform({ position: new Vector3(0, 5, 0) }));
world.addComponent(a, new Rigidbody({ mass: 1 }));
world.addComponent(a, new Collider({ shape: 'sphere', radius: 0.5 }));

const b = world.createEntity();
// ... configure b ...

solver.addConstraint(new BallJointConstraint(
  getBody(a), getBody(b),
  /* anchorA */ new Vector3(0, -0.5, 0),
  /* anchorB */ new Vector3(0,  0.5, 0),
));

// Fixed-step loop
function tick(dtMs: number) {
  physics.accumulate(dtMs / 1000); // accumulates time, steps when due
  world.update(physics.fixedStep);
}
```

For cloth:

```ts
import { ClothSimulation } from '@vreen/engine/physics';

const cloth = new ClothSimulation({ width: 20, height: 20, spacing: 0.1 });
cloth.pin(0, 0);            // top-left corner
cloth.pin(cloth.width - 1, 0); // top-right corner

function frame(dt: number) {
  cloth.update(dt);
  const { positions, indices, normals } = cloth.getMeshData();
  // upload to BufferGeometry...
}
```

---

## Design Notes

**Why fixed-step instead of variable-step?**
- **Determinism** — fixed-step integration is deterministic, essential
  for replay / recording / network sync.
- **Stability** — semi-implicit Euler at a fixed step is more stable
  than variable-step for impulse-based collision response.
- **Simplicity** — a single integration step is easier to reason about
  and test than a sub-stepping variable integrator.

Trade-off: fixed-step physics can produce visual stutter at high frame
rates unless interpolated. The renderer currently renders at the
simulation state; interpolation is a future enhancement.

**Why is `ClothSimulation` separate from ECS `PhysicsSystems`?**
Soft-body shape (particle grid + distance constraints) differs
significantly from rigid bodies (single transform + collider). Mixing
them in one system would force awkward branching. Future ECS integration
could wrap this as a `ClothComponent` + `ClothSystem`.

**Why `RigidbodyLike` interface?** Decouples constraints from any
specific rigid-body implementation. The ECS `Rigidbody` component
satisfies it, but a user could swap in a third-party body (e.g. Rapier,
cannon-es) and reuse the same constraint code.

**Baumgarte stabilization.** A positional correction term added after
impulse-based collision resolution to push intersecting bodies apart
gradually, avoiding jitter.
