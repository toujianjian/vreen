# Renderer Module

> Path: `src/engine/Renderer/`
>
> The rendering subsystem of the `@vreen/engine` kernel. Provides a pluggable
> `Renderer` interface backed by a concrete `WebGL2Renderer` implementation
> featuring PBR / IBL, real-time shadow mapping, MRT-based deferred rendering,
> and a composable post-processing pipeline.

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
