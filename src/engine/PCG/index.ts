// PCG barrel — 程序化内容生成 (Procedural Content Generation) 统一导出。
//
// 包含:
//   * NoiseGenerator      — Perlin/Simplex/Worley/fBm/Ridge 噪声(实例化、种子可控)
//   * BuildingGenerator   — 程序化建筑(楼层/屋顶/窗户/门)
//   * CityGenerator       — 程序化城市(网格街区 + 道路 + 公园)
//   * DungeonGenerator    — 程序化地牢(房间 + 走廊 + 连接 + 门)
//   * TreeGenerator       — 程序化树木(L-system 风格递归分支 + 叶子)

export { NoiseGenerator } from './NoiseGenerator';
export {
  BuildingGenerator,
  type RoofType,
  type BuildingStyle,
  type BuildingOptions,
  type BuildingResult,
} from './BuildingGenerator';
export {
  CityGenerator,
  type CityOptions,
  type CityBuilding,
  type CityPark,
  type CityResult,
  type CityStats,
} from './CityGenerator';
export {
  DungeonGenerator,
  type DungeonRoom,
  type DungeonCorridor,
  type DungeonDoor,
  type DungeonOptions,
  type DungeonResult,
  TILE_EMPTY,
  TILE_WALL,
  TILE_ROOM,
  TILE_CORRIDOR,
  TILE_DOOR,
} from './DungeonGenerator';
export {
  TreeGenerator,
  type TreeOptions,
  type TreeBranch,
  type TreeResult,
} from './TreeGenerator';
