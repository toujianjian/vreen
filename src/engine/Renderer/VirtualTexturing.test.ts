import { describe, it, expect } from 'vitest';
import {
  // 类型
  type VirtualTextureDescriptor, type FeedbackEntry, type VirtualPageCoord,
  type PageTableEntry,
  // 工具函数
  ceilLog2, computeMipCount, pagesAtMip, pageByteSize,
  physicalPagesPerSide, physicalSlotCount, physicalIndexToOffset,
  virtualUVToPageCoord, pageCoordToLinearIndex, desiredMipForScreenSize,
  // 类
  PageTable, PhysicalTextureAtlas, VirtualTexture, VirtualTexturingSystem,
  // 常量与 GLSL
  DEFAULT_VT_CONFIG, VIRTUAL_TEXTURE_GLSL, VT_FEEDBACK_GLSL, VT_PAGE_TABLE_GLSL,
} from './VirtualTexturing';

// ── 测试辅助 ─────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function makeVTDescriptor(
  id: string,
  size = 4096,
  channels = 4,
  bytesPerChannel = 1,
): VirtualTextureDescriptor {
  return {
    id,
    virtualWidth: size,
    virtualHeight: size,
    format: 'rgba8',
    channels,
    bytesPerChannel,
  };
}

/** 生成虚拟页面数据(全色填充)。 */
function makePageData(pageSize: number, channels: number, bytesPerChannel: number, value: number): Uint8Array {
  const size = pageByteSize(pageSize, channels, bytesPerChannel);
  const data = new Uint8Array(size);
  data.fill(value);
  return data;
}

// ── ceilLog2 ────────────────────────────────────────────────────

describe('ceilLog2', () => {
  it('1 → 0', () => {
    expect(ceilLog2(1)).toBe(0);
  });
  it('2 → 1', () => {
    expect(ceilLog2(2)).toBe(1);
  });
  it('128 → 7', () => {
    expect(ceilLog2(128)).toBe(7);
  });
  it('129 → 8', () => {
    expect(ceilLog2(129)).toBe(8);
  });
  it('256 → 8', () => {
    expect(ceilLog2(256)).toBe(8);
  });
  it('0 → 0', () => {
    expect(ceilLog2(0)).toBe(0);
  });
});

// ── computeMipCount ─────────────────────────────────────────────

describe('computeMipCount', () => {
  it('4096 / 128 → 6 mips', () => {
    // pages at mip0 = 32, ceilLog2(32)+1 = 5+1 = 6
    expect(computeMipCount(4096, 4096, 128)).toBe(6);
  });

  it('16384 / 128 → 8 mips', () => {
    // pages at mip0 = 128, ceilLog2(128)+1 = 7+1 = 8
    expect(computeMipCount(16384, 16384, 128)).toBe(8);
  });

  it('128 / 128 → 1 mip', () => {
    // pages at mip0 = 1, ceilLog2(1)+1 = 0+1 = 1
    expect(computeMipCount(128, 128, 128)).toBe(1);
  });

  it('256 / 128 → 2 mips', () => {
    // pages at mip0 = 2, ceilLog2(2)+1 = 1+1 = 2
    expect(computeMipCount(256, 256, 128)).toBe(2);
  });
});

// ── pagesAtMip ──────────────────────────────────────────────────

describe('pagesAtMip', () => {
  it('mip 0 has full pages', () => {
    const { pagesX, pagesY } = pagesAtMip(0, 4096, 4096, 128);
    expect(pagesX).toBe(32);
    expect(pagesY).toBe(32);
  });

  it('mip increases reduce pages', () => {
    const m0 = pagesAtMip(0, 4096, 4096, 128);
    const m1 = pagesAtMip(1, 4096, 4096, 128);
    const m2 = pagesAtMip(2, 4096, 4096, 128);
    expect(m1.pagesX).toBe(m0.pagesX / 2);
    expect(m2.pagesX).toBe(m0.pagesX / 4);
  });

  it('highest mip has 1x1 page', () => {
    const mipCount = computeMipCount(4096, 4096, 128);
    const top = pagesAtMip(mipCount - 1, 4096, 4096, 128);
    expect(top.pagesX).toBe(1);
    expect(top.pagesY).toBe(1);
  });

  it('non-square texture', () => {
    const { pagesX, pagesY } = pagesAtMip(0, 2048, 1024, 128);
    expect(pagesX).toBe(16);
    expect(pagesY).toBe(8);
  });
});

// ── pageByteSize ────────────────────────────────────────────────

describe('pageByteSize', () => {
  it('128x128 RGBA8 = 65536', () => {
    expect(pageByteSize(128, 4, 1)).toBe(128 * 128 * 4);
  });

  it('128x128 RGBA16F = 131072', () => {
    expect(pageByteSize(128, 4, 2)).toBe(128 * 128 * 8);
  });

  it('64x64 R8 = 4096', () => {
    expect(pageByteSize(64, 1, 1)).toBe(64 * 64);
  });
});

// ── physicalPagesPerSide / physicalSlotCount ────────────────────

describe('physical atlas layout', () => {
  it('8192 / 128 = 64 pages per side', () => {
    expect(physicalPagesPerSide(8192, 128)).toBe(64);
  });

  it('4096 / 128 = 32 pages per side', () => {
    expect(physicalPagesPerSide(4096, 128)).toBe(32);
  });

  it('slot count = perSide²', () => {
    expect(physicalSlotCount(8192, 128)).toBe(64 * 64);
    expect(physicalSlotCount(4096, 128)).toBe(32 * 32);
  });
});

// ── physicalIndexToOffset ───────────────────────────────────────

describe('physicalIndexToOffset', () => {
  it('index 0 → offset (0, 0)', () => {
    const o = physicalIndexToOffset(0, 8192, 128);
    expect(o.offsetX).toBe(0);
    expect(o.offsetY).toBe(0);
  });

  it('index 1 → offset (128, 0)', () => {
    const o = physicalIndexToOffset(1, 8192, 128);
    expect(o.offsetX).toBe(128);
    expect(o.offsetY).toBe(0);
  });

  it('index 64 → offset (0, 128)', () => {
    const o = physicalIndexToOffset(64, 8192, 128);
    expect(o.offsetX).toBe(0);
    expect(o.offsetY).toBe(128);
  });

  it('last index → correct offset', () => {
    const total = physicalSlotCount(8192, 128);
    const per = physicalPagesPerSide(8192, 128);
    const o = physicalIndexToOffset(total - 1, 8192, 128);
    expect(o.offsetX).toBe((per - 1) * 128);
    expect(o.offsetY).toBe((per - 1) * 128);
  });
});

// ── virtualUVToPageCoord ────────────────────────────────────────

describe('virtualUVToPageCoord', () => {
  it('UV (0,0) → page (0,0) local (0,0)', () => {
    const r = virtualUVToPageCoord(0, 0, 0, 4096, 4096, 128);
    expect(r.pageX).toBe(0);
    expect(r.pageY).toBe(0);
    expect(approxEq(r.localU, 0)).toBe(true);
    expect(approxEq(r.localV, 0)).toBe(true);
  });

  it('UV center → correct page', () => {
    // 32 pages at mip 0, center UV (0.5, 0.5) → page (16, 16)
    const r = virtualUVToPageCoord(0.5, 0.5, 0, 4096, 4096, 128);
    expect(r.pageX).toBe(16);
    expect(r.pageY).toBe(16);
    expect(approxEq(r.localU, 0)).toBe(true);
  });

  it('UV wraps around with modulo', () => {
    // UV > 1.0 should wrap
    const r = virtualUVToPageCoord(1.5, 1.5, 0, 4096, 4096, 128);
    // 1.5 * 32 = 48, floor(48) = 48, 48 % 32 = 16
    expect(r.pageX).toBe(16);
    expect(r.pageY).toBe(16);
  });

  it('higher mip has fewer pages', () => {
    const r1 = virtualUVToPageCoord(0.5, 0.5, 1, 4096, 4096, 128);
    // mip 1: 16 pages, center → page 8
    expect(r1.pageX).toBe(8);
    expect(r1.pageY).toBe(8);
  });
});

// ── pageCoordToLinearIndex ──────────────────────────────────────

describe('pageCoordToLinearIndex', () => {
  it('linear index is consistent', () => {
    const coord: VirtualPageCoord = { mip: 0, pageX: 3, pageY: 5 };
    const idx = pageCoordToLinearIndex(coord, 4096, 4096, 128);
    // 32 pages per side, idx = 5 * 32 + 3 = 163
    expect(idx).toBe(163);
  });

  it('wraps negative coordinates', () => {
    const coord: VirtualPageCoord = { mip: 0, pageX: -1, pageY: 0 };
    const idx = pageCoordToLinearIndex(coord, 4096, 4096, 128);
    // -1 % 32 = 31 (wraps)
    expect(idx).toBe(31);
  });
});

// ── desiredMipForScreenSize ─────────────────────────────────────

describe('desiredMipForScreenSize', () => {
  it('large screen size → low mip (high resolution)', () => {
    // texture occupies full 4096 pixels on screen → mip 0
    const mip = desiredMipForScreenSize(4096, 4096, 4096, 128);
    expect(mip).toBe(0);
  });

  it('small screen size → high mip (low resolution)', () => {
    // texture occupies only 16 pixels → needs higher mip
    const mip = desiredMipForScreenSize(16, 4096, 4096, 128);
    expect(mip).toBeGreaterThan(0);
  });

  it('zero screen size → highest mip', () => {
    const mipCount = computeMipCount(4096, 4096, 128);
    const mip = desiredMipForScreenSize(0, 4096, 4096, 128);
    expect(mip).toBe(mipCount - 1);
  });

  it('clamps to max mip', () => {
    const mipCount = computeMipCount(4096, 4096, 128);
    const mip = desiredMipForScreenSize(1, 4096, 4096, 128);
    expect(mip).toBeLessThanOrEqual(mipCount - 1);
  });
});

// ── PageTable ───────────────────────────────────────────────────

describe('PageTable', () => {
  it('set and get', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const table = new PageTable(desc, 128);
    const coord: VirtualPageCoord = { mip: 0, pageX: 1, pageY: 2 };
    const entry: PageTableEntry = {
      coord,
      physicalIndex: 42,
      status: 'resident',
      lastUsed: 1000,
      priority: 5,
      sizeBytes: 65536,
    };
    table.set(entry);
    const got = table.get(coord);
    expect(got).not.toBeNull();
    expect(got!.physicalIndex).toBe(42);
    expect(got!.status).toBe('resident');
  });

  it('get non-existent returns null', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const table = new PageTable(desc, 128);
    expect(table.get({ mip: 0, pageX: 0, pageY: 0 })).toBeNull();
  });

  it('delete removes entry', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const table = new PageTable(desc, 128);
    const coord: VirtualPageCoord = { mip: 0, pageX: 1, pageY: 1 };
    table.set({
      coord, physicalIndex: 0, status: 'resident',
      lastUsed: 0, priority: 0, sizeBytes: 0,
    });
    table.delete(coord);
    expect(table.get(coord)).toBeNull();
  });

  it('residentCount and residentBytes', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const table = new PageTable(desc, 128);
    table.set({
      coord: { mip: 0, pageX: 0, pageY: 0 },
      physicalIndex: 0, status: 'resident', lastUsed: 0, priority: 0, sizeBytes: 1000,
    });
    table.set({
      coord: { mip: 0, pageX: 1, pageY: 0 },
      physicalIndex: 1, status: 'resident', lastUsed: 0, priority: 0, sizeBytes: 2000,
    });
    table.set({
      coord: { mip: 0, pageX: 2, pageY: 0 },
      physicalIndex: -1, status: 'empty', lastUsed: 0, priority: 0, sizeBytes: 500,
    });
    expect(table.residentCount).toBe(2);
    expect(table.residentBytes).toBe(3000);
  });

  it('clear removes all', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const table = new PageTable(desc, 128);
    table.set({
      coord: { mip: 0, pageX: 0, pageY: 0 },
      physicalIndex: 0, status: 'resident', lastUsed: 0, priority: 0, sizeBytes: 1000,
    });
    table.clear();
    expect(table.residentCount).toBe(0);
    expect(table.allEntries().length).toBe(0);
  });

  it('mipCount is correct', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const table = new PageTable(desc, 128);
    expect(table.mipCount).toBe(6);
  });
});

// ── PhysicalTextureAtlas ────────────────────────────────────────

describe('PhysicalTextureAtlas', () => {
  it('initializes with correct slot count', () => {
    const atlas = new PhysicalTextureAtlas(1024, 128);
    expect(atlas.pagesPerSide).toBe(8);
    expect(atlas.slotCount).toBe(64);
    expect(atlas.freeSlotCount).toBe(64);
    expect(atlas.occupiedSlotCount).toBe(0);
  });

  it('allocateFreeSlot returns first free', () => {
    const atlas = new PhysicalTextureAtlas(1024, 128);
    expect(atlas.allocateFreeSlot()).toBe(0);
    atlas.occupySlot(0, { mip: 0, pageX: 0, pageY: 0 });
    expect(atlas.allocateFreeSlot()).toBe(1);
  });

  it('returns -1 when full', () => {
    const atlas = new PhysicalTextureAtlas(256, 128); // 2x2 = 4 slots
    for (let i = 0; i < 4; i++) {
      atlas.occupySlot(i, { mip: 0, pageX: i, pageY: 0 });
    }
    expect(atlas.allocateFreeSlot()).toBe(-1);
  });

  it('freeSlot releases occupant', () => {
    const atlas = new PhysicalTextureAtlas(256, 128);
    atlas.occupySlot(0, { mip: 0, pageX: 0, pageY: 0 });
    expect(atlas.freeSlotCount).toBe(3);
    atlas.freeSlot(0);
    expect(atlas.freeSlotCount).toBe(4);
    expect(atlas.getSlot(0).occupant).toBeNull();
  });

  it('freeSlot out of range is safe', () => {
    const atlas = new PhysicalTextureAtlas(256, 128);
    expect(() => atlas.freeSlot(-1)).not.toThrow();
    expect(() => atlas.freeSlot(999)).not.toThrow();
  });

  it('occupySlot out of range throws', () => {
    const atlas = new PhysicalTextureAtlas(256, 128);
    expect(() => atlas.occupySlot(-1, { mip: 0, pageX: 0, pageY: 0 })).toThrow();
    expect(() => atlas.occupySlot(999, { mip: 0, pageX: 0, pageY: 0 })).toThrow();
  });

  it('occupiedSlots returns only occupied', () => {
    const atlas = new PhysicalTextureAtlas(256, 128);
    atlas.occupySlot(0, { mip: 0, pageX: 0, pageY: 0 });
    atlas.occupySlot(2, { mip: 0, pageX: 1, pageY: 0 });
    const occupied = atlas.occupiedSlots();
    expect(occupied.length).toBe(2);
    expect(occupied[0].index).toBe(0);
    expect(occupied[1].index).toBe(2);
  });

  it('uploadPageData writes correct bytes', () => {
    const atlas = new PhysicalTextureAtlas(256, 128);
    const pageData = makePageData(128, 4, 1, 200);
    atlas.occupySlot(0, { mip: 0, pageX: 0, pageY: 0 });
    atlas.uploadPageData(0, pageData, 4, 1);
    expect(atlas.data).not.toBeNull();
    // First pixel should be 200
    expect(atlas.data![0]).toBe(200);
    expect(atlas.data![1]).toBe(200);
    expect(atlas.data![2]).toBe(200);
    expect(atlas.data![3]).toBe(200);
  });

  it('uploadPageData at slot 1 writes to correct offset', () => {
    const atlas = new PhysicalTextureAtlas(256, 128);
    const pageData = makePageData(128, 4, 1, 150);
    atlas.occupySlot(1, { mip: 0, pageX: 1, pageY: 0 });
    atlas.uploadPageData(1, pageData, 4, 1);
    // Slot 1 offset = (128, 0), first pixel at index 128*4 = 512
    expect(atlas.data![512]).toBe(150);
  });

  it('dispose clears data and slots', () => {
    const atlas = new PhysicalTextureAtlas(256, 128);
    atlas.occupySlot(0, { mip: 0, pageX: 0, pageY: 0 });
    const pageData = makePageData(128, 4, 1, 100);
    atlas.uploadPageData(0, pageData, 4, 1);
    atlas.dispose();
    expect(atlas.data).toBeNull();
    expect(atlas.freeSlotCount).toBe(4);
  });
});

// ── VirtualTexture ──────────────────────────────────────────────

describe('VirtualTexture', () => {
  it('creates with correct properties', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const vt = new VirtualTexture(desc, 128);
    expect(vt.id).toBe('vt1');
    expect(vt.mipCount).toBe(6);
    expect(vt.residentPageCount).toBe(0);
    expect(vt.residentBytes).toBe(0);
  });

  it('pageTable starts empty', () => {
    const desc = makeVTDescriptor('vt1', 4096);
    const vt = new VirtualTexture(desc, 128);
    expect(vt.pageTable.residentCount).toBe(0);
    expect(vt.pageTable.allEntries().length).toBe(0);
  });
});

// ── VirtualTexturingSystem ──────────────────────────────────────

describe('VirtualTexturingSystem', () => {
  it('initializes with config', () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    expect(sys.config.atlasSize).toBe(1024);
    expect(sys.config.pageSize).toBe(128);
    expect(sys.atlas.slotCount).toBe(64); // 8x8
  });

  it('uses default config', () => {
    const sys = new VirtualTexturingSystem();
    expect(sys.config.atlasSize).toBe(DEFAULT_VT_CONFIG.atlasSize);
    expect(sys.config.pageSize).toBe(DEFAULT_VT_CONFIG.pageSize);
    expect(sys.config.maxPagesPerFrame).toBe(DEFAULT_VT_CONFIG.maxPagesPerFrame);
  });

  it('registerTexture creates VT', () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    const desc = makeVTDescriptor('vt1', 4096);
    const vt = sys.registerTexture(desc);
    expect(vt.id).toBe('vt1');
    expect(sys.getTexture('vt1')).not.toBeNull();
    expect(sys.allTextures.length).toBe(1);
  });

  it('registerTexture returns existing if duplicate', () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    const desc = makeVTDescriptor('vt1', 4096);
    const vt1 = sys.registerTexture(desc);
    const vt2 = sys.registerTexture(desc);
    expect(vt1).toBe(vt2);
    expect(sys.allTextures.length).toBe(1);
  });

  it('unregisterTexture frees slots', () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    // Manually occupy a slot
    sys.atlas.occupySlot(0, { mip: 0, pageX: 0, pageY: 0 });
    sys.getTexture('vt1')!.pageTable.set({
      coord: { mip: 0, pageX: 0, pageY: 0 },
      physicalIndex: 0, status: 'resident',
      lastUsed: 0, priority: 0, sizeBytes: 1000,
    });
    expect(sys.atlas.occupiedSlotCount).toBe(1);
    sys.unregisterTexture('vt1');
    expect(sys.atlas.occupiedSlotCount).toBe(0);
    expect(sys.getTexture('vt1')).toBeNull();
  });

  it('processFeedback without provider returns 0', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    const fb: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1,
    }];
    const loaded = await sys.processFeedback(fb, 0);
    expect(loaded).toBe(0);
  });

  it('processFeedback loads pages', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    const fb: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1,
    }];
    const loaded = await sys.processFeedback(fb, 1000);
    expect(loaded).toBe(1);
    const entry = sys.getPageTableEntry('vt1', { mip: 0, pageX: 0, pageY: 0 });
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe('resident');
    expect(entry!.physicalIndex).toBe(0);
  });

  it('processFeedback deduplicates', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    const fb: FeedbackEntry[] = [
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 2 },
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 3 },
    ];
    const loaded = await sys.processFeedback(fb, 1000);
    expect(loaded).toBe(1); // 去重后只加载 1 个
  });

  it('processFeedback respects maxPagesPerFrame', async () => {
    const sys = new VirtualTexturingSystem({
      atlasSize: 1024, pageSize: 128, maxPagesPerFrame: 2,
    });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    const fb: FeedbackEntry[] = [
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 1, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 2, pageY: 0, sampleCount: 1 },
    ];
    const loaded = await sys.processFeedback(fb, 1000);
    expect(loaded).toBe(2); // 受 maxPagesPerFrame 限制
  });

  it('processFeedback sorts by mip (lower first)', async () => {
    const sys = new VirtualTexturingSystem({
      atlasSize: 1024, pageSize: 128, maxPagesPerFrame: 1,
    });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    // 高 mip 优先级低,低 mip 优先级高
    const fb: FeedbackEntry[] = [
      { vtId: 'vt1', mip: 5, pageX: 0, pageY: 0, sampleCount: 10 },
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1 },
    ];
    const loaded = await sys.processFeedback(fb, 1000);
    expect(loaded).toBe(1);
    // mip 0 应该先加载
    const entry0 = sys.getPageTableEntry('vt1', { mip: 0, pageX: 0, pageY: 0 });
    expect(entry0).not.toBeNull();
    expect(entry0!.status).toBe('resident');
    // mip 5 不应被加载
    const entry5 = sys.getPageTableEntry('vt1', { mip: 5, pageX: 0, pageY: 0 });
    expect(entry5).toBeNull();
  });

  it('already resident page updates lastUsed', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    const fb1: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1,
    }];
    await sys.processFeedback(fb1, 1000);
    const fb2: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 5,
    }];
    await sys.processFeedback(fb2, 2000);
    const entry = sys.getPageTableEntry('vt1', { mip: 0, pageX: 0, pageY: 0 });
    expect(entry!.lastUsed).toBe(2000);
    expect(entry!.priority).toBe(5);
  });

  it('LRU eviction frees slots when atlas is full', async () => {
    const sys = new VirtualTexturingSystem({
      atlasSize: 256, pageSize: 128, // 2x2 = 4 slots
      maxPagesPerFrame: 10, enableEviction: true,
    });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));

    // 加载 4 个页面填满图集
    const fb1: FeedbackEntry[] = [
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 1, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 2, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 3, pageY: 0, sampleCount: 1 },
    ];
    await sys.processFeedback(fb1, 1000);
    expect(sys.atlas.occupiedSlotCount).toBe(4);

    // 加载第 5 个页面,应触发 LRU 驱逐(最先加载的 page(0,0) lastUsed 最早)
    const fb2: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 4, pageY: 0, sampleCount: 1,
    }];
    await sys.processFeedback(fb2, 2000);
    // page(0,0) 应被驱逐
    const evicted = sys.getPageTableEntry('vt1', { mip: 0, pageX: 0, pageY: 0 });
    expect(evicted).toBeNull();
    // page(4,0) 应驻留
    const resident = sys.getPageTableEntry('vt1', { mip: 0, pageX: 4, pageY: 0 });
    expect(resident).not.toBeNull();
    expect(resident!.status).toBe('resident');
  });

  it('eviction disabled does not evict', async () => {
    const sys = new VirtualTexturingSystem({
      atlasSize: 256, pageSize: 128, // 2x2 = 4 slots
      maxPagesPerFrame: 10, enableEviction: false,
    });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));

    const fb1: FeedbackEntry[] = [
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 1, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 2, pageY: 0, sampleCount: 1 },
      { vtId: 'vt1', mip: 0, pageX: 3, pageY: 0, sampleCount: 1 },
    ];
    await sys.processFeedback(fb1, 1000);
    expect(sys.atlas.occupiedSlotCount).toBe(4);

    const fb2: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 4, pageY: 0, sampleCount: 1,
    }];
    const loaded = await sys.processFeedback(fb2, 2000);
    expect(loaded).toBe(0); // 无驱逐 → 无法加载
  });

  it('pageProvider returns null does not load', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => null);
    const fb: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1,
    }];
    const loaded = await sys.processFeedback(fb, 1000);
    expect(loaded).toBe(0);
    expect(sys.atlas.occupiedSlotCount).toBe(0);
  });

  it('virtualUVToPhysicalUV returns null for non-resident', () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    const r = sys.virtualUVToPhysicalUV('vt1', 0.5, 0.5, 0);
    expect(r).toBeNull();
  });

  it('virtualUVToPhysicalUV returns correct UV for resident page', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));

    // 加载 page(0,0) at mip 0
    const fb: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1,
    }];
    await sys.processFeedback(fb, 1000);

    // UV (0.01, 0.01) 在 32-page 网格中 → page(0,0),local ~0.32
    const r = sys.virtualUVToPhysicalUV('vt1', 0.01, 0.01, 0);
    expect(r).not.toBeNull();
    expect(r!.physicalU).toBeGreaterThan(0);
    expect(r!.physicalU).toBeLessThan(1);
    expect(r!.physicalV).toBeGreaterThan(0);
    expect(r!.physicalV).toBeLessThan(1);
  });

  it('virtualUVToPhysicalUV returns null for unknown VT', () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    const r = sys.virtualUVToPhysicalUV('unknown', 0.5, 0.5, 0);
    expect(r).toBeNull();
  });

  it('preloadLowMips loads low-resolution pages', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));

    // 4096/128 → 6 mips, preload last 2 mips (mip 4 and 5)
    // mip 4: 2x2 = 4 pages, mip 5: 1x1 = 1 page → total 5 pages
    const loaded = await sys.preloadLowMips('vt1', 1000, 2);
    expect(loaded).toBe(5);
  });

  it('getStats returns correct info', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    const fb: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1,
    }];
    await sys.processFeedback(fb, 1000);

    const stats = sys.getStats();
    expect(stats.textureCount).toBe(1);
    expect(stats.atlasSize).toBe(1024);
    expect(stats.pageSize).toBe(128);
    expect(stats.totalSlots).toBe(64);
    expect(stats.occupiedSlots).toBe(1);
    expect(stats.freeSlots).toBe(63);
    expect(stats.residentPages).toBe(1);
    expect(stats.residentBytes).toBe(128 * 128 * 4);
    expect(stats.atlasUtilization).toBeCloseTo(1 / 64, 4);
  });

  it('dispose clears everything', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    const fb: FeedbackEntry[] = [{
      vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1,
    }];
    await sys.processFeedback(fb, 1000);
    sys.dispose();
    expect(sys.allTextures.length).toBe(0);
    expect(sys.atlas.data).toBeNull();
    expect(sys.atlas.freeSlotCount).toBe(64);
  });

  it('handles multiple VTs sharing one atlas', async () => {
    const sys = new VirtualTexturingSystem({ atlasSize: 1024, pageSize: 128 });
    sys.registerTexture(makeVTDescriptor('vt1', 4096));
    sys.registerTexture(makeVTDescriptor('vt2', 4096));
    sys.setPageProvider(async (_id, _coord) => makePageData(128, 4, 1, 200));
    const fb: FeedbackEntry[] = [
      { vtId: 'vt1', mip: 0, pageX: 0, pageY: 0, sampleCount: 1 },
      { vtId: 'vt2', mip: 0, pageX: 0, pageY: 0, sampleCount: 1 },
    ];
    const loaded = await sys.processFeedback(fb, 1000);
    expect(loaded).toBe(2);
    // 两个 VT 应分配到不同物理槽位
    const e1 = sys.getPageTableEntry('vt1', { mip: 0, pageX: 0, pageY: 0 });
    const e2 = sys.getPageTableEntry('vt2', { mip: 0, pageX: 0, pageY: 0 });
    expect(e1!.physicalIndex).toBe(0);
    expect(e2!.physicalIndex).toBe(1);
  });
});

// ── GLSL 着色器块 ───────────────────────────────────────────────

describe('GLSL chunks', () => {
  it('VIRTUAL_TEXTURE_GLSL contains sampling function', () => {
    expect(VIRTUAL_TEXTURE_GLSL).toContain('vtSample');
    expect(VIRTUAL_TEXTURE_GLSL).toContain('vtLookupPageTable');
    expect(VIRTUAL_TEXTURE_GLSL).toContain('pageTable');
    expect(VIRTUAL_TEXTURE_GLSL).toContain('physicalAtlas');
  });

  it('VT_FEEDBACK_GLSL contains feedback writing', () => {
    expect(VT_FEEDBACK_GLSL).toContain('vtWriteFeedback');
    expect(VT_FEEDBACK_GLSL).toContain('outFeedback');
  });

  it('VT_PAGE_TABLE_GLSL contains page table sampling', () => {
    expect(VT_PAGE_TABLE_GLSL).toContain('vtSamplePageTable');
    expect(VT_PAGE_TABLE_GLSL).toContain('u_pageTableArray');
  });
});
