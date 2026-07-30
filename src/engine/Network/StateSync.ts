// StateSync — 网络状态同步系统 (快照插值 + 实体同步 + Delta 压缩)。
//
// 设计原则:
//   - 与 NetworkSync 不同,本模块是纯数据层,不依赖 NetworkTransport。
//     上层负责把 packSnapshot 的结果投递到传输层,把收到数据喂给 unpackSnapshot。
//   - 服务器/客户端对称 (isServer 标记区分行为):
//     * 服务器: createSnapshot() 从 localEntities 产出权威快照; packSnapshot() 做紧凑 + Delta 压缩。
//     * 客户端: applySnapshot() 写入 remoteEntities + 推入 snapshots 缓冲; update(dt) 推进插值/外推。
//   - 实体 id 为 number (与 NetworkSync 的 string id 区分,适配不同场景)。
//   - SyncEntity 持有 position/rotation/scale/velocity/dirty/lastUpdate/properties。
//
// 插值模型 (客户端):
//   - 维护 snapshots 环形缓冲 (最多 maxSnapshots 条),按 timestamp 升序。
//   - 渲染时刻 = now - interpolationDelay,落在 [prev.ts, next.ts] 内时
//     按 t = (renderTime - prev.ts) / (next.ts - prev.ts) 插值 position/rotation/scale。
//   - 超过 next.ts 时调用 extrapolate(entity, dt) 沿 velocity 外推 (有最大外推时间限制)。
//
// Delta 压缩:
//   - packSnapshot 只打包 dirty=true 的实体 (Delta),打包后清除 dirty 标志。
//   - 紧凑格式: 实体用数值数组 [id, px,py,pz, rx,ry,rz,rw, sx,sy,sz, vx,vy,vz] (14 元素),
//     相比 JSON 对象节省键名开销 (~50%)。
//   - unpackSnapshot 还原为 StateSnapshot,调用方再 applySnapshot 合并到 remoteEntities。
//
// 不变量:
//   - snapshots 始终按 timestamp 升序 (applySnapshot 时丢弃乱序/过旧快照)。
//   - getEntity 优先返回 remoteEntities (客户端渲染读 remote); 服务器返回 localEntities。
//   - extrapolate 最多外推 maxExtrapolationTime 秒,避免丢包后无限漂移。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { clamp } from '../Math/MathUtils';

/** 同步实体: 客户端/服务器共用的网络可见状态。 */
export interface SyncEntity {
  id: number;
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
  velocity: Vector3;
  /** 脏标记: 服务器打包后清除; 客户端忽略。 */
  dirty: boolean;
  /** 最近一次更新时间戳 (与快照同基)。 */
  lastUpdate: number;
  /** 任意自定义属性 (不参与 TRS 压缩, 由调用方按需序列化)。 */
  properties: Map<string, unknown>;
}

/** 快照: 某一时刻的实体集合状态。 */
export interface StateSnapshot {
  timestamp: number;
  entities: SyncEntity[];
}

/** packSnapshot 产出的紧凑数据 (JSON 可序列化)。 */
export interface PackedSnapshotData {
  /** 快照时间戳。 */
  t: number;
  /** Delta 实体数 (仅含 dirty 实体)。 */
  n: number;
  /** 扁平数值数组, 每实体 14 元素:
   *  [id, px,py,pz, rx,ry,rz,rw, sx,sy,sz, vx,vy,vz] */
  d: number[];
}

export interface StateSyncOptions {
  /** 是否服务器端 (默认 false)。 */
  isServer?: boolean;
  /** 快照缓冲上限 (默认 20)。 */
  maxSnapshots?: number;
  /** 插值延迟 ms (默认 100)。 */
  interpolationDelay?: number;
  /** 最大外推时间 s (默认 0.2), 超过则停止外推。 */
  maxExtrapolation?: number;
  /** 时钟函数 (默认 performance.now), 便于测试注入。 */
  now?: () => number;
}

export interface StateSyncStats {
  localCount: number;
  remoteCount: number;
  snapshotCount: number;
  maxSnapshots: number;
  interpolationDelay: number;
  isServer: boolean;
}

const FLOATS_PER_ENTITY = 14;

export class StateSync {
  localEntities: Map<number, SyncEntity> = new Map();
  remoteEntities: Map<number, SyncEntity> = new Map();
  snapshots: StateSnapshot[] = [];
  maxSnapshots: number;
  interpolationDelay: number;
  isServer: boolean;
  /** 最大外推秒数。 */
  maxExtrapolation: number;

  private readonly _now: () => number;

  constructor(opts: StateSyncOptions = {}) {
    this.isServer = opts.isServer ?? false;
    this.maxSnapshots = opts.maxSnapshots ?? 20;
    this.interpolationDelay = opts.interpolationDelay ?? 100;
    this.maxExtrapolation = opts.maxExtrapolation ?? 0.2;
    this._now = opts.now ?? (() => performance.now());
  }

  // ── 实体注册 ────────────────────────────────────────────────────

  /** 注册本地实体 (服务器权威) 或远程实体 (客户端镜像)。
   *  isServer 时存入 localEntities; 否则存入 remoteEntities。 */
  registerEntity(id: number, entity: SyncEntity): void {
    if (this.isServer) {
      this.localEntities.set(id, entity);
    } else {
      this.remoteEntities.set(id, entity);
    }
  }

  /** 注销实体 (两个表都清理, 便于角色切换)。 */
  unregisterEntity(id: number): void {
    this.localEntities.delete(id);
    this.remoteEntities.delete(id);
  }

  /** 获取实体: 客户端优先 remoteEntities, 服务器优先 localEntities。 */
  getEntity(id: number): SyncEntity | undefined {
    if (this.isServer) {
      return this.localEntities.get(id) ?? this.remoteEntities.get(id);
    }
    return this.remoteEntities.get(id) ?? this.localEntities.get(id);
  }

  /** 获取所有实体 (客户端=remote, 服务器=local)。 */
  getEntities(): SyncEntity[] {
    const map = this.isServer ? this.localEntities : this.remoteEntities;
    return Array.from(map.values());
  }

  /** 获取实体数。 */
  getEntityCount(): number {
    return (this.isServer ? this.localEntities : this.remoteEntities).size;
  }

  // ── 快照创建/应用 ───────────────────────────────────────────────

  /** 服务器: 从 localEntities 创建快照。timestamp 默认 now()。 */
  createSnapshot(timestamp?: number): StateSnapshot {
    const ts = timestamp ?? this._now();
    const entities: SyncEntity[] = [];
    for (const e of this.localEntities.values()) {
      // 快照内是 TRS 的克隆, 避免后续本地修改污染快照
      entities.push({
        id: e.id,
        position: e.position.clone(),
        rotation: e.rotation.clone(),
        scale: e.scale.clone(),
        velocity: e.velocity.clone(),
        dirty: e.dirty,
        lastUpdate: ts,
        properties: e.properties,
      });
    }
    return { timestamp: ts, entities };
  }

  /** 客户端: 应用远程快照 — 更新 remoteEntities + 推入 snapshots 缓冲。 */
  applySnapshot(snapshot: StateSnapshot): void {
    // 更新 remoteEntities 权威值
    for (const se of snapshot.entities) {
      let e = this.remoteEntities.get(se.id);
      if (!e) {
        // 首次见到: 创建并注册
        e = {
          id: se.id,
          position: se.position.clone(),
          rotation: se.rotation.clone(),
          scale: se.scale.clone(),
          velocity: se.velocity.clone(),
          dirty: false,
          lastUpdate: snapshot.timestamp,
          properties: new Map(se.properties),
        };
        this.remoteEntities.set(se.id, e);
        continue;
      }
      e.position.copy(se.position);
      e.rotation.copy(se.rotation);
      e.scale.copy(se.scale);
      e.velocity.copy(se.velocity);
      e.lastUpdate = snapshot.timestamp;
      // properties 合并 (远端覆盖)
      if (se.properties && se.properties.size > 0) {
        for (const [k, v] of se.properties) {
          e.properties.set(k, v);
        }
      }
    }

    // 推入 snapshots 缓冲 (保持升序, 丢弃过旧)
    this._pushSnapshot({ timestamp: snapshot.timestamp, entities: snapshot.entities });
  }

  /** 推入快照到缓冲, 保持 timestamp 升序, 超容量丢弃最旧。 */
  private _pushSnapshot(snap: StateSnapshot): void {
    // 丢弃比当前最新更旧的 (乱序包)
    if (this.snapshots.length > 0 && snap.timestamp < this.snapshots[this.snapshots.length - 1].timestamp) {
      return;
    }
    this.snapshots.push(snap);
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  // ── 每帧更新 ────────────────────────────────────────────────────

  /** 每帧推进: 客户端做插值/外推; 服务器通常不调用 (仅创建快照)。 */
  update(dt: number): void {
    if (this.isServer) return;
    const now = this._now();
    this.interpolate(now);
    void dt;
  }

  /** 快照插值: 基于 now - interpolationDelay 在 snapshots 中找 prev/next, 插值 remoteEntities。 */
  interpolate(currentTime: number): void {
    if (this.snapshots.length === 0) return;
    const renderTime = currentTime - this.interpolationDelay;

    // 只有 1 个快照: 对齐 + 外推 (renderTime 晚于快照时)
    if (this.snapshots.length === 1) {
      const only = this.snapshots[0];
      const dtSec = renderTime > only.timestamp
        ? clamp((renderTime - only.timestamp) / 1000, 0, this.maxExtrapolation)
        : 0;
      for (const se of only.entities) {
        const e = this.remoteEntities.get(se.id);
        if (e) {
          e.position.copy(se.position);
          e.rotation.copy(se.rotation);
          e.scale.copy(se.scale);
          e.velocity.copy(se.velocity);
          if (dtSec > 0) this.extrapolate(e, dtSec);
        }
      }
      return;
    }

    // 找包围 renderTime 的 prev/next
    let prev: StateSnapshot | null = null;
    let next: StateSnapshot | null = null;
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const a = this.snapshots[i];
      const b = this.snapshots[i + 1];
      if (a.timestamp <= renderTime && renderTime <= b.timestamp) {
        prev = a;
        next = b;
        break;
      }
    }

    if (prev && next) {
      const span = next.timestamp - prev.timestamp;
      const t = span <= 0 ? 1 : clamp((renderTime - prev.timestamp) / span, 0, 1);
      this._lerpSnapshots(prev, next, t);
      return;
    }

    // renderTime 早于最早快照: 对齐到最早
    if (renderTime < this.snapshots[0].timestamp) {
      const first = this.snapshots[0];
      for (const se of first.entities) {
        const e = this.remoteEntities.get(se.id);
        if (e) {
          e.position.copy(se.position);
          e.rotation.copy(se.rotation);
          e.scale.copy(se.scale);
        }
      }
      return;
    }

    // renderTime 晚于最新快照: 外推
    const latest = this.snapshots[this.snapshots.length - 1];
    const dtSec = clamp((renderTime - latest.timestamp) / 1000, 0, this.maxExtrapolation);
    for (const se of latest.entities) {
      const e = this.remoteEntities.get(se.id);
      if (e) {
        // 先对齐到最新权威值, 再外推
        e.position.copy(se.position);
        e.rotation.copy(se.rotation);
        e.scale.copy(se.scale);
        e.velocity.copy(se.velocity);
        this.extrapolate(e, dtSec);
      }
    }
  }

  /** 在 prev/next 间按 t 插值, 写回 remoteEntities。 */
  private _lerpSnapshots(prev: StateSnapshot, next: StateSnapshot, t: number): void {
    // 构建 next 的 id → entity 查找
    const nextMap = new Map<number, SyncEntity>();
    for (const se of next.entities) nextMap.set(se.id, se);

    for (const pe of prev.entities) {
      const ne = nextMap.get(pe.id);
      const e = this.remoteEntities.get(pe.id);
      if (!e || !ne) continue;
      e.position.lerpVectors(pe.position, ne.position, t);
      // 旋转 slerp: 用 prev.clone().slerp(next, t)
      const rot = pe.rotation.clone().slerp(ne.rotation, t);
      e.rotation.copy(rot);
      e.scale.lerpVectors(pe.scale, ne.scale, t);
      // velocity 也插值 (供 extrapolate 用)
      e.velocity.lerpVectors(pe.velocity, ne.velocity, t);
    }
  }

  /** 外推: 沿 velocity 推进 entity.position (就地修改)。dt 已 clamp 到 maxExtrapolation。 */
  extrapolate(entity: SyncEntity, dt: number): void {
    const t = clamp(dt, 0, this.maxExtrapolation);
    entity.position.x += entity.velocity.x * t;
    entity.position.y += entity.velocity.y * t;
    entity.position.z += entity.velocity.z * t;
  }

  /** 设置插值延迟 (ms)。 */
  setInterpolationDelay(delay: number): void {
    this.interpolationDelay = Math.max(0, delay);
  }

  // ── Delta 压缩 ──────────────────────────────────────────────────

  /** 打包快照 (Delta + 紧凑): 只含 dirty 实体, 打包后清 dirty。
   *  返回 JSON 可序列化的紧凑结构 (数值数组, 每实体 14 元素)。 */
  packSnapshot(snapshot: StateSnapshot): PackedSnapshotData {
    const data: number[] = [];
    let count = 0;
    for (const e of snapshot.entities) {
      if (!e.dirty) continue;
      data.push(
        e.id,
        e.position.x, e.position.y, e.position.z,
        e.rotation.x, e.rotation.y, e.rotation.z, e.rotation.w,
        e.scale.x, e.scale.y, e.scale.z,
        e.velocity.x, e.velocity.y, e.velocity.z,
      );
      count++;
      e.dirty = false; // Delta: 打包后清除 (快照克隆)
      // 同步清除源实体 (localEntities) 的 dirty, 下次 createSnapshot 不会再打包
      const src = this.localEntities.get(e.id);
      if (src) src.dirty = false;
    }
    return { t: snapshot.timestamp, n: count, d: data };
  }

  /** 解包紧凑数据为快照 (含 PackedSnapshotData 中的实体)。
   *  与 packSnapshot 互逆; 调用方再 applySnapshot 合并到 remoteEntities。 */
  unpackSnapshot(data: PackedSnapshotData): StateSnapshot {
    const entities: SyncEntity[] = [];
    const d = data.d;
    for (let i = 0; i < data.n; i++) {
      const o = i * FLOATS_PER_ENTITY;
      entities.push({
        id: d[o + 0],
        position: new Vector3(d[o + 1], d[o + 2], d[o + 3]),
        rotation: new Quaternion(d[o + 4], d[o + 5], d[o + 6], d[o + 7]),
        scale: new Vector3(d[o + 8], d[o + 9], d[o + 10]),
        velocity: new Vector3(d[o + 11], d[o + 12], d[o + 13]),
        dirty: false,
        lastUpdate: data.t,
        properties: new Map(),
      });
    }
    return { timestamp: data.t, entities };
  }

  // ── 统计 ────────────────────────────────────────────────────────

  getStats(): StateSyncStats {
    return {
      localCount: this.localEntities.size,
      remoteCount: this.remoteEntities.size,
      snapshotCount: this.snapshots.length,
      maxSnapshots: this.maxSnapshots,
      interpolationDelay: this.interpolationDelay,
      isServer: this.isServer,
    };
  }
}

/** 工厂: 创建一个 SyncEntity。 */
export function createSyncEntity(
  id: number,
  position: Vector3 = new Vector3(),
  rotation: Quaternion = new Quaternion(),
  scale: Vector3 = new Vector3(1, 1, 1),
  velocity: Vector3 = new Vector3(),
): SyncEntity {
  return {
    id,
    position: position.clone(),
    rotation: rotation.clone(),
    scale: scale.clone(),
    velocity: velocity.clone(),
    dirty: true,
    lastUpdate: 0,
    properties: new Map(),
  };
}
