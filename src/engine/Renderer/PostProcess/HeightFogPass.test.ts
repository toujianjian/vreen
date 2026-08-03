// HeightFogPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. apply() 在 mock GL 下不抛错并返回纹理
//   3. apply() 首帧分配内部纹理 + FBO + VAO + buffer
//   4. apply() 同尺寸不重复分配
//   5. dispose() 释放资源
//   6. HEIGHT_FOG_FRAG shader 源码校验

import { describe, it, expect } from 'vitest';
import { HeightFogPass } from './HeightFogPass';
import { PerspectiveCamera } from '../../Cameras/PerspectiveCamera';
import { HEIGHT_FOG_FRAG } from '../../Materials/shaders';

// ── MockGL2(复用 SSRPass.test.ts 模式) ──────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;

  canvas: { width: number; height: number } = { width: 800, height: 600 };

  createdTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  createdShaders: unknown[] = [];
  drawCalls = 0;

  private _c = 0;
  private _id(): unknown { this._c++; return { id: this._c } as unknown; }

  createTexture(): WebGLTexture { const t = this._id() as WebGLTexture; this.createdTextures.push(t); return t; }
  createFramebuffer(): WebGLFramebuffer { const f = this._id() as WebGLFramebuffer; this.createdFramebuffers.push(f); return f; }
  createBuffer(): WebGLBuffer { const b = this._id() as WebGLBuffer; this.createdBuffers.push(b); return b; }
  createVertexArray(): WebGLVertexArrayObject { const v = this._id() as WebGLVertexArrayObject; this.createdVAOs.push(v); return v; }
  createProgram(): WebGLProgram { const p = this._id() as WebGLProgram; this.createdPrograms.push(p); return p; }
  createShader(_t: number): WebGLShader { const s = this._id() as WebGLShader; this.createdShaders.push(s); return s; }

  deleteTexture(_t: WebGLTexture | null): void {}
  deleteFramebuffer(_f: WebGLFramebuffer | null): void {}
  deleteBuffer(_b: WebGLBuffer | null): void {}
  deleteVertexArray(_v: WebGLVertexArrayObject | null): void {}
  deleteProgram(_p: WebGLProgram | null): void {}
  deleteShader(_s: WebGLShader | null): void {}

  shaderSource(_s: WebGLShader, _src: string): void {}
  compileShader(_s: WebGLShader): void {}
  getShaderParameter(_s: WebGLShader, _p: number): unknown { return true; }
  getShaderInfoLog(_s: WebGLShader): string | null { return null; }
  attachShader(_p: WebGLProgram, _s: WebGLShader): void {}
  linkProgram(_p: WebGLProgram): void {}
  getProgramParameter(_p: WebGLProgram, p: number): unknown {
    if (p === this.LINK_STATUS) return true;
    if (p === this.ACTIVE_UNIFORMS) return 0;
    if (p === this.ACTIVE_ATTRIBUTES) return 0;
    return 0;
  }
  getProgramInfoLog(_p: WebGLProgram): string | null { return null; }
  getActiveUniform(_p: WebGLProgram, _i: number): unknown { return null; }
  getActiveAttrib(_p: WebGLProgram, _i: number): unknown { return null; }
  getUniformLocation(_p: WebGLProgram, _n: string): WebGLUniformLocation | null { return null; }
  getAttribLocation(_p: WebGLProgram, _n: string): number { return -1; }

  useProgram(_p: WebGLProgram | null): void {}
  uniform1f(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform1i(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform2f(_l: WebGLUniformLocation | null, _x: number, _y: number): void {}
  uniform3f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void {}
  uniform4f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void {}
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}

  bindFramebuffer(_t: number, _f: WebGLFramebuffer | null): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_m: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_u: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._a: unknown[]): void {}
  texParameteri(_t: number, _p: number, _v: number): void {}
  framebufferTexture2D(..._a: unknown[]): void {}
  bindVertexArray(_v: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _b: WebGLBuffer | null): void {}
  bufferData(_t: number, _d: BufferSource, _u: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
}

function makeTexture(id: string): WebGLTexture { return { id } as unknown as WebGLTexture; }
function makeCamera(): PerspectiveCamera { return new PerspectiveCamera(60, 1.5, 0.1, 200); }

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('HeightFogPass construction', () => {
  it('defaults', () => {
    const p = new HeightFogPass();
    expect(p.name).toBe('heightfog');
    expect(p.fogDensity).toBe(0.02);
    expect(p.fogHeightFalloff).toBe(0.05);
    expect(p.fogHeight).toBe(0);
    expect(p.fogColor).toEqual([0.7, 0.8, 0.9]);
    expect(p.maxDistance).toBe(500);
    expect(p.inscatteringEnabled).toBe(false);
  });

  it('accepts all options', () => {
    const p = new HeightFogPass({
      fogDensity: 0.05,
      fogHeightFalloff: 0.1,
      fogHeight: 10,
      fogColor: [0.5, 0.6, 0.7],
      maxDistance: 1000,
      inscatteringEnabled: true,
      sunDirection: [0, -1, 0],
      sunColor: [1, 0.8, 0.5],
      inscatteringStrength: 2.0,
    });
    expect(p.fogDensity).toBe(0.05);
    expect(p.fogHeightFalloff).toBe(0.1);
    expect(p.fogHeight).toBe(10);
    expect(p.fogColor).toEqual([0.5, 0.6, 0.7]);
    expect(p.maxDistance).toBe(1000);
    expect(p.inscatteringEnabled).toBe(true);
    expect(p.sunDirection).toEqual([0, -1, 0]);
    expect(p.sunColor).toEqual([1, 0.8, 0.5]);
    expect(p.inscatteringStrength).toBe(2.0);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('HeightFogPass apply', () => {
  it('apply() does not throw and returns a texture', () => {
    const gl = new MockGL2();
    const p = new HeightFogPass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('color'), makeTexture('depth'), makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer on first apply', () => {
    const gl = new MockGL2();
    const p = new HeightFogPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new HeightFogPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('returns the same texture across apply() calls', () => {
    const gl = new MockGL2();
    const p = new HeightFogPass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(t1).toBe(t2);
  });

  it('re-allocates after setDirty()', () => {
    const gl = new MockGL2();
    const p = new HeightFogPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('HeightFogPass dispose', () => {
  it('dispose() is safe and idempotent', () => {
    const gl = new MockGL2();
    const p = new HeightFogPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(() => { p.dispose(); p.dispose(); }).not.toThrow();
  });
});

// ── HEIGHT_FOG_FRAG shader 源码校验 ─────────────────────────────

describe('HEIGHT_FOG_FRAG shader source', () => {
  it('is GLSL ES 3.0', () => {
    expect(HEIGHT_FOG_FRAG).toContain('#version 300 es');
  });

  it('samples color and depth textures', () => {
    expect(HEIGHT_FOG_FRAG).toContain('u_colorMap');
    expect(HEIGHT_FOG_FRAG).toContain('u_depthMap');
  });

  it('reconstructs world position from depth', () => {
    expect(HEIGHT_FOG_FRAG).toContain('u_inverseViewProjection');
    expect(HEIGHT_FOG_FRAG).toContain('worldPos');
  });

  it('computes exponential height fog density', () => {
    expect(HEIGHT_FOG_FRAG).toContain('u_fogDensity');
    expect(HEIGHT_FOG_FRAG).toContain('u_fogHeightFalloff');
    expect(HEIGHT_FOG_FRAG).toContain('exp(');
    expect(HEIGHT_FOG_FRAG).toContain('heightFactor');
  });

  it('clamps fog factor to [0, 1]', () => {
    expect(HEIGHT_FOG_FRAG).toContain('clamp(fogFactor');
  });

  it('supports inscattering (sun direction tinting)', () => {
    expect(HEIGHT_FOG_FRAG).toContain('u_inscatteringEnabled');
    expect(HEIGHT_FOG_FRAG).toContain('u_sunDirection');
    expect(HEIGHT_FOG_FRAG).toContain('u_sunColor');
    expect(HEIGHT_FOG_FRAG).toContain('inscatter');
  });

  it('handles sky pixels (depth >= 1.0 → full fog)', () => {
    expect(HEIGHT_FOG_FRAG).toContain('depth >= 1.0');
  });

  it('mixes scene color with fog color', () => {
    expect(HEIGHT_FOG_FRAG).toContain('mix(sceneColor');
  });
});
