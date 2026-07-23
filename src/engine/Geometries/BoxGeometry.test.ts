import { describe, it, expect } from 'vitest';
import { BoxGeometry } from './BoxGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('BoxGeometry', () => {
  it('默认参数生成 24 顶点 / 36 索引', () => {
    const g = new BoxGeometry();
    expect(g.attributes.position.count).toBe(24);
    expect(g.index?.count).toBe(36);
  });

  it('属性数组无 NaN', () => {
    const g = new BoxGeometry(1, 1, 1, 2, 2, 2);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
    expect(hasNaN(g.index?.array ?? new Float32Array())).toBe(false);
  });

  it('包围盒尺寸与参数一致', () => {
    const g = new BoxGeometry(2, 3, 4);
    const bb = g.boundingBox!;
    expect(bb.min.x).toBeCloseTo(-1, 5);
    expect(bb.max.x).toBeCloseTo(1, 5);
    expect(bb.max.y - bb.min.y).toBeCloseTo(3, 5);
    expect(bb.max.z - bb.min.z).toBeCloseTo(4, 5);
  });

  it('分段数增加顶点数', () => {
    const g = new BoxGeometry(1, 1, 1, 2, 1, 1);
    expect(g.attributes.position.count).toBeGreaterThan(24);
    // 索引数也相应增加
    expect(g.index!.count).toBeGreaterThan(36);
  });

  it('法线为归一化单位向量', () => {
    const g = new BoxGeometry();
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});
