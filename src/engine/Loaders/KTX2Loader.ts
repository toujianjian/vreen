// KTX2Loader — Khronos KTX 2.0 纹理容器加载器。
//
// Phase 4.1: KTX2/Basis 纹理压缩支持
//
// 实现范围:
//   • 完整解析 KTX 2.0 容器(magic / header / levels / DFD / metadata / SGD)
//   • 支持 uncompressed VK_FORMAT_R8G8B8A8_{UNORM,SRGB} / VK_FORMAT_R8G8_UNORM / VK_FORMAT_R8_UNORM
//   • 支持 supercompressionScheme=1 (Basis Universal):读取 levels,但实际
//     transcoding 需要外部 WASM basis_transcoder;通过 `setBasisTranscoderLoader`
//     注入 transcoder 后才能解码。无 transcoder 时抛清晰错误。
//   • 支持 supercompressionScheme=2 (Zstd):同 Basis,需外部 zstd解码器。
//   • 把解析结果以 CompressedMipmap[] 形式塞进 Texture.compressedLevels;
//     WebGL2Renderer 在 _ensureStandardTexture 中检测此字段走
//     gl.compressedTexImage2D 或 gl.texImage2D(level=0..N) 路径。
//
// 参考:
//   - KHR/KTX 2.0 spec: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
//   - VK_FORMAT_*: Vulkan core enum
//   - supercompressionScheme: 0=none, 1=Basis, 2=Zstd

import { Texture, TextureOptions } from '../Core/Texture';
import {
  AssetSource,
  Loader,
  LoaderContext,
  toArrayBuffer,
  fetchAsArrayBuffer,
  isAbortError,
} from './Loader';
import { createLogger } from '@/lib/logger';

const log = createLogger('KTX2Loader');

// ── KTX 2.0 常量 ──────────────────────────────────────────────

const KTX2_MAGIC = new Uint8Array([
  0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A,
]);

const SUPERCOMPRESSION_NONE = 0;
const SUPERCOMPRESSION_BASIS = 1;
const SUPERCOMPRESSION_ZSTD = 2;

/**
 * 只实现引擎端实际需要的子集。完整 VK_FORMAT 表很大,这里覆盖 RGBA/RG/R。
 * 其余 VK_FORMAT 命中时会在 load() 抛错并写明 format ID,便于将来扩展。
 */
const VK_FORMAT_R8G8B8A8_UNORM = 37;
const VK_FORMAT_R8G8B8A8_SRGB = 50;
const VK_FORMAT_R8G8_UNORM = 16;
const VK_FORMAT_R8_UNORM = 9;

// ── 类型 ───────────────────────────────────────────────────────

export interface Ktx2Level {
  /** Mip level index (0 = base)。 */
  level: number;
  width: number;
  height: number;
  /** 该 level 解码后的字节数(用于 uncompressed 场景 = byteLength)。 */
  uncompressedByteLength: number;
  /** 该 level 在文件中的字节偏移(KTX2 levels 表里给出)。 */
  byteOffset: number;
  /** 该 level 在文件中的字节长度。 */
  byteLength: number;
}

export interface Ktx2Header {
  vkFormat: number;
  typeSize: number;
  pixelWidth: number;
  pixelHeight: number;
  pixelDepth: number;
  layerCount: number;
  faceCount: number;
  levelCount: number;
  supercompressionScheme: number;
}

/** 解析后的 KTX2 文件 (容器层视图)。 */
export interface ParsedKtx2 {
  header: Ktx2Header;
  levels: Ktx2Level[];
  /** key-value metadata(KTXwriter 等)。 */
  metadata: Record<string, string>;
  /** SGD(supercompression global data),Basis 用。 */
  supercompressionGlobalData: Uint8Array | null;
  /** 原始字节(供 levels 数据切片用)。 */
  bytes: Uint8Array;
}

/** 一份已解码(可直接上传 GPU)的 mip level。 */
export interface CompressedMipmapLevel {
  /** Mip level index。 */
  level: number;
  width: number;
  height: number;
  /**
   * 上传用的 internalFormat (e.g. gl.RGBA8 / gl.SRGB8_ALPHA8 / gl.COMPRESSED_RGBA_S3TC_DXT5_EXT)。
   * 由 KTX2Loader 根据 vkFormat 决定(uncompressed 场景);由 Basis
   * transcoder 决定(compressed 场景)。
   */
  internalFormatHint: Ktx2InternalFormatHint;
  /**
   * 上传用的 format(uncompressed 场景使用,如 gl.RGBA / gl.RED / gl.RG)。
   * 压缩场景为 null,renderer 应走 compressedTexImage2D。
   */
  formatHint: Ktx2FormatHint | null;
  /** 上传用的 type(uncompressed 场景使用,如 gl.UNSIGNED_BYTE)。 */
  typeHint: Ktx2TypeHint | null;
  /** 该 level 的像素数据(uncompressed: 原始字节;compressed: 已 transcode 的字节)。 */
  data: Uint8Array;
}

/** GL internalFormat 的字符串提示,renderer 负责映射回 GL enum。 */
export type Ktx2InternalFormatHint =
  | 'RGBA8'
  | 'SRGB8_ALPHA8'
  | 'R8'
  | 'RG8'
  | 'COMPRESSED_BASIS';

export type Ktx2FormatHint = 'RGBA' | 'RED' | 'RG';
export type Ktx2TypeHint = 'UNSIGNED_BYTE';

// ── Basis transcoder hook ──────────────────────────────────────

/**
 * Basis transcoder 接口:把 supercompressionScheme=1 的 KTX2 解码为
 * 可直接上传的 CompressedMipmapLevel[]。外部(例如用
 * `three/examples/jsm/libs/basis/basis_transcoder.js`)实现后通过
 * `setBasisTranscoder` 注入。
 */
export interface BasisTranscoder {
  (parsed: ParsedKtx2): Promise<CompressedMipmapLevel[]>;
}

let _basisTranscoder: BasisTranscoder | null = null;
let _zstdDecoder: BasisTranscoder | null = null;

/** 注入 Basis transcoder。外部库加载完成后调用一次即可。 */
export function setBasisTranscoder(t: BasisTranscoder | null): void {
  _basisTranscoder = t;
  log.info(_basisTranscoder ? 'Basis transcoder registered' : 'Basis transcoder cleared');
}

/** 注入 Zstd 解码器。 */
export function setZstdDecoder(d: BasisTranscoder | null): void {
  _zstdDecoder = d;
  log.info(_zstdDecoder ? 'Zstd decoder registered' : 'Zstd decoder cleared');
}

// ── KTX2Loader ─────────────────────────────────────────────────

export class KTX2Loader implements Loader<Texture> {
  readonly format = 'ktx2';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'image/ktx2') return true;
    if (typeof source === 'string') {
      return /\.ktx2$/i.test(source);
    }
    if (source instanceof File) return /\.ktx2$/i.test(source.name) || source.type === 'image/ktx2';
    // ArrayBuffer/Uint8Array → 用 magic 嗅探
    if (source instanceof Uint8Array) return sniffKtx2(source);
    if (source instanceof ArrayBuffer) return sniffKtx2(new Uint8Array(source));
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<Texture> {
    const signal = ctx?.signal;
    const buf = await resolveBuffer(source, ctx?.onProgress, signal);
    const bytes = new Uint8Array(buf);

    if (!sniffKtx2(bytes)) {
      throw new Error('KTX2Loader: not a KTX 2.0 file (magic mismatch)');
    }
    const parsed = parseKtx2Container(bytes);
    log.info(
      `parsed KTX2: vkFormat=${parsed.header.vkFormat} ` +
      `${parsed.header.pixelWidth}×${parsed.header.pixelHeight} ` +
      `levels=${parsed.levels.length} ` +
      `scheme=${parsed.header.supercompressionScheme}`,
    );

    const levels = await decodeLevels(parsed);

    // 拿 base level 算尺寸
    const base = levels[0] ?? parsed.levels[0];
    const width = base?.width ?? 0;
    const height = base?.height ?? 0;

    const opts = (ctx?.hints?.['textureOptions'] as TextureOptions | undefined) ?? {};
    const name = typeof source === 'string'
      ? source.split('/').pop() || 'ktx2'
      : source instanceof File
        ? source.name
        : 'ktx2';
    const t = new Texture(name, {
      // KTX2 自带 mipmap,默认不重新生成
      generateMipmaps: false,
      ...opts,
    });
    // KTX2 容器里的数据是 top-down(与 GL 默认一致),不要再 flip
    t.flipY = false;
    t.setCompressedLevels(levels, width, height);
    return t;
  }
}

// ── 容器解析 ───────────────────────────────────────────────────

export function sniffKtx2(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  for (let i = 0; i < 12; i++) {
    if (bytes[i] !== KTX2_MAGIC[i]) return false;
  }
  return true;
}

export function parseKtx2Container(bytes: Uint8Array): ParsedKtx2 {
  if (bytes.length < 12 + 68) {
    throw new Error('KTX2: file too short (header missing)');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12; // skip magic

  // header: 17 × uint32 LE
  const vkFormat = dv.getUint32(off, true); off += 4;
  const typeSize = dv.getUint32(off, true); off += 4;
  const pixelWidth = dv.getUint32(off, true); off += 4;
  const pixelHeight = dv.getUint32(off, true); off += 4;
  const pixelDepth = dv.getUint32(off, true); off += 4;
  const layerCount = dv.getUint32(off, true); off += 4;
  const faceCount = dv.getUint32(off, true); off += 4;
  const levelCount = dv.getUint32(off, true); off += 4;
  const supercompressionScheme = dv.getUint32(off, true); off += 4;
  // 8 bytes of additional header (sgdByteOffset / sgdByteLength) —
  // KTX 2.0 spec 实际包含: vkFormat, typeSize, pixelWidth..levelCount,
  // supercompressionScheme, sgdByteOffset(uint64), sgdByteLength(uint64),
  // dfdByteOffset(uint64), dfdByteLength(uint64), kvdByteOffset(uint64),
  // kvdByteLength(uint64). 共 17 × uint32 = 68 bytes。下面对齐。
  const sgdByteOffset = readUint64(dv, off); off += 8;
  const sgdByteLength = readUint64(dv, off); off += 8;
  const dfdByteOffset = readUint64(dv, off); off += 8;
  const dfdByteLength = readUint64(dv, off); off += 8;
  const kvdByteOffset = readUint64(dv, off); off += 8;
  const kvdByteLength = readUint64(dv, off); off += 8;

  const header: Ktx2Header = {
    vkFormat,
    typeSize,
    pixelWidth,
    pixelHeight,
    pixelDepth,
    layerCount,
    faceCount,
    levelCount,
    supercompressionScheme,
  };

  if (pixelDepth !== 0) throw new Error('KTX2: 3D textures not supported');
  if (layerCount !== 0 && layerCount !== 1) throw new Error('KTX2: array textures not supported');
  if (faceCount !== 1 && faceCount !== 6) throw new Error('KTX2: unsupported faceCount');
  if (faceCount === 6) throw new Error('KTX2: cube maps not yet supported');

  // levels table: levelCount × 3 × uint64 (byteOffset, byteLength, uncompressedByteLength)
  const levels: Ktx2Level[] = [];
  for (let i = 0; i < levelCount; i++) {
    const byteOffset = readUint64(dv, off); off += 8;
    const byteLength = readUint64(dv, off); off += 8;
    const uncompressedByteLength = readUint64(dv, off); off += 8;
    const width = Math.max(1, pixelWidth >> i);
    const height = Math.max(1, pixelHeight >> i);
    levels.push({ level: i, width, height, byteOffset, byteLength, uncompressedByteLength });
  }

  // metadata (KV pairs)
  const metadata: Record<string, string> = {};
  if (kvdByteOffset > 0 && kvdByteLength > 0) {
    let p = kvdByteOffset;
    const end = kvdByteOffset + kvdByteLength;
    while (p + 4 <= end) {
      const kvLen = dv.getUint32(p, true); p += 4;
      if (kvLen === 0 || p + kvLen > end) break;
      // key = ASCII 直到 NUL,value = 余下字节
      const raw = bytes.subarray(p, p + kvLen);
      p += kvLen;
      // alignment padding 到 4 字节
      const pad = (4 - ((4 + kvLen) % 4)) % 4;
      p += pad;
      let nul = 0;
      while (nul < raw.length && raw[nul] !== 0) nul++;
      const key = new TextDecoder().decode(raw.subarray(0, nul));
      const val = new TextDecoder().decode(raw.subarray(nul + 1));
      if (key) metadata[key] = val;
    }
  }

  // SGD
  let sgd: Uint8Array | null = null;
  if (sgdByteOffset > 0 && sgdByteLength > 0) {
    sgd = bytes.subarray(sgdByteOffset, sgdByteOffset + sgdByteLength);
  }

  // DFD 不强制解析(我们靠 vkFormat 路由);但记录其存在性以便调试。
  if (dfdByteOffset === 0 || dfdByteLength === 0) {
    log.warn('KTX2: missing DFD; will rely on vkFormat only');
  }

  return { header, levels, metadata, supercompressionGlobalData: sgd, bytes };
}

function readUint64(dv: DataView, off: number): number {
  // 只支持 < 2^53 的值。KTX2 文件不会超过这个范围。
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  return hi * 0x100000000 + lo;
}

// ── Level 解码 ─────────────────────────────────────────────────

async function decodeLevels(parsed: ParsedKtx2): Promise<CompressedMipmapLevel[]> {
  const { header, levels } = parsed;
  if (levels.length === 0) {
    throw new Error('KTX2: no levels');
  }

  // 1) 无超压缩 — 直接按 vkFormat 映射 GL hint
  if (header.supercompressionScheme === SUPERCOMPRESSION_NONE) {
    const hints = mapUncompressedVkFormat(header.vkFormat);
    if (!hints) {
      throw new Error(
        `KTX2: unsupported vkFormat ${header.vkFormat} (uncompressed). ` +
        `Supported: R8G8B8A8_UNORM(37), R8G8B8A8_SRGB(50), R8G8_UNORM(16), R8_UNORM(9).`,
      );
    }
    return levels.map((lv) => {
      const slice = parsed.bytes.subarray(lv.byteOffset, lv.byteOffset + lv.byteLength);
      return {
        level: lv.level,
        width: lv.width,
        height: lv.height,
        internalFormatHint: hints.internalFormat,
        formatHint: hints.format,
        typeHint: hints.type,
        data: slice,
      };
    });
  }

  // 2) Basis — 调外部 transcoder
  if (header.supercompressionScheme === SUPERCOMPRESSION_BASIS) {
    if (!_basisTranscoder) {
      throw new Error(
        'KTX2: Basis supercompression requires a transcoder. ' +
        'Call setBasisTranscoder(...) before loading Basis-encoded KTX2 files. ' +
        'See three/examples/jsm/libs/basis/basis_transcoder.js or KTX2Loader docs.',
      );
    }
    return await _basisTranscoder(parsed);
  }

  // 3) Zstd — 调外部 decoder
  if (header.supercompressionScheme === SUPERCOMPRESSION_ZSTD) {
    if (!_zstdDecoder) {
      throw new Error(
        'KTX2: Zstd supercompression requires a decoder. Call setZstdDecoder(...) first.',
      );
    }
    return await _zstdDecoder(parsed);
  }

  throw new Error(`KTX2: unknown supercompressionScheme ${header.supercompressionScheme}`);
}

interface UncompressedFormatHints {
  internalFormat: Ktx2InternalFormatHint;
  format: Ktx2FormatHint;
  type: Ktx2TypeHint;
}

function mapUncompressedVkFormat(vk: number): UncompressedFormatHints | null {
  switch (vk) {
    case VK_FORMAT_R8G8B8A8_UNORM:
      return { internalFormat: 'RGBA8', format: 'RGBA', type: 'UNSIGNED_BYTE' };
    case VK_FORMAT_R8G8B8A8_SRGB:
      return { internalFormat: 'SRGB8_ALPHA8', format: 'RGBA', type: 'UNSIGNED_BYTE' };
    case VK_FORMAT_R8G8_UNORM:
      return { internalFormat: 'RG8', format: 'RG', type: 'UNSIGNED_BYTE' };
    case VK_FORMAT_R8_UNORM:
      return { internalFormat: 'R8', format: 'RED', type: 'UNSIGNED_BYTE' };
    default:
      return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────

async function resolveBuffer(
  source: AssetSource,
  onProgress?: (p: { loaded: number; total: number; ratio: number }) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (typeof source === 'string' || source instanceof URL) {
    const url = typeof source === 'string' ? source : source.toString();
    return await fetchAsArrayBuffer(url, onProgress, signal);
  }
  if (source instanceof Blob) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return await source.arrayBuffer();
  }
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    return await toArrayBuffer(source);
  }
  throw new TypeError('KTX2Loader: unsupported source type');
}

// 用于 try/catch 不被 lint 误报未用
export { isAbortError as _isAbortError };
