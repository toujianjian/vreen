// AssetPipeline — 资源管线(可组合的处理步骤序列)。
//
// 设计目标:
//   * 把"导入 → 验证 → 优化 → 压缩"等处理组织为有序的 PipelineStep
//   * 每个 Step 接收 asset,返回处理后的 asset(可异步)
//   * 支持 addStep / removeStep / getStep 动态调整管线
//   * processBatch 批量处理,统一错误收集
//
// 与 Loaders/AssetManager 的关系:
//   AssetManager 关注"按 key 缓存 Promise"的加载层,
//   AssetPipeline 关注"按顺序对已加载资源做变换"的处理层。
//   二者正交:可以把 AssetManager.load(...) 的结果喂给 AssetPipeline.process(...)。

import { createLogger } from '@/lib/logger';

const log = createLogger('AssetPipeline');

/** 资源抽象:任意带类型标签的对象。 */
export interface PipelineAsset {
  /** 资源类型(如 'geometry' / 'texture' / 'gltf')。 */
  type: string;
  /** 资源数据(具体类型由 type 决定)。 */
  data: unknown;
  /** 自由元数据(各步骤可读写)。 */
  metadata?: Record<string, unknown>;
  /** 资源名(用于日志)。 */
  name?: string;
}

/** 处理步骤。 */
export interface PipelineStep {
  /** 步骤名(唯一,用于 addStep/getStep/removeStep)。 */
  name: string;
  /** 处理函数:接收 asset,返回处理后的 asset(可异步,可返回新对象)。 */
  process(asset: PipelineAsset): PipelineAsset | Promise<PipelineAsset>;
}

/** 批量处理结果。 */
export interface BatchResult {
  /** 成功处理的资源。 */
  succeeded: PipelineAsset[];
  /** 失败的资源(附错误信息)。 */
  failed: Array<{ asset: PipelineAsset; error: Error }>;
}

/**
 * 资源管线。
 *
 * 用法:
 *   const pipeline = new AssetPipeline();
 *   pipeline.addStep({ name: 'validate', process: (a) => a });
 *   pipeline.addStep({ name: 'optimize', process: async (a) => { ... return a; } });
 *   const out = await pipeline.process(asset);
 *   const batch = await pipeline.processBatch([asset1, asset2]);
 */
export class AssetPipeline {
  /** 有序步骤列表。 */
  private steps: PipelineStep[] = [];
  /** 名称 → 步骤索引(便于 O(1) 查找)。 */
  private stepIndex = new Map<string, number>();
  /** 已处理资源缓存(可选,默认不开启)。 */
  private assets = new Map<string, PipelineAsset>();

  /** 添加步骤到管线末尾。若 name 已存在则覆盖。 */
  addStep(step: PipelineStep): this {
    if (!step.name) throw new Error(`AssetPipeline.addStep: step.name 必填`);
    const existing = this.stepIndex.get(step.name);
    if (existing !== undefined) {
      this.steps[existing] = step;
      log.info(`addStep("${step.name}") — replaced existing`);
    } else {
      this.stepIndex.set(step.name, this.steps.length);
      this.steps.push(step);
      log.info(`addStep("${step.name}") — appended (total=${this.steps.length})`);
    }
    return this;
  }

  /** 处理单个资源:依次执行所有步骤。 */
  async process(asset: PipelineAsset): Promise<PipelineAsset> {
    let current = asset;
    for (const step of this.steps) {
      try {
        const next = await step.process(current);
        if (next) current = next;
      } catch (err) {
        log.error(`step "${step.name}" failed: ${(err as Error).message ?? err}`);
        throw new Error(`AssetPipeline: step "${step.name}" failed: ${(err as Error).message ?? err}`);
      }
    }
    // 缓存(若有 name)
    if (asset.name) this.assets.set(asset.name, current);
    return current;
  }

  /** 批量处理:并发执行,单个失败不影响其他。返回 BatchResult。 */
  async processBatch(assets: PipelineAsset[]): Promise<BatchResult> {
    const succeeded: PipelineAsset[] = [];
    const failed: BatchResult['failed'] = [];
    // 串行处理避免步骤间竞态;若需并行,调用方自己 Promise.all
    for (const asset of assets) {
      try {
        const out = await this.process(asset);
        succeeded.push(out);
      } catch (err) {
        failed.push({ asset, error: err as Error });
      }
    }
    log.info(`processBatch — ${succeeded.length} succeeded, ${failed.length} failed`);
    return { succeeded, failed };
  }

  /** 按名查找步骤。 */
  getStep(name: string): PipelineStep | undefined {
    const idx = this.stepIndex.get(name);
    return idx === undefined ? undefined : this.steps[idx];
  }

  /** 移除步骤。返回 true 表示原存在。 */
  removeStep(name: string): boolean {
    const idx = this.stepIndex.get(name);
    if (idx === undefined) return false;
    this.steps.splice(idx, 1);
    // 重建索引
    this.stepIndex.clear();
    for (let i = 0; i < this.steps.length; i++) {
      this.stepIndex.set(this.steps[i].name, i);
    }
    log.info(`removeStep("${name}") — removed (total=${this.steps.length})`);
    return true;
  }

  /** 当前步骤数。 */
  get stepCount(): number {
    return this.steps.length;
  }

  /** 当前步骤名列表(顺序)。 */
  getStepNames(): string[] {
    return this.steps.map(s => s.name);
  }

  /** 取缓存资源(若 process 时 asset.name 已设置)。 */
  getAsset(name: string): PipelineAsset | undefined {
    return this.assets.get(name);
  }

  /** 清空缓存。 */
  clearAssets(): void {
    this.assets.clear();
  }
}
