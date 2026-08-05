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
          ├── GPUPicking    ← O(1) object picking (offscreen ID render + readPixels; see GPUPicking.README.md)
          ├── ShadowMapManager ← shadow-map FBO/texture lifecycle
          ├── PCSSSampler ← PCSS soft-shadow CPU reference (Ferrari 2005)
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
          ├── DDGIVolume  ← dynamic diffuse GI (irradiance probe grid)
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

#### Material dispatch in `_drawMesh`

The renderer branches on the material type to pick the shader program and
the uniform-write path:

| Material | Detection | Program source | Uniform writer |
|----------|-----------|----------------|----------------|
| `ShaderMaterial` (user) | `instanceof ShaderMaterial` | user-supplied `vertexSrc` / `fragmentSrc` | `_applyUserShaderUniforms` (writes `u_time`, `u_cameraPos`, and the user `uniforms` map) |
| `HairMarschnerMaterial` | `instanceof HairMarschnerMaterial` | engine built-in `HAIR_MARSCHNER_VERT` / `HAIR_MARSCHNER_FRAG` | `_applyHairMeshUniforms` (writes the 17 Marschner uniforms listed below) |
| `StandardMaterial` (default) | fallthrough | engine built-in `STANDARD_VERTEX_SRC` / `STANDARD_FRAGMENT_SRC` | `_applyStandardMeshUniforms` (PBR textures + lights + shadow + SSAO) |

##### HairMarschner rendering path

When a `Mesh` is assigned a `HairMarschnerMaterial`, the renderer:

1. Compiles (once, then caches under the key `'hair-marschner'` in
   `programCache`) the engine built-in `HAIR_MARSCHNER_VERT` /
   `HAIR_MARSCHNER_FRAG` GLSL ES 3.0 shaders via
   `_getOrCompileHairProgram(mat)`. The compiled `ShaderProgram` is also
   stored on `mat.program` so subsequent draws of the same material skip
   the lookup.
2. Writes the common matrices (`u_model`, `u_view`, `u_projection`,
   `u_normalMatrix`) — same as every other path.
3. Calls `_applyHairMeshUniforms(program, mesh, camera, mat)` to upload
   the 17 Marschner-specific uniforms declared in `HAIR_MARSCHNER_FRAG`:

   | Uniform | Type | Source field |
   |---------|------|--------------|
   | `u_cameraPos` | `vec3` | `camera.position` |
   | `u_lightDir` | `vec3` | `mat.lightDirection` (world space, points toward light) |
   | `u_lightColor` | `vec3` | `mat.lightColor` |
   | `u_baseColor` | `vec3` | `mat.baseColor` (linear RGB) |
   | `u_eta` | `float` | `mat.eta` (default 1.55) |
   | `u_sigmaA` | `vec3` | `mat.sigmaA` (Beer-Lambert absorption RGB) |
   | `u_betaR` / `u_betaTT` / `u_betaTRT` | `float` | `mat.betaR` / `betaTT` / `betaTRT` (lobe longitudinal widths) |
   | `u_alphaR` / `u_alphaTT` / `u_alphaTRT` | `float` | `mat.alphaR` / `alphaTT` / `alphaTRT` (lobe center offsets) |
   | `u_roughness` | `float` | `mat.roughness` (modulates highlight sharpness) |
   | `u_ttScale` / `u_trtScale` | `float` | `mat.ttScale` / `trtScale` (lobe intensity multipliers) |
   | `u_diffuseScale` | `float` | `mat.diffuseScale` (Kajiya-Kay cylindrical diffuse) |
   | `u_opacity` | `float` | `mat.opacity` |

4. Toggles GL state for hair:
   - If `mat.doubleSided` (default `true`): disables `CULL_FACE` so
     back-facing hair fibers render (hair cards are not consistently
     wound).
   - If `mat.transparent` (default `true`): enables `BLEND` with
     `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` and disables `depthMask` so
     semi-transparent hair strands composite correctly without
     depth-fighting.
5. Issues the draw call (`gl.drawElements` / `gl.drawArrays`).
6. Restores the default GL state (`CULL_FACE` on, `BLEND` off,
   `depthMask` on) so the next mesh is unaffected.

##### Tangent fallback

`HAIR_MARSCHNER_VERT` declares `in vec3 a_tangent;` (location 4, same
layout as `StandardMaterial`). If the geometry does not provide a
`tangent` attribute, WebGL returns `(0, 0, 0)` for the unbound generic
vertex attribute. The shader detects this via
`length(a_tangent) < 1e-5` and substitutes `a_normal` as the fiber
direction, so `HairMarschnerMaterial` still renders correctly on
geometry without explicit tangents (the Marschner model degrades to a
surface-ish shading in that case, which is the best one can do without
fiber-direction data).

##### Skinning

`HairMarschnerMaterial` is fully compatible with `SkinnedMesh`. The
`_drawMesh` skinning block writes `u_bindMatrixInverse` and
`u_boneMatrices[0]` exactly as for `StandardMaterial`; the hair vertex
shader applies `u_model` (which already includes the skinned transform
when the skeleton is updated) before computing world position / normal
/ tangent. This lets character hair rigs driven by bones render with
the full Marschner BCSDF.

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
Per-light depth target reuse and resize policy. Supports three shadow
modes via `ShadowType`:

| Type | Taps | Filter | Description |
|------|------|--------|-------------|
| `'basic'` | 1 | NEAREST | Hard shadow (single depth test). Fastest; aliased edges. |
| `'pcf'` | 9 | LINEAR | 3×3 PCF at fixed 1.5-texel radius. Smooth edges; uniform blur width. |
| `'pcss'` | 41 | LINEAR | **PCSS** (Percentage-Closer Soft Shadows). 3-stage physical soft shadows: blocker search (5×5 = 25-tap grid) → penumbra estimation (similar-triangles formula) → variable-rate PCF (16-tap rotated Poisson disk). Contact points render sharp; distant occluders render soft — matching real-world light behavior. Requires `lightSize` property (world units, controls penumbra width). **Surpasses soup3D** (which only has basic hard shadows). |

```ts
const sm = new ShadowMapManager(gl, {
  type: 'pcss',
  enabled: true,
  lightSize: 0.5,   // larger = softer shadows
});
// Consumer shader injects PCSS_SHADOW_FRAG and calls sampleShadowPCSS(worldPos)
// CPU reference implementation: PCSSSampler.ts (samplePCSS / findBlocker / computePenumbra)
```

### `PCSSSampler` (`PCSSSampler.ts`)

CPU pure-function reference implementation of the PCSS (Percentage-Closer
Soft Shadows) algorithm. Mirrors the GLSL `PCSS_SHADOW_FRAG` chunk 1:1,
operates on `Float32Array` shadow maps, and runs in Node / headless / test
environments without WebGL. Used to:

1. Validate the GPU shader's correctness (reference implementation);
2. Sample soft shadows in offline renderers / lightmap baking;
3. Unit-test numerical behaviour (depth deltas, penumbra width, visibility).

Implements Ferrari 2005's three-stage algorithm:

| Stage | Function | Description |
|-------|----------|-------------|
| 1. Blocker Search | `findBlocker(map, u, v, receiverDepth, searchRadius, blockerBias?)` | Samples a 5×5 grid centered on the receiver's UV; a texel is a blocker if `shadowDepth < receiverDepth − blockerBias`. Returns `{ avgDepth, count }`. `count=0` → no blocker → fully lit. |
| 2. Penumbra Estimation | `computePenumbra(blockerDepth, receiverDepth, lightSize, minPenumbra?, maxPenumbra?)` | Similar-triangles formula: `penumbra = (receiver − blocker) × lightSize / blocker`. Clamped to `[1, 16]` texels by default to bound sampling cost. |
| 3. Variable-rate PCF | `samplePCF(map, u, v, receiverDepth, penumbraRadius, bias?, samples?)` | 16-tap rotated Poisson-disk PCF at the penumbra radius. Rotation angle is UV-hash-driven to eliminate banding. Returns visibility `[0,1]`. |

```ts
import { samplePCSS, makeBlockerShadowMap } from '@vreen/engine/renderer';

// Construct a shadow map with a central blocker
const map = makeBlockerShadowMap(1024, 1024, 0.2, 0.9, 0.5, 0.5, 0.5);

// Sample soft-shadow visibility at a receiver point
const visibility = samplePCSS(map, 0.5, 0.5, 0.6, {
  lightSize: 2.0,       // larger = softer
  bias: 0.001,
  blockerBias: 0.001,
  pcfSamples: 16,       // 1 = hard, 16 = high quality
  maxPenumbra: 16,
  minPenumbra: 1,
});
// visibility ∈ [0,1]: 1 = fully lit, 0 = fully shadowed
```

**Key properties:**

- `lightSize` controls penumbra width (larger → softer). Scales both the
  blocker search radius and the penumbra estimate.
- `blockerBias` separates blockers from the receiver (avoids self-shadowing
  acne during the blocker classification step).
- `bias` is applied during the PCF depth test (same role as `PCF_SHADOW_FRAG`'s
  `u_shadowBias`).
- `pcfSamples` (1–16): 1 = hard shadow (cheapest), 16 = full Poisson disk.
- `samplePCSSWithStats()` returns intermediate results (`blockerDepth`,
  `penumbra`, `visibility`) for debugging / visualisation.

| Feature | VREEN `PCSSSampler` | soup3D |
|---------|---------------------|--------|
| Hard shadows | ✓ (pcfSamples=1) | ✓ |
| Fixed-radius PCF | ✓ (`PCF_SHADOW_FRAG`) | ✗ |
| Physical soft shadows (PCSS) | ✓ (Ferrari 2005) | ✗ |
| Variable penumbra by occluder distance | ✓ | ✗ |
| CPU reference implementation | ✓ (headless-testable) | ✗ |
| Poisson-disk rotated sampling | ✓ (16-tap) | ✗ |

soup3D has **basic hard shadows only**. VREEN's PCSS brings contact-point-sharp
/ distant-soft shadows matching UE5 ShadowPenumbra and o3de Atom's PCSS filter
mode — the gold standard for real-time soft shadows.

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

### `ExponentialShadowMap` (`ExponentialShadowMap.ts`)

**Exponential Shadow Maps (ESM)** — a soft-shadow technique that converts
the depth buffer to the exponential domain `exp(c·d)` so that linear /
Gaussian filtering becomes mathematically valid. This eliminates the
N×N depth comparisons required by PCF (and the resulting aliasing) and
allows hardware bilinear sampling of the filtered shadow map. A single
bilinear tap on a pre-filtered ESM texture produces a smooth soft shadow.

Adapted from o3de Atom `EsmShadowmapsPass` + `DepthExponentiationPass`,
Salvi 2008 "Fast Shadow Maps on a 1K Budget", and Annen et al. 2008
"Exponential Shadow Maps". The visibility formula matches o3de's
`ESM.azsli` `SampleESM` 1:1:

```
visibility = clamp(exp(-c · d_receiver) · ESM[u,v], 0, 1)
           = clamp(exp(c · (d_occluder - d_receiver)), 0, 1)
```

where `ESM[u,v] = exp(c · d_occluder)` is the pre-exp-onentiated depth
stored in the ESM texture (produced by `expDepthMap`, equivalent to o3de
`DepthExponentiation.azsl`). When `d_receiver ≤ d_occluder` (receiver is
closer to the light, no occlusion) the exponent is ≥ 0 so `visibility = 1`
(fully lit). When `d_receiver > d_occluder` (receiver is behind the
occluder) the exponent goes negative and `visibility → 0` (fully shadowed).
The transition sharpness is controlled by `c`: larger `c` → sharper
shadows but higher floating-point precision requirements
(RGBA16F safe up to c≈11, RGBA32F safe up to c≈80).

| Stage | Function | Description |
|-------|----------|-------------|
| 1. Depth exponentiation | `expDepthMap(shadowMap, w, h, c)` | Per-pixel `exp(c · clamp(d, 0, 1))` → Float32Array. Mirrors o3de `DepthExponentiationPass`. |
| 2. Filter (optional) | `filterESM(esm, { kernel, radius, sigma, separable })` | Gaussian or box blur on the exp-domain texture. Separable H+V (cost = 2·radius·w·h) or non-separable 2D (cost = (2r+1)²·w·h). Mirrors o3de `EsmBlurPass`. |
| 3a. Single sample | `sampleESM(esm, u, v, receiverDepth, opts)` | 4-tap hardware bilinear on the (optionally pre-filtered) ESM texture + visibility reconstruction. 1 tap after filter, no aliasing. |
| 3b. Filtered sample | `sampleESMFiltered(esm, u, v, receiverDepth, radius, opts)` | Inline N×N box filter + reconstruction (single-pixel query, no pre-filter pass needed; for testing / offline baking). |
| 3c. PCF reference | `sampleESMPCF(shadowMap, w, h, u, v, receiverDepth, radius, bias)` | Standard N×N PCF on raw depth — for cross-validating ESM correctness. |
| Stats | `getESMStats(esm, filterRadius, kernel)` | Returns dimensions, c, filter config, and `[min, max]` of the exp-domain data. |

```ts
import {
  expDepthMap, filterESM, sampleESM, sampleESMFiltered,
} from '@vreen/engine/renderer';

// 1. Build ESM texture from a directional light's depth pass
const esm = expDepthMap(rawDepthFloat32, 2048, 2048, /* c = */ 50.0);

// 2. Pre-filter once per frame (separable Gaussian, radius 4)
const filtered = filterESM(esm, {
  kernel: 'gaussian',
  radius: 4,
  sigma: 2.0,
  separable: true,
});

// 3. Per-pixel visibility (in consumer fragment shader, or CPU test)
const visibility = sampleESM(
  filtered,
  u, v, receiverDepth,
  { c: 50.0, bias: 0.001, wrap: 'clamp' },
);
// visibility ∈ [0, 1] — multiply direct lighting by this factor
```

GLSL chunk `ESM_SAMPLE_GLSL` provides matching GPU functions
(`sampleESM`, `sampleESMBox`, `expDepth`) that mirror the CPU reference
1:1 — drop into the shadow fragment shader and bind the pre-filtered ESM
texture as `sampler2D`.

| Property | Value | Notes |
|----------|-------|-------|
| `c` (exponent) | 50.0 (default) | 16-bit textures: ≤ 11; 32-bit: ≤ 80. Larger → sharper. |
| `bias` | 0.001 | Receiver-depth bias to mitigate self-shadowing acne. |
| `wrap` | `'clamp'` | UV wrap mode for edge taps (`'repeat'` available). |
| `kernel` | `'gaussian'` | Filter kernel (`'box'` is faster, slightly rougher). |
| `radius` | 3 | Filter radius in texels. Larger → softer / wider penumbra. |
| `sigma` | `radius / 2` | Gaussian σ. Defaults to half the radius. |
| `separable` | `true` | H+V two-pass (recommended); `false` = single 2D pass. |

| Feature | VREEN (ESM) | soup3D |
|---------|-------------|--------|
| Hard shadows | ✓ (radius=0) | ✓ |
| Pre-filtered soft shadows | ✓ (Gaussian / box) | ✗ |
| Hardware bilinear on shadow map | ✓ (ESM linearly filterable) | ✗ (PCF only) |
| 1-tap soft shadow after filter | ✓ | ✗ (N×N taps per pixel) |
| No aliasing on filter | ✓ (exp domain is linear-combinable) | ✗ (PCF aliases) |
| CPU reference + headless tests | ✓ (51 unit tests) | ✗ |
| Cost vs PCSS | 1–9 taps | 16–41 taps |

**Why ESM over VSM?** Variance Shadow Maps store `d` and `d²` and use
Chebyshev's inequality for the upper bound on visibility. VSM is
filterable too but suffers from *light leaking* when depth variance is
high (e.g. overlapping occluders at very different depths) and can
explode numerically (`d²` grows fast). ESM stores a single exp value,
is monotonic in depth, and is bounded by `exp(c)` for `d ∈ [0, 1]` —
no light leaking, no precision explosion (with appropriate `c`).

**Compared to PCSS** (`PCSSSampler.ts`): PCSS produces physically-based
variable penumbra (sharp at contact, soft at distance) at the cost of
25-tap blocker search + 16-tap PCF = 41 taps per pixel. ESM produces a
*uniform* penumbra (width controlled by `filterRadius` / `sigma`) at
1–9 taps per pixel after a single pre-filter pass. Use PCSS when
physical accuracy matters (hero shots, cinematics), ESM when performance
matters (VR, mobile, large scenes). The two are complementary — VREEN
ships both, plus basic and PCF, giving four shadow solutions covering
the full quality-performance spectrum.

```ts
// Decision matrix
//   Hero / cinematic shot        → PCSS (physical variable penumbra)
//   Wide outdoor scene           → CSM + ESM (per-cascade soft shadows)
//   VR / mobile / 60 FPS target  → ESM (1-tap after filter)
//   Debug / pixel-accurate       → PCF (deterministic N×N)
```

- o3de Atom `EsmShadowmapsPass.cpp` — original GPU ESM pipeline
- o3de Atom `DepthExponentiationPass.cpp` — `exp(c·d)` conversion pass
- o3de `ESM.azsli` — `SampleESM` reference (formula matched 1:1)
- Salvi 2008 "Fast Shadow Maps on a 1K Budget" — ESM theory
- Annen et al. 2008 "Exponential Shadow Maps" — filtering derivation

### `VirtualShadowMap` (`VirtualShadowMap.ts`)

**Virtual Shadow Maps (VSM)** — adaptive-resolution shadow mapping that
treats the shadow frustum as a *virtual* texture divided into fixed-size
pages (128×128 texels). Pages are allocated on-demand into a physical
atlas (8192×8192), and distant regions use lower mip levels — achieving
"per-pixel shadow resolution adaptation" without the fixed-resolution
limit of traditional shadow maps or the seam artifacts of cascaded
shadow maps.

Adapted from UE5 Virtual Shadow Maps (Engstrom & Persson, SIGGRAPH 2021)
and o3de Atom `VirtualShadowMapPass`. The core insight: a screen-space
texel near the camera maps to many shadow texels (needs high resolution),
while a distant screen texel maps to few shadow texels (low resolution
suffices). VSM allocates high-resolution pages only where they're needed,
saving memory and bandwidth.

**Mip-level selection** — based on the screen-space texel density ratio:

```
texelRatio = (screen-space derivative) / (shadow-space texel size)
mipLevel   = floor(log2(texelRatio / texelDensity))  // clamped to [0, maxMipLevels-1]
```

When `texelRatio ≤ texelDensity` → mip 0 (highest resolution). Each
doubling of `texelRatio` steps up one mip level. With `pageSize=128` and
`maxMipLevels=5`, the virtual resolution pyramid is:
`2048 → 1024 → 512 → 256 → 128` texels per side.

**Page table** — `PageTable` class maps `(mipLevel, pageX, pageY)` →
`(atlasPageX, atlasPageY)` with LRU eviction. When the physical atlas
is full, the least-recently-used page is evicted. A `gc(minFrame)` method
reclaims pages not used in recent frames.

| Function | Description |
|----------|-------------|
| `computePagesPerSide(maxMipLevels)` | Returns array of pages-per-side per mip level. Root = `2^(maxMipLevels-1)`, halving each level. |
| `computeVirtualResolution(pageSize, maxMipLevels)` | Returns virtual texel resolution per mip level. |
| `selectMipLevel(texelRatio, maxMipLevels, texelDensity)` | Chooses mip based on screen-space derivative. `ratio ≤ density → 0`; each 2× → +1 level. |
| `computePageId(u, v, mipLevel, maxMipLevels)` | Converts shadow UV + mip → `{mipLevel, pageX, pageY}`. UV clamped to `[0,1)`. |
| `packPageUV(virtualU, virtualV, mip, ..., atlasPageX, atlasPageY, ...)` | Converts virtual UV to physical atlas UV using page table coordinates. |
| `PageTable` class | Virtual→physical page mapping with LRU eviction, `allocate()`, `find()`, `invalidate()`, `gc()`, `clear()`. |
| `sampleVSM(depthAtlas, atlasSize, pageTable, u, v, texelRatio, opts)` | Full VSM sample: mip select → page lookup → atlas UV pack → depth fetch. Returns `{depth, valid, mipLevel, atlasUV}`. |
| `writePageToAtlas(...)` / `readPageFromAtlas(...)` | Write/read a page-sized depth block into/from the physical atlas. |
| `vsmVisibility(receiverDepth, storedDepth, bias)` | Single-tap depth comparison → 0 or 1. |
| `vsmVisibilityPCF4(...)` | 4-tap PCF (2×2 grid) for soft shadow edges. |
| `computeVisiblePages(minUV, maxUV, texelRatio, opts)` | Returns list of visible page IDs for a screen region — for dirty-marking. |
| `VSM_SAMPLE_GLSL` | GLSL chunk with `vsmSample()`, `vsmSamplePCF4()`, `vsmSelectMipLevel()`, `vsmPackPageUV()` for WebGL2 fragment shaders. |

```ts
import {
  PageTable, sampleVSM, writePageToAtlas,
  computePageId, selectMipLevel, applyVSMDefaults,
  vsmVisibility,
} from '@vreen/engine/renderer';

const opts = applyVSMDefaults({ pageSize: 128, atlasSize: 8192, maxMipLevels: 5 });
const atlas = new Float32Array(opts.atlasSize * opts.atlasSize);
const pageTable = new PageTable(opts.atlasSize, opts.pageSize);

// 1. For each visible screen region, allocate pages
const pageId = computePageId(shadowUV.u, shadowUV.v, 0, opts.maxMipLevels);
const physical = pageTable.allocate(pageId, frameNumber);

// 2. Render shadow depth into page, then write to atlas
writePageToAtlas(atlas, opts.atlasSize, opts.pageSize,
  physical.atlasPageX, physical.atlasPageY, pageDepthData);

// 3. Per-pixel shadow sampling in fragment shader (or CPU reference)
const sample = sampleVSM(atlas, opts.atlasSize, pageTable,
  shadowUV.u, shadowUV.v, texelRatio, opts);
if (sample.valid) {
  const visibility = vsmVisibility(receiverDepth, sample.depth, 0.001);
  // visibility = 0 (shadowed) or 1 (lit)
}
```

| Property | Default | Notes |
|----------|---------|-------|
| `pageSize` | 128 | Texels per page side. Larger = fewer pages but more waste per allocation. |
| `atlasSize` | 8192 | Physical atlas texel size. Must be multiple of `pageSize`. 8192/128 = 64×64 = 4096 pages. |
| `maxMipLevels` | 5 | Mip chain depth. 5 → root 2048 texels, coarsest 128 texels. |
| `texelDensity` | 1.0 | Target shadow texels per screen pixel. 1.0 = 1:1; 0.5 = supersampled. |
| `clampBorder` | true | Clamp UVs to `[0,1]` to prevent page-edge leaking. |

| Feature | VREEN (VSM) | soup3D |
|---------|-------------|--------|
| Adaptive per-pixel shadow resolution | ✓ | ✗ |
| Page-based virtual texture | ✓ (128×128 pages) | ✗ |
| Physical atlas with LRU eviction | ✓ (8192², 4096 pages) | ✗ |
| Screen-space texel density mip selection | ✓ | ✗ |
| PCF 4-tap soft edges | ✓ | ✗ |
| CPU reference + headless tests | ✓ (74 unit tests) | ✗ |
| Fixed-resolution shadow map | — (superseded) | ✓ (2048² or 4096²) |
| Cascaded Shadow Maps | ✓ (CSMShadowMap, separate) | ✗ |

**Compared to CSM** (`CascadedShadowMap.ts` / `CSMShadowMap.ts`): CSM
splits the view frustum into slices, each with its own shadow map.
CSM has seam artifacts at slice boundaries and requires careful blend
regions. VSM has no seams — each screen pixel gets its own mip level
based on local texel density, producing continuous resolution without
artificial boundaries. VSM also adapts to anisotropic density (e.g.
grazing-angle surfaces get more texels), while CSM resolution is
isotropic per slice.

**Compared to ESM** (`ExponentialShadowMap.ts`): ESM solves the
*filtering* problem (how to blur a shadow map without aliasing), while
VSM solves the *resolution* problem (how to get enough texels where they
matter). They are orthogonal and can be combined: render depth into VSM
pages, then apply ESM exponentiation + filtering per page. VREEN ships
both independently; combining them is left to the integration layer.

```ts
// Decision matrix
//   Large open-world scene       → VSM (adaptive resolution, no seams)
//   Wide outdoor with soft shadows → CSM + ESM (per-cascade exp filter)
//   Hero / cinematic shot          → PCSS (physical variable penumbra)
//   VR / mobile / 60 FPS target    → ESM (1-tap after filter)
//   Debug / pixel-accurate         → PCF (deterministic N×N)
```

- UE5 Virtual Shadow Maps — Engstrom & Persson, SIGGRAPH 2021
- o3de Atom `VirtualShadowMapPass` — page-based VSM pipeline
- Karis "Real Shadows in Real Time with VSM" — UE blog (2020)
- Myers & Bavoil "Stencil Routed K-Buffer" (2022) — K-buffer techniques

### `MeshShaderPipeline` (`MeshShaderPipeline.ts`)

**Mesh Shader Pipeline** — a two-stage (Task Shader + Mesh Shader) GPU-driven
geometry pipeline adapted from o3de Atom `MeshShaderPass` /
`MeshShaderDispatchItem`, NVIDIA Turing Mesh Shaders (SIGGRAPH 2019), and
Vulkan `VK_EXT_mesh_shader`. It replaces the traditional
`IA → VS → HS → DS → GS → RS → PS` pipeline with
`Task Shader → Mesh Shader → RS → PS`:

1. **Task Shader** runs in workgroups of `taskWorkgroupSize` (default 32)
   meshlets each, performing per-meshlet culling on the GPU:
   - LOD distance culling (skip meshlets beyond `lodDistance`)
   - Frustum culling (sphere vs. 6 planes)
   - Normal-cone backface culling (cone axis vs. view direction)
   - HZB occlusion culling (sphere projected to screen, depth compared
     against hierarchical Z-buffer mip)
   - Surviving meshlets are compacted into `TaskDispatchItem[]`
     (meshletId + meshWorkgroupCount + LOD level + task workgroup index).

2. **Mesh Shader** runs one workgroup per visible meshlet, transforming
   vertices to clip space and performing per-triangle backface culling:
   - Computes `MVP = viewProjection × model` (column-major multiply)
   - Transforms each vertex to world + clip space
   - For each triangle: computes geometric normal (cross product of
     edges), checks `dot(viewDir, normal) <= 0` → backface
   - Outputs `MeshShaderVertex[]` (clip + world + localIndex) and
     `MeshShaderTriangle[]` (v0/v1/v2 + visible flag).

WebGL2 does not natively support Mesh Shaders (requires
Vulkan / D3D12 / Metal). This module provides:

- **CPU reference implementation** (pure functions, no WebGL dependency,
  runnable in Node / headless environments — same pattern as
  `MeshletRenderer`, `PCSSSampler`, `VirtualShadowMap`).
- **GLSL chunks** (`TASK_SHADER_GLSL`, `MESH_SHADER_GLSL`) for future
  WebGL2 emulation (Task stage via compute-like 1D vertex dispatch
  writing to SSBO; Mesh stage via instanced rendering reading meshlet
  data) or WebGPU backend integration.

#### Data Flow

```
MeshletBuildResult (from MeshletRenderer)
        │
        ▼
meshletBoundsToCullData()  ──→  MeshletCullData[]  (SoA-friendly)
        │
        ▼
executeTaskShader()        ──→  TaskDispatchItem[]  (visible meshlets)
        │
        ▼
executeMeshShader()        ──→  MeshShaderOutput[]  (vertices + triangles)
        │
        ▼
flattenMeshShaderOutput()  ──→  { positions, indices }  (for fallback
                                                       traditional drawElements)
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `sphereInFrustum(center, radius, planes)` | Sphere vs. 6-plane frustum test |
| `coneBackfaceCulled(apex, axis, cutoff, view)` | Normal-cone backface test (matches `MeshletRenderer.meshletIsFrontFacing`) |
| `isMeshletOccluded(center, radius, vp, hzb, ...)` | HZB occlusion test with mip selection |
| `computeMeshletLOD(center, radius, view, screen)` | Screen-space size → LOD level (0-4) |
| `executeTaskShader(input, options)` | Task stage: cull + compact → dispatch items |
| `executeMeshShader(input, options)` | Mesh stage: transform + cull → vertices + triangles |
| `executeMeshShaderPipeline(...)` | Full pipeline: Task → Mesh → outputs + stats |
| `meshletBoundsToCullData(bounds)` | Convert `MeshletRenderer.MeshletBounds[]` → `MeshletCullData[]` |
| `flattenMeshShaderOutput(outputs)` | Flatten to traditional `{ positions, indices }` for fallback |
| `mat4Multiply(a, b)` | Column-major 4×4 matrix multiply |

#### Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `taskWorkgroupSize` | 32 | Meshlets per task workgroup |
| `frustumCulling` | true | Enable frustum culling in task shader |
| `backfaceCulling` | true | Enable normal-cone backface culling in task shader |
| `occlusionCulling` | false | Enable HZB occlusion culling |
| `lodCulling` | true | Enable LOD distance culling |
| `lodDistance` | 1000 | Max view distance before LOD cull |
| `conservativeBias` | 0.005 | HZB depth bias (reduce false culls) |
| `meshWorkgroupSize` | 32 | Threads per mesh workgroup |
| `perTriangleBackfaceCulling` | true | Per-triangle backface cull in mesh shader |

#### Culling Pipeline (Task Shader)

```
meshlet ──→ LOD distance ──→ Frustum ──→ Normal cone ──→ HZB ──→ visible
                │                │             │            │
                ▼                ▼             ▼            ▼
           lodCulled      frustumCulled  backfaceCulled  occlusionCulled
```

#### Comparison with soup3D

| Feature | VREEN (Mesh Shader) | soup3D |
|---------|---------------------|--------|
| Task Shader (GPU meshlet culling) | ✓ (CPU ref + GLSL) | ✗ |
| Mesh Shader (workgroup vertex output) | ✓ (CPU ref + GLSL) | ✗ |
| Per-meshlet frustum culling | ✓ | ✗ |
| Per-meshlet normal-cone backface culling | ✓ | ✗ |
| Per-meshlet HZB occlusion culling | ✓ | ✗ |
| Per-meshlet LOD distance culling | ✓ | ✗ |
| Per-triangle backface culling in mesh shader | ✓ | ✗ |
| LOD level computation (screen-space) | ✓ | ✗ |
| GLSL chunks for WebGL2 emulation | ✓ | ✗ |
| CPU reference + headless tests | ✓ (74 unit tests) | ✗ |
| Traditional IA + VS pipeline only | — (superseded) | ✓ |

soup3D uses only the traditional `IA → VS` pipeline for all geometry,
submitting each mesh as a whole without per-meshlet culling. VREEN's
Mesh Shader pipeline (combined with `MeshletRenderer` for meshlet
construction, `VisibilityBuffer` for deferred shading, and
`HierarchicalZBuffer` for occlusion) provides a complete GPU-driven
rendering stack matching UE5 Nanite and o3de Atom MeshletsModule.

#### Relationship with MeshletRenderer

| Aspect | MeshletRenderer | MeshShaderPipeline |
|--------|-----------------|-------------------|
| Stage | CPU meshlet construction + culling | GPU meshlet dispatch (Task + Mesh) |
| Input | Raw positions + indices | MeshletCullData[] + meshlet vertex/index data |
| Output | Indirect draw commands | Mesh shader outputs (vertices + triangles) |
| Culling | CPU frustum/backface/HZB | GPU frustum/backface/HZB/LOD |
| Use case | Offline / headless / fallback | Real-time GPU-driven rendering |

`meshletBoundsToCullData()` bridges the two: convert `MeshletRenderer`'s
`MeshletBounds[]` to `MeshletCullData[]`, then feed into
`executeMeshShaderPipeline()`.

#### References

- o3de Atom `MeshShaderPass` / `MeshShaderDispatchItem` — GPU mesh shader pipeline
- NVIDIA "Mesh Shaders" — Turing architecture, SIGGRAPH 2019
- Vulkan `VK_EXT_mesh_shader` / `GL_NV_mesh_shader` — API specification
- AMD RDNA2 Mesh Shader Programming Guide — hardware best practices
- UE5 Nanite — meshlet-based virtualized geometry system

### `SSGI` (`SSGI.ts`)

**Screen-Space Global Illumination** CPU reference implementation, adapted from
Crytek SSDO (Ritschel 2009), o3de Atom `ScreenSpaceGlobalIllumination` pass,
UE5 Lumen Screen Space GI, and EA SEED "Stable SSAO" GDC talk.

Complements the GPU `PostProcess/SSGIPass.ts` (which uses the `SSGI_FRAG` GLSL
shader). This module provides pure CPU functions (no WebGL dependency, runnable
in Node/headless) for shader validation, offline rendering, and unit testing.

**Algorithm (1:1 with `SSGI_FRAG` GLSL):**

1. **IGN jittering** — Interleaved Gradient Noise (Jimenez 2014) for per-pixel
   low-discrepancy sampling, better than white noise (blue-noise-like).
2. **TBN basis** — orthonormal basis constructed from surface normal (no
   tangent attribute required): `up = |N.z| < 0.999 ? (0,0,1) : (1,0,0)`,
   `T = normalize(cross(up, N))`, `B = cross(N, T)`.
3. **Cosine-weighted hemisphere sampling** — importance sampling:
   `θ = asin(√ξ₁)`, `φ = 2π·ξ₂ + frameRot` (golden angle ≈ 137.5° per frame).
4. **View-space thickness hit test** — `depthDiff = rayDepth - sampledDepth`;
   hit when `0 < depthDiff < thickness`.
5. **Adaptive step size** — `baseStep * (1 + i*0.5)` (near-small, far-large).
6. **Accumulation** — edge fade + distance attenuation (`1/(1+d²·2)`) +
   cosine weight; normalized by total weight.
7. **Backface culling** — `dot(viewDir, N) <= 0` → skip (no indirect light).

**Production-grade features (beyond basic `SSGI_FRAG`):**

| Function | Description |
|----------|-------------|
| `temporalAccumulate()` | Temporal accumulation with velocity-based reprojection + 3×3 neighborhood clamping (ghost suppression) |
| `denoiseSpatial()` | Edge-preserving bilateral filter (normal + depth + spatial weights, cross-bilateral) |
| `varianceClip()` | SVGF-style statistical outlier clipping (μ ± γ·σ from 3×3 neighborhood) |

**Exported API:**

| Export | Type | Description |
|--------|------|-------------|
| `ign(px, py)` | function | Interleaved Gradient Noise [0,1) |
| `buildTBN(n)` | function | TBN orthonormal basis from normal |
| `cosineSampleHemisphere(xi1, xi2, tbn, rot)` | function | Cosine-weighted hemisphere sample |
| `projectToUV(worldPos, proj, view)` | function | World → screen UV |
| `viewDepth(worldPos, view)` | function | View-space depth |
| `sampleTextureClamp(tex, u, v)` | function | CLAMP_TO_EDGE + nearest sampling |
| `hitTestVS(rayPos, u, v, posMap, view, thickness)` | function | View-space thickness hit test |
| `marchRay(...)` | function | Single ray march (adaptive step) |
| `computeSSGIPixel(px, py, input, opts)` | function | Per-pixel SSGI |
| `executeSSGI(input, opts)` | function | Full-screen SSGI pass |
| `temporalAccumulate(current, history, velocity, alpha)` | function | Temporal accumulation |
| `denoiseSpatial(input, posMap, nrmMap, radius, strength)` | function | Spatial denoise |
| `varianceClip(current, history, gamma)` | function | Variance-guided clipping |
| `vadd/vsub/vscale/vdot/vcross/vlength/vnormalize` | function | Vec3 math |
| `mat4TransformVec3/mat4ProjectVec3` | function | Mat4 × vec3 (column-major) |
| `SSGI_TEMPORAL_FRAG` | GLSL | Temporal accumulation shader |
| `SSGI_DENOISE_FRAG` | GLSL | Spatial denoise shader |

**Comparison with soup3D:**

| Feature | VREEN | soup3D |
|---------|-------|--------|
| Screen-Space GI (SSGI) | ✓ (CPU ref + GPU + temporal + denoise) | ✗ |
| Cosine-weighted hemisphere sampling | ✓ (8 rays, IGN jitter) | ✗ |
| View-space thickness hit test | ✓ | ✗ |
| Adaptive step size | ✓ (near-small far-large) | ✗ |
| Temporal accumulation | ✓ (reprojection + neighborhood clamp) | ✗ |
| Spatial denoise (bilateral) | ✓ (normal + depth + spatial weights) | ✗ |
| Variance clipping (SVGF) | ✓ (μ ± γ·σ) | ✗ |
| DDGIVolume (world-space GI) | ✓ | ✗ |
| GlobalIllumination (SH2 probes) | ✓ | ✗ |
| PathTracer (reference) | ✓ | ✗ |
| CPU reference (headless/testable) | ✓ (91 unit tests) | ✗ |

**Relationship with other GI modules:**

- `SSR` — specular reflection (metal/wet surfaces)
- `SSGI` — diffuse indirect light (color bleed on rough surfaces)
- `GTAO` — ambient occlusion (contact shadows)
- `DDGIVolume` — world-space low-frequency GI base
- `GlobalIllumination` — SH2 light probes
- `PathTracer` — reference/offline ground truth

Typical production setup: DDGI provides low-frequency base, SSGI adds
high-frequency screen-space detail, GTAO adds contact occlusion.

**References:**

- Ritschel et al. 2009 "Approximating Dynamic Global Illumination in Image Space" (SSDO)
- o3de Atom `ScreenSpaceGlobalIllumination` pass
- UE5 Lumen "Screen Space GI"
- EA SEED "Stable SSAO" GDC (IGN temporal jittering)
- Jimenez 2014 "Interleaved Gradient Noise"
- Schied et al. 2017 "Spatiotemporal Variance-Guided Filtering" (SVGF)

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

### `TemporalSuperResolution` (`TemporalSuperResolution.ts`)

Temporal Super Resolution (TSR) — CPU reference implementation of temporal upscaling. Reconstructs a high-resolution image (e.g. 4K) from a low-resolution render (e.g. 1080p) by accumulating sub-pixel detail across frames, matching **UE5 TSR / AMD FSR2 / NVIDIA DLSS** quality class. Complementary to `TAAPass` (same-resolution TAA): TSR handles cross-resolution reconstruction, where the core difficulty is reprojection and sub-pixel accumulation between low-res input and high-res history.

**Adapted from**: Karis 2014 "High Quality Temporal Supersampling", UE5 `TemporalSuperResolution`, AMD FSR2 (temporal), o3de Atom `UpscalingPass` (temporal mode).

**Algorithm (5 stages):**

1. **Sub-pixel jitter** — Each frame the low-resolution camera is offset by a Halton(2,3) sequence so that successive frames sample different sub-pixel positions of the high-resolution grid. Multi-frame accumulation fills in high-resolution detail that a single low-res frame cannot capture.
2. **Reprojection** — Per high-res output pixel, the corresponding low-res pixel is located (floor of the scaled coordinate), its velocity is read, and the previous-frame UV is computed as `histUV = (lowPx - velocity) / lowRes`. UVs outside `[0,1]` indicate disocclusion.
3. **Neighborhood clamp** — A 3×3 neighborhood AABB (min/max per RGB channel) is computed on the low-res current frame. The history color (bilinearly sampled from the high-res history buffer) is clamped to this AABB, eliminating ghosting when the history disagrees with the current frame. An optional Catmull-Rom soft clamp converges the history 50% toward the neighborhood center, preserving more historical detail at the cost of mild trailing.
4. **Confidence blend** — A per-pixel confidence weight in `[0,1]` is computed from velocity magnitude and disocclusion state:
   - Static / low-speed pixels → confidence ≈ `1 - blendFactor` (max history weight, rich detail);
   - High-speed pixels (speed ≥ `velocityThreshold`) → confidence = `blendFactor` (mostly current frame, fast response);
   - Disoccluded pixels → confidence = 0 (history discarded entirely).
   The final color is `history * confidence + current * (1 - confidence)`.
5. **EASU fallback** — On the first frame, on disoccluded pixels, or when confidence is 0, the current-frame contribution is produced by an FSR1-style EASU spatial upsample (bilinear approximation of the 9-tap edge-adaptive kernel) instead of the history, preventing trailing artifacts.

**Why not just FSR1?** FSR1 (`FSRUpscalePass`) is purely spatial — a 9-tap bilateral kernel with no temporal history. It cannot recover sub-pixel detail that was never rendered, so edges may appear soft and fine texture detail is lost. TSR leverages multi-frame history to perform sub-pixel detail reconstruction, approaching native high-resolution quality.

**Public API (pure functions, no WebGL dependency — headless-testable):**

| Function | Description |
|----------|-------------|
| `halton(index, base)` | Halton low-discrepancy sequence value in `[0,1)`. |
| `getJitter(index, scale=1.0)` | Per-frame Halton(2,3) jitter offset in pixels, centered around `[-0.5*scale, 0.5*scale]`. |
| `bilinearSampleRGBA(buf, u, v)` | Bilinear RGBA sample at UV `[0,1]`, edges clamped. |
| `reprojectToHistory(lowX, lowY, velX, velY, lowW, lowH, highW, highH)` | Map low-res pixel + velocity to history UV. |
| `neighborhoodMinMax(current, x, y, radius=1)` | 3×3 (or larger) neighborhood RGB AABB. |
| `clampToAABB(color, minC, maxC)` | Hard AABB clamp. |
| `catmullRomClamp(history, center, minC, maxC)` | Soft clamp — 50% convergence toward center. |
| `computeConfidence(velX, velY, disoccluded, velocityThreshold=16, blendFactor=0.1)` | Per-pixel history weight `[0,1]`. |
| `easuSample(current, highX, highY, highW, highH)` | FSR1 EASU simplified spatial upsample (bilinear approximation). |
| `sharpen(buf, x, y, strength)` | Laplacian sharpen: `color + strength * (color - neighbor_avg)`. |
| `resolveTSR(current, history, velocity, depth, opts?)` | Main resolve: low-res current + high-res history → high-res output. Returns `{ output, history, stats }`. |
| `makeSolidBuffer(w, h, r, g, b, a=255)` | Test helper: solid-color `PixelBuffer`. |
| `makeZeroVelocity(w, h)` | Test helper: zero-velocity `VelocityBuffer` (static scene). |

**Options (`TSROptions`):**

| Option | Default | Description |
|--------|---------|-------------|
| `blendFactor` | `0.1` | History blend factor (0..1). Higher = more current frame (faster response, less detail). |
| `sharpness` | `0.0` | Sharpening strength (0 = off, typical 0.2–0.5). |
| `clampRadius` | `1` | Neighborhood clamp radius (1 = 3×3). |
| `useCatmullRom` | `false` | Use Catmull-Rom soft clamp instead of hard AABB. |
| `velocityThreshold` | `16` | Velocity (pixels) above which history weight drops to `blendFactor`. |
| `useEASUFallback` | `true` | Use EASU spatial upsample for disoccluded / first-frame pixels. |

**Stats (`TSRStats`):**

| Field | Description |
|-------|-------------|
| `pixelsProcessed` | Output pixel count. |
| `easuFallbacks` | Pixels that fell back to EASU (disocclusion / first frame). |
| `avgConfidence` | Average per-pixel confidence (debug). |
| `lastFrameTimeMs` | Last resolve wall-clock time. |

**GLSL counterpart:** `TSR_RESOLVE_FRAG` in `Materials/shaders.ts` is a 1:1 GPU implementation of `resolveTSR`. The CPU functions exist as a headless-testable reference and for offline / SSR / screenshot pipelines; the GPU shader is used in the realtime pipeline.

**Typical pipeline placement:**

```
   low-res scene render (with Halton jitter applied to projection)
        ↓
   TAA (optional, same-resolution temporal AA on low-res)
        ↓
   TSR resolve (low-res → high-res, with velocity + history)
        ↓
   sharpen / tonemap / film grain / UI composite
        ↓
   present
```

**soup3D comparison:** soup3D has no temporal upscaling at all — it renders at native resolution or uses basic bilinear upsampling. VREEN's TSR brings the engine to UE5/o3de Atom UpscalingPass (temporal mode) parity, delivering near-native image quality at 50%–70% render resolution for a substantial performance uplift.

**References:**

- Karis 2014, "High Quality Temporal Supersampling" — foundational sub-pixel jitter + neighborhood clamp + confidence blend.
- UE5 `TemporalSuperResolution` — production-grade TSR with history buffering, depth-aware disocclusion, EASU fallback.
- AMD FSR2 — open-source temporal upscaler (MIT).
- o3de Atom `UpscalingPass` (temporal mode) — engine integration reference.
- Yang et al. 2020, "Survey of Temporal Anti-Aliasing Techniques" — taxonomy of TAA/TSR variants.

### `SVGFDenoiserPass` (`SVGFDenoiserPass.ts`)

Spatiotemporal Variance-Guided Filtering (SVGF) — CPU reference implementation of a high-quality denoiser for low-sample stochastic rendering inputs (SSR, SSGI, path tracing, stochastic shadows, RT reflections). Matches **Schied et al. 2017 SVGF / UE5 Denoiser / o3de Atom `DenoiserPass` / NVIDIA NRD** quality class. The CPU pure functions are a 1:1 mirror of the GLSL `SVGF_TEMPORAL_FRAG` / `SVGF_VARIANCE_FRAG` / `SVGF_ATROUS_FRAG` chunks in `Materials/shaders.ts` — headless-testable, no WebGL dependency.

**Adapted from**: Schied et al. 2017 "Spatiotemporal Variance-Guided Filtering", UE5 `Denoiser`, o3de Atom `DenoiserPass`, NVIDIA NRD (NRD is reference for the `varianceBoost` knob and edge-stopping weight tuning).

**Algorithm (3 stages):**

1. **Temporal accumulation** — Per pixel, the velocity buffer maps the current pixel back to the previous frame position (`histUV = (px - velX, py - velY) / dims`). The history is bilinearly sampled at `histUV`; if it falls outside `[0,1]` the pixel is treated as disoccluded and reset to the current frame (`samples = 1`). Otherwise a confidence-weighted blend is performed: `output = history * (1 - α) + current * α`, where `α = temporalAlpha` (default 0.2 → 80% history). The sample counter is accumulated as `samples = histSamples * (1 - α) + 1`, capped at 256 to prevent unbounded accumulation.
2. **Variance estimation** — A 3×3 neighborhood luminance variance is computed per pixel: `σ² = E[X²] - E[X]²`. The variance is then scaled by `1 / min(samples, 4)`, modeling that regions with more temporal accumulation are statistically more stable. Result is normalized to `[0,1]` (divided by `255²`). Optional `varianceBoost` (default 1.0) amplifies the variance so that high-variance regions are filtered more aggressively.
3. **A-trous wavelet filter** — Iterative 5×5 cross-kernel filtering with edge-stopping weights. Each iteration doubles the step size (`1, 2, 4, 8, ...`), so 4 iterations cover an effective `33×33` kernel at the cost of only `9×4 = 36` taps. Three edge-stopping weights are multiplied per tap:
   - **Depth**: `w_depth = exp(-|Δdepth| / (σ_z + ε))` — preserves depth discontinuities (object silhouettes).
   - **Normal**: `w_normal = max(0, dot(N_p, N_x))^σ_n` — preserves normal discontinuities (sharp corners).
   - **Luminance**: `w_lum = variance < ε ? 1.0 : exp(-|Δlum|² / (σ_l * variance * 255² + ε))` — preserves luminance edges only when variance is non-zero; in stable regions (`variance ≈ 0`) the luminance weight is bypassed (returns 1.0), since there is nothing to filter.
   The final filtered color is `Σ(w * color) / Σ(w)`, with a center-copy fallback when `Σ(w) < 1e-6` (fully occluded edges).

**Why is variance needed?** Without variance guidance, a uniform spatial filter either over-blurs high-frequency detail (large kernel) or under-filters noise (small kernel). SVGF uses the per-pixel variance to modulate the luminance edge-stopping sigma: noisy regions (high variance) use a large sigma (aggressive smoothing), stable regions (low variance) use a tiny sigma (preserves detail). This adaptive behavior is what allows 4 iterations of a small 5×5 kernel to achieve the quality of a much larger uniform filter.

**Public API (pure functions, no WebGL dependency — headless-testable):**

| Function | Description |
|----------|-------------|
| `svgfLuminance(r, g, b)` | Rec. 709 luminance `0.2126R + 0.7152G + 0.0722B`. |
| `temporalAccumulation(current, history, historySamples, velocity, alpha=0.2)` | Stage 1: velocity-based reprojection + α-blend. Returns `{ color, samples, resets }`. |
| `estimateVariance(color, samples)` | Stage 2: 3×3 luminance variance, sample-weighted, normalized to `[0,1]`. |
| `edgeStoppingWeight(depthP, depthX, normalP, normalX, lumP, lumX, variance, depthSigma=1, normalPower=32, luminanceSigma=4)` | Per-tap weight `[0,1]` = `w_depth * w_normal * w_lum`. |
| `atrousFilterIteration(color, depth, normal, variance, step, opts?)` | Stage 3 single iteration: 5×5 cross kernel, step-scaled. Returns new `SVGFPixelBuffer`. |
| `svgfDenoise(current, history, historySamples, velocity, depth, normal, opts?)` | Main entry: 3-stage pipeline. Returns `{ output, history, samples, stats }`. |
| `makeSolidPixelBuffer(w, h, r, g, b, a=255)` | Test helper: solid-color `SVGFPixelBuffer`. |
| `svgfMakeZeroVelocity(w, h)` | Test helper: zero-velocity `SVGFVelocityBuffer` (static scene). |
| `makeConstantDepth(w, h, value=0.5)` | Test helper: constant `SVGFDepthBuffer`. |
| `makeConstantNormal(w, h, nx=0, ny=0, nz=1)` | Test helper: constant `SVGFNormalBuffer` (default +Z). |

**Options (`SVGFOptions`):**

| Option | Default | Description |
|--------|---------|-------------|
| `temporalAlpha` | `0.2` | Temporal blend factor (0..1). Higher = more current frame (faster response, more noise). |
| `atrousIterations` | `4` | A-trous iterations (1..8). 4 iterations → effective 33×33 kernel. |
| `depthSigma` | `1.0` | Depth edge-stopping sigma (NDC space). Higher = more tolerant of depth gaps. |
| `normalPower` | `32.0` | Normal edge-stopping exponent. Higher = sharper (smaller normal difference stops filtering). |
| `luminanceSigma` | `4.0` | Luminance edge-stopping sigma. Higher = more tolerant of luminance differences. |
| `varianceBoost` | `1.0` | Variance amplification factor. >1 → more aggressive filtering in noisy regions. |

**Stats (`SVGFStats`):**

| Field | Description |
|-------|-------------|
| `pixelsProcessed` | Total pixels processed. |
| `temporalResets` | Pixels that reset temporal accumulation (disocclusion / first frame). |
| `avgSamples` | Average temporal sample count (debug). |
| `avgVariance` | Average per-pixel variance (debug). |
| `atrousIterations` | Actual a-trous iterations executed (clamped to `[1,8]`). |
| `lastFrameTimeMs` | Last denoise wall-clock time. |

**GLSL counterpart:** Three chunks in `Materials/shaders.ts` provide a 1:1 GPU implementation:
- `SVGF_TEMPORAL_FRAG` — Stage 1 (temporal accumulation).
- `SVGF_VARIANCE_FRAG` — Stage 2 (variance estimation).
- `SVGF_ATROUS_FRAG` — Stage 3 (single a-trous iteration; called N times by the renderer with `u_step = 1, 2, 4, 8, ...`).

The CPU functions exist as a headless-testable reference and for offline / screenshot / SSR pipelines; the GPU shaders are used in the realtime pipeline.

**Typical pipeline placement:**

```
   GBuffer pass (color + depth + normal + velocity)
        ↓
   stochastic pass (SSR / SSGI / path trace) — low sample count (1 spp)
        ↓
   SVGF denoise:
     stage 1: temporal accumulation (velocity reprojection + α-blend)
     stage 2: variance estimation (3×3 neighborhood)
     stage 3: a-trous filter × 4 (step 1, 2, 4, 8)
        ↓
   composite with main scene color
        ↓
   TAA / TSR / tonemap / present
```

**soup3D comparison:** soup3D has no dedicated denoiser at all — SSR / SSGI / shadow noise is either left raw (visible noise) or suppressed by a single-pass Gaussian blur (which destroys detail). VREEN's SVGF brings the engine to UE5 / o3de Atom / NVIDIA NRD parity, enabling 1-spp stochastic rendering (path tracing, RT reflections, RTGI) at real-time frame rates with stable, edge-preserving output.

**References:**

- Schied et al. 2017, "Spatiotemporal Variance-Guided Filtering" — foundational SVGF paper.
- UE5 `Denoiser` — production-grade temporal + spatial denoiser with history buffering.
- o3de Atom `DenoiserPass` — engine integration reference.
- NVIDIA NRD — state-of-the-art denoiser library (reference for `varianceBoost` and edge-stopping weight tuning).
- Dammertz et al. 2010, "Edge-Avoiding A-Trous Wavelet Transform for Fast Global Illumination Filtering" — a-trous wavelet filter origin.

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

IBL reflection probes — capture 6-face cube-map snapshots of the scene
at arbitrary world positions for **local** reflection mapping. A probe
renders the scene from its `position` with a 90° FOV camera in 6
directions (±X, ±Y, ±Z), reads back the pixels, and uploads them to a
GL cube texture that PBR materials sample as `u_envMap`. Multiple
probes coexist via `ReflectionProbeManager`, which selects the
highest-priority probe whose AABB (`boxSize`) contains the current
shading point, falling back to the nearest probe by normalized distance.

**Class**: `ReflectionProbe` (independent `Object3D`-like; not a `RenderPass`)
**Class**: `ReflectionProbeManager` (probe registry + selector)
**Adapted from**: three.js `CubeCamera` + o3de Atom `ReflectionProbe`

#### Two capture paths

| Path | Option | GL format | mip chain | IBL correctness | When to use |
|------|--------|-----------|-----------|-----------------|-------------|
| **LDR** (default) | `prefilter: false` | `RGBA8` | `generateMipmap` (box-filter) | ❌ Roughness IBL wrong (mip ≠ GGX pre-convolution) | Quick previews, low-end devices, non-PBR scenes |
| **PMREM** | `prefilter: true` | `RGBA16F` | explicit GGX importance-sampled mip chain | ✅ Physically correct (matches UE5 / o3de Atom) | Production PBR, metallic surfaces, art-directed IBL |

The PMREM path closes the quality gap with three.js
`PMREMGenerator.fromScene()` and o3de Atom's `ImageBasedLightProcessor`:
the captured RGBA8 pixels are converted to `Float32` RGB
(`EnvironmentCubeData`), fed through `PMREMGenerator.prefilter()` (Karis
2013 split-sum GGX importance sampling), and uploaded as a `RGBA16F` mip
chain — each mip encodes a different surface roughness α (mip 0 = α=0
mirror, last mip = α=1 fully rough). The PBR shader's
`textureLod(u_envMap, R, roughness * mipCount)` then fetches the
correctly-blurred reflection for each surface roughness.

The LDR path calls `gl.generateMipmap` on the captured cube — these mips
are *box-filtered* (uniform average), not GGX-pre-filtered, so
`textureLod` at a roughness mip returns a too-sharp, non-physical
reflection. The PMREM path **does not** call `generateMipmap` (the PMREM
mip chain is already the pre-filtered result — box-filtering it again
would destroy the GGX convolution).

#### Options (`ReflectionProbeOptions`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `position` | `Vector3` | `(0,0,0)` | Probe world position (cube-map capture eye). |
| `resolution` | `number` | `256` | Cube face edge length in pixels. Must be ≥ 2; powers of 2 recommended for mip chain. PMREM requires ≥ 16 (`PMREMGenerator` minimum). |
| `boxSize` | `Vector3` | `(10,10,10)` | Influence AABB half-extents. A point inside `position ± boxSize` gets influence weight 1.0. |
| `priority` | `number` | `0` | Higher wins when multiple probes contain the same point. |
| `near` | `number` | `0.1` | Capture camera near plane. |
| `far` | `number` | `1000` | Capture camera far plane. |
| `prefilter` | `boolean` | `false` | PMREM pre-filter path toggle. `true` → `RGBA16F` + GGX mip chain (physically correct IBL). `false` → `RGBA8` + box-filter mipmap (fast, wrong roughness). |
| `pmremSamples` | `number` | `32` | Max GGX importance samples per output texel (PMREM path only). Higher = smoother but slower. mip 0 always 1 sample (direct copy). |

#### API

```ts
class ReflectionProbe {
  position: Vector3; resolution: number; boxSize: Vector3;
  priority: number; near: number; far: number;
  prefilter: boolean; pmremSamples: number;
  cubeTexture: CubeTexture | null;   // null before first capture / after dispose

  capture(gl: WebGL2RenderingContext, renderer: Renderer, scene: Scene): void
  getTexture(): WebGLTexture | null   // GL cube handle (null if not captured)
  contains(point: Vector3): boolean   // AABB test (position ± boxSize)
  dispose(gl: WebGL2RenderingContext): void
}

class ReflectionProbeManager {
  probes: ReflectionProbe[]; maxProbes: number;   // default 8
  addProbe(probe: ReflectionProbe): boolean        // throws if > maxProbes
  removeProbe(probe: ReflectionProbe): boolean
  update(gl, renderer, scene): void                // capture all probes sequentially
  getProbeAt(point: Vector3): ReflectionProbe | null   // priority + nearest
  getInfluence(point: Vector3): number             // 0..1 weight for blending
  dispose(gl): void
}
```

#### Architecture (PMREM path)

```
┌────────────────┐    ┌──────────────────────────────────────────────┐
│ scene + camera │───▶│ ReflectionProbe.capture(prefilter=true)      │
└────────────────┘    │                                              │
                      │  ┌─── per face f ∈ {±X,±Y,±Z} ────────────┐  │
                      │  │ 1. resize canvas → res×res              │  │
                      │  │ 2. faceCamera.lookAt(pos, pos+dir, up)  │  │
                      │  │ 3. renderer.render(scene, faceCamera)   │  │
                      │  │ 4. gl.readPixels → _pixelBuffer (RGBA8) │  │
                      │  │ 5. RGBA8 → Float32 RGB (_faceRGB)       │  │
                      │  └─────────────────────────────────────────┘  │
                      │  6. build EnvironmentCubeData (6 faces)       │
                      │  7. PMREMGenerator.prefilter(cube) → PMREMData│
                      │     (Karis 2013 split-sum GGX, Hammersley     │
                      │      importance sampling, per-mip α)          │
                      │  8. (re)allocate GL cube texture as RGBA16F   │
                      │  9. per face f, per mip m:                    │
                      │       RGB → RGBA (α=1) → texImage2D(          │
                      │         faceTarget, m, RGBA16F, w, h, 0,      │
                      │         RGBA, FLOAT, rgbaFloat32)             │
                      │ 10. NO generateMipmap (mip chain is PMREM)    │
                      └──────────────────────┬───────────────────────┘
                                             ▼
                              ┌──────────────────────────────┐
                              │ cubeTexture.glTexture        │
                              │ RGBA16F cube, mip-chain =     │
                              │ GGX pre-filtered radiance     │
                              └──────────────────────────────┘
                                             │
                                             ▼
                  PBR shader: textureLod(u_envMap, R, roughness * mipCount)
```

#### Texture unit / format bindings

| Binding | PMREM path | LDR path |
|---------|-----------|----------|
| GL texture target | `TEXTURE_CUBE_MAP` | `TEXTURE_CUBE_MAP` |
| Internal format | `RGBA16F` (HDR) | `RGBA8` (LDR) |
| Upload type | `FLOAT` (Float32Array) | `UNSIGNED_BYTE` (Uint8Array) |
| `MIN_FILTER` | `LINEAR_MIPMAP_LINEAR` | `LINEAR_MIPMAP_LINEAR` |
| `MAG_FILTER` | `LINEAR` | `LINEAR` |
| `WRAP_S/T/R` | `CLAMP_TO_EDGE` | `CLAMP_TO_EDGE` |
| mip chain source | explicit `texImage2D` per mip (PMREM data) | `generateMipmap` (box-filter) |

#### Resource lifecycle

| Resource | Count | Allocated when | Reused across captures |
|----------|-------|----------------|------------------------|
| GL cube texture | 1 | first `capture()` (or after prefilter toggle) | ✅ until `dispose()` or format switch |
| `_pixelBuffer` (RGBA8) | 1 | first `capture()` | ✅ (resized on resolution change) |
| `_faceRGB` (Float32 RGB) | 1 | first PMREM `capture()` | ✅ |
| `_uploadRGBA` (Float32 RGBA) | 1 | first PMREM `capture()` | ✅ (grown if smaller mip needs it) |
| `PMREMGenerator` instance | 1 | first PMREM `capture()` | ✅ (lazy, cached on probe) |

Switching `prefilter` at runtime triggers a texture rebuild on the next
`capture()` (old texture deleted, new one allocated in the other format)
— the `_isHDR` flag tracks the current GL format and detects the
mismatch.

#### Usage

**Production PBR with PMREM pre-filtering (recommended):**

```ts
import { ReflectionProbe, ReflectionProbeManager } from '@vreen/engine';

const manager = new ReflectionProbeManager({ maxProbes: 4 });

// Indoor room probe — capture once on scene load
const roomProbe = new ReflectionProbe({
  position: new Vector3(0, 1.5, 0),
  boxSize: new Vector3(8, 3, 8),
  resolution: 128,
  prefilter: true,       // ← GGX pre-filtered RGBA16F mip chain
  pmremSamples: 32,      // smooth quality, ~fast
});
manager.addProbe(roomProbe);
roomProbe.capture(gl, renderer, scene);   // one-shot bake

// Outdoor courtyard probe
const yardProbe = new ReflectionProbe({
  position: new Vector3(30, 2, 15),
  boxSize: new Vector3(25, 10, 25),
  resolution: 256,
  prefilter: true,
});
manager.addProbe(yardProbe);
yardProbe.capture(gl, renderer, scene);

// Per-frame: pick the active probe for the camera position
const active = manager.getProbeAt(camera.position);
if (active) {
  material.uniforms.u_envMap.value = active.getTexture();
  material.uniforms.u_envMipCount.value = Math.floor(Math.log2(active.resolution)) - 1;
}

// Re-capture when scene geometry changes (e.g. after a door opens)
function onSceneChanged() {
  roomProbe.setDirty?.() ?? roomProbe.capture(gl, renderer, scene);
}
```

**Quick preview without PMREM (fast, lower quality):**

```ts
const previewProbe = new ReflectionProbe({
  position: new Vector3(0, 2, 0),
  resolution: 64,
  prefilter: false,   // RGBA8 + generateMipmap (box-filter)
});
previewProbe.capture(gl, renderer, scene);
```

**Time-sliced refresh (avoid frame hitches on multi-probe scenes):**

```ts
// Refresh one probe per frame instead of all at once
let probeIdx = 0;
function refreshProbes() {
  if (manager.probes.length === 0) return;
  manager.probes[probeIdx].capture(gl, renderer, scene);
  probeIdx = (probeIdx + 1) % manager.probes.length;
}
```

#### Comparison with soup3D

`soup3D` (as of v0.x) ships **no reflection probe system** of any kind —
no `CubeCamera`, no `ReflectionProbe`, no `PMREMGenerator`. The only
environment lighting path is a single global `scene.environment` (if
present), with no local probes, no box-volume influence, no priority
blending, and no GGX pre-filtering of captured cubes.

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Local reflection probes | **None** | `ReflectionProbe` (AABB influence + priority) |
| Probe manager / blending | **None** | `ReflectionProbeManager` (getProbeAt + getInfluence) |
| Cube-map capture (6-face) | **None** | `capture()` (render + readPixels + texImage2D) |
| **PMREM pre-filtering** | **None** | `prefilter: true` → Karis 2013 split-sum GGX |
| GGX importance-sampled mip chain | **None** | `RGBA16F` cube, per-mip α |
| Roughness-correct IBL | **None** | `textureLod(envMap, R, roughness × mipCount)` |
| HDR capture target | **None** | `RGBA16F` (FLOAT upload) |
| Probe priority + nearest fallback | **None** | priority sort + normalized-distance tiebreak |
| Influence weight blending | **None** | `getInfluence()` 0..1 (AABB + linear falloff) |
| Runtime prefilter toggle | **None** | texture rebuild on format switch |

**Where VREEN pulls ahead.** Local reflection probes are the feature
that separates an "IBL-capable" engine from a "production PBR" engine.
A single global environment map cannot represent a scene where a
metallic object moves from an indoor room (warm bounce light) through a
doorway into an outdoor courtyard (cool sky light) — the reflection
snaps abruptly at the threshold. VREEN's `ReflectionProbe` +
`ReflectionProbeManager` let artists place volume probes throughout the
scene and blend between them by influence weight, matching the UE5 /
o3de Atom workflow. The PMREM pre-filter path ensures each probe's
captured cube produces physically-correct roughness-modulated
reflections (rough surfaces get blurrier reflections, matching the
GGX BRDF lobe), which is the whole point of PBR IBL — soup3D has no
path to this.

The integration of `ReflectionProbe` with the existing `PMREMGenerator`
(Karis 2013 split-sum) means VREEN now has **end-to-end local IBL**:
capture → pre-filter → sample, the same pipeline three.js exposes via
`PMREMGenerator.fromScene()` + `CubeCamera` and o3de Atom exposes via
`ImageBasedLightProcessor` + `ReflectionProbe`.

#### Design Notes

**Why RGBA16F + FLOAT upload (not HALF_FLOAT)?** WebGL2 allows uploading
`RGBA16F` textures with `type = FLOAT` and a `Float32Array` source — the
GPU stores half-float, but the upload path accepts full float and
down-converts. This avoids needing a CPU-side float→half encoder
(~50 lines of bit-manipulation). The PMREM `prefilter()` output is
already `Float32Array`, so this is zero-copy apart from the RGB→RGBA
interleave. (`HALF_FLOAT` + `Uint16Array` would be slightly less upload
bandwidth, but the encode cost dominates at typical probe resolutions.)

**Why no `generateMipmap` in the PMREM path?** `gl.generateMipmap`
generates a box-filtered mip chain (each level is a 2×2 average of the
level above). The PMREM mip chain is *not* a box filter — each level is
a GGX importance-sampled convolution with a specific roughness α.
Calling `generateMipmap` would overwrite the PMREM mips with box-filter
mips, destroying the physical correctness. The PMREM path uploads every
mip level explicitly via `texImage2D(target, level, …)`.

**Why LDR (RGBA8) capture readback?** The probe captures via
`gl.readPixels` from the default canvas framebuffer, which is RGBA8
(`UNSIGNED_BYTE`). True HDR capture would require rendering to a
float-renderable FBO (`EXT_color_buffer_float` + `RGBA16F` render
target), which is a larger renderer API change. The LDR-capture →
PMREM-prefilter combination is still a massive quality improvement
over the LDR path: the GGX convolution produces correct roughness
blur even from LDR input (the blur shape is what matters, not the
dynamic range). Bright-source HDR capture is a future enhancement.

**Why `_isHDR` flag + format-switch rebuild?** Toggling `prefilter`
changes the GL internal format (`RGBA8` ↔ `RGBA16F`), which cannot be
done in-place on the same texture object (WebGL forbids re-uploading a
texture with a different internal format). The `_isHDR` field tracks
the current GL format; when `capture()` detects a mismatch
(`_isHDR !== prefilter`), it deletes the old texture and allocates a
new one in the target format. This makes the option safely runtime-
toggleable.

**Why sequential `update()` (no frame-slicing)?** The v1
`ReflectionProbeManager.update()` captures all probes in one call —
simple but can cause frame hitches with many probes. The recommended
production pattern is to *not* call `update()` every frame; instead
call `probe.capture()` directly on a time-sliced schedule (one probe
per frame, or only when scene geometry changes). The manager's `update`
is a convenience for quick integration.

**Why `pmremSamples` per-probe (not global)?** Different probes may
need different quality — a hero probe in a reflective showroom can use
`pmremSamples: 64` for clean specular, while a background probe in a
dark corner can use `pmremSamples: 8` for speed. Per-probe configuration
matches o3de Atom's per-probe quality settings.

#### Test coverage (`ReflectionProbe.test.ts`, 27 tests)

- **Construction (4)**: defaults (incl. `prefilter=false`,
  `pmremSamples=32`); all options accepted; position/resolution/boxSize.
- **`contains()` (4)**: inside / boundary / outside / position offset.
- **`getTexture()` (1)**: null before capture.
- **LDR `capture()` (4)**: no-throw + 1 texture allocated; 6 renders +
  6 readPixels; `generateMipmap` called once; canvas size restored;
  second capture reuses texture.
- **PMREM `capture()` (8)**: no-throw + 1 texture; 6 renders + 6
  readPixels; **no `generateMipmap`**; level-0 uploaded as
  `RGBA16F`+`FLOAT`; full mip chain uploaded (6 faces × 3 mips = 18
  PMREM uploads + 6 pre-alloc = 24 HDR `texImage2D` calls for res=16);
  mip sizes halve 16→8→4; `pmremSamples` honored; second capture
  reuses HDR texture (no realloc); second capture skips pre-alloc
  (only 18 PMREM mip uploads).
- **Prefilter toggle (2)**: off→on deletes RGBA8 + creates RGBA16F;
  on→off deletes HDR + creates LDR.
- **`dispose()` (3)**: frees GL texture; idempotent; PMREM state
  cleared.

#### References

- Karis 2013, "Real Shading in Unreal Engine 4" — split-sum IBL
  approximation (the GGX importance-sampling convolution PMREM uses)
- three.js `CubeCamera` + `PMREMGenerator.fromScene()` — capture +
  pre-filter pipeline this integrates
- o3de Atom `ReflectionProbe` + `ImageBasedLightProcessor` — volume
  probe + IBL processor design
- Epic Games, "Reflection Environment" — UE5 probe volume workflow
- McGuire & Mara, "Efficient GPU Screen-Space Ray Tracing" (2014) —
  complementary SSR for screen-space reflections (VREEN `SSRPass`)

---

### `DDGIVolume` (`DDGIVolume.ts`)

Dynamic Diffuse Global Illumination — a 3D grid of irradiance probes
that update in real-time, providing **dynamic diffuse interreflection**
(re-lighting without re-baking). Each probe stores SH2 (9 coefficients
× RGB = 27 floats) directional irradiance + an average hit distance
for occlusion testing.

**Surpasses soup3D** (which has no GI of any kind — no DDGI, no light
probes, no SSGI, no VXGI).

**Class**: `DDGIVolume` (independent; not a `RenderPass`)
**Adapted from**: UE5 Lumen `IrradianceField` + Zinke et al. 2020 +
o3de Atom `DiffuseGlobalIllumination`

#### GI vs DDGI

| Feature | `GlobalIllumination` (LightProbes) | `DDGIVolume` |
|---------|-------------------------------------|--------------|
| Probe placement | Arbitrary (artist-placed) | Regular 3D grid |
| Update | Static (bake once) | Dynamic (every N frames) |
| Real-time relighting | No | Yes |
| Storage | SH2 (27 floats/probe) | SH2 (27 floats/probe) + depth |
| Occlusion handling | No | Back-projection depth test |
| Best for | Static scenes | Dynamic scenes (moving lights/objects) |

#### Algorithm

```
┌──────────────────────┐
│ DDGIVolume           │
│  origin ────────▶    │  3D grid of probes
│  probeCount (X×Y×Z)  │  each stores:
│  cellSize             │    • SH2 coefficients (27 floats RGB)
│                       │    • average hit distance (occlusion)
└──────────┬───────────┘
           │
   ┌───────▼───────────────────────────────┐
   │ updateProbe(idx, rayResults)          │  per-frame (or N frames)
   │   1. trace R rays from probe position │
   │   2. accumulate ray directions+colors │
   │      → SH2 via computeSH(dir, color)  │
   │   3. EMA blend: sh = hw*old + (1-hw)*new│
   │   4. store avg hit distance           │
   └───────┬───────────────────────────────┘
           │
   ┌───────▼───────────────────────────────┐
   │ sampleIrradiance(worldPos, normal)    │  per-pixel at runtime
   │   1. find cell (8 corner probes)      │
   │   2. compute trilinear weights        │
   │   3. occlusion test (back-projection) │
   │   4. blend 8 probe SH2 → 1 SH2        │
   │   5. evaluateSH(blendedSH, normal)    │
   │      → RGB irradiance                 │
   └───────────────────────────────────────┘
```

#### Options (`DDGIVolumeOptions`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `origin` | `Vector3` | `(0,0,0)` | Volume AABB min corner (world space) |
| `probeCount` | `IVec3` | `{4,4,4}` | Probes per axis (total = X×Y×Z) |
| `cellSize` | `Vector3` | `(4,4,4)` | Distance between probes (world units) |
| `raysPerProbe` | `number` | `32` | Rays traced per probe update (more = higher quality) |
| `historyWeight` | `number` | `0.9` | Temporal EMA weight (0 = no accumulation, 0.95 = strong) |
| `occlusionBias` | `number` | `0.2` | Depth bias for occlusion test (avoids self-occlusion) |

#### API

```ts
class DDGIVolume {
  constructor(opts?: DDGIVolumeOptions): DDGIVolume;
  readonly probes: Float32Array;        // totalProbes × 27 (SH2 RGB)
  readonly probeDepths: Float32Array;   // totalProbes (avg hit distance)
  readonly probeValidity: Uint8Array;   // totalProbes (0=uninitialized)
  readonly totalProbes: number;

  getProbePosition(linearIdx: number): Vector3;
  updateProbe(probeIdx: number, rayResults: Array<{
    dir: Vector3;
    color: { r: number; g: number; b: number };
    distance: number;
  }>): void;
  sampleIrradiance(worldPos: Vector3, normal: Vector3): { r, g, b };
  reset(): void;
  get validProbeCount(): number;
  get maxCorner(): Vector3;
}
```

#### CPU-testable helpers (exported)

| Export | Signature | Description |
|--------|-----------|-------------|
| `packProbeIndex` | `(idx: IVec3, dims: IVec3) => number` | 3D → 1D probe index (row-major: x inner, z outer) |
| `unpackProbeIndex` | `(linear: number, dims: IVec3) => IVec3` | 1D → 3D probe index |
| `computeTrilinearWeights` | `(localPos: IVec3) => number[]` | 8 corner weights (sum = 1), position clamped to [0,1]³ |
| `blendProbeSH` | `(probeSH: Float32Array[], weights: number[]) => Float32Array` | Weighted blend of 8 probe SH2 → 1 SH2 (27 floats) |
| `probeOcclusionWeight` | `(probeDistance, probeDepth, bias?) => number` | Occlusion weight [0,1] via back-projection depth test |

#### Usage

**Basic dynamic GI:**

```ts
import { DDGIVolume } from './Renderer/DDGIVolume';

const ddgi = new DDGIVolume({
  origin: new Vector3(-20, 0, -20),
  probeCount: { x: 8, y: 4, z: 8 },   // 256 probes
  cellSize: new Vector3(5, 3, 5),
  raysPerProbe: 32,
  historyWeight: 0.9,
});

// Per-frame update (simplified: external ray tracer feeds results)
for (let i = 0; i < ddgi.totalProbes; i++) {
  const probePos = ddgi.getProbePosition(i);
  const rayResults = traceRaysFromProbe(probePos, scene, ddgi.raysPerProbe);
  ddgi.updateProbe(i, rayResults);
}

// Per-pixel sampling (in GBuffer / deferred shader)
const irradiance = ddgi.sampleIrradiance(worldPos, normal);
// finalColor += albedo * irradiance;  // add indirect diffuse
```

**Time-sliced update (avoid frame hitches):**

```ts
// Update a subset of probes per frame (e.g. 1/4 of total)
const probesPerFrame = Math.ceil(ddgi.totalProbes / 4);
let offset = 0;
function updateDDGI() {
  for (let i = 0; i < probesPerFrame; i++) {
    const idx = (offset + i) % ddgi.totalProbes;
    ddgi.updateProbe(idx, traceRaysFromProbe(ddgi.getProbePosition(idx), scene, 32));
  }
  offset = (offset + probesPerFrame) % ddgi.totalProbes;
}
```

#### soup3D Feature Parity

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Dynamic diffuse GI | **None** | `DDGIVolume` (real-time probe grid) |
| 3D irradiance probe grid | **None** | configurable X×Y×Z |
| SH2 directional irradiance | **None** | 9 coefficients × RGB per probe |
| Temporal accumulation (EMA) | **None** | `historyWeight` exponential moving average |
| Probe occlusion (back-projection) | **None** | `probeOcclusionWeight` depth test |
| Trilinear probe interpolation | **None** | 8-probe weighted blend |
| CPU-testable interpolation math | **None** | 5 exported pure functions |
| Static light probes (baked) | **None** | `GlobalIllumination` (SH2, separate) |
| Screen-space GI | **None** | `SSGIPass` (separate) |

#### Design Notes

- **Why SH2 (not RGB)?** Each probe stores 9 SH2 coefficients × 3 RGB
  channels = 27 floats. This captures directional variation (light
  comes from above, not below) — a single RGB would be omnidirectional
  and produce flat, directionless GI. SH2 is the minimum for
  directional diffuse lighting (Ramamoorthi & Hanrahan 2001).

- **Why temporal EMA?** Tracing 32 rays per probe per frame produces
  noisy irradiance. The exponential moving average (`historyWeight`)
  blends new samples with history, converging to a stable result over
  ~20 frames. Higher `historyWeight` = smoother but slower to respond
  to lighting changes.

- **Why occlusion testing?** Without it, a probe inside a wall would
  "leak" light through the wall to the other side. The back-projection
  test compares the distance from the sample point to the probe with
  the probe's average hit distance — if the sample is farther than
  what the probe can "see", the probe is occluded and its weight is
  reduced to 0.

- **Integration with existing GI:** VREEN now has three complementary
  GI systems:
  1. `GlobalIllumination` (static SH2 light probes) — baked, fast
  2. `DDGIVolume` (dynamic probe grid) — real-time, medium cost
  3. `SSGIPass` (screen-space GI) — per-frame, limited to screen

  Artists can choose per-scene: static scenes use LightProbes, dynamic
  scenes use DDGIVolume, and SSGI adds contact indirect light on top.

#### Test coverage (`DDGIVolume.test.ts`, 33 tests)

- **Index packing (4)**: 3D→1D, 1D→3D, round-trip both directions
- **Trilinear weights (6)**: sum=1, corner cases (0,0,0)/(1,1,1),
  center=1/8, clamping, non-negativity
- **SH blending (3)**: weighted average, zero-weight skip, all-zero
- **Occlusion weight (5)**: no-depth=1, in-range=1, occluded<1,
  far=0, monotonic
- **Construction (3)**: defaults, options, maxCorner
- **getProbePosition (1)**: correct world positions
- **updateProbe (4)**: first-write, EMA blend, out-of-range ignore,
  multi-ray average
- **sampleIrradiance (4)**: uninitialized=black, post-update≠0,
  identical-probe consistency, outside-volume behavior
- **reset/validProbeCount (2)**: clear + count tracking

#### References

- Zinke et al. 2020, "Dynamic Diffuse Global Illumination with Ray-Traced Irradiance Fields"
- UE5 Lumen "IrradianceField" — real-time probe-based GI
- o3de Atom `DiffuseGlobalIllumination` — probe volume design
- Ramamoorthi & Hanrahan 2001, "Irradiance Volume" — SH2 irradiance representation
- three.js `IrradianceVolume` — WebGL implementation reference

---

### `DDGIDebugVisualizer` (`DDGIDebugVisualizer.ts`)

> Path: `src/engine/Renderer/DDGIDebugVisualizer.ts`
>
> Debug visualization for the `DDGIVolume` probe grid. Paints probe
> positions, validity, SH2 irradiance, and occlusion depth into the
> engine `DebugRenderer` so artists and engineers can inspect probe
> layout and GI quality at a glance — the same role o3de Atom's
> `DiffuseGlobalIllumination` DebugDraw and UE5 Lumen's
> `Lumen.Visualize ProbeView` play in their respective toolchains.

**Class**: `DDGIDebugVisualizer` (independent; consumes `DDGIVolume` + `DebugRenderer`)
**Adapted from**: o3de Atom `DiffuseGlobalIllumination` DebugDraw · UE5 Lumen `Lumen.Visualize`

#### Why a dedicated visualizer?

A 3D probe grid is opaque by default — you cannot tell from the API
whether probes are placed correctly, whether they have been updated, or
whether the SH2 irradiance they hold is plausible. A misconfigured
`DDGIVolume` (wrong `origin`, too-small `cellSize`, probes inside
geometry) silently produces wrong or zero indirect light. The
visualizer turns that invisible state into a colored point/sphere field
that exposes these faults immediately. This is standard equipment in
production engines; **soup3D has no GI of any kind, so no GI debugging
either**.

#### Visualization modes (combinable)

| Mode | Option | What it draws | Cost |
|------|--------|---------------|------|
| Bounds | `showBounds` (default `true`) | 12-edge wireframe of the volume AABB (`origin` → `maxCorner`) | 12 lines |
| Probes | `showProbes` (default `true`) | One point per probe. Color = SH2 irradiance sampled at `irradianceNormal` (Reinhard-tonemapped); invalid probes are red | N points |
| Irradiance | `showIrradiance` (default `false`) | A small wireframe sphere per valid probe, dyed the same color as the probe point — produces a "colored ball field" showing the spatial distribution of indirect light | N_valid × 24 lines (8-segment × 3 rings) |
| Depth rays | `showDepthRays` (default `false`) | A ray from each valid probe along `irradianceNormal`, length = `probeDepths[i]` (the probe's mean hit distance) — verifies the occlusion data that drives `probeOcclusionWeight` | N_valid_with_depth lines |
| Grid | `showGrid` (default `false`) | Line segments connecting each probe to its +X / +Y / +Z neighbors — renders the 3D lattice | ~3·N lines |

#### Pure helper functions (headless-testable)

The color math is factored into pure functions so it can be unit-tested
in Node without any WebGL context:

| Function | Signature | Role |
|----------|-----------|------|
| `heatColor` | `(t: number) → DebugColor` | 5-stop heat ramp (deep blue → cyan → green → yellow → red). Clamps `t` to `[0,1]`. |
| `tonemapColor` | `(rgb, exposure?) → DebugColor` | Reinhard tonemap `x/(1+x)` after exposure scaling; clamps to `[0,1]`. Maps HDR irradiance to display color. |
| `probeIrradianceColor` | `(volume, probeIdx, normal, exposure?) → DebugColor` | Evaluates a probe's SH2 at `normal`, tonemaps, returns `[0,1]` RGB. Invalid probe → red `[1, 0.15, 0.15]`; out-of-range index → black. |
| `probeValidityColor` | `(valid: boolean) → DebugColor` | Green `[0.2, 1, 0.5]` for valid, red for invalid. |

#### Options (`DDGIDebugOptions`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `showBounds` | `boolean` | `true` | Draw the volume AABB wireframe. |
| `showProbes` | `boolean` | `true` | Draw one point per probe. |
| `showIrradiance` | `boolean` | `false` | Draw a wireframe irradiance sphere per valid probe. |
| `showDepthRays` | `boolean` | `false` | Draw occlusion-depth rays. |
| `showGrid` | `boolean` | `false` | Draw the probe lattice grid lines. |
| `probeSize` | `number` | `6` | Probe point size in pixels. |
| `irradianceRadius` | `number \| null` | `null` | Sphere radius (world units). `null` = auto (`min(cellSize) × 0.18`). |
| `irradianceNormal` | `Vector3` | `(0,1,0)` | Direction used to sample SH2 for coloring / depth rays. Cloned on assignment. |
| `exposure` | `number` | `1` | Exposure multiplier applied before Reinhard tonemap. |
| `boundsColor` | `DebugColor` | cyan | AABB wireframe color. |
| `gridColor` | `DebugColor` | dark cyan | Grid line color. |
| `depthRayColor` | `DebugColor` | yellow | Depth ray color. |
| `duration` | `number` | `0` | DebugRenderer lifetime (seconds). `0` = single frame (re-invoke each frame); `Infinity` = permanent. |

#### API

```ts
class DDGIDebugVisualizer {
  constructor(opts?: DDGIDebugOptions): DDGIDebugVisualizer;

  /** Bulk-update options. */
  setOptions(opts: Partial<DDGIDebugOptions>): void;

  /** Draw the volume's debug state into a DebugRenderer. Read-only on the volume. */
  visualize(volume: DDGIVolume, debug: DebugRenderer): void;
}
```

#### Usage

```ts
import { DDGIVolume, DDGIDebugVisualizer } from '@vreen/engine';
import { DebugRenderer } from '@vreen/engine/Helpers';

const ddgi = new DDGIVolume({
  origin: new Vector3(-20, 0, -20),
  probeCount: { x: 8, y: 4, z: 8 },
  cellSize: new Vector3(5, 3, 5),
});
// ... update probes each frame ...

const debug = new DebugRenderer();
const viz = new DDGIDebugVisualizer({
  showIrradiance: true,   // colored ball field
  showGrid: true,         // probe lattice
  exposure: 1.5,          // brighten for display
});

// Each frame:
viz.visualize(ddgi, debug);
// upload debug.getMeshData() to GPU line/point buffers, then:
debug.update(dt);
```

#### Invariants

- **Read-only on the volume** — `visualize()` never mutates `DDGIVolume`
  state (probes / depths / validity unchanged). Verified by tests.
- **No WebGL dependency** — all draws go through `DebugRenderer`'s data
  API, so the visualizer runs in Node/headless tests and is
  backend-agnostic (custom WebGL2 or Three.js).
- **Respects `DebugRenderer.enabled`** — when the debug renderer is
  disabled, `visualize()` is a no-op (no allocations, no draws).
- **Invalid probes are always visible** — drawn as red points so a
  never-updated region is obvious, not hidden.
- **`duration` propagates** — every drawn primitive receives the
  configured lifetime, so a single `visualize()` call with
  `duration: Infinity` draws a persistent overlay.

#### Test coverage (`DDGIDebugVisualizer.test.ts`, 35 tests)

- **heatColor (5)**: endpoints, clamping, `[0,1]` range, green midpoint.
- **tonemapColor (5)**: zero, Reinhard `x/(1+x)`, bright clamp, exposure
  scaling, negative exposure.
- **probeIrradianceColor (5)**: invalid → red, valid → `[0,1]`,
  out-of-range → black, valid ≠ invalid.
- **probeValidityColor (2)**: true/false colors.
- **construction (3)**: defaults, full options, `irradianceNormal` clone.
- **setOptions (2)**: partial update, normal clone.
- **visualize (15)**: bounds on/off, one-point-per-probe, invalid probes
  drawn red, irradiance spheres, depth rays, grid lines, combined modes,
  no volume mutation, `enabled=false` no-op, duration propagation,
  auto vs explicit sphere radius.

#### References

- o3de Atom `DiffuseGlobalIllumination` DebugDraw — probe volume debug overlay
- UE5 Lumen `Lumen.Visualize ProbeView` — irradiance probe visualization
- Zinke et al. 2020, "Dynamic Diffuse GI with Ray-Traced Irradiance Fields" — the DDGI algorithm this visualizes

---

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
| `SSRPass` | Screen-space reflections — ray-marches GBuffer position/normal buffers with temporal jitter, adaptive step, roughness-modulated composite, and separable Gaussian rough-reflection blur (H+V 9-tap, edge-aware). Surpasses soup3D (no SSR). |
| `SSGIPass` | Screen-space global illumination — 8-ray cosine-weighted hemisphere sampling with golden-angle temporal rotation, producing diffuse color bleeding / bounce light. Outputs RGBA16F indirect irradiance for additive composite. Surpasses soup3D (no GI). |
| `ScreenSpaceShadowPass` | Screen-space directional contact shadows — ray-marches depth buffer along light direction to find small-scale occlusion that shadow maps miss. Complements PCSS (pixel-precision vs shadow-map-precision). Surpasses soup3D (no shadows at all). |
| `TonemappingPass` | HDR→LDR tonemapping with 5 operators: ACES Filmic (Narkowicz, UE5/o3de default), Reinhard, AGX (Blender simplified), Uncharted 2 (Hable), Linear passthrough. Exposure control. Must be applied after all HDR effects (Bloom/SSR/SSGI) and before final display. Surpasses soup3D (no HDR pipeline). |
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

### Lighting Channels (`LightingChannelMask.ts`)

**Lighting channels** (adapted from o3de Atom `LightingChannelConfiguration`)
let you assign each light and each renderable to one or more of **32
bitmask channels**. At render time a light only contributes to a
fragment if `(lightMask & objectMask) != 0`. The default mask is
`ALL_LIGHTING_CHANNELS` (`0xFFFFFFFF`) so the out-of-the-box behaviour
is "every light lights every object" — fully backward-compatible.

This is a production-grade feature that o3de (5 channels), Unreal
(32 channels), and Unity (per-light layer masks) all ship. soup3D has
no such concept — every light illuminates every object — so complex
scenes (flashlights, muzzle flash, UI glow, indoor/outdoor separation)
cannot be lit correctly in soup3D.

**Use cases:**

| Scenario | Light channel(s) | Object channel(s) | Effect |
|----------|------------------|--------------------|--------|
| Player flashlight | 1 | player=1, env=0 | flashlight lights player only |
| Muzzle flash | 1, 2 | enemies=1, props=2, sky=0 | lights enemies + nearby props, not sky |
| UI / emissive panel | 3 | UI meshes=3, world=0 | panel glow doesn't pollute characters |
| Indoor light | 4 | interior=4, exterior=0 | no light leak outdoors |
| Trigger zone light | 5 | trigger occupants=5 | only lit inside the trigger |

**API surface:**

```typescript
import {
  LightingChannelConfiguration,
  channelMask, channelsMask, affects,
  ALL_LIGHTING_CHANNELS, NO_LIGHTING_CHANNELS,
} from '@vreen/engine';

// Light side: flashlight only on channel 1
flashlight.lightingChannelMask = channelMask(1);          // = 2

// Object side: player on channel 1, environment on channel 0
playerMesh.lightingChannelMask = channelMask(1);
envMesh.lightingChannelMask    = channelMask(0);

affects(flashlight.lightingChannelMask, playerMesh.lightingChannelMask); // true
affects(flashlight.lightingChannelMask, envMesh.lightingChannelMask);    // false
```

The `LightingChannelConfiguration` class wraps the mask with a fluent,
serializable API (`setChannel` / `enableChannel` / `disableChannel` /
`setSingleChannel` / `reset` / `clear` / `affects` / `toJSON` /
`fromJSON` / `clone`). Pure helper functions (`channelMask`,
`channelsMask`, `getChannel`, `setChannel`, `affects`, `hasAnyChannel`,
`countChannels`, `listChannels`) operate directly on `number` masks for
zero-allocation hot paths.

**Shader integration** — a GLSL chunk (`LIGHTING_CHANNEL_GLSL`) provides
`lightingChannelAffects(uint lightMask, uint objectMask)` for use inside
forward/deferred lighting loops; the renderer passes light masks as a
`u_lightChannels[]` uniform array and the object mask as a draw-call
uniform or instance attribute.

**Design choices:**
- **32 channels (not o3de's 5)** — aligns with Unreal and leaves room
  for future expansion; the bitmask is a single `uint32` either way.
- **Default = all channels on** — preserves existing scenes that don't
  opt into channel filtering.
- **`NO_LIGHTING_CHANNELS` (0)** — lets a mesh be purely emissive
  (unlit by any light), useful for holograms / UI / neon signs.
- **Unsigned `>>> 0`** — all bitwise helpers return unsigned 32-bit
  ints so channel 31 (`0x80000000`) is positive, matching WebGL2
  `uint` uniforms.

### Hierarchical Z-Buffer Occlusion Culling (`HierarchicalZBuffer.ts`)

**Hierarchical Z-Buffer (HZB)** occlusion culling, adapted from o3de
Atom's `MaskedOcclusionCulling` / `OcclusionCullingPlane` and UE5's HZB
occlusion system. Builds a mip pyramid from the depth buffer where each
level stores the **maximum** depth of its 2×2 children. For each object's
AABB, projects it to screen space, selects the appropriate mip level
based on the screen-space bounding rectangle size, and tests if the
object's nearest depth is farther than the HZB depth at that position.

This is a production-grade feature that UE5, o3de, and Unity all ship.
soup3D has no occlusion culling — every in-frustum object is submitted
for drawing regardless of whether it's behind a wall.

**Algorithm (Greene 1993):**

| Stage | Function | Description |
|-------|----------|-------------|
| 1. HZB Build | `buildHZB(depthBuffer, w, h)` | Creates mip pyramid. Each level stores `max(d00, d01, d10, d11)` of its 2×2 children. Coarsest level = 1×1. |
| 2. Projection | `transformPoint(viewProj, corner)` | Transforms 8 AABB corners to clip space → NDC → screen pixels. Finds min depth and screen bounding rect. |
| 3. Mip Selection | `log2(maxScreenDim) + mipBias` | Selects mip level where one texel covers approximately the object's screen rect. Larger objects sample finer mips; smaller objects sample coarser mips. |
| 4. Depth Test | `objectMinDepth - bias > hzbDepth` | If the object's nearest depth (minus conservative bias) is greater than the HZB depth at the sampled position, the object is occluded. |

**Conservative guarantees:**
- `w <= 0` corners (behind camera) → not occluded (safe fallback).
- Screen rect smaller than `minScreenSize` → not occluded (avoids
  false positives for distant tiny objects).
- `conservativeBias` subtracts from object depth, making it "closer"
  and harder to cull — reduces false positives at the cost of some
  missed culling opportunities.
- HZB stores **max** depth (not average) → if an object is behind the
  farthest surface at that position, it's definitely occluded.

**Use cases:**

| Scenario | Benefit |
|----------|---------|
| Indoor scene | Walls cull all objects behind them |
| Open world | Mountains/buildings cull objects behind them |
| GPU-driven rendering | Batch cull thousands of objects before draw call submission |
| Forest/vegetation | Tree trunks cull objects behind them |

```ts
import { buildHZB, occlusionCull, makeOccluderDepth } from '@vreen/engine/renderer';

// Build HZB from previous frame's depth buffer
const depth = makeOccluderDepth(1920, 1080, 0.1, 0.9, 400, 200, 800, 600);
const hzb = buildHZB(depth, 1920, 1080);

// Cull objects
const result = occlusionCull(hzb, objects, viewProjMatrix, 1920, 1080, {
  conservativeBias: 0.1,
  minScreenSize: 2,
});
// result.visible → objects to render
// result.occluded → objects skipped
// result.stats.cullRatio → fraction culled
```

**Design choices:**
- **Pure CPU Float32Array** — no WebGL dependency, testable in
  Node/headless environments (same pattern as PCSSSampler,
  MotionBlurPass, LensFlare).
- **Max-depth mip reduction** — conservative (never falsely culls a
  visible object); matches UE5/o3de convention.
- **Single-texel sample** — samples HZB at the object's screen-space
  center. Future extension: multi-tap sampling for tighter culling.
- **GLSL chunk** (`HZB_GLSL`) — provides `hzbReduceMax2x2` and
  `hzbIsOccluded` for future GPU-side integration.

### Area Light LTC (`AreaLightLTC.ts`)

**Linearly Transformed Cosines (LTC)** area light evaluation, adapted from
Heitz, Dupuy, Hill, Neubelt 2016 *"Real-Time Polygonal-Light Shading with
Linearly Transformed Cosines"*, three.js `nodes/functions/BSDF/LTC.js`,
and o3de Atom `LtcCommon.cpp`. Evaluates rectangular area light irradiance
using a 3×3 LTC matrix transform that maps GGX BRDF shape into a canonical
cosine lobe, where polygon irradiance has a closed-form spherical-polygon
solution.

This is a production-grade feature shipped by UE5 (`RectLight`), o3de
(`ArenaLight`), and Unity. soup3D only has point/directional lights — no
area lights at all.

**Core idea:**

| Concept | Description |
|---------|-------------|
| LTC matrix `M` | A 3×3 matrix that approximates the GGX BRDF lobe shape as a linearly transformed cosine. |
| Inverse `M⁻¹` | Transforms polygon vertices *from* BRDF space *into* canonical cosine space where the form factor is analytic. |
| LUT | 64×64 texture parameterized by `roughness × dot(N,V)` storing precomputed `M⁻¹`. Two LUTs: specular + diffuse. |
| Spherical form factor | Closed-form irradiance of a horizon-clipped polygon on a unit sphere (4-edge vector form factor sum). |

**Algorithm pipeline (`ltcEvaluate`):**

| Stage | Function | Description |
|-------|----------|-------------|
| 1. Backface cull | `dot(lightNormal, P - p0) <= 0` | Light vertices are CCW; `lightNormal = cross(p1-p0, p3-p0)`. If the shading point is on the back side of the light plane, irradiance = 0. |
| 2. Orthonormal basis | `T1 = normalize(V - N·dot(V,N))`, `T2 = -N×T1` | Constructs tangent frame around `N`. **Degenerate case:** when `V ∥ N` (`|dot(V,N)| > 0.999`), falls back to `(1,0,0)` or `(0,0,1)` — whichever is less parallel to `N`. |
| 3. Matrix transform | `mat = M⁻¹ · transpose(mat3(T1, T2, N))` | Combines the inverse LTC matrix with the basis transpose (column-major). |
| 4. Sphere projection | `coords_i = normalize(mat · (p_i - P))` | Transforms 4 rect vertices into LTC space and projects onto unit sphere. |
| 5. Edge form factors | `ltcEdgeVectorFormFactor(coords_i, coords_{i+1})` | 4 edges summed. Rational polynomial approximates `θ/sin(θ)/2π`. |
| 6. Horizon clip | `ltcClippedSphereFormFactor(f)` | `max((|f|² + f.z) / (|f| + 1), 0)` — clips to [0,1] irradiance. |

**API surface:**

```ts
import {
  ltcEvaluate,           // core: scalar irradiance for one rect light
  evaluateRectAreaLight, // specular + diffuse + total for one surface
  computeAreaLighting,   // batch: multiple surfaces × one light
  ltcUv,                 // LUT sampling coords (roughness, dotNV)
  approximateLTCMatrix,  // analytic M⁻¹ approximation (for tests, no LUT)
  makeRectVertices,      // center + forward + up + w/h → 4 CCW vertices
  LTC_LUT_SIZE,          // 64
  // vector/matrix utils aliased with ltc prefix to avoid clashes with
  // Physics (Mat3 / mat3MulVec / mat3MulMat3) and SurfaceData (SurfacePoint):
  ltcVec3, ltcSub, ltcAdd, ltcScale, ltcDot, ltcCross, ltcLength, ltcNormalize,
  ltcMat3MulVec, ltcMat3MulMat3,
  type LTCVec3, type LTCMat3, type LTCSurfacePoint, type RectLightParams,
} from '@vreen/engine/renderer';
```

**Usage:**

```ts
import {
  evaluateRectAreaLight,
  makeRectVertices,
  approximateLTCMatrix,
  ltcVec3 as vec3,
  type LTCSurfacePoint as SurfacePoint,
  type RectLightParams,
} from '@vreen/engine/renderer';

// Rectangular area light at (0, 5, 0) pointing down, 2×2 units
const [p0, p1, p2, p3] = makeRectVertices(
  vec3(0, 5, 0),    // center
  vec3(0, -1, 0),   // forward (toward surface)
  vec3(0, 0, 1),    // up
  2, 2,             // width, height
);

const light: RectLightParams = {
  p0, p1, p2, p3,
  color: [1, 1, 1],  // linear RGB
  intensity: 5.0,     // nits
};

// Shading point at origin, normal up, view up
const surface: SurfacePoint = {
  P: vec3(0, 0, 0),
  N: vec3(0, 1, 0),
  V: vec3(0, 1, 0),
  roughness: 0.5,
};

// In production: sample M⁻¹ from the 64×64 LTC LUT texture.
// For tests: use the analytic approximation (no LUT needed).
const mInvSpec = approximateLTCMatrix(surface.roughness, 1.0);

const result = evaluateRectAreaLight(surface, light, mInvSpec);
// result.specular → [r, g, b]
// result.diffuse  → [r, g, b]
// result.total    → [r, g, b]  (specular + diffuse)
```

**Design choices:**
- **Pure CPU functions** — no WebGL dependency, fully testable in
  Node/headless environments (same pattern as `PCSSSampler`,
  `MotionBlurPass`, `HierarchicalZBuffer`). The GPU path will consume the
  same math via GLSL `LTC_Uv` / `LTC_Evaluate` chunks (ported from
  three.js TSL).
- **`M⁻¹` as parameter** — the inverse LTC matrix is passed in by the
  caller, decoupling the evaluation from LUT storage. Production code
  samples the 64×64 LUT; tests use `approximateLTCMatrix()`.
- **CCW winding order** — matches three.js / o3de convention:
  `lightNormal = cross(p1-p0, p3-p0)` points toward the illuminated
  side. `dot(lightNormal, P-p0) > 0` → front-facing (lit).
- **Degenerate basis fallback** — when `V ∥ N` (grazing or head-on),
  `T1 = V - N·dot(V,N)` → 0. The code picks `(1,0,0)` or `(0,0,1)`
  (whichever is less parallel to `N`) and re-orthogonalizes. This
  prevents NaN without discontinuity.
- **Specular + diffuse lobes** — `evaluateRectAreaLight` evaluates both
  lobes (each needs its own `M⁻¹` from a separate LUT). The diffuse LUT
  is nearly identity; passing `undefined` uses the identity matrix.
- **49 unit tests** — covers vector/matrix utils, LTC core functions,
  backface culling, front-facing irradiance > 0, symmetry, batch
  evaluation, boundary roughness/dotNV, and CCW vertex generation.

**References:**
- Heitz et al. 2016, "Real-Time Polygonal-Light Shading with Linearly
  Transformed Cosines" — the LTC algorithm
- three.js `nodes/functions/BSDF/LTC.js` — TSL reference implementation
- o3de Atom `LtcCommon.cpp` — C++ reference
- LTC code: https://github.com/selfshadow/ltc_code/

### Meshlet Renderer (`MeshletRenderer.ts`)

**Meshlet** rendering pipeline — splits large meshes into small clusters
(meshlets) for fine-grained visibility culling and GPU-driven indirect
draw. Adapted from three.js `meshopt_clusterizer.module.js`, o3de Atom
`MeshletsModule`, and UE5 Nanite's meshlet design.

This is a flagship feature of modern engines. soup3D has no meshlet or
GPU-driven rendering — every mesh is submitted as a whole, with no
sub-mesh culling.

**Pipeline:**

| Stage | Function | Description |
|-------|----------|-------------|
| 1. Meshlet build | `buildMeshlets(positions, indices, opts)` | Greedy clustering: adds triangles to current meshlet until `maxVertices` (≤256) or `maxTriangles` (≤512) reached, then starts new meshlet. Vertex remapping (global→local) avoids duplicates. |
| 2. Bounds | `computeMeshletBounds(...)` | Per-meshlet: AABB center + max-distance radius (bounding sphere) + normal cone (apex + axis + cutoff cos). |
| 3. Frustum cull | `meshletInFrustum(bounds, planes)` | Bounding sphere vs 6 frustum planes. |
| 4. Backface cull | `meshletIsFrontFacing(bounds, viewPos)` | Normal cone: if `dot(viewDir, coneAxis) >= coneCutoff`, entire meshlet is back-facing. Uses bounding sphere center for stable view direction. |
| 5. HZB occlusion | `meshletIsVisibleHZB(bounds, hzb, ...)` | Projects bounding sphere to screen, selects HZB mip by projected radius, samples depth. Conservative (bias reduces false positives). |
| 6. Pack | `packMeshletDrawCommands(result, visibleIds)` | Packs visible meshlets into `MeshletDrawCommand[]` with cumulative `vertexOffset` / `firstIndex`. |
| 7. Merge buffers | `buildMeshletVertexIndexBuffers(result, positions)` | Merges all meshlet vertices/indices into contiguous `Float32Array` + `Uint32Array` for GPU upload. |

**API surface:**

```ts
import {
  buildMeshlets,                // positions + indices → meshlet array + bounds
  cullMeshlets,                 // frustum + backface + HZB → visible IDs
  packMeshletDrawCommands,      // visible IDs → indirect draw commands
  buildMeshletVertexIndexBuffers, // merge all meshlets → contiguous buffers
  meshletStats,                 // statistics (avg verts/tris, reuse ratio)
  type MeshletBuildOptions,     // { maxVertices, maxTriangles, computeCone }
  type MeshletCullOptions,      // { frustumCulling, backfaceCulling, ... }
} from '@vreen/engine/renderer';
```

**Usage:**

```ts
import {
  buildMeshlets, cullMeshlets, packMeshletDrawCommands,
  buildMeshletVertexIndexBuffers,
} from '@vreen/engine/renderer';

// 1. Build meshlets from a mesh
const buildResult = buildMeshlets(positions, indices, {
  maxVertices: 64,
  maxTriangles: 124,
  computeCone: true,
});

// 2. Merge into contiguous GPU buffers
const { vertices, indices: mergedIndices } =
  buildMeshletVertexIndexBuffers(buildResult, positions);

// 3. Cull (frustum + backface + optional HZB)
const cullResult = cullMeshlets(buildResult, {
  frustumCulling: true,
  frustumPlanes: camera.frustum.planes,
  backfaceCulling: true,
  viewPosition: camera.position,
  occlusionCulling: false,
});

// 4. Pack visible meshlets into indirect draw commands
const commands = packMeshletDrawCommands(
  buildResult,
  cullResult.visibleMeshletIds,
);
// → upload vertices/indices/commands to GPU, call multiDrawElementsIndirect
```

**Design choices:**
- **Pure CPU** — no WebGL/WASM dependency, testable in Node/headless
  (same pattern as `GPUDrivenRenderer`, `HierarchicalZBuffer`,
  `PCSSSampler`). three.js's meshopt_clusterizer uses WASM; VREEN's
  implementation is pure TypeScript for zero-dependency testing.
- **Greedy meshlet build** — does not do meshoptimizer's cache-aware
  triangle reordering. Callers can pre-optimize indices externally.
- **Bounding sphere** — uses AABB center + max-distance (not minimum
  enclosing sphere). Slightly looser but O(n) and sufficient for culling.
- **Normal cone** — `coneCutoff = min(dot(n_i, axis))` stored as cos.
  Backface test: `dot(viewDir, axis) >= cutoff` → cull. Conservative
  boundary (uses strict `<` so boundary = backface).
- **HZB integration** — optional; pairs with `HierarchicalZBuffer.buildHZB`
  for occlusion culling at meshlet granularity.
- **42 unit tests** — covers meshlet generation, bounds, frustum/backface/
  HZB culling, draw command packing, buffer merging, statistics.

**References:**
- three.js `examples/jsm/libs/meshopt_clusterizer.module.js` — WASM
  meshlet generation via meshoptimizer
- o3de Atom `MeshletsModule` — GPU-driven meshlet pipeline
- UE5 Nanite — meshlet-level visibility culling
- meshoptimizer (Arseny Kapoulkine) — `buildMeshlets` algorithm
- Greene 1993 — hierarchical Z-buffer (used in HZB occlusion stage)

---

### Visibility Buffer (`VisibilityBuffer.ts`)

**Visibility Buffer** (visbuf) — a modern deferred rendering technique
that stores per-pixel **geometry IDs** instead of full GBuffer attributes.
Adapted from o3de Atom `VisibilityBuffer.azsli` + `DeferredMaterial`
and UE5 Nanite's visibility buffer pass.

This is the natural companion to `MeshletRenderer`: meshlet software
rasterization writes the visbuf, and a deferred shading pass reads it
back to fetch attributes and shade. Together they form the UE5 Nanite
GPU-driven rendering loop.

soup3D has no visibility buffer or deferred material system — it uses
forward rendering with a basic GBuffer. VREEN provides an o3de Atom
-compatible visbuf format with CPU reference implementation.

**Why visbuf vs GBuffer?**

| Aspect | GBuffer | Visibility Buffer |
|--------|---------|-------------------|
| Bandwidth per pixel | 128+ bit (albedo + normal + material + ...) | 64 bit (meshInfoIndex + triangleId + bary) |
| Material types | Limited by GBuffer layout | Unlimited (decoupled from geometry pass) |
| Shader complexity | Bounded by GBuffer write | Geometry pass minimal; shading deferred |
| MSAA | Expensive (per-sample GBuffer) | Cheap (per-sample visbuf, per-pixel shade) |
| Meshlet integration | Awkward (per-meshlet material variants) | Natural (visbuf is geometry-only) |

**Packing format** (o3de Atom `VisibilityBuffer.azsli`-compatible):

Two RGBA32F texels per pixel (`first`, `second`):

| Texel | Component | Content |
|-------|-----------|---------|
| `first.x` | uint | `flagsAndMeshInfoIndex`: bit 31 = meshInfo invalid, bit 30 = isFrontFace, bits 29..0 = meshInfoIndex (low 30 bits) |
| `first.y` | uint | `triangleId` (mesh-local triangle index) |
| `first.zw` | vec2 | barycentrics.xy (z = 1 - x - y reconstructed) |
| `second.xy` | vec2 | barycentricsDx.xy (z = -x - y reconstructed) |
| `second.zw` | vec2 | barycentricsDy.xy (z = -x - y reconstructed) |

**Empty pixel marker:** `-0.0f` (bit pattern `0x80000000`). Note that
`+0.0f` (bit pattern `0x00000000`) is a **valid** pixel meaning
`meshInfoIndex=0 + isFrontFace=false`. Callers must initialize the
visbuf with `-0.0f` before rasterization (`buildVisibilityBuffer` does
this automatically).

**Pipeline:**

| Stage | Function | Description |
|-------|----------|-------------|
| 1. Pack geometry | `packVisibilityBuffer(entry)` | Pack `VisibilityBufferEntry` → two RGBA32F texels (bit-level, o3de-compatible). |
| 2. Rasterize | `rasterizeTriangle(tri, visbuf, depth, w, h, opts)` | Software rasterizer: edge-function barycentric + depth test + visbuf write. |
| 3. Build | `buildVisibilityBuffer(triangles, opts)` | Loop over triangles, init visbuf with `-0.0f`, return `VisibilityBufferResult` (visbuf + depth + stats). |
| 4. Fast query | `getMeshInfoIndex(firstX)` | Quick check if pixel has geometry (returns `{ valid, meshInfoIndex }`). |
| 5. Full unpack | `unpackVisibilityBuffer(first, second)` | Reconstruct full `VisibilityBufferEntry` (meshInfoIndex + triangleId + isFrontFace + barycentrics + derivatives). |
| 6. Decompress | `decompressPixel(result, x, y, meshInfoTable)` | High-level: unpack + look up `MeshInfo` from table → `DecompressedPixel`. |
| 7. Fetch attrs | `fetchTriangleVertices(mesh, triId)` + `interpolateAttributes(attrs, bary)` | Look up triangle vertices, interpolate via barycentrics. |
| 8. Position | `fetchInterpolatedPosition(mesh, triId, bary)` | Convenience: fetch + interpolate position attribute. |

**API surface:**

```ts
import {
  // Bit packing
  packVisibilityBuffer,           // entry → { first, second } (Float32Array×2)
  unpackVisibilityBuffer,         // { first, second } → entry | null
  getMeshInfoIndex,               // firstX → { valid, meshInfoIndex } (fast path)
  uintAsFloat, floatAsUint,       // bit reinterpret helpers
  MESHINFO_BITS, MESHINFO_MASK,   // bit constants (o3de-compatible)
  MESHINFO_INVALID_MASK, FRONTFACE_MASK,
  // Geometry
  computeBarycentric2D,           // point + triangle → (u, v, w)
  edgeFunctionBarycentric,        // edge function variant (returns inside + frontFace)
  // Rasterization
  rasterizeTriangle,              // single triangle → visbuf + depth
  buildVisibilityBuffer,          // triangle array → full visbuf result
  pixelOffset,                    // (x, y, width) → byte offset in visbuf
  // Decompression (for deferred shading)
  decompressPixel,                // visbuf + meshInfoTable → DecompressedPixel
  interpolateAttributes,          // barycentric interpolation of vertex attrs
  fetchTriangleVertices,          // mesh + triangleId → 3 vertex positions
  fetchInterpolatedPosition,      // mesh + triangleId + bary → interpolated position
  // GLSL chunks (GPU-side, same packing format)
  VISIBILITY_BUFFER_PACK_UTILITY, // pack/unpack GLSL functions (o3de-compatible)
  VISIBILITY_BUFFER_PACK_VERT,    // vertex shader (writes meshInfoIndex + triangleId)
  VISIBILITY_BUFFER_PACK_FRAG,    // fragment shader (writes packed visbuf via gl_BarycentricEXT)
  VISIBILITY_BUFFER_UNPACK_UTILITY, // alias of PACK_UTILITY (for deferred shading pass)
  // Types
  type VisibilityBufferEntry, type VisibilityBufferPacked,
  type MeshInfo, type VisibilityTriangle,
  type VisibilityBufferOptions, type VisibilityBufferResult,
  type VisibilityBufferStats, type DecompressedPixel,
} from '@vreen/engine/renderer';
```

**Usage (CPU reference rasterization):**

```ts
import {
  buildVisibilityBuffer, decompressPixel, fetchInterpolatedPosition,
  type VisibilityTriangle, type MeshInfo,
} from '@vreen/engine/renderer';

// 1. Build triangle list (already transformed to screen space)
const triangles: VisibilityTriangle[] = [
  {
    meshInfoIndex: 0,
    triangleId: 0,
    screenPositions: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
    depths: [0.5, 0.5, 0.5],
    isFrontFace: true,
  },
  // ... more triangles
];

// 2. Rasterize to visbuf
const result = buildVisibilityBuffer(triangles, {
  width: 1920,
  height: 1080,
  computeDerivatives: true, // for mip-level selection in shading
  depthFunc: 'less',
});

console.log(result.stats);
// → { triangleCount, culledTriangles, depthPassedFragments,
//     depthFailedFragments, emptyPixels, coverage }

// 3. Build mesh info table (for deferred shading)
const meshTable: MeshInfo[] = [];
meshTable[0] = {
  index: 0,
  vertices: mesh0Positions, // Float32Array (stride = 3)
  indices: mesh0Indices,    // Uint32Array
  vertexStride: 3,
  materialIndex: 0,
};

// 4. Decompress pixel for shading
const pixel = decompressPixel(result, x, y, meshTable);
if (!pixel.isEmpty) {
  const pos = fetchInterpolatedPosition(
    pixel.meshInfo!, pixel.triangleId, pixel.barycentrics,
  );
  // → shaded position (Float32Array [x, y, z])
}
```

**Usage (GPU path, GLSL chunks):**

```glsl
// Geometry pass (writes visbuf)
#extension GL_EXT_fragment_shader_barycentric : require
// inject VISIBILITY_BUFFER_PACK_VERT + VISIBILITY_BUFFER_PACK_FRAG
// → writes to MRT: location 0 = first, location 1 = second

// Deferred shading pass (reads visbuf)
uniform sampler2D u_visbufFirst;
uniform sampler2D u_visbufSecond;
// inject VISIBILITY_BUFFER_UNPACK_UTILITY
void main() {
  vec4 first  = texelFetch(u_visbufFirst,  ivec2(gl_FragCoord.xy), 0);
  vec4 second = texelFetch(u_visbufSecond, ivec2(gl_FragCoord.xy), 0);
  int meshInfoIndex; uint triangleId; bool isFrontFace;
  vec3 bary, baryDx, baryDy;
  if (!unpackVisibilityBuffer(first, second, meshInfoIndex, triangleId,
                               isFrontFace, bary, baryDx, baryDy)) {
    discard; // empty pixel
  }
  // Look up mesh info from SSBO/texture by meshInfoIndex
  // Look up triangle vertices by triangleId
  // Interpolate attributes with bary
  // Shade (unlimited material types)
}
```

**Design choices:**
- **o3de Atom-compatible packing** — same bit layout as
  `VisibilityBuffer.azsli`, so GPU shaders can be ported 1:1.
- **`-0.0f` empty marker** — distinguishes empty pixels from valid
  pixels with `meshInfoIndex=0`. `Object.is(x, -0)` is the JS equivalent
  of GLSL's `x != -0.0f` test (since JS `===` treats `-0 === 0` as true).
- **CPU software rasterizer** — reference implementation using edge
  functions and bounding-box traversal. No WebGL dependency; testable
  in Node/headless (same pattern as `MeshletRenderer`,
  `HierarchicalZBuffer`, `PCSSSampler`).
- **Linear depth interpolation** — screen-space linear (not
  perspective-correct). For correct perspective interpolation, callers
  should store `1/w` and multiply. Sufficient for visbuf ID storage
  (geometry IDs are not affected by interpolation method).
- **Edge function barycentrics** — supports both CCW (front-facing,
  `area2 > 0`) and CW (back-facing, `area2 < 0`) winding. The sign of
  `area2` determines `isFrontFace`.
- **Derivative reconstruction** — only `baryDx.xy` and `baryDy.xy` are
  stored; `z` is reconstructed as `-x - y` (since `u + v + w = 1`,
  `du + dv + dw = 0`). Saves 2 floats per pixel.
- **GLSL_EXT_fragment_shader_barycentric** — the GPU fragment shader
  uses `gl_BarycentricEXT` for hardware barycentric coordinates. This
  extension is available in WebGL2 with `GL_EXT_fragment_shader_barycentric`
  (requires WebGL 2.0 + driver support).
- **75 unit tests** — covers bit packing round-trip, empty pixel
  detection, barycentric computation, rasterization (depth test, bias,
  derivatives, degenerate triangles, viewport culling), full pipeline
  integration, and GLSL chunk content.

**References:**
- o3de `Gems/Atom/Feature/Common/Assets/ShaderLib/Atom/Features/Pipeline/Deferred/VisibilityBuffer.azsli` — packing format + pack/unpack functions
- o3de `Gems/Atom/Feature/Common/Code/Source/DeferredMaterial/` — deferred material system + draw packets
- UE5 Nanite — visibility buffer software rasterization + deferred shading
- Schied, Pettineo "Decoupled Deferred Shading" (GDC 2018) — visbuf framework
- Cruncher, Bentley 2018 "Visibility Buffer: A Framework for Sub-pixel Anti-aliased Decoupled Shading" — theory
- `GL_EXT_fragment_shader_barycentric` extension spec — hardware barycentric coords in GLSL

---

### Mesh Distance Field (`MeshDistanceField.ts`)

**Mesh Distance Field (MDF)** — a *world-space* signed distance field
(SDF) representation of mesh surfaces, plus **Distance Field Soft
Shadows (DFSS)** and **Distance Field Ambient Occlusion (DFAO)**
algorithms built on top of it. Adapted from UE5 "Mesh Distance Fields"
+ "Distance Field Shadowing" + "Distance Field Ambient Occlusion",
Hart 1996 "Sphere Tracing", Crassin et al. 2011 (cone tracing idea),
and Ericson 2005 "Real-Time Collision Detection" §5.1.5 (point-
triangle distance).

This is the **world-space** counterpart to the existing *light-space*
shadow family (`ShadowMapManager` basic/PCF/PCSS, `CascadedShadowMap`,
`ExponentialShadowMap`, `VirtualShadowMap`). Light-space shadow maps
rasterize depth in light clip space — they are bounded by texture
resolution and light projection geometry, and produce aliasing, acne,
peter-panning, and light leaking artifacts that require bias tuning.
MDF instead encodes the surface as a continuous 3D scalar field:
positive outside, zero on the surface, negative inside. **Sphere
tracing** advances along a ray by the current SDF value, guaranteeing
no surface penetration — no aliasing, no acne, no bias tuning, and
natural soft shadows from cone tracing.

soup3D has only basic hard shadows. VREEN now has **6 shadow
solutions** (basic / PCF / PCSS / ESM / VSM / DFSS) covering the full
performance/quality spectrum, and DFSS is the only **world-space**
option that the light-space family cannot replace.

**Why SDF vs shadow maps?**

| Aspect | Shadow Maps (basic/PCF/PCSS/ESM/VSM) | Mesh Distance Field (DFSS/DFAO) |
|--------|---------------------------------------|----------------------------------|
| Working space | Light clip space (rasterized depth) | World space (3D scalar field) |
| Resolution dependence | Texel density in light frustum | Voxel grid resolution (independent of view/light) |
| Aliasing | Yes (PCF/PCSS tap patterns, VSM bleeding, ESM leaking) | No (continuous trilinear interpolation) |
| Acne / peter-panning | Yes (requires bias tuning) | No (no depth comparison) |
| Soft shadows | PCSS (16-41 taps) / ESM (blur) / VSM (variance) | Cone tracing (mathematically strict penumbra) |
| Ambient occlusion | Not supported (needs SSAO/GTAO separate) | Same SDF reused for DFAO |
| Multi-purpose | Shadow only | Shadow + AO + collision + GI + particle collision |
| Memory | 2D texture (light atlas) | 3D texture (O(N³) voxels) |
| Build cost | Per-frame (cheap) | Once (baked, expensive) |
| Dynamic meshes | Yes (per-frame) | No (requires rebuild or SDF composition) |
| Best use case | Large outdoor dynamic scenes (CSM) | Static / semi-static geometry, characters, interiors |

**Data model:**

```ts
interface SDFGrid {
  data: Float32Array;        // dimX × dimY × dimZ, row-major (z → y → x)
  dimX, dimY, dimZ: number;  // voxel resolution per axis
  boundsMin: MDFVec3;        // world-space AABB min corner
  boundsMax: MDFVec3;        // world-space AABB max corner
  voxelSize: MDFVec3;        // world size of one voxel (x, y, z)
  maxDistance: number;       // truncation distance (saves memory)
}
```

**Pipeline:**

| Stage | Function | Description |
|-------|----------|-------------|
| 1. Build AABB | `computeMeshAABB(mesh)` | Compute world-space bounding box of mesh vertices. |
| 2. Collect triangles | `collectTriangles(mesh)` | Flatten indexed / non-indexed mesh into `MDFVec3[][]`. |
| 3. Inside test | `isPointInsideMesh(p, triangles)` | Parity-count ray-triangle intersections along a golden-ratio direction `(1, φ⁻¹, φ⁻²)` (avoids axis-aligned edge/vertex degeneracies). |
| 4. Build SDF | `buildMeshSDF(mesh, opts)` | For each voxel center: brute-force nearest triangle distance (Ericson RTCD §5.1.5) + inside test → signed distance, truncated to `±maxDistance`. AABB early-out for far voxels. |
| 5. Sample (nearest) | `sampleSDFNearest(sdf, p)` | Voxelize `p`, return data[idx] (out-of-grid → +∞). |
| 6. Sample (trilinear) | `sampleSDFTrilinear(sdf, p)` | 8-tap trilinear interpolation (matches GLSL `texture(sampler3D, LINEAR)`). |
| 7. Gradient / normal | `sampleSDFGradient(sdf, p)` | Central-difference gradient → surface normal (matches `computeNormalFromSDF()`). |
| 8. Sphere trace | `rayMarchSDF(sdf, origin, dir, ...)` | Hart 1996 algorithm: advance `t += d` each step until `d < ε` (hit) or `t > maxDistance` (miss). Auto-advances to grid boundary if origin is outside. |
| 9. DFSS shadow | `dfssShadow(sdf, point, lightDir, lightDistance, opts)` | Cone-tracing soft shadow: along light direction, record min visibility = `d / (t * lightSize + bias * lightSize)`; SDF < ε → fully occluded (returns 0). |
| 10. DFAO | `dfao(sdf, point, normal, opts)` | Hemisphere cone tracing: emit `numSamples` Fibonacci-distributed rays in the normal hemisphere, sphere-trace each, accumulate occlusion = `max(0, 1 - dist / radius)`. |

**Inside test (parity rule):**

The classic even-odd rule: cast a ray from the query point and count
triangle intersections — even count = outside, odd = inside. The
challenge is that axis-aligned rays `(1, 0, 0)` can hit shared
edges/vertices/diagonals and produce ambiguous counts. VREEN uses
the **golden ratio direction** `(1, φ⁻¹, φ⁻²) ≈ (1, 0.618, 0.382)`
which has different magnitudes on each axis and is statistically
almost impossible to align with any geometric feature. An `axis`
parameter allows switching the dominant axis for thin geometry
(`'x' | 'y' | 'z'`).

**Sphere tracing (Hart 1996):**

```
t = 0  (or ray-AABB entry t if origin is outside the grid)
loop maxSteps:
  p = origin + t * dir
  d = sampleSDFTrilinear(sdf, p)
  if !isFinite(d):  return miss (left grid)
  if d < ε:         return hit at p
  if t > maxDist:   return miss
  t += max(d, ε/2)  // advance by current SDF value
```

Key property: the step size equals the distance to the nearest
surface, so the ray **cannot overshoot** — this is what eliminates
aliasing and acne. Far from the surface, steps are large (fast); near
the surface, steps shrink (precise).

**DFSS (cone tracing soft shadow):**

```
origin = point + lightDir * bias    // avoid self-intersection
t = 0
minVisibility = 1.0
for step in 0..maxSteps:
  p = origin + lightDir * t
  d = sampleSDFTrilinear(sdf, p)
  if !isFinite(d):  break (left grid, no occlusion)
  if d < hitEpsilon:  return 0.0   // hit surface, fully occluded
  // Cone tracing: penumbra width at distance t with light source size S
  // is t * S. The SDF value d is the radius of the unoccluded sphere
  // around p. Visibility ≈ d / (t * S + bias * S).
  penumbra = d / (t * lightSize + bias * lightSize)
  visibility = min(1.0, penumbra * sharpness)
  minVisibility = min(minVisibility, visibility)
  t += max(d, hitEpsilon / 2)      // sphere-trace step
return minVisibility
```

Physical interpretation: the SDF value `d` at point `p` is the radius
of a sphere centered at `p` that is guaranteed to be empty. If that
sphere is large compared to the cone radius `t * lightSize` at that
distance, the point is "lit" (small penumbra); if it's small, the
point is in the penumbra of an occluder. Accumulating the minimum
visibility across the ray gives the soft shadow.

**DFAO (hemisphere cone tracing):**

Emit `numSamples` rays in the normal hemisphere using a Fibonacci
sphere distribution (golden-angle). For each ray, sphere-trace up to
`radius` distance. If a hit occurs at distance `d`, occlusion =
`max(0, 1 - d / radius)`. Average all rays, multiply by `strength`,
subtract from 1. The result is more stable than SSAO/GTAO (no
screen-space noise, no edge artifacts) and more accurate than HBAO
(full hemisphere coverage).

**Bias handling:**

Both DFSS and DFAO enforce a **minimum bias of `2 × voxelSize`** to
prevent the surface-near region (where SDF ≈ 0) from being
misclassified as a hit. This is the SDF equivalent of the shadow-map
bias, but it's derived from the voxel resolution rather than tuned
per scene.

**Coordinate transforms:**

| Transform | Function | Formula |
|-----------|----------|---------|
| World → voxel (float) | `worldToVoxel(p, sdf)` | `(p - boundsMin) / voxelSize - 0.5` |
| Voxel → world | `voxelToWorld(v, sdf)` | `(v + 0.5) * voxelSize + boundsMin` |
| Voxel index (uniform) | `idx3(x, y, z, dim)` | `(z * dim + y) * dim + x` |
| Voxel index (non-uniform) | `idx3Dim(x, y, z, dimX, dimY)` | `(z * dimY + y) * dimX + x` |
| Inside grid test | `isInsideGrid(p, sdf)` | `boundsMin ≤ p ≤ boundsMax` (all axes) |

**Analytic SDF builders (for testing / simple scenes):**

- `buildSphereSDF(center, radius, boundsMin, boundsMax, resolution)` —
  `d = |p - center| - radius`
- `buildBoxSDF(boxMin, boxMax, boundsMin, boundsMax, resolution)` —
  uses `pointAABBSignedDistance` (positive outside, negative inside,
  zero on the surface).

**API surface:**

```ts
import {
  // Vector utilities (prefixed mdf to avoid collision with SSGI)
  mdfVadd, mdfVsub, mdfVscale, mdfVdot, mdfVcross, mdfVlength, mdfVnormalize,
  // Geometry
  pointTriangleDistanceSq,    // Ericson RTCD §5.1.5
  pointAABBSignedDistance,    // signed distance to AABB
  // SDF construction
  computeMeshAABB,            // mesh → world AABB
  collectTriangles,           // mesh → MDFVec3[][]
  isPointInsideMesh,          // parity rule with golden-ratio direction
  rayTriangleIntersect,       // Möller–Trumbore
  buildMeshSDF,               // mesh → SDFGrid (brute-force, with AABB early-out)
  buildSphereSDF,             // analytic sphere SDF
  buildBoxSDF,                // analytic box SDF
  // Indexing & coordinates
  idx3, idx3Dim,              // voxel index helpers
  worldToVoxel, voxelToWorld, // coordinate transforms
  isInsideGrid,               // bounds check
  // Sampling
  sampleSDFNearest,           // 1-tap nearest
  sampleSDFTrilinear,         // 8-tap trilinear (GPU texture3D equivalent)
  sampleSDFGradient,          // central-difference normal estimation
  // Sphere tracing
  rayMarchSDF,                // Hart 1996, with ray-AABB entry computation
  // Algorithms
  dfssShadow,                 // distance field soft shadows (cone tracing)
  dfao,                       // distance field ambient occlusion (hemisphere)
  // Utilities
  sdfMemoryBytes, sdfMemoryMB, getSDFStats,
  // GLSL chunks (for GPU integration)
  SDF_SAMPLE_GLSL,            // sampleSDF + sampleSDFGradient
  DFSS_SHADOW_GLSL,           // dfssShadow
  DFAO_GLSL,                  // dfao
  MESH_DISTANCE_FIELD_GLSL,   // all three combined
  // Types
  type MDFVec3, type MDFMeshData, type SDFGrid,
  type SDFBuildOptions, type RayMarchResult,
  type DFSSOptions, type DFAOOptions,
} from '@vreen/engine/renderer';
```

**Usage (CPU reference):**

```ts
import {
  buildMeshSDF, dfssShadow, dfao, sampleSDFGradient,
  type MDFMeshData,
} from '@vreen/engine/renderer';

// 1. Build SDF (one-time, bake offline for static meshes)
const mesh: MDFMeshData = {
  positions: meshPositions, // Float32Array (xyz interleaved)
  indices: meshIndices,     // Uint32Array
};
const sdf = buildMeshSDF(mesh, {
  resolution: 32,    // 32³ = 32768 voxels
  padding: 0.1,      // expand AABB by 0.1 world units
  signed: true,      // negative inside, positive outside
});
console.log(getSDFStats(sdf));
// → { dimX: 32, dimY: 32, dimZ: 32, totalVoxels: 32768,
//     memoryMB: 0.125, maxDistance: ..., bounds: ..., voxelSize: ... }

// 2. Compute soft shadow for a surface point
const lightDir = { x: 0.5, y: 0.8, z: 0.3 }; // direction TO light
const surfacePoint = { x: 1.0, y: 0.5, z: 0.0 };
const visibility = dfssShadow(sdf, surfacePoint, lightDir, Infinity, {
  lightSize: 0.1,     // larger → softer shadows
  maxDistance: 10.0,
  maxSteps: 32,
  sharpness: 1.0,
});
// visibility ∈ [0, 1], 0 = fully shadowed, 1 = fully lit

// 3. Compute ambient occlusion
const normal = sampleSDFGradient(sdf, surfacePoint);
const ao = dfao(sdf, surfacePoint, normal, {
  radius: 1.0,        // AO influence radius
  numSamples: 8,      // hemisphere rays (Fibonacci distribution)
  strength: 1.0,
});
// ao ∈ [0, 1], 0 = fully occluded, 1 = no occlusion
```

**Usage (GPU path, GLSL chunks):**

```glsl
uniform sampler3D uSDF;
uniform vec3 uSDFMin, uSDFMax;  // world-space AABB
uniform vec3 uSDFVoxelSize;

// inject SDF_SAMPLE_GLSL
float d = sampleSDF(uSDF, uSDFMin, uSDFMax, worldPos);
vec3 n = sampleSDFGradient(uSDF, uSDFMin, uSDFMax, worldPos, uSDFVoxelSize);

// inject DFSS_SHADOW_GLSL
float shadow = dfssShadow(uSDF, uSDFMin, uSDFMax, worldPos,
                           lightDir, lightSize, maxDist, maxSteps);

// inject DFAO_GLSL
float ao = dfao(uSDF, uSDFMin, uSDFMax, worldPos, normal,
                radius, numSamples, maxSteps);
```

**Design choices:**

- **Brute-force SDF build** — O(voxels × triangles). Sufficient for
  small meshes (32³ × few hundred triangles). Large production meshes
  should use a BVH (not implemented here; future GPU path will use
  compute shaders with morton-ordered voxel dispatch).
- **Golden-ratio inside-test direction** — `(1, φ⁻¹, φ⁻²)` avoids
  axis-aligned degeneracies that cause parity errors on shared
  edges/vertices. The `axis` parameter allows dominant-axis switching
  for thin geometry (e.g., walls aligned to one axis).
- **Trilinear sampling** — matches GLSL `texture(sampler3D, uvw)` in
  `LINEAR` filter mode, so CPU and GPU produce identical results
  (within float precision). Out-of-grid returns `+∞` (fully outside,
  no occlusion).
- **Sphere tracing with ray-AABB entry** — if the ray origin is
  outside the SDF grid, `rayMarchSDF` first computes the entry `t`
  via the slab method and advances to the boundary. This allows
  shadows from points outside the mesh's AABB (e.g., a character
  standing next to a building).
- **Cone tracing for DFSS** — UE5's algorithm: at each step, the SDF
  value `d` represents an unoccluded sphere radius, and the cone
  radius at distance `t` is `t * lightSize`. The ratio
  `d / (t * lightSize)` is the local visibility. Accumulating the
  minimum gives the final soft shadow. `sharpness > 1` sharpens,
  `sharpness < 1` softens.
- **Minimum bias = 2 × voxelSize** — enforced in both `dfssShadow`
  and `dfao` to prevent the surface-near region (SDF ≈ 0) from being
  misclassified as a hit. This is resolution-derived, not scene-tuned.
- **Fibonacci hemisphere** — for DFAO, directions are generated using
  the golden-angle Fibonacci spiral, which gives more uniform
  coverage than random sampling and is deterministic (no noise seed
  needed). The local `+Z` is aligned to the surface normal via a TBN
  basis.
- **Memory** — `Float32Array` of size `dimX × dimY × dimZ`. A 32³
  grid is 128 KB; a 64³ grid is 1 MB; a 128³ grid is 8 MB. Use
  `maxDistance` truncation to avoid wasting memory on far voxels.
- **GLSL chunks** — `SDF_SAMPLE_GLSL`, `DFSS_SHADOW_GLSL`,
  `DFAO_GLSL` are provided for future GPU integration. They mirror
  the CPU functions 1:1, so test results transfer directly.
- **Complements, does not replace, light-space shadows** — DFSS is
  best for static / semi-static geometry (characters, interiors,
  props) where the SDF can be baked once. For dynamic geometry
  (animated characters, moving objects), light-space shadows (PCSS,
  ESM, VSM) remain the better choice. A typical scene uses CSM for
  outdoor sun shadows + DFSS for indoor static occluders.

**Comparison to soup3D:**

| Feature | soup3D | VREEN |
|---------|--------|-------|
| Hard shadows | ✓ (basic shadow map) | ✓ (basic / PCF) |
| PCF soft shadows | ✗ | ✓ (PCF / PCSS) |
| Exponential Shadow Maps | ✗ | ✓ (ESM) |
| Virtual Shadow Maps | ✗ | ✓ (VSM) |
| Cascaded Shadow Maps | ✗ | ✓ (CSM/PSSM) |
| Mesh Distance Field | ✗ | ✓ (MDF) |
| Distance Field Soft Shadows | ✗ | ✓ (DFSS) |
| Distance Field Ambient Occlusion | ✗ | ✓ (DFAO) |
| World-space shadow solution | ✗ | ✓ (SDF-based) |
| Multi-purpose (shadow + AO + collision) | ✗ | ✓ (single SDF) |

**References:**
- UE5 `Engine/Source/Runtime/Engine/Private/DistanceFieldAtlas.cpp` — SDF storage + streaming
- UE5 `Engine/Source/Runtime/Renderer/Private/DistanceFieldShading.cpp` — DFSS + DFAO
- Hart 1996 "Sphere Tracing: A Geometric Method for the Antialiased Ray Tracing of Implicit Surfaces" — sphere tracing algorithm
- Crassin et al. 2011 "Interactive Indirect Illumination Using Voxel Cone Tracing" — cone tracing idea
- Ericson 2005 "Real-Time Collision Detection" §5.1.5 — point-triangle closest point
- Möller & Trumbore 1997 "Fast, Minimum Storage Ray-Triangle Intersection" — ray-triangle test
- Annen et al. 2008 "Exponential Shadow Maps" — comparison (light-space alternative)
- Salvi 2008 "Fast Shadow Maps on a 1K Budget" — ESM comparison

---

### Virtual Texturing (`VirtualTexturing.ts`)

**Sparse Virtual Texture (SVT)** system — a page-based texture streaming
architecture that allows textures larger than GPU memory to be
rendered by loading only the pages (tiles) that are actually sampled.
Adapted from o3de Atom "Virtual Texture"
(`Gems/Atom/Asset/ImageStreaming`), UE5 "Virtual Texturing"
(`TexturePageTable` + `FeedbackBuffer`), Mellor 2004 "Virtual Texture
Mapping" (original SVT paper), and Niesner 2009 "Practical Virtual
Texture Rendering".

This is the **texture-space** counterpart to `VirtualShadowMap`'s
**shadow-space** paging: both divide a large virtual texture into
fixed-size pages, maintain a `PageTable` mapping virtual pages
(`mip + pageX + pageY`) to physical atlas slots, and use an LRU cache
to evict cold pages when the physical atlas is full.

**Why SVT vs `TextureStreaming`?**

| Aspect | `TextureStreaming` (Mip streaming) | `VirtualTexturing` (SVT) |
|--------|-------------------------------------|--------------------------|
| Granularity | Per-mip (whole mip level) | Per-page (128×128 tile within a mip) |
| Use case | Many medium textures | Single huge texture (16K+) |
| Memory control | Evicts whole texture | Evicts individual pages |
| GPU feedback | Distance / screen-size heuristic | Actual UV sampling feedback |
| Texture size limit | GPU max texture size | Unlimited (virtual) |
| Typical | 100 × 2K textures | 1 × 16K terrain mega-texture |

**Architecture:**

```
                    ┌──────────────────────────────────────────┐
                    │          Virtual Textures (N)             │
                    │  VirtualTextureDescriptor + PageTable     │
                    │  (mip + pageX + pageY → physicalIndex)    │
                    └──────────────────┬───────────────────────┘
                                       │ shares
                                       ▼
                    ┌──────────────────────────────────────────┐
                    │     PhysicalTextureAtlas (shared)         │
                    │  atlasSize × atlasSize (e.g., 8192²)     │
                    │  divided into pagesPerSide² slots        │
                    │  (e.g., 64² = 4096 slots of 128×128)     │
                    └──────────────────┬───────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │  FeedbackBuffer │    │   PageCache     │    │  PageProvider   │
    │  (GPU writes    │    │  (LRU tracking  │    │  (async load    │
    │   sampled pages)│    │   lastUsed +    │    │   page data via │
    │                 │    │   priority)     │    │   callback)     │
    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Per-frame pipeline:**

1. **GPU renders** → Fragment shader samples virtual UV, writes
   `(vtId, mip, pageX, pageY)` to `FeedbackBuffer` via MRT or
   `imageStore`.
2. **`processFeedback(feedback, timestamp)`** → deduplicates feedback
   entries, sorts by mip (lower = higher resolution = higher priority)
   then by `sampleCount`.
3. **Load loop** (capped at `maxPagesPerFrame`):
   a. `allocateFreeSlot()` → find free physical slot.
   b. If full → `evictLRU()` → evict the page with lowest
      `lastUsed - priority × 1000` score.
   c. `pageProvider(vtId, coord)` → async load page pixel data.
   d. `uploadPageData(physicalIndex, pageData)` → write to atlas.
   e. `PageTable.set({coord, physicalIndex, status: 'resident'})`.
4. **Shader path** → `virtualUVToPhysicalUV(vtId, u, v, mip)` →
   returns physical atlas UV; if page not resident → return `null`
   (shader falls back to lower mip).

**Page layout:**

For a virtual texture of `virtualWidth × virtualHeight` with
`pageSize = 128`:

- Pages at mip 0: `(virtualWidth / 128) × (virtualHeight / 128)`
- Pages at mip m: `max(1, basePages >> m)`
- Total mip levels: `ceilLog2(maxPages) + 1` (down to 1×1 page)
- Example: 16384² texture → 128×128 pages at mip 0 → 8 mip levels
  → mip 7 = 1×1 page (whole texture in one 128×128 tile)

**Physical atlas layout:**

For `atlasSize = 8192`, `pageSize = 128`:
- Pages per side: `8192 / 128 = 64`
- Total slots: `64 × 64 = 4096`
- Each slot: 128×128 texels
- Physical index → offset: `slotX = index % 64`, `slotY = index / 64`
  → `offsetX = slotX × 128`, `offsetY = slotY × 128`

**API surface:**

```ts
import {
  // Utility functions
  vtCeilLog2,                  // integer log2 (ceiling)
  vtComputeMipCount,           // virtualWidth/Height + pageSize → mip count
  vtPagesAtMip,                // pages per side at a given mip
  vtPageByteSize,              // pageSize × channels × bytesPerChannel
  vtPhysicalPagesPerSide,      // atlasSize / pageSize
  vtPhysicalSlotCount,         // (atlasSize / pageSize)²
  vtPhysicalIndexToOffset,     // slot index → pixel offset
  vtVirtualUVToPageCoord,      // UV → (pageX, pageY, localU, localV)
  vtPageCoordToLinearIndex,    // (mip, pageX, pageY) → linear index
  vtDesiredMipForScreenSize,   // screen-space size → desired mip
  // Classes
  VTPageTable,                 // virtual page → physical slot mapping
  VTPhysicalTextureAtlas,      // shared GPU texture atlas
  VTVirtualTexture,            // single virtual texture instance
  VirtualTexturingSystem,      // system manager (multi-VT + shared atlas)
  // Constants
  DEFAULT_VT_CONFIG,           // {atlasSize: 8192, pageSize: 128, ...}
  // GLSL chunks
  VIRTUAL_TEXTURE_GLSL,        // vtSample() + vtLookupPageTable()
  VT_FEEDBACK_GLSL,            // vtWriteFeedback()
  VT_PAGE_TABLE_GLSL,          // page table texture sampling
  // Types
  type VirtualTextureDescriptor,
  type VTVirtualPageCoord, type VTPageTableEntry,
  type VTFeedbackEntry, type VTPhysicalPageSlot,
  type VTPageProvider, type VirtualTexturingConfig,
  type VirtualTexturingStats,
} from '@vreen/engine/renderer';
```

**Usage (CPU reference):**

```ts
import {
  VirtualTexturingSystem,
  type VirtualTextureDescriptor,
  type VTFeedbackEntry,
} from '@vreen/engine/renderer';

// 1. Create system with small atlas for testing
const sys = new VirtualTexturingSystem({
  atlasSize: 4096,  // 32×32 = 1024 slots
  pageSize: 128,
  maxPagesPerFrame: 8,
});

// 2. Register a 16K virtual texture
const desc: VirtualTextureDescriptor = {
  id: 'terrain-albedo',
  virtualWidth: 16384,
  virtualHeight: 16384,
  format: 'bc7',
  channels: 4,
  bytesPerChannel: 1,
};
sys.registerTexture(desc);

// 3. Set page provider (async load from disk/network)
sys.setPageProvider(async (vtId, coord) => {
  const url = `/textures/${vtId}/${coord.mip}/${coord.pageX}_${coord.pageY}.bin`;
  const res = await fetch(url);
  return new Uint8Array(await res.arrayBuffer());
});

// 4. Preload low mips (fallback when high-res pages not yet loaded)
await sys.preloadLowMips('terrain-albedo', performance.now(), 2);

// 5. Each frame: process GPU feedback
const feedback: VTFeedbackEntry[] = gpuFeedbackBuffer.read();
const loadedCount = await sys.processFeedback(feedback, performance.now());

// 6. Query page table for shader UV remapping
const entry = sys.getPageTableEntry('terrain-albedo', { mip: 0, pageX: 5, pageY: 3 });
if (entry && entry.status === 'resident') {
  // Upload physicalIndex to shader uniform / page table texture
}

// 7. Or directly get physical UV
const physUV = sys.virtualUVToPhysicalUV('terrain-albedo', uv.x, uv.y, mip);
if (physUV) {
  // Sample physical atlas at physUV.physicalU, physUV.physicalV
}

// Stats
const stats = sys.getStats();
console.log(`Atlas: ${stats.occupiedSlots}/${stats.totalSlots} slots, ${stats.residentMB.toFixed(1)} MB`);
```

**Usage (GPU path, GLSL chunks):**

```glsl
// Fragment shader
uniform sampler2DArray u_pageTableArray;  // [mip] = page table for that mip
uniform sampler2D u_physicalAtlas;        // shared physical texture atlas
uniform vec2 u_atlasScale;                // pageSize / atlasSize
uniform float u_invPagesPerSide;          // 1.0 / pagesPerSide (current mip)

// inject VIRTUAL_TEXTURE_GLSL
vec4 color = vtSample(u_pageTableArray, u_physicalAtlas,
                      virtualUV, mip,
                      u_invPagesPerSide, u_atlasScale);

// inject VT_FEEDBACK_GLSL (write to MRT target)
vtWriteFeedback(virtualUV, mip, invVirtualSize);
```

**Design choices:**

- **Shared physical atlas** — all virtual textures share one
  `PhysicalTextureAtlas`. This avoids fragmenting GPU memory across
  multiple small atlases and simplifies slot management. The LRU
  eviction considers pages across all VTs, so a frequently-sampled VT
  naturally gets more atlas space.
- **Feedback-driven loading** — rather than predicting which pages
  are needed from camera distance (like `TextureStreaming`), SVT
  loads pages that the GPU *actually sampled* last frame. This is
  more accurate but introduces one frame of latency (the page is
  missing on first sighting, then loaded on the next frame).
  `preloadLowMips` mitigates this by pre-loading 1×1 and 2×2 pages
  as fallbacks.
- **LRU with priority weighting** — eviction score =
  `lastUsed - priority × 1000`. Pages with high `sampleCount` (high
  priority) survive longer than purely-LRU would allow. This prevents
  thrashing when the camera moves between two regions that together
  exceed atlas capacity.
- **`maxPagesPerFrame` throttle** — prevents frame-rate spikes when
  the camera teleports to a new area (which would trigger hundreds of
  page loads at once). Default 8 pages/frame keeps I/O spread across
  frames.
- **Page size = 128** — balances granularity (smaller = more precise
  loading, but more page table overhead) vs. upload efficiency (larger
  = fewer `texSubImage2D` calls, but more wasted bandwidth on
  partially-visible pages). 128 matches o3de/UE5 defaults.
- **Mip-level feedback** — the shader selects the mip level based on
  screen-space derivatives (`dFdx`/`dFdy`), so distant fragments
  request low-resolution pages (1×1 at the highest mip). This
  automatically reduces the number of pages needed for far-away
  surfaces.
- **`pageCoordToLinearIndex` wrapping** — negative coordinates wrap
  via modulo, so UVs slightly outside `[0, 1)` (common with
  `REPEAT`/`MIRRORED_REPEAT` wrap modes) don't cause out-of-bounds
  access.
- **GLSL chunks** — `VIRTUAL_TEXTURE_GLSL`, `VT_FEEDBACK_GLSL`,
  `VT_PAGE_TABLE_GLSL` are provided for GPU integration. They mirror
  the CPU functions 1:1.
- **Complements `TextureStreaming`** — SVT handles single huge
  textures (terrain mega-textures, satellite imagery, 8K+ character
  textures); `TextureStreaming` handles many medium textures (100 ×
  2K material textures). A production scene uses both: SVT for the
  terrain albedo, `TextureStreaming` for object materials.

**Comparison to soup3D:**

| Feature | soup3D | VREEN |
|---------|--------|-------|
| Mip streaming | ✗ | ✓ (`TextureStreaming`) |
| Virtual texturing (SVT) | ✗ | ✓ (`VirtualTexturing`) |
| Page-based texture streaming | ✗ | ✓ (128×128 pages) |
| Shared physical atlas | ✗ | ✓ (multi-VT, LRU) |
| GPU feedback-driven loading | ✗ | ✓ (`FeedbackBuffer`) |
| Texture size beyond GPU limit | ✗ | ✓ (virtual, 16K+) |
| Preload fallback mips | ✗ | ✓ (`preloadLowMips`) |
| Frame-rate throttle | ✗ | ✓ (`maxPagesPerFrame`) |

**References:**
- o3de Atom `Gems/Atom/Asset/ImageStreaming` — Virtual Texture system
- UE5 `Engine/Source/Runtime/Engine/Private/VirtualTexture.cpp` — VT allocation + feedback
- Mellor 2004 "Virtual Texture Mapping" — original SVT paper
- Niesner 2009 "Practical Virtual Texture Rendering" — practical implementation
- Barrett 2008 "Virtual Texture" (GDC) — feedback buffer design
- van Waveren 2004 "Megatexture" (id Software) — mega-texture streaming
- `VirtualShadowMap.ts` — same PageTable + PhysicalAtlas pattern (shadow space)

---

### Voxel Cone Tracing GI (`VoxelConeTracing.ts`)

**Voxel Cone Tracing Global Illumination (VXGI)** — a voxel-space GI
technique that builds a 3D voxel representation of the scene and
traces cones through it to compute both diffuse and specular indirect
lighting. Adapted from Crassin et al. 2011 "Interactive Indirect
Illumination Using Voxel Cone Tracing" and El Garawany 2013 (SIGGRAPH
course).

This is the **voxel-space** GI counterpart, complementing the existing
GI family:

| GI Method | Working Space | Off-screen? | Probe Placement? | Speed | Quality |
|-----------|--------------|-------------|------------------|-------|---------|
| `SSGI` | Screen-space | No (visible only) | No | Fast | Medium |
| `DDGIVolume` | Probe-space | Yes | Yes (manual) | Medium | Medium-High |
| `VoxelConeTracing` (VXGI) | Voxel-space | Yes | No (automatic) | Medium | Medium-High |
| `LightPropagationVolume` (LPV) | Grid-space (SH2) | Yes | No (automatic) | Fast | Medium |
| `PathTracer` | Ray-space | Yes | No | Slow | Highest |

**Key advantage:** VXGI covers off-screen surfaces (unlike SSGI) without
requiring probe placement (unlike DDGI), making it ideal for dynamic
scenes where probe placement is impractical.

**Architecture:**

```
              ┌────────────────────────────────────────────────┐
              │              Voxel Scene                        │
              │  boundsMin/Max + baseDim + voxelSize            │
              │                                                │
              │  ┌──────────────────────────────────────────┐  │
              │  │  mip[0]: dim×dim×dim                    │  │
              │  │  occupancy + color + normal             │  │
              │  └───────────────┬──────────────────────────┘  │
              │                  │ 8:1 downsample               │
              │  ┌───────────────▼──────────────────────────┐  │
              │  │  mip[1]: (dim/2)³                       │  │
              │  └───────────────┬──────────────────────────┘  │
              │                  │ ...                          │
              │  ┌───────────────▼──────────────────────────┐  │
              │  │  mip[N-1]: 1×1×1                        │  │
              │  └──────────────────────────────────────────┘  │
              └────────────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────────────┐
              ▼                  ▼                          ▼
    ┌─────────────────┐ ┌─────────────────┐  ┌─────────────────────┐
    │  Diffuse GI     │ │  Specular GI    │  │  Ambient Occlusion  │
    │  (N wide cones  │ │  (1 narrow cone │  │  (from diffuse      │
    │   on hemisphere)│ │   on reflect)   │  │   cone occlusion)   │
    └─────────────────┘ └─────────────────┘  └─────────────────────┘
```

**Pipeline:**

1. **Voxelization** (`voxelizeScene`): Rasterize triangle meshes into
   a 3D grid. For each voxel near a triangle, store occupancy (1.0),
   color (from vertex colors or normal-based shading), and surface
   normal.
2. **Mip chain build**: Each level downsamples 2×2×2 = 8 child voxels
   into one parent. Occupancy is averaged; color is occupancy-weighted;
   normal is occupancy-weighted and renormalized. Higher mips = coarser
   representation covering larger area.
3. **Cone tracing** (`traceCone`): March along a cone direction. At
   each step, the cone radius grows (`t × tan(halfAngle)`). The mip
   level is selected as `log2(coneRadius / voxelSize)`, so distant
   samples use coarser mips (anisotropic filtering). Alpha blending
   accumulates color and occlusion:
   ```
   α = color.a × occupancy
   color += sampleColor × α × (1 - occlusion)
   occlusion += α × (1 - occlusion)
   t += max(coneRadius × stepScale, voxelSize × 0.5)
   ```
4. **Diffuse GI** (`traceDiffuseGI`): Emit N cones (default 6) over the
   hemisphere using Fibonacci sampling. Each cone has a wide half-angle
   (30°). Results are averaged and cosine-weighted.
5. **Specular GI** (`traceSpecularGI`): Emit 1 cone along the reflect
   direction. Half-angle = `roughness × π/4` (smooth = narrow cone,
   rough = wide cone). Fresnel (Schlick) modulates the result.
6. **Combined** (`traceIndirectLighting`): `diffuse × albedo × AO +
   specular × Fresnel`.

**Mip level selection:**

The key insight of VXGI is that the cone radius grows linearly with
distance (`coneRadius = t × tan(halfAngle)`). At each step, the
appropriate mip level is:

```
mipLevel = log2(coneRadius / voxelSize)
```

This means:
- Near the origin (small t): small cone radius → low mip (high
  resolution) → precise local geometry.
- Far from the origin (large t): large cone radius → high mip (low
  resolution) → coarse distant geometry.

This is analogous to mipmapping in texture filtering, but applied to
the voxel scene for anisotropic cone tracing.

**Diffuse GI cone distribution (Fibonacci hemisphere):**

```
golden = (1 + √5) / 2 ≈ 1.618
for i in 0..N:
    φ = 2π × i / golden       // azimuthal angle
    cos(θ) = 1 - (2i+1)/(2N)  // polar angle (hemisphere)
    sin(θ) = √(1 - cos²(θ))
    dir = TBN × (cos(φ)sin(θ), sin(φ)sin(θ), cos(θ))
```

Fibonacci sampling provides quasi-uniform distribution on the
hemisphere without precomputation, and works for any N ≥ 1.

**API surface:**

```ts
import {
  // Voxelization
  voxelizeScene,                // mesh[] → VoxelScene with mip chain
  vxgiComputeMeshAABB,          // mesh → {min, max}
  vxgiCollectTriangles,         // mesh → triangle[]
  // Sampling
  vxgiSampleOccupancy,          // (scene, point, mip) → occupancy
  vxgiSampleColor,              // (scene, point, mip) → RGBA
  // Cone tracing
  vxgiTraceCone,                // (scene, cone) → {occlusion, color, hit}
  vxgiFibonacciHemisphere,      // (N, normal) → direction[]
  vxgiTraceDiffuseGI,           // (scene, point, normal) → {color, occlusion}
  vxgiTraceSpecularGI,          // (scene, point, normal, viewDir, roughness) → color
  vxgiTraceIndirectLighting,    // (scene, point, normal, viewDir, albedo, roughness) → {diffuse, specular, ao, combined}
  // Stats
  vxgiGetStats,                 // scene → {baseDim, mipCount, memoryMB, ...}
  // GLSL
  VOXEL_CONE_TRACING_GLSL,      // traceCone() + traceDiffuseGI() + traceSpecularGI()
  VOXELIZATION_GLSL,            // GPU voxelization (geometry shader)
  VOXEL_MIP_CHAIN_GLSL,         // mip chain build (compute shader)
  // Types
  type VoxelScene, type VoxelMipLevel,
  type VXGICone, type ConeTraceResult,
  type DiffuseGIOptions, type SpecularGIOptions,
} from '@vreen/engine/renderer';
```

**Usage:**

```ts
import {
  voxelizeScene,
  vxgiTraceIndirectLighting,
  type VXGIMeshData,
} from '@vreen/engine/renderer';

// 1. Voxelize scene
const meshes: VXGIMeshData[] = [terrainMesh, buildingMesh, treeMesh];
const scene = voxelizeScene(meshes, boundsMin, boundsMax, 128);

// 2. For each shaded pixel
const indirect = vxgiTraceIndirectLighting(
  scene,
  worldPos,           // pixel world position
  normal,             // surface normal
  viewDir,            // camera-to-pixel direction
  albedo,             // surface albedo
  roughness,          // surface roughness (0-1)
  { coneCount: 6, maxDistance: 10 },
);

// 3. Combine with direct lighting
finalColor = directLight + indirect.combined;
// Or separately:
finalColor = directLight + indirect.diffuse * indirect.ao + indirect.specular;
```

**Design choices:**

- **CPU reference implementation** — like `MeshDistanceField` and
  `SSGI`, this is a pure CPU reference with no WebGL dependency.
  Validates algorithm correctness and provides a reference for GPU
  implementation.
- **Mip chain for anisotropic tracing** — the mip chain is the key
  data structure. Without it, cone tracing would need to sample many
  individual voxels per step (expensive). With mip levels, each step
  is a single trilinear sample at the appropriate resolution.
- **Fibonacci hemisphere** — quasi-uniform sampling that works for any
  cone count without precomputation. 6 cones is the default (good
  balance of quality and speed); 9-16 cones for higher quality.
- **Pre-multiplied alpha blending** — the cone tracing accumulation
  uses front-to-back alpha blending with early termination
  (`occlusion < 0.99`), which is mathematically correct and efficient.
- **Shared voxelization for GI + AO + reflections** — the same
  `VoxelScene` provides diffuse GI, specular GI, and ambient occlusion
  from a single voxelization pass. This amortizes the voxelization
  cost across multiple effects.
- **Normal bias** — the cone origin is offset along the surface normal
  by 1 voxel to prevent self-intersection (similar to shadow map bias).
- **`stepScale` parameter** — controls the trade-off between quality
  and speed. `stepScale = 1.0` (default) steps by exactly the cone
  radius. `stepScale > 1` takes larger steps (faster but may miss thin
  geometry). `stepScale < 1` takes smaller steps (higher quality but
  slower).

**Comparison to soup3D:**

| Feature | soup3D | VREEN |
|---------|--------|-------|
| Any GI | ✗ | ✓ (5 methods) |
| Screen-space GI (SSGI) | ✗ | ✓ |
| Probe-based GI (DDGI) | ✗ | ✓ |
| Voxel cone tracing (VXGI) | ✗ | ✓ |
| Light propagation volumes (LPV) | ✗ | ✓ |
| Path tracing | ✗ | ✓ |
| Voxelization | ✗ | ✓ (GPU + CPU) |
| Mip chain for multi-res | ✗ | ✓ |
| Diffuse + specular GI | ✗ | ✓ |
| Voxel-based AO | ✗ | ✓ |

**References:**
- Crassin et al. 2011 "Interactive Indirect Illumination Using Voxel Cone Tracing" — VXGI original paper
- El Garawany 2013 "Voxel Cone Tracing" (SIGGRAPH course) — practical implementation
- Crassin et al. 2011 "Gigavoxels" — voxel mip chain design
- Engel 2013 "Voxel Cone Tracing and Sparse Voxel Octrees" — survey
- o3de Atom "Diffuse Global Illumination" — DDGI (complementary approach)
- UE5 "Lumen" — GI fusion (VXGI + SSGI + DDGI)
- `SSGI.ts` — screen-space GI (complementary)
- `DDGIVolume.ts` — probe-based GI (complementary)
- `MeshDistanceField.ts` — SDF grid architecture (similar 3D grid pattern)

---

### Light Propagation Volumes GI (`LightPropagationVolume.ts`)

**Light Propagation Volumes (LPV)** — a grid-space global illumination
technique that injects direct lighting into a 3D Spherical Harmonics
(SH2) grid, iteratively propagates radiance through neighboring cells
to compute multi-bounce indirect lighting, and samples via trilinear
interpolation + SH evaluation. Adapted from Kaplanyan 2009 "Light
Propagation Volumes in CryEngine 3" and Kaplanyan & Dachsbacher 2010
"Propagation of Radiance".

This is the **grid-space** GI counterpart — the 5th GI method in
VREEN's comprehensive GI stack:

| GI Method | Working Space | Off-screen? | Probe Placement? | Voxelization? | Multi-bounce? | Speed | Quality |
|-----------|--------------|-------------|------------------|----------------|---------------|-------|---------|
| `SSGI` | Screen-space | No (visible only) | No | No | No (1 bounce) | Fast | Medium |
| `DDGIVolume` | Probe-space | Yes | Yes (manual) | No | Yes (EMA) | Medium | Medium-High |
| `VoxelConeTracing` (VXGI) | Voxel-space | Yes | No (automatic) | Yes | Yes (mips) | Medium | Medium-High |
| `LightPropagationVolume` (LPV) | Grid-space (SH2) | Yes | No (automatic) | No | Yes (iterative) | Fast | Medium |
| `PathTracer` | Ray-space | Yes | No | No | Yes (paths) | Slow | Highest |

**Key advantage:** LPV covers off-screen surfaces (unlike SSGI) without
requiring probe placement (unlike DDGI) or expensive voxelization
(unlike VXGI). Light propagation is a simple SH evaluation per cell
face — extremely fast (O(N³ × iterations × 6)) — making it ideal for
real-time multi-bounce GI on low-end hardware.

**Architecture:**

```
              ┌──────────────────────────────────────────────────┐
              │              LPV Grid                            │
              │  origin + cellSize + dimX × dimY × dimZ          │
              │                                                  │
              │  ┌──────────────────────────────────────────┐    │
              │  │  SH2 coefficients (Float32Array)         │    │
              │  │  per cell: 9 basis × 3 RGB = 27 floats   │    │
              │  │                                          │    │
              │  │  sh[      ]  ← current state (read)      │    │
              │  │  shBuffer[]  ← propagation buffer (write)│    │
              │  └──────────────────────────────────────────┘    │
              │                                                  │
              │  geometryVolume: Uint8Array (optional)           │
              │  1 = cell occupied by geometry (blocks light)    │
              └──────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
   ┌──────────┐           ┌──────────┐           ┌──────────────┐
   │ Inject   │           │Propagate │           │ Sample       │
   │ (1-pass) │──────────▶│ (N-pass) │──────────▶│ (per-pixel)  │
   └──────────┘           └──────────┘           └──────────────┘
   • Point lights         • 6-face transfer       • Trilinear SH
   • Directional lights   • Double-buffered       • evaluateSH
   • Emissive surfaces    • Iterative bounces     • Albedo mod.
```

**Pipeline:**

1. **Light injection** (single pass):
   - **Point lights** (`injectPointLight`): For each cell within the
     light's range, compute the direction and distance from the light
     to the cell center. Apply 1/r² attenuation with a smoothstep
     boundary falloff (`1 - (d/range)⁴`). Project the irradiance
     (`color × attenuation`) into SH2 via `computeSHRGB(lightDir,
     irradiance)` and accumulate into the cell's coefficients.
   - **Directional lights** (`injectDirectionalLight`): All
     unblocked cells receive the same directional irradiance
     (`color × intensity`). Project once into SH2 and add to every
     cell — no per-cell distance attenuation.
   - **Emissive surfaces** (`injectEmissiveSurface`): Find the cell
     containing the surface position. Project the emissive color
     along the surface normal into SH2 and accumulate. This enables
     glowing geometry to act as area light sources.

2. **Light propagation** (iterative, N bounces):
   - **Double-buffered** (`shBuffer` is a copy of `sh` at step start,
     so reads from `sh` don't see in-progress writes).
   - For each non-blocked cell `(x, y, z)`:
     - For each of 6 face directions `d ∈ {±X, ±Y, ±Z}`:
       - Evaluate the cell's SH at direction `d` to get the radiance
         leaving through that face: `radiance = evaluateSHRGB(cellSH, d)`.
       - Re-project this radiance as incoming light from direction
         `-d` for the neighbor cell: `propagated = computeSHRGB(-d,
         radiance)`.
       - Accumulate `propagated × (strength / 6)` into the neighbor's
         `shBuffer`.
   - After all cells are processed, copy `shBuffer → sh`.
   - Each iteration represents one light bounce. Default: 4 iterations
     (configurable via `config.propagationIterations`).

3. **Sampling** (per-pixel at render time):
   - Convert world position to floating-point cell coordinates.
   - Clamp to grid bounds; return black if outside.
   - Trilinearly interpolate the 8 nearest cells' SH coefficients
     (27 floats each, weighted by corner positions).
   - Evaluate the interpolated SH at the surface normal:
     `result = evaluateSHRGB(interpolatedSH, normal)`.
   - For diffuse GI: multiply by surface albedo.

**SH2 basis functions:**

The grid stores 2nd-order Spherical Harmonics (9 basis functions per
color channel = 27 floats per cell). The basis for direction `(x, y, z)`:

```
Y₀⁰  = 0.282095                          (constant term, isotropic)
Y₁₋₁ = 0.488603 × y                      (linear Y)
Y₁₀  = 0.488603 × z                      (linear Z)
Y₁₁  = 0.488603 × x                      (linear X)
Y₂₋₂ = 1.092548 × x × y                  (quadratic XY)
Y₂₋₁ = 1.092548 × y × z                  (quadratic YZ)
Y₂₀  = 0.315392 × (3z² − 1)              (quadratic ZZ)
Y₂₁  = 1.092548 × x × z                  (quadratic XZ)
Y₂₂  = 0.546274 × (x² − y²)              (quadratic XX-YY)
```

SH2 captures directional lighting up to 2nd-order moments — enough for
smooth diffuse indirect lighting (low-frequency), but cannot represent
sharp specular highlights (use `ReflectionProbe` or `SSRPass` for
specular). The Y₀⁰ constant term represents the isotropic (ambient)
component; the Y₁ terms capture the dominant light direction; the Y₂
terms capture directional spread.

**Why SH2 and not SH3?**

- **Memory**: SH2 = 27 floats/cell, SH3 = 48 floats/cell (78% more).
  For a 32³ grid: SH2 = 3.4MB, SH3 = 6.0MB.
- **Quality**: SH2 is sufficient for diffuse indirect (low-frequency).
  SH3 adds detail that's mostly invisible after albedo modulation.
- **Speed**: SH projection/evaluation is O(9) for SH2 vs O(16) for
  SH3. Propagation is 6 face evaluations per cell, so the difference
  compounds.

**Geometry occlusion volume:**

The optional `geometryVolume` (Uint8Array, 1 = occupied) blocks light
propagation through solid geometry. Without it, light would flow
freely through walls — useful for outdoor scenes but causes light
leaking in indoor scenes. Build it via `buildGeometryVolume(config,
meshes)`, which rasterizes triangle meshes into the cell grid:

```
For each triangle:
  Compute triangle AABB → cell range
  For each cell in range:
    Compute distance from cell center to triangle plane
    If distance ≤ halfCellSize: mark cell as occupied
```

This is a conservative rasterization — cells whose center is within
half a cell size of the triangle plane are marked. This may over-mark
thin geometry (1-cell-thick walls) but is sufficient for LPV's
low-frequency nature.

**Memory layout:**

```
LPVGrid {
  config: LPVConfig        // ~80 bytes (origin, dims, etc.)
  sh: Float32Array         // dimX × dimY × dimZ × 27 × 4 bytes
  shBuffer: Float32Array   // same size (double buffering)
}

Total memory = 2 × dimX × dimY × dimZ × 27 × 4 bytes

Example grids:
  16³ grid:  2 × 4096 × 27 × 4 = 884 KB     (low quality, fast)
  32³ grid:  2 × 32768 × 27 × 4 = 6.75 MB   (medium quality)
  64³ grid:  2 × 262144 × 27 × 4 = 54 MB    (high quality, slow)
```

**Performance characteristics:**

| Operation | Complexity | 32³ grid time (estimate) |
|-----------|------------|--------------------------|
| Injection (1 point light, range=4) | O(range³ × 27) | ~5μs |
| Injection (directional) | O(N³ × 27) | ~1ms |
| Propagation (1 iteration) | O(N³ × 6 × 27) | ~6ms |
| Propagation (4 iterations) | O(N³ × 24 × 27) | ~24ms |
| Sampling (1 pixel) | O(8 × 27) | ~1μs |

For real-time (60 FPS, 16ms budget), 32³ grid with 4 bounces uses
~25ms — too slow for 60Hz but acceptable for 30Hz. For 60Hz, reduce
to 2 bounces (~12ms) or use a 24³ grid.

**Usage example:**

```typescript
import { createLPV, injectPointLight, propagateLight, sampleLPV } from './LightPropagationVolume';

// 1. Create LPV grid covering the scene
const grid = createLPV({
  origin: { x: -20, y: 0, z: -20 },
  cellSize: 1.0,
  dimX: 40, dimY: 10, dimZ: 40,
  propagationIterations: 4,
  propagationStrength: 0.85,
});

// 2. (Optional) Build geometry occlusion from scene meshes
grid.config.geometryVolume = buildGeometryVolume(grid.config, sceneMeshes);

// 3. Inject lights (per frame, or only when lights move)
resetLPV(grid);
injectPointLight(grid, {
  position: { x: 0, y: 5, z: 0 },
  color: { r: 5, g: 4, b: 3 },     // warm HDR
  intensity: 50,
  range: 15,
});
injectDirectionalLight(grid, {
  direction: { x: 0.5, y: -1, z: 0.3 },
  color: { r: 0.8, g: 0.9, b: 1.0 }, // cool sky light
  intensity: 2,
});

// 4. Propagate (N bounces)
propagateLight(grid);

// 5. Sample at render time (per pixel)
for (const pixel of visiblePixels) {
  const indirect = sampleLPV(grid, pixel.worldPos, pixel.normal);
  finalColor = directLight + indirect * pixel.albedo;
}
```

**Design choices:**

- **CPU reference implementation** — like `MeshDistanceField`, `SSGI`,
  `VXGI`, and `PathTracer`, this is a pure CPU reference with no WebGL
  dependency. Validates algorithm correctness and provides a reference
  for GPU implementation. The GPU version would use 3D textures +
  compute shaders (see `LPV_INJECTION_GLSL` and `LPV_PROPAGATION_GLSL`
  shader chunks).
- **SH2 over SH3** — 2nd-order SH is sufficient for diffuse indirect
  lighting. SH3 would add 78% more memory and computation for marginal
  quality gain (mostly invisible after albedo modulation).
- **6-face propagation** — the 6 axis-aligned face directions (`±X, ±Y,
  ±Z`) are the minimal set that covers all 3D directions. Diagonal
  propagation (26 neighbors) would be more accurate but 4.3× slower
  for marginal quality gain.
- **Double-buffering** — without double buffering, propagation would
  read partially-updated state (light from cell A reaches cell B in
  iteration 1, then cell B's new light reaches cell C in the same
  iteration — incorrect for single-bounce semantics). Double buffering
  ensures each iteration is a clean single-bounce step.
- **Geometry volume as Uint8Array** — minimal memory (1 byte/cell),
  fast lookup. Build once at scene load or when geometry changes
  (dynamic geometry requires rebuild — for fully dynamic scenes,
  consider DDGI which adapts via ray tracing).
- **`propagationStrength` (0-1)** — controls energy retention per
  bounce. 0.85 (default) means each bounce retains 85% of incoming
  energy. Lower values = faster falloff (darker distant areas); higher
  values = brighter but may over-saturate.

**When to use LPV vs other GI methods:**

| Scenario | Recommended GI | Why |
|----------|---------------|-----|
| Static scene, highest quality | `PathTracer` | Reference quality, no real-time constraint |
| Dynamic scene, probe-friendly | `DDGIVolume` | Adaptive probe relocation, high quality |
| Dynamic scene, no probes wanted | `VXGI` | Automatic voxelization, off-screen coverage |
| Real-time, low-end hardware | `LPV` | Fastest multi-bounce, no voxelization |
| Screen-only, fastest | `SSGI` | Screen-space, no grid/probe/voxel setup |
| Hybrid (best quality) | All combined | UE5 Lumen-style fusion |

**Comparison to soup3D:**

| Feature | soup3D | VREEN |
|---------|--------|-------|
| Any GI | ✗ | ✓ (5 methods) |
| Screen-space GI (SSGI) | ✗ | ✓ |
| Probe-based GI (DDGI) | ✗ | ✓ |
| Voxel cone tracing (VXGI) | ✗ | ✓ |
| Light propagation volumes (LPV) | ✗ | ✓ |
| Path tracing | ✗ | ✓ |
| SH2 spherical harmonics | ✗ | ✓ (LPV + DDGI + LightProbes) |
| Multi-bounce iterative GI | ✗ | ✓ (LPV) |
| Geometry occlusion volume | ✗ | ✓ |
| GPU injection + propagation shaders | ✗ | ✓ (GLSL chunks) |

**References:**
- Kaplanyan 2009 "Light Propagation Volumes in CryEngine 3" — LPV original paper
- Kaplanyan & Dachsbacher 2010 "Propagation of Radiance" — SH propagation theory
- Crytek CryEngine 3 LPV implementation
- UE5 "Light Propagation Volume" plugin
- Ramamoorthi & Hanrahan 2001 "Irradiance Volume" — SH2 for irradiance
- Sloan et al. 2002 "Precomputed Radiance Transfer" — SH projection
- o3de Atom "Diffuse Global Illumination" — DDGI (complementary approach)
- `DDGIVolume.ts` — probe-based GI with SH2 (similar math, different data structure)
- `GlobalIllumination.ts` — static SH2 light probes (baked, not propagated)
- `VoxelConeTracing.ts` — voxel-space GI (complementary, higher quality but slower)
- `SSGI.ts` — screen-space GI (complementary, no off-screen coverage)

---

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
