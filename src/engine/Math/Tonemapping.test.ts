// Tonemapping 单元测试。
//
// 覆盖:
//   1. ACES Filmic 数值与 GLSL 常量一致(a=2.51, b=0.03, c=2.43, d=0.59, e=0.14)
//   2. Reinhard / ReinhardExtended 数值正确
//   3. Hable Filmic 曲线 + 白点归一化
//   4. applyTonemapping 各模式 + 边界(HDR 输入 → [0,1] 输出)
//   5. sRGB ↔ 线性 精确传输 + γ2.2 近似 + 往返
//   6. ACEScg ↔ sRGB 线性 矩阵往返
//   7. applyExposure(档位)/ luminance(Rec.709)
//   8. middleGrayOutput(0.18 灰)
//   9. ColorManagement: enabled / workingSpace / fromSRGB / toSRGB 往返
//  10. 算子单调性 / 一致性(中灰 ACES > Reinhard 等)

import { describe, it, expect } from 'vitest';
import {
  applyTonemapping,
  acesFilmicScalar,
  reinhardScalar,
  reinhardExtendedScalar,
  filmicScalar,
  hableCurve,
  linearToSRGB,
  sRGBToLinear,
  linearToSRGBGamma,
  sRGBGammaToLinear,
  linearToSRGBColor,
  sRGBToLinearColor,
  linearSRGBToACEScg,
  acescgToLinearSRGB,
  applyExposure,
  luminance,
  middleGrayOutput,
  ColorManagement,
  type TonemappingOperator,
  type RGBColor,
} from './Tonemapping';

describe('Tonemapping — ACES Filmic', () => {
  it('matches Narkowicz constants (a=2.51, b=0.03, c=2.43, d=0.59, e=0.14)', () => {
    // 手算 x=1.0: (1*(2.51*1+0.03))/(1*(2.43*1+0.59)+0.14) = 2.54/(3.02+0.14)=2.54/3.16=0.8038
    expect(acesFilmicScalar(1.0)).toBeCloseTo(2.54 / 3.16, 5);
  });

  it('maps 0 → 0', () => {
    expect(acesFilmicScalar(0)).toBeCloseTo(0, 6);
  });

  it('clamps output to [0,1] for HDR input', () => {
    expect(acesFilmicScalar(100)).toBeLessThanOrEqual(1);
    expect(acesFilmicScalar(100)).toBeGreaterThanOrEqual(0);
  });

  it('is monotonically increasing', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = acesFilmicScalar(i * 0.5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('matches GLSL formula exactly at several points', () => {
    // 与 TONEMAP_ACES_CHUNK 的 acesFilmic(vec3) 逐通道一致
    const cases: Array<[number, number]> = [
      [0.0, 0.0],
      [0.18, (0.18 * (2.51 * 0.18 + 0.03)) / (0.18 * (2.43 * 0.18 + 0.59) + 0.14)],
      [0.5, (0.5 * (2.51 * 0.5 + 0.03)) / (0.5 * (2.43 * 0.5 + 0.59) + 0.14)],
      [4.0, (4.0 * (2.51 * 4.0 + 0.03)) / (4.0 * (2.43 * 4.0 + 0.59) + 0.14)],
    ];
    for (const [x, expected] of cases) {
      expect(acesFilmicScalar(x)).toBeCloseTo(expected, 6);
    }
  });
});

describe('Tonemapping — Reinhard', () => {
  it('x/(x+1) at x=1 → 0.5', () => {
    expect(reinhardScalar(1)).toBeCloseTo(0.5, 6);
  });

  it('x/(x+1) at x=0 → 0', () => {
    expect(reinhardScalar(0)).toBeCloseTo(0, 6);
  });

  it('approaches 1 asymptotically', () => {
    expect(reinhardScalar(1000)).toBeCloseTo(0.999, 2);
  });

  it('ReinhardExtended maps white point to 1', () => {
    const Lw = 4.0;
    // 在 x = Lw(白点)时,输出应 = 1
    // f(Lw) = (Lw*(1+Lw/Lw²))/(1+Lw) = (Lw*(1+1/Lw))/(1+Lw) = (Lw+1)/(1+Lw) = 1
    expect(reinhardExtendedScalar(Lw, Lw)).toBeCloseTo(1.0, 6);
  });

  it('ReinhardExtended at 0 → 0', () => {
    expect(reinhardExtendedScalar(0, 11.2)).toBeCloseTo(0, 6);
  });
});

describe('Tonemapping — Hable Filmic', () => {
  it('hableCurve(0) = -E/F', () => {
    // f(0) = (D*E)/(D*F) - E/F = E/F - E/F = 0
    expect(hableCurve(0)).toBeCloseTo(0, 6);
  });

  it('filmicScalar clamps to [0,1]', () => {
    expect(filmicScalar(0)).toBeGreaterThanOrEqual(0);
    expect(filmicScalar(100)).toBeLessThanOrEqual(1);
  });

  it('filmicScalar at 0 → 0', () => {
    expect(filmicScalar(0)).toBeCloseTo(0, 5);
  });

  it('filmicScalar normalizes white at exposureBias', () => {
    // 在 x=1, exposureBias=2 时,白点归一化使 f(1) 接近 1(不精确,因 Hable 白点定义)
    const v = filmicScalar(1, 2.0);
    expect(v).toBeGreaterThan(0.7);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('Tonemapping — applyTonemapping', () => {
  const hdr: RGBColor = { r: 2.0, g: 0.5, b: 0.0 };

  it('Linear mode clamps to [0,1]', () => {
    const out = applyTonemapping(hdr, 'Linear');
    expect(out.r).toBe(1); // 2 → clamped
    expect(out.g).toBe(0.5);
    expect(out.b).toBe(0);
  });

  it('ACESFilmic produces values matching scalar per channel', () => {
    const out = applyTonemapping(hdr, 'ACESFilmic');
    expect(out.r).toBeCloseTo(acesFilmicScalar(2.0), 6);
    expect(out.g).toBeCloseTo(acesFilmicScalar(0.5), 6);
    expect(out.b).toBeCloseTo(acesFilmicScalar(0.0), 6);
  });

  it('Reinhard produces x/(x+1) per channel', () => {
    const out = applyTonemapping(hdr, 'Reinhard');
    expect(out.r).toBeCloseTo(2 / 3, 6);
    expect(out.g).toBeCloseTo(0.5 / 1.5, 6);
    expect(out.b).toBeCloseTo(0, 6);
  });

  it('all modes produce output in [0,1] for HDR input', () => {
    const modes: TonemappingOperator[] = [
      'Linear',
      'Reinhard',
      'ReinhardExtended',
      'ACESFilmic',
      'Filmic',
    ];
    const bigHDR = { r: 50, g: 30, b: 10 };
    for (const m of modes) {
      const out = applyTonemapping(bigHDR, m);
      for (const c of [out.r, out.g, out.b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('unknown mode falls back to Linear clamp', () => {
    const out = applyTonemapping({ r: 5, g: 0, b: 0 }, 'Nonsense' as TonemappingOperator);
    expect(out.r).toBe(1);
  });
});

describe('Tonemapping — sRGB transfer', () => {
  it('linearToSRGB(0)=0, linearToSRGB(1)=1', () => {
    expect(linearToSRGB(0)).toBeCloseTo(0, 6);
    expect(linearToSRGB(1)).toBeCloseTo(1, 6);
  });

  it('sRGBToLinear(0)=0, sRGBToLinear(1)=1', () => {
    expect(sRGBToLinear(0)).toBeCloseTo(0, 6);
    expect(sRGBToLinear(1)).toBeCloseTo(1, 6);
  });

  it('uses linear segment for small values (<= 0.0031308)', () => {
    expect(linearToSRGB(0.001)).toBeCloseTo(12.92 * 0.001, 6);
  });

  it('uses power segment for larger values', () => {
    // x=0.5: 1.055*0.5^(1/2.4) - 0.055
    const expected = 1.055 * Math.pow(0.5, 1 / 2.4) - 0.055;
    expect(linearToSRGB(0.5)).toBeCloseTo(expected, 6);
  });

  it('sRGBToLinear uses linear segment for small values (<= 0.04045)', () => {
    expect(sRGBToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 6);
  });

  it('linear ↔ sRGB round-trips for a range of values', () => {
    for (let i = 0; i <= 20; i++) {
      const x = i / 20;
      const rt = sRGBToLinear(linearToSRGB(x));
      expect(rt).toBeCloseTo(x, 5);
    }
  });

  it('γ2.2 approximation round-trips', () => {
    const x = 0.7;
    expect(sRGBGammaToLinear(linearToSRGBGamma(x))).toBeCloseTo(x, 5);
  });

  it('color variants apply per-channel', () => {
    const out = linearToSRGBColor({ r: 0.5, g: 0.0, b: 1.0 });
    expect(out.r).toBeCloseTo(linearToSRGB(0.5), 6);
    expect(out.g).toBeCloseTo(0, 6);
    expect(out.b).toBeCloseTo(1, 6);
    const back = sRGBToLinearColor(out);
    expect(back.r).toBeCloseTo(0.5, 5);
  });
});

describe('Tonemapping — ACEScg', () => {
  it('neutral gray (equal channels) stays near-equal after transform', () => {
    const gray = { r: 0.18, g: 0.18, b: 0.18 };
    const aces = linearSRGBToACEScg(gray);
    // 等通道路径:各通道应近似相等(矩阵行和 ≈ 1,等输入 → 等输出)
    expect(aces.r).toBeCloseTo(0.18 * 1.0, 1); // 行和 = 0.6131+0.3395+0.0474 = 1.0
    expect(aces.g).toBeCloseTo(0.18 * 1.0, 1); // 0.0709+0.9164+0.0128 = 1.0001
    expect(aces.b).toBeCloseTo(0.18 * 1.0, 1); // 0.0201+0.1094+0.8706 = 1.0001
  });

  it('round-trips sRGB-linear ↔ ACEScg', () => {
    const c = { r: 0.7, g: 0.2, b: 0.4 };
    const aces = linearSRGBToACEScg(c);
    const back = acescgToLinearSRGB(aces);
    expect(back.r).toBeCloseTo(c.r, 3);
    expect(back.g).toBeCloseTo(c.g, 3);
    expect(back.b).toBeCloseTo(c.b, 3);
  });

  it('preserves black', () => {
    const black = { r: 0, g: 0, b: 0 };
    expect(linearSRGBToACEScg(black)).toEqual(black);
    expect(acescgToLinearSRGB(black)).toEqual(black);
  });
});

describe('Tonemapping — exposure & luminance', () => {
  it('applyExposure +1 stop doubles values', () => {
    const out = applyExposure({ r: 0.25, g: 0.5, b: 1.0 }, 1);
    expect(out.r).toBeCloseTo(0.5, 6);
    expect(out.g).toBeCloseTo(1.0, 6);
    expect(out.b).toBeCloseTo(2.0, 6);
  });

  it('applyExposure -2 stops quarters values', () => {
    const out = applyExposure({ r: 1.0, g: 1.0, b: 1.0 }, -2);
    expect(out.r).toBeCloseTo(0.25, 6);
  });

  it('applyExposure 0 stops is identity', () => {
    const c = { r: 0.3, g: 0.6, b: 0.9 };
    expect(applyExposure(c, 0)).toEqual(c);
  });

  it('luminance uses Rec.709 weights by default', () => {
    // 纯绿 → 0.7152
    expect(luminance({ r: 0, g: 1, b: 0 })).toBeCloseTo(0.7152, 6);
    // 纯红 → 0.2126
    expect(luminance({ r: 1, g: 0, b: 0 })).toBeCloseTo(0.2126, 6);
    // 纯蓝 → 0.0722
    expect(luminance({ r: 0, g: 0, b: 1 })).toBeCloseTo(0.0722, 6);
  });

  it('luminance accepts custom weights', () => {
    expect(luminance({ r: 1, g: 1, b: 1 }, { r: 0.33, g: 0.33, b: 0.34 })).toBeCloseTo(1.0, 2);
  });

  it('white luminance = 1', () => {
    expect(luminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1.0, 6);
  });
});

describe('Tonemapping — middleGrayOutput', () => {
  it('returns tonemapped 18% gray r channel', () => {
    expect(middleGrayOutput('ACESFilmic')).toBeCloseTo(acesFilmicScalar(0.18), 6);
    expect(middleGrayOutput('Reinhard')).toBeCloseTo(reinhardScalar(0.18), 6);
  });

  it('middle gray is lifted above input by ACES (0.18 → ≈ 0.267)', () => {
    // Narkowicz ACES 把 18% 灰提亮到 ≈ 0.267(提升中灰,但未到 0.36;
    // 0.36 是带额外曝光偏置的完整 ACES 管线数值,本算子为裸算子)。
    const v = middleGrayOutput('ACESFilmic');
    expect(v).toBeGreaterThan(0.18); // 提亮:输出 > 输入
    expect(v).toBeLessThan(0.5);
    expect(v).toBeCloseTo(0.2669, 2); // 实际数值
  });
});

describe('Tonemapping — ColorManagement', () => {
  it('defaults: enabled, sRGB-linear working space', () => {
    // 重置静态状态(测试隔离)
    ColorManagement.setEnabled(true);
    ColorManagement.setWorkingSpace('sRGB-linear');
    expect(ColorManagement.enabled).toBe(true);
    expect(ColorManagement.workingSpace).toBe('sRGB-linear');
  });

  it('fromSRGB converts display sRGB to linear when enabled', () => {
    ColorManagement.setEnabled(true);
    ColorManagement.setWorkingSpace('sRGB-linear');
    // sRGB 0.5 → linear ≈ 0.21404
    const out = ColorManagement.fromSRGB({ r: 0.5, g: 0.5, b: 0.5 });
    expect(out.r).toBeCloseTo(sRGBToLinear(0.5), 6);
  });

  it('toSRGB converts linear to display sRGB when enabled', () => {
    ColorManagement.setEnabled(true);
    ColorManagement.setWorkingSpace('sRGB-linear');
    const out = ColorManagement.toSRGB({ r: 0.214, g: 0.214, b: 0.214 });
    expect(out.r).toBeCloseTo(linearToSRGB(0.214), 4);
  });

  it('fromSRGB → toSRGB round-trips in sRGB-linear space', () => {
    ColorManagement.setEnabled(true);
    ColorManagement.setWorkingSpace('sRGB-linear');
    const display = { r: 0.3, g: 0.6, b: 0.9 };
    const back = ColorManagement.toSRGB(ColorManagement.fromSRGB(display));
    expect(back.r).toBeCloseTo(display.r, 4);
    expect(back.g).toBeCloseTo(display.g, 4);
    expect(back.b).toBeCloseTo(display.b, 4);
  });

  it('disabled: fromSRGB/toSRGB are identity', () => {
    ColorManagement.setEnabled(false);
    ColorManagement.setWorkingSpace('sRGB-linear');
    const c = { r: 0.5, g: 0.5, b: 0.5 };
    expect(ColorManagement.fromSRGB(c)).toEqual(c);
    expect(ColorManagement.toSRGB(c)).toEqual(c);
    ColorManagement.setEnabled(true); // 恢复
  });

  it('ACEScg working space: fromSRGB → toSRGB round-trips', () => {
    ColorManagement.setEnabled(true);
    ColorManagement.setWorkingSpace('ACEScg');
    const display = { r: 0.4, g: 0.2, b: 0.8 };
    const back = ColorManagement.toSRGB(ColorManagement.fromSRGB(display));
    expect(back.r).toBeCloseTo(display.r, 2);
    expect(back.g).toBeCloseTo(display.g, 2);
    expect(back.b).toBeCloseTo(display.b, 2);
    ColorManagement.setWorkingSpace('sRGB-linear'); // 恢复默认
  });
});

describe('Tonemapping — operator consistency', () => {
  it('ACES saturates to 1.0 at finite HDR while Reinhard asymptotes', () => {
    // Narkowicz ACES 在 x≈6+ 即钳位到 1.0(有界硬肩),
    // Reinhard x/(x+1) 只渐近趋近 1。故 x=10 时 ACES 已饱和到 1.0,
    // Reinhard 仍 < 1(≈ 0.909)。注:这是 Narkowicz 近似的特性,
    // 它整体提亮曲线,并非在高光处比 Reinhard 更暗。
    expect(acesFilmicScalar(10)).toBe(1); // 已饱和
    expect(reinhardScalar(10)).toBeLessThan(1); // 仍渐近趋近
    expect(reinhardScalar(10)).toBeCloseTo(10 / 11, 5);
  });

  it('middle gray: ACES > Reinhard (ACES 提亮中灰)', () => {
    // 0.18: ACES ≈ 0.267, Reinhard ≈ 0.153 → ACES 中灰更亮
    expect(acesFilmicScalar(0.18)).toBeGreaterThan(reinhardScalar(0.18));
  });
});
