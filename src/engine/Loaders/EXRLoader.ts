// EXRLoader — 解析 OpenEXR HDR 浮点纹理 (简化版)。
//
// 参考: https://openexr.readthedocs.io/
//   - 头部 magic 20000630 (LE) + version + flags
//   - 属性表 (null-terminated name / type / size / value)
//   - chunk offset table (int64 数组, scanline 文件每行/每块一个)
//   - scanline 块: int32 y, uint32 data_size, <compressed data>
//
// 简化支持范围:
//   ✅ scanline 文件 (非 tiled, 非 multi-part)
//   ✅ 像素类型: HALF (1) / FLOAT (2)
//   ✅ 压缩: NO_COMPRESSION / RLE_COMPRESSION / ZIPS_COMPRESSION / ZIP_COMPRESSION
//   ✅ 通道: R/G/B/A (输出 RGBA Float32Array), Y/RY/BY (亮度色度 → RGB)
//   ❌ tiled / deep / multi-part
//   ❌ PIZ / B44 / DWA / PXR24 压缩
//   ❌ UINT (pixelType=0) 像素
//
// 输出: { width, height, data: Float32Array(width*height*4) } RGBA 线性。
// 通道缺失时补默认值: R=G=B=Y, A=1。
//
// API:
//   const { width, height, data } = parseEXR(buf);

import { unzipSync } from 'fflate';
import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
  toArrayBuffer,
} from './Loader';

export interface EXRResult {
  width: number;
  height: number;
  /** RGBA 线性浮点像素 (length = width * height * 4)。 */
  data: Float32Array;
}

const EXR_MAGIC = 20000630;

// 像素类型
const PIXEL_UINT = 0;  // 不支持
const PIXEL_HALF = 1;
const PIXEL_FLOAT = 2;

// 压缩类型
const COMPRESSION_NAMES = [
  'NO_COMPRESSION',
  'RLE_COMPRESSION',
  'ZIPS_COMPRESSION',
  'ZIP_COMPRESSION',
  'PIZ_COMPRESSION',
  'PXR24_COMPRESSION',
  'B44_COMPRESSION',
  'B44A_COMPRESSION',
  'DWAA_COMPRESSION',
  'DWAB_COMPRESSION',
] as const;
type CompressionName = typeof COMPRESSION_NAMES[number];

// 每种压缩的 scanline 块高度
const BLOCK_HEIGHT: Record<string, number> = {
  NO_COMPRESSION: 1,
  RLE_COMPRESSION: 1,
  ZIPS_COMPRESSION: 1,
  ZIP_COMPRESSION: 16,
  PIZ_COMPRESSION: 32,
  PXR24_COMPRESSION: 16,
  B44_COMPRESSION: 32,
  B44A_COMPRESSION: 32,
  DWAA_COMPRESSION: 32,
  DWAB_COMPRESSION: 256,
};

interface ExrChannel {
  name: string;
  pixelType: number;
  xSampling: number;
  ySampling: number;
}

interface ExrHeader {
  compression: CompressionName;
  channels: ExrChannel[];
  dataWindow: { xMin: number; yMin: number; xMax: number; yMax: number };
  lineOrder: number;
  /** scanline 块总数。 */
  chunkCount: number;
  /** scanline 块高度。 */
  blockHeight: number;
}

export class EXRLoader implements Loader<EXRResult> {
  readonly format = 'exr';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'image/x-exr' || hints?.['mime'] === 'image/exr') return true;
    if (source instanceof File) return /\.exr$/i.test(source.name);
    if (typeof source === 'string') return /\.exr(\?|$|#)/i.test(source);
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<EXRResult> {
    let buf: ArrayBuffer;
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      buf = await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    } else {
      buf = await toArrayBuffer(source);
    }
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return parseEXR(buf);
  }
}

/** 解析 EXR 数据,返回 { width, height, data: Float32Array(RGBA) }。 */
export function parseEXR(buffer: ArrayBuffer): EXRResult {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  if (dv.getUint32(0, true) !== EXR_MAGIC) {
    throw new Error('EXRLoader: not an OpenEXR file (bad magic)');
  }
  const version = dv.getUint8(4);
  const spec = dv.getUint8(5);
  const flags = {
    singleTile: !!(spec & 2),
    longName: !!(spec & 4),
    deepFormat: !!(spec & 8),
    multiPart: !!(spec & 16),
  };
  if (flags.singleTile) throw new Error('EXRLoader: tiled files not supported');
  if (flags.deepFormat) throw new Error('EXRLoader: deep data not supported');
  if (flags.multiPart) throw new Error('EXRLoader: multi-part files not supported');
  void version;

  const offset = { value: 8 };
  const header = parseHeader(dv, u8, offset);

  const width = header.dataWindow.xMax - header.dataWindow.xMin + 1;
  const height = header.dataWindow.yMax - header.dataWindow.yMin + 1;

  // 读 offset table (chunkCount * int64)
  const chunkOffsets: number[] = [];
  for (let i = 0; i < header.chunkCount; i++) {
    chunkOffsets.push(parseInt64(dv, offset));
  }

  // 计算通道字节偏移 (按字母序)
  const sortedChannels = [...header.channels].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // 验证通道像素类型统一且受支持
  for (const ch of sortedChannels) {
    if (ch.pixelType === PIXEL_UINT) {
      throw new Error(`EXRLoader: UINT channel '${ch.name}' not supported`);
    }
    if (ch.pixelType !== PIXEL_HALF && ch.pixelType !== PIXEL_FLOAT) {
      throw new Error(`EXRLoader: unknown pixelType ${ch.pixelType} for '${ch.name}'`);
    }
  }
  const bytesPerSample = sortedChannels[0]?.pixelType === PIXEL_HALF ? 2 : 4;
  for (const ch of sortedChannels) {
    if ((ch.pixelType === PIXEL_HALF ? 2 : 4) !== bytesPerSample) {
      throw new Error('EXRLoader: mixed HALF/FLOAT channels not supported');
    }
  }
  // 决定输出通道布局
  const chanMap: Record<string, number> = {}; // name → output slot
  let outChannels = 4;
  let isLuma = false;
  const names = sortedChannels.map((c) => c.name);
  if (names.includes('Y') && names.includes('RY') && names.includes('BY')) {
    isLuma = true;
    chanMap['Y'] = 0;
    chanMap['RY'] = 1;
    chanMap['BY'] = 2;
    if (names.includes('A')) chanMap['A'] = 3;
    else outChannels = 3;
  } else if (names.includes('R') && names.includes('G') && names.includes('B')) {
    chanMap['R'] = 0;
    chanMap['G'] = 1;
    chanMap['B'] = 2;
    if (names.includes('A')) chanMap['A'] = 3;
    else outChannels = 3;
  } else if (names.includes('Y')) {
    chanMap['Y'] = 0;
    outChannels = 1;
  } else {
    throw new Error('EXRLoader: unsupported channel configuration');
  }
  const totalBytes = sortedChannels.length * bytesPerSample; // 每像素字节数
  const bytesPerLine = width * totalBytes;

  const out = new Float32Array(width * height * 4); // 始终 RGBA 输出

  for (let blockIdx = 0; blockIdx < header.chunkCount; blockIdx++) {
    const blockOffset = { value: chunkOffsets[blockIdx] };
    const lineY = dv.getInt32(blockOffset.value, true) - header.dataWindow.yMin;
    const dataSize = dv.getUint32(blockOffset.value + 4, true);
    const dataStart = blockOffset.value + 8;
    if (dataStart + dataSize > u8.length) {
      throw new Error(`EXRLoader: chunk ${blockIdx} data truncated`);
    }

    const linesThisBlock = Math.min(
      header.blockHeight,
      height - lineY,
    );
    const uncompressedSize = linesThisBlock * bytesPerLine;
    const isCompressed = dataSize < uncompressedSize;
    let raw: Uint8Array;
    if (!isCompressed) {
      raw = u8.subarray(dataStart, dataStart + dataSize);
    } else {
      raw = decompress(header.compression, u8, dataStart, dataSize, uncompressedSize);
    }

    // 逐行解析
    for (let ly = 0; ly < linesThisBlock; ly++) {
      const trueY = lineY + ly;
      const lineByteOffset = ly * bytesPerLine;
      // 输出位置:EXR 是从下往上存 (默认 INCREASING_Y 时 yMin=底部),
      // 我们按 OpenGL 习惯存为顶到底 → 翻转 y。
      const outY = height - 1 - trueY;
      if (outY < 0 || outY >= height) continue;

      for (const ch of sortedChannels) {
        const slot = chanMap[ch.name];
        if (slot === undefined) {
          // 该通道不输出,跳过
          continue;
        }
        const chanByteOff = sortedChannels.indexOf(ch) * bytesPerSample;
        const outIdx0 = outY * width * 4 + slot;
        for (let x = 0; x < width; x++) {
          const srcOff = lineByteOffset + x * totalBytes + chanByteOff;
          let v: number;
          if (ch.pixelType === PIXEL_HALF) {
            v = decodeFloat16(
              raw[srcOff] | (raw[srcOff + 1] << 8),
            );
          } else {
            const rdv = new DataView(raw.buffer, raw.byteOffset + srcOff, 4);
            v = rdv.getFloat32(0, true);
          }
          out[outIdx0 + x * 4] = v;
        }
      }
    }
  }

  // 亮度色度 → RGB 转换
  if (isLuma) {
    for (let i = 0; i < width * height; i++) {
      const base = i * 4;
      const Y = out[base];
      const RY = out[base + 1];
      const BY = out[base + 2];
      const R = (1 + RY) * Y;
      const B = (1 + BY) * Y;
      const G = (Y - R * 0.2126 - B * 0.0722) / 0.7152;
      out[base] = Math.max(0, R);
      out[base + 1] = Math.max(0, G);
      out[base + 2] = Math.max(0, B);
    }
  }

  // 通道缺失补默认:无 A → 1,单通道 Y → 复制到 RGB
  if (outChannels === 3) {
    for (let i = 0; i < width * height; i++) {
      out[i * 4 + 3] = 1;
    }
  } else if (outChannels === 1) {
    for (let i = width * height - 1; i >= 0; i--) {
      const y = out[i];
      out[i * 4] = y;
      out[i * 4 + 1] = y;
      out[i * 4 + 2] = y;
      out[i * 4 + 3] = 1;
    }
  }

  return { width, height, data: out };
}

// ── 头部解析 ──────────────────────────────────────────────────────────

function parseHeader(dv: DataView, u8: Uint8Array, offset: { value: number }): ExrHeader {
  const header: Partial<ExrHeader> = {};
  const defaults: ExrHeader = {
    compression: 'NO_COMPRESSION',
    channels: [],
    dataWindow: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    lineOrder: 0,
    chunkCount: 0,
    blockHeight: 1,
  };

  while (offset.value < u8.length) {
    const name = parseNullString(u8, offset);
    if (name === '') break; // 头部结束
    const type = parseNullString(u8, offset);
    const size = parseUint32(dv, offset);
    const start = offset.value;
    parseAttribute(type, size, dv, u8, offset, header as ExrHeader);
    if (offset.value !== start + size) {
      // 未知属性:跳过剩余字节
      offset.value = start + size;
    }
  }

  const result = { ...defaults, ...(header as ExrHeader) };
  if (!result.channels.length) throw new Error('EXRLoader: header missing channels');
  result.blockHeight = BLOCK_HEIGHT[result.compression] ?? 1;
  // chunkCount = ceil(height / blockHeight)
  const h = result.dataWindow.yMax - result.dataWindow.yMin + 1;
  result.chunkCount = Math.ceil(h / result.blockHeight);
  return result;
}

function parseAttribute(
  type: string,
  size: number,
  dv: DataView,
  u8: Uint8Array,
  offset: { value: number },
  header: ExrHeader,
): void {
  switch (type) {
    case 'compression': {
      const code = dv.getUint8(offset.value);
      offset.value += 1;
      header.compression = COMPRESSION_NAMES[code] ?? 'NO_COMPRESSION';
      break;
    }
    case 'chlist': {
      const channels: ExrChannel[] = [];
      const end = offset.value + size;
      while (offset.value < end - 1) {
        const cname = parseNullString(u8, offset);
        if (cname === '') break;
        const pixelType = dv.getInt32(offset.value, true); offset.value += 4;
        const pLinear = dv.getUint8(offset.value); offset.value += 1;
        offset.value += 3; // reserved
        const xSampling = dv.getInt32(offset.value, true); offset.value += 4;
        const ySampling = dv.getInt32(offset.value, true); offset.value += 4;
        void pLinear;
        channels.push({ name: cname, pixelType, xSampling, ySampling });
      }
      offset.value = end; // 末尾的 \0
      header.channels = channels;
      break;
    }
    case 'box2i': {
      const xMin = dv.getInt32(offset.value, true); offset.value += 4;
      const yMin = dv.getInt32(offset.value, true); offset.value += 4;
      const xMax = dv.getInt32(offset.value, true); offset.value += 4;
      const yMax = dv.getInt32(offset.value, true); offset.value += 4;
      header.dataWindow = { xMin, yMin, xMax, yMax };
      break;
    }
    case 'lineOrder': {
      header.lineOrder = dv.getUint8(offset.value); offset.value += 1;
      break;
    }
    default:
      // 未知属性:不消费字节 (交给外层跳过)
      break;
  }
}

// ── 解压 ──────────────────────────────────────────────────────────────

function decompress(
  compression: CompressionName,
  u8: Uint8Array,
  start: number,
  size: number,
  expectedSize: number,
): Uint8Array {
  if (compression === 'NO_COMPRESSION') {
    return u8.subarray(start, start + size);
  }
  if (compression === 'RLE_COMPRESSION') {
    const raw = decodeByteRLE(u8, start, size);
    revertPredictor(raw);
    return raw;
  }
  if (compression === 'ZIPS_COMPRESSION' || compression === 'ZIP_COMPRESSION') {
    const compressed = u8.subarray(start, start + size);
    const out = unzipSync(compressed);
    const unzipped = out['exr.bin'];
    if (!unzipped || unzipped.length !== expectedSize) {
      // 可能 fflate 输出长度不匹配,仍然尝试使用
      if (!unzipped) throw new Error('EXRLoader: ZIP decompression failed');
    }
    // predictor + interleaveScalar 反向
    revertPredictor(unzipped);
    revertInterleave(unzipped);
    return unzipped;
  }
  throw new Error(`EXRLoader: compression '${compression}' not supported`);
}

/** EXR 字节 RLE 解码 (不是 run-of-bytes,而是 "1-byte count" + payload)。 */
function decodeByteRLE(u8: Uint8Array, start: number, size: number): Uint8Array {
  const out: number[] = [];
  let p = start;
  const end = start + size;
  while (p < end) {
    const count = u8[p++];
    if (count < 0) {
      // 重复: -count + 1 次,后续 1 字节
      const runLen = -count + 1;
      const value = u8[p++];
      for (let k = 0; k < runLen; k++) out.push(value);
    } else {
      // 原始: count + 1 字节
      const rawLen = count + 1;
      for (let k = 0; k < rawLen; k++) out.push(u8[p++]);
    }
  }
  return new Uint8Array(out);
}

/** 反向 predictor: data[t] = data[t-1] + data[t] - 128。 */
function revertPredictor(buf: Uint8Array): void {
  for (let t = 1; t < buf.length; t++) {
    const d = buf[t - 1] + buf[t] - 128;
    buf[t] = d & 0xff;
  }
}

/** 反向 interleaveScalar: 把 [firstHalf..., secondHalf...] 交错回去。 */
function revertInterleave(buf: Uint8Array): void {
  const n = buf.length;
  const t1End = Math.floor((n + 1) / 2);
  const first = buf.subarray(0, t1End);
  const second = buf.subarray(t1End);
  const tmp = new Uint8Array(n);
  let s = 0;
  let t1 = 0, t2 = 0;
  while (s < n) {
    if (t1 < first.length) tmp[s++] = first[t1++];
    if (s >= n) break;
    if (t2 < second.length) tmp[s++] = second[t2++];
  }
  buf.set(tmp);
}

// ── 工具 ──────────────────────────────────────────────────────────────

function parseNullString(u8: Uint8Array, offset: { value: number }): string {
  const start = offset.value;
  let end = start;
  while (end < u8.length && u8[end] !== 0) end++;
  const str = new TextDecoder('ascii').decode(u8.subarray(start, end));
  offset.value = end + 1; // 跳过 \0
  return str;
}

function parseUint32(dv: DataView, offset: { value: number }): number {
  const v = dv.getUint32(offset.value, true);
  offset.value += 4;
  return v;
}

function parseInt64(dv: DataView, offset: { value: number }): number {
  // 用两个 uint32 拼接为 number (JS 安全整数范围足够 EXR 文件大小)
  const lo = dv.getUint32(offset.value, true);
  const hi = dv.getUint32(offset.value + 4, true);
  offset.value += 8;
  // 注意: 位运算会把 lo 当作有符号 32 位,故用 >>> 0 归一为无符号
  return (hi * 0x100000000) + (lo >>> 0);
}

/** IEEE 754 half (binary16) → float。 */
function decodeFloat16(binary: number): number {
  const exponent = (binary & 0x7c00) >> 10;
  const fraction = binary & 0x03ff;
  const sign = binary >> 15 ? -1 : 1;
  if (exponent === 0) {
    // subnormal
    return sign * 6.103515625e-5 * (fraction / 0x400);
  }
  if (exponent === 0x1f) {
    return fraction ? NaN : (sign > 0 ? Infinity : -Infinity);
  }
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 0x400);
}
