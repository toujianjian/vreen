// LookModificationPass 单元测试。
//
// 覆盖:
//   1. ascCDL() 纯函数数学正确性(恒等变换 / Slope / Offset / Power / Saturation)
//   2. isIdentityCDL() 检测
//   3. 构造默认值与选项覆盖
//   4. apply() 在 mock GL 下不抛错
//   5. apply() 首帧分配资源(1 output texture + 1 FBO + 1 VAO + 1 buffer)
//   6. apply() 同尺寸不重复分配
//   7. apply() 禁用 / 恒等变换返回输入纹理(零 draw call)
//   8. apply() 分辨率变化时重建
//   9. setDirty() 触发重建
//  10. dispose() 释放资源 / 重复调用安全 / apply 后重新初始化
//  11. 字段可更新(slope / offset / power / saturation / lumaWeights / enabled)
//  12. 着色器源码校验

import { describe, it, expect } from 'vitest';
import {
  LookModificationPass,
  ascCDL,
  isIdentityCDL,
  REC709_LUMA,
  type CDLColor,
} from './LookModificationPass';
import { LOOK_MODIFICATION_FRAG } from '../../Materials/shaders';

// ── MockGL2(精简版,与 LensDistortionPass.test.ts 同构) ──────────────

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

// ── ascCDL 纯函数 ──────────────────────────────────────────────────

describe('ascCDL (CPU pure function)', () => {
  it('identity transform returns input unchanged', () => {
    const out = ascCDL([0.5, 0.4, 0.3]);
    expect(out[0]).toBeCloseTo(0.5, 10);
    expect(out[1]).toBeCloseTo(0.4, 10);
    expect(out[2]).toBeCloseTo(0.3, 10);
  });

  it('default params (no args) is identity', () => {
    const out = ascCDL([0.7, 0.2, 0.9], {});
    expect(out[0]).toBeCloseTo(0.7, 10);
    expect(out[1]).toBeCloseTo(0.2, 10);
    expect(out[2]).toBeCloseTo(0.9, 10);
  });

  it('slope=2 doubles all channels', () => {
    const out = ascCDL([0.5, 0.4, 0.3], { slope: [2, 2, 2] });
    expect(out[0]).toBeCloseTo(1.0, 10);
    expect(out[1]).toBeCloseTo(0.8, 10);
    expect(out[2]).toBeCloseTo(0.6, 10);
  });

  it('slope per-channel multiplies independently', () => {
    const out = ascCDL([0.5, 0.5, 0.5], { slope: [2, 1, 0.5] });
    expect(out[0]).toBeCloseTo(1.0, 10);
    expect(out[1]).toBeCloseTo(0.5, 10);
    expect(out[2]).toBeCloseTo(0.25, 10);
  });

  it('offset adds to each channel', () => {
    const out = ascCDL([0.5, 0.4, 0.3], { offset: [0.1, 0.2, 0.3] });
    // saturation default = 1, so out = (0.6, 0.6, 0.6) luma-mixed is identity
    // luma = 0.6*0.2126 + 0.6*0.7152 + 0.6*0.0722 = 0.6
    // out = luma + 1*(out - luma) = out
    expect(out[0]).toBeCloseTo(0.6, 10);
    expect(out[1]).toBeCloseTo(0.6, 10);
    expect(out[2]).toBeCloseTo(0.6, 10);
  });

  it('offset with per-channel differences changes color', () => {
    const out = ascCDL([0.5, 0.5, 0.5], { offset: [0.1, 0.0, -0.1] });
    // out before sat: (0.6, 0.5, 0.4)
    // luma = 0.6*0.2126 + 0.5*0.7152 + 0.4*0.0722 = 0.12756 + 0.3576 + 0.02888 = 0.51404
    // sat=1: out = luma + 1*(out - luma) = out (unchanged)
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.4, 6);
  });

  it('power=2 squares each channel', () => {
    const out = ascCDL([0.5, 0.4, 0.3], { power: [2, 2, 2] });
    // out before sat: (0.25, 0.16, 0.09)
    // luma = 0.25*0.2126 + 0.16*0.7152 + 0.09*0.0722
    //      = 0.05315 + 0.11443 + 0.006498 = 0.17408
    // sat=1: out unchanged
    expect(out[0]).toBeCloseTo(0.25, 6);
    expect(out[1]).toBeCloseTo(0.16, 6);
    expect(out[2]).toBeCloseTo(0.09, 6);
  });

  it('power per-channel applies independently', () => {
    const out = ascCDL([0.5, 0.5, 0.5], { power: [2, 1, 0.5] });
    // out before sat: (0.25, 0.5, sqrt(0.5)≈0.7071)
    expect(out[0]).toBeCloseTo(0.25, 4);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.7071, 4);
  });

  it('saturation=0 produces grayscale (luma)', () => {
    const out = ascCDL([0.7, 0.2, 0.9], { saturation: 0 });
    const luma = 0.7 * 0.2126 + 0.2 * 0.7152 + 0.9 * 0.0722;
    expect(out[0]).toBeCloseTo(luma, 6);
    expect(out[1]).toBeCloseTo(luma, 6);
    expect(out[2]).toBeCloseTo(luma, 6);
  });

  it('saturation=2 doubles deviation from luma', () => {
    const color: CDLColor = [0.7, 0.2, 0.9];
    const luma = 0.7 * 0.2126 + 0.2 * 0.7152 + 0.9 * 0.0722;
    const out = ascCDL(color, { saturation: 2 });
    // out = luma + 2*(in - luma)
    expect(out[0]).toBeCloseTo(luma + 2 * (0.7 - luma), 6);
    expect(out[1]).toBeCloseTo(luma + 2 * (0.2 - luma), 6);
    expect(out[2]).toBeCloseTo(luma + 2 * (0.9 - luma), 6);
  });

  it('black stays black under identity', () => {
    const out = ascCDL([0, 0, 0]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('black with slope=2 stays black', () => {
    const out = ascCDL([0, 0, 0], { slope: [2, 2, 2] });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('black with offset=0.5 becomes gray', () => {
    const out = ascCDL([0, 0, 0], { offset: [0.5, 0.5, 0.5] });
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
  });

  it('negative input clamped to 0 before pow (no NaN)', () => {
    // negative * positive slope = negative; max(0) clamps; pow(0, P) = 0
    const out = ascCDL([-0.5, -0.5, -0.5], { power: [2, 2, 2] });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('negative input with negative offset clamped to 0', () => {
    const out = ascCDL([-0.5, -0.5, -0.5], { offset: [-0.5, -0.5, -0.5] });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('combined SOP+Sat produces expected result', () => {
    // color=(0.5,0.5,0.5), S=(1.2,1,0.8), O=(-0.1,0,0.1), P=(1,1,1), sat=1.2
    // step1: (0.5*1.2-0.1, 0.5*1+0, 0.5*0.8+0.1) = (0.5, 0.5, 0.5)
    // step2: power=1, unchanged: (0.5, 0.5, 0.5)
    // step3: luma = 0.5; sat=1.2: out = 0.5 + 1.2*(0.5-0.5) = 0.5
    const out = ascCDL([0.5, 0.5, 0.5], {
      slope: [1.2, 1, 0.8],
      offset: [-0.1, 0, 0.1],
      power: [1, 1, 1],
      saturation: 1.2,
    });
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
  });

  it('combined SOP+Sat with distinct channels', () => {
    // color=(0.8,0.4,0.2), S=(1,1,1), O=(0,0,0), P=(1,1,1), sat=0.5
    // step1-2: unchanged: (0.8,0.4,0.2)
    // step3: luma = 0.8*0.2126 + 0.4*0.7152 + 0.2*0.0722 = 0.17008+0.28608+0.01444 = 0.4706
    //        sat=0.5: out = luma + 0.5*(in - luma)
    const out = ascCDL([0.8, 0.4, 0.2], { saturation: 0.5 });
    const luma = 0.8 * 0.2126 + 0.4 * 0.7152 + 0.2 * 0.0722;
    expect(out[0]).toBeCloseTo(luma + 0.5 * (0.8 - luma), 6);
    expect(out[1]).toBeCloseTo(luma + 0.5 * (0.4 - luma), 6);
    expect(out[2]).toBeCloseTo(luma + 0.5 * (0.2 - luma), 6);
  });

  it('custom luma weights (Rec601) used for saturation', () => {
    const rec601: CDLColor = [0.299, 0.587, 0.114];
    const out = ascCDL([0.8, 0.4, 0.2], { saturation: 0 }, rec601);
    const luma = 0.8 * 0.299 + 0.4 * 0.587 + 0.2 * 0.114;
    expect(out[0]).toBeCloseTo(luma, 6);
    expect(out[1]).toBeCloseTo(luma, 6);
    expect(out[2]).toBeCloseTo(luma, 6);
  });

  it('HDR input (>1) handled correctly with slope', () => {
    const out = ascCDL([2.0, 1.5, 1.0], { slope: [0.5, 0.5, 0.5] });
    // out = (1.0, 0.75, 0.5), sat=1 unchanged
    expect(out[0]).toBeCloseTo(1.0, 6);
    expect(out[1]).toBeCloseTo(0.75, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
  });

  it('HDR input with power compression', () => {
    const out = ascCDL([4.0, 4.0, 4.0], { power: [0.5, 0.5, 0.5] });
    // out = sqrt(4) = 2
    expect(out[0]).toBeCloseTo(2.0, 6);
    expect(out[1]).toBeCloseTo(2.0, 6);
    expect(out[2]).toBeCloseTo(2.0, 6);
  });
});

// ── isIdentityCDL ─────────────────────────────────────────────────

describe('isIdentityCDL', () => {
  it('default params (undefined) is identity', () => {
    expect(isIdentityCDL({})).toBe(true);
  });

  it('explicit defaults is identity', () => {
    expect(isIdentityCDL({
      slope: [1, 1, 1],
      offset: [0, 0, 0],
      power: [1, 1, 1],
      saturation: 1,
    })).toBe(true);
  });

  it('non-unit slope is not identity', () => {
    expect(isIdentityCDL({ slope: [1.1, 1, 1] })).toBe(false);
  });

  it('non-zero offset is not identity', () => {
    expect(isIdentityCDL({ offset: [0, 0.01, 0] })).toBe(false);
  });

  it('non-unit power is not identity', () => {
    expect(isIdentityCDL({ power: [1, 0.9, 1] })).toBe(false);
  });

  it('non-unit saturation is not identity', () => {
    expect(isIdentityCDL({ saturation: 1.1 })).toBe(false);
  });
});

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('LookModificationPass construction', () => {
  it('defaults', () => {
    const p = new LookModificationPass();
    expect(p.name).toBe('look-modification');
    expect(p.slope).toEqual([1, 1, 1]);
    expect(p.offset).toEqual([0, 0, 0]);
    expect(p.power).toEqual([1, 1, 1]);
    expect(p.saturation).toBe(1.0);
    expect(p.lumaWeights).toEqual([...REC709_LUMA]);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new LookModificationPass({
      slope: [1.2, 1.1, 0.9],
      offset: [-0.05, 0, 0.05],
      power: [0.95, 1.0, 1.05],
      saturation: 1.1,
      lumaWeights: [0.299, 0.587, 0.114],
      enabled: false,
    });
    expect(p.slope).toEqual([1.2, 1.1, 0.9]);
    expect(p.offset).toEqual([-0.05, 0, 0.05]);
    expect(p.power).toEqual([0.95, 1.0, 1.05]);
    expect(p.saturation).toBe(1.1);
    expect(p.lumaWeights).toEqual([0.299, 0.587, 0.114]);
    expect(p.enabled).toBe(false);
  });

  it('slope is updatable', () => {
    const p = new LookModificationPass();
    p.slope = [1.5, 1.5, 1.5];
    expect(p.slope).toEqual([1.5, 1.5, 1.5]);
  });

  it('offset is updatable', () => {
    const p = new LookModificationPass();
    p.offset = [0.1, 0.1, 0.1];
    expect(p.offset).toEqual([0.1, 0.1, 0.1]);
  });

  it('power is updatable', () => {
    const p = new LookModificationPass();
    p.power = [0.8, 0.8, 0.8];
    expect(p.power).toEqual([0.8, 0.8, 0.8]);
  });

  it('saturation is updatable', () => {
    const p = new LookModificationPass();
    p.saturation = 1.5;
    expect(p.saturation).toBe(1.5);
  });

  it('lumaWeights is updatable', () => {
    const p = new LookModificationPass();
    p.lumaWeights = [0.299, 0.587, 0.114];
    expect(p.lumaWeights).toEqual([0.299, 0.587, 0.114]);
  });

  it('enabled is updatable', () => {
    const p = new LookModificationPass();
    expect(p.enabled).toBe(true);
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('LookModificationPass apply', () => {
  it('apply() with non-identity CDL does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('first apply allocates resources (1 output texture + 1 FBO + 1 VAO + 1 buffer)', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
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
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
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
    const p = new LookModificationPass({ enabled: false, slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(result).toBe(input);
    expect(gl.drawCalls).toBe(0);
    expect(gl.createdTextures.length).toBe(1); // 只有 input,无 output
  });

  it('identity CDL apply returns input texture and skips draw call', () => {
    const gl = new MockGL2();
    // 默认参数 = 恒等变换
    const p = new LookModificationPass();
    const input = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(result).toBe(input);
    expect(gl.drawCalls).toBe(0);
    expect(gl.createdTextures.length).toBe(1); // 只有 input,无 output
  });

  it('apply on resolution change rebuilds output texture + FBO', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
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
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });

  it('apply returns output texture (not input) when non-identity', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(result).not.toBe(input);
    expect(result).toBeDefined();
  });

  it('apply with offset only works', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ offset: [0.1, 0.1, 0.1] });
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with power only works', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ power: [0.9, 1.0, 1.1] });
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with saturation only works', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ saturation: 1.5 });
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with full SOP+Sat works', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({
      slope: [1.2, 1.1, 0.9],
      offset: [-0.05, 0, 0.05],
      power: [0.95, 1.0, 1.05],
      saturation: 1.1,
    });
    const input = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('multiple applies issue multiple draw calls', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.drawCalls).toBe(3);
  });

  it('transitioning from identity to non-identity triggers draw', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass();
    const input = makeInputTexture(gl);
    // 第一次:恒等,跳过
    let result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.drawCalls).toBe(0);
    expect(result).toBe(input);
    // 修改参数 → 非恒等
    p.slope = [1.2, 1, 1];
    result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.drawCalls).toBe(1);
    expect(result).not.toBe(input);
  });

  it('transitioning from non-identity to identity skips draw', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    // 第一次:非恒等,渲染
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.drawCalls).toBe(1);
    // 重置为恒等
    p.slope = [1, 1, 1];
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(gl.drawCalls).toBe(1); // 不增加
    expect(result).toBe(input);
  });
});

// ── dispose ───────────────────────────────────────────────────────

describe('LookModificationPass dispose', () => {
  it('dispose() does not throw and releases resources', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl parameter does not throw', () => {
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    expect(() => p.dispose()).not.toThrow();
  });

  it('repeated dispose() calls are safe', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
    expect(() => p.dispose()).not.toThrow();
  });

  it('apply after dispose re-initializes', () => {
    const gl = new MockGL2();
    const p = new LookModificationPass({ slope: [1.2, 1, 1] });
    const input = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input);  // drawCall 1
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const texBefore = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, input);  // drawCall 2 (re-init)
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
    expect(gl.drawCalls).toBe(2);  // 两次 apply 都触发了 draw call
  });
});

// ── REC709_LUMA 常量 ──────────────────────────────────────────────

describe('REC709_LUMA constant', () => {
  it('has correct Rec709 weights', () => {
    expect(REC709_LUMA[0]).toBeCloseTo(0.2126, 6);
    expect(REC709_LUMA[1]).toBeCloseTo(0.7152, 6);
    expect(REC709_LUMA[2]).toBeCloseTo(0.0722, 6);
  });

  it('weights sum to ~1.0', () => {
    const sum = REC709_LUMA[0] + REC709_LUMA[1] + REC709_LUMA[2];
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

// ── 着色器源码校验 ─────────────────────────────────────────────────

describe('LOOK_MODIFICATION_FRAG shader source', () => {
  it('is a GLSL ES 3.00 shader', () => {
    expect(LOOK_MODIFICATION_FRAG).toContain('#version 300 es');
  });

  it('declares required uniforms', () => {
    expect(LOOK_MODIFICATION_FRAG).toContain('uniform sampler2D u_colorMap');
    expect(LOOK_MODIFICATION_FRAG).toContain('uniform vec3  u_slope');
    expect(LOOK_MODIFICATION_FRAG).toContain('uniform vec3  u_offset');
    expect(LOOK_MODIFICATION_FRAG).toContain('uniform vec3  u_power');
    expect(LOOK_MODIFICATION_FRAG).toContain('uniform float u_saturation');
    expect(LOOK_MODIFICATION_FRAG).toContain('uniform vec3  u_lumaWeights');
  });

  it('implements ASC-CDL SOP formula', () => {
    expect(LOOK_MODIFICATION_FRAG).toContain('color * u_slope + u_offset');
    expect(LOOK_MODIFICATION_FRAG).toContain('pow(');
  });

  it('implements saturation via luma mix', () => {
    expect(LOOK_MODIFICATION_FRAG).toContain('luma');
    expect(LOOK_MODIFICATION_FRAG).toContain('mix(');
  });

  it('references ASC-CDL in comments', () => {
    expect(LOOK_MODIFICATION_FRAG).toContain('ASC-CDL');
  });

  it('clamps to 0 before pow to prevent NaN', () => {
    expect(LOOK_MODIFICATION_FRAG).toContain('max(');
  });
});
