# Tools Module

> Path: `src/engine/Tools/`
>
> The performance and tooling subsystem of the `@vreen/engine` kernel. Provides
> a family of profilers (`Profiler`, `Profiler2`, `FrameProfiler`,
> `SystemProfiler`, `GpuProfiler`), an explicit resource `MemoryTracker`, a
> `PerformanceReport` aggregator, a scene-level `LODManager`, and a
> developer-facing `ConsoleCommands` REPL. Each tool is small, independently
> usable, and consumed by different layers (HUD, CI, offline analysis).

---

## Overview

The Tools module is intentionally a *family* rather than a single profiler:
each tool targets a different granularity (frame / zone / system / allocation /
GPU query / scene LOD) and a different consumer (live HUD, leak triage, Chrome
Trace, automation). They share no state and can be wired together by the caller.

```
                 ┌─────────────────── PerformanceReport (static) ─────────────────┐
                 │   generate(fp?, sp?, mt?)  /  toJSON(fp?, sp?, mt?)            │
                 │         ▲                  ▲                  ▲                 │
   ┌────────────┴────┐  ┌────┴─────────┐  ┌────┴──────────┐  ┌────┴──────────┐
   │ FrameProfiler   │  │ SystemProfiler│  │ MemoryTracker │  │ GpuProfiler   │
   │  ring buffer    │  │  per-system   │  │  allocation   │  │  timer query  │
   │  FPS / dt /     │  │  totalTime /  │  │  id ledger +  │  │  beginQuery / │
   │  drawCalls      │  │  avg / max    │  │  leak triage  │  │  endQuery     │
   └─────────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
            ▲                                                              │
   ┌────────┴─────────┐                                                    │
   │ Profiler         │  mark/markEnd + GPU timer query inline (ring)      │
   │ Profiler2        │  zones + events + Chrome Trace export              │
   └──────────────────┘                                                    │
                                                                           ▼
   ┌──────────────────┐   ┌────────────────────────────────────────────────┐
   │ LODManager       │   │ ConsoleCommands                                │
   │  distance /      │   │  registerCommand / execute / parseArgs /       │
   │  screen-space /  │   │  autoComplete / getHelp + default command set  │
   │  HLOD            │   │  (Engine/Scene/Entity/Physics/Rendering/Audio/  │
   └──────────────────┘   │  Debug)                                        │
                          └────────────────────────────────────────────────┘
```

`PerformanceReport` is the only aggregator: it takes *optional* references to
`FrameProfiler`, `SystemProfiler`, and `MemoryTracker` and emits either a
human-readable text block or a `PerformanceReportJson` for CI regression
tracking.

---

## Core Classes

### Profiler (`Profiler.ts`)

Early ring-buffer frame profiler with `mark` / `markEnd` zones and optional
inline GPU timer queries (`EXT_disjoint_timer_query_webgl2`). Fixed-capacity
ring (default 60 frames) of `FrameSample`.

| Export | Role |
|--------|------|
| `Profiler` | Ring-buffer frame profiler. `frameStart` / `mark(name, { gpu })` / `markEnd(name)` / `frameEnd({ drawCalls, triangles, drawCallBreakdown })`. |
| `FrameSample` | Per-frame snapshot: `cpuMs`, `gpuMs?`, `wallDeltaMs`, `fps`, `marks`, `drawCalls?`, `triangles?`, `drawCallBreakdown?`. |
| `ProfilerMark` | Nested mark node (`name`, `startMs`, `endMs`, `gpuQueryStart?`, `gpuTimeNs?`, `children`). |
| `DrawCallSample` | Per-mesh draw call breakdown: `byMesh[name] = { calls, triangles, passes }`. |

GPU queries are polled asynchronously via `pollGpuTimers(gl)`; results land on
`ProfilerMark.gpuTimeNs` once `QUERY_RESULT_AVAILABLE` and not disjoint.
`frameEnd` force-closes any still-open marks (error recovery).

### Profiler2 (`Profiler2.ts`)

Enhanced profiler with three semantic layers: frames (`beginFrame` /
`endFrame`), zones (`beginZone` / `endZone`, nested, accumulated), and discrete
events (`recordEvent`). Exports Chrome Trace JSON for `chrome://tracing`.

| Export | Role |
|--------|------|
| `Profiler2` | Main profiler class. `setEnabled(bool)` globally gates all methods. |
| `ProfileCategory` | `'cpu' \| 'gpu' | 'memory' | 'render' | 'physics' | 'audio' | 'network'`. |
| `ProfileEvent` | `{ name, category, startTime, duration, color? }`. |
| `ProfileZone` | `{ name, enterCount, totalTime, minTime, maxTime, avgTime }`. |
| `ProfilerStats` | Snapshot from `getStats()`: `fps`, `frameTime`, `avgFrameTime`, `cpuTime`, `gpuTime`, `drawCalls`, `triangles`, `vertices`, `memoryUsage`, `zoneCount`, `eventCount`. |
| `Profiler2Options` | `{ maxHistorySize?: number; enabled?: number }`. |
| `MemoryUsage` | `{ used, total }` (bytes). |
| `ChromeTraceEvent` / `ChromeTrace` | Chrome Trace format (`ph: 'B'|'E'|'X'|'i'|'M'`, `ts`/`dur` in microseconds). |

`Profiler` and `Profiler2` are designed to coexist: the former focuses on
mark intervals with GPU integration, the latter on frame/zone/event semantics
with offline export. `exportTrace()` returns a `ChromeTrace` directly loadable
in `chrome://tracing`.

### FrameProfiler (`FrameProfiler.ts`)

Frame-level FPS / draw-call / triangle aggregator. Ring buffer (default 120)
of `FrameSample`. Maintains rolling `currentFPS` / `avgFPS` / `minFPS` /
`maxFPS` recomputed on every `endFrame`.

| Export | Role |
|--------|------|
| `FrameProfiler` | `beginFrame()` / `endFrame({ drawCalls?, triangles?, vertices?, memoryMB? })` / `getMetrics()` / `getHistory(count)` / `reset()`. |
| `FrameSample` | `{ frame, time, dt, drawCalls, triangles, vertices, memoryMB }`. |
| `FrameMetrics` | Snapshot: `currentFPS`, `avgFPS`, `minFPS`, `maxFPS`, `frameTimeMs`, `drawCalls`, `triangles`, `vertices`, `memoryMB`, `sampleCount`. |
| `FrameStats` | Input bag for `endFrame`. |

```ts
const fp = new FrameProfiler({ maxSamples: 120 });
fp.beginFrame();
renderer.render(scene, camera);
fp.endFrame({ drawCalls: 120, triangles: 50000, vertices: 25000, memoryMB: 64 });
const m: FrameMetrics = fp.getMetrics();
```

### SystemProfiler (`SystemProfiler.ts`)

ECS system cost tracker. `begin(name)` / `end(name)` push/pop a stack;
per-system `SystemTiming` records `totalTime`, `callCount`, `avgTime`,
`maxTime`, `lastTime`.

| Export | Role |
|--------|------|
| `SystemProfiler` | `begin(name)` / `end(name)` / `getTiming(name)` / `getAllTimings()` (sorted by `totalTime` desc) / `getSlowestSystems(count)` (sorted by `avgTime` desc) / `reset()`. |
| `SystemTiming` | `{ name, totalTime, callCount, avgTime, maxTime, lastTime }`. |

`end(name)` searches the open stack from the top down for a matching name
(fault-tolerant against out-of-order nesting) and silently ignores unknown
names so a stale `end` never crashes the main loop.

### MemoryTracker (`MemoryTracker.ts`)

Explicit allocation ledger for engine-managed resources (WebGLBuffer /
WebGLTexture / typed-array caches). **Not** a JS heap profiler — V8 owns GC.

| Export | Role |
|--------|------|
| `MemoryTracker` | `track(type, size, stack?) → id` / `untrack(id) → boolean` / `getSummary()` / `getLeaks(minAgeMs?)` / `reset()`. |
| `AllocationRecord` | `{ id, type, size, time, stack? }`. |
| `MemorySummary` | `{ activeCount, totalAllocated, totalFreed, activeBytes, activeMB, byType }`. |

`untrack` is O(1) (swap-with-tail) so high-frequency alloc/free is cheap.
`getLeaks(minAgeMs)` returns allocations older than the threshold for leak
triage.

### GpuProfiler (`GpuProfiler.ts`)

Standalone wrapper around `EXT_disjoint_timer_query_webgl2`. Provides
begin/end/resolve triplet independent of `Profiler.mark`.

| Export | Role |
|--------|------|
| `GpuProfiler` | `beginQuery(gl, id)` / `endQuery(gl, id)` / `getQueryResult(gl, id) → number \| undefined` / `getAllResults(gl)` / `pollAll(gl)` / `dispose(gl)`. |
| `GpuQuery` | `{ id, beginTime, endTime, duration?, resolved, glQuery? }`. |

When the extension is unavailable (Safari, headless test runners), all methods
silently no-op and `getQueryResult` returns `undefined`; the begin/end pair
falls back to CPU-side timing. `pollAll` discards results when
`GPU_DISJOINT_EXT` is set.

### PerformanceReport (`PerformanceReport.ts`)

Static aggregator that takes optional profiler references and emits a
human-readable text report or a `PerformanceReportJson`.

| Export | Role |
|--------|------|
| `PerformanceReport` | `static generate(fp?, sp?, mt?) → string` / `static toJSON(fp?, sp?, mt?) → PerformanceReportJson`. |
| `PerformanceReportJson` | `{ generatedAt, frame, systems, memory, slowestSystems }`. |

It never holds profiler references between calls, so it can be reused across
instances and is safe to call from a one-shot snapshot.

### LODManager (`LODManager.ts`)

Scene-level Level-of-Detail manager. Each `LODGroup` binds an `Object3D` to a
sorted list of `LODLevel`s. Two selection strategies (per-group
`useScreenSpace`): distance thresholds or screen-space ratio (estimated from
bounds diagonal vs. camera fov). Optional HLOD hides the entire group past
`hlodDistance`.

| Export | Role |
|--------|------|
| `LODManager` | `registerGroup(id, group)` / `unregisterGroup(id)` / `addLOD(groupId, lod)` / `removeLOD(groupId, level)` / `setCamera(cam)` / `update(dt)` / `selectLOD(group)` / `computeScreenRatio(group)` / `getLODStats()` / `getTotalDrawCalls()`. |
| `LODGroup` | `{ id, object, lods, currentLOD, useScreenSpace, bounds }`. `currentLOD = -1` means hidden (HLOD). |
| `LODLevel` | `{ level, geometry, material, screenRatio, distance, drawCalls }`. `level = 0` is highest detail. |
| `LODStats` | `{ groupCount, groupsPerLevel[], hiddenCount, totalDrawCalls, screenSpaceGroups, hlodEnabled, hlodActiveCount }`. |

Complementary to `Core/LOD` (single-node LOD): `LODManager` is the
scene-level orchestrator with global policies and statistics.

### ConsoleCommands (`ConsoleCommands.ts`)

Developer console / REPL command system. Each `ConsoleCommand` declares typed
`args` (`string` / `number` / `boolean` / `vector3`) + `handler` + `category`.
Supports aliases, history, auto-complete, and grouped help.

| Export | Role |
|--------|------|
| `ConsoleCommands` | `registerCommand(cmd)` / `unregisterCommand(name)` / `registerAlias(alias, name)` / `execute(input) → ExecuteResult` / `parseArgs(input)` / `getAutoComplete(input)` / `getHelp(name?)` / `registerAllDefaultCommands(world?, scene?)`. |
| `ConsoleCommand` | `{ name, description, usage, args, handler, category }`. |
| `ConsoleArg` / `ConsoleArgType` | `{ name, type, required, description? }` / `'string' \| 'number' \| 'boolean' \| 'vector3'`. |
| `ConsoleCommandCategory` | `'General' \| 'Engine' | 'Scene' | 'Entity' | 'Physics' | 'Rendering' | 'Audio' | 'Debug'`. |
| `ExecuteResult` | `{ output: string, success: boolean }`. |
| `AutoCompleteSuggestion` / `HelpEntry` / `GroupedHelp` / `ConsoleCommandsStats` | UI-facing result shapes. |
| `getDefaultConsoleCommands()` / `resetDefaultConsoleCommands()` | Process-level singleton accessor + test reset. |

`registerAllDefaultCommands(world?, scene?)` is idempotent — repeat calls do
not duplicate commands. Setters `setWorld` / `setScene` / `setFrameProfiler` /
`setSystemProfiler` / `setMemoryTracker` retarget the default command set
without rebuilding it.

---

## Usage

### Frame + system profiling wired into a render loop

```ts
import { FrameProfiler, SystemProfiler, MemoryTracker, PerformanceReport } from '@vreen/engine/tools';

const fp = new FrameProfiler({ maxSamples: 120 });
const sp = new SystemProfiler();
const mt = new MemoryTracker();

function frame(world: World, dt: number) {
  fp.beginFrame();

  for (const sys of world.systems) {
    sp.begin(sys.name);
    sys.update(world, dt);
    sp.end(sys.name);
  }

  fp.endFrame({ drawCalls: renderer.drawCalls, triangles: renderer.triangles });
}

// On demand — emit a text report
console.log(PerformanceReport.generate(fp, sp, mt));

// Or a JSON snapshot for CI regression tracking
const json = PerformanceReport.toJSON(fp, sp, mt);
```

### Chrome Trace export with Profiler2

```ts
import { Profiler2 } from '@vreen/engine/tools';

const p = new Profiler2({ maxHistorySize: 120, enabled: true });
p.startRecording();
p.beginFrame();
p.beginZone('render');
renderer.render(scene, camera);
p.endZone('render');
p.setDrawCalls(renderer.drawCalls);
p.setGPUTime(gpuMs);
p.endFrame();
p.stopRecording();

const trace = p.exportTrace();
// Load `trace` directly at chrome://tracing
```

### Explicit GPU timer queries

```ts
import { GpuProfiler } from '@vreen/engine/tools';

const gpu = new GpuProfiler();
gpu.beginQuery(gl, 'shadow.pass');
shadowMapManager.render(scene, light);
gpu.endQuery(gl, 'shadow.pass');

// Next frame, after the GPU has caught up:
const ms = gpu.getQueryResult(gl, 'shadow.pass');
gpu.dispose(gl); // release all WebGLQuery objects
```

### Memory leak triage

```ts
import { MemoryTracker } from '@vreen/engine/tools';

const mt = new MemoryTracker();
const id = mt.track('WebGLBuffer', 4 * 1024 * 1024, new Error().stack);
// ... use the buffer ...
mt.untrack(id);

// After a level unload — anything still tracked > 5s is suspect:
const leaks = mt.getLeaks(5000);
```

### LODManager registration and per-frame update

```ts
import { LODManager } from '@vreen/engine/tools';

const mgr = new LODManager({
  lodDistances: [10, 25, 50, 100],
  screenSpaceThreshold: 0.05,
  enableHLOD: true,
  hlodDistance: 200,
  camera,
});
mgr.registerGroup(1, {
  id: 1,
  object: mesh,
  lods: [
    { level: 0, geometry: hiGeo, material: hiMat, screenRatio: 0.5, distance: 10, drawCalls: 1 },
    { level: 1, geometry: midGeo, material: midMat, screenRatio: 0.2, distance: 25, drawCalls: 1 },
    { level: 2, geometry: loGeo, material: loMat, screenRatio: 0.05, distance: 50, drawCalls: 1 },
  ],
  currentLOD: 0,
  useScreenSpace: false,
  bounds: { min: new Vector3(-1, -1, -1), max: new Vector3(1, 1, 1) },
});

function frame(dt: number) {
  mgr.update(dt);
  const stats = mgr.getLODStats();
}
```

### ConsoleCommands REPL

```ts
import { ConsoleCommands } from '@vreen/engine/tools';

const cc = new ConsoleCommands();
cc.registerAllDefaultCommands(world, scene);
cc.registerAlias('ls', 'scene.list');

const result = cc.execute('scene.list');
console.log(result.output);          // human-readable list
console.log(result.success);         // true

const suggestions = cc.getAutoComplete('sce');   // scene.* commands
const help = cc.getHelp();           // GroupedHelp[] grouped by category
```

---

## Invariants

- **Profiler ring buffer is fixed capacity.** `ringSize` is set at construction
  and never resized; `history()` returns the most recent `ringCount` frames in
  old-to-new order.
- **`mark` / `markEnd` are fault-tolerant.** `markEnd(name)` searches the open
  stack top-down; unknown names are silently ignored. `frameEnd` force-closes
  any still-open marks so a missing `markEnd` never leaks across frames.
- **`SystemProfiler.end` never throws.** Unknown or out-of-order names are
  ignored so a stale `end` cannot crash the main loop.
- **`MemoryTracker.untrack` is O(1).** The allocation array uses
  swap-with-tail + an `idIndex` map to keep deletions constant-time.
- **`GpuProfiler` degrades silently.** When
  `EXT_disjoint_timer_query_webgl2` is unavailable, `beginQuery` /
  `endQuery` fall back to CPU-side timing and `getQueryResult` returns
  `undefined`. `pollAll` discards results when `GPU_DISJOINT_EXT` is set.
- **`Profiler2.setEnabled(false)` no-ops all collection.** `beginFrame` /
  `endFrame` / `beginZone` / `endZone` / `setDrawCalls` / etc. return
  immediately, allowing conditional profiling without code branching.
- **`ConsoleCommands.execute` never throws.** Handler exceptions are caught
  and returned as `{ output: 'Error: <msg>', success: false }`. Parse errors
  (missing required arg, type mismatch) short-circuit before the handler is
  invoked.
- **`registerAllDefaultCommands` is idempotent.** Calling it twice with the
  same `ConsoleCommands` instance does not duplicate commands.
- **`LODManager.update` requires a camera.** Without `setCamera`, `update` is
  a no-op; groups retain their last `currentLOD` value.
- **`PerformanceReport.generate` / `toJSON` are stateless.** They take
  optional profiler references per call and never cache them, so the same
  `PerformanceReport` can serve multiple instances.

---

## References

- `EXT_disjoint_timer_query_webgl2` specification — WebGL Registry.
- Parker, Bigler, et al. "Understanding the Efficiency of Ray Traversal on
  GPUs." (p-vertex / conservative frustum culling is reused by `BVH`, but the
  disjoint-timer query model here follows the same GPU-async discipline.)
- Chrome Trace Event Format —
  https://docs.google.com/document/d/1CvAClvFfyA5R5PhOMUvOc0fQkXnOTnfHABQOZzwJASQ
- Internal: `profilerStore` (Zustand) consumes `FrameProfiler.getMetrics()` /
  `SystemProfiler.getAllTimings()` for the live HUD; `FrameChart.tsx` and
  `SystemTimingChart.tsx` render the ring buffers.
- Internal: `ConsoleCommands` is wired into the editor dev console; its
  default command set covers Engine / Scene / Entity / Physics / Rendering /
  Audio / Debug categories and is populated by `registerAllDefaultCommands`.
