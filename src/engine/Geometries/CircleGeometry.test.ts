import { describe, it, expect } from 'vitest';
import { CircleGeometry } from './CircleGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('CircleGeometry', () => {
  it('默认参数生成 34 顶点 / 96 索引', () => {
    const g = new CircleGeometry(1, 32);
    expect(g.attributes.position.count).toBe(34);
    expect(g.index?.count).toBe(96);
  });

  it('属性数组无 NaN', () => {
    const g = new CircleGeometry(2, 16, 0, Math.PI);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('周缘顶点位于给定半径上', () => {
    const radius = 1.5;
    const g = new CircleGeometry(radius, 16);
    const p = g.attributes.position.array;
    // 跳过中心点(索引 0),从索引 3 开始为周缘
    for (let i = 3; i < p.length; i += 3) {
      const d = Math.hypot(p[i], p[i + 1]);
      expect(d).toBeCloseTo(radius, 4);
    }
  });
});
