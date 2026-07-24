import { describe, it, expect } from 'vitest';
import { HeightmapGenerator } from './HeightmapGenerator';

describe('HeightmapGenerator', () => {
  describe('fromFlat', () => {
    it('返回全 0 高度图,长度匹配', () => {
      const m = HeightmapGenerator.fromFlat(4, 5);
      expect(m.length).toBe(20);
      for (let i = 0; i < m.length; i++) {
        expect(m[i]).toBe(0);
      }
    });

    it('最小尺寸 1x1', () => {
      const m = HeightmapGenerator.fromFlat(1, 1);
      expect(m.length).toBe(1);
      expect(m[0]).toBe(0);
    });
  });

  describe('fromPerlinNoise', () => {
    it('输出尺寸与参数一致', () => {
      const m = HeightmapGenerator.fromPerlinNoise(8, 6, 2, 4, 0.5, 42);
      expect(m.length).toBe(48);
    });

    it('所有值落在 [0, 1]', () => {
      const m = HeightmapGenerator.fromPerlinNoise(32, 32, 4, 5, 0.5, 7);
      for (let i = 0; i < m.length; i++) {
        expect(m[i]).toBeGreaterThanOrEqual(0);
        expect(m[i]).toBeLessThanOrEqual(1);
      }
    });

    it('同种子产生相同输出(确定性)', () => {
      const a = HeightmapGenerator.fromPerlinNoise(16, 16, 3, 4, 0.5, 123);
      const b = HeightmapGenerator.fromPerlinNoise(16, 16, 3, 4, 0.5, 123);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeCloseTo(b[i], 7);
      }
    });

    it('不同种子产生不同输出', () => {
      const a = HeightmapGenerator.fromPerlinNoise(16, 16, 3, 4, 0.5, 1);
      const b = HeightmapGenerator.fromPerlinNoise(16, 16, 3, 4, 0.5, 2);
      let diff = 0;
      for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-6) diff++;
      }
      expect(diff).toBeGreaterThan(0);
    });

    it('输出值有变化(非全相同)', () => {
      const m = HeightmapGenerator.fromPerlinNoise(16, 16, 2, 4, 0.5, 42);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < m.length; i++) {
        if (m[i] < min) min = m[i];
        if (m[i] > max) max = m[i];
      }
      expect(max - min).toBeGreaterThan(0.1);
    });
  });

  describe('fromDiamondSquare', () => {
    it('输出尺寸 = size * size', () => {
      const m = HeightmapGenerator.fromDiamondSquare(33, 0.5, 42);
      expect(m.length).toBe(33 * 33);
    });

    it('所有值落在 [0, 1]', () => {
      const m = HeightmapGenerator.fromDiamondSquare(33, 0.7, 9);
      for (let i = 0; i < m.length; i++) {
        expect(m[i]).toBeGreaterThanOrEqual(0);
        expect(m[i]).toBeLessThanOrEqual(1);
      }
    });

    it('支持最小尺寸 3 (2^1+1)', () => {
      const m = HeightmapGenerator.fromDiamondSquare(3, 0.5, 1);
      expect(m.length).toBe(9);
    });

    it('支持 size=65', () => {
      const m = HeightmapGenerator.fromDiamondSquare(65, 0.5, 1);
      expect(m.length).toBe(65 * 65);
    });

    it('非 2^k+1 尺寸抛错', () => {
      expect(() => HeightmapGenerator.fromDiamondSquare(32, 0.5, 1)).toThrow();
      expect(() => HeightmapGenerator.fromDiamondSquare(30, 0.5, 1)).toThrow();
      expect(() => HeightmapGenerator.fromDiamondSquare(2, 0.5, 1)).toThrow();
    });

    it('同种子确定性', () => {
      const a = HeightmapGenerator.fromDiamondSquare(17, 0.5, 99);
      const b = HeightmapGenerator.fromDiamondSquare(17, 0.5, 99);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeCloseTo(b[i], 7);
      }
    });
  });

  describe('fromRidge', () => {
    it('输出尺寸与参数一致', () => {
      const m = HeightmapGenerator.fromRidge(8, 8, 0.1, 1, 42);
      expect(m.length).toBe(64);
    });

    it('所有值落在 [0, 1]', () => {
      const m = HeightmapGenerator.fromRidge(16, 16, 0.05, 1, 3);
      for (let i = 0; i < m.length; i++) {
        expect(m[i]).toBeGreaterThanOrEqual(0);
        expect(m[i]).toBeLessThanOrEqual(1);
      }
    });

    it('同种子确定性', () => {
      const a = HeightmapGenerator.fromRidge(16, 16, 0.1, 1, 55);
      const b = HeightmapGenerator.fromRidge(16, 16, 0.1, 1, 55);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeCloseTo(b[i], 7);
      }
    });

    it('输出值有变化', () => {
      const m = HeightmapGenerator.fromRidge(16, 16, 0.1, 1, 7);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < m.length; i++) {
        if (m[i] < min) min = m[i];
        if (m[i] > max) max = m[i];
      }
      expect(max - min).toBeGreaterThan(0.1);
    });
  });
});
