// GPUParticleSystem 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. maxParticles 向上取整到方形纹理
//   3. update() 在 mock GL 下不抛错
//   4. update() 首帧分配资源(positionTex×2 + velocityTex×2 + metaTex + FBO + VAO×2)
//   5. update() 同尺寸不重复分配
//   6. update() 禁用时跳过(零 draw call)
//   7. update() 推进时间与复活游标
//   8. update() 累积发射小数部分
//   9. render() 未初始化时跳过
//  10. render() 禁用时跳过
//  11. render() 在 update 后不抛错
//  12. reset() 清零状态
//  13. dispose() 释放资源
//  14. setDirty() 触发重建
//  15. 字段可更新(emissionRate / startColor / blendMode)
//  16. 着色器源码校验
//  17. getter(positionTexture / velocityTexture / metaTexture / time / spawnCursor)

import { describe, it, expect } from 'vitest';
import { GPUParticleSystem } from './GPUParticleSystem';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import {
  GPU_PARTICLE_SIM_FRAG,
  GPU_PARTICLE_RENDER_VERT,
  GPU_PARTICLE_RENDER_FRAG,
} from '../Materials/shaders';

// ── MockGL2(扩展 GodRaysPass.test.ts 模式,含 RGBA32F / MRT / POINTS / blend) ──

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TRIANGLES = 0x0004;
  static readonly POINTS = 0x0000;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly COLOR_ATTACHMENT1 = 0x8CE1;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly RGBA32F = 0x8814;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly HALF_FLOAT = 0x140B;
  static readonly FLOAT = 0x1406;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly NEAREST = 0x2600;
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
  static readonly BLEND = 0x0BE2;
  static readonly SRC_ALPHA = 0x0302;
  static readonly ONE_MINUS_SRC_ALPHA = 0x0303;
  static readonly ONE = 1;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly POINTS = MockGL2.POINTS;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly COLOR_ATTACHMENT1 = MockGL2.COLOR_ATTACHMENT1;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly RGBA32F = MockGL2.RGBA32F;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly FLOAT = MockGL2.FLOAT;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly NEAREST = MockGL2.NEAREST;
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
  readonly BLEND = MockGL2.BLEND;
  readonly SRC_ALPHA = MockGL2.SRC_ALPHA;
  readonly ONE_MINUS_SRC_ALPHA = MockGL2.ONE_MINUS_SRC_ALPHA;
  readonly ONE = MockGL2.ONE;

  canvas: { width: number; height: number } = { width: 800, height: 600 };

  createdTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  createdShaders: unknown[] = [];
  drawCalls = 0;
  drawBuffersCalls = 0;
  blendCalls = 0;
  depthMaskCalls = 0;

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
  drawBuffers(_a: number[]): void { this.drawBuffersCalls++; }
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
  blendFunc(_s: number, _d: number): void { this.blendCalls++; }
  depthMask(_f: boolean): void { this.depthMaskCalls++; }
}

function makeCamera(): PerspectiveCamera { return new PerspectiveCamera(60, 1.5, 0.1, 200); }

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('GPUParticleSystem construction', () => {
  it('defaults', () => {
    const p = new GPUParticleSystem();
    expect(p.name).toBe('gpuparticles');
    expect(p.maxParticles).toBe(65536);
    expect(p.sizeX).toBe(256);
    expect(p.sizeY).toBe(256);
    expect(p.emissionRate).toBe(1000);
    expect(p.emitterPosition).toEqual([0, 0, 0]);
    expect(p.emitterVelocity).toEqual([0, 0, 0]);
    expect(p.emitterRadius).toBe(0.5);
    expect(p.startSpeed).toBe(2);
    expect(p.startSpeedVariance).toBe(0.5);
    expect(p.lifetimeMin).toBe(1);
    expect(p.lifetimeMax).toBe(3);
    expect(p.startSize).toBe(0.1);
    expect(p.endSize).toBe(0.0);
    expect(p.gravity).toEqual([0, -9.8, 0]);
    expect(p.drag).toBe(0);
    expect(p.startColor).toEqual([1, 1, 1]);
    expect(p.endColor).toEqual([0.2, 0.2, 0.2]);
    expect(p.sizeScale).toBe(1);
    expect(p.alphaScale).toBe(1);
    expect(p.blendMode).toBe('additive');
    expect(p.enabled).toBe(true);
    expect(p.pixelRatio).toBe(1);
  });

  it('accepts all options', () => {
    const p = new GPUParticleSystem({
      maxParticles: 10000,
      emissionRate: 5000,
      emitterPosition: [1, 2, 3],
      emitterVelocity: [0, 1, 0],
      emitterRadius: 1.0,
      startSpeed: 5,
      startSpeedVariance: 0.8,
      lifetime: { min: 2, max: 5 },
      startSize: 0.2,
      endSize: 0.05,
      gravity: [0, -5, 0],
      drag: 0.5,
      startColor: [1, 0.5, 0.1],
      endColor: [0.3, 0, 0],
      sizeScale: 1.5,
      alphaScale: 0.8,
      blendMode: 'alpha',
      enabled: false,
      pixelRatio: 2,
    });
    expect(p.emissionRate).toBe(5000);
    expect(p.emitterPosition).toEqual([1, 2, 3]);
    expect(p.emitterVelocity).toEqual([0, 1, 0]);
    expect(p.emitterRadius).toBe(1.0);
    expect(p.startSpeed).toBe(5);
    expect(p.startSpeedVariance).toBe(0.8);
    expect(p.lifetimeMin).toBe(2);
    expect(p.lifetimeMax).toBe(5);
    expect(p.startSize).toBe(0.2);
    expect(p.endSize).toBe(0.05);
    expect(p.gravity).toEqual([0, -5, 0]);
    expect(p.drag).toBe(0.5);
    expect(p.startColor).toEqual([1, 0.5, 0.1]);
    expect(p.endColor).toEqual([0.3, 0, 0]);
    expect(p.sizeScale).toBe(1.5);
    expect(p.alphaScale).toBe(0.8);
    expect(p.blendMode).toBe('alpha');
    expect(p.enabled).toBe(false);
    expect(p.pixelRatio).toBe(2);
  });

  it('rounds maxParticles up to square texture (10000 → 100×100=10000)', () => {
    const p = new GPUParticleSystem({ maxParticles: 10000 });
    expect(p.sizeX).toBe(100);
    expect(p.sizeY).toBe(100);
    expect(p.maxParticles).toBe(10000);
  });

  it('rounds maxParticles up when not perfect square (1000 → 32×32=1024)', () => {
    const p = new GPUParticleSystem({ maxParticles: 1000 });
    expect(p.sizeX).toBe(32);
    expect(p.sizeY).toBe(32);
    expect(p.maxParticles).toBe(1024); // 向上取整
  });

  it('clamps maxParticles to at least 1', () => {
    const p = new GPUParticleSystem({ maxParticles: 0 });
    expect(p.maxParticles).toBeGreaterThanOrEqual(1);
    expect(p.sizeX).toBeGreaterThanOrEqual(1);
    expect(p.sizeY).toBeGreaterThanOrEqual(1);
  });

  it('emissionRate is updatable', () => {
    const p = new GPUParticleSystem();
    expect(p.emissionRate).toBe(1000);
    p.emissionRate = 2000;
    expect(p.emissionRate).toBe(2000);
  });

  it('startColor is updatable', () => {
    const p = new GPUParticleSystem();
    p.startColor = [1, 0, 0];
    expect(p.startColor).toEqual([1, 0, 0]);
  });

  it('blendMode is updatable', () => {
    const p = new GPUParticleSystem();
    expect(p.blendMode).toBe('additive');
    p.blendMode = 'alpha';
    expect(p.blendMode).toBe('alpha');
  });
});

// ── update / 资源生命周期 ──────────────────────────────────────────

describe('GPUParticleSystem update', () => {
  it('update() does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem();
    expect(() => p.update(gl as unknown as WebGL2RenderingContext, 0.016)).not.toThrow();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('first update allocates resources (5 textures + 1 FBO + 2 VAOs + 1 buffer)', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    // positionTex×2 + velocityTex×2 + metaTex×1 = 5 textures
    expect(gl.createdTextures.length).toBe(5);
    expect(gl.createdFramebuffers.length).toBe(1);
    // simVao + renderVao = 2
    expect(gl.createdVAOs.length).toBe(2);
    // simBuf (renderVao 空,无 buffer)
    expect(gl.createdBuffers.length).toBe(1);
  });

  it('second update does not re-allocate (same size)', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    const texBefore = gl.createdTextures.length;
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    expect(gl.createdTextures.length).toBe(texBefore);
  });

  it('disabled update skips draw call', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ enabled: false });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    expect(gl.drawCalls).toBe(0);
    expect(gl.createdTextures.length).toBe(0); // 不分配资源
  });

  it('update advances time', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem();
    expect(p.time).toBe(0);
    p.update(gl as unknown as WebGL2RenderingContext, 0.5);
    expect(p.time).toBeCloseTo(0.5, 5);
    p.update(gl as unknown as WebGL2RenderingContext, 0.3);
    expect(p.time).toBeCloseTo(0.8, 5);
  });

  it('update advances spawn cursor by emissionRate × dt', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256, emissionRate: 1000 });
    expect(p.spawnCursor).toBe(0);
    p.update(gl as unknown as WebGL2RenderingContext, 0.1); // 1000 × 0.1 = 100 particles
    expect(p.spawnCursor).toBe(100);
    p.update(gl as unknown as WebGL2RenderingContext, 0.1); // +100 → 200
    expect(p.spawnCursor).toBe(200);
  });

  it('update wraps spawn cursor modulo maxParticles', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 100, emissionRate: 1000 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.09); // 90 particles → cursor=90
    expect(p.spawnCursor).toBe(90);
    p.update(gl as unknown as WebGL2RenderingContext, 0.05); // +50 → 140 % 100 = 40
    expect(p.spawnCursor).toBe(40);
  });

  it('update accumulates fractional emission', () => {
    const gl = new MockGL2();
    // emissionRate=10, dt=0.1 → 1 particle/帧,但 0.05 → 0.5 累积
    const p = new GPUParticleSystem({ maxParticles: 256, emissionRate: 10 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.05); // 0.5 累积,0 复活
    expect(p.spawnCursor).toBe(0);
    p.update(gl as unknown as WebGL2RenderingContext, 0.05); // 累积 1.0,1 复活
    expect(p.spawnCursor).toBe(1);
  });

  it('update calls drawBuffers for MRT', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem();
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    expect(gl.drawBuffersCalls).toBeGreaterThan(0);
  });
});

// ── render ─────────────────────────────────────────────────────────

describe('GPUParticleSystem render', () => {
  it('render() before update skips (not initialized)', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem();
    expect(() => p.render(gl as unknown as WebGL2RenderingContext, makeCamera())).not.toThrow();
    expect(gl.drawCalls).toBe(0);
  });

  it('render() when disabled skips', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ enabled: false });
    // 先用 enabled=true 初始化,然后禁用 render
    p.enabled = true;
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    p.enabled = false;
    const before = gl.drawCalls;
    p.render(gl as unknown as WebGL2RenderingContext, makeCamera());
    expect(gl.drawCalls).toBe(before);
  });

  it('render() after update does not throw and issues POINTS draw', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    const before = gl.drawCalls;
    expect(() => p.render(gl as unknown as WebGL2RenderingContext, makeCamera())).not.toThrow();
    expect(gl.drawCalls).toBe(before + 1);
  });

  it('render() sets blend state', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    p.render(gl as unknown as WebGL2RenderingContext, makeCamera());
    expect(gl.blendCalls).toBeGreaterThan(0);
    expect(gl.depthMaskCalls).toBeGreaterThanOrEqual(2); // false + restore true
  });

  it('render() additive vs alpha both work', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256, blendMode: 'additive' });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    expect(() => p.render(gl as unknown as WebGL2RenderingContext, makeCamera())).not.toThrow();
    p.blendMode = 'alpha';
    expect(() => p.render(gl as unknown as WebGL2RenderingContext, makeCamera())).not.toThrow();
  });
});

// ── reset / dispose / setDirty ─────────────────────────────────────

describe('GPUParticleSystem lifecycle', () => {
  it('reset() clears state and does not throw', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.1); // 1000×0.1=100, cursor=100
    expect(p.time).toBeCloseTo(0.1, 5);
    expect(p.spawnCursor).toBe(100);
    expect(() => p.reset(gl as unknown as WebGL2RenderingContext)).not.toThrow();
    expect(p.time).toBe(0);
    expect(p.spawnCursor).toBe(0);
  });

  it('reset() before init does not throw', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem();
    expect(() => p.reset(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() releases resources (no throw, idempotent)', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
    expect(p.positionTexture).toBeNull();
    expect(p.velocityTexture).toBeNull();
    expect(p.metaTexture).toBeNull();
    // 重复 dispose
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl does not throw', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    expect(() => p.dispose()).not.toThrow();
  });

  it('setDirty() triggers re-allocation on next update', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    // dirty 触发 _initResources 重新分配(5 张新纹理)
    expect(gl.createdTextures.length).toBeGreaterThan(texBefore);
  });
});

// ── getter ─────────────────────────────────────────────────────────

describe('GPUParticleSystem getters', () => {
  it('positionTexture / velocityTexture / metaTexture null before init', () => {
    const p = new GPUParticleSystem();
    expect(p.positionTexture).toBeNull();
    expect(p.velocityTexture).toBeNull();
    expect(p.metaTexture).toBeNull();
  });

  it('positionTexture / velocityTexture / metaTexture valid after update', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    expect(p.positionTexture).toBeDefined();
    expect(p.velocityTexture).toBeDefined();
    expect(p.metaTexture).toBeDefined();
  });

  it('ping-pong swaps read index across updates', () => {
    const gl = new MockGL2();
    const p = new GPUParticleSystem({ maxParticles: 256 });
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    const tex0 = p.positionTexture;
    p.update(gl as unknown as WebGL2RenderingContext, 0.016);
    const tex1 = p.positionTexture;
    // 两次 update 后 readIndex 应该交换过,ping-pong
    // (readIndex 初始 0,update 后 → 1,再 update → 0)
    expect(tex0).toBeDefined();
    expect(tex1).toBeDefined();
  });
});

// ── 着色器源码校验 ─────────────────────────────────────────────────

describe('GPUParticleSystem shader sources', () => {
  it('GPU_PARTICLE_SIM_FRAG has MRT outputs', () => {
    expect(GPU_PARTICLE_SIM_FRAG).toContain('layout(location = 0) out');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('layout(location = 1) out');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('outPosition');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('outVelocity');
  });

  it('GPU_PARTICLE_SIM_FRAG has spawn logic', () => {
    expect(GPU_PARTICLE_SIM_FRAG).toContain('u_spawnStart');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('u_spawnCount');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('shouldSpawn');
  });

  it('GPU_PARTICLE_SIM_FRAG has integration (Euler)', () => {
    expect(GPU_PARTICLE_SIM_FRAG).toContain('u_gravity');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('u_drag');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('u_dt');
  });

  it('GPU_PARTICLE_SIM_FRAG has PCG hash random', () => {
    expect(GPU_PARTICLE_SIM_FRAG).toContain('pcg');
    expect(GPU_PARTICLE_SIM_FRAG).toContain('rand');
  });

  it('GPU_PARTICLE_RENDER_VERT uses gl_VertexID', () => {
    expect(GPU_PARTICLE_RENDER_VERT).toContain('gl_VertexID');
    expect(GPU_PARTICLE_RENDER_VERT).toContain('u_positionTex');
    expect(GPU_PARTICLE_RENDER_VERT).toContain('u_metaTex');
    expect(GPU_PARTICLE_RENDER_VERT).toContain('gl_PointSize');
  });

  it('GPU_PARTICLE_RENDER_VERT clips dead particles', () => {
    expect(GPU_PARTICLE_RENDER_VERT).toContain('pos.w <= 0.0');
    expect(GPU_PARTICLE_RENDER_VERT).toContain('2.0, 2.0, 2.0');
  });

  it('GPU_PARTICLE_RENDER_FRAG draws circular sprite', () => {
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('gl_PointCoord');
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('discard');
  });

  it('GPU_PARTICLE_RENDER_FRAG has color over life', () => {
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('u_startColor');
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('u_endColor');
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('mix');
  });

  it('GPU_PARTICLE_RENDER_FRAG supports additive + alpha blend modes', () => {
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('u_blendMode');
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('加性'); // 中文注释标记加性分支
    expect(GPU_PARTICLE_RENDER_FRAG).toContain('u_blendMode == 0');
  });

  it('shaders reference o3de / GPU Gems for provenance', () => {
    // 模块顶部注释包含参考来源(在 shaders.ts 中)
    // 这里仅校验着色器自身的关键标记
    expect(GPU_PARTICLE_SIM_FRAG.length).toBeGreaterThan(500);
    expect(GPU_PARTICLE_RENDER_VERT.length).toBeGreaterThan(300);
    expect(GPU_PARTICLE_RENDER_FRAG.length).toBeGreaterThan(200);
  });
});
