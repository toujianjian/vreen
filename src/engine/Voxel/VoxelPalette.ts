// VoxelPalette — 体素类型调色板。
//
// 设计目标：
//   - 用 id（0..255）索引体素类型；id=0 固定表示"空气"（空体素）。
//   - 每个 VoxelType 携带颜色、透明、固体、自定义数据。
//   - 调色板是进程级单例风格的可变注册表：场景加载时 register 一批类型，
//     之后 Chunk/World/Mesher/Raycaster 通过 get/isSolid/isTransparent
//     查询。
//   - 与渲染解耦：颜色是逻辑颜色（线性 r,g,b 0..1），具体着色（PBR/着色器
//     采样）由 Mesher 产出顶点颜色或 texture atlas index 时再决定。
//
// 与 VoxelChunk 的关系：Chunk 只存 Uint8Array 的 id 序列；调色板查表决定
// 物理 / 渲染属性。这样 Chunk 极轻量，便于序列化与网络同步。

/** 单体素类型定义。 */
export interface VoxelType {
  /** 体素 id，0..255。0 保留给空气。 */
  id: number;
  /** 类型名称（便于调试 / 序列化）。 */
  name: string;
  /** 逻辑颜色（线性 r,g,b，0..1）。 */
  color: [number, number, number];
  /** 是否透明（水、玻璃等；透明体素的面剔除与固体不同）。 */
  transparent: boolean;
  /** 是否固体（阻挡角色与射线）。 */
  solid: boolean;
  /** 自定义数据（材质 id、UV 索引、声音等）。 */
  customData?: Record<string, unknown>;
}

/** id=0 空气体素的固定定义。 */
export const AIR_VOXEL: VoxelType = {
  id: 0,
  name: 'air',
  color: [0, 0, 0],
  transparent: true,
  solid: false,
};

export class VoxelPalette {
  /** 按 id 索引的类型表。索引 0 固定为 AIR。 */
  private _types: Map<number, VoxelType> = new Map();

  constructor() {
    this._types.set(0, AIR_VOXEL);
  }

  /** 注册一个体素类型。id 已存在则覆盖。 */
  register(type: VoxelType): void {
    if (type.id < 0 || type.id > 255) {
      throw new RangeError(`VoxelType.id must be 0..255, got ${type.id}`);
    }
    this._types.set(type.id, type);
  }

  /** 获取 id 对应类型；未注册返回 AIR。 */
  get(id: number): VoxelType {
    return this._types.get(id) ?? AIR_VOXEL;
  }

  /** 获取颜色。未注册返回黑色。 */
  getColor(id: number): readonly [number, number, number] {
    return this.get(id).color;
  }

  /** 是否透明。未注册视为非透明（保守判定）。 */
  isTransparent(id: number): boolean {
    const t = this._types.get(id);
    return t ? t.transparent : false;
  }

  /** 是否固体。未注册视为非固体（保守判定：可通过）。 */
  isSolid(id: number): boolean {
    const t = this._types.get(id);
    return t ? t.solid : false;
  }

  /** 是否注册过。 */
  has(id: number): boolean {
    return this._types.has(id);
  }

  /** 列出所有已注册类型（不含 AIR 之外的也包含）。 */
  list(): VoxelType[] {
    return [...this._types.values()];
  }

  /** 清空除 AIR 之外的所有类型。 */
  clear(): void {
    this._types.clear();
    this._types.set(0, AIR_VOXEL);
  }
}

/** 进程级默认调色板。调用方可自建 VoxelPalette 替换。 */
export const defaultPalette = new VoxelPalette();

// 预置常见体素类型（id 1..7），方便测试与 demo 直接用。
defaultPalette.register({ id: 1, name: 'stone', color: [0.5, 0.5, 0.5], transparent: false, solid: true });
defaultPalette.register({ id: 2, name: 'grass', color: [0.3, 0.7, 0.3], transparent: false, solid: true });
defaultPalette.register({ id: 3, name: 'dirt', color: [0.45, 0.3, 0.2], transparent: false, solid: true });
defaultPalette.register({ id: 4, name: 'sand', color: [0.85, 0.8, 0.55], transparent: false, solid: true });
defaultPalette.register({ id: 5, name: 'wood', color: [0.4, 0.25, 0.15], transparent: false, solid: true });
defaultPalette.register({ id: 6, name: 'water', color: [0.2, 0.4, 0.9], transparent: true, solid: false });
defaultPalette.register({ id: 7, name: 'glass', color: [0.7, 0.85, 1.0], transparent: true, solid: true });
