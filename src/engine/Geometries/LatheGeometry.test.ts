import { describe, it, expect } from 'vitest';
import { LatheGeometry } from './LatheGeometry';
import { Vector2 } from '../Math';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('LatheGeometry', () => {
  it('默认参数生成 (segments+1) * points.length 顶点', () => {
    const points = [
      new Vector2(0, -0.5),
      new Vector2(0.5, 0),
      new Vector2(0, 0.5),
    ];
    const g = new LatheGeometry(points, 12);
    // 顶点数 = (segments+1) * points.length = 13 * 3 = 39
    expect(g.attributes.position.count).toBe(39);
    // 索引数 = segments * (points.length - 1) * 2 * 3 = 12 * 2 * 6 = 144
    expect(g.index?.count).toBe(144);
  });

  it('属性数组无 NaN', () => {
    const points = [
      new Vector2(0.5, -1),
      new Vector2(1, 0),
      new Vector2(0.5, 1),
    ];
    const g = new LatheGeometry(points, 32);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('phiLength 限制在 [0, 2π]', () => {
    const points = [new Vector2(1, 0), new Vector2(1, 1)];
    const g = new LatheGeometry(points, 8, 0, 99);
    // phiLength 被钳制为 2π,顶点数仍为 (8+1)*2 = 18
    expect(g.attributes.position.count).toBe(18);
  });

  it('法线为归一化单位向量', () => {
    const points = [
      new Vector2(0.5, -0.5),
      new Vector2(0.5, 0.5),
    ];
    const g = new LatheGeometry(points, 16);
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('生成完整的旋转体(2π)', () => {
    const points = [new Vector2(1, 0), new Vector2(1, 1)];
    const g = new LatheGeometry(points, 16);
    const p = g.attributes.position.array;
    // 第一个顶点(phi=0):x=points[0].x*sin(0)=0, z=points[0].x*cos(0)=1
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(0, 5);
    expect(p[2]).toBeCloseTo(1, 5);
  });
});
