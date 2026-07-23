import { describe, it, expect } from 'vitest';
import { TorusKnotGeometry } from './TorusKnotGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('TorusKnotGeometry', () => {
  it('默认参数生成 585 顶点 / 3072 索引', () => {
    const g = new TorusKnotGeometry(1, 0.4, 64, 8);
    expect(g.attributes.position.count).toBe(585);
    expect(g.index?.count).toBe(3072);
  });

  it('属性数组无 NaN', () => {
    const g = new TorusKnotGeometry(1, 0.3, 32, 8, 3, 4);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('法线为归一化单位向量', () => {
    const g = new TorusKnotGeometry(1, 0.4, 32, 8);
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});
