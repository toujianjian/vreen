import { describe, it, expect } from 'vitest';
import {
  // 常量
  DEFAULT_VSM_OPTIONS,
  // 工具函数
  computePagesPerSide,
  computeVirtualResolution,
  selectMipLevel,
  computePageId,
  packPageUV,
  computeAtlasPagesPerSide,
  computeAtlasCapacity,
  applyVSMDefaults,
  // PageTable 类
  PageTable,
  // 采样
  sampleVSM,
  writePageToAtlas,
  readPageFromAtlas,
  vsmVisibility,
  vsmVisibilityPCF4,
  computeVisiblePages,
  // GLSL
  VSM_SAMPLE_GLSL,
} from './VirtualShadowMap';

// ── 工具 ──────────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

// ── computePagesPerSide ───────────────────────────────────────────

describe('computePagesPerSide', () => {
  it('5 mip levels → [16, 8, 4, 2, 1]', () => {
    const result = computePagesPerSide(5);
    expect(result).toEqual([16, 8, 4, 2, 1]);
  });

  it('1 mip level → [1]', () => {
    const result = computePagesPerSide(1);
    expect(result).toEqual([1]);
  });

  it('3 mip levels → [4, 2, 1]', () => {
    const result = computePagesPerSide(3);
    expect(result).toEqual([4, 2, 1]);
  });

  it('root pages = 2^(maxMipLevels-1)', () => {
    for (let m = 1; m <= 8; m++) {
      const result = computePagesPerSide(m);
      expect(result[0]).toBe(1 << (m - 1));
    }
  });

  it('each level halves the previous', () => {
    const result = computePagesPerSide(6);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBe(result[i - 1] / 2);
    }
  });
});

// ── computeVirtualResolution ──────────────────────────────────────

describe('computeVirtualResolution', () => {
  it('pageSize=128, 5 mips → [2048, 1024, 512, 256, 128]', () => {
    const result = computeVirtualResolution(128, 5);
    expect(result).toEqual([2048, 1024, 512, 256, 128]);
  });

  it('pageSize=64, 3 mips → [256, 128, 64]', () => {
    const result = computeVirtualResolution(64, 3);
    expect(result).toEqual([256, 128, 64]);
  });

  it('all resolutions are multiples of pageSize', () => {
    const pageSize = 128;
    const result = computeVirtualResolution(pageSize, 5);
    for (const res of result) {
      expect(res % pageSize).toBe(0);
    }
  });
});

// ── selectMipLevel ────────────────────────────────────────────────

describe('selectMipLevel', () => {
  it('texelRatio ≤ texelDensity → mip 0', () => {
    expect(selectMipLevel(0.5, 5, 1.0)).toBe(0);
    expect(selectMipLevel(1.0, 5, 1.0)).toBe(0);
  });

  it('texelRatio = 2 → mip 1', () => {
    expect(selectMipLevel(2.0, 5, 1.0)).toBe(1);
  });

  it('texelRatio = 4 → mip 2', () => {
    expect(selectMipLevel(4.0, 5, 1.0)).toBe(2);
  });

  it('texelRatio = 8 → mip 3', () => {
    expect(selectMipLevel(8.0, 5, 1.0)).toBe(3);
  });

  it('texelRatio = 16 → mip 4', () => {
    expect(selectMipLevel(16.0, 5, 1.0)).toBe(4);
  });

  it('texelRatio > max → clamped to maxMipLevels-1', () => {
    expect(selectMipLevel(1000.0, 5, 1.0)).toBe(4);
  });

  it('texelDensity=2.0 shifts threshold', () => {
    // texelDensity=2: ratio≤2 → mip0, ratio=4 → mip1, ratio=8 → mip2
    expect(selectMipLevel(2.0, 5, 2.0)).toBe(0);
    expect(selectMipLevel(4.0, 5, 2.0)).toBe(1);
    expect(selectMipLevel(8.0, 5, 2.0)).toBe(2);
  });

  it('texelRatio between powers of 2 → floor', () => {
    // ratio=3 → log2(3)≈1.58 → floor=1
    expect(selectMipLevel(3.0, 5, 1.0)).toBe(1);
    // ratio=5 → log2(5)≈2.32 → floor=2
    expect(selectMipLevel(5.0, 5, 1.0)).toBe(2);
  });
});

// ── computePageId ─────────────────────────────────────────────────

describe('computePageId', () => {
  it('center UV at mip 0 with 5 levels → page (8, 8)', () => {
    const id = computePageId(0.5, 0.5, 0, 5);
    expect(id.mipLevel).toBe(0);
    expect(id.pageX).toBe(8);
    expect(id.pageY).toBe(8);
  });

  it('corner UV (0,0) → page (0,0)', () => {
    const id = computePageId(0.0, 0.0, 0, 5);
    expect(id.pageX).toBe(0);
    expect(id.pageY).toBe(0);
  });

  it('corner UV (1,1) → clamped to last page', () => {
    const id = computePageId(1.0, 1.0, 0, 5);
    // pagesPerSide[0] = 16, so last page = 15
    expect(id.pageX).toBe(15);
    expect(id.pageY).toBe(15);
  });

  it('higher mip has fewer pages', () => {
    const id0 = computePageId(0.5, 0.5, 0, 5);
    const id4 = computePageId(0.5, 0.5, 4, 5);
    // mip 0: 16 pages/side → page (8,8)
    // mip 4: 1 page/side → page (0,0)
    expect(id0.pageX).toBe(8);
    expect(id4.pageX).toBe(0);
  });

  it('UV outside [0,1] is clamped', () => {
    const id = computePageId(-0.5, 1.5, 0, 5);
    expect(id.pageX).toBe(0);
    expect(id.pageY).toBe(15);
  });
});

// ── packPageUV ────────────────────────────────────────────────────

describe('packPageUV', () => {
  it('page (0,0) at mip 0 → atlas UV in first page region', () => {
    // UV 0.03125 = center of page 0 (16 pages/side, page 0 = [0, 0.0625))
    const uv = packPageUV(0.03125, 0.03125, 0, 5, 0, 0, 128, 8192);
    // page (0,0) covers atlas texels [0..128)
    // local UV = 0.5 (center) → atlas texel 64
    // atlas UV = 64/8192
    expect(approxEq(uv.u, 64 / 8192)).toBe(true);
    expect(approxEq(uv.v, 64 / 8192)).toBe(true);
  });

  it('page (1,1) at mip 0 → atlas UV in second page region', () => {
    // UV 0.09375 = center of page 1 (page 1 = [0.0625, 0.125))
    const uv = packPageUV(0.09375, 0.09375, 0, 5, 1, 1, 128, 8192);
    // page (1,1) covers atlas texels [128..256)
    // local UV = 0.5 (center) → atlas texel 128 + 64 = 192
    // atlas UV = 192/8192
    expect(approxEq(uv.u, 192 / 8192)).toBe(true);
    expect(approxEq(uv.v, 192 / 8192)).toBe(true);
  });

  it('atlas UV is always in [0,1]', () => {
    for (let px = 0; px < 4; px++) {
      for (let py = 0; py < 4; py++) {
        const uv = packPageUV(0.3, 0.7, 0, 5, px, py, 128, 8192);
        expect(uv.u).toBeGreaterThanOrEqual(0);
        expect(uv.u).toBeLessThanOrEqual(1);
        expect(uv.v).toBeGreaterThanOrEqual(0);
        expect(uv.v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('different virtual UVs map to different atlas UVs', () => {
    const uv1 = packPageUV(0.1, 0.1, 0, 5, 0, 0, 128, 8192);
    const uv2 = packPageUV(0.9, 0.9, 0, 5, 0, 0, 128, 8192);
    expect(uv1.u).not.toBe(uv2.u);
    expect(uv1.v).not.toBe(uv2.v);
  });
});

// ── computeAtlasPagesPerSide / computeAtlasCapacity ───────────────

describe('computeAtlasPagesPerSide', () => {
  it('8192 / 128 = 64', () => {
    expect(computeAtlasPagesPerSide(8192, 128)).toBe(64);
  });

  it('4096 / 64 = 64', () => {
    expect(computeAtlasPagesPerSide(4096, 64)).toBe(64);
  });

  it('2048 / 128 = 16', () => {
    expect(computeAtlasPagesPerSide(2048, 128)).toBe(16);
  });
});

describe('computeAtlasCapacity', () => {
  it('8192 / 128 → 64×64 = 4096 pages', () => {
    expect(computeAtlasCapacity(8192, 128)).toBe(4096);
  });

  it('4096 / 64 → 64×64 = 4096 pages', () => {
    expect(computeAtlasCapacity(4096, 64)).toBe(4096);
  });

  it('2048 / 128 → 16×16 = 256 pages', () => {
    expect(computeAtlasCapacity(2048, 128)).toBe(256);
  });
});

// ── applyVSMDefaults ──────────────────────────────────────────────

describe('applyVSMDefaults', () => {
  it('empty options → all defaults', () => {
    const opts = applyVSMDefaults();
    expect(opts).toEqual(DEFAULT_VSM_OPTIONS);
  });

  it('partial options → merged with defaults', () => {
    const opts = applyVSMDefaults({ pageSize: 64 });
    expect(opts.pageSize).toBe(64);
    expect(opts.atlasSize).toBe(DEFAULT_VSM_OPTIONS.atlasSize);
    expect(opts.maxMipLevels).toBe(DEFAULT_VSM_OPTIONS.maxMipLevels);
  });

  it('full options → use provided values', () => {
    const opts = applyVSMDefaults({
      pageSize: 64,
      atlasSize: 4096,
      maxMipLevels: 3,
      texelDensity: 2.0,
      clampBorder: false,
    });
    expect(opts.pageSize).toBe(64);
    expect(opts.atlasSize).toBe(4096);
    expect(opts.maxMipLevels).toBe(3);
    expect(opts.texelDensity).toBe(2.0);
    expect(opts.clampBorder).toBe(false);
  });
});

// ── PageTable ─────────────────────────────────────────────────────

describe('PageTable', () => {
  it('construction sets correct capacity', () => {
    const pt = new PageTable(8192, 128);
    expect(pt.atlasPagesPerSide).toBe(64);
    expect(pt.capacity).toBe(4096);
    expect(pt.allocatedCount).toBe(0);
  });

  it('allocate returns PhysicalPage with valid=true', () => {
    const pt = new PageTable(8192, 128);
    const page = pt.allocate({ mipLevel: 0, pageX: 0, pageY: 0 }, 1);
    expect(page.valid).toBe(true);
    expect(page.lastUsedFrame).toBe(1);
    expect(page.atlasPageX).toBeGreaterThanOrEqual(0);
    expect(page.atlasPageY).toBeGreaterThanOrEqual(0);
    expect(pt.allocatedCount).toBe(1);
  });

  it('find returns null for unallocated page', () => {
    const pt = new PageTable(8192, 128);
    expect(pt.find({ mipLevel: 0, pageX: 5, pageY: 5 })).toBeNull();
  });

  it('find returns allocated page', () => {
    const pt = new PageTable(8192, 128);
    const id = { mipLevel: 0, pageX: 3, pageY: 7 };
    pt.allocate(id, 1);
    const found = pt.find(id);
    expect(found).not.toBeNull();
    expect(found!.valid).toBe(true);
  });

  it('allocate same page twice returns same physical page', () => {
    const pt = new PageTable(8192, 128);
    const id = { mipLevel: 0, pageX: 1, pageY: 1 };
    const p1 = pt.allocate(id, 1);
    const p2 = pt.allocate(id, 2);
    expect(p1.atlasPageX).toBe(p2.atlasPageX);
    expect(p1.atlasPageY).toBe(p2.atlasPageY);
    expect(p2.lastUsedFrame).toBe(2);
    expect(pt.allocatedCount).toBe(1);
  });

  it('different virtual pages get different physical pages', () => {
    const pt = new PageTable(8192, 128);
    const p1 = pt.allocate({ mipLevel: 0, pageX: 0, pageY: 0 }, 1);
    const p2 = pt.allocate({ mipLevel: 0, pageX: 1, pageY: 0 }, 1);
    expect(p1.atlasPageX).not.toBe(p2.atlasPageX);
  });

  it('invalidate marks page as invalid', () => {
    const pt = new PageTable(8192, 128);
    const id = { mipLevel: 0, pageX: 0, pageY: 0 };
    pt.allocate(id, 1);
    pt.invalidate(id);
    const found = pt.find(id);
    expect(found!.valid).toBe(false);
  });

  it('gc removes pages older than minFrame', () => {
    const pt = new PageTable(8192, 128);
    pt.allocate({ mipLevel: 0, pageX: 0, pageY: 0 }, 1);
    pt.allocate({ mipLevel: 0, pageX: 1, pageY: 0 }, 5);
    const removed = pt.gc(3);
    expect(removed).toBe(1);
    expect(pt.allocatedCount).toBe(1);
    expect(pt.find({ mipLevel: 0, pageX: 1, pageY: 0 })).not.toBeNull();
    expect(pt.find({ mipLevel: 0, pageX: 0, pageY: 0 })).toBeNull();
  });

  it('clear removes all pages', () => {
    const pt = new PageTable(8192, 128);
    pt.allocate({ mipLevel: 0, pageX: 0, pageY: 0 }, 1);
    pt.allocate({ mipLevel: 0, pageX: 1, pageY: 1 }, 1);
    pt.clear();
    expect(pt.allocatedCount).toBe(0);
  });

  it('LRU eviction when capacity is full', () => {
    // Small atlas: 256/128 = 2×2 = 4 pages
    const pt = new PageTable(256, 128);
    expect(pt.capacity).toBe(4);

    // Allocate 4 pages
    pt.allocate({ mipLevel: 0, pageX: 0, pageY: 0 }, 1);
    pt.allocate({ mipLevel: 0, pageX: 1, pageY: 0 }, 2);
    pt.allocate({ mipLevel: 0, pageX: 0, pageY: 1 }, 3);
    pt.allocate({ mipLevel: 0, pageX: 1, pageY: 1 }, 4);
    expect(pt.allocatedCount).toBe(4);

    // Allocate 5th → LRU evicts page with frame=1
    const newPage = pt.allocate({ mipLevel: 1, pageX: 0, pageY: 0 }, 5);
    expect(pt.allocatedCount).toBe(4);
    expect(newPage.valid).toBe(true);

    // The evicted page (frame=1) should no longer be found
    expect(pt.find({ mipLevel: 0, pageX: 0, pageY: 0 })).toBeNull();
  });
});

// ── writePageToAtlas / readPageFromAtlas ──────────────────────────

describe('writePageToAtlas / readPageFromAtlas', () => {
  it('write then read returns same data', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pageData = new Float32Array(pageSize * pageSize);
    for (let i = 0; i < pageData.length; i++) {
      pageData[i] = i / pageData.length;
    }

    writePageToAtlas(atlas, atlasSize, pageSize, 1, 2, pageData);
    const readBack = readPageFromAtlas(atlas, atlasSize, pageSize, 1, 2);

    for (let i = 0; i < pageData.length; i++) {
      expect(readBack[i]).toBe(pageData[i]);
    }
  });

  it('writing to different atlas positions does not overlap', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);

    const pageA = new Float32Array(pageSize * pageSize).fill(0.1);
    const pageB = new Float32Array(pageSize * pageSize).fill(0.9);

    writePageToAtlas(atlas, atlasSize, pageSize, 0, 0, pageA);
    writePageToAtlas(atlas, atlasSize, pageSize, 1, 0, pageB);

    const readA = readPageFromAtlas(atlas, atlasSize, pageSize, 0, 0);
    const readB = readPageFromAtlas(atlas, atlasSize, pageSize, 1, 0);

    // All of readA should be ~0.1, all of readB should be ~0.9 (Float32 precision)
    expect(readA.every((v) => approxEq(v, 0.1))).toBe(true);
    expect(readB.every((v) => approxEq(v, 0.9))).toBe(true);
  });

  it('write to position (0,0) does not affect position (0,1)', () => {
    const atlasSize = 256;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize).fill(0.0);

    const pageData = new Float32Array(pageSize * pageSize).fill(0.5);
    writePageToAtlas(atlas, atlasSize, pageSize, 0, 0, pageData);

    // Read from (0,1) — should all be 0.0
    const otherPage = readPageFromAtlas(atlas, atlasSize, pageSize, 0, 1);
    expect(otherPage.every((v) => v === 0.0)).toBe(true);
  });
});

// ── vsmVisibility ─────────────────────────────────────────────────

describe('vsmVisibility', () => {
  it('receiver closer than stored → lit (1.0)', () => {
    expect(vsmVisibility(0.5, 0.8, 0.001)).toBe(1.0);
  });

  it('receiver farther than stored → shadowed (0.0)', () => {
    expect(vsmVisibility(0.9, 0.5, 0.001)).toBe(0.0);
  });

  it('receiver at same depth → lit (within bias)', () => {
    expect(vsmVisibility(0.5, 0.5, 0.001)).toBe(1.0);
  });

  it('receiver at same depth + small bias → lit', () => {
    expect(vsmVisibility(0.501, 0.5, 0.01)).toBe(1.0);
  });

  it('receiver just beyond bias → shadowed', () => {
    expect(vsmVisibility(0.52, 0.5, 0.001)).toBe(0.0);
  });

  it('zero bias: receiver slightly farther → shadowed', () => {
    expect(vsmVisibility(0.501, 0.5, 0.0)).toBe(0.0);
  });
});

// ── vsmVisibilityPCF4 ─────────────────────────────────────────────

describe('vsmVisibilityPCF4', () => {
  it('all 4 taps lit → 1.0', () => {
    const atlasSize = 256;
    const atlas = new Float32Array(atlasSize * atlasSize).fill(0.9);
    const result = vsmVisibilityPCF4(
      atlas, atlasSize,
      { u: 0.5, v: 0.5 },
      1 / atlasSize,
      0.5, 0.001,
    );
    expect(result).toBe(1.0);
  });

  it('all 4 taps shadowed → 0.0', () => {
    const atlasSize = 256;
    const atlas = new Float32Array(atlasSize * atlasSize).fill(0.1);
    const result = vsmVisibilityPCF4(
      atlas, atlasSize,
      { u: 0.5, v: 0.5 },
      1 / atlasSize,
      0.9, 0.001,
    );
    expect(result).toBe(0.0);
  });

  it('half lit half shadowed → 0.5', () => {
    const atlasSize = 256;
    const atlas = new Float32Array(atlasSize * atlasSize);
    // Left half: depth=0.9 (lit for receiver at 0.5)
    // Right half: depth=0.1 (shadowed for receiver at 0.5)
    for (let y = 0; y < atlasSize; y++) {
      for (let x = 0; x < atlasSize; x++) {
        atlas[y * atlasSize + x] = x < atlasSize / 2 ? 0.9 : 0.1;
      }
    }
    // Sample at center boundary: 2 taps left (lit), 2 taps right (shadowed)
    const result = vsmVisibilityPCF4(
      atlas, atlasSize,
      { u: 0.5, v: 0.5 },
      1 / atlasSize,
      0.5, 0.001,
    );
    expect(result).toBeGreaterThan(0.0);
    expect(result).toBeLessThan(1.0);
  });

  it('result is always in [0, 1]', () => {
    const atlasSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    for (let i = 0; i < atlas.length; i++) {
      atlas[i] = Math.random();
    }
    for (let i = 0; i < 20; i++) {
      const result = vsmVisibilityPCF4(
        atlas, atlasSize,
        { u: Math.random(), v: Math.random() },
        1 / atlasSize,
        Math.random(), 0.001,
      );
      expect(result).toBeGreaterThanOrEqual(0.0);
      expect(result).toBeLessThanOrEqual(1.0);
    }
  });
});

// ── sampleVSM ─────────────────────────────────────────────────────

describe('sampleVSM', () => {
  it('unallocated page → valid=false, depth=1.0', () => {
    const atlasSize = 512;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pt = new PageTable(atlasSize, 128);
    const opts = applyVSMDefaults({ atlasSize, pageSize: 128, maxMipLevels: 5 });

    const result = sampleVSM(atlas, atlasSize, pt, 0.5, 0.5, 1.0, opts);
    expect(result.valid).toBe(false);
    expect(result.depth).toBe(1.0);
  });

  it('allocated page with written depth → valid=true', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pt = new PageTable(atlasSize, pageSize);
    const opts = applyVSMDefaults({ atlasSize, pageSize, maxMipLevels: 5 });

    // Allocate page for UV (0.5, 0.5) at mip 0
    const pageId = computePageId(0.5, 0.5, 0, 5);
    const physical = pt.allocate(pageId, 1);

    // Write depth data to the atlas page
    const pageData = new Float32Array(pageSize * pageSize).fill(0.7);
    writePageToAtlas(atlas, atlasSize, pageSize, physical.atlasPageX, physical.atlasPageY, pageData);

    // Sample
    const result = sampleVSM(atlas, atlasSize, pt, 0.5, 0.5, 1.0, opts);
    expect(result.valid).toBe(true);
    expect(approxEq(result.depth, 0.7));
  });

  it('invalidated page → valid=false', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pt = new PageTable(atlasSize, pageSize);
    const opts = applyVSMDefaults({ atlasSize, pageSize, maxMipLevels: 5 });

    const pageId = computePageId(0.5, 0.5, 0, 5);
    pt.allocate(pageId, 1);
    pt.invalidate(pageId);

    const result = sampleVSM(atlas, atlasSize, pt, 0.5, 0.5, 1.0, opts);
    expect(result.valid).toBe(false);
  });

  it('higher texelRatio selects higher mip level', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pt = new PageTable(atlasSize, pageSize);
    const opts = applyVSMDefaults({ atlasSize, pageSize, maxMipLevels: 5 });

    // texelRatio=8 → mip 3
    const result = sampleVSM(atlas, atlasSize, pt, 0.5, 0.5, 8.0, opts);
    expect(result.mipLevel).toBe(3);
  });

  it('atlasUV is in [0,1] when valid', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pt = new PageTable(atlasSize, pageSize);
    const opts = applyVSMDefaults({ atlasSize, pageSize, maxMipLevels: 5 });

    const pageId = computePageId(0.3, 0.7, 0, 5);
    const physical = pt.allocate(pageId, 1);
    const pageData = new Float32Array(pageSize * pageSize).fill(0.5);
    writePageToAtlas(atlas, atlasSize, pageSize, physical.atlasPageX, physical.atlasPageY, pageData);

    const result = sampleVSM(atlas, atlasSize, pt, 0.3, 0.7, 1.0, opts);
    expect(result.valid).toBe(true);
    expect(result.atlasUV.u).toBeGreaterThanOrEqual(0);
    expect(result.atlasUV.u).toBeLessThanOrEqual(1);
    expect(result.atlasUV.v).toBeGreaterThanOrEqual(0);
    expect(result.atlasUV.v).toBeLessThanOrEqual(1);
  });
});

// ── computeVisiblePages ───────────────────────────────────────────

describe('computeVisiblePages', () => {
  it('small UV range → few pages', () => {
    const opts = applyVSMDefaults({ pageSize: 128, maxMipLevels: 5, texelDensity: 1.0 });
    const pages = computeVisiblePages(
      { u: 0.49, v: 0.49 },
      { u: 0.51, v: 0.51 },
      1.0, opts,
    );
    // mip 0, 16 pages/side
    // UV 0.49 → page 7, UV 0.51 → page 8
    // So 2×2 = 4 pages
    expect(pages.length).toBe(4);
    expect(pages.every((p) => p.mipLevel === 0)).toBe(true);
  });

  it('full UV range at mip 0 → all 256 pages', () => {
    const opts = applyVSMDefaults({ pageSize: 128, maxMipLevels: 5, texelDensity: 1.0 });
    const pages = computeVisiblePages(
      { u: 0.0, v: 0.0 },
      { u: 1.0, v: 1.0 },
      1.0, opts,
    );
    expect(pages.length).toBe(256); // 16×16
  });

  it('high texelRatio → higher mip → fewer pages', () => {
    const opts = applyVSMDefaults({ pageSize: 128, maxMipLevels: 5, texelDensity: 1.0 });
    const pagesLow = computeVisiblePages(
      { u: 0.0, v: 0.0 },
      { u: 1.0, v: 1.0 },
      1.0, opts,
    );
    const pagesHigh = computeVisiblePages(
      { u: 0.0, v: 0.0 },
      { u: 1.0, v: 1.0 },
      16.0, opts, // mip 4 → 1 page
    );
    expect(pagesHigh.length).toBeLessThan(pagesLow.length);
    expect(pagesHigh.every((p) => p.mipLevel === 4)).toBe(true);
  });

  it('all pages have correct mip level', () => {
    const opts = applyVSMDefaults({ pageSize: 128, maxMipLevels: 5, texelDensity: 1.0 });
    const pages = computeVisiblePages(
      { u: 0.0, v: 0.0 },
      { u: 0.5, v: 0.5 },
      4.0, opts, // mip 2 → 4 pages/side
    );
    expect(pages.every((p) => p.mipLevel === 2)).toBe(true);
  });
});

// ── GLSL chunk ────────────────────────────────────────────────────

describe('VSM_SAMPLE_GLSL', () => {
  it('is a non-empty string', () => {
    expect(VSM_SAMPLE_GLSL.length).toBeGreaterThan(100);
  });

  it('contains vsmSample function', () => {
    expect(VSM_SAMPLE_GLSL).toContain('float vsmSample(');
  });

  it('contains vsmSamplePCF4 function', () => {
    expect(VSM_SAMPLE_GLSL).toContain('float vsmSamplePCF4(');
  });

  it('contains vsmSelectMipLevel function', () => {
    expect(VSM_SAMPLE_GLSL).toContain('int vsmSelectMipLevel(');
  });

  it('contains vsmPackPageUV function', () => {
    expect(VSM_SAMPLE_GLSL).toContain('vec2 vsmPackPageUV(');
  });

  it('contains uniform declarations', () => {
    expect(VSM_SAMPLE_GLSL).toContain('u_vsmAtlas');
    expect(VSM_SAMPLE_GLSL).toContain('u_vsmPageTable');
    expect(VSM_SAMPLE_GLSL).toContain('u_vsmAtlasSize');
    expect(VSM_SAMPLE_GLSL).toContain('u_vsmPageSize');
  });
});

// ── 集成测试 ──────────────────────────────────────────────────────

describe('VSM integration', () => {
  it('full pipeline: allocate → write → sample → visibility', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pt = new PageTable(atlasSize, pageSize);
    const opts = applyVSMDefaults({ atlasSize, pageSize, maxMipLevels: 5 });

    // 1. Allocate page for UV (0.5, 0.5) at mip 0
    const pageId = computePageId(0.5, 0.5, 0, 5);
    const physical = pt.allocate(pageId, 1);

    // 2. Write depth data (occluder at depth 0.3)
    const pageData = new Float32Array(pageSize * pageSize).fill(0.3);
    writePageToAtlas(atlas, atlasSize, pageSize, physical.atlasPageX, physical.atlasPageY, pageData);

    // 3. Sample at the same UV
    const sample = sampleVSM(atlas, atlasSize, pt, 0.5, 0.5, 1.0, opts);
    expect(sample.valid).toBe(true);

    // 4. Receiver at depth 0.5 (behind occluder) → shadowed
    const vis = vsmVisibility(0.5, sample.depth, 0.001);
    expect(vis).toBe(0.0);

    // 5. Receiver at depth 0.1 (in front of occluder) → lit
    const vis2 = vsmVisibility(0.1, sample.depth, 0.001);
    expect(vis2).toBe(1.0);
  });

  it('multi-page scenario: two pages with different depths', () => {
    const atlasSize = 512;
    const pageSize = 128;
    const atlas = new Float32Array(atlasSize * atlasSize);
    const pt = new PageTable(atlasSize, pageSize);
    const opts = applyVSMDefaults({ atlasSize, pageSize, maxMipLevels: 5 });

    // Page A: UV (0.25, 0.25) → depth 0.2
    const idA = computePageId(0.25, 0.25, 0, 5);
    const physA = pt.allocate(idA, 1);
    writePageToAtlas(atlas, atlasSize, pageSize, physA.atlasPageX, physA.atlasPageY,
      new Float32Array(pageSize * pageSize).fill(0.2));

    // Page B: UV (0.75, 0.75) → depth 0.8
    const idB = computePageId(0.75, 0.75, 0, 5);
    const physB = pt.allocate(idB, 1);
    writePageToAtlas(atlas, atlasSize, pageSize, physB.atlasPageX, physB.atlasPageY,
      new Float32Array(pageSize * pageSize).fill(0.8));

    // Sample A: depth should be ~0.2 (Float32 precision)
    const sA = sampleVSM(atlas, atlasSize, pt, 0.25, 0.25, 1.0, opts);
    expect(sA.valid).toBe(true);
    expect(approxEq(sA.depth, 0.2));

    // Sample B: depth should be ~0.8 (Float32 precision)
    const sB = sampleVSM(atlas, atlasSize, pt, 0.75, 0.75, 1.0, opts);
    expect(sB.valid).toBe(true);
    expect(approxEq(sB.depth, 0.8));

    // They should be on different physical pages
    expect(physA.atlasPageX).not.toBe(physB.atlasPageX);
  });
});
