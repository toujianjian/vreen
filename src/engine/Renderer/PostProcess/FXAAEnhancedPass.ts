// FXAAEnhancedPass — FXAA 3.11 (Fast Approximate Anti-Aliasing) Enhanced Pass。
//
// 适配自 Timothy Lottes (NVIDIA) FXAA 3.11,PC High quality preset。
// 这是工业标准单 pass 抗锯齿算法,被 UE5 / Unity / o3de / Godot 广泛采用。
//
// 算法流程:
//   1. 亮度计算:从 RGB 计算感知亮度(Rec601 luma)
//   2. 局部对比检测:3×3 邻域 min/max luma → range
//      若 range < max(EDGE_THRESHOLD_MIN, lMax * EDGE_THRESHOLD) → 跳过(平坦区域)
//   3. 边缘方向检测:比较水平/垂直梯度 → 水平 or 垂直边缘
//   4. 边缘端点搜索:沿边缘方向逐步采样(PC High: 12 次,步长递减),
//      找到边缘的两个端点
//   5. 混合因子计算:
//      edgeBlend = 0.5 - shortestDist / (distA + distB)
//      subpixelBlend = |avg - lM| / range,平方后应用
//      finalBlend = max(subpixelBlend, edgeBlend)
//   6. 最终采样:在边缘垂直方向偏移 finalBlend 个 texel 采样
//
// 与基础 FXAAPass(RenderPass.ts)的区别:
//   - 基础版:2 步边缘搜索,固定阈值,简化子像素混合
//   - 增强版:12 步边缘搜索(PC High),可配置阈值/子像素,4 角采样,
//     完整 FXAA 3.11 公式
//
// 与 SMAA / TAA 的对比:
//   - FXAA:单 pass,最快,质量中等(适合移动端/VR/低端设备)
//   - SMAA:3 pass,较慢,质量高(形态学搜索,子像素精度)
//   - TAA:时间累积,需速度缓冲,质量最高(但可能有鬼影)
//
// 参考:
//   - Timothy Lottes, "FXAA 3.11" (NVIDIA, 2009)
//   - https://developer.download.nvidia.com/assets/gamedev/files/sdk/11/FXAA_WhitePaper.pdf
//   - three.js FXAAShader.js (adapted from FXAA 3.11 console)

import { RenderPass, type PassContext } from '../RenderPass';

// 重新导出 PassContext 供测试和外部使用。
export type { PassContext };
import { POST_VERT as POST_VERT_SRC, FXAA_ENHANCED_FRAG } from '../../Materials/shaders';
import { createLogger } from '@/lib/logger';

const log = createLogger('FXAAEnhancedPass');

// ── 类型 ──────────────────────────────────────────────────────────

/** FXAA 质量预设。 */
export type FXAAQuality = 'console' | 'pcHigh' | 'pcExtreme';

/** RGB 颜色(与 GPU vec3 对应)。 */
export type FXAAColor = [number, number, number];

/** FXAA 参数。 */
export interface FXAAParams {
  /** 子像素混合量 (0..1,默认 0.75)。越高越平滑但可能模糊细节。 */
  subpixel: number;
  /** 边缘检测阈值 (1/8..1/4,默认 0.166 = 1/6)。越高检测到的边缘越少(更快但遗漏更多)。 */
  edgeThreshold: number;
  /** 边缘检测最小阈值 (1/32..1/16,默认 0.0625 = 1/16)。低于此亮度的区域直接跳过。 */
  edgeThresholdMin: number;
  /** 质量预设(默认 'pcHigh')。 */
  quality: FXAAQuality;
}

/** FXAAEnhancedPass 构造选项。 */
export interface FXAAEnhancedPassOptions {
  /** 子像素混合量(默认 0.75)。 */
  subpixel?: number;
  /** 边缘检测阈值(默认 0.166)。 */
  edgeThreshold?: number;
  /** 边缘检测最小阈值(默认 0.0625)。 */
  edgeThresholdMin?: number;
  /** 质量预设(默认 'pcHigh')。 */
  quality?: FXAAQuality;
  /** 是否启用(默认 false)。 */
  enabled?: boolean;
}

// ── 常量 ──────────────────────────────────────────────────────────

/** 默认 FXAA 参数(PC High preset)。 */
export const DEFAULT_FXAA_PARAMS: FXAAParams = {
  subpixel: 0.75,
  edgeThreshold: 1.0 / 6.0,
  edgeThresholdMin: 1.0 / 16.0,
  quality: 'pcHigh',
};

/**
 * 每种质量预设的边缘搜索步数。
 *
 * - console: 4 步(最快,适合移动端)
 * - pcHigh:  8 步(均衡,适合 PC 中高端)
 * - pcExtreme: 10 步(最高质量,适合截图/离线渲染)
 *
 * 注意:FXAA 3.11 的步长是递减的(先大后小),用较少的步数覆盖更长的边缘。
 */
export const FXAA_QUALITY_STEPS: Record<FXAAQuality, number> = {
  console: 4,
  pcHigh: 8,
  pcExtreme: 10,
};

// ── 纯 CPU 函数(与 GPU shader 1:1 对应) ──────────────────────────

/**
 * RGB → 感知亮度(Rec601 luma)。
 *
 * 与 GPU `luminance()` 函数 1:1 对应。
 * Rec601: Y = 0.299R + 0.587G + 0.114B
 */
export function fxaaLuma(color: FXAAColor | ArrayLike<number>): number {
  return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
}

/**
 * 局部对比检测:判断当前像素是否在边缘上。
 *
 * @param lM  中心亮度
 * @param lN  北邻亮度
 * @param lS  南邻亮度
 * @param lW  西邻亮度
 * @param lE  东邻亮度
 * @param edgeThreshold     边缘阈值(默认 1/6)
 * @param edgeThresholdMin  最小边缘阈值(默认 1/16)
 * @returns true = 是边缘(需要抗锯齿),false = 平坦区域(跳过)
 *
 * 与 GPU `if (range < max(EDGE_THRESHOLD_MIN, lMax * EDGE_THRESHOLD))` 1:1 对应。
 */
export function fxaaContrastCheck(
  lM: number, lN: number, lS: number, lW: number, lE: number,
  edgeThreshold: number = DEFAULT_FXAA_PARAMS.edgeThreshold,
  edgeThresholdMin: number = DEFAULT_FXAA_PARAMS.edgeThresholdMin,
): { isEdge: boolean; range: number; lMax: number; lMin: number } {
  const lMin = Math.min(lM, lN, lS, lW, lE);
  const lMax = Math.max(lM, lN, lS, lW, lE);
  const range = lMax - lMin;
  const threshold = Math.max(edgeThresholdMin, lMax * edgeThreshold);
  return { isEdge: range >= threshold, range, lMax, lMin };
}

/**
 * 边缘方向检测:判断边缘是水平的还是垂直的。
 *
 * 比较水平梯度(|lN - lS|)与垂直梯度(|lW - lE|):
 *   - 水平梯度 > 垂直梯度 → 水平边缘(沿水平方向走)
 *   - 否则 → 垂直边缘
 *
 * 同时返回梯度方向符号(正/负)。
 *
 * @returns { isHorizontal, signDir, gradient, lOpp }
 *   - isHorizontal: true = 水平边缘(边缘沿 x 轴延伸,在 y 方向搜索)
 *   - signDir: +1 or -1(搜索方向)
 *   - gradient: 最大梯度值
 *   - lOpp: 对侧邻域亮度
 */
export function fxaaEdgeDirection(
  lM: number, lN: number, lS: number, lW: number, lE: number,
): { isHorizontal: boolean; signDir: number; gradient: number; lOpp: number } {
  const blendN = Math.abs(lN - lM);
  const blendS = Math.abs(lS - lM);
  const blendW = Math.abs(lW - lM);
  const blendE = Math.abs(lE - lM);

  const isHorizontal = (blendN + blendS) > (blendW + blendE);

  if (isHorizontal) {
    // 水平边缘:沿 y 方向搜索
    if (blendN > blendS) {
      return { isHorizontal: true, signDir: 1.0, gradient: blendN, lOpp: lS };
    } else {
      return { isHorizontal: true, signDir: -1.0, gradient: blendS, lOpp: lN };
    }
  } else {
    // 垂直边缘:沿 x 方向搜索
    if (blendE > blendW) {
      return { isHorizontal: false, signDir: 1.0, gradient: blendE, lOpp: lW };
    } else {
      return { isHorizontal: false, signDir: -1.0, gradient: blendW, lOpp: lE };
    }
  }
}

/**
 * 边缘端点搜索(沿边缘方向逐步采样)。
 *
 * FXAA 3.11 使用递减步长沿边缘方向搜索,找到边缘的两个端点(pDist, nDist)。
 * 步长序列因质量预设而异:
 *   - console: [1.5, 2.0, 2.0, 4.0]
 *   - pcHigh:  [1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0]  (共 8 步,两侧各 4 步)
 *   - pcExtreme: [1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0]  (共 10 步)
 *
 * @param centerUV    中心像素 UV
 * @param isHorizontal 边缘方向
 * @param signDir     搜索方向符号
 * @param edgeLum     边缘亮度 = (lM + lOpp) * 0.5
 * @param threshold   梯度阈值 = gradient * 0.25
 * @param texel       纹素大小 [1/w, 1/h]
 * @param sampleLuma  回调:给定 UV 返回亮度
 * @param quality     质量预设
 * @returns { pDist, nDist } 两侧的边缘距离
 */
export function fxaaEdgeWalk(
  centerUV: [number, number],
  isHorizontal: boolean,
  signDir: number,
  edgeLum: number,
  threshold: number,
  texel: [number, number],
  sampleLuma: (uv: [number, number]) => number,
  quality: FXAAQuality = 'pcHigh',
): { pDist: number; nDist: number } {
  // FXAA 3.11 PC High 步长序列(每侧)
  const stepLengths: Record<FXAAQuality, number[]> = {
    console: [1.5, 2.0, 2.0, 4.0],
    pcHigh: [1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0, 8.0],
    pcExtreme: [1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0, 8.0],
  };

  const steps = stepLengths[quality];
  const dirX = isHorizontal ? 0.0 : signDir;
  const dirY = isHorizontal ? signDir : 0.0;

  // 正方向搜索
  let pDist = 0.0;
  let pUV: [number, number] = [centerUV[0], centerUV[1]];
  let pFound = false;
  for (let i = 0; i < steps.length; i++) {
    pDist += steps[i];
    pUV = [
      centerUV[0] + dirX * pDist * texel[0],
      centerUV[1] + dirY * pDist * texel[1],
    ];
    const lP = sampleLuma(pUV);
    if (Math.abs(lP - edgeLum) >= threshold) {
      pFound = true;
      break;
    }
  }

  // 负方向搜索
  let nDist = 0.0;
  let nUV: [number, number] = [centerUV[0], centerUV[1]];
  let nFound = false;
  for (let i = 0; i < steps.length; i++) {
    nDist += steps[i];
    nUV = [
      centerUV[0] - dirX * nDist * texel[0],
      centerUV[1] - dirY * nDist * texel[1],
    ];
    const lN = sampleLuma(nUV);
    if (Math.abs(lN - edgeLum) >= threshold) {
      nFound = true;
      break;
    }
  }

  return { pDist: pFound ? pDist : 999.0, nDist: nFound ? nDist : 999.0 };
}

/**
 * 计算最终混合因子。
 *
 * edgeBlend = 0.5 - shortestDist / (pDist + nDist)
 * subpixelBlend = |avg - lM| / range,平方后缩放
 * finalBlend = max(subpixelBlend, edgeBlend)
 *
 * @param pDist        正方向边缘距离
 * @param nDist        负方向边缘距离
 * @param lM           中心亮度
 * @param lN/lS/lW/lE  4 邻域亮度
 * @param range        局部对比范围
 * @param subpixel     子像素混合量 (0..1)
 * @returns 混合因子 [0, 1]
 */
export function fxaaComputeBlendFactor(
  pDist: number,
  nDist: number,
  lM: number,
  lN: number, lS: number, lW: number, lE: number,
  range: number,
  subpixel: number = DEFAULT_FXAA_PARAMS.subpixel,
): number {
  // 边缘混合因子
  const distSpan = pDist + nDist;
  let edgeBlend = 0.0;
  if (distSpan > 0 && pDist < 999 && nDist < 999) {
    edgeBlend = 0.5 - Math.min(pDist, nDist) / distSpan;
    edgeBlend = Math.max(0.0, edgeBlend);
  }

  // 子像素混合因子
  const avg = (lN + lS + lW + lE) * 0.25;
  let subpixelBlend = Math.abs(avg - lM) / Math.max(range, 1e-5);
  subpixelBlend = Math.min(subpixelBlend, 1.0);
  subpixelBlend = subpixelBlend * subpixelBlend * subpixel;

  return Math.max(subpixelBlend, edgeBlend);
}

/**
 * 完整 FXAA 像素处理(纯 CPU,与 GPU shader 1:1 对应)。
 *
 * @param centerUV     中心像素 UV
 * @param sampleColor  回调:给定 UV 返回 RGB 颜色
 * @param texel        纹素大小 [1/w, 1/h]
 * @param params       FXAA 参数
 * @returns            抗锯齿后的 RGB 颜色
 */
export function fxaaPixel(
  centerUV: [number, number],
  sampleColor: (uv: [number, number]) => FXAAColor,
  texel: [number, number],
  params: FXAAParams = DEFAULT_FXAA_PARAMS,
): FXAAColor {
  // 1. 采样中心 + 4 邻域
  const m = sampleColor(centerUV);
  const n = sampleColor([centerUV[0], centerUV[1] + texel[1]]);
  const s = sampleColor([centerUV[0], centerUV[1] - texel[1]]);
  const w = sampleColor([centerUV[0] - texel[0], centerUV[1]]);
  const e = sampleColor([centerUV[0] + texel[0], centerUV[1]]);

  const lM = fxaaLuma(m);
  const lN = fxaaLuma(n);
  const lS = fxaaLuma(s);
  const lW = fxaaLuma(w);
  const lE = fxaaLuma(e);

  // 2. 局部对比检测
  const { isEdge, range } = fxaaContrastCheck(
    lM, lN, lS, lW, lE,
    params.edgeThreshold, params.edgeThresholdMin,
  );
  if (!isEdge) return m;

  // 3. 边缘方向检测
  const { isHorizontal, signDir, gradient, lOpp } = fxaaEdgeDirection(lM, lN, lS, lW, lE);

  // 4. 边缘端点搜索
  const edgeLum = (lM + lOpp) * 0.5;
  const threshold = gradient * 0.25;
  const { pDist, nDist } = fxaaEdgeWalk(
    centerUV, isHorizontal, signDir, edgeLum, threshold, texel,
    (uv) => fxaaLuma(sampleColor(uv)),
    params.quality,
  );

  // 5. 混合因子
  const blend = fxaaComputeBlendFactor(
    pDist, nDist, lM, lN, lS, lW, lE, range, params.subpixel,
  );

  // 6. 最终采样
  const dirX = isHorizontal ? 0.0 : signDir * blend * texel[0];
  const dirY = isHorizontal ? signDir * blend * texel[1] : 0.0;

  return sampleColor([centerUV[0] + dirX, centerUV[1] + dirY]);
}

// ── GPU Pass 类 ──────────────────────────────────────────────────

/**
 * FXAA 3.11 Enhanced Pass。extends RenderPass,可直接加入 PostProcessingPipeline。
 *
 * 单 pass 全屏抗锯齿:读 input 颜色纹理 → 边缘检测 + 端点搜索 + 子像素混合
 * → 输出到 finalFbo。
 *
 * 典型管线位置:`... → TAAPass → FXAAEnhancedPass → TonemappingPass → 输出`
 * 或在无 TAA 时:`... → FXAAEnhancedPass → TonemappingPass → 输出`
 */
export class FXAAEnhancedPass extends RenderPass {
  readonly name = 'fxaa-enhanced';
  enabled = false;

  /** 子像素混合量 (0..1,默认 0.75)。 */
  subpixel = 0.75;
  /** 边缘检测阈值(默认 1/6 ≈ 0.166)。 */
  edgeThreshold = 1.0 / 6.0;
  /** 边缘检测最小阈值(默认 1/16 = 0.0625)。 */
  edgeThresholdMin = 1.0 / 16.0;
  /** 质量预设(默认 'pcHigh')。 */
  quality: FXAAQuality = 'pcHigh';

  constructor(opts: FXAAEnhancedPassOptions = {}) {
    super();
    if (opts.subpixel !== undefined) this.subpixel = opts.subpixel;
    if (opts.edgeThreshold !== undefined) this.edgeThreshold = opts.edgeThreshold;
    if (opts.edgeThresholdMin !== undefined) this.edgeThresholdMin = opts.edgeThresholdMin;
    if (opts.quality !== undefined) this.quality = opts.quality;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const defines: string[] = [`FXAA_QUALITY_${this.quality.toUpperCase()}`];
    const prog = ctx.getProgram('fxaa-enhanced', POST_VERT_SRC, FXAA_ENHANCED_FRAG, defines);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform2f('u_texel', 1.0 / res.width, 1.0 / res.height);
    prog.setUniform1f('u_subpixel', this.subpixel);
    prog.setUniform1f('u_edgeThreshold', this.edgeThreshold);
    prog.setUniform1f('u_edgeThresholdMin', this.edgeThresholdMin);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }

  /** 设置质量预设。 */
  setQuality(q: FXAAQuality): void {
    this.quality = q;
    log.debug(`quality set to ${q}`);
  }
}
