// ShaderLibrary 单元测试。
//
// 覆盖:
//   1. 默认单例预装 15 个内置模板
//   2. get / has / list / size
//   3. register / unregister
//   4. register 抛错(空 name / 缺源码)
//   5. createVariant:继承 + 覆盖 uniform / attribute / tags / source
//   6. filterByTags
//   7. clear
//   8. 单例 shaderLibrary 可用
//   9. 每个内置模板的字段完整性(vertexSource / fragmentSource 非空、uniforms 含 u_model 等)

import { describe, it, expect } from 'vitest';
import {
  ShaderLibrary,
  shaderLibrary,
  BUILTIN_SHADER_NAMES,
} from './ShaderLibrary';

describe('ShaderLibrary construction', () => {
  it('default loads all 15 builtins', () => {
    const lib = new ShaderLibrary(true);
    expect(lib.size()).toBe(15);
    expect(lib.list()).toEqual([
      'blinn-phong',
      'diffuse',
      'env-map',
      'fur',
      'pbr',
      'pbr-ibl',
      'parallax',
      'phong',
      'post-process',
      'particle',
      'skybox',
      'toon',
      'unlit',
      'unlit-textured',
      'water',
    ]);
  });

  it('autoLoadBuiltins=false yields empty library', () => {
    const lib = new ShaderLibrary(false);
    expect(lib.size()).toBe(0);
  });

  it('singleton shaderLibrary is preloaded', () => {
    expect(shaderLibrary.size()).toBeGreaterThanOrEqual(15);
    expect(BUILTIN_SHADER_NAMES.length).toBe(15);
  });
});

describe('ShaderLibrary get / has', () => {
  it('get returns template for known name', () => {
    const lib = new ShaderLibrary(true);
    const tpl = lib.get('unlit');
    expect(tpl).toBeDefined();
    expect(tpl!.name).toBe('unlit');
    expect(tpl!.vertexSource).toContain('#version 300 es');
    expect(tpl!.fragmentSource).toContain('#version 300 es');
  });

  it('get returns undefined for unknown name', () => {
    const lib = new ShaderLibrary(true);
    expect(lib.get('does-not-exist')).toBeUndefined();
  });

  it('has returns true / false appropriately', () => {
    const lib = new ShaderLibrary(true);
    expect(lib.has('pbr')).toBe(true);
    expect(lib.has('pbr-ibl')).toBe(true);
    expect(lib.has('missing')).toBe(false);
  });
});

describe('ShaderLibrary register / unregister', () => {
  it('register adds new template', () => {
    const lib = new ShaderLibrary(false);
    lib.register({
      name: 'custom',
      vertexSource: '#version 300 es\nvoid main(){}',
      fragmentSource: '#version 300 es\nvoid main(){}',
      uniforms: [],
      attributes: [],
      tags: [],
    });
    expect(lib.has('custom')).toBe(true);
    expect(lib.size()).toBe(1);
  });

  it('register overwrites same name', () => {
    const lib = new ShaderLibrary(false);
    lib.register({
      name: 'x',
      vertexSource: 'a',
      fragmentSource: 'b',
      uniforms: [],
      attributes: [],
      tags: [],
    });
    lib.register({
      name: 'x',
      vertexSource: 'c',
      fragmentSource: 'd',
      uniforms: [],
      attributes: [],
      tags: [],
    });
    expect(lib.get('x')!.vertexSource).toBe('c');
    expect(lib.get('x')!.fragmentSource).toBe('d');
  });

  it('register throws on empty name', () => {
    const lib = new ShaderLibrary(false);
    expect(() =>
      lib.register({
        name: '',
        vertexSource: 'a',
        fragmentSource: 'b',
        uniforms: [],
        attributes: [],
        tags: [],
      }),
    ).toThrow(/non-empty/);
  });

  it('register throws on missing source', () => {
    const lib = new ShaderLibrary(false);
    expect(() =>
      lib.register({
        name: 'bad',
        vertexSource: '',
        fragmentSource: 'b',
        uniforms: [],
        attributes: [],
        tags: [],
      }),
    ).toThrow(/missing/);
  });

  it('unregister removes template', () => {
    const lib = new ShaderLibrary(true);
    expect(lib.unregister('unlit')).toBe(true);
    expect(lib.has('unlit')).toBe(false);
    expect(lib.unregister('unlit')).toBe(false);
  });
});

describe('ShaderLibrary createVariant', () => {
  it('inherits all fields from base', () => {
    const lib = new ShaderLibrary(true);
    const v = lib.createVariant('unlit', {});
    expect(v.name).toBe('unlit-variant');
    expect(v.vertexSource).toBe(lib.get('unlit')!.vertexSource);
    expect(v.fragmentSource).toBe(lib.get('unlit')!.fragmentSource);
    expect(v.uniforms).toEqual(lib.get('unlit')!.uniforms);
    expect(v.attributes).toEqual(lib.get('unlit')!.attributes);
    expect(v.tags).toEqual(lib.get('unlit')!.tags);
  });

  it('overrides fragment source', () => {
    const lib = new ShaderLibrary(true);
    const v = lib.createVariant('unlit', {
      fragmentSource: '#version 300 es\nvoid main(){}',
    });
    expect(v.fragmentSource).toBe('#version 300 es\nvoid main(){}');
    // vertex source unchanged
    expect(v.vertexSource).toBe(lib.get('unlit')!.vertexSource);
  });

  it('adds new uniform declaration', () => {
    const lib = new ShaderLibrary(true);
    const v = lib.createVariant('unlit', {
      uniforms: [{ name: 'u_time', type: 'float' }],
    });
    const u = v.uniforms.find((x) => x.name === 'u_time');
    expect(u).toBeDefined();
    expect(u!.type).toBe('float');
  });

  it('overrides existing uniform declaration (same name)', () => {
    const lib = new ShaderLibrary(true);
    const v = lib.createVariant('unlit', {
      uniforms: [{ name: 'u_opacity', type: 'float', default: 0.5 }],
    });
    const u = v.uniforms.find((x) => x.name === 'u_opacity');
    expect(u!.default).toBe(0.5);
  });

  it('merges tags (dedup)', () => {
    const lib = new ShaderLibrary(true);
    const base = lib.get('unlit')!;
    const v = lib.createVariant('unlit', { tags: ['custom'] });
    expect(v.tags).toContain('custom');
    for (const t of base.tags) {
      expect(v.tags).toContain(t);
    }
  });

  it('throws on unknown base template', () => {
    const lib = new ShaderLibrary(true);
    expect(() => lib.createVariant('unknown', {})).toThrow(/not found/);
  });
});

describe('ShaderLibrary filterByTags', () => {
  it('returns all when tags empty', () => {
    const lib = new ShaderLibrary(true);
    expect(lib.filterByTags([]).length).toBe(15);
  });

  it('filters by single tag', () => {
    const lib = new ShaderLibrary(true);
    const unlit = lib.filterByTags(['unlit']);
    expect(unlit.length).toBe(2); // 'unlit' and 'unlit-textured'
    expect(unlit.some((t) => t.name === 'unlit')).toBe(true);
    expect(unlit.some((t) => t.name === 'unlit-textured')).toBe(true);
  });

  it('filters by union of tags', () => {
    const lib = new ShaderLibrary(true);
    const res = lib.filterByTags(['pbr']);
    expect(res.length).toBe(2); // 'pbr' and 'pbr-ibl'
  });

  it('returns empty when no match', () => {
    const lib = new ShaderLibrary(true);
    expect(lib.filterByTags(['no-such-tag']).length).toBe(0);
  });
});

describe('ShaderLibrary builtin templates integrity', () => {
  const lib = new ShaderLibrary(true);

  for (const name of BUILTIN_SHADER_NAMES) {
    it(`template "${name}" has valid structure`, () => {
      const tpl = lib.get(name);
      expect(tpl).toBeDefined();
      expect(tpl!.vertexSource.trim().startsWith('#version 300 es')).toBe(true);
      expect(tpl!.fragmentSource.trim().startsWith('#version 300 es')).toBe(true);
      expect(Array.isArray(tpl!.uniforms)).toBe(true);
      expect(tpl!.uniforms.length).toBeGreaterThan(0);
      expect(Array.isArray(tpl!.attributes)).toBe(true);
      expect(Array.isArray(tpl!.tags)).toBe(true);
    });
  }

  it('pbr template contains u_metallic and u_roughness uniforms', () => {
    const tpl = lib.get('pbr')!;
    expect(tpl.uniforms.some((u) => u.name === 'u_metallic')).toBe(true);
    expect(tpl.uniforms.some((u) => u.name === 'u_roughness')).toBe(true);
  });

  it('skybox template has samplerCube uniform', () => {
    const tpl = lib.get('skybox')!;
    expect(tpl.uniforms.some((u) => u.type === 'samplerCube')).toBe(true);
  });

  it('toon template has u_levels uniform', () => {
    const tpl = lib.get('toon')!;
    expect(tpl.uniforms.some((u) => u.name === 'u_levels')).toBe(true);
  });

  it('post-process template uses 2D position attribute', () => {
    const tpl = lib.get('post-process')!;
    expect(tpl.attributes.some((a) => a.type === 'vec2')).toBe(true);
  });
});

describe('ShaderLibrary clear', () => {
  it('removes all templates', () => {
    const lib = new ShaderLibrary(true);
    lib.clear();
    expect(lib.size()).toBe(0);
    expect(lib.list()).toEqual([]);
  });
});
