# Environment Module

> Path: `src/engine/Environment/`
>
> The environment subsystem of the `@vreen/engine` kernel. Provides data-and-
> compute layers for sky, clouds, precipitation, weather, vegetation, and water.
> Each system advances its own simulation in `update(dt)` and exposes either a
> `getMeshData()` / `getShaderUniforms()` pair (data tier) or a self-contained
> `Mesh` + `Material` (render tier). No class holds GL resources directly unless
> stated.

---

## Overview

The module groups eight concerns, each with at least one complementary
implementation. Data-tier classes (`ProceduralSky`, `SkyAtmosphere`,
`VolumetricClouds`, `FFTOcean`, `WaterInteraction`, `VegetationRenderer`)
produce `Float32Array` fields and flat uniform structs; render-tier classes
(`SkySystem`, `CloudSystem`, `PrecipitationSystem`, `VegetationSystem`,
`WaterSystem`, `DecalSystem`) additionally build engine `Mesh` /
`InstancedMesh` instances ready to drop into a scene.

```
WeatherSystem ── drives params ──→ SkySystem / CloudSystem / PrecipitationSystem
   (type · intensity · wind · fog · lightning)

SkySystem (keyframe art)        ProceduralSky (Preetham physics)     SkyAtmosphere (GPU ray-march)
  timeOfDay → sun/moon pos       turbidity/Rayleigh → sun alt/azim     Rayleigh+Mie+Ozone+multi-scatter
  sky/horizon color              getShaderUniforms()                   getShaderUniforms() → SKY_ATMOSPHERE_FRAG

CloudSystem (particle billboards)  VolumetricClouds (ray-march 3D noise field)
  coverage → getMeshData()          Beer-Lambert + HG → getShaderUniforms()

PrecipitationSystem ── particles in Box3 ──→ getMeshData() (rain/snow)

VegetationSystem ── InstancedMesh per patch ── VegetationType (placement rules)
VegetationRenderer ── data-only patch list ── LOD(4) + wind sway + season

WaterSystem ── owns Mesh + WaterMaterial ── attachSimulation(WaterSimulation)
WaterSimulation ── 2D wave equation grid (ripples, small pools)
WaterInteraction ── analytic ripples + splashes (large open water, sparse events)
FFTOcean ── Phillips spectrum + IFFT (open sea wind waves)

DecalSystem ── DecalGeometry per hit + MeshBasicMaterial ── FIFO cap + lifetime + fade
  spawnFromHit(target, point, normal) → Quaternion.setFromUnitVectors(+Z, normal)
```

All systems are decoupled: `WeatherSystem` only publishes parameters; the
visible effect is produced by whichever sky / cloud / precipitation system the
application wires up to consume them.

---

## Core Classes

### Sky

| Export | Role |
|--------|------|
| `SkySystem` | Time-driven sky. 4 keyframes (midnight / sunrise / noon / sunset) interpolated by `timeOfDay`. Computes sun + moon positions on a circular orbit and exposes `sunPosition` / `skyColor` / `horizonColor` / `starIntensity` / `sunIntensity`. |
| `DayPhase` | `'night' | 'dawn' | 'day' | 'dusk'`. |
| `ProceduralSky` | Physics-based sky (Preetham 1999 atmospheric scattering). Computes sun / moon altitude + azimuth from `timeOfDay` + `latitude` + `dayOfYear`, evaluates Rayleigh + Mie scattering, exposes a uniform block for a sky-box shader. |
| `SkyRGB` / `AtmosphereSample` / `ProceduralSkyStats` / `ProceduralSkyUniforms` | Color type, scattering result, stats, uniform struct. |

```ts
export class SkySystem {
  timeOfDay: number;            // 0..24
  sunPosition: Vector3; moonPosition: Vector3;
  sunColor: Color; skyColor: Color; horizonColor: Color;
  starIntensity: number; sunIntensity: number;
  daySpeed: number; enabled: boolean;
  constructor(initialHours?: number);   // default 8
  update(dt: number): this;             // 60s real = 1h in-game @ speed 1
  setTime(hours: number): this;
  getSunDirection(): Vector3;  getSkyColor(): Color;  getPhase(): DayPhase;
  // + getMoonDirection / getHorizonColor / getSunColor / getStarIntensity / getSunIntensity
}

// ProceduralSky: same lifecycle (update/setTime/setLatitude/setDayOfYear/
//   setTurbidity/setCloudCoverage/sampleAtmosphere/getShaderUniforms/getStats),
//   physics-based Preetham scattering output.
```

Sun orbit angle: `((hours - 6) / 24) * 2π` — 6:00 = east, 12:00 = zenith, 18:00
= west. Moon is always 180° opposite the sun.

### Weather

| Export | Role |
|--------|------|
| `WeatherSystem` | Single source of truth for current / target weather type, intensity, wind, fog, lightning. `setWeather(type, duration)` starts a smooth transition; `update(dt)` interpolates parameters. Storm weather auto-triggers random lightning; `triggerLightning()` is the manual override. |
| `WeatherType` | `'clear' | 'cloudy' | 'rain' | 'heavyRain' | 'snow' | 'fog' | 'storm' | 'sandstorm'`. |
| `WeatherParams` / `WeatherShaderUniforms` | Snapshot (`intensity`, `windDirection`, `windStrength`, `temperature`, `humidity`, `fogDensity`, `fogColor`, `cloudCoverage`, `timeOfDay`, `lightningEnabled`) and flat uniform block (`u_weatherIntensity`, `u_windDirection`, `u_windStrength`, `u_fogDensity`, `u_fogColor`, `u_cloudCoverage`, `u_timeOfDay`, `u_lightningFlash`, `u_weatherType`). |
| `WeatherFogColor` | `{ r, g, b }` 0..1. |

```ts
export class WeatherSystem {
  currentType: WeatherType;  targetType: WeatherType;
  intensity: number;
  windDirection: Vector3; windStrength: number;
  temperature: number; humidity: number;
  fogDensity: number; fogColor: WeatherFogColor;
  cloudCoverage: number; timeOfDay: number;
  lightningEnabled: boolean;
  setWeather(type: WeatherType, duration: number): this;  // transition over duration seconds
  setWind(direction: Vector3, strength: number): this;  setTimeOfDay(time: number): this;
  update(dt: number): this;  triggerLightning(): this;
  getLightningFlash(): number;                            // 0..1, decays each frame
  getShaderUniforms(): WeatherShaderUniforms;
}
```

Each `WeatherType` maps to a preset; `setWeather` lerps from the current preset
to the target over `duration`.

### Clouds

| Export | Role |
|--------|------|
| `CloudSystem` | Lightweight particle clouds. Each `Cloud` is a cluster of `CloudParticle` billboards drifting with `windSpeed` and wrapping around `bounds`. `coverage` modulates per-cloud visibility. |
| `Cloud` / `CloudParticle` / `CloudMeshData` | Per-cloud and per-particle state, plus flattened `positions` / `sizes` / `opacities` arrays for instanced rendering. |
| `VolumetricClouds` | High-quality ray-marched volumetric clouds. Generates a Perlin (FBM) + Worley 3D noise density field, advances `windOffset` over time, and exposes uniforms + a `marchRay()` reference impl. Lighting uses Beer-Lambert transmittance + Henyey-Greenstein forward scatter. |
| `CloudRGB` / `NoiseResolution` / `VolumetricCloudsUniforms` / `VolumetricCloudsData` / `VolumetricCloudsStats` | Color type, `{ x, y, z }` voxel counts, uniform block, raw data block (noise field + wind offset), runtime stats. |

```ts
export class CloudSystem {
  clouds: Cloud[];  coverage: number;  altitude: number;  windSpeed: Vector3;  bounds: Box3;
  constructor(bounds?: Box3);
  generate(numClouds: number): this;
  update(dt: number): this;     // drift + horizontal wrap
  updateVisibility(): void;
  getMeshData(): CloudMeshData;
}

// VolumetricClouds: setEnabled/setCoverage/setDensity/setWind/setSunColor/
//   setSunDirection/generateNoise/marchRay/update/getCloudData/getShaderUniforms/
//   getStats — ray-marched 3D noise field with Beer-Lambert + HG lighting.
```

`CloudSystem` is the cheap option (instanced billboards);
`VolumetricClouds` is the realistic option (full ray-march, sampled in a sky-box
or dedicated cloud pass). They are independent and can coexist.

### Grounded Skybox

| Export | Role |
|--------|------|
| `GroundedSkybox` | Ground-projected skybox (adapted from three.js r159+ `GroundedSkybox.js`). Projects an environment map onto a modified sphere where the bottom hemisphere is flattened to a ground plane, creating a seamless sky-to-ground transition with no visible seam. Z-axis is flipped so normals face inward. The flattening uses a smooth transition: vertices below `y1 = -height * 3/2` are fully flattened to `y = -height`; vertices between `y1` and 0 blend smoothly using `f = 1 - y² / (3 * y1²)`. |

```ts
// Usage: place the skybox at camera height so the ground aligns to y=0
const skybox = new GroundedSkybox(envTexture, height, radius);
skybox.position.y = height;
scene.add(skybox);
```

### Sky Atmosphere (GPU Physical)

| Export | Role |
|--------|------|
| `SkyAtmosphere` | GPU physical atmospheric scattering component (UE5 `SkyAtmosphere` / Unity HDRP style). Manages sun position (astronomy formula shared with `ProceduralSky`) + physical atmosphere parameters, exposes `getShaderUniforms()` for the `SKY_ATMOSPHERE_VERT` / `SKY_ATMOSPHERE_FRAG` skydome shader. Complements `ProceduralSky` (CPU Preetham analytic) — `SkyAtmosphere` targets cinematic-grade realism with ray-marched integration. |
| `AtmosphereRGB` / `SkyAtmosphereUniforms` / `SkyAtmosphereStats` / `AtmospherePreset` | Color type, uniform struct, stats, preset interface. |
| `EARTH_ATMOSPHERE` / `MARS_ATMOSPHERE` | Built-in atmosphere presets (Bruneton 2008 wavelengths / red dust). |

#### Physical Model (normalized to planet radius = 1.0, i.e. 6371 km)

| Phenomenon | Symbol | Description |
|------------|--------|-------------|
| Rayleigh scattering | `βR`, `HR` | Molecule scattering, wavelength-dependent (blue > red). Scale height `HR ≈ 8 km`. Phase `3/(16π)·(1+cos²θ)`. Causes blue sky. |
| Mie scattering | `βM`, `HM`, `g` | Aerosol scattering, neutral-gray. Scale height `HM ≈ 1.2 km`. Henyey-Greenstein phase with asymmetry `g ≈ 0.76`. Causes sun halo / haze. |
| Ozone absorption | `βO` | Chappuis absorption band, layer centered ~25 km (absorption, not scattering). Absorbs green-yellow → deepens high-altitude blue. **soup3D has no ozone.** |
| Multi-scattering | `multiScatter` | Bruneton ψ simplified approximation — a constant ambient term proportional to sun transmittance, so shadowed sky is not pure black. |
| Ground reflection | `groundAlbedo` | Lambertian ground × transmittance-to-ground × sun light — low-altitude sky picks up ground tint (green grass, yellow desert). |

#### Shader Pipeline (skydome, `SKY_ATMOSPHERE_FRAG`)

| Stage | Samples | Description |
|-------|---------|-------------|
| Ray-sphere intersect | — | Primary view ray vs atmosphere top + planet. Clamp `tStart..tEnd`. |
| Primary ray march | 32 | Accumulate single scattering + multi-scatter ψ + Beer-Lambert transmittance. |
| Sun transmittance sub-march | 8 | Per sample, march sun-direction to atmosphere top for `transmittanceToSun(p)`. |
| Ground reflection | — | If ray hits planet, add `albedo · sunTrans · sunColor / π · viewTransmittance`. |
| Sun disc | — | 0.53° angular disc via `smoothstep` on `cosTheta`. |

**Total per sky pixel**: 32 × (1 + 8) = ~288 texture-less math ops — cheap for a skydome drawn once per frame.

#### API

```ts
export class SkyAtmosphere {
  // sun + time + geography
  sunDirection: Vector3;  sunColor: AtmosphereRGB;  sunIntensity: number;
  timeOfDay: number;  latitude: number;  dayOfYear: number;  daySpeed: number;
  // atmosphere physics (normalized)
  betaR: [number, number, number];  betaM: [number, number, number];
  betaO: number;  g: number;
  HR: number;  HM: number;  planetRadius: number;  atmosphereRadius: number;
  multiScatter: number;  showSunDisc: boolean;  groundAlbedo: AtmosphereRGB;

  constructor(initialHours = 12);
  update(dt: number): this;                   // advance time (60s = 1h @ speed=1)
  setTimeOfDay(t: number): this;
  setLatitude(lat: number): this;             // clamp [-90, 90]
  setDayOfYear(day: number): this;            // clamp [1, 365]
  applyPreset(p: AtmospherePreset): this;     // EARTH / MARS / custom
  computeSunDirection(): Vector3;             // astronomy: declination + hour angle
  getShaderUniforms(): SkyAtmosphereUniforms; // bind to SKY_ATMOSPHERE_FRAG
  getStats(): SkyAtmosphereStats;
  isDaytime(): boolean;
}
```

#### soup3D Feature Parity — Why It Wins

`soup3D` ships only a flat sky-color / gradient background. `SkyAtmosphere`
delivers UE5/HDRP-grade physical sky:

- **Rayleigh + Mie + Ozone** — full three-channel wavelength-dependent
  extinction; soup3D has none.
- **Ray-marched integration** — physically correct horizon reddening at
  sunset (blue light scattered away), not a hand-tuned gradient.
- **Multi-scattering ψ** — shadowed sky retains ambient blue, not black.
- **Ground reflection** — low sky takes on terrain albedo.
- **Mars preset** — demonstrates the model is not Earth-hardcoded
  (red dust Mie, no ozone, strong forward scattering).

### Precipitation

| Export | Role |
|--------|------|
| `PrecipitationSystem` | Rain / snow particle system. Maintains `density` particles inside a `Box3`; particles fall at type-specific speed (`rain` 25 m/s, `snow` 1.5 m/s), drift with wind, and respawn from the top when they leave the bounds. |
| `PrecipitationType` | `'rain' | 'snow'`. |
| `PrecipitationParticle` / `PrecipitationMeshData` | `{ position, velocity, size, opacity }` and flattened `positions` / `sizes` / `opacities` + `count`. |

```ts
export class PrecipitationSystem {
  type: PrecipitationType;
  particles: PrecipitationParticle[];
  bounds: Box3;  density: number;
  constructor(type?: PrecipitationType, bounds?: Box3, density?: number);
  update(dt: number, wind: Vector3): this;  // integrate + respawn + wrap
  setDensity(d: number): this;  setType(t: PrecipitationType): this;
  getMeshData(): PrecipitationMeshData;
}
```

Snow has `windInfluence = 1.0`; rain has `windInfluence = 0.3` (rain is barely
deflected by wind).

### Vegetation

| Export | Role |
|--------|------|
| `VegetationSystem` | Render-tier vegetation. Patches the terrain into `VegetationPatch`es, scatters instances per `VegetationType` placement rules using a deterministic `mulberry32` PRNG, and builds an `InstancedMesh` per patch. LOD by camera distance. |
| `VegetationPatch` (system) / `VegetationInstance` / `VegetationStats` | `{ position, size, mesh, instances, lodLevel, visible }`, `{ position, scale, rotationY, typeName }`, `{ patchCount, instanceCount, visibleInstanceCount, visiblePatchCount }`. |
| `VegetationType` | Describes one species: `geometry` / `material` / `minScale` / `maxScale` / `slopeThreshold` / `heightThreshold` / `probability`. `canPlace(height, slope)` is the placement predicate. |
| `VegetationTypeOptions` / `VegetationTypeKind` / `Season` | Constructor options, `'grass' | 'tree' | 'bush' | 'flower'`, `'spring' | 'summer' | 'autumn' | 'winter'`. |
| `VegetationRenderer` | Data-tier vegetation. Same placement logic as `VegetationSystem` but emits `VegetationRenderPatch[]` (LOD + sway phase + visible flag) instead of `InstancedMesh`. Decouples vegetation from the rendering backend. |
| `VegetationRendererOptions` / `VegetationLODInfo` / `VegetationRendererStats` | Config, per-LOD counts, and stats. |

> **Name collision.** `VegetationSystem` and `VegetationRenderer` both export
> `VegetationPatch`; the barrel re-exports the renderer version as
> `VegetationRenderPatch`. Import from `'./VegetationRenderer'` for the original.

```ts
export class VegetationType {
  name: string;
  geometry: BufferGeometry;  material: Material;
  minScale: number; maxScale: number;
  slopeThreshold: number;           // radians, default π/4
  heightThreshold: [number, number];
  probability: number;              // 0..1
  constructor(opts: VegetationTypeOptions);
  canPlace(height: number, slope: number): boolean;
}

export class VegetationSystem {
  patches: VegetationPatch[];
  densityMap: Float32Array | null; densityMapResolution: number;
  seed: number; lodDistances: number[]; density: number; types: VegetationType[];
  constructor(seed?: number, lodDistances?: number[]);   // [50,120,240] default
  generate(terrain: TerrainGeometry, density: number, types: VegetationType[]): this;
  update(camera: Vector3): this;                         // LOD + visibility
  setDensity(d: number): this;  setSeed(seed: number): this;
  setDensityMap(map: Float32Array | null, resolution: number): this;
  getStats(): VegetationStats;
}

// VegetationRenderer: same API shape (addPatch/generate/update/setWind/setSeason/
//   setLODDistances/setDensityMap/getLODInfo/clear/getStats), data-tier output.
```

`VegetationSystem` LOD distances: 3 levels `[50, 120, 240]`.
`VegetationRenderer` LOD distances: 4 levels `[20, 60, 120, 240]`.
Season density factors: spring/summer = 1.0, autumn = 0.7, winter = 0.3.

### Water

| Export | Role |
|--------|------|
| `WaterSystem` | Render-tier water surface. `create(size, resolution)` builds an XZ `PlaneGeometry` (rotated −90° X) with a `WaterMaterial`. Optionally `attachSimulation(WaterSimulation)` for vertex displacement. Provides `isUnderwater(point)` + `getUnderwaterFog(point)` for underwater rendering. |
| `UnderwaterFog` | `{ color: Color, density: number }`. |
| `WaterSimulation` | 2D wave-equation solver (explicit finite differences) on a `resolution × resolution` grid. Stable CFL with `c·dt/dx ≤ 1/√2`; uses fixed `dt=0.5` internally and accumulates real time. |
| `WaterInteraction` | Analytic ripple + splash system for large open water. `interact(pos, vel, mass)` auto-spawns ripples (always) and splashes (above `splashThreshold`). `sampleHeight` / `sampleNormal` superpose all active ripples. |
| `Ripple` / `Splash` / `WaterInteractionOptions` / `WaterInteractionStats` | Per-ripple / per-splash state, config, stats. |
| `FFTOcean` | Tessendorf statistical ocean. Generates Phillips spectrum `h0(k)`, evolves to `ht(k,t)` via dispersion `ω=√(gk)`, IFFTs to displacement + horizontal choppy displacement, and computes normals (Jacobian cross) + foam (Jacobian fold-over). |
| `OceanRGB` / `FFTOceanOptions` / `FFTOceanUniforms` / `FFTOceanStats` | Color type, config, uniform block, stats. |

```ts
export class WaterSystem {
  waterMesh: Mesh | null; waterMaterial: WaterMaterial | null;
  waveHeight: number; waveLength: number; flowDirection: Vector2;
  waterColor: Color; transparency: number; waterLevel: number; time: number;
  simulation: WaterSimulation | null;
  underwaterFogColor: Color; underwaterFogDensity: number;
  create(size: number, resolution: number): this;
  update(dt: number): this;                       // advance time + simulation
  attachSimulation(sim: WaterSimulation | null): this;
  isUnderwater(point: Vector3): boolean;
  getUnderwaterFog(point: Vector3): UnderwaterFog | null;
}

// WaterSimulation: constructor(resolution?, damping?); addRipple(x, y, strength);
//   update(dt) (fixed-step ≤256); getHeight/getNormal/getMeshData.
// WaterInteraction: constructor(opts?); interact(pos, vel, mass); addRipple(...);
//   addSplash(...); update(dt); sampleHeight/sampleNormal; getStats.

export class FFTOcean {
  constructor(opts?: FFTOceanOptions);   // resolution (pow2), physicalSize, wind, choppy, foam, colors
  setWind(speed: number, direction: { x: number; z: number }): this;  setChoppy(factor: number): this;
  generateSpectrum(): this;              // h0(k) Phillips
  update(dt: number): this;              // evolve ht, IFFT, normals, foam
  getDisplacementMap(): Float32Array | null;   // dx, dy=height, dz interleaved
  getNormalMap(): Float32Array | null;  getFoamMap(): Float32Array | null;
  getShaderUniforms(): FFTOceanUniforms;  getStats(): FFTOceanStats;  dispose(): void;
}
```

Three water models cover different scales: `WaterSimulation` (small pools),
`WaterInteraction` (sparse events on large water), `FFTOcean` (open-sea wind
waves). They are decoupled and can be layered (e.g. `FFTOcean` base +
`WaterInteraction` player ripples).

### Decals

| Export | Role |
|--------|------|
| `DecalSystem` | Render-tier projected-decal manager. Wraps `DecalGeometry` (Sutherland–Hodgman triangle clipping) with a CPU-side pool that enforces both a `maxDecals` FIFO cap and a per-decal `maxAge` lifetime. Each `spawn()` builds a `DecalGeometry` from the target mesh's triangles, wraps it in a `Mesh` with a cloned `MeshBasicMaterial`, and attaches it to an internal `Group`. `update(dt)` advances age, applies linear opacity fade in the last `1 − fadeStartRatio` of life, and removes expired records. `spawnFromHit(target, point, normal, …)` auto-aligns the projector's +Z to the surface normal (via `Quaternion.setFromUnitVectors`) and offsets along the normal by `normalBias` (default 1 cm) to prevent z-fighting. |
| `DecalRecord` | Per-decal runtime state: `id`, `mesh`, `position`, `orientation`, `size`, `age`, `maxAge`, `fadeStartRatio`, `targetId`, `dead`. |
| `DecalSystemOptions` | Config: `maxDecals` (default 64), `defaultLifetime` (10 s), `defaultFadeStartRatio` (0.75), `defaultSize` (0.5), `defaultTexture`, `defaultColor`, `renderOrder` (1). |
| `DecalSystemStats` | `count`, `peakCount`, `evicted` (FIFO), `expired` (lifetime), `spawned` (total). |

```ts
export class DecalSystem {
  readonly group: Group;            // attach to scene; all decal Meshes live here
  decals: DecalRecord[];            // active records, ordered by spawn time
  maxDecals: number;                // FIFO cap (default 64)
  defaultLifetime: number;          // seconds (default 10)
  defaultFadeStartRatio: number;    // 0..1, last fraction of life fades to 0
  defaultSize: number;              // sx=sy=sz when spawn() omits size
  defaultTexture: Texture | null;
  defaultColor: { r; g; b };

  attach(parent: Object3D): this;
  detach(): this;
  spawn(target, position, orientation?, size?, opts?): DecalRecord | null;
  spawnFromHit(target, hitPoint, normal, size?, opts?): DecalRecord | null;
  update(dt: number): this;        // advance age, fade, reap expired
  removeById(id: number): boolean;
  clear(): this;
  getMeshes(): Mesh[];
  getById(id: number): DecalRecord | undefined;
  getStats(): DecalSystemStats;
  resetStats(): this;
}
```

**Algorithm (per spawn).** `DecalGeometry.create(target, position, orientation, size)`
builds the projector matrix `M = T(position) · R(orientation)`, transforms
every target triangle vertex `mesh-local → world → projector-local` via
`M⁻¹`, then runs Sutherland–Hodgman clipping against the 6 axis-aligned
planes `±X, ±Y, ±Z` (threshold `s = ½ · |size · planeNormal|`). UVs are
normalised to `[0,1]` within the projector box; positions are written back
to world space via `M`. See [`Geometries/DecalGeometry.ts`](../Geometries/DecalGeometry.ts)
for details.

**Lifetime & fade.** `update(dt)` advances `record.age` by `dt`. The opacity
is `1` while `age/maxAge < fadeStartRatio`, then linearly decreases to `0` at
`maxAge`. When `age ≥ maxAge`, the record is marked `dead` and removed at
the end of the update pass (geometry + material `dispose()`'d, mesh detached
from `group`). A `fadeStartRatio` of `1` disables fading entirely (decals
stay opaque until they vanish).

**FIFO eviction.** When `decals.length ≥ maxDecals` at `spawn()` time, the
oldest record (index 0) is shifted and disposed before the new one is
pushed. This bounds both CPU memory and draw-call count regardless of spawn
rate; tune `maxDecals` to your scene's budget (64 default, 256 for combat-
heavy scenes, 1024 max recommended before switching to GPU instancing).

**Normal alignment.** `spawnFromHit` calls
`Quaternion.setFromUnitVectors((0,0,1), normalize(normal))` to orient the
projector's +Z axis along the surface normal. A `normalBias` (default 0.01)
offsets the hit point along the normal to lift the decal off the surface
and avoid z-fighting / depth bleed. A degenerate normal (length < 1e-6)
falls back to the identity quaternion.

**Why it beats soup3D.** soup3D has no decal subsystem at all — every
projected-texture effect must be hand-rolled per game. VREEN ships a
complete runtime: geometry clipping + lifetime + fade + FIFO + normal
alignment + per-decal material cloning, matching the feature set of o3de's
`DecalComponent` (CPU path) while remaining free of editor / asset-pipeline
dependencies. The `getMeshes()` / `group` integration point lets the
renderer treat decals as ordinary transparent meshes — no special render
pass required.

**Limitations.** (1) CPU-side management caps scalability around ~1024
active decals; for higher counts, migrate to `InstancedMesh` + a per-
instance atlas. (2) Fade uses material `opacity`, which requires
`transparent=true` and imposes back-to-front sort cost. (3) No automatic
re-projection if the target mesh's `matrixWorld` changes after `spawn()`;
call `removeById` + `spawn` again. (4) `spawnFromHit` returns `null` if
the projector box misses every triangle (e.g. the hit point was on a
back-face within `size`); callers should treat `null` as a silent no-op.

Adapted from three.js `src/geometries/DecalGeometry.js` (geometry) and o3de
`DecalComponent` (lifetime / FIFO / fade model).

---

## Usage

### Day-night sky + weather driving clouds and rain

```ts
import { SkySystem, CloudSystem, PrecipitationSystem, WeatherSystem } from '@vreen/engine/environment';
import { Vector3, Box3 } from '@vreen/engine';

const sky = new SkySystem(8);              // 08:00
const clouds = new CloudSystem();  clouds.generate(40);
const rain = new PrecipitationSystem('rain', new Box3(new Vector3(-60, 0, -60), new Vector3(60, 100, 60)), 1500);
const weather = new WeatherSystem();
weather.setWeather('rain', 8);             // transition over 8 s

function frame(dt: number) {
  sky.update(dt);  weather.update(dt);
  clouds.windSpeed.copy(weather.windDirection).multiplyScalar(weather.windStrength);
  clouds.coverage = weather.cloudCoverage;
  clouds.update(dt);  rain.update(dt, clouds.windSpeed);
  // upload sky.getSkyColor(), weather.getShaderUniforms(), clouds.getMeshData(), rain.getMeshData() to renderer
}
```

### Procedural physics sky + volumetric clouds

```ts
import { ProceduralSky, VolumetricClouds } from '@vreen/engine/environment';
import { Vector3 } from '@vreen/engine';

const sky = new ProceduralSky();
sky.setLatitude(30).setDayOfYear(172).setTurbidity(3).setCloudCoverage(0.6);
const clouds = new VolumetricClouds();
clouds.generateNoise(1337);
clouds.setCoverage(0.55).setDensity(1.2);
clouds.setSunDirection(sky.sunDirection);
clouds.setSunColor({ r: 1, g: 0.95, b: 0.85 });
clouds.setWind(new Vector3(1, 0, 0.3), 4);

function frame(dt: number) {
  sky.update(dt);
  clouds.setSunDirection(sky.sunDirection);
  clouds.update(dt);
  const skyUniforms = sky.getShaderUniforms();
  const cloudUniforms = clouds.getShaderUniforms();
  const cloudData = clouds.getCloudData();   // bind noiseData as 3D texture
}
```

### GPU physical atmosphere (cinematic sky)

```ts
import { SkyAtmosphere, EARTH_ATMOSPHERE, MARS_ATMOSPHERE } from '@vreen/engine/environment';
import { SKY_ATMOSPHERE_VERT, SKY_ATMOSPHERE_FRAG } from '@vreen/engine/materials/shaders';

// Earth mid-latitude summer noon
const atmos = new SkyAtmosphere(12);
atmos.setLatitude(35).setDayOfYear(172);
atmos.multiScatter = 0.6;
atmos.groundAlbedo = { r: 0.25, g: 0.35, b: 0.15 }; // grass-tinted low sky

function frame(dt: number) {
  atmos.update(dt);
  const u = atmos.getShaderUniforms();
  // bind u.* to a skydome Mesh using SKY_ATMOSPHERE_VERT/FRAG
}

// Swap to Mars for an alien scene
atmos.applyPreset(MARS_ATMOSPHERE);
atmos.groundAlbedo = { r: 0.5, g: 0.25, b: 0.15 }; // rust desert
```

### FFT ocean + player-driven ripples

```ts
import { FFTOcean, WaterInteraction } from '@vreen/engine/environment';
import { Vector3 } from '@vreen/engine';

const ocean = new FFTOcean({
  resolution: 128, physicalSize: 256,
  windSpeed: 12, windDirection: { x: 1, z: 0.4 },
  waveAmplitude: 1.2e-5, choppyFactor: 0.9,
  foamThreshold: -0.1, foamIntensity: 0.6,
});
ocean.generateSpectrum();
const interaction = new WaterInteraction({ maxRipples: 64, splashThreshold: 3 });

function frame(dt: number, playerPos: Vector3, playerVel: Vector3) {
  ocean.update(dt);  interaction.update(dt);
  // when player enters water:
  interaction.interact(playerPos, playerVel, 80);
  const disp = ocean.getDisplacementMap();   // base swell
  const ripples = interaction.sampleHeight(x, z, time); // local disturbance
  const uniforms = ocean.getShaderUniforms();
}
```

### Bullet-hole decals on raycast hits

```ts
import { DecalSystem } from '@vreen/engine/environment';
import { Vector3 } from '@vreen/engine';
import { Raycaster } from '@vreen/engine/core';

const decals = new DecalSystem({
  maxDecals: 128,           // FIFO cap: oldest evicted beyond this
  defaultLifetime: 12,      // 12 s before expiry
  defaultFadeStartRatio: 0.75, // last 25% of life fades out
  defaultSize: 0.4,         // 40 cm bullet hole
  defaultTexture: bulletHoleTex,
});
decals.attach(scene);

const ray = new Raycaster();  // set ray from mouse / muzzle

function onShot() {
  const hits = ray.intersectObjects(walls);
  if (hits.length === 0) return;
  const hit = hits[0];
  decals.spawnFromHit(
    hit.object,               // target mesh (project triangles)
    hit.point,                // world-space hit point
    hit.face?.normal ?? new Vector3(0, 1, 0), // surface normal
    undefined,                // use defaultSize
    {
      normalBias: 0.015,      // 1.5 cm lift to avoid z-fighting
      lifetime: 8,            // shorter than default for combat FX
      fadeStartRatio: 0.6,    // start fading at 4.8 s
    },
  );
}

function frame(dt: number) {
  decals.update(dt);          // advance age, fade, reap expired
  const stats = decals.getStats();
  // stats.count, stats.peakCount, stats.evicted, stats.expired, stats.spawned
}
```

---

## Invariants

- `SkySystem.timeOfDay` is always in `[0, 24)`; `setTime` and `update` wrap
  modulo 24. `update` is a no-op when `enabled === false` and advances in-game
  time at `dt * daySpeed / 60` hours per second. `ProceduralSky` setters clamp
  `turbidity >= 1`, `rayleigh >= 0`, `mieCoefficient >= 0`, `mieDirectionalG`
  in `[-1, 1]`.
- `WeatherSystem.setWeather(type, duration)` starts a transition; `currentType`
  retains the old value until the lerp completes. Calling `setWeather` again
  mid-transition restarts from the *current interpolated* params.
  `getLightningFlash()` returns `[0, 1]` decaying each frame; auto-fire only
  when `currentType === 'storm'` and `lightningEnabled === true`.
- `CloudSystem.update` wraps cloud centers horizontally inside `bounds`; Y is
  not wrapped. `PrecipitationSystem.update` respawns particles that fall below
  `bounds.min.y` at the top; particles crossing a horizontal boundary wrap.
- `VegetationSystem.generate` requires `types.length >= 1` (no-op otherwise).
  The `mulberry32` PRNG reproduces the same instance distribution for the same
  seed + terrain + types. `VegetationType.canPlace` returns `false` if `slope
  > slopeThreshold` or `height` outside `heightThreshold`.
- `WaterSimulation` uses fixed internal step `dt = 0.5` and accumulates real
  time; a single `update` performs at most 256 steps. `update` with `dt <= 0`
  is a no-op. `WaterInteraction.interact` always spawns at least one ripple;
  splashes spawn only when `|velocity| > splashThreshold`.
- `WaterSystem.isUnderwater(point)` is `point.y < waterLevel`; `getUnderwaterFog`
  returns `null` when not underwater. `FFTOcean` clamps `resolution` to the
  nearest power of two in `[2, 2048]`; `getDisplacementMap` / `getNormalMap` /
  `getFoamMap` return `null` until `update` has run after `generateSpectrum`.
- All data-tier `getShaderUniforms()` return a fresh object each call; callers
  must not cache the reference across frames.

---

## Design Notes

**Data tier vs render tier.** Half of the module (`ProceduralSky`,
`VolumetricClouds`, `WaterInteraction`, `FFTOcean`, `VegetationRenderer`) holds
no GL resources — they produce `Float32Array` fields and flat uniform structs,
leaving texture upload and shader binding to the caller. This makes them
unit-testable in Node, portable across render backends, and lets the caller
decide which pass consumes each system.

**Why two skies / three waters / two clouds?** Each pair targets a different
quality / budget tradeoff: `SkySystem` (art-directed keyframes) vs
`ProceduralSky` (Preetham 1999 Rayleigh + Mie); `WaterSimulation` (2D wave
equation) vs `WaterInteraction` (analytic ripples) vs `FFTOcean` (Phillips
spectrum + IFFT); `CloudSystem` (instanced billboards) vs `VolumetricClouds`
(ray-marched 3D noise field). The pairs are independent and can be layered.

**Determinism.** Both vegetation systems use `mulberry32` with an explicit
`seed`; the same seed + terrain + types always reproduce the same instance
positions. `FFTOcean` uses *unnormalized* forward / inverse transforms; the
Phillips `h0(k)` already embeds the `Δk` factor so the final displacement has
correct physical units.

---

## References

- Preetham, A. J., Shirley, P., Smits, B. (1999), "A Practical Analytic Model
  for Daylight" — Rayleigh + Mie scattering used by `ProceduralSky`.
- Tessendorf, J. (2001), "Simulating Ocean Water" — Phillips spectrum, IFFT;
  basis of `FFTOcean`.
- Beer-Lambert + Henyey-Greenstein — `VolumetricClouds.marchRay` lighting.
- Bruneton & Neyret (2008), "Precomputed Atmospheric Scattering" — future path.
- Three.js `Sky` / `Water` — API ergonomics reference.
- Engine `Terrain/TerrainGeometry` (consumed by `VegetationSystem.generate`), `Materials/WaterMaterial` (instantiated by `WaterSystem.create`).
