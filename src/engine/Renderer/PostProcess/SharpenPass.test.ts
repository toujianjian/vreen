// SharpenPass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. sharpness 字段边界与运行时可变
//   3. apply() 在 mock PassContext 下不抛错并返回纹理
//   4. draw call 计数
//   5. CAS_FRAG shader 源码校验(GLSL ES 3.0、uniform、Laplacian、
//      对比度自适应权重、min/max 钳制防光晕、sharpness early-out)

import { describe, it, expect } from 'vitest';
import { SharpenPass } from './SharpenPass';
import { CAS_FRAG } from '../../Materials/shaders';

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

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;

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

describe('SharpenPass construction', () => {
  it('defaults: sharpness=0.5, enabled=false', () => {
    const p = new SharpenPass();
    expect(p.name).toBe('sharpen');
    expect(p.sharpness).toBe(0.5);
    expect(p.enabled).toBe(false);
  });

  it('accepts all options', () => {
    const p = new SharpenPass({ sharpness: 0.8, enabled: true });
    expect(p.sharpness).toBe(0.8);
    expect(p.enabled).toBe(true);
  });

  it('accepts sharpness=0 (passthrough)', () => {
    const p = new SharpenPass({ sharpness: 0 });
    expect(p.sharpness).toBe(0);
  });

  it('accepts sharpness=1 (max)', () => {
    const p = new SharpenPass({ sharpness: 1 });
    expect(p.sharpness).toBe(1);
  });
});

// ── sharpness 字段 ─────────────────────────────────────────────────

describe('SharpenPass sharpness', () => {
  it('sharpness is mutable at runtime', () => {
    const p = new SharpenPass();
    p.sharpness = 0.7;
    expect(p.sharpness).toBe(0.7);
    p.sharpness = 0.0;
    expect(p.sharpness).toBe(0.0);
  });

  it('enabled is mutable at runtime', () => {
    const p = new SharpenPass();
    expect(p.enabled).toBe(false);
    p.enabled = true;
    expect(p.enabled).toBe(true);
  });
});

// ── apply ──────────────────────────────────────────────────────────

describe('SharpenPass apply', () => {
  it('apply() does not throw and returns a texture', () => {
    const ctx = makeCtx();
    const p = new SharpenPass();
    const input = { id: 'input' } as unknown as WebGLTexture;
    const out = p.apply(input, ctx as unknown as any);
    expect(out).toBeDefined();
    expect(out).toBe(ctx.resources.finalTexture);
  });

  it('apply() draws exactly 1 draw call', () => {
    const ctx = makeCtx();
    const p = new SharpenPass();
    p.apply({} as WebGLTexture, ctx as unknown as any);
    expect(ctx.gl.drawCalls).toBe(1);
    p.apply({} as WebGLTexture, ctx as unknown as any);
    expect(ctx.gl.drawCalls).toBe(2);
  });

  it('apply() works with sharpness=0 (passthrough still draws)', () => {
    const ctx = makeCtx();
    const p = new SharpenPass({ sharpness: 0 });
    expect(() => p.apply({} as WebGLTexture, ctx as unknown as any)).not.toThrow();
    expect(ctx.gl.drawCalls).toBe(1);
  });

  it('apply() works with sharpness=1 (max)', () => {
    const ctx = makeCtx();
    const p = new SharpenPass({ sharpness: 1 });
    expect(() => p.apply({} as WebGLTexture, ctx as unknown as any)).not.toThrow();
    expect(ctx.gl.drawCalls).toBe(1);
  });

  it('apply() returns finalTexture from resources', () => {
    const ctx = makeCtx();
    const p = new SharpenPass({ enabled: true });
    const out = p.apply({} as WebGLTexture, ctx as unknown as any);
    expect(out).toBe(ctx.resources.finalTexture);
  });
});

// ── CAS_FRAG shader 源码校验 ──────────────────────────────────────

describe('CAS_FRAG shader source', () => {
  it('is GLSL ES 3.0', () => {
    expect(CAS_FRAG).toContain('#version 300 es');
  });

  it('declares required uniforms', () => {
    expect(CAS_FRAG).toContain('u_colorMap');
    expect(CAS_FRAG).toContain('u_screenSize');
    expect(CAS_FRAG).toContain('u_sharpness');
  });

  it('samples center + 4 neighbors (cross pattern)', () => {
    expect(CAS_FRAG).toContain('v_uv + vec2(0.0, -t.y)'); // north
    expect(CAS_FRAG).toContain('v_uv + vec2(0.0,  t.y)'); // south
    expect(CAS_FRAG).toContain('v_uv + vec2(-t.x, 0.0)'); // west
    expect(CAS_FRAG).toContain('v_uv + vec2( t.x, 0.0)'); // east
  });

  it('computes Laplacian edge detector', () => {
    expect(CAS_FRAG).toContain('lap');
    expect(CAS_FRAG).toContain('- 4.0 * b');
  });

  it('computes 5-tap min/max for contrast range', () => {
    expect(CAS_FRAG).toContain('mn = min(mn, b)');
    expect(CAS_FRAG).toContain('mx = max(mx, b)');
    expect(CAS_FRAG).toContain('rng = mx - mn');
  });

  it('uses contrast-adaptive weight (peak / (range * 4 + 1))', () => {
    expect(CAS_FRAG).toContain('peak = 8.0 - 3.0');
    expect(CAS_FRAG).toContain('peak / (rng * 4.0 + 1.0)');
  });

  it('clamps result to neighborhood min/max (anti-halo)', () => {
    expect(CAS_FRAG).toContain('clamp(sharp, mn, mx)');
  });

  it('has sharpness=0 early-out (passthrough)', () => {
    expect(CAS_FRAG).toContain('u_sharpness <= 0.0');
    expect(CAS_FRAG).toContain('outColor = vec4(b, 1.0)');
  });

  it('outputs sharpened color', () => {
    expect(CAS_FRAG).toContain('outColor = vec4(sharp, 1.0)');
  });
});
