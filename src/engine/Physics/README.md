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
simulators, and the demo scene.

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
