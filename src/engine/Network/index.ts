// Network barrel — 网络同步模块统一导出。
//
// 模块组成：
//   - NetworkTransport: 传输抽象 + WebSocketTransport / MockTransport 实现
//   - Snapshot: 二进制快照序列化 / 压缩
//   - NetworkLerp: 位置 / 旋转插值 + 预测 + 和解
//   - NetworkSync: 同步管理器（服务器权威 + 客户端插值）

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
