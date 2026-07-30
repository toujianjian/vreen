# Events Module

> Path: `src/engine/Events/`
>
> The typed event subsystem of the `@vreen/engine` kernel. Provides a
> classic synchronous topic-based `EventBus` (subscribe / unsubscribe /
> emit), a buffered `EventQueue` for frame-safe deferred dispatch, and a
> discriminated-union `GameEvent` hierarchy
> (`CollisionEvent` / `TriggerEvent` / `SpawnEvent` / `DestroyEvent` /
> `ScoreEvent` / `CustomEvent`) carrying strongly-typed payloads. The
> module is ECS-free — entity IDs are `number` aliases, so it can be
> reused on the server / simulator side without pulling in `World`.

---

## Overview

```
                  ┌───────────────  synchronous dispatch  ───────────────┐
                  │                                                   │
                  ▼                                                   │
           EventBus.emit(event, ...args) ────→ listeners (Set, ordered)
                  ▲                                                   │
                  │ on / once / off                                   │
                  │                                                   │
                  │             ┌─────────────────────────────────────┘
                  │             │
                  │             │  deferred dispatch (frame-safe)
                  │             │
       EventQueue.enqueue(GameEvent) ──── FIFO buffer ──── dispatch() ─── bus.emit(ev.type, ev)
                  │                                              │
                  │ flush()                                       │
                  ▼                                              ▼
              discarded                                    listeners fired


  GameEvent<T>  (immutable POJO: type + timestamp + data)
       │
       ├── CollisionEvent  (CollisionEventData)   type = 'collision'
       ├── TriggerEvent    (TriggerEventData)     type = 'trigger'
       ├── SpawnEvent      (SpawnEventData)       type = 'spawn'
       ├── DestroyEvent    (DestroyEventData)     type = 'destroy'
       ├── ScoreEvent      (ScoreEventData)       type = 'score'
       └── CustomEvent     (CustomEventData)      type = 'custom'

  GameEventType  ── const string map for type-safe emit / on keys
```

Two dispatch models coexist by design: synchronous `EventBus.emit` for
immediate notification (UI refresh, state mutation that must complete
before the next line of code), and `EventQueue` for deferred dispatch
when callers must not run inside the originating call stack (collision
response that spawns / destroys entities, which would otherwise mutate
the very list being iterated by the physics system).

---

## Core Classes

### `EventBus` (`EventBus.ts`)

| Export | Role |
|--------|------|
| `EventBus` | Topic-based pub/sub. Backed by `Map<string, Set<EventListener>>`. `on` returns an unsubscribe function; `off` is also available by callback reference. `emit` is synchronous and returns the count of listeners actually invoked. |
| `EventListener` | `(...args: any[]) => void`. Variadic to keep the bus format-agnostic; typed wrappers are the caller's responsibility. |

```ts
class EventBus {
  on(event: string, callback: EventListener): () => void;     // returns unsubscribe
  off(event: string, callback: EventListener): boolean;       // true if removed
  once(event: string, callback: EventListener): () => void;   // auto-unsubscribes
  emit(event: string, ...args: any[]): number;                // listeners invoked
  clear(): void;                                              // all events
  clearEvent(event: string): boolean;                         // one event
  listenerCount(event: string): number;                       // debug / test
  eventNames(): string[];                                     // snapshot
}
```

`emit` snapshots the listener set before iterating so callbacks can
safely `on` / `off` mid-dispatch. Listeners removed during iteration are
skipped; newly added listeners are not invoked until the next `emit`.

`once` wraps the callback so it removes itself *before* invoking the
user code — this prevents re-entrant `emit` of the same event from
double-firing.

### `EventQueue` (`EventQueue.ts`)

| Export | Role |
|--------|------|
| `EventQueue` | Buffered FIFO of `GameEvent`s. Constructed with an `EventBus`. `enqueue(event)` queues without dispatching; `dispatch()` snapshots the queue, emits each event via `bus.emit(ev.type, ev)`, and returns the count. `flush()` drops the queue without dispatching. |

```ts
class EventQueue {
  readonly bus: EventBus;
  constructor(bus: EventBus);
  enqueue(event: GameEvent): void;
  dispatch(): number;        // emits all queued events, returns count
  flush(): number;           // discards queued events, returns count
  size(): number;
  isEmpty(): boolean;
  peek(): GameEvent | undefined;
}
```

`dispatch` takes a snapshot of the current queue before iterating, so
events enqueued by listeners during dispatch are *not* emitted in the
same pass — they wait for the next `dispatch()` call. This prevents
infinite loops when a listener enqueues a follow-up event.

### `GameEvent` hierarchy (`GameEvent.ts`)

| Export | Role |
|--------|------|
| `GameEvent<T>` | Immutable base class. `readonly type: string`, `readonly timestamp: number` (ms since epoch, defaults to `Date.now()`), `readonly data: T`. `toString()` for debug. Direct construction (`new GameEvent('foo', payload)`) is valid for ad-hoc events. |
| `CollisionEvent` | `type = 'collision'`, `data: CollisionEventData`. |
| `TriggerEvent` | `type = 'trigger'`, `data: TriggerEventData`. |
| `SpawnEvent` | `type = 'spawn'`, `data: SpawnEventData`. |
| `DestroyEvent` | `type = 'destroy'`, `data: DestroyEventData`. |
| `ScoreEvent` | `type = 'score'`, `data: ScoreEventData`. |
| `CustomEvent` | `type = 'custom'`, `data: CustomEventData`. The semantic name lives in `data.name`. |
| `GameEventType` | Const object mapping (`{ Collision: 'collision', ... }`) plus a string-literal union type of the same name. |

#### Payload shapes

```ts
interface CollisionEventData {
  selfId: number;
  otherId: number;
  normal: [number, number, number];   // unit vector, other → self
  depth: number;                       // penetration in metres
  point: [number, number, number];     // world-space contact
}

interface TriggerEventData {
  selfId: number;
  otherId: number;
  phase: 'enter' | 'exit' | 'stay';
}

interface SpawnEventData {
  entityId: number;
  source?: string;                     // prefab / generator name
  position?: [number, number, number];
}

interface DestroyEventData {
  entityId: number;
  reason?: string;                     // 'killed' | 'lifetime' | 'manual' | ...
}

interface ScoreEventData {
  entityId: number;                    // 0 = global
  delta: number;
  total: number;
}

interface CustomEventData {
  name: string;                        // semantic event name
  payload: unknown;                    // caller-defined
}
```

The `entityId` / `selfId` / `otherId` fields are `number` aliases of the
ECS `EntityId` type — kept as `number` here so the Events module has
zero ECS dependency and can be reused on a server / simulator that does
not ship the `World` class.

---

## Usage Example

### Synchronous pub/sub

```ts
import { EventBus } from '@vreen/engine/events';

const bus = new EventBus();

const unsub = bus.on('player:damaged', (amount: number, from: number) => {
  hp -= amount;
  flashDamageVfx();
});

bus.emit('player:damaged', 25, entityId);
unsub();                                // or bus.off('player:damaged', fn)
```

### One-shot listener

```ts
bus.once('scene:loaded', (sceneId: string) => {
  hideLoadingScreen(sceneId);
});
```

### Deferred dispatch with `EventQueue`

```ts
import { EventBus, EventQueue, CollisionEvent, SpawnEvent } from '@vreen/engine/events';

const bus = new EventBus();
const queue = new EventQueue(bus);

// Physics system registers a listener that spawns debris — but it must
// not mutate the entity list while the physics step is iterating it.
bus.on('collision', (ev: CollisionEvent) => {
  if (ev.data.depth > 0.5) {
    queue.enqueue(new SpawnEvent({
      entityId: allocateEntityId(),
      source: 'debris-spawner',
      position: ev.data.point,
    }));
  }
});

// In the main loop:
function frame() {
  physicsStep();          // may enqueue collision → spawn events
  queue.dispatch();       // now safe: physics step is done, spawn listeners run
}
```

### Typed custom events

```ts
import { CustomEvent, GameEventType } from '@vreen/engine/events';

bus.on(GameEventType.Custom, (ev: CustomEvent) => {
  if (ev.data.name === 'dialogue:advance') {
    advanceDialogue(ev.data.payload as DialogueChoice);
  }
});

queue.enqueue(new CustomEvent({
  name: 'dialogue:advance',
  payload: { optionIndex: 2 },
}));
```

### Debugging the bus

```ts
console.log(bus.eventNames());         // ['collision', 'player:damaged', ...]
console.log(bus.listenerCount('collision'));  // 3
bus.clearEvent('player:damaged');      // remove all listeners for one event
bus.clear();                           // remove everything
```

---

## Invariants

- **Synchronous emit.** `EventBus.emit` invokes all listeners before
  returning. There is no microtask deferral; if you need deferral, use
  `EventQueue`.
- **Insertion-order dispatch.** Listeners for a given event fire in the
  order they were registered with `on` / `once`.
- **Set deduplication.** Registering the same `(event, callback)` pair
  twice via `on` does not double-fire — the underlying `Set` collapses
  duplicates.
- **Re-entrancy safety.** `emit` snapshots the listener set; `off`
  during dispatch takes effect immediately (the removed listener is
  skipped if not yet invoked), but `on` during dispatch does not invoke
  the new listener until the next `emit`.
- **`once` removes before invoking.** A `once` listener that emits the
  same event from inside its callback is not re-invoked.
- **No exception isolation.** A listener that throws propagates out of
  `emit`, aborting the dispatch to subsequent listeners. Wrap listener
  bodies in `try / catch` if isolation is required.
- **`dispatch` is non-recursive.** Events enqueued by listeners during
  `dispatch()` are not emitted in the same pass — they wait for the next
  `dispatch()` call.
- **`dispatch` clears the queue.** After `dispatch()` returns, the queue
  is empty (for the snapshot it processed); after `flush()` returns, the
  queue is empty and the events are gone.
- **Immutability.** `GameEvent.type` / `.timestamp` / `.data` are
  `readonly`. Subclass constructors fix `type`; callers should treat
  events as value objects.
- **ECS-free.** The module imports nothing from `ECS/`. Entity IDs are
  `number`; the `Events` module can run on a server or in a headless
  test harness without a `World` instance.

---

## Design Notes

**Why synchronous by default?** Most game events (UI refresh, audio
trigger, score update) need to take effect before the next line of game
logic runs. Synchronous dispatch makes cause and effect obvious and
matches the mental model of `if (hp <= 0) bus.emit('destroy', ...)`.
Deferred dispatch is opt-in via `EventQueue`, used specifically when
running a listener would mutate a structure currently being iterated
(e.g. spawning / destroying entities mid-physics-step).

**Why a `GameEvent` hierarchy instead of plain objects?** A
discriminated-union class hierarchy gives TypeScript narrowing for free
(`if (ev instanceof CollisionEvent)` narrows `ev.data` to
`CollisionEventData`), keeps the event-name strings in one place via
`GameEventType`, and makes the payload shapes self-documenting. Plain
objects with stringly-typed `type` fields would lose all three.

**Why `EventQueue` instead of `setImmediate` / `queueMicrotask`?**
Microtask-based deferral interleaves with the rest of the frame
unpredictably — a microtask can run before the current synchronous code
finishes, or between two awaits in unrelated code. `EventQueue.dispatch`
runs at a well-defined point in the main loop (typically after all
systems have ticked), giving deterministic ordering for spawn / destroy
cascades. This is the same reason Unity's `FixedUpdate` deferred
instantiation and Unreal's `DeferredSpawn` exist.

**Why no exception isolation?** Isolating listener exceptions inside
`emit` (try / catch around each listener, log and continue) is the
browser-DOM `dispatchEvent` model. It is safer but hides bugs: a
listener that silently swallows state corruption produces
hard-to-trace downstream failures. The VREEN engine prefers fail-loud
in dev — listeners must self-isolate with `try / catch` if they need
to. Production builds can wrap the bus in a try / catch decorator.

**Why `entityId: number` instead of `EntityId`?** Importing the `EntityId`
brand from `ECS/` would create a module dependency that prevents
reusing `Events/` on the server side (where `World` is absent). Using
bare `number` keeps the module standalone while remaining
structurally compatible with `EntityId` (which is itself a `number`
brand).

---

## References

- DOM `EventTarget` — https://developer.mozilla.org/en-US/docs/Web/API/EventTarget
- Node `EventEmitter` — https://nodejs.org/api/events.html
- Unity `EventSystem` — https://docs.unity3d.com/Manual/EventSystem.html
- `ECS/` module — `World`, `EntityId` (numeric alias)
- `Scripting/` module — `ScriptSystem` dispatches collision / trigger events to `ScriptComponent` instances
- `Physics/` module — `CollisionSystem` enqueues `CollisionEvent`s during the narrowphase
