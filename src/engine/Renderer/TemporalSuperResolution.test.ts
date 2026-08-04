// TemporalSuperResolution 单元测试。
//
// 覆盖:
//   1. Halton 序列 — 分布 / 周期 / 抖动
//   2. 双线性采样 — 整数像素 / 边界钳制 / 分数插值
//   3. 重投影 — 静态 / 运动 / 分辨率缩放
//   4. 邻域 AABB — min/max / 边界
//   5. 夹紧 — AABB 硬夹紧 / Catmull-Rom 软夹紧
//   6. 置信度 — 静态 / 高速 / 遮挡 / 阈值
//   7. EASU 回退 — 首帧 / 遮挡
//   8. 锐化 — 零强度 / 正强度
//   9. resolveTSR — 首帧 / 静态收敛 / 高速回退 / 尺寸
//  10. GLSL 源码校验

import { describe, it, expect } from 'vitest';
import {
  halton,
  getJitter,
  bilinearSampleRGBA,
  reprojectToHistory,
  neighborhoodMinMax,
  clampToAABB,
  catmullRomClamp,
  computeConfidence,
  easuSample,
  sharpen,
  resolveTSR,
  makeSolidBuffer,
  makeZeroVelocity,
  type PixelBuffer,
  type VelocityBuffer,
} from './TemporalSuperResolution';
import { TSR_RESOLVE_FRAG } from '../Materials/shaders';

// ── Halton ────────────────────────────────────────────────────────

describe('halton', () => {
  it('returns values in [0,1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = halton(i, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('base 2 produces known sequence', () => {
    expect(halton(0, 2)).toBe(0);
    expect(halton(1, 2)).toBe(0.5);
    expect(halton(2, 2)).toBe(0.25);
    expect(halton(3, 2)).toBe(0.75);
  });

  it('base 3 produces known sequence', () => {
    expect(halton(0, 3)).toBe(0);
    expect(halton(1, 3)).toBeCloseTo(1 / 3, 5);
    expect(halton(2, 3)).toBeCloseTo(2 / 3, 5);
  });

  it('different bases produce different sequences', () => {
    expect(halton(5, 2)).not.toBeCloseTo(halton(5, 3), 3);
  });
});

describe('getJitter', () => {
  it('returns [offsetX, offsetY] within [-0.5, 0.5] * scale', () => {
    const [jx, jy] = getJitter(10, 1.0);
    expect(jx).toBeGreaterThanOrEqual(-0.5);
    expect(jx).toBeLessThanOrEqual(0.5);
    expect(jy).toBeGreaterThanOrEqual(-0.5);
    expect(jy).toBeLessThanOrEqual(0.5);
  });

  it('scale=0 produces zero jitter', () => {
    const [jx, jy] = getJitter(10, 0);
    expect(jx).toBe(0);
    expect(jy).toBe(0);
  });

  it('larger scale produces larger jitter range', () => {
    const [jx1] = getJitter(1, 1.0);
    const [jx2] = getJitter(1, 4.0);
    expect(Math.abs(jx2)).toBeCloseTo(Math.abs(jx1) * 4, 3);
  });
});

// ── 双线性采样 ────────────────────────────────────────────────────

describe('bilinearSampleRGBA', () => {
  it('returns exact color at integer UV', () => {
    const buf: PixelBuffer = {
      data: new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80,
                                    90, 100, 110, 120, 130, 140, 150, 160]),
      width: 2, height: 2,
    };
    const [r, g, b, a] = bilinearSampleRGBA(buf, 0, 0);
    expect(r).toBe(10);
    expect(g).toBe(20);
    expect(b).toBe(30);
    expect(a).toBe(40);
  });

  it('interpolates at fractional UV', () => {
    const buf: PixelBuffer = {
      data: new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255,
                                    0, 0, 0, 255, 100, 100, 100, 255]),
      width: 2, height: 2,
    };
    // UV (0.5, 0.5) → 中心 → 4 像素平均 = 50
    const [r] = bilinearSampleRGBA(buf, 0.5, 0.5);
    expect(r).toBeCloseTo(50, 0);
  });

  it('clamps UV out of bounds to edge', () => {
    const buf: PixelBuffer = {
      data: new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]),
      width: 2, height: 1,
    };
    const [r] = bilinearSampleRGBA(buf, -1, 0);
    expect(r).toBe(10);
    const [r2] = bilinearSampleRGBA(buf, 2, 0);
    expect(r2).toBe(50);
  });
});

// ── 重投影 ────────────────────────────────────────────────────────

describe('reprojectToHistory', () => {
  it('returns same UV when velocity is zero (static)', () => {
    const [u, v] = reprojectToHistory(50, 50, 0, 0, 100, 100, 200, 200);
    expect(u).toBeCloseTo(0.5, 4);
    expect(v).toBeCloseTo(0.5, 4);
  });

  it('shifts UV by velocity (normalized)', () => {
    const [u, v] = reprojectToHistory(50, 50, 10, 5, 100, 100, 200, 200);
    // lowU = (50 - 10) / 100 = 0.4
    expect(u).toBeCloseTo(0.4, 4);
    expect(v).toBeCloseTo(0.45, 4);
  });

  it('works with resolution scale (low→high)', () => {
    // 低分辨率 100×100 → 高分辨率 200×200,UV 是归一化的
    const [u, v] = reprojectToHistory(25, 75, 0, 0, 100, 100, 200, 200);
    expect(u).toBeCloseTo(0.25, 4);
    expect(v).toBeCloseTo(0.75, 4);
  });
});

// ── 邻域 AABB ─────────────────────────────────────────────────────

describe('neighborhoodMinMax', () => {
  it('returns correct min/max for uniform color', () => {
    const buf = makeSolidBuffer(4, 4, 100, 150, 200);
    const { min: mn, max: mx } = neighborhoodMinMax(buf, 2, 2, 1);
    expect(mn.r).toBe(100);
    expect(mn.g).toBe(150);
    expect(mn.b).toBe(200);
    expect(mx.r).toBe(100);
    expect(mx.g).toBe(150);
    expect(mx.b).toBe(200);
  });

  it('finds min and max in varying neighborhood', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        data[i] = x * 10;  // r: 0,10,20,30
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
    const buf: PixelBuffer = { data, width: 4, height: 4 };
    const { min: mn, max: mx } = neighborhoodMinMax(buf, 1, 1, 1);
    expect(mn.r).toBe(0);   // x=0
    expect(mx.r).toBe(20);  // x=2
  });

  it('handles edge pixels (clamps to bounds)', () => {
    const buf = makeSolidBuffer(4, 4, 50, 50, 50);
    expect(() => neighborhoodMinMax(buf, 0, 0, 1)).not.toThrow();
  });
});

// ── 夹紧 ──────────────────────────────────────────────────────────

describe('clampToAABB', () => {
  it('returns color unchanged when within AABB', () => {
    const color = { r: 100, g: 150, b: 200 };
    const mn = { r: 50, g: 100, b: 150 };
    const mx = { r: 150, g: 200, b: 250 };
    const result = clampToAABB(color, mn, mx);
    expect(result.r).toBe(100);
    expect(result.g).toBe(150);
    expect(result.b).toBe(200);
  });

  it('clamps color below min', () => {
    const color = { r: 0, g: 50, b: 100 };
    const mn = { r: 50, g: 100, b: 150 };
    const mx = { r: 150, g: 200, b: 250 };
    const result = clampToAABB(color, mn, mx);
    expect(result.r).toBe(50);
    expect(result.g).toBe(100);
    expect(result.b).toBe(150);
  });

  it('clamps color above max', () => {
    const color = { r: 200, g: 250, b: 300 };
    const mn = { r: 50, g: 100, b: 150 };
    const mx = { r: 150, g: 200, b: 250 };
    const result = clampToAABB(color, mn, mx);
    expect(result.r).toBe(150);
    expect(result.g).toBe(200);
    expect(result.b).toBe(250);
  });
});

describe('catmullRomClamp', () => {
  it('converges history towards center', () => {
    const history = { r: 200, g: 200, b: 200 };
    const center = { r: 100, g: 100, b: 100 };
    const mn = { r: 50, g: 50, b: 50 };
    const mx = { r: 250, g: 250, b: 250 };
    const result = catmullRomClamp(history, center, mn, mx);
    // history(200) clamped to [50,250] = 200, then mix(200, 100, 0.5) = 150
    expect(result.r).toBeCloseTo(150, 0);
  });

  it('still clamps to AABB before softening', () => {
    const history = { r: 300, g: 300, b: 300 };  // above max
    const center = { r: 100, g: 100, b: 100 };
    const mn = { r: 50, g: 50, b: 50 };
    const mx = { r: 250, g: 250, b: 250 };
    const result = catmullRomClamp(history, center, mn, mx);
    // clamp(300, [50,250]) = 250, then mix(250, 100, 0.5) = 175
    expect(result.r).toBeCloseTo(175, 0);
  });
});

// ── 置信度 ────────────────────────────────────────────────────────

describe('computeConfidence', () => {
  it('returns max confidence (1-blendFactor) for static pixel', () => {
    const c = computeConfidence(0, 0, false, 16, 0.1);
    expect(c).toBeCloseTo(0.9, 4);
  });

  it('returns 0 for disoccluded pixel', () => {
    const c = computeConfidence(0, 0, true, 16, 0.1);
    expect(c).toBe(0);
  });

  it('returns blendFactor for high-velocity pixel', () => {
    const c = computeConfidence(20, 20, false, 16, 0.1);
    expect(c).toBeCloseTo(0.1, 4);
  });

  it('decreases linearly with speed', () => {
    const slow = computeConfidence(4, 0, false, 16, 0.1);
    const fast = computeConfidence(12, 0, false, 16, 0.1);
    expect(fast).toBeLessThan(slow);
  });

  it('returns blendFactor when speed equals threshold', () => {
    const c = computeConfidence(16, 0, false, 16, 0.1);
    expect(c).toBeCloseTo(0.1, 4);
  });
});

// ── EASU 回退 ─────────────────────────────────────────────────────

describe('easuSample', () => {
  it('returns interpolated color from low-res buffer', () => {
    const low: PixelBuffer = {
      data: new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255]),
      width: 2, height: 1,
    };
    // 高分辨率 x=1 → 低分辨率 UV = (1.5)/2 = 0.75 → 0.25*0 + 0.75*100 = 75
    const [r] = easuSample(low, 1, 0, 4, 2);
    expect(r).toBeCloseTo(75, 0);
  });

  it('works at high-res origin', () => {
    const low = makeSolidBuffer(2, 2, 50, 100, 150);
    const [r, g, b] = easuSample(low, 0, 0, 4, 4);
    expect(r).toBeCloseTo(50, 0);
    expect(g).toBeCloseTo(100, 0);
    expect(b).toBeCloseTo(150, 0);
  });
});

// ── 锐化 ──────────────────────────────────────────────────────────

describe('sharpen', () => {
  it('returns original color when strength=0', () => {
    const buf = makeSolidBuffer(4, 4, 100, 100, 100);
    const [r, g, b] = sharpen(buf, 2, 2, 0);
    expect(r).toBe(100);
    expect(g).toBe(100);
    expect(b).toBe(100);
  });

  it('enhances differences with positive strength', () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    // 中心 = 200, 邻居 = 100
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const i = (y * 3 + x) * 4;
        const isCenter = x === 1 && y === 1;
        data[i] = isCenter ? 200 : 100;
        data[i + 1] = isCenter ? 200 : 100;
        data[i + 2] = isCenter ? 200 : 100;
        data[i + 3] = 255;
      }
    }
    const buf: PixelBuffer = { data, width: 3, height: 3 };
    const [r] = sharpen(buf, 1, 1, 0.5);
    // center(200) + 0.5*(200 - avg(100)) = 200 + 50 = 250
    expect(r).toBe(250);
  });

  it('clamps to [0,255]', () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const i = (y * 3 + x) * 4;
        const isCenter = x === 1 && y === 1;
        data[i] = isCenter ? 10 : 200;
        data[i + 1] = isCenter ? 10 : 200;
        data[i + 2] = isCenter ? 10 : 200;
        data[i + 3] = 255;
      }
    }
    const buf: PixelBuffer = { data, width: 3, height: 3 };
    const [r] = sharpen(buf, 1, 1, 1.0);
    // center(10) + 1.0*(10 - 200) = 10 - 190 = -180 → clamp to 0
    expect(r).toBe(0);
  });
});

// ── resolveTSR ────────────────────────────────────────────────────

describe('resolveTSR', () => {
  it('first frame (no history) produces 2x output via EASU', () => {
    const current = makeSolidBuffer(4, 4, 100, 150, 200);
    const velocity = makeZeroVelocity(4, 4);
    const { output, stats } = resolveTSR(current, null, velocity, null);
    expect(output.width).toBe(8);
    expect(output.height).toBe(8);
    expect(output.data.length).toBe(8 * 8 * 4);
    // 首帧全部 EASU 回退
    expect(stats.easuFallbacks).toBe(8 * 8);
    // 纯色 → 输出也是纯色
    expect(output.data[0]).toBeCloseTo(100, 0);
    expect(output.data[1]).toBeCloseTo(150, 0);
  });

  it('static scene converges to current color', () => {
    const current = makeSolidBuffer(4, 4, 100, 100, 100);
    const velocity = makeZeroVelocity(4, 4);
    // 历史是不同颜色
    const history = makeSolidBuffer(8, 8, 200, 200, 200);
    const { output } = resolveTSR(current, history, velocity, null, {
      blendFactor: 0.5,
    });
    // 静态,置信度 = 1 - 0.5 = 0.5
    // output = history(200, clamped to [100,100]=100) * 0.5 + current(100) * 0.5
    // history clamped to AABB [100,100] = 100, then 100*0.5 + 100*0.5 = 100
    expect(output.data[0]).toBeCloseTo(100, 0);
  });

  it('produces correct output dimensions matching history', () => {
    const current = makeSolidBuffer(4, 4, 50, 50, 50);
    const velocity = makeZeroVelocity(4, 4);
    const history = makeSolidBuffer(16, 16, 50, 50, 50);
    const { output } = resolveTSR(current, history, velocity, null);
    expect(output.width).toBe(16);
    expect(output.height).toBe(16);
  });

  it('high velocity reduces history weight', () => {
    const current = makeSolidBuffer(4, 4, 100, 100, 100);
    // 高速度
    const velocity: VelocityBuffer = {
      data: new Float32Array(4 * 4 * 2).fill(20),
      width: 4, height: 4,
    };
    const history = makeSolidBuffer(8, 8, 200, 200, 200);
    const { output, stats } = resolveTSR(current, history, velocity, null, {
      blendFactor: 0.1,
      velocityThreshold: 16,
    });
    // 高速 → 置信度 = blendFactor = 0.1
    // 但历史(200)被 AABB [100,100] 夹紧到 100 → output = 100*0.1 + 100*0.9 = 100
    expect(output.data[0]).toBeCloseTo(100, 0);
    expect(stats.avgConfidence).toBeLessThan(0.2);
  });

  it('disoccluded pixels use EASU fallback', () => {
    const current = makeSolidBuffer(4, 4, 100, 100, 100);
    // 极大速度 → 历史 UV 超界 → 遮挡
    const velocity: VelocityBuffer = {
      data: new Float32Array(4 * 4 * 2).fill(100),
      width: 4, height: 4,
    };
    const history = makeSolidBuffer(8, 8, 200, 200, 200);
    const { stats } = resolveTSR(current, history, velocity, null);
    // 遮挡 → EASU 回退
    expect(stats.easuFallbacks).toBeGreaterThan(0);
  });

  it('applies sharpening when sharpness > 0', () => {
    const current = makeSolidBuffer(4, 4, 100, 100, 100);
    const velocity = makeZeroVelocity(4, 4);
    const history = makeSolidBuffer(8, 8, 100, 100, 100);
    const { output } = resolveTSR(current, history, velocity, null, {
      sharpness: 0.5,
    });
    // 纯色 → 锐化无变化(中心 == 邻居)
    expect(output.data[0]).toBeCloseTo(100, 0);
  });

  it('returns stats with pixel count', () => {
    const current = makeSolidBuffer(4, 4, 50, 50, 50);
    const velocity = makeZeroVelocity(4, 4);
    const { stats } = resolveTSR(current, null, velocity, null);
    expect(stats.pixelsProcessed).toBe(8 * 8);
    expect(stats.easuFallbacks).toBe(8 * 8);
  });

  it('uses default options when none provided', () => {
    const current = makeSolidBuffer(4, 4, 50, 50, 50);
    const velocity = makeZeroVelocity(4, 4);
    expect(() => resolveTSR(current, null, velocity, null)).not.toThrow();
  });
});

// ── 辅助构造器 ────────────────────────────────────────────────────

describe('makeSolidBuffer', () => {
  it('fills all pixels with given color', () => {
    const buf = makeSolidBuffer(4, 4, 10, 20, 30, 40);
    expect(buf.width).toBe(4);
    expect(buf.height).toBe(4);
    expect(buf.data.length).toBe(4 * 4 * 4);
    for (let i = 0; i < buf.data.length; i += 4) {
      expect(buf.data[i]).toBe(10);
      expect(buf.data[i + 1]).toBe(20);
      expect(buf.data[i + 2]).toBe(30);
      expect(buf.data[i + 3]).toBe(40);
    }
  });
});

describe('makeZeroVelocity', () => {
  it('creates zero-filled velocity buffer', () => {
    const vel = makeZeroVelocity(4, 4);
    expect(vel.width).toBe(4);
    expect(vel.height).toBe(4);
    expect(vel.data.length).toBe(4 * 4 * 2);
    for (const v of vel.data) expect(v).toBe(0);
  });
});

// ── GLSL 源码校验 ─────────────────────────────────────────────────

describe('TSR_RESOLVE_FRAG shader source', () => {
  it('declares all required uniforms', () => {
    expect(TSR_RESOLVE_FRAG).toContain('u_currentColor');
    expect(TSR_RESOLVE_FRAG).toContain('u_historyColor');
    expect(TSR_RESOLVE_FRAG).toContain('u_velocity');
    expect(TSR_RESOLVE_FRAG).toContain('u_lowResSize');
    expect(TSR_RESOLVE_FRAG).toContain('u_blendFactor');
    expect(TSR_RESOLVE_FRAG).toContain('u_velocityThreshold');
    expect(TSR_RESOLVE_FRAG).toContain('u_hasHistory');
  });

  it('declares varying v_uv', () => {
    expect(TSR_RESOLVE_FRAG).toContain('v_uv');
  });

  it('implements neighborhood min/max (3x3)', () => {
    expect(TSR_RESOLVE_FRAG).toContain('tsrNeighborMin');
    expect(TSR_RESOLVE_FRAG).toContain('tsrNeighborMax');
    expect(TSR_RESOLVE_FRAG).toContain('for (int y = -1; y <= 1; y++)');
  });

  it('implements AABB clamp', () => {
    expect(TSR_RESOLVE_FRAG).toContain('tsrClampAABB');
    expect(TSR_RESOLVE_FRAG).toContain('clamp(color, mn, mx)');
  });

  it('implements Catmull-Rom soft clamp', () => {
    expect(TSR_RESOLVE_FRAG).toContain('tsrCatmullRomClamp');
    expect(TSR_RESOLVE_FRAG).toContain('mix(clamped, center, 0.5)');
  });

  it('implements confidence calculation', () => {
    expect(TSR_RESOLVE_FRAG).toContain('tsrConfidence');
    expect(TSR_RESOLVE_FRAG).toContain('length(velocity)');
  });

  it('early-exits on first frame (no history)', () => {
    expect(TSR_RESOLVE_FRAG).toContain('if (u_hasHistory == 0)');
  });

  it('handles disocclusion via EASU fallback', () => {
    expect(TSR_RESOLVE_FRAG).toContain('disoccluded');
    expect(TSR_RESOLVE_FRAG).toContain('confidence <= 0.0');
  });

  it('provides main entry tsrResolve', () => {
    expect(TSR_RESOLVE_FRAG).toContain('vec3 tsrResolve()');
  });

  it('blends history and current via confidence', () => {
    expect(TSR_RESOLVE_FRAG).toContain('mix(current, history, confidence)');
  });

  it('references provenance (Karis / UE5 / FSR2 / o3de)', () => {
    expect(TSR_RESOLVE_FRAG).toContain('Karis');
    expect(TSR_RESOLVE_FRAG).toContain('UE5');
    expect(TSR_RESOLVE_FRAG).toContain('FSR2');
    expect(TSR_RESOLVE_FRAG).toContain('o3de');
  });
});
