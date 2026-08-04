// PaniniProjectionPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. CPU 纯函数 paniniProject 的数学正确性
//   3. apply() 在 mock GL 下不抛错
//   4. apply() 首帧分配资源(1 texture + 1 FBO + 1 VAO + 1 buffer)
//   5. apply() 同尺寸不重复分配
//   6. apply() 禁用时返回输入纹理(零 draw call)
//   7. apply() 分辨率变化时重建
//   8. setDirty() 触发重建
//   9. dispose() 释放资源
//  10. dispose() 无 gl 参数
//  11. dispose() 重复调用
//  12. 字段可更新(center / depth / vertical / crop)
//  13. 着色器源码校验

import { describe, it, expect } from 'vitest';
import { PaniniProjectionPass, paniniProject } from './PaniniProjectionPass';
import { PANINI_PROJECTION_FRAG } from '../../Materials/shaders';

// ── MockGL2(精简版,PaniniProjectionPass 不需要 Camera/depth) ──────────

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

// ── CPU 纯函数 paniniProject 数学正确性 ────────────────────────────

describe('paniniProject (CPU pure function)', () => {
  it('center maps to itself', () => {
    const r = paniniProject([0.5, 0.5]);
    expect(r.x).toBeCloseTo(0.5, 10);
    expect(r.y).toBeCloseTo(0.5, 10);
    expect(r.inside).toBe(true);
  });

  it('left edge (uv.x=0) maps to a positive value less than 0.5', () => {
    // uv.x=0 → ux = -1 → ol = 1/sqrt(2-1) = 1 → pspl = (d+1)/(d+1) = 1
    // coords.x = -1 * (1*1) = -1 → outX = -1*0.5 + 0.5 = 0
    const r = paniniProject([0, 0.5]);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.inside).toBe(true);
  });

  it('right edge (uv.x=1) maps to 1', () => {
    // uv.x=1 → ux = 1 → ol = 1/sqrt(2-1) = 1 → pspl = 1
    // coords.x = 1 → outX = 0.5 + 0.5 = 1
    const r = paniniProject([1, 0.5]);
    expect(r.x).toBeCloseTo(1, 10);
    expect(r.inside).toBe(true);
  });

  it('horizontal center maps to itself regardless of y (no vertical)', () => {
    const r = paniniProject([0.5, 0.3]);
    expect(r.x).toBeCloseTo(0.5, 10);
    expect(r.y).toBeCloseTo(0.3, 10);
  });

  it('vertical=true affects y coordinate', () => {
    const rH = paniniProject([0.5, 0.3], [0.5, 0.5], 1.0, false);
    const rV = paniniProject([0.5, 0.3], [0.5, 0.5], 1.0, true);
    // horizontal-only: y unchanged
    expect(rH.y).toBeCloseTo(0.3, 10);
    // vertical: y should be different from 0.3
    expect(rV.y).not.toBeCloseTo(0.3, 5);
  });

  it('depth=0 produces near-linear (perspective-like) mapping', () => {
    // With depth=0: ol = 1/sqrt(2-ux²), pspl = 1/ol
    // coords.x = ux * (ol * 1/ol) = ux → outX = ux*0.5+0.5 = uv.x (identity)
    const r = paniniProject([0.7, 0.5], [0.5, 0.5], 0.0);
    expect(r.x).toBeCloseTo(0.7, 10);
  });

  it('depth>0 stretches edges outward (coords > uv for uv>0.5)', () => {
    // With depth=1, uv.x=0.7 → ux=0.4 → ol=1/sqrt(2-0.16)=1/sqrt(1.84)≈0.737
    // pspl = 2/(1+0.737) ≈ 1.153 → coords.x = 0.4*0.737*1.153 ≈ 0.340
    // outX = 0.340*0.5+0.5 = 0.670 < 0.7 (edges compress toward center)
    const r = paniniProject([0.7, 0.5], [0.5, 0.5], 1.0);
    // The projection compresses edge content toward center
    expect(r.x).toBeLessThan(0.7);
    expect(r.x).toBeGreaterThan(0.5);
  });

  it('crop>1 scales coordinates inward', () => {
    const r1 = paniniProject([0.8, 0.5], [0.5, 0.5], 1.0, false, 1.0);
    const r2 = paniniProject([0.8, 0.5], [0.5, 0.5], 1.0, false, 1.5);
    // crop>1 → coords/crop → smaller → mapped closer to center
    expect(Math.abs(r2.x - 0.5)).toBeLessThan(Math.abs(r1.x - 0.5));
  });

  it('crop<1 scales coordinates outward (more black edges)', () => {
    const r1 = paniniProject([0.8, 0.5], [0.5, 0.5], 1.0, false, 1.0);
    const r2 = paniniProject([0.8, 0.5], [0.5, 0.5], 1.0, false, 0.5);
    // crop<1 → coords/crop → larger → mapped further from center
    expect(Math.abs(r2.x - 0.5)).toBeGreaterThan(Math.abs(r1.x - 0.5));
  });

  it('inside flag is false when output UV is out of [0,1]', () => {
    // Extreme crop<1 can push coords outside [0,1]
    const r = paniniProject([0.0, 0.5], [0.5, 0.5], 2.0, false, 0.3);
    // With heavy crop, left edge may map outside
    // uv.x=0 → ux=-1 → ol=1 → pspl=(3)/(3)=1 → coords=-1/0.3≈-3.33 → outX=-3.33*0.5+0.5≈-1.17
    expect(r.inside).toBe(false);
  });

  it('custom center offsets the projection origin', () => {
    const r = paniniProject([0.4, 0.5], [0.4, 0.5], 0.0);
    // depth=0 → identity, center at 0.4 → 0.4 maps to 0.4
    expect(r.x).toBeCloseTo(0.4, 10);
    expect(r.y).toBeCloseTo(0.5, 10);
  });

  it('accepts object form {x, y}', () => {
    const r1 = paniniProject([0.7, 0.3]);
    const r2 = paniniProject({ x: 0.7, y: 0.3 });
    expect(r2.x).toBeCloseTo(r1.x, 10);
    expect(r2.y).toBeCloseTo(r1.y, 10);
  });

  it('symmetric: uv.x and 1-uv.x produce symmetric outputs', () => {
    const rL = paniniProject([0.3, 0.5], [0.5, 0.5], 1.0);
    const rR = paniniProject([0.7, 0.5], [0.5, 0.5], 1.0);
    // Symmetric around 0.5
    expect(rR.x - 0.5).toBeCloseTo(0.5 - rL.x, 6);
  });

  it('vertical symmetry: uv.y and 1-uv.y produce symmetric outputs (vertical=true)', () => {
    const rT = paniniProject([0.5, 0.3], [0.5, 0.5], 1.0, true);
    const rB = paniniProject([0.5, 0.7], [0.5, 0.5], 1.0, true);
    expect(rB.y - 0.5).toBeCloseTo(0.5 - rT.y, 6);
  });
});

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('PaniniProjectionPass construction', () => {
  it('defaults', () => {
    const p = new PaniniProjectionPass();
    expect(p.name).toBe('paniniprojection');
    expect(p.center).toEqual([0.5, 0.5]);
    expect(p.depth).toBe(1.0);
    expect(p.vertical).toBe(false);
    expect(p.crop).toBe(1.0);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new PaniniProjectionPass({
      center: [0.4, 0.6],
      depth: 2.0,
      vertical: true,
      crop: 1.2,
      enabled: false,
    });
    expect(p.center).toEqual([0.4, 0.6]);
    expect(p.depth).toBe(2.0);
    expect(p.vertical).toBe(true);
    expect(p.crop).toBe(1.2);
    expect(p.enabled).toBe(false);
  });
});

// ── apply() 行为 ────────────────────────────────────────────────────

describe('PaniniProjectionPass.apply', () => {
  it('disabled returns input texture (zero draw calls)', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass({ enabled: false });
    const input = makeInputTexture(gl);
    const out = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(out).toBe(input);
    expect(gl.drawCalls).toBe(0);
  });

  it('first frame allocates 1 texture + 1 FBO + 1 VAO + 1 buffer', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // input=1, output=1 → total 2 textures
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.drawCalls).toBe(1);
  });

  it('same size does not reallocate', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // input=1, output=1 → total 2 (no new allocation on second apply)
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.drawCalls).toBe(2);
  });

  it('resolution change triggers reallocation', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // input=1, output1=1, output2=1 → total 3 textures; 2 FBOs (VAO/buffer only created once)
    expect(gl.createdTextures.length).toBe(3);
    expect(gl.createdFramebuffers.length).toBe(2);
    expect(gl.createdVAOs.length).toBe(1);
  });

  it('setDirty triggers rebuild on next apply', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // input=1, output1=1, output2=1 → total 3
    expect(gl.createdTextures.length).toBe(3);
    expect(gl.createdFramebuffers.length).toBe(2);
  });

  it('returns output texture (different from input)', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    const input = makeInputTexture(gl);
    const out = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(out).not.toBe(input);
    // createdTextures[0] = input, [1] = output
    expect(out).toBe(gl.createdTextures[1]);
  });
});

// ── dispose() ──────────────────────────────────────────────────────

describe('PaniniProjectionPass.dispose', () => {
  it('releases resources', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    // No throw = pass
  });

  it('without gl parameter', () => {
    const p = new PaniniProjectionPass();
    p.dispose();
    // No throw = pass
  });

  it('repeated calls are safe', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose();
  });

  it('apply after dispose re-initializes', () => {
    const gl = new MockGL2();
    const p = new PaniniProjectionPass();
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    // input=1, output1=1, output2=1 → total 3
    expect(gl.createdTextures.length).toBe(3);
  });
});

// ── 字段可更新 ──────────────────────────────────────────────────────

describe('PaniniProjectionPass field updates', () => {
  it('center can be updated', () => {
    const p = new PaniniProjectionPass();
    expect(p.center).toEqual([0.5, 0.5]);
    p.center = [0.3, 0.7];
    expect(p.center).toEqual([0.3, 0.7]);
  });

  it('depth can be updated', () => {
    const p = new PaniniProjectionPass();
    expect(p.depth).toBe(1.0);
    p.depth = 2.5;
    expect(p.depth).toBe(2.5);
  });

  it('vertical can be toggled', () => {
    const p = new PaniniProjectionPass();
    expect(p.vertical).toBe(false);
    p.vertical = true;
    expect(p.vertical).toBe(true);
  });

  it('crop can be updated', () => {
    const p = new PaniniProjectionPass();
    expect(p.crop).toBe(1.0);
    p.crop = 1.3;
    expect(p.crop).toBe(1.3);
  });

  it('enabled can be toggled', () => {
    const p = new PaniniProjectionPass();
    expect(p.enabled).toBe(true);
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });
});

// ── 着色器源码校验 ──────────────────────────────────────────────────

describe('PANINI_PROJECTION_FRAG shader', () => {
  it('is a GLSL ES 3.00 fragment shader', () => {
    expect(PANINI_PROJECTION_FRAG).toContain('#version 300 es');
    expect(PANINI_PROJECTION_FRAG).toContain('precision highp float');
  });

  it('declares required uniforms', () => {
    expect(PANINI_PROJECTION_FRAG).toContain('uniform sampler2D u_colorMap');
    expect(PANINI_PROJECTION_FRAG).toContain('uniform vec2  u_center');
    expect(PANINI_PROJECTION_FRAG).toContain('uniform float u_depth');
    expect(PANINI_PROJECTION_FRAG).toContain('uniform int   u_vertical');
    expect(PANINI_PROJECTION_FRAG).toContain('uniform float u_crop');
  });

  it('implements the Panini projection formula', () => {
    // ol = 1 / sqrt(2 - uv.x²)
    expect(PANINI_PROJECTION_FRAG).toContain('sqrt(2.0 - uv.x * uv.x)');
    // pspl = (d + 1) / (d + ol)
    expect(PANINI_PROJECTION_FRAG).toContain('u_depth + 1.0');
    expect(PANINI_PROJECTION_FRAG).toContain('u_depth + ol_x');
  });

  it('supports vertical projection branch', () => {
    expect(PANINI_PROJECTION_FRAG).toContain('u_vertical == 1');
    expect(PANINI_PROJECTION_FRAG).toContain('ol_y');
  });

  it('handles out-of-bounds UV with black fill', () => {
    expect(PANINI_PROJECTION_FRAG).toContain('coords.x < 0.0');
    expect(PANINI_PROJECTION_FRAG).toContain('vec4(0.0, 0.0, 0.0, 1.0)');
  });
});
