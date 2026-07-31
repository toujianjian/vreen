// Pass — abstract base class for all passes in the pass tree.
// Adapted from o3de Atom RPI Pass. Passes form a tree: a ParentPass owns
// children, children execute in array order. Lifecycle per frame:
//   1. prepare(ctx) — declare/resize attachments, validate inputs
//   2. execute(ctx) — perform the actual rendering work
//
// 与 Renderer/RenderPass.ts 的扁平 PostProcessingPipeline 互补:后者是固定
// 顺序的后处理链,本模块是任意嵌套的 pass 树,支持 render-to-texture 子图、
// 多视口、cube-map 预烘焙与用户插入的自定义 pass。

import type { PassAttachment } from './PassAttachment';
import type { PassRenderContext } from './PassGraph';
import { Vector4 } from '../../Math/Vector4';

/**
 * Base class for all passes in the pass tree. Adapted from o3de RPI Pass.
 *
 * Lifecycle per frame:
 *   1. prepare(ctx)  — declare/resize attachments, validate inputs
 *   2. execute(ctx)   — perform the actual rendering work
 *
 * Passes form a tree: a ParentPass owns children. Children execute in array order.
 */
export abstract class Pass {
  readonly name: string;
  readonly type: string;
  parent: Pass | null = null;
  children: Pass[] = [];
  enabled: boolean = true;
  /** Input attachments (read by this pass). */
  inputs: PassAttachment[] = [];
  /** Output attachments (written by this pass). */
  outputs: PassAttachment[] = [];

  constructor(name: string, type: string) {
    this.name = name;
    this.type = type;
  }

  /** Called once per frame before execute. Use to validate inputs, resize attachments, etc. */
  abstract prepare(ctx: PassRenderContext): void;
  /** Called once per frame to perform the rendering work. */
  abstract execute(ctx: PassRenderContext): void;

  addChild(pass: Pass): this {
    pass.parent = this;
    this.children.push(pass);
    return this;
  }
  removeChild(pass: Pass): boolean {
    const i = this.children.indexOf(pass);
    if (i < 0) return false;
    this.children.splice(i, 1);
    pass.parent = null;
    return true;
  }
  findChild(name: string): Pass | null {
    return this.children.find(c => c.name === name) ?? null;
  }
  /** Traverse the subtree (depth-first). */
  traverse(fn: (pass: Pass) => void): void {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }
  /** Find a pass anywhere in the subtree by name. */
  findByName(name: string): Pass | null {
    if (this.name === name) return this;
    for (const c of this.children) {
      const r = c.findByName(name);
      if (r) return r;
    }
    return null;
  }
  /**
   * If true, this pass manages its own children's prepare/execute lifecycle
   * (e.g. SelectorPass picks one child). The graph traversal will NOT recurse
   * into children automatically — the pass is responsible for dispatching.
   */
  managesChildren(): boolean {
    return false;
  }
}

/** A pass that owns children but does no rendering itself (grouping/root). */
export class ParentPass extends Pass {
  constructor(name: string = 'root') {
    super(name, 'parent');
  }
  prepare(_ctx: PassRenderContext): void {
    /* nothing — children handle themselves */
  }
  execute(_ctx: PassRenderContext): void {
    /* nothing */
  }
}

/** A pass that clears an attachment to a color. */
export class ClearPass extends Pass {
  constructor(name: string, target: PassAttachment, clearValue: Vector4) {
    super(name, 'clear');
    this.outputs.push(target);
    target.descriptor.clearValue = clearValue;
  }
  prepare(_ctx: PassRenderContext): void {
    /* validate target exists */
  }
  execute(ctx: PassRenderContext): void {
    /* In a real impl: bind target FBO, gl.clearColor + gl.clear */
    ctx.clearedAttachments.push(this.outputs[0].name);
  }
}

/** A pass that copies one attachment to another (downsample/upsample/blit). */
export class CopyPass extends Pass {
  constructor(name: string, source: PassAttachment, dest: PassAttachment) {
    super(name, 'copy');
    this.inputs.push(source);
    this.outputs.push(dest);
  }
  prepare(_ctx: PassRenderContext): void {
    /* validate source has been written */
  }
  execute(ctx: PassRenderContext): void {
    ctx.copiedAttachments.push({ from: this.inputs[0].name, to: this.outputs[0].name });
  }
}

/** A pass that renders the scene (forward/deferred — abstract). */
export abstract class RasterPass extends Pass {
  scene: any = null; // Scene to render
  camera: any = null; // Camera to use
  viewport: Vector4 = new Vector4(0, 0, 1, 1); // normalized viewport
  constructor(name: string) {
    super(name, 'raster');
  }
}

/** A pass that runs a fullscreen shader (post-processing). */
export class FullscreenPass extends Pass {
  shaderKey: string;
  uniforms: Record<string, any> = {};
  constructor(name: string, shaderKey: string, input: PassAttachment, output: PassAttachment) {
    super(name, 'fullscreen');
    this.shaderKey = shaderKey;
    this.inputs.push(input);
    this.outputs.push(output);
  }
  prepare(_ctx: PassRenderContext): void {}
  execute(ctx: PassRenderContext): void {
    ctx.executedFullscreen.push(this.name);
  }
}

/** A pass that runs a compute shader (placeholder — VREEN renderer is WebGL2, no compute yet). */
export class ComputePass extends Pass {
  shaderKey: string;
  workgroupsX = 1;
  workgroupsY = 1;
  workgroupsZ = 1;
  constructor(name: string, shaderKey: string) {
    super(name, 'compute');
    this.shaderKey = shaderKey;
  }
  prepare(_ctx: PassRenderContext): void {}
  execute(ctx: PassRenderContext): void {
    ctx.executedCompute.push(this.name);
  }
}

/** A pass that selects between children based on a predicate (e.g. quality level). */
export class SelectorPass extends Pass {
  private selector: (ctx: PassRenderContext) => number;
  constructor(name: string, selector: (ctx: PassRenderContext) => number) {
    super(name, 'selector');
    this.selector = selector;
  }
  prepare(ctx: PassRenderContext): void {
    const i = this.selector(ctx);
    if (i >= 0 && i < this.children.length) this.children[i].prepare(ctx);
  }
  execute(ctx: PassRenderContext): void {
    const i = this.selector(ctx);
    if (i >= 0 && i < this.children.length) this.children[i].execute(ctx);
  }
  managesChildren(): boolean {
    return true;
  }
}
