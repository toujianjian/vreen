# Scripting Module

> Path: `src/engine/Scripting/`
>
> The code-driven scripting subsystem of the `@vreen/engine` kernel.
> Provides a Unity-MonoBehaviour-flavored ECS script component with
> lifecycle hooks (`onStart` / `onUpdate` / `onCollision` / `onTrigger` /
> `onDestroy`), the system that drives it each frame, a name-keyed
> script registry for instance creation, a generator-based coroutine
> scheduler, a unified API binding layer that exposes the engine core to
> script runtimes (Blockly / VisualScriptComponent / embedded JS), and a
> Script-Canvas-style visual scripting component with a node graph and
> exec-pin execution model.

---

## Overview

```
                  ┌──────────────────────────────────────────────┐
                  │           Code-driven scripts                │
                  │                                              │
   scriptRegistry │ ScriptFactory ──register──► ScriptRegistry   │
        (global)  │                                │             │
                  │                                ▼ create(name) │
                  │                          ScriptInstance       │
                  │                                │             │
                  │                                ▼ wrapped in   │
                  │                          ScriptComponent      │
                  │                                │             │
                  │                                ▼ ticked by    │
                  │                          ScriptSystem         │
                  │                          (ECS System, prio 300) │
                  └──────────────────────────────────────────────┘

                  ┌──────────────────────────────────────────────┐
                  │           Data-driven scripts                │
                  │                                              │
                  │ VisualScriptComponent                        │
                  │   scriptGraph: ScriptNode[]                  │
                  │   variables / functions / eventHandlers      │
                  │   start() / update(dt) / stop() / handleEvent │
                  │     └─ _executeChain (exec-pin propagation)  │
                  └──────────────────────────────────────────────┘

                  ┌──────────────────────────────────────────────┐
                  │           Concurrency & API surface          │
                  │                                              │
                  │ CoroutineSystem                              │
                  │   start(Generator) ──► CoroutineHandle        │
                  │   update(dt): wait -= dt; generator.next()    │
                  │                                              │
                  │ ScriptBindings                               │
                  │   registerFunction / registerProperty /      │
                  │   registerClass / registerEnum               │
                  │   initialize(world): Math/Scene/Physics/...  │
                  └──────────────────────────────────────────────┘
```

The code-driven and data-driven paths are complementary: code scripts
(`ScriptComponent`) handle complex per-entity logic via the
`ScriptInstance` interface; visual scripts
(`VisualScriptComponent`) handle designer-authored node graphs that can
be serialized into `.vreen` packages. Both ultimately operate on the
same ECS `World`. `CoroutineSystem` and `ScriptBindings` are shared
utilities used by both paths and by external script hosts (Blockly).

---

## Core Classes

### Code-Driven Scripts

| Export | Role |
|--------|------|
| `ScriptComponent` | ECS component holding a `ScriptInstance` + `enabled` flag + internal `started` flag. |
| `ScriptC` | `ComponentType<ScriptComponent>` singleton (the component-type token used by `World`). |
| `SCRIPT_COMPONENT_NAME` | String constant `'Script'`. |
| `ScriptInstance` | User-implemented interface; all callbacks optional. |
| `ScriptContext` | `{ world: World; entityId: EntityId }` passed to every callback. |
| `ScriptSystem` | ECS `System` (priority 300) that ticks `ScriptComponent`s and dispatches collision/trigger events. |
| `CollisionInfo` / `TriggerInfo` | Payload shapes for `onCollision` / `onTrigger`. |
| `CollisionDispatch` / `TriggerDispatch` | Aliases for the dispatch parameter types. |

```ts
export interface ScriptInstance {
  onStart?(ctx: ScriptContext): void;
  onUpdate?(ctx: ScriptContext, dt: number): void;
  onDestroy?(ctx: ScriptContext): void;
  onCollision?(ctx: ScriptContext, info: CollisionEventData): void;
  onTrigger?(ctx: ScriptContext, info: TriggerEventData): void;
}

export interface CollisionInfo {
  selfId: EntityId;
  otherId: EntityId;
  normal: [number, number, number];   // from other → self
  depth: number;                       // penetration in meters
  point: [number, number, number];     // world-space contact
}

export interface TriggerInfo {
  selfId: EntityId;
  otherId: EntityId;
  phase: 'enter' | 'exit' | 'stay';
}
```

Lifecycle ordering (driven by `ScriptSystem`):
1. `onStart(ctx)` — called once, before the first `onUpdate`. The
   `started` flag deduplicates so re-enabling a script does not re-fire
   `onStart`.
2. `onUpdate(ctx, dt)` — called every frame while `enabled === true`.
3. `onCollision(ctx, info)` / `onTrigger(ctx, info)` — dispatched by
   the physics system via `ScriptSystem.dispatchCollision` /
   `dispatchTrigger`. Only fires for `enabled` scripts.
4. `onDestroy(ctx)` — called once when `ScriptSystem.destroyScripts` is
   invoked (typically by `World.destroyEntity`).

`ScriptSystem` runs at priority `300` so it executes after physics and
animation systems — scripts observe the frame's final state. All
callbacks are wrapped in `try/catch`: a thrown error is logged via
`createLogger('Scripting.ScriptSystem')` but does not abort the system
loop or other scripts.

### Script Registry

| Export | Role |
|--------|------|
| `ScriptRegistry` | Name → `ScriptFactory` map. `register` / `create` / `has` / `getRegistered` / `unregister` / `clear` / `size`. |
| `scriptRegistry` | Process-level singleton instance. |
| `ScriptFactory` | `() => ScriptInstance` — no-arg factory returning a fresh script instance. |

```ts
export type ScriptFactory = () => ScriptInstance;
```

`register(name, factory)` returns whether it overwrote an existing
entry. `create(name)` returns `undefined` for unknown names (no throw) —
callers decide whether to skip the entity or fail loudly. The singleton
matches the pattern of `ComponentTypeRegistry` and the asset registries;
independent `new ScriptRegistry()` instances are supported for multi-`World`
setups that need isolated namespaces.

### Coroutines

| Export | Role |
|--------|------|
| `CoroutineSystem` | Generator-based cooperative scheduler. |
| `CoroutineHandle` | Opaque handle: `id`, `done`, `wait`. Returned by `start`, accepted by `stop`. |
| `CoroutineYield` | `number \| void \| undefined` — `number > 0` waits that many seconds; otherwise waits one frame. |

```ts
export interface CoroutineHandle {
  id: number;
  generator: Generator<CoroutineYield, void, unknown>;
  done: boolean;
  wait: number;                       // seconds until next resume
}
```

`CoroutineSystem` semantics:
- `start(generator)` enqueues a new coroutine. The first `generator.next()`
  happens on the next `update(dt)` call (predictable timing — no
  immediate execution).
- `update(dt)` decrements `wait` for each coroutine; when `wait ≤ 0` it
  calls `generator.next()`. If `result.done === true`, the coroutine is
  marked `done`. Otherwise the yielded value sets the next `wait`:
  `number > 0` → that many seconds; `undefined`/`void` → `0` (resume
  next frame).
- Each coroutine is advanced at most once per `update` call — long `dt`
  spikes do not cascade.
- `stop(handle)` calls `generator.return(undefined)` so `finally` blocks
  run, then removes the handle. Returns `false` for already-done or
  unknown handles.
- A throwing generator is logged and marked `done` without aborting
  other coroutines.
- `clear()` terminates all active coroutines via `generator.return`.

### Script Bindings

| Export | Role |
|--------|------|
| `ScriptBindings` | Unified API surface registry: name → `ScriptBinding` (`function` / `property` / `class` / `enum`). |
| `getDefaultScriptBindings` | Returns the process-level singleton `ScriptBindings` (lazy-init). |
| `resetDefaultScriptBindings` | Clears and nulls the singleton (test isolation). |
| `ScriptBinding` | `{ name, description, type, value, category }`. |
| `ScriptBindingType` | `'function' \| 'property' \| 'class' \| 'enum'`. |
| `ScriptAPIInfo` / `ScriptAPIDocCategory` / `ScriptAPIDocumentation` | Auto-complete / API-doc metadata. |
| `ScriptBindingsStats` | Aggregate counts by type / category. |

```ts
export interface ScriptBinding {
  name: string;
  description: string;
  type: ScriptBindingType;
  value: any;            // function | property value | constructor | enum map
  category: string;      // "Math" / "Scene" / "Physics" / "Audio" / "Input" / "Rendering"
}
```

`ScriptBindings.initialize(world?)` is idempotent (`isInitialized` flag)
and registers the engine's core API across six categories:

| Category | Contents |
|----------|----------|
| `Math` | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Color`, `Box3`, `Sphere`, `Plane`, `Ray`, `MathUtils`, plus `clamp` / `lerp` / `radToDeg` / `degToRad`. |
| `Scene` | `createEntity`, `destroyEntity`, `isAlive`, `getEntityName`, `setEntityName`, `entityCount`, `getSceneNode`, `listEntities`. Requires `initialize(world)`. |
| `Physics` | `applyForce` (placeholder), plus component access via `Scene` API. |
| `Audio` | Audio playback helpers (delegated to `Audio/` module). |
| `Input` | Input query helpers (delegated to `Input/` module). |
| `Rendering` | Renderer / scene-tree helpers (delegated to `Renderer/` module). |

Custom registrations: `registerFunction(name, fn, category, description)`,
`registerProperty`, `registerClass`, `registerEnum` — all return whether
they overwrote an existing binding. `call(name, args)` invokes
`function` bindings and returns `undefined` for missing or non-function
names (with a logged warning). `getBindingsByCategory` and
`getCategories` support documentation generation and IDE auto-complete.

### Visual Scripting

| Export | Role |
|--------|------|
| `VisualScriptComponent` | Script-Canvas-style node-graph component with exec-pin execution. |
| `ScriptNode` | Single graph node: `id`, `type`, `name`, `inputs[]`, `outputs[]`, `data?`. |
| `ScriptNodeType` | `'event' \| 'action' \| 'condition' \| 'variable' \| 'function'`. |
| `ScriptPin` | Node input/output pin: `name`, `type`, `value`, `connectedTo[]`. |
| `ScriptPinConnection` | `{ nodeId, pinName }` — target of an output pin. |
| `ScriptGraphJSON` | Serializable graph snapshot: `nodes`, `variables`, `eventHandlers`. |

```ts
export interface ScriptNode {
  id: string;
  type: ScriptNodeType;
  name: string;            // event name | function name | variable name | action id
  inputs: ScriptPin[];
  outputs: ScriptPin[];
  data?: any;              // condition value, variable mode ('get'|'set'), handler, ...
}
```

`VisualScriptComponent` execution model:
- `start()` sets `isRunning = true` and fires the `'start'` event.
- `update(dt)` fires `'update'` and `'tick'` events with `dt` as the
  event arg.
- `stop()` fires the `'stop'` event then sets `isRunning = false`.
- `handleEvent(name, args)` looks up `eventHandlers.get(name)` (auto-built
  from `event` nodes), and for each matching event node runs
  `_executeChain(node, args)`.
- `_executeChain` walks the exec-pin chain starting at the event node,
  with a `visited` set to prevent infinite loops. For each node it
  calls `_executeNode`, then picks the next pin: `'exec'` for ordinary
  nodes, `'true'` / `'false'` for `condition` nodes (based on the
  evaluated input value).
- `_executeNode` dispatches by `type`: `event` writes args to its first
  output pin; `function` calls `functions.get(node.name)` with resolved
  input pin values; `variable` reads or writes `variables.get(node.name)`
  based on `data.mode`; `condition` evaluates its input and stores the
  branch in `data._branch`; `action` calls `data.handler(component, args)`
  if provided.
- `_resolvePinValue` walks all nodes' output pins to find one connected
  to the requested input pin; falls back to the pin's static `value`.

`exportGraph()` returns a `ScriptGraphJSON` (deep-cloned nodes +
variable/eventHandler entries). `importGraph(json)` replaces the current
graph; `functions` are runtime-only and must be re-registered with
`registerFunction` after import.

---

## Usage

### Code-driven script via registry

```ts
import {
  ScriptC, ScriptSystem, scriptRegistry, type ScriptContext,
} from '@vreen/engine/scripting';
import { World } from '@vreen/engine/ecs';

// 1. Define a script as an object literal implementing ScriptInstance
scriptRegistry.register('Spinner', () => {
  let speed = 1.0;
  return {
    onStart(ctx: ScriptContext) {
      console.log('Spinner attached to', ctx.entityId);
    },
    onUpdate(ctx: ScriptContext, dt: number) {
      const node = ctx.world.getSceneNode(ctx.entityId);
      if (node) node.rotation.y += speed * dt;
    },
    onDestroy(ctx: ScriptContext) {
      console.log('Spinner removed from', ctx.entityId);
    },
  };
});

// 2. Register the system + attach the script to an entity
const world = new World();
world.registerSystem(new ScriptSystem());

const eid = world.createEntity('spinner');
const instance = scriptRegistry.create('Spinner')!;
world.addComponent(eid, ScriptC, new ScriptComponent(instance));

// 3. Each frame: world.update(dt) → ScriptSystem ticks all ScriptC
```

### Collision / trigger dispatch

```ts
import { ScriptSystem, type CollisionInfo, type TriggerInfo } from '@vreen/engine/scripting';

// Physics system detects a collision; forward to scripts:
const scriptSys = world.getSystem(ScriptSystem)!;
const info: CollisionInfo = {
  selfId: eid, otherId: otherEid,
  normal: [0, 1, 0], depth: 0.05, point: [10, 2, 5],
};
scriptSys.dispatchCollision(world, info);

// Trigger volume:
const trig: TriggerInfo = {
  selfId: eid, otherId: playerEid, phase: 'enter',
};
scriptSys.dispatchTrigger(world, trig);

// The script's onCollision / onTrigger is invoked if it defines them.
```

### Coroutine-driven cutscene

```ts
import { CoroutineSystem } from '@vreen/engine/scripting';

const coroutines = new CoroutineSystem();

function* introCutscene() {
  fadeToBlack(0.5);
  yield 0.5;                       // wait half a second
  showText('Chapter 1');
  yield 2.0;                       // let player read
  hideText();
  fadeFromBlack(0.5);
  yield 0.5;
}

const handle = coroutines.start(introCutscene());

function frame(dt: number) {
  coroutines.update(dt);
  if (handle.done) console.log('cutscene finished');
}

// Skip:
// coroutines.stop(handle);
```

### Script bindings for Blockly / embedded JS

```ts
import {
  ScriptBindings, getDefaultScriptBindings,
} from '@vreen/engine/scripting';

const bindings = getDefaultScriptBindings();
bindings.initialize(world);            // registers Math/Scene/Physics/...

// Custom function exposed to scripts:
bindings.registerFunction(
  'spawnExplosion',
  (x: number, y: number, z: number, radius: number) => {
    world.getComponent(world.createEntity('explosion'), EffectsC)
      ?.configure(x, y, z, radius);
  },
  'Scene',
  'Spawn an explosion effect at (x, y, z) with the given radius.',
);

// From a Blockly workspace or embedded JS:
bindings.call('spawnExplosion', [10, 2, 5, 3]);

// Inspect the API surface (for auto-complete UI):
const mathBindings = bindings.getBindingsByCategory('Math');
const stats = {
  total: 0,
  byType: { function: 0, property: 0, class: 0, enum: 0 },
  categoryCount: 0,
  byCategory: {},
  isInitialized: true,
} satisfies ScriptBindingsStats;
```

### Visual scripting node graph

```ts
import { VisualScriptComponent, type ScriptNode } from '@vreen/engine/scripting';

const vs = new VisualScriptComponent();

// event node: "On update" → calls function "logDt" with dt
vs.addNode({
  id: 'onUpdate', type: 'event', name: 'update',
  inputs: [],
  outputs: [{ name: 'exec', type: 'exec', value: null, connectedTo: [] }],
});
vs.addNode({
  id: 'logNode', type: 'function', name: 'logDt',
  inputs: [
    { name: 'exec',  type: 'exec',   value: null, connectedTo: [] },
    { name: 'value', type: 'number', value: 0,    connectedTo: [] },
  ],
  outputs: [
    { name: 'exec', type: 'exec', value: null, connectedTo: [] },
  ],
});
vs.connect('onUpdate', 'exec', 'logNode', 'exec');

vs.registerFunction('logDt', (dt: number) => console.log('dt =', dt));

vs.start();
vs.update(0.016);    // fires 'update' → logDt(0.016)
vs.stop();

// Save / restore:
const json = vs.exportGraph();
const vs2 = new VisualScriptComponent();
vs2.importGraph(json);
vs2.registerFunction('logDt', (dt: number) => console.log('restored:', dt));
```

---

## Invariants

- `ScriptComponent` is a *non-POJO* component — it holds a runtime
  `ScriptInstance` reference and is **not** serialized into `.vreen`
  packages (same category as `MeshRef` / `AnimState`).
- `ScriptSystem.update` is a no-op for `enabled === false` scripts; if
  `onStart` already ran, re-enabling does not call it again.
- `ScriptSystem.dispatchCollision` / `dispatchTrigger` are no-ops when
  the target entity has no `ScriptC`, has `enabled === false`, or the
  script does not define the corresponding callback.
- `ScriptRegistry.create(name)` returns `undefined` for unknown names —
  it never throws. Callers decide error policy.
- `CoroutineSystem.start` does not execute the generator immediately;
  the first `next()` happens on the next `update(dt)`.
- A coroutine's `wait` is in seconds; `yield 0` or `yield undefined`
  means "resume next frame". Negative or `NaN` yields are treated as
  "next frame".
- `CoroutineSystem.stop` calls `generator.return(undefined)` so `try/finally`
  blocks execute. The handle is marked `done` and removed from the
  active list.
- `ScriptBindings.initialize` is idempotent. Calling it twice is a
  no-op (debug-logged).
- `ScriptBindings.call` on a missing name or a non-`function` binding
  returns `undefined` and logs a warning — it never throws.
- `VisualScriptComponent._executeChain` maintains a `visited` set per
  event dispatch; cycles in the exec-pin graph are broken rather than
  infinitely looped.
- `VisualScriptComponent` event handler lookup is name-based: multiple
  `event` nodes with the same `name` all fire on `handleEvent(name, ...)`.
- `exportGraph` deep-clones pins and their `connectedTo` arrays; the
  returned JSON can be mutated without affecting the live graph.

---

## Design Notes

**Why interface, not base class?** `ScriptInstance` is an interface —
scripts can be object literals, classes, or factory-returned closures.
This avoids forcing `extends` and makes hot-reload (replace the
`ScriptComponent.script` reference) trivial. It also means scripts have
no hidden state from a base class: everything they need is in
`ScriptContext` (world + entityId) or their own closure.

**Why priority 300?** Physics (`~100`), animation (`~200`), and other
simulation systems run first; `ScriptSystem` at `300` reads the frame's
final state and writes commands that take effect next frame. This avoids
mid-frame ordering hazards (e.g., a script reading a collider position
before the physics step).

**Why generator-based coroutines?** ES generators are native,debuggable
in DevTools, and support `try/finally` for cleanup. A `Promise`-based
approach would require `async/await` (which has microtask ordering
hazards on the main loop) and wouldn't support per-frame `yield` cleanly.
The current model is the standard Unity-style "yield null = next frame,
yield number = N seconds" semantics.

**Why `ScriptBindings` is separate from `ScriptRegistry`.** They are
orthogonal: `ScriptRegistry` maps *script names* to *instance factories*
(behavior); `ScriptBindings` maps *API names* to *functions / classes /
enums* (capability). A script factory can use `ScriptBindings.call(...)`
internally, and a Blockly workspace can call `ScriptBindings` directly
without ever going through `ScriptRegistry`. Keeping them split lets
each have a focused API surface and serialization story.

**Why visual scripting on top of code scripting.** Code scripts are
powerful but opaque to designers. `VisualScriptComponent` exposes the
same ECS `World` through a node graph that can be edited visually
(Blockly or a future node editor), serialized into `.vreen`, and
hot-reloaded without a JS bundle. The exec-pin model mirrors
o3de's Script Canvas and Unreal's Blueprint, which designers are
already familiar with.

**Why the visited-set cycle guard.** A misconfigured graph (event A →
action B → event A) would otherwise lock the main loop. The
per-dispatch `visited` set breaks the cycle at the first re-visit,
which is the standard mitigation in node-graph runtimes. Designers see
"node X was skipped" in the log rather than a hung browser tab.

---

## References

- `src/engine/Scripting/ScriptComponent.ts` — `ScriptComponent`, `ScriptC`,
  `ScriptInstance`, `ScriptContext`, `VisualScriptComponent`.
- `src/engine/Scripting/ScriptSystem.ts` — ECS driver + collision/trigger dispatch.
- `src/engine/Scripting/ScriptRegistry.ts` — name → factory registry + singleton.
- `src/engine/Scripting/Coroutine.ts` — generator-based coroutine scheduler.
- `src/engine/Scripting/ScriptBindings.ts` — engine API surface registry.
- `src/engine/ECS/World.ts` — `World`, `EntityId`, `System`, `ComponentType`.
- `src/engine/Events/GameEvent.ts` — `CollisionEventData`, `TriggerEventData`
  shapes consumed by `onCollision` / `onTrigger`.
- `src/lib/vreenBlockly.ts` — Blockly block definitions that consume
  `ScriptBindings`.
- o3de Gems/ScriptCanvas — design reference for `VisualScriptComponent`.
- Unity MonoBehaviour — design reference for `ScriptInstance` lifecycle.
