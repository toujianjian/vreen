import { describe, it, expect, beforeEach } from 'vitest';
import {
  VisualScriptComponent,
  type ScriptNode,
  type ScriptPin,
} from './ScriptComponent';

/** 构造 exec pin (输入或输出)。 */
function execPin(name: string = 'exec'): ScriptPin {
  return { name, type: 'exec', value: null, connectedTo: [] };
}

/** 构造数据 pin。 */
function dataPin(name: string, type: string = 'any', value: any = null): ScriptPin {
  return { name, type, value, connectedTo: [] };
}

/** 构造 event 节点 (单 exec 输出)。 */
function eventNode(id: string, eventName: string): ScriptNode {
  return { id, type: 'event', name: eventName, inputs: [], outputs: [execPin()] };
}

/** 构造 function 节点 (exec in/out + 数据输入)。 */
function functionNode(
  id: string,
  fnName: string,
  dataInputs: Array<{ name: string; type: string; value: any }> = [],
): ScriptNode {
  return {
    id,
    type: 'function',
    name: fnName,
    inputs: [execPin(), ...dataInputs.map((d) => dataPin(d.name, d.type, d.value))],
    outputs: [execPin(), dataPin('result', 'any')],
  };
}

describe('VisualScriptComponent', () => {
  let c: VisualScriptComponent;
  beforeEach(() => {
    c = new VisualScriptComponent();
  });

  describe('addNode / removeNode / getNodes', () => {
    it('adds a node and exposes it via getNodes', () => {
      const n = eventNode('e1', 'start');
      c.addNode(n);
      expect(c.getNodes()).toHaveLength(1);
      expect(c.getNodes()[0]).toBe(n);
    });

    it('addNode with duplicate id overwrites existing', () => {
      c.addNode(eventNode('e1', 'start'));
      const replacement = eventNode('e1', 'update');
      c.addNode(replacement);
      expect(c.getNodes()).toHaveLength(1);
      expect(c.getNodes()[0].name).toBe('update');
    });

    it('event node auto-registers in eventHandlers', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(eventNode('e2', 'start'));
      c.addNode(eventNode('e3', 'update'));
      expect(c.eventHandlers.get('start')).toEqual(['e1', 'e2']);
      expect(c.eventHandlers.get('update')).toEqual(['e3']);
    });

    it('removeNode returns false for unknown id', () => {
      expect(c.removeNode('nope')).toBe(false);
    });

    it('removeNode removes the node from the graph', () => {
      c.addNode(eventNode('e1', 'start'));
      expect(c.removeNode('e1')).toBe(true);
      expect(c.getNodes()).toHaveLength(0);
    });

    it('removeNode cleans up eventHandlers (removes id, deletes empty key)', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(eventNode('e2', 'start'));
      c.removeNode('e1');
      expect(c.eventHandlers.get('start')).toEqual(['e2']);
      c.removeNode('e2');
      expect(c.eventHandlers.has('start')).toBe(false);
    });

    it('removeNode cleans up connections referencing it', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      c.connect('e1', 'exec', 'f1', 'exec');
      c.removeNode('f1');
      // e1's output pin should no longer reference f1
      const e1 = c.getNodes()[0];
      expect(e1.outputs[0].connectedTo).toHaveLength(0);
    });
  });

  describe('connect / disconnect / getConnections', () => {
    it('connect links an output pin to an input pin', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      expect(c.connect('e1', 'exec', 'f1', 'exec')).toBe(true);
      const conns = c.getConnections();
      expect(conns).toEqual([{ from: 'e1', fromPin: 'exec', to: 'f1', toPin: 'exec' }]);
    });

    it('connect returns false for unknown node', () => {
      c.addNode(eventNode('e1', 'start'));
      expect(c.connect('e1', 'exec', 'ghost', 'exec')).toBe(false);
      expect(c.connect('ghost', 'exec', 'e1', 'exec')).toBe(false);
    });

    it('connect returns false for unknown pin', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      expect(c.connect('e1', 'nope', 'f1', 'exec')).toBe(false);
      expect(c.connect('e1', 'exec', 'f1', 'nope')).toBe(false);
    });

    it('connect is idempotent (does not duplicate connection)', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      c.connect('e1', 'exec', 'f1', 'exec');
      c.connect('e1', 'exec', 'f1', 'exec');
      expect(c.getConnections()).toHaveLength(1);
    });

    it('disconnect removes a specific connection', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      c.connect('e1', 'exec', 'f1', 'exec');
      expect(c.disconnect('e1', 'exec', 'f1', 'exec')).toBe(true);
      expect(c.getConnections()).toHaveLength(0);
    });

    it('disconnect returns false when no matching connection exists', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      expect(c.disconnect('e1', 'exec', 'f1', 'exec')).toBe(false);
    });
  });

  describe('variables', () => {
    it('setVariable / getVariable round-trip', () => {
      c.setVariable('health', 100);
      expect(c.getVariable('health')).toBe(100);
    });

    it('getVariable returns undefined for unknown name', () => {
      expect(c.getVariable('nope')).toBeUndefined();
    });

    it('setVariable overwrites existing value', () => {
      c.setVariable('x', 1);
      c.setVariable('x', 2);
      expect(c.getVariable('x')).toBe(2);
    });
  });

  describe('functions', () => {
    it('registerFunction + callFunction', () => {
      c.registerFunction('add', (a: number, b: number) => a + b);
      expect(c.callFunction('add', [2, 3])).toBe(5);
    });

    it('callFunction returns undefined for unregistered name', () => {
      expect(c.callFunction('nope')).toBeUndefined();
    });

    it('callFunction defaults to no args', () => {
      c.registerFunction('zero', () => 42);
      expect(c.callFunction('zero')).toBe(42);
    });
  });

  describe('start / stop / update / isRunning', () => {
    it('start sets isRunning and fires "start" event', () => {
      let fired = 0;
      c.addNode(eventNode('e1', 'start'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => (fired++) },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.start();
      expect(c.isRunning).toBe(true);
      expect(fired).toBe(1);
    });

    it('start is idempotent (does not re-fire if already running)', () => {
      let fired = 0;
      c.addNode(eventNode('e1', 'start'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => (fired++) },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.start();
      c.start();
      expect(fired).toBe(1);
    });

    it('stop fires "stop" event then sets isRunning=false', () => {
      let fired = 0;
      c.addNode(eventNode('e1', 'stop'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => (fired++) },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.isRunning = true;
      c.stop();
      expect(c.isRunning).toBe(false);
      expect(fired).toBe(1);
    });

    it('stop is no-op when not running', () => {
      let fired = 0;
      c.addNode(eventNode('e1', 'stop'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => (fired++) },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.stop();
      expect(fired).toBe(0);
    });

    it('update does nothing when not running', () => {
      let fired = 0;
      c.addNode(eventNode('e1', 'update'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => (fired++) },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.update(0.016);
      expect(fired).toBe(0);
    });

    it('update fires both "update" and "tick" events when running', () => {
      const fired: string[] = [];
      c.addNode(eventNode('e1', 'update'));
      c.addNode(eventNode('e2', 'tick'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'log',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: (_comp: VisualScriptComponent, args: any[]) => fired.push(`update:${args[0]}`) },
      });
      c.addNode({
        id: 'a2',
        type: 'action',
        name: 'log',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: (_comp: VisualScriptComponent, args: any[]) => fired.push(`tick:${args[0]}`) },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.connect('e2', 'exec', 'a2', 'exec');
      c.isRunning = true;
      c.update(0.016);
      expect(fired).toEqual(['update:0.016', 'tick:0.016']);
    });
  });

  describe('handleEvent — exec chain execution', () => {
    it('executes a chain of action nodes via exec pins', () => {
      const order: string[] = [];
      c.addNode(eventNode('e1', 'go'));
      const mk = (id: string) =>
        ({
          id,
          type: 'action',
          name: id,
          inputs: [execPin()],
          outputs: [execPin()],
          data: { handler: () => order.push(id) },
        } as ScriptNode);
      c.addNode(mk('a1'));
      c.addNode(mk('a2'));
      c.addNode(mk('a3'));
      c.connect('e1', 'exec', 'a1', 'exec');
      c.connect('a1', 'exec', 'a2', 'exec');
      c.connect('a2', 'exec', 'a3', 'exec');
      c.handleEvent('go');
      expect(order).toEqual(['a1', 'a2', 'a3']);
    });

    it('handleEvent with unknown name is a no-op', () => {
      let fired = 0;
      c.addNode(eventNode('e1', 'go'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => (fired++) },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.handleEvent('unknown');
      expect(fired).toBe(0);
    });

    it('function node calls a registered function and writes result to output pin', () => {
      c.registerFunction('add', (a: number, b: number) => a + b);
      c.addNode(eventNode('e1', 'go'));
      c.addNode(functionNode('f1', 'add', [
        { name: 'a', type: 'number', value: 2 },
        { name: 'b', type: 'number', value: 3 },
      ]));
      c.connect('e1', 'exec', 'f1', 'exec');
      c.handleEvent('go');
      const f1 = c.getNodes().find((n) => n.id === 'f1')!;
      const resultPin = f1.outputs.find((p) => p.name === 'result');
      expect(resultPin?.value).toBe(5);
    });

    it('function node reads input pin values from connected output pins', () => {
      c.registerFunction('add', (a: number, b: number) => a + b);
      c.registerFunction('mul', (a: number, b: number) => a * b);
      // event → fn1 (compute 2+3=5) → fn2 (mul 5 * 4 = 20)
      c.addNode(eventNode('e1', 'go'));
      c.addNode(functionNode('f1', 'add', [
        { name: 'a', type: 'number', value: 2 },
        { name: 'b', type: 'number', value: 3 },
      ]));
      c.addNode(functionNode('f2', 'mul', [
        { name: 'a', type: 'number', value: 0 },
        { name: 'b', type: 'number', value: 4 },
      ]));
      c.connect('e1', 'exec', 'f1', 'exec');
      c.connect('f1', 'exec', 'f2', 'exec');
      // data flow: f1.result → f2.a
      c.connect('f1', 'result', 'f2', 'a');
      c.handleEvent('go');
      const f2 = c.getNodes().find((n) => n.id === 'f2')!;
      const resultPin = f2.outputs.find((p) => p.name === 'result');
      expect(resultPin?.value).toBe(20);
    });

    it('variable get node writes value to output pin', () => {
      c.setVariable('hp', 100);
      c.addNode(eventNode('e1', 'go'));
      c.addNode({
        id: 'v1',
        type: 'variable',
        name: 'hp',
        inputs: [],
        outputs: [dataPin('value', 'any')],
        data: { mode: 'get' },
      });
      c.connect('e1', 'exec', 'v1', 'exec'); // exec may be absent; chain still walks via exec output
      // Since variable get node has no exec output, chain stops. Just call _executeNode via event chain.
      // To verify, manually trigger by calling handleEvent — but exec routing needs an exec out.
      // Instead, verify by checking the output value after a function node reads it.
      c.addNode(functionNode('f1', 'echo', [{ name: 'v', type: 'any', value: null }]));
      c.connect('v1', 'value', 'f1', 'v');
      c.registerFunction('echo', (v: any) => v);
      // Re-wire: event → variable(get) has no exec out; use function node as exec chain root via direct exec
      // For a clean test: put variable node BEFORE function in exec chain by adding exec pins.
      c.removeNode('v1');
      c.addNode({
        id: 'v1',
        type: 'variable',
        name: 'hp',
        inputs: [execPin()],
        outputs: [execPin(), dataPin('value', 'any')],
        data: { mode: 'get' },
      });
      c.connect('e1', 'exec', 'v1', 'exec');
      c.connect('v1', 'exec', 'f1', 'exec');
      c.connect('v1', 'value', 'f1', 'v');
      c.handleEvent('go');
      const f1 = c.getNodes().find((n) => n.id === 'f1')!;
      expect(f1.outputs.find((p) => p.name === 'result')?.value).toBe(100);
    });

    it('variable set node writes value to variables map', () => {
      c.addNode(eventNode('e1', 'go'));
      c.addNode({
        id: 'v1',
        type: 'variable',
        name: 'score',
        inputs: [execPin(), dataPin('value', 'any')],
        outputs: [execPin()],
        data: { mode: 'set' },
      });
      c.connect('e1', 'exec', 'v1', 'exec');
      // Set value pin via static value
      const v1 = c.getNodes().find((n) => n.id === 'v1')!;
      v1.inputs.find((p) => p.name === 'value')!.value = 42;
      c.handleEvent('go');
      expect(c.getVariable('score')).toBe(42);
    });

    it('condition node routes exec to "true" branch when value is truthy', () => {
      const order: string[] = [];
      c.addNode(eventNode('e1', 'go'));
      c.addNode({
        id: 'cond',
        type: 'condition',
        name: 'check',
        inputs: [execPin(), dataPin('value', 'any')],
        outputs: [
          { name: 'true', type: 'exec', value: null, connectedTo: [] },
          { name: 'false', type: 'exec', value: null, connectedTo: [] },
        ],
      });
      c.addNode({
        id: 'yes',
        type: 'action',
        name: 'yes',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => order.push('yes') },
      });
      c.addNode({
        id: 'no',
        type: 'action',
        name: 'no',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => order.push('no') },
      });
      c.connect('e1', 'exec', 'cond', 'exec');
      c.connect('cond', 'true', 'yes', 'exec');
      c.connect('cond', 'false', 'no', 'exec');
      // Set truthy value
      c.getNodes().find((n) => n.id === 'cond')!.inputs.find((p) => p.name === 'value')!.value = 1;
      c.handleEvent('go');
      expect(order).toEqual(['yes']);
    });

    it('condition node routes exec to "false" branch when value is falsy', () => {
      const order: string[] = [];
      c.addNode(eventNode('e1', 'go'));
      c.addNode({
        id: 'cond',
        type: 'condition',
        name: 'check',
        inputs: [execPin(), dataPin('value', 'any')],
        outputs: [
          { name: 'true', type: 'exec', value: null, connectedTo: [] },
          { name: 'false', type: 'exec', value: null, connectedTo: [] },
        ],
      });
      c.addNode({
        id: 'yes',
        type: 'action',
        name: 'yes',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => order.push('yes') },
      });
      c.addNode({
        id: 'no',
        type: 'action',
        name: 'no',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => order.push('no') },
      });
      c.connect('e1', 'exec', 'cond', 'exec');
      c.connect('cond', 'true', 'yes', 'exec');
      c.connect('cond', 'false', 'no', 'exec');
      c.getNodes().find((n) => n.id === 'cond')!.inputs.find((p) => p.name === 'value')!.value = 0;
      c.handleEvent('go');
      expect(order).toEqual(['no']);
    });

    it('cycle guard prevents infinite loop', () => {
      let count = 0;
      c.addNode(eventNode('e1', 'go'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'a1',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => { count++; } },
      });
      // a1 → a1 (self loop)
      c.connect('e1', 'exec', 'a1', 'exec');
      c.connect('a1', 'exec', 'a1', 'exec');
      c.handleEvent('go');
      // Should execute a1 exactly once then break on cycle detection.
      expect(count).toBe(1);
    });
  });

  describe('exportGraph / importGraph', () => {
    it('exportGraph returns a serializable snapshot', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      c.connect('e1', 'exec', 'f1', 'exec');
      c.setVariable('hp', 50);
      const graph = c.exportGraph();
      expect(graph.nodes).toHaveLength(2);
      expect(graph.variables).toEqual([['hp', 50]]);
      // eventHandlers should be exported
      expect(graph.eventHandlers).toEqual([['start', ['e1']]]);
      // connection preserved
      const e1 = graph.nodes.find((n) => n.id === 'e1')!;
      expect(e1.outputs[0].connectedTo).toEqual([{ nodeId: 'f1', pinName: 'exec' }]);
    });

    it('exportGraph deep-copies pin connectedTo (mutating snapshot does not affect graph)', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      c.connect('e1', 'exec', 'f1', 'exec');
      const graph = c.exportGraph();
      const e1 = graph.nodes.find((n) => n.id === 'e1')!;
      e1.outputs[0].connectedTo.length = 0;
      e1.outputs[0].connectedTo.push({ nodeId: 'fake', pinName: 'x' });
      // Original graph untouched
      const origE1 = c.getNodes().find((n) => n.id === 'e1')!;
      expect(origE1.outputs[0].connectedTo).toEqual([{ nodeId: 'f1', pinName: 'exec' }]);
    });

    it('importGraph replaces the current graph', () => {
      c.addNode(eventNode('old', 'start'));
      c.setVariable('old', 1);
      c.importGraph({
        nodes: [eventNode('new', 'update')],
        variables: [['fresh', 2]],
        eventHandlers: [['update', ['new']]],
      });
      expect(c.getNodes().map((n) => n.id)).toEqual(['new']);
      expect(c.getVariable('fresh')).toBe(2);
      expect(c.getVariable('old')).toBeUndefined();
      expect(c.eventHandlers.get('update')).toEqual(['new']);
    });

    it('export → import round-trip preserves graph structure', () => {
      c.addNode(eventNode('e1', 'start'));
      c.addNode(functionNode('f1', 'log'));
      c.connect('e1', 'exec', 'f1', 'exec');
      c.setVariable('hp', 99);
      const snapshot = c.exportGraph();

      const c2 = new VisualScriptComponent();
      c2.importGraph(snapshot);
      expect(c2.getNodes().map((n) => n.id).sort()).toEqual(['e1', 'f1']);
      expect(c2.getVariable('hp')).toBe(99);
      expect(c2.getConnections()).toEqual([{ from: 'e1', fromPin: 'exec', to: 'f1', toPin: 'exec' }]);
    });

    it('importGraph handles empty/missing fields gracefully', () => {
      c.importGraph({ nodes: [], variables: [], eventHandlers: [] });
      expect(c.getNodes()).toHaveLength(0);
      // @ts-expect-error — testing robustness against malformed input
      c.importGraph({}); // missing fields → defaults to empty
      expect(c.getNodes()).toHaveLength(0);
    });
  });

  describe('eventHandlers map integrity', () => {
    it('multiple events with same name all fire', () => {
      let count = 0;
      c.addNode(eventNode('e1', 'ping'));
      c.addNode(eventNode('e2', 'ping'));
      c.addNode({
        id: 'a1',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => count++ },
      });
      c.addNode({
        id: 'a2',
        type: 'action',
        name: 'inc',
        inputs: [execPin()],
        outputs: [execPin()],
        data: { handler: () => count++ },
      });
      c.connect('e1', 'exec', 'a1', 'exec');
      c.connect('e2', 'exec', 'a2', 'exec');
      c.handleEvent('ping');
      expect(count).toBe(2);
    });
  });
});
