// VolumetricFogPass(增强版)单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. 所有 setter(setEnabled / setFogColor / setFogDensity / setFogRange /
//      setHeightFog / setLightScattering / setScatteringSamples / setFroxelResolution)
//   3. render() 在 mock GL 下不抛错并返回纹理
//   4. render() 首帧分配内部纹理 + FBO + VAO + buffer
//   5. render() 同尺寸不重复分配
//   6. render() canvas 尺寸变更后重新分配
//   7. enabled=false 时 render() 直接返回 input
//   8. render() 接收 DirectionalLight 列表,提取主光源
//   9. getFogBuffer() / getStats() 行为正确
//  10. dispose() 释放所有资源,幂等,后续 render 重建

import { describe, it, expect } from 'vitest';
import { VolumetricFogPass } from './VolumetricFogPass';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { DirectionalLight } from '../Lights/DirectionalLight';
import { PointLight } from '../Lights/PointLight';
import { AmbientLight } from '../Lights/AmbientLight';
import type { Camera } from '../Cameras/Camera';
import type { Light } from '../Lights/Light';

// ── MockGL2 (与 SSRPass.test 同构,独立维护避免耦合) ────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
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
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;
  static readonly FLOAT = 0x1406;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
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
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
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
}

function makeTexture(id: string): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

function makeCamera(): Camera {
  return new PerspectiveCamera(60, 800 / 600, 0.1, 1000);
}

function makeDirectionalLight(): DirectionalLight {
  return new DirectionalLight(0xffffff, 1.0, { x: -0.5, y: -1.0, z: -0.3 });
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('VolumetricFogPass construction', () => {
  it('defaults: enabled=true, fogDensity=0.02, fogStart=5, fogEnd=200, lightScattering=true, scatteringIntensity=0.5, scatteringSamples=32', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    expect(p.name).toBe('volumetric-fog');
    expect(p.enabled).toBe(true);
    expect(p.fogDensity).toBe(0.02);
    expect(p.fogStart).toBe(5.0);
    expect(p.fogEnd).toBe(200.0);
    expect(p.fogColor.r).toBeCloseTo(0.5);
    expect(p.fogColor.g).toBeCloseTo(0.55);
    expect(p.fogColor.b).toBeCloseTo(0.6);
    expect(p.heightFogEnabled).toBe(false);
    expect(p.heightFogStart).toBe(50.0);
    expect(p.heightFogEnd).toBe(0.0);
    expect(p.heightFogDensity).toBe(0.5);
    expect(p.lightScattering).toBe(true);
    expect(p.scatteringIntensity).toBe(0.5);
    expect(p.scatteringSamples).toBe(32);
    expect(p.froxelResolution.x).toBe(32);
    expect(p.froxelResolution.y).toBe(32);
    expect(p.froxelResolution.z).toBe(32);
  });

  it('accepts all options', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext, {
      enabled: false,
      fogColor: { r: 0.1, g: 0.2, b: 0.3 },
      fogDensity: 0.08,
      fogStart: 10,
      fogEnd: 100,
      heightFogEnabled: true,
      heightFogStart: 40,
      heightFogEnd: 5,
      heightFogDensity: 0.7,
      lightScattering: false,
      scatteringIntensity: 0.9,
      scatteringSamples: 64,
      froxelResolution: { x: 64, y: 64, z: 128 },
    });
    expect(p.enabled).toBe(false);
    expect(p.fogColor.r).toBe(0.1);
    expect(p.fogColor.g).toBe(0.2);
    expect(p.fogColor.b).toBe(0.3);
    expect(p.fogDensity).toBe(0.08);
    expect(p.fogStart).toBe(10);
    expect(p.fogEnd).toBe(100);
    expect(p.heightFogEnabled).toBe(true);
    expect(p.heightFogStart).toBe(40);
    expect(p.heightFogEnd).toBe(5);
    expect(p.heightFogDensity).toBe(0.7);
    expect(p.lightScattering).toBe(false);
    expect(p.scatteringIntensity).toBe(0.9);
    expect(p.scatteringSamples).toBe(64);
    expect(p.froxelResolution.x).toBe(64);
    expect(p.froxelResolution.y).toBe(64);
    expect(p.froxelResolution.z).toBe(128);
  });

  it('fogColor option is copied (not held by reference)', () => {
    const gl = new MockGL2();
    const color = { r: 0.4, g: 0.5, b: 0.6 };
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext, { fogColor: color });
    color.r = 0.99;
    expect(p.fogColor.r).toBe(0.4);
  });
});

// ── setters ─────────────────────────────────────────────────────────

describe('VolumetricFogPass setters', () => {
  it('setEnabled toggles enabled', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setEnabled(false);
    expect(p.enabled).toBe(false);
    p.setEnabled(true);
    expect(p.enabled).toBe(true);
  });

  it('setFogColor copies the input color', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setFogColor({ r: 0.4, g: 0.5, b: 0.6 });
    expect(p.fogColor.r).toBe(0.4);
    expect(p.fogColor.g).toBe(0.5);
    expect(p.fogColor.b).toBe(0.6);
  });

  it('setFogDensity clamps negative to 0', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setFogDensity(0.15);
    expect(p.fogDensity).toBe(0.15);
    p.setFogDensity(-1.0);
    expect(p.fogDensity).toBe(0);
  });

  it('setFogRange sets start/end with end >= start', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setFogRange(10, 100);
    expect(p.fogStart).toBe(10);
    expect(p.fogEnd).toBe(100);
    // end < start 时 end 被 clamp 到 start
    p.setFogRange(50, 20);
    expect(p.fogStart).toBe(50);
    expect(p.fogEnd).toBe(50);
  });

  it('setFogRange clamps start to >= 0', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setFogRange(-5, 10);
    expect(p.fogStart).toBe(0);
  });

  it('setHeightFog configures all height fog parameters', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setHeightFog(true, 30, 0, 0.8);
    expect(p.heightFogEnabled).toBe(true);
    expect(p.heightFogStart).toBe(30);
    expect(p.heightFogEnd).toBe(0);
    expect(p.heightFogDensity).toBe(0.8);
  });

  it('setHeightFog clamps density to >= 0', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setHeightFog(true, 30, 0, -0.5);
    expect(p.heightFogDensity).toBe(0);
  });

  it('setLightScattering configures enabled + intensity', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setLightScattering(false, 0.7);
    expect(p.lightScattering).toBe(false);
    expect(p.scatteringIntensity).toBe(0.7);
  });

  it('setLightScattering clamps intensity to >= 0', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setLightScattering(true, -0.5);
    expect(p.scatteringIntensity).toBe(0);
  });

  it('setScatteringSamples clamps to [1, 128] and floors', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setScatteringSamples(64);
    expect(p.scatteringSamples).toBe(64);
    p.setScatteringSamples(0);
    expect(p.scatteringSamples).toBe(1);
    p.setScatteringSamples(999);
    expect(p.scatteringSamples).toBe(128);
    p.setScatteringSamples(32.7);
    expect(p.scatteringSamples).toBe(32);
  });

  it('setFroxelResolution sets x/y/z with floor and min 1', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.setFroxelResolution(64, 32, 128);
    expect(p.froxelResolution.x).toBe(64);
    expect(p.froxelResolution.y).toBe(32);
    expect(p.froxelResolution.z).toBe(128);
    p.setFroxelResolution(0, -5, 10.7);
    expect(p.froxelResolution.x).toBe(1);
    expect(p.froxelResolution.y).toBe(1);
    expect(p.froxelResolution.z).toBe(10);
  });
});

// ── render lifecycle ────────────────────────────────────────────────

describe('VolumetricFogPass render lifecycle', () => {
  it('render() does not throw and returns a texture', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    const out = p.render(
      makeTexture('input'),
      [makeDirectionalLight()],
      makeCamera(),
    );
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('render() works with empty lights array', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    const out = p.render(makeTexture('input'), [], makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('render() works with non-directional lights only (no primary light)', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    const lights: Light[] = [
      new AmbientLight(0xffffff, 0.5),
      new PointLight(0xffffff, 1.0, 10, 2),
    ];
    const out = p.render(makeTexture('input'), lights, makeCamera());
    expect(out).toBeDefined();
    const stats = p.getStats();
    expect(stats.lightCount).toBe(0);
  });

  it('render() picks first DirectionalLight as primary', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    const lights: Light[] = [
      new AmbientLight(0xffffff, 0.5),
      new DirectionalLight(0xff0000, 2.0, { x: 0, y: -1, z: 0 }),
      new DirectionalLight(0x00ff00, 3.0, { x: 1, y: 0, z: 0 }),
    ];
    p.render(makeTexture('input'), lights, makeCamera());
    const stats = p.getStats();
    expect(stats.lightCount).toBe(1);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer + 1 program on first render', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent render with same canvas size', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.render(makeTexture('b'), [makeDirectionalLight()], makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('re-allocates on canvas resize', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.render(makeTexture('b'), [makeDirectionalLight()], makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns the same texture across render() calls (no resize)', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    const t1 = p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    const t2 = p.render(makeTexture('b'), [makeDirectionalLight()], makeCamera());
    expect(t1).toBe(t2);
  });

  it('returns input directly when disabled (no allocation)', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext, { enabled: false });
    const input = makeTexture('input');
    const out = p.render(input, [makeDirectionalLight()], makeCamera());
    expect(out).toBe(input);
    expect(gl.createdTextures.length).toBe(0);
    expect(gl.createdFramebuffers.length).toBe(0);
    expect(gl.drawCalls).toBe(0);
  });

  it('increments drawCalls in stats', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    p.render(makeTexture('b'), [makeDirectionalLight()], makeCamera());
    const stats = p.getStats();
    expect(stats.drawCalls).toBe(2);
  });
});

// ── getFogBuffer / getStats ────────────────────────────────────────

describe('VolumetricFogPass getFogBuffer / getStats', () => {
  it('getFogBuffer returns null before render', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    expect(p.getFogBuffer()).toBeNull();
  });

  it('getFogBuffer returns texture after render', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    const out = p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    expect(p.getFogBuffer()).toBe(out);
  });

  it('getStats returns expected fields', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext, {
      fogDensity: 0.05,
      lightScattering: true,
      scatteringSamples: 48,
      froxelResolution: { x: 64, y: 64, z: 64 },
    });
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    const stats = p.getStats();
    expect(stats.drawCalls).toBe(1);
    expect(stats.width).toBe(800);
    expect(stats.height).toBe(600);
    expect(stats.fogDensity).toBe(0.05);
    expect(stats.lightScattering).toBe(true);
    expect(stats.scatteringSamples).toBe(48);
    expect(stats.froxelResolution.x).toBe(64);
    expect(stats.froxelResolution.y).toBe(64);
    expect(stats.froxelResolution.z).toBe(64);
    expect(stats.lightCount).toBe(1);
    expect(stats.lastFrameTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('VolumetricFogPass dispose', () => {
  it('frees all resources after render', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    expect(gl.deletedTextures.length).toBe(0);
    p.dispose();
    expect(gl.deletedTextures.length).toBe(1);
    expect(gl.deletedFramebuffers.length).toBe(1);
    expect(gl.deletedVAOs.length).toBe(1);
    expect(gl.deletedBuffers.length).toBe(1);
    expect(gl.deletedPrograms.length).toBe(1);
  });

  it('clears fog buffer after dispose', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    p.dispose();
    expect(p.getFogBuffer()).toBeNull();
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.dispose();
    p.dispose();
    expect(gl.deletedTextures.length).toBe(0);
  });

  it('render() after dispose re-allocates', () => {
    const gl = new MockGL2();
    const p = new VolumetricFogPass(gl as unknown as WebGL2RenderingContext);
    p.render(makeTexture('a'), [makeDirectionalLight()], makeCamera());
    p.dispose();
    p.render(makeTexture('b'), [makeDirectionalLight()], makeCamera());
    expect(gl.createdTextures.length).toBe(2);
  });
});
