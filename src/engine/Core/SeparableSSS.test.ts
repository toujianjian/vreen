// SeparableSSS 单元测试 (可分离屏幕空间次表面散射核)。
//
// 覆盖:
//   1. 核生成 — 默认采样数 / 全核大小
//   2. 核生成 — 自定义参数 + 钳位
//   3. 核生成 — 中心 offset = 0
//   4. 核生成 — offset 随索引递增(半核)
//   5. 归一化 — 每通道全对称核和 = 1(能量守恒)
//   6. 红核方差 > 绿 > 蓝(红弥散更远)
//   7. sampleSSSProfile — 距离 0 = 颜色权之和
//   8. sampleSSSProfile — 单调递减
//   9. sampleSSSProfile — 红长程衰减慢于蓝(红移)
//  10. convolve1D — 常数输入 → 常数输出(内部能量守恒)
//  11. convolve1D — delta 响应 = 核权重
//  12. convolve2DSeparable — 常数图像 → 常数输出(内部)
//  13. convolve2DSeparable — delta 响应 ≈ 2D 可分离核
//  14. kernelToUniforms — 数组长度 + 数值一致
//  15. 自定义 profile 生效

import { describe, it, expect } from 'vitest';
import {
  generateSeparableSSSKernel,
  sampleSSSProfile,
  convolve1D,
  convolve2DSeparable,
  kernelVariance,
  kernelToUniforms,
  SKIN_PROFILE_JIMENEZ,
} from './SeparableSSS';

// ── 核生成基础 ──────────────────────────────────────────────────────

describe('generateSeparableSSSKernel basics', () => {
  it('default samples = 11 (half), full = 21', () => {
    const k = generateSeparableSSSKernel();
    expect(k.halfSize).toBe(11);
    expect(k.fullSize).toBe(21);
    expect(k.samples.length).toBe(11);
    expect(k.strength).toBe(1.0);
  });

  it('custom samples + strength', () => {
    const k = generateSeparableSSSKernel({ samples: 6, strength: 2.5 });
    expect(k.halfSize).toBe(6);
    expect(k.fullSize).toBe(11);
    expect(k.strength).toBe(2.5);
  });

  it('samples clamped to >= 1', () => {
    const k = generateSeparableSSSKernel({ samples: 0 });
    expect(k.halfSize).toBe(1);
    expect(k.fullSize).toBe(1);
  });

  it('center offset = 0', () => {
    const k = generateSeparableSSSKernel();
    expect(k.samples[0].offset).toBe(0);
  });

  it('half-kernel offsets non-decreasing', () => {
    const k = generateSeparableSSSKernel({ samples: 11 });
    for (let i = 1; i < k.samples.length; i++) {
      expect(k.samples[i].offset).toBeGreaterThanOrEqual(k.samples[i - 1].offset);
    }
  });

  it('strength scales offsets', () => {
    const k1 = generateSeparableSSSKernel({ samples: 6, strength: 1.0 });
    const k2 = generateSeparableSSSKernel({ samples: 6, strength: 3.0 });
    for (let i = 0; i < k1.samples.length; i++) {
      expect(k2.samples[i].offset).toBeCloseTo(k1.samples[i].offset * 3, 5);
    }
  });
});

// ── 归一化(能量守恒)──────────────────────────────────────────────

describe('SeparableSSS normalization', () => {
  it('full symmetric sum = 1 per channel (energy conservation)', () => {
    const k = generateSeparableSSSKernel({ samples: 11 });
    let sumR = k.samples[0].weight.r;
    let sumG = k.samples[0].weight.g;
    let sumB = k.samples[0].weight.b;
    for (let i = 1; i < k.samples.length; i++) {
      sumR += 2 * k.samples[i].weight.r;
      sumG += 2 * k.samples[i].weight.g;
      sumB += 2 * k.samples[i].weight.b;
    }
    expect(sumR).toBeCloseTo(1.0, 5);
    expect(sumG).toBeCloseTo(1.0, 5);
    expect(sumB).toBeCloseTo(1.0, 5);
  });

  it('weights are non-negative', () => {
    const k = generateSeparableSSSKernel({ samples: 11 });
    for (const s of k.samples) {
      expect(s.weight.r).toBeGreaterThanOrEqual(0);
      expect(s.weight.g).toBeGreaterThanOrEqual(0);
      expect(s.weight.b).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── 红移(红弥散更远)─────────────────────────────────────────────

describe('SeparableSSS red-shift', () => {
  it('kernel variance: red > green > blue', () => {
    const k = generateSeparableSSSKernel({ samples: 11, strength: 1.0 });
    const v = kernelVariance(k);
    expect(v.r).toBeGreaterThan(v.g);
    expect(v.g).toBeGreaterThan(v.b);
  });

  it('red tail weight > blue tail weight at far offset', () => {
    const k = generateSeparableSSSKernel({ samples: 11 });
    const last = k.samples[k.samples.length - 1];
    expect(last.weight.r).toBeGreaterThan(last.weight.b);
  });
});

// ── sampleSSSProfile ───────────────────────────────────────────────

describe('sampleSSSProfile', () => {
  it('distance 0 = sum of color weights per channel', () => {
    const p = sampleSSSProfile(SKIN_PROFILE_JIMENEZ, 0);
    let expR = 0;
    let expG = 0;
    let expB = 0;
    for (const c of SKIN_PROFILE_JIMENEZ) {
      expR += c.color.r;
      expG += c.color.g;
      expB += c.color.b;
    }
    expect(p.r).toBeCloseTo(expR, 6);
    expect(p.g).toBeCloseTo(expG, 6);
    expect(p.b).toBeCloseTo(expB, 6);
  });

  it('monotonically decreasing with distance', () => {
    let prev = sampleSSSProfile(SKIN_PROFILE_JIMENEZ, 0);
    for (let i = 1; i <= 20; i++) {
      const cur = sampleSSSProfile(SKIN_PROFILE_JIMENEZ, i * 0.1);
      expect(cur.r).toBeLessThanOrEqual(prev.r + 1e-12);
      expect(cur.g).toBeLessThanOrEqual(prev.g + 1e-12);
      expect(cur.b).toBeLessThanOrEqual(prev.b + 1e-12);
      prev = cur;
    }
  });

  it('red decays slower than blue (long-range red-shift)', () => {
    const near = sampleSSSProfile(SKIN_PROFILE_JIMENEZ, 0.05);
    const far = sampleSSSProfile(SKIN_PROFILE_JIMENEZ, 1.5);
    expect(far.r / near.r).toBeGreaterThan(far.b / near.b);
  });
});

// ── convolve1D ─────────────────────────────────────────────────────

describe('convolve1D', () => {
  it('constant input → constant output (interior energy preservation)', () => {
    // 红核:常数 R 输入 → 内部像素仍为该常数(归一化保证)
    const k = generateSeparableSSSKernel({ samples: 6, strength: 1.0 });
    const width = 64;
    const row = new Float32Array(width * 4);
    for (let i = 0; i < width; i++) {
      row[i * 4] = 0.8; // R
      row[i * 4 + 1] = 0.5; // G
      row[i * 4 + 2] = 0.3; // B
      row[i * 4 + 3] = 1.0; // A
    }
    const out = convolve1D(row, width, k);
    // 内部像素(核完全容纳):值不变
    for (let x = 10; x < width - 10; x++) {
      expect(out[x * 4]).toBeCloseTo(0.8, 5);
      expect(out[x * 4 + 1]).toBeCloseTo(0.5, 5);
      expect(out[x * 4 + 2]).toBeCloseTo(0.3, 5);
      expect(out[x * 4 + 3]).toBeCloseTo(1.0, 5);
    }
  });

  it('delta response = kernel weights', () => {
    // 中心一个亮像素,其余 0 → 输出 = 核权重(对称)
    const k = generateSeparableSSSKernel({ samples: 6, strength: 1.0 });
    const width = 64;
    const row = new Float32Array(width * 4);
    const center = 32;
    row[center * 4] = 1.0;
    row[center * 4 + 1] = 1.0;
    row[center * 4 + 2] = 1.0;
    row[center * 4 + 3] = 1.0;
    const out = convolve1D(row, width, k);
    // 中心
    expect(out[center * 4]).toBeCloseTo(k.samples[0].weight.r, 5);
    // 偏移 i(在核范围内)
    for (let i = 1; i < k.samples.length; i++) {
      expect(out[(center + i) * 4]).toBeCloseTo(k.samples[i].weight.r, 5);
      expect(out[(center - i) * 4]).toBeCloseTo(k.samples[i].weight.r, 5);
    }
  });

  it('alpha is passed through', () => {
    const k = generateSeparableSSSKernel({ samples: 4 });
    const width = 32;
    const row = new Float32Array(width * 4);
    for (let i = 0; i < width; i++) row[i * 4 + 3] = 0.7;
    const out = convolve1D(row, width, k);
    for (let x = 0; x < width; x++) {
      expect(out[x * 4 + 3]).toBeCloseTo(0.7, 5);
    }
  });
});

// ── convolve2DSeparable ────────────────────────────────────────────

describe('convolve2DSeparable', () => {
  it('constant image → constant output (interior)', () => {
    const k = generateSeparableSSSKernel({ samples: 5, strength: 1.0 });
    const w = 32;
    const h = 32;
    const img = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      img[i * 4] = 0.6;
      img[i * 4 + 1] = 0.4;
      img[i * 4 + 2] = 0.2;
      img[i * 4 + 3] = 1.0;
    }
    const out = convolve2DSeparable(img, w, h, k);
    // 内部像素(两趟核均完全容纳):值不变
    for (let y = 8; y < h - 8; y++) {
      for (let x = 8; x < w - 8; x++) {
        const idx = (y * w + x) * 4;
        expect(out[idx]).toBeCloseTo(0.6, 5);
        expect(out[idx + 1]).toBeCloseTo(0.4, 5);
        expect(out[idx + 2]).toBeCloseTo(0.2, 5);
      }
    }
  });

  it('delta response: center ≈ center weight (2D separable)', () => {
    // 单点亮像素 → 中心输出 = w0_r * w0_r(两趟中心权重相乘)
    const k = generateSeparableSSSKernel({ samples: 5, strength: 1.0 });
    const w = 32;
    const h = 32;
    const img = new Float32Array(w * h * 4);
    const cx = 16;
    const cy = 16;
    img[(cy * w + cx) * 4] = 1.0;
    img[(cy * w + cx) * 4 + 1] = 1.0;
    img[(cy * w + cx) * 4 + 2] = 1.0;
    img[(cy * w + cx) * 4 + 3] = 1.0;
    const out = convolve2DSeparable(img, w, h, k);
    const idx = (cy * w + cx) * 4;
    // 2D 可分离:中心 = w0.r(水平中心)× w0.r(垂直中心)
    expect(out[idx]).toBeCloseTo(k.samples[0].weight.r * k.samples[0].weight.r, 5);
  });

  it('red spreads wider than blue (delta response ratio)', () => {
    // 单点白像素,在偏移处:红响应 > 蓝响应(红弥散更远)
    const k = generateSeparableSSSKernel({ samples: 8, strength: 1.0 });
    const w = 48;
    const h = 48;
    const img = new Float32Array(w * h * 4);
    const cx = 24;
    const cy = 24;
    img[(cy * w + cx) * 4] = 1.0;
    img[(cy * w + cx) * 4 + 1] = 1.0;
    img[(cy * w + cx) * 4 + 2] = 1.0;
    img[(cy * w + cx) * 4 + 3] = 1.0;
    const out = convolve2DSeparable(img, w, h, k);
    // 取离中心几像素处的响应:红 > 蓝
    const offIdx = (cy * w + (cx + 4)) * 4;
    expect(out[offIdx]).toBeGreaterThan(out[offIdx + 2]); // R > B
  });
});

// ── kernelToUniforms ───────────────────────────────────────────────

describe('kernelToUniforms', () => {
  it('array lengths = halfSize, values match', () => {
    const k = generateSeparableSSSKernel({ samples: 7 });
    const u = kernelToUniforms(k);
    expect(u.offsets.length).toBe(7);
    expect(u.weightsR.length).toBe(7);
    expect(u.weightsG.length).toBe(7);
    expect(u.weightsB.length).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(u.offsets[i]).toBeCloseTo(k.samples[i].offset, 6);
      expect(u.weightsR[i]).toBeCloseTo(k.samples[i].weight.r, 6);
      expect(u.weightsG[i]).toBeCloseTo(k.samples[i].weight.g, 6);
      expect(u.weightsB[i]).toBeCloseTo(k.samples[i].weight.b, 6);
    }
  });
});

// ── 自定义 profile ─────────────────────────────────────────────────

describe('custom profile', () => {
  it('single-Gaussian profile produces analytic Gaussian kernel', () => {
    // 单高斯剖面:sigma=2, color=(1,1,1) → 核 = 高斯,按通道归一化
    const sigma = 2.0;
    const k = generateSeparableSSSKernel({
      samples: 11,
      strength: 1.0,
      profile: [{ sigma, color: { r: 1, g: 1, b: 1 } }],
      spread: 3 * sigma,
    });
    // 半核第 i 个采样点距离 d_i = (i/(10)) * 6
    // 权重(归一化前)= exp(-d²/(2σ²));归一化后按通道相同
    // 验证:三通道权重相等(因 color 相同)
    for (const s of k.samples) {
      expect(s.weight.r).toBeCloseTo(s.weight.g, 6);
      expect(s.weight.g).toBeCloseTo(s.weight.b, 6);
    }
    // 验证形状:中心最大,向外递减
    expect(k.samples[0].weight.r).toBeGreaterThan(k.samples[1].weight.r);
    expect(k.samples[1].weight.r).toBeGreaterThan(k.samples[k.samples.length - 1].weight.r);
  });
});
