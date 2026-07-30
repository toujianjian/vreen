// RenderGraph — 渲染图系统(资源依赖管理 + Pass 调度 + 自动资源回收)。
//
// 设计目标:
//   - 把渲染管线拆成若干 RenderGraphNode(每个节点是一次 pass:render /
//     compute / transfer),节点通过 declared inputs / outputs 声明资源依赖;
//   - 由图自身完成:拓扑排序(确保依赖先执行)+ 资源生命周期分析(为
//     transient 资源在首次写入前分配,在最后读取后释放)+ 未使用节点剔除
//     + 循环 / 冲突检测;
//   - 不绑定具体 GL 资源类型:资源用 string 名标识,实际分配/释放由节点
//     的 execute 回调通过 ctx.createResource / ctx.destroyResource 完成。
//     这样 RenderGraph 既可服务于 WebGL2纹理/FBO,也可服务于 WebGPU buffer,
//     甚至是纯 CPU 的 Float32Array(测试 / 离线)。
//
// 数据流:
//   1. addNode(...) / registerResource(...) / addEdge(...) 构建图
//   2. compile():拓扑排序 → 计算每个 CompiledPass 的 reads/writes/creates/
//      destroys → 剔除未使用节点 → 标记 isCompiled=true
//   3. execute(context):按编译顺序调用每个 node.execute(ctx),ctx 负责
//      在 createResource/destroyResource 时维护实际资源
//
// 不变量:
//   - compile 后 compiledPasses 顺序满足:任一节点的所有依赖(入边来源)
//     都在其之前;
//   - transient 资源的生命周期:[firstWrite, lastRead],在 firstWrite 节点
//     的 creates 列表、lastRead 节点的 destroys 列表;
//   - persistent 资源不参与自动回收(由调用方管理);
//   - validate() 检测:循环 / 同帧多写冲突(两个节点同时 write 同一资源,
//     且二者无先后依赖)/ 未知资源引用;
//   - clear() 后图空,isCompiled=false。
//
// 参考:
//   - "GDC 2017: FrameGraph: Extensible Rendering Architecture in Frostbite"
//   - "GDC 2019: Destiny's Multi-threaded Renderer"
//   - Granite renderer (Themaister),本类为其纯 TS 简化版

import { createLogger } from '@/lib/logger';

const log = createLogger('RenderGraph');

/** 节点类型。 */
export type RenderGraphNodeKind = 'render' | 'compute' | 'transfer';

/** 执行上下文:由 execute() 传给每个节点。 */
export interface RenderGraphContext {
  /** 当前已分配的资源(name → value)。 */
  readonly resources: ReadonlyMap<string, unknown>;
  /** 读取资源(必须已存在)。 */
  getResource(name: string): unknown;
  /** 创建资源(写入 resources)。 */
  createResource(name: string, value: unknown): void;
  /** 销毁资源(从 resources 删除)。 */
  destroyResource(name: string): void;
  /** 当前编译后的 pass 序号(0-based)。 */
  readonly passIndex: number;
}

/** 资源类型。 */
export type RenderGraphResourceType = 'texture' | 'buffer';

/** 资源生命周期。 */
export type RenderGraphResourceLifetime = 'transient' | 'persistent';

/** 渲染图节点。 */
export interface RenderGraphNode {
  /** 节点唯一 ID。 */
  id: string;
  /** 节点名(调试用)。 */
  name: string;
  /** 节点类型。 */
  type: RenderGraphNodeKind;
  /** 执行回调:读 inputs,写 outputs。 */
  execute: (ctx: RenderGraphContext) => void;
  /** 输入资源名列表(本节点读取)。 */
  inputs: string[];
  /** 输出资源名列表(本节点写入)。 */
  outputs: string[];
  /** 可选设置(节点自用,图不解释)。 */
  settings?: unknown;
}

/** 渲染图边:from → to,通过 resource 关联。 */
export interface RenderGraphEdge {
  /** 源节点 ID。 */
  from: string;
  /** 目标节点 ID。 */
  to: string;
  /** 流经的资源名。 */
  resource: string;
}

/** 渲染图资源描述。 */
export interface RenderGraphResource {
  /** 资源名(唯一)。 */
  name: string;
  /** 资源类型。 */
  type: RenderGraphResourceType;
  /** 可选格式(如 'rgba16f');由节点解释。 */
  format?: string;
  /** 可选尺寸描述(如 'canvas' / '128x128' / {width,height});由节点解释。 */
  size?: unknown;
  /** 生命周期:transient 由图自动回收;persistent 由调用方管理。 */
  lifetime: RenderGraphResourceLifetime;
  /** 当前引用计数(由 compile 维护)。 */
  refCount: number;
}

/** 编译后的 Pass:节点 + 资源访问明细。 */
export interface CompiledPass {
  /** 源节点。 */
  node: RenderGraphNode;
  /** 读取的资源(来自 inputs)。 */
  reads: string[];
  /** 写入的资源(来自 outputs)。 */
  writes: string[];
  /** 本 Pass 首次创建的 transient 资源(首次 write 且非 persistent)。 */
  creates: string[];
  /** 本 Pass 最后一次读取后可释放的 transient 资源。 */
  destroys: string[];
}

/** 资源生命周期信息(compile 后查询)。 */
export interface ResourceLifetime {
  /** 资源名。 */
  name: string;
  /** 首次写入该资源的 pass 索引(-1 表示未写入,可能为外部 persistent 输入)。 */
  firstWritePass: number;
  /** 最后一次读取该资源的 pass 索引(-1 表示未读取,可能是输出)。 */
  lastReadPass: number;
  /** 生命周期类型。 */
  lifetime: RenderGraphResourceLifetime;
}

/** 图统计。 */
export interface RenderGraphStats {
  /** 节点总数。 */
  nodeCount: number;
  /** 边总数。 */
  edgeCount: number;
  /** 资源总数。 */
  resourceCount: number;
  /** 编译后的 Pass 总数。 */
  compiledPassCount: number;
  /** transient 资源数。 */
  transientResourceCount: number;
  /** persistent 资源数。 */
  persistentResourceCount: number;
  /** 是否已编译。 */
  isCompiled: boolean;
}

/** 图导出格式(JSON,用于调试 / 可视化)。 */
export interface RenderGraphExportData {
  nodes: Array<{
    id: string;
    name: string;
    type: RenderGraphNodeKind;
    inputs: string[];
    outputs: string[];
  }>;
  edges: Array<{ from: string; to: string; resource: string }>;
  resources: Array<{
    name: string;
    type: RenderGraphResourceType;
    format?: string;
    size?: unknown;
    lifetime: RenderGraphResourceLifetime;
  }>;
  compiledPasses?: Array<{
    nodeId: string;
    reads: string[];
    writes: string[];
    creates: string[];
    destroys: string[];
  }>;
}

/**
 * 渲染图。资源依赖管理 + Pass 调度 + 自动资源回收。
 *
 * 典型用法:
 * ```ts
 * const rg = new RenderGraph();
 * rg.registerResource({ name: 'color', type: 'texture', lifetime: 'transient' });
 * rg.registerResource({ name: 'depth', type: 'texture', lifetime: 'transient' });
 * rg.addNode({
 *   id: 'gbuffer', name: 'G-Buffer Pass', type: 'render',
 *   inputs: [], outputs: ['color', 'depth'],
 *   execute: (ctx) => { ctx.createResource('color', makeTex()); ctx.createResource('depth', makeTex()); }
 * });
 * rg.addNode({
 *   id: 'lighting', name: 'Lighting Pass', type: 'render',
 *   inputs: ['color', 'depth'], outputs: ['color'],
 *   execute: (ctx) => { /* 读 color/depth,写 color *\/ }
 * });
 * rg.compile();
 * const ctx = makeContext();
 * rg.execute(ctx);
 * ```
 */
export class RenderGraph {
  /** 所有节点(id → node)。 */
  private _nodes: Map<string, RenderGraphNode> = new Map();
  /** 节点顺序(插入顺序,便于稳定遍历)。 */
  private _nodeOrder: string[] = [];
  /** 所有边。 */
  private _edges: RenderGraphEdge[] = [];
  /** 所有资源(name → resource)。 */
  private _resources: Map<string, RenderGraphResource> = new Map();
  /** 编译后的 Pass 列表。 */
  private _compiledPasses: CompiledPass[] = [];
  /** 资源生命周期(compile 后填充)。 */
  private _lifetimes: Map<string, ResourceLifetime> = new Map();
  /** 是否已编译。 */
  private _isCompiled: boolean = false;

  // ── 节点管理 ───────────────────────────────────────────────────────

  /** 添加节点。若 id 已存在则抛错。返回 this 便于链式。 */
  addNode(node: RenderGraphNode): this {
    if (this._nodes.has(node.id)) {
      throw new Error(`RenderGraph.addNode: node id "${node.id}" already exists`);
    }
    this._nodes.set(node.id, node);
    this._nodeOrder.push(node.id);
    this._invalidateCompile();
    return this;
  }

  /** 移除节点(同时移除相关边)。返回是否移除成功。 */
  removeNode(id: string): boolean {
    if (!this._nodes.delete(id)) return false;
    this._nodeOrder = this._nodeOrder.filter((nid) => nid !== id);
    // 移除相关边
    this._edges = this._edges.filter((e) => e.from !== id && e.to !== id);
    this._invalidateCompile();
    return true;
  }

  /** 获取节点(找不到返回 undefined)。 */
  getNode(id: string): RenderGraphNode | undefined {
    return this._nodes.get(id);
  }

  /** 获取所有节点(只读快照)。 */
  getNodes(): readonly RenderGraphNode[] {
    return Array.from(this._nodes.values());
  }

  // ── 资源管理 ───────────────────────────────────────────────────────

  /** 注册资源。若 name 已存在则抛错。返回 this 便于链式。 */
  registerResource(resource: RenderGraphResource): this {
    if (this._resources.has(resource.name)) {
      throw new Error(`RenderGraph.registerResource: resource "${resource.name}" already exists`);
    }
    this._resources.set(resource.name, { ...resource, refCount: 0 });
    this._invalidateCompile();
    return this;
  }

  /** 注销资源(同时移除相关边)。返回是否注销成功。 */
  unregisterResource(name: string): boolean {
    if (!this._resources.delete(name)) return false;
    this._edges = this._edges.filter((e) => e.resource !== name);
    this._invalidateCompile();
    return true;
  }

  /** 获取资源(找不到返回 undefined)。 */
  getResource(name: string): RenderGraphResource | undefined {
    return this._resources.get(name);
  }

  // ── 边管理 ─────────────────────────────────────────────────────────

  /**
   * 添加边:from → to,流经 resource。
   * 校验:from / to 必须存在;resource 必须已注册;from 的 outputs 与 to 的
   * inputs 都应包含该 resource(警告但不报错,允许调用方先建边后补声明)。
   */
  addEdge(from: string, to: string, resource: string): this {
    if (!this._nodes.has(from)) {
      throw new Error(`RenderGraph.addEdge: from node "${from}" does not exist`);
    }
    if (!this._nodes.has(to)) {
      throw new Error(`RenderGraph.addEdge: to node "${to}" does not exist`);
    }
    if (!this._resources.has(resource)) {
      throw new Error(`RenderGraph.addEdge: resource "${resource}" is not registered`);
    }
    if (from === to) {
      throw new Error(`RenderGraph.addEdge: self-loop on node "${from}" not allowed`);
    }
    // 去重(同 from/to/resource)
    const dup = this._edges.some(
      (e) => e.from === from && e.to === to && e.resource === resource,
    );
    if (dup) return this;
    this._edges.push({ from, to, resource });
    this._invalidateCompile();
    return this;
  }

  /** 移除边。返回是否移除成功。 */
  removeEdge(from: string, to: string, resource: string): boolean {
    const before = this._edges.length;
    this._edges = this._edges.filter(
      (e) => !(e.from === from && e.to === to && e.resource === resource),
    );
    if (this._edges.length !== before) {
      this._invalidateCompile();
      return true;
    }
    return false;
  }

  // ── 编译 ───────────────────────────────────────────────────────────

  /**
   * 编译图:拓扑排序 + 资源生命周期分析 + 未使用节点剔除。
   *
   * 步骤:
   *   1. topologicalSort(ALL nodes):Kahn 算法,基于 edges 的 from → to,
   *      检测环(若存在环,即使在"死"子图中也抛错)
   *   2. cullUnusedNodes():从 sink 节点(outputs=[])反向 BFS,标记可达节点
   *   3. computeLifetimes():对每个资源计算 firstWrite / lastRead
   *   4. 构建 CompiledPass 列表(每节点 reads/writes/creates/destroys)
   *
   * 编译失败(存在环)会抛错。
   */
  compile(): this {
    // 1. 拓扑排序所有节点(检测环,即使在死子图中也要报错)
    const allSorted = this._topologicalSortInternal(new Set(this._nodeOrder));
    // 2. 剔除未使用节点(从 sink 反向 BFS)
    const reachable = this._cullUnusedNodesInternal();
    const sorted = allSorted.filter((n) => reachable.has(n.id));
    // 3. 生命周期
    this._computeLifetimesInternal(sorted);
    // 4. 构建 CompiledPass
    this._compiledPasses = sorted.map((node, idx) => {
      const reads = Array.from(new Set(node.inputs));
      const writes = Array.from(new Set(node.outputs));
      const creates: string[] = [];
      const destroys: string[] = [];
      for (const r of writes) {
        const lt = this._lifetimes.get(r);
        if (lt && lt.firstWritePass === idx) {
          const res = this._resources.get(r);
          if (res && res.lifetime === 'transient') {
            creates.push(r);
          }
        }
      }
      for (const r of reads) {
        const lt = this._lifetimes.get(r);
        if (lt && lt.lastReadPass === idx) {
          const res = this._resources.get(r);
          if (res && res.lifetime === 'transient') {
            destroys.push(r);
          }
        }
      }
      return { node, reads, writes, creates, destroys };
    });
    this._isCompiled = true;
    log.info(
      `compiled: ${this._compiledPasses.length} passes, ${this._resources.size} resources`,
    );
    return this;
  }

  /**
   * 拓扑排序(Kahn 算法)。
   * 返回排序后的节点列表。若存在环则抛错。
   *
   * 注:此方法对图中所有节点排序(不剔除),用于检测环与确定全局执行顺序。
   * 剔除是 compile() 的事。
   */
  topologicalSort(): RenderGraphNode[] {
    return this._topologicalSortInternal(new Set(this._nodeOrder));
  }

  /**
   * 计算资源生命周期。
   * 返回 name → ResourceLifetime 映射。
   *
   * 注:基于当前节点顺序(插入顺序)计算,不依赖 compile()。
   */
  computeLifetimes(): Map<string, ResourceLifetime> {
    const ordered = this._nodeOrder.map((id) => this._nodes.get(id)!) as RenderGraphNode[];
    return this._computeLifetimesFor(ordered);
  }

  /**
   * 剔除未使用节点:从 outputs 节点(无出边)反向 BFS,标记可达节点。
   * 返回可达节点 ID 集合。
   *
   * 注:此方法不修改内部状态,仅返回结果。compile() 会内部调用并丢弃未
   * 可达节点。
   */
  cullUnusedNodes(): Set<string> {
    return this._cullUnusedNodesInternal();
  }

  /**
   * 验证图。返回错误字符串数组(空数组表示通过)。
   * 检查项:
   *   - 循环检测(拓扑排序失败)
   *   - 未知资源引用(inputs/outputs 中未注册的资源)
   *   - 同帧多写冲突(同一资源被多个节点 write 且二者无先后依赖)
   */
  validate(): string[] {
    const errors: string[] = [];
    // 未知资源引用
    for (const node of this._nodes.values()) {
      for (const r of node.inputs) {
        if (!this._resources.has(r)) {
          errors.push(
            `node "${node.id}" reads unregistered resource "${r}"`,
          );
        }
      }
      for (const r of node.outputs) {
        if (!this._resources.has(r)) {
          errors.push(
            `node "${node.id}" writes unregistered resource "${r}"`,
          );
        }
      }
    }
    // 循环检测
    try {
      this._topologicalSortInternal(new Set(this._nodeOrder));
    } catch (e) {
      errors.push(`cycle detected: ${(e as Error).message}`);
    }
    // 同帧多写冲突:同一资源被多个节点 write,且这些节点之间无路径
    const writers = new Map<string, string[]>();
    for (const node of this._nodes.values()) {
      for (const r of node.outputs) {
        const arr = writers.get(r) ?? [];
        arr.push(node.id);
        writers.set(r, arr);
      }
    }
    for (const [resource, nodeIds] of writers) {
      if (nodeIds.length < 2) continue;
      // 对每对 writer,检查是否存在路径(任一方向)
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const a = nodeIds[i];
          const b = nodeIds[j];
          const aToB = this._hasPath(a, b);
          const bToA = this._hasPath(b, a);
          if (!aToB && !bToA) {
            errors.push(
              `resource "${resource}" is written by "${a}" and "${b}" with no dependency between them (race condition)`,
            );
          }
        }
      }
    }
    return errors;
  }

  // ── 执行 ───────────────────────────────────────────────────────────

  /**
   * 执行图:按编译顺序调用每个节点的 execute。
   *
   * @param context  由调用方提供的执行上下文(通常包含 createResource/
   *                  destroyResource 的实现)。若不传则使用内部默认上下文
   *                  (用 Map<string, unknown> 存资源)。
   */
  execute(context?: RenderGraphContext): RenderGraphContext {
    if (!this._isCompiled) {
      throw new Error('RenderGraph.execute: graph is not compiled; call compile() first');
    }
    const ctx = context ?? this._createDefaultContext();
    for (let i = 0; i < this._compiledPasses.length; i++) {
      const pass = this._compiledPasses[i];
      (ctx as { passIndex: number }).passIndex = i;
      try {
        pass.node.execute(ctx);
      } catch (e) {
        log.error(`pass "${pass.node.id}" failed: ${(e as Error).message}`);
        throw e;
      }
    }
    return ctx;
  }

  // ── 查询 ───────────────────────────────────────────────────────────

  /** 获取编译后的 Pass 列表(未编译时为空)。 */
  getCompiledPasses(): readonly CompiledPass[] {
    return this._compiledPasses;
  }

  /** 获取资源生命周期(compile 后填充;未编译时为空)。 */
  getResourceLifetimes(): ReadonlyMap<string, ResourceLifetime> {
    return this._lifetimes;
  }

  /** 获取所有边(只读快照)。 */
  getEdges(): readonly RenderGraphEdge[] {
    return this._edges;
  }

  /** 获取所有资源(只读快照)。 */
  getResources(): readonly RenderGraphResource[] {
    return Array.from(this._resources.values());
  }

  /** 是否已编译。 */
  get isCompiled(): boolean {
    return this._isCompiled;
  }

  /** 获取统计。 */
  getStats(): RenderGraphStats {
    let transientCount = 0;
    let persistentCount = 0;
    for (const r of this._resources.values()) {
      if (r.lifetime === 'transient') transientCount++;
      else persistentCount++;
    }
    return {
      nodeCount: this._nodes.size,
      edgeCount: this._edges.length,
      resourceCount: this._resources.size,
      compiledPassCount: this._compiledPasses.length,
      transientResourceCount: transientCount,
      persistentResourceCount: persistentCount,
      isCompiled: this._isCompiled,
    };
  }

  /** 导出图(JSON,用于调试 / 可视化)。 */
  exportGraph(): RenderGraphExportData {
    const data: RenderGraphExportData = {
      nodes: this._nodeOrder.map((id) => {
        const n = this._nodes.get(id)!;
        return {
          id: n.id,
          name: n.name,
          type: n.type,
          inputs: [...n.inputs],
          outputs: [...n.outputs],
        };
      }),
      edges: this._edges.map((e) => ({ from: e.from, to: e.to, resource: e.resource })),
      resources: Array.from(this._resources.values()).map((r) => ({
        name: r.name,
        type: r.type,
        format: r.format,
        size: r.size,
        lifetime: r.lifetime,
      })),
    };
    if (this._isCompiled) {
      data.compiledPasses = this._compiledPasses.map((p) => ({
        nodeId: p.node.id,
        reads: [...p.reads],
        writes: [...p.writes],
        creates: [...p.creates],
        destroys: [...p.destroys],
      }));
    }
    return data;
  }

  /**
   * 导入图(覆盖当前图)。
   * 注:导入后节点没有 execute 回调(无法从 JSON 序列化),需要调用方
   * 重新设置 node.execute。isCompiled=false,需重新 compile。
   */
  importGraph(data: RenderGraphExportData): this {
    this.clear();
    for (const r of data.resources) {
      this.registerResource({
        name: r.name,
        type: r.type,
        format: r.format,
        size: r.size,
        lifetime: r.lifetime,
        refCount: 0,
      });
    }
    for (const n of data.nodes) {
      this.addNode({
        id: n.id,
        name: n.name,
        type: n.type,
        inputs: [...n.inputs],
        outputs: [...n.outputs],
        execute: () => {
          log.warn(`node "${n.id}" has no execute callback (imported); skipping`);
        },
      });
    }
    for (const e of data.edges) {
      this.addEdge(e.from, e.to, e.resource);
    }
    return this;
  }

  /** 清空图。 */
  clear(): void {
    this._nodes.clear();
    this._nodeOrder = [];
    this._edges = [];
    this._resources.clear();
    this._compiledPasses = [];
    this._lifetimes.clear();
    this._isCompiled = false;
  }

  // ── private ────────────────────────────────────────────────────────

  private _invalidateCompile(): void {
    if (this._isCompiled) {
      this._isCompiled = false;
      this._compiledPasses = [];
      this._lifetimes.clear();
    }
  }

  /**
   * 内部:剔除未使用节点。
   * 规则:
   *   - "Sink 节点" = outputs 为空的节点(纯消费者,如 present / tonemap-to-screen)
   *   - 若图中存在 sink:从所有 sink 反向 BFS(沿 edges 的 to → from),
   *     标记可达节点;不可达的节点视为"死节点",被剔除
   *   - 若图中不存在任何 sink:保留所有节点(无法判定何为输出,不剔除)
   *
   * 设计权衡:不引入显式 isOutput 标记,用 outputs=[] 作为 sink 启发式。
   * 调用方应把"最终输出"节点(如 present)声明为 outputs=[]。
   */
  private _cullUnusedNodesInternal(): Set<string> {
    // 找 seed:outputs 为空的节点(纯 sink)
    const seeds: string[] = [];
    for (const id of this._nodeOrder) {
      const node = this._nodes.get(id);
      if (node && node.outputs.length === 0) {
        seeds.push(id);
      }
    }
    // 无 sink:无法判定何为输出,保留所有节点
    if (seeds.length === 0) {
      return new Set(this._nodeOrder);
    }
    const reachable = new Set<string>();
    // 反向邻接表:to → [from, ...]
    const reverseAdj = new Map<string, string[]>();
    for (const e of this._edges) {
      const arr = reverseAdj.get(e.to) ?? [];
      arr.push(e.from);
      reverseAdj.set(e.to, arr);
    }
    // BFS
    const queue = [...seeds];
    for (const s of queue) reachable.add(s);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const preds = reverseAdj.get(cur);
      if (!preds) continue;
      for (const p of preds) {
        if (!reachable.has(p)) {
          reachable.add(p);
          queue.push(p);
        }
      }
    }
    return reachable;
  }

  /**
   * 内部:Kahn 拓扑排序。
   * 仅对 reachable 集合中的节点排序。若存在环则抛错。
   */
  private _topologicalSortInternal(reachable: Set<string>): RenderGraphNode[] {
    // 入度(只算 reachable 中的边)
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of reachable) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }
    for (const e of this._edges) {
      if (!reachable.has(e.from) || !reachable.has(e.to)) continue;
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
    // 用插入顺序做稳定排序的 tie-breaker
    const queue: string[] = [];
    for (const id of this._nodeOrder) {
      if (reachable.has(id) && (inDegree.get(id) ?? 0) === 0) {
        queue.push(id);
      }
    }
    const result: RenderGraphNode[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = this._nodes.get(id);
      if (node) result.push(node);
      const succs = adj.get(id) ?? [];
      for (const s of succs) {
        const d = (inDegree.get(s) ?? 0) - 1;
        inDegree.set(s, d);
        if (d === 0) queue.push(s);
      }
    }
    if (result.length !== reachable.size) {
      // 存在环:找出未访问的节点
      const visited = new Set(result.map((n) => n.id));
      const stuck: string[] = [];
      for (const id of reachable) {
        if (!visited.has(id)) stuck.push(id);
      }
      throw new Error(
        `RenderGraph: cycle detected among nodes: [${stuck.join(', ')}]`,
      );
    }
    return result;
  }

  /**
   * 内部:计算资源生命周期(针对给定节点顺序)。
   * firstWrite = 第一个 outputs 包含该资源的节点索引;
   * lastRead = 最后一个 inputs 包含该资源的节点索引。
   */
  private _computeLifetimesInternal(sorted: RenderGraphNode[]): Map<string, ResourceLifetime> {
    const lifetimes = this._computeLifetimesFor(sorted);
    this._lifetimes = lifetimes;
    return lifetimes;
  }

  private _computeLifetimesFor(ordered: RenderGraphNode[]): Map<string, ResourceLifetime> {
    const lifetimes = new Map<string, ResourceLifetime>();
    for (const [name, res] of this._resources) {
      let firstWrite = -1;
      let lastRead = -1;
      for (let i = 0; i < ordered.length; i++) {
        const n = ordered[i];
        if (firstWrite === -1 && n.outputs.includes(name)) firstWrite = i;
        if (n.inputs.includes(name)) lastRead = i;
      }
      lifetimes.set(name, {
        name,
        firstWritePass: firstWrite,
        lastReadPass: lastRead,
        lifetime: res.lifetime,
      });
    }
    return lifetimes;
  }

  /** 内部:判断 from 是否能通过边到达 to(BFS)。 */
  private _hasPath(from: string, to: string): boolean {
    if (from === to) return true;
    const adj = new Map<string, string[]>();
    for (const e of this._edges) {
      const arr = adj.get(e.from) ?? [];
      arr.push(e.to);
      adj.set(e.from, arr);
    }
    const visited = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const succs = adj.get(cur) ?? [];
      for (const s of succs) {
        if (s === to) return true;
        if (!visited.has(s)) {
          visited.add(s);
          queue.push(s);
        }
      }
    }
    return false;
  }

  /** 创建默认上下文(用 Map 存资源)。 */
  private _createDefaultContext(): RenderGraphContext {
    const resources = new Map<string, unknown>();
    const ctx: RenderGraphContext = {
      resources,
      passIndex: 0,
      getResource(name: string): unknown {
        if (!resources.has(name)) {
          throw new Error(`RenderGraph: resource "${name}" not created`);
        }
        return resources.get(name);
      },
      createResource(name: string, value: unknown): void {
        if (resources.has(name)) {
          log.warn(`resource "${name}" already exists; overwriting`);
        }
        resources.set(name, value);
      },
      destroyResource(name: string): void {
        if (!resources.delete(name)) {
          log.warn(`resource "${name}" not found; cannot destroy`);
        }
      },
    };
    return ctx;
  }
}
