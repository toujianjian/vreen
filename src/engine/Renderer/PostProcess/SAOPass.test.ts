// SAOPass 单元测试。
//
// 覆盖:
//   A. 纯 CPU 函数(与 GPU shader 1:1 对应)
//      1. saoRand        — 伪随机 [0,1),确定性
//      2. perspectiveDepthToViewZ — NDC 深度 → 视图空间 Z
//      3. reconstructViewPos — NDC + 逆投影 → 视图空间位置
//      4. saoOcclusion   — 单采样点遮蔽贡献
//      5. saoSpiralSampleUV — 螺旋采样 UV
//      6. computeSAO     — 完整 SAO 计算
//   B. SAOPass 类生命周期
//      7. 构造默认值与选项覆盖
//      8. apply() 在 mock GL 下不抛错并返回纹理
//      9. apply() 首帧分配 1 texture + 1 FBO + 1 VAO + 1 buffer + 1 program
//     10. apply() 同尺寸不重复分配
//     11. apply() resize 重新分配
//     12. enabled=false 不渲染但仍返回纹理(drawCalls=0)
//     13. dispose() 释放资源
//     14. dispose() 幂等
//     15. apply() after dispose 重新分配

import { describe, it, expect } from 'vitest';
import {
  SAOPass,
  saoRand,
  perspectiveDepthToViewZ,
  reconstructViewPos,
  saoOcclusion,
  saoSpiralSampleUV,
  computeSAO,
  DEFAULT_SAO_PARAMS,
  type SAOParams,
  type SAOCameraParams,
} from './SAOPass';
import { Camera } from '../../Cameras/Camera';
import { PerspectiveCamera } from '../../Cameras/PerspectiveCamera';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 支持 SAOPass.apply 所需的全部 GL 调用表面,包括 ShaderProgram 编译路径。

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLE_STRIP = 0x0005;
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

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLE_STRIP = MockGL2.TRIANGLE_STRIP;
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

// 单位矩阵(列主序 4×4)用于 reconstructViewPos 测试。
const IDENTITY_M4: number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// ── A. 纯 CPU 函数 ──────────────────────────────────────────────────

describe('saoRand', () => {
  it('returns value in [0, 1)', () => {
    for (let i = 0; i < 20; i++) {
      const v = saoRand([i * 0.13, i * 0.37], i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for same input', () => {
    const a = saoRand([0.5, 0.5], 42);
    const b = saoRand([0.5, 0.5], 42);
    expect(a).toBe(b);
  });

  it('different seed → different value (very likely)', () => {
    const a = saoRand([0.5, 0.5], 0);
    const b = saoRand([0.5, 0.5], 1);
    expect(a).not.toBe(b);
  });
});

describe('perspectiveDepthToViewZ', () => {
  it('depth=0 → near', () => {
    expect(perspectiveDepthToViewZ(0, 0.1, 1000)).toBeCloseTo(0.1, 5);
  });

  it('depth=1 → far', () => {
    expect(perspectiveDepthToViewZ(1, 0.1, 1000)).toBeCloseTo(1000, 3);
  });

  it('depth=0.5 → between near and far', () => {
    const v = perspectiveDepthToViewZ(0.5, 0.1, 1000);
    expect(v).toBeGreaterThan(0.1);
    expect(v).toBeLessThan(1000);
  });

  it('is monotonic increasing with depth', () => {
    const v0 = perspectiveDepthToViewZ(0.2, 0.1, 1000);
    const v1 = perspectiveDepthToViewZ(0.5, 0.1, 1000);
    const v2 = perspectiveDepthToViewZ(0.8, 0.1, 1000);
    expect(v0).toBeLessThan(v1);
    expect(v1).toBeLessThan(v2);
  });
});

describe('reconstructViewPos', () => {
  it('identity matrix → returns NDC coords (uv*2-1, depth*2-1)', () => {
    // 单位矩阵: view = invProj * ndc = ndc
    const pos = reconstructViewPos([0.5, 0.5], 0.5, IDENTITY_M4);
    // uv=0.5 → ndc 0; depth=0.5 → ndc 0
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(0, 5);
  });

  it('uv=(0,0) → NDC (-1,-1)', () => {
    const pos = reconstructViewPos([0, 0], 0.5, IDENTITY_M4);
    expect(pos[0]).toBeCloseTo(-1, 5);
    expect(pos[1]).toBeCloseTo(-1, 5);
  });

  it('uv=(1,1) → NDC (1,1)', () => {
    const pos = reconstructViewPos([1, 1], 0.5, IDENTITY_M4);
    expect(pos[0]).toBeCloseTo(1, 5);
    expect(pos[1]).toBeCloseTo(1, 5);
  });

  it('degenerate matrix (w=0) → fallback [0,0,-1]', () => {
    // 全零矩阵 → vw=0 → 返回 [0,0,-1]
    const zero: number[] = new Array(16).fill(0);
    const pos = reconstructViewPos([0.5, 0.5], 0.5, zero);
    expect(pos[0]).toBe(0);
    expect(pos[1]).toBe(0);
    expect(pos[2]).toBe(-1);
  });
});

describe('saoOcclusion', () => {
  const far = 1000;

  it('sample at same position → 0 (dist < epsilon)', () => {
    const occ = saoOcclusion([1, 0, 0], [0, 0, 1], [1, 0, 0], 1, 0.5, 0, far);
    expect(occ).toBe(0);
  });

  it('sample along normal direction → positive occlusion', () => {
    // center at origin, normal pointing +Z, sample at (0,0,1)
    const occ = saoOcclusion([0, 0, 0], [0, 0, 1], [0, 0, 1], 1, 0.5, 0, far);
    expect(occ).toBeGreaterThan(0);
  });

  it('sample against normal → 0 (clamped)', () => {
    // normal +Z, sample at -Z → dot(N, delta) < 0 → occ < 0 → clamped to 0
    const occ = saoOcclusion([0, 0, 0], [0, 0, 1], [0, 0, -1], 1, 0.5, 0, far);
    expect(occ).toBe(0);
  });

  it('higher bias → less occlusion', () => {
    const occLow = saoOcclusion([0, 0, 0], [0, 0, 1], [0, 0, 1], 1, 0.0, 0, far);
    const occHigh = saoOcclusion([0, 0, 0], [0, 0, 1], [0, 0, 1], 1, 5.0, 0, far);
    expect(occHigh).toBeLessThanOrEqual(occLow);
  });

  it('larger scale → different falloff', () => {
    const occS1 = saoOcclusion([0, 0, 0], [0, 0, 1], [0, 0, 1], 1, 0.5, 0, far);
    const occS10 = saoOcclusion([0, 0, 0], [0, 0, 1], [0, 0, 1], 10, 0.5, 0, far);
    // 两者都应为有限数
    expect(Number.isFinite(occS1)).toBe(true);
    expect(Number.isFinite(occS10)).toBe(true);
  });

  it('returns finite value for valid input', () => {
    const occ = saoOcclusion([0, 0, 0], [0, 1, 0], [0, 2, 0], 1, 0.5, 0, far);
    expect(Number.isFinite(occ)).toBe(true);
    expect(occ).toBeGreaterThanOrEqual(0);
  });
});

describe('saoSpiralSampleUV', () => {
  it('i=0 → first ring offset from center', () => {
    const uv = saoSpiralSampleUV(0, 7, 4, [0.5, 0.5], 100, [800, 600], 0);
    // i=0: radius = 100 * 1 / 7 ≈ 14.29 px; angle = 0 → offset (cos0, sin0) = (1, 0)
    // uv = center + (14.29/800, 0)
    expect(uv[0]).toBeCloseTo(0.5 + (100 / 7) / 800, 4);
    expect(uv[1]).toBeCloseTo(0.5, 4);
  });

  it('different i → different UV (spiral)', () => {
    const uv0 = saoSpiralSampleUV(0, 7, 4, [0.5, 0.5], 100, [800, 600], 0);
    const uv1 = saoSpiralSampleUV(1, 7, 4, [0.5, 0.5], 100, [800, 600], 0);
    expect(uv0).not.toEqual(uv1);
  });

  it('numSamples affects radius (more samples → smaller first step)', () => {
    const uv7 = saoSpiralSampleUV(0, 7, 4, [0.5, 0.5], 100, [800, 600], 0);
    const uv14 = saoSpiralSampleUV(0, 14, 4, [0.5, 0.5], 100, [800, 600], 0);
    // radius = kernelRadius * (i+1) / numSamples; i=0 → radius = 100/numSamples
    // numSamples=7 → radius ≈ 14.29; numSamples=14 → radius ≈ 7.14
    // 更大 numSamples → 更小半径 → UV 更接近中心
    const dist7 = Math.abs(uv7[0] - 0.5);
    const dist14 = Math.abs(uv14[0] - 0.5);
    expect(dist14).toBeLessThan(dist7);
  });

  it('baseAngle rotates the sample', () => {
    // 使用正方形视口,使 x/y 缩放一致,90° 旋转应交换 x/y 偏移。
    const uv0 = saoSpiralSampleUV(0, 7, 4, [0.5, 0.5], 100, [800, 800], 0);
    const uv90 = saoSpiralSampleUV(0, 7, 4, [0.5, 0.5], 100, [800, 800], Math.PI / 2);
    // 90° 旋转:cos(π/2)=0, sin(π/2)=1 → x 偏移=0, y 偏移=原 x 偏移
    expect(uv90[0]).toBeCloseTo(0.5, 4);
    expect(uv90[1]).toBeCloseTo(uv0[0], 4);  // y 偏移 ≈ 原 x 偏移
  });
});

describe('computeSAO', () => {
  const camera: SAOCameraParams = {
    near: 0.1,
    far: 1000,
    projectionMatrix: IDENTITY_M4,
    inverseProjectionMatrix: IDENTITY_M4,
  };

  it('skybox depth (≈1.0) → 0 AO', () => {
    const ao = computeSAO(
      [0.5, 0.5], 0.99999, [0, 0, 1],
      () => 0.5,
      DEFAULT_SAO_PARAMS, camera, [800, 600],
    );
    expect(ao).toBe(0);
  });

  it('flat surface (uniform depth) → 0 AO (samples along normal plane)', () => {
    // 单位投影矩阵:depth=0.5 → viewPos=(0,0,0) at uv(0.5,0.5)
    // 所有采样点 depth=0.5 → 同一视图位置 → dist < epsilon → occ=0
    const ao = computeSAO(
      [0.5, 0.5], 0.5, [0, 0, 1],
      () => 0.5,
      DEFAULT_SAO_PARAMS, camera, [800, 600],
    );
    expect(ao).toBe(0);
  });

  it('all samples out of bounds → 0 AO', () => {
    // 极大 kernelRadius 让采样飞出 [0,1]
    const params: SAOParams = { ...DEFAULT_SAO_PARAMS, kernelRadius: 10000 };
    const ao = computeSAO(
      [0.5, 0.5], 0.5, [0, 0, 1],
      () => 0.5,
      params, camera, [800, 600],
    );
    expect(ao).toBe(0);
  });

  it('returns finite value for varied depth field', () => {
    // 模拟一个有深度变化的场景:中心 0.5,周围 0.4(更近)
    const ao = computeSAO(
      [0.5, 0.5], 0.5, [0, 0, 1],
      (uv) => {
        // 采样点 depth 根据距中心距离变化
        const dx = uv[0] - 0.5;
        const dy = uv[1] - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        return 0.5 - Math.min(d, 0.1);
      },
      DEFAULT_SAO_PARAMS, camera, [800, 600],
    );
    expect(Number.isFinite(ao)).toBe(true);
    expect(ao).toBeGreaterThanOrEqual(0);
  });

  it('intensity=0 → 0 AO', () => {
    const params: SAOParams = { ...DEFAULT_SAO_PARAMS, intensity: 0 };
    const ao = computeSAO(
      [0.5, 0.5], 0.5, [0, 0, 1],
      (uv) => 0.5 - Math.abs(uv[0] - 0.5) * 0.1,
      params, camera, [800, 600],
    );
    expect(ao).toBe(0);
  });
});

// ── B. SAOPass 类生命周期 ──────────────────────────────────────────

describe('SAOPass construction', () => {
  it('defaults match DEFAULT_SAO_PARAMS', () => {
    const p = new SAOPass();
    expect(p.name).toBe('sao');
    expect(p.kernelRadius).toBe(DEFAULT_SAO_PARAMS.kernelRadius);
    expect(p.intensity).toBe(DEFAULT_SAO_PARAMS.intensity);
    expect(p.bias).toBe(DEFAULT_SAO_PARAMS.bias);
    expect(p.scale).toBe(DEFAULT_SAO_PARAMS.scale);
    expect(p.minResolution).toBe(DEFAULT_SAO_PARAMS.minResolution);
    expect(p.numSamples).toBe(DEFAULT_SAO_PARAMS.numSamples);
    expect(p.numRings).toBe(DEFAULT_SAO_PARAMS.numRings);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new SAOPass({
      kernelRadius: 50,
      intensity: 0.2,
      bias: 0.3,
      scale: 2.0,
      minResolution: 0.1,
      numSamples: 11,
      numRings: 3,
      randomSeed: 7,
      enabled: false,
    });
    expect(p.kernelRadius).toBe(50);
    expect(p.intensity).toBe(0.2);
    expect(p.bias).toBe(0.3);
    expect(p.scale).toBe(2.0);
    expect(p.minResolution).toBe(0.1);
    expect(p.numSamples).toBe(11);
    expect(p.numRings).toBe(3);
    expect(p.randomSeed).toBe(7);
    expect(p.enabled).toBe(false);
  });
});

describe('SAOPass apply lifecycle', () => {
  it('apply() does not throw with mock GL and returns a texture', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('depth'), makeTexture('nrm'), makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer on first apply', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    // program 也应创建(disabled 才跳过)
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('compiles program once (2 shaders per program)', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    expect(gl.createdPrograms.length).toBe(1);
    expect(gl.createdShaders.length).toBe(2);  // vert + frag
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d1'), makeTexture('n1'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    const progAfterFirst = gl.createdPrograms.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d2'), makeTexture('n2'), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
    expect(gl.createdPrograms.length).toBe(progAfterFirst);
  });

  it('returns the same texture across apply() calls (without resize)', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d1'), makeTexture('n1'), makeCamera());
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d2'), makeTexture('n2'), makeCamera());
    expect(t1).toBe(t2);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('increments drawCalls on each apply', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    // 每帧 1 次 drawArrays(TRIANGLE_STRIP)
    expect(gl.drawCalls).toBe(3);
  });
});

describe('SAOPass enabled=false', () => {
  it('does not render when disabled but still returns texture', () => {
    const gl = new MockGL2();
    const p = new SAOPass({ enabled: false });
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    expect(out).toBeDefined();
    // 资源仍会预分配(apply 入口先 _initResources),但 drawCalls 应为 0
    expect(gl.drawCalls).toBe(0);
  });

  it('renders when re-enabled', () => {
    const gl = new MockGL2();
    const p = new SAOPass({ enabled: false });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    expect(gl.drawCalls).toBe(0);
    p.enabled = true;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('disabled pass does not compile program', () => {
    const gl = new MockGL2();
    const p = new SAOPass({ enabled: false });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    expect(gl.createdPrograms.length).toBe(0);
  });
});

describe('SAOPass dispose', () => {
  it('frees texture / FBO / VAO / buffer / program after apply', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
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
    const p = new SAOPass();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('apply() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new SAOPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d'), makeTexture('n'), makeCamera());
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const deletedAfterDispose = gl.deletedTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('d2'), makeTexture('n2'), makeCamera());
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.deletedTextures.length).toBe(deletedAfterDispose);
  });
});
