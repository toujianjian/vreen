// WaterSurfacePass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. apply() 在 mock GL 下不抛错并返回纹理
//   3. apply() 首帧分配内部纹理 + FBO + VAO + buffer
//   4. apply() 同尺寸不重复分配
//   5. apply() 禁用时直接返回输入(零 draw call)
//   6. apply() resize 重新分配
//   7. dispose() 释放资源
//   8. setDirty() 触发重建
//   9. time 字段默认 0 且可更新
//  10. WATER_SURFACE_FRAG shader 源码校验

import { describe, it, expect } from 'vitest';
import { WaterSurfacePass } from './WaterSurfacePass';
import { PerspectiveCamera } from '../../Cameras/PerspectiveCamera';
import { WATER_SURFACE_FRAG } from '../../Materials/shaders';

// ── MockGL2(复用 CausticsPass.test.ts 模式,含 RGBA16F/HALF_FLOAT) ──

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly HALF_FLOAT = 0x140B;
  static readonly FLOAT = 0x1406;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly CLAMP_TO_EDGE = 0x812F;
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
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly FLOAT = MockGL2.FLOAT;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
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
  texImage2D(..._a: unknown[]): void {}
  texParameteri(_t: number, _p: number, _v: number): void {}
  framebufferTexture2D(..._a: unknown[]): void {}
  bindVertexArray(_v: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _b: WebGLBuffer | null): void {}
  bufferData(_t: number, _d: BufferSource, _u: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
}

function makeTexture(id: string): WebGLTexture { return { id } as unknown as WebGLTexture; }
function makeCamera(): PerspectiveCamera { return new PerspectiveCamera(60, 1.5, 0.1, 200); }

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('WaterSurfacePass construction', () => {
  it('defaults', () => {
    const p = new WaterSurfacePass();
    expect(p.name).toBe('watersurface');
    expect(p.waterLevel).toBe(0);
    expect(p.waterColor).toEqual([0.02, 0.1, 0.2]);
    expect(p.skyColor).toEqual([0.4, 0.6, 0.9]);
    expect(p.horizonColor).toEqual([0.7, 0.75, 0.8]);
    expect(p.sunDirection).toEqual([0.5, 0.5, -0.3]);
    expect(p.sunColor).toEqual([1.0, 0.95, 0.8]);
    expect(p.sunSpecular).toBe(1.0);
    expect(p.sunShininess).toBe(200.0);
    expect(p.waveAmplitude).toBe(0.3);
    expect(p.waveFrequency).toBe(0.1);
    expect(p.waveSpeed).toBe(1.0);
    expect(p.fresnelPower).toBe(5.0);
    expect(p.fresnelBias).toBe(0.02);
    expect(p.refractionOffset).toBe(0.01);
    expect(p.absorption).toBe(0.05);
    expect(p.enabled).toBe(true);
    expect(p.time).toBe(0);
  });

  it('accepts all options', () => {
    const p = new WaterSurfacePass({
      waterLevel: -5,
      waterColor: [0.01, 0.05, 0.1],
      skyColor: [0.5, 0.7, 1.0],
      horizonColor: [0.8, 0.8, 0.85],
      sunDirection: [0.0, 1.0, 0.0],
      sunColor: [1.0, 1.0, 1.0],
      sunSpecular: 2.0,
      sunShininess: 128.0,
      waveAmplitude: 0.6,
      waveFrequency: 0.2,
      waveSpeed: 1.5,
      fresnelPower: 4.0,
      fresnelBias: 0.04,
      refractionOffset: 0.02,
      absorption: 0.1,
      enabled: false,
    });
    expect(p.waterLevel).toBe(-5);
    expect(p.waterColor).toEqual([0.01, 0.05, 0.1]);
    expect(p.skyColor).toEqual([0.5, 0.7, 1.0]);
    expect(p.horizonColor).toEqual([0.8, 0.8, 0.85]);
    expect(p.sunDirection).toEqual([0.0, 1.0, 0.0]);
    expect(p.sunColor).toEqual([1.0, 1.0, 1.0]);
    expect(p.sunSpecular).toBe(2.0);
    expect(p.sunShininess).toBe(128.0);
    expect(p.waveAmplitude).toBe(0.6);
    expect(p.waveFrequency).toBe(0.2);
    expect(p.waveSpeed).toBe(1.5);
    expect(p.fresnelPower).toBe(4.0);
    expect(p.fresnelBias).toBe(0.04);
    expect(p.refractionOffset).toBe(0.02);
    expect(p.absorption).toBe(0.1);
    expect(p.enabled).toBe(false);
  });

  it('time field is updatable', () => {
    const p = new WaterSurfacePass();
    expect(p.time).toBe(0);
    p.time = 5.25;
    expect(p.time).toBe(5.25);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('WaterSurfacePass apply', () => {
  it('apply() does not throw and returns a texture', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('color'), makeTexture('depth'), makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer on first apply', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('disabled returns input texture with zero draw calls', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass({ enabled: false });
    const inputTex = makeTexture('input');
    const out = p.apply(gl as unknown as WebGL2RenderingContext, inputTex, makeTexture('d'), makeCamera());
    expect(out).toBe(inputTex);
    expect(gl.drawCalls).toBe(0);
    expect(gl.createdTextures.length).toBe(0); // no allocation when disabled
  });

  it('re-allocates on resize', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns stable output texture handle across apply calls', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(t1).toBe(t2);
  });

  it('does not throw across many frames with time animation', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    expect(() => {
      for (let i = 0; i < 10; i++) {
        p.time = i * 0.016;
        p.apply(gl as unknown as WebGL2RenderingContext, makeTexture(`c${i}`), makeTexture('d'), makeCamera());
      }
    }).not.toThrow();
    expect(gl.drawCalls).toBe(10);
  });
});

// ── dispose / setDirty ────────────────────────────────────────────

describe('WaterSurfacePass dispose / setDirty', () => {
  it('dispose() does not throw and allows re-apply', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
    // re-apply after dispose → re-initializes
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d'), makeCamera());
    expect(out).toBeDefined();
  });

  it('dispose() without gl does not throw', () => {
    const p = new WaterSurfacePass();
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const p = new WaterSurfacePass();
    expect(() => { p.dispose(); p.dispose(); p.dispose(); }).not.toThrow();
  });

  it('setDirty() triggers re-initialization on next apply', () => {
    const gl = new MockGL2();
    const p = new WaterSurfacePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });
});

// ── shader 源码校验 ───────────────────────────────────────────────

describe('WATER_SURFACE_FRAG shader source', () => {
  it('is GLSL ES 3.0', () => {
    expect(WATER_SURFACE_FRAG).toContain('#version 300 es');
  });

  it('declares required uniforms', () => {
    expect(WATER_SURFACE_FRAG).toContain('u_colorMap');
    expect(WATER_SURFACE_FRAG).toContain('u_depthMap');
    expect(WATER_SURFACE_FRAG).toContain('u_inverseViewProjection');
    expect(WATER_SURFACE_FRAG).toContain('u_cameraPos');
    expect(WATER_SURFACE_FRAG).toContain('u_screenSize');
    expect(WATER_SURFACE_FRAG).toContain('u_waterLevel');
    expect(WATER_SURFACE_FRAG).toContain('u_waterColor');
    expect(WATER_SURFACE_FRAG).toContain('u_skyColor');
    expect(WATER_SURFACE_FRAG).toContain('u_horizonColor');
    expect(WATER_SURFACE_FRAG).toContain('u_sunDirection');
    expect(WATER_SURFACE_FRAG).toContain('u_sunColor');
    expect(WATER_SURFACE_FRAG).toContain('u_sunSpecular');
    expect(WATER_SURFACE_FRAG).toContain('u_sunShininess');
    expect(WATER_SURFACE_FRAG).toContain('u_waveTime');
    expect(WATER_SURFACE_FRAG).toContain('u_waveAmplitude');
    expect(WATER_SURFACE_FRAG).toContain('u_waveFrequency');
    expect(WATER_SURFACE_FRAG).toContain('u_waveSpeed');
    expect(WATER_SURFACE_FRAG).toContain('u_fresnelPower');
    expect(WATER_SURFACE_FRAG).toContain('u_fresnelBias');
    expect(WATER_SURFACE_FRAG).toContain('u_refractionOffset');
    expect(WATER_SURFACE_FRAG).toContain('u_absorption');
    expect(WATER_SURFACE_FRAG).toContain('u_enabled');
  });

  it('implements Gerstner waveHeight with 4 directional waves', () => {
    expect(WATER_SURFACE_FRAG).toContain('waveHeight');
    expect(WATER_SURFACE_FRAG).toContain('WAVE_DIRS[4]');
    expect(WATER_SURFACE_FRAG).toContain('for (int i = 0; i < 4; i++)');
  });

  it('computes wave normal via central differences', () => {
    expect(WATER_SURFACE_FRAG).toContain('waveNormal');
    expect(WATER_SURFACE_FRAG).toContain('hL');
    expect(WATER_SURFACE_FRAG).toContain('hR');
    expect(WATER_SURFACE_FRAG).toContain('hD');
    expect(WATER_SURFACE_FRAG).toContain('hU');
  });

  it('implements Schlick Fresnel approximation', () => {
    expect(WATER_SURFACE_FRAG).toContain('fresnelSchlick');
    expect(WATER_SURFACE_FRAG).toContain('u_fresnelBias');
    expect(WATER_SURFACE_FRAG).toContain('u_fresnelPower');
  });

  it('performs ray-plane intersection (y = waterLevel)', () => {
    expect(WATER_SURFACE_FRAG).toContain('u_waterLevel - u_cameraPos.y');
    expect(WATER_SURFACE_FRAG).toContain('rayDir.y');
  });

  it('skips when water surface is behind camera', () => {
    expect(WATER_SURFACE_FRAG).toContain('tHit < 0.0');
  });

  it('performs geometric occlusion test (scene before water)', () => {
    expect(WATER_SURFACE_FRAG).toContain('depth < 1.0');
    expect(WATER_SURFACE_FRAG).toContain('sceneDist < tHit');
  });

  it('samples refraction with normal-offset UV', () => {
    expect(WATER_SURFACE_FRAG).toContain('refractUV');
    expect(WATER_SURFACE_FRAG).toContain('u_refractionOffset');
  });

  it('applies Beer-Lambert water depth absorption', () => {
    expect(WATER_SURFACE_FRAG).toContain('depthBelow');
    expect(WATER_SURFACE_FRAG).toContain('exp(-depthBelow');
  });

  it('computes Blinn-Phong sun specular highlight', () => {
    expect(WATER_SURFACE_FRAG).toContain('halfDir');
    expect(WATER_SURFACE_FRAG).toContain('u_sunShininess');
  });

  it('composites refraction and reflection via Fresnel mix', () => {
    expect(WATER_SURFACE_FRAG).toContain('mix(refraction, reflection, fresnel)');
  });

  it('handles disabled state (u_enabled == 0)', () => {
    expect(WATER_SURFACE_FRAG).toContain('u_enabled == 0');
  });

  it('references GPU Gems 1 and o3de', () => {
    expect(WATER_SURFACE_FRAG).toContain('GPU Gems 1');
    expect(WATER_SURFACE_FRAG).toContain('o3de');
  });
});
