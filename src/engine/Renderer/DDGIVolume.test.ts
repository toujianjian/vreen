// DDGIVolume 单元测试。
//
// 覆盖:
//   1. packProbeIndex / unpackProbeIndex(3D↔1D 转换,往返一致性)
//   2. computeTrilinearWeights(权重和=1,边界值,对称性)
//   3. blendProbeSH(加权平均,零权重跳过)
//   4. probeOcclusionWeight(范围内=1,范围外衰减,无深度=1)
//   5. DDGIVolume 构造(默认值,选项,totalProbes)
//   6. getProbePosition(世界位置计算)
//   7. updateProbe(首帧写入,时序累积)
//   8. sampleIrradiance(未初始化=0,更新后≠0,插值正确性)
//   9. reset / validProbeCount

import { describe, it, expect } from 'vitest';
import {
  DDGIVolume,
  packProbeIndex,
  unpackProbeIndex,
  computeTrilinearWeights,
  blendProbeSH,
  probeOcclusionWeight,
  type IVec3,
} from './DDGIVolume';
import { Vector3 } from '../Math/Vector3';
import { SH2_RGB_FLOATS } from './GlobalIllumination';

// ── packProbeIndex / unpackProbeIndex ────────────────────────────

describe('packProbeIndex / unpackProbeIndex', () => {
  it('packs 3D → 1D correctly (row-major: x inner, y mid, z outer)', () => {
    const dims: IVec3 = { x: 4, y: 3, z: 2 };
    expect(packProbeIndex({ x: 0, y: 0, z: 0 }, dims)).toBe(0);
    expect(packProbeIndex({ x: 1, y: 0, z: 0 }, dims)).toBe(1);
    expect(packProbeIndex({ x: 3, y: 0, z: 0 }, dims)).toBe(3);
    expect(packProbeIndex({ x: 0, y: 1, z: 0 }, dims)).toBe(4);
    expect(packProbeIndex({ x: 0, y: 0, z: 1 }, dims)).toBe(12);
    expect(packProbeIndex({ x: 3, y: 2, z: 1 }, dims)).toBe(23); // max
  });

  it('unpacks 1D → 3D correctly', () => {
    const dims: IVec3 = { x: 4, y: 3, z: 2 };
    expect(unpackProbeIndex(0, dims)).toEqual({ x: 0, y: 0, z: 0 });
    expect(unpackProbeIndex(1, dims)).toEqual({ x: 1, y: 0, z: 0 });
    expect(unpackProbeIndex(4, dims)).toEqual({ x: 0, y: 1, z: 0 });
    expect(unpackProbeIndex(12, dims)).toEqual({ x: 0, y: 0, z: 1 });
    expect(unpackProbeIndex(23, dims)).toEqual({ x: 3, y: 2, z: 1 });
  });

  it('round-trip: pack(unpack(i)) = i for all indices', () => {
    const dims: IVec3 = { x: 5, y: 4, z: 3 };
    const total = dims.x * dims.y * dims.z;
    for (let i = 0; i < total; i++) {
      const idx3d = unpackProbeIndex(i, dims);
      expect(packProbeIndex(idx3d, dims)).toBe(i);
    }
  });

  it('round-trip: unpack(pack(idx)) = idx for all 3D indices', () => {
    const dims: IVec3 = { x: 3, y: 3, z: 3 };
    for (let z = 0; z < dims.z; z++) {
      for (let y = 0; y < dims.y; y++) {
        for (let x = 0; x < dims.x; x++) {
          const idx: IVec3 = { x, y, z };
          const linear = packProbeIndex(idx, dims);
          expect(unpackProbeIndex(linear, dims)).toEqual(idx);
        }
      }
    }
  });
});

// ── computeTrilinearWeights ──────────────────────────────────────

describe('computeTrilinearWeights', () => {
  it('weights sum to 1 for any position', () => {
    for (let i = 0; i < 100; i++) {
      const pos: IVec3 = { x: Math.random(), y: Math.random(), z: Math.random() };
      const w = computeTrilinearWeights(pos);
      const sum = w.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    }
  });

  it('at (0,0,0): only corner 0 has weight 1', () => {
    const w = computeTrilinearWeights({ x: 0, y: 0, z: 0 });
    expect(w[0]).toBeCloseTo(1, 10);
    for (let i = 1; i < 8; i++) expect(w[i]).toBeCloseTo(0, 10);
  });

  it('at (1,1,1): only corner 7 has weight 1', () => {
    const w = computeTrilinearWeights({ x: 1, y: 1, z: 1 });
    expect(w[7]).toBeCloseTo(1, 10);
    for (let i = 0; i < 7; i++) expect(w[i]).toBeCloseTo(0, 10);
  });

  it('at (0.5, 0.5, 0.5): all 8 corners equal weight 1/8', () => {
    const w = computeTrilinearWeights({ x: 0.5, y: 0.5, z: 0.5 });
    for (let i = 0; i < 8; i++) {
      expect(w[i]).toBeCloseTo(0.125, 10);
    }
  });

  it('clamps out-of-range positions to [0,1]', () => {
    const w = computeTrilinearWeights({ x: -1, y: 2, z: 0.5 });
    // x clamped to 0, y clamped to 1, z = 0.5
    // Should equal weights at (0, 1, 0.5)
    const expected = computeTrilinearWeights({ x: 0, y: 1, z: 0.5 });
    for (let i = 0; i < 8; i++) {
      expect(w[i]).toBeCloseTo(expected[i], 10);
    }
  });

  it('all weights are non-negative', () => {
    for (let i = 0; i < 100; i++) {
      const pos: IVec3 = { x: Math.random(), y: Math.random(), z: Math.random() };
      const w = computeTrilinearWeights(pos);
      for (const wi of w) expect(wi).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── blendProbeSH ─────────────────────────────────────────────────

describe('blendProbeSH', () => {
  it('returns weighted average of 8 probes', () => {
    // 8 个探针,每个只有 SH[0](Y00 项)不同
    const probeSH: Float32Array[] = [];
    for (let i = 0; i < 8; i++) {
      const sh = new Float32Array(SH2_RGB_FLOATS);
      sh[0] = i * 10; // SH[0] = i*10
      probeSH.push(sh);
    }
    const weights = [0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125];
    const blended = blendProbeSH(probeSH, weights);
    // 期望 = sum(i*10 * 0.125) = 10 * 0.125 * (0+1+...+7) = 10 * 0.125 * 28 = 35
    expect(blended[0]).toBeCloseTo(35, 5);
  });

  it('handles zero-weight probes (skips them)', () => {
    const probeSH: Float32Array[] = [];
    for (let i = 0; i < 8; i++) {
      const sh = new Float32Array(SH2_RGB_FLOATS);
      sh[0] = i;
      probeSH.push(sh);
    }
    // 只有探针 0 和 7 有权重
    const weights = [0.5, 0, 0, 0, 0, 0, 0, 0.5];
    const blended = blendProbeSH(probeSH, weights);
    // 0*0.5 + 7*0.5 = 3.5
    expect(blended[0]).toBeCloseTo(3.5, 5);
  });

  it('returns zeros if all weights are 0', () => {
    const probeSH: Float32Array[] = [];
    for (let i = 0; i < 8; i++) {
      const sh = new Float32Array(SH2_RGB_FLOATS);
      sh[0] = 100;
      probeSH.push(sh);
    }
    const weights = [0, 0, 0, 0, 0, 0, 0, 0];
    const blended = blendProbeSH(probeSH, weights);
    for (let i = 0; i < SH2_RGB_FLOATS; i++) {
      expect(blended[i]).toBe(0);
    }
  });
});

// ── probeOcclusionWeight ─────────────────────────────────────────

describe('probeOcclusionWeight', () => {
  it('returns 1 when probeDepth <= 0 (no depth data)', () => {
    expect(probeOcclusionWeight(10, 0)).toBe(1);
    expect(probeOcclusionWeight(10, -1)).toBe(1);
  });

  it('returns 1 when probeDistance is within probe depth', () => {
    expect(probeOcclusionWeight(2, 5, 0.2)).toBe(1); // 2 < 5+0.2
    expect(probeOcclusionWeight(5, 5, 0.2)).toBe(1); // 5 < 5+0.2
  });

  it('returns < 1 when probeDistance exceeds depth (occluded)', () => {
    const w = probeOcclusionWeight(10, 5, 0.2);
    expect(w).toBeLessThan(1);
    expect(w).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 when probeDistance is very far beyond depth', () => {
    const w = probeOcclusionWeight(1000, 1, 0.2);
    expect(w).toBeCloseTo(0, 2);
  });

  it('monotonically decreasing with increasing distance', () => {
    let prev = 2;
    for (let d = 1; d <= 20; d += 1) {
      const w = probeOcclusionWeight(d, 5, 0.2);
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
  });
});

// ── DDGIVolume 构造 ──────────────────────────────────────────────

describe('DDGIVolume construction', () => {
  it('defaults: 4×4×4=64 probes, cellSize 4, raysPerProbe 32', () => {
    const v = new DDGIVolume();
    expect(v.probeCount).toEqual({ x: 4, y: 4, z: 4 });
    expect(v.totalProbes).toBe(64);
    expect(v.cellSize.x).toBe(4);
    expect(v.raysPerProbe).toBe(32);
    expect(v.historyWeight).toBe(0.9);
    expect(v.occlusionBias).toBe(0.2);
    expect(v.probes.length).toBe(64 * SH2_RGB_FLOATS);
    expect(v.probeDepths.length).toBe(64);
  });

  it('accepts all options', () => {
    const v = new DDGIVolume({
      origin: new Vector3(-10, 0, -10),
      probeCount: { x: 8, y: 2, z: 8 },
      cellSize: new Vector3(2.5, 3, 2.5),
      raysPerProbe: 64,
      historyWeight: 0.95,
      occlusionBias: 0.1,
    });
    expect(v.origin.x).toBe(-10);
    expect(v.probeCount).toEqual({ x: 8, y: 2, z: 8 });
    expect(v.totalProbes).toBe(128);
    expect(v.cellSize.x).toBe(2.5);
    expect(v.raysPerProbe).toBe(64);
    expect(v.historyWeight).toBe(0.95);
    expect(v.occlusionBias).toBe(0.1);
  });

  it('maxCorner is computed from origin + (count-1)*cellSize', () => {
    const v = new DDGIVolume({
      origin: new Vector3(0, 0, 0),
      probeCount: { x: 3, y: 3, z: 3 },
      cellSize: new Vector3(10, 10, 10),
    });
    expect(v.maxCorner.x).toBe(20);
    expect(v.maxCorner.y).toBe(20);
    expect(v.maxCorner.z).toBe(20);
  });
});

// ── getProbePosition ─────────────────────────────────────────────

describe('DDGIVolume.getProbePosition', () => {
  it('returns correct world position for grid corners', () => {
    const v = new DDGIVolume({
      origin: new Vector3(10, 20, 30),
      probeCount: { x: 3, y: 3, z: 3 },
      cellSize: new Vector3(5, 5, 5),
    });
    // probe 0 = (0,0,0) → world (10, 20, 30)
    const p0 = v.getProbePosition(0);
    expect(p0.x).toBe(10);
    expect(p0.y).toBe(20);
    expect(p0.z).toBe(30);
    // probe 13 = (1,1,1) → world (15, 25, 35)
    const p13 = v.getProbePosition(13); // 1 + 1*3 + 1*9 = 13
    expect(p13.x).toBe(15);
    expect(p13.y).toBe(25);
    expect(p13.z).toBe(35);
    // probe 26 = (2,2,2) → world (20, 30, 40)
    const p26 = v.getProbePosition(26); // 2 + 2*3 + 2*9 = 26
    expect(p26.x).toBe(20);
    expect(p26.y).toBe(30);
    expect(p26.z).toBe(40);
  });
});

// ── updateProbe ──────────────────────────────────────────────────

describe('DDGIVolume.updateProbe', () => {
  it('first update writes SH2 directly (no history blend)', () => {
    const v = new DDGIVolume({ probeCount: { x: 2, y: 2, z: 2 } });
    expect(v.probeValidity[0]).toBe(0);
    v.updateProbe(0, [
      { dir: new Vector3(1, 0, 0), color: { r: 1, g: 0, b: 0 }, distance: 5 },
    ]);
    expect(v.probeValidity[0]).toBe(1);
    // SH2 should be non-zero (Y11 direction)
    expect(v.probes[9]).not.toBe(0); // SH[9] = r * Y11 = r * 0.488603 * x
    expect(v.probeDepths[0]).toBe(5);
  });

  it('temporal accumulation: second update blends with history', () => {
    const v = new DDGIVolume({
      probeCount: { x: 2, y: 2, z: 2 },
      historyWeight: 0.5,
    });
    // first update
    v.updateProbe(0, [
      { dir: new Vector3(0, 0, 1), color: { r: 2, g: 0, b: 0 }, distance: 1 },
    ]);
    const sh0First = v.probes[6]; // SH[6] = r * Y10 = r * 0.488603 * z

    // second update with different color
    v.updateProbe(0, [
      { dir: new Vector3(0, 0, 1), color: { r: 4, g: 0, b: 0 }, distance: 1 },
    ]);
    const sh0Second = v.probes[6];

    // historyWeight=0.5: second = 0.5*first + 0.5*new
    // new SH[6] ∝ 4*Y10, first SH[6] ∝ 2*Y10 (normalized by rays*π=π)
    // Both normalized by 1/(1*π), so:
    // first: 2 * 0.488603 / π ≈ 0.3111
    // new:   4 * 0.488603 / π ≈ 0.6222
    // second = 0.5*0.3111 + 0.5*0.6222 = 0.4667
    expect(sh0Second).toBeCloseTo(0.5 * sh0First + 0.5 * (4 * 0.488603 / Math.PI), 4);
  });

  it('ignores out-of-range probe indices', () => {
    const v = new DDGIVolume({ probeCount: { x: 2, y: 2, z: 2 } });
    expect(() => v.updateProbe(-1, [])).not.toThrow();
    expect(() => v.updateProbe(999, [])).not.toThrow();
  });

  it('multiple rays accumulate and average', () => {
    const v = new DDGIVolume({ probeCount: { x: 2, y: 2, z: 2 } });
    v.updateProbe(0, [
      { dir: new Vector3(1, 0, 0), color: { r: 1, g: 0, b: 0 }, distance: 2 },
      { dir: new Vector3(0, 0, 1), color: { r: 1, g: 0, b: 0 }, distance: 4 },
    ]);
    // avgDist = (2+4)/2 = 3
    expect(v.probeDepths[0]).toBe(3);
  });
});

// ── sampleIrradiance ─────────────────────────────────────────────

describe('DDGIVolume.sampleIrradiance', () => {
  it('returns black before any probe is updated', () => {
    const v = new DDGIVolume({ probeCount: { x: 2, y: 2, z: 2 } });
    const result = v.sampleIrradiance(new Vector3(1, 1, 1), new Vector3(0, 1, 0));
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('returns non-zero after probe update', () => {
    const v = new DDGIVolume({
      origin: new Vector3(0, 0, 0),
      probeCount: { x: 2, y: 2, z: 2 },
      cellSize: new Vector3(10, 10, 10),
    });
    // Update all 8 probes with red light from above
    for (let i = 0; i < 8; i++) {
      v.updateProbe(i, [
        { dir: new Vector3(0, 1, 0), color: { r: 1, g: 0.5, b: 0.2 }, distance: 5 },
      ]);
    }
    // Sample at center
    const result = v.sampleIrradiance(new Vector3(5, 5, 5), new Vector3(0, 1, 0));
    expect(result.r).toBeGreaterThan(0);
    expect(result.g).toBeGreaterThan(0);
    expect(result.b).toBeGreaterThan(0);
  });

  it('returns consistent irradiance when all probes have identical SH2', () => {
    const v = new DDGIVolume({
      origin: new Vector3(0, 0, 0),
      probeCount: { x: 4, y: 4, z: 4 },
      cellSize: new Vector3(2, 2, 2),
    });
    // All probes see the same light
    for (let i = 0; i < v.totalProbes; i++) {
      v.updateProbe(i, [
        { dir: new Vector3(0, 1, 0), color: { r: 0.8, g: 0.8, b: 0.8 }, distance: 3 },
      ]);
    }
    // Sample at different positions — should get the same irradiance
    // (all probes identical → interpolation doesn't change result)
    const r1 = v.sampleIrradiance(new Vector3(1, 1, 1), new Vector3(0, 1, 0));
    const r2 = v.sampleIrradiance(new Vector3(3, 3, 3), new Vector3(0, 1, 0));
    const r3 = v.sampleIrradiance(new Vector3(5, 5, 5), new Vector3(0, 1, 0));
    expect(r1.r).toBeCloseTo(r2.r, 4);
    expect(r2.r).toBeCloseTo(r3.r, 4);
    expect(r1.g).toBeCloseTo(r2.g, 4);
    expect(r1.b).toBeCloseTo(r2.b, 4);
  });

  it('positions just outside the volume still get irradiance from nearest valid probe', () => {
    const v = new DDGIVolume({
      origin: new Vector3(0, 0, 0),
      probeCount: { x: 2, y: 2, z: 2 },
      cellSize: new Vector3(10, 10, 10),
    });
    // Update only probe 0 with depth=50 (large enough to not occlude)
    v.updateProbe(0, [
      { dir: new Vector3(0, 1, 0), color: { r: 1, g: 1, b: 1 }, distance: 50 },
    ]);
    // Position slightly outside volume, close to probe 0
    const result = v.sampleIrradiance(new Vector3(-1, -1, -1), new Vector3(0, 1, 0));
    // Should get irradiance from probe 0 (clamped to corner, within occlusion range)
    expect(result.r).toBeGreaterThan(0);
  });

  it('positions far outside return black (occlusion weight attenuates to 0)', () => {
    const v = new DDGIVolume({
      origin: new Vector3(0, 0, 0),
      probeCount: { x: 2, y: 2, z: 2 },
      cellSize: new Vector3(10, 10, 10),
    });
    v.updateProbe(0, [
      { dir: new Vector3(0, 1, 0), color: { r: 1, g: 1, b: 1 }, distance: 5 },
    ]);
    // Position very far outside — occlusion weight = 0 (distance >> probeDepth)
    const result = v.sampleIrradiance(new Vector3(-100, -100, -100), new Vector3(0, 1, 0));
    expect(result.r).toBe(0);
  });
});

// ── reset / validProbeCount ──────────────────────────────────────

describe('DDGIVolume.reset / validProbeCount', () => {
  it('reset clears all probes', () => {
    const v = new DDGIVolume({ probeCount: { x: 2, y: 2, z: 2 } });
    v.updateProbe(0, [
      { dir: new Vector3(0, 1, 0), color: { r: 1, g: 1, b: 1 }, distance: 1 },
    ]);
    expect(v.validProbeCount).toBe(1);
    v.reset();
    expect(v.validProbeCount).toBe(0);
    // sampleIrradiance returns black after reset
    const r = v.sampleIrradiance(new Vector3(1, 1, 1), new Vector3(0, 1, 0));
    expect(r.r).toBe(0);
  });

  it('validProbeCount tracks updated probes', () => {
    const v = new DDGIVolume({ probeCount: { x: 2, y: 2, z: 2 } });
    expect(v.validProbeCount).toBe(0);
    v.updateProbe(0, [{ dir: new Vector3(0, 1, 0), color: { r: 1, g: 0, b: 0 }, distance: 1 }]);
    expect(v.validProbeCount).toBe(1);
    v.updateProbe(1, [{ dir: new Vector3(0, 1, 0), color: { r: 0, g: 1, b: 0 }, distance: 1 }]);
    expect(v.validProbeCount).toBe(2);
  });
});
