# SaveSystem Module

> Path: `src/engine/SaveSystem/`
>
> The persistence subsystem of the `@vreen/engine` kernel. Provides a
> multi-slot save manager (`SaveSystem`) that serialises a `Scene` plus
> its ECS `World` and arbitrary metadata into a compressed string,
> persists it through a swappable `StorageAdapter` (default
> `LocalStorageAdapter`, with an in-memory fallback for Node / tests),
> and schedules automatic saves on a fixed interval.

---

## Overview

```
SaveSystem                            ← multi-slot manager + autosave loop
   ├── slots: Map<slotId, SaveSlot>      ← in-memory cache, source of truth
   ├── save / load / deleteSlot          ← synchronous mutate + persist
   ├── exportSlot / importSlot           ← JSON envelope for migration
   ├── enableAutoSave / update(dt)       ← interval-driven AUTO_SAVE_SLOT
   └── delegates to ↓
          │
          ▼
SaveSerializer (static)               ← Scene + World + metadata ↔ SaveData
   ├── serialize(scene, world, metadata) → SaveData (POJO)
   ├── deserialize(SaveData, opts)       → { scene, world }
   ├── compress(SaveData)               → base64 (zlib + base64)
   └── decompress(string)                → SaveData
          │
          ▼
SceneSerializer                       ← Scene ↔ SceneJSON (delegated)
   └── GeometrySerializer / MaterialSerializer
          │
          ▼
StorageAdapter (interface)           ← pluggable persistence contract
   └── LocalStorageAdapter               ← prefix-scoped localStorage
          ├── window.localStorage        ← browser
          └── MemoryStorageBackend        ← Node / vitest fallback
```

Three layers, each with a single responsibility:

- **`SaveSerializer`** — pure (de)serialisation + compression. No I/O.
  Builds a `SaveData` POJO by calling `SceneSerializer.serialize` and
  `World.toJSON`; compression goes through fflate's `zlibSync` and a
  base64 wrapper.
- **`LocalStorageAdapter`** — string key-value storage with a forced key
  prefix. Picks `window.localStorage` when present, otherwise
  `MemoryStorageBackend`. The `clear()` method walks keys and removes
  only those matching the prefix, so it never clobbers unrelated data.
- **`SaveSystem`** — the orchestrator. Holds the slot map, drives the
  autosave accumulator, and writes each slot through the injected
  `StorageAdapter`.

---

## Core Classes

### `SaveSerializer` (`SaveSerializer.ts`)

Static, stateless, concurrency-safe.

| Export | Role |
|--------|------|
| `SaveSerializer.serialize(scene, world, metadata?)` | Builds a `SaveData` POJO via `SceneSerializer.serialize` + `World.toJSON`. |
| `SaveSerializer.deserialize(json, opts?)` | Rebuilds `{ scene, world }`. `SceneSerializer.deserialize` rebuilds the scene; `World.loadJSON` rebuilds entities + components (requires `componentRegistry`). |
| `SaveSerializer.compress(data)` | `JSON.stringify` → UTF-8 → `zlibSync` → base64. |
| `SaveSerializer.decompress(s)` | base64 → `unzlibSync` → UTF-8 → `JSON.parse`. Throws on missing `scene` or `world`. |
| `SaveData` | `{ scene: SceneJSON; world: WorldJson; metadata: Record<string, unknown> }`. |
| `SaveDeserializeOptions` | `componentRegistry?` (for `World.loadJSON`); `sceneContext?` (texture / geometry loaders). |
| `SAVE_SERIALIZER_VERSION` | `'1.0.0'`. |

```ts
export interface SaveData {
  scene: SceneJSON;
  world: WorldJson;
  metadata: Record<string, unknown>;
}
```

Without a `componentRegistry`, `World.loadJSON` is still called with an
empty registry — entities + scene-node TRS are rebuilt but per-component
POJOs are dropped and a warning is logged. The caller can rehydrate
components later with a second `world.loadJSON(json.world, registry)`
call.

### `LocalStorageAdapter` (`LocalStorageAdapter.ts`)

| Export | Role |
|--------|------|
| `StorageAdapter` | Interface — `save(key, data)` / `load(key)` / `remove(key)` / `exists(key)` / `clear()`. |
| `StorageBackend` | Interface — the underlying `localStorage` subset: `setItem` / `getItem` / `removeItem` / `clear`. |
| `LocalStorageAdapter` | Adapter that prefixes every key with `prefix` (default `'vreen:save:'`) and delegates to a `StorageBackend`. |
| `MemoryStorageBackend` | In-memory `Map`-backed `StorageBackend` with `length` + `key(i)` for full `localStorage` API parity. |
| `LocalStorageAdapterOptions` | `prefix?` / `backend?`. |

```ts
export interface StorageAdapter {
  save(key: string, data: string): void;
  load(key: string): string | null;
  remove(key: string): void;
  exists(key: string): boolean;
  clear(): void;
}
```

Backend selection: `LocalStorageAdapter` picks `globalThis.localStorage`
when present; otherwise it constructs a `MemoryStorageBackend` and emits
a warning. The adapter exposes its backend via the read-only `backend`
getter so tests can inspect what was actually written.

`clear()` is prefix-scoped. For browser `localStorage` (which exposes
`length` + `key(i)`), the adapter enumerates keys, filters by prefix, and
removes them one by one — it never calls `backend.clear()` because that
would wipe other modules' data. For `MemoryStorageBackend` the fast
`clear()` path is used since the backend is private to this adapter.

### `SaveSystem` (`SaveSystem.ts`)

| Export | Role |
|--------|------|
| `SaveSystem` | Multi-slot orchestrator. Holds `slots: Map<slotId, SaveSlot>` and drives autosave via `update(dt)`. |
| `SaveSlot` | `{ id, name, timestamp, data: SaveData, thumbnail? }`. |
| `SaveSystemOptions` | `maxSlots?` (default 20) / `storage?` (default `LocalStorageAdapter`) / `autoSaveInterval?` (seconds, default 60) / `componentRegistry?`. |
| `AutoSaveSource` | `() => { scene, world, name?, thumbnail? } \| null`. Returning `null` skips this tick. |
| `AUTO_SAVE_SLOT_ID` | `'__auto__'` — the slot id written by autosave. |

Public API surface:

| Method | Behaviour |
|--------|-----------|
| `save(slotId, name, scene, world, thumbnail?)` | Serialise + persist. Overwrites if `slotId` exists; throws if slot count is at `maxSlots` and `slotId` is new. |
| `load(slotId, opts?)` | Returns `{ scene, world }` or `null` if the slot is missing. Falls back to `this.componentRegistry` when `opts.componentRegistry` is absent. |
| `deleteSlot(slotId)` | Removes the slot from memory and storage. Returns whether a slot was actually deleted. |
| `getSlot(slotId)` | Returns the `SaveSlot` (no deserialisation). |
| `getSlots()` | All slots, newest first by `timestamp`. |
| `exportSlot(slotId)` | Returns a JSON string envelope `{ version: '1.0.0', slot }` for cross-instance migration / file download. |
| `importSlot(json, newSlotId?)` | Parses the envelope, re-keys to `newSlotId` (or the envelope id), persists. Throws on invalid JSON, missing `slot.data`, or slot limit reached. |
| `enableAutoSave(interval?, source?)` | Turns autosave on; resets the accumulator. |
| `disableAutoSave()` | Turns autosave off; resets the accumulator. |
| `setAutoSaveSource(source \| null)` | Swaps the source without toggling autosave. |
| `update(dt)` | Accumulates `dt` (seconds); on reaching `autoSaveInterval`, calls the source and saves to `AUTO_SAVE_SLOT_ID`. Swallows save errors (logs them) so the game loop is not interrupted. |

Persistence layout (per slot):

```
key:   "<prefix>slot:<slotId>"
value: JSON.stringify({
  meta: { id, name, timestamp, hasThumbnail },
  data: <base64-compressed SaveData>,
  thumbnail?: <dataURL>     // omitted when absent
})
```

`meta` is stored alongside the compressed payload so a future
`enumerateSlots` helper could read slot metadata without decompressing
every entry.

---

## Usage

### Basic save / load round-trip

```ts
import { SaveSystem } from '@vreen/engine/savesystem';
import { Scene } from '@vreen/engine/core';
import { World } from '@vreen/engine/ecs';

const saves = new SaveSystem({
  maxSlots: 20,
  autoSaveInterval: 60,
  componentRegistry, // optional; enables World component rehydration
});

const scene = new Scene();
const world = new World({ name: 'Level1' });
// ...populate scene + world...

saves.save('slot-1', 'First Boss Down', scene, world, thumbnailDataUrl);

const restored = saves.load('slot-1');
if (restored) {
  // restored.scene is a fresh Scene; restored.world is a fresh World
  renderer.replaceScene(restored.scene);
}
```

### Autosave wired into the main loop

```ts
const saves = new SaveSystem({ autoSaveInterval: 30 });

saves.setAutoSaveSource(() => {
  if (gameOver) return null; // stop autosaving post-game
  return {
    scene: currentScene,
    world: currentWorld,
    name: `Auto @ ${new Date().toISOString()}`,
    thumbnail: captureThumbnail(),
  };
});
saves.enableAutoSave();

function frame(dt: number) {
  gameLogic.update(dt);
  saves.update(dt); // triggers a save every 30 seconds of real time
  renderer.render(currentScene, camera);
}
```

### Cross-instance migration via export / import

```ts
// On the source device:
const json = saves.exportSlot('slot-1');
downloadFile('save.json', json);

// On the target device:
const json = await readFile('save.json');
saves.importSlot(json, 'slot-1-imported'); // re-keyed to avoid collisions
const loaded = saves.load('slot-1-imported');
```

### Custom storage backend (IndexedDB shim)

```ts
import { SaveSystem, type StorageAdapter } from '@vreen/engine/savesystem';

class IdbAdapter implements StorageAdapter {
  // ...implement save/load/remove/exists/clear against IndexedDB...
}

const saves = new SaveSystem({ storage: new IdbAdapter() });
```

### In-memory backend for tests

```ts
import { SaveSystem, LocalStorageAdapter, MemoryStorageBackend } from '@vreen/engine/savesystem';

const backend = new MemoryStorageBackend();
const storage = new LocalStorageAdapter({ backend, prefix: 'test:' });
const saves = new SaveSystem({ storage });

saves.save('s1', 'test', scene, world);
// backend.getItem('test:slot:s1') returns the compressed envelope
```

---

## Invariants

- **Slot limit.** `slots.size <= maxSlots` always holds. New slots that
  would exceed the limit throw synchronously; overwriting an existing
  slot does not count against the limit.
- **Slot identity.** `slotId` is the map key and the storage key suffix.
  `SaveSlot.id` always equals the key passed to `save`.
- **Persistence synchronicity.** Every `save` / `importSlot` /
  `deleteSlot` writes through to `StorageAdapter` synchronously before
  returning. The autosave path is also synchronous inside `update`.
- **Autosave error isolation.** If the source throws or `save` throws
  during autosave, the error is logged and the accumulator is reset; the
  game loop is never broken by an autosave failure.
- **Compression determinism.** `SaveSerializer.compress` then
  `SaveSerializer.decompress` round-trips any `SaveData` exactly
  (modulo `metadata` being JSON-serialisable). Input `SaveData` is never
  mutated.
- **Component registry fallback.** `SaveSerializer.deserialize` always
  calls `World.loadJSON`, even with an empty registry — entities and
  scene-node TRS are rebuilt, component POJOs are dropped with a warning.
  A later `world.loadJSON(json.world, registry)` can rehydrate them.
- **Prefix hygiene.** `LocalStorageAdapter.clear()` only removes keys
  starting with `this.prefix`. It never calls `backend.clear()` when the
  backend exposes `length` + `key(i)` (browser `localStorage`); the
  fast path is used only for the private `MemoryStorageBackend`.
- **Backend independence.** `SaveSystem` only references
  `StorageAdapter`, never `localStorage` directly. Any `StorageAdapter`
  implementation (IndexedDB, FileSystem, remote) can be injected without
  touching `SaveSystem`.
- **Autosave accumulator.** `enableAutoSave` resets the accumulator to
  zero. `update(dt)` ignores non-positive `dt` to avoid negative drift.
  A source returning `null` skips the tick without resetting the
  accumulator.
- **Export envelope stability.** `exportSlot` wraps the slot in
  `{ version: '1.0.0', slot }`. `importSlot` accepts the same envelope;
  an envelope missing `slot.data` throws synchronously.
- **No commit on dispose.** `SaveSystem` has no `dispose` method —
  callers must flush pending autosaves explicitly by calling `save` if
  needed before tearing down.

---

## References

- `SaveSerializer.ts` — `SaveData` shape, zlib + base64 compression.
- `LocalStorageAdapter.ts` — `StorageAdapter` contract, prefix hygiene,
  `MemoryStorageBackend` fallback.
- `SaveSystem.ts` — slot orchestration, autosave accumulator, export /
  import envelope.
- Related: `src/engine/Serialization/SceneSerializer.ts` (delegated for
  `Scene` ↔ `SceneJSON`); `src/engine/ECS/World.ts` (`toJSON` /
  `loadJSON` + `ComponentRegistry` for component rehydration).
