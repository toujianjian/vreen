// RefractorMaterial 测试 — 平面折射材质。
//
// 验证:
//   • 构造默认值 + 自定义选项
//   • copy / clone 深拷贝
//   • 类型标志
//   • tint / baseColor 接受数组或 RGB 对象
//   • shader 源码包含关键 uniform/attribute
//   • 折射 (refract) / 色散 (dispersion) / 菲涅尔逻辑
//   • 与 Refractor 数学库的集成接口

import { describe, it, expect } from 'vitest';
import { RefractorMaterial, REFRACTOR_VERT, REFRACTOR_FRAG } from './RefractorMaterial';
import { Matrix4 } from '../Math/Matrix4';
import { BasicMaterial } from '../Core/Material';

// ─────────────────────────────────────────────────────────────────────

describe('RefractorMaterial construction', () => {
  it('defaults: eta 0.75, opacity 1, tint white, no fresnel, no dispersion', () => {
    const m = new RefractorMaterial();
    expect(m.eta).toBeCloseTo(0.75);
    expect(m.opacity).toBe(1);
    expect(m.tint).toEqual([1, 1, 1]);
    expect(m.fresnelScale).toBe(0);
    expect(m.fresnelPower).toBe(5);
    expect(m.dispersion).toBe(0);
    expect(m.refractionScale).toBeCloseTo(0.02);
    expect(m.baseColor).toEqual([0.02, 0.02, 0.03]);
    expect(m.transparent).toBe(true);
    expect(m.refractionTexture).toBeNull();
    expect(m.textureMatrix).toBeNull();
    expect(m.depthWrite).toBe(false); // 折射面默认不写深度
  });

  it('accepts custom options', () => {
    const tex = {} as any;
    const mat4 = new Matrix4();
    const m = new RefractorMaterial({
      refractionTexture: tex,
      textureMatrix: mat4,
      eta: 0.667, // 空气→玻璃
      tint: [0.9, 0.95, 1.0],
      opacity: 0.7,
      refractionScale: 0.05,
      fresnelScale: 0.4,
      fresnelPower: 4,
      dispersion: 0.03,
      baseColor: [0.1, 0.15, 0.2],
      transparent: false,
      depthWrite: true,
    });
    expect(m.refractionTexture).toBe(tex);
    expect(m.textureMatrix).toBe(mat4);
    expect(m.eta).toBeCloseTo(0.667);
    expect(m.tint).toEqual([0.9, 0.95, 1.0]);
    expect(m.opacity).toBeCloseTo(0.7);
    expect(m.refractionScale).toBeCloseTo(0.05);
    expect(m.fresnelScale).toBeCloseTo(0.4);
    expect(m.fresnelPower).toBe(4);
    expect(m.dispersion).toBeCloseTo(0.03);
    expect(m.baseColor).toEqual([0.1, 0.15, 0.2]);
    expect(m.transparent).toBe(false);
    expect(m.depthWrite).toBe(true);
  });

  it('accepts RGB object for tint', () => {
    const m = new RefractorMaterial({ tint: { r: 0.1, g: 0.2, b: 0.3 } });
    expect(m.tint).toEqual([0.1, 0.2, 0.3]);
  });

  it('accepts RGB object for baseColor', () => {
    const m = new RefractorMaterial({ baseColor: { r: 0.4, g: 0.5, b: 0.6 } });
    expect(m.baseColor).toEqual([0.4, 0.5, 0.6]);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('RefractorMaterial type', () => {
  it('type is "Refractor"', () => {
    const m = new RefractorMaterial();
    expect(m.type).toBe('Refractor');
  });

  it('isRefractorMaterial flag is true', () => {
    const m = new RefractorMaterial();
    expect(m.isRefractorMaterial).toBe(true);
  });

  it('extends BasicMaterial', () => {
    const m = new RefractorMaterial();
    expect(m).toBeInstanceOf(BasicMaterial);
  });

  it('has unique uuid', () => {
    const a = new RefractorMaterial();
    const b = new RefractorMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('distinct from ReflectorMaterial type', () => {
    // 确保类型名不冲突
    const m = new RefractorMaterial();
    expect(m.type).not.toBe('Reflector');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('RefractorMaterial copy / clone', () => {
  it('copy duplicates all fields', () => {
    const tex = {} as any;
    const mat4 = new Matrix4().makePerspective(-0.1 * Math.tan(0.5), 0.1 * Math.tan(0.5), 0.1 * Math.tan(0.5), -0.1 * Math.tan(0.5), 0.1, 100);
    const src = new RefractorMaterial({
      refractionTexture: tex,
      textureMatrix: mat4,
      eta: 0.8,
      tint: [0.5, 0.6, 0.7],
      opacity: 0.8,
      refractionScale: 0.03,
      fresnelScale: 0.3,
      fresnelPower: 4,
      dispersion: 0.02,
      baseColor: [0.01, 0.02, 0.03],
      transparent: false,
      depthWrite: true,
    });
    const dst = new RefractorMaterial();
    dst.copy(src);
    expect(dst.refractionTexture).toBe(tex);
    expect(dst.textureMatrix).toBe(mat4);
    expect(dst.eta).toBeCloseTo(0.8);
    expect(dst.tint).toEqual([0.5, 0.6, 0.7]);
    expect(dst.opacity).toBeCloseTo(0.8);
    expect(dst.refractionScale).toBeCloseTo(0.03);
    expect(dst.fresnelScale).toBeCloseTo(0.3);
    expect(dst.fresnelPower).toBe(4);
    expect(dst.dispersion).toBeCloseTo(0.02);
    expect(dst.baseColor).toEqual([0.01, 0.02, 0.03]);
    expect(dst.transparent).toBe(false);
    expect(dst.depthWrite).toBe(true);
  });

  it('copy is independent (arrays not shared)', () => {
    const src = new RefractorMaterial({ tint: [1, 2, 3], baseColor: [4, 5, 6] });
    const dst = new RefractorMaterial().copy(src);
    dst.tint[0] = 99;
    dst.baseColor[0] = 88;
    expect(src.tint[0]).toBe(1);
    expect(src.baseColor[0]).toBe(4);
  });

  it('clone returns independent copy', () => {
    const src = new RefractorMaterial({
      eta: 0.9,
      tint: [0.1, 0.2, 0.3],
      opacity: 0.5,
      dispersion: 0.04,
    });
    const c = src.clone();
    expect(c).not.toBe(src);
    expect(c.eta).toBe(src.eta);
    expect(c.tint).toEqual(src.tint);
    expect(c.opacity).toBe(src.opacity);
    expect(c.dispersion).toBe(src.dispersion);
    // 独立性
    c.tint[0] = 99;
    expect(src.tint[0]).toBeCloseTo(0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('RefractorMaterial shader source', () => {
  it('REFRACTOR_VERT has #version 300 es', () => {
    expect(REFRACTOR_VERT).toContain('#version 300 es');
  });

  it('REFRACTOR_FRAG has #version 300 es', () => {
    expect(REFRACTOR_FRAG).toContain('#version 300 es');
  });

  it('vertex shader uses textureMatrix uniform', () => {
    expect(REFRACTOR_VERT).toContain('u_textureMatrix');
    expect(REFRACTOR_VERT).toContain('uniform mat4 u_textureMatrix');
  });

  it('vertex shader computes v_screenCoord = textureMatrix * worldPos', () => {
    expect(REFRACTOR_VERT).toContain('v_screenCoord');
    expect(REFRACTOR_VERT).toContain('u_textureMatrix * worldPos');
  });

  it('vertex shader has standard transform uniforms', () => {
    expect(REFRACTOR_VERT).toContain('u_model');
    expect(REFRACTOR_VERT).toContain('u_view');
    expect(REFRACTOR_VERT).toContain('u_projection');
    expect(REFRACTOR_VERT).toContain('u_normalMatrix');
  });

  it('fragment shader samples refraction texture', () => {
    expect(REFRACTOR_FRAG).toContain('u_refractionMap');
    expect(REFRACTOR_FRAG).toContain('sampler2D u_refractionMap');
    expect(REFRACTOR_FRAG).toContain('texture(u_refractionMap');
  });

  it('fragment shader does perspective divide', () => {
    expect(REFRACTOR_FRAG).toContain('v_screenCoord.xy / v_screenCoord.w');
  });

  it('fragment shader uses GLSL refract()', () => {
    expect(REFRACTOR_FRAG).toContain('refract(');
  });

  it('fragment shader has eta uniform', () => {
    expect(REFRACTOR_FRAG).toContain('u_eta');
    expect(REFRACTOR_FRAG).toContain('uniform float u_eta');
  });

  it('fragment shader has tint uniform', () => {
    expect(REFRACTOR_FRAG).toContain('u_tint');
    expect(REFRACTOR_FRAG).toContain('* u_tint');
  });

  it('fragment shader has opacity uniform', () => {
    expect(REFRACTOR_FRAG).toContain('u_opacity');
    expect(REFRACTOR_FRAG).toContain('vec4(finalColor, u_opacity)');
  });

  it('fragment shader has refractionScale uniform', () => {
    expect(REFRACTOR_FRAG).toContain('u_refractionScale');
    expect(REFRACTOR_FRAG).toContain('* u_refractionScale');
  });

  it('fragment shader has Fresnel logic', () => {
    expect(REFRACTOR_FRAG).toContain('u_fresnelScale');
    expect(REFRACTOR_FRAG).toContain('fresnelSchlick');
    expect(REFRACTOR_FRAG).toContain('u_fresnelPower');
  });

  it('fragment shader has dispersion logic', () => {
    expect(REFRACTOR_FRAG).toContain('u_dispersion');
    expect(REFRACTOR_FRAG).toContain('etaR');
    expect(REFRACTOR_FRAG).toContain('etaG');
    expect(REFRACTOR_FRAG).toContain('etaB');
  });

  it('fragment shader has baseColor for fallback', () => {
    expect(REFRACTOR_FRAG).toContain('u_baseColor');
  });

  it('fragment shader has refractionMapEnabled flag', () => {
    expect(REFRACTOR_FRAG).toContain('u_refractionMapEnabled');
    expect(REFRACTOR_FRAG).toContain('u_refractionMapEnabled == 1');
  });

  it('fragment shader clamps refraction UV to [0,1]', () => {
    expect(REFRACTOR_FRAG).toContain('clamp(screenUv');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('RefractorMaterial integration with Refractor math', () => {
  it('textureMatrix field accepts Matrix4', () => {
    // 模拟主相机的 textureMatrix = scaleBias × projection × view
    const proj = new Matrix4().makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const view = new Matrix4().makeLookAt(
      { x: 0, y: 5, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    const scaleBias = new Matrix4();
    const sb = scaleBias.elements;
    sb[0] = 0.5; sb[5] = 0.5; sb[10] = 0.5;
    sb[12] = 0.5; sb[13] = 0.5; sb[14] = 0.5;
    const pv = new Matrix4().multiplyMatrices(proj, view);
    const textureMatrix = new Matrix4().multiplyMatrices(scaleBias, pv);

    const m = new RefractorMaterial({ textureMatrix });
    expect(m.textureMatrix).toBe(textureMatrix);
    expect(m.textureMatrix!.elements.length).toBe(16);
  });

  it('can update textureMatrix at runtime', () => {
    const m = new RefractorMaterial();
    expect(m.textureMatrix).toBeNull();
    const mat = new Matrix4();
    m.textureMatrix = mat;
    expect(m.textureMatrix).toBe(mat);
  });

  it('can update refractionTexture at runtime', () => {
    const m = new RefractorMaterial();
    expect(m.refractionTexture).toBeNull();
    const tex = { isTexture: true } as any;
    m.refractionTexture = tex;
    expect(m.refractionTexture).toBe(tex);
  });

  it('can update eta at runtime (air→water vs air→glass)', () => {
    const m = new RefractorMaterial();
    expect(m.eta).toBeCloseTo(0.75); // 空气→水
    m.eta = 0.667; // 空气→玻璃
    expect(m.eta).toBeCloseTo(0.667);
  });
});
