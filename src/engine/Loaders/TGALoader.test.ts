import { describe, it, expect } from 'vitest';
import { parseTGA, TGALoader } from './TGALoader';

/** 构造最小未压缩 24-bit RGB TGA (2x1 像素)。 */
function makeTGA24(width: number, height: number, pixels: Uint8Array): ArrayBuffer {
  // 18 字节头 + 像素数据 (BGR)
  const header = new Uint8Array(18);
  header[2] = 2; // image_type = RGB
  header[12] = width & 0xff;
  header[13] = (width >> 8) & 0xff;
  header[14] = height & 0xff;
  header[15] = (height >> 8) & 0xff;
  header[16] = 24; // pixel_size
  header[17] = 0x20; // flags: origin = UL (0x20 >> 4 = 2)
  const buf = new ArrayBuffer(header.length + pixels.length);
  const u8 = new Uint8Array(buf);
  u8.set(header, 0);
  u8.set(pixels, header.length);
  return buf;
}

/** 构造最小未压缩 32-bit RGBA TGA。 */
function makeTGA32(width: number, height: number, pixels: Uint8Array): ArrayBuffer {
  const header = new Uint8Array(18);
  header[2] = 2; // RGB
  header[12] = width & 0xff;
  header[13] = (width >> 8) & 0xff;
  header[14] = height & 0xff;
  header[15] = (height >> 8) & 0xff;
  header[16] = 32; // pixel_size
  header[17] = 0x20; // origin UL
  const buf = new ArrayBuffer(header.length + pixels.length);
  const u8 = new Uint8Array(buf);
  u8.set(header, 0);
  u8.set(pixels, header.length);
  return buf;
}

/** 构造最小未压缩 8-bit 灰度 TGA。 */
function makeTGAGrey8(width: number, height: number, pixels: Uint8Array): ArrayBuffer {
  const header = new Uint8Array(18);
  header[2] = 3; // GREY
  header[12] = width & 0xff;
  header[13] = (width >> 8) & 0xff;
  header[14] = height & 0xff;
  header[15] = (height >> 8) & 0xff;
  header[16] = 8;
  header[17] = 0x20; // origin UL
  const buf = new ArrayBuffer(header.length + pixels.length);
  const u8 = new Uint8Array(buf);
  u8.set(header, 0);
  u8.set(pixels, header.length);
  return buf;
}

/** 构造 RLE 24-bit TGA: 把 pixels 编码为 RLE (每像素 3 字节 BGR)。 */
function makeTGARLE24(width: number, height: number, pixels: Uint8Array): ArrayBuffer {
  const header = new Uint8Array(18);
  header[2] = 10; // RLE_RGB
  header[12] = width & 0xff;
  header[13] = (width >> 8) & 0xff;
  header[14] = height & 0xff;
  header[15] = (height >> 8) & 0xff;
  header[16] = 24;
  header[17] = 0x20;
  // 简单 RLE: 每个像素作为一个 raw run (code = 0, count=1)
  // 注: count = (c & 0x7f) + 1, 所以 c=0 → count=1
  const pixelSize = 3;
  const rle: number[] = [];
  for (let i = 0; i < pixels.length; i += pixelSize) {
    rle.push(0); // raw run of 1
    rle.push(pixels[i], pixels[i + 1], pixels[i + 2]);
  }
  const rleBytes = new Uint8Array(rle);
  const buf = new ArrayBuffer(header.length + rleBytes.length);
  const u8 = new Uint8Array(buf);
  u8.set(header, 0);
  u8.set(rleBytes, header.length);
  return buf;
}

describe('TGALoader', () => {
  describe('parseTGA (uncompressed)', () => {
    it('parses 24-bit RGB → RGBA8 (origin UL)', () => {
      // 2x1 像素 BGR: red, blue
      const pixels = new Uint8Array([
        0, 0, 255,  // BGR red
        255, 0, 0,  // BGR blue
      ]);
      const r = parseTGA(makeTGA24(2, 1, pixels));
      expect(r.width).toBe(2);
      expect(r.height).toBe(1);
      expect(r.data.length).toBe(2 * 4);
      // 原点 UL,y 不翻转
      expect(r.data[0]).toBe(255); // R
      expect(r.data[1]).toBe(0);
      expect(r.data[2]).toBe(0);
      expect(r.data[3]).toBe(255); // A
      expect(r.data[4]).toBe(0);    // 第二像素 R
      expect(r.data[6]).toBe(255);  // B
    });

    it('parses 32-bit RGBA', () => {
      const pixels = new Uint8Array([
        0, 0, 255, 128, // BGR A
      ]);
      const r = parseTGA(makeTGA32(1, 1, pixels));
      expect(r.data[0]).toBe(255); // R
      expect(r.data[3]).toBe(128); // A
    });

    it('parses 8-bit grey', () => {
      const pixels = new Uint8Array([128]);
      const r = parseTGA(makeTGAGrey8(1, 1, pixels));
      expect(r.data[0]).toBe(128);
      expect(r.data[1]).toBe(128);
      expect(r.data[2]).toBe(128);
      expect(r.data[3]).toBe(255);
    });
  });

  describe('parseTGA (RLE)', () => {
    it('decodes RLE RGB', () => {
      const pixels = new Uint8Array([
        0, 0, 255,   // red
        255, 0, 0,   // blue
      ]);
      const r = parseTGA(makeTGARLE24(2, 1, pixels));
      expect(r.data.length).toBe(8);
      expect(r.data[0]).toBe(255); // R of red
      expect(r.data[4]).toBe(0);  // R of blue
      expect(r.data[6]).toBe(255); // B of blue
    });
  });

  describe('parseTGA (origins)', () => {
    it('flips rows when origin is BL', () => {
      // 1x2 像素,origin BL → 输出顶部应来自第 1 个输入像素
      const header = new Uint8Array(18);
      header[2] = 2; // RGB
      header[12] = 1;
      header[14] = 2;
      header[16] = 24;
      header[17] = 0x00; // origin BL (0x00 >> 4 = 0)
      // 输入像素顺序: 第一行先存 (BGR red),第二行后存 (BGR blue)
      const pixels = new Uint8Array([
        0, 0, 255,
        255, 0, 0,
      ]);
      const buf = new ArrayBuffer(18 + pixels.length);
      const u8 = new Uint8Array(buf);
      u8.set(header, 0);
      u8.set(pixels, 18);
      const r = parseTGA(buf);
      // origin BL: 输出顶行来自最后输入行
      expect(r.data[0]).toBe(0);    // 顶 R (blue pixel)
      expect(r.data[2]).toBe(255);
      expect(r.data[4]).toBe(255);  // 底 R (red pixel)
    });
  });

  describe('TGALoader class', () => {
    it('canLoad detects .tga', () => {
      const loader = new TGALoader();
      expect(loader.canLoad(new File([], 'x.tga'))).toBe(true);
      expect(loader.canLoad(new File([], 'x.png'))).toBe(false);
    });

    it('load accepts ArrayBuffer', async () => {
      const loader = new TGALoader();
      const r = await loader.load(makeTGA24(1, 1, new Uint8Array([0, 0, 255])));
      expect(r.width).toBe(1);
    });
  });

  describe('errors', () => {
    it('throws on too-small file', () => {
      expect(() => parseTGA(new ArrayBuffer(10))).toThrow('too small');
    });

    it('throws on NO_DATA type', () => {
      const header = new Uint8Array(18);
      header[2] = 0; // NO_DATA
      header[12] = 1; header[14] = 1;
      header[16] = 24;
      expect(() => parseTGA(header.buffer)).toThrow(/no data/i);
    });

    it('throws on invalid pixel size', () => {
      const header = new Uint8Array(18);
      header[2] = 2;
      header[12] = 1; header[14] = 1;
      header[16] = 12; // invalid
      expect(() => parseTGA(header.buffer)).toThrow('invalid pixel size');
    });
  });
});
