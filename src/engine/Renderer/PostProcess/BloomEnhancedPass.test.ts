// BloomEnhancedPass 单元测试。
//
// 覆盖:
//   A. 纯 CPU 函数(与 GPU shader 1:1 对应)
//      1. luminance              — Rec.709 亮度
//      2. brightPassPixel        — soft knee 高通
//      3. bloomCompositePixel    — 加法合成 + dirt + tint
//   B. BloomEnhancedPass 类生命周期
//      4. 构造默认值与选项覆盖
//      5. apply() 首帧分配 5 texture + 4 FBO + 1 VAO + 1 buffer + 3 program
//      6. apply() 同尺寸不重复分配
//      7. apply() resize 重新分配
//      8. apply() 每次 4 次 drawCalls(bright + H + V + composite)
//      9. enabled=false 不渲染但仍返回纹理
//     10. dispose() 释放资源
//     11. dispose() 幂等
//     12. apply() 后 dispose() 再 apply() 重新分配

import { describe, it, expect } from 'vitest';
import {
  BloomEnhancedPass,
  luminance,
  brightPassPixel,
  bloomCompositePixel,
  DEFAULT_BLOOM_ENHANCED_PARAMS,
} from './BloomEnhancedPass';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 支持 BloomEnhancedPass.apply 所需的全部 GL 调用表面。

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
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly HALF_FLOAT = 0x140B;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly NEAREST = 0x2600;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly FLOAT = 0x1406;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly NEAREST = MockGL2.NEAREST;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly FLOAT = MockGL2.FLOAT;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;

  canvas = { width: 800, height: 600 };

  createdTextures: WebGLTexture[] = [];
  createdFramebuffers: WebGLFramebuffer[] = [];
  createdPrograms: WebGLProgram[] = [];
  createdShaders: WebGLShader[] = [];
  createdVAOs: WebGLVertexArrayObject[] = [];
  createdBuffers: WebGLBuffer[] = [];
  deletedTextures: WebGLTexture[] = [];
  deletedFramebuffers: WebGLFramebuffer[] = [];
  deletedPrograms: WebGLProgram[] = [];
  deletedVAOs: WebGLVertexArrayObject[] = [];
  deletedBuffers: WebGLBuffer[] = [];
  drawCalls = 0;

  createTexture(): WebGLTexture {
    const t = { id: `tex-${this.createdTextures.length}` } as unknown as WebGLTexture;
    this.createdTextures.push(t);
    return t;
  }
  createFramebuffer(): WebGLFramebuffer {
    const f = { id: `fbo-${this.createdFramebuffers.length}` } as unknown as WebGLFramebuffer;
    this.createdFramebuffers.push(f);
    return f;
  }
  createProgram(): WebGLProgram {
    const p = { id: `prog-${this.createdPrograms.length}` } as unknown as WebGLProgram;
    this.createdPrograms.push(p);
    return p;
  }
  createShader(_t: number): WebGLShader {
    const s = { id: `sh-${this.createdShaders.length}` } as unknown as WebGLShader;
    this.createdShaders.push(s);
    return s;
  }
  createVertexArray(): WebGLVertexArrayObject {
    const v = { id: `vao-${this.createdVAOs.length}` } as unknown as WebGLVertexArrayObject;
    this.createdVAOs.push(v);
    return v;
  }
  createBuffer(): WebGLBuffer {
    const b = { id: `buf-${this.createdBuffers.length}` } as unknown as WebGLBuffer;
    this.createdBuffers.push(b);
    return b;
  }
  deleteTexture(t: WebGLTexture | null): void { if (t) this.deletedTextures.push(t); }
  deleteFramebuffer(f: WebGLFramebuffer | null): void { if (f) this.deletedFramebuffers.push(f); }
  deleteProgram(p: WebGLProgram | null): void { if (p) this.deletedPrograms.push(p); }
  deleteVertexArray(v: WebGLVertexArrayObject | null): void { if (v) this.deletedVAOs.push(v); }
  deleteBuffer(b: WebGLBuffer | null): void { if (b) this.deletedBuffers.push(b); }
  deleteShader(_s: WebGLShader | null): void {}

  shaderSource(_s: WebGLShader, _src: string): void {}
  compileShader(_s: WebGLShader): void {}
  getShaderParameter(_s: WebGLShader, pname: number): unknown {
    if (pname === this.COMPILE_STATUS) return true;
    return null;
  }
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

// ── A. 纯 CPU 函数 ──────────────────────────────────────────────────

describe('luminance', () => {
  it('returns 0 for black', () => {
    expect(luminance([0, 0, 0])).toBe(0);
  });

  it('returns 1 for white (Rec.709 weights sum to 1)', () => {
    expect(luminance([1, 1, 1])).toBeCloseTo(1.0, 6);
  });

  it('weights R < G < B per Rec.709', () => {
    const r = luminance([1, 0, 0]);
    const g = luminance([0, 1, 0]);
    const b = luminance([0, 0, 1]);
    expect(r).toBeCloseTo(0.2126, 6);
    expect(g).toBeCloseTo(0.7152, 6);
    expect(b).toBeCloseTo(0.0722, 6);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });
});

describe('brightPassPixel', () => {
  const params = { threshold: 0.85, smoothWidth: 0.01 };

  it('returns ~0 for pixels below threshold', () => {
    // v = 0.2, threshold = 0.85 → contribution = max(soft, 0.2-0.85) / 0.2
    // soft = clamp(0.2 - 0.85 + knee, 0, 2*knee) = clamp(-0.65+knee, 0, 2knee) = 0
    // contribution = max(0, -0.65) / 0.2 = 0
    const r = brightPassPixel([0.2, 0.2, 0.2], params);
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0);
    expect(r[2]).toBe(0);
  });

  it('returns nonzero for bright pixels above threshold', () => {
    const r = brightPassPixel([2.0, 2.0, 2.0], params);
    expect(r[0]).toBeGreaterThan(0);
    expect(r[1]).toBeGreaterThan(0);
    expect(r[2]).toBeGreaterThan(0);
  });

  it('preserves color ratio (white in → white out)', () => {
    const r = brightPassPixel([3.0, 3.0, 3.0], params);
    expect(r[0]).toBeCloseTo(r[1], 6);
    expect(r[1]).toBeCloseTo(r[2], 6);
  });

  it('higher threshold → less contribution', () => {
    const low = brightPassPixel([1.5, 1.5, 1.5], { threshold: 0.5, smoothWidth: 0.01 });
    const high = brightPassPixel([1.5, 1.5, 1.5], { threshold: 1.4, smoothWidth: 0.01 });
    expect(low[0]).toBeGreaterThan(high[0]);
  });

  it('larger smoothWidth → softer knee (more contribution near threshold)', () => {
    // v just above threshold: softer knee should let more through
    const sharp = brightPassPixel([0.9, 0.9, 0.9], { threshold: 0.85, smoothWidth: 0.001 });
    const soft = brightPassPixel([0.9, 0.9, 0.9], { threshold: 0.85, smoothWidth: 0.5 });
    expect(soft[0]).toBeGreaterThanOrEqual(sharp[0]);
  });

  it('threshold=0 passes everything (contribution = 1)', () => {
    // v=1, threshold=0: knee=0+ε, soft=clamp(1-0+ε,0,2ε)=2ε, soft²/(4ε+ε) tiny
    // contribution = max(tiny, 1-0) / 1 = 1
    const r = brightPassPixel([1.0, 1.0, 1.0], { threshold: 0.0, smoothWidth: 0.01 });
    expect(r[0]).toBeCloseTo(1.0, 4);
  });

  it('black returns 0 regardless of threshold', () => {
    const r = brightPassPixel([0, 0, 0], params);
    expect(r[0]).toBe(0);
  });
});

describe('bloomCompositePixel', () => {
  it('returns source when bloom is 0', () => {
    const r = bloomCompositePixel([0.5, 0.5, 0.5], [0, 0, 0], [0, 0, 0], 1.0, 0.0, [1, 1, 1]);
    expect(r[0]).toBeCloseTo(0.5, 6);
    expect(r[1]).toBeCloseTo(0.5, 6);
    expect(r[2]).toBeCloseTo(0.5, 6);
  });

  it('adds bloom * strength * tint to source', () => {
    const r = bloomCompositePixel([0.2, 0.2, 0.2], [0.5, 0.5, 0.5], [0, 0, 0], 2.0, 0.0, [1, 1, 1]);
    // 0.2 + 0.5*1*2 = 1.2
    expect(r[0]).toBeCloseTo(1.2, 6);
  });

  it('tint scales each channel independently', () => {
    const r = bloomCompositePixel([0, 0, 0], [1, 1, 1], [0, 0, 0], 1.0, 0.0, [0.5, 1.0, 2.0]);
    expect(r[0]).toBeCloseTo(0.5, 6);
    expect(r[1]).toBeCloseTo(1.0, 6);
    expect(r[2]).toBeCloseTo(2.0, 6);
  });

  it('dirt amplifies bloom (per-channel)', () => {
    const noDirt = bloomCompositePixel([0, 0, 0], [1, 0, 0], [0, 0, 0], 1.0, 1.0, [1, 1, 1]);
    const withDirt = bloomCompositePixel([0, 0, 0], [1, 0, 0], [1, 0, 0], 1.0, 1.0, [1, 1, 1]);
    // noDirt: 0 + 1*1*1*(1+0*1) = 1
    // withDirt: 0 + 1*1*1*(1+1*1) = 2
    expect(withDirt[0]).toBeCloseTo(2.0, 6);
    expect(noDirt[0]).toBeCloseTo(1.0, 6);
  });

  it('dirtStrength=0 disables dirt regardless of dirt texture', () => {
    const r = bloomCompositePixel([0, 0, 0], [1, 1, 1], [1, 1, 1], 1.0, 0.0, [1, 1, 1]);
    expect(r[0]).toBeCloseTo(1.0, 6);
  });

  it('strength=0 disables bloom (returns source)', () => {
    const r = bloomCompositePixel([0.3, 0.3, 0.3], [1, 1, 1], [1, 1, 1], 0.0, 1.0, [1, 1, 1]);
    expect(r[0]).toBeCloseTo(0.3, 6);
  });
});

// ── B. BloomEnhancedPass 类生命周期 ────────────────────────────────

describe('BloomEnhancedPass constructor', () => {
  it('uses default values when no options given', () => {
    const p = new BloomEnhancedPass();
    expect(p.strength).toBe(DEFAULT_BLOOM_ENHANCED_PARAMS.strength);
    expect(p.threshold).toBe(DEFAULT_BLOOM_ENHANCED_PARAMS.threshold);
    expect(p.smoothWidth).toBe(DEFAULT_BLOOM_ENHANCED_PARAMS.smoothWidth);
    expect(p.blurRadius).toBe(DEFAULT_BLOOM_ENHANCED_PARAMS.blurRadius);
    expect(p.constFalloff).toBe(DEFAULT_BLOOM_ENHANCED_PARAMS.constFalloff);
    expect(p.depthFalloffStrength).toBe(DEFAULT_BLOOM_ENHANCED_PARAMS.depthFalloffStrength);
    expect(p.enabled).toBe(true);
    expect(p.dirtTexture).toBeNull();
    expect(p.dirtStrength).toBe(0);
  });

  it('overrides defaults with options', () => {
    const p = new BloomEnhancedPass({
      strength: 2.5,
      threshold: 1.2,
      smoothWidth: 0.05,
      blurRadius: 12,
      constFalloff: 0.5,
      depthFalloffThreshold: 0.1,
      depthFalloffStrength: 80,
      tint: [1.0, 0.8, 0.6],
      dirtStrength: 0.4,
      enabled: false,
    });
    expect(p.strength).toBe(2.5);
    expect(p.threshold).toBe(1.2);
    expect(p.smoothWidth).toBe(0.05);
    expect(p.blurRadius).toBe(12);
    expect(p.constFalloff).toBe(0.5);
    expect(p.depthFalloffThreshold).toBe(0.1);
    expect(p.depthFalloffStrength).toBe(80);
    expect(p.tint).toEqual([1.0, 0.8, 0.6]);
    expect(p.dirtStrength).toBe(0.4);
    expect(p.enabled).toBe(false);
  });
});

describe('BloomEnhancedPass apply lifecycle', () => {
  it('allocates 5 textures + 4 FBOs + 1 VAO + 1 buffer + 3 programs on first apply', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    // 4 HDR tex (bright, blurH, blurV, output) + 1 black 1x1 tex = 5
    expect(gl.createdTextures.length).toBe(5);
    // 4 FBOs (bright, blurH, blurV, output)
    expect(gl.createdFramebuffers.length).toBe(4);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    // 3 programs (bright, blur, composite)
    expect(gl.createdPrograms.length).toBe(3);
  });

  it('compiles 3 programs once (bright + blur + composite)', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    // 2 shaders per program (vert + frag) × 3 programs = 6
    expect(gl.createdShaders.length).toBe(6);
  });

  it('performs 4 drawCalls per apply (bright + H + V + composite)', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(4);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    const tex0 = gl.createdTextures.length;
    const fbo0 = gl.createdFramebuffers.length;
    const prog0 = gl.createdPrograms.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'));
    expect(gl.createdTextures.length).toBe(tex0);
    expect(gl.createdFramebuffers.length).toBe(fbo0);
    expect(gl.createdPrograms.length).toBe(prog0);
  });

  it('increments drawCalls by 4 per apply', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(4);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(8);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    const tex0 = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.createdTextures.length).toBeGreaterThan(tex0);
  });

  it('returns the same output texture across apply() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    const out1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    const out2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(out1).toBe(out2);
  });
});

describe('BloomEnhancedPass enabled=false', () => {
  it('does not render when disabled but still returns texture', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass({ enabled: false });
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    // Resources still allocated (output tex created), but no draw calls
    expect(gl.drawCalls).toBe(0);
    expect(out).toBeTruthy();
  });

  it('renders when re-enabled', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass({ enabled: false });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(0);
    p.enabled = true;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(4);
  });
});

describe('BloomEnhancedPass dispose', () => {
  it('frees 5 textures + 4 FBOs + 1 VAO + 1 buffer + 3 programs after apply', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    p.dispose(gl as unknown as WebGL2RenderingContext);
    // 4 HDR + 1 black = 5 textures deleted
    expect(gl.deletedTextures.length).toBe(5);
    expect(gl.deletedFramebuffers.length).toBe(4);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(3);
  });

  it('is idempotent (double dispose does not throw)', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new BloomEnhancedPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    const texAfterFirst = gl.createdTextures.length;
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });
});
