// TeapotGeometry 单元测试 —— 验证贝塞尔面片求值 / 顶点 / 包围盒 / 部件过滤。

import { describe, it, expect } from 'vitest';
import { TeapotGeometry } from './TeapotGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

function bboxSize(geo: TeapotGeometry): { x: number; y: number; z: number } {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  return {
    x: bb.max.x - bb.min.x,
    y: bb.max.y - bb.min.y,
    z: bb.max.z - bb.min.z,
  };
}

describe('TeapotGeometry', () => {
  it('默认参数生成 position 属性', () => {
    const g = new TeapotGeometry();
    expect(g.attributes.position).toBeDefined();
    expect(g.index).not.toBeNull();
  });

  it('position 属性为 Float32Array', () => {
    const g = new TeapotGeometry();
    expect(g.attributes.position.array).toBeInstanceOf(Float32Array);
  });

  it('顶点数 > 0 (茶壶有大量顶点)', () => {
    const g = new TeapotGeometry();
    expect(g.attributes.position.count).toBeGreaterThan(0);
    // 默认 segments=10, 28 个面片 (bottom=false), 顶点应远多于 100
    expect(g.attributes.position.count).toBeGreaterThan(100);
  });

  it('size=100 产生的包围盒大于 size=50', () => {
    const small = new TeapotGeometry({ size: 50 });
    const large = new TeapotGeometry({ size: 100 });
    const s = bboxSize(small);
    const l = bboxSize(large);
    expect(l.x).toBeGreaterThan(s.x);
    expect(l.y).toBeGreaterThan(s.y);
    expect(l.z).toBeGreaterThan(s.z);
  });

  it('segments=2 顶点数少于 segments=10', () => {
    const coarse = new TeapotGeometry({ segments: 2 });
    const fine = new TeapotGeometry({ segments: 10 });
    expect(coarse.attributes.position.count).toBeLessThan(fine.attributes.position.count);
  });

  it('body=false 顶点数少于默认 (全部部件)', () => {
    const all = new TeapotGeometry();
    const noBody = new TeapotGeometry({ body: false });
    expect(noBody.attributes.position.count).toBeLessThan(all.attributes.position.count);
  });

  it('lid=false 顶点数少于默认', () => {
    const all = new TeapotGeometry();
    const noLid = new TeapotGeometry({ lid: false });
    expect(noLid.attributes.position.count).toBeLessThan(all.attributes.position.count);
  });

  it('属性数组无 NaN', () => {
    const g = new TeapotGeometry({ segments: 4 });
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('索引全部在 [0, 顶点数) 范围内', () => {
    const g = new TeapotGeometry({ segments: 4 });
    const idx = g.index!.array as unknown as number[];
    const vc = g.attributes.position.count;
    for (let i = 0; i < idx.length; i++) {
      expect(idx[i]).toBeGreaterThanOrEqual(0);
      expect(idx[i]).toBeLessThan(vc);
    }
  });

  it('法线为单位长度', () => {
    const g = new TeapotGeometry({ segments: 4 });
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      // 尖点处法线为 ±1,其余为归一化向量
      expect(len).toBeCloseTo(1, 4);
    }
  });
});
