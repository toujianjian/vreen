// MatcapMaterial 单元测试。
//
// 覆盖:构造默认值、选项覆盖、clone/copy 独立性、shader 源码非空、继承关系、纹理引用共享语义。
// 不依赖 WebGL 上下文(纯数据类测试)。

import { describe, it, expect } from 'vitest';
import { MatcapMaterial, MATCAP_VERT, MATCAP_FRAG } from './MatcapMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';
import { Texture } from '../Core/Texture';

describe('MatcapMaterial', () => {
  it('默认构造:白颜色、matcap/normalMap 为 null、normalScale 1、不透明', () => {
    const m = new MatcapMaterial();
    expect(m.type).toBe('Matcap');
    expect(m.isMatcapMaterial).toBe(true);
    expect(m.matcap).toBeNull();
    expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.normalMap).toBeNull();
    expect(m.normalScale).toBe(1);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
  });

  it('继承自 BasicMaterial', () => {
    expect(new MatcapMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new MatcapMaterial();
    const b = new MatcapMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('选项覆盖生效', () => {
    const matcapTex = new Texture();
    const normalTex = new Texture();
    const m = new MatcapMaterial({
      matcap: matcapTex,
      color: { r: 0.8, g: 0.6, b: 0.4 },
      normalMap: normalTex,
      normalScale: 0.5,
      opacity: 0.7,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      wireframe: true,
    });
    expect(m.matcap).toBe(matcapTex);
    expect(m.color).toEqual({ r: 0.8, g: 0.6, b: 0.4 });
    expect(m.normalMap).toBe(normalTex);
    expect(m.normalScale).toBeCloseTo(0.5, 6);
    expect(m.opacity).toBeCloseTo(0.7, 6);
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.wireframe).toBe(true);
  });

  it('color 对象不跨实例共享', () => {
    const a = new MatcapMaterial();
    const b = new MatcapMaterial();
    a.color.r = 0.5;
    expect(b.color.r).toBe(1);
  });

  it('matcap/normalMap 纹理引用按值共享(copy 后指向同一 Texture)', () => {
    const matcapTex = new Texture();
    const normalTex = new Texture();
    const src = new MatcapMaterial({ matcap: matcapTex, normalMap: normalTex });
    const dst = new MatcapMaterial().copy(src);
    // 纹理资源是共享引用(与 three.js 语义一致,clone 不深拷纹理)
    expect(dst.matcap).toBe(matcapTex);
    expect(dst.normalMap).toBe(normalTex);
  });

  it('shader 源码非空且以 #version 300 es 开头', () => {
    expect(typeof MATCAP_VERT).toBe('string');
    expect(typeof MATCAP_FRAG).toBe('string');
    expect(MATCAP_VERT.startsWith('#version 300 es')).toBe(true);
    expect(MATCAP_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('vertex shader 输出 view-space 法线', () => {
    expect(MATCAP_VERT).toContain('v_viewNormal');
    expect(MATCAP_VERT).toContain('u_normalMatrix');
    expect(MATCAP_VERT).toContain('u_viewMatrix');
  });

  it('fragment shader 包含 matcap 采样 + 法线贴图扰动', () => {
    expect(MATCAP_FRAG).toContain('u_matcap');
    expect(MATCAP_FRAG).toContain('u_matcapEnabled');
    expect(MATCAP_FRAG).toContain('u_normalMap');
    expect(MATCAP_FRAG).toContain('u_normalMapEnabled');
    expect(MATCAP_FRAG).toContain('u_normalScale');
    expect(MATCAP_FRAG).toContain('u_color');
    expect(MATCAP_FRAG).toContain('u_opacity');
  });

  it('onBeforeCompile 默认 no-op 且 customProgramCacheKey 返回字符串', () => {
    const m = new MatcapMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('copy 复制所有字段且独立(纹理引用共享,标量与颜色独立)', () => {
    const matcapTex = new Texture();
    const normalTex = new Texture();
    const src = new MatcapMaterial({
      matcap: matcapTex,
      color: { r: 0.2, g: 0.4, b: 0.6 },
      normalMap: normalTex,
      normalScale: 0.8,
      opacity: 0.5,
      transparent: true,
      depthTest: false,
      depthWrite: true,
      wireframe: true,
    });
    src.userData = { tag: 'src' };

    const dst = new MatcapMaterial();
    dst.copy(src);

    expect(dst.matcap).toBe(matcapTex);
    expect(dst.color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(dst.normalMap).toBe(normalTex);
    expect(dst.normalScale).toBeCloseTo(0.8, 6);
    expect(dst.opacity).toBeCloseTo(0.5, 6);
    expect(dst.transparent).toBe(true);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(true);
    expect(dst.wireframe).toBe(true);
    expect(dst.userData).toEqual({ tag: 'src' });

    // 修改 dst 标量/颜色不影响 src
    dst.color.r = 1;
    expect(src.color.r).toBeCloseTo(0.2, 6);
    dst.normalScale = 0.1;
    expect(src.normalScale).toBeCloseTo(0.8, 6);
  });

  it('clone 产生等价但独立的新实例', () => {
    const matcapTex = new Texture();
    const src = new MatcapMaterial({
      matcap: matcapTex,
      color: { r: 0.5, g: 0.5, b: 0.5 },
      normalScale: 0.6,
      opacity: 0.7,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(MatcapMaterial);
    expect(cl).not.toBe(src);
    expect(cl.matcap).toBe(matcapTex); // 纹理引用共享
    expect(cl.color).toEqual(src.color);
    expect(cl.normalScale).toBeCloseTo(src.normalScale, 6);
    expect(cl.opacity).toBeCloseTo(src.opacity, 6);
    // 修改 clone 不影响 src
    cl.normalScale = 0.1;
    expect(src.normalScale).toBeCloseTo(0.6, 6);
  });

  it('clone 分配新 uuid', () => {
    const src = new MatcapMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });
});
