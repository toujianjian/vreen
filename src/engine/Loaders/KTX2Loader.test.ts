// KTX2Loader 测试 — Phase 4.1
//
// 验证:
//   • 容器 magic 嗅探(sniffKtx2)
//   • parseKtx2Container: 完整解析 header/levels/metadata/SGD
//   • canLoad: 多种 source 类型(URL string / File / ArrayBuffer)
//   • load: uncompressed RGBA8 KTX2 → Texture.compressedLevels 正确填充
//   • Basis/Zstd supercompression: 无 transcoder 时抛清晰错误
//   • setBasisTranscoder/setZstdDecoder: 注入后被调用
//   • Texture.setCompressedLevels: 正确清空 image + bump version
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  KTX2Loader,
  sniffKtx2,
  parseKtx2Container,
  setBasisTranscoder,
  setZstdDecoder,
  type ParsedKtx2,
  type CompressedMipmapLevel,
} from './KTX2Loader';
import { Texture } from '../Core/Texture';

// ── KTX 2.0 常量 ────────────────────────────────────────────────

const KTX2_MAGIC = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];

// header layout (offset from start of file):
//   0..11  magic (12 bytes)
//   12..15 vkFormat       (uint32)
//   16..19 typeSize       (uint32)
//   20..23 pixelWidth     (uint32)
//   24..27 pixelHeight    (uint32)
//   28..31 pixelDepth     (uint32)
//   32..35 layerCount     (uint32)
//   36..39 faceCount      (uint32)
//   40..43 levelCount     (uint32)
//   44..47 supercompressionScheme (uint32)
//   48..55 sgdByteOffset  (uint64)
//   56..63 sgdByteLength  (uint64)
//   64..71 dfdByteOffset  (uint64)
//   72..79 dfdByteLength  (uint64)
//   80..87 kvdByteOffset  (uint64)
//   88..95 kvdByteLength  (uint64)
// total header: 96 bytes
const HEADER_SIZE = 96;

function writeU32(dv: DataView, off: number, val: number): void {
  dv.setUint32(off, val >>> 0, true);
}
function writeU64(dv: DataView, off: number, val: number): void {
  dv.setUint32(off, val >>> 0, true);
  dv.setUint32(off + 4, Math.floor(val / 0x100000000) >>> 0, true);
}

interface BuildOpts {
  vkFormat?: number;
  levelCount?: number;
  supercompressionScheme?: number;
  metadata?: Record<string, string>;
}

/** 构造一个最小可用的 KTX2 文件字节(uncompressed, 可多 mip)。 */
function buildKtx2(width: number, height: number, opts: BuildOpts = {}): Uint8Array {
  const vkFormat = opts.vkFormat ?? 37; // VK_FORMAT_R8G8B8A8_UNORM
  const levelCount = opts.levelCount ?? 1;
  const scheme = opts.supercompressionScheme ?? 0;

  // level data + lengths
  const levels: { w: number; h: number; len: number; data: Uint8Array }[] = [];
  for (let i = 0; i < levelCount; i++) {
    const w = Math.max(1, width >> i);
    const h = Math.max(1, height >> i);
    const len = w * h * 4;
    const data = new Uint8Array(len).fill(i + 1);
    levels.push({ w, h, len, data });
  }

  // metadata(KV entries)
  const enc = new TextEncoder();
  const kvEntries = opts.metadata
    ? Object.entries(opts.metadata).map(([k, v]) => {
        const kBytes = enc.encode(k);
        const vBytes = enc.encode(v);
        const payload = new Uint8Array(kBytes.length + 1 + vBytes.length);
        payload.set(kBytes, 0);
        payload[kBytes.length] = 0;
        payload.set(vBytes, kBytes.length + 1);
        const pad = (4 - ((4 + payload.length) % 4)) % 4;
        return { payload, pad };
      })
    : [];
  const kvdLen = kvEntries.reduce((s, e) => s + 4 + e.payload.length + e.pad, 0);

  // DFD/SGD 占位
  const dfdLen = 44;
  const sgdLen = scheme !== 0 ? 16 : 0;
  const sgd = scheme !== 0 ? new Uint8Array(sgdLen).fill(0x42) : null;

  // offsets
  const levelsTableSize = levelCount * 24;
  const kvdOff = HEADER_SIZE + levelsTableSize;
  const dfdOff = kvdOff + kvdLen;
  const sgdOff = dfdOff + dfdLen;
  const dataStart = sgdOff + sgdLen;
  const totalData = levels.reduce((s, l) => s + l.len, 0);
  const totalSize = dataStart + totalData;

  // 构造字节
  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  // magic
  for (let i = 0; i < 12; i++) out[i] = KTX2_MAGIC[i];

  // header (LE)
  writeU32(dv, 12, vkFormat);
  writeU32(dv, 16, 1); // typeSize
  writeU32(dv, 20, width);
  writeU32(dv, 24, height);
  writeU32(dv, 28, 0); // pixelDepth
  writeU32(dv, 32, 0); // layerCount
  writeU32(dv, 36, 1); // faceCount
  writeU32(dv, 40, levelCount);
  writeU32(dv, 44, scheme);
  writeU64(dv, 48, sgdOff);
  writeU64(dv, 56, sgdLen);
  writeU64(dv, 64, dfdOff);
  writeU64(dv, 72, dfdLen);
  writeU64(dv, 80, kvdOff);
  writeU64(dv, 88, kvdLen);

  // levels table + data
  let p = HEADER_SIZE;
  let dataOff = dataStart;
  for (let i = 0; i < levelCount; i++) {
    writeU64(dv, p, dataOff); p += 8;
    writeU64(dv, p, levels[i].len); p += 8;
    writeU64(dv, p, levels[i].len); p += 8; // uncompressed == compressed for scheme=0
    out.set(levels[i].data, dataOff);
    dataOff += levels[i].len;
  }

  // KV data
  let q = kvdOff;
  for (const e of kvEntries) {
    writeU32(dv, q, e.payload.length); q += 4;
    out.set(e.payload, q); q += e.payload.length;
    for (let i = 0; i < e.pad; i++) out[q++] = 0;
  }

  // DFD/SGD 占位(空字节即可,解析器不强制)
  if (sgd) out.set(sgd, sgdOff);

  return out;
}

// ── sniffKtx2 ──────────────────────────────────────────────────

describe('KTX2Loader — sniffKtx2', () => {
  it('合法 magic 返回 true', () => {
    expect(sniffKtx2(buildKtx2(4, 4))).toBe(true);
  });

  it('短于 12 字节返回 false', () => {
    expect(sniffKtx2(new Uint8Array(8))).toBe(false);
    expect(sniffKtx2(new Uint8Array(0))).toBe(false);
  });

  it('magic 错误返回 false', () => {
    const bytes = buildKtx2(4, 4);
    bytes[0] = 0;
    expect(sniffKtx2(bytes)).toBe(false);
  });

  it('PNG 文件不是 KTX2', () => {
    expect(sniffKtx2(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))).toBe(false);
  });
});

// ── parseKtx2Container ──────────────────────────────────────────

describe('KTX2Loader — parseKtx2Container', () => {
  it('解析 header 字段', () => {
    const parsed = parseKtx2Container(buildKtx2(64, 32, { vkFormat: 50 }));
    expect(parsed.header.vkFormat).toBe(50);
    expect(parsed.header.pixelWidth).toBe(64);
    expect(parsed.header.pixelHeight).toBe(32);
    expect(parsed.header.pixelDepth).toBe(0);
    expect(parsed.header.layerCount).toBe(0);
    expect(parsed.header.faceCount).toBe(1);
    expect(parsed.header.levelCount).toBe(1);
    expect(parsed.header.supercompressionScheme).toBe(0);
  });

  it('解析多 mip levels', () => {
    const parsed = parseKtx2Container(buildKtx2(8, 8, { levelCount: 4 }));
    expect(parsed.levels).toHaveLength(4);
    expect(parsed.levels[0]).toMatchObject({ level: 0, width: 8, height: 8 });
    expect(parsed.levels[1]).toMatchObject({ level: 1, width: 4, height: 4 });
    expect(parsed.levels[2]).toMatchObject({ level: 2, width: 2, height: 2 });
    expect(parsed.levels[3]).toMatchObject({ level: 3, width: 1, height: 1 });
  });

  it('解析 metadata', () => {
    const parsed = parseKtx2Container(buildKtx2(4, 4, {
      metadata: { KTXwriter: 'VREEN', KTXwriterScParams: 'etc1s -q 200' },
    }));
    expect(parsed.metadata['KTXwriter']).toBe('VREEN');
    expect(parsed.metadata['KTXwriterScParams']).toBe('etc1s -q 200');
  });

  it('解析 SGD', () => {
    const parsed = parseKtx2Container(buildKtx2(4, 4, { supercompressionScheme: 1 }));
    expect(parsed.header.supercompressionScheme).toBe(1);
    expect(parsed.supercompressionGlobalData).not.toBeNull();
    expect(parsed.supercompressionGlobalData!.length).toBe(16);
    expect(parsed.supercompressionGlobalData![0]).toBe(0x42);
  });

  it('无 SGD 时返回 null', () => {
    const parsed = parseKtx2Container(buildKtx2(4, 4, { supercompressionScheme: 0 }));
    expect(parsed.supercompressionGlobalData).toBeNull();
  });

  it('文件过短抛错', () => {
    expect(() => parseKtx2Container(new Uint8Array(20))).toThrow(/too short/);
  });

  it('3D 纹理 (pixelDepth>0) 抛错', () => {
    const bytes = buildKtx2(4, 4);
    const dv = new DataView(bytes.buffer);
    writeU32(dv, 28, 4); // pixelDepth
    expect(() => parseKtx2Container(bytes)).toThrow(/3D/);
  });

  it('Array 纹理 (layerCount>1) 抛错', () => {
    const bytes = buildKtx2(4, 4);
    const dv = new DataView(bytes.buffer);
    writeU32(dv, 32, 4); // layerCount
    expect(() => parseKtx2Container(bytes)).toThrow(/array/);
  });

  it('cube map (faceCount=6) 抛错', () => {
    const bytes = buildKtx2(4, 4);
    const dv = new DataView(bytes.buffer);
    writeU32(dv, 36, 6); // faceCount
    expect(() => parseKtx2Container(bytes)).toThrow(/cube/);
  });
});

// ── canLoad ─────────────────────────────────────────────────────

describe('KTX2Loader — canLoad', () => {
  const loader = new KTX2Loader();

  it('URL 以 .ktx2 结尾 → true', () => {
    expect(loader.canLoad('http://example.com/tex.ktx2')).toBe(true);
    expect(loader.canLoad('tex.KTX2')).toBe(true);
  });

  it('URL 不以 .ktx2 结尾 → false', () => {
    expect(loader.canLoad('http://example.com/tex.png')).toBe(false);
    expect(loader.canLoad('foo.ktx')).toBe(false);
  });

  it('hint mime 为 image/ktx2 → true', () => {
    expect(loader.canLoad('any-url', { mime: 'image/ktx2' })).toBe(true);
  });

  it('Uint8Array 用 magic 嗅探', () => {
    expect(loader.canLoad(buildKtx2(4, 4))).toBe(true);
    expect(loader.canLoad(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('ArrayBuffer 用 magic 嗅探', () => {
    const bytes = buildKtx2(4, 4);
    // 创建独立 ArrayBuffer 副本(避免 SharedArrayBuffer 类型问题)
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    expect(loader.canLoad(buf)).toBe(true);
  });
});

// ── load (uncompressed) ────────────────────────────────────────

describe('KTX2Loader — load (uncompressed)', () => {
  const loader = new KTX2Loader();

  it('uncompressed RGBA8 单 mip → Texture 字段正确', async () => {
    const tex = await loader.load(buildKtx2(4, 4));
    expect(tex).toBeInstanceOf(Texture);
    expect(tex.compressedLevels).not.toBeNull();
    expect(tex.compressedLevels!).toHaveLength(1);
    const lv = tex.compressedLevels![0];
    expect(lv.level).toBe(0);
    expect(lv.width).toBe(4);
    expect(lv.height).toBe(4);
    expect(lv.internalFormatHint).toBe('RGBA8');
    expect(lv.formatHint).toBe('RGBA');
    expect(lv.typeHint).toBe('UNSIGNED_BYTE');
    expect(lv.data.length).toBe(4 * 4 * 4);
    expect(tex.compressedWidth).toBe(4);
    expect(tex.compressedHeight).toBe(4);
    expect(tex.image).toBeNull();
    expect(tex.flipY).toBe(false);
    expect(tex.generateMipmaps).toBe(false);
  });

  it('uncompressed SRGB → internalFormatHint=SRGB8_ALPHA8', async () => {
    const tex = await loader.load(buildKtx2(4, 4, { vkFormat: 50 }));
    expect(tex.compressedLevels![0].internalFormatHint).toBe('SRGB8_ALPHA8');
  });

  it('uncompressed R8 → formatHint=RED', async () => {
    const tex = await loader.load(buildKtx2(4, 4, { vkFormat: 9 }));
    expect(tex.compressedLevels![0].internalFormatHint).toBe('R8');
    expect(tex.compressedLevels![0].formatHint).toBe('RED');
  });

  it('uncompressed RG8 → formatHint=RG', async () => {
    const tex = await loader.load(buildKtx2(4, 4, { vkFormat: 16 }));
    expect(tex.compressedLevels![0].internalFormatHint).toBe('RG8');
    expect(tex.compressedLevels![0].formatHint).toBe('RG');
  });

  it('多 mip levels 全部填充', async () => {
    const tex = await loader.load(buildKtx2(8, 8, { levelCount: 4 }));
    expect(tex.compressedLevels).toHaveLength(4);
    expect(tex.compressedLevels![0].width).toBe(8);
    expect(tex.compressedLevels![3].width).toBe(1);
  });

  it('不支持的 vkFormat 抛错', async () => {
    await expect(loader.load(buildKtx2(4, 4, { vkFormat: 999 }))).rejects.toThrow(/unsupported vkFormat/);
  });

  it('magic 错误抛错', async () => {
    const bytes = buildKtx2(4, 4);
    bytes[0] = 0;
    await expect(loader.load(bytes)).rejects.toThrow(/magic/);
  });
});

// ── Basis/Zstd supercompression ────────────────────────────────

describe('KTX2Loader — Basis/Zstd supercompression', () => {
  const loader = new KTX2Loader();

  beforeEach(() => {
    setBasisTranscoder(null);
    setZstdDecoder(null);
  });

  it('Basis scheme 无 transcoder 时抛清晰错误', async () => {
    await expect(loader.load(buildKtx2(4, 4, { supercompressionScheme: 1 })))
      .rejects.toThrow(/Basis.*transcoder/i);
  });

  it('Zstd scheme 无 decoder 时抛清晰错误', async () => {
    await expect(loader.load(buildKtx2(4, 4, { supercompressionScheme: 2 })))
      .rejects.toThrow(/Zstd.*decoder/i);
  });

  it('注入 Basis transcoder 后被调用', async () => {
    const fakeLevels: CompressedMipmapLevel[] = [{
      level: 0, width: 4, height: 4,
      internalFormatHint: 'COMPRESSED_BASIS',
      formatHint: null, typeHint: null,
      data: new Uint8Array([1, 2, 3]),
    }];
    const transcoder = vi.fn<(p: ParsedKtx2) => Promise<CompressedMipmapLevel[]>>()
      .mockResolvedValue(fakeLevels);
    setBasisTranscoder(transcoder);

    const tex = await loader.load(buildKtx2(4, 4, { supercompressionScheme: 1 }));
    expect(transcoder).toHaveBeenCalledTimes(1);
    expect(transcoder.mock.calls[0][0].header.supercompressionScheme).toBe(1);
    expect(tex.compressedLevels).toBe(fakeLevels);
  });

  it('注入 Zstd decoder 后被调用', async () => {
    const fakeLevels: CompressedMipmapLevel[] = [{
      level: 0, width: 4, height: 4,
      internalFormatHint: 'RGBA8',
      formatHint: 'RGBA', typeHint: 'UNSIGNED_BYTE',
      data: new Uint8Array(4 * 4 * 4),
    }];
    const decoder = vi.fn<(p: ParsedKtx2) => Promise<CompressedMipmapLevel[]>>()
      .mockResolvedValue(fakeLevels);
    setZstdDecoder(decoder);

    const tex = await loader.load(buildKtx2(4, 4, { supercompressionScheme: 2 }));
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(tex.compressedLevels).toBe(fakeLevels);
  });

  it('未知的 supercompressionScheme 抛错', async () => {
    await expect(loader.load(buildKtx2(4, 4, { supercompressionScheme: 99 })))
      .rejects.toThrow(/unknown supercompressionScheme/);
  });
});

// ── Texture.setCompressedLevels ─────────────────────────────────

describe('Texture.setCompressedLevels', () => {
  it('清空 image + bump version', () => {
    const t = new Texture('t');
    const v0 = t.version;
    t.setCompressedLevels([], 0, 0);
    expect(t.compressedLevels).toEqual([]);
    expect(t.compressedWidth).toBe(0);
    expect(t.compressedHeight).toBe(0);
    expect(t.image).toBeNull();
    expect(t.version).toBe(v0 + 1);
  });

  it('getSize 用 compressedWidth/Height', () => {
    const t = new Texture('t');
    t.setCompressedLevels([], 128, 64);
    expect(t.getSize()).toEqual({ width: 128, height: 64 });
  });

  it('setImage 清空 compressedLevels', () => {
    const t = new Texture('t');
    const fake = { data: new Float32Array(4), width: 1, height: 1, format: 'rgba32f' as const };
    t.setCompressedLevels([], 10, 10);
    t.setImage(fake);
    expect(t.compressedLevels).toBeNull();
    expect(t.compressedWidth).toBe(0);
    expect(t.compressedHeight).toBe(0);
  });
});
