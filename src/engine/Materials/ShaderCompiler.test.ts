// ShaderCompiler 单元测试。
//
// 覆盖:
//   1. preprocess 解析 #include <name>(注册后替换)
//   2. preprocess 未注册 chunk 保留原样
//   3. injectChunks 在 #version 后插入
//   4. injectChunks 无 #version 时直接前置
//   5. compile 编译成功(用 mock GL)
//   6. compile 缓存命中(同源不重编)
//   7. compile 缓存未命中(改源码后重编)
//   8. clearCache 释放 program
//   9. getCompileStatus 反映成功 / 失败 / 计数
//  10. getUniforms / getAttributes 反射
//  11. compile 失败抛错且 status.error 非空
//  12. preprocess 支持嵌套 include

import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderCompiler } from './ShaderCompiler';
import { ShaderChunkRegistry } from './ShaderChunks/ShaderChunkRegistry';

// ── MockGL2 ────────────────────────────────────────────────────────
// 最小 WebGL2 mock,支持 shader 编译 + uniform 反射。

class MockGL2 {
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;

  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;

  private _counter = 0;
  private _nextId(): unknown {
    this._counter++;
    return { id: this._counter } as unknown;
  }

  // 模拟 active uniforms / attributes 数据(由测试设置)
  mockActiveUniforms: { name: string; size: number; type: number }[] = [];
  mockActiveAttributes: { name: string; size: number; type: number }[] = [];

  createShader(_type: number): WebGLShader { return this._nextId() as WebGLShader; }
  createProgram(): WebGLProgram { return this._nextId() as WebGLProgram; }
  shaderSource(_s: WebGLShader, _src: string): void {}
  compileShader(_s: WebGLShader): void {}
  getShaderParameter(_s: WebGLShader, _p: number): unknown { return true; }
  getShaderInfoLog(_s: WebGLShader): string | null { return null; }
  attachShader(_p: WebGLProgram, _s: WebGLShader): void {}
  linkProgram(_p: WebGLProgram): void {}
  getProgramParameter(_p: WebGLProgram, pname: number): unknown {
    if (pname === this.LINK_STATUS) return true;
    if (pname === this.ACTIVE_UNIFORMS) return this.mockActiveUniforms.length;
    if (pname === this.ACTIVE_ATTRIBUTES) return this.mockActiveAttributes.length;
    return 0;
  }
  getProgramInfoLog(_p: WebGLProgram): string | null { return null; }
  getActiveUniform(_p: WebGLProgram, i: number): unknown {
    return this.mockActiveUniforms[i] ?? null;
  }
  getActiveAttrib(_p: WebGLProgram, i: number): unknown {
    return this.mockActiveAttributes[i] ?? null;
  }
  getUniformLocation(_p: WebGLProgram, _n: string): WebGLUniformLocation | null {
    return this._nextId() as WebGLUniformLocation;
  }
  getAttribLocation(_p: WebGLProgram, _n: string): number { return 0; }
  useProgram(_p: WebGLProgram | null): void {}
  deleteShader(_s: WebGLShader | null): void {}
  deleteProgram(_p: WebGLProgram | null): void {}
  uniform1f(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform1i(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform2f(_l: WebGLUniformLocation | null, _x: number, _y: number): void {}
  uniform3f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void {}
  uniform4f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void {}
  uniformMatrix3fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}
}

// 强制类型转换 helper
function asGL2(mock: MockGL2): WebGL2RenderingContext {
  return mock as unknown as WebGL2RenderingContext;
}

// ── preprocess ─────────────────────────────────────────────────────

describe('ShaderCompiler preprocess', () => {
  it('resolves registered #include <name>', () => {
    const reg = new ShaderChunkRegistry();
    reg.register('COMMON', 'float foo() { return 1.0; }');
    const compiler = new ShaderCompiler(reg);
    const src = `#include <COMMON>\nvoid main() {}`;
    const out = compiler.preprocess(src);
    expect(out).toContain('float foo()');
    expect(out).not.toContain('#include <COMMON>');
  });

  it('leaves unknown #include as-is', () => {
    const compiler = new ShaderCompiler();
    const src = `#include <UNKNOWN_CHUNK>\nvoid main() {}`;
    const out = compiler.preprocess(src);
    // 未注册,保留原 #include
    expect(out).toContain('#include <UNKNOWN_CHUNK>');
  });

  it('handles nested #include (chunk includes chunk)', () => {
    const reg = new ShaderChunkRegistry();
    reg.register('A', '#include <B>\n// end A');
    reg.register('B', '// B content');
    const compiler = new ShaderCompiler(reg);
    const out = compiler.preprocess('#include <A>');
    expect(out).toContain('// B content');
    expect(out).toContain('// end A');
  });

  it('detects circular includes', () => {
    const reg = new ShaderChunkRegistry();
    reg.register('A', '#include <B>');
    reg.register('B', '#include <A>');
    const compiler = new ShaderCompiler(reg);
    expect(() => compiler.preprocess('#include <A>')).toThrow(/circular/);
  });

  it('passes through source without #include', () => {
    const compiler = new ShaderCompiler();
    const src = `void main() { gl_Position = vec4(1); }`;
    expect(compiler.preprocess(src)).toBe(src);
  });
});

// ── injectChunks ───────────────────────────────────────────────────

describe('ShaderCompiler injectChunks', () => {
  it('inserts chunks after #version line', () => {
    const reg = new ShaderChunkRegistry();
    reg.register('COMMON', 'float helper() { return 1.0; }');
    const compiler = new ShaderCompiler(reg);
    const src = `#version 300 es\nvoid main() {}`;
    const out = compiler.injectChunks(src, ['COMMON']);
    // #version 应在第一行
    expect(out.startsWith('#version 300 es\n')).toBe(true);
    // chunk 内容应在 #version 之后
    expect(out).toContain('float helper()');
    expect(out.indexOf('float helper()')).toBeGreaterThan(out.indexOf('#version'));
  });

  it('returns source unchanged for empty chunk list', () => {
    const compiler = new ShaderCompiler();
    const src = `#version 300 es\nvoid main() {}`;
    expect(compiler.injectChunks(src, [])).toBe(src);
  });

  it('prepends chunks when no #version line', () => {
    const reg = new ShaderChunkRegistry();
    reg.register('COMMON', 'float helper() { return 1.0; }');
    const compiler = new ShaderCompiler(reg);
    const src = `void main() {}`;
    const out = compiler.injectChunks(src, ['COMMON']);
    // inject() 输出为 `#define CHUNK_<NAME>\n<glsl>`,故源码以 #define 头开头,
    // chunk 内容紧随其后、且位于 main() 之前。
    expect(out.startsWith('#define CHUNK_COMMON\nfloat helper')).toBe(true);
    expect(out.indexOf('float helper')).toBeLessThan(out.indexOf('void main'));
  });

  it('throws on unregistered chunk', () => {
    const compiler = new ShaderCompiler();
    expect(() => compiler.injectChunks('x', ['UNKNOWN'])).toThrow(/not registered/);
  });
});

// ── compile ────────────────────────────────────────────────────────

describe('ShaderCompiler compile', () => {
  let mock: MockGL2;
  let compiler: ShaderCompiler;

  beforeEach(() => {
    mock = new MockGL2();
    mock.mockActiveUniforms = [
      { name: 'u_model', size: 1, type: 0x8B5C }, // FLOAT_MAT4
    ];
    mock.mockActiveAttributes = [
      { name: 'a_position', size: 1, type: 0x8B50 }, // FLOAT_VEC3
    ];
    compiler = new ShaderCompiler();
  });

  it('compiles valid shaders', () => {
    const vert = `#version 300 es\nvoid main() { gl_Position = vec4(1); }`;
    const frag = `#version 300 es\nout vec4 c;\nvoid main() { c = vec4(1); }`;
    const prog = compiler.compile(asGL2(mock), vert, frag);
    expect(prog).toBeDefined();
    expect(prog.program).toBeDefined();
    const status = compiler.getCompileStatus();
    expect(status.success).toBe(true);
    expect(status.error).toBe('');
    expect(status.cacheMisses).toBe(1);
    expect(status.cacheHits).toBe(0);
  });

  it('caches by source (same source = cache hit)', () => {
    const vert = `#version 300 es\nvoid main() { gl_Position = vec4(1); }`;
    const frag = `#version 300 es\nout vec4 c;\nvoid main() { c = vec4(1); }`;
    const p1 = compiler.compile(asGL2(mock), vert, frag);
    const p2 = compiler.compile(asGL2(mock), vert, frag);
    expect(p1).toBe(p2); // same instance
    const status = compiler.getCompileStatus();
    expect(status.cacheMisses).toBe(1);
    expect(status.cacheHits).toBe(1);
    expect(compiler.getCacheSize()).toBe(1);
  });

  it('different source = cache miss', () => {
    const vert1 = `#version 300 es\nvoid main() { gl_Position = vec4(1); }`;
    const vert2 = `#version 300 es\nvoid main() { gl_Position = vec4(2); }`;
    const frag = `#version 300 es\nout vec4 c;\nvoid main() { c = vec4(1); }`;
    compiler.compile(asGL2(mock), vert1, frag);
    compiler.compile(asGL2(mock), vert2, frag);
    expect(compiler.getCacheSize()).toBe(2);
    const status = compiler.getCompileStatus();
    expect(status.cacheMisses).toBe(2);
  });

  it('different defines = cache miss', () => {
    const vert = `#version 300 es\nvoid main() { gl_Position = vec4(1); }`;
    const frag = `#version 300 es\nout vec4 c;\nvoid main() { c = vec4(1); }`;
    compiler.compile(asGL2(mock), vert, frag, ['USE_FOG']);
    compiler.compile(asGL2(mock), vert, frag, ['USE_SKINNING']);
    expect(compiler.getCacheSize()).toBe(2);
  });

  it('preprocesses #include before compile', () => {
    const reg = new ShaderChunkRegistry();
    reg.register('COMMON', 'float helper() { return 1.0; }');
    compiler = new ShaderCompiler(reg);
    const vert = `#version 300 es\n#include <COMMON>\nvoid main() { gl_Position = vec4(helper()); }`;
    const frag = `#version 300 es\nout vec4 c;\nvoid main() { c = vec4(1); }`;
    expect(() => compiler.compile(asGL2(mock), vert, frag)).not.toThrow();
  });

  it('skipPreprocess=true bypasses #include resolution', () => {
    const vert = `#version 300 es\n#include <UNKNOWN>\nvoid main() {}`;
    const frag = `#version 300 es\nvoid main() {}`;
    // 默认会保留 #include,但因 mock GL 总是返回 success,不会抛错
    expect(() => compiler.compile(asGL2(mock), vert, frag, [], true)).not.toThrow();
  });

  it('throws on compile failure (mock returns LINK_STATUS=false)', () => {
    const failMock = new MockGL2();
    failMock.getProgramParameter = (_p: WebGLProgram, pname: number) => {
      if (pname === failMock.LINK_STATUS) return false;
      if (pname === failMock.ACTIVE_UNIFORMS) return 0;
      if (pname === failMock.ACTIVE_ATTRIBUTES) return 0;
      return 0;
    };
    failMock.getProgramInfoLog = () => 'link error: bad stuff';
    expect(() =>
      compiler.compile(
        asGL2(failMock),
        `#version 300 es\nvoid main() {}`,
        `#version 300 es\nvoid main() {}`,
      ),
    ).toThrow(/link error/);
    const status = compiler.getCompileStatus();
    expect(status.success).toBe(false);
    expect(status.error).toContain('link error');
  });

  it('throws on shader compile failure', () => {
    const failMock = new MockGL2();
    failMock.getShaderParameter = (_s: WebGLShader, _p: number) => false;
    failMock.getShaderInfoLog = () => 'compile error: syntax';
    expect(() =>
      compiler.compile(
        asGL2(failMock),
        `#version 300 es\nvoid main() {}`,
        `#version 300 es\nvoid main() {}`,
      ),
    ).toThrow(/compile error/);
    const status = compiler.getCompileStatus();
    expect(status.success).toBe(false);
  });
});

// ── getUniforms / getAttributes ────────────────────────────────────

describe('ShaderCompiler getUniforms / getAttributes', () => {
  it('reflects uniforms from compiled program', () => {
    const mock = new MockGL2();
    mock.mockActiveUniforms = [
      { name: 'u_model', size: 1, type: 0x8B5C },
      { name: 'u_view', size: 1, type: 0x8B5C },
    ];
    mock.mockActiveAttributes = [
      { name: 'a_position', size: 1, type: 0x8B50 },
    ];
    const compiler = new ShaderCompiler();
    const prog = compiler.compile(
      asGL2(mock),
      `#version 300 es\nvoid main() {}`,
      `#version 300 es\nvoid main() {}`,
    );
    const uniforms = compiler.getUniforms(prog);
    expect(uniforms.has('u_model')).toBe(true);
    expect(uniforms.has('u_view')).toBe(true);
    const attrs = compiler.getAttributes(prog);
    expect(attrs.has('a_position')).toBe(true);
  });
});

// ── clearCache / dispose ───────────────────────────────────────────

describe('ShaderCompiler clearCache / dispose', () => {
  it('clearCache empties cache', () => {
    const mock = new MockGL2();
    const compiler = new ShaderCompiler();
    compiler.compile(
      asGL2(mock),
      `#version 300 es\nvoid main() {}`,
      `#version 300 es\nvoid main() {}`,
    );
    expect(compiler.getCacheSize()).toBe(1);
    compiler.clearCache();
    expect(compiler.getCacheSize()).toBe(0);
    // 计数器保留(历史数据)
    const status = compiler.getCompileStatus();
    expect(status.cacheMisses).toBe(1);
  });

  it('dispose clears cache and resets registry', () => {
    const mock = new MockGL2();
    const reg = new ShaderChunkRegistry();
    reg.register('COMMON', 'x');
    const compiler = new ShaderCompiler(reg);
    compiler.compile(
      asGL2(mock),
      `#version 300 es\nvoid main() {}`,
      `#version 300 es\nvoid main() {}`,
    );
    compiler.dispose();
    expect(compiler.getCacheSize()).toBe(0);
    // registry 应被替换为新的空实例
    expect(compiler.chunkRegistry.has('COMMON')).toBe(false);
  });

  it('dispose is idempotent', () => {
    const compiler = new ShaderCompiler();
    expect(() => compiler.dispose()).not.toThrow();
    expect(() => compiler.dispose()).not.toThrow();
  });
});

// ── getCompileStatus ───────────────────────────────────────────────

describe('ShaderCompiler getCompileStatus', () => {
  it('returns initial state (no compiles yet)', () => {
    const compiler = new ShaderCompiler();
    const status = compiler.getCompileStatus();
    expect(status.success).toBe(false);
    expect(status.error).toBe('');
    expect(status.cacheHits).toBe(0);
    expect(status.cacheMisses).toBe(0);
    expect(status.lastVertexHash).toBe('');
    expect(status.lastFragmentHash).toBe('');
  });

  it('returns copy (mutation does not affect internal state)', () => {
    const compiler = new ShaderCompiler();
    const status1 = compiler.getCompileStatus();
    status1.cacheHits = 999;
    const status2 = compiler.getCompileStatus();
    expect(status2.cacheHits).toBe(0);
  });
});
