// OutlinePass — 物体描边/轮廓高亮 (CPU 侧合成)。
//
// 适配 three.js `examples/jsm/postprocessing/OutlinePass.js` 并简化为 CPU 路径。
// 为场景中被选中的物体添加发光描边,常用于编辑器/检视器中高亮当前选中对象。
//
// 算法 (与 three.js OutlinePass 同构):
//   1. 选中物体渲染到 mask 缓冲 (白色 = 选中,黑色 = 未选中);
//   2. 对 mask 做可分离高斯模糊 (水平 + 垂直),得到 "扩散" 版本;
//   3. 描边 = 扩散 mask - 原 mask (扩散到选中区域外部的像素即为轮廓);
//   4. 把描边颜色叠加到场景像素: output = scene * (1 - edgeAlpha) + edgeColor * edgeAlpha。
//
// CPU 侧实现,不依赖 WebGL,可在 Node/无头环境运行 (与 LensFlare/OIT 同构)。
// 适合: 离线截图、测试验证、检视器 UI 叠加。
//
// 不变量:
//   - render 不修改输入 data/mask,返回新 Uint8ClampedArray;
//   - mask 尺寸须与 scene 尺寸一致 (width*height*4);
//   - mask 单通道 (每像素 1 字节, 0=未选中, 255=选中);
//   - enabled=false 时返回输入副本。
//
// 参考:
//   - three.js examples/jsm/postprocessing/OutlinePass.js
//   - o3de Atom EntitySelectionMaskPass

/** 描边选项。 */
export interface OutlineOptions {
  /** 描边颜色 [r, g, b] (0..255)。默认青色 [0, 255, 255]。 */
  edgeColor?: [number, number, number];
  /** 描边不透明度 (0..1)。默认 1.0。 */
  edgeStrength?: number;
  /** 高斯模糊半径 (像素)。默认 4。值越大描边越粗。 */
  blurRadius?: number;
  /** 高斯标准差 (像素)。默认 blurRadius / 2。 */
  blurSigma?: number;
  /** 是否启用。默认 true。 */
  enabled?: boolean;
  /** 描边发光强度 (0..1+,叠加到边缘像素)。默认 0.0 (不发光)。 */
  glow?: number;
}

/** 场景 + mask 输入。 */
export interface OutlineInput {
  /** 场景像素数据 (RGBA, width*height*4)。 */
  data: Uint8ClampedArray;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
  /** 选中 mask (单通道, width*height, 0=未选中, 255=选中)。 */
  mask: Uint8ClampedArray;
}

/**
 * 物体描边 Pass (CPU 侧)。
 *
 * ```ts
 * const pass = new OutlinePass({ edgeColor: [0, 255, 255], blurRadius: 4 });
 * const out = pass.render({ data: scenePixels, width: 1280, height: 720, mask: selectionMask });
 * // out 是带有青色描边的新 Uint8ClampedArray
 * ```
 */
export class OutlinePass {
  /** 描边颜色 [r, g, b]。 */
  edgeColor: [number, number, number];
  /** 描边不透明度。 */
  edgeStrength: number;
  /** 模糊半径 (像素)。 */
  blurRadius: number;
  /** 高斯标准差。 */
  blurSigma: number;
  /** 是否启用。 */
  enabled: boolean;
  /** 发光强度。 */
  glow: number;

  constructor(opts: OutlineOptions = {}) {
    this.edgeColor = opts.edgeColor ?? [0, 255, 255];
    this.edgeStrength = opts.edgeStrength ?? 1.0;
    this.blurRadius = Math.max(0, Math.floor(opts.blurRadius ?? 4));
    this.blurSigma = opts.blurSigma ?? this.blurRadius / 2;
    this.enabled = opts.enabled ?? true;
    this.glow = opts.glow ?? 0.0;
  }

  /**
   * 对场景应用描边效果。
   * @returns 新的 Uint8ClampedArray (RGBA),含描边叠加。
   */
  render(input: OutlineInput): Uint8ClampedArray {
    const { data, width, height, mask } = input;

    if (!this.enabled || this.blurRadius === 0) {
      return data.slice();
    }

    // ── 1. 对 mask 做可分离高斯模糊 ──
    const blurred = this._gaussianBlur(mask, width, height, this.blurRadius, this.blurSigma);

    // ── 2. 描边 = blurred - mask (扩散到选中区域外部的像素) ──
    const edge = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const diff = blurred[i] - mask[i];
      edge[i] = Math.max(0, Math.min(255, diff));
    }

    // ── 3. 叠加描边到场景 ──
    const output = data.slice();
    const [er, eg, eb] = this.edgeColor;
    const strength = this.edgeStrength;
    const glow = this.glow;

    for (let i = 0; i < width * height; i++) {
      const edgeAlpha = (edge[i] / 255) * strength;
      if (edgeAlpha < 0.001) continue;

      const pi = i * 4;
      // alpha blending: out = scene * (1 - a) + edgeColor * a
      const invA = 1 - edgeAlpha;
      output[pi] = data[pi] * invA + er * edgeAlpha;
      output[pi + 1] = data[pi + 1] * invA + eg * edgeAlpha;
      output[pi + 2] = data[pi + 2] * invA + eb * edgeAlpha;

      // 发光: 叠加 edgeColor * glow * edgeAlpha
      if (glow > 0) {
        const glowContrib = glow * edgeAlpha;
        output[pi] = Math.min(255, output[pi] + er * glowContrib);
        output[pi + 1] = Math.min(255, output[pi + 1] + eg * glowContrib);
        output[pi + 2] = Math.min(255, output[pi + 2] + eb * glowContrib);
      }

      // alpha 通道保持不变
    }

    return output;
  }

  /**
   * 可分离高斯模糊 (水平 → 垂直)。
   * 输入/输出为单通道 Float32Array (值域 0..255)。
   */
  private _gaussianBlur(
    src: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number,
    sigma: number,
  ): Float32Array {
    if (radius <= 0 || sigma <= 0) {
      return Float32Array.from(src);
    }

    // 构建高斯核
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    const twoSigmaSq = 2 * sigma * sigma;
    let kernelSum = 0;
    for (let i = -radius; i <= radius; i++) {
      const w = Math.exp(-(i * i) / twoSigmaSq);
      kernel[i + radius] = w;
      kernelSum += w;
    }
    // 归一化
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= kernelSum;
    }

    // 水平 pass: src → tempH
    const tempH = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = Math.max(0, Math.min(width - 1, x + k));
          sum += src[rowOffset + sx] * kernel[k + radius];
        }
        tempH[rowOffset + x] = sum;
      }
    }

    // 垂直 pass: tempH → output
    const output = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = Math.max(0, Math.min(height - 1, y + k));
          sum += tempH[sy * width + x] * kernel[k + radius];
        }
        output[y * width + x] = sum;
      }
    }

    return output;
  }

  /** 设置描边颜色。 */
  setEdgeColor(r: number, g: number, b: number): this {
    this.edgeColor = [r, g, b];
    return this;
  }

  /** 设置模糊半径。 */
  setBlurRadius(radius: number): this {
    this.blurRadius = Math.max(0, Math.floor(radius));
    this.blurSigma = this.blurRadius / 2;
    return this;
  }
}
