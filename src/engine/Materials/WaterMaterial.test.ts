// WaterMaterial 单元测试。
//
// 覆盖:构造默认值、选项覆盖、clone/copy 独立性、shader 源码非空、继承关系。

import { describe, it, expect } from 'vitest';
import { WaterMaterial, WATER_VERT, WATER_FRAG } from './WaterMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';

describe('WaterMaterial', () => {
  it('默认构造:蓝色水色、透明、不写深度', () => {
    const m = new WaterMaterial();
    expect(m.type).toBe('Water');
    expect(m.isWaterMaterial).toBe(true);
    expect(m.waterColor).toEqual({ r: 0.1, g: 0.3, b: 0.5 });
    expect(m.normalMap).toBeNull();
    expect(m.reflectionMap).toBeNull();
    expect(m.waveScale).toBeCloseTo(0.5, 6);
    expect(m.waveSpeed).toEqual({ x: 0.03, y: 0.04 });
    expect(m.sunDirection).toEqual({ x: 0.5, y: -1, z: 0.3 });
    expect(m.sunColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.fresnelScale).toBe(1);
    expect(m.opacity).toBeCloseTo(0.9, 6);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  it('继承自 BasicMaterial', () => {
    expect(new WaterMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new WaterMaterial();
    const b = new WaterMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('选项覆盖生效', () => {
    const m = new WaterMaterial({
      waterColor: { r: 0.2, g: 0.5, b: 0.7 },
      waveScale: 0.8,
      waveSpeed: { x: 0.05, y: 0.06 },
      sunDirection: { x: 0, y: -1, z: 0 },
      sunColor: { r: 1, g: 0.9, b: 0.8 },
      fresnelScale: 0.5,
      opacity: 0.5,
      transparent: false,
      depthTest: false,
      depthWrite: true,
    });
    expect(m.waterColor).toEqual({ r: 0.2, g: 0.5, b: 0.7 });
    expect(m.waveScale).toBeCloseTo(0.8, 6);
    expect(m.waveSpeed).toEqual({ x: 0.05, y: 0.06 });
    expect(m.sunDirection).toEqual({ x: 0, y: -1, z: 0 });
    expect(m.sunColor).toEqual({ r: 1, g: 0.9, b: 0.8 });
    expect(m.fresnelScale).toBeCloseTo(0.5, 6);
    expect(m.opacity).toBeCloseTo(0.5, 6);
    expect(m.transparent).toBe(false);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(true);
  });

  it('waterColor / waveSpeed / sunDirection 对象不跨实例共享', () => {
    const a = new WaterMaterial();
    const b = new WaterMaterial();
    a.waterColor.r = 0.99;
    a.waveSpeed.x = 0.99;
    a.sunDirection.y = 0.99;
    expect(b.waterColor.r).toBeCloseTo(0.1, 6);
    expect(b.waveSpeed.x).toBeCloseTo(0.03, 6);
    expect(b.sunDirection.y).toBe(-1);
  });

  it('shader 源码非空且以 #version 300 es 开头', () => {
    expect(typeof WATER_VERT).toBe('string');
    expect(typeof WATER_FRAG).toBe('string');
    expect(WATER_VERT.startsWith('#version 300 es')).toBe(true);
    expect(WATER_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('fragment shader 包含菲涅尔 + 高光 + 法线扰动', () => {
    expect(WATER_FRAG).toContain('fresnel');
    expect(WATER_FRAG).toContain('u_normalMap');
    expect(WATER_FRAG).toContain('u_reflectionMap');
    expect(WATER_FRAG).toContain('u_waveScale');
    expect(WATER_FRAG).toContain('u_waveSpeed');
    expect(WATER_FRAG).toContain('u_sunDirection');
    expect(WATER_FRAG).toContain('u_sunColor');
    expect(WATER_FRAG).toContain('u_fresnelScale');
  });

  it('onBeforeCompile 默认 no-op 且 customProgramCacheKey 返回字符串', () => {
    const m = new WaterMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('copy 复制所有字段且独立', () => {
    const src = new WaterMaterial({
      waterColor: { r: 0.2, g: 0.4, b: 0.6 },
      waveScale: 0.7,
      waveSpeed: { x: 0.05, y: 0.06 },
      sunDirection: { x: 0.1, y: -0.9, z: 0.2 },
      sunColor: { r: 1, g: 0.9, b: 0.8 },
      fresnelScale: 0.6,
      opacity: 0.5,
      transparent: false,
      depthTest: false,
      depthWrite: true,
    });
    src.userData = { tag: 'src' };

    const dst = new WaterMaterial();
    dst.copy(src);

    expect(dst.waterColor).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(dst.waveScale).toBeCloseTo(0.7, 6);
    expect(dst.waveSpeed).toEqual({ x: 0.05, y: 0.06 });
    expect(dst.sunDirection).toEqual({ x: 0.1, y: -0.9, z: 0.2 });
    expect(dst.sunColor).toEqual({ r: 1, g: 0.9, b: 0.8 });
    expect(dst.fresnelScale).toBeCloseTo(0.6, 6);
    expect(dst.opacity).toBeCloseTo(0.5, 6);
    expect(dst.transparent).toBe(false);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(true);
    expect(dst.userData).toEqual({ tag: 'src' });

    // 修改 dst 不影响 src
    dst.waterColor.r = 1;
    expect(src.waterColor.r).toBeCloseTo(0.2, 6);
    dst.waveSpeed.x = 0.99;
    expect(src.waveSpeed.x).toBeCloseTo(0.05, 6);
  });

  it('clone 产生等价但独立的新实例', () => {
    const src = new WaterMaterial({
      waterColor: { r: 0.5, g: 0.5, b: 0.5 },
      waveScale: 0.6,
      fresnelScale: 0.8,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(WaterMaterial);
    expect(cl).not.toBe(src);
    expect(cl.waterColor).toEqual(src.waterColor);
    expect(cl.waveScale).toBeCloseTo(src.waveScale, 6);
    expect(cl.fresnelScale).toBeCloseTo(src.fresnelScale, 6);
    // 修改 clone 不影响 src
    cl.fresnelScale = 0.1;
    expect(src.fresnelScale).toBeCloseTo(0.8, 6);
  });

  it('clone 分配新 uuid', () => {
    const src = new WaterMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });
});
