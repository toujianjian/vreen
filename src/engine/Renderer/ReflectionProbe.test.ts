// ReflectionProbe 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. contains() 点是否在 boxSize 内
//   3. getTexture() 在 capture 前为 null
//   4. capture() 在 mock GL + mock renderer 下不抛错
//   5. capture() 后 getTexture() 返回 GL 句柄
//   6. dispose() 释放 GL 纹理
//   7. dispose() 幂等
//
// Mock GL 策略:覆盖 cube 纹理相关调用表面(createTexture / bindTexture /
// texImage2D / generateMipmap / readPixels 等)与 renderer.render 调用。

import { describe, it, expect } from 'vitest';
import { ReflectionProbe } from './ReflectionProbe';
import { Scene } from '../Core/Scene';
import { Vector3 } from '../Math/Vector3';
import type { Renderer } from './Renderer';
import type { Camera } from '../Cameras/Camera';

// ── MockGL2 (cube + readPixels 支持) ──────────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE_CUBE_MAP = 0x8513;
  static readonly TEXTURE_CUBE_MAP_POSITIVE_X = 0x8515;
  static readonly TEXTURE_CUBE_MAP_NEGATIVE_X = 0x8516;
  static readonly TEXTURE_CUBE_MAP_POSITIVE_Y = 0x8517;
  static readonly TEXTURE_CUBE_MAP_NEGATIVE_Y = 0x8518;
  static readonly TEXTURE_CUBE_MAP_POSITIVE_Z = 0x8519;
  static readonly TEXTURE_CUBE_MAP_NEGATIVE_Z = 0x851A;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly HALF_FLOAT = 0x8D61;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly TEXTURE_WRAP_R = 0x8072;
  static readonly LINEAR = 0x2601;
  static readonly LINEAR_MIPMAP_LINEAR = 0x2703;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE_CUBE_MAP = MockGL2.TEXTURE_CUBE_MAP;
  readonly TEXTURE_CUBE_MAP_POSITIVE_X = MockGL2.TEXTURE_CUBE_MAP_POSITIVE_X;
  readonly TEXTURE_CUBE_MAP_NEGATIVE_X = MockGL2.TEXTURE_CUBE_MAP_NEGATIVE_X;
  readonly TEXTURE_CUBE_MAP_POSITIVE_Y = MockGL2.TEXTURE_CUBE_MAP_POSITIVE_Y;
  readonly TEXTURE_CUBE_MAP_NEGATIVE_Y = MockGL2.TEXTURE_CUBE_MAP_NEGATIVE_Y;
  readonly TEXTURE_CUBE_MAP_POSITIVE_Z = MockGL2.TEXTURE_CUBE_MAP_POSITIVE_Z;
  readonly TEXTURE_CUBE_MAP_NEGATIVE_Z = MockGL2.TEXTURE_CUBE_MAP_NEGATIVE_Z;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly TEXTURE_WRAP_R = MockGL2.TEXTURE_WRAP_R;
  readonly LINEAR = MockGL2.LINEAR;
  readonly LINEAR_MIPMAP_LINEAR = MockGL2.LINEAR_MIPMAP_LINEAR;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;

  canvas: { width: number; height: number } = { width: 256, height: 256 };

  createdTextures: unknown[] = [];
  deletedTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  deletedFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  drawCalls = 0;
  readPixelsCalls = 0;
  generateMipmapCalls = 0;
  bindTextureCalls = 0;
  texImage2DCalls = 0;

  private _counter = 0;
  private _nextId(): unknown {
    this._counter++;
    return { id: this._counter } as unknown;
  }

  createTexture(): WebGLTexture { const t = this._nextId() as WebGLTexture; this.createdTextures.push(t); return t; }
  createFramebuffer(): WebGLFramebuffer { return this._nextId() as WebGLFramebuffer; }
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
  uniformMatrix3fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}

  bindFramebuffer(_t: number, _fb: WebGLFramebuffer | null): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_mask: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_unit: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void { this.bindTextureCalls++; }
  texImage2D(..._args: unknown[]): void { this.texImage2DCalls++; }
  texParameteri(_t: number, _p: number, _v: number): void {}
  framebufferTexture2D(..._args: unknown[]): void {}
  bindVertexArray(_vao: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _buf: WebGLBuffer | null): void {}
  bufferData(_t: number, _data: BufferSource, _usage: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
  readPixels(..._args: unknown[]): void { this.readPixelsCalls++; }
  generateMipmap(_target: number): void { this.generateMipmapCalls++; }
}

// ── MockRenderer ────────────────────────────────────────────────────
// 最小化 Renderer 实现:render() 只增加计数,canvas 是真实 canvas-like 对象。

class MockRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement;
  renderCalls = 0;
  postProcessingEnabled = false;
  ssaoEnabled = false;
  frustumCullingEnabled = true;

  constructor() {
    // HTMLCanvasElement 在 node 环境下不存在;用最小 stub 满足 Renderer 接口。
    this.canvas = { width: 256, height: 256 } as unknown as HTMLCanvasElement;
  }

  render(_scene: Scene, _camera: Camera): void {
    this.renderCalls++;
  }
  resize(width: number, height: number): void {
    (this.canvas as unknown as { width: number; height: number }).width = width;
    (this.canvas as unknown as { width: number; height: number }).height = height;
  }
  dispose(): void {}
  readonly stats = { drawCalls: 0, triangles: 0, shadowPasses: 0, programs: 0, drawCallBreakdown: {} };
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('ReflectionProbe construction', () => {
  it('defaults: position=(0,0,0), resolution=256, boxSize=(10,10,10), priority=0', () => {
    const p = new ReflectionProbe();
    expect(p.position.x).toBe(0);
    expect(p.position.y).toBe(0);
    expect(p.position.z).toBe(0);
    expect(p.resolution).toBe(256);
    expect(p.boxSize.x).toBe(10);
    expect(p.boxSize.y).toBe(10);
    expect(p.boxSize.z).toBe(10);
    expect(p.priority).toBe(0);
    expect(p.near).toBe(0.1);
    expect(p.far).toBe(1000);
    expect(p.cubeTexture).toBeNull();
  });

  it('accepts all options', () => {
    const p = new ReflectionProbe({
      position: new Vector3(1, 2, 3),
      resolution: 128,
      boxSize: new Vector3(20, 30, 40),
      priority: 5,
      near: 0.5,
      far: 500,
    });
    expect(p.position.x).toBe(1);
    expect(p.position.y).toBe(2);
    expect(p.position.z).toBe(3);
    expect(p.resolution).toBe(128);
    expect(p.boxSize.x).toBe(20);
    expect(p.boxSize.y).toBe(30);
    expect(p.boxSize.z).toBe(40);
    expect(p.priority).toBe(5);
    expect(p.near).toBe(0.5);
    expect(p.far).toBe(500);
  });
});

// ── contains ────────────────────────────────────────────────────────

describe('ReflectionProbe.contains', () => {
  it('returns true for points inside boxSize', () => {
    const p = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
    });
    expect(p.contains(new Vector3(0, 0, 0))).toBe(true);
    expect(p.contains(new Vector3(9.9, 9.9, 9.9))).toBe(true);
    expect(p.contains(new Vector3(-9.9, -9.9, -9.9))).toBe(true);
  });

  it('returns true for points on the boundary', () => {
    const p = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
    });
    expect(p.contains(new Vector3(10, 10, 10))).toBe(true);
    expect(p.contains(new Vector3(-10, -10, -10))).toBe(true);
  });

  it('returns false for points outside boxSize', () => {
    const p = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
    });
    expect(p.contains(new Vector3(10.1, 0, 0))).toBe(false);
    expect(p.contains(new Vector3(0, 10.1, 0))).toBe(false);
    expect(p.contains(new Vector3(0, 0, 10.1))).toBe(false);
    expect(p.contains(new Vector3(100, 100, 100))).toBe(false);
  });

  it('respects position offset', () => {
    const p = new ReflectionProbe({
      position: new Vector3(50, 50, 50),
      boxSize: new Vector3(5, 5, 5),
    });
    expect(p.contains(new Vector3(50, 50, 50))).toBe(true);
    expect(p.contains(new Vector3(54, 54, 54))).toBe(true);
    expect(p.contains(new Vector3(55.1, 50, 50))).toBe(false);
  });
});

// ── getTexture ──────────────────────────────────────────────────────

describe('ReflectionProbe.getTexture', () => {
  it('returns null before capture', () => {
    const p = new ReflectionProbe();
    expect(p.getTexture()).toBeNull();
  });
});

// ── capture ─────────────────────────────────────────────────────────

describe('ReflectionProbe.capture', () => {
  it('does not throw and allocates cube texture', () => {
    const gl = new MockGL2();
    const renderer = new MockRenderer();
    const scene = new Scene();
    const p = new ReflectionProbe({ resolution: 64 });
    expect(() => p.capture(gl as unknown as WebGL2RenderingContext, renderer, scene)).not.toThrow();
    // 应该创建 1 个 cube 纹理
    expect(gl.createdTextures.length).toBe(1);
    // 6 个面各 render 一次
    expect(renderer.renderCalls).toBe(6);
    // 6 个面各 readPixels 一次
    expect(gl.readPixelsCalls).toBe(6);
    // 最后 generateMipmap 一次
    expect(gl.generateMipmapCalls).toBe(1);
  });

  it('getTexture() returns GL handle after capture', () => {
    const gl = new MockGL2();
    const renderer = new MockRenderer();
    const scene = new Scene();
    const p = new ReflectionProbe({ resolution: 32 });
    p.capture(gl as unknown as WebGL2RenderingContext, renderer, scene);
    const tex = p.getTexture();
    expect(tex).not.toBeNull();
    expect(gl.createdTextures).toContain(tex);
  });

  it('second capture reuses existing cube texture (no new allocation)', () => {
    const gl = new MockGL2();
    const renderer = new MockRenderer();
    const scene = new Scene();
    const p = new ReflectionProbe({ resolution: 32 });
    p.capture(gl as unknown as WebGL2RenderingContext, renderer, scene);
    const texAfterFirst = gl.createdTextures.length;
    p.capture(gl as unknown as WebGL2RenderingContext, renderer, scene);
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('capture restores canvas size after completion', () => {
    const gl = new MockGL2();
    const renderer = new MockRenderer();
    // 初始 canvas 800x600
    renderer.canvas.width = 800;
    renderer.canvas.height = 600;
    const scene = new Scene();
    const p = new ReflectionProbe({ resolution: 32 });
    p.capture(gl as unknown as WebGL2RenderingContext, renderer, scene);
    // capture 内部 resize 到 32x32,完成后应恢复到 800x600
    expect(renderer.canvas.width).toBe(800);
    expect(renderer.canvas.height).toBe(600);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('ReflectionProbe.dispose', () => {
  it('frees GL cube texture after capture', () => {
    const gl = new MockGL2();
    const renderer = new MockRenderer();
    const scene = new Scene();
    const p = new ReflectionProbe({ resolution: 32 });
    p.capture(gl as unknown as WebGL2RenderingContext, renderer, scene);
    expect(gl.deletedTextures.length).toBe(0);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(1);
    expect(p.cubeTexture).toBeNull();
    expect(p.getTexture()).toBeNull();
  });

  it('is idempotent', () => {
    const gl = new MockGL2();
    const p = new ReflectionProbe();
    p.dispose(gl as unknown as WebGL2RenderingContext);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(gl.deletedTextures.length).toBe(0);
  });
});
