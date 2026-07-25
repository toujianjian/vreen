// SaveSystem barrel —— 存档系统统一导出。
//
// 模块职责：
//   - SaveSerializer       — Scene+World+metadata ↔ SaveData，含压缩
//   - LocalStorageAdapter  — localStorage / 内存兜底的字符串键值存储
//   - SaveSystem           — 多槽位 + 自动保存 + 持久化的存档管理器
//   - StorageAdapter       — 存储适配器契约（便于自定义 IndexedDB / FileSystem 实现）

export {
  SaveSerializer,
  SAVE_SERIALIZER_VERSION,
  type SaveData,
  type SaveDeserializeOptions,
} from './SaveSerializer';
export {
  LocalStorageAdapter,
  MemoryStorageBackend,
  type StorageAdapter,
  type StorageBackend,
  type LocalStorageAdapterOptions,
} from './LocalStorageAdapter';
export {
  SaveSystem,
  AUTO_SAVE_SLOT_ID,
  type SaveSlot,
  type SaveSystemOptions,
  type AutoSaveSource,
} from './SaveSystem';
