// TessellateModifier 单元测试 —— 验证面细分行为与原几何体不变性。

import { describe, it, expect } from 'vitest';
import { TessellateModifier } from './TessellateModifier';
import { PlaneGeometry } from '../Geometries/PlaneGeometry';

describe('TessellateModifier', () => {
  it('细分平面 (maxEdgeLength=0.1) 产生更多顶点', () => {
    const plane = new PlaneGeometry(1, 1, 1, 1); // 4 顶点, 2 三角形 (索引)
    const mod = new TessellateModifier({ maxEdgeLength: 0.1 });
    const result = mod.modify(plane);
    // 非索引展开后基准为 6 顶点; 细分后应显著增加
    expect(result.attributes.position.count).toBeGreaterThan(6);
  });

  it('maxEdgeLength=Infinity 不细分 (顶点数 = 非索引展开后的基准)', () => {
    const plane = new PlaneGeometry(1, 1, 1, 1); // 6 索引 → 非索引 6 顶点
    const mod = new TessellateModifier({ maxEdgeLength: Infinity });
    const result = mod.modify(plane);
    expect(result.attributes.position.count).toBe(6);
  });

  it('maxEdgeLength=0.01 产生比 0.1 更多的顶点', () => {
    const plane = new PlaneGeometry(1, 1, 1, 1);
    const coarse = new TessellateModifier({ maxEdgeLength: 0.1 }).modify(plane);
    const fine = new TessellateModifier({ maxEdgeLength: 0.01 }).modify(plane);
    expect(fine.attributes.position.count).toBeGreaterThan(coarse.attributes.position.count);
  });

  it('maxIterations=1 限制细分次数 (少于 maxIterations=10)', () => {
    const plane = new PlaneGeometry(2, 2, 1, 1);
    const once = new TessellateModifier({ maxEdgeLength: 0.01, maxIterations: 1 }).modify(plane);
    const many = new TessellateModifier({ maxEdgeLength: 0.01, maxIterations: 10 }).modify(plane);
    expect(once.attributes.position.count).toBeLessThan(many.attributes.position.count);
  });

  it('返回新 BufferGeometry,原几何体不变', () => {
    const plane = new PlaneGeometry(1, 1, 1, 1);
    const before = Array.from(plane.attributes.position.array);
    const beforeIdx = plane.index
      ? Array.from(plane.index.array as unknown as ArrayLike<number>)
      : null;
    const mod = new TessellateModifier({ maxEdgeLength: 0.1 });
    mod.modify(plane);
    const after = Array.from(plane.attributes.position.array);
    const afterIdx = plane.index
      ? Array.from(plane.index.array as unknown as ArrayLike<number>)
      : null;
    expect(after).toEqual(before);
    expect(afterIdx).toEqual(beforeIdx);
  });

  it('结果几何体有 position 属性且为 Float32Array', () => {
    const plane = new PlaneGeometry(1, 1, 1, 1);
    const result = new TessellateModifier({ maxEdgeLength: 0.1 }).modify(plane);
    expect(result.attributes.position).toBeDefined();
    expect(result.attributes.position.array).toBeInstanceOf(Float32Array);
  });
});
