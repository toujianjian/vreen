// RenderGraph 单元测试。
//
// 覆盖:
//   1. 节点管理(addNode / removeNode / getNode / getNodes + 重复 id 抛错)
//   2. 资源管理(registerResource / unregisterResource / getResource + 重复名抛错)
//   3. 边管理(addEdge / removeEdge + 未知节点/资源抛错 + 自环拒绝 + 去重)
//   4. 拓扑排序(topologicalSort + 环检测)
//   5. 生命周期计算(computeLifetimes:firstWrite / lastRead)
//   6. 剔除未使用节点(cullUnusedNodes)
//   7. validate(未知资源 / 循环 / 同帧多写冲突)
//   8. compile + getCompiledPasses(creates / destroys)
//   9. execute(默认 ctx + 节点回调执行顺序)
//  10. clear / getStats / exportGraph / importGraph

import { describe, it, expect } from 'vitest';
import { RenderGraph } from './RenderGraph';
import type {
  RenderGraphNode,
  RenderGraphResource,
  RenderGraphContext,
} from './RenderGraph';

/** 构造一个简单的 node 工厂。execute 记录调用顺序到数组。 */
function makeNode(
  id: string,
  inputs: string[],
  outputs: string[],
  log: string[],
  kind: 'render' | 'compute' | 'transfer' = 'render',
): RenderGraphNode {
  return {
    id,
    name: id,
    type: kind,
    inputs,
    outputs,
    execute: (ctx: RenderGraphContext) => {
      log.push(id);
      // 模拟创建/销毁资源
      for (const out of outputs) {
        if (!ctx.resources.has(out)) {
          ctx.createResource(out, `${id}->${out}`);
        }
      }
    },
  };
}

/** 构造一个 transient texture 资源。 */
function makeTexture(name: string, lifetime: 'transient' | 'persistent' = 'transient'): RenderGraphResource {
  return { name, type: 'texture', lifetime, refCount: 0 };
}

// ── 节点管理 ────────────────────────────────────────────────────────

describe('RenderGraph node management', () => {
  it('addNode adds and getNodes returns snapshot', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: [], execute: () => {} });
    rg.addNode({ id: 'b', name: 'B', type: 'compute', inputs: [], outputs: [], execute: () => {} });
    const nodes = rg.getNodes();
    expect(nodes.length).toBe(2);
    expect(nodes[0].id).toBe('a');
    expect(nodes[1].id).toBe('b');
  });

  it('addNode throws on duplicate id', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: [], execute: () => {} });
    expect(() =>
      rg.addNode({ id: 'a', name: 'A2', type: 'render', inputs: [], outputs: [], execute: () => {} }),
    ).toThrow(/already exists/);
  });

  it('getNode returns the node or undefined', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: [], execute: () => {} });
    expect(rg.getNode('a')?.name).toBe('A');
    expect(rg.getNode('missing')).toBeUndefined();
  });

  it('removeNode removes node and its edges, returns true', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: ['r'], execute: () => {} });
    rg.addNode({ id: 'b', name: 'B', type: 'render', inputs: ['r'], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    expect(rg.removeNode('a')).toBe(true);
    expect(rg.getNode('a')).toBeUndefined();
    expect(rg.getEdges().length).toBe(0); // 边也被移除
  });

  it('removeNode returns false for unknown id', () => {
    const rg = new RenderGraph();
    expect(rg.removeNode('missing')).toBe(false);
  });
});

// ── 资源管理 ────────────────────────────────────────────────────────

describe('RenderGraph resource management', () => {
  it('registerResource adds and getResource returns it', () => {
    const rg = new RenderGraph();
    rg.registerResource(makeTexture('color'));
    expect(rg.getResource('color')?.type).toBe('texture');
  });

  it('registerResource throws on duplicate name', () => {
    const rg = new RenderGraph();
    rg.registerResource(makeTexture('color'));
    expect(() => rg.registerResource(makeTexture('color'))).toThrow(/already exists/);
  });

  it('unregisterResource removes resource and its edges', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: ['r'], execute: () => {} });
    rg.addNode({ id: 'b', name: 'B', type: 'render', inputs: ['r'], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    expect(rg.unregisterResource('r')).toBe(true);
    expect(rg.getResource('r')).toBeUndefined();
    expect(rg.getEdges().length).toBe(0);
  });

  it('unregisterResource returns false for unknown name', () => {
    const rg = new RenderGraph();
    expect(rg.unregisterResource('missing')).toBe(false);
  });

  it('getResources returns all resources', () => {
    const rg = new RenderGraph();
    rg.registerResource(makeTexture('a'));
    rg.registerResource({ name: 'b', type: 'buffer', lifetime: 'persistent', refCount: 0 });
    const all = rg.getResources();
    expect(all.length).toBe(2);
  });
});

// ── 边管理 ─────────────────────────────────────────────────────────

describe('RenderGraph edge management', () => {
  it('addEdge adds edge', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: ['r'], execute: () => {} });
    rg.addNode({ id: 'b', name: 'B', type: 'render', inputs: ['r'], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    expect(rg.getEdges().length).toBe(1);
  });

  it('addEdge throws when from node missing', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'b', name: 'B', type: 'render', inputs: [], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    expect(() => rg.addEdge('missing', 'b', 'r')).toThrow(/from node/);
  });

  it('addEdge throws when to node missing', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    expect(() => rg.addEdge('a', 'missing', 'r')).toThrow(/to node/);
  });

  it('addEdge throws when resource not registered', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: [], execute: () => {} });
    rg.addNode({ id: 'b', name: 'B', type: 'render', inputs: [], outputs: [], execute: () => {} });
    expect(() => rg.addEdge('a', 'b', 'missing')).toThrow(/not registered/);
  });

  it('addEdge rejects self-loops', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    expect(() => rg.addEdge('a', 'a', 'r')).toThrow(/self-loop/);
  });

  it('addEdge deduplicates (same from/to/resource)', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: ['r'], execute: () => {} });
    rg.addNode({ id: 'b', name: 'B', type: 'render', inputs: ['r'], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    rg.addEdge('a', 'b', 'r'); // 重复,应被忽略
    expect(rg.getEdges().length).toBe(1);
  });

  it('removeEdge returns true/false correctly', () => {
    const rg = new RenderGraph();
    rg.addNode({ id: 'a', name: 'A', type: 'render', inputs: [], outputs: ['r'], execute: () => {} });
    rg.addNode({ id: 'b', name: 'B', type: 'render', inputs: ['r'], outputs: [], execute: () => {} });
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    expect(rg.removeEdge('a', 'b', 'r')).toBe(true);
    expect(rg.removeEdge('a', 'b', 'r')).toBe(false);
  });
});

// ── 拓扑排序 ────────────────────────────────────────────────────────

describe('RenderGraph topologicalSort', () => {
  it('returns nodes in dependency order', () => {
    const rg = new RenderGraph();
    const log: string[] = [];
    rg.addNode(makeNode('c', ['b'], [], log));
    rg.addNode(makeNode('a', [], ['x'], log));
    rg.addNode(makeNode('b', ['x'], ['b'], log));
    rg.registerResource(makeTexture('x'));
    rg.registerResource(makeTexture('b'));
    rg.addEdge('a', 'b', 'x');
    rg.addEdge('b', 'c', 'b');
    const sorted = rg.topologicalSort();
    const ids = sorted.map((n) => n.id);
    // a 必须在 b 之前,b 必须在 c 之前
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
  });

  it('throws on cycle', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', ['y'], ['x'], []));
    rg.addNode(makeNode('b', ['x'], ['y'], []));
    rg.registerResource(makeTexture('x'));
    rg.registerResource(makeTexture('y'));
    rg.addEdge('a', 'b', 'x');
    rg.addEdge('b', 'a', 'y');
    expect(() => rg.topologicalSort()).toThrow(/cycle/);
  });

  it('handles isolated nodes (no edges)', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('solo', [], [], []));
    const sorted = rg.topologicalSort();
    expect(sorted.length).toBe(1);
    expect(sorted[0].id).toBe('solo');
  });

  it('handles empty graph', () => {
    const rg = new RenderGraph();
    expect(rg.topologicalSort().length).toBe(0);
  });
});

// ── 生命周期 ────────────────────────────────────────────────────────

describe('RenderGraph computeLifetimes', () => {
  it('computes firstWrite and lastRead', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], ['r'], []));
    rg.addNode(makeNode('c', ['r'], [], []));
    rg.registerResource(makeTexture('r'));
    const lt = rg.computeLifetimes();
    const r = lt.get('r')!;
    expect(r.firstWritePass).toBe(0); // 节点 a(插入顺序 0)
    expect(r.lastReadPass).toBe(2); // 节点 c(插入顺序 2)
  });

  it('returns -1 for resources never written', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', ['r'], [], []));
    rg.registerResource(makeTexture('r'));
    const lt = rg.computeLifetimes();
    const r = lt.get('r')!;
    expect(r.firstWritePass).toBe(-1);
    expect(r.lastReadPass).toBe(0); // 节点 a 读取
  });

  it('returns -1 for resources never read', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.registerResource(makeTexture('r'));
    const lt = rg.computeLifetimes();
    const r = lt.get('r')!;
    expect(r.firstWritePass).toBe(0);
    expect(r.lastReadPass).toBe(-1);
  });
});

// ── 剔除 ────────────────────────────────────────────────────────────

describe('RenderGraph cullUnusedNodes', () => {
  it('keeps all nodes when all are outputs or feed outputs', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], [])); // output(无出边)
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    const reachable = rg.cullUnusedNodes();
    expect(reachable.size).toBe(2);
    expect(reachable.has('a')).toBe(true);
    expect(reachable.has('b')).toBe(true);
  });

  it('culls nodes that do not feed any output', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('dead', [], ['x'], [])); // 写 x,但没人读 x → 死节点
    rg.addNode(makeNode('live', [], ['y'], []));
    rg.addNode(makeNode('out', ['y'], [], [])); // output
    rg.registerResource(makeTexture('x'));
    rg.registerResource(makeTexture('y'));
    rg.addEdge('live', 'out', 'y');
    const reachable = rg.cullUnusedNodes();
    expect(reachable.has('live')).toBe(true);
    expect(reachable.has('out')).toBe(true);
    // 'dead' 节点无下游 → 被剔除
    expect(reachable.has('dead')).toBe(false);
  });

  it('keeps isolated nodes (no edges)', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('solo', [], [], []));
    const reachable = rg.cullUnusedNodes();
    expect(reachable.has('solo')).toBe(true);
  });
});

// ── validate ───────────────────────────────────────────────────────

describe('RenderGraph validate', () => {
  it('returns empty array for valid graph', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    expect(rg.validate()).toEqual([]);
  });

  it('detects unregistered resource in inputs', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', ['missing'], [], []));
    const errors = rg.validate();
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/reads unregistered resource/);
  });

  it('detects unregistered resource in outputs', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['missing'], []));
    const errors = rg.validate();
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/writes unregistered resource/);
  });

  it('detects cycles', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', ['y'], ['x'], []));
    rg.addNode(makeNode('b', ['x'], ['y'], []));
    rg.registerResource(makeTexture('x'));
    rg.registerResource(makeTexture('y'));
    rg.addEdge('a', 'b', 'x');
    rg.addEdge('b', 'a', 'y');
    const errors = rg.validate();
    expect(errors.some((e) => e.match(/cycle/))).toBe(true);
  });

  it('detects write-write race (two writers, no dependency)', () => {
    const rg = new RenderGraph();
    // a 和 b 都写 r,但 a→b 无路径(无依赖)→ 冲突
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', [], ['r'], []));
    rg.registerResource(makeTexture('r'));
    const errors = rg.validate();
    expect(errors.some((e) => e.match(/race condition/))).toBe(true);
  });

  it('no race when two writers have a dependency path', () => {
    const rg = new RenderGraph();
    // a → c → b:a 和 b 都写 r,但 a→c→b 有路径,无冲突
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('c', ['r'], ['s'], []));
    rg.addNode(makeNode('b', ['s'], ['r'], []));
    rg.registerResource(makeTexture('r'));
    rg.registerResource(makeTexture('s'));
    rg.addEdge('a', 'c', 'r');
    rg.addEdge('c', 'b', 's');
    const errors = rg.validate();
    expect(errors.filter((e) => e.match(/race condition/)).length).toBe(0);
  });
});

// ── compile + getCompiledPasses ────────────────────────────────────

describe('RenderGraph compile', () => {
  it('compile produces CompiledPass list in topological order', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], ['s'], []));
    rg.addNode(makeNode('c', ['s'], [], []));
    rg.registerResource(makeTexture('r'));
    rg.registerResource(makeTexture('s'));
    rg.addEdge('a', 'b', 'r');
    rg.addEdge('b', 'c', 's');
    rg.compile();
    const passes = rg.getCompiledPasses();
    expect(passes.length).toBe(3);
    expect(passes[0].node.id).toBe('a');
    expect(passes[1].node.id).toBe('b');
    expect(passes[2].node.id).toBe('c');
  });

  it('compile marks creates for first writer of transient resource', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r', 'transient'));
    rg.addEdge('a', 'b', 'r');
    rg.compile();
    const passes = rg.getCompiledPasses();
    expect(passes[0].creates).toContain('r');
    expect(passes[1].creates).toEqual([]);
  });

  it('compile does not mark creates for persistent resource', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r', 'persistent'));
    rg.addEdge('a', 'b', 'r');
    rg.compile();
    const passes = rg.getCompiledPasses();
    expect(passes[0].creates).toEqual([]);
  });

  it('compile marks destroys for last reader of transient resource', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r', 'transient'));
    rg.addEdge('a', 'b', 'r');
    rg.compile();
    const passes = rg.getCompiledPasses();
    expect(passes[1].destroys).toContain('r');
    expect(passes[0].destroys).toEqual([]);
  });

  it('compile does not mark destroys for persistent resource', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r', 'persistent'));
    rg.addEdge('a', 'b', 'r');
    rg.compile();
    const passes = rg.getCompiledPasses();
    expect(passes[1].destroys).toEqual([]);
  });

  it('compile culls dead nodes from compiled passes', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('dead', [], ['x'], [])); // 写 x,无人读
    rg.addNode(makeNode('live', [], ['y'], []));
    rg.addNode(makeNode('out', ['y'], [], []));
    rg.registerResource(makeTexture('x'));
    rg.registerResource(makeTexture('y'));
    rg.addEdge('live', 'out', 'y');
    rg.compile();
    const passes = rg.getCompiledPasses();
    const ids = passes.map((p) => p.node.id);
    expect(ids).not.toContain('dead');
    expect(ids).toContain('live');
    expect(ids).toContain('out');
  });

  it('compile sets isCompiled=true', () => {
    const rg = new RenderGraph();
    expect(rg.isCompiled).toBe(false);
    rg.compile();
    expect(rg.isCompiled).toBe(true);
  });

  it('getResourceLifetimes is empty before compile, filled after', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.registerResource(makeTexture('r'));
    expect(rg.getResourceLifetimes().size).toBe(0);
    rg.compile();
    expect(rg.getResourceLifetimes().size).toBe(1);
    expect(rg.getResourceLifetimes().get('r')?.firstWritePass).toBe(0);
  });

  it('adding a node after compile invalidates compilation', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], [], []));
    rg.compile();
    expect(rg.isCompiled).toBe(true);
    rg.addNode(makeNode('b', [], [], []));
    expect(rg.isCompiled).toBe(false);
    expect(rg.getCompiledPasses().length).toBe(0);
  });

  it('compile throws on cycle', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', ['y'], ['x'], []));
    rg.addNode(makeNode('b', ['x'], ['y'], []));
    rg.registerResource(makeTexture('x'));
    rg.registerResource(makeTexture('y'));
    rg.addEdge('a', 'b', 'x');
    rg.addEdge('b', 'a', 'y');
    expect(() => rg.compile()).toThrow(/cycle/);
  });
});

// ── execute ────────────────────────────────────────────────────────

describe('RenderGraph execute', () => {
  it('executes nodes in compiled order', () => {
    const rg = new RenderGraph();
    const log: string[] = [];
    rg.addNode(makeNode('c', ['s'], [], log));
    rg.addNode(makeNode('a', [], ['r'], log));
    rg.addNode(makeNode('b', ['r'], ['s'], log));
    rg.registerResource(makeTexture('r'));
    rg.registerResource(makeTexture('s'));
    rg.addEdge('a', 'b', 'r');
    rg.addEdge('b', 'c', 's');
    rg.compile();
    rg.execute();
    // 顺序:a → b → c(拓扑序)
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('execute throws if not compiled', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], [], []));
    expect(() => rg.execute()).toThrow(/not compiled/);
  });

  it('execute uses default context (Map-based) when none provided', () => {
    const rg = new RenderGraph();
    rg.addNode({
      id: 'a', name: 'A', type: 'render',
      inputs: [], outputs: ['r'],
      execute: (ctx) => {
        ctx.createResource('r', 42);
      },
    });
    rg.registerResource(makeTexture('r'));
    rg.compile();
    const ctx = rg.execute();
    expect(ctx.getResource('r')).toBe(42);
  });

  it('execute propagates node exceptions', () => {
    const rg = new RenderGraph();
    rg.addNode({
      id: 'a', name: 'A', type: 'render',
      inputs: [], outputs: [],
      execute: () => { throw new Error('boom'); },
    });
    rg.compile();
    expect(() => rg.execute()).toThrow(/boom/);
  });

  it('execute updates passIndex on context', () => {
    const rg = new RenderGraph();
    const indices: number[] = [];
    rg.addNode({
      id: 'a', name: 'A', type: 'render', inputs: [], outputs: [],
      execute: (ctx) => { indices.push(ctx.passIndex); },
    });
    rg.addNode({
      id: 'b', name: 'B', type: 'render', inputs: [], outputs: [],
      execute: (ctx) => { indices.push(ctx.passIndex); },
    });
    rg.compile();
    rg.execute();
    expect(indices).toEqual([0, 1]);
  });

  it('execute with custom context uses it', () => {
    const rg = new RenderGraph();
    rg.addNode({
      id: 'a', name: 'A', type: 'render',
      inputs: [], outputs: ['r'],
      execute: (ctx) => { ctx.createResource('r', 'custom'); },
    });
    rg.registerResource(makeTexture('r'));
    rg.compile();
    const store = new Map<string, unknown>();
    const customCtx: RenderGraphContext = {
      resources: store,
      passIndex: 0,
      getResource: (n) => store.get(n),
      createResource: (n, v) => { store.set(n, v); },
      destroyResource: (n) => { store.delete(n); },
    };
    rg.execute(customCtx);
    expect(store.get('r')).toBe('custom');
  });
});

// ── clear / getStats ───────────────────────────────────────────────

describe('RenderGraph clear & stats', () => {
  it('clear empties everything', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.registerResource(makeTexture('r'));
    rg.compile();
    expect(rg.getNodes().length).toBe(1);
    rg.clear();
    expect(rg.getNodes().length).toBe(0);
    expect(rg.getResources().length).toBe(0);
    expect(rg.getEdges().length).toBe(0);
    expect(rg.getCompiledPasses().length).toBe(0);
    expect(rg.isCompiled).toBe(false);
  });

  it('getStats reports counts', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['t'], []));
    rg.addNode(makeNode('b', [], ['p'], []));
    rg.registerResource(makeTexture('t', 'transient'));
    rg.registerResource({ name: 'p', type: 'buffer', lifetime: 'persistent', refCount: 0 });
    rg.compile();
    const s = rg.getStats();
    expect(s.nodeCount).toBe(2);
    expect(s.resourceCount).toBe(2);
    expect(s.transientResourceCount).toBe(1);
    expect(s.persistentResourceCount).toBe(1);
    expect(s.isCompiled).toBe(true);
  });
});

// ── export / import ────────────────────────────────────────────────

describe('RenderGraph export & import', () => {
  it('exportGraph produces JSON-serializable structure', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    rg.compile();
    const data = rg.exportGraph();
    expect(data.nodes.length).toBe(2);
    expect(data.edges.length).toBe(1);
    expect(data.resources.length).toBe(1);
    expect(data.compiledPasses).toBeDefined();
    expect(data.compiledPasses!.length).toBe(2);
    // JSON 可序列化
    expect(() => JSON.stringify(data)).not.toThrow();
  });

  it('importGraph restores structure (without execute callbacks)', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    const exported = rg.exportGraph();

    const rg2 = new RenderGraph();
    rg2.importGraph(exported);
    expect(rg2.getNodes().length).toBe(2);
    expect(rg2.getEdges().length).toBe(1);
    expect(rg2.getResources().length).toBe(1);
    expect(rg2.getResource('r')?.type).toBe('texture');
    expect(rg2.isCompiled).toBe(false);
  });

  it('importGraph overwrites existing graph', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('old', [], [], []));
    const rg2 = new RenderGraph();
    rg2.addNode(makeNode('a', [], ['r'], []));
    rg2.registerResource(makeTexture('r'));
    rg.importGraph(rg2.exportGraph());
    expect(rg.getNode('old')).toBeUndefined();
    expect(rg.getNode('a')).toBeDefined();
  });

  it('imported graph can be re-compiled', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], ['r'], []));
    rg.addNode(makeNode('b', ['r'], [], []));
    rg.registerResource(makeTexture('r'));
    rg.addEdge('a', 'b', 'r');
    const exported = rg.exportGraph();

    const rg2 = new RenderGraph();
    rg2.importGraph(exported);
    rg2.compile();
    expect(rg2.isCompiled).toBe(true);
    expect(rg2.getCompiledPasses().length).toBe(2);
  });

  it('imported nodes have placeholder execute (warns, does not throw)', () => {
    const rg = new RenderGraph();
    rg.addNode(makeNode('a', [], [], []));
    const exported = rg.exportGraph();
    const rg2 = new RenderGraph();
    rg2.importGraph(exported);
    rg2.compile();
    expect(() => rg2.execute()).not.toThrow();
  });
});

// ── 综合场景 ────────────────────────────────────────────────────────

describe('RenderGraph integration scenario', () => {
  it('classic deferred pipeline: gbuffer → lighting → tone-map → present', () => {
    const rg = new RenderGraph();
    const log: string[] = [];
    rg.addNode(makeNode('gbuffer', [], ['color', 'depth'], log));
    rg.addNode(makeNode('lighting', ['color', 'depth'], ['hdr'], log));
    rg.addNode(makeNode('tonemap', ['hdr'], ['ldr'], log));
    rg.addNode(makeNode('present', ['ldr'], [], log));
    rg.registerResource(makeTexture('color'));
    rg.registerResource(makeTexture('depth'));
    rg.registerResource(makeTexture('hdr'));
    rg.registerResource(makeTexture('ldr'));
    rg.addEdge('gbuffer', 'lighting', 'color');
    rg.addEdge('gbuffer', 'lighting', 'depth');
    rg.addEdge('lighting', 'tonemap', 'hdr');
    rg.addEdge('tonemap', 'present', 'ldr');

    // 验证 + 编译 + 执行
    expect(rg.validate()).toEqual([]);
    rg.compile();
    const passes = rg.getCompiledPasses();
    expect(passes.length).toBe(4);
    expect(passes.map((p) => p.node.id)).toEqual([
      'gbuffer', 'lighting', 'tonemap', 'present',
    ]);

    rg.execute();
    expect(log).toEqual(['gbuffer', 'lighting', 'tonemap', 'present']);

    // gbuffer 创建 color + depth(均为 transient,首次写入)
    expect(passes[0].creates.sort()).toEqual(['color', 'depth']);
    // lighting 读取 color/depth,最后一次读取 → 销毁
    expect(passes[1].destroys.sort()).toEqual(['color', 'depth']);
    // lighting 创建 hdr
    expect(passes[1].creates).toEqual(['hdr']);
    // tonemap 销毁 hdr,创建 ldr
    expect(passes[2].creates).toEqual(['ldr']);
    expect(passes[2].destroys).toEqual(['hdr']);
    // present 销毁 ldr
    expect(passes[3].destroys).toEqual(['ldr']);
  });
});
