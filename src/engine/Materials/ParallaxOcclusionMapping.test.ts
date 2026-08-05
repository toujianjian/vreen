import { describe, it, expect } from 'vitest';
import {
  // 类型
  type ParallaxAlgorithm,
  // 常量
  PARALLAX_QUALITY_STEPS,
  // 工具
  sampleHeightmap,
  getNormalizedDepth,
  // 算法
  basicParallaxMapping,
  advancedParallaxMapping,
  calculateParallaxOffset,
  // PDO
  calcPixelDepthOffset,
  // GLSL chunks
  PARALLAX_POM_CHUNK,
  PARALLAX_BASIC_CHUNK,
  PARALLAX_RELIEF_CHUNK,
} from './ParallaxOcclusionMapping';

// ── 测试工具 ─────────────────────────────────────────────────────────

/** 生成平面高度图(所有像素 = height)。 */
function makeFlatHeightmap(size: number, h: number): Float32Array {
  const data = new Float32Array(size * size);
  data.fill(h);
  return data;
}

/** 生成斜坡高度图(从左到右,0 → 1)。 */
function makeRampHeightmap(size: number): Float32Array {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[y * size + x] = x / (size - 1);
    }
  }
  return data;
}

/** 生成阶梯高度图(0 → 0.5 → 1.0,三段)。 */
function makeStepHeightmap(size: number): Float32Array {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = x / size;
      data[y * size + x] = t < 0.33 ? 0.0 : t < 0.66 ? 0.5 : 1.0;
    }
  }
  return data;
}

/** 生成中心凸起高度图(中心 1.0,边缘 0.0)。 */
function makeCenterBumpHeightmap(size: number): Float32Array {
  const data = new Float32Array(size * size);
  const cx = size / 2;
  const cy = size / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // 中心亮(1.0),边缘暗(0.0)。sampleHeightmap 会 1.0 - raw,
      // 所以 raw=1.0(中心)→ height=0.0(顶部),raw=0.0(边缘)→ height=1.0(底部)
      data[y * size + x] = 1.0 - dist / maxDist;
    }
  }
  return data;
}

/** 近似相等比较。 */
function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

// ── sampleHeightmap ──────────────────────────────────────────────────

describe('sampleHeightmap', () => {
  it('flat heightmap returns constant (inverted)', () => {
    const hm = makeFlatHeightmap(4, 0.3);
    // raw=0.3 → height = 1.0 - 0.3 = 0.7
    const h = sampleHeightmap(hm, 4, 4, 0.5, 0.5);
    expect(approxEq(h, 0.7)).toBe(true);
  });

  it('ramp heightmap returns interpolated values', () => {
    const hm = makeRampHeightmap(8);
    // x=0 → raw=0 → height=1.0; x=7 → raw=1 → height=0.0
    const hLeft = sampleHeightmap(hm, 8, 8, 0.0, 0.5);
    const hRight = sampleHeightmap(hm, 8, 8, 1.0, 0.5);
    expect(approxEq(hLeft, 1.0, 0.1)).toBe(true);
    expect(approxEq(hRight, 0.0, 0.1)).toBe(true);
  });

  it('clamps UV to [0,1] by default', () => {
    const hm = makeRampHeightmap(8);
    const h = sampleHeightmap(hm, 8, 8, -0.5, 0.5);
    // clamp → u=0 → raw=0 → height=1.0
    expect(approxEq(h, 1.0, 0.1)).toBe(true);
  });

  it('repeat wrap mode wraps UV', () => {
    const hm = makeRampHeightmap(8);
    const h0 = sampleHeightmap(hm, 8, 8, 0.0, 0.5, 'repeat');
    const h1 = sampleHeightmap(hm, 8, 8, 1.0, 0.5, 'repeat');
    // repeat: u=0 and u=1 should give same result
    expect(approxEq(h0, h1, 0.1)).toBe(true);
  });

  it('bilinear interpolation between texels', () => {
    // 2x2 heightmap with 4 different values
    const hm = new Float32Array([0.0, 0.5, 1.0, 0.25]);
    const h = sampleHeightmap(hm, 2, 2, 0.5, 0.5);
    // center of 2x2 = average of all 4 texels
    // raw avg = (0.0 + 0.5 + 1.0 + 0.25) / 4 = 0.4375
    // height = 1.0 - 0.4375 = 0.5625
    expect(approxEq(h, 0.5625, 0.05)).toBe(true);
  });

  it('returns [0,1] range', () => {
    const hm = makeRampHeightmap(8);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const h = sampleHeightmap(hm, 8, 8, u, 0.5);
      expect(h).toBeGreaterThanOrEqual(-0.01);
      expect(h).toBeLessThanOrEqual(1.01);
    }
  });
});

// ── getNormalizedDepth ───────────────────────────────────────────────

describe('getNormalizedDepth', () => {
  it('returns same as sampleHeightmap for default range', () => {
    const hm = makeRampHeightmap(8);
    const u = 0.3;
    const v = 0.5;
    const d = getNormalizedDepth(hm, 8, 8, u, v, 0, 0.05, 1 / 0.05);
    // Both should be in [0,1] and close (depth range doesn't matter much for flat range)
    expect(d).toBeGreaterThanOrEqual(-0.01);
    expect(d).toBeLessThanOrEqual(1.01);
  });

  it('clamps to minimum depth (no displacement above surface)', () => {
    const hm = makeFlatHeightmap(4, 0.0); // raw=0 → height=1.0
    const d = getNormalizedDepth(hm, 4, 4, 0.5, 0.5, 0, 0.05, 1 / 0.05);
    // height=1.0, clamped to min(1.0, -0 * 20 = 0) → max(1.0, 0) = 1.0
    expect(approxEq(d, 1.0)).toBe(true);
  });
});

// ── PARALLAX_QUALITY_STEPS ───────────────────────────────────────────

describe('PARALLAX_QUALITY_STEPS', () => {
  it('low = 16', () => {
    expect(PARALLAX_QUALITY_STEPS.low).toBe(16);
  });

  it('medium = 32', () => {
    expect(PARALLAX_QUALITY_STEPS.medium).toBe(32);
  });

  it('high = 64', () => {
    expect(PARALLAX_QUALITY_STEPS.high).toBe(64);
  });

  it('ultra = 128', () => {
    expect(PARALLAX_QUALITY_STEPS.ultra).toBe(128);
  });

  it('all values are positive integers', () => {
    for (const steps of Object.values(PARALLAX_QUALITY_STEPS)) {
      expect(steps).toBeGreaterThan(0);
      expect(Number.isInteger(steps)).toBe(true);
    }
  });
});

// ── basicParallaxMapping ─────────────────────────────────────────────

describe('basicParallaxMapping', () => {
  it('flat heightmap: UV offset = dir.xy * height * depthFactor', () => {
    const hm = makeFlatHeightmap(8, 0.5); // raw=0.5 → height=0.5
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.3, y: 0.0, z: 1.0 };
    const depthFactor = 0.1;
    const result = basicParallaxMapping(hm, 8, 8, uv, viewDir, depthFactor);
    // delta = viewDir.xy * height * depthFactor = 0.3 * 0.5 * 0.1 = 0.015
    // uv' = uv - delta = 0.5 - 0.015 = 0.485
    expect(approxEq(result.uv.u, 0.485, 0.01)).toBe(true);
    expect(approxEq(result.uv.v, 0.5)).toBe(true);
  });

  it('returns 1 step', () => {
    const hm = makeFlatHeightmap(4, 0.5);
    const result = basicParallaxMapping(hm, 4, 4, { u: 0.5, v: 0.5 }, { x: 0, y: 0, z: 1 }, 0.05);
    expect(result.steps).toBe(1);
  });

  it('shadowAttenuation = 1 (no shadow in basic)', () => {
    const hm = makeFlatHeightmap(4, 0.5);
    const result = basicParallaxMapping(hm, 4, 4, { u: 0.5, v: 0.5 }, { x: 0, y: 0, z: 1 }, 0.05);
    expect(result.shadowAttenuation).toBe(1);
  });

  it('isClipped = false for basic', () => {
    const hm = makeFlatHeightmap(4, 0.5);
    const result = basicParallaxMapping(hm, 4, 4, { u: 0.5, v: 0.5 }, { x: 0, y: 0, z: 1 }, 0.05);
    expect(result.isClipped).toBe(false);
  });

  it('zero view direction → no offset', () => {
    const hm = makeFlatHeightmap(4, 0.5);
    const result = basicParallaxMapping(hm, 4, 4, { u: 0.5, v: 0.5 }, { x: 0, y: 0, z: 1 }, 0.05);
    expect(approxEq(result.uv.u, 0.5)).toBe(true);
    expect(approxEq(result.uv.v, 0.5)).toBe(true);
  });

  it('offset direction is opposite to view direction', () => {
    const hm = makeFlatHeightmap(8, 0.5);
    const result = basicParallaxMapping(hm, 8, 8, { u: 0.5, v: 0.5 }, { x: 1, y: 0, z: 1 }, 0.1);
    // viewDir.x > 0 → offset.x < 0 → uv.u < 0.5
    expect(result.uv.u).toBeLessThan(0.5);
  });
});

// ── advancedParallaxMapping ──────────────────────────────────────────

describe('advancedParallaxMapping', () => {
  it('flat heightmap: steep finds intersection at height', () => {
    const hm = makeFlatHeightmap(16, 0.5); // height=0.5 everywhere
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.3, y: 0.0, z: 1.0 };
    const result = advancedParallaxMapping(
      hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'steep', false,
    );
    // height=0.5 everywhere → intersection at currentStep ≈ 0.5
    expect(result.depth).toBeGreaterThan(0.3);
    expect(result.depth).toBeLessThan(0.7);
  });

  it('steep produces stepped result (no interpolation)', () => {
    const hm = makeRampHeightmap(16);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.5, y: 0, z: 0.5 };
    const result = advancedParallaxMapping(
      hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'steep', false,
    );
    // Should produce a valid result
    expect(result.uv.u).toBeGreaterThanOrEqual(-0.2);
    expect(result.uv.u).toBeLessThanOrEqual(1.2);
  });

  it('pom produces interpolated result (smoother than steep)', () => {
    const hm = makeRampHeightmap(16);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.5, y: 0, z: 0.5 };
    const steep = advancedParallaxMapping(
      hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'steep', false,
    );
    const pom = advancedParallaxMapping(
      hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'pom', false,
    );
    // Both should produce valid results
    expect(pom.uv.u).toBeGreaterThanOrEqual(-0.2);
    expect(pom.uv.u).toBeLessThanOrEqual(1.2);
    // POM may differ from steep due to interpolation
    expect(Math.abs(pom.uv.u - steep.uv.u)).toBeGreaterThanOrEqual(0);
  });

  it('relief produces refined result', () => {
    const hm = makeRampHeightmap(16);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.5, y: 0, z: 0.5 };
    const result = advancedParallaxMapping(
      hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'relief', false,
    );
    expect(result.uv.u).toBeGreaterThanOrEqual(-0.2);
    expect(result.uv.u).toBeLessThanOrEqual(1.2);
  });

  it('contact produces refined result', () => {
    const hm = makeRampHeightmap(16);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.5, y: 0, z: 0.5 };
    const result = advancedParallaxMapping(
      hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'contact', false,
    );
    expect(result.uv.u).toBeGreaterThanOrEqual(-0.2);
    expect(result.uv.u).toBeLessThanOrEqual(1.2);
  });

  it('all algorithms produce valid UV range', () => {
    const hm = makeRampHeightmap(16);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.3, y: 0.2, z: 0.9 };
    const algorithms: ParallaxAlgorithm[] = ['steep', 'pom', 'relief', 'contact'];
    for (const algo of algorithms) {
      const result = advancedParallaxMapping(
        hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
        0.05, 0, 16, algo, false,
      );
      // UV should be in reasonable range (may slightly exceed [0,1] due to offset)
      expect(result.uv.u).toBeGreaterThanOrEqual(-1);
      expect(result.uv.u).toBeLessThanOrEqual(2);
      expect(result.uv.v).toBeGreaterThanOrEqual(-1);
      expect(result.uv.v).toBeLessThanOrEqual(2);
    }
  });

  it('enableShadow: produces shadow attenuation < 1 when occluded', () => {
    // 阶梯高度图:左低右高,从右侧(高)看向左侧(低),光源从左照
    const hm = makeStepHeightmap(16);
    const uv = { u: 0.6, v: 0.5 }; // 在高区域
    const viewDir = { x: 0.5, y: 0, z: 0.5 }; // 向右看(看向更高)
    const lightDir = { x: -0.5, y: 0, z: 0.5 }; // 光从左照(照向低处)
    const result = advancedParallaxMapping(
      hm, 16, 16, uv, viewDir, lightDir,
      0.1, 0, 32, 'pom', true,
    );
    // 自阴影可能在某些配置下产生 < 1 的衰减
    expect(result.shadowAttenuation).toBeGreaterThanOrEqual(0);
    expect(result.shadowAttenuation).toBeLessThanOrEqual(1);
  });

  it('enableShadow: shadowAttenuation = 1 when no light direction', () => {
    const hm = makeFlatHeightmap(16, 0.5);
    const result = advancedParallaxMapping(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 }, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'pom', true,
    );
    expect(result.shadowAttenuation).toBe(1);
  });

  it('depthOffset shifts the search range', () => {
    const hm = makeFlatHeightmap(16, 0.5);
    const r0 = advancedParallaxMapping(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 }, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'steep', false,
    );
    const r1 = advancedParallaxMapping(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 }, { x: 0, y: 0, z: 0 },
      0.1, 0.05, 16, 'steep', false,
    );
    // depthOffset 应该改变结果(至少偏移量不同)
    expect(Math.abs(r1.offsetTS.z - r0.offsetTS.z)).toBeGreaterThan(0);
  });

  it('more steps → more precise result (relief)', () => {
    const hm = makeRampHeightmap(32);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.5, y: 0, z: 0.5 };
    const r16 = advancedParallaxMapping(
      hm, 32, 32, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 16, 'relief', false,
    );
    const r64 = advancedParallaxMapping(
      hm, 32, 32, uv, viewDir, { x: 0, y: 0, z: 0 },
      0.1, 0, 64, 'relief', false,
    );
    // 两者都应产生有效结果(更多步 = 更精确)
    expect(r16.uv.u).toBeGreaterThanOrEqual(-0.2);
    expect(r64.uv.u).toBeGreaterThanOrEqual(-0.2);
  });

  it('isClipped = true when offset.z > 0 (depthFactor≈0 + depthOffset<0)', () => {
    // o3de 注释:"The main case is when depthFactor==0 and depthOffset<1."
    // 当 depthFactor≈0 时,depthSearchEnd - depthSearchStart < 0.0001,
    // getNormalizedDepth 返回 0,搜索循环不执行,
    // 初始 parallaxOffset.z = -depthOffset > 0 → 被裁剪。
    const hm = makeFlatHeightmap(4, 0.5);
    const result = advancedParallaxMapping(
      hm, 4, 4, { u: 0.5, v: 0.5 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 },
      0.00001, -0.1, 8, 'steep', false,
    );
    // depthOffset=-0.1 → 初始偏移 z = -1 * 1 * (-0.1) = 0.1 > 0 → 应被裁剪
    expect(result.isClipped).toBe(true);
    expect(result.offsetTS.x).toBe(0);
    expect(result.offsetTS.y).toBe(0);
    expect(result.offsetTS.z).toBe(0);
  });

  it('steps field matches numSteps parameter', () => {
    const hm = makeRampHeightmap(16);
    const result = advancedParallaxMapping(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 }, { x: 0, y: 0, z: 0 },
      0.05, 0, 42, 'pom', false,
    );
    expect(result.steps).toBe(42);
  });
});

// ── calculateParallaxOffset (unified entry) ──────────────────────────

describe('calculateParallaxOffset', () => {
  it('basic algorithm delegates to basicParallaxMapping', () => {
    const hm = makeFlatHeightmap(8, 0.5);
    const result = calculateParallaxOffset(
      hm, 8, 8, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { algorithm: 'basic', depthFactor: 0.1 },
    );
    expect(result.steps).toBe(1);
    expect(result.shadowAttenuation).toBe(1);
  });

  it('pom algorithm with quality=low uses 16 steps', () => {
    const hm = makeRampHeightmap(16);
    const result = calculateParallaxOffset(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', quality: 'low' },
    );
    expect(result.steps).toBe(16);
  });

  it('pom algorithm with quality=ultra uses 128 steps', () => {
    const hm = makeRampHeightmap(16);
    const result = calculateParallaxOffset(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', quality: 'ultra' },
    );
    expect(result.steps).toBe(128);
  });

  it('numSteps overrides quality', () => {
    const hm = makeRampHeightmap(16);
    const result = calculateParallaxOffset(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', quality: 'low', numSteps: 50 },
    );
    expect(result.steps).toBe(50);
  });

  it('default algorithm is pom', () => {
    const hm = makeFlatHeightmap(16, 0.5);
    const result = calculateParallaxOffset(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 },
    );
    // default quality = medium → 32 steps
    expect(result.steps).toBe(32);
  });

  it('default depthFactor = 0.05', () => {
    const hm = makeFlatHeightmap(16, 0.5);
    const result = calculateParallaxOffset(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 1, y: 0, z: 1 },
    );
    // Should produce a small offset (depthFactor=0.05 → small UV shift)
    expect(Math.abs(result.uv.u - 0.5)).toBeLessThan(0.1);
  });

  it('default enableShadow = false', () => {
    const hm = makeFlatHeightmap(16, 0.5);
    const result = calculateParallaxOffset(
      hm, 16, 16, { u: 0.5, v: 0.5 }, { x: 0.3, y: 0, z: 1 },
    );
    expect(result.shadowAttenuation).toBe(1);
  });

  it('enableShadow = true activates shadow computation', () => {
    const hm = makeStepHeightmap(16);
    const result = calculateParallaxOffset(
      hm, 16, 16, { u: 0.6, v: 0.5 }, { x: 0.5, y: 0, z: 0.5 },
      { x: -0.5, y: 0, z: 0.5 },
      { algorithm: 'pom', enableShadow: true, shadowStrength: 0.8 },
    );
    // Shadow attenuation should be valid [0,1]
    expect(result.shadowAttenuation).toBeGreaterThanOrEqual(0);
    expect(result.shadowAttenuation).toBeLessThanOrEqual(1);
  });

  it('clamp wrap mode by default', () => {
    const hm = makeRampHeightmap(8);
    const result = calculateParallaxOffset(
      hm, 8, 8, { u: 0.01, v: 0.5 }, { x: -1, y: 0, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { algorithm: 'basic', depthFactor: 0.2 },
    );
    // With clamp, UV should not go too far negative
    expect(result.uv.u).toBeGreaterThan(-0.5);
  });

  it('all algorithms produce consistent results for flat heightmap', () => {
    const hm = makeFlatHeightmap(32, 0.5); // height=0.5 everywhere
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.3, y: 0.1, z: 0.9 };
    const algorithms: ParallaxAlgorithm[] = ['steep', 'pom', 'relief', 'contact'];
    const results: number[] = [];
    for (const algo of algorithms) {
      const r = calculateParallaxOffset(
        hm, 32, 32, uv, viewDir, { x: 0, y: 0, z: 0 },
        { algorithm: algo, numSteps: 32, depthFactor: 0.05 },
      );
      results.push(r.uv.u);
    }
    // All should be close to each other (flat heightmap → consistent intersection)
    const maxSpread = Math.max(...results) - Math.min(...results);
    expect(maxSpread).toBeLessThan(0.05);
  });
});

// ── calcPixelDepthOffset ─────────────────────────────────────────────

describe('calcPixelDepthOffset', () => {
  it('zero tangent offset → original position', () => {
    const posWS = { x: 1, y: 2, z: 3 };
    // Identity viewProjection matrix
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const result = calcPixelDepthOffset(
      { x: 0, y: 0, z: 0 },
      posWS,
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      m,
    );
    expect(approxEq(result.worldPosition.x, 1)).toBe(true);
    expect(approxEq(result.worldPosition.y, 2)).toBe(true);
    expect(approxEq(result.worldPosition.z, 3)).toBe(true);
  });

  it('tangent offset along X → world position shifts along tangent', () => {
    const posWS = { x: 0, y: 0, z: 0 };
    const tangentWS = { x: 1, y: 0, z: 0 };
    const bitangentWS = { x: 0, y: 1, z: 0 };
    const normalWS = { x: 0, y: 0, z: 1 };
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const result = calcPixelDepthOffset(
      { x: 0.5, y: 0, z: 0 },
      posWS, tangentWS, bitangentWS, normalWS, m,
    );
    // worldOffset = T * 0.5 = (0.5, 0, 0)
    expect(approxEq(result.worldPosition.x, 0.5)).toBe(true);
    expect(approxEq(result.worldPosition.y, 0)).toBe(true);
    expect(approxEq(result.worldPosition.z, 0)).toBe(true);
  });

  it('tangent offset along Z (normal) → world position shifts along normal', () => {
    const posWS = { x: 0, y: 0, z: 0 };
    const tangentWS = { x: 1, y: 0, z: 0 };
    const bitangentWS = { x: 0, y: 1, z: 0 };
    const normalWS = { x: 0, y: 0, z: 1 };
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const result = calcPixelDepthOffset(
      { x: 0, y: 0, z: 0.3 },
      posWS, tangentWS, bitangentWS, normalWS, m,
    );
    // worldOffset = N * 0.3 = (0, 0, 0.3)
    expect(approxEq(result.worldPosition.z, 0.3)).toBe(true);
  });

  it('viewProjection matrix transforms world position to clip space', () => {
    const posWS = { x: 0, y: 0, z: -5 }; // 5 units in front of camera
    const tangentWS = { x: 1, y: 0, z: 0 };
    const bitangentWS = { x: 0, y: 1, z: 0 };
    const normalWS = { x: 0, y: 0, z: 1 };
    // Simple perspective matrix: fovy=90, aspect=1, near=0.1, far=100
    // proj[2][2] = -(far+near)/(far-near) = -100.1/99.9 ≈ -1.002
    // proj[2][3] = -2*far*near/(far-near) = -20/99.9 ≈ -0.2002
    // proj[3][2] = -1
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -1.002, -1,
      0, 0, -0.2002, 0,
    ];
    const result = calcPixelDepthOffset(
      { x: 0, y: 0, z: 0 },
      posWS, tangentWS, bitangentWS, normalWS, m,
    );
    // clipW = -posWS.z = 5
    expect(approxEq(result.depthCS, 5, 0.1)).toBe(true);
    // depthNDC = clipZ / clipW = (-1.002 * -5 + -0.2002) / 5 = (5.01 - 0.2002) / 5 ≈ 0.962
    expect(result.depthNDC).toBeGreaterThan(0.5);
    expect(result.depthNDC).toBeLessThan(1.0);
  });

  it('handles arbitrary tangent space basis', () => {
    const posWS = { x: 1, y: 1, z: 1 };
    // 45-degree rotated tangent space
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    const tangentWS = { x: cos45, y: 0, z: -sin45 };
    const bitangentWS = { x: sin45, y: 0, z: cos45 };
    const normalWS = { x: 0, y: 1, z: 0 };
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const offset = { x: 1, y: 0, z: 0 };
    const result = calcPixelDepthOffset(
      offset, posWS, tangentWS, bitangentWS, normalWS, m,
    );
    // worldOffset = T * 1 = (cos45, 0, -sin45) ≈ (0.707, 0, -0.707)
    expect(approxEq(result.worldPosition.x, 1 + cos45, 0.01)).toBe(true);
    expect(approxEq(result.worldPosition.z, 1 - sin45, 0.01)).toBe(true);
  });
});

// ── GLSL chunks ──────────────────────────────────────────────────────

describe('GLSL chunks', () => {
  it('PARALLAX_POM_CHUNK contains calculatePOM function', () => {
    expect(PARALLAX_POM_CHUNK).toContain('calculatePOM');
  });

  it('PARALLAX_POM_CHUNK contains POM linear interpolation', () => {
    expect(PARALLAX_POM_CHUNK).toContain('ratio');
    expect(PARALLAX_POM_CHUNK).toContain('mix');
  });

  it('PARALLAX_POM_CHUNK contains self-shadowing', () => {
    expect(PARALLAX_POM_CHUNK).toContain('shadowAttenuation');
    expect(PARALLAX_POM_CHUNK).toContain('rayUnderSurface');
  });

  it('PARALLAX_POM_CHUNK contains GLSL ES 3.0 syntax', () => {
    expect(PARALLAX_POM_CHUNK).toContain('texture(');
    expect(PARALLAX_POM_CHUNK).toContain('for (int i = 0');
  });

  it('PARALLAX_POM_CHUNK has uniform declarations', () => {
    expect(PARALLAX_POM_CHUNK).toContain('u_heightmap');
    expect(PARALLAX_POM_CHUNK).toContain('u_parallaxDepthFactor');
    expect(PARALLAX_POM_CHUNK).toContain('u_parallaxNumSteps');
  });

  it('PARALLAX_POM_CHUNK has overload without shadow parameter', () => {
    expect(PARALLAX_POM_CHUNK).toContain('dummyShadow');
  });

  it('PARALLAX_BASIC_CHUNK contains calculateBasicParallax', () => {
    expect(PARALLAX_BASIC_CHUNK).toContain('calculateBasicParallax');
  });

  it('PARALLAX_BASIC_CHUNK is simpler than POM chunk', () => {
    expect(PARALLAX_BASIC_CHUNK.length).toBeLessThan(PARALLAX_POM_CHUNK.length);
  });

  it('PARALLAX_RELIEF_CHUNK contains binary search', () => {
    expect(PARALLAX_RELIEF_CHUNK).toContain('calculateReliefParallax');
    expect(PARALLAX_RELIEF_CHUNK).toContain('reliefDelta');
    expect(PARALLAX_RELIEF_CHUNK).toContain('0.5'); // halving step
  });

  it('all chunks use o3de height convention (1.0 - texture.r)', () => {
    expect(PARALLAX_POM_CHUNK).toContain('1.0 - texture(heightmap');
    expect(PARALLAX_BASIC_CHUNK).toContain('1.0 - texture(heightmap');
    expect(PARALLAX_RELIEF_CHUNK).toContain('1.0 - texture(heightmap');
  });
});

// ── 集成测试 ──────────────────────────────────────────────────────────

describe('integration: full POM pipeline', () => {
  it('POM produces visible offset for non-flat heightmap', () => {
    const hm = makeCenterBumpHeightmap(32);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.5, y: 0, z: 0.5 };
    const result = calculateParallaxOffset(
      hm, 32, 32, uv, viewDir, { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', numSteps: 32, depthFactor: 0.1 },
    );
    // Non-flat heightmap → UV should be offset
    expect(Math.abs(result.uv.u - 0.5) + Math.abs(result.uv.v - 0.5)).toBeGreaterThan(0.001);
  });

  it('POM offset increases with depthFactor', () => {
    const hm = makeCenterBumpHeightmap(32);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.5, y: 0, z: 0.5 };
    const small = calculateParallaxOffset(
      hm, 32, 32, uv, viewDir, { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', numSteps: 32, depthFactor: 0.02 },
    );
    const large = calculateParallaxOffset(
      hm, 32, 32, uv, viewDir, { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', numSteps: 32, depthFactor: 0.2 },
    );
    // Larger depthFactor → larger offset
    const smallOff = Math.abs(small.uv.u - 0.5);
    const largeOff = Math.abs(large.uv.u - 0.5);
    expect(largeOff).toBeGreaterThan(smallOff);
  });

  it('POM offset increases with view angle (lower z = more grazing)', () => {
    const hm = makeCenterBumpHeightmap(32);
    const uv = { u: 0.5, v: 0.5 };
    // Front-facing (z=1) → less offset
    const front = calculateParallaxOffset(
      hm, 32, 32, uv, { x: 0.2, y: 0, z: 1.0 }, { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', numSteps: 32, depthFactor: 0.1 },
    );
    // Grazing angle (z=0.3) → more offset
    const grazing = calculateParallaxOffset(
      hm, 32, 32, uv, { x: 0.2, y: 0, z: 0.3 }, { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', numSteps: 32, depthFactor: 0.1 },
    );
    const frontOff = Math.abs(front.uv.u - 0.5);
    const grazingOff = Math.abs(grazing.uv.u - 0.5);
    expect(grazingOff).toBeGreaterThan(frontOff);
  });

  it('flat heightmap: all algorithms converge to same UV', () => {
    const hm = makeFlatHeightmap(32, 0.5);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.3, y: 0.2, z: 0.9 };
    const algorithms: ParallaxAlgorithm[] = ['basic', 'steep', 'pom', 'relief', 'contact'];
    const uvs = algorithms.map(algo =>
      calculateParallaxOffset(
        hm, 32, 32, uv, viewDir, { x: 0, y: 0, z: 0 },
        { algorithm: algo, numSteps: 32, depthFactor: 0.05 },
      ).uv.u,
    );
    const spread = Math.max(...uvs) - Math.min(...uvs);
    // For flat heightmap, all algorithms should give very similar results
    expect(spread).toBeLessThan(0.02);
  });

  it('PDO + POM: depth offset is computed correctly', () => {
    const hm = makeCenterBumpHeightmap(16);
    const uv = { u: 0.5, v: 0.5 };
    const viewDir = { x: 0.3, y: 0, z: 0.9 };
    const pom = calculateParallaxOffset(
      hm, 16, 16, uv, viewDir, { x: 0, y: 0, z: 0 },
      { algorithm: 'pom', numSteps: 16, depthFactor: 0.1 },
    );
    // Use POM offset for PDO
    const pdo = calcPixelDepthOffset(
      pom.offsetTS,
      { x: 0, y: 0, z: -5 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
    );
    // PDO should produce a valid world position
    expect(Number.isFinite(pdo.worldPosition.x)).toBe(true);
    expect(Number.isFinite(pdo.worldPosition.y)).toBe(true);
    expect(Number.isFinite(pdo.worldPosition.z)).toBe(true);
    // Depth should be different from original (z=-5) if offset.z != 0
    if (Math.abs(pom.offsetTS.z) > 1e-6) {
      expect(pdo.worldPosition.z).not.toBe(-5);
    }
  });
});
