// FSRUpscalePass 单元测试。
//
// 覆盖:
//   1. 构造与默认值
//   2. apply() 在 mock GL 下不抛错并返回纹理
//   3. apply() 首帧分配 1 纹理 + 1 FBO + 1 VAO + 1 buffer + 1 program
//   4. apply() 同尺寸不重复分配
//   5. apply() 不同尺寸触发重建
//   6. setDirty() 标记重建
//   7. dispose() 释放资源
//   8. draw call 计数
//   9. FSR_EASU_FRAG shader 源码校验

import { describe, it, expect } from 'vitest';
import { FSRUpscalePass } from './FSRUpscalePass';
import { FSR_EASU_FRAG } from '../../Materials/shaders';

// ── MockGL2 ────────────────────────────────────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
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

  canvas: { width: number; height: number } = { width: 1920, height: 1080 };

  createdTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  createdShaders: unknown[] = [];
  drawCalls = 0;

  private _c = 0;
  private _id(): unknown { this._c++; return { id: this._c } as unknown; }

  createTexture(): unknown { const o = this._id(); this.createdTextures.push(o); return o; }
  createFramebuffer(): unknown { const o = this._id(); this.createdFramebuffers.push(o); return o; }
  createBuffer(): unknown { const o = this._id(); this.createdBuffers.push(o); return o; }
  createVertexArray(): unknown { const o = this._id(); this.createdVAOs.push(o); return o; }
  createProgram(): unknown { const o = this._id(); this.createdPrograms.push(o); return o; }
  createShader(_t: number): unknown { const o = this._id(); this.createdShaders.push(o); return o; }

  shaderSource() {} compileShader() {}
  getShaderParameter(): unknown { return true; }
  getShaderInfoLog(): string | null { return null; }
  attachShader() {} linkProgram() {}
  getProgramParameter(_p: unknown, pname: number): unknown {
    if (pname === this.LINK_STATUS) return true;
    return 0;
  }
  getProgramInfoLog(): string | null { return null; }
  getActiveUniform(_p: unknown, i: number): unknown {
    return { name: `u_${i}`, size: 1, type: 0x1406 };
  }
  getActiveAttrib(): unknown { return null; }
  getUniformLocation(): unknown { return { id: this._id() }; }
  getAttribLocation(): number { return 0; }

  useProgram() {}
  uniform1f() {} uniform1i() {} uniform2f() {} uniform3f() {}
  uniform4f() {} uniformMatrix3fv() {} uniformMatrix4fv() {}

  bindFramebuffer() {} viewport() {} clear() {} clearColor() {}
  activeTexture() {} bindTexture() {} texImage2D() {} texParameteri() {}
  framebufferTexture2D() {}
  bindVertexArray() {} bindBuffer() {} bufferData() {}
  enableVertexAttribArray() {} vertexAttribPointer() {}
  drawArrays() { this.drawCalls++; }
  deleteTexture() {} deleteFramebuffer() {} deleteBuffer() {}
  deleteVertexArray() {} deleteProgram() {} deleteShader() {}
}

function makeTexture(id: string): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

// ── 构造 ───────────────────────────────────────────────────────────

describe('FSRUpscalePass construction', () => {
  it('has name "fsr-upscale"', () => {
    const p = new FSRUpscalePass();
    expect(p.name).toBe('fsr-upscale');
  });

  it('constructs with no options', () => {
    expect(() => new FSRUpscalePass()).not.toThrow();
  });

  it('constructs with options', () => {
    expect(() => new FSRUpscalePass({ debug: true })).not.toThrow();
  });
});

// ── apply ──────────────────────────────────────────────────────────

describe('FSRUpscalePass apply', () => {
  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer on first apply', () => {
    const gl = new MockGL2();
    const p = new FSRUpscalePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(gl.createdTextures.length).toBe(1);  // output texture
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('returns the output texture', () => {
    const gl = new MockGL2();
    const p = new FSRUpscalePass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(out).toBeDefined();
  });

  it('does not throw with typical upscale ratio (720p → 1080p)', () => {
    const gl = new MockGL2();
    gl.canvas = { width: 1920, height: 1080 };
    const p = new FSRUpscalePass();
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720)).not.toThrow();
  });

  it('does not throw with 50% upscale (960×540 → 1920×1080)', () => {
    const gl = new MockGL2();
    gl.canvas = { width: 1920, height: 1080 };
    const p = new FSRUpscalePass();
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 960, 540)).not.toThrow();
  });

  it('does not reallocate on second apply with same canvas size', () => {
    const gl = new MockGL2();
    const p = new FSRUpscalePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    const texBefore = gl.createdTextures.length;
    const fboBefore = gl.createdFramebuffers.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(gl.createdTextures.length).toBe(texBefore);
    expect(gl.createdFramebuffers.length).toBe(fboBefore);
  });

  it('reallocates when canvas size changes', () => {
    const gl = new MockGL2();
    gl.canvas = { width: 1920, height: 1080 };
    const p = new FSRUpscalePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    const texBefore = gl.createdTextures.length;
    gl.canvas = { width: 2560, height: 1440 };
    p.setDirty();  // canvas size change should trigger dirty via setDirty or size check
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });

  it('draws 1 draw call per apply', () => {
    const gl = new MockGL2();
    const p = new FSRUpscalePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(gl.drawCalls).toBe(1);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(gl.drawCalls).toBe(2);
  });

  it('setDirty() triggers reallocation on next apply', () => {
    const gl = new MockGL2();
    const p = new FSRUpscalePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });
});

// ── dispose ───────────────────────────────────────────────────────

describe('FSRUpscalePass dispose', () => {
  it('dispose() does not throw (before init)', () => {
    const p = new FSRUpscalePass();
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() does not throw (after init)', () => {
    const gl = new MockGL2();
    const p = new FSRUpscalePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(() => p.dispose()).not.toThrow();
  });

  it('can re-apply after dispose (reinitializes)', () => {
    const gl = new MockGL2();
    const p = new FSRUpscalePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    p.dispose();
    const texBefore = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('input'), 1280, 720);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });
});

// ── FSR_EASU_FRAG shader 源码校验 ─────────────────────────────────

describe('FSR_EASU_FRAG shader source', () => {
  it('is GLSL ES 3.0', () => {
    expect(FSR_EASU_FRAG).toContain('#version 300 es');
  });

  it('declares required uniforms', () => {
    expect(FSR_EASU_FRAG).toContain('u_colorMap');
    expect(FSR_EASU_FRAG).toContain('u_inputSize');
    expect(FSR_EASU_FRAG).toContain('u_invInputSize');
  });

  it('samples 3x3 neighborhood (9 taps)', () => {
    // 8 offset taps + 1 center = 9
    expect(FSR_EASU_FRAG).toContain('-off.x');
    expect(FSR_EASU_FRAG).toContain('off.x');
    expect(FSR_EASU_FRAG).toContain('-off.y');
    expect(FSR_EASU_FRAG).toContain('off.y');
    expect(FSR_EASU_FRAG).toContain('tc)');              // mm (center)
  });

  it('computes luma for edge detection', () => {
    expect(FSR_EASU_FRAG).toContain('LUMA');
    expect(FSR_EASU_FRAG).toContain('0.299');
    expect(FSR_EASU_FRAG).toContain('0.587');
    expect(FSR_EASU_FRAG).toContain('0.114');
  });

  it('computes horizontal and vertical gradients', () => {
    expect(FSR_EASU_FRAG).toContain('dH');
    expect(FSR_EASU_FRAG).toContain('dV');
    expect(FSR_EASU_FRAG).toContain('abs(');
  });

  it('computes edge strength', () => {
    expect(FSR_EASU_FRAG).toContain('edgeStrength');
    expect(FSR_EASU_FRAG).toContain('min(');
  });

  it('uses bilateral weighting (exp + luma similarity)', () => {
    expect(FSR_EASU_FRAG).toContain('exp(');
    expect(FSR_EASU_FRAG).toContain('sigma');
    expect(FSR_EASU_FRAG).toContain('abs(ltl - lmm)');
  });

  it('computes standard bilinear for smooth areas', () => {
    expect(FSR_EASU_FRAG).toContain('bilerp');
    expect(FSR_EASU_FRAG).toContain('mix(mix(tl, tr');
  });

  it('blends bilinear and edge-aware based on edge strength', () => {
    expect(FSR_EASU_FRAG).toContain('mix(bilerp, edgeAware');
    expect(FSR_EASU_FRAG).toContain('edgeStrength');
  });

  it('computes sub-pixel input coordinates', () => {
    expect(FSR_EASU_FRAG).toContain('u_inputSize - 0.5');
    expect(FSR_EASU_FRAG).toContain('floor(pos)');
  });
});
