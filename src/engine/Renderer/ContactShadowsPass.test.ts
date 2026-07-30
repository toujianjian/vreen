// ContactShadowsPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. 所有 setter(setEnabled / setRadius / setDistance / setSamples /
//      setOpacity / setFalloff / setGroundHeight / setBlurType)
//   3. render() 在 mock GL 下不抛错并返回纹理
//   4. render() 首帧分配内部纹理 + FBO + VAO + buffer + program
//   5. render() 同尺寸不重复分配
//   6. render() 分辨率变更后重新分配
//   7. enabled=false 时 render() 直接返回 input,不分配资源
//   8. getShadowBuffer() / getStats() 行为正确
//   9. dispose() 释放所有资源,幂等,后续 render 重建
//
// Mock GL 策略:实现一个支持 ContactShadowsPass 全部调用表面的 MockGL2
// (包括 ShaderProgram 编译路径)。

import { describe, it, expect } from 'vitest';
import { ContactShadowsPass } from './ContactShadowsPass';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import type { Camera } from '../Cameras/Camera';

// ── MockGL2 ─────────────────────────────────────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly UNSIGNED_BYTE = 0x1401;
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
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;
  static readonly FLOAT = 0x1406;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
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
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
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
  createdShaders: unknown[] = [];
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
  createShader(_type: number): WebGLShader { const s = this._nextId() as WebGLShader; this.createdShaders.push(s); return s; }

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

function makeCamera(): Camera {
  return new PerspectiveCamera(90, 1, 0.1, 1000);
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('ContactShadowsPass construction', () => {
  it('defaults: enabled=true, radius=4.0, distance=1.0, samples=16, opacity=0.6, falloff=2.0, groundHeight=0.0, blurType=gaussian', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    expect(p.name).toBe('contact-shadows');
    expect(p.enabled).toBe(true);
    expect(p.radius).toBe(4.0);
    expect(p.distance).toBe(1.0);
    expect(p.samples).toBe(16);
    expect(p.opacity).toBe(0.6);
    expect(p.falloff).toBe(2.0);
    expect(p.groundHeight).toBe(0.0);
    expect(p.blurType).toBe('gaussian');
  });

  it('accepts all options', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext, {
      enabled: false,
      radius: 8.0,
      distance: 2.0,
      samples: 24,
      opacity: 0.8,
      falloff: 3.0,
      groundHeight: 0.5,
      blurType: 'box',
    });
    expect(p.enabled).toBe(false);
    expect(p.radius).toBe(8.0);
    expect(p.distance).toBe(2.0);
    expect(p.samples).toBe(24);
    expect(p.opacity).toBe(0.8);
    expect(p.falloff).toBe(3.0);
    expect(p.groundHeight).toBe(0.5);
    expect(p.blurType).toBe('box');
  });
});

// ── setters ─────────────────────────────────────────────────────────

describe('ContactShadowsPass setters', () => {
  it('setEnabled toggles enabled', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.setEnabled(false);
    expect(p.enabled).toBe(false);
    p.setEnabled(true);
    expect(p.enabled).toBe(true);
  });

  it('setRadius clamps to >= 0', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.setRadius(6.0);
    expect(p.radius).toBe(6.0);
    p.setRadius(-1.0);
    expect(p.radius).toBe(0);
  });

  it('setDistance clamps to >= 0.01', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.setDistance(2.0);
    expect(p.distance).toBe(2.0);
    p.setDistance(0);
    expect(p.distance).toBe(0.01);
    p.setDistance(-1);
    expect(p.distance).toBe(0.01);
  });

  it('setSamples clamps to [1, 32] and floors', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.setSamples(20);
    expect(p.samples).toBe(20);
    p.setSamples(0);
    expect(p.samples).toBe(1);
    p.setSamples(100);
    expect(p.samples).toBe(32);
    p.setSamples(16.7);
    expect(p.samples).toBe(16);
  });

  it('setOpacity clamps to [0, 1]', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.setOpacity(0.9);
    expect(p.opacity).toBe(0.9);
    p.setOpacity(-0.1);
    expect(p.opacity).toBe(0);
    p.setOpacity(1.5);
    expect(p.opacity).toBe(1);
  });

  it('setFalloff clamps to >= 0.01', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.setFalloff(5.0);
    expect(p.falloff).toBe(5.0);
    p.setFalloff(0);
    expect(p.falloff).toBe(0.01);
  });

  it('setGroundHeight clamps to [0, 1]', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.setGroundHeight(0.5);
    expect(p.groundHeight).toBe(0.5);
    p.setGroundHeight(-0.1);
    expect(p.groundHeight).toBe(0);
    p.setGroundHeight(1.5);
    expect(p.groundHeight).toBe(1);
  });

  it('setBlurType switches between gaussian and box', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    expect(p.blurType).toBe('gaussian');
    p.setBlurType('box');
    expect(p.blurType).toBe('box');
    p.setBlurType('gaussian');
    expect(p.blurType).toBe('gaussian');
  });
});

// ── render / 资源生命周期 ──────────────────────────────────────────

describe('ContactShadowsPass render lifecycle', () => {
  it('render() does not throw with mock GL and returns a texture', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    const input = makeTexture('input');
    const out = p.render(input, makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer + 1 program on first render', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('in'), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent render with same size', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.render(makeTexture('b'), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.render(makeTexture('b'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns the same texture across render() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    const t1 = p.render(makeTexture('a'), makeCamera());
    const t2 = p.render(makeTexture('b'), makeCamera());
    expect(t1).toBe(t2);
  });

  it('returns input directly when disabled (no allocation)', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext, { enabled: false });
    const input = makeTexture('input');
    const out = p.render(input, makeCamera());
    expect(out).toBe(input);
    expect(gl.createdTextures.length).toBe(0);
    expect(gl.createdFramebuffers.length).toBe(0);
    expect(gl.drawCalls).toBe(0);
  });

  it('renders when re-enabled', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext, { enabled: false });
    p.render(makeTexture('a'), makeCamera());
    expect(gl.drawCalls).toBe(0);
    p.enabled = true;
    p.render(makeTexture('b'), makeCamera());
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('increments drawCalls in stats', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeCamera());
    p.render(makeTexture('b'), makeCamera());
    const stats = p.getStats();
    expect(stats.drawCalls).toBe(2);
  });
});

// ── getShadowBuffer / getStats ──────────────────────────────────────

describe('ContactShadowsPass getShadowBuffer / getStats', () => {
  it('getShadowBuffer returns null before render', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    expect(p.getShadowBuffer()).toBeNull();
  });

  it('getShadowBuffer returns texture after render', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    const out = p.render(makeTexture('a'), makeCamera());
    expect(p.getShadowBuffer()).toBe(out);
  });

  it('getStats returns expected fields', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext, {
      radius: 6.0,
      samples: 20,
      opacity: 0.8,
      blurType: 'box',
    });
    p.render(makeTexture('a'), makeCamera());
    const stats = p.getStats();
    expect(stats.drawCalls).toBe(1);
    expect(stats.width).toBe(800);
    expect(stats.height).toBe(600);
    expect(stats.radius).toBe(6.0);
    expect(stats.samples).toBe(20);
    expect(stats.opacity).toBe(0.8);
    expect(stats.blurType).toBe('box');
    expect(stats.lastFrameTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('ContactShadowsPass dispose', () => {
  it('frees texture / FBO / VAO / buffer / program after render', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeCamera());
    expect(gl.deletedTextures.length).toBe(0);
    expect(gl.deletedFramebuffers.length).toBe(0);
    p.dispose();
    expect(gl.deletedTextures.length).toBe(1);
    expect(gl.deletedFramebuffers.length).toBe(1);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('clears shadow buffer after dispose', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeCamera());
    p.dispose();
    expect(p.getShadowBuffer()).toBeNull();
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.dispose();
    p.dispose();
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('render() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new ContactShadowsPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeCamera());
    p.dispose();
    const deletedAfterDispose = gl.deletedTextures.length;
    p.render(makeTexture('b'), makeCamera());
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.deletedTextures.length).toBe(deletedAfterDispose);
  });
});
