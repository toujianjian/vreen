// Terrain barrel — 地形系统统一导出。
//
// 包含:
//   * TerrainGeometry    — 高度图地形几何体(含 getHeightAt 双线性采样)
//   * HeightmapGenerator — 程序化高度图生成器(Perlin / Diamond-Square / Ridge / Flat)
//   * TerrainLayer       — 地形纹理层定义
//   * TerrainSplat       — 地形纹理混合(splatmap 生成)
//   * TerrainErosion     — 程序化地形侵蚀(热力 + 水力 + 风力)
//   * FBMNoise           — Simplex 多倍频噪声(实时地形高度函数)
//   * TerrainChunk       — LOD 分块(含 skirt 缝合)
//   * TerrainSystem      — 多分块管理 + 距离 LOD 选择 + 全局高度查询

export { TerrainGeometry, type TerrainGeometryOptions } from './TerrainGeometry';
export { HeightmapGenerator } from './HeightmapGenerator';
export { TerrainLayer, type TerrainLayerOptions } from './TerrainLayer';
export { TerrainSplat } from './TerrainSplat';
export { TerrainErosion, type ErodeOptions, type ErosionStats } from './TerrainErosion';
// TerrainEditor — 交互式地形笔刷编辑器 (raise/lower/smooth/flatten/paint/noise/erode + undo/redo)。
// 与 TerrainGeometry 解耦:通过鸭子类型接受任何含 heightmap/width/height/segments 的对象。
export {
  TerrainEditor,
  type BrushShape,
  type TerrainTool,
  type TerrainEdit,
  type TerrainEditorStats,
} from './TerrainEditor';
// FBMNoise — Simplex 多倍频分形布朗运动噪声。
// 与 HeightmapGenerator(基于 Perlin)互补:Simplex 无方向性伪影,适合实时地形。
// 提供 toHeightFunction() 生成 HeightFunction,可直接传给 TerrainChunk / TerrainSystem。
export { FBMNoise, type HeightFunction } from './FBMNoise';
// TerrainChunk — 单个 LOD 分块(含 skirt 缝合)。
// 适配 o3de Atom TerrainSystem / GPU Gems 1 Ch.38。
// LOD N 分段 = baseSegments / 2^N,沿四边添加 skirt 顶点消除 LOD 缝隙。
export { TerrainChunk, type TerrainChunkOptions } from './TerrainChunk';
// TerrainSystem — 多分块管理 + 距离 LOD 选择 + 全局高度/法线/坡度查询。
// 适配 o3de Atom TerrainWorld。每帧 update(cameraX, cameraZ) 返回可见分块列表。
// getHeightAt / getNormalAt 直接调用 heightFunction,不依赖分块几何。
export { TerrainSystem, type TerrainSystemOptions } from './TerrainSystem';
