// SimplifyModifier 单元测试 —— 验证边折叠简化 / 比例 / 边界保护 / 原几何体不变性。

import { describe, it, expect } from 'vitest';
import { SimplifyModifier } from './SimplifyModifier';
import { SphereGeometry } from '../Geometries/SphereGeometry';
import { PlaneGeometry } from '../Geometries/PlaneGeometry';

describe('SimplifyModifier', () => {
  it('ratio=0.5 减少顶点数', () => {
    const geo = new SphereGeometry(1, 32, 16);
    const before = geo.attributes.position.count;
    const result = new SimplifyModifier({ ratio: 0.5 }).modify(geo);
    const after = result.attributes.position.count;
    expect(after).toBeLessThan(before);
  });

  it('ratio=1.0 不改变顶点数', () => {
    const geo = new SphereGeometry(1, 16, 12);
    const before = geo.attributes.position.count;
    const result = new SimplifyModifier({ ratio: 1.0 }).modify(geo);
    expect(result.attributes.position.count).toBe(before);
  });

  it('ratio=0.0 产生最小几何体 (顶点数少于原始)', () => {
    const geo = new SphereGeometry(1, 24, 16);
    const before = geo.attributes.position.count;
    // 关闭边界保护以允许充分折叠 (球面无边界,但显式关闭确保不受限)
    const result = new SimplifyModifier({
      ratio: 0.0,
      preserveBoundaries: false,
      preserveUVSeams: false,
    }).modify(geo);
    expect(result.attributes.position.count).toBeLessThan(before);
    expect(result.attributes.position.count).toBeGreaterThanOrEqual(0);
  });

  it('返回新 BufferGeometry,原几何体不变', () => {
    const geo = new SphereGeometry(1, 16, 12);
    const before = Array.from(geo.attributes.position.array);
    const beforeIdx = geo.index
      ? Array.from(geo.index.array as unknown as ArrayLike<number>)
      : null;
    new SimplifyModifier({ ratio: 0.5 }).modify(geo);
    const after = Array.from(geo.attributes.position.array);
    const afterIdx = geo.index
      ? Array.from(geo.index.array as unknown as ArrayLike<number>)
      : null;
    expect(after).toEqual(before);
    expect(afterIdx).toEqual(beforeIdx);
  });

  it('preserveBoundaries=true 保留更多顶点 (与 false 相比)', () => {
    // 平面有边界 (4 条边各仅 1 面共享)
    const plane = new PlaneGeometry(2, 2, 4, 4);
    const keepBnd = new SimplifyModifier({
      ratio: 0.3,
      preserveBoundaries: true,
      preserveUVSeams: false,
    }).modify(plane);
    const dropBnd = new SimplifyModifier({
      ratio: 0.3,
      preserveBoundaries: false,
      preserveUVSeams: false,
    }).modify(plane);
    expect(keepBnd.attributes.position.count).toBeGreaterThan(dropBnd.attributes.position.count);
  });

  it('ratio=0.5 结果仍为有效几何体 (有索引或顶点)', () => {
    const geo = new SphereGeometry(1, 20, 14);
    const result = new SimplifyModifier({ ratio: 0.5 }).modify(geo);
    expect(result.attributes.position.count).toBeGreaterThan(0);
    if (result.index) {
      const idx = result.index.array as unknown as ArrayLike<number>;
      expect(idx.length).toBeGreaterThan(0);
      // 索引全部在 [0, 顶点数) 范围内
      const vc = result.attributes.position.count;
      for (let i = 0; i < idx.length; i++) {
        expect(idx[i]).toBeGreaterThanOrEqual(0);
        expect(idx[i]).toBeLessThan(vc);
      }
    }
  });
});
