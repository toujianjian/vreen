// VariableRateShading — 可变速率着色 (VRS) 瓦片分类系统。
//
// 设计来源:
//   * o3de Atom `AZ::RHI::ShadingRate` + `RasterPass::FragmentShadingRate`
//   * UE5 VariableRateShading (VRS) 插件
//   * NVIDIA Turing "Variable Rate Shading" (Siggraph 2019)
//   * VK_KHR_fragment_shading_rate / D3D12 Variable Rate Shading
//   * VRS Game Sampling pattern (He et al. 2020 "Variable Rate Shading with Hair Rendering")
//
// 问题:
//   在高分辨率(4K/8K)下,每个像素都以全速率着色,但人眼对屏幕不同区域的
//   敏感度不同:中心视野、边缘、高对比度区域需要全速率;外围视野、平坦表面、
//   快速运动区域、低对比度区域可以降低着色速率而不明显损失画质。
//   VRS 把屏幕划分为瓦片(通常 8×8 / 16×16 / 32×32 像素),每个瓦片指定一个
//   着色速率(1x1 / 1x2 / 2x1 / 2x2 / 2x4 / 4x2 / 4x4),GPU 在该瓦片内以指定
//   速率着色,大幅减少像素着色器调用次数。
//
// 解决:
//   1. ShadingRate 枚举:定义 7 种着色速率(1x1 = 全速率,4x4 = 1/16 速率)
//   2. VRSImage:2D 瓦片网格,每格存一个 ShadingRate 值
//   3. 分类策略(可组合):
//      - MotionVRS: 速度大的瓦片 → 降低速率(运动模糊掩盖细节)
//      - DepthVRS: 深度梯度小的瓦片 → 降低速率(平坦表面细节少)
//      - FoveatedVRS: 离注视点远的瓦片 → 降低速率(外围视觉敏感度低)
//      - LuminanceVRS: 亮度方差小的瓦片 → 降低速率(低对比度区域细节少)
//   4. VRSTileClassifier: 组合多策略,取最保守(最高)速率
//   5. MultiResolutionCompositor: WebGL2 软件降级方案 —— 低速率瓦片以低分辨率
//      渲染后上采样合成,模拟硬件 VRS 效果
//   6. GLSL chunks: 用于未来 WebGPU / 硬件 VRS 集成
//
// 与 TAA / TSR 的关系:
//   VRS 降低着色速率 → 像素更少 → TAA/TSR 用时间累积重建细节。
//   两者协同:VRS 提供性能,TAA/TSR 提供画质,共同实现高分辨率高帧率。
//
// 与 HierarchicalZBuffer 的关系:
//   HZB 剔除的是"看不见的物体"(被遮挡),VRS 降低的是"看不清的区域"
//   (低敏感度)。两者正交:HZB 减少顶点处理,VRS 减少像素处理。

// ── 着色速率 ─────────────────────────────────────────────────────

/**
 * 着色速率枚举。
 *
 * 命名规则:`{horizontalRate}x{verticalRate}`,表示在水平/垂直方向上
 * 每 {rate} 个像素共享 1 个着色结果。
 *
 * - `1x1`: 全速率(每像素着色一次)
 * - `1x2`: 垂直方向每 2 像素共享(水平全分辨率)
 * - `2x1`: 水平方向每 2 像素共享(垂直全分辨率)
 * - `2x2`: 2×2 像素共享 1 个着色(1/4 速率)
 * - `2x4`: 2×4 像素共享(1/8 速率)
 * - `4x2`: 4×2 像素共享(1/8 速率)
 * - `4x4`: 4×4 像素共享(1/16 速率)
 */
export enum ShadingRate {
  /** 全速率:每像素着色一次。 */
  Full = 0,
  /** 垂直 2x:水平全分辨率,垂直每 2 像素共享。 */
  Vertical2x = 1,
  /** 水平 2x:水平每 2 像素共享,垂直全分辨率。 */
  Horizontal2x = 2,
  /** 2×2:4 像素共享 1 个着色(1/4 速率)。 */
  Quarter2x2 = 3,
  /** 2×4:8 像素共享(1/8 速率)。 */
  Eighth2x4 = 4,
  /** 4×2:8 像素共享(1/8 速率)。 */
  Eighth4x2 = 5,
  /** 4×4:16 像素共享(1/16 速率)。 */
  Sixteenth4x4 = 6,
}

/** 着色速率 → 像素覆盖率(1/coverage = 实际着色比例)。 */
const SHADING_RATE_COVERAGE: number[] = [
  1,    // 1x1
  1 / 2,  // 1x2
  1 / 2,  // 2x1
  1 / 4,  // 2x2
  1 / 8,  // 2x4
  1 / 8,  // 4x2
  1 / 16, // 4x4
];

/** 着色速率 → 水平像素步长。 */
const SHADING_RATE_H_STEP: number[] = [1, 1, 2, 2, 2, 4, 4];

/** 着色速率 → 垂直像素步长。 */
const SHADING_RATE_V_STEP: number[] = [1, 2, 1, 2, 4, 2, 4];

/** 着色速率 → 人类可读名称。 */
const SHADING_RATE_NAMES: string[] = [
  '1x1',
  '1x2',
  '2x1',
  '2x2',
  '2x4',
  '4x2',
  '4x4',
];

/** 获取着色速率的像素覆盖率(0-1,1 = 全速率)。 */
export function shadingRateCoverage(rate: ShadingRate): number {
  return SHADING_RATE_COVERAGE[rate] ?? 1;
}

/** 获取着色速率的水平像素步长。 */
export function shadingRateHStep(rate: ShadingRate): number {
  return SHADING_RATE_H_STEP[rate] ?? 1;
}

/** 获取着色速率的垂直像素步长。 */
export function shadingRateVStep(rate: ShadingRate): number {
  return SHADING_RATE_V_STEP[rate] ?? 1;
}

/** 获取着色速率的名称。 */
export function shadingRateName(rate: ShadingRate): string {
  return SHADING_RATE_NAMES[rate] ?? '1x1';
}

/** 所有有效着色速率。 */
export const ALL_SHADING_RATES: ShadingRate[] = [
  ShadingRate.Full,
  ShadingRate.Vertical2x,
  ShadingRate.Horizontal2x,
  ShadingRate.Quarter2x2,
  ShadingRate.Eighth2x4,
  ShadingRate.Eighth4x2,
  ShadingRate.Sixteenth4x4,
];

// ── VRS Image(瓦片网格)────────────────────────────────────────

/**
 * VRS 图像 —— 2D 瓦片网格,每格存一个 ShadingRate 值。
 *
 * 瓦片大小通常是 8×8 / 16×16 / 32×32 像素(由硬件 VRS tile size 决定)。
 * VRSImage 的尺寸 = ceil(screenWidth / tileSize) × ceil(screenHeight / tileSize)。
 */
export interface VRSImage {
  /** 图像宽度(瓦片数)。 */
  width: number;
  /** 图像高度(瓦片数)。 */
  height: number;
  /** 瓦片大小(像素)。 */
  tileSize: number;
  /** 着色速率数据(length = width * height)。 */
  data: Uint8Array;
}

/** 创建 VRS 图像。 */
export function createVRSImage(
  screenWidth: number,
  screenHeight: number,
  tileSize: number = 16,
  fillRate: ShadingRate = ShadingRate.Full,
): VRSImage {
  const width = Math.ceil(screenWidth / tileSize);
  const height = Math.ceil(screenHeight / tileSize);
  const data = new Uint8Array(width * height).fill(fillRate);
  return { width, height, tileSize, data };
}

/** 获取瓦片 (tx, ty) 的着色速率。 */
export function getTileRate(image: VRSImage, tx: number, ty: number): ShadingRate {
  if (tx < 0 || tx >= image.width || ty < 0 || ty >= image.height) {
    return ShadingRate.Full;
  }
  return image.data[ty * image.width + tx] as ShadingRate;
}

/** 设置瓦片 (tx, ty) 的着色速率。 */
export function setTileRate(
  image: VRSImage,
  tx: number,
  ty: number,
  rate: ShadingRate,
): void {
  if (tx < 0 || tx >= image.width || ty < 0 || ty >= image.height) return;
  image.data[ty * image.width + tx] = rate;
}

/** 像素坐标 → 瓦片坐标。 */
export function pixelToTile(image: VRSImage, px: number, py: number): [number, number] {
  return [Math.floor(px / image.tileSize), Math.floor(py / image.tileSize)];
}

/** 获取像素 (px, py) 所在瓦片的着色速率。 */
export function getPixelRate(image: VRSImage, px: number, py: number): ShadingRate {
  const [tx, ty] = pixelToTile(image, px, py);
  return getTileRate(image, tx, ty);
}

/** 统计 VRS 图像中各速率的分布。 */
export function computeVRSStats(image: VRSImage): VRSStats {
  const counts = new Array(7).fill(0);
  for (let i = 0; i < image.data.length; i++) {
    counts[image.data[i]]++;
  }
  const total = image.data.length;
  const distribution: Record<string, number> = {};
  let weightedCoverage = 0;
  for (let r = 0; r < 7; r++) {
    const name = shadingRateName(r as ShadingRate);
    distribution[name] = counts[r];
    weightedCoverage += counts[r] * SHADING_RATE_COVERAGE[r];
  }
  const avgCoverage = total > 0 ? weightedCoverage / total : 1;
  // 节省的着色调用比例 = 1 - avgCoverage
  const savings = 1 - avgCoverage;
  return {
    totalTiles: total,
    distribution,
    averageCoverage: avgCoverage,
    pixelShadingSavings: savings,
  };
}

/** VRS 统计信息。 */
export interface VRSStats {
  /** 总瓦片数。 */
  totalTiles: number;
  /** 各速率的瓦片数(键为速率名如 "1x1")。 */
  distribution: Record<string, number>;
  /** 平均覆盖率(0-1,1 = 全速率)。 */
  averageCoverage: number;
  /** 着色调用节省比例(0-1,0 = 无节省)。 */
  pixelShadingSavings: number;
}

// ── 策略 1: 运动自适应 VRS ─────────────────────────────────────

/**
 * 运动自适应 VRS —— 根据速度缓冲降低快速运动区域的着色速率。
 *
 * 原理:快速运动的像素在 TAA/运动模糊后细节本就丢失,降低着色速率不可见。
 *
 * 速度阈值映射:
 *   speed < motionThreshold   → Full (1x1)
 *   motionThreshold ≤ speed   → 逐级降低(2x2 → 2x4 → 4x4)
 */
export function classifyMotionVRS(
  image: VRSImage,
  velocityBuffer: Float32Array,
  screenWidth: number,
  screenHeight: number,
  options: MotionVRSOptions = {},
): void {
  const opts = applyMotionDefaults(options);
  const ts = image.tileSize;

  for (let ty = 0; ty < image.height; ty++) {
    for (let tx = 0; tx < image.width; tx++) {
      // 采样瓦片内最大速度
      const px0 = tx * ts;
      const py0 = ty * ts;
      const px1 = Math.min(px0 + ts, screenWidth);
      const py1 = Math.min(py0 + ts, screenHeight);

      let maxSpeed = 0;
      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          const idx = (py * screenWidth + px) * 2;
          const vx = velocityBuffer[idx];
          const vy = velocityBuffer[idx + 1];
          const speed = Math.sqrt(vx * vx + vy * vy);
          if (speed > maxSpeed) maxSpeed = speed;
        }
      }

      // 速度 → 着色速率
      let rate: ShadingRate;
      if (maxSpeed < opts.motionThreshold) {
        rate = ShadingRate.Full;
      } else if (maxSpeed < opts.motionThreshold * 2) {
        rate = opts.maxRate >= ShadingRate.Quarter2x2 ? ShadingRate.Quarter2x2 : opts.maxRate;
      } else if (maxSpeed < opts.motionThreshold * 4) {
        rate = opts.maxRate >= ShadingRate.Eighth2x4 ? ShadingRate.Eighth2x4 : opts.maxRate;
      } else {
        rate = opts.maxRate;
      }

      image.data[ty * image.width + tx] = rate;
    }
  }
}

/** 运动自适应 VRS 选项。 */
export interface MotionVRSOptions {
  /** 速度阈值(像素/帧),超过此值开始降低速率。默认 2。 */
  motionThreshold?: number;
  /** 最大降低到的速率(不超过此速率)。默认 4x4。 */
  maxRate?: ShadingRate;
}

function applyMotionDefaults(opts: MotionVRSOptions): Required<MotionVRSOptions> {
  return {
    motionThreshold: opts.motionThreshold ?? 2,
    maxRate: opts.maxRate ?? ShadingRate.Sixteenth4x4,
  };
}

// ── 策略 2: 深度梯度自适应 VRS ─────────────────────────────────

/**
 * 深度梯度自适应 VRS —— 根据深度缓冲梯度降低平坦表面的着色速率。
 *
 * 原理:平坦表面(如天空、墙壁、地板)的深度变化小,像素间着色差异极小,
 * 降低着色速率不可见。
 *
 * 梯度计算:对瓦片内深度值计算水平/垂直差分,取最大梯度。
 */
export function classifyDepthVRS(
  image: VRSImage,
  depthBuffer: Float32Array,
  screenWidth: number,
  screenHeight: number,
  options: DepthVRSOptions = {},
): void {
  const opts = applyDepthDefaults(options);
  const ts = image.tileSize;

  for (let ty = 0; ty < image.height; ty++) {
    for (let tx = 0; tx < image.width; tx++) {
      const px0 = tx * ts;
      const py0 = ty * ts;
      const px1 = Math.min(px0 + ts, screenWidth);
      const py1 = Math.min(py0 + ts, screenHeight);

      let maxGradient = 0;
      let minDepth = Infinity;
      let maxDepth = -Infinity;

      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          const idx = py * screenWidth + px;
          const d = depthBuffer[idx];
          if (d < minDepth) minDepth = d;
          if (d > maxDepth) maxDepth = d;

          // 水平梯度
          if (px + 1 < screenWidth) {
            const dx = Math.abs(d - depthBuffer[idx + 1]);
            if (dx > maxGradient) maxGradient = dx;
          }
          // 垂直梯度
          if (py + 1 < screenHeight) {
            const dy = Math.abs(d - depthBuffer[idx + screenWidth]);
            if (dy > maxGradient) maxGradient = dy;
          }
        }
      }

      // 深度范围(用于检测天空盒等极远平面)
      const depthRange = maxDepth - minDepth;

      // 梯度 → 着色速率
      let rate: ShadingRate;
      if (maxGradient < opts.gradientThreshold && depthRange < opts.depthRangeThreshold) {
        // 极平坦 → 最低速率
        rate = opts.maxRate;
      } else if (maxGradient < opts.gradientThreshold * 2) {
        // 中等平坦
        rate = opts.maxRate >= ShadingRate.Quarter2x2 ? ShadingRate.Quarter2x2 : opts.maxRate;
      } else {
        // 高梯度(边缘/几何体) → 全速率
        rate = ShadingRate.Full;
      }

      image.data[ty * image.width + tx] = rate;
    }
  }
}

/** 深度梯度自适应 VRS 选项。 */
export interface DepthVRSOptions {
  /** 深度梯度阈值,低于此值视为平坦。默认 0.001。 */
  gradientThreshold?: number;
  /** 深度范围阈值,低于此值视为同一平面。默认 0.01。 */
  depthRangeThreshold?: number;
  /** 最大降低到的速率。默认 2x2(不用 4x4 避免天空盒过糊)。 */
  maxRate?: ShadingRate;
}

function applyDepthDefaults(opts: DepthVRSOptions): Required<DepthVRSOptions> {
  return {
    gradientThreshold: opts.gradientThreshold ?? 0.001,
    depthRangeThreshold: opts.depthRangeThreshold ?? 0.01,
    maxRate: opts.maxRate ?? ShadingRate.Quarter2x2,
  };
}

// ── 策略 3: 注视点 VRS(Foveated Rendering)─────────────────────

/**
 * 注视点 VRS —— 根据瓦片到注视点的距离降低外围区域的着色速率。
 *
 * 原理:人眼中央凹(Fovea)视觉敏锐,外围视觉模糊;VR 场景中尤其有效。
 *
 * 距离映射:
 *   dist < innerRadius  → Full (中心区域)
 *   innerRadius ≤ dist  → 逐级降低
 *   dist > outerRadius  → maxRate (最外围)
 */
export function classifyFoveatedVRS(
  image: VRSImage,
  gazeX: number,
  gazeY: number,
  options: FoveatedVRSOptions = {},
): void {
  const opts = applyFoveatedDefaults(options);

  // 注视点 → 瓦片坐标
  const gtx = gazeX / image.tileSize;
  const gty = gazeY / image.tileSize;

  // 内/外半径(瓦片单位)
  const innerTiles = opts.innerRadius / image.tileSize;
  const outerTiles = opts.outerRadius / image.tileSize;

  for (let ty = 0; ty < image.height; ty++) {
    for (let tx = 0; tx < image.width; tx++) {
      const dx = tx - gtx;
      const dy = ty - gty;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let rate: ShadingRate;
      if (dist <= innerTiles) {
        rate = ShadingRate.Full;
      } else if (dist >= outerTiles) {
        rate = opts.maxRate;
      } else {
        // 在内/外半径之间线性插值速率级别
        const t = (dist - innerTiles) / (outerTiles - innerTiles);
        const maxRateLevel = opts.maxRate;
        // 速率级别 = Full(0) ... maxRateLevel
        const level = Math.round(t * maxRateLevel);
        rate = Math.min(level, maxRateLevel) as ShadingRate;
      }

      image.data[ty * image.width + tx] = rate;
    }
  }
}

/** 注视点 VRS 选项。 */
export interface FoveatedVRSOptions {
  /** 内半径(像素),此范围内全速率。默认 300。 */
  innerRadius?: number;
  /** 外半径(像素),此范围外最大降低。默认 800。 */
  outerRadius?: number;
  /** 最大降低到的速率。默认 4x4。 */
  maxRate?: ShadingRate;
}

function applyFoveatedDefaults(opts: FoveatedVRSOptions): Required<FoveatedVRSOptions> {
  return {
    innerRadius: opts.innerRadius ?? 300,
    outerRadius: opts.outerRadius ?? 800,
    maxRate: opts.maxRate ?? ShadingRate.Sixteenth4x4,
  };
}

// ── 策略 4: 亮度方差自适应 VRS ─────────────────────────────────

/**
 * 亮度方差自适应 VRS —— 根据瓦片内亮度方差降低低对比度区域的着色速率。
 *
 * 原理:低对比度区域(如天空、阴影、均匀表面)像素间颜色差异小,
 * 降低着色速率不可见。
 *
 * 方差计算:对瓦片内 RGB → luminance,计算均值与方差。
 */
export function classifyLuminanceVRS(
  image: VRSImage,
  colorBuffer: Float32Array,
  screenWidth: number,
  screenHeight: number,
  options: LuminanceVRSOptions = {},
): void {
  const opts = applyLuminanceDefaults(options);
  const ts = image.tileSize;

  for (let ty = 0; ty < image.height; ty++) {
    for (let tx = 0; tx < image.width; tx++) {
      const px0 = tx * ts;
      const py0 = ty * ts;
      const px1 = Math.min(px0 + ts, screenWidth);
      const py1 = Math.min(py0 + ts, screenHeight);

      // 计算亮度均值与方差
      let sum = 0;
      let sumSq = 0;
      let count = 0;

      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          const idx = (py * screenWidth + px) * 4;
          const r = colorBuffer[idx];
          const g = colorBuffer[idx + 1];
          const b = colorBuffer[idx + 2];
          // Rec.709 luminance
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += lum;
          sumSq += lum * lum;
          count++;
        }
      }

      if (count === 0) {
        image.data[ty * image.width + tx] = ShadingRate.Full;
        continue;
      }

      const mean = sum / count;
      const variance = sumSq / count - mean * mean;

      // 方差 → 着色速率
      let rate: ShadingRate;
      if (variance < opts.varianceThreshold) {
        rate = opts.maxRate;
      } else if (variance < opts.varianceThreshold * 4) {
        rate = opts.maxRate >= ShadingRate.Quarter2x2 ? ShadingRate.Quarter2x2 : opts.maxRate;
      } else {
        rate = ShadingRate.Full;
      }

      image.data[ty * image.width + tx] = rate;
    }
  }
}

/** 亮度方差自适应 VRS 选项。 */
export interface LuminanceVRSOptions {
  /** 亮度方差阈值,低于此值视为低对比度。默认 0.001。 */
  varianceThreshold?: number;
  /** 最大降低到的速率。默认 2x2。 */
  maxRate?: ShadingRate;
}

function applyLuminanceDefaults(opts: LuminanceVRSOptions): Required<LuminanceVRSOptions> {
  return {
    varianceThreshold: opts.varianceThreshold ?? 0.001,
    maxRate: opts.maxRate ?? ShadingRate.Quarter2x2,
  };
}

// ── 多策略组合 ──────────────────────────────────────────────────

/**
 * VRS 瓦片分类器 —— 组合多策略,取最保守(最高)速率。
 *
 * 原理:不同策略可能给出不同速率,取最高速率(最保守)确保不丢失关键细节。
 * 例如:运动策略说某瓦片可 4x4,但注视点策略说该瓦片在中心区域 → 取 Full。
 *
 * 用法:
 *   const classifier = new VRSTileClassifier();
 *   classifier.addStrategy('motion', (img) => classifyMotionVRS(img, vel, w, h));
 *   classifier.addStrategy('foveated', (img) => classifyFoveatedVRS(img, gazeX, gazeY));
 *   const result = classifier.classify(baseImage);
 */
export class VRSTileClassifier {
  private strategies: Map<string, VRSStrategy> = new Map();

  /** 添加分类策略。 */
  addStrategy(name: string, strategy: VRSStrategy): this {
    this.strategies.set(name, strategy);
    return this;
  }

  /** 移除策略。 */
  removeStrategy(name: string): this {
    this.strategies.delete(name);
    return this;
  }

  /** 清空所有策略。 */
  clearStrategies(): this {
    this.strategies.clear();
    return this;
  }

  /** 列出所有策略名。 */
  getStrategyNames(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * 执行分类:对每个策略生成一个 VRSImage,取每瓦片的最保守(最高)速率。
   *
   * 算法:
   *   1. 初始化 baseImage 为最低速率(Sixteenth4x4 = 值 6,最不保守)
   *   2. 每个策略在独立的 Full 图像上运行,产出该策略的建议速率
   *   3. baseImage[i] = min(baseImage[i], strategyOutput[i])
   *      — min 值 = 最高速率 = 最保守(每像素着色次数最多)
   *
   * 注意:直接修改 baseImage(先填充为 max,再逐策略取 min)。
   */
  classify(baseImage: VRSImage): VRSImage {
    // 初始化为最不保守(最大值 = 最低着色速率)
    baseImage.data.fill(ShadingRate.Sixteenth4x4);

    for (const [, strategy] of this.strategies) {
      // 每个策略在独立的 Full 图像上运行
      const output = createVRSImage(
        baseImage.width * baseImage.tileSize,
        baseImage.height * baseImage.tileSize,
        baseImage.tileSize,
        ShadingRate.Full,
      );

      strategy(output, baseImage);

      // 取最保守(最高速率 = 最小值)
      for (let i = 0; i < baseImage.data.length; i++) {
        const proposed = output.data[i];
        if (proposed < baseImage.data[i]) {
          baseImage.data[i] = proposed;
        }
      }
    }
    return baseImage;
  }
}

/** VRS 分类策略函数类型。 */
export type VRSStrategy = (
  /** 策略输出的 VRS 图像(策略应写入此图像)。 */
  output: VRSImage,
  /** 前一策略的输出(供参考)。 */
  input: VRSImage,
) => void;

// ── 多分辨率合成器(WebGL2 软件降级)────────────────────────────

/**
 * 多分辨率合成器 —— WebGL2 软件 VRS 降级方案。
 *
 * 原理:WebGL2 不支持硬件 VRS,但可以用多分辨率渲染模拟:
 *   1. Full 速率瓦片:原分辨率渲染
 *   2. 2x2 速率瓦片:1/2 分辨率渲染后上采样
 *   3. 4x4 速率瓦片:1/4 分辨率渲染后上采样
 *
 * 实现:将屏幕分为高/中/低三层,分别渲染到不同分辨率 FBO,
 * 然后按 VRS 图像合成。
 *
 * 注意:本函数是 CPU 参考实现,验证合成逻辑。实际 GPU 实现需多 FBO。
 *
 * 输入:高分辨率颜色 + 低分辨率颜色 + VRS 图像
 * 输出:合成后的颜色缓冲
 */
export function compositeMultiResolution(
  output: Float32Array,
  highResColor: Float32Array,
  lowResColor: Float32Array,
  lowResWidth: number,
  lowResHeight: number,
  vrsImage: VRSImage,
  screenWidth: number,
  screenHeight: number,
): void {
  for (let py = 0; py < screenHeight; py++) {
    for (let px = 0; px < screenWidth; px++) {
      const rate = getPixelRate(vrsImage, px, py);
      const outIdx = (py * screenWidth + px) * 4;

      if (rate === ShadingRate.Full) {
        // 全速率:直接使用高分辨率颜色
        const hiIdx = (py * screenWidth + px) * 4;
        output[outIdx] = highResColor[hiIdx];
        output[outIdx + 1] = highResColor[hiIdx + 1];
        output[outIdx + 2] = highResColor[hiIdx + 2];
        output[outIdx + 3] = highResColor[hiIdx + 3];
      } else {
        // 降低速率:从低分辨率缓冲采样(最近邻)
        const hStep = shadingRateHStep(rate);
        const vStep = shadingRateVStep(rate);
        // 映射到低分辨率坐标
        const lx = Math.floor(px / hStep) * hStep;
        const ly = Math.floor(py / vStep) * vStep;
        // 低分辨率缓冲坐标(假设低分辨率缓冲是高分辨率的 1/hStep × 1/vStep)
        const llx = Math.min(Math.floor(lx / hStep), lowResWidth - 1);
        const lly = Math.min(Math.floor(ly / vStep), lowResHeight - 1);
        const loIdx = (lly * lowResWidth + llx) * 4;
        output[outIdx] = lowResColor[loIdx];
        output[outIdx + 1] = lowResColor[loIdx + 1];
        output[outIdx + 2] = lowResColor[loIdx + 2];
        output[outIdx + 3] = lowResColor[loIdx + 3];
      }
    }
  }
}

// ── 预设 ─────────────────────────────────────────────────────────

/** VRS 预设配置。 */
export const VRS_PRESETS = {
  /**
   * 性能优先 —— 激进降低速率,最大节省。
   * 适合:移动端 / 低端设备 / VR 极限帧率。
   */
  performance: {
    motion: { motionThreshold: 1.5, maxRate: ShadingRate.Sixteenth4x4 },
    depth: { gradientThreshold: 0.002, depthRangeThreshold: 0.02, maxRate: ShadingRate.Eighth2x4 },
    foveated: { innerRadius: 200, outerRadius: 500, maxRate: ShadingRate.Sixteenth4x4 },
    luminance: { varianceThreshold: 0.002, maxRate: ShadingRate.Eighth2x4 },
  },

  /**
   * 平衡 —— 中等降低速率,画质与性能兼顾。
   * 适合:PC 中端 / 主机。
   */
  balanced: {
    motion: { motionThreshold: 2, maxRate: ShadingRate.Quarter2x2 },
    depth: { gradientThreshold: 0.001, depthRangeThreshold: 0.01, maxRate: ShadingRate.Quarter2x2 },
    foveated: { innerRadius: 300, outerRadius: 800, maxRate: ShadingRate.Quarter2x2 },
    luminance: { varianceThreshold: 0.001, maxRate: ShadingRate.Quarter2x2 },
  },

  /**
   * 画质优先 —— 温和降低速率,仅极端区域降低。
   * 适合:PC 高端 / 截图 / 过场动画。
   */
  quality: {
    motion: { motionThreshold: 4, maxRate: ShadingRate.Quarter2x2 },
    depth: { gradientThreshold: 0.0005, depthRangeThreshold: 0.005, maxRate: ShadingRate.Quarter2x2 },
    foveated: { innerRadius: 500, outerRadius: 1200, maxRate: ShadingRate.Quarter2x2 },
    luminance: { varianceThreshold: 0.0005, maxRate: ShadingRate.Quarter2x2 },
  },

  /**
   * VR —— 注视点渲染优先,中心全速率,外围激进降低。
   * 适合:VR 头显(foveated rendering)。
   */
  vr: {
    motion: { motionThreshold: 1, maxRate: ShadingRate.Sixteenth4x4 },
    depth: { gradientThreshold: 0.001, depthRangeThreshold: 0.01, maxRate: ShadingRate.Quarter2x2 },
    foveated: { innerRadius: 150, outerRadius: 400, maxRate: ShadingRate.Sixteenth4x4 },
    luminance: { varianceThreshold: 0.001, maxRate: ShadingRate.Quarter2x2 },
  },
} as const;

/** VRS 预设类型。 */
export type VRSPreset = keyof typeof VRS_PRESETS;

// ── GLSL Chunks ─────────────────────────────────────────────────

/**
 * VRS GLSL 工具块 —— 着色速率枚举常量 + 工具函数。
 *
 * 用于未来 WebGPU / 硬件 VRS 集成。WebGL2 不支持硬件 VRS,
 * 但可用 multi-resolution 渲染模拟(见 compositeMultiResolution)。
 */
export const VRS_GLSL = /* glsl */ `
// ── VRS 常量 ──────────────────────────────────────────────────
// 与 ShadingRate 枚举 1:1 对应
#define VRS_RATE_1X1    0
#define VRS_RATE_1X2    1
#define VRS_RATE_2X1    2
#define VRS_RATE_2X2    3
#define VRS_RATE_2X4    4
#define VRS_RATE_4X2    5
#define VRS_RATE_4X4    6

// ── VRS 图像采样 ──────────────────────────────────────────────
// 从 VRS 纹理(USAMPLER_2D)采样瓦片着色速率
// WebGL2 不原生支持 VRS,此函数仅供 multi-pass 软件模拟参考
uint sampleShadingRate(usampler2D vrsTexture, vec2 uv, vec2 texelSize) {
  // VRS 纹理尺寸 = 屏幕尺寸 / tileSize
  // uv 已是屏幕 UV [0,1],直接采样
  return texture(vrsTexture, uv).r;
}

// ── VRS 覆盖率计算 ────────────────────────────────────────────
float shadingRateCoverage(uint rate) {
  switch (rate) {
    case VRS_RATE_1X1: return 1.0;
    case VRS_RATE_1X2: return 0.5;
    case VRS_RATE_2X1: return 0.5;
    case VRS_RATE_2X2: return 0.25;
    case VRS_RATE_2X4: return 0.125;
    case VRS_RATE_4X2: return 0.125;
    case VRS_RATE_4X4: return 0.0625;
    default: return 1.0;
  }
}
`;

/**
 * VRS 反馈缓冲 GLSL —— 前一帧 VRS 图像反馈写入。
 *
 * 在 multi-pass 软件模拟中,vertex shader 根据 VRS 图像决定输出顶点位置
 * (偏移到低分辨率网格),fragment shader 用较大像素步长着色。
 */
export const VRS_FEEDBACK_GLSL = /* glsl */ `
// ── VRS 反馈写入(软件模拟)────────────────────────────────────
// 在 multi-pass 模拟中,此 shader 写入每瓦片的推荐速率
// 输入:速度缓冲 + 深度缓冲 + 前一帧 VRS 图像
// 输出:新 VRS 图像(R8UI 纹理)

uniform sampler2D uVelocityBuffer;
uniform sampler2D uDepthBuffer;
uniform usampler2D uPrevVRSImage;
uniform vec2 uScreenSize;
uniform float uMotionThreshold;
uniform float uGradientThreshold;
uniform uint uMaxRate;

layout(location = 0) out uint outRate;

void main() {
  ivec2 tileCoord = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(tileCoord) + 0.5) / uScreenSize;

  // 采样速度
  vec2 velocity = texture(uVelocityBuffer, uv).xy;
  float speed = length(velocity);

  // 采样深度梯度(中心差分)
  vec2 texel = 1.0 / uScreenSize;
  float dCenter = texture(uDepthBuffer, uv).r;
  float dRight = texture(uDepthBuffer, uv + vec2(texel.x, 0.0)).r;
  float dUp = texture(uDepthBuffer, uv + vec2(0.0, texel.y)).r;
  float gradient = max(abs(dCenter - dRight), abs(dCenter - dUp));

  // 分类
  uint rate = VRS_RATE_1X1;
  if (speed > uMotionThreshold) {
    rate = uMaxRate;
  } else if (gradient < uGradientThreshold) {
    rate = min(uMaxRate, VRS_RATE_2X2);
  }

  // 与前一帧取保守值(最高速率 = 最小值)
  uint prevRate = texture(uPrevVRSImage, uv).r;
  outRate = min(rate, prevRate);
}
`;
