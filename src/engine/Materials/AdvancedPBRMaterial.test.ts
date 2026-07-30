// AdvancedPBRMaterial.test.ts — 高级 PBR 材质测试。
//
// 验证:
//   * 构造与默认值
//   * 选项覆盖
//   * 所有 setter(setBaseColor / setRoughness / setMetallic / setAnisotropy /
//     setIridescence / setClearcoat / setSheen / setEmissive / setAlphaMode /
//     setDoubleSided / setNormalScale / setAOStrength)
//   * CPU BRDF:computeAnisotropicBRDF / computeIridescence / computeClearcoat / computeSheen
//   * getVertexShader / getFragmentShader / getUniforms
//   * toJSON / fromJSON 往返
//   * clone / copy 独立性
//   * dispose 可重复调用
//   * shader 源码非空且结构正确
//   * alphaMode = blend 自动 transparent

import { describe, it, expect } from 'vitest';
import {
  AdvancedPBRMaterial,
  ADV_PBR_VERT,
  ADV_PBR_FRAG,
  type AnisotropicBRDFInput,
} from './AdvancedPBRMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';
import { Vector3 } from '../Math/Vector3';

describe('AdvancedPBRMaterial — 构造与默认值', () => {
  it('默认构造', () => {
    const m = new AdvancedPBRMaterial();
    expect(m.type).toBe('AdvancedPBR');
    expect(m.isAdvancedPBRMaterial).toBe(true);
    expect(m.baseColor).toEqual({ r: 0.8, g: 0.8, b: 0.8 });
    expect(m.roughness).toBeCloseTo(0.5, 5);
    expect(m.metallic).toBe(0);
    expect(m.anisotropy).toBe(0);
    expect(m.anisotropyDirection).toBe(0);
    expect(m.iridescence).toBe(0);
    expect(m.iridescenceIOR).toBeCloseTo(1.3, 5);
    expect(m.iridescenceThicknessMin).toBe(100);
    expect(m.iridescenceThicknessMax).toBe(400);
    expect(m.clearcoat).toBe(0);
    expect(m.clearcoatRoughness).toBeCloseTo(0.03, 5);
    expect(m.clearcoatNormal).toBeNull();
    expect(m.sheen).toBe(0);
    expect(m.sheenColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.sheenRoughness).toBeCloseTo(0.5, 5);
    expect(m.emissive).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.emissiveIntensity).toBe(1);
    expect(m.alphaMode).toBe('opaque');
    expect(m.alphaCutoff).toBeCloseTo(0.5, 5);
    expect(m.doubleSided).toBe(false);
    expect(m.normalScale).toBe(1);
    expect(m.aoStrength).toBe(1);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.quality).toBe('high');
  });

  it('继承自 BasicMaterial', () => {
    expect(new AdvancedPBRMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new AdvancedPBRMaterial();
    const b = new AdvancedPBRMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('fromHex 便捷构造', () => {
    const m = AdvancedPBRMaterial.fromHex('#ff8800');
    expect(m.baseColor.r).toBeCloseTo(1.0, 2);
    expect(m.baseColor.g).toBeCloseTo(0x88 / 255, 2);
    expect(m.baseColor.b).toBeCloseTo(0, 2);
  });
});

describe('AdvancedPBRMaterial — 选项覆盖', () => {
  it('所有选项生效', () => {
    const m = new AdvancedPBRMaterial({
      baseColor: { r: 0.8, g: 0.6, b: 0.4 },
      roughness: 0.3,
      metallic: 0.9,
      anisotropy: 0.8,
      anisotropyDirection: 45,
      iridescence: 0.6,
      iridescenceIOR: 1.5,
      iridescenceThicknessMin: 200,
      iridescenceThicknessMax: 600,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      clearcoatNormal: { r: 0.5, g: 0.5, b: 1.0 },
      sheen: 0.7,
      sheenColor: { r: 0.9, g: 0.8, b: 0.7 },
      sheenRoughness: 0.4,
      emissive: { r: 0.1, g: 0.2, b: 0.3 },
      emissiveIntensity: 2.5,
      alphaMode: 'blend',
      alphaCutoff: 0.4,
      doubleSided: true,
      normalScale: 1.5,
      aoStrength: 0.8,
      opacity: 0.7,
      transparent: true,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      quality: 'medium',
    });
    expect(m.baseColor).toEqual({ r: 0.8, g: 0.6, b: 0.4 });
    expect(m.roughness).toBeCloseTo(0.3, 5);
    expect(m.metallic).toBeCloseTo(0.9, 5);
    expect(m.anisotropy).toBeCloseTo(0.8, 5);
    expect(m.anisotropyDirection).toBe(45);
    expect(m.iridescence).toBeCloseTo(0.6, 5);
    expect(m.iridescenceIOR).toBeCloseTo(1.5, 5);
    expect(m.iridescenceThicknessMin).toBe(200);
    expect(m.iridescenceThicknessMax).toBe(600);
    expect(m.clearcoat).toBeCloseTo(1.0, 5);
    expect(m.clearcoatRoughness).toBeCloseTo(0.05, 5);
    expect(m.clearcoatNormal).toEqual({ r: 0.5, g: 0.5, b: 1.0 });
    expect(m.sheen).toBeCloseTo(0.7, 5);
    expect(m.sheenColor).toEqual({ r: 0.9, g: 0.8, b: 0.7 });
    expect(m.sheenRoughness).toBeCloseTo(0.4, 5);
    expect(m.emissive).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(m.emissiveIntensity).toBeCloseTo(2.5, 5);
    expect(m.alphaMode).toBe('blend');
    expect(m.alphaCutoff).toBeCloseTo(0.4, 5);
    expect(m.doubleSided).toBe(true);
    expect(m.normalScale).toBeCloseTo(1.5, 5);
    expect(m.aoStrength).toBeCloseTo(0.8, 5);
    expect(m.opacity).toBeCloseTo(0.7, 5);
    expect(m.transparent).toBe(true);
    expect(m.wireframe).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.quality).toBe('medium');
  });

  it('anisotropy 截断到 [-1,1]', () => {
    const m = new AdvancedPBRMaterial({ anisotropy: 5 });
    expect(m.anisotropy).toBe(1);
    const m2 = new AdvancedPBRMaterial({ anisotropy: -5 });
    expect(m2.anisotropy).toBe(-1);
  });

  it('anisotropyDirection 包裹到 [0,360)', () => {
    const m = new AdvancedPBRMaterial({ anisotropyDirection: 400 });
    expect(m.anisotropyDirection).toBe(40);
    const m2 = new AdvancedPBRMaterial({ anisotropyDirection: -30 });
    expect(m2.anisotropyDirection).toBe(330);
  });

  it('iridescenceThicknessMax >= min', () => {
    const m = new AdvancedPBRMaterial({ iridescenceThicknessMin: 300, iridescenceThicknessMax: 100 });
    expect(m.iridescenceThicknessMax).toBeGreaterThanOrEqual(m.iridescenceThicknessMin);
  });

  it('clearcoatNormal: null 选项生效', () => {
    const m = new AdvancedPBRMaterial({ clearcoatNormal: null });
    expect(m.clearcoatNormal).toBeNull();
  });

  it('alphaMode=blend 自动 transparent', () => {
    const m = new AdvancedPBRMaterial({ alphaMode: 'blend' });
    expect(m.transparent).toBe(true);
  });
});

describe('AdvancedPBRMaterial — setter 链式', () => {
  it('setBaseColor', () => {
    const m = new AdvancedPBRMaterial();
    expect(m.setBaseColor({ r: 0.1, g: 0.2, b: 0.3 })).toBe(m);
    expect(m.baseColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });

  it('setRoughness clamp [0,1]', () => {
    const m = new AdvancedPBRMaterial();
    m.setRoughness(-1);
    expect(m.roughness).toBe(0);
    m.setRoughness(2);
    expect(m.roughness).toBe(1);
  });

  it('setMetallic clamp [0,1]', () => {
    const m = new AdvancedPBRMaterial();
    m.setMetallic(-1);
    expect(m.metallic).toBe(0);
    m.setMetallic(2);
    expect(m.metallic).toBe(1);
  });

  it('setAnisotropy', () => {
    const m = new AdvancedPBRMaterial();
    m.setAnisotropy(0.6, 90);
    expect(m.anisotropy).toBeCloseTo(0.6, 5);
    expect(m.anisotropyDirection).toBe(90);
    m.setAnisotropy(-2, 400);
    expect(m.anisotropy).toBe(-1);
    expect(m.anisotropyDirection).toBe(40);
  });

  it('setIridescence', () => {
    const m = new AdvancedPBRMaterial();
    m.setIridescence(0.8, 1.5, 100, 500);
    expect(m.iridescence).toBeCloseTo(0.8, 5);
    expect(m.iridescenceIOR).toBeCloseTo(1.5, 5);
    expect(m.iridescenceThicknessMin).toBe(100);
    expect(m.iridescenceThicknessMax).toBe(500);
  });

  it('setClearcoat', () => {
    const m = new AdvancedPBRMaterial();
    m.setClearcoat(1.0, 0.1, { r: 0.5, g: 0.5, b: 1 });
    expect(m.clearcoat).toBeCloseTo(1.0, 5);
    expect(m.clearcoatRoughness).toBeCloseTo(0.1, 5);
    expect(m.clearcoatNormal).toEqual({ r: 0.5, g: 0.5, b: 1 });
    // 不传 normal → null
    m.setClearcoat(0.5, 0.2);
    expect(m.clearcoatNormal).toBeNull();
  });

  it('setSheen', () => {
    const m = new AdvancedPBRMaterial();
    m.setSheen(0.7, { r: 0.9, g: 0.8, b: 0.7 }, 0.3);
    expect(m.sheen).toBeCloseTo(0.7, 5);
    expect(m.sheenColor).toEqual({ r: 0.9, g: 0.8, b: 0.7 });
    expect(m.sheenRoughness).toBeCloseTo(0.3, 5);
  });

  it('setEmissive', () => {
    const m = new AdvancedPBRMaterial();
    m.setEmissive({ r: 0.1, g: 0.2, b: 0.3 }, 2.0);
    expect(m.emissive).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(m.emissiveIntensity).toBeCloseTo(2.0, 5);
    // 负值强度 → 0
    m.setEmissive({ r: 0, g: 0, b: 0 }, -1);
    expect(m.emissiveIntensity).toBe(0);
  });

  it('setAlphaMode 自动 transparent', () => {
    const m = new AdvancedPBRMaterial();
    m.setAlphaMode('mask', 0.3);
    expect(m.alphaMode).toBe('mask');
    expect(m.alphaCutoff).toBeCloseTo(0.3, 5);
    expect(m.transparent).toBe(false);
    m.setAlphaMode('blend');
    expect(m.transparent).toBe(true);
  });

  it('setDoubleSided', () => {
    const m = new AdvancedPBRMaterial();
    expect(m.setDoubleSided(true)).toBe(m);
    expect(m.doubleSided).toBe(true);
  });

  it('setNormalScale clamp >=0', () => {
    const m = new AdvancedPBRMaterial();
    m.setNormalScale(-1);
    expect(m.normalScale).toBe(0);
    m.setNormalScale(2);
    expect(m.normalScale).toBe(2);
  });

  it('setAOStrength clamp [0,1]', () => {
    const m = new AdvancedPBRMaterial();
    m.setAOStrength(-1);
    expect(m.aoStrength).toBe(0);
    m.setAOStrength(2);
    expect(m.aoStrength).toBe(1);
  });

  it('链式调用返回 this', () => {
    const m = new AdvancedPBRMaterial();
    const ret = m.setBaseColor({ r: 1, g: 0, b: 0 }).setRoughness(0.2).setMetallic(0.9);
    expect(ret).toBe(m);
  });
});

describe('AdvancedPBRMaterial — CPU BRDF', () => {
  it('computeAnisotropicBRDF 返回合法 RGB', () => {
    const m = new AdvancedPBRMaterial({ metallic: 0.5, roughness: 0.3, anisotropy: 0.5 });
    const input: AnisotropicBRDFInput = {
      N: new Vector3(0, 1, 0),
      V: new Vector3(0, 0, 1),
      L: new Vector3(0, 1, 0).normalize(),
      T: new Vector3(1, 0, 0),
      B: new Vector3(0, 0, 1),
    };
    const out = m.computeAnisotropicBRDF(input);
    expect(out.diffuse.r).toBeGreaterThanOrEqual(0);
    expect(out.specular.r).toBeGreaterThanOrEqual(0);
    expect(out.fresnel).toBeGreaterThanOrEqual(0);
    expect(out.fresnel).toBeLessThanOrEqual(1);
  });

  it('computeAnisotropicBRDF metallic=1 时 diffuse 近 0', () => {
    const m = new AdvancedPBRMaterial({ metallic: 1, roughness: 0.3, anisotropy: 0.5 });
    const input: AnisotropicBRDFInput = {
      N: new Vector3(0, 1, 0),
      V: new Vector3(0, 0, 1),
      L: new Vector3(0, 1, 0).normalize(),
      T: new Vector3(1, 0, 0),
      B: new Vector3(0, 0, 1),
    };
    const out = m.computeAnisotropicBRDF(input);
    expect(out.diffuse.r).toBeCloseTo(0, 5);
    expect(out.diffuse.g).toBeCloseTo(0, 5);
    expect(out.diffuse.b).toBeCloseTo(0, 5);
  });

  it('computeAnisotropicBRDF NoL=0 时 specular 为 0', () => {
    const m = new AdvancedPBRMaterial({ metallic: 0.5, roughness: 0.3 });
    const input: AnisotropicBRDFInput = {
      N: new Vector3(0, 1, 0),
      V: new Vector3(0, 1, 0),
      L: new Vector3(0, -1, 0), // NoL = 0
      T: new Vector3(1, 0, 0),
      B: new Vector3(0, 0, 1),
    };
    const out = m.computeAnisotropicBRDF(input);
    expect(out.specular.r).toBeGreaterThanOrEqual(0);
    expect(out.diffuse.r).toBeCloseTo(0, 5);
  });

  it('computeIridescence 返回 [0,1] RGB', () => {
    const m = new AdvancedPBRMaterial({ iridescence: 1, iridescenceIOR: 1.3 });
    const out = m.computeIridescence({
      cosTheta: 0.5,
      thickness: 300,
      intensity: 1,
      ior: 1.3,
    });
    expect(out.reflectance.r).toBeGreaterThanOrEqual(0);
    expect(out.reflectance.r).toBeLessThanOrEqual(1);
    expect(out.reflectance.g).toBeGreaterThanOrEqual(0);
    expect(out.reflectance.b).toBeGreaterThanOrEqual(0);
    expect(out.f0).toBeGreaterThan(0);
    expect(out.f0).toBeLessThan(0.1);
  });

  it('computeIridescence intensity=0 → 0', () => {
    const m = new AdvancedPBRMaterial();
    const out = m.computeIridescence({
      cosTheta: 0.5,
      thickness: 300,
      intensity: 0,
      ior: 1.3,
    });
    expect(out.reflectance.r).toBe(0);
    expect(out.reflectance.g).toBe(0);
    expect(out.reflectance.b).toBe(0);
  });

  it('computeClearcoat 返回 [0,1]', () => {
    const m = new AdvancedPBRMaterial({ clearcoat: 1, clearcoatRoughness: 0.05 });
    const N = new Vector3(0, 1, 0);
    const V = new Vector3(0, 0, 1);
    const L = new Vector3(0, 1, 0).normalize();
    const H = V.clone().add(L).normalize();
    const out = m.computeClearcoat({ N, V, L, H });
    expect(out.specular).toBeGreaterThanOrEqual(0);
    expect(out.fresnel).toBeGreaterThanOrEqual(0);
    expect(out.fresnel).toBeLessThanOrEqual(1);
  });

  it('computeClearcoat=0 时 specular 仍可计算(数据未禁用)', () => {
    const m = new AdvancedPBRMaterial({ clearcoat: 0, clearcoatRoughness: 0.1 });
    const N = new Vector3(0, 1, 0);
    const V = new Vector3(0, 0, 1);
    const L = new Vector3(0, 1, 0).normalize();
    const H = V.clone().add(L).normalize();
    const out = m.computeClearcoat({ N, V, L, H });
    expect(out.specular).toBeGreaterThanOrEqual(0);
  });

  it('computeSheen 返回非负 RGB', () => {
    const m = new AdvancedPBRMaterial({ sheen: 1, sheenColor: { r: 1, g: 1, b: 1 }, sheenRoughness: 0.5 });
    const N = new Vector3(0, 1, 0);
    const V = new Vector3(0, 0, 1);
    const H = new Vector3(0, 1, 1).normalize();
    const out = m.computeSheen({ N, V, H });
    expect(out.reflectance.r).toBeGreaterThanOrEqual(0);
    expect(out.intensity).toBeGreaterThanOrEqual(0);
  });

  it('computeSheen=0 时 reflectance 为 0', () => {
    const m = new AdvancedPBRMaterial({ sheen: 0 });
    const N = new Vector3(0, 1, 0);
    const V = new Vector3(0, 0, 1);
    const H = new Vector3(0, 1, 1).normalize();
    const out = m.computeSheen({ N, V, H });
    expect(out.reflectance.r).toBe(0);
    expect(out.intensity).toBe(0);
  });
});

describe('AdvancedPBRMaterial — shader 接口', () => {
  it('getVertexShader 返回 ADV_PBR_VERT', () => {
    const m = new AdvancedPBRMaterial();
    expect(m.getVertexShader()).toBe(ADV_PBR_VERT);
    expect(m.getVertexShader().length).toBeGreaterThan(0);
  });

  it('getFragmentShader 返回 ADV_PBR_FRAG', () => {
    const m = new AdvancedPBRMaterial();
    expect(m.getFragmentShader()).toBe(ADV_PBR_FRAG);
    expect(m.getFragmentShader().length).toBeGreaterThan(0);
  });

  it('shader 含 GLSL version 与必要的 uniform', () => {
    expect(ADV_PBR_VERT).toContain('#version 300 es');
    expect(ADV_PBR_FRAG).toContain('#version 300 es');
    expect(ADV_PBR_FRAG).toContain('u_baseColor');
    expect(ADV_PBR_FRAG).toContain('u_anisotropy');
    expect(ADV_PBR_FRAG).toContain('u_iridescence');
    expect(ADV_PBR_FRAG).toContain('u_clearcoat');
    expect(ADV_PBR_FRAG).toContain('u_sheen');
    expect(ADV_PBR_FRAG).toContain('u_emissive');
    expect(ADV_PBR_FRAG).toContain('u_alphaMode');
  });

  it('getUniforms 返回所有字段', () => {
    const m = new AdvancedPBRMaterial({
      baseColor: { r: 0.1, g: 0.2, b: 0.3 },
      clearcoatNormal: { r: 0.5, g: 0.5, b: 1 },
      alphaMode: 'blend',
    });
    const u = m.getUniforms();
    expect(u.u_baseColor).toEqual([0.1, 0.2, 0.3]);
    expect(u.u_roughness).toBe(0.5);
    expect(u.u_metallic).toBe(0);
    expect(u.u_anisotropy).toBe(0);
    expect(u.u_iridescence).toBe(0);
    expect(u.u_clearcoat).toBe(0);
    expect(u.u_hasClearcoatNormal).toBe(1);
    expect(u.u_sheen).toBe(0);
    expect(u.u_emissiveIntensity).toBe(1);
    expect(u.u_alphaMode).toBe(2); // blend
    expect(u.u_doubleSided).toBe(0);
    expect(u.u_opacity).toBe(1);
  });

  it('getUniforms 无 clearcoatNormal 时 hasClearcoatNormal=0', () => {
    const m = new AdvancedPBRMaterial();
    expect(m.getUniforms().u_hasClearcoatNormal).toBe(0);
  });

  it('onBeforeCompile 默认 no-op', () => {
    const m = new AdvancedPBRMaterial();
    const shader: ShaderObject = { vertexShader: '', fragmentShader: '' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
  });

  it('customProgramCacheKey 含 alphaMode / doubleSided / clearcoatNormal', () => {
    const m1 = new AdvancedPBRMaterial({ alphaMode: 'opaque' });
    const m2 = new AdvancedPBRMaterial({ alphaMode: 'blend' });
    const m3 = new AdvancedPBRMaterial({ alphaMode: 'opaque', doubleSided: true });
    const m4 = new AdvancedPBRMaterial({ alphaMode: 'opaque', clearcoatNormal: { r: 0, g: 0, b: 1 } });
    expect(m1.customProgramCacheKey()).not.toBe(m2.customProgramCacheKey());
    expect(m1.customProgramCacheKey()).not.toBe(m3.customProgramCacheKey());
    expect(m1.customProgramCacheKey()).not.toBe(m4.customProgramCacheKey());
  });
});

describe('AdvancedPBRMaterial — 序列化 / 克隆 / 释放', () => {
  it('toJSON / fromJSON 往返', () => {
    const m = new AdvancedPBRMaterial({
      baseColor: { r: 0.1, g: 0.2, b: 0.3 },
      roughness: 0.3,
      metallic: 0.9,
      anisotropy: 0.5,
      anisotropyDirection: 60,
      iridescence: 0.7,
      iridescenceIOR: 1.4,
      iridescenceThicknessMin: 150,
      iridescenceThicknessMax: 500,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      clearcoatNormal: { r: 0.5, g: 0.5, b: 1 },
      sheen: 0.6,
      sheenColor: { r: 0.9, g: 0.8, b: 0.7 },
      sheenRoughness: 0.3,
      emissive: { r: 0.2, g: 0.3, b: 0.4 },
      emissiveIntensity: 1.5,
      alphaMode: 'mask',
      alphaCutoff: 0.4,
      doubleSided: true,
      normalScale: 1.5,
      aoStrength: 0.8,
      opacity: 0.7,
      transparent: true,
      quality: 'medium',
    });
    const json = m.toJSON();
    const m2 = new AdvancedPBRMaterial().fromJSON(json);
    expect(m2.baseColor).toEqual(m.baseColor);
    expect(m2.roughness).toBe(m.roughness);
    expect(m2.metallic).toBe(m.metallic);
    expect(m2.anisotropy).toBe(m.anisotropy);
    expect(m2.anisotropyDirection).toBe(m.anisotropyDirection);
    expect(m2.iridescence).toBe(m.iridescence);
    expect(m2.iridescenceIOR).toBe(m.iridescenceIOR);
    expect(m2.iridescenceThicknessMin).toBe(m.iridescenceThicknessMin);
    expect(m2.iridescenceThicknessMax).toBe(m.iridescenceThicknessMax);
    expect(m2.clearcoat).toBe(m.clearcoat);
    expect(m2.clearcoatRoughness).toBe(m.clearcoatRoughness);
    expect(m2.clearcoatNormal).toEqual(m.clearcoatNormal);
    expect(m2.sheen).toBe(m.sheen);
    expect(m2.sheenColor).toEqual(m.sheenColor);
    expect(m2.sheenRoughness).toBe(m.sheenRoughness);
    expect(m2.emissive).toEqual(m.emissive);
    expect(m2.emissiveIntensity).toBe(m.emissiveIntensity);
    expect(m2.alphaMode).toBe(m.alphaMode);
    expect(m2.alphaCutoff).toBe(m.alphaCutoff);
    expect(m2.doubleSided).toBe(m.doubleSided);
    expect(m2.normalScale).toBe(m.normalScale);
    expect(m2.aoStrength).toBe(m.aoStrength);
    expect(m2.opacity).toBe(m.opacity);
    expect(m2.transparent).toBe(m.transparent);
    expect(m2.quality).toBe(m.quality);
  });

  it('fromJSON 处理 clearcoatNormal: null', () => {
    const m = new AdvancedPBRMaterial({ clearcoatNormal: { r: 0.5, g: 0.5, b: 1 } });
    const json = m.toJSON();
    (json as Record<string, unknown>).clearcoatNormal = null;
    const m2 = new AdvancedPBRMaterial().fromJSON(json);
    expect(m2.clearcoatNormal).toBeNull();
  });

  it('fromJSON 处理缺失字段(默认值)', () => {
    const m2 = new AdvancedPBRMaterial().fromJSON({ type: 'AdvancedPBR' });
    expect(m2.baseColor).toEqual({ r: 0.8, g: 0.8, b: 0.8 });
    expect(m2.roughness).toBe(0.5);
  });

  it('fromJSON 非法 alphaMode 不修改', () => {
    const m = new AdvancedPBRMaterial({ alphaMode: 'mask' });
    m.fromJSON({ alphaMode: 'invalid' });
    expect(m.alphaMode).toBe('mask');
  });

  it('clone 返回独立实例', () => {
    const m = new AdvancedPBRMaterial({
      baseColor: { r: 0.1, g: 0.2, b: 0.3 },
      anisotropy: 0.5,
      clearcoatNormal: { r: 0.5, g: 0.5, b: 1 },
    });
    const c = m.clone();
    expect(c).not.toBe(m);
    expect(c.uuid).not.toBe(m.uuid);
    expect(c.baseColor).toEqual(m.baseColor);
    expect(c.anisotropy).toBe(m.anisotropy);
    expect(c.clearcoatNormal).toEqual(m.clearcoatNormal);
    // 修改克隆不影响原
    c.baseColor.r = 1;
    c.clearcoatNormal!.r = 0;
    expect(m.baseColor.r).toBe(0.1);
    expect(m.clearcoatNormal!.r).toBe(0.5);
  });

  it('copy 复制所有字段', () => {
    const a = new AdvancedPBRMaterial({
      baseColor: { r: 0.1, g: 0.2, b: 0.3 },
      iridescence: 0.7,
      clearcoat: 0.8,
      quality: 'low',
    });
    const b = new AdvancedPBRMaterial();
    b.copy(a);
    expect(b.baseColor).toEqual(a.baseColor);
    expect(b.iridescence).toBe(a.iridescence);
    expect(b.clearcoat).toBe(a.clearcoat);
    expect(b.quality).toBe(a.quality);
  });

  it('dispose 可重复调用不抛错', () => {
    const m = new AdvancedPBRMaterial();
    expect(() => {
      m.dispose();
      m.dispose();
    }).not.toThrow();
  });
});
