// Core barrel.

export { Object3D, DirtyFlag } from './Object3D';
// 陀螺仪对象 (Gyroscope) — 位置跟随父节点,朝向锁定世界坐标。
// 适配 three.js Gyroscope.js,用于 billboard / HUD / 指南针 / 粒子广告牌。
export { Gyroscope } from './Gyroscope';
export { Scene } from './Scene';
export { SceneGraphProcessor, type SceneGraphStats } from './SceneGraphProcessor';
export { SceneStats, type SceneStatsData } from './SceneStats';
export { FrustumCuller, type FrustumCullStats } from './FrustumCuller';
export { BufferAttribute, type AttributeKind } from './BufferAttribute';
export { InstancedBufferAttribute } from './InstancedBufferAttribute';
export { BufferGeometry } from './BufferGeometry';
// BufferGeometryUtils — 几何体处理工具 (mergeGeometries/weldVertices/computeTangents/estimateBytesUsed/interleaveAttributes/toIndexed/deduplicateIndices)。
// 适配 three.js BufferGeometryUtils.js,提供空间哈希焊接 + Lengyel 切线空间 + 交错属性打包。
export {
  mergeGeometries,
  weldVertices,
  computeTangents,
  estimateBytesUsed,
  interleaveAttributes,
  toIndexed,
  deduplicateIndices,
} from './BufferGeometryUtils';
// MeshSurfaceSampler — 网格表面面积加权随机采样 (植被散布/粒子发射)。
// 适配 three.js MeshSurfaceSampler.js,CDF + barycentric 均匀采样。
export { MeshSurfaceSampler, type SampleResult } from './MeshSurfaceSampler';
// SceneUtils — 场景图工具集 (detach/attach/createMultiMaterialObject/createMeshesFromInstancedGeometry/sortChildren/getWorld*)。
// 适配 three.js SceneUtils.js,保持世界变换的父子关系切换 + 实例化拆分 + 遍历工具。
export {
  detach,
  attach,
  createMultiMaterialObject,
  createMeshesFromInstancedGeometry,
  sortChildrenByRenderOrder,
  getWorldPosition,
  getWorldQuaternion,
  getWorldScale,
  getWorldDirection,
  getMeshes,
  countObjects,
} from './SceneUtils';
export { Mesh } from './Mesh';
export { Sprite } from './Sprite';
export { InstancedMesh } from './InstancedMesh';
export { LOD, type LODLevel } from './LOD';
export { Group } from './Group';
export { Text, type TextAlignment, type TextOptions } from './Text';
export { BitmapText, type BitmapTextOptions } from './BitmapText';
export { TextAtlas, DEFAULT_FONT, DEFAULT_ATLAS_WIDTH, DEFAULT_ATLAS_HEIGHT, type AtlasChar, type TextFont } from './TextAtlas';
export { BasicMaterial, type Material, type RGB, type ShaderObject } from './Material';
export { Bone } from './Bone';
export { Skeleton } from './Skeleton';
export { SkinnedMesh } from './SkinnedMesh';
export { Texture } from './Texture';
export type { TextureImage, TextureOptions, PixelFormat, PixelType, CubeMapping } from './Texture';
export { CubeTexture } from './CubeTexture';
export type { CubeFaceImage, CubeTextureOptions } from './CubeTexture';
export { DataTexture } from './DataTexture';
export type { DataTextureBuffer, DataTextureOptions } from './DataTexture';
export { DataArrayTexture } from './DataArrayTexture';
export type { WrapR, DataArrayTextureOptions } from './DataArrayTexture';
export { DepthTexture } from './DepthTexture';
export type { DepthCompareFunction, DepthTextureOptions } from './DepthTexture';
export { VideoTexture } from './VideoTexture';
export type { VideoTextureOptions } from './VideoTexture';
export { CanvasTexture } from './CanvasTexture';
export type { CanvasTextureOptions } from './CanvasTexture';
export { CompressedTexture } from './CompressedTexture';
export type {
  CompressedPixelFormat,
  CompressedMipmap,
  CompressedTextureOptions,
} from './CompressedTexture';
export { Source } from './Source';
export type { SourceData, SourceOptions } from './Source';
export { Fog } from './Fog';
export { FogExp2 } from './FogExp2';
export { Raycaster, intersectGeometry } from './Raycaster';
export type { Face, Intersection, RaycasterParameters } from './Raycaster';
export { MorphTargets } from './MorphTargets';
export { MorphTargetAnimation, MorphTargetTrack } from './MorphTargetAnimation';
// 毛发 shell 网格(配合 Materials/FurMaterial 实现多层毛发)。
export { FurShell, type FurShellOptions } from './FurShell';
// ModuleRegistry — Gem 风格模块注册系统 (参考 o3de Gems)。
// 注册/加载/卸载引擎模块,管理依赖图与生命周期回调。
export {
  ModuleRegistry,
  getDefaultModuleRegistry,
  resetDefaultModuleRegistry,
  type EngineModule,
  type ModuleManifest,
  type ModuleManifestEntry,
  type ManifestImportReport,
} from './ModuleRegistry';
