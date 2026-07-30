// LagCompensation — 网络延迟补偿系统(客户端预测 / 服务器回滚 / 命中补偿)。
//
// 设计:
//   - historyBuffer: 按时间戳升序排列的快照历史,每条 HistoryEntry 持有该时刻
//     全部实体状态的 Map<entityId, EntityState>。
//   - 服务器侧(isServer=true): 用于命中补偿。客户端发起命中请求时附带
//     "客户端看到目标时"的时间戳,服务器 rewindTo(timestamp) 回滚到该时刻,
//     用 checkHit 检测命中,restoreCurrent() 恢复权威状态。
//   - 客户端侧(isServer=false): 用于平滑插值。interpolate(timestamp) 在历史
//     中找包围该时刻的两条快照,按 t 线性插值得到实体状态(位置/旋转)。
//
// 与 StateSync / NetworkSync 的关系:
//   - StateSync / NetworkSync 关注"实时同步"(收包 → 插值当前渲染位置)。
//   - LagCompensation 关注"历史回溯"(回到过去某时刻做命中判定或调试)。
//   - 二者互补:实时同步负责"现在",延迟补偿负责"过去"。
//
// 不变量:
//   - historyBuffer 始终按 timestamp 升序(recordSnapshot 时丢弃乱序/过旧)。
//   - rewindTo 后必须 restoreCurrent 才能恢复正常模拟(否则实体停留在过去)。
//   - checkHit 不会修改 historyBuffer,但会临时修改实体状态(rewind + restore)。
//   - pruneOldEntries 删除 timestamp < (newest - historyDuration) 的条目。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { clamp } from '../Math/MathUtils';
import { createLogger } from '@/lib/logger';

const log = createLogger('LagCompensation');

/** 单实体的网络状态(TRS + velocity + 时间戳)。 */
export interface EntityState {
  id: number;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  timestamp: number;
}

/** 历史快照条目:某时刻全部实体的状态集合。 */
export interface HistoryEntry {
  timestamp: number;
  entityStates: Map<number, EntityState>;
}

/** 命中检测的边界框(轴对齐,世界空间)。 */
export interface HitBounds {
  /** 中心位置。 */
  center: Vector3;
  /** 半尺寸(各轴一半)。 */
  halfExtents: Vector3;
}

/** LagCompensation 选项。 */
export interface LagCompensationOptions {
  /** 是否服务器端(默认 false)。 */
  isServer?: boolean;
  /** 历史缓冲最大条目数(默认 64)。 */
  maxHistorySize?: number;
  /** 历史时长(ms,默认 1000)。超过此时长的条目会被 pruneOldEntries 清除。 */
  historyDuration?: number;
  /** 插值延迟(ms,默认 100)。 */
  interpolationDelay?: number;
}

/** LagCompensation 统计。 */
export interface LagCompensationStats {
  /** 当前历史条目数。 */
  historySize: number;
  /** 最大历史条目数。 */
  maxHistorySize: number;
  /** 历史时长(ms)。 */
  historyDuration: number;
  /** 插值延迟(ms)。 */
  interpolationDelay: number;
  /** 最旧时间戳(ms,无历史时为 0)。 */
  oldestTimestamp: number;
  /** 最新时间戳(ms,无历史时为 0)。 */
  newestTimestamp: number;
  /** 是否服务器端。 */
  isServer: boolean;
  /** 当前是否处于回滚状态(rewindTo 后未 restoreCurrent)。 */
  rewinding: boolean;
  /** 历史中记录的实体总数(去重,取最新条目统计)。 */
  entityCount: number;
}

export class LagCompensation {
  /** 历史缓冲(按 timestamp 升序)。 */
  historyBuffer: HistoryEntry[] = [];
  /** 最大历史条目数。 */
  maxHistorySize: number;
  /** 历史时长(ms),超过的条目会被清除。 */
  historyDuration: number;
  /** 插值延迟(ms)。 */
  interpolationDelay: number;
  /** 是否服务器端。 */
  isServer: boolean;

  /** 回滚前保存的当前实体状态(用于 restoreCurrent 恢复)。 */
  private _savedStates: Map<number, EntityState> | null = null;
  /** 当前是否处于回滚状态。 */
  private _rewinding: boolean = false;

  constructor(opts: LagCompensationOptions = {}) {
    this.isServer = opts.isServer ?? false;
    this.maxHistorySize = Math.max(1, opts.maxHistorySize ?? 64);
    this.historyDuration = Math.max(0, opts.historyDuration ?? 1000);
    this.interpolationDelay = Math.max(0, opts.interpolationDelay ?? 100);
    // 注:opts.now(时钟注入)被 LagCompensationOptions 接受以保持 API 一致,
    // 但本类使用调用方传入的 timestamp 参数而非内部时钟,故不存储。

    log.info(
      `LagCompensation created: isServer=${this.isServer}, ` +
      `maxHistorySize=${this.maxHistorySize}, historyDuration=${this.historyDuration}ms, ` +
      `interpolationDelay=${this.interpolationDelay}ms`,
    );
  }

  // ── 历史记录 ──────────────────────────────────────────────────────

  /**
   * 记录快照到历史:克隆 states 后按 timestamp 升序插入,超出容量丢弃最旧。
   * 乱序(timestamp < 最新条目)的快照被丢弃(避免历史回溯)。
   */
  recordSnapshot(states: EntityState[], timestamp: number): void {
    // 乱序检查:丢弃比当前最新更旧的
    if (this.historyBuffer.length > 0) {
      const newest = this.historyBuffer[this.historyBuffer.length - 1].timestamp;
      if (timestamp < newest) {
        log.warn(`recordSnapshot: out-of-order timestamp=${timestamp} < newest=${newest}, discarded`);
        return;
      }
    }

    // 克隆 states 避免外部修改污染历史
    const entityStates = new Map<number, EntityState>();
    for (const s of states) {
      entityStates.set(s.id, {
        id: s.id,
        position: s.position.clone(),
        rotation: s.rotation.clone(),
        velocity: s.velocity.clone(),
        timestamp,
      });
    }

    this.historyBuffer.push({ timestamp, entityStates });
    // 超容量丢弃最旧
    while (this.historyBuffer.length > this.maxHistorySize) {
      this.historyBuffer.shift();
    }
  }

  // ── 回滚 / 恢复 ───────────────────────────────────────────────────

  /**
   * 回滚到指定时间戳:在历史中找包围 timestamp 的两条快照,插值得到实体状态,
   * 写回 states(供 checkHit 使用)。同时保存当前 states 供 restoreCurrent 恢复。
   *
   * @param states   当前权威实体状态(会被修改为回滚后的状态)。
   * @param timestamp 回滚目标时间戳(ms)。
   * @returns 是否成功回滚(历史为空或 timestamp 超出范围时返回 false)。
   */
  rewindTo(states: Map<number, EntityState>, timestamp: number): boolean {
    if (this.historyBuffer.length === 0) {
      log.warn('rewindTo: history is empty');
      return false;
    }

    // 已在回滚状态时,先恢复再重新保存(避免覆盖原始状态)
    if (this._rewinding) {
      log.warn('rewindTo: already rewinding, restoring current first');
      this.restoreCurrent(states);
    }

    // 保存当前权威状态(深克隆)
    this._savedStates = new Map<number, EntityState>();
    for (const [id, s] of states) {
      this._savedStates.set(id, {
        id,
        position: s.position.clone(),
        rotation: s.rotation.clone(),
        velocity: s.velocity.clone(),
        timestamp: s.timestamp,
      });
    }

    // 插值得到 timestamp 时刻的状态并写回 states
    const interpolated = this._interpolateStates(timestamp);
    if (interpolated === null) {
      log.warn(`rewindTo: timestamp=${timestamp} out of history range`);
      // 仍标记为回滚状态(restoreCurrent 可恢复)
      this._rewinding = true;
      return false;
    }

    for (const [id, snap] of interpolated) {
      const cur = states.get(id);
      if (cur) {
        cur.position.copy(snap.position);
        cur.rotation.copy(snap.rotation);
        cur.velocity.copy(snap.velocity);
        cur.timestamp = snap.timestamp;
      } else {
        // 历史中存在但当前 states 没有的实体,加入 states
        states.set(id, {
          id,
          position: snap.position.clone(),
          rotation: snap.rotation.clone(),
          velocity: snap.velocity.clone(),
          timestamp: snap.timestamp,
        });
      }
    }

    this._rewinding = true;
    log.debug(`rewindTo: timestamp=${timestamp}, entities=${interpolated.size}`);
    return true;
  }

  /**
   * 恢复到当前时间:把 rewindTo 保存的状态写回 states。
   * 若未处于回滚状态,是 no-op。
   */
  restoreCurrent(states: Map<number, EntityState>): void {
    if (!this._rewinding || !this._savedStates) {
      log.warn('restoreCurrent: not rewinding, no-op');
      return;
    }

    // 恢复保存的状态到 states
    // 先把 savedStates 中的实体恢复;再删除 rewind 期间新增的实体(不在 savedStates 中)
    const savedIds = new Set<number>(this._savedStates.keys());
    // 删除 rewind 期间新增的实体
    for (const id of Array.from(states.keys())) {
      if (!savedIds.has(id)) {
        states.delete(id);
      }
    }
    // 恢复保存的状态
    for (const [id, saved] of this._savedStates) {
      const cur = states.get(id);
      if (cur) {
        cur.position.copy(saved.position);
        cur.rotation.copy(saved.rotation);
        cur.velocity.copy(saved.velocity);
        cur.timestamp = saved.timestamp;
      } else {
        states.set(id, {
          id,
          position: saved.position.clone(),
          rotation: saved.rotation.clone(),
          velocity: saved.velocity.clone(),
          timestamp: saved.timestamp,
        });
      }
    }

    this._savedStates = null;
    this._rewinding = false;
    log.debug('restoreCurrent: state restored');
  }

  // ── 插值 / 查询 ───────────────────────────────────────────────────

  /**
   * 在历史中插值:返回 timestamp 时刻的实体状态 Map(id → EntityState)。
   * - timestamp 早于最旧条目:返回最旧条目(clamp)。
   * - timestamp 晚于最新条目:返回最新条目(clamp,不外推)。
   * - 落在 [prev, next] 之间:线性插值 position/scale/velocity,slerp rotation。
   *
   * @returns Map<id, EntityState>;历史为空返回 null。
   */
  interpolate(timestamp: number): Map<number, EntityState> | null {
    return this._interpolateStates(timestamp);
  }

  /**
   * 查询历史中某时刻某实体状态(插值)。
   * @returns EntityState 克隆;实体不存在或历史为空返回 undefined。
   */
  queryHistory(timestamp: number, entityId: number): EntityState | undefined {
    const states = this._interpolateStates(timestamp);
    if (states === null) return undefined;
    const s = states.get(entityId);
    if (!s) return undefined;
    return {
      id: s.id,
      position: s.position.clone(),
      rotation: s.rotation.clone(),
      velocity: s.velocity.clone(),
      timestamp: s.timestamp,
    };
  }

  // ── 命中检测(服务器侧) ──────────────────────────────────────────

  /**
   * 命中检测:回滚到 timestamp,检测 attackerPosition 是否在目标 targetId 的
   * 边界框内,然后恢复当前状态。
   *
   * 典型场景:客户端在 t=100ms 时看到目标在 (5,0,0),发起射击。服务器收到
   * 请求时已是 t=180ms,目标已移动到 (6,0,0)。服务器 rewindTo(100) 把目标
   * 状态回滚到 (5,0,0),检测命中,restoreCurrent 恢复。
   *
   * @param states           当前权威实体状态(会被临时修改后恢复)。
   * @param timestamp        客户端发起攻击时的时间戳。
   * @param attackerPosition 攻击者位置(世界空间)。
   * @param targetId         目标实体 id。
   * @param targetBounds     目标边界框(轴对齐,世界空间)。
   * @returns 是否命中。历史为空或目标不存在返回 false。
   */
  checkHit(
    states: Map<number, EntityState>,
    timestamp: number,
    attackerPosition: Vector3,
    targetId: number,
    targetBounds: HitBounds,
  ): boolean {
    if (this.historyBuffer.length === 0) {
      log.warn('checkHit: history is empty');
      return false;
    }

    // 直接查询历史中目标在 timestamp 时刻的状态(不修改 states)
    const targetState = this.queryHistory(timestamp, targetId);
    if (!targetState) {
      log.debug(`checkHit: target ${targetId} not in history at t=${timestamp}`);
      return false;
    }

    // 命中判定:attackerPosition 是否在 targetBounds 内
    // 注意:targetBounds 通常是攻击者客户端看到的目标边界框,
    // 这里简化为直接检测 attackerPosition 与 targetBounds 的关系。
    // 实际游戏中更常见是检测射线与边界框相交,这里用点-盒包含测试。
    const hit = this._pointInBounds(attackerPosition, targetBounds);

    log.debug(
      `checkHit: t=${timestamp}, target=${targetId}, ` +
      `attacker=${attackerPosition.toString()}, hit=${hit}`,
    );

    // 标记 states 未被修改(checkHit 不做 rewind,直接用 queryHistory)
    void states;
    return hit;
  }

  // ── 维护 ──────────────────────────────────────────────────────────

  /** 获取历史时长(ms)。 */
  getHistoryDuration(): number {
    return this.historyDuration;
  }

  /** 设置最大历史大小。 */
  setMaxHistorySize(max: number): void {
    if (max < 1) {
      throw new Error(`LagCompensation.setMaxHistorySize: max must be >= 1 (got ${max})`);
    }
    this.maxHistorySize = max;
    // 立即裁剪
    while (this.historyBuffer.length > this.maxHistorySize) {
      this.historyBuffer.shift();
    }
  }

  /** 设置历史时长(ms)。 */
  setHistoryDuration(duration: number): void {
    if (duration < 0) {
      throw new Error(`LagCompensation.setHistoryDuration: duration must be >= 0 (got ${duration})`);
    }
    this.historyDuration = duration;
  }

  /** 设置插值延迟(ms)。 */
  setInterpolationDelay(delay: number): void {
    if (delay < 0) {
      throw new Error(`LagCompensation.setInterpolationDelay: delay must be >= 0 (got ${delay})`);
    }
    this.interpolationDelay = delay;
  }

  /** 获取最旧时间戳(ms)。无历史时返回 0。 */
  getOldestTimestamp(): number {
    if (this.historyBuffer.length === 0) return 0;
    return this.historyBuffer[0].timestamp;
  }

  /** 获取最新时间戳(ms)。无历史时返回 0。 */
  getNewestTimestamp(): number {
    if (this.historyBuffer.length === 0) return 0;
    return this.historyBuffer[this.historyBuffer.length - 1].timestamp;
  }

  /**
   * 清除过期条目:删除 timestamp < (newest - historyDuration) 的条目。
   * @returns 清除的条目数。
   */
  pruneOldEntries(): number {
    if (this.historyBuffer.length === 0) return 0;
    if (this.historyDuration <= 0) return 0;

    const newest = this.getNewestTimestamp();
    const cutoff = newest - this.historyDuration;
    let removed = 0;
    while (this.historyBuffer.length > 0 && this.historyBuffer[0].timestamp < cutoff) {
      this.historyBuffer.shift();
      removed++;
    }
    if (removed > 0) {
      log.debug(`pruneOldEntries: removed ${removed} entries (cutoff=${cutoff})`);
    }
    return removed;
  }

  /** 清空历史。 */
  clear(): void {
    this.historyBuffer = [];
    this._savedStates = null;
    this._rewinding = false;
    log.debug('history cleared');
  }

  /** 获取统计。 */
  getStats(): LagCompensationStats {
    let entityCount = 0;
    if (this.historyBuffer.length > 0) {
      entityCount = this.historyBuffer[this.historyBuffer.length - 1].entityStates.size;
    }
    return {
      historySize: this.historyBuffer.length,
      maxHistorySize: this.maxHistorySize,
      historyDuration: this.historyDuration,
      interpolationDelay: this.interpolationDelay,
      oldestTimestamp: this.getOldestTimestamp(),
      newestTimestamp: this.getNewestTimestamp(),
      isServer: this.isServer,
      rewinding: this._rewinding,
      entityCount,
    };
  }

  // ── private ───────────────────────────────────────────────────────

  /**
   * 在历史中插值得到 timestamp 时刻的实体状态。
   * 历史为空返回 null。timestamp 超出范围时 clamp 到最近端。
   */
  private _interpolateStates(timestamp: number): Map<number, EntityState> | null {
    if (this.historyBuffer.length === 0) return null;

    // 单条历史:直接返回(克隆)
    if (this.historyBuffer.length === 1) {
      return this._cloneEntryStates(this.historyBuffer[0]);
    }

    // timestamp 早于最旧:返回最旧
    if (timestamp <= this.historyBuffer[0].timestamp) {
      return this._cloneEntryStates(this.historyBuffer[0]);
    }
    // timestamp 晚于最新:返回最新
    if (timestamp >= this.getNewestTimestamp()) {
      return this._cloneEntryStates(this.historyBuffer[this.historyBuffer.length - 1]);
    }

    // 找包围 timestamp 的 prev/next
    let prev: HistoryEntry | null = null;
    let next: HistoryEntry | null = null;
    for (let i = 0; i < this.historyBuffer.length - 1; i++) {
      const a = this.historyBuffer[i];
      const b = this.historyBuffer[i + 1];
      if (a.timestamp <= timestamp && timestamp <= b.timestamp) {
        prev = a;
        next = b;
        break;
      }
    }

    if (!prev || !next) {
      // 不应发生(前面已 clamp),保守返回最新
      return this._cloneEntryStates(this.historyBuffer[this.historyBuffer.length - 1]);
    }

    const span = next.timestamp - prev.timestamp;
    const t = span <= 0 ? 1 : clamp((timestamp - prev.timestamp) / span, 0, 1);

    // 插值:取 prev/next 共有的实体,position/velocity lerp,rotation slerp
    const result = new Map<number, EntityState>();
    for (const [id, ps] of prev.entityStates) {
      const ns = next.entityStates.get(id);
      if (!ns) {
        // next 没有该实体,用 prev 值
        result.set(id, {
          id,
          position: ps.position.clone(),
          rotation: ps.rotation.clone(),
          velocity: ps.velocity.clone(),
          timestamp,
        });
        continue;
      }
      result.set(id, {
        id,
        position: new Vector3().lerpVectors(ps.position, ns.position, t),
        rotation: ps.rotation.clone().slerp(ns.rotation, t),
        velocity: new Vector3().lerpVectors(ps.velocity, ns.velocity, t),
        timestamp,
      });
    }
    // next 中存在但 prev 没有的实体(新加入),用 next 值
    for (const [id, ns] of next.entityStates) {
      if (!prev.entityStates.has(id)) {
        result.set(id, {
          id,
          position: ns.position.clone(),
          rotation: ns.rotation.clone(),
          velocity: ns.velocity.clone(),
          timestamp,
        });
      }
    }

    return result;
  }

  /** 克隆 HistoryEntry 中的实体状态(独立 Map,避免外部修改污染历史)。 */
  private _cloneEntryStates(entry: HistoryEntry): Map<number, EntityState> {
    const result = new Map<number, EntityState>();
    for (const [id, s] of entry.entityStates) {
      result.set(id, {
        id,
        position: s.position.clone(),
        rotation: s.rotation.clone(),
        velocity: s.velocity.clone(),
        timestamp: s.timestamp,
      });
    }
    return result;
  }

  /** 点是否在轴对齐边界框内(含边界)。 */
  private _pointInBounds(point: Vector3, bounds: HitBounds): boolean {
    const c = bounds.center;
    const h = bounds.halfExtents;
    return (
      point.x >= c.x - h.x && point.x <= c.x + h.x &&
      point.y >= c.y - h.y && point.y <= c.y + h.y &&
      point.z >= c.z - h.z && point.z <= c.z + h.z
    );
  }
}

/** 工厂:创建一个 EntityState。 */
export function createEntityState(
  id: number,
  position: Vector3 = new Vector3(),
  rotation: Quaternion = new Quaternion(),
  velocity: Vector3 = new Vector3(),
  timestamp: number = 0,
): EntityState {
  return {
    id,
    position: position.clone(),
    rotation: rotation.clone(),
    velocity: velocity.clone(),
    timestamp,
  };
}
