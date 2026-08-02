// FurMaterial 单元测试。
//
// 覆盖:构造默认值、选项覆盖、clone/copy 独立性、shader 源码非空、继承关系。
// 不依赖 WebGL 上下文(纯数据类测试)。

import { describe, it, expect } from 'vitest';
import { FurMaterial, FUR_VERT, FUR_FRAG } from './FurMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';
import { Color } from '../Math/Color';
import { Vector3 } from '../Math/Vector3';

describe('FurMaterial', () => {
  it('默认构造:浅棕毛色、length 0.1、density 0.5、occlusion 0.5', () => {
    const m = new FurMaterial();
    expect(m.type).toBe('Fur');
    expect(m.isFurMaterial).toBe(true);
    expect(m.furLength).toBeCloseTo(0.1, 6);
    expect(m.furDensity).toBeCloseTo(0.5, 6);
    expect(m.furOcclusion).toBeCloseTo(0.5, 6);
    expect(m.furColor).toEqual({ r: 0.6, g: 0.45, b: 0.3 });
    expect(m.gravity).toEqual({ x: 0, y: -1, z: 0 });
    expect(m.wind).toEqual({ x: 0, y: 0, z: 0 });
    expect(m.noiseTexture).toBeNull();
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(true);
    expect(m.doubleSided).toBe(true);
    expect(m.shellLayer).toBe(0);
    expect(m.time).toBe(0);
  });

  it('继承自 BasicMaterial', () => {
    expect(new FurMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new FurMaterial();
    const b = new FurMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('选项覆盖生效', () => {
    const m = new FurMaterial({
      furLength: 0.3,
      furDensity: 0.7,
      furColor: new Color(0.8, 0.6, 0.4),
      furOcclusion: 0.8,
      gravity: new Vector3(0, -2, 0),
      wind: new Vector3(1, 0, 0),
      opacity: 0.5,
      transparent: false,
      doubleSided: false,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
    });
    expect(m.furLength).toBeCloseTo(0.3, 6);
    expect(m.furDensity).toBeCloseTo(0.7, 6);
    expect(m.furColor).toEqual({ r: 0.8, g: 0.6, b: 0.4 });
    expect(m.furOcclusion).toBeCloseTo(0.8, 6);
    expect(m.gravity).toEqual({ x: 0, y: -2, z: 0 });
    expect(m.wind).toEqual({ x: 1, y: 0, z: 0 });
    expect(m.opacity).toBeCloseTo(0.5, 6);
    expect(m.transparent).toBe(false);
    expect(m.doubleSided).toBe(false);
    expect(m.wireframe).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
  });

  it('furColor 对象不跨实例共享', () => {
    const a = new FurMaterial();
    const b = new FurMaterial();
    a.furColor.r = 0.1;
    expect(b.furColor.r).toBeCloseTo(0.6, 6);
  });

  it('gravity / wind Vector3 不跨实例共享', () => {
    const a = new FurMaterial();
    const b = new FurMaterial();
    a.gravity.y = -5;
    a.wind.x = 3;
    expect(b.gravity.y).toBe(-1);
    expect(b.wind.x).toBe(0);
  });

  it('shader 源码非空且以 #version 300 es 开头', () => {
    expect(typeof FUR_VERT).toBe('string');
    expect(typeof FUR_FRAG).toBe('string');
    expect(FUR_VERT.startsWith('#version 300 es')).toBe(true);
    expect(FUR_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('vertex shader 包含 shell/gravity/wind/time 逻辑', () => {
    expect(FUR_VERT).toContain('u_shellLayer');
    expect(FUR_VERT).toContain('u_furLength');
    expect(FUR_VERT).toContain('u_gravity');
    expect(FUR_VERT).toContain('u_wind');
    expect(FUR_VERT).toContain('u_time');
  });

  it('fragment shader 包含密度/颜色/遮蔽/discard 逻辑', () => {
    expect(FUR_FRAG).toContain('u_furDensity');
    expect(FUR_FRAG).toContain('u_furColor');
    expect(FUR_FRAG).toContain('u_furOcclusion');
    expect(FUR_FRAG).toContain('discard');
    expect(FUR_FRAG).toContain('hash');
  });

  it('onBeforeCompile 默认 no-op 且 customProgramCacheKey 返回字符串', () => {
    const m = new FurMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('customProgramCacheKey 返回 "fur"', () => {
    const m = new FurMaterial();
    expect(m.customProgramCacheKey()).toBe('fur');
  });

  it('copy 复制所有字段且独立', () => {
    const src = new FurMaterial({
      furLength: 0.25,
      furDensity: 0.8,
      furColor: new Color(0.2, 0.4, 0.6),
      furOcclusion: 0.7,
      gravity: new Vector3(0, -3, 0),
      wind: new Vector3(2, 0, 1),
      opacity: 0.6,
      transparent: false,
      doubleSided: false,
      depthTest: false,
      depthWrite: false,
    });
    src.userData = { tag: 'src' };

    const dst = new FurMaterial();
    dst.copy(src);

    expect(dst.furLength).toBeCloseTo(0.25, 6);
    expect(dst.furDensity).toBeCloseTo(0.8, 6);
    expect(dst.furColor).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(dst.furOcclusion).toBeCloseTo(0.7, 6);
    expect(dst.gravity).toEqual({ x: 0, y: -3, z: 0 });
    expect(dst.wind).toEqual({ x: 2, y: 0, z: 1 });
    expect(dst.opacity).toBeCloseTo(0.6, 6);
    expect(dst.transparent).toBe(false);
    expect(dst.doubleSided).toBe(false);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(false);
    expect(dst.userData).toEqual({ tag: 'src' });

    // 修改 dst 不影响 src
    dst.furColor.r = 1;
    expect(src.furColor.r).toBeCloseTo(0.2, 6);
    dst.furLength = 0.99;
    expect(src.furLength).toBeCloseTo(0.25, 6);
    dst.gravity.y = -10;
    expect(src.gravity.y).toBe(-3);
  });

  it('clone 产生等价但独立的新实例', () => {
    const src = new FurMaterial({
      furLength: 0.2,
      furColor: new Color(0.5, 0.5, 0.5),
      furDensity: 0.6,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(FurMaterial);
    expect(cl).not.toBe(src);
    expect(cl.furColor).toEqual(src.furColor);
    expect(cl.furDensity).toBeCloseTo(src.furDensity, 6);
    expect(cl.furLength).toBeCloseTo(src.furLength, 6);
    // 修改 clone 不影响 src
    cl.furDensity = 0.9;
    expect(src.furDensity).toBeCloseTo(0.6, 6);
  });

  it('clone 分配新 uuid', () => {
    const src = new FurMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });

  it('fromHex 便捷构造', () => {
    const m = FurMaterial.fromHex('#ff8800');
    // #ff8800 → r=1.0, g=0.533, b=0
    expect(m.furColor.r).toBeCloseTo(1.0, 2);
    expect(m.furColor.g).toBeCloseTo(0x88 / 255, 2);
    expect(m.furColor.b).toBeCloseTo(0, 2);
  });

  it('programKey 默认 "fur"', () => {
    const m = new FurMaterial();
    expect(m.programKey).toBe('fur');
    expect(m.program).toBeNull();
  });

  // ── Kajiya-Kay 各向异性毛发着色 ──

  it('Kajiya-Kay 默认值:lightDir 归一化、specPower=64、shift=0.1', () => {
    const m = new FurMaterial();
    expect(m.lightDirection.length()).toBeCloseTo(1, 5);
    expect(m.specularPower).toBe(64);
    expect(m.secondarySpecularPower).toBe(16);
    expect(m.specularShift).toBeCloseTo(0.1, 6);
    expect(m.rootColor).toBeNull();
    expect(m.tipColor).toBeNull();
    expect(m.lightColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.specularColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.secondarySpecularColor).toEqual({ r: 0.8, g: 0.7, b: 0.5 });
  });

  it('Kajiya-Kay 选项覆盖生效', () => {
    const m = new FurMaterial({
      lightDirection: new Vector3(0, 1, 0),
      lightColor: new Color(1, 0.9, 0.8),
      rootColor: new Color(0.2, 0.1, 0.05),
      tipColor: new Color(0.9, 0.8, 0.6),
      specularColor: new Color(0.9, 0.9, 1.0),
      specularPower: 128,
      secondarySpecularColor: new Color(0.5, 0.4, 0.3),
      secondarySpecularPower: 8,
      specularShift: 0.2,
    });
    expect(m.lightDirection).toEqual({ x: 0, y: 1, z: 0 });
    expect(m.lightColor).toEqual({ r: 1, g: 0.9, b: 0.8 });
    expect(m.rootColor).toEqual({ r: 0.2, g: 0.1, b: 0.05 });
    expect(m.tipColor).toEqual({ r: 0.9, g: 0.8, b: 0.6 });
    expect(m.specularPower).toBe(128);
    expect(m.secondarySpecularPower).toBe(8);
    expect(m.specularShift).toBeCloseTo(0.2, 6);
  });

  it('lightDirection 被归一化', () => {
    const m = new FurMaterial({ lightDirection: new Vector3(3, 0, 0) });
    expect(m.lightDirection.x).toBeCloseTo(1, 5);
    expect(m.lightDirection.length()).toBeCloseTo(1, 5);
  });

  it('Kajiya-Kay Color/Vector3 不跨实例共享', () => {
    const a = new FurMaterial();
    const b = new FurMaterial();
    a.specularColor.r = 0;
    a.secondarySpecularColor.g = 0;
    a.lightColor.b = 0;
    a.lightDirection.x = 0;
    expect(b.specularColor.r).toBe(1);
    expect(b.secondarySpecularColor.g).toBeCloseTo(0.7, 5);
    expect(b.lightColor.b).toBe(1);
    expect(b.lightDirection.x).toBeCloseTo(0.577, 2);
  });

  it('fragment shader 包含 Kajiya-Kay 各向异性着色逻辑', () => {
    expect(FUR_FRAG).toContain('u_lightDir');
    expect(FUR_FRAG).toContain('u_lightColor');
    expect(FUR_FRAG).toContain('u_cameraPos');
    expect(FUR_FRAG).toContain('u_rootColor');
    expect(FUR_FRAG).toContain('u_tipColor');
    expect(FUR_FRAG).toContain('u_specularColor');
    expect(FUR_FRAG).toContain('u_specularPower');
    expect(FUR_FRAG).toContain('u_secondarySpecularColor');
    expect(FUR_FRAG).toContain('u_secondarySpecularPower');
    expect(FUR_FRAG).toContain('u_specularShift');
    expect(FUR_FRAG).toContain('Kajiya');
    expect(FUR_FRAG).toContain('sinTL');   // diffuse
    expect(FUR_FRAG).toContain('sinTH');   // specular
    expect(FUR_FRAG).toContain('tipAlpha'); // tip fade
  });

  it('vertex shader 传递 worldPos', () => {
    expect(FUR_VERT).toContain('v_worldPos');
  });

  it('copy 复制 Kajiya-Kay 字段且独立', () => {
    const src = new FurMaterial({
      lightDirection: new Vector3(0, 0, 1),
      lightColor: new Color(0.5, 0.5, 0.5),
      rootColor: new Color(0.1, 0.1, 0.1),
      tipColor: new Color(0.9, 0.9, 0.9),
      specularColor: new Color(0.3, 0.3, 0.3),
      specularPower: 96,
      secondarySpecularColor: new Color(0.2, 0.2, 0.2),
      secondarySpecularPower: 12,
      specularShift: 0.15,
    });
    const dst = new FurMaterial();
    dst.copy(src);

    expect(dst.lightDirection).toEqual({ x: 0, y: 0, z: 1 });
    expect(dst.lightColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(dst.rootColor).toEqual({ r: 0.1, g: 0.1, b: 0.1 });
    expect(dst.tipColor).toEqual({ r: 0.9, g: 0.9, b: 0.9 });
    expect(dst.specularPower).toBe(96);
    expect(dst.secondarySpecularPower).toBe(12);
    expect(dst.specularShift).toBeCloseTo(0.15, 6);

    // 修改 dst 不影响 src
    dst.specularPower = 32;
    expect(src.specularPower).toBe(96);
    dst.rootColor!.r = 1;
    expect(src.rootColor!.r).toBeCloseTo(0.1, 5);
  });

  it('clone 复制 Kajiya-Kay 字段', () => {
    const src = new FurMaterial({
      specularPower: 80,
      specularShift: 0.2,
      rootColor: new Color(0.3, 0.2, 0.1),
    });
    const cl = src.clone();
    expect(cl.specularPower).toBe(80);
    expect(cl.specularShift).toBeCloseTo(0.2, 6);
    expect(cl.rootColor).toEqual({ r: 0.3, g: 0.2, b: 0.1 });
    // 修改 clone 不影响 src
    cl.specularPower = 10;
    expect(src.specularPower).toBe(80);
  });
});
