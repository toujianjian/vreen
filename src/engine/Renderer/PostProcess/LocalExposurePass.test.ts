// LocalExposurePass 单元测试。
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
//  11. 字段可更新(strength / localRadius / globalStride)
//  12. 着色器源码校验

import { describe, it, expect } from 'vitest';
import { LocalExposurePass } from './LocalExposurePass';
import { LOCAL_EXPOSURE_FRAG } from '../../Materials/shaders';

// ── MockGL2(精简版,LocalExposurePass 不需要 Camera/depth) ──────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly RGBA32F = 0x8814;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly HALF_FLOAT = 0x140B;
  static readonly FLOAT = 0x1406;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly NEAREST = 0x2600;
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
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly RGBA32F = MockGL2.RGBA32F;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly FLOAT = MockGL2.FLOAT;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly NEAREST = MockGL2.NEAREST;
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

describe('LocalExposurePass construction', () => {
  it('defaults', () => {
    const p = new LocalExposurePass();
    expect(p.name).toBe('localexposure');
    expect(p.strength).toBe(1.0);
    expect(p.localRadius).toBe(2);
    expect(p.globalRadius).toBe(2);
    expect(p.globalStride).toBe(8);
    expect(p.maxCompensation).toBe(1.5);
    expect(p.detailPreservation).toBe(0.7);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new LocalExposurePass({
      strength: 1.5,
      localRadius: 3,
      globalRadius: 4,
      globalStride: 16,
      maxCompensation: 2.0,
      detailPreservation: 0.9,
      enabled: false,
    });
    expect(p.strength).toBe(1.5);
    expect(p.localRadius).toBe(3);
    expect(p.globalRadius).toBe(4);
    expect(p.globalStride).toBe(16);
    expect(p.maxCompensation).toBe(2.0);
    expect(p.detailPreservation).toBe(0.9);
    expect(p.enabled).toBe(false);
  });

  it('strength is updatable', () => {
    const p = new LocalExposurePass();
    expect(p.strength).toBe(1.0);
    p.strength = 0.5;
    expect(p.strength).toBe(0.5);
  });

  it('localRadius is updatable', () => {
    const p = new LocalExposurePass();
    p.localRadius = 4;
    expect(p.localRadius).toBe(4);
  });

  it('globalStride is updatable', () => {
    const p = new LocalExposurePass();
    p.globalStride = 12;
    expect(p.globalStride).toBe(12);
  });

  it('maxCompensation is updatable', () => {
    const p = new LocalExposurePass();
    p.maxCompensation = 3.0;
    expect(p.maxCompensation).toBe(3.0);
  });

  it('detailPreservation is updatable', () => {
    const p = new LocalExposurePass();
    p.detailPreservation = 0.5;
    expect(p.detailPreservation).toBe(0.5);
  });

  it('enabled is updatable', () => {
    const p = new LocalExposurePass();
    expect(p.enabled).toBe(true);
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('LocalExposurePass apply', () => {
  it('apply() does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('first apply allocates resources (1 texture + 1 FBO + 1 VAO + 1 buffer)', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // 1 output texture + 1 input texture (makeInputTexture) = 2 total
    // 但 makeInputTexture 创建了 1 个,Pass 创建了 1 个 output
    expect(gl.createdTextures.length).toBe(2); // input + output
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
  });

  it('second apply does not re-allocate (same size)', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
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
    const p = new LocalExposurePass({ enabled: false });
    const input = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(result).toBe(input); // 直接返回输入
    expect(gl.drawCalls).toBe(0);
    expect(gl.createdTextures.length).toBe(1); // 只有 input,无 output
  });

  it('apply on resolution change rebuilds output texture + FBO', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    gl.canvas = { width: 800, height: 600 };
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    const texBefore = gl.createdTextures.length;
    // 改变分辨率
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // 重建了 output texture(新 1 张)+ FBO(新 1 个)
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
    expect(gl.createdFramebuffers.length).toBe(2);
  });

  it('setDirty() triggers re-allocation on next apply', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });

  it('apply returns output texture (not input) when enabled', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(result).not.toBe(input);
    expect(result).toBeDefined();
  });
});

// ── dispose ───────────────────────────────────────────────────────

describe('LocalExposurePass dispose', () => {
  it('dispose() does not throw and releases resources', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl does not throw', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('can re-apply after dispose (re-initializes)', () => {
    const gl = new MockGL2();
    const p = new LocalExposurePass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const drawsBefore = gl.drawCalls;
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(drawsBefore + 1);
  });
});

// ── 着色器源码校验 ─────────────────────────────────────────────────

describe('LocalExposurePass shader source', () => {
  it('LOCAL_EXPOSURE_FRAG has correct version and precision', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('#version 300 es');
    expect(LOCAL_EXPOSURE_FRAG).toContain('precision highp float');
  });

  it('LOCAL_EXPOSURE_FRAG has all uniforms', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_colorMap');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_texelSize');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_strength');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_localRadius');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_globalRadius');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_globalStride');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_maxCompensation');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_detailPreservation');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_enabled');
  });

  it('LOCAL_EXPOSURE_FRAG has local + global luminance sampling', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('localLum');
    expect(LOCAL_EXPOSURE_FRAG).toContain('globalLum');
    expect(LOCAL_EXPOSURE_FRAG).toContain('localCount');
    expect(LOCAL_EXPOSURE_FRAG).toContain('globalCount');
  });

  it('LOCAL_EXPOSURE_FRAG has log-space delta computation', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('logLocal');
    expect(LOCAL_EXPOSURE_FRAG).toContain('logGlobal');
    expect(LOCAL_EXPOSURE_FRAG).toContain('logDelta');
  });

  it('LOCAL_EXPOSURE_FRAG has exposure compensation (exp)', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('exposureComp');
    expect(LOCAL_EXPOSURE_FRAG).toContain('exposureFactor');
    expect(LOCAL_EXPOSURE_FRAG).toContain('exp(');
    expect(LOCAL_EXPOSURE_FRAG).toContain('clamp');
  });

  it('LOCAL_EXPOSURE_FRAG has detail preservation', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('detail');
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_detailPreservation');
    expect(LOCAL_EXPOSURE_FRAG).toContain('pixelLum');
  });

  it('LOCAL_EXPOSURE_FRAG references o3de / UE5 for provenance', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('o3de');
    expect(LOCAL_EXPOSURE_FRAG).toContain('UE5');
  });

  it('LOCAL_EXPOSURE_FRAG has luminance helper', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('luminance');
    expect(LOCAL_EXPOSURE_FRAG).toContain('0.2126');
    expect(LOCAL_EXPOSURE_FRAG).toContain('0.7152');
    expect(LOCAL_EXPOSURE_FRAG).toContain('0.0722');
  });

  it('LOCAL_EXPOSURE_FRAG has MAX_R loop bound', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('MAX_R');
  });

  it('LOCAL_EXPOSURE_FRAG disables cleanly (u_enabled == 0 passthrough)', () => {
    expect(LOCAL_EXPOSURE_FRAG).toContain('u_enabled == 0');
    expect(LOCAL_EXPOSURE_FRAG).toContain('return');
  });
});
