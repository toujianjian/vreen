// MarchingCubes 单元测试 (等值面提取)。
//
// 覆盖:
//   1. 构造默认值 + 自定义选项 + resolution 边界 [2, 256]
//   2. fromDensity 球体场 → 生成网格 (position 属性、三角形数、非索引)
//   3. 位置落在 [offset, offset+size] 边界内 + 包围盒 + 质心
//   4. computeNormals 开关 (法线属性存在/缺失) + 法线为单位长度
//   5. 空场 (全 0) / 满场 (全 1) → 空几何体
//   6. fromMetaballs 单球 / 双球融合 / 双球分离 / 空列表
//   7. 分辨率影响顶点数 (越高越多)
//   8. isoLevel 影响表面积 (越高越小)
//   9. fromField 原始数据 + 与 fromDensity 一致性 + 常量场
//  10. offset 偏移定位

import { describe, it, expect } from 'vitest';
import { MarchingCubes } from './MarchingCubes';
import { Vector3 } from '../Math/Vector3';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 球体密度场: density = 1 - |p|,球心处 = 1,半径 0.5 处 = 0.5。 */
function sphereDensity(x: number, y: number, z: number): number {
  return 1 - Math.sqrt(x * x + y * y + z * z);
}

/** 球心位于 (cx, cy, cz) 的球体密度场。 */
function sphereDensityAt(cx: number, cy: number, cz: number) {
  return (x: number, y: number, z: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    return 1 - Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
}

/** 顶点数 (position 属性 count)。 */
function vertexCount(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  return pos ? pos.count : 0;
}

/** 三角形数 (非索引几何体: position count / 3)。 */
function triangleCount(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  if (!pos) return 0;
  return pos.count / 3;
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('MarchingCubes construction', () => {
  it('defaults', () => {
    const mc = new MarchingCubes();
    expect(mc.resolution).toBe(32);
    expect(mc.isoLevel).toBeCloseTo(0.5);
    expect(mc.size).toBeCloseTo(1.0);
    expect(mc.offset.x).toBe(0);
    expect(mc.offset.y).toBe(0);
    expect(mc.offset.z).toBe(0);
    expect(mc.computeNormals).toBe(true);
  });

  it('accepts custom options', () => {
    const mc = new MarchingCubes({
      resolution: 24,
      isoLevel: 0.3,
      size: 2,
      offset: new Vector3(-1, -1, -1),
      computeNormals: false,
    });
    expect(mc.resolution).toBe(24);
    expect(mc.isoLevel).toBeCloseTo(0.3);
    expect(mc.size).toBeCloseTo(2);
    expect(mc.offset.x).toBe(-1);
    expect(mc.offset.y).toBe(-1);
    expect(mc.offset.z).toBe(-1);
    expect(mc.computeNormals).toBe(false);
  });

  it('clamps resolution to [2, 256] and floors non-integers', () => {
    expect(new MarchingCubes({ resolution: 1 }).resolution).toBe(2);
    expect(new MarchingCubes({ resolution: 0 }).resolution).toBe(2);
    expect(new MarchingCubes({ resolution: -10 }).resolution).toBe(2);
    expect(new MarchingCubes({ resolution: 1000 }).resolution).toBe(256);
    expect(new MarchingCubes({ resolution: 512 }).resolution).toBe(256);
    expect(new MarchingCubes({ resolution: 2.9 }).resolution).toBe(2);
    expect(new MarchingCubes({ resolution: 255.9 }).resolution).toBe(255);
  });
});

// ── fromDensity 球体 ─────────────────────────────────────────────────

describe('MarchingCubes fromDensity sphere', () => {
  // 网格 [-1,1]³,球心原点,半径 0.5 等值面完全位于网格内。
  const opts = { resolution: 16, isoLevel: 0.5, size: 2, offset: new Vector3(-1, -1, -1) };

  it('produces a mesh with positions', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(sphereDensity);
    expect(vertexCount(g)).toBeGreaterThan(0);
  });

  it('returns a BufferGeometry with a position attribute (count > 0)', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(sphereDensity);
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBeGreaterThan(0);
    expect(g.getAttribute('position')!.itemSize).toBe(3);
  });

  it('triangle count = position count / 3 (non-indexed)', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(sphereDensity);
    const pos = g.getAttribute('position')!;
    expect(pos.count % 3).toBe(0);
    expect(triangleCount(g)).toBe(pos.count / 3);
    expect(g.index).toBeNull();
  });

  it('positions are within [offset, offset+size] bounds', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(sphereDensity);
    const pos = g.getAttribute('position')!.array as Float32Array;
    const eps = 1e-6;
    for (let i = 0; i < pos.length; i++) {
      expect(pos[i]).toBeGreaterThanOrEqual(-1 - eps);
      expect(pos[i]).toBeLessThanOrEqual(1 + eps);
    }
  }, 30000);

  it('computes a bounding box', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(sphereDensity);
    expect(g.boundingBox).not.toBeNull();
    const { min, max } = g.boundingBox!;
    expect(min.x).toBeGreaterThanOrEqual(-1);
    expect(max.x).toBeLessThanOrEqual(1);
    expect(max.x - min.x).toBeGreaterThan(0);
  });

  it('vertex centroid is near the sphere center (origin)', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(sphereDensity);
    const pos = g.getAttribute('position')!.array as Float32Array;
    const n = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += pos[i * 3];
      cy += pos[i * 3 + 1];
      cz += pos[i * 3 + 2];
    }
    cx /= n; cy /= n; cz /= n;
    expect(Math.abs(cx)).toBeLessThan(0.1);
    expect(Math.abs(cy)).toBeLessThan(0.1);
    expect(Math.abs(cz)).toBeLessThan(0.1);
  });
});

// ── 法线 ─────────────────────────────────────────────────────────────
//
// 注意: 当某角点值恰好等于 isoLevel 时,多条边的插值点会重合于该角点,
// 产生退化三角形 (零面积) → 法线长度为 0。为避免这一情况,法线相关测试
// 使用奇数分辨率 (15): step = 2/15, r=0.5 要求 Σ(2k-15)² = 56.25 (非整数),
// 不可能,因此等值面不会精确穿过任何网格角点。

describe('MarchingCubes normals', () => {
  const opts = { resolution: 15, isoLevel: 0.5, size: 2, offset: new Vector3(-1, -1, -1) };

  it('computeNormals=true produces a normal attribute', () => {
    const mc = new MarchingCubes({ ...opts, computeNormals: true });
    const g = mc.fromDensity(sphereDensity);
    expect(g.getAttribute('normal')).toBeDefined();
    expect(g.getAttribute('normal')!.itemSize).toBe(3);
  });

  it('computeNormals=false has no normal attribute', () => {
    const mc = new MarchingCubes({ ...opts, computeNormals: false });
    const g = mc.fromDensity(sphereDensity);
    expect(g.getAttribute('normal')).toBeUndefined();
  });

  it('normals are unit length', () => {
    const mc = new MarchingCubes({ ...opts, computeNormals: true });
    const g = mc.fromDensity(sphereDensity);
    const nrm = g.getAttribute('normal')!.array as Float32Array;
    expect(nrm.length).toBeGreaterThan(0);
    for (let i = 0; i < nrm.length; i += 3) {
      const len = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
      expect(len).toBeCloseTo(1, 2);
    }
  });

  it('normal count matches position count', () => {
    const mc = new MarchingCubes({ ...opts, computeNormals: true });
    const g = mc.fromDensity(sphereDensity);
    expect(g.getAttribute('normal')!.count).toBe(g.getAttribute('position')!.count);
  });
});

// ── 空场 / 满场 ──────────────────────────────────────────────────────

describe('MarchingCubes empty and full fields', () => {
  const opts = { resolution: 8, isoLevel: 0.5, size: 2, offset: new Vector3(-1, -1, -1) };

  it('all-zero field produces empty geometry (0 triangles)', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(() => 0);
    expect(vertexCount(g)).toBe(0);
    expect(triangleCount(g)).toBe(0);
  });

  it('all-ones field produces empty geometry (0 triangles)', () => {
    const mc = new MarchingCubes(opts);
    const g = mc.fromDensity(() => 1);
    expect(vertexCount(g)).toBe(0);
    expect(triangleCount(g)).toBe(0);
  });
});

// ── fromMetaballs ────────────────────────────────────────────────────

describe('MarchingCubes fromMetaballs', () => {
  // 关闭法线计算以聚焦于顶点/三角形计数,避免退化三角形干扰。
  const baseOpts = {
    resolution: 24,
    size: 2,
    offset: new Vector3(-1, -1, -1),
    computeNormals: false,
  };

  it('single ball produces a mesh', () => {
    const g = MarchingCubes.fromMetaballs(
      [{ center: new Vector3(0, 0, 0), radiusSq: 0.3 }],
      baseOpts,
    );
    expect(vertexCount(g)).toBeGreaterThan(0);
  });

  it('two close balls (fusion) produce more vertices than the sum of isolated balls', () => {
    // 两球距离 0.2,场强叠加使等值面向外膨胀 → 融合面面积 > 两独立球面面积之和。
    const A = { center: new Vector3(-0.1, 0, 0), radiusSq: 0.2 };
    const B = { center: new Vector3(0.1, 0, 0), radiusSq: 0.2 };
    const countA = vertexCount(MarchingCubes.fromMetaballs([A], baseOpts));
    const countB = vertexCount(MarchingCubes.fromMetaballs([B], baseOpts));
    const countFused = vertexCount(MarchingCubes.fromMetaballs([A, B], baseOpts));
    expect(countFused).toBeGreaterThan(countA + countB);
  });

  it('two far-apart balls produce more triangles than a single ball (two surfaces)', () => {
    // 两球距离 1.2 (中心 ±0.6),中点密度 ≈ 0.435 < 0.5 → 两个分离表面。
    // 分离时三角形数约为单球的 2 倍。
    const A = { center: new Vector3(-0.6, 0, 0), radiusSq: 0.1 };
    const B = { center: new Vector3(0.6, 0, 0), radiusSq: 0.1 };
    const countSingle = triangleCount(MarchingCubes.fromMetaballs([A], baseOpts));
    const countFar = triangleCount(MarchingCubes.fromMetaballs([A, B], baseOpts));
    expect(countFar).toBeGreaterThan(countSingle);
    expect(countFar).toBeGreaterThan(countSingle * 1.5);
  });

  it('empty balls array produces empty geometry', () => {
    const g = MarchingCubes.fromMetaballs([], baseOpts);
    // 空 metaball 列表 → 密度恒为 0 → 无等值面
    expect(vertexCount(g)).toBe(0);
  });
});

// ── 分辨率与 isoLevel ────────────────────────────────────────────────

describe('MarchingCubes resolution and isoLevel', () => {
  const baseOpts = { size: 2, offset: new Vector3(-1, -1, -1), computeNormals: false };

  it('higher resolution produces more vertices', () => {
    const low = new MarchingCubes({ ...baseOpts, resolution: 12, isoLevel: 0.5 });
    const high = new MarchingCubes({ ...baseOpts, resolution: 28, isoLevel: 0.5 });
    const countLow = vertexCount(low.fromDensity(sphereDensity));
    const countHigh = vertexCount(high.fromDensity(sphereDensity));
    expect(countLow).toBeGreaterThan(0);
    expect(countHigh).toBeGreaterThan(countLow);
  });

  it('higher isoLevel produces a smaller surface (fewer triangles)', () => {
    // density = 1 - r, 等值面 r = 1 - isoLevel;isoLevel 越高 → r 越小 → 表面积越小。
    const low = new MarchingCubes({ ...baseOpts, resolution: 24, isoLevel: 0.3 });
    const high = new MarchingCubes({ ...baseOpts, resolution: 24, isoLevel: 0.8 });
    const countLow = triangleCount(low.fromDensity(sphereDensity));
    const countHigh = triangleCount(high.fromDensity(sphereDensity));
    expect(countHigh).toBeGreaterThan(0);
    expect(countHigh).toBeLessThan(countLow);
  });
});

// ── fromField ────────────────────────────────────────────────────────

describe('MarchingCubes fromField', () => {
  /** 把球体密度场采样到 (resolution+1)³ 的 Float32Array (z-y-x 排序)。 */
  function sampleSphere(resolution: number, size: number, offset: Vector3): Float32Array {
    const N = resolution + 1;
    const step = size / resolution;
    const field = new Float32Array(N * N * N);
    for (let zi = 0; zi < N; zi++) {
      const z = offset.z + zi * step;
      for (let yi = 0; yi < N; yi++) {
        const y = offset.y + yi * step;
        for (let xi = 0; xi < N; xi++) {
          const x = offset.x + xi * step;
          field[zi * N * N + yi * N + xi] = sphereDensity(x, y, z);
        }
      }
    }
    return field;
  }

  it('works with raw field data', () => {
    const resolution = 16;
    const size = 2;
    const offset = new Vector3(-1, -1, -1);
    const N = resolution + 1;
    const field = sampleSphere(resolution, size, offset);
    const mc = new MarchingCubes({ resolution, size, offset, computeNormals: false });
    const g = mc.fromField(field, N);
    expect(g.getAttribute('position')).toBeDefined();
    expect(vertexCount(g)).toBeGreaterThan(0);
  });

  it('fromField matches fromDensity for the same field', () => {
    const resolution = 16;
    const size = 2;
    const offset = new Vector3(-1, -1, -1);
    const N = resolution + 1;
    const field = sampleSphere(resolution, size, offset);
    const mc = new MarchingCubes({ resolution, size, offset, computeNormals: false });
    const fromFieldCount = vertexCount(mc.fromField(field, N));
    const fromDensityCount = vertexCount(mc.fromDensity(sphereDensity));
    expect(fromFieldCount).toBe(fromDensityCount);
  });

  it('constant raw field produces empty geometry', () => {
    const resolution = 8;
    const N = resolution + 1;
    const field = new Float32Array(N * N * N).fill(1); // 全 1 > isoLevel → 全内部
    const mc = new MarchingCubes({ resolution, isoLevel: 0.5, computeNormals: false });
    const g = mc.fromField(field, N);
    expect(vertexCount(g)).toBe(0);
  });
});

// ── offset 偏移 ──────────────────────────────────────────────────────

describe('MarchingCubes offset', () => {
  it('offset places the surface in the shifted region', () => {
    const offset = new Vector3(10, 20, 30);
    const size = 2;
    const resolution = 16;
    // 球心位于 offset + size/2 = (11, 21, 31)
    const mc = new MarchingCubes({ offset, size, resolution, computeNormals: false });
    const g = mc.fromDensity(sphereDensityAt(11, 21, 31));
    expect(vertexCount(g)).toBeGreaterThan(0);
    const pos = g.getAttribute('position')!.array as Float32Array;
    const eps = 1e-6;
    for (let i = 0; i < pos.length; i += 3) {
      expect(pos[i]).toBeGreaterThanOrEqual(10 - eps);
      expect(pos[i]).toBeLessThanOrEqual(12 + eps);
      expect(pos[i + 1]).toBeGreaterThanOrEqual(20 - eps);
      expect(pos[i + 1]).toBeLessThanOrEqual(22 + eps);
      expect(pos[i + 2]).toBeGreaterThanOrEqual(30 - eps);
      expect(pos[i + 2]).toBeLessThanOrEqual(32 + eps);
    }
    // 包围盒中心应接近球心 (11, 21, 31)
    const bb = g.boundingBox!;
    expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(11, 1);
    expect((bb.min.y + bb.max.y) / 2).toBeCloseTo(21, 1);
    expect((bb.min.z + bb.max.z) / 2).toBeCloseTo(31, 1);
  });
});