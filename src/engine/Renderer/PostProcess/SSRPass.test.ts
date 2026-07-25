// SSRPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setResolution 更新与 clamp
//   3. apply() 在 mock GL 下不抛错(渲染流程不报错)并返回纹理
//   4. apply() 首帧分配内部纹理 + FBO + VAO + buffer
//   5. apply() 同尺寸不重复分配
//   6. apply() resolution 变更后重新分配
//   7. dispose() 释放内部纹理 / FBO / VAO / buffer / program
//   8. dispose() 幂等
//
// Mock GL 策略:实现一个支持 SSRPass 全部调用表面的 MockGL2(包括 shader
// 编译路径:createShader / compileShader / linkProgram / getProgramParameter
// 返回 truthy,使 ShaderProgram 构造成功)。

import { describe, it, expect } from 'vitest';
import { SSRPass } from './SSRPass';
import { Camera } from '../../Cameras/Camera';
import { PerspectiveCamera } from '../../Cameras/PerspectiveCamera';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 支持 SSRPass.apply 所需的全部 GL 调用表面,包括 ShaderProgram 编译路径。

class MockGL2 {
  // 常量
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE_CUBE_MAP = 0x8513;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly HALF_FLOAT = 0x8D61;
  static readonly RGBA16F = 0x881A;
  static readonly RGBA8 = 0x8058;
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
  readonly TEXTURE_CUBE_MAP = MockGL2.TEXTURE_CUBE_MAP;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly RGBA8 = MockGL2.RGBA8;
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

  // canvas(mock)
  canvas: { width: number; height: number } = { width: 800, height: 600 };

  // 调用记录
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

  private _counter = 0;
  private _nextId(): unknown {
    this._counter++;
    return { id: this._counter } as unknown;
  }

  // factory
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

  // shader path
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

  // uniform setters (no-op)
  useProgram(_p: WebGLProgram | null): void {}
  uniform1f(_loc: WebGLUniformLocation | null, _v: number): void {}
  uniform1i(_loc: WebGLUniformLocation | null, _v: number): void {}
  uniform2f(_loc: WebGLUniformLocation | null, _x: number, _y: number): void {}
  uniform3f(_loc: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void {}
  uniform4f(_loc: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void {}
  uniformMatrix3fv(_loc: WebGLUniformLocation | null, _transpose: boolean, _m: Float32Array): void {}
  uniformMatrix4fv(_loc: WebGLUniformLocation | null, _transpose: boolean, _m: Float32Array): void {}

  // texture / fbo / draw
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

function makeCamera(): Camera {
  // PerspectiveCamera 90° 1:1;apply 只读 projection/matrixWorldInverse/position
  const cam = new PerspectiveCamera(90, 1, 0.1, 1000);
  return cam;
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('SSRPass construction', () => {
  it('defaults: maxSteps=64, thickness=0.5, resolution=0.5, reflectionStrength=0.5', () => {
    const p = new SSRPass();
    expect(p.name).toBe('ssr');
    expect(p.maxSteps).toBe(64);
    expect(p.thickness).toBe(0.5);
    expect(p.resolution).toBe(0.5);
    expect(p.reflectionStrength).toBe(0.5);
  });

  it('accepts all options', () => {
    const p = new SSRPass({
      maxSteps: 32,
      thickness: 0.2,
      resolution: 1.0,
      reflectionStrength: 0.8,
    });
    expect(p.maxSteps).toBe(32);
    expect(p.thickness).toBe(0.2);
    expect(p.resolution).toBe(1.0);
    expect(p.reflectionStrength).toBe(0.8);
  });
});

// ── setResolution ───────────────────────────────────────────────────

describe('SSRPass.setResolution', () => {
  it('updates resolution when changed', () => {
    const p = new SSRPass();
    p.setResolution(0.25);
    expect(p.resolution).toBe(0.25);
  });

  it('clamps to [0.05, 1.0]', () => {
    const p = new SSRPass();
    p.setResolution(0.0); // too small
    expect(p.resolution).toBe(0.05);
    p.setResolution(2.0); // too large
    expect(p.resolution).toBe(1.0);
  });

  it('does not change value when same', () => {
    const p = new SSRPass({ resolution: 0.5 });
    p.setResolution(0.5);
    expect(p.resolution).toBe(0.5);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('SSRPass apply lifecycle', () => {
  it('apply() does not throw with mock GL and returns a texture', () => {
    const gl = new MockGL2();
    const p = new SSRPass();
    const input = makeTexture('input');
    const pos = makeTexture('pos');
    const nrm = makeTexture('nrm');
    const out = p.apply(gl as unknown as WebGL2RenderingContext, input, pos, nrm, makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer on first apply', () => {
    const gl = new MockGL2();
    const p = new SSRPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('in'), makeTexture('p'), makeTexture('n'), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    // 程序只编译一次
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent apply with same resolution', () => {
    const gl = new MockGL2();
    const p = new SSRPass({ resolution: 0.5 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('p'), makeTexture('n'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('p'), makeTexture('n'), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('re-allocates on resolution change', () => {
    const gl = new MockGL2();
    const p = new SSRPass({ resolution: 0.5 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('p'), makeTexture('n'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.setResolution(1.0);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('p'), makeTexture('n'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns the same texture across apply() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new SSRPass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('p'), makeTexture('n'), makeCamera());
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('p'), makeTexture('n'), makeCamera());
    expect(t1).toBe(t2);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('SSRPass dispose', () => {
  it('frees texture / FBO / VAO / buffer / program after apply', () => {
    const gl = new MockGL2();
    const p = new SSRPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('p'), makeTexture('n'), makeCamera());
    expect(gl.deletedTextures.length).toBe(0);
    expect(gl.deletedFramebuffers.length).toBe(0);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(1);
    expect(gl.deletedFramebuffers.length).toBe(1);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new SSRPass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext); // 不应抛错
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new SSRPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('p'), makeTexture('n'), makeCamera());
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const deletedAfterDispose = gl.deletedTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('p'), makeTexture('n'), makeCamera());
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.deletedTextures.length).toBe(deletedAfterDispose);
  });
});
