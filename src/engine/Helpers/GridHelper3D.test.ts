// GridHelper3D 单元测试 —— 验证几何构造与顶点数。
//
// Helper 类的构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildGrid3DGeometry() 纯函数。

import { describe, it, expect } from 'vitest';
import { buildGrid3DGeometry } from './GridHelper3D';

describe('buildGrid3DGeometry', () => {
  it('生成 12*(divisions+1) 顶点(6*(d+1) 线段 × 2)', () => {
    const divisions = 10;
    const expected = 12 * (divisions + 1); // 132
    const g = buildGrid3DGeometry(10, divisions);
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBe(expected);
    expect(g.getAttribute('color')!.count).toBe(expected);
  });

  it('divisions=1 时 24 顶点(3 平面 × 4 线 × 2 顶点)', () => {
    const g = buildGrid3DGeometry(2, 1);
    expect(g.getAttribute('position')!.count).toBe(24);
  });

  it('divisions=0 时 12 顶点(3 平面 × 2 线 × 2 顶点)', () => {
    const g = buildGrid3DGeometry(2, 0);
    expect(g.getAttribute('position')!.count).toBe(12);
  });

  it('顶点覆盖 [-half, +half] 范围', () => {
    const size = 10;
    const g = buildGrid3DGeometry(size, 5);
    const pos = g.getAttribute('position')!.array;
    const half = size / 2;
    for (let i = 0; i < pos.length; i++) {
      expect(pos[i]).toBeGreaterThanOrEqual(-half - 1e-5);
      expect(pos[i]).toBeLessThanOrEqual(half + 1e-5);
    }
  });

  it('中心线颜色与普通线颜色不同', () => {
    const center = [1, 0, 0] as [number, number, number];
    const grid = [0, 1, 0] as [number, number, number];
    const g = buildGrid3DGeometry(10, 10, center, grid);
    const colors = g.getAttribute('color')!.array;

    let hasCenter = false;
    let hasGrid = false;
    for (let i = 0; i < colors.length; i += 3) {
      const r = colors[i], gr = colors[i + 1], b = colors[i + 2];
      if (r === 1 && gr === 0 && b === 0) hasCenter = true;
      if (r === 0 && gr === 1 && b === 0) hasGrid = true;
    }
    expect(hasCenter).toBe(true);
    expect(hasGrid).toBe(true);
  });

  it('无 NaN 顶点', () => {
    const g = buildGrid3DGeometry(10, 10);
    const pos = g.getAttribute('position')!.array;
    for (let i = 0; i < pos.length; i++) {
      expect(Number.isNaN(pos[i])).toBe(false);
    }
  });

  it('包围盒尺寸 = size', () => {
    const size = 8;
    const g = buildGrid3DGeometry(size, 4);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(size, 5);
    expect(bb.max.y - bb.min.y).toBeCloseTo(size, 5);
    expect(bb.max.z - bb.min.z).toBeCloseTo(size, 5);
  });
});
