import { describe, it, expect } from 'vitest';
import { ConeGeometry } from './ConeGeometry';
import { CylinderGeometry } from './CylinderGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('ConeGeometry', () => {
  it('继承自 CylinderGeometry', () => {
    const g = new ConeGeometry();
    expect(g).toBeInstanceOf(CylinderGeometry);
  });

  it('默认参数生成 131 顶点 / 192 索引(顶半径为 0,带底面)', () => {
    const g = new ConeGeometry(1, 1, 32, 1);
    expect(g.attributes.position.count).toBe(131);
    expect(g.index?.count).toBe(192);
  });

  it('属性数组无 NaN', () => {
    const g = new ConeGeometry(1, 2, 16, 2);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('顶端顶点收缩到轴线', () => {
    const g = new ConeGeometry(1, 2, 16, 1);
    const p = g.attributes.position.array;
    // 顶端 y 应为 +1,且存在 x=z=0 的顶点(底面中心)
    let hasApex = false;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] > 0.999 && Math.hypot(p[i], p[i + 2]) < 1e-6) hasApex = true;
    }
    expect(hasApex).toBe(true);
  });
});
