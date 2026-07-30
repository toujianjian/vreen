// ScriptComponent — ECS 脚本组件。
//
// 设计原则（贴近 Unity MonoBehaviour 风格，但用 ECS 数据/行为分离）：
//   - ScriptComponent 是 ECS 组件（POJO + 脚本实例引用），由 ScriptSystem 驱动。
//   - ScriptInstance 是用户实现的接口（可选生命周期回调），不是基类 ——
//     避免强制继承，方便用对象字面量定义。
//   - 脚本通过 ScriptContext 拿到 world + 自身 entityId，不持有反向引用。
//
// 生命周期（由 ScriptSystem 调用，按顺序）：
//   1. onStart(ctx)     —— 首次 update 前，仅调用一次。
//   2. onUpdate(ctx, dt) —— 每帧（enabled = true 时）。
//   3. onCollision(ctx, info) / onTrigger(ctx, info) —— 由物理系统或
//      ScriptSystem.dispatchCollision / dispatchTrigger 触发。
//   4. onDestroy(ctx)   —— 组件被移除或实体销毁时调用一次。
//
// 不变量：
//   - script 实例本身不存业务状态到 ECS 序列化层（ScriptComponent 是非 POJO，
//     不进 .vreen，与 MeshRef / AnimState 同类）。
//   - enabled = false 时跳过 onUpdate，但 onStart 已调用过则不重调。

import { ComponentType } from '../ECS/ComponentType';
import type { World, EntityId } from '../ECS/World';
import type { CollisionEventData, TriggerEventData } from '../Events/GameEvent';

/** 脚本运行上下文：脚本通过它访问 World 与自身实体。 */
export interface ScriptContext {
  world: World;
  /** 脚本所附加到的实体 ID。 */
  entityId: EntityId;
}

/**
 * 用户脚本接口。所有回调可选 —— 只实现需要的即可。
 * 实现可以是 class 实例或对象字面量。
 */
export interface ScriptInstance {
  /** 首次 update 前调用一次。 */
  onStart?(ctx: ScriptContext): void;
  /** 每帧调用（enabled = true 时）。 */
  onUpdate?(ctx: ScriptContext, dt: number): void;
  /** 组件移除 / 实体销毁时调用一次。 */
  onDestroy?(ctx: ScriptContext): void;
  /** 碰撞回调（由 ScriptSystem.dispatchCollision 触发）。 */
  onCollision?(ctx: ScriptContext, info: CollisionEventData): void;
  /** 触发器回调（由 ScriptSystem.dispatchTrigger 触发）。 */
  onTrigger?(ctx: ScriptContext, info: TriggerEventData): void;
}

/** 脚本组件：持有 ScriptInstance + enabled + 内部 started 标记。 */
export class ScriptComponent {
  /** 用户脚本实例。 */
  script: ScriptInstance;
  /** 是否启用。false 时 ScriptSystem 跳过 onUpdate / 回调。 */
  enabled: boolean = true;
  /** 内部：onStart 是否已调用过（由 ScriptSystem 设置，避免重复调用）。 */
  started: boolean = false;

  constructor(script: ScriptInstance) {
    this.script = script;
  }
}

/** 组件类型单例（与 TransformC / VelocityC 等同模式）。 */
export const ScriptC = new ComponentType<ScriptComponent>('Script');

/** ScriptComponent 持有运行时脚本引用，属于非 POJO 组件，不进 .vreen 序列化。 */
export const SCRIPT_COMPONENT_NAME = 'Script';

// ============================================================================
// Visual Scripting — Script Canvas 风格可视化脚本组件。
//
// 设计参考: o3de Gems/ScriptCanvas — 节点图驱动的可视化脚本。
//   - 节点类型: event (事件入口) / action (动作) / condition (分支) /
//               variable (变量读写) / function (调用注册函数)。
//   - 连接模型: 输出 pin 的 connectedTo 数组列出它连到的 (nodeId, pinName)。
//     exec 流沿 "exec" 输出 pin 链式传播;condition 节点用 "true"/"false"
//     输出 pin 做分支路由。
//   - 事件路由: eventHandlers 映射 事件名 → 触发的 event 节点 id 列表,
//     handleEvent(name, args) 找到对应 event 节点并执行其 exec 链。
//
// 与 ScriptComponent (生命周期脚本) 的关系:
//   - ScriptComponent: 代码驱动,实现 ScriptInstance 接口,非 POJO 不序列化。
//   - VisualScriptComponent: 数据驱动,scriptGraph/variables 可序列化进 .vreen。
//   两者互补: 代码脚本写复杂逻辑,可视化脚本供非程序员搭建玩法。
// ============================================================================

/** 可视化脚本节点类型 (对应 o3de Script Canvas 节点分类)。 */
export type ScriptNodeType = 'event' | 'action' | 'condition' | 'variable' | 'function';

/** pin 连接目标 (一个输出 pin 可连到多个输入 pin)。 */
export interface ScriptPinConnection {
  nodeId: string;
  pinName: string;
}

/** 脚本节点上的引脚 (输入或输出)。 */
export interface ScriptPin {
  /** 引脚名 (如 "exec" / "value" / "true" / "false")。 */
  name: string;
  /** 引脚数据类型标签 (如 "exec" / "number" / "string" / "any")。 */
  type: string;
  /** 引脚当前值 (数据引脚的静态默认值或运行时写入值)。 */
  value: any;
  /** 此引脚连接到的目标引脚列表 (输出 pin 用)。 */
  connectedTo: ScriptPinConnection[];
}

/** 可视化脚本节点。 */
export interface ScriptNode {
  /** 节点唯一 id (图中不重复)。 */
  id: string;
  /** 节点类型。 */
  type: ScriptNodeType;
  /**
   * 节点名称语义随 type 变化:
   *   - event: 事件名 (如 "start" / "update" / "collision")
   *   - function: 注册函数名
   *   - variable: 变量名
   *   - action/condition: 任意标识或表达式
   */
  name: string;
  /** 输入引脚列表。 */
  inputs: ScriptPin[];
  /** 输出引脚列表。 */
  outputs: ScriptPin[];
  /** 节点附加数据 (variable 节点 mode='get'|'set',condition 表达式等)。 */
  data?: any;
}

/** 可序列化的脚本图快照 (用于 exportGraph / importGraph)。 */
export interface ScriptGraphJSON {
  nodes: ScriptNode[];
  variables: [string, any][];
  eventHandlers: [string, string[]][];
}

/**
 * 可视化脚本组件 (Script Canvas 风格)。
 *
 * 执行模型:
 *   - start() 触发 "start" 事件;update(dt) 触发 "update"/"tick" 事件;
 *     stop() 触发 "stop" 事件再置 isRunning=false。
 *   - handleEvent(name, args) 找到所有 name 匹配的 event 节点,沿其 "exec"
 *     输出链逐节点执行;condition 节点按求值结果选择 "true"/"false" 分支。
 *   - function 节点调用 registerFunction 注册的函数;variable 节点读写
 *     setVariable 维护的变量;action 节点调用 data.handler (如提供)。
 *   - 环路防护: 执行链维护 visited 集合,遇已访问节点中止。
 */
export class VisualScriptComponent {
  /** 节点图 (节点列表)。 */
  scriptGraph: ScriptNode[] = [];
  /** 共享变量表 (variable 节点读写)。 */
  variables: Map<string, any> = new Map();
  /** 共享函数表 (function 节点调用)。 */
  functions: Map<string, Function> = new Map();
  /** 事件名 → event 节点 id 列表 (addNode 时自动维护)。 */
  eventHandlers: Map<string, string[]> = new Map();
  /** 是否正在运行 (start 后为 true,stop 后为 false)。 */
  isRunning: boolean = false;

  /** id → 节点索引 (加速查找)。 */
  private _nodeIndex: Map<string, ScriptNode> = new Map();

  /** 添加节点。同 id 节点会被覆盖。event 节点自动登记到 eventHandlers。 */
  addNode(node: ScriptNode): void {
    if (this._nodeIndex.has(node.id)) {
      const idx = this.scriptGraph.findIndex((n) => n.id === node.id);
      if (idx >= 0) this.scriptGraph[idx] = node;
      else this.scriptGraph.push(node);
    } else {
      this.scriptGraph.push(node);
    }
    this._nodeIndex.set(node.id, node);
    if (node.type === 'event') {
      const list = this.eventHandlers.get(node.name) ?? [];
      if (!list.includes(node.id)) list.push(node.id);
      this.eventHandlers.set(node.name, list);
    }
  }

  /** 移除节点。同步清理其他节点指向它的连接。返回是否成功移除。 */
  removeNode(id: string): boolean {
    const node = this._nodeIndex.get(id);
    if (!node) return false;
    const idx = this.scriptGraph.indexOf(node);
    if (idx >= 0) this.scriptGraph.splice(idx, 1);
    this._nodeIndex.delete(id);
    // 清理其他节点对本节点的连接引用。
    for (const n of this.scriptGraph) {
      for (const pin of [...n.inputs, ...n.outputs]) {
        pin.connectedTo = pin.connectedTo.filter((c) => c.nodeId !== id);
      }
    }
    // 从 eventHandlers 中移除。
    if (node.type === 'event') {
      const list = this.eventHandlers.get(node.name);
      if (list) {
        const i = list.indexOf(id);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.eventHandlers.delete(node.name);
        else this.eventHandlers.set(node.name, list);
      }
    }
    return true;
  }

  /**
   * 连接 fromNodeId 的 fromPin (输出) 到 toNodeId 的 toPin (输入)。
   * 返回是否成功 (节点或 pin 不存在则 false)。
   */
  connect(fromNodeId: string, fromPin: string, toNodeId: string, toPin: string): boolean {
    const from = this._nodeIndex.get(fromNodeId);
    const to = this._nodeIndex.get(toNodeId);
    if (!from || !to) return false;
    const outPin = from.outputs.find((p) => p.name === fromPin);
    const inPin = to.inputs.find((p) => p.name === toPin);
    if (!outPin || !inPin) return false;
    const exists = outPin.connectedTo.some(
      (c) => c.nodeId === toNodeId && c.pinName === toPin,
    );
    if (!exists) {
      outPin.connectedTo.push({ nodeId: toNodeId, pinName: toPin });
    }
    return true;
  }

  /** 断开指定连接。返回是否实际断开了至少一条。 */
  disconnect(fromNodeId: string, fromPin: string, toNodeId: string, toPin: string): boolean {
    const from = this._nodeIndex.get(fromNodeId);
    if (!from) return false;
    const outPin = from.outputs.find((p) => p.name === fromPin);
    if (!outPin) return false;
    const before = outPin.connectedTo.length;
    outPin.connectedTo = outPin.connectedTo.filter(
      (c) => !(c.nodeId === toNodeId && c.pinName === toPin),
    );
    return outPin.connectedTo.length < before;
  }

  /** 设置共享变量。 */
  setVariable(name: string, value: any): void {
    this.variables.set(name, value);
  }

  /** 读取共享变量。未设置返回 undefined。 */
  getVariable(name: string): any {
    return this.variables.get(name);
  }

  /** 注册函数 (供 function 节点调用)。 */
  registerFunction(name: string, fn: Function): void {
    this.functions.set(name, fn);
  }

  /** 调用已注册函数。未注册返回 undefined。 */
  callFunction(name: string, args: any[] = []): any {
    const fn = this.functions.get(name);
    if (!fn) return undefined;
    return fn(...args);
  }

  /** 启动脚本:置 isRunning=true 并触发 "start" 事件。 */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.handleEvent('start', []);
  }

  /** 停止脚本:触发 "stop" 事件再置 isRunning=false。 */
  stop(): void {
    if (!this.isRunning) return;
    this.handleEvent('stop', []);
    this.isRunning = false;
  }

  /** 每帧更新:触发 "update" 与 "tick" 事件,参数为 dt。 */
  update(dt: number): void {
    if (!this.isRunning) return;
    this.handleEvent('update', [dt]);
    this.handleEvent('tick', [dt]);
  }

  /**
   * 处理事件:找到所有 name 匹配的 event 节点,执行其 exec 链。
   * args 作为事件参数传给 event 节点的第一个输出 pin (供下游消费)。
   */
  handleEvent(eventName: string, args: any[] = []): void {
    const nodeIds = this.eventHandlers.get(eventName);
    if (!nodeIds || nodeIds.length === 0) return;
    for (const id of nodeIds) {
      const node = this._nodeIndex.get(id);
      if (!node) continue;
      this._executeChain(node, args);
    }
  }

  /** 获取所有节点 (快照数组)。 */
  getNodes(): ScriptNode[] {
    return [...this.scriptGraph];
  }

  /** 获取所有连接 (扁平化输出 pin 的 connectedTo)。 */
  getConnections(): Array<{ from: string; fromPin: string; to: string; toPin: string }> {
    const conns: Array<{ from: string; fromPin: string; to: string; toPin: string }> = [];
    for (const node of this.scriptGraph) {
      for (const pin of node.outputs) {
        for (const c of pin.connectedTo) {
          conns.push({ from: node.id, fromPin: pin.name, to: c.nodeId, toPin: c.pinName });
        }
      }
    }
    return conns;
  }

  /** 导出脚本图为可序列化 JSON。 */
  exportGraph(): ScriptGraphJSON {
    return {
      nodes: this.scriptGraph.map((n) => ({
        ...n,
        inputs: n.inputs.map((p) => ({ ...p, connectedTo: [...p.connectedTo] })),
        outputs: n.outputs.map((p) => ({ ...p, connectedTo: [...p.connectedTo] })),
      })),
      variables: Array.from(this.variables.entries()),
      eventHandlers: Array.from(this.eventHandlers.entries()),
    };
  }

  /** 导入脚本图 (替换当前图与变量)。functions 不在 JSON 中,需单独 registerFunction。 */
  importGraph(data: ScriptGraphJSON): void {
    this.scriptGraph = [];
    this._nodeIndex.clear();
    this.variables = new Map(data.variables ?? []);
    this.eventHandlers = new Map(data.eventHandlers ?? []);
    for (const n of data.nodes ?? []) {
      this.scriptGraph.push(n);
      this._nodeIndex.set(n.id, n);
    }
  }

  // ── private: 执行引擎 ────────────────────────────────────────

  /** 从 startNode 沿 exec 输出链逐节点执行 (环路防护)。 */
  private _executeChain(startNode: ScriptNode, args: any[]): void {
    const visited = new Set<string>();
    let current: ScriptNode | undefined = startNode;
    while (current) {
      if (visited.has(current.id)) break; // 环路防护
      visited.add(current.id);
      this._executeNode(current, args);
      // condition 节点按求值结果选择分支输出 pin。
      const nextPinName =
        current.type === 'condition'
          ? current.data?._branch
            ? 'true'
            : 'false'
          : 'exec';
      const execOut = current.outputs.find((p) => p.name === nextPinName);
      if (!execOut || execOut.connectedTo.length === 0) break;
      const nextConn = execOut.connectedTo[0];
      current = this._nodeIndex.get(nextConn.nodeId);
    }
  }

  /** 执行单个节点 (按类型分派)。 */
  private _executeNode(node: ScriptNode, args: any[]): void {
    switch (node.type) {
      case 'event': {
        // event 节点:把 args 写入第一个输出 pin 供下游读取。
        if (node.outputs.length > 0) {
          node.outputs[0].value = args;
        }
        break;
      }
      case 'function': {
        const fn = this.functions.get(node.name);
        if (fn) {
          const fnArgs = node.inputs
            .filter((p) => p.name !== 'exec' && p.type !== 'exec')
            .map((p) => this._resolvePinValue(node, p));
          const result = fn(...fnArgs);
          const outPin = node.outputs.find((p) => p.name !== 'exec' && p.type !== 'exec');
          if (outPin) outPin.value = result;
        }
        break;
      }
      case 'variable': {
        if (node.data?.mode === 'set') {
          const valPin = node.inputs.find((p) => p.name === 'value');
          const val = valPin ? this._resolvePinValue(node, valPin) : node.data?.value;
          this.variables.set(node.name, val);
        } else {
          // get 模式:把变量值写入输出 "value" pin 供下游读取。
          const outPin = node.outputs.find((p) => p.name === 'value');
          if (outPin) outPin.value = this.variables.get(node.name);
        }
        break;
      }
      case 'condition': {
        const valPin = node.inputs.find((p) => p.name === 'value');
        const val = valPin ? this._resolvePinValue(node, valPin) : node.data?.value;
        (node.data = node.data ?? {})._branch = !!val;
        break;
      }
      case 'action': {
        // 通用 action:若 data.handler 提供则调用,传入 (component, args)。
        if (typeof node.data?.handler === 'function') {
          node.data.handler(this, args);
        }
        break;
      }
    }
  }

  /**
   * 解析输入 pin 的值:若该 pin 被某输出 pin 连接,则取该输出 pin 的 value;
   * 否则用 pin 自身的静态 value。
   */
  private _resolvePinValue(node: ScriptNode, pin: ScriptPin): any {
    for (const n of this.scriptGraph) {
      for (const outPin of n.outputs) {
        for (const c of outPin.connectedTo) {
          if (c.nodeId === node.id && c.pinName === pin.name) {
            return outPin.value;
          }
        }
      }
    }
    return pin.value;
  }
}
