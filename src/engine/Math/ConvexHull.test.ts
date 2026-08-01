// ConvexHull 单元测试 (凸包计算)。
//
// 覆盖:
//   1. 立方体 8 顶点 → 12 个三角面
//   2. 四面体 4 顶点 → 4 个三角面
//   3. 共面点(退化为 0 面)
//   4. 点在凸包内部(不影响结果)
//   5. 法线朝外
//   6. 表面积
//   7. 体积
//   8. 不修改输入点
//   9. 随机点集(验证凸性)

import { describe, it, expect } from 'vitest';
import { ConvexHull } from './ConvexHull';
import { Vector3 } from './Vector3';

/** 立方体 8 顶点 (±1, ±1, ±1)。 */
function cubePoints(): Vector3[] {
  return [
    new Vector3(-1, -1, -1), new Vector3(1, -1, -1),
    new Vector3(1, 1, -1), new Vector3(-1, 1, -1),
    new Vector3(-1, -1, 1), new Vector3(1, -1, 1),
    new Vector3(1, 1, 1), new Vector3(-1, 1, 1),
  ];
}

// ── 立方体 ──────────────────────────────────────────────────────────

describe('ConvexHull cube', () => {
  it('8 vertices → 12 triangular faces', () => {
    const result = ConvexHull.compute(cubePoints());
    expect(result.faces.length).toBe(12);
  });

  it('all faces are triangles (3 vertices)', () => {
    const result = ConvexHull.compute(cubePoints());
    for (const f of result.faces) {
      expect(f.a).not.toBe(f.b);
      expect(f.b).not.toBe(f.c);
      expect(f.a).not.toBe(f.c);
    }
  });

  it('8 hull vertices', () => {
    const result = ConvexHull.compute(cubePoints());
    expect(result.vertexIndices.length).toBe(8);
    expect(result.vertices.length).toBe(8);
  });
});

// ── 四面体 ──────────────────────────────────────────────────────────

describe('ConvexHull tetrahedron', () => {
  it('4 vertices → 4 faces', () => {
    const pts = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ];
    const result = ConvexHull.compute(pts);
    expect(result.faces.length).toBe(4);
  });

  it('4 hull vertices', () => {
    const pts = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ];
    const result = ConvexHull.compute(pts);
    expect(result.vertexIndices.length).toBe(4);
  });
});

// ── 退化情况 ───────────────────────────────────────────────────────

describe('ConvexHull degenerate', () => {
  it('< 4 points → empty hull', () => {
    expect(ConvexHull.compute([]).faces.length).toBe(0);
    expect(ConvexHull.compute([new Vector3(0, 0, 0)]).faces.length).toBe(0);
    expect(ConvexHull.compute([
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
    ]).faces.length).toBe(0);
  });

  it('coplanar points → empty hull (degenerate)', () => {
    const pts = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(1, 1, 0),
      new Vector3(0, 1, 0),
      new Vector3(0.5, 0.5, 0),
    ];
    const result = ConvexHull.compute(pts);
    expect(result.faces.length).toBe(0);
  });
});

// ── 内部点 ──────────────────────────────────────────────────────────

describe('ConvexHull interior points', () => {
  it('interior points do not affect hull', () => {
    const cube = cubePoints();
    const withInterior = [...cube, new Vector3(0, 0, 0)]; // 中心点
    const result = ConvexHull.compute(withInterior);
    expect(result.faces.length).toBe(12); // 仍为立方体
    expect(result.vertexIndices.length).toBe(8); // 中心点不在凸包上
  });
});

// ── 法线朝外 ───────────────────────────────────────────────────────

describe('ConvexHull normals', () => {
  it('all normals point outward', () => {
    const result = ConvexHull.compute(cubePoints());
    const center = new Vector3(0, 0, 0); // 立方体中心

    for (const f of result.faces) {
      const toFace = new Vector3().subVectors(f.centroid, center);
      // 法线应与 (面质心 → 中心) 方向相反,即法线·toFace > 0
      expect(f.normal.dot(toFace)).toBeGreaterThan(-0.01);
    }
  });

  it('normals are unit length', () => {
    const result = ConvexHull.compute(cubePoints());
    for (const f of result.faces) {
      const len = f.normal.length();
      expect(len).toBeCloseTo(1, 4);
    }
  });
});

// ── 表面积 ──────────────────────────────────────────────────────────

describe('ConvexHull surfaceArea', () => {
  it('cube surface area = 6 (2x2x2 cube)', () => {
    const result = ConvexHull.compute(cubePoints());
    const area = ConvexHull.surfaceArea(result);
    // 2×2×2 cube has surface area = 6 × (2×2) = 24
    expect(area).toBeCloseTo(24, 0);
  });
});

// ── 体积 ────────────────────────────────────────────────────────────

describe('ConvexHull volume', () => {
  it('cube volume = 8 (2×2×2)', () => {
    const result = ConvexHull.compute(cubePoints());
    const vol = ConvexHull.volume(result);
    expect(vol).toBeCloseTo(8, 0);
  });
});

// ── 不修改输入 ─────────────────────────────────────────────────────

describe('ConvexHull immutability', () => {
  it('does not modify input points', () => {
    const pts = cubePoints();
    const original = pts.map((p) => p.clone());
    ConvexHull.compute(pts);
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i].x).toBe(original[i].x);
      expect(pts[i].y).toBe(original[i].y);
      expect(pts[i].z).toBe(original[i].z);
    }
  });
});

// ── 随机点集凸性 ───────────────────────────────────────────────────

describe('ConvexHull convexity', () => {
  it('all input points are inside or on the hull', () => {
    // 随机生成 20 个点
    const pts: Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      pts.push(new Vector3(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
      ));
    }
    const result = ConvexHull.compute(pts);

    // 每个输入点应在所有面的内侧(法线·点 ≤ constant + eps)
    for (const p of pts) {
      for (const f of result.faces) {
        const dist = f.normal.dot(p) - f.constant;
        expect(dist).toBeLessThan(0.01); // 在内侧或面上
      }
    }
  });
});
