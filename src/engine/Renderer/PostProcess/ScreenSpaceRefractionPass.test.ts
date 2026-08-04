// ScreenSpaceRefractionPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. apply() 在 mock GL 下不抛错
//   3. apply() 首帧分配资源(1 output texture + 1 FBO + 1 VAO + 1 buffer)
//   4. apply() 同尺寸不重复分配
//   5. apply() 分辨率变化时重建
//   6. setDirty() 触发重建
//   7. dispose() 释放资源
//   8. dispose() 无 gl 参数
//   9. dispose() 重复调用
//  10. 字段可更新(ior / strength / chromaticDispersion / absorption)
//  11. 着色器源码校验

import { describe, it, expect } from 'vitest';
import { ScreenSpaceRefractionPass } from './ScreenSpaceRefractionPass';
import { SCREEN_SPACE_REFRACTION_FRAG } from '../../Materials/shaders';

// ── MockGL2(多纹理版,需 TEXTURE1 + uniform3f) ──────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly RGBA = 0x1908;
  static readonly RGBA16F = 0x881A;
  static readonly HALF_FLOAT = 0x140B;
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
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
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

describe('ScreenSpaceRefractionPass construction', () => {
  it('defaults', () => {
    const p = new ScreenSpaceRefractionPass();
    expect(p.name).toBe('screenspacerefraction');
    expect(p.ior).toBe(1.33);
    expect(p.strength).toBe(1.0);
    expect(p.chromaticDispersion).toBe(0);
    expect(p.absorptionColor).toEqual([1, 1, 1]);
    expect(p.absorptionScale).toBe(0);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new ScreenSpaceRefractionPass({
      ior: 1.5,
      strength: 1.5,
      chromaticDispersion: 0.03,
      absorptionColor: [0.4, 0.9, 0.4],
      absorptionScale: 1.5,
      enabled: false,
    });
    expect(p.ior).toBe(1.5);
    expect(p.strength).toBe(1.5);
    expect(p.chromaticDispersion).toBe(0.03);
    expect(p.absorptionColor).toEqual([0.4, 0.9, 0.4]);
    expect(p.absorptionScale).toBe(1.5);
    expect(p.enabled).toBe(false);
  });

  it('ior is updatable', () => {
    const p = new ScreenSpaceRefractionPass();
    expect(p.ior).toBe(1.33);
    p.ior = 2.42; // diamond
    expect(p.ior).toBe(2.42);
  });

  it('strength is updatable', () => {
    const p = new ScreenSpaceRefractionPass();
    p.strength = 2.0;
    expect(p.strength).toBe(2.0);
  });

  it('chromaticDispersion is updatable', () => {
    const p = new ScreenSpaceRefractionPass();
    p.chromaticDispersion = 0.05;
    expect(p.chromaticDispersion).toBe(0.05);
  });

  it('absorptionColor is updatable', () => {
    const p = new ScreenSpaceRefractionPass();
    p.absorptionColor = [0.7, 0.2, 0.3]; // red wine
    expect(p.absorptionColor).toEqual([0.7, 0.2, 0.3]);
  });

  it('absorptionScale is updatable', () => {
    const p = new ScreenSpaceRefractionPass();
    p.absorptionScale = 2.5;
    expect(p.absorptionScale).toBe(2.5);
  });

  it('enabled is updatable', () => {
    const p = new ScreenSpaceRefractionPass();
    expect(p.enabled).toBe(true);
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });

  it('water IOR preset is valid', () => {
    const p = new ScreenSpaceRefractionPass({ ior: 1.33 });
    expect(p.ior).toBeGreaterThan(1.0);
  });

  it('diamond IOR preset is valid', () => {
    const p = new ScreenSpaceRefractionPass({ ior: 2.42 });
    expect(p.ior).toBeGreaterThan(2.0);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('ScreenSpaceRefractionPass apply', () => {
  it('apply() does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, refr)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('first apply allocates resources (1 output + 1 FBO + 1 VAO + 1 buffer)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    // 2 input textures + 1 output = 3 total
    expect(gl.createdTextures.length).toBe(3);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
  });

  it('second apply does not re-allocate (same size)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    const texBefore = gl.createdTextures.length;
    const fboBefore = gl.createdFramebuffers.length;
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    expect(gl.createdTextures.length).toBe(texBefore);
    expect(gl.createdFramebuffers.length).toBe(fboBefore);
  });

  it('apply returns output texture (not input)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    expect(result).not.toBe(color);
    expect(result).not.toBe(refr);
    expect(result).toBeDefined();
  });

  it('apply on resolution change rebuilds output texture + FBO', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    gl.canvas = { width: 800, height: 600 };
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    const texBefore = gl.createdTextures.length;
    gl.canvas = { width: 1280, height: 720 };
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
    expect(gl.createdFramebuffers.length).toBe(2);
  });

  it('setDirty() triggers re-allocation on next apply', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });

  it('apply with chromaticDispersion > 0 still works (dispersion path)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass({ chromaticDispersion: 0.04, ior: 1.5 });
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, refr)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with absorption still works', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass({
      absorptionColor: [0.4, 0.9, 0.4],
      absorptionScale: 2.0,
    });
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, refr)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('multiple applies issue multiple draw calls', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    expect(gl.drawCalls).toBe(3);
  });

  it('disabled apply still renders passthrough (returns output texture)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass({ enabled: false });
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    // 即使禁用,pass 仍渲染(着色器内 u_enabled==0 走 passthrough),返回 output
    expect(result).toBeDefined();
    expect(gl.drawCalls).toBe(1);
  });
});

// ── dispose ───────────────────────────────────────────────────────

describe('ScreenSpaceRefractionPass dispose', () => {
  it('dispose() does not throw and releases resources', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl does not throw', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('can re-apply after dispose (re-initializes)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceRefractionPass();
    const color = makeTexture(gl);
    const refr = makeTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, color, refr);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const drawsBefore = gl.drawCalls;
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, color, refr)).not.toThrow();
    expect(gl.drawCalls).toBe(drawsBefore + 1);
  });
});

// ── 着色器源码校验 ─────────────────────────────────────────────────

describe('ScreenSpaceRefractionPass shader source', () => {
  it('SCREEN_SPACE_REFRACTION_FRAG has correct version and precision', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('#version 300 es');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('precision highp float');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG has all uniforms', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_colorMap');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_refractionMap');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_ior');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_strength');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_chromaticDispersion');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_absorptionColor');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_absorptionScale');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_enabled');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG uses GLSL refract()', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('refract(I, n, eta)');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG computes eta = 1 / IOR', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('1.0 / max(u_ior');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG decodes normal from [0,1] to [-1,1]', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('* 2.0 - 1.0');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('normalize');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG has chromatic dispersion branch (3-channel)', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_chromaticDispersion <= 0.0');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('etaR');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('etaG');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('etaB');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG blue channel has higher IOR (more bending)', () => {
    // etaB = 1/(ior+disp) → smaller eta → more bending for blue
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_ior + disp');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_ior - disp');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG clamps UVs to [0,1]', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('clamp(v_uv + offset');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG implements Beer-Lambert absorption (exp)', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('absorption');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('exp(');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('1.0 - u_absorptionColor');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG uses mask as thickness proxy', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('refrData.a');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('* mask');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG passthrough on mask <= 0', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('refrData.a <= 0.0');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('return');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG disables cleanly (u_enabled == 0 passthrough)', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('u_enabled == 0');
  });

  it('SCREEN_SPACE_REFRACTION_FRAG references provenance (UE5 / o3de / three.js)', () => {
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('UE5');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('o3de');
    expect(SCREEN_SPACE_REFRACTION_FRAG).toContain('three.js');
  });
});
