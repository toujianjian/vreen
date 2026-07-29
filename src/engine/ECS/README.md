# ECS Module

> Path: `src/engine/ECS/`
>
> The Entity-Component-System core of the `@vreen/engine` kernel. Modelled
> on O3DE's CES principles with POJO components for serializability.

---

## Overview

The ECS is the architectural backbone of the engine. Three explicit
separations:

| Concept | Implementation | Storage |
|---------|----------------|---------|
| **Entity** | `EntityId` (32-bit packed int) | `World._entities: EntitySlot[]` indexed by `entityIndex(id)` |
| **Component** | Plain class instance registered against `ComponentType<T>` | Per-type `Map<EntityId, T>` inside `World._components` |
| **System** | Class with `priority: number` and `update(world, dt)` | `World._systems: System[]` sorted by priority |

```
┌──────────────────┐   query(types)   ┌──────────────────┐
│      System      │ ───────────────→ │      World       │
│ (e.g. Movement)  │                  │  _entities       │
└──────────────────┘                  │  _components     │
       ▲                              │  _systems        │
       │ update(world, dt)            └────────┬─────────┘
       │                                       │
       │                  addComponent / getComponent / removeComponent
       │                                       │
       │                                       ▼
       │                              ┌──────────────────┐
       └──────────────────────────────│  ComponentType   │
                                      │  TransformC      │
                                      │  VelocityC       │
                                      │  RigidbodyC      │
                                      │  …               │
                                      └──────────────────┘
```

---

## Core Classes

### Entity Model

An **Entity** is a 32-bit packed ID:

```
  version (12 bits)  │  index (20 bits)
  ─────────────────  ──────────────────
   ↑ bumped each time the index is reused → stale references are detectable.
```

Helpers: `packEntityId(index, version)`, `entityIndex(id)`,
`entityVersion(id)`, `isValidEntityId(id, current)`.

### Component Model

A **Component** is a plain TypeScript class instance. Each component
class is registered with a `ComponentType<T>` (a string-ID singleton).
The string ID avoids the circular-import problem that arises when
components reference the `World` type — `ComponentType` is split into
its own file (`ComponentType.ts`) so `Components.ts` can import it
without going through `World.ts`.

Built-in components (in `Components.ts`):

| Component | Field Highlights |
|-----------|------------------|
| `Transform` | `position` / `rotation` / `scale` / `parent` |
| `Velocity` | `vx` / `vy` / `vz` |
| `PlayerInput` | `move` / `look` / `jump` / `sprint` |
| `AnimState` | `currentState` / `nextState` / `transitionT` |
| `MeshRef` | `mesh: Mesh` (non-POJO, skipped in `toJSON`) |
| `SkinnedMeshRef` | `mesh: SkinnedMesh` (non-POJO) |
| `Health` | `current` / `max` |
| `Tag` | `name: string` |
| `Lifetime` | `remaining: number` |

Physics components (in `PhysicsComponents.ts`):
`Rigidbody`, `Collider` (AABB / Sphere / Capsule), `Particle`,
`ParticleEmitter`, `PhysicsConfig`, `PhysicsDebug`.

`NON_POJO_COMPONENTS` is a `Set<string>` listing components that hold
runtime object references and must be re-attached by the caller after
`World.toJSON()` / `World.loadJSON()`.

### `World`

```ts
class World {
  createEntity(name?: string): EntityId;
  destroyEntity(id: EntityId): void;
  addComponent<T>(id: EntityId, component: T): void;
  getComponent<T>(id: EntityId, type: ComponentType<T>): T | undefined;
  removeComponent(id: EntityId, type: ComponentType): void;
  query(...types: ComponentType[]): EntityId[];
  addSystem(system: System): void;
  update(dt: number): void;
  toJSON(): WorldJson;
  loadJSON(json: WorldJson): void;
}
```

Invariants (enforced / documented in `World.ts`):
- `ComponentType.id` is globally unique; destroying a `ComponentType` is
  forbidden.
- Inside `World.update(dt)`, systems read component data only. Systems
  that need to mutate call `setComponent` (deferred-apply semantics
  inside the iteration).
- `query(...types)` returns a fresh array each call (safe for structural
  mutation during iteration). Hot paths should use `QueryBuilder` with
  caching instead.

### Systems

`System` is a plain class with `priority: number` and
`update(world: World, dt: number): void`. The World iterates systems in
ascending `priority` order. Built-in systems (in `Systems.ts`):

| System | Role |
|--------|------|
| `MovementSystem` | Integrates `Velocity` into `Transform.position`. |
| `AnimationTickSystem` | Advances `AnimationMixer` per `SkinnedMeshRef`. |
| `AnimStateSystem` | Ticks `AnimationStateMachine` based on `Velocity` magnitude. |
| `PlayerInputSystem` | Translates `PlayerInput` into `Velocity` (camera-relative). |
| `LifetimeSystem` | Destroys entities whose `Lifetime.remaining <= 0`. |

Physics systems (in `PhysicsSystems.ts`):

| System | Role |
|--------|------|
| `PhysicsSystem` | Fixed-step semi-implicit Euler + quaternion integration. |
| `CollisionSystem` | Broadphase + narrowphase + impulse response + Baumgarte. |
| `ParticleSystem` | CPU particle advance + emitter spawn. |
| `PhysicsDebugSystem` | Push lines / contacts to `PhysicsDebugRenderer`. |

### `Prefab`

`Prefab` holds a list of entity templates (components + transforms) and
instantiates them with `instantiate(world): EntityId[]`. Supports nested
prefabs and per-instance overrides via `InstantiateOptions`.

### `QueryBuilder`

Fluent, cached query API for high-frequency system iteration:

```ts
const movers = new QueryBuilder(world)
  .with(TransformC, VelocityC)
  .without(TagC)
  .build();  // returns EntityId[] cached and invalidated on structural change
```

### `Broadphase`

Spatial acceleration for collision detection, replacing the naive O(n²)
narrowphase. Pluggable; default implementation is a uniform grid.

---

## ECS ↔ Scene Graph Bridge

The ECS and the scene graph are *parallel* structures. An entity that
should be rendered carries a `MeshRef` (or `SkinnedMeshRef`) component
pointing at a `Mesh` in the scene graph. Once per frame,
`syncMeshesFromTransforms(world)` copies the entity's `Transform`
component into the `Mesh`'s `position` / `rotation` / `scale` and bumps
`matrixWorldNeedsUpdate`.

This keeps the renderer completely ECS-unaware — it just walks the scene
graph — and lets the ECS drive game logic without entangling itself with
GPU resources.

```
ECS World                          Scene Graph
─────────────                      ───────────
Entity #1                          Scene
 ├─ Transform  ──── sync ────────→  └─ Mesh A
 ├─ Velocity                          ├─ position (← Transform.position)
 └─ MeshRef ───── ref ─────────────→  ├─ rotation (← Transform.rotation)
                                      └─ scale    (← Transform.scale)
```

---

## Serialization

`World.toJSON()` produces a `WorldJson` snapshot:
- `entities: WorldEntityJson[]` — each entity's name, version, and
  POJO-component map.
- `systems: string[]` — system class names (rebuilt by caller).
- Non-POJO components (in `NON_POJO_COMPONENTS`) are skipped; the caller
  re-attaches them after `loadJSON`.

`World.loadJSON(json)` reconstructs the world and is round-trip tested.
The snapshot is embeddable in `.vreen` packages as `world.json`.

---

## Usage Examples

### Creating entities

```ts
import { World, TransformC, VelocityC, HealthC, TagC } from '@vreen/engine/ecs';
import { Vector3 } from '@vreen/engine/math';

const world = new World();

const enemy = world.createEntity('goblin');
world.addComponent(enemy, new Transform({ position: new Vector3(0, 0, 5) }));
world.addComponent(enemy, new Velocity(0, 0, -1));
world.addComponent(enemy, new Health(100, 100));
world.addComponent(enemy, new Tag('hostile'));

// Query
const hostiles = world.query(TagC, HealthC);
```

### Adding a system

```ts
class DamageSystem {
  priority = 50;
  update(world: World, dt: number) {
    for (const id of world.query(HealthC)) {
      const hp = world.getComponent(id, HealthC)!;
      if (hp.current <= 0) world.destroyEntity(id);
    }
  }
}

world.addSystem(new DamageSystem());
world.update(1 / 60);
```

### Cached queries

```ts
// Hot path — cached, invalidated on structural change
const movers = new QueryBuilder(world)
  .with(TransformC, VelocityC)
  .build();

function frame(dt: number) {
  for (const id of movers) {
    const v = world.getComponent(id, VelocityC)!;
    // ...
  }
}
```

### Round-trip serialization

```ts
const json = world.toJSON();
// ... store json, send over network, embed in .vreen ...

const restored = new World();
restored.loadJSON(json);
// re-attach non-POJO components (MeshRef / SkinnedMeshRef)
```

---

## Design Notes

**Why ECS instead of OOP components?**
- **Data locality** — components stored in per-type `Map`s enable
  cache-friendly system iteration.
- **Serializable by default** — POJO components round-trip through
  `World.toJSON()` / `loadJSON()` and embed cleanly in `.vreen` packages.
- **Parallel with O3DE CES** — borrowing O3DE's CES pattern gives the
  project a proven architectural reference and a clear path to Prefab
  nesting, network sync, and snapshot diffing.

**Why split `ComponentType` into its own file?** To break the circular
dependency between `Components.ts` (which references `ComponentType`)
and `World.ts` (which `ComponentType` would naturally live near). The
string-ID `ComponentType` lets components declare their type without
importing the `World`.

**Why deferred-apply semantics inside `World.update`?** Mutating the
component map while iterating it would invalidate the iterator. The
`setComponent` call inside a system is queued and applied after the
current system's iteration completes, so systems can safely mutate
without copying.

**`query` returns a fresh array each call.** This is intentionally
allocation-heavy to guarantee safety during structural mutation. Hot
paths must use `QueryBuilder` with caching; the cached query is
invalidated automatically on structural changes (entity destroyed,
component added/removed).

**ECS ↔ scene-graph bridge keeps renderer ECS-unaware.** The renderer
just walks the scene graph. This decoupling means the renderer can be
reused without the ECS (e.g. for the `/viewer` Three.js path) and the
ECS can be simulated headlessly (e.g. for network server logic) without
a renderer.
