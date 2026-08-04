# PostProcess Module

> Path: `src/engine/Renderer/PostProcess/`
>
> The enhanced post-processing pass family of the VREEN engine. Provides **27**
> passes covering color grading, anti-aliasing, screen-space effects, depth-of-field,
> motion blur, exposure adaptation, atmospheric effects, water rendering, light shafts, sharpening, upscaling, and stylized effects.
> Each pass is a self-contained class that manages its own GPU resources (FBOs,
> textures, shader programs) and integrates into the `PostProcessingPipeline`.

---

## Architecture

```
PostProcess/
  ├── RenderPass-compatible (9 passes)        ← drop-in pipeline passes
  │     ├── ColorGradingPass
  │     ├── LUTPass
  │     ├── TonemappingPass
  │     ├── SharpenPass       ← CAS (after TAA, restores detail)
  │     ├── ChromaticAberrationPass (enhanced)
  │     ├── VignettePass (enhanced)
  │     ├── FilmGrainPass
  │     ├── AfterimagePass
  │     └── PixelationPass
  │
  ├── GBuffer-dependent (20 passes)           ← independent FBO/program
  │     ├── SSRPass          ← needs position + normal
  │     ├── SSSRPass         ← needs position + normal + roughness (GGX importance-sampled)
  │     ├── SSGIPass         ← needs position + normal + color
  │     ├── ScreenSpaceShadowPass ← needs depth + light direction
  │     ├── VolumetricFogPass ← needs depth
  │     ├── HeightFogPass    ← needs depth (UE5 exponential height fog)
  │     ├── VolumetricCloudsPass ← needs depth + 3D noise texture (GPU ray-marched)
  │     ├── CausticsPass     ← needs depth (underwater procedural caustics)
  │     ├── WaterSurfacePass ← needs depth (screen-space planar water, Gerstner + Fresnel)
  │     ├── GodRaysPass      ← needs depth (screen-space volumetric light shafts)
  │     ├── ScreenSpaceLensFlarePass ← needs depth (ghosts + halo + starburst + chromatic)
  │     ├── VelocityPass     ← needs depth + matrices
  │     ├── TAAPass          ← needs color + velocity
  │     ├── MotionBlurPass   ← needs color + velocity
  │     ├── AutoExposurePass ← needs color (luminance)
  │     ├── GTAOPass         ← needs depth + normal
  │     ├── SSSSPass         ← needs color + depth
  │     ├── DOFEnhancedPass  ← needs color + depth
  │     ├── GlitchPass       ← needs color (stylized)
  │     ├── SMAAPass         ← needs color (3-pass AA)
  │     └── FSRUpscalePass   ← needs color (low→high res, independent FBO)
  │
  └── index.ts               ← barrel exports
```

### Two Integration Patterns

**Pattern 1: `RenderPass`-compatible** — These 9 passes extend `RenderPass`
and accept `(input: WebGLTexture, ctx: PassContext)`. They can be added
directly to a `PostProcessingPipeline`:

```ts
pipeline.add(new ColorGradingPass({ saturation: 1.2 }));
pipeline.add(new LUTPass({ lut: myLUTTexture, lutSize: 32, is3D: true }));
```

**Pattern 2: GBuffer-dependent** — These 20 passes have custom `apply()`
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
step size, view-space thickness rejection, roughness-modulated composite,
and a **separable Gaussian rough-reflection spatial filter** (H+V 9-tap,
edge-aware) — surpassing soup3D (which has no SSR).

**Class**: `SSRPass` (independent, does **not** extend `RenderPass`)
**Shaders**: `SSR_FRAG` (ray march + binary refine) + `SSR_BLUR_FRAG`
(separable Gaussian rough-reflection blur)

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
| `blurEnabled` | `boolean` | `true` | Enable separable Gaussian rough-reflection spatial filter (H+V). Requires `roughnessTexture` to actually run; otherwise skipped. |
| `blurRadiusScale` | `number` | `4.0` | Max blur radius in texels for rough surfaces. Higher = more blurred rough reflections. |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  positionTexture: WebGLTexture,   // GBuffer world position (RGBA16F)
  normalTexture: WebGLTexture,     // GBuffer world normal (RGBA16F)
  camera: Camera,
  roughnessTexture?: WebGLTexture | null,  // optional GBuffer roughness (R channel)
): WebGLTexture  // returns blur V texture when blur enabled + roughness provided; otherwise SSR main texture
```

#### Algorithm (5-stage pipeline)

| Stage | Description |
|-------|-------------|
| ① Early-out | Skip sky (no normal), back-facing (`dot(view, N) ≤ 0`), or rough surfaces (`roughness > cutoff`). |
| ② Adaptive ray march | Reflect view dir about normal; march with **linearly growing step** (near = small for precision, far = large for speed) + **Interleaved Gradient Noise jitter** (per-pixel × per-frame, temporal via `frame` counter). View-space depth test: `depthDiff = viewDepth(ray) − viewDepth(sampled)`; hit when `0 < depthDiff < thickness`. |
| ③ Binary refine | 8-step bisection collapses error to `thickness/256`. |
| ④ Roughness-modulated composite | Sharp reflection for `roughness < 0.2`; 4-neighbor blur scaled by `roughness × 3.5` for rough surfaces. Strength = `reflectionStrength × edgeFade × (0.5 + 0.5·Fresnel) × (1 − smoothstep(0, cutoff, roughness))`. |
| ⑤ Spatial filter (optional) | **H+V separable 9-tap Gaussian** on the SSR output. Per-pixel blur radius = `(roughness − 0.2) / (cutoff − 0.2) × blurRadiusScale`. **Edge-aware**: neighbor weight = `step(0.85, dot(centerN, sampleN))` — prevents reflection leakage across geometry edges (e.g. wall → floor). Skipped for mirrors (`roughness < 0.2`), diffuse (`> cutoff`), and sky. |

#### Texture unit bindings

| Unit | Sampler | Stage(s) | Source |
|------|---------|----------|--------|
| 0 | `u_colorMap` | SSR + blur H/V | `inputTexture` → SSR → `_blurTexH` → `_blurTexV` |
| 1 | `u_positionMap` (SSR) / `u_normalMap` (blur) | SSR + blur | GBuffer position / normal |
| 2 | `u_normalMap` (SSR) | SSR | GBuffer world normal |
| 3 | `u_roughnessMap` | SSR + blur | GBuffer roughness (R channel) |

#### Resource layout

| Resource | Count | Allocated when | Format |
|----------|-------|----------------|--------|
| SSR FBO + texture | 1 + 1 | first `apply()` | RGBA16F |
| Blur H FBO + texture | 1 + 1 | `blurEnabled && roughnessTexture` provided | RGBA16F |
| Blur V FBO + texture | 1 + 1 | `blurEnabled && roughnessTexture` provided | RGBA16F |
| Fullscreen quad VAO + buffer | 1 + 1 | first `apply()` | vec2 pos + vec2 uv |
| SSR program | 1 | first `apply()` | `POST_VERT` + `SSR_FRAG` |
| Blur program | 1 | `blurEnabled && roughnessTexture` provided | `POST_VERT` + `SSR_BLUR_FRAG` |

When `blurEnabled=false` or no `roughnessTexture` is provided, only the SSR
main pass runs (1 texture, 1 FBO, 1 draw call). When blur is active, the
total is 3 textures + 3 FBOs + 2 programs + 3 draw calls per frame.

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
- **Separable Gaussian spatial filter** (new) — H+V 9-tap blur produces
  9×9 equivalent kernel at 18 samples (vs 81 for non-separable). Edge-
  aware filtering prevents reflection leakage across geometry boundaries.
  This matches the approach used by UE5's `ScreenSpaceReflections.usf`
  SpatialFilterPass and o3de Atom's RPI SSRBlurShader.

#### References

- EA SEED, "Stable SSR" GDC presentation
- McGuire & Mara, "Efficient GPU Screen-Space Ray Tracing" (2014) §4.3
- Jorge Jimenez, "Interleaved Gradient Noise" (2014) — temporal jitter
- o3de Atom RPI SSRBlurShader — separable rough-reflection blur
- UE5 `ScreenSpaceReflections.usf` — SpatialFilterPass reference

---

### SSSRPass

Stochastic Screen-Space Reflections — uses **GGX importance sampling** to
generate physically correct rough reflections. Each pixel samples a
half-vector from the GGX NDF (normal distribution function), reflects the
view direction about it, and ray-marches in screen space. Over multiple
frames, temporal accumulation converges to the correct blurry reflection
for rough surfaces.

**Surpasses soup3D** (which has no SSR of any kind — no stochastic SSR,
no GGX importance sampling, no temporal accumulation).

**Class**: `SSSRPass` (independent, does **not** extend `RenderPass`)
**Shader**: `SSSR_FRAG` (GGX importance-sampled ray generation + screen-space ray march + temporal reprojection)

#### SSR vs SSSR

| Feature | `SSRPass` | `SSSRPass` |
|---------|-----------|------------|
| Ray direction | Mirror `reflect(-V, N)` | GGX importance-sampled `reflect(-V, H)` |
| Rough reflections | H+V Gaussian blur (approximation) | Stochastic sampling + temporal accumulation (physical) |
| Temporal accumulation | No | Yes (velocity reprojection + history blend) |
| Fresnel | No | Yes (Schlick) |
| Confidence alpha | No | Yes (edge/distance/roughness fade) |
| Physical correctness | Fixed blur kernel, not physical | GGX NDF driven, physically correct |
| Performance | Fast (1 ray + blur) | Slower (1 ray + temporal) |
| Best for | Mirror / low roughness | Full roughness range, especially mid-roughness |

#### Algorithm (7-stage pipeline)

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ GBuffer     │───▶│ 1. Read position │───▶│ 2. Early-out    │
│ (pos/norm/  │    │ normal roughness │    │ sky / too rough │
│  rough/color)│   │ color            │    │ / backface     │
└─────────────┘    └──────────────────┘    └────────┬────────┘
                                                     │
                           ┌─────────────────────────▼──────────┐
                           │ 3. GGX importance sampling         │
                           │   α = roughness²                   │
                           │   φ = 2π·ξ₁                        │
                           │   cosθ = √((1-ξ₂)/(1+(α²-1)·ξ₂))  │
                           │   H = TBN·(sinθcosφ, sinθsinφ,cosθ)│
                           │   rayDir = reflect(-viewDir, H)    │
                           └─────────────────┬──────────────────┘
                                             │
                  ┌──────────────────────────▼──────────────────┐
                  │ 4. Screen-space ray march (adaptive step)   │
                  │    + binary search refinement (8 steps)     │
                  └─────────────────┬──────────────────────────┘
                                    │
                  ┌─────────────────▼──────────────────────────┐
                  │ 5. Attenuation                              │
                  │    edgeFade × distFade × Fresnel × roughFade│
                  └─────────────────┬──────────────────────────┘
                                    │
                  ┌─────────────────▼──────────────────────────┐
                  │ 6. Temporal accumulation                    │
                  │    velocity reprojection + history blend    │
                  │    (confidence-weighted mix)                │
                  └─────────────────┬──────────────────────────┘
                                    │
                  ┌─────────────────▼──────────────────────────┐
                  │ 7. Output RGBA16F                           │
                  │    RGB = reflection × strength × Fresnel    │
                  │    A   = confidence [0,1]                   │
                  └────────────────────────────────────────────┘
```

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSteps` | `number` | `64` | Max ray-march steps (shader cap 64) |
| `thickness` | `number` | `0.5` | Thickness tolerance (world units) |
| `resolution` | `number` | `0.5` | Resolution scale (1 = full, 0.5 = half res) |
| `reflectionStrength` | `number` | `0.5` | Reflection intensity (0..1+, >1 needs tonemap) |
| `roughnessCutoff` | `number` | `0.8` | Skip SSR for roughness > cutoff (wider than SSR's 0.6) |
| `roughnessBias` | `number` | `0.0` | Reduce effective roughness (Intel suggests 0.0~0.1) |
| `temporalWeight` | `number` | `0.88` | Temporal blend weight (0 = off, 0.9 = strong) |

#### API

```ts
class SSSRPass {
  constructor(opts?: SSSRPassOptions): SSSRPass;
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,       // scene color (reflection source)
    positionTexture: WebGLTexture,     // GBuffer world position (RGBA16F)
    normalTexture: WebGLTexture,       // GBuffer world normal (RGBA16F)
    camera: Camera,
    roughnessTexture?: WebGLTexture,   // GBuffer roughness (R channel); null = mirror
    velocityTexture?: WebGLTexture,    // pixel velocity (UV offset); null = no temporal
  ): WebGLTexture;                     // RGBA16F: RGB=reflection, A=confidence
  getHistoryTexture(): WebGLTexture | null;
  setDirty(): void;
  dispose(gl?: WebGL2RenderingContext): void;
}
```

#### CPU-testable helpers (exported)

| Export | Signature | Description |
|--------|-----------|-------------|
| `importanceSampleGGX` | `(xi: [number, number], N: Vec3, roughness: number) => Vec3` | GGX NDF inverse-CDF half-vector generation (mirrors GLSL `importanceSampleGGX`) |
| `schlickFresnel` | `(cosTheta: number, F0?: number) => number` | Schlick Fresnel approximation (clamps cosTheta to 0) |
| `reflectVec` | `(V: Vec3, H: Vec3) => Vec3` | Reflect direction `reflect(-V, H) = -V + 2·dot(V,H)·H` |
| `Vec3` | `{ x, y, z }` | Pure-data 3D vector (no Vector3 dependency for testability) |

#### Texture unit bindings

| Unit | Uniform | Texture |
|------|---------|---------|
| 0 | `u_colorMap` | Scene color (reflection source) |
| 1 | `u_positionMap` | GBuffer world position (RGBA16F) |
| 2 | `u_normalMap` | GBuffer world normal (RGBA16F) |
| 3 | `u_roughnessMap` | GBuffer roughness (R channel, optional) |
| 4 | `u_historyMap` | Previous frame accumulated reflection (RGBA16F, temporal) |
| 5 | `u_velocityMap` | Pixel velocity (UV offset, optional) |

#### Resource layout

| Resource | Count | Allocated on | Lifetime |
|----------|-------|-------------|----------|
| RGBA16F output texture | 1 | first `apply()` (or after resize) | until `dispose()` |
| RGBA16F history texture | 1 | first `apply()` | until `dispose()` (ping-pong via blit) |
| FBO (output) | 1 | first `apply()` | until `dispose()` |
| FBO (history) | 1 | first `apply()` | until `dispose()` |
| ShaderProgram | 1 | first `apply()` (lazy) | until `dispose()` |
| Fullscreen quad VAO+VBO | 1 | first `apply()` | until `dispose()` |

#### Usage

**Production SSSR with temporal accumulation (recommended):**

```ts
import { SSSRPass } from './PostProcess';

const sssr = new SSSRPass({
  resolution: 0.5,        // half-res for performance
  temporalWeight: 0.88,   // strong temporal accumulation
  maxSteps: 64,
  roughnessCutoff: 0.8,   // wider than SSR (0.6) for mid-roughness
});

// each frame (after GBuffer pass):
const reflTex = sssr.apply(
  gl,
  colorTexture,
  gBuffer.positionTexture,
  gBuffer.normalTexture,
  camera,
  gBuffer.materialTexture,  // roughness in R channel
  velocityTexture,           // from VelocityPass
);
// blend reflTex into scene by alpha (confidence):
// finalColor = mix(sceneColor, reflTex.rgb, reflTex.a);
```

**Single-frame SSSR (no temporal, noisier but no lag):**

```ts
const sssr = new SSSRPass({
  temporalWeight: 0.0,  // disable temporal
  resolution: 1.0,      // full-res to reduce noise
});
```

#### soup3D Feature Parity

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Stochastic SSR (GGX importance sampling) | **None** | `SSSRPass` — Intel SSSR / UE5 approach |
| Rough reflections (physical) | **None** | GGX NDF inverse-CDF ray generation |
| Temporal accumulation | **None** | velocity reprojection + history blend |
| Fresnel-weighted reflections | **None** | Schlick approximation |
| Confidence alpha for compositing | **None** | edge/distance/roughness attenuation |
| CPU-testable GGX math | **None** | `importanceSampleGGX` exported pure function |

#### Design Notes

- **Why GGX importance sampling instead of blur?** `SSRPass` generates a
  single mirror ray and blurs the result. The blur kernel is fixed-size
  and has no physical basis — a rough surface doesn't reflect a "blurred
  mirror image", it reflects light scattered over the specular lobe.
  `SSSRPass` generates rays that actually follow the GGX distribution,
  so the reflected image naturally converges to the correct blur as
  roughness increases. Over multiple frames, temporal accumulation
  averages enough samples to produce a clean, physically-correct result.

- **Why `roughnessBias`?** At very high roughness, the GGX lobe is
  extremely wide, and a single sample per frame produces visible noise.
  Reducing the effective roughness (`roughness - roughnessBias`)
  narrows the lobe slightly, reducing variance at the cost of
  under-blurring. Intel's SSSR recommends 0.0–0.1.

- **Why `confidence` alpha?** Screen-space hits near the screen edge,
  at extreme distances, or on rough surfaces are unreliable. The
  `confidence` value (alpha channel) lets the compositor blend
  reflections out gracefully — e.g., falling back to the
  `ReflectionProbe` / PMREM environment reflection where `confidence`
  is low.

- **Why `RGBA16F`?** HDR reflections can exceed [0,1] (bright light
  sources reflected on glossy surfaces). RGBA8 would clip these,
  producing dim reflections after tonemapping. RGBA16F preserves the
  full dynamic range.

- **Temporal disocclusion:** When the camera moves, previously
  occluded surfaces become visible. The history texture has no data
  for these pixels, so the temporal blend falls back to the current
  frame's (noisy) single sample. The `confidence`-weighted mix handles
  this automatically — low-confidence pixels trust the current frame.

#### Test coverage (`SSSRPass.test.ts`, 28 tests)

- **GGX math (8)**: roughness=0 → H=N; H normalized; H in normal
  hemisphere; higher roughness → wider spread; roughness=1 →
  cosine-weighted (E[cosθ]≈2/3); boundary cases (ξ=0, ξ→1); arbitrary
  normal direction
- **Schlick Fresnel (5)**: normal incidence → F0; grazing → 1;
  monotonic; F0-independent at cosθ=1; negative cosTheta clamped
- **reflectVec (3)**: mirror case (V∥H → R=V); 45° angle;
  magnitude preserved
- **Construction (2)**: defaults; all options
- **apply (7)**: no-throw + returns texture; output+history allocation;
  frame counter; draw call; blit on temporalWeight>0; no blit on =0;
  resource reuse
- **dispose (3)**: frees textures+FBOs; null-safe; lazy rebuild

#### References

- Tomás Stachowiak, "Deferred Stochastic Screen-Space Reflections" (Intel, GDC 2018)
- Brian Karis, "Stochastic SSR" (UE4 Siggraph 2014 presentation)
- o3de Atom `ScreenSpaceReflections` pass
- three.js `SSRPass` (this implementation adds GGX importance sampling + temporal accumulation on top)

---

### SSGIPass

Screen-space global illumination — ray-marches the GBuffer
position/normal/color buffers to estimate **diffuse indirect lighting**
(color bleeding / bounce light) from nearby surfaces. Complements
`SSRPass` (which handles specular reflections): SSGI handles the
**diffuse** counterpart, producing warm color bounce from brightly-lit
surfaces onto their neighbors. **Surpasses soup3D** (which has no GI of
any kind — no SSGI, no DDGI, no light probes for bounce light).

**Class**: `SSGIPass` (independent, does **not** extend `RenderPass`)
**Shader**: `SSGI_FRAG` (cosine-weighted hemisphere ray march + temporal rotation)

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSteps` | `number` | `32` | Max ray-march steps per ray (shader cap 64) |
| `thickness` | `number` | `0.5` | Thickness tolerance (world units) — too small = missed hits, too large = false hits |
| `resolution` | `number` | `0.5` | Resolution scale (1 = full res, 0.5 = half res recommended) |
| `strength` | `number` | `0.5` | Indirect light intensity (0..1+, >1 needs downstream ToneMap) |
| `radius` | `number` | `0.5` | Sample radius (world units) — controls indirect light reach |
| `numRays` | `number` | `8` | Ray count per pixel (1..8). More rays = smoother but slower |
| `jitterScale` | `number` | `1.0` | Temporal jitter amplitude (0 = off, pairs with TAA) |

#### Algorithm (4-stage pipeline)

| Stage | Description |
|-------|-------------|
| ① Early-out | Skip sky (no normal) and back-facing pixels (`dot(view, N) ≤ 0`). Output black (no indirect light). |
| ② TBN + ray generation | Build orthonormal basis (T, B, N) from world normal (no tangent attribute required). For each of `numRays` rays: cosine-weighted hemisphere sample `θ=asin(√ξ₁), φ=2π·ξ₂ + frame·goldenAngle`. Per-frame rotation (137.5°/frame) distributes samples over time → TAA converges to smooth result. |
| ③ Screen-space ray march | Each ray marches with linearly growing step (`baseStep = radius×0.1`, step grows `×(1+i×0.5)`). View-space thickness test: `depthDiff = viewDepth(ray) − viewDepth(sampled)`; hit when `0 < depthDiff < thickness`. IGN jitter per-pixel per-frame breaks banding. |
| ④ Accumulate + normalize | On hit: sample color, weight = `edgeFade × distAtten × cosWeight`. Edge fade = `smoothstep(0, 0.1, min(edgeDist))` (screen border). Distance attenuation = `1/(1 + 2·d²)`. Cosine weight = `max(N·rayDir, 0)`. Output = `Σ(color×w) / Σ(w) × strength`. |

#### Output

The pass outputs an **RGBA16F indirect irradiance** texture. The caller
composites it additively into the scene:

```glsl
// In the composite pass:
vec3 indirect = texture(u_ssgiMap, v_uv).rgb;
vec3 albedo = texture(u_albedoMap, v_uv).rgb;
finalColor += indirect * albedo / PI;  // Lambertian diffuse BRDF
```

The `albedo / π` multiplication converts irradiance to outgoing radiance
via the Lambertian BRDF. The pass itself does not multiply by albedo —
this allows the same SSGI output to be reused for different materials
(e.g., a glossy surface might use a different BRDF for the indirect term).

#### Usage

```ts
import { SSGIPass } from '@vreen/engine';

const ssgi = new SSGIPass({
  numRays: 8,         // 8 rays per pixel (smooth, ~2ms @ 1080p half-res)
  radius: 0.5,        // 0.5m sample radius
  strength: 0.5,      // 50% indirect intensity
  resolution: 0.5,    // half resolution (recommended)
  jitterScale: 1.0,   // temporal jitter (pairs with TAA)
});

// Each frame:
const indirectTex = ssgi.apply(gl, colorTex, positionTex, normalTex, camera);
// Composite: finalColor += indirectTex * albedo / PI
```

#### Comparison with soup3D

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Screen-space global illumination | **None** | `SSGIPass` (8-ray cosine hemisphere) |
| Diffuse color bleeding | **None** | Per-pixel ray-marched bounce light |
| Temporal accumulation | **None** | Golden-angle rotation + IGN jitter (TAA-compatible) |
| Distance attenuation | **None** | `1/(1+2d²)` falloff |
| Edge fade | **None** | `smoothstep` screen-border weight |
| Cosine-weighted importance sampling | **None** | `asin(√ξ)` hemisphere distribution |
| Configurable ray count | **None** | 1..8 rays (quality/perf tradeoff) |
| Half-resolution rendering | **None** | `resolution` scale (0.5 default) |
| HDR output | **None** | RGBA16F irradiance (>1 for bright bounces) |

**Where VREEN pulls ahead.** Global illumination is the single most
impactful feature for visual realism — it's what makes a scene look
"lit" rather than "flat". Without GI, surfaces in shadow are pure black;
with GI, they pick up warm bounce light from nearby lit surfaces (a red
wall bleeds onto a white floor, sunlight bouncing off grass tints nearby
stone green). soup3D has **no GI whatsoever** — every surface is lit only
by direct light + a flat ambient term. VREEN's `SSGIPass` adds real-time
diffuse bounce light in a single post-process pass, producing the color
bleeding that distinguishes AAA-rendered scenes from flat-shaded ones.

The 8-ray cosine-weighted hemisphere sampling with temporal rotation is
the same strategy used by UE5's `ScreenSpaceDenoiser` and o3de Atom's
`ScreenSpaceGlobalIllumination` pass — low per-frame cost (8 rays at
half-res ≈ 2ms on mid-range GPU), with TAA convergence producing a
smooth, stable result over 4–8 frames.

#### Design Notes

**Why cosine-weighted sampling?** For diffuse (Lambertian) surfaces, the
BRDF is `albedo/π` — constant in all directions. Cosine-weighted
importance sampling (`θ=asin(√ξ₁)`) places more samples near the normal
(where `N·L` is high and contribution is large) and fewer near the
horizon (where `N·L→0` and contribution vanishes). This gives lower
variance than uniform hemisphere sampling for the same ray count.

**Why golden-angle rotation?** Each frame, the entire sample pattern
rotates by 137.5° (the golden angle). Over 8 frames, the 8 rays cover
the equivalent of 64 unique directions. When TAA accumulates these
frames (with neighborhood clamping), the result converges to a smooth,
noise-free indirect light estimate — without the GPU cost of 64 rays
per frame.

**Why distance attenuation?** Real indirect light follows the inverse-square
law (`1/d²`). The `1/(1+2d²)` falloff is a numerically stable
approximation that avoids division-by-zero at `d=0` and smoothly
attenuates distant hits. The factor 2 is empirically tuned for typical
scene scales (~1m surfaces).

**SSGI vs SSR.** SSGI and SSR are complementary: SSR handles specular
(mirror-like) reflections from smooth surfaces; SSGI handles diffuse
bounce light from rough surfaces. A typical pipeline runs both: SSR first
(for sharp reflections), then SSGI (for diffuse bounce). The two passes
share the same GBuffer (position + normal) but sample different directions
(SSR: 1 reflection ray; SSGI: 8 cosine-weighted hemisphere rays).

#### References

- Crytek, "Real-time Diffuse Global Illumination in Screen Space" (SSDO, 2009)
- o3de Atom, `ScreenSpaceGlobalIllumination` pass
- EA SEED, "Stable SSAO" GDC presentation (IGN temporal jitter strategy)
- Jorge Jimenez, "Interleaved Gradient Noise" (2014)
- Karis 2013, "Real Shading in Unreal Engine 4" (split-sum IBL context)

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

### HeightFogPass

Exponential Height Fog — UE5-style atmospheric fog that reconstructs world
position from the GBuffer depth texture and computes a height-attenuated
exponential fog density. Produces the signature "low-lying ground fog that
thins with altitude" look used by every modern AAA engine, plus optional
directional-light **inscattering** (sun-direction tinted fog) for cinematic
god-ray-adjacent mood. **Surpasses soup3D** (which ships no atmospheric
fog of any kind — every pixel is rendered with direct lighting only, no
distance or height attenuation).

**Class**: `HeightFogPass` (independent, does **not** extend `RenderPass`)
**Shader**: `HEIGHT_FOG_FRAG` (single-pass fullscreen)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()`

#### Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────┐
│ colorTexture │───▶│ HeightFogPass.apply()                    │
│ HDR scene    │    │  1. (re)allocate FBO/texture on resize   │
└──────────────┘    │  2. bind _fbo, clear COLOR_BUFFER_BIT    │
                    │  3. bind color  → TEXTURE0 (u_colorMap)   │
┌──────────────┐    │  4. bind depth  → TEXTURE1 (u_depthMap)   │
│ depthTexture │───▶│  5. set inverse VP + camera pos          │
│ GBuffer depth│    │  6. set fog uniforms (density/height/…)  │
└──────────────┘    │  7. set inscattering uniforms (optional) │
                    │  8. drawArrays(fullscreen triangle)      │
┌──────────────┐    │  9. return _outputTexture                │
│ camera       │───▶│                                          │
│ view/proj    │    └────────────────────┬─────────────────────┘
└──────────────┘                         ▼
                                ┌──────────────────┐
                                │ _outputTexture   │
                                │ RGBA8 fogged     │
                                │ color            │
                                └──────────────────┘
```

The pass is **single-pass** — no ping-pong, no blur chain. All work happens
in one fragment shader invocation per pixel, reading the depth buffer to
reconstruct world position and then evaluating the fog integral in closed
form (analytic Beer-Lambert, not ray-marched). This makes it ~10× cheaper
than `VolumetricFogPass` (which ray-marches), at the cost of no volumetric
light shafts — the two passes serve different quality tiers.

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fogDensity` | `number` | `0.02` | Base fog density. Higher = thicker fog. Combined with `heightFactor` per-pixel. |
| `fogHeightFalloff` | `number` | `0.05` | Height decay rate. Higher = fog thins faster as world Y increases above `fogHeight`. |
| `fogHeight` | `number` | `0` | Reference world-space Y where fog density equals `fogDensity`. Below this = thicker, above = thinner. |
| `fogColor` | `[number, number, number]` | `[0.7, 0.8, 0.9]` | Fog tint (linear RGB 0..1). Default is a cool blue-grey haze. |
| `maxDistance` | `number` | `500` | Distance clamp (world units). Beyond this, pixels are fully fogged — prevents numeric overflow on sky pixels that survive the `depth ≥ 1.0` early-out. |
| `inscatteringEnabled` | `boolean` | `false` | Master toggle for directional-light inscattering (sun-direction tinting). |
| `sunDirection` | `[number, number, number]` | `[-0.5, -1, -0.3]` | Direction the sun light points TOWARD (world space). Should match the scene's `DirectionalLight` direction. |
| `sunColor` | `[number, number, number]` | `[1.0, 0.9, 0.7]` | Sun color (linear RGB). Warm yellow by default for golden-hour mood. |
| `inscatteringStrength` | `number` | `1.0` | Inscattering intensity multiplier. Higher = stronger sun-direction fog glow. |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  colorTexture: WebGLTexture,   // current frame HDR/LDR color
  depthTexture: WebGLTexture,   // GBuffer depth (window-space [0,1])
  camera: Camera,               // reads projectionMatrix + matrixWorldInverse + position
): WebGLTexture                 // fogged color (RGBA8)

setDirty(): void                // force resource rebuild next frame (call on resize)
dispose(): void                 // release GPU resources (safe to call multiple times)
```

#### Algorithm (4-stage pipeline)

| Stage | Description |
|-------|-------------|
| ① Sky early-out | Sample depth; if `depth ≥ 1.0` (sky / far plane), output `u_fogColor` directly — no reconstruction, no fog math. Prevents NaN from inverse-projection of infinity. |
| ② World reconstruction | NDC = `vec3(v_uv * 2 − 1, depth * 2 − 1)`. `worldPos = u_inverseViewProjection * vec4(NDC, 1)`, then `worldPos.xyz /= worldPos.w`. Single matrix mul, no ray march. |
| ③ Exponential height density | `heightFactor = exp(−fogHeightFalloff · (worldPos.y − fogHeight))`. `viewDist = length(worldPos − cameraPos)` clamped to `maxDistance`. `density = fogDensity · heightFactor`. `fogFactor = 1 − exp(−density · viewDist)`, clamped `[0,1]`. This is the closed-form integral of Beer-Lambert along the view ray through a medium whose density varies exponentially with height — the UE5 ExponentialHeightFog model. |
| ④ Inscattering (optional) | `viewDir = normalize(worldPos − cameraPos)`. `sunDot = dot(viewDir, −sunDirection)`. `inscatter = pow(max(sunDot, 0), 8) · inscatteringStrength`. `finalFogColor = mix(fogColor, sunColor, inscatter · 0.5)`. The `pow(·, 8)` sharpens the sun-direction glow into a tight halo around the light source — the same Henyey-Greenstein-style forward-scatter approximation used by o3de Atom's `Fog` pass. |
| ⑤ Composite | `outColor = vec4(mix(sceneColor, finalFogColor, fogFactor), 1.0)`. |

#### Texture unit bindings

| Unit | Sampler | Stage | Source |
|------|---------|-------|--------|
| 0 | `u_colorMap` | all | `colorTexture` (input scene color) |
| 1 | `u_depthMap` | all | `depthTexture` (GBuffer depth) |

#### Resource layout

| Resource | Count | Allocated when | Format |
|----------|-------|----------------|--------|
| Output FBO + texture | 1 + 1 | first `apply()` (or after `setDirty()`/resize) | RGBA8, `CLAMP_TO_EDGE` + `LINEAR` |
| Fullscreen quad VAO + buffer | 1 + 1 | first `apply()` | 3-vertex oversized triangle (covers `[-1,1]²`) |
| Shader program | 1 | first `apply()` | `POST_VERT` + `HEIGHT_FOG_FRAG` |

Resources are lazily allocated on the first `apply()` and rebuilt when the
canvas size changes or `setDirty()` is called. The `_dirty` flag ensures
the resize path runs exactly once per dimension change, not per frame.
`dispose()` nulls all handles and resets `_initialized` so a subsequent
`apply()` will re-allocate cleanly — safe to call multiple times.

#### Usage

**Basic — ground haze for a low-altitude outdoor scene:**

```ts
import { HeightFogPass } from '@vreen/engine';

const fog = new HeightFogPass({
  fogDensity: 0.02,
  fogHeightFalloff: 0.05,
  fogHeight: 0,              // sea level
  fogColor: [0.7, 0.8, 0.9], // cool blue-grey
  maxDistance: 500,
});

// Each frame, after the main scene pass produces colorTex + depthTex:
const foggedTex = fog.apply(gl, colorTex, depthTex, camera);
```

**Cinematic golden-hour inscattering (sun-direction glow):**

```ts
const fog = new HeightFogPass({
  fogDensity: 0.015,
  fogHeightFalloff: 0.03,
  fogHeight: 2,
  fogColor: [0.6, 0.7, 0.85],
  inscatteringEnabled: true,
  sunDirection: dirLight.direction, // match scene DirectionalLight
  sunColor: [1.0, 0.85, 0.6],       // warm sun
  inscatteringStrength: 1.5,        // strong halo
  maxDistance: 800,
});
```

**Time-of-day density tween (dawn → noon → dusk):**

```ts
const fog = new HeightFogPass({ fogDensity: 0.02 });
pipeline.add(fog);

function update(timeOfDay: number) {
  // timeOfDay: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk
  fog.fogDensity = 0.005 + 0.02 * (1 - Math.abs(timeOfDay - 0.5) * 2);
  fog.inscatteringEnabled = (timeOfDay > 0.2 && timeOfDay < 0.8);
  if (fog.inscatteringEnabled) {
    // sun color shifts from warm (dawn/dusk) to white (noon)
    const warmth = 1 - Math.abs(timeOfDay - 0.5) * 2;
    fog.sunColor = [1.0, 0.9 - warmth * 0.1, 0.7 - warmth * 0.2];
  }
}
```

#### Comparison with soup3D

`soup3D` (as of v0.x) ships **no atmospheric fog** of any kind — no height
fog, no distance fog, no volumetric fog. Every surface is rendered with
direct lighting and a flat ambient term, with no distance-based atmospheric
attenuation. This makes soup3D scenes look "flat" at distance (no aerial
perspective) and produces harsh horizon lines where geometry meets sky.

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Atmospheric fog | **None** | `HeightFogPass` (UE5 exponential height fog) |
| Height attenuation | **None** | `exp(−falloff · (y − height))` per-pixel |
| Distance attenuation | **None** | Closed-form Beer-Lambert `1 − exp(−density · dist)` |
| Directional inscattering | **None** | `pow(sunDot, 8)` forward-scatter halo |
| Sun-direction tinting | **None** | `mix(fogColor, sunColor, inscatter)` |
| Sky early-out | **None** | `depth ≥ 1.0` short-circuit (no NaN) |
| World-space reconstruction | **None** | Inverse view-projection from depth |
| Aerial perspective | **None** | Automatic distance fade to fog color |
| Time-of-day density tween | **None** | Runtime `fogDensity` + `inscatteringEnabled` |
| Max-distance clamp | **None** | `maxDistance` prevents overflow |

**Where VREEN pulls ahead.** Atmospheric fog is a **scene-depth essential**
— without it, distant geometry appears artificially sharp and the horizon
looks wrong (every AAA game since the PS3 era uses height fog to fake
aerial perspective and hide far-clip pop). soup3D has no path to this
look. VREEN's `HeightFogPass` adds it in a single cheap fullscreen pass
(1 draw call, no ray march) with the same exponential height model UE5
uses, plus optional sun-direction inscattering for the golden-hour glow
that sells outdoor scenes.

The closed-form Beer-Lambert integral (not ray-marched) makes this pass
~10× cheaper than `VolumetricFogPass` — use `HeightFogPass` when you need
cheap atmospheric depth, use `VolumetricFogPass` when you need true
volumetric light shafts (crepuscular rays through trees, god rays
through windows). They compose cleanly: run HeightFog first for the
base atmospheric layer, then VolumetricFog for the light shafts on top.

#### Design Notes

**Why exponential height decay?** Real atmospheric density follows the
barometric formula `ρ(h) = ρ₀ · exp(−h/H)` — an exponential falloff with
altitude. The `exp(−fogHeightFalloff · (y − fogHeight))` term is the
simplified game-engine form (UE5, o3de Atom, and Frostbite all use the
same model). Linear fog (constant density) looks wrong because it
produces uniform haze at all altitudes; exponential height fog produces
the correct "ground-level haze thinning to clear sky" gradient.

**Why closed-form instead of ray-marched?** The fog integral
`∫ density(h(t)) · dt` along the view ray has a closed-form solution when
density varies exponentially with height (the integral of `exp` is `exp`).
Ray-marching (as `VolumetricFogPass` does) is only needed when the
density field is non-analytic (e.g. participating media with scattering
events). For pure attenuation fog, the closed form is both more accurate
(no discretization error) and ~10× faster (1 sample vs N samples).

**Why `pow(sunDot, 8)` for inscattering?** Real atmospheric scattering
is governed by the Henyey-Greenstein phase function, which is sharply
forward-peaked (light scatters mostly in the direction of the sun).
`pow(max(sunDot, 0), 8)` is a cheap analytic approximation of the
forward-scatter lobe — the exponent 8 gives a tight ~30° halo around the
sun direction, matching the visual width of real crepuscular ray glow.
This is the same approximation o3de Atom's `Fog` pass uses.

**Why `maxDistance` clamp?** On pixels that survive the `depth ≥ 1.0`
early-out (e.g. far-plane geometry, not sky), `viewDist` can be very
large, and `density · viewDist` can overflow `float` precision before
`exp(−x)` clamps it to 0. The `min(viewDist, maxDistance)` clamp
prevents this — at `maxDistance`, the pixel is fully fogged anyway
(`fogFactor → 1`), so clamping has no visual effect but avoids NaN.

**Why RGBA8 output (not RGBA16F)?** Height fog is typically applied
*after* tone mapping in the pipeline (it's an atmospheric effect, not a
lighting effect). At that point the color is already LDR, so RGBA8
suffices and saves bandwidth. If you need to apply fog *before* tone
mapping (HDR pipeline), upgrade the internal format to `RGBA16F` — the
shader math is identical.

**Why `_computeInverseVP` inlines a 4×4 inverse?** VREEN's `Math/Matrix4`
doesn't expose a public `invert()` that returns a new matrix (it mutates
in place). To avoid mutating the camera's matrices, the pass computes the
inverse of `projection × view` inline via the cofactor/adjugate method.
This is ~150 lines but runs once per frame on the CPU — negligible cost.
A future refactor could delegate to `Matrix4.makeInverse()` if added.

#### Test coverage (`HeightFogPass.test.ts`, 16 tests)

- **Construction (2)**: defaults match option table; all options
  accepted and stored.
- **apply() behavior (4)**: no-throw + returns texture; first apply
  allocates exactly 1 texture + 1 FBO + 1 VAO + 1 buffer + 1 program;
  subsequent apply with same size does not re-allocate; returns the
  same texture instance across frames (stable handle for downstream
  passes).
- **setDirty() (1)**: forces re-allocation on next apply (resize path).
- **dispose() (1)**: safe + idempotent (3× calls no throw).
- **Shader source validation (8)**: `#version 300 es`; samples
  `u_colorMap` + `u_depthMap`; reconstructs world pos via
  `u_inverseViewProjection` + `worldPos`; computes exponential height
  density (`u_fogDensity`, `u_fogHeightFalloff`, `exp(`, `heightFactor`);
  clamps `fogFactor` to `[0,1]`; supports inscattering
  (`u_inscatteringEnabled`, `u_sunDirection`, `u_sunColor`, `inscatter`);
  handles sky pixels (`depth >= 1.0`); composites via `mix(sceneColor)`.

#### References

- Epic Games, "Exponential Height Fog" — UE5 documentation
- o3de Atom, `Fog` pass (`Assets/Passes/FogParent.pass`)
- Frostbite, "Cinematic Fog" — SIGGRAPH 2015 course notes
- Henyey & Greenstein (1941), "Diffuse radiation in the galaxy" —
  phase function for forward-scatter approximation
- Beer-Lambert law — closed-form atmospheric attenuation integral

---

### CausticsPass

Screen-space underwater caustics — reconstructs the world position per pixel
from the GBuffer depth, and additively overlays a procedural caustic light
pattern on all geometry below `waterLevel`. The caustic pattern is built
from **three directional sine waves** (30°/120°/−60°) whose positive lobes
are raised to a configurable power (`u_power`), sharpening the bright
focusing lines characteristic of refracted sunlight through a water surface.
Supports **RGB chromatic dispersion** (per-channel UV offset simulating
wavelength-dependent refraction) and **Beer-Lambert depth attenuation**
(caustics fade with distance below the surface). **Surpasses soup3D**
(which ships no water rendering at all — no water surface, no caustics, no
underwater fog).

**Class**: `CausticsPass` (independent, does **not** extend `RenderPass`)
**Shader**: `CAUSTICS_FRAG` (single-pass fullscreen)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()` (0 when disabled — early return)
**Output**: RGBA16F HDR (additive caustics may push pixels > 1.0)

#### Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────────┐
│ colorTexture │───▶│ CausticsPass.apply()                         │
│ HDR scene    │    │  0. if !enabled → return inputTexture (zero) │
└──────────────┘    │  1. (re)allocate FBO/texture on resize/dirty │
                    │  2. bind _fbo, clear COLOR_BUFFER_BIT         │
┌──────────────┐    │  3. bind color → TEXTURE0 (u_colorMap)       │
│ depthTexture │───▶│  4. bind depth → TEXTURE1 (u_depthMap)       │
│ GBuffer depth│    │  5. set inverse VP + camera pos + screen     │
└──────────────┘    │  6. set caustic params (color/intensity/...)  │
                    │  7. set time (caller-updated animation)       │
                    │  8. drawArrays(fullscreen triangle)           │
                    │  9. return _outputTexture                     │
                    └────────────────────┬─────────────────────────┘
                                         ▼
                    ┌──────────────────────────────────────────────┐
                    │ _outputTexture (RGBA16F)                     │
                    │   sceneColor + causticColor * caustic        │
                    │                  * intensity * depthAtten    │
                    └──────────────────────────────────────────────┘
```

#### Algorithm (5 stages, per pixel)

| # | Stage | Formula / Logic |
|---|-------|-----------------|
| 1 | Depth reject | `if (depth >= 1.0) return sceneColor;` (sky) |
| 2 | World reconstruct | `worldPos = invVP * NDC; perspective divide` |
| 3 | Above-water reject | `if (worldPos.y > waterLevel) return sceneColor;` |
| 4 | Depth attenuation | `depthAtten = 1 / (1 + (waterLevel - worldPos.y) * absorption)` |
| 5 | Caustic pattern | 3 sine waves (30°/120°/−60°), `pow(max(0, mean), power)`, RGB-dispersed |
| 6 | Composite | `out = sceneColor + causticColor * caustic * intensity * depthAtten` |

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `causticColor` | `[r,g,b]` | `[0.2, 0.7, 0.9]` | Caustic tint (cyan-blue) |
| `causticIntensity` | `number` | `0.6` | Brightness multiplier |
| `waterLevel` | `number` | `0` | World Y of water surface |
| `worldScale` | `number` | `8` | World→UV scale (higher = denser pattern) |
| `waveSpeed` | `number` | `0.8` | Animation speed |
| `waveFrequency` | `number` | `8` | Spatial frequency of ripples |
| `wavePhase` | `number` | `0` | Phase offset |
| `absorption` | `number` | `0.02` | Depth fade rate (Beer-Lambert) |
| `dispersion` | `number` | `0.3` | RGB chromatic split (0 = none) |
| `power` | `number` | `3.0` | Focus power (higher = sharper bright lines) |
| `enabled` | `boolean` | `true` | Enable toggle |
| `time` | `number` | `0` | Animation time (caller updates per frame) |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  colorTexture: WebGLTexture,
  depthTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

#### Usage — basic underwater scene

```ts
import { CausticsPass } from '@/engine/Renderer/PostProcess/CausticsPass';

const caustics = new CausticsPass({
  waterLevel: 0,            // sea level at Y=0
  causticColor: [0.2, 0.7, 0.9],
  causticIntensity: 0.8,
  worldScale: 6,
  waveSpeed: 1.0,
  dispersion: 0.4,          // subtle RGB split
  power: 4.0,               // sharp focus lines
});

// Per frame:
caustics.time = performance.now() * 0.001;
const out = caustics.apply(gl, sceneColorTex, depthTex, camera);
```

#### Usage — toggle off for above-water camera

```ts
// When camera rises above waterLevel, disable to save the draw call:
caustics.enabled = false;
const out = caustics.apply(gl, sceneColorTex, depthTex, camera);
// out === sceneColorTex (zero overhead, no FBO touched)
```

#### Comparison with soup3D

| Capability | VREEN | soup3D |
|-----------|-------|--------|
| Underwater caustics | ✓ (procedural + dispersion) | ✗ |
| Water surface rendering | ✓ (via this pass + shader) | ✗ |
| Depth-based effect | ✓ (GBuffer depth reconstruct) | ✗ (no depth pass) |
| Chromatic dispersion | ✓ | ✗ |
| HDR additive composite | ✓ (RGBA16F) | ✗ |

#### References

- GPU Gems 2, Ch. 18 "Effective Water Simulation from Physical Models" (Finch)
- o3de Atom, Water highlights / caustics pass
- ShaderToy "Caustic" by Dave_Hoskins
- Beer-Lambert law — depth attenuation

---

### WaterSurfacePass

Screen-space planar water rendering — draws an animated ocean/lake/pond
surface **without any water geometry** by ray-tracing the camera ray
against the infinite plane `y = waterLevel`. At each hit point, **4
directional Gerstner waves** are summed to displace the surface and a
**central-difference normal** is computed. The final pixel blends
**refraction** (scene color sampled with a normal-offset UV, tinted by
Beer-Lambert water-depth absorption) and **reflection** (a sky
gradient sampled along the reflected ray) via the **Schlick Fresnel**
approximation, then adds a **Blinn-Phong sun specular** highlight.
Geometry in front of the water plane is preserved via a depth-based
occlusion test. **Surpasses soup3D** (which has no water rendering at
all) and pairs with `CausticsPass` for a complete above-/below-water
solution.

**Class**: `WaterSurfacePass` (independent, does **not** extend `RenderPass`)
**Shader**: `WATER_SURFACE_FRAG` (single-pass fullscreen)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()` (0 when disabled — early return)
**Output**: RGBA16F HDR (sun specular + sky reflection may push pixels > 1.0)

#### Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────────┐
│ colorTexture │───▶│ WaterSurfacePass.apply()                     │
│ HDR scene    │    │  0. if !enabled → return inputTexture (zero) │
│ (refraction  │    │  1. (re)allocate FBO/texture on resize/dirty │
│  source)     │    │  2. bind _fbo, clear COLOR_BUFFER_BIT         │
└──────────────┘    │  3. bind color → TEXTURE0 (u_colorMap)       │
                    │  4. bind depth → TEXTURE1 (u_depthMap)       │
┌──────────────┐    │  5. set inverse VP + camera pos + screen     │
│ depthTexture │───▶│  6. set water params (level/color/sky/...)   │
│ GBuffer depth│    │  7. set sun params (dir/color/spec/shin)     │
└──────────────┘    │  8. set wave params (time/amp/freq/speed)    │
                    │  9. set Fresnel / refraction / absorption     │
┌──────────────┐    │ 10. drawArrays(fullscreen triangle)          │
│   camera     │───▶│ 11. return _outputTexture                    │
└──────────────┘    └────────────────────┬─────────────────────────┘
                                          ▼
                    ┌──────────────────────────────────────────────┐
                    │ _outputTexture (RGBA16F)                     │
                    │   mix(refraction, reflection, fresnel)       │
                    │       + sunColor * spec * sunSpecular        │
                    └──────────────────────────────────────────────┘
```

#### Algorithm (7 stages, per pixel)

| # | Stage | Formula / Logic |
|---|-------|-----------------|
| 1 | Scene reconstruct | `depth → NDC → invVP → worldPos; sceneDist = |worldPos - camPos|` |
| 2 | Ray rebuild | `rayDir = normalize(farWorld - camPos)` (handles sky pixels) |
| 3 | Ray-plane intersect | `tHit = (waterLevel - camPos.y) / rayDir.y`; skip if `tHit < 0` |
| 4 | Occlusion test | `if (depth < 1.0 && sceneDist < tHit) return sceneColor;` (geometry in front) |
| 5 | Wave displacement | `h = Σ sin(phase_i) * amp/(1+i)` over 4 dirs; `waterPos.y += h` |
| 6 | Normal + Fresnel | central-diff normal; `fresnel = bias + (1-bias)·(1-cosθ)^power` |
| 7 | Composite | `mix(refraction, reflection, fresnel) + sunColor·spec·sunSpecular` |

#### Refraction & absorption

The refraction term samples the scene color at a **normal-offset UV**
(`v_uv + normal.xz * refractionOffset`), then blends toward `waterColor`
by Beer-Lambert absorption based on how far the underlying geometry sits
below `waterLevel`:

```glsl
float depthBelow = max(0.0, u_waterLevel - sceneWorldPos.y);
float absorb = 1.0 - exp(-depthBelow * u_absorption);
vec3 refraction = mix(refractionColor, u_waterColor, absorb);
```

Deeper geometry → stronger water tint → realistic "deep blue" troughs.

#### Reflection (sky gradient)

The reflected ray (`reflect(-rayDir, normal)`) is mapped to a two-color
sky gradient (horizon → zenith) keyed by the ray's Y component:

```glsl
float skyT = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0);
vec3 reflection = mix(u_horizonColor, u_skyColor, skyT);
```

This cheap gradient avoids sampling a real cubemap while still producing
plausible sky reflections that brighten at grazing angles (driven by
Fresnel).

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `waterLevel` | `number` | `0` | World Y of the water plane |
| `waterColor` | `[r,g,b]` | `[0.02, 0.1, 0.2]` | Deep-water absorption tint (dark blue) |
| `skyColor` | `[r,g,b]` | `[0.4, 0.6, 0.9]` | Zenith reflection color |
| `horizonColor` | `[r,g,b]` | `[0.7, 0.75, 0.8]` | Horizon reflection color |
| `sunDirection` | `[x,y,z]` | `[0.5, 0.5, -0.3]` | Sun direction (normalized, toward sun) |
| `sunColor` | `[r,g,b]` | `[1.0, 0.95, 0.8]` | Sun color (warm white) |
| `sunSpecular` | `number` | `1.0` | Sun specular intensity |
| `sunShininess` | `number` | `200.0` | Blinn-Phong shininess (higher = tighter highlight) |
| `waveAmplitude` | `number` | `0.3` | Gerstner wave vertical amplitude |
| `waveFrequency` | `number` | `0.1` | Spatial wave frequency (higher = denser ripples) |
| `waveSpeed` | `number` | `1.0` | Wave animation speed |
| `fresnelPower` | `number` | `5.0` | Fresnel exponent (higher = stronger grazing reflection) |
| `fresnelBias` | `number` | `0.02` | Minimum reflectance at normal incidence |
| `refractionOffset` | `number` | `0.01` | UV offset strength for refraction sampling |
| `absorption` | `number` | `0.05` | Water-depth absorption rate (Beer-Lambert) |
| `enabled` | `boolean` | `true` | Enable toggle |
| `time` | `number` | `0` | Animation time (caller updates per frame) |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  colorTexture: WebGLTexture,
  depthTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

#### Usage — ocean surface at sea level

```ts
import { WaterSurfacePass } from '@/engine/Renderer/PostProcess/WaterSurfacePass';

const water = new WaterSurfacePass({
  waterLevel: 0,                 // sea level at Y=0
  waterColor: [0.02, 0.1, 0.2],  // deep blue
  skyColor: [0.4, 0.6, 0.9],
  horizonColor: [0.7, 0.75, 0.8],
  sunDirection: [0.5, 0.5, -0.3],
  sunColor: [1.0, 0.95, 0.8],
  sunSpecular: 1.2,
  sunShininess: 256.0,
  waveAmplitude: 0.4,
  waveFrequency: 0.12,
  waveSpeed: 1.0,
});

// Per frame:
water.time = performance.now() * 0.001;
const out = water.apply(gl, sceneColorTex, depthTex, camera);
```

#### Usage — paired with CausticsPass for full water system

```ts
// Above-water camera sees the surface; underwater geometry gets caustics.
const water = new WaterSurfacePass({ waterLevel: 0, enabled: true });
const caustics = new CausticsPass({ waterLevel: 0, enabled: true });

// Per frame:
water.time = caustics.time = t;
let color = water.apply(gl, sceneColorTex, depthTex, camera);
color = caustics.apply(gl, color, depthTex, camera);
```

#### Usage — toggle off when camera is fully submerged

```ts
// When camera.y < waterLevel, the planar surface is behind the camera;
// disable to save the draw call and let CausticsPass handle the view.
if (camera.position.y < water.waterLevel) {
  water.enabled = false;
} else {
  water.enabled = true;
}
```

#### Comparison with soup3D

| Capability | VREEN | soup3D |
|-----------|-------|--------|
| Screen-space planar water | ✓ (ray-plane, no geometry) | ✗ |
| Gerstner waves | ✓ (4 directional, summed) | ✗ |
| Schlick Fresnel | ✓ (bias + power) | ✗ |
| Refraction (normal-offset UV) | ✓ | ✗ |
| Beer-Lambert depth absorption | ✓ | ✗ |
| Sky-gradient reflection | ✓ (zenith + horizon) | ✗ |
| Blinn-Phong sun specular | ✓ | ✗ |
| Geometric occlusion test | ✓ (depth-based) | ✗ |
| HDR composite | ✓ (RGBA16F) | ✗ |
| Pairs with underwater caustics | ✓ (CausticsPass) | ✗ |

#### References

- GPU Gems 1, Ch. 9 "Effective Water Simulation from Physical Models" (Finch)
- o3de Atom, Water surface pass
- Schlick (1994) — Fresnel approximation for dielectrics
- Beer-Lambert law — depth absorption

---

### GodRaysPass

Screen-space volumetric light shafts (crepuscular rays) — a single-pass
post-process that simulates sunlight scattering through scene occluders.
Projects the light's world position to screen UV, then **radially samples**
from each pixel toward the light, accumulating bright areas (luminance above
`threshold`) with **exponential decay** (`illuminationDecay *= decay`).
**Depth-aware occlusion** lets foreground geometry block the rays while sky
pixels pass light through, producing the characteristic "god rays" emanating
from behind trees, buildings, and canyon walls. ~10× cheaper than the full
`VolumetricFogPass` ray-march, and can coexist with it for enhanced shafts.
**Surpasses soup3D** (which has no atmospheric scattering at all).

**Class**: `GodRaysPass` (independent, does **not** extend `RenderPass`)
**Shader**: `GOD_RAYS_FRAG` (single-pass fullscreen)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()` (0 when disabled — early return)
**Output**: RGBA16F HDR (additive rays may push pixels > 1.0)

#### Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────────┐
│ colorTexture │───▶│ GodRaysPass.apply()                          │
│ HDR scene    │    │  0. if !enabled → return inputTexture (zero) │
│ (ray source) │    │  1. (re)allocate FBO/texture on resize/dirty │
└──────────────┘    │  2. bind _fbo, clear COLOR_BUFFER_BIT         │
                    │  3. bind color → TEXTURE0 (u_colorMap)       │
┌──────────────┐    │  4. bind depth → TEXTURE1 (u_depthMap)       │
│ depthTexture │───▶│  5. set viewProjection (world→NDC)           │
│ GBuffer depth│    │  6. set light params (pos/color/intensity)   │
└──────────────┘    │  7. set sampling params (samples/decay/...)  │
                    │  8. drawArrays(fullscreen triangle)          │
┌──────────────┐    │  9. return _outputTexture                    │
│   camera     │───▶│                                              │
│ (VP matrix)  │    │                                              │
└──────────────┘    └────────────────────┬─────────────────────────┘
                                          ▼
                    ┌──────────────────────────────────────────────┐
                    │ _outputTexture (RGBA16F)                     │
                    │   sceneColor + accumulated                   │
                    │     * exposure * lightColor * intensity      │
                    └──────────────────────────────────────────────┘
```

#### Algorithm (Sekulic 2004, per pixel)

| # | Stage | Formula / Logic |
|---|-------|-----------------|
| 1 | Light project | `lightClip = viewProjection * lightPos; if (w <= 0) skip;` |
| 2 | Screen UV | `lightScreenUV = (lightNDC.xy * 0.5 + 0.5)` |
| 3 | Radial delta | `delta = (lightScreenUV - pixelUV) * density / samples` |
| 4 | March & accumulate | `for i in 0..samples: sampleUV += delta; ...` |
| 5 | Brightness mask | `lightMask = max(0, luminance(sampleColor) - threshold)` |
| 6 | Depth occlusion | `occlusion = step(maxDepth, sampleDepth)` (sky=1, geom=0) |
| 7 | Decay accumulate | `accumulated += sampleColor * lightMask * decay^i * occlusion` |
| 8 | Composite | `out = sceneColor + accumulated * exposure * lightColor * intensity` |

The loop is bounded by `MAX_SAMPLES = 256` (GLSL ES 3.0 constant upper bound)
with an early `break` at `u_samples`, so the actual sample count is
configurable from 1 to 256 without shader recompilation.

#### Depth-aware occlusion

Without the depth test, rays would bleed through foreground geometry. The
shader samples `u_depthMap` at each radial step and uses a `step()` gate:

```glsl
float occlusion = step(u_maxDepth, sampleDepth);
// depth >= maxDepth → sky / far plane → occlusion = 1.0 (light passes)
// depth <  maxDepth → foreground geometry → occlusion = 0.0 (light blocked)
```

This makes rays appear to stream **from behind** occluders rather than
through them — the defining visual of crepuscular rays.

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lightPosition` | `[x,y,z]` | `[0, 50, 0]` | Light world position (project to screen) |
| `lightColor` | `[r,g,b]` | `[1.0, 0.9, 0.7]` | Ray tint (warm yellow = sunlight) |
| `lightIntensity` | `number` | `1.0` | Ray brightness multiplier |
| `samples` | `number` | `80` | Radial sample count (1..256, more = smoother) |
| `decay` | `number` | `0.96` | Exponential decay per step (→1 = longer rays) |
| `exposure` | `number` | `0.5` | Overall ray exposure |
| `density` | `number` | `1.0` | Sample spacing multiplier (>1 stretches range) |
| `threshold` | `number` | `0.8` | Luminance threshold for ray source extraction |
| `maxDepth` | `number` | `0.99` | Depth above which pixels are treated as sky |
| `enabled` | `boolean` | `true` | Enable toggle |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  colorTexture: WebGLTexture,
  depthTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

#### Usage — sunlight shafts through a forest

```ts
import { GodRaysPass } from '@/engine/Renderer/PostProcess/GodRaysPass';

const godRays = new GodRaysPass({
  lightPosition: [120, 80, -40],   // sun world position
  lightColor: [1.0, 0.9, 0.7],     // warm sunlight
  lightIntensity: 1.5,
  samples: 100,                     // smooth shafts
  decay: 0.95,                      // long rays
  threshold: 0.7,                   // bright sky + sun disc
  maxDepth: 0.99,                   // sky pass, trees block
});

// Per frame (update light to follow the sun):
godRays.lightPosition = sunWorldPos;
const out = godRays.apply(gl, sceneColorTex, depthTex, camera);
```

#### Usage — cheap fallback for VolumetricFog

```ts
// GodRays is ~10x cheaper than VolumetricFogPass. Use it on low-end devices
// or when only the light-shaft look is needed (no full fog volume).
const godRays = new GodRaysPass({ samples: 60, decay: 0.94 });
// No 3D noise texture, no ray-march — just a radial screen-space blur.
```

#### Usage — toggle off when light is behind camera

```ts
// The shader auto-skips when lightClip.w <= 0 (light behind camera),
// but you can also early-out in JS to avoid the FBO bind entirely:
if (cameraDir.dot(sunDir) < 0) {
  godRays.enabled = false;
} else {
  godRays.enabled = true;
}
```

#### Comparison with soup3D

| Capability | VREEN | soup3D |
|-----------|-------|--------|
| Screen-space god rays | ✓ (radial sampling + depth occlusion) | ✗ |
| Crepuscular rays | ✓ (Sekulic 2004) | ✗ |
| Depth-aware occlusion | ✓ (foreground blocks rays) | ✗ (no depth pass) |
| Configurable decay | ✓ (exponential per step) | ✗ |
| Brightness threshold | ✓ (luminance mask) | ✗ |
| HDR additive composite | ✓ (RGBA16F) | ✗ |
| Light-behind-camera skip | ✓ (clip w test) | ✗ |
| Cheap fog alternative | ✓ (~10x cheaper than VolumetricFog) | ✗ |

#### References

- GPU Gems 3, Ch. 13 "Volumetric Light Scattering in Post-Space" (Sekulic)
- o3de Atom, Volumetric rays pass
- Mittring 2007, "Finding Next Gen — CryEngine 2" (light shafts)

---

### ScreenSpaceLensFlarePass

Screen-space lens flare — a single-pass post-process that simulates the
**ghosts**, **halo**, and **starburst** artifacts produced by light reflecting
and refracting inside a camera lens. Projects the light's world position to
screen UV, then composites three flare layers along the light→screen-center
axis: (1) a chain of **ghost** discs with **RGB chromatic aberration** that
march toward the screen center with `1/i` falloff, (2) a **gaussian halo ring**
centered on the light at radius `haloRadius`, and (3) a **starburst** of
`sin()`-modulated rays radiating from the light. **Depth-aware occlusion**
lets foreground geometry block the flare, and an **off-screen fade** smoothly
hides the flare as the light exits the viewport. ~5× cheaper than `GodRaysPass`
(no radial march — single-sample compositing), and the two can coexist:
GodRays gives the atmospheric shafts, LensFlare gives the cinematic lens
character. **Surpasses soup3D** (which has no lens flare at all) and improves
on three.js's sprite-based `Lensflare` (which is not depth-occluded and
requires per-sprite scene placement).

**Class**: `ScreenSpaceLensFlarePass` (independent, does **not** extend `RenderPass`)
**Shader**: `LENS_FLARE_FRAG` (single-pass fullscreen)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()` (0 when disabled — early return)
**Output**: RGBA16F HDR (additive flare may push pixels > 1.0)

#### Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────────┐
│ colorTexture │───▶│ ScreenSpaceLensFlarePass.apply()             │
│ HDR scene    │    │  0. if !enabled → return inputTexture (zero) │
│ (ghost src)  │    │  1. (re)allocate FBO/texture on resize/dirty │
└──────────────┘    │  2. bind _fbo, clear COLOR_BUFFER_BIT         │
                    │  3. bind color → TEXTURE0 (u_colorMap)       │
┌──────────────┐    │  4. bind depth → TEXTURE1 (u_depthMap)       │
│ depthTexture │───▶│  5. set viewProjection (world→NDC)           │
│ GBuffer depth│    │  6. set light params (pos/color/intensity)   │
└──────────────┘    │  7. set ghost params (count/spacing/radius)  │
                    │  8. set halo params (radius/thickness/int)   │
┌──────────────┐    │  9. set starburst params (intensity/rays)    │
│   camera     │───▶│ 10. set global params (maxDepth/CA/falloff)  │
│ (VP matrix)  │    │ 11. drawArrays(fullscreen triangle)          │
└──────────────┘    │ 12. return _outputTexture                    │
                    └────────────────────┬─────────────────────────┘
                                          ▼
                    ┌──────────────────────────────────────────────┐
                    │ _outputTexture (RGBA16F)                     │
                    │   sceneColor + flare                         │
                    │     * lightColor * intensity                 │
                    │     * globalFalloff * occlusion * fade       │
                    └──────────────────────────────────────────────┘
```

#### Algorithm (Jimenez 2014, per pixel)

| # | Stage | Formula / Logic |
|---|-------|-----------------|
| 1 | Light project | `lightClip = viewProjection * lightPos; if (w <= 0) skip;` |
| 2 | Screen UV | `lightUV = lightNDC.xy * 0.5 + 0.5` |
| 3 | Off-screen fade | `offDist = length(max(|lightUV-0.5|-0.5, 0)); fade = 1-smoothstep(0,1.5,offDist)` |
| 4 | Depth occlusion | `occlusion = step(maxDepth, pixelDepth)` (sky=1, geom=0) |
| 5 | Ghost chain | `for i in 1..ghostCount: ghostUV = lightUV + toCenter*(spacing*i)` |
| 6 | Ghost chromatic | `R = tex(ghostUV+ca*i); G = tex(ghostUV); B = tex(ghostUV-ca*i)` |
| 7 | Ghost mask | `mask = radialGauss(pixel, ghostUV, ghostRadius); falloff = 1/i` |
| 8 | Halo ring | `haloRing = exp(-((distToLight-haloRadius)/haloThickness)^2)` |
| 9 | Starburst | `rays = Σ|sin(angle*rays + i*π)|; rays = pow(rays - n*0.5, 2)` |
| 10 | Global falloff | `globalFalloff = exp(-distToLight * globalFalloffRate)` |
| 11 | Composite | `out = sceneColor + flare * lightColor * intensity * falloff * occlusion * fade` |

Both the ghost and starburst loops are bounded by `MAX_GHOSTS = 16` /
`MAX_RAYS = 16` (GLSL ES 3.0 constant upper bounds) with early `break` at
`u_ghostCount` / `u_starburstRays`, so counts are configurable from 0 to 16
without shader recompilation.

#### Ghost chromatic aberration

Each ghost samples the scene color **three times** with per-channel UV
offsets, simulating the prismatic dispersion of a real lens:

```glsl
float ca = u_chromaticAberration * fi;       // offset scales with ghost index
ghostColor.r = texture(u_colorMap, ghostUV + vec2(ca, 0.0)).r;  // red shifts right
ghostColor.g = texture(u_colorMap, ghostUV).g;                  // green stays
ghostColor.b = texture(u_colorMap, ghostUV - vec2(ca, 0.0)).b;  // blue shifts left
```

This produces the characteristic **rainbow fringe** on each ghost that is the
signature of cinematic lens flare.

#### Depth-aware occlusion

Without the depth test, the flare would bleed through foreground geometry.
The shader samples `u_depthMap` once per pixel and gates the entire flare:

```glsl
float occlusion = step(u_maxDepth, pixelDepth);
// depth >= maxDepth → sky / far plane → occlusion = 1.0 (flare visible)
// depth <  maxDepth → foreground geometry → occlusion = 0.0 (flare hidden)
```

This makes the flare appear **behind** occluders — critical for realism when
the sun is partially eclipsed by buildings or terrain.

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lightPosition` | `[x,y,z]` | `[0, 50, 0]` | Light world position (project to screen) |
| `lightColor` | `[r,g,b]` | `[1.0, 0.95, 0.85]` | Flare tint (warm white = sunlight) |
| `lightIntensity` | `number` | `1.0` | Flare brightness multiplier |
| `ghostCount` | `number` | `8` | Ghost disc count (0..16, 0 disables ghosts) |
| `ghostSpacing` | `number` | `0.2` | Axial spacing per ghost along light→center |
| `ghostRadius` | `number` | `0.08` | Gaussian radius of each ghost disc |
| `ghostIntensity` | `number` | `1.0` | Ghost brightness multiplier |
| `haloRadius` | `number` | `0.4` | Halo ring radius from light (screen UV units) |
| `haloThickness` | `number` | `0.1` | Halo ring gaussian width |
| `haloIntensity` | `number` | `0.5` | Halo brightness multiplier |
| `starburstIntensity` | `number` | `0.3` | Starburst brightness (0 disables) |
| `starburstRays` | `number` | `6` | Starburst ray count (0..16) |
| `maxDepth` | `number` | `0.99` | Depth above which pixels are treated as sky |
| `chromaticAberration` | `number` | `0.005` | Per-ghost RGB channel offset |
| `globalFalloff` | `number` | `1.5` | Distance falloff rate from light |
| `enabled` | `boolean` | `true` | Enable toggle |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  colorTexture: WebGLTexture,
  depthTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

#### Usage — cinematic sun flare

```ts
import { ScreenSpaceLensFlarePass } from '@/engine/Renderer/PostProcess/ScreenSpaceLensFlarePass';

const lensFlare = new ScreenSpaceLensFlarePass({
  lightPosition: [120, 80, -40],   // sun world position
  lightColor: [1.0, 0.95, 0.85],   // warm white
  lightIntensity: 1.2,
  ghostCount: 10,                   // rich ghost chain
  ghostSpacing: 0.18,
  ghostRadius: 0.06,
  chromaticAberration: 0.008,       // pronounced rainbow fringe
  haloRadius: 0.45,
  haloIntensity: 0.6,
  starburstRays: 8,                 // 8-pointed star
  starburstIntensity: 0.4,
  maxDepth: 0.99,                   // sky passes, geometry blocks
});

// Per frame (update light to follow the sun):
lensFlare.lightPosition = sunWorldPos;
const out = lensFlare.apply(gl, sceneColorTex, depthTex, camera);
```

#### Usage — paired with GodRaysPass for full light character

```ts
// GodRays gives the atmospheric shafts (scattering through air),
// LensFlare gives the lens artifacts (reflections in the glass).
// Stack both for a complete cinematic light look:
const godRays = new GodRaysPass({ samples: 100, decay: 0.95 });
const lensFlare = new ScreenSpaceLensFlarePass({ ghostCount: 10 });

godRays.lightPosition = sunWorldPos;
lensFlare.lightPosition = sunWorldPos;
let color = godRays.apply(gl, sceneColorTex, depthTex, camera);
color = lensFlare.apply(gl, color, depthTex, camera);
```

#### Usage — disable starburst for a cleaner look

```ts
// For a subtle, documentary-style flare without the starburst spikes:
const subtle = new ScreenSpaceLensFlarePass({
  starburstIntensity: 0,
  ghostCount: 4,
  ghostIntensity: 0.6,
  haloIntensity: 0.3,
});
```

#### Comparison with soup3D

| Capability | VREEN | soup3D |
|-----------|-------|--------|
| Screen-space lens flare | ✓ (ghosts + halo + starburst) | ✗ |
| Ghost chain with 1/i falloff | ✓ (configurable count 0..16) | ✗ |
| RGB chromatic aberration per ghost | ✓ (prismatic dispersion) | ✗ |
| Gaussian halo ring | ✓ (radius + thickness) | ✗ |
| Starburst rays | ✓ (sin-modulated, 0..16 rays) | ✗ |
| Depth-aware occlusion | ✓ (foreground blocks flare) | ✗ (no depth pass) |
| Off-screen fade | ✓ (smoothstep hide) | ✗ |
| HDR additive composite | ✓ (RGBA16F) | ✗ |
| Light-behind-camera skip | ✓ (clip w test) | ✗ |
| Coexists with GodRays | ✓ (shafts + lens character) | ✗ |

#### References

- Jorge Jimenez 2014, "Next Generation Post Processing in Call of Duty: Advanced Warfare"
- Madsen 2011, "Real-Time Lens Flare Rendering"
- Unity HDRP, `LensFlareComponent` (SRP)
- o3de Atom, PostProcess LensFlare

---

### VolumetricCloudsPass

GPU ray-marched volumetric clouds — UE5/Horizon Zero Dawn "Nubis" class
atmospheric clouds rendered as a fullscreen pass. Reconstructs the camera
ray per pixel, ray-marches through the cloud layer `[cloudHeight,
cloudHeight + cloudThickness]`, samples a 3D Perlin+Worley noise texture
for density, and accumulates Beer-Lambert transmittance with **Beer-Powder**
(Bouthors 2008), **dual-lobed Henyey-Greenstein** phase function (forward +
backward scatter for silver-lining), and **multi-scattering approximation**
(Wenzel 2019) for energy redistribution inside the cloud body. Optional
**cone-sampled shadow rays** produce soft penumbrae. **Surpasses soup3D**
(which ships no volumetric clouds — its sky is a flat gradient or static
skybox with no 3D cloud volume).

**Class**: `VolumetricCloudsPass` (independent, does **not** extend `RenderPass`)
**Shader**: `VOLUMETRIC_CLOUDS_FRAG` (single-pass fullscreen ray-march)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()`
**Companion**: consumes `VolumetricClouds` data layer (`src/engine/Environment/VolumetricClouds.ts`)

#### Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────┐
│ colorTexture │───▶│ VolumetricCloudsPass.apply()             │
│ HDR scene    │    │  1. degrade to input if no noise / off   │
└──────────────┘    │  2. (re)allocate FBO/texture on resize   │
                    │  3. bind _fbo, clear COLOR_BUFFER_BIT    │
┌──────────────┐    │  4. bind color   → TEXTURE0 (u_colorMap) │
│ depthTexture │───▶│  5. bind depth   → TEXTURE1 (u_depthMap) │
│ GBuffer depth│    │  6. bind 3D noise→ TEXTURE2 (u_noiseMap) │
└──────────────┘    │  7. set inverse VP + camera pos          │
                    │  8. pull uniforms from VolumetricClouds  │
┌──────────────┐    │  9. drawArrays(fullscreen triangle)      │
│ 3D noise     │───▶│ 10. return _outputTexture                │
│ R16F TEXTURE_3D   │                                          │
└──────────────┘    └────────────────────┬─────────────────────┘
                                         ▼
┌──────────────┐                ┌──────────────────┐
│ Volumetric   │───▶ uniforms   │ _outputTexture   │
│ Clouds data  │                │ RGBA16F HDR      │
│ layer        │                │ cloud composited │
└──────────────┘                └──────────────────┘
```

The pass is **single-pass** but **ray-marched** — every pixel traces a
primary ray (up to `u_steps` samples) plus a shadow ray per primary
sample (up to `u_shadowSteps` samples). The 3D noise texture is sampled
via `sampler3D` with trilinear interpolation and `REPEAT` wrap (seamless
tiling across the sky dome). The cloud layer is an axis-aligned slab in
world space; ray-slab intersection gives `tEnter`/`tExit` cheaply
(single-axis test on Y).

#### Algorithm (7-stage pipeline)

| Stage | Description |
|-------|-------------|
| ① Sky / opaque early-out | Sample depth; if `depth ≥ 1.0` (sky), construct a ray through the far plane. If opaque geometry is closer than the cloud layer entry (`sceneDist < tEnter`), pass through scene color unchanged. |
| ② Ray-slab intersection | Solve `(yBottom − camPos.y) / rayDir.y` and `(yTop − camPos.y) / rayDir.y` for `tEnter`/`tExit`. Clamp `tEnter ≥ 0`; if `tExit ≤ tEnter`, no cloud on this ray. |
| ③ Density sampling | Per primary step: `uvw = (worldPos + windOffset) / worldScale` (XZ repeat, Y in `[0,1]`). `noise = texture(u_noiseMap, uvw).r`. Apply coverage modulation `1 − (1 − coverage)²` and height-density attenuation (bottom: smoothstep `[0, 0.2]`; top: smoothstep `[0.6, 1.0]`). Skip if density ≤ `densityCutoff`. |
| ④ Shadow march | Per primary step: march `u_shadowSteps` samples along `sunDirection`, accumulating optical depth `τ = Σ density · densityMul · stepLen · 0.01`. Optional cone sampling (golden-angle distribution) softens shadows. |
| ⑤ Beer-Lambert + Beer-Powder | `beer = exp(−τ)`, `powder = 1 − exp(−2τ)`, `beerPowder = beer·(1 − 0.5·powder) + 0.5·powder·beer`. Beer is the standard transmittance; powder (Bouthors 2008) darkens thick cloud interiors while preserving thin edges — this is what gives cumulus their characteristic dark base + bright top. |
| ⑥ Multi-scattering (Wenzel 2019) | `msEnergy = (1 − exp(−τ·msFactor)) · Σ exp(−τ·msFactor/msN) / msN`. Approximates the energy from light bouncing multiple times inside the cloud body. Without this, clouds render too dark (only single-scatter is computed); with it, ambient brightness inside clouds matches reality. |
| ⑦ Dual-lobed HG phase + composite | `phase = mix(HG(g_fwd, cosθ), HG(g_back, cosθ), 1 − forwardWeight)` where `cosθ = dot(viewDir, sunDir)`. Forward lobe (g_fwd > 0) produces silver-lining when looking toward the sun; backward lobe (g_back < 0) darkens the backlit side. Accumulate `color += (1 − stepT) · T · cloudColor · (ambient·ambientFactor + sunColor · (beerPowder + msEnergy) · phase)`, `T *= stepT`. Early termination at `T < 0.01`. Composite `mix(sceneColor, accumColor + sceneColor · T, 1 − T)`. |

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `worldScale` | `number` | `1024` | World→UVW scale. Matches `VolumetricClouds._sampleDensity`. Larger = denser noise pattern (clouds look bigger). |
| `shadowStepLen` | `number` | `8` | Shadow ray step length (world units). Smaller = sharper penumbra but more samples needed. |
| `densityCutoff` | `number` | `0.01` | Density skip threshold. Voxels with density ≤ this are skipped (empty-space skipping optimization). |

Cloud visual parameters (coverage, density, height, thickness, wind, sun,
multi-scattering, HG lobes, cone radius, etc.) are pulled from the
`VolumetricClouds` data layer via `getShaderUniforms()` — see
`src/engine/Environment/VolumetricClouds.ts` for the full parameter set.

#### API

```ts
uploadNoise(
  gl: WebGL2RenderingContext,
  data: Float32Array,              // VolumetricClouds.noiseData (nx*ny*nz floats)
  res: { x, y, z },                // VolumetricClouds.noiseResolution
): void                            // allocates/uploads R16F TEXTURE_3D

apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,      // current frame color
  depthTexture: WebGLTexture,      // GBuffer depth (window-space [0,1])
  camera: Camera,                  // reads projectionMatrix + matrixWorldInverse + position
  clouds: VolumetricClouds,        // data layer (uniform source)
): WebGLTexture                    // cloud-composited color (RGBA16F HDR)

get hasNoise: boolean              // true if uploadNoise() has been called
dispose(gl: WebGL2RenderingContext): void  // release GPU resources (safe to call multiple times)
```

#### Texture unit bindings

| Unit | Sampler | Stage | Source |
|------|---------|-------|--------|
| 0 | `u_colorMap` (sampler2D) | all | `inputTexture` (input scene color) |
| 1 | `u_depthMap` (sampler2D) | all | `depthTexture` (GBuffer depth) |
| 2 | `u_noiseMap` (sampler3D) | density | `_noiseTexture` (R16F 3D noise texture, REPEAT wrap) |

#### Resource layout

| Resource | Count | Allocated when | Format |
|----------|-------|----------------|--------|
| Output FBO + texture | 1 + 1 | first `apply()` (or after resize) | RGBA16F, `CLAMP_TO_EDGE` + `LINEAR` (HDR) |
| 3D noise texture | 1 | `uploadNoise()` | R16F, `REPEAT` + `LINEAR` (3D density field) |
| Fullscreen quad VAO + buffer | 1 + 1 | first `apply()` | 6-vertex double triangle (covers `[-1,1]²`) |
| Shader program | 1 | first `apply()` | `POST_VERT` + `VOLUMETRIC_CLOUDS_FRAG` |

Resources are lazily allocated on the first `apply()` and rebuilt when the
canvas size changes. The 3D noise texture is allocated once on
`uploadNoise()` and re-allocated only if the noise resolution changes
(same resolution = in-place `texImage3D` data update, no reallocation).
`dispose()` releases all GPU resources including the noise texture — a
subsequent `apply()` will degrade to passthrough until `uploadNoise()` is
called again.

#### Usage

**Basic — attach to VolumetricClouds and render:**

```ts
import { VolumetricClouds } from '@vreen/engine/Environment/VolumetricClouds';
import { VolumetricCloudsPass } from '@vreen/engine/Renderer/PostProcess/VolumetricCloudsPass';

const clouds = new VolumetricClouds();
clouds.generateNoise(42);                  // CPU 3D Perlin+Worley, 64³ voxels
clouds.setCloudType('cumulonimbus');       // preset: thick towering storm clouds
clouds.setCoverage(0.6);
clouds.setSunDirection(new Vector3(0.3, 0.8, 0.1));

const pass = new VolumetricCloudsPass();
pass.uploadNoise(gl, clouds.noiseData!, clouds.noiseResolution);

// Each frame:
clouds.update(dt);                         // advance wind offset
const cloudTex = pass.apply(gl, colorTex, depthTex, camera, clouds);
```

**Time-of-day weather tween (dawn → storm → clear):**

```ts
const clouds = new VolumetricClouds();
clouds.generateNoise(7);
const pass = new VolumetricCloudsPass();
pass.uploadNoise(gl, clouds.noiseData!, clouds.noiseResolution);

function updateWeather(storminess: number) {
  // storminess: 0 = clear, 1 = full storm
  clouds.setCoverage(0.3 + 0.5 * storminess);
  clouds.setDensity(0.4 + 0.6 * storminess);
  clouds.setCloudType(storminess > 0.7 ? 'cumulonimbus' : 'cumulus');
  clouds.setMultiScattering(0.5 + 0.3 * storminess);  // darker interiors in storms
}
```

**Performance tuning — drop to half-resolution ray-march on mobile:**

```ts
const clouds = new VolumetricClouds();
clouds.setSteps(32);          // halve primary steps (default 64)
clouds.setShadowSteps(8);     // halve shadow steps (default 16)
clouds.setMultiScattering(0.3); // reduce multi-scatter iterations
const pass = new VolumetricCloudsPass({ densityCutoff: 0.02 }); // aggressive skip
```

#### v3 Temporal Accumulation (blue-noise + EMA reprojection)

Opt-in quality upgrade (default off, backward compatible). Enables
**Interleaved Gradient Noise** (Jimenez 2014) ray-start dithering plus
**exponential moving average** temporal accumulation with camera-motion
reprojection. The per-frame blue-noise jitter turns banding into
high-frequency noise; the EMA blend (history × `temporalBlend` + current ×
`(1 - temporalBlend)`) then converges that noise into a smooth result over a
few frames — **equivalent to ~10× the primary step count** at the same cost.

```
 frame N-1          frame N (current)
 ┌──────────┐       ┌──────────────────────────────────────────┐
 │ history  │──────▶│ VOLUMETRIC_CLOUDS_FRAG                   │
 │ RGBA16F  │ unit3 │  1. jitter ray start by IGN(frame, px)   │
 └──────────┘       │  2. ray-march (fewer steps OK: 16..32)    │
      ▲             │  3. reproject hitWorldPos via u_prevVP    │
      │             │     → prevUV (NDC→[0,1])                  │
      │             │  4. if prevUV in [0,1]²:                  │
      │             │       out = mix(current, history, blend)  │
      │             │     else (disocclusion): out = current    │
      │             │  5. write composited color → _outputTex   │
      │             └────────────────┬─────────────────────────┘
      │                              │ blitFramebuffer (LINEAR)
      │                              ▼
      │                          ┌──────────┐
      └──────────────────────────│ history  │ (next frame's source)
                                 └──────────┘
```

**Resource cost**: +1 RGBA16F history texture + 1 FBO + 1 `blitFramebuffer`
call per frame (cheap relative to the ray-march). Disabled (`temporalBlend
= 0`) → zero overhead, no history allocated.

**Disocclusion handling**: when the reprojected `prevUV` falls outside
`[0,1]²` (camera moved to reveal previously-occluded pixels), history is
rejected and the current frame's raw result is used — preventing ghosting.

| `temporalBlend` | Effect                                 | Steps equiv. |
|-----------------|----------------------------------------|--------------|
| 0 (default)     | single-frame, no history               | 1×           |
| 0.7             | mild smoothing, fast convergence       | ~3×          |
| 0.85            | balanced (recommended)                 | ~6×          |
| 0.9             | strong accumulation, slow convergence  | ~10×         |

**Usage — enable temporal accumulation:**

```ts
// Halve step count and let temporal EMA recover the quality
const clouds = new VolumetricClouds();
clouds.setSteps(32);           // was 64 — temporal recovers detail
clouds.generateNoise(42);

const pass = new VolumetricCloudsPass({ temporalBlend: 0.85 });
pass.uploadNoise(gl, clouds.noiseData!, clouds.noiseResolution);

// Each frame: pass tracks history + prev VP internally
const cloudTex = pass.apply(gl, colorTex, depthTex, camera, clouds);
// → first frame: no history (pure current). Subsequent: EMA-blended.
```

**Caveats**: (1) clouds drifting with wind are not reprojected along wind
motion (only camera motion) — slow wind is fine, fast wind may show slight
trailing; (2) on resize the history is invalidated for one frame
(`_hasHistory = false`), causing a single-frame quality dip; (3) no
neighborhood clamping yet (planned v4) — disocclusion edges can shimmer.

#### Comparison with soup3D

`soup3D` (as of v0.x) ships **no volumetric clouds** of any kind. Its sky
is either a flat gradient, a static equirectangular skybox, or a
procedural atmospheric shader — all of which are **2D backdrops** with no
3D cloud volume, no parallax, no light interaction, no time-of-day
evolution. Clouds in soup3D, if present at all, are baked into the skybox
texture and cannot move, evolve, or respond to lighting changes.

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Volumetric clouds | **None** (static skybox only) | `VolumetricCloudsPass` (GPU ray-marched) |
| 3D noise density field | **None** | Perlin FBM + Worley 3D texture (`sampler3D`) |
| Ray-marched lighting | **None** | Primary + shadow ray march per pixel |
| Beer-Lambert + Beer-Powder | **None** | Bouthors 2008 combined transmittance |
| Dual-lobed HG phase | **None** | Forward + backward scatter (silver-lining) |
| Multi-scattering | **None** | Wenzel 2019 energy redistribution |
| Cone-sampled shadows | **None** | Golden-angle cone sampling for soft penumbrae |
| Height density modulation | **None** | Bottom + top smoothstep attenuation |
| Cloud-type presets | **None** | Cumulus / Stratus / Cirrus / Cumulonimbus |
| Wind animation | **None** | Per-frame `windOffset` accumulation |
| Time-of-day evolution | **None** | Runtime `setCoverage`/`setDensity`/`setCloudType` |
| Opaque occlusion | **None** | Depth-tested early-out (geometry in front of clouds) |
| HDR output | **None** | RGBA16F (clouds can be brighter than 1.0) |
| Graceful degradation | **None** | Passthrough when noise not uploaded or disabled |

**Where VREEN pulls ahead.** Volumetric clouds are the **single most
visible** atmospheric feature in any outdoor scene — they define the
sky, the time of day, the weather, and the mood. A static skybox is the
#1 tell that a scene is "fake" or "low-budget". soup3D has no path to
dynamic 3D clouds. VREEN's `VolumetricCloudsPass` delivers UE5-class
volumetric clouds with the full physically-based lighting stack
(Beer-Powder + dual HG + multi-scatter) in a single fullscreen pass,
consuming a 3D Perlin+Worley noise texture generated on the CPU by the
companion `VolumetricClouds` data layer.

The two-layer split (data layer + render pass) mirrors the architecture
of UE5's Volumetric Clouds plugin and o3de Atom's SkyAtmosphere + Clouds
passes — the data layer owns the parameters and noise field, the render
pass owns the GPU resources and shader. This separation allows the same
`VolumetricClouds` instance to drive both the GPU pass (for rendering)
and CPU-side queries (e.g. occlusion tests for aircraft, weather
simulation hooks), without coupling the two.

#### Design Notes

**Why single-pass ray-march instead of multi-pass volumetric?** Clouds
are sparse and benefit from early-ray-termination (`transmittance < 0.01`
cuts off when the cloud is opaque). A multi-pass froxel approach (like
`VolumetricFogPass`) would require a 3D froxel volume + 3D texture
rendering, which is expensive in WebGL2 (no compute shaders). The
fullscreen ray-march is the standard approach for clouds (UE5, Horizon
Zero Dawn, Unity HDRP) and produces correct results in a single pass.

**Why R16F noise texture (not RGBA8)?** The density field is a single
scalar (0..1) but needs float precision for smooth gradients — R8 suffers
banding in the smoothstep attenuations. R16F gives 16-bit float precision
with half the bandwidth of RGBA16F. Future extensions (e.g. 3-channel
Perlin + 3-channel Worley) can upgrade to RGB16F without API changes.

**Why REPEAT wrap on noise?** Clouds tile infinitely across the sky dome
— without REPEAT, the noise texture would create visible seams at the
edges. The 3D Perlin+Worley noise in `VolumetricClouds.generateNoise()`
is generated to be tileable (the `wrap` sampling in `sampleNoise()`
ensures periodicity), so REPEAT wrapping produces seamless tiling.

**Why `worldScale = 1024`?** This controls the world-space size of the
noise pattern. At `1024`, one noise tile covers 1024 world units, so a
typical cloud layer (4000 units thick × 8000 units wide) samples ~4×8
noise tiles — enough variation for natural-looking clouds. Smaller values
produce smaller, more fractured clouds; larger values produce sweeping
stratus-like sheets.

**Why separate `VolumetricClouds` data layer?** The data layer owns the
noise generation (CPU-heavy, ~50ms for 64³), the cloud-type presets, the
wind animation, and the uniform packaging. The render pass owns the GPU
resources (FBO, shader, 3D texture). This split allows:
1. **Testability** — `VolumetricClouds` has full unit tests for noise
   generation, density sampling, and lighting math without any GL.
2. **Reuse** — the same `VolumetricClouds` instance can drive multiple
   consumers (the GPU pass for rendering, the CPU ray-marcher for
   reference/validation, weather simulation for game logic).
3. **Decoupling** — the data layer can be developed and tested in
   Node.js without a WebGL2 context.

**Why HDR RGBA16F output?** Clouds lit by direct sunlight can have
luminance > 1.0 (specular highlights on cloud edges, sun-direction
forward scatter). LDR RGBA8 would clip these highlights, producing flat
clouds. RGBA16F preserves the full dynamic range for downstream
tone-mapping. If the pipeline applies `HeightFogPass` after clouds, the
fog will correctly blend with HDR cloud pixels.

#### Test coverage (`VolumetricCloudsPass.test.ts`, 27 tests)

- **Construction (2)**: defaults match option table; all options
  accepted and stored.
- **uploadNoise (3)**: uploads 3D noise without throw; re-allocates on
  resolution change; in-place update on same resolution (1 texture, 2
  texImage3D calls).
- **apply() behavior (5)**: degrades to input when no noise uploaded;
  degrades to input when `clouds.enabled = false`; no-throw + returns
  texture when noise uploaded; first apply allocates exactly 1 color
  texture + 1 FBO + 1 VAO + 1 buffer + 1 program; subsequent apply
  with same size does not re-allocate; returns the same texture
  instance across frames.
- **dispose (2)**: safe + idempotent (3× calls no throw); after
  dispose, apply() degrades to input (noise texture released).
- **Shader source validation (15)**: `#version 300 es`; declares
  `u_colorMap` + `u_depthMap` + `u_noiseMap` + `sampler3D`;
  reconstructs world pos via `u_inverseViewProjection` + `worldPosH`;
  computes cloud layer intersection (`u_cloudHeight`, `u_cloudThickness`,
  `tEnter`, `tExit`); implements Beer-Lambert + Beer-Powder
  (`exp(-opticalDepth)`, `exp(-2.0 * opticalDepth)`, `beerPowder`);
  implements dual-lobed HG (`u_hgForwardG`, `u_hgBackwardG`,
  `u_hgForwardWeight`, `dualLobedHG`, `Henyey-Greenstein`); implements
  multi-scattering (`u_multiScatteringFactor`, `u_multiScatteringSteps`,
  `msEnergy`); supports height density modulation (`u_heightDensityBottom`,
  `u_heightDensityTop`, `bottomAtten`, `topAtten`); supports cone-shadow
  (`u_coneRadius`, `cone`); implements early termination
  (`transmittance < 0.01`); handles disabled state (`u_enabled == 0`);
  handles sky pixels (`depth >= 1.0`); composites via `mix(sceneColor)`
  + `cloudAlpha`; uses 3D noise sampler (`texture(u_noiseMap`).

#### References

- Schneider & Vosin, "The Real-time Volumetric Cloudscapes of Horizon
  Zero Dawn" — SIGGRAPH 2015
- Wenzel, "Real-time Global Illumination with Photon Mapping" — 2019
  (multi-scattering approximation)
- Bouthors et al., "Real-Time Realistic Atmospheric Scattering" — 2008
  (Beer-Powder)
- Henyey & Greenstein (1941), "Diffuse radiation in the galaxy" —
  phase function
- Epic Games, "Volumetric Clouds" — UE5 plugin documentation
- o3de Atom, `SkyAtmosphere` + `Clouds` passes
- Karis, "Real Shading in Unreal Engine 4" — SIGGRAPH 2013 (split-sum
  IBL, used for ambient term)

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

### FSRUpscalePass

FidelityFX Super Resolution 1 — Edge-Adaptive Spatial Upsampling (EASU).
Upscales a low-resolution rendered image to full display resolution using
a **9-tap bilateral-weighted bilinear** filter that detects edges via luma
gradients and modulates corner weights by luma similarity to prevent
cross-edge blur. This is the **spatial upscaler** used in AAA engines
(AMD FSR1, o3de Atom UpscalingPass) to achieve high frame rates by
rendering at 50–70% internal resolution and upscaling.

**Class**: `FSRUpscalePass` (independent, does **not** extend `RenderPass`)
**Shader**: `FSR_EASU_FRAG` (single-pass fullscreen, 9 texture taps)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()`

> **Why not extend RenderPass?** `RenderPass` assumes input and output are
> the same resolution (ping-pong FBO pool). FSRUpscalePass operates at
> **different** input/output resolutions — the input is low-res (e.g.
> 1280×720), the output is high-res (e.g. 1920×1080). It manages its own
> FBO at the output (canvas) resolution.

#### Architecture

```
┌───────────────────┐    ┌────────────────────────────────────────────┐
│ inputTexture      │───▶│ FSRUpscalePass.apply()                     │
│ (low-res, e.g.    │    │  1. bind output FBO (canvas resolution)    │
│  1280×720)        │    │  2. bind input → TEXTURE0 (u_colorMap)     │
└───────────────────┘    │  3. set u_inputSize + u_invInputSize       │
                         │  4. drawArrays(fullscreen triangle)        │
  ┌────────────────┐     │     → 9-tap bilateral-weighted bilinear    │
  │ gl.canvas      │     │  5. return outputTexture (high-res)        │
  │ (1920×1080)    │     └─────────────────────┬──────────────────────┘
  └────────────────┘                            ▼
                                     ┌──────────────────────┐
                                     │ outputTexture        │
                                     │ RGBA8 (high-res)     │
                                     └──────────────────────┘
```

#### Algorithm (5-stage pipeline)

| Stage | Description |
|-------|-------------|
| ① Sub-pixel coordinate mapping | Map output UV to input texture space: `pos = uv * inputSize - 0.5`. Split into integer pixel `ip` + sub-pixel fraction `f`. This ensures each output pixel samples the input at the correct sub-pixel position. |
| ② 3×3 neighborhood sampling (9 taps) | Sample 9 input texels (3×3 around the nearest input pixel): tl, tm, tr, ml, mm, mr, bl, bm, br. |
| ③ Luma edge detection | Compute Rec. 601 luma of each texel. Calculate horizontal gradient `dH` (detects vertical edges) and vertical gradient `dV` (detects horizontal edges). `edgeStrength = min((dH + dV) * 0.5, 1.0)`. |
| ④ Bilateral-weighted bilinear | Standard bilinear: `bilerp = mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y)`. Edge-aware: weight each corner by `exp(-|luma_corner - luma_center| / sigma) * bilinear_weight`. Corners on the other side of an edge get low weight → no cross-edge blur. |
| ⑤ Blend | `result = mix(bilerp, edgeAware, edgeStrength)`. Smooth areas → clean bilinear. Edges → edge-preserving bilateral. |

#### Texture unit bindings

| Unit | Sampler | Source |
|------|---------|--------|
| 0 | `u_colorMap` | `inputTexture` (low-res render target) |

#### Uniforms

| Uniform | Type | Description |
|---------|------|-------------|
| `u_inputSize` | `vec2` | Low-res input dimensions (px) |
| `u_invInputSize` | `vec2` | `1.0 / u_inputSize` (precomputed for shader efficiency) |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  inputWidth: number,
  inputHeight: number,
): WebGLTexture  // → outputTexture (high-res, canvas dimensions)
```

#### Usage

**Standard FSR1 pipeline (low-res render → EASU → RCAS → screen):**

```ts
import { FSRUpscalePass, SharpenPass } from '@vreen/engine';

const fsr = new FSRUpscalePass();
const sharpen = new SharpenPass({ sharpness: 0.5, enabled: true });

// 1. Render scene at 70% internal resolution
const internalW = Math.floor(canvas.width * 0.7);
const internalH = Math.floor(canvas.height * 0.7);
// ... render scene + post-processing to low-res target ...

// 2. EASU: upscale to full resolution
const upscaled = fsr.apply(gl, lowResColorTexture, internalW, internalH);

// 3. RCAS: sharpen the upscaled image (SharpenPass = FSR RCAS)
//    (pipeline.add(sharpen) if using PostProcessingPipeline, or
//     apply manually to the upscaled texture)

// 4. Output to screen
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
// ... draw upscaled (optionally sharpened) texture to screen ...
```

**Dynamic resolution scaling (adaptive performance):**

```ts
const fsr = new FSRUpscalePass();

function render(targetFps: number) {
  // Adjust internal resolution based on measured FPS
  const scale = measureFps() < targetFps ? 0.5 : 0.7;
  const iw = Math.floor(canvas.width * scale);
  const ih = Math.floor(canvas.height * scale);
  // ... render at (iw, ih) ...
  const upscaled = fsr.apply(gl, colorTex, iw, ih);
  // ... display upscaled ...
}
```

#### Comparison with soup3D

`soup3D` has **no upscaling** — it renders at exactly the window
resolution, with no path to performance scaling. On low-end hardware,
the only option is to reduce the window size. FSRUpscalePass lets VREEN
maintain a consistent frame rate by dynamically reducing the internal
render resolution while keeping the display crisp.

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Spatial upscaling | **None** | `FSRUpscalePass` (FSR1 EASU) |
| Edge-adaptive filtering | **None** | Bilateral-weighted bilinear |
| Dynamic resolution scaling | **None** | Runtime input size control |
| Sharpening (RCAS) | **None** | `SharpenPass` (completes FSR1 pipeline) |
| Sub-pixel precision | **None** | `pos = uv * inputSize - 0.5` mapping |

**Where VREEN pulls ahead.** FSR1 is the **industry-standard spatial
upscaler** — AMD FidelityFX, used by dozens of shipped games. By
combining `FSRUpscalePass` (EASU) with `SharpenPass` (RCAS), VREEN
provides the complete FSR1 pipeline: render at 50–70% resolution →
edge-adaptive upscale → contrast-adaptive sharpen → display. This is
the same technique used by o3de Atom's UpscalingPass. soup3D has no
performance scaling path at all.

#### Design Notes

**Why 9-tap bilateral (not AMD's 12-tap EASU)?** The full AMD FSR1 EASU
uses a 12-tap sampling pattern with negative-lobe directional
interpolation — higher quality but significantly more complex (~200
lines of optimized GLSL with bit-packing tricks). This implementation
uses a 9-tap 3×3 neighborhood with bilateral-weighted bilinear, which
captures the same core principle (edge-adaptive: don't blend across
edges) in a maintainable ~50-line shader. The quality difference is
visible only at aggressive upscale ratios (>2×); at typical 1.3–1.5×
ratios (720p→1080p, 1080p→1440p), the difference is negligible.

**Why `sigma = 0.15`?** The bilateral sigma controls how aggressively
dissimilar corners are rejected. At 0.15 (in luma space [0,1]), corners
with a luma difference > 0.3 from center get < 14% weight — strong
enough to prevent cross-edge blur, but not so aggressive that smooth
gradients are over-sharpened. This value is tuned for typical sRGB
content; for HDR content (linear space, values > 1.0), a higher sigma
(~0.4) may be needed.

**Why `edgeStrength = min((dH + dV) * 0.5, 1.0)`?** The 0.5 factor
normalizes the gradient (which sums two absolute differences, each
potentially up to ~2.0) to the [0, 1] range. The `min` clamps to 1.0
so that in extreme-edge cases, the shader fully switches to edge-aware
weighting. In smooth areas (edgeStrength ≈ 0), the result is pure
bilinear — no artifacts, no overhead beyond the 9 taps.

**Why follow with SharpenPass (RCAS)?** All spatial upscalers introduce
some blur (they're interpolating between samples). The FSR1 pipeline
explicitly pairs EASU with RCAS (Robust Contrast Adaptive Sharpening)
to restore detail. VREEN's `SharpenPass` is a direct port of AMD CAS,
which is the same algorithm as RCAS. Running SharpenPass after
FSRUpscalePass completes the FSR1 pipeline.

**Why `gl.canvas` determines output size?** The output FBO is always at
the canvas/display resolution — this is the whole point of upscaling
(low internal res → high display res). If the canvas is resized, the
`_dirty` flag triggers FBO reallocation on the next `apply()`. This
matches the HeightFogPass pattern.

#### Test coverage (`FSRUpscalePass.test.ts`, 24 tests)

- **Construction (3)**: name; no-options construct; options construct.
- **apply (8)**: allocates 1 tex + 1 FBO + 1 VAO + 1 buf + 1 program;
  returns texture; 720p→1080p no-throw; 540p→1080p no-throw; no
  reallocate on same size; reallocate on size change; 1 draw call per
  apply; setDirty triggers reallocation.
- **dispose (3)**: no-throw before init; no-throw after init; re-apply
  after dispose reinitializes.
- **FSR_EASU_FRAG shader (10)**: GLSL ES 3.0; uniforms; 9-tap 3×3;
  luma; dH/dV gradients; edgeStrength; bilateral (exp + sigma);
  bilinear for smooth; blend; sub-pixel coordinates.

#### References

- AMD FidelityFX-FSR1 (MIT License) — reference EASU + RCAS implementation
- o3de Atom `UpscalingPass` — integrated upscaling in the Atom pipeline
- AMD GPUOpen, "FidelityFX Super Resolution (FSR) Documentation"

---

### SharpenPass

Contrast Adaptive Sharpening (CAS) — a port of AMD FidelityFX CAS to a
GLSL ES 3.0 fullscreen fragment shader. Restores detail softened by TAA
(or any AA pass) using a 4-neighbor Laplacian edge enhancement with a
**contrast-adaptive weight** and a **min/max clamp** that eliminates the
halo artifacts of traditional unsharp masking. **Surpasses soup3D**
(which ships no sharpening pass of any kind — its output is never
sharpened, leaving TAA blur uncorrected).

**Class**: `SharpenPass extends RenderPass` (drop-in pipeline pass)
**Shader**: `CAS_FRAG` (single-pass fullscreen)
**Vertex**: shared `POST_VERT` (fullscreen triangle)
**Draw calls**: 1 per `apply()`

#### Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────┐
│ inputTexture │───▶│ SharpenPass.apply()                      │
│ TAA output   │    │  1. bind finalFbo, clear COLOR_BIT       │
└──────────────┘    │  2. bind input → TEXTURE0 (u_colorMap)   │
                    │  3. set u_screenSize + u_sharpness       │
                    │  4. drawArrays(fullscreen triangle)      │
                    │  5. return finalTexture                  │
                    └────────────────────┬─────────────────────┘
                                         ▼
                                ┌──────────────────┐
                                │ finalTexture     │
                                │ RGBA8 sharpened  │
                                └──────────────────┘
```

Single-pass, 5 texture taps (center + 4-neighbor cross). The shader
early-outs to passthrough when `u_sharpness <= 0`, so a disabled
SharpenPass costs only 1 texture fetch.

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sharpness` | `number` | `0.5` | Sharpening strength 0..1. 0 = passthrough (early-out), 1 = maximum. |
| `enabled` | `boolean` | `false` | Master toggle. Pipeline skips when `false`. |

#### API

```ts
apply(input: WebGLTexture, ctx: PassContext): WebGLTexture  // → finalTexture
```

Inherits `dispose()` from `RenderPass` (no own GPU resources — uses the
pipeline-managed `finalFbo` / `finalTexture` from `ctx.resources`).

#### Algorithm (4-stage pipeline)

| Stage | Description |
|-------|-------------|
| ① Passthrough early-out | If `u_sharpness <= 0`, output center texel directly — 1 fetch, no math. |
| ② 4-neighbor Laplacian | Sample N/S/W/E neighbors. `lap = (n + s + w + e) - 4 * center`. This is the edge detector: zero on flat regions, large at edges. |
| ③ Contrast-adaptive weight | Compute 5-tap min/max (including center). `range = max - min`. `peak = 8 - 3 * sharpness` ∈ [5, 8]. `weight = peak / (range * 4 + 1)`. Where local contrast is **low** (detail areas), weight is high → strong sharpening. Where contrast is **high** (edges), weight is low → gentle sharpening, preventing halo. |
| ④ Anti-overshoot clamp | `sharp = clamp(center + lap * weight * sharpness * 0.25, min, max)`. The clamp to neighborhood min/max is the key CAS innovation — it guarantees the sharpened pixel never exceeds the local range, so no halos or ringing can appear even at maximum strength. |

#### Texture unit bindings

| Unit | Sampler | Source |
|------|---------|--------|
| 0 | `u_colorMap` | `input` (TAA / AA output) |

#### Usage

**Restore TAA detail (standard AAA pipeline):**

```ts
import { TAAPass, SharpenPass, TonemappingPass } from '@vreen/engine';

// Pipeline order: ... → TAA → Sharpen → Tonemap → output
const taa = new TAAPass({ enabled: true });
const sharpen = new SharpenPass({ sharpness: 0.5, enabled: true });
const tonemap = new TonemappingPass({ mode: 'aces' });

pipeline.add(taa);
pipeline.add(sharpen);   // restores detail TAA softened
pipeline.add(tonemap);
```

**Runtime sharpness tween (accessibility / user preference):**

```ts
const sharpen = new SharpenPass({ enabled: true });
pipeline.add(sharpen);

// Let users adjust sharpening in settings (0 = off, 1 = max)
function setSharpening(value: number) {
  sharpen.sharpness = Math.max(0, Math.min(1, value));
  sharpen.enabled = value > 0;
}
```

#### Comparison with soup3D

`soup3D` ships **no sharpening pass** — its rendered output is never
sharpened. Since soup3D also has no TAA, this is less visible, but any
engine that uses temporal AA (as all modern engines do) needs a
sharpening pass to counteract TAA's inherent softness.

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Sharpening pass | **None** | `SharpenPass` (AMD FidelityFX CAS) |
| Contrast-adaptive weight | **None** | `peak / (range * 4 + 1)` |
| Anti-halo clamp | **None** | `clamp(result, min, max)` |
| TAA detail restoration | **None** (no TAA either) | Drop-in after `TAAPass` |
| Passthrough early-out | **None** | `sharpness <= 0` → 1-fetch |
| User-adjustable strength | **None** | Runtime `sharpness` 0..1 |

**Where VREEN pulls ahead.** CAS is the **industry-standard sharpening
filter** — used by AMD FidelityFX, UE5 (mobile), o3de Atom, and many AAA
games. Its contrast-adaptive weight + min/max clamp produces clean
sharpening without any halo, which traditional unsharp masking cannot
achieve. soup3D has no path to artifact-free sharpening.

#### Design Notes

**Why Laplacian + adaptive weight (not unsharp mask)?** Traditional
unsharp masking (`sharpened = original + amount * (original - blurred)`)
applies uniform sharpening everywhere, which produces visible halos at
strong edges. CAS instead uses a Laplacian (4-neighbor) edge detector
modulated by a contrast-adaptive weight: the weight is automatically
reduced where local contrast is high, so edges get gentle treatment
while detail areas get strong sharpening. The min/max clamp then
guarantees no pixel can overshoot its neighborhood — halos are
mathematically impossible.

**Why `peak = 8 - 3 * sharpness`?** The peak coefficient controls the
maximum weight. At `sharpness = 1` (max), peak = 5 — aggressive but
clamped. At `sharpness = 0` (off), peak = 8 but the early-out skips all
math. This inverse relationship (more sharpness → lower peak → tighter
clamp) is the AMD FidelityFX CAS convention.

**Why 0.25 scaling on the Laplacian?** The 4-neighbor Laplacian can be
large (±4× texel value). The 0.25 factor normalizes it to a reasonable
range so that `sharpness = 1` produces strong but not destructive
sharpening. Without this factor, `sharpness = 1` would overshoot even
with the clamp, producing a cartoonish edge-enhancement look.

**Why after TAA, before tonemapping?** TAA's neighborhood clamping
softens high-frequency detail. CAS restores it. Running CAS *before*
tonemapping means the sharpening operates on linear HDR values, which
avoids amplifying tone-mapped noise. If your pipeline tonemaps before
sharpening (LDR pipeline), CAS still works but may accentuate banding
in smooth gradients — prefer the pre-tonemap order.

**Why `enabled = false` by default?** Sharpening is a matter of taste —
some users prefer the softer TAA look, others want crisp edges. Defaulting
to `false` lets the pipeline integrator opt in. The `sharpness` field is
runtime-adjustable so users can tune it via a settings slider.

#### Test coverage (`SharpenPass.test.ts`, 20 tests)

- **Construction (4)**: defaults (sharpness=0.5, enabled=false); all
  options accepted; sharpness=0 (passthrough); sharpness=1 (max).
- **sharpness field (2)**: runtime mutable; enabled runtime mutable.
- **apply() (5)**: no-throw + returns texture; 1 draw call per apply;
  works at sharpness=0; works at sharpness=1; returns finalTexture.
- **CAS_FRAG shader (9)**: GLSL ES 3.0; uniforms (u_colorMap,
  u_screenSize, u_sharpness); 4-neighbor cross sampling; Laplacian
  (`- 4.0 * b`); 5-tap min/max; contrast-adaptive weight
  (`peak / (rng * 4.0 + 1.0)`); anti-halo clamp (`clamp(sharp, mn, mx)`);
  passthrough early-out; sharpened output.

#### References

- AMD FidelityFX CAS (Contrast Adaptive Sharpening) — reference implementation
- o3de Atom `SharpenPass` (`Passes/SharpenPass`)
- UE5 "Accommodate" sharpening stage
- AMD GPUOpen, "FidelityFX CAS Documentation"

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

// 7. SSGI (needs color + position + normal) — diffuse bounce light
const ssgiTex = ssgiPass.apply(gl, exposedTex, positionTex, normalTex, camera);
// Composite: finalColor += ssgiTex * albedo / PI

// 8. Motion blur (needs color + velocity)
const motionBlurTex = motionBlurPass.apply(gl, ssrTex, velocityTex);

// 9. DOF (needs color + depth)
const dofTex = dofPass.apply(gl, motionBlurTex, depthTex, camera);

// 10. Height fog (atmospheric layer, needs color + depth)
//     Run after SSR/SSGI/DOF so reflections and defocus are fogged too;
//     run before tonemapping if you want HDR fog, after for LDR fog.
const fogTex = heightFogPass.apply(gl, dofTex, depthTex, camera);

// 11. Sharpen (restore TAA-softened detail, before tonemapping)
pipeline.add(new SharpenPass({ sharpness: 0.5, enabled: true }));

// 12. Final stylized passes
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
| HeightFogPass | 1 | 1 | 1 |
| VolumetricCloudsPass | 1 | 2 (1 HDR output + 1 R16F 3D noise) | 1 |
| VelocityPass | 1 | 1 | 1 |
| TAAPass | 1 (history) | 1 (history) | 1 |
| MotionBlurPass | 1 | 1 | 1 |
| AutoExposurePass | 2 (1×1 + output) | 2 (1×1 + output) | 2 |
| GTAOPass | 2 (AO + blur) | 2 | 2 |
| SSSSPass | 2 (H + V) | 2 | 1 |
| DOFEnhancedPass | 1 | 1 | 1 |
| GlitchPass | 0 | 1 (noise) | 1 |
| SMAAPass | 2 (edges + weights) | 4 (edges + weights + area LUT + search LUT) | 3 |
| SSGIPass | 1 | 1 (RGBA16F) | 1 |
| SharpenPass | 0 (uses ctx.resources) | 0 | 1 |
| FSRUpscalePass | 1 | 1 | 1 |

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

## LocalExposurePass (`LocalExposurePass.ts`)

> Path: `src/engine/Renderer/PostProcess/LocalExposurePass.ts`
>
> Local exposure post-process. Applies log-space local-global luminance
> difference driven exposure compensation — brightens shadows, darkens
> highlights, preserves detail. Complements `AutoExposurePass` (global exposure)
> for HDR scenes where both dark interiors and bright skies need to be visible.

### Architecture

```
Input: HDR color texture
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Fragment shader (single pass, ~50 texture samples)         │
│                                                             │
│  1. localLum  = avg luminance of 5×5 neighborhood           │
│     (radius = localRadius, stride = 1 texel)                │
│                                                             │
│  2. globalLum = avg luminance of 5×5 neighborhood           │
│     (radius = globalRadius, stride = globalStride texels)   │
│                                                             │
│  3. logDelta  = log(globalLum) - log(localLum)              │
│     > 0 → local darker than global → brighten               │
│     < 0 → local brighter than global → darken               │
│                                                             │
│  4. exposureComp = clamp(logDelta × strength, ±maxComp)     │
│     exposureFactor = exp(exposureComp)                      │
│                                                             │
│  5. adjusted = color × exposureFactor                       │
│                                                             │
│  6. Detail preservation:                                    │
│     detail = pixelLum - localLum   (high-frequency)         │
│     adjusted += detail × (1 - exposureFactor) × detailPres  │
│     → high-frequency detail not compressed by exposure      │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
Output: locally exposure-adjusted HDR color (RGBA16F)
```

### Algorithm (8 stages)

| Stage | Description |
|-------|-------------|
| 1 | Sample 5×5 neighborhood (`localRadius=2`, stride=1) → `localLum` (local average luminance). |
| 2 | Sample 5×5 neighborhood (`globalRadius=2`, stride=8) → `globalLum` (global average luminance). |
| 3 | Convert to log space: `logLocal = log(max(localLum, 1e-4))`, `logGlobal = log(max(globalLum, 1e-4))`. |
| 4 | Compute delta: `logDelta = logGlobal - logLocal`. Positive = local darker → brighten; negative = local brighter → darken. |
| 5 | Apply strength + clamp: `exposureComp = clamp(logDelta × strength, -maxComp, +maxComp)`. |
| 6 | Convert to linear: `exposureFactor = exp(exposureComp)`. e^1.5 ≈ 4.5× max boost/cut. |
| 7 | Apply: `adjusted = color × exposureFactor`. |
| 8 | Detail preservation: `detail = pixelLum - localLum`; `adjusted += detail × (1 - exposureFactor) × detailPreservation`. |

### Why log space?

Luminance perception is approximately logarithmic (Weber-Fechner law). A
difference of 0.1→0.2 is perceptually similar to 1.0→2.0. Working in log space
ensures the exposure compensation is perceptually uniform across the dynamic
range:
- `log(0.2) - log(0.1) ≈ 0.69` (same as)
- `log(2.0) - log(1.0) ≈ 0.69`

### Options

| Option                | Default | Range / Notes |
|-----------------------|---------|---------------|
| `strength`            | 1.0     | 0=off, 2=strong. Scales logDelta before exp. |
| `localRadius`         | 2       | 1..4 texel. Local neighborhood (5×5 at r=2). |
| `globalRadius`        | 2       | 1..4. Global neighborhood size. |
| `globalStride`        | 8       | texel multiplier. Global range = r × stride (±16 at r=2, s=8). |
| `maxCompensation`     | 1.5     | ln domain. e^1.5 ≈ 4.5× max boost/cut. |
| `detailPreservation`  | 0.7     | 0..1. 1=full detail preserved, 0=detail also adjusted. |
| `enabled`             | true    | false = passthrough (returns input). |

### API

```ts
export class LocalExposurePass {
  readonly name: 'localexposure';
  strength: number;
  localRadius: number;
  globalRadius: number;
  globalStride: number;
  maxCompensation: number;
  detailPreservation: number;
  enabled: boolean;

  constructor(opts?: LocalExposureOptions);
  apply(gl: WebGL2RenderingContext, colorTexture: WebGLTexture): WebGLTexture;
  setDirty(): void;
  dispose(gl?: WebGL2RenderingContext): void;
}
```

### Usage

```ts
import { LocalExposurePass } from '@vreen/engine/renderer/postprocess';

const localExposure = new LocalExposurePass({
  strength: 1.0,
  localRadius: 2,
  globalStride: 8,
  maxCompensation: 1.5,
  detailPreservation: 0.7,
});

// Pipeline order: AutoExposure → LocalExposure → Tonemapping
let color = autoExposure.apply(gl, hdrColor);
color = localExposure.apply(gl, color);
color = tonemapping.apply(gl, color);
```

### vs AutoExposurePass

| Aspect          | `AutoExposurePass`          | `LocalExposurePass`                    |
|-----------------|-----------------------------|----------------------------------------|
| Scope           | Global (whole frame)        | Local (per-pixel neighborhood)         |
| Metric          | Frame average luminance     | Local vs global luminance delta        |
| Effect          | Uniform brightness shift    | Brighten shadows, darken highlights    |
| Detail          | May wash out                | Preserved (detail preservation)        |
| Pipeline order  | Before LocalExposure        | After AutoExposure, before Tonemapping |
| Use case        | Day/night adaptation        | HDR contrast reduction                 |

### vs soup3D

| Feature              | VREEN `LocalExposurePass` | soup3D |
|----------------------|---------------------------|--------|
| Local exposure       | Yes (log-space delta)     | No     |
| Detail preservation  | Yes                       | No     |
| Complements auto exp | Yes                       | No     |
| HDR scene support    | Yes                       | No     |

soup3D has **no exposure control at all** (neither global nor local). VREEN
ships both `AutoExposurePass` (global) and `LocalExposurePass` (local),
providing UE5-grade HDR tone reproduction.

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
| Volumetric Clouds | Schneider & Vosin, "Horizon Zero Dawn Cloudscapes" — SIGGRAPH 2015 |
| Beer-Powder | Bouthors et al., "Real-Time Realistic Atmospheric Scattering" — 2008 |
| Dual-lobed HG | Henyey & Greenstein (1941); UE5 Volumetric Clouds plugin |
| Multi-scattering | Wenzel, "Real-time GI with Photon Mapping" — 2019 |
