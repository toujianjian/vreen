# `@vreen/engine` — Concurrency

> Path: `src/engine/Concurrency/`
>
> Parallel task scheduling infrastructure: a Promise-based Worker pool with
> configurable concurrency limits, FIFO queueing, transferable objects, and
> graceful main-thread fallback for headless / test environments.

---

## Overview

```
                       ┌────────────────────────────────────┐
                       │            WorkerPool              │
                       └────────────────────────────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
     ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
     │ Worker Slots │        │  Task Queue  │        │  Main-Thread │
     │  (active)    │        │   (FIFO)     │        │   Fallback   │
     │              │        │              │        │              │
     │ worker 0     │        │ task n+1     │        │ handler(data)│
     │ worker 1     │        │ task n+2     │        │ → sync/async │
     │ ...worker N  │        │ ...          │        │              │
     │ (limit ≤ N)  │        │ (queueMax)   │        │ (no creator) │
     └──────────────┘        └──────────────┘        └──────────────┘
            │                        │                        │
            ▼                        ▼                        ▼
     postMessage(data,            shift on idle           resolve(data)
     transfer)                    worker                   / reject(err)
            │                        │                        │
            └────────────────────────┴────────────────────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   runTask Promise   │
                          │  resolve / reject   │
                          └─────────────────────┘
```

The `WorkerPool` adapts three.js's `examples/jsm/utils/WorkerPool.js` into a
TypeScript-first, Promise-based API. It manages a pool of Web Workers (or any
`WorkerLike` implementation), distributes tasks across them with FIFO ordering,
and supports zero-copy transfer of `Transferable` objects (e.g. `ArrayBuffer`).

When no `workerCreator` is configured, the pool falls back to running tasks
synchronously (or asynchronously, if the handler returns a Promise) on the
main thread via a user-supplied `mainThreadHandler`. This enables identical
code paths in browser (multi-threaded) and Node / headless test (single-
threaded) environments.

---

## Files

| File                  | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| [`WorkerPool.ts`](./WorkerPool.ts)         | Worker pool implementation: queue, dispatch, reuse, recycle, dispose. |
| [`WorkerPool.test.ts`](./WorkerPool.test.ts)     | 29 unit tests covering construction, dispatch, reuse, errors, batch, drain, dispose. |
| [`index.ts`](./index.ts)               | Barrel export.                                                       |

---

## API

### `WorkerPool`

```typescript
class WorkerPool {
  constructor(opts?: WorkerPoolOptions);
  // ── Config (chainable) ──
  setWorkerCreator(creator: WorkerCreator): this;
  setWorkerLimit(limit: number): this;
  setQueueMax(max: number): this;
  setMainThreadHandler(handler: (data: unknown) => unknown): this;
  // ── Status ──
  get workerCount(): number;       // active workers (including idle)
  get idleWorkerCount(): number;   // workers with no current task
  get queueLength(): number;       // pending tasks
  get disposed(): boolean;
  // ── Execution ──
  runTask(data: unknown, transfer?: Transferable[]): Promise<unknown>;
  runTasks(items: Array<{ data: unknown; transfer?: Transferable[] }>): Promise<unknown[]>;
  drain(): Promise<void>;           // wait for all tasks, then terminate workers
  dispose(): void;                  // reject all pending, terminate all workers
}
```

### Types

| Type                | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `WorkerLike`        | Minimal worker interface: `postMessage`, `onmessage`, `onerror`, `terminate`. |
| `WorkerCreator`     | `() => WorkerLike` — factory called lazily to spawn new workers.       |
| `WorkerPoolOptions` | `{ workerCreator?, workerLimit?, queueMax?, mainThreadHandler? }`.     |

---

## Usage

### Basic: multi-threaded task dispatch

```typescript
import { WorkerPool } from '@vreen/engine';

const pool = new WorkerPool({
  workerCreator: () => new Worker(new URL('./decoder.worker.ts', import.meta.url)),
  workerLimit: 4,
});

// Dispatch a task — returns a Promise that resolves with worker's reply.
const result = await pool.runTask({ type: 'decode', buffer });

// Zero-copy transfer of large buffers:
const large = new ArrayBuffer(1024 * 1024);
const hash = await pool.runTask({ data: large }, [large]);

await pool.dispose();
```

### Batch: run many tasks, await all

```typescript
const results = await pool.runTasks([
  { data: { id: 0 } },
  { data: { id: 1 } },
  { data: { id: 2 }, transfer: [buffer] },
]);
// results is unknown[] in completion order (Promise.all semantics)
```

### Main-thread fallback (headless / test)

```typescript
const pool = new WorkerPool({
  mainThreadHandler: (data) => expensiveSyncComputation(data),
});
// No Web Worker needed — runs on main thread, identical API.
const result = await pool.runTask({ x: 1, y: 2 });
```

### Drain: wait for completion and recycle workers

```typescript
// Queue many tasks...
for (let i = 0; i < 100; i++) pool.runTask({ i });
// Wait for all to finish, then terminate all workers (pool still usable).
await pool.drain();
```

---

## Dispatch Logic

```
runTask(data, transfer)
  │
  ├─ disposed? ──────────────────────────────► reject("disposed")
  │
  ├─ no creator?
  │   ├─ has mainThreadHandler? ─────────────► resolve(handler(data))
  │   └─ else ───────────────────────────────► reject("no creator/handler")
  │
  ├─ queueMax exceeded? ─────────────────────► reject("queue overflow")
  │
  └─ create Promise(task)
      │
      ├─ idle worker exists? ──► dispatch(task) to idle worker
      ├─ workers < limit? ─────► create worker, dispatch(task)
      └─ else ─────────────────► enqueue(task)
                                   │
                                   └─ on worker idle: shift & dispatch
```

---

## Invariants

1. **One task per worker at a time** — a worker's `current` slot holds at most
   one in-flight task; the pool never pipelines messages to a single worker.
2. **FIFO queue** — pending tasks are dispatched in the order they were
   enqueued.
3. **Worker reuse** — idle workers are kept alive (not terminated) to avoid
   repeated creation overhead; they are only terminated by `drain()` or
   `dispose()`.
4. **Limit enforcement** — `workerCount` never exceeds `workerLimit`; excess
   tasks queue until a worker becomes idle.
5. **Dispose safety** — after `dispose()`:
   - All queued tasks reject with `"disposed before task started"`.
   - All in-flight tasks reject with `"disposed during task"`.
   - All workers are `terminate()`-d.
   - Subsequent `runTask()` calls reject with `"disposed"`.
6. **Transferable ownership** — when `transfer` is supplied, the buffers are
   transferred (detached from the caller) per the Web Worker spec; the pool
   does not retain references.

---

## Error Handling

| Scenario                     | Behavior                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| Worker `onerror` fires       | Current task rejects with the error message; worker stays alive. |
| `postMessage` throws         | Task rejects with the thrown error; worker marked idle.          |
| Handler throws (main thread) | Task rejects with the thrown error.                              |
| `dispose()` during task      | In-flight tasks reject; queued tasks reject; workers terminate.  |
| `queueMax` exceeded          | New task rejects with `"queue overflow"`.                        |

---

## Integration Points

| Consumer                        | Use Case                                              |
| ------------------------------- | ----------------------------------------------------- |
| `Loaders/KTX2Loader`            | Multi-threaded Basis Universal texture transcoding.   |
| `Loaders/GLBLoader` + Draco     | Parallel Draco mesh decoding.                         |
| `AI/NavMeshBuilder`             | Parallel voxelization + contour simplification.       |
| `Physics/FluidSimulation`       | SPH neighbor search partitioned across workers.       |
| `Renderer/PathTracer`           | Tile-based path tracing across CPU cores.             |
| `Editor/SnapSystem`             | Background geometry processing.                       |

---

## References

- three.js `examples/jsm/utils/WorkerPool.js` — original callback-based pool.
- o3de `AZ::JobSystem` — C++ job system with work stealing and priorities.
- MDN [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) — `Worker`, `postMessage`, `Transferable`.
- HTML Spec [Structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone) — transfer semantics.
