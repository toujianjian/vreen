// ShadowmapAtlas — 阴影图集四叉树打包算法。
//
// 抄写自 o3de `Gems/Atom/Feature/Common/Code/Source/CoreLights/ShadowmapAtlas.{h,cpp}`
// (Apache-2.0 OR MIT)。纯数据层,无 WebGL 依赖,可直接单测。
//
// 解决的问题:场景中发光源的阴影贴图尺寸各不相同(2048/1024/512/256…)。逐个
// 单独渲染会浪费切换成本;把它们打包进一张 **image array**(阵列纹理)的同一
// 张 **shadowmap atlas** 里,可用一次渲染/一次 compute dispatch 处理全部阴影。
//
// 本类只负责**几何打包**:为每个阴影 index 决定它在 atlas 中的
//   - array slice(阵列切片,即 "depth" 方向第几层)
//   - 本切片内的原点(originInSlice[0] = x,originInSlice[1] = y)
// 并把"某个 slice 的局部坐标 → 对应阴影 index"的查找关系压平成一张
// **ShadowmapIndexTable**(供 GPU compute shader 一次 dispatch 全图集解析),
// ——这正是 o3de 的做法,把 CPU 侧打包与 GPU 侧查表解耦。
//
// Location 编码(核心思想):
//   一个阴影在 atlas 中的位置记作有限整数序列 loc = [s, q0, q1, …],其中
//     - loc[0] = arrray slice 索引(该切片左下角即该阴影自身的原点);
//     - 对 k≥0,loc[k+1] ∈ {0,1,2,3} 表示在 loc[0..k] 确定的方块的某一象限
//       再细分(见下图),尺寸每多一级减半:
//
//         +---+---+   loc[k+1] 取 0/1(x 低/高半),2/3(x 同半+ y 高半)
//         | 0 | 1 |
//         +---+---+
//         | 2 | 3 |
//         +---+---+
//
//   于是阴影尺寸 = baseShadowmapSize × (1/2)^{len-1}。打包按"大的优先、同尺寸
//   字典序"进行,保证大阴影先占据最完整的象限,小阴影塞进剩余缝隙。

// 位置数字的个数(四叉树分支数)。
const LOCATION_INDEX_COUNT = 4;
/** 无效阴影索引(该索引表槽位对应当前位置无阴影)。 */
export const INVALID_SHADOWMAP_INDEX = -1;

/** 阴影图集默认的最小阴影贴图尺寸(与 o3de `MinShadowmapImageSize` 一致)。 */
export const MIN_SHADOWMAP_IMAGE_SIZE = 256;
/** 阴影图集默认的最大阴影贴图尺寸(与 o3de `MaxShadowmapImageSize` 一致)。 */
export const MAX_SHADOWMAP_IMAGE_SIZE = 2048;

/** 单个阴影在 atlas 中的位置(切片索引 + 切片内原点)。 */
export interface ShadowmapAtlasOrigin {
  /** image array 的切片(depth)索引。 */
  arraySlice: number;
  /** 在该切片内的像素原点 (x, y)。 */
  originInSlice: [number, number];
}

/**
 * 索引表中的一个节点。
 * - 若 `nextTableOffset !== 0`,则由该子表偏移跳转(该位置被多个子阴影共享);
 * - 若 `nextTableOffset === 0`,则 `shadowmapIndex` 即最终阴影索引(终止)。
 */
export interface ShadowmapIndexNode {
  nextTableOffset: number;
  shadowmapIndex: number;
}

/** 阴影图集配置。 */
export interface ShadowmapAtlasOptions {
  /** 像素为单位的基准(最大)阴影尺寸;缺省按实际最大的 SetShadowmapSize 推算。 */
  baseShadowmapSize?: number;
  /** 打包最小阴影尺寸(小于它的 index 不会被打包,视为 disabled)。缺省 256。 */
  minShadowmapSize?: number;
}

/**
 * ShadowmapAtlas — 把不同尺寸的阴影贴图四叉树打包进一张 image array atlas,
 * 并构建供 GPU 查询 "坐标→阴影索引" 的扁平化索引表。
 *
 * 用法:
 * ```ts
 * const atlas = new ShadowmapAtlas();
 * atlas.setShadowmapSize(0, 1024); // 光 #0 用 1024×1024
 * atlas.setShadowmapSize(1, 512);  // 光 #1 用 512×512
 * atlas.setShadowmapSize(2, 1024);
 * atlas.finalize();
 * const origin = atlas.getOrigin(1);   // → { arraySlice, originInSlice }
 * const table  = atlas.getShadowmapIndexTable(); // → GPU 索引表
 * ```
 */
export class ShadowmapAtlas {
  private requireFinalize = true;
  private baseShadowmapSize: number;
  private minShadowmapSize: number;
  private maxArraySlice = 0;
  private indicesForSize = new Map<number, number[]>();
  private locations = new Map<number, number[]>();
  private tree = new Map<string, number[]>();
  private indexTableData: ShadowmapIndexNode[] = [];

  constructor(options: ShadowmapAtlasOptions = {}) {
    this.baseShadowmapSize = options.baseShadowmapSize ?? MAX_SHADOWMAP_IMAGE_SIZE;
    this.minShadowmapSize = options.minShadowmapSize ?? MIN_SHADOWMAP_IMAGE_SIZE;
  }

  /** 重置所有状态,回到可重新接收尺寸的状态。 */
  initialize(): void {
    this.requireFinalize = true;
    this.indicesForSize.clear();
    this.locations.clear();
    this.maxArraySlice = 0;
    this.tree.clear();
    this.indexTableData = [];
    this.baseShadowmapSize = MAX_SHADOWMAP_IMAGE_SIZE;
    this.minShadowmapSize = MIN_SHADOWMAP_IMAGE_SIZE;
  }

  /**
   * 登记一个阴影的尺寸。
   * @param index 阴影(光源)索引。
   * @param size  阴影贴图边长(像素),需为 2 的幂且 >= minShadowmapSize 才会被打包。
   */
  setShadowmapSize(index: number, size: number): void {
    const list = this.indicesForSize.get(size);
    if (list) list.push(index);
    else this.indicesForSize.set(size, [index]);
    if (size > this.baseShadowmapSize) this.baseShadowmapSize = size;
  }

  /**
   * 从最大阴影往最小阴影,按字典序为每个阴影分配 Location 并构建索引表。
   * 之后才能调用 getLocation/getOrigin/getArraySliceCount 等查询接口。
   */
  finalize(): void {
    let currentLocation: number[] = [];
    for (
      let size = this.baseShadowmapSize;
      size >= this.minShadowmapSize;
      size = Math.floor(size / 2)
    ) {
      // 尺寸每减半一级,Location 序列长度 +1(表示更细的象限)。
      currentLocation.push(0);
      const list = this.indicesForSize.get(size);
      if (list) {
        for (const index of list) {
          // 复制,避免共享引用后续被 SucceedLocation 原地修改。
          this.locations.set(index, currentLocation.slice());
          this.setShadowmapIndexInTree(currentLocation, index);
          this.maxArraySlice = Math.max(this.maxArraySlice, currentLocation[0]);
          this.succeedLocation(currentLocation);
        }
      }
    }
    this.requireFinalize = false;
    this.buildIndexTableData();
  }

  /** image array 的切片(depth 层)数量。无任何阴影时返回 1(仍需创建一张图)。 */
  getArraySliceCount(): number {
    this.assertFinalized();
    return this.maxArraySlice + 1;
  }

  /** 基准(最大)阴影尺寸。 */
  getBaseShadowmapSize(): number {
    this.assertFinalized();
    return this.baseShadowmapSize;
  }

  /**
   * 查询某阴影在 atlas 中的原点;若该 index 未登记或未被打包,返回空原点
   * ({arraySlice:0, originInSlice:[0,0]}),表示该光源无阴影。
   */
  getOrigin(index: number): ShadowmapAtlasOrigin {
    this.assertFinalized();
    const origin: ShadowmapAtlasOrigin = { arraySlice: 0, originInSlice: [0, 0] };
    const location = this.locations.get(index);
    if (!location || location.length === 0) return origin;

    origin.arraySlice = location[0];
    let sizeDiff = this.baseShadowmapSize;
    for (let digitIndex = 1; digitIndex < location.length; ++digitIndex) {
      sizeDiff = Math.floor(sizeDiff / 2);
      const digit = location[digitIndex];
      if (digit & 1) origin.originInSlice[0] += sizeDiff;
      if (digit & 2) origin.originInSlice[1] += sizeDiff;
    }
    return origin;
  }

  /** 返回扁平化的阴影索引表(供 GPU 端 compute shader 一次 dispatch 解析)。 */
  getShadowmapIndexTable(): ShadowmapIndexNode[] {
    this.assertFinalized();
    return this.indexTableData;
  }

  // ── 私有工具 ────────────────────────────────────────────────────────────

  private assertFinalized(): void {
    if (this.requireFinalize) {
      throw new Error('ShadowmapAtlas: 必须先调用 finalize() 再查询。');
    }
  }

  /** 把 Location 当 "digitIndex>0 位是 4 进制数" 进位,0 位是切片索引直接 +1。 */
  private succeedLocation(location: number[]): void {
    for (let digitIndex = location.length - 1; digitIndex > 0; --digitIndex) {
      if (location[digitIndex] < LOCATION_INDEX_COUNT - 1) {
        ++location[digitIndex];
        return;
      }
      location[digitIndex] = 0; // 进位
    }
    ++location[0]; // 切片索引越界进位:新开一层切片
  }

  /** 把 index 写入树中对应 Location 父节点的槽位。 */
  private setShadowmapIndexInTree(location: number[], index: number): void {
    const parentLocation = location.slice(0, -1);
    const parentNode = this.getNodeOfTree(parentLocation);
    if (parentLocation.length === 0) {
      // 父是根:根节点的槽位个数在 finalize 期间动态增长。
      parentNode.push(index);
    } else {
      parentNode[location[location.length - 1]] = index;
    }
  }

  /** 获取 Location 对应树节点(不存在则创建,并保证祖先链存在)。 */
  private getNodeOfTree(location: number[]): number[] {
    const key = location.join(',');
    const existing = this.tree.get(key);
    if (existing) return existing;

    if (location.length === 0) {
      // 根节点:槽位数 = 切片数,尚未确定,先在 finalize 期间动态 push。
      this.tree.set(key, []);
    } else {
      const parentLocation = location.slice(0, -1);
      const parentNode = this.getNodeOfTree(parentLocation);
      if (parentLocation.length === 0 && location[location.length - 1] >= parentNode.length) {
        // 根节点需要往里占位(该位置被多个子阴影共享,先填无效哨兵)。
        parentNode.push(INVALID_SHADOWMAP_INDEX);
      }
      // 非根节点固定 4 个槽位(LOCATION_INDEX_COUNT),初始全为无效索引。
      this.tree.set(key, new Array<number>(LOCATION_INDEX_COUNT).fill(INVALID_SHADOWMAP_INDEX));
    }
    return this.tree.get(key)!;
  }

  /**
   * 把位置树扁平化成一维索引表:
   *   - 根子表(Location [])长度 = 切片数;
   *   - 其余每个子表长度 = 4。
   * 槽位:有阴影填 shadowmapIndex(nextTableOffset=0);
   *       无阴影但存在子子表则填子子表偏移(nextTableOffset=…),否则留无效。
   */
  private buildIndexTableData(): void {
    const rootSubtableSize = this.getArraySliceCount();

    // 收集所有非根子表并按字典序排序,确定它们在表中相对根子表的拼接顺序。
    const nonRootLocations: number[][] = [];
    for (const key of this.tree.keys()) {
      const loc = key === '' ? [] : key.split(',').map(Number);
      if (loc.length > 0) nonRootLocations.push(loc);
    }
    nonRootLocations.sort((a, b) => {
      const minLen = Math.min(a.length, b.length);
      for (let i = 0; i < minLen; ++i) {
        if (a[i] !== b[i]) return a[i] - b[i];
      }
      return a.length - b.length;
    });

    const subtableIndex = new Map<string, number>();
    for (let i = 0; i < nonRootLocations.length; ++i) {
      subtableIndex.set(nonRootLocations[i].join(','), i);
    }

    if (nonRootLocations.length === 0) {
      this.indexTableData = this.makeRootRows(rootSubtableSize);
      return;
    }

    const total =
      rootSubtableSize + nonRootLocations.length * LOCATION_INDEX_COUNT;
    const table: ShadowmapIndexNode[] = Array.from(
      { length: total },
      () => ({ nextTableOffset: 0, shadowmapIndex: INVALID_SHADOWMAP_INDEX }),
    );

    for (const [key, indicesInNode] of this.tree) {
      const location = key === '' ? [] : key.split(',').map(Number);
      let digitCount = LOCATION_INDEX_COUNT;
      let indexInTableBase = 0;
      if (location.length === 0) {
        digitCount = this.maxArraySlice + 1;
      } else {
        indexInTableBase = rootSubtableSize + subtableIndex.get(key)! * LOCATION_INDEX_COUNT;
      }
      for (let digit = 0; digit < digitCount; ++digit) {
        const indexInTable = indexInTableBase + digit;
        const value = indicesInNode[digit];
        if (value === INVALID_SHADOWMAP_INDEX) {
          // 本位置无阴影:查询是否有子子表,有则写入偏移供 GPU 跳转。
          const childLocation = location.concat([digit]);
          const childKey = childLocation.join(',');
          const childIdx = subtableIndex.get(childKey);
          if (childIdx !== undefined) {
            table[indexInTable].nextTableOffset =
              rootSubtableSize + childIdx * LOCATION_INDEX_COUNT;
          }
        } else {
          table[indexInTable].shadowmapIndex = value;
          table[indexInTable].nextTableOffset = 0;
        }
      }
    }

    this.indexTableData = table;
  }

  /** 无任何阴影时,索引表退化为"根子表=切片数个无效槽"最小的合法表。 */
  private makeRootRows(rootSubtableSize: number): ShadowmapIndexNode[] {
    return Array.from(
      { length: rootSubtableSize },
      () => ({ nextTableOffset: 0, shadowmapIndex: INVALID_SHADOWMAP_INDEX }),
    );
  }
}