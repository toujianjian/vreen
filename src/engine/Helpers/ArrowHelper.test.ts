// ArrowHelper 单元测试 —— 验证几何构造与顶点数。
//
// Helper 类的构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildArrowGeometry() + fillArrowVertices() 纯函数。

import { describe, it, expect } from 'vitest';
import { buildArrowGeometry, fillArrowVertices } from './ArrowHelper';
import { Vector3 } from '../Math';

describe('buildArrowGeometry', () => {
  it('生成 10 顶点(5 线段 × 2)', () => {
    const g = buildArrowGeometry();
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBe(10);
  });

  it('初始位置全 0(等待 fillArrowVertices 填充)', () => {
    const g = buildArrowGeometry();
    const pos = g.getAttribute('position')!.array;
    for (let i = 0; i < pos.length; i++) {
      expect(pos[i]).toBe(0);
    }
  });
});

describe('fillArrowVertices', () => {
  it('沿 +Y 方向:杆身从原点到 base,头部四角在 XZ 平面', () => {
    const g = buildArrowGeometry();
    const pos = g.getAttribute('position')!.array as Float32Array;
    const dir = new Vector3(0, 1, 0);
    const origin = new Vector3(0, 0, 0);
    const length = 2;
    const headLength = 0.4;
    const headWidth = 0.2;

    fillArrowVertices(pos, dir, origin, length, headLength, headWidth);

    // 杆身: origin(0,0,0) → base(0, 1.6, 0)
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(0, 5);
    expect(pos[3]).toBeCloseTo(0, 5);
    expect(pos[4]).toBeCloseTo(1.6, 5); // length - headLength = 2 - 0.4
    expect(pos[5]).toBeCloseTo(0, 5);

    // 尖端: (0, 2, 0)
    expect(pos[6]).toBeCloseTo(0, 5);  // line 1 start = tip
    expect(pos[7]).toBeCloseTo(2, 5);
    expect(pos[8]).toBeCloseTo(0, 5);
  });

  it('沿 +Z 方向:杆身从原点到 base,尖端在 (0,0,length)', () => {
    const g = buildArrowGeometry();
    const pos = g.getAttribute('position')!.array as Float32Array;
    const dir = new Vector3(0, 0, 1);
    const origin = new Vector3(0, 0, 0);
    const length = 1;
    const headLength = 0.2;
    const headWidth = 0.04;

    fillArrowVertices(pos, dir, origin, length, headLength, headWidth);

    // 尖端 = (0, 0, 1)
    expect(pos[6]).toBeCloseTo(0, 5);
    expect(pos[7]).toBeCloseTo(0, 5);
    expect(pos[8]).toBeCloseTo(1, 5);
  });

  it('头部四角与尖端距离为 headLength', () => {
    const g = buildArrowGeometry();
    const pos = g.getAttribute('position')!.array as Float32Array;
    const dir = new Vector3(0, 1, 0);
    const origin = new Vector3(0, 0, 0);
    const length = 2;
    const headLength = 0.5;
    const headWidth = 0.3;

    fillArrowVertices(pos, dir, origin, length, headLength, headWidth);

    // 尖端 (line 1 start)
    const tipX = pos[6], tipY = pos[7], tipZ = pos[8];
    // 角 1 (line 1 end)
    const c1x = pos[9], c1y = pos[10], c1z = pos[11];
    const dist = Math.hypot(tipX - c1x, tipY - c1y, tipZ - c1z);
    // 尖端到角点的距离 = sqrt(headLength² + (headWidth/2)²)
    const expected = Math.hypot(headLength, headWidth / 2);
    expect(dist).toBeCloseTo(expected, 4);
  });

  it('非原点起点:origin 偏移正确传播', () => {
    const g = buildArrowGeometry();
    const pos = g.getAttribute('position')!.array as Float32Array;
    const dir = new Vector3(1, 0, 0);
    const origin = new Vector3(5, 0, 0);
    const length = 1;
    const headLength = 0.2;
    const headWidth = 0.04;

    fillArrowVertices(pos, dir, origin, length, headLength, headWidth);

    // 杆身起点 = origin
    expect(pos[0]).toBeCloseTo(5, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(0, 5);
    // 尖端 = origin + dir * length = (6, 0, 0)
    expect(pos[6]).toBeCloseTo(6, 5);
    expect(pos[7]).toBeCloseTo(0, 5);
    expect(pos[8]).toBeCloseTo(0, 5);
  });

  it('无 NaN 顶点', () => {
    const g = buildArrowGeometry();
    const pos = g.getAttribute('position')!.array as Float32Array;
    const dir = new Vector3(1, 2, 3).normalize();
    fillArrowVertices(pos, dir, new Vector3(1, 2, 3), 5, 1, 0.5);
    for (let i = 0; i < pos.length; i++) {
      expect(Number.isNaN(pos[i])).toBe(false);
    }
  });
});
