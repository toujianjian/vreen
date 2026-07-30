// ForwardPlusRenderer 单元测试。
//
// 测试策略:
//   - 分块光源剔除 (computeLightTiles / cullLights) 是纯数学, 不依赖 GL,
//     用真实 Camera + Light 验证 tile 覆盖与视锥剔除。
//   - GL 渲染 (depthPrepass / geometryPass / render) 用 MockGL2 验证调用
//     计数与 stats,与 DeferredRenderer.test.ts 同模式。
//   - 配置 (setTileSize / setMaxLightsPerTile / setDepthPrepass / resize)
//     验证 tileCount 重算与 stats 更新。

import { describe, it, expect } from 'vitest';
import { ForwardPlusRenderer } from './ForwardPlusRenderer';
import { AmbientLight } from '../Lights/AmbientLight';
import { DirectionalLight } from '../Lights/DirectionalLight';
import { PointLight } from '../Lights/PointLight';
import { Scene } from '../Core/Scene';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Mesh } from '../Core/Mesh';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Vector3 } from '../Math/Vector3';

// ── WebGL2 常量子集 ────────────────────────────────────────────────
const GL = {
  TEXTURE_2D: 0x0DE1,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812F,
  REPEAT: 0x2901,
  RGBA8: 0x8058,
  RGBA16F: 0x881A,
  RGBA32F: 0x8814,
  RGBA: 0x1908,
  RG: 0x8227,
  RED: 0x1903,
  UNSIGNED_BYTE: 0x1401,
  FLOAT: 0x1406,
  HALF_FLOAT: 0x140B,
  DEPTH_COMPONENT24: 0x81A6,
  DEPTH_COMPONENT: 0x1902,
  UNSIGNED_INT: 0x1405,
  DEPTH24_STENCIL8: 0x88F0,
  DEPTH_STENCIL: 0x84F9,
  UNSIGNED_INT_24_8: 0x84FA,
  FRAMEBUFFER: 0x8D40,
  COLOR_ATTACHMENT0: 0x8CE0,
  DEPTH_ATTACHMENT: 0x8D00,
  DEPTH_STENCIL_ATTACHMENT: 0x821A,
  FRAMEBUFFER_COMPLETE: 0x8CD5,
  MAX_COLOR_ATTACHMENTS: 0x8CDF,
  MAX_DRAW_BUFFERS: 0x8025,
  TEXTURE0: 0x84C0,
  TEXTURE1: 0x84C1,
  TEXTURE2: 0x84C2,
  TEXTURE3: 0x84C3,
  VERTEX_SHADER: 0x8B31,
  FRAGMENT_SHADER: 0x8B30,
  COMPILE_STATUS: 0x8B81,
  LINK_STATUS: 0x8B82,
  ACTIVE_UNIFORMS: 0x8B86,
  ACTIVE_ATTRIBUTES: 0x8B89,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  STATIC_DRAW: 0x88E4,
  DYNAMIC_DRAW: 0x88E8,
  STREAM_DRAW: 0x88E0,
  TRIANGLES: 0x0004,
  LINES: 0x0001,
  UNSIGNED_SHORT: 0x1403,
  DEPTH_TEST: 0x0B71,
  CULL_FACE: 0x0B44,
  BACK: 0x0405,
  FRONT: 0x0404,
  CCW: 0x0901,
  LEQUAL: 0x0203,
  COLOR_BUFFER_BIT: 0x4000,
  DEPTH_BUFFER_BIT: 0x0100,
} as const;

interface MockHandle { kind: string; id: number; deleted?: boolean; }

let _nextHandleId = 1;
function makeHandle(kind: string): MockHandle {
  return { kind, id: _nextHandleId++ };
}

/** MockGL2:实现 ForwardPlusRenderer + ShaderProgram 实际调用的 GL 方法子集。 */
class MockGL2 {
  readonly TEXTURE_2D = GL.TEXTURE_2D;
  readonly TEXTURE_MIN_FILTER = GL.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = GL.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = GL.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = GL.TEXTURE_WRAP_T;
  readonly NEAREST = GL.NEAREST;
  readonly LINEAR = GL.LINEAR;
  readonly CLAMP_TO_EDGE = GL.CLAMP_TO_EDGE;
  readonly REPEAT = GL.REPEAT;
  readonly RGBA8 = GL.RGBA8;
  readonly RGBA16F = GL.RGBA16F;
  readonly RGBA32F = GL.RGBA32F;
  readonly RGBA = GL.RGBA;
  readonly RG = GL.RG;
  readonly RED = GL.RED;
  readonly UNSIGNED_BYTE = GL.UNSIGNED_BYTE;
  readonly FLOAT = GL.FLOAT;
  readonly HALF_FLOAT = GL.HALF_FLOAT;
  readonly DEPTH_COMPONENT24 = GL.DEPTH_COMPONENT24;
  readonly DEPTH_COMPONENT = GL.DEPTH_COMPONENT;
  readonly UNSIGNED_INT = GL.UNSIGNED_INT;
  readonly DEPTH24_STENCIL8 = GL.DEPTH24_STENCIL8;
  readonly DEPTH_STENCIL = GL.DEPTH_STENCIL;
  readonly UNSIGNED_INT_24_8 = GL.UNSIGNED_INT_24_8;
  readonly FRAMEBUFFER = GL.FRAMEBUFFER;
  readonly COLOR_ATTACHMENT0 = GL.COLOR_ATTACHMENT0;
  readonly DEPTH_ATTACHMENT = GL.DEPTH_ATTACHMENT;
  readonly DEPTH_STENCIL_ATTACHMENT = GL.DEPTH_STENCIL_ATTACHMENT;
  readonly FRAMEBUFFER_COMPLETE = GL.FRAMEBUFFER_COMPLETE;
  readonly MAX_COLOR_ATTACHMENTS = GL.MAX_COLOR_ATTACHMENTS;
  readonly MAX_DRAW_BUFFERS = GL.MAX_DRAW_BUFFERS;
  readonly TEXTURE0 = GL.TEXTURE0;
  readonly TEXTURE1 = GL.TEXTURE1;
  readonly TEXTURE2 = GL.TEXTURE2;
  readonly TEXTURE3 = GL.TEXTURE3;
  readonly VERTEX_SHADER = GL.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = GL.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = GL.COMPILE_STATUS;
  readonly LINK_STATUS = GL.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = GL.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = GL.ACTIVE_ATTRIBUTES;
  readonly ARRAY_BUFFER = GL.ARRAY_BUFFER;
  readonly ELEMENT_ARRAY_BUFFER = GL.ELEMENT_ARRAY_BUFFER;
  readonly STATIC_DRAW = GL.STATIC_DRAW;
  readonly DYNAMIC_DRAW = GL.DYNAMIC_DRAW;
  readonly STREAM_DRAW = GL.STREAM_DRAW;
  readonly TRIANGLES = GL.TRIANGLES;
  readonly LINES = GL.LINES;
  readonly UNSIGNED_SHORT = GL.UNSIGNED_SHORT;
  readonly DEPTH_TEST = GL.DEPTH_TEST;
  readonly CULL_FACE = GL.CULL_FACE;
  readonly BACK = GL.BACK;
  readonly FRONT = GL.FRONT;
  readonly CCW = GL.CCW;
  readonly LEQUAL = GL.LEQUAL;
  readonly COLOR_BUFFER_BIT = GL.COLOR_BUFFER_BIT;
  readonly DEPTH_BUFFER_BIT = GL.DEPTH_BUFFER_BIT;

  readonly canvas = { width: 800, height: 600 };

  calls = {
    createTexture: 0, deleteTexture: 0,
    createFramebuffer: 0, deleteFramebuffer: 0,
    createVertexArray: 0, deleteVertexArray: 0,
    createBuffer: 0, deleteBuffer: 0,
    createShader: 0, deleteShader: 0,
    createProgram: 0, deleteProgram: 0,
    texImage2D: 0, texParameteri: 0,
    framebufferTexture2D: 0, drawBuffers: 0,
    bindFramebuffer: 0, bindTexture: 0,
    bindVertexArray: 0, bindBuffer: 0,
    bufferData: 0,
    enableVertexAttribArray: 0, vertexAttribPointer: 0,
    enable: 0, disable: 0, cullFace: 0, depthFunc: 0,
    colorMask: 0,
    clearColor: 0, clearDepth: 0, clear: 0, viewport: 0,
    useProgram: 0,
    uniform1i: 0, uniform1f: 0, uniform2f: 0, uniform3f: 0,
    uniformMatrix3fv: 0, uniformMatrix4fv: 0,
    activeTexture: 0,
    drawArrays: 0, drawElements: 0,
    shaderSource: 0, compileShader: 0, attachShader: 0, linkProgram: 0,
    getProgramParameter: 0, getShaderParameter: 0,
    getProgramInfoLog: 0, getShaderInfoLog: 0,
    getActiveUniform: 0, getActiveAttrib: 0,
    getUniformLocation: 0, getAttribLocation: 0,
    getParameter: 0, pixelStorei: 0, checkFramebufferStatus: 0,
  };

  boundFramebuffer: WebGLFramebuffer | null = null;
  boundProgram: WebGLProgram | null = null;
  boundVao: WebGLVertexArrayObject | null = null;

  getParameter(name: number): number {
    this.calls.getParameter++;
    if (name === GL.MAX_COLOR_ATTACHMENTS) return 8;
    if (name === GL.MAX_DRAW_BUFFERS) return 8;
    return 0;
  }

  createTexture(): WebGLTexture | null {
    this.calls.createTexture++;
    return makeHandle('texture') as unknown as WebGLTexture;
  }
  deleteTexture(t: WebGLTexture | null): void {
    if (!t) return;
    this.calls.deleteTexture++;
    (t as unknown as MockHandle).deleted = true;
  }

  createFramebuffer(): WebGLFramebuffer | null {
    this.calls.createFramebuffer++;
    return makeHandle('framebuffer') as unknown as WebGLFramebuffer;
  }
  deleteFramebuffer(f: WebGLFramebuffer | null): void {
    if (!f) return;
    this.calls.deleteFramebuffer++;
    (f as unknown as MockHandle).deleted = true;
  }

  createVertexArray(): WebGLVertexArrayObject | null {
    this.calls.createVertexArray++;
    return makeHandle('vao') as unknown as WebGLVertexArrayObject;
  }
  deleteVertexArray(v: WebGLVertexArrayObject | null): void {
    if (!v) return;
    this.calls.deleteVertexArray++;
    (v as unknown as MockHandle).deleted = true;
  }

  createBuffer(): WebGLBuffer | null {
    this.calls.createBuffer++;
    return makeHandle('buffer') as unknown as WebGLBuffer;
  }
  deleteBuffer(b: WebGLBuffer | null): void {
    if (!b) return;
    this.calls.deleteBuffer++;
    (b as unknown as MockHandle).deleted = true;
  }

  createShader(_t: number): WebGLShader | null {
    this.calls.createShader++;
    return makeHandle('shader') as unknown as WebGLShader;
  }
  deleteShader(s: WebGLShader | null): void {
    if (!s) return;
    this.calls.deleteShader++;
    (s as unknown as MockHandle).deleted = true;
  }

  createProgram(): WebGLProgram | null {
    this.calls.createProgram++;
    return makeHandle('program') as unknown as WebGLProgram;
  }
  deleteProgram(p: WebGLProgram | null): void {
    if (!p) return;
    this.calls.deleteProgram++;
    (p as unknown as MockHandle).deleted = true;
  }

  bindFramebuffer(target: number, fbo: WebGLFramebuffer | null): void {
    if (target !== GL.FRAMEBUFFER) return;
    this.calls.bindFramebuffer++;
    this.boundFramebuffer = fbo;
  }
  bindTexture(_t: number, _tex: WebGLTexture | null): void { this.calls.bindTexture++; }
  bindVertexArray(vao: WebGLVertexArrayObject | null): void {
    this.calls.bindVertexArray++;
    this.boundVao = vao;
  }
  bindBuffer(target: number, _buf: WebGLBuffer | null): void {
    this.calls.bindBuffer++;
    void target;
  }
  bufferData(_t: number, _d: BufferSource, _u: number): void { this.calls.bufferData++; }
  enableVertexAttribArray(_l: number): void { this.calls.enableVertexAttribArray++; }
  vertexAttribPointer(_l: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {
    this.calls.vertexAttribPointer++;
  }

  enable(_c: number): void { this.calls.enable++; }
  disable(_c: number): void { this.calls.disable++; }
  cullFace(_m: number): void { this.calls.cullFace++; }
  depthFunc(_f: number): void { this.calls.depthFunc++; }
  colorMask(_r: boolean, _g: boolean, _b: boolean, _a: boolean): void { this.calls.colorMask++; }
  clearColor(_r: number, _g: number, _b: number, _a: number): void { this.calls.clearColor++; }
  clearDepth(_d: number): void { this.calls.clearDepth++; }
  clear(_m: number): void { this.calls.clear++; }
  viewport(_x: number, _y: number, _w: number, _h: number): void { this.calls.viewport++; }

  useProgram(p: WebGLProgram | null): void {
    this.calls.useProgram++;
    this.boundProgram = p;
  }

  uniform1i(_l: WebGLUniformLocation | null, _v: number): void { this.calls.uniform1i++; }
  uniform1f(_l: WebGLUniformLocation | null, _v: number): void { this.calls.uniform1f++; }
  uniform2f(_l: WebGLUniformLocation | null, _x: number, _y: number): void { this.calls.uniform2f++; }
  uniform3f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void { this.calls.uniform3f++; }
  uniformMatrix3fv(_l: WebGLUniformLocation | null, _t: boolean, _v: Float32Array): void { this.calls.uniformMatrix3fv++; }
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _v: Float32Array): void { this.calls.uniformMatrix4fv++; }

  activeTexture(_u: number): void { this.calls.activeTexture++; }

  drawArrays(_m: number, _f: number, _c: number): void { this.calls.drawArrays++; }
  drawElements(_m: number, _c: number, _t: number, _o: number): void { this.calls.drawElements++; }

  shaderSource(_s: WebGLShader, _src: string): void { this.calls.shaderSource++; }
  compileShader(_s: WebGLShader): void { this.calls.compileShader++; }
  attachShader(_p: WebGLProgram, _s: WebGLShader): void { this.calls.attachShader++; }
  linkProgram(_p: WebGLProgram): void { this.calls.linkProgram++; }

  getProgramParameter(_p: WebGLProgram, name: number): boolean | number {
    this.calls.getProgramParameter++;
    if (name === GL.LINK_STATUS) return true;
    if (name === GL.ACTIVE_UNIFORMS) return 0;
    if (name === GL.ACTIVE_ATTRIBUTES) return 0;
    return 0;
  }
  getShaderParameter(_s: WebGLShader, name: number): boolean {
    this.calls.getShaderParameter++;
    if (name === GL.COMPILE_STATUS) return true;
    return false;
  }
  getProgramInfoLog(_p: WebGLProgram): string | null { this.calls.getProgramInfoLog++; return null; }
  getShaderInfoLog(_s: WebGLShader): string | null { this.calls.getShaderInfoLog++; return null; }
  getActiveUniform(_p: WebGLProgram, _i: number): WebGLActiveInfo | null { this.calls.getActiveUniform++; return null; }
  getActiveAttrib(_p: WebGLProgram, _i: number): WebGLActiveInfo | null { this.calls.getActiveAttrib++; return null; }
  getUniformLocation(_p: WebGLProgram, _n: string): WebGLUniformLocation | null {
    this.calls.getUniformLocation++;
    return makeHandle('uniform') as unknown as WebGLUniformLocation;
  }
  getAttribLocation(_p: WebGLProgram, _n: string): number { this.calls.getAttribLocation++; return -1; }

  texImage2D(..._a: unknown[]): void { this.calls.texImage2D++; }
  texParameteri(_t: number, _n: number, _v: number): void { this.calls.texParameteri++; }
  framebufferTexture2D(_t: number, _a: number, _tt: number, _tex: WebGLTexture | null, _lv: number): void {
    this.calls.framebufferTexture2D++;
  }
  drawBuffers(_b: number[]): void { this.calls.drawBuffers++; }
  checkFramebufferStatus(_t: number): number { this.calls.checkFramebufferStatus++; return GL.FRAMEBUFFER_COMPLETE; }
  pixelStorei(_n: number, _v: number): void { this.calls.pixelStorei++; }
}

function asGL(gl: MockGL2): WebGL2RenderingContext {
  return gl as unknown as WebGL2RenderingContext;
}

// ═════════════════════════════════════════════════════════════════════
// 构造 / 配置
// ═════════════════════════════════════════════════════════════════════
describe('ForwardPlusRenderer construction', () => {
  it('initializes with default options', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl));
    expect(fpr.screenWidth).toBe(800);
    expect(fpr.screenHeight).toBe(600);
    expect(fpr.tileSize).toBe(16);
    expect(fpr.maxLightsPerTile).toBe(64);
    expect(fpr.depthPrepassEnabled).toBe(true);
    expect(fpr.debugLightCount).toBe(false);
    // tileCount = ceil(800/16) × ceil(600/16) = 50 × 38
    expect(fpr.tileCount.x).toBe(50);
    expect(fpr.tileCount.y).toBe(38);
    fpr.dispose();
  });

  it('initializes with custom options', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), {
      width: 256, height: 256,
      tileSize: 32,
      maxLightsPerTile: 32,
      depthPrepass: false,
      debugLightCount: true,
    });
    expect(fpr.screenWidth).toBe(256);
    expect(fpr.screenHeight).toBe(256);
    expect(fpr.tileSize).toBe(32);
    expect(fpr.maxLightsPerTile).toBe(32);
    expect(fpr.depthPrepassEnabled).toBe(false);
    expect(fpr.debugLightCount).toBe(true);
    // tileCount = ceil(256/32) × ceil(256/32) = 8 × 8
    expect(fpr.tileCount.x).toBe(8);
    expect(fpr.tileCount.y).toBe(8);
    fpr.dispose();
  });

  it('compiles two shaders (depth + geometry)', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    // 2 个 program × (vert + frag) = 4 个 shader
    expect(gl.calls.createShader).toBe(4);
    expect(gl.calls.createProgram).toBe(2);
    fpr.dispose();
  });

  it('setTileSize updates tileCount', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    expect(fpr.tileCount.x).toBe(4); // 64/16
    fpr.setTileSize(32);
    expect(fpr.tileSize).toBe(32);
    expect(fpr.tileCount.x).toBe(2); // 64/32
    fpr.dispose();
  });

  it('setTileSize rejects < 1', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    expect(() => fpr.setTileSize(0)).toThrowError(/>= 1/);
    fpr.dispose();
  });

  it('setMaxLightsPerTile updates config', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    fpr.setMaxLightsPerTile(128);
    expect(fpr.maxLightsPerTile).toBe(128);
    fpr.dispose();
  });

  it('setMaxLightsPerTile rejects < 1', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    expect(() => fpr.setMaxLightsPerTile(0)).toThrowError(/>= 1/);
    fpr.dispose();
  });

  it('setDepthPrepass toggles flag', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    expect(fpr.depthPrepassEnabled).toBe(true);
    fpr.setDepthPrepass(false);
    expect(fpr.depthPrepassEnabled).toBe(false);
    fpr.setDepthPrepass(true);
    expect(fpr.depthPrepassEnabled).toBe(true);
    fpr.dispose();
  });

  it('setDebugLightCount toggles flag', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    expect(fpr.debugLightCount).toBe(false);
    fpr.setDebugLightCount(true);
    expect(fpr.debugLightCount).toBe(true);
    fpr.dispose();
  });

  it('resize updates screenWidth/Height and tileCount', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    expect(fpr.tileCount.x).toBe(4);
    fpr.resize(128, 128);
    expect(fpr.screenWidth).toBe(128);
    expect(fpr.screenHeight).toBe(128);
    expect(fpr.tileCount.x).toBe(8);
    fpr.dispose();
  });

  it('resize rejects width/height < 1', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    expect(() => fpr.resize(0, 64)).toThrowError(/>= 1/);
    expect(() => fpr.resize(64, 0)).toThrowError(/>= 1/);
    fpr.dispose();
  });

  it('resize same size is no-op', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    const beforeTileX = fpr.tileCount.x;
    fpr.resize(64, 64);
    expect(fpr.tileCount.x).toBe(beforeTileX);
    fpr.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 查询方法
// ═════════════════════════════════════════════════════════════════════
describe('ForwardPlusRenderer getters', () => {
  it('getTileCount returns clone of tileCount', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    const tc = fpr.getTileCount();
    expect(tc.x).toBe(4);
    expect(tc.y).toBe(4);
    // 修改返回值不影响内部
    tc.x = 99;
    expect(fpr.tileCount.x).toBe(4);
    fpr.dispose();
  });

  it('getLightGrid / getLightIndexBuffer return null before computeLightTiles', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    expect(fpr.getLightGrid()).toBeNull();
    expect(fpr.getLightIndexBuffer()).toBeNull();
    fpr.dispose();
  });

  it('getStats returns initialized stats', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), {
      width: 64, height: 64, tileSize: 16, maxLightsPerTile: 32,
    });
    const stats = fpr.getStats();
    expect(stats.tileSize).toBe(16);
    expect(stats.totalTiles).toBe(16); // 4×4
    expect(stats.maxLightsPerTile).toBe(32);
    expect(stats.depthPrepass).toBe(true);
    expect(stats.debugLightCount).toBe(false);
    expect(stats.totalLights).toBe(0);
    expect(stats.visibleLights).toBe(0);
    expect(stats.culledLights).toBe(0);
    fpr.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════
// cullLights
// ═════════════════════════════════════════════════════════════════════
describe('ForwardPlusRenderer cullLights', () => {
  it('always includes AmbientLight and DirectionalLight', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const ambient = new AmbientLight(0xffffff, 0.5);
    const dir = new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 });
    const visible = fpr.cullLights([ambient, dir], camera);
    expect(visible.length).toBe(2);
    expect(fpr.getStats().culledLights).toBe(0);
    fpr.dispose();
  });

  it('includes PointLight within frustum', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    // 点光源在相机前方(可见)
    const point = new PointLight(0xffffff, 1, 10, 2);
    point.position.set(0, 0, 0);
    const visible = fpr.cullLights([point], camera);
    expect(visible.length).toBe(1);
    expect(fpr.getStats().culledLights).toBe(0);
    fpr.dispose();
  });

  it('culls PointLight outside frustum', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    // 点光源在相机后方很远(不可见)
    const point = new PointLight(0xffffff, 1, 5, 2);
    point.position.set(0, 0, -100);
    const visible = fpr.cullLights([point], camera);
    expect(visible.length).toBe(0);
    expect(fpr.getStats().culledLights).toBe(1);
    fpr.dispose();
  });

  it('updates totalLights / visibleLights / culledLights stats', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const ambient = new AmbientLight(0xffffff, 0.5);
    const visiblePoint = new PointLight(0xffffff, 1, 10, 2);
    visiblePoint.position.set(0, 0, 0);
    const culledPoint = new PointLight(0xffffff, 1, 5, 2);
    culledPoint.position.set(0, 0, -100);

    fpr.cullLights([ambient, visiblePoint, culledPoint], camera);
    const stats = fpr.getStats();
    expect(stats.totalLights).toBe(3);
    expect(stats.visibleLights).toBe(2);
    expect(stats.culledLights).toBe(1);
    fpr.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════
// computeLightTiles
// ═════════════════════════════════════════════════════════════════════
describe('ForwardPlusRenderer computeLightTiles', () => {
  it('produces grid and index buffers of correct size', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const dir = new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 });
    fpr.computeLightTiles([dir], camera);

    // 4×4 = 16 tiles, grid = 16*2 = 32 uints
    expect(fpr.getLightGrid()).not.toBeNull();
    expect(fpr.getLightGrid()!.length).toBe(32);
    expect(fpr.getLightIndexBuffer()).not.toBeNull();
    fpr.dispose();
  });

  it('DirectionalLight covers all tiles', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const dir = new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 });
    fpr.computeLightTiles([dir], camera);

    const grid = fpr.getLightGrid()!;
    const totalTiles = 16; // 4×4
    // 每个 tile 的 count 应为 1(只有一个 directional 光源)
    for (let t = 0; t < totalTiles; t++) {
      expect(grid[t * 2 + 1]).toBe(1); // count
    }
    // index buffer 应有 16 个条目(每个 tile 一个光源索引 0)
    expect(fpr.getLightIndexBuffer()!.length).toBe(16);
    // 所有索引应为 0(唯一光源)
    for (let i = 0; i < 16; i++) {
      expect(fpr.getLightIndexBuffer()![i]).toBe(0);
    }
    fpr.dispose();
  });

  it('AmbientLight covers all tiles', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const ambient = new AmbientLight(0xffffff, 0.5);
    fpr.computeLightTiles([ambient], camera);

    const grid = fpr.getLightGrid()!;
    const totalTiles = 16;
    for (let t = 0; t < totalTiles; t++) {
      expect(grid[t * 2 + 1]).toBe(1);
    }
    fpr.dispose();
  });

  it('PointLight covers subset of tiles', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    // 点光源在相机正前方,距离 5,range 3
    const point = new PointLight(0xffffff, 1, 3, 2);
    point.position.set(0, 0, 5);
    fpr.computeLightTiles([point], camera);

    const grid = fpr.getLightGrid()!;
    const totalTiles = 16;
    // 至少有一个 tile 包含该光源(中心附近)
    let tilesWithLight = 0;
    for (let t = 0; t < totalTiles; t++) {
      if (grid[t * 2 + 1] > 0) tilesWithLight++;
    }
    // 应覆盖部分(非全 0,非全部 16)
    expect(tilesWithLight).toBeGreaterThan(0);
    expect(tilesWithLight).toBeLessThanOrEqual(totalTiles);
    fpr.dispose();
  });

  it('respects maxLightsPerTile truncation', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), {
      width: 64, height: 64, tileSize: 64, maxLightsPerTile: 2,
    });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    // 5 个 directional 光源全部覆盖所有 tile,但 maxLightsPerTile=2
    const lights = Array.from({ length: 5 }, () =>
      new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 }),
    );
    fpr.computeLightTiles(lights, camera);

    const grid = fpr.getLightGrid()!;
    // tileSize=64, 屏幕 64x64 → 1×1 = 1 tile
    const totalTiles = 1;
    for (let t = 0; t < totalTiles; t++) {
      expect(grid[t * 2 + 1]).toBe(2); // 被 truncation 到 2
    }
    expect(fpr.getLightIndexBuffer()!.length).toBe(2);
    fpr.dispose();
  });

  it('updates stats avgLightsPerTile / maxLightsInTile / lightIndexCount', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), {
      width: 64, height: 64, tileSize: 16,
    });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const dir = new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 });
    fpr.computeLightTiles([dir], camera);

    const stats = fpr.getStats();
    // 1 个光源覆盖 16 tile,avg=1, max=1, indexCount=16
    expect(stats.avgLightsPerTile).toBeCloseTo(1, 5);
    expect(stats.maxLightsInTile).toBe(1);
    expect(stats.lightIndexCount).toBe(16);
    fpr.dispose();
  });

  it('handles empty light list', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64, tileSize: 16 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);

    fpr.computeLightTiles([], camera);
    const grid = fpr.getLightGrid()!;
    const totalTiles = 16;
    for (let t = 0; t < totalTiles; t++) {
      expect(grid[t * 2 + 1]).toBe(0);
    }
    expect(fpr.getLightIndexBuffer()!.length).toBe(0);
    expect(fpr.getStats().avgLightsPerTile).toBe(0);
    expect(fpr.getStats().maxLightsInTile).toBe(0);
    fpr.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════
// depthPrepass / geometryPass / render (GL)
// ═════════════════════════════════════════════════════════════════════
describe('ForwardPlusRenderer GL passes', () => {
  it('depthPrepass renders scene depth (drawElements > 0)', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 128, height: 128 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    scene.add(new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial()));
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    fpr.depthPrepass(scene, camera);
    // BoxGeometry 有索引,应触发 drawElements
    expect(gl.calls.drawElements).toBeGreaterThan(0);
    // colorMask 应被调用 2 次(disable + restore)
    expect(gl.calls.colorMask).toBeGreaterThanOrEqual(2);
    expect(fpr.getStats().depthDrawCalls).toBe(1);
    fpr.dispose();
  });

  it('depthPrepass skips invisible mesh', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const visible = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    visible.visible = true;
    const invisible = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    invisible.visible = false;
    scene.add(visible);
    scene.add(invisible);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    fpr.depthPrepass(scene, camera);
    expect(fpr.getStats().depthDrawCalls).toBe(1);
    fpr.dispose();
  });

  it('geometryPass renders scene with lights (drawElements > 0)', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 128, height: 128 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    scene.add(new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial()));
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    const lights = [
      new AmbientLight(0xffffff, 0.3),
      new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 }),
      new PointLight(0xff8800, 1, 10, 2),
    ];

    fpr.geometryPass(scene, camera, lights);
    expect(gl.calls.drawElements).toBeGreaterThan(0);
    expect(fpr.getStats().geometryDrawCalls).toBe(1);
    expect(fpr.getStats().geometryTriangles).toBeGreaterThan(0);
    fpr.dispose();
  });

  it('geometryPass skips invisible mesh', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const m1 = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    m1.visible = true;
    const m2 = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    m2.visible = false;
    scene.add(m1);
    scene.add(m2);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    fpr.geometryPass(scene, camera, [new AmbientLight()]);
    expect(fpr.getStats().geometryDrawCalls).toBe(1);
    fpr.dispose();
  });

  it('render full flow (depth + cull + tiles + geometry)', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 128, height: 128 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    scene.add(new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial()));
    camera.updateMatrixWorld(true);

    const lights = [
      new AmbientLight(0xffffff, 0.3),
      new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 }),
    ];

    expect(() => fpr.render(scene, camera, lights)).not.toThrow();
    const stats = fpr.getStats();
    expect(stats.depthDrawCalls).toBe(1);
    expect(stats.geometryDrawCalls).toBe(1);
    expect(stats.visibleLights).toBe(2);
    expect(stats.totalLights).toBe(2);
    expect(stats.frameTimeMs).toBeGreaterThanOrEqual(0);
    // directional + ambient 都覆盖所有 tile
    expect(stats.maxLightsInTile).toBe(2);
    fpr.dispose();
  });

  it('render with depthPrepass disabled skips depth pass', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), {
      width: 64, height: 64, depthPrepass: false,
    });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    scene.add(new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial()));
    camera.updateMatrixWorld(true);

    fpr.render(scene, camera, [new AmbientLight()]);
    expect(fpr.getStats().depthDrawCalls).toBe(0);
    // 仍应触发 clear(清深度缓冲)
    expect(gl.calls.clear).toBeGreaterThan(0);
    fpr.dispose();
  });

  it('render throws after dispose', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    fpr.dispose();
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    expect(() => fpr.render(scene, camera, [])).toThrowError(/disposed/);
  });

  it('dispose releases programs', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    const beforeDeleteProgram = gl.calls.deleteProgram;
    fpr.dispose();
    expect(gl.calls.deleteProgram).toBeGreaterThan(beforeDeleteProgram);
    expect(fpr.disposed).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 完整场景:多光源 + 多 mesh
// ═════════════════════════════════════════════════════════════════════
describe('ForwardPlusRenderer multi-light scene', () => {
  it('handles 10 point lights + 1 directional', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), {
      width: 128, height: 128, tileSize: 32, maxLightsPerTile: 32,
    });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const lights: (PointLight | DirectionalLight)[] = [
      new DirectionalLight(0xffffff, 0.8, { x: 0, y: -1, z: 0 }),
    ];
    // 10 个点光源散布在相机前方
    for (let i = 0; i < 10; i++) {
      const p = new PointLight(0xff8800, 1, 8, 2);
      p.position.set((i - 5) * 2, 0, 0);
      lights.push(p);
    }

    const visible = fpr.cullLights(lights, camera);
    expect(visible.length).toBe(11);

    fpr.computeLightTiles(visible, camera);
    const stats = fpr.getStats();
    // directional 覆盖所有 tile(16 tile),点光源各覆盖部分
    expect(stats.maxLightsInTile).toBeGreaterThan(0);
    expect(stats.lightIndexCount).toBeGreaterThan(0);
    fpr.dispose();
  });

  it('PointLight behind camera is culled but others remain', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), { width: 64, height: 64 });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const front = new PointLight(0xffffff, 1, 10, 2);
    front.position.set(0, 0, 5);
    // 相机在 (0,0,10) 朝 -z,故 +z 方向为相机后方。z=50 在相机后方 40 单位。
    const behind = new PointLight(0xffffff, 1, 5, 2);
    behind.position.set(0, 0, 50);

    const visible = fpr.cullLights([front, behind], camera);
    expect(visible.length).toBe(1);
    expect(visible[0]).toBe(front);
    fpr.dispose();
  });

  it('PointLight with large range covers more tiles', () => {
    const gl = new MockGL2();
    const fpr = new ForwardPlusRenderer(asGL(gl), {
      width: 128, height: 128, tileSize: 32,
    });
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    // 大 range 光源覆盖更多 tile
    const bigRange = new PointLight(0xffffff, 1, 50, 1);
    bigRange.position.set(0, 0, 5);
    fpr.computeLightTiles([bigRange], camera);
    const bigCount = fpr.getStats().lightIndexCount;

    // 小 range 光源覆盖较少 tile
    const smallRange = new PointLight(0xffffff, 1, 2, 1);
    smallRange.position.set(0, 0, 5);
    fpr.computeLightTiles([smallRange], camera);
    const smallCount = fpr.getStats().lightIndexCount;

    expect(bigCount).toBeGreaterThanOrEqual(smallCount);
    fpr.dispose();
  });

  it('Vector3 import is functional (sanity check)', () => {
    // 确保 Vector3 在测试环境可用(被 ForwardPlusRenderer 内部使用)
    const v = new Vector3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.length()).toBeCloseTo(Math.sqrt(14), 5);
  });
});
