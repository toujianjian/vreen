import { describe, it, expect } from 'vitest';
import { TorusGeometry } from './TorusGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('TorusGeometry', () => {
  it('默认参数生成 637 顶点 / 3456 索引', () => {
    const g = new TorusGeometry(1, 0.4, 12, 48);
    expect(g.attributes.position.count).toBe(637);
    expect(g.index?.count).toBe(3456);
  });

  it('属性数组无 NaN', () => {
    const g = new TorusGeometry(2, 0.5, 16, 32);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('顶点位于环面管圆上(到中心圆距离约为 tube)', () => {
    const radius = 2;
    const tube = 0.5;
    const g = new TorusGeometry(radius, tube, 8, 16);
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      // 中心圆所在平面为 XY,管子环绕。顶点到中心圆(半径 radius,在 XY 平面)的距离 ≈ tube。
      const r = Math.hypot(p[i], p[i + 1]);
      const dist = Math.hypot(r - radius, p[i + 2]);
      expect(dist).toBeCloseTo(tube, 4);
    }
  });
});
