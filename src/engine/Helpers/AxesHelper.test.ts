// AxesHelper 单元测试 —— 验证几何构造与顶点数。
//
// Helper 类的构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildAxesGeometry() 纯函数:验证顶点数、颜色、坐标正确性。

import { describe, it, expect } from 'vitest';
import { buildAxesGeometry } from './AxesHelper';

describe('buildAxesGeometry', () => {
  it('生成 6 顶点(3 轴 × 2 端点) + position + color 属性', () => {
    const g = buildAxesGeometry(1);
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBe(6);
    expect(g.getAttribute('color')!.count).toBe(6);
  });

  it('X 轴端点为 (0,0,0) 和 (size,0,0)', () => {
    const g = buildAxesGeometry(5);
    const pos = g.getAttribute('position')!.array;
    // 顶点 0: 原点
    expect(pos[0]).toBe(0);
    expect(pos[1]).toBe(0);
    expect(pos[2]).toBe(0);
    // 顶点 1: X 轴末端
    expect(pos[3]).toBe(5);
    expect(pos[4]).toBe(0);
    expect(pos[5]).toBe(0);
  });

  it('Y 轴端点为 (0,0,0) 和 (0,size,0)', () => {
    const g = buildAxesGeometry(3);
    const pos = g.getAttribute('position')!.array;
    // 顶点 2: 原点
    expect(pos[6]).toBe(0);
    expect(pos[7]).toBe(0);
    expect(pos[8]).toBe(0);
    // 顶点 3: Y 轴末端
    expect(pos[9]).toBe(0);
    expect(pos[10]).toBe(3);
    expect(pos[11]).toBe(0);
  });

  it('Z 轴端点为 (0,0,0) 和 (0,0,size)', () => {
    const g = buildAxesGeometry(2);
    const pos = g.getAttribute('position')!.array;
    // 顶点 4: 原点
    expect(pos[12]).toBe(0);
    expect(pos[13]).toBe(0);
    expect(pos[14]).toBe(0);
    // 顶点 5: Z 轴末端
    expect(pos[15]).toBe(0);
    expect(pos[16]).toBe(0);
    expect(pos[17]).toBe(2);
  });

  it('X 轴红色, Y 轴绿色, Z 轴蓝色', () => {
    const g = buildAxesGeometry(1);
    const col = g.getAttribute('color')!.array;
    // X 轴顶点 0: (1, 0, 0)
    expect(col[0]).toBeCloseTo(1, 5);
    expect(col[1]).toBeCloseTo(0, 5);
    expect(col[2]).toBeCloseTo(0, 5);
    // Y 轴顶点 2: (0, 1, 0)
    expect(col[6]).toBeCloseTo(0, 5);
    expect(col[7]).toBeCloseTo(1, 5);
    expect(col[8]).toBeCloseTo(0, 5);
    // Z 轴顶点 4: (0, 0, 1)
    expect(col[12]).toBeCloseTo(0, 5);
    expect(col[13]).toBeCloseTo(0, 5);
    expect(col[14]).toBeCloseTo(1, 5);
  });

  it('默认 size=1', () => {
    const g = buildAxesGeometry();
    const pos = g.getAttribute('position')!.array;
    expect(pos[3]).toBe(1); // X 末端
    expect(pos[10]).toBe(1); // Y 末端
    expect(pos[17]).toBe(1); // Z 末端
  });
});
