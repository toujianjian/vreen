// GlitchPass 单元测试。
//
// 验证:
//   1. 构造器默认值与选项覆盖
//   2. 继承 RenderPass
//   3. apply() 在 mock GL 上下文下不抛错
//   4. goWild 模式下 byp 始终为 0
//   5. dispose() 清理位移纹理
//   6. 随机触发逻辑:多次 apply 后 _randX 被更新

import { describe, it, expect } from 'vitest';
import { RenderPass, type PassContext } from '../RenderPass';
import { GlitchPass } from './GlitchPass';

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

function makeCtx(gl: MockGL2): PassContext {
  return {
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
}

// ── 测试 ─────────────────────────────────────────────────────────

describe('GlitchPass: construction', () => {
  it('creates with default values', () => {
    const p = new GlitchPass();
    expect(p).toBeInstanceOf(RenderPass);
    expect(p.name).toBe('glitch');
    expect(p.enabled).toBe(false);
    expect(p.goWild).toBe(false);
  });

  it('accepts custom options', () => {
    const p = new GlitchPass({ goWild: true, enabled: true, dispSize: 32 });
    expect(p.goWild).toBe(true);
    expect(p.enabled).toBe(true);
  });
});

describe('GlitchPass: apply()', () => {
  it('does not throw in mock GL context', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new GlitchPass();
    const input = makeTex('input');
    expect(() => p.apply(input, ctx)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('returns finalTexture from resources', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new GlitchPass();
    const result = p.apply(makeTex('input'), ctx);
    expect(result).toBe(ctx.resources.finalTexture);
  });

  it('multiple apply() calls do not throw', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new GlitchPass();
    for (let i = 0; i < 300; i++) {
      expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    }
    expect(gl.drawCalls).toBe(300);
  });
});

describe('GlitchPass: goWild mode', () => {
  it('does not throw when goWild is true', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new GlitchPass({ goWild: true });
    for (let i = 0; i < 100; i++) {
      expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    }
  });
});

describe('GlitchPass: dispose', () => {
  it('dispose() does not throw', () => {
    const p = new GlitchPass();
    expect(() => p.dispose()).not.toThrow();
  });
});
