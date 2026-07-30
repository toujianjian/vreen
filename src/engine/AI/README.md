# AI Module

> Path: `src/engine/AI/`
>
> The artificial-intelligence subsystem of the `@vreen/engine` kernel.
> Provides navigation meshes and Recast-style mesh building, A* pathfinding
> with string-pulled smoothing, Reynolds steering behaviors, single-agent
> and crowd simulation, a perception system covering vision / hearing /
> touch / smell with memory, a behavior tree engine (composites /
> decorators / actions / conditions) backed by a typed `Blackboard`, and a
> small machine-learning interface for learned decision making.

---

## Overview

```
                     ┌─────────────────────────────────────────────┐
                     │              Perception layer               │
                     │   PerceptionSystem ── vision / hearing /    │
                     │                      touch / smell + memory │
                     └───────────────────┬─────────────────────────┘
                                         │ writes targets to
                                         ▼
                     ┌─────────────────────────────────────────────┐
                     │              Decision layer                 │
   Blackboard ◀──────┤  BehaviorTree                                 │
   (key/value store) │     └── BTComposite (Sequence/Selector/      │
                     │         Parallel)                             │
                     │     └── BTDecorator (Inverter/Repeater/      │
                     │         Succeeder/Failer/UntilFail)          │
                     │     └── BTAction / BTCondition (leaves)      │
                     └───────────────────┬─────────────────────────┘
                                         │ writes path / velocity to
                                         ▼
                     ┌─────────────────────────────────────────────┐
                     │              Navigation layer               │
                     │   NavMesh ◀── NavMeshBuilder (Recast)        │
                     │     └── PathFinder (A* + funnel smooth)      │
                     │   SteeringBehavior (seek/flee/arrive/        │
                     │     pursue/evade/wander/flocking/avoidance)  │
                     │   Agent (single) / CrowdSystem (many + grid) │
                     └─────────────────────────────────────────────┘
                                         ▲
                                         │ optional learned policy
                     ┌─────────────────────────────────────────────┐
                     │           Learning layer (opt)              │
                     │   MLInterface — neural_network / knn /       │
                     │     decision_tree / svm + train / predict    │
                     └─────────────────────────────────────────────┘
```

The four layers are intentionally decoupled: perception writes facts into
the `Blackboard`, the behavior tree reads the blackboard and decides an
action, the action drives an `Agent` or `CrowdSystem` over a `NavMesh`,
and an optional `MLInterface` model can replace or augment the tree's
decision with a learned policy.

---

## Core Classes

### Navigation

| Export | Role |
|--------|------|
| `NavMesh` | Triangle-mesh walkable surface. Holds vertices, triangles, adjacency edges; answers `findTriangle` / `isWalkable` / `getClosestPoint` / `findPath` queries. Serialized via `serialize()` / `deserialize()`. |
| `NavMeshBuilder` | Recast-style voxel pipeline (voxelize → mark walkable → erode → regions → contours → simplify → poly mesh) that turns an arbitrary `BufferGeometry` into a `NavMesh`. |
| `PathFinder` | A* pathfinder on a `NavMesh`. Triangle-level A* with a min-heap open set, then string-pulling smoothing of the raw waypoint chain. |
| `SpatialGrid` | 2-D XZ uniform grid for neighborhood queries. `O(1)` insert/remove, `O(k)` radius query. Used by `CrowdSystem` for separation. |

```ts
export interface NavTriangle {
  a: number; b: number; c: number;     // vertex indices
  center: Vector3;                      // cached centroid (A* heuristic)
  area: number;                         // |ab × ac| / 2
  normal: Vector3;                      // unit normal (slope filter)
  neighbors: number[];                  // adjacent triangle indices (≤ 3)
}

export interface NavMeshJSON {
  vertices: number[][];                 // [[x,y,z], ...]
  triangles: Array<{ a: number; b: number; c: number; neighbors: number[] }>;
}
```

`NavMesh.build(geometry)` consumes a `BufferGeometry` (indexed or
non-indexed); `buildFromHeightmap(heights, w, h, scale)` triangulates a
regular height grid (two triangles per cell). `walkableNormalY` (default
`0.7` ≈ cos 45°) and `maxTriangleArea` (0 = unlimited) gate which
triangles count as walkable.

`PathFinder.findPath(start, end)` returns a smoothed world-space waypoint
array. Off-mesh start/end points are snapped to the nearest walkable
triangle center via `NavMesh.getClosestPoint`.

### Steering & Agents

| Export | Role |
|--------|------|
| `SteeringBehavior` | Stateless Reynolds steering library. All methods return a `Vector3` force; an `Agent` accumulates and integrates them. |
| `Agent` | Single AI navigation entity. Holds position / velocity / acceleration / path + `followPath()` + semi-implicit Euler `update(dt)`. |
| `CrowdSystem` | Many-agent scheduler. Lightweight `CrowdAgent` data + shared `SteeringBehavior` + `SpatialGrid` separation + optional `NavMesh` pathing. |

`SteeringBehavior` behaviors:

| Method | Behavior |
|--------|----------|
| `seek(agent, target)` | Move toward target at `maxSpeed`. |
| `flee(agent, threat)` | Inverse of `seek`; falloff past 100 units. |
| `arrive(agent, target, slowingDistance)` | `seek` with proportional slowdown inside `slowingDistance`. |
| `pursue(agent, quarry)` | `seek` the quarry's predicted future position. |
| `evade(agent, pursuer)` | `flee` the pursuer's predicted position; no-op past 50 units. |
| `wander(agent)` | Jittered circle-ahead wander (Reynolds). |
| `separation(agent, neighbors)` | Push away from nearby neighbors (inverse-square). |
| `alignment(agent, neighbors)` | Match average neighbor velocity. |
| `cohesion(agent, neighbors)` | `seek` the neighbor centroid. |
| `obstacleAvoidance(agent, obstacles)` | Lateral avoidance force from the most threatening obstacle ahead. |

```ts
export interface AgentOptions {
  position: Vector3;
  velocity: Vector3;
  maxSpeed: number;        // units / second
  maxForce: number;        // per-frame acceleration cap
  mass: number;            // kg (scales seek/flee output)
  radius: number;          // for separation / collision
  path: Vector3[];
  loop: boolean;
  behavior: SteeringBehavior;
}
```

`Agent.update(dt)` runs: `followPath()` → accumulate force → clamp to
`maxForce` → semi-implicit Euler `velocity += acc*dt` → clamp to
`maxSpeed` → `position += vel*dt` → zero acceleration. `WAYPOINT_REACHED_DISTANCE`
is `0.5` units.

`CrowdSystem` mirrors this loop at scale: per frame it rebuilds the
`SpatialGrid`, throttles A* recomputation per agent (default
`pathFindInterval = 0.5s`), computes an inline `arrive` force along the
current path, adds a 1.5×-weighted separation force from grid neighbors,
integrates, and flips state to `'arrived'` within
`TARGET_REACHED_DISTANCE = 0.5`. `getStats()` returns a `CrowdStats`
snapshot (active / arrived / moving / idle counts + average speed).

### Behavior Tree

| Export | Role |
|--------|------|
| `BTNode` | Abstract base. `name`, `tick(blackboard) → BTStatus`, `reset()`, `abort()`, `isAborted()`, `getStatus()`. |
| `BTComposite` | Abstract base for nodes with multiple children. `addChild` / `removeChild` / `getChildren` / `childCount`; cascades `reset` and `abort`. |
| `Sequence` | AND — succeeds only if every child succeeds; fails fast on first failure; resumes from `runningIndex` next frame. |
| `Selector` | OR — succeeds on first child success; fails only if every child fails; resumes from `runningIndex`. |
| `Parallel` | Ticks every child each frame; succeeds when `successThreshold` children succeed, fails when `failureThreshold` children fail. |
| `BTDecorator` | Abstract base for single-child modifiers. `setChild` / `getChild`. |
| `Inverter` | Swaps `success` ↔ `failure`; `running` passes through. |
| `Repeater` | Re-ticks child `count` times (`< 0` = infinite); resets child between iterations; stops on child failure. |
| `Succeeder` | Always returns `success` (unless child is `running`). |
| `Failer` | Always returns `failure` (unless child is `running`). |
| `UntilFail` | Re-ticks child until it returns `failure`, then returns `success`; `maxIterations` guards against infinite loops. |
| `BTAction` | Leaf that executes an injected `BTActionFn: (bb) => BTStatus`. |
| `BTCondition` | Leaf that evaluates a `BTConditionFn: (bb) => boolean`; returns `success` / `failure`, never `running`. |
| `BehaviorTree` | Top-level driver. `setRoot`, `getBlackboard`, `tick()`, `interrupt()` (recursive abort), `reset()`. |
| `Blackboard` | Typed key/value store shared by all nodes in a tree. |

```ts
export type BTStatus = 'success' | 'failure' | 'running';

export interface ParallelPolicy {
  successThreshold: number;
  failureThreshold: number;
}

export type BTActionFn    = (blackboard: Blackboard) => BTStatus;
export type BTConditionFn = (blackboard: Blackboard) => boolean;
```

`Blackboard` offers generic `get<T>(key)` / `set` / `has` / `remove` /
`clear` plus type-safe accessors `getNumber`, `getString`, `getBool`,
`getVector3` (duck-typed on `x`/`y`/`z` number fields). A blackboard can
be shared between multiple trees to act as an inter-AI message board.

`BehaviorTree` invariants:
- `tick()` returns `'failure'` while `interrupted`; `reset()` must be
  called before tick resumes.
- A composite's `runningIndex` persists across frames so a `running`
  child is re-ticked next frame instead of restarting from index 0.
- `BTCondition` is side-effect-free and never returns `'running'`; it is
  the recommended node for "if-then" gating inside a `Selector` or
  `Sequence`.

### Perception

| Export | Role |
|--------|------|
| `PerceptionSystem` | Manages `Sensor`s, runs detection per frame, records `PerceptionEvent`s with `strength` and `isConfirmed`. |
| `Sensor` | Single perception organ attached to an `owner`. Typed by `SensorType`. |
| `PerceptionEvent` | One detection record: sensor id, target, position snapshot, strength, timestamp, `isConfirmed`. |
| `PerceptionTarget` | Minimum target contract: `position`, `type`, optional `noise`. |
| `OcclusionTest` | Optional `(from, to) => boolean` callback used by vision sensors. |

```ts
export type SensorType = 'vision' | 'hearing' | 'touch' | 'smell';

export interface Sensor {
  id: string;
  type: SensorType;
  owner: any;              // must expose position: Vector3 (+ optional forward / velocity / rotation)
  range: number;
  angle: number;           // FOV in radians (vision only)
  sensitivity: number;     // [0,1] confirmation threshold
  filter: string[];        // target.type whitelist (empty = all)
  cooldown: number;        // seconds between detections
  lastTrigger: number;     // last confirmed timestamp
}
```

Detection algorithm per sensor type:
- **vision** — distance ≤ `range` AND `forward · dirToTarget ≥ cos(angle/2)` AND optional occlusion test passes.
- **hearing** — `noise · (1 - dist/range) ≥ sensitivity`.
- **touch** — `dist ≤ range` (touch sensors usually have tiny `range`).
- **smell** — wind-modulated range: `_toSensor · windDirection` scales effective range between 25% (upwind) and 100% (downwind); calm wind halves range.

`strength ∈ [0,1]` is `1 - dist/range` (or noise-attenuated for
hearing). Events with `strength ≥ sensor.sensitivity` are marked
`isConfirmed` and refresh `lastTrigger` for cooldown. The event buffer
is FIFO-capped at `maxPerceptions` (default 256).

### Machine Learning

| Export | Role |
|--------|------|
| `MLInterface` | Model registry + training + inference. |
| `MLModel` | Trained model artifact (weights, biases, layers, activation). |
| `MLModelConfig` | Model creation config (type, inputs, outputs, hidden layers, learning rate, activation). |
| `TrainingSample` | `{ input: number[]; output: number[]; weight: number }`. |
| `MLModelJSON` | Serializable model snapshot for `exportModel` / `importModel`. |
| `TrainingProgress` | Live progress for async `train()`. |

```ts
export type MLModelType    = 'neural_network' | 'decision_tree' | 'svm' | 'knn';
export type ActivationType = 'sigmoid' | 'tanh' | 'relu' | 'leakyRelu';
```

`neural_network` is fully implemented: Xavier/Glorot uniform weight init,
forward pass with configurable activation, backward pass with SGD and
MSE loss, per-epoch shuffle, `await` yield between epochs to avoid
blocking the event loop. `knn` predicts via 3-nearest-neighbor vote;
`decision_tree` and `svm` degrade to 1-nearest-neighbor (simplified
implementations that still consume the same training/inference API).
Models can be saved to / loaded from an in-memory store (`saveModel` /
`loadModel`) and exported to / imported from JSON.

---

## Usage

### Pathfinding on a heightmap

```ts
import { NavMesh, PathFinder } from '@vreen/engine/ai';

const nav = new NavMesh();
nav.buildFromHeightmap(heights, 64, 64, 1.0);  // 64×64 grid, 1m per cell

const path = nav.findPath(
  new Vector3(-30, 0, -30),
  new Vector3( 30, 0,  30),
);
// path: Vector3[] of smoothed waypoints (empty if unreachable)
```

### Agent following a path

```ts
import { Agent, SteeringBehavior } from '@vreen/engine/ai';

const agent = new Agent({
  position: new Vector3(0, 0, 0),
  maxSpeed: 4,
  maxForce: 12,
  radius: 0.5,
  behavior: new SteeringBehavior(),
});
agent.setPath(nav.findPath(start, goal));

function frame(dt: number) {
  agent.update(dt);
  // copy agent.position back to the entity's Transform
}
```

### Crowd simulation

```ts
import { CrowdSystem } from '@vreen/engine/ai';

const crowd = new CrowdSystem({
  maxAgents: 500,
  cellSize: 2,
  navMesh: nav,
  avoidance: true,
  avoidanceRadius: 2,
  pathFindInterval: 0.5,
});

for (let i = 0; i < 200; i++) {
  crowd.addAgent(
    randomPointOnNav(nav),
    new Vector3(0, 0, 0),
  );
}

function frame(dt: number) {
  crowd.update(dt);
  const { activeCount, arrivedCount, avgSpeed } = crowd.getStats();
}
```

### Behavior tree with blackboard

```ts
import {
  BehaviorTree, Sequence, Selector, Parallel,
  Inverter, Repeater, UntilFail,
  BTAction, BTCondition, Blackboard,
} from '@vreen/engine/ai';

const bt = new BehaviorTree();
bt.setRoot(new Selector('root', [
  new Sequence('combat', [
    new BTCondition('hasTarget?', (bb) => bb.has('target')),
    new BTAction('attack', (bb) => {
      const target = bb.getVector3('target')!;
      agent.setTarget(target);
      agent.update(dt);
      return agent.position.distanceTo(target) < 1 ? 'success' : 'running';
    }),
  ]),
  new Sequence('patrol', [
    new BTCondition('hasPath?', (bb) => bb.get<Agent>('agent')!.path.length > 0),
    new UntilFail('walk', new BTAction('step', (bb) => {
      const a = bb.get<Agent>('agent')!;
      a.update(dt);
      return a.currentWaypoint < a.path.length ? 'success' : 'failure';
    })),
  ]),
  new BTAction('wander', (bb) => {
    bb.get<Agent>('agent')!.setTarget(randomWanderPoint());
    return 'success';
  }),
]));

bt.getBlackboard().set('agent', agent);
// each frame: bt.tick()
```

### Perception feeding the blackboard

```ts
import { PerceptionSystem } from '@vreen/engine/ai';

const perception = new PerceptionSystem(256);
perception.addSensor('eyes', {
  id: 'eyes', type: 'vision', owner: agent,
  range: 25, angle: Math.PI * 0.6, sensitivity: 0.35,
  filter: ['enemy'], cooldown: 0.1, lastTrigger: 0,
});
perception.occlusionTest = (from, to) => raycastWorld(from, to) !== null;

function frame(dt: number) {
  perception.update(dt, enemies);
  const confirmed = perception.getRecentPerceptions(0.5)
    .filter((e) => e.isConfirmed);
  if (confirmed.length > 0) {
    bt.getBlackboard().set('target', confirmed[0].position);
  }
  bt.tick();
}
```

### Training a neural network

```ts
import { MLInterface } from '@vreen/engine/ai';

const ml = new MLInterface();
ml.createModel('aim', {
  type: 'neural_network',
  inputs: 4,           // [dist, angle, hp, ammo]
  outputs: 3,          // [attack, flee, flank]
  layers: [8, 6],
  learningRate: 0.05,
  activation: 'tanh',
});
await ml.train('aim', trainingSamples, 200);
const [attackP, fleeP, flankP] = ml.predict('aim', [dist, angle, hp, ammo]);
```

---

## Invariants

- `NavMesh` is the single owner of triangle / vertex / edge data;
  `PathFinder` holds no mesh state and can be discarded after use.
- `PathFinder.findPath` snaps off-mesh endpoints to the nearest walkable
  triangle center; an empty result means unreachable.
- `Agent.update(dt)` is a no-op when `enabled === false`; `reset()`
  zeroes position-derived state.
- `CrowdSystem.addAgent` returns `-1` when `maxAgents` is reached.
  `setTarget` on an `'arrived'` agent flips it back to `'moving'` and
  forces a path recompute on the next `update`.
- `BehaviorTree.tick()` returns `'failure'` while `interrupted`; `reset()`
  is required before the tree can run again.
- `BTCondition.tick` never returns `'running'`; composites rely on this
  for cheap gating.
- `Blackboard.getVector3` uses duck typing (presence of numeric `x`/`y`/`z`
  fields) — it does not require the engine `Vector3` class.
- `PerceptionSystem.update` skips a sensor when `currentTime - lastTrigger
  < cooldown` (initial `lastTrigger = 0` is treated as "never fired" and
  bypasses the cooldown check).
- `PerceptionEvent.position` is cloned at detection time so subsequent
  target movement does not retroactively edit history.
- `MLInterface.train` is async and yields between epochs; `isTraining`
  is `true` until completion. `predict` on an untrained model is allowed
  (returns the forward pass of randomly initialized weights).
- All steering methods on `SteeringBehavior` are side-effect-free — they
  return a fresh `Vector3` and never mutate the agent.

---

## Design Notes

**Why triangle-based NavMesh instead of grid?** Triangles match the
underlying render geometry, support arbitrary slopes (Y is preserved for
ramp climbing), and produce far fewer nodes than an equivalent grid.
A* over triangles with centroid heuristics is fast enough for realtime
crowd use, and the string-pull smoother collapses long triangle chains
into a handful of turning points.

**Why `NavMeshBuilder` is a simplified Recast.** A full Recast
implementation (span merge, multi-layer heightfields, detail meshes) is
out of scope for a web engine. The simplified pipeline keeps one span
per voxel column — sufficient for typical terrain and single-floor
levels. Multi-overlap structures (bridges, multi-level platforms) are
not yet supported.

**Why FABRIK-style crowd avoidance instead of RVO/ORCA?** RVO/ORCA is
planned for the future `CrowdSystem` (Roadmap Phase 4). The current
Reynolds separation force is simple, deterministic, and adequate for the
small-to-mid crowds (≤ 1000 agents) the engine targets. `SpatialGrid`
keeps the neighbor query `O(k)` instead of `O(n²)`.

**Why behavior trees AND scripting?** Behavior trees are declarative
data-driven decision structures — easy to author in a visual editor and
hot-reload from JSON. `Scripting/` is imperative code with lifecycle
hooks. The two are complementary: trees handle "what to do" decisions,
scripts handle complex per-entity logic that doesn't fit a node graph.
Both ultimately drive the same ECS `World`.

**Why duck-typed `Blackboard.getVector3`?** Behavior trees are often
authored in a visual editor that produces plain JS objects, not engine
`Vector3` instances. Duck typing lets those objects flow through the
blackboard without forcing a `Vector3` constructor call at every leaf.

**Why is `MLInterface` in the AI module?** Learned policies are an
alternative to hand-authored behavior trees for high-dimensional
decision problems (aim, lane selection, NPC difficulty scaling). Keeping
the ML interface next to the decision layer it replaces keeps the
dependency graph simple; the interface has no coupling to navigation or
perception and could be split out if it grows.

---

## References

- `src/engine/AI/NavMesh.ts` — triangle mesh, adjacency, walkability.
- `src/engine/AI/NavMeshBuilder.ts` — Recast-style voxel pipeline.
- `src/engine/AI/PathFinder.ts` — A* with min-heap and string-pull smoothing.
- `src/engine/AI/SteeringBehavior.ts` — Reynolds steering library.
- `src/engine/AI/Agent.ts` — single-agent navigation entity.
- `src/engine/AI/CrowdSystem.ts` — crowd scheduler with `SpatialGrid`.
- `src/engine/AI/SpatialGrid.ts` — 2-D XZ uniform grid.
- `src/engine/AI/PerceptionSystem.ts` — vision / hearing / touch / smell.
- `src/engine/AI/BehaviorTree.ts` — tree driver.
- `src/engine/AI/BTNode.ts`, `BTComposite.ts`, `BTDecorator.ts`,
  `BTAction.ts`, `BTCondition.ts` — node hierarchy.
- `src/engine/AI/Blackboard.ts` — shared key/value store.
- `src/engine/AI/MLInterface.ts` — neural network / KNN / decision tree / SVM.
- Reynolds, C. *Steering Behaviors For Autonomous Characters* (1999).
- Recast & Detour navigation mesh toolkit — pipeline reference.
- Millington, I. *AI for Games* (3rd ed.) — behavior tree patterns.
