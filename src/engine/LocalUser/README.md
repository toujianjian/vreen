# LocalUser Module

> Path: `src/engine/LocalUser/`
>
> The local multi-user management subsystem of the `@vreen/engine` kernel.
> Provides `LocalUserProfile` (identity + settings + save partition),
> `LocalPlayerSlot` (a bounded slot with `empty` / `active` / `inactive`
> state bound to an input device and camera rig), and `LocalUserManager`
> (an N-slot manager with `join` / `leave` / `reactivate` /
> `findByDevice` / `setSetting` / `reset`). Designed for couch co-op and
> split-screen play where several players share one machine.

---

## Overview

The module models local multiplayer as a fixed array of slots. A device
(gamepad index, `'keyboard'`, `'keyboard2'`) joins an empty slot, which
becomes `active`. Leaving marks a slot `inactive` and clears its bindings
but keeps the slot reserved; `reactivate` rebinds a profile to an
inactive slot. The manager is the single source of truth for which
device drives which player and which camera rig renders them.

```
LocalUserManager (slotCount, clamped [1, 16])
   │
   └── slots: LocalPlayerSlot[]   ── index 0..N-1
           │
           │  state: 'empty' | 'active' | 'inactive'
           │
           ├── profile: LocalUserProfile | null
           │       ├── id, displayName
           │       ├── settings: Record<string, number | string | boolean>
           │       └── savePartition: `player_${id}`
           │
           ├── inputDeviceId: string | null   (gamepad idx / 'keyboard' / 'keyboard2')
           └── cameraRigIndex: number | null  (split-screen viewport)


   join(profile, device, rig?)     empty ─────────────────► active
   leave(slotIndex)                active ─────────────────► inactive (profile cleared)
   reactivate(slotIndex, prof, dev) inactive ──────────────► active
   reset()                         any ────────────────────► empty
```

The manager is intentionally device-agnostic: it stores device ids as
strings and never opens a gamepad itself. The `Input` module owns device
polling; `LocalUser` only records the binding so gameplay, audio, and
camera-rig systems can ask "who is on device X?".

---

## Core Classes

### Profile

| Export | Role |
|--------|------|
| `LocalUserProfile` | Interface: `id`, `displayName`, `settings` map, `savePartition` key. |
| `createProfile(id, displayName)` | Factory. `settings` starts empty; `savePartition` defaults to `` `player_${id}` `` for per-player save namespaces. |

```ts
export interface LocalUserProfile {
  id: string;
  displayName: string;
  settings: Record<string, number | string | boolean>;
  savePartition: string;
}
```

### Slot

| Export | Role |
|--------|------|
| `PlayerSlotState` | Type union: `'empty' | 'active' | 'inactive'`. |
| `LocalPlayerSlot` | Interface: `index`, `state`, `profile`, `inputDeviceId`, `cameraRigIndex`. |
| `createEmptySlot(index)` | Factory returning a slot in the `empty` state with null bindings. |

```ts
export type PlayerSlotState = 'empty' | 'active' | 'inactive';

export interface LocalPlayerSlot {
  index: number;                              // 0-based slot index
  state: PlayerSlotState;
  profile: LocalUserProfile | null;
  inputDeviceId: string | null;               // gamepad index, 'keyboard', 'keyboard2'
  cameraRigIndex: number | null;              // split-screen viewport
}
```

### Manager

| Export | Role |
|--------|------|
| `LocalUserManagerOptions` | Interface: `slotCount` (default 4, clamped to `[1, 16]`). |
| `LocalUserManager` | Owns `slots: LocalPlayerSlot[]`. Methods below. |

```ts
export class LocalUserManager {
  constructor(opts: Partial<LocalUserManagerOptions> = {});
  slots: LocalPlayerSlot[];

  join(profile: LocalUserProfile, inputDeviceId: string, cameraRigIndex?: number): number;
  leave(slotIndex: number): boolean;
  reactivate(slotIndex: number, profile: LocalUserProfile, inputDeviceId: string): boolean;
  findByDevice(inputDeviceId: string): LocalPlayerSlot | null;
  activeSlots(): LocalPlayerSlot[];
  getProfile(slotIndex: number): LocalUserProfile | null;
  setSetting(slotIndex: number, key: string, value: number | string | boolean): boolean;
  reset(): void;
}
```

Method semantics:

- **`join(profile, inputDeviceId, cameraRigIndex?)`** — assigns the first
  `empty` slot. Sets state to `active`, binds profile + device. If
  `cameraRigIndex` is omitted it defaults to `slot.index` (so each player
  gets a distinct viewport by default). Returns the slot index, or `-1`
  if no empty slot is available. Logs a warning on overflow.
- **`leave(slotIndex)`** — marks the slot `inactive` and clears `profile`,
  `inputDeviceId`, `cameraRigIndex`. Returns `false` if the index is out
  of range. The slot is **not** returned to `empty`; use `reactivate` to
  rebind or `reset` to clear all.
- **`reactivate(slotIndex, profile, inputDeviceId)`** — moves an
  `inactive` (or `empty`) slot to `active`. Refuses if the slot is
  already `active`. Does not set `cameraRigIndex`; call `join` instead
  for the initial binding, or mutate `slots[i].cameraRigIndex` directly.
- **`findByDevice(inputDeviceId)`** — returns the `active` slot bound to
  that device, or `null`. Inactive/empty slots are never matched, so a
  disconnected gamepad does not shadow a rejoined one.
- **`activeSlots()`** — all slots in the `active` state.
- **`getProfile(slotIndex)`** — the slot's profile or `null`.
- **`setSetting(slotIndex, key, value)`** — writes into
  `slot.profile.settings`. Returns `false` if the slot or profile is
  missing.
- **`reset()`** — returns every slot to `empty` with null bindings.

---

## Usage

### Couch co-op join flow

```ts
import { LocalUserManager, createProfile } from '@vreen/engine/localuser';

const users = new LocalUserManager({ slotCount: 4 });

// P1 on keyboard, gets camera rig 0 by default
const p1 = createProfile('p1', 'Alice');
const slot1 = users.join(p1, 'keyboard');
// slot1 === 0

// P2 on gamepad 0, force camera rig 1
const p2 = createProfile('p2', 'Bob');
const slot2 = users.join(p2, 'gamepad:0', 1);

// Per-player setting
users.setSetting(slot2, 'masterVolume', 0.8);

// Look up who is holding gamepad 0
const holder = users.findByDevice('gamepad:0');
console.log(holder?.profile.displayName); // 'Bob'

// Bob disconnects
users.leave(slot2); // slot 2 → 'inactive'

// Bob reconnects with the same gamepad
users.reactivate(slot2, p2, 'gamepad:0');

// End the session
users.reset();
```

### Split-screen camera binding

```ts
// Each active slot drives one camera rig; the SceneManager renders one
// viewport per active slot.
for (const slot of users.activeSlots()) {
  const rig = cameraRigs[slot.cameraRigIndex ?? slot.index];
  rig.target = avatars[slot.index];
  renderer.submitViewport(rig, slot.cameraRigIndex ?? slot.index);
}
```

### Per-player save partition

```ts
// savePartition namespaces save data so two local players don't collide.
import { SaveSystem } from '@vreen/engine';

for (const slot of users.activeSlots()) {
  const partition = slot.profile!.savePartition; // 'player_p1', 'player_p2', ...
  SaveSystem.save(partition, slot.profile!.settings);
}
```

---

## Invariants

- **Slot count is fixed at construction.** `slotCount` is clamped to
  `[1, 16]`; the `slots` array length never changes afterwards. There is
  no `addSlot` / `removeSlot`.
- **State machine is one-way per operation.** `join` only accepts an
  `empty` slot; `reactivate` refuses an `active` slot; `leave` targets
  any in-range slot. A slot never silently transitions more than one
  state per call.
- **`join` returns `-1` on overflow**, it does not throw. Callers must
  check the return value; the manager never evicts an existing player to
  make room.
- **`findByDevice` matches active slots only.** A device id is bound to
  at most one active slot at a time; `join` does not enforce uniqueness,
  so the caller is responsible for not double-binding a device.
- **`leave` clears the profile.** An `inactive` slot has `null` profile,
  `inputDeviceId`, and `cameraRigIndex`; `reactivate` must supply a fresh
  profile. The original profile object is dropped (not retained for
  "resume").
- **`getProfile` / `setSetting` are index-safe.** Out-of-range indices
  return `null` / `false` rather than throwing.
- **`reset` is total.** Every slot becomes `empty` regardless of prior
  state; there is no selective reset.
- **No device polling.** The manager stores device ids as opaque strings;
  it never touches the `Input` module, the DOM, or the Gamepad API.

---

## Design Notes

**Why `inactive` rather than returning to `empty`?** Couch co-op sessions
often have a player briefly drop a controller. Reserving the slot as
`inactive` lets the UI show "Player 2 — press Start to rejoin" and lets
`reactivate` rebind without re-allocating a slot index or camera rig. A
full `reset` is the explicit "tear down the session" path.

**Why clamp slots to 16?** Beyond 16 local players the split-screen
viewport math and input-device enumeration become impractical on a single
machine; networked multiplayer (the `Network` module) is the right
tool there. The clamp also bounds the slot array for tight loops.

**Why is `savePartition` on the profile?** Save isolation is a property
of the user identity, not the slot: a profile should always write to the
same partition regardless of which slot it occupies. Keeping the key on
the profile means a rejoining player resumes their own saves even if they
land in a different slot index.

**Why strings for `inputDeviceId`?** Gamepad indices are numbers, but
keyboard variants (`'keyboard'`, `'keyboard2'`) and future device kinds
are not. A uniform string space lets `findByDevice` compare any device
without a tagged union, at the cost of caller-defined formatting
conventions (e.g. `` `gamepad:${index}` ``).

---

## References

- o3de Gems/LocalUser — `LocalUserProfile`, `LocalPlayerSlot`,
  `LocalUserManager` design reference.
- `src/engine/Input/README.md` — input device polling that feeds
  `inputDeviceId`.
- `src/engine/SaveSystem/README.md` — per-partition save persistence
  keyed by `profile.savePartition`.
- `src/engine/Cameras/README.md` — `CameraRig` consumed via
  `slot.cameraRigIndex` for split-screen.
- Top-level barrel — `src/engine/index.ts` re-exports this module.
