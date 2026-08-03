# ShaderChunks Module

> Path: `src/engine/Materials/ShaderChunks/`
>
> Reusable GLSL shader code fragments that can be injected into
> `ShaderMaterial` via `#include` directives or string concatenation.
> Provides a library of common lighting, BRDF, utility, and PBR functions
> adapted from three.js's `ShaderChunk` system.

---

## Overview

The ShaderChunks system allows shaders to be composed from reusable
fragments rather than copy-pasted. Each chunk is a string constant
containing GLSL code (functions, uniforms, varyings, or complete
shader stages).

```
ShaderChunks/
  ├── index.ts            ← barrel export + GLSL composer
  ├── lighting.ts         ← BRDF, direct/indirect lighting
  ├── pbr.ts              ← PBR material model (Cook-Torrance)
  ├── fog.ts              ← Fog integration
  ├── common.ts           ← Math utilities, constants
  ├── envmap.ts           ← Environment map sampling
  └── shaderLib.ts        ← Pre-composed shader programs
```

---

## Usage

### Including a Chunk in a Shader

```ts
import { ShaderChunks } from './ShaderChunks';

const vertexShader = `
  ${ShaderChunks.common}
  ${ShaderChunks.fog_pars_vertex}
  void main() {
    // ...
    ${ShaderChunks.fog_vertex}
  }
`;
```

### Available Chunks

#### Common (`common.ts`)

| Chunk | Description |
|-------|-------------|
| `common` | PI, EPS, saturate, pow2, etc. |
| `rgb2hsv` / `hsv2rgb` | Color space conversion |
| `linearToSRGB` / `sRGBToLinear` | Gamma conversion |
| `ACESToneMapping` | ACES filmic tonemap |
| `getShadowMask` | Shadow mask computation |

#### PBR (`pbr.ts`)

| Chunk | Description |
|-------|-------------|
| `pbr_pars_fragment` | PBR uniform declarations |
| `pbr_fragment` | Cook-Torrance BRDF evaluation |
| `BRDF_Lambert` | Lambertian diffuse term |
| `BRDF_GGX` | GGX/Trowbridge-Reitz specular term |
| `D_GGX` | Normal distribution function |
| `G_SmithGGXCorrelated` | Geometry shadowing function |
| `F_Schlick` | Fresnel approximation |

#### Lighting (`lighting.ts`)

| Chunk | Description |
|-------|-------------|
| `lights_pars` | Light uniform declarations |
| `lights_fragment_begin` | Direct lighting loop (PBR) |
| `lights_fragment_end` | Ambient + emissive |
| `transmission_pars` | Transmission (refraction) |

#### Environment (`envmap.ts`)

| Chunk | Description |
|-------|-------------|
| `envmap_pars` | Envmap uniform + sampling |
| `envmap_physical_pars` | Prefiltered envmap sampling |
| `getIBLIrradiance` | Diffuse IBL (SH2 or cubemap) |
| `getIBLRadiance` | Specular IBL (prefiltered mip) |

#### Fog (`fog.ts`)

| Chunk | Description |
|-------|-------------|
| `fog_pars` | Fog uniform declarations |
| `fog_fragment` | Apply fog to final color |

#### Shadow (`shadow.ts`)

Three shadow sampling functions of increasing quality:

| Function | Taps | Description |
|----------|------|-------------|
| `sampleShadowHard` | 1 | Hard shadow (single depth test). Fastest; aliased edges. |
| `sampleShadowPCF` | 9 | 3×3 PCF at fixed 1.5-texel radius. Smooth edges; uniform blur width. |
| `sampleShadowPCSS` | 32 | **PCSS** (Percentage-Closer Soft Shadows). 3-stage physical soft shadows: blocker search (16-tap Poisson) → penumbra estimation → variable-radius PCF (16-tap Poisson). Contact points render sharp; distant occluders render soft — matching real-world light behavior. Requires `u_lightSize` uniform. |

**PCSS algorithm** (UE5 / o3de Atom grade):

| Stage | Description |
|-------|-------------|
| ① Blocker Search | Sample 16 Poisson-disk points within `searchRadius = u_lightSize × texel × 10`. Average the depth of samples that are closer than the receiver (blockers). Early-out if no blockers → fully lit. |
| ② Penumbra Estimation | `penumbra = (receiverDepth − avgBlockerDepth) × u_lightSize / avgBlockerDepth`. Near blocker → small penumbra → sharp shadow; far blocker → large penumbra → soft shadow. Clamped to `maxRadius = 50 texels`. |
| ③ PCF Filter | 16-tap Poisson-disk PCF at the estimated penumbra radius. Returns average visibility [0, 1]. |

**Required uniforms** (all three functions):

```glsl
uniform sampler2D u_shadowMap;
uniform mat4      u_lightVP;
uniform float     u_shadowBias;
uniform vec2      u_shadowMapSize;
uniform int       u_shadowEnabled;
// PCSS only:
uniform float     u_lightSize;   // 光源尺寸(世界单位,控制半影宽度)
```

#### SpecularAA (`specularAA.glsl.ts`)

Specular anti-aliasing via **Toksvig / LEAN filtering**. Eliminates the
specular highlight shimmering/crawling that plagues PBR engines at
distance — when a bumpy normal-mapped surface is viewed from far away,
each pixel covers many texels of normal variation, but the shader only
samples one normal, producing a single sharp highlight that flickers
frame-to-frame as the camera moves. SpecularAA detects this by
estimating normal variance from screen-space derivatives and
**increasing the effective roughness** where variance is high, smoothing
the highlight into a stable broad sheen.

| Export | Description |
|--------|-------------|
| `SPECULAR_AA_CHUNK` | `applySpecularAA(N, roughness)` function — for custom shaders via `#include <specular_aa>` |
| `SPECULAR_AA_INLINE` | Inline block — for direct `#ifdef` embedding in PBR_FRAG |

**Algorithm** (UE5 "Anti-Aliasing Specular Highlights" + o3de Atom SpecularAA):

```glsl
float applySpecularAA(vec3 N, float roughness) {
  vec3 dNdx = dFdx(N);           // screen-space normal derivative
  vec3 dNdy = dFdy(N);
  float variance = dot(dNdx, dNdx) + dot(dNdy, dNdy);
  // Variance ↑ (bumpy surface at distance) → roughness ↑ → highlight smooths
  return clamp(sqrt(roughness * roughness + variance * 0.25), 0.045, 1.0);
}
```

| Component | Role |
|-----------|------|
| `dFdx(N)` / `dFdy(N)` | Screen-space normal derivatives — capture both geometric curvature and normal-map detail in a single metric |
| `variance` | Sum of squared derivatives — high when normals vary rapidly across the pixel footprint |
| `sqrt(r² + variance × 0.25)` | Toksvig roughness boost — widens the GGX lobe to account for sub-pixel normal variation. The `0.25` constant is the UE5 strength factor |
| `clamp(..., 0.045, 1.0)` | Prevents roughness from going below 0.045 (would produce infinitesimally thin highlights — worse than the original shimmer) or above 1.0 (diffuse-only) |

**PBR_FRAG integration** — opt-in via `#define USE_SPECULAR_AA`:

The standard `PBR_FRAG` shader includes the SpecularAA block behind an
`#ifdef USE_SPECULAR_AA` guard, inserted after the normal-map TBN
section and the metallicRoughnessMap sampling, but before the GGX
`a = roughness²` computation. This ensures the modified roughness
flows into all downstream BRDF math (D_GGX, V_SmithGGXCorrelated,
F_Schlick, IBL mip selection).

```glsl
// In PBR_FRAG, after roughness is finalized:
#ifdef USE_SPECULAR_AA
  {
    vec3 dNdx_aa = dFdx(N);
    vec3 dNdy_aa = dFdy(N);
    float variance_aa = dot(dNdx_aa, dNdx_aa) + dot(dNdy_aa, dNdy_aa);
    roughness = clamp(sqrt(roughness * roughness + variance_aa * 0.25), 0.045, 1.0);
  }
#endif
a = max(roughness * roughness, 0.0025);
```

When `USE_SPECULAR_AA` is **not** defined, the block is compiled out —
zero cost, identical to previous behavior. This makes it safe to enable
per-material or globally via a renderer quality setting.

**Usage in custom shaders:**

```ts
import { SPECULAR_AA_CHUNK } from '@vreen/engine/Materials/ShaderChunks';

const fragShader = `
  ${SPECULAR_AA_CHUNK}
  void main() {
    // ... sample normal map, compute N and roughness ...
    roughness = applySpecularAA(N, roughness);
    // ... proceed with GGX BRDF ...
  }
`;
```

**Comparison with soup3D.** soup3D has no PBR pipeline and therefore no
specular aliasing problem — but also no path to physically-based
materials. VREEN's SpecularAA solves a problem that only arises at AAA
rendering quality, and its opt-in `#ifdef` design means the cost is paid
only when the integrator needs it.

**Design Notes:**

- **Why screen-space derivatives (not precomputed)?** Precomputed
  variance (Toksvig's original mipmapping approach, or LEAN mapping's
  precomputed texture) requires offline asset processing and extra
  texture channels. Screen-space `dFdx/dFdy` captures the same
  information at runtime with zero asset-pipeline cost — the trade-off
  is a small per-fragment compute cost (2 derivative evaluations +
  dot products). This is the approach UE5 and o3de Atom use.
- **Why `0.25` strength factor?** This controls how aggressively
  variance increases roughness. UE5 uses `0.25` as the default; lower
  values (e.g. `0.1`) produce subtler anti-aliasing (some shimmer
  remains), higher values (e.g. `0.5`) over-blur highlights. The
  constant is baked into the shader for performance — to tune it,
  replace the literal in the chunk or PBR_FRAG.
- **Why `0.045` minimum?** Below ~0.045, the GGX lobe becomes so narrow
  that a single specular highlight pixel can be brighter than the
  surrounding area by 100×+, which is the root cause of "fireflies"
  (specular speckle) in PBR rendering. Clamping to 0.045 keeps the
  lobe wide enough to anti-alias naturally under TAA.
- **Composes with TAA.** SpecularAA reduces the *spatial* frequency of
  specular highlights (widening the lobe), while TAA handles the
  *temporal* stability (accumulating sub-pixel samples). Together they
  eliminate both spatial shimmer and temporal flicker. Run SpecularAA
  in the material shader (GBuffer pass), then TAA in post-processing.

**References:**
- Toksvig (2005), "Mipmapping Normal Maps"
- Olano & Baker (2010), "LEAN Mapping"
- UE5, "Anti-Aliasing Specular Highlights"
- o3de Atom, `SpecularAA` pass

---

## GLSL Composer (`index.ts`)

The `composeShader(source)` function resolves `#include <chunk_name>`
directives by replacing them with the corresponding chunk string:

```glsl
// Input:
#include <common>
#include <pbr_pars_fragment>
void main() { /* ... */ }

// Output: common + pbr_pars_fragment + main()
```

This mirrors three.js's `ShaderChunk.parseIncludes()` behavior, adapted
for VREEN's ESM TypeScript module system.

---

## Integration with ShaderMaterial

```ts
import { ShaderMaterial } from '@/engine/Materials/ShaderMaterial';
import { ShaderChunks } from './ShaderChunks';

const material = new ShaderMaterial({
  vertexShader: ShaderChunks.pbr_vertex,
  fragmentShader: ShaderChunks.pbr_fragment,
  uniforms: {
    u_baseColor: { value: new Color(0.8, 0.2, 0.2) },
    u_metalness: { value: 0.0 },
    u_roughness: { value: 0.5 },
  },
});
```

---

## References

| Topic | Source |
|-------|--------|
| Cook-Torrance BRDF | Cook & Torrance, "A Reflectance Model for Computer Graphics" (1982) |
| GGX/Trowbridge-Reitz | Walter et al., "Microfacet Models for Refraction" (2007) |
| Schlick Fresnel | Schlick, "An Inexpensive BRDF Model for Physically-based Rendering" (1994) |
| three.js ShaderChunk | https://threejs.org/docs/#api/en/renderers/webgl/WebGLProgram |
