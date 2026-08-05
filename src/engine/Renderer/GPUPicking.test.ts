// GPUPicking 单元测试。
//
// 覆盖:
//   1. 纯函数 encodeId24 / decodeId24 / encodeId24Uniform(与 GLSL 1:1)
//      - round-trip 0 / 1 / 255 / 256 / 65535 / 65536 / MAX_PICK_ID
//      - 边界 / 越界抛错
//      - 与 GPU 编码公式的位级一致性
//   2. register / unregister / registerAll / clear / lookup / pickIdOf / has / count
//      - 幂等注册
//      - 注销后映射清除
//      - 批量注册 + skipInvisible
//      - pickId 从 1 开始(0 = 背景)
//   3. GPU 路径(render / pick / pickRect / pickAt)用 MockGL2
//      - render 调用 drawElements / drawArrays
//      - InstancedMesh 走 drawElementsInstanced
//      - pick 解码 readPixels → 查映射 → 返回 object + instanceId
//      - 背景(alpha=0)返回 null
//      - 非 Mesh 跳过
//      - invisible 跳过
//      - pickRect 去重
//      - pickAt = render + pick
//   4. dispose 释放 GL 资源

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GPUPicking,
  encodeId24,
  decodeId24,
  encodeId24Uniform,
  MAX_PICK_ID,
} from './GPUPicking';
import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import { InstancedMesh } from '../Core/InstancedMesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';

// ── MockGL2 ──────────────────────────────────────────────────────
// 只实现 GPUPicking / MRTTarget / ShaderProgram 实际调用的方法子集。
// ShaderProgram.setUniform* 在 location 缺失时静默 no-op,因此即便 mock
// 不返回真实 uniform location,render() 的完整编排也能跑通。

const GL_CONST = {
  TEXTURE_2D: 0x0de1, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600, LINEAR: 0x2601, CLAMP_TO_EDGE: 0x812f,
  RGBA8: 0x8058, RGBA: 0x1908, RED: 0x1903,
  UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406, UNSIGNED_INT: 0x1405,
  UNSIGNED_SHORT: 0x1403,
  DEPTH_COMPONENT24: 0x81a6, DEPTH_COMPONENT: 0x1902,
  FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, COLOR_ATTACHMENT1: 0x8ce1,
  DEPTH_ATTACHMENT: 0x8d00, FRAMEBUFFER_COMPLETE: 0x8cd5,
  MAX_COLOR_ATTACHMENTS: 0x8cdf, MAX_DRAW_BUFFERS: 0x8025,
  // shader / program
  VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
  ACTIVE_UNIFORMS: 0x8b86, ACTIVE_ATTRIBUTES: 0x8b89,
  // buffer / vao
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
  STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8,
  TRIANGLES: 0x0004,
  // clear / state
  COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
  DEPTH_TEST: 0x0b71, BLEND: 0x0be2, CULL_FACE: 0x0b44,
  LEQUAL: 0x0203, BACK: 0x0405,
} as const;

class MockGL2 {
  canvas = { width: 800, height: 600 };

  // 把所有常量挂到实例上
  readonly TEXTURE_2D = GL_CONST.TEXTURE_2D;
  readonly TEXTURE_MIN_FILTER = GL_CONST.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = GL_CONST.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = GL_CONST.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = GL_CONST.TEXTURE_WRAP_T;
  readonly NEAREST = GL_CONST.NEAREST;
  readonly LINEAR = GL_CONST.LINEAR;
  readonly CLAMP_TO_EDGE = GL_CONST.CLAMP_TO_EDGE;
  readonly RGBA8 = GL_CONST.RGBA8;
  readonly RGBA = GL_CONST.RGBA;
  readonly RED = GL_CONST.RED;
  readonly UNSIGNED_BYTE = GL_CONST.UNSIGNED_BYTE;
  readonly FLOAT = GL_CONST.FLOAT;
  readonly UNSIGNED_INT = GL_CONST.UNSIGNED_INT;
  readonly UNSIGNED_SHORT = GL_CONST.UNSIGNED_SHORT;
  readonly DEPTH_COMPONENT24 = GL_CONST.DEPTH_COMPONENT24;
  readonly DEPTH_COMPONENT = GL_CONST.DEPTH_COMPONENT;
  readonly FRAMEBUFFER = GL_CONST.FRAMEBUFFER;
  readonly COLOR_ATTACHMENT0 = GL_CONST.COLOR_ATTACHMENT0;
  readonly COLOR_ATTACHMENT1 = GL_CONST.COLOR_ATTACHMENT1;
  readonly DEPTH_ATTACHMENT = GL_CONST.DEPTH_ATTACHMENT;
  readonly FRAMEBUFFER_COMPLETE = GL_CONST.FRAMEBUFFER_COMPLETE;
  readonly MAX_COLOR_ATTACHMENTS = GL_CONST.MAX_COLOR_ATTACHMENTS;
  readonly MAX_DRAW_BUFFERS = GL_CONST.MAX_DRAW_BUFFERS;
  readonly VERTEX_SHADER = GL_CONST.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = GL_CONST.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = GL_CONST.COMPILE_STATUS;
  readonly LINK_STATUS = GL_CONST.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = GL_CONST.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = GL_CONST.ACTIVE_ATTRIBUTES;
  readonly ARRAY_BUFFER = GL_CONST.ARRAY_BUFFER;
  readonly ELEMENT_ARRAY_BUFFER = GL_CONST.ELEMENT_ARRAY_BUFFER;
  readonly STATIC_DRAW = GL_CONST.STATIC_DRAW;
  readonly DYNAMIC_DRAW = GL_CONST.DYNAMIC_DRAW;
  readonly TRIANGLES = GL_CONST.TRIANGLES;
  readonly COLOR_BUFFER_BIT = GL_CONST.COLOR_BUFFER_BIT;
  readonly DEPTH_BUFFER_BIT = GL_CONST.DEPTH_BUFFER_BIT;
  readonly DEPTH_TEST = GL_CONST.DEPTH_TEST;
  readonly BLEND = GL_CONST.BLEND;
  readonly CULL_FACE = GL_CONST.CULL_FACE;
  readonly LEQUAL = GL_CONST.LEQUAL;
  readonly BACK = GL_CONST.BACK;

  private _next = 1;
  private _newHandle<T>(kind: string): T {
    const obj = { kind, id: this._next++, deleted: false } as unknown as T;
    return obj;
  }

  // 资源创建 / 删除
  createTexture(): WebGLTexture | null { return this._newHandle<WebGLTexture>('texture'); }
  deleteTexture(t: WebGLTexture): void { (t as unknown as { deleted: boolean }).deleted = true; }
  createFramebuffer(): WebGLFramebuffer | null { return this._newHandle<WebGLFramebuffer>('fbo'); }
  deleteFramebuffer(f: WebGLFramebuffer): void { (f as unknown as { deleted: boolean }).deleted = true; }
  createBuffer(): WebGLBuffer | null { return this._newHandle<WebGLBuffer>('buffer'); }
  deleteBuffer(b: WebGLBuffer): void { (b as unknown as { deleted: boolean }).deleted = true; }
  createVertexArray(): WebGLVertexArrayObject | null { return this._newHandle<WebGLVertexArrayObject>('vao'); }
  deleteVertexArray(v: WebGLVertexArrayObject): void { (v as unknown as { deleted: boolean }).deleted = true; }
  createShader(): WebGLShader | null { return this._newHandle<WebGLShader>('shader'); }
  deleteShader(): void {}
  createProgram(): WebGLProgram | null { return this._newHandle<WebGLProgram>('program'); }
  deleteProgram(): void {}

  // shader / program(no-op,返回成功)
  shaderSource(): void {}
  compileShader(): void {}
  getShaderParameter(_sh: WebGLShader, param: number): boolean {
    if (param === this.COMPILE_STATUS) return true;
    return false;
  }
  getShaderInfoLog(): string { return ''; }
  attachShader(): void {}
  linkProgram(): void {}
  getProgramParameter(_prog: WebGLProgram, param: number): boolean | number {
    if (param === this.LINK_STATUS) return true;
    if (param === this.ACTIVE_UNIFORMS) return 0;
    if (param === this.ACTIVE_ATTRIBUTES) return 0;
    return 0;
  }
  getProgramInfoLog(): string { return ''; }
  getActiveUniform(): null { return null; }
  getActiveAttrib(): null { return null; }
  getUniformLocation(): WebGLUniformLocation | null { return null; }
  getAttribLocation(): number { return 0; }
  useProgram(): void {}

  // uniform*(ShaderProgram 在 loc undefined 时已 no-op,这里不会被调用)
  uniform1f(): void {}
  uniform1i(): void {}
  uniform2f(): void {}
  uniform3f(): void {}
  uniform4f(): void {}
  uniformMatrix4fv(): void {}
  uniformMatrix3fv(): void {}

  // texture
  bindTexture(): void {}
  texImage2D(): void {}
  texParameteri(): void {}

  // framebuffer
  bindFramebuffer(_target: number, fbo: WebGLFramebuffer | null): void { this.boundFramebuffer = fbo; }
  framebufferTexture2D(): void {}
  drawBuffers(): void {}
  checkFramebufferStatus(): number { return this.FRAMEBUFFER_COMPLETE; }
  readBuffer(): void {}
  boundFramebuffer: WebGLFramebuffer | null = null;

  // getParameter
  getParameter(name: number): number {
    if (name === this.MAX_COLOR_ATTACHMENTS) return 8;
    if (name === this.MAX_DRAW_BUFFERS) return 8;
    return 0;
  }

  // buffer / vao
  bindBuffer(): void {}
  bufferData(): void {}
  bindVertexArray(v: WebGLVertexArrayObject | null): void { this.boundVAO = v; }
  boundVAO: WebGLVertexArrayObject | null = null;
  enableVertexAttribArray(): void {}
  vertexAttribPointer(): void {}
  vertexAttribDivisor(): void {}

  // draw
  drawCalls: string[] = [];
  drawElements(_mode: number, count: number): void { this.drawCalls.push(`drawElements(${count})`); }
  drawArrays(_mode: number, _first: number, count: number): void { this.drawCalls.push(`drawArrays(${count})`); }
  drawElementsInstanced(_mode: number, count: number, _type: number, _off: number, inst: number): void {
    this.drawCalls.push(`drawElementsInstanced(${count},${inst})`);
  }
  drawArraysInstanced(_mode: number, _first: number, count: number, inst: number): void {
    this.drawCalls.push(`drawArraysInstanced(${count},${inst})`);
  }

  // clear / state
  viewport(): void {}
  clearColor(): void {}
  clearDepth(): void {}
  clear(): void {}
  enable(_cap: number): void {}
  disable(_cap: number): void {}
  depthFunc(): void {}
  depthMask(): void {}
  cullFace(): void {}

  // readPixels:可植入返回值。默认背景(0,0,0,0)。
  // readPixelsPlan[readIndex] 依次消费;消费完回退到 defaultPixel。
  readPixelsPlan: Uint8Array[] = [];
  private _readIdx = 0;
  defaultPixel: Uint8Array = new Uint8Array([0, 0, 0, 0]);
  readPixels(
    _x: number, _y: number, _w: number, _h: number,
    _fmt: number, _type: number, buf: ArrayBufferView,
  ): void {
    const src = this._readIdx < this.readPixelsPlan.length
      ? this.readPixelsPlan[this._readIdx++]
      : this.defaultPixel;
    const dst = buf as unknown as Uint8Array;
    for (let i = 0; i < src.length && i < dst.length; i++) dst[i] = src[i];
  }

  reset(): void {
    this.drawCalls = [];
    this.readPixelsPlan = [];
    this._readIdx = 0;
    this.defaultPixel = new Uint8Array([0, 0, 0, 0]);
    this.boundFramebuffer = null;
    this.boundVAO = null;
  }
}

function makeGL(): MockGL2 { return new MockGL2(); }

function makeMesh(): Mesh {
  const geom = new BufferGeometry();
  // 两个三角形(正方形),4 顶点
  geom.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  ]), 3));
  geom.setIndex([0, 1, 2, 0, 2, 3]);
  return new Mesh(geom, new StandardMaterial());
}

function makeInstanced(count: number): InstancedMesh {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
  ]), 3));
  geom.setIndex([0, 1, 2]);
  return new InstancedMesh(geom, new StandardMaterial(), count);
}

// ── 1. 纯函数 ─────────────────────────────────────────────────────

describe('encodeId24 / decodeId24', () => {
  it('round-trip 0', () => {
    const [r, g, b] = encodeId24(0);
    expect(decodeId24(r, g, b)).toBe(0);
  });

  it('round-trip 1', () => {
    const [r, g, b] = encodeId24(1);
    expect(r).toBe(1); expect(g).toBe(0); expect(b).toBe(0);
    expect(decodeId24(r, g, b)).toBe(1);
  });

  it('round-trip 255 (R 通道上限)', () => {
    const [r, g, b] = encodeId24(255);
    expect(r).toBe(255); expect(g).toBe(0); expect(b).toBe(0);
    expect(decodeId24(r, g, b)).toBe(255);
  });

  it('round-trip 256 (进位到 G 通道)', () => {
    const [r, g, b] = encodeId24(256);
    expect(r).toBe(0); expect(g).toBe(1); expect(b).toBe(0);
    expect(decodeId24(r, g, b)).toBe(256);
  });

  it('round-trip 65535 (R+G 上限)', () => {
    const [r, g, b] = encodeId24(65535);
    expect(r).toBe(255); expect(g).toBe(255); expect(b).toBe(0);
    expect(decodeId24(r, g, b)).toBe(65535);
  });

  it('round-trip 65536 (进位到 B 通道)', () => {
    const [r, g, b] = encodeId24(65536);
    expect(r).toBe(0); expect(g).toBe(0); expect(b).toBe(1);
    expect(decodeId24(r, g, b)).toBe(65536);
  });

  it('round-trip MAX_PICK_ID (2^24-1)', () => {
    const [r, g, b] = encodeId24(MAX_PICK_ID);
    expect(r).toBe(255); expect(g).toBe(255); expect(b).toBe(255);
    expect(decodeId24(r, g, b)).toBe(MAX_PICK_ID);
  });

  it('round-trip 一批随机值', () => {
    const ids = [42, 1000, 12345, 1000000, 7777777, 16777215];
    for (const id of ids) {
      const [r, g, b] = encodeId24(id);
      expect(decodeId24(r, g, b)).toBe(id);
    }
  });

  it('与 GPU 编码公式一致:r = id & 0xFF', () => {
    const id = 0x1234; // 4660
    const [r, g, b] = encodeId24(id);
    expect(r).toBe(id & 0xff);          // 0x34 = 52
    expect(g).toBe((id >> 8) & 0xff);   // 0x12 = 18
    expect(b).toBe((id >> 16) & 0xff);  // 0
  });

  it('encodeId24 越界抛错(负数)', () => {
    expect(() => encodeId24(-1)).toThrow(RangeError);
  });

  it('encodeId24 越界抛错(超 MAX_PICK_ID)', () => {
    expect(() => encodeId24(MAX_PICK_ID + 1)).toThrow(RangeError);
  });

  it('decodeId24 忽略高位字节(只取低 8 位)', () => {
    expect(decodeId24(256, 0, 0)).toBe(0); // 256 & 0xff = 0
    expect(decodeId24(257, 0, 0)).toBe(1); // 257 & 0xff = 1
  });
});

describe('encodeId24Uniform', () => {
  it('返回 0..1 归一化值,= encodeId24 / 255', () => {
    const [r, g, b] = encodeId24Uniform(300);
    const [r8, g8, b8] = encodeId24(300);
    expect(r).toBeCloseTo(r8 / 255, 5);
    expect(g).toBeCloseTo(g8 / 255, 5);
    expect(b).toBeCloseTo(b8 / 255, 5);
  });

  it('id=0 → [0,0,0],id=255 → [1,0,0]', () => {
    expect(encodeId24Uniform(0)).toEqual([0, 0, 0]);
    expect(encodeId24Uniform(255)).toEqual([1, 0, 0]);
  });
});

// ── 2. 注册 / 映射 ────────────────────────────────────────────────

describe('GPUPicking register / unregister', () => {
  let p: GPUPicking;
  beforeEach(() => { p = new GPUPicking(); });

  it('register 返回从 1 开始的 pickId', () => {
    const a = new Object3D();
    const b = new Object3D();
    expect(p.register(a)).toBe(1);
    expect(p.register(b)).toBe(2);
  });

  it('register 幂等:重复注册同一物体返回相同 id', () => {
    const a = new Object3D();
    const id1 = p.register(a);
    const id2 = p.register(a);
    expect(id1).toBe(id2);
    expect(p.count).toBe(1);
  });

  it('unregister 清除映射', () => {
    const a = new Object3D();
    const id = p.register(a);
    p.unregister(a);
    expect(p.has(a)).toBe(false);
    expect(p.lookup(id)).toBeNull();
    expect(p.count).toBe(0);
  });

  it('unregister 未注册物体无操作', () => {
    const a = new Object3D();
    expect(() => p.unregister(a)).not.toThrow();
    expect(p.count).toBe(0);
  });

  it('unregister 后不回收 id(新物体拿新 id)', () => {
    const a = new Object3D();
    const b = new Object3D();
    p.register(a); // id=1
    p.unregister(a);
    expect(p.register(b)).toBe(2); // 不是 1
  });

  it('clear 清空所有映射并重置计数器', () => {
    const a = new Object3D();
    const b = new Object3D();
    p.register(a); p.register(b);
    p.clear();
    expect(p.count).toBe(0);
    // clear 后计数器从 1 重新开始
    expect(p.register(new Object3D())).toBe(1);
  });

  it('lookup / pickIdOf / has', () => {
    const a = new Object3D();
    const id = p.register(a);
    expect(p.lookup(id)).toBe(a);
    expect(p.pickIdOf(a)).toBe(id);
    expect(p.has(a)).toBe(true);
    expect(p.pickIdOf(new Object3D())).toBe(0); // 未注册 = 背景
    expect(p.lookup(999)).toBeNull();
  });

  it('registerAll 批量注册 + skipInvisible', () => {
    const a = new Object3D(); a.visible = true;
    const b = new Object3D(); b.visible = false;
    const c = new Object3D(); c.visible = true;
    const r = p.registerAll([a, b, c]);
    expect(r.registered).toBe(2);
    expect(r.skipped).toBe(1);
    expect(p.has(a)).toBe(true);
    expect(p.has(b)).toBe(false);
    expect(p.has(c)).toBe(true);
  });

  it('registerAll skipInvisible=false 时注册全部', () => {
    const p2 = new GPUPicking({ skipInvisible: false });
    const a = new Object3D(); a.visible = false;
    const r = p2.registerAll([a]);
    expect(r.registered).toBe(1);
    expect(r.skipped).toBe(0);
    expect(p2.has(a)).toBe(true);
  });

  it('getRegisteredObjects 返回所有已注册物体', () => {
    const a = new Object3D();
    const b = new Object3D();
    p.register(a); p.register(b);
    const arr = p.getRegisteredObjects();
    expect(arr).toHaveLength(2);
    expect(arr).toContain(a);
    expect(arr).toContain(b);
  });
});

// ── 3. GPU 路径(render / pick / pickRect) ─────────────────────────

describe('GPUPicking GPU path', () => {
  let gl: MockGL2;
  let p: GPUPicking;
  let camera: PerspectiveCamera;

  beforeEach(() => {
    gl = makeGL();
    p = new GPUPicking();
    camera = new PerspectiveCamera(75, 800 / 600, 0.1, 1000);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  });

  it('render 空注册集时 warn 且不渲染', () => {
    // 没注册任何物体
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    expect(gl.drawCalls).toHaveLength(0);
  });

  it('render 普通Mesh 调用 drawElements', () => {
    const mesh = makeMesh();
    p.register(mesh);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    expect(gl.drawCalls.length).toBe(1);
    expect(gl.drawCalls[0]).toMatch(/^drawElements\(6\)/); // 2 三角形 × 3 = 6 索引
  });

  it('render 无索引 Mesh 调用 drawArrays', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), 3));
    // 无 setIndex → 走 drawArrays
    const mesh = new Mesh(geom, new StandardMaterial());
    p.register(mesh);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    expect(gl.drawCalls.length).toBe(1);
    expect(gl.drawCalls[0]).toMatch(/^drawArrays\(3\)/); // 3 顶点 = 1 三角形
  });

  it('render InstancedMesh 调用 drawElementsInstanced', () => {
    const inst = makeInstanced(5);
    p.register(inst);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    expect(gl.drawCalls.length).toBe(1);
    expect(gl.drawCalls[0]).toBe('drawElementsInstanced(3,5)'); // 1 三角形 × 5 实例
  });

  it('render 跳过非 Mesh 物体', () => {
    const plain = new Object3D(); // isMesh 未定义
    p.register(plain);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    expect(gl.drawCalls).toHaveLength(0);
  });

  it('render 跳过 invisible 物体(skipInvisible=true)', () => {
    const mesh = makeMesh();
    mesh.visible = false;
    p.register(mesh);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    expect(gl.drawCalls).toHaveLength(0);
  });

  it('pick 命中:解码 readPixels → 返回 object + instanceId=-1', () => {
    const mesh = makeMesh();
    const id = p.register(mesh); // id=1
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    // 植入 readPixels:第一次读 attachment 0(物体 id),alpha=255
    const enc = encodeId24(id);
    gl.readPixelsPlan = [
      new Uint8Array([enc[0], enc[1], enc[2], 255]), // attachment 0
      new Uint8Array([0, 0, 0, 0]),                   // attachment 1:非实例 → alpha=0
    ];
    const result = p.pick(gl as unknown as WebGL2RenderingContext, 400, 300);
    expect(result).not.toBeNull();
    expect(result!.object).toBe(mesh);
    expect(result!.pickId).toBe(id);
    expect(result!.instanceId).toBe(-1);
  });

  it('pick 背景(alpha=0)返回 null', () => {
    const mesh = makeMesh();
    p.register(mesh);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    gl.defaultPixel = new Uint8Array([0, 0, 0, 0]); // 背景
    const result = p.pick(gl as unknown as WebGL2RenderingContext, 0, 0);
    expect(result).toBeNull();
  });

  it('pick InstancedMesh 返回 instanceId', () => {
    const inst = makeInstanced(5);
    const id = p.register(inst);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    const objEnc = encodeId24(id);
    const instEnc = encodeId24(3); // 第 3 个实例
    gl.readPixelsPlan = [
      new Uint8Array([objEnc[0], objEnc[1], objEnc[2], 255]),
      new Uint8Array([instEnc[0], instEnc[1], instEnc[2], 255]),
    ];
    const result = p.pick(gl as unknown as WebGL2RenderingContext, 100, 100);
    expect(result).not.toBeNull();
    expect(result!.object).toBe(inst);
    expect(result!.instanceId).toBe(3);
  });

  it('pick 命中未知 pickId(查不到映射)object=null', () => {
    const mesh = makeMesh();
    p.register(mesh);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    // 植入一个不在映射里的 id
    const enc = encodeId24(9999);
    gl.readPixelsPlan = [
      new Uint8Array([enc[0], enc[1], enc[2], 255]),
      new Uint8Array([0, 0, 0, 0]),
    ];
    const result = p.pick(gl as unknown as WebGL2RenderingContext, 50, 50);
    expect(result).not.toBeNull();
    expect(result!.object).toBeNull();
    expect(result!.pickId).toBe(9999);
  });

  it('pick 在 render 前调用返回 null(FBO 未 setup)', () => {
    const result = p.pick(gl as unknown as WebGL2RenderingContext, 10, 10);
    expect(result).toBeNull();
  });

  it('pickAt = render + pick', () => {
    const mesh = makeMesh();
    const id = p.register(mesh);
    const enc = encodeId24(id);
    gl.readPixelsPlan = [
      new Uint8Array([enc[0], enc[1], enc[2], 255]),
      new Uint8Array([0, 0, 0, 0]),
    ];
    const result = p.pickAt(gl as unknown as WebGL2RenderingContext, camera, 400, 300);
    expect(result).not.toBeNull();
    expect(result!.object).toBe(mesh);
  });

  it('pickAt 传 canvas 尺寸用于 FBO', () => {
    const mesh = makeMesh();
    p.register(mesh);
    // 不传 canvasW/H 时用 gl.canvas.width/height
    expect(() => p.pickAt(gl as unknown as WebGL2RenderingContext, camera, 1, 1)).not.toThrow();
  });
});

describe('GPUPicking pickRect', () => {
  let gl: MockGL2;
  let p: GPUPicking;
  let camera: PerspectiveCamera;

  beforeEach(() => {
    gl = makeGL();
    p = new GPUPicking();
    camera = new PerspectiveCamera(75, 800 / 600, 0.1, 1000);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  });

  it('pickRect 去重返回命中物体', () => {
    const a = makeMesh();
    const b = makeMesh();
    const idA = p.register(a);
    const idB = p.register(b);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    // 模拟 2×2 区域:3 像素命中 a(idA),1 像素命中 b(idB)
    const encA = encodeId24(idA);
    const encB = encodeId24(idB);
    const bg = new Uint8Array([0, 0, 0, 0]);
    const hitA = new Uint8Array([encA[0], encA[1], encA[2], 255]);
    const hitB = new Uint8Array([encB[0], encB[1], encB[2], 255]);
    // readPixels 一次性读 2×2=4 像素 → 一个长度 16 的 buffer
    gl.readPixelsPlan = [new Uint8Array([
      ...hitA, ...hitA, ...hitB, ...bg,
    ])];
    const objs = p.pickRect(gl as unknown as WebGL2RenderingContext, 0, 0, 1, 1);
    expect(objs).toHaveLength(2);
    expect(objs).toContain(a);
    expect(objs).toContain(b);
  });

  it('pickRect 全背景返回空数组', () => {
    const a = makeMesh();
    p.register(a);
    p.render(gl as unknown as WebGL2RenderingContext, camera);
    gl.readPixelsPlan = [new Uint8Array(16)]; // 全 0
    const objs = p.pickRect(gl as unknown as WebGL2RenderingContext, 0, 0, 1, 1);
    expect(objs).toHaveLength(0);
  });

  it('pickRect 未 render 时返回空数组', () => {
    const objs = p.pickRect(gl as unknown as WebGL2RenderingContext, 0, 0, 10, 10);
    expect(objs).toHaveLength(0);
  });
});

// ── 4. dispose / 配置 ─────────────────────────────────────────────

describe('GPUPicking dispose / options', () => {
  it('resolutionScale 影响缩放', () => {
    const gl = makeGL();
    const p = new GPUPicking({ resolutionScale: 0.5 });
    expect(p.resolutionScale).toBe(0.5);
    const mesh = makeMesh();
    p.register(mesh);
    const cam = new PerspectiveCamera(75, 2, 0.1, 1000);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    p.render(gl as unknown as WebGL2RenderingContext, cam, 800, 600);
    // 800×0.5 = 400, 600×0.5 = 300
    expect(p.width).toBe(400);
    expect(p.height).toBe(300);
  });

  it('default resolutionScale = 1.0', () => {
    const p = new GPUPicking();
    expect(p.resolutionScale).toBe(1.0);
  });

  it('dispose 后 FBO 尺寸归零 + 映射清空', () => {
    const gl = makeGL();
    const p = new GPUPicking();
    const mesh = makeMesh();
    p.register(mesh);
    const cam = new PerspectiveCamera(75, 2, 0.1, 1000);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    p.render(gl as unknown as WebGL2RenderingContext, cam, 800, 600);
    expect(p.width).toBe(800);
    expect(p.count).toBe(1);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(p.width).toBe(0);
    expect(p.height).toBe(0);
    expect(p.count).toBe(0);
  });

  it('dispose 后再 register 从 id=1 重新开始', () => {
    const gl = makeGL();
    const p = new GPUPicking();
    p.register(makeMesh()); // id=1
    p.register(makeMesh()); // id=2
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(p.register(new Object3D())).toBe(1);
  });
});
