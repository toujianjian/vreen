// MeshSurfaceSampler 单元测试。
//
// 覆盖:构造、build()、triangleCount、sample()、sample() 带法线/颜色、
// sampleBatch()、面积加权分布统计、权重属性采样、错误用例、非索引几何体、
// 以及原几何体不被修改的不变量。

import { describe, it, expect } from 'vitest';
import { MeshSurfaceSampler } from './MeshSurfaceSampler';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { Vector3 } from '../Math/Vector3';

// 构造一个单位正方形 (1×1) 网格,含 2 个三角形,总面积 = 1。
function makeQuad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
  ]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// 构造一个直角三角形,直角边长 2,面积 = 2。
function makeTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  2, 0, 0,  0, 2, 0,
  ]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}

// 构造非索引化的单位正方形 (6 个顶点,2 个三角形,无共享顶点)。
function makeNonIndexedQuad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,
    0, 0, 0,  1, 1, 0,  0, 1, 0,
  ]), 3));
  return g;
}

// 构造含两个面积悬殊三角形的几何体 (索引化):
//   小三角形位于 z=0 平面 (面积 0.125),
//   大三角形位于 z=10 平面 (面积 8)。
// 采样应高度偏向大三角形。
function makeSmallAndLargeTriangles(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0,   0, 0,   0.5, 0,   0,   0, 0.5, 0,    // 小三角形 (z=0)
    0,   0, 10,  4,   0,   10,  0, 4,   10,   // 大三角形 (z=10)
  ]), 3));
  g.setIndex([0, 1, 2, 3, 4, 5]);
  return g;
}

describe('MeshSurfaceSampler', () => {
  // ── 构造 ────────────────────────────────────────────────
  describe('构造', () => {
    it('接受一个 BufferGeometry 且不抛错', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      expect(sampler).toBeInstanceOf(MeshSurfaceSampler);
    });

    it('build() 前 triangleCount 为 0', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      expect(sampler.triangleCount).toBe(0);
    });

    it('build() 前 totalArea 为 0', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      expect(sampler.totalArea).toBe(0);
    });
  });

  // ── build() ────────────────────────────────────────────
  describe('build()', () => {
    it('返回 this 以支持链式调用', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      expect(sampler.build()).toBe(sampler);
    });

    it('正确计算三角形数量 (正方形 = 2)', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      expect(sampler.triangleCount).toBe(2);
    });

    it('正确计算三角形数量 (单三角形 = 1)', () => {
      const sampler = new MeshSurfaceSampler(makeTriangle());
      sampler.build();
      expect(sampler.triangleCount).toBe(1);
    });

    it('将 totalArea 归一化为 1 (正方形)', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      expect(sampler.totalArea).toBeCloseTo(1, 6);
    });

    it('将 totalArea 归一化为 1 (面积为 2 的三角形)', () => {
      const sampler = new MeshSurfaceSampler(makeTriangle());
      sampler.build();
      expect(sampler.totalArea).toBeCloseTo(1, 6);
    });
  });

  // ── setWeightAttribute ─────────────────────────────────
  describe('setWeightAttribute()', () => {
    it('返回 this 以支持链式调用', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      expect(sampler.setWeightAttribute('weight')).toBe(sampler);
    });
  });

  // ── sample() 基本 ──────────────────────────────────────
  describe('sample()', () => {
    it('返回传入的 targetPosition 引用', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const target = new Vector3();
      const result = sampler.sample(target);
      expect(result).toBe(target);
    });

    it('采样点落在正方形边界内 (x,y ∈ [0,1], z=0)', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const p = new Vector3();
      // 多次采样,验证每一点都在凸包内 (barycentric 保证)。
      for (let i = 0; i < 20; i++) {
        sampler.sample(p);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
        expect(p.z).toBeCloseTo(0, 6);
      }
    });

    it('采样点落在三角形边界内', () => {
      const sampler = new MeshSurfaceSampler(makeTriangle());
      sampler.build();
      const p = new Vector3();
      for (let i = 0; i < 20; i++) {
        sampler.sample(p);
        // 三角形 x>=0, y>=0, x+y<=2
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.y).toBeLessThanOrEqual(2);
        expect(p.z).toBeCloseTo(0, 6);
      }
    });
  });

  // ── sample() 带法线 ────────────────────────────────────
  describe('sample() 带法线', () => {
    it('法线为单位长度', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const p = new Vector3();
      const n = new Vector3();
      sampler.sample(p, n);
      expect(n.length()).toBeCloseTo(1, 6);
    });

    it('XY 平面正方形的面法线指向 +Z', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const p = new Vector3();
      const n = new Vector3();
      sampler.sample(p, n);
      expect(n.x).toBeCloseTo(0, 6);
      expect(n.y).toBeCloseTo(0, 6);
      expect(n.z).toBeCloseTo(1, 6);
    });
  });

  // ── sample() 带颜色 ────────────────────────────────────
  describe('sample() 带颜色', () => {
    it('带 color 属性时返回顶点颜色的重心插值', () => {
      // 正方形:v0 红, 其余蓝。任意插值满足 g=0 且 r+b=1。
      const g = makeQuad();
      g.setAttribute('color', new BufferAttribute(new Float32Array([
        1, 0, 0,  0, 0, 1,  0, 0, 1,  0, 0, 1,
      ]), 3));
      const sampler = new MeshSurfaceSampler(g);
      sampler.build();
      const p = new Vector3();
      const color: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < 30; i++) {
        sampler.sample(p, undefined, color);
        expect(color[1]).toBeCloseTo(0, 6);        // g 恒为 0
        expect(color[0] + color[2]).toBeCloseTo(1, 6); // r + b = 1
        expect(color[0]).toBeGreaterThanOrEqual(0);
        expect(color[0]).toBeLessThanOrEqual(1);
      }
    });

    it('无 color 属性时返回白色 (1,1,1)', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const p = new Vector3();
      const color: [number, number, number] = [0, 0, 0];
      sampler.sample(p, undefined, color);
      expect(color[0]).toBeCloseTo(1, 6);
      expect(color[1]).toBeCloseTo(1, 6);
      expect(color[2]).toBeCloseTo(1, 6);
    });
  });

  // ── sampleBatch() ──────────────────────────────────────
  describe('sampleBatch()', () => {
    it('返回指定数量的采样点', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const points = sampler.sampleBatch(50);
      expect(points).toHaveLength(50);
      points.forEach((v) => expect(v).toBeInstanceOf(Vector3));
    });

    it('批量采样点均落在正方形边界内', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const points = sampler.sampleBatch(40);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
        expect(p.z).toBeCloseTo(0, 6);
      }
    });
  });

  // ── 采样分布 (统计) ────────────────────────────────────
  describe('采样分布', () => {
    it('面积大的三角形被采样次数显著更多', () => {
      // 大三角形 (z=10) 面积 8,小三角形 (z=0) 面积 0.125。
      // 理论命中率 ≈ 0.985,取 0.9 作为宽松下界避免抖动。
      const sampler = new MeshSurfaceSampler(makeSmallAndLargeTriangles());
      sampler.build();
      const points = sampler.sampleBatch(5000);
      const bigHits = points.filter((p) => p.z > 5).length;
      const ratio = bigHits / points.length;
      expect(ratio).toBeGreaterThan(0.9);
    });
  });

  // ── 权重属性 (统计) ────────────────────────────────────
  describe('权重属性', () => {
    it('高权重顶点使对应三角形被采样次数显著更多', () => {
      // 正方形两三角形 [0,1,2] 与 [0,2,3] 共享 v0、v2。
      // 仅 v1 属于三角形 0。给 v1 极高权重 → 三角形 0 命中率 ≈ 0.997。
      // 三角形 0 区域满足 y <= x (对角线下方)。
      const g = makeQuad();
      g.setAttribute('weight', new BufferAttribute(new Float32Array([
        1, 1000, 1, 1,
      ]), 1));
      const sampler = new MeshSurfaceSampler(g);
      sampler.setWeightAttribute('weight').build();
      const points = sampler.sampleBatch(5000);
      const tri0Hits = points.filter((p) => p.y <= p.x).length;
      const ratio = tri0Hits / points.length;
      expect(ratio).toBeGreaterThan(0.9);
    });

    it('无权重时两等面积三角形命中率大致相等', () => {
      // 对角线两侧命中率应接近 0.5,取 [0.4, 0.6] 区间避免抖动。
      const sampler = new MeshSurfaceSampler(makeQuad());
      sampler.build();
      const points = sampler.sampleBatch(5000);
      const tri0Hits = points.filter((p) => p.y <= p.x).length;
      const ratio = tri0Hits / points.length;
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(0.6);
    });
  });

  // ── 错误用例 ───────────────────────────────────────────
  describe('错误用例', () => {
    it('build() 前调用 sample() 抛错', () => {
      const sampler = new MeshSurfaceSampler(makeQuad());
      expect(() => sampler.sample(new Vector3())).toThrow();
    });

    it('build() 时缺少 position 属性抛错', () => {
      const g = new BufferGeometry();
      // 故意只设置 color,不设置 position
      g.setAttribute('color', new BufferAttribute(new Float32Array([1, 0, 0]), 3));
      const sampler = new MeshSurfaceSampler(g);
      expect(() => sampler.build()).toThrow();
    });
  });

  // ── 非索引几何体 ───────────────────────────────────────
  describe('非索引几何体', () => {
    it('正确计算三角形数量 (2)', () => {
      const sampler = new MeshSurfaceSampler(makeNonIndexedQuad());
      sampler.build();
      expect(sampler.triangleCount).toBe(2);
    });

    it('采样点落在正方形边界内', () => {
      const sampler = new MeshSurfaceSampler(makeNonIndexedQuad());
      sampler.build();
      const p = new Vector3();
      for (let i = 0; i < 20; i++) {
        sampler.sample(p);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
        expect(p.z).toBeCloseTo(0, 6);
      }
    });
  });

  // ── 不变量 ─────────────────────────────────────────────
  describe('不变量', () => {
    it('build() 与 sample() 不修改原 position 属性', () => {
      const g = makeQuad();
      const posCopy = Array.from(g.attributes.position.array);
      const sampler = new MeshSurfaceSampler(g);
      sampler.build();
      for (let i = 0; i < 100; i++) sampler.sample(new Vector3());
      expect(Array.from(g.attributes.position.array)).toEqual(posCopy);
    });

    it('build() 与 sample() 不修改原 index 属性', () => {
      const g = makeQuad();
      const idxCopy = Array.from(g.index!.array);
      const sampler = new MeshSurfaceSampler(g);
      sampler.build();
      for (let i = 0; i < 100; i++) sampler.sample(new Vector3());
      expect(Array.from(g.index!.array)).toEqual(idxCopy);
    });
  });
});
