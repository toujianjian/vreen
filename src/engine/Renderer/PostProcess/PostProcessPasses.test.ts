// PostProcess Pass 单元测试。
//
// 验证:
//   1. 每个 Pass 的构造器默认值与选项覆盖
//   2. 每个 Pass 都继承 RenderPass(instanceof)
//   3. 每个 Pass 的 apply() 在 mock GL 上下文下不抛错(渲染流程不报错)
//   4. AfterimagePass 的 dispose() 正确释放内部资源
//   5. Pass 可加入 PostProcessingPipeline 并按 name 查找
//
// WebGL mock 策略:实现一个 MockGL2 类,提供 WebGL2 所需的常量(number)
// 和方法(no-op 或返回 sentinel)。这样 apply() 能跑完整路径而不抛错,
// 同时记录关键调用(如 createTexture/deleteTexture)用于断言生命周期。

import { describe, it, expect } from 'vitest';
import {
  RenderPass,
  PostProcessingPipeline,
  type PassContext,
} from '../RenderPass';
import {
  ColorGradingPass,
  LUTPass,
  ChromaticAberrationPass,
  VignettePass,
  FilmGrainPass,
  AfterimagePass,
  PixelationPass,
} from './index';
import { Vector2 } from '../../Math/Vector2';
import { Color } from '../../Math/Color';

// ── MockGL2 ─────────────────────────────────────────────────────────
// 提供 WebGL2 后处理 Pass 用到的全部常量与方法。方法为 no-op 或返回
// sentinel;createTexture / createFramebuffer 返回带 id 的对象,便于断言。

class MockGL2 {
  // 常量(从 WebGL2RenderingContext 抄的数值)
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly COLOR_BUFFER_BIT = 0x4000;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE_3D = 0x806F;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TRIANGLES = 0x0004;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly RGBA = 0x1908;
  static readonly HALF_FLOAT = 0x8D61;
  static readonly RGBA16F = 0x881A;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly CLAMP_TO_EDGE = 0x812F;

  // 实例常量(直接引用静态)
  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly COLOR_BUFFER_BIT = MockGL2.COLOR_BUFFER_BIT;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE_3D = MockGL2.TEXTURE_3D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly RGBA = MockGL2.RGBA;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;

  // 调用记录(供测试断言)
  createdTextures: unknown[] = [];
  deletedTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  deletedFramebuffers: unknown[] = [];
  drawCalls = 0;
  bindFramebufferCalls = 0;
  texImageCalls = 0;

  private _counter = 0;
  private _nextId(): string {
    this._counter++;
    return `mock-${this._counter}`;
  }

  // ── factory methods ──
  createTexture(): WebGLTexture {
    const t = { id: this._nextId(), kind: 'texture' } as unknown as WebGLTexture;
    this.createdTextures.push(t);
    return t;
  }
  createFramebuffer(): WebGLFramebuffer {
    const f = { id: this._nextId(), kind: 'fbo' } as unknown as WebGLFramebuffer;
    this.createdFramebuffers.push(f);
    return f;
  }
  deleteTexture(t: WebGLTexture | null): void {
    if (t) this.deletedTextures.push(t);
  }
  deleteFramebuffer(f: WebGLFramebuffer | null): void {
    if (f) this.deletedFramebuffers.push(f);
  }

  // ── no-op methods ──
  bindFramebuffer(_target: number, _fb: WebGLFramebuffer | null): void {
    this.bindFramebufferCalls++;
  }
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_mask: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  activeTexture(_unit: number): void {}
  bindTexture(_target: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._args: unknown[]): void { this.texImageCalls++; }
  texImage3D(..._args: unknown[]): void { this.texImageCalls++; }
  texParameteri(_target: number, _pname: number, _param: number): void {}
  framebufferTexture2D(..._args: unknown[]): void {}
  bindVertexArray(_vao: WebGLVertexArrayObject | null): void {}
  drawArrays(_mode: number, _first: number, _count: number): void { this.drawCalls++; }
  useProgram(_prog: WebGLProgram | null): void {}
}

// ── 测试辅助 ─────────────────────────────────────────────────────────

function makeTexture(id: string): WebGLTexture {
  return { id, kind: 'texture' } as unknown as WebGLTexture;
}

function makeCtx(gl: MockGL2, width = 800, height = 600): PassContext {
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    width,
    height,
    fullscreenQuad: {} as WebGLVertexArrayObject,
    resources: {
      mainFbo: {} as WebGLFramebuffer,
      mainTexture: makeTexture('main'),
      bloomFbo1: {} as WebGLFramebuffer,
      bloomTexture1: makeTexture('bloom1'),
      bloomFbo2: {} as WebGLFramebuffer,
      bloomTexture2: makeTexture('bloom2'),
      finalFbo: {} as WebGLFramebuffer,
      finalTexture: makeTexture('final'),
      width,
      height,
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

// ── ColorGradingPass ────────────────────────────────────────────────

describe('ColorGradingPass', () => {
  it('defaults to neutral (no adjustment)', () => {
    const p = new ColorGradingPass();
    expect(p.name).toBe('color-grading');
    expect(p.enabled).toBe(false);
    expect(p.temperature).toBe(0.0);
    expect(p.tint).toBe(0.0);
    expect(p.saturation).toBe(1.0);
    expect(p.contrast).toBe(1.0);
    expect(p.gain).toBe(1.0);
    expect(p.lift).toBe(0.0);
    expect(p.gamma).toBe(1.0);
    expect(p.hueShift).toBe(0.0);
  });

  it('accepts all options', () => {
    const p = new ColorGradingPass({
      temperature: 0.5,
      tint: -0.3,
      saturation: 1.5,
      contrast: 0.8,
      gain: 1.2,
      lift: 0.1,
      gamma: 2.2,
      hueShift: 90,
      enabled: true,
    });
    expect(p.temperature).toBe(0.5);
    expect(p.tint).toBe(-0.3);
    expect(p.saturation).toBe(1.5);
    expect(p.contrast).toBe(0.8);
    expect(p.gain).toBe(1.2);
    expect(p.lift).toBe(0.1);
    expect(p.gamma).toBe(2.2);
    expect(p.hueShift).toBe(90);
    expect(p.enabled).toBe(true);
  });

  it('extends RenderPass', () => {
    expect(new ColorGradingPass()).toBeInstanceOf(RenderPass);
  });

  it('apply() does not throw with mock GL', () => {
    const gl = new MockGL2();
    const p = new ColorGradingPass({ enabled: true });
    const out = p.apply(makeTexture('input'), makeCtx(gl));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });
});

// ── LUTPass ─────────────────────────────────────────────────────────

describe('LUTPass', () => {
  it('defaults to no LUT, 3D mode, size 16, intensity 1', () => {
    const p = new LUTPass();
    expect(p.name).toBe('lut');
    expect(p.enabled).toBe(false);
    expect(p.lut).toBeNull();
    expect(p.is3D).toBe(true);
    expect(p.lutSize).toBe(16);
    expect(p.intensity).toBe(1.0);
  });

  it('accepts options', () => {
    const lutTex = makeTexture('lut');
    const p = new LUTPass({
      lut: lutTex,
      lutSize: 32,
      is3D: false,
      intensity: 0.5,
      enabled: true,
    });
    expect(p.lut).toBe(lutTex);
    expect(p.lutSize).toBe(32);
    expect(p.is3D).toBe(false);
    expect(p.intensity).toBe(0.5);
    expect(p.enabled).toBe(true);
  });

  it('extends RenderPass', () => {
    expect(new LUTPass()).toBeInstanceOf(RenderPass);
  });

  it('apply() returns input unchanged when lut is null', () => {
    const gl = new MockGL2();
    const p = new LUTPass();
    const input = makeTexture('input');
    const out = p.apply(input, makeCtx(gl));
    expect(out).toBe(input);
    expect(gl.drawCalls).toBe(0);
  });

  it('apply() with 3D LUT does not throw', () => {
    const gl = new MockGL2();
    const lut = makeTexture('lut3d');
    const p = new LUTPass({ lut, is3D: true, lutSize: 16, enabled: true });
    const out = p.apply(makeTexture('input'), makeCtx(gl));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('apply() with 2D strip LUT does not throw', () => {
    const gl = new MockGL2();
    const lut = makeTexture('lut2d');
    const p = new LUTPass({ lut, is3D: false, lutSize: 32, enabled: true });
    const out = p.apply(makeTexture('input'), makeCtx(gl));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });
});

// ── ChromaticAberrationPass ─────────────────────────────────────────

describe('ChromaticAberrationPass (enhanced)', () => {
  it('defaults to small offset, radialMod on, center (0.5, 0.5)', () => {
    const p = new ChromaticAberrationPass();
    expect(p.name).toBe('chromatic-aberration');
    expect(p.enabled).toBe(false);
    expect(p.offset.x).toBe(0.001);
    expect(p.offset.y).toBe(0.001);
    expect(p.radialMod).toBe(true);
    expect(p.center.x).toBe(0.5);
    expect(p.center.y).toBe(0.5);
  });

  it('accepts options', () => {
    const p = new ChromaticAberrationPass({
      offset: new Vector2(0.005, 0.01),
      radialMod: false,
      center: new Vector2(0.3, 0.7),
      enabled: true,
    });
    expect(p.offset.x).toBe(0.005);
    expect(p.offset.y).toBe(0.01);
    expect(p.radialMod).toBe(false);
    expect(p.center.x).toBe(0.3);
    expect(p.center.y).toBe(0.7);
    expect(p.enabled).toBe(true);
  });

  it('extends RenderPass', () => {
    expect(new ChromaticAberrationPass()).toBeInstanceOf(RenderPass);
  });

  it('apply() does not throw with mock GL', () => {
    const gl = new MockGL2();
    const p = new ChromaticAberrationPass({ enabled: true });
    const out = p.apply(makeTexture('input'), makeCtx(gl));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('offset is a Vector2 instance', () => {
    expect(new ChromaticAberrationPass().offset).toBeInstanceOf(Vector2);
    expect(new ChromaticAberrationPass().center).toBeInstanceOf(Vector2);
  });
});

// ── VignettePass ────────────────────────────────────────────────────

describe('VignettePass (enhanced)', () => {
  it('defaults to darkness 0.45, offset 0, black color', () => {
    const p = new VignettePass();
    expect(p.name).toBe('vignette');
    expect(p.enabled).toBe(false);
    expect(p.darkness).toBe(0.45);
    expect(p.offset).toBe(0.0);
    expect(p.color.r).toBe(0);
    expect(p.color.g).toBe(0);
    expect(p.color.b).toBe(0);
  });

  it('accepts options', () => {
    const p = new VignettePass({
      offset: 0.3,
      darkness: 0.8,
      color: new Color(0.5, 0.2, 0.1),
      enabled: true,
    });
    expect(p.offset).toBe(0.3);
    expect(p.darkness).toBe(0.8);
    expect(p.color.r).toBe(0.5);
    expect(p.color.g).toBe(0.2);
    expect(p.color.b).toBe(0.1);
    expect(p.enabled).toBe(true);
  });

  it('extends RenderPass', () => {
    expect(new VignettePass()).toBeInstanceOf(RenderPass);
  });

  it('color is a Color instance', () => {
    expect(new VignettePass().color).toBeInstanceOf(Color);
  });

  it('apply() does not throw with mock GL', () => {
    const gl = new MockGL2();
    const p = new VignettePass({ enabled: true });
    const out = p.apply(makeTexture('input'), makeCtx(gl));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });
});

// ── FilmGrainPass ───────────────────────────────────────────────────

describe('FilmGrainPass', () => {
  it('defaults to intensity 0.25, size 1.5, animated true', () => {
    const p = new FilmGrainPass();
    expect(p.name).toBe('film-grain');
    expect(p.enabled).toBe(false);
    expect(p.intensity).toBe(0.25);
    expect(p.size).toBe(1.5);
    expect(p.animated).toBe(true);
    expect(p.time).toBe(0.0);
  });

  it('accepts options', () => {
    const p = new FilmGrainPass({
      intensity: 0.5,
      size: 3.0,
      animated: false,
      enabled: true,
    });
    expect(p.intensity).toBe(0.5);
    expect(p.size).toBe(3.0);
    expect(p.animated).toBe(false);
    expect(p.enabled).toBe(true);
  });

  it('extends RenderPass', () => {
    expect(new FilmGrainPass()).toBeInstanceOf(RenderPass);
  });

  it('apply() does not throw with mock GL', () => {
    const gl = new MockGL2();
    const p = new FilmGrainPass({ enabled: true });
    p.time = 1.5;
    const out = p.apply(makeTexture('input'), makeCtx(gl));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });
});

// ── AfterimagePass ──────────────────────────────────────────────────

describe('AfterimagePass', () => {
  it('defaults to damp 0.85', () => {
    const p = new AfterimagePass();
    expect(p.name).toBe('afterimage');
    expect(p.enabled).toBe(false);
    expect(p.damp).toBe(0.85);
  });

  it('accepts options', () => {
    const p = new AfterimagePass({ damp: 0.95, enabled: true });
    expect(p.damp).toBe(0.95);
    expect(p.enabled).toBe(true);
  });

  it('extends RenderPass', () => {
    expect(new AfterimagePass()).toBeInstanceOf(RenderPass);
  });

  it('apply() does not throw and allocates internal textures on first call', () => {
    const gl = new MockGL2();
    const p = new AfterimagePass({ enabled: true });
    const input = makeTexture('input');
    const out = p.apply(input, makeCtx(gl));
    expect(out).toBeDefined();
    // 首帧应创建 2 张内部纹理(old + comp)和 2 个 FBO
    expect(gl.createdTextures.length).toBe(2);
    expect(gl.createdFramebuffers.length).toBe(2);
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('apply() does not re-allocate on subsequent frames (same size)', () => {
    const gl = new MockGL2();
    const p = new AfterimagePass({ enabled: true });
    const ctx = makeCtx(gl);
    p.apply(makeTexture('input1'), ctx);
    const createdAfterFirst = gl.createdTextures.length;
    p.apply(makeTexture('input2'), ctx);
    expect(gl.createdTextures.length).toBe(createdAfterFirst);
  });

  it('apply() re-allocates on size change', () => {
    const gl = new MockGL2();
    const p = new AfterimagePass({ enabled: true });
    const ctx1 = makeCtx(gl);
    p.apply(makeTexture('input1'), ctx1);
    const createdAfterFirst = gl.createdTextures.length;
    // 改尺寸触发重建
    const ctx2 = makeCtx(gl, 1024, 768);
    p.apply(makeTexture('input2'), ctx2);
    expect(gl.createdTextures.length).toBeGreaterThan(createdAfterFirst);
  });

  it('dispose() frees internal textures and FBOs', () => {
    const gl = new MockGL2();
    const p = new AfterimagePass({ enabled: true });
    const ctx = makeCtx(gl);
    p.apply(makeTexture('input'), ctx);
    expect(gl.deletedTextures.length).toBe(0);
    expect(gl.deletedFramebuffers.length).toBe(0);
    p.dispose(ctx);
    expect(gl.deletedTextures.length).toBe(2);
    expect(gl.deletedFramebuffers.length).toBe(2);
  });

  it('dispose() is idempotent', () => {
    const gl = new MockGL2();
    const p = new AfterimagePass({ enabled: true });
    const ctx = makeCtx(gl);
    p.dispose(ctx);
    p.dispose(ctx); // 不应抛错
    expect(gl.deletedTextures.length).toBe(0);
  });
});

// ── PixelationPass ──────────────────────────────────────────────────

describe('PixelationPass', () => {
  it('defaults to pixelSize 8', () => {
    const p = new PixelationPass();
    expect(p.name).toBe('pixelation');
    expect(p.enabled).toBe(false);
    expect(p.pixelSize).toBe(8.0);
  });

  it('accepts options', () => {
    const p = new PixelationPass({ pixelSize: 16, enabled: true });
    expect(p.pixelSize).toBe(16);
    expect(p.enabled).toBe(true);
  });

  it('extends RenderPass', () => {
    expect(new PixelationPass()).toBeInstanceOf(RenderPass);
  });

  it('apply() does not throw with mock GL', () => {
    const gl = new MockGL2();
    const p = new PixelationPass({ enabled: true });
    const out = p.apply(makeTexture('input'), makeCtx(gl));
    expect(out).toBeDefined();
    expect(gl.drawCalls).toBeGreaterThan(0);
  });
});

// ── Pipeline 集成 ───────────────────────────────────────────────────

describe('PostProcess passes pipeline integration', () => {
  it('all passes have unique names', () => {
    const names = [
      new ColorGradingPass().name,
      new LUTPass().name,
      new ChromaticAberrationPass().name,
      new VignettePass().name,
      new FilmGrainPass().name,
      new AfterimagePass().name,
      new PixelationPass().name,
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it('all passes extend RenderPass', () => {
    expect(new ColorGradingPass()).toBeInstanceOf(RenderPass);
    expect(new LUTPass()).toBeInstanceOf(RenderPass);
    expect(new ChromaticAberrationPass()).toBeInstanceOf(RenderPass);
    expect(new VignettePass()).toBeInstanceOf(RenderPass);
    expect(new FilmGrainPass()).toBeInstanceOf(RenderPass);
    expect(new AfterimagePass()).toBeInstanceOf(RenderPass);
    expect(new PixelationPass()).toBeInstanceOf(RenderPass);
  });

  it('can be added to pipeline and found by name', () => {
    const p = new PostProcessingPipeline();
    p.add(new ColorGradingPass())
      .add(new LUTPass())
      .add(new ChromaticAberrationPass())
      .add(new VignettePass())
      .add(new FilmGrainPass())
      .add(new AfterimagePass())
      .add(new PixelationPass());
    expect(p.passes).toHaveLength(7);
    expect(p.getByName('color-grading')).toBeInstanceOf(ColorGradingPass);
    expect(p.getByName('lut')).toBeInstanceOf(LUTPass);
    expect(p.getByName('chromatic-aberration')).toBeInstanceOf(ChromaticAberrationPass);
    expect(p.getByName('vignette')).toBeInstanceOf(VignettePass);
    expect(p.getByName('film-grain')).toBeInstanceOf(FilmGrainPass);
    expect(p.getByName('afterimage')).toBeInstanceOf(AfterimagePass);
    expect(p.getByName('pixelation')).toBeInstanceOf(PixelationPass);
  });

  it('disabled passes are skipped by pipeline render', () => {
    const gl = new MockGL2();
    const pipeline = new PostProcessingPipeline();
    const cg = new ColorGradingPass({ enabled: false });
    const fg = new FilmGrainPass({ enabled: true });
    pipeline.add(cg).add(fg);
    const input = makeTexture('input');
    const out = pipeline.render(input, makeCtx(gl));
    expect(out).toBeDefined();
    // 只有 FilmGrain 启用,应至少有 1 次 drawCall
    expect(gl.drawCalls).toBeGreaterThan(0);
  });

  it('AfterimagePass in pipeline disposes cleanly', () => {
    const gl = new MockGL2();
    const pipeline = new PostProcessingPipeline();
    const ai = new AfterimagePass({ enabled: true });
    pipeline.add(ai);
    const ctx = makeCtx(gl);
    pipeline.render(makeTexture('input'), ctx);
    pipeline.dispose(ctx);
    expect(gl.deletedTextures.length).toBe(2);
    expect(gl.deletedFramebuffers.length).toBe(2);
  });
});
