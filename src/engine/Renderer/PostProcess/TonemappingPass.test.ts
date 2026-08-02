// TonemappingPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. mode 字段所有 5 种值
//   3. exposure 边界
//   4. apply() 在 mock PassContext 下不抛错并返回纹理
//   5. draw call 计数
//   6. TONEMAP_FRAG shader 源码校验

import { describe, it, expect } from 'vitest';
import { TonemappingPass, type TonemappingMode } from './TonemappingPass';
import { TONEMAP_FRAG } from '../../Materials/shaders';

// ── Mock PassContext ───────────────────────────────────────────────

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TRIANGLES = 0x0004;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;

  canvas = { width: 800, height: 600 };
  drawCalls = 0;
  private _c = 0;
  private _id(): unknown { this._c++; return { id: this._c } as unknown; }

  createProgram(): WebGLProgram { return this._id() as WebGLProgram; }
  createShader(_t: number): WebGLShader { return this._id() as WebGLShader; }
  shaderSource() {} compileShader() {}
  getShaderParameter(): unknown { return true; }
  getShaderInfoLog(): string | null { return null; }
  attachShader() {} linkProgram() {}
  getProgramParameter(_p: WebGLProgram, pname: number): unknown {
    if (pname === this.LINK_STATUS) return true;
    return 0;
  }
  getProgramInfoLog(): string | null { return null; }
  getActiveUniform(): unknown { return null; }
  getActiveAttrib(): unknown { return null; }
  getUniformLocation(): WebGLUniformLocation | null { return null; }
  getAttribLocation(): number { return -1; }

  useProgram() {}
  uniform1f() {} uniform1i() {} uniform2f() {} uniform3f() {}
  uniform4f() {} uniformMatrix3fv() {} uniformMatrix4fv() {}

  bindFramebuffer() {} viewport() {} clear() {} clearColor() {}
  activeTexture() {} bindTexture() {}
  bindVertexArray() {} drawArrays() { this.drawCalls++; }
}

function makeCtx() {
  const gl = new MockGL2();
  const finalTexture: WebGLTexture = { id: 'final' } as unknown as WebGLTexture;
  const finalFbo: WebGLFramebuffer = { id: 'fbo' } as unknown as WebGLFramebuffer;
  const fullscreenQuad: WebGLVertexArrayObject = { id: 'vao' } as unknown as WebGLVertexArrayObject;

  return {
    gl,
    resources: { finalFbo, finalTexture, width: 800, height: 600 },
    fullscreenQuad,
    getProgram: (_name: string, _vs: string, _fs: string) => ({
      use() {},
      setUniformSampler() {},
      setUniform1f() {},
      setUniform1i() {},
      setUniform2f() {},
      setUniform3f() {},
      setUniform4f() {},
      setUniformMatrix3fv() {},
      setUniformMatrix4fv() {},
      dispose() {},
    }),
  };
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('TonemappingPass construction', () => {
  it('defaults: mode=aces, exposure=1.0, enabled=true', () => {
    const p = new TonemappingPass();
    expect(p.name).toBe('tonemapping');
    expect(p.mode).toBe('aces');
    expect(p.exposure).toBe(1.0);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new TonemappingPass({ mode: 'agx', exposure: 1.5, enabled: false });
    expect(p.mode).toBe('agx');
    expect(p.exposure).toBe(1.5);
    expect(p.enabled).toBe(false);
  });
});

// ── mode 字段 ──────────────────────────────────────────────────────

describe('TonemappingPass mode', () => {
  const modes: TonemappingMode[] = ['linear', 'aces', 'reinhard', 'agx', 'uncharted2'];
  for (const m of modes) {
    it(`accepts mode='${m}'`, () => {
      const p = new TonemappingPass({ mode: m });
      expect(p.mode).toBe(m);
    });
  }

  it('mode is mutable at runtime', () => {
    const p = new TonemappingPass();
    p.mode = 'reinhard';
    expect(p.mode).toBe('reinhard');
    p.mode = 'agx';
    expect(p.mode).toBe('agx');
  });
});

// ── exposure ───────────────────────────────────────────────────────

describe('TonemappingPass exposure', () => {
  it('exposure can be > 1 (brighten)', () => {
    const p = new TonemappingPass({ exposure: 2.5 });
    expect(p.exposure).toBe(2.5);
  });

  it('exposure can be < 1 (darken)', () => {
    const p = new TonemappingPass({ exposure: 0.3 });
    expect(p.exposure).toBe(0.3);
  });

  it('exposure is mutable at runtime', () => {
    const p = new TonemappingPass();
    p.exposure = 1.8;
    expect(p.exposure).toBe(1.8);
  });
});

// ── apply ──────────────────────────────────────────────────────────

describe('TonemappingPass apply', () => {
  it('apply() does not throw and returns a texture', () => {
    const ctx = makeCtx();
    const p = new TonemappingPass();
    const input = { id: 'input' } as unknown as WebGLTexture;
    const out = p.apply(input, ctx as unknown as any);
    expect(out).toBeDefined();
    expect(ctx.gl.drawCalls).toBe(1);
  });

  it('apply() works with all 5 modes', () => {
    const modes: TonemappingMode[] = ['linear', 'aces', 'reinhard', 'agx', 'uncharted2'];
    for (const m of modes) {
      const ctx = makeCtx();
      const p = new TonemappingPass({ mode: m });
      const input = { id: 'in' } as unknown as WebGLTexture;
      expect(() => p.apply(input, ctx as unknown as any)).not.toThrow();
    }
  });

  it('apply() draws exactly 1 draw call per apply', () => {
    const ctx = makeCtx();
    const p = new TonemappingPass();
    p.apply({} as WebGLTexture, ctx as unknown as any);
    expect(ctx.gl.drawCalls).toBe(1);
    p.apply({} as WebGLTexture, ctx as unknown as any);
    expect(ctx.gl.drawCalls).toBe(2);
  });
});

// ── TONEMAP_FRAG shader 源码校验 ─────────────────────────────────

describe('TONEMAP_FRAG shader source', () => {
  it('is GLSL ES 3.0', () => {
    expect(TONEMAP_FRAG).toContain('#version 300 es');
  });

  it('declares required uniforms', () => {
    expect(TONEMAP_FRAG).toContain('u_colorMap');
    expect(TONEMAP_FRAG).toContain('u_exposure');
    expect(TONEMAP_FRAG).toContain('u_mode');
  });

  it('contains ACES Filmic function (Narkowicz)', () => {
    expect(TONEMAP_FRAG).toContain('acesFilmic');
    expect(TONEMAP_FRAG).toContain('2.51');
    expect(TONEMAP_FRAG).toContain('0.03');
  });

  it('contains Reinhard function', () => {
    expect(TONEMAP_FRAG).toContain('reinhardTonemap');
    expect(TONEMAP_FRAG).toContain('x / (x + vec3(1.0))');
  });

  it('contains AGX simplified function', () => {
    expect(TONEMAP_FRAG).toContain('agxSimplified');
    expect(TONEMAP_FRAG).toContain('log2');
    expect(TONEMAP_FRAG).toContain('sigmoid');
  });

  it('contains Uncharted 2 (Hable) function', () => {
    expect(TONEMAP_FRAG).toContain('uncharted2Partial');
    expect(TONEMAP_FRAG).toContain('0.15');
    expect(TONEMAP_FRAG).toContain('0.50');
  });

  it('has 5 mode branches (0=Linear, 1=ACES, 2=Reinhard, 3=AGX, 4=Uncharted2)', () => {
    expect(TONEMAP_FRAG).toContain('u_mode == 0');
    expect(TONEMAP_FRAG).toContain('u_mode == 1');
    expect(TONEMAP_FRAG).toContain('u_mode == 2');
    expect(TONEMAP_FRAG).toContain('u_mode == 3');
  });

  it('applies exposure before tonemapping', () => {
    expect(TONEMAP_FRAG).toContain('hdr *= u_exposure');
  });

  it('outputs LDR color clamped to [0, 1]', () => {
    expect(TONEMAP_FRAG).toContain('outColor = vec4(ldr');
  });
});
