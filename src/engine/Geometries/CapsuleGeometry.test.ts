import { describe, it, expect } from 'vitest';
import { CapsuleGeometry } from './CapsuleGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('CapsuleGeometry', () => {
  it('默认参数生成 90 顶点 / 432 索引', () => {
    const g = new CapsuleGeometry(1, 1, 4, 8);
    expect(g.attributes.position.count).toBe(90);
    expect(g.index?.count).toBe(432);
  });

  it('属性数组无 NaN', () => {
    const g = new CapsuleGeometry(0.5, 2, 6, 12);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('法线为归一化单位向量', () => {
    const g = new CapsuleGeometry(1, 1, 4, 8);
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});
