# Timeline Module

> Path: `src/engine/Timeline/`
>
> The sequencer subsystem of the `@vreen/engine` kernel. Provides a
> small composable timeline model: `TimelineClip` (a time-bounded
> payload carrier), three track flavours (`TimelineTrack` for
> clip-based animation/audio, `EventTrack` for time-anchored
> `EventBus` triggers, `PropertyTrack` for keyframed property
> animation), and a `TimelineSequencer` that aggregates tracks with
> play / pause / stop / seek / loop / speed / export / import control.

---

## Overview

```
                            TimelineSequencer
                           ┌────────────────────────────────────┐
                           │ time · duration · loop · speed     │
                           │ isPlaying · lastTime · eventBus    │
                           └─┬────────┬────────┬────────────────┘
                             │        │        │  update(dt) advances head,
                  addTrack() │        │        │  dispatches to enabled tracks
                             ▼        ▼        ▼
                      TimelineTrack  EventTrack  PropertyTrack
                      ┌──────────┐  ┌─────────┐  ┌────────────┐
                      │ clips[]  │  │ events[]│  │ keyframes[]│
                      └────┬─────┘  └────┬────┘  └─────┬──────┘
                           │             │              │
                  contains(time)   getEventsBetween   evaluate(time)
                  getLocalTime()    (lastTime, time]   → write target[path]
                           │             │              │
                           ▼             ▼              ▼
                    clip.data.update  bus.emit(name)  target[prop] = value
```

Three track shapes coexist by design:

- **Clip-based** (`TimelineTrack`) — continuous payloads (animation
  actions, audio buffers) active over a `[start, end)` window. The
  track calls `clip.data.update(localTime, dt)` for every active clip;
  `data` is opaque to the track.
- **Event-based** (`EventTrack`) — discrete time-point triggers routed
  through `EventBus`. Detects the `(lastTime, time]` crossed interval
  so events fire exactly once per play-head pass, including loop
  wrap-around.
- **Property-based** (`PropertyTrack`) — keyframe sequences with
  `step` / `linear` interpolation, written back to `target[propertyPath]`
  via dotted-path resolution (`'position.x'`, `'material.color.r'`).

---

## Core Classes

### Clip

| Export | Role |
|--------|------|
| `TimelineClip` | A single time-bounded payload on a track. Carries `start` / `duration` / `speed` / `blendMode` / opaque `data`. Provides `contains(time)`, `getLocalTime(time)` and `toJSON()`. |

```ts
type TimelineClipBlendMode = 'none' | 'crossfade' | 'mix' | 'additive';
interface TimelineClipOptions {
  start: number; duration: number; name?: string;
  data?: unknown; blendMode?: TimelineClipBlendMode; speed?: number;
}
class TimelineClip {
  get end(): number;                        // start + duration
  contains(time: number): boolean;          // [start, end)
  getLocalTime(time: number): number;       // clamped to [0, duration], × speed
  clone(): TimelineClip;                    // shallow — caller deep-copies data
  toJSON(): TimelineClipOptions & { end: number };
}
```

The clip is blend-mode aware but does not implement blending itself;
`blendMode` is metadata consumed by the caller (e.g. an
`AnimationLayerMixer` reading overlapping clips).

### Tracks

| Export | Role |
|--------|------|
| `TimelineTrack` | Clip container. Keeps `clips` sorted by `start`; on `update(time, dt)` invokes `clip.data.update(localTime, dt)` for every active clip. `enabled=false` silences the track; `locked=true` is a UI hint. |
| `EventTrack` | Discrete event list. `trigger(time, lastTime, bus)` emits every `TimedEvent` crossed in `(lastTime, time]` via `EventBus.emit(eventName, data)`. Handles loop wrap-around by scanning two segments. |
| `PropertyTrack` | Keyframe sequence. `evaluate(time)` binary-searches the keyframes and interpolates (`step` or `linear`, per-keyframe); `update(time)` writes the result to `target[propertyPath]` through dotted-path resolution. |
| `createClips` | Factory: maps `TimelineClipOptions[]` → `TimelineClip[]`. |

```ts
type TimelineTrackType = 'animation' | 'event' | 'audio' | 'property';

// TimelineTrack
interface TimelineTrackOptions {
  name: string; type?: TimelineTrackType;
  clips?: TimelineClip[]; enabled?: boolean; locked?: boolean;
}
class TimelineTrack {
  addClip(clip): this;
  removeClip(clip): boolean;
  removeClipByName(name): number;
  getClipsAtTime(time): TimelineClip[];
  getDuration(): number;                    // max clip.end, 0 if empty
  update(time, dt): void;                   // calls clip.data.update for active clips
  toJSON(): { name, type, enabled, locked, clips };
}

// EventTrack
interface TimedEvent { time: number; eventName: string; data?: unknown; }
class EventTrack {
  addEvent(e): this; removeEvent(e): boolean; removeEventByName(name): number;
  getEventsBetween(lastTime, time): TimedEvent[];   // handles wrap-around
  trigger(time, lastTime, bus): number;             // returns fired count
  getDuration(): number;                            // last event time
  update(time, lastTime, bus): void;
  toJSON(): { name, kind: 'event', enabled, locked, events };
}

// PropertyTrack
type PropertyInterp = 'step' | 'linear';
interface Keyframe { time: number; value: number | Record<string, number>; interp?: PropertyInterp; }
class PropertyTrack {
  addKeyframe(kf): this; removeKeyframe(kf): boolean; addTarget(target): this;
  evaluate(time): number | Record<string, number> | null;
  getDuration(): number;                            // last keyframe time
  update(time): void;                               // evaluate + write target[path]
  toJSON(): { name, kind: 'property', propertyPath, enabled, locked, keyframes };
}
```

### Sequencer

| Export | Role |
|--------|------|
| `TimelineSequencer` | Aggregates `TrackLike[]` and drives playback. Exposes `play` / `pause` / `stop` / `seek`, per-frame `update(dt)` (advances `time` by `dt * speed`, handles loop wrap and auto-pause at `duration`), plus `export()` / `import()` for persistence. |

```ts
type TrackLike = TimelineTrack | EventTrack | PropertyTrack;
interface TimelineSequencerOptions {
  duration?: number; loop?: boolean; speed?: number; eventBus?: EventBus | null;
}
class TimelineSequencer {
  tracks: TrackLike[]; time: number; duration: number;
  isPlaying: boolean; loop: boolean; speed: number;
  eventBus: EventBus | null; lastTime: number;
  setEventBus(bus): this;
  play(): this; pause(): this; stop(): this; seek(time): this;
  addTrack(track): this; removeTrack(name): number; getTrack(name): TrackLike | null;
  getDuration(): number;                          // max(explicit, computed from tracks)
  update(dt): void;                               // advances head, dispatches tracks
  export(): TimelineSequencerJSON;
  import(json): this;
}
```

**Playback rules.** `update(dt)` is a no-op when `!isPlaying`. With
`loop=true`, crossing `duration` wraps `time %= duration` and the
sequencer invokes each track with `lastTime > time` so `EventTrack`
fires both the tail and head segments. With `loop=false`, reaching
`duration` clamps `time` and auto-pauses. `seek()` clamps to
`[0, duration]` and resets `lastTime` to suppress spurious event
triggers across the jump.

---

## Usage

### Multi-track cutscene

```ts
import {
  TimelineSequencer, TimelineTrack, TimelineClip,
  EventTrack, PropertyTrack,
} from '@vreen/engine/timeline';
import { EventBus } from '@vreen/engine/events';

const bus = new EventBus();
const seq = new TimelineSequencer({ duration: 6, loop: false, speed: 1, eventBus: bus });

// Animation track: clip.data is an AnimationAction-like object
const animTrack = new TimelineTrack({ name: 'anim', type: 'animation' });
animTrack.addClip(new TimelineClip({
  start: 0, duration: 3, name: 'walk',
  data: { update: (t, dt) => walkAction.update(t) },
}));
animTrack.addClip(new TimelineClip({
  start: 3, duration: 3, name: 'wave',
  data: { update: (t, dt) => waveAction.update(t) },
  blendMode: 'crossfade',
}));

// Event track: trigger audio + camera cues
const eventTrack = new EventTrack({ name: 'cues' });
eventTrack.addEvent({ time: 0.0, eventName: 'bgm:start', data: { track: 'theme' } });
eventTrack.addEvent({ time: 3.0, eventName: 'sfx:wave',  data: { volume: 0.8 } });
eventTrack.addEvent({ time: 5.9, eventName: 'cut:end' });

// Property track: animate camera FOV
const fovTrack = new PropertyTrack({
  name: 'camFov', propertyPath: 'fov', target: camera,
});
fovTrack.addKeyframe({ time: 0, value: 60 });
fovTrack.addKeyframe({ time: 6, value: 35 });

seq.addTrack(animTrack).addTrack(eventTrack).addTrack(fovTrack);
seq.play();

function frame(dt: number) { seq.update(dt); }
```

### Loop with wrap-around events

```ts
const loop = new TimelineSequencer({ duration: 4, loop: true, eventBus: bus });
const ev = new EventTrack({ name: 'heartbeat' });
ev.addEvent({ time: 0.0, eventName: 'beat' });
ev.addEvent({ time: 2.0, eventName: 'beat' });
loop.addTrack(ev).play();
// Each frame: seq.update(dt) — at wrap, both the 2.0s and 0.0s beats fire once.
```

### Export / import

```ts
const json = seq.export();
// json.tracks[].kind === 'animation' | 'event' | 'property' drives rebuild
const restored = new TimelineSequencer().import(json);
// target / data runtime refs must be re-bound by the caller after import
```

`import()` rebuilds tracks from the `kind` discriminator
(`'event'` → `EventTrack`, `'property'` → `PropertyTrack`, anything
else → `TimelineTrack`). Runtime references (`target`, clip `data`)
are not serializable and must be re-attached by the caller.

---

## Invariants

- **Time domain.** `time ∈ [0, duration]`; `seek()` clamps to this
  range. `duration === 0` disables the clamp (free-running timeline).
- **Clip window.** `TimelineClip.contains(time)` is left-closed /
  right-open (`[start, end)`), so two abutting clips never both
  activate at their shared boundary.
- **Sorted collections.** `TimelineTrack.clips`, `EventTrack.events`
  and `PropertyTrack.keyframes` are re-sorted by `start` / `time`
  after every `add*` call; callers must not assume insertion order.
- **Event trigger interval.** `EventTrack.getEventsBetween` uses
  `(lastTime, time]` (left-open, right-closed) to prevent double
  firing when the play-head lands exactly on an event time. Loop
  wrap-around (`lastTime > time`) splits into two scans.
- **PropertyTrack extrapolation.** `time` before the first keyframe
  returns the first value; `time` after the last returns the last
  value. There is no cycle / ping-pong mode.
- **`update` no-op when paused.** `isPlaying === false` short-circuits
  `update(dt)` — tracks are not refreshed either, so seeking while
  paused leaves targets at their last-evaluated state.
- **Import is structural.** `import(json)` restores timeline structure
  (`time` / `duration` / `loop` / `speed` + track shapes) only;
  `target` / `data` references must be re-bound by the caller.
- **Logging.** State transitions route through
  `createLogger('Timeline.Sequencer')` per the centralized logger
  convention; failed track rebuilds during `import()` emit `warn`
  rather than throwing.

---

## References

- `src/engine/Animation/AnimationMixer.ts` — clip playback peer;
  `TimelineTrack.data` typically wraps an `AnimationAction` whose
  `update(localTime, dt)` is called by the track.
- `src/engine/Events/EventBus.ts` — `EventTrack.trigger` emits through
  `bus.emit(eventName, data)`; listeners register via `bus.on`.
- `src/engine/SaveSystem/SaveSerializer.ts` — persists sequencer state
  via `export()` / `import()` as part of a `SaveData` blob.
- `src/components/viewer/Timeline.tsx` — UI consumer driving
  `TimelineSequencer` play/pause/seek from the editor panel.
- `src/lib/logger.ts` — `createLogger(module)` used by the sequencer.
