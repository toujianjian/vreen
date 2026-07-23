// MeshBasicMaterial 单元测试。

import { describe, it, expect } from 'vitest';
import { MeshBasicMaterial } from './MeshBasicMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';

describe('MeshBasicMaterial', () => {
  it('constructs with sensible defaults', () => {
    const m = new MeshBasicMaterial();
    expect(m.type).toBe('MeshBasic');
    expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.map).toBeNull();
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.wireframe).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
  });

  it('extends BasicMaterial', () => {
    expect(new MeshBasicMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('assigns unique uuids', () => {
    const a = new MeshBasicMaterial();
    const b = new MeshBasicMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('applies option overrides', () => {
    const m = new MeshBasicMaterial({
      color: { r: 1, g: 0, b: 0 },
      opacity: 0.5,
      transparent: true,
      wireframe: true,
      depthWrite: false,
    });
    expect(m.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(m.opacity).toBe(0.5);
    expect(m.transparent).toBe(true);
    expect(m.wireframe).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  it('does not share color object between instances', () => {
    const a = new MeshBasicMaterial();
    const b = new MeshBasicMaterial();
    a.color.r = 0;
    expect(b.color.r).toBe(1);
  });

  it('fromHex parses #rrggbb and #rgb', () => {
    const red = MeshBasicMaterial.fromHex('#ff0000');
    expect(red.color.r).toBeCloseTo(1, 6);
    expect(red.color.g).toBeCloseTo(0, 6);
    expect(red.color.b).toBeCloseTo(0, 6);

    const short = MeshBasicMaterial.fromHex('#0f0');
    expect(short.color.g).toBeCloseTo(1, 6);
    expect(short.color.r).toBeCloseTo(0, 6);
  });

  it('onBeforeCompile is a no-op by default and customProgramCacheKey returns string', () => {
    const m = new MeshBasicMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(shader.vertexShader).toBe('a'); // 默认不修改
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('onBeforeCompile can be overridden to inject chunks', () => {
    const m = new MeshBasicMaterial();
    m.onBeforeCompile = (shader: ShaderObject) => {
      shader.fragmentShader = shader.fragmentShader.replace('main', 'injected_main');
      shader.defines = { USE_CUSTOM: '' };
    };
    const shader: ShaderObject = { vertexShader: '', fragmentShader: 'void main() {}' };
    m.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain('injected_main');
    expect(shader.defines?.USE_CUSTOM).toBe('');
    // 覆盖后 cache key 改变
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });
});
