// Voxel — 体素系统：VoxelChunk / VoxelWorld / VoxelMesher / VoxelRaycaster / VoxelPalette。
//
// 设计：见各文件头注释。整体分层：
//   VoxelPalette  — 体素类型注册表（id → 颜色/透明/固体）
//   VoxelChunk    — 16³ 体素块，单块网格化
//   VoxelMesher   — 网格生成器（贪婪合并 / 简单 / AO）
//   VoxelRaycaster— DDA 射线检测
//   VoxelWorld    — 多块世界，跨块读写 / 地形生成 / 统计

export {
  VoxelPalette,
  defaultPalette,
  AIR_VOXEL,
  type VoxelType,
} from './VoxelPalette';

export {
  VoxelChunk,
  type VoxelMeshData,
} from './VoxelChunk';

export {
  greedyMesh,
  simpleMesh,
  getAmbientOcclusion,
  type VoxelNeighborProvider,
} from './VoxelMesher';

export {
  VoxelRaycaster,
  type VoxelRayHit,
} from './VoxelRaycaster';

export {
  VoxelWorld,
  type VoxelWorldStats,
  type Heightmap,
} from './VoxelWorld';
