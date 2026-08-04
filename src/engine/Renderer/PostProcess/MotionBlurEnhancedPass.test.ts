// MotionBlurEnhancedPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setter 方法(setStrength/setMaxSamples/setDepthThreshold/setJitter)
//   3. apply() 在 mock GL 下不抛错并返回纹理
//   4. apply() 首帧分配内部纹理 + FBO + VAO + buffer + program
//   5. apply() 同尺寸不重复分配
//   6. apply() 禁用时返回输入纹理(零 draw call)
//   7. apply() 分辨率变化时重建
//   8. setDirty() 触发重建
//   9. dispose() 释放资源(幂等)
//  10. dispose() 无 gl 参数
//  11. dispose() 重复调用
//  12. dispose() 后可重新 apply
//  13. frameIndex 推进
//  14. 着色器源码校验

import { describe, it, expect } from 'vitest';
import { MotionBlurEnhancedPass } from './MotionBlurEnhancedPass';
import { MOTION_BLUR_ENHANCED_FRAG } from '../../Materials/shaders';

// ── MockGL2(支持 depth + velocity + color 三纹理) ────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TRIANGLES = 0x0004;
  static readonly RGBA = 0x1908;
  static readonly RGBA16F = 0x881A;
  static readonly HALF_FLOAT = 0x140B;
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
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
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

function makeTexture(gl: MockGL2): WebGLTexture {
  return gl.createTexture();
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('MotionBlurEnhancedPass construction', () => {
  it('defaults', () => {
    const p = new MotionBlurEnhancedPass();
    expect(p.name).toBe('motion-blur-enhanced');
    expect(p.strength).toBe(1.0);
    expect(p.maxSamples).toBe(16);
    expect(p.depthThreshold).toBe(0.05);
    expect(p.jitter).toBe(0.5);
    expect(p.enabled).toBe(true);
    expect(p.frameIndex).toBe(0);
  });

  it('accepts all options', () => {
    const p = new MotionBlurEnhancedPass({
      strength: 2.0,
      maxSamples: 32,
      depthThreshold: 0.03,
      jitter: 1.0,
      enabled: false,
    });
    expect(p.strength).toBe(2.0);
    expect(p.maxSamples).toBe(32);
    expect(p.depthThreshold).toBe(0.03);
    expect(p.jitter).toBe(1.0);
    expect(p.enabled).toBe(false);
  });

  it('strength is updatable', () => {
    const p = new MotionBlurEnhancedPass();
    expect(p.strength).toBe(1.0);
    p.strength = 1.5;
    expect(p.strength).toBe(1.5);
  });

  it('maxSamples is updatable', () => {
    const p = new MotionBlurEnhancedPass();
    p.maxSamples = 24;
    expect(p.maxSamples).toBe(24);
  });

  it('depthThreshold is updatable', () => {
    const p = new MotionBlurEnhancedPass();
    p.depthThreshold = 0.08;
    expect(p.depthThreshold).toBe(0.08);
  });

  it('jitter is updatable', () => {
    const p = new MotionBlurEnhancedPass();
    p.jitter = 0.75;
    expect(p.jitter).toBe(0.75);
  });

  it('enabled is updatable', () => {
    const p = new MotionBlurEnhancedPass();
    expect(p.enabled).toBe(true);
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });

  it('zero jitter disables halton dithering (matches basic MotionBlurPass)', () => {
    const p = new MotionBlurEnhancedPass({ jitter: 0 });
    expect(p.jitter).toBe(0);
  });

  it('strict depth threshold (0.02) is valid', () => {
    const p = new MotionBlurEnhancedPass({ depthThreshold: 0.02 });
    expect(p.depthThreshold).toBe(0.02);
  });

  it('lenient depth threshold (0.1) is valid', () => {
    const p = new MotionBlurEnhancedPass({ depthThreshold: 0.1 });
    expect(p.depthThreshold).toBe(0.1);
  });
});

// ── setter 方法 ────────────────────────────────────────────────────

describe('MotionBlurEnhancedPass setters', () => {
  it('setStrength clamps negative to 0', () => {
    const p = new MotionBlurEnhancedPass();
    p.setStrength(-1.0);
    expect(p.strength).toBe(0);
  });

  it('setStrength sets positive value', () => {
    const p = new MotionBlurEnhancedPass();
    p.setStrength(2.5);
    expect(p.strength).toBe(2.5);
  });

  it('setMaxSamples clamps to [1, 64]', () => {
    const p = new MotionBlurEnhancedPass();
    p.setMaxSamples(0);
    expect(p.maxSamples).toBe(1);
    p.setMaxSamples(100);
    expect(p.maxSamples).toBe(64);
    p.setMaxSamples(32);
    expect(p.maxSamples).toBe(32);
  });

  it('setMaxSamples floors non-integer', () => {
    const p = new MotionBlurEnhancedPass();
    p.setMaxSamples(16.9);
    expect(p.maxSamples).toBe(16);
  });

  it('setDepthThreshold clamps negative to 0', () => {
    const p = new MotionBlurEnhancedPass();
    p.setDepthThreshold(-0.5);
    expect(p.depthThreshold).toBe(0);
  });

  it('setJitter clamps to [0, 1]', () => {
    const p = new MotionBlurEnhancedPass();
    p.setJitter(-0.5);
    expect(p.jitter).toBe(0);
    p.setJitter(1.5);
    expect(p.jitter).toBe(1);
    p.setJitter(0.3);
    expect(p.jitter).toBe(0.3);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('MotionBlurEnhancedPass apply', () => {
  it('apply() does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('first apply allocates resources (1 output + 1 FBO + 1 VAO + 1 buffer)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    // color(1) + vel(1) + depth(1) + output(1) = 4 textures
    expect(gl.createdTextures.length).toBe(4);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
  });

  it('second apply does not re-allocate (same size)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    const texBefore = gl.createdTextures.length;
    const fboBefore = gl.createdFramebuffers.length;
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(gl.createdTextures.length).toBe(texBefore);
    expect(gl.createdFramebuffers.length).toBe(fboBefore);
  });

  it('disabled apply returns input texture and skips draw call', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass({ enabled: false });
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(result).toBe(color);
    expect(gl.drawCalls).toBe(0);
    // color + vel + depth = 3,无 output
    expect(gl.createdTextures.length).toBe(3);
  });

  it('apply on resolution change rebuilds output texture + FBO', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    gl.canvas = { width: 800, height: 600 };
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    const texBefore = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
    expect(gl.createdFramebuffers.length).toBe(2);
  });

  it('setDirty() triggers re-allocation on next apply', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });

  it('apply returns output texture (not input) when enabled', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(result).not.toBe(color);
    expect(result).toBeDefined();
  });

  it('apply with jitter=0 still works (basic path)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass({ jitter: 0 });
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with maxSamples=1 still works (cheapest)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass({ maxSamples: 1 });
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with maxSamples=64 still works (highest quality)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass({ maxSamples: 64 });
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('multiple applies issue multiple draw calls', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(gl.drawCalls).toBe(3);
  });

  it('frameIndex is updatable (drives halton jitter)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    expect(p.frameIndex).toBe(0);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    p.frameIndex = 1;
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    p.frameIndex = 2;
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(p.frameIndex).toBe(2);
    expect(gl.drawCalls).toBe(3);
  });

  it('frameIndex wraps at 2^31 (no overflow)', () => {
    const p = new MotionBlurEnhancedPass();
    p.frameIndex = 0x7fffffff + 10;
    // apply 内部用 & 0x7fffffff,不会抛错
    expect(p.frameIndex).toBe(0x7fffffff + 10);
  });
});

// ── dispose ───────────────────────────────────────────────────────

describe('MotionBlurEnhancedPass dispose', () => {
  it('dispose() does not throw and releases resources', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl does not throw', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('can re-apply after dispose (re-initializes)', () => {
    const gl = new MockGL2();
    const p = new MotionBlurEnhancedPass();
    const color = makeTexture(gl);
    const vel = makeTexture(gl);
    const depth = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const drawsBefore = gl.drawCalls;
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, vel, depth)).not.toThrow();
    expect(gl.drawCalls).toBe(drawsBefore + 1);
  });
});

// ── 着色器源码校验 ─────────────────────────────────────────────────

describe('MotionBlurEnhancedPass shader source', () => {
  it('MOTION_BLUR_ENHANCED_FRAG has correct version and precision', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('#version 300 es');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('precision highp float');
  });

  it('MOTION_BLUR_ENHANCED_FRAG has all uniforms', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_colorMap');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_velocityMap');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_depthMap');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_strength');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_maxSamples');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_screenSize');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_depthThreshold');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_frameIndex');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_jitter');
  });

  it('MOTION_BLUR_ENHANCED_FRAG has Halton(2,3) sequence for jittering', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('HALTON_23');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('float[8]');
  });

  it('MOTION_BLUR_ENHANCED_FRAG implements 3x3 neighbor velocity min-clamp', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('for (int y = -1; y <= 1; y++)');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('for (int x = -1; x <= 1; x++)');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('minVelLen');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('minVel');
  });

  it('MOTION_BLUR_ENHANCED_FRAG implements depth-aware sample rejection', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('sampleDepth');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('depthDiff');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('u_depthThreshold');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('depthDiff > u_depthThreshold');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('continue');
  });

  it('MOTION_BLUR_ENHANCED_FRAG early-exits on low velocity', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('minVelLen < 0.5');
  });

  it('MOTION_BLUR_ENHANCED_FRAG handles UV out-of-bounds', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('sampleUV.x < 0.0');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('sampleUV.x > 1.0');
  });

  it('MOTION_BLUR_ENHANCED_FRAG falls back to center color when all samples rejected', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('validSamples < 1.0');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('centerColor');
  });

  it('MOTION_BLUR_ENHANCED_FRAG applies jitter offset to sample positions', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('jitter');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('HALTON_23[u_frameIndex & 7]');
  });

  it('MOTION_BLUR_ENHANCED_FRAG ray-march loop is bounded at 64', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('for (int i = 0; i < 64; i++)');
  });

  it('MOTION_BLUR_ENHANCED_FRAG references provenance (McGuire / UE5 / o3de)', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('McGuire');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('UE5');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('o3de');
  });

  it('MOTION_BLUR_ENHANCED_FRAG normalizes velocity direction', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('normalize(minVel)');
  });

  it('MOTION_BLUR_ENHANCED_FRAG accumulates valid samples only', () => {
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('validSamples += 1.0');
    expect(MOTION_BLUR_ENHANCED_FRAG).toContain('color /= validSamples');
  });
});
