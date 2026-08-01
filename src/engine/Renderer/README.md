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
| `LUTPass` | Color lookup table — 3D LUT or 2D strip LUT. |
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
