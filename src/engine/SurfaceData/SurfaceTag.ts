// SurfaceTag — 表面标签 (Surface Data 系统)。
// 参考 o3de Gems/SurfaceData:每个表面点带一组带权标签 (0..1),
// 用于地形材质混合、脚步音效、粒子触发等查询。
//
// 设计原则:
//   - SurfaceTagId 用字符串 (人类可读 + JSON 友好),不引入运行时符号表。
//   - weight ∈ [0,1],由 Provider 按高度/坡度/噪声等规则赋值。
//   - 预置常用标签常量,调用方也可自定义任意字符串 id。

export type SurfaceTagId = string;

export interface SurfaceTag {
  id: SurfaceTagId;
  /** 权重 0..1。 */
  weight: number;
}

export const TAG_GRASS = 'grass';
export const TAG_ROCK = 'rock';
export const TAG_SAND = 'sand';
export const TAG_WATER = 'water';
export const TAG_ICE = 'ice';
export const TAG_METAL = 'metal';
export const TAG_WOOD = 'wood';
export const TAG_DIRT = 'dirt';
export const TAG_SNOW = 'snow';

export const DEFAULT_TAGS = [
  TAG_GRASS,
  TAG_ROCK,
  TAG_SAND,
  TAG_WATER,
  TAG_ICE,
  TAG_METAL,
  TAG_WOOD,
  TAG_DIRT,
  TAG_SNOW,
];
