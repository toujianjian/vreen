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
