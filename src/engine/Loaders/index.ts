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
// Phase 4.2: FBX 二进制加载器
export { FBXLoader, sniffFbxBinary, parseFbxBinary, type LoadedFBX } from './FBXLoader';
// Phase 4.1: KTX2/Basis 纹理压缩支持
export {
  KTX2Loader,
  sniffKtx2,
  parseKtx2Container,
  setBasisTranscoder,
  setZstdDecoder,
  type ParsedKtx2,
  type Ktx2Header,
  type Ktx2Level,
  type CompressedMipmapLevel,
  type Ktx2InternalFormatHint,
  type Ktx2FormatHint,
  type Ktx2TypeHint,
  type BasisTranscoder,
} from './KTX2Loader';
// 几何体加载器:STL / PLY
export { STLLoader, parseSTL } from './STLLoader';
export { PLYLoader, parsePLY } from './PLYLoader';
// 纹理加载器:TGA / EXR
export { TGALoader, parseTGA, type TGAResult } from './TGALoader';
export { EXRLoader, parseEXR, type EXRResult } from './EXRLoader';
// 材质加载器:MTL
export {
  MTLLoader,
  parseMTL,
  type MaterialDescription,
  type TextureMapRef,
  type MTLParseResult,
} from './MTLLoader';
