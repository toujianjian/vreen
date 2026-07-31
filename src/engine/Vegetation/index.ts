// Vegetation barrel — 可组合植被管线 (Spawner + Filters + Modifiers + Descriptors + AreaBlender)。
//
// 模块组成:
//   - VegetationDescriptor — 植被种类元数据 (mesh/weight/scale/LOD/shadow)
//   - VegetationFilter     — 过滤器 (altitude/slope/surfaceMask/distanceBetween/shapeIntersection/distribution)
//   - VegetationModifier   — 修改器 (position/rotation/scale/slopeAlignment)
//   - SpawnerArea          — 生成区域 (rejection sampling + filter chain + modifier chain)
//   - AreaBlender          — 多区域混合器 (按优先级依次 spawn)
//
// 与 Environment/VegetationSystem 互补:VegetationSystem 是一体化植被系统 (直接构建 InstancedMesh),
// 本模块是可组合管线 (SpawnerArea 产出 SpawnedInstance[],由调用方映射到渲染后端)。

export * from './VegetationDescriptor';
export * from './VegetationFilter';
export * from './VegetationModifier';
export * from './SpawnerArea';
export * from './AreaBlender';
