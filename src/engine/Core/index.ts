// Core barrel.

export { Object3D, DirtyFlag } from './Object3D';
// 陀螺仪对象 (Gyroscope) — 位置跟随父节点,朝向锁定世界坐标。
// 适配 three.js Gyroscope.js,用于 billboard / HUD / 指南针 / 粒子广告牌。
export { Gyroscope } from './Gyroscope';
// 程序化金属薄片纹理 (Flakes Texture) — 车漆/金属漆/珠光漆效果。
// 适配 three.js FlakesTexture.js,支持确定性 RNG + 平铺 + 法线贴图转换。
export { FlakesTexture, type FlakesTextureOptions, type FlakesTextureResult } from './FlakesTexture';
// 预积分皮肤着色 LUT (Pre-Integrated Skin) — Penner 2011 + d'Eon 2007 散射剖面。
// 生成 2D RGB LUT(N·L × 曲率),高曲率区域红移散射;纯 CPU,无 GL 绑定。
// 与 SubsurfaceScatteringMaterial(薄壁透射)互补,组合实现完整皮肤渲染。
export {
  generatePreIntegratedSkinLUT,
  samplePreIntegratedSkinLUT,
  skinScatterProfile,
  curvatureFromRadius,
  type PreIntegratedSkinLUTOptions,
  type PreIntegratedSkinLUTResult,
  type SkinColor,
} from './PreIntegratedSkinLUT';
// 可分离屏幕空间次表面散射核 (Separable SSS) — Jimenez 2015 + d'Eon 扩散剖面。
// 生成按通道 RGB 权重的 1D 半核(红弥散更远),两趟卷积近似 2D 扩散;含 CPU 参考
// 卷积 + GLSL chunk + uniform 转换。与 PreIntegratedSkinLUT / SubsurfaceScatteringMaterial
// 组合实现完整实时皮肤管线。
export {
  generateSeparableSSSKernel,
  sampleSSSProfile,
  convolve1D,
  convolve2DSeparable,
  kernelVariance,
  kernelToUniforms,
  SKIN_PROFILE_JIMENEZ,
  SEPARABLE_SSS_VERT,
  SEPARABLE_SSS_FRAG,
  type SSSGaussianComponent,
  type SSSKernelSample,
  type SeparableSSSKernelOptions,
  type SeparableSSSKernelResult,
} from './SeparableSSS';
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
// Points — 点云 / 点精灵物体 (GL_POINTS),适配 three.js Points.js。
// 把 BufferGeometry 每个顶点绘制为一个点,支持 raycast 阈值拾取。
export { Points } from './Points';
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
