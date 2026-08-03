// SSSRPass 单元测试。
//
// 覆盖:
//   1. importanceSampleGGX 数学正确性(纯函数,无需 GL)
//      - roughness=0 → H=N(纯镜面)
//      - H 始终归一化
//      - H 在法线半球内(dot(H,N) >= 0)
//      - roughness 越大,散射角越大(统计验证)
//   2. schlickFresnel 边界值
//   3. reflectVec 方向正确性
//   4. SSSRPass 构造默认值与选项覆盖
//   5. SSSRPass.apply 在 mock GL 下不抛错并返回纹理
//   6. dispose 释放资源
//
// Mock GL 策略:复用 SSR/HeightFog 的 MockGL2 模式,覆盖 cube/texture/FBO/
// blit/shader 编译调用表面。

import { describe, it, expect } from 'vitest';
import {
  SSSRPass,
  importanceSampleGGX,
  schlickFresnel,
  reflectVec,
  type Vec3,
} from './SSSRPass';
import type { Camera } from '../../Cameras/Camera';

// ── importanceSampleGGX 数学测试(纯函数) ────────────────────────

describe('importanceSampleGGX math', () => {
  it('roughness=0 → H = N (pure specular, all samples align with normal)', () => {
    const N: Vec3 = { x: 0, y: 0, z: 1 };
    for (let i = 0; i < 100; i++) {
      const xi: [number, number] = [Math.random(), Math.random()];
      const H = importanceSampleGGX(xi, N, 0.0);
      // roughness=0 → α=0 → cosθ=1 → H=N
      expect(Math.abs(H.x - N.x)).toBeLessThan(1e-6);
      expect(Math.abs(H.y - N.y)).toBeLessThan(1e-6);
      expect(Math.abs(H.z - N.z)).toBeLessThan(1e-6);
    }
  });

  it('H is always normalized (unit length)', () => {
    const N: Vec3 = { x: 0, y: 1, z: 0 };
    for (let r = 0; r <= 1; r += 0.25) {
      for (let i = 0; i < 50; i++) {
        const xi: [number, number] = [Math.random(), Math.random()];
        const H = importanceSampleGGX(xi, N, r);
        const len = Math.hypot(H.x, H.y, H.z);
        expect(len).toBeCloseTo(1.0, 5);
      }
    }
  });

  it('H is always in the normal hemisphere (dot(H, N) >= 0)', () => {
    const N: Vec3 = { x: 0.3, y: 0.4, z: Math.sqrt(1 - 0.09 - 0.16) }; // 归一化
    for (let r = 0; r <= 1; r += 0.1) {
      for (let i = 0; i < 100; i++) {
        const xi: [number, number] = [Math.random(), Math.random()];
        const H = importanceSampleGGX(xi, N, r);
        const d = H.x * N.x + H.y * N.y + H.z * N.z;
        expect(d).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('higher roughness → wider spread (lower mean dot(H,N))', () => {
    const N: Vec3 = { x: 0, y: 0, z: 1 };
    const Nsamples = 5000;

    // 低粗糙度:大部分样本集中在 N 附近,平均 dot(H,N) 高
    let sumLow = 0;
    for (let i = 0; i < Nsamples; i++) {
      const H = importanceSampleGGX([Math.random(), Math.random()], N, 0.1);
      sumLow += H.z; // dot(H, N) = H.z (N=(0,0,1))
    }
    const meanLow = sumLow / Nsamples;

    // 高粗糙度:样本分散,平均 dot(H,N) 低
    let sumHigh = 0;
    for (let i = 0; i < Nsamples; i++) {
      const H = importanceSampleGGX([Math.random(), Math.random()], N, 0.9);
      sumHigh += H.z;
    }
    const meanHigh = sumHigh / Nsamples;

    // 低粗糙度的平均 cosθ 应明显高于高粗糙度
    expect(meanLow).toBeGreaterThan(meanHigh);
    // 低粗糙度平均接近 1(集中)
    expect(meanLow).toBeGreaterThan(0.9);
    // 高粗糙度平均较低(GGX α=0.81 仍有一定集中度,容差放宽)
    expect(meanHigh).toBeLessThan(0.75);
  });

  it('roughness=1 → cosine-weighted hemisphere (mean cosθ ≈ 2/3)', () => {
    // roughness=1 → α=1 → cos²θ = (1-ξ₂)/(1+0·ξ₂) = 1-ξ₂ → cosθ = √(1-ξ₂)
    // 这等价于余弦加权半球采样,E[cosθ] = 2/3 ≈ 0.667
    const N: Vec3 = { x: 0, y: 0, z: 1 };
    const Nsamples = 10000;
    let sum = 0;
    for (let i = 0; i < Nsamples; i++) {
      const H = importanceSampleGGX([Math.random(), Math.random()], N, 1.0);
      sum += H.z;
    }
    const mean = sum / Nsamples;
    // E[cosθ] = 2/3 ≈ 0.667,宽松容差(统计波动)
    expect(mean).toBeGreaterThan(0.6);
    expect(mean).toBeLessThan(0.73);
  });

  it('xi=(0, 0) → cosθ=1 (H=N regardless of roughness)', () => {
    const N: Vec3 = { x: 0, y: 0, z: 1 };
    const H = importanceSampleGGX([0.0, 0.0], N, 0.5);
    expect(Math.abs(H.z - 1.0)).toBeLessThan(1e-6);
  });

  it('xi=(0.25, 1) → maximum scattering angle', () => {
    // ξ₁=0.25 → φ = π/2;ξ₂=1 → cos²θ = 0 (for α=1) or 1/α² (for α<1)
    const N: Vec3 = { x: 0, y: 0, z: 1 };
    const H = importanceSampleGGX([0.25, 0.9999], N, 1.0);
    // roughness=1, ξ₂→1: cosθ→0, H 在赤道附近(z≈0)
    expect(Math.abs(H.z)).toBeLessThan(0.05);
  });

  it('works with arbitrary normal direction (not just axis-aligned)', () => {
    const N: Vec3 = { x: 0.577, y: 0.577, z: 0.577 }; // 归一化对角线
    for (let i = 0; i < 50; i++) {
      const H = importanceSampleGGX([Math.random(), Math.random()], N, 0.5);
      const len = Math.hypot(H.x, H.y, H.z);
      expect(len).toBeCloseTo(1.0, 4);
      const d = H.x * N.x + H.y * N.y + H.z * N.z;
      expect(d).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

// ── schlickFresnel 测试 ──────────────────────────────────────────

describe('schlickFresnel', () => {
  it('cosTheta=1 (normal incidence) → F0', () => {
    expect(schlickFresnel(1.0, 0.04)).toBeCloseTo(0.04, 6);
  });

  it('cosTheta=0 (grazing angle) → 1.0', () => {
    expect(schlickFresnel(0.0, 0.04)).toBeCloseTo(1.0, 6);
  });

  it('monotonically decreasing with cosTheta', () => {
    const f0 = 0.04;
    let prev = 2.0; // > 1
    for (let c = 0; c <= 1; c += 0.1) {
      const f = schlickFresnel(c, f0);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('returns F0 when cosTheta=1 regardless of F0 value', () => {
    expect(schlickFresnel(1.0, 0.0)).toBeCloseTo(0.0, 6);
    expect(schlickFresnel(1.0, 0.5)).toBeCloseTo(0.5, 6);
    expect(schlickFresnel(1.0, 1.0)).toBeCloseTo(1.0, 6);
  });

  it('clamps negative cosTheta to 0 (grazing)', () => {
    expect(schlickFresnel(-0.5, 0.04)).toBeCloseTo(1.0, 6);
  });
});

// ── reflectVec 测试 ──────────────────────────────────────────────

describe('reflectVec', () => {
  it('reflects view dir about normal (mirror case: V=N → R=V)', () => {
    // V = viewDir (surface→camera), H = normal. Mirror case: V ∥ H → R = V.
    const V: Vec3 = { x: 0, y: 0, z: 1 }; // viewDir toward +Z camera
    const H: Vec3 = { x: 0, y: 0, z: 1 }; // normal = +Z
    const R = reflectVec(V, H);
    // reflect(-V, H) = -V + 2*dot(V,H)*H = (0,0,-1) + 2*(0,0,1) = (0,0,1) = V
    expect(R.x).toBeCloseTo(0, 6);
    expect(R.y).toBeCloseTo(0, 6);
    expect(R.z).toBeCloseTo(1, 6);
  });

  it('reflects at 45° angle (x flips, z preserved)', () => {
    // V = (1,0,1): view from +X+Z diagonal, H = +Z normal
    const V: Vec3 = { x: 1, y: 0, z: 1 };
    const H: Vec3 = { x: 0, y: 0, z: 1 };
    const R = reflectVec(V, H);
    // dot(V,H) = 1; R = -V + 2*1*H = (-1,0,-1) + (0,0,2) = (-1,0,1)
    expect(R.x).toBeCloseTo(-1, 6);
    expect(R.y).toBeCloseTo(0, 6);
    expect(R.z).toBeCloseTo(1, 6);
  });

  it('preserves magnitude (|R| = |V| for unit H)', () => {
    const V: Vec3 = { x: 0.3, y: -0.4, z: 0.866 };
    const H: Vec3 = { x: 0, y: 0, z: 1 };
    const R = reflectVec(V, H);
    const lenV = Math.hypot(V.x, V.y, V.z);
    const lenR = Math.hypot(R.x, R.y, R.z);
    expect(lenR).toBeCloseTo(lenV, 5);
  });
});

// ── MockGL2(复用 SSR/HeightFog 模式) ────────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly READ_FRAMEBUFFER = 0x8CA8;
  static readonly DRAW_FRAMEBUFFER = 0x8CA9;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly HALF_FLOAT = 0x8D61;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly FLOAT = 0x1406;
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

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly READ_FRAMEBUFFER = MockGL2.READ_FRAMEBUFFER;
  readonly DRAW_FRAMEBUFFER = MockGL2.DRAW_FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly FLOAT = MockGL2.FLOAT;
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

  canvas: { width: number; height: number } = { width: 256, height: 256 };

  createdTextures: unknown[] = [];
  deletedTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  deletedFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  drawCalls = 0;
  blitCalls = 0;

  private _counter = 0;
  private _nextId(): unknown {
    this._counter++;
    return { id: this._counter } as unknown;
  }

  createTexture(): WebGLTexture { const t = this._nextId() as WebGLTexture; this.createdTextures.push(t); return t; }
  createFramebuffer(): WebGLFramebuffer { const f = this._nextId() as WebGLFramebuffer; this.createdFramebuffers.push(f); return f; }
  createBuffer(): WebGLBuffer { return this._nextId() as WebGLBuffer; }
  createVertexArray(): WebGLVertexArrayObject { return this._nextId() as WebGLVertexArrayObject; }
  createProgram(): WebGLProgram { return this._nextId() as WebGLProgram; }
  createShader(_type: number): WebGLShader { return this._nextId() as WebGLShader; }

  deleteTexture(t: WebGLTexture | null): void { if (t) this.deletedTextures.push(t); }
  deleteFramebuffer(f: WebGLFramebuffer | null): void { if (f) this.deletedFramebuffers.push(f); }
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
  getProgramParameter(_p: WebGLProgram, pname: number): unknown {
    if (pname === this.LINK_STATUS) return true;
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
  blitFramebuffer(..._args: unknown[]): void { this.blitCalls++; }
}

// ── MockCamera ───────────────────────────────────────────────────

class MockCamera {
  projectionMatrix = { elements: new Float32Array(16) };
  matrixWorldInverse = { elements: new Float32Array(16) };
  position = { x: 0, y: 0, z: 5 };
}

// ── SSSRPass 构造 ────────────────────────────────────────────────

describe('SSSRPass construction', () => {
  it('defaults', () => {
    const p = new SSSRPass();
    expect(p.maxSteps).toBe(64);
    expect(p.thickness).toBe(0.5);
    expect(p.resolution).toBe(0.5);
    expect(p.reflectionStrength).toBe(0.5);
    expect(p.roughnessCutoff).toBe(0.8);
    expect(p.roughnessBias).toBe(0.0);
    expect(p.temporalWeight).toBe(0.88);
    expect(p.frame).toBe(0);
  });

  it('accepts all options', () => {
    const p = new SSSRPass({
      maxSteps: 32,
      thickness: 1.0,
      resolution: 1.0,
      reflectionStrength: 0.8,
      roughnessCutoff: 0.6,
      roughnessBias: 0.05,
      temporalWeight: 0.9,
    });
    expect(p.maxSteps).toBe(32);
    expect(p.thickness).toBe(1.0);
    expect(p.resolution).toBe(1.0);
    expect(p.reflectionStrength).toBe(0.8);
    expect(p.roughnessCutoff).toBe(0.6);
    expect(p.roughnessBias).toBe(0.05);
    expect(p.temporalWeight).toBe(0.9);
  });
});

// ── SSSRPass.apply ───────────────────────────────────────────────

describe('SSSRPass.apply', () => {
  function makeMockGL(): MockGL2 {
    const gl = new MockGL2();
    gl.canvas = { width: 128, height: 128 };
    return gl;
  }

  function mockTexture(gl: MockGL2): WebGLTexture {
    return gl.createTexture();
  }

  it('does not throw and returns a texture', () => {
    const gl = makeMockGL();
    const pass = new SSSRPass({ resolution: 0.5 });
    const camera = new MockCamera() as unknown as Camera;
    const result = pass.apply(
      gl as unknown as WebGL2RenderingContext,
      mockTexture(gl),
      mockTexture(gl),
      mockTexture(gl),
      camera,
    );
    expect(result).toBeDefined();
    expect(gl.createdTextures.length).toBeGreaterThan(0);
  });

  it('allocates output + history textures (RGBA16F ping-pong)', () => {
    const gl = makeMockGL();
    const pass = new SSSRPass({ resolution: 0.5 });
    const camera = new MockCamera() as unknown as Camera;
    pass.apply(
      gl as unknown as WebGL2RenderingContext,
      mockTexture(gl),
      mockTexture(gl),
      mockTexture(gl),
      camera,
    );
    // 3 input + 2 internal (output + history) = 5
    expect(gl.createdTextures.length).toBe(5);
  });

  it('increments frame counter after apply', () => {
    const gl = makeMockGL();
    const pass = new SSSRPass();
    const camera = new MockCamera() as unknown as Camera;
    const t1 = mockTexture(gl), t2 = mockTexture(gl), t3 = mockTexture(gl);
    expect(pass.frame).toBe(0);
    pass.apply(gl as unknown as WebGL2RenderingContext, t1, t2, t3, camera);
    expect(pass.frame).toBe(1);
    pass.apply(gl as unknown as WebGL2RenderingContext, t1, t2, t3, camera);
    expect(pass.frame).toBe(2);
  });

  it('issues draw call for full-screen quad', () => {
    const gl = makeMockGL();
    const pass = new SSSRPass();
    const camera = new MockCamera() as unknown as Camera;
    pass.apply(gl as unknown as WebGL2RenderingContext, mockTexture(gl), mockTexture(gl), mockTexture(gl), camera);
    expect(gl.drawCalls).toBe(1);
  });

  it('blits to history when temporalWeight > 0', () => {
    const gl = makeMockGL();
    const pass = new SSSRPass({ temporalWeight: 0.88 });
    const camera = new MockCamera() as unknown as Camera;
    pass.apply(gl as unknown as WebGL2RenderingContext, mockTexture(gl), mockTexture(gl), mockTexture(gl), camera);
    expect(gl.blitCalls).toBe(1);
  });

  it('skips blit when temporalWeight = 0', () => {
    const gl = makeMockGL();
    const pass = new SSSRPass({ temporalWeight: 0.0 });
    const camera = new MockCamera() as unknown as Camera;
    pass.apply(gl as unknown as WebGL2RenderingContext, mockTexture(gl), mockTexture(gl), mockTexture(gl), camera);
    expect(gl.blitCalls).toBe(0);
  });

  it('second apply reuses resources (no realloc on same size)', () => {
    const gl = makeMockGL();
    const pass = new SSSRPass({ resolution: 0.5 });
    const camera = new MockCamera() as unknown as Camera;
    // 复用输入纹理避免 mockTexture 创建新纹理干扰计数
    const t1 = mockTexture(gl), t2 = mockTexture(gl), t3 = mockTexture(gl);
    pass.apply(gl as unknown as WebGL2RenderingContext, t1, t2, t3, camera);
    const texAfterFirst = gl.createdTextures.length;
    pass.apply(gl as unknown as WebGL2RenderingContext, t1, t2, t3, camera);
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });
});

// ── dispose ──────────────────────────────────────────────────────

describe('SSSRPass.dispose', () => {
  it('frees GL textures and FBOs after init', () => {
    const gl = new MockGL2();
    gl.canvas = { width: 128, height: 128 };
    const pass = new SSSRPass();
    const camera = new MockCamera() as unknown as Camera;
    pass.apply(gl as unknown as WebGL2RenderingContext, gl.createTexture(), gl.createTexture(), gl.createTexture(), camera);
    const createdTex = gl.createdTextures.length;
    pass.dispose(gl as unknown as WebGL2RenderingContext);
    // output + history textures deleted
    expect(gl.deletedTextures.length).toBeGreaterThanOrEqual(2);
    // FBOs deleted
    expect(gl.deletedFramebuffers.length).toBeGreaterThanOrEqual(2);
    expect(gl.deletedTextures.length).toBeLessThanOrEqual(createdTex);
  });

  it('is safe to call without GL context (null-safe)', () => {
    const pass = new SSSRPass();
    expect(() => pass.dispose()).not.toThrow();
  });

  it('can re-init after dispose (lazy rebuild)', () => {
    const gl = new MockGL2();
    gl.canvas = { width: 128, height: 128 };
    const pass = new SSSRPass();
    const camera = new MockCamera() as unknown as Camera;
    pass.apply(gl as unknown as WebGL2RenderingContext, gl.createTexture(), gl.createTexture(), gl.createTexture(), camera);
    pass.dispose(gl as unknown as WebGL2RenderingContext);
    // re-apply should rebuild
    expect(() => pass.apply(gl as unknown as WebGL2RenderingContext, gl.createTexture(), gl.createTexture(), gl.createTexture(), camera)).not.toThrow();
  });
});
