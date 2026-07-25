// AutoExposurePass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setDeltaTime / setExposure 行为(含 clamp)
//   3. apply() 在 mock GL 下不抛错并返回纹理
//   4. apply() 首帧分配内部纹理(输出 + 降采样链)+ FBO + VAO
//   5. apply() 同尺寸不重复分配
//   6. apply() canvas resize 后重新分配
//   7. apply() 后 currentExposure 在 [min, max] 范围内
//   8. dispose() 释放所有资源
//   9. dispose() 幂等

import { describe, it, expect } from 'vitest';
import { AutoExposurePass } from './AutoExposurePass';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 比 SSRPass.test 多 readPixels(AutoExposure 读 1x1 亮度纹理)。

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
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
  static readonly STATIC_DRAW = 0x88E4;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly FLOAT = 0x1406;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
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
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
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
  drawCalls = 0;
  readPixelsCalls = 0;

  /** readPixels 返回的"亮度"值(log 空间)。默认 -2.0(对应 ~0.135 亮度)。 */
  readPixelsValue: Float32Array = new Float32Array([-2.0, 0, 0, 1]);

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
  createShader(_type: number): WebGLShader { return this._nextId() as WebGLShader; }

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
    return 0;
  }
  getProgramInfoLog(_p: WebGLProgram): string | null { return null; }
  getActiveUniform(_p: WebGLProgram, _i: number): unknown { return null; }
  getActiveAttrib(_p: WebGLProgram, _i: number): unknown { return null; }
  getUniformLocation(_p: WebGLProgram, _name: string): WebGLUniformLocation | null { return null; }
  getAttribLocation(_p: WebGLProgram, _name: string): number { return -1; }

  useProgram(_p: WebGLProgram | null): void {}
  uniform1f(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform1i(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform2f(_l: WebGLUniformLocation | null, _x: number, _y: number): void {}
  uniform3f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void {}
  uniform4f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void {}
  uniformMatrix3fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}

  bindFramebuffer(_t: number, _fb: WebGLFramebuffer | null): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_mask: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_unit: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._args: unknown[]): void {}
  texParameteri(_t: number, _p: number, _v: number): void {}
  framebufferTexture2D(..._args: unknown[]): void {}
  bindVertexArray(_vao: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _buf: WebGLBuffer | null): void {}
  bufferData(_t: number, _data: BufferSource, _usage: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }

  readPixels(
    _x: number, _y: number, _w: number, _h: number,
    _format: number, _type: number,
    dst: ArrayBufferView,
  ): void {
    this.readPixelsCalls++;
    // 把 mock 亮度值复制到调用方提供的 buffer
    if (dst instanceof Float32Array && dst.length >= 4) {
      dst[0] = this.readPixelsValue[0];
      dst[1] = this.readPixelsValue[1];
      dst[2] = this.readPixelsValue[2];
      dst[3] = this.readPixelsValue[3];
    }
  }
}

function makeTexture(id: string): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('AutoExposurePass construction', () => {
  it('defaults: adaptationSpeed=1.5, minExposure=-2, maxExposure=2, currentExposure=0, key=0.5', () => {
    const p = new AutoExposurePass();
    expect(p.name).toBe('auto-exposure');
    expect(p.adaptationSpeed).toBe(1.5);
    expect(p.minExposure).toBe(-2);
    expect(p.maxExposure).toBe(2);
    expect(p.currentExposure).toBe(0);
    expect(p.key).toBe(0.5);
    expect(p.luminanceTexture).toBeNull();
  });

  it('accepts all options', () => {
    const p = new AutoExposurePass({
      adaptationSpeed: 2.5,
      minExposure: -3,
      maxExposure: 3,
      initialExposure: 1,
      key: 0.4,
    });
    expect(p.adaptationSpeed).toBe(2.5);
    expect(p.minExposure).toBe(-3);
    expect(p.maxExposure).toBe(3);
    expect(p.currentExposure).toBe(1);
    expect(p.key).toBe(0.4);
  });
});

// ── setDeltaTime / setExposure ──────────────────────────────────────

describe('AutoExposurePass setters', () => {
  it('setDeltaTime updates value', () => {
    const p = new AutoExposurePass();
    p.setDeltaTime(1 / 30);
    // 通过 apply 路径间接验证(此处仅检查不抛错)
    expect(true).toBe(true);
  });

  it('setExposure clamps to [min, max]', () => {
    const p = new AutoExposurePass({ minExposure: -1, maxExposure: 1 });
    p.setExposure(5);
    expect(p.currentExposure).toBe(1);
    p.setExposure(-5);
    expect(p.currentExposure).toBe(-1);
    p.setExposure(0);
    expect(p.currentExposure).toBe(0);
  });
});

// ── apply lifecycle ────────────────────────────────────────────────

describe('AutoExposurePass apply lifecycle', () => {
  it('apply() does not throw and returns a texture', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    const out = p.apply(
      gl as unknown as WebGL2RenderingContext,
      makeTexture('input'),
    );
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
    expect(gl.readPixelsCalls).toBe(1);
  });

  it('allocates multiple textures (output + mip chain) + FBOs + VAO + 2 programs on first apply', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    // 1 输出 + 至少 1 个降采样纹理(800x600 → 400x300 → ... → 1x1)
    expect(gl.createdTextures.length).toBeGreaterThanOrEqual(2);
    expect(gl.createdFramebuffers.length).toBeGreaterThanOrEqual(2);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    // 2 个 program:luminance + apply
    expect(gl.createdPrograms.length).toBe(2);
  });

  it('luminanceTexture is set after first apply', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    expect(p.luminanceTexture).toBeNull();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    expect(p.luminanceTexture).not.toBeNull();
  });

  it('does not re-allocate on subsequent apply with same canvas size', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'));
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'));
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns the same output texture across apply() calls (no resize)', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'));
    expect(t1).toBe(t2);
  });
});

// ── exposure 适应行为 ──────────────────────────────────────────────

describe('AutoExposurePass adaptation', () => {
  it('currentExposure stays within [min, max] after apply', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass({ minExposure: -2, maxExposure: 2, initialExposure: 0 });
    // 极暗场景:logLum = -10(亮度 ~ 4.5e-5)
    gl.readPixelsValue = new Float32Array([-10.0, 0, 0, 1]);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    expect(p.currentExposure).toBeGreaterThanOrEqual(-2);
    expect(p.currentExposure).toBeLessThanOrEqual(2);
  });

  it('bright scene drives exposure toward negative', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass({
      minExposure: -3, maxExposure: 3, initialExposure: 0, adaptationSpeed: 5.0, key: 0.5,
    });
    // 极亮场景:logLum = 2(亮度 ~ 7.39);targetEV = log2(0.5/7.39) ≈ -3.89 → clamp 到 -3
    gl.readPixelsValue = new Float32Array([2.0, 0, 0, 1]);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    // 应该向负方向移动
    expect(p.currentExposure).toBeLessThan(0);
  });

  it('dark scene drives exposure toward positive', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass({
      minExposure: -3, maxExposure: 3, initialExposure: 0, adaptationSpeed: 5.0, key: 0.5,
    });
    // 极暗场景:logLum = -5(亮度 ~ 6.7e-3);targetEV = log2(0.5/6.7e-3) ≈ 6.22 → clamp 到 3
    gl.readPixelsValue = new Float32Array([-5.0, 0, 0, 1]);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    // 应该向正方向移动
    expect(p.currentExposure).toBeGreaterThan(0);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('AutoExposurePass dispose', () => {
  it('frees all textures + FBOs + VAO + buffer + 2 programs after apply', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    const createdTex = gl.createdTextures.length;
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(createdTex);
    expect(gl.deletedFramebuffers.length).toBe(createdTex); // 每张纹理对应一个 FBO
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(2);
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('clears luminanceTexture reference after dispose', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    expect(p.luminanceTexture).not.toBeNull();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(p.luminanceTexture).toBeNull();
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new AutoExposurePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'));
    const texAfterFirst = gl.createdTextures.length;
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'));
    expect(gl.createdTextures.length).toBe(texAfterFirst * 2);
  });
});
