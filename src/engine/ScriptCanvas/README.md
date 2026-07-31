# ScriptCanvas Module

> Path: `src/engine/ScriptCanvas/`
>
> The visual-scripting runtime of the `@vreen/engine` kernel. Provides a
> JSON-serializable node-graph data model (`ScriptGraph`), a registry of node
> descriptors (`NodeRegistry`) pre-populated with 18 built-in node types, and a
> frame-scheduled executor (`ScriptExecutor`) that drives exec-flow edges,
> lazy-evaluates pure data-flow nodes, suspends on `delay` nodes, and dispatches
> `event_receive` / `event_send` through an `EventBus`. Complements the Blockly
> editor in `lib/vreenBlockly.ts` (UI) and the ECS `VisualScriptComponent`
> (persistence).

---

## Overview

```
ScriptNodeDescriptor ──registered into──→ NodeRegistry
       │  (type, category, inputs, outputs, pure)        │
       ▼                                                 │ defaultNodeRegistry
ScriptPin { id, name, type, defaultValue, connection }   │ (singleton, builtins auto-registered)
                                                         ▼
ScriptGraph ──holds──→ ScriptGraphNode[] ──typed by──→ ScriptNodeDescriptor
   │  nodes: Map<id, { id, type, pinValues, position }>
   │  edges: ScriptGraphEdge[] { fromNode, fromPin, toNode, toPin }
   │  variables: Map<name, any>
   │  toJSON / fromJSON ↔ .vreen persistence
   ▼
ScriptExecutor ──binds to──→ NodeRegistry + EventBus
   │  load(graph) → activeGraphs[]
   │  start(name) → executeFromNode('start') → exec-edge chain
   │  triggerEvent(name, payload) → 'event_receive' nodes
   │  resolveInput → evaluateOutput (lazy, pure nodes)
   │  delay node → pendingDelays[] → tick(dt) resumes
   ▼
ScriptExecutionContext (per-exec transient state: print sink, actionHandlers, time, pendingDelays)
```

Two complementary execution flows:

- **Exec flow** — `start` / `event_receive` / `branch` / `print` / `set_variable`
  / `delay` / `event_send` nodes participate in the imperative chain. The
  executor follows the first outgoing exec edge from each node's `out` / `true`
  / `false` pin until the chain ends or `maxNodesPerTick` is hit.
- **Data flow** — pure nodes (`add` / `subtract` / `multiply` / `divide` /
  `greater` / `less` / `equals` / `and` / `or` / `not` / `get_variable`) are
  never executed directly; they are evaluated lazily by `resolveInput` when an
  exec-flow node reads the input pin they feed.

---

## Core Classes

### ScriptNode (`ScriptNode.ts`)

Type definitions for pins, node descriptors, and the registry.

| Export | Role |
|--------|------|
| `ScriptValueType` | Pin value type union: `'number'` \| `'boolean'` \| `'string'` \| `'vector3'` \| `'entity'` \| `'any'`. |
| `ScriptValue` | Runtime value union: `number` \| `boolean` \| `string` \| `Vector3` \| `null`. |
| `ScriptPin` | Single pin: `id`, `name`, `type`, optional `defaultValue`, optional `connection` (`'nodeId.pinName'`). |
| `ScriptNodeDescriptor` | Node type definition: `type`, `category`, `inputs`, `outputs`, optional `pure` flag (pure nodes are lazily evaluated, never executed). |
| `NodeRegistry` | `Map<type, ScriptNodeDescriptor>` with `register` / `get` / `list` / `clear`. |
| `defaultNodeRegistry` | Process-level singleton `NodeRegistry` instance. |
| `registerBuiltinNodes(registry?)` | Registers all 18 built-in node descriptors into the registry (defaults to `defaultNodeRegistry`). Called automatically at module load. |

```ts
export interface ScriptPin {
  id: string;
  name: string;
  type: ScriptValueType;
  defaultValue?: ScriptValue;
  connection?: string;
}

export interface ScriptNodeDescriptor {
  type: string;
  category: 'flow' | 'math' | 'action' | 'event' | 'variable';
  inputs: ScriptPin[];
  outputs: ScriptPin[];
  pure?: boolean;
}
```

### Built-in Node Catalog (18 types)

| `type` | Category | `pure` | Inputs | Outputs | Behaviour |
|--------|----------|--------|--------|---------|-----------|
| `start` | `flow` | — | — | `out:exec` | Entry node; `ScriptExecutor.start(graphName)` follows `out`. |
| `print` | `action` | — | `in:exec`, `msg:string` | — | Calls `ctx.print(String(msg))`. |
| `branch` | `flow` | — | `in:exec`, `cond:boolean` | `true:exec`, `false:exec` | Follows `true` or `false` exec edge based on `cond`. |
| `delay` | `flow` | — | `in:exec`, `d:number` (seconds) | `out:exec` | Suspends the exec chain; `tick(dt)` resumes from `out` once `d` seconds elapse. |
| `event_receive` | `event` | — | `name:string` | `out:exec` | Entry node triggered by `ScriptExecutor.triggerEvent(name, payload)`. |
| `event_send` | `event` | — | `in:exec`, `name:string`, `payload:any` | `out:exec` | Emits `(name, payload)` on the bound `EventBus`; payload falls back to inbound event payload. |
| `add` | `math` | yes | `a:number`, `b:number` | `r:number` | `a + b`. |
| `subtract` | `math` | yes | `a:number`, `b:number` | `r:number` | `a - b`. |
| `multiply` | `math` | yes | `a:number`, `b:number` | `r:number` | `a * b`. |
| `divide` | `math` | yes | `a:number`, `b:number` (default 1) | `r:number` | `a / b`; returns `0` when `b === 0` (no throw). |
| `greater` | `math` | yes | `a:number`, `b:number` | `r:boolean` | `a > b`. |
| `less` | `math` | yes | `a:number`, `b:number` | `r:boolean` | `a < b`. |
| `equals` | `math` | yes | `a:any`, `b:any` | `r:boolean` | Strict equality `a === b`. |
| `and` | `math` | yes | `a:boolean`, `b:boolean` | `r:boolean` | Logical AND. |
| `or` | `math` | yes | `a:boolean`, `b:boolean` | `r:boolean` | Logical OR. |
| `not` | `math` | yes | `a:boolean` | `r:boolean` | Logical NOT. |
| `get_variable` | `variable` | yes | `name:string` | `v:any` | Reads `graph.getVariable(name)`. |
| `set_variable` | `variable` | — | `in:exec`, `name:string`, `v:any` | `out:exec` | Writes `graph.setVariable(name, v)` then continues exec flow. |

### ScriptGraph (`ScriptGraph.ts`)

The graph container — nodes, edges, variables, and JSON round-trip.

| Export | Role |
|--------|------|
| `ScriptGraphEdge` | Directed edge: `fromNode` / `fromPin` (output) → `toNode` / `toPin` (input). |
| `ScriptGraphNode` | Node instance: `id`, `type`, `pinValues` (input defaults), `position` (editor coords). |
| `ScriptGraphJSON` | Serializable shape: `{ nodes, edges, variables }`. |
| `ScriptGraph` | Class — owns `nodes: Map`, `edges: array`, `variables: Map`, optional `name`. |

```ts
export class ScriptGraph {
  nodes: Map<string, ScriptGraphNode>;
  edges: ScriptGraphEdge[];
  variables: Map<string, any>;
  name: string;

  addNode(node: ScriptGraphNode): this;
  removeNode(id: string): boolean;            // also drops edges referencing the node
  addEdge(edge: ScriptGraphEdge): this;
  removeEdge(fromNode, fromPin, toNode, toPin): boolean;
  setVariable(name: string, value: any): void;
  getVariable(name: string): any;
  findEntryNodes(): ScriptGraphNode[];        // 'start' or 'event_receive'
  getOutputEdges(nodeId, pinId): ScriptGraphEdge[];
  getInputEdge(nodeId, pinId): ScriptGraphEdge | null;  // at most one incoming edge per pin
  toJSON(): ScriptGraphJSON;
  static fromJSON(json: ScriptGraphJSON, name?: string): ScriptGraph;
}
```

### ScriptExecutor (`ScriptExecutor.ts`)

The runtime engine. Owns loaded graphs, pending delays, current time, and
the print sink. Built-in node behaviour is hard-coded in `executeNode` (exec
flow) and `evaluateOutput` (data flow); custom action nodes can be wired via
`ScriptExecutionContext.actionHandlers`.

| Export | Role |
|--------|------|
| `ScriptExecutionContext` | Per-exec transient state: `graph`, `registry`, `eventBus?`, `actionHandlers`, `print` sink, `pendingDelays`, `time`, `maxNodesPerTick`. |
| `ScriptExecutor` | Class — loads graphs, starts them, triggers events, ticks delays. |

```ts
export class ScriptExecutor {
  maxNodesPerTick: number;            // default 1000 — infinite-loop guard
  printSink: (msg: string) => void;   // default logs via createLogger('ScriptExecutor')

  constructor(registry: NodeRegistry = defaultNodeRegistry, eventBus?: EventBus | null);

  load(graph: ScriptGraph): void;
  unload(name: string): void;
  start(name: string): void;                       // executes 'start' entry nodes
  triggerEvent(eventName: string, payload?: any): void;  // executes matching 'event_receive' nodes
  tick(dt: number): void;                          // advances time, resumes due 'delay' nodes
}
```

`tick(dt)` advances `currentTime` by `dt` seconds and resumes any `delay`
whose `resumeAt <= currentTime`, re-entering `executeFromNode` from the
delayed node's `out` exec edge. The payload carried into the original
suspend is forwarded to the resumed chain.

---

## Usage Example

Build a graph in code that prints a computed value and reacts to an event:

```ts
import {
  ScriptGraph, ScriptExecutor, defaultNodeRegistry,
} from '@vreen/engine/scriptcanvas';
import { EventBus } from '@vreen/engine/events';

// 1. Build the graph in code.
const graph = new ScriptGraph('DemoGraph');

// Start node → branch on (health > 0) → print result.
graph.addNode({ id: 'start',    type: 'start',        pinValues: {}, position: { x: 0, y: 0 } });
graph.addNode({ id: 'hp',       type: 'get_variable', pinValues: { name: 'health' }, position: { x: 0, y: 80 } });
graph.addNode({ id: 'zero',     type: 'get_variable', pinValues: { name: 'zero'   }, position: { x: 0, y: 140 } });
graph.addNode({ id: 'gt',       type: 'greater',      pinValues: {},                position: { x: 120, y: 80 } });
graph.addNode({ id: 'branch',   type: 'branch',       pinValues: {},                position: { x: 240, y: 0 } });
graph.addNode({ id: 'aliveMsg', type: 'print',        pinValues: { msg: 'alive' },  position: { x: 380, y: -40 } });
graph.addNode({ id: 'deadMsg',  type: 'print',        pinValues: { msg: 'dead' },   position: { x: 380, y: 40 } });

// Data edges: hp → gt.a, zero → gt.b
graph.addEdge({ fromNode: 'hp',   fromPin: 'v', toNode: 'gt', toPin: 'a' });
graph.addEdge({ fromNode: 'zero', fromPin: 'v', toNode: 'gt', toPin: 'b' });
// Data edge: gt.r → branch.cond
graph.addEdge({ fromNode: 'gt', fromPin: 'r', toNode: 'branch', toPin: 'cond' });
// Exec edges
graph.addEdge({ fromNode: 'start',  fromPin: 'out',   toNode: 'branch',    toPin: 'in' });
graph.addEdge({ fromNode: 'branch', fromPin: 'true',  toNode: 'aliveMsg',  toPin: 'in' });
graph.addEdge({ fromNode: 'branch', fromPin: 'false', toNode: 'deadMsg',   toPin: 'in' });

// Variables
graph.setVariable('health', 12);
graph.setVariable('zero', 0);

// 2. Execute.
const bus = new EventBus();
const executor = new ScriptExecutor(defaultNodeRegistry, bus);
const printed: string[] = [];
executor.printSink = (m) => printed.push(m);
executor.load(graph);
executor.start('DemoGraph');           // prints "alive"

// 3. Trigger an event node (separate sub-graph).
graph.addNode({ id: 'recv',  type: 'event_receive', pinValues: { name: 'OnHit' }, position: { x: 0, y: 200 } });
graph.addNode({ id: 'send',  type: 'event_send',    pinValues: { name: 'OnHit', payload: null }, position: { x: 0, y: 280 } });
graph.addEdge({ fromNode: 'recv', fromPin: 'out', toNode: 'send', toPin: 'in' });
executor.triggerEvent('OnHit', { dmg: 5 });   // emits OnHit on the EventBus

// 4. Delay node + tick.
graph.addNode({ id: 'delay',  type: 'delay', pinValues: { d: 0.5 }, position: { x: 0, y: 360 } });
graph.addNode({ id: 'late',   type: 'print', pinValues: { msg: 'late' }, position: { x: 120, y: 360 } });
graph.addEdge({ fromNode: 'delay', fromPin: 'out', toNode: 'late', toPin: 'in' });
executor.triggerEvent('OnHit');              // assumes an exec chain reaches `delay`
executor.tick(0.6);                          // resumes `delay` → prints "late"
```

Round-trip a graph through JSON:

```ts
const json = graph.toJSON();
const restored = ScriptGraph.fromJSON(json, 'DemoGraph');
```

---

## Invariants

- **Single incoming edge per input pin.** `getInputEdge` returns the first
  match; connecting two outputs to the same input is undefined.
- **Pure nodes are never exec-flow entry points.** A `pure` descriptor with
  no exec input pin is skipped by `executeNode`'s default branch; it is
  reached only through `resolveInput` → `evaluateOutput`.
- **`maxNodesPerTick` guards cycles.** An exec chain that loops back on
  itself without hitting a `delay` is broken at `maxNodesPerTick` (default
  `1000`) and a warning is logged.
- **`delay` is the only suspend point.** Other nodes complete synchronously
  within a single `executeFromNode` call; only `delay` pushes onto
  `pendingDelays` and yields `null` as the next node.
- **`defaultNodeRegistry` is process-singleton and pre-populated.** Importing
  `ScriptNode.ts` runs `registerBuiltinNodes(defaultNodeRegistry)` once; the
  executor re-registers defensively if `'start'` is missing.
- **`divide` by zero returns `0`.** No exception is thrown; callers needing
  strict error handling must check the divisor upstream.
- **`event_send` payload fallback.** If the `payload` input resolves to
  `null`, the executor substitutes the inbound event payload (so event
  nodes can forward what they received).
- **`triggerEvent` iterates all active graphs.** Every loaded graph with a
  matching `event_receive` node fires — there is no per-graph event scoping.
- **`tick(dt)` is frame-driven.** Callers must invoke it once per frame;
  `currentTime` is the executor's only clock and is the basis for `delay`
  resume scheduling.

---

## Design Notes

**Why a separate module from `Scripting/VisualScriptComponent`?** The ECS
`VisualScriptComponent` stores nodes as `pin.connectedTo` arrays inside a
component and is persisted into `.vreen`; it is a *data storage* shape tied
to entity lifecycle. `ScriptCanvas` is a standalone, graph-centric runtime
with explicit `ScriptGraphEdge` edges, frame-scheduled delays, and event
dispatch — suited to scenario scripts, level logic, and UI-driven authoring
via Blockly. Both can coexist; the editor can export a `ScriptGraphJSON`
that feeds either consumer.

**Why hard-coded node behaviour?** Built-in nodes (`add`, `branch`,
`event_send`, …) are implemented as a `switch` in `executeNode` /
`evaluateOutput` rather than via a plugin interface. This keeps the hot path
inlinable and avoids per-node virtual dispatch for the 18 types that ship
with the engine. Custom action nodes are still supported through
`ScriptExecutionContext.actionHandlers`, keyed on `node.type`.

**Why lazy evaluation for pure nodes?** Pure math nodes (`add`, `greater`,
`not`, …) have no side effects and may feed multiple consumers or none at
all. Evaluating them on demand from `resolveInput` — instead of eagerly on
exec-flow visit — avoids wasted work and naturally supports data-flow
fan-out without a separate scheduling pass.

**`delay` semantics vs `Scripting/CoroutineSystem`.** `CoroutineSystem` is
a code-driven cooperative coroutine runner (`yield`-based). The `delay`
node is the data-driven equivalent: it suspends the exec chain and is
resumed by `tick(dt)`, mirroring a coroutine `yield` that waits for a
timer.

---

## References

- o3de ScriptCanvas Gem — `Gems/ScriptCanvas` (reference architecture).
- `lib/vreenBlockly.ts` — Blockly visual editor that authors
  `ScriptGraphJSON` for this runtime.
- `Scripting/VisualScriptComponent` — ECS-persisted visual script component
  (complementary storage shape).
- `Events/EventBus` — event bus used by `event_send` / `event_receive`.
- `ScriptCanvas.test.ts` — round-trip and execution tests.
