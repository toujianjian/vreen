# PassGraph Module

> Path: `src/engine/Renderer/PassGraph/`
>
> A composable, hierarchical render-pass tree for the `@vreen/engine` renderer.
> Data-driven construction, attachment pooling, and per-frame render-context
> bookkeeping, adapted from the o3de Atom RPI (Render Passive Interface) Pass
> system. Designed as an opt-in companion to the flat
> `PostProcessingPipeline` in `Renderer/RenderPass.ts`.

---

## Purpose

`PassGraph` models a frame as a tree of `Pass` nodes rather than a fixed
linear queue. Each pass declares the attachments it reads (inputs) and
writes (outputs); the graph owns the attachment pool and drives a two-phase
per-frame lifecycle — `prepare(ctx)` then `execute(ctx)` — over the enabled
subtree. Pass templates are JSON-serializable, so an entire pipeline can be
authored as an asset, hot-reloaded, and instantiated by `PassFactory`.

This mirrors the o3de Atom rationale: separating pass *declaration* from
*execution* lets the same tree run under a real WebGL2 backend, a headless
software backend, or a GPU-less test harness. Default passes here mutate only
the `PassRenderContext` debug counters, so they are unit-testable without a
GL context.

Coexistence with the legacy post-processing stack: `Renderer/RenderPass.ts`
exposes `PostProcessingPipeline` — a fixed-order chain of `RenderPass`
instances (`BloomPass`, `FXAAPass`, ...) with no nesting and no shared
attachment pool. This module adds arbitrary nesting, named attachments as
data-flow edges, JSON templates, and selector branching — use it for
render-to-texture subgraphs, multi-viewport, cube-map pre-bake, or
user-inserted passes.

---

## Overview

```
   PassGraph  (pipeline owner)
     ├── root: ParentPass → user passes (tree, depth-first execute)
     ├── attachments: Map<name, PassAttachment>  (the data-flow edges)
     └── context: PassRenderContext  (size/frame/time + debug counters)

   Pass  (abstract base: name, type, parent, children, inputs, outputs, enabled)
     ├── prepare(ctx)   declare / resize attachments, validate inputs
     └── execute(ctx)   perform the rendering work

   Concrete passes
     ┌──────────────────┬──────────────────────────────────────────────────────────┐
     │ ParentPass       │ grouping / root; owns children, does no rendering         │
     │ ClearPass        │ clears one output attachment to a Vector4                 │
     │ CopyPass         │ blits / down-/up-samples one attachment to another         │
     │ RasterPass       │ abstract; renders a scene with a camera (subclass it)     │
     │ FullscreenPass   │ runs a fullscreen shader: input → output                  │
     │ ComputePass      │ placeholder for a compute dispatch (WebGL2: no-op shape)  │
     │ SelectorPass     │ picks one child per frame via a predicate                 │
     └──────────────────┴──────────────────────────────────────────────────────────┘

   Supporting types
     PassAttachment    texture descriptor + instance (format, size 0=inherit, load/store op)
     PassTemplate      JSON-serializable pass descriptor (type, attachments, children, ...)
     PassLibrary       name → PassTemplate registry (hot-reload friendly)
     PassFactory       builds a Pass tree from a PassTemplate (shares attachments by name)
     PassRenderContext per-frame mutable state (frame/time/size + debug counters)
```

Per-frame execution order inside `PassGraph.render()`:

1. `context.frame++` and `context.reset()` — clear per-frame debug counters.
2. Depth-first `prepare(ctx)` over enabled passes (subtrees whose root is
   `enabled === false` are skipped entirely).
3. Depth-first `execute(ctx)` over the same set.
4. A pass with `managesChildren() === true` (e.g. `SelectorPass`) is called,
   but its children are **not** auto-visited — it dispatches to the selected
   child itself, preventing double execution.

---

## Core Classes

### Pass hierarchy (`Pass.ts`)

| Export | Role |
|--------|------|
| `Pass` | Abstract base. Holds `name`, `type`, `parent`, `children`, `inputs`, `outputs`, `enabled`. Declares `prepare`/`execute` and tree helpers (`addChild`, `removeChild`, `findByName`, `traverse`). Override `managesChildren()` to take over child dispatch. |
| `ParentPass` | Concrete grouping node. No rendering work; exists to own children. The default `root` of a `PassGraph` is a `ParentPass`. |
| `ClearPass` | Clears its single output attachment to a `Vector4` clear value. Pushes the attachment name onto `ctx.clearedAttachments`. |
| `CopyPass` | Copies one input attachment to one output attachment (blit / down-/up-sample). Pushes `{ from, to }` onto `ctx.copiedAttachments`. |
| `RasterPass` | Abstract scene-rendering pass. Exposes `scene`, `camera`, and a normalized `viewport: Vector4`. Subclass it to implement forward / deferred draws. Cannot be instantiated from a template. |
| `FullscreenPass` | Runs a fullscreen shader identified by `shaderKey`, reading one input attachment and writing one output. Pushes its name onto `ctx.executedFullscreen`. |
| `ComputePass` | Placeholder for a compute dispatch (`shaderKey`, workgroup counts). WebGL2 has no compute, so this only records intent; pushes its name onto `ctx.executedCompute`. |
| `SelectorPass` | Branch node. A `(ctx) => number` predicate selects one child per frame; only that child is `prepare`d and `execute`d. Returns `managesChildren() === true`. |

### PassAttachment (`PassAttachment.ts`)

| Export | Role |
|--------|------|
| `PassAttachment` | Texture descriptor + runtime instance. Constructed from a `PassAttachmentDescriptor`. Mutable `width`/`height` are resolved against the pipeline by `PassGraph.resize()`. Forms the data-flow edge between a producer pass and a consumer pass. |
| `PassAttachmentDescriptor` | Construction shape: `{ name, format, width, height, mipLevels?, samples?, clearValue?, loadOp?, storeOp? }`. |
| `PassAttachmentFormat` | Union of supported formats: `'rgba8'`, `'rgba16f'`, `'rgba32f'`, `'r8'`, `'r16f'`, `'r32f'`, `'depth24stencil8'`, `'depth32f'`. |

Attachment sizing convention: `width`/`height` of `0` means *inherit from the
pipeline*. `PassGraph.resize(w, h)` walks the attachment pool and substitutes
any `0` with the pipeline size, leaving explicit sizes untouched.

### PassTemplate + PassLibrary (`PassTemplate.ts`)

| Export | Role |
|--------|------|
| `PassTemplate` | JSON-serializable descriptor: `{ name, type, attachments?, shaderKey?, inputName?, outputName?, clearValue?, selectorIndex?, children? }`. The `type` field is one of `'parent' \| 'clear' \| 'copy' \| 'raster' \| 'fullscreen' \| 'compute' \| 'selector'`. |
| `PassLibrary` | Name → `PassTemplate` registry. Methods: `register`, `get`, `has`, `list`, `clear`. Use it to hold an asset-authored set of templates for hot-reload. |
| `defaultPassLibrary` | A shared singleton `PassLibrary` instance. |

### PassFactory (`PassFactory.ts`)

| Export | Role |
|--------|------|
| `PassFactory` | Builds a `Pass` tree from a `PassTemplate`. Attachments are shared via a name-keyed `Map<string, PassAttachment>` cache, so multiple passes referencing the same `inputName` / `outputName` resolve to the same `PassAttachment` instance — that is the data-flow edge. Throws on missing required fields (e.g. a `'clear'` template without `outputName`). |

`PassFactory.fromTemplate(template, attachmentCache?)` is the single entry
point. For `'parent'` and `'selector'` templates it recurses into
`template.children`. A `'raster'` template is rejected — `RasterPass` is
abstract and must be subclassed and built in code.

### PassGraph (`PassGraph.ts`)

| Export | Role |
|--------|------|
| `PassGraph` | Pipeline owner. Constructed with `(width, height)`. Owns the `root: ParentPass`, an `attachments` pool, and a mutable `context: PassRenderContext`. Methods: `add`, `addAttachment`, `getAttachment`, `resize`, `render`, `findPass`, `toJSON`, `dispose`. |
| `PassRenderContext` | Per-frame mutable state: `width`, `height`, `frame`, `time`, and debug arrays (`clearedAttachments`, `copiedAttachments`, `executedFullscreen`, `executedCompute`). `reset()` truncates the debug arrays. |
| `createRenderContext` | Factory for a fresh `PassRenderContext`. |

`PassGraph.render()` is synchronous and side-effect-bounded: it only mutates
`context` and (in a real backend) would enqueue GL commands inside each
pass's `execute`. The default passes here only touch the debug counters, so
`render()` is safe to call in a headless test.

---

## Usage

### Example 1 — build a graph programmatically

```ts
import { PassGraph } from './PassGraph';
import { ClearPass, CopyPass, FullscreenPass } from './Pass';
import { PassAttachment } from './PassAttachment';
import { Vector4 } from '../../Math/Vector4';

// 1. Create the pipeline (also seeds the render context size).
const graph = new PassGraph(1920, 1080);

// 2. Declare attachments. width/height 0 = inherit from the pipeline.
const sceneColor = new PassAttachment({ name: 'sceneColor', format: 'rgba16f', width: 0, height: 0 });
const bright = new PassAttachment({ name: 'bright', format: 'rgba16f', width: 0, height: 0 });
const composed = new PassAttachment({ name: 'composed', format: 'rgba8', width: 0, height: 0 });

graph
  .addAttachment(sceneColor)
  .addAttachment(bright)
  .addAttachment(composed);

// 3. Wire the pass tree onto the root.
graph.add(new ClearPass('clearScene', sceneColor, new Vector4(0, 0, 0, 1)));
graph.add(new FullscreenPass('bloom', 'bloomShader', sceneColor, bright));
graph.add(new CopyPass('copyToScreen', bright, composed));

// 4. Render one frame, then inspect the per-frame context.
graph.render();

console.log(graph.context.clearedAttachments);  // ['sceneColor']
console.log(graph.context.executedFullscreen);  // ['bloom']
console.log(graph.context.copiedAttachments);   // [{ from: 'bright', to: 'composed' }]
console.log(graph.context.frame);                // 1

// 5. Resize propagates to attachments whose size was 0.
graph.resize(1280, 720);
console.log(sceneColor.width, sceneColor.height); // 1280, 720
```

### Example 2 — build from a JSON template via `PassFactory`

```ts
import { PassGraph } from './PassGraph';
import { PassFactory } from './PassFactory';
import type { PassTemplate } from './PassTemplate';

// The same tree as Example 1, but data-driven.
const template: PassTemplate = {
  name: 'postTree',
  type: 'parent',
  children: [
    {
      name: 'clearScene',
      type: 'clear',
      outputName: 'sceneColor',
      clearValue: [0, 0, 0, 1],
    },
    {
      name: 'bloom',
      type: 'fullscreen',
      shaderKey: 'bloomShader',
      inputName: 'sceneColor',
      outputName: 'bright',
    },
    {
      name: 'copyToScreen',
      type: 'copy',
      inputName: 'bright',
      outputName: 'composed',
    },
  ],
};

// PassFactory shares attachments by name through the cache.
const attachmentCache = new Map();
const tree = PassFactory.fromTemplate(template, attachmentCache);

// Mount the built tree into a graph and register the resolved attachments.
const graph = new PassGraph(1920, 1080);
graph.add(tree);
attachmentCache.forEach((attachment) => graph.addAttachment(attachment));

graph.render();

// Attachments were created on demand with a default 'rgba8' descriptor.
console.log(graph.getAttachment('sceneColor')?.descriptor.format); // 'rgba8'
```

A `SelectorPass` template picks its child by `selectorIndex`, which is handy
for quality-tier branching:

```ts
const qualityTemplate: PassTemplate = {
  name: 'aaPicker',
  type: 'selector',
  selectorIndex: 1, // execute child[1] each frame
  children: [
    { name: 'fxaa',  type: 'fullscreen', shaderKey: 'fxaa',  inputName: 'src', outputName: 'out' },
    { name: 'taa',   type: 'fullscreen', shaderKey: 'taa',   inputName: 'src', outputName: 'out' },
  ],
};
```

---

## Invariants

Properties guaranteed by the implementation and relied on by callers and
tests. Keep them true when extending the module.

- **Tree consistency.** Every child in `pass.children` has `child.parent === pass`.
  `addChild` sets the back-reference; `removeChild` clears it. A pass is in at
  most one parent at a time (moving it requires an explicit `removeChild`).
- **Attachment sizing.** `PassAttachmentDescriptor.width`/`height` of `0` means
  *inherit from the pipeline*. `PassGraph.resize(w, h)` substitutes every `0`
  with the pipeline size; explicit non-zero sizes are preserved.
- **`enabled` skips both phases.** A pass with `enabled === false` is skipped
  for *both* `prepare` and `execute`, and so is its entire subtree. Disabling a
  parent is therefore a cheap way to drop a subgraph.
- **`managesChildren` controls descent.** `PassGraph.render()` does not
  auto-recurse into a pass whose `managesChildren()` returns `true`; that pass
  dispatches to the selected child itself. `SelectorPass` is the only built-in
  opt-in — custom branch passes must do the same to avoid double execution.
- **Attachment sharing by name.** `PassFactory.fromTemplate` resolves every
  `inputName`/`outputName` through a single name-keyed cache, so two passes
  referencing `'bright'` receive the *same* `PassAttachment` instance. The
  data-flow edge is identity, not a copy.
- **Two-phase lifecycle is ordered.** All enabled passes complete `prepare`
  before any pass runs `execute`, so inputs are resized/validated before read.
- **`render()` is side-effect-bounded.** Default passes mutate only
  `PassRenderContext`; a real backend enqueues GL commands inside `execute`. No
  pass mutates the tree structure or the attachment pool mid-frame.
- **`RasterPass` is abstract.** It cannot be produced from a `PassTemplate`
  (`PassFactory` throws for `type: 'raster'`); subclass it in code and add the
  instance to the graph directly.

---

## References

- **o3de Atom RPI — Pass system.** The hierarchical pass tree, the
  `prepare`/`execute` lifecycle, attachment descriptors with `0 = inherit`
  sizing, and the data-driven template/factory split are adapted from o3de
  Atom's `Gems/Atom/RPI/Public/Pass/` (`Pass.h`, `PassAttachment.h`,
  `PassTemplate.h`, `PassFactory.h`).
- **three.js `EffectComposer`.** The flat `RenderPass` / `ShaderPass` chain in
  `Renderer/RenderPass.ts` mirrors `EffectComposer`. This module generalizes
  that into a tree with named attachments, selector branching, and JSON
  authoring — use it when the linear chain is too rigid.
- **`Renderer/RenderGraph.ts`.** Sibling resource-dependency graph
  (topological sort, lifetime analysis, transient-resource culling).
  `PassGraph` is the *pass-tree* view; `RenderGraph` is the
  *resource-lifetime* view — they complement rather than replace each other.
- **`Renderer/README.md`.** Top-level renderer overview, including where
  `PassGraph` sits relative to `WebGL2Renderer` and the post-processing stack.
