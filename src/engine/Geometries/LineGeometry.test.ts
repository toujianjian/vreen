// LineGeometry 单元测试 — 折线链→线段对转换、setColors、fromLine、边界情况。

import { describe, it, expect } from 'vitest';
import { LineGeometry } from './LineGeometry';
import { LineSegmentsGeometry } from './LineSegmentsGeometry';

describe('LineGeometry', () => {
  describe('构造', () => {
    it('类型标志', () => {
      const geo = new LineGeometry();
      expect(geo.isLineGeometry).toBe(true);
      expect(geo.isLineSegmentsGeometry).toBe(true);
      expect(geo.type).toBe('LineGeometry');
    });

    it('继承 LineSegmentsGeometry', () => {
      const geo = new LineGeometry();
      expect(geo).toBeInstanceOf(LineSegmentsGeometry);
    });
  });

  describe('setPositions — 折线链→线段对', () => {
    it('2 顶点 → 1 段', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      expect(geo.instanceCount).toBe(1);

      const start = geo.customAttributes.get('instanceStart')!;
      const end = geo.customAttributes.get('instanceEnd')!;
      expect(start[0]).toBe(0);
      expect(end[0]).toBe(1);
    });

    it('4 顶点 → 3 段(共享端点)', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 3, 0, 0, 3, 4, 0, 3, 4, 12]);
      expect(geo.instanceCount).toBe(3);

      const start = geo.customAttributes.get('instanceStart')!;
      const end = geo.customAttributes.get('instanceEnd')!;
      // 段0: (0,0,0)→(3,0,0)
      expect(start[0]).toBe(0);
      expect(end[0]).toBe(3);
      // 段1: (3,0,0)→(3,4,0) — 段1起点 = 段0终点
      expect(start[3]).toBe(3);
      expect(start[4]).toBe(0);
      expect(end[4]).toBe(4);
      // 段2: (3,4,0)→(3,4,12)
      expect(start[6]).toBe(3);
      expect(start[7]).toBe(4);
      expect(end[8]).toBe(12);
    });

    it('3 顶点 → 2 段', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0, 1, 1, 0]);
      expect(geo.instanceCount).toBe(2);
    });

    it('长度不是 3 的倍数 → 抛错', () => {
      const geo = new LineGeometry();
      expect(() => geo.setPositions([0, 0, 0, 1, 0])).toThrow(/multiple of 3/);
    });

    it('少于 2 个顶点 → 空几何体', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0]); // 1 顶点
      expect(geo.instanceCount).toBe(0);
    });

    it('空数组 → 空几何体', () => {
      const geo = new LineGeometry();
      geo.setPositions([]);
      expect(geo.instanceCount).toBe(0);
    });

    it('Float32Array 输入', () => {
      const geo = new LineGeometry();
      geo.setPositions(new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]));
      expect(geo.instanceCount).toBe(2);
    });

    it('setPositions 后自动计算 boundingBox', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0, 1, 1, 0]);
      expect(geo.boundingBox).not.toBeNull();
      expect(geo.boundingSphere).not.toBeNull();
    });
  });

  describe('setColors — 折线颜色链→段颜色对', () => {
    it('3 顶点颜色 → 2 段颜色对', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0, 1, 1, 0]);
      geo.setColors([1, 0, 0, 0, 1, 0, 0, 0, 1]); // red, green, blue

      const cs = geo.customAttributes.get('instanceColorStart')!;
      const ce = geo.customAttributes.get('instanceColorEnd')!;
      // 段0: start=red(1,0,0), end=green(0,1,0)
      expect(cs[0]).toBe(1);
      expect(cs[1]).toBe(0);
      expect(ce[0]).toBe(0);
      expect(ce[1]).toBe(1);
      // 段1: start=green(0,1,0), end=blue(0,0,1)
      expect(cs[3]).toBe(0);
      expect(cs[4]).toBe(1);
      expect(ce[3]).toBe(0);
      expect(ce[4]).toBe(0);
      expect(ce[5]).toBe(1);
    });

    it('颜色链段数与顶点链不匹配 → 抛错(通过父类)', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]); // 2 顶点 → 1 段
      // 3 顶点颜色 → 2 段,但位置只有 1 段
      expect(() => geo.setColors([1, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow(/does not match/);
    });

    it('长度不是 3 的倍数 → 抛错', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      expect(() => geo.setColors([1, 0, 0, 0])).toThrow(/multiple of 3/);
    });

    it('少于 2 个顶点颜色 → 段数不匹配抛错', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]); // 1 段
      // 1 顶点颜色 → 0 段,与 instanceCount=1 不匹配
      expect(() => geo.setColors([1, 0, 0])).toThrow(/does not match/);
    });
  });

  describe('fromLine', () => {
    it('从 Line 的 position 数组导入', () => {
      const geo = new LineGeometry();
      const fakeLine = {
        geometry: {
          attributes: {
            position: { array: [0, 0, 0, 1, 0, 0, 2, 0, 0] },
          },
        },
      };
      geo.fromLine(fakeLine);
      expect(geo.instanceCount).toBe(2);
    });
  });

  describe('boundingBox (折线)', () => {
    it('4 顶点折线的 boundingBox', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 3, 0, 0, 3, 4, 0, 3, 4, 12]);
      const bb = geo.boundingBox!;
      expect(bb.min.x).toBe(0);
      expect(bb.min.y).toBe(0);
      expect(bb.min.z).toBe(0);
      expect(bb.max.x).toBe(3);
      expect(bb.max.y).toBe(4);
      expect(bb.max.z).toBe(12);
    });
  });
});
