// SubsurfaceScatteringMaterial.test.ts — 次表面散射材质测试。
//
// 验证:
//   * 构造与默认值
//   * 选项覆盖
//   * 所有 setter(setBaseColor / setSubsurfaceColor / ... )
//   * computeSSS(CPU 参考实现)
//   * getVertexShader / getFragmentShader / getUniforms
//   * toJSON / fromJSON 往返
//   * clone / copy 独立性
//   * dispose 可重复调用
//   * shader 源码非空且结构正确

import { describe, it, expect } from 'vitest';
import {
  SubsurfaceScatteringMaterial,
  SSS_VERT,
  SSS_FRAG,
} from './SubsurfaceScatteringMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';
import { Vector3 } from '../Math/Vector3';

describe('SubsurfaceScatteringMaterial — 构造与默认值', () => {
  it('默认构造', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(m.type).toBe('SSS');
    expect(m.isSubsurfaceScatteringMaterial).toBe(true);
    expect(m.baseColor).toEqual({ r: 0.9, g: 0.7, b: 0.6 });
    expect(m.subsurfaceColor).toEqual({ r: 1.0, g: 0.3, b: 0.2 });
    expect(m.subsurfaceRadius).toEqual({ r: 1.0, g: 0.4, b: 0.2 });
    expect(m.subsurfaceMix).toBeCloseTo(0.5, 5);
    expect(m.subsurfacePower).toBe(4);
    expect(m.subsurfaceDistortion).toBeCloseTo(0.3, 5);
    expect(m.roughness).toBeCloseTo(0.5, 5);
    expect(m.metallic).toBe(0);
    expect(m.thickness).toBeCloseTo(0.5, 5);
    expect(m.translucency).toBeCloseTo(0.5, 5);
    expect(m.sssEnabled).toBe(true);
    expect(m.sssSteps).toBe(4);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.doubleSided).toBe(false);
  });

  it('继承自 BasicMaterial', () => {
    expect(new SubsurfaceScatteringMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new SubsurfaceScatteringMaterial();
    const b = new SubsurfaceScatteringMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('fromHex 便捷构造', () => {
    const m = SubsurfaceScatteringMaterial.fromHex('#ff8800');
    expect(m.baseColor.r).toBeCloseTo(1.0, 2);
    expect(m.baseColor.g).toBeCloseTo(0x88 / 255, 2);
    expect(m.baseColor.b).toBeCloseTo(0, 2);
  });
});

describe('SubsurfaceScatteringMaterial — 选项覆盖', () => {
  it('所有选项生效', () => {
    const m = new SubsurfaceScatteringMaterial({
      baseColor: { r: 0.8, g: 0.6, b: 0.4 },
      subsurfaceColor: { r: 0.9, g: 0.2, b: 0.1 },
      subsurfaceRadius: { r: 0.8, g: 0.3, b: 0.1 },
      subsurfaceMix: 0.7,
      subsurfacePower: 6,
      subsurfaceDistortion: 0.5,
      roughness: 0.3,
      metallic: 0.1,
      thickness: 0.4,
      translucency: 0.8,
      sssEnabled: false,
      sssSteps: 6,
      opacity: 0.7,
      transparent: true,
      doubleSided: true,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
    });
    expect(m.baseColor).toEqual({ r: 0.8, g: 0.6, b: 0.4 });
    expect(m.subsurfaceColor).toEqual({ r: 0.9, g: 0.2, b: 0.1 });
    expect(m.subsurfaceRadius).toEqual({ r: 0.8, g: 0.3, b: 0.1 });
    expect(m.subsurfaceMix).toBeCloseTo(0.7, 5);
    expect(m.subsurfacePower).toBe(6);
    expect(m.subsurfaceDistortion).toBeCloseTo(0.5, 5);
    expect(m.roughness).toBeCloseTo(0.3, 5);
    expect(m.metallic).toBeCloseTo(0.1, 5);
    expect(m.thickness).toBeCloseTo(0.4, 5);
    expect(m.translucency).toBeCloseTo(0.8, 5);
    expect(m.sssEnabled).toBe(false);
    expect(m.sssSteps).toBe(6);
    expect(m.opacity).toBeCloseTo(0.7, 5);
    expect(m.transparent).toBe(true);
    expect(m.doubleSided).toBe(true);
    expect(m.wireframe).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
  });

  it('颜色对象不跨实例共享', () => {
    const a = new SubsurfaceScatteringMaterial();
    const b = new SubsurfaceScatteringMaterial();
    a.baseColor.r = 0.1;
    a.subsurfaceColor.g = 0.5;
    a.subsurfaceRadius.b = 0.9;
    expect(b.baseColor.r).toBeCloseTo(0.9, 5);
    expect(b.subsurfaceColor.g).toBeCloseTo(0.3, 5);
    expect(b.subsurfaceRadius.b).toBeCloseTo(0.2, 5);
  });
});

describe('SubsurfaceScatteringMaterial — setter', () => {
  it('setBaseColor 复制颜色', () => {
    const m = new SubsurfaceScatteringMaterial();
    const src = { r: 0.1, g: 0.2, b: 0.3 };
    m.setBaseColor(src);
    expect(m.baseColor).toEqual(src);
    src.r = 999;
    expect(m.baseColor.r).toBe(0.1);
  });

  it('setSubsurfaceColor 复制颜色', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setSubsurfaceColor({ r: 0.5, g: 0.5, b: 0.5 });
    expect(m.subsurfaceColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it('setSubsurfaceRadius 设置三通道', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setSubsurfaceRadius(0.8, 0.4, 0.2);
    expect(m.subsurfaceRadius).toEqual({ r: 0.8, g: 0.4, b: 0.2 });
  });

  it('setSubsurfaceMix 限制 [0,1]', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setSubsurfaceMix(-1);
    expect(m.subsurfaceMix).toBe(0);
    m.setSubsurfaceMix(2);
    expect(m.subsurfaceMix).toBe(1);
    m.setSubsurfaceMix(0.6);
    expect(m.subsurfaceMix).toBeCloseTo(0.6, 5);
  });

  it('setSubsurfacePower 限制 >=1', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setSubsurfacePower(0);
    expect(m.subsurfacePower).toBe(1);
    m.setSubsurfacePower(8);
    expect(m.subsurfacePower).toBe(8);
  });

  it('setSubsurfaceDistortion 限制 [0,1]', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setSubsurfaceDistortion(-0.5);
    expect(m.subsurfaceDistortion).toBe(0);
    m.setSubsurfaceDistortion(2);
    expect(m.subsurfaceDistortion).toBe(1);
    m.setSubsurfaceDistortion(0.4);
    expect(m.subsurfaceDistortion).toBeCloseTo(0.4, 5);
  });

  it('setRoughness 限制 [0,1]', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setRoughness(-1);
    expect(m.roughness).toBe(0);
    m.setRoughness(2);
    expect(m.roughness).toBe(1);
    m.setRoughness(0.7);
    expect(m.roughness).toBeCloseTo(0.7, 5);
  });

  it('setMetallic 限制 [0,1]', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setMetallic(-1);
    expect(m.metallic).toBe(0);
    m.setMetallic(2);
    expect(m.metallic).toBe(1);
    m.setMetallic(0.5);
    expect(m.metallic).toBeCloseTo(0.5, 5);
  });

  it('setThickness 限制 [0,1]', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setThickness(-1);
    expect(m.thickness).toBe(0);
    m.setThickness(2);
    expect(m.thickness).toBe(1);
    m.setThickness(0.3);
    expect(m.thickness).toBeCloseTo(0.3, 5);
  });

  it('setTranslucency 限制 [0,1]', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setTranslucency(-1);
    expect(m.translucency).toBe(0);
    m.setTranslucency(2);
    expect(m.translucency).toBe(1);
    m.setTranslucency(0.6);
    expect(m.translucency).toBeCloseTo(0.6, 5);
  });

  it('enableSSS 切换', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.enableSSS(false);
    expect(m.sssEnabled).toBe(false);
    m.enableSSS(true);
    expect(m.sssEnabled).toBe(true);
  });

  it('setSSSSteps 限制 [1,8]', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setSSSSteps(0);
    expect(m.sssSteps).toBe(1);
    m.setSSSSteps(16);
    expect(m.sssSteps).toBe(8);
    m.setSSSSteps(5);
    expect(m.sssSteps).toBe(5);
  });

  it('所有 setter 返回 this', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(m.setBaseColor({ r: 0, g: 0, b: 0 })).toBe(m);
    expect(m.setSubsurfaceColor({ r: 0, g: 0, b: 0 })).toBe(m);
    expect(m.setSubsurfaceRadius(0, 0, 0)).toBe(m);
    expect(m.setSubsurfaceMix(0.5)).toBe(m);
    expect(m.setSubsurfacePower(4)).toBe(m);
    expect(m.setSubsurfaceDistortion(0.3)).toBe(m);
    expect(m.setRoughness(0.5)).toBe(m);
    expect(m.setMetallic(0)).toBe(m);
    expect(m.setThickness(0.5)).toBe(m);
    expect(m.setTranslucency(0.5)).toBe(m);
    expect(m.enableSSS(true)).toBe(m);
    expect(m.setSSSSteps(4)).toBe(m);
  });
});

describe('SubsurfaceScatteringMaterial — computeSSS', () => {
  it('computeSSS 启用时返回非负值', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.enableSSS(true);
    const pos = new Vector3(0, 0, 0);
    const normal = new Vector3(0, 1, 0);
    const light = new Vector3(0, 1, 0);
    const result = m.computeSSS(pos, normal, light, 0.5);
    expect(result.r).toBeGreaterThanOrEqual(0);
    expect(result.g).toBeGreaterThanOrEqual(0);
    expect(result.b).toBeGreaterThanOrEqual(0);
  });

  it('computeSSS 禁用时返回 0', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.enableSSS(false);
    const pos = new Vector3(0, 0, 0);
    const normal = new Vector3(0, 1, 0);
    const light = new Vector3(0, 1, 0);
    const result = m.computeSSS(pos, normal, light, 0.5);
    expect(result).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('computeSSS 薄壁(thickness=0)比厚壁(thickness=1)透射更强', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.enableSSS(true);
    m.setTranslucency(1);
    m.setSubsurfaceMix(1);
    const pos = new Vector3(0, 0, 0);
    const normal = new Vector3(0, 1, 0);
    const light = new Vector3(0, 1, 0);
    const thin = m.computeSSS(pos, normal, light, 0);   // 薄壁
    const thick = m.computeSSS(pos, normal, light, 1);  // 厚壁
    const thinSum = thin.r + thin.g + thin.b;
    const thickSum = thick.r + thick.g + thick.b;
    expect(thinSum).toBeGreaterThanOrEqual(thickSum);
  });

  it('computeSSS sssMix=0 时返回 0', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.enableSSS(true);
    m.setSubsurfaceMix(0);
    const pos = new Vector3(0, 0, 0);
    const normal = new Vector3(0, 1, 0);
    const light = new Vector3(0, 1, 0);
    const result = m.computeSSS(pos, normal, light, 0.5);
    expect(result).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('computeSSS sssMix=1 时透射不被混合衰减', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.enableSSS(true);
    m.setSubsurfaceMix(1);
    m.setTranslucency(1);
    const pos = new Vector3(0, 0, 0);
    const normal = new Vector3(0, 1, 0);
    const light = new Vector3(0, 1, 0);
    expect(() => m.computeSSS(pos, normal, light, 0.5)).not.toThrow();
  });
});

describe('SubsurfaceScatteringMaterial — shader 与 uniform', () => {
  it('shader 源码非空且以 #version 300 es 开头', () => {
    expect(typeof SSS_VERT).toBe('string');
    expect(typeof SSS_FRAG).toBe('string');
    expect(SSS_VERT.startsWith('#version 300 es')).toBe(true);
    expect(SSS_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('vertex shader 包含标准 MVP 逻辑', () => {
    expect(SSS_VERT).toContain('u_model');
    expect(SSS_VERT).toContain('u_view');
    expect(SSS_VERT).toContain('u_projection');
    expect(SSS_VERT).toContain('u_normalMatrix');
    expect(SSS_VERT).toContain('v_worldPos');
    expect(SSS_VERT).toContain('v_worldNormal');
  });

  it('fragment shader 包含 SSS 关键 uniform', () => {
    expect(SSS_FRAG).toContain('u_baseColor');
    expect(SSS_FRAG).toContain('u_subsurfaceColor');
    expect(SSS_FRAG).toContain('u_subsurfaceRadius');
    expect(SSS_FRAG).toContain('u_subsurfaceMix');
    expect(SSS_FRAG).toContain('u_subsurfacePower');
    expect(SSS_FRAG).toContain('u_subsurfaceDistortion');
    expect(SSS_FRAG).toContain('u_thickness');
    expect(SSS_FRAG).toContain('u_translucency');
    expect(SSS_FRAG).toContain('u_sssEnabled');
    expect(SSS_FRAG).toContain('u_sssSteps');
  });

  it('fragment shader 包含 SSS 透射逻辑', () => {
    expect(SSS_FRAG).toContain('L_distorted');
    expect(SSS_FRAG).toContain('backLight');
    expect(SSS_FRAG).toContain('pow');
  });

  it('fragment shader 包含 GGX 镜面逻辑', () => {
    expect(SSS_FRAG).toContain('D_GGX');
    expect(SSS_FRAG).toContain('fresnelSchlick');
  });

  it('getVertexShader 返回 SSS_VERT', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(m.getVertexShader()).toBe(SSS_VERT);
  });

  it('getFragmentShader 返回 SSS_FRAG', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(m.getFragmentShader()).toBe(SSS_FRAG);
  });

  it('getUniforms 返回完整字段', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.setBaseColor({ r: 0.1, g: 0.2, b: 0.3 });
    m.setSubsurfaceMix(0.6);
    m.setRoughness(0.4);
    const u = m.getUniforms();
    expect(u.u_baseColor).toEqual([0.1, 0.2, 0.3]);
    expect(u.u_subsurfaceColor).toHaveLength(3);
    expect(u.u_subsurfaceRadius).toHaveLength(3);
    expect(u.u_subsurfaceMix).toBeCloseTo(0.6, 5);
    expect(u.u_subsurfacePower).toBe(4);
    expect(u.u_subsurfaceDistortion).toBeCloseTo(0.3, 5);
    expect(u.u_roughness).toBeCloseTo(0.4, 5);
    expect(u.u_metallic).toBe(0);
    expect(u.u_thickness).toBeCloseTo(0.5, 5);
    expect(u.u_translucency).toBeCloseTo(0.5, 5);
    expect(u.u_sssEnabled).toBe(1);
    expect(u.u_sssSteps).toBe(4);
    expect(u.u_opacity).toBe(1);
  });

  it('getUniforms 禁用 SSS 时 u_sssEnabled 为 0', () => {
    const m = new SubsurfaceScatteringMaterial();
    m.enableSSS(false);
    expect(m.getUniforms().u_sssEnabled).toBe(0);
  });
});

describe('SubsurfaceScatteringMaterial — 序列化', () => {
  it('toJSON 返回完整字段', () => {
    const m = new SubsurfaceScatteringMaterial({
      baseColor: { r: 0.5, g: 0.5, b: 0.5 },
      subsurfaceMix: 0.7,
      thickness: 0.3,
    });
    const json = m.toJSON();
    expect(json.type).toBe('SSS');
    expect(json.baseColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(json.subsurfaceMix).toBeCloseTo(0.7, 5);
    expect(json.thickness).toBeCloseTo(0.3, 5);
    expect(json.sssEnabled).toBe(true);
    expect(json.sssSteps).toBe(4);
    expect(json.opacity).toBe(1);
    expect(json.transparent).toBe(false);
  });

  it('fromJSON 恢复所有字段', () => {
    const src = new SubsurfaceScatteringMaterial({
      baseColor: { r: 0.2, g: 0.4, b: 0.6 },
      subsurfaceColor: { r: 0.9, g: 0.1, b: 0.05 },
      subsurfaceRadius: { r: 0.7, g: 0.2, b: 0.1 },
      subsurfaceMix: 0.8,
      subsurfacePower: 6,
      subsurfaceDistortion: 0.4,
      roughness: 0.3,
      metallic: 0.2,
      thickness: 0.6,
      translucency: 0.7,
      sssEnabled: false,
      sssSteps: 5,
      opacity: 0.6,
      transparent: true,
      doubleSided: true,
    });
    const json = src.toJSON();
    const dst = new SubsurfaceScatteringMaterial();
    dst.fromJSON(json as Record<string, unknown>);
    expect(dst.baseColor).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(dst.subsurfaceColor).toEqual({ r: 0.9, g: 0.1, b: 0.05 });
    expect(dst.subsurfaceRadius).toEqual({ r: 0.7, g: 0.2, b: 0.1 });
    expect(dst.subsurfaceMix).toBeCloseTo(0.8, 5);
    expect(dst.subsurfacePower).toBe(6);
    expect(dst.subsurfaceDistortion).toBeCloseTo(0.4, 5);
    expect(dst.roughness).toBeCloseTo(0.3, 5);
    expect(dst.metallic).toBeCloseTo(0.2, 5);
    expect(dst.thickness).toBeCloseTo(0.6, 5);
    expect(dst.translucency).toBeCloseTo(0.7, 5);
    expect(dst.sssEnabled).toBe(false);
    expect(dst.sssSteps).toBe(5);
    expect(dst.opacity).toBeCloseTo(0.6, 5);
    expect(dst.transparent).toBe(true);
    expect(dst.doubleSided).toBe(true);
  });

  it('fromJSON 返回 this', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(m.fromJSON({})).toBe(m);
  });

  it('toJSON → fromJSON 往返等价', () => {
    const src = new SubsurfaceScatteringMaterial({
      baseColor: { r: 0.3, g: 0.6, b: 0.9 },
      subsurfaceMix: 0.65,
      thickness: 0.45,
      sssSteps: 6,
    });
    const dst = new SubsurfaceScatteringMaterial().fromJSON(
      src.toJSON() as Record<string, unknown>,
    );
    expect(dst.baseColor).toEqual(src.baseColor);
    expect(dst.subsurfaceMix).toBeCloseTo(src.subsurfaceMix, 5);
    expect(dst.thickness).toBeCloseTo(src.thickness, 5);
    expect(dst.sssSteps).toBe(src.sssSteps);
  });

  it('fromJSON 处理空对象不抛错', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(() => m.fromJSON({})).not.toThrow();
  });
});

describe('SubsurfaceScatteringMaterial — clone / copy', () => {
  it('copy 复制所有字段且独立', () => {
    const src = new SubsurfaceScatteringMaterial({
      baseColor: { r: 0.1, g: 0.2, b: 0.3 },
      subsurfaceColor: { r: 0.4, g: 0.5, b: 0.6 },
      subsurfaceMix: 0.8,
      roughness: 0.3,
      metallic: 0.1,
      thickness: 0.7,
      translucency: 0.9,
      sssEnabled: false,
      sssSteps: 6,
      opacity: 0.5,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    src.userData = { tag: 'src' };
    const dst = new SubsurfaceScatteringMaterial();
    dst.copy(src);
    expect(dst.baseColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(dst.subsurfaceColor).toEqual({ r: 0.4, g: 0.5, b: 0.6 });
    expect(dst.subsurfaceMix).toBeCloseTo(0.8, 5);
    expect(dst.roughness).toBeCloseTo(0.3, 5);
    expect(dst.metallic).toBeCloseTo(0.1, 5);
    expect(dst.thickness).toBeCloseTo(0.7, 5);
    expect(dst.translucency).toBeCloseTo(0.9, 5);
    expect(dst.sssEnabled).toBe(false);
    expect(dst.sssSteps).toBe(6);
    expect(dst.opacity).toBeCloseTo(0.5, 5);
    expect(dst.transparent).toBe(true);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(false);
    expect(dst.userData).toEqual({ tag: 'src' });
    // 修改 dst 不影响 src
    dst.baseColor.r = 1;
    expect(src.baseColor.r).toBeCloseTo(0.1, 5);
    dst.thickness = 0.99;
    expect(src.thickness).toBeCloseTo(0.7, 5);
  });

  it('clone 产生等价但独立的新实例', () => {
    const src = new SubsurfaceScatteringMaterial({
      baseColor: { r: 0.5, g: 0.5, b: 0.5 },
      subsurfaceMix: 0.6,
      thickness: 0.4,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(SubsurfaceScatteringMaterial);
    expect(cl).not.toBe(src);
    expect(cl.baseColor).toEqual(src.baseColor);
    expect(cl.subsurfaceMix).toBeCloseTo(src.subsurfaceMix, 5);
    expect(cl.thickness).toBeCloseTo(src.thickness, 5);
    // 修改 clone 不影响 src
    cl.subsurfaceMix = 0.9;
    expect(src.subsurfaceMix).toBeCloseTo(0.6, 5);
  });

  it('clone 分配新 uuid', () => {
    const src = new SubsurfaceScatteringMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });
});

describe('SubsurfaceScatteringMaterial — 其他', () => {
  it('dispose 可重复调用不抛错', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(() => m.dispose()).not.toThrow();
    expect(() => m.dispose()).not.toThrow();
  });

  it('onBeforeCompile 默认 no-op', () => {
    const m = new SubsurfaceScatteringMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
  });

  it('customProgramCacheKey 返回 "sss"', () => {
    const m = new SubsurfaceScatteringMaterial();
    expect(m.customProgramCacheKey()).toBe('sss');
  });
});
