# SceneManager Module

> Path: `src/engine/SceneManager/`
>
> The scene lifecycle subsystem of the `@vreen/engine` kernel. Provides a
> multi-scene registry / loader / switcher (`SceneManager`) decoupled
> from the renderer, a finite-state transition value object
> (`SceneTransition`) with five effect types, a higher-level manager-style
> transition system (`SceneTransitionSystem`) with six effects + easing +
> loading screen, and a spatial streaming loader (`SceneStreaming`) for
> chunked open-world content.

---

## Overview

```
SceneManager                          ← registry / loader / switcher
   ├── scenes: Map<name, SceneRecord>    ← factory + cached instance + hooks
   ├── register / unregister             ← factory registration
   ├── load / unload / preload           ← instance lifecycle
   └── switch(name, transition?)         ← drives ↓
          │
          ▼
SceneTransition (value object)        ← single-transition state machine
   phases: Idle → FadingOut → Swapping → FadingIn → Complete
   types:  Fade | Crossfade | Slide | Wipe | None
          │
          ▼  (complementary, manager style)
SceneTransitionSystem                 ← multi-transition manager
   ├── currentTransition: TransitionEffect | null
   ├── startTransition(type, duration, options)
   ├── 6 types: fade | slide | zoom | dissolve | wipe | iris
   ├── easing: line | easeIn | easeOut | easeInOut | bounceBack
   ├── loadingScreen + minDisplayTime
   └── getRenderData() → TransitionRenderData  ← consumed by renderer

SceneStreaming (orthogonal)           ← spatial chunk loader
   ├── chunks: Map<id, SceneChunk>       ← AABB-bounded content blocks
   ├── camera + streamRadius              ← distance-based auto load/unload
   ├── loadingQueue + unloadQueue         ← priority queue + LRU eviction
   └── forceLoad / forceUnload / preload ← manual overrides
```

Three cooperating layers:

- **`SceneManager`** — owns scene factories and cached instances, plus an
  optional active `SceneTransition`. Per-frame `update(dt)` advances the
  transition; the actual scene swap happens at the transition midpoint
  (Fade / Slide / Wipe) or endpoint (Crossfade).
- **`SceneTransition` / `SceneTransitionSystem`** — the visual bridge
  between two active scenes. The basic class is a single-transition value
  object used internally by `SceneManager`; the system class is a
  long-lived manager for callers that want loading screens, multiple
  effect types, and render-data output.
- **`SceneStreaming`** — orthogonal to `SceneManager`. Where the manager
  swaps whole scenes, streaming manages the chunks *inside* one scene
  based on camera proximity.

---

## Core Classes

### `SceneManager` (`SceneManager.ts`)

| Export | Role |
|--------|------|
| `SceneManager` | Registry + loader + switcher. `scenes: Map<name, SceneRecord>`; `activeScene: string \| null`. |
| `SceneFactory` | `() => Scene`. Called on `load` / `preload` to materialise an instance. |
| `SceneLifecycleHooks` | `onEnter(scene, name)` / `onLeave(scene, name)` / `onUnload(scene, name)`. Per-scene + global hooks. |
| `SceneManagerOptions` | `globalHooks?` — fired alongside per-scene hooks. |

| Method | Behaviour |
|--------|-----------|
| `register(name, factory, hooks?)` | Registers a factory. Overwriting logs a warning. |
| `unregister(name)` | Unloads the instance (if any) and removes the factory. Returns whether anything was removed. |
| `load(name)` | Calls the factory once and caches. No-op if already loaded. Returns the `Scene`. |
| `unload(name)` | Drops the cached instance, keeps the factory. Triggers `onUnload`. Returns whether anything was unloaded. |
| `preload(name)` | Alias for `load` — useful for pre-warming geometry / textures before a switch. |
| `switch(name, transition?)` | Activates `name`. Auto-loads if needed. With `None` transition (or omitted) the swap is immediate; otherwise the swap is deferred to the transition midpoint / endpoint. |
| `update(dt)` | Advances the active transition and commits the swap at the right phase. |
| `getActive()` | Returns the active `Scene` or `null`. |
| `getScene(name)` | Returns the cached `Scene` or `null` (not registered or not loaded). |
| `getLoadedScenes()` / `getRegisteredScenes()` | Name lists. |
| `isTransitioning()` | True while a non-`None` transition is in progress. |
| `getActiveTransition()` | The current `SceneTransition` (debug). |

Switch contract:

```
switch(name, transition?) ──► if name not registered: throw
                              if name not loaded:    load(name)
                              if transition None | duration<=0:
                                  _commitSwitch(name) immediately
                              else:
                                  transition.begin()
                                  _pendingActive = name
                                  update(dt) drives phase
                                  at Swapping (Fade/Slide/Wipe) or
                                     Complete (Crossfade): _commitSwitch(name)
```

`_commitSwitch` triggers `onLeave` on the old scene then `onEnter` on the
new one; per-scene hooks fire before global hooks. Hooks are skipped if
the target is already active (same-name switch is a no-op for `None`
transitions).

### `SceneTransition` (`SceneTransition.ts`)

| Export | Role |
|--------|------|
| `SceneTransition` | Single-transition value object with a 5-phase FSM. |
| `TransitionType` | `'Fade' \| 'Crossfade' \| 'Slide' \| 'Wipe' \| 'None'`. |
| `TransitionPhase` | `'Idle' \| 'FadingOut' \| 'Swapping' \| 'FadingIn' \| 'Complete'`. |
| `TransitionDirection` | `'Left' \| 'Right' \| 'Up' \| 'Down'` — Slide / Wipe only. |
| `SceneTransitionOptions` | `type?` / `duration?` (s) / `color?` (`Color \| number \| string`) / `direction?`. |
| `instantTransition()` | Factory for a `None` transition (instant swap). |
| `fadeTransition(duration?, color?)` | Factory for a `Fade` transition. |

```ts
export class SceneTransition {
  readonly type: TransitionType;
  readonly duration: number;       // seconds; forced 0 for None
  readonly color: Color;
  readonly direction: TransitionDirection;
  phase: TransitionPhase;
  progress: number;                 // 0..1 (FadingOut 0→1; FadingIn 1→0)
  elapsedTime: number;
  begin(): void;
  update(dt: number): TransitionPhase;
  isComplete(): boolean;
  reset(): void;
  render(gl: WebGL2RenderingContext): void; // no-op; renderer reads phase/progress
}
```

Time model (Fade, `duration = 1.0s`):

```
0.0 ─ 0.5s   FadingOut    progress 0 → 1   (old scene covered)
0.5s         Swapping     progress = 1     (caller swaps active scene)
0.5 ─ 1.0s   FadingIn     progress 1 → 0   (new scene revealed)
1.0s         Complete
```

Crossfade is single-phase (`FadingOut` 0 → 1, swap at `Complete`); the
caller must render both scenes and blend by `progress`. `None` forces
`duration = 0` and jumps straight to `Complete` on `begin`.

### `SceneTransitionSystem` (`SceneTransition.ts`)

| Export | Role |
|--------|------|
| `SceneTransitionSystem` | Manager-style transition controller. Owns `currentTransition` + stats. |
| `SceneTransitionSystemType` | `'fade' \| 'slide' \| 'zoom' \| 'dissolve' \| 'wipe' \| 'iris'`. |
| `TransitionSystemDirection` | `'left' \| 'right' \| 'up' \| 'down' \| 'in' \| 'out'`. |
| `EasingName` / `EasingFn` | `'line' \| 'easeIn' \| 'easeOut' \| 'easeInOut' \| 'bounceBack'` and the function type. |
| `TransitionEffect` | `{ type, duration, color?, direction?, easing?, onComplete?, texture? }`. |
| `TransitionRenderData` | `{ active, type, progress, easedProgress, alpha, color, offset, direction, loadingScreen, loadingProgress, texture?, shouldSwap }`. |
| `SceneTransitionSystemStats` | `transitioning` / `type` / `progress` / `totalTransitions` / `completedTransitions` / `cancelledTransitions` / `loadingScreen` / `loadingProgress`. |

| Method | Behaviour |
|--------|-----------|
| `startTransition(type, duration, options?)` | Begins a new transition. If one is in flight, fires its `onComplete` first. |
| `update(dt)` | Advances progress; respects `minDisplayTime`. |
| `fade / slide / zoom / dissolve / wipe / iris` | Convenience factories. |
| `complete()` | Forwards to `progress = 1` and fires `onComplete`. |
| `cancel()` | Stops the transition without firing `onComplete`. |
| `setLoadingScreen(bool)` / `setLoadingProgress(0..1)` | Overlays a loading indicator. |
| `setMinDisplayTime(s)` | Avoid flicker on fast loads. |
| `setDuration(s)` | Adjust mid-transition (re-scales remaining time). |
| `getRenderData()` | Returns the overlay parameters the renderer needs. |
| `getStats()` | Snapshot for HUDs / debugging. |

`shouldSwap` in `TransitionRenderData` is true when `progress >= 0.5` —
the renderer / caller swaps scenes at that moment. `alpha` for `fade`
follows `1 - |2p - 1|` (peak at midpoint); for `slide` / `wipe` the
`offset` field drives screen-space motion.

### `SceneStreaming` (`SceneStreaming.ts`)

| Export | Role |
|--------|------|
| `SceneStreaming` | Spatial chunk loader. `chunks: Map<id, SceneChunk>`; `loadedChunks: Set<id>`; `loadingQueue` + `unloadQueue`. |
| `SceneChunk` | `{ id, bounds: SceneChunkBounds, objects: Object3D[], isLoaded, priority, assets: string[] }`. |
| `SceneChunkBounds` | `{ min: Vector3, max: Vector3 }` — world-space AABB. |
| `SceneChunkRequest` | `{ chunkId, priority, callback }`. |
| `StreamCamera` | Any object with a `position: Vector3`. |
| `StreamingStats` | `totalChunks` / `loadedChunks` / `loadingChunks` / `unloadQueueLength` / `activeLoads` / `maxConcurrentLoads` / `streamRadius` / `chunkSize`. |
| `SceneStreamingOptions` | `streamRadius?` (default 50) / `chunkSize?` (default 16) / `maxConcurrentLoads?` (default 2) / `loadDuration?` (s, default 0 = synchronous). |
| `createSceneChunk` | Factory — takes `id`, `min: [x,y,z]`, `max: [x,y,z]`, optional `{ objects?, assets?, isLoaded? }`. |

| Method | Behaviour |
|--------|-----------|
| `registerChunk(chunk)` | Registers a chunk; overwrites with a warning. |
| `unregisterChunk(id)` | Unloads + removes from all queues. |
| `setCamera(cam \| null)` | `null` disables auto load / unload. |
| `setStreamRadius / setChunkSize / setMaxConcurrentLoads` | Live config. |
| `requestChunk(id, priority?, cb?)` | Enqueues a load. No-op if already loaded / queued / loading. |
| `releaseChunk(id)` | Enqueues an unload. |
| `forceLoad(id)` | Bypasses the queue; synchronously completes when `loadDuration = 0`, otherwise starts an async load. |
| `forceUnload(id)` | Cancels any in-flight load and unloads if loaded. Returns whether anything happened. |
| `preload(center, radius)` | Enqueues all chunks within `radius` of `center` at high priority. Returns the count added. |
| `update(dt)` | Auto-schedules visible / invisible chunks, drains the unload queue, advances async loads, and starts queued loads up to `maxConcurrentLoads`. |
| `getVisibleChunks()` | Chunks whose AABB-to-camera distance ≤ `streamRadius`. |
| `getLoadedChunks()` / `getLoadingChunks()` / `getStreamingStats()` | Introspection. |
| `clear()` | Unloads everything and empties the registry. |

Auto-scheduling rules in `update`:

```
for each chunk:
  dist = chunkBoundsDistance(chunk, camera.position)
  if dist <= streamRadius:
      if !isLoaded && !queued && !loading:  requestChunk(id, -dist)
  else:
      if isLoaded && !inUnloadQueue:        unloadQueue.push(id)
```

Priority is `-dist` so nearer chunks load first; `preload` uses
`1e6 - dist` to jump ahead of auto-scheduled entries.

---

## Usage

### Register + switch with a fade

```ts
import { SceneManager, fadeTransition } from '@vreen/engine/scenemanager';
import { Scene } from '@vreen/engine/core';

const sm = new SceneManager({
  globalHooks: {
    onEnter: (s, n) => console.log(`entered ${n}`),
    onLeave: (s, n) => console.log(`left ${n}`),
  },
});

sm.register('menu', () => buildMenuScene(), {
  onEnter: (s) => s.userData.enteredAt = Date.now(),
});
sm.register('level-1', () => buildLevel1());

sm.switch('menu');                          // immediate (None)
// later:
sm.switch('level-1', fadeTransition(1.0, 0x000000));

function frame(dt: number) {
  sm.update(dt);
  const active = sm.getActive();
  if (active) renderer.render(active, camera);
}
```

### Loading screen with the transition system

```ts
import { SceneTransitionSystem } from '@vreen/engine/scenemanager';

const sys = new SceneTransitionSystem();
sys.setMinDisplayTime(0.6); // avoid flicker on instant loads
sys.setLoadingScreen(true);
sys.setLoadingProgress(0);

sys.fade(0.8, 0x000000);

// During async load:
function onProgress(p: number) {
  sys.setLoadingProgress(p);
  if (p >= 1) sys.setLoadingScreen(false);
}

function frame(dt: number) {
  sys.update(dt);
  const data = sys.getRenderData();
  if (data.active) overlay.draw(data); // alpha, color, offset, shouldSwap
  if (data.shouldSwap && !swapped) {
    sm.switch('next-level');           // commit the swap once
    swapped = true;
  }
}
```

### Spatial streaming for an open world

```ts
import { SceneStreaming, createSceneChunk } from '@vreen/engine/scenemanager';

const stream = new SceneStreaming({
  streamRadius: 80,
  chunkSize: 16,
  maxConcurrentLoads: 2,
  loadDuration: 0.15, // simulate 150 ms per chunk
});

for (let x = -4; x <= 4; x++) {
  for (let z = -4; z <= 4; z++) {
    stream.registerChunk(createSceneChunk(
      `chunk_${x}_${z}`,
      [x * 16, 0, z * 16],
      [(x + 1) * 16, 16, (z + 1) * 16],
      { assets: [`terrain_${x}_${z}.glb`] },
    ));
  }
}

stream.setCamera(camera);

function frame(dt: number) {
  stream.update(dt);
  for (const chunk of stream.getLoadedChunks()) {
    // append chunk.objects to the active scene if not already attached
  }
}
```

### Forced chunk load for a cutscene

```ts
// Preload the boss arena regardless of camera distance.
stream.preload(bossArenaCenter, 30);

// Or force a single chunk synchronously.
const chunk = stream.forceLoad('boss_arena');
if (chunk) scene.add(...chunk.objects);

// Tear it down explicitly when the cutscene ends.
stream.forceUnload('boss_arena');
```

---

## Invariants

- **Renderer independence.** `SceneManager` never references a renderer;
  the caller reads `getActive()` each frame and renders it. `SceneTransition.render`
  is a no-op hook — the renderer is responsible for reading `phase` /
  `progress` / `color` / `direction`.
- **Factory purity.** `SceneFactory` is called at most once per `load` /
  `preload` cycle. The result is cached in `SceneRecord.scene` until
  `unload` / `unregister` clears it.
- **Active scene validity.** `activeScene` is either `null` or the name
  of a registered scene whose `SceneRecord.scene` is non-null. `unload`
  on the active scene sets `activeScene = null`.
- **Hook ordering.** For a single switch, per-scene `onLeave` (old) fires
  before per-scene `onEnter` (new). Per-scene hooks fire before global
  hooks of the same kind. Hooks are skipped on a no-op same-name switch.
- **Transition swap timing.** Fade / Slide / Wipe swap at `Swapping`
  (midpoint). Crossfade swaps at `Complete`. If `update(dt)` jumps past
  the midpoint in one frame, the swap is still committed that frame.
- **Transition value-object vs system.** `SceneTransition` is a
  single-transition instance used internally by `SceneManager`.
  `SceneTransitionSystem` is a long-lived manager that produces
  `TransitionRenderData` for callers needing loading screens or more
  than the five basic effect types. They are complementary, not redundant.
- **SceneTransition None coercion.** `type === 'None'` forces
  `duration = 0` and `begin()` jumps straight to `Complete`.
- **Streaming camera nullability.** `camera === null` disables
  automatic load / unload in `update`; manual `requestChunk` /
  `releaseChunk` / `forceLoad` / `forceUnload` still work.
- **Streaming queue invariants.** A chunk id is in at most one of
  `loadingQueue`, `_loadingChunks`, or `loadedChunks`. `requestChunk`
  on a chunk already in any of those is a no-op.
- **Streaming priority ordering.** `update` sorts `loadingQueue` by
  descending `priority` before consuming capacity. Auto-scheduled
  chunks use `-dist`; `preload` uses `1e6 - dist` to jump ahead.
- **Streaming concurrency cap.** The number of simultaneously
  in-flight async loads (`_loadingChunks.size`) never exceeds
  `maxConcurrentLoads`. Synchronous loads (`loadDuration = 0`) do not
  count against the cap.
- **Streaming unregister cleanliness.** `unregisterChunk` unloads the
  chunk, cancels any in-flight async load, and removes the id from both
  queues — no dangling references remain.
- **No commit on dispose.** Neither `SceneManager` nor `SceneStreaming`
  expose `dispose`; callers must explicitly `unload` / `clear` to
  release resources before dropping the reference.

---

## References

- `SceneManager.ts` — registry, factory cache, transition-driven switch
  contract.
- `SceneTransition.ts` — basic value-object FSM + the manager-style
  `SceneTransitionSystem` with six effects + easing + loading screen.
- `SceneStreaming.ts` — AABB chunk registry, camera-driven auto
  scheduling, priority queue + LRU unload.
- Related: `src/engine/Core/Scene.ts` (scene graph root);
  `src/engine/SaveSystem/` (callers load `{ scene, world }` from a save
  then `register` + `switch` to activate it);
  `src/engine/Renderer/` (consumes `getActive()` and
  `TransitionRenderData`).
