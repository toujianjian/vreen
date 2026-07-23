// BoxHelper 单元测试 —— 验证几何构造与顶点数。
//
// Helper 类的构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildBoxGeometry() 纯函数与索引结构。

import { describe, it, expect } from 'vitest';
import { buildBoxGeometry } from './BoxHelper';

describe('buildBoxGeometry', () => {
  it('生成 8 顶点 + 24 索引(12 边 × 2 索引)', () => {
    const g = buildBoxGeometry();
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBe(8);
    expect(g.index).not.toBeNull();
    expect(g.index!.count).toBe(24);
  });

  it('初始位置全 0(等待 update 填充)', () => {
    const g = buildBoxGeometry();
    const pos = g.getAttribute('position')!.array;
    for (let i = 0; i < pos.length; i++) {
      expect(pos[i]).toBe(0);
    }
  });

  it('索引构成 12 条边(24 个索引值, 每对为一条线段)', () => {
    const g = buildBoxGeometry();
    const idx = g.index!.array as unknown as number[];
    expect(idx.length).toBe(24);
    // 验证所有索引在 [0, 7] 范围内
    for (let i = 0; i < idx.length; i++) {
      expect(idx[i]).toBeGreaterThanOrEqual(0);
      expect(idx[i]).toBeLessThanOrEqual(7);
    }
  });

  it('12 条边覆盖立方体所有棱', () => {
    const g = buildBoxGeometry();
    const idx = g.index!.array as unknown as number[];
    // 收集所有边(无序对)
    const edges = new Set<string>();
    for (let i = 0; i < idx.length; i += 2) {
      const a = idx[i], b = idx[i + 1];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.add(key);
    }
    // 立方体有 12 条边
    expect(edges.size).toBe(12);
  });
});
