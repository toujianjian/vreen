import { describe, it, expect } from 'vitest';
import { ExtrudeGeometry } from './ExtrudeGeometry';
import { Shape } from './Shape';
import { Vector2 } from '../Math';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('ExtrudeGeometry', () => {
  it('Vector2[] 输入 + 禁用倒角:生成 8 顶点 / 36 索引', () => {
    const square = [
      new Vector2(-0.5, -0.5),
      new Vector2(0.5, -0.5),
      new Vector2(0.5, 0.5),
      new Vector2(-0.5, 0.5),
    ];
    const g = new ExtrudeGeometry(square, {
      bevelEnabled: false,
      depth: 1,
      steps: 1,
    });
    // 4 顶点 × (1+1) 层 = 8 顶点
    expect(g.attributes.position.count).toBe(8);
    // 底面 2 三角形(6) + 顶面 2 三角形(6) + 侧壁 4 边 × 1 × 2 三角形(24) = 36
    expect(g.index?.count).toBe(36);
  });

  it('Shape 输入 + 默认倒角:层数 = 2*bevelSegments + steps + 1', () => {
    const shape = new Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);
    shape.lineTo(-0.5, 0.5);
    shape.lineTo(-0.5, -0.5);

    const g = new ExtrudeGeometry(shape, {
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      depth: 1,
      bevelThickness: 0.2,
      bevelSize: 0.1,
    });
    // 4 顶点 × (2*3 + 1 + 1) = 4 × 8 = 32 顶点
    expect(g.attributes.position.count).toBe(32);
    // 索引:底 6 + 顶 6 + 侧壁 4 边 × 7 层间隔 × 6 = 6+6+168 = 180
    expect(g.index?.count).toBe(180);
  });

  it('属性数组无 NaN', () => {
    const shape = new Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);
    shape.lineTo(-0.5, 0.5);
    shape.lineTo(-0.5, -0.5);

    const g = new ExtrudeGeometry(shape, {
      bevelEnabled: true,
      bevelSegments: 2,
      depth: 1,
    });
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('包围盒 Z 范围与 depth + bevelThickness 一致', () => {
    const shape = new Shape();
    shape.moveTo(-1, -1);
    shape.lineTo(1, -1);
    shape.lineTo(1, 1);
    shape.lineTo(-1, 1);
    shape.lineTo(-1, -1);

    const depth = 2;
    const bevelThickness = 0.3;
    const g = new ExtrudeGeometry(shape, {
      bevelEnabled: true,
      bevelThickness,
      bevelSize: 0.1,
      bevelSegments: 2,
      depth,
      steps: 1,
    });
    const bb = g.boundingBox!;
    // Z 范围:前倒角延伸到 -bevelThickness,后倒角到 depth + bevelThickness
    expect(bb.min.z).toBeCloseTo(-bevelThickness, 4);
    expect(bb.max.z).toBeCloseTo(depth + bevelThickness, 4);
  });

  it('禁用倒角时 Z 范围恰好为 [0, depth]', () => {
    const square = [
      new Vector2(-1, -1),
      new Vector2(1, -1),
      new Vector2(1, 1),
      new Vector2(-1, 1),
    ];
    const g = new ExtrudeGeometry(square, {
      bevelEnabled: false,
      depth: 1.5,
      steps: 1,
    });
    const bb = g.boundingBox!;
    expect(bb.min.z).toBeCloseTo(0, 5);
    expect(bb.max.z).toBeCloseTo(1.5, 5);
  });

  it('法线为归一化单位向量', () => {
    const shape = new Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);
    shape.lineTo(-0.5, 0.5);
    shape.lineTo(-0.5, -0.5);

    const g = new ExtrudeGeometry(shape, {
      bevelEnabled: true,
      bevelSegments: 2,
      depth: 1,
    });
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 3);
    }
  });

  it('三角化凸五边形产生 3 个三角形', () => {
    // 五边形:5 个顶点,三角化后应有 3 个三角形
    const pentagon = [
      new Vector2(0, 1),
      new Vector2(0.951, 0.309),
      new Vector2(0.588, -0.809),
      new Vector2(-0.588, -0.809),
      new Vector2(-0.951, 0.309),
    ];
    const g = new ExtrudeGeometry(pentagon, {
      bevelEnabled: false,
      depth: 1,
      steps: 1,
    });
    // 底面 + 顶面 = 2 * 3 = 6 个三角形 = 18 索引
    // 侧壁:5 边 × 1 × 2 = 10 个三角形 = 30 索引
    // 总计:18 + 30 = 48 索引
    expect(g.index?.count).toBe(48);
  });
});
