// MeshletRenderer 单元测试。
//
// 覆盖:
//   1. buildMeshlets — 基本 meshlet 生成、顶点上限、三角形上限
//   2. computeMeshletBounds — 包围球 + 法线锥
//   3. meshletInFrustum — 视锥剔除
//   4. meshletIsFrontFacing — 背面剔除
//   5. meshletIsVisibleHZB — HZB 遮挡剔除
//   6. cullMeshlets — 完整管线
//   7. packMeshletDrawCommands — indirect draw 打包
//   8. buildMeshletVertexIndexBuffers — 合并缓冲
//   9. meshletStats — 统计

import { describe, it, expect } from 'vitest';
import {
  buildMeshlets,
  computeMeshletBounds,
  meshletInFrustum,
  meshletIsFrontFacing,
  meshletIsVisibleHZB,
  cullMeshlets,
  packMeshletDrawCommands,
  buildMeshletVertexIndexBuffers,
  meshletStats,
  type MeshletBounds,
} from './MeshletRenderer';

// ── 测试数据 ─────────────────────────────────────────────────────

/** 生成一个简单立方体的顶点 + 索引(12 三角形,36 索引)。 */
function makeCube(): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array([
    // 前 4 个顶点
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    // 后 4 个顶点
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    // 上 4 个顶点(重复,用于独立法线)
    -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, -1,
    // 下 4 个顶点
    -1, -1, 1, 1, -1, 1, 1, -1, -1, -1, -1, -1,
    // 右 4 个顶点
    1, -1, 1, 1, 1, 1, 1, 1, -1, 1, -1, -1,
    // 左 4 个顶点
    -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1,
  ]);

  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,       // 前
    4, 6, 5, 4, 7, 6,       // 后
    8, 9, 10, 8, 10, 11,    // 上
    12, 14, 13, 12, 15, 14, // 下
    16, 17, 18, 16, 18, 19, // 右
    20, 22, 21, 20, 23, 22, // 左
  ]);

  return { positions, indices };
}

/** 生成一个平面网格(width × height 个四边形)。 */
function makeGrid(width: number, height: number): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const positions: number[] = [];
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x <= width; x++) {
      positions.push(x, 0, y);
    }
  }

  const indices: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * (width + 1) + x;
      indices.push(i, i + width + 1, i + 1);
      indices.push(i + 1, i + width + 1, i + width + 2);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

// ── buildMeshlets ────────────────────────────────────────────────

describe('buildMeshlets', () => {
  it('generates at least 1 meshlet for a cube', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices);

    expect(result.meshletCount).toBeGreaterThanOrEqual(1);
    expect(result.triangleCount).toBe(12);
    expect(result.vertexCount).toBe(24);
  });

  it('respects maxVertices limit', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices, { maxVertices: 8 });

    // 每个 meshlet 最多 8 个顶点
    for (const m of result.meshlets) {
      expect(m.vertexCount).toBeLessThanOrEqual(8);
    }
  });

  it('respects maxTriangles limit', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices, { maxTriangles: 4 });

    // 每个 meshlet 最多 4 个三角形
    for (const m of result.meshlets) {
      expect(m.triangleCount).toBeLessThanOrEqual(4);
    }
  });

  it('all meshlet triangles reference valid local vertices', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices);

    for (const m of result.meshlets) {
      for (let i = 0; i < m.localTriangleIndices.length; i++) {
        expect(m.localTriangleIndices[i]).toBeGreaterThanOrEqual(0);
        expect(m.localTriangleIndices[i]).toBeLessThan(m.vertexCount);
      }
    }
  });

  it('globalVertexIndices reference valid original vertices', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices);

    for (const m of result.meshlets) {
      for (let i = 0; i < m.globalVertexIndices.length; i++) {
        expect(m.globalVertexIndices[i]).toBeGreaterThanOrEqual(0);
        expect(m.globalVertexIndices[i]).toBeLessThan(result.vertexCount);
      }
    }
  });

  it('splits a large grid into multiple meshlets', () => {
    const { positions, indices } = makeGrid(10, 10); // 100 quads = 200 triangles
    const result = buildMeshlets(positions, indices, { maxVertices: 32, maxTriangles: 64 });

    expect(result.meshletCount).toBeGreaterThan(1);
    expect(result.triangleCount).toBe(200);
  });

  it('clamps maxVertices to valid range', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices, { maxVertices: 999 });

    for (const m of result.meshlets) {
      expect(m.vertexCount).toBeLessThanOrEqual(256);
    }
  });

  it('clamps maxTriangles to valid range', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices, { maxTriangles: 999 });

    for (const m of result.meshlets) {
      expect(m.triangleCount).toBeLessThanOrEqual(512);
    }
  });

  it('handles a single triangle', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);

    const result = buildMeshlets(positions, indices);

    expect(result.meshletCount).toBe(1);
    expect(result.meshlets[0].triangleCount).toBe(1);
    expect(result.meshlets[0].vertexCount).toBe(3);
  });

  it('meshletIds are sequential starting from 0', () => {
    const { positions, indices } = makeCube();
    const result = buildMeshlets(positions, indices, { maxTriangles: 4 });

    for (let i = 0; i < result.meshlets.length; i++) {
      expect(result.meshlets[i].meshletId).toBe(i);
    }
  });
});

// ── computeMeshletBounds ─────────────────────────────────────────

describe('computeMeshletBounds', () => {
  it('computes bounding sphere center at AABB center', () => {
    const positions = new Float32Array([
      -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    ]);
    const globalIndices = new Uint32Array([0, 1, 2, 3]);
    const localTriangles = new Uint32Array([0, 1, 2, 0, 2, 3]);

    const bounds = computeMeshletBounds(0, positions, globalIndices, localTriangles, false);

    expect(bounds.center.x).toBeCloseTo(0, 5);
    expect(bounds.center.y).toBeCloseTo(0, 5);
    expect(bounds.center.z).toBeCloseTo(-1, 5);
  });

  it('radius covers all vertices', () => {
    const positions = new Float32Array([
      0, 0, 0, 2, 0, 0, 0, 2, 0,
    ]);
    const globalIndices = new Uint32Array([0, 1, 2]);
    const localTriangles = new Uint32Array([0, 1, 2]);

    const bounds = computeMeshletBounds(0, positions, globalIndices, localTriangles, false);

    // center ≈ (1, 1, 0), farthest vertex (0,0,0) → distance = sqrt(2) ≈ 1.414
    expect(bounds.radius).toBeGreaterThan(1.3);
    expect(bounds.radius).toBeLessThan(1.5);
  });

  it('computes normal cone when enabled', () => {
    // 平面三角形(法线朝 +Z)
    const positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]);
    const globalIndices = new Uint32Array([0, 1, 2]);
    const localTriangles = new Uint32Array([0, 1, 2]);

    const bounds = computeMeshletBounds(0, positions, globalIndices, localTriangles, true);

    // 法线锥轴向应接近 +Z
    expect(bounds.coneAxis.z).toBeGreaterThan(0.9);
    expect(bounds.coneCutoff).toBeGreaterThan(0.9); // 共面 → cutoff ≈ 1
  });

  it('skips normal cone when disabled', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const globalIndices = new Uint32Array([0, 1, 2]);
    const localTriangles = new Uint32Array([0, 1, 2]);

    const bounds = computeMeshletBounds(0, positions, globalIndices, localTriangles, false);

    expect(bounds.coneAxis.x).toBe(0);
    expect(bounds.coneAxis.y).toBe(0);
    expect(bounds.coneAxis.z).toBe(0);
  });
});

// ── meshletInFrustum ─────────────────────────────────────────────

describe('meshletInFrustum', () => {
  const makeBounds = (cx: number, cy: number, cz: number, r: number): MeshletBounds => ({
    meshletId: 0,
    center: { x: cx, y: cy, z: cz },
    radius: r,
    coneApex: { x: 0, y: 0, z: 0 },
    coneAxis: { x: 0, y: 0, z: 0 },
    coneCutoff: 0,
  });

  it('returns true for meshlet inside frustum', () => {
    const bounds = makeBounds(0, 0, 0, 1);
    // 6 个平面,所有平面 d=10(远),center 到平面距离 > -radius
    const planes = [
      [1, 0, 0, 10], [-1, 0, 0, 10],
      [0, 1, 0, 10], [0, -1, 0, 10],
      [0, 0, 1, 10], [0, 0, -1, 10],
    ];

    expect(meshletInFrustum(bounds, planes)).toBe(true);
  });

  it('returns false for meshlet outside frustum (X axis)', () => {
    const bounds = makeBounds(100, 0, 0, 1);
    const planes = [
      [1, 0, 0, 10], [-1, 0, 0, 10],
      [0, 1, 0, 10], [0, -1, 0, 10],
      [0, 0, 1, 10], [0, 0, -1, 10],
    ];

    // plane [-1, 0, 0, 10]: dist = -100 + 10 = -90 < -1 → outside
    expect(meshletInFrustum(bounds, planes)).toBe(false);
  });

  it('returns true for meshlet straddling a plane', () => {
    const bounds = makeBounds(9.5, 0, 0, 2);
    const planes = [
      [1, 0, 0, 10], [-1, 0, 0, 10],
      [0, 1, 0, 10], [0, -1, 0, 10],
      [0, 0, 1, 10], [0, 0, -1, 10],
    ];

    // plane [1,0,0,10]: dist = 9.5 + 10 = 19.5 > -2 → inside
    // plane [-1,0,0,10]: dist = -9.5 + 10 = 0.5 > -2 → inside (straddling)
    expect(meshletInFrustum(bounds, planes)).toBe(true);
  });
});

// ── meshletIsFrontFacing ─────────────────────────────────────────

describe('meshletIsFrontFacing', () => {
  it('returns true when view is on front side', () => {
    // 法线锥朝 +Z,视点在 +Z 方向
    const bounds: MeshletBounds = {
      meshletId: 0,
      center: { x: 0, y: 0, z: 0 },
      radius: 1,
      coneApex: { x: 0, y: 0, z: 0 },
      coneAxis: { x: 0, y: 0, z: 1 },
      coneCutoff: 0.9,
    };
    const viewPos = { x: 0, y: 0, z: 10 };

    // viewDir = normalize(apex - viewPos) = (0,0,-1)
    // dot(viewDir, axis) = -1 < 0.9 → front facing
    expect(meshletIsFrontFacing(bounds, viewPos)).toBe(true);
  });

  it('returns false when view is on back side', () => {
    // 法线锥朝 +Z,视点在 -Z 方向
    const bounds: MeshletBounds = {
      meshletId: 0,
      center: { x: 0, y: 0, z: 0 },
      radius: 1,
      coneApex: { x: 0, y: 0, z: 0 },
      coneAxis: { x: 0, y: 0, z: 1 },
      coneCutoff: 0.9,
    };
    const viewPos = { x: 0, y: 0, z: -10 };

    // viewDir = normalize(apex - viewPos) = (0,0,1)
    // dot(viewDir, axis) = 1 > 0.9 → back facing
    expect(meshletIsFrontFacing(bounds, viewPos)).toBe(false);
  });

  it('returns true when cone is not computed (zero axis)', () => {
    const bounds: MeshletBounds = {
      meshletId: 0,
      center: { x: 0, y: 0, z: 0 },
      radius: 1,
      coneApex: { x: 0, y: 0, z: 0 },
      coneAxis: { x: 0, y: 0, z: 0 },
      coneCutoff: 0,
    };

    expect(meshletIsFrontFacing(bounds, { x: 1, y: 1, z: 1 })).toBe(true);
  });
});

// ── meshletIsVisibleHZB ──────────────────────────────────────────

describe('meshletIsVisibleHZB', () => {
  // 简单的 HZB:64×64,深度全 0.5(远处)
  const hzbWidth = 64;
  const hzbHeight = 64;
  const hzb = new Float32Array(hzbWidth * hzbHeight).fill(0.5);

  // 单位矩阵作为 viewProj(简化测试)
  const identityVP = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];

  it('returns true for meshlet closer than HZB depth', () => {
    const bounds: MeshletBounds = {
      meshletId: 0,
      center: { x: 0, y: 0, z: 0.1 }, // 在相机前
      radius: 1,
      coneApex: { x: 0, y: 0, z: 0 },
      coneAxis: { x: 0, y: 0, z: 0 },
      coneCutoff: 0,
    };

    // ndcZ ≈ 0.1, HZB depth = 0.5 → 0.1 <= 0.5 → visible
    expect(meshletIsVisibleHZB(bounds, hzb, hzbWidth, hzbHeight, identityVP)).toBe(true);
  });

  it('returns false for meshlet behind HZB depth', () => {
    const bounds: MeshletBounds = {
      meshletId: 0,
      center: { x: 0, y: 0, z: 0.9 }, // 深度 0.9 > HZB 0.5
      radius: 0.01,
      coneApex: { x: 0, y: 0, z: 0 },
      coneAxis: { x: 0, y: 0, z: 0 },
      coneCutoff: 0,
    };

    expect(meshletIsVisibleHZB(bounds, hzb, hzbWidth, hzbHeight, identityVP)).toBe(false);
  });

  it('returns true when behind camera (clipW <= 0)', () => {
    const bounds: MeshletBounds = {
      meshletId: 0,
      center: { x: 0, y: 0, z: -1 }, // 在相机后面
      radius: 1,
      coneApex: { x: 0, y: 0, z: 0 },
      coneAxis: { x: 0, y: 0, z: 0 },
      coneCutoff: 0,
    };

    // clipW = 1*0 + 0 + 0 + 1*(-1) = -1 <= 0 → conservative visible
    expect(meshletIsVisibleHZB(bounds, hzb, hzbWidth, hzbHeight, identityVP)).toBe(true);
  });
});

// ── cullMeshlets ─────────────────────────────────────────────────

describe('cullMeshlets', () => {
  it('returns all meshlets visible when no culling enabled', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const result = cullMeshlets(buildResult, {
      frustumCulling: false,
      backfaceCulling: false,
      occlusionCulling: false,
    });

    expect(result.visibleCount).toBe(buildResult.meshletCount);
    expect(result.frustumCulled).toBe(0);
    expect(result.backfaceCulled).toBe(0);
    expect(result.occlusionCulled).toBe(0);
  });

  it('culls meshlets outside frustum', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    // 所有平面 d=-100(全部在视锥外)
    const planes = [
      [1, 0, 0, -100], [-1, 0, 0, -100],
      [0, 1, 0, -100], [0, -1, 0, -100],
      [0, 0, 1, -100], [0, 0, -1, -100],
    ];

    const result = cullMeshlets(buildResult, {
      frustumCulling: true,
      frustumPlanes: planes,
      backfaceCulling: false,
    });

    expect(result.visibleCount).toBe(0);
    expect(result.frustumCulled).toBe(buildResult.meshletCount);
  });

  it('culls backface meshlets', () => {
    // 创建法线朝 +Z 的平面
    const positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2]);
    const buildResult = buildMeshlets(positions, indices);

    // 视点在 -Z 方向(背面)
    const result = cullMeshlets(buildResult, {
      frustumCulling: false,
      backfaceCulling: true,
      viewPosition: { x: 0, y: 0, z: -10 },
    });

    expect(result.backfaceCulled).toBeGreaterThan(0);
    expect(result.visibleCount).toBe(0);
  });

  it('keeps frontface meshlets', () => {
    const positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2]);
    const buildResult = buildMeshlets(positions, indices);

    // 视点在 +Z 方向(正面)
    const result = cullMeshlets(buildResult, {
      frustumCulling: false,
      backfaceCulling: true,
      viewPosition: { x: 0, y: 0, z: 10 },
    });

    expect(result.backfaceCulled).toBe(0);
    expect(result.visibleCount).toBe(buildResult.meshletCount);
  });

  it('counts totalMeshlets correctly', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const result = cullMeshlets(buildResult, {});

    expect(result.totalMeshlets).toBe(buildResult.meshletCount);
  });
});

// ── packMeshletDrawCommands ──────────────────────────────────────

describe('packMeshletDrawCommands', () => {
  it('generates one command per visible meshlet', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const allIds = buildResult.meshlets.map((m) => m.meshletId);
    const commands = packMeshletDrawCommands(buildResult, allIds);

    expect(commands.length).toBe(buildResult.meshletCount);
  });

  it('generates commands only for visible meshlets', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    if (buildResult.meshletCount < 2) return;

    const visibleIds = [0]; // 只保留第一个
    const commands = packMeshletDrawCommands(buildResult, visibleIds);

    expect(commands.length).toBe(1);
    expect(commands[0].meshletId).toBe(0);
  });

  it('indexCount = triangleCount * 3', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const allIds = buildResult.meshlets.map((m) => m.meshletId);
    const commands = packMeshletDrawCommands(buildResult, allIds);

    for (let i = 0; i < commands.length; i++) {
      expect(commands[i].indexCount).toBe(buildResult.meshlets[i].triangleCount * 3);
    }
  });

  it('instanceCount is always 1', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const commands = packMeshletDrawCommands(
      buildResult,
      buildResult.meshlets.map((m) => m.meshletId),
    );

    for (const cmd of commands) {
      expect(cmd.instanceCount).toBe(1);
    }
  });

  it('firstInstance equals meshletId', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices, { maxTriangles: 4 });

    const commands = packMeshletDrawCommands(
      buildResult,
      buildResult.meshlets.map((m) => m.meshletId),
    );

    for (const cmd of commands) {
      expect(cmd.firstInstance).toBe(cmd.meshletId);
    }
  });

  it('vertexOffset and firstIndex are cumulative', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices, { maxTriangles: 4 });

    const commands = packMeshletDrawCommands(
      buildResult,
      buildResult.meshlets.map((m) => m.meshletId),
    );

    // 第一个 meshlet 偏移为 0
    expect(commands[0].vertexOffset).toBe(0);
    expect(commands[0].firstIndex).toBe(0);

    // 后续 meshlet 的偏移应递增
    for (let i = 1; i < commands.length; i++) {
      expect(commands[i].vertexOffset).toBeGreaterThan(commands[i - 1].vertexOffset);
      expect(commands[i].firstIndex).toBeGreaterThan(commands[i - 1].firstIndex);
    }
  });
});

// ── buildMeshletVertexIndexBuffers ───────────────────────────────

describe('buildMeshletVertexIndexBuffers', () => {
  it('generates merged vertex and index buffers', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const { vertices, indices: mergedIndices } = buildMeshletVertexIndexBuffers(
      buildResult,
      positions,
    );

    // 顶点数 = 所有 meshlet 顶点数之和
    let totalVerts = 0;
    for (const m of buildResult.meshlets) totalVerts += m.vertexCount;
    expect(vertices.length).toBe(totalVerts * 3);

    // 索引数 = 所有 meshlet 三角形数 * 3
    let totalIndices = 0;
    for (const m of buildResult.meshlets) totalIndices += m.triangleCount * 3;
    expect(mergedIndices.length).toBe(totalIndices);
  });

  it('merged indices reference valid vertices', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const { vertices, indices: mergedIndices } = buildMeshletVertexIndexBuffers(
      buildResult,
      positions,
    );

    const vertexCount = vertices.length / 3;
    for (let i = 0; i < mergedIndices.length; i++) {
      expect(mergedIndices[i]).toBeGreaterThanOrEqual(0);
      expect(mergedIndices[i]).toBeLessThan(vertexCount);
    }
  });
});

// ── meshletStats ─────────────────────────────────────────────────

describe('meshletStats', () => {
  it('returns correct meshletCount', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const stats = meshletStats(buildResult);
    expect(stats.meshletCount).toBe(buildResult.meshletCount);
  });

  it('avgTrianglesPerMeshlet is reasonable', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices, { maxTriangles: 4 });

    const stats = meshletStats(buildResult);
    expect(stats.avgTrianglesPerMeshlet).toBeGreaterThan(0);
    expect(stats.avgTrianglesPerMeshlet).toBeLessThanOrEqual(4);
  });

  it('avgVerticesPerMeshlet is reasonable', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices, { maxVertices: 8 });

    const stats = meshletStats(buildResult);
    expect(stats.avgVerticesPerMeshlet).toBeGreaterThan(0);
    expect(stats.avgVerticesPerMeshlet).toBeLessThanOrEqual(8);
  });

  it('totalTriangles equals original triangle count', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const stats = meshletStats(buildResult);
    expect(stats.totalTriangles).toBe(buildResult.triangleCount);
  });

  it('vertexReuseRatio is between 0 and 1', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices);

    const stats = meshletStats(buildResult);
    expect(stats.vertexReuseRatio).toBeGreaterThan(0);
    expect(stats.vertexReuseRatio).toBeLessThanOrEqual(1);
  });

  it('maxVertices and maxTriangles respect limits', () => {
    const { positions, indices } = makeCube();
    const buildResult = buildMeshlets(positions, indices, {
      maxVertices: 16,
      maxTriangles: 8,
    });

    const stats = meshletStats(buildResult);
    expect(stats.maxVertices).toBeLessThanOrEqual(16);
    expect(stats.maxTriangles).toBeLessThanOrEqual(8);
  });
});
