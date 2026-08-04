# Particles Module

> Path: `src/engine/Particles/`
>
> The advanced CPU particle subsystem of the `@vreen/engine` kernel. Provides
> `ParticleSystem2` — a pool-backed simulator with per-particle modifiers,
> curve-driven lifetime properties, optional trails, and sub-emitters — plus the
> supporting `ParticleData`, `ParticleEmitter`, `ParticleModifier`, and
> `ParticleCurve` primitives. Intentionally separate from the lightweight ECS
> `ParticleSystem` component to support rich features without bloating the ECS
> core.

---

## Overview

`ParticleSystem2` owns a particle pool, emitters, modifiers, and an optional
`TrailModule`. Each frame `update(dt)` runs four phases: emitter spawn,
modifier application, integration, and death / pool recycling. `render()`
flattens alive particles into three `Float32Array` attributes (`positions`,
`colors`, `sizes`) ready for `WebGL2Renderer` upload.

```
ParticleCurve (interface) ── implemented by ── ConstantCurve / LinearCurve
                                                   / BezierCurve / RandomCurve
        │ consumed by
        ▼
ParticleModifier (abstract) ── apply(particle, dt, system)
   ├── ForceFieldModifier        1/r² attract/repel
   ├── VortexModifier            axis × r tangent
   ├── TurbulenceModifier        sin/cos pseudo-noise
   ├── ColorOverLifeModifier     start → end color lerp
   ├── SizeOverLifeModifier      curve-driven size lerp
   ├── VelocityOverLifeModifier  curve-scaled initial velocity (cached per particle)
   └── SubEmittersModifier       spawn sub-emitter on death / collision
        │ applied to
        ▼
ParticleData { position, velocity, acceleration, color, size, life, maxLife,
               rotation, angularVelocity, customData[], alive }   ← recycled via pool
        │
        ▼
ParticleSystem2 ── holds ──→ particles[]
   ├── emitters: ParticleEmitter[]   ── update(dt, system) → system.spawn
   ├── modifiers: ParticleModifier[] ── sorted by priority, applied per particle
   ├── trail: TrailModule | null     ── update(particles, dt) → getTrailData()
   └── particlePool: ParticleData[]  ── acquireParticle / releaseParticle

ParticleEmitter (dual mode)
   1. self-contained: emit() / emitFromShape() → EmitterParticle[]; update(dt) integrates
   2. system-compatible: update(dt, system) → system.spawn; trigger(system, pos, count)
```

The data layout (separate `positions` / `colors` / `sizes` arrays) matches the
engine's WebGL2 vertex attributes, so a future GPU-particle migration only
needs to move `update` into a compute shader.

---

## Core Classes

### Curves (`ParticleCurve.ts`)

| Export | Role |
|--------|------|
| `ParticleCurve` | Interface: `evaluate(t: number): number` for `t` in `[0, 1]`. |
| `ConstantCurve` | Returns a fixed `value` for all `t`. |
| `LinearCurve` | Linear interpolation between `from` and `to`. |
| `BezierCurve` | Quadratic Bézier with control points `p0`, `p1`, `p2`. |
| `RandomCurve` | Random sample in `[min, max]`, optionally modulated by an inner curve. Each `evaluate` re-samples. |
| `createCurve` | Factory: rebuilds a curve from a `{ type, ... }` descriptor (JSON-friendly). |

```ts
export interface ParticleCurve { evaluate(t: number): number; }

// ConstantCurve(value?=1)            ─ fixed value
// LinearCurve(from?=0, to?=1)        ─ lerp from→to
// BezierCurve(p0?=0, p1?=0.5, p2?=1) ─ quadratic Bézier
// RandomCurve(min?, max?, inner?)    ─ per-call re-sample in [min,max] × inner
export function createCurve(desc: {
  type: 'constant' | 'linear' | 'bezier' | 'random';
  value?: number; from?: number; to?: number;
  p0?: number; p1?: number; p2?: number;
  min?: number; max?: number; inner?: ParticleCurve | null;
}): ParticleCurve;
```

All curves clamp `t` to `[0, 1]` except `RandomCurve`, whose re-sampling is
intentional for jitter. For per-particle-consistent randomness (e.g. lifetime),
sample once at spawn and store in `customData`.

### `ParticleData` (`ParticleData.ts`)

| Export | Role |
|--------|------|
| `ParticleData` | Single-particle state. Owns `position` / `velocity` / `acceleration` / `color` / `startColor` / `endColor` / `size` / `startSize` / `endSize` / `life` / `maxLife` / `rotation` / `angularVelocity` / `customData` / `alive`. `reset()` restores factory defaults for pool reuse. |

```ts
export class ParticleData {
  position: Vector3; velocity: Vector3; acceleration: Vector3;  // set by emitter.gravity
  color: Color; startColor: Color; endColor: Color;
  size: number; startSize: number; endSize: number;
  life: number; maxLife: number;              // seconds
  rotation: number; angularVelocity: number;  // radians, rad/s
  customData: number[];                       // generic slots used by modifiers
  alive: boolean;
  constructor();
  reset(): void;          // zero all fields, used by pool
  isAlive(): boolean;     // alive && life < maxLife
}
```

`customData` is the per-particle scratch space modifiers use to cache state
(e.g. `VelocityOverLifeModifier` caches the initial velocity at
`[slot*3, slot*3+2]`, `SubEmittersModifier` stores a "triggered" flag at
`slot*3`). The slot convention is documented per modifier.

### `ParticleEmitter` (`ParticleEmitter.ts`)

Dual-mode emitter. Self-contained mode owns `EmitterParticle[]` and integrates them; `ParticleSystem2`-compatible mode calls `system.spawn` to inject into an external system.

| Export | Role |
|--------|------|
| `ParticleEmitter` | Configurable emitter: `emissionRate`, `emissionShape`, `shapeParams`, `lifetime`, `startSpeed`, `startSize` / `endSize`, `startColor` / `endColor`, `gravity`, `drag`, `sizeCurve`, `colorCurve`, `subEmitters`, `trails`, `trailLifetime`. Plus legacy fields (`shape`, `rate`, `bursts`, `directionBias`, `burstCount`) for the system-compatible path. |
| `EmitterColor` | `{ r, g, b, a }` 0..1 — self-contained-mode color (RGBA; `Audio`-style `Color` has no alpha, so alpha lives in `customData[0]` on the system path). |
| `EmitterParticle` | Self-contained particle: `{ position, velocity, lifetime, age, size, color, rotation, angularVelocity, trail? }`. |
| `EmissionShapeType` | `'point' | 'sphere' | 'box' | 'cone' | 'circle' | 'hemisphere'`. |
| `ShapeParams` | `{ radius?, extents?, angle?, height?, normal? }` — per-shape fields. |
| `EmitterShapeType` / `EmitterShape` | Legacy shape types (`'point' | 'box' | 'sphere' | 'cone' | 'mesh' | 'circle' | 'hemisphere'`) and shape descriptor for the system-compatible path. |
| `ParticleBurst` | `{ count, time, cycles, interval, fired }` — scheduled burst. |
| `MinMaxRange` | `{ min, max }` range. |

```ts
export class ParticleEmitter {
  position: Vector3; rotation: Quaternion;
  // self-contained-mode config
  emissionRate: number;            // particles/sec
  emissionShape: EmissionShapeType; shapeParams: ShapeParams;
  lifetime: MinMaxRange; startSpeed: MinMaxRange;
  startSize: MinMaxRange; endSize: MinMaxRange;
  startColor: EmitterColor; endColor: EmitterColor;
  gravity: Vector3; drag: number;
  sizeCurve: number[]; colorCurve: number[];   // keyframe arrays, evenly spaced
  subEmitters: ParticleEmitter[]; trails: boolean; trailLifetime: number;
  // legacy (system-compatible path)
  shape: EmitterShape; rate: number; bursts: ParticleBurst[];
  directionBias: Vector3; burstCount: number;

  emit(count: number): void;                       // self-contained: spawn to this.particles
  emitFromShape(shape: EmissionShapeType, count: number): void;
  update(dt: number): void;                        // self-contained integration
  update(dt: number, system: ParticleSystem2): void;  // system path: rate + bursts → system.spawn
  trigger(system: ParticleSystem2, position: Vector3, count?: number): void;  // one-shot burst
  reset(): void;  getParticles(): EmitterParticle[];  clear(): void;
  sampleCurve(curve: number[], t: number): number;   // keyframe linear interp
}
```

### `ParticleModifier` (`ParticleModifier.ts`)

| Export | Role |
|--------|------|
| `ParticleModifier` | Abstract base. Fields: `enabled` (system skips when false), `priority` (lower runs first, default 0). Method: `apply(p, dt, system)`. |
| `ForceFieldModifier` | Inverse-square attract (`strength > 0`) / repel (`strength < 0`) toward `center`. `minRadius` avoids the singularity. |
| `VortexModifier` | Tangent force `axis × r` projected onto the plane perpendicular to `axis`. |
| `TurbulenceModifier` | Sin / cos pseudo-noise perturbation driven by `frequency` and internal accumulated time. |
| `ColorOverLifeModifier` | Lerps `p.color` from `startColor` to `endColor` by `t = life / maxLife`. |
| `SizeOverLifeModifier` | Lerps `p.size` between `p.startSize` and `p.endSize` by `curve.evaluate(t)`. |
| `VelocityOverLifeModifier` | Scales the particle's *initial* velocity (cached in `customData[slot*3..slot*3+2]` on first apply) by `curve.evaluate(t)`. |
| `SubEmittersModifier` | On particle death (predicted as `life + dt >= maxLife`), calls `onDeathEmitter.trigger(system, position, spawnCount)` once per particle (guarded by a `customData` flag). Optionally inherits a fraction of the parent velocity. |

```ts
export abstract class ParticleModifier {
  enabled: boolean;     // default true
  priority: number;     // default 0, lower runs first
  abstract apply(p: ParticleData, dt: number, system: ParticleSystem2): void;
}

// ForceFieldModifier(center?, strength?, minRadius?)        ─ 1/r² attract/repel
// VortexModifier(axis?, strength?, center?)                ─ axis × r tangent
// TurbulenceModifier(strength?, frequency?, timeScale?)    ─ sin/cos pseudo-noise
// ColorOverLifeModifier(start?, end?)                      ─ lerp p.color by life
// SizeOverLifeModifier(curve?=LinearCurve(1,0))            ─ lerp p.size by curve
// VelocityOverLifeModifier(curve?, slot?)                  ─ scale cached initial vel
// SubEmittersModifier(slot?=1)                             ─ fields: onDeathEmitter,
//   onCollisionEmitter, spawnCount, inheritVelocity (0..1)
```

### `TrailModule` (`TrailModule.ts`)

| Export | Role |
|--------|------|
| `TrailModule` | Maintains a `Map<ParticleData, Vector3[]>` of the last `length` positions per alive particle. `update(particles, dt)` appends current positions and prunes entries for dead / missing particles. |
| `TrailColorMode` | `'fade'` (alpha decreases along the trail) or `'constant'` (uniform color). |
| `TrailRenderData` | `{ positions, colors, counts, trailCount }` — one line-strip per trail, `counts[i]` is the vertex count of strip `i`. |

```ts
export class TrailModule {
  length: number; width: number; colorMode: TrailColorMode;  // segments = length - 1
  constructor(length?: number, width?: number, colorMode?: TrailColorMode);  // 8, 0.1, 'fade'
  update(particles: ParticleData[], dt: number): void;
  getTrailData(): TrailRenderData;
  reset(): void;  get trailCount(): number;
}
```

### `ParticleSystem2` (`ParticleSystem2.ts`)

| Export | Role |
|--------|------|
| `ParticleSystem2` | Main simulator. Owns `particles`, `emitters`, `modifiers`, `trail`, and a `particlePool` for dead-particle recycling. `update(dt)` runs the four-phase pipeline; `render()` flattens to attributes. |
| `ParticleSystemRenderData` | `{ positions, colors, sizes, count }` — three `Float32Array` attributes plus the alive count. |
| `SpawnDefaults` | Default spawn properties used by the low-level `spawn(count, position, velocity)` API: `lifetime`, `startColor`, `endColor`, `startSize`, `endSize`, `gravity`, `drag`. |

```ts
export class ParticleSystem2 {
  maxParticles: number;
  particles: ParticleData[];
  emitters: ParticleEmitter[];
  modifiers: ParticleModifier[];       // sorted by priority ascending
  trail: TrailModule | null;
  duration: number; loop: boolean; time: number;   // system loop length (seconds)
  defaults: SpawnDefaults;

  constructor(maxParticles?: number);  // default 1000

  addEmitter(e: ParticleEmitter): this;
  addModifier(m: ParticleModifier): this;     // marks modifiers dirty for re-sort
  setTrail(t: TrailModule | null): this;
  spawn(count: number, position: Vector3, velocity: Vector3): ParticleData[];  // low-level
  update(dt: number): void;
  render(): ParticleSystemRenderData;
  reset(): void;                       // clear particles, reset time, reset emitters + trail
  clear(): void;                       // clear particles + pool + trail
  get aliveCount(): number;
}
```

> **Barrel alias.** The engine root barrel re-exports `ParticleEmitter` as
> `AdvancedParticleEmitter` to avoid colliding with the ECS `ParticleEmitter`
> component in `ECS/PhysicsComponents.ts`. The `Particles/` sub-barrel keeps
> the original name `ParticleEmitter`.

---

## `update(dt)` Pipeline

`ParticleSystem2.update(dt)` runs four phases per frame:

```
0. If modifiersDirty: sort modifiers by priority ascending; clear flag.
1. EMIT: for each emitter, emitter.update(dt, this) → may call system.spawn
   (rate accumulation + scheduled bursts).
2. INTEGRATE each alive particle:
   a. Default color/size lifetime lerp (overridden by modifiers if present).
   b. modifiers.apply(p, dt, system) in priority order — may mutate velocity,
      color, size, or spawn sub-particles (SubEmittersModifier has side effects).
   c. Semi-implicit Euler:
        p.life += dt;  p.vel += p.acceleration * dt;
        p.vel *= (1 - drag * dt);  p.pos += p.velocity * dt;
        p.rot += p.angularVelocity * dt;
   d. If p.life >= p.maxLife → mark dead.
3. TRAIL: if trail !== null, trail.update(particles, dt).
4. REAP: move dead particles to particlePool (capped at maxParticles);
   splice out of particles[].
```

`render()` flattens alive particles into `positions` / `colors` / `sizes`
`Float32Array`s of length `count*3` / `count*3` / `count`.

---

## Usage

### Smoke trail with force field and color-over-life

```ts
import {
  ParticleSystem2, ParticleEmitter,
  ForceFieldModifier, ColorOverLifeModifier, SizeOverLifeModifier,
  TrailModule, LinearCurve,
} from '@vreen/engine/particles';
import { Vector3, Color } from '@vreen/engine';

const system = new ParticleSystem2(2000);
system.defaults.lifetime = { min: 1.5, max: 2.5 };
system.defaults.startColor = new Color(0.9, 0.9, 0.9);
system.defaults.endColor = new Color(0.1, 0.1, 0.1);
system.defaults.startSize = { min: 0.2, max: 0.4 };
system.defaults.endSize = { min: 0, max: 0 };
system.defaults.gravity = -0.5;  system.defaults.drag = 0.4;

const emitter = new ParticleEmitter();
emitter.position.set(0, 1, 0);
emitter.rate = 60;
emitter.shape = { type: 'sphere', radius: 0.1, shellOnly: true };
system.addEmitter(emitter);

system.addModifier(new ColorOverLifeModifier(
  new Color(0.9, 0.9, 0.9), new Color(0.1, 0.1, 0.1)));
system.addModifier(new SizeOverLifeModifier(new LinearCurve(1, 0)));
system.addModifier(new ForceFieldModifier(new Vector3(2, 1, 0), 0.8, 0.2));
system.setTrail(new TrailModule(12, 0.15, 'fade'));

function frame(dt: number) {
  system.update(dt);
  const { positions, colors, sizes, count } = system.render();
  const trail = system.trail!.getTrailData();
  // upload positions/colors/sizes + trail.positions/trail.colors to renderer
}
```

### Sub-emitter on death (firework)

```ts
import {
  ParticleSystem2, ParticleEmitter, SubEmittersModifier,
  BezierCurve, SizeOverLifeModifier,
} from '@vreen/engine/particles';
import { Vector3 } from '@vreen/engine';

const system = new ParticleSystem2(5000);

// Mortar: rises, then explodes
const mortar = new ParticleEmitter();
mortar.position.set(0, 0, 0);
mortar.rate = 1;
mortar.lifetime = { min: 1.2, max: 1.2 };
mortar.startSpeed = { min: 12, max: 12 };
mortar.gravity = new Vector3(0, -9.81, 0);

// Explosion sub-emitter
const explosion = new ParticleEmitter();
explosion.emissionShape = 'sphere';
explosion.shapeParams = { radius: 0.05 };
explosion.lifetime = { min: 0.8, max: 1.4 };
explosion.startSpeed = { min: 4, max: 10 };
explosion.startSize = { min: 0.15, max: 0.25 };
explosion.endSize = { min: 0, max: 0 };  explosion.burstCount = 80;

const sub = new SubEmittersModifier(/* slot */ 1);
sub.onDeathEmitter = explosion;
sub.spawnCount = 80;  sub.inheritVelocity = 0.3;

system.addEmitter(mortar);
system.addModifier(sub);
system.addModifier(new SizeOverLifeModifier(new BezierCurve(0, 0.7, 1)));
```

### Self-contained emitter (no system)

```ts
import { ParticleEmitter } from '@vreen/engine/particles';
const emitter = new ParticleEmitter();
emitter.emissionRate = 100;
emitter.emissionShape = 'cone';
emitter.shapeParams = { angle: Math.PI / 8, height: 1, radius: 0.05 };
emitter.lifetime = { min: 1, max: 2 };
emitter.startSpeed = { min: 5, max: 8 };
emitter.startColor = { r: 1, g: 0.6, b: 0.1, a: 1 };
emitter.endColor = { r: 0.4, g: 0.1, b: 0, a: 0 };

function frame(dt: number) {
  emitter.emitFromShape('cone', Math.floor(emitter.emissionRate * dt));
  emitter.update(dt);
  const particles = emitter.getParticles();   // render particles.length entries
}
```

---

## Invariants

- `ParticleSystem2.particles.length <= maxParticles` always; `spawn` returns
  `[]` when the pool is exhausted. Dead particles are recycled into
  `particlePool` (capped at `maxParticles`); `acquireParticle()` pops the pool
  or constructs a fresh `ParticleData`, and `spawn()` calls `reset()` on it
  before configuring. Stale external references see `alive === false` and may be
  overwritten on the next acquire.
- Modifiers are sorted by `priority` ascending at most once per `update` (only
  when `modifiersDirty` is set by `addModifier`); equal priorities keep
  insertion order. `ColorOverLifeModifier` / `SizeOverLifeModifier` write
  `p.color` / `p.size` every apply, overriding the system's pre-modifier
  default lerp — to combine both, add both modifiers.
- `VelocityOverLifeModifier` caches the particle's *initial* velocity in
  `customData[slot*3..slot*3+2]` on first apply and scales *that cached vector*
  by `curve.evaluate(t)` (does not re-sample current velocity). The `slot` must
  not collide with other modifiers writing the same range.
- `SubEmittersModifier` triggers `onDeathEmitter` at most once per particle
  (guarded by `customData[slot*3]`); death is predicted as `p.life + dt >=
  p.maxLife` so the sub-emitter fires on the same frame the parent dies.
  `onCollisionEmitter` requires external code to flag a collision (the modifier
  runs no collision detection). During `trigger`, the modifier temporarily
  overwrites `onDeathEmitter.directionBias` with the inherited parent velocity,
  then restores it.
- `TrailModule.update` rebuilds an `aliveSet` each call and prunes histories
  for particles no longer in the list or marked `!alive`; histories shorter
  than 2 points are skipped by `getTrailData`. Because `ParticleData` is
  recycled via the pool, the prune step is required every frame to avoid
  resurrecting stale trails (object identity is the `Map` key).
- `ParticleCurve.evaluate` is pure for `ConstantCurve` / `LinearCurve` /
  `BezierCurve`. `RandomCurve.evaluate` re-samples every call — do not use it
  for properties needing per-particle cross-frame consistency; sample once at
  spawn and store in `customData`.
- `ParticleEmitter.update` is overloaded: `update(dt)` runs self-contained
  integration on `this.particles`; `update(dt, system)` follows the rate /
  burst schedule and calls `system.spawn`. Mixing modes on one emitter is not
  supported. `ParticleSystem2.render()` allocates fresh `Float32Array`s each
  call; for hot-loop upload, reuse a preallocated buffer and copy.

---

## Design Notes

**Why a separate module from the ECS `ParticleSystem`?** The ECS
`Particle` / `ParticleEmitter` components are lightweight data carriers for
entity-tied gameplay effects. This module supports rich authoring —
`ParticleCurve` keyframes, seven built-in modifiers, sub-emitters, trails —
whose per-particle state would inflate the ECS core. The engine root barrel
disambiguates by aliasing this module's `ParticleEmitter` as
`AdvancedParticleEmitter`.

**Why CPU instead of GPU?** A CPU implementation is testable in Node without a
WebGL context, deterministic for replay / save systems, and trivially
debuggable. The data layout (`positions` / `colors` / `sizes` as separate
attributes) matches the engine's WebGL2 vertex attributes, so a future GPU
migration only needs to move `update` into a compute shader and keep
`render()`'s output contract.

**Why an object pool?** Spawn / kill rates of hundreds per frame would cause
per-frame GC pressure if each spawn allocated a fresh `ParticleData`. The pool
recycles dead particles up to `maxParticles`; `reset()` restores factory
defaults at acquire so callers never see stale state.

**Why `customData` slots?** Per-particle modifier state (cached initial
velocity, sub-emitter triggered flag) needs storage without each modifier
maintaining its own `Map<ParticleData, ...>`. The `customData` array plus a
documented slot convention lets multiple modifiers coexist; the `slot`
constructor on `VelocityOverLifeModifier` / `SubEmittersModifier` assigns
non-overlapping ranges.

**Why dual-mode `ParticleEmitter`?** Self-contained mode (`emit` /
`emitFromShape` / `update(dt)` on `EmitterParticle[]`) is the spec'd authoring
path; system-compatible mode (`update(dt, system)` calling `system.spawn`)
preserves backward compatibility with the `ParticleSystem2`-centric API. Both
modes share shape / lifetime / color configuration.

**Why `priority` on modifiers?** Order matters: `ForceFieldModifier` should
run before `VelocityOverLifeModifier` caches the "initial" velocity, and
`SubEmittersModifier` should run last so its death prediction sees
post-integration life. The `priority` field (lower runs first) plus the
dirty-flag re-sort makes ordering explicit and stable. `RandomCurve`
re-samples every call because a stable-per-`t` random would need a pre-baked
noise function or an internal cache keyed by `t` — both defeat the "stateless
curve" contract. Per-particle-consistent randomness belongs in `customData`
(sampled once at spawn); `RandomCurve` is for jitter properties.

---

## GPUParticleSystem (`GPUParticleSystem.ts`)

> Path: `src/engine/Particles/GPUParticleSystem.ts`
>
> High-throughput GPU particle system. Stores per-particle state in RGBA32F
> textures, simulates in a fragment shader (MRT single-pass), and renders with
> `POINTS` + `gl_VertexID` texture fetch. Supports **65 536+ particles** with
> zero CPU→GPU particle data readback. Complements the CPU `ParticleSystem2`
> (rich modifiers / trails / sub-emitters, ~10 k cap) for fire, smoke, sparks,
> rain, snow, and starfield scenarios where particle count matters more than
> per-particle behavior complexity.

### Architecture

```
                  ┌─────────────────────────────────────────────────────┐
                  │              CPU side (per frame)                    │
                  │  spawnAccum += emissionRate × dt                     │
                  │  spawnCount  = floor(spawnAccum)  (capped)           │
                  │  spawnStart  = spawnCursor                           │
                  │  spawnCursor = (spawnCursor + spawnCount) % max      │
                  │  time       += dt                                    │
                  └───────────────┬─────────────────────────────────────┘
                                  │ uniforms
                  ┌───────────────▼─────────────────────────────────────┐
                  │      SIMULATE PASS (fragment, MRT ×2 outputs)       │
                  │  read:  positionTex[read]  velocityTex[read]  metaTex │
                  │  write: positionTex[write] velocityTex[write]        │
                  │                                                     │
                  │  per texel (gl_FragCoord → texelId):                │
                  │    if life<=0 && texelId in [start,start+count)%max: │
                  │      RESPAWN: pos=emitterPos+offset                 │
                  │                vel=emitterVel+dir×speed              │
                  │                life=1, age=0                         │
                  │    elif life>0:                                     │
                  │      INTEGRATE (semi-implicit Euler):               │
                  │        vel += gravity×dt;  vel *= (1-drag×dt)        │
                  │        pos += vel×dt;    age += dt                   │
                  │        life = max(0, 1 - age/maxLife)                │
                  │    else: passthrough (stay dead)                    │
                  └───────────────┬─────────────────────────────────────┘
                                  │ swap readIndex
                  ┌───────────────▼─────────────────────────────────────┐
                  │       RENDER PASS (vertex + fragment, POINTS)       │
                  │  vertex:  tid = gl_VertexID                         │
                  │           uv  = texelCoord(tid) / sizeX             │
                  │           pos  = texture(positionTex[read], uv)     │
                  │           if pos.w<=0 → clip (gl_Position=vec4(2))   │
                  │           clipPos = VP × vec4(pos.xyz, 1)           │
                  │           gl_PointSize = mix(start,end,t) × scale   │
                  │                            × viewportH / clipW      │
                  │  fragment: d = gl_PointCoord×2-1;  r² = dot(d,d)    │
                  │           if r²>1 → discard                         │
                  │           alpha = (1-r²) × sin(life×π) × alphaScale │
                  │           color = mix(startColor, endColor, 1-life) │
                  │           additive: out = vec4(color×alpha, alpha)  │
                  │           alpha:    out = vec4(color, alpha)        │
                  └─────────────────────────────────────────────────────┘
```

### Data Layout (per particle = 1 texel, `maxParticles = sizeX × sizeY`)

| Texture            | Format    | Count | Channels (RGBA)                          |
|--------------------|-----------|-------|------------------------------------------|
| `positionTex[2]`   | RGBA32F   | 2     | xyz = world pos, w = life ratio [0,1]    |
| `velocityTex[2]`   | RGBA32F   | 2     | xyz = velocity (m/s), w = age (s)        |
| `metaTex`          | RGBA32F   | 1     | r = maxLife, g = startSize, b = endSize, a = seed |

- `positionTex` / `velocityTex` are **ping-pong** double-buffered: each frame
  reads `[readIndex]` and writes `[1-readIndex]`, then swaps. This avoids
  read-write hazards on the same texture.
- `metaTex` is **static** — written once at `_initResources` with per-particle
  random `maxLife` (in `[lifetimeMin, lifetimeMax]`) and `seed`.
- All data textures use `NEAREST` filtering + `CLAMP_TO_EDGE` wrap (float data
  must not be interpolated or tiled).
- `RGBA32F` as a render target requires the `EXT_color_buffer_float` extension
  (enabled by the renderer before constructing the system).

### Simulation Algorithm (11 stages, MRT single-pass)

| Stage | Description |
|-------|-------------|
| 1 | CPU accumulates `spawnAccum += emissionRate × dt`; `spawnCount = floor(spawnAccum)` (capped at `maxParticles`); `spawnAccum -= spawnCount`. |
| 2 | CPU advances `spawnCursor = (spawnCursor + spawnCount) % maxParticles`; `time += dt`. |
| 3 | Bind MRT FBO with `COLOR_ATTACHMENT0 = positionTex[write]`, `COLOR_ATTACHMENT1 = velocityTex[write]`; `drawBuffers([0, 1])`. |
| 4 | Bind read textures: `positionTex[read]` → unit 0, `velocityTex[read]` → unit 1, `metaTex` → unit 2. |
| 5 | Fragment shader: `texelId = (gl_FragCoord.y - 0.5) × sizeX + (gl_FragCoord.x - 0.5)`. |
| 6 | Compute `rel = (texelId - spawnStart + maxParticles) % maxParticles`; `shouldSpawn = (life <= 0) && (rel < spawnCount)`. |
| 7 | If `shouldSpawn`: PCG-hash random offset (emitterPos ± radius), random unit-sphere direction × `startSpeed × (1-var + var×rand)`; `life=1`, `age=0`. |
| 8 | Elif `life > 0`: semi-implicit Euler — `vel += gravity×dt`; `vel *= max(0, 1-drag×dt)`; `pos += vel×dt`; `age += dt`; `life = max(0, 1 - age/maxLife)`. |
| 9 | Else: passthrough (stay dead, `life=0`). |
| 10 | `outPosition = vec4(newPos, newLife)`; `outVelocity = vec4(newVel, newAge)`. |
| 11 | Swap `readIndex`; restore FBO + viewport. |

### Render Algorithm (7 stages, POINTS)

| Stage | Description |
|------|-------------|
| 1 | Bind `positionTex[read]` → unit 0, `metaTex` → unit 1. |
| 2 | Vertex: `tid = gl_VertexID`; `uv = (vec2(tid % sizeX, tid / sizeX) + 0.5) / sizeX`. |
| 3 | Fetch `pos = texture(positionTex, uv)`; if `pos.w <= 0` → `gl_Position = vec4(2,2,2,1)` (clip out). |
| 4 | `clipPos = VP × vec4(pos.xyz, 1)`; `gl_Position = clipPos`. |
| 5 | `t = 1 - pos.w`; `size = mix(meta.g, meta.b, t)`; `gl_PointSize = clamp(size × scale × viewportH × pixelRatio / clipW, 1, 256)`. |
| 6 | Fragment: `d = gl_PointCoord × 2 - 1`; `r² = dot(d,d)`; if `r² > 1` discard. |
| 7 | `alpha = (1-r²) × sin(life×π) × alphaScale`; `color = mix(startColor, endColor, 1-life)`; additive → `vec4(color×alpha, alpha)`, alpha → `vec4(color, alpha)`. |

### API

```ts
export interface GPUParticleOptions {
  maxParticles?: number;            // default 65536 (256×256)
  emissionRate?: number;            // particles/sec, default 1000
  emitterPosition?: [number, number, number];  // default (0,0,0)
  emitterVelocity?: [number, number, number];  // default (0,0,0)
  emitterRadius?: number;           // spawn sphere radius, default 0.5
  startSpeed?: number;              // m/s, default 2
  startSpeedVariance?: number;      // 0..1, default 0.5
  lifetime?: { min: number; max: number };  // seconds, default {1, 3}
  startSize?: number;               // world units, default 0.1
  endSize?: number;                 // default 0.0
  gravity?: [number, number, number];  // m/s², default (0, -9.8, 0)
  drag?: number;                    // 1/s, default 0
  startColor?: [number, number, number];  // life=1 color, default (1,1,1)
  endColor?: [number, number, number];    // life=0 color, default (0.2,0.2,0.2)
  sizeScale?: number;               // global size multiplier, default 1
  alphaScale?: number;              // global alpha multiplier, default 1
  blendMode?: 'additive' | 'alpha'; // default 'additive'
  enabled?: boolean;                // default true
  pixelRatio?: number;              // devicePixelRatio, default 1
}

export class GPUParticleSystem {
  readonly name: 'gpuparticles';
  readonly maxParticles: number;    // sizeX × sizeY (≥ requested)
  readonly sizeX: number;
  readonly sizeY: number;

  // configurable fields (updatable per-frame)
  emissionRate: number;
  emitterPosition: [number, number, number];
  emitterVelocity: [number, number, number];
  emitterRadius: number;
  startSpeed: number; startSpeedVariance: number;
  lifetimeMin: number; lifetimeMax: number;
  startSize: number; endSize: number;
  gravity: [number, number, number];
  drag: number;
  startColor: [number, number, number];
  endColor: [number, number, number];
  sizeScale: number; alphaScale: number;
  blendMode: 'additive' | 'alpha';
  enabled: boolean; pixelRatio: number;

  constructor(opts?: GPUParticleOptions);

  // per-frame simulation (MRT fragment pass + ping-pong swap)
  update(gl: WebGL2RenderingContext, dt: number): void;
  // render all alive particles as POINTS
  render(gl: WebGL2RenderingContext, camera: Camera): void;

  // clear all particles (life=0), reset cursor + time
  reset(gl: WebGL2RenderingContext): void;
  setDirty(): void;                 // force re-init on next update
  dispose(gl?: WebGL2RenderingContext): void;

  // getters
  get positionTexture(): WebGLTexture | null;  // current read texture
  get velocityTexture(): WebGLTexture | null;
  get metaTexture(): WebGLTexture | null;
  get time(): number;                // elapsed seconds
  get spawnCursor(): number;         // next texel to spawn
}
```

### Options Table

| Option              | Default          | Range / Notes                                    |
|---------------------|------------------|--------------------------------------------------|
| `maxParticles`      | 65536            | Rounded up to `sizeX × sizeY` where `sizeX = ceil(√n)`. |
| `emissionRate`      | 1000             | particles/sec; fractional accumulation preserved. |
| `emitterPosition`   | (0, 0, 0)        | World-space spawn center.                        |
| `emitterVelocity`   | (0, 0, 0)        | Base velocity added to all particles.            |
| `emitterRadius`     | 0.5              | Spawn offset is uniform in `[-r, r]³` cube.      |
| `startSpeed`        | 2                | m/s; random direction on unit sphere.            |
| `startSpeedVariance`| 0.5              | 0 = uniform speed, 1 = full `[0, 2×speed]` range.|
| `lifetime`          | {1, 3}           | Per-particle random `maxLife` baked into `metaTex`. |
| `startSize` / `endSize` | 0.1 / 0.0    | Linearly interpolated by `t = 1 - life`.         |
| `gravity`           | (0, -9.8, 0)     | m/s² acceleration.                               |
| `drag`              | 0                | Velocity damping per second.                     |
| `startColor` / `endColor` | (1,1,1) / (0.2,0.2,0.2) | Mixed by `1 - life`.            |
| `sizeScale` / `alphaScale` | 1 / 1        | Global multipliers.                              |
| `blendMode`         | 'additive'       | Additive: `ONE/ONE` (premultiplied). Alpha: `SRC_ALPHA/ONE_MINUS_SRC_ALPHA`. |
| `pixelRatio`        | 1                | Affects `gl_PointSize` for HiDPI.                |

### Usage

#### Fire (additive, 65k particles)

```ts
import { GPUParticleSystem } from '@vreen/engine/particles';

const fire = new GPUParticleSystem({
  maxParticles: 65536,
  emissionRate: 8000,
  emitterPosition: [0, 0, 0],
  emitterRadius: 0.3,
  startSpeed: 2.5,
  startSpeedVariance: 0.6,
  lifetime: { min: 0.4, max: 1.2 },
  startSize: 0.15,
  endSize: 0.0,
  gravity: [0, 1.5, 0],        // buoyancy (hot air rises)
  drag: 0.8,
  startColor: [1.0, 0.7, 0.2], // orange
  endColor: [0.8, 0.15, 0.0],  // deep red
  blendMode: 'additive',
});

// per frame:
fire.update(gl, dt);
fire.render(gl, camera);

// teardown:
fire.dispose(gl);
```

#### Rain (alpha blend, gravity)

```ts
const rain = new GPUParticleSystem({
  maxParticles: 20000,
  emissionRate: 2000,
  emitterPosition: [0, 30, 0],
  emitterRadius: 20,
  startSpeed: 0,
  lifetime: { min: 2, max: 4 },
  startSize: 0.02,
  endSize: 0.02,
  gravity: [0, -20, 0],
  drag: 0.1,
  startColor: [0.6, 0.7, 0.9],
  endColor: [0.4, 0.5, 0.8],
  blendMode: 'alpha',
  sizeScale: 2,
});
```

### GPUParticleSystem vs ParticleSystem2

| Aspect                | `GPUParticleSystem` (GPU)          | `ParticleSystem2` (CPU)                |
|-----------------------|------------------------------------|----------------------------------------|
| Max particles         | **65 536+** (texture size limit)   | ~10 000 (JS single-thread cap)         |
| Simulation location   | Fragment shader (MRT ping-pong)    | CPU `update(dt)` loop                  |
| Modifiers             | None (gravity + drag only)         | ForceField / Vortex / Turbulence / ColorOverLife / SizeOverLife / VelocityOverLife / SubEmitters |
| Trails                | No                                 | Yes (`TrailModule`)                    |
| Sub-emitters          | No                                 | Yes (`SubEmittersModifier`)            |
| Color over life       | Yes (uniform start/end)            | Yes (per-particle `startColor`/`endColor`) |
| Size over life        | Yes (linear start→end)             | Yes (curve-driven)                     |
| Rendering             | POINTS + `gl_VertexID` fetch       | `Float32Array` attributes upload       |
| CPU→GPU readback      | **Zero**                           | Full upload each frame                 |
| Determinism           | No (GPU float + PCG hash)          | Yes (seedable `Math.random`)           |
| Debuggability         | Low (GPU state)                    | High (CPU array inspection)            |
| Use case              | Fire / smoke / rain / snow / stars | Gameplay effects with rich behavior    |

### vs soup3D

| Feature                  | VREEN `GPUParticleSystem` | soup3D |
|--------------------------|---------------------------|--------|
| GPU particle simulation  | Yes (MRT ping-pong)       | No     |
| 65k+ particles           | Yes                       | No (no particle system) |
| Texture-based state      | RGBA32F                   | N/A    |
| `gl_VertexID` fetch      | Yes                       | No     |
| Additive + alpha blend   | Yes                       | No     |
| Color / size over life   | Yes                       | No     |
| Gravity + drag           | Yes                       | No     |

soup3D has **no particle system at all**. VREEN now ships both a CPU particle
system (`ParticleSystem2`, rich modifiers) and a GPU particle system
(`GPUParticleSystem`, high throughput), covering the full spectrum from
gameplay-tied effects to mass-fire scenarios.

---

## References

- Engine `Math/MathUtils` (`clamp` / `lerp`), `Math/Vector3` / `Color` /
  `Quaternion` — particle kinematics and color state.
- Engine `ECS/PhysicsComponents.ts` — lightweight ECS `Particle` /
  `ParticleEmitter` counterparts; engine root barrel aliases this module's
  `ParticleEmitter` as `AdvancedParticleEmitter`.
- Engine `Renderer/WebGL2Renderer` — consumes `ParticleSystemRenderData`
  (`positions` / `colors` / `sizes`) and `TrailRenderData` line strips.
- Schechter & Bridson (2012), "Animating Smoke" — modifier-driven behavior
  reference; `TurbulenceModifier` uses cheap sin/cos pseudo-noise rather than
  true curl noise for performance.
- Unity Shuriken / Unreal Cascade — API ergonomics reference for the
  emitter + modifier + curve + sub-emitter + trail decomposition.
