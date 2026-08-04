// AreaLightLTC 单元测试。
//
// 覆盖:
//   1. 向量工具(sub/add/scale/dot/cross/length/normalize/saturate)
//   2. 3×3 矩阵工具(mat3MulVec, mat3MulMat3)
//   3. LTC 核心函数(ltcUv, ltcEdgeVectorFormFactor, ltcClippedSphereFormFactor)
//   4. ltcEvaluate(背面剔除、正面 irradiance > 0、对称性)
//   5. evaluateRectAreaLight(specular + diffuse + total)
//   6. computeAreaLighting(批量)
//   7. approximateLTCMatrix(roughness/dotNV 边界)
//   8. makeRectVertices(CCW 绕序、中心位置、尺寸)

import { describe, it, expect } from 'vitest';
import {
  vec3,
  sub,
  add,
  scale,
  dot,
  cross,
  length,
  normalize,
  saturate,
  mat3MulVec,
  mat3MulMat3,
  ltcUv,
  ltcEdgeVectorFormFactor,
  ltcClippedSphereFormFactor,
  ltcEvaluate,
  evaluateRectAreaLight,
  computeAreaLighting,
  approximateLTCMatrix,
  makeRectVertices,
  LTC_LUT_SIZE,
  LTC_LUT_SCALE,
  LTC_LUT_BIAS,
  type RectLightParams,
  type SurfacePoint,
} from './AreaLightLTC';

// ── 向量工具 ───────────────────────────────────────────────────────

describe('vector utils', () => {
  it('sub', () => {
    const r = sub(vec3(1, 2, 3), vec3(4, 5, 6));
    expect(r.x).toBe(-3);
    expect(r.y).toBe(-3);
    expect(r.z).toBe(-3);
  });

  it('add', () => {
    const r = add(vec3(1, 2, 3), vec3(4, 5, 6));
    expect(r.x).toBe(5);
    expect(r.y).toBe(7);
    expect(r.z).toBe(9);
  });

  it('scale', () => {
    const r = scale(vec3(1, 2, 3), 2);
    expect(r.x).toBe(2);
    expect(r.y).toBe(4);
    expect(r.z).toBe(6);
  });

  it('dot', () => {
    expect(dot(vec3(1, 0, 0), vec3(1, 0, 0))).toBe(1);
    expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
  });

  it('cross', () => {
    const r = cross(vec3(1, 0, 0), vec3(0, 1, 0));
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.z).toBe(1);
  });

  it('length', () => {
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(length(vec3(0, 0, 0))).toBe(0);
  });

  it('normalize', () => {
    const r = normalize(vec3(3, 4, 0));
    expect(r.x).toBeCloseTo(0.6, 5);
    expect(r.y).toBeCloseTo(0.8, 5);
    expect(length(r)).toBeCloseTo(1, 5);
  });

  it('normalize zero vector returns zero', () => {
    const r = normalize(vec3(0, 0, 0));
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.z).toBe(0);
  });

  it('saturate clamps to [0,1]', () => {
    expect(saturate(-1)).toBe(0);
    expect(saturate(0.5)).toBe(0.5);
    expect(saturate(2)).toBe(1);
  });
});

// ── 3×3 矩阵工具 ──────────────────────────────────────────────────

describe('mat3 utils', () => {
  it('mat3MulVec: identity × v = v', () => {
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const v = vec3(1, 2, 3);
    const r = mat3MulVec(I, v);
    expect(r.x).toBe(1);
    expect(r.y).toBe(2);
    expect(r.z).toBe(3);
  });

  it('mat3MulVec: scaling matrix', () => {
    // 列主序: [2,0,0, 0,3,0, 0,0,4]
    const m = [2, 0, 0, 0, 3, 0, 0, 0, 4];
    const r = mat3MulVec(m, vec3(1, 1, 1));
    expect(r.x).toBe(2);
    expect(r.y).toBe(3);
    expect(r.z).toBe(4);
  });

  it('mat3MulMat3: identity × M = M', () => {
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const M = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const r = mat3MulMat3(I, M);
    for (let i = 0; i < 9; i++) {
      expect(r[i]).toBe(M[i]);
    }
  });

  it('mat3MulMat3: A × B correct', () => {
    // A = [1,0,0, 0,2,0, 0,0,3] (对角缩放)
    // B = [1,1,1, 1,1,1, 1,1,1]
    const A = [1, 0, 0, 0, 2, 0, 0, 0, 3];
    const B = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const r = mat3MulMat3(A, B);
    // result[col*3+row] = A[row] * B[col*3] ... 简化:对角 × 全1 = 各列乘对角
    // col 0: [1*1, 2*1, 3*1] = [1,2,3]
    expect(r[0]).toBe(1);
    expect(r[1]).toBe(2);
    expect(r[2]).toBe(3);
  });
});

// ── LTC LUT 常量 ──────────────────────────────────────────────────

describe('LTC LUT constants', () => {
  it('LUT size is 64', () => {
    expect(LTC_LUT_SIZE).toBe(64);
  });

  it('LUT_SCALE = (64-1)/64', () => {
    expect(LTC_LUT_SCALE).toBeCloseTo(63 / 64, 5);
  });

  it('LUT_BIAS = 0.5/64', () => {
    expect(LTC_LUT_BIAS).toBeCloseTo(0.5 / 64, 5);
  });
});

// ── ltcUv ──────────────────────────────────────────────────────────

describe('ltcUv', () => {
  it('returns valid UV for roughness=0, dotNV=1', () => {
    const [u, v] = ltcUv(0, 1);
    // roughness=0 → u = 0 * SCALE + BIAS = BIAS
    expect(u).toBeCloseTo(LTC_LUT_BIAS, 5);
    // dotNV=1 → v = sqrt(1-1) = 0 → 0 * SCALE + BIAS = BIAS
    expect(v).toBeCloseTo(LTC_LUT_BIAS, 5);
  });

  it('returns valid UV for roughness=1, dotNV=0', () => {
    const [u, v] = ltcUv(1, 0);
    // roughness=1 → u = 1 * SCALE + BIAS
    expect(u).toBeCloseTo(LTC_LUT_SCALE + LTC_LUT_BIAS, 5);
    // dotNV=0 → v = sqrt(1) = 1 → 1 * SCALE + BIAS
    expect(v).toBeCloseTo(LTC_LUT_SCALE + LTC_LUT_BIAS, 5);
  });

  it('clamps dotNV to [0,1]', () => {
    const [, v1] = ltcUv(0.5, -1);
    const [, v2] = ltcUv(0.5, 0);
    // dotNV=-1 clamped to 0 → same as dotNV=0
    expect(v1).toBeCloseTo(v2, 5);

    const [, v3] = ltcUv(0.5, 5);
    const [, v4] = ltcUv(0.5, 1);
    // dotNV=5 clamped to 1 → same as dotNV=1
    expect(v3).toBeCloseTo(v4, 5);
  });

  it('UV increases with roughness', () => {
    const v0 = ltcUv(0, 0.5)[0];
    const v1 = ltcUv(0.5, 0.5)[0];
    const v2 = ltcUv(1, 0.5)[0];
    expect(v0).toBeLessThan(v1);
    expect(v1).toBeLessThan(v2);
  });
});

// ── ltcEdgeVectorFormFactor ────────────────────────────────────────

describe('ltcEdgeVectorFormFactor', () => {
  it('returns zero for identical vectors', () => {
    // cross(v, v) = 0
    const v = vec3(1, 0, 0);
    const r = ltcEdgeVectorFormFactor(v, v);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(0, 5);
  });

  it('returns non-zero for perpendicular vectors', () => {
    const r = ltcEdgeVectorFormFactor(vec3(1, 0, 0), vec3(0, 1, 0));
    // cross = (0,0,1), dot = 0, y = 0
    // x <= 0 → 0.5/sqrt(1-0) - v = 0.5 - (0.8543985/3.4175940)
    expect(r.z).not.toBeCloseTo(0, 2);
  });

  it('returns non-zero for 90° apart vectors', () => {
    const r = ltcEdgeVectorFormFactor(
      normalize(vec3(1, 0, 1)),
      normalize(vec3(-1, 0, 1)),
    );
    // Should produce a non-zero result
    const len = length(r);
    expect(len).toBeGreaterThan(0);
  });
});

// ── ltcClippedSphereFormFactor ────────────────────────────────────

describe('ltcClippedSphereFormFactor', () => {
  it('returns 0 for zero vector', () => {
    expect(ltcClippedSphereFormFactor(vec3(0, 0, 0))).toBeCloseTo(0, 5);
  });

  it('returns positive for forward-facing form factor', () => {
    const f = vec3(0, 0, 0.5);
    const result = ltcClippedSphereFormFactor(f);
    // l=0.5, l²=0.25, (0.25+0.5)/(0.5+1) = 0.75/1.5 = 0.5
    expect(result).toBeCloseTo(0.5, 5);
  });

  it('returns 0 when result would be negative', () => {
    // Need l² + f.z < 0, i.e., f.z < -(f.x² + f.y² + f.z²)
    // For f = (0, 0, -0.5): l² = 0.25, l² + f.z = 0.25 - 0.5 = -0.25 < 0
    const f = vec3(0, 0, -0.5);
    expect(ltcClippedSphereFormFactor(f)).toBe(0);
  });

  it('result is always non-negative', () => {
    for (let i = 0; i < 20; i++) {
      const f = vec3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
      );
      expect(ltcClippedSphereFormFactor(f)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── ltcEvaluate ───────────────────────────────────────────────────

describe('ltcEvaluate', () => {
  // 单位 LTC 矩阵(测试用)
  const IDENTITY: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // 标准测试场景:
  //   光源在 (0, 5, 0),朝下(-Y),矩形 2×2
  //   表面在原点 (0, 0, 0),法线朝上 (+Y),视图方向朝上
  const makeStandardLight = (): RectLightParams => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0),  // center
      vec3(0, -1, 0), // forward (向下)
      vec3(0, 0, 1),  // up
      2, 2,           // width, height
    );
    return { p0, p1, p2, p3, color: [1, 1, 1], intensity: 1 };
  };

  it('returns 0 for back-facing surface (light behind)', () => {
    // 表面法线朝下(背对光源)
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, -1, 0), // 朝下,背对光源
      V: vec3(0, -1, 0),
      roughness: 0.5,
    };
    const light = makeStandardLight();
    const result = ltcEvaluate(
      surface.N, surface.V, surface.P, IDENTITY,
      light.p0, light.p1, light.p2, light.p3,
    );
    expect(result).toBe(0);
  });

  it('returns positive irradiance for front-facing surface', () => {
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, 1, 0), // 朝上,面向光源
      V: vec3(0, 1, 0),
      roughness: 0.5,
    };
    const light = makeStandardLight();
    const result = ltcEvaluate(
      surface.N, surface.V, surface.P, IDENTITY,
      light.p0, light.p1, light.p2, light.p3,
    );
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 when surface is on the light plane (behind light)', () => {
    // 表面在光源上方(光源背面)
    const surface: SurfacePoint = {
      P: vec3(0, 10, 0), // 在光源上方
      N: vec3(0, 1, 0),
      V: vec3(0, 1, 0),
      roughness: 0.5,
    };
    const light = makeStandardLight();
    const result = ltcEvaluate(
      surface.N, surface.V, surface.P, IDENTITY,
      light.p0, light.p1, light.p2, light.p3,
    );
    expect(result).toBe(0);
  });

  it('irradiance decreases with distance', () => {
    const light = makeStandardLight();
    const mInv = IDENTITY;

    // 近距离
    const near: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, 1, 0),
      V: vec3(0, 1, 0),
      roughness: 0.5,
    };
    const nearResult = ltcEvaluate(near.N, near.V, near.P, mInv,
      light.p0, light.p1, light.p2, light.p3);

    // 远距离(把光源移到 y=20)
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 20, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const farResult = ltcEvaluate(near.N, near.V, near.P, mInv,
      p0, p1, p2, p3);

    expect(nearResult).toBeGreaterThan(farResult);
    expect(farResult).toBeGreaterThan(0);
  });

  it('irradiance increases with light size', () => {
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, 1, 0),
      V: vec3(0, 1, 0),
      roughness: 0.5,
    };

    // 小光源
    const [sp0, sp1, sp2, sp3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 1, 1,
    );
    const small = ltcEvaluate(surface.N, surface.V, surface.P, IDENTITY,
      sp0, sp1, sp2, sp3);

    // 大光源
    const [bp0, bp1, bp2, bp3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 4, 4,
    );
    const big = ltcEvaluate(surface.N, surface.V, surface.P, IDENTITY,
      bp0, bp1, bp2, bp3);

    expect(big).toBeGreaterThan(small);
  });
});

// ── evaluateRectAreaLight ─────────────────────────────────────────

describe('evaluateRectAreaLight', () => {
  const IDENTITY: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  it('returns zero for back-facing surface', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const light: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 5 };
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, -1, 0),
      V: vec3(0, -1, 0),
      roughness: 0.5,
    };
    const r = evaluateRectAreaLight(surface, light, IDENTITY);
    expect(r.specular[0]).toBe(0);
    expect(r.specular[1]).toBe(0);
    expect(r.specular[2]).toBe(0);
    expect(r.diffuse[0]).toBe(0);
    expect(r.total[0]).toBe(0);
  });

  it('scales with intensity', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, 1, 0),
      V: vec3(0, 1, 0),
      roughness: 0.3,
    };
    const light1: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 1 };
    const light2: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 3 };
    const r1 = evaluateRectAreaLight(surface, light1, IDENTITY);
    const r2 = evaluateRectAreaLight(surface, light2, IDENTITY);
    expect(r2.total[0]).toBeCloseTo(r1.total[0] * 3, 3);
  });

  it('scales with color', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, 1, 0),
      V: vec3(0, 1, 0),
      roughness: 0.3,
    };
    const whiteLight: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 1 };
    const redLight: RectLightParams = { p0, p1, p2, p3, color: [1, 0, 0], intensity: 1 };
    const rW = evaluateRectAreaLight(surface, whiteLight, IDENTITY);
    const rR = evaluateRectAreaLight(surface, redLight, IDENTITY);
    // Red light only has R channel
    expect(rR.total[0]).toBeCloseTo(rW.total[0], 3);
    expect(rR.total[1]).toBeCloseTo(0, 5);
    expect(rR.total[2]).toBeCloseTo(0, 5);
  });

  it('total = specular + diffuse', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, 1, 0),
      V: vec3(0, 1, 0),
      roughness: 0.3,
    };
    const light: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 2 };
    const r = evaluateRectAreaLight(surface, light, IDENTITY);
    expect(r.total[0]).toBeCloseTo(r.specular[0] + r.diffuse[0], 5);
    expect(r.total[1]).toBeCloseTo(r.specular[1] + r.diffuse[1], 5);
    expect(r.total[2]).toBeCloseTo(r.specular[2] + r.diffuse[2], 5);
  });

  it('uses identity for diffuse when mInvDiff is undefined', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const surface: SurfacePoint = {
      P: vec3(0, 0, 0),
      N: vec3(0, 1, 0),
      V: vec3(0, 1, 0),
      roughness: 0.3,
    };
    const light: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 1 };

    // With explicit identity
    const r1 = evaluateRectAreaLight(surface, light, IDENTITY, IDENTITY);
    // With undefined (should use identity internally)
    const r2 = evaluateRectAreaLight(surface, light, IDENTITY);
    expect(r2.diffuse[0]).toBeCloseTo(r1.diffuse[0], 5);
  });
});

// ── computeAreaLighting ───────────────────────────────────────────

describe('computeAreaLighting', () => {
  const IDENTITY: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  it('returns one result per surface', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const light: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 1 };
    const surfaces: SurfacePoint[] = [
      { P: vec3(0, 0, 0), N: vec3(0, 1, 0), V: vec3(0, 1, 0), roughness: 0.3 },
      { P: vec3(1, 0, 0), N: vec3(0, 1, 0), V: vec3(0, 1, 0), roughness: 0.3 },
      { P: vec3(0, 0, 1), N: vec3(0, 1, 0), V: vec3(0, 1, 0), roughness: 0.5 },
    ];
    const results = computeAreaLighting(surfaces, light, IDENTITY);
    expect(results.length).toBe(3);
  });

  it('handles empty surface array', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const light: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 1 };
    const results = computeAreaLighting([], light, IDENTITY);
    expect(results.length).toBe(0);
  });

  it('center surface gets more light than edge surface', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    const light: RectLightParams = { p0, p1, p2, p3, color: [1, 1, 1], intensity: 1 };
    const center: SurfacePoint = {
      P: vec3(0, 0, 0), N: vec3(0, 1, 0), V: vec3(0, 1, 0), roughness: 0.3,
    };
    const edge: SurfacePoint = {
      P: vec3(5, 0, 5), N: vec3(0, 1, 0), V: vec3(0, 1, 0), roughness: 0.3,
    };
    const results = computeAreaLighting([center, edge], light, IDENTITY);
    expect(results[0].total[0]).toBeGreaterThan(results[1].total[0]);
  });
});

// ── approximateLTCMatrix ──────────────────────────────────────────

describe('approximateLTCMatrix', () => {
  it('returns identity for roughness=0', () => {
    const m = approximateLTCMatrix(0, 1);
    // roughness=0 → a=1, b=1 → identity
    expect(m[0]).toBeCloseTo(1, 5);
    expect(m[4]).toBeCloseTo(1, 5);
    expect(m[8]).toBeCloseTo(1, 5);
  });

  it('returns non-identity for roughness=1', () => {
    const m = approximateLTCMatrix(1, 0);
    // roughness=1, dotNV=0 → a=1+1*1*0.5=1.5, b=1+0.3=1.3
    expect(m[0]).toBeGreaterThan(1);
    expect(m[4]).toBeGreaterThan(1);
  });

  it('clamps roughness to [0,1]', () => {
    const m1 = approximateLTCMatrix(-1, 0.5);
    const m2 = approximateLTCMatrix(0, 0.5);
    expect(m1[0]).toBeCloseTo(m2[0], 5);
  });

  it('clamps dotNV to [0,1]', () => {
    const m1 = approximateLTCMatrix(0.5, 5);
    const m2 = approximateLTCMatrix(0.5, 1);
    expect(m1[0]).toBeCloseTo(m2[0], 5);
  });

  it('is a diagonal matrix', () => {
    const m = approximateLTCMatrix(0.5, 0.5);
    // Off-diagonal elements should be 0
    expect(m[1]).toBe(0);
    expect(m[2]).toBe(0);
    expect(m[3]).toBe(0);
    expect(m[5]).toBe(0);
    expect(m[6]).toBe(0);
    expect(m[7]).toBe(0);
  });
});

// ── makeRectVertices ──────────────────────────────────────────────

describe('makeRectVertices', () => {
  it('returns 4 vertices', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), 2, 2,
    );
    expect(p0).toBeDefined();
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p3).toBeDefined();
  });

  it('centers vertices around the given center', () => {
    const [p0, p1, p2, p3] = makeRectVertices(
      vec3(0, 5, 0), vec3(0, -1, 0), vec3(0, 0, 1), 2, 2,
    );
    // Average of 4 corners should be the center
    const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
    const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
    const cz = (p0.z + p1.z + p2.z + p3.z) / 4;
    expect(cx).toBeCloseTo(0, 5);
    expect(cy).toBeCloseTo(5, 5);
    expect(cz).toBeCloseTo(0, 5);
  });

  it('width and height scale the vertices', () => {
    const [p0, p1, , p3] = makeRectVertices(
      vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), 4, 6,
    );
    // p0=BL, p1=TL → differ by height in the "up" direction
    const h = length(sub(p1, p0));
    expect(h).toBeCloseTo(6, 5);
    // p0=BL, p3=BR → differ by width in the "right" direction
    const w = length(sub(p3, p0));
    expect(w).toBeCloseTo(4, 5);
  });

  it('produces CCW winding from front (illuminated side)', () => {
    const [p0, p1, , p3] = makeRectVertices(
      vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), 2, 2,
    );
    // CCW from front: cross(p1-p0, p3-p0) should point in +forward direction
    const v1 = sub(p1, p0);
    const v2 = sub(p3, p0);
    const normal = cross(v1, v2);
    // forward = (0,1,0), normal should point in forward direction (0,1,0)
    expect(normal.y).toBeGreaterThan(0);
  });
});
