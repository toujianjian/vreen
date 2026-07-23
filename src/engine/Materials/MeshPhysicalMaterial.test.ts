// PhysicalMaterial 单元测试。

import { describe, it, expect } from 'vitest';
import { PhysicalMaterial } from './MeshPhysicalMaterial';
import { StandardMaterial } from './StandardMaterial';
import type { ShaderObject } from '../Core/Material';

describe('PhysicalMaterial', () => {
  it('constructs with three.js-style defaults', () => {
    const m = new PhysicalMaterial();
    expect(m.type).toBe('Physical');
    expect(m.programKey).toBe('physical');
    // 物理属性默认值
    expect(m.clearcoat).toBe(0);
    expect(m.clearcoatRoughness).toBe(0);
    expect(m.sheen).toBe(0);
    expect(m.sheenColor).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.sheenRoughness).toBe(1);
    expect(m.transmission).toBe(0);
    expect(m.thickness).toBe(0);
    expect(m.ior).toBe(1.5);
    expect(m.attenuationColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.attenuationDistance).toBe(Infinity);
    expect(m.specularIntensity).toBe(1);
    expect(m.specularColor).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('extends StandardMaterial', () => {
    const m = new PhysicalMaterial();
    expect(m).toBeInstanceOf(StandardMaterial);
    // StandardMaterial implements Material directly (不继承 BasicMaterial),
    // 但 PhysicalMaterial 仍是 StandardMaterial 子类。
    expect(m.type).toBe('Physical');
  });

  it('inherits StandardMaterial PBR fields', () => {
    const m = new PhysicalMaterial();
    expect(m.baseColor).toEqual({ r: 0.8, g: 0.8, b: 0.8 });
    expect(m.metallic).toBe(0);
    expect(m.roughness).toBe(0.5);
    expect(m.opacity).toBe(1);
    expect(m.programKey).toBe('physical'); // 覆盖了 StandardMaterial 的 'standard'
  });

  it('assigns unique uuids', () => {
    expect(new PhysicalMaterial().uuid).not.toBe(new PhysicalMaterial().uuid);
  });

  it('applies option overrides without mutating input objects', () => {
    const sheenColor = { r: 0.1, g: 0.2, b: 0.3 };
    const m = new PhysicalMaterial({
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      sheen: 0.5,
      sheenColor,
      sheenRoughness: 0.4,
      transmission: 0.9,
      thickness: 1.2,
      ior: 1.52,
      attenuationColor: { r: 0.9, g: 0.9, b: 0.9 },
      attenuationDistance: 5,
      specularIntensity: 0.6,
      specularColor: { r: 0.7, g: 0.7, b: 0.7 },
    });
    expect(m.clearcoat).toBe(0.8);
    expect(m.clearcoatRoughness).toBe(0.1);
    expect(m.sheen).toBe(0.5);
    expect(m.sheenColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(m.sheenRoughness).toBe(0.4);
    expect(m.transmission).toBe(0.9);
    expect(m.thickness).toBe(1.2);
    expect(m.ior).toBe(1.52);
    expect(m.attenuationColor).toEqual({ r: 0.9, g: 0.9, b: 0.9 });
    expect(m.attenuationDistance).toBe(5);
    expect(m.specularIntensity).toBe(0.6);
    expect(m.specularColor).toEqual({ r: 0.7, g: 0.7, b: 0.7 });
    // 输入对象不被共享引用
    expect(m.sheenColor).not.toBe(sheenColor);
    sheenColor.r = 1;
    expect(m.sheenColor.r).toBeCloseTo(0.1, 6);
  });

  it('does not share color objects between instances', () => {
    const a = new PhysicalMaterial();
    const b = new PhysicalMaterial();
    a.sheenColor.r = 0.5;
    a.specularColor.g = 0;
    a.attenuationColor.b = 0.2;
    expect(b.sheenColor.r).toBe(0);
    expect(b.specularColor.g).toBe(1);
    expect(b.attenuationColor.b).toBe(1);
  });

  it('inherits onBeforeCompile from StandardMaterial', () => {
    const m = new PhysicalMaterial();
    expect(typeof m.customProgramCacheKey()).toBe('string');
    expect(() => m.onBeforeCompile({ vertexShader: '', fragmentShader: '' })).not.toThrow();
  });

  it('can override onBeforeCompile to inject PBR chunks', () => {
    const m = new PhysicalMaterial();
    m.onBeforeCompile = (shader) => {
      shader.defines = { PHYSICAL: '', CLEARCOAT: '' };
      shader.fragmentShader += '\n// physical injection';
    };
    const shader: ShaderObject = { vertexShader: '', fragmentShader: 'base' };
    m.onBeforeCompile(shader);
    expect(shader.defines?.PHYSICAL).toBe('');
    expect(shader.defines?.CLEARCOAT).toBe('');
    expect(shader.fragmentShader).toContain('physical injection');
  });
});
