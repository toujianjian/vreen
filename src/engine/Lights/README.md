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
   └── RectAreaLight           ── rectangle, width × height, PBR-only, no shadow
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

---

## References

- `src/engine/Renderer/WebGL2Renderer.ts` — light uniform upload and the
  shadow pass that consumes `DirectionalLight.shadow`.
- `src/engine/Renderer/ShadowMapManager.ts` — shadow-map FBO / texture
  lifecycle keyed on `light.uuid`.
- `src/engine/Materials/StandardMaterial.ts` — PBR shader that consumes
  directional / point / spot / rect-area light uniforms.
- three.js `Light`, `DirectionalLight`, `PointLight`, `SpotLight`,
  `HemisphereLight`, `RectAreaLight` — API conventions (color parsing,
  `power` unit conversions, `target` object, shadow descriptor shape).
- `src/engine/Lights/index.ts` — barrel re-exports for the module.
