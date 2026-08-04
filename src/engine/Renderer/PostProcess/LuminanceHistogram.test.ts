// LuminanceHistogram 单元测试。
//
// 覆盖:
//   1. luminanceToEV100 / ev100ToLuminance 往返转换 + 边界(0 亮度)
//   2. ev100ToBin / binToEV100 对应关系 + clamp
//   3. computeHistogram: Uint8/Float32 输入、降采样、bin 分布正确性
//   4. histogramToExposure: 百分位裁剪、空直方图、全裁剪、manualCompensation、clamp
//   5. adaptExposure: 非对称速度(变亮快/变暗慢)、dt=0、收敛性
//   6. LuminanceHistogram 类: 状态管理、update() 链式调用、setOptions/setExposure
//
// 与 o3de Atom LuminanceHistogramGenerator.azsl 对齐:
//   - 128 bin
//   - EV100 范围 [-8, 16]
//   - Rec709 亮度
//   - EV100 = log2(L * 8)  (S=100, K=12.5)

import { describe, it, expect } from 'vitest';
import {
  NUM_HISTOGRAM_BINS,
  DEFAULT_EV_MIN,
  DEFAULT_EV_MAX,
  luminanceToEV100,
  ev100ToLuminance,
  ev100ToBin,
  binToEV100,
  computeHistogram,
  histogramToExposure,
  adaptExposure,
  LuminanceHistogram,
} from './LuminanceHistogram';

// ── 常量与基础转换 ───────────────────────────────────────────────────

describe('constants', () => {
  it('NUM_HISTOGRAM_BINS = 128 (与 o3de 对齐)', () => {
    expect(NUM_HISTOGRAM_BINS).toBe(128);
  });

  it('DEFAULT_EV range = [-8, 16] (与 o3de GetEvDisplayRangeMinMax 对齐)', () => {
    expect(DEFAULT_EV_MIN).toBe(-8);
    expect(DEFAULT_EV_MAX).toBe(16);
  });
});

// ── luminanceToEV100 / ev100ToLuminance ─────────────────────────────

describe('luminanceToEV100', () => {
  it('0 亮度 → evMin(避免 -Inf)', () => {
    expect(luminanceToEV100(0, -8)).toBe(-8);
    expect(luminanceToEV100(0, -10)).toBe(-10);
  });

  it('负亮度 → evMin', () => {
    expect(luminanceToEV100(-1.0, -8)).toBe(-8);
  });

  it('L=0.125 → EV100=0 (因为 log2(0.125*8) = log2(1) = 0)', () => {
    expect(luminanceToEV100(0.125)).toBeCloseTo(0, 10);
  });

  it('L=1.0 → EV100=3 (log2(8) = 3)', () => {
    expect(luminanceToEV100(1.0)).toBeCloseTo(3, 10);
  });

  it('L=8.0 → EV100=6 (log2(64) = 6)', () => {
    expect(luminanceToEV100(8.0)).toBeCloseTo(6, 10);
  });
});

describe('ev100ToLuminance', () => {
  it('EV100=0 → L=0.125', () => {
    expect(ev100ToLuminance(0)).toBeCloseTo(0.125, 10);
  });

  it('EV100=3 → L=1.0', () => {
    expect(ev100ToLuminance(3)).toBeCloseTo(1.0, 10);
  });

  it('EV100=6 → L=8.0', () => {
    expect(ev100ToLuminance(6)).toBeCloseTo(8.0, 10);
  });

  it('与 luminanceToEV100 互为反函数', () => {
    for (const L of [0.001, 0.125, 0.5, 1.0, 4.0, 16.0, 100.0]) {
      const ev = luminanceToEV100(L);
      const back = ev100ToLuminance(ev);
      expect(back).toBeCloseTo(L, 6);
    }
  });
});

// ── ev100ToBin / binToEV100 ─────────────────────────────────────────

describe('ev100ToBin', () => {
  it('EV=evMin → bin 0', () => {
    expect(ev100ToBin(DEFAULT_EV_MIN)).toBe(0);
  });

  it('EV=evMax → bin NUM_HISTOGRAM_BINS-1', () => {
    expect(ev100ToBin(DEFAULT_EV_MAX)).toBe(NUM_HISTOGRAM_BINS - 1);
  });

  it('EV < evMin → clamp 到 bin 0', () => {
    expect(ev100ToBin(DEFAULT_EV_MIN - 5)).toBe(0);
  });

  it('EV > evMax → clamp 到 bin NUM_HISTOGRAM_BINS-1', () => {
    expect(ev100ToBin(DEFAULT_EV_MAX + 5)).toBe(NUM_HISTOGRAM_BINS - 1);
  });

  it('中点 EV → 中间 bin', () => {
    const midEV = (DEFAULT_EV_MIN + DEFAULT_EV_MAX) / 2; // 4
    const midBin = ev100ToBin(midEV);
    expect(midBin).toBeGreaterThanOrEqual(Math.floor(NUM_HISTOGRAM_BINS / 2) - 1);
    expect(midBin).toBeLessThanOrEqual(Math.floor(NUM_HISTOGRAM_BINS / 2));
  });

  it('evMin == evMax → bin 0(防除零)', () => {
    expect(ev100ToBin(5, 5, 5)).toBe(0);
  });
});

describe('binToEV100', () => {
  it('bin 0 → evMin + 半 bin 偏移', () => {
    const expected = DEFAULT_EV_MIN + 0.5 / NUM_HISTOGRAM_BINS * (DEFAULT_EV_MAX - DEFAULT_EV_MIN);
    expect(binToEV100(0)).toBeCloseTo(expected, 6);
  });

  it('bin NUM_HISTOGRAM_BINS-1 → 接近 evMax', () => {
    const lastBin = NUM_HISTOGRAM_BINS - 1;
    const expected = DEFAULT_EV_MIN + (lastBin + 0.5) / NUM_HISTOGRAM_BINS * (DEFAULT_EV_MAX - DEFAULT_EV_MIN);
    expect(binToEV100(lastBin)).toBeCloseTo(expected, 6);
  });
});

// ── computeHistogram ────────────────────────────────────────────────

describe('computeHistogram', () => {
  it('全黑图像:所有像素落入 bin 0', () => {
    // 4×4 全黑 Uint8 RGBA
    const pixels = new Uint8Array(4 * 4 * 4); // 全 0
    const h = computeHistogram(pixels, 4, 4, { downsample: 1 });
    expect(h.totalCount).toBe(16);
    expect(h.bins[0]).toBe(16);
    // 其他 bin 全为 0
    for (let i = 1; i < NUM_HISTOGRAM_BINS; i++) {
      expect(h.bins[i]).toBe(0);
    }
  });

  it('全白 Uint8 图像:像素落入高 EV bin', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const h = computeHistogram(pixels, 4, 4, { downsample: 1 });
    expect(h.totalCount).toBe(16);
    // 白色 (R=G=B=255) → sRGB→线性 = 1.0 → EV100 = log2(8) = 3
    // bin = (3 - (-8)) / 24 * 128 = 11/24 * 128 ≈ 58.67 → bin 58
    const expectedBin = ev100ToBin(3.0);
    expect(h.bins[expectedBin]).toBe(16);
  });

  it('Float32 HDR 输入:亮度 8.0 → EV100=6', () => {
    // 2×2 Float32 RGBA,所有通道 = 8.0
    const pixels = new Float32Array(2 * 2 * 4).fill(8.0);
    const h = computeHistogram(pixels, 2, 2, { downsample: 1 });
    expect(h.totalCount).toBe(4);
    const expectedBin = ev100ToBin(6.0);
    expect(h.bins[expectedBin]).toBe(4);
  });

  it('downsample=4 时,16×16 图像采样 16 个像素', () => {
    const pixels = new Uint8Array(16 * 16 * 4).fill(128);
    const h = computeHistogram(pixels, 16, 16, { downsample: 4 });
    expect(h.totalCount).toBe(16); // (16/4)^2 = 16
  });

  it('downsample=1 时,采样所有像素', () => {
    const pixels = new Uint8Array(8 * 8 * 4).fill(200);
    const h = computeHistogram(pixels, 8, 8, { downsample: 1 });
    expect(h.totalCount).toBe(64);
  });

  it('downsample=0 视为 1(全分辨率)', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const h = computeHistogram(pixels, 4, 4, { downsample: 0 });
    expect(h.totalCount).toBe(16);
  });

  it('自定义 evMin/evMax 影响 bin 分布', () => {
    const pixels = new Uint8Array(2 * 2 * 4).fill(255);
    // 用窄范围 [-2, 2],EV100=3 会被 clamp 到 bin 127
    const h = computeHistogram(pixels, 2, 2, {
      downsample: 1,
      evMin: -2,
      evMax: 2,
    });
    expect(h.bins[NUM_HISTOGRAM_BINS - 1]).toBe(4);
    expect(h.evMin).toBe(-2);
    expect(h.evMax).toBe(2);
  });

  it('返回正确totalCount 和 bins 长度', () => {
    const pixels = new Uint8Array(8 * 8 * 4).fill(100);
    const h = computeHistogram(pixels, 8, 8, { downsample: 2 });
    expect(h.bins).toHaveLength(NUM_HISTOGRAM_BINS);
    expect(h.totalCount).toBe(16); // (8/2)^2 = 16
    // bins 之和等于 totalCount
    let sum = 0;
    for (let i = 0; i < NUM_HISTOGRAM_BINS; i++) sum += h.bins[i];
    expect(sum).toBe(h.totalCount);
  });

  it('混合亮度:不同像素落入不同 bin', () => {
    // 4 像素:黑、白、灰、亮 HDR(用 Float32 模拟)
    const pixels = new Float32Array([
      0.0, 0.0, 0.0, 1.0,  // 黑
      1.0, 1.0, 1.0, 1.0,  // 白 (L=1, EV=3)
      0.125, 0.125, 0.125, 1.0, // 中灰 (L=0.125, EV=0)
      8.0, 8.0, 8.0, 1.0,  // 亮 (L=8, EV=6)
    ]);
    const h = computeHistogram(pixels, 4, 1, { downsample: 1 });
    expect(h.totalCount).toBe(4);
    // 4 个不同 bin,每个 count=1
    let nonZeroBins = 0;
    for (let i = 0; i < NUM_HISTOGRAM_BINS; i++) {
      if (h.bins[i] > 0) {
        expect(h.bins[i]).toBe(1);
        nonZeroBins++;
      }
    }
    expect(nonZeroBins).toBe(4);
  });
});

// ── histogramToExposure ─────────────────────────────────────────────

describe('histogramToExposure', () => {
  it('空直方图(totalCount=0)→ 返回 manualCompensation clamp', () => {
    const empty = {
      bins: new Uint32Array(NUM_HISTOGRAM_BINS),
      totalCount: 0,
      evMin: DEFAULT_EV_MIN,
      evMax: DEFAULT_EV_MAX,
    };
    const ev = histogramToExposure(empty, { manualCompensation: 1.5 });
    expect(ev).toBe(1.5);
  });

  it('全黑图像 → 目标曝光接近 evMin + manualCompensation', () => {
    const pixels = new Uint8Array(4 * 4 * 4); // 全黑
    const h = computeHistogram(pixels, 4, 4, { downsample: 1 });
    // 所有像素在 bin 0(EV ≈ -7.95),target EV ≈ -7.95
    // clamp 到 [-4, 4] → -4
    const ev = histogramToExposure(h);
    expect(ev).toBe(-4); // clamp 到 minExposure
  });

  it('全白图像 → 目标曝光接近 EV=3 clamp 后 = 3', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const h = computeHistogram(pixels, 4, 4, { downsample: 1 });
    const ev = histogramToExposure(h);
    expect(ev).toBeCloseTo(3.0, 1);
  });

  it('manualCompensation 偏移目标曝光', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const h = computeHistogram(pixels, 4, 4, { downsample: 1 });
    const evBase = histogramToExposure(h, { manualCompensation: 0 });
    const evOffset = histogramToExposure(h, { manualCompensation: 1.0 });
    expect(evOffset).toBeCloseTo(evBase + 1.0, 4);
  });

  it('manualCompensation 受 maxExposure clamp 限制', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const h = computeHistogram(pixels, 4, 4, { downsample: 1 });
    // EV=3 + 5 = 8,但 maxExposure=4 → clamp 到 4
    const ev = histogramToExposure(h, {
      manualCompensation: 5.0,
      minExposure: -4,
      maxExposure: 4,
    });
    expect(ev).toBe(4);
  });

  it('低/高百分位裁剪不影响中间亮度', () => {
    // 构造直方图:1 像素 bin 0,8 像素 bin 64,1 像素 bin 127
    const bins = new Uint32Array(NUM_HISTOGRAM_BINS);
    bins[0] = 1;
    bins[64] = 8;
    bins[127] = 1;
    const h = {
      bins,
      totalCount: 10,
      evMin: DEFAULT_EV_MIN,
      evMax: DEFAULT_EV_MAX,
    };
    // lowPercentile=10% highPercentile=10% → 各裁剪 1 像素
    // 剩下 8 像素全在 bin 64
    // 用宽曝光范围避免 clamp 干扰断言
    const ev = histogramToExposure(h, {
      lowPercentile: 10,
      highPercentile: 10,
      minExposure: -16,
      maxExposure: 16,
    });
    const expectedEV = binToEV100(64);
    expect(ev).toBeCloseTo(expectedEV, 4);
  });

  it('所有像素被裁剪 → 返回中间 bin EV', () => {
    const bins = new Uint32Array(NUM_HISTOGRAM_BINS);
    bins[0] = 5;
    bins[127] = 5;
    const h = {
      bins,
      totalCount: 10,
      evMin: DEFAULT_EV_MIN,
      evMax: DEFAULT_EV_MAX,
    };
    // lowPercentile=50 highPercentile=50 → 全部被裁剪
    // 用宽曝光范围避免 clamp 干扰断言
    const ev = histogramToExposure(h, {
      lowPercentile: 50,
      highPercentile: 50,
      minExposure: -16,
      maxExposure: 16,
    });
    const midBin = Math.floor(NUM_HISTOGRAM_BINS / 2);
    expect(ev).toBeCloseTo(binToEV100(midBin), 4);
  });

  it('自定义 minExposure/maxExposure clamp 目标曝光', () => {
    // 极端亮图像(HDR Float32)
    const pixels = new Float32Array(4 * 4 * 4).fill(64.0); // L=64 → EV=9
    const h = computeHistogram(pixels, 4, 4, { downsample: 1 });
    const ev = histogramToExposure(h, { minExposure: -2, maxExposure: 2 });
    expect(ev).toBe(2); // clamp 到 maxExposure
  });
});

// ── adaptExposure ───────────────────────────────────────────────────

describe('adaptExposure', () => {
  it('dt=0 → 当前曝光不变', () => {
    const result = adaptExposure(0, 4, 0, 3, 1);
    expect(result).toBe(0);
  });

  it('dt<0 → 当前曝光不变(防异常)', () => {
    const result = adaptExposure(0, 4, -0.1, 3, 1);
    expect(result).toBe(0);
  });

  it('target > current(变亮)用 speedUp', () => {
    // factor = 1 - exp(-dt*speedUp) = 1 - exp(-1*3) ≈ 0.9502
    const result = adaptExposure(0, 4, 1.0, 3.0, 1.0);
    const expectedFactor = 1 - Math.exp(-3.0);
    expect(result).toBeCloseTo(0 + 4 * expectedFactor, 4);
  });

  it('target < current(变暗)用 speedDown', () => {
    // factor = 1 - exp(-dt*speedDown) = 1 - exp(-1*1) ≈ 0.6321
    const result = adaptExposure(4, 0, 1.0, 3.0, 1.0);
    const expectedFactor = 1 - Math.exp(-1.0);
    expect(result).toBeCloseTo(4 + (0 - 4) * expectedFactor, 4);
  });

  it('变亮比变暗更快(speedUp > speedDown)', () => {
    const dt = 0.5;
    const speedUp = 3.0;
    const speedDown = 1.0;
    // 从 0 → 4(变亮)
    const upResult = adaptExposure(0, 4, dt, speedUp, speedDown);
    // 从 4 → 0(变暗)
    const downResult = adaptExposure(4, 0, dt, speedUp, speedDown);
    // 变亮移动距离更大
    const upMove = Math.abs(upResult - 0);
    const downMove = Math.abs(downResult - 4);
    expect(upMove).toBeGreaterThan(downMove);
  });

  it('当前 = 目标 → 不变', () => {
    const result = adaptExposure(2.5, 2.5, 1.0, 3.0, 1.0);
    expect(result).toBeCloseTo(2.5, 10);
  });

  it('长时间适应后接近目标', () => {
    let current = 0;
    const target = 4;
    // 60 帧 × dt=0.1 = 6 秒
    for (let i = 0; i < 60; i++) {
      current = adaptExposure(current, target, 0.1, 3.0, 1.0);
    }
    expect(current).toBeCloseTo(target, 2);
  });

  it('默认 speedUp=3 speedDown=1', () => {
    // 不传 speed 参数,使用默认值
    const result = adaptExposure(0, 4, 1.0);
    const expectedFactor = 1 - Math.exp(-3.0); // 默认 speedUp
    expect(result).toBeCloseTo(4 * expectedFactor, 4);
  });
});

// ── LuminanceHistogram 类 ───────────────────────────────────────────

describe('LuminanceHistogram class', () => {
  it('构造函数初始化默认曝光为范围中点', () => {
    const meter = new LuminanceHistogram({ minExposure: -4, maxExposure: 4 });
    expect(meter.currentExposure).toBe(0); // (−4+4)/2 = 0
    expect(meter.targetExposure).toBe(0);
    expect(meter.lastHistogram).toBeNull();
  });

  it('自定义范围初始化曝光', () => {
    const meter = new LuminanceHistogram({ minExposure: -2, maxExposure: 6 });
    expect(meter.currentExposure).toBe(2); // (−2+6)/2 = 2
  });

  it('默认选项(minExposure=-4, maxExposure=4)', () => {
    const meter = new LuminanceHistogram();
    expect(meter.currentExposure).toBe(0);
    expect(meter.getOptions().minExposure).toBeUndefined();
  });

  it('update() 返回当前适应曝光并更新内部状态', () => {
    const meter = new LuminanceHistogram({ minExposure: -4, maxExposure: 4 });
    const pixels = new Uint8Array(8 * 8 * 4).fill(255); // 白色
    const ev = meter.update(pixels, 8, 8, 0.1);
    // 应朝目标(EV≈3)移动,但未完全到达
    expect(ev).toBeGreaterThan(0);
    expect(ev).toBeLessThan(3);
    expect(meter.targetExposure).toBeCloseTo(3.0, 1);
    expect(meter.lastHistogram).not.toBeNull();
    expect(meter.lastHistogram?.totalCount).toBeGreaterThan(0);
  });

  it('连续 update() 多帧后收敛到目标', () => {
    const meter = new LuminanceHistogram({
      minExposure: -4,
      maxExposure: 4,
      speedUp: 5.0,
    });
    const pixels = new Uint8Array(8 * 8 * 4).fill(255);
    let lastEv = meter.currentExposure;
    for (let i = 0; i < 100; i++) {
      const ev = meter.update(pixels, 8, 8, 0.05);
      expect(ev).toBeGreaterThanOrEqual(lastEv); // 单调递增(变亮)
      lastEv = ev;
    }
    // 收敛到目标 ≈ 3
    expect(lastEv).toBeCloseTo(3.0, 1);
  });

  it('setOptions 更新选项', () => {
    const meter = new LuminanceHistogram();
    meter.setOptions({ speedUp: 5.0, minExposure: -2 });
    const opts = meter.getOptions();
    expect(opts.speedUp).toBe(5.0);
    expect(opts.minExposure).toBe(-2);
  });

  it('setExposure 重置当前和目标曝光', () => {
    const meter = new LuminanceHistogram({ minExposure: -4, maxExposure: 4 });
    meter.setExposure(2.5);
    expect(meter.currentExposure).toBe(2.5);
    expect(meter.targetExposure).toBe(2.5);
  });

  it('setExposure 后 update 从新曝光开始适应', () => {
    const meter = new LuminanceHistogram({ minExposure: -4, maxExposure: 4 });
    meter.setExposure(-3); // 强制暗曝光
    const pixels = new Uint8Array(8 * 8 * 4).fill(255); // 白色场景
    const ev = meter.update(pixels, 8, 8, 0.1);
    // 从 -3 朝 +3 移动
    expect(ev).toBeGreaterThan(-3);
    expect(ev).toBeLessThan(3);
  });

  it('Float32 HDR 输入工作正常', () => {
    const meter = new LuminanceHistogram({
      minExposure: -8,
      maxExposure: 16,
    });
    // 极亮 HDR 场景(L=64 → EV=9)
    const pixels = new Float32Array(8 * 8 * 4).fill(64.0);
    const ev = meter.update(pixels, 8, 8, 0.1);
    expect(ev).toBeGreaterThan(0);
    expect(meter.targetExposure).toBeCloseTo(9.0, 1);
  });

  it('downsample 选项影响性能但不变结果(相同亮度)', () => {
    const meter1 = new LuminanceHistogram({ downsample: 1 });
    const meter2 = new LuminanceHistogram({ downsample: 4 });
    const pixels = new Uint8Array(16 * 16 * 4).fill(255);
    meter1.update(pixels, 16, 16, 0.0); // dt=0 不适应
    meter2.update(pixels, 16, 16, 0.0);
    // 目标曝光应相同(同亮度)
    expect(meter1.targetExposure).toBeCloseTo(meter2.targetExposure, 6);
    // 但采样数不同
    expect(meter1.lastHistogram?.totalCount).toBe(256);
    expect(meter2.lastHistogram?.totalCount).toBe(16);
  });

  it('多次 update 切换场景(亮→暗)使用 speedDown', () => {
    const meter = new LuminanceHistogram({
      minExposure: -4,
      maxExposure: 4,
      speedUp: 10.0,
      speedDown: 0.5,
    });
    // 亮场景
    const brightPixels = new Uint8Array(8 * 8 * 4).fill(255);
    for (let i = 0; i < 30; i++) meter.update(brightPixels, 8, 8, 0.05);
    const brightExposure = meter.currentExposure;
    expect(brightExposure).toBeCloseTo(3.0, 1);

    // 切换到暗场景
    const darkPixels = new Uint8Array(8 * 8 * 4).fill(0);
    meter.update(darkPixels, 8, 8, 0.05);
    // 由于 speedDown 慢,曝光下降幅度小
    const afterOneFrame = meter.currentExposure;
    expect(afterOneFrame).toBeLessThan(brightExposure);
    expect(afterOneFrame).toBeGreaterThan(2); // 慢适应,还很高

    // 多帧后逐步下降
    for (let i = 0; i < 100; i++) meter.update(darkPixels, 8, 8, 0.05);
    expect(meter.currentExposure).toBeLessThan(0);
  });
});
