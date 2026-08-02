import { describe, it, expect } from 'vitest';
import { Data3DTexture } from './Data3DTexture';
import { Texture } from './Texture';

// ─────────────────────────────────────────────────────────────────────
// Data3DTexture — 真 3D 纹理 (WebGL2 TEXTURE_3D) 单元测试
// ─────────────────────────────────────────────────────────────────────

describe('Data3DTexture: construction', () => {
  it('creates with default values', () => {
    const tex = new Data3DTexture();
    expect(tex.width).toBe(1);
    expect(tex.height).toBe(1);
    expect(tex.depth).toBe(1);
    expect(tex.data).toBeNull();
    expect(tex.format).toBe('rgba');
    expect(tex.type).toBe('unsigned-byte');
    expect(tex.wrapR).toBe('clamp');
    expect(tex.wrapS).toBe('clamp');
    expect(tex.wrapT).toBe('clamp');
    expect(tex.minFilter).toBe('linear');
    expect(tex.magFilter).toBe('linear');
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.flipY).toBe(false);
    expect(tex.colorSpace).toBe('linear');
    expect(tex.unpackAlignment).toBe(1);
    expect(tex.isData3DTexture).toBe(true);
  });

  it('creates with Float32Array data → type auto-detected as float', () => {
    const data = new Float32Array(4 * 4 * 4 * 4); // RGBA 4³
    const tex = new Data3DTexture(data, 4, 4, 4, { format: 'rgba' });
    expect(tex.type).toBe('float');
    expect(tex.data).toBe(data);
    expect(tex.width).toBe(4);
    expect(tex.height).toBe(4);
    expect(tex.depth).toBe(4);
  });

  it('creates with Uint8Array data → type auto-detected as unsigned-byte', () => {
    const data = new Uint8Array(8 * 8 * 8 * 4);
    const tex = new Data3DTexture(data, 8, 8, 8);
    expect(tex.type).toBe('unsigned-byte');
  });

  it('accepts custom options', () => {
    const data = new Float32Array(2 * 2 * 2 * 3);
    const tex = new Data3DTexture(data, 2, 2, 2, {
      format: 'rgb',
      type: 'float',
      wrapR: 'repeat',
      minFilter: 'nearest',
      magFilter: 'nearest',
      generateMipmaps: true,
      colorSpace: 'srgb',
      flipY: true,
      unpackAlignment: 4,
    });
    expect(tex.format).toBe('rgb');
    expect(tex.type).toBe('float');
    expect(tex.wrapR).toBe('repeat');
    expect(tex.minFilter).toBe('nearest');
    expect(tex.magFilter).toBe('nearest');
    expect(tex.generateMipmaps).toBe(true);
    expect(tex.colorSpace).toBe('srgb');
    expect(tex.flipY).toBe(true);
    expect(tex.unpackAlignment).toBe(4);
  });

  it('clamps dimensions to minimum 1', () => {
    const tex = new Data3DTexture(null, 0, -5, 0.7);
    expect(tex.width).toBe(1);
    expect(tex.height).toBe(1);
    expect(tex.depth).toBe(1);
  });
});

describe('Data3DTexture: setData', () => {
  it('replaces data and bumps version', () => {
    const tex = new Data3DTexture();
    const v0 = tex.version;
    const data = new Float32Array(4 * 4 * 4 * 3);
    tex.setData(data, 4, 4, 4);
    expect(tex.data).toBe(data);
    expect(tex.width).toBe(4);
    expect(tex.height).toBe(4);
    expect(tex.depth).toBe(4);
    expect(tex.version).toBe(v0 + 1);
  });

  it('clamps new dimensions', () => {
    const tex = new Data3DTexture();
    tex.setData(new Float32Array(3), 0, 0, 0);
    expect(tex.width).toBe(1);
    expect(tex.height).toBe(1);
    expect(tex.depth).toBe(1);
  });
});

describe('Data3DTexture: copy / clone', () => {
  it('copy duplicates all fields and bumps version', () => {
    const data = new Float32Array(3 * 3 * 3 * 4);
    const src = new Data3DTexture(data, 3, 3, 3, {
      format: 'rgba',
      type: 'float',
      wrapR: 'mirror',
      unpackAlignment: 2,
    });
    src.name = 'test-lut';

    const dst = new Data3DTexture();
    const vBefore = dst.version;
    dst.copy(src);

    expect(dst.name).toBe('test-lut');
    expect(dst.data).toBe(data);
    expect(dst.width).toBe(3);
    expect(dst.height).toBe(3);
    expect(dst.depth).toBe(3);
    expect(dst.format).toBe('rgba');
    expect(dst.type).toBe('float');
    expect(dst.wrapR).toBe('mirror');
    expect(dst.unpackAlignment).toBe(2);
    expect(dst.version).toBe(vBefore + 1);
  });

  it('clone produces an independent copy', () => {
    const data = new Float32Array(2 * 2 * 2 * 3);
    const src = new Data3DTexture(data, 2, 2, 2, { format: 'rgb', type: 'float' });
    const clone = src.clone();
    expect(clone).not.toBe(src);
    expect(clone.data).toBe(data); // same buffer reference (shallow)
    expect(clone.width).toBe(2);
    expect(clone.height).toBe(2);
    expect(clone.depth).toBe(2);
    expect(clone.format).toBe('rgb');
    expect(clone.type).toBe('float');
  });
});

describe('Data3DTexture: inheritance', () => {
  it('extends Texture', () => {
    const tex = new Data3DTexture();
    expect(tex).toBeInstanceOf(Texture);
    expect(tex.glTexture).toBeNull();
    expect(tex.glVersion).toBe(-1);
  });

  it('has a uuid', () => {
    const tex = new Data3DTexture();
    expect(tex.uuid).toBeTruthy();
    expect(typeof tex.uuid).toBe('string');
  });
});

describe('Data3DTexture: LUT use-case', () => {
  it('can hold a 33³ RGB LUT for color grading', () => {
    const N = 33;
    const data = new Float32Array(N * N * N * 3);
    // Fill with identity-like data
    for (let r = 0; r < N; r++) {
      for (let g = 0; g < N; g++) {
        for (let b = 0; b < N; b++) {
          const idx = ((r * N + g) * N + b) * 3;
          data[idx] = r / (N - 1);
          data[idx + 1] = g / (N - 1);
          data[idx + 2] = b / (N - 1);
        }
      }
    }
    const tex = new Data3DTexture(data, N, N, N, {
      format: 'rgb',
      type: 'float',
      wrapR: 'clamp',
      wrapS: 'clamp',
      wrapT: 'clamp',
      minFilter: 'linear',
      magFilter: 'linear',
    });
    expect(tex.width).toBe(N);
    expect(tex.height).toBe(N);
    expect(tex.depth).toBe(N);
    expect(tex.data?.length).toBe(N * N * N * 3);
    // Verify first and last entries
    expect(data[0]).toBeCloseTo(0);
    expect(data[1]).toBeCloseTo(0);
    expect(data[2]).toBeCloseTo(0);
    const lastIdx = ((N - 1) * N + (N - 1)) * N + (N - 1);
    expect(data[lastIdx * 3]).toBeCloseTo(1);
    expect(data[lastIdx * 3 + 1]).toBeCloseTo(1);
    expect(data[lastIdx * 3 + 2]).toBeCloseTo(1);
  });
});
