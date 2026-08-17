// PreIntegratedSkinMaterial.test.ts — Pre-Integrated Skin 材质与 LUT 测试。
//
// 验证:
//   * SKIN_PROFILE 常量
//   * DiffuseLUT 生成 + 采样(平面归一化为 Lambert、高曲率柔和化、bilinear)
//   * TransmittanceLUT 生成 + 采样(红光透射 > 蓝光、距离单调递减)
//   * PreIntegratedSkinMaterial 构造与默认值
//   * 选项覆盖
//   * 所有 setter
//   * computeSSS CPU 参考实现
//   * getVertexShader / getFragmentShader / getUniforms
//   * setProfile / shareLUTs
//   * toJSON / fromJSON 往返
//   * clone / copy 独立性
//   * dispose 可重复调用
//   * shader 源码非空且结构正确

import { describe, it, expect } from 'vitest';
import {
  PreIntegratedSkinMaterial,
  PRE_INTEGRATED_SKIN_VERT,
  PRE_INTEGRATED_SKIN_FRAG,
} from './PreIntegratedSkinMaterial';
import {
  DiffuseLUT,
  TransmittanceLUT,
  SKIN_PROFILE,
  type DiffuseProfile,
} from './PreIntegratedSkinLUT';
import { BasicMaterial } from '../Core/Material';
import { Vector3 } from '../Math/Vector3';

// ────────────────────────────────────────────────────────────────────
// DiffuseProfile / SKIN_PROFILE
// ────────────────────────────────────────────────────────────────────

describe('SKIN_PROFILE — d\'Eon 2007 皮肤散射参数', () => {
  it('红光散射半径最大,蓝光最小', () => {
    const r = SKIN_PROFILE.scatteringRadius;
    expect(r.r).toBeGreaterThan(r.g);
    expect(r.g).toBeGreaterThan(r.b);
    expect(r.r).toBeCloseTo(0.65, 2);
    expect(r.g).toBeCloseTo(0.38, 2);
    expect(r.b).toBeCloseTo(0.22, 2);
  });

  it('singleScatterAlbedo 各通道接近 1', () => {
    const a = SKIN_PROFILE.singleScatterAlbedo;
    expect(a.r).toBeGreaterThan(0.8);
    expect(a.g).toBeGreaterThan(0.8);
    expect(a.b).toBeGreaterThan(0.7);
  });

  it('f0 接近皮肤 IOR 1.4', () => {
    // F0 = ((n-1)/(n+1))²,n=1.4 → F0 ≈ 0.028
    expect(SKIN_PROFILE.f0).toBeCloseTo(0.028, 2);
  });
});

// ────────────────────────────────────────────────────────────────────
// DiffuseLUT
// ────────────────────────────────────────────────────────────────────

describe('DiffuseLUT — 预积分漫反射 2D LUT', () => {
  it('默认 256×256×3', () => {
    const lut = new DiffuseLUT();
    expect(lut.width).toBe(256);
    expect(lut.height).toBe(256);
    expect(lut.data.length).toBe(256 * 256 * 3);
    expect(lut.data).toBeInstanceOf(Float32Array);
  });

  it('自定义分辨率生效', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 64, 32);
    expect(lut.width).toBe(64);
    expect(lut.height).toBe(32);
    expect(lut.data.length).toBe(64 * 32 * 3);
  });

  it('数据非全零(生成了内容)', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 32, 32);
    let nonZero = 0;
    for (let i = 0; i < lut.data.length; i++) {
      if (lut.data[i] > 1e-6) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(100);
  });

  it('所有值非负有限', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 32, 32);
    for (let i = 0; i < lut.data.length; i++) {
      expect(lut.data[i]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(lut.data[i])).toBe(true);
    }
  });

  it('平面(curvature=0)在 N·L=1 处接近 1', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 64, 64);
    const sampled = lut.sample(1.0, 0);
    expect(sampled.r).toBeGreaterThan(0.9);
    expect(sampled.g).toBeGreaterThan(0.9);
    expect(sampled.b).toBeGreaterThan(0.9);
  });

  it('平面(curvature=0)在 N·L=0 处接近 0', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 64, 64);
    const sampled = lut.sample(0.0, 0);
    expect(sampled.r).toBeLessThan(0.1);
    expect(sampled.g).toBeLessThan(0.1);
    expect(sampled.b).toBeLessThan(0.1);
  });

  it('平面(curvature=0)在 N·L=-1 处为 0(背面无光)', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 64, 64);
    const sampled = lut.sample(-1.0, 0);
    expect(sampled.r).toBeLessThanOrEqual(0.01);
    expect(sampled.g).toBeLessThanOrEqual(0.01);
    expect(sampled.b).toBeLessThanOrEqual(0.01);
  });

  it('高曲率在 N·L=0 处柔和化(非零,模拟散射绕过终止线)', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 64, 64);
    const flat = lut.sample(0.0, 0);
    const curved = lut.sample(0.0, 5.0);
    // 高曲率应使终止线附近变亮(散射绕过)
    expect(curved.r).toBeGreaterThanOrEqual(flat.r);
  });

  it('bilinear 采样连续(相邻坐标差异小)', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 64, 64);
    const a = lut.sample(0.5, 1.0);
    const b = lut.sample(0.501, 1.0);
    expect(Math.abs(a.r - b.r)).toBeLessThan(0.05);
    expect(Math.abs(a.g - b.g)).toBeLessThan(0.05);
    expect(Math.abs(a.b - b.b)).toBeLessThan(0.05);
  });

  it('N·L 钳制到 [-1, 1] 范围外不崩溃', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 32, 32);
    expect(() => lut.sample(5, -1)).not.toThrow();
    expect(() => lut.sample(-5, 1000)).not.toThrow();
    const sampled = lut.sample(5, 0);
    expect(sampled.r).toBeGreaterThanOrEqual(0);
  });

  it('toJSON 包含 width/height/profile/data', () => {
    const lut = new DiffuseLUT(SKIN_PROFILE, 16, 16);
    const json = lut.toJSON();
    expect(json.width).toBe(16);
    expect(json.height).toBe(16);
    expect(json.profile).toBeDefined();
    expect(Array.isArray(json.data)).toBe(true);
    expect((json.data as number[]).length).toBe(16 * 16 * 3);
  });
});

// ────────────────────────────────────────────────────────────────────
// TransmittanceLUT
// ────────────────────────────────────────────────────────────────────

describe('TransmittanceLUT — 透射率 1D LUT', () => {
  it('默认 256×3', () => {
    const lut = new TransmittanceLUT();
    expect(lut.size).toBe(256);
    expect(lut.data.length).toBe(256 * 3);
    expect(lut.data).toBeInstanceOf(Float32Array);
    expect(lut.maxDistance).toBe(5);
  });

  it('自定义 size 和 maxDistance 生效', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 128, 10);
    expect(lut.size).toBe(128);
    expect(lut.data.length).toBe(128 * 3);
    expect(lut.maxDistance).toBe(10);
  });

  it('distance=0 处透射率最高(接近 1)', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 64, 5);
    const sampled = lut.sample(0);
    // 主项 + red tail,应接近 singleScatterAlbedo + 0.3
    expect(sampled.r).toBeGreaterThan(0.9);
    expect(sampled.g).toBeGreaterThan(0.8);
    expect(sampled.b).toBeGreaterThan(0.7);
  });

  it('红光透射 > 绿光透射 > 蓝光透射(皮肤呈红色的物理原因)', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 64, 5);
    const mid = lut.sample(2.0); // 中等距离
    expect(mid.r).toBeGreaterThan(mid.g);
    expect(mid.g).toBeGreaterThan(mid.b);
  });

  it('透射率随距离单调递减', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 64, 5);
    const near = lut.sample(0.5);
    const mid = lut.sample(2.0);
    const far = lut.sample(4.0);
    expect(near.r).toBeGreaterThan(mid.r);
    expect(mid.r).toBeGreaterThan(far.r);
    expect(near.g).toBeGreaterThan(mid.g);
    expect(mid.g).toBeGreaterThan(far.g);
  });

  it('远距离处透射率趋于 0', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 64, 5);
    const far = lut.sample(5.0);
    expect(far.r).toBeLessThan(0.3);
    expect(far.g).toBeLessThan(0.1);
    expect(far.b).toBeLessThan(0.05);
  });

  it('线性采样连续', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 64, 5);
    const a = lut.sample(1.0);
    const b = lut.sample(1.01);
    expect(Math.abs(a.r - b.r)).toBeLessThan(0.05);
  });

  it('距离钳制到 [0, maxDistance] 不崩溃', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 32, 5);
    expect(() => lut.sample(-10)).not.toThrow();
    expect(() => lut.sample(1000)).not.toThrow();
    const sampled = lut.sample(1000);
    // 远超 maxDistance 时钳制到 maxDistance,值为很小的正数
    expect(sampled.r).toBeGreaterThanOrEqual(0);
  });

  it('toJSON 包含 size/maxDistance/profile/data', () => {
    const lut = new TransmittanceLUT(SKIN_PROFILE, 16, 5);
    const json = lut.toJSON();
    expect(json.size).toBe(16);
    expect(json.maxDistance).toBe(5);
    expect(json.profile).toBeDefined();
    expect(Array.isArray(json.data)).toBe(true);
    expect((json.data as number[]).length).toBe(16 * 3);
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — 构造与默认值
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — 构造与默认值', () => {
  it('默认构造', () => {
    const m = new PreIntegratedSkinMaterial();
    expect(m.type).toBe('PreIntegratedSkin');
    expect(m.isPreIntegratedSkinMaterial).toBe(true);
    expect(m.baseColor).toEqual({ r: 0.9, g: 0.7, b: 0.6 });
    expect(m.diffuseIntensity).toBeCloseTo(1, 5);
    expect(m.specularIntensity).toBeCloseTo(1, 5);
    expect(m.roughness).toBeCloseTo(0.4, 5);
    expect(m.metallic).toBe(0);
    expect(m.curvature).toBe(0);
    expect(m.curvatureScale).toBe(1);
    expect(m.translucency).toBeCloseTo(0.5, 5);
    expect(m.translucencyDistortion).toBeCloseTo(0.1, 5);
    expect(m.translucencyPower).toBe(4);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.doubleSided).toBe(false);
  });

  it('继承自 BasicMaterial', () => {
    expect(new PreIntegratedSkinMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new PreIntegratedSkinMaterial();
    const b = new PreIntegratedSkinMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('fromHex 便捷构造', () => {
    const m = PreIntegratedSkinMaterial.fromHex('#ff8800');
    expect(m.baseColor.r).toBeCloseTo(1.0, 2);
    expect(m.baseColor.g).toBeCloseTo(0x88 / 255, 2);
    expect(m.baseColor.b).toBeCloseTo(0, 2);
  });

  it('默认持有 DiffuseLUT 和 TransmittanceLUT', () => {
    const m = new PreIntegratedSkinMaterial();
    expect(m.diffuseLUT).toBeInstanceOf(DiffuseLUT);
    expect(m.transmittanceLUT).toBeInstanceOf(TransmittanceLUT);
  });

  it('profile 与 LUT 一致', () => {
    const m = new PreIntegratedSkinMaterial();
    expect(m.profile).toBe(SKIN_PROFILE);
    expect(m.diffuseLUT.profile).toBe(SKIN_PROFILE);
    expect(m.transmittanceLUT.profile).toBe(SKIN_PROFILE);
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — 选项覆盖
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — 选项覆盖', () => {
  it('所有选项生效', () => {
    const customProfile: DiffuseProfile = {
      scatteringRadius: { r: 0.5, g: 0.3, b: 0.2 },
      singleScatterAlbedo: { r: 0.95, g: 0.9, b: 0.8 },
      f0: 0.02,
    };
    const m = new PreIntegratedSkinMaterial({
      baseColor: { r: 0.8, g: 0.6, b: 0.4 },
      diffuseIntensity: 0.7,
      specularIntensity: 0.5,
      roughness: 0.3,
      metallic: 0.1,
      curvature: 2.0,
      curvatureScale: 1.5,
      translucency: 0.8,
      translucencyDistortion: 0.2,
      translucencyPower: 6,
      opacity: 0.7,
      transparent: true,
      doubleSided: true,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      profile: customProfile,
    });
    expect(m.baseColor).toEqual({ r: 0.8, g: 0.6, b: 0.4 });
    expect(m.diffuseIntensity).toBeCloseTo(0.7, 5);
    expect(m.specularIntensity).toBeCloseTo(0.5, 5);
    expect(m.roughness).toBeCloseTo(0.3, 5);
    expect(m.metallic).toBeCloseTo(0.1, 5);
    expect(m.curvature).toBeCloseTo(2.0, 5);
    expect(m.curvatureScale).toBeCloseTo(1.5, 5);
    expect(m.translucency).toBeCloseTo(0.8, 5);
    expect(m.translucencyDistortion).toBeCloseTo(0.2, 5);
    expect(m.translucencyPower).toBe(6);
    expect(m.opacity).toBeCloseTo(0.7, 5);
    expect(m.transparent).toBe(true);
    expect(m.doubleSided).toBe(true);
    expect(m.wireframe).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.profile).toBe(customProfile);
    expect(m.diffuseLUT.profile).toBe(customProfile);
  });

  it('roughness/metallic/translucency 等数值选项被 clamp01', () => {
    const m = new PreIntegratedSkinMaterial({
      roughness: 5,
      metallic: -1,
      translucency: 10,
      translucencyDistortion: -5,
    });
    expect(m.roughness).toBe(1);
    expect(m.metallic).toBe(0);
    expect(m.translucency).toBe(1);
    expect(m.translucencyDistortion).toBe(0);
  });

  it('curvature/curvatureScale 被钳制到 >= 0', () => {
    const m = new PreIntegratedSkinMaterial({
      curvature: -5,
      curvatureScale: -2,
    });
    expect(m.curvature).toBe(0);
    expect(m.curvatureScale).toBe(0);
  });

  it('translucencyPower 被钳制到 >= 1', () => {
    const m = new PreIntegratedSkinMaterial({ translucencyPower: 0.1 });
    expect(m.translucencyPower).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — setters
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — setters', () => {
  it('所有 setter 返回 this(链式)', () => {
    const m = new PreIntegratedSkinMaterial();
    expect(m.setBaseColor({ r: 0.1, g: 0.2, b: 0.3 })).toBe(m);
    expect(m.setDiffuseIntensity(0.5)).toBe(m);
    expect(m.setSpecularIntensity(0.5)).toBe(m);
    expect(m.setRoughness(0.6)).toBe(m);
    expect(m.setMetallic(0.1)).toBe(m);
    expect(m.setCurvature(3)).toBe(m);
    expect(m.setCurvatureScale(2)).toBe(m);
    expect(m.setTranslucency(0.3)).toBe(m);
    expect(m.setTranslucencyDistortion(0.2)).toBe(m);
    expect(m.setTranslucencyPower(8)).toBe(m);
  });

  it('setter 设置值正确', () => {
    const m = new PreIntegratedSkinMaterial();
    m.setBaseColor({ r: 0.1, g: 0.2, b: 0.3 })
      .setDiffuseIntensity(0.4)
      .setSpecularIntensity(0.6)
      .setRoughness(0.7)
      .setMetallic(0.2)
      .setCurvature(1.5)
      .setCurvatureScale(2.5)
      .setTranslucency(0.9)
      .setTranslucencyDistortion(0.4)
      .setTranslucencyPower(7);

    expect(m.baseColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(m.diffuseIntensity).toBeCloseTo(0.4, 5);
    expect(m.specularIntensity).toBeCloseTo(0.6, 5);
    expect(m.roughness).toBeCloseTo(0.7, 5);
    expect(m.metallic).toBeCloseTo(0.2, 5);
    expect(m.curvature).toBeCloseTo(1.5, 5);
    expect(m.curvatureScale).toBeCloseTo(2.5, 5);
    expect(m.translucency).toBeCloseTo(0.9, 5);
    expect(m.translucencyDistortion).toBeCloseTo(0.4, 5);
    expect(m.translucencyPower).toBe(7);
  });

  it('setter 应用 clamp01', () => {
    const m = new PreIntegratedSkinMaterial();
    m.setRoughness(5);
    expect(m.roughness).toBe(1);
    m.setMetallic(-1);
    expect(m.metallic).toBe(0);
    m.setTranslucency(10);
    expect(m.translucency).toBe(1);
  });

  it('setter curvature 钳制到 >= 0', () => {
    const m = new PreIntegratedSkinMaterial();
    m.setCurvature(-5);
    expect(m.curvature).toBe(0);
  });

  it('setter translucencyPower 钳制到 >= 1', () => {
    const m = new PreIntegratedSkinMaterial();
    m.setTranslucencyPower(0.5);
    expect(m.translucencyPower).toBe(1);
  });

  it('setProfile 替换 LUT 并更新 profile 引用', () => {
    const m = new PreIntegratedSkinMaterial();
    const originalLUT = m.diffuseLUT;
    const newProfile: DiffuseProfile = {
      scatteringRadius: { r: 0.5, g: 0.3, b: 0.2 },
      singleScatterAlbedo: { r: 0.95, g: 0.9, b: 0.8 },
      f0: 0.02,
    };
    m.setProfile(newProfile);
    expect(m.profile).toBe(newProfile);
    expect(m.diffuseLUT.profile).toBe(newProfile);
    expect(m.transmittanceLUT.profile).toBe(newProfile);
    expect(m.diffuseLUT).not.toBe(originalLUT);
  });

  it('shareLUTs 共享外部 LUT 实例', () => {
    const m1 = new PreIntegratedSkinMaterial();
    const m2 = new PreIntegratedSkinMaterial();
    m2.shareLUTs(m1.diffuseLUT, m1.transmittanceLUT);
    expect(m2.diffuseLUT).toBe(m1.diffuseLUT);
    expect(m2.transmittanceLUT).toBe(m1.transmittanceLUT);
    expect(m2.profile).toBe(m1.profile);
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — computeSSS CPU 参考
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — computeSSS CPU 参考', () => {
  it('返回 diffuse / specular / transmissive / total 四个分量', () => {
    const m = new PreIntegratedSkinMaterial();
    const result = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),  // 光从上方照射(指向下方表面)
      new Vector3(0, 1, 0),   // 视线从上方看下
      0,                      // 平面
    );
    expect(result.diffuse).toBeDefined();
    expect(result.specular).toBeDefined();
    expect(result.transmissive).toBeDefined();
    expect(result.total).toBeDefined();
    expect(result.total.r).toBeCloseTo(result.diffuse.r + result.specular.r + result.transmissive.r, 5);
  });

  it('正面光照(N·L=1)产生强漫反射', () => {
    const m = new PreIntegratedSkinMaterial();
    const result = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 1, 0),
      0,
    );
    expect(result.diffuse.r).toBeGreaterThan(0.5);
    expect(result.diffuse.g).toBeGreaterThan(0.3);
    expect(result.diffuse.b).toBeGreaterThan(0.2);
  });

  it('背面光照(N·L<0)漫反射趋于 0', () => {
    const m = new PreIntegratedSkinMaterial();
    const result = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 1, 0),  // 光从下方照射(指向上方表面),与法线同向 → N·L<0
      new Vector3(0, 1, 0),
      0,
    );
    expect(result.diffuse.r).toBeLessThan(0.1);
  });

  it('透射分量非负有限', () => {
    const m = new PreIntegratedSkinMaterial({ translucency: 0.8 });
    const result = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 1, 0),
      0,
      1.0,
    );
    expect(result.transmissive.r).toBeGreaterThanOrEqual(0);
    expect(result.transmissive.g).toBeGreaterThanOrEqual(0);
    expect(result.transmissive.b).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.transmissive.r)).toBe(true);
  });

  it('透射分量红光 >= 绿光 >= 蓝光(皮肤呈红色)', () => {
    const m = new PreIntegratedSkinMaterial({ translucency: 1.0 });
    // 设置视线与光线同向(从背面看),最大化透射
    const result = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),  // 光指向下方
      new Vector3(0, -1, 0),  // 视线指向下方(从表面背面看)
      0,
      2.0,  // 较厚距离
    );
    // 红光透射应不弱于绿光,绿光不弱于蓝光
    expect(result.transmissive.r).toBeGreaterThanOrEqual(result.transmissive.g - 1e-6);
    expect(result.transmissive.g).toBeGreaterThanOrEqual(result.transmissive.b - 1e-6);
  });

  it('translucency=0 时透射分量为 0', () => {
    const m = new PreIntegratedSkinMaterial({ translucency: 0 });
    const result = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 1, 0),
      0,
    );
    expect(result.transmissive.r).toBe(0);
    expect(result.transmissive.g).toBe(0);
    expect(result.transmissive.b).toBe(0);
  });

  it('不同曲率产生不同结果(LUT 采样生效)', () => {
    const m = new PreIntegratedSkinMaterial();
    const flat = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 1, 0),
      0,
    );
    const curved = m.computeSSS(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 1, 0),
      5.0,
    );
    // 曲率不同时 LUT 采样不同,结果应有差异
    const flatSum = flat.diffuse.r + flat.diffuse.g + flat.diffuse.b;
    const curvedSum = curved.diffuse.r + curved.diffuse.g + curved.diffuse.b;
    expect(Math.abs(flatSum - curvedSum)).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — shader 源码与 uniforms
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — shader 与 uniforms', () => {
  it('getVertexShader 返回非空 GLSL ES 3.0', () => {
    const m = new PreIntegratedSkinMaterial();
    const vs = m.getVertexShader();
    expect(vs).toBe(PRE_INTEGRATED_SKIN_VERT);
    expect(vs).toContain('#version 300 es');
    expect(vs).toContain('a_position');
    expect(vs).toContain('a_normal');
    expect(vs).toContain('a_curvature');
    expect(vs).toContain('v_worldNormal');
    expect(vs).toContain('v_curvature');
    expect(vs).toContain('u_curvatureScale');
  });

  it('getFragmentShader 返回非空 GLSL ES 3.0', () => {
    const m = new PreIntegratedSkinMaterial();
    const fs = m.getFragmentShader();
    expect(fs).toBe(PRE_INTEGRATED_SKIN_FRAG);
    expect(fs).toContain('#version 300 es');
    expect(fs).toContain('u_diffuseLUT');
    expect(fs).toContain('u_transmittanceLUT');
    expect(fs).toContain('texture(');
    expect(fs).toContain('D_GGX');
    expect(fs).toContain('fresnelSchlick');
    expect(fs).toContain('outColor');
  });

  it('getUniforms 包含所有必要 uniform', () => {
    const m = new PreIntegratedSkinMaterial({
      baseColor: { r: 0.5, g: 0.4, b: 0.3 },
      roughness: 0.5,
      metallic: 0.1,
      translucency: 0.7,
    });
    const u = m.getUniforms();
    expect(u.u_baseColor).toEqual([0.5, 0.4, 0.3]);
    expect(u.u_roughness).toBeCloseTo(0.5, 5);
    expect(u.u_metallic).toBeCloseTo(0.1, 5);
    expect(u.u_translucency).toBeCloseTo(0.7, 5);
    expect(u.u_curvatureScale).toBe(1);
    expect(u.u_falloffConstant).toBe(1);
    expect(u.u_opacity).toBe(1);
    expect(u.u_diffuseLUT).toBe(m.diffuseLUT);
    expect(u.u_transmittanceLUT).toBe(m.transmittanceLUT);
  });

  it('customProgramCacheKey 返回稳定字符串', () => {
    const m1 = new PreIntegratedSkinMaterial();
    const m2 = new PreIntegratedSkinMaterial();
    expect(m1.customProgramCacheKey()).toBe('pre-integrated-skin');
    expect(m1.customProgramCacheKey()).toBe(m2.customProgramCacheKey());
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — 序列化
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — 序列化', () => {
  it('toJSON 包含所有字段', () => {
    const m = new PreIntegratedSkinMaterial({
      baseColor: { r: 0.5, g: 0.4, b: 0.3 },
      roughness: 0.6,
      translucency: 0.8,
    });
    const json = m.toJSON();
    expect(json.type).toBe('PreIntegratedSkin');
    expect(json.baseColor).toEqual({ r: 0.5, g: 0.4, b: 0.3 });
    expect(json.roughness).toBeCloseTo(0.6, 5);
    expect(json.translucency).toBeCloseTo(0.8, 5);
    expect(json.profile).toBeDefined();
    expect(json.profile).toHaveProperty('scatteringRadius');
    expect(json.profile).toHaveProperty('singleScatterAlbedo');
    expect(json.profile).toHaveProperty('f0');
  });

  it('fromJSON 往返一致(不含 LUT 引用)', () => {
    const original = new PreIntegratedSkinMaterial({
      baseColor: { r: 0.3, g: 0.5, b: 0.7 },
      diffuseIntensity: 0.6,
      specularIntensity: 0.4,
      roughness: 0.5,
      metallic: 0.2,
      curvature: 1.5,
      curvatureScale: 2.0,
      translucency: 0.7,
      translucencyDistortion: 0.3,
      translucencyPower: 5,
      opacity: 0.9,
      transparent: true,
      doubleSided: true,
    });
    const json = original.toJSON();
    const restored = new PreIntegratedSkinMaterial().fromJSON(json);
    expect(restored.baseColor).toEqual(original.baseColor);
    expect(restored.diffuseIntensity).toBeCloseTo(original.diffuseIntensity, 5);
    expect(restored.specularIntensity).toBeCloseTo(original.specularIntensity, 5);
    expect(restored.roughness).toBeCloseTo(original.roughness, 5);
    expect(restored.metallic).toBeCloseTo(original.metallic, 5);
    expect(restored.curvature).toBeCloseTo(original.curvature, 5);
    expect(restored.curvatureScale).toBeCloseTo(original.curvatureScale, 5);
    expect(restored.translucency).toBeCloseTo(original.translucency, 5);
    expect(restored.translucencyDistortion).toBeCloseTo(original.translucencyDistortion, 5);
    expect(restored.translucencyPower).toBe(original.translucencyPower);
    expect(restored.opacity).toBeCloseTo(original.opacity, 5);
    expect(restored.transparent).toBe(original.transparent);
    expect(restored.doubleSided).toBe(original.doubleSided);
    // 构造 PreIntegratedSkinMaterial 会生成 256×256 DiffuseLUT,慢机器 + 全量并发可能超过默认 5s。
  }, 20000);

  it('fromJSON 含自定义 profile', () => {
    const customProfile: DiffuseProfile = {
      scatteringRadius: { r: 0.7, g: 0.4, b: 0.25 },
      singleScatterAlbedo: { r: 0.98, g: 0.95, b: 0.82 },
      f0: 0.03,
    };
    const original = new PreIntegratedSkinMaterial({ profile: customProfile });
    const json = original.toJSON();
    const restored = new PreIntegratedSkinMaterial().fromJSON(json);
    expect(restored.profile.scatteringRadius).toEqual(customProfile.scatteringRadius);
    expect(restored.profile.singleScatterAlbedo).toEqual(customProfile.singleScatterAlbedo);
    expect(restored.profile.f0).toBeCloseTo(customProfile.f0, 5);
  });

  it('fromJSON 容忍缺失字段(只更新存在的)', () => {
    const m = new PreIntegratedSkinMaterial();
    const before = m.roughness;
    m.fromJSON({ baseColor: { r: 0.1, g: 0.2, b: 0.3 } });
    expect(m.baseColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(m.roughness).toBe(before);
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — clone / copy
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — clone / copy', () => {
  it('clone 返回独立新实例', () => {
    const original = new PreIntegratedSkinMaterial({
      baseColor: { r: 0.3, g: 0.6, b: 0.9 },
      roughness: 0.5,
      translucency: 0.7,
    });
    const cloned = original.clone();
    expect(cloned).not.toBe(original);
    expect(cloned.baseColor).toEqual(original.baseColor);
    expect(cloned.roughness).toBe(original.roughness);
    expect(cloned.translucency).toBe(original.translucency);
    expect(cloned.uuid).not.toBe(original.uuid);
  });

  it('clone 后修改不影响原实例', () => {
    const original = new PreIntegratedSkinMaterial({
      baseColor: { r: 0.3, g: 0.6, b: 0.9 },
    });
    const cloned = original.clone();
    cloned.setBaseColor({ r: 0.1, g: 0.2, b: 0.3 });
    expect(original.baseColor).toEqual({ r: 0.3, g: 0.6, b: 0.9 });
    expect(cloned.baseColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });

  it('copy 复制所有可变字段', () => {
    const source = new PreIntegratedSkinMaterial({
      baseColor: { r: 0.1, g: 0.2, b: 0.3 },
      roughness: 0.7,
      metallic: 0.2,
      translucency: 0.6,
      curvature: 2.0,
    });
    const target = new PreIntegratedSkinMaterial();
    target.copy(source);
    expect(target.baseColor).toEqual(source.baseColor);
    expect(target.roughness).toBe(source.roughness);
    expect(target.metallic).toBe(source.metallic);
    expect(target.translucency).toBe(source.translucency);
    expect(target.curvature).toBe(source.curvature);
  });

  it('copy 共享 LUT 引用(节省内存)', () => {
    const source = new PreIntegratedSkinMaterial();
    const target = new PreIntegratedSkinMaterial();
    target.copy(source);
    expect(target.diffuseLUT).toBe(source.diffuseLUT);
    expect(target.transmittanceLUT).toBe(source.transmittanceLUT);
    expect(target.profile).toBe(source.profile);
  });
});

// ────────────────────────────────────────────────────────────────────
// PreIntegratedSkinMaterial — dispose
// ────────────────────────────────────────────────────────────────────

describe('PreIntegratedSkinMaterial — dispose', () => {
  it('dispose 可重复调用不抛错', () => {
    const m = new PreIntegratedSkinMaterial();
    expect(() => m.dispose()).not.toThrow();
    expect(() => m.dispose()).not.toThrow();
    expect(() => m.dispose()).not.toThrow();
  });
});
