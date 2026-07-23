import { describe, it, expect } from 'vitest';
import { SphereGeometry } from './SphereGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('SphereGeometry', () => {
  it('默认参数生成 561 顶点 / 2880 索引', () => {
    const g = new SphereGeometry(1, 32, 16);
    expect(g.attributes.position.count).toBe(561);
    expect(g.index?.count).toBe(2880);
  });

  it('属性数组无 NaN', () => {
    const g = new SphereGeometry(2, 16, 8);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('所有顶点位于球面上', () => {
    const radius = 1.5;
    const g = new SphereGeometry(radius, 24, 12);
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i], p[i + 1], p[i + 2]);
      expect(d).toBeCloseTo(radius, 4);
    }
  });

  it('法线与位置同向(归一化)', () => {
    const g = new SphereGeometry(1, 16, 8);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
    void p;
  });
});
