// SpecularAA 单元测试。
//
// 覆盖:
//   1. Toksvig — 归一化法线 / 方差代理 / 粗糙度增量 / 强度
//   2. LEAN mapping — 方差 / 粗糙度 / 各向异性角度
//   3. CLEAN mapping — 方差 / 粗糙度
//   4. GSAA — 几何方差 / 粗糙度
//   5. 法线贴图邻域方差 — 均匀法线 / 变化法线 / 半径
//   6. filteredNormalLength — 归一化 / 滤波衰减
//   7. LEAN 贴图离线生成 — generateLEANMap / generateCLEANMap / sampleLEANMap
//   8. GLSL 着色器源码校验 — SPECULAR_AA_FRAG 与 CPU 1:1

import { describe, it, expect } from 'vitest';
import {
  toksvigRoughness,
  toksvigVariance,
  leanMappingVariance,
  leanRoughness,
  leanAnisoAngle,
  cleanVariance,
  cleanRoughness,
  gsaaVariance,
  gsaaRoughness,
  computeNormalVariance,
  varianceToRoughness,
  filteredNormalLength,
  generateLEANMap,
  generateCLEANMap,
  sampleLEANMap,
  type GSAAVertex,
} from './SpecularAA';
import { SPECULAR_AA_FRAG } from './shaders';

// ── Toksvig ───────────────────────────────────────────────────────

describe('toksvigRoughness', () => {
  it('returns base roughness when normal is unit length (no variance)', () => {
    expect(toksvigRoughness(1.0, 0.5)).toBe(0.5);
  });

  it('increases roughness when normal length < 1 (variance exists)', () => {
    const adjusted = toksvigRoughness(0.7, 0.3);
    expect(adjusted).toBeGreaterThan(0.3);
  });

  it('returns base roughness when strength=0', () => {
    expect(toksvigRoughness(0.5, 0.4, 0)).toBe(0.4);
  });

  it('larger strength produces larger roughness bump', () => {
    const weak = toksvigRoughness(0.7, 0.3, 0.5);
    const strong = toksvigRoughness(0.7, 0.3, 1.0);
    expect(strong).toBeGreaterThan(weak);
  });

  it('shorter normal length produces larger roughness bump', () => {
    const high = toksvigRoughness(0.5, 0.3);
    const low = toksvigRoughness(0.9, 0.3);
    expect(high).toBeGreaterThan(low);
  });

  it('clamps result to [0,1]', () => {
    // 极端:法线长度很小 + 高粗糙度 → 不应超过 1
    const adjusted = toksvigRoughness(0.01, 0.9, 10);
    expect(adjusted).toBeLessThanOrEqual(1);
    expect(adjusted).toBeGreaterThanOrEqual(0);
  });

  it('handles normalLength > 1 gracefully', () => {
    expect(toksvigRoughness(1.5, 0.5)).toBe(0.5);
  });

  it('handles zero roughness', () => {
    const adjusted = toksvigRoughness(0.7, 0.0);
    expect(adjusted).toBeGreaterThan(0);
    expect(adjusted).toBeLessThanOrEqual(1);
  });

  it('handles normalLength=0 without division by zero', () => {
    expect(() => toksvigRoughness(0, 0.5)).not.toThrow();
    const adjusted = toksvigRoughness(0, 0.5);
    expect(adjusted).toBeGreaterThanOrEqual(0);
    expect(adjusted).toBeLessThanOrEqual(1);
  });
});

describe('toksvigVariance', () => {
  it('returns 0 when normal length is 1', () => {
    expect(toksvigVariance(1.0)).toBe(0);
  });

  it('returns positive value when normal length < 1', () => {
    expect(toksvigVariance(0.7)).toBeGreaterThan(0);
  });

  it('increases as normal length decreases', () => {
    expect(toksvigVariance(0.5)).toBeGreaterThan(toksvigVariance(0.9));
  });

  it('handles normalLength > 1', () => {
    expect(toksvigVariance(1.5)).toBe(0);
  });
});

// ── LEAN mapping ──────────────────────────────────────────────────

describe('leanMappingVariance', () => {
  it('returns 0 when second moments equal first moments squared (no variance)', () => {
    // E[nx²]=bx², E[ny²]=by² → Var=0
    expect(leanMappingVariance(0.25, 0.16, 0.1, 0.5, 0.4)).toBeCloseTo(0, 5);
  });

  it('returns positive variance when second moments exceed first moments squared', () => {
    // E[nx²]=0.5, bx=0.5 → Var(nx)=0.5-0.25=0.25
    // E[ny²]=0.5, by=0.4 → Var(ny)=0.5-0.16=0.34
    // total = 0.59
    const v = leanMappingVariance(0.5, 0.5, 0.1, 0.5, 0.4);
    expect(v).toBeCloseTo(0.59, 4);
  });

  it('returns second moments sum when bx=by=0 (already centered)', () => {
    expect(leanMappingVariance(0.3, 0.4, 0.1, 0, 0)).toBeCloseTo(0.7, 5);
  });

  it('clamps negative variance to 0 (numerical safety)', () => {
    // E[nx²] < bx² → negative → clamp to 0
    expect(leanMappingVariance(0.1, 0.1, 0, 0.5, 0.5)).toBe(0);
  });
});

describe('leanRoughness', () => {
  it('returns base roughness when variance is 0', () => {
    const moments = { m11: 0.25, m22: 0.16, m12: 0.1 };
    expect(leanRoughness(moments, 0.5, 0.5, 0.4)).toBeCloseTo(0.5, 4);
  });

  it('increases roughness when variance > 0', () => {
    const moments = { m11: 0.5, m22: 0.5, m12: 0.1 };
    const adjusted = leanRoughness(moments, 0.3, 0, 0);
    expect(adjusted).toBeGreaterThan(0.3);
  });

  it('clamps to 1', () => {
    const moments = { m11: 5.0, m22: 5.0, m12: 0 };
    const adjusted = leanRoughness(moments, 0.9, 0, 0, 10);
    expect(adjusted).toBeLessThanOrEqual(1);
  });
});

describe('leanAnisoAngle', () => {
  it('returns 0 when m11 > m22 and m12=0 (isotropic along x)', () => {
    expect(leanAnisoAngle(0.5, 0.3, 0)).toBeCloseTo(0, 5);
  });

  it('returns π/4 when m11 == m22 and m12 > 0', () => {
    // atan2(2*m12, 0) = π/2 → θ = π/4
    expect(leanAnisoAngle(0.5, 0.5, 0.3)).toBeCloseTo(Math.PI / 4, 4);
  });

  it('returns -π/4 when m11 == m22 and m12 < 0', () => {
    expect(leanAnisoAngle(0.5, 0.5, -0.3)).toBeCloseTo(-Math.PI / 4, 4);
  });
});

// ── CLEAN mapping ─────────────────────────────────────────────────

describe('cleanVariance', () => {
  it('returns sum of diagonal moments', () => {
    expect(cleanVariance(0.3, 0.4)).toBeCloseTo(0.7, 5);
  });

  it('clamps negative to 0', () => {
    expect(cleanVariance(-0.1, 0.05)).toBe(0);
    expect(cleanVariance(-0.1, -0.2)).toBe(0);
  });
});

describe('cleanRoughness', () => {
  it('returns base roughness when moments are 0', () => {
    expect(cleanRoughness(0, 0, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('increases roughness when moments > 0', () => {
    expect(cleanRoughness(0.3, 0.4, 0.3)).toBeGreaterThan(0.3);
  });

  it('clamps to 1', () => {
    expect(cleanRoughness(10, 10, 0.9, 10)).toBeLessThanOrEqual(1);
  });
});

// ── GSAA ──────────────────────────────────────────────────────────

describe('gsaaVariance', () => {
  const mkV = (x: number, y: number, z: number, nx: number, ny: number, nz: number): GSAAVertex =>
    ({ x, y, z, nx, ny, nz });

  it('returns 0 when all vertex normals are identical', () => {
    const v0 = mkV(0, 0, 0, 0, 0, 1);
    const v1 = mkV(1, 0, 0, 0, 0, 1);
    const v2 = mkV(0, 1, 0, 0, 0, 1);
    expect(gsaaVariance(v0, v1, v2)).toBeCloseTo(0, 8);
  });

  it('returns positive variance when vertex normals differ', () => {
    const v0 = mkV(0, 0, 0, 0, 0, 1);
    const v1 = mkV(1, 0, 0, 0.5, 0, 0.5);
    const v2 = mkV(0, 1, 0, -0.5, 0, 0.5);
    expect(gsaaVariance(v0, v1, v2)).toBeGreaterThan(0);
  });

  it('larger triangle area reduces variance (spread out)', () => {
    const small = gsaaVariance(
      mkV(0, 0, 0, 0, 0, 1),
      mkV(0.1, 0, 0, 0.5, 0, 0.5),
      mkV(0, 0.1, 0, -0.5, 0, 0.5),
    );
    const large = gsaaVariance(
      mkV(0, 0, 0, 0, 0, 1),
      mkV(10, 0, 0, 0.5, 0, 0.5),
      mkV(0, 10, 0, -0.5, 0, 0.5),
    );
    // Same normal differences, but larger area → lower variance density
    expect(large).toBeLessThan(small);
  });
});

describe('gsaaRoughness', () => {
  const mkV = (x: number, y: number, z: number, nx: number, ny: number, nz: number): GSAAVertex =>
    ({ x, y, z, nx, ny, nz });

  it('returns base roughness when normals are identical', () => {
    const v0 = mkV(0, 0, 0, 0, 0, 1);
    const v1 = mkV(1, 0, 0, 0, 0, 1);
    const v2 = mkV(0, 1, 0, 0, 0, 1);
    expect(gsaaRoughness(v0, v1, v2, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('increases roughness when normals differ', () => {
    const v0 = mkV(0, 0, 0, 0, 0, 1);
    const v1 = mkV(1, 0, 0, 0.5, 0, 0.5);
    const v2 = mkV(0, 1, 0, -0.5, 0, 0.5);
    expect(gsaaRoughness(v0, v1, v2, 0.3)).toBeGreaterThan(0.3);
  });

  it('clamps to 1', () => {
    const v0 = mkV(0, 0, 0, 0, 0, 1);
    const v1 = mkV(0.01, 0, 0, 1, 0, 0);
    const v2 = mkV(0, 0.01, 0, -1, 0, 0);
    expect(gsaaRoughness(v0, v1, v2, 0.9, 100)).toBeLessThanOrEqual(1);
  });
});

// ── computeNormalVariance ─────────────────────────────────────────

describe('computeNormalVariance', () => {
  it('returns 0 for uniform normal map', () => {
    const normals = new Float32Array(4 * 4 * 4).fill(0);
    for (let i = 0; i < 16; i++) {
      normals[i * 4] = 0;
      normals[i * 4 + 1] = 0;
      normals[i * 4 + 2] = 1;
      normals[i * 4 + 3] = 0;
    }
    expect(computeNormalVariance(normals, 4, 4, 2, 2, 1)).toBeCloseTo(0, 8);
  });

  it('returns positive variance for varying normals', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        normals[i] = x < 2 ? 1 : -1;  // 左右法线相反
        normals[i + 1] = 0;
        normals[i + 2] = 0;
        normals[i + 3] = 0;
      }
    }
    expect(computeNormalVariance(normals, 4, 4, 2, 2, 1)).toBeGreaterThan(0);
  });

  it('larger radius captures more variance', () => {
    const normals = new Float32Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 4;
        normals[i] = x < 4 ? 1 : -1;
        normals[i + 1] = 0;
        normals[i + 2] = 0;
        normals[i + 3] = 0;
      }
    }
    const small = computeNormalVariance(normals, 8, 8, 4, 4, 1);
    const large = computeNormalVariance(normals, 8, 8, 4, 4, 3);
    expect(large).toBeGreaterThanOrEqual(small);
  });

  it('handles edge pixels (clamps to bounds)', () => {
    const normals = new Float32Array(4 * 4 * 4).fill(0);
    for (let i = 0; i < 16; i++) normals[i * 4 + 2] = 1;
    expect(() => computeNormalVariance(normals, 4, 4, 0, 0, 2)).not.toThrow();
  });
});

describe('varianceToRoughness', () => {
  it('returns base roughness when variance is 0', () => {
    expect(varianceToRoughness(0, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('increases roughness when variance > 0', () => {
    expect(varianceToRoughness(0.2, 0.3)).toBeGreaterThan(0.3);
  });

  it('clamps to 1', () => {
    expect(varianceToRoughness(10, 0.9, 10)).toBeLessThanOrEqual(1);
  });
});

// ── filteredNormalLength ──────────────────────────────────────────

describe('filteredNormalLength', () => {
  it('returns 1 for uniform normalized normals', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      normals[i * 4] = 0;
      normals[i * 4 + 1] = 0;
      normals[i * 4 + 2] = 1;
    }
    expect(filteredNormalLength(normals, 4, 4, 2, 2, 1)).toBeCloseTo(1, 5);
  });

  it('returns < 1 for opposing normals (cancellation)', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        normals[i] = x < 2 ? 1 : -1;  // 相反方向 → 平均后抵消
        normals[i + 1] = 0;
        normals[i + 2] = 0;
      }
    }
    expect(filteredNormalLength(normals, 4, 4, 2, 2, 1)).toBeLessThan(1);
  });

  it('handles edge pixels', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) normals[i * 4 + 2] = 1;
    expect(() => filteredNormalLength(normals, 4, 4, 0, 0, 2)).not.toThrow();
  });
});

// ── LEAN 贴图离线生成 ─────────────────────────────────────────────

describe('generateLEANMap', () => {
  it('generates correct dimensions', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) normals[i * 4 + 2] = 1;
    const lean = generateLEANMap(normals, 4, 4, 1);
    expect(lean.width).toBe(4);
    expect(lean.height).toBe(4);
    expect(lean.data.length).toBe(4 * 4 * 3);
  });

  it('produces m11=0 m22=0 for uniform axis-aligned normals', () => {
    // 所有法线 = (0,0,1) → nx=0, ny=0 → m11=E[nx²]=0, m22=E[ny²]=0
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) normals[i * 4 + 2] = 1;
    const lean = generateLEANMap(normals, 4, 4, 1);
    const m = sampleLEANMap(lean, 0.5, 0.5);
    expect(m.m11).toBeCloseTo(0, 5);
    expect(m.m22).toBeCloseTo(0, 5);
    expect(m.m12).toBeCloseTo(0, 5);
  });

  it('produces m11=1 for normals all pointing in +x', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) normals[i * 4] = 1;  // nx=1
    const lean = generateLEANMap(normals, 4, 4, 1);
    const m = sampleLEANMap(lean, 0.5, 0.5);
    expect(m.m11).toBeCloseTo(1, 4);  // E[nx²] = 1
  });
});

describe('generateCLEANMap', () => {
  it('generates correct dimensions (2 channels)', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) normals[i * 4 + 2] = 1;
    const clean = generateCLEANMap(normals, 4, 4, 1);
    expect(clean.width).toBe(4);
    expect(clean.height).toBe(4);
    expect(clean.data.length).toBe(4 * 4 * 2);
  });
});

describe('sampleLEANMap', () => {
  it('clamps UV out of bounds to edge', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) normals[i * 4] = 1;
    const lean = generateLEANMap(normals, 4, 4, 1);
    const edge = sampleLEANMap(lean, -0.5, -0.5);
    const valid = sampleLEANMap(lean, 0, 0);
    expect(edge.m11).toBeCloseTo(valid.m11, 5);
  });

  it('returns bilinear-interpolated moments', () => {
    const normals = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) normals[i * 4] = 1;
    const lean = generateLEANMap(normals, 4, 4, 1);
    // 中心采样 → 应得到 m11 ≈ 1
    const m = sampleLEANMap(lean, 0.5, 0.5);
    expect(m.m11).toBeCloseTo(1, 4);
  });
});

// ── GLSL 着色器源码校验 ──────────────────────────────────────────

describe('SPECULAR_AA_FRAG shader source', () => {
  it('declares Toksvig function', () => {
    expect(SPECULAR_AA_FRAG).toContain('toksvigRoughness');
  });

  it('declares LEAN mapping function', () => {
    expect(SPECULAR_AA_FRAG).toContain('leanVariance');
    expect(SPECULAR_AA_FRAG).toContain('leanRoughness');
  });

  it('declares CLEAN mapping function', () => {
    expect(SPECULAR_AA_FRAG).toContain('cleanRoughness');
  });

  it('provides main entry applySpecularAA', () => {
    expect(SPECULAR_AA_FRAG).toContain('applySpecularAA');
  });

  it('early-exits when strength <= 0', () => {
    expect(SPECULAR_AA_FRAG).toContain('if (strength <= 0.0) return baseRoughness');
  });

  it('selects LEAN vs Toksvig via u_useLEAN', () => {
    expect(SPECULAR_AA_FRAG).toContain('u_useLEAN');
    expect(SPECULAR_AA_FRAG).toContain('u_leanMap');
  });

  it('clamps adjusted roughness to 1.0', () => {
    expect(SPECULAR_AA_FRAG).toContain('min(1.0,');
  });

  it('references provenance (Toksvig / Olano / UE5 / o3de)', () => {
    expect(SPECULAR_AA_FRAG).toContain('Toksvig');
    expect(SPECULAR_AA_FRAG).toContain('Olano');
    expect(SPECULAR_AA_FRAG).toContain('UE5');
    expect(SPECULAR_AA_FRAG).toContain('o3de');
  });
});
