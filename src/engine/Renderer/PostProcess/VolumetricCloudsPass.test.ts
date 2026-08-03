// VolumetricCloudsPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. uploadNoise() 在 mock GL 下不抛错并创建 3D 纹理
//   3. apply() 在 mock GL 下不抛错并返回纹理
//   4. apply() 首帧分配内部纹理 + FBO + VAO + buffer + program
//   5. apply() 同尺寸不重复分配
//   6. apply() 未上传噪声时降级返回输入纹理
//   7. apply() clouds.enabled=false 时降级返回输入纹理
//   8. dispose() 释放资源(幂等)
//   9. VOLUMETRIC_CLOUDS_FRAG shader 源码校验

import { describe, it, expect } from 'vitest';
import { VolumetricCloudsPass } from './VolumetricCloudsPass';
import { VolumetricClouds } from '../../Environment/VolumetricClouds';
import { PerspectiveCamera } from '../../Cameras/PerspectiveCamera';
import { VOLUMETRIC_CLOUDS_FRAG } from '../../Materials/shaders';

// ── MockGL2(扩展 HeightFogPass.test.ts 的 mock,增加 TEXTURE_3D / texImage3D) ──

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE_3D = 0x806F;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TEXTURE3 = 0x84C3;
  static readonly READ_FRAMEBUFFER = 0x8CA8;
  static readonly DRAW_FRAMEBUFFER = 0x8CA9;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly R16F = 0x822D;
  static readonly RED = 0x1903;
  static readonly FLOAT = 0x1406;
  static readonly HALF_FLOAT = 0x140B;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly TEXTURE_WRAP_R = 0x8072;
  static readonly LINEAR = 0x2601;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly REPEAT = 0x2901;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE_3D = MockGL2.TEXTURE_3D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TEXTURE3 = MockGL2.TEXTURE3;
  readonly READ_FRAMEBUFFER = MockGL2.READ_FRAMEBUFFER;
  readonly DRAW_FRAMEBUFFER = MockGL2.DRAW_FRAMEBUFFER;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly R16F = MockGL2.R16F;
  readonly RED = MockGL2.RED;
  readonly FLOAT = MockGL2.FLOAT;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly TEXTURE_WRAP_R = MockGL2.TEXTURE_WRAP_R;
  readonly LINEAR = MockGL2.LINEAR;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly REPEAT = MockGL2.REPEAT;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;

  canvas: { width: number; height: number } = { width: 800, height: 600 };

  createdTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  createdShaders: unknown[] = [];
  drawCalls = 0;
  texImage3DCalls = 0;
  texImage2DCalls = 0;
  blitCalls = 0;

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
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_m: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_u: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._a: unknown[]): void { this.texImage2DCalls++; }
  texImage3D(..._a: unknown[]): void { this.texImage3DCalls++; }
  texParameteri(_t: number, _p: number, _v: number): void {}
  framebufferTexture2D(..._a: unknown[]): void {}
  pixelStorei(_p: number, _v: number): void {}
  bindVertexArray(_v: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _b: WebGLBuffer | null): void {}
  bufferData(_t: number, _d: BufferSource, _u: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
  blitFramebuffer(..._a: unknown[]): void { this.blitCalls++; }
}

function makeTexture(id: string): WebGLTexture { return { id } as unknown as WebGLTexture; }
function makeCamera(): PerspectiveCamera { return new PerspectiveCamera(60, 1.5, 0.1, 200); }
function makeClouds(): VolumetricClouds { return new VolumetricClouds(); }

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('VolumetricCloudsPass construction', () => {
  it('defaults', () => {
    const p = new VolumetricCloudsPass();
    expect(p.name).toBe('volumetric-clouds');
    expect(p.worldScale).toBe(1024);
    expect(p.shadowStepLen).toBe(8);
    expect(p.densityCutoff).toBe(0.01);
    expect(p.hasNoise).toBe(false);
  });

  it('accepts all options', () => {
    const p = new VolumetricCloudsPass({
      worldScale: 2048,
      shadowStepLen: 16,
      densityCutoff: 0.02,
    });
    expect(p.worldScale).toBe(2048);
    expect(p.shadowStepLen).toBe(16);
    expect(p.densityCutoff).toBe(0.02);
  });

  it('defaults temporalBlend to 0 (disabled, backward compatible)', () => {
    const p = new VolumetricCloudsPass();
    expect(p.temporalBlend).toBe(0);
  });

  it('accepts temporalBlend option', () => {
    const p = new VolumetricCloudsPass({ temporalBlend: 0.9 });
    expect(p.temporalBlend).toBe(0.9);
  });
});

// ── uploadNoise ────────────────────────────────────────────────────

describe('VolumetricCloudsPass uploadNoise', () => {
  it('uploads 3D noise texture without throwing', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const data = new Float32Array(8 * 8 * 8);
    expect(() => p.uploadNoise(gl as unknown as WebGL2RenderingContext, data, { x: 8, y: 8, z: 8 })).not.toThrow();
    expect(p.hasNoise).toBe(true);
    expect(gl.texImage3DCalls).toBe(1);
  });

  it('re-allocates when resolution changes', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const d1 = new Float32Array(8 * 8 * 8);
    const d2 = new Float32Array(16 * 16 * 16);
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, d1, { x: 8, y: 8, z: 8 });
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, d2, { x: 16, y: 16, z: 16 });
    expect(gl.texImage3DCalls).toBe(2);
  });

  it('does not re-allocate when resolution is the same', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const d = new Float32Array(8 * 8 * 8);
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, d, { x: 8, y: 8, z: 8 });
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, d, { x: 8, y: 8, z: 8 });
    // 第二次只更新数据,不再重新分配(但仍调用 texImage3D 上传)
    expect(gl.texImage3DCalls).toBe(2);
    expect(gl.createdTextures.length).toBe(1);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('VolumetricCloudsPass apply', () => {
  it('degrades to input texture when no noise uploaded', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds();
    const inputTex = makeTexture('input');
    const out = p.apply(gl as unknown as WebGL2RenderingContext, inputTex, makeTexture('depth'), makeCamera(), clouds);
    expect(out).toBe(inputTex);
    expect(gl.drawCalls).toBe(0);
  });

  it('degrades to input texture when clouds disabled', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds().setEnabled(false);
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    const inputTex = makeTexture('input');
    const out = p.apply(gl as unknown as WebGL2RenderingContext, inputTex, makeTexture('depth'), makeCamera(), clouds);
    expect(out).toBe(inputTex);
    expect(gl.drawCalls).toBe(0);
  });

  it('apply() does not throw and returns a texture when noise uploaded', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('color'), makeTexture('depth'), makeCamera(), clouds);
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 color texture + 1 FBO + 1 VAO + 1 buffer + 1 program on first apply', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    // uploadNoise 创建 1 个 noise texture
    const texBeforeApply = gl.createdTextures.length;
    expect(texBeforeApply).toBe(1);

    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera(), clouds);
    // apply 应额外创建 1 个颜色纹理(共 2 个,但 noise + color = 2)
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera(), clouds);
    const texAfterFirst = gl.createdTextures.length;
    const fboAfterFirst = gl.createdFramebuffers.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera(), clouds);
    expect(gl.createdTextures.length).toBe(texAfterFirst);
    expect(gl.createdFramebuffers.length).toBe(fboAfterFirst);
  });

  it('returns the same output texture across apply() calls', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera(), clouds);
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera(), clouds);
    expect(t1).toBe(t2);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('VolumetricCloudsPass dispose', () => {
  it('dispose() is safe and idempotent', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera(), clouds);
    expect(() => { p.dispose(gl as unknown as WebGL2RenderingContext); p.dispose(gl as unknown as WebGL2RenderingContext); }).not.toThrow();
  });

  it('after dispose, apply() re-allocates resources', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass();
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera(), clouds);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    // dispose 后 noise 也被释放 → apply 应降级返回输入
    const inputTex = makeTexture('input2');
    const out = p.apply(gl as unknown as WebGL2RenderingContext, inputTex, makeTexture('d'), makeCamera(), clouds);
    expect(out).toBe(inputTex);
  });
});

// ── VOLUMETRIC_CLOUDS_FRAG shader 源码校验 ─────────────────────

describe('VOLUMETRIC_CLOUDS_FRAG shader source', () => {
  it('is GLSL ES 3.0', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('#version 300 es');
  });

  it('declares color / depth / 3D noise samplers', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_colorMap');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_depthMap');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_noiseMap');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('sampler3D');
  });

  it('reconstructs world position from depth', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_inverseViewProjection');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('worldPosH');
  });

  it('computes cloud layer intersection', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_cloudHeight');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_cloudThickness');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('tEnter');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('tExit');
  });

  it('implements Beer-Lambert + Beer-Powder', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('exp(-opticalDepth)');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('exp(-2.0 * opticalDepth)');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('beerPowder');
  });

  it('implements dual-lobed Henyey-Greenstein phase function', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_hgForwardG');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_hgBackwardG');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_hgForwardWeight');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('dualLobedHG');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('Henyey-Greenstein');
  });

  it('implements multi-scattering approximation', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_multiScatteringFactor');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_multiScatteringSteps');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('msEnergy');
  });

  it('supports height density modulation', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_heightDensityBottom');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_heightDensityTop');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('bottomAtten');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('topAtten');
  });

  it('supports cone-shadow sampling', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_coneRadius');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('cone');
  });

  it('implements early termination', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('transmittance < 0.01');
  });

  it('handles disabled state (u_enabled)', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_enabled');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_enabled == 0');
  });

  it('handles sky pixels (depth >= 1.0)', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('depth >= 1.0');
  });

  it('composites clouds over scene color', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('mix(sceneColor');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('cloudAlpha');
  });

  it('uses 3D noise sampler correctly', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('texture(u_noiseMap');
  });

  // ── v3 时序累积 shader 校验 ────────────────────────────────────

  it('declares v3 temporal uniforms', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_historyMap');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_prevViewProjection');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_temporalBlend');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_frameIndex');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_hasHistory');
  });

  it('implements Interleaved Gradient Noise (blue-noise dither)', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('ign');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('Jimenez 2014');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('jitter');
  });

  it('implements temporal EMA reprojection', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('u_prevViewProjection * vec4(hitWorldPos');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('prevUV');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('mix(finalColor, histColor');
  });

  it('rejects history on out-of-bounds reprojection (disocclusion)', () => {
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('greaterThanEqual(prevUV');
    expect(VOLUMETRIC_CLOUDS_FRAG).toContain('lessThanEqual(prevUV');
  });
});

// ── v3 时序累积(blue-noise + EMA)──────────────────────────────────

describe('VolumetricCloudsPass v3 temporal accumulation', () => {
  it('temporalBlend=0 (default) allocates NO history texture/FBO', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass(); // temporalBlend=0
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    const texBefore = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera(), clouds);
    // 仅 +1 颜色纹理(无 history)
    expect(gl.createdTextures.length).toBe(texBefore + 1);
    expect(gl.createdFramebuffers.length).toBe(1); // 仅 output FBO
    expect(gl.blitCalls).toBe(0);
  });

  it('temporalBlend=0.9 allocates extra history texture + FBO', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass({ temporalBlend: 0.9 });
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    const texBefore = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera(), clouds);
    // +2 纹理(output + history),+2 FBO(output + history)
    expect(gl.createdTextures.length).toBe(texBefore + 2);
    expect(gl.createdFramebuffers.length).toBe(2);
  });

  it('blits output to history each frame when temporal enabled', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass({ temporalBlend: 0.9 });
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c1'), makeTexture('d'), makeCamera(), clouds);
    expect(gl.blitCalls).toBe(1);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d'), makeCamera(), clouds);
    expect(gl.blitCalls).toBe(2);
  });

  it('does NOT blit when temporalBlend=0', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass(); // temporalBlend=0
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera(), clouds);
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d'), makeCamera(), clouds);
    expect(gl.blitCalls).toBe(0);
  });

  it('returns stable output texture handle even with temporal on', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass({ temporalBlend: 0.9 });
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera(), clouds);
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera(), clouds);
    expect(t1).toBe(t2);
  });

  it('dispose releases history texture + FBO', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass({ temporalBlend: 0.9 });
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera(), clouds);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
    // dispose 后 apply 降级返回输入(noise 已释放)
    const inputTex = makeTexture('input2');
    const out = p.apply(gl as unknown as WebGL2RenderingContext, inputTex, makeTexture('d'), makeCamera(), clouds);
    expect(out).toBe(inputTex);
  });

  it('does not throw across many temporal frames', () => {
    const gl = new MockGL2();
    const p = new VolumetricCloudsPass({ temporalBlend: 0.85 });
    const clouds = makeClouds();
    p.uploadNoise(gl as unknown as WebGL2RenderingContext, new Float32Array(8 * 8 * 8), { x: 8, y: 8, z: 8 });
    expect(() => {
      for (let i = 0; i < 10; i++) {
        p.apply(gl as unknown as WebGL2RenderingContext, makeTexture(`c${i}`), makeTexture('d'), makeCamera(), clouds);
      }
    }).not.toThrow();
    expect(gl.blitCalls).toBe(10);
  });
});
