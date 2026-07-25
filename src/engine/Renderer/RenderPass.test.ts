// PostProcessingPipeline 编排逻辑测试。
//
// 不依赖真实 WebGL 上下文(node 环境无 WebGL2RenderingContext),只验证:
//   - pass 列表的增删查
//   - enabled 过滤
//   - 顺序执行(input 链式传递)
//   - dispose 一次性释放
//
// 注意:增强版 ChromaticAberrationPass / VignettePass 已移至 ./PostProcess/,
// 此处不再测试基础版(已删除)。增强版的测试在 PostProcess/PostProcessPasses.test.ts。

import { describe, it, expect } from 'vitest';
import {
  RenderPass,
  PostProcessingPipeline,
  BloomPass,
  FinalComposePass,
  SSAOPass,
  FXAAPass,
  ToneMappingPass,
  GammaCorrectPass,
  DOFPass,
  ToneMappingMode,
  type PassContext,
} from './RenderPass';

/** 测试用 stub pass:记录调用顺序 + 返回固定纹理标识。 */
class StubPass extends RenderPass {
  readonly name: string;
  callLog: string[];
  outTexture: WebGLTexture;
  constructor(name: string, callLog: string[], outTexture: WebGLTexture, enabled = true) {
    super();
    this.name = name;
    this.callLog = callLog;
    this.outTexture = outTexture;
    this.enabled = enabled;
  }
  apply(input: WebGLTexture, _ctx: PassContext): WebGLTexture {
    this.callLog.push(`${this.name}(${(input as unknown as string)})`);
    return this.outTexture;
  }
}

function makeTexture(id: string): WebGLTexture {
  return id as unknown as WebGLTexture;
}

function makeCtx(): PassContext {
  return {
    gl: {} as WebGL2RenderingContext,
    width: 800,
    height: 600,
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
      width: 800,
      height: 600,
    },
    getProgram: () => ({} as never),
  };
}

describe('PostProcessingPipeline', () => {
  it('add appends passes and returns this for chaining', () => {
    const p = new PostProcessingPipeline();
    const r = p.add(new BloomPass()).add(new FinalComposePass());
    expect(r).toBe(p);
    expect(p.passes).toHaveLength(2);
  });

  it('remove removes a pass and returns true', () => {
    const p = new PostProcessingPipeline();
    const bp = new BloomPass();
    p.add(bp);
    expect(p.remove(bp)).toBe(true);
    expect(p.passes).toHaveLength(0);
    expect(p.remove(bp)).toBe(false);
  });

  it('getByName finds a pass', () => {
    const p = new PostProcessingPipeline();
    const bp = new BloomPass();
    p.add(bp);
    expect(p.getByName('bloom')).toBe(bp);
    expect(p.getByName('vignette')).toBeUndefined();
  });

  it('render calls enabled passes in order with chained input', () => {
    const log: string[] = [];
    const p = new PostProcessingPipeline();
    p.add(new StubPass('A', log, makeTexture('A')));
    p.add(new StubPass('B', log, makeTexture('B')));
    p.add(new StubPass('C', log, makeTexture('C')));

    const out = p.render(makeTexture('input'), makeCtx());
    expect(out).toBe(makeTexture('C'));
    expect(log).toEqual(['A(input)', 'B(A)', 'C(B)']);
  });

  it('render skips disabled passes', () => {
    const log: string[] = [];
    const p = new PostProcessingPipeline();
    p.add(new StubPass('A', log, makeTexture('A')));
    p.add(new StubPass('B', log, makeTexture('B'), false));
    p.add(new StubPass('C', log, makeTexture('C')));

    const out = p.render(makeTexture('input'), makeCtx());
    expect(out).toBe(makeTexture('C'));
    expect(log).toEqual(['A(input)', 'C(A)']);
  });

  it('render with no passes returns input unchanged', () => {
    const p = new PostProcessingPipeline();
    const input = makeTexture('input');
    const out = p.render(input, makeCtx());
    expect(out).toBe(input);
  });

  it('dispose clears passes and marks disposed', () => {
    const p = new PostProcessingPipeline();
    p.add(new BloomPass());
    p.add(new FinalComposePass());
    p.dispose(makeCtx());
    expect(p.disposed).toBe(true);
    expect(p.passes).toHaveLength(0);
  });

  it('dispose is idempotent', () => {
    const p = new PostProcessingPipeline();
    p.add(new BloomPass());
    const ctx = makeCtx();
    p.dispose(ctx);
    p.dispose(ctx); // second call should not throw
    expect(p.disposed).toBe(true);
  });
});

describe('Concrete pass classes', () => {
  it('BloomPass accepts config and defaults', () => {
    const bp = new BloomPass();
    expect(bp.enabled).toBe(false);
    expect(bp.name).toBe('bloom');
    expect(bp.threshold).toBe(0.85);

    const bp2 = new BloomPass({ threshold: 0.5, blurStrength: 3.0, enabled: true });
    expect(bp2.threshold).toBe(0.5);
    expect(bp2.blurStrength).toBe(3.0);
    expect(bp2.enabled).toBe(true);
  });

  it('FinalComposePass defaults to enabled', () => {
    const fp = new FinalComposePass();
    expect(fp.name).toBe('final-compose');
    expect(fp.enabled).toBe(true);
    expect(fp.bloomEnabled).toBe(false);
  });

  it('all passes extend RenderPass', () => {
    expect(new BloomPass()).toBeInstanceOf(RenderPass);
    expect(new FinalComposePass()).toBeInstanceOf(RenderPass);
  });
});

describe('Extended post-processing passes', () => {
  it('SSAOPass accepts config and defaults', () => {
    const p = new SSAOPass();
    expect(p.name).toBe('ssao');
    expect(p.enabled).toBe(false);
    expect(p.radius).toBe(1.5);
    expect(p.intensity).toBe(0.6);

    const p2 = new SSAOPass({ radius: 2.5, intensity: 0.9, enabled: true });
    expect(p2.radius).toBe(2.5);
    expect(p2.intensity).toBe(0.9);
    expect(p2.enabled).toBe(true);
  });

  it('FXAAPass has no parameters and defaults to disabled', () => {
    const p = new FXAAPass();
    expect(p.name).toBe('fxaa');
    expect(p.enabled).toBe(false);

    const p2 = new FXAAPass({ enabled: true });
    expect(p2.enabled).toBe(true);
  });

  it('ToneMappingPass defaults to ACES mode with exposure 1.0 and enabled', () => {
    const p = new ToneMappingPass();
    expect(p.name).toBe('tone-mapping');
    expect(p.enabled).toBe(true);
    expect(p.exposure).toBe(1.0);
    expect(p.mode).toBe(ToneMappingMode.ACES);

    const p2 = new ToneMappingPass({
      exposure: 1.5,
      mode: ToneMappingMode.Reinhard,
      enabled: false,
    });
    expect(p2.exposure).toBe(1.5);
    expect(p2.mode).toBe(ToneMappingMode.Reinhard);
    expect(p2.enabled).toBe(false);
  });

  it('ToneMappingMode enum has expected values', () => {
    expect(ToneMappingMode.Linear).toBe(0);
    expect(ToneMappingMode.Reinhard).toBe(1);
    expect(ToneMappingMode.ACES).toBe(2);
  });

  it('GammaCorrectPass defaults to gamma 2.2 and enabled', () => {
    const p = new GammaCorrectPass();
    expect(p.name).toBe('gamma-correct');
    expect(p.enabled).toBe(true);
    expect(p.gamma).toBe(2.2);

    const p2 = new GammaCorrectPass({ gamma: 1.0, enabled: false });
    expect(p2.gamma).toBe(1.0);
    expect(p2.enabled).toBe(false);
  });

  it('DOFPass accepts config and defaults', () => {
    const p = new DOFPass();
    expect(p.name).toBe('dof');
    expect(p.enabled).toBe(false);
    expect(p.focusDistance).toBe(0.5);
    expect(p.focusRange).toBe(0.2);
    expect(p.bokeh).toBe(4.0);

    const p2 = new DOFPass({
      focusDistance: 0.8,
      focusRange: 0.1,
      bokeh: 8.0,
      enabled: true,
    });
    expect(p2.focusDistance).toBe(0.8);
    expect(p2.focusRange).toBe(0.1);
    expect(p2.bokeh).toBe(8.0);
    expect(p2.enabled).toBe(true);
  });

  it('all extended passes extend RenderPass', () => {
    expect(new SSAOPass()).toBeInstanceOf(RenderPass);
    expect(new FXAAPass()).toBeInstanceOf(RenderPass);
    expect(new ToneMappingPass()).toBeInstanceOf(RenderPass);
    expect(new GammaCorrectPass()).toBeInstanceOf(RenderPass);
    expect(new DOFPass()).toBeInstanceOf(RenderPass);
  });

  it('passes have unique names', () => {
    const names = [
      new BloomPass().name,
      new FinalComposePass().name,
      new SSAOPass().name,
      new FXAAPass().name,
      new ToneMappingPass().name,
      new GammaCorrectPass().name,
      new DOFPass().name,
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it('extended passes can be added to pipeline and found by name', () => {
    const p = new PostProcessingPipeline();
    p.add(new SSAOPass()).add(new FXAAPass()).add(new ToneMappingPass());
    p.add(new GammaCorrectPass()).add(new DOFPass());
    expect(p.passes).toHaveLength(5);
    expect(p.getByName('ssao')).toBeInstanceOf(SSAOPass);
    expect(p.getByName('fxaa')).toBeInstanceOf(FXAAPass);
    expect(p.getByName('tone-mapping')).toBeInstanceOf(ToneMappingPass);
    expect(p.getByName('gamma-correct')).toBeInstanceOf(GammaCorrectPass);
    expect(p.getByName('dof')).toBeInstanceOf(DOFPass);
  });

  it('extended passes can be disabled and enabled', () => {
    const ssao = new SSAOPass();
    expect(ssao.enabled).toBe(false);
    ssao.enabled = true;
    expect(ssao.enabled).toBe(true);

    const fxaa = new FXAAPass({ enabled: true });
    expect(fxaa.enabled).toBe(true);
    fxaa.enabled = false;
    expect(fxaa.enabled).toBe(false);
  });
});
