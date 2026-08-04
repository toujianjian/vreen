// DOFEnhancedPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setFocus 更新与 clamp
//   3. apply() 在 mock GL 下不抛错并返回纹理
//   4. apply() 首帧分配 1 texture + 1 FBO + 1 VAO + 1 buffer + 1 program
//   5. apply() 同尺寸不重复分配
//   6. apply() 在 bokehShape 越界时不抛错(内部 clamp 0..2)
//   7. dispose() 释放内部资源
//   8. dispose() 幂等
//   9. apply() after dispose 重新分配
//  10. 纯 CPU 函数: dofReconstructViewPos / dofBokehWeight / computeCoC /
//      dofBokehRadius / dofSampleColor / dofPixel / computeDOF

import { describe, it, expect } from 'vitest';
import {
  DOFEnhancedPass,
  dofReconstructViewPos,
  dofBokehWeight,
  computeCoC,
  dofBokehRadius,
  dofSampleColor,
  dofPixel,
  computeDOF,
  DEFAULT_DOF_PARAMS,
  DOF_SAMPLES,
  type DOFParams,
  type DOFCameraParams,
} from './DOFEnhancedPass';
import { Camera } from '../../Cameras/Camera';
import { PerspectiveCamera } from '../../Cameras/PerspectiveCamera';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 支持 DOFEnhancedPass.apply 所需的全部 GL 调用表面。
// 输出 RGBA16F + HALF_FLOAT。

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

describe('DOFEnhancedPass construction', () => {
  it('defaults: focusDistance=10, focusRange=5, bokehShape=0, bokehSize=16, maxRadius=32', () => {
    const p = new DOFEnhancedPass();
    expect(p.name).toBe('dof-enhanced');
    expect(p.focusDistance).toBe(10.0);
    expect(p.focusRange).toBe(5.0);
    expect(p.bokehShape).toBe(0);
    expect(p.bokehSize).toBe(16.0);
    expect(p.maxRadius).toBe(32.0);
  });

  it('accepts all options', () => {
    const p = new DOFEnhancedPass({
      focusDistance: 20,
      focusRange: 10,
      bokehShape: 1,
      bokehSize: 24,
      maxRadius: 48,
    });
    expect(p.focusDistance).toBe(20);
    expect(p.focusRange).toBe(10);
    expect(p.bokehShape).toBe(1);
    expect(p.bokehSize).toBe(24);
    expect(p.maxRadius).toBe(48);
  });
});

// ── setFocus ────────────────────────────────────────────────────────

describe('DOFEnhancedPass.setFocus', () => {
  it('updates focusDistance and focusRange', () => {
    const p = new DOFEnhancedPass();
    p.setFocus(15, 8);
    expect(p.focusDistance).toBe(15);
    expect(p.focusRange).toBe(8);
  });

  it('clamps focusDistance to 0', () => {
    const p = new DOFEnhancedPass();
    p.setFocus(-5, 5);
    expect(p.focusDistance).toBe(0);
  });

  it('clamps focusRange to a small positive value (avoid divide-by-zero)', () => {
    const p = new DOFEnhancedPass();
    p.setFocus(10, 0);
    expect(p.focusRange).toBeGreaterThanOrEqual(0.0001);
  });

  it('clamps negative focusRange', () => {
    const p = new DOFEnhancedPass();
    p.setFocus(10, -3);
    expect(p.focusRange).toBeGreaterThanOrEqual(0.0001);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('DOFEnhancedPass apply lifecycle', () => {
  it('apply() does not throw with mock GL and returns a texture', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('color'), makeTexture('depth'), makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer + 1 program on first apply', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c1'), makeTexture('d1'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('returns the same texture across apply() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c1'), makeTexture('d1'), makeCamera());
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'), makeCamera());
    expect(t1).toBe(t2);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('does not throw with out-of-range bokehShape (clamped internally)', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass({ bokehShape: 5 });
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera())).not.toThrow();
    p.bokehShape = -1;
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera())).not.toThrow();
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('DOFEnhancedPass dispose', () => {
  it('frees texture / FBO / VAO / buffer / program after apply', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(gl.deletedTextures.length).toBe(0);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(1);
    expect(gl.deletedFramebuffers.length).toBe(1);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new DOFEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const deletedAfterDispose = gl.deletedTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'), makeCamera());
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.deletedTextures.length).toBe(deletedAfterDispose);
  });
});

// ── 纯 CPU 函数测试 ────────────────────────────────────────────────

// 单位矩阵(列主序 4×4)— 用作 inverseProjectionMatrix,使 viewPos = ndc
const IDENTITY_MAT4 = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function makeIdentityCamera(): DOFCameraParams {
  return { near: 0, far: 2, inverseProjectionMatrix: IDENTITY_MAT4 };
}

// 构造纯色 RGBA 颜色缓冲(width*height*4)
function makeSolidColor(w: number, h: number, r: number, g: number, b: number): Float32Array {
  const buf = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 1;
  }
  return buf;
}

// 构造平坦深度缓冲(所有像素同一深度)
function makeFlatDepth(w: number, h: number, d: number): Float32Array {
  const buf = new Float32Array(w * h);
  buf.fill(d);
  return buf;
}

// ── 常量 ───────────────────────────────────────────────────────────

describe('DOF constants', () => {
  it('DOF_SAMPLES = 16 (matches GPU shader)', () => {
    expect(DOF_SAMPLES).toBe(16);
  });

  it('DEFAULT_DOF_PARAMS has correct defaults', () => {
    expect(DEFAULT_DOF_PARAMS.focusDistance).toBe(10.0);
    expect(DEFAULT_DOF_PARAMS.focusRange).toBe(5.0);
    expect(DEFAULT_DOF_PARAMS.bokehShape).toBe(0);
    expect(DEFAULT_DOF_PARAMS.bokehSize).toBe(16.0);
    expect(DEFAULT_DOF_PARAMS.maxRadius).toBe(32.0);
  });
});

// ── dofReconstructViewPos ──────────────────────────────────────────

describe('dofReconstructViewPos', () => {
  it('returns [0,0,-1] for uv=(0.5,0.5) depth=0 with identity matrix', () => {
    // uv=(0.5,0.5) → ndc=(0,0,-1), depth=0 → ndc.z=-1
    // identity: viewPos = ndc = (0, 0, -1)
    const pos = dofReconstructViewPos([0.5, 0.5], 0.0, IDENTITY_MAT4);
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(-1, 5);
  });

  it('returns [0,0,1] for uv=(0.5,0.5) depth=1 with identity matrix', () => {
    // depth=1 → ndc.z=1
    const pos = dofReconstructViewPos([0.5, 0.5], 1.0, IDENTITY_MAT4);
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(1, 5);
  });

  it('maps uv corners to NDC [-1,1]', () => {
    // uv=(0,0) → ndc=(-1,-1)
    const p00 = dofReconstructViewPos([0, 0], 0.5, IDENTITY_MAT4);
    expect(p00[0]).toBeCloseTo(-1, 5);
    expect(p00[1]).toBeCloseTo(-1, 5);

    // uv=(1,1) → ndc=(1,1)
    const p11 = dofReconstructViewPos([1, 1], 0.5, IDENTITY_MAT4);
    expect(p11[0]).toBeCloseTo(1, 5);
    expect(p11[1]).toBeCloseTo(1, 5);
  });

  it('returns [0,0,0] when w component is ~0 (degenerate)', () => {
    // 构造一个使 w=0 的矩阵(最后一列全 0)
    const degenerate = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 0, // w 行全 0
    ]);
    const pos = dofReconstructViewPos([0.5, 0.5], 0.5, degenerate);
    expect(pos[0]).toBe(0);
    expect(pos[1]).toBe(0);
    expect(pos[2]).toBe(0);
  });
});

// ── dofBokehWeight ─────────────────────────────────────────────────

describe('dofBokehWeight', () => {
  it('returns 1.0 for zero offset (center)', () => {
    expect(dofBokehWeight([0, 0], 0)).toBe(1.0);
    expect(dofBokehWeight([0, 0], 1)).toBe(1.0);
    expect(dofBokehWeight([0, 0], 2)).toBe(1.0);
  });

  it('circle: returns 1.0 for |offset| <= 1', () => {
    expect(dofBokehWeight([1, 0], 0)).toBe(1.0);
    expect(dofBokehWeight([0, 1], 0)).toBe(1.0);
    expect(dofBokehWeight([0.7071, 0.7071], 0)).toBe(1.0); // r=1
  });

  it('circle: returns 0.0 for |offset| > 1', () => {
    expect(dofBokehWeight([1.001, 0], 0)).toBe(0.0);
    expect(dofBokehWeight([0.8, 0.8], 0)).toBe(0.0); // r ≈ 1.13
  });

  it('hexagon: returns 1.0 for cardinal directions at r=0.866', () => {
    // 六边形在 0°/60°/120° 方向的半径为 0.8660254
    const r = 0.8660254;
    expect(dofBokehWeight([r, 0], 1)).toBe(1.0);
    expect(dofBokehWeight([r * 0.5, r * 0.8660254], 1)).toBe(1.0); // 60°
  });

  it('hexagon: returns 0.0 beyond shape boundary', () => {
    // 在 45° 方向,六边形边界 < 1
    expect(dofBokehWeight([1, 1], 1)).toBe(0.0);
  });

  it('octagon: returns 1.0 for cardinal directions at r=0.9239', () => {
    const r = 0.9238795;
    expect(dofBokehWeight([r, 0], 2)).toBe(1.0);
    expect(dofBokehWeight([0, r], 2)).toBe(1.0);
  });

  it('octagon: returns 0.0 beyond shape boundary', () => {
    expect(dofBokehWeight([1, 1], 2)).toBe(0.0);
  });

  it('unknown shape falls back to circle (0)', () => {
    expect(dofBokehWeight([0.5, 0.5], 99)).toBe(1.0); // circle
    expect(dofBokehWeight([1.5, 0], 99)).toBe(0.0);
  });
});

// ── computeCoC ─────────────────────────────────────────────────────

describe('computeCoC', () => {
  it('returns 0 when dist == focusDistance', () => {
    expect(computeCoC(10, 10, 5)).toBe(0);
    expect(computeCoC(5, 5, 2)).toBe(0);
  });

  it('returns 0 when dist within focusRange', () => {
    // dist=12, focus=10, range=5 → |12-10|/5 = 0.4
    expect(computeCoC(12, 10, 5)).toBeCloseTo(0.4, 5);
    // dist=8 → |8-10|/5 = 0.4
    expect(computeCoC(8, 10, 5)).toBeCloseTo(0.4, 5);
  });

  it('returns 1 when dist beyond focusRange', () => {
    // dist=20, focus=10, range=5 → |20-10|/5 = 2.0 → clamp 1.0
    expect(computeCoC(20, 10, 5)).toBe(1.0);
    expect(computeCoC(0, 10, 5)).toBe(1.0);
  });

  it('handles near-zero focusRange (clamps to 1e-4)', () => {
    // focusRange=0 → range=1e-4 → coc = |10-10|/1e-4 = 0
    expect(computeCoC(10, 10, 0)).toBe(0);
    // dist slightly off → coc >> 1 → clamp 1.0
    expect(computeCoC(10.001, 10, 0)).toBe(1.0);
  });

  it('is symmetric around focusDistance', () => {
    const c1 = computeCoC(15, 10, 5);
    const c2 = computeCoC(5, 10, 5);
    expect(c1).toBeCloseTo(c2, 5);
  });

  it('never returns negative', () => {
    expect(computeCoC(-100, 10, 5)).toBe(1.0);
    expect(computeCoC(10, 10, 5)).toBeGreaterThanOrEqual(0);
  });

  it('never exceeds 1.0', () => {
    expect(computeCoC(1000, 10, 5)).toBeLessThanOrEqual(1.0);
    expect(computeCoC(0, 10, 5)).toBeLessThanOrEqual(1.0);
  });
});

// ── dofBokehRadius ─────────────────────────────────────────────────

describe('dofBokehRadius', () => {
  it('returns coc * bokehSize when within maxRadius', () => {
    expect(dofBokehRadius(0.5, 16, 32)).toBe(8); // 0.5 * 16 = 8 < 32
    expect(dofBokehRadius(1.0, 16, 32)).toBe(16); // 1.0 * 16 = 16 < 32
  });

  it('clamps to maxRadius', () => {
    expect(dofBokehRadius(1.0, 16, 10)).toBe(10); // 16 > 10 → 10
    expect(dofBokehRadius(1.0, 64, 32)).toBe(32); // 64 > 32 → 32
  });

  it('returns 0 when coc=0', () => {
    expect(dofBokehRadius(0, 16, 32)).toBe(0);
  });
});

// ── dofSampleColor ─────────────────────────────────────────────────

describe('dofSampleColor', () => {
  it('returns exact pixel color at integer UV', () => {
    // 2×2 buffer: (0,0)=red, (1,0)=green, (0,1)=blue, (1,1)=white
    const w = 2, h = 2;
    const buf = new Float32Array([
      1, 0, 0, 1, // (0,0) red
      0, 1, 0, 1, // (1,0) green
      0, 0, 1, 1, // (0,1) blue
      1, 1, 1, 1, // (1,1) white
    ]);
    // UV (0,0) → pixel (0,0) = red
    const c00 = dofSampleColor(buf, w, h, 0, 0);
    expect(c00[0]).toBeCloseTo(1, 5);
    expect(c00[1]).toBeCloseTo(0, 5);
    expect(c00[2]).toBeCloseTo(0, 5);
  });

  it('bilinearly interpolates between 2 pixels', () => {
    const w = 2, h = 1;
    const buf = new Float32Array([
      0, 0, 0, 1, // (0,0) black
      1, 1, 1, 1, // (1,0) white
    ]);
    // UV (0.5, 0) → halfway between black and white → 0.5
    const c = dofSampleColor(buf, w, h, 0.5, 0);
    expect(c[0]).toBeCloseTo(0.5, 5);
    expect(c[1]).toBeCloseTo(0.5, 5);
    expect(c[2]).toBeCloseTo(0.5, 5);
  });

  it('clamps UV to [0,1]', () => {
    const buf = new Float32Array([1, 0, 0, 1]);
    const c = dofSampleColor(buf, 1, 1, -1, 5);
    expect(c[0]).toBeCloseTo(1, 5);
  });

  it('supports RGB stride (3)', () => {
    const w = 2, h = 1;
    const buf = new Float32Array([0, 0, 0, 1, 1, 1]); // RGB RGB
    const c = dofSampleColor(buf, w, h, 1, 0, 3);
    expect(c[0]).toBeCloseTo(1, 5);
    expect(c[1]).toBeCloseTo(1, 5);
    expect(c[2]).toBeCloseTo(1, 5);
  });
});

// ── dofPixel ───────────────────────────────────────────────────────

describe('dofPixel', () => {
  it('passes through skybox pixels (depth >= 0.99999)', () => {
    const w = 4, h = 4;
    const color = makeSolidColor(w, h, 0.5, 0.5, 0.5);
    const depth = makeFlatDepth(w, h, 1.0); // skybox
    const result = dofPixel(color, depth, w, h, 0, 0, DEFAULT_DOF_PARAMS, makeIdentityCamera());
    expect(result[0]).toBeCloseTo(0.5, 5);
    expect(result[1]).toBeCloseTo(0.5, 5);
    expect(result[2]).toBeCloseTo(0.5, 5);
  });

  it('passes through in-focus pixels (radius < 0.5)', () => {
    // 用 identity 矩阵:depth=0 → ndc.z=-1 → viewPos.z=-1 → dist=1
    // focusDistance=10 → coc = |1-10|/5 = 1.8 → clamp 1.0
    // 但我们需要 coc=0 → 设 focusDistance=1
    const w = 4, h = 4;
    const color = makeSolidColor(w, h, 0.3, 0.6, 0.9);
    const depth = makeFlatDepth(w, h, 0.0); // viewPos.z = -1, dist = 1
    const params: DOFParams = { ...DEFAULT_DOF_PARAMS, focusDistance: 1.0 };
    const result = dofPixel(color, depth, w, h, 1, 1, params, makeIdentityCamera());
    // In focus → passes through original color
    expect(result[0]).toBeCloseTo(0.3, 5);
    expect(result[1]).toBeCloseTo(0.6, 5);
    expect(result[2]).toBeCloseTo(0.9, 5);
  });

  it('blurs out-of-focus pixels (solid color stays same)', () => {
    // 纯色缓冲:即散景模糊后还是同一颜色
    const w = 8, h = 8;
    const color = makeSolidColor(w, h, 0.7, 0.2, 0.4);
    // depth=0.5 → ndc.z=0 → viewPos.z=0 → dist=0
    // focusDistance=10 → coc=1 → radius=16(但 maxRadius=32, bokehSize=16)
    const depth = makeFlatDepth(w, h, 0.5);
    const result = dofPixel(color, depth, w, h, 4, 4, DEFAULT_DOF_PARAMS, makeIdentityCamera());
    // 纯色 → 模糊后仍为纯色
    expect(result[0]).toBeCloseTo(0.7, 5);
    expect(result[1]).toBeCloseTo(0.2, 5);
    expect(result[2]).toBeCloseTo(0.4, 5);
  });

  it('produces blurred color for non-uniform buffer', () => {
    // 8×8 buffer: left half red, right half blue
    const w = 8, h = 8;
    const color = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x < w / 2) {
          color[i] = 1; color[i + 1] = 0; color[i + 2] = 0; color[i + 3] = 1;
        } else {
          color[i] = 0; color[i + 1] = 0; color[i + 2] = 1; color[i + 3] = 1;
        }
      }
    }
    // 中心像素 (4,4) 在边界,模糊后应为红蓝混合
    const depth = makeFlatDepth(w, h, 0.5); // dist=0, focusDistance=10 → coc=1
    const result = dofPixel(color, depth, w, h, 4, 4, DEFAULT_DOF_PARAMS, makeIdentityCamera());
    // 应该有红和蓝的成分(不是纯红或纯蓝)
    expect(result[0]).toBeGreaterThan(0);
    expect(result[2]).toBeGreaterThan(0);
    // 红蓝之和应接近(因为对称采样)
    expect(result[0] + result[2]).toBeCloseTo(1, 1);
  });

  it('clamps bokehShape to valid range', () => {
    const w = 4, h = 4;
    const color = makeSolidColor(w, h, 0.5, 0.5, 0.5);
    const depth = makeFlatDepth(w, h, 0.5);
    const params: DOFParams = { ...DEFAULT_DOF_PARAMS, bokehShape: 99 };
    // Should not throw
    expect(() => dofPixel(color, depth, w, h, 0, 0, params, makeIdentityCamera())).not.toThrow();
  });
});

// ── computeDOF ─────────────────────────────────────────────────────

describe('computeDOF', () => {
  it('returns the same buffer reference (in-place)', () => {
    const w = 4, h = 4;
    const color = makeSolidColor(w, h, 0.5, 0.5, 0.5);
    const depth = makeFlatDepth(w, h, 1.0); // skybox
    const result = computeDOF(color, depth, w, h, DEFAULT_DOF_PARAMS, makeIdentityCamera());
    expect(result).toBe(color);
  });

  it('passes through all-skybox buffer unchanged', () => {
    const w = 4, h = 4;
    const color = makeSolidColor(w, h, 0.3, 0.4, 0.5);
    const depth = makeFlatDepth(w, h, 1.0);
    const original = new Float32Array(color);
    computeDOF(color, depth, w, h, DEFAULT_DOF_PARAMS, makeIdentityCamera());
    for (let i = 0; i < color.length; i++) {
      expect(color[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('passes through all-in-focus buffer unchanged', () => {
    const w = 4, h = 4;
    const color = makeSolidColor(w, h, 0.3, 0.4, 0.5);
    const depth = makeFlatDepth(w, h, 0.0); // dist=1
    const params: DOFParams = { ...DEFAULT_DOF_PARAMS, focusDistance: 1.0 };
    const original = new Float32Array(color);
    computeDOF(color, depth, w, h, params, makeIdentityCamera());
    for (let i = 0; i < color.length; i++) {
      expect(color[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('preserves alpha channel (stride=4)', () => {
    const w = 4, h = 4;
    const color = makeSolidColor(w, h, 0.5, 0.5, 0.5);
    // Set unique alpha values
    for (let i = 0; i < w * h; i++) color[i * 4 + 3] = 0.7;
    const depth = makeFlatDepth(w, h, 1.0); // skybox passthrough
    computeDOF(color, depth, w, h, DEFAULT_DOF_PARAMS, makeIdentityCamera());
    for (let i = 0; i < w * h; i++) {
      expect(color[i * 4 + 3]).toBeCloseTo(0.7, 5);
    }
  });

  it('processes every pixel (no exceptions)', () => {
    const w = 8, h = 8;
    const color = makeSolidColor(w, h, 0.5, 0.5, 0.5);
    const depth = makeFlatDepth(w, h, 0.5);
    expect(() => computeDOF(color, depth, w, h, DEFAULT_DOF_PARAMS, makeIdentityCamera())).not.toThrow();
  });

  it('handles non-square buffers', () => {
    const w = 16, h = 4;
    const color = makeSolidColor(w, h, 0.5, 0.5, 0.5);
    const depth = makeFlatDepth(w, h, 0.5);
    expect(() => computeDOF(color, depth, w, h, DEFAULT_DOF_PARAMS, makeIdentityCamera())).not.toThrow();
  });
});
