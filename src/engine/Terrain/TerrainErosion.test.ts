import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainErosion } from './TerrainErosion';
import { HeightmapGenerator } from './HeightmapGenerator';

function makePeak(width: number, height: number, peakValue = 1): Float32Array {
  // 中央一个尖峰,其余为 0;适合验证侵蚀会把尖峰摊平
  const map = new Float32Array(width * height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      map[y * width + x] = Math.max(0, peakValue - d * 0.1);
    }
  }
  return map;
}

function maxAbs(arr: Float32Array): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) {
    const a = Math.abs(arr[i]);
    if (a > m) m = a;
  }
  return m;
}

function sumAbs(arr: Float32Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]);
  return s;
}

describe('TerrainErosion', () => {
  let erosion: TerrainErosion;

  beforeEach(() => {
    erosion = new TerrainErosion();
  });

  describe('setHeightmap / getHeightmap', () => {
    it('设置后内部缓冲与输入数据一致(且不共享引用)', () => {
      const data = new Float32Array([0, 0.5, 0.5, 1]);
      erosion.setHeightmap(data, 2, 2);
      const out = erosion.getHeightmap();
      expect(out.length).toBe(4);
      expect(Array.from(out)).toEqual([0, 0.5, 0.5, 1]);
      // 修改原始数据不应影响内部缓冲
      data[0] = 0.9;
      expect(erosion.getHeightmap()[0]).toBe(0);
    });

    it('尺寸不匹配时抛错', () => {
      expect(() => erosion.setHeightmap(new Float32Array(3), 2, 2)).toThrow();
    });

    it('erosionMap 初始化为零', () => {
      erosion.setHeightmap(new Float32Array(4), 2, 2);
      const m = erosion.getErosionMap();
      expect(m.length).toBe(4);
      for (let i = 0; i < m.length; i++) expect(m[i]).toBe(0);
    });
  });

  describe('applyThermalErosion', () => {
    it('使陡峭坡度松弛:峰值降低,邻居升高', () => {
      const w = 5, h = 5;
      const data = makePeak(w, h, 1);
      erosion.setHeightmap(data, w, h);
      erosion.talusAngle = 5;     // 极小阈值,任何坡都松弛
      erosion.thermalErosionRate = 1;
      erosion.iterations = 30;
      erosion.applyThermalErosion();

      const out = erosion.getHeightmap();
      // 中央峰值应明显下降
      const centerIdx = Math.floor(h / 2) * w + Math.floor(w / 2);
      expect(out[centerIdx]).toBeLessThan(data[centerIdx]);
      // 周围单元格(原本为 0)应升高
      const cornerIdx = 0;
      expect(out[cornerIdx]).toBeGreaterThan(data[cornerIdx]);
    });

    it('talusAngle=90 (阈值∞)时不发生侵蚀', () => {
      const data = makePeak(5, 5, 1);
      erosion.setHeightmap(data, 5, 5);
      erosion.talusAngle = 90;
      erosion.thermalErosionRate = 1;
      erosion.iterations = 10;
      erosion.applyThermalErosion();
      expect(maxAbs(erosion.getErosionMap())).toBe(0);
    });

    it('rate=0 时不发生侵蚀', () => {
      const data = makePeak(5, 5, 1);
      erosion.setHeightmap(data, 5, 5);
      erosion.talusAngle = 5;
      erosion.thermalErosionRate = 0;
      erosion.applyThermalErosion();
      expect(maxAbs(erosion.getErosionMap())).toBe(0);
    });

    it('erosionMap 总和接近 0(物质守恒)', () => {
      const data = makePeak(7, 7, 1);
      erosion.setHeightmap(data, 7, 7);
      erosion.talusAngle = 10;
      erosion.thermalErosionRate = 0.5;
      erosion.iterations = 20;
      erosion.applyThermalErosion();
      const stats = erosion.getStats();
      // 守恒允许浮点误差
      expect(Math.abs(stats.volumeChange)).toBeLessThan(1e-4);
    });

    it('未 setHeightmap 时抛错', () => {
      expect(() => erosion.applyThermalErosion()).toThrow();
    });
  });

  describe('applyHydraulicErosion', () => {
    it('对斜坡地形产生非零侵蚀图', () => {
      // 用 Perlin 噪声生成有起伏的地形,跑水力侵蚀
      const w = 32, h = 32;
      const data = HeightmapGenerator.fromPerlinNoise(w, h, 8, 4, 0.5, 42);
      erosion.setHeightmap(data, w, h);
      erosion.hydraulicErosionRate = 0.5;
      erosion.applyHydraulicErosion(1, 500);
      const stats = erosion.getStats();
      // 应有非零侵蚀
      expect(stats.maxErosion).toBeLessThan(0);
      expect(stats.maxDeposition).toBeGreaterThan(0);
    });

    it('drops=0 不修改地形', () => {
      const data = makePeak(5, 5, 1);
      erosion.setHeightmap(data, 5, 5);
      erosion.applyHydraulicErosion(1, 0);
      expect(maxAbs(erosion.getErosionMap())).toBe(0);
    });

    it('平坦地形不产生显著侵蚀', () => {
      // 全零地形:梯度处处为零,雨滴立即沉积,无显著变化
      const data = new Float32Array(10 * 10);
      erosion.setHeightmap(data, 10, 10);
      erosion.applyHydraulicErosion(1, 100);
      // 平坦地形下,雨滴采样梯度为 0 → 立即沉积,但 sediment 始终为 0 → 不沉积
      expect(maxAbs(erosion.getErosionMap())).toBeLessThan(1e-6);
    });

    it('多次调用结果是确定性的(同种子)', () => {
      const w = 16, h = 16;
      const data1 = HeightmapGenerator.fromPerlinNoise(w, h, 4, 4, 0.5, 7);
      const data2 = Float32Array.from(data1);
      const e1 = new TerrainErosion();
      const e2 = new TerrainErosion();
      e1.setHeightmap(data1, w, h);
      e2.setHeightmap(data2, w, h);
      e1.erode({ seed: 123, hydraulicDrops: 200, thermalIterations: 5 });
      e2.erode({ seed: 123, hydraulicDrops: 200, thermalIterations: 5 });
      const o1 = e1.getHeightmap();
      const o2 = e2.getHeightmap();
      for (let i = 0; i < o1.length; i++) {
        expect(o1[i]).toBeCloseTo(o2[i], 6);
      }
    });
  });

  describe('applyWindErosion', () => {
    it('沿 +X 方向搬运:右列升高,左列降低(下风方向)', () => {
      // 构造一个从左到右递减的斜坡
      const w = 5, h = 5;
      const data = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          data[y * w + x] = (w - x) / w; // 左高右低
        }
      }
      erosion.setHeightmap(data, w, h);
      erosion.windErosionRate = 1;
      erosion.iterations = 20;
      erosion.applyWindErosion({ x: 1, y: 0 }, 1);

      // 风从左吹向右:左侧应该被侵蚀,右侧应该沉积
      const out = erosion.getHeightmap();
      // 第 0 列某单元格应低于初始
      expect(out[2 * w + 0]).toBeLessThan(data[2 * w + 0]);
      // 最右列某单元格应高于初始
      expect(out[2 * w + (w - 1)]).toBeGreaterThan(data[2 * w + (w - 1)]);
    });

    it('零风向不侵蚀', () => {
      erosion.setHeightmap(makePeak(5, 5, 1), 5, 5);
      erosion.applyWindErosion({ x: 0, y: 0 }, 1);
      expect(maxAbs(erosion.getErosionMap())).toBe(0);
    });

    it('erosionMap 守恒', () => {
      const data = makePeak(7, 7, 1);
      erosion.setHeightmap(data, 7, 7);
      erosion.iterations = 10;
      erosion.applyWindErosion({ x: 0.7, y: 0.3 }, 0.8);
      const stats = erosion.getStats();
      expect(Math.abs(stats.volumeChange)).toBeLessThan(1e-4);
    });
  });

  describe('erode (综合)', () => {
    it('一次性应用三种侵蚀并产生统计', () => {
      const w = 24, h = 24;
      const data = HeightmapGenerator.fromPerlinNoise(w, h, 6, 4, 0.5, 99);
      erosion.setHeightmap(data, w, h);
      erosion.erode({
        thermalIterations: 5,
        hydraulicDrops: 300,
        windDirection: { x: 1, y: 0.3 },
        windStrength: 0.5,
        seed: 42,
      });
      const stats = erosion.getStats();
      expect(stats.cellCount).toBe(w * h);
      // 应有非零变化
      expect(stats.maxErosion).toBeLessThan(0);
      expect(stats.maxDeposition).toBeGreaterThan(0);
    });

    it('不带 windDirection 时跳过风力', () => {
      const w = 16, h = 16;
      const data = HeightmapGenerator.fromPerlinNoise(w, h, 4, 4, 0.5, 1);
      erosion.setHeightmap(data, w, h);
      // 不应抛错
      expect(() => erosion.erode({ seed: 1, hydraulicDrops: 50, thermalIterations: 3 })).not.toThrow();
    });
  });

  describe('smooth', () => {
    it('降低方差:平滑后极值减小', () => {
      const data = makePeak(7, 7, 1);
      erosion.setHeightmap(data, 7, 7);
      const beforeMax = Math.max(...Array.from(erosion.getHeightmap()));
      erosion.smooth(3);
      const afterMax = Math.max(...Array.from(erosion.getHeightmap()));
      expect(afterMax).toBeLessThan(beforeMax);
    });

    it('常数高度图平滑后保持不变', () => {
      const data = new Float32Array(9).fill(0.5);
      erosion.setHeightmap(data, 3, 3);
      erosion.smooth(5);
      const out = erosion.getHeightmap();
      for (let i = 0; i < out.length; i++) {
        expect(out[i]).toBeCloseTo(0.5, 6);
      }
    });
  });

  describe('getStats', () => {
    it('未侵蚀时返回零统计', () => {
      erosion.setHeightmap(new Float32Array(4), 2, 2);
      const stats = erosion.getStats();
      expect(stats.averageErosion).toBe(0);
      expect(stats.maxDeposition).toBe(0);
      expect(stats.maxErosion).toBe(0);
      expect(stats.volumeChange).toBe(0);
      expect(stats.cellCount).toBe(4);
    });

    it('热力侵蚀后 maxErosion < 0 且 maxDeposition > 0', () => {
      erosion.setHeightmap(makePeak(5, 5, 1), 5, 5);
      erosion.talusAngle = 5;
      erosion.thermalErosionRate = 1;
      erosion.iterations = 10;
      erosion.applyThermalErosion();
      const stats = erosion.getStats();
      expect(stats.maxErosion).toBeLessThan(0);
      expect(stats.maxDeposition).toBeGreaterThan(0);
      expect(stats.cellCount).toBe(25);
    });

    it('空 erosionMap 时返回 0', () => {
      const stats = new TerrainErosion().getStats();
      expect(stats.cellCount).toBe(0);
      expect(stats.averageErosion).toBe(0);
    });
  });

  describe('reset', () => {
    it('清零 erosionMap 但保留 heightmap', () => {
      erosion.setHeightmap(makePeak(5, 5, 1), 5, 5);
      erosion.talusAngle = 5;
      erosion.thermalErosionRate = 1;
      erosion.iterations = 10;
      erosion.applyThermalErosion();
      const before = erosion.getHeightmap();
      const beforeSum = sumAbs(erosion.getErosionMap());
      expect(beforeSum).toBeGreaterThan(0);

      erosion.reset();
      // erosionMap 清零
      expect(maxAbs(erosion.getErosionMap())).toBe(0);
      // heightmap 不变
      const after = erosion.getHeightmap();
      for (let i = 0; i < before.length; i++) {
        expect(after[i]).toBe(before[i]);
      }
    });
  });
});
