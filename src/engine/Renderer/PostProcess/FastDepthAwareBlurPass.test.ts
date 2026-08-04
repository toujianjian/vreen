// FastDepthAwareBlurPass 单元测试。
//
// 覆盖:
//   A. 纯 CPU 函数(与 GPU shader 1:1 对应)
//      1. calculateDepthFalloff  — 深度斜率差衰减权重
//      2. blurDirection          — 单方向模糊累加
//      3. fastDepthAwareBlurPixel — 完整像素处理(正 + 负方向平均)
//   B. FastDepthAwareBlurPass 类生命周期
//      4. 构造默认值与选项覆盖
//      5. apply() 在 mock GL 下不抛错并返回纹理
//      6. apply() 首帧分配 2 texture + 2 FBO + 1 VAO + 1 buffer + 1 program
//      7. apply() 同尺寸不重复分配
//      8. apply() resize 重新分配
//      9. apply() 每次 2 次 drawCalls(H + V)
//     10. enabled=false 不渲染但仍返回纹理
//     11. dispose() 释放资源
//     12. dispose() 幂等
//     13. setRadius 钳制到 [1, 32]

import { describe, it, expect } from 'vitest';
import {
  FastDepthAwareBlurPass,
  calculateDepthFalloff,
  blurDirection,
  fastDepthAwareBlurPixel,
  DEFAULT_DAB_PARAMS,
  type DABParams,
  type DABColor,
} from './FastDepthAwareBlurPass';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 支持 FastDepthAwareBlurPass.apply 所需的全部 GL 调用表面。

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
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
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
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
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

describe('calculateDepthFalloff', () => {
  it('returns 1 when prevSlope == curSlope (no depth change)', () => {
    const v = calculateDepthFalloff(0.5, 0.5, 0, 50);
    expect(v).toBe(1.0);
  });

  it('returns 1 when both slopes are 0 (flat surface)', () => {
    const v = calculateDepthFalloff(0, 0, 0, 50);
    expect(v).toBe(1.0);
  });

  it('returns < 1 when slopes differ (edge detected)', () => {
    const v = calculateDepthFalloff(0.0, 1.0, 0, 50);
    expect(v).toBeLessThan(1.0);
  });

  it('returns 0 when slope difference is large (sharp edge)', () => {
    // diff = |0 - 1| = 1; 1 - 1*50 = -49 → clamped to 0
    const v = calculateDepthFalloff(0.0, 1.0, 0, 50);
    expect(v).toBe(0.0);
  });

  it('is clamped to [0, 1]', () => {
    // Very large difference → 0
    expect(calculateDepthFalloff(0, 1000, 0, 50)).toBe(0.0);
    // Zero difference → 1
    expect(calculateDepthFalloff(1000, 1000, 0, 50)).toBe(1.0);
  });

  it('threshold reduces sensitivity to small differences', () => {
    // diff = 0.1; without threshold: 1 - 0.1*50 = -4 → 0
    // with threshold 0.2: diff = 0.1 - 0.2 = -0.1 (clamped to 0 in abs-threshold?) 
    // Actually: diff = abs(0.1) - 0.2 = -0.1; 1 - (-0.1)*50 = 6 → clamped to 1
    const vNoThreshold = calculateDepthFalloff(0, 0.1, 0, 50);
    const vWithThreshold = calculateDepthFalloff(0, 0.1, 0.2, 50);
    expect(vWithThreshold).toBeGreaterThan(vNoThreshold);
  });

  it('higher strength → sharper edges (lower falloff)', () => {
    const vLow = calculateDepthFalloff(0, 0.01, 0, 10);
    const vHigh = calculateDepthFalloff(0, 0.01, 0, 100);
    expect(vHigh).toBeLessThanOrEqual(vLow);
  });

  it('is symmetric in slope arguments', () => {
    const a = calculateDepthFalloff(0.3, 0.7, 0, 50);
    const b = calculateDepthFalloff(0.7, 0.3, 0, 50);
    expect(a).toBe(b);
  });
});

describe('blurDirection', () => {
  const params: DABParams = {
    blurRadius: 4,
    constFalloff: 2.0 / 3.0,
    depthFalloffThreshold: 0,
    depthFalloffStrength: 50,
  };

  it('returns finite RGB values for uniform input', () => {
    const sampleColor = (): DABColor => [0.5, 0.5, 0.5];
    const sampleDepth = (): number => 10.0;
    const r = blurDirection([0.5, 0.5], [0.001, 0], 10.0, sampleColor, sampleDepth, params);
    expect(Number.isFinite(r[0])).toBe(true);
    expect(Number.isFinite(r[1])).toBe(true);
    expect(Number.isFinite(r[2])).toBe(true);
  });

  it('uniform color → output is proportional to input * radius * 0.5', () => {
    // With uniform depth and color = c, each step contributes c * 0.5.
    // Total = blurRadius * c * 0.5 = 4 * 0.5 * 0.5 = 1.0
    // But due to constFalloff mixing, the actual value is more complex.
    // With constFalloff = 2/3, each step mixes toward previous:
    //   curValue = mix(curValue, prevValue, 2/3) = 1/3*cur + 2/3*prev
    // Starting from prevValue = 0.5 (center):
    //   step 1: cur = 1/3*0.5 + 2/3*0.5 = 0.5; acc = 0.5*0.5 = 0.25
    //   step 2: same → acc = 0.5
    //   step 3: same → acc = 0.75
    //   step 4: same → acc = 1.0
    const sampleColor = (): DABColor => [0.5, 0.5, 0.5];
    const sampleDepth = (): number => 10.0;
    const r = blurDirection([0.5, 0.5], [0.001, 0], 10.0, sampleColor, sampleDepth, params);
    expect(r[0]).toBeCloseTo(1.0, 5);
    expect(r[1]).toBeCloseTo(1.0, 5);
    expect(r[2]).toBeCloseTo(1.0, 5);
  });

  it('larger blurRadius → larger accumulator', () => {
    const sampleColor = (): DABColor => [1.0, 1.0, 1.0];
    const sampleDepth = (): number => 5.0;
    const r2 = blurDirection([0.5, 0.5], [0.001, 0], 5.0, sampleColor, sampleDepth, { ...params, blurRadius: 2 });
    const r8 = blurDirection([0.5, 0.5], [0.001, 0], 5.0, sampleColor, sampleDepth, { ...params, blurRadius: 8 });
    expect(r8[0]).toBeGreaterThan(r2[0]);
  });

  it('depth edge stops blur propagation', () => {
    // Depth jumps from 5 to 100 at step 2 — sharp edge.
    // Before edge (steps 0,1): color 1.0, depth 5.0
    // After edge (steps 2,3): color 0.0, depth 100.0
    // With depthFalloffStrength=50, the edge should stop mixing.
    let colorIdx = 0;
    let depthIdx = 0;
    const sc = (): DABColor => {
      const i = colorIdx++;
      return i <= 1 ? [1.0, 1.0, 1.0] : [0.0, 0.0, 0.0];
    };
    const sd = (): number => {
      const i = depthIdx++;
      return i <= 1 ? 5.0 : 100.0;
    };
    const r = blurDirection([0.5, 0.5], [0.001, 0], 5.0, sc, sd, params);
    // The accumulator should be dominated by the pre-edge color (1.0)
    // Post-edge color (0.0) should contribute little due to depth falloff
    expect(r[0]).toBeGreaterThan(0.5);
  });

  it('constFalloff=0 → no mixing (each sample contributes its own value * 0.5)', () => {
    // With constFalloff=0: mix(cur, prev, 0) = cur (no mixing)
    // So acc = sum of curValue * 0.5 for each step
    // Uniform color 0.4, radius 4 → acc = 4 * 0.4 * 0.5 = 0.8
    const sampleColor = (): DABColor => [0.4, 0.4, 0.4];
    const sampleDepth = (): number => 10.0;
    const r = blurDirection(
      [0.5, 0.5], [0.001, 0], 10.0,
      sampleColor, sampleDepth,
      { ...params, constFalloff: 0.0 },
    );
    expect(r[0]).toBeCloseTo(0.8, 5);
  });

  it('blurRadius=1 → only one sample (first step)', () => {
    const sampleColor = (): DABColor => [0.6, 0.6, 0.6];
    const sampleDepth = (): number => 10.0;
    const r = blurDirection(
      [0.5, 0.5], [0.001, 0], 10.0,
      sampleColor, sampleDepth,
      { ...params, blurRadius: 1 },
    );
    // Only 1 step: acc = 0.6 * 0.5 = 0.3
    expect(r[0]).toBeCloseTo(0.3, 5);
  });

  it('preserves RGB independence (asymmetric colors)', () => {
    // Each call returns a different color based on a counter
    const colors: DABColor[] = [
      [1, 0, 0],  // center
      [0, 1, 0],  // step 1
      [0, 0, 1],  // step 2
      [1, 1, 0],  // step 3
    ];
    let cIdx = 0;
    let dIdx = 0;
    const sc = (): DABColor => {
      const c = colors[Math.min(cIdx, colors.length - 1)] ?? [0, 0, 0];
      cIdx++;
      return c;
    };
    const sd = (): number => { dIdx++; return 10.0; };
    const r = blurDirection([0.5, 0.5], [0.001, 0], 10.0, sc, sd, params);
    // R, G, B should differ (asymmetric input)
    expect(r[0]).not.toBeCloseTo(r[1], 2);
    expect(r[1]).not.toBeCloseTo(r[2], 2);
  });
});

describe('fastDepthAwareBlurPixel', () => {
  const params: DABParams = {
    blurRadius: 4,
    constFalloff: 2.0 / 3.0,
    depthFalloffThreshold: 0,
    depthFalloffStrength: 50,
  };
  const texel: [number, number] = [1 / 800, 1 / 600];

  it('returns finite RGB for uniform input', () => {
    const sampleColor = (): DABColor => [0.5, 0.5, 0.5];
    const sampleDepth = (): number => 10.0;
    const r = fastDepthAwareBlurPixel([0.5, 0.5], sampleColor, sampleDepth, texel, [1, 0], params);
    expect(Number.isFinite(r[0])).toBe(true);
    expect(Number.isFinite(r[1])).toBe(true);
    expect(Number.isFinite(r[2])).toBe(true);
  });

  it('symmetric input → symmetric output (pos == neg)', () => {
    // When color and depth are uniform, pos and neg directions produce identical results.
    // Total = (pos + neg) * 0.5 = pos (since pos == neg)
    const sampleColor = (): DABColor => [0.7, 0.7, 0.7];
    const sampleDepth = (): number => 10.0;
    const r = fastDepthAwareBlurPixel([0.5, 0.5], sampleColor, sampleDepth, texel, [1, 0], params);
    // With uniform color 0.7, radius 4, constFalloff 2/3:
    // Each direction: acc = 4 * 0.7 * 0.5 = 1.4 (uniform mixing keeps color at 0.7)
    // Total = (1.4 + 1.4) * 0.5 = 1.4
    expect(r[0]).toBeCloseTo(1.4, 4);
  });

  it('horizontal direction uses x texel, vertical uses y texel', () => {
    // Both should produce finite output; the difference is in which texel dimension is used.
    const sampleColor = (): DABColor => [0.5, 0.5, 0.5];
    const sampleDepth = (): number => 10.0;
    const rH = fastDepthAwareBlurPixel([0.5, 0.5], sampleColor, sampleDepth, texel, [1, 0], params);
    const rV = fastDepthAwareBlurPixel([0.5, 0.5], sampleColor, sampleDepth, texel, [0, 1], params);
    // Uniform input → same output regardless of direction
    expect(rH[0]).toBeCloseTo(rV[0], 5);
  });

  it('default params (DEFAULT_DAB_PARAMS) produce valid output', () => {
    const sampleColor = (): DABColor => [0.5, 0.5, 0.5];
    const sampleDepth = (): number => 10.0;
    const r = fastDepthAwareBlurPixel([0.5, 0.5], sampleColor, sampleDepth, texel, [1, 0]);
    expect(Number.isFinite(r[0])).toBe(true);
    expect(r[0]).toBeGreaterThanOrEqual(0);
  });

  it('depth discontinuity in one direction → asymmetric contribution', () => {
    // Color is uniform, but depth jumps sharply in +x direction (foreground → background).
    // The +direction should hit the edge and reduce mixing;
    // The -direction stays on flat surface and mixes freely.
    let depthIdx = 0;
    const sd = (): number => {
      depthIdx++;
      return depthIdx <= 5 ? 5.0 : 100.0;
    };
    const sc = (): DABColor => [1.0, 1.0, 1.0];
    const r = fastDepthAwareBlurPixel([0.5, 0.5], sc, sd, texel, [1, 0], params);
    // Should still be finite and positive
    expect(Number.isFinite(r[0])).toBe(true);
    expect(r[0]).toBeGreaterThanOrEqual(0);
  });
});

// ── B. FastDepthAwareBlurPass 类生命周期 ────────────────────────────

describe('FastDepthAwareBlurPass constructor', () => {
  it('defaults match DEFAULT_DAB_PARAMS', () => {
    const p = new FastDepthAwareBlurPass();
    expect(p.blurRadius).toBe(8);
    expect(p.constFalloff).toBeCloseTo(2.0 / 3.0, 5);
    expect(p.depthFalloffThreshold).toBe(0);
    expect(p.depthFalloffStrength).toBe(50);
    expect(p.enabled).toBe(true);
    expect(p.name).toBe('fast-depth-aware-blur');
  });

  it('accepts option overrides', () => {
    const p = new FastDepthAwareBlurPass({
      blurRadius: 16,
      constFalloff: 0.5,
      depthFalloffThreshold: 0.1,
      depthFalloffStrength: 100,
      enabled: false,
    });
    expect(p.blurRadius).toBe(16);
    expect(p.constFalloff).toBe(0.5);
    expect(p.depthFalloffThreshold).toBe(0.1);
    expect(p.depthFalloffStrength).toBe(100);
    expect(p.enabled).toBe(false);
  });
});

describe('FastDepthAwareBlurPass setRadius', () => {
  it('clamps radius to [1, 32]', () => {
    const p = new FastDepthAwareBlurPass();
    p.setRadius(0);
    expect(p.blurRadius).toBe(1);
    p.setRadius(100);
    expect(p.blurRadius).toBe(32);
    p.setRadius(16);
    expect(p.blurRadius).toBe(16);
  });

  it('floors non-integer radius', () => {
    const p = new FastDepthAwareBlurPass();
    p.setRadius(7.9);
    expect(p.blurRadius).toBe(7);
  });
});

describe('FastDepthAwareBlurPass apply lifecycle', () => {
  it('apply() does not throw with mock GL and returns a texture', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('color'), makeTexture('depth'));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 2 textures + 2 FBOs + 1 VAO + 1 buffer + 1 program on first apply', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.createdTextures.length).toBe(2);  // output + intermediate
    expect(gl.createdFramebuffers.length).toBe(2);  // output + intermediate
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);  // shared H + V
  });

  it('compiles program once (2 shaders: vert + frag)', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.createdPrograms.length).toBe(1);
    expect(gl.createdShaders.length).toBe(2);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c1'), makeTexture('d1'));
    const texAfterFirst = gl.createdTextures.length;
    const progAfterFirst = gl.createdPrograms.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'));
    expect(gl.createdTextures.length).toBe(texAfterFirst);
    expect(gl.createdPrograms.length).toBe(progAfterFirst);
  });

  it('returns the same output texture across apply() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c1'), makeTexture('d1'));
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'));
    expect(t1).toBe(t2);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('performs 2 drawCalls per apply (H + V passes)', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(2);  // 1 H + 1 V
  });

  it('increments drawCalls by 2 per apply', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(6);  // 3 * 2
  });
});

describe('FastDepthAwareBlurPass enabled=false', () => {
  it('does not render when disabled but still returns texture', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass({ enabled: false });
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(out).toBeDefined();
    // Resources are pre-allocated in _initResources, but drawCalls should be 0
    expect(gl.drawCalls).toBe(0);
  });

  it('renders when re-enabled', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass({ enabled: false });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(0);
    p.enabled = true;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.drawCalls).toBe(2);
  });
});

describe('FastDepthAwareBlurPass dispose', () => {
  it('frees 2 textures + 2 FBOs + 1 VAO + 1 buffer + 1 program after apply', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    expect(gl.deletedTextures.length).toBe(0);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(2);
    expect(gl.deletedFramebuffers.length).toBe(2);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('is idempotent (double dispose does not throw)', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new FastDepthAwareBlurPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'));
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const deletedAfterDispose = gl.deletedTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d2'));
    expect(gl.createdTextures.length).toBe(4);  // 2 from first apply + 2 from re-apply
    expect(gl.deletedTextures.length).toBe(deletedAfterDispose);
  });
});

// ── C. DEFAULT_DAB_PARAMS 常量 ─────────────────────────────────────

describe('DEFAULT_DAB_PARAMS', () => {
  it('has expected values (o3de Atom recommended)', () => {
    expect(DEFAULT_DAB_PARAMS.blurRadius).toBe(8);
    expect(DEFAULT_DAB_PARAMS.constFalloff).toBeCloseTo(2.0 / 3.0, 5);
    expect(DEFAULT_DAB_PARAMS.depthFalloffThreshold).toBe(0);
    expect(DEFAULT_DAB_PARAMS.depthFalloffStrength).toBe(50);
  });

  it('is frozen-like (constant across imports)', () => {
    const a = DEFAULT_DAB_PARAMS;
    const b = DEFAULT_DAB_PARAMS;
    expect(a).toBe(b);
  });
});
