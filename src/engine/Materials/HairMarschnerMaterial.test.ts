// HairMarschnerMaterial 单元测试。
//
// 覆盖:
//   1. hairFresnelDielectric(端点 / R0 / 掠射角递增 / clamp)
//   2. hairRefractCosTheta(Snell / 全反射 / 对称性)
//   3. hairAbsorption(Beer-Lambert 单调递减 / 零吸收=1 / 通道独立)
//   4. hairPathLength(h=0 弦长=2 / h=±1 弦长=0 / passes 翻倍)
//   5. hairLongitudinalM(高斯峰值 / 归一化 / 宽度影响)
//   6. computeHairBSDF(非负 / R 叶主导正入射 / 吸收降低 TT)
//   7. HairMarschnerMaterial 构造 / copy / clone / evaluate / fromPigment
//   8. GLSL shader 源码包含关键 uniform / 函数

import { describe, it, expect } from 'vitest';
import {
  HairMarschnerMaterial,
  HAIR_ETA_DEFAULT,
  HAIR_PIGMENTS,
  hairFresnelDielectric,
  hairRefractCosTheta,
  hairAbsorption,
  hairPathLength,
  hairLongitudinalM,
  computeHairBSDF,
  HAIR_MARSCHNER_VERT,
  HAIR_MARSCHNER_FRAG,
} from './HairMarschnerMaterial';
import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';

// ── hairFresnelDielectric ──────────────────────────────────────────

describe('hairFresnelDielectric', () => {
  it('normal incidence (cos=1) ≈ R0 = ((η-1)/(η+1))²', () => {
    const eta = 1.55;
    const r0 = ((eta - 1) / (eta + 1)) ** 2;
    expect(hairFresnelDielectric(1, eta)).toBeCloseTo(r0, 6);
  });

  it('grazing angle (cos=0) → 1', () => {
    expect(hairFresnelDielectric(0)).toBeCloseTo(1, 6);
  });

  it('monotonically increases as cos decreases (toward grazing)', () => {
    const a = hairFresnelDielectric(0.9);
    const b = hairFresnelDielectric(0.5);
    const c = hairFresnelDielectric(0.1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('clamps cos > 1 and cos < 0', () => {
    expect(hairFresnelDielectric(5)).toBeCloseTo(hairFresnelDielectric(1), 6);
    expect(hairFresnelDielectric(-2)).toBeCloseTo(hairFresnelDielectric(0), 6);
  });

  it('returns value in [0,1]', () => {
    for (let i = 0; i <= 10; i++) {
      const f = hairFresnelDielectric(i / 10);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

// ── hairRefractCosTheta ────────────────────────────────────────────

describe('hairRefractCosTheta', () => {
  it('normal incidence: cosθ_t = 1 (η < 1 still 1 at normal)', () => {
    // η = 1/1.55, cosθ_i = 1 → sin²=0 → cosθ_t = 1
    expect(hairRefractCosTheta(1, 1 / 1.55)).toBeCloseTo(1, 6);
  });

  it('returns 0 on total internal reflection', () => {
    // η large + grazing → TIR
    expect(hairRefractCosTheta(0.1, 2.0)).toBe(0);
  });

  it('bends toward normal when going denser (η<1): cosθ_t > cosθ_i', () => {
    const cosI = 0.8;
    const ct = hairRefractCosTheta(cosI, 1 / 1.55);
    // 进入密介质 → θ_t < θ_i → cosθ_t > cosθ_i
    expect(ct).toBeGreaterThan(cosI);
    expect(ct).toBeLessThanOrEqual(1);
    expect(ct).toBeGreaterThan(0);
  });

  it('satisfies Snell: η²·(1-cos²θ_i) = 1-cos²θ_t', () => {
    const eta = 1 / 1.55;
    const cosI = 0.7;
    const cosT = hairRefractCosTheta(cosI, eta);
    const lhs = eta * eta * (1 - cosI * cosI);
    const rhs = 1 - cosT * cosT;
    expect(rhs).toBeCloseTo(lhs, 5);
  });
});

// ── hairAbsorption ─────────────────────────────────────────────────

describe('hairAbsorption', () => {
  it('zero path length → full transmission (1,1,1)', () => {
    const t = hairAbsorption(0, { r: 1, g: 1, b: 1 });
    expect(t).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('zero sigmaA → full transmission regardless of length', () => {
    const t = hairAbsorption(10, { r: 0, g: 0, b: 0 });
    expect(t).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('monotonically decreases with path length', () => {
    const a = hairAbsorption(0.5, { r: 1, g: 1, b: 1 });
    const b = hairAbsorption(2.0, { r: 1, g: 1, b: 1 });
    expect(b.r).toBeLessThan(a.r);
  });

  it('channels are independent', () => {
    const t = hairAbsorption(1.0, { r: 0.5, g: 1.5, b: 2.5 });
    expect(t.r).toBeGreaterThan(t.g);
    expect(t.g).toBeGreaterThan(t.b);
  });

  it('negative path length treated as 0', () => {
    const t = hairAbsorption(-5, { r: 1, g: 1, b: 1 });
    expect(t).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('all channels in (0,1] for positive args', () => {
    const t = hairAbsorption(3, { r: 0.8, g: 1.2, b: 0.4 });
    [t.r, t.g, t.b].forEach((c) => {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
    });
  });
});

// ── hairPathLength ─────────────────────────────────────────────────

describe('hairPathLength', () => {
  it('h=0 → chord 2, /cosθ_t, passes', () => {
    // cosθ_t=1, passes=1 → 2
    expect(hairPathLength(0, 1, 1)).toBeCloseTo(2, 6);
    // passes=2 → 4
    expect(hairPathLength(0, 1, 2)).toBeCloseTo(4, 6);
  });

  it('h=±1 → chord 0 → path 0', () => {
    expect(hairPathLength(1, 1, 1)).toBeCloseTo(0, 6);
    expect(hairPathLength(-1, 1, 1)).toBeCloseTo(0, 6);
  });

  it('larger passes → longer path', () => {
    const a = hairPathLength(0.3, 0.8, 1);
    const b = hairPathLength(0.3, 0.8, 2);
    expect(b).toBeGreaterThan(a);
  });

  it('smaller cosθ_t → longer path (more oblique)', () => {
    const a = hairPathLength(0.3, 0.9, 1);
    const b = hairPathLength(0.3, 0.4, 1);
    expect(b).toBeGreaterThan(a);
  });

  it('clamps h to [-1,1]', () => {
    expect(hairPathLength(5, 1, 1)).toBeCloseTo(0, 6);
    expect(hairPathLength(-5, 1, 1)).toBeCloseTo(0, 6);
  });
});

// ── hairLongitudinalM ──────────────────────────────────────────────

describe('hairLongitudinalM', () => {
  it('peaks at θ_r = α', () => {
    const alpha = 0.2;
    const beta = 0.1;
    const atPeak = hairLongitudinalM(alpha, alpha, beta);
    const offPeak = hairLongitudinalM(alpha + 0.2, alpha, beta);
    expect(atPeak).toBeGreaterThan(offPeak);
  });

  it('peak value = 1/(√(2π)·β)', () => {
    const beta = 0.1;
    const expected = 1 / (Math.sqrt(2 * Math.PI) * beta);
    expect(hairLongitudinalM(0, 0, beta)).toBeCloseTo(expected, 6);
  });

  it('symmetric around α', () => {
    const alpha = 0.1;
    const beta = 0.1;
    const plus = hairLongitudinalM(alpha + 0.15, alpha, beta);
    const minus = hairLongitudinalM(alpha - 0.15, alpha, beta);
    expect(plus).toBeCloseTo(minus, 6);
  });

  it('larger β → lower peak (energy spreads)', () => {
    const narrow = hairLongitudinalM(0, 0, 0.05);
    const wide = hairLongitudinalM(0, 0, 0.2);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('always non-negative', () => {
    for (let i = -5; i <= 5; i++) {
      expect(hairLongitudinalM(i * 0.1, 0, 0.1)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── computeHairBSDF ────────────────────────────────────────────────

describe('computeHairBSDF', () => {
  const baseInput = {
    thetaI: 0.3,
    thetaR: 0.3,
    eta: 1.55,
    sigmaA: { r: 0.6, g: 0.8, b: 1.2 },
    betaR: 0.05,
    betaTT: 0.1,
    betaTRT: 0.15,
    alphaR: -0.035,
    alphaTT: -0.1,
    alphaTRT: -0.2,
  };

  it('returns non-negative RGB', () => {
    const out = computeHairBSDF(baseInput);
    [out.r, out.g, out.b].forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
  });

  it('R lobe dominates near specular (θ_r ≈ θ_i, low absorption sigmaA=0)', () => {
    const out = computeHairBSDF({ ...baseInput, sigmaA: { r: 0, g: 0, b: 0 } });
    // 无吸收时 R 叶(Fresnel)贡献应明显存在(正值)
    expect(out.r).toBeGreaterThan(0);
  });

  it('higher absorption reduces TT/TRT color (channel-wise)', () => {
    const lowAbs = computeHairBSDF({ ...baseInput, sigmaA: { r: 0.1, g: 0.1, b: 0.1 } });
    const highAbs = computeHairBSDF({ ...baseInput, sigmaA: { r: 2.0, g: 2.0, b: 2.0 } });
    // 强吸收使 TT/TRT 透射下降 → 整体散射降低(至少一个通道)
    expect(Math.min(highAbs.r, highAbs.g, highAbs.b)).toBeLessThanOrEqual(
      Math.min(lowAbs.r, lowAbs.g, lowAbs.b),
    );
  });

  it('absorption tints channels differently', () => {
    // σ_a 蓝通道高 → 蓝光被吸收多 → b 通道散射低
    const out = computeHairBSDF({
      ...baseInput,
      sigmaA: { r: 0.1, g: 0.1, b: 3.0 },
    });
    expect(out.b).toBeLessThan(out.r);
    expect(out.b).toBeLessThan(out.g);
  });

  it('ttScale=0 removes TT contribution (lower than with TT)', () => {
    const withTT = computeHairBSDF({ ...baseInput, sigmaA: { r: 1, g: 1, b: 1 } });
    const noTT = computeHairBSDF({
      ...baseInput,
      sigmaA: { r: 1, g: 1, b: 1 },
      ttScale: 0,
    });
    expect(noTT.r).toBeLessThanOrEqual(withTT.r);
  });

  it('grazing (large θ_d) increases Fresnel → more R', () => {
    const grazing = computeHairBSDF({ ...baseInput, thetaR: 1.2 });
    // 掠射角 Fresnel 更大,R 叶更强(整体为正)
    const sum = grazing.r + grazing.g + grazing.b;
    expect(sum).toBeGreaterThan(0);
    // θ_d = (θ_i - θ_r)/2;grazing 时 |θ_d| 更大 → cosθ_d 更小 → F 更大
    const thetaDNormal = Math.abs((baseInput.thetaI - 0.3) / 2);
    const thetaDGrazing = Math.abs((baseInput.thetaI - 1.2) / 2);
    expect(hairFresnelDielectric(Math.cos(thetaDGrazing))).toBeGreaterThan(
      hairFresnelDielectric(Math.cos(thetaDNormal)),
    );
  });
});

// ── HairMarschnerMaterial ──────────────────────────────────────────

describe('HairMarschnerMaterial construction', () => {
  it('defaults', () => {
    const m = new HairMarschnerMaterial();
    expect(m.type).toBe('HairMarschner');
    expect(m.isHairMarschnerMaterial).toBe(true);
    expect(m.eta).toBe(HAIR_ETA_DEFAULT);
    expect(m.betaR).toBe(0.05);
    expect(m.betaTT).toBe(0.1);
    expect(m.betaTRT).toBe(0.15);
    expect(m.alphaR).toBe(-0.035);
    expect(m.ttScale).toBe(1);
    expect(m.trtScale).toBe(1);
    expect(m.transparent).toBe(true);
    expect(m.doubleSided).toBe(true);
    expect(m.programKey).toBe('hair-marschner');
  });

  it('accepts all options', () => {
    const m = new HairMarschnerMaterial({
      baseColor: { r: 0.1, g: 0.2, b: 0.3 },
      eta: 1.4,
      sigmaA: { r: 1, g: 2, b: 3 },
      betaR: 0.07,
      betaTT: 0.12,
      betaTRT: 0.18,
      alphaR: 0,
      alphaTT: -0.05,
      alphaTRT: -0.15,
      roughness: 0.4,
      ttScale: 0.5,
      trtScale: 1.5,
      diffuseScale: 0.3,
      opacity: 0.8,
      lightDirection: new Vector3(0, 1, 0),
      lightColor: new Color(0.5, 0.5, 0.5),
    });
    expect(m.baseColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(m.eta).toBe(1.4);
    expect(m.sigmaA).toEqual({ r: 1, g: 2, b: 3 });
    expect(m.betaR).toBe(0.07);
    expect(m.roughness).toBe(0.4);
    expect(m.ttScale).toBe(0.5);
    expect(m.opacity).toBe(0.8);
    expect(m.lightDirection).toEqual(new Vector3(0, 1, 0));
  });

  it('normalizes lightDirection', () => {
    const m = new HairMarschnerMaterial({ lightDirection: new Vector3(2, 0, 0) });
    expect(m.lightDirection.length()).toBeCloseTo(1, 5);
  });
});

describe('HairMarschnerMaterial.fromPigment', () => {
  it('uses preset sigmaA', () => {
    const m = HairMarschnerMaterial.fromPigment('blonde');
    expect(m.sigmaA).toEqual(HAIR_PIGMENTS.blonde);
  });

  it('accepts custom baseColor', () => {
    const m = HairMarschnerMaterial.fromPigment('red', { r: 0.5, g: 0.1, b: 0.1 });
    expect(m.baseColor).toEqual({ r: 0.5, g: 0.1, b: 0.1 });
    expect(m.sigmaA).toEqual(HAIR_PIGMENTS.red);
  });

  it('preset sigmaA is a copy (not shared reference)', () => {
    const m = HairMarschnerMaterial.fromPigment('black');
    m.sigmaA.r = 999;
    expect(HAIR_PIGMENTS.black.r).toBe(1.0);
  });
});

describe('HairMarschnerMaterial copy/clone', () => {
  it('copy duplicates all fields and is independent', () => {
    const a = new HairMarschnerMaterial({ eta: 1.4, betaR: 0.09, roughness: 0.5 });
    const b = new HairMarschnerMaterial().copy(a);
    expect(b.eta).toBe(1.4);
    expect(b.betaR).toBe(0.09);
    expect(b.roughness).toBe(0.5);
    // 独立性
    b.eta = 1.0;
    expect(a.eta).toBe(1.4);
  });

  it('copy deep-copies RGB fields (no shared reference)', () => {
    const a = new HairMarschnerMaterial({ sigmaA: { r: 1, g: 2, b: 3 } });
    const b = new HairMarschnerMaterial().copy(a);
    b.sigmaA.r = 999;
    expect(a.sigmaA.r).toBe(1);
  });

  it('clone returns independent equal instance', () => {
    const a = new HairMarschnerMaterial({ eta: 1.5, ttScale: 0.3 });
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.eta).toBe(a.eta);
    expect(b.ttScale).toBe(a.ttScale);
    expect(b.type).toBe('HairMarschner');
  });

  it('copy clones lightDirection/lightColor', () => {
    const a = new HairMarschnerMaterial({
      lightDirection: new Vector3(1, 2, 3),
      lightColor: new Color(0.1, 0.2, 0.3),
    });
    const b = new HairMarschnerMaterial().copy(a);
    expect(b.lightDirection).toEqual(a.lightDirection);
    expect(b.lightDirection).not.toBe(a.lightDirection);
    expect(b.lightColor).toEqual(a.lightColor);
    expect(b.lightColor).not.toBe(a.lightColor);
  });
});

describe('HairMarschnerMaterial.evaluate', () => {
  it('returns non-negative RGB consistent with computeHairBSDF', () => {
    const m = new HairMarschnerMaterial();
    const out = m.evaluate(0.3, 0.3);
    [out.r, out.g, out.b].forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
    // 应与同参数 computeHairBSDF 一致
    const ref = computeHairBSDF({
      thetaI: 0.3,
      thetaR: 0.3,
      eta: m.eta,
      sigmaA: m.sigmaA,
      betaR: m.betaR,
      betaTT: m.betaTT,
      betaTRT: m.betaTRT,
      alphaR: m.alphaR,
      alphaTT: m.alphaTT,
      alphaTRT: m.alphaTRT,
      ttScale: m.ttScale,
      trtScale: m.trtScale,
    });
    expect(out).toEqual(ref);
  });
});

// ── GLSL shader source ─────────────────────────────────────────────

describe('GLSL shader source', () => {
  it('vertex shader has required inputs/uniforms', () => {
    expect(HAIR_MARSCHNER_VERT).toContain('a_position');
    expect(HAIR_MARSCHNER_VERT).toContain('a_tangent');
    expect(HAIR_MARSCHNER_VERT).toContain('u_model');
    expect(HAIR_MARSCHNER_VERT).toContain('v_worldTangent');
    expect(HAIR_MARSCHNER_VERT).toContain('#version 300 es');
  });

  it('fragment shader declares Marschner uniforms', () => {
    expect(HAIR_MARSCHNER_FRAG).toContain('u_eta');
    expect(HAIR_MARSCHNER_FRAG).toContain('u_sigmaA');
    expect(HAIR_MARSCHNER_FRAG).toContain('u_betaR');
    expect(HAIR_MARSCHNER_FRAG).toContain('u_betaTT');
    expect(HAIR_MARSCHNER_FRAG).toContain('u_betaTRT');
    expect(HAIR_MARSCHNER_FRAG).toContain('u_alphaR');
    expect(HAIR_MARSCHNER_FRAG).toContain('u_ttScale');
    expect(HAIR_MARSCHNER_FRAG).toContain('u_trtScale');
  });

  it('fragment shader implements the three lobes', () => {
    expect(HAIR_MARSCHNER_FRAG).toContain('fresnelDielectric');
    expect(HAIR_MARSCHNER_FRAG).toContain('NR');
    expect(HAIR_MARSCHNER_FRAG).toContain('NTT');
    expect(HAIR_MARSCHNER_FRAG).toContain('NTRT');
    expect(HAIR_MARSCHNER_FRAG).toContain('absTT');
    expect(HAIR_MARSCHNER_FRAG).toContain('absTRT');
    expect(HAIR_MARSCHNER_FRAG).toContain('Marschner');
  });

  it('fragment shader uses Beer-Lambert absorption', () => {
    expect(HAIR_MARSCHNER_FRAG).toContain('exp(-u_sigmaA');
  });
});
