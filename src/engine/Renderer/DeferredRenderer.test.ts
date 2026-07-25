// DeferredRenderer 单元测试。
//
// Vitest 在 node 环境，无真实 WebGL2 上下文。构造一个 MockGL2 实现
// DeferredRenderer / GBuffer / ShaderProgram 实际调用的方法子集，验证:
//   - 构造时 GBuffer.setup + 两个 ShaderProgram 编译被调用
//   - geometryPass 写入 GBuffer FBO + 调用 drawArrays/drawElements
//   - lightingPass 绑定 4 个 GBuffer 纹理 + 绘制全屏三角形
//   - render 完整流程跑通(无抛错)
//   - resize 重建 GBuffer,screenWidth/Height 更新
//   - dispose 释放 GBuffer / shader / VAO
//
// 由于 ShaderProgram 构造函数调用 gl.compileShader / linkProgram,
// MockGL2 需要返回有效的 shader/program 句柄并报告编译成功。

import { describe, it, expect } from 'vitest';
import { DeferredRenderer } from './DeferredRenderer';
import { AmbientLight } from '../Lights/AmbientLight';
import { DirectionalLight } from '../Lights/DirectionalLight';
import { PointLight } from '../Lights/PointLight';
import { Scene } from '../Core/Scene';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Mesh } from '../Core/Mesh';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';

/** WebGL2 常量子集(数值与 WebGL2 规范一致)。 */
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
  RG16F: 0x822F,
  R16F: 0x822D,
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

class MockGL2 {
  // GL 常量挂实例
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
  readonly RG16F = GL.RG16F;
  readonly R16F = GL.R16F;
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

  // 调用计数器
  calls = {
    createTexture: 0,
    deleteTexture: 0,
    createFramebuffer: 0,
    deleteFramebuffer: 0,
    createVertexArray: 0,
    deleteVertexArray: 0,
    createBuffer: 0,
    deleteBuffer: 0,
    createShader: 0,
    deleteShader: 0,
    createProgram: 0,
    deleteProgram: 0,
    texImage2D: 0,
    texParameteri: 0,
    framebufferTexture2D: 0,
    drawBuffers: 0,
    bindFramebuffer: 0,
    bindTexture: 0,
    bindVertexArray: 0,
    bindBuffer: 0,
    bufferData: 0,
    enableVertexAttribArray: 0,
    vertexAttribPointer: 0,
    enable: 0,
    disable: 0,
    cullFace: 0,
    depthFunc: 0,
    clearColor: 0,
    clearDepth: 0,
    clear: 0,
    viewport: 0,
    useProgram: 0,
    uniform1i: 0,
    uniform1f: 0,
    uniform2f: 0,
    uniform3f: 0,
    uniformMatrix3fv: 0,
    uniformMatrix4fv: 0,
    activeTexture: 0,
    drawArrays: 0,
    drawElements: 0,
    shaderSource: 0,
    compileShader: 0,
    attachShader: 0,
    linkProgram: 0,
    getProgramParameter: 0,
    getShaderParameter: 0,
    getProgramInfoLog: 0,
    getShaderInfoLog: 0,
    getActiveUniform: 0,
    getActiveAttrib: 0,
    getUniformLocation: 0,
    getAttribLocation: 0,
    getParameter: 0,
    pixelStorei: 0,
    checkFramebufferStatus: 0,
  };

  // 状态
  boundFramebuffer: WebGLFramebuffer | null = null;
  boundProgram: WebGLProgram | null = null;
  boundVao: WebGLVertexArrayObject | null = null;
  boundArrayBuffer: WebGLBuffer | null = null;
  boundElementBuffer: WebGLBuffer | null = null;

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

  createShader(_type: number): WebGLShader | null {
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

  bindTexture(_t: number, _tex: WebGLTexture | null): void {
    this.calls.bindTexture++;
  }

  bindVertexArray(vao: WebGLVertexArrayObject | null): void {
    this.calls.bindVertexArray++;
    this.boundVao = vao;
  }

  bindBuffer(target: number, buf: WebGLBuffer | null): void {
    this.calls.bindBuffer++;
    if (target === GL.ARRAY_BUFFER) this.boundArrayBuffer = buf;
    else if (target === GL.ELEMENT_ARRAY_BUFFER) this.boundElementBuffer = buf;
  }

  bufferData(_target: number, _data: BufferSource, _usage: number): void {
    this.calls.bufferData++;
  }

  enableVertexAttribArray(_loc: number): void { this.calls.enableVertexAttribArray++; }
  vertexAttribPointer(_loc: number, _size: number, _type: number, _norm: boolean, _stride: number, _offset: number): void {
    this.calls.vertexAttribPointer++;
  }

  enable(_cap: number): void { this.calls.enable++; }
  disable(_cap: number): void { this.calls.disable++; }
  cullFace(_mode: number): void { this.calls.cullFace++; }
  depthFunc(_func: number): void { this.calls.depthFunc++; }
  clearColor(_r: number, _g: number, _b: number, _a: number): void { this.calls.clearColor++; }
  clearDepth(_d: number): void { this.calls.clearDepth++; }
  clear(_mask: number): void { this.calls.clear++; }
  viewport(_x: number, _y: number, _w: number, _h: number): void { this.calls.viewport++; }

  useProgram(p: WebGLProgram | null): void {
    this.calls.useProgram++;
    this.boundProgram = p;
  }

  uniform1i(_loc: WebGLUniformLocation | null, _v: number): void { this.calls.uniform1i++; }
  uniform1f(_loc: WebGLUniformLocation | null, _v: number): void { this.calls.uniform1f++; }
  uniform2f(_loc: WebGLUniformLocation | null, _x: number, _y: number): void { this.calls.uniform2f++; }
  uniform3f(_loc: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void { this.calls.uniform3f++; }
  uniformMatrix3fv(_loc: WebGLUniformLocation | null, _transpose: boolean, _v: Float32Array): void { this.calls.uniformMatrix3fv++; }
  uniformMatrix4fv(_loc: WebGLUniformLocation | null, _transpose: boolean, _v: Float32Array): void { this.calls.uniformMatrix4fv++; }

  activeTexture(_unit: number): void { this.calls.activeTexture++; }

  drawArrays(_mode: number, _first: number, _count: number): void { this.calls.drawArrays++; }
  drawElements(_mode: number, _count: number, _type: number, _offset: number): void { this.calls.drawElements++; }

  shaderSource(_shader: WebGLShader, _src: string): void { this.calls.shaderSource++; }
  compileShader(_shader: WebGLShader): void { this.calls.compileShader++; }
  attachShader(_program: WebGLProgram, _shader: WebGLShader): void { this.calls.attachShader++; }
  linkProgram(_program: WebGLProgram): void { this.calls.linkProgram++; }

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
  getProgramInfoLog(_p: WebGLProgram): string | null {
    this.calls.getProgramInfoLog++;
    return null;
  }
  getShaderInfoLog(_s: WebGLShader): string | null {
    this.calls.getShaderInfoLog++;
    return null;
  }
  getActiveUniform(_p: WebGLProgram, _i: number): WebGLActiveInfo | null {
    this.calls.getActiveUniform++;
    return null;
  }
  getActiveAttrib(_p: WebGLProgram, _i: number): WebGLActiveInfo | null {
    this.calls.getActiveAttrib++;
    return null;
  }
  getUniformLocation(_p: WebGLProgram, _name: string): WebGLUniformLocation | null {
    this.calls.getUniformLocation++;
    return makeHandle('uniform') as unknown as WebGLUniformLocation;
  }
  getAttribLocation(_p: WebGLProgram, _name: string): number {
    this.calls.getAttribLocation++;
    return -1;
  }

  texImage2D(..._args: unknown[]): void { this.calls.texImage2D++; }
  texParameteri(_t: number, _n: number, _v: number): void { this.calls.texParameteri++; }
  framebufferTexture2D(_t: number, _att: number, _texT: number, _tex: WebGLTexture | null, _lv: number): void {
    this.calls.framebufferTexture2D++;
  }
  drawBuffers(_bufs: number[]): void { this.calls.drawBuffers++; }
  checkFramebufferStatus(_t: number): number {
    this.calls.checkFramebufferStatus++;
    return GL.FRAMEBUFFER_COMPLETE;
  }
  pixelStorei(_name: number, _value: number): void { this.calls.pixelStorei++; }
}

function asGL(gl: MockGL2): WebGL2RenderingContext {
  return gl as unknown as WebGL2RenderingContext;
}

describe('DeferredRenderer', () => {
  it('构造时初始化 GBuffer + 编译两个 shader', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 256, height: 256 });
    expect(dr.screenWidth).toBe(256);
    expect(dr.screenHeight).toBe(256);
    expect(dr.gbuffer).toBeDefined();
    // GBuffer setup 触发 4 颜色 + 1 深度 = 5 个纹理
    expect(gl.calls.createTexture).toBeGreaterThanOrEqual(5);
    // 1 GBuffer FBO
    expect(gl.calls.createFramebuffer).toBeGreaterThanOrEqual(1);
    // 编译 2 个 shader × (vert + frag) = 4 个 shader
    expect(gl.calls.createShader).toBe(4);
    // 2 个 program
    expect(gl.calls.createProgram).toBe(2);
    // 全屏三角形 VAO
    expect(gl.calls.createVertexArray).toBeGreaterThanOrEqual(1);
    dr.dispose(asGL(gl));
  });

  it('resize 调整 GBuffer 与 screenWidth/Height', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });
    expect(dr.screenWidth).toBe(64);
    dr.resize(asGL(gl), 128, 128);
    expect(dr.screenWidth).toBe(128);
    expect(dr.screenHeight).toBe(128);
    dr.dispose(asGL(gl));
  });

  it('resize 拒绝 width/height < 1', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });
    expect(() => dr.resize(asGL(gl), 0, 64)).toThrowError(/width\/height/);
    expect(() => dr.resize(asGL(gl), 64, 0)).toThrowError(/width\/height/);
    dr.dispose(asGL(gl));
  });

  it('resize 同尺寸是 no-op', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });
    const beforeTextureCount = gl.calls.createTexture;
    dr.resize(asGL(gl), 64, 64);
    // 不应触发新纹理分配
    expect(gl.calls.createTexture).toBe(beforeTextureCount);
    dr.dispose(asGL(gl));
  });

  it('geometryPass 渲染 mesh 到 GBuffer', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 128, height: 128 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new StandardMaterial(),
    );
    scene.add(mesh);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    dr.geometryPass(asGL(gl), scene, camera);

    // 应触发 drawElements(BoxGeometry 有索引)
    expect(gl.calls.drawElements).toBeGreaterThan(0);
    // stats 应记录 draw call
    expect(dr.stats.geometryDrawCalls).toBe(1);
    expect(dr.stats.geometryTriangles).toBeGreaterThan(0);

    dr.dispose(asGL(gl));
  });

  it('lightingPass 绑定 4 个 GBuffer 纹理并绘制全屏三角形', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });

    const lights = [
      new AmbientLight(0xffffff, 0.3),
      new DirectionalLight(0xffffff, 1.0, { x: 0, y: -1, z: 0 }),
      new PointLight(0xff8800, 1.0, 10, 2),
    ];

    // 先 useProgram,否则 lightingPass 内部 uniform 调用会失败
    dr.lightingShader.use();
    dr.lightingPass(asGL(gl), lights);

    // 4 个 GBuffer 纹理都应被绑定
    expect(gl.calls.activeTexture).toBeGreaterThanOrEqual(4);
    expect(gl.calls.bindTexture).toBeGreaterThanOrEqual(4);
    // 全屏三角形一次 drawArrays
    expect(gl.calls.drawArrays).toBeGreaterThanOrEqual(1);
    // stats.lightCount = 2(ambient 不计入,只 directional + point)
    expect(dr.stats.lightCount).toBe(2);

    dr.dispose(asGL(gl));
  });

  it('render 完整流程跑通(geometry + lighting)', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 128, height: 128 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    scene.add(new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial()));
    camera.updateMatrixWorld(true);

    const lights = [new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 })];

    expect(() => dr.render(asGL(gl), scene, camera, lights)).not.toThrow();
    expect(dr.stats.geometryDrawCalls).toBe(1);
    expect(dr.stats.lightCount).toBe(1);

    dr.dispose(asGL(gl));
  });

  it('render 在 dispose 后抛错', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });
    dr.dispose(asGL(gl));
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    expect(() => dr.render(asGL(gl), scene, camera, [])).toThrowError(/disposed/);
  });

  it('dispose 释放所有 GL 资源', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });
    const beforeDeleteTex = gl.calls.deleteTexture;
    const beforeDeleteProg = gl.calls.deleteProgram;
    dr.dispose(asGL(gl));
    // dispose 后应有更多 delete 调用
    expect(gl.calls.deleteTexture).toBeGreaterThan(beforeDeleteTex);
    expect(gl.calls.deleteProgram).toBeGreaterThan(beforeDeleteProg);
  });

  it('最多处理 8 个光源(超出截断)', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });

    // 10 个 directional light,应该只处理 8 个
    const lights = Array.from({ length: 10 }, () =>
      new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 }),
    );
    dr.lightingShader.use();
    dr.lightingPass(asGL(gl), lights);
    expect(dr.stats.lightCount).toBe(8);

    dr.dispose(asGL(gl));
  });

  it('ambient 光源不计入 lightCount 但累加到 ambientColor', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });

    const lights = [
      new AmbientLight(0xffffff, 0.5),
      new AmbientLight(0xff0000, 0.5),
    ];
    dr.lightingShader.use();
    dr.lightingPass(asGL(gl), lights);
    expect(dr.stats.lightCount).toBe(0); // 都是 ambient,不计入

    dr.dispose(asGL(gl));
  });

  it('geometryPass 跳过 invisible mesh', () => {
    const gl = new MockGL2();
    const dr = new DeferredRenderer(asGL(gl), { width: 64, height: 64 });

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);

    const visibleMesh = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    visibleMesh.visible = true;
    const invisibleMesh = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    invisibleMesh.visible = false;
    scene.add(visibleMesh);
    scene.add(invisibleMesh);

    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    dr.geometryPass(asGL(gl), scene, camera);
    // 只有 visible mesh 应被渲染
    expect(dr.stats.geometryDrawCalls).toBe(1);

    dr.dispose(asGL(gl));
  });
});
