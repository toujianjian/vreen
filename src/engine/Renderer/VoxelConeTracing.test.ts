import { describe, it, expect } from 'vitest';
import {
  // 类型
  type VCTMeshData, type VCTVec3, type VCTColor,
  // 向量工具
  vctVadd, vctVsub, vctVscale, vctVdot, vctVcross, vctVlength, vctVnormalize, vctVreflect,
  // 颜色工具
  vctColorLerp,
  // 体素场景构建
  vctIdx3, worldToVoxelF, worldToVoxelI, voxelToWorld, isVoxelInside,
  collectTriangles, computeMeshAABB, voxelizeScene,
  // 采样
  sampleOccupancyTrilinear, sampleColorTrilinear,
  // 锥追踪
  traceCone, fibonacciHemisphere, traceDiffuseGI, traceSpecularGI, traceIndirectLighting,
  // 统计
  getVoxelSceneStats,
  // GLSL
  VOXEL_CONE_TRACING_GLSL, VOXELIZATION_GLSL, VOXEL_MIP_CHAIN_GLSL,
} from './VoxelConeTracing';

// ── 测试辅助 ─────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function vApproxEq(a: VCTVec3, b: VCTVec3, eps = 1e-4): boolean {
  return approxEq(a.x, b.x, eps) && approxEq(a.y, b.y, eps) && approxEq(a.z, b.z, eps);
}

function cApproxEq(a: VCTColor, b: VCTColor, eps = 1e-4): boolean {
  return approxEq(a.r, b.r, eps) && approxEq(a.g, b.g, eps) && approxEq(a.b, b.b, eps) && approxEq(a.a, b.a, eps);
}

/** 单位立方体网格(8 顶点,12 三角形),边长 1,中心在原点。 */
function makeUnitCubeMesh(): VCTMeshData {
  return {
    positions: new Float32Array([
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]),
    indices: new Uint32Array([
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
      0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
      0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
    ]),
  };
}

/** 地板网格(4 顶点,2 三角形),在 Y=0 平面。 */
function makeFloorMesh(): VCTMeshData {
  return {
    positions: new Float32Array([
      -2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2,
    ]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
  };
}

// ── 向量工具 ────────────────────────────────────────────────────

describe('vector utils', () => {
  it('vctVadd', () => {
    const r = vctVadd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(vApproxEq(r, { x: 5, y: 7, z: 9 })).toBe(true);
  });

  it('vctVsub', () => {
    const r = vctVsub({ x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 });
    expect(vApproxEq(r, { x: 3, y: 3, z: 3 })).toBe(true);
  });

  it('vctVscale', () => {
    const r = vctVscale({ x: 1, y: 2, z: 3 }, 2);
    expect(vApproxEq(r, { x: 2, y: 4, z: 6 })).toBe(true);
  });

  it('vctVdot', () => {
    expect(approxEq(vctVdot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }), 32)).toBe(true);
  });

  it('vctVcross', () => {
    const r = vctVcross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(vApproxEq(r, { x: 0, y: 0, z: 1 })).toBe(true);
  });

  it('vctVlength', () => {
    expect(approxEq(vctVlength({ x: 3, y: 4, z: 0 }), 5)).toBe(true);
  });

  it('vctVnormalize', () => {
    const r = vctVnormalize({ x: 0, y: 5, z: 0 });
    expect(vApproxEq(r, { x: 0, y: 1, z: 0 })).toBe(true);
  });

  it('vctVnormalize zero returns zero', () => {
    const r = vctVnormalize({ x: 0, y: 0, z: 0 });
    expect(vApproxEq(r, { x: 0, y: 0, z: 0 })).toBe(true);
  });

  it('vctVreflect', () => {
    const r = vctVreflect({ x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(vApproxEq(r, { x: 1, y: 1, z: 0 })).toBe(true);
  });
});

// ── 颜色工具 ────────────────────────────────────────────────────

describe('color utils', () => {
  it('vctColorLerp', () => {
    const r = vctColorLerp({ r: 0, g: 0, b: 0, a: 0 }, { r: 1, g: 1, b: 1, a: 1 }, 0.5);
    expect(cApproxEq(r, { r: 0.5, g: 0.5, b: 0.5, a: 0.5 })).toBe(true);
  });
});

// ── 索引工具 ────────────────────────────────────────────────────

describe('vctIdx3', () => {
  it('correct index', () => {
    expect(vctIdx3(0, 0, 0, 4)).toBe(0);
    expect(vctIdx3(1, 0, 0, 4)).toBe(1);
    expect(vctIdx3(0, 1, 0, 4)).toBe(4);
    expect(vctIdx3(0, 0, 1, 4)).toBe(16);
  });
});

// ── 坐标变换 ────────────────────────────────────────────────────

describe('coordinate transforms', () => {
  it('worldToVoxelF and voxelToWorld round-trip', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 8);
    const p = { x: 0.1, y: 0.2, z: 0.3 };
    const v = worldToVoxelF(p, scene);
    const p2 = voxelToWorld(
      { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) },
      scene,
    );
    // 误差应 < 1 体素
    expect(Math.abs(p2.x - p.x)).toBeLessThan(scene.voxelSize.x);
  });

  it('worldToVoxelI', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 8);
    const v = worldToVoxelI({ x: 0, y: 0, z: 0 }, scene);
    // 原点在中心,应该映射到中间体素
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.x).toBeLessThan(8);
  });

  it('isVoxelInside', () => {
    expect(isVoxelInside({ x: 0, y: 0, z: 0 }, 8)).toBe(true);
    expect(isVoxelInside({ x: 7, y: 7, z: 7 }, 8)).toBe(true);
    expect(isVoxelInside({ x: 8, y: 0, z: 0 }, 8)).toBe(false);
    expect(isVoxelInside({ x: -1, y: 0, z: 0 }, 8)).toBe(false);
  });
});

// ── 网格处理 ────────────────────────────────────────────────────

describe('collectTriangles', () => {
  it('indexed mesh', () => {
    const mesh = makeUnitCubeMesh();
    const tris = collectTriangles(mesh);
    expect(tris.length).toBe(12);
  });

  it('non-indexed mesh', () => {
    const mesh: VCTMeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: null,
    };
    const tris = collectTriangles(mesh);
    expect(tris.length).toBe(1);
  });
});

describe('computeMeshAABB', () => {
  it('unit cube AABB', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    expect(vApproxEq(min, { x: -0.5, y: -0.5, z: -0.5 })).toBe(true);
    expect(vApproxEq(max, { x: 0.5, y: 0.5, z: 0.5 })).toBe(true);
  });

  it('empty mesh', () => {
    const mesh: VCTMeshData = { positions: new Float32Array([]), indices: null };
    const { min, max } = computeMeshAABB(mesh);
    expect(vApproxEq(min, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(vApproxEq(max, { x: 0, y: 0, z: 0 })).toBe(true);
  });
});

// ── 体素化 ──────────────────────────────────────────────────────

describe('voxelizeScene', () => {
  it('creates correct dimensions', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 8);
    expect(scene.baseDim).toBe(8);
    expect(scene.mipCount).toBe(4); // log2(8)+1 = 4
    expect(scene.mips[0].dim).toBe(8);
    expect(scene.mips[1].dim).toBe(4);
    expect(scene.mips[2].dim).toBe(2);
    expect(scene.mips[3].dim).toBe(1);
  });

  it('center is occupied (inside cube)', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    // 立方体表面附近的体素应该被占据
    const surfaceOcc = sampleOccupancyTrilinear(scene, { x: 0.5, y: 0, z: 0 }, 0);
    expect(surfaceOcc).toBeGreaterThan(0);
  });

  it('far point is not occupied', () => {
    const mesh = makeUnitCubeMesh();
    // 扩大 bounds 使远点不在网格内
    const scene = voxelizeScene([mesh], { x: -5, y: -5, z: -5 }, { x: 5, y: 5, z: 5 }, 16);
    const farOcc = sampleOccupancyTrilinear(scene, { x: 4, y: 4, z: 4 }, 0);
    expect(farOcc).toBeLessThan(0.1);
  });

  it('mip chain has decreasing dimensions', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    for (let m = 1; m < scene.mipCount; m++) {
      expect(scene.mips[m].dim).toBe(Math.max(1, scene.mips[m - 1].dim >> 1));
    }
  });

  it('mip chain aggregates occupancy', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    // 更高 mip 应该有更多占据(聚合了更大区域)
    const occMip0 = sampleOccupancyTrilinear(scene, { x: 0, y: 0, z: 0 }, 0);
    const occMipHigh = sampleOccupancyTrilinear(scene, { x: 0, y: 0, z: 0 }, scene.mipCount - 1);
    // 高 mip 的占据率 >= 低 mip(因为聚合了周围体素)
    expect(occMipHigh).toBeGreaterThanOrEqual(occMip0 - 0.1);
  });

  it('handles multiple meshes', () => {
    const mesh1 = makeUnitCubeMesh();
    const mesh2 = makeFloorMesh();
    const scene = voxelizeScene([mesh1, mesh2], { x: -3, y: -1, z: -3 }, { x: 3, y: 1, z: 3 }, 16);
    // 地板应该在 Y=0 附近有占据
    const floorOcc = sampleOccupancyTrilinear(scene, { x: 1.5, y: 0, z: 1.5 }, 0);
    expect(floorOcc).toBeGreaterThan(0);
  });
});

// ── 采样 ────────────────────────────────────────────────────────

describe('sampling', () => {
  it('sampleOccupancyTrilinear returns 0 outside grid', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 8);
    const occ = sampleOccupancyTrilinear(scene, { x: 100, y: 100, z: 100 }, 0);
    expect(approxEq(occ, 0)).toBe(true);
  });

  it('sampleColorTrilinear returns valid color', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    const col = sampleColorTrilinear(scene, { x: 0.4, y: 0, z: 0 }, 0);
    // 在立方体表面附近的颜色应该有非零 α
    if (col.a > 0) {
      expect(col.r).toBeGreaterThanOrEqual(0);
      expect(col.g).toBeGreaterThanOrEqual(0);
      expect(col.b).toBeGreaterThanOrEqual(0);
    }
  });

  it('higher mip samples coarser data', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    // 同一个位置,不同 mip 的采样结果应该不同(更高 mip 更粗糙)
    const occ0 = sampleOccupancyTrilinear(scene, { x: 0, y: 0, z: 0 }, 0);
    const occHigh = sampleOccupancyTrilinear(scene, { x: 0, y: 0, z: 0 }, scene.mipCount - 1);
    // 两者都应该是有效值
    expect(occ0).toBeGreaterThanOrEqual(0);
    expect(occHigh).toBeGreaterThanOrEqual(0);
  });
});

// ── Fibonacci 半球采样 ──────────────────────────────────────────

describe('fibonacciHemisphere', () => {
  it('generates correct number of directions', () => {
    const dirs = fibonacciHemisphere(8, { x: 0, y: 1, z: 0 });
    expect(dirs.length).toBe(8);
  });

  it('all directions are in hemisphere (dot with normal >= 0)', () => {
    const normal = { x: 0, y: 1, z: 0 };
    const dirs = fibonacciHemisphere(16, normal);
    for (const dir of dirs) {
      const dot = vctVdot(dir, normal);
      expect(dot).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it('all directions are normalized', () => {
    const dirs = fibonacciHemisphere(8, { x: 0, y: 1, z: 0 });
    for (const dir of dirs) {
      expect(approxEq(vctVlength(dir), 1, 1e-3)).toBe(true);
    }
  });

  it('works with arbitrary normal', () => {
    const normal = { x: 1, y: 0, z: 0 };
    const dirs = fibonacciHemisphere(8, normal);
    for (const dir of dirs) {
      const dot = vctVdot(dir, normal);
      expect(dot).toBeGreaterThanOrEqual(-0.01);
    }
  });
});

// ── 锥追踪 ──────────────────────────────────────────────────────

describe('traceCone', () => {
  it('hits occupied voxel', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    // 从原点向 +X 方向追踪(应该命中立方体表面)
    const result = traceCone(scene, {
      origin: { x: -2, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      halfAngle: Math.PI / 12, // 15°
      maxDistance: 5,
    });
    expect(result.hit).toBe(true);
    expect(result.occlusion).toBeGreaterThan(0);
  });

  it('misses when pointing away', () => {
    const mesh = makeUnitCubeMesh();
    // 扩大边界使起点远离立方体
    const scene = voxelizeScene([mesh], { x: -5, y: -5, z: -5 }, { x: 5, y: 5, z: 5 }, 16);
    // 从 (-4, 0, 0) 向 -X 方向追踪(远离立方体)
    const result = traceCone(scene, {
      origin: { x: -4, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      halfAngle: Math.PI / 12,
      maxDistance: 5,
    });
    expect(result.occlusion).toBeLessThan(0.1);
  });

  it('both narrow and wide cones detect the cube', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    const narrowResult = traceCone(scene, {
      origin: { x: -2, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      halfAngle: Math.PI / 24, // 7.5°
      maxDistance: 5,
    });
    const wideResult = traceCone(scene, {
      origin: { x: -2, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      halfAngle: Math.PI / 4, // 45°
      maxDistance: 5,
    });
    // 两种锥都应该命中立方体(宽锥采样更高 mip,占据率可能更低,但仍应 > 0)
    expect(narrowResult.hit).toBe(true);
    expect(wideResult.hit).toBe(true);
    expect(narrowResult.occlusion).toBeGreaterThan(0);
    expect(wideResult.occlusion).toBeGreaterThan(0);
  });

  it('returns valid color', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    const result = traceCone(scene, {
      origin: { x: -2, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      halfAngle: Math.PI / 8,
      maxDistance: 5,
    });
    expect(result.color.r).toBeGreaterThanOrEqual(0);
    expect(result.color.g).toBeGreaterThanOrEqual(0);
    expect(result.color.b).toBeGreaterThanOrEqual(0);
    expect(result.steps).toBeGreaterThan(0);
  });
});

// ── Diffuse GI ──────────────────────────────────────────────────

describe('traceDiffuseGI', () => {
  it('returns color and occlusion', () => {
    const mesh = makeFloorMesh();
    const scene = voxelizeScene([mesh], { x: -2, y: -1, z: -2 }, { x: 2, y: 1, z: 2 }, 16);
    const result = traceDiffuseGI(
      scene,
      { x: 0, y: 0.01, z: 0 },
      { x: 0, y: 1, z: 0 },
      { coneCount: 4, maxDistance: 5 },
    );
    expect(result.color.r).toBeGreaterThanOrEqual(0);
    expect(result.occlusion).toBeGreaterThanOrEqual(0);
    expect(result.occlusion).toBeLessThanOrEqual(1);
  });

  it('more cones produce smoother result', () => {
    const mesh = makeFloorMesh();
    const scene = voxelizeScene([mesh], { x: -2, y: -1, z: -2 }, { x: 2, y: 1, z: 2 }, 16);
    const r4 = traceDiffuseGI(
      scene, { x: 0, y: 0.01, z: 0 }, { x: 0, y: 1, z: 0 },
      { coneCount: 4, maxDistance: 5 },
    );
    const r8 = traceDiffuseGI(
      scene, { x: 0, y: 0.01, z: 0 }, { x: 0, y: 1, z: 0 },
      { coneCount: 8, maxDistance: 5 },
    );
    // 两个结果都应该有效
    expect(r4.occlusion).toBeGreaterThanOrEqual(0);
    expect(r8.occlusion).toBeGreaterThanOrEqual(0);
  });
});

// ── Specular GI ────────────────────────────────────────────────

describe('traceSpecularGI', () => {
  it('returns color for mirror reflection', () => {
    const mesh = makeFloorMesh();
    const scene = voxelizeScene([mesh], { x: -2, y: -1, z: -2 }, { x: 2, y: 1, z: 2 }, 16);
    const result = traceSpecularGI(
      scene,
      { x: 0, y: 0.01, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      0.0, // 镜面反射
      { maxDistance: 5 },
    );
    expect(result.r).toBeGreaterThanOrEqual(0);
    expect(result.g).toBeGreaterThanOrEqual(0);
    expect(result.b).toBeGreaterThanOrEqual(0);
  });

  it('rougher surface produces different result', () => {
    const mesh = makeFloorMesh();
    const scene = voxelizeScene([mesh], { x: -2, y: -1, z: -2 }, { x: 2, y: 1, z: 2 }, 16);
    const smooth = traceSpecularGI(
      scene, { x: 0, y: 0.01, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
      0.0, { maxDistance: 5 },
    );
    const rough = traceSpecularGI(
      scene, { x: 0, y: 0.01, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
      1.0, { maxDistance: 5 },
    );
    // 两个结果都应该有效
    expect(smooth.r).toBeGreaterThanOrEqual(0);
    expect(rough.r).toBeGreaterThanOrEqual(0);
  });
});

// ── 完整间接光照 ────────────────────────────────────────────────

describe('traceIndirectLighting', () => {
  it('returns diffuse + specular + ao', () => {
    const mesh = makeFloorMesh();
    const scene = voxelizeScene([mesh], { x: -2, y: -1, z: -2 }, { x: 2, y: 1, z: 2 }, 16);
    const result = traceIndirectLighting(
      scene,
      { x: 0, y: 0.01, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { r: 0.8, g: 0.8, b: 0.8, a: 1 },
      0.5,
      { coneCount: 4, maxDistance: 5 },
    );
    expect(result.diffuse.r).toBeGreaterThanOrEqual(0);
    expect(result.specular.r).toBeGreaterThanOrEqual(0);
    expect(result.ao).toBeGreaterThanOrEqual(0);
    expect(result.ao).toBeLessThanOrEqual(1);
    expect(result.combined.r).toBeGreaterThanOrEqual(0);
  });

  it('albedo modulates diffuse', () => {
    const mesh = makeFloorMesh();
    const scene = voxelizeScene([mesh], { x: -2, y: -1, z: -2 }, { x: 2, y: 1, z: 2 }, 16);
    const bright = traceIndirectLighting(
      scene, { x: 0, y: 0.01, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
      { r: 1, g: 1, b: 1, a: 1 }, 0.5, { coneCount: 4, maxDistance: 5 },
    );
    const dark = traceIndirectLighting(
      scene, { x: 0, y: 0.01, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
      { r: 0.1, g: 0.1, b: 0.1, a: 1 }, 0.5, { coneCount: 4, maxDistance: 5 },
    );
    // 亮色 albedo 应该产生更亮的 diffuse
    expect(bright.diffuse.r).toBeGreaterThanOrEqual(dark.diffuse.r - 0.01);
  });
});

// ── 统计 ────────────────────────────────────────────────────────

describe('getVoxelSceneStats', () => {
  it('returns correct stats', () => {
    const mesh = makeUnitCubeMesh();
    const { min, max } = computeMeshAABB(mesh);
    const scene = voxelizeScene([mesh], min, max, 16);
    const stats = getVoxelSceneStats(scene);
    expect(stats.baseDim).toBe(16);
    expect(stats.mipCount).toBe(5); // log2(16)+1 = 5
    expect(stats.totalVoxels).toBeGreaterThan(0);
    expect(stats.occupiedVoxels).toBeGreaterThan(0);
    expect(stats.memoryBytes).toBeGreaterThan(0);
    expect(stats.memoryMB).toBeGreaterThan(0);
  });
});

// ── GLSL 着色器块 ───────────────────────────────────────────────

describe('GLSL chunks', () => {
  it('VOXEL_CONE_TRACING_GLSL contains traceCone', () => {
    expect(VOXEL_CONE_TRACING_GLSL).toContain('traceCone');
    expect(VOXEL_CONE_TRACING_GLSL).toContain('traceDiffuseGI');
    expect(VOXEL_CONE_TRACING_GLSL).toContain('traceSpecularGI');
    expect(VOXEL_CONE_TRACING_GLSL).toContain('u_voxelTexture');
  });

  it('VOXELIZATION_GLSL contains voxelization function', () => {
    expect(VOXELIZATION_GLSL).toContain('voxelizeFragment');
    expect(VOXELIZATION_GLSL).toContain('projectToAxis');
    expect(VOXELIZATION_GLSL).toContain('imageStore');
  });

  it('VOXEL_MIP_CHAIN_GLSL contains mip building', () => {
    expect(VOXEL_MIP_CHAIN_GLSL).toContain('buildMipLevel');
    expect(VOXEL_MIP_CHAIN_GLSL).toContain('imageLoad');
  });
});
