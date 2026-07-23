import { describe, it, expect } from 'vitest';
import { RingGeometry } from './RingGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('RingGeometry', () => {
  it('默认参数生成 66 顶点 / 192 索引', () => {
    const g = new RingGeometry(0.5, 1, 32, 1);
    expect(g.attributes.position.count).toBe(66);
    expect(g.index?.count).toBe(192);
  });

  it('属性数组无 NaN', () => {
    const g = new RingGeometry(0.3, 1, 16, 2);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('内圈顶点位于 innerRadius,外圈位于 outerRadius', () => {
    const inner = 0.5;
    const outer = 1.5;
    const g = new RingGeometry(inner, outer, 16, 1);
    const p = g.attributes.position.array;
    // 第 0 行(内圈):索引 0..16*3 步长 3
    // 第 1 行(外圈):索引 (16+1)*3..
    const stride = 16 + 1;
    for (let i = 0; i < stride; i++) {
      const rIn = Math.hypot(p[i * 3], p[i * 3 + 1]);
      expect(rIn).toBeCloseTo(inner, 4);
    }
    for (let i = 0; i < stride; i++) {
      const rOut = Math.hypot(p[(stride + i) * 3], p[(stride + i) * 3 + 1]);
      expect(rOut).toBeCloseTo(outer, 4);
    }
  });
});
