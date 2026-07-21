import { describe, it, expect } from 'vitest';
import { parseRGBE, decodeRGBE, HDRLoader } from './HDRLoader';

/**
 * Build a minimal valid .hdr file content.
 *
 * Structure:
 *   #?RADIANCE\n
 *   FORMAT=32-bit_rle_rgbe\n
 *   \n
 *   -Y <height> +X <width>\n
 *   <RLE scanline data>    (per-channel RLE: marker [2,2,hi,lo], then R,G,B,E channels)
 */
function makeHDRBytes(
  width: number,
  height: number,
  /** Per-pixel RGBA bytes arranged as [R0,G0,B0,E0, R1,G1,B1,E1, ...] */
  pixels: Uint8Array,
): Uint8Array {
  // Header
  const headerStr = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const header = new TextEncoder().encode(headerStr);

  // RLE scanline data — per-channel RLE
  const scanlineLen = width * 4;
  const rleData: number[] = [];
  for (let y = 0; y < height; y++) {
    // RLE marker
    rleData.push(2, 2, (width >> 8) & 0xff, width & 0xff);
    // Encode each channel (R, G, B, E) with raw copy (each channel has 'width' bytes)
    for (let c = 0; c < 4; c++) {
      const channel = new Uint8Array(width);
      for (let x = 0; x < width; x++) {
        channel[x] = pixels[(y * width + x) * 4 + c];
      }
      // Use raw copy: code = width, followed by the bytes
      rleData.push(width);
      for (let k = 0; k < width; k++) {
        rleData.push(channel[k]);
      }
    }
  }

  const data = new Uint8Array(header.length + rleData.length);
  data.set(header, 0);
  data.set(new Uint8Array(rleData), header.length);
  return data;
}

describe('HDRLoader', () => {
  describe('parseRGBE', () => {
    it('parses header from minimal .hdr', () => {
      const buf = makeHDRBytes(2, 1, new Uint8Array([
        255, 0, 0, 128,   // pixel 0: red
        255, 255, 255, 128, // pixel 1: white
      ]));
      const { header } = parseRGBE(buf);
      expect(header.width).toBe(2);
      expect(header.height).toBe(1);
      expect(header.exposure).toBe(1);
    });

    it('throws on bad magic', () => {
      const buf = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(() => parseRGBE(buf)).toThrow('not a Radiance RGBE file');
    });

    it('throws on too-small file', () => {
      const buf = new Uint8Array([0, 0]);
      expect(() => parseRGBE(buf)).toThrow('file too small');
    });

    it('reads exposure from header', () => {
      const headerStr = '#?RADIANCE\nEXPOSURE=2.5\n\n-Y 1 +X 1\n';
      const data = new Uint8Array([...new TextEncoder().encode(headerStr), 2, 2, 0, 1, 1, 128, 1, 0, 1, 0, 1, 128]);
      const { header } = parseRGBE(data);
      expect(header.exposure).toBeCloseTo(2.5);
    });
  });

  describe('decodeRGBE', () => {
    it('decodes red pixel correctly', () => {
      // Red pixel: RGBE = (255, 0, 0, 128)
      // formula: (v + 0.5) / 256 * 2^(E - 128)
      // (255.5)/256 * 2^0 = 0.998
      const buf = makeHDRBytes(1, 1, new Uint8Array([255, 0, 0, 128]));
      const { pixels } = parseRGBE(buf);
      const out = new Float32Array(4);
      decodeRGBE(pixels, out, 1, 1, 1);
      expect(out[0]).toBeCloseTo(0.998, 2);
      expect(out[1]).toBeCloseTo(0.002, 2);  // (0+0.5)/256 ≈ 0.00195
      expect(out[2]).toBeCloseTo(0.002, 2);
      expect(out[3]).toBe(1);
    });

    it('decodes white pixel correctly', () => {
      const buf = makeHDRBytes(1, 1, new Uint8Array([255, 255, 255, 128]));
      const { pixels } = parseRGBE(buf);
      const out = new Float32Array(4);
      decodeRGBE(pixels, out, 1, 1, 1);
      expect(out[0]).toBeCloseTo(0.998, 2);
      expect(out[1]).toBeCloseTo(0.998, 2);
      expect(out[2]).toBeCloseTo(0.998, 2);
      expect(out[3]).toBe(1);
    });

    it('decodes black pixel (E=0) as (0,0,0)', () => {
      const buf = makeHDRBytes(1, 1, new Uint8Array([0, 0, 0, 0]));
      const { pixels } = parseRGBE(buf);
      const out = new Float32Array(4);
      decodeRGBE(pixels, out, 1, 1, 1);
      expect(out[0]).toBe(0);
      expect(out[1]).toBe(0);
      expect(out[2]).toBe(0);
      expect(out[3]).toBe(1);
    });

    it('applies exposure multiplier', () => {
      const buf = makeHDRBytes(1, 1, new Uint8Array([255, 0, 0, 128]));
      const { pixels } = parseRGBE(buf);
      const out = new Float32Array(4);
      decodeRGBE(pixels, out, 1, 1, 2.0);  // 2x exposure
      expect(out[0]).toBeCloseTo(1.996, 2);
    });

    it('decodes multi-pixel scanline', () => {
      // 3 pixels: red, green, blue
      const buf = makeHDRBytes(3, 1, new Uint8Array([
        255, 0, 0, 128,
        0, 255, 0, 128,
        0, 0, 255, 128,
      ]));
      const { pixels } = parseRGBE(buf);
      const out = new Float32Array(3 * 4);
      decodeRGBE(pixels, out, 3, 1, 1);
      expect(out[0]).toBeCloseTo(0.998, 1); // R
      expect(out[4 + 1]).toBeCloseTo(0.998, 1); // G of pixel 1
      expect(out[8 + 2]).toBeCloseTo(0.998, 1); // B of pixel 2
    });

    it('decodes multi-row image (2x2)', () => {
      // 2x2: all white
      const buf = makeHDRBytes(2, 2, new Uint8Array([
        255, 255, 255, 128,  255, 255, 255, 128,
        255, 255, 255, 128,  255, 255, 255, 128,
      ]));
      const { pixels } = parseRGBE(buf);
      const out = new Float32Array(2 * 2 * 4);
      decodeRGBE(pixels, out, 2, 2, 1);
      for (let i = 0; i < 4; i++) {
        expect(out[i * 4]).toBeCloseTo(0.998, 1);
        expect(out[i * 4 + 1]).toBeCloseTo(0.998, 1);
        expect(out[i * 4 + 2]).toBeCloseTo(0.998, 1);
        expect(out[i * 4 + 3]).toBe(1);
      }
    });

    it('throws on truncated RLE data', () => {
      // Header only, no pixel data
      const headerStr = '#?RADIANCE\n\n-Y 1 +X 2\n';
      const header = new TextEncoder().encode(headerStr);
      const { pixels } = parseRGBE(header);
      const out = new Float32Array(2 * 4);
      expect(() => decodeRGBE(pixels, out, 2, 1, 1)).toThrow('truncated');
    });
  });

  describe('HDRLoader class', () => {
    it('canLoad detects .hdr files', () => {
      const loader = new HDRLoader();
      expect(loader.canLoad(new File([], 'test.hdr'))).toBe(true);
      expect(loader.canLoad(new File([], 'test.exr'))).toBe(false);
      expect(loader.canLoad('test.hdr')).toBe(true);
      expect(loader.canLoad('test.hdri')).toBe(false);
    });

    it('load returns LoadedHDR from File', async () => {
      const buf = makeHDRBytes(1, 1, new Uint8Array([255, 255, 255, 128]));
      const file = new File([buf], 'test.hdr', { type: 'image/hdr' });
      const loader = new HDRLoader();
      const result = await loader.load(file);
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.texture).toBeDefined();
      expect(result.texture.image).toBeDefined();
    });
  });
});