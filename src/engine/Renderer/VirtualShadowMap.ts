// VirtualShadowMap — 虚拟阴影贴图 (Virtual Shadow Maps, VSM)。
//
// 适配自 UE5 Virtual Shadow Maps (Engstrom & Persson 2021) + o3de Atom
// VirtualShadowMapPass。把阴影贴图视为虚拟资源:将阴影视锥体划分为
// 固定大小的 page(典型 128×128 texel),按需分配到物理 atlas(典型
// 8192×8192)中,并对远离相机的区域使用更低 mip 级别,实现"每像素阴影
// 分辨率自适应"——近处高精度、远处低精度,避免传统阴影贴图的固定分辨率
// 限制,也消除了 CSM 的级间接缝问题。
//
// 核心数据结构:
//   - PageTable: 虚拟 page (mipLevel + pageX + pageY) → 物理 page 索引
//   - PhysicalAtlas: 大尺寸阴影纹理,容纳所有已分配的 page
//   - mip 链: 每个 mip 级别对应不同的虚拟分辨率(根 mip = 全分辨率)
//
// 与现有阴影方案的关系:
//   - ShadowMapManager (basic/PCF/PCSS): 单张固定分辨率阴影贴图
//   - CSMShadowMap / CascadedShadowMap: 多级级联,有接缝问题
//   - ExponentialShadowMap: 指数阴影贴图(线性滤波)
//   - VirtualShadowMap: 自适应分辨率,理论上无上限分辨率
//
// soup3D 仅有基础硬阴影,无虚拟阴影贴图。
//
// 参考:
//   - UE5 Virtual Shadow Maps (Engstrom & Persson, SIGGRAPH 2021)
//   - o3de Atom VirtualShadowMapPass
//   - Myers & Bavoil "Stencil Routed K-Buffer" (2022)
//   - Karis "Real Shadows in Real Time with VSM" (UE blog 2020)

// ── 类型 ────────────────────────────────────────────────────────────

/** 虚拟 page 标识:mip 级别 + page 坐标。 */
export interface VirtualPageId {
  /** mip 级别(0 = 最高分辨率,数字越大越粗)。 */
  mipLevel: number;
  /** 该 mip 级别下的 page X 坐标(0..pagesPerSide-1)。 */
  pageX: number;
  /** 该 mip 级别下的 page Y 坐标(0..pagesPerSide-1)。 */
  pageY: number;
}

/** 物理 page 在 atlas 中的位置。 */
export interface PhysicalPage {
  /** 在 atlas 中的 page X 坐标(0..atlasPagesPerSide-1)。 */
  atlasPageX: number;
  /** 在 atlas 中的 page Y 坐标(0..atlasPagesPerSide-1)。 */
  atlasPageY: number;
  /** 该 page 是否已分配(有有效深度数据)。 */
  valid: boolean;
  /** 帧编号:上次写入时的帧号,用于 LRU 淘汰。 */
  lastUsedFrame: number;
}

/** VSM 配置参数。 */
export interface VSMOptions {
  /** 单个 page 的 texel 尺寸(默认 128)。 */
  pageSize?: number;
  /** 物理 atlas 的 texel 尺寸(默认 8192,需为 pageSize 的整数倍)。 */
  atlasSize?: number;
  /** mip 级别数(默认 5,即根 mip + 4 级粗化)。 */
  maxMipLevels?: number;
  /** 目标 texel 密度:屏幕像素与阴影 texel 的比率(默认 1.0 = 1:1)。 */
  texelDensity?: number;
  /** 是否启用边界 clamp(默认 true,避免 page 边缘渗漏)。 */
  clampBorder?: boolean;
}

/** VSM 采样结果。 */
export interface VSMSampleResult {
  /** 采样到的深度值(0..1,光空间线性深度)。 */
  depth: number;
  /** 采样 UV 是否落在有效 page 内。 */
  valid: boolean;
  /** 实际使用的 mip 级别(可能因 clamp 而调整)。 */
  mipLevel: number;
  /** 物理 atlas UV(0..1)。 */
  atlasUV: { u: number; v: number };
}

// ── 工具函数 ────────────────────────────────────────────────────────

/**
 * 计算 mip 级别数对应的每边 page 数。
 * 根 mip (level 0) 有 maxMipPages 个 page,每升一级减半。
 *
 * @param maxMipLevels 总 mip 级别数
 * @returns 各 mip 级别的每边 page 数数组
 */
export function computePagesPerSide(maxMipLevels: number): number[] {
  const result: number[] = [];
  // 根 mip 的 page 数:2^(maxMipLevels-1)
  const rootPages = 1 << (maxMipLevels - 1);
  for (let i = 0; i < maxMipLevels; i++) {
    result.push(rootPages >> i);
  }
  return result;
}

/**
 * 计算每个 mip 级别的虚拟分辨率(texel)。
 * level 0 = pageSize × rootPages;每升一级减半。
 *
 * @param pageSize 单 page texel 尺寸
 * @param maxMipLevels 总 mip 级别数
 * @returns 各 mip 级别的单边 texel 分辨率
 */
export function computeVirtualResolution(pageSize: number, maxMipLevels: number): number[] {
  const pagesPerSide = computePagesPerSide(maxMipLevels);
  return pagesPerSide.map((p) => p * pageSize);
}

/**
 * 选择 mip 级别:基于屏幕空间 texel 密度。
 *
 * 原理:屏幕上 1 像素对应阴影空间多少 texel?
 *   - 比率 ≤ 1.0:用最高分辨率(mip 0)
 *   - 比率 > 1.0:每翻倍升 1 级 mip
 *
 * 这与 UE5 的 mip 选择策略一致:保证每屏幕像素至少有 1 个阴影 texel,
 * 但不为不可见的区域浪费分辨率。
 *
 * @param texelRatio 屏幕像素对应的阴影 texel 数(屏幕导数)
 * @param maxMipLevels 最大 mip 级别数
 * @param texelDensity 目标 texel 密度(1.0 = 1:1)
 * @returns 选中的 mip 级别(0..maxMipLevels-1)
 */
export function selectMipLevel(
  texelRatio: number,
  maxMipLevels: number,
  texelDensity: number = 1.0,
): number {
  if (texelRatio <= texelDensity) return 0;
  // log2(texelRatio / texelDensity) = 需要降多少级
  const level = Math.floor(Math.log2(texelRatio / texelDensity));
  return Math.max(0, Math.min(maxMipLevels - 1, level));
}

/**
 * 计算 virtual page ID:从阴影 UV + mip 级别推导 page 坐标。
 *
 * @param u 阴影空间 UV(0..1)
 * @param v 阴影空间 UV(0..1)
 * @param mipLevel mip 级别
 * @param maxMipLevels 总 mip 级别数
 * @returns VirtualPageId
 */
export function computePageId(
  u: number,
  v: number,
  mipLevel: number,
  maxMipLevels: number,
): VirtualPageId {
  const pagesPerSide = computePagesPerSide(maxMipLevels);
  const pps = pagesPerSide[mipLevel];
  // clamp UV 到 [0, 1)
  const cu = Math.max(0, Math.min(0.999999, u));
  const cv = Math.max(0, Math.min(0.999999, v));
  return {
    mipLevel,
    pageX: Math.floor(cu * pps),
    pageY: Math.floor(cv * pps),
  };
}

/**
 * 将虚拟 UV 转换为物理 atlas UV。
 *
 * 给定虚拟 UV + mip 级别 + 物理 page 在 atlas 中的位置,
 * 计算该 UV 在物理 atlas 中的实际采样坐标。
 *
 * @param virtualU 虚拟 UV u 分量(0..1)
 * @param virtualV 虚拟 UV v 分量(0..1)
 * @param mipLevel mip 级别
 * @param maxMipLevels 总 mip 级别数
 * @param atlasPageX 物理 page X(0..atlasPagesPerSide-1)
 * @param atlasPageY 物理 page Y(0..atlasPagesPerSide-1)
 * @param pageSize 单 page texel 尺寸
 * @param atlasSize atlas texel 尺寸
 * @returns atlas UV {u, v} 在 0..1 范围
 */
export function packPageUV(
  virtualU: number,
  virtualV: number,
  mipLevel: number,
  maxMipLevels: number,
  atlasPageX: number,
  atlasPageY: number,
  pageSize: number,
  atlasSize: number,
): { u: number; v: number } {
  const pagesPerSide = computePagesPerSide(maxMipLevels);
  const pps = pagesPerSide[mipLevel];

  // 虚拟 UV 在 page 内的局部坐标(0..1)
  const pageLocalU = (virtualU * pps) - Math.floor(virtualU * pps);
  const pageLocalV = (virtualV * pps) - Math.floor(virtualV * pps);

  // 物理 atlas 中的 texel 坐标
  const atlasTexelX = atlasPageX * pageSize + pageLocalU * pageSize;
  const atlasTexelY = atlasPageY * pageSize + pageLocalV * pageSize;

  // 转换为 atlas UV(0..1)
  return {
    u: atlasTexelX / atlasSize,
    v: atlasTexelY / atlasSize,
  };
}

/**
 * 计算物理 atlas 每边可容纳多少个 page。
 *
 * @param atlasSize atlas texel 尺寸
 * @param pageSize 单 page texel 尺寸
 * @returns 每边 page 数
 */
export function computeAtlasPagesPerSide(atlasSize: number, pageSize: number): number {
  return Math.floor(atlasSize / pageSize);
}

/**
 * 计算物理 atlas 的总 page 容量。
 *
 * @param atlasSize atlas texel 尺寸
 * @param pageSize 单 page texel 尺寸
 * @returns 总 page 数
 */
export function computeAtlasCapacity(atlasSize: number, pageSize: number): number {
  const pps = computeAtlasPagesPerSide(atlasSize, pageSize);
  return pps * pps;
}

// ── PageTable: 虚拟 page → 物理 page 映射 ──────────────────────────

/**
 * 页表:管理虚拟 page (mip + pageX + pageY) 到物理 page 索引的映射。
 *
 * 用 Map<string, PhysicalPage> 存储,key = `${mipLevel}:${pageX}:${pageY}`。
 * 支持 LRU 淘汰:当物理 page 容量耗尽时,淘汰最久未使用的 page。
 */
export class PageTable {
  private _map = new Map<string, PhysicalPage>();
  private _capacity: number;
  private _atlasPagesPerSide: number;

  constructor(atlasSize: number, pageSize: number) {
    this._atlasPagesPerSide = computeAtlasPagesPerSide(atlasSize, pageSize);
    this._capacity = this._atlasPagesPerSide * this._atlasPagesPerSide;
  }

  /** 物理 atlas 每边 page 数。 */
  get atlasPagesPerSide(): number {
    return this._atlasPagesPerSide;
  }

  /** 物理 atlas 总 page 容量。 */
  get capacity(): number {
    return this._capacity;
  }

  /** 当前已分配的 page 数。 */
  get allocatedCount(): number {
    return this._map.size;
  }

  /** 生成 page key。 */
  private _key(id: VirtualPageId): string {
    return `${id.mipLevel}:${id.pageX}:${id.pageY}`;
  }

  /** 查找虚拟 page 对应的物理 page。未分配返回 null。 */
  find(id: VirtualPageId): PhysicalPage | null {
    return this._map.get(this._key(id)) ?? null;
  }

  /**
   * 分配一个物理 page 给虚拟 page。
   *
   * 如果该虚拟 page 已分配,更新 lastUsedFrame 并返回。
   * 如果容量已满,执行 LRU 淘汰最久未使用的 page。
   *
   * @param id 虚拟 page ID
   * @param frame 当前帧编号
   * @returns 分配的物理 page
   */
  allocate(id: VirtualPageId, frame: number): PhysicalPage {
    const key = this._key(id);
    const existing = this._map.get(key);
    if (existing) {
      existing.lastUsedFrame = frame;
      existing.valid = true;
      return existing;
    }

    // 容量已满 → LRU 淘汰
    if (this._map.size >= this._capacity) {
      this._evictLRU();
    }

    // 找一个空闲的物理 page 位置
    const slot = this._findFreeSlot();
    const physical: PhysicalPage = {
      atlasPageX: slot.x,
      atlasPageY: slot.y,
      valid: true,
      lastUsedFrame: frame,
    };
    this._map.set(key, physical);
    return physical;
  }

  /**
   * 标记一个虚拟 page 为无效(深度数据过期)。
   * 不释放物理 page 空间,但标记 valid=false。
   */
  invalidate(id: VirtualPageId): void {
    const entry = this._map.get(this._key(id));
    if (entry) {
      entry.valid = false;
    }
  }

  /**
   * 清理:移除所有 lastUsedFrame < minFrame 的 page。
   * 用于每帧结束后回收不再可见的 page。
   *
   * @param minFrame 最小帧编号,早于此帧的 page 被回收
   * @returns 回收的 page 数
 */
  gc(minFrame: number): number {
    let removed = 0;
    for (const [key, page] of this._map) {
      if (page.lastUsedFrame < minFrame) {
        this._map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** 清空所有 page。 */
  clear(): void {
    this._map.clear();
  }

  /** LRU 淘汰:移除 lastUsedFrame 最小的 page。 */
  private _evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestFrame = Infinity;
    for (const [key, page] of this._map) {
      if (page.lastUsedFrame < oldestFrame) {
        oldestFrame = page.lastUsedFrame;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this._map.delete(oldestKey);
    }
  }

  /** 找一个空闲的物理 page 位置(线性扫描)。 */
  private _findFreeSlot(): { x: number; y: number } {
    const used = new Set<number>();
    for (const page of this._map.values()) {
      used.add(page.atlasPageY * this._atlasPagesPerSide + page.atlasPageX);
    }
    for (let i = 0; i < this._capacity; i++) {
      if (!used.has(i)) {
        return {
          x: i % this._atlasPagesPerSide,
          y: Math.floor(i / this._atlasPagesPerSide),
        };
      }
    }
    // 不应该到这里(_evictLRU 已保证有空位)
    return { x: 0, y: 0 };
  }
}

// ── 采样函数 ────────────────────────────────────────────────────────

/**
 * 采样虚拟阴影贴图。
 *
 * 完整流程:
 *   1. 根据 texelRatio 选择 mip 级别
 *   2. 计算 virtual page ID
 *   3. 查页表获取物理 page
 *   4. 如果 page 未分配或无效,返回 valid=false
 *   5. 将虚拟 UV 转换为 atlas UV
 *   6. 从 atlas 深度数据中采样
 *
 * @param depthAtlas 物理 atlas 深度数据(Float32Array, atlasSize×atlasSize)
 * @param atlasSize atlas texel 尺寸
 * @param pageTable 页表
 * @param virtualU 虚拟阴影 UV u(0..1)
 * @param virtualV 虚拟阴影 UV v(0..1)
 * @param texelRatio 屏幕空间 texel 密度比率
 * @param options VSM 配置
 * @returns 采样结果
 */
export function sampleVSM(
  depthAtlas: Float32Array,
  atlasSize: number,
  pageTable: PageTable,
  virtualU: number,
  virtualV: number,
  texelRatio: number,
  options: Required<VSMOptions>,
): VSMSampleResult {
  const { pageSize, maxMipLevels, texelDensity } = options;

  // 1. 选择 mip 级别
  const mipLevel = selectMipLevel(texelRatio, maxMipLevels, texelDensity);

  // 2. 计算 page ID
  const pageId = computePageId(virtualU, virtualV, mipLevel, maxMipLevels);

  // 3. 查页表
  const physical = pageTable.find(pageId);

  // 4. page 未分配或无效
  if (!physical || !physical.valid) {
    return {
      depth: 1.0, // 默认无遮挡
      valid: false,
      mipLevel,
      atlasUV: { u: 0, v: 0 },
    };
  }

  // 5. 虚拟 UV → atlas UV
  const atlasUV = packPageUV(
    virtualU, virtualV,
    mipLevel, maxMipLevels,
    physical.atlasPageX, physical.atlasPageY,
    pageSize, atlasSize,
  );

  // 6. 从 atlas 采样深度
  const texelX = Math.max(0, Math.min(atlasSize - 1, Math.floor(atlasUV.u * atlasSize)));
  const texelY = Math.max(0, Math.min(atlasSize - 1, Math.floor(atlasUV.v * atlasSize)));
  const depth = depthAtlas[texelY * atlasSize + texelX];

  return {
    depth: depth ?? 1.0,
    valid: true,
    mipLevel,
    atlasUV,
  };
}

/**
 * 向物理 atlas 写入深度数据(单个 page)。
 *
 * 将一个 page 大小的深度数据写入 atlas 的指定物理 page 位置。
 * 用于 shadow rendering pass 把深度渲染到虚拟 page 后回写到 atlas。
 *
 * @param depthAtlas atlas 深度数据(会被原地修改)
 * @param atlasSize atlas texel 尺寸
 * @param pageSize 单 page texel 尺寸
 * @param atlasPageX 物理 page X 坐标
 * @param atlasPageY 物理 page Y 坐标
 * @param pageData page 深度数据(pageSize×pageSize)
 */
export function writePageToAtlas(
  depthAtlas: Float32Array,
  atlasSize: number,
  pageSize: number,
  atlasPageX: number,
  atlasPageY: number,
  pageData: Float32Array,
): void {
  const baseX = atlasPageX * pageSize;
  const baseY = atlasPageY * pageSize;
  for (let y = 0; y < pageSize; y++) {
    const dstRow = (baseY + y) * atlasSize + baseX;
    const srcRow = y * pageSize;
    for (let x = 0; x < pageSize; x++) {
      depthAtlas[dstRow + x] = pageData[srcRow + x];
    }
  }
}

/**
 * 从物理 atlas 读取一个 page 的深度数据(用于调试 / 验证)。
 *
 * @param depthAtlas atlas 深度数据
 * @param atlasSize atlas texel 尺寸
 * @param pageSize 单 page texel 尺寸
 * @param atlasPageX 物理 page X 坐标
 * @param atlasPageY 物理 page Y 坐标
 * @returns page 深度数据(pageSize×pageSize)
 */
export function readPageFromAtlas(
  depthAtlas: Float32Array,
  atlasSize: number,
  pageSize: number,
  atlasPageX: number,
  atlasPageY: number,
): Float32Array {
  const result = new Float32Array(pageSize * pageSize);
  const baseX = atlasPageX * pageSize;
  const baseY = atlasPageY * pageSize;
  for (let y = 0; y < pageSize; y++) {
    const srcRow = (baseY + y) * atlasSize + baseX;
    for (let x = 0; x < pageSize; x++) {
      result[y * pageSize + x] = depthAtlas[srcRow + x];
    }
  }
  return result;
}

/**
 * 计算阴影可见度(0=完全遮挡,1=无遮挡)。
 *
 * 比较 receiver 深度与 atlas 中存储的深度,带可选 bias。
 * 这与 PCF 的单采样版本等价,但数据来源是虚拟 page 而非固定纹理。
 *
 * @param receiverDepth receiver 的光空间深度(0..1)
 * @param storedDepth atlas 中存储的深度(0..1)
 * @param bias 深度偏移
 * @returns 0(全阴影)或 1(无阴影)
 */
export function vsmVisibility(
  receiverDepth: number,
  storedDepth: number,
  bias: number = 0.001,
): number {
  return receiverDepth - bias > storedDepth ? 0.0 : 1.0;
}

/**
 * PCF 4-tap 采样虚拟阴影贴图(在 atlas UV 周围采样 4 个点取平均)。
 *
 * 用于软化阴影边缘。由于 atlas 中每个 page 是独立分配的,
 * 跨 page 边界的 PCF 采样需要特别处理:如果相邻 texel 落在不同 page,
 * 需要分别查页表。本简化版假设 4-tap 在同一 page 内。
 *
 * @param depthAtlas atlas 深度数据
 * @param atlasSize atlas texel 尺寸
 * @param atlasUV 中心 atlas UV
 * @param texelSize atlas 中 1 texel 的 UV 偏移(1/atlasSize)
 * @param receiverDepth receiver 深度
 * @param bias 深度偏移
 * @returns 0..1 可见度(4-tap 平均)
 */
export function vsmVisibilityPCF4(
  depthAtlas: Float32Array,
  atlasSize: number,
  atlasUV: { u: number; v: number },
  texelSize: number,
  receiverDepth: number,
  bias: number = 0.001,
): number {
  let sum = 0.0;
  // 4-tap: 偏移到 4 个 texel 中心(2×2 网格)
  const offsets = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ];
  for (const [dx, dy] of offsets) {
    const u = atlasUV.u + dx * texelSize;
    const v = atlasUV.v + dy * texelSize;
    const tx = Math.max(0, Math.min(atlasSize - 1, Math.floor(u * atlasSize)));
    const ty = Math.max(0, Math.min(atlasSize - 1, Math.floor(v * atlasSize)));
    const stored = depthAtlas[ty * atlasSize + tx];
    sum += vsmVisibility(receiverDepth, stored, bias);
  }
  return sum / 4.0;
}

/**
 * 标记一组可见 page 为需要更新(用于脏标记渲染)。
 *
 * 给定屏幕空间可见的阴影 UV 范围 + 对应的 texelRatio,
 * 计算需要分配 / 更新的 page 列表。
 *
 * @param minUV 可见区域最小 UV
 * @param maxUV 可见区域最大 UV
 * @param texelRatio 屏幕空间 texel 密度
 * @param options VSM 配置
 * @returns 需要更新的 page ID 列表
 */
export function computeVisiblePages(
  minUV: { u: number; v: number },
  maxUV: { u: number; v: number },
  texelRatio: number,
  options: Required<VSMOptions>,
): VirtualPageId[] {
  const { maxMipLevels, texelDensity } = options;
  const mipLevel = selectMipLevel(texelRatio, maxMipLevels, texelDensity);
  const pagesPerSide = computePagesPerSide(maxMipLevels);
  const pps = pagesPerSide[mipLevel];

  const minPageX = Math.max(0, Math.floor(minUV.u * pps));
  const maxPageX = Math.min(pps - 1, Math.floor(maxUV.u * pps));
  const minPageY = Math.max(0, Math.floor(minUV.v * pps));
  const maxPageY = Math.min(pps - 1, Math.floor(maxUV.v * pps));

  const result: VirtualPageId[] = [];
  for (let py = minPageY; py <= maxPageY; py++) {
    for (let px = minPageX; px <= maxPageX; px++) {
      result.push({ mipLevel, pageX: px, pageY: py });
    }
  }
  return result;
}

// ── 默认配置 ────────────────────────────────────────────────────────

/** 默认 VSM 配置(pageSize=128, atlasSize=8192, maxMipLevels=5, texelDensity=1.0)。 */
export const DEFAULT_VSM_OPTIONS: Required<VSMOptions> = {
  pageSize: 128,
  atlasSize: 8192,
  maxMipLevels: 5,
  texelDensity: 1.0,
  clampBorder: true,
};

/**
 * 将 VSMOptions 填充为 Required<VSMOptions>(用默认值补全未指定的字段)。
 */
export function applyVSMDefaults(opts: VSMOptions = {}): Required<VSMOptions> {
  return { ...DEFAULT_VSM_OPTIONS, ...opts };
}

// ── GLSL chunk ──────────────────────────────────────────────────────

/**
 * GLSL chunk: VSM mip 选择 + page 查找 + atlas UV 打包。
 *
 * 适用于 WebGL2 片段着色器,需要传入:
 *   - u_vsmAtlas: sampler2D (atlas 深度纹理)
 *   - u_vsmPageTable: usampler2D (页表纹理,mip+pageX+pageY → atlasPageX+atlasPageY)
 *   - u_vsmAtlasSize: float (atlas texel 尺寸)
 *   - u_vsmPageSize: float (单 page texel 尺寸)
 *   - u_vsmMaxMipLevels: int (最大 mip 级别数)
 *   - u_vsmTexelDensity: float (目标 texel 密度)
 *
 * 使用方法:
 *   float visibility = vsmSample(u_vsmAtlas, shadowUV, texelRatio, receiverDepth);
 */
export const VSM_SAMPLE_GLSL = /* glsl */ `
// ── Virtual Shadow Map sampling (UE5 VSM / o3de Atom) ───────────────
// 在片段着色器中采样虚拟阴影贴图。
// 输入: shadowUV(0..1)、texelRatio(屏幕导数)、receiverDepth
// 输出: 0..1 可见度

uniform sampler2D u_vsmAtlas;        // 物理深度 atlas
uniform usampler2D u_vsmPageTable;   // 页表(RG32UI: x=atlasPageX, y=atlasPageY, bit31=valid)
uniform float u_vsmAtlasSize;        // atlas texel 尺寸
uniform float u_vsmPageSize;         // 单 page texel 尺寸
uniform int   u_vsmMaxMipLevels;     // 最大 mip 级别数
uniform float u_vsmTexelDensity;     // 目标 texel 密度
uniform float u_vsmBias;             // 深度偏移

// 选择 mip 级别
int vsmSelectMipLevel(float texelRatio) {
  if (texelRatio <= u_vsmTexelDensity) return 0;
  float level = floor(log2(texelRatio / u_vsmTexelDensity));
  return int(clamp(level, 0.0, float(u_vsmMaxMipLevels - 1)));
}

// 计算 page 坐标(给定 mip 级别)
ivec2 vsmComputePageCoord(vec2 uv, int mipLevel) {
  int rootPages = 1 << (u_vsmMaxMipLevels - 1);
  int pps = rootPages >> mipLevel;
  vec2 clamped = clamp(uv, vec2(0.0), vec2(0.999999));
  return ivec2(clamped * float(pps));
}

// 查页表:返回 atlasPageXY + valid 标志
vec4 vsmLookupPageTable(int mipLevel, ivec2 pageCoord) {
  // 页表纹理布局: 每行存一个 mip 级别的所有 page
  // 简化:用 2D 纹理,pageCoord → texel
  uvec4 packed = texelFetch(u_vsmPageTable, pageCoord, mipLevel);
  // bit31=valid, bits 0..15=atlasPageX, bits 16..30=atlasPageY
  float valid = float((packed.r >> 31u) & 1u);
  float atlasPageX = float(packed.r & 0xFFFFu);
  float atlasPageY = float((packed.r >> 16u) & 0x7FFFu);
  return vec4(atlasPageX, atlasPageY, valid, 0.0);
}

// 虚拟 UV → atlas UV
vec2 vsmPackPageUV(vec2 virtualUV, int mipLevel, vec2 atlasPage) {
  int rootPages = 1 << (u_vsmMaxMipLevels - 1);
  int pps = rootPages >> mipLevel;
  vec2 pageLocal = fract(virtualUV * float(pps));
  vec2 atlasTexel = atlasPage * u_vsmPageSize + pageLocal * u_vsmPageSize;
  return atlasTexel / u_vsmAtlasSize;
}

// 主采样函数:返回 0..1 可见度
float vsmSample(sampler2D shadowMap, vec2 shadowUV, float texelRatio, float receiverDepth) {
  int mipLevel = vsmSelectMipLevel(texelRatio);
  ivec2 pageCoord = vsmComputePageCoord(shadowUV, mipLevel);
  vec4 pageInfo = vsmLookupPageTable(mipLevel, pageCoord);

  // page 未分配 → 无遮挡
  if (pageInfo.z < 0.5) return 1.0;

  vec2 atlasUV = vsmPackPageUV(shadowUV, mipLevel, pageInfo.xy);
  float storedDepth = texture(shadowMap, atlasUV).r;

  // 单采样可见度(可替换为 PCF)
  return receiverDepth - u_vsmBias > storedDepth ? 0.0 : 1.0;
}

// PCF 4-tap 采样
float vsmSamplePCF4(sampler2D shadowMap, vec2 shadowUV, float texelRatio, float receiverDepth) {
  int mipLevel = vsmSelectMipLevel(texelRatio);
  ivec2 pageCoord = vsmComputePageCoord(shadowUV, mipLevel);
  vec4 pageInfo = vsmLookupPageTable(mipLevel, pageCoord);

  if (pageInfo.z < 0.5) return 1.0;

  vec2 atlasUV = vsmPackPageUV(shadowUV, mipLevel, pageInfo.xy);
  float texelSize = 1.0 / u_vsmAtlasSize;

  float sum = 0.0;
  sum += (receiverDepth - u_vsmBias > texture(shadowMap, atlasUV + vec2(-0.5, -0.5) * texelSize).r) ? 0.0 : 1.0;
  sum += (receiverDepth - u_vsmBias > texture(shadowMap, atlasUV + vec2( 0.5, -0.5) * texelSize).r) ? 0.0 : 1.0;
  sum += (receiverDepth - u_vsmBias > texture(shadowMap, atlasUV + vec2(-0.5,  0.5) * texelSize).r) ? 0.0 : 1.0;
  sum += (receiverDepth - u_vsmBias > texture(shadowMap, atlasUV + vec2( 0.5,  0.5) * texelSize).r) ? 0.0 : 1.0;
  return sum * 0.25;
}
`;
