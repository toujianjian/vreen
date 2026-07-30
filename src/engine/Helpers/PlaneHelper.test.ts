// PlaneHelper 单元测试 —— 验证平面网格 + 法线几何。
//
// Helper 类构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildPlaneHelperGeometry() 纯函数。

import { describe, it, expect } from 'vitest';
import { buildPlaneHelperGeometry } from './PlaneHelper';
import { Plane, Vector3 } from '../Math';

describe('buildPlaneHelperGeometry', () => {
  it('法线 (0,1,0) / constant 0 / size 2 → 生成顶点,数量 > 0', () => {
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const g = buildPlaneHelperGeometry(plane, 2);
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBeGreaterThan(0);
    // 7 线段 × 2 顶点 = 14
    expect(g.getAttribute('position')!.count).toBe(14);
  });

  it('法线线段从原点指向 +Y(长度 size)', () => {
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const size = 2;
    const g = buildPlaneHelperGeometry(plane, size);
    const p = g.getAttribute('position')!.array;
    // 法线是最后一条线段(第 7 条),索引 12..13
    const nx = p[12 * 3], ny = p[12 * 3 + 1], nz = p[12 * 3 + 2];
    const tx = p[13 * 3], ty = p[13 * 3 + 1], tz = p[13 * 3 + 2];
    // 起点 = 平面最近点 = (0,0,0)
    expect(nx).toBeCloseTo(0, 6);
    expect(ny).toBeCloseTo(0, 6);
    expect(nz).toBeCloseTo(0, 6);
    // 终点沿 +Y 方向,长度 = size
    expect(tx).toBeCloseTo(0, 6);
    expect(ty).toBeCloseTo(size, 6);
    expect(tz).toBeCloseTo(0, 6);
  });

  it('所有顶点无 NaN', () => {
    const plane = new Plane(new Vector3(1, 1, 1), 0);
    const g = buildPlaneHelperGeometry(plane, 4);
    const p = g.getAttribute('position')!.array;
    for (let i = 0; i < p.length; i++) {
      expect(Number.isNaN(p[i])).toBe(false);
    }
  });

  it('平面常数非零时,中心点偏离原点', () => {
    // 平面 y = 1 → normal (0,1,0),constant = -1
    const plane = new Plane(new Vector3(0, 1, 0), -1);
    const g = buildPlaneHelperGeometry(plane, 2);
    const p = g.getAttribute('position')!.array;
    // 法线起点(最后一条线段起点)应在 (0,1,0)
    const nx = p[12 * 3], ny = p[12 * 3 + 1], nz = p[12 * 3 + 2];
    expect(nx).toBeCloseTo(0, 6);
    expect(ny).toBeCloseTo(1, 6);
    expect(nz).toBeCloseTo(0, 6);
  });

  it('position 数组为 Float32Array', () => {
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const g = buildPlaneHelperGeometry(plane, 1);
    expect(g.getAttribute('position')!.array).toBeInstanceOf(Float32Array);
  });
});
