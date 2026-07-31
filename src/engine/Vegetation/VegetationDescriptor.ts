// VegetationDescriptor — 植被描述符:声明一种植被的 mesh/权重/缩放/LOD/阴影。
// 参考 o3de Gems/Vegetation:Descriptor 提供植被种类的元数据,SpawnerArea 按 weight 加权挑选。

export interface VegetationDescriptor {
  /** Unique descriptor id. */
  id: string;
  /** Mesh/prefab key the spawner resolves to an InstancedMesh template. */
  meshKey: string;
  /** Relative weight when multiple descriptors compete for a slot (higher = more likely). Default 1. */
  weight: number;
  /** Min/max scale (uniform). */
  minScale: number;
  maxScale: number;
  /** Optional LOD distances (near→far). Empty = single LOD. */
  lodDistances?: number[];
  /** Optional cast/receive shadow flags. */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function createDescriptor(
  id: string,
  meshKey: string,
  opts: Partial<VegetationDescriptor> = {},
): VegetationDescriptor {
  return {
    id,
    meshKey,
    weight: 1,
    minScale: 0.8,
    maxScale: 1.2,
    lodDistances: [],
    castShadow: true,
    receiveShadow: false,
    ...opts,
  };
}
