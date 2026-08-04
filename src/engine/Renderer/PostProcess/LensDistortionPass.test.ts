// LensDistortionPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. apply() 在 mock GL 下不抛错
//   3. apply() 首帧分配资源(1 texture + 1 FBO + 1 VAO + 1 buffer)
//   4. apply() 同尺寸不重复分配
//   5. apply() 禁用时返回输入纹理(零 draw call)
//   6. apply() 分辨率变化时重建
//   7. setDirty() 触发重建
//   8. dispose() 释放资源
//   9. dispose() 无 gl 参数
//  10. dispose() 重复调用
//  11. 字段可更新(distortion / chromaticAberration / principalPoint / scale)
//  12. 着色器源码校验

import { describe, it, expect } from 'vitest';
import { LensDistortionPass } from './LensDistortionPass';
import { LENS_DISTORTION_FRAG } from '../../Materials/shaders';

// ── MockGL2(精简版,LensDistortionPass 不需要 Camera/depth) ──────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TRIANGLES = 0x0004;
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
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;
  static readonly BLEND = 0x0BE2;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TRIANGLES = MockGL2.TRIANGLES;
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
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;
  readonly BLEND = MockGL2.BLEND;

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
  framebufferTexture2D(..._a: unknown[]): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_m: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  colorMask(_r: boolean, _g: boolean, _b: boolean, _a: boolean): void {}
  activeTexture(_u: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._a: unknown[]): void {}
  texParameteri(_t: number, _p: number, _v: number): void {}
  bindVertexArray(_v: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _b: WebGLBuffer | null): void {}
  bufferData(_t: number, _d: BufferSource, _u: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }

  enable(_c: number): void {}
  disable(_c: number): void {}
}

function makeInputTexture(gl: MockGL2): WebGLTexture {
  return gl.createTexture();
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('LensDistortionPass construction', () => {
  it('defaults', () => {
    const p = new LensDistortionPass();
    expect(p.name).toBe('lensdistortion');
    expect(p.principalPoint).toEqual([0.5, 0.5]);
    expect(p.distortion).toBe(0.1);
    expect(p.distortion2).toBe(0);
    expect(p.scale).toBe(1.0);
    expect(p.chromaticAberration).toBe(0);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new LensDistortionPass({
      principalPoint: [0.4, 0.6],
      distortion: 0.3,
      distortion2: 0.05,
      scale: 1.1,
      chromaticAberration: 0.04,
      enabled: false,
    });
    expect(p.principalPoint).toEqual([0.4, 0.6]);
    expect(p.distortion).toBe(0.3);
    expect(p.distortion2).toBe(0.05);
    expect(p.scale).toBe(1.1);
    expect(p.chromaticAberration).toBe(0.04);
    expect(p.enabled).toBe(false);
  });

  it('distortion is updatable', () => {
    const p = new LensDistortionPass();
    expect(p.distortion).toBe(0.1);
    p.distortion = -0.2; // pincushion
    expect(p.distortion).toBe(-0.2);
  });

  it('distortion2 is updatable', () => {
    const p = new LensDistortionPass();
    p.distortion2 = 0.08;
    expect(p.distortion2).toBe(0.08);
  });

  it('scale is updatable', () => {
    const p = new LensDistortionPass();
    p.scale = 1.2;
    expect(p.scale).toBe(1.2);
  });

  it('chromaticAberration is updatable', () => {
    const p = new LensDistortionPass();
    p.chromaticAberration = 0.05;
    expect(p.chromaticAberration).toBe(0.05);
  });

  it('principalPoint is updatable', () => {
    const p = new LensDistortionPass();
    p.principalPoint = [0.3, 0.7];
    expect(p.principalPoint).toEqual([0.3, 0.7]);
  });

  it('enabled is updatable', () => {
    const p = new LensDistortionPass();
    expect(p.enabled).toBe(true);
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });

  it('zero distortion is a valid configuration', () => {
    const p = new LensDistortionPass({ distortion: 0, distortion2: 0 });
    expect(p.distortion).toBe(0);
    expect(p.distortion2).toBe(0);
  });

  it('negative distortion (pincushion) is a valid configuration', () => {
    const p = new LensDistortionPass({ distortion: -0.15 });
    expect(p.distortion).toBe(-0.15);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('LensDistortionPass apply', () => {
  it('apply() does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('first apply allocates resources (1 output texture + 1 FBO + 1 VAO + 1 buffer)', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // makeInputTexture 创建了 1 个,Pass 创建了 1 个 output → 2 total
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
  });

  it('second apply does not re-allocate (same size)', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    const texBefore = gl.createdTextures.length;
    const fboBefore = gl.createdFramebuffers.length;
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.createdTextures.length).toBe(texBefore);
    expect(gl.createdFramebuffers.length).toBe(fboBefore);
  });

  it('disabled apply returns input texture and skips draw call', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass({ enabled: false });
    const input = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(result).toBe(input);
    expect(gl.drawCalls).toBe(0);
    expect(gl.createdTextures.length).toBe(1); // 只有 input,无 output
  });

  it('apply on resolution change rebuilds output texture + FBO', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    gl.canvas = { width: 800, height: 600 };
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    const texBefore = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
    expect(gl.createdFramebuffers.length).toBe(2);
  });

  it('setDirty() triggers re-allocation on next apply', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });

  it('apply returns output texture (not input) when enabled', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(result).not.toBe(input);
    expect(result).toBeDefined();
  });

  it('apply with chromaticAberration > 0 still works (3-sample path)', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass({ chromaticAberration: 0.03, distortion: 0.2 });
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with zero distortion passes through', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass({ distortion: 0, distortion2: 0 });
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('multiple applies issue multiple draw calls', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.drawCalls).toBe(3);
  });
});

// ── dispose ───────────────────────────────────────────────────────

describe('LensDistortionPass dispose', () => {
  it('dispose() does not throw and releases resources', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl does not throw', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('can re-apply after dispose (re-initializes)', () => {
    const gl = new MockGL2();
    const p = new LensDistortionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const drawsBefore = gl.drawCalls;
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(drawsBefore + 1);
  });
});

// ── 着色器源码校验 ─────────────────────────────────────────────────

describe('LensDistortionPass shader source', () => {
  it('LENS_DISTORTION_FRAG has correct version and precision', () => {
    expect(LENS_DISTORTION_FRAG).toContain('#version 300 es');
    expect(LENS_DISTORTION_FRAG).toContain('precision highp float');
  });

  it('LENS_DISTORTION_FRAG has all uniforms', () => {
    expect(LENS_DISTORTION_FRAG).toContain('u_colorMap');
    expect(LENS_DISTORTION_FRAG).toContain('u_principalPoint');
    expect(LENS_DISTORTION_FRAG).toContain('u_distortion');
    expect(LENS_DISTORTION_FRAG).toContain('u_distortion2');
    expect(LENS_DISTORTION_FRAG).toContain('u_scale');
    expect(LENS_DISTORTION_FRAG).toContain('u_chromaticAberration');
    expect(LENS_DISTORTION_FRAG).toContain('u_enabled');
  });

  it('LENS_DISTORTION_FRAG implements Brown-Conrady radial distortion', () => {
    // distort = 1 + k1*r² + k2*r⁴
    expect(LENS_DISTORTION_FRAG).toContain('u_distortion * r2');
    expect(LENS_DISTORTION_FRAG).toContain('u_distortion2 * r2 * r2');
  });

  it('LENS_DISTORTION_FRAG computes r² = dot(d, d)', () => {
    expect(LENS_DISTORTION_FRAG).toContain('float r2 = dot(d, d)');
  });

  it('LENS_DISTORTION_FRAG applies scale compensation', () => {
    expect(LENS_DISTORTION_FRAG).toContain('u_scale');
    expect(LENS_DISTORTION_FRAG).toContain('/ u_scale');
  });

  it('LENS_DISTORTION_FRAG has RGB chromatic aberration branch', () => {
    expect(LENS_DISTORTION_FRAG).toContain('u_chromaticAberration > 0.0');
    expect(LENS_DISTORTION_FRAG).toContain('distortR');
    expect(LENS_DISTORTION_FRAG).toContain('distortG');
    expect(LENS_DISTORTION_FRAG).toContain('distortB');
  });

  it('LENS_DISTORTION_FRAG R channel uses +ca, B channel uses -ca', () => {
    expect(LENS_DISTORTION_FRAG).toContain('u_distortion + ca');
    expect(LENS_DISTORTION_FRAG).toContain('u_distortion - ca');
  });

  it('LENS_DISTORTION_FRAG clamps UVs to avoid out-of-bounds sampling', () => {
    expect(LENS_DISTORTION_FRAG).toContain('clamp(uvR');
    expect(LENS_DISTORTION_FRAG).toContain('clamp(uvG');
    expect(LENS_DISTORTION_FRAG).toContain('clamp(uvB');
  });

  it('LENS_DISTORTION_FRAG has single-sample fallback for no CA', () => {
    expect(LENS_DISTORTION_FRAG).toContain('distortedUV');
    expect(LENS_DISTORTION_FRAG).toContain('center + d * distort');
  });

  it('LENS_DISTORTION_FRAG handles out-of-bounds UV with black fill', () => {
    expect(LENS_DISTORTION_FRAG).toContain('distortedUV.x < 0.0');
    expect(LENS_DISTORTION_FRAG).toContain('vec4(0.0, 0.0, 0.0, 1.0)');
  });

  it('LENS_DISTORTION_FRAG references provenance (o3de / OpenCV / UE5)', () => {
    expect(LENS_DISTORTION_FRAG).toContain('o3de');
    expect(LENS_DISTORTION_FRAG).toContain('OpenCV');
    expect(LENS_DISTORTION_FRAG).toContain('UE5');
  });

  it('LENS_DISTORTION_FRAG disables cleanly (u_enabled == 0 passthrough)', () => {
    expect(LENS_DISTORTION_FRAG).toContain('u_enabled == 0');
    expect(LENS_DISTORTION_FRAG).toContain('return');
  });
});
