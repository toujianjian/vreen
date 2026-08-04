// CloudShadowPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. apply() 在 mock GL 下不抛错并返回纹理
//   3. apply() 首帧分配内部纹理 + FBO + VAO + buffer + program
//   4. apply() 同尺寸不重复分配
//   5. apply() 禁用时返回输入纹理(零 draw call)
//   6. apply() 分辨率变化时重建
//   7. setDirty() 触发重建
//   8. dispose() 释放资源(幂等)
//   9. dispose() 无 gl 参数
//  10. dispose() 重复调用
//  11. 字段可更新(shadowSteps / shadowIntensity / densityCutoff / enabled)
//  12. 着色器源码校验
//  13. 多次 apply 触发多次 draw call

import { describe, it, expect } from 'vitest';
import { CloudShadowPass } from './CloudShadowPass';
import { CLOUD_SHADOW_FRAG } from '../../Materials/shaders';

// ── MockGL2(支持 TEXTURE_3D / uniformMatrix4fv / 全屏四边形) ──────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE_3D = 0x806F;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
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
  readonly TEXTURE_3D = MockGL2.TEXTURE_3D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
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
  texImage3D(..._a: unknown[]): void {}
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

function makeNoiseTexture(gl: MockGL2): WebGLTexture {
  return gl.createTexture();
}

function makeParams(gl: MockGL2) {
  return {
    noiseTexture: makeNoiseTexture(gl),
    inverseViewProjection: new Float32Array(16),
    sunDirection: [0.3, 0.8, 0.1] as [number, number, number],
    cloudHeight: 1500,
    cloudThickness: 800,
    cloudCoverage: 0.5,
    cloudDensity: 0.6,
    windOffset: [50, 0, 20] as [number, number, number],
    worldScale: 1024,
    heightDensityBottom: 0.5,
    heightDensityTop: 0.3,
  };
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('CloudShadowPass construction', () => {
  it('defaults', () => {
    const p = new CloudShadowPass();
    expect(p.name).toBe('cloudshadow');
    expect(p.shadowSteps).toBe(16);
    expect(p.shadowIntensity).toBe(0.7);
    expect(p.densityCutoff).toBe(0.01);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new CloudShadowPass({
      shadowSteps: 32,
      shadowIntensity: 0.9,
      densityCutoff: 0.02,
      enabled: false,
    });
    expect(p.shadowSteps).toBe(32);
    expect(p.shadowIntensity).toBe(0.9);
    expect(p.densityCutoff).toBe(0.02);
    expect(p.enabled).toBe(false);
  });

  it('shadowSteps is updatable', () => {
    const p = new CloudShadowPass();
    expect(p.shadowSteps).toBe(16);
    p.shadowSteps = 24;
    expect(p.shadowSteps).toBe(24);
  });

  it('shadowIntensity is updatable', () => {
    const p = new CloudShadowPass();
    p.shadowIntensity = 0.5;
    expect(p.shadowIntensity).toBe(0.5);
  });

  it('densityCutoff is updatable', () => {
    const p = new CloudShadowPass();
    p.densityCutoff = 0.05;
    expect(p.densityCutoff).toBe(0.05);
  });

  it('enabled is updatable', () => {
    const p = new CloudShadowPass();
    expect(p.enabled).toBe(true);
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });

  it('zero shadowIntensity is a valid configuration (no darkening)', () => {
    const p = new CloudShadowPass({ shadowIntensity: 0 });
    expect(p.shadowIntensity).toBe(0);
  });

  it('full shadowIntensity (1.0) means shadow = transmittance', () => {
    const p = new CloudShadowPass({ shadowIntensity: 1.0 });
    expect(p.shadowIntensity).toBe(1.0);
  });

  it('single shadow step is valid (cheapest)', () => {
    const p = new CloudShadowPass({ shadowSteps: 1 });
    expect(p.shadowSteps).toBe(1);
  });

  it('64 shadow steps is valid (max)', () => {
    const p = new CloudShadowPass({ shadowSteps: 64 });
    expect(p.shadowSteps).toBe(64);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('CloudShadowPass apply', () => {
  it('apply() does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl))).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('first apply allocates resources (1 output texture + 1 FBO + 1 VAO + 1 buffer)', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    // makeParams 又创建 1 个 noise texture
    const params = makeParams(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    // input(1) + depth(1) + noise(1) + output(1) = 4 textures
    expect(gl.createdTextures.length).toBe(4);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
  });

  it('second apply does not re-allocate (same size)', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    const params = makeParams(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    const texBefore = gl.createdTextures.length;
    const fboBefore = gl.createdFramebuffers.length;
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    expect(gl.createdTextures.length).toBe(texBefore);
    expect(gl.createdFramebuffers.length).toBe(fboBefore);
  });

  it('disabled apply returns input texture and skips draw call', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass({ enabled: false });
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl));
    expect(result).toBe(input);
    expect(gl.drawCalls).toBe(0);
    // input + depth + noise = 3,无 output
    expect(gl.createdTextures.length).toBe(3);
  });

  it('apply on resolution change rebuilds output texture + FBO', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    const params = makeParams(gl);
    gl.canvas = { width: 800, height: 600 };
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    const texBefore = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
    expect(gl.createdFramebuffers.length).toBe(2);
  });

  it('setDirty() triggers re-allocation on next apply', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    const params = makeParams(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });

  it('apply returns output texture (not input) when enabled', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    const result = p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl));
    expect(result).not.toBe(input);
    expect(result).toBeDefined();
  });

  it('apply with shadowSteps=1 still works (cheap path)', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass({ shadowSteps: 1 });
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl))).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with shadowSteps=64 still works (high-quality path)', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass({ shadowSteps: 64 });
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl))).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply with shadowIntensity=0 still runs shader (no-op darkening)', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass({ shadowIntensity: 0 });
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl))).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('multiple applies issue multiple draw calls', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    const params = makeParams(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    expect(gl.drawCalls).toBe(3);
  });

  it('apply accepts typical VolumetricClouds uniform pack values', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    // 模拟 VolumetricClouds.getShaderUniforms() 输出
    const params = {
      noiseTexture: makeNoiseTexture(gl),
      inverseViewProjection: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
      sunDirection: [0.5, 0.7, 0.3] as [number, number, number],
      cloudHeight: 1200,
      cloudThickness: 600,
      cloudCoverage: 0.65,
      cloudDensity: 0.55,
      windOffset: [120, 0, 60] as [number, number, number],
      worldScale: 2048,
      heightDensityBottom: 0.4,
      heightDensityTop: 0.25,
    };
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params)).not.toThrow();
  });
});

// ── dispose ───────────────────────────────────────────────────────

describe('CloudShadowPass dispose', () => {
  it('dispose() does not throw and releases resources', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl));
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl does not throw', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl));
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, makeParams(gl));
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('can re-apply after dispose (re-initializes)', () => {
    const gl = new MockGL2();
    const p = new CloudShadowPass();
    const input = makeInputTexture(gl);
    const depth = makeInputTexture(gl);
    const params = makeParams(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const drawsBefore = gl.drawCalls;
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input, depth, params)).not.toThrow();
    expect(gl.drawCalls).toBe(drawsBefore + 1);
  });
});

// ── 着色器源码校验 ─────────────────────────────────────────────────

describe('CloudShadowPass shader source', () => {
  it('CLOUD_SHADOW_FRAG has correct version and precision', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('#version 300 es');
    expect(CLOUD_SHADOW_FRAG).toContain('precision highp float');
  });

  it('CLOUD_SHADOW_FRAG has all uniforms', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('u_colorMap');
    expect(CLOUD_SHADOW_FRAG).toContain('u_depthMap');
    expect(CLOUD_SHADOW_FRAG).toContain('u_noiseMap');
    expect(CLOUD_SHADOW_FRAG).toContain('u_inverseViewProjection');
    expect(CLOUD_SHADOW_FRAG).toContain('u_sunDirection');
    expect(CLOUD_SHADOW_FRAG).toContain('u_cloudHeight');
    expect(CLOUD_SHADOW_FRAG).toContain('u_cloudThickness');
    expect(CLOUD_SHADOW_FRAG).toContain('u_cloudCoverage');
    expect(CLOUD_SHADOW_FRAG).toContain('u_cloudDensity');
    expect(CLOUD_SHADOW_FRAG).toContain('u_windOffset');
    expect(CLOUD_SHADOW_FRAG).toContain('u_worldScale');
    expect(CLOUD_SHADOW_FRAG).toContain('u_heightDensityBottom');
    expect(CLOUD_SHADOW_FRAG).toContain('u_heightDensityTop');
    expect(CLOUD_SHADOW_FRAG).toContain('u_shadowSteps');
    expect(CLOUD_SHADOW_FRAG).toContain('u_shadowIntensity');
    expect(CLOUD_SHADOW_FRAG).toContain('u_densityCutoff');
    expect(CLOUD_SHADOW_FRAG).toContain('u_enabled');
  });

  it('CLOUD_SHADOW_FRAG samples 3D noise texture (sampler3D)', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('uniform sampler3D u_noiseMap');
  });

  it('CLOUD_SHADOW_FRAG implements sampleCloudDensity()', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('float sampleCloudDensity(vec3 worldPos)');
  });

  it('CLOUD_SHADOW_FRAG uses Beer-Lambert transmittance', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('opticalDepth');
    expect(CLOUD_SHADOW_FRAG).toContain('exp(-opticalDepth)');
    expect(CLOUD_SHADOW_FRAG).toContain('transmittance');
  });

  it('CLOUD_SHADOW_FRAG accumulates optical depth in ray-march loop', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('for (int i = 0; i < 64; i++)');
    expect(CLOUD_SHADOW_FRAG).toContain('opticalDepth += density * stepLen');
  });

  it('CLOUD_SHADOW_FRAG applies shadow factor via mix(1, T, intensity)', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('mix(1.0, transmittance, u_shadowIntensity)');
    expect(CLOUD_SHADOW_FRAG).toContain('shadowFactor');
  });

  it('CLOUD_SHADOW_FRAG reconstructs world position from NDC depth', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('u_inverseViewProjection * vec4(ndc');
    expect(CLOUD_SHADOW_FRAG).toContain('depth * 2.0 - 1.0');
  });

  it('CLOUD_SHADOW_FRAG skips sky pixels (depth >= 1.0)', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('depth >= 1.0');
  });

  it('CLOUD_SHADOW_FRAG early-exits when sun is below horizon', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('sunDir.y <= 0.0');
  });

  it('CLOUD_SHADOW_FRAG computes cloud layer entry/exit parameters', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('tEnter');
    expect(CLOUD_SHADOW_FRAG).toContain('tExit');
  });

  it('CLOUD_SHADOW_FRAG skips low-density voxels (densityCutoff)', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('u_densityCutoff');
    expect(CLOUD_SHADOW_FRAG).toContain('density > u_densityCutoff');
  });

  it('CLOUD_SHADOW_FRAG disables cleanly (u_enabled == 0 passthrough)', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('u_enabled == 0');
    expect(CLOUD_SHADOW_FRAG).toContain('return');
  });

  it('CLOUD_SHADOW_FRAG outputs darkened scene color', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('sceneColor * shadowFactor');
  });

  it('CLOUD_SHADOW_FRAG applies height density attenuation (bottom + top)', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('u_heightDensityBottom');
    expect(CLOUD_SHADOW_FRAG).toContain('u_heightDensityTop');
    expect(CLOUD_SHADOW_FRAG).toContain('bottomAtten');
    expect(CLOUD_SHADOW_FRAG).toContain('topAtten');
  });

  it('CLOUD_SHADOW_FRAG applies wind offset to UVW', () => {
    expect(CLOUD_SHADOW_FRAG).toContain('u_windOffset.x');
    expect(CLOUD_SHADOW_FRAG).toContain('u_windOffset.z');
  });
});
