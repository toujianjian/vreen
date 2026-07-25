// MotionBlurPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setStrength / setMaxSamples 行为(含 clamp)
//   3. apply() 在 mock GL 下不抛错并返回纹理
//   4. apply() 首帧分配内部纹理 + FBO + VAO + buffer + program
//   5. apply() 同尺寸不重复分配
//   6. apply() canvas resize 后重新分配
//   7. apply() 缓存 velocityTexture(null 保留缓存)
//   8. dispose() 释放所有资源
//   9. dispose() 幂等

import { describe, it, expect } from 'vitest';
import { MotionBlurPass } from './MotionBlurPass';

// ── MockGL2 (与 SSRPass.test 同构,独立维护) ─────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly HALF_FLOAT = 0x8D61;
  static readonly RGBA16F = 0x881A;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly NEAREST = 0x2600;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;
  static readonly STATIC_DRAW = 0x88E4;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly FLOAT = 0x1406;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly NEAREST = MockGL2.NEAREST;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly FLOAT = MockGL2.FLOAT;

  canvas: { width: number; height: number } = { width: 800, height: 600 };

  createdTextures: unknown[] = [];
  deletedTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  deletedFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  deletedBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  deletedVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  deletedPrograms: unknown[] = [];
  drawCalls = 0;

  private _counter = 0;
  private _nextId(): unknown {
    this._counter++;
    return { id: this._counter } as unknown;
  }

  createTexture(): WebGLTexture { const t = this._nextId() as WebGLTexture; this.createdTextures.push(t); return t; }
  createFramebuffer(): WebGLFramebuffer { const f = this._nextId() as WebGLFramebuffer; this.createdFramebuffers.push(f); return f; }
  createBuffer(): WebGLBuffer { const b = this._nextId() as WebGLBuffer; this.createdBuffers.push(b); return b; }
  createVertexArray(): WebGLVertexArrayObject { const v = this._nextId() as WebGLVertexArrayObject; this.createdVAOs.push(v); return v; }
  createProgram(): WebGLProgram { const p = this._nextId() as WebGLProgram; this.createdPrograms.push(p); return p; }
  createShader(_type: number): WebGLShader { return this._nextId() as WebGLShader; }

  deleteTexture(t: WebGLTexture | null): void { if (t) this.deletedTextures.push(t); }
  deleteFramebuffer(f: WebGLFramebuffer | null): void { if (f) this.deletedFramebuffers.push(f); }
  deleteBuffer(b: WebGLBuffer | null): void { if (b) this.deletedBuffers.push(b); }
  deleteVertexArray(v: WebGLVertexArrayObject | null): void { if (v) this.deletedVAOs.push(v); }
  deleteProgram(p: WebGLProgram | null): void { if (p) this.deletedPrograms.push(p); }
  deleteShader(_s: WebGLShader | null): void {}

  shaderSource(_s: WebGLShader, _src: string): void {}
  compileShader(_s: WebGLShader): void {}
  getShaderParameter(_s: WebGLShader, _pname: number): unknown { return true; }
  getShaderInfoLog(_s: WebGLShader): string | null { return null; }
  attachShader(_p: WebGLProgram, _s: WebGLShader): void {}
  linkProgram(_p: WebGLProgram): void {}
  getProgramParameter(_p: WebGLProgram, pname: number): unknown {
    if (pname === this.LINK_STATUS) return true;
    return 0;
  }
  getProgramInfoLog(_p: WebGLProgram): string | null { return null; }
  getActiveUniform(_p: WebGLProgram, _i: number): unknown { return null; }
  getActiveAttrib(_p: WebGLProgram, _i: number): unknown { return null; }
  getUniformLocation(_p: WebGLProgram, _name: string): WebGLUniformLocation | null { return null; }
  getAttribLocation(_p: WebGLProgram, _name: string): number { return -1; }

  useProgram(_p: WebGLProgram | null): void {}
  uniform1f(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform1i(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform2f(_l: WebGLUniformLocation | null, _x: number, _y: number): void {}
  uniform3f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void {}
  uniform4f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void {}
  uniformMatrix3fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}

  bindFramebuffer(_t: number, _fb: WebGLFramebuffer | null): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_mask: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_unit: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._args: unknown[]): void {}
  texParameteri(_t: number, _p: number, _v: number): void {}
  framebufferTexture2D(..._args: unknown[]): void {}
  bindVertexArray(_vao: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _buf: WebGLBuffer | null): void {}
  bufferData(_t: number, _data: BufferSource, _usage: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
}

function makeTexture(id: string): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('MotionBlurPass construction', () => {
  it('defaults: strength=1.0, maxSamples=16', () => {
    const p = new MotionBlurPass();
    expect(p.name).toBe('motion-blur');
    expect(p.strength).toBe(1.0);
    expect(p.maxSamples).toBe(16);
    expect(p.velocityTexture).toBeNull();
  });

  it('accepts options', () => {
    const p = new MotionBlurPass({ strength: 0.5, maxSamples: 32 });
    expect(p.strength).toBe(0.5);
    expect(p.maxSamples).toBe(32);
  });
});

// ── setStrength / setMaxSamples ────────────────────────────────────

describe('MotionBlurPass setters', () => {
  it('setStrength updates value', () => {
    const p = new MotionBlurPass();
    p.setStrength(0.7);
    expect(p.strength).toBe(0.7);
  });

  it('setStrength clamps negative to 0', () => {
    const p = new MotionBlurPass();
    p.setStrength(-1.0);
    expect(p.strength).toBe(0);
  });

  it('setMaxSamples updates value', () => {
    const p = new MotionBlurPass();
    p.setMaxSamples(8);
    expect(p.maxSamples).toBe(8);
  });

  it('setMaxSamples clamps to [1, 64] and floors', () => {
    const p = new MotionBlurPass();
    p.setMaxSamples(0);
    expect(p.maxSamples).toBe(1);
    p.setMaxSamples(100);
    expect(p.maxSamples).toBe(64);
    p.setMaxSamples(12.7);
    expect(p.maxSamples).toBe(12);
  });
});

// ── apply lifecycle ────────────────────────────────────────────────

describe('MotionBlurPass apply lifecycle', () => {
  it('apply() does not throw and returns a texture', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    const out = p.apply(
      gl as unknown as WebGL2RenderingContext,
      makeTexture('input'),
      makeTexture('vel'),
    );
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer + 1 program on first apply', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('v'));
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent apply with same canvas size', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('v'));
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('v'));
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('v'));
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('v'));
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns the same texture across apply() calls (no resize)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('v'));
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('v'));
    expect(t1).toBe(t2);
  });

  it('caches velocityTexture when passed (null in subsequent apply uses cached)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    const vel = makeTexture('vel');
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), vel);
    expect(p.velocityTexture).toBe(vel);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), null);
    expect(p.velocityTexture).toBe(vel);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('MotionBlurPass dispose', () => {
  it('frees texture / FBO / VAO / buffer / program after apply', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('v'));
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(1);
    expect(gl.deletedFramebuffers.length).toBe(1);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('clears velocityTexture reference after dispose', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('v'));
    expect(p.velocityTexture).not.toBeNull();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(p.velocityTexture).toBeNull();
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new MotionBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('v'));
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('v'));
    expect(gl.createdTextures.length).toBe(2);
  });
});
