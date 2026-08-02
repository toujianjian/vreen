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

Color lookup table — supports both 3D LUT (`sampler3D`) and 2D strip LUT.
Pairs with `LUTCubeLoader.toData3DTexture()` for end-to-end `.cube` file workflow.

**Class**: `LUTPass extends RenderPass`
**Shaders**: `LUT_3D_FRAG` (3D), `LUT_2D_STRIP_FRAG` (2D strip)

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lut` | `WebGLTexture \| Texture \| Data3DTexture \| null` | `null` | LUT texture |
| `lutSize` | `number` | `32` | LUT size (N×N×N for 3D, N×N² for strip) |
| `is3D` | `boolean` | `true` | True = 3D LUT, false = 2D strip |
| `intensity` | `number` | `1` | Blend factor (0=original, 1=full LUT) |
| `enabled` | `boolean` | `false` | Enable toggle |

#### Usage

```ts
import { LUTCubeLoader } from '@/engine/Loaders/LUTCubeLoader';

const loader = new LUTCubeLoader();
const lut3D = loader.parse(cubeText).toData3DTexture();
const pass = new LUTPass({ lut: lut3D, lutSize: 32, is3D: true, intensity: 0.8 });
```

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

Screen-space reflections — ray-marches the depth buffer to find reflection
intersections.

**Class**: `SSRPass` (independent, does **not** extend `RenderPass`)
**Shader**: `SSR_FRAG` (ray march) + `SSR_BLUR_FRAG` (bilateral blur)

#### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSteps` | `number` | `30` | Ray march step count |
| `thickness` | `number` | `0.5` | Ray thickness (penetration depth) |
| `resolution` | `[number, number]` | `[1, 1]` | Resolution scale (1 = full res) |
| `reflectionStrength` | `number` | `0.8` | Reflection intensity (0..1) |

#### API

```ts
apply(
  gl: WebGL2RenderingContext,
  inputTexture: WebGLTexture,
  positionTexture: WebGLTexture,
  normalTexture: WebGLTexture,
  camera: Camera,
): WebGLTexture
```

#### Algorithm

1. For each pixel, reflect the view direction about the surface normal.
2. Ray-march through the position buffer to find an intersection.
3. Bilateral-blur the reflection to reduce noise.
4. Blend reflection with the original color using Fresnel.

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
