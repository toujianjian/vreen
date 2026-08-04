// LUTBlender 单元测试。
//
// 覆盖:
//   1. computeBlendWeights() o3de 层级权重公式正确性
//   2. sampleLUT3D() 三线性插值正确性
//   3. blendLUTs() 多 LUT 混合
//   4. makeIdentityLUT() / makeSolidLUT() 工具函数
//   5. LUTBlender 类(状态管理 + dirty 追踪 + 增量更新)
//   6. 边界情况(空列表、超限、单 LUT、全 override=1 等)

import { describe, it, expect } from 'vitest';
import {
  computeBlendWeights,
  sampleLUT3D,
  blendLUTs,
  makeIdentityLUT,
  makeSolidLUT,
  LUTBlender,
  MAX_BLEND_LUTS,
  type LUTBlendItem,
} from './LUTBlender';

// ── computeBlendWeights ───────────────────────────────────────────

describe('computeBlendWeights', () => {
  it('empty list returns pure base weight', () => {
    const w = computeBlendWeights([], []);
    expect(w).toHaveLength(MAX_BLEND_LUTS + 1);
    expect(w[0]).toBeCloseTo(1.0, 10);
    for (let i = 1; i <= MAX_BLEND_LUTS; i++) {
      expect(w[i]).toBe(0);
    }
  });

  it('single LUT intensity=1 override=1 → full LUT weight', () => {
    const w = computeBlendWeights([1.0], [1.0]);
    expect(w[0]).toBeCloseTo(0.0, 10);  // base = 0
    expect(w[1]).toBeCloseTo(1.0, 10);  // LUT0 = 1
    expect(w[2]).toBe(0);
    expect(w[3]).toBe(0);
    expect(w[4]).toBe(0);
  });

  it('single LUT intensity=0 → full base weight (no grading)', () => {
    const w = computeBlendWeights([0.0], [1.0]);
    expect(w[0]).toBeCloseTo(1.0, 10);  // base = 1
    expect(w[1]).toBeCloseTo(0.0, 10);  // LUT0 = 0
  });

  it('single LUT intensity=0.5 override=1 → 50/50 base/LUT', () => {
    const w = computeBlendWeights([0.5], [1.0]);
    expect(w[0]).toBeCloseTo(0.5, 10);  // base = (1-0.5)*1 = 0.5
    expect(w[1]).toBeCloseTo(0.5, 10);  // LUT0 = 0.5*1 = 0.5
  });

  it('single LUT override=0 → base weight = 0 (LUT has no effect)', () => {
    const w = computeBlendWeights([1.0], [0.0]);
    // weight[0] = (1-1)*0 * ... = 0
    // weight[1] = 1*0 * ... = 0
    // But override=0 means the LUT doesn't contribute at all
    // The formula: weight[0] = (1-intensity)*override = 0*0 = 0
    //              weight[1] = intensity*override = 1*0 = 0
    // So weights sum to 0 (edge case: override=0 means "no contribution")
    expect(w[0]).toBeCloseTo(0.0, 10);
    expect(w[1]).toBeCloseTo(0.0, 10);
  });

  it('two LUTs: LUT0 intensity=1 override=1, LUT1 intensity=1 override=0.5', () => {
    const w = computeBlendWeights([1.0, 1.0], [1.0, 0.5]);
    // weight[0] (base) = (1-1)*1 * (1-0.5) = 0
    // weight[1] (LUT0) = 1*1 * (1-0.5) = 0.5
    // weight[2] (LUT1) = 1*0.5 = 0.5
    expect(w[0]).toBeCloseTo(0.0, 10);
    expect(w[1]).toBeCloseTo(0.5, 10);
    expect(w[2]).toBeCloseTo(0.5, 10);
  });

  it('two LUTs: LUT0 intensity=1 override=1, LUT1 intensity=1 override=1 (full override)', () => {
    const w = computeBlendWeights([1.0, 1.0], [1.0, 1.0]);
    // weight[0] (base) = (1-1)*1 * (1-1) = 0
    // weight[1] (LUT0) = 1*1 * (1-1) = 0  (LUT1 fully overrides LUT0)
    // weight[2] (LUT1) = 1*1 = 1
    expect(w[0]).toBeCloseTo(0.0, 10);
    expect(w[1]).toBeCloseTo(0.0, 10);
    expect(w[2]).toBeCloseTo(1.0, 10);
  });

  it('two LUTs: LUT0 intensity=0.5 override=1, LUT1 intensity=1 override=0.5', () => {
    const w = computeBlendWeights([0.5, 1.0], [1.0, 0.5]);
    // weight[0] (base) = (1-0.5)*1 * (1-0.5) = 0.25
    // weight[1] (LUT0) = 0.5*1 * (1-0.5) = 0.25
    // weight[2] (LUT1) = 1*0.5 = 0.5
    expect(w[0]).toBeCloseTo(0.25, 10);
    expect(w[1]).toBeCloseTo(0.25, 10);
    expect(w[2]).toBeCloseTo(0.5, 10);
  });

  it('weights sum to 1 (energy conservation) for various configs', () => {
    const configs: [number[], number[]][] = [
      [[1], [1]],
      [[0.5], [1]],
      [[1, 1], [1, 0.5]],
      [[1, 1], [1, 1]],
      [[0.5, 1], [1, 0.5]],
      [[0.3, 0.7, 1.0], [0.5, 0.8, 1.0]],
      [[1, 1, 1, 1], [0.25, 0.5, 0.75, 1.0]],
    ];
    for (const [ints, ovs] of configs) {
      const w = computeBlendWeights(ints, ovs);
      const sum = w.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 8);
    }
  });

  it('clamps to MAX_BLEND_LUTS', () => {
    // 6 LUTs → only first 4 used
    const w = computeBlendWeights([1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]);
    expect(w).toHaveLength(MAX_BLEND_LUTS + 1);
    // With 4 LUTs all intensity=1 override=1, only the last (LUT3) survives:
    // weight[0] = Σ (1-1)*1 * Π(1-1) = 0
    // weight[1] = 1*1 * (1-1)*(1-1)*(1-1) = 0
    // weight[2] = 1*1 * (1-1)*(1-1) = 0
    // weight[3] = 1*1 * (1-1) = 0
    // weight[4] = 1*1 = 1  (LUT3 fully overrides all lower-priority LUTs)
    expect(w[0]).toBeCloseTo(0.0, 10);
    expect(w[1]).toBeCloseTo(0.0, 10);
    expect(w[2]).toBeCloseTo(0.0, 10);
    expect(w[3]).toBeCloseTo(0.0, 10);
    expect(w[4]).toBeCloseTo(1.0, 10);
  });

  it('mismatched lengths uses min', () => {
    const w = computeBlendWeights([1, 1], [1]);
    // Only 1 LUT used (min of 2,1)
    expect(w[0]).toBeCloseTo(0.0, 10);
    expect(w[1]).toBeCloseTo(1.0, 10);
  });
});

// ── sampleLUT3D ───────────────────────────────────────────────────

describe('sampleLUT3D', () => {
  it('samples identity LUT at (0.5, 0.5, 0.5) → (0.5, 0.5, 0.5)', () => {
    const lut = makeIdentityLUT(16);
    const [r, g, b] = sampleLUT3D(lut.data, 16, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.5, 4);
    expect(g).toBeCloseTo(0.5, 4);
    expect(b).toBeCloseTo(0.5, 4);
  });

  it('samples identity LUT at (0, 0, 0) → (0, 0, 0)', () => {
    const lut = makeIdentityLUT(8);
    const [r, g, b] = sampleLUT3D(lut.data, 8, 0, 0, 0);
    expect(r).toBeCloseTo(0, 6);
    expect(g).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it('samples identity LUT at (1, 1, 1) → (1, 1, 1)', () => {
    const lut = makeIdentityLUT(8);
    const [r, g, b] = sampleLUT3D(lut.data, 8, 1, 1, 1);
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(1, 6);
  });

  it('samples solid LUT → constant color', () => {
    const lut = makeSolidLUT(4, 0.7, 0.3, 0.1);
    const [r, g, b] = sampleLUT3D(lut.data, 4, 0.5, 0.2, 0.9);
    expect(r).toBeCloseTo(0.7, 6);
    expect(g).toBeCloseTo(0.3, 6);
    expect(b).toBeCloseTo(0.1, 6);
  });

  it('clamps out-of-range coordinates', () => {
    const lut = makeIdentityLUT(8);
    const [r] = sampleLUT3D(lut.data, 8, -0.5, 1.5, 2.0);
    // -0.5 clamped to 0, 1.5/2.0 clamped to 1
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

// ── blendLUTs ─────────────────────────────────────────────────────

describe('blendLUTs', () => {
  it('empty list returns identity LUT', () => {
    const result = blendLUTs([]);
    expect(result.size).toBe(16); // default
    // Check identity: sample at (0.5, 0.5, 0.5) → (0.5, 0.5, 0.5)
    const [r, g, b] = sampleLUT3D(result.data, result.size, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.5, 4);
    expect(g).toBeCloseTo(0.5, 4);
    expect(b).toBeCloseTo(0.5, 4);
  });

  it('single LUT intensity=1 override=1 → output = LUT', () => {
    const solid = makeSolidLUT(8, 0.9, 0.1, 0.2);
    const items: LUTBlendItem[] = [
      { lut: solid, intensity: 1.0, overrideStrength: 1.0 },
    ];
    const result = blendLUTs(items);
    // Sample anywhere → should be (0.9, 0.1, 0.2)
    const [r, g, b] = sampleLUT3D(result.data, result.size, 0.5, 0.3, 0.7);
    expect(r).toBeCloseTo(0.9, 4);
    expect(g).toBeCloseTo(0.1, 4);
    expect(b).toBeCloseTo(0.2, 4);
  });

  it('single LUT intensity=0 → output = identity', () => {
    const solid = makeSolidLUT(8, 0.9, 0.1, 0.2);
    const items: LUTBlendItem[] = [
      { lut: solid, intensity: 0.0, overrideStrength: 1.0 },
    ];
    const result = blendLUTs(items);
    // Should be identity (base color)
    const [r, g, b] = sampleLUT3D(result.data, result.size, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.5, 4);
    expect(g).toBeCloseTo(0.5, 4);
    expect(b).toBeCloseTo(0.5, 4);
  });

  it('single LUT intensity=0.5 → 50% base + 50% LUT', () => {
    const solid = makeSolidLUT(8, 1.0, 0.0, 0.0); // pure red
    const items: LUTBlendItem[] = [
      { lut: solid, intensity: 0.5, overrideStrength: 1.0 },
    ];
    const result = blendLUTs(items);
    // At (0.5, 0.5, 0.5): base=(0.5,0.5,0.5), LUT=(1,0,0)
    // blended = 0.5*base + 0.5*LUT = (0.75, 0.25, 0.25)
    const [r, g, b] = sampleLUT3D(result.data, result.size, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.75, 4);
    expect(g).toBeCloseTo(0.25, 4);
    expect(b).toBeCloseTo(0.25, 4);
  });

  it('two solid LUTs 50/50 blend → averaged color', () => {
    const red = makeSolidLUT(8, 1.0, 0.0, 0.0);
    const blue = makeSolidLUT(8, 0.0, 0.0, 1.0);
    const items: LUTBlendItem[] = [
      { lut: red,  intensity: 1.0, overrideStrength: 1.0 },
      { lut: blue, intensity: 1.0, overrideStrength: 0.5 },
    ];
    const result = blendLUTs(items);
    // weights: base=0, LUT0=0.5, LUT1=0.5
    // at any point: 0.5*red + 0.5*blue = (0.5, 0, 0.5)
    const [r, g, b] = sampleLUT3D(result.data, result.size, 0.3, 0.7, 0.2);
    expect(r).toBeCloseTo(0.5, 4);
    expect(g).toBeCloseTo(0.0, 4);
    expect(b).toBeCloseTo(0.5, 4);
  });

  it('two solid LUTs with full override (LUT1 overrides LUT0)', () => {
    const red = makeSolidLUT(8, 1.0, 0.0, 0.0);
    const blue = makeSolidLUT(8, 0.0, 0.0, 1.0);
    const items: LUTBlendItem[] = [
      { lut: red,  intensity: 1.0, overrideStrength: 1.0 },
      { lut: blue, intensity: 1.0, overrideStrength: 1.0 },
    ];
    const result = blendLUTs(items);
    // weights: base=0, LUT0=0, LUT1=1
    // → pure blue
    const [r, g, b] = sampleLUT3D(result.data, result.size, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.0, 4);
    expect(g).toBeCloseTo(0.0, 4);
    expect(b).toBeCloseTo(1.0, 4);
  });

  it('respects outputSize option', () => {
    const solid = makeSolidLUT(8, 1.0, 0.0, 0.0);
    const items: LUTBlendItem[] = [
      { lut: solid, intensity: 1.0, overrideStrength: 1.0 },
    ];
    const result = blendLUTs(items, { outputSize: 32 });
    expect(result.size).toBe(32);
    expect(result.data.length).toBe(32 * 32 * 32 * 3);
  });

  it('clamps to MAX_BLEND_LUTS items', () => {
    const items: LUTBlendItem[] = [];
    for (let i = 0; i < 6; i++) {
      items.push({
        lut: makeSolidLUT(4, i / 5, 0, 0),
        intensity: 1.0,
        overrideStrength: 1.0,
      });
    }
    // Only first MAX_BLEND_LUTS (4) used; last one (LUT3) fully overrides
    const result = blendLUTs(items);
    expect(result.size).toBe(4);
    // LUT3 = (3/5, 0, 0) = (0.6, 0, 0) should be the result (full override chain)
    const [r] = sampleLUT3D(result.data, result.size, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.6, 4);
  });
});

// ── makeIdentityLUT ───────────────────────────────────────────────

describe('makeIdentityLUT', () => {
  it('correct size and data length', () => {
    const lut = makeIdentityLUT(16);
    expect(lut.size).toBe(16);
    expect(lut.data.length).toBe(16 * 16 * 16 * 3);
  });

  it('identity property: input = output', () => {
    const lut = makeIdentityLUT(8);
    for (const [r, g, b] of [[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]]) {
      const [sr, sg, sb] = sampleLUT3D(lut.data, lut.size, r, g, b);
      expect(sr).toBeCloseTo(r, 4);
      expect(sg).toBeCloseTo(g, 4);
      expect(sb).toBeCloseTo(b, 4);
    }
  });
});

// ── makeSolidLUT ──────────────────────────────────────────────────

describe('makeSolidLUT', () => {
  it('all texels have the same color', () => {
    const lut = makeSolidLUT(4, 0.3, 0.6, 0.9);
    for (let i = 0; i < lut.data.length; i += 3) {
      expect(lut.data[i]).toBeCloseTo(0.3, 6);
      expect(lut.data[i + 1]).toBeCloseTo(0.6, 6);
      expect(lut.data[i + 2]).toBeCloseTo(0.9, 6);
    }
  });
});

// ── LUTBlender class ──────────────────────────────────────────────

describe('LUTBlender', () => {
  it('starts dirty and empty', () => {
    const b = new LUTBlender();
    expect(b.isDirty()).toBe(true);
    expect(b.getItems()).toHaveLength(0);
  });

  it('setItems sets items and marks dirty', () => {
    const b = new LUTBlender();
    const items: LUTBlendItem[] = [
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ];
    b.setItems(items);
    expect(b.getItems()).toHaveLength(1);
    expect(b.isDirty()).toBe(true);
  });

  it('blend() clears dirty flag', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    expect(b.isDirty()).toBe(false);
  });

  it('blend() returns identity when empty', () => {
    const b = new LUTBlender();
    const result = b.blend();
    const [r, g, bb] = sampleLUT3D(result.data, result.size, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.5, 4);
    expect(g).toBeCloseTo(0.5, 4);
    expect(bb).toBeCloseTo(0.5, 4);
  });

  it('setIntensity marks dirty', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    expect(b.isDirty()).toBe(false);
    b.setIntensity(0, 0.5);
    expect(b.isDirty()).toBe(true);
  });

  it('setOverrideStrength marks dirty', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    expect(b.isDirty()).toBe(false);
    b.setOverrideStrength(0, 0.5);
    expect(b.isDirty()).toBe(true);
  });

  it('setOutputSize marks dirty', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    expect(b.isDirty()).toBe(false);
    b.setOutputSize(32);
    expect(b.isDirty()).toBe(true);
  });

  it('markDirty() marks dirty', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    expect(b.isDirty()).toBe(false);
    b.markDirty();
    expect(b.isDirty()).toBe(true);
  });

  it('getWeights() returns cached weights after blend', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    const w = b.getWeights();
    expect(w[0]).toBeCloseTo(0.0, 10);
    expect(w[1]).toBeCloseTo(1.0, 10);
  });

  it('getWeights() recomputes when dirty', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    b.setIntensity(0, 0.5);
    const w = b.getWeights();
    expect(w[0]).toBeCloseTo(0.5, 10);
    expect(w[1]).toBeCloseTo(0.5, 10);
  });

  it('day/night transition scenario', () => {
    const day = makeSolidLUT(8, 1.0, 0.95, 0.8);  // warm daylight
    const night = makeSolidLUT(8, 0.2, 0.3, 0.6);  // cool night
    const b = new LUTBlender();
    b.setItems([
      { lut: day,   intensity: 1.0, overrideStrength: 1.0 },
      { lut: night, intensity: 1.0, overrideStrength: 0.0 }, // 0 = no night yet
    ]);
    b.blend();
    // 100% day
    let [r] = sampleLUT3D(b.blend().data, 8, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(1.0, 4);

    // Transition to 50% night
    b.setOverrideStrength(1, 0.5);
    b.blend();
    [r] = sampleLUT3D(b.blend().data, 8, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.6, 4); // (1.0 + 0.2) / 2

    // Full night
    b.setOverrideStrength(1, 1.0);
    b.blend();
    [r] = sampleLUT3D(b.blend().data, 8, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.2, 4);
  });

  it('clamps items to MAX_BLEND_LUTS', () => {
    const b = new LUTBlender();
    const items: LUTBlendItem[] = [];
    for (let i = 0; i < 6; i++) {
      items.push({
        lut: makeSolidLUT(4, 1, 0, 0),
        intensity: 1,
        overrideStrength: 1,
      });
    }
    b.setItems(items);
    expect(b.getItems()).toHaveLength(MAX_BLEND_LUTS);
  });

  it('setIntensity on invalid index does nothing', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    b.setIntensity(5, 0.5); // invalid index
    expect(b.isDirty()).toBe(false);
  });

  it('setOverrideStrength on invalid index does nothing', () => {
    const b = new LUTBlender();
    b.setItems([
      { lut: makeSolidLUT(8, 1, 0, 0), intensity: 1, overrideStrength: 1 },
    ]);
    b.blend();
    b.setOverrideStrength(-1, 0.5); // invalid index
    expect(b.isDirty()).toBe(false);
  });
});

// ── MAX_BLEND_LUTS constant ───────────────────────────────────────

describe('MAX_BLEND_LUTS constant', () => {
  it('equals 4 (matching o3de)', () => {
    expect(MAX_BLEND_LUTS).toBe(4);
  });
});
