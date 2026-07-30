# Network Module

> Path: `src/engine/Network/`
>
> The networking subsystem of the `@vreen/engine` kernel. Provides a
> server-authoritative synchronisation manager (`NetworkSync`) layered over
> a pluggable transport contract, a compact binary snapshot format with
> optional zlib compression, snapshot interpolation + extrapolation, a
> transport-agnostic pure-data state sync (`StateSync`) with delta
> compression, lag compensation for hit detection, and a session lifecycle
> manager (`NetworkSession`) for lobby / matchmaking / player slots.

---

## Overview

```
NetworkTransport (interface)
   ├── WebSocketTransport          ← browser WebSocket
   └── MockTransport                ← paired in-memory (tests)
NetworkSync                         ← server-authoritative sync manager
   ├── sendSnapshot() → Snapshot      ← server: serialise + broadcast
   ├── receiveSnapshot(buf)           ← client: parse + apply
   └── interpolate(dt)                ← client: prev/next buffer lerp
Snapshot                            ← binary payload (magic 'VSNP' v1)
NetworkLerp (static)                ← lerpPosition / lerpRotation / predict / reconcile
StateSync (transport-agnostic)      ← createSnapshot / packSnapshot (delta+compact) / interpolate
LagCompensation                     ← recordSnapshot / rewindTo / checkHit / restoreCurrent
NetworkSession                      ← lobby / slots / state machine
   states: lobby → loading → playing ⇄ paused → ended
```

Four cooperating layers:

- **`NetworkSync`** — high-level sync manager that owns the transport and
  entity registry, driving per-frame send (server) / interpolate (client).
- **`StateSync`** — transport-independent data layer for callers needing
  delta compression and number-id entities without `NetworkTransport`.
- **`LagCompensation`** — history buffer for hit validation: server rewinds
  to a client-reported timestamp, checks the hit, then restores.
- **`NetworkSession`** — session lifecycle (lobby / slots / kick / ban /
  state machine) emitting `SessionMessage`s through a single
  `onSendMessage` callback so the transport choice stays external.

---

## Core Classes

### Transport Layer

| Export | Role |
|--------|------|
| `NetworkTransport` | Interface — `connect` / `disconnect` / `send` / `onMessage` / `onConnect` / `onDisconnect` / `isConnected`. |
| `WebSocketTransport` | Browser `WebSocket` implementation. Sets `binaryType = 'arraybuffer'`; `connect(url)` resolves on open. |
| `MockTransport` | In-memory transport for tests. `MockTransport.pair(a, b)` wires two instances for synchronous bidirectional delivery. |

```ts
export interface NetworkTransport {
  connect(url: string): Promise<void>;
  disconnect(): void;
  send(data: ArrayBuffer | string): void;
  onMessage(cb: (data: ArrayBuffer | string) => void): void;
  onConnect(cb: () => void): void;
  onDisconnect(cb: () => void): void;
  isConnected(): boolean;
}
```

Callbacks are single-slot (a later registration overwrites an earlier one);
callers needing fan-out should wrap with an `EventBus`.

### Snapshot

| Export | Role |
|--------|------|
| `Snapshot` | Binary payload with `entities`, `timestamp`, `sequence`. `serialize()` → `ArrayBuffer`; `compress()` → zlib `Uint8Array`. |
| `SnapshotEntity` | Per-entity network view: `id` / `ownerId` / `position` / `rotation` / `velocity`. |
| `Snapshot.deserialize` | Static — validates `0x56534e50` ('VSNP') magic + version 1, throws on mismatch. |
| `Snapshot.decompress` | Static — inflate + deserialize. |

Binary layout (little-endian):

```
[4]  magic       0x56534e50 ('VSNP')
[1]  version     1
[4]  sequence    uint32
[8]  timestamp   float64 (ms, caller-defined time base)
[4]  entityCount uint32
per entity:
  [1]  idLen     uint8 (≤ 255 UTF-8 bytes)
  [n]  id        UTF-8
  [1]  ownerLen  uint8 (≤ 255)
  [n]  owner     UTF-8
  [12] position  3 × float32
  [16] rotation  4 × float32 (x, y, z, w)
  [12] velocity  3 × float32
```

### NetworkSync

| Export | Role |
|--------|------|
| `NetworkSync` | Server-authoritative sync manager. Owns transport + `entities: Map<id, NetworkEntity>`. Server broadcasts at `syncRate` Hz; client interpolates against a prev/next snapshot buffer. |
| `createNetworkEntity` | Factory — initialises `position`, `rotation`, `velocity`, plus `interpolatedPosition` / `interpolatedRotation` clones for the renderer. |
| `NetworkEntity` | Interface — `id` / `ownerId` / `position` / `rotation` / `velocity` / `lastUpdate` / `interpolated*`. |
| `NetworkSyncOptions` | `syncRate` (Hz, default 20), `interpolation` (default true), `interpolationDelay` (ms, default 100), `now` (clock injection). |

```ts
export interface NetworkEntity {
  id: string;
  ownerId: string;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  lastUpdate: number;
  interpolatedPosition: Vector3;
  interpolatedRotation: Quaternion;
}
```

Per-frame loop:

```
server:  update(dt) → accumulate dt → sendSnapshot() at 1/syncRate intervals
client:  update(dt) → interpolate(dt) → renderTime = now - interpolationDelay
                          → lerp prev/next snapshots, write interpolated*
```

The interpolation buffer is a sliding window — first packet seeds `prev`,
second packet fills `next`, subsequent packets slide `prev ← next` then
`next ← cur`. Extrapolation past `next` is intentionally disabled here;
use `NetworkLerp.predict` if forward projection is needed.

### NetworkLerp

| Export | Role |
|--------|------|
| `NetworkLerp.lerpPosition` | Linear position interpolation. Returns a new `Vector3`. |
| `NetworkLerp.lerpRotation` | Spherical rotation interpolation (`slerp`, shortest arc). |
| `NetworkLerp.predict` | Extrapolate `position + velocity * dt`, clamped to `maxSeconds` (default 0.2s). |
| `NetworkLerp.reconcinate` | Blend server-authoritative vs client-predicted `TransformState` by `blendFactor ∈ [0,1]` (0 = keep client, 1 = accept server). |
| `TransformState` | `{ position: Vector3; rotation: Quaternion }`. |

All methods are pure — they never mutate their inputs and return cloned
values.

### StateSync

| Export | Role |
|--------|------|
| `StateSync` | Pure-data sync layer. Number-id entities, delta compression, ring-buffered snapshots (default 20). |
| `createSyncEntity` | Factory — initialises TRS + `scale` + `velocity` + `dirty=true` + `properties` map. |
| `SyncEntity` | `id` (number) / `position` / `rotation` / `scale` / `velocity` / `dirty` / `lastUpdate` / `properties`. |
| `StateSnapshot` | `{ timestamp, entities: SyncEntity[] }`. |
| `PackedSnapshotData` | Compact form: `{ t, n, d }` where `d` is a flat 14-float array per entity. |
| `StateSyncOptions` | `isServer` / `maxSnapshots` / `interpolationDelay` / `maxExtrapolation` / `now`. |
| `StateSyncStats` | Snapshot of `localCount` / `remoteCount` / `snapshotCount` / `maxSnapshots` / `interpolationDelay` / `isServer`. |

Delta compression: `packSnapshot` only emits entities with `dirty=true`,
then clears the flag. Each entity encodes as
`[id, px,py,pz, rx,ry,rz,rw, sx,sy,sz, vx,vy,vz]` (14 floats) — roughly
half the size of the equivalent JSON object. `unpackSnapshot` is the
inverse; the caller then calls `applySnapshot` to merge into
`remoteEntities`.

Extrapolation: when `renderTime` exceeds the newest snapshot, the
`velocity` is integrated forward, clamped to `maxExtrapolation` seconds
(default 0.2s) to prevent runaway drift during packet loss.

### LagCompensation

| Export | Role |
|--------|------|
| `LagCompensation` | History buffer for hit validation. Server `rewindTo(ts)` → `checkHit(...)` → `restoreCurrent()`. |
| `createEntityState` | Factory — `id` / `position` / `rotation` / `velocity` / `timestamp`. |
| `EntityState` | Numbered entity state for history. |
| `HistoryEntry` | `{ timestamp, entityStates: Map<id, EntityState> }`. |
| `HitBounds` | Axis-aligned bounds — `{ center, halfExtents }`. |
| `LagCompensationOptions` | `isServer` / `maxHistorySize` (default 64) / `historyDuration` (ms, default 1000) / `interpolationDelay`. |
| `LagCompensationStats` | `historySize` / `maxHistorySize` / `historyDuration` / `oldestTimestamp` / `newestTimestamp` / `rewinding` / `entityCount`. |

The history buffer is kept ascending by `timestamp`; out-of-order
snapshots are discarded. `pruneOldEntries()` trims entries older than
`newest - historyDuration`.

### NetworkSession

| Export | Role |
|--------|------|
| `NetworkSession` | Lobby / slot / state-machine manager. Host-authoritative. Emits `SessionMessage`s via `onSendMessage`. |
| `SessionType` | `'host' \| 'client' \| 'listen-server'`. |
| `SessionGameState` | `'lobby' \| 'loading' \| 'playing' \| 'paused' \| 'ended'`. |
| `NetworkPlayer` | `id` / `name` / `isReady` / `isHost` / `ping` / `slot` / `isConnected` / `characterData?`. |
| `SessionConfig` | `sessionType` / `maxPlayers` / `localPlayerName` / `password` / `isPrivate` / `matchmakingEnabled` / `sessionId?` / `localPlayerId?`. |
| `SessionMessage` | `{ type, target, source, data, timestamp }`. `target` can be `'broadcast'` or `'host'`. |
| `SessionStats` | `sessionId` / `sessionType` / `gameState` / `maxPlayers` / `playerCount` / `readyCount` / `connectedCount` / `hostId` / `availableSlots`. |

State machine:

```
lobby → loading → playing ⇄ paused → ended
```

Host-only methods: `startGame` / `pauseGame` / `resumeGame` / `endGame` /
`kickPlayer` / `banPlayer` / `setMaxPlayers` / `setPassword` / `setPrivate` /
`enableMatchmaking` / `addRemotePlayer` / `removeRemotePlayer`. Calling any
of these as a client throws synchronously rather than silently failing.

---

## Usage

### Server-authoritative sync over WebSocket

```ts
import { NetworkSync, WebSocketTransport, createNetworkEntity } from '@vreen/engine/network';

const sync = new NetworkSync({ syncRate: 20, interpolationDelay: 100 });
const transport = new WebSocketTransport();

await transport.connect('wss://game.example.com/room');
sync.start(transport, true /* isServer */);

const enemy = createNetworkEntity('enemy-1', 'host', pos, rot, vel);
sync.registerEntity(enemy.id, enemy);

function frame(dt: number) {
  // server logic mutates enemy.position/velocity
  enemy.velocity.add(gravity.scale(dt));
  enemy.position.add(enemy.velocity.clone().scale(dt));
  sync.update(dt); // broadcasts a snapshot at 20 Hz
}
```

### Client interpolation + reconciliation

```ts
import { NetworkSync, WebSocketTransport, createNetworkEntity, NetworkLerp } from '@vreen/engine/network';

const sync = new NetworkSync({ interpolationDelay: 100 });
const transport = new WebSocketTransport();
await transport.connect('wss://game.example.com/room');
sync.start(transport, false /* isServer */);

const enemy = createNetworkEntity('enemy-1', 'host');
sync.registerEntity(enemy.id, enemy);

// Client-side predicted position (kept in a separate vector).
const predicted = enemy.position.clone();

function frame(dt: number) {
  // Apply local input prediction.
  enemy.velocity.add(inputForce.scale(dt));
  predicted.add(enemy.velocity.clone().scale(dt));

  sync.update(dt); // pulls authoritative pos/rot into enemy.position

  // Reconcile: blend 70% server authoritative, 30% keep prediction.
  const blended = NetworkLerp.reconcile(
    { position: enemy.position, rotation: enemy.rotation },
    { position: predicted, rotation: enemy.rotation },
    0.7,
  );
  predicted.copy(blended.position);

  // Render from interpolatedPosition (smoothed 100 ms in the past).
  renderMesh(enemy.interpolatedPosition, enemy.interpolatedRotation);
}
```

### Two-client mock test

```ts
import { MockTransport, NetworkSync, createNetworkEntity } from '@vreen/engine/network';

const serverTransport = new MockTransport('server');
const clientTransport = new MockTransport('client');
MockTransport.pair(serverTransport, clientTransport);

const server = new NetworkSync({ syncRate: 60 });
const client = new NetworkSync({ interpolationDelay: 50 });
server.start(serverTransport, true);
client.start(clientTransport, false);

const e = createNetworkEntity('box', 'host', new Vector3(0, 0, 0));
server.registerEntity('box', e);
client.registerEntity('box', createNetworkEntity('box', 'host'));

server.update(1 / 60);   // sends snapshot
client.update(1 / 60);   // applies + interpolates
```

### Delta-compressed state sync (transport-agnostic)

```ts
import { StateSync, createSyncEntity } from '@vreen/engine/network';

const server = new StateSync({ isServer: true, maxSnapshots: 20 });
const client = new StateSync({ isServer: false, interpolationDelay: 100 });

const e = createSyncEntity(1, pos, rot, scale, vel);
server.registerEntity(1, e);

// Server tick.
const snap = server.createSnapshot();
const packed = server.packSnapshot(snap); // { t, n, d } — emit only dirty
sendOverWire(JSON.stringify(packed));      // caller chooses transport

// Client tick.
const received = JSON.parse(msg);
const unpacked = client.unpackSnapshot(received);
client.applySnapshot(unpacked);
client.update(dt);
```

### Hit validation with lag compensation

```ts
import { LagCompensation, createEntityState, type EntityState } from '@vreen/engine/network';
import { Vector3 } from '@vreen/engine/math';

const lag = new LagCompensation({ isServer: true, historyDuration: 1000 });

// Server records authoritative state each tick.
function serverTick(now: number, states: Map<number, EntityState>) {
  lag.recordSnapshot(Array.from(states.values()), now);
  lag.pruneOldEntries();
}

// Client fired at t=1000, claiming the target was at (5, 0, 0).
function onShotFired(states: Map<number, EntityState>, clientTime: number) {
  const hit = lag.checkHit(
    states,
    clientTime,
    new Vector3(5, 0, 0),
    targetId,
    { center: new Vector3(5, 0, 0), halfExtents: new Vector3(0.5, 1, 0.5) },
  );
  // states is left untouched by checkHit.
  return hit;
}
```

### Session lifecycle

```ts
import { NetworkSession } from '@vreen/engine/network';

const host = new NetworkSession();
host.createSession({ sessionType: 'host', maxPlayers: 4 });
host.onSendMessage((msg) => transport.send(JSON.stringify(msg)));

host.startGame();              // lobby → loading → playing
host.pauseGame();              // playing → paused
host.resumeGame();             // paused → playing
host.endGame();                // → ended

const client = new NetworkSession();
client.joinSession('session-abc', 'optional-password');
client.setPlayerReady(client.localPlayerId, true);
```

---

## Invariants

- **Transport seam.** `NetworkSync` only depends on the `NetworkTransport`
  interface; `WebSocketTransport` and `MockTransport` are interchangeable
  implementations. Replacing the transport does not touch sync logic.
- **Server authority.** A `NetworkSync` started with `isServer=true`
  ignores inbound snapshots; it only broadcasts. A client started with
  `isServer=false` never broadcasts; it only consumes and interpolates.
- **Snapshot binary contract.** `Snapshot.serialize` throws if any
  `id` or `ownerId` exceeds 255 UTF-8 bytes. `Snapshot.deserialize` throws
  on magic mismatch (`0x56534e50`) or unsupported version (only `1`
  currently). `NetworkSync.receiveSnapshot` swallows parse errors and
  preserves the previously applied state.
- **Interpolation buffer ordering.** `StateSync.snapshots` and
  `LagCompensation.historyBuffer` are always ascending by `timestamp`;
  out-of-order packets are dropped on insert.
- **Extrapolation bounds.** Both `StateSync` and `LagCompensation`
  clamp forward projection to `maxExtrapolation` (default 0.2s) so
  packet loss cannot produce runaway drift.
- **NetworkLerp purity.** All `NetworkLerp` methods return new objects
  and never mutate their inputs. `t` / `blendFactor` are clamped to
  `[0,1]`.
- **StateSync delta.** `packSnapshot` only emits entities whose
  `dirty=true`, then clears the flag on both the snapshot clone and the
  source `localEntities` entry so the same change is not re-emitted.
- **LagCompensation rewind / restore pairing.** Every `rewindTo` call
  must be matched by a `restoreCurrent` call before the next `update`
  tick. `restoreCurrent` is a no-op if no rewind is in progress.
- **Session host authority.** Host-only methods on `NetworkSession`
  throw synchronously when called by a non-host client. `sessionId`
  and `localPlayerId` are immutable once assigned.
- **Session slot integrity.** `playerSlots.length === maxPlayers`. A
  player occupies exactly one slot; `setPlayerSlot` throws if the target
  slot is taken. `leaveSession` releases the local player's slot and,
  for host leave, transitions the session to `ended`.
- **Single-slot callbacks.** `NetworkTransport.onMessage`,
  `NetworkSession.onSendMessage`, and `NetworkSync`'s transport
  callbacks are single-slot — a later registration overwrites an earlier
  one. Callers needing fan-out should compose with an `EventBus`.
- **No clock assumption.** All time-based classes accept a `now?: () => number`
  injection so unit tests can drive deterministic timelines without
  relying on `performance.now`.

---

## References

- `Snapshot.ts` — binary layout, magic `0x56534e50`, deflate compression.
- `NetworkSync.ts` — server-authoritative send loop and prev/next
  interpolation buffer.
- `StateSync.ts` — transport-agnostic data layer with 14-float delta
  packing.
- `LagCompensation.ts` — history buffer, `rewindTo` / `restoreCurrent`
  contract, `checkHit` hit validation.
- `NetworkSession.ts` — lobby / slot / state machine and
  `SessionMessage` outbox.
- Related: `src/engine/Events/` (`EventBus`, `EventQueue`) for fan-out;
  `src/engine/ECS/World.ts` (`toJSON` / `loadJSON`) consumed by
  `SaveSerializer` for world serialisation.
