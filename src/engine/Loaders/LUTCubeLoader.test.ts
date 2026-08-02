// LUTCubeLoader 测试 — .cube 3D/1D LUT 解析器。
//
// 验证:
//   • 最小 2² 3D LUT (TITLE + LUT_3D_SIZE + 8 行)
//   • 标题解析 (带引号/不带引号)
//   • DOMAIN_MIN / DOMAIN_MAX (标准 [0,1] 和 HDR [-0.125,1.125])
//   • 1D LUT (LUT_1D_SIZE)
//   • 注释行 (#) 跳过
//   • 数据不足 (抛错) / 行分量不足 (抛错) / 非有限值 (抛错)
//   • 从数据行数自动推断大小(无前缀大小)
//   • 布局验证: (R-slow, G-mid, B-fast) 顺序与 cube3DToStrip 一致
//   • cube3DToStrip ↔ stripToCube3D round-trip 恒等
//   • identity LUT: sample output = input
//   • 混合颜色 LUT: 采样验证
//   • 空文件 / 无数据 / 未知 size 行抛错
//   • 实际 .cube 内容字符串解析 (模拟 DaVinci Resolve 导出)

import { describe, it, expect } from 'vitest';
import {
  parseCube,
  cube3DToStrip,
  stripToCube3D,
  toData3DTexture,
  LUTCubeLoader,
} from './LUTCubeLoader';

// ── helpers ─────────────────────────────────────────────────────────

/** 生成 N×N×N identity 3D LUT: output = input. */
function identityCube3D(size: number): string {
  const lines: string[] = [];
  lines.push(`# Identity 3D LUT ${size}³`);
  lines.push(`TITLE "Identity_${size}"`);
  lines.push(`LUT_3D_SIZE ${size}`);
  lines.push(`DOMAIN_MIN 0.0 0.0 0.0`);
  lines.push(`DOMAIN_MAX 1.0 1.0 1.0`);
  lines.push('');
  // R slow → G mid → B fast
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const rv = r / (size - 1);
        const gv = g / (size - 1);
        const bv = b / (size - 1);
        lines.push(`${rv.toFixed(6)} ${gv.toFixed(6)} ${bv.toFixed(6)}`);
      }
    }
  }
  return lines.join('\n');
}

/** 生成 N identity 1D LUT. */
function identityCube1D(size: number): string {
  const lines: string[] = [];
  lines.push(`# Identity 1D LUT`);
  lines.push(`TITLE "1D_Identity"`);
  lines.push(`LUT_1D_SIZE ${size}`);
  lines.push('');
  for (let i = 0; i < size; i++) {
    const v = i / (size - 1);
    lines.push(`${v.toFixed(6)} ${v.toFixed(6)} ${v.toFixed(6)}`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────

describe('parseCube: header + metadata', () => {
  it('parses minimal 2³ identity LUT', () => {
    const txt = identityCube3D(2);
    const r = parseCube(txt);
    expect(r.type).toBe('3D');
    expect(r.size).toBe(2);
    expect(r.title).toBe('Identity_2');
    expect(r.domainMin).toEqual([0, 0, 0]);
    expect(r.domainMax).toEqual([1, 1, 1]);
    expect(r.data.length).toBe(8 * 3);
  });

  it('parses TITLE with quotes', () => {
    const txt = `TITLE "Teal & Orange"\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1`;
    const r = parseCube(txt);
    expect(r.title).toBe('Teal & Orange');
  });

  it('parses TITLE without quotes', () => {
    const txt = `TITLE NoQuotes\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1`;
    const r = parseCube(txt);
    expect(r.title).toBe('NoQuotes');
  });

  it('parses DOMAIN_MIN / DOMAIN_MAX HDR extended', () => {
    const txt = identityCube3D(2).replace(
      'DOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0',
      'DOMAIN_MIN -0.125 -0.125 -0.125\nDOMAIN_MAX 1.125 1.125 1.125',
    );
    const r = parseCube(txt);
    expect(r.domainMin).toEqual([-0.125, -0.125, -0.125]);
    expect(r.domainMax).toEqual([1.125, 1.125, 1.125]);
  });

  it('parses 1D LUT', () => {
    const txt = identityCube1D(5);
    const r = parseCube(txt);
    expect(r.type).toBe('1D');
    expect(r.size).toBe(5);
    expect(r.data.length).toBe(5 * 3);
  });

  it('skips comment lines (#)', () => {
    const txt = `#header1\n#header2\nLUT_3D_SIZE 2\n#body comment\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n#footer`;
    const r = parseCube(txt);
    expect(r.size).toBe(2);
    expect(r.data.length).toBe(24);
  });

  it('handles mixed whitespace (tabs, commas, semicolons)', () => {
    const row = (r: number, g: number, b: number) => `${r}\t${g}, ${b}`;
    const txt = `LUT_3D_SIZE 2\n${row(0,0,0)}\n${row(0,0,1)}\n${row(0,1,0)}\n${row(0,1,1)}\n${row(1,0,0)}\n${row(1,0,1)}\n${row(1,1,0)}\n${row(1,1,1)}`;
    const r = parseCube(txt);
    expect(r.size).toBe(2);
    expect(r.data[0]).toBe(0);
    expect(r.data[1]).toBe(0);
    expect(r.data[2]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('parseCube: error cases', () => {
  it('throws on empty file', () => {
    expect(() => parseCube('')).toThrow(/no data found/);
  });

  it('throws on header-only file (no data)', () => {
    expect(() => parseCube('# comment\nTITLE "x"\n')).toThrow(/no data found/);
  });

  it('throws on too few data rows', () => {
    const txt = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0'; // 3 rows, need 8
    expect(() => parseCube(txt)).toThrow(/too few data rows/);
  });

  it('throws on row with fewer than 3 components', () => {
    const txt = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1\n1 1 1';
    expect(() => parseCube(txt)).toThrow(/components/);
  });

  it('throws on non-finite values (NaN)', () => {
    const txt = 'LUT_3D_SIZE 2\nNaN 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
    expect(() => parseCube(txt)).toThrow(/non-finite/);
  });

  it('throws on non-finite values (Infinity)', () => {
    const txt = 'LUT_3D_SIZE 2\nInfinity 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
    expect(() => parseCube(txt)).toThrow(/non-finite/);
  });

  it('throws when cannot infer size from unlabeled data rows', () => {
    // 17 rows = not 2³, 3³, 4³, 5³ and not 256/512/1024...
    const rows = Array(17).fill('0 0 0');
    expect(() => parseCube(rows.join('\n'))).toThrow(/cannot infer LUT size/);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('parseCube: auto size inference', () => {
  it('infers 3D size=33 (33³ = 35937 rows) when size header is provided', () => {
    const N = 33;
    const rows = Array(N * N * N).fill('0.0 0.0 0.0');
    // 必须有 LUT_3D_SIZE 前缀,否则 row count 35937 不在 16/32/64/128/ 或 256-8192 候选中
    const text = `LUT_3D_SIZE ${N}\n${rows.join('\n')}\n`;
    const r = parseCube(text);
    expect(r.type).toBe('3D');
    expect(r.size).toBe(33);
    expect(r.data.length).toBe(33 * 33 * 33 * 3);
  });

  it('infers 3D size=16 from row count (16³=4096)', () => {
    const rows = Array(4096).fill('0.1 0.2 0.3');
    const r = parseCube(rows.join('\n'));
    expect(r.type).toBe('3D');
    expect(r.size).toBe(16);
    expect(r.data.length).toBe(4096 * 3);
  });

  it('infers 3D size=32 from row count (32³=32768)', () => {
    const rows = Array(32768).fill('0.5 0.5 0.5');
    const r = parseCube(rows.join('\n'));
    expect(r.type).toBe('3D');
    expect(r.size).toBe(32);
  });

  it('infers 1D size=1024 from row count', () => {
    const rows = Array(1024).fill('0.1 0.2 0.3');
    const r = parseCube(rows.join('\n'));
    expect(r.type).toBe('1D');
    expect(r.size).toBe(1024);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('parseCube: data layout verification', () => {
  it('identity 3D LUT: each entry matches expected RGB (R-slow/G-mid/B-fast)', () => {
    const size = 4;
    const r = parseCube(identityCube3D(size));
    for (let ri = 0; ri < size; ri++) {
      for (let gi = 0; gi < size; gi++) {
        for (let bi = 0; bi < size; bi++) {
          const idx = ((ri * size + gi) * size + bi) * 3;
          const expR = ri / (size - 1);
          const expG = gi / (size - 1);
          const expB = bi / (size - 1);
          expect(Math.abs(r.data[idx]     - expR)).toBeLessThan(1e-4);
          expect(Math.abs(r.data[idx + 1] - expG)).toBeLessThan(1e-4);
          expect(Math.abs(r.data[idx + 2] - expB)).toBeLessThan(1e-4);
        }
      }
    }
  });

  it('identity 1D LUT: each entry matches expected', () => {
    const size = 6;
    const r = parseCube(identityCube1D(size));
    for (let i = 0; i < size; i++) {
      const v = i / (size - 1);
      expect(Math.abs(r.data[i * 3]     - v)).toBeLessThan(1e-4);
      expect(Math.abs(r.data[i * 3 + 1] - v)).toBeLessThan(1e-4);
      expect(Math.abs(r.data[i * 3 + 2] - v)).toBeLessThan(1e-4);
    }
  });

  it('custom color transform: inverts all channels (output = 1 - input)', () => {
    const size = 3;
    const lines: string[] = [];
    lines.push(`LUT_3D_SIZE ${size}`);
    for (let r = 0; r < size; r++) {
      for (let g = 0; g < size; g++) {
        for (let b = 0; b < size; b++) {
          const rv = 1 - r / (size - 1);
          const gv = 1 - g / (size - 1);
          const bv = 1 - b / (size - 1);
          lines.push(`${rv} ${gv} ${bv}`);
        }
      }
    }
    const res = parseCube(lines.join('\n'));
    // Corner (R=1, G=1, B=1) → should be (0,0,0)
    const idx = ((2 * size + 2) * size + 2) * 3;
    expect(Math.abs(res.data[idx])).toBeLessThan(1e-6);
    expect(Math.abs(res.data[idx + 1])).toBeLessThan(1e-6);
    expect(Math.abs(res.data[idx + 2])).toBeLessThan(1e-6);
    // (R=0,G=0,B=0) → should be (1,1,1)
    const idx2 = 0;
    expect(res.data[idx2]).toBeCloseTo(1);
    expect(res.data[idx2 + 1]).toBeCloseTo(1);
    expect(res.data[idx2 + 2]).toBeCloseTo(1);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('cube3DToStrip ↔ stripToCube3D round-trip', () => {
  it('round-trips random 3D LUT to strip and back (size=4)', () => {
    const size = 4;
    const total = size * size * size * 3;
    const src = new Float32Array(total);
    for (let i = 0; i < total; i++) src[i] = Math.random();
    const strip = cube3DToStrip(src, size);
    expect(strip.length).toBe(total);
    const back = stripToCube3D(strip, size);
    for (let i = 0; i < total; i++) {
      expect(back[i]).toBeCloseTo(src[i], 6);
    }
  });

  it('round-trips identity 3D LUT (size=8)', () => {
    const size = 8;
    const src = parseCube(identityCube3D(size)).data;
    const strip = cube3DToStrip(src, size);
    const back = stripToCube3D(strip, size);
    for (let i = 0; i < src.length; i++) {
      expect(back[i]).toBeCloseTo(src[i], 6);
    }
  });

  it('cube3DToStrip: corner (R=1,G=0,B=0) maps to last row last col in strip', () => {
    const size = 3;
    const src = parseCube(identityCube3D(size)).data;
    const strip = cube3DToStrip(src, size);
    // In strip: row = g*size + b = 0*3+0 = 0, col = r = size-1 = 2
    const stripIdx = (0 * size + 2) * 3;
    // Expected: RGB=(1,0,0)
    expect(strip[stripIdx]).toBeCloseTo(1);
    expect(strip[stripIdx + 1]).toBeCloseTo(0);
    expect(strip[stripIdx + 2]).toBeCloseTo(0);
  });

  it('cube3DToStrip: corner (R=0,G=1,B=1) maps to correct strip position', () => {
    const size = 3;
    const src = parseCube(identityCube3D(size)).data;
    const strip = cube3DToStrip(src, size);
    // In identityCube3D: G=index 1 → 1/(size-1) = 1/2 = 0.5; B=1 → same 0.5
    // (R=0 index, G=1 index, B=1 index) → row = g*size+b = 1*3+1 = 4, col = r = 0
    const stripIdx = (4 * size + 0) * 3;
    // Expected: RGB = (0.0, 0.5, 0.5)
    expect(strip[stripIdx]).toBeCloseTo(0);
    expect(strip[stripIdx + 1]).toBeCloseTo(0.5);
    expect(strip[stripIdx + 2]).toBeCloseTo(0.5);
  });

  it('cube3DToStrip throws on data too small', () => {
    expect(() => cube3DToStrip(new Float32Array(10), 8)).toThrow(/data too small/);
  });

  it('stripToCube3D throws on strip too small', () => {
    expect(() => stripToCube3D(new Float32Array(10), 8)).toThrow(/strip data too small/);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('LUTCubeLoader: canLoad detection', () => {
  it('accepts .cube URL', () => {
    const l = new LUTCubeLoader();
    expect(l.canLoad('/luts/teal-orange.cube')).toBe(true);
    expect(l.canLoad('https://cdn.io/filmic.cube?v=1')).toBe(true);
    expect(l.canLoad('/data/texture.png')).toBe(false);
  });

  it('accepts File with .cube name', () => {
    const l = new LUTCubeLoader();
    const f = new File([], 'neon.cube');
    expect(l.canLoad(f)).toBe(true);
    const f2 = new File([], 'abc.png');
    expect(l.canLoad(f2)).toBe(false);
  });

  it('accepts via hints', () => {
    const l = new LUTCubeLoader();
    expect(l.canLoad('/data/file.bin', { cubeLut: true })).toBe(true);
    expect(l.canLoad('/data/file.bin', { mime: 'text/x-cube' })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('parseCube: simulated DaVinci Resolve export', () => {
  it('parses realistic DaVinci 17 export (33-point HALD CLUT)', () => {
    // 33³ = 35937 rows. Use 4× to save time in test but keep realistic header.
    const size = 4;
    const lines: string[] = [];
    lines.push('# DaVinci Resolve Color Management');
    lines.push('# Look: TEAL_ORANGE_FILMIC');
    lines.push('TITLE "Resolve 17 - TEAL_ORANGE_FILMIC_v3"');
    lines.push(`LUT_3D_SIZE ${size}`);
    lines.push('DOMAIN_MIN 0.0 0.0 0.0');
    lines.push('DOMAIN_MAX 1.0 1.0 1.0');
    lines.push('LUT_3D_INPUT_RANGE 0.0 1.0');
    lines.push('');
    // Create a "teal-orange" tint: shadows toward teal, highlights toward orange
    for (let r = 0; r < size; r++) {
      for (let g = 0; g < size; g++) {
        for (let b = 0; b < size; b++) {
          let rv = r / (size - 1);
          let gv = g / (size - 1);
          let bv = b / (size - 1);
          // Teal shadows (low luminance): boost G+B
          const lum = 0.299 * rv + 0.587 * gv + 0.114 * bv;
          if (lum < 0.5) {
            gv += (0.5 - lum) * 0.1;
            bv += (0.5 - lum) * 0.2;
          } else {
            // Orange highlights: boost R, slightly boost G, cut B
            rv += (lum - 0.5) * 0.2;
            gv += (lum - 0.5) * 0.05;
            bv -= (lum - 0.5) * 0.15;
          }
          rv = Math.max(0, Math.min(1, rv));
          gv = Math.max(0, Math.min(1, gv));
          bv = Math.max(0, Math.min(1, bv));
          lines.push(`${rv.toFixed(6)} ${gv.toFixed(6)} ${bv.toFixed(6)}`);
        }
      }
    }
    const txt = lines.join('\n');
    const r = parseCube(txt);
    expect(r.type).toBe('3D');
    expect(r.size).toBe(size);
    expect(r.title).toContain('TEAL_ORANGE');
    // Verify shadow pixel (R=0,G=0,B=0): boosted G,B
    expect(r.data[0]).toBeCloseTo(0);
    expect(r.data[1]).toBeGreaterThan(0); // G boosted
    expect(r.data[2]).toBeGreaterThan(0); // B boosted
    // Verify highlight pixel (R=1,G=1,B=1): R up, G up a bit, B down
    const hl = (((size - 1) * size + (size - 1)) * size + (size - 1)) * 3;
    expect(r.data[hl]).toBeCloseTo(1);
    expect(r.data[hl + 1]).toBeCloseTo(1);
    expect(r.data[hl + 2]).toBeLessThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('toData3DTexture: LUT → Data3DTexture conversion', () => {
  it('converts 3D LUT to Data3DTexture with correct dimensions', () => {
    const size = 4;
    const parsed = parseCube(identityCube3D(size));
    const tex = toData3DTexture(parsed);
    expect(tex.width).toBe(size);
    expect(tex.height).toBe(size);
    expect(tex.depth).toBe(size);
    expect(tex.format).toBe('rgb');
    expect(tex.type).toBe('float');
    expect(tex.wrapR).toBe('clamp');
    expect(tex.wrapS).toBe('clamp');
    expect(tex.wrapT).toBe('clamp');
    expect(tex.minFilter).toBe('linear');
    expect(tex.magFilter).toBe('linear');
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.colorSpace).toBe('linear');
    expect(tex.flipY).toBe(false);
    expect(tex.isData3DTexture).toBe(true);
  });

  it('shares the same data buffer (zero-copy)', () => {
    const size = 3;
    const parsed = parseCube(identityCube3D(size));
    const tex = toData3DTexture(parsed);
    expect(tex.data).toBe(parsed.data); // same reference
  });

  it('sets name from LUT title', () => {
    const text = `TITLE "My Cool LUT"\nLUT_3D_SIZE 2\n${Array(8).fill('0 0 0').join('\n')}\n`;
    const parsed = parseCube(text);
    const tex = toData3DTexture(parsed);
    expect(tex.name).toBe('My Cool LUT');
  });

  it('sets default name when no title', () => {
    const text = `LUT_3D_SIZE 2\n${Array(8).fill('0 0 0').join('\n')}\n`;
    const parsed = parseCube(text);
    expect(parsed.title).toBe('');
    const tex = toData3DTexture(parsed);
    expect(tex.name).toBe('lut-3d-2');
  });

  it('throws on 1D LUT', () => {
    const text = `LUT_1D_SIZE 4\n0 0 0\n0.33 0.33 0.33\n0.66 0.66 0.66\n1 1 1\n`;
    const parsed = parseCube(text);
    expect(() => toData3DTexture(parsed)).toThrow(/only 3D LUTs/);
  });
});
