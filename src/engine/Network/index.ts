// Network barrel — 网络同步模块统一导出。
//
// 模块组成：
//   - NetworkTransport: 传输抽象 + WebSocketTransport / MockTransport 实现
//   - Snapshot: 二进制快照序列化 / 压缩
//   - NetworkLerp: 位置 / 旋转插值 + 预测 + 和解
//   - NetworkSync: 同步管理器（服务器权威 + 客户端插值, 依赖传输层）
//   - StateSync: 纯数据层状态同步 (快照插值 + 实体同步 + Delta 压缩, 不依赖传输层)
//   - LagCompensation: 网络延迟补偿 (客户端预测 / 服务器回滚 / 命中补偿)

export {
  WebSocketTransport,
  MockTransport,
  type NetworkTransport,
} from './NetworkTransport';
export {
  Snapshot,
  type SnapshotEntity,
  type SnapshotOptions,
} from './Snapshot';
export {
  NetworkLerp,
  type TransformState,
} from './NetworkLerp';
export {
  NetworkSync,
  createNetworkEntity,
  type NetworkEntity,
  type NetworkSyncOptions,
} from './NetworkSync';
export {
  StateSync,
  createSyncEntity,
  type SyncEntity,
  type StateSnapshot,
  type PackedSnapshotData,
  type StateSyncOptions,
  type StateSyncStats,
} from './StateSync';
export {
  LagCompensation,
  createEntityState,
  type EntityState,
  type HistoryEntry,
  type HitBounds,
  type LagCompensationOptions,
  type LagCompensationStats,
} from './LagCompensation';
