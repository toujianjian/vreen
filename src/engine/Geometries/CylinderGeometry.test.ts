import { describe, it, expect } from 'vitest';
import { CylinderGeometry } from './CylinderGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('CylinderGeometry', () => {
  it('默认参数生成 196 顶点 / 384 索引(含完整顶底面)', () => {
    const g = new CylinderGeometry(1, 1, 1, 32, 1, false);
    expect(g.attributes.position.count).toBe(196);
    expect(g.index?.count).toBe(384);
  });

  it('属性数组无 NaN', () => {
    const g = new CylinderGeometry(1, 0.5, 2, 16, 2, false);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('openEnded=true 时不生成顶底面', () => {
    const g = new CylinderGeometry(1, 1, 1, 32, 1, true);
    // 仅侧面:(33)*(2)=66 顶点;索引 32*1*2*3=192
    expect(g.attributes.position.count).toBe(66);
    expect(g.index?.count).toBe(192);
  });

  it('顶/底面中心顶点位于轴线上', () => {
    const g = new CylinderGeometry(1, 1, 2, 16, 1, false);
    const p = g.attributes.position.array;
    // 顶/底面中心顶点 y 应为 ±1,且 x=z=0
    let foundTopCenter = false;
    let foundBottomCenter = false;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] === 0 && p[i + 2] === 0 && p[i + 1] > 0.999) foundTopCenter = true;
      if (p[i] === 0 && p[i + 2] === 0 && p[i + 1] < -0.999) foundBottomCenter = true;
    }
    expect(foundTopCenter).toBe(true);
    expect(foundBottomCenter).toBe(true);
  });
});
