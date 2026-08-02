# PostProcess Module

> Path: `src/engine/Renderer/PostProcess/`
>
> The enhanced post-processing pass family of the VREEN engine. Provides **18**
> passes covering color grading, anti-aliasing, screen-space effects, depth-of-field,
> motion blur, exposure adaptation, and stylized effects. Each pass is a
> self-contained class that manages its own GPU resources (FBOs, textures,
> shader programs) and integrates into the `PostProcessingPipeline`.

---

## Architecture

```
PostProcess/
  ├── RenderPass-compatible (7 passes)        ← drop-in pipeline passes
  │     ├── ColorGradingPass
  │     ├── LUTPass
  │     ├── ChromaticAberrationPass (enhanced)
  │     ├── VignettePass (enhanced)
  │     ├── FilmGrainPass
  │     ├── AfterimagePass
  │     └── PixelationPass
  │
  ├── GBuffer-dependent (10 passes)           ← independent FBO/program
  │     ├── SSRPass          ← needs position + normal
  │     ├── VolumetricFogPass ← needs depth
  │     ├── VelocityPass     ← needs depth + matrices
  │     ├── TAAPass          ← needs color + velocity
  │     ├── MotionBlurPass   ← needs color + velocity
  │     ├── AutoExposurePass ← needs color (luminance)
  │     ├── GTAOPass         ← needs depth + normal
  │     ├── SSSSPass         ← needs color + depth
  │     ├── DOFEnhancedPass  ← needs color + depth
  │     ├── GlitchPass       ← needs color (stylized)
  │     └── SMAAPass         ← needs color (3-pass AA)
  │
  └── index.ts               ← barrel exports
```

### Two Integration Patterns

**Pattern 1: `RenderPass`-compatible** — These 7 passes extend `RenderPass`
and accept `(input: WebGLTexture, ctx: PassContext)`. They can be added
directly to a `PostProcessingPipeline`:

```ts
pipeline.add(new ColorGradingPass({ saturation: 1.2 }));
pipeline.add(new LUTPass({ lut: myLUTTexture, lutSize: 32, is3D: true }));
```

**Pattern 2: GBuffer-dependent** — These 10 passes have custom `apply()`
signatures that require additional GBuffer textures (depth, normal, velocity,
position). They manage their own FBOs and shader programs independently:

```ts
const ssr = new SSRPass({ maxSteps: 30, thickness: 0.5 });
const reflected = ssr.apply(gl, colorTex, positionTex, normalTex, camera);
```

---

## Pass Reference

### ColorGradingPass

ASC-CDL style color grading with 8 adjustable parameters.

**Class**: `ColorGradingPass extends RenderPass`
**Shader**: `color-grading` (`COLOR_GRADING_FRAG`)

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `temperature` | `number` | `0` | Warm/cool shift (-1..1) |
| `tint` | `number` | `0` | Green/magenta shift (-1..1) |
| `saturation` | `number` | `1` | Color saturation (0..2) |
| `contrast` | `number` | `1` | Contrast multiplier (0..2) |
| `gain` | `number` | `1` | ASC-CDL gain (multiply) |
| `lift` | `number` | `0` | ASC-CDL lift (add offset) |
| `gamma` | `number` | `1` | ASC-CDL gamma (power) |
| `hueShift` | `number` | `0` | Hue rotation in radians |
| `enabled` | `boolean` | `false` | Enable toggle |

#### API

```ts
apply(input: WebGLTexture, ctx: PassContext): WebGLTexture
```

---

### LUTPass

Color lookup table (LUT) post-processing — applies a pre-baked color
grade to the rendered frame in a single GPU pass. Supports both **3D
LUT** (`sampler3D` via `TEXTURE_3D`, the recommended high-precision
path) and **2D strip LUT** (a horizontally-tiled `sampler2D`, for
platforms or asset pipelines that store LUTs as 2D textures). Pairs
with `LUTCubeLoader.toData3DTexture()` for an end-to-end `.cube` file
workflow: load → parse → upload → grade.

**Class**: `LUTPass extends RenderPass`
**Shaders**: `LUT_3D_FRAG` (3D path), `LUT_2D_STRIP_FRAG` (2D strip path)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()` (0 when `lut === null`, passthrough)

#### Architecture

```
┌─────────────┐    ┌──────────────────────────────────────┐
│ input (2D)  │───▶│ LUTPass.apply()                      │
│ HDR color  │    │  1. bind finalFbo                     │
└─────────────┘    │  2. resolve lut → WebGLTexture        │
                    │  3. select shader (3D or 2D strip)    │
┌─────────────┐    │  4. bind input → TEXTURE0             │
│ LUT texture │───▶│  5. bind lut   → TEXTURE1             │
│ 3D or 2D    │    │  6. set uniforms (size, intensity)    │
└─────────────┘    │  7. drawArrays(fullscreen triangle)   │
                    │  8. return finalTexture               │
                    └────────────────┬─────────────────────┘
                                     ▼
                            ┌─────────────────┐
                            │ finalTexture    │
                            │ graded color    │
                            └─────────────────┘
```

When `lut === null`, the pass **bypasses all GPU work** and returns the
input texture directly — this lets the pipeline stay wired with a
disabled LUTPass without paying a blit cost.

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lut` | `WebGLTexture \| Texture \| Data3DTexture \| null` | `null` | LUT texture. `WebGLTexture` = pre-uploaded handle; `Texture` = VREEN texture (resolved via `renderer.getGLTexture()` at apply time); `null` = passthrough. |
| `lutSize` | `number` | `16` | LUT grid points per axis (N×N×N for 3D, N×N² for 2D strip). Common values: 16, 32, 33, 64. |
| `is3D` | `boolean` | `true` | `true` = use `sampler3D` / `TEXTURE_3D` (high precision, recommended); `false` = use `sampler2D` / 2D strip (compatibility). |
| `intensity` | `number` | `1.0` | Blend factor: `0` = original color (no grading), `1` = full LUT color, `0.5` = 50/50 mix. The shader uses `mix(src, graded, intensity)`. |
| `enabled` | `boolean` | `false` | Master toggle. `false` = pipeline skips this pass entirely. |

#### Shader: `LUT_3D_FRAG` (3D path)

```glsl
vec4 src = texture(u_colorMap, v_uv);
// Half-pixel inset: map [0,1] → [0.5/N, 1-0.5/N] so samples land on
// texel centers (avoids bleeding from neighboring cells at edges).
float pixelWidth = 1.0 / u_lutSize;
float halfPixel  = 0.5 / u_lutSize;
vec3 uvw = vec3(halfPixel) + src.rgb * (1.0 - pixelWidth);
vec3 graded = texture(u_lut3D, uvw).rgb;
outColor = vec4(mix(src.rgb, graded, u_intensity), src.a);
```

The **half-pixel inset** is critical: without it, `src.rgb = 0.0` or
`1.0` would sample at the LUT edge, which (with `LINEAR` filtering)
bleeds into the wrap-around neighbor. The inset maps the input `[0,1]`
range to the interior `[0.5/N, 1−0.5/N]`, centering each sample within
its texel.

#### Shader: `LUT_2D_STRIP_FRAG` (2D strip path)

```glsl
// The 2D strip is a horizontal layout of N slices, each N×N pixels.
// Total texture size: (N*N) × N. B channel selects the slice;
// R/G select the position within the slice. Two neighboring slices
// are sampled and linearly interpolated by the B fractional part.
float slice  = clamp(src.b, 0.0, 1.0) * (u_lutSize - 1.0);
float sliceF = floor(slice);
float sliceT = fract(slice);
// ... compute uv0 (sliceF) and uv1 (sliceF+1) ...
vec3 c0 = texture(u_lut2D, uv0).rgb;
vec3 c1 = texture(u_lut2D, uv1).rgb;
vec3 graded = mix(c0, c1, sliceT);
outColor = vec4(mix(src.rgb, graded, u_intensity), src.a);
```

The 2D strip path performs **trilinear interpolation manually** (two
bilinear samples + one linear blend) because `sampler2D` cannot do 3D
interpolation natively. This is why the 3D path is preferred when
available — `sampler3D` does trilinear in hardware.

#### Texture resolution (`_resolveLut`)

The `lut` field accepts three types, resolved in priority order:

| Input type | Detection | Resolution |
|------------|-----------|------------|
| `WebGLTexture` | Not a VREEN `Texture` (no `uuid`/`glTexture`) | Used directly. |
| VREEN `Texture` (uploaded) | Has `uuid` + `glTexture` | `renderer.getGLTexture(tex)` if available, else `tex.glTexture` fallback. |
| VREEN `Texture` (not yet uploaded) | Has `uuid`, `glTexture === null` | `renderer.getGLTexture(tex)` triggers lazy upload. |
| `null` | — | Passthrough: `apply()` returns `input` immediately, 0 draw calls. |

#### Usage

**Basic — 3D LUT from `.cube` file:**

```ts
import { LUTCubeLoader } from '@/engine/Loaders/LUTCubeLoader';
import { LUTPass } from '@vreen/engine';

const loader = new LUTCubeLoader();
const lut3D = loader.parse(cubeText).toData3DTexture();
const pass = new LUTPass({ lut: lut3D, lutSize: 32, is3D: true, intensity: 0.8 });
pipeline.add(pass);
```

**Runtime intensity tween (time-of-day color grading):**

```ts
const pass = new LUTPass({ lut: dayLUT, lutSize: 32, enabled: true });
pipeline.add(pass);

// Each frame: blend from day (0) to night (1) LUT
function update(dayFactor: number) {
  pass.intensity = 1.0 - dayFactor;  // day: intensity=1 (full day LUT)
  if (dayFactor < 0.5) {
    pass.lut = dayLUT;
    pass.intensity = 1.0 - dayFactor * 2;  // 1→0 as dayFactor goes 0→0.5
  } else {
    pass.lut = nightLUT;
    pass.intensity = (dayFactor - 0.5) * 2;  // 0→1 as dayFactor goes 0.5→1
  }
}
```

**2D strip LUT (for DCC-exported strip textures):**

```ts
const stripTex = await textureLoader.load('lut_strip_16.png');
const pass = new LUTPass({
  lut: stripTex,
  lutSize: 16,      // 16×16 slices × 16 rows = 256×16 strip
  is3D: false,
  intensity: 1.0,
});
```

**Passthrough (disable grading without removing pass):**

```ts
const pass = new LUTPass({ lut: myLUT, enabled: true });
pipeline.add(pass);

// Later: temporarily disable grading
pass.lut = null;  // apply() returns input, 0 draw calls
// Re-enable:
pass.lut = myLUT;
```

#### End-to-end `.cube` workflow

```
.cube file (text)                    VREEN engine
┌────────────────┐                   ┌──────────────────────────┐
│ TITLE "..."    │   LUTCubeLoader   │ 1. fetch('/grade.cube')  │
│ LUT_3D_SIZE 32 │   .parse(text)    │ 2. loader.parse(text)    │
│ 0.0 0.0 0.0    │ ────────────────▶ │ 3. .toData3DTexture()    │
│ ...            │                   │ 4. new LUTPass({lut,...}) │
│ 1.0 1.0 1.0    │                   │ 5. pipeline.add(pass)    │
└────────────────┘                   └──────────────────────────┘
                                             │
                                             ▼
                                     ┌───────────────┐
                                     │ Graded frame  │
                                     │ (finalTexture)│
                                     └───────────────┘
```

`LUTCubeLoader` parses the Adobe Cube LUT 1.0 spec (1D or 3D, with
`DOMAIN_MIN`/`DOMAIN_MAX` and `TITLE` metadata), then `toData3DTexture()`
packages the data as a VREEN `Texture` ready for `LUTPass` upload. No
manual `gl.texImage3D` calls required.

#### Test coverage (`LUTPass.test.ts`, 23 tests)

- **Construction** (3): defaults, custom options, explicit `null` lut.
- **3D LUT apply** (3): no-throw, 1 draw call, returns `finalTexture`.
- **2D strip LUT apply** (3): no-throw, 1 draw call, returns `finalTexture`.
- **Null LUT passthrough** (3): returns input directly, 0 draw calls,
  no `finalFbo` binding side effects.
- **VREEN Texture resolution** (3): `renderer.getGLTexture()` path,
  `glTexture` fallback, lazy-upload via renderer.
- **Intensity & lutSize** (2): `intensity=0` still draws (shader mix),
  multiple `lutSize` values (2/8/16/32/64) without error.
- **Multiple apply()** (3): 10× repeated 3D, 10× repeated 2D strip,
  lut switching between calls (3D → 3D → null passthrough).
- **dispose()** (2): noop, idempotent (3× calls).
- **Name** (1): stable `"lut"` across instances.

#### Comparison with soup3D

`soup3D` has **no LUT color grading** — frames are rendered with
fixed shader color math and cannot be re-graded at runtime without
recompiling shaders. VREEN's `LUTPass` + `LUTCubeLoader` provide a
complete industry-standard color grading pipeline:

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Runtime LUT color grading | **None** | `LUTPass` (3D + 2D strip) |
| `.cube` file parsing | **None** | `LUTCubeLoader` (Adobe Cube LUT 1.0) |
| 3D `sampler3D` path | **None** | Hardware trilinear via `TEXTURE_3D` |
| 2D strip fallback | **None** | Manual trilinear (2 bilinear + blend) |
| Intensity blending | **None** | `mix(src, graded, intensity)` per-pixel |
| Passthrough (null LUT) | **None** | 0 draw calls, returns input |
| Time-of-day grading | **None** | Runtime `lut` + `intensity` tweening |
| Half-pixel inset | **None** | Texel-center sampling (no edge bleed) |

**Where VREEN pulls ahead.** Color grading is a **post-production
essential** — every film, every AAA game, every DCC tool (DaVinci
Resolve, Nuke, Photoshop) uses LUTs to establish visual mood. soup3D
has no path to this workflow. VREEN's `LUTPass` lets artists author a
grade in DaVinci, export a `.cube` file, and apply it in-engine with
two lines of code. The 3D `sampler3D` path gives hardware-accelerated
trilinear interpolation for free; the 2D strip path supports legacy
strip textures from DCC exports. The `intensity` uniform enables
runtime blending between multiple grades (day → night, healthy →
damaged, normal → nightmare) without shader recompilation.

#### Design Notes

**Why 3D is preferred over 2D strip.** A 3D LUT uses `sampler3D` +
`TEXTURE_3D`, which gives hardware trilinear interpolation — the GPU
blends across all 3 axes (R, G, B) in a single `texture()` call. A 2D
strip LUT stores the same data in a flat 2D texture (N slices of N×N
arranged horizontally), but `sampler2D` cannot do 3D interpolation
natively, so the shader must manually sample two neighboring slices
and blend by the B fractional part. This doubles the texture fetches
and adds ALU overhead. The 2D strip path exists for compatibility
with asset pipelines that pre-bake strip textures (e.g. Photoshop
export), but the 3D path is always preferred when the LUT data is
available as a flat array.

**Why the half-pixel inset.** A 3D LUT of size N maps the input
`[0, 1]` range to N discrete texels. With `LINEAR` filtering, sampling
at exactly `0.0` or `1.0` would place the sample on the texel edge,
causing the GPU to blend with the wrap-around neighbor (or clamp,
depending on `TEXTURE_WRAP`). The half-pixel inset
`uvw = 0.5/N + src.rgb * (1 - 1/N)` maps `[0,1]` to the interior
`[0.5/N, 1−0.5/N]`, centering each sample within its texel. This is
standard practice in every production LUT shader (three.js, Unreal,
o3de all do the same).

**Why `null` LUT is a true passthrough.** When `lut === null`, the
`apply()` method returns the input texture immediately without
binding the framebuffer or issuing a draw call. This means a
disabled LUTPass costs zero GPU time — not even a blit. This is
important for pipelines that wire the pass once and toggle it at
runtime (e.g. a "color grade" checkbox in a settings menu).

**Why `renderer.getGLTexture()` over direct `glTexture` access.** A
VREEN `Texture` may not yet be uploaded to the GPU when the LUTPass is
constructed (e.g. the LUT data was loaded asynchronously). The
`_resolveLut` method calls `renderer.getGLTexture(tex)` first, which
triggers a lazy upload if needed. The `tex.glTexture` fallback exists
for cases where the renderer doesn't expose `getGLTexture` (e.g. in
unit tests with a mock renderer), but in production the renderer path
ensures the texture is always uploaded before sampling.

---

### ChromaticAberrationPass (Enhanced)

Enhanced chromatic aberration with `Vector2` direction offset and radial
modulation by distance from screen center.

**Class**: `ChromaticAberrationPass extends RenderPass`
**Shader**: `chromatic-aberration-enhanced`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `offset` | `[number, number]` | `[0.002, 0.002]` | R/B channel offset (x, y) |
| `radialMod` | `number` | `1` | Radial intensity multiplier (0..2) |
| `center` | `[number, number]` | `[0.5, 0.5]` | Effect center in UV space |
| `enabled` | `boolean` | `false` | Enable toggle |

> **Note**: A basic `ChromaticAberrationPass` also exists in `RenderPass.ts`
> with a simpler `float offset` option. The barrel exports the enhanced version.

---

### VignettePass (Enhanced)

Enhanced vignette with `offset`, `darkness`, and color tint.

**Class**: `VignettePass extends RenderPass`
**Shader**: `vignette-enhanced`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `offset` | `number` | `1.0` | Vignette center offset (0..2) |
| `darkness` | `number` | `1.0` | Vignette darkness (0..2) |
| `tint` | `[number, number, number]` | `[0, 0, 0]` | Tint color (RGB 0..1) |
| `enabled` | `boolean` | `false` | Enable toggle |

---

### FilmGrainPass

Film grain effect with configurable strength, size, and animation.

**Class**: `FilmGrainPass extends RenderPass`
**Shader**: `film-grain`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strength` | `number` | `0.15` | Grain intensity (0..1) |
| `size` | `number` | `1.0` | Grain particle size |
| `animated` | `boolean` | `true` | Animate over time |
| `enabled` | `boolean` | `false` | Enable toggle |

---

### AfterimagePass

Cross-frame accumulation for motion-trail / afterimage effects.

**Class**: `AfterimagePass extends RenderPass`
**Shader**: `afterimage`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `damp` | `number` | `0.96` | Accumulation factor (0..1, higher = longer trail) |
| `enabled` | `boolean` | `false` | Enable toggle |

#### Implementation

Maintains a persistent history texture. Each frame:
`output = input + history * damp`. The history texture is updated with
the output for the next frame.

---

### PixelationPass

Pixelation / mosaic effect.

**Class**: `PixelationPass extends RenderPass`
**Shader**: `pixelation`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pixelSize` | `number` | `8` | Pixel block size (1 = no effect) |
| `enabled` | `boolean` | `false` | Enable toggle |

---

### SSRPass

Screen-space reflections — ray-marches the GBuffer position/normal buffers to
find reflection intersections. **Upgraded** with temporal jitter, adaptive
step size, view-space thickness rejection, and roughness-modulated blur —
surpassing soup3D (which has no SSR).

**Class**: `SSRPass` (independent, does **not** extend `RenderPass`)
**Shader**: `SSR_FRAG` (ray march + binary refine)

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSteps` | `number` | `64` | Ray march step count (shader cap 64) |
| `thickness` | `number` | `0.5` | Thickness tolerance (world units) — too small = missed hits, too large = false hits |
| `resolution` | `number` | `0.5` | Resolution scale (1 = full res, 0.5 = half res recommended) |
| `reflectionStrength` | `number` | `0.5` | Reflection intensity (0..1+, >1 needs downstream ToneMap) |
| `roughnessCutoff` | `number` | `0.6` | Skip SSR on pixels with roughness > cutoff (diffuse surfaces) |
| `jitterScale` | `number` | `1.0` | Temporal jitter amplitude (0 = off, pairs with TAA) |
| `stepGrowth` | `number` | `0.5` | Adaptive step growth factor (0 = uniform, 1.0 = doubling) |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  positionTexture: WebGLTexture,   // GBuffer world position (RGBA16F)
  normalTexture: WebGLTexture,     // GBuffer world normal (RGBA16F)
  camera: Camera,
  roughnessTexture?: WebGLTexture | null,  // optional GBuffer roughness (R channel)
): WebGLTexture
```

#### Algorithm (4-stage pipeline)

| Stage | Description |
|-------|-------------|
| ① Early-out | Skip sky (no normal), back-facing (`dot(view, N) ≤ 0`), or rough surfaces (`roughness > cutoff`). |
| ② Adaptive ray march | Reflect view dir about normal; march with **linearly growing step** (near = small for precision, far = large for speed) + **Interleaved Gradient Noise jitter** (per-pixel × per-frame, temporal via `frame` counter). View-space depth test: `depthDiff = viewDepth(ray) − viewDepth(sampled)`; hit when `0 < depthDiff < thickness`. |
| ③ Binary refine | 8-step bisection collapses error to `thickness/256`. |
| ④ Roughness-modulated composite | Sharp reflection for `roughness < 0.2`; 4-neighbor blur scaled by `roughness × 3.5` for rough surfaces. Strength = `reflectionStrength × edgeFade × (0.5 + 0.5·Fresnel) × (1 − smoothstep(0, cutoff, roughness))`. |

#### soup3D Feature Parity

`soup3D` has **no SSR**. VREEN SSR delivers:

- **Temporal jitter** (IGN + frame counter) — banding-free with TAA, vs
  static march acne.
- **Adaptive step** — small near-camera steps for precision, large far
  steps for coverage; uniform-step wastes budget near or far.
- **View-space thickness** — correct regardless of world orientation;
  world-Z thickness is axis-dependent and wrong for tilted scenes.
- **Roughness modulation** — rough surfaces get blurred + dimmed
  reflections (physically correct), not mirror-sharp everywhere.

---

### VolumetricFogPass

Volumetric fog and light shafts using depth-buffer ray-marching.

**Class**: `VolumetricFogPass` (independent)
**Shader**: `VOLUMETRIC_FOG_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fogColor` | `[number, number, number]` | `[0.5, 0.6, 0.7]` | Fog color |
| `fogDensity` | `number` | `0.02` | Fog density |
| `fogStart` | `number` | `0` | Near fog start distance |
| `fogEnd` | `number` | `100` | Far fog end distance |
| `lightDirection` | `[number, number, number]` | `[0, 1, 0]` | Light direction for shafts |
| `lightIntensity` | `number` | `1.0` | Light shaft intensity |
| `resolution` | `[number, number]` | `[1, 1]` | Resolution scale |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  depthTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

---

### VelocityPass

Per-pixel motion vectors for TAA and motion blur. Outputs a velocity texture
where R = X motion, G = Y motion (in UV space).

**Class**: `VelocityPass` (independent)
**Shader**: `VELOCITY_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `resolution` | `[number, number]` | `[1, 1]` | Resolution scale |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  depthTexture: WebGLTexture,
  prevViewProjectionMatrix: Matrix4,
  viewProjectionMatrix: Matrix4,
): WebGLTexture
```

#### Algorithm

Reconstructs world position from depth, projects with both previous and
current view-projection matrices, and outputs the screen-space delta.

---

### TAAPass

Temporal anti-aliasing using Halton jitter + neighborhood clamping +
history blending.

**Class**: `TAAPass` (independent)
**Shaders**: `TAA_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `blendFactor` | `number` | `0.1` | History blend factor (0..1, lower = more stable) |
| `jitterScale` | `number` | `1.0` | Jitter amplitude in pixels |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  currentColorTexture: WebGLTexture,
  velocityTexture: WebGLTexture,
): WebGLTexture
```

#### Algorithm

1. Generate Halton(2,3) jitter sequence (16 samples).
2. Apply jitter to camera projection matrix each frame.
3. Reproject previous frame using velocity buffer.
4. Neighborhood clamp (AABB in YCoCg space).
5. Blend: `output = lerp(history, current, blendFactor)`.

---

### MotionBlurPass

Camera and object motion blur using the velocity buffer.

**Class**: `MotionBlurPass` (independent)
**Shader**: `MOTION_BLUR_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strength` | `number` | `1.0` | Blur intensity |
| `maxSamples` | `number` | `16` | Maximum samples per pixel |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  velocityTexture: WebGLTexture,
): WebGLTexture
```

---

### AutoExposurePass

Auto-exposure (eye adaptation) — computes average luminance and adapts
exposure over time.

**Class**: `AutoExposurePass` (independent)
**Shaders**: `AUTO_EXPOSURE_LUM_FRAG`, `AUTO_EXPOSURE_APPLY_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `adaptationSpeed` | `number` | `1.0` | Adaptation speed (higher = faster) |
| `minExposure` | `number` | `0.1` | Minimum exposure value (EV) |
| `maxExposure` | `number` | `10.0` | Maximum exposure value (EV) |
| `initialExposure` | `number` | `1.0` | Initial exposure value |
| `key` | `number` | `0.18` | Middle gray key value |

#### API

```ts
apply(gl: WebGL2RenderingContext, inputTexture: WebGLTexture): WebGLTexture
```

#### Algorithm

1. Downsample input to 1×1 (log-luminance space).
2. Read previous frame's 1×1 log-luminance.
3. Exponentially adapt: `current += (target - current) * speed * dt`.
4. Apply exposure: `output = input * exp2(currentExposure)`.

---

### GTAOPass

Ground-truth ambient occlusion — hemisphere horizon integration.

**Class**: `GTAOPass` (independent)
**Shader**: `GTAO_FRAG` + `GTAO_BLUR_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `radius` | `number` | `0.5` | Sampling radius in world space |
| `bias` | `number` | `0.1` | Depth bias to prevent self-occlusion |
| `power` | `number` | `1.5` | AO power exponent |
| `samples` | `number` | `4` | Samples per direction (4 directions × N samples) |
| `resolution` | `[number, number]` | `[1, 1]` | Resolution scale |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  depthTexture: WebGLTexture,
  normalTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

#### Algorithm

Based on "Practical Real-Time Strategies for Accurate Indirect Occlusion"
by Jorge Jimenez et al. (2020). Implements the horizon-angle integration
with 4 slicing directions and bilateral depth-aware blur.

---

### SSSSPass

Screen-space subsurface scattering — separable Gaussian blur with
depth-aware weighting.

**Class**: `SSSSPass` (independent)
**Shader**: `SSSS_BLUR_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strength` | `number` | `1.0` | Blur strength |
| `falloff` | `number` | `1.0` | Depth falloff |
| `subsurfaceColor` | `[number, number, number]` | `[1, 1, 1]` | Subsurface tint |
| `maxSamples` | `number` | `17` | Kernel size (must be odd) |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  depthTexture: WebGLTexture,
): WebGLTexture
```

#### Algorithm

Based on Jimenez 2012 "Separable Subsurface Scattering". Two-pass
separable Gaussian: horizontal then vertical. Depth-aware weighting
prevents bleeding across depth discontinuities.

---

### DOFEnhancedPass

Enhanced depth-of-field with circle-of-confusion and configurable
bokeh shape (circle / hexagon / octagon).

**Class**: `DOFEnhancedPass` (independent)
**Shader**: `DOF_ENHANCED`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `focusDistance` | `number` | `10` | Focus distance in world units |
| `focusRange` | `number` | `5` | Focus range (DoF near/far) |
| `bokehSize` | `number` | `1.0` | Bokeh size multiplier |
| `bokehShape` | `number` | `0` | 0=circle, 1=hexagon, 2=octagon |
| `resolution` | `[number, number]` | `[1, 1]` | Resolution scale |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  depthTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

#### Algorithm

1. Compute circle-of-confusion (CoC) from depth and focus parameters.
2. Scatter-gather bokeh samples in the chosen shape pattern.
3. Blend near and far DoF based on CoC.

---

### GlitchPass

Digital glitch effect — RGB shift + band distortion + snow noise.
Adapted from three.js `GlitchPass.js` / `DigitalGlitch.js`.

**Class**: `GlitchPass extends RenderPass`
**Shader**: `GLITCH_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `goWild` | `boolean` | `false` | Continuous glitch (vs. random trigger) |
| `enabled` | `boolean` | `false` | Enable toggle |

#### Behavior

When `goWild` is `false`, the glitch triggers randomly every 120-240
frames. When `true`, the glitch is continuous. The effect combines:
- RGB channel displacement (horizontal shift)
- Horizontal band distortion (random Y bands)
- Snow noise (random per-pixel color)

---

### SMAAPass

Subpixel Morphological Antialiasing — 3-pass pipeline with procedurally
generated area/search LUT textures.

**Class**: `SMAAPass extends RenderPass`
**Shaders**: `SMAA_EDGES_FRAG`, `SMAA_WEIGHTS_FRAG`, `SMAA_BLEND_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable toggle |

#### 3-Pass Pipeline

| Pass | Output | Description |
|------|--------|-------------|
| 1. Edge Detection | edges RG | Color edge detection with local contrast adaptation |
| 2. Blending Weights | weights RGBA | 4-direction search + area LUT lookup |
| 3. Neighborhood Blending | final color | 4-neighbor weighted blend with gamma correction |

#### LUT Textures (Procedurally Generated)

| Texture | Size | Format | Description |
|---------|------|--------|-------------|
| Area LUT | 160×560 | RG8 | Area under line for each (e1, e2, d1, d2) |
| Search LUT | 66×33 | R8 | Search termination length for bias × edge |

Both LUTs are generated at runtime via numerical integration — no DOM
Image element dependency. Works in both browser and Node.js (test) environments.

#### API

```ts
apply(input: WebGLTexture, ctx: PassContext): WebGLTexture
```

---

### UnrealBloomPass

Mip-chain Gaussian Bloom in Unreal Engine 4 / three.js style — **5-level
downsampling pyramid** with per-level separable Gaussian, soft-knee
luminosity threshold, weighted composite with per-mip tint, and
optional lens-dirt scattering. Direct replacement for the legacy
`BloomPass` (single-level box blur).

**Class**: `UnrealBloomPass extends RenderPass`
**Shaders**: `BLOOM_HIGHPASS_FRAG`, `BLOOM_GAUSSIAN_FRAG` (×5 kernel sizes), `BLOOM_COMPOSITE_FRAG`, `BLOOM_ADDITIVE_BLEND_FRAG`

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable toggle |
| `strength` | `number` | `1.0` | Global bloom intensity multiplier (3× internal base for three.js compat) |
| `radius` | `number[0,1]` | `0.5` | Mip-weight interpolation: 0 = sharp fine mips only, 1 = soft coarse mips dominant |
| `threshold` | `number` | `0.85` | Luminosity threshold (linear). Pixels below contribute 0 bloom |
| `smoothWidth` | `number` | `0.01` | Knee soft-width relative to threshold. Soft rolloff, hard-edge-free highlights |
| `mipFactors` | `[5]number` | `[1, .8, .6, .4, .2]` | Per-mip weight from finest (0) to coarsest (4) |
| `mipTints` | `[5][3]number` | all white | Per-mip RGB tint — e.g. cool neon tint on small highlights |
| `dirtTexture` | `WebGLTexture \| null` | `null` | Optional lens-dirt / dust texture (multiplies bloom locally) |
| `dirtStrength` | `number` | `0` | Dirt overlay strength, 0.3~1.0 for cinematic look |

#### 4-Stage Pipeline

| Stage | Target | Description | FS Draw Count |
|-------|--------|-------------|---------------|
| 1. High-Pass | bright (½ res) | Luminance knee curve → extract bright pixels | 1 |
| 2. Separable Gaussian ×5 mips | `hTargets[i]` → `vTargets[i]` | H then V, kernel sizes `[6,10,14,18,22]` σ=R/3 | 10 |
| 3. Composite + Dirt | `hTargets[0]` | `Σ lerpBloomFactor(fᵢ)·tintᵢ·texᵢ + dirt·bloom` | 1 |
| 4. Additive Blend | `ctx.resources.bloomTexture2` | `input + bloom·strength` (preserves α for TAA) | 1 |

**Total per frame**: 13 fullscreen draws @ ½ res or smaller → ~3–5× cheaper than single-res wide-kernel blur.

#### Internal FBO Layout

All FBOs `RGBA16F HALF_FLOAT` (HDR linear) + `CLAMP_TO_EDGE + LINEAR`.
Lazily created on first `apply()` and resized when `ctx.width/height` changes.

| Name | Count | Size | Purpose |
|------|-------|------|---------|
| `bright` | 1 | W/2 × H/2 | Post-high-pass input to blur chain |
| `mips[0..4].texH / .texV` | 10 | W/2…W/64 × H/2…H/64 | Ping-pong per mip level |
| `_blackTex` | 1 | 1×1, R8 | Null dirt texture when dirtTexture is null |

#### API

```ts
// Constructor options
const bloom = new UnrealBloomPass({
  strength: 1.2,
  radius: 0.6,
  threshold: 0.8,
  smoothWidth: 0.01,
  mipTints: [
    [1, 0.9, 0.8],  // warm tint for fine highlights (neon edges)
    [1, 1, 1],
    [0.8, 0.9, 1.1], // cool tint for wide sky / area bloom
    [1, 1, 1],
    [1, 1, 1],
  ],
  dirtTexture: myDirtTexture,
  dirtStrength: 0.4,
});

pipeline.add(bloom);        // RenderPass-compatible: drops in directly

apply(input: WebGLTexture, ctx: PassContext): WebGLTexture
dispose(ctx: PassContext): void
```

#### soup3D Feature Parity — Why It Wins

`soup3D` (as of v0.x) exposes only one simple `Bloom` slider with a single
separable blur. The VREEN `UnrealBloomPass` introduces:

- **Mip pyramid** — preserves both sharp neon-edge highlights *and*
  soft area bloom (sky, big emissive panels).
- **Per-mip tint** — color-grades each bloom scale, producing UE4-style
  "warm sparkles + cool halo" signatures.
- **Lens dirt** — cinematic dust/glare that ties HDR highlights to the
  physical camera metaphor.
- **TAA-safe** — additive only, α untouched, linear-space math
  composes cleanly before tone-mapping.

---

## Pipeline Integration

### Basic Pipeline (RenderPass-compatible passes only)

```ts
import { ColorGradingPass, LUTPass, FilmGrainPass, VignettePass } from './PostProcess';

const pipeline = new PostProcessingPipeline(renderer);
pipeline.add(new ColorGradingPass({ saturation: 1.2, contrast: 1.1 }));
pipeline.add(new LUTPass({ lut: cinematicLUT, lutSize: 33, is3D: true }));
pipeline.add(new VignettePass({ darkness: 1.2 }));
pipeline.add(new FilmGrainPass({ strength: 0.1 }));
```

### Advanced Pipeline (with GBuffer-dependent passes)

```ts
// 1. Velocity pass (needs depth + matrices)
const velocityTex = velocityPass.apply(gl, depthTex, prevVP, currVP);

// 2. TAA (needs color + velocity)
const taaTex = taaPass.apply(gl, colorTex, velocityTex);

// 3. Auto-exposure (needs color)
const exposedTex = autoExposurePass.apply(gl, taaTex);

// 4. GTAO (needs depth + normal)
const aoTex = gtaoPass.apply(gl, depthTex, normalTex, camera);

// 5. Composite AO into color
// 6. SSR (needs color + position + normal)
const ssrTex = ssrPass.apply(gl, exposedTex, positionTex, normalTex, camera);

// 7. Motion blur (needs color + velocity)
const motionBlurTex = motionBlurPass.apply(gl, ssrTex, velocityTex);

// 8. DOF (needs color + depth)
const dofTex = dofPass.apply(gl, motionBlurTex, depthTex, camera);

// 9. Final stylized passes
pipeline.add(new ColorGradingPass());
pipeline.add(new SMAAPass());
```

---

## Resource Management

Each pass lazily allocates GPU resources on the first `apply()` call and
rebuilds them when the canvas size changes. All passes implement
`dispose()` for cleanup:

```ts
// When removing a pass from the pipeline:
pass.dispose(ctx);
```

### Resource Summary

| Pass | FBOs | Textures | Programs |
|------|------|----------|----------|
| ColorGradingPass | 0 (uses ctx.resources) | 0 | 1 |
| LUTPass | 0 | 0 | 1 |
| ChromaticAberrationPass | 0 | 0 | 1 |
| VignettePass | 0 | 0 | 1 |
| FilmGrainPass | 0 | 0 | 1 |
| AfterimagePass | 1 (history) | 1 (history) | 1 |
| PixelationPass | 0 | 0 | 1 |
| SSRPass | 2 (output + blur) | 2 | 2 |
| VolumetricFogPass | 1 | 1 | 1 |
| VelocityPass | 1 | 1 | 1 |
| TAAPass | 1 (history) | 1 (history) | 1 |
| MotionBlurPass | 1 | 1 | 1 |
| AutoExposurePass | 2 (1×1 + output) | 2 (1×1 + output) | 2 |
| GTAOPass | 2 (AO + blur) | 2 | 2 |
| SSSSPass | 2 (H + V) | 2 | 1 |
| DOFEnhancedPass | 1 | 1 | 1 |
| GlitchPass | 0 | 1 (noise) | 1 |
| SMAAPass | 2 (edges + weights) | 4 (edges + weights + area LUT + search LUT) | 3 |

---

## Testing

Each pass has a dedicated test file (`.test.ts`) using a mock WebGL2
context. Tests verify:

- Construction with default and custom options
- `apply()` does not throw in mock GL
- Correct number of draw calls per pass
- Resource allocation and disposal
- Resize handling
- Re-apply after dispose

```bash
# Run all PostProcess tests
npx vitest run src/engine/Renderer/PostProcess/
```

---

## References

| Technique | Paper / Source |
|-----------|---------------|
| SMAA | Jimenez et al., "SMAA: Enhanced Subpixel Morphological Antialiasing" (2012) |
| GTAO | Jimenez et al., "Practical Real-Time Strategies for Accurate Indirect Occlusion" (2020) |
| SSSS | Jimenez et al., "Separable Subsurface Scattering" (2012) |
| TAA | Jimenez et al., "Temporal Supersampling" (2012) |
| SSR | Sousa et al., "CRYENGINE Manual" (2013) |
| LUT | Adobe, "Cube LUT Specification 1.0" |
| Volumetric Fog | Wronski, "GDC 2015: Volumetric Fog" |
