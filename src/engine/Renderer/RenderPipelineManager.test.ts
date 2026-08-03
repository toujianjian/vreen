// RenderPipelineManager.test.ts — 渲染管线管理器测试。
//
// 覆盖:
//   1. 构造与默认值
//   2. 管线切换(setPipeline / getPipeline)
//   3. 质量等级(setQuality / getQuality / applyQualitySettings / getQualitySettings)
//   4. Pass 管理(addPass / removePass / getPass / getPasses / getPassOrder /
//      reorderPass / enablePass / disablePass)
//   5. 渲染(render / renderForward / renderDeferred / renderForwardPlus)
//   6. enabled / autoSwitch / setRenderTarget
//   7. RenderGraph 集成(buildRenderGraph / compileRenderGraph)
//   8. autoSelectPipeline(基于场景统计)
//   9. getStats / getPipelineInfo
//  10. dispose

import { describe, it, expect } from 'vitest';
import {
  RenderPipelineManager,
  QUALITY_PRESETS,
  type PipelinePass,
  type QualityLevel,
} from './RenderPipelineManager';

/** 构造一个记录执行的 pass。 */
function makeRecordingPass(
  name: string,
  log: string[],
  enabled = true,
  inputs: string[] = [],
  outputs: string[] = [],
): PipelinePass {
  return {
    name,
    enabled,
    inputs,
    outputs,
    execute: (ctx) => {
      log.push(name);
      ctx.stats.drawCalls += 1;
    },
  };
}

/** 构造一个含 children / isLight / isMesh 的伪场景。 */
function makeScene(lightCount: number, meshCount: number): unknown {
  const root: { children: unknown[]; isScene: boolean } = {
    children: [],
    isScene: true,
  };
  for (let i = 0; i < lightCount; i++) {
    root.children.push({ isLight: true, children: [] });
  }
  for (let i = 0; i < meshCount; i++) {
    root.children.push({ isMesh: true, children: [] });
  }
  return root;
}

// ── 构造与默认值 ──────────────────────────────────────────────────

describe('RenderPipelineManager — 构造与默认值', () => {
  it('默认构造', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.currentPipeline).toBe('forward');
    expect(mgr.qualityLevel).toBe('high');
    expect(mgr.enabled).toBe(true);
    expect(mgr.autoSwitch).toBe(false);
    expect(mgr.renderTarget).toBeNull();
    expect(mgr.renderGraph).toBeNull();
    // 默认 forward pass 框架
    expect(mgr.passes.size).toBe(3);
    expect(mgr.getPassOrder()).toEqual(['opaque', 'transparent', 'postprocess']);
  });

  it('选项覆盖', () => {
    const mgr = new RenderPipelineManager({
      pipeline: 'deferred',
      quality: 'low',
      enabled: false,
      autoSwitch: true,
    });
    expect(mgr.currentPipeline).toBe('deferred');
    expect(mgr.qualityLevel).toBe('low');
    expect(mgr.enabled).toBe(false);
    expect(mgr.autoSwitch).toBe(true);
    // 默认 deferred pass 框架
    expect(mgr.getPassOrder()).toEqual(['gbuffer', 'lighting', 'transparent', 'postprocess']);
  });

  it('初始化时应用质量预设', () => {
    const mgr = new RenderPipelineManager({ quality: 'low' });
    expect(mgr.qualitySettings.ssaoSamples).toBe(QUALITY_PRESETS.low.ssaoSamples);
    expect(mgr.qualitySettings.shadowMapSize).toBe(QUALITY_PRESETS.low.shadowMapSize);
  });
});

// ── 管线切换 ──────────────────────────────────────────────────────

describe('RenderPipelineManager — 管线切换', () => {
  it('setPipeline 切换并重置默认 pass', () => {
    const mgr = new RenderPipelineManager();
    mgr.setPipeline('deferred');
    expect(mgr.currentPipeline).toBe('deferred');
    expect(mgr.getPassOrder()).toEqual(['gbuffer', 'lighting', 'transparent', 'postprocess']);
  });

  it('setPipeline forwardplus', () => {
    const mgr = new RenderPipelineManager();
    mgr.setPipeline('forwardplus');
    expect(mgr.getPassOrder()).toEqual([
      'depthprepass',
      'tilecull',
      'geometry',
      'transparent',
      'postprocess',
    ]);
  });

  it('setPipeline 相同类型不重置', () => {
    const mgr = new RenderPipelineManager();
    mgr.addPass('custom', makeRecordingPass('custom', []));
    expect(mgr.passes.size).toBe(4);
    mgr.setPipeline('forward'); // 相同
    expect(mgr.passes.size).toBe(4); // 未重置
  });

  it('setPipeline 失效 renderGraph', () => {
    const mgr = new RenderPipelineManager();
    mgr.buildRenderGraph();
    expect(mgr.renderGraph).not.toBeNull();
    mgr.setPipeline('deferred');
    expect(mgr.renderGraph).toBeNull();
    expect(mgr.isGraphCompiled()).toBe(false);
  });

  it('getPipeline 返回当前', () => {
    const mgr = new RenderPipelineManager({ pipeline: 'deferred' });
    expect(mgr.getPipeline()).toBe('deferred');
  });
});

// ── 质量等级 ──────────────────────────────────────────────────────

describe('RenderPipelineManager — 质量等级', () => {
  it('setQuality 切换预设', () => {
    const mgr = new RenderPipelineManager({ quality: 'high' });
    mgr.setQuality('low');
    expect(mgr.qualityLevel).toBe('low');
    expect(mgr.qualitySettings.ssaoSamples).toBe(QUALITY_PRESETS.low.ssaoSamples);
    expect(mgr.qualitySettings.ssrEnabled).toBe(false);
  });

  it('setQuality 相同等级不重新应用', () => {
    const mgr = new RenderPipelineManager({ quality: 'high' });
    const orig = mgr.qualitySettings.ssaoSamples;
    mgr.setQuality('high'); // 相同
    expect(mgr.qualitySettings.ssaoSamples).toBe(orig);
  });

  it('setQuality 通知 pass.setQuality', () => {
    const mgr = new RenderPipelineManager({ quality: 'high' });
    const seen: QualityLevel[] = [];
    mgr.addPass('qpass', {
      name: 'qpass',
      enabled: true,
      execute: () => {},
      setQuality: (lvl) => seen.push(lvl),
    });
    mgr.setQuality('ultra');
    expect(seen).toEqual(['ultra']);
  });

  it('applyQualitySettings 应用预设', () => {
    const mgr = new RenderPipelineManager({ quality: 'low' });
    mgr.applyQualitySettings('ultra');
    expect(mgr.qualitySettings.ssaoSamples).toBe(QUALITY_PRESETS.ultra.ssaoSamples);
    expect(mgr.qualitySettings.bloomResolutionScale).toBe(QUALITY_PRESETS.ultra.bloomResolutionScale);
  });

  it('getQualitySettings 返回副本', () => {
    const mgr = new RenderPipelineManager();
    const s1 = mgr.getQualitySettings();
    const s2 = mgr.getQualitySettings();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2);
  });

  it('getQuality 返回当前', () => {
    const mgr = new RenderPipelineManager({ quality: 'medium' });
    expect(mgr.getQuality()).toBe('medium');
  });

  it('QUALITY_PRESETS 四级递增 ssaoSamples', () => {
    expect(QUALITY_PRESETS.low.ssaoSamples).toBeLessThan(QUALITY_PRESETS.medium.ssaoSamples);
    expect(QUALITY_PRESETS.medium.ssaoSamples).toBeLessThan(QUALITY_PRESETS.high.ssaoSamples);
    expect(QUALITY_PRESETS.high.ssaoSamples).toBeLessThan(QUALITY_PRESETS.ultra.ssaoSamples);
  });

  it('QUALITY_PRESETS 包含新增 Pass 开关 (ssgi/ssShadow/tonemapping/csm)', () => {
    for (const lvl of ['low', 'medium', 'high', 'ultra'] as const) {
      const s = QUALITY_PRESETS[lvl];
      expect(s).toHaveProperty('ssgiEnabled');
      expect(s).toHaveProperty('ssShadowEnabled');
      expect(s).toHaveProperty('tonemappingEnabled');
      expect(s).toHaveProperty('csmEnabled');
      expect(typeof s.ssgiEnabled).toBe('boolean');
      expect(typeof s.ssShadowEnabled).toBe('boolean');
      expect(typeof s.tonemappingEnabled).toBe('boolean');
      expect(typeof s.csmEnabled).toBe('boolean');
    }
  });

  it('tonemapping 默认全开 (HDR 管线必需)', () => {
    expect(QUALITY_PRESETS.low.tonemappingEnabled).toBe(true);
    expect(QUALITY_PRESETS.medium.tonemappingEnabled).toBe(true);
    expect(QUALITY_PRESETS.high.tonemappingEnabled).toBe(true);
    expect(QUALITY_PRESETS.ultra.tonemappingEnabled).toBe(true);
  });

  it('CSM medium+ 开启 (大场景需要)', () => {
    expect(QUALITY_PRESETS.low.csmEnabled).toBe(false);
    expect(QUALITY_PRESETS.medium.csmEnabled).toBe(true);
    expect(QUALITY_PRESETS.high.csmEnabled).toBe(true);
    expect(QUALITY_PRESETS.ultra.csmEnabled).toBe(true);
  });

  it('SSGI high+ 开启 (开销大,低配关闭)', () => {
    expect(QUALITY_PRESETS.low.ssgiEnabled).toBe(false);
    expect(QUALITY_PRESETS.medium.ssgiEnabled).toBe(false);
    expect(QUALITY_PRESETS.high.ssgiEnabled).toBe(true);
    expect(QUALITY_PRESETS.ultra.ssgiEnabled).toBe(true);
  });
});

// ── Pass 管理 ─────────────────────────────────────────────────────

describe('RenderPipelineManager — Pass 管理', () => {
  it('addPass 追加到末尾', () => {
    const mgr = new RenderPipelineManager();
    const log: string[] = [];
    mgr.addPass('custom', makeRecordingPass('custom', log));
    expect(mgr.passes.size).toBe(4);
    expect(mgr.getPassOrder()[3]).toBe('custom');
    expect(mgr.getPass('custom')).toBeDefined();
  });

  it('addPass 重复 name 抛错', () => {
    const mgr = new RenderPipelineManager();
    expect(() => mgr.addPass('opaque', makeRecordingPass('opaque', []))).toThrow(/already exists/);
  });

  it('removePass 移除并更新顺序', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.removePass('transparent')).toBe(true);
    expect(mgr.passes.size).toBe(2);
    expect(mgr.getPassOrder()).not.toContain('transparent');
    expect(mgr.removePass('nonexistent')).toBe(false);
  });

  it('getPasses 按 passOrder 顺序', () => {
    const mgr = new RenderPipelineManager();
    const passes = mgr.getPasses();
    expect(passes.map((p) => p.name)).toEqual(['opaque', 'transparent', 'postprocess']);
  });

  it('reorderPass 移动到新位置', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.reorderPass('postprocess', 0)).toBe(true);
    expect(mgr.getPassOrder()).toEqual(['postprocess', 'opaque', 'transparent']);
    // 越界返回 false
    expect(mgr.reorderPass('opaque', 99)).toBe(false);
    expect(mgr.reorderPass('opaque', -1)).toBe(false);
    // 不存在的 pass
    expect(mgr.reorderPass('nope', 0)).toBe(false);
    // 相同位置 OK
    expect(mgr.reorderPass('opaque', 1)).toBe(true);
  });

  it('enablePass / disablePass', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.disablePass('opaque')).toBe(true);
    expect(mgr.getPass('opaque')?.enabled).toBe(false);
    expect(mgr.enablePass('opaque')).toBe(true);
    expect(mgr.getPass('opaque')?.enabled).toBe(true);
    // 不存在的 pass
    expect(mgr.enablePass('nope')).toBe(false);
    expect(mgr.disablePass('nope')).toBe(false);
  });

  it('addPass / removePass 失效 renderGraph', () => {
    const mgr = new RenderPipelineManager();
    mgr.buildRenderGraph();
    expect(mgr.renderGraph).not.toBeNull();
    mgr.addPass('x', makeRecordingPass('x', []));
    expect(mgr.renderGraph).toBeNull();
    mgr.buildRenderGraph();
    mgr.removePass('x');
    expect(mgr.renderGraph).toBeNull();
  });
});

// ── 渲染 ─────────────────────────────────────────────────────────

describe('RenderPipelineManager — 渲染', () => {
  it('render 执行所有启用 pass', () => {
    const mgr = new RenderPipelineManager();
    const log: string[] = [];
    // 替换默认 pass 为记录版
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('opaque', makeRecordingPass('opaque', log));
    mgr.addPass('transparent', makeRecordingPass('transparent', log));
    mgr.addPass('postprocess', makeRecordingPass('postprocess', log));
    const stats = mgr.render({}, {});
    expect(log).toEqual(['opaque', 'transparent', 'postprocess']);
    expect(stats.drawCalls).toBe(3);
    expect(stats.activePasses).toBe(3);
    expect(stats.executedPasses).toEqual(['opaque', 'transparent', 'postprocess']);
  });

  it('render 跳过禁用的 pass', () => {
    const mgr = new RenderPipelineManager();
    const log: string[] = [];
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', makeRecordingPass('a', log));
    mgr.addPass('b', makeRecordingPass('b', log, false)); // 禁用
    mgr.addPass('c', makeRecordingPass('c', log));
    mgr.render({}, {});
    expect(log).toEqual(['a', 'c']);
  });

  it('render enabled=false 直接返回', () => {
    const mgr = new RenderPipelineManager({ enabled: false });
    const log: string[] = [];
    mgr.removePass('opaque');
    mgr.addPass('a', makeRecordingPass('a', log));
    const stats = mgr.render({}, {});
    expect(log).toEqual([]);
    expect(stats.activePasses).toBe(0);
    expect(stats.drawCalls).toBe(0);
  });

  it('render 重置帧统计', () => {
    const mgr = new RenderPipelineManager();
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', makeRecordingPass('a', []));
    mgr.render({}, {}); // drawCalls=1
    expect(mgr.getStats().drawCalls).toBe(1);
    mgr.render({}, {}); // 应重置
    expect(mgr.getStats().drawCalls).toBe(1);
  });

  it('render 不中断:某 pass 抛错后续仍执行', () => {
    const mgr = new RenderPipelineManager();
    const log: string[] = [];
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', makeRecordingPass('a', log));
    mgr.addPass('b', {
      name: 'b',
      enabled: true,
      execute: () => {
        throw new Error('boom');
      },
    });
    mgr.addPass('c', makeRecordingPass('c', log));
    mgr.render({}, {});
    expect(log).toEqual(['a', 'c']); // b 抛错但 c 仍执行
  });

  it('renderForward / renderDeferred / renderForwardPlus 都执行 pass', () => {
    const mgr = new RenderPipelineManager();
    const log: string[] = [];
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', makeRecordingPass('a', log));
    mgr.renderForward({}, {});
    expect(log).toEqual(['a']);
    log.length = 0;
    mgr.renderDeferred({}, {});
    expect(log).toEqual(['a']);
    log.length = 0;
    mgr.renderForwardPlus({}, {});
    expect(log).toEqual(['a']);
  });

  it('render 返回 PipelineStats 含 pipeline / quality', () => {
    const mgr = new RenderPipelineManager({ pipeline: 'deferred', quality: 'medium' });
    const stats = mgr.render({}, {});
    expect(stats.pipeline).toBe('deferred');
    expect(stats.quality).toBe('medium');
  });

  it('render autoSwitch 启用时自动切换管线', () => {
    const mgr = new RenderPipelineManager({ autoSwitch: true });
    // 大量 mesh → forwardplus
    const scene = makeScene(2, 1500);
    mgr.render(scene, {});
    expect(mgr.currentPipeline).toBe('forwardplus');
    expect(mgr.getPassOrder()).toContain('depthprepass');
  });
});

// ── 启用 / 禁用 / 渲染目标 ───────────────────────────────────────

describe('RenderPipelineManager — enabled / autoSwitch / renderTarget', () => {
  it('setEnabled', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.setEnabled(false)).toBe(mgr);
    expect(mgr.enabled).toBe(false);
    mgr.setEnabled(true);
    expect(mgr.enabled).toBe(true);
  });

  it('setAutoSwitch', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.setAutoSwitch(true)).toBe(mgr);
    expect(mgr.autoSwitch).toBe(true);
  });

  it('setRenderTarget 透传给 pass', () => {
    const mgr = new RenderPipelineManager();
    const target = { id: 'fbo' };
    let seen: unknown = null;
    mgr.removePass('opaque');
    mgr.addPass('a', {
      name: 'a',
      enabled: true,
      execute: (ctx) => {
        seen = ctx.renderTarget;
      },
    });
    mgr.setRenderTarget(target);
    mgr.render({}, {});
    expect(seen).toBe(target);
  });
});

// ── RenderGraph 集成 ─────────────────────────────────────────────

describe('RenderPipelineManager — RenderGraph 集成', () => {
  it('buildRenderGraph 把每个 pass 转成节点', () => {
    const mgr = new RenderPipelineManager();
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', makeRecordingPass('a', [], true, [], ['color']));
    mgr.addPass('b', makeRecordingPass('b', [], true, ['color'], ['final']));
    mgr.addPass('c', makeRecordingPass('c', [], true, ['final'], []));
    const rg = mgr.buildRenderGraph();
    expect(rg).toBe(mgr.renderGraph);
    expect(rg.getNodes().length).toBe(3);
    // 自动注册资源
    const resources = rg.getResources().map((r) => r.name);
    expect(resources).toContain('color');
    expect(resources).toContain('final');
    // 自动连边:a→b(color), b→c(final)
    const edges = rg.getEdges();
    expect(edges.some((e) => e.from === 'a' && e.to === 'b' && e.resource === 'color')).toBe(true);
    expect(edges.some((e) => e.from === 'b' && e.to === 'c' && e.resource === 'final')).toBe(true);
  });

  it('compileRenderGraph 编译成功', () => {
    const mgr = new RenderPipelineManager();
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', makeRecordingPass('a', [], true, [], ['color']));
    mgr.addPass('b', makeRecordingPass('b', [], true, ['color'], []));
    mgr.compileRenderGraph();
    expect(mgr.isGraphCompiled()).toBe(true);
    expect(mgr.renderGraph!.isCompiled).toBe(true);
    expect(mgr.renderGraph!.getCompiledPasses().length).toBe(2);
  });

  it('compileRenderGraph 未构建时自动构建', () => {
    const mgr = new RenderPipelineManager();
    mgr.compileRenderGraph();
    expect(mgr.renderGraph).not.toBeNull();
    expect(mgr.isGraphCompiled()).toBe(true);
  });

  it('buildRenderGraph 后 isGraphCompiled 为 false', () => {
    const mgr = new RenderPipelineManager();
    mgr.buildRenderGraph();
    expect(mgr.isGraphCompiled()).toBe(false);
  });

  it('buildRenderGraph 跳过无 inputs/outputs 的 pass 也能注册节点', () => {
    const mgr = new RenderPipelineManager();
    const rg = mgr.buildRenderGraph(); // 默认 forward pass 无 io
    expect(rg.getNodes().length).toBe(3);
    expect(rg.getEdges().length).toBe(0);
  });
});

// ── 自动选择 ─────────────────────────────────────────────────────

describe('RenderPipelineManager — autoSelectPipeline', () => {
  it('空场景 → forward', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.autoSelectPipeline({})).toBe('forward');
  });

  it('少量光源/物体 → forward', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.autoSelectPipeline(makeScene(3, 50))).toBe('forward');
  });

  it('中量光源/物体 → deferred', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.autoSelectPipeline(makeScene(12, 100))).toBe('deferred');
    expect(mgr.autoSelectPipeline(makeScene(3, 300))).toBe('deferred');
  });

  it('大量光源/物体 → forwardplus', () => {
    const mgr = new RenderPipelineManager();
    expect(mgr.autoSelectPipeline(makeScene(40, 100))).toBe('forwardplus');
    expect(mgr.autoSelectPipeline(makeScene(5, 1500))).toBe('forwardplus');
  });

  it('autoSwitch=false 时不自动切换', () => {
    const mgr = new RenderPipelineManager({ autoSwitch: false });
    mgr.render(makeScene(40, 100), {});
    expect(mgr.currentPipeline).toBe('forward'); // 未切换
  });

  it('autoSwitch=true 时 render 触发切换', () => {
    const mgr = new RenderPipelineManager({ autoSwitch: true });
    mgr.render(makeScene(40, 100), {});
    expect(mgr.currentPipeline).toBe('forwardplus');
  });

  it('autoSwitch=true 但场景适合 forward 不切换', () => {
    const mgr = new RenderPipelineManager({ autoSwitch: true });
    mgr.render(makeScene(2, 10), {});
    expect(mgr.currentPipeline).toBe('forward');
  });
});

// ── 统计 / 信息 ──────────────────────────────────────────────────

describe('RenderPipelineManager — getStats / getPipelineInfo', () => {
  it('getStats 返回快照', () => {
    const mgr = new RenderPipelineManager();
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', makeRecordingPass('a', []));
    mgr.render({}, {});
    const s1 = mgr.getStats();
    const s2 = mgr.getStats();
    expect(s1.drawCalls).toBe(1);
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // 不同对象
    expect(s1.executedPasses).not.toBe(s2.executedPasses); // 数组副本
  });

  it('getStats 含 frameTimeMs >= 0', () => {
    const mgr = new RenderPipelineManager();
    const stats = mgr.render({}, {});
    expect(stats.frameTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('getPipelineInfo 返回完整信息', () => {
    const mgr = new RenderPipelineManager({ pipeline: 'deferred', quality: 'medium' });
    mgr.disablePass('gbuffer');
    const info = mgr.getPipelineInfo();
    expect(info.pipeline).toBe('deferred');
    expect(info.quality).toBe('medium');
    expect(info.enabled).toBe(true);
    expect(info.autoSwitch).toBe(false);
    expect(info.passCount).toBe(4);
    expect(info.passes.length).toBe(4);
    expect(info.passes[0].name).toBe('gbuffer');
    expect(info.passes[0].enabled).toBe(false);
    expect(info.passes[0].order).toBe(0);
    expect(info.renderGraphCompiled).toBe(false);
  });

  it('getPipelineInfo 含 qualitySettings', () => {
    const mgr = new RenderPipelineManager({ quality: 'ultra' });
    const info = mgr.getPipelineInfo();
    expect(info.qualitySettings.ssaoSamples).toBe(QUALITY_PRESETS.ultra.ssaoSamples);
  });

  it('注入 now 函数验证 frameTimeMs', () => {
    let t = 100;
    const mgr = new RenderPipelineManager({ now: () => t });
    mgr.removePass('opaque');
    mgr.removePass('transparent');
    mgr.removePass('postprocess');
    mgr.addPass('a', {
      name: 'a',
      enabled: true,
      execute: () => {
        t += 50; // 模拟耗时 50ms
      },
    });
    const stats = mgr.render({}, {});
    expect(stats.frameTimeMs).toBe(50);
  });
});

// ── dispose ──────────────────────────────────────────────────────

describe('RenderPipelineManager — dispose', () => {
  it('dispose 调用 pass.dispose', () => {
    const mgr = new RenderPipelineManager();
    let disposed = false;
    mgr.addPass('x', {
      name: 'x',
      enabled: true,
      execute: () => {},
      dispose: () => {
        disposed = true;
      },
    });
    mgr.dispose();
    expect(disposed).toBe(true);
  });

  it('dispose 清空 passes / renderGraph', () => {
    const mgr = new RenderPipelineManager();
    mgr.buildRenderGraph();
    mgr.dispose();
    expect(mgr.passes.size).toBe(0);
    expect(mgr.passOrder).toEqual([]);
    expect(mgr.renderGraph).toBeNull();
    expect(mgr.enabled).toBe(false);
    expect(mgr.renderTarget).toBeNull();
  });

  it('dispose pass.dispose 抛错不中断', () => {
    const mgr = new RenderPipelineManager();
    let disposed = false;
    mgr.addPass('bad', {
      name: 'bad',
      enabled: true,
      execute: () => {},
      dispose: () => {
        throw new Error('boom');
      },
    });
    mgr.addPass('good', {
      name: 'good',
      enabled: true,
      execute: () => {},
      dispose: () => {
        disposed = true;
      },
    });
    expect(() => mgr.dispose()).not.toThrow();
    expect(disposed).toBe(true);
  });
});
