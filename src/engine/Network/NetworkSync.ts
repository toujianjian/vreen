// NetworkSync — 网络同步管理器。
//
// 设计原则：
//   - 上层只依赖 NetworkTransport 抽象，与具体传输（WebSocket / Mock）解耦。
//   - 服务器 / 客户端对称（isServer 标记区分行为）。
//   - 服务器（权威）：按 syncRate 周期广播 Snapshot；忽略收到的快照。
//   - 客户端：接收 Snapshot 写入 entities；按 interpolationDelay 延迟渲染并插值。
//   - 同步实体需注册：registerEntity(id, NetworkEntity)。
//
// 插值模型（客户端）：
//   - 维护每实体 prev/next 两个快照（含 timestamp）。
//   - 渲染时刻 = now - interpolationDelay，落在 [prev.ts, next.ts] 内时
//     按 t = (renderTime - prev.ts) / (next.ts - prev.ts) 插值。
//   - 超过 next.ts 时 clamp 到 next（停止外推；如需外推用 NetworkLerp.predict）。
//
// 不变量：
//   - sendSnapshot 未连接时静默跳过。
//   - receiveSnapshot 解析失败时记 warn 并丢弃该包（不影响已有状态）。
//   - 插值缓冲为空（首次收到包前）时 interpolated* 直接对齐 position/rotation。

import { createLogger } from '@/lib/logger';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import type { NetworkTransport } from './NetworkTransport';
import { Snapshot, type SnapshotEntity } from './Snapshot';
import { NetworkLerp } from './NetworkLerp';

const log = createLogger('NetworkSync');

/** 网络同步实体。由调用方持有场景引用（position/rotation 即场景节点 TRS），
 *  NetworkSync 每帧把插值结果写回 interpolatedPosition/interpolatedRotation 供渲染层读取。 */
export interface NetworkEntity {
  id: string;
  ownerId: string;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  /** 最近一次收到服务器更新时间戳（与 Snapshot.timestamp 同基）。 */
  lastUpdate: number;
  /** 插值后的渲染位置（渲染层读取）。 */
  interpolatedPosition: Vector3;
  /** 插值后的渲染旋转（渲染层读取）。 */
  interpolatedRotation: Quaternion;
}

export interface NetworkSyncOptions {
  /** 同步频率 Hz（服务器发送频率，默认 20）。 */
  syncRate?: number;
  /** 是否启用客户端插值（默认 true）。 */
  interpolation?: boolean;
  /** 插值延迟 ms（默认 100）。 */
  interpolationDelay?: number;
  /** 时钟函数（默认 performance.now），便于测试注入。 */
  now?: () => number;
}

/** 内部：每实体快照缓冲（用于插值）。 */
interface EntitySnap {
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  timestamp: number;
}
interface EntitySnapBuffer {
  prev: EntitySnap;
  next: EntitySnap | null;
}

/** 创建一个 NetworkEntity（初始化所有字段，包括插值缓冲副本）。 */
export function createNetworkEntity(
  id: string,
  ownerId: string,
  position: Vector3 = new Vector3(),
  rotation: Quaternion = new Quaternion(),
  velocity: Vector3 = new Vector3(),
): NetworkEntity {
  return {
    id,
    ownerId,
    position: position.clone(),
    rotation: rotation.clone(),
    velocity: velocity.clone(),
    lastUpdate: 0,
    interpolatedPosition: position.clone(),
    interpolatedRotation: rotation.clone(),
  };
}

export class NetworkSync {
  transport: NetworkTransport | null = null;
  isServer: boolean = false;
  readonly clientId: string;
  entities: Map<string, NetworkEntity> = new Map();
  syncRate: number;
  interpolation: boolean;
  interpolationDelay: number;

  private _running: boolean = false;
  private _accSyncTime: number = 0;
  private _sequence: number = 0;
  private readonly _now: () => number;
  /** 每实体的快照缓冲（prev/next），用于插值。 */
  private _snapBuffer: Map<string, EntitySnapBuffer> = new Map();

  constructor(opts: NetworkSyncOptions = {}) {
    this.clientId = `client-${Math.random().toString(36).slice(2, 10)}`;
    this.syncRate = opts.syncRate ?? 20;
    this.interpolation = opts.interpolation ?? true;
    this.interpolationDelay = opts.interpolationDelay ?? 100;
    this._now = opts.now ?? (() => performance.now());
  }

  /** 启动同步。 */
  start(transport: NetworkTransport, isServer: boolean): void {
    this.transport = transport;
    this.isServer = isServer;
    this._running = true;
    this._accSyncTime = 0;
    this._sequence = 0;
    transport.onMessage((data) => this._onData(data));
    transport.onDisconnect(() => {
      log.info(`Transport disconnected (isServer=${isServer}, clientId=${this.clientId})`);
    });
    log.info(`NetworkSync started (isServer=${isServer}, clientId=${this.clientId}, syncRate=${this.syncRate}Hz)`);
  }

  /** 停止同步（不解绑 entities，便于重启）。 */
  stop(): void {
    this._running = false;
    this.transport = null;
    log.info(`NetworkSync stopped (clientId=${this.clientId})`);
  }

  /** 注册网络实体。同 id 重复注册会覆盖。 */
  registerEntity(id: string, entity: NetworkEntity): void {
    this.entities.set(id, entity);
    log.debug(`registerEntity: ${id} (owner=${entity.ownerId})`);
  }

  /** 注销实体。 */
  unregisterEntity(id: string): void {
    if (this.entities.delete(id)) {
      this._snapBuffer.delete(id);
      log.debug(`unregisterEntity: ${id}`);
    }
  }

  /** 每帧更新：服务器按 syncRate 发送；客户端做插值。 */
  update(dt: number): void {
    if (!this._running) return;

    if (this.isServer) {
      this._accSyncTime += dt;
      const interval = 1 / this.syncRate;
      // while 循环消化累积时间，避免低帧率下漏发。
      let guard = 0;
      while (this._accSyncTime >= interval && guard < 8) {
        this._accSyncTime -= interval;
        this.sendSnapshot();
        guard++;
      }
      if (guard >= 8) {
        // 帧率严重过低，重置累加器避免雪崩。
        this._accSyncTime = 0;
      }
    }

    if (this.interpolation && !this.isServer) {
      this.interpolate(dt);
    }
  }

  /** 服务器：把所有实体打包成快照并发送。 */
  sendSnapshot(): void {
    if (!this.transport || !this.transport.isConnected()) return;
    const entities: SnapshotEntity[] = [];
    const now = this._now();
    for (const e of this.entities.values()) {
      entities.push({
        id: e.id,
        ownerId: e.ownerId,
        position: e.position.clone(),
        rotation: e.rotation.clone(),
        velocity: e.velocity.clone(),
      });
    }
    const snap = new Snapshot({
      entities,
      timestamp: now,
      sequence: this._sequence++,
    });
    const buf = snap.serialize();
    this.transport.send(buf);
  }

  /** 客户端：收到二进制/字符串数据，解析为 Snapshot 并应用。 */
  receiveSnapshot(data: ArrayBuffer | string): void {
    let buf: ArrayBuffer;
    if (typeof data === 'string') {
      buf = new TextEncoder().encode(data).buffer as ArrayBuffer;
    } else {
      buf = data;
    }
    let snap: Snapshot;
    try {
      snap = Snapshot.deserialize(buf);
    } catch (err) {
      log.warn(`Failed to deserialize snapshot: ${(err as Error).message}`);
      return;
    }
    this._applySnapshot(snap);
  }

  /** 客户端：基于 prev/next 推进插值，写回 interpolatedPosition/Rotation。
   *  dt 保留以匹配接口契约；插值基于 wall clock（this._now），不直接消费 dt。 */
  interpolate(dt: number): void {
    void dt;
    const renderTime = this._now() - this.interpolationDelay;
    for (const e of this.entities.values()) {
      const buf = this._snapBuffer.get(e.id);
      if (!buf || !buf.next) {
        // 还没有两个快照，直接对齐当前权威值。
        e.interpolatedPosition.copy(e.position);
        e.interpolatedRotation.copy(e.rotation);
        continue;
      }
      const span = buf.next.timestamp - buf.prev.timestamp;
      let t: number;
      if (span <= 0) {
        t = 1;
      } else {
        t = (renderTime - buf.prev.timestamp) / span;
      }
      const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
      const pos = NetworkLerp.lerpPosition(buf.prev.position, buf.next.position, clamped);
      const rot = NetworkLerp.lerpRotation(buf.prev.rotation, buf.next.rotation, clamped);
      e.interpolatedPosition.copy(pos);
      e.interpolatedRotation.copy(rot);
    }
  }

  // ── 内部 ───────────────────────────────────────────────────────
  /** 应用 Snapshot：更新权威 position/rotation/velocity + 推进插值缓冲。 */
  private _applySnapshot(snap: Snapshot): void {
    for (const se of snap.entities) {
      const e = this.entities.get(se.id);
      if (!e) continue;
      const cur: EntitySnap = {
        position: se.position.clone(),
        rotation: se.rotation.clone(),
        velocity: se.velocity.clone(),
        timestamp: snap.timestamp,
      };
      const buf = this._snapBuffer.get(se.id);
      if (!buf) {
        // 首次：prev = cur（让下一次能开始插值），next 暂空。
        this._snapBuffer.set(se.id, { prev: cur, next: null });
      } else if (buf.next === null) {
        // 第二次：保留 prev（首个快照），填入 next。此时插值缓冲就绪。
        buf.next = cur;
      } else {
        // 后续：滑动窗口 prev ← next，next ← cur。
        buf.prev = buf.next;
        buf.next = cur;
      }
      e.position.copy(se.position);
      e.rotation.copy(se.rotation);
      e.velocity.copy(se.velocity);
      e.lastUpdate = snap.timestamp;
    }
  }

  /** transport.onMessage 回调：服务器忽略（权威模型，不收客户端快照）；客户端接收。 */
  private _onData(data: ArrayBuffer | string): void {
    if (this.isServer) return;
    this.receiveSnapshot(data);
  }
}
