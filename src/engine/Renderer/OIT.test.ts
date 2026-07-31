// OIT (Weighted Blended Order-Independent Transparency) 单元测试。
//
// 覆盖:
//   1. 构造默认值 + 选项
//   2. clear 初始化累加器
//   3. addFragment 基本功能
//   4. 权重函数 (深度越大权重越小)
//   5. revealage 累乘
//   6. composite 基本合成
//   7. 顺序无关性 (不同顺序添加相同片元 → 相同结果)
//   8. 边界情况 (越界 / alpha=0 / 无片元)
//   9. resize
//  10. dispose
//  11. 多片元叠加
//  12. 不修改输入场景数据

import { describe, it, expect } from 'vitest';
import { WeightedBlendedOIT } from './OIT';
import type { OITFragment } from './OIT';

/** 生成全黑 RGBA 像素。 */
function blackImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return d;
}

/** 生成全红 RGBA 像素。 */
function redImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255;     // R
    d[i + 1] = 0;   // G
    d[i + 2] = 0;   // B
    d[i + 3] = 255; // A
  }
  return d;
}

/** 获取像素的 RGB 值。 */
function getPixel(d: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number] {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2]];
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('WeightedBlendedOIT construction', () => {
  it('defaults', () => {
    const oit = new WeightedBlendedOIT(10, 10);
    expect(oit.name).toBe('weighted-blended-oit');
    expect(oit.width).toBe(10);
    expect(oit.height).toBe(10);
    expect(oit.weightScale).toBeCloseTo(0.03);
    expect(oit.weightBias).toBeCloseTo(1e-5);
    expect(oit.weightDepthPower).toBeCloseTo(1.0);
    expect(oit.weightMin).toBeCloseTo(0.01);
    expect(oit.weightMax).toBeCloseTo(3000.0);
  });

  it('accepts options', () => {
    const oit = new WeightedBlendedOIT(10, 10, {
      weightScale: 0.1,
      weightBias: 0.001,
      weightDepthPower: 2.0,
      weightMin: 0.5,
      weightMax: 100.0,
    });
    expect(oit.weightScale).toBeCloseTo(0.1);
    expect(oit.weightBias).toBeCloseTo(0.001);
    expect(oit.weightDepthPower).toBeCloseTo(2.0);
    expect(oit.weightMin).toBeCloseTo(0.5);
    expect(oit.weightMax).toBeCloseTo(100.0);
  });

  it('clamps dimensions to >= 1', () => {
    const oit = new WeightedBlendedOIT(0, -5);
    expect(oit.width).toBe(1);
    expect(oit.height).toBe(1);
  });
});

// ── clear ───────────────────────────────────────────────────────────

describe('WeightedBlendedOIT.clear', () => {
  it('initializes revealage to 1.0', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(oit.getRevealage(x, y)).toBe(1.0);
      }
    }
  });

  it('initializes accumulated weight to 0', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(oit.getAccumulatedWeight(x, y)).toBe(0);
      }
    }
  });

  it('resets after adding fragments', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    expect(oit.getRevealage(0, 0)).toBeLessThan(1.0);
    oit.clear();
    expect(oit.getRevealage(0, 0)).toBe(1.0);
    expect(oit.getAccumulatedWeight(0, 0)).toBe(0);
  });

  it('resets fragment count', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    expect(oit.stats.fragmentCount).toBe(1);
    oit.clear();
    expect(oit.stats.fragmentCount).toBe(0);
  });
});

// ── addFragment ─────────────────────────────────────────────────────

describe('WeightedBlendedOIT.addFragment', () => {
  it('reduces revealage', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 2, y: 2, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    // revealage = 1 - 0.5 = 0.5
    expect(oit.getRevealage(2, 2)).toBeCloseTo(0.5);
  });

  it('accumulates revealage multiplicatively', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    oit.addFragment({ x: 0, y: 0, color: [0, 1, 0], alpha: 0.5, depth: 2 });
    // revealage = (1-0.5) * (1-0.5) = 0.25
    expect(oit.getRevealage(0, 0)).toBeCloseTo(0.25);
  });

  it('accumulates weight', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    expect(oit.getAccumulatedWeight(0, 0)).toBeGreaterThan(0);
  });

  it('ignores out-of-bounds fragments', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: -1, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    oit.addFragment({ x: 0, y: -1, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    oit.addFragment({ x: 5, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    oit.addFragment({ x: 0, y: 5, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    expect(oit.stats.fragmentCount).toBe(0);
  });

  it('ignores alpha=0 fragments', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0, depth: 1 });
    expect(oit.stats.fragmentCount).toBe(0);
    expect(oit.getRevealage(0, 0)).toBe(1.0);
  });

  it('ignores negative alpha', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: -0.5, depth: 1 });
    expect(oit.stats.fragmentCount).toBe(0);
  });

  it('increments fragment count', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    oit.addFragment({ x: 1, y: 0, color: [0, 1, 0], alpha: 0.3, depth: 1 });
    expect(oit.stats.fragmentCount).toBe(2);
  });
});

// ── addFragments ────────────────────────────────────────────────────

describe('WeightedBlendedOIT.addFragments', () => {
  it('adds multiple fragments', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    const frags: OITFragment[] = [
      { x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 },
      { x: 1, y: 0, color: [0, 1, 0], alpha: 0.3, depth: 1 },
      { x: 2, y: 0, color: [0, 0, 1], alpha: 0.7, depth: 1 },
    ];
    oit.addFragments(frags);
    expect(oit.stats.fragmentCount).toBe(3);
    expect(oit.getRevealage(0, 0)).toBeCloseTo(0.5);
    expect(oit.getRevealage(1, 0)).toBeCloseTo(0.7);
    expect(oit.getRevealage(2, 0)).toBeCloseTo(0.3);
  });
});

// ── 权重函数 ─────────────────────────────────────────────────────────

describe('WeightedBlendedOIT weight function', () => {
  it('closer fragments have higher weight (more influence)', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    // 近片元 (depth=1) 应比远片元 (depth=100) 权重更大
    oit.clear();
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    const nearWeight = oit.getAccumulatedWeight(0, 0);

    oit.clear();
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 100 });
    const farWeight = oit.getAccumulatedWeight(0, 0);

    expect(nearWeight).toBeGreaterThan(farWeight);
  });

  it('higher alpha → higher weight', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.clear();
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.9, depth: 1 });
    const highAlphaWeight = oit.getAccumulatedWeight(0, 0);

    oit.clear();
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.1, depth: 1 });
    const lowAlphaWeight = oit.getAccumulatedWeight(0, 0);

    expect(highAlphaWeight).toBeGreaterThan(lowAlphaWeight);
  });

  it('weight is clamped to [min, max]', () => {
    // 用极小的 min 和极大的 max 验证 clamp
    const oit = new WeightedBlendedOIT(5, 5, {
      weightMin: 5.0,
      weightMax: 10.0,
      weightScale: 0.0001, // 极小 scale → raw weight 很小 → 应被 clamp 到 min
    });
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 1.0, depth: 1 });
    const weight = oit.getAccumulatedWeight(0, 0);
    // weight = alpha * clamp(...) = 1.0 * 5.0 = 5.0
    expect(weight).toBeCloseTo(5.0);
  });
});

// ── composite ───────────────────────────────────────────────────────

describe('WeightedBlendedOIT.composite', () => {
  it('returns input copy when no fragments', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    const scene = redImage(5, 5);
    const out = oit.composite(scene);
    expect(out).not.toBe(scene);
    // 无透明片元 → 输出 = 输入
    for (let i = 0; i < scene.length; i++) {
      expect(out[i]).toBe(scene[i]);
    }
  });

  it('blends fragment color onto scene', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    const scene = blackImage(5, 5);
    // 添加一个红色半透明片元
    oit.addFragment({ x: 2, y: 2, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    const out = oit.composite(scene);
    const [r, g, b] = getPixel(out, 5, 2, 2);
    // 应有红色分量 (来自透明层)
    expect(r).toBeGreaterThan(0);
    // 绿色和蓝色应接近 0
    expect(g).toBeLessThan(10);
    expect(b).toBeLessThan(10);
  });

  it('does not modify input scene data', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    const scene = blackImage(5, 5);
    const sceneCopy = new Uint8ClampedArray(scene);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    oit.composite(scene);
    for (let i = 0; i < scene.length; i++) {
      expect(scene[i]).toBe(sceneCopy[i]);
    }
  });

  it('fully opaque fragment hides scene', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    const scene = redImage(5, 5);
    // alpha=1 → revealage=0 → 完全覆盖场景
    oit.addFragment({ x: 0, y: 0, color: [0, 1, 0], alpha: 1.0, depth: 1 });
    const out = oit.composite(scene);
    const [r, g, b] = getPixel(out, 5, 0, 0);
    // 应为绿色 (透明层颜色),而非红色 (场景)
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('updates visiblePixels stat', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    oit.addFragment({ x: 1, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    const scene = blackImage(5, 5);
    oit.composite(scene);
    expect(oit.stats.visiblePixels).toBe(2);
  });

  it('updates lastCompositeTimeMs', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    const scene = blackImage(5, 5);
    oit.composite(scene);
    expect(oit.stats.lastCompositeTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ── 顺序无关性 ───────────────────────────────────────────────────────

describe('WeightedBlendedOIT order independence', () => {
  it('produces same result regardless of fragment order', () => {
    const frags: OITFragment[] = [
      { x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 },
      { x: 0, y: 0, color: [0, 1, 0], alpha: 0.3, depth: 2 },
      { x: 0, y: 0, color: [0, 0, 1], alpha: 0.4, depth: 3 },
    ];

    // 正序
    const oit1 = new WeightedBlendedOIT(3, 3);
    oit1.addFragments(frags);
    const out1 = oit1.composite(blackImage(3, 3));

    // 逆序
    const oit2 = new WeightedBlendedOIT(3, 3);
    oit2.addFragments([...frags].reverse());
    const out2 = oit2.composite(blackImage(3, 3));

    // 结果应相同 (顺序无关)
    const p1 = getPixel(out1, 3, 0, 0);
    const p2 = getPixel(out2, 3, 0, 0);
    expect(p2[0]).toBeCloseTo(p1[0], 0);
    expect(p2[1]).toBeCloseTo(p1[1], 0);
    expect(p2[2]).toBeCloseTo(p1[2], 0);
  });

  it('revealage is order-independent', () => {
    const frags: OITFragment[] = [
      { x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 },
      { x: 0, y: 0, color: [0, 1, 0], alpha: 0.3, depth: 2 },
    ];

    const oit1 = new WeightedBlendedOIT(3, 3);
    oit1.addFragments(frags);
    const rev1 = oit1.getRevealage(0, 0);

    const oit2 = new WeightedBlendedOIT(3, 3);
    oit2.addFragments([...frags].reverse());
    const rev2 = oit2.getRevealage(0, 0);

    // revealage = (1-0.5)*(1-0.3) = 0.35 (顺序无关)
    expect(rev1).toBeCloseTo(0.35, 5);
    expect(rev2).toBeCloseTo(0.35, 5);
  });
});

// ── resize ──────────────────────────────────────────────────────────

describe('WeightedBlendedOIT.resize', () => {
  it('changes dimensions', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.resize(10, 8);
    expect(oit.width).toBe(10);
    expect(oit.height).toBe(8);
  });

  it('clears data on resize', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 });
    expect(oit.getRevealage(0, 0)).toBeLessThan(1.0);
    oit.resize(5, 5);
    expect(oit.getRevealage(0, 0)).toBe(1.0);
  });

  it('clamps dimensions to >= 1', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.resize(0, -1);
    expect(oit.width).toBe(1);
    expect(oit.height).toBe(1);
  });
});

// ── dispose ─────────────────────────────────────────────────────────

describe('WeightedBlendedOIT.dispose', () => {
  it('does not throw', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    expect(() => oit.dispose()).not.toThrow();
  });
});

// ── 多片元叠加 ───────────────────────────────────────────────────────

describe('WeightedBlendedOIT multiple fragments', () => {
  it('handles fragments on different pixels', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragments([
      { x: 0, y: 0, color: [1, 0, 0], alpha: 0.5, depth: 1 },
      { x: 1, y: 1, color: [0, 1, 0], alpha: 0.5, depth: 1 },
      { x: 2, y: 2, color: [0, 0, 1], alpha: 0.5, depth: 1 },
    ]);
    const scene = blackImage(5, 5);
    const out = oit.composite(scene);
    // 3 个像素应有颜色变化
    expect(oit.stats.visiblePixels).toBe(3);
    // 每个像素应有对应颜色
    expect(getPixel(out, 5, 0, 0)[0]).toBeGreaterThan(0); // R
    expect(getPixel(out, 5, 1, 1)[1]).toBeGreaterThan(0); // G
    expect(getPixel(out, 5, 2, 2)[2]).toBeGreaterThan(0); // B
  });

  it('handles many fragments on same pixel', () => {
    const oit = new WeightedBlendedOIT(3, 3);
    // 在同一像素添加 10 个片元
    for (let i = 0; i < 10; i++) {
      oit.addFragment({
        x: 1,
        y: 1,
        color: [0.5, 0.5, 0.5],
        alpha: 0.3,
        depth: 1 + i * 0.5,
      });
    }
    // revealage = (1-0.3)^10 ≈ 0.028
    expect(oit.getRevealage(1, 1)).toBeLessThan(0.05);
    expect(oit.getRevealage(1, 1)).toBeGreaterThan(0.01);
    expect(oit.stats.fragmentCount).toBe(10);
  });

  it('clamps output to 255', () => {
    const oit = new WeightedBlendedOIT(3, 3);
    // 添加大量高 alpha 白色片元
    for (let i = 0; i < 5; i++) {
      oit.addFragment({
        x: 0,
        y: 0,
        color: [1, 1, 1],
        alpha: 0.9,
        depth: 1,
      });
    }
    const scene = blackImage(3, 3);
    const out = oit.composite(scene);
    const [r, g, b] = getPixel(out, 3, 0, 0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeLessThanOrEqual(255);
  });
});

// ── 调试辅助方法 ─────────────────────────────────────────────────────

describe('WeightedBlendedOIT debug helpers', () => {
  it('getRevealage returns 1.0 for out-of-bounds', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    expect(oit.getRevealage(-1, 0)).toBe(1.0);
    expect(oit.getRevealage(0, -1)).toBe(1.0);
    expect(oit.getRevealage(5, 0)).toBe(1.0);
    expect(oit.getRevealage(0, 5)).toBe(1.0);
  });

  it('getAccumulatedWeight returns 0 for out-of-bounds', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    expect(oit.getAccumulatedWeight(-1, 0)).toBe(0);
    expect(oit.getAccumulatedWeight(5, 0)).toBe(0);
  });

  it('getAccumulatedColor returns [0,0,0] for out-of-bounds', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    const c = oit.getAccumulatedColor(-1, 0);
    expect(c).toEqual([0, 0, 0]);
  });

  it('getAccumulatedColor returns stored color', () => {
    const oit = new WeightedBlendedOIT(5, 5);
    oit.addFragment({ x: 2, y: 2, color: [0.5, 0.3, 0.1], alpha: 1.0, depth: 1 });
    const c = oit.getAccumulatedColor(2, 2);
    // 累加颜色 = color * weight * alpha (未归一化)
    expect(c[0]).toBeGreaterThan(0);
    expect(c[1]).toBeGreaterThan(0);
    expect(c[2]).toBeGreaterThan(0);
  });
});
