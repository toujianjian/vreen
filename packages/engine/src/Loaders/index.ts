// Loaders — 资产加载器集合。
//
// 约定：每种资产类型实现 Loader<T>（见 Loader.ts），由 AssetManager
// 统一注册 / 缓存。

export { parseOBJ, type ParsedOBJ, type OBJMaterialRef } from './OBJLoader';
export { exportOBJ } from './OBJExporter';
export type {
  AssetSource,
  LoaderProgress,
  LoaderContext,
  Loader,
} from './Loader';
export {
  cacheKeyFor,
  fetchAsArrayBuffer,
  toArrayBuffer,
  isAbortError,
} from './Loader';
export { AssetManager, getDefaultAssetManager, resetDefaultAssetManager } from './AssetManager';
export type { AssetManagerOptions } from './AssetManager';
export { TextureLoader } from './TextureLoader';
export { HDRLoader, type LoadedHDR } from './HDRLoader';
export { GLBLoader, parseGLB, type LoadedGLB } from './GLBLoader';
export {
  getDracoModule,
  decodeDraco,
  type DecodedMesh,
  type DracoAttributeSpec,
} from './DracoDecoder';
