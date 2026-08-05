import { describe, it, expect } from 'vitest';
import {
  // 类型
  type MeshData, type MDFVec3,
  // 向量工具
  vadd, vsub, vscale, vdot, vcross, vlength, vnormalize,
  // 几何
  pointTriangleDistanceSq, pointAABBSignedDistance,
  // SDF 构建
  computeMeshAABB, collectTriangles, isPointInsideMesh, rayTriangleIntersect,
  buildMeshSDF, buildSphereSDF, buildBoxSDF,
  // 索引
  idx3, idx3Dim, worldToVoxel, voxelToWorld, isInsideGrid,
  // 采样
  sampleSDFNearest, sampleSDFTrilinear, sampleSDFGradient,
  // 球面追踪
  rayMarchSDF,
  // DFSS / DFAO
  dfssShadow, dfao,
  // 工具
  sdfMemoryBytes, sdfMemoryMB, getSDFStats,
  // GLSL
  SDF_SAMPLE_GLSL, DFSS_SHADOW_GLSL, DFAO_GLSL, MESH_DISTANCE_FIELD_GLSL,
} from './MeshDistanceField';

// ── 测试辅助 ─────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function vApproxEq(a: MDFVec3, b: MDFVec3, eps = 1e-4): boolean {
  return approxEq(a.x, b.x, eps) && approxEq(a.y, b.y, eps) && approxEq(a.z, b.z, eps);
}

/** 单位立方体网格(8 顶点,12 三角形),边长 1,中心在原点。 */
function makeUnitCubeMesh(): MeshData {
  return {
    positions: new Float32Array([
      -0.5, -0.5, -0.5,  // 0
       0.5, -0.5, -0.5,  // 1
       0.5,  0.5, -0.5,  // 2
      -0.5,  0.5, -0.5,  // 3
      -0.5, -0.5,  0.5,  // 4
       0.5, -0.5,  0.5,  // 5
       0.5,  0.5,  0.5,  // 6
      -0.5,  0.5,  0.5,  // 7
    ]),
    indices: new Uint32Array([
      // -Z 面
      0, 1, 2,  0, 2, 3,
      // +Z 面
      4, 6, 5,  4, 7, 6,
      // -X 面
      0, 3, 7,  0, 7, 4,
      // +X 面
      1, 5, 6,  1, 6, 2,
      // -Y 面
      0, 4, 5,  0, 5, 1,
      // +Y 面
      3, 2, 6,  3, 6, 7,
    ]),
  };
}

// ── 向量工具 ─────────────────────────────────────────────────────

describe('vector utils', () => {
  it('vadd', () => {
    const r = vadd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(vApproxEq(r, { x: 5, y: 7, z: 9 })).toBe(true);
  });

  it('vsub', () => {
    const r = vsub({ x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 });
    expect(vApproxEq(r, { x: 3, y: 3, z: 3 })).toBe(true);
  });

  it('vscale', () => {
    const r = vscale({ x: 1, y: 2, z: 3 }, 2);
    expect(vApproxEq(r, { x: 2, y: 4, z: 6 })).toBe(true);
  });

  it('vdot', () => {
    expect(approxEq(vdot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }), 32)).toBe(true);
  });

  it('vcross', () => {
    const r = vcross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(vApproxEq(r, { x: 0, y: 0, z: 1 })).toBe(true);
  });

  it('vlength', () => {
    expect(approxEq(vlength({ x: 3, y: 4, z: 0 }), 5)).toBe(true);
  });

  it('vnormalize', () => {
    const r = vnormalize({ x: 0, y: 5, z: 0 });
    expect(vApproxEq(r, { x: 0, y: 1, z: 0 })).toBe(true);
  });

  it('vnormalize zero vector returns zero', () => {
    const r = vnormalize({ x: 0, y: 0, z: 0 });
    expect(vApproxEq(r, { x: 0, y: 0, z: 0 })).toBe(true);
  });
});

// ── 点-三角形距离 ───────────────────────────────────────────────

describe('pointTriangleDistanceSq', () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 1, y: 0, z: 0 };
  const c = { x: 0, y: 1, z: 0 };

  it('point above triangle center', () => {
    // 三角形重心 (1/3, 1/3, 0),上方 0.5
    const p = { x: 1 / 3, y: 1 / 3, z: 0.5 };
    const r = pointTriangleDistanceSq(p, a, b, c);
    expect(approxEq(r.distSq, 0.25)).toBe(true); // 0.5²
  });

  it('point at vertex A', () => {
    const r = pointTriangleDistanceSq(a, a, b, c);
    expect(approxEq(r.distSq, 0)).toBe(true);
  });

  it('point outside near edge AB', () => {
    // 在 AB 边外侧 0.5 单位
    const p = { x: 0.5, y: -0.5, z: 0 };
    const r = pointTriangleDistanceSq(p, a, b, c);
    expect(approxEq(r.distSq, 0.25)).toBe(true); // 0.5²
  });

  it('point outside near vertex A', () => {
    const p = { x: -1, y: -1, z: 0 };
    const r = pointTriangleDistanceSq(p, a, b, c);
    // 到 A(0,0,0) 的距离 = √2
    expect(approxEq(r.distSq, 2)).toBe(true);
  });

  it('point inside triangle', () => {
    const p = { x: 0.2, y: 0.2, z: 0 };
    const r = pointTriangleDistanceSq(p, a, b, c);
    expect(approxEq(r.distSq, 0, 1e-6)).toBe(true);
  });
});

// ── 点-AABB 有符号距离 ──────────────────────────────────────────

describe('pointAABBSignedDistance', () => {
  const min = { x: -1, y: -1, z: -1 };
  const max = { x: 1, y: 1, z: 1 };

  it('point outside +X', () => {
    const d = pointAABBSignedDistance({ x: 3, y: 0, z: 0 }, min, max);
    expect(approxEq(d, 2)).toBe(true);
  });

  it('point outside corner', () => {
    const d = pointAABBSignedDistance({ x: 2, y: 2, z: 2 }, min, max);
    expect(approxEq(d, Math.sqrt(3))).toBe(true); // 3 个 1 的距离
  });

  it('point inside center', () => {
    const d = pointAABBSignedDistance({ x: 0, y: 0, z: 0 }, min, max);
    expect(approxEq(d, -1)).toBe(true); // 到最近面 1 单位
  });

  it('point on surface', () => {
    const d = pointAABBSignedDistance({ x: 1, y: 0, z: 0 }, min, max);
    expect(approxEq(d, 0)).toBe(true);
  });
});

// ── 网格 AABB ───────────────────────────────────────────────────

describe('computeMeshAABB', () => {
  it('computes correct AABB for unit cube', () => {
    const mesh = makeUnitCubeMesh();
    const aabb = computeMeshAABB(mesh);
    expect(vApproxEq(aabb.min, { x: -0.5, y: -0.5, z: -0.5 })).toBe(true);
    expect(vApproxEq(aabb.max, { x: 0.5, y: 0.5, z: 0.5 })).toBe(true);
  });

  it('handles empty mesh', () => {
    const mesh: MeshData = { positions: new Float32Array([]), indices: null };
    const aabb = computeMeshAABB(mesh);
    expect(vApproxEq(aabb.min, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(vApproxEq(aabb.max, { x: 0, y: 0, z: 0 })).toBe(true);
  });
});

// ── 三角形收集 ─────────────────────────────────────────────────

describe('collectTriangles', () => {
  it('indexed mesh', () => {
    const mesh = makeUnitCubeMesh();
    const tris = collectTriangles(mesh);
    expect(tris.length).toBe(12); // 6 面 × 2 三角形
  });

  it('non-indexed mesh', () => {
    const mesh: MeshData = {
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0,
        0, 0, 1, 1, 0, 1, 0, 1, 1,
      ]),
      indices: null,
    };
    const tris = collectTriangles(mesh);
    expect(tris.length).toBe(2);
  });
});

// ── 射线-三角形相交 ────────────────────────────────────────────

describe('rayTriangleIntersect', () => {
  const a = { x: -1, y: -1, z: 0 };
  const b = { x: 1, y: -1, z: 0 };
  const c = { x: 0, y: 1, z: 0 };

  it('ray hits triangle from front', () => {
    const origin = { x: 0, y: 0, z: -1 };
    const dir = { x: 0, y: 0, z: 1 };
    expect(rayTriangleIntersect(origin, dir, a, b, c)).toBe(true);
  });

  it('ray misses triangle', () => {
    const origin = { x: 5, y: 5, z: -1 };
    const dir = { x: 0, y: 0, z: 1 };
    expect(rayTriangleIntersect(origin, dir, a, b, c)).toBe(false);
  });

  it('ray parallel to triangle does not hit', () => {
    const origin = { x: 0, y: 0, z: 1 };
    const dir = { x: 1, y: 0, z: 0 };
    expect(rayTriangleIntersect(origin, dir, a, b, c)).toBe(false);
  });

  it('ray behind origin does not hit', () => {
    const origin = { x: 0, y: 0, z: 1 };
    const dir = { x: 0, y: 0, z: 1 }; // 背向三角形
    expect(rayTriangleIntersect(origin, dir, a, b, c)).toBe(false);
  });
});

// ── 内外判定 ───────────────────────────────────────────────────

describe('isPointInsideMesh', () => {
  it('point inside unit cube', () => {
    const mesh = makeUnitCubeMesh();
    const tris = collectTriangles(mesh);
    expect(isPointInsideMesh({ x: 0, y: 0, z: 0 }, tris)).toBe(true);
  });

  it('point outside unit cube', () => {
    const mesh = makeUnitCubeMesh();
    const tris = collectTriangles(mesh);
    expect(isPointInsideMesh({ x: 2, y: 0, z: 0 }, tris)).toBe(false);
  });

  it('point outside far', () => {
    const mesh = makeUnitCubeMesh();
    const tris = collectTriangles(mesh);
    expect(isPointInsideMesh({ x: 10, y: 10, z: 10 }, tris)).toBe(false);
  });
});

// ── 索引工具 ───────────────────────────────────────────────────

describe('idx3 / idx3Dim', () => {
  it('idx3 returns correct index', () => {
    expect(idx3(0, 0, 0, 4)).toBe(0);
    expect(idx3(1, 0, 0, 4)).toBe(1);
    expect(idx3(0, 1, 0, 4)).toBe(4);
    expect(idx3(0, 0, 1, 4)).toBe(16);
  });

  it('idx3Dim supports non-uniform dimensions', () => {
    expect(idx3Dim(1, 0, 0, 4, 3)).toBe(1);
    expect(idx3Dim(0, 1, 0, 4, 3)).toBe(4);
    expect(idx3Dim(0, 0, 1, 4, 3)).toBe(12);
  });
});

// ── 坐标变换 ───────────────────────────────────────────────────

describe('worldToVoxel / voxelToWorld', () => {
  it('round-trip', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 4,
    );
    const p = { x: 0.3, y: -0.2, z: 0.1 };
    const v = worldToVoxel(p, sdf);
    const p2 = voxelToWorld(v, sdf);
    expect(vApproxEq(p, p2, 1e-3)).toBe(true);
  });

  it('isInsideGrid', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 4,
    );
    expect(isInsideGrid({ x: 0, y: 0, z: 0 }, sdf)).toBe(true);
    expect(isInsideGrid({ x: 2, y: 0, z: 0 }, sdf)).toBe(false);
  });
});

// ── 球体 SDF 构建 ──────────────────────────────────────────────

describe('buildSphereSDF', () => {
  it('returns correct dimensions', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 8,
    );
    expect(sdf.dimX).toBe(8);
    expect(sdf.dimY).toBe(8);
    expect(sdf.dimZ).toBe(8);
    expect(sdf.data.length).toBe(512);
  });

  it('center is negative (inside sphere)', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const center = sampleSDFTrilinear(sdf, { x: 0, y: 0, z: 0 });
    expect(center).toBeLessThan(0); // 球心在球内 → 负值
  });

  it('corner is positive (outside sphere)', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const corner = sampleSDFTrilinear(sdf, { x: 0.9, y: 0.9, z: 0.9 });
    expect(corner).toBeGreaterThan(0); // 远离球心 → 正值
  });

  it('voxel size is correct', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 8,
    );
    expect(approxEq(sdf.voxelSize.x, 0.25)).toBe(true);
    expect(approxEq(sdf.voxelSize.y, 0.25)).toBe(true);
    expect(approxEq(sdf.voxelSize.z, 0.25)).toBe(true);
  });
});

// ── 立方体 SDF 构建 ────────────────────────────────────────────

describe('buildBoxSDF', () => {
  it('center is negative (inside box)', () => {
    const sdf = buildBoxSDF(
      { x: -0.5, y: -0.5, z: -0.5 }, { x: 0.5, y: 0.5, z: 0.5 },
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const center = sampleSDFTrilinear(sdf, { x: 0, y: 0, z: 0 });
    expect(center).toBeLessThanOrEqual(0);
  });

  it('far corner is positive', () => {
    const sdf = buildBoxSDF(
      { x: -0.5, y: -0.5, z: -0.5 }, { x: 0.5, y: 0.5, z: 0.5 },
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const corner = sampleSDFTrilinear(sdf, { x: 0.9, y: 0.9, z: 0.9 });
    expect(corner).toBeGreaterThan(0);
  });
});

// ── 网格 SDF 构建 ──────────────────────────────────────────────

describe('buildMeshSDF', () => {
  it('returns correct dimensions for unit cube', () => {
    const mesh = makeUnitCubeMesh();
    const sdf = buildMeshSDF(mesh, { resolution: 8, padding: 0.5 });
    expect(sdf.dimX).toBe(8);
    expect(sdf.dimY).toBe(8);
    expect(sdf.dimZ).toBe(8);
    expect(sdf.data.length).toBe(512);
  });

  it('center is inside (negative SDF)', () => {
    const mesh = makeUnitCubeMesh();
    const sdf = buildMeshSDF(mesh, { resolution: 16, padding: 0.5 });
    const center = sampleSDFTrilinear(sdf, { x: 0, y: 0, z: 0 });
    expect(center).toBeLessThan(0);
  });

  it('far corner is outside (positive SDF)', () => {
    const mesh = makeUnitCubeMesh();
    const sdf = buildMeshSDF(mesh, { resolution: 16, padding: 0.5 });
    const corner = sampleSDFTrilinear(sdf, { x: 0.8, y: 0.8, z: 0.8 });
    expect(corner).toBeGreaterThan(0);
  });

  it('unsigned SDF has no negatives', () => {
    const mesh = makeUnitCubeMesh();
    const sdf = buildMeshSDF(mesh, { resolution: 8, padding: 0.5, signed: false });
    let hasNegative = false;
    for (let i = 0; i < sdf.data.length; i++) {
      if (sdf.data[i] < 0) {
        hasNegative = true;
        break;
      }
    }
    expect(hasNegative).toBe(false);
  });

  it('stores bounds and voxelSize correctly', () => {
    const mesh = makeUnitCubeMesh();
    const sdf = buildMeshSDF(mesh, { resolution: 8, padding: 0.5 });
    expect(approxEq(sdf.boundsMin.x, -1.0)).toBe(true); // -0.5 - 0.5
    expect(approxEq(sdf.boundsMax.x, 1.0)).toBe(true); // 0.5 + 0.5
  });

  it('maxDistance truncates far voxels', () => {
    const mesh = makeUnitCubeMesh();
    const sdf = buildMeshSDF(mesh, {
      resolution: 8, padding: 0.5, maxDistance: 0.2,
    });
    // 远处体素应被截断到 maxDistance
    const far = sampleSDFTrilinear(sdf, { x: 0.95, y: 0.95, z: 0.95 });
    expect(far).toBeLessThanOrEqual(0.2 + 1e-3);
  });
});

// ── SDF 采样 ───────────────────────────────────────────────────

describe('sampleSDFNearest', () => {
  it('returns Infinity outside grid', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 8,
    );
    const v = sampleSDFNearest(sdf, { x: 10, y: 10, z: 10 });
    expect(v).toBe(Infinity);
  });

  it('returns valid value inside grid', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 8,
    );
    const v = sampleSDFNearest(sdf, { x: 0, y: 0, z: 0 });
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('sampleSDFTrilinear', () => {
  it('returns Infinity outside grid', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 8,
    );
    const v = sampleSDFTrilinear(sdf, { x: 10, y: 10, z: 10 });
    expect(v).toBe(Infinity);
  });

  it('returns smooth interpolated value', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const v = sampleSDFTrilinear(sdf, { x: 0.7, y: 0, z: 0 });
    expect(Number.isFinite(v)).toBe(true);
    // 0.7 在球(半径 0.5)外,应为正值
    expect(v).toBeGreaterThan(0);
  });
});

describe('sampleSDFGradient', () => {
  it('returns normalized vector', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const grad = sampleSDFGradient(sdf, { x: 0.7, y: 0, z: 0 });
    expect(vlength(grad)).toBeGreaterThan(0.99);
    expect(vlength(grad)).toBeLessThan(1.01);
  });

  it('gradient points outward for sphere', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const grad = sampleSDFGradient(sdf, { x: 0.7, y: 0, z: 0 });
    // 在 +X 方向,梯度应朝 +X
    expect(grad.x).toBeGreaterThan(0.5);
  });
});

// ── 球面追踪 ───────────────────────────────────────────────────

describe('rayMarchSDF', () => {
  it('hits sphere from outside', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const result = rayMarchSDF(
      sdf,
      { x: 0, y: 0, z: -2 },
      { x: 0, y: 0, z: 1 },
      10, 64,
    );
    expect(result.hit).toBe(true);
    expect(result.point.z).toBeGreaterThan(-0.6);
    expect(result.point.z).toBeLessThan(-0.4);
  });

  it('misses sphere', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const result = rayMarchSDF(
      sdf,
      { x: 5, y: 5, z: -2 },
      { x: 0, y: 0, z: 1 },
      10, 64,
    );
    expect(result.hit).toBe(false);
  });

  it('respects maxDistance', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const result = rayMarchSDF(
      sdf,
      { x: 0, y: 0, z: -2 },
      { x: 0, y: 0, z: -1 }, // 远离球
      1.0, 64, // maxDistance=1
    );
    expect(result.hit).toBe(false);
    expect(result.distance).toBeLessThanOrEqual(1.5);
  });

  it('respects maxSteps', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const result = rayMarchSDF(
      sdf,
      { x: 0, y: 0, z: -2 },
      { x: 0, y: 0, z: 1 },
      10, 1, // maxSteps=1
    );
    expect(result.steps).toBeLessThanOrEqual(1);
  });
});

// ── DFSS 距离场软阴影 ─────────────────────────────────────────

describe('dfssShadow', () => {
  it('fully lit when no occluder between point and light', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    // 球面上的点(0.5, 0, 0),光方向 +X(无遮挡)
    const visibility = dfssShadow(
      sdf,
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      Infinity,
      { lightSize: 0.1, maxDistance: 1.0 },
    );
    expect(visibility).toBeGreaterThan(0.9);
  });

  it('shadowed when occluder between point and light', () => {
    // 立方体遮挡器在原点,点在立方体后方
    const boundsMin = { x: -2, y: -1, z: -1 };
    const boundsMax = { x: 2, y: 1, z: 1 };
    const sdf = buildBoxSDF(
      { x: -0.3, y: -0.5, z: -0.5 }, { x: 0.3, y: 0.5, z: 0.5 },
      boundsMin, boundsMax, 16,
    );
    // 点在 (-1.0, 0, 0),光方向 +X(指向原点方向),盒子遮挡
    const visibility = dfssShadow(
      sdf,
      { x: -1.0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      Infinity,
      { lightSize: 0.1, maxDistance: 5.0 },
    );
    expect(visibility).toBeLessThan(0.5);
  });

  it('larger light size produces softer shadow', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    // 球后方的点,小光源 vs 大光源
    const vSmall = dfssShadow(
      sdf,
      { x: 0, y: 0, z: 0.6 },
      { x: 0, y: 0, z: 1 },
      Infinity,
      { lightSize: 0.05, maxDistance: 2.0 },
    );
    const vLarge = dfssShadow(
      sdf,
      { x: 0, y: 0, z: 0.6 },
      { x: 0, y: 0, z: 1 },
      Infinity,
      { lightSize: 0.5, maxDistance: 2.0 },
    );
    // 大光源 → 半影更宽 → 可见性更高(更软)
    expect(vLarge).toBeGreaterThanOrEqual(vSmall);
  });

  it('returns 0-1 range', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const v = dfssShadow(
      sdf,
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      Infinity,
    );
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

// ── DFAO 距离场环境光遮蔽 ─────────────────────────────────────

describe('dfao', () => {
  it('returns 0-1 range', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const ao = dfao(
      sdf,
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    expect(ao).toBeGreaterThanOrEqual(0);
    expect(ao).toBeLessThanOrEqual(1);
  });

  it('open surface has high AO (low occlusion)', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 }, 16,
    );
    // 球面上一点,法线朝外,周围空旷 → AO 高(接近 1)
    const ao = dfao(
      sdf,
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { radius: 0.5, numSamples: 8 },
    );
    expect(ao).toBeGreaterThan(0.5);
  });

  it('strength parameter affects AO intensity', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 16,
    );
    const aoLow = dfao(
      sdf,
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { strength: 0.1 },
    );
    const aoHigh = dfao(
      sdf,
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { strength: 2.0 },
    );
    // 高 strength → 更深 AO → ao 值更小
    expect(aoHigh).toBeLessThanOrEqual(aoLow);
  });
});

// ── 工具函数 ───────────────────────────────────────────────────

describe('sdfMemoryBytes / sdfMemoryMB', () => {
  it('computes correct memory size', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 8,
    );
    // 8³ = 512 体素 × 4 字节 = 2048 字节
    expect(sdfMemoryBytes(sdf)).toBe(2048);
    expect(sdfMemoryMB(sdf)).toBeCloseTo(2048 / (1024 * 1024), 6);
  });
});

describe('getSDFStats', () => {
  it('returns complete stats', () => {
    const sdf = buildSphereSDF(
      { x: 0, y: 0, z: 0 }, 0.5,
      { x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, 8,
    );
    const stats = getSDFStats(sdf);
    expect(stats.dimX).toBe(8);
    expect(stats.dimY).toBe(8);
    expect(stats.dimZ).toBe(8);
    expect(stats.totalVoxels).toBe(512);
    expect(stats.memoryMB).toBeCloseTo(2048 / (1024 * 1024), 6);
    expect(stats.bounds.min.x).toBe(-1);
    expect(stats.bounds.max.x).toBe(1);
    expect(stats.voxelSize.x).toBeCloseTo(0.25, 4);
  });
});

// ── GLSL chunks ────────────────────────────────────────────────

describe('GLSL chunks', () => {
  it('SDF_SAMPLE_GLSL contains key functions', () => {
    expect(SDF_SAMPLE_GLSL).toContain('sampleSDF');
    expect(SDF_SAMPLE_GLSL).toContain('sampleSDFGradient');
    expect(SDF_SAMPLE_GLSL).toContain('sampler3D');
  });

  it('DFSS_SHADOW_GLSL contains shadow function', () => {
    expect(DFSS_SHADOW_GLSL).toContain('dfssShadow');
    expect(DFSS_SHADOW_GLSL).toContain('penumbra');
    expect(DFSS_SHADOW_GLSL).toContain('minVisibility');
  });

  it('DFAO_GLSL contains AO function', () => {
    expect(DFAO_GLSL).toContain('dfao');
    expect(DFAO_GLSL).toContain('golden');
    expect(DFAO_GLSL).toContain('totalOcc');
  });

  it('MESH_DISTANCE_FIELD_GLSL combines all chunks', () => {
    expect(MESH_DISTANCE_FIELD_GLSL).toContain('sampleSDF');
    expect(MESH_DISTANCE_FIELD_GLSL).toContain('dfssShadow');
    expect(MESH_DISTANCE_FIELD_GLSL).toContain('dfao');
  });

  it('GLSL uses #version 300 es', () => {
    expect(SDF_SAMPLE_GLSL).toContain('#version 300 es');
    expect(DFSS_SHADOW_GLSL).toContain('#version 300 es');
    expect(DFAO_GLSL).toContain('#version 300 es');
  });
});
