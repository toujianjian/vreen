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
   │     └── WireframeMaterial        stylised wireframe
   ├── StandardMaterial               PBR (base color / metallic / roughness / emissive)
   │     └── MeshPhysicalMaterial     extended PBR (clearcoat / sheen / IOR / transmission)
   ├── AdvancedPBRMaterial            anisotropic / iridescence / clearcoat / sheen / emissive
   ├── SubsurfaceScatteringMaterial   skin / wax / jade / milk
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
