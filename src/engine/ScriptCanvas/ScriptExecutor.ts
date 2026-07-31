// ScriptExecutor — executes a ScriptGraph.
//
// 执行模型 (参考 o3de ScriptCanvas ExecutionContext):
//   - start(name) 从 'start' 节点沿 exec 边逐节点执行。
//   - triggerEvent(name, payload) 找到匹配的 'event_receive' 节点并执行。
//   - exec 流: executeFromNode 遍历 exec 边链 (out/true/false),直到无下一节点或触及上限。
//   - 数据流: resolveInput 解析输入 pin 值 (有入边则递归求 evaluateOutput,否则用 pinValues)。
//   - 纯节点 (math/get_variable) 不参与 exec 流,仅被 resolveInput 懒求值。
//   - delay 节点暂停 exec 链,推入 pendingDelays;tick(dt) 推进时间,到点后从 'out' 恢复执行。
//   - maxNodesPerTick 防止无限循环 (环路保护)。
//
// 与 Scripting/CoroutineSystem 的关系:
//   - CoroutineSystem 是代码驱动的协作式协程;本类是数据驱动的节点图执行器。
//   - delay 节点的帧调度语义与 CoroutineSystem 的 yield 等价。

import { ScriptGraph, ScriptGraphNode } from './ScriptGraph';
import { NodeRegistry, defaultNodeRegistry, registerBuiltinNodes } from './ScriptNode';
import { EventBus } from '../Events/EventBus';
import { createLogger } from '@/lib/logger';

const log = createLogger('ScriptExecutor');

export interface ScriptExecutionContext {
  /** The graph being executed (for variable access). */
  graph: ScriptGraph;
  /** Node registry (descriptor lookup). */
  registry: NodeRegistry;
  /** Event bus (for event_send/event_receive nodes). */
  eventBus?: EventBus;
  /** External action handlers (e.g. set_entity_position). */
  actionHandlers: Map<string, (args: Record<string, any>) => any>;
  /** Print sink (for print nodes). */
  print: (msg: string) => void;
  /** Pending delays (frame-scheduled). */
  pendingDelays: Array<{ node: ScriptGraphNode; resumeAt: number }>;
  /** Current time in seconds. */
  time: number;
  /** Max nodes executed per tick (infinite loop protection). */
  maxNodesPerTick: number;
}

interface PendingDelay {
  graph: ScriptGraph;
  node: ScriptGraphNode;
  resumeAt: number;
  payload?: any;
}

export class ScriptExecutor {
  private graphs = new Map<string, ScriptGraph>();
  private activeGraphs: ScriptGraph[] = [];
  private registry: NodeRegistry;
  private eventBus: EventBus | null;
  /** Pending delays across all active graphs (persists across ticks). */
  private pendingDelays: PendingDelay[] = [];
  /** Current simulation time in seconds (advanced by tick). */
  private currentTime: number = 0;
  /** Max nodes executed per exec chain (infinite loop protection). */
  maxNodesPerTick: number = 1000;
  /** Print sink — overridable for tests/custom routing. */
  printSink: (msg: string) => void = (m) => log.info(`[script] ${m}`);

  constructor(registry: NodeRegistry = defaultNodeRegistry, eventBus: EventBus | null = null) {
    this.registry = registry;
    this.eventBus = eventBus;
    // Ensure built-in nodes are registered
    if (registry.get('start') === undefined) registerBuiltinNodes(registry);
  }

  /** Load a graph for execution. */
  load(graph: ScriptGraph): void {
    this.graphs.set(graph.name, graph);
    if (!this.activeGraphs.includes(graph)) this.activeGraphs.push(graph);
  }

  unload(name: string): void {
    this.graphs.delete(name);
    this.activeGraphs = this.activeGraphs.filter(g => g.name !== name);
  }

  /** Trigger an event — finds all event_receive nodes with matching name and executes them. */
  triggerEvent(eventName: string, payload?: any): void {
    for (const g of this.activeGraphs) {
      for (const node of g.nodes.values()) {
        if (node.type === 'event_receive' && node.pinValues.name === eventName) {
          this.executeFromNode(g, node, payload);
        }
      }
    }
  }

  /** Start a graph (execute from 'start' nodes). */
  start(name: string): void {
    const g = this.graphs.get(name);
    if (!g) { log.warn(`Graph not found: ${name}`); return; }
    for (const entry of g.findEntryNodes()) {
      if (entry.type === 'start') this.executeFromNode(g, entry);
    }
  }

  /** Execute from a specific node, following exec edges. */
  private executeFromNode(graph: ScriptGraph, node: ScriptGraphNode, payload?: any): void {
    const ctx: ScriptExecutionContext = {
      graph,
      registry: this.registry,
      eventBus: this.eventBus ?? undefined,
      actionHandlers: new Map(),
      print: (m) => this.printSink(m),
      pendingDelays: [],
      time: this.currentTime,
      maxNodesPerTick: this.maxNodesPerTick,
    };
    let current: ScriptGraphNode | null = node;
    let count = 0;
    while (current && count < ctx.maxNodesPerTick) {
      const next = this.executeNode(graph, current, ctx, payload);
      current = next;
      count++;
    }
    if (count >= ctx.maxNodesPerTick) {
      log.warn(`Script hit maxNodesPerTick=${ctx.maxNodesPerTick} (possible infinite loop)`);
    }
    // Promote pending delays to the executor so tick() can resume them.
    for (const d of ctx.pendingDelays) {
      this.pendingDelays.push({ graph, node: d.node, resumeAt: d.resumeAt, payload });
    }
  }

  /** Execute a single node. Returns the next exec node to run (or null). */
  private executeNode(
    graph: ScriptGraph,
    node: ScriptGraphNode,
    ctx: ScriptExecutionContext,
    payload?: any,
  ): ScriptGraphNode | null {
    switch (node.type) {
      case 'start':
      case 'event_receive': {
        void payload;
        return this.followExec(graph, node, 'out');
      }
      case 'print': {
        const msg = this.resolveInput(graph, node, 'msg', ctx);
        ctx.print(String(msg ?? ''));
        return this.followExec(graph, node, 'out');
      }
      case 'branch': {
        const cond = this.resolveInput(graph, node, 'cond', ctx);
        return this.followExec(graph, node, cond ? 'true' : 'false');
      }
      case 'set_variable': {
        const name = this.resolveInput(graph, node, 'name', ctx);
        const val = this.resolveInput(graph, node, 'v', ctx);
        graph.setVariable(String(name), val);
        return this.followExec(graph, node, 'out');
      }
      case 'delay': {
        const d = Number(this.resolveInput(graph, node, 'd', ctx));
        ctx.pendingDelays.push({ node, resumeAt: ctx.time + (Number.isFinite(d) ? d : 0) });
        return null; // exec resumes later via tick()
      }
      case 'event_send': {
        const name = this.resolveInput(graph, node, 'name', ctx);
        let p = this.resolveInput(graph, node, 'payload', ctx);
        if (p === null && payload !== undefined) p = payload;
        if (ctx.eventBus) ctx.eventBus.emit(String(name), p);
        return this.followExec(graph, node, 'out');
      }
      default: {
        // Pure nodes have no exec flow — skip (they are evaluated via resolveInput).
        const desc = ctx.registry.get(node.type);
        if (desc?.pure) return null;
        // Custom action handler (e.g. set_entity_position).
        const handler = ctx.actionHandlers.get(node.type);
        if (handler) {
          const args: Record<string, any> = {};
          if (desc) for (const pin of desc.inputs) args[pin.name] = this.resolveInput(graph, node, pin.id, ctx);
          handler(args);
        }
        return this.followExec(graph, node, 'out');
      }
    }
  }

  /** Follow an exec output pin to the next node (first outgoing edge). */
  private followExec(graph: ScriptGraph, node: ScriptGraphNode, pinId: string): ScriptGraphNode | null {
    const edges = graph.getOutputEdges(node.id, pinId);
    if (edges.length === 0) return null;
    return graph.nodes.get(edges[0].toNode) ?? null;
  }

  /** Resolve an input pin's value: if edge exists, evaluate source; else use default. */
  private resolveInput(
    graph: ScriptGraph,
    node: ScriptGraphNode,
    pinId: string,
    ctx: ScriptExecutionContext,
  ): any {
    const edge = graph.getInputEdge(node.id, pinId);
    if (edge) {
      const sourceNode = graph.nodes.get(edge.fromNode);
      if (sourceNode) return this.evaluateOutput(graph, sourceNode, edge.fromPin, ctx);
    }
    return node.pinValues[pinId] ?? null;
  }

  /** Evaluate a pure node's output pin (for data flow). */
  private evaluateOutput(
    graph: ScriptGraph,
    node: ScriptGraphNode,
    _pinId: string,
    ctx: ScriptExecutionContext,
  ): any {
    switch (node.type) {
      case 'add':
        return Number(this.resolveInput(graph, node, 'a', ctx)) + Number(this.resolveInput(graph, node, 'b', ctx));
      case 'subtract':
        return Number(this.resolveInput(graph, node, 'a', ctx)) - Number(this.resolveInput(graph, node, 'b', ctx));
      case 'multiply':
        return Number(this.resolveInput(graph, node, 'a', ctx)) * Number(this.resolveInput(graph, node, 'b', ctx));
      case 'divide': {
        const b = Number(this.resolveInput(graph, node, 'b', ctx));
        if (b === 0) return 0;
        return Number(this.resolveInput(graph, node, 'a', ctx)) / b;
      }
      case 'greater':
        return Number(this.resolveInput(graph, node, 'a', ctx)) > Number(this.resolveInput(graph, node, 'b', ctx));
      case 'less':
        return Number(this.resolveInput(graph, node, 'a', ctx)) < Number(this.resolveInput(graph, node, 'b', ctx));
      case 'equals':
        return this.resolveInput(graph, node, 'a', ctx) === this.resolveInput(graph, node, 'b', ctx);
      case 'and':
        return !!this.resolveInput(graph, node, 'a', ctx) && !!this.resolveInput(graph, node, 'b', ctx);
      case 'or':
        return !!this.resolveInput(graph, node, 'a', ctx) || !!this.resolveInput(graph, node, 'b', ctx);
      case 'not':
        return !this.resolveInput(graph, node, 'a', ctx);
      case 'get_variable':
        return graph.getVariable(String(this.resolveInput(graph, node, 'name', ctx)));
      default:
        return null;
    }
  }

  /** Tick pending delays. Call once per frame with dt (seconds). */
  tick(dt: number): void {
    this.currentTime += dt;
    if (this.pendingDelays.length === 0) return;
    const ready: PendingDelay[] = [];
    const remaining: PendingDelay[] = [];
    for (const d of this.pendingDelays) {
      if (d.resumeAt <= this.currentTime) ready.push(d);
      else remaining.push(d);
    }
    this.pendingDelays = remaining;
    for (const d of ready) {
      const edges = d.graph.getOutputEdges(d.node.id, 'out');
      if (edges.length > 0) {
        const next = d.graph.nodes.get(edges[0].toNode);
        if (next) this.executeFromNode(d.graph, next, d.payload);
      }
    }
  }
}
