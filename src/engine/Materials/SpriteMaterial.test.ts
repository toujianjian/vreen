// SpriteMaterial 单元测试。

import { describe, it, expect } from 'vitest';
import { SpriteMaterial } from './SpriteMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';

describe('SpriteMaterial', () => {
  it('constructs with sensible defaults', () => {
    const m = new SpriteMaterial();
    expect(m.type).toBe('SpriteMaterial');
    expect(m.isSpriteMaterial).toBe(true);
    expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.map).toBeNull();
    expect(m.opacity).toBe(1);
    expect(m.rotation).toBe(0);
    expect(m.transparent).toBe(true);
    expect(m.sizeAttenuation).toBe(true);
    expect(m.wireframe).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
  });

  it('extends BasicMaterial', () => {
    expect(new SpriteMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('assigns unique uuids', () => {
    const a = new SpriteMaterial();
    const b = new SpriteMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('applies option overrides', () => {
    const m = new SpriteMaterial({
      color: { r: 1, g: 0, b: 0 },
      opacity: 0.5,
      rotation: Math.PI / 4,
      transparent: false,
      sizeAttenuation: false,
      wireframe: true,
      depthWrite: false,
      renderOrder: 5,
    });
    expect(m.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(m.opacity).toBe(0.5);
    expect(m.rotation).toBeCloseTo(Math.PI / 4, 6);
    expect(m.transparent).toBe(false);
    expect(m.sizeAttenuation).toBe(false);
    expect(m.wireframe).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.renderOrder).toBe(5);
  });

  it('does not share color object between instances', () => {
    const a = new SpriteMaterial();
    const b = new SpriteMaterial();
    a.color.r = 0;
    expect(b.color.r).toBe(1);
  });

  it('fromHex parses #rrggbb and #rgb', () => {
    const red = SpriteMaterial.fromHex('#ff0000');
    expect(red.color.r).toBeCloseTo(1, 6);
    expect(red.color.g).toBeCloseTo(0, 6);
    expect(red.color.b).toBeCloseTo(0, 6);

    const short = SpriteMaterial.fromHex('#0f0');
    expect(short.color.g).toBeCloseTo(1, 6);
    expect(short.color.r).toBeCloseTo(0, 6);
  });

  it('onBeforeCompile is a no-op by default and customProgramCacheKey returns string', () => {
    const m = new SpriteMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(shader.vertexShader).toBe('a');
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('copy duplicates fields and is independent', () => {
    const src = new SpriteMaterial({
      color: { r: 0.1, g: 0.2, b: 0.3 },
      opacity: 0.7,
      rotation: 1.5,
      transparent: false,
      sizeAttenuation: false,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      renderOrder: 3,
    });
    src.userData = { tag: 'src' };

    const dst = new SpriteMaterial();
    dst.copy(src);

    expect(dst.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(dst.opacity).toBe(0.7);
    expect(dst.rotation).toBeCloseTo(1.5, 6);
    expect(dst.transparent).toBe(false);
    expect(dst.sizeAttenuation).toBe(false);
    expect(dst.wireframe).toBe(true);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(false);
    expect(dst.renderOrder).toBe(3);
    expect(dst.userData).toEqual({ tag: 'src' });

    // 修改 dst 不影响 src
    dst.color.r = 1;
    expect(src.color.r).toBeCloseTo(0.1, 6);
    dst.userData.tag = 'dst';
    expect(src.userData.tag).toBe('src');
  });

  it('clone produces an equal but independent instance', () => {
    const src = new SpriteMaterial({
      color: { r: 0.5, g: 0.5, b: 0.5 },
      rotation: 0.3,
      sizeAttenuation: false,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(SpriteMaterial);
    expect(cl).not.toBe(src);
    expect(cl.color).toEqual(src.color);
    expect(cl.rotation).toBeCloseTo(src.rotation, 6);
    expect(cl.sizeAttenuation).toBe(src.sizeAttenuation);
    // 修改 clone 不影响 src
    cl.rotation = 9;
    expect(src.rotation).toBeCloseTo(0.3, 6);
  });

  it('clone assigns a fresh uuid', () => {
    const src = new SpriteMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });
});
