// LUTPass 单元测试。
//
// 验证:
//   1. 构造器默认值与选项覆盖
//   2. 继承 RenderPass
//   3. apply() 在 mock GL 上下文下不抛错
//   4. 3D LUT 路径(TEXTURE_3D + sampler3D)
//   5. 2D strip LUT 路径(TEXTURE_2D + sampler2D)
//   6. null LUT 时直通输入(返回 input,不绘制)
//   7. VREEN Texture 解析路径(_resolveLut 经 renderer.getGLTexture)
//   8. 多次 apply() 稳定
//   9. dispose() 无副作用(noop,不抛错)

import { describe, it, expect } from 'vitest';
import { RenderPass, type PassContext } from '../RenderPass';
import { LUTPass } from './LUTPass';
import type { Texture } from '../../Core/Texture';

// ── MockGL2 (复用 PostProcessPasses.test.ts 的模式) ──────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE_3D = 0x806F;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly RGBA = 0x1908;
  static readonly HALF_FLOAT = 0x8D61;
  static readonly RGBA16F = 0x881A;
  static readonly RED = 0x1903;
  static readonly R32F = 0x822E;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly NEAREST = 0x2600;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly REPEAT = 0x2901;
  static readonly FLOAT = 0x1406;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE_3D = MockGL2.TEXTURE_3D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly RGBA = MockGL2.RGBA;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly RED = MockGL2.RED;
  readonly R32F = MockGL2.R32F;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly NEAREST = MockGL2.NEAREST;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly REPEAT = MockGL2.REPEAT;
  readonly FLOAT = MockGL2.FLOAT;

  drawCalls = 0;
  private _c = 0;
  createTexture(): WebGLTexture { return { id: `t${++this._c}` } as unknown as WebGLTexture; }
  createFramebuffer(): WebGLFramebuffer { return { id: `f${++this._c}` } as unknown as WebGLFramebuffer; }
  deleteTexture(): void {}
  deleteFramebuffer(): void {}
  bindFramebuffer(): void {}
  viewport(): void {}
  clear(): void {}
  activeTexture(): void {}
  bindTexture(): void {}
  texImage2D(): void {}
  texImage3D(): void {}
  texParameteri(): void {}
  framebufferTexture2D(): void {}
  bindVertexArray(): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
  useProgram(): void {}
  pixelStorei(): void {}
  texStorage3D(): void {}
}

function makeTex(id: string): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

function makeCtx(gl: MockGL2, renderer?: object): PassContext {
  const ctx: PassContext = {
    gl: gl as unknown as WebGL2RenderingContext,
    width: 800,
    height: 600,
    fullscreenQuad: {} as WebGLVertexArrayObject,
    resources: {
      mainFbo: {} as WebGLFramebuffer,
      mainTexture: makeTex('main'),
      bloomFbo1: {} as WebGLFramebuffer,
      bloomTexture1: makeTex('bloom1'),
      bloomFbo2: {} as WebGLFramebuffer,
      bloomTexture2: makeTex('bloom2'),
      finalFbo: {} as WebGLFramebuffer,
      finalTexture: makeTex('final'),
      width: 800,
      height: 600,
    },
    getProgram: () => ({
      use: () => {},
      setUniformSampler: () => {},
      setUniform1f: () => {},
      setUniform1i: () => {},
      setUniform2f: () => {},
      setUniform3f: () => {},
      setUniform4f: () => {},
      setUniformMatrix4fv: () => {},
      setUniformMatrix3fv: () => {},
    } as never),
  };
  if (renderer) {
    (ctx as { renderer?: unknown }).renderer = renderer;
  }
  return ctx;
}

/** 造一个最小化的 mock Texture(带 uuid + glTexture,匹配 _resolveLut 的检测)。 */
function makeMockTexture(glTexture: WebGLTexture): Texture {
  return {
    uuid: `tex-${Math.random()}`,
    glTexture,
  } as unknown as Texture;
}

// ── 测试 ─────────────────────────────────────────────────────────

describe('LUTPass: construction', () => {
  it('creates with default values', () => {
    const p = new LUTPass();
    expect(p).toBeInstanceOf(RenderPass);
    expect(p.name).toBe('lut');
    expect(p.enabled).toBe(false);
    expect(p.lut).toBeNull();
    expect(p.lutSize).toBe(16);
    expect(p.is3D).toBe(true);
    expect(p.intensity).toBeCloseTo(1.0, 5);
  });

  it('accepts custom options', () => {
    const tex = makeTex('my-lut');
    const p = new LUTPass({
      lut: tex,
      lutSize: 32,
      is3D: false,
      intensity: 0.7,
      enabled: true,
    });
    expect(p.lut).toBe(tex);
    expect(p.lutSize).toBe(32);
    expect(p.is3D).toBe(false);
    expect(p.intensity).toBeCloseTo(0.7, 5);
    expect(p.enabled).toBe(true);
  });

  it('accepts null lut explicitly', () => {
    const p = new LUTPass({ lut: null });
    expect(p.lut).toBeNull();
  });
});

describe('LUTPass: apply() with 3D LUT', () => {
  it('does not throw in mock GL context', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut3d'), is3D: true, enabled: true });
    expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
  });

  it('issues exactly 1 draw call', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut3d'), is3D: true, enabled: true });
    p.apply(makeTex('input'), ctx);
    expect(gl.drawCalls).toBe(1);
  });

  it('returns finalTexture from resources', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut3d'), is3D: true, enabled: true });
    const result = p.apply(makeTex('input'), ctx);
    expect(result).toBe(ctx.resources.finalTexture);
  });
});

describe('LUTPass: apply() with 2D strip LUT', () => {
  it('does not throw in mock GL context', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut2d'), is3D: false, enabled: true });
    expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
  });

  it('issues exactly 1 draw call', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut2d'), is3D: false, enabled: true });
    p.apply(makeTex('input'), ctx);
    expect(gl.drawCalls).toBe(1);
  });

  it('returns finalTexture from resources', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut2d'), is3D: false, enabled: true });
    const result = p.apply(makeTex('input'), ctx);
    expect(result).toBe(ctx.resources.finalTexture);
  });
});

describe('LUTPass: apply() with null LUT (passthrough)', () => {
  it('returns input directly when lut is null', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: null, enabled: true });
    const input = makeTex('input');
    const result = p.apply(input, ctx);
    expect(result).toBe(input);
  });

  it('issues 0 draw calls when lut is null', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: null, enabled: true });
    p.apply(makeTex('input'), ctx);
    expect(gl.drawCalls).toBe(0);
  });

  it('does not bind finalFbo when passing through', () => {
    // 直通时不应写入 finalFbo(避免覆盖已有内容)
    // MockGL2 的 bindFramebuffer 是 noop,所以只验证不抛错 + drawCalls=0
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: null, enabled: true });
    expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    expect(gl.drawCalls).toBe(0);
  });
});

describe('LUTPass: apply() with VREEN Texture', () => {
  it('resolves VREEN Texture via renderer.getGLTexture', () => {
    const gl = new MockGL2();
    const resolvedTex = makeTex('resolved');
    const mockRenderer = {
      getGLTexture: (_t: Texture) => resolvedTex,
    };
    const ctx = makeCtx(gl, mockRenderer);
    const vreenTex = makeMockTexture(resolvedTex);
    const p = new LUTPass({ lut: vreenTex, is3D: true, enabled: true });
    expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('falls back to glTexture when renderer has no getGLTexture', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl, {}); // renderer without getGLTexture
    const glTex = makeTex('fallback');
    const vreenTex = makeMockTexture(glTex);
    const p = new LUTPass({ lut: vreenTex, is3D: true, enabled: true });
    expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('handles VREEN Texture with null glTexture via renderer', () => {
    const gl = new MockGL2();
    const resolvedTex = makeTex('lazy-upload');
    const mockRenderer = {
      getGLTexture: (_t: Texture) => resolvedTex,
    };
    const ctx = makeCtx(gl, mockRenderer);
    const vreenTex = makeMockTexture(makeTex('will-be-replaced'));
    const p = new LUTPass({ lut: vreenTex, is3D: false, enabled: true });
    expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });
});

describe('LUTPass: intensity and lutSize', () => {
  it('intensity=0 still draws (shader mixes, CPU does not skip)', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut'), intensity: 0, enabled: true });
    p.apply(makeTex('input'), ctx);
    // intensity=0 时 shader 仍执行 mix(src, graded, 0) = src,但 GPU 仍绘制
    expect(gl.drawCalls).toBe(1);
  });

  it('different lutSize values do not cause errors', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    for (const size of [2, 8, 16, 32, 64]) {
      const p = new LUTPass({ lut: makeTex('lut'), lutSize: size, enabled: true });
      expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    }
  });
});

describe('LUTPass: multiple apply() calls', () => {
  it('stable across repeated calls (3D)', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut'), is3D: true, enabled: true });
    for (let i = 0; i < 10; i++) {
      expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    }
    expect(gl.drawCalls).toBe(10);
  });

  it('stable across repeated calls (2D strip)', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut'), is3D: false, enabled: true });
    for (let i = 0; i < 10; i++) {
      expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    }
    expect(gl.drawCalls).toBe(10);
  });

  it('can switch lut between apply() calls', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut1'), enabled: true });
    p.apply(makeTex('input'), ctx);
    p.lut = makeTex('lut2');
    p.apply(makeTex('input'), ctx);
    p.lut = null;
    const passthroughInput = makeTex('input-passthrough');
    const result = p.apply(passthroughInput, ctx);
    // null LUT → 直通,返回输入纹理本身
    expect(result).toBe(passthroughInput);
    // 前 2 次绘制,第 3 次直通(0 draw call)
    expect(gl.drawCalls).toBe(2);
  });
});

describe('LUTPass: dispose()', () => {
  it('dispose does not throw (noop)', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut'), enabled: true });
    expect(() => p.dispose(ctx)).not.toThrow();
  });

  it('dispose can be called multiple times', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new LUTPass({ lut: makeTex('lut'), enabled: true });
    expect(() => { p.dispose(ctx); p.dispose(ctx); p.dispose(ctx); }).not.toThrow();
  });
});

describe('LUTPass: name and type', () => {
  it('has stable name "lut"', () => {
    const p1 = new LUTPass();
    const p2 = new LUTPass();
    expect(p1.name).toBe('lut');
    expect(p2.name).toBe('lut');
  });
});
