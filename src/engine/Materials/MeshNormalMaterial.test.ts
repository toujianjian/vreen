// NormalMaterial 单元测试。

import { describe, it, expect } from 'vitest';
import { NormalMaterial } from './MeshNormalMaterial';
import { BasicMaterial } from '../Core/Material';

describe('NormalMaterial', () => {
  it('constructs with sensible defaults', () => {
    const m = new NormalMaterial();
    expect(m.type).toBe('Normal');
    expect(m.flatShading).toBe(false);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.wireframe).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
  });

  it('extends BasicMaterial', () => {
    expect(new NormalMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('assigns unique uuids', () => {
    expect(new NormalMaterial().uuid).not.toBe(new NormalMaterial().uuid);
  });

  it('applies option overrides', () => {
    const m = new NormalMaterial({
      flatShading: true,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });
    expect(m.flatShading).toBe(true);
    expect(m.wireframe).toBe(true);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(0.5);
    expect(m.depthTest).toBe(false);
  });

  it('inherits onBeforeCompile no-op from BasicMaterial', () => {
    const m = new NormalMaterial();
    expect(typeof m.customProgramCacheKey()).toBe('string');
    expect(() => m.onBeforeCompile({ vertexShader: '', fragmentShader: '' })).not.toThrow();
  });
});
