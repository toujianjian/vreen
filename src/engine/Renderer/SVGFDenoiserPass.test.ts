// SVGFDenoiserPass 测试 — Spatiotemporal Variance-Guided Filtering 去噪器。
// 参考:Schied et al. 2017 "Spatiotemporal Variance-Guided Filtering"

import { describe, it, expect } from 'vitest';
import {
  luminance,
  temporalAccumulation,
  estimateVariance,
  edgeStoppingWeight,
  atrousFilterIteration,
  svgfDenoise,
  makeSolidPixelBuffer,
  makeZeroVelocity,
  makeConstantDepth,
  makeConstantNormal,
  type SVGFPixelBuffer,
  type SVGFVelocityBuffer,
  type SVGFDepthBuffer,
} from './SVGFDenoiserPass';

// ── luminance ─────────────────────────────────────────────────────

describe('luminance', () => {
  it('white → 255', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(255, 0);
  });

  it('black → 0', () => {
    expect(luminance(0, 0, 0)).toBe(0);
  });

  it('red > blue (Rec. 709 weights)', () => {
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });

  it('green > red (Rec. 709 weights)', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
  });

  it('gray = luminance value', () => {
    expect(luminance(128, 128, 128)).toBeCloseTo(128, 0);
  });
});

// ── temporalAccumulation ──────────────────────────────────────────

describe('temporalAccumulation', () => {
  it('first frame (no history) outputs current frame', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 50, 25);
    const velocity = makeZeroVelocity(4, 4);
    const { color, samples, resets } = temporalAccumulation(
      current, null, null, velocity, 0.2,
    );
    // 首帧:输出 = 输入
    expect(color.data[0]).toBe(100);
    expect(color.data[1]).toBe(50);
    expect(color.data[2]).toBe(25);
    // 样本数 = 1
    expect(samples[0]).toBe(1);
    // 全部重置
    expect(resets).toBe(16);
  });

  it('static scene accumulates samples', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const history = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const historySamples = new Float32Array(16).fill(4); // 已累积 4 帧
    const velocity = makeZeroVelocity(4, 4);
    const { samples, resets } = temporalAccumulation(
      current, history, historySamples, velocity, 0.2,
    );
    // 静态场景:无重置
    expect(resets).toBe(0);
    // 样本累积:4 * 0.8 + 1 = 4.2
    expect(samples[0]).toBeCloseTo(4.2, 1);
  });

  it('temporal blend mixes history and current', () => {
    const current = makeSolidPixelBuffer(4, 4, 200, 200, 200);
    const history = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const historySamples = new Float32Array(16).fill(2);
    const velocity = makeZeroVelocity(4, 4);
    const alpha = 0.5;
    const { color } = temporalAccumulation(
      current, history, historySamples, velocity, alpha,
    );
    // mix: 100 * 0.5 + 200 * 0.5 = 150
    expect(color.data[0]).toBeCloseTo(150, 0);
  });

  it('disoccluded pixels reset to current', () => {
    const current = makeSolidPixelBuffer(4, 4, 200, 100, 50);
    const history = makeSolidPixelBuffer(4, 4, 10, 20, 30);
    const historySamples = new Float32Array(16).fill(10);
    // 大速度 → 历史 UV 超界 → 遮挡
    const velocity: SVGFVelocityBuffer = {
      data: new Float32Array(4 * 4 * 2).fill(100),
      width: 4,
      height: 4,
    };
    const { color, samples, resets } = temporalAccumulation(
      current, history, historySamples, velocity, 0.2,
    );
    // 全部遮挡 → 输出 = 当前帧
    expect(color.data[0]).toBe(200);
    expect(samples[0]).toBe(1);
    expect(resets).toBe(16);
  });

  it('sample count caps at 256', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const history = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const historySamples = new Float32Array(16).fill(300); // 已超上限
    const velocity = makeZeroVelocity(4, 4);
    const { samples } = temporalAccumulation(
      current, history, historySamples, velocity, 0.1,
    );
    // 300 * 0.9 + 1 = 271 → capped to 256
    expect(samples[0]).toBe(256);
  });

  it('output dimensions match input', () => {
    const current = makeSolidPixelBuffer(8, 6, 100, 100, 100);
    const velocity = makeZeroVelocity(8, 6);
    const { color } = temporalAccumulation(
      current, null, null, velocity, 0.2,
    );
    expect(color.width).toBe(8);
    expect(color.height).toBe(6);
    expect(color.data.length).toBe(8 * 6 * 4);
  });
});

// ── estimateVariance ──────────────────────────────────────────────

describe('estimateVariance', () => {
  it('uniform color → zero variance', () => {
    const color = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const samples = new Float32Array(16).fill(1);
    const variance = estimateVariance(color, samples);
    // 均匀区域方差 = 0
    expect(variance[0]).toBe(0);
  });

  it('varied colors → positive variance', () => {
    const color: SVGFPixelBuffer = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    // 左半 0,右半 255
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        const v = x < 2 ? 0 : 255;
        color.data[i] = v;
        color.data[i + 1] = v;
        color.data[i + 2] = v;
        color.data[i + 3] = 255;
      }
    }
    const samples = new Float32Array(16).fill(1);
    const variance = estimateVariance(color, samples);
    // 边界像素(邻域有 0 和 255)方差 > 0
    expect(variance[1]).toBeGreaterThan(0);
    expect(variance[2]).toBeGreaterThan(0);
  });

  it('more samples → lower variance', () => {
    const color: SVGFPixelBuffer = {
      data: new Uint8ClampedArray(3 * 3 * 4),
      width: 3,
      height: 3,
    };
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const i = (y * 3 + x) * 4;
        const v = (x + y) * 50;
        color.data[i] = v;
        color.data[i + 1] = v;
        color.data[i + 2] = v;
        color.data[i + 3] = 255;
      }
    }
    // 低样本数
    const samples1 = new Float32Array(9).fill(1);
    const var1 = estimateVariance(color, samples1);
    // 高样本数 → 方差更低
    const samples4 = new Float32Array(9).fill(4);
    const var4 = estimateVariance(color, samples4);
    expect(var4[4]).toBeLessThanOrEqual(var1[4]);
  });

  it('variance is non-negative', () => {
    const color: SVGFPixelBuffer = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    for (let i = 0; i < color.data.length; i += 4) {
      color.data[i] = Math.random() * 255;
      color.data[i + 1] = Math.random() * 255;
      color.data[i + 2] = Math.random() * 255;
      color.data[i + 3] = 255;
    }
    const samples = new Float32Array(16).fill(1);
    const variance = estimateVariance(color, samples);
    for (let i = 0; i < variance.length; i++) {
      expect(variance[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('variance is clamped to [0, 1]', () => {
    const color: SVGFPixelBuffer = {
      data: new Uint8ClampedArray(3 * 3 * 4),
      width: 3,
      height: 3,
    };
    // 极端对比
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const i = (y * 3 + x) * 4;
        const v = (x + y) % 2 === 0 ? 0 : 255;
        color.data[i] = v;
        color.data[i + 1] = v;
        color.data[i + 2] = v;
        color.data[i + 3] = 255;
      }
    }
    const samples = new Float32Array(9).fill(1);
    const variance = estimateVariance(color, samples);
    for (let i = 0; i < variance.length; i++) {
      expect(variance[i]).toBeLessThanOrEqual(1);
      expect(variance[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── edgeStoppingWeight ────────────────────────────────────────────

describe('edgeStoppingWeight', () => {
  it('identical pixels → weight 1', () => {
    const w = edgeStoppingWeight(
      0.5, 0.5,
      [0, 0, 1], [0, 0, 1],
      128, 128,
      0,
    );
    expect(w).toBeCloseTo(1, 1);
  });

  it('depth discontinuity → low weight', () => {
    const wNear = edgeStoppingWeight(
      0.5, 0.5, [0, 0, 1], [0, 0, 1], 128, 128, 0,
    );
    const wFar = edgeStoppingWeight(
      0.5, 0.9, [0, 0, 1], [0, 0, 1], 128, 128, 0,
    );
    expect(wFar).toBeLessThan(wNear);
  });

  it('normal discontinuity → low weight', () => {
    const wSame = edgeStoppingWeight(
      0.5, 0.5, [0, 0, 1], [0, 0, 1], 128, 128, 0,
    );
    const wDiff = edgeStoppingWeight(
      0.5, 0.5, [0, 0, 1], [1, 0, 0], 128, 128, 0,
    );
    expect(wDiff).toBeLessThan(wSame);
  });

  it('luminance discontinuity with variance → low weight', () => {
    const wSame = edgeStoppingWeight(
      0.5, 0.5, [0, 0, 1], [0, 0, 1], 128, 128, 0.1,
    );
    const wDiff = edgeStoppingWeight(
      0.5, 0.5, [0, 0, 1], [0, 0, 1], 128, 255, 0.1,
    );
    expect(wDiff).toBeLessThan(wSame);
  });

  it('zero variance → luminance weight ~1 (no filtering needed)', () => {
    const w = edgeStoppingWeight(
      0.5, 0.5, [0, 0, 1], [0, 0, 1], 128, 200, 0,
    );
    // variance=0 → wLum = exp(-diff²/ε) ≈ 1
    expect(w).toBeGreaterThan(0.9);
  });

  it('opposite normals → weight 0', () => {
    const w = edgeStoppingWeight(
      0.5, 0.5, [0, 0, 1], [0, 0, -1], 128, 128, 0,
    );
    // dot=0 → pow(0, 32) = 0
    expect(w).toBe(0);
  });

  it('weight is in [0, 1]', () => {
    const w = edgeStoppingWeight(
      0.3, 0.7, [0.3, 0.5, 0.8], [0.1, 0.2, 0.9],
      50, 200, 0.05,
    );
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(1);
  });
});

// ── atrousFilterIteration ─────────────────────────────────────────

describe('atrousFilterIteration', () => {
  it('uniform scene → output equals input', () => {
    const color = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const depth = makeConstantDepth(4, 4, 0.5);
    const normal = makeConstantNormal(4, 4, 0, 0, 1);
    const variance = new Float32Array(16); // 零方差
    const out = atrousFilterIteration(color, depth, normal, variance, 1);
    // 均匀区域:所有邻居相同 → 输出 = 输入
    expect(out.data[0]).toBeCloseTo(100, 0);
    expect(out.data[1]).toBeCloseTo(100, 0);
  });

  it('depth edge preserves boundary', () => {
    const color: SVGFPixelBuffer = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    const depth: SVGFDepthBuffer = {
      data: new Float32Array(4 * 4),
      width: 4,
      height: 4,
    };
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        const di = y * 4 + x;
        if (x < 2) {
          color.data[i] = 255; color.data[i + 1] = 0; color.data[i + 2] = 0;
          depth.data[di] = 0.3;
        } else {
          color.data[i] = 0; color.data[i + 1] = 0; color.data[i + 2] = 255;
          depth.data[di] = 0.9;
        }
        color.data[i + 3] = 255;
      }
    }
    const normal = makeConstantNormal(4, 4, 0, 0, 1);
    const variance = new Float32Array(16).fill(0.1);
    const out = atrousFilterIteration(color, depth, normal, variance, 1);
    // 深度边缘处颜色不应渗透(深度差异大 → 权重低)
    // 左半红色区域中心 x=0 应保持接近红色
    const leftIdx = (1 * 4 + 0) * 4;
    expect(out.data[leftIdx]).toBeGreaterThan(out.data[leftIdx + 2]);
  });

  it('output dimensions match input', () => {
    const color = makeSolidPixelBuffer(8, 6, 100, 100, 100);
    const depth = makeConstantDepth(8, 6);
    const normal = makeConstantNormal(8, 6);
    const variance = new Float32Array(8 * 6);
    const out = atrousFilterIteration(color, depth, normal, variance, 2);
    expect(out.width).toBe(8);
    expect(out.height).toBe(6);
  });

  it('step parameter scales kernel reach', () => {
    // 大 step → 更远的邻居参与
    const color = makeSolidPixelBuffer(8, 8, 100, 100, 100);
    const depth = makeConstantDepth(8, 8);
    const normal = makeConstantNormal(8, 8);
    const variance = new Float32Array(64);
    const out1 = atrousFilterIteration(color, depth, normal, variance, 1);
    const out4 = atrousFilterIteration(color, depth, normal, variance, 4);
    // 均匀区域 → 两者都应等于输入
    expect(out1.data[0]).toBeCloseTo(100, 0);
    expect(out4.data[0]).toBeCloseTo(100, 0);
  });
});

// ── svgfDenoise (full pipeline) ───────────────────────────────────

describe('svgfDenoise', () => {
  it('first frame (no history) produces output matching input shape', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const velocity = makeZeroVelocity(4, 4);
    const depth = makeConstantDepth(4, 4);
    const normal = makeConstantNormal(4, 4);
    const { output, history, samples, stats } = svgfDenoise(
      current, null, null, velocity, depth, normal,
    );
    expect(output.width).toBe(4);
    expect(output.height).toBe(4);
    expect(output.data.length).toBe(4 * 4 * 4);
    expect(history).toBeDefined();
    expect(samples.length).toBe(16);
    expect(stats.pixelsProcessed).toBe(16);
    expect(stats.temporalResets).toBe(16);
  });

  it('static scene converges over frames', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const velocity = makeZeroVelocity(4, 4);
    const depth = makeConstantDepth(4, 4);
    const normal = makeConstantNormal(4, 4);

    // 第一帧
    const r1 = svgfDenoise(current, null, null, velocity, depth, normal);
    expect(r1.stats.avgSamples).toBeCloseTo(1, 0);

    // 第二帧(静态)
    const r2 = svgfDenoise(current, r1.history, r1.samples, velocity, depth, normal);
    // 样本数应增加
    expect(r2.stats.avgSamples).toBeGreaterThan(1);
    expect(r2.stats.temporalResets).toBe(0);
  });

  it('returns correct stats', () => {
    const current = makeSolidPixelBuffer(8, 8, 100, 100, 100);
    const velocity = makeZeroVelocity(8, 8);
    const depth = makeConstantDepth(8, 8);
    const normal = makeConstantNormal(8, 8);
    const { stats } = svgfDenoise(
      current, null, null, velocity, depth, normal,
      { atrousIterations: 3 },
    );
    expect(stats.pixelsProcessed).toBe(64);
    expect(stats.atrousIterations).toBe(3);
    expect(stats.avgVariance).toBeGreaterThanOrEqual(0);
    expect(stats.lastFrameTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('atrousIterations option controls filter passes', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const velocity = makeZeroVelocity(4, 4);
    const depth = makeConstantDepth(4, 4);
    const normal = makeConstantNormal(4, 4);

    const r1 = svgfDenoise(current, null, null, velocity, depth, normal, { atrousIterations: 1 });
    const r4 = svgfDenoise(current, null, null, velocity, depth, normal, { atrousIterations: 4 });

    expect(r1.stats.atrousIterations).toBe(1);
    expect(r4.stats.atrousIterations).toBe(4);
  });

  it('clamps atrousIterations to [1, 8]', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const velocity = makeZeroVelocity(4, 4);
    const depth = makeConstantDepth(4, 4);
    const normal = makeConstantNormal(4, 4);

    const r0 = svgfDenoise(current, null, null, velocity, depth, normal, { atrousIterations: 0 });
    const r99 = svgfDenoise(current, null, null, velocity, depth, normal, { atrousIterations: 99 });

    expect(r0.stats.atrousIterations).toBe(1);
    expect(r99.stats.atrousIterations).toBe(8);
  });

  it('uses default options when none provided', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const velocity = makeZeroVelocity(4, 4);
    const depth = makeConstantDepth(4, 4);
    const normal = makeConstantNormal(4, 4);
    const { stats } = svgfDenoise(
      current, null, null, velocity, depth, normal,
    );
    // 默认 4 次迭代
    expect(stats.atrousIterations).toBe(4);
  });

  it('varianceBoost amplifies variance', () => {
    const color: SVGFPixelBuffer = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    };
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        const v = (x + y) * 40;
        color.data[i] = v; color.data[i + 1] = v; color.data[i + 2] = v;
        color.data[i + 3] = 255;
      }
    }
    const velocity = makeZeroVelocity(4, 4);
    const depth = makeConstantDepth(4, 4);
    const normal = makeConstantNormal(4, 4);

    const r1 = svgfDenoise(color, null, null, velocity, depth, normal, { varianceBoost: 1.0 });
    const r5 = svgfDenoise(color, null, null, velocity, depth, normal, { varianceBoost: 5.0 });

    // varianceBoost > 1 应增大平均方差
    expect(r5.stats.avgVariance).toBeGreaterThanOrEqual(r1.stats.avgVariance);
  });

  it('does not modify input data', () => {
    const current = makeSolidPixelBuffer(4, 4, 100, 100, 100);
    const inputCopy = new Uint8ClampedArray(current.data);
    const velocity = makeZeroVelocity(4, 4);
    const depth = makeConstantDepth(4, 4);
    const normal = makeConstantNormal(4, 4);
    svgfDenoise(current, null, null, velocity, depth, normal);
    // 输入不应被修改
    for (let i = 0; i < inputCopy.length; i++) {
      expect(current.data[i]).toBe(inputCopy[i]);
    }
  });
});

// ── shader chunks exist ───────────────────────────────────────────

describe('SVGF GLSL shader chunks', () => {
  it('SVGF_TEMPORAL_FRAG exists and declares required uniforms', async () => {
    const shaders = await import('../Materials/shaders');
    expect(shaders.SVGF_TEMPORAL_FRAG).toBeDefined();
    expect(shaders.SVGF_TEMPORAL_FRAG).toContain('u_currentColor');
    expect(shaders.SVGF_TEMPORAL_FRAG).toContain('u_historyColor');
    expect(shaders.SVGF_TEMPORAL_FRAG).toContain('u_velocity');
    expect(shaders.SVGF_TEMPORAL_FRAG).toContain('u_temporalAlpha');
    expect(shaders.SVGF_TEMPORAL_FRAG).toContain('u_hasHistory');
  });

  it('SVGF_VARIANCE_FRAG exists and computes variance', async () => {
    const shaders = await import('../Materials/shaders');
    expect(shaders.SVGF_VARIANCE_FRAG).toBeDefined();
    expect(shaders.SVGF_VARIANCE_FRAG).toContain('u_accumulatedColor');
    expect(shaders.SVGF_VARIANCE_FRAG).toContain('u_samples');
    expect(shaders.SVGF_VARIANCE_FRAG).toContain('variance');
    expect(shaders.SVGF_VARIANCE_FRAG).toContain('luminance');
  });

  it('SVGF_ATROUS_FRAG exists and has edge-stopping weights', async () => {
    const shaders = await import('../Materials/shaders');
    expect(shaders.SVGF_ATROUS_FRAG).toBeDefined();
    expect(shaders.SVGF_ATROUS_FRAG).toContain('u_color');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('u_depth');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('u_normal');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('u_variance');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('u_step');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('wDepth');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('wNormal');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('wLum');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('ATROUS_OFFSETS');
    expect(shaders.SVGF_ATROUS_FRAG).toContain('ATROUS_WEIGHTS');
  });
});

// ── test helpers ──────────────────────────────────────────────────

describe('test helpers', () => {
  it('makeSolidPixelBuffer creates correct buffer', () => {
    const buf = makeSolidPixelBuffer(4, 4, 10, 20, 30, 40);
    expect(buf.width).toBe(4);
    expect(buf.height).toBe(4);
    expect(buf.data.length).toBe(4 * 4 * 4);
    expect(buf.data[0]).toBe(10);
    expect(buf.data[1]).toBe(20);
    expect(buf.data[2]).toBe(30);
    expect(buf.data[3]).toBe(40);
  });

  it('makeZeroVelocity creates zero buffer', () => {
    const buf = makeZeroVelocity(4, 4);
    expect(buf.width).toBe(4);
    expect(buf.height).toBe(4);
    expect(buf.data.length).toBe(4 * 4 * 2);
    expect(buf.data[0]).toBe(0);
  });

  it('makeConstantDepth creates constant buffer', () => {
    const buf = makeConstantDepth(4, 4, 0.7);
    // Float32Array 精度:0.7 → 0.6999999...
    expect(buf.data[0]).toBeCloseTo(0.7, 5);
    expect(buf.data[15]).toBeCloseTo(0.7, 5);
  });

  it('makeConstantNormal creates constant normal', () => {
    const buf = makeConstantNormal(4, 4, 0, 1, 0);
    expect(buf.data[0]).toBe(0);
    expect(buf.data[1]).toBe(1);
    expect(buf.data[2]).toBe(0);
  });
});
