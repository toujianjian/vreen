// ParametricGeometry 单元测试 —— 验证网格顶点 / 索引 / UV 与参数函数求值。

import { describe, it, expect } from 'vitest';
import { ParametricGeometry } from './ParametricGeometry';
import { Vector3 } from '../Math/Vector3';

describe('ParametricGeometry', () => {
  it('平面函数 slices=2,stacks=2 → 9 顶点 / 8 索引三角形', () => {
    const g = new ParametricGeometry((u, v, t) => t.set(u, v, 0), 2, 2);
    // (slices+1) × (stacks+1) = 3 × 3 = 9 顶点
    expect(g.attributes.position.count).toBe(9);
    // 每单元 2 三角形,共 4 单元 → 8 三角形 → 24 索引
    expect(g.index).not.toBeNull();
    expect(g.index!.count).toBe(24);
    expect(g.attributes.uv).toBeDefined();
  });

  it('平面函数顶点正确', () => {
    const g = new ParametricGeometry((u, v, t) => t.set(u, v, 0), 2, 2);
    const p = g.attributes.position.array;
    // 行主序:iv=0, iu=0..2 → (0,0,0),(0.5,0,0),(1,0,0)
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(0, 6);
    // iu=1, iv=0
    expect(p[3]).toBeCloseTo(0.5, 6);
  });

  it('球面参数函数 (u=0,v=0) 顶点为 (0,1,0)', () => {
    const sphere = (u: number, v: number, t: Vector3): void => {
      const phi = u * Math.PI * 2;
      const theta = v * Math.PI;
      t.set(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    };
    const g = new ParametricGeometry(sphere, 8, 8);
    const p = g.attributes.position.array;
    // 第一个顶点 (iu=0, iv=0):u=0,v=0 → theta=0 → (0,1,0)
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(1, 6);
    expect(p[2]).toBeCloseTo(0, 6);
  });

  it('UV 索引正确:第一个顶点 uv=(0,0)', () => {
    const g = new ParametricGeometry((u, v, t) => t.set(u, v, 0), 4, 4);
    const uv = g.attributes.uv.array;
    expect(uv[0]).toBeCloseTo(0, 6);
    expect(uv[1]).toBeCloseTo(0, 6);
  });

  it('computeVertexNormals 生成 normal 属性且为单位长度', () => {
    const g = new ParametricGeometry((u, v, t) => t.set(u, v, 0), 2, 2);
    expect(g.attributes.normal).toBeDefined();
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('索引全部在 [0, 顶点数) 范围内', () => {
    const g = new ParametricGeometry((u, v, t) => t.set(u, v, 0), 3, 3);
    const idx = g.index!.array as unknown as number[];
    const vc = g.attributes.position.count;
    for (let i = 0; i < idx.length; i++) {
      expect(idx[i]).toBeGreaterThanOrEqual(0);
      expect(idx[i]).toBeLessThan(vc);
    }
  });
});
