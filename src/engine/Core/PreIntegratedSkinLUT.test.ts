// PreIntegratedSkinLUT 单元测试 (预积分皮肤着色 LUT)。
//
// 覆盖:
//   1. 生成 — 默认尺寸 + 数据长度
//   2. 生成 — 自定义尺寸 + 钳位
//   3. 生成 — 值域 [0,1]
//   4. 生成 — 确定性(相同参数 = 相同结果)
//   5. 生成 — 平面行(V=0,曲率 0)≈ Lambert max(N·L,0)
//   6. 生成 — 全亮(N·L=1)≈ 1.0(归一化保证)
//   7. 生成 — 暗侧(N·L<0)平面行 ≈ 0
//   8. 散射剖面 — 距离 0 时各通道为高斯权之和
//   9. 散射剖面 — 红通道长程衰减慢于蓝通道(红移)
//  10. 散射剖面 — 单调递减(距离↑ → 值↓)
//  11. 曲率红移 — terminator(N·L≈0)处红 > 绿 > 蓝
//  12. 曲率单调 — 高曲率行在 terminator 处散射强于低曲率行
//  13. 采样器 — 双线性往返(texel 中心精确还原)
//  14. 采样器 — 钳位 N·L / curvature
//  15. curvatureFromRadius — 倒数关系

import { describe, it, expect } from 'vitest';
import {
  generatePreIntegratedSkinLUT,
  samplePreIntegratedSkinLUT,
  skinScatterProfile,
  curvatureFromRadius,
} from './PreIntegratedSkinLUT';

// ── 生成基础 ────────────────────────────────────────────────────────

describe('PreIntegratedSkinLUT.generate basics', () => {
  it('default size = 256x256, RGB Float32', () => {
    const lut = generatePreIntegratedSkinLUT();
    expect(lut.width).toBe(256);
    expect(lut.height).toBe(256);
    expect(lut.data.length).toBe(256 * 256 * 3);
    expect(lut.data).toBeInstanceOf(Float32Array);
    expect(lut.maxCurvature).toBe(2.0);
  });

  it('custom size + maxCurvature', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 32, height: 16, maxCurvature: 4.0 });
    expect(lut.width).toBe(32);
    expect(lut.height).toBe(16);
    expect(lut.data.length).toBe(32 * 16 * 3);
    expect(lut.maxCurvature).toBe(4.0);
  });

  it('size clamped to >= 1', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 0, height: -5 });
    expect(lut.width).toBe(1);
    expect(lut.height).toBe(1);
  });

  it('all values in [0,1]', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 64, height: 64 });
    for (let i = 0; i < lut.data.length; i++) {
      expect(lut.data[i]).toBeGreaterThanOrEqual(0);
      expect(lut.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('deterministic — same opts = same data', () => {
    const a = generatePreIntegratedSkinLUT({ width: 48, height: 48, samples: 32 });
    const b = generatePreIntegratedSkinLUT({ width: 48, height: 48, samples: 32 });
    expect(a.data.length).toBe(b.data.length);
    for (let i = 0; i < a.data.length; i++) {
      expect(a.data[i]).toBe(b.data[i]);
    }
  });
});

// ── 平面退化(Lambert)─────────────────────────────────────────────

describe('PreIntegratedSkinLUT flat-surface degeneration', () => {
  it('top row (V=0, curvature 0) ≈ max(N·L, 0) Lambert', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 64, height: 64 });
    const y = 0; // V=0 → curvature 0 → 平面
    for (let x = 0; x < lut.width; x++) {
      const u = x / (lut.width - 1);
      const NdotL = 2 * u - 1;
      const expected = Math.max(NdotL, 0);
      const idx = (y * lut.width + x) * 3;
      expect(lut.data[idx]).toBeCloseTo(expected, 1); // R
      expect(lut.data[idx + 1]).toBeCloseTo(expected, 1); // G
      expect(lut.data[idx + 2]).toBeCloseTo(expected, 1); // B
    }
  });

  it('full-lit (N·L=1): flat row ≈ 1.0; curved rows < 1 (arc-averaged cos) but row-maximum', () => {
    // 物理:平面 N·L=1 → 恰好 1.0(仅 s=0 贡献,cos=1);
    // 曲面 N·L=1 → 散射核在弧上对 cos 取加权平均 < 1(邻域点 cos(φ)<1),
    // 但仍是该行最亮值(单调性)。
    const lut = generatePreIntegratedSkinLUT({ width: 64, height: 64 });
    const x = lut.width - 1; // U=1 → N·L=+1
    // 平面行恰好 1.0
    const flatIdx = (0 * lut.width + x) * 3;
    expect(lut.data[flatIdx]).toBeCloseTo(1.0, 2);
    expect(lut.data[flatIdx + 1]).toBeCloseTo(1.0, 2);
    expect(lut.data[flatIdx + 2]).toBeCloseTo(1.0, 2);
    // 每行:N·L=1 是该行最大值(最亮)
    for (let y = 0; y < lut.height; y++) {
      const fullLitR = lut.data[(y * lut.width + x) * 3];
      for (let xx = 0; xx < lut.width; xx++) {
        const val = lut.data[(y * lut.width + xx) * 3];
        expect(fullLitR).toBeGreaterThanOrEqual(val - 1e-6);
      }
    }
  });

  it('dark side (N·L<0) flat row ≈ 0', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 64, height: 64 });
    const y = 0;
    for (let x = 0; x < lut.width / 2; x++) {
      const idx = (y * lut.width + x) * 3;
      expect(lut.data[idx]).toBeCloseTo(0, 2);
      expect(lut.data[idx + 1]).toBeCloseTo(0, 2);
      expect(lut.data[idx + 2]).toBeCloseTo(0, 2);
    }
  });
});

// ── 散射剖面 ────────────────────────────────────────────────────────

describe('skinScatterProfile (d\'Eon 2007)', () => {
  it('distance 0 = sum of weights per channel', () => {
    const p = skinScatterProfile(0);
    // R: 0.028+0.238+0.448+0.698
    expect(p.r).toBeCloseTo(0.028 + 0.238 + 0.448 + 0.698, 5);
    // G: 0.449+0.367+0.184
    expect(p.g).toBeCloseTo(0.449 + 0.367 + 0.184, 5);
    // B: 0.549+0.318+0.133
    expect(p.b).toBeCloseTo(0.549 + 0.318 + 0.133, 5);
  });

  it('red decays slower than blue (long-range tail)', () => {
    // 在长距离(2mm)处,红应显著大于蓝(红有 v=0.842 长程项)
    const near = skinScatterProfile(0.1);
    const far = skinScatterProfile(2.0);
    const redRatio = far.r / near.r;
    const blueRatio = far.b / near.b;
    expect(redRatio).toBeGreaterThan(blueRatio);
  });

  it('monotonically decreasing with distance', () => {
    let prev = skinScatterProfile(0);
    for (let i = 1; i <= 30; i++) {
      const cur = skinScatterProfile(i * 0.2);
      expect(cur.r).toBeLessThanOrEqual(prev.r + 1e-12);
      expect(cur.g).toBeLessThanOrEqual(prev.g + 1e-12);
      expect(cur.b).toBeLessThanOrEqual(prev.b + 1e-12);
      prev = cur;
    }
  });

  it('red > green > blue at long range (red-shift)', () => {
    const p = skinScatterProfile(1.5);
    expect(p.r).toBeGreaterThan(p.g);
    expect(p.g).toBeGreaterThan(p.b);
  });
});

// ── 曲率效应 ────────────────────────────────────────────────────────

describe('PreIntegratedSkinLUT curvature effects', () => {
  it('terminator (N·L≈0) high-curvature row: red > green > blue (red-shift)', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 128, height: 128, maxCurvature: 2.0 });
    // N·L ≈ 0 → 中间列
    const x = Math.floor((lut.width - 1) / 2);
    // 高曲率 → 底部行
    const y = lut.height - 1;
    const idx = (y * lut.width + x) * 3;
    const r = lut.data[idx];
    const g = lut.data[idx + 1];
    const b = lut.data[idx + 2];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('higher curvature scatters more into terminator than lower', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 128, height: 128, maxCurvature: 2.0 });
    const x = Math.floor((lut.width - 1) / 2); // N·L ≈ 0
    // 红通道:底部(高曲率)应 > 顶部(平面,≈0)
    const topR = lut.data[(0 * lut.width + x) * 3];
    const botR = lut.data[((lut.height - 1) * lut.width + x) * 3];
    expect(botR).toBeGreaterThan(topR);
  });

  it('curvature increases red bleed beyond flat Lambert at terminator', () => {
    // 平面 terminator 处 ≈ 0;高曲率处红通道明显 > 0
    const lut = generatePreIntegratedSkinLUT({ width: 128, height: 128 });
    const x = Math.floor((lut.width - 1) / 2);
    const flat = lut.data[(0 * lut.width + x) * 3];
    const curved = lut.data[((lut.height - 1) * lut.width + x) * 3];
    expect(flat).toBeCloseTo(0, 1);
    expect(curved).toBeGreaterThan(0.02);
  });
});

// ── 采样器 ──────────────────────────────────────────────────────────

describe('samplePreIntegratedSkinLUT', () => {
  it('returns texel-node values exactly (edge-aligned convention)', () => {
    // 生成器/采样器使用 edge-aligned 约定:texel i 位于 u = i/(width-1)。
    // 故要精确命中 texel (x,y),取 NdotL = 2*x/(width-1) - 1,
    // curvature = y/(height-1) * maxCurvature → fx=x, fy=y, tx=ty=0。
    const lut = generatePreIntegratedSkinLUT({ width: 16, height: 16 });
    const x = 5;
    const y = 7;
    const NdotL = (2 * x) / (lut.width - 1) - 1;
    const curvature = (y / (lut.height - 1)) * lut.maxCurvature;
    const s = samplePreIntegratedSkinLUT(lut, NdotL, curvature);
    const idx = (y * lut.width + x) * 3;
    expect(s.r).toBeCloseTo(lut.data[idx], 5);
    expect(s.g).toBeCloseTo(lut.data[idx + 1], 5);
    expect(s.b).toBeCloseTo(lut.data[idx + 2], 5);
  });

  it('clamps N·L to [-1,1] and curvature to [0, maxCurvature]', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 32, height: 32 });
    // N·L 远超 1 → 等价于 N·L=1(右边界列中心近似)
    const over = samplePreIntegratedSkinLUT(lut, 50, 0);
    const right = samplePreIntegratedSkinLUT(lut, 1, 0);
    expect(over.r).toBeCloseTo(right.r, 2);
    // curvature 超过 max → 等价于 max(底行)
    const overC = samplePreIntegratedSkinLUT(lut, 0, 999);
    const maxC = samplePreIntegratedSkinLUT(lut, 0, lut.maxCurvature);
    expect(overC.r).toBeCloseTo(maxC.r, 2);
    // 负 curvature → 等价于 0(顶行)
    const negC = samplePreIntegratedSkinLUT(lut, 0, -5);
    const zeroC = samplePreIntegratedSkinLUT(lut, 0, 0);
    expect(negC.r).toBeCloseTo(zeroC.r, 2);
  });
});

// ── 工具 ────────────────────────────────────────────────────────────

describe('curvatureFromRadius', () => {
  it('returns 1/radius', () => {
    expect(curvatureFromRadius(0.5)).toBeCloseTo(2.0, 6);
    expect(curvatureFromRadius(1.0)).toBeCloseTo(1.0, 6);
    expect(curvatureFromRadius(10.0)).toBeCloseTo(0.1, 6);
  });

  it('returns 0 for non-positive radius', () => {
    expect(curvatureFromRadius(0)).toBe(0);
    expect(curvatureFromRadius(-1)).toBe(0);
  });
});
