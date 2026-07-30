// Box3Helper 单元测试 —— 验证 AABB 线框几何。
//
// Helper 类构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildBox3Geometry() 纯函数。

import { describe, it, expect } from 'vitest';
import { buildBox3Geometry } from './Box3Helper';
import { Box3, Vector3 } from '../Math';

describe('buildBox3Geometry', () => {
  it('从 (-1,-1,-1) 到 (1,1,1) → 12 边 × 2 顶点 = 24 position', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const g = buildBox3Geometry(box);
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBe(24);
  });

  it('所有顶点坐标位于 min/max 之间', () => {
    const min = new Vector3(-2, -3, -4);
    const max = new Vector3(5, 6, 7);
    const box = new Box3(min, max);
    const g = buildBox3Geometry(box);
    const p = g.getAttribute('position')!.array;
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]).toBeGreaterThanOrEqual(-2);
      expect(p[i]).toBeLessThanOrEqual(5);
      expect(p[i + 1]).toBeGreaterThanOrEqual(-3);
      expect(p[i + 1]).toBeLessThanOrEqual(6);
      expect(p[i + 2]).toBeGreaterThanOrEqual(-4);
      expect(p[i + 2]).toBeLessThanOrEqual(7);
    }
  });

  it('12 条线段覆盖立方体全部棱(去重后 12 条边)', () => {
    const box = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
    const g = buildBox3Geometry(box);
    const p = g.getAttribute('position')!.array;
    const edges = new Set<string>();
    for (let i = 0; i < p.length; i += 6) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      // 角点量化到 0/1,边以无序 key 去重
      const ka = `${Math.round(ax)},${Math.round(ay)},${Math.round(az)}`;
      const kb = `${Math.round(bx)},${Math.round(by)},${Math.round(bz)}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edges.add(key);
    }
    expect(edges.size).toBe(12);
  });

  it('position 数组为 Float32Array', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const g = buildBox3Geometry(box);
    expect(g.getAttribute('position')!.array).toBeInstanceOf(Float32Array);
  });
});
