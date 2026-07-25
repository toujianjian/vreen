// NetworkTransport — 网络传输抽象层。
//
// 设计原则：
//   - 传输层接口与具体实现解耦；上层 NetworkSync 只依赖 NetworkTransport 接口。
//   - WebSocketTransport 是浏览器 WebSocket 实现；MockTransport 用于本地测试。
//   - 双向通信：send() 发送，onMessage() 注册接收回调。
//   - 连接生命周期：connect() → onConnect/onDisconnect 回调。
//   - 回调为单槽（后注册覆盖先注册），保持模型简单；多监听场景由上层包 EventBus。
//
// 不变量：
//   - send() 在未连接状态下被忽略（不抛错），由调用方决定是否重试。
//   - disconnect() 幂等；重复调用无副作用。
//   - onConnect/onDisconnect 不会重复触发（除显式重连）。

import { createLogger } from '@/lib/logger';

const log = createLogger('NetworkTransport');

/** 网络传输层接口。上层 NetworkSync 只依赖此接口。 */
export interface NetworkTransport {
  /** 连接到远端。Promise 在握手成功时 resolve；失败 reject。 */
  connect(url: string): Promise<void>;
  /** 主动断开。幂等。 */
  disconnect(): void;
  /** 发送数据（二进制或字符串）。未连接时忽略。 */
  send(data: ArrayBuffer | string): void;
  /** 注册消息回调（单槽，后注册覆盖先注册）。 */
  onMessage(callback: (data: ArrayBuffer | string) => void): void;
  /** 注册连接成功回调。 */
  onConnect(callback: () => void): void;
  /** 注册断开回调。 */
  onDisconnect(callback: () => void): void;
  /** 是否已连接。 */
  isConnected(): boolean;
}

// ── WebSocketTransport ─────────────────────────────────────────
/** 基于 WebSocket 的传输实现。运行时依赖全局 WebSocket（浏览器 / Node 22+）。 */
export class WebSocketTransport implements NetworkTransport {
  private ws: WebSocket | null = null;
  private msgCb: ((data: ArrayBuffer | string) => void) | null = null;
  private connectCb: (() => void) | null = null;
  private disconnectCb: (() => void) | null = null;

  connect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          log.info(`WebSocket connected: ${url}`);
          this.connectCb?.();
          resolve();
        };
        ws.onerror = (ev) => {
          log.error(`WebSocket error: ${url}`, ev);
          reject(new Error(`WebSocket error: ${url}`));
        };
        ws.onclose = () => {
          log.info(`WebSocket closed: ${url}`);
          this.ws = null;
          this.disconnectCb?.();
        };
        ws.onmessage = (ev) => {
          const data = ev.data as ArrayBuffer | string;
          this.msgCb?.(data);
        };
        this.ws = ws;
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  disconnect(): void {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch (err) {
      log.warn(`WebSocket close threw: ${(err as Error).message}`);
    }
    this.ws = null;
  }

  send(data: ArrayBuffer | string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('send called but socket not open — ignored');
      return;
    }
    this.ws.send(data);
  }

  onMessage(cb: (data: ArrayBuffer | string) => void): void { this.msgCb = cb; }
  onConnect(cb: () => void): void { this.connectCb = cb; }
  onDisconnect(cb: () => void): void { this.disconnectCb = cb; }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// ── MockTransport ──────────────────────────────────────────────
/** 本地测试用 Mock 传输。配对两个 MockTransport 即可双向通信（通过 pair()）。
 *  - send() 同步投递到对端的 onMessage 回调，模拟网络但无延迟。
 *  - connect() 立即标记为已连接并触发 onConnect。
 *  - 用于 NetworkSync 单元测试与本地双端联调。 */
export class MockTransport implements NetworkTransport {
  private paired: MockTransport | null = null;
  private msgCb: ((data: ArrayBuffer | string) => void) | null = null;
  private connectCb: (() => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private connected: boolean = false;
  /** 本 transport 的唯一标识（调试用）。 */
  readonly id: string;

  constructor(id: string = `mock-${Math.random().toString(36).slice(2, 8)}`) {
    this.id = id;
  }

  /** 将两个 MockTransport 配对，使一方的 send 会到达另一方的 onMessage。 */
  static pair(a: MockTransport, b: MockTransport): void {
    a.paired = b;
    b.paired = a;
  }

  /** 解除配对关系。 */
  static unpair(a: MockTransport, b: MockTransport): void {
    if (a.paired === b) a.paired = null;
    if (b.paired === a) b.paired = null;
  }

  async connect(url: string = 'mock://local'): Promise<void> {
    void url;
    this.connected = true;
    // 模拟异步握手（微任务）
    await Promise.resolve();
    this.connectCb?.();
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.disconnectCb?.();
  }

  send(data: ArrayBuffer | string): void {
    if (!this.connected) {
      log.warn(`MockTransport[${this.id}] send when not connected — ignored`);
      return;
    }
    if (!this.paired) {
      log.warn(`MockTransport[${this.id}] send without pair — dropped`);
      return;
    }
    // 同步投递到对端。对字符串直接传递；对 ArrayBuffer 传递同一引用（调用方勿在发送后修改）。
    this.paired.msgCb?.(data);
  }

  onMessage(cb: (data: ArrayBuffer | string) => void): void { this.msgCb = cb; }
  onConnect(cb: () => void): void { this.connectCb = cb; }
  onDisconnect(cb: () => void): void { this.disconnectCb = cb; }

  isConnected(): boolean { return this.connected; }
}
