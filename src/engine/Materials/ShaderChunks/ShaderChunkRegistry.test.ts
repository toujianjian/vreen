// ShaderChunkRegistry 单元测试。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderChunkRegistry, shaderChunkRegistry } from './ShaderChunkRegistry';

describe('ShaderChunkRegistry', () => {
  let registry: ShaderChunkRegistry;

  beforeEach(() => {
    registry = new ShaderChunkRegistry();
  });

  describe('register / get / has', () => {
    it('register stores a chunk and get returns it', () => {
      registry.register('FOO', 'float foo() { return 0.0; }');
      expect(registry.get('FOO')).toBe('float foo() { return 0.0; }');
      expect(registry.has('FOO')).toBe(true);
    });

    it('get returns undefined for unknown name', () => {
      expect(registry.get('UNKNOWN')).toBeUndefined();
      expect(registry.has('UNKNOWN')).toBe(false);
    });

    it('register is chainable (returns this)', () => {
      const result = registry.register('A', 'a');
      expect(result).toBe(registry);
    });

    it('register overwrites previous value with same name', () => {
      registry.register('X', 'old');
      registry.register('X', 'new');
      expect(registry.get('X')).toBe('new');
    });

    it('register throws on empty name', () => {
      expect(() => registry.register('', 'glsl')).toThrow();
      expect(() => registry.register(null as unknown as string, 'glsl')).toThrow();
    });

    it('register throws on non-string glsl', () => {
      expect(() => registry.register('X', 123 as unknown as string)).toThrow();
    });

    it('registerAll registers multiple entries', () => {
      registry.registerAll({ A: 'a', B: 'b', C: 'c' });
      expect(registry.size()).toBe(3);
      expect(registry.get('A')).toBe('a');
      expect(registry.get('B')).toBe('b');
    });
  });

  describe('size / names / clear / unregister', () => {
    it('size returns the number of registered chunks', () => {
      expect(registry.size()).toBe(0);
      registry.register('A', 'a');
      expect(registry.size()).toBe(1);
      registry.register('B', 'b');
      expect(registry.size()).toBe(2);
    });

    it('names returns sorted list of registered names', () => {
      registry.register('Z', 'z');
      registry.register('A', 'a');
      registry.register('M', 'm');
      expect(registry.names()).toEqual(['A', 'M', 'Z']);
    });

    it('unregister removes a chunk and returns true if existed', () => {
      registry.register('A', 'a');
      expect(registry.unregister('A')).toBe(true);
      expect(registry.has('A')).toBe(false);
      expect(registry.unregister('A')).toBe(false);
    });

    it('clear removes all chunks', () => {
      registry.registerAll({ A: 'a', B: 'b' });
      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.names()).toEqual([]);
    });
  });

  describe('inject', () => {
    it('returns #define CHUNK_<NAME> + glsl', () => {
      registry.register('COMMON', 'float pi = 3.14;');
      const injected = registry.inject('COMMON');
      expect(injected).toContain('#define CHUNK_COMMON');
      expect(injected).toContain('float pi = 3.14;');
      // define 行在前,代码在后
      expect(injected.indexOf('#define CHUNK_COMMON')).toBeLessThan(
        injected.indexOf('float pi'),
      );
    });

    it('throws on unknown chunk name', () => {
      expect(() => registry.inject('UNKNOWN')).toThrow(/not registered/);
    });
  });

  describe('resolve', () => {
    it('replaces #include <name> with chunk source', () => {
      registry.register('FOO', 'float foo() { return 1.0; }');
      const src = `#include <FOO>
void main() { foo(); }`;
      const resolved = registry.resolve(src);
      expect(resolved).toContain('float foo() { return 1.0; }');
      expect(resolved).not.toContain('#include <FOO>');
      expect(resolved).toContain('void main() { foo(); }');
    });

    it('handles multiple includes in one source', () => {
      registry.register('A', '// a');
      registry.register('B', '// b');
      const src = `#include <A>
#include <B>
void main() {}`;
      const resolved = registry.resolve(src);
      expect(resolved).toContain('// a');
      expect(resolved).toContain('// b');
    });

    it('recursively resolves nested includes', () => {
      registry.register('INNER', 'float inner() { return 0.0; }');
      registry.register('OUTER', `#include <INNER>
float outer() { return inner(); }`);
      const src = `#include <OUTER>
void main() { outer(); }`;
      const resolved = registry.resolve(src);
      // INNER 也应该被展开到最终结果
      expect(resolved).toContain('float inner() { return 0.0; }');
      expect(resolved).toContain('float outer() { return inner(); }');
      expect(resolved).not.toContain('#include <INNER>');
      expect(resolved).not.toContain('#include <OUTER>');
    });

    it('preserves unregistered #include references and warns', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const src = `#include <UNREGISTERED>
void main() {}`;
      const resolved = registry.resolve(src);
      expect(resolved).toContain('#include <UNREGISTERED>');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('detects circular includes and throws', () => {
      registry.register('A', `#include <B>`);
      registry.register('B', `#include <A>`);
      const src = `#include <A>`;
      expect(() => registry.resolve(src)).toThrow(/circular include/);
    });

    it('detects self-including chunks', () => {
      registry.register('LOOP', `#include <LOOP>`);
      expect(() => registry.resolve('#include <LOOP>')).toThrow(/circular include/);
    });

    it('allows the same chunk to be included multiple times (no cycle)', () => {
      registry.register('FOO', 'float foo() { return 0.0; }');
      const src = `#include <FOO>
#include <FOO>
void main() { foo(); foo(); }`;
      const resolved = registry.resolve(src);
      // 两次 include 都被展开
      const matches = resolved.match(/float foo\(\) \{ return 0\.0; \}/g);
      expect(matches?.length).toBe(2);
    });

    it('does not modify source without includes', () => {
      registry.register('A', 'a');
      const src = `void main() {}`;
      expect(registry.resolve(src)).toBe(src);
    });

    it('handles #include with extra whitespace', () => {
      registry.register('FOO', '// foo');
      const src = `#include   <FOO>
void main() {}`;
      const resolved = registry.resolve(src);
      expect(resolved).toContain('// foo');
    });

    it('does not process #include with quotes (only angle brackets)', () => {
      registry.register('FOO', '// foo');
      const src = `#include "FOO"
void main() {}`;
      const resolved = registry.resolve(src);
      expect(resolved).toBe(src);
    });
  });

  describe('default singleton', () => {
    it('shaderChunkRegistry is an instance of ShaderChunkRegistry', () => {
      expect(shaderChunkRegistry).toBeInstanceOf(ShaderChunkRegistry);
    });
  });
});
