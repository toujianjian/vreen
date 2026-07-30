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
// TerrainEditor — 交互式地形笔刷编辑器 (raise/lower/smooth/flatten/paint/noise/erode + undo/redo)。
// 与 TerrainGeometry 解耦:通过鸭子类型接受任何含 heightmap/width/height/segments 的对象。
export {
  TerrainEditor,
  type BrushShape,
  type TerrainTool,
  type TerrainEdit,
  type TerrainEditorStats,
} from './TerrainEditor';
