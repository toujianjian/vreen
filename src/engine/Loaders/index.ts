// Loaders — 资产加载器集合。
//
// 约定：每种资产类型实现 Loader<T>（见 Loader.ts），由 AssetManager
// 统一注册 / 缓存。

export { parseOBJ, type ParsedOBJ, type OBJMaterialRef } from './OBJLoader';
export { exportOBJ, OBJExporter } from './OBJExporter';
export { GLTFExporter, type GLTFOptions, type GLTFResult } from './GLTFExporter';
export { STLExporter, type STLExportOptions } from './STLExporter';
export { PLYExporter, type PLYExportOptions } from './PLYExporter';
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
// Collada (.dae) 简化版 XML 加载器
export { ColladaLoader, parseCollada, type ColladaParseResult } from './ColladaLoader';
// MagicaVoxel (.vox) 二进制体素加载器
export { VOXLoader, parseVOX, type VoxVoxel, type VoxModel, type VoxParseResult } from './VOXLoader';
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
// GLTFExtensionLoader — 增强版 GLTF 加载器 (扩展注册 / DRACO / KTX2 / 缓存)。
// 参考 three.js GLTFLoader,委托内部 GLBLoader 完成实际解析。
export {
  GLTFExtensionLoader,
  type GLTFExtensionHandler,
  type GLTFExtensionContext,
  type GLTFJson,
  type GLTFNode,
  type GLTFMesh,
  type GLTFPrimitive,
  type GLTFAccessor,
  type GLTFBufferView,
  type GLTFBuffer,
  type GLTFMaterial,
  type GLTFSkin,
  type GLTFAnimation,
  type GLTFTexture,
  type GLTFImage,
  type GLTFSampler,
  type DRACODecoderLike,
  type KTX2DecoderLike,
} from './GLTFExtensionLoader';
// LUTCubeLoader — .cube 3D LUT 颜色查找表加载器 (DaVinci Resolve / Photoshop / Adobe AE 导出)。
// 解析 Adobe Cube LUT 1.0 规范: 支持 1D/3D LUT、TITLE、DOMAIN_MIN/MAX (HDR 扩展色域)、
// 注释、自动大小推断(无前缀 LUT_SIZE 时)。提供 cube3DToStrip / stripToCube3D 布局转换
// (WebGL2 TEXTURE_3D 与 TEXTURE_2D strip 间互转,与 LUTPass 配套)。
export {
  LUTCubeLoader,
  parseCube,
  cube3DToStrip,
  stripToCube3D,
  toData3DTexture,
  type LUTCubeResult,
} from './LUTCubeLoader';
