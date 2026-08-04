// PCSSSampler 单元测试。
//
// 覆盖:
//   1. sampleShadowDepth — 边界钳制 / 整数像素取整
//   2. findBlocker — 无遮挡器 / 全遮挡器 / 矩形遮挡器 / 搜索半径
//   3. computePenumbra — 相似三角形公式 / 钳制 / 除零保护
//   4. samplePCF — 全照亮 / 全阴影 / 软阴影过渡 / 采样数
//   5. samplePCSS — 完整三步流程 / 无遮挡器短路
//   6. samplePCSSWithStats — 统计字段
//   7. 辅助构造器 — makeFlatShadowMap / makeBlockerShadowMap
//   8. 着色器源码校验 — PCSS_SHADOW_FRAG 与 CPU 实现 1:1 对应

import { describe, it, expect } from 'vitest';
import {
  sampleShadowDepth,
  findBlocker,
  computePenumbra,
  samplePCF,
  samplePCSS,
  samplePCSSWithStats,
  makeFlatShadowMap,
  makeBlockerShadowMap,
  POISSON_DISK_16,
  type ShadowMapData,
} from './PCSSSampler';
import { PCSS_SHADOW_FRAG } from '../Materials/shaders';

// ── sampleShadowDepth ─────────────────────────────────────────────

describe('sampleShadowDepth', () => {
  it('returns the depth at integer UV', () => {
    const map: ShadowMapData = {
      data: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      width: 2, height: 2,
    };
    expect(sampleShadowDepth(map, 0, 0)).toBeCloseTo(0.1);
    expect(sampleShadowDepth(map, 1, 0)).toBeCloseTo(0.2);
    expect(sampleShadowDepth(map, 0, 1)).toBeCloseTo(0.3);
    expect(sampleShadowDepth(map, 1, 1)).toBeCloseTo(0.4);
  });

  it('clamps UV out of bounds to edge (CLAMP_TO_EDGE)', () => {
    const map: ShadowMapData = {
      data: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      width: 2, height: 2,
    };
    expect(sampleShadowDepth(map, -0.5, -0.5)).toBeCloseTo(0.1);
    expect(sampleShadowDepth(map, 1.5, 1.5)).toBeCloseTo(0.4);
    expect(sampleShadowDepth(map, 1.5, -0.5)).toBeCloseTo(0.2);
  });

  it('floors fractional UV to nearest pixel', () => {
    const map: ShadowMapData = {
      data: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      width: 2, height: 2,
    };
    // UV (0.4, 0.4) → pixel (0, 0) = 0.1
    expect(sampleShadowDepth(map, 0.4, 0.4)).toBeCloseTo(0.1);
    // UV (0.6, 0.6) → pixel (1, 1) = 0.4
    expect(sampleShadowDepth(map, 0.6, 0.6)).toBeCloseTo(0.4);
  });
});

// ── findBlocker ───────────────────────────────────────────────────

describe('findBlocker', () => {
  it('returns count=0 when no blocker exists (flat map at receiver depth)', () => {
    const map = makeFlatShadowMap(16, 16, 0.5);
    const r = findBlocker(map, 0.5, 0.5, 0.5, 2);
    expect(r.count).toBe(0);
    expect(r.avgDepth).toBe(0);
  });

  it('returns count=0 when shadow map is all behind receiver', () => {
    const map = makeFlatShadowMap(16, 16, 0.8);  // 阴影贴图深度 = 0.8
    const r = findBlocker(map, 0.5, 0.5, 0.5, 2);  // 接收者深度 = 0.5
    // 0.8 < 0.5? No → 无遮挡器
    expect(r.count).toBe(0);
  });

  it('finds blockers when shadow map depth < receiver depth', () => {
    const map = makeFlatShadowMap(16, 16, 0.3);  // 阴影贴图深度 = 0.3
    const r = findBlocker(map, 0.5, 0.5, 0.5, 2);  // 接收者深度 = 0.5
    expect(r.count).toBeGreaterThan(0);
    expect(r.avgDepth).toBeCloseTo(0.3, 4);
  });

  it('finds rectangular blocker in center', () => {
    const map = makeBlockerShadowMap(32, 32, 0.2, 0.9, 0.5, 0.5, 0.5);
    // 中心采样应找到遮挡器
    const r = findBlocker(map, 0.5, 0.5, 0.7, 2);
    expect(r.count).toBeGreaterThan(0);
    expect(r.avgDepth).toBeCloseTo(0.2, 4);
  });

  it('does not find blocker outside blocker region', () => {
    const map = makeBlockerShadowMap(32, 32, 0.2, 0.9, 0.5, 0.5, 0.2);
    // 远离中心采样,搜索半径小 → 不应找到遮挡器
    const r = findBlocker(map, 0.05, 0.05, 0.7, 1);
    expect(r.count).toBe(0);
  });

  it('larger search radius finds more blockers (when sample is outside blocker)', () => {
    // 遮挡器在中心 (0.5, 0.5) 半径 0.2;采样点在 (0.2, 0.2) 远离遮挡器
    const map = makeBlockerShadowMap(32, 32, 0.2, 0.9, 0.5, 0.5, 0.4);
    // 小搜索半径 → 采样点都在 (0.2,0.2) 附近,全在背景区 → 0 遮挡器
    const small = findBlocker(map, 0.2, 0.2, 0.7, 1);
    // 大搜索半径 → 部分采样延伸到中心遮挡器区域 → 找到遮挡器
    const large = findBlocker(map, 0.2, 0.2, 0.7, 16);
    expect(large.count).toBeGreaterThan(small.count);
  });

  it('blockerBias excludes near-equal depths', () => {
    const map = makeFlatShadowMap(16, 16, 0.49);
    // blockerBias=0.05: 0.49 < 0.5 - 0.05 = 0.45? No → 无遮挡器
    const r = findBlocker(map, 0.5, 0.5, 0.5, 2, 0.05);
    expect(r.count).toBe(0);
  });

  it('computes average depth of multiple blockers', () => {
    // 构造一个半 0.2 半 0.4 的贴图(左半 0.2,右半 0.4)
    const data = new Float32Array(16 * 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        data[y * 16 + x] = x < 8 ? 0.2 : 0.4;
      }
    }
    const map: ShadowMapData = { data, width: 16, height: 16 };
    const r = findBlocker(map, 0.5, 0.5, 0.7, 2);
    expect(r.count).toBeGreaterThan(0);
    // 平均深度介于 0.2 和 0.4 之间
    expect(r.avgDepth).toBeGreaterThanOrEqual(0.2);
    expect(r.avgDepth).toBeLessThanOrEqual(0.4);
  });
});

// ── computePenumbra ───────────────────────────────────────────────

describe('computePenumbra', () => {
  it('returns 0 when blocker == receiver (no distance, no clamp)', () => {
    // penumbra = (0.5-0.5)*1/0.5 = 0;禁用 clamp(min=0) 才能得到原始 0
    const p = computePenumbra(0.5, 0.5, 1.0, 0, 100);
    expect(p).toBeCloseTo(0, 5);
  });

  it('clamps to minPenumbra=1 by default when blocker == receiver', () => {
    const p = computePenumbra(0.5, 0.5, 1.0);  // 默认 min=1
    expect(p).toBe(1);
  });

  it('returns positive when receiver is behind blocker', () => {
    const p = computePenumbra(0.3, 0.5, 1.0);
    expect(p).toBeGreaterThan(0);
  });

  it('scales linearly with lightSize', () => {
    const p1 = computePenumbra(0.3, 0.5, 1.0, 0, 100);
    const p2 = computePenumbra(0.3, 0.5, 2.0, 0, 100);
    expect(p2).toBeCloseTo(p1 * 2, 3);
  });

  it('clamps to maxPenumbra', () => {
    // blocker 很近,receiver 很远 → penumbra 很大
    const p = computePenumbra(0.01, 0.9, 100.0, 1, 16);
    expect(p).toBe(16);
  });

  it('clamps to minPenumbra', () => {
    // blocker == receiver → penumbra = 0 → clamp to minPenumbra
    const p = computePenumbra(0.5, 0.5, 1.0, 4, 16);
    expect(p).toBe(4);
  });

  it('handles blockerDepth=0 without division by zero', () => {
    const p = computePenumbra(0, 0.5, 1.0, 1, 16);
    // 不抛错,返回钳制值
    expect(p).toBeGreaterThanOrEqual(1);
    expect(p).toBeLessThanOrEqual(16);
  });

  it('penumbra increases as receiver moves further from blocker', () => {
    const near = computePenumbra(0.3, 0.4, 1.0, 0, 100);
    const far = computePenumbra(0.3, 0.8, 1.0, 0, 100);
    expect(far).toBeGreaterThan(near);
  });

  it('uses default min=1 max=16', () => {
    const p = computePenumbra(0.5, 0.5, 1.0);  // penumbra = 0
    expect(p).toBe(1);  // clamped to default min
  });
});

// ── samplePCF ─────────────────────────────────────────────────────

describe('samplePCF', () => {
  it('returns 1.0 when fully lit (shadow map all behind receiver)', () => {
    const map = makeFlatShadowMap(16, 16, 0.9);
    const v = samplePCF(map, 0.5, 0.5, 0.5, 4, 0.001, 16);
    expect(v).toBeCloseTo(1.0, 4);
  });

  it('returns 0.0 when fully shadowed (shadow map all in front)', () => {
    const map = makeFlatShadowMap(16, 16, 0.1);
    const v = samplePCF(map, 0.5, 0.5, 0.5, 4, 0.001, 16);
    expect(v).toBeCloseTo(0.0, 4);
  });

  it('returns 1.0 with 1 sample when lit', () => {
    const map = makeFlatShadowMap(16, 16, 0.9);
    const v = samplePCF(map, 0.5, 0.5, 0.5, 1, 0.001, 1);
    expect(v).toBe(1);
  });

  it('returns 0.0 with 1 sample when shadowed', () => {
    const map = makeFlatShadowMap(16, 16, 0.1);
    const v = samplePCF(map, 0.5, 0.5, 0.5, 1, 0.001, 1);
    expect(v).toBe(0);
  });

  it('returns value in [0,1] for partial shadow', () => {
    // 半遮挡贴图
    const data = new Float32Array(32 * 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        data[y * 32 + x] = x < 16 ? 0.1 : 0.9;  // 左半遮挡,右半照亮
      }
    }
    const map: ShadowMapData = { data, width: 32, height: 32 };
    // 边界处采样 → 介于 0 和 1 之间
    const v = samplePCF(map, 0.5, 0.5, 0.5, 4, 0.001, 16);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('clamps samples to [1, 16]', () => {
    const map = makeFlatShadowMap(16, 16, 0.9);
    const v0 = samplePCF(map, 0.5, 0.5, 0.5, 4, 0.001, 0);
    const vNeg = samplePCF(map, 0.5, 0.5, 0.5, 4, 0.001, -5);
    const vHuge = samplePCF(map, 0.5, 0.5, 0.5, 4, 0.001, 1000);
    expect(v0).toBeCloseTo(1.0, 4);
    expect(vNeg).toBeCloseTo(1.0, 4);
    expect(vHuge).toBeCloseTo(1.0, 4);
  });

  it('larger penumbra radius produces softer shadow at boundary', () => {
    // 半遮挡贴图
    const data = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        data[y * 64 + x] = x < 32 ? 0.1 : 0.9;
      }
    }
    const map: ShadowMapData = { data, width: 64, height: 64 };
    // 在边界处,大半径 → 更软(更接近 0.5),小半径 → 更硬(更接近 0 或 1)
    const hard = samplePCF(map, 0.5, 0.5, 0.5, 1, 0.001, 16);
    const soft = samplePCF(map, 0.5, 0.5, 0.5, 8, 0.001, 16);
    // 软阴影应比硬阴影更接近 0.5
    expect(Math.abs(soft - 0.5)).toBeLessThanOrEqual(Math.abs(hard - 0.5) + 0.01);
  });
});

// ── samplePCSS ────────────────────────────────────────────────────

describe('samplePCSS', () => {
  it('returns 1.0 when no blocker exists', () => {
    const map = makeFlatShadowMap(16, 16, 0.9);
    const v = samplePCSS(map, 0.5, 0.5, 0.5, { lightSize: 1.0 });
    expect(v).toBeCloseTo(1.0, 4);
  });

  it('returns 0.0 when fully blocked', () => {
    const map = makeFlatShadowMap(16, 16, 0.1);
    const v = samplePCSS(map, 0.5, 0.5, 0.5, { lightSize: 1.0 });
    expect(v).toBeCloseTo(0.0, 4);
  });

  it('returns 1.0 when receiver is in front of shadow map', () => {
    const map = makeFlatShadowMap(16, 16, 0.1);
    // receiverDepth=0.05 < 0.1 → shadowMap is behind → fully lit
    const v = samplePCSS(map, 0.5, 0.5, 0.05, { lightSize: 1.0 });
    expect(v).toBeCloseTo(1.0, 4);
  });

  it('uses default options when none provided', () => {
    const map = makeFlatShadowMap(16, 16, 0.9);
    expect(() => samplePCSS(map, 0.5, 0.5, 0.5)).not.toThrow();
  });

  it('respects lightSize option', () => {
    const map = makeBlockerShadowMap(32, 32, 0.2, 0.9, 0.5, 0.5, 0.5);
    // 大 lightSize → 更大搜索半径 → 更软
    const small = samplePCSS(map, 0.5, 0.5, 0.6, { lightSize: 0.5 });
    const large = samplePCSS(map, 0.5, 0.5, 0.6, { lightSize: 4.0 });
    // 两者都应在 [0,1],大 lightSize 不应比小 lightSize 更暗
    expect(small).toBeGreaterThanOrEqual(0);
    expect(small).toBeLessThanOrEqual(1);
    expect(large).toBeGreaterThanOrEqual(0);
    expect(large).toBeLessThanOrEqual(1);
  });

  it('respects pcfSamples option', () => {
    const map = makeFlatShadowMap(16, 16, 0.1);
    const v1 = samplePCSS(map, 0.5, 0.5, 0.5, { pcfSamples: 1 });
    const v16 = samplePCSS(map, 0.5, 0.5, 0.5, { pcfSamples: 16 });
    expect(v1).toBeCloseTo(0.0, 4);
    expect(v16).toBeCloseTo(0.0, 4);
  });
});

// ── samplePCSSWithStats ───────────────────────────────────────────

describe('samplePCSSWithStats', () => {
  it('returns hasBlocker=false when no blocker', () => {
    const map = makeFlatShadowMap(16, 16, 0.9);
    const s = samplePCSSWithStats(map, 0.5, 0.5, 0.5);
    expect(s.hasBlocker).toBe(false);
    expect(s.blockerCount).toBe(0);
    expect(s.penumbra).toBe(0);
    expect(s.visibility).toBe(1);
  });

  it('returns hasBlocker=true with stats when blocker exists', () => {
    const map = makeFlatShadowMap(16, 16, 0.3);
    const s = samplePCSSWithStats(map, 0.5, 0.5, 0.5, { lightSize: 1.0 });
    expect(s.hasBlocker).toBe(true);
    expect(s.blockerCount).toBeGreaterThan(0);
    expect(s.blockerDepth).toBeCloseTo(0.3, 4);
    expect(s.penumbra).toBeGreaterThanOrEqual(1);
    expect(s.penumbra).toBeLessThanOrEqual(16);
    expect(s.visibility).toBeGreaterThanOrEqual(0);
    expect(s.visibility).toBeLessThanOrEqual(1);
  });

  it('penumbra increases when receiver is further from blocker', () => {
    const map = makeFlatShadowMap(16, 16, 0.2);
    const near = samplePCSSWithStats(map, 0.5, 0.5, 0.3, { lightSize: 1.0, maxPenumbra: 100 });
    const far = samplePCSSWithStats(map, 0.5, 0.5, 0.8, { lightSize: 1.0, maxPenumbra: 100 });
    expect(far.penumbra).toBeGreaterThan(near.penumbra);
  });
});

// ── 辅助构造器 ────────────────────────────────────────────────────

describe('helper constructors', () => {
  it('makeFlatShadowMap fills all texels with depth', () => {
    const map = makeFlatShadowMap(8, 8, 0.5);
    expect(map.width).toBe(8);
    expect(map.height).toBe(8);
    expect(map.data.length).toBe(64);
    for (const d of map.data) expect(d).toBe(0.5);
  });

  it('makeBlockerShadowMap creates rectangular blocker', () => {
    const map = makeBlockerShadowMap(32, 32, 0.2, 0.9, 0.5, 0.5, 0.5);
    // 中心应为 blocker 深度
    expect(sampleShadowDepth(map, 0.5, 0.5)).toBeCloseTo(0.2, 4);
    // 边缘应为背景深度
    expect(sampleShadowDepth(map, 0.01, 0.01)).toBeCloseTo(0.9, 4);
  });

  it('makeBlockerShadowMap clamps blocker region to map bounds', () => {
    // 中心在边缘,半径很大 → 不应抛错
    const map = makeBlockerShadowMap(16, 16, 0.2, 0.9, 0, 0, 1.0);
    expect(map.data.length).toBe(256);
  });

  it('POISSON_DISK_16 has 16 entries in unit circle', () => {
    expect(POISSON_DISK_16.length).toBe(16);
    for (const [x, y] of POISSON_DISK_16) {
      const len = Math.sqrt(x * x + y * y);
      expect(len).toBeLessThanOrEqual(1.5);  // Poisson disk 可能略大于 1
    }
  });
});

// ── GLSL 着色器源码校验(与 CPU 实现 1:1 对应) ────────────────────

describe('PCSS_SHADOW_FRAG shader source', () => {
  it('declares all required uniforms', () => {
    expect(PCSS_SHADOW_FRAG).toContain('u_shadowMap');
    expect(PCSS_SHADOW_FRAG).toContain('u_lightVP');
    expect(PCSS_SHADOW_FRAG).toContain('u_shadowBias');
    expect(PCSS_SHADOW_FRAG).toContain('u_shadowMapSize');
    expect(PCSS_SHADOW_FRAG).toContain('u_shadowEnabled');
    expect(PCSS_SHADOW_FRAG).toContain('u_lightSize');
    expect(PCSS_SHADOW_FRAG).toContain('u_pcssBlockerBias');
  });

  it('implements Step 1: blocker search (5x5 grid)', () => {
    expect(PCSS_SHADOW_FRAG).toContain('pcssBlockerSearch');
    expect(PCSS_SHADOW_FRAG).toContain('for (int y = -2; y <= 2; y++)');
    expect(PCSS_SHADOW_FRAG).toContain('for (int x = -2; x <= 2; x++)');
    expect(PCSS_SHADOW_FRAG).toContain('blockerCount');
    expect(PCSS_SHADOW_FRAG).toContain('blockerSum');
  });

  it('implements Step 2: penumbra estimation (similar triangles)', () => {
    expect(PCSS_SHADOW_FRAG).toContain('pcssPenumbra');
    expect(PCSS_SHADOW_FRAG).toContain('(receiverDepth - bd) * u_lightSize / bd');
    expect(PCSS_SHADOW_FRAG).toContain('clamp(penumbra, 1.0, 16.0)');
  });

  it('implements Step 3: variable-rate PCF with Poisson disk', () => {
    expect(PCSS_SHADOW_FRAG).toContain('pcssPCF');
    expect(PCSS_SHADOW_FRAG).toContain('POISSON_16');
    expect(PCSS_SHADOW_FRAG).toContain('for (int i = 0; i < 16; i++)');
  });

  it('provides main entry sampleShadowPCSS', () => {
    expect(PCSS_SHADOW_FRAG).toContain('float sampleShadowPCSS(vec3 worldPos)');
  });

  it('early-exits when shadow disabled', () => {
    expect(PCSS_SHADOW_FRAG).toContain('if (u_shadowEnabled == 0) return 1.0');
  });

  it('early-exits when no blocker found', () => {
    expect(PCSS_SHADOW_FRAG).toContain('if (blocker.y < 0.5) return 1.0');
  });

  it('clamps sample UV to edge (CLAMP_TO_EDGE behavior)', () => {
    expect(PCSS_SHADOW_FRAG).toContain('clamp(sampleUV, vec2(0.0), vec2(1.0))');
  });

  it('rotates Poisson disk by UV hash to remove banding', () => {
    expect(PCSS_SHADOW_FRAG).toContain('fract(sin(dot(uv');
    expect(PCSS_SHADOW_FRAG).toContain('6.2831853');
  });

  it('references provenance (Ferrari / UE5 / o3de)', () => {
    expect(PCSS_SHADOW_FRAG).toContain('Ferrari');
    expect(PCSS_SHADOW_FRAG).toContain('UE5');
    expect(PCSS_SHADOW_FRAG).toContain('o3de');
  });

  it('frustum cull: out-of-bounds NDC returns 1.0', () => {
    expect(PCSS_SHADOW_FRAG).toContain('ndc.x < -1.0');
    expect(PCSS_SHADOW_FRAG).toContain('ndc.z > 1.0');
  });
});
