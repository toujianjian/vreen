# Lights Module

> Path: `src/engine/Lights/`
>
> The lighting subsystem of the `@vreen/engine` kernel. Provides the light
> primitives consumed by the `WebGL2Renderer` PBR / IBL pipeline: an abstract
> `Light` base (which is itself an `Object3D` so it can live in the scene
> graph), ambient / hemisphere fill lights, directional sun lights with a
> dedicated shadow descriptor, point and spot lights with physically-based
> inverse-square attenuation, and rectangular area lights for window / light
> strip emulation.

---

## Overview

```
Light (abstract, extends Object3D)
   ├── color: RGBColor          ── parsed by ──→ parseColor()
   ├── intensity: number
   │
   ├── AmbientLight            ── uniform fill, no direction, no shadow
   ├── HemisphereLight         ── sky / ground gradient, no shadow
   ├── DirectionalLight        ── parallel rays, carries DirectionalLightShadow
   │       └── shadow: DirectionalLightShadow  ── ortho camera + mapSize + bias
   ├── PointLight              ── isotropic, distance + decay, power(lm) accessor
   ├── SpotLight               ── cone, target + angle + penumbra + decay
   ├── RectAreaLight           ── rectangle, width × height, PBR-only, no shadow
   │
   └── LightProbe              ── SH-encoded directional ambient (IBL diffuse)
           ├── sh: SphericalHarmonics3   ── 9 coefficients × RGB = 27 floats
           ├── AmbientLightProbe         ── sh = fromColor(color), isotropic
           ├── HemisphereLightProbe      ── sh = sky/ground split on Y axis
           └── ← LightProbeGenerator     ── bakes sh from cubemap (CPU or GPU)
```

All lights are discovered by the renderer through scene-graph traversal —
there is no separate `lightList` to maintain. Because `Light` extends
`Object3D`, a light participates in `matrixWorld` updates and may be parented
to other nodes (e.g. a `SpotLight` attached to a camera flash).

The shared `parseColor()` helper accepts either a 24-bit integer
(`0xRRGGBB`) or a CSS hex string (`'#rrggbb'` / `'#rgb'`) and returns linear
`RGBColor` components in `[0, 1]`. The same convention is used by every
constructor `color` parameter below.

---

## Core Classes

### Base

| Export | Role |
|--------|------|
| `Light` | Abstract base for every light. Extends `Object3D`, holds `color: RGBColor` and `intensity: number`. |
| `parseColor` | Convert a number (`0xRRGGBB`) or hex string to a linear `RGBColor`. |
| `RGBColor` | Type alias `{ r: number; g: number; b: number }`, linear 0..1. |

```ts
export abstract class Light extends Object3D {
  color: RGBColor;
  intensity: number;
  constructor(color: number | string = 0xffffff, intensity = 1);
}
```

Every concrete light sets a unique `type` string and a matching
`is<LightType>: boolean` flag for cheap `instanceof`-free discrimination.

### Fill lights

| Export | Role |
|--------|------|
| `AmbientLight` | Uniform global illumination. No direction, no attenuation, cannot cast shadows. Used to lift shadowed areas. |
| `HemisphereLight` | Sky-to-ground gradient. `color` is the sky color; `groundColor` is the bounce color. Default position `(0, 1, 0)`. Cannot cast shadows. |

```ts
const ambient = new AmbientLight(0x404040, 0.6);
const hemi = new HemisphereLight(0xbfdfff, 0x404030, 0.4);
```

### Directional light + shadow

| Export | Role |
|--------|------|
| `DirectionalLight` | Parallel-ray light (sun). Carries an explicit `direction` (light propagation vector, three.js convention) plus a `target: Object3D` for compatibility. `castShadow` toggles shadow casting; `shadow` holds the shadow camera config. |
| `DirectionalLightShadow` | Orthographic shadow-camera descriptor: `mapSize`, `cameraHalfSize`, `cameraNear`, `cameraFar`, `bias`. Supports `copy()` / `clone()` / `toJSON()`. |

```ts
export class DirectionalLight extends Light {
  direction: { x: number; y: number; z: number };   // propagation direction
  target: Object3D;                                  // three.js-compat target node
  castShadow: boolean;
  shadow: DirectionalLightShadow;
}

export class DirectionalLightShadow {
  mapSize: number;        // default 1024 (square edge, px)
  cameraHalfSize: number; // default 4 (ortho half-extents, light space)
  cameraNear: number;     // default 0.1
  cameraFar: number;      // default 50
  bias: number;           // default 0.001 (acne mitigation)
  copy(source: this): this;
  clone(): DirectionalLightShadow;
  toJSON(): Record<string, unknown>;
}
```

Unlike three.js, VREEN keeps an explicit `direction` field that the
renderer reads directly for the `u_lightDir` uniform and shadow-camera
placement, rather than deriving it from `position → target`.

#### Shadow types (`ShadowMapManager`)

`ShadowMapManager` (in `src/engine/Renderer/ShadowMapManager.ts`)
manages the shadow-map FBO / texture lifecycle and supports three
shadow sampling modes via `ShadowType`:

| Type | Taps | Filter | Description |
|------|------|--------|-------------|
| `'basic'` | 1 | NEAREST | Hard shadow — single depth test. Fastest; aliased edges. |
| `'pcf'` | 9 | LINEAR | 3×3 PCF at fixed 1.5-texel radius. Smooth edges; uniform blur width. **Default.** |
| `'pcss'` | 32 | LINEAR | **PCSS** (Percentage-Closer Soft Shadows). 3-stage physical soft shadows: blocker search (16-tap Poisson) → penumbra estimation → variable-radius PCF (16-tap Poisson). Contact points render sharp; distant occluders render soft — matching real-world light behavior. Requires `lightSize` property (world units, controls penumbra width). |

The sampling functions live in
`src/engine/Materials/ShaderChunks/shadow.glsl.ts`:

| Function | Shader taps | When to use |
|----------|-------------|-------------|
| `sampleShadowHard` | 1 | Performance-critical scenes (mobile, VR). |
| `sampleShadowPCF` | 9 | Default — smooth edges at fixed radius. |
| `sampleShadowPCSS` | 32 | AAA quality — physical soft shadows with variable penumbra. Requires `u_lightSize` uniform. |

**PCSS algorithm** (3-stage, UE5 / o3de Atom grade):

| Stage | Description |
|-------|-------------|
| ① Blocker Search | 16-tap Poisson-disk samples within `searchRadius = u_lightSize × texel × 10`. Average the depth of samples closer than the receiver (blockers). Early-out if no blockers → fully lit. |
| ② Penumbra Estimation | `penumbra = (receiverDepth − avgBlockerDepth) × u_lightSize / avgBlockerDepth`. Near blocker → small penumbra → sharp shadow; far blocker → large penumbra → soft shadow. Clamped to `maxRadius = 50 texels`. |
| ③ PCF Filter | 16-tap Poisson-disk PCF at the estimated penumbra radius. Returns average visibility [0, 1]. |

```ts
import { ShadowMapManager } from '@vreen/engine';

const sm = new ShadowMapManager(gl, {
  type: 'pcss',         // physical soft shadows
  enabled: true,
  lightSize: 0.5,       // larger = softer shadows (world units)
  defaultMapSize: 2048,
});
// Consumer shader calls sampleShadowPCSS(worldPos) — see ShaderChunks/shadow.glsl.ts
```

#### Cascaded Shadow Maps (`CSMShadowMap`)

For large outdoor scenes, a single shadow map cannot cover the entire
view frustum at adequate resolution. `CSMShadowMap` (in
`src/engine/Renderer/CSMShadowMap.ts`) splits the camera frustum into
N cascades (default 4), each with its own shadow map. Near cascades
get high-resolution shadows; far cascades get lower effective
resolution — matching human visual sensitivity to near detail.

| Feature | Description |
|---------|-------------|
| Split scheme | PSSM (logarithmic + uniform blend), configurable via `splitFactor` (0=log, 1=uniform) |
| Cascade count | Default 4; configurable (2/4/8 typical) |
| Map size | Per-cascade; default 1024² |
| Shadow distance | Configurable `shadowDistance` (default 100) |
| Cascade blend | `blendMargin` (default 0.1) — smooth transition at cascade boundaries |
| Frustum fitting | Tight orthographic per cascade (8-corner AABB in light view space) |

**Shader chunk** (`ShaderChunks/csm.glsl.ts`): `sampleCSM(worldPos, viewDepth)` —
selects the cascade by view-space depth, samples with 9-tap PCF, and
blends across the cascade boundary using `smoothstep`.

```ts
import { CSMShadowMap } from '@vreen/engine';

const csm = new CSMShadowMap({
  cascadeCount: 4,
  mapSize: 1024,
  splitFactor: 0.5,    // PSSM blend
  shadowDistance: 200,
});

// Each frame:
csm.update(camera, directionalLight);
// Upload to shader:
//   u_csmVP[4]      = csm.getViewProjectionArray()
//   u_csmSplits[4]  = csm.getSplitDistances()
//   u_csmMaps[4]    = per-cascade shadow map textures
```

#### Screen-space contact shadows (`ScreenSpaceShadowPass`)

In addition to shadow-map shadows, VREEN provides
`ScreenSpaceShadowPass` (in `PostProcess/`) — a post-process pass
that ray-marches the **depth buffer** along the light direction in
screen space to find small-scale occlusion that shadow maps miss
(pixel-precision vs shadow-map-precision).

| Shadow system | Data source | Precision | Range | Directional |
|---------------|-------------|-----------|-------|-------------|
| `ShadowMapManager` (PCSS) | Shadow map | Map-resolution-limited | Full scene | ✓ |
| `ScreenSpaceShadowPass` | Depth buffer | Pixel-level | Small (contact) | ✓ |
| `ContactShadowsPass` | Brightness proxy | Pixel-level | Small (contact) | ✗ |

The three systems are **complementary**: PCSS handles large-scale
scene shadows; `ScreenSpaceShadowPass` adds fine contact shadows at
pixel precision; `ContactShadowsPass` provides a cheaper
non-directional fallback when depth is unavailable.

### Point / Spot lights

| Export | Role |
|--------|------|
| `PointLight` | Isotropic point source. `distance` (0 = infinite) + `decay` (2 = physically correct inverse-square). `power` getter/setter converts between intensity (candela) and luminous flux (lumen): `lm = cd × 4π`. |
| `SpotLight` | Cone light. `target: Object3D`, `distance`, `angle` (radians, ≤ π/2), `penumbra` ∈ [0, 1], `decay`. `power` accessor: `lm = cd × π`. |

```ts
const torch = new PointLight(0xffffff, 2.0, 8, 2);   // 8 m cutoff, inverse-square
torch.power = 400;                                     // set luminous flux in lumens

const spot = new SpotLight(0xfff0c0, 4, 12, Math.PI / 5, 0.4, 2);
spot.position.set(0, 5, 0);
spot.target.position.set(0, 0, 0);
scene.add(spot);
scene.add(spot.target);                                // target must be in scene
```

`distance` semantics: `0` means pure inverse-square falloff to infinity;
non-zero produces a smooth cutoff near the limit (non-physical but art-
friendly).

### Rectangular area light

| Export | Role |
|--------|------|
| `RectAreaLight` | Uniform rectangular emitter. `width`, `height` in world units. `power` accessor: `lm = nit × area × π`. Only supported by PBR materials (`StandardMaterial`); cannot cast shadows. |

```ts
const window = new RectAreaLight(0xfff4e6, 5, 4, 3); // 4 m × 3 m panel
window.position.set(0, 2, -2);
window.lookAt(0, 0, 0);
```

### Light probes (SH-encoded IBL)

Light probes encode the **incident radiance** at a point in space as
spherical-harmonics coefficients, enabling diffuse image-based lighting (IBL)
without runtime cubemap sampling. They complement the analytical lights above:

- `AmbientLight` / `HemisphereLight` are **fast constant fills** — the
  renderer uploads them as a single uniform color.
- `LightProbe` / `AmbientLightProbe` / `HemisphereLightProbe` are **SH-encoded
  directional fills** — the renderer uploads 9 RGB coefficients (27 floats)
  that the PBR shader evaluates per-pixel for view-independent diffuse IBL.

Use probes when you need directional ambient (e.g. an indoor scene where the
dominant light comes from a window on one side) or when baking IBL from an
environment cubemap via `LightProbeGenerator`.

| Export | Role |
|--------|------|
| `LightProbe` | Base probe node. Extends `Light`, holds `sh: SphericalHarmonics3`. Default `sh` is all-zero; populate manually or via `LightProbeGenerator`. Cannot cast shadows. |
| `SphericalHarmonics3` | 3-band (9-coefficient × 3-channel = 27-float) real SH representation. Stored as `Float32Array(27)` for direct GPU uniform upload. Supports `copy` / `clone` / `add` / `addScaledSH` / `scale` / `lerp` / `equals`. Static `fromColor()` creates an isotropic SH; `evalSH(dir)` evaluates the 9 basis functions at a direction. |
| `AmbientLightProbe` | Pre-computed `LightProbe` with `sh = SphericalHarmonics3.fromColor(color)`. Encodes a uniform ambient as SH band-0 constant term (`color / 9`). Drop-in replacement for `AmbientLight` when you need SH pipeline uniformity. |
| `HemisphereLightProbe` | Pre-computed `LightProbe` with sky/ground colors split across SH band-0 (sum) and band-1 Y₁⁻¹ (difference). Encodes the same sky/ground gradient as `HemisphereLight` but in SH form, enabling mixing with other probes via `sh.add()`. |

```ts
export class SphericalHarmonics3 {
  coefficients: Float32Array;          // length 27 (9 SH coeffs × 3 RGB)
  set(coefficients: ArrayLike<number>): this;
  copy(sh: SphericalHarmonics3): this;
  clone(): SphericalHarmonics3;
  add(sh: SphericalHarmonics3): this;          // this += sh
  addScaledSH(sh: SphericalHarmonics3, s: number): this;  // this += sh * s
  scale(s: number): this;                      // this *= s
  lerp(sh: SphericalHarmonics3, alpha: number): this;     // this += (sh - this) * alpha
  equals(sh: SphericalHarmonics3): boolean;
  static fromColor(color: RGBColor): SphericalHarmonics3; // isotropic band-0
  static evalSH(direction: Vector3): Float32Array;        // 9 basis values at dir
}

export class LightProbe extends Light {
  override readonly type: string = 'LightProbe';
  isLightProbe: boolean = true;
  sh: SphericalHarmonics3;
  constructor(color: number | string = 0xffffff, intensity = 1);
  copy(source: LightProbe): this;
  override toJSON(meta?: unknown): Record<string, unknown>;
}

export class AmbientLightProbe extends LightProbe {
  override readonly type: string = 'AmbientLightProbe';
  isAmbientLightProbe: boolean = true;
  constructor(color: number | string = 0xffffff, intensity = 1);
  // sh = SphericalHarmonics3.fromColor(parseColor(color))
}

export class HemisphereLightProbe extends LightProbe {
  override readonly type: string = 'HemisphereLightProbe';
  isHemisphereLightProbe: boolean = true;
  constructor(
    skyColor: number | string = 0xffffff,
    groundColor: number | string = 0xffffff,
    intensity = 1,
  );
  // sh band-0 = (sky + ground) * sqrt(PI)
  // sh band-1 Y₁⁻¹ = (sky - ground) * sqrt(PI) * sqrt(0.75)
}
```

**SH coefficient layout** (`SphericalHarmonics3.coefficients`, `Float32Array(27)`):

| Index | Band | Basis | Direction | Scalar factor |
|-------|------|-------|-----------|----------------|
| 0..2  | 0 | Y₀⁰  | constant (isotropic) | 0.282095 |
| 3..5  | 1 | Y₁⁻¹ | y (up/down) | 0.488603 |
| 6..8  | 1 | Y₁⁰  | z (front/back) | 0.488603 |
| 9..11 | 1 | Y₁¹  | x (left/right) | 0.488603 |
| 12..14| 2 | Y₂⁻² | xy | 1.092548 |
| 15..17| 2 | Y₂⁻¹ | yz | 1.092548 |
| 18..20| 2 | Y₂⁰  | 3z²−1 | 0.315392 |
| 21..23| 2 | Y₂¹  | xz | 1.092548 |
| 24..26| 2 | Y₂²  | x²−y² | 0.546274 |

Each group of 3 consecutive floats is one RGB coefficient. The PBR shader
reconstructs diffuse irradiance as `E = Σ shᵢ · Yᵢ(n)` where `n` is the
surface normal.

**Probe vs. fill light.** `AmbientLight` and `AmbientLightProbe` produce the
same visual result for a uniform color. The difference is pipeline:
`AmbientLight` uploads a single `vec3` uniform; `AmbientLightProbe` uploads
the full 27-float SH array. Use probes when (a) mixing with `LightProbeGenerator`
output, (b) blending multiple probes via `sh.lerp()`, or (c) the PBR shader
already has the SH evaluation path wired for cubemap-baked probes.

**Why VREEN has both.** three.js also ships both `AmbientLight` and
`AmbientLightProbe`. VREEN mirrors the split for API compatibility and
pipeline flexibility: the fast path uses fill lights, the IBL path uses
probes, and both coexist in the same scene.

### `LightProbeGenerator` (`LightProbeGenerator.ts`)

Bakes a `LightProbe` (SH2 spherical-harmonics irradiance) from a cubemap
or a list of RGBA face buffers. Implements the diffuse-convolution
projection from Ramamoorthi & Hanrahan 2001: each texel's radiance is
weighted by the SH basis function evaluated at its direction and
accumulated into the 9 RGB coefficients of `SphericalHarmonics3`.

| Method | Signature | Role |
|--------|-----------|------|
| `fromCubeRenderTarget` | `(renderer, cubeRT) → LightProbe` | Sample a `WebGLCubeRenderTarget`'s 6 faces (renderer path). |
| `fromCubeImage` | `(image, config?) → LightProbe` | Integrate a single equirect / cube image into SH2. |
| `fromRGBAFaces` | `(faces, size, config?) → LightProbe` | Pure-CPU integration from 6 `Uint8Array`/`Float32Array` face buffers (headless-testable). |

The pure-CPU `fromRGBAFaces` path makes the generator testable in
Node/headless environments (no WebGL context required). The output
`LightProbe.sh` feeds PBR materials as the diffuse-IBL term, complementing
the specular IBL handled by `ReflectionProbe`.

```ts
import { LightProbeGenerator } from '@vreen/engine';
const probe = LightProbeGenerator.fromRGBAFaces(faces, 128);
scene.add(probe); // probe.sh used by StandardMaterial as diffuse IBL
```

Adapted from three.js `LightProbeGenerator.js`. Math only — no WebGL
dependency in the CPU path.

---

## Usage

```ts
import {
  AmbientLight, HemisphereLight, DirectionalLight,
  PointLight, SpotLight, RectAreaLight, Scene,
} from '@vreen/engine';

const scene = new Scene();

// Fill — sky/ground gradient + small ambient lift
scene.add(new AmbientLight(0x303040, 0.3));
const hemi = new HemisphereLight(0xbfdfff, 0x404030, 0.5);
scene.add(hemi);

// Sun — single cast-shadow directional
const sun = new DirectionalLight(0xfff2d6, 3.0, { x: 0.4, y: -0.8, z: 0.3 });
sun.castShadow = true;
sun.shadow.mapSize = 2048;
sun.shadow.cameraHalfSize = 6;
sun.shadow.bias = 0.0005;
scene.add(sun);

// Practical lights
const lamp = new PointLight(0xffd28a, 8.0, 5, 2);
lamp.position.set(2, 1.2, 1);
scene.add(lamp);

const spot = new SpotLight(0xffffff, 12, 10, Math.PI / 6, 0.5, 2);
spot.position.set(0, 4, 0);
scene.add(spot, spot.target);

const panel = new RectAreaLight(0xfff4e6, 4, 3, 2);
panel.position.set(-2, 2, -2);
scene.add(panel);
```

### Image-based lighting (IBL) with light probes

```ts
import {
  AmbientLightProbe, HemisphereLightProbe, LightProbe,
  LightProbeGenerator, Scene,
} from '@vreen/engine';

const scene = new Scene();

// 1. Quick directional ambient — sky warm, ground cool
const hemi = new HemisphereLightProbe(0xbfdfff, 0x404030, 0.8);
scene.add(hemi);

// 2. Bake a probe from an environment cubemap (CPU path, headless-testable)
//    faces: [px, nx, py, ny, pz, nz] — 6 Uint8Array or Float32Array buffers
const baked = LightProbeGenerator.fromRGBAFaces(faces, 128);
baked.intensity = 1.2;
scene.add(baked);

// 3. Blend two probes for a time-of-day transition
const night = new AmbientLightProbe(0x202040, 0.3);
const dawn = new HemisphereLightProbe(0xffcc88, 0x404030, 0.6);
// Lerp SH coefficients: night.sh → dawn.sh over t ∈ [0, 1]
const t = 0.5;
night.sh.lerp(dawn.sh, t);
night.intensity = 0.3 + (0.6 - 0.3) * t;
scene.add(night);

// The PBR shader evaluates: E(n) = Σ shᵢ · Yᵢ(n)  for each surface normal n
```

The `WebGL2Renderer` collects lights during the per-frame scene traversal
and uploads them as uniform arrays; the shadow pass runs once per
`DirectionalLight` with `castShadow === true`.

---

## Invariants

- `Light` is abstract; only the eight concrete subclasses are constructible.
- `color` is always stored as linear `RGBColor` (0..1). Constructors accept
  either `0xRRGGBB` integers or `'#rrggbb'` strings — `parseColor` handles
  both, including 3-digit shorthand.
- `direction` on `DirectionalLight` is the **propagation direction** (from
  light toward illuminated surface), matching the three.js convention;
  default is `(0, -1, 0)`.
- `decay = 2` is the physically correct inverse-square value for
  `PointLight` and `SpotLight`; `0` / `1` give constant / linear falloff.
- `power` accessors on `PointLight`, `SpotLight`, and `RectAreaLight` are
  pure unit conversions — they read/write `intensity` without storing
  separate state.
- Only `DirectionalLight` can cast shadows (`castShadow` + `shadow`).
  `AmbientLight`, `HemisphereLight`, and `RectAreaLight` have no shadow
  path; `PointLight` and `SpotLight` declare no shadow fields in this
  module (cube-shadow support is a planned extension).
- `RectAreaLight` is PBR-only — non-PBR materials (`MeshBasicMaterial`,
  `MeshPhongMaterial`) ignore it.
- `DirectionalLightShadow.toJSON()` is round-trippable: the field set is
  exactly the constructor's tunable parameters.
- `LightProbe` and its subclasses (`AmbientLightProbe`,
  `HemisphereLightProbe`) **cannot cast shadows** — `castShadow` is not
  declared on the probe hierarchy. Probes encode incident radiance, not
  outgoing radiance, so a shadow map is meaningless.
- `SphericalHarmonics3.coefficients` is always a `Float32Array(27)` —
  exactly 9 RGB coefficients for bands 0–2. Mutating methods (`add`,
  `addScaledSH`, `scale`, `lerp`) operate in-place; use `clone()` first
  when you need to preserve the source.
- `AmbientLightProbe.sh` is set once in the constructor from
  `SphericalHarmonics3.fromColor(color)` — re-coloring the probe after
  construction by mutating `color` will **not** refresh `sh`. Re-create
  the probe or call `sh = SphericalHarmonics3.fromColor(parseColor(newColor))`.
- `HemisphereLightProbe.sh` likewise is baked at construction from
  `skyColor` + `groundColor`. The two-color gradient is split across
  band-0 (sum) and band-1 Y₁⁻¹ (difference); bands 1 Y₁⁰ / Y₁¹ and all
  of band-2 remain zero (no x/z asymmetry, no second-order detail).
- `LightProbe.toJSON()` serializes `sh` as a plain `number[]` via
  `Array.from(coefficients)` — round-trippable with the matching
  constructor pattern `new LightProbe().sh.set(json.sh)`.
- `LightProbeGenerator` produces a fresh `LightProbe` whose `sh` is
  populated; it never mutates an existing probe. The returned probe has
  `intensity = 1` and `color = 0xffffff` by default — adjust before
  adding to the scene.

---

## Design Notes

**Why `Light` extends `Object3D`.** Making lights scene-graph nodes means
the renderer discovers them by traversing `children` — no separate
`lightList` to keep in sync. A `SpotLight` can be parented to a camera
(flashlight), a `PointLight` to a projectile, and the world matrix
propagates automatically. The trade-off is that `color` and `intensity`
live alongside transform fields on the same object.

**Explicit `direction` on `DirectionalLight`.** three.js derives the
light direction from `position → target`. VREEN keeps an explicit
`direction` vector that the renderer reads directly for the `u_lightDir`
uniform and shadow-camera placement, because the self-hosted WebGL2
pipeline never needed the `target` indirection. The `target: Object3D`
field is retained for three.js compatibility and future target-following
extensions, but the renderer currently ignores it.

**Why only `DirectionalLight` casts shadows.** Directional shadow maps
need a single orthographic camera — cheap and well-understood. Point
lights would require six-face cube shadow maps and spot lights a
perspective shadow camera; both are planned but not yet wired through
`ShadowMapManager`. The `castShadow` flag and `shadow` descriptor exist
only on `DirectionalLight` to make the supported set explicit.

**`power` accessor convention.** `PointLight`, `SpotLight`, and
`RectAreaLight` expose `power` (lumens) as a pure unit-conversion
accessor over `intensity` (candela / nit). The factors — `4π` for
isotropic point, `π` for spot cone, `area × π` for rectangle — match
three.js so that physically-based scene setups port directly. Setting
`power` writes `intensity` and vice-versa; no separate state is stored.

**`distance` / `decay` semantics.** `decay = 2` is the physically
correct inverse-square law. `distance = 0` means falloff continues to
infinity; non-zero `distance` produces a smooth (non-physical) cutoff
near the limit so artists can control practical light radius. This
matches the three.js convention and lets the same scene files work in
both engines.

**Color is linear.** `parseColor` returns linear RGB in `[0, 1]` — no
sRGB-to-linear conversion, because the engine's PBR shader expects
linear inputs and asset colors are authored linear. Hex parsing handles
both 3-digit (`#abc`) and 6-digit (`#aabbcc`) shorthand.

**Why probes mirror three.js's split.** VREEN ships both `AmbientLight`
(fast `vec3` uniform fill) and `AmbientLightProbe` (full 27-float SH
upload) for the same reason three.js does: the fast path is the right
answer for 90% of scenes, but the SH path is required when (a) the
dominant ambient has direction (a window-lit room, a sky-LUT bake), (b)
multiple probes must be blended via `sh.lerp()` for time-of-day, or (c)
a baked `LightProbeGenerator` output must flow into the same uniform
slot as the analytical fills. Mirroring the three.js API also lets
existing three.js scene files port with minimal churn.

**Why `SphericalHarmonics3` uses `Float32Array(27)`.** three.js stores
9 `Vector3` objects (96+ bytes of heap allocations + 9 pointer chases
on uniform upload). VREEN flattens to 27 contiguous floats — one
allocation, one `gl.uniform3fv` call, cache-friendly for the renderer's
per-frame upload. The trade-off is that the `Vector3` API (`add`,
`lerp`, etc.) is replaced by typed-array math, but the
`SphericalHarmonics3` methods (`add`, `addScaledSH`, `scale`, `lerp`)
cover the same operations with fewer indirections.

**Why `LightProbe` constructor takes `color`, not `sh`.** three.js's
`LightProbe` constructor accepts `(sh, intensity)` because probes are
typically baked via `LightProbeGenerator` and the `sh` is the primary
payload. VREEN instead takes `(color, intensity)` to stay consistent
with the `Light` base class and all other concrete lights — `color`
doubles as a debug-tint the renderer can use to visualize the probe's
origin, while `sh` is populated independently (manually, by the
`AmbientLightProbe` / `HemisphereLightProbe` subclasses, or by
`LightProbeGenerator.fromRGBAFaces`). This keeps the Light hierarchy's
constructor signature uniform and lets probes be added to a scene
before their SH is finalized (e.g. lazy-baked on first frame).

**Why `HemisphereLightProbe` only uses band-0 + band-1 Y₁⁻¹.** A
hemisphere gradient is symmetric around the Y axis — the sky is "up"
and the ground is "down", with no preferred X or Z direction. In SH
terms that means only the Y-aligned basis (band-1 Y₁⁻¹, factor
`0.488603·y`) carries the directional difference; the X/Z bases (Y₁⁰,
Y₁¹) and all band-2 terms are zero by symmetry. The implementation
encodes this directly: band-0 = `(sky + ground)·√π`, band-1 Y₁⁻¹ =
`(sky − ground)·√π·√0.75`. This is mathematically identical to three.js
and to the closed-form SH projection of a hemi-cosine lobe.

**`LightProbeGenerator` CPU path.** The `fromRGBAFaces` entry point is
pure-CPU — no WebGL context — so it can run in Node tests, in a
build-time bake step, or in a Web Worker. The math is the Ramamoorthi-
Hanrahan 2001 diffuse-convolution projection: each texel's solid angle
weights its radiance into the 9 SH coefficients. Solid angle is
computed via the exact trapezoidal rule (`dω = sin(θ)·dθ·dφ`), not the
constant-per-texel approximation three.js uses for cube faces — the
result is a slightly more accurate bake at the cost of one `sin` per
texel. The GPU path (`fromCubeRenderTarget`) is a thin wrapper that
reads back the cube RT's faces and dispatches to `fromRGBAFaces`.

---

## Comparison with soup3D

`soup3D` (https://github.com/OrenLiu/soup3D) ships only basic analytical
lights — a flat ambient, a directional sun, and (in some forks) a point
light. The VREEN `Lights` module surpasses it on every axis that
matters for a modern PBR pipeline:

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Ambient fill | Single `vec3` color | `AmbientLight` (fast path) **+** `AmbientLightProbe` (SH path) |
| Hemisphere gradient | Not available | `HemisphereLight` **+** `HemisphereLightProbe` (SH-encoded, blendable) |
| Directional sun + shadow | Sun only, no shadow | `DirectionalLight` + `DirectionalLightShadow` (ortho camera, `mapSize`, `bias`) |
| **Shadow types** | **None** | `'basic'` (hard) / `'pcf'` (9-tap) / **`'pcss'`** (32-tap physical soft shadows) |
| **Screen-space contact shadows** | **None** | `ScreenSpaceShadowPass` (depth-buffer ray-march along light direction) |
| **Contact shadows (brightness)** | **None** | `ContactShadowsPass` (brightness-proxy, non-directional) |
| Point light | Partial, no decay model | `PointLight` with `distance`/`decay` (inverse-square default) + `power` (lm) accessor |
| Spot light | Not available | `SpotLight` with `angle`/`penumbra`/`decay` + `target` + `power` accessor |
| Rectangular area light | Not available | `RectAreaLight` (`width × height`, PBR-only, `power` accessor) |
| **Light probes (SH-encoded IBL)** | **None** | `LightProbe` + `SphericalHarmonics3` (3-band, 27 floats) |
| **Probe baking** | **None** | `LightProbeGenerator.fromRGBAFaces` (pure-CPU, headless-testable) + `fromCubeRenderTarget` (GPU path) |
| **SH blending / time-of-day** | **None** | `sh.add` / `sh.lerp` / `sh.addScaledSH` for probe mixing |
| Color parsing | Manual | `parseColor` accepts `0xRRGGBB` + `'#rgb'` / `'#rrggbb'` shorthand, returns linear RGB |
| Power (lumen) API | Not available | `power` getter/setter on `PointLight` / `SpotLight` / `RectAreaLight` |
| Shadow descriptor | None | Round-trippable `DirectionalLightShadow.toJSON()` |

**Where VREEN pulls ahead.**

- **Image-based lighting.** soup3D has no probe concept — every scene
  must be lit purely analytically, which makes art-directed indoor
  scenes (window light, bounce cards, baked GI) effectively impossible.
  VREEN's `LightProbe` + `LightProbeGenerator` pair lets artists bake
  an environment cubemap into 27 floats and feed it to the PBR shader
  as the diffuse-IBL term, matching the UE5 / o3de workflow.
- **Directional ambient.** soup3D's flat ambient cannot express
  "sky-warm / ground-cool" without extra shader work. VREEN's
  `HemisphereLightProbe` encodes the gradient in SH band-1 Y₁⁻¹ for
  free, and multiple probes can be blended via `sh.lerp()` for
  time-of-day transitions.
- **Physically-based units.** `power` accessors on point / spot / rect
  lights let scenes be authored in lumens (matching real-world
  photometric data) and ported between engines without re-tuning.
  soup3D exposes only a unitless "intensity".
- **Shadow pipeline.** soup3D has no shadow path at all. VREEN's
  `ShadowMapManager` supports three shadow modes: `'basic'` (hard),
  `'pcf'` (9-tap fixed-radius), and **`'pcss'`** (32-tap physical soft
  shadows with blocker search + penumbra estimation + variable-radius
  PCF — the same algorithm used by UE5 and o3de Atom). Additionally,
  `ScreenSpaceShadowPass` ray-marches the depth buffer along the light
  direction for pixel-precision contact shadows that complement
  shadow-map shadows. Three complementary systems: PCSS for large-scale
  scene shadows, ScreenSpaceShadow for fine contact shadows, and
  ContactShadowsPass for a cheaper non-directional fallback.
- **API surface.** Every VREEN light is a scene-graph `Object3D`, so a
  `SpotLight` can be parented to a camera (flashlight) or a
  `PointLight` to a projectile without a separate `lightList` to keep
  in sync. soup3D's lights are standalone objects with no transform
  hierarchy.

**Where soup3D still matches.** For the simplest "sun + ambient"
outdoor scene, both engines produce equivalent results — VREEN's
`AmbientLight` fast path uploads the same `vec3` uniform soup3D would.
The VREEN advantage only materializes when the scene needs IBL,
directional ambient, shadows, or physically-based units, which is the
common case for production rendering.

---

## References

- `src/engine/Renderer/WebGL2Renderer.ts` — light uniform upload and the
  shadow pass that consumes `DirectionalLight.shadow`.
- `src/engine/Renderer/ShadowMapManager.ts` — shadow-map FBO / texture
  lifecycle keyed on `light.uuid`. Supports `'basic'` / `'pcf'` / `'pcss'`
  shadow types with `lightSize` for PCSS penumbra control.
- `src/engine/Materials/ShaderChunks/shadow.glsl.ts` — GLSL shadow
  sampling functions: `sampleShadowHard`, `sampleShadowPCF`,
  `sampleShadowPCSS` (3-stage PCSS with 16-tap Poisson blocker search +
  variable-radius PCF).
- `src/engine/Renderer/PostProcess/ScreenSpaceShadowPass.ts` —
  screen-space directional contact shadows (depth-buffer ray-march
  along light direction).
- `src/engine/Materials/StandardMaterial.ts` — PBR shader that consumes
  directional / point / spot / rect-area light uniforms and the SH
  uniform array uploaded from `LightProbe.sh`.
- `src/engine/Lights/LightProbe.ts` — `SphericalHarmonics3` and base
  `LightProbe` implementation.
- `src/engine/Lights/AmbientLightProbe.ts` — isotropic ambient as SH.
- `src/engine/Lights/HemisphereLightProbe.ts` — sky/ground gradient as SH.
- `src/engine/Lights/LightProbeGenerator.ts` — cubemap → SH2 baker
  (CPU `fromRGBAFaces` + GPU `fromCubeRenderTarget`).
- three.js `Light`, `DirectionalLight`, `PointLight`, `SpotLight`,
  `HemisphereLight`, `RectAreaLight`, `LightProbe`,
  `AmbientLightProbe`, `HemisphereLightProbe`, `LightProbeGenerator` —
  API conventions (color parsing, `power` unit conversions, `target`
  object, shadow descriptor shape, SH coefficient layout).
- Ramamoorthi & Hanrahan 2001, *"An Efficient Representation for
  Irradiance Environment Maps"* — the SH diffuse-convolution math
  underlying `LightProbeGenerator`.
- Sloán 2008, *"Stupid Spherical Harmonics (SH) Tricks"* — coefficient
  layout, normalization factors, and blending identities used by
  `SphericalHarmonics3`.
- `src/engine/Lights/index.ts` — barrel re-exports for the module.
