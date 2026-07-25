// MRTTarget / GBuffer 测试。
//
// Vitest 在 node 环境,无真实 WebGL2 上下文。构造一个 MockGL2 实现
// MRTTarget / GBuffer 实际调用的方法子集,验证:
//   - GL 资源(createTexture / createFramebuffer)被正确分配与释放
//   - framebufferTexture2D 调用次数与 colorCount 一致
//   - drawBuffers 在 bind 时被调用
//   - resize 释放旧纹理、分配新纹理
//   - dispose 清空所有句柄
//   - GBuffer 在 setup 后 4 个颜色纹理 + 1 深度纹理就绪

import { describe, it, expect } from 'vitest';
import { MRTTarget } from './MRTTarget';
import { GBuffer } from './GBuffer';

/** WebGL2 常量子集(数值与 WebGL2 规范一致,便于用 === 比较)。 */
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
} as const;

interface MockTexture { kind: 'texture'; id: number; deleted: boolean; }
interface MockFramebuffer { kind: 'framebuffer'; id: number; deleted: boolean; }

/** WebGL2 mock,记录所有调用供断言。 */
class MockGL2 {
  // GL 常量直接挂在实例上,方便 MRTTarget 用 gl.XXX 访问
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

  textures: Map<number, MockTexture> = new Map();
  framebuffers: Map<number, MockFramebuffer> = new Map();
  private _nextId = 1;

  // 调用记录
  texImage2DCalls: number = 0;
  texParameteriCalls: number = 0;
  framebufferTexture2DCalls: number = 0;
  drawBuffersCalls: number[][] = [];
  bindFramebufferCalls: Array<WebGLFramebuffer | null> = [];
  checkStatus: number = GL.FRAMEBUFFER_COMPLETE;

  // 当前绑定状态
  boundFramebuffer: WebGLFramebuffer | null = null;

  getParameter(name: number): number {
    if (name === GL.MAX_COLOR_ATTACHMENTS) return 8;
    if (name === GL.MAX_DRAW_BUFFERS) return 8;
    return 0;
  }

  createTexture(): WebGLTexture | null {
    const id = this._nextId++;
    const t: MockTexture = { kind: 'texture', id, deleted: false };
    this.textures.set(id, t);
    return t as unknown as WebGLTexture;
  }

  deleteTexture(t: WebGLTexture | null): void {
    if (!t) return;
    const m = t as unknown as MockTexture;
    m.deleted = true;
  }

  createFramebuffer(): WebGLFramebuffer | null {
    const id = this._nextId++;
    const f: MockFramebuffer = { kind: 'framebuffer', id, deleted: false };
    this.framebuffers.set(id, f);
    return f as unknown as WebGLFramebuffer;
  }

  deleteFramebuffer(f: WebGLFramebuffer | null): void {
    if (!f) return;
    const m = f as unknown as MockFramebuffer;
    m.deleted = true;
  }

  bindFramebuffer(target: number, fbo: WebGLFramebuffer | null): void {
    if (target !== GL.FRAMEBUFFER) return;
    this.boundFramebuffer = fbo;
    this.bindFramebufferCalls.push(fbo);
  }

  bindTexture(_target: number, _t: WebGLTexture | null): void {
    // no-op
  }

  texImage2D(..._args: unknown[]): void {
    this.texImage2DCalls++;
  }

  texParameteri(_target: number, _name: number, _value: number): void {
    this.texParameteriCalls++;
  }

  framebufferTexture2D(
    _target: number,
    _attachment: number,
    _texTarget: number,
    _tex: WebGLTexture | null,
    _level: number,
  ): void {
    this.framebufferTexture2DCalls++;
  }

  checkFramebufferStatus(_target: number): number {
    return this.checkStatus;
  }

  drawBuffers(buffers: number[]): void {
    this.drawBuffersCalls.push(buffers.slice());
  }

  viewport(..._args: unknown[]): void {
    // no-op
  }
}

/** 把 MockGL2 强转为 WebGL2RenderingContext(MRTTarget/GBuffer 仅使用上面 mock 的子集)。 */
function asGL(gl: MockGL2): WebGL2RenderingContext {
  return gl as unknown as WebGL2RenderingContext;
}

describe('MRTTarget', () => {
  it('setup 创建 colorCount 个纹理 + 1 个 FBO', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 256, 256, { colorCount: 3, depth: false });
    expect(mrt.isSetup).toBe(true);
    expect(mrt.textures.length).toBe(3);
    expect(mrt.framebuffer).not.toBeNull();
    expect(mrt.colorCount).toBe(3);
    expect(mrt.width).toBe(256);
    expect(mrt.height).toBe(256);
  });

  it('setup 创建深度附件(默认)', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 2 });
    expect(mrt.depthTexture).not.toBeNull();
  });

  it('setup 不创建深度附件(depth=false)', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 2, depth: false });
    expect(mrt.depthTexture).toBeNull();
  });

  it('setup 用 stencil 创建 DEPTH24_STENCIL8', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 1, stencil: true });
    // 通过 texImage2D 调用次数验证:1 颜色 + 1 深度模板 = 2
    expect(gl.texImage2DCalls).toBe(2);
    expect(mrt.depthTexture).not.toBeNull();
  });

  it('setup 调用 framebufferTexture2D colorCount + 1 次(含深度)', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 4 });
    expect(gl.framebufferTexture2DCalls).toBe(5); // 4 color + 1 depth
  });

  it('setup 抛错当 colorCount > MAX_COLOR_ATTACHMENTS', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    // mock 返回 8,直接给 100
    expect(() => mrt.setup(asGL(gl), 64, 64, { colorCount: 100 })).toThrowError(/out of range/);
  });

  it('setup 抛错当 width/height < 1', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    expect(() => mrt.setup(asGL(gl), 0, 64, { colorCount: 1 })).toThrowError(/width\/height/);
    expect(() => mrt.setup(asGL(gl), 64, 0, { colorCount: 1 })).toThrowError(/width\/height/);
  });

  it('setup 抛错当 framebuffer incomplete', () => {
    const gl = new MockGL2();
    gl.checkStatus = 0x8CD6; // 不等于 FRAMEBUFFER_COMPLETE
    const mrt = new MRTTarget();
    expect(() => mrt.setup(asGL(gl), 64, 64, { colorCount: 1 })).toThrowError(/incomplete/);
    // 失败后应已 dispose
    expect(mrt.isSetup).toBe(false);
  });

  it('bind 配置 drawBuffers([0..colorCount-1])', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 3, depth: false });
    mrt.bind(asGL(gl));
    expect(gl.drawBuffersCalls.length).toBe(1);
    expect(gl.drawBuffersCalls[0]).toEqual([
      GL.COLOR_ATTACHMENT0,
      GL.COLOR_ATTACHMENT0 + 1,
      GL.COLOR_ATTACHMENT0 + 2,
    ]);
  });

  it('bind 在未 setup 时抛错', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    expect(() => mrt.bind(asGL(gl))).toThrowError(/not setup/);
  });

  it('unbind 绑定 null FBO', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 1 });
    mrt.bind(asGL(gl));
    mrt.unbind(asGL(gl));
    const last = gl.bindFramebufferCalls[gl.bindFramebufferCalls.length - 1];
    expect(last).toBeNull();
  });

  it('getColorTexture 越界抛错', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 2 });
    expect(() => mrt.getColorTexture(2)).toThrowError(/out of range/);
    expect(() => mrt.getColorTexture(-1)).toThrowError(/out of range/);
  });

  it('getDepthTexture 无深度时抛错', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 1, depth: false });
    expect(() => mrt.getDepthTexture()).toThrowError(/no depth/);
  });

  it('resize 释放旧纹理 + 分配新纹理(同尺寸跳过)', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 2 });
    const oldTex0 = mrt.textures[0];
    // 同尺寸 → no-op
    mrt.resize(asGL(gl), 64, 64);
    expect(mrt.textures[0]).toBe(oldTex0);
    // 不同尺寸 → 重建
    mrt.resize(asGL(gl), 128, 128);
    expect(mrt.width).toBe(128);
    expect(mrt.height).toBe(128);
    expect(mrt.textures[0]).not.toBe(oldTex0);
    // 旧纹理标记为 deleted
    expect((oldTex0 as unknown as MockTexture).deleted).toBe(true);
  });

  it('resize 在未 setup 时抛错', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    expect(() => mrt.resize(asGL(gl), 64, 64)).toThrowError(/not setup/);
  });

  it('resize 拒绝 width/height < 1', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 1 });
    expect(() => mrt.resize(asGL(gl), 0, 64)).toThrowError(/width\/height/);
  });

  it('dispose 清空所有句柄', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 3 });
    const textures = mrt.textures.slice();
    const fbo = mrt.framebuffer;
    mrt.dispose(asGL(gl));
    expect(mrt.isSetup).toBe(false);
    expect(mrt.textures).toEqual([]);
    expect(mrt.framebuffer).toBeNull();
    expect(mrt.depthTexture).toBeNull();
    expect(mrt.colorCount).toBe(0);
    // 旧句柄标记 deleted
    for (const t of textures) {
      expect((t as unknown as MockTexture).deleted).toBe(true);
    }
    expect((fbo as unknown as MockFramebuffer).deleted).toBe(true);
  });

  it('重复 setup 释放旧资源再重建', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, { colorCount: 2 });
    const oldFbo = mrt.framebuffer;
    const oldTex0 = mrt.textures[0];
    mrt.setup(asGL(gl), 128, 128, { colorCount: 3 });
    expect(mrt.textures.length).toBe(3);
    expect(mrt.width).toBe(128);
    expect(mrt.framebuffer).not.toBe(oldFbo);
    expect((oldFbo as unknown as MockFramebuffer).deleted).toBe(true);
    expect((oldTex0 as unknown as MockTexture).deleted).toBe(true);
  });

  it('colorInternalFormat=rgba8 强制 unsigned-byte 类型', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    // 不抛错即通过(rgba8 + float 会被覆盖为 unsigned-byte)
    expect(() => mrt.setup(asGL(gl), 64, 64, {
      colorCount: 1,
      colorInternalFormat: 'rgba8',
      colorType: 'float',
    })).not.toThrow();
    expect(mrt.isSetup).toBe(true);
  });

  it('colorInternalFormat=rgba32f 创建成功', () => {
    const gl = new MockGL2();
    const mrt = new MRTTarget();
    mrt.setup(asGL(gl), 64, 64, {
      colorCount: 2,
      colorInternalFormat: 'rgba32f',
      colorType: 'float',
    });
    expect(mrt.textures.length).toBe(2);
  });
});

describe('GBuffer', () => {
  it('setup 后 4 个颜色纹理 + 1 深度纹理就绪', () => {
    const gl = new MockGL2();
    const gbuffer = new GBuffer();
    gbuffer.setup(asGL(gl), 256, 256);
    expect(gbuffer.getPosition()).not.toBeNull();
    expect(gbuffer.getNormal()).not.toBeNull();
    expect(gbuffer.getAlbedo()).not.toBeNull();
    expect(gbuffer.getMaterial()).not.toBeNull();
    expect(gbuffer.getDepth()).not.toBeNull();
    expect(gbuffer.width).toBe(256);
    expect(gbuffer.height).toBe(256);
  });

  it('bind / unbind 转发到 mrt', () => {
    const gl = new MockGL2();
    const gbuffer = new GBuffer();
    gbuffer.setup(asGL(gl), 64, 64);
    gbuffer.bind(asGL(gl));
    expect(gl.drawBuffersCalls.length).toBeGreaterThanOrEqual(1);
    expect(gl.drawBuffersCalls[gl.drawBuffersCalls.length - 1].length).toBe(4);
    gbuffer.unbind(asGL(gl));
    const last = gl.bindFramebufferCalls[gl.bindFramebufferCalls.length - 1];
    expect(last).toBeNull();
  });

  it('resize 重建颜色纹理引用', () => {
    const gl = new MockGL2();
    const gbuffer = new GBuffer();
    gbuffer.setup(asGL(gl), 64, 64);
    const oldPos = gbuffer.getPosition();
    gbuffer.resize(asGL(gl), 128, 128);
    expect(gbuffer.width).toBe(128);
    expect(gbuffer.getPosition()).not.toBe(oldPos);
  });

  it('dispose 清空所有纹理引用', () => {
    const gl = new MockGL2();
    const gbuffer = new GBuffer();
    gbuffer.setup(asGL(gl), 64, 64);
    gbuffer.dispose(asGL(gl));
    expect(gbuffer.getPosition()).toBeNull();
    expect(gbuffer.getNormal()).toBeNull();
    expect(gbuffer.getAlbedo()).toBeNull();
    expect(gbuffer.getMaterial()).toBeNull();
    expect(gbuffer.getDepth()).toBeNull();
    expect(gbuffer.mrt.isSetup).toBe(false);
  });

  it('depth=false 不创建深度', () => {
    const gl = new MockGL2();
    const gbuffer = new GBuffer({ depth: false });
    gbuffer.setup(asGL(gl), 64, 64);
    expect(gbuffer.getDepth()).toBeNull();
    expect(gbuffer.getPosition()).not.toBeNull();
  });
});
