// PhongMaterial 单元测试。

import { describe, it, expect } from 'vitest';
import { PhongMaterial } from './MeshPhongMaterial';
import { BasicMaterial } from '../Core/Material';

describe('PhongMaterial', () => {
  it('constructs with three.js-style defaults', () => {
    const m = new PhongMaterial();
    expect(m.type).toBe('Phong');
    expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
    // specular 默认 0x111111 = 17/255
    expect(m.specular.r).toBeCloseTo(17 / 255, 6);
    expect(m.specular.g).toBeCloseTo(17 / 255, 6);
    expect(m.specular.b).toBeCloseTo(17 / 255, 6);
    expect(m.shininess).toBe(30);
    expect(m.emissive).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.emissiveIntensity).toBe(1);
    expect(m.map).toBeNull();
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.flatShading).toBe(false);
  });

  it('extends BasicMaterial', () => {
    expect(new PhongMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('assigns unique uuids', () => {
    expect(new PhongMaterial().uuid).not.toBe(new PhongMaterial().uuid);
  });

  it('applies option overrides', () => {
    const m = new PhongMaterial({
      color: { r: 0.2, g: 0.2, b: 0.2 },
      specular: { r: 1, g: 1, b: 1 },
      shininess: 64,
      emissive: { r: 0.1, g: 0, b: 0 },
      emissiveIntensity: 2,
      transparent: true,
      opacity: 0.7,
      flatShading: true,
    });
    expect(m.color).toEqual({ r: 0.2, g: 0.2, b: 0.2 });
    expect(m.specular).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.shininess).toBe(64);
    expect(m.emissive).toEqual({ r: 0.1, g: 0, b: 0 });
    expect(m.emissiveIntensity).toBe(2);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(0.7);
    expect(m.flatShading).toBe(true);
  });

  it('does not share color objects between instances', () => {
    const a = new PhongMaterial();
    const b = new PhongMaterial();
    a.specular.r = 1;
    a.emissive.g = 0.5;
    expect(b.specular.r).toBeCloseTo(17 / 255, 6);
    expect(b.emissive.g).toBe(0);
  });

  it('fromHex sets color', () => {
    const m = PhongMaterial.fromHex('#00ff00');
    expect(m.color.g).toBeCloseTo(1, 6);
    expect(m.color.r).toBeCloseTo(0, 6);
  });

  it('inherits onBeforeCompile no-op from BasicMaterial', () => {
    const m = new PhongMaterial();
    expect(typeof m.customProgramCacheKey()).toBe('string');
    expect(() => m.onBeforeCompile({ vertexShader: '', fragmentShader: '' })).not.toThrow();
  });
});
