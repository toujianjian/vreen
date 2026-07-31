// PassGraph — the pipeline that owns the root pass + attachment pool + render
// context. Adapted from o3de Atom RPI RenderPassGraph. Execute one frame:
// reset context → prepare all enabled passes → execute all enabled passes.
//
// Passes that manage their own children (e.g. SelectorPass) are responsible
// for dispatching to their children; the traversal does not auto-recurse into
// them, avoiding double-execution of the selected child.

import { ParentPass, type Pass } from './Pass';
import type { PassAttachment } from './PassAttachment';

export interface PassRenderContext {
  width: number;
  height: number;
  frame: number;
  /** seconds. */
  time: number;
  /** Attachments cleared this frame (debug). */
  clearedAttachments: string[];
  /** Attachments copied this frame (debug). */
  copiedAttachments: Array<{ from: string; to: string }>;
  /** Fullscreen passes executed this frame (debug). */
  executedFullscreen: string[];
  /** Compute passes executed this frame (debug). */
  executedCompute: string[];
  /** Reset per-frame counters. */
  reset(): void;
}

export function createRenderContext(width: number, height: number): PassRenderContext {
  return {
    width,
    height,
    frame: 0,
    time: 0,
    clearedAttachments: [],
    copiedAttachments: [],
    executedFullscreen: [],
    executedCompute: [],
    reset() {
      this.clearedAttachments.length = 0;
      this.copiedAttachments.length = 0;
      this.executedFullscreen.length = 0;
      this.executedCompute.length = 0;
    },
  };
}

export class PassGraph {
  root: ParentPass;
  /** All attachments owned by this graph (name → attachment). */
  attachments = new Map<string, PassAttachment>();
  /** Render context (mutated each frame). */
  context: PassRenderContext;

  constructor(width: number, height: number) {
    this.root = new ParentPass('root');
    this.context = createRenderContext(width, height);
  }

  /** Add a top-level pass to the root. */
  add(pass: Pass): this {
    this.root.addChild(pass);
    return this;
  }

  /** Register an attachment with the graph. */
  addAttachment(attachment: PassAttachment): this {
    this.attachments.set(attachment.name, attachment);
    return this;
  }
  getAttachment(name: string): PassAttachment | undefined {
    return this.attachments.get(name);
  }

  /** Resize all attachments. Attachments with width/height = 0 inherit from the pipeline. */
  resize(width: number, height: number): void {
    this.context.width = width;
    this.context.height = height;
    for (const a of this.attachments.values()) {
      a.width = a.descriptor.width === 0 ? width : a.descriptor.width;
      a.height = a.descriptor.height === 0 ? height : a.descriptor.height;
    }
  }

  /** Execute one frame: reset context, prepare all passes, execute all passes. */
  render(): void {
    this.context.frame++;
    this.context.reset();
    this.traverseEnabled(this.root, p => p.prepare(this.context));
    this.traverseEnabled(this.root, p => p.execute(this.context));
  }

  /**
   * Depth-first traversal that respects `enabled` and `managesChildren`.
   * A pass that manages its own children (e.g. SelectorPass) is called but its
   * children are NOT auto-visited — the pass dispatches to the selected child.
   */
  private traverseEnabled(pass: Pass, fn: (p: Pass) => void): void {
    if (!pass.enabled) return;
    fn(pass);
    if (!pass.managesChildren()) {
      for (const c of pass.children) this.traverseEnabled(c, fn);
    }
  }

  /** Find a pass by name anywhere in the tree. */
  findPass(name: string): Pass | null {
    return this.root.findByName(name);
  }

  /** Serialize the graph to a JSON template tree (for hot-reload). */
  toJSON(): unknown {
    return PassGraphToJSON(this.root);
  }

  /** Clear all passes and attachments. */
  dispose(): void {
    this.root.children.length = 0;
    this.attachments.clear();
  }
}

/** Convert a pass tree to a JSON-serializable structure. */
function PassGraphToJSON(pass: Pass): unknown {
  return {
    name: pass.name,
    type: pass.type,
    inputs: pass.inputs.map(a => a.name),
    outputs: pass.outputs.map(a => a.name),
    children: pass.children.map(c => PassGraphToJSON(c)),
  };
}
