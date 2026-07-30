// PCG barrel — 程序化内容生成 (Procedural Content Generation) 统一导出。
//
// 包含:
//   * NoiseGenerator      — Perlin/Simplex/Worley/fBm/Ridge 噪声(实例化、种子可控)
//   * BuildingGenerator   — 程序化建筑(楼层/屋顶/窗户/门)
//   * CityGenerator       — 程序化城市(网格街区 + 道路 + 公园)
//   * DungeonGenerator    — 程序化地牢(房间 + 走廊 + 连接 + 门)
//   * TreeGenerator       — 程序化树木(L-system 风格递归分支 + 叶子)
//   * RoadGenerator       — 程序化道路(Catmull-Rom 样条 + 地形跟随 + 交叉路口)
//   * CharacterGenerator  — 程序化角色(身体/头部/面部/头发/服装/配饰/骨骼)

export { NoiseGenerator } from './NoiseGenerator';
export {
  BuildingGenerator,
  type RoofType,
  type BuildingStyle,
  type BuildingOptions,
  type BuildingResult,
} from './BuildingGenerator';
export {
  BuildingGenerator2,
  type BuildingStyle2,
  type RoofType2,
  type WindowSize,
  type BuildingPartInfo,
  type BuildingGenerator2Result,
  type BuildingStats,
} from './BuildingGenerator2';
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
export {
  RoadGenerator,
  type IntersectionType,
  type RoadIntersection,
  type TerrainSampler,
  type RoadGeometryData,
  type RoadStats,
} from './RoadGenerator';
export {
  CharacterGenerator,
  type CharacterRace,
  type CharacterGender,
  type CharacterBodyType,
  type CharacterClothing,
  type CharacterColor,
  type CharacterStats,
  type CharacterResult,
} from './CharacterGenerator';
