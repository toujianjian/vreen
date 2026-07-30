// Assets barrel — 资源管理模块统一导出。
//
// 模块职责：
//   - AssetCache     — LRU 资源实例缓存（同步，按 key）
//   - AssetRegistry  — 资源注册表 + 引用计数
//   - AssetLoader    — 异步资源加载器（封装 AssetManager）
//   - AssetBundle    — 资源打包 / 加载系统（manifest + 依赖 + 并发限流）

export { AssetCache, type AssetCacheOptions } from './AssetCache';
export {
  AssetRegistry,
  getDefaultAssetRegistry,
  resetDefaultAssetRegistry,
  type AssetHandle,
  type AssetType,
  type AssetRegistryOptions,
  type AssetRegistryStats,
} from './AssetRegistry';
export {
  AssetLoader,
  type AssetLoadEntry,
  type AssetBatchResult,
} from './AssetLoader';
export {
  AssetBundle,
  type AssetType as AssetBundleType,
  type AssetEntry,
  type AssetManifest,
  type AssetBundleEntry,
  type AssetBundleOptions,
  type BundleInfo,
  type LoadingProgress,
  type AssetBundleStats,
} from './AssetBundle';
