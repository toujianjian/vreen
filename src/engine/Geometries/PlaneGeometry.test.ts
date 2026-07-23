import { describe, it, expect } from 'vitest';
import { PlaneGeometry } from './PlaneGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('PlaneGeometry', () => {
  it('默认参数生成 4 顶点 / 6 索引', () => {
    const g = new PlaneGeometry();
    expect(g.attributes.position.count).toBe(4);
    expect(g.index?.count).toBe(6);
  });

  it('属性数组无 NaN', () => {
    const g = new PlaneGeometry(2, 3, 4, 5);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('分段数正确放大顶点数', () => {
    const g = new PlaneGeometry(1, 1, 3, 2);
    // (3+1)*(2+1) = 12 顶点;3*2*2*3 = 36 索引
    expect(g.attributes.position.count).toBe(12);
    expect(g.index?.count).toBe(36);
  });

  it('所有法线指向 +Z', () => {
    const g = new PlaneGeometry(2, 2);
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      expect(n[i]).toBe(0);
      expect(n[i + 1]).toBe(0);
      expect(n[i + 2]).toBe(1);
    }
  });
});
