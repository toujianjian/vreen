// VirtualTexturing — 稀疏虚拟纹理(Sparse Virtual Texture, SVT)系统。
//
// 设计目标:
//   - 把超大虚拟纹理(如 16384×16384)分页化,按需把页面加载到有限的
//     物理纹理图集中,突破 GPU 显存上限。只有被采样到的页面才驻留显存。
//   - 与 TextureStreaming(Mip 级别流式)互补:
//       TextureStreaming 按距离/屏幕占比决定加载到第几层 mip,整张纹理
//       仍然是一次性加载某层完整 mip,适合"中等分辨率纹理 × N 张"。
//       VirtualTexturing 把单张超大纹理分页,只加载被采样的页面,
//       适合"单张超大纹理(地形 mega-texture、卫星图、8K+ 角色)"。
//   - 与 VirtualShadowMap(阴影虚拟纹理)同构:
//       VSM 把阴影图分页到物理图集,SVT 把颜色纹理分页到物理图集。
//       两者都使用 PageTable(mip + pageX + pageY → physicalPage)模式。
//
// 数据模型:
//   - VirtualTextureDescriptor: 描述一张虚拟纹理(尺寸、格式、mip 数)。
//   - PageTable: 虚拟页面 (mip, pageX, pageY) → 物理页面索引 + 状态。
//   - PhysicalTextureAtlas: 物理纹理图集(atlasSize × atlasSize,
//     分成 pagesPerSide × pagesPerSide 个物理页面槽位)。
//   - PageCache: LRU 缓存,追踪哪些虚拟页面驻留在物理图集中。
//   - FeedbackBuffer: GPU 回传的页面需求反馈(哪些 UV 被采样)。
//   - PageProvider: 异步加载页面数据的回调接口(保持零运行时依赖)。
//
// 不变量:
//   - 物理图集槽位总数 = pagesPerSide²;
//   - 任意时刻驻留页面数 ≤ 物理槽位总数;
//   - PageTable 中 status='resident' 的条目其 physicalIndex 必须有效;
//   - LRU 驱逐时优先淘汰 lastUsed 最久 + priority 最低的页面;
//   - mip 0 的页面数 = (virtualSize / pageSize)²;
//   - 最高 mip 层级的页面数为 1(整个纹理缩到 1 个页面)。
//
// 参考:
//   - o3de Atom "Virtual Texture" (Gems/Atom/Asset/ImageStreaming)
//   - UE5 "Virtual Texturing" (TexturePageTable + FeedbackBuffer)
//   - Mellor 2004 "Virtual Texture Mapping" (SVT 原始论文)
//   - Bartholomäus Niesner 2009 "Practical Virtual Texture Rendering"
//   - VirtualShadowMap.ts(同构 PageTable + PhysicalAtlas 模式)
//   - TextureStreaming.ts(Mip 流式,互补关系)

import { createLogger } from '@/lib/logger';

const log = createLogger('VirtualTexturing');

// ── 类型定义 ────────────────────────────────────────────────────

/** 虚拟纹理描述符。 */
export interface VirtualTextureDescriptor {
  /** 虚拟纹理 id。 */
  id: string;
  /** 虚拟纹理宽度(像素,必须为 pageSize 的整数次幂)。 */
  virtualWidth: number;
  /** 虚拟纹理高度(像素)。 */
  virtualHeight: number;
  /** 纹理格式标识(如 'rgba8' / 'bc1' / 'bc7',仅记录用)。 */
  format: string;
  /** 通道数(用于计算页面字节大小,如 RGBA8 = 4)。 */
  channels: number;
  /** 每通道字节数(RGBA8 = 1, RGBA16F = 2)。 */
  bytesPerChannel: number;
}

/** 页面状态。 */
export type PageStatus = 'empty' | 'loading' | 'resident' | 'evicted';

/** 虚拟页面坐标(mip 层级 + 页面 XY)。 */
export interface VirtualPageCoord {
  mip: number;
  pageX: number;
  pageY: number;
}

/** 页面条目:PageTable 中的一条记录。 */
export interface PageTableEntry {
  /** 虚拟页面坐标。 */
  coord: VirtualPageCoord;
  /** 物理页面索引(在物理图集中的槽位,-1 表示未分配)。 */
  physicalIndex: number;
  /** 页面状态。 */
  status: PageStatus;
  /** 最近使用时间戳(performance.now 毫秒,LRU 用)。 */
  lastUsed: number;
  /** 优先级(数值越大越重要,驱逐时优先保留)。 */
  priority: number;
  /** 该页面的字节大小(用于内存统计)。 */
  sizeBytes: number;
}

/** 反馈记录:GPU 采样了某个虚拟页面。 */
export interface FeedbackEntry {
  /** 虚拟纹理 id。 */
  vtId: string;
  /** 被采样的 mip 层级。 */
  mip: number;
  /** 被采样的页面 X。 */
  pageX: number;
  /** 被采样的页面 Y。 */
  pageY: number;
  /** 采样次数(用于优先级排序,次数越多越重要)。 */
  sampleCount: number;
}

/** 物理页面槽位状态。 */
export interface PhysicalPageSlot {
  /** 槽位索引。 */
  index: number;
  /** 占用此槽位的虚拟页面坐标(null = 空闲)。 */
  occupant: VirtualPageCoord | null;
  /** 槽位在图集中的像素偏移 X。 */
  offsetX: number;
  /** 槽位在图集中的像素偏移 Y。 */
  offsetY: number;
}

/** 页面数据提供者:异步加载页面像素数据。 */
export type PageProvider = (
  vtId: string,
  coord: VirtualPageCoord,
) => Promise<Uint8Array | null>;

/** 虚拟纹理系统配置。 */
export interface VirtualTexturingConfig {
  /** 物理图集边长(像素,默认 8192)。 */
  atlasSize: number;
  /** 页面边长(像素,默认 128)。 */
  pageSize: number;
  /** 最大每帧加载数(默认 8,防止帧率抖动)。 */
  maxPagesPerFrame: number;
  /** 是否启用 LRU 驱逐(默认 true)。 */
  enableEviction: boolean;
}

/** 默认配置。 */
export const DEFAULT_VT_CONFIG: VirtualTexturingConfig = {
  atlasSize: 8192,
  pageSize: 128,
  maxPagesPerFrame: 8,
  enableEviction: true,
};

// ── 工具函数 ────────────────────────────────────────────────────

/**
 * 计算整数 log2(向上取整)。如:128→7, 129→8, 256→8。
 */
export function ceilLog2(n: number): number {
  if (n <= 1) return 0;
  let r = 0;
  let v = n - 1;
  while (v > 0) {
    r++;
    v >>= 1;
  }
  return r;
}

/**
 * 计算虚拟纹理的 mip 层级数。
 * 从 pageSize 粒度开始,直到 1×1 页面。
 * 如 virtualWidth=16384, pageSize=128:
 *   pages at mip0 = 128, mip1 = 64, ..., mip7 = 1
 *   total mips = 8
 */
export function computeMipCount(virtualWidth: number, virtualHeight: number, pageSize: number): number {
  const pagesX = Math.max(1, virtualWidth / pageSize);
  const pagesY = Math.max(1, virtualHeight / pageSize);
  const maxPages = Math.max(pagesX, pagesY);
  return ceilLog2(maxPages) + 1;
}

/**
 * 计算某 mip 层级的页面数(X 和 Y 方向)。
 * mip 0 = 最高分辨率(最多页面),最高 mip = 1×1。
 */
export function pagesAtMip(mip: number, virtualWidth: number, virtualHeight: number, pageSize: number): {
  pagesX: number;
  pagesY: number;
} {
  const basePagesX = Math.max(1, virtualWidth / pageSize);
  const basePagesY = Math.max(1, virtualHeight / pageSize);
  return {
    pagesX: Math.max(1, basePagesX >> mip),
    pagesY: Math.max(1, basePagesY >> mip),
  };
}

/**
 * 计算单个页面的字节大小(不含 padding)。
 */
export function pageByteSize(pageSize: number, channels: number, bytesPerChannel: number): number {
  return pageSize * pageSize * channels * bytesPerChannel;
}

/**
 * 计算物理图集的页面数(每边)。
 */
export function physicalPagesPerSide(atlasSize: number, pageSize: number): number {
  return Math.floor(atlasSize / pageSize);
}

/**
 * 计算物理图集总槽位数。
 */
export function physicalSlotCount(atlasSize: number, pageSize: number): number {
  const per = physicalPagesPerSide(atlasSize, pageSize);
  return per * per;
}

/**
 * 物理索引 → 图集像素偏移。
 */
export function physicalIndexToOffset(
  physicalIndex: number,
  atlasSize: number,
  pageSize: number,
): { offsetX: number; offsetY: number } {
  const per = physicalPagesPerSide(atlasSize, pageSize);
  const slotX = physicalIndex % per;
  const slotY = Math.floor(physicalIndex / per);
  return {
    offsetX: slotX * pageSize,
    offsetY: slotY * pageSize,
  };
}

/**
 * 虚拟 UV → 虚拟页面坐标 + 页内偏移。
 * uv ∈ [0, 1),返回 mip 层级的页面坐标和页内 [0,1) 偏移。
 */
export function virtualUVToPageCoord(
  u: number,
  v: number,
  mip: number,
  virtualWidth: number,
  virtualHeight: number,
  pageSize: number,
): { pageX: number; pageY: number; localU: number; localV: number } {
  const { pagesX, pagesY } = pagesAtMip(mip, virtualWidth, virtualHeight, pageSize);
  const fx = u * pagesX;
  const fy = v * pagesY;
  const pageX = Math.floor(fx) % pagesX;
  const pageY = Math.floor(fy) % pagesY;
  const localU = fx - Math.floor(fx);
  const localV = fy - Math.floor(fy);
  return { pageX, pageY, localU, localV };
}

/**
 * 虚拟页面坐标 → 该 mip 层级下的线性页面索引。
 * 用于 PageTable 内部存储(每张 VT 有独立的 PageTable)。
 */
export function pageCoordToLinearIndex(
  coord: VirtualPageCoord,
  virtualWidth: number,
  virtualHeight: number,
  pageSize: number,
): number {
  const { pagesX, pagesY } = pagesAtMip(coord.mip, virtualWidth, virtualHeight, pageSize);
  const clampedX = ((coord.pageX % pagesX) + pagesX) % pagesX;
  const clampedY = ((coord.pageY % pagesY) + pagesY) % pagesY;
  return clampedY * pagesX + clampedX;
}

/**
 * 根据屏幕空间尺寸推算需要的 mip 层级。
 * screenSpaceSize = 纹理在屏幕上占据的像素数。
 * 返回应该采样的 mip(0 = 最高分辨率)。
 */
export function desiredMipForScreenSize(
  screenSpaceSize: number,
  virtualWidth: number,
  virtualHeight: number,
  pageSize: number,
): number {
  const totalMips = computeMipCount(virtualWidth, virtualHeight, pageSize);
  if (screenSpaceSize <= 0) return totalMips - 1; // 太小,用最低分辨率
  // 每个页面覆盖 pageSize 个虚拟像素,需要 virtualSize/screenSize 个 texel,
  // 即 pageSize * (virtualSize/screenSize) 个页面。取 log2 得到 mip。
  const virtualSize = Math.max(virtualWidth, virtualHeight);
  const texelsPerPixel = virtualSize / Math.max(1, screenSpaceSize);
  const pagesNeeded = texelsPerPixel; // 每像素需要的 texel 数
  const mip = Math.floor(Math.log2(Math.max(1, pagesNeeded)));
  return Math.min(mip, totalMips - 1);
}

// ── PageTable ──────────────────────────────────────────────────

/**
 * 页面表:虚拟页面 → 物理页面映射。
 * 每个 VT 实例持有一个 PageTable。
 * 使用 Map<string, PageTableEntry> 存储,key = `${mip}:${pageX}:${pageY}`。
 */
export class PageTable {
  private entries = new Map<string, PageTableEntry>();
  readonly virtualWidth: number;
  readonly virtualHeight: number;
  readonly pageSize: number;
  readonly mipCount: number;

  constructor(desc: VirtualTextureDescriptor, pageSize: number) {
    this.virtualWidth = desc.virtualWidth;
    this.virtualHeight = desc.virtualHeight;
    this.pageSize = pageSize;
    this.mipCount = computeMipCount(desc.virtualWidth, desc.virtualHeight, pageSize);
  }

  private key(coord: VirtualPageCoord): string {
    return `${coord.mip}:${coord.pageX}:${coord.pageY}`;
  }

  /** 查询页面条目,不存在返回 null。 */
  get(coord: VirtualPageCoord): PageTableEntry | null {
    return this.entries.get(this.key(coord)) ?? null;
  }

  /** 设置/更新页面条目。 */
  set(entry: PageTableEntry): void {
    this.entries.set(this.key(entry.coord), entry);
  }

  /** 移除页面条目。 */
  delete(coord: VirtualPageCoord): void {
    this.entries.delete(this.key(coord));
  }

  /** 获取所有驻留页面。 */
  residentEntries(): PageTableEntry[] {
    const result: PageTableEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === 'resident') {
        result.push(entry);
      }
    }
    return result;
  }

  /** 获取所有条目。 */
  allEntries(): PageTableEntry[] {
    return Array.from(this.entries.values());
  }

  /** 当前驻留页面数。 */
  get residentCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === 'resident') count++;
    }
    return count;
  }

  /** 当前驻留页面总字节。 */
  get residentBytes(): number {
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === 'resident') bytes += entry.sizeBytes;
    }
    return bytes;
  }

  /** 清空所有条目。 */
  clear(): void {
    this.entries.clear();
  }
}

// ── PhysicalTextureAtlas ───────────────────────────────────────

/**
 * 物理纹理图集:固定大小的 GPU 纹理,分成 N×N 个页面槽位。
 * 每个槽位可以容纳一个虚拟页面的像素数据。
 */
export class PhysicalTextureAtlas {
  readonly atlasSize: number;
  readonly pageSize: number;
  readonly pagesPerSide: number;
  readonly slotCount: number;
  private slots: PhysicalPageSlot[];
  /** GPU 纹理数据(RGBA,实际格式由调用方决定)。纯 CPU 参考实现。 */
  data: Uint8Array | null = null;

  constructor(atlasSize: number, pageSize: number) {
    this.atlasSize = atlasSize;
    this.pageSize = pageSize;
    this.pagesPerSide = physicalPagesPerSide(atlasSize, pageSize);
    this.slotCount = this.pagesPerSide * this.pagesPerSide;
    this.slots = [];
    for (let i = 0; i < this.slotCount; i++) {
      const { offsetX, offsetY } = physicalIndexToOffset(i, atlasSize, pageSize);
      this.slots.push({
        index: i,
        occupant: null,
        offsetX,
        offsetY,
      });
    }
  }

  /** 分配一个空闲槽位,返回索引。-1 = 无空闲。 */
  allocateFreeSlot(): number {
    for (const slot of this.slots) {
      if (slot.occupant === null) {
        return slot.index;
      }
    }
    return -1;
  }

  /** 标记槽位被某虚拟页面占用。 */
  occupySlot(physicalIndex: number, coord: VirtualPageCoord): void {
    if (physicalIndex < 0 || physicalIndex >= this.slotCount) {
      throw new Error(`physicalIndex ${physicalIndex} out of range [0, ${this.slotCount})`);
    }
    this.slots[physicalIndex].occupant = coord;
  }

  /** 释放槽位(标记为空闲)。 */
  freeSlot(physicalIndex: number): void {
    if (physicalIndex < 0 || physicalIndex >= this.slotCount) return;
    this.slots[physicalIndex].occupant = null;
  }

  /** 查询槽位信息。 */
  getSlot(physicalIndex: number): PhysicalPageSlot {
    return this.slots[physicalIndex];
  }

  /** 查询所有被占用的槽位。 */
  occupiedSlots(): PhysicalPageSlot[] {
    return this.slots.filter((s) => s.occupant !== null);
  }

  /** 空闲槽位数。 */
  get freeSlotCount(): number {
    let count = 0;
    for (const slot of this.slots) {
      if (slot.occupant === null) count++;
    }
    return count;
  }

  /** 已占用槽位数。 */
  get occupiedSlotCount(): number {
    return this.slotCount - this.freeSlotCount;
  }

  /**
   * 把页面像素数据写入物理图集的指定槽位。
   * 调用方需保证 pageData 大小 = pageSize² × channels × bytesPerChannel。
   */
  uploadPageData(
    physicalIndex: number,
    pageData: Uint8Array,
    channels: number,
    bytesPerChannel: number,
  ): void {
    if (!this.data) {
      // 延迟分配图集数据(RGBA8 格式参考)
      const bytesPerPixel = 4; // 参考 RGBA8
      this.data = new Uint8Array(this.atlasSize * this.atlasSize * bytesPerPixel);
    }
    const slot = this.slots[physicalIndex];
    const bytesPerPixel = channels * bytesPerChannel;
    const atlasBytesPerPixel = 4; // 图集内部用 RGBA8
    for (let y = 0; y < this.pageSize; y++) {
      for (let x = 0; x < this.pageSize; x++) {
        const srcIdx = (y * this.pageSize + x) * bytesPerPixel;
        const dstX = slot.offsetX + x;
        const dstY = slot.offsetY + y;
        const dstIdx = (dstY * this.atlasSize + dstX) * atlasBytesPerPixel;
        // 逐通道拷贝(支持不同通道数)
        const copyChannels = Math.min(channels, atlasBytesPerPixel);
        for (let c = 0; c < copyChannels; c++) {
          this.data[dstIdx + c] = pageData[srcIdx + c];
        }
      }
    }
  }

  /** 释放图集数据。 */
  dispose(): void {
    this.data = null;
    for (const slot of this.slots) {
      slot.occupant = null;
    }
  }
}

// ── VirtualTexture ─────────────────────────────────────────────

/**
 * 单张虚拟纹理实例:持有描述符 + PageTable。
 * 物理图集由 VirtualTexturingSystem 统一管理(多张 VT 共享一个图集)。
 */
export class VirtualTexture {
  readonly descriptor: VirtualTextureDescriptor;
  readonly pageTable: PageTable;
  readonly pageSize: number;

  constructor(desc: VirtualTextureDescriptor, pageSize: number) {
    this.descriptor = desc;
    this.pageSize = pageSize;
    this.pageTable = new PageTable(desc, pageSize);
  }

  /** 该 VT 的 id。 */
  get id(): string {
    return this.descriptor.id;
  }

  /** 该 VT 的 mip 层级数。 */
  get mipCount(): number {
    return this.pageTable.mipCount;
  }

  /** 该 VT 当前驻留的页面数。 */
  get residentPageCount(): number {
    return this.pageTable.residentCount;
  }

  /** 该 VT 当前驻留的字节数。 */
  get residentBytes(): number {
    return this.pageTable.residentBytes;
  }
}

// ── VirtualTexturingSystem ─────────────────────────────────────

/**
 * 虚拟纹理系统:管理多张 VT + 共享物理图集 + LRU 页面缓存 + 反馈处理。
 *
 * 工作流程(每帧):
 *   1. 调用方收集 GPU 反馈(被采样的页面),调用 processFeedback();
 *   2. 系统分析反馈,生成需要加载的页面列表(去重 + 优先级排序);
 *   3. 系统按 maxPagesPerFrame 限制,逐个加载页面:
 *      a. 分配物理槽位(无空闲时 LRU 驱逐);
 *      b. 调用 pageProvider 加载页面数据;
 *      c. 上传到物理图集;
 *      d. 更新 PageTable 映射;
 *   4. 调用方通过 getPageTableEntry() 查询映射,在 shader 中重映射 UV。
 *
 * 纯 CPU 参考实现,无 WebGL 依赖,可在 Node/无头环境测试。
 * GPU 集成时,FeedbackBuffer 由 Fragment Shader 写入,PageTable 上传为
 * DataTexture(类似 VSM 的 PageTable 纹理),PhysicalTextureAtlas 为
 * 普通 Texture2D。
 */
export class VirtualTexturingSystem {
  readonly config: VirtualTexturingConfig;
  readonly atlas: PhysicalTextureAtlas;
  private textures = new Map<string, VirtualTexture>();
  private pageProvider: PageProvider | null = null;
  private pendingLoads = new Set<string>();
  private frameLoadCount = 0;

  constructor(config: Partial<VirtualTexturingConfig> = {}) {
    this.config = { ...DEFAULT_VT_CONFIG, ...config };
    this.atlas = new PhysicalTextureAtlas(this.config.atlasSize, this.config.pageSize);
  }

  /** 设置页面数据提供者。 */
  setPageProvider(provider: PageProvider): void {
    this.pageProvider = provider;
  }

  /** 注册一张虚拟纹理。 */
  registerTexture(desc: VirtualTextureDescriptor): VirtualTexture {
    if (this.textures.has(desc.id)) {
      log.warn(`VT ${desc.id} already registered, returning existing`);
      return this.textures.get(desc.id)!;
    }
    const vt = new VirtualTexture(desc, this.config.pageSize);
    this.textures.set(desc.id, vt);
    log.info(`Registered VT ${desc.id}: ${desc.virtualWidth}x${desc.virtualHeight}, ${vt.mipCount} mips`);
    return vt;
  }

  /** 注销一张虚拟纹理,释放其占用的物理槽位。 */
  unregisterTexture(vtId: string): void {
    const vt = this.textures.get(vtId);
    if (!vt) return;
    // 释放该 VT 占用的所有物理槽位
    for (const entry of vt.pageTable.allEntries()) {
      if (entry.physicalIndex >= 0) {
        this.atlas.freeSlot(entry.physicalIndex);
      }
    }
    vt.pageTable.clear();
    this.textures.delete(vtId);
    log.info(`Unregistered VT ${vtId}`);
  }

  /** 获取虚拟纹理实例。 */
  getTexture(vtId: string): VirtualTexture | null {
    return this.textures.get(vtId) ?? null;
  }

  /** 所有已注册的 VT。 */
  get allTextures(): VirtualTexture[] {
    return Array.from(this.textures.values());
  }

  /**
   * 处理 GPU 反馈:分析被采样的页面,加载需要的页面。
   * 返回本次实际加载的页面数。
   */
  async processFeedback(feedback: FeedbackEntry[], timestamp: number): Promise<number> {
    this.frameLoadCount = 0;

    if (!this.pageProvider) {
      log.warn('No page provider set, skipping feedback');
      return 0;
    }

    // 1. 去重 + 优先级排序
    const needed = this.analyzeFeedback(feedback);
    if (needed.length === 0) return 0;

    // 2. 逐个加载(受 maxPagesPerFrame 限制)
    let loaded = 0;
    for (const entry of needed) {
      if (this.frameLoadCount >= this.config.maxPagesPerFrame) break;

      const vt = this.textures.get(entry.vtId);
      if (!vt) continue;

      const loaded_count = await this.loadPage(vt, entry, timestamp);
      loaded += loaded_count;
    }

    return loaded;
  }

  /**
   * 分析反馈,生成去重 + 排序后的需求列表。
   * 排序规则:mip 越低(高分辨率)优先,sampleCount 越多优先。
   */
  private analyzeFeedback(feedback: FeedbackEntry[]): FeedbackEntry[] {
    const map = new Map<string, FeedbackEntry>();
    for (const fb of feedback) {
      const key = `${fb.vtId}:${fb.mip}:${fb.pageX}:${fb.pageY}`;
      const existing = map.get(key);
      if (existing) {
        existing.sampleCount += fb.sampleCount;
      } else {
        map.set(key, { ...fb });
      }
    }

    const list = Array.from(map.values());
    // 排序:mip 升序(低 mip 高分辨率优先),然后 sampleCount 降序
    list.sort((a, b) => {
      if (a.mip !== b.mip) return a.mip - b.mip;
      return b.sampleCount - a.sampleCount;
    });

    return list;
  }

  /**
   * 加载单个页面:分配槽位 → 加载数据 → 上传 → 更新 PageTable。
   * 返回 1 = 成功加载,0 = 跳过(已驻留/加载中/无槽位)。
   */
  private async loadPage(vt: VirtualTexture, fb: FeedbackEntry, timestamp: number): Promise<number> {
    const coord: VirtualPageCoord = { mip: fb.mip, pageX: fb.pageX, pageY: fb.pageY };
    const key = `${vt.id}:${fb.mip}:${fb.pageX}:${fb.pageY}`;

    // 已驻留 → 更新 lastUsed 即可
    const existing = vt.pageTable.get(coord);
    if (existing && existing.status === 'resident') {
      existing.lastUsed = timestamp;
      existing.priority = Math.max(existing.priority, fb.sampleCount);
      return 0;
    }

    // 正在加载 → 跳过
    if (this.pendingLoads.has(key)) return 0;

    this.pendingLoads.add(key);
    try {
      // 分配物理槽位
      let physicalIndex = this.atlas.allocateFreeSlot();
      if (physicalIndex < 0) {
        if (!this.config.enableEviction) {
          log.warn(`Atlas full, eviction disabled, skipping page ${key}`);
          return 0;
        }
        // LRU 驱逐
        physicalIndex = this.evictLRU();
        if (physicalIndex < 0) {
          log.warn(`Eviction failed, atlas full, skipping page ${key}`);
          return 0;
        }
      }

      // 加载页面数据
      const pageData = await this.pageProvider!(vt.id, coord);
      if (!pageData || pageData.length === 0) {
        // 加载失败,释放刚分配的槽位
        this.atlas.freeSlot(physicalIndex);
        return 0;
      }

      // 上传到物理图集
      this.atlas.occupySlot(physicalIndex, coord);
      this.atlas.uploadPageData(
        physicalIndex,
        pageData,
        vt.descriptor.channels,
        vt.descriptor.bytesPerChannel,
      );

      // 更新 PageTable
      const sizeBytes = pageByteSize(
        this.config.pageSize,
        vt.descriptor.channels,
        vt.descriptor.bytesPerChannel,
      );
      vt.pageTable.set({
        coord,
        physicalIndex,
        status: 'resident',
        lastUsed: timestamp,
        priority: fb.sampleCount,
        sizeBytes,
      });

      this.frameLoadCount++;
      return 1;
    } finally {
      this.pendingLoads.delete(key);
    }
  }

  /**
   * LRU 驱逐:找到 lastUsed 最久 + priority 最低的驻留页面,释放其物理槽位。
   * 返回被释放的物理索引,-1 = 无可驱逐。
   */
  private evictLRU(): number {
    let bestEntry: PageTableEntry | null = null;
    let bestVt: VirtualTexture | null = null;
    let bestScore = Infinity;

    for (const vt of this.textures.values()) {
      for (const entry of vt.pageTable.residentEntries()) {
        // 评分:时间越久 + 优先级越低 → 分数越低 → 越优先驱逐
        const score = entry.lastUsed - entry.priority * 1000;
        if (score < bestScore) {
          bestScore = score;
          bestEntry = entry;
          bestVt = vt;
        }
      }
    }

    if (!bestEntry || !bestVt) return -1;

    const physicalIndex = bestEntry.physicalIndex;
    // 从 PageTable 移除
    bestVt.pageTable.delete(bestEntry.coord);
    // 释放物理槽位
    this.atlas.freeSlot(physicalIndex);

    log.debug(`Evicted page ${bestVt.id}:${bestEntry.coord.mip}:${bestEntry.coord.pageX}:${bestEntry.coord.pageY} (slot ${physicalIndex})`);
    return physicalIndex;
  }

  /**
   * 查询某 VT 的页面映射(供 shader 重映射 UV 用)。
   * 返回 null = 页面未驻留,shader 应降级到低 mip。
   */
  getPageTableEntry(vtId: string, coord: VirtualPageCoord): PageTableEntry | null {
    const vt = this.textures.get(vtId);
    if (!vt) return null;
    return vt.pageTable.get(coord);
  }

  /**
   * 虚拟 UV → 物理图集 UV(供 shader 使用)。
   * 如果页面未驻留,返回 null(shader 应降级)。
   */
  virtualUVToPhysicalUV(
    vtId: string,
    u: number,
    v: number,
    mip: number,
  ): { physicalU: number; physicalV: number } | null {
    const vt = this.textures.get(vtId);
    if (!vt) return null;

    const { pageX, pageY, localU, localV } = virtualUVToPageCoord(
      u, v, mip,
      vt.descriptor.virtualWidth,
      vt.descriptor.virtualHeight,
      this.config.pageSize,
    );

    const entry = vt.pageTable.get({ mip, pageX, pageY });
    if (!entry || entry.status !== 'resident' || entry.physicalIndex < 0) {
      return null;
    }

    const slot = this.atlas.getSlot(entry.physicalIndex);
    const physicalU = (slot.offsetX + localU * this.config.pageSize) / this.config.atlasSize;
    const physicalV = (slot.offsetY + localV * this.config.pageSize) / this.config.atlasSize;
    return { physicalU, physicalV };
  }

  /**
   * 预加载某 VT 的低 mip 层级(启动时加载 1×1 和 2×2 页面作为降级兜底)。
   * 返回加载的页面数。
   */
  async preloadLowMips(vtId: string, timestamp: number, maxMips = 2): Promise<number> {
    const vt = this.textures.get(vtId);
    if (!vt || !this.pageProvider) return 0;

    let loaded = 0;
    const startMip = Math.max(0, vt.mipCount - maxMips);
    for (let mip = startMip; mip < vt.mipCount; mip++) {
      const { pagesX, pagesY } = pagesAtMip(
        mip,
        vt.descriptor.virtualWidth,
        vt.descriptor.virtualHeight,
        this.config.pageSize,
      );
      for (let py = 0; py < pagesY; py++) {
        for (let px = 0; px < pagesX; px++) {
          const fb: FeedbackEntry = {
            vtId,
            mip,
            pageX: px,
            pageY: py,
            sampleCount: 1,
          };
          loaded += await this.loadPage(vt, fb, timestamp);
        }
      }
    }
    return loaded;
  }

  /** 系统统计信息。 */
  getStats(): VirtualTexturingStats {
    let totalResident = 0;
    let totalBytes = 0;
    for (const vt of this.textures.values()) {
      totalResident += vt.residentPageCount;
      totalBytes += vt.residentBytes;
    }
    return {
      textureCount: this.textures.size,
      atlasSize: this.config.atlasSize,
      pageSize: this.config.pageSize,
      totalSlots: this.atlas.slotCount,
      occupiedSlots: this.atlas.occupiedSlotCount,
      freeSlots: this.atlas.freeSlotCount,
      residentPages: totalResident,
      residentBytes: totalBytes,
      residentMB: totalBytes / (1024 * 1024),
      atlasUtilization: this.atlas.slotCount > 0
        ? this.atlas.occupiedSlotCount / this.atlas.slotCount
        : 0,
    };
  }

  /** 释放所有资源。 */
  dispose(): void {
    for (const vt of this.textures.values()) {
      vt.pageTable.clear();
    }
    this.textures.clear();
    this.atlas.dispose();
    this.pendingLoads.clear();
  }
}

/** 系统统计信息。 */
export interface VirtualTexturingStats {
  textureCount: number;
  atlasSize: number;
  pageSize: number;
  totalSlots: number;
  occupiedSlots: number;
  freeSlots: number;
  residentPages: number;
  residentBytes: number;
  residentMB: number;
  atlasUtilization: number;
}

// ── GLSL 着色器块 ──────────────────────────────────────────────

/**
 * GLSL:虚拟纹理采样(chunk)。
 * 调用方需提供 pageTable 纹理(DataTexture2D,RGBA = physicalIndex/255 + status)
 * 和 physicalAtlas 纹理(sampler2D)。
 * 实际 GPU 集成时,pageTable 应为 float 纹理以避免精度问题。
 */
export const VIRTUAL_TEXTURE_GLSL = /* glsl */ `
// ── Virtual Texture 采样 ──────────────────────────────────────
// uniform sampler2D u_pageTable;    // PageTable 纹理(R = physicalIndex)
// uniform sampler2D u_physicalAtlas; // 物理图集
// uniform float u_vtInvPages;       // 1.0 / pagesPerSide(每 mip)
// uniform vec2 u_atlasScale;        // pageSize / atlasSize

// 查询 PageTable,返回物理页面索引(-1 = 未驻留)
float vtLookupPageTable(sampler2D pageTable, vec2 pageUV, float mip) {
  // pageUV ∈ [0, 1),表示在当前 mip 的页面网格中的位置
  // mip 编码到 z 分量(或使用 mip chain)
  vec4 entry = texture(pageTable, vec3(pageUV, mip));
  return entry.r * 255.0 - 1.0; // 0 = 未驻留, ≥1 = physicalIndex+1
}

// 虚拟纹理采样:虚拟 UV → 物理图集 UV → 采样
vec4 vtSample(sampler2D pageTable, sampler2D physicalAtlas,
              vec2 virtualUV, float mip,
              float invPagesPerSide, vec2 atlasScale) {
  // 1. 计算页面坐标
  vec2 pageCoord = floor(virtualUV * invPagesPerSide);
  vec2 pageUV = pageCoord * invPagesPerSide;

  // 2. 查询 PageTable
  float physicalIndex = vtLookupPageTable(pageTable, pageUV, mip);
  if (physicalIndex < 0.0) {
    // 页面未驻留 → 返回低 mip 降级色(调用方应回退到更低 mip)
    return vec4(0.5, 0.5, 0.5, 1.0);
  }

  // 3. 计算物理图集 UV
  float pagesPerSide = 1.0 / invPagesPerSide;
  vec2 slotOffset = vec2(
    mod(physicalIndex, pagesPerSide),
    floor(physicalIndex * invPagesPerSide)
  );
  vec2 localUV = fract(virtualUV * invPagesPerSide * pagesPerSide);
  vec2 physicalUV = (slotOffset + localUV) * atlasScale;

  // 4. 采样物理图集
  return texture(physicalAtlas, physicalUV);
}
`;

/**
 * GLSL:反馈写入(chunk)。
 * Fragment Shader 在渲染时把被采样的虚拟页面坐标写入 FeedbackBuffer。
 * 实际 GPU 集成时使用 imageStore 或 MRT 写入。
 */
export const VT_FEEDBACK_GLSL = /* glsl */ `
// ── Virtual Texture 反馈写入 ──────────────────────────────────
// layout(location = 1) out vec4 outFeedback; // MRT 反馈目标

// 写入反馈:虚拟 UV + mip → 反馈缓冲
void vtWriteFeedback(vec2 virtualUV, float mip, vec2 invVirtualSize) {
  // 编码:R = pageX/255, G = pageY/255, B = mip/255, A = 1
  vec2 pageCoord = floor(virtualUV * invVirtualSize);
  outFeedback = vec4(pageCoord.xy / 255.0, mip / 255.0, 1.0);
}
`;

/**
 * GLSL:PageTable 上传(chunk)。
 * 把 CPU 维护的 PageTable 数据上传为 DataTexture。
 */
export const VT_PAGE_TABLE_GLSL = /* glsl */ `
// ── PageTable 数据纹理 ────────────────────────────────────────
// 每个纹素 = 一个页面条目:
//   R = physicalIndex / 255 (0 = 未驻留, 1..N = physicalIndex+1)
//   G = status (0=empty, 1=loading, 2=resident, 3=evicted)
//   B = priority / 255
//   A = unused

uniform sampler2DArray u_pageTableArray; // [mip] 层级 = mip
uniform vec2 u_pageTableSize;            // 每 mip 的页面网格大小

vec4 vtSamplePageTable(vec2 virtualUV, float mip) {
  vec2 pageUV = virtualUV;
  return texture(u_pageTableArray, vec3(pageUV, mip));
}
`;
