# Assets Module

> Path: `src/engine/Assets/`
>
> The resource lifecycle subsystem of the `@vreen/engine` kernel. Sits
> above `Loaders/AssetManager` (which caches parse promises) and provides
> four complementary capabilities: an LRU instance cache (`AssetCache`),
> a reference-counted registry with unload callbacks (`AssetRegistry`),
> a friendly async batch loader (`AssetLoader`), a Unity-style bundle
> system with manifests and concurrency limits (`AssetBundle`), mipmap
> streaming driven by camera distance (`TextureStreaming`), and a
> dev-time file watcher with debounced reload (`HotReloader`).

---

## Overview

```
                    Loaders/AssetManager (promise cache by format+source)
                                  │
                                  ▼
                          AssetLoader.load(url, type)
                                  │
                                  ├── AssetCache<V>          (LRU instance cache by url)
                                  │     get / set / has / delete / setMaxSize
                                  │
                                  ├── AssetLoader.loadAsync(entries) → AssetBatchResult
                                  │     Promise.allSettled — single failure does not block
                                  │
                                  └── AssetLoader.prewarm / prefetch → forwards to AssetManager


  AssetRegistry (reference-counted instance registry by id)
       │
       ├── register(id, type, data, url?) → AssetHandle<T>     (refCount = 1)
       ├── addRef(id) → number                                  (refCount + 1)
       ├── release(id) / unload(id) → number                    (refCount - 1, unload at 0)
       └── onUnload(id, handle)                                 (caller-supplied dispose)


  AssetBundle (coarse-grained package loader)
       │
       ├── createBundle(name, assets[]) / registerBundle(name, manifest, deps?)
       ├── loadBundle(name) / unloadBundle(name)               (maxConcurrentLoads gate)
       ├── getAsset(name, assetName) / isLoaded(name)
       └── Stats: registeredBundles / loadedBundles / cacheSize / totalLoadedBytes


  TextureStreaming (per-texture mip scheduling)
       │
       ├── registerTexture(config) → StreamingTexture
       ├── requestMipLevel(id, level)                          (calls onLoadMip callback)
       ├── update(camera)                                       (recompute desired mip by distance)
       └── evict()                                              (LRU by priority + lastUsed)


  HotReloader (dev-time file watcher)
       │
       ├── addWatch(path, callback) / removeWatch(path)
       ├── registerResource(path, type, data)                  (LoadedResource record)
       ├── startWatching() / stopWatching()
       ├── update(dt)                                           (polls mtime, debounces, dispatches)
       └── saveState(path, state) / restoreState(path)          (Memento pattern)
```

The module is intentionally layered: each class has a single
responsibility and can be used standalone. `AssetLoader` composes
`AssetManager` + `AssetCache`; `AssetBundle` composes coarse-grained
loading on top of either; `TextureStreaming` and `HotReloader` are
orthogonal schedulers that observe loaded resources and react to runtime
conditions.

---

## Core Classes

### `AssetCache<V>` (`AssetCache.ts`)

| Export | Role |
|--------|------|
| `AssetCache<V>` | Synchronous LRU cache of resource *instances* (not promises). Backed by `Map<string, V>` plus an `_accessOrder: string[]` tracking recency. `maxSize` entries (0 = unlimited). |
| `AssetCacheOptions` | `{ maxSize?: number }` (default 64). |

```ts
class AssetCache<V> {
  maxSize: number;
  get(key: string): V | undefined;       // refreshes access order
  set(key: string, value: V): this;       // inserts + evicts if over capacity
  has(key: string): boolean;              // read-only, does NOT touch order
  delete(key: string): boolean;
  clear(): void;
  get size(): number;
  setMaxSize(newMax: number): void;       // shrinks immediately if needed
}
```

LRU policy: `get` and `set` move the key to the tail of `_accessOrder`;
eviction pops from the head (least-recently-used). The cache does **not**
own resource disposal — callers must release GPU / JS resources before
`delete` or `clear`.

### `AssetRegistry` (`AssetRegistry.ts`)

| Export | Role |
|--------|------|
| `AssetRegistry` | Reference-counted registry of *already-loaded* resources shared across modules. `register` returns an `AssetHandle<T>` with `refCount = 1`; `addRef` / `release` / `unload` increment / decrement. When `refCount` hits 0 the optional `onUnload(id, handle)` callback fires and the entry is moved to the unloaded set. |
| `AssetHandle<T>` | `{ id, type, data, url, loaded, error }`. `data` is the engine object (Texture / Geometry / Material / ...). |
| `AssetType` | `string` alias (semantic: 'texture' / 'geometry' / 'material' / 'gltf' / ...). |
| `AssetRegistryOptions` | `{ onUnload?: (id, handle) => void }`. |
| `AssetRegistryStats` | `{ loaded, unloaded, total, activeRefs }`. |
| `getDefaultAssetRegistry()` / `resetDefaultAssetRegistry()` | Process-level singleton + test reset. |

```ts
class AssetRegistry {
  register<T>(id: string, type: AssetType, data: T, url?: string | null): AssetHandle<T>;
  markError(id: string, error: Error): void;
  get<T>(id: string): AssetHandle<T> | undefined;
  has(id: string): boolean;               // true only if loaded
  addRef(id: string): number;             // 0 if not registered
  release(id: string): number;            // alias of unload
  unload(id: string): number;             // decrement, unload at 0
  refCount(id: string): number;
  getStats(): AssetRegistryStats;
  clear(): void;                          // does NOT fire onUnload
}
```

`release` and `unload` are intentionally aliases — both decrement the
ref count. Re-registering an existing `id` overrides the previous entry
(emits a warning, does not fire `onUnload` for the old handle — the
caller is responsible for the previous `data`).

### `AssetLoader` (`AssetLoader.ts`)

| Export | Role |
|--------|------|
| `AssetLoader` | Async loader composing `AssetManager` (promise cache) + `AssetCache` (instance cache). `load(url, type)` checks the instance cache first, then falls through to `AssetManager.load`. Convenience methods `loadTexture` / `loadGeometry` / `loadGLTF` pre-set the type. |
| `AssetLoadEntry` | `{ url, type }` for batch loads. |
| `AssetBatchResult<T>` | `{ results: Map<url, T>, errors: Map<url, Error>, loaded, failed }`. |

```ts
class AssetLoader {
  readonly assetManager: AssetManager;
  readonly instanceCache: AssetCache<unknown>;
  registerLoader<T>(type: string, loader: Loader<T>): void;
  load<T>(url: string, type: string, ctx?: LoaderContext): Promise<T>;
  loadAsync<T>(urls: AssetLoadEntry[]): Promise<AssetBatchResult<T>>;
  loadTexture<T>(url: string, ctx?): Promise<T>;
  loadGeometry<T>(url: string, ctx?): Promise<T>;
  loadGLTF<T>(url: string, ctx?): Promise<T>;
  getCached<T>(url: string): T | undefined;
  invalidate(url: string): void;          // clears both caches
  has(url: string): boolean;              // instance layer
  size(): number;
  clearInstanceCache(): void;
  prewarm(entries: PrewarmEntry[]): Promise<{ loaded: number; failed: number }>;
  prefetch(source: AssetSource, type: string, ctx?): Promise<void>;
}
```

`loadAsync` uses `Promise.allSettled` so one failed URL never aborts the
batch. `invalidate(url)` clears both the `AssetManager` promise entry and
the `AssetCache` instance entry, forcing the next `load` to re-fetch and
re-parse.

### `AssetBundle` (`AssetBundle.ts`)

| Export | Role |
|--------|------|
| `AssetBundle` | Coarse-grained package loader (Unity AssetBundle / O3DE Asset Seed style). Manages named bundles with manifests, dependency declarations, concurrency-limited loading, and unload. Actual fetch / decode is delegated to a caller-supplied `loader?: (name) => Promise<Map<string, unknown>>` so the class stays free of I/O coupling. |
| `AssetEntry` | `{ name, type, size, hash }` — one resource inside a bundle. |
| `AssetManifest` | `{ assets, totalSize, version, checksum }`. |
| `AssetBundleEntry` | `{ name, manifest, dependencies, isLoaded, data }`. |
| `AssetBundleOptions` | `{ maxConcurrentLoads?, compressionEnabled?, loader? }`. |
| `BundleInfo` | Read-only public view: `{ name, version, assetCount, totalSize, checksum, isLoaded, dependencies }`. |
| `LoadingProgress` | `{ queued, active, completed, ratio }`. |
| `AssetBundleStats` | `{ registeredBundles, loadedBundles, activeLoads, queueLength, cacheSize, totalAssets, totalLoadedBytes }`. |

```ts
class AssetBundle {
  createBundle(name: string, assets: AssetEntry[]): AssetManifest;
  registerBundle(name: string, manifest: AssetManifest, dependencies?: string[]): void;
  loadBundle(name: string): Promise<boolean>;          // resolves deps first
  unloadBundle(name: string): boolean;
  getAsset<T>(bundleName: string, assetName: string): T | undefined;
  getBundleInfo(name: string): BundleInfo | undefined;
  isLoaded(name: string): boolean;
  getProgress(): LoadingProgress;
  getStats(): AssetBundleStats;
  clear(): void;
}
```

`loadBundle` resolves dependencies depth-first before loading the bundle
itself. Concurrency is gated by `maxConcurrentLoads` (simple counter +
queue). The class only manages manifest + state + loaded `data` map; it
does not perform fetch / decode — that is the caller's job via the
`loader` option or external wiring.

### `TextureStreaming` (`TextureStreaming.ts`)

| Export | Role |
|--------|------|
| `TextureStreaming` | Per-texture mip-level scheduler. For large scenes with many high-resolution textures, decides which mip level each texture should have resident based on camera distance / screen footprint, and evicts low-priority textures when `maxMemoryUsage` is exceeded. |
| `StreamingTexture` | Per-texture state: `{ id, url, baseTexture, mipLevels, loadedMips, priority, lastUsed, size, format, width, height, position }`. |
| `StreamingTextureConfig` | Registration config (url / mipLevels / size / width / height / priority / position / ...). |
| `TextureStreamingOptions` | `{ maxMemoryUsage?, camera?, loadMip?, unloadMip? }`. |
| `LoadMipCallback` / `UnloadMipCallback` | Caller-injected decode / GL-release hooks. |
| `TextureStreamingStats` | `{ registeredTextures, loadedMips, currentMemoryUsage, maxMemoryUsage, evictions }`. |

```ts
class TextureStreaming {
  registerTexture(config: StreamingTextureConfig): StreamingTexture;
  unregisterTexture(id: string): boolean;
  requestMipLevel(id: string, level: number): void;    // invokes onLoadMip
  update(camera?: Camera): void;                         // recompute desired mip
  getTexture(id: string): Texture | null;
  getStats(): TextureStreamingStats;
  evict(): void;                                         // LRU by priority + lastUsed
}
```

`update(camera)` walks all registered textures, computes the desired mip
level from distance (or screen footprint when a `position` is set), and
calls `onLoadMip` / `onUnloadMip` to bring each texture to that level.
`currentMemoryUsage` reflects the sum of declared `size` values for
resident textures; `evict` drops the lowest-priority / oldest textures
until usage fits `maxMemoryUsage`.

### `HotReloader` (`HotReloader.ts`)

| Export | Role |
|--------|------|
| `HotReloader` | Dev-time file watcher. Polls `fs.stat` mtimes (cross-platform, no OS handle needed), debounces bursts into a single reload, dispatches per-path callbacks, and provides a Memento-style `saveState` / `restoreState` so callers can preserve scene state across reloads. |
| `FileWatcher` | `{ path, lastModified, callback }`. |
| `LoadedResource` | `{ path, type, data, lastReload, reloadCount }`. |
| `PendingReload` | `{ path, triggeredAt }` — queued by `checkChanges`, drained by `update`. |
| `HotReloaderStats` | `{ watchCount, loadedResourceCount, isWatching, debounceTime, pendingCount, totalReloads, lastReloadAt }`. |
| `getDefaultHotReloader()` / `resetDefaultHotReloader()` | Process-level singleton + test reset. |

```ts
class HotReloader {
  addWatch(path: string, callback: (path: string) => void): void;
  removeWatch(path: string): boolean;
  registerResource(path: string, type: string, data: unknown): void;
  startWatching(): void;
  stopWatching(): void;
  update(dt: number): void;                              // main-loop entry
  checkChanges(): number;                                // polls mtime
  reloadResource(path: string): boolean;
  saveState(path: string, state: unknown): void;
  restoreState(path: string): unknown | undefined;
  getStats(): HotReloaderStats;
}
```

`debounceTime` (default 100 ms) aggregates rapid successive writes to the
same path into one reload. `update(dt)` is the main-loop entry: it
checks mtimes (when `isWatching`), pushes newly-changed paths onto
`pendingReloads`, and fires reload callbacks for entries whose debounce
window has elapsed. The class is Node / Electron friendly; browser
builds must inject a fetch / stat adapter.

---

## Usage Example

### Reference-counted shared texture

```ts
import { AssetRegistry, getDefaultAssetRegistry } from '@vreen/engine/assets';
import { TextureLoader } from '@vreen/engine/loaders';

const reg = getDefaultAssetRegistry({
  onUnload: (id, handle) => {
    (handle.data as Texture).dispose();
  },
});

async function loadShared(url: string) {
  if (reg.has(url)) {
    reg.addRef(url);
    return reg.get<Texture>(url)!.data;
  }
  const tex = await new TextureLoader().load(url);
  reg.register(url, 'texture', tex, url);
  return tex;
}

function releaseShared(url: string) {
  reg.release(url); // refCount 0 → onUnload disposes the Texture
}
```

### Batch-loading a level

```ts
import { AssetLoader } from '@vreen/engine/assets';
import { GLBLoader, TextureLoader } from '@vreen/engine/loaders';

const loader = new AssetLoader({ cacheMaxSize: 128 });
loader.registerLoader('gltf', new GLBLoader());
loader.registerLoader('texture', new TextureLoader());

const batch = await loader.loadAsync([
  { url: 'level.glb', type: 'gltf' },
  { url: 'sky.png', type: 'texture' },
  { url: 'grass.png', type: 'texture' },
]);
console.log(`loaded=${batch.loaded} failed=${batch.failed}`);
for (const [url, err] of batch.errors) console.error(url, err);
```

### Asset bundle with dependencies

```ts
import { AssetBundle } from '@vreen/engine/assets';

const ab = new AssetBundle({
  maxConcurrentLoads: 4,
  loader: async (name) => fetch(`/bundles/${name}.bin`).then((r) => r.json()),
});

ab.createBundle('shared-textures', [
  { name: 'grass', type: 'texture', size: 2048, hash: 'a1' },
  { name: 'stone', type: 'texture', size: 4096, hash: 'b2' },
]);
ab.registerBundle('level-1', ab.createBundle('level-1', [
  { name: 'mesh',  type: 'mesh',     size: 8192, hash: 'c3' },
  { name: 'audio', type: 'audio',    size: 1024, hash: 'd4' },
]), ['shared-textures']);

await ab.loadBundle('level-1');              // loads shared-textures first
const mesh = ab.getAsset('level-1', 'mesh');
```

### Texture streaming driven by camera

```ts
import { TextureStreaming } from '@vreen/engine/assets';

const ts = new TextureStreaming({
  maxMemoryUsage: 256 * 1024 * 1024,         // 256 MB
  camera,
  loadMip: (id, level, tex) => { /* fetch + decode + texImage2D */ },
  unloadMip: (id, level, tex) => { /* GL.freeTextureLevel */ },
});

ts.registerTexture({
  url: 'terrain/rock_4k.ktx2',
  mipLevels: 12,
  size: 21 * 1024 * 1024,
  width: 4096, height: 4096,
  format: 'bc7',
  priority: 1.0,
  position: { x: 100, y: 0, z: -50 },
});

function frame(dt: number) {
  ts.update(camera);   // (un)loads mips based on distance
  ts.evict();          // enforces maxMemoryUsage
}
```

### Hot reload during development

```ts
import { getDefaultHotReloader } from '@vreen/engine/assets';

const hr = getDefaultHotReloader();
hr.addWatch('/assets/tex.png', async (path) => {
  const fresh = await new TextureLoader().load(path);
  hr.registerResource(path, 'texture', fresh);
  // ...apply fresh to material...
});
hr.saveState('/assets/tex.png', { uvOffset: 0.25 });
hr.startWatching();
// In main loop:
hr.update(dt);
const state = hr.restoreState('/assets/tex.png'); // { uvOffset: 0.25 }
```

---

## Invariants

- **Layered caches.** `AssetCache` holds *parsed instances*; `AssetManager`
  holds *parse promises*. `AssetLoader` composes both; `invalidate(url)`
  must clear both to force a re-fetch.
- **Reference semantics.** `AssetRegistry.register` starts at
  `refCount = 1`. Every `addRef` must be paired with a `release` / `unload`
  to avoid leaks; reaching 0 fires `onUnload` exactly once.
- **`release` ≡ `unload`.** Both decrement the ref count; there is no
  semantic difference.
- **No I/O in `AssetBundle`.** The class manages manifest + state + loaded
  `data` only. Fetch / decode must be injected via the `loader` option
  or performed by the caller between `registerBundle` and `getAsset`.
- **Streaming bounds.** `TextureStreaming.currentMemoryUsage` equals the
  sum of declared `size` for all resident textures; `evict` enforces
  `maxMemoryUsage` by dropping lowest-priority / oldest entries first.
  `loadedMips ∈ [0, mipLevels]` for every `StreamingTexture`.
- **Debounce is monotonic.** `HotReloader` aggregates rapid writes within
  `debounceTime` into one reload; `update(dt)` only fires callbacks for
  pending reloads whose age exceeds the debounce window.
- **No GL coupling.** None of these classes touch WebGL directly. GPU
  disposal is the caller's responsibility (typically via the
  `AssetRegistry.onUnload` callback or the `TextureStreaming.unloadMip`
  hook).
- **Single-threaded.** All classes use synchronous `Map` / `Set` / array
  operations; no locks. Designed for the main JS event loop.

---

## Design Notes

**Why three layers (`AssetManager` / `AssetCache` / `AssetRegistry`)?**
Each layer solves a different problem. `AssetManager` deduplicates
in-flight parse promises (so two concurrent `load('hero.glb')` calls
parse once). `AssetCache` provides synchronous instance lookup by URL
(so a hot loop doesn't await). `AssetRegistry` tracks *who* owns a
shared resource so it can be freed when the last consumer releases it.
Collapsing them into one class would either entangle parsing with
lifetime or lose one of the three properties.

**Why `AssetBundle` on top of `AssetLoader`?** `AssetLoader` is
URL-granular and fine for ad-hoc loads. Real scenes ship as packages —
"the player bundle", "level-2 bundle" — with dependency edges and a
single load / unload lifecycle. `AssetBundle` encodes that coarse
granularity: one manifest, one concurrency budget, one unload call that
frees every asset in the bundle. It delegates the actual I/O so the
engine stays free of transport assumptions.

**Why polling in `HotReloader`?** `fs.watch` is inconsistent across
platforms (and missing in some browser / sandboxed contexts). Polling
`stat.mtimeMs` is portable and predictable; the cost (a syscall per
watched file per `update`) is acceptable for dev-time watch counts in
the low hundreds. The `debounceTime` window absorbs editor save storms.

**Why is `TextureStreaming` not part of the renderer?** Streaming is a
resource-management decision (which mips are resident), not a rendering
decision (how to sample them). Keeping it in `Assets/` lets the
renderer stay focused on draw commands while the streaming system
reacts to camera movement and memory pressure independently.

---

## References

- `Loaders/` module — `AssetManager`, `Loader<T>`, `AssetSource`
- `Renderer/` module — `Texture.version` bump triggers re-upload
- `Core/Texture` — `Texture` / `TextureImage` / `compressedLevels`
- Unity AssetBundle docs — https://docs.unity3d.com/Manual/AssetBundlesIntro.html
- O3DE Asset Seed — https://www.o3de.org/docs/user-guide/assets/
- Mipmap streaming (UE) — https://dev.epicgames.com/documentation/en-us/unreal-engine/texture-streaming-in-unreal-engine
- Vite HMR API — https://vitejs.dev/guide/api-hmr.html
- Webpack DevServer — https://webpack.js.org/configuration/dev-server/
