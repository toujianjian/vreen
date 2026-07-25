// Pipeline barrel — 资源管线统一导出。
//
// 包含:
//   * AssetPipeline       — 可组合的处理步骤序列(导入→验证→优化→压缩)
//   * TextureProcessor    — 纹理压缩/调整/mipmap/格式转换/预乘 alpha
//   * GeometryProcessor   — 几何体合并/简化/法线/切线/包围盒/焊接
//   * ImportPipeline      — GLTF/GLB/OBJ/FBX 导入 + 归一化 + 验证

export {
  AssetPipeline,
  type PipelineAsset,
  type PipelineStep,
  type BatchResult,
} from './AssetPipeline';
export {
  TextureProcessor,
  type CompressedFormat,
  type TargetFormat,
} from './TextureProcessor';
export { GeometryProcessor } from './GeometryProcessor';
export {
  ImportPipeline,
  type ImportResult,
  type ValidationReport,
} from './ImportPipeline';
