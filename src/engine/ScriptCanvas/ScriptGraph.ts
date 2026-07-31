// ScriptGraph — the graph (collection of nodes + connections).
//
// 节点图数据模型:节点 (ScriptGraphNode) + 边 (ScriptGraphEdge) + 变量。
//   - 节点 pinValues 存输入 pin 的默认值 (无入边时使用)。
//   - 边连接输出 pin → 输入 pin;exec 边驱动执行流,数据边驱动数据流。
//   - toJSON/fromJSON 往返序列化,可持久化进 .vreen 或经 Blockly 导出。

import type { ScriptNodeDescriptor } from './ScriptNode';

export interface ScriptGraphEdge {
  fromNode: string;  // node id
  fromPin: string;   // output pin id
  toNode: string;    // node id
  toPin: string;     // input pin id
}

export interface ScriptGraphNode {
  id: string;
  type: string;
  /** Input pin values (for pins with no incoming edge, use default). */
  pinValues: Record<string, any>;
  position: { x: number; y: number }; // for editor serialization
}

export interface ScriptGraphJSON {
  nodes: ScriptGraphNode[];
  edges: ScriptGraphEdge[];
  variables: Array<{ name: string; value: any }>;
}

export class ScriptGraph {
  nodes = new Map<string, ScriptGraphNode>();
  edges: ScriptGraphEdge[] = [];
  variables = new Map<string, any>();
  /** Optional name for the graph (e.g. "PlayerController"). */
  name: string = '';

  constructor(name: string = '') { this.name = name; }

  addNode(node: ScriptGraphNode): this { this.nodes.set(node.id, node); return this; }

  /** Remove a node + all edges referencing it. Returns true if the node existed. */
  removeNode(id: string): boolean {
    if (!this.nodes.delete(id)) return false;
    this.edges = this.edges.filter(e => e.fromNode !== id && e.toNode !== id);
    return true;
  }

  addEdge(edge: ScriptGraphEdge): this { this.edges.push(edge); return this; }

  /** Remove an edge by its endpoints. Returns true if an edge was removed. */
  removeEdge(fromNode: string, fromPin: string, toNode: string, toPin: string): boolean {
    const before = this.edges.length;
    this.edges = this.edges.filter(
      e => !(e.fromNode === fromNode && e.fromPin === fromPin && e.toNode === toNode && e.toPin === toPin),
    );
    return this.edges.length < before;
  }

  /** Set a graph variable. */
  setVariable(name: string, value: any): void { this.variables.set(name, value); }
  getVariable(name: string): any { return this.variables.get(name); }

  /** Find the entry node (type 'start' or 'event_receive'). */
  findEntryNodes(): ScriptGraphNode[] {
    return Array.from(this.nodes.values()).filter(n => n.type === 'start' || n.type === 'event_receive');
  }

  /** Get the output edges from a node's pin. */
  getOutputEdges(nodeId: string, pinId: string): ScriptGraphEdge[] {
    return this.edges.filter(e => e.fromNode === nodeId && e.fromPin === pinId);
  }

  /** Get the input edge to a node's pin (or null — input pins have at most one incoming edge). */
  getInputEdge(nodeId: string, pinId: string): ScriptGraphEdge | null {
    return this.edges.find(e => e.toNode === nodeId && e.toPin === pinId) ?? null;
  }

  toJSON(): ScriptGraphJSON {
    return {
      nodes: Array.from(this.nodes.values()).map(n => ({
        id: n.id,
        type: n.type,
        pinValues: { ...n.pinValues },
        position: { ...n.position },
      })),
      edges: this.edges.map(e => ({ ...e })),
      variables: Array.from(this.variables.entries()).map(([name, value]) => ({ name, value })),
    };
  }

  static fromJSON(json: ScriptGraphJSON, name?: string): ScriptGraph {
    const g = new ScriptGraph(name ?? '');
    for (const n of json.nodes) {
      g.addNode({
        id: n.id,
        type: n.type,
        pinValues: { ...n.pinValues },
        position: { ...n.position },
      });
    }
    for (const e of json.edges) {
      g.addEdge({ ...e });
    }
    for (const v of json.variables) {
      g.variables.set(v.name, v.value);
    }
    return g;
  }
}

// Re-export descriptor type for convenience (avoids circular import — type-only).
export type { ScriptNodeDescriptor };
