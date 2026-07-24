// TGALoader — 解析 TGA (Targa) 纹理格式。
//
// 参考: https://en.wikipedia.org/wiki/Truevision_TGA
// 支持:
//   - 未压缩 RGB / GREY / INDEXED
//   - RLE 压缩 RGB / GREY / INDEXED
//   - 8 / 16 / 24 / 32 位像素
//   - 4 种原点方位 (左上/左下/右上/右下)
//
// 输出: { width, height, data: Uint8Array },data 始终是 RGBA8
//       (每像素 4 字节,无论输入位深)。原点统一归一为左下角 (WebGL 习惯)。
//
// API:
//   const { width, height, data } = parseTGA(buf);

import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
  toArrayBuffer,
} from './Loader';

export interface TGAResult {
  width: number;
  height: number;
  /** RGBA8 像素数据 (length = width * height * 4)。 */
  data: Uint8Array;
}

// TGA image_type 取值
const TGA_TYPE_NO_DATA = 0;
const TGA_TYPE_INDEXED = 1;
const TGA_TYPE_RGB = 2;
const TGA_TYPE_GREY = 3;
const TGA_TYPE_RLE_INDEXED = 9;
const TGA_TYPE_RLE_RGB = 10;
const TGA_TYPE_RLE_GREY = 11;

// 原点方位 (flags 第 4-5 位)
const TGA_ORIGIN_MASK = 0x30;
const TGA_ORIGIN_SHIFT = 4;
const TGA_ORIGIN_BL = 0;
const TGA_ORIGIN_BR = 1;
const TGA_ORIGIN_UL = 2;
const TGA_ORIGIN_UR = 3;

interface TGAHeader {
  idLength: number;
  colormapType: number;
  imageType: number;
  colormapIndex: number;
  colormapLength: number;
  colormapSize: number;
  width: number;
  height: number;
  pixelSize: number;
  flags: number;
}

export class TGALoader implements Loader<TGAResult> {
  readonly format = 'tga';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'image/x-tga' || hints?.['mime'] === 'image/tga') return true;
    if (source instanceof File) return /\.tga$/i.test(source.name);
    if (typeof source === 'string') return /\.tga(\?|$|#)/i.test(source);
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<TGAResult> {
    let buf: ArrayBuffer;
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      buf = await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    } else {
      buf = await toArrayBuffer(source);
    }
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return parseTGA(buf);
  }
}

/**
 * 解析 TGA 数据,返回 { width, height, data: Uint8Array(RGBA8) }。
 */
export function parseTGA(buffer: ArrayBuffer): TGAResult {
  const content = new Uint8Array(buffer);
  if (content.length < 18) {
    throw new Error('TGALoader: file too small to contain header');
  }

  let offset = 0;
  const header: TGAHeader = {
    idLength: content[offset++],
    colormapType: content[offset++],
    imageType: content[offset++],
    colormapIndex: content[offset++] | (content[offset++] << 8),
    colormapLength: content[offset++] | (content[offset++] << 8),
    colormapSize: content[offset++],
    width: 0, height: 0, pixelSize: 0, flags: 0,
  };
  // 跳过 origin (4 字节,本实现从 flags 推断方位,不用 origin 字段)
  offset += 4;
  header.width = content[offset++] | (content[offset++] << 8);
  header.height = content[offset++] | (content[offset++] << 8);
  header.pixelSize = content[offset++];
  header.flags = content[offset++];

  checkHeader(header);

  if (header.idLength + offset > content.length) {
    throw new Error('TGALoader: not enough data (id field overflows file)');
  }
  offset += header.idLength;

  // 解析 RLE / palette / grey 标记
  let useRle = false, usePal = false, useGrey = false;
  switch (header.imageType) {
    case TGA_TYPE_RLE_INDEXED: useRle = true; usePal = true; break;
    case TGA_TYPE_INDEXED: usePal = true; break;
    case TGA_TYPE_RLE_RGB: useRle = true; break;
    case TGA_TYPE_RGB: break;
    case TGA_TYPE_RLE_GREY: useRle = true; useGrey = true; break;
    case TGA_TYPE_GREY: useGrey = true; break;
    case TGA_TYPE_NO_DATA: throw new Error('TGALoader: image type NO_DATA');
    default: throw new Error(`TGALoader: invalid image type ${header.imageType}`);
  }

  const pixelSize = header.pixelSize >> 3;
  const pixelTotal = header.width * header.height * pixelSize;

  // 调色板
  let palettes: Uint8Array | null = null;
  if (usePal) {
    const palBytes = header.colormapLength * (header.colormapSize >> 3);
    palettes = content.subarray(offset, offset + palBytes);
    offset += palBytes;
  }

  // 像素数据 (RLE 解码后或原始)
  let pixelData: Uint8Array;
  if (useRle) {
    pixelData = decodeRLE(content, offset, pixelTotal, pixelSize);
  } else {
    pixelData = content.subarray(offset, offset + pixelTotal);
  }

  // 像素 → RGBA8
  const imageData = new Uint8Array(header.width * header.height * 4);
  writeImageData(imageData, header, pixelData, palettes, useGrey);

  return {
    width: header.width,
    height: header.height,
    data: imageData,
  };
}

// ── 内部 ──────────────────────────────────────────────────────────────

function checkHeader(header: TGAHeader): void {
  // 校验类型与调色板
  switch (header.imageType) {
    case TGA_TYPE_INDEXED:
    case TGA_TYPE_RLE_INDEXED:
      if (header.colormapLength > 256 || header.colormapSize !== 24 || header.colormapType !== 1) {
        throw new Error('TGALoader: invalid colormap data for indexed type');
      }
      break;
    case TGA_TYPE_RGB:
    case TGA_TYPE_GREY:
    case TGA_TYPE_RLE_RGB:
    case TGA_TYPE_RLE_GREY:
      if (header.colormapType !== 0) {
        throw new Error('TGALoader: invalid colormap type for RGB/GREY');
      }
      break;
    case TGA_TYPE_NO_DATA:
      throw new Error('TGALoader: no data');
    default:
      throw new Error(`TGALoader: invalid image type ${header.imageType}`);
  }
  if (header.width <= 0 || header.height <= 0) {
    throw new Error('TGALoader: invalid image size');
  }
  if (header.pixelSize !== 8 && header.pixelSize !== 16 &&
      header.pixelSize !== 24 && header.pixelSize !== 32) {
    throw new Error(`TGALoader: invalid pixel size ${header.pixelSize}`);
  }
}

function decodeRLE(data: Uint8Array, start: number, pixelTotal: number, pixelSize: number): Uint8Array {
  const out = new Uint8Array(pixelTotal);
  let shift = 0;
  let pos = start;
  const pixel = new Uint8Array(pixelSize);

  while (shift < pixelTotal && pos < data.length) {
    const c = data[pos++];
    const count = (c & 0x7f) + 1;
    if (c & 0x80) {
      // RLE run: 读 1 像素,重复 count 次
      for (let i = 0; i < pixelSize; i++) {
        if (pos >= data.length) throw new Error('TGALoader: RLE pixel truncated');
        pixel[i] = data[pos++];
      }
      for (let i = 0; i < count; i++) {
        const base = shift + i * pixelSize;
        if (base + pixelSize > pixelTotal) break;
        out.set(pixel, base);
      }
      shift += pixelSize * count;
    } else {
      // raw: 读 count 个像素
      const rawLen = count * pixelSize;
      for (let i = 0; i < rawLen; i++) {
        if (pos >= data.length) throw new Error('TGALoader: RLE raw truncated');
        if (shift + i >= pixelTotal) break;
        out[shift + i] = data[pos++];
      }
      shift += rawLen;
    }
  }
  return out;
}

function writeImageData(
  out: Uint8Array,
  header: TGAHeader,
  image: Uint8Array,
  palette: Uint8Array | null,
  useGrey: boolean,
): void {
  const width = header.width;
  const height = header.height;
  const origin = (header.flags & TGA_ORIGIN_MASK) >> TGA_ORIGIN_SHIFT;
  let xStart: number, xStep: number, xEnd: number;
  let yStart: number, yStep: number, yEnd: number;
  switch (origin) {
    default:
    case TGA_ORIGIN_UL:
      xStart = 0; xStep = 1; xEnd = width;
      yStart = 0; yStep = 1; yEnd = height;
      break;
    case TGA_ORIGIN_BL:
      xStart = 0; xStep = 1; xEnd = width;
      yStart = height - 1; yStep = -1; yEnd = -1;
      break;
    case TGA_ORIGIN_UR:
      xStart = width - 1; xStep = -1; xEnd = -1;
      yStart = 0; yStep = 1; yEnd = height;
      break;
    case TGA_ORIGIN_BR:
      xStart = width - 1; xStep = -1; xEnd = -1;
      yStart = height - 1; yStep = -1; yEnd = -1;
      break;
  }

  if (useGrey) {
    if (header.pixelSize === 8) {
      let i = 0;
      for (let y = yStart; y !== yEnd; y += yStep) {
        for (let x = xStart; x !== xEnd; x += xStep, i++) {
          const v = image[i];
          const o = (x + width * y) * 4;
          out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
        }
      }
    } else if (header.pixelSize === 16) {
      let i = 0;
      for (let y = yStart; y !== yEnd; y += yStep) {
        for (let x = xStart; x !== xEnd; x += xStep, i += 2) {
          const v = image[i];
          const o = (x + width * y) * 4;
          out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = image[i + 1];
        }
      }
    } else {
      throw new Error(`TGALoader: grey pixel_size ${header.pixelSize} not supported`);
    }
    return;
  }

  // 彩色 (含 INDEXED)
  if (header.pixelSize === 8) {
    if (!palette) throw new Error('TGALoader: indexed image missing palette');
    let i = 0;
    for (let y = yStart; y !== yEnd; y += yStep) {
      for (let x = xStart; x !== xEnd; x += xStep, i++) {
        const color = image[i];
        const o = (x + width * y) * 4;
        out[o + 3] = 255;
        out[o + 2] = palette[color * 3 + 0];
        out[o + 1] = palette[color * 3 + 1];
        out[o + 0] = palette[color * 3 + 2];
      }
    }
  } else if (header.pixelSize === 16) {
    let i = 0;
    for (let y = yStart; y !== yEnd; y += yStep) {
      for (let x = xStart; x !== xEnd; x += xStep, i += 2) {
        const color = image[i] | (image[i + 1] << 8);
        const o = (x + width * y) * 4;
        out[o + 0] = (color & 0x7c00) >> 7;
        out[o + 1] = (color & 0x03e0) >> 2;
        out[o + 2] = (color & 0x001f) << 3;
        out[o + 3] = (color & 0x8000) ? 0 : 255;
      }
    }
  } else if (header.pixelSize === 24) {
    let i = 0;
    for (let y = yStart; y !== yEnd; y += yStep) {
      for (let x = xStart; x !== xEnd; x += xStep, i += 3) {
        const o = (x + width * y) * 4;
        out[o + 3] = 255;
        out[o + 2] = image[i];
        out[o + 1] = image[i + 1];
        out[o + 0] = image[i + 2];
      }
    }
  } else if (header.pixelSize === 32) {
    let i = 0;
    for (let y = yStart; y !== yEnd; y += yStep) {
      for (let x = xStart; x !== xEnd; x += xStep, i += 4) {
        const o = (x + width * y) * 4;
        out[o + 2] = image[i];
        out[o + 1] = image[i + 1];
        out[o + 0] = image[i + 2];
        out[o + 3] = image[i + 3];
      }
    }
  }
}
