import { describe, it, expect, beforeEach } from 'vitest';
import {
  NodeRegistry,
  registerBuiltinNodes,
  defaultNodeRegistry,
  ScriptGraph,
  ScriptExecutor,
  type ScriptGraphNode,
} from './index';
import { EventBus } from '../Events/EventBus';

// ── helpers ────────────────────────────────────────────────────────

function makeNode(id: string, type: string, pinValues: Record<string, any> = {}): ScriptGraphNode {
  return { id, type, pinValues, position: { x: 0, y: 0 } };
}

function makeExecutor(printSink?: (m: string) => void, eventBus?: EventBus | null): ScriptExecutor {
  const exec = new ScriptExecutor(defaultNodeRegistry, eventBus ?? null);
  if (printSink) exec.printSink = printSink;
  return exec;
}

// ── NodeRegistry ───────────────────────────────────────────────────

describe('NodeRegistry', () => {
  it('registerBuiltinNodes populates start/print/branch/add/etc.', () => {
    const r = new NodeRegistry();
    registerBuiltinNodes(r);
    expect(r.get('start')).toBeDefined();
    expect(r.get('print')).toBeDefined();
    expect(r.get('branch')).toBeDefined();
    expect(r.get('add')).toBeDefined();
    expect(r.get('subtract')).toBeDefined();
    expect(r.get('multiply')).toBeDefined();
    expect(r.get('divide')).toBeDefined();
    expect(r.get('greater')).toBeDefined();
    expect(r.get('less')).toBeDefined();
    expect(r.get('equals')).toBeDefined();
    expect(r.get('and')).toBeDefined();
    expect(r.get('or')).toBeDefined();
    expect(r.get('not')).toBeDefined();
    expect(r.get('get_variable')).toBeDefined();
    expect(r.get('set_variable')).toBeDefined();
    expect(r.get('delay')).toBeDefined();
    expect(r.get('event_receive')).toBeDefined();
    expect(r.get('event_send')).toBeDefined();
    expect(r.get('add')?.pure).toBe(true);
    expect(r.get('print')?.pure).toBeUndefined();
  });

  it('get returns descriptor, list returns array, clear empties', () => {
    const r = new NodeRegistry();
    expect(r.list()).toHaveLength(0);
    registerBuiltinNodes(r);
    expect(r.list().length).toBeGreaterThan(0);
    expect(r.get('nonexistent')).toBeUndefined();
    r.clear();
    expect(r.list()).toHaveLength(0);
    expect(r.get('start')).toBeUndefined();
  });

  it('defaultNodeRegistry has builtins registered', () => {
    expect(defaultNodeRegistry.get('start')).toBeDefined();
  });
});

// ── ScriptGraph ────────────────────────────────────────────────────

describe('ScriptGraph', () => {
  let g: ScriptGraph;
  beforeEach(() => {
    g = new ScriptGraph('test');
    g.addNode(makeNode('a', 'start'));
    g.addNode(makeNode('b', 'print'));
    g.addEdge({ fromNode: 'a', fromPin: 'out', toNode: 'b', toPin: 'in' });
  });

  it('addNode / removeNode (removeNode also removes connected edges)', () => {
    expect(g.nodes.size).toBe(2);
    expect(g.edges).toHaveLength(1);
    expect(g.removeNode('b')).toBe(true);
    expect(g.nodes.has('b')).toBe(false);
    expect(g.edges).toHaveLength(0);
    expect(g.removeNode('missing')).toBe(false);
  });

  it('addEdge / removeEdge', () => {
    expect(g.edges).toHaveLength(1);
    expect(g.removeEdge('a', 'out', 'b', 'in')).toBe(true);
    expect(g.edges).toHaveLength(0);
    expect(g.removeEdge('a', 'out', 'b', 'in')).toBe(false);
  });

  it('setVariable / getVariable', () => {
    g.setVariable('x', 42);
    expect(g.getVariable('x')).toBe(42);
    expect(g.getVariable('missing')).toBeUndefined();
  });

  it('findEntryNodes returns start + event_receive nodes', () => {
    g.addNode(makeNode('er', 'event_receive', { name: 'go' }));
    g.addNode(makeNode('p', 'print'));
    const entries = g.findEntryNodes();
    expect(entries.map(n => n.id).sort()).toEqual(['a', 'er']);
  });

  it('getOutputEdges / getInputEdge', () => {
    expect(g.getOutputEdges('a', 'out')).toHaveLength(1);
    expect(g.getOutputEdges('a', 'missing')).toHaveLength(0);
    expect(g.getInputEdge('b', 'in')).not.toBeNull();
    expect(g.getInputEdge('b', 'in')?.fromNode).toBe('a');
    expect(g.getInputEdge('a', 'out')).toBeNull();
  });

  it('toJSON / fromJSON round-trip preserves nodes/edges/variables', () => {
    g.setVariable('hp', 100);
    const json = g.toJSON();
    const g2 = ScriptGraph.fromJSON(json, 'roundtrip');
    expect(g2.name).toBe('roundtrip');
    expect(g2.nodes.size).toBe(2);
    expect(g2.nodes.get('a')?.type).toBe('start');
    expect(g2.nodes.get('b')?.type).toBe('print');
    expect(g2.edges).toHaveLength(1);
    expect(g2.edges[0]).toEqual({ fromNode: 'a', fromPin: 'out', toNode: 'b', toPin: 'in' });
    expect(g2.getVariable('hp')).toBe(100);
    // round-trip independence (mutating clone shouldn't affect original)
    g2.nodes.get('a')!.pinValues.foo = 'bar';
    expect(g.nodes.get('a')!.pinValues.foo).toBeUndefined();
  });
});

// ── ScriptExecutor ─────────────────────────────────────────────────

describe('ScriptExecutor', () => {
  it("start('test') executes from start node → print node: print sink called", () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('test');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('p', 'print', { msg: 'hello' }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'p', toPin: 'in' });
    exec.load(g);
    exec.start('test');
    expect(printed).toEqual(['hello']);
  });

  it('branch with cond=true follows true edge', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('b');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('br', 'branch', { cond: true }));
    g.addNode(makeNode('pt', 'print', { msg: 'true' }));
    g.addNode(makeNode('pf', 'print', { msg: 'false' }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'br', toPin: 'in' });
    g.addEdge({ fromNode: 'br', fromPin: 'true', toNode: 'pt', toPin: 'in' });
    g.addEdge({ fromNode: 'br', fromPin: 'false', toNode: 'pf', toPin: 'in' });
    exec.load(g);
    exec.start('b');
    expect(printed).toEqual(['true']);
  });

  it('branch with cond=false follows false edge', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('b');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('br', 'branch', { cond: false }));
    g.addNode(makeNode('pt', 'print', { msg: 'true' }));
    g.addNode(makeNode('pf', 'print', { msg: 'false' }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'br', toPin: 'in' });
    g.addEdge({ fromNode: 'br', fromPin: 'true', toNode: 'pt', toPin: 'in' });
    g.addEdge({ fromNode: 'br', fromPin: 'false', toNode: 'pf', toPin: 'in' });
    exec.load(g);
    exec.start('b');
    expect(printed).toEqual(['false']);
  });

  it('add node: resolveInput evaluates 2+3=5', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('add');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('p', 'print', {}));
    g.addNode(makeNode('add', 'add', { a: 2, b: 3 }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'p', toPin: 'in' });
    g.addEdge({ fromNode: 'add', fromPin: 'r', toNode: 'p', toPin: 'msg' });
    exec.load(g);
    exec.start('add');
    expect(printed).toEqual(['5']);
  });

  it('multiply: 4*5=20', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('mul');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('p', 'print', {}));
    g.addNode(makeNode('mul', 'multiply', { a: 4, b: 5 }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'p', toPin: 'in' });
    g.addEdge({ fromNode: 'mul', fromPin: 'r', toNode: 'p', toPin: 'msg' });
    exec.load(g);
    exec.start('mul');
    expect(printed).toEqual(['20']);
  });

  it('greater: 5>3=true', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('gt');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('p', 'print', {}));
    g.addNode(makeNode('gt', 'greater', { a: 5, b: 3 }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'p', toPin: 'in' });
    g.addEdge({ fromNode: 'gt', fromPin: 'r', toNode: 'p', toPin: 'msg' });
    exec.load(g);
    exec.start('gt');
    expect(printed).toEqual(['true']);
  });

  it('and / or / not logic', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('logic');
    g.addNode(makeNode('s', 'start'));
    // and(true,false)=false, or(true,false)=true, not(true)=false
    g.addNode(makeNode('pa', 'print', {}));
    g.addNode(makeNode('po', 'print', {}));
    g.addNode(makeNode('pn', 'print', {}));
    g.addNode(makeNode('and', 'and', { a: true, b: false }));
    g.addNode(makeNode('or', 'or', { a: true, b: false }));
    g.addNode(makeNode('not', 'not', { a: true }));
    // chain: s -> pa -> po -> pn (exec order)
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'pa', toPin: 'in' });
    g.addEdge({ fromNode: 'pa', fromPin: 'out', toNode: 'po', toPin: 'in' });
    g.addEdge({ fromNode: 'po', fromPin: 'out', toNode: 'pn', toPin: 'in' });
    // data edges
    g.addEdge({ fromNode: 'and', fromPin: 'r', toNode: 'pa', toPin: 'msg' });
    g.addEdge({ fromNode: 'or', fromPin: 'r', toNode: 'po', toPin: 'msg' });
    g.addEdge({ fromNode: 'not', fromPin: 'r', toNode: 'pn', toPin: 'msg' });
    exec.load(g);
    exec.start('logic');
    expect(printed).toEqual(['false', 'true', 'false']);
  });

  it('get_variable / set_variable round-trip', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('var');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('sv', 'set_variable', { name: 'hp', v: 99 }));
    g.addNode(makeNode('gv', 'get_variable', { name: 'hp' }));
    g.addNode(makeNode('p', 'print', {}));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'sv', toPin: 'in' });
    g.addEdge({ fromNode: 'sv', fromPin: 'out', toNode: 'p', toPin: 'in' });
    g.addEdge({ fromNode: 'gv', fromPin: 'v', toNode: 'p', toPin: 'msg' });
    exec.load(g);
    exec.start('var');
    expect(g.getVariable('hp')).toBe(99);
    expect(printed).toEqual(['99']);
  });

  it('event_send emits on EventBus', () => {
    const eb = new EventBus();
    let received: any = null;
    eb.on('test_event', (payload: any) => { received = payload; });
    const exec = makeExecutor(undefined, eb);
    const g = new ScriptGraph('es');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('e', 'event_send', { name: 'test_event', payload: 42 }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'e', toPin: 'in' });
    exec.load(g);
    exec.start('es');
    expect(received).toBe(42);
  });

  it('event_receive triggered by triggerEvent', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('er');
    g.addNode(makeNode('er', 'event_receive', { name: 'go' }));
    g.addNode(makeNode('p', 'print', { msg: 'hello' }));
    g.addEdge({ fromNode: 'er', fromPin: 'out', toNode: 'p', toPin: 'in' });
    exec.load(g);
    exec.triggerEvent('go');
    expect(printed).toEqual(['hello']);
  });

  it('delay node: tick advances, resumes after delay', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('delay');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('d', 'delay', { d: 0.5 }));
    g.addNode(makeNode('p', 'print', { msg: 'done' }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'd', toPin: 'in' });
    g.addEdge({ fromNode: 'd', fromPin: 'out', toNode: 'p', toPin: 'in' });
    exec.load(g);
    exec.start('delay');
    // print has NOT run yet (delay pending)
    expect(printed).toEqual([]);
    exec.tick(0.3); // not enough
    expect(printed).toEqual([]);
    exec.tick(0.3); // total 0.6 >= 0.5 → resume
    expect(printed).toEqual(['done']);
  });

  it('maxNodesPerTick infinite loop protection', () => {
    const exec = makeExecutor();
    const g = new ScriptGraph('cycle');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('a', 'set_variable', { name: 'x', v: 0 }));
    // self-loop on set_variable's 'out' → 'in'
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'a', toPin: 'in' });
    g.addEdge({ fromNode: 'a', fromPin: 'out', toNode: 'a', toPin: 'in' });
    exec.maxNodesPerTick = 10;
    exec.load(g);
    // Should terminate, not hang.
    expect(() => exec.start('cycle')).not.toThrow();
  });

  it('pure node evaluation: add followed by multiply (chained data flow)', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('chain');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('p', 'print', {}));
    g.addNode(makeNode('add', 'add', { a: 2, b: 3 }));       // 5
    g.addNode(makeNode('mul', 'multiply', { b: 4 }));        // 5 * 4 = 20
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'p', toPin: 'in' });
    g.addEdge({ fromNode: 'mul', fromPin: 'r', toNode: 'p', toPin: 'msg' });
    g.addEdge({ fromNode: 'add', fromPin: 'r', toNode: 'mul', toPin: 'a' });
    exec.load(g);
    exec.start('chain');
    expect(printed).toEqual(['20']);
  });

  // ── Integration scenario ────────────────────────────────────────

  it('integration: start → set_variable(x,5) → branch(x>3) → print big/small', () => {
    const printed: string[] = [];
    const exec = makeExecutor((m) => printed.push(m));
    const g = new ScriptGraph('int');
    g.addNode(makeNode('s', 'start'));
    g.addNode(makeNode('sv', 'set_variable', { name: 'x', v: 5 }));
    g.addNode(makeNode('gv', 'get_variable', { name: 'x' }));
    g.addNode(makeNode('gt', 'greater', { b: 3 }));
    g.addNode(makeNode('br', 'branch', { cond: false }));
    g.addNode(makeNode('pb', 'print', { msg: 'big' }));
    g.addNode(makeNode('ps', 'print', { msg: 'small' }));
    g.addEdge({ fromNode: 's', fromPin: 'out', toNode: 'sv', toPin: 'in' });
    g.addEdge({ fromNode: 'sv', fromPin: 'out', toNode: 'br', toPin: 'in' });
    g.addEdge({ fromNode: 'gv', fromPin: 'v', toNode: 'gt', toPin: 'a' });
    g.addEdge({ fromNode: 'gt', fromPin: 'r', toNode: 'br', toPin: 'cond' });
    g.addEdge({ fromNode: 'br', fromPin: 'true', toNode: 'pb', toPin: 'in' });
    g.addEdge({ fromNode: 'br', fromPin: 'false', toNode: 'ps', toPin: 'in' });
    exec.load(g);

    exec.start('int');
    expect(printed).toContain('big');
    expect(printed).not.toContain('small');

    // Change variable to 2 → prints "small"
    g.nodes.get('sv')!.pinValues.v = 2;
    printed.length = 0;
    exec.start('int');
    expect(printed).toContain('small');
    expect(printed).not.toContain('big');
  });

  it('start on missing graph does not throw', () => {
    const exec = makeExecutor();
    expect(() => exec.start('nope')).not.toThrow();
  });

  it('unload removes graph from active set', () => {
    const exec = makeExecutor();
    const g = new ScriptGraph('u');
    g.addNode(makeNode('er', 'event_receive', { name: 'e' }));
    g.addNode(makeNode('p', 'print', { msg: 'x' }));
    g.addEdge({ fromNode: 'er', fromPin: 'out', toNode: 'p', toPin: 'in' });
    exec.load(g);
    exec.unload('u');
    const printed: string[] = [];
    exec.printSink = (m) => printed.push(m);
    exec.triggerEvent('e');
    expect(printed).toEqual([]);
  });
});
