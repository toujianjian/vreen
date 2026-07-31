// PassGraph 单元测试。
//
// 覆盖:
//   1. Pass 基础 (ParentPass / addChild / removeChild / findByName / traverse / enabled)
//   2. PassAttachment (构造 / name/format getter)
//   3. PassGraph (构造 / add / addAttachment / resize / render / findPass / dispose)
//   4. 具体 pass (ClearPass / CopyPass / FullscreenPass / ComputePass / SelectorPass)
//   5. PassTemplate + PassLibrary + PassFactory
//   6. 集成场景 (组合图: clear×2 → bloom → copy)

import { describe, it, expect } from 'vitest';
import {
  Pass,
  ParentPass,
  ClearPass,
  CopyPass,
  FullscreenPass,
  ComputePass,
  SelectorPass,
} from './Pass';
import { PassAttachment, type PassAttachmentDescriptor } from './PassAttachment';
import { PassGraph, createRenderContext, type PassRenderContext } from './PassGraph';
import { PassLibrary, type PassTemplate } from './PassTemplate';
import { PassFactory } from './PassFactory';
import { Vector4 } from '../../Math/Vector4';

/** 计数 pass:记录 prepare/execute 调用次数。 */
class CountingPass extends Pass {
  prepareCount = 0;
  executeCount = 0;
  constructor(name: string) {
    super(name, 'counting');
  }
  prepare(_ctx: PassRenderContext): void {
    this.prepareCount++;
  }
  execute(_ctx: PassRenderContext): void {
    this.executeCount++;
  }
}

/** 记录 prepare/execute 顺序的 pass。 */
class OrderPass extends Pass {
  constructor(
    name: string,
    private log: string[],
  ) {
    super(name, 'order');
  }
  prepare(_ctx: PassRenderContext): void {
    this.log.push(`${this.name}:prepare`);
  }
  execute(_ctx: PassRenderContext): void {
    this.log.push(`${this.name}:execute`);
  }
}

// ---------------------------------------------------------------------------
// Pass 基础
// ---------------------------------------------------------------------------

describe('Pass', () => {
  it('ParentPass has no children initially', () => {
    const p = new ParentPass();
    expect(p.children).toHaveLength(0);
    expect(p.parent).toBeNull();
    expect(p.enabled).toBe(true);
  });

  it('addChild adds child and sets parent (returns this for chaining)', () => {
    const parent = new ParentPass('parent');
    const child = new CountingPass('child');
    const ret = parent.addChild(child);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(child);
    expect(child.parent).toBe(parent);
    expect(ret).toBe(parent);
  });

  it('removeChild removes and clears parent (false for non-existent)', () => {
    const parent = new ParentPass('parent');
    const child = new CountingPass('child');
    parent.addChild(child);
    expect(parent.removeChild(child)).toBe(true);
    expect(parent.children).toHaveLength(0);
    expect(child.parent).toBeNull();
    // already removed → false
    expect(parent.removeChild(child)).toBe(false);
  });

  it('findByName finds nested pass', () => {
    const root = new ParentPass('root');
    const a = new ParentPass('a');
    const b = new CountingPass('b');
    root.addChild(a);
    a.addChild(b);
    expect(root.findByName('b')).toBe(b);
    expect(root.findByName('a')).toBe(a);
    expect(root.findByName('root')).toBe(root);
    expect(root.findByName('nonexistent')).toBeNull();
  });

  it('traverse visits all passes depth-first in order', () => {
    // root → a → c, b
    const root = new ParentPass('root');
    const a = new ParentPass('a');
    const b = new CountingPass('b');
    const c = new CountingPass('c');
    root.addChild(a);
    root.addChild(b);
    a.addChild(c);
    const visited: string[] = [];
    root.traverse(p => visited.push(p.name));
    // depth-first: root, then a subtree (a, c), then b
    expect(visited).toEqual(['root', 'a', 'c', 'b']);
  });

  it('enabled=false skips prepare+execute in render()', () => {
    const graph = new PassGraph(100, 100);
    const p = new CountingPass('c');
    p.enabled = false;
    graph.add(p);
    graph.render();
    expect(p.prepareCount).toBe(0);
    expect(p.executeCount).toBe(0);
    // re-enable → called once per render
    p.enabled = true;
    graph.render();
    expect(p.prepareCount).toBe(1);
    expect(p.executeCount).toBe(1);
  });

});

// ---------------------------------------------------------------------------
// PassAttachment
// ---------------------------------------------------------------------------

describe('PassAttachment', () => {
  it('constructor stores descriptor and defaults', () => {
    const desc: PassAttachmentDescriptor = {
      name: 'sceneColor',
      format: 'rgba16f',
      width: 1920,
      height: 1080,
    };
    const a = new PassAttachment(desc);
    expect(a.descriptor).toBe(desc);
    expect(a.texture).toBeNull();
    expect(a.width).toBe(0);
    expect(a.height).toBe(0);
    expect(a.written).toBe(false);
  });

  it('name/format getters work', () => {
    const a = new PassAttachment({ name: 'depth', format: 'depth32f', width: 0, height: 0 });
    expect(a.name).toBe('depth');
    expect(a.format).toBe('depth32f');
  });
});

// ---------------------------------------------------------------------------
// PassGraph
// ---------------------------------------------------------------------------

describe('PassGraph', () => {
  it('constructor creates root + context with width/height', () => {
    const g = new PassGraph(800, 600);
    expect(g.root).toBeInstanceOf(ParentPass);
    expect(g.root.name).toBe('root');
    expect(g.context.width).toBe(800);
    expect(g.context.height).toBe(600);
    expect(g.context.frame).toBe(0);
    expect(g.attachments.size).toBe(0);
  });

  it('add appends to root (returns this)', () => {
    const g = new PassGraph(100, 100);
    const p = new CountingPass('c');
    const ret = g.add(p);
    expect(ret).toBe(g);
    expect(g.root.children).toContain(p);
    expect(p.parent).toBe(g.root);
  });

  it('addAttachment + getAttachment round-trip', () => {
    const g = new PassGraph(100, 100);
    const a = new PassAttachment({ name: 'color', format: 'rgba8', width: 0, height: 0 });
    const ret = g.addAttachment(a);
    expect(ret).toBe(g);
    expect(g.getAttachment('color')).toBe(a);
    expect(g.getAttachment('nonexistent')).toBeUndefined();
  });

  it('resize updates context + attachments with width=0 (inherit)', () => {
    const g = new PassGraph(100, 100);
    const a = new PassAttachment({ name: 'color', format: 'rgba8', width: 0, height: 0 });
    g.addAttachment(a);
    g.resize(1920, 1080);
    expect(g.context.width).toBe(1920);
    expect(g.context.height).toBe(1080);
    expect(a.width).toBe(1920);
    expect(a.height).toBe(1080);
  });

  it('resize does NOT override explicit width/height', () => {
    const g = new PassGraph(100, 100);
    const a = new PassAttachment({ name: 'shadow', format: 'r16f', width: 512, height: 512 });
    g.addAttachment(a);
    g.resize(1920, 1080);
    expect(a.width).toBe(512);
    expect(a.height).toBe(512);
  });

  it('render increments frame, resets context, calls prepare then execute', () => {
    const g = new PassGraph(100, 100);
    const log: string[] = [];
    g.add(new OrderPass('a', log));
    g.render();
    expect(g.context.frame).toBe(1);
    // all prepares happen before all executes
    expect(log).toEqual(['a:prepare', 'a:execute']);
    // second render increments frame again
    log.length = 0;
    g.render();
    expect(g.context.frame).toBe(2);
    expect(log).toEqual(['a:prepare', 'a:execute']);
  });

  it('render resets context arrays each frame (no accumulation)', () => {
    const g = new PassGraph(100, 100);
    const target = new PassAttachment({ name: 't', format: 'rgba8', width: 0, height: 0 });
    g.add(new ClearPass('clear', target, new Vector4(0, 0, 0, 1)));
    g.render();
    expect(g.context.clearedAttachments).toHaveLength(1);
    g.render();
    // reset cleared the previous frame's entry before execute repopulated
    expect(g.context.clearedAttachments).toHaveLength(1);
  });

  it('findPass finds nested pass', () => {
    const g = new PassGraph(100, 100);
    const parent = new ParentPass('group');
    const child = new CountingPass('nested');
    parent.addChild(child);
    g.add(parent);
    expect(g.findPass('nested')).toBe(child);
    expect(g.findPass('group')).toBe(parent);
    expect(g.findPass('missing')).toBeNull();
  });

  it('dispose clears children and attachments', () => {
    const g = new PassGraph(100, 100);
    g.add(new CountingPass('c'));
    g.addAttachment(new PassAttachment({ name: 'a', format: 'rgba8', width: 0, height: 0 }));
    expect(g.root.children.length).toBeGreaterThan(0);
    expect(g.attachments.size).toBeGreaterThan(0);
    g.dispose();
    expect(g.root.children).toHaveLength(0);
    expect(g.attachments.size).toBe(0);
  });

  it('toJSON serializes the pass tree', () => {
    const g = new PassGraph(100, 100);
    const input = new PassAttachment({ name: 'in', format: 'rgba8', width: 0, height: 0 });
    const output = new PassAttachment({ name: 'out', format: 'rgba8', width: 0, height: 0 });
    g.add(new FullscreenPass('fx', 'shader', input, output));
    const json = g.toJSON() as {
      name: string;
      type: string;
      inputs: string[];
      outputs: string[];
      children: unknown[];
    };
    // root has one fullscreen child
    expect(json.name).toBe('root');
    expect(json.type).toBe('parent');
    expect(json.children).toHaveLength(1);
    const child = json.children[0] as { name: string; inputs: string[]; outputs: string[] };
    expect(child.name).toBe('fx');
    expect(child.inputs).toEqual(['in']);
    expect(child.outputs).toEqual(['out']);
  });
});

// ---------------------------------------------------------------------------
// 具体 pass
// ---------------------------------------------------------------------------

describe('Concrete passes', () => {
  it('ClearPass.execute pushes to ctx.clearedAttachments', () => {
    const ctx = createRenderContext(100, 100);
    const target = new PassAttachment({ name: 'color', format: 'rgba8', width: 0, height: 0 });
    const pass = new ClearPass('clearColor', target, new Vector4(0.1, 0.2, 0.3, 1));
    pass.prepare(ctx);
    pass.execute(ctx);
    expect(ctx.clearedAttachments).toContain('color');
    expect(pass.outputs[0]).toBe(target);
    // constructor writes clearValue back onto the descriptor
    expect(target.descriptor.clearValue).toEqual(new Vector4(0.1, 0.2, 0.3, 1));
  });

  it('CopyPass.execute pushes to ctx.copiedAttachments with correct from/to', () => {
    const ctx = createRenderContext(100, 100);
    const src = new PassAttachment({ name: 'src', format: 'rgba8', width: 0, height: 0 });
    const dst = new PassAttachment({ name: 'dst', format: 'rgba8', width: 0, height: 0 });
    const pass = new CopyPass('copy', src, dst);
    pass.prepare(ctx);
    pass.execute(ctx);
    expect(ctx.copiedAttachments).toEqual([{ from: 'src', to: 'dst' }]);
    expect(pass.inputs[0]).toBe(src);
    expect(pass.outputs[0]).toBe(dst);
  });

  it('FullscreenPass.execute pushes to ctx.executedFullscreen', () => {
    const ctx = createRenderContext(100, 100);
    const input = new PassAttachment({ name: 'in', format: 'rgba8', width: 0, height: 0 });
    const output = new PassAttachment({ name: 'out', format: 'rgba8', width: 0, height: 0 });
    const pass = new FullscreenPass('bloom', 'bloom_shader', input, output);
    pass.prepare(ctx);
    pass.execute(ctx);
    expect(ctx.executedFullscreen).toContain('bloom');
    expect(pass.shaderKey).toBe('bloom_shader');
    expect(pass.inputs[0]).toBe(input);
    expect(pass.outputs[0]).toBe(output);
  });

  it('ComputePass.execute pushes to ctx.executedCompute', () => {
    const ctx = createRenderContext(100, 100);
    const pass = new ComputePass('gpuBlur', 'blur_cs');
    pass.prepare(ctx);
    pass.execute(ctx);
    expect(ctx.executedCompute).toContain('gpuBlur');
    expect(pass.shaderKey).toBe('blur_cs');
  });

  it('SelectorPass returning 0 executes child 0 only', () => {
    const ctx = createRenderContext(100, 100);
    let idx = 0;
    const sel = new SelectorPass('sel', () => idx);
    const c0 = new CountingPass('c0');
    const c1 = new CountingPass('c1');
    sel.addChild(c0);
    sel.addChild(c1);

    idx = 0;
    sel.prepare(ctx);
    sel.execute(ctx);
    expect(c0.prepareCount).toBe(1);
    expect(c0.executeCount).toBe(1);
    expect(c1.prepareCount).toBe(0);
    expect(c1.executeCount).toBe(0);
  });

  it('SelectorPass returning 1 executes child 1 only', () => {
    const ctx = createRenderContext(100, 100);
    let idx = 0;
    const sel = new SelectorPass('sel', () => idx);
    const c0 = new CountingPass('c0');
    const c1 = new CountingPass('c1');
    sel.addChild(c0);
    sel.addChild(c1);

    idx = 1;
    sel.prepare(ctx);
    sel.execute(ctx);
    expect(c0.executeCount).toBe(0);
    expect(c1.executeCount).toBe(1);
  });

  it('SelectorPass returning -1 executes none', () => {
    const ctx = createRenderContext(100, 100);
    let idx = 0;
    const sel = new SelectorPass('sel', () => idx);
    const c0 = new CountingPass('c0');
    const c1 = new CountingPass('c1');
    sel.addChild(c0);
    sel.addChild(c1);

    idx = -1;
    sel.prepare(ctx);
    sel.execute(ctx);
    expect(c0.executeCount).toBe(0);
    expect(c1.executeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PassTemplate + PassLibrary + PassFactory
// ---------------------------------------------------------------------------

describe('PassTemplate + PassLibrary', () => {
  it('register/get/has/list/clear', () => {
    const lib = new PassLibrary();
    const tpl: PassTemplate = { name: 'root', type: 'parent' };
    expect(lib.has('root')).toBe(false);
    expect(lib.get('root')).toBeUndefined();
    lib.register(tpl);
    expect(lib.has('root')).toBe(true);
    expect(lib.get('root')).toBe(tpl);
    expect(lib.list()).toHaveLength(1);
    lib.clear();
    expect(lib.list()).toHaveLength(0);
    expect(lib.has('root')).toBe(false);
  });

  it('PassFactory.fromTemplate builds a parent pass with children', () => {
    const tpl: PassTemplate = {
      name: 'root',
      type: 'parent',
      children: [
        { name: 'clear1', type: 'clear', outputName: 'sceneColor', clearValue: [0, 0, 0, 1] },
        {
          name: 'bloom',
          type: 'fullscreen',
          shaderKey: 'bloom',
          inputName: 'sceneColor',
          outputName: 'bloomColor',
        },
      ],
    };
    const cache = new Map<string, PassAttachment>();
    const pass = PassFactory.fromTemplate(tpl, cache);
    expect(pass).toBeInstanceOf(ParentPass);
    expect(pass.children).toHaveLength(2);
    expect(pass.children[0]).toBeInstanceOf(ClearPass);
    expect(pass.children[1]).toBeInstanceOf(FullscreenPass);
    expect(pass.children[0].name).toBe('clear1');
    expect(pass.children[1].name).toBe('bloom');
  });

  it('PassFactory.fromTemplate for fullscreen links input/output by name from cache', () => {
    const tpl: PassTemplate = {
      name: 'fx',
      type: 'fullscreen',
      shaderKey: 'fxaa',
      inputName: 'srcTex',
      outputName: 'dstTex',
    };
    const cache = new Map<string, PassAttachment>();
    const pass = PassFactory.fromTemplate(tpl, cache) as FullscreenPass;
    expect(pass).toBeInstanceOf(FullscreenPass);
    expect(pass.inputs[0].name).toBe('srcTex');
    expect(pass.outputs[0].name).toBe('dstTex');
    expect(pass.shaderKey).toBe('fxaa');
  });

  it('attachments are shared via cache (same name → same instance)', () => {
    const tpl: PassTemplate = {
      name: 'root',
      type: 'parent',
      children: [
        { name: 'c', type: 'copy', inputName: 'shared', outputName: 'out' },
        { name: 'f', type: 'fullscreen', shaderKey: 's', inputName: 'shared', outputName: 'out2' },
      ],
    };
    const cache = new Map<string, PassAttachment>();
    const pass = PassFactory.fromTemplate(tpl, cache) as ParentPass;
    const copyPass = pass.children[0] as CopyPass;
    const fsPass = pass.children[1] as FullscreenPass;
    // 'shared' resolves to the same PassAttachment instance across both passes
    expect(copyPass.inputs[0]).toBe(fsPass.inputs[0]);
    expect(cache.get('shared')).toBe(copyPass.inputs[0]);
  });

  it('PassFactory.fromTemplate materializes declared attachment descriptors', () => {
    const tpl: PassTemplate = {
      name: 'root',
      type: 'parent',
      attachments: [
        { name: 'hdr', format: 'rgba16f', width: 0, height: 0 },
      ],
      children: [
        { name: 'clear', type: 'clear', outputName: 'hdr', clearValue: [0, 0, 0, 0] },
      ],
    };
    const cache = new Map<string, PassAttachment>();
    PassFactory.fromTemplate(tpl, cache);
    const hdr = cache.get('hdr');
    expect(hdr).toBeDefined();
    expect(hdr?.format).toBe('rgba16f');
  });
});

// ---------------------------------------------------------------------------
// 集成场景
// ---------------------------------------------------------------------------

describe('Integration scenario', () => {
  it('composite graph: clear×2 → bloom → copy renders correctly', () => {
    const graph = new PassGraph(1280, 720);
    const sceneColor = new PassAttachment({
      name: 'sceneColor',
      format: 'rgba16f',
      width: 0,
      height: 0,
    });
    const sceneDepth = new PassAttachment({
      name: 'sceneDepth',
      format: 'depth32f',
      width: 0,
      height: 0,
    });
    const bloomColor = new PassAttachment({
      name: 'bloomColor',
      format: 'rgba16f',
      width: 0,
      height: 0,
    });
    const finalColor = new PassAttachment({
      name: 'finalColor',
      format: 'rgba8',
      width: 0,
      height: 0,
    });
    graph.addAttachment(sceneColor);
    graph.addAttachment(sceneDepth);
    graph.addAttachment(bloomColor);
    graph.addAttachment(finalColor);

    graph.add(new ClearPass('clearColor', sceneColor, new Vector4(0, 0, 0, 1)));
    graph.add(new ClearPass('clearDepth', sceneDepth, new Vector4(1, 0, 0, 0)));
    graph.add(new FullscreenPass('bloom', 'bloom_shader', sceneColor, bloomColor));
    graph.add(new CopyPass('copyFinal', bloomColor, finalColor));

    graph.render();

    expect(graph.context.clearedAttachments).toHaveLength(2);
    expect(graph.context.executedFullscreen).toHaveLength(1);
    expect(graph.context.copiedAttachments).toHaveLength(1);
    expect(graph.context.copiedAttachments[0]).toEqual({
      from: 'bloomColor',
      to: 'finalColor',
    });

    // resize updates inherited attachments (width/height = 0)
    graph.resize(1920, 1080);
    expect(sceneColor.width).toBe(1920);
    expect(sceneColor.height).toBe(1080);
    expect(sceneDepth.width).toBe(1920);
    expect(bloomColor.width).toBe(1920);
    expect(finalColor.width).toBe(1920);

    // findPass returns the FullscreenPass by name
    const bloom = graph.findPass('bloom');
    expect(bloom).toBeInstanceOf(FullscreenPass);
    expect(bloom?.name).toBe('bloom');
  });
});
