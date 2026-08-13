// TAAPass (CPU 侧) 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setters(setEnabled / setSamples / setBlendFactor / setSharpness /
//      setJitterScale / setSize)
//   3. jitter:getJitter / getNextJitter(Halton 序列)/ applyJitter(投影矩阵)
//   4. 核心算法:reproject / neighborhoodClamp(AABB & Catmull-Rom)/
//      varianceClip / resolve / sharpen
//   5. render:disabled 返回副本、首帧建立历史、后续帧混合、尺寸变更重置
//   6. getHistoryBuffer / reset / getStats / dispose

import { describe, it, expect } from 'vitest';
import { TAAPass } from './TAAPass';
import { Matrix4 } from '../Math/Matrix4';
import type { TAACamera, TAAInput } from './TAAPass';

/** 构造一个最小可用的相机(只需 projectionMatrix)。 */
function makeCamera(): TAACamera {
  const cam = new Matrix4();
  cam.makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
  return { projectionMatrix: cam };
}

/** 生成一张测试图:中心一个白点,其余黑色。 */
function makeDotImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const i = ((cy + y) * w + (cx + x)) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
  return d;
}

/** 生成全黑图。 */
function makeBlackImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < d.length; i += 4) d[i] = 255; // alpha=255
  return d;
}

/** 构造 TAAInput。 */
function makeInput(data: Uint8ClampedArray, w: number, h: number): TAAInput {
  return { data, width: w, height: h };
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('TAAPass construction', () => {
  it('defaults', () => {
    const p = new TAAPass();
    expect(p.name).toBe('taa');
    expect(p.enabled).toBe(true);
    expect(p.samples).toBe(8);
    expect(p.blendFactor).toBe(0.1);
    expect(p.sharpness).toBe(0.0);
    expect(p.jitterScale).toBe(1.0);
    expect(p.historyBuffer).toBeNull();
    expect(p.velocityBuffer).toBeNull();
    expect(p.currentJitter.x).toBe(0);
    expect(p.currentJitter.y).toBe(0);
    expect(p.jitterIndex).toBe(0);
    expect(p.useCatmullRom).toBe(false);
    expect(p.useVarianceClip).toBe(false);
    expect(p.width).toBe(256);
    expect(p.height).toBe(256);
  });

  it('accepts options', () => {
    const p = new TAAPass({
      enabled: false,
      samples: 16,
      blendFactor: 0.2,
      sharpness: 0.3,
      jitterScale: 2.0,
      useCatmullRom: true,
      useVarianceClip: true,
      width: 64,
      height: 48,
    });
    expect(p.enabled).toBe(false);
    expect(p.samples).toBe(16);
    expect(p.blendFactor).toBe(0.2);
    expect(p.sharpness).toBe(0.3);
    expect(p.jitterScale).toBe(2.0);
    expect(p.useCatmullRom).toBe(true);
    expect(p.useVarianceClip).toBe(true);
    expect(p.width).toBe(64);
    expect(p.height).toBe(48);
  });
});

// ── setters ────────────────────────────────────────────────────────

describe('TAAPass setters', () => {
  it('setEnabled toggles', () => {
    const p = new TAAPass();
    p.setEnabled(false);
    expect(p.enabled).toBe(false);
    p.setEnabled(true);
    expect(p.enabled).toBe(true);
  });

  it('setSamples clamps to [1,1024] and floors', () => {
    const p = new TAAPass();
    p.setSamples(0);
    expect(p.samples).toBe(1);
    p.setSamples(2000);
    expect(p.samples).toBe(1024);
    p.setSamples(12.7);
    expect(p.samples).toBe(12);
  });

  it('setBlendFactor clamps to [0,1]', () => {
    const p = new TAAPass();
    p.setBlendFactor(2.0);
    expect(p.blendFactor).toBe(1);
    p.setBlendFactor(-1.0);
    expect(p.blendFactor).toBe(0);
    p.setBlendFactor(0.3);
    expect(p.blendFactor).toBe(0.3);
  });

  it('setSharpness clamps to [0,1]', () => {
    const p = new TAAPass();
    p.setSharpness(-0.5);
    expect(p.sharpness).toBe(0);
    p.setSharpness(2.0);
    expect(p.sharpness).toBe(1);
    p.setSharpness(0.4);
    expect(p.sharpness).toBe(0.4);
  });

  it('setJitterScale clamps to >=0', () => {
    const p = new TAAPass();
    p.setJitterScale(-1);
    expect(p.jitterScale).toBe(0);
    p.setJitterScale(3.5);
    expect(p.jitterScale).toBe(3.5);
  });

  it('setSize updates dimensions and nulls historyBuffer', () => {
    const p = new TAAPass({ width: 32, height: 32 });
    p.historyBuffer = new Float32Array(32 * 32 * 4);
    p.setSize(64, 48);
    expect(p.width).toBe(64);
    expect(p.height).toBe(48);
    expect(p.historyBuffer).toBeNull();
  });

  it('setSize with same dimensions is no-op', () => {
    const p = new TAAPass({ width: 32, height: 32 });
    const buf = new Float32Array(32 * 32 * 4);
    p.historyBuffer = buf;
    p.setSize(32, 32);
    expect(p.historyBuffer).toBe(buf);
  });
});

// ── jitter ─────────────────────────────────────────────────────────

describe('TAAPass jitter', () => {
  it('getJitter returns current jitter (copy)', () => {
    const p = new TAAPass();
    p.currentJitter.x = 0.3;
    p.currentJitter.y = -0.4;
    const j = p.getJitter();
    expect(j.x).toBe(0.3);
    expect(j.y).toBe(-0.4);
    // 修改返回值不影响内部
    j.x = 99;
    expect(p.currentJitter.x).toBe(0.3);
  });

  it('getNextJitter advances index and updates currentJitter', () => {
    const p = new TAAPass({ samples: 8, jitterScale: 1.0 });
    expect(p.jitterIndex).toBe(0);
    const j0 = p.getNextJitter();
    expect(p.jitterIndex).toBe(1);
    // 返回值与 currentJitter 的值一致(可能不是同一引用)
    expect(j0.x).toBe(p.currentJitter.x);
    expect(j0.y).toBe(p.currentJitter.y);
    // sample 0 → Halton(0, b) = 0 → jitter = -0.5
    expect(j0.x).toBeCloseTo(-0.5);
    expect(j0.y).toBeCloseTo(-0.5);
  });

  it('getNextJitter wraps around samples', () => {
    const p = new TAAPass({ samples: 4, jitterScale: 1.0 });
    for (let i = 0; i < 4; i++) p.getNextJitter();
    expect(p.jitterIndex).toBe(0); // 回到 0
  });

  it('getNextJitter respects jitterScale', () => {
    const p = new TAAPass({ samples: 8, jitterScale: 2.0 });
    const j = p.getNextJitter(); // sample 0
    expect(j.x).toBeCloseTo(-1.0); // -0.5 * 2.0
    expect(j.y).toBeCloseTo(-1.0);
  });

  it('jitter values stay within [-scale/2, scale/2]', () => {
    const p = new TAAPass({ samples: 16, jitterScale: 1.0 });
    for (let i = 0; i < 16; i++) {
      const j = p.getNextJitter();
      expect(j.x).toBeGreaterThanOrEqual(-0.5);
      expect(j.x).toBeLessThanOrEqual(0.5);
      expect(j.y).toBeGreaterThanOrEqual(-0.5);
      expect(j.y).toBeLessThanOrEqual(0.5);
    }
  });

  it('applyJitter modifies projection matrix elements 8/9', () => {
    const p = new TAAPass({ width: 100, height: 100, jitterScale: 1.0 });
    p.currentJitter.x = 1.0; // 1 像素
    p.currentJitter.y = -2.0; // -2 像素
    const proj = new Matrix4();
    proj.makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const e8Before = proj.elements[8];
    const e9Before = proj.elements[9];
    p.applyJitter(proj);
    // 1 像素 → NDC = 1 * 2 / 100 = 0.02
    expect(proj.elements[8]).toBeCloseTo(e8Before + 0.02, 5);
    // -2 像素 → NDC = -2 * 2 / 100 = -0.04
    expect(proj.elements[9]).toBeCloseTo(e9Before - 0.04, 5);
  });

  it('applyJitter returns the same matrix reference', () => {
    const p = new TAAPass({ width: 100, height: 100 });
    const proj = new Matrix4();
    const ret = p.applyJitter(proj);
    expect(ret).toBe(proj);
  });

  it('applyJitter is no-op when dimensions are 0', () => {
    const p = new TAAPass();
    p.width = 0;
    p.height = 0;
    const proj = new Matrix4();
    const e8Before = proj.elements[8];
    p.applyJitter(proj);
    expect(proj.elements[8]).toBe(e8Before);
  });
});

// ── 核心算法 ────────────────────────────────────────────────────────

describe('TAAPass core algorithms', () => {
  it('reproject: prevUV = currentUV - velocity', () => {
    const p = new TAAPass();
    const prev = p.reproject({ x: 0.5, y: 0.5 }, { x: 0.1, y: -0.05 });
    expect(prev.x).toBeCloseTo(0.4);
    expect(prev.y).toBeCloseTo(0.55);
  });

  it('neighborhoodClamp (AABB): clamps history to neighborhood min/max', () => {
    const p = new TAAPass({ useCatmullRom: false });
    // 邻域:9 个 RGB,所有通道都在 [10, 20]
    const nb = Array.from({ length: 9 }, () => [15, 15, 15]) as [
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
    ];
    // 故意混入极值,确保 min/max 正确计算
    nb[0] = [10, 20, 15];
    nb[8] = [20, 10, 15];
    // history 超出 [10,20] → 应被夹紧
    const history: [number, number, number] = [5, 30, 15];
    const clamped = p.neighborhoodClamp(nb, history);
    expect(clamped[0]).toBe(10); // 夹到 min
    expect(clamped[1]).toBe(20); // 夹到 max
    expect(clamped[2]).toBe(15); // 已在范围内
  });

  it('neighborhoodClamp (Catmull-Rom): soft clamp blends with center', () => {
    const p = new TAAPass({ useCatmullRom: true });
    const center: [number, number, number] = [100, 100, 100];
    const nb = Array.from({ length: 9 }, () => [...center]) as [
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
    ];
    const history: [number, number, number] = [200, 200, 200];
    const clamped = p.neighborhoodClamp(nb, history);
    // 软夹紧:0.5 * history + 0.5 * center = 150
    expect(clamped[0]).toBeCloseTo(150);
    expect(clamped[1]).toBeCloseTo(150);
    expect(clamped[2]).toBeCloseTo(150);
  });

  it('varianceClip: clamps history to mean±N*stddev', () => {
    const p = new TAAPass();
    // 邻域:8 个 100,1 个 110 → mean=101.11, stddev≈3.14
    const nb = Array.from({ length: 9 }, () => [100, 100, 100]) as [
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
    ];
    nb[0] = [110, 100, 100];
    // history = 200 → 远超 mean+stddev,应被夹紧
    const history: [number, number, number] = [200, 100, 100];
    const clipped = p.varianceClip(nb, history);
    expect(clipped[0]).toBeLessThan(200);
    expect(clipped[0]).toBeGreaterThan(100);
    // 通道 1/2 方差为 0 → 不变
    expect(clipped[1]).toBe(100);
    expect(clipped[2]).toBe(100);
  });

  it('varianceClip: returns history unchanged when stddev≈0', () => {
    const p = new TAAPass();
    const nb = Array.from({ length: 9 }, () => [50, 50, 50]) as [
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
      [number, number, number], [number, number, number], [number, number, number],
    ];
    const history: [number, number, number] = [80, 80, 80];
    const clipped = p.varianceClip(nb, history);
    expect(clipped[0]).toBe(80);
    expect(clipped[1]).toBe(80);
    expect(clipped[2]).toBe(80);
  });

  it('resolve: current*blend + history*(1-blend)', () => {
    const p = new TAAPass({ blendFactor: 0.25 });
    const resolved = p.resolve([100, 100, 100], [200, 200, 200]);
    // 100*0.25 + 200*0.75 = 25 + 150 = 175
    expect(resolved[0]).toBeCloseTo(175);
    expect(resolved[1]).toBeCloseTo(175);
    expect(resolved[2]).toBeCloseTo(175);
  });

  it('resolve: blend=1 returns current', () => {
    const p = new TAAPass();
    p.setBlendFactor(1);
    const resolved = p.resolve([100, 100, 100], [200, 200, 200]);
    expect(resolved[0]).toBeCloseTo(100);
  });

  it('resolve: blend=0 returns history', () => {
    const p = new TAAPass();
    p.setBlendFactor(0);
    const resolved = p.resolve([100, 100, 100], [200, 200, 200]);
    expect(resolved[0]).toBeCloseTo(200);
  });

  it('sharpen: amount=0 returns copy', () => {
    const p = new TAAPass();
    const data = makeDotImage(8, 8);
    const out = p.sharpen(data, 8, 8, 0);
    expect(out).not.toBe(data);
    for (let i = 0; i < data.length; i++) expect(out[i]).toBe(data[i]);
  });

  it('sharpen: amount>0 enhances edges', () => {
    const p = new TAAPass();
    // 用中间灰度(128)+ 中心亮斑(200),避免二值图(0/255)被 clamp 后无变化
    const w = 8, h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 128;
      data[i * 4 + 1] = 128;
      data[i * 4 + 2] = 128;
      data[i * 4 + 3] = 255;
    }
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const ci = (cy * w + cx) * 4;
    data[ci] = 200; data[ci + 1] = 200; data[ci + 2] = 200;
    const out = p.sharpen(data, w, h, 0.5);
    // 至少有一个像素与输入不同(亮斑边缘被增强)
    let diff = 0;
    for (let i = 0; i < data.length; i++) {
      if (out[i] !== data[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('sharpen: does not modify input', () => {
    const p = new TAAPass();
    const data = makeDotImage(8, 8);
    const copy = new Uint8ClampedArray(data);
    p.sharpen(data, 8, 8, 0.5);
    for (let i = 0; i < data.length; i++) expect(data[i]).toBe(copy[i]);
  });
});

// ── render ─────────────────────────────────────────────────────────

describe('TAAPass render', () => {
  it('disabled returns a copy of input', () => {
    const p = new TAAPass({ enabled: false, width: 8, height: 8 });
    const cam = makeCamera();
    const data = makeDotImage(8, 8);
    const out = p.render(makeInput(data, 8, 8), null, cam);
    expect(out.length).toBe(data.length);
    expect(out).not.toBe(data);
    for (let i = 0; i < data.length; i++) expect(out[i]).toBe(data[i]);
  });

  it('first frame: initializes historyBuffer and returns copy of input', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    const cam = makeCamera();
    const data = makeDotImage(8, 8);
    expect(p.historyBuffer).toBeNull();
    const out = p.render(makeInput(data, 8, 8), null, cam);
    expect(p.historyBuffer).not.toBeNull();
    expect(p.historyBuffer!.length).toBe(8 * 8 * 4);
    // 输出 = 输入副本
    for (let i = 0; i < data.length; i++) expect(out[i]).toBe(data[i]);
    // 历史缓冲初始化为输入
    for (let i = 0; i < data.length; i++) {
      expect(p.historyBuffer![i]).toBe(data[i]);
    }
    const stats = p.getStats();
    expect(stats.historyResets).toBe(1);
    expect(stats.pixelsProcessed).toBe(64);
  });

  it('second frame: blends history with current (different output when content changes)', () => {
    const p = new TAAPass({ width: 8, height: 8, blendFactor: 0.5 });
    const cam = makeCamera();
    // 首帧:全黑
    const black = makeBlackImage(8, 8);
    p.render(makeInput(black, 8, 8), null, cam);
    // 第二帧:中心白点
    const dot = makeDotImage(8, 8);
    const out = p.render(makeInput(dot, 8, 8), null, cam);
    // 输出应与输入不同(混合了历史黑色)
    let diff = 0;
    for (let i = 0; i < dot.length; i++) {
      if (out[i] !== dot[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('size change triggers history reset', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    const cam = makeCamera();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    expect(p.width).toBe(8);
    expect(p.historyBuffer).not.toBeNull();
    const resetsBefore = p.getStats().historyResets;
    // 切换尺寸
    p.render(makeInput(makeBlackImage(16, 16), 16, 16), null, cam);
    expect(p.width).toBe(16);
    expect(p.height).toBe(16);
    expect(p.historyBuffer!.length).toBe(16 * 16 * 4);
    // 首帧重置 +1
    expect(p.getStats().historyResets).toBe(resetsBefore + 1);
  });

  it('does not modify input data or velocityBuffer', () => {
    const p = new TAAPass({ width: 8, height: 8, blendFactor: 0.5 });
    const cam = makeCamera();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam); // 首帧
    const data = makeDotImage(8, 8);
    const dataCopy = new Uint8ClampedArray(data);
    const vbuf = new Float32Array(8 * 8 * 2);
    vbuf[0] = 1; vbuf[1] = 0;
    const vbufCopy = new Float32Array(vbuf);
    p.render(makeInput(data, 8, 8), vbuf, cam);
    for (let i = 0; i < data.length; i++) expect(data[i]).toBe(dataCopy[i]);
    for (let i = 0; i < vbuf.length; i++) expect(vbuf[i]).toBe(vbufCopy[i]);
  });

  it('useVarianceClip does not throw and produces output', () => {
    const p = new TAAPass({
      width: 8, height: 8, useVarianceClip: true, blendFactor: 0.5,
    });
    const cam = makeCamera();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    const out = p.render(makeInput(makeDotImage(8, 8), 8, 8), null, cam);
    expect(out.length).toBe(8 * 8 * 4);
  });

  it('useCatmullRom does not throw and produces output', () => {
    const p = new TAAPass({
      width: 8, height: 8, useCatmullRom: true, blendFactor: 0.5,
    });
    const cam = makeCamera();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    const out = p.render(makeInput(makeDotImage(8, 8), 8, 8), null, cam);
    expect(out.length).toBe(8 * 8 * 4);
  });

  it('sharpness>0 produces different output than sharpness=0', () => {
    const cam = makeCamera();
    // 首帧用全黑建立历史
    const black = makeBlackImage(8, 8);
    // 第二帧用 dot
    const dot = makeDotImage(8, 8);

    const p1 = new TAAPass({ width: 8, height: 8, blendFactor: 0.5, sharpness: 0 });
    p1.render(makeInput(black, 8, 8), null, cam);
    const out1 = p1.render(makeInput(dot, 8, 8), null, cam);

    const p2 = new TAAPass({ width: 8, height: 8, blendFactor: 0.5, sharpness: 0.5 });
    p2.render(makeInput(black, 8, 8), null, cam);
    const out2 = p2.render(makeInput(dot, 8, 8), null, cam);

    let diff = 0;
    for (let i = 0; i < out1.length; i++) {
      if (out1[i] !== out2[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('velocity buffer moves sampling location', () => {
    const cam = makeCamera();
    // 4x1 图像:pixel 0 黑,pixel 1 白,pixel 2-3 黑
    const w = 4, h = 1;
    const data = new Uint8ClampedArray(w * h * 4);
    data[(1 * 4) + 0] = 255;
    data[(1 * 4) + 1] = 255;
    data[(1 * 4) + 2] = 255;
    data[(1 * 4) + 3] = 255;

    const p = new TAAPass({ width: w, height: h, blendFactor: 0.5 });
    // 首帧建立历史 = data
    p.render(makeInput(data, w, h), null, cam);
    // 第二帧:pixel 0 的速度 = -1 像素(从 pixel 1 位置移到 pixel 0 位置)
    // velocity = current - prev = 0 - 1 = -1;prev = current - velocity = 0 - (-1) = 1
    // → 从历史 pixel 1(白)采样
    const vbuf = new Float32Array(w * h * 2);
    vbuf[0] = -1; // pixel 0 的速度 x=-1 像素
    const out = p.render(makeInput(data, w, h), vbuf, cam);
    // pixel 0 的输出应该是 mix(history_pixel1=255, current_pixel0=0, 0.5) = 127.5 ≈ 128
    expect(out[0]).toBeGreaterThan(60);
    expect(out[0]).toBeLessThan(200);
  });
});

// ── getHistoryBuffer / reset / dispose / getStats ──────────────────

describe('TAAPass lifecycle', () => {
  it('getHistoryBuffer returns null before first render', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    expect(p.getHistoryBuffer()).toBeNull();
  });

  it('getHistoryBuffer returns the buffer after first render', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    const cam = makeCamera();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    const buf = p.getHistoryBuffer();
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(8 * 8 * 4);
  });

  it('reset clears historyBuffer (next render is first frame)', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    const cam = makeCamera();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    expect(p.historyBuffer).not.toBeNull();
    const resetsBefore = p.getStats().historyResets;
    p.reset();
    expect(p.historyBuffer).toBeNull();
    expect(p.getStats().historyResets).toBe(resetsBefore + 1);
    // 下一帧重新建立历史
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    expect(p.historyBuffer).not.toBeNull();
  });

  it('dispose clears all state', () => {
    const p = new TAAPass({ width: 8, height: 8, jitterScale: 2.0 });
    const cam = makeCamera();
    p.getNextJitter();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    expect(p.historyBuffer).not.toBeNull();
    expect(p.jitterIndex).toBe(1);
    p.dispose();
    expect(p.historyBuffer).toBeNull();
    expect(p.velocityBuffer).toBeNull();
    expect(p.currentJitter.x).toBe(0);
    expect(p.currentJitter.y).toBe(0);
    expect(p.jitterIndex).toBe(0);
    const stats = p.getStats();
    expect(stats.pixelsProcessed).toBe(0);
    expect(stats.historyResets).toBe(0);
  });

  it('dispose is idempotent', () => {
    const p = new TAAPass();
    p.dispose();
    p.dispose();
    expect(p.historyBuffer).toBeNull();
  });

  it('getStats returns a copy', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    const s1 = p.getStats();
    s1.pixelsProcessed = 999;
    const s2 = p.getStats();
    expect(s2.pixelsProcessed).toBe(0);
  });

  it('render after dispose works (re-initializes on next render)', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    const cam = makeCamera();
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    p.dispose();
    // 重新建立
    p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam);
    expect(p.historyBuffer).not.toBeNull();
  });
});

// ── structural typing ──────────────────────────────────────────────

describe('TAAPass structural camera', () => {
  it('accepts any object with projectionMatrix', () => {
    const p = new TAAPass({ width: 8, height: 8 });
    const proj = new Matrix4();
    proj.makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const cam: TAACamera = { projectionMatrix: proj };
    expect(() => p.render(makeInput(makeBlackImage(8, 8), 8, 8), null, cam)).not.toThrow();
  });
});
