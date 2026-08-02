// SMAAPass 单元测试。
//
// 验证:
//   1. 构造器默认值与选项覆盖
//   2. 继承 RenderPass
//   3. apply() 在 mock GL 上下文下不抛错
//   4. apply() 执行 3 个 pass(3 次 drawArrays)
//   5. apply() 返回 finalTexture
//   6. 尺寸变更触发重建
//   7. dispose() 清理资源
//   8. 多次 apply 不抛错

import { describe, it, expect } from 'vitest';
import { RenderPass, type PassContext } from '../RenderPass';
import { SMAAPass } from './SMAAPass';

// ── MockGL2 ──────────────────────────────────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TRIANGLES = 0x0004;
  static readonly RGBA = 0x1908;
  static readonly RG = 0x8227;
  static readonly RED = 0x1903;
  static readonly RGBA8 = 0x8058;
  static readonly RG8 = 0x822B;
  static readonly R8 = 0x8229;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly NEAREST = 0x2600;
  static readonly CLAMP_TO_EDGE = 0x812F;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly RGBA = MockGL2.RGBA;
  readonly RG = MockGL2.RG;
  readonly RED = MockGL2.RED;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RG8 = MockGL2.RG8;
  readonly R8 = MockGL2.R8;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly NEAREST = MockGL2.NEAREST;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;

  drawCalls = 0;
  texCount = 0;
  fboCount = 0;
  private _c = 0;

  createTexture(): WebGLTexture { return { id: `t${++this._c}` } as unknown as WebGLTexture; }
  createFramebuffer(): WebGLFramebuffer { return { id: `f${++this._c}` } as unknown as WebGLFramebuffer; }
  createVertexArray(): WebGLVertexArrayObject { return { id: `v${++this._c}` } as unknown as WebGLVertexArrayObject; }
  createBuffer(): WebGLBuffer { return { id: `b${++this._c}` } as unknown as WebGLBuffer; }
  deleteTexture(): void {}
  deleteFramebuffer(): void {}
  deleteVertexArray(): void {}
  deleteBuffer(): void {}
  bindFramebuffer(): void {}
  viewport(): void {}
  clearColor(): void {}
  clear(): void {}
  activeTexture(): void {}
  bindTexture(): void {}
  texImage2D(): void { this.texCount++; }
  texParameteri(): void {}
  framebufferTexture2D(): void { this.fboCount++; }
  bindVertexArray(): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
  useProgram(): void {}
  pixelStorei(): void {}
  bindBuffer(): void {}
  bufferData(): void {}
  enableVertexAttribArray(): void {}
  vertexAttribPointer(): void {}
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

describe('SMAAPass: construction', () => {
  it('creates with default values', () => {
    const p = new SMAAPass();
    expect(p).toBeInstanceOf(RenderPass);
    expect(p.name).toBe('smaa');
    expect(p.enabled).toBe(false);
  });

  it('accepts custom options', () => {
    const p = new SMAAPass({ enabled: true });
    expect(p.enabled).toBe(true);
  });
});

describe('SMAAPass: apply()', () => {
  it('does not throw in mock GL context', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();
    const input = makeTex('input');
    expect(() => p.apply(input, ctx)).not.toThrow();
  });

  it('executes 3 draw calls (3 passes)', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();
    p.apply(makeTex('input'), ctx);
    // 3 passes: edges + weights + blend
    expect(gl.drawCalls).toBe(3);
  });

  it('returns finalTexture from resources', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();
    const result = p.apply(makeTex('input'), ctx);
    expect(result).toBe(ctx.resources.finalTexture);
  });

  it('multiple apply() calls do not throw', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();
    for (let i = 0; i < 10; i++) {
      expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    }
    // 10 frames × 3 passes = 30 draw calls
    expect(gl.drawCalls).toBe(30);
  });

  it('recreates FBOs when size changes', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();

    // 首次创建
    p.apply(makeTex('input'), ctx);
    const firstTexCount = gl.texCount;

    // 尺寸变更 → 重建
    ctx.resources.width = 1024;
    ctx.resources.height = 768;
    p.apply(makeTex('input'), ctx);

    // 应该创建了更多纹理(edges + weights 重建)
    expect(gl.texCount).toBeGreaterThan(firstTexCount);
  });
});

describe('SMAAPass: dispose', () => {
  it('dispose() does not throw before apply', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();
    expect(() => p.dispose(ctx)).not.toThrow();
  });

  it('dispose() does not throw after apply', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();
    p.apply(makeTex('input'), ctx);
    expect(() => p.dispose(ctx)).not.toThrow();
  });

  it('can re-apply after dispose', () => {
    const gl = new MockGL2();
    const ctx = makeCtx(gl);
    const p = new SMAAPass();
    p.apply(makeTex('input'), ctx);
    p.dispose(ctx);
    gl.drawCalls = 0;
    expect(() => p.apply(makeTex('input'), ctx)).not.toThrow();
    expect(gl.drawCalls).toBe(3);
  });
});
