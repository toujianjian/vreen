// SSRPass(增强版)单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. 所有 setter(setEnabled / setMaxSteps / setStepSize / setThickness /
//      setRoughnessCutoff / setResolutionScale / setTemporalEnabled)
//   3. render() 在 mock GL 下不抛错并返回纹理
//   4. render() 首帧分配内部纹理 + FBO + VAO + buffer
//   5. render() 同尺寸不重复分配
//   6. render() 分辨率变更后重新分配
//   7. enabled=false 时 render() 直接返回 input,不分配资源
//   8. GBuffer 缺失纹理时 render() 返回 input
//   9. getReflectionBuffer() / getStats() 行为正确
//  10. dispose() 释放所有资源,幂等,后续 render 重建
//
// Mock GL 策略:实现一个支持 SSRPass 全部调用表面的 MockGL2(包括 shader
// 编译路径:createShader / compileShader / linkProgram / getProgramParameter
// 返回 truthy,使 ShaderProgram 构造成功)。

import { describe, it, expect } from 'vitest';
import { SSRPass } from './SSRPass';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import type { Camera } from '../Cameras/Camera';
import type { GBuffer } from './GBuffer';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 支持 SSRPass.render 所需的全部 GL 调用表面,包括 ShaderProgram 编译路径。

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TEXTURE3 = 0x84C3;
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
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;
  static readonly FLOAT = 0x1406;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TEXTURE3 = MockGL2.TEXTURE3;
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
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
  readonly FLOAT = MockGL2.FLOAT;

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
  deleteShader(_s: WebGLShader | null): void {}

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
  return new PerspectiveCamera(90, 1, 0.1, 1000);
}

/** Mock GBuffer:返回固定的 position / normal / material 纹理。 */
function makeMockGBuffer(withMaterial = true): GBuffer {
  const pos = makeTexture('pos');
  const nrm = makeTexture('nrm');
  const mat = withMaterial ? makeTexture('mat') : null;
  return {
    getPosition: () => pos,
    getNormal: () => nrm,
    getMaterial: () => mat,
  } as unknown as GBuffer;
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('SSRPass construction', () => {
  it('defaults: enabled=true, maxSteps=64, stepSize=0.1, thickness=0.5, maxDistance=100, fadeDistance=50, resolutionScale=0.5, roughnessCutoff=0.6, temporalEnabled=false', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    expect(p.name).toBe('ssr');
    expect(p.enabled).toBe(true);
    expect(p.maxSteps).toBe(64);
    expect(p.stepSize).toBe(0.1);
    expect(p.thickness).toBe(0.5);
    expect(p.maxDistance).toBe(100.0);
    expect(p.fadeDistance).toBe(50.0);
    expect(p.resolutionScale).toBe(0.5);
    expect(p.roughnessCutoff).toBe(0.6);
    expect(p.temporalEnabled).toBe(false);
  });

  it('accepts all options', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext, {
      enabled: false,
      maxSteps: 32,
      stepSize: 0.2,
      thickness: 0.3,
      maxDistance: 50,
      fadeDistance: 25,
      resolutionScale: 1.0,
      roughnessCutoff: 0.4,
      temporalEnabled: true,
    });
    expect(p.enabled).toBe(false);
    expect(p.maxSteps).toBe(32);
    expect(p.stepSize).toBe(0.2);
    expect(p.thickness).toBe(0.3);
    expect(p.maxDistance).toBe(50);
    expect(p.fadeDistance).toBe(25);
    expect(p.resolutionScale).toBe(1.0);
    expect(p.roughnessCutoff).toBe(0.4);
    expect(p.temporalEnabled).toBe(true);
  });
});

// ── setters ─────────────────────────────────────────────────────────

describe('SSRPass setters', () => {
  it('setEnabled toggles enabled', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setEnabled(false);
    expect(p.enabled).toBe(false);
    p.setEnabled(true);
    expect(p.enabled).toBe(true);
  });

  it('setMaxSteps clamps to [0, 256] and floors', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setMaxSteps(128);
    expect(p.maxSteps).toBe(128);
    p.setMaxSteps(-5);
    expect(p.maxSteps).toBe(0);
    p.setMaxSteps(999);
    expect(p.maxSteps).toBe(256);
    p.setMaxSteps(64.7);
    expect(p.maxSteps).toBe(64);
  });

  it('setStepSize clamps to >= 0.001', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setStepSize(0.5);
    expect(p.stepSize).toBe(0.5);
    p.setStepSize(0);
    expect(p.stepSize).toBe(0.001);
    p.setStepSize(-1);
    expect(p.stepSize).toBe(0.001);
  });

  it('setThickness clamps to >= 0.001', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setThickness(1.5);
    expect(p.thickness).toBe(1.5);
    p.setThickness(0);
    expect(p.thickness).toBe(0.001);
  });

  it('setRoughnessCutoff clamps to [0, 1]', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setRoughnessCutoff(0.8);
    expect(p.roughnessCutoff).toBe(0.8);
    p.setRoughnessCutoff(-0.1);
    expect(p.roughnessCutoff).toBe(0);
    p.setRoughnessCutoff(1.5);
    expect(p.roughnessCutoff).toBe(1);
  });

  it('setResolutionScale updates and marks dirty', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setResolutionScale(0.25);
    expect(p.resolutionScale).toBe(0.25);
  });

  it('setResolutionScale clamps to [0.05, 1.0]', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setResolutionScale(0.0);
    expect(p.resolutionScale).toBe(0.05);
    p.setResolutionScale(2.0);
    expect(p.resolutionScale).toBe(1.0);
  });

  it('setTemporalEnabled toggles temporalEnabled', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.setTemporalEnabled(true);
    expect(p.temporalEnabled).toBe(true);
    p.setTemporalEnabled(false);
    expect(p.temporalEnabled).toBe(false);
  });
});

// ── render / 资源生命周期 ──────────────────────────────────────────

describe('SSRPass render lifecycle', () => {
  it('render() does not throw with mock GL and returns a texture', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    const input = makeTexture('input');
    const out = p.render(input, makeMockGBuffer(), makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer on first render', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('in'), makeMockGBuffer(), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    // 程序只编译一次
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent render with same resolution', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext, { resolutionScale: 0.5 });
    p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.render(makeTexture('b'), makeMockGBuffer(), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('re-allocates on resolution change', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext, { resolutionScale: 0.5 });
    p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.setResolutionScale(1.0);
    p.render(makeTexture('b'), makeMockGBuffer(), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns the same texture across render() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    const t1 = p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    const t2 = p.render(makeTexture('b'), makeMockGBuffer(), makeCamera());
    expect(t1).toBe(t2);
  });

  it('returns input directly when disabled (no allocation)', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext, { enabled: false });
    const input = makeTexture('input');
    const out = p.render(input, makeMockGBuffer(), makeCamera());
    expect(out).toBe(input);
    expect(gl.createdTextures.length).toBe(0);
    expect(gl.createdFramebuffers.length).toBe(0);
    expect(gl.drawCalls).toBe(0);
  });

  it('returns input when GBuffer missing material texture', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    const input = makeTexture('input');
    const out = p.render(input, makeMockGBuffer(false), makeCamera());
    expect(out).toBe(input);
    expect(gl.createdTextures.length).toBe(0);
  });

  it('increments drawCalls in stats', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    p.render(makeTexture('b'), makeMockGBuffer(), makeCamera());
    const stats = p.getStats();
    expect(stats.drawCalls).toBe(2);
  });
});

// ── getReflectionBuffer / getStats ─────────────────────────────────

describe('SSRPass getReflectionBuffer / getStats', () => {
  it('getReflectionBuffer returns null before render', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    expect(p.getReflectionBuffer()).toBeNull();
  });

  it('getReflectionBuffer returns texture after render', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    const out = p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    expect(p.getReflectionBuffer()).toBe(out);
  });

  it('getStats returns expected fields', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext, {
      maxSteps: 48,
      resolutionScale: 0.75,
      roughnessCutoff: 0.5,
      temporalEnabled: true,
    });
    p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    const stats = p.getStats();
    expect(stats.drawCalls).toBe(1);
    expect(stats.width).toBe(Math.floor(800 * 0.75));
    expect(stats.height).toBe(Math.floor(600 * 0.75));
    expect(stats.resolutionScale).toBe(0.75);
    expect(stats.maxSteps).toBe(48);
    expect(stats.roughnessCutoff).toBe(0.5);
    expect(stats.temporalEnabled).toBe(true);
    expect(stats.lastFrameTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('SSRPass dispose', () => {
  it('frees texture / FBO / VAO / buffer / program after render', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    expect(gl.deletedTextures.length).toBe(0);
    expect(gl.deletedFramebuffers.length).toBe(0);
    p.dispose();
    expect(gl.deletedTextures.length).toBe(1);
    expect(gl.deletedFramebuffers.length).toBe(1);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('clears reflection buffer after dispose', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    p.dispose();
    expect(p.getReflectionBuffer()).toBeNull();
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.dispose();
    p.dispose(); // 不应抛错
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('render() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new SSRPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), makeMockGBuffer(), makeCamera());
    p.dispose();
    const deletedAfterDispose = gl.deletedTextures.length;
    p.render(makeTexture('b'), makeMockGBuffer(), makeCamera());
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.deletedTextures.length).toBe(deletedAfterDispose);
  });
});
