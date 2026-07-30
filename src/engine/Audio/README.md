# Audio Module

> Path: `src/engine/Audio/`
>
> The audio subsystem of the `@vreen/engine` kernel. Provides a scene-graph
> integrated `AudioListener` / `Audio` / `PositionalAudio` family backed by the
> Web Audio API, an `AudioLoader` for decoding common formats, an
> `AudioAnalyser` for FFT spectrum analysis, a white-box `SpatialAudio` manager
> (HRTF + Doppler + cone attenuation), an offline `AudioEffects` DSP chain, and
> a `ProceduralAudio` synthesizer for runtime SFX generation.

---

## Overview

The module is layered in three concentric tiers: a global context manager, a
scene-graph integrated playback tier (`AudioListener` / `Audio` /
`PositionalAudio`), and a set of standalone DSP tools (`AudioEffects`,
`ProceduralAudio`, `SpatialAudio`) that operate on raw `Float32Array` samples
or drive `Audio` instances directly.

```
AudioContextManager ──owns──→ native AudioContext (singleton, lazy)
        │
        ▼
AudioListener (Object3D) ── gain → context.destination
        │  updateMatrixWorld → decomposeMatrix → context.listener.position/forward/up
        ▼
Audio (Object3D)            source → filters[] → gain → listener.getInput()
   │  setBuffer / setNodeSource / setMediaElementSource / setMediaStreamSource
   └── PositionalAudio      source → filters[] → PannerNode → gain → listener.getInput()
                               updateMatrixWorld → PannerNode.position/orientation
        │
        │  (white-box alternative)
        ▼
SpatialAudio ──manages──→ SpatialAudioSource[] ──holds──→ Audio (with StereoPannerNode)
   update(dt): decompose listener world matrix → per source compute
     distance attenuation · cone gain · HRTF (ITD+ILD) · Doppler shift
     → writes Audio.setVolume / setPlaybackRate / StereoPannerNode.pan

Standalone DSP (no AudioContext dependency):
  AudioLoader    ──implements──→ Loader<AudioBuffer>  (decodeAudioData)
  AudioAnalyser  ──wraps──→ AnalyserNode              (getByteFrequencyData)
  AudioEffects   ──chain──→ reverb/echo/chorus/distortion/lowpass/highpass/compressor/flanger
  ProceduralAudio ─ synthesize → Float32Array         (oscillator + noise + ADSR + AM/FM)
```

The first tier is bound to the browser Web Audio node graph; the DSP tier is
context-free and suitable for offline rendering, testing, and post-processing.

---

## Core Classes

### Context & Listener

| Export | Role |
|--------|------|
| `AudioContextManager` | Static singleton wrapper around the native `AudioContext`. Defers creation until first `getContext()` call (browser autoplay policy) and accepts `setContext()` for offline / test injection. |
| `AudioListener` | Scene "ear". Extends `Object3D` so it can be parented to a camera. Owns a master `GainNode` connected to `context.destination` and an optional filter. `updateMatrixWorld()` decomposes its world matrix and writes position / forward / up to `context.listener`. |
| `decomposeMatrix` / `setQuaternionFromRotationMatrix` / `applyQuaternionToVector` | Math helpers exported alongside `AudioListener` because the engine `Matrix4` does not yet expose `decompose`. Reused by `PositionalAudio` and `SpatialAudio`. |

```ts
export class AudioContextManager {
  static getContext(): AudioContext;                       // lazy singleton
  static setContext(value: AudioContext | undefined): void; // test/offline inject
}

export class AudioListener extends Object3D {
  readonly context: AudioContext;
  readonly gain: GainNode;            // → context.destination
  filter: AudioNode | null;
  timeDelta: number;                  // seconds since previous updateMatrixWorld
  getInput(): GainNode;               // child sources connect into
  setFilter(node: AudioNode): this;   removeFilter(): this;
  setMasterVolume(v: number): this;   getMasterVolume(): number;
  updateMatrixWorld(force?: boolean): void;  // syncs context.listener
}
```

`AudioContextManager` is named `AudioContextManager` (not `AudioContext`) to
avoid shadowing the native `AudioContext` type — see Design Notes.

### `Audio` (`Audio.ts`)

Non-positional (global) audio source. Extends `Object3D` so it can be attached
to any scene node, but its sound has no 3D attenuation.

| Export | Role |
|--------|------|
| `Audio` | Non-positional source. Node chain: `source → filters[] → gain → listener.getInput()`. Supports `AudioBuffer` (with playback control) and `AudioNode` / `HTMLMediaElement` / `MediaStream` sources (no playback control). |
| `AudioSourceType` | Discriminated union: `'empty' | 'audioNode' | 'mediaNode' | 'mediaStreamNode' | 'buffer'`. |

```ts
export class Audio extends Object3D {
  readonly listener: AudioListener;
  readonly context: AudioContext;
  readonly gain: GainNode;
  autoplay: boolean; loop: boolean; loopStart: number; loopEnd: number;
  offset: number; duration: number | undefined;
  playbackRate: number; detune: number;
  isPlaying: boolean; hasPlaybackControl: boolean;   // true for buffer only
  sourceType: AudioSourceType;
  filters: AudioNode[];

  setBuffer(buf: AudioBuffer): this;                 // playback-controllable
  setNodeSource(node: AudioNode): this;              // stream/node sources:
  setMediaElementSource(el: HTMLMediaElement): this; // hasPlaybackControl = false
  setMediaStreamSource(stream: MediaStream): this;
  play(delay?: number): this | undefined;
  pause(): this | undefined;                          // records _progress for resume
  stop(delay?: number): this | undefined;            // resets _progress to 0
  setFilters(nodes: AudioNode[] | undefined): this;
  setVolume(v: number): this;
  setPlaybackRate(v: number): this | undefined;
  setLoop(v: boolean): this | undefined;
  getOutput(): AudioNode;        // gain (overridden by PositionalAudio)
  connect(): this;  disconnect(): this | undefined;
  onEnded(): void;
}
```

`hasPlaybackControl` is `true` only for `buffer` sources; `play` / `pause` /
`stop` / `setLoop` / `setPlaybackRate` are no-ops (return `undefined`) for
stream / node sources. `pause` records `_progress` (accounting for
`playbackRate` and loop wraparound) so `play` resumes from the right offset.

### `PositionalAudio` (`PositionalAudio.ts`)

3D positional audio backed by a native `PannerNode` (panning model `HRTF`).

| Export | Role |
|--------|------|
| `PositionalAudio` | `Audio` subclass inserting a `PannerNode` between the filter chain and `gain`. Each frame `update()` decomposes `matrixWorld` and ramps `panner.positionX/Y/Z` + `orientationX/Y/Z`. |
| `AudioDistanceModel` | `'linear' | 'inverse' | 'exponential'` — mirrors `PannerNode.distanceModel`. |

```ts
export class PositionalAudio extends Audio {
  readonly panner: PannerNode;     // panningModel = 'HRTF'
  distanceModel: AudioDistanceModel;
  refDistance: number; maxDistance: number; rolloffFactor: number;
  coneInnerAngle: number; coneOuterAngle: number; coneOuterGain: number;  // degrees
  getOutput(): PannerNode;         // overrides Audio.getOutput
  setRefDistance(v: number): this;  setMaxDistance(v: number): this;
  setRolloffFactor(v: number): this;  setDistanceModel(m: AudioDistanceModel): this;
  setDirectionalCone(inner: number, outer: number, outerGain: number): this;
  update(): void;                  // sync panner from matrixWorld
  updateMatrixWorld(force?: boolean): void;
}
```

### `AudioLoader` (`AudioLoader.ts`)

| Export | Role |
|--------|------|
| `AudioLoader` | Implements `Loader<AudioBuffer>`. `canLoad` matches by MIME (`audio/*`) or extension (mp3 / wav / ogg / oga / m4a / aac / flac / weba / webm / opus). `load` fetches the bytes via `fetchAsArrayBuffer` and decodes with `AudioContext.decodeAudioData`, supporting both the Promise and callback variants. |

```ts
export class AudioLoader implements Loader<AudioBuffer> {
  readonly format = 'audio';
  constructor(context?: AudioContext);   // defaults to AudioContextManager.getContext()
  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean;
  async load(source: AssetSource, ctx?: LoaderContext): Promise<AudioBuffer>;
}
```

### `AudioAnalyser` (`AudioAnalyser.ts`)

| Export | Role |
|--------|------|
| `AudioAnalyser` | Wraps an `AnalyserNode` tapped off `Audio.getOutput()`. `data` is a `Uint8Array` of length `frequencyBinCount` (= `fftSize / 2`). |

```ts
export class AudioAnalyser {
  readonly analyser: AnalyserNode;
  readonly data: Uint8Array;
  constructor(audio: Audio, fftSize?: number);   // fftSize default 2048
  getFrequencyData(): Uint8Array;                // 0..255 per bin
  getAverageFrequency(): number;
}
```

### `SpatialAudio` / `SpatialAudioSource` (`SpatialAudio.ts`)

White-box 3D spatialization. Unlike `PositionalAudio` (which delegates to the
browser `PannerNode`), `SpatialAudio` computes HRTF, distance attenuation, cone
gain, and Doppler shift explicitly and drives the underlying `Audio` instance's
`gain` / `playbackRate` plus an optional `StereoPannerNode.pan`. This makes the
algorithm testable and reproducible in environments without `PannerNode`.

| Export | Role |
|--------|------|
| `SpatialAudio` | Manager. Owns a `Map<id, SpatialAudioSource>`, tracks listener velocity from frame-to-frame position delta, and per frame applies final gain / playbackRate / pan to each source. |
| `SpatialAudioSource` | Per-source state: world `position` / `velocity` / `orientation`, attenuation + cone params, plus the last-frame computed `lastDistance` / `lastAttenuation` / `lastConeGain` / `lastDopplerShift` / `lastHRTF`. |
| `SpatialDistanceModel` | `'linear' | 'inverse' | 'exponential'`. |
| `HRTFResult` | `{ azimuth, elevation, itdMs, ildDb, pan, leftGain, rightGain }`. Simplified model: ITD = 0.6 ms × sin(azimuth), ILD = 6 dB × sin(azimuth), pan = sin(azimuth), gains via equal-power pan law. |

```ts
export class SpatialAudio {
  readonly listener: AudioListener;
  readonly sources: Map<string, SpatialAudioSource>;
  maxSources: number;            // default 32
  speedOfSound: number;          // default 343.3 m/s
  dopplerFactor: number;         // 0 = off, 1 = physical, >1 = exaggerated

  createSource(id: string, buf: AudioBuffer, position?: Vector3): SpatialAudioSource | null;
  removeSource(id: string): boolean;
  play(id: string): this;  pause(id: string): this;  stop(id: string): this;
  setPosition(id: string, p: Vector3): this;
  setVelocity(id: string, v: Vector3): this;     // for Doppler
  setVolume(id: string, v: number): this;
  setCone(id: string, inner: number, outer: number, outerGain: number): this;
  setDistanceModel(id: string, m: SpatialDistanceModel): this;
  update(dt?: number): this;     // call after listener.updateMatrixWorld
  computeDistanceAttenuation(s: SpatialAudioSource): number;
  computeDoppler(s: SpatialAudioSource): number;
  computeHRTF(s: SpatialAudioSource): HRTFResult;
  getSourceCount(): number;
  getActiveSources(): SpatialAudioSource[];
}
```

Doppler formula (listener-rest frame, approach = positive):
`dopplerShift = c / (c - dopplerFactor * vRadial)`, clamped to `[0.1, 10]`.

### `AudioEffects` (`AudioEffects.ts`)

Offline sample-level DSP effect chain. Input / output are mono `Float32Array`
PCM — no `AudioContext` dependency. Each effect owns internal state (delay
lines, filter state, LFO phase) that persists across `process` calls for
streaming block processing.

| Export | Role |
|--------|------|
| `AudioEffects` | Ordered effect chain with `inputGain` / `outputGain` / `wetMix`. `process(input, output, samples)` applies effects in order with a dry/wet crossfade. |
| `AudioEffectType` | `'reverb' | 'echo' | 'chorus' | 'distortion' | 'lowpass' | 'highpass' | 'compressor' | 'flanger'`. |
| `AudioEffect` | Single effect instance: `{ id, type, enabled, params: Map<string, number>, state }`. |
| `AudioEffectStats` | Aggregate summary returned by `getStats()`. |

```ts
export class AudioEffects {
  effects: AudioEffect[];
  inputGain: number; outputGain: number; wetMix: number;  // 0..2 / 0..2 / 0..1
  readonly sampleRate: number;
  constructor(sampleRate?: number);   // default 44100
  addEffect(type: AudioEffectType, params?: Record<string, number>): string;
  removeEffect(id: string): boolean;
  setEffectParam(id: string, name: string, value: number): boolean;
  enableEffect(id: string): boolean;  disableEffect(id: string): boolean;
  reorderEffect(id: string, newIndex: number): boolean;
  getEffect(id: string): AudioEffect | undefined;
  process(input: Float32Array, output: Float32Array, samples: number): void;  // in-place safe
  clear(): void;
  getStats(): AudioEffectStats;
}
```

DSP references: Schroeder 1962 reverb (4 parallel comb + 2 series allpass);
RBJ Audio EQ Cookbook biquad (bilinear transform) for lowpass / highpass;
LFO-modulated variable delay with linear interpolation for chorus / flanger;
`tanh` soft-clip for distortion; feed-forward peak detection + first-order
smoothing for the compressor.

### `ProceduralAudio` (`ProceduralAudio.ts`)

Procedural SFX synthesizer. Pure DSP, context-free; outputs mono `Float32Array`.

| Export | Role |
|--------|------|
| `ProceduralAudio` | Composable synthesis pipeline: oscillator / noise source → ADSR envelope → biquad filter → AM/FM modulation → mix / concatenate / resample / normalize. Plus preset one-shot generators. |
| `OscillatorType` | `'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise'`. |
| `NoiseType` | `'white' | 'pink' | 'brown' | 'blue' | 'violet'`. |
| `ProceduralFilterType` | `'none' | 'lowpass' | 'highpass' | 'bandpass'`. |
| `Envelope` | ADSR `{ attack, decay, sustain, release }` (seconds + 0..1 level). |
| `Modulation` | `{ enabled, type: 'am'|'fm', frequency, depth }`. |
| `DEFAULT_ENVELOPE` / `DEFAULT_MODULATION` | Sensible defaults (A=10 ms, D=100 ms, S=0.7, R=200 ms; modulation off). |
| `ProceduralAudioStats` | Snapshot returned by `getStats()`. |

```ts
export class ProceduralAudio {
  readonly sampleRate: number;
  channels: number;             // metadata, generate() outputs mono
  oscillatorType: OscillatorType; frequency: number; duration: number;
  envelope: Envelope;
  filterType: ProceduralFilterType; filterCutoff: number; filterResonance: number;
  noiseType: NoiseType; modulation: Modulation;
  constructor(sampleRate?: number);   // default 44100

  // Signal sources
  generateOscillator(type: OscillatorType, freq: number, dur: number): Float32Array;
  generateNoise(type: NoiseType, dur: number): Float32Array;
  // Atomic DSP ops (in-place where noted)
  applyEnvelope(samples: Float32Array, env: Envelope): Float32Array;
  applyFilter(samples: Float32Array, type: ProceduralFilterType, cutoff: number, resonance: number): Float32Array;
  applyModulation(samples: Float32Array, mod: Modulation): Float32Array;
  mix(...sources: Float32Array[]): Float32Array;
  concatenate(...sources: Float32Array[]): Float32Array;
  resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array;
  normalize(samples: Float32Array): Float32Array;
  // Fluent setters + pipeline
  setOscillatorType(t: OscillatorType): this;  setFrequency(f: number): this;
  setDuration(d: number): this;  setEnvelope(e: Envelope): this;
  setFilter(t: ProceduralFilterType, cutoff: number, resonance: number): this;
  setNoiseType(t: NoiseType): this;
  setModulation(t: 'am'|'fm', freq: number, depth: number): this;
  generate(): Float32Array;     // run full pipeline from instance state
  // Presets
  generateExplosion(): Float32Array;  generateFootstep(): Float32Array;
  generateGunshot(): Float32Array;    generateWind(): Float32Array;
  generateWaterDrop(): Float32Array;  generateUIBeep(): Float32Array;
  getStats(): ProceduralAudioStats;
}
```

Noise colors: white (uniform); pink (Paul Kellet refined); brown (leaky
integrator of white); blue (first difference of white, high-pass); violet
(second difference, higher-pass).

### Test helper: `audioContextMock.ts`

`audioContextMock.ts` is a Vitest-only Web Audio API mock (factories
`createMockAudioContext`, `createMockGainNode`, `createMockPannerNode`,
`createMockAnalyserNode`, `createMockBufferSourceNode`, `createMockAudioListener`,
`createMockAudioBuffer`, `createMockAudioParam`, `createMockAudioNode`). It is
**not** re-exported from the public `index.ts` barrel; tests inject it via
`AudioContextManager.setContext()`.

---

## Usage

### Positional 3D audio attached to a scene node

```ts
import { AudioListener, PositionalAudio, AudioLoader } from '@vreen/engine/audio';
import { PerspectiveCamera } from '@vreen/engine';

const listener = new AudioListener();
camera.add(listener);

const loader = new AudioLoader();
const buffer = await loader.load('/assets/sfx/arrow-flyby.ogg');

const sfx = new PositionalAudio(listener);
sfx.setBuffer(buffer);
sfx.setRefDistance(5);
sfx.setMaxDistance(60);
sfx.setRolloffFactor(1.2);
sfx.setDistanceModel('inverse');
sfx.setDirectionalCone(40, 120, 0.3);  // degrees
sfx.position.set(10, 2, 0);
scene.add(sfx);
sfx.play();

function frame(dt: number) {
  scene.updateMatrixWorld();   // propagates to listener + sfx panner
}
```

### White-box spatial audio with Doppler

```ts
import { AudioListener, SpatialAudio } from '@vreen/engine/audio';
import { Vector3 } from '@vreen/engine';

const listener = new AudioListener();
const spatial = new SpatialAudio(listener);
spatial.dopplerFactor = 1.5;
spatial.createSource('engine', engineBuffer, new Vector3(0, 0, 20));
spatial.setVelocity('engine', new Vector3(0, 0, -30));  // approaching
spatial.play('engine');

function frame(dt: number) {
  listener.updateMatrixWorld();
  spatial.update(dt);   // writes gain / playbackRate / pan to the source
}
```

### Offline DSP chain + procedural SFX

```ts
import { AudioEffects, ProceduralAudio } from '@vreen/engine/audio';

const pa = new ProceduralAudio(44100);
const boom = pa.generateExplosion();   // Float32Array

const fx = new AudioEffects(44100);
const reverbId = fx.addEffect('reverb', { decay: 0.8, roomSize: 0.7, damping: 0.4 });
fx.addEffect('lowpass', { cutoff: 1200, resonance: 0.7 });
fx.wetMix = 0.85;

const out = new Float32Array(boom.length);
fx.process(boom, out, boom.length);
```

### FFT spectrum analysis

```ts
import { AudioAnalyser } from '@vreen/engine/audio';

const analyser = new AudioAnalyser(nonPositionalAudio, 1024);
const bins = analyser.getFrequencyData();   // Uint8Array, length = 512
const avg = analyser.getAverageFrequency();
```

---

## Invariants

- `AudioContextManager.getContext()` is idempotent until `setContext()` replaces
  the singleton; passing `undefined` resets it so the next call lazily creates a
  fresh native context.
- `AudioListener.updateMatrixWorld()` must run after the parent camera's world
  matrix is current; it reads `this.matrixWorld` and ramps `context.listener`
  over `timeDelta`. Calling it before the parent updates yields stale poses.
- `PositionalAudio.update()` is a no-op while `hasPlaybackControl === true` and
  `isPlaying === false` — panner values are not ramped for silent sources.
- `Audio.play()` on an already-playing source silently returns `undefined`
  (mirrors three.js); it does not restart. `pause()` records `_progress`
  (accounting for `playbackRate` and loop wraparound); `stop()` resets it to 0.
- `SpatialAudio.update(dt)` must be called *after* `listener.updateMatrixWorld()`.
  With `dt <= 0` listener velocity is treated as zero (no Doppler).
  `createSource` returns the existing source on `id` collision and `null` once
  `maxSources` is reached. Doppler shift is clamped to `[0.1, 10]`, attenuation
  to `[0, 1]`, HRTF `pan` to `[-1, 1]`.
- `AudioEffects` requires `sampleRate > 0` (constructor throws). `process()` is
  safe with `input === output` (in-place). DSP state persists across calls;
  call `clear()` to reset.
- `ProceduralAudio.generateNoise('pink'|'brown'|'blue'|'violet')` uses stateful
  accumulators local to a single call — bake the noise into a buffer and reuse
  if determinism is required.
- `AudioLoader.load()` honors `LoaderContext.signal` (aborts between fetch and
  decode with an `AbortError`) and reports progress via `ctx.onProgress`.
- `AudioAnalyser.data.length === frequencyBinCount === fftSize / 2`;
  `getFrequencyData()` overwrites `data` in place and returns the same reference.

---

## Design Notes

**Why `AudioContextManager` instead of `AudioContext`?** three.js names its
context wrapper `AudioContext`, which shadows the browser's native
`AudioContext` type and prevents user code from typing `new AudioContext()`.
The engine names the wrapper `AudioContextManager` to keep the native type
visible.

**Why a separate `SpatialAudio` when `PositionalAudio` already exists?**
`PositionalAudio` delegates spatialization to the browser `PannerNode` — a
black box unavailable in headless / offline contexts. `SpatialAudio` computes
HRTF (simplified ITD + ILD), distance attenuation, cone gain, and Doppler
explicitly, exposing per-frame results (`lastHRTF`, `lastDopplerShift`,
`lastAttenuation`, `lastConeGain`) for testing and custom mixing. The
simplified HRTF omits full impulse-response convolution; callers needing
measurement-based HRTF can layer it on the exposed `pan` / `leftGain` /
`rightGain`.

**Why offline DSP (`AudioEffects`, `ProceduralAudio`)?** The Web Audio node
graph is real-time only and bound to a live `AudioContext`. Offline DSP enables
pre-rendering processed `AudioBuffer`s, running the same algorithm in Node
tests, post-processing recorded buffers, and synthesizing SFX without bundling
audio assets. The tiers are bridged by feeding `ProceduralAudio` /
`AudioEffects` output into an `AudioBuffer` and playing it via
`Audio.setBuffer`.

**Matrix decomposition.** The engine `Matrix4` does not yet expose
`decompose()`. `AudioListener.ts` ships a column-major `decomposeMatrix` plus a
Shepperd-method `setQuaternionFromRotationMatrix` and an inlined
`applyQuaternionToVector` (27 multiply-adds, no temp quaternion allocation),
exported so `PositionalAudio` and `SpatialAudio` can reuse them on the hot
path.

**Autoplay policy.** Browser autoplay restrictions require an `AudioContext` to
be created (or resumed) inside a user gesture. `AudioContextManager` defers
creation until the first `getContext()` call, but callers must still invoke
`context.resume()` from a gesture handler if the context starts suspended.

---

## References

- Web Audio API — `AudioContext`, `AudioListener`, `GainNode`, `PannerNode`,
  `StereoPannerNode`, `AnalyserNode`, `AudioBufferSourceNode`,
  `decodeAudioData`.
- three.js `Audio` / `AudioListener` / `PositionalAudio` / `AudioAnalyser` —
  API shape reference; the engine mirrors the node-chain layout while
  diverging on context naming and matrix decomposition.
- Schroeder, M. R. (1962), "Natural Sounding Artificial Reverberation" — comb
  + allpass reverb topology used by `AudioEffects.processReverb`.
- RBJ Audio EQ Cookbook — biquad filter formulas (bilinear transform) used by
  `AudioEffects` lowpass / highpass and `ProceduralAudio.applyFilter`.
- Woodworth, R. S. (1938) — ITD approximation `0.6 ms * sin(azimuth)` used by
  `SpatialAudio.computeHRTF`.
- Paul Kellet refined pink noise filter — used by
  `ProceduralAudio.generateNoise('pink')`.
