// Assets barrel — 资源管理模块统一导出。
//
// 模块职责：
//   - AssetCache        — LRU 资源实例缓存（同步，按 key）
//   - AssetRegistry     — 资源注册表 + 引用计数
//   - AssetLoader       — 异步资源加载器（封装 AssetManager）
//   - AssetBundle       — 资源打包 / 加载系统（manifest + 依赖 + 并发限流）
//   - TextureStreaming  — 纹理流式加载（mip 按需调度 + 内存上限 LRU 驱逐）

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
// 纹理流式加载系统(Mipmap streaming + 按需加载,基于相机距离/屏幕占比调度 mip)。
export {
  TextureStreaming,
  type StreamingTexture,
  type StreamingTextureConfig,
  type TextureStreamingOptions,
  type TextureStreamingStats,
  type LoadMipCallback,
  type UnloadMipCallback,
} from './TextureStreaming';
