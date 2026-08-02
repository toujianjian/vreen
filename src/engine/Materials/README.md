# Materials Module

> Path: `src/engine/Materials/`
>
> The material subsystem of the `@vreen/engine` kernel. Provides a PBR
> material family (`StandardMaterial`, `MeshPhysicalMaterial`), unlit /
> debug / shadow / sprite materials, a `ShaderMaterial` with
> `onBeforeCompile` GLSL injection, special-purpose materials
> (`FurMaterial`, `MatcapMaterial`, `ToonMaterial`, `OutlineMaterial`,
> `WaterMaterial`, `WireframeMaterial`), the `LineMaterial` thick-line
> renderer (screen-space quad expansion), and a `ShaderChunks/` registry
> for `#include <name>` GLSL fragment resolution.

---

## Overview

```
Material (abstract)
   ├── BasicMaterial (unlit base)
   │     ├── MeshBasicMaterial        flat color / texture
   │     ├── SpriteMaterial           billboard sprites (transparent, sizeAttenuation)
   │     ├── PointsMaterial           point-cloud / point-sprite (GL_POINTS, gl_PointSize)
   │     ├── LineBasicMaterial        thin lines (GL_LINES / LINE_STRIP / LINE_LOOP, linewidth)
   │     ├── LineMaterial             thick lines (screen-space quad expansion, Line2/LineSegments2)
   │     ├── FurMaterial              shell-based fur / hair
   │     ├── ToonMaterial             cel-shaded cartoon
   │     ├── OutlineMaterial          back-side outline pass
   │     ├── WaterMaterial            animated water surface
   │     ├── ReflectorMaterial        planar mirror reflection (with Reflector math)
   │     ├── RefractorMaterial        planar refraction (glass/water/heat distortion)
   │     └── WireframeMaterial        stylised wireframe
   ├── StandardMaterial               PBR (base color / metallic / roughness / emissive)
   │     └── MeshPhysicalMaterial     extended PBR (clearcoat / sheen / IOR / transmission)
   ├── AdvancedPBRMaterial            anisotropic / iridescence / clearcoat / sheen / emissive
   ├── SubsurfaceScatteringMaterial   skin / wax / jade / milk (translucent-shadow approx)
   ├── PreIntegratedSkinMaterial      skin (d'Eon 2007 BSSRDF LUT, AAA-grade)
   ├── MatcapMaterial                 matcap (view-space normal → texture)
   ├── MeshPhongMaterial              legacy Blinn-Phong
   ├── MeshNormalMaterial             normal debug
   ├── ShadowMaterial                 shadow-only receiver
   ├── ShaderMaterial                 custom GLSL with onBeforeCompile
   ├── ShaderLibrary                  15 named templates (unlit/pbr/toon/...)
   ├── ShaderCompiler                 #include + chunk injection + cache
   ├── ShaderVariant                  keyword combinations + LRU variant cache
   └── MaterialGraph                  node-based procedural materials (50+ node kinds)
                                      Input / Constant / Texture / Math / Channel /
                                      Noise / Curve / Output → GLSL → ShaderMaterial
```

The renderer collects material parameters into uniforms and selects a
cached `ShaderProgram` via `getProgramFor(material, skinned)`. Variant
caching uses `ShaderProgram.computeHash` so visually identical materials
share programs.

---

## Core Classes

### PBR Family

#### `StandardMaterial` (`StandardMaterial.ts`)

PBR material — the default for scene rendering.

| Property | Type | Default |
|----------|------|---------|
| `baseColor` | `{ r, g, b }` | `{ 1, 1, 1 }` |
| `metallic` | `number` | `0` |
| `roughness` | `number` | `1` |
| `emissive` | `{ r, g, b }` | `{ 0, 0, 0 }` |
| `opacity` | `number` | `1` |
| `wireframe` | `boolean` | `false` |

Procedural texture slots: `map`, `normalMap`, `metallicMap`,
`roughnessMap`, `emissiveMap`, `aoMap`.

#### `MeshPhysicalMaterial` (`MeshPhysicalMaterial.ts`)

Extended PBR for physically accurate dielectric / glass / fabric
surfaces. Adds:

| Property | Type | Default |
|----------|------|---------|
| `clearcoat` | `number` | `0` |
| `clearcoatRoughness` | `number` | `0` |
| `sheen` | `number` | `0` |
| `sheenColor` | `{ r, g, b }` | `{ 0, 0, 0 }` |
| `IOR` | `number` | `1.5` |
| `transmission` | `number` | `0` |
| `thickness` | `number` | `0` |
| `attenuationDistance` | `number` | `Infinity` |
| `attenuationColor` | `{ r, g, b }` | `{ 1, 1, 1 }` |
| `anisotropy` | `number` | `0` |

Implemented via `onBeforeCompile` GLSL injection into the standard
shader — clearcoat adds a secondary specular lobe; transmission adds a
background-sampling pass.

### Unlit & Debug

#### `MeshBasicMaterial` (`MeshBasicMaterial.ts`)

Unlit — flat color or texture, ignores scene lighting. Useful for
sprites, debug quads, UI elements, atlas-rendered text.

#### `MeshNormalMaterial` (`MeshNormalMaterial.ts`)

Debug material — outputs object-space or world-space normals as RGB.

#### `MeshPhongMaterial` (`MeshPhongMaterial.ts`)

Legacy Blinn-Phong with `specular` and `shininess` — for non-PBR
pipelines and stylistic looks.

#### `ShadowMaterial` (`ShadowMaterial.ts`)

Shadow-only receiver — reads shadow maps without contributing surface
color. Used for invisible shadow catchers compositing onto scene
backgrounds.

#### `SpriteMaterial` (`SpriteMaterial.ts`)

Sprite material — extends `BasicMaterial` with:

| Property | Type | Default |
|----------|------|---------|
| `color` | `{ r, g, b }` (linear RGB, multiplied with `map`) | `{ 1, 1, 1 }` |
| `map` | `Texture \| null` | `null` |
| `opacity` | `number` | `1` |
| `rotation` | `number` (radians) | `0` |
| `sizeAttenuation` | `boolean` | `true` (perspective near-big-far-small) |
| `depthTest` / `depthWrite` | `boolean` | `true` / `true` |
| `wireframe` | `boolean` | `false` |
| `renderOrder` | `number` | `0` |

Pairs with `Sprite`; the renderer uses a separate sprite shader path
that implements billboard orientation in the vertex shader.
`transparent` defaults to `true` (sprites usually have alpha).

#### `PointsMaterial` (`PointsMaterial.ts`)

Point-cloud / point-sprite material — extends `BasicMaterial` with:

| Property | Type | Default |
|----------|------|---------|
| `color` | `{ r, g, b }` (linear RGB, multiplied with `map`) | `{ 1, 1, 1 }` |
| `map` | `Texture \| null` (sampled with `gl_PointCoord` as UV) | `null` |
| `alphaMap` | `Texture \| null` (`.r` channel modulates alpha) | `null` |
| `size` | `number` (world units when `sizeAttenuation=true`, else pixels) | `1` |
| `sizeAttenuation` | `boolean` | `true` (perspective near-big-far-small) |
| `opacity` | `number` | `1` |
| `transparent` | `boolean` | `true` (point clouds usually have alpha) |
| `alphaTest` | `number` (fragments with alpha < `alphaTest` are discarded) | `0` |
| `depthTest` / `depthWrite` | `boolean` | `true` / `true` |
| `wireframe` | `boolean` | `false` |
| `renderOrder` | `number` | `0` |

Pairs with `Points`; the renderer issues a `gl.drawArrays(gl.POINTS, …)`
call and sets `gl_PointSize` in the vertex shader from `size` (and
attenuates by view-space depth when `sizeAttenuation=true`). `map` is
sampled with `gl_PointCoord` (a `vec2` in `[0,1]` covering the point
sprite quad), so a single texture is reused across every point. Use
`alphaTest` to cut out point-sprite edges (e.g. circular particle
textures) and avoid visible square boundaries.

#### `LineBasicMaterial` (`LineBasicMaterial.ts`)

Thin-line material — extends `BasicMaterial` with:

| Property | Type | Default |
|----------|------|---------|
| `color` | `{ r, g, b }` (linear RGB, multiplied with `map`) | `{ 1, 1, 1 }` |
| `map` | `Texture \| null` (sampled with vertex `uv`) | `null` |
| `linewidth` | `number` (pixels) | `1` |
| `dashed` | `boolean` (enable dash pattern) | `false` |
| `dashSize` | `number` (dash length, world units × `scale`) | `1` |
| `gapSize` | `number` (gap length, world units × `scale`) | `1` |
| `scale` | `number` (dash scale factor) | `1` |
| `opacity` | `number` | `1` |
| `transparent` | `boolean` | `false` |
| `alphaTest` | `number` | `0` |
| `depthTest` / `depthWrite` | `boolean` | `true` / `true` |
| `wireframe` | `boolean` | `false` |
| `renderOrder` | `number` | `0` |

Pairs with `Line` / `LineSegments` / `LineLoop`; the renderer issues
`gl.drawArrays(gl.LINES | gl.LINE_STRIP | gl.LINE_LOOP, …)`. **Note:**
the WebGL spec caps `gl.lineWidth` at 1 on most desktop platforms, so
`linewidth > 1` is silently clamped — for thick anti-aliased lines use
`Line2` + `LineMaterial` (screen-space quad expansion; see below).

For dashed lines, call `line.computeLineDistances()` to populate the
`lineDistance` attribute, then set `dashed: true` with `dashSize` /
`gapSize` / `scale`. The shader samples `lineDistance` and discards
fragments in the gaps.

#### `LineMaterial` (`LineMaterial.ts`)

Thick-line material — screen-space quad-expansion renderer that breaks
the `gl.lineWidth = 1` cap. Pairs with `LineSegments2` / `Line2` (in
`Core`) and `LineSegmentsGeometry` / `LineGeometry` (in `Geometries`).
Each segment is drawn as an instanced quad; the vertex shader expands
it in screen space to the desired `linewidth`, supporting round end
caps, dashed patterns, per-vertex colors, and a `worldUnits` mode.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `color` | `{ r, g, b }` (linear RGB) | `{ 1, 1, 1 }` | Multiplied with `instanceColorStart` / `instanceColorEnd` when present. |
| `linewidth` | `number` | `1` | Line width in pixels (or world units when `worldUnits = true`). |
| `resolution` | `Vector2` | `(1, 1)` | Viewport size in pixels. **Must be updated on resize** — screen-space expansion depends on it. |
| `dashed` | `boolean` | `false` | Enable dashed pattern (requires `computeLineDistances()` on the line object). |
| `dashSize` | `number` | `1` | Dash length (world units × `scale`). |
| `gapSize` | `number` | `1` | Gap length (world units × `scale`). |
| `dashOffset` | `number` | `0` | Dash offset (world units × `scale`). |
| `scale` | `number` | `1` | Dash scale factor. |
| `worldUnits` | `boolean` | `false` | Interpret `linewidth` as world units instead of pixels. |
| `opacity` | `number` | `1` | Opacity (0..1). |
| `transparent` | `boolean` | `false` | Enable alpha blending. |
| `alphaTest` | `number` | `0` | Alpha-test threshold (fragments with `alpha < alphaTest` are discarded). |
| `depthTest` / `depthWrite` | `boolean` | `true` / `true` | Depth buffer control. |
| `renderOrder` | `number` | `0` | Render sort weight. |

The material exposes `LINE_MATERIAL_VERT` and `LINE_MATERIAL_FRAG` GLSL
ES 3.0 shader sources. The vertex shader uses `#ifdef USE_COLOR` /
`#ifdef USE_DASH` preprocessor guards so the renderer can compile
trimmed variants when per-vertex colors or dashes are unused.

**Uniforms** (`LineMaterialUniforms`, mirrored from the material fields
via `syncUniforms()`):

| Uniform | GLSL type | Source |
|---------|-----------|--------|
| `u_lineColor` | `vec3` | `color` |
| `u_linewidth` | `float` | `linewidth` |
| `u_resolution` | `vec2` | `resolution` |
| `u_dashSize` | `float` | `dashSize` |
| `u_gapSize` | `float` | `gapSize` |
| `u_dashOffset` | `float` | `dashOffset` |
| `u_scale` | `float` | `scale` |
| `u_opacity` | `float` | `opacity` |
| `u_worldUnits` | `int` | `worldUnits ? 1 : 0` |

**Vertex shader algorithm** (screen-space quad expansion):

1. Transform `instanceStart` / `instanceEnd` to clip space via
   `projection × view × model`.
2. Compute screen-space direction
   `dir = normalize(endScreen − startScreen)`, perpendicular
   `perp = vec2(−dir.y, dir.x)`.
3. Map `a_position.y ∈ {−1, 0, 1, 2}` to interpolation parameter `t`
   along the segment; `|a_position.y| > 1` extends beyond the endpoints
   for round caps.
4. Offset along `perp` by `a_position.x × linewidth / 2` (screen-space
   mode) or world-space perpendicular (worldUnits mode).
5. Output `gl_Position`, `v_uv`, `v_color` (interpolated per-instance
   colors), `v_lineDistance` (for dashed discard).

**Fragment shader**: discards fragments in dash gaps
(`mod(v_lineDistance + dashOffset, dashSize + gapSize) > dashSize`),
multiplies `u_lineColor` by `v_color` and `u_opacity`, applies
`alphaTest`.

```ts
import { LineMaterial } from '@vreen/engine/materials';
import { Vector2 } from '@vreen/engine/math';

const mat = new LineMaterial({
  color: { r: 0.2, g: 1, b: 0.8 },        // cyan
  linewidth: 4,                            // 4 pixels
  resolution: new Vector2(1920, 1080),
  dashed: true,
  dashSize: 2,
  gapSize: 1,
  transparent: true,
  opacity: 0.9,
});
// Update on resize:
mat.resolution.set(canvas.width, canvas.height);
mat.syncUniforms();
```

**Differences from three.js `LineMaterial`**:

- VREEN attributes use `a_` prefix (`a_instanceStart`, `a_instanceEnd`,
  `a_instanceColorStart`, `a_instanceColorEnd`, `a_instanceDistanceStart`,
  `a_instanceDistanceEnd`) consistent with the engine naming convention;
  three.js uses `instanceStart` / `instanceEnd` (no prefix).
- Uniform names use `u_` prefix (`u_lineColor`, `u_linewidth`, …);
  three.js uses bare names (`lineColor`, `linewidth`, …).
- `uniforms` is a typed `LineMaterialUniforms` object (not a plain
  `Record<string, IUniform>`), giving compile-time field safety.
- `syncUniforms()` must be called after mutating material fields before
  the renderer reads `uniforms`; three.js auto-syncs on every frame.
- `worldUnits` is stored as `boolean` on the material and uploaded as
  `int` (0/1) to the shader; three.js stores it as `number` (0/1).
- `fromHex(hex)` factory parses `#rrggbb` / `#rgb` strings into `color`.

**Limitations**:

- `resolution` must be updated manually on viewport resize; the material
  does not auto-detect canvas changes.
- The fragment shader does not implement round end-cap alpha (the vertex
  shader extends the quad, but the fragment shader keeps rectangular
  ends). Round caps can be added by discarding fragments where
  `|v_uv.x| > 1` in the cap region.
- The shader is unlit (`BasicMaterial`-based); there is no lighting or
  shadow interaction. For lit thick lines, extend the fragment shader
  with a hard-coded normal.
- `dashed` requires `LineSegments2.computeLineDistances()` /
  `Line2.computeLineDistances()` to populate `instanceDistanceStart` /
  `instanceDistanceEnd`; otherwise `v_lineDistance` is zero and all
  fragments fall in the dash region.
- Renderer integration (binding `instanceStart` / `instanceEnd` etc. as
  instanced vertex attribs) is handled by `WebGL2Renderer`'s instanced
  custom-attribute path.

Adapted from three.js `examples/jsm/lines/LineMaterial.js` and
`examples/jsm/lines/LineMaterial.glsl.js`.

### Custom Shader

#### `ShaderMaterial` (`ShaderMaterial.ts`)

Custom-shader material. Accepts `vertexSrc` / `fragmentSrc` (GLSL ES 3.0
strings) and a `uniforms` descriptor. The renderer injects `u_time`,
`u_model`, `u_view`, `u_projection`, `u_normalMatrix`, `u_cameraPos`
automatically.

Supports `onBeforeCompile(shader)` for injecting GLSL snippets into the
built-in shaders without rewriting them — used by `MeshPhysicalMaterial`
for clearcoat / transmission extensions. `onBeforeCompile` invalidates
the program cache when the material shader-injection signature changes.

### Special-Purpose Materials

#### `FurMaterial` (`FurMaterial.ts`)

Shell-based fur / hair material. Extends `BasicMaterial` with:

| Property | Type | Default |
|----------|------|---------|
| `furLength` | `number` | `0.2` |
| `furDensity` | `number` | `0.8` |
| `furColor` | `Color` | `Color(0.5, 0.3, 0.1)` |
| `furOcclusion` | `number` (root darkening, 0..1) | `0.5` |
| `gravity` | `Vector3` | `(0, -1, 0)` |
| `wind` | `Vector3` | `(0, 0, 0)` |
| `noiseTexture` | `Texture \| null` | `null` |
| `shellLayer` | `number` (0..1, set per shell by `FurShell`) | `0` |
| `time` | `number` (animation clock) | `0` |

Vertex shader (`FUR_VERT`) displaces vertices along `a_normal` by
`shellLayer * furLength`, then offsets by gravity and wind scaled by
`shellLayer * furLength` (top shells sway more). Fragment shader
(`FUR_FRAG`) samples the noise texture (falling back to a hash-based
pseudo-noise), discards fragments below a layer-dependent density
threshold (`threshold = furDensity * (1 - layer² * 0.7)` — top shells
are sparser), and darkens roots via `mix(1 - furOcclusion, 1.0, layer)`.
`transparent` and `doubleSided` default to `true`. Pairs with `FurShell`
which manages the per-shell `shellLayer` uniform and synchronises
animation uniforms each frame.

#### `MatcapMaterial` (`MatcapMaterial.ts`)

Material Capture — uses a pre-baked sphere normal→color texture
(`matcap`) to shade without any lights. View-space normal is mapped to
UV `(0.5 + nx * 0.5, 0.5 + ny * 0.5)` and samples the matcap. Fast,
cheap, and gives a sculpted-painted look popular in 3D art tools.

#### `ToonMaterial` (`ToonMaterial.ts`)

Cel-shaded cartoon material. Quantises the standard PBR N·L lighting
into discrete bands via a step function. Optional outline pass via
`OutlineMaterial`. Configurable band count and band-edge sharpness.

#### `OutlineMaterial` (`OutlineMaterial.ts`)

Back-side outline pass material — renders the mesh with vertex normals
extruded along `a_normal` by `outlineScale`, with a flat `outlineColor`
and `transparent=false` (so it draws behind the front faces). Used in a
two-pass outline technique: first draw the outline mesh (scaled, back
faces only), then draw the front-pass material on top.

#### `WaterMaterial` (`WaterMaterial.ts`)

Animated water surface material — vertex displacement via Gerstner
waves (configurable wave count / amplitude / direction / steepness),
specular sun glint, refraction approximation via screen UV offset, and
depth-based foam fade. Pairs with `WaterSystem` (in `Environment/`) for
scene-level water state.

#### `ReflectorMaterial` (`ReflectorMaterial.ts`)

Planar mirror reflection material — the shader counterpart to
`Renderer/Reflector.ts` (the CPU reflection math library). Samples a
pre-rendered reflection texture and maps it onto the mirror surface via
a texture matrix that transforms world-space positions into the mirror
camera's UV space.

**Architecture** (two-module design):

```
Renderer/Reflector.ts (CPU math, no GL)
  ├── reflectionMatrix      — mirror transform (det = -1)
  ├── mirrorCamera()        — flip eye/target/up across plane
  ├── computeObliqueProjection() — near-plane = reflection plane (Lengyel)
  └── computeTextureMatrix()    — scaleBias × projection × viewMirror

Materials/ReflectorMaterial.ts (GLSL shader + data)
  ├── REFLECTOR_VERT         — worldPos → v_reflectionCoord via textureMatrix
  ├── REFLECTOR_FRAG         — perspective divide + sample + tint + Fresnel
  └── ReflectorMaterial      — holds reflectionTexture / textureMatrix / tint
```

**Properties**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `reflectionTexture` | `Texture \| null` | `null` | Reflection render target (from Reflector's render-to-texture pass). |
| `textureMatrix` | `Matrix4 \| null` | `null` | World → reflection UV transform. Set from `Reflector.computeTextureMatrix(proj, viewMirror)`. |
| `tint` | `[r, g, b]` | `[1, 1, 1]` | Mirror tint (e.g. `[0.9, 0.9, 1.0]` for a cool mirror). |
| `opacity` | `number` | `1.0` | Surface opacity (0 = invisible, 1 = opaque). |
| `fresnelScale` | `number` | `0.0` | Fresnel blend strength. 0 = pure mirror; >0 = grazing-angle reflection, front-facing base color. |
| `fresnelPower` | `number` | `3.0` | Fresnel exponent (higher = sharper rim). |
| `baseColor` | `[r, g, b]` | `[0.02, 0.02, 0.03]` | Base color shown in low-reflection regions when `fresnelScale > 0`. |
| `transparent` | `boolean` | `false` | Whether the material is transparent. |

**Vertex shader** (`REFLECTOR_VERT`):
1. `worldPos = u_model * vec4(position, 1.0)`
2. `v_reflectionCoord = u_textureMatrix * worldPos` — world → mirror camera clip space → [0,1] UV (textureMatrix already includes scaleBias)
3. `gl_Position = u_projection * u_view * worldPos`

**Fragment shader** (`REFLECTOR_FRAG`):
1. Perspective divide: `reflUv = v_reflectionCoord.xy / v_reflectionCoord.w`
2. Clamp to [0,1] (avoid sampling outside reflection texture)
3. Sample: `reflColor = texture(u_reflectionMap, reflUv).rgb * u_tint`
4. Fresnel blend (if `fresnelScale > 0`):
   - `fresnel = Schlick(dot(N, V), f0=0.04)` — dielectric Fresnel
   - `finalColor = mix(u_baseColor, reflColor, clamp(fresnel * u_fresnelScale, 0, 1))`
5. Output: `outColor = vec4(finalColor, u_opacity)`

**Extensions vs three.js Reflector.js**:
- **Fresnel blend** — three.js Reflector is a pure flat mirror; VREEN adds
  configurable Fresnel so the mirror shows a base color at normal
  incidence and full reflection at grazing angles (more realistic for
  polished surfaces, tinted mirrors, wet floors).
- **Tint** — colored mirrors (copper `[0.8, 0.5, 0.3]`, gold `[0.9, 0.7, 0.3]`).
- **Base color** — the non-reflective fallback color for regions where the
  reflection texture is unavailable or at low-Fresnel angles.
- **UV clamping** — three.js uses `textureProj` which can sample outside
  [0,1]; VREEN explicitly clamps to avoid border artifacts.

**Usage**:
```ts
import { Reflector } from '../Renderer/Reflector';
import { ReflectorMaterial } from '../Materials/ReflectorMaterial';

// 1. CPU math (reflection matrix, mirror camera, texture matrix)
const reflector = new Reflector({
  plane: new Plane(new Vector3(0, 1, 0), 0), // y=0 floor
  resolution: 1024,
});

// 2. Material (shader + data)
const material = new ReflectorMaterial({
  tint: [0.95, 0.95, 1.0],
  opacity: 0.9,
  fresnelScale: 0.3,
  baseColor: [0.05, 0.05, 0.08],
});

// 3. Each frame:
//    a. Compute mirror camera + texture matrix
const mirrorCam = reflector.mirrorCamera(eye, target, up);
const viewMirror = new Matrix4().makeLookAt(mirrorCam.eye, mirrorCam.target, mirrorCam.up);
const obliqueProj = reflector.computeObliqueProjection(camera.projectionMatrix, viewMirror);
material.textureMatrix = reflector.computeTextureMatrix(obliqueProj, viewMirror);
//    b. Renderer renders scene from mirrorCam to reflectionTexture
//    c. Bind reflectionTexture to material
material.reflectionTexture = reflectionRenderTargetTexture;

// 4. Mesh
const mesh = new Mesh(planeGeometry, material);
```

**Test coverage** (`ReflectorMaterial.test.ts`, 27 tests):
- Construction defaults + custom options.
- RGB object / array acceptance for `tint` and `baseColor`.
- Type identity (`type === 'Reflector'`, `isReflectorMaterial`, `extends BasicMaterial`, unique uuid).
- `copy()` / `clone()` — full field duplication + array independence.
- Shader source validation: `#version 300 es`, all uniforms present
  (`u_textureMatrix`, `u_reflectionMap`, `u_tint`, `u_opacity`,
  `u_fresnelScale`, `u_fresnelPower`, `u_baseColor`, `u_reflectionMapEnabled`).
- Shader logic validation: perspective divide, tint multiply, Fresnel
  Schlick, baseColor mix, UV clamp.
- Integration with `Reflector.computeTextureMatrix()` output.

#### `RefractorMaterial` (`RefractorMaterial.ts`)

Planar refraction material — the shader counterpart to
`Renderer/Refractor.ts` (the CPU refraction math library). Samples a
pre-rendered scene texture and displaces the UV using GLSL `refract()`
(Snell's law) to simulate seeing objects through a refractive surface
(glass, water, heat distortion).

**Architecture** (two-module design, complementary to Reflector):

```
Renderer/Refractor.ts (CPU math, no GL)
  ├── refractDirection()          — Snell's law (D' = η·D + (η·cosθi - cosθt)·N)
  ├── isTotalInternalReflection() — TIR check (sin²θt > 1)
  ├── criticalAngle               — arcsin(1/η) for η > 1
  ├── estimateUVOffset()          — depth × tan(θt)
  └── computeVirtualPosition()    — apparent depth compression

Materials/RefractorMaterial.ts (GLSL shader + data)
  ├── REFRACTOR_VERT  — worldPos → v_screenCoord via textureMatrix (main camera)
  ├── REFRACTOR_FRAG  — GLSL refract() → UV offset → sample → tint → Fresnel → dispersion
  └── RefractorMaterial — holds refractionTexture / textureMatrix / eta / dispersion
```

**Reflector vs Refractor comparison**:

| Aspect | Reflector | Refractor |
|--------|-----------|-----------|
| Physical effect | Mirror reflection (angle flip) | Refraction (angle bend) |
| Virtual camera | Mirrored across plane | Main camera (no mirror) |
| Texture matrix | `scaleBias × proj × viewMirror` | `scaleBias × proj × view` (main cam) |
| UV computation | Direct texture matrix transform | `refract(-V, N, η).xy × scale` offset |
| Shader function | `textureProj(reflectionMap, coord)` | `texture(refractionMap, screenUv + offset)` |
| TIR handling | N/A (reflection has no TIR) | GLSL `refract()` returns `(0,0,0)` on TIR |
| Typical use | Mirrors, polished floors | Glass, water surface, heat haze |

**Properties**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `refractionTexture` | `Texture \| null` | `null` | Scene render target (main camera, excluding refractor mesh). |
| `textureMatrix` | `Matrix4 \| null` | `null` | World → screen UV. `scaleBias × projection × view` (main camera). |
| `eta` | `number` | `0.75` | Refractive index ratio n1/n2. Air→water ≈ 0.75; air→glass ≈ 0.667. |
| `tint` | `[r, g, b]` | `[1, 1, 1]` | Surface tint (e.g. `[0.9, 0.95, 1.0]` for cool glass). |
| `opacity` | `number` | `1.0` | Surface opacity. |
| `refractionScale` | `number` | `0.02` | UV displacement strength (higher = more distortion). |
| `fresnelScale` | `number` | `0.0` | Fresnel reflection blend (0 = pure refraction; >0 = grazing-angle reflection). |
| `fresnelPower` | `number` | `5.0` | Fresnel exponent. |
| `dispersion` | `number` | `0.0` | Chromatic dispersion strength. R/G/B use `η±dispersion` → colored edges. |
| `baseColor` | `[r, g, b]` | `[0.02, 0.02, 0.03]` | Fallback color for TIR or missing texture. |
| `transparent` | `boolean` | `true` | Whether the material is transparent. |
| `depthWrite` | `boolean` | `false` | Whether to write depth (false = see-through). |

**Vertex shader** (`REFRACTOR_VERT`):
1. `worldPos = u_model * vec4(position, 1.0)`
2. `v_screenCoord = u_textureMatrix * worldPos` — world → main camera clip space → [0,1] UV
3. `v_worldNormal = normalize(u_normalMatrix * a_normal)`
4. `gl_Position = u_projection * u_view * worldPos`

**Fragment shader** (`REFRACTOR_FRAG`):
1. Screen UV: `screenUv = v_screenCoord.xy / v_screenCoord.w`
2. View direction: `V = normalize(u_cameraPos - v_worldPos)`
3. Incident: `I = -V` (pointing toward surface)
4. **No dispersion**: `refractDir = refract(I, N, u_eta)`; `offset = refractDir.xy × u_refractionScale`
5. **With dispersion** (`u_dispersion > 0`):
   - `etaR = η + dispersion`, `etaG = η`, `etaB = η - dispersion`
   - Sample R/G/B channels separately with different offsets → chromatic edges
6. Sample: `refrColor = texture(u_refractionMap, clamp(screenUv + offset, 0, 1))`
7. Tint: `refrColor *= u_tint`
8. Fresnel blend (if `fresnelScale > 0`): `mix(refrColor, baseColor, Schlick(dot(N,V), 0.04) × fresnelScale)`
9. Output: `outColor = vec4(finalColor, u_opacity)`

**Extensions vs three.js Refractor.js**:
- **Chromatic dispersion** (`dispersion`): R/G/B channels use slightly
  different η → prism-like colored edges at grazing angles. three.js has
  no dispersion.
- **Fresnel reflection blend**: real glass both refracts AND reflects;
  VREEN blends refraction with a base color at grazing angles via
  Schlick Fresnel. three.js is pure refraction.
- **Tint**: colored glass (green, amber, etc.).
- **Configurable refraction scale**: controls distortion strength.
- **TIR handling**: GLSL `refract()` returns `(0,0,0)` on total internal
  reflection → UV offset is zero → shows base color (graceful fallback).

**Usage**:
```ts
import { Refractor } from '../Renderer/Refractor';
import { RefractorMaterial } from '../Materials/RefractorMaterial';

// 1. CPU math (Snell's law, TIR, critical angle)
const refractor = new Refractor({
  plane: new Plane(new Vector3(0, 1, 0), 0), // y=0 water surface
  eta: 0.75, // air → water
});

// 2. Material (shader + data)
const material = new RefractorMaterial({
  eta: 0.75,
  tint: [0.9, 0.95, 1.0],
  opacity: 0.85,
  refractionScale: 0.02,
  fresnelScale: 0.5,   // grazing-angle reflection
  dispersion: 0.02,    // chromatic edges
  baseColor: [0.05, 0.08, 0.12],
});

// 3. Each frame:
//    a. Render scene (excluding refractor mesh) to texture from main camera
//    b. Compute texture matrix
const scaleBias = new Matrix4().set(0.5,0,0,0.5, 0,0.5,0,0.5, 0,0,0.5,0.5, 0,0,0,1);
const pv = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
material.textureMatrix = new Matrix4().multiplyMatrices(scaleBias, pv);
material.refractionTexture = sceneRenderTargetTexture;

// 4. Mesh
const mesh = new Mesh(waterGeometry, material);
```

**Test coverage** (`RefractorMaterial.test.ts`, 33 tests):
- Construction defaults + custom options (eta, dispersion, refractionScale, etc.).
- RGB object / array acceptance for `tint` and `baseColor`.
- Type identity (`type === 'Refractor'`, `isRefractorMaterial`, `extends BasicMaterial`,
  unique uuid, distinct from `Reflector` type).
- `copy()` / `clone()` — full field duplication + array independence.
- Shader source validation: `#version 300 es`, all uniforms
  (`u_textureMatrix`, `u_refractionMap`, `u_eta`, `u_tint`, `u_opacity`,
  `u_refractionScale`, `u_fresnelScale`, `u_fresnelPower`, `u_dispersion`,
  `u_baseColor`, `u_refractionMapEnabled`).
- Shader logic: GLSL `refract()` usage, perspective divide, tint,
  Fresnel Schlick, dispersion (etaR/etaG/etaB), UV clamp.
- Integration with Refractor math: textureMatrix, refractionTexture,
  runtime eta updates (air→water vs air→glass).

#### `SubsurfaceScatteringMaterial` (`SubsurfaceScatteringMaterial.ts`)

Translucent-shadow approximation of subsurface scattering (Penner / GDC
2011 style). Extends `BasicMaterial` with per-channel scattering radii,
a half-translucent back-light term, and a simplified Cook-Torrance
specular. Best for **thin-wall transmission** effects (ear rim, nose
wing, leaf edges) where light wraps around from behind.

| Property | Type | Default | Notes |
|----------|------|---------|-------|
| `baseColor` | `RGB` | `{0.9, 0.7, 0.6}` | Linear albedo. |
| `subsurfaceColor` | `RGB` | `{1.0, 0.3, 0.2}` | Transmitted light tint (red-orange for skin). |
| `subsurfaceRadius` | `RGB` | `{1.0, 0.4, 0.2}` | Per-channel scattering radius (R > G > B for skin). |
| `subsurfaceMix` | `number` | `0.5` | 0 = no SSS, 1 = full SSS. |
| `subsurfacePower` | `number` | `4` | Transmission falloff sharpness. |
| `subsurfaceDistortion` | `number` | `0.3` | Normal backward offset for L_distorted. |
| `thickness` | `number` | `0.5` | 0 = thin (more transmission), 1 = thick. |
| `translucency` | `number` | `0.5` | Transmission intensity. |
| `roughness` / `metallic` | `number` | `0.5` / `0` | Simplified GGX specular. |
| `sssEnabled` | `boolean` | `true` | Master toggle. |
| `sssSteps` | `number` | `4` | Per-pixel march steps (1..8). |

Shader: `SSS_VERT` (standard MVP + world attrs) / `SSS_FRAG`
(Lambert + GGX + translucent shadow). `computeSSS()` provides a CPU
reference implementation matching the GLSL fragment.

#### `PreIntegratedSkinMaterial` (`PreIntegratedSkinMaterial.ts`)

AAA-grade skin shading based on **d'Eon & Luebke 2007** (GPU Gems 3,
Ch. 14). Pre-computes the BSSRDF convolution into two lookup tables so
the runtime shader pays only **2 texture samples** for skin-grade
diffuse + transmission — no per-pixel BSSRDF integration. Complements
`SubsurfaceScatteringMaterial`: use `PreIntegratedSkin` for large
areas (cheek / forehead) where the soft shadow terminator matters, and
`SubsurfaceScatteringMaterial` for thin rims (ear / nose wing).

| Property | Type | Default | Notes |
|----------|------|---------|-------|
| `baseColor` | `RGB` | `{0.9, 0.7, 0.6}` | Linear albedo. |
| `diffuseIntensity` | `number` | `1` | Diffuse LUT multiplier. |
| `specularIntensity` | `number` | `1` | GGX specular multiplier. |
| `roughness` | `number` | `0.4` | Skin typical 0.3..0.5. |
| `metallic` | `number` | `0` | Skin ≈ 0. |
| `curvature` | `number` | `0` | Fallback curvature when no `a_curvature` attribute (1/radius, mm⁻¹). |
| `curvatureScale` | `number` | `1` | Multiplies `a_curvature` attribute. |
| `translucency` | `number` | `0.5` | Transmission intensity. |
| `translucencyDistortion` | `number` | `0.1` | Normal backward offset. |
| `translucencyPower` | `number` | `4` | Transmission falloff sharpness. |
| `falloffConstant` | `number` | `1` | Maps curvature → LUT v coordinate (matches `DiffuseLUT.sample`). |
| `diffuseLUT` | `DiffuseLUT` | (generated) | 256×256×3 pre-integrated diffuse BRDF. |
| `transmittanceLUT` | `TransmittanceLUT` | (generated) | 256×3 pre-integrated transmittance. |
| `profile` | `DiffuseProfile` | `SKIN_PROFILE` | Read-only scattering profile (from LUTs). |

**Vertex shader** (`PRE_INTEGRATED_SKIN_VERT`): standard MVP + passes
`worldPos`, `worldNormal`, `uv`, and `curvature` (from `a_curvature`
attribute; renderer injects constant 0 if absent).

**Fragment shader** (`PRE_INTEGRATED_SKIN_FRAG`):
1. Diffuse: sample `u_diffuseLUT` at `(lutU, lutV)` where `lutU = (N·L+1)/2`
   and `lutV = 1/(1+curvature*falloffConstant)`.
2. Specular: simplified GGX + Schlick Fresnel.
3. Transmission: distort L by N, compute `backLight = pow(max(V·-Ld, 0), power)`,
   sample `u_transmittanceLUT` at `backLight`, multiply by `translucency`.
4. Composite: `ambient + diffuse + specular + transmissive`.

**CPU reference**: `computeSSS(position, normal, lightDir, viewDir, curvature, thickness)`
returns `{ diffuse, specular, transmissive, total }` matching the GLSL math.

**LUT sharing**: multiple materials can share the same `DiffuseLUT` /
`TransmittanceLUT` via `shareLUTs()` to avoid regenerating identical
tables. `setProfile()` regenerates both LUTs from a new `DiffuseProfile`.

**Test coverage** (`PreIntegratedSkinMaterial.test.ts`, 60 tests):
- `SKIN_PROFILE` constants (R > G > B scattering radius, F0 ≈ 0.028).
- `DiffuseLUT`: dimensions, data non-zero/non-negative, flat (curvature=0)
  at N·L=1 → ≈1 and N·L=0 → ≈0, high curvature softens terminator,
  bilinear continuity, out-of-range clamping, `toJSON`.
- `TransmittanceLUT`: dimensions, distance=0 → high, R > G > B
  (skin-red physics), monotonic decrease, far → ≈0, linear continuity,
  out-of-range clamping, `toJSON`.
- Material construction, defaults, `fromHex`, LUT ownership, profile
  consistency.
- Options override (all fields + `clamp01` + `>= 0` + `>= 1` invariants).
- Setters (chainable, value correctness, clamping, `setProfile`,
  `shareLUTs`).
- `computeSSS` CPU reference (4-component return, strong front-lighting,
  dark back-lighting, non-negative finite transmission, R ≥ G ≥ B
  transmission, `translucency=0` → zero transmission, curvature-dependent
  results).
- Shader source: `#version 300 es`, `a_curvature` attribute, LUT
  samplers, GGX/Fresnel functions, `outColor`.
- `getUniforms` completeness (all scalar + LUT references).
- `customProgramCacheKey` stability.
- `toJSON` / `fromJSON` round-trip (all fields + custom profile +
  missing-field tolerance).
- `clone` / `copy` independence (LUT reference shared for memory).
- `dispose` idempotent.

#### `WireframeMaterial` (`WireframeMaterial.ts`)

Stylised wireframe material — renders the mesh's triangle edges as
coloured lines, optionally with depth-fade. Useful for technical / CAD
/ debug visualisations distinct from `wireframe: true` on a standard
material (which just changes the draw mode).

### `ShaderChunks/` Subdirectory

10 GLSL fragment string constants + `ShaderChunkRegistry`:

| Chunk | Purpose |
|-------|---------|
| `COMMON_CHUNK` | Common uniforms + helpers shared across shaders. |
| `LIGHTING_CHUNK` | PBR direct + IBL lighting calculation. |
| `FOG_CHUNK` / `FOG_EXP2_CHUNK` | Linear / exponential fog blending. |
| `NORMAL_PACK_CHUNK` | Normal encoding / decoding for G-Buffer. |
| `SHADOW_CHUNK` | PCF shadow map sampling. |
| `ENVMAP_CHUNK` | Cube / equirect envmap sampling for IBL. |
| `TONEMAP_ACES_CHUNK` / `TONEMAP_REINHARD_CHUNK` | ACES filmic / Reinhard tonemapping. |
| `NOISE_CHUNK` | Hash-based pseudo-noise functions. |
| `UV_TRANSFORM_CHUNK` | UV matrix transform for textures. |
| `COLOR_SPACE_CHUNK` | sRGB ↔ linear conversion. |

`ShaderChunkRegistry` (singleton `shaderChunkRegistry`) supports
`#include <name>` resolution. `registerBuiltinChunks()` registers all
built-ins idempotently. `BUILTIN_SHADER_CHUNKS` is a
`Record<string, string>` of all built-in fragments for one-shot
registration to a custom registry.

### `shaders.ts`

Built-in shader source: `STANDARD_VERTEX_SRC` /
`STANDARD_FRAGMENT_SRC`, shadow / depth-normal / SSAO / post-processing
shaders.

---

## Usage Examples

### PBR

```ts
import { StandardMaterial, MeshPhysicalMaterial } from '@vreen/engine/materials';

const gold = new StandardMaterial({
  baseColor: { r: 1.0, g: 0.71, b: 0.29 },
  metallic: 1.0,
  roughness: 0.2,
});

const glass = new MeshPhysicalMaterial({
  baseColor: { r: 0.9, g: 0.9, b: 0.9 },
  metallic: 0,
  roughness: 0.05,
  transmission: 1.0,
  IOR: 1.52,
  thickness: 0.5,
});
```

### Custom shader

```ts
import { ShaderMaterial } from '@vreen/engine/materials';

const plasma = new ShaderMaterial({
  vertexSrc: `
    in vec3 a_position;
    uniform mat4 u_model, u_view, u_projection;
    void main() {
      gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
    }
  `,
  fragmentSrc: `
    precision highp float;
    uniform float u_time;
    out vec4 fragColor;
    void main() {
      vec3 c = 0.5 + 0.5 * cos(u_time + vec3(0, 2, 4));
      fragColor = vec4(c, 1.0);
    }
  `,
  uniforms: { u_time: { value: 0 } },
});

// each frame: plasma.uniforms.u_time.value = elapsedTime;
```

### `onBeforeCompile` injection

```ts
const mat = new StandardMaterial({ metallic: 0.5, roughness: 0.5 });
mat.onBeforeCompile = (shader) => {
  shader.fragmentSrc = shader.fragmentSrc.replace(
    'vec3 outgoingLight = totalDiffuse + totalSpecular;',
    'outgoingLight *= 1.5; // boost brightness'
  );
};
```

### Fur

```ts
import { FurShell, FurMaterial } from '@vreen/engine';
const fur = new FurMaterial({
  furLength: 0.3,
  furDensity: 0.9,
  furColor: new Color(0.4, 0.2, 0.1),
  gravity: new Vector3(0, -1, 0),
  wind: new Vector3(0.1, 0, 0.2),
});
const shell = new FurShell({ baseMesh, material: fur, shellCount: 16 });
scene.add(shell.generate());

// each frame:
shell.update(dt);
```

### Pre-Integrated Skin (AAA-grade skin shading)

```ts
import {
  PreIntegratedSkinMaterial,
  SubsurfaceScatteringMaterial,
  SKIN_PROFILE,
} from '@vreen/engine';

// Large skin surfaces (cheek / forehead) — Pre-Integrated Skin
const skin = new PreIntegratedSkinMaterial({
  baseColor: { r: 0.9, g: 0.7, b: 0.6 },
  roughness: 0.4,
  translucency: 0.6,
});
// Mesh should carry an `a_curvature` vertex attribute (1/radius, mm⁻¹)
// baked at authoring time. If absent, the material falls back to `curvature`.
faceMesh.material = skin;

// Thin rims (ear / nose wing) — translucent-shadow approximation
const earTip = new SubsurfaceScatteringMaterial({
  baseColor: { r: 0.9, g: 0.7, b: 0.6 },
  subsurfaceColor: { r: 1.0, g: 0.3, b: 0.2 },
  thickness: 0.2,      // thin → more transmission
  translucency: 0.9,
});
earMesh.material = earTip;

// CPU reference (for tests / offline baking):
const result = skin.computeSSS(
  position, normal, lightDir, viewDir,
  /*curvature=*/ 1.5, /*thickness=*/ 0.5,
);
// result = { diffuse, specular, transmissive, total }

// Custom scattering profile (e.g. wax / jade):
import type { DiffuseProfile } from '@vreen/engine';
const WAX_PROFILE: DiffuseProfile = {
  scatteringRadius: { r: 0.8, g: 0.8, b: 0.8 },  // isotropic
  singleScatterAlbedo: { r: 0.95, g: 0.95, b: 0.95 },
  f0: 0.02,
};
const wax = new PreIntegratedSkinMaterial({ profile: WAX_PROFILE });

// Share LUTs across multiple skin materials (memory-efficient):
const skin2 = new PreIntegratedSkinMaterial();
skin2.shareLUTs(skin.diffuseLUT, skin.transmittanceLUT);
```

---

## Comparison with soup3D

`soup3D` (https://github.com/OrenLiu/soup3D) has **no subsurface
scattering** at all — every material uses flat Lambert or basic PBR
without any BSSRDF approximation. For organic subjects (human skin,
wax, jade, milk, leaves) this produces a hard, plasticky look where
shadow terminators are sharp and back-lit areas stay dark.

VREEN ships **two complementary SSS approaches**, both absent from
soup3D:

| Capability | soup3D | VREEN |
|------------|--------|-------|
| Translucent-shadow SSS | **None** | `SubsurfaceScatteringMaterial` (Penner/GDC2011 style) |
| Pre-Integrated BSSRDF LUT | **None** | `PreIntegratedSkinMaterial` (d'Eon 2007, GPU Gems 3 Ch. 14) |
| Per-channel scattering radius | **None** | RGB `scatteringRadius` / `DiffuseProfile.scatteringRadius` |
| Pre-baked diffuse LUT | **None** | `DiffuseLUT` 256×256×3 (curvature-aware terminator softening) |
| Pre-baked transmittance LUT | **None** | `TransmittanceLUT` 256×3 (R>G>B red-tail physics) |
| CPU reference implementation | **None** | `computeSSS()` matches GLSL fragment for testing |
| Custom scattering profiles | **None** | `DiffuseProfile` + `setProfile()` (skin / wax / jade) |
| LUT sharing across materials | **None** | `shareLUTs()` avoids duplicate LUT generation |
| Curvature vertex attribute | **None** | `a_curvature` per-vertex (1/radius, mm⁻¹) |

**Where VREEN pulls ahead.**

- **Skin realism.** soup3D cannot render convincing human skin — the
  hard shadow terminator and absence of red back-lighting make faces
  look like plastic. VREEN's `PreIntegratedSkinMaterial` pre-bakes the
  BSSRDF convolution into a 256×256 diffuse LUT indexed by
  `(N·L, curvature)`, softening the terminator on curved surfaces
  (cheeks, forehead) and producing the characteristic warm wraparound.
  The 256×3 transmittance LUT captures the R > G > B scattering
  asymmetry (red light travels ~3× farther through skin than blue),
  so back-lit ears and nose wings glow red — the signature skin look.
- **Two-tier fidelity.** VREEN offers both the cheap translucent-shadow
  approximation (for thin rims, `SubsurfaceScatteringMaterial`) and the
  AAA-grade pre-integrated BSSRDF (for large surfaces,
  `PreIntegratedSkinMaterial`). soup3D offers neither. The two can be
  mixed in the same scene: PreIntegratedSkin for the face,
  SubsurfaceScatteringMaterial for ear tips.
- **Physically-measured profile.** The default `SKIN_PROFILE` uses
  d'Eon 2007's published skin measurements (R=0.65mm, G=0.38mm,
  B=0.22mm scattering radii, F0=0.028 for IOR 1.4). soup3D has no
  concept of a scattering profile.
- **Headless-testable.** The LUT generator is pure CPU math (no WebGL
  / DOM dependency), so it runs in Node tests and build-time bake
  steps. The CPU `computeSSS()` reference matches the GLSL fragment
  for regression testing. soup3D's materials have no such reference
  path.
- **Curvature-driven.** The `a_curvature` vertex attribute lets artists
  bake per-vertex curvature at authoring time, so the shader knows
  exactly how soft the terminator should be at each point. soup3D has
  no curvature input.

**Where soup3D still matches.** For non-organic materials (metal, wood,
plastic, fabric) both engines produce equivalent results — SSS only
matters for translucent organic surfaces. VREEN's advantage is
concentrated on skin, wax, jade, milk, and leaves, which are exactly
the cases where soup3D falls back to hard plastic.

---

## Design Notes

**Variant caching.** `WebGL2Renderer.getProgramFor(material, skinned)`
returns one of two cached programs (standard / skinned) and uses uniform
values to differentiate materials. This is adequate for small scenes;
larger scenes will need shader keys composed from material attribute
combinations (Three.js approach — tracked in Phase 3.3, material-graph
blocks). `onBeforeCompile` invalidates the program cache when the
material shader-injection signature changes.

**Why does `FurMaterial` extend `BasicMaterial`?** Fur is rendered with
many transparent shell layers, each contributing only alpha and a small
colour tint. Lighting per shell would be wasteful (the base mesh's
standard material already receives full PBR lighting). The fur shader
samples the base colour, applies root occlusion, and discards by density
— no lighting computation. Same reasoning applies to `ToonMaterial` and
`OutlineMaterial`: they reuse `BasicMaterial`'s uniform / texture
infrastructure but override the shader.

**Why a `ShaderChunks/` registry?** Large GLSL shaders become
unmaintainable as monolithic strings. The `#include <name>` resolution
mirrors Three.js' `ShaderChunk` pattern and lets materials compose
fragments (fog + shadow + tonemapping) without copy-paste. Custom
materials can register their own chunks and reuse built-ins.

**Name collision.** `BasicMaterial` exists both as the abstract unlit
base class in this module and as a concrete class with the same name in
some Three.js examples. The engine barrel exports `MeshBasicMaterial`
as the user-facing concrete class; `BasicMaterial` is the internal base.

**Why two SSS materials?** `SubsurfaceScatteringMaterial` and
`PreIntegratedSkinMaterial` solve different problems. The translucent-
shadow approximation (`SSSMaterial`) is a per-pixel analytical model —
cheap, but it only captures back-lighting through thin walls. The
pre-integrated BSSRDF LUT (`PreIntegratedSkinMaterial`) pre-bakes the
full diffuse convolution indexed by `(N·L, curvature)`, capturing the
soft shadow terminator on curved surfaces that the translucent-shadow
model misses. For a hero character, use both: `PreIntegratedSkin` on
the face/limbs (large curved areas) and `SSSMaterial` on ear tips /
nose wings (thin transmission). This mirrors the AAA production
pattern — Unreal and o3de both layer multiple SSS techniques rather
than relying on a single one.

**Why `Float32Array` for LUT data.** Both `DiffuseLUT` and
`TransmittanceLUT` store their data as flat `Float32Array` rather than
nested arrays or `Uint8Array`. This matches the `LightProbe.sh` design
pattern: one allocation, one `gl.texImage2D` call, cache-friendly
linear access. `Uint8Array` would halve memory but require
quantisation (lossy); `Float32Array` preserves the full precision of
the BSSRDF integration. The LUTs are immutable after generation, so
the same buffer can be shared across multiple materials via
`shareLUTs()` without copy-on-write concerns.

**Why the diffuse LUT uses a gaussian kernel, not the full dipole.**
The d'Eon 2007 paper uses the Jensen dipole BSSRDF for the diffuse
convolution, which requires evaluating exponential integrals with
multiple terms per sample. For a 256×256 LUT with 32 samples per
cell, that's 2M dipole evaluations — slow enough to notice at load
time. VREEN uses a single-gaussian approximation
`exp(-distance²/σ²)` with per-channel σ from the scattering profile.
This captures the dominant visual effect (red scatters farther than
blue) at a fraction of the cost, and the LUT is generated once and
cached. The trade-off is some loss of physical accuracy in the
multi-scatter tail, which is acceptable for real-time rendering.
