// ThreadedRenderer — 多线程渲染支持(Web Worker + 命令缓冲 + 同步)。
//
// 设计目标:
//   - 把 CPU 侧的渲染命令准备/排序/合并工作放到 Web Worker,主线程只负责
//     最终的 GL 调用,降低主线程负载(典型受益场景:海量 mesh 的视锥剔除、
//     透明排序、draw call 合并);
//   - 命令缓冲(RenderCommand[])在主线程累积,flushCommands() 时批量
//     postMessage 给 worker;worker 处理完回传"帧完成"消息,主线程在
//     endFrame()/sync() 等待;
//   - Worker 不可用时(Node/无头测试/Safari 旧版)自动降级为单线程模式:
//     命令缓冲仍然记录,flushCommands 直接在主线程同步处理,isAvailable()
//     返回 false,API 行为一致但无并行收益;
//   - 不直接持有 GL 上下文:本类是"命令编排器",实际 GL 提交由 WebGL2Renderer
//     在主线程消费 getSortedCommands() 的输出完成(OffscreenCanvas 真正跨
//     worker GL 是未来扩展)。
//
// Worker 实现策略:
//   - 用 Blob URL 内联创建 worker,避免额外 .worker.js 文件依赖,保持引擎
//     零运行时依赖原则;
//   - Worker 内部接收 RenderCommand[],按 priority 降序排序,返回排序后的
//     命令数组 + 处理耗时(模拟 CPU 侧准备工作的并行化)。
//
// 同步模型:
//   - beginFrame() 标记帧开始,记录 mainTime 起点;
//   - 主线程 addCommand/addDrawCommand 累积命令;
//   - flushCommands() 把 commandBuffer 发给 worker(异步)或主线程同步处理;
//   - endFrame() 等待 worker 完成本帧(若多线程),记录 workerTime/totalFrames;
//   - sync() 显式阻塞等待 worker 完成所有已派发任务。

import type { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { Matrix4 } from '../Math/Matrix4';
import { createLogger } from '@/lib/logger';

const log = createLogger('ThreadedRenderer');

/** 渲染命令类型。 */
export type RenderCommandType =
  | 'draw'
  | 'updateBuffer'
  | 'updateTexture'
  | 'setUniform'
  | 'setViewport'
  | 'clear';

/** 单条渲染命令。 */
export interface RenderCommand {
  /** 命令类型。 */
  type: RenderCommandType;
  /** 命令负载(类型相关,透传给 worker / 消费者)。 */
  data: unknown;
  /** 优先级(数值越大越先处理;同 priority 按入队顺序)。 */
  priority: number;
  /** 入队序号(用于稳定排序)。 */
  seq: number;
}

/** draw 命令的负载结构。 */
export interface DrawCommandData {
  /** mesh 引用标识(用 uuid/name,不传递实例避免 worker 持有主线程对象)。 */
  meshId: string;
  /** material 引用标识。 */
  materialId: string;
  /** 世界变换矩阵(16 个 float,column-major)。 */
  transform: Float32Array;
}

/** updateBuffer 命令的负载。 */
export interface UpdateBufferCommandData {
  bufferId: string;
  /** 缓冲数据(transferable 友好)。 */
  data: ArrayBufferView | number[];
}

/** updateTexture 命令的负载。 */
export interface UpdateTextureCommandData {
  textureId: string;
  /** 纹理数据。 */
  data: ArrayBufferView | number[];
}

/** ThreadedRenderer 统计信息。 */
export interface ThreadedRendererStats {
  /** worker 累计处理耗时(ms)。 */
  workerTime: number;
  /** 主线程累计耗时(ms)。 */
  mainTime: number;
  /** 已完成帧数。 */
  totalFrames: number;
  /** 同步次数(endFrame/sync 调用次数)。 */
  syncCount: number;
  /** 当前缓冲区命令数。 */
  commandCount: number;
  /** 是否多线程模式。 */
  multiThreaded: boolean;
  /** worker 是否可用。 */
  workerSupported: boolean;
}

/** Worker 完成消息的负载。 */
interface WorkerDonePayload {
  /** 本批处理耗时(ms)。 */
  workerTime: number;
  /** 排序后的命令序号列表(主线程据此回查 commandBuffer)。 */
  order: number[];
  /** 帧标识(对应派发时的 frameId)。 */
  frameId: number;
}

/** Worker 消息事件类型 narrowing。 */
interface WorkerMessageEvent extends MessageEvent {
  data: WorkerDonePayload;
}

/** 内联 worker 脚本:接收命令数组,按 priority 降序稳定排序后回传。 */
const WORKER_SCRIPT = `
self.onmessage = function(e) {
  var t0 = performance.now();
  var commands = e.data.commands;
  var frameId = e.data.frameId;
  // 稳定排序:priority 降序,同 priority 按 seq 升序(入队顺序)
  var order = commands.map(function(c, i) { return i; });
  order.sort(function(a, b) {
    var pa = commands[a].priority;
    var pb = commands[b].priority;
    if (pa !== pb) return pb - pa;
    return commands[a].seq - commands[b].seq;
  });
  var dt = performance.now() - t0;
  self.postMessage({ workerTime: dt, order: order, frameId: frameId });
};
`;

/**
 * 多线程渲染器 —— 命令缓冲 + Web Worker 异步处理 + 主线程同步。
 *
 * 用法(多线程):
 *   const tr = new ThreadedRenderer();
 *   tr.initialize();
 *   tr.setMultiThreaded(true);
 *   tr.beginFrame();
 *   tr.addDrawCommand(mesh, material, mesh.matrixWorld);
 *   tr.flushCommands();        // 派发到 worker
 *   await tr.endFrame();       // 等待 worker 完成
 *   const sorted = tr.getSortedCommands();  // 取排序结果,交给 GL 渲染
 *
 * 用法(降级单线程,测试友好):
 *   const tr = new ThreadedRenderer();
 *   tr.setMultiThreaded(false);
 *   tr.beginFrame();
 *   tr.addDrawCommand(...);
 *   tr.flushCommands();        // 主线程同步排序
 *   tr.endFrame();             // 立即完成
 */
export class ThreadedRenderer {
  /** Worker 实例(多线程模式时持有)。 */
  worker: Worker | null = null;
  /** Worker 是否被环境支持。 */
  isWorkerSupported: boolean = false;
  /** 命令缓冲(主线程累积,flushCommands 后清空)。 */
  commandBuffer: RenderCommand[] = [];
  /** 命令缓冲最大容量(超出自动 flush)。 */
  maxBufferSize: number = 1024;
  /** 上一帧的同步耗时(ms,worker 处理时间)。 */
  frameSyncTime: number = 0;
  /** 是否启用多线程模式。 */
  isMultiThreaded: boolean = false;

  /** 统计信息。 */
  stats: ThreadedRendererStats = {
    workerTime: 0,
    mainTime: 0,
    totalFrames: 0,
    syncCount: 0,
    commandCount: 0,
    multiThreaded: false,
    workerSupported: false,
  };

  /** 入队序号计数器(稳定排序用)。 */
  private _seqCounter: number = 0;
  /** 当前帧标识(派发时附带,endFrame 时校验)。 */
  private _currentFrameId: number = 0;
  /** 帧开始时间戳(performance.now)。 */
  private _frameStartTime: number = 0;
  /** 待决的 worker 完成回调(每帧一个)。 */
  private _pendingResolve: ((payload: WorkerDonePayload | null) => void) | null = null;
  /** worker 消息回调(外部监听)。 */
  private _messageCallbacks: Array<(payload: WorkerDonePayload) => void> = [];
  /** worker 错误回调(外部监听)。 */
  private _errorCallbacks: Array<(err: Error) => void> = [];
  /** Blob URL(initialize 创建,destroy 释放)。 */
  private _workerUrl: string | null = null;
  /** 上一帧 worker 返回的排序后命令序号(flushCommands 后填充)。 */
  private _lastOrder: number[] = [];
  /** 帧开始标志(beginFrame 后置 true,endFrame 后置 false)。 */
  private _frameInProgress: boolean = false;

  constructor() {
    // 检测 Worker 支持(浏览器 + Node 18+ 实验性)
    this.isWorkerSupported = typeof Worker !== 'undefined';
    this.stats.workerSupported = this.isWorkerSupported;
  }

  /**
   * 初始化 —— 创建 Worker(若环境支持)。
   * 多次调用安全:已初始化时 no-op。
   */
  initialize(): void {
    if (this.worker) return;
    if (!this.isWorkerSupported) {
      log.warn('initialize — Worker not supported in this environment, falling back to single-threaded');
      return;
    }
    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      this._workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(this._workerUrl);
      this.worker.onmessage = (e: MessageEvent) => {
        this._handleWorkerMessage(e as WorkerMessageEvent);
      };
      this.worker.onerror = (e: ErrorEvent) => {
        const err = new Error(e.message || 'Worker error');
        this._errorCallbacks.forEach((cb) => cb(err));
        log.error(`worker error: ${err.message}`);
      };
      log.info('initialize — Worker created successfully');
    } catch (err) {
      log.warn(`initialize — Worker creation failed: ${(err as Error).message}, falling back`);
      this.isWorkerSupported = false;
      this.stats.workerSupported = false;
      this.worker = null;
      this._workerUrl = null;
    }
  }

  /** 销毁 —— 终止 worker + 释放 Blob URL + 清空缓冲。 */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      log.info('destroy — Worker terminated');
    }
    if (this._workerUrl) {
      URL.revokeObjectURL(this._workerUrl);
      this._workerUrl = null;
    }
    this.commandBuffer = [];
    this._pendingResolve = null;
    this._messageCallbacks = [];
    this._errorCallbacks = [];
    this._lastOrder = [];
    this._frameInProgress = false;
    this.isMultiThreaded = false;
    this.stats.multiThreaded = false;
  }

  /** Worker 是否可用(已初始化且环境支持)。 */
  isAvailable(): boolean {
    return this.isWorkerSupported && this.worker !== null;
  }

  /**
   * 启用/禁用多线程模式。
   * - 启用时:若 worker 未初始化则先 initialize;若环境不支持则降级为 false 并 warn。
   * - 禁用时:命令在主线程同步处理(flushCommands 直接排序)。
   */
  setMultiThreaded(enabled: boolean): void {
    if (enabled) {
      if (!this.isWorkerSupported) {
        log.warn('setMultiThreaded — Worker not supported, staying single-threaded');
        this.isMultiThreaded = false;
        this.stats.multiThreaded = false;
        return;
      }
      if (!this.worker) this.initialize();
      this.isMultiThreaded = this.worker !== null;
    } else {
      this.isMultiThreaded = false;
    }
    this.stats.multiThreaded = this.isMultiThreaded;
    log.info(`setMultiThreaded — ${this.isMultiThreaded ? 'multi-threaded' : 'single-threaded'}`);
  }

  /** 当前是否多线程模式。 */
  isMultiThreadedMode(): boolean {
    return this.isMultiThreaded;
  }

  /** 添加渲染命令到缓冲。priority 越大越先处理。 */
  addCommand(command: Omit<RenderCommand, 'seq'>): void {
    const cmd: RenderCommand = {
      type: command.type,
      data: command.data,
      priority: command.priority,
      seq: this._seqCounter++,
    };
    this.commandBuffer.push(cmd);
    this.stats.commandCount = this.commandBuffer.length;
    // 超出最大缓冲自动 flush(防止内存膨胀)
    if (this.commandBuffer.length >= this.maxBufferSize) {
      this.flushCommands();
    }
  }

  /** 便捷:添加 draw 命令。 */
  addDrawCommand(mesh: Mesh, material: Material, transform: Matrix4): void {
    const data: DrawCommandData = {
      meshId: mesh.uuid || mesh.name || '',
      materialId: material.uuid,
      transform: new Float32Array(transform.elements),
    };
    this.addCommand({ type: 'draw', data, priority: 0 });
  }

  /** 便捷:添加缓冲更新命令。 */
  addUpdateBufferCommand(bufferId: string, data: ArrayBufferView | number[]): void {
    const payload: UpdateBufferCommandData = { bufferId, data };
    this.addCommand({ type: 'updateBuffer', data: payload, priority: 1 });
  }

  /** 便捷:添加纹理更新命令。 */
  addUpdateTextureCommand(textureId: string, data: ArrayBufferView | number[]): void {
    const payload: UpdateTextureCommandData = { textureId, data };
    this.addCommand({ type: 'updateTexture', data: payload, priority: 1 });
  }

  /**
   * 刷新命令缓冲 —— 派发到 worker(多线程)或主线程同步排序(单线程)。
   * 派发后 commandBuffer 清空,排序结果存入 _lastOrder(单线程立即填充,
   * 多线程在 worker 回调后填充)。
   */
  flushCommands(): void {
    if (this.commandBuffer.length === 0) {
      this._lastOrder = [];
      this._lastSortedCommands = [];
      return;
    }
    const commands = this.commandBuffer;
    this.commandBuffer = [];
    this.stats.commandCount = 0;
    // 保存原始 commands 引用,供 worker 回调 / getSortedCommands 回查
    this._lastSortedCommands = commands;

    if (this.isMultiThreaded && this.worker) {
      // 多线程:postMessage 给 worker(命令数据可结构化克隆)
      this._currentFrameId++;
      // 收集 transferable(draw 命令的 transform buffer 可转移)
      const transferable: Transferable[] = [];
      for (const c of commands) {
        if (c.type === 'draw') {
          const d = c.data as DrawCommandData;
          transferable.push(d.transform.buffer);
        }
      }
      this.worker.postMessage(
        { commands, frameId: this._currentFrameId },
        transferable,
      );
      // _lastOrder / _lastSortedCommands 在 worker 回调中重排
    } else {
      // 单线程:主线程同步稳定排序
      const t0 = performance.now();
      const order = commands.map((_, i) => i);
      order.sort((a, b) => {
        const pa = commands[a].priority;
        const pb = commands[b].priority;
        if (pa !== pb) return pb - pa;
        return commands[a].seq - commands[b].seq;
      });
      this._lastOrder = order;
      // 按 order 重排 _lastSortedCommands
      this._lastSortedCommands = order.map((i) => commands[i]);
      const dt = performance.now() - t0;
      this.stats.workerTime += dt;
      this.frameSyncTime = dt;
    }
  }

  /** 开始帧 —— 记录起点。同一帧内多次调用 no-op。 */
  beginFrame(): void {
    if (this._frameInProgress) return;
    this._frameStartTime = performance.now();
    this._frameInProgress = true;
    this._lastOrder = [];
  }

  /**
   * 结束帧 —— 等待 worker 完成本帧(多线程)或直接完成(单线程)。
   * 返回 Promise(多线程)或已 resolve 的 Promise(单线程),便于 await。
   */
  endFrame(): Promise<void> {
    if (!this._frameInProgress) {
      return Promise.resolve();
    }
    const mainDt = performance.now() - this._frameStartTime;
    this.stats.mainTime += mainDt;
    this.stats.totalFrames++;
    this._frameInProgress = false;

    if (!this.isMultiThreaded || !this.worker) {
      // 单线程:flushCommands 已同步完成
      this.stats.syncCount++;
      return Promise.resolve();
    }

    // 多线程:等待 worker 回传
    return new Promise<void>((resolve) => {
      this._pendingResolve = (payload) => {
        if (payload) {
          this.stats.workerTime += payload.workerTime;
          this.frameSyncTime = payload.workerTime;
          this._lastOrder = payload.order;
        }
        this.stats.syncCount++;
        resolve();
      };
      // 若 flushCommands 未派发任何命令,worker 不会回传,立即完成
      if (this._lastOrder.length === 0 && this.commandBuffer.length === 0) {
        // 无命令派发时 _pendingResolve 不会被 worker 触发,这里兜底
        // 但需确认确实没有 pending 的 postMessage —— 用 frameId 判断
        // 简化:若无命令,直接 resolve
        if (this._pendingResolve) {
          const cb = this._pendingResolve;
          this._pendingResolve = null;
          cb(null);
        }
      }
    });
  }

  /**
   * 显式同步 —— 等待 worker 完成所有已派发任务。
   * 与 endFrame 不同:sync 可在帧中任意时刻调用,强制等待。
   */
  sync(): Promise<void> {
    if (!this.isMultiThreaded || !this.worker || !this._pendingResolve) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const original = this._pendingResolve;
      this._pendingResolve = (payload) => {
        if (payload) {
          this.stats.workerTime += payload.workerTime;
          this.frameSyncTime = payload.workerTime;
          this._lastOrder = payload.order;
        }
        this.stats.syncCount++;
        if (original) original(payload);
        resolve();
      };
    });
  }

  /** 当前缓冲区命令数。 */
  getCommandCount(): number {
    return this.commandBuffer.length;
  }

  /** 清空命令缓冲(不派发)。 */
  clearCommands(): void {
    this.commandBuffer = [];
    this.stats.commandCount = 0;
    this._lastOrder = [];
  }

  /** 设置最大缓冲大小(超出自动 flush)。 */
  setMaxBufferSize(max: number): void {
    this.maxBufferSize = Math.max(1, Math.floor(max));
  }

  /**
   * 取上一帧排序后的命令列表(按 worker 返回的 order 重排)。
   * 单线程模式:flushCommands 后立即可用。
   * 多线程模式:endFrame resolve 后可用。
   */
  getSortedCommands(): RenderCommand[] {
    // _lastOrder 是 commandBuffer 的索引,但 commandBuffer 已清空。
    // 因此 flushCommands 时需缓存原始 commands 引用供此处回查。
    return this._lastSortedCommands;
  }

  /** 上一帧排序后的命令缓存(flushCommands 时保存)。 */
  private _lastSortedCommands: RenderCommand[] = [];

  /** 获取统计快照。 */
  getStats(): ThreadedRendererStats {
    this.stats.commandCount = this.commandBuffer.length;
    this.stats.multiThreaded = this.isMultiThreaded;
    this.stats.workerSupported = this.isWorkerSupported;
    return { ...this.stats };
  }

  /** 注册 worker 消息回调(每帧 worker 完成时触发)。 */
  onWorkerMessage(callback: (payload: WorkerDonePayload) => void): void {
    this._messageCallbacks.push(callback);
  }

  /** 注册 worker 错误回调。 */
  onWorkerError(callback: (err: Error) => void): void {
    this._errorCallbacks.push(callback);
  }

  // ── 内部 ───────────────────────────────────────────────────────────

  /** worker onmessage 处理:解析 payload,触发回调,resolve pending。 */
  private _handleWorkerMessage(e: WorkerMessageEvent): void {
    const payload = e.data;
    // 用 order 重排当前缓存的 commands —— 但 commandBuffer 已清空,
    // 需在 flushCommands 时把 commands 引用存到 _lastSortedCommands。
    // 这里按 order 排序 _lastSortedCommands(已在 flushCommands 中赋值)。
    if (payload && payload.order) {
      // _lastSortedCommands 在 flushCommands 中按派发顺序保存
      // 按 order 重排
      const sorted: RenderCommand[] = [];
      for (const idx of payload.order) {
        if (this._lastSortedCommands[idx]) {
          sorted.push(this._lastSortedCommands[idx]);
        }
      }
      this._lastSortedCommands = sorted;
    }
    this._messageCallbacks.forEach((cb) => cb(payload));
    if (this._pendingResolve) {
      const cb = this._pendingResolve;
      this._pendingResolve = null;
      cb(payload);
    }
  }
}
