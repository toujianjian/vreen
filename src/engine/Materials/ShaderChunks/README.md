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
