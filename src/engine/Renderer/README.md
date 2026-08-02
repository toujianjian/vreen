# Renderer Module

> Path: `src/engine/Renderer/`
>
> The rendering subsystem of the `@vreen/engine` kernel. Provides a pluggable
> `Renderer` interface backed by a concrete `WebGL2Renderer` implementation
> featuring PBR / IBL, real-time shadow mapping, MRT-based deferred rendering,
> a composable post-processing pipeline, and CPU-side compositor passes
> (`LensFlare` / `WeightedBlendedOIT` / `OutlinePass`) for headless testing
> and offline compositing.

---

## Overview

The renderer is structured in three layers:

```
Renderer (interface)        ← pluggable backend contract
   └── WebGL2Renderer       ← concrete WebGL2 implementation
          ├── ShaderProgram ← GLSL program cache + uniform setters
          ├── RenderPass    ← post-processing pass abstraction
          │     └── PostProcess/  ← enhanced pass family
          ├── MRTTarget     ← multi-render-target FBO
          ├── GBuffer       ← deferred rendering geometry buffer
          ├── ShadowMapManager ← shadow-map FBO/texture lifecycle
          ├── CascadedShadowMap ← CSM/PSSM for large outdoor scenes
          ├── LensFlare ← CPU-side lens flare compositor
          ├── WeightedBlendedOIT ← order-independent transparency
          ├── OutlinePass ← CPU-side object outline / selection highlight
          ├── Reflector / Refractor ← planar reflection & refraction math
          ├── StereoCamera / AnaglyphEffect / ParallaxBarrierEffect ← stereo
          ├── GPUComputationRenderer ← GPGPU texture ping-pong + dependency graph
          ├── PMREMGenerator ← prefiltered IBL mip chain (Karis 2013)
          ├── BRDFLUT ← split-sum BRDF integration LUT (Karis 2013)
          ├── SubsurfaceScattering ← Pre-Integrated Skin (Penner 2011) + curvature + transmission
          ├── DeferredRenderer ← alternative deferred backend
          ├── ReflectionProbe / ReflectionProbeManager ← IBL probes
          └── PathTracer    ← CPU reference path tracer
```

The `Renderer` interface is the seam for the future WebGPU backend
(Phase 5.1) and for headless / software renderers used in unit tests.
Backend-specific capabilities (program cache, post-processing toggles,
shadow-map config) live on the concrete `WebGL2Renderer` type.

---

## Core Classes

### `Renderer` (`Renderer.ts`)

Abstract interface:

```ts
export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  render(scene: Scene, camera: Camera): void;
  resize(width: number, height: number): void;
  dispose(): void;
  readonly stats: RendererStats;
}
```

Invariants:
- `render()` is synchronous; GPU commands are queued immediately.
- `resize()` is idempotent — same size does not trigger reallocation.
- `dispose()` invalidates all GPU resources; calling `render()` afterward
  is undefined.

### `WebGL2Renderer` (`WebGL2Renderer.ts`)

Concrete implementation. Owns the WebGL2 context and manages three
resource caches:

| Cache | Key | Invalidated by |
|-------|-----|----------------|
| `MeshResources` (VAO + VBOs) | `geometry.uuid` | `geometry.version` |
| `ShadowResources` (depth FBO + texture) | `light.uuid` | `castShadow` toggle / shadow map size |
| `PostProcessingResources` (FBOs + textures) | canvas size | `resize()` |

Public stats (`RendererStats`):
- `drawCalls` — total draw calls this frame
- `triangles` — total triangles this frame
- `shadowPasses` — number of shadow passes (== cast-shadow lights)
- `programs` — size of the program cache
- `drawCallBreakdown` — per-mesh breakdown keyed on `mesh.name`

Toggles: `ssaoEnabled`, `postProcessingEnabled`, `bloomEnabled`,
`bloomIntensity`, `bloomThreshold`, `chromaticAberrationEnabled`,
`chromaticAberrationOffset`, `vignetteEnabled`, `vignetteDarkness`.

### `ShaderProgram` (`ShaderProgram.ts`)

GLSL ES 3.0 (`#version 300 es`) program wrapper:
- Type-safe uniform setters: `setUniform1i`, `setUniform1f`,
  `setUniform3f`, `setUniformMatrix4fv`, etc.
- `computeHash()` for variant caching — material attribute combinations
  hash to a stable program key so visually identical materials share
  programs.
- Program cache lives on the renderer; `getProgramFor(material, skinned)`
  is the lookup entry point.

### `RenderPass` (`RenderPass.ts`)

Abstract composable post-processing pass:

```ts
export abstract class RenderPass {
  abstract apply(ctx: PassContext, input: WebGLTexture, output: WebGLFramebuffer): void;
}
```

Basic concrete passes: `BloomPass`, `ChromaticAberrationPass`,
`VignettePass`, `FinalComposePass`, `SSAOPass`, `FXAAPass`,
`ToneMappingPass` (ACES filmic / Reinhard), `GammaCorrectPass`, `DOFPass`.

### `MRTTarget` (`MRTTarget.ts`)

General-purpose Multi-Render Target FBO. Holds N color attachments
(`COLOR_ATTACHMENT0..N-1`) + an optional depth / stencil attachment.

- `setup(gl, w, h, opts)` creates GL resources.
- `bind(gl)` binds the FBO and configures `drawBuffers`.
- `unbind(gl)` restores the default FBO.
- `resize(gl, w, h)` reallocates textures.
- `dispose(gl)` releases everything.

Color internal formats: `rgba8` / `rgba16f` / `rgba32f` / `rg16f` / `r16f`;
default `rgba16f` (suitable for HDR G-Buffer position / normal data).
Depth: `DEPTH_COMPONENT24`. Stencil: optional `DEPTH24_STENCIL8`. Color
filter defaults to `NEAREST` (G-Buffer data should not be interpolated).

### `GBuffer` (`GBuffer.ts`)

Geometry Buffer built on `MRTTarget` for deferred rendering. 4 color
attachments + 1 depth:

| Attachment | Texture | Format | Content |
|------------|---------|--------|---------|
| 0 | `positionTexture` | `RGBA16F` | xyz = world position, a = 1 |
| 1 | `normalTexture` | `RGBA16F` | xyz = world normal, a = 1 |
| 2 | `albedoTexture` | `RGBA8` | rgb = diffuse albedo, a = opacity |
| 3 | `materialTexture` | `RGBA8` | r = metallic, g = roughness, b = emissive, a = AO |

`highPrecisionFormat` selects `rgba16f` (default) / `rgba32f` / `rgba8`
for attachments 0/1. The `GBuffer` class only manages FBO / texture
lifecycle — the actual geometry rendering is done by the caller with a
G-Buffer shader writing to the 4 `layout(location = N) out` outputs.

### `ShadowMapManager` (`ShadowMapManager.ts`)

Centralised shadow-map FBO / texture lifecycle for cast-shadow lights.
Per-light depth target reuse and resize policy. PCF 16-tap sampling in
the shadow shader.

### `CascadedShadowMap` (`CascadedShadowMap.ts`)

Cascaded Shadow Maps (CSM / PSSM) for large outdoor scenes. A single
shadow map cannot simultaneously cover near-camera detail and far shadow
distance; CSM partitions the view frustum into N slices (typically 2–4)
and renders a separate shadow map per slice. Near slices have high
texel density (detail), far slices cover more world distance (range).

Adapted from three.js `CSM.js` and o3de Atom `CascadedShadowMapsPass`.

| Split Scheme | Formula | Trade-off |
|--------------|---------|-----------|
| `logarithmic` | `(near·(far/near)^p − near) / (far − near)` | Best near detail; far cascade under-covered |
| `uniform` | `p = i/N` (linear) | Best far coverage; near cascade low resolution |
| `practical` (PSSM) | `(1−λ)·log + λ·uniform` | λ=0 → log, λ=1 → uniform; default λ=0.5 |

Per-frame `update(camera, sceneBounds?)`:
1. Compute each cascade's `near` / `far` from split ratios.
2. Extract the 8 corner points of each sub-frustum (camera space → world).
3. Build a light view matrix (lookAt from cascade centre along light dir).
4. Transform the 8 corners to light space, compute AABB.
5. Optionally expand Z range using `sceneBounds` 8 corners (ensure all casters are inside).
6. Stabilisation: snap AABB min/max to the texel grid — eliminates shadow jitter when the camera moves.
7. Build orthographic projection (with `shadowBias` padding); `viewProjection = proj · view`.

Shader uniforms: `u_cascadeVP[0..N]` (via `getCascadeVPArray()`, N·16 floats),
`u_cascadeSplits[0..N]` (via `getSplitDepths()`, N floats for cascade selection).

```ts
const csm = new CascadedShadowMap({
  cascades: 4,
  scheme: 'practical',
  lambda: 0.5,
  resolution: 2048,
  shadowDistance: 200,
  lightDirection: new Vector3(-0.5, -1, -0.3).normalize(),
  stabilize: true,
});
// each frame:
csm.update(camera, sceneBoundingBox);
for (const cascade of csm.cascades) {
  renderer.renderShadowMap(scene, cascade.viewProjection, cascade.resolution);
}
```

### `LensFlare` (`LensFlare.ts`)

CPU-side lens flare compositor (no WebGL dependency; runs headless in
Node/tests, isomorphic with `MotionBlurPass` / `TAAPass`). Simulates
camera lens flares from bright light sources: core highlight, halo,
ghosts, and anamorphic streak, all distributed along the axis from the
light's screen position through the screen centre.

Adapted from three.js `Lensflare.js` and o3de Atom `LensFlarePass`.

Flare element kinds:

| Kind | Description |
|------|-------------|
| `core` | Bright spot at the light's screen position; small, high opacity |
| `halo` | Large soft circle at the light's position; low opacity |
| `ghost` | Coloured circle along the axis (positionAlongAxis 0..1+) |
| `streak` | Anamorphic horizontal/angled line through the core |

Per-frame `render(input, lightWorldPos, camera, occluders?)`:
1. Compute light direction from camera; reject if `dot < behindThreshold`.
2. Project light to clip space via VP matrix → NDC → screen pixel.
3. Optional ray-sphere occlusion test against `occluders` (bounding spheres); each hit reduces `visibility` (closer occluders attenuate more).
4. For each `FlareElement`: position along the light→centre axis, draw with additive blending into the RGBA buffer (radial `(1-t)^falloff` for circles, Gaussian for streaks).

```ts
const lensFlare = new LensFlare({ intensity: 1.0 });
const out = lensFlare.render(
  { data: framePixels, width: 1280, height: 720 },
  sunWorldPosition,
  camera,
  occluderSpheres,  // optional, for occlusion test
);
// out is a new Uint8ClampedArray with flares composited in
```

`DEFAULT_FLARES` preset ships 9 elements (1 core + 1 halo + 1 streak + 6 ghosts); replace at runtime via `setFlares()` / `addFlare()` / `clearFlares()`.

### `WeightedBlendedOIT` (`OIT.ts`)

Order-Independent Transparency via the Weighted Blended OIT technique
(McGuire & Bavoil 2013). Solves the long-standing problem of correctly
compositing translucent surfaces without sorting fragments by depth.
Classic alpha blending requires a strict back-to-front draw order; OIT
decouples correctness from submission order by accumulating every
transparent fragment into two intermediate buffers and compositing in a
final pass. CPU-side implementation with zero WebGL dependency — runs
headless in Node/tests, isomorphic with `LensFlare` / `MotionBlurPass`.

Algorithm (two-buffer weighted blended):

| Buffer | Accumulation rule | Holds |
|--------|-------------------|-------|
| `accumulate`  | `Σ (c_rgb · α · w)` | Pre-multiplied colour weighted by `w` |
| `revealage`  | `Π (1 - α)`        | How much background is revealed (1 = fully visible background, 0 = opaque) |

Depth-weighted function (McGuire Eq. 7, tuned for screen-space depth):

```
w(α, depth) = α · clamp( scale / (bias + depth^power), min, max )
```

- `α` ensures nearly-transparent fragments contribute little (avoids
  the "white fog" artefact of unweighted accumulation).
- `depth^power` (power default 3) makes closer fragments weigh more,
  approximating correct back-to-front ordering without an explicit sort.
- `scale` / `bias` / `min` / `max` clamp the weight to avoid
  float-precision blowups at extreme depths.

Composite (final pass):

```
final = (1 - revealage) · scene + accumulate / revealage
```

| Export | Role |
|--------|------|
| `WeightedBlendedOIT` | CPU OIT compositor. Constructor: `(width, height, opts?)`. |
| `OITFragment` | `{ x, y, color: [r,g,b], alpha, depth }` — one translucent pixel. |
| `OITOptions` | `{ weightScale?, weightBias?, weightDepthPower?, weightMin?, weightMax? }`. Defaults: `1000 / 1e-5 / 3 / 0.01 / 3000`. |

```ts
const oit = new WeightedBlendedOIT(1280, 720);
oit.clear();
// Submit translucent fragments in ANY order — no sorting required.
for (const frag of particleFragments) oit.addFragment(frag);
// Composite over the opaque scene buffer.
const out = oit.composite(scenePixelData);  // Uint8ClampedArray
```

Order-independence: two fragments added in opposite orders produce the
same `accumulate` sum (addition is commutative) and the same `revealage`
product (multiplication is commutative). The composite is therefore
identical regardless of submission order — this is the defining property
of OIT and is verified by the unit tests.

`WeightedBlendedOIT` is a CPU reference / fallback path; the production
WebGL2 pipeline can implement the same algorithm as a two-target
render-pass (MRT) for real-time use. The CPU path is used in tests,
headless rendering, and offline compositing where a GPU context is
unavailable.

### `OutlinePass` (`OutlinePass.ts`)

CPU-side object outline / selection highlight compositor. Draws a
glowing edge around selected objects by blurring their mask buffer and
subtracting the original mask — the difference is the outline. Commonly
used in editors / inspectors to highlight the currently selected object.

Adapted from three.js `examples/jsm/postprocessing/OutlinePass.js` and
o3de Atom `EntitySelectionMaskPass`. CPU-side implementation with zero
WebGL dependency — runs headless in Node/tests, isomorphic with
`LensFlare` / `WeightedBlendedOIT`.

**Algorithm** (mask-blur edge detection):

1. Selected objects render to a mask buffer (white = selected, black = unselected).
2. The mask is blurred with a separable Gaussian (horizontal + vertical pass).
3. Edge = blurred mask − original mask (the pixels that "leaked" outside the selected region).
4. Edge is alpha-blended onto the scene: `output = scene · (1 − α) + edgeColor · α`.

**Separable Gaussian blur**: a 2D Gaussian kernel is factored into two 1D
passes (horizontal then vertical), reducing complexity from
O(kernelSize²) to O(2 · kernelSize) per pixel. The kernel is normalised
so total weight = 1.

| Export | Role |
|--------|------|
| `OutlinePass` | CPU outline compositor. Constructor: `(opts?: OutlineOptions)`. |
| `OutlineOptions` | `{ edgeColor?, edgeStrength?, blurRadius?, blurSigma?, enabled?, glow? }`. |
| `OutlineInput` | `{ data: Uint8ClampedArray; width; height; mask: Uint8ClampedArray }` — scene pixels + single-channel selection mask. |

| Option | Default | Description |
|--------|---------|-------------|
| `edgeColor` | `[0, 255, 255]` (cyan) | Outline RGB (0..255). |
| `edgeStrength` | `1.0` | Outline opacity (0..1). |
| `blurRadius` | `4` | Gaussian radius in pixels; larger = thicker outline. |
| `blurSigma` | `blurRadius / 2` | Gaussian standard deviation. |
| `enabled` | `true` | Master toggle; `false` returns the input unchanged. |
| `glow` | `0.0` | Additive glow intensity (0..1+); `output += edgeColor · glow · α`. |

```ts
const pass = new OutlinePass({
  edgeColor: [0, 255, 255],
  blurRadius: 4,
  edgeStrength: 1.0,
});
const out = pass.render({
  data: scenePixels,      // RGBA Uint8ClampedArray
  width: 1280,
  height: 720,
  mask: selectionMask,    // single-channel (0 or 255) Uint8ClampedArray
});
// out is a new Uint8ClampedArray with cyan outlines around selected objects
```

`OutlinePass` is a CPU reference / fallback path. The production WebGL2
pipeline can implement the same algorithm as a two-pass render-pass
(mask FBO → separable blur shader → composite) for real-time use.

### `Reflector` / `Refractor` (`Reflector.ts` / `Refractor.ts`)

Planar reflection and refraction math libraries. `Reflector` provides a
reflection matrix, mirror camera, Lengyel oblique projection (to keep the
mirror plane at the near boundary and avoid leaking geometry behind it),
and a texture matrix mapping reflected texture space back to screen UV.
`Refractor` provides Snell's-law refraction direction, total-internal-
reflection / critical-angle detection, apparent-depth estimation, and a
virtual-position UV offset for sampling a refraction texture.

Adapted from three.js `Reflector.js` / `Refractor.js`. CPU-side math only,
no WebGL dependency — headless-testable; the caller binds GL state.

### `StereoCamera` / `AnaglyphEffect` / `ParallaxBarrierEffect`

Stereo rendering family. `StereoCamera` (off-axis asymmetric projection,
Kooima 2008) produces left/right `PerspectiveCamera` views with a
configurable eye separation and convergence distance. `AnaglyphEffect`
composites left/right images into a red-cyan / red-green / red-blue /
amber-blue anaglyph. `ParallaxBarrierEffect` interleaves left/right
pixels horizontally / vertically / checkerboard for parallax-barrier 3D
displays. All CPU-side, headless-testable; complement `StereoCamera`.

### `GPUComputationRenderer` (`GPUComputationRenderer.ts`)

GPGPU orchestrator adapted from three.js `GPUComputationRenderer.js`.
Manages `Variable`s (RGBA float data textures) and a directed dependency
graph; `init()` topo-sorts (Kahn) with cycle detection and generates a
complete `#version 300 es` fragment-shader wrapper for each variable
(declares dependency `uniform sampler2D`s, `resolution`, `fragColor`
output, and a `gl_FragColor` alias for user-code compatibility). Each
step `compute()` runs variables in topological order with ping-pong
double buffering and "read previous-step value" semantics (matching
three.js single-pass behavior). A CPU kernel path
(`setVariableKernel`) provides a headless-testable / fallback equivalent
of the fragment shader.

| Export | Role |
|--------|------|
| `GPUComputationRenderer` | Orchestrator. Constructor: `(sizeX?, sizeY?)`. |
| `GPUKernel` | CPU compute kernel signature `(deps, coord, out, off, sizeX, sizeY) => void`. |
| `GPUVariableUniforms` | Per-variable upload info (data buffer, size, channels, wrapped shader source, dependencies). |
| `GPUInitError` | `init()` failure reason union (`duplicate-variable` / `unknown-dependency` / `cyclic-dependency` / `empty`). |

```ts
const gpu = new GPUComputationRenderer(64, 64);
gpu.addVariable('position', positionFrag);
gpu.addVariable('velocity', velocityFrag);
gpu.setVariableDependencies('velocity', ['position']);
gpu.setVariableDependencies('position', ['velocity']);
if (gpu.init() !== null) throw new Error('init failed');
gpu.compute(); // advance one step
const pos = gpu.getVariableData('position'); // Float32Array copy
```

### `PMREMGenerator` (`PMREMGenerator.ts`)

Prefiltered Mipmaped Radiance Environment Map generator — the IBL core
that turns raw cube-map captures into PBR-ready environment lighting.
Adapted from three.js `PMREMGenerator.js` with the Karis 2013 split-sum
GGX importance-sampling approach. **Pure CPU**: no GL calls, all math on
`Float32Array`; fully headless-testable.

Consumes `EnvironmentCubeData` from `RoomEnvironment` (or the renderer's
`updateCubeCamera` output) and produces:

1. **`prefilter(cube)`** → `PMREMData`: a 6-face cube mip chain where
   each mip level encodes a different surface roughness (α from 0 → 1).
   mip 0 is a direct copy (α=0, mirror reflection); higher mips are
   GGX-importance-sampled convolutions (α>0, blurred highlights). The
   renderer samples this with `textureLod(envMap, dir, roughness * mipCount)`.

2. **`diffuseIrradiance(cube, outSize?)`** → `EnvironmentCubeData`: a
   single-layer cosine-weighted hemisphere convolution for Lambertian
   diffuse IBL. Higher-frequency than the SH2 path in
   `LightProbeGenerator`; use SH2 for low-frequency environments (faster,
   less memory) and this for environments with localized bright sources.

| Export | Role |
|--------|------|
| `PMREMGenerator` | Generator class. Constructor: `(opts?: { samples?: number })`. |
| `PMREMGeneratorOptions` | `{ samples?: number }` — max importance samples per texel (default 32). |
| `PMREMData` | Output of `prefilter()`: `{ size, mipCount, faces: PMREMFace[6] }`. |
| `PMREMFace` | `{ face: string, mips: PMREMFaceMip[] }`. |
| `PMREMFaceMip` | `{ width, height, data: Float32Array }` — RGB float, HDR. |

```ts
const room = new RoomEnvironment({ size: 256 });
const cube = room.generate();

const pmrem = new PMREMGenerator({ samples: 32 });
const result = pmrem.prefilter(cube);
// result.faces[0].mips[3].data → +x face mip 3 (α ≈ 0.53)

const diffuse = pmrem.diffuseIrradiance(cube, 64);
// diffuse.faces[0].data → +x face cosine-convolved irradiance (64×64)
```

**Algorithm (prefilter)** — Karis 2013 split-sum, specular component:
- For each output texel (direction N, mip m):
  - α = (m / (mipCount - 1))² (perceptual roughness squared).
  - mip 0 (α=0): direct bilinear copy from source (no convolution).
  - α>0: Hammersley low-discrepancy sequence generates `sampleCount`
    half-vectors H via GGX importance sampling. For each H:
    1. Build tangent frame (T, B, N) from N.
    2. Transform H to world space: `H_w = T·H.x + B·H.y + N·H.z`.
    3. Compute light direction: `L = reflect(-N, H_w)` (V=N approximation).
    4. Sample source cube at L (bilinear).
    5. Weight = `max(N·L, 0)` (geometry/Fresnel handled by the 2D LUT).
    6. Accumulate weighted color, normalize by total weight.

**Algorithm (diffuseIrradiance)** — cosine-weighted hemisphere sampling:
- For each output texel (direction N): Monte-Carlo sample `sampleCount`
  directions in the hemisphere aligned with N, using cosine-weighted
  importance sampling (`φ = 2π·ξ₁, θ = asin(√ξ₂)`). Sample source cube
  at each direction, weight by `N·L`. Output = cosine-weighted average
  (= irradiance / π for Lambertian BRDF).

**Differences from three.js**:
- three.js `PMREMGenerator` renders to a GL cube framebuffer with a
  fragment shader doing the convolution. VREEN's version is pure CPU;
  output is data (`Float32Array`), not a GL texture.
- three.js uses `scene` as input (renders the scene into a cube map
  first, then prefilters). VREEN takes `EnvironmentCubeData` directly
  (already-captured cube data from `RoomEnvironment` or `CubeCamera`).
- Hammersley sample count is configurable (default 32 vs three.js's
  fixed 1024 for GPU). Lower = faster but noisier; raise for production.

**Limitations**:
- CPU convolution is O(texels × samples) per mip; for 256² × 6 faces
  with 32 samples, `prefilter()` takes ~0.5s on a modern CPU. Use
  smaller source sizes (64–128) for real-time, larger for offline bake.
- `diffuseIrradiance()` is O(texels × samples) with no mip acceleration;
  for large sources, pass `outSize` < `srcSize` to downscale.
- The split-sum 2D BRDF integration LUT (mapping NoV + roughness to
  scale/bias) is **not** generated here — it's a fixed 2D texture
  typically precomputed once and uploaded as a `Sampler2D`.
- V=N approximation means the result is slightly inaccurate for grazing
  angles where V ≠ N; this matches the standard Karis split-sum tradeoff.

### `BRDFLUT` (`BRDFLUT.ts`)

Split-sum BRDF integration lookup table — the **second half** of the Karis
2013 IBL approximation. While `PMREMGenerator` produces the prefiltered
environment radiance (the LD term), `BRDFLUT` produces a 2D RG texture
encoding the BRDF's geometry + Fresnel response (the R term):

```
specularIBL = prefilteredEnv(L) * (scale * F0 + bias)
                                    ↑               ↑
                              BRDFLUT.r       BRDFLUT.g
```

The LUT is a fixed 2D table (typically 256×256, generated once at startup
or offline) that maps `(N·V, roughness) → (scale, bias)`. At runtime the
shader samples it with `texture(brdfLUT, vec2(NoV, roughness)).rg`.

| Export | Role |
|--------|------|
| `BRDFLUT` | Static class with `generate(opts)` method. |
| `BRDFLUTOptions` | `{ size?: number; samples?: number }` — LUT edge length (default 256) and MC samples per texel (default 1024). |
| `BRDFLUTData` | `{ size: number; data: Float32Array }` — RG float, `length = size * size * 2`. |

```ts
import { BRDFLUT } from '@vreen/engine';

// Generate once at startup (offline bake or first frame)
const lut = BRDFLUT.generate({ size: 256, samples: 1024 });
// Upload as RG8/ RG16F texture: tex.rg = lut.data

// In shader:
// vec2 envBRDF = texture(brdfLUT, vec2(NoV, roughness)).rg;
// vec3 F = F0 * envBRDF.x + F90 * envBRDF.y;
// vec3 specularIBL = prefilteredEnv * F;
```

**Algorithm** (Karis 2013, Section 3.4):
- For each `(NoV, roughness)` texel:
  - `V = (sin θ, 0, cos θ)`, `θ = acos(NoV)`; `N = (0, 0, 1)`.
  - Hammersley low-discrepancy sequence generates `sampleCount` half-vectors
    H via GGX importance sampling (`α = roughness²`).
  - For each H: `L = reflect(-V, H)`, compute `NoL = max(N·L, 0)`.
    If `NoL > 0`:
    1. **Smith G** (uncorrelated GGX): `G = G1(NoV) * G1(NoL)` where
       `G1(n, α) = 2n / (n + sqrt(α² + (1-α²)·n²))`.
       Note: the formula uses `(1-α²)·n²`, NOT `(1-n²)`. The latter is the
       erroneous "Karis fast" approximation that gives `G1=2` at `α=0, n=1`
       (should be 1), causing `scale > 1` and energy conservation violation.
    2. **Visibility**: `G_vis = G * VdotH / (NoV * NoH)`.
    3. **Schlick Fresnel**: `Fc = (1 - VdotH)^5`.
    4. Accumulate: `scale += (1 - Fc) * G_vis`, `bias += Fc * G_vis`.
  - Normalize by `sampleCount`, clamp to `[0, 1]`.

**Key properties verified by tests**:
- `scale ∈ [0, 1]`, `bias ∈ [0, 1]` (clamped).
- `scale + bias ≤ 1` (energy conservation).
- At `roughness=0, NoV=1`: `scale ≈ 1, bias ≈ 0` (perfect mirror, F=F0).
- At `roughness=0`: `scale = 1 - (1-NoV)^5`, `bias = (1-NoV)^5` (analytic
  for the delta-function case, all samples have `VdotH = NoV`).
- `scale` decreases with roughness (F0 contribution drops).
- Deterministic: same parameters → identical output (Hammersley sequence).

**Differences from three.js**:
- three.js generates the LUT via a GL fragment shader (`Mesh` with
  `OrthographicCamera` rendering a fullscreen quad). VREEN generates it
  on the CPU — same math, no GL dependency, headless-testable.
- three.js uses the "Smith Correlated" G form
  (`G = 0.5 / (GGXV + GGXL)`). VREEN uses the uncorrelated Smith G
  (`G = G1(NoV) * G1(NoL)`) with the exact `G1` formula. Both are valid;
  the uncorrelated form is simpler and gives `G=1` at `α=0` (matching
  the physical mirror case), while the correlated form gives `G=0.25`
  at the same point (the correlation reduces effective reflectance).

**Limitations**:
- CPU generation is O(size² × samples); 256² × 1024 ≈ 67M operations
  (~3s on a modern CPU). Generate once, cache forever.
- The LUT assumes Schlick Fresnel (F0 / F90 parametrization). For more
  complex Fresnel models (conductor IOR), use an analytic BRDF integration
  instead.
- The V=N approximation (split-sum) introduces slight inaccuracy at
  grazing angles; this is the standard Karis tradeoff shared by UE4,
  Filament, and three.js.

### `SubsurfaceScattering` (`SubsurfaceScattering.ts`)

Subsurface scattering (SSS) runtime toolkit for skin and organic
materials. Provides curvature estimation, backlight transmission, and
diffuse mixing utilities that complement the Pre-Integrated Skin LUT
(`Core/PreIntegratedSkinLUT.ts`), the screen-space SSS pass
(`PostProcess/SSSSPass.ts`), and the SSS material
(`Materials/SubsurfaceScatteringMaterial.ts`).

Adapted from Penner & Borshukov 2011 "Pre-Integrated Skin Shading"
(SIGGRAPH Course) and d'Eon 2007 "GPU Gems 3 Ch.14 — Advanced Skin".
This module fills a gap that soup3D and three.js do not cover —
curvature-aware skin diffuse with a pre-integrated LUT.

**Why Pre-Integrated Skin?** Skin is translucent: light enters at one
point, scatters through the tissue, and exits at another. At high-curvature
regions (nose tip, ear edges, nostrils, lips), the scattering crosses the
light/shadow terminator, producing the characteristic warm-red glow on the
shadow boundary. Standard Lambertian diffuse cannot reproduce this. The
Penner 2011 method pre-integrates the scattering over a spherical arc for
each (N·L, curvature) pair, producing a 2D LUT that the shader samples at
runtime — O(1) per pixel with no blur passes required.

**Pipeline overview** (three complementary components):

| Component | File | Role |
|-----------|------|------|
| Pre-Integrated Skin LUT | `Core/PreIntegratedSkinLUT.ts` | Offline generation of 2D RGB LUT (N·L × curvature → diffuse color) |
| Runtime tools | `SubsurfaceScattering.ts` (this file) | Curvature estimation, backlight transmission, diffuse mixing |
| Screen-space blur | `PostProcess/SSSSPass.ts` | Jimenez 2012 separable SSSS post-process blur (optional enhancement) |
| Material shader | `Materials/SubsurfaceScatteringMaterial.ts` | GLSL shader sampling the LUT + transmission |

**Exports** (re-exports from `Core/PreIntegratedSkinLUT.ts` + local functions):

| Export | Signature | Description |
|--------|-----------|-------------|
| `generatePreIntegratedSkinLUT` | `(opts?) → { data, width, height, maxCurvature }` | Generate 2D RGB LUT via d'Eon Gaussian-sum profile integration |
| `samplePreIntegratedSkinLUT` | `(lut, NdotL, curvature) → { r, g, b }` | Bilinear sample the LUT with auto-clamping |
| `skinScatterProfile` | `(distanceMM) → { r, g, b }` | d'Eon 2007 skin diffuse reflectance profile R_d(s) |
| `curvatureFromRadius` | `(radiusMM) → number` | Convert curvature radius (mm) to curvature (1/mm) |
| `computeCurvature` | `(n0, n1, edgeLength) → number` | Estimate curvature from two adjacent normals |
| `computeCurvatureAveraged` | `(center, neighbors[], edgeLengths[]) → number` | Average curvature from multiple neighbors (more stable) |
| `backLightTransmission` | `(thickness, NoL, VoL) → [r, g, b]` | Backlight transmission color (ear/nose rim glow) |
| `mixSSSDiffuse` | `(diffuseColor, sssColor, sssAmount) → [r, g, b]` | Blend Lambertian diffuse with SSS LUT result |

**d'Eon 2007 skin diffuse profile** (Gaussian sum, per channel):

```
R_d(s) = Σ_k  a_k · exp(−s² / (2·v_k))    (s in mm, v_k in mm²)
```

| Channel | Gaussian terms (weight, variance) | Long-range? |
|---------|-----------------------------------|-------------|
| Red     | (0.028, 0.013), (0.238, 0.060), (0.448, 0.268), (0.698, 0.842) | Yes — v=0.842 → red scatters farthest |
| Green   | (0.449, 0.019), (0.367, 0.088), (0.184, 0.228) | No — short range only |
| Blue    | (0.549, 0.022), (0.318, 0.084), (0.133, 0.183) | No — shortest range |

The red channel's long-range Gaussian (v=0.842 mm²) is what causes the
red bleed across the terminator — red light scatters ~2× farther than
green/blue, so shadow edges on skin appear warm red.

**LUT generation algorithm** (`generatePreIntegratedSkinLUT`):

For each texel (u, v) where u = (N·L+1)/2 and v = curvature/maxCurvature:

1. Convert curvature to arc radius: `r = 1 / curvature` (mm).
2. For N samples along the arc `s ∈ [−maxScatter, +maxScatter]`:
   - Compute arc angle: `φ = s / r`.
   - Evaluate the scatter profile: `R_d(|s|)` (Gaussian sum, per channel).
   - Compute local N·L: `cos(θ + φ)` where `θ = acos(N·L)`.
   - Accumulate: `Σ max(cos(θ+φ), 0) · R_d(|s|)` per channel.
   - Accumulate weight: `Σ R_d(|s|)` per channel.
3. Normalize: `diffuse = Σ(lit · R_d) / Σ(R_d)` per channel.
4. Degenerate case: curvature ≈ 0 (flat) → `diffuse = max(N·L, 0)` (standard Lambert).

**Invariants**:
- Output per channel ∈ [0, 1] (normalised by Σ R_d).
- curvature → 0 (flat surface): result ≈ `max(N·L, 0)` (standard Lambert).
- N·L = 1 (fully lit) with finite curvature: result ≈ 1.0 (normalisation guarantee).
- Higher curvature → more red bleed at the terminator (N·L ≈ 0).
- Same parameters always produce the same LUT (deterministic, no RNG).

**Curvature estimation** (`computeCurvature` / `computeCurvatureAveraged`):

For a mesh surface, curvature ≈ |ΔN| / |ΔP|, where ΔN is the normal
change and ΔP is the position change between adjacent vertices. This can
be precomputed on the CPU and uploaded as a vertex attribute for the
shader to sample the LUT:

```ts
// Per-vertex curvature from 4 neighbors
const curvature = computeCurvatureAveraged(
  vertex.normal,
  [n0, n1, n2, n3],
  [edgeLen0, edgeLen1, edgeLen2, edgeLen3],
);
// Upload as vertex attribute
geometry.setAttribute('curvature', new Float32Array(curvatures), 1);
```

**Backlight transmission** (`backLightTransmission`):

When light passes through thin tissue (ears, nostrils, fingers) from
behind, the blood absorbs green/blue light and the transmitted light
appears red. The transmission intensity depends on:
- `thickness`: 0 = paper-thin (max transmission), 1 = opaque (no transmission).
- `NoL` (N·L): negative values mean light is behind the surface → transmission.
- `VoL` (V·L): negative values mean viewer is on the opposite side from light.

Transmission color: `[1.0, 0.45, 0.32]` (warm red, blood-absorbed).

```ts
const transmission = backLightTransmission(thickness, NoL, VoL);
finalColor[0] += transmission[0];
finalColor[1] += transmission[1];
finalColor[2] += transmission[2];
```

**Complete pipeline example**:

```ts
// 1. Generate LUT (offline, once)
const lut = generatePreIntegratedSkinLUT({ width: 256, height: 256, samples: 64 });

// 2. Upload as RG16F/RGB16F texture
const lutTexture = createTextureFromLUT(lut);

// 3. In shader: sample LUT using N·L and per-vertex curvature
//    vec3 sssDiffuse = texture(skinLUT, vec2(NdotL * 0.5 + 0.5, curvature)).rgb;

// 4. On CPU (testing / offline baking):
const sssColor = samplePreIntegratedSkinLUT(lut, NoL, curvature);
const lambert = [albedo.r * NoL, albedo.g * NoL, albedo.b * NoL];
const diffuse = mixSSSDiffuse(lambert, [sssColor.r, sssColor.g, sssColor.b], 0.7);

// 5. Add backlight transmission for thin regions
const transmission = backLightTransmission(thickness, NoL, VoL);
const finalColor = [diffuse[0] + transmission[0], diffuse[1] + transmission[1], diffuse[2] + transmission[2]];
```

**Differences from three.js / o3de**:
- three.js has no built-in Pre-Integrated Skin LUT; this module fills that gap.
- o3de Atom has `SkinDiffuseProfile` / `PreIntegratedBrdf` assets; VREEN
  generates the LUT procedurally at runtime (no asset pipeline needed).
- The d'Eon Gaussian profile is hardcoded (standard for human skin); o3de
  allows custom profiles via JSON asset. VREEN's `skinScatterProfile` can
  be extended to accept custom profiles in the future.

**Limitations**:
- The d'Eon profile is tuned for human Caucasian skin; other skin tones may
  need profile adjustment (the Gaussian variances are the same, but the
  albedo multiplier differs).
- Curvature estimation from normals is a first-order approximation; for
  production quality, precompute curvature in a DCC tool (Maya/Blender) and
  bake it as a vertex attribute.
- Backlight transmission is a simplified thin-wall model; for thick
  objects, use the screen-space SSSS pass (`PostProcess/SSSSPass.ts`).
- The LUT is 2D (N·L × curvature); a 3D LUT (adding thickness) would be
  more accurate but increases memory 8×–64×.

### `TexturePool` (`TexturePool.ts`)

Bindless texture pool — adapted from o3de Atom's [Bindless](https://github.com/o3de/o3de/blob/development/Gems/Atom/RHI/Bindless.md) resource access concept. Packs multiple textures into a single `TEXTURE_2D_ARRAY` so shaders can sample any texture by integer index without per-draw binding.

**Why bindless?** In GPU-driven rendering, terrain material blending, decal systems, and instanced rendering, the set of textures needed per draw is not known on the CPU. A texture pool lets the shader select textures dynamically:

```glsl
// GLSL — bindless sampling via sampler2DArray
uniform sampler2DArray u_texturePool;
uniform int u_diffuseIndex;  // from TexturePool.allocate()
vec4 color = texture(u_texturePool, vec3(v_uv, float(u_diffuseIndex)));
```

**API:**

| Method | Description |
|--------|-------------|
| `allocate(label?)` | Allocate a slot, returns index (or -1 if full). |
| `free(slot)` | Release a slot back to the free list. |
| `update(slot, data)` | Copy pixel data into the slot's layer. Marks `layerUpdates`. |
| `getSlotVersion(slot)` | Version counter (increments on allocate/update). |
| `isAllocated(slot)` | Check if slot is occupied. |
| `clear()` | Free all slots. |
| `getStats()` | Returns `{capacity, allocated, free, width, height, format, type}`. |

**Config:**

| Option | Default | Description |
|--------|---------|-------------|
| `capacity` | 512 | Max textures in pool. |
| `width` / `height` | 1024 | Per-texture dimensions (all textures share size). |
| `format` | `'rgba'` | Pixel format (`rgba`/`rgb`/`rg`/`r`). |
| `type` | `'unsigned-byte'` | Pixel type (`unsigned-byte`/`float`/`half-float`). |
| `generateMipmaps` | false | Generate mip chain. |
| `colorSpace` | `'srgb'` | Color space. |

**Integration:** The pool exposes `arrayTexture` (a `DataArrayTexture`) for the renderer to upload via `texStorage3D` / `texSubImage3D`. Dirty layers are tracked in `layerUpdates` for partial updates.

**o3de comparison:** o3de uses DX12/Vulkan descriptor heaps with bindless flags; VREEN uses WebGL2 `TEXTURE_2D_ARRAY` + `sampler2DArray`, achieving the same concept within WebGL2 constraints.

### `DeferredRenderer` (`DeferredRenderer.ts`)

Alternative deferred backend. G-Buffer pass → fullscreen lighting pass.
Trade-offs vs forward rendering:

| Aspect | Forward (default) | Deferred (alternative) |
|--------|-------------------|------------------------|
| Light count | O(fragments × lights) | O(pixels) |
| Transparency | Native | Requires separate forward pass |
| MSAA | Native | Edge-detect / FXAA |
| Material diversity | One shader per variant | G-Buffer fixes attribute set |
| Memory | Lower | Higher (4 G-Buffer textures) |

### `ReflectionProbe` / `ReflectionProbeManager`

IBL reflection probes — capture cube-map snapshots of the scene for
local reflection mapping. `ReflectionProbeManager` registers probes,
tracks the camera-position-weighted active probe, and blends between
probes for smooth transitions.

### `PathTracer` (`PathTracer.ts`)

CPU-simplified path tracer for reference / validation rendering. **Not a
real-time backend** — it is the ground-truth comparator for the WebGL2
PBR pipeline, useful for unit tests, PBR parameter validation, and
offline debugging.

```ts
interface PathTracerOptions {
  maxBounces?: number;       // default 8
  samplesPerPixel?: number;  // default 4
  width?: number;            // default 256
  height?: number;           // default 256
  backgroundColor?: Color;   // default black
}
```

API: `render(scene, camera)` / `accumulate(scene, camera)` (alias) /
`getResult()` / `reset()` / `setBounces(n)` / `setSamples(n)` / `dispose()`.

Internals: Möller–Trumbore ray-triangle intersection, cosine-weighted
hemisphere sampling for indirect bounces, direct lighting with shadow-ray
occlusion, Russian-roulette path termination past depth 3. The output is
*not* tonemapped — callers can post-process the `Uint8ClampedArray`.

---

## Enhanced Post-Processing Passes (`PostProcess/` subdirectory)

A second family of `RenderPass` implementations complementing the basic
passes. All implement the `RenderPass` interface and compose into the
same `PostProcessingPipeline`.

| Pass | Role |
|------|------|
| `ColorGradingPass` | ASC-CDL style color grading — 8 parameters (slope / offset / power per RGB channel + saturation). |
| `LUTPass` | Color lookup table — 3D LUT (`sampler3D`) or 2D strip LUT. Accepts both raw `WebGLTexture` and VREEN `Texture`/`Data3DTexture` (auto-uploaded via `renderer.getGLTexture()`). Pairs with `LUTCubeLoader.toData3DTexture()` for end-to-end `.cube` file → `Data3DTexture` → `LUTPass` pipeline. |
| `ChromaticAberrationPass` | Enhanced — `Vector2` direction offset + radial modulation by distance from screen center. |
| `VignettePass` | Enhanced — `offset` / `darkness` + color tint. |
| `FilmGrainPass` | Film grain — strength / size / animation frame count. |
| `AfterimagePass` | Cross-frame accumulation for motion-trail / afterimage. |
| `PixelationPass` | Pixelation / mosaic. |
| `AutoExposurePass` | Auto-exposure — computes average luminance and adapts exposure over time. |
| `DOFEnhancedPass` | Enhanced depth-of-field — bokeh + circle-of-confusion. |
| `GTAOPass` | Ground-truth ambient occlusion (improvement over SSAO). |
| `MotionBlurPass` | Camera/object motion blur using a velocity buffer. |
| `SSRPass` | Screen-space reflections. |
| `SSSSPass` | Screen-space subsurface scattering. |
| `GlitchPass` | Digital glitch effect (cyberpunk) — RGB shift + band distortion + snow noise. Adapted from three.js `GlitchPass.js` / `DigitalGlitch.js`. Random trigger (120-240 frames) or `goWild` continuous mode. |
| `SMAAPass` | Subpixel Morphological Antialiasing — 3-pass pipeline (edge detection → blending weights → neighborhood blending) with procedurally generated area/search LUT textures. Adapted from three.js `SMAAPass.js` / `SMAAShader.js` (SMAA v2.8 by Iryoku). Higher quality than FXAA, handles L/U/Z-shaped edges. |
| `TAAPass` | Temporal anti-aliasing (uses `VelocityPass` data). |
| `VelocityPass` | Per-pixel motion vectors for TAA / motion blur. |
| `VolumetricFogPass` | Volumetric fog / light shafts. |

> **Name-collision note:** `ChromaticAberrationPass` and `VignettePass`
> exist in *both* `RenderPass.ts` (basic) and `PostProcess/` (enhanced)
> with different option shapes. The barrel exports the enhanced versions
> by default.

---

## Render Pipeline

`WebGL2Renderer.render(scene, camera)` runs the following passes per
frame. Passes 2 and 4 are optional and controlled by toggles.

```
0. Update scene world matrices (scene.updateWorldMatrix)
1. Collect lights (DirectionalLight with castShadow, others)
2. SHADOW PASS (per cast-shadow DirectionalLight)
   └─ render scene depth from light POV → shadow FBO (PCF 16-tap)
3. SSAO PASS (optional, ssaoEnabled)
   ├─ write linear depth + view normals → half-res FBO
   └─ 16-tap kernel sample → SSAO texture
4. MAIN PASS
   ├─ for each Mesh in scene (frustum-culled):
   │    ├─ getProgramFor(material, skinned)
   │    ├─ bind VAO (cached on geometry.version)
   │    ├─ upload uniforms (model / view / projection / normal matrix /
   │    │  camera position / lights / shadow map / IBL / SSAO / params)
   │    └─ gl.drawElements / drawElementsInstanced
   └─ write to mainFbo if postProcessingEnabled, else to canvas
5. POST-PROCESSING PASS (optional, postProcessingEnabled)
   └─ PostProcessingPipeline: passes in order → canvas
6. Update stats (drawCalls / triangles / shadowPasses / breakdown)
```

### Resource Invalidation

- **VAO cache** — keyed on `geometry.uuid`, invalidated when
  `geometry.version` changes.
- **Shadow FBO cache** — keyed on `light.uuid`, invalidated when
  `castShadow` toggles or the shadow map size changes.
- **Post-processing FBOs** — invalidated on `resize()`.
- **Program cache** — keyed on `material` + `skinned` boolean; uses
  `ShaderProgram.computeHash` for variant stability.

---

## Usage Example

```ts
import { WebGL2Renderer, Scene, PerspectiveCamera, Mesh, BoxGeometry, StandardMaterial } from '@vreen/engine';

const canvas = document.querySelector('canvas')!;
const renderer = new WebGL2Renderer(canvas);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new Scene();
const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1, 3);

const mesh = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial({ baseColor: { r: 0.8, g: 0.4, b: 0.2 } }));
scene.add(mesh);

// Toggle post-processing
renderer.postProcessingEnabled = true;
renderer.bloomEnabled = true;
renderer.bloomIntensity = 0.8;

function frame() {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
```

---

## Design Notes

**Why MRT + GBuffer?** Forward rendering (the current main path) shades
each fragment once with all lights. For scenes with many lights,
forward rendering becomes fill-rate-bound. Deferred rendering shades
each screen pixel once, reading light parameters from uniforms — light
count no longer multiplies fragment work. The `GBuffer` is the input to
that lighting pass.

**Why CPU-only `PathTracer`?** A GPU path tracer would compete with the
WebGL2 renderer for context state and complicate the test harness. The
CPU path keeps the tracer fully deterministic and headless-testable; the
performance cost is acceptable for the small reference images used in
tests.

**Versioned invalidation.** The renderer does not poll attributes every
frame. Each `BufferAttribute` and `Texture` carries a monotonic `version`
integer; the renderer caches GPU state per-object and only re-uploads
when the version changes. This mirrors Three.js' approach and keeps
per-frame GPU traffic minimal.
