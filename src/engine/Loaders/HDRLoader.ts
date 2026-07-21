// HDRLoader — 解析 Radiance .hdr (RGBE) 格式为 RGBA32F Float32Array。
//
// 格式参考：https://www.graphics.cornell.edu/~bjw/rgbe/rgbe_image.html
//   - 文本头（若干行 "KEY=VALUE" + 空行）
//   - 二进制数据：未压缩的 scanline (RGBE) 或 RLE 压缩的 scanline
//
// 浮点纹理在 WebGL2 里走 EXT_color_buffer_float 扩展 + OES_texture_float_linear，
// 由于本工程当前 renderer 暂不消费 HDR，所以本 loader 只产出 CPU-side 数据。

import { Texture, TextureImage } from '../Core/Texture';
import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
  toArrayBuffer,
  isAbortError,
} from './Loader';

interface HDRHeader {
  width: number;
  height: number;
  exposure: number;
  gamma: number;
  software?: string;
}

export interface LoadedHDR {
  texture: Texture;
  width: number;
  height: number;
}

export class HDRLoader implements Loader<LoadedHDR> {
  readonly format = 'hdri';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'image/hdr' || hints?.['mime'] === 'application/hdr') return true;
    if (source instanceof File) return /\.hdr$/i.test(source.name);
    if (typeof source === 'string') return /\.hdr(\?|$|#)/i.test(source);
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<LoadedHDR> {
    let buf: ArrayBuffer;
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      buf = await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    } else {
      buf = await toArrayBuffer(source);
    }
    const { header, pixels } = parseRGBE(new Uint8Array(buf));
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    // 转 RGBE → linear RGBA32F
    const exp = header.exposure || 1;
    const gamma = header.gamma || 1;
    // exposure 已经吸收在 RGBE 解码里了；gamma 矫正仅在写出 PNG/EXR 时
    // 有用，浮点纹理里我们按线性存储，gamma=1。
    void gamma;
    const w = header.width, h = header.height;
    const data = new Float32Array(w * h * 4);
    decodeRGBE(pixels, data, w, h, exp);

    const image: TextureImage = { data, width: w, height: h, format: 'rgba32f' };
    const t = new Texture(typeof source === 'string' ? source : 'hdr', {
      generateMipmaps: false, // 浮点纹理不生成 mipmap，避免精度退化
      colorSpace: 'linear',
    });
    t.setImage(image);
    return { texture: t, width: w, height: h };
  }
}

// ── 解析 ────────────────────────────────────────────────────────────
function parseRGBE(buf: Uint8Array): { header: HDRHeader; pixels: Uint8Array } {
  // 头：以 "\n" 分隔的多行 KEY=VALUE；首行必须是 "#?RADIANCE" 或 "#?RGBE"
  if (buf.length < 12) throw new Error('HDRLoader: file too small');
  const text = new TextDecoder('ascii').decode(buf.slice(0, Math.min(2048, buf.length)));
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith('#?')) {
    throw new Error('HDRLoader: not a Radiance RGBE file (bad magic)');
  }

  let i = 1;
  let width = 0, height = 0;
  let exposure = 1, gamma = 1;
  let software: string | undefined;
  while (i < lines.length) {
    const line = lines[i].trim();
    i++;
    if (!line) break; // 空行结束头
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    switch (k) {
      case 'FORMAT': break;
      case 'EXPOSURE': exposure = parseFloat(v); break;
      case 'GAMMA': gamma = parseFloat(v); break;
      case 'SOFTWARE': software = v; break;
      case 'PIXASPECT': case 'VIEW': case 'PRIMARIES': break;
    }
  }

  // 找 " -Y height +X width" 格式的尺寸行
  // 例："  -Y 1024 +X 2048"
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // 跳过可能的注释（虽然 spec 不要求，但有文件会写）
    if (line.startsWith('#')) continue;
    const m = line.match(/[-+][XY]\s+(\d+)\s+[-+][XY]\s+(\d+)/);
    if (m) {
      height = parseInt(m[1], 10);
      width = parseInt(m[2], 10);
      i++;
      break;
    }
  }
  if (!width || !height) {
    throw new Error('HDRLoader: failed to find resolution in header');
  }
  // 头结束位置 = 前 i 行的总字节数
  let headerBytes = 0;
  for (let k = 0; k < i; k++) {
    headerBytes += lines[k].length + 1; // +1 = \n
  }
  return {
    header: { width, height, exposure, gamma, software },
    pixels: buf.slice(headerBytes),
  };
}

function decodeRGBE(src: Uint8Array, dst: Float32Array, w: number, h: number, expMul: number): void {
  // Radiance .hdr scanline 排列：
  //   - 旧格式（未压缩）：每行 w*4 字节 RGBE 原始数据
  //   - 新格式（RLE）：每行先 4 字节标记 [2, 2, hi, lo]，width=hi*256+lo
  //     然后对 4 个通道（R, G, B, E）分别 RLE 编码，每通道解码出 w 个字节
  // RLE 通道编码：
  //   code = src[pos++]
  //   if code > 128: run_len = code - 128, value = src[pos++], 重复 run_len 次
  //   else: raw_len = code, 读取 raw_len 个 bytes 原始数据
  // Note: do NOT pre-check src.length against w*h*4 — RLE-compressed
  // scanlines are smaller than raw. Out-of-range reads are caught below.
  const scanSize = w * 4;
  const out = dst;
  let off = 0;
  for (let y = 0; y < h; y++) {
    if (off + 4 > src.length) {
      throw new Error(`HDRLoader: pixel data truncated at scanline ${y} (offset ${off})`);
    }
    // 检测 RLE 标志：[2, 2, hi, lo] 且 hi 的最高位为 0（width < 32768）
    if (src[off] === 2 && src[off + 1] === 2 && (src[off + 2] & 0x80) === 0) {
      const expected = ((src[off + 2] as number) << 8) | src[off + 3];
      if (expected !== w) {
        // 宽度不匹配，按原始数据回退处理
        decodeRawScanline(src.subarray(off, off + scanSize), out, y, w, expMul);
        off += scanSize;
      } else {
        off = decodeRLEScanlinePerChannel(src, off + 4, out, y, w, expMul);
      }
    } else {
      // 旧格式（未压缩）：w*4 字节原始 RGBE
      decodeRawScanline(src.subarray(off, off + scanSize), out, y, w, expMul);
      off += scanSize;
    }
  }
}

function decodeRawScanline(row: Uint8Array, out: Float32Array, y: number, w: number, expMul: number): void {
  for (let x = 0; x < w; x++) {
    const o = x * 4;
    writePixel(out, (y * w + x) * 4, row[o], row[o + 1], row[o + 2], row[o + 3], expMul);
  }
}

/**
 * Per-channel RLE 解码：4 个通道（R, G, B, E）分别 RLE 编码，每通道 w 个字节。
 * Returns new offset in `src` after consuming this scanline.
 */
function decodeRLEScanlinePerChannel(
  src: Uint8Array,
  start: number,
  out: Float32Array,
  y: number,
  w: number,
  expMul: number,
): number {
  let pos = start;
  // 先解码到 planar 缓冲：channelData[x*4 + c]
  const channelData = new Uint8Array(w * 4);

  for (let c = 0; c < 4; c++) {
    let x = 0;
    while (x < w) {
      if (pos >= src.length) {
        throw new Error(`HDRLoader: RLE scanline ${y} channel ${c} truncated at pixel ${x}`);
      }
      const code = src[pos++];
      if (code > 128) {
        // RLE run: 重复单个值
        const runLen = code - 128;
        if (pos >= src.length) {
          throw new Error(`HDRLoader: RLE scanline ${y} channel ${c} run value missing`);
        }
        const value = src[pos++];
        const end = Math.min(runLen, w - x);
        for (let k = 0; k < end; k++, x++) {
          channelData[x * 4 + c] = value;
        }
      } else if (code > 0) {
        // Raw copy: 读取 code 个原始字节
        const rawLen = Math.min(code, w - x);
        for (let k = 0; k < rawLen; k++, x++) {
          if (pos >= src.length) {
            throw new Error(`HDRLoader: RLE scanline ${y} channel ${c} raw truncated`);
          }
          channelData[x * 4 + c] = src[pos++];
        }
      } else {
        // code === 0：非法，但容忍性跳过
        break;
      }
    }
  }

  // 写入到输出 Float32Array
  for (let x = 0; x < w; x++) {
    const o = x * 4;
    writePixel(out, (y * w + x) * 4,
      channelData[o], channelData[o + 1], channelData[o + 2], channelData[o + 3], expMul);
  }
  return pos;
}

/** RGBE → 线性 RGB float。E=0 → (0,0,0)。 */
function writePixel(out: Float32Array, o: number, r: number, g: number, b: number, e: number, expMul: number): void {
  if (e === 0) {
    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 1;
    return;
  }
  // 公式：c = (rgbe_byte + 0.5) / 256 * 2^(E - 128)
  // TS 5 + lib 不一定暴露 Math.ldexp，用手写 2^(e-128)/256 替代。
  const f = Math.pow(2, e - 128 - 8);
  out[o]     = (r + 0.5) * f * expMul;
  out[o + 1] = (g + 0.5) * f * expMul;
  out[o + 2] = (b + 0.5) * f * expMul;
  out[o + 3] = 1;
}
