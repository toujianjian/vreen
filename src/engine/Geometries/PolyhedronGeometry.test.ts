// PolyhedronGeometry 单元测试 —— 正多面体几何体验证。

import { describe, it, expect } from 'vitest';
import {
  PolyhedronGeometry,
  TetrahedronGeometry,
  OctahedronGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
} from './PolyhedronGeometry';

/** 检查所有顶点到原点的距离 ≈ radius。 */
function expectAllOnSphere(
  geo: PolyhedronGeometry,
  radius: number,
  eps = 1e-5,
): void {
  const pos = geo.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    const dist = Math.sqrt(
      pos[i] * pos[i] + pos[i + 1] * pos[i + 1] + pos[i + 2] * pos[i + 2],
    );
    expect(dist).toBeCloseTo(radius, eps);
  }
}

/** 检查所有法线为单位向量。 */
function expectUnitNormals(geo: PolyhedronGeometry, eps = 1e-5): void {
  const n = geo.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]);
    expect(len).toBeCloseTo(1, eps);
  }
}

/** 检查 UV 是有限值。 */
function expectFiniteUVs(geo: PolyhedronGeometry): void {
  const uv = geo.attributes.uv.array;
  for (let i = 0; i < uv.length; i++) {
    expect(Number.isFinite(uv[i])).toBe(true);
  }
}

describe('PolyhedronGeometry', () => {
  describe('TetrahedronGeometry', () => {
    it('detail=0 → 4 面 × 3 = 12 顶点', () => {
      const geo = new TetrahedronGeometry(1, 0);
      expect(geo.attributes.position.count).toBe(12);
      expect(geo.attributes.normal.count).toBe(12);
      expect(geo.attributes.uv.count).toBe(12);
    });

    it('所有顶点在半径 1 的球面上', () => {
      const geo = new TetrahedronGeometry(1, 0);
      expectAllOnSphere(geo, 1);
    });

    it('radius=2 → 所有顶点在半径 2 的球面上', () => {
      const geo = new TetrahedronGeometry(2, 0);
      expectAllOnSphere(geo, 2);
    });

    it('法线为单位向量', () => {
      const geo = new TetrahedronGeometry(1, 0);
      expectUnitNormals(geo);
    });

    it('UV 是有限值', () => {
      const geo = new TetrahedronGeometry(1, 0);
      expectFiniteUVs(geo);
    });

    it('detail=1 → 4 × 4 × 3 = 48 顶点(每面分 4 三角形)', () => {
      const geo = new TetrahedronGeometry(1, 1);
      expect(geo.attributes.position.count).toBe(48);
    });

    it('detail=2 → 4 × 9 × 3 = 108 顶点', () => {
      const geo = new TetrahedronGeometry(1, 2);
      expect(geo.attributes.position.count).toBe(108);
    });
  });

  describe('OctahedronGeometry', () => {
    it('detail=0 → 8 面 × 3 = 24 顶点', () => {
      const geo = new OctahedronGeometry(1, 0);
      expect(geo.attributes.position.count).toBe(24);
    });

    it('所有顶点在球面上', () => {
      const geo = new OctahedronGeometry(1.5, 0);
      expectAllOnSphere(geo, 1.5);
    });

    it('detail=1 → 8 × 4 × 3 = 96 顶点', () => {
      const geo = new OctahedronGeometry(1, 1);
      expect(geo.attributes.position.count).toBe(96);
    });
  });

  describe('DodecahedronGeometry', () => {
    it('detail=0 → 36 三角形 × 3 = 108 顶点', () => {
      const geo = new DodecahedronGeometry(1, 0);
      expect(geo.attributes.position.count).toBe(108);
    });

    it('所有顶点在球面上', () => {
      const geo = new DodecahedronGeometry(1, 0);
      expectAllOnSphere(geo, 1);
    });

    it('法线为单位向量', () => {
      const geo = new DodecahedronGeometry(1, 0);
      expectUnitNormals(geo);
    });

    it('detail=1 → 36 × 4 × 3 = 432 顶点', () => {
      const geo = new DodecahedronGeometry(1, 1);
      expect(geo.attributes.position.count).toBe(432);
    });
  });

  describe('IcosahedronGeometry', () => {
    it('detail=0 → 20 面 × 3 = 60 顶点', () => {
      const geo = new IcosahedronGeometry(1, 0);
      expect(geo.attributes.position.count).toBe(60);
    });

    it('所有顶点在球面上', () => {
      const geo = new IcosahedronGeometry(2, 0);
      expectAllOnSphere(geo, 2);
    });

    it('detail=1 → 20 × 4 × 3 = 240 顶点', () => {
      const geo = new IcosahedronGeometry(1, 1);
      expect(geo.attributes.position.count).toBe(240);
    });

    it('detail=3 → 20 × 16 × 3 = 960 顶点(高细分接近球体)', () => {
      const geo = new IcosahedronGeometry(1, 3);
      expect(geo.attributes.position.count).toBe(960);
    });

    it('detail=3 的高细分顶点都在球面上', () => {
      const geo = new IcosahedronGeometry(1, 3);
      expectAllOnSphere(geo, 1);
    });
  });

  describe('PolyhedronGeometry (基类)', () => {
    it('自定义顶点/索引构建单三角形', () => {
      // 一个在 (1,0,0), (0,1,0), (0,0,1) 的三角形
      const vertices = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const indices = [0, 1, 2];
      const geo = new PolyhedronGeometry(vertices, indices, 1, 0);
      expect(geo.attributes.position.count).toBe(3);
      expectAllOnSphere(geo, 1);
    });

    it('空顶点 → 空几何体', () => {
      const geo = new PolyhedronGeometry([], [], 1, 0);
      expect(geo.attributes.position.count).toBe(0);
    });

    it('默认参数 (radius=1, detail=0)', () => {
      const geo = new TetrahedronGeometry();
      expect(geo.attributes.position.count).toBe(12);
      expectAllOnSphere(geo, 1);
    });

    it('boundingBox 已计算', () => {
      const geo = new IcosahedronGeometry(1, 0);
      expect(geo.boundingBox).not.toBeNull();
      // radius=1 时,顶点在单位球上,bounding box 应在 [-1,1]³ 内
      const bb = geo.boundingBox!;
      expect(bb.min.x).toBeGreaterThanOrEqual(-1.001);
      expect(bb.max.x).toBeLessThanOrEqual(1.001);
      expect(bb.min.y).toBeGreaterThanOrEqual(-1.001);
      expect(bb.max.y).toBeLessThanOrEqual(1.001);
      expect(bb.min.z).toBeGreaterThanOrEqual(-1.001);
      expect(bb.max.z).toBeLessThanOrEqual(1.001);
    });
  });

  describe('继承关系', () => {
    it('TetrahedronGeometry 是 PolyhedronGeometry', () => {
      const geo = new TetrahedronGeometry();
      expect(geo).toBeInstanceOf(PolyhedronGeometry);
    });

    it('OctahedronGeometry 是 PolyhedronGeometry', () => {
      const geo = new OctahedronGeometry();
      expect(geo).toBeInstanceOf(PolyhedronGeometry);
    });

    it('DodecahedronGeometry 是 PolyhedronGeometry', () => {
      const geo = new DodecahedronGeometry();
      expect(geo).toBeInstanceOf(PolyhedronGeometry);
    });

    it('IcosahedronGeometry 是 PolyhedronGeometry', () => {
      const geo = new IcosahedronGeometry();
      expect(geo).toBeInstanceOf(PolyhedronGeometry);
    });
  });

  describe('属性一致性', () => {
    it('position / normal / uv 顶点数一致', () => {
      const geo = new IcosahedronGeometry(1, 2);
      const p = geo.attributes.position.count;
      const n = geo.attributes.normal.count;
      const u = geo.attributes.uv.count;
      expect(p).toBe(n);
      expect(p).toBe(u);
    });

    it('非索引输出', () => {
      const geo = new TetrahedronGeometry(1, 0);
      expect(geo.index).toBeNull();
    });
  });
});
