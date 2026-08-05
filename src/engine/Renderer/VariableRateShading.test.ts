import { describe, it, expect } from 'vitest';
import {
  ShadingRate,
  shadingRateCoverage,
  shadingRateHStep,
  shadingRateVStep,
  shadingRateName,
  ALL_SHADING_RATES,
  createVRSImage,
  getTileRate,
  setTileRate,
  pixelToTile,
  getPixelRate,
  computeVRSStats,
  classifyMotionVRS,
  classifyDepthVRS,
  classifyFoveatedVRS,
  classifyLuminanceVRS,
  VRSTileClassifier,
  compositeMultiResolution,
  VRS_PRESETS,
} from './VariableRateShading';

// ── 测试辅助 ─────────────────────────────────────────────────────

/** 创建全零速度缓冲。 */
function makeZeroVelocity(w: number, h: number): Float32Array {
  return new Float32Array(w * h * 2);
}

/** 创建均匀深度缓冲。 */
function makeFlatDepth(w: number, h: number, value: number = 0.5): Float32Array {
  return new Float32Array(w * h).fill(value);
}

/** 创建均匀颜色缓冲。 */
function makeFlatColor(w: number, h: number, r: number, g: number, b: number): Float32Array {
  const buf = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 1;
  }
  return buf;
}

/** 在指定区域填入速度。 */
function setVelocityRegion(
  vel: Float32Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  vx: number,
  vy: number,
): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * w + x) * 2;
      vel[idx] = vx;
      vel[idx + 1] = vy;
    }
  }
}

// ── ShadingRate 枚举与工具函数 ───────────────────────────────────

describe('ShadingRate', () => {
  it('Full = 0, Sixteenth4x4 = 6(递增)', () => {
    expect(ShadingRate.Full).toBe(0);
    expect(ShadingRate.Vertical2x).toBe(1);
    expect(ShadingRate.Horizontal2x).toBe(2);
    expect(ShadingRate.Quarter2x2).toBe(3);
    expect(ShadingRate.Eighth2x4).toBe(4);
    expect(ShadingRate.Eighth4x2).toBe(5);
    expect(ShadingRate.Sixteenth4x4).toBe(6);
  });

  it('ALL_SHADING_RATES 包含全部 7 种速率', () => {
    expect(ALL_SHADING_RATES.length).toBe(7);
    expect(ALL_SHADING_RATES).toContain(ShadingRate.Full);
    expect(ALL_SHADING_RATES).toContain(ShadingRate.Sixteenth4x4);
  });
});

describe('shadingRateCoverage', () => {
  it('Full 覆盖率 = 1', () => {
    expect(shadingRateCoverage(ShadingRate.Full)).toBe(1);
  });

  it('Quarter2x2 覆盖率 = 0.25', () => {
    expect(shadingRateCoverage(ShadingRate.Quarter2x2)).toBe(0.25);
  });

  it('Sixteenth4x4 覆盖率 = 1/16', () => {
    expect(shadingRateCoverage(ShadingRate.Sixteenth4x4)).toBeCloseTo(1 / 16, 4);
  });

  it('1x2 和 2x1 覆盖率均为 0.5', () => {
    expect(shadingRateCoverage(ShadingRate.Vertical2x)).toBe(0.5);
    expect(shadingRateCoverage(ShadingRate.Horizontal2x)).toBe(0.5);
  });

  it('2x4 和 4x2 覆盖率均为 1/8', () => {
    expect(shadingRateCoverage(ShadingRate.Eighth2x4)).toBeCloseTo(1 / 8, 4);
    expect(shadingRateCoverage(ShadingRate.Eighth4x2)).toBeCloseTo(1 / 8, 4);
  });
});

describe('shadingRateHStep / shadingRateVStep', () => {
  it('Full: h=1, v=1', () => {
    expect(shadingRateHStep(ShadingRate.Full)).toBe(1);
    expect(shadingRateVStep(ShadingRate.Full)).toBe(1);
  });

  it('Quarter2x2: h=2, v=2', () => {
    expect(shadingRateHStep(ShadingRate.Quarter2x2)).toBe(2);
    expect(shadingRateVStep(ShadingRate.Quarter2x2)).toBe(2);
  });

  it('Sixteenth4x4: h=4, v=4', () => {
    expect(shadingRateHStep(ShadingRate.Sixteenth4x4)).toBe(4);
    expect(shadingRateVStep(ShadingRate.Sixteenth4x4)).toBe(4);
  });

  it('Vertical2x: h=1, v=2(水平全分辨率,垂直每 2 像素)', () => {
    expect(shadingRateHStep(ShadingRate.Vertical2x)).toBe(1);
    expect(shadingRateVStep(ShadingRate.Vertical2x)).toBe(2);
  });

  it('Horizontal2x: h=2, v=1(水平每 2 像素,垂直全分辨率)', () => {
    expect(shadingRateHStep(ShadingRate.Horizontal2x)).toBe(2);
    expect(shadingRateVStep(ShadingRate.Horizontal2x)).toBe(1);
  });
});

describe('shadingRateName', () => {
  it('返回正确的速率名称', () => {
    expect(shadingRateName(ShadingRate.Full)).toBe('1x1');
    expect(shadingRateName(ShadingRate.Quarter2x2)).toBe('2x2');
    expect(shadingRateName(ShadingRate.Sixteenth4x4)).toBe('4x4');
    expect(shadingRateName(ShadingRate.Vertical2x)).toBe('1x2');
    expect(shadingRateName(ShadingRate.Horizontal2x)).toBe('2x1');
    expect(shadingRateName(ShadingRate.Eighth2x4)).toBe('2x4');
    expect(shadingRateName(ShadingRate.Eighth4x2)).toBe('4x2');
  });
});

// ── VRSImage ─────────────────────────────────────────────────────

describe('VRSImage', () => {
  it('createVRSImage: 正确计算瓦片数', () => {
    const img = createVRSImage(1920, 1080, 16);
    expect(img.tileSize).toBe(16);
    expect(img.width).toBe(120); // 1920 / 16
    expect(img.height).toBe(68); // ceil(1080 / 16) = 67.5 → 68
    expect(img.data.length).toBe(120 * 68);
  });

  it('createVRSImage: 默认填充 Full 速率', () => {
    const img = createVRSImage(64, 64, 16);
    for (let i = 0; i < img.data.length; i++) {
      expect(img.data[i]).toBe(ShadingRate.Full);
    }
  });

  it('createVRSImage: 支持自定义填充速率', () => {
    const img = createVRSImage(64, 64, 16, ShadingRate.Quarter2x2);
    for (let i = 0; i < img.data.length; i++) {
      expect(img.data[i]).toBe(ShadingRate.Quarter2x2);
    }
  });

  it('getTileRate / setTileRate: 读写正确', () => {
    const img = createVRSImage(64, 64, 16);
    setTileRate(img, 0, 0, ShadingRate.Quarter2x2);
    setTileRate(img, 3, 2, ShadingRate.Sixteenth4x4);
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Quarter2x2);
    expect(getTileRate(img, 3, 2)).toBe(ShadingRate.Sixteenth4x4);
    // 未设置的瓦片仍为 Full
    expect(getTileRate(img, 1, 1)).toBe(ShadingRate.Full);
  });

  it('getTileRate: 越界返回 Full', () => {
    const img = createVRSImage(64, 64, 16);
    expect(getTileRate(img, -1, 0)).toBe(ShadingRate.Full);
    expect(getTileRate(img, 0, -1)).toBe(ShadingRate.Full);
    expect(getTileRate(img, 999, 999)).toBe(ShadingRate.Full);
  });

  it('setTileRate: 越界不抛错(静默忽略)', () => {
    const img = createVRSImage(64, 64, 16);
    expect(() => setTileRate(img, -1, 0, ShadingRate.Quarter2x2)).not.toThrow();
    expect(() => setTileRate(img, 999, 999, ShadingRate.Sixteenth4x4)).not.toThrow();
  });

  it('pixelToTile: 正确映射像素到瓦片', () => {
    const img = createVRSImage(64, 64, 16);
    expect(pixelToTile(img, 0, 0)).toEqual([0, 0]);
    expect(pixelToTile(img, 15, 15)).toEqual([0, 0]);
    expect(pixelToTile(img, 16, 16)).toEqual([1, 1]);
    expect(pixelToTile(img, 31, 31)).toEqual([1, 1]);
    expect(pixelToTile(img, 32, 32)).toEqual([2, 2]);
  });

  it('getPixelRate: 返回像素所在瓦片的速率', () => {
    const img = createVRSImage(64, 64, 16);
    setTileRate(img, 1, 1, ShadingRate.Quarter2x2);
    // 像素 (16,16) 在瓦片 (1,1)
    expect(getPixelRate(img, 16, 16)).toBe(ShadingRate.Quarter2x2);
    expect(getPixelRate(img, 31, 31)).toBe(ShadingRate.Quarter2x2);
    // 像素 (0,0) 在瓦片 (0,0) = Full
    expect(getPixelRate(img, 0, 0)).toBe(ShadingRate.Full);
  });
});

// ── computeVRSStats ──────────────────────────────────────────────

describe('computeVRSStats', () => {
  it('全 Full 图像:平均覆盖率 = 1,节省 = 0', () => {
    const img = createVRSImage(64, 64, 16);
    const stats = computeVRSStats(img);
    expect(stats.totalTiles).toBe(16); // 4×4 瓦片
    expect(stats.averageCoverage).toBe(1);
    expect(stats.pixelShadingSavings).toBe(0);
    expect(stats.distribution['1x1']).toBe(16);
  });

  it('全 Quarter2x2 图像:平均覆盖率 = 0.25,节省 = 0.75', () => {
    const img = createVRSImage(64, 64, 16, ShadingRate.Quarter2x2);
    const stats = computeVRSStats(img);
    expect(stats.averageCoverage).toBe(0.25);
    expect(stats.pixelShadingSavings).toBe(0.75);
    expect(stats.distribution['2x2']).toBe(16);
  });

  it('混合速率:统计正确', () => {
    const img = createVRSImage(64, 64, 16);
    // 4×4 = 16 瓦片
    // 8 个 Full, 4 个 2x2, 4 个 4x4
    for (let i = 0; i < 8; i++) img.data[i] = ShadingRate.Full;
    for (let i = 8; i < 12; i++) img.data[i] = ShadingRate.Quarter2x2;
    for (let i = 12; i < 16; i++) img.data[i] = ShadingRate.Sixteenth4x4;
    const stats = computeVRSStats(img);
    expect(stats.distribution['1x1']).toBe(8);
    expect(stats.distribution['2x2']).toBe(4);
    expect(stats.distribution['4x4']).toBe(4);
    // avgCoverage = (8*1 + 4*0.25 + 4*0.0625) / 16
    const expected = (8 * 1 + 4 * 0.25 + 4 * (1 / 16)) / 16;
    expect(stats.averageCoverage).toBeCloseTo(expected, 4);
  });
});

// ── classifyMotionVRS ────────────────────────────────────────────

describe('classifyMotionVRS', () => {
  it('零速度 → 全 Full', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const vel = makeZeroVelocity(w, h);
    classifyMotionVRS(img, vel, w, h);
    for (let i = 0; i < img.data.length; i++) {
      expect(img.data[i]).toBe(ShadingRate.Full);
    }
  });

  it('高速度区域 → 降低速率', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const vel = makeZeroVelocity(w, h);
    // 在左上角 16×16 像素(瓦片 0,0)设置高速度
    setVelocityRegion(vel, w, 0, 0, 16, 16, 10, 10);
    classifyMotionVRS(img, vel, w, h, { motionThreshold: 2, maxRate: ShadingRate.Sixteenth4x4 });
    // 瓦片 (0,0) 应被降低
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Sixteenth4x4);
    // 其他瓦片仍为 Full
    expect(getTileRate(img, 1, 1)).toBe(ShadingRate.Full);
  });

  it('中等速度 → 中等速率', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const vel = makeZeroVelocity(w, h);
    // 速度 = 3(阈值 2,2×阈值 = 4,3 在 2~4 之间 → Quarter2x2)
    setVelocityRegion(vel, w, 0, 0, 16, 16, 3, 0);
    classifyMotionVRS(img, vel, w, h, { motionThreshold: 2, maxRate: ShadingRate.Sixteenth4x4 });
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Quarter2x2);
  });

  it('maxRate 限制最大降低级别', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const vel = makeZeroVelocity(w, h);
    setVelocityRegion(vel, w, 0, 0, 16, 16, 100, 100);
    classifyMotionVRS(img, vel, w, h, { motionThreshold: 2, maxRate: ShadingRate.Quarter2x2 });
    // 即使速度极高,也不超过 maxRate
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Quarter2x2);
  });
});

// ── classifyDepthVRS ─────────────────────────────────────────────

describe('classifyDepthVRS', () => {
  it('均匀深度 → 降低速率(平坦表面)', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const depth = makeFlatDepth(w, h, 0.5);
    classifyDepthVRS(img, depth, w, h, {
      gradientThreshold: 0.001,
      maxRate: ShadingRate.Quarter2x2,
    });
    // 均匀深度 = 梯度为 0 < 阈值 → 降低
    for (let i = 0; i < img.data.length; i++) {
      expect(img.data[i]).toBe(ShadingRate.Quarter2x2);
    }
  });

  it('高梯度区域 → Full(边缘/几何体)', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const depth = makeFlatDepth(w, h, 0.5);
    // 在瓦片 (0,0) 内制造大梯度
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        depth[y * w + x] = (x / 16) * 0.5; // 0 → 0.5 大梯度
      }
    }
    classifyDepthVRS(img, depth, w, h, {
      gradientThreshold: 0.001,
      maxRate: ShadingRate.Quarter2x2,
    });
    // 瓦片 (0,0) 有大梯度 → Full
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Full);
    // 其他瓦片平坦 → 降低
    expect(getTileRate(img, 1, 1)).toBe(ShadingRate.Quarter2x2);
  });

  it('maxRate 限制最大降低级别', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const depth = makeFlatDepth(w, h, 0.5);
    classifyDepthVRS(img, depth, w, h, {
      gradientThreshold: 0.001,
      maxRate: ShadingRate.Quarter2x2,
    });
    // 均匀深度 → 不超过 Quarter2x2
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Quarter2x2);
    expect(getTileRate(img, 0, 0)).not.toBe(ShadingRate.Sixteenth4x4);
  });
});

// ── classifyFoveatedVRS ──────────────────────────────────────────

describe('classifyFoveatedVRS', () => {
  it('中心区域 → Full', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    // 注视点在屏幕中心 (32, 32)
    classifyFoveatedVRS(img, 32, 32, {
      innerRadius: 16,
      outerRadius: 48,
      maxRate: ShadingRate.Sixteenth4x4,
    });
    // 瓦片 (2,2) 包含像素 (32,32),在 innerRadius 内
    expect(getTileRate(img, 2, 2)).toBe(ShadingRate.Full);
  });

  it('外围区域 → maxRate', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    classifyFoveatedVRS(img, 32, 32, {
      innerRadius: 16,
      outerRadius: 32,
      maxRate: ShadingRate.Sixteenth4x4,
    });
    // 角落瓦片 (0,0) 离中心很远
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Sixteenth4x4);
  });

  it('内半径 = 0 时无全速率区域', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    classifyFoveatedVRS(img, 32, 32, {
      innerRadius: 0,
      outerRadius: 16,
      maxRate: ShadingRate.Sixteenth4x4,
    });
    // innerRadius=0 → 所有瓦片都不在 "全速率" 区域
    // 至少有一些瓦片不是 Full
    let hasNonFull = false;
    for (let i = 0; i < img.data.length; i++) {
      if (img.data[i] !== ShadingRate.Full) {
        hasNonFull = true;
        break;
      }
    }
    expect(hasNonFull).toBe(true);
  });

  it('外半径 = 较大时角落在过渡区(非 maxRate 非 Full)', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    // 使用 outerRadius=100,使角落瓦片在过渡区(t≈0.21 → level=1)
    classifyFoveatedVRS(img, 32, 32, {
      innerRadius: 16,
      outerRadius: 100,
      maxRate: ShadingRate.Sixteenth4x4,
    });
    // 中心瓦片 Full
    expect(getTileRate(img, 2, 2)).toBe(ShadingRate.Full);
    // 角落在过渡区(不是 maxRate 也不是 Full)
    expect(getTileRate(img, 0, 0)).toBeLessThan(ShadingRate.Sixteenth4x4);
    expect(getTileRate(img, 0, 0)).toBeGreaterThan(ShadingRate.Full);
  });
});

// ── classifyLuminanceVRS ─────────────────────────────────────────

describe('classifyLuminanceVRS', () => {
  it('均匀颜色 → 降低速率(低对比度)', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const color = makeFlatColor(w, h, 0.5, 0.5, 0.5);
    classifyLuminanceVRS(img, color, w, h, {
      varianceThreshold: 0.001,
      maxRate: ShadingRate.Quarter2x2,
    });
    for (let i = 0; i < img.data.length; i++) {
      expect(img.data[i]).toBe(ShadingRate.Quarter2x2);
    }
  });

  it('高对比度区域 → Full', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const color = makeFlatColor(w, h, 0.5, 0.5, 0.5);
    // 在瓦片 (0,0) 内制造高对比度
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const idx = (y * w + x) * 4;
        if (x < 8) {
          color[idx] = 0;
          color[idx + 1] = 0;
          color[idx + 2] = 0;
        } else {
          color[idx] = 1;
          color[idx + 1] = 1;
          color[idx + 2] = 1;
        }
      }
    }
    classifyLuminanceVRS(img, color, w, h, {
      varianceThreshold: 0.001,
      maxRate: ShadingRate.Quarter2x2,
    });
    // 瓦片 (0,0) 高对比度 → Full
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Full);
    // 其他瓦片均匀 → 降低
    expect(getTileRate(img, 1, 1)).toBe(ShadingRate.Quarter2x2);
  });

  it('maxRate 限制最大降低级别', () => {
    const w = 64, h = 64;
    const img = createVRSImage(w, h, 16);
    const color = makeFlatColor(w, h, 0.5, 0.5, 0.5);
    classifyLuminanceVRS(img, color, w, h, {
      varianceThreshold: 0.001,
      maxRate: ShadingRate.Quarter2x2,
    });
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Quarter2x2);
    expect(getTileRate(img, 0, 0)).not.toBe(ShadingRate.Sixteenth4x4);
  });
});

// ── VRSTileClassifier(多策略组合)──────────────────────────────

describe('VRSTileClassifier', () => {
  it('单策略:与直接调用一致', () => {
    const w = 64, h = 64;
    const classifier = new VRSTileClassifier();
    classifier.addStrategy('foveated', (output) => {
      classifyFoveatedVRS(output, 32, 32, {
        innerRadius: 16,
        outerRadius: 48,
        maxRate: ShadingRate.Sixteenth4x4,
      });
    });

    const img1 = createVRSImage(w, h, 16);
    classifier.classify(img1);

    const img2 = createVRSImage(w, h, 16);
    classifyFoveatedVRS(img2, 32, 32, {
      innerRadius: 16,
      outerRadius: 48,
      maxRate: ShadingRate.Sixteenth4x4,
    });

    for (let i = 0; i < img1.data.length; i++) {
      expect(img1.data[i]).toBe(img2.data[i]);
    }
  });

  it('多策略:取最保守(最高)速率', () => {
    const w = 64, h = 64;
    const classifier = new VRSTileClassifier();

    // 策略 A:全 4x4(激进降低)
    classifier.addStrategy('aggressive', (output) => {
      for (let i = 0; i < output.data.length; i++) {
        output.data[i] = ShadingRate.Sixteenth4x4;
      }
    });

    // 策略 B:全 Full(保守)
    classifier.addStrategy('conservative', (output) => {
      for (let i = 0; i < output.data.length; i++) {
        output.data[i] = ShadingRate.Full;
      }
    });

    const img = createVRSImage(w, h, 16);
    classifier.classify(img);

    // 取保守值 = Full(0)< 4x4(6),min = 0 = Full
    for (let i = 0; i < img.data.length; i++) {
      expect(img.data[i]).toBe(ShadingRate.Full);
    }
  });

  it('多策略:部分区域保守,部分激进', () => {
    const w = 64, h = 64;
    const classifier = new VRSTileClassifier();

    // 策略 A:瓦片 (0,0) = Full,其余 = 4x4
    classifier.addStrategy('a', (output) => {
      for (let i = 0; i < output.data.length; i++) {
        output.data[i] = ShadingRate.Sixteenth4x4;
      }
      setTileRate(output, 0, 0, ShadingRate.Full);
    });

    // 策略 B:瓦片 (0,0) = 4x4,其余 = Full
    classifier.addStrategy('b', (output) => {
      for (let i = 0; i < output.data.length; i++) {
        output.data[i] = ShadingRate.Full;
      }
      setTileRate(output, 0, 0, ShadingRate.Sixteenth4x4);
    });

    const img = createVRSImage(w, h, 16);
    classifier.classify(img);

    // 瓦片 (0,0):策略 A 说 Full,策略 B 说 4x4 → 取保守 = Full
    expect(getTileRate(img, 0, 0)).toBe(ShadingRate.Full);
    // 其余瓦片:策略 A 说 4x4,策略 B 说 Full → 取保守 = Full
    expect(getTileRate(img, 1, 1)).toBe(ShadingRate.Full);
  });

  it('removeStrategy / clearStrategies / getStrategyNames', () => {
    const classifier = new VRSTileClassifier();
    classifier.addStrategy('a', () => {});
    classifier.addStrategy('b', () => {});
    expect(classifier.getStrategyNames().sort()).toEqual(['a', 'b']);

    classifier.removeStrategy('a');
    expect(classifier.getStrategyNames()).toEqual(['b']);

    classifier.clearStrategies();
    expect(classifier.getStrategyNames()).toEqual([]);
  });
});

// ── compositeMultiResolution ─────────────────────────────────────

describe('compositeMultiResolution', () => {
  it('Full 速率瓦片使用高分辨率颜色', () => {
    const w = 16, h = 16;
    const img = createVRSImage(w, h, 16, ShadingRate.Full);
    const high = makeFlatColor(w, h, 1, 0, 0); // 红色
    const low = makeFlatColor(8, 8, 0, 1, 0); // 绿色(低分辨率)
    const out = new Float32Array(w * h * 4);

    compositeMultiResolution(out, high, low, 8, 8, img, w, h);

    // 所有像素应为红色(高分辨率)
    for (let i = 0; i < w * h; i++) {
      expect(out[i * 4]).toBe(1); // R
      expect(out[i * 4 + 1]).toBe(0); // G
    }
  });

  it('Quarter2x2 速率瓦片使用低分辨率颜色', () => {
    const w = 16, h = 16;
    const img = createVRSImage(w, h, 16, ShadingRate.Quarter2x2);
    const high = makeFlatColor(w, h, 1, 0, 0); // 红色
    const low = makeFlatColor(8, 8, 0, 1, 0); // 绿色(低分辨率)
    const out = new Float32Array(w * h * 4);

    compositeMultiResolution(out, high, low, 8, 8, img, w, h);

    // 所有像素应为绿色(低分辨率)
    for (let i = 0; i < w * h; i++) {
      expect(out[i * 4]).toBe(0); // R
      expect(out[i * 4 + 1]).toBe(1); // G
    }
  });

  it('混合速率:Full 用高分辨率,降低用低分辨率', () => {
    const w = 32, h = 32;
    const img = createVRSImage(w, h, 16);
    // 瓦片 (0,0) = Full,瓦片 (1,0) = Quarter2x2
    setTileRate(img, 0, 0, ShadingRate.Full);
    setTileRate(img, 1, 0, ShadingRate.Quarter2x2);

    const high = makeFlatColor(w, h, 1, 0, 0); // 红色
    const low = makeFlatColor(16, 16, 0, 1, 0); // 绿色
    const out = new Float32Array(w * h * 4);

    compositeMultiResolution(out, high, low, 16, 16, img, w, h);

    // 像素 (0, 0) 在瓦片 (0,0) = Full → 红色
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(0);
    // 像素 (16, 0) 在瓦片 (1,0) = Quarter2x2 → 绿色
    const idx = (0 * w + 16) * 4;
    expect(out[idx]).toBe(0);
    expect(out[idx + 1]).toBe(1);
  });
});

// ── VRS_PRESETS ──────────────────────────────────────────────────

describe('VRS_PRESETS', () => {
  it('performance 预设:激进参数', () => {
    const p = VRS_PRESETS.performance;
    expect(p.motion.maxRate).toBe(ShadingRate.Sixteenth4x4);
    expect(p.foveated.maxRate).toBe(ShadingRate.Sixteenth4x4);
    expect(p.motion.motionThreshold).toBeLessThan(VRS_PRESETS.balanced.motion.motionThreshold);
  });

  it('balanced 预设:中等参数', () => {
    const p = VRS_PRESETS.balanced;
    expect(p.motion.maxRate).toBe(ShadingRate.Quarter2x2);
    expect(p.depth.maxRate).toBe(ShadingRate.Quarter2x2);
  });

  it('quality 预设:保守参数', () => {
    const p = VRS_PRESETS.quality;
    expect(p.motion.maxRate).toBe(ShadingRate.Quarter2x2);
    expect(p.motion.motionThreshold).toBeGreaterThan(VRS_PRESETS.balanced.motion.motionThreshold);
    expect(p.foveated.innerRadius).toBeGreaterThan(VRS_PRESETS.balanced.foveated.innerRadius);
  });

  it('vr 预设:注视点优先', () => {
    const p = VRS_PRESETS.vr;
    expect(p.foveated.innerRadius).toBeLessThan(VRS_PRESETS.balanced.foveated.innerRadius);
    expect(p.foveated.maxRate).toBe(ShadingRate.Sixteenth4x4);
    expect(p.motion.motionThreshold).toBeLessThan(VRS_PRESETS.balanced.motion.motionThreshold);
  });

  it('所有预设包含 motion/depth/foveated/luminance 四个策略', () => {
    const presets = [VRS_PRESETS.performance, VRS_PRESETS.balanced, VRS_PRESETS.quality, VRS_PRESETS.vr];
    for (const p of presets) {
      expect(p.motion).toBeDefined();
      expect(p.depth).toBeDefined();
      expect(p.foveated).toBeDefined();
      expect(p.luminance).toBeDefined();
    }
  });
});
