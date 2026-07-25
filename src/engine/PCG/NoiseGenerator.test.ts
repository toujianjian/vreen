import { describe, it, expect } from 'vitest';
import { NoiseGenerator } from './NoiseGenerator';

describe('NoiseGenerator', () => {
  describe('构造与种子', () => {
    it('默认种子 0 可构造', () => {
      const ng = new NoiseGenerator();
      expect(ng.getSeed()).toBe(0);
    });

    it('setSeed 重设种子', () => {
      const ng = new NoiseGenerator(1);
      expect(ng.getSeed()).toBe(1);
      ng.setSeed(42);
      expect(ng.getSeed()).toBe(42);
    });
  });

  describe('perlin2D', () => {
    it('输出范围 ≈ [-1.2, 1.2](Perlin 经典实现可能略超 [-1,1])', () => {
      const ng = new NoiseGenerator(42);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 200; i++) {
        const v = ng.perlin2D(i * 0.1, i * 0.13);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(min).toBeGreaterThanOrEqual(-1.2);
      expect(max).toBeLessThanOrEqual(1.2);
    });

    it('整数坐标返回 0(梯度与位置差为 0)', () => {
      const ng = new NoiseGenerator(42);
      expect(ng.perlin2D(0, 0)).toBe(0);
      expect(ng.perlin2D(1, 0)).toBe(0);
      expect(ng.perlin2D(5, 3)).toBe(0);
    });

    it('同种子确定性', () => {
      const a = new NoiseGenerator(123);
      const b = new NoiseGenerator(123);
      for (let i = 0; i < 50; i++) {
        expect(a.perlin2D(i * 0.3, i * 0.5)).toBeCloseTo(b.perlin2D(i * 0.3, i * 0.5), 7);
      }
    });

    it('不同种子产生不同输出', () => {
      const a = new NoiseGenerator(1);
      const b = new NoiseGenerator(2);
      let diff = 0;
      for (let i = 0; i < 50; i++) {
        if (Math.abs(a.perlin2D(i * 0.3, i * 0.5) - b.perlin2D(i * 0.3, i * 0.5)) > 1e-6) diff++;
      }
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('perlin3D', () => {
    it('输出范围 ≈ [-1, 1]', () => {
      const ng = new NoiseGenerator(7);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 200; i++) {
        const v = ng.perlin3D(i * 0.1, i * 0.13, i * 0.17);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(min).toBeGreaterThanOrEqual(-1.01);
      expect(max).toBeLessThanOrEqual(1.01);
    });

    it('整数坐标返回 0', () => {
      const ng = new NoiseGenerator(7);
      expect(ng.perlin3D(0, 0, 0)).toBe(0);
      expect(ng.perlin3D(2, 3, 5)).toBe(0);
    });
  });

  describe('simplex2D', () => {
    it('输出范围 ≈ [-1, 1]', () => {
      const ng = new NoiseGenerator(99);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 200; i++) {
        const v = ng.simplex2D(i * 0.1, i * 0.13);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(min).toBeGreaterThanOrEqual(-1.1);
      expect(max).toBeLessThanOrEqual(1.1);
    });

    it('同种子确定性', () => {
      const a = new NoiseGenerator(55);
      const b = new NoiseGenerator(55);
      for (let i = 0; i < 50; i++) {
        expect(a.simplex2D(i * 0.21, i * 0.37)).toBeCloseTo(b.simplex2D(i * 0.21, i * 0.37), 7);
      }
    });
  });

  describe('simplex3D', () => {
    it('输出范围 ≈ [-1, 1]', () => {
      const ng = new NoiseGenerator(11);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 200; i++) {
        const v = ng.simplex3D(i * 0.1, i * 0.13, i * 0.17);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(min).toBeGreaterThanOrEqual(-1.1);
      expect(max).toBeLessThanOrEqual(1.1);
    });
  });

  describe('worley2D', () => {
    it('输出 ≥ 0(距离非负)', () => {
      const ng = new NoiseGenerator(3);
      for (let i = 0; i < 100; i++) {
        const v = ng.worley2D(i * 0.15, i * 0.23);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });

    it('同种子确定性', () => {
      const a = new NoiseGenerator(8);
      const b = new NoiseGenerator(8);
      for (let i = 0; i < 50; i++) {
        expect(a.worley2D(i * 0.21, i * 0.37)).toBeCloseTo(b.worley2D(i * 0.21, i * 0.37), 7);
      }
    });
  });

  describe('worley3D', () => {
    it('输出 ≥ 0', () => {
      const ng = new NoiseGenerator(3);
      for (let i = 0; i < 100; i++) {
        const v = ng.worley3D(i * 0.15, i * 0.23, i * 0.31);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('fbm2D', () => {
    it('默认参数确定性', () => {
      const a = new NoiseGenerator(1);
      const b = new NoiseGenerator(1);
      for (let i = 0; i < 50; i++) {
        expect(a.fbm2D(i * 0.3, i * 0.5)).toBeCloseTo(b.fbm2D(i * 0.3, i * 0.5), 7);
      }
    });

    it('octaves 增加时值更复杂(差异变大)', () => {
      const ng = new NoiseGenerator(2);
      const lowOct = ng.fbm2D(1.5, 2.5, 1, 0.5, 2);
      const highOct = ng.fbm2D(1.5, 2.5, 6, 0.5, 2);
      // 不应完全相等
      expect(Math.abs(lowOct - highOct)).toBeGreaterThan(0);
    });

    it('输出范围 ≈ [-1, 1]', () => {
      const ng = new NoiseGenerator(42);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 200; i++) {
        const v = ng.fbm2D(i * 0.1, i * 0.13, 5, 0.5, 2);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(min).toBeGreaterThanOrEqual(-1.01);
      expect(max).toBeLessThanOrEqual(1.01);
    });
  });

  describe('fbm3D', () => {
    it('输出范围 ≈ [-1, 1]', () => {
      const ng = new NoiseGenerator(42);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 200; i++) {
        const v = ng.fbm3D(i * 0.1, i * 0.13, i * 0.17, 5, 0.5, 2);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(min).toBeGreaterThanOrEqual(-1.01);
      expect(max).toBeLessThanOrEqual(1.01);
    });
  });

  describe('ridgenoise', () => {
    it('输出范围 [0, 1]', () => {
      const ng = new NoiseGenerator(42);
      for (let i = 0; i < 200; i++) {
        const v = ng.ridgenoise(i * 0.1, i * 0.13, 4);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('同种子确定性', () => {
      const a = new NoiseGenerator(33);
      const b = new NoiseGenerator(33);
      for (let i = 0; i < 50; i++) {
        expect(a.ridgenoise(i * 0.21, i * 0.37, 4)).toBeCloseTo(b.ridgenoise(i * 0.21, i * 0.37, 4), 7);
      }
    });

    it('输出值有变化(非全相同)', () => {
      const ng = new NoiseGenerator(7);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 100; i++) {
        const v = ng.ridgenoise(i * 0.1, i * 0.13, 4);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(max - min).toBeGreaterThan(0.1);
    });
  });
});
