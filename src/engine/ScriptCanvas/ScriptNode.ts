// ScriptNode — node base + types for the Script Canvas runtime.
//
// 设计参考: o3de Gems/ScriptCanvas — 节点图驱动的可视化脚本数据模型。
//   - ScriptNodeDescriptor 描述节点类型 (输入/输出 pin 布局、类别、是否纯函数)。
//   - NodeRegistry 是类型注册表 (type → descriptor),registerBuiltinNodes 注册内置节点。
//   - 与 lib/vreenBlockly.ts (Blockly UI 编辑器) 互补:ScriptCanvas 提供 JSON 可序列化的
//     节点图,由 ScriptExecutor 在引擎运行时执行;Blockly 负责可视化编辑。
//
// 与 Scripting/VisualScriptComponent 的关系:
//   - VisualScriptComponent 是 ECS 组件 (event/action/condition/variable/function 节点,
//     持久化进 .vreen),连接模型为 pin.connectedTo 数组。
//   - 本模块是独立执行引擎 (start/print/branch/math/event 节点,边为 ScriptGraphEdge),
//     面向运行时执行而非 ECS 组件存储。两者形态不同,互补使用。

import { Vector3 } from '../Math/Vector3';

export type ScriptValueType = 'number' | 'boolean' | 'string' | 'vector3' | 'entity' | 'any';
export type ScriptValue = number | boolean | string | Vector3 | number | null;

export interface ScriptPin {
  id: string;
  name: string;
  type: ScriptValueType;
  /** Current value (for input pins with default). */
  defaultValue?: ScriptValue;
  /** Connected pin id (for input pins) or null. */
  connection?: string; // pin id "nodeId.pinName"
}

export interface ScriptNodeDescriptor {
  type: string;          // 'start' | 'print' | 'branch' | 'add' | 'set_position' | etc.
  category: string;      // 'flow' | 'math' | 'action' | 'event' | 'variable'
  inputs: ScriptPin[];
  outputs: ScriptPin[];
  /** Pure nodes (no side effects) can be evaluated lazily. */
  pure?: boolean;
}

/** Registry of node descriptors (what nodes exist + their pin layout). */
export class NodeRegistry {
  private descriptors = new Map<string, ScriptNodeDescriptor>();
  register(desc: ScriptNodeDescriptor): void { this.descriptors.set(desc.type, desc); }
  get(type: string): ScriptNodeDescriptor | undefined { return this.descriptors.get(type); }
  list(): ScriptNodeDescriptor[] { return Array.from(this.descriptors.values()); }
  clear(): void { this.descriptors.clear(); }
}

export const defaultNodeRegistry = new NodeRegistry();

/** Register built-in node types. */
export function registerBuiltinNodes(registry: NodeRegistry = defaultNodeRegistry): void {
  registry.register({ type: 'start', category: 'flow', inputs: [], outputs: [{ id: 'out', name: 'exec', type: 'any' }] });
  registry.register({ type: 'print', category: 'action', inputs: [{ id: 'in', name: 'exec', type: 'any' }, { id: 'msg', name: 'message', type: 'string', defaultValue: '' }], outputs: [] });
  registry.register({ type: 'branch', category: 'flow', inputs: [{ id: 'in', name: 'exec', type: 'any' }, { id: 'cond', name: 'condition', type: 'boolean', defaultValue: false }], outputs: [{ id: 'true', name: 'true', type: 'any' }, { id: 'false', name: 'false', type: 'any' }] });
  registry.register({ type: 'add', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'number', defaultValue: 0 }, { id: 'b', name: 'b', type: 'number', defaultValue: 0 }], outputs: [{ id: 'r', name: 'result', type: 'number' }] });
  registry.register({ type: 'subtract', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'number', defaultValue: 0 }, { id: 'b', name: 'b', type: 'number', defaultValue: 0 }], outputs: [{ id: 'r', name: 'result', type: 'number' }] });
  registry.register({ type: 'multiply', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'number', defaultValue: 0 }, { id: 'b', name: 'b', type: 'number', defaultValue: 0 }], outputs: [{ id: 'r', name: 'result', type: 'number' }] });
  registry.register({ type: 'divide', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'number', defaultValue: 0 }, { id: 'b', name: 'b', type: 'number', defaultValue: 1 }], outputs: [{ id: 'r', name: 'result', type: 'number' }] });
  registry.register({ type: 'greater', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'number', defaultValue: 0 }, { id: 'b', name: 'b', type: 'number', defaultValue: 0 }], outputs: [{ id: 'r', name: 'result', type: 'boolean' }] });
  registry.register({ type: 'less', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'number', defaultValue: 0 }, { id: 'b', name: 'b', type: 'number', defaultValue: 0 }], outputs: [{ id: 'r', name: 'result', type: 'boolean' }] });
  registry.register({ type: 'equals', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'any', defaultValue: 0 }, { id: 'b', name: 'b', type: 'any', defaultValue: 0 }], outputs: [{ id: 'r', name: 'result', type: 'boolean' }] });
  registry.register({ type: 'and', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'boolean', defaultValue: false }, { id: 'b', name: 'b', type: 'boolean', defaultValue: false }], outputs: [{ id: 'r', name: 'result', type: 'boolean' }] });
  registry.register({ type: 'or', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'boolean', defaultValue: false }, { id: 'b', name: 'b', type: 'boolean', defaultValue: false }], outputs: [{ id: 'r', name: 'result', type: 'boolean' }] });
  registry.register({ type: 'not', category: 'math', pure: true, inputs: [{ id: 'a', name: 'a', type: 'boolean', defaultValue: false }], outputs: [{ id: 'r', name: 'result', type: 'boolean' }] });
  registry.register({ type: 'get_variable', category: 'variable', pure: true, inputs: [{ id: 'name', name: 'name', type: 'string', defaultValue: '' }], outputs: [{ id: 'v', name: 'value', type: 'any' }] });
  registry.register({ type: 'set_variable', category: 'variable', inputs: [{ id: 'in', name: 'exec', type: 'any' }, { id: 'name', name: 'name', type: 'string', defaultValue: '' }, { id: 'v', name: 'value', type: 'any', defaultValue: null }], outputs: [{ id: 'out', name: 'exec', type: 'any' }] });
  registry.register({ type: 'delay', category: 'flow', inputs: [{ id: 'in', name: 'exec', type: 'any' }, { id: 'd', name: 'seconds', type: 'number', defaultValue: 1 }], outputs: [{ id: 'out', name: 'exec', type: 'any' }] });
  registry.register({ type: 'event_receive', category: 'event', inputs: [{ id: 'name', name: 'event', type: 'string', defaultValue: '' }], outputs: [{ id: 'out', name: 'exec', type: 'any' }] });
  registry.register({ type: 'event_send', category: 'event', inputs: [{ id: 'in', name: 'exec', type: 'any' }, { id: 'name', name: 'event', type: 'string', defaultValue: '' }, { id: 'payload', name: 'payload', type: 'any', defaultValue: null }], outputs: [{ id: 'out', name: 'exec', type: 'any' }] });
}

// 确保进程级单例默认注册表预装内置节点。
registerBuiltinNodes(defaultNodeRegistry);
