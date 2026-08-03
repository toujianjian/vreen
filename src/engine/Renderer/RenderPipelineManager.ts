// RenderPipelineManager — 渲染管线管理器。
//
// 设计目标:
//   - 统一管理三种渲染管线的切换:Forward / Deferred / Forward+;
//   - Pass 组合:每个管线由若干 PipelinePass 组成,可动态 addPass/removePass/
//     reorderPass/enablePass/disablePass;
//   - 质量等级(low/medium/high/ultra)影响 Pass 参数(如 SSAO 采样数、bloom
//     分辨率、tile 大小),通过 applyQualitySettings 统一下发;
//   - 自动选择:根据场景光源数 / 物体数自动切换管线(autoSwitch 启用时);
//   - RenderGraph 集成:可把 passes 编译成 RenderGraph 节点图,利用其拓扑
//     排序与资源生命周期分析(高级用法,普通用户直接 render() 即可)。
//
// 与 WebGL2Renderer / DeferredRenderer / ForwardPlusRenderer 的关系:
//   - 本类是「编排器」,不直接调用 GL;实际渲染由 PipelinePass.execute 回调
//     完成(回调内可调用 WebGL2Renderer/DeferredRenderer/ForwardPlusRenderer)。
//   - 这样设计使本类可在无 WebGL 环境下测试与使用(头less / CI),同时保持
//     与具体渲染器解耦。
//   - 调用方典型用法:
//       const mgr = new RenderPipelineManager();
//       mgr.setPipeline('forward');
//       mgr.addPass('opaque', { name:'opaque', enabled:true, execute: (ctx) => { renderer.render(ctx.scene, ctx.camera); } });
//       mgr.render(scene, camera);
//
// 不变量:
//   - passOrder 中的 name 必须与 passes Map 的 key 一一对应;
//   - setPipeline 会清空 passes 并注册该管线的默认 pass 框架(均为 no-op stub,
//     用户可后续替换);
//   - enabled=false 时 render() 直接返回,不执行任何 pass;
//   - dispose 后 passes 清空、renderGraph 清空、enabled=false。

import { RenderGraph, type RenderGraphNode } from './RenderGraph';
import { createLogger } from '@/lib/logger';

const log = createLogger('RenderPipelineManager');

/** 渲染管线类型。 */
export type PipelineType = 'forward' | 'deferred' | 'forwardplus';

/** 质量等级。 */
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

/** 渲染管线 Pass 接口。execute 由调用方实现(可调用具体渲染器)。 */
export interface PipelinePass {
  /** Pass 名(唯一,与 passes Map 的 key 一致)。 */
  name: string;
  /** 是否启用。禁用的 pass 在 render() 时跳过。 */
  enabled: boolean;
  /** 执行回调。 */
  execute(ctx: PipelineRenderContext): void;
  /** 可选:质量等级变更通知。 */
  setQuality?(level: QualityLevel): void;
  /** 可选:释放资源。 */
  dispose?(): void;
  /** 可选:渲染图节点输入资源(高级用法,buildRenderGraph 用)。 */
  inputs?: string[];
  /** 可选:渲染图节点输出资源(高级用法,buildRenderGraph 用)。 */
  outputs?: string[];
}

/** 渲染上下文(传给每个 pass 的 execute)。 */
export interface PipelineRenderContext {
  /** 场景(透传,不解释)。 */
  scene: unknown;
  /** 相机(透传,不解释)。 */
  camera: unknown;
  /** 渲染目标(透传,不解释)。 */
  renderTarget: unknown;
  /** 当前管线类型。 */
  pipeline: PipelineType;
  /** 当前质量等级。 */
  quality: QualityLevel;
  /** 当前 pass 序号(0-based)。 */
  passIndex: number;
  /** 当前 pass 名。 */
  passName: string;
  /** 统计(可被 pass 累加 drawCalls/triangles)。 */
  stats: PipelineStats;
}

/** 渲染统计。 */
export interface PipelineStats {
  /** 当前帧 draw call 数(pass 累加)。 */
  drawCalls: number;
  /** 当前帧三角面数(pass 累加)。 */
  triangles: number;
  /** 已注册 pass 总数。 */
  passCount: number;
  /** 当前帧启用的 pass 数。 */
  activePasses: number;
  /** 上一帧总耗时(ms)。 */
  frameTimeMs: number;
  /** 当前管线。 */
  pipeline: PipelineType;
  /** 当前质量。 */
  quality: QualityLevel;
  /** 当前帧执行过的 pass 名列表(按顺序)。 */
  executedPasses: string[];
}

/** 场景统计(autoSelectPipeline 用)。
 *
 * 注:Core 模块已有同名 `SceneStats` 类(场景统计聚合器),本接口为管线
 * 内部使用,故加 `Pipeline` 前缀避免冲突。 */
export interface PipelineSceneStats {
  /** 光源总数。 */
  lightCount: number;
  /** 物体总数(含非 mesh)。 */
  objectCount: number;
  /** Mesh 数。 */
  meshCount: number;
}

/** 渲染管线管理器选项。 */
export interface RenderPipelineManagerOptions {
  /** 初始管线(默认 'forward')。 */
  pipeline?: PipelineType;
  /** 初始质量(默认 'high')。 */
  quality?: QualityLevel;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
  /** 是否自动切换管线(默认 false)。 */
  autoSwitch?: boolean;
  /** 时钟函数(默认 performance.now,便于测试注入)。 */
  now?: () => number;
}

/** 质量等级 → Pass 参数预设。 */
export interface QualitySettings {
  /** SSAO 采样数。 */
  ssaoSamples: number;
  /** Bloom 分辨率缩放。 */
  bloomResolutionScale: number;
  /** Forward+ tile 大小(像素)。 */
  tilesize: number;
  /** 每分块最大光源数。 */
  maxLightsPerTile: number;
  /** 阴影贴图分辨率。 */
  shadowMapSize: number;
  /** 是否启用 TAA。 */
  taaEnabled: boolean;
  /** 是否启用 SSR。 */
  ssrEnabled: boolean;
  /** 是否启用 GTAO。 */
  gtaoEnabled: boolean;
  /** 是否启用 SSGI(屏幕空间全局光照)。 */
  ssgiEnabled: boolean;
  /** 是否启用屏幕空间方向性接触阴影。 */
  ssShadowEnabled: boolean;
  /** 是否启用色调映射(HDR→LDR)。 */
  tonemappingEnabled: boolean;
  /** 是否启用 CSM 级联阴影贴图。 */
  csmEnabled: boolean;
}

/** 各管线默认 Pass 框架(均为 no-op stub,用户可替换)。 */
const DEFAULT_PASSES: Record<PipelineType, string[]> = {
  forward: ['opaque', 'transparent', 'postprocess'],
  deferred: ['gbuffer', 'lighting', 'transparent', 'postprocess'],
  forwardplus: ['depthprepass', 'tilecull', 'geometry', 'transparent', 'postprocess'],
};

/** 质量等级预设。 */
export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    ssaoSamples: 8,
    bloomResolutionScale: 0.25,
    tilesize: 32,
    maxLightsPerTile: 32,
    shadowMapSize: 1024,
    taaEnabled: false,
    ssrEnabled: false,
    gtaoEnabled: false,
    ssgiEnabled: false,
    ssShadowEnabled: false,
    tonemappingEnabled: true,
    csmEnabled: false,
  },
  medium: {
    ssaoSamples: 16,
    bloomResolutionScale: 0.5,
    tilesize: 32,
    maxLightsPerTile: 64,
    shadowMapSize: 2048,
    taaEnabled: true,
    ssrEnabled: false,
    gtaoEnabled: false,
    ssgiEnabled: false,
    ssShadowEnabled: true,
    tonemappingEnabled: true,
    csmEnabled: true,
  },
  high: {
    ssaoSamples: 32,
    bloomResolutionScale: 0.5,
    tilesize: 16,
    maxLightsPerTile: 128,
    shadowMapSize: 4096,
    taaEnabled: true,
    ssrEnabled: true,
    gtaoEnabled: true,
    ssgiEnabled: true,
    ssShadowEnabled: true,
    tonemappingEnabled: true,
    csmEnabled: true,
  },
  ultra: {
    ssaoSamples: 64,
    bloomResolutionScale: 1.0,
    tilesize: 16,
    maxLightsPerTile: 256,
    shadowMapSize: 8192,
    taaEnabled: true,
    ssrEnabled: true,
    gtaoEnabled: true,
    ssgiEnabled: true,
    ssShadowEnabled: true,
    tonemappingEnabled: true,
    csmEnabled: true,
  },
};

/** 默认 Pass stub 工厂:no-op,不调用 GL。executedPasses 由管理器统一记录。 */
function makeStubPass(name: string): PipelinePass {
  return {
    name,
    enabled: true,
    execute: () => {
      log.debug(`pass "${name}" executed (stub)`);
    },
  };
}

/**
 * 渲染管线管理器。
 *
 * 管理 Forward / Deferred / Forward+ 三种管线的切换、Pass 组合、质量等级、
 * RenderGraph 集成与自动选择。不直接调用 GL,实际渲染由 PipelinePass.execute
 * 回调完成,使其可在无 WebGL 环境下测试。
 */
export class RenderPipelineManager {
  /** 当前管线类型。 */
  currentPipeline: PipelineType = 'forward';
  /** 当前质量等级。 */
  qualityLevel: QualityLevel = 'high';
  /** 是否启用(禁用时 render 直接返回)。 */
  enabled: boolean = true;
  /** 是否自动根据场景选择管线。 */
  autoSwitch: boolean = false;

  /** 已注册的 Pass(name → pass)。 */
  passes: Map<string, PipelinePass> = new Map();
  /** Pass 执行顺序(name 列表)。 */
  passOrder: string[] = [];
  /** 渲染图(可选,buildRenderGraph 后填充)。 */
  renderGraph: RenderGraph | null = null;
  /** 渲染目标(透传给 pass)。 */
  renderTarget: unknown = null;

  /** 当前质量预设(applyQualitySettings 后填充)。 */
  qualitySettings: QualitySettings = { ...QUALITY_PRESETS.high };

  /** 上一帧统计。 */
  private _stats: PipelineStats = {
    drawCalls: 0,
    triangles: 0,
    passCount: 0,
    activePasses: 0,
    frameTimeMs: 0,
    pipeline: 'forward',
    quality: 'high',
    executedPasses: [],
  };

  /** 时钟函数。 */
  private _now: () => number;
  /** renderGraph 是否已编译。 */
  private _graphCompiled: boolean = false;

  constructor(opts: RenderPipelineManagerOptions = {}) {
    this._now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    if (opts.pipeline !== undefined) this.currentPipeline = opts.pipeline;
    if (opts.quality !== undefined) this.qualityLevel = opts.quality;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.autoSwitch !== undefined) this.autoSwitch = opts.autoSwitch;
    this.qualitySettings = { ...QUALITY_PRESETS[this.qualityLevel] };
    this._stats.pipeline = this.currentPipeline;
    this._stats.quality = this.qualityLevel;
    // 注册默认 pass 框架
    this._registerDefaultPasses();
  }

  // ── 管线切换 ─────────────────────────────────────────────────────

  /**
   * 设置渲染管线。
   *
   * 清空当前所有 pass,注册目标管线的默认 pass 框架(均为 no-op stub)。
   * 调用方可后续用 addPass / removePass 替换具体实现。
   */
  setPipeline(type: PipelineType): this {
    if (this.currentPipeline === type) return this;
    this.currentPipeline = type;
    this._stats.pipeline = type;
    // 清空旧 pass
    this._clearPasses();
    // 注册新管线默认 pass
    this._registerDefaultPasses();
    // 管线变更后,渲染图失效
    this._invalidateGraph();
    log.info(`pipeline switched to "${type}"`);
    return this;
  }

  /** 获取当前管线类型。 */
  getPipeline(): PipelineType {
    return this.currentPipeline;
  }

  /**
   * 设置质量等级。
   *
   * 应用 QUALITY_PRESETS 预设到 qualitySettings,并通知所有 pass(若 pass
   * 实现了 setQuality)。
   */
  setQuality(level: QualityLevel): this {
    if (this.qualityLevel === level) return this;
    this.qualityLevel = level;
    this._stats.quality = level;
    this.applyQualitySettings(level);
    log.info(`quality set to "${level}"`);
    return this;
  }

  /** 获取当前质量等级。 */
  getQuality(): QualityLevel {
    return this.qualityLevel;
  }

  /** 应用质量预设到 qualitySettings 并通知所有 pass。 */
  applyQualitySettings(level: QualityLevel): this {
    this.qualitySettings = { ...QUALITY_PRESETS[level] };
    for (const pass of this.passes.values()) {
      if (typeof pass.setQuality === 'function') {
        try {
          pass.setQuality(level);
        } catch (e) {
          log.warn(`pass "${pass.name}" setQuality failed: ${(e as Error).message}`);
        }
      }
    }
    return this;
  }

  /** 获取当前质量预设。 */
  getQualitySettings(): QualitySettings {
    return { ...this.qualitySettings };
  }

  // ── Pass 管理 ────────────────────────────────────────────────────

  /**
   * 添加 Pass(追加到末尾)。
   * @param name Pass 名(唯一)
   * @param pass Pass 实例
   * @throws 若 name 已存在
   */
  addPass(name: string, pass: PipelinePass): this {
    if (this.passes.has(name)) {
      throw new Error(`RenderPipelineManager.addPass: pass "${name}" already exists`);
    }
    pass.name = name;
    this.passes.set(name, pass);
    this.passOrder.push(name);
    this._stats.passCount = this.passes.size;
    this._invalidateGraph();
    return this;
  }

  /**
   * 移除 Pass。
   * @returns 是否移除成功
   */
  removePass(name: string): boolean {
    if (!this.passes.delete(name)) return false;
    this.passOrder = this.passOrder.filter((n) => n !== name);
    this._stats.passCount = this.passes.size;
    this._invalidateGraph();
    return true;
  }

  /** 获取 Pass(找不到返回 undefined)。 */
  getPass(name: string): PipelinePass | undefined {
    return this.passes.get(name);
  }

  /** 获取所有 Pass(按 passOrder 顺序)。 */
  getPasses(): PipelinePass[] {
    return this.passOrder.map((n) => this.passes.get(n)!).filter(Boolean);
  }

  /** 获取 Pass 名顺序(快照)。 */
  getPassOrder(): string[] {
    return [...this.passOrder];
  }

  /**
   * 重排序 Pass(移动到新位置)。
   * @param name    Pass 名
   * @param newIndex 新位置(0-based)
   * @returns 是否成功
   */
  reorderPass(name: string, newIndex: number): boolean {
    const cur = this.passOrder.indexOf(name);
    if (cur < 0) return false;
    if (newIndex < 0 || newIndex >= this.passOrder.length) return false;
    if (cur === newIndex) return true;
    this.passOrder.splice(cur, 1);
    this.passOrder.splice(newIndex, 0, name);
    this._invalidateGraph();
    return true;
  }

  /** 启用 Pass。 */
  enablePass(name: string): boolean {
    const p = this.passes.get(name);
    if (!p) return false;
    p.enabled = true;
    return true;
  }

  /** 禁用 Pass。 */
  disablePass(name: string): boolean {
    const p = this.passes.get(name);
    if (!p) return false;
    p.enabled = false;
    return true;
  }

  /** 设置渲染目标(透传给 pass)。 */
  setRenderTarget(target: unknown): this {
    this.renderTarget = target;
    return this;
  }

  // ── 渲染 ─────────────────────────────────────────────────────────

  /**
   * 执行渲染。
   *
   * 若 autoSwitch 启用,先按场景统计自动选择管线;
   * 否则按当前 currentPipeline 分派到 renderForward / renderDeferred /
   * renderForwardPlus。
   *
   * @param scene   场景(透传给 pass)
   * @param camera  相机(透传给 pass)
   */
  render(scene: unknown, camera: unknown): PipelineStats {
    const t0 = this._now();
    // 重置帧统计
    this._stats.drawCalls = 0;
    this._stats.triangles = 0;
    this._stats.executedPasses = [];

    if (!this.enabled) {
      this._stats.frameTimeMs = this._now() - t0;
      this._stats.activePasses = 0;
      return this._stats;
    }

    // 自动选择管线
    if (this.autoSwitch) {
      const picked = this.autoSelectPipeline(scene);
      if (picked !== this.currentPipeline) {
        this.setPipeline(picked);
      }
    }

    // 分派到具体管线
    switch (this.currentPipeline) {
      case 'forward':
        this.renderForward(scene, camera);
        break;
      case 'deferred':
        this.renderDeferred(scene, camera);
        break;
      case 'forwardplus':
        this.renderForwardPlus(scene, camera);
        break;
    }

    this._stats.frameTimeMs = this._now() - t0;
    this._stats.passCount = this.passes.size;
    return this._stats;
  }

  /**
   * 前向渲染:按 passOrder 顺序执行所有启用的 pass。
   * 默认 pass 框架:opaque → transparent → postprocess。
   */
  renderForward(scene: unknown, camera: unknown): PipelineStats {
    return this._executePasses(scene, camera);
  }

  /**
   * 延迟渲染:按 passOrder 顺序执行所有启用的 pass。
   * 默认 pass 框架:gbuffer → lighting → transparent → postprocess。
   */
  renderDeferred(scene: unknown, camera: unknown): PipelineStats {
    return this._executePasses(scene, camera);
  }

  /**
   * Forward+ 渲染:按 passOrder 顺序执行所有启用的 pass。
   * 默认 pass 框架:depthprepass → tilecull → geometry → transparent → postprocess。
   */
  renderForwardPlus(scene: unknown, camera: unknown): PipelineStats {
    return this._executePasses(scene, camera);
  }

  // ── RenderGraph 集成 ─────────────────────────────────────────────

  /**
   * 构建渲染图:把所有 pass 转成 RenderGraph 节点。
   *
   * 节点 id = pass.name,inputs/outputs 取自 pass.inputs/outputs(默认空)。
   * 若 pass 声明了 inputs/outputs 且对应资源未注册,会自动注册为 transient texture。
   *
   * 构建后 graph 未编译,需调用 compileRenderGraph()。
   */
  buildRenderGraph(): RenderGraph {
    const rg = new RenderGraph();
    // 自动注册资源
    const registered = new Set<string>();
    for (const pass of this.passes.values()) {
      const ins = pass.inputs ?? [];
      const outs = pass.outputs ?? [];
      for (const r of [...ins, ...outs]) {
        if (!registered.has(r)) {
          rg.registerResource({
            name: r,
            type: 'texture',
            lifetime: 'transient',
            refCount: 0,
          });
          registered.add(r);
        }
      }
      const node: RenderGraphNode = {
        id: pass.name,
        name: pass.name,
        type: 'render',
        inputs: ins,
        outputs: outs,
        execute: (ctx) => {
          if (!pass.enabled) return;
          const passCtx = this._makeContext(
            undefined,
            undefined,
            this.passOrder.indexOf(pass.name),
          );
          pass.execute(passCtx);
          // 把 pass 输出资源写入 graph ctx(便于后续节点读)
          for (const out of outs) {
            if (!ctx.resources.has(out)) {
              ctx.createResource(out, `${pass.name}->${out}`);
            }
          }
        },
      };
      rg.addNode(node);
    }
    // 自动连边:若节点 A 的 output 是节点 B 的 input,加边 A → B
    for (const res of registered) {
      const writers = this.passOrder.filter((n) => {
        const p = this.passes.get(n)!;
        return (p.outputs ?? []).includes(res);
      });
      const readers = this.passOrder.filter((n) => {
        const p = this.passes.get(n)!;
        return (p.inputs ?? []).includes(res);
      });
      for (const w of writers) {
        for (const r of readers) {
          if (w !== r) {
            try {
              rg.addEdge(w, r, res);
            } catch {
              // 边添加失败忽略(可能资源未注册等)
            }
          }
        }
      }
    }
    this.renderGraph = rg;
    this._graphCompiled = false;
    return rg;
  }

  /** 编译渲染图(若未构建则先构建)。 */
  compileRenderGraph(): this {
    if (!this.renderGraph) {
      this.buildRenderGraph();
    }
    this.renderGraph!.compile();
    this._graphCompiled = true;
    return this;
  }

  /** 渲染图是否已编译。 */
  isGraphCompiled(): boolean {
    return this._graphCompiled;
  }

  // ── 自动选择 ─────────────────────────────────────────────────────

  /**
   * 根据场景统计自动选择管线。
   *
   * 启发式:
   *   - 光源数 > 32 或 mesh 数 > 1000 → forwardplus(海量光源场景)
   *   - 光源数 > 8 或 mesh 数 > 200 → deferred(多光源 / 复杂场景)
   *   - 否则 → forward(简单场景)
   *
   * @param scene 场景(若为 Object3D 子类会遍历统计;否则视为空场景)
   * @returns 推荐的管线类型
   */
  autoSelectPipeline(scene: unknown): PipelineType {
    const stats = this._computeSceneStats(scene);
    if (stats.lightCount > 32 || stats.meshCount > 1000) return 'forwardplus';
    if (stats.lightCount > 8 || stats.meshCount > 200) return 'deferred';
    return 'forward';
  }

  // ── 启用 / 禁用 ──────────────────────────────────────────────────

  /** 启用/禁用管理器(禁用时 render() 直接返回)。 */
  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    return this;
  }

  /** 设置是否自动切换管线。 */
  setAutoSwitch(enabled: boolean): this {
    this.autoSwitch = enabled;
    return this;
  }

  // ── 查询 ─────────────────────────────────────────────────────────

  /** 获取上一帧统计。 */
  getStats(): PipelineStats {
    return { ...this._stats, executedPasses: [...this._stats.executedPasses] };
  }

  /** 获取管线信息(当前管线 / Pass 列表 / 质量)。 */
  getPipelineInfo(): {
    pipeline: PipelineType;
    quality: QualityLevel;
    qualitySettings: QualitySettings;
    enabled: boolean;
    autoSwitch: boolean;
    passCount: number;
    passes: Array<{ name: string; enabled: boolean; order: number }>;
    renderGraphCompiled: boolean;
  } {
    return {
      pipeline: this.currentPipeline,
      quality: this.qualityLevel,
      qualitySettings: { ...this.qualitySettings },
      enabled: this.enabled,
      autoSwitch: this.autoSwitch,
      passCount: this.passes.size,
      passes: this.passOrder.map((name, idx) => ({
        name,
        enabled: this.passes.get(name)?.enabled ?? false,
        order: idx,
      })),
      renderGraphCompiled: this._graphCompiled,
    };
  }

  // ── 释放 ─────────────────────────────────────────────────────────

  /** 释放资源:调用所有 pass 的 dispose(若有),清空 passes 与 renderGraph。 */
  dispose(): void {
    for (const pass of this.passes.values()) {
      if (typeof pass.dispose === 'function') {
        try {
          pass.dispose();
        } catch (e) {
          log.warn(`pass "${pass.name}" dispose failed: ${(e as Error).message}`);
        }
      }
    }
    this._clearPasses();
    if (this.renderGraph) {
      this.renderGraph.clear();
      this.renderGraph = null;
    }
    this._graphCompiled = false;
    this.enabled = false;
    this.renderTarget = null;
    log.info('disposed');
  }

  // ── private ──────────────────────────────────────────────────────

  /** 执行所有启用的 pass(按 passOrder 顺序)。 */
  private _executePasses(scene: unknown, camera: unknown): PipelineStats {
    let active = 0;
    let idx = 0;
    for (const name of this.passOrder) {
      const pass = this.passes.get(name);
      if (!pass || !pass.enabled) {
        idx++;
        continue;
      }
      active++;
      const ctx = this._makeContext(scene, camera, idx);
      ctx.passName = name;
      try {
        pass.execute(ctx);
        // 管理器自身记录已执行的 pass 名(与 pass 是否自行记录无关)
        this._stats.executedPasses.push(name);
      } catch (e) {
        log.error(`pass "${name}" failed: ${(e as Error).message}`);
        // 不中断后续 pass
      }
      idx++;
    }
    this._stats.activePasses = active;
    return this._stats;
  }

  /** 构造渲染上下文。 */
  private _makeContext(
    scene: unknown,
    camera: unknown,
    passIndex: number,
  ): PipelineRenderContext {
    return {
      scene,
      camera,
      renderTarget: this.renderTarget,
      pipeline: this.currentPipeline,
      quality: this.qualityLevel,
      passIndex,
      passName: '',
      stats: this._stats,
    };
  }

  /** 注册当前管线的默认 pass 框架。 */
  private _registerDefaultPasses(): void {
    const names = DEFAULT_PASSES[this.currentPipeline];
    for (const name of names) {
      this.addPass(name, makeStubPass(name));
    }
  }

  /** 清空所有 pass。 */
  private _clearPasses(): void {
    this.passes.clear();
    this.passOrder = [];
    this._stats.passCount = 0;
  }

  /** 失效渲染图(下次需重建)。 */
  private _invalidateGraph(): void {
    if (this.renderGraph) {
      this.renderGraph = null;
      this._graphCompiled = false;
    }
  }

  /**
   * 计算场景统计(光源数 / 物体数 / mesh 数)。
   *
   * 通过鸭子类型遍历:若 scene 有 children 数组,递归统计 isLight / isMesh。
   * 不识别的对象返回空统计(避免与具体 Scene 类强耦合)。
   */
  private _computeSceneStats(scene: unknown): PipelineSceneStats {
    const stats: PipelineSceneStats = { lightCount: 0, objectCount: 0, meshCount: 0 };
    const visited = new Set<unknown>();
    const visit = (obj: unknown): void => {
      if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
      visited.add(obj);
      stats.objectCount++;
      const o = obj as { isLight?: boolean; isMesh?: boolean; children?: unknown[] };
      if (o.isLight) stats.lightCount++;
      if (o.isMesh) stats.meshCount++;
      if (Array.isArray(o.children)) {
        for (const c of o.children) visit(c);
      }
    };
    visit(scene);
    // objectCount 包含根场景本身,这里减 1 让数字更直观
    if (stats.objectCount > 0) stats.objectCount--;
    return stats;
  }
}
