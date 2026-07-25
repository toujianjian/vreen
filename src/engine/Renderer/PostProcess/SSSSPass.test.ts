// SSSSPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. computeKernel 生成归一化对称高斯核
//   3. setStrength / setFalloff
//   4. apply() 在 mock GL 下不抛错并返回纹理
//   5. apply() 首帧分配 2 textures + 2 FBOs + 1 VAO + 1 buffer + 1 program
//   6. apply() 同尺寸不重复分配
//   7. apply() 执行两趟渲染(drawCalls=2)
//   8. dispose() 释放所有内部资源
//   9. dispose() 幂等

import { describe, it, expect } from 'vitest';
import { SSSSPass } from './SSSSPass';
import { Color } from '../../Math/Color';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 支持 SSSSPass.apply 所需的全部 GL 调用表面,包括 uniform1fv(kernel)。
// SSSSPass 输出 RGBA16F + HALF_FLOAT,两趟渲染。

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly RGBA8 = 0x8058;
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

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly RGBA8 = MockGL2.RGBA8;
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
  createdShaders: unknown[] = [];
  deletedShaders: unknown[] = [];
  drawCalls = 0;
  /** 记录 uniform1fv 调用次数(用于断言 kernel 上传)。 */
  uniform1fvCalls = 0;

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
  createShader(_type: number): WebGLShader { const s = this._nextId() as WebGLShader; this.createdShaders.push(s); return s; }

  deleteTexture(t: WebGLTexture | null): void { if (t) this.deletedTextures.push(t); }
  deleteFramebuffer(f: WebGLFramebuffer | null): void { if (f) this.deletedFramebuffers.push(f); }
  deleteBuffer(b: WebGLBuffer | null): void { if (b) this.deletedBuffers.push(b); }
  deleteVertexArray(v: WebGLVertexArrayObject | null): void { if (v) this.deletedVAOs.push(v); }
  deleteProgram(p: WebGLProgram | null): void { if (p) this.deletedPrograms.push(p); }
  deleteShader(s: WebGLShader | null): void { if (s) this.deletedShaders.push(s); }

  shaderSource(_s: WebGLShader, _src: string): void {}
  compileShader(_s: WebGLShader): void {}
  getShaderParameter(_s: WebGLShader, _pname: number): unknown { return true; }
  getShaderInfoLog(_s: WebGLShader): string | null { return null; }
  attachShader(_p: WebGLProgram, _s: WebGLShader): void {}
  linkProgram(_p: WebGLProgram): void {}
  getProgramParameter(_p: WebGLProgram, pname: number): unknown {
    if (pname === this.LINK_STATUS) return true;
    if (pname === this.ACTIVE_UNIFORMS) return 0;
    if (pname === this.ACTIVE_ATTRIBUTES) return 0;
    return 0;
  }
  getProgramInfoLog(_p: WebGLProgram): string | null { return null; }
  getActiveUniform(_p: WebGLProgram, _i: number): unknown { return null; }
  getActiveAttrib(_p: WebGLProgram, _i: number): unknown { return null; }
  getUniformLocation(_p: WebGLProgram, _name: string): WebGLUniformLocation | null { return null; }
  getAttribLocation(_p: WebGLProgram, _name: string): number { return -1; }

  useProgram(_p: WebGLProgram | null): void {}
  uniform1f(_loc: WebGLUniformLocation | null, _v: number): void {}
  uniform1i(_loc: WebGLUniformLocation | null, _v: number): void {}
  uniform1fv(_loc: WebGLUniformLocation | null, _v: Float32Array | number[]): void { this.uniform1fvCalls++; }
  uniform2f(_loc: WebGLUniformLocation | null, _x: number, _y: number): void {}
  uniform3f(_loc: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void {}
  uniform4f(_loc: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void {}
  uniformMatrix3fv(_loc: WebGLUniformLocation | null, _transpose: boolean, _m: Float32Array): void {}
  uniformMatrix4fv(_loc: WebGLUniformLocation | null, _transpose: boolean, _m: Float32Array): void {}

  bindFramebuffer(_target: number, _fb: WebGLFramebuffer | null): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_mask: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_unit: number): void {}
  bindTexture(_target: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._args: unknown[]): void {}
  texParameteri(_target: number, _pname: number, _param: number): void {}
  framebufferTexture2D(..._args: unknown[]): void {}
  bindVertexArray(_vao: WebGLVertexArrayObject | null): void {}
  bindBuffer(_target: number, _buf: WebGLBuffer | null): void {}
  bufferData(_target: number, _data: BufferSource, _usage: number): void {}
  enableVertexAttribArray(_index: number): void {}
  vertexAttribPointer(_index: number, _size: number, _type: number, _normalized: boolean, _stride: number, _offset: number): void {}
  drawArrays(_mode: number, _first: number, _count: number): void { this.drawCalls++; }
}

function makeTexture(id: string): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('SSSSPass construction', () => {
  it('defaults: strength=1, falloff=1, maxSamples=17, subsurfaceColor=skin', () => {
    const p = new SSSSPass();
    expect(p.name).toBe('ssss');
    expect(p.strength).toBe(1.0);
    expect(p.falloff).toBe(1.0);
    expect(p.maxSamples).toBe(17);
    expect(p.subsurfaceColor.r).toBeCloseTo(1.0);
    expect(p.subsurfaceColor.g).toBeCloseTo(0.3);
    expect(p.subsurfaceColor.b).toBeCloseTo(0.2);
  });

  it('accepts all options', () => {
    const p = new SSSSPass({
      strength: 0.5,
      falloff: 2.0,
      subsurfaceColor: new Color(0.9, 0.5, 0.3),
      maxSamples: 9,
    });
    expect(p.strength).toBe(0.5);
    expect(p.falloff).toBe(2.0);
    expect(p.maxSamples).toBe(9);
    expect(p.subsurfaceColor.r).toBeCloseTo(0.9);
  });

  it('initializes kernel with length 17', () => {
    const p = new SSSSPass();
    expect(p.kernel.length).toBe(17);
  });

  it('computes kernel in constructor', () => {
    const p = new SSSSPass();
    // 中心权重(kernel[8])应大于 0
    expect(p.kernel[8]).toBeGreaterThan(0);
  });
});

// ── computeKernel ───────────────────────────────────────────────────

describe('SSSSPass.computeKernel', () => {
  it('produces a normalized kernel summing to ~1', () => {
    const p = new SSSSPass({ maxSamples: 17 });
    p.computeKernel();
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += p.kernel[i];
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('is symmetric (kernel[i] == kernel[maxSamples-1-i])', () => {
    const p = new SSSSPass({ maxSamples: 17 });
    p.computeKernel();
    for (let i = 0; i < 8; i++) {
      expect(p.kernel[i]).toBeCloseTo(p.kernel[16 - i], 6);
    }
  });

  it('center weight is the largest', () => {
    const p = new SSSSPass({ maxSamples: 17 });
    p.computeKernel();
    const center = p.kernel[8];
    for (let i = 0; i < 17; i++) {
      expect(p.kernel[i]).toBeLessThanOrEqual(center + 1e-6);
    }
  });

  it('fills unused tail with 0 when maxSamples < 17', () => {
    const p = new SSSSPass({ maxSamples: 5 });
    p.computeKernel();
    // maxSamples=5 → 用 0..4,尾部 5..16 应为 0
    for (let i = 5; i < 17; i++) {
      expect(p.kernel[i]).toBe(0);
    }
    // 前 5 个和应为 1
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += p.kernel[i];
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('handles maxSamples=1 (degenerate: center=1)', () => {
    const p = new SSSSPass({ maxSamples: 1 });
    p.computeKernel();
    expect(p.kernel[0]).toBe(1);
    for (let i = 1; i < 17; i++) {
      expect(p.kernel[i]).toBe(0);
    }
  });
});

// ── setStrength / setFalloff ────────────────────────────────────────

describe('SSSSPass setters', () => {
  it('setStrength updates and clamps to 0', () => {
    const p = new SSSSPass();
    p.setStrength(0.5);
    expect(p.strength).toBe(0.5);
    p.setStrength(-1.0);
    expect(p.strength).toBe(0);
  });

  it('setFalloff updates and clamps to 0', () => {
    const p = new SSSSPass();
    p.setFalloff(3.0);
    expect(p.falloff).toBe(3.0);
    p.setFalloff(-2.0);
    expect(p.falloff).toBe(0);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('SSSSPass apply lifecycle', () => {
  it('apply() does not throw with mock GL and returns a texture', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('color'), makeTexture('depth'));
    expect(out).toBeDefined();
  });

  it('allocates 2 textures + 2 FBOs + 1 VAO + 1 buffer + 1 program on first apply', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.createdTextures.length).toBe(2); // intermediate + output
    expect(gl.createdFramebuffers.length).toBe(2);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('executes two draw calls (horizontal + vertical passes)', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(2);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c1'), makeTexture('d1'));
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'));
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('returns the same output texture across apply() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c1'), makeTexture('d1'));
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'));
    expect(t1).toBe(t2);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('executes 4 draw calls over two apply() (2 per apply)', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(4);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('SSSSPass dispose', () => {
  it('frees 2 textures + 2 FBOs + VAO + buffer + program after apply', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.deletedTextures.length).toBe(0);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(2);
    expect(gl.deletedFramebuffers.length).toBe(2);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new SSSSPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'));
    // 第二次 apply 后总创建数 = 4(intermediate+output 两次)
    expect(gl.createdTextures.length).toBe(4);
  });
});
