// Terrain barrel — 地形系统统一导出。
//
// 包含:
//   * TerrainGeometry    — 高度图地形几何体(含 getHeightAt 双线性采样)
//   * HeightmapGenerator — 程序化高度图生成器(Perlin / Diamond-Square / Ridge / Flat)
//   * TerrainLayer       — 地形纹理层定义
//   * TerrainSplat       — 地形纹理混合(splatmap 生成)
//   * TerrainErosion     — 程序化地形侵蚀(热力 + 水力 + 风力)

export { TerrainGeometry, type TerrainGeometryOptions } from './TerrainGeometry';
export { HeightmapGenerator } from './HeightmapGenerator';
export { TerrainLayer, type TerrainLayerOptions } from './TerrainLayer';
export { TerrainSplat } from './TerrainSplat';
export { TerrainErosion, type ErodeOptions, type ErosionStats } from './TerrainErosion';
