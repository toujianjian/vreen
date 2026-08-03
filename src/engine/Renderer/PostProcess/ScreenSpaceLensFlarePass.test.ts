// ScreenSpaceLensFlarePass 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. apply() 在 mock GL 下不抛错并返回纹理
//   3. apply() 首帧分配内部纹理 + FBO + VAO + buffer
//   4. apply() 同尺寸不重复分配
//   5. apply() 禁用时直接返回输入(零 draw call)
//   6. apply() resize 重新分配
//   7. dispose() 释放资源
//   8. setDirty() 触发重建
//   9. ghostCount / starburstRays 字段可更新且被 clamp
//  10. LENS_FLARE_FRAG shader 源码校验

import { describe, it, expect } from 'vitest';
import { ScreenSpaceLensFlarePass } from './ScreenSpaceLensFlarePass';
import { PerspectiveCamera } from '../../Cameras/PerspectiveCamera';
import { LENS_FLARE_FRAG } from '../../Materials/shaders';

// ── MockGL2(复用 GodRaysPass.test.ts 模式,含 RGBA16F/HALF_FLOAT) ──

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly RGBA8 = 0x8058;
  static readonly RGBA16F = 0x881A;
  static readonly UNSIGNED_BYTE = 0x1401;
  static readonly HALF_FLOAT = 0x140B;
  static readonly FLOAT = 0x1406;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;
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
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA8 = MockGL2.RGBA8;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly UNSIGNED_BYTE = MockGL2.UNSIGNED_BYTE;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly FLOAT = MockGL2.FLOAT;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;

  canvas: { width: number; height: number } = { width: 800, height: 600 };

  createdTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  createdShaders: unknown[] = [];
  drawCalls = 0;

  private _c = 0;
  private _id(): unknown { this._c++; return { id: this._c } as unknown; }

  createTexture(): WebGLTexture { const t = this._id() as WebGLTexture; this.createdTextures.push(t); return t; }
  createFramebuffer(): WebGLFramebuffer { const f = this._id() as WebGLFramebuffer; this.createdFramebuffers.push(f); return f; }
  createBuffer(): WebGLBuffer { const b = this._id() as WebGLBuffer; this.createdBuffers.push(b); return b; }
  createVertexArray(): WebGLVertexArrayObject { const v = this._id() as WebGLVertexArrayObject; this.createdVAOs.push(v); return v; }
  createProgram(): WebGLProgram { const p = this._id() as WebGLProgram; this.createdPrograms.push(p); return p; }
  createShader(_t: number): WebGLShader { const s = this._id() as WebGLShader; this.createdShaders.push(s); return s; }

  deleteTexture(_t: WebGLTexture | null): void {}
  deleteFramebuffer(_f: WebGLFramebuffer | null): void {}
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
  getProgramParameter(_p: WebGLProgram, p: number): unknown {
    if (p === this.LINK_STATUS) return true;
    if (p === this.ACTIVE_UNIFORMS) return 0;
    if (p === this.ACTIVE_ATTRIBUTES) return 0;
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
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}

  bindFramebuffer(_t: number, _f: WebGLFramebuffer | null): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_m: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_u: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._a: unknown[]): void {}
  texParameteri(_t: number, _p: number, _v: number): void {}
  framebufferTexture2D(..._a: unknown[]): void {}
  bindVertexArray(_v: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _b: WebGLBuffer | null): void {}
  bufferData(_t: number, _d: BufferSource, _u: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }
}

function makeTexture(id: string): WebGLTexture { return { id } as unknown as WebGLTexture; }
function makeCamera(): PerspectiveCamera { return new PerspectiveCamera(60, 1.5, 0.1, 200); }

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('ScreenSpaceLensFlarePass construction', () => {
  it('defaults', () => {
    const p = new ScreenSpaceLensFlarePass();
    expect(p.name).toBe('lensflare');
    expect(p.lightPosition).toEqual([0, 50, 0]);
    expect(p.lightColor).toEqual([1.0, 0.95, 0.85]);
    expect(p.lightIntensity).toBe(1.0);
    expect(p.ghostCount).toBe(8);
    expect(p.ghostSpacing).toBe(0.2);
    expect(p.ghostRadius).toBe(0.08);
    expect(p.ghostIntensity).toBe(1.0);
    expect(p.haloRadius).toBe(0.4);
    expect(p.haloThickness).toBe(0.1);
    expect(p.haloIntensity).toBe(0.5);
    expect(p.starburstIntensity).toBe(0.3);
    expect(p.starburstRays).toBe(6);
    expect(p.maxDepth).toBe(0.99);
    expect(p.chromaticAberration).toBe(0.005);
    expect(p.globalFalloff).toBe(1.5);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new ScreenSpaceLensFlarePass({
      lightPosition: [100, 80, -50],
      lightColor: [1.0, 1.0, 0.9],
      lightIntensity: 2.5,
      ghostCount: 12,
      ghostSpacing: 0.15,
      ghostRadius: 0.1,
      ghostIntensity: 1.5,
      haloRadius: 0.5,
      haloThickness: 0.08,
      haloIntensity: 0.8,
      starburstIntensity: 0.6,
      starburstRays: 8,
      maxDepth: 0.95,
      chromaticAberration: 0.01,
      globalFalloff: 2.0,
      enabled: false,
    });
    expect(p.lightPosition).toEqual([100, 80, -50]);
    expect(p.lightColor).toEqual([1.0, 1.0, 0.9]);
    expect(p.lightIntensity).toBe(2.5);
    expect(p.ghostCount).toBe(12);
    expect(p.ghostSpacing).toBe(0.15);
    expect(p.ghostRadius).toBe(0.1);
    expect(p.ghostIntensity).toBe(1.5);
    expect(p.haloRadius).toBe(0.5);
    expect(p.haloThickness).toBe(0.08);
    expect(p.haloIntensity).toBe(0.8);
    expect(p.starburstIntensity).toBe(0.6);
    expect(p.starburstRays).toBe(8);
    expect(p.maxDepth).toBe(0.95);
    expect(p.chromaticAberration).toBe(0.01);
    expect(p.globalFalloff).toBe(2.0);
    expect(p.enabled).toBe(false);
  });

  it('lightPosition is updatable (follow sun)', () => {
    const p = new ScreenSpaceLensFlarePass();
    expect(p.lightPosition).toEqual([0, 50, 0]);
    p.lightPosition = [200, 100, 0];
    expect(p.lightPosition).toEqual([200, 100, 0]);
  });

  it('ghostCount is updatable', () => {
    const p = new ScreenSpaceLensFlarePass();
    expect(p.ghostCount).toBe(8);
    p.ghostCount = 16;
    expect(p.ghostCount).toBe(16);
  });

  it('starburstRays is updatable', () => {
    const p = new ScreenSpaceLensFlarePass();
    expect(p.starburstRays).toBe(6);
    p.starburstRays = 12;
    expect(p.starburstRays).toBe(12);
  });
});

// ── apply / 资源生命周期 ──────────────────────────────────────────

describe('ScreenSpaceLensFlarePass apply', () => {
  it('apply() does not throw and returns a texture', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('color'), makeTexture('depth'), makeCamera());
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('allocates 1 texture + 1 FBO + 1 VAO + 1 buffer on first apply', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBe(1);
    expect(gl.createdFramebuffers.length).toBe(1);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
    expect(gl.createdPrograms.length).toBe(1);
  });

  it('does not re-allocate on subsequent apply with same size', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBe(texAfterFirst);
  });

  it('disabled returns input texture with zero draw calls', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass({ enabled: false });
    const inputTex = makeTexture('input');
    const out = p.apply(gl as unknown as WebGL2RenderingContext, inputTex, makeTexture('d'), makeCamera());
    expect(out).toBe(inputTex);
    expect(gl.drawCalls).toBe(0);
    expect(gl.createdTextures.length).toBe(0); // no allocation when disabled
  });

  it('re-allocates on resize', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });

  it('returns stable output texture handle across apply calls', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    const t1 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const t2 = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(t1).toBe(t2);
  });

  it('does not throw across many frames with moving light', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    expect(() => {
      for (let i = 0; i < 10; i++) {
        p.lightPosition = [i * 10, 50, 0];
        p.apply(gl as unknown as WebGL2RenderingContext, makeTexture(`c${i}`), makeTexture('d'), makeCamera());
      }
    }).not.toThrow();
    expect(gl.drawCalls).toBe(10);
  });

  it('handles large ghostCount value (clamped to 16 in apply)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass({ ghostCount: 32 });
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera())).not.toThrow();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('handles large starburstRays value (clamped to 16 in apply)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass({ starburstRays: 32 });
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera())).not.toThrow();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('handles zero ghostCount (ghosts disabled)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass({ ghostCount: 0 });
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera())).not.toThrow();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('handles zero starburstRays (starburst disabled)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass({ starburstRays: 0 });
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera())).not.toThrow();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });
});

// ── dispose / setDirty ────────────────────────────────────────────

describe('ScreenSpaceLensFlarePass dispose / setDirty', () => {
  it('dispose() does not throw and allows re-apply', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c'), makeTexture('d'), makeCamera());
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
    // re-apply after dispose → re-initializes
    const out = p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('c2'), makeTexture('d'), makeCamera());
    expect(out).toBeDefined();
  });

  it('dispose() without gl does not throw', () => {
    const p = new ScreenSpaceLensFlarePass();
    expect(() => p.dispose()).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const p = new ScreenSpaceLensFlarePass();
    expect(() => { p.dispose(); p.dispose(); p.dispose(); }).not.toThrow();
  });

  it('setDirty() triggers re-initialization on next apply', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceLensFlarePass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('a'), makeTexture('d'), makeCamera());
    const texAfterFirst = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTexture('b'), makeTexture('d'), makeCamera());
    expect(gl.createdTextures.length).toBeGreaterThan(texAfterFirst);
  });
});

// ── shader 源码校验 ───────────────────────────────────────────────

describe('LENS_FLARE_FRAG shader source', () => {
  it('is GLSL ES 3.0', () => {
    expect(LENS_FLARE_FRAG).toContain('#version 300 es');
  });

  it('declares required uniforms', () => {
    expect(LENS_FLARE_FRAG).toContain('u_colorMap');
    expect(LENS_FLARE_FRAG).toContain('u_depthMap');
    expect(LENS_FLARE_FRAG).toContain('u_viewProjection');
    expect(LENS_FLARE_FRAG).toContain('u_lightPosition');
    expect(LENS_FLARE_FRAG).toContain('u_lightColor');
    expect(LENS_FLARE_FRAG).toContain('u_lightIntensity');
    expect(LENS_FLARE_FRAG).toContain('u_ghostCount');
    expect(LENS_FLARE_FRAG).toContain('u_ghostSpacing');
    expect(LENS_FLARE_FRAG).toContain('u_ghostRadius');
    expect(LENS_FLARE_FRAG).toContain('u_ghostIntensity');
    expect(LENS_FLARE_FRAG).toContain('u_haloRadius');
    expect(LENS_FLARE_FRAG).toContain('u_haloThickness');
    expect(LENS_FLARE_FRAG).toContain('u_haloIntensity');
    expect(LENS_FLARE_FRAG).toContain('u_starburstIntensity');
    expect(LENS_FLARE_FRAG).toContain('u_starburstRays');
    expect(LENS_FLARE_FRAG).toContain('u_maxDepth');
    expect(LENS_FLARE_FRAG).toContain('u_chromaticAberration');
    expect(LENS_FLARE_FRAG).toContain('u_globalFalloff');
    expect(LENS_FLARE_FRAG).toContain('u_enabled');
  });

  it('projects light world position to screen via viewProjection', () => {
    expect(LENS_FLARE_FRAG).toContain('u_viewProjection * vec4(u_lightPosition');
    expect(LENS_FLARE_FRAG).toContain('lightClip.w');
  });

  it('skips when light is behind camera (clip w <= 0)', () => {
    expect(LENS_FLARE_FRAG).toContain('lightClip.w <= 0.0');
  });

  it('computes screen-space light UV from NDC', () => {
    expect(LENS_FLARE_FRAG).toContain('lightNDC.xy * 0.5 + 0.5');
    expect(LENS_FLARE_FRAG).toContain('lightUV');
  });

  it('applies off-screen fade for light outside viewport', () => {
    expect(LENS_FLARE_FRAG).toContain('visibilityFade');
    expect(LENS_FLARE_FRAG).toContain('smoothstep');
  });

  it('applies depth-based occlusion (sky passes, geometry blocks)', () => {
    expect(LENS_FLARE_FRAG).toContain('occlusion');
    expect(LENS_FLARE_FRAG).toContain('step(u_maxDepth, pixelDepth)');
  });

  it('renders ghosts along light-to-center axis with bounded loop', () => {
    expect(LENS_FLARE_FRAG).toContain('MAX_GHOSTS = 16');
    expect(LENS_FLARE_FRAG).toContain('if (i >= u_ghostCount) break');
    expect(LENS_FLARE_FRAG).toContain('toCenter');
    expect(LENS_FLARE_FRAG).toContain('ghostUV');
  });

  it('applies RGB chromatic aberration per ghost', () => {
    expect(LENS_FLARE_FRAG).toContain('u_chromaticAberration');
    expect(LENS_FLARE_FRAG).toContain('ghostColor.r');
    expect(LENS_FLARE_FRAG).toContain('ghostColor.b');
  });

  it('renders halo ring around light using gaussian', () => {
    expect(LENS_FLARE_FRAG).toContain('haloRing');
    expect(LENS_FLARE_FRAG).toContain('u_haloRadius');
    expect(LENS_FLARE_FRAG).toContain('u_haloThickness');
    expect(LENS_FLARE_FRAG).toContain('exp(-pow(');
  });

  it('renders starburst with sin-modulated rays and bounded loop', () => {
    expect(LENS_FLARE_FRAG).toContain('MAX_RAYS = 16');
    expect(LENS_FLARE_FRAG).toContain('if (i >= u_starburstRays) break');
    expect(LENS_FLARE_FRAG).toContain('starburst');
    expect(LENS_FLARE_FRAG).toContain('abs(sin(a))');
  });

  it('uses additive compositing (sceneColor + finalFlare)', () => {
    expect(LENS_FLARE_FRAG).toContain('sceneColor + finalFlare');
  });

  it('applies global distance falloff', () => {
    expect(LENS_FLARE_FRAG).toContain('globalFalloff');
    expect(LENS_FLARE_FRAG).toContain('u_globalFalloff');
  });

  it('handles disabled state (u_enabled == 0)', () => {
    expect(LENS_FLARE_FRAG).toContain('u_enabled == 0');
  });

  it('references Jimenez 2014 and o3de', () => {
    expect(LENS_FLARE_FRAG).toContain('Jimenez');
    expect(LENS_FLARE_FRAG).toContain('o3de');
  });
});
