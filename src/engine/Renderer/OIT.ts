// OIT — Weighted Blended Order-Independent Transparency (CPU 侧)。
//
// 适配 McGuire & Bavoil "Weighted Blended Order-Independent Transparency"
// (SIGGRAPH 2013 / GPU Pro 5)。three.js 与 o3de Atom 均使用此算法。
//
// 传统 alpha blending 需要按深度排序透明物体,O(n log n) 且对交叉遮挡无解。
// Weighted Blended OIT 使用两张额外的渲染目标:
//   1. accumulate buffer: 累加 Σ(color · weight · alpha)
//   2. revealage buffer: 累乘 Π(1 - alpha)
// 最终合成:
//   final.rgb = scene.rgb * revealage + (accumulate.rgb / Σweight) * (1 - revealage)
//   final.a   = 1 - (1 - scene.a) * (1 - layerAlpha)  (近似)
//
// 权重函数 (McGuire & Bavoil 2013):
//   weight = alpha * clamp(scale / (bias + depth^power), min, max)
//   默认: scale=0.03, bias=1e-5, power=1, min=0.01, max=3000
//   深度越大 (越远) 权重越小,远处半透明物体对最终颜色贡献小,
//   符合视觉直觉 (近处物体更显著)。
//
// CPU 侧实现 (无 WebGL 依赖):
//   - 逐像素累加 + 合成,适合无头环境 (测试 / SSR / 截图)
//   - 与 LensFlare / MotionBlurPass / TAAPass 同构
//   - GPU 版本可镜像实现 (用 GLSL shader + MRT)
//
// 不变量:
//   - clear() 后所有累加器归零,revealage=1 (完全透明层)
//   - addFragment 不越界 (x/y 超出范围的 fragment 被丢弃)
//   - composite 不修改输入 sceneData,返回新分配的 Uint8ClampedArray
//   - 无透明 fragment 的像素:final = scene (revealage=1)
//   - 完全不透明透明层 (revealage=0):final = accumulate / weight
//
// 参考:
//   - McGuire & Bavoil, "Weighted Blended OIT", GPU Pro 5 (2013)
//   - three.js WeightedBlendedOIT example
//   - o3de Atom TransparencyLayerPass

/** 单个透明片元。 */
export interface OITFragment {
  /** 屏幕 X (像素,整数)。 */
  x: number;
  /** 屏幕 Y (像素,整数)。 */
  y: number;
  /** 颜色 [r, g, b],0..1。 */
  color: [number, number, number];
  /** Alpha 0..1。 */
  alpha: number;
  /** 视空间深度 (正值,越大越远)。 */
  depth: number;
}

/** OIT 选项。 */
export interface OITOptions {
  /** 权重函数缩放因子 (默认 0.03)。 */
  weightScale?: number;
  /** 权重函数偏移 (默认 1e-5,避免除零)。 */
  weightBias?: number;
  /** 权重函数深度幂 (默认 1.0,越大远处衰减越快)。 */
  weightDepthPower?: number;
  /** 权重下限 (默认 0.01)。 */
  weightMin?: number;
  /** 权重上限 (默认 3000.0)。 */
  weightMax?: number;
}

/**
 * Weighted Blended Order-Independent Transparency (CPU 侧)。
 *
 * 用法:
 * ```ts
 * const oit = new WeightedBlendedOIT(1280, 720);
 * // 每帧:
 * oit.clear();
 * for (const frag of transparentFragments) {
 *   oit.addFragment(frag);
 * }
 * const finalPixels = oit.composite(scenePixels);
 * ```
 */
export class WeightedBlendedOIT {
  readonly name = 'weighted-blended-oit';

  width: number;
  height: number;

  // 权重函数参数
  readonly weightScale: number;
  readonly weightBias: number;
  readonly weightDepthPower: number;
  readonly weightMin: number;
  readonly weightMax: number;

  /** 累加颜色: 每像素 [r, g, b, weight_sum]。 */
  private accumColor: Float32Array;
  /** revealage: 每像素 Π(1 - alpha),初始 1.0。 */
  private revealage: Float32Array;

  /** 上次 composite 的统计。 */
  stats = {
    fragmentCount: 0,
    visiblePixels: 0,
    lastCompositeTimeMs: 0,
  };

  constructor(width: number, height: number, opts: OITOptions = {}) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.weightScale = opts.weightScale ?? 0.03;
    this.weightBias = opts.weightBias ?? 1e-5;
    this.weightDepthPower = opts.weightDepthPower ?? 1.0;
    this.weightMin = opts.weightMin ?? 0.01;
    this.weightMax = opts.weightMax ?? 3000.0;

    const pixelCount = this.width * this.height;
    this.accumColor = new Float32Array(pixelCount * 4); // [r, g, b, weight_sum]
    this.revealage = new Float32Array(pixelCount); // init 1.0
    this.clear();
  }

  /** 清空累加器 (每帧调用)。 */
  clear(): void {
    this.accumColor.fill(0);
    this.revealage.fill(1.0);
    this.stats.fragmentCount = 0;
    this.stats.visiblePixels = 0;
  }

  /** 调整大小 (清空所有数据)。 */
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const pixelCount = this.width * this.height;
    this.accumColor = new Float32Array(pixelCount * 4);
    this.revealage = new Float32Array(pixelCount);
    this.clear();
  }

  /**
   * 添加单个透明片元。
   * 越界的 fragment 被静默丢弃。
   */
  addFragment(frag: OITFragment): void {
    const x = Math.floor(frag.x);
    const y = Math.floor(frag.y);
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;

    const alpha = Math.max(0, Math.min(1, frag.alpha));
    if (alpha <= 0) return; // 完全透明,无贡献

    const depth = Math.max(0, frag.depth);

    // 计算权重
    const weight = this._computeWeight(alpha, depth);

    const idx = y * this.width + x;
    const accumIdx = idx * 4;

    // accumulate: Σ(color · weight · alpha)
    this.accumColor[accumIdx] += frag.color[0] * weight * alpha;
    this.accumColor[accumIdx + 1] += frag.color[1] * weight * alpha;
    this.accumColor[accumIdx + 2] += frag.color[2] * weight * alpha;
    // 权重累加
    this.accumColor[accumIdx + 3] += weight * alpha;

    // revealage: Π(1 - alpha)
    this.revealage[idx] *= (1 - alpha);

    this.stats.fragmentCount++;
  }

  /**
   * 批量添加透明片元。
   */
  addFragments(frags: OITFragment[]): void {
    for (const f of frags) {
      this.addFragment(f);
    }
  }

  /**
   * 将 OIT 层合成到场景像素上。
   *
   * @param sceneData RGBA 字节流 (Uint8ClampedArray, 长度 = width * height * 4)
   * @returns 新分配的 Uint8ClampedArray (合成结果)
   */
  composite(sceneData: Uint8ClampedArray): Uint8ClampedArray {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const output = new Uint8ClampedArray(sceneData);
    const pixelCount = this.width * this.height;
    let visiblePixels = 0;

    for (let i = 0; i < pixelCount; i++) {
      const rev = this.revealage[i];
      const weightSum = this.accumColor[i * 4 + 3];

      // 无透明片元 (revealage=1, weightSum=0) → 保持场景
      if (rev >= 1.0 || weightSum <= 0) continue;

      visiblePixels++;

      // 透明层颜色 = accumulate / weightSum
      const layerR = this.accumColor[i * 4] / weightSum;
      const layerG = this.accumColor[i * 4 + 1] / weightSum;
      const layerB = this.accumColor[i * 4 + 2] / weightSum;

      // final = scene * revealage + layer * (1 - revealage)
      const oneMinusRev = 1 - rev;
      const outIdx = i * 4;
      output[outIdx] = Math.min(255, sceneData[outIdx] * rev + layerR * oneMinusRev * 255);
      output[outIdx + 1] = Math.min(255, sceneData[outIdx + 1] * rev + layerG * oneMinusRev * 255);
      output[outIdx + 2] = Math.min(255, sceneData[outIdx + 2] * rev + layerB * oneMinusRev * 255);
      // alpha: 简单合成
      output[outIdx + 3] = Math.min(255, sceneData[outIdx + 3] * rev + 255 * oneMinusRev);
    }

    this.stats.visiblePixels = visiblePixels;
    this.stats.lastCompositeTimeMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    return output;
  }

  /** 释放资源 (CPU 侧无 GL 资源,仅清空数组)。 */
  dispose(): void {
    this.accumColor = new Float32Array(0);
    this.revealage = new Float32Array(0);
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────

  /**
   * 计算片元权重 (McGuire & Bavoil 2013)。
   * weight = alpha * clamp(scale / (bias + depth^power), min, max)
   */
  private _computeWeight(alpha: number, depth: number): number {
    const depthTerm = Math.pow(depth, this.weightDepthPower);
    const rawWeight = this.weightScale / (this.weightBias + depthTerm);
    const clampedWeight = Math.max(this.weightMin, Math.min(this.weightMax, rawWeight));
    return alpha * clampedWeight;
  }

  // ── 调试 / 测试辅助 ──────────────────────────────────────────────────

  /** 获取某像素的 revealage (0..1,1=完全透明层)。 */
  getRevealage(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 1.0;
    return this.revealage[y * this.width + x];
  }

  /** 获取某像素的累加权重和。 */
  getAccumulatedWeight(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.accumColor[(y * this.width + x) * 4 + 3];
  }

  /** 获取某像素的累加颜色 [r, g, b] (未除以权重)。 */
  getAccumulatedColor(x: number, y: number): [number, number, number] {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return [0, 0, 0];
    const idx = (y * this.width + x) * 4;
    return [this.accumColor[idx], this.accumColor[idx + 1], this.accumColor[idx + 2]];
  }
}
