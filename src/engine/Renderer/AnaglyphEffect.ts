// AnaglyphEffect — 红蓝立体合成 (anaglyph stereo compositing)。
//
// 适配 three.js `examples/jsm/effects/AnaglyphEffect.js` 并重构为 CPU 侧合成。
// 与 StereoCamera 互补:StereoCamera 生成左右眼图像,AnaglyphEffect 把它们
// 合成成一张红蓝立体图(戴红蓝眼镜观看)。
//
// 原理:
//   - 左眼通过红色滤镜(只看红色通道)
//   - 右眼通过蓝/青色滤镜(只看绿+蓝通道)
//   - 合成:out.R = left.R, out.G = right.G, out.B = right.B
//   - 戴红蓝眼镜:左眼红镜片只看到左眼画面,右眼蓝镜片只看到右眼画面
//
// 色彩矩阵 (color matrix):
//   [R']   [Lr  0   0 ] [Lr Lg Lb]
//   [G'] = [ 0  Rg  0 ] [Rr Rg Rb]
//   [B']   [ 0   0  Rb] [Lr Lg Lb]
//   简化:R' = Lr, G' = Rg, B' = Rb
//
// 用途:
//   - 低成本 3D 显示(只需红蓝眼镜,不需要偏振屏幕或 VR 头显)
//   - 3D 电影/图片快速预览
//   - 立体效果调试
//
// 不变量:
//   - 左右眼图像尺寸必须相同;
//   - 输出尺寸 = 输入尺寸;
//   - alpha 通道取左右眼的平均值(或左眼优先)。
//
// 参考:
//   - three.js examples/jsm/effects/AnaglyphEffect.js
//   - Eric Dubois "A Survey of 2D-to-3D Conversion"

/** Anaglyph 色彩模式。 */
export type AnaglyphColorMode = 'redCyan' | 'redGreen' | 'redBlue' | 'amberBlue';

/** AnaglyphEffect 配置。 */
export interface AnaglyphOptions {
  /** 色彩模式。默认 redCyan。 */
  colorMode?: AnaglyphColorMode;
  /** 是否保留灰度信息(把每只眼的颜色转灰度后再着色)。默认 false。 */
  grayscale?: boolean;
  /** gamma 校正值(0 = 不校正)。默认 0。 */
  gamma?: number;
}

/** 图像数据(与 Uint8ClampedArray 兼容)。 */
export interface ImageData4 {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * 红蓝立体合成器。
 *
 * 输入左右眼 RGBA 图像,输出红蓝立体 RGBA 图像。
 * 不依赖 WebGL,可在 Node/无头环境测试。
 */
export class AnaglyphEffect {
  private _colorMode: AnaglyphColorMode;
  private _grayscale: boolean;
  private _gamma: number;

  constructor(opts: AnaglyphOptions = {}) {
    this._colorMode = opts.colorMode ?? 'redCyan';
    this._grayscale = opts.grayscale ?? false;
    this._gamma = opts.gamma ?? 0;
  }

  get colorMode(): AnaglyphColorMode {
    return this._colorMode;
  }

  get grayscale(): boolean {
    return this._grayscale;
  }

  setColorMode(mode: AnaglyphColorMode): this {
    this._colorMode = mode;
    return this;
  }

  setGrayscale(enabled: boolean): this {
    this._grayscale = enabled;
    return this;
  }

  /**
   * 合成左右眼图像为红蓝立体图。
   *
   * @param left 左眼 RGBA 图像。
   * @param right 右眼 RGBA 图像。
   * @returns 合成的 RGBA 图像(新分配)。
   */
  composite(left: ImageData4, right: ImageData4): ImageData4 {
    if (left.width !== right.width || left.height !== right.height) {
      throw new Error(
        `AnaglyphEffect: left/right size mismatch ` +
        `(${left.width}x${left.height} vs ${right.width}x${right.height})`,
      );
    }

    const w = left.width;
    const h = left.height;
    const len = w * h * 4;
    const out = new Uint8ClampedArray(len);

    const ld = left.data;
    const rd = right.data;

    // 根据色彩模式确定通道映射
    const mapping = this._getChannelMapping();

    for (let i = 0; i < len; i += 4) {
      const lR = ld[i];
      const lG = ld[i + 1];
      const lB = ld[i + 2];
      const lA = ld[i + 3];

      const rR = rd[i];
      const rG = rd[i + 1];
      const rB = rd[i + 2];
      const rA = rd[i + 3];

      // 灰度转换(可选):把每只眼转为灰度后再着色
      let lValR: number, lValG: number, lValB: number;
      let rValR: number, rValG: number, rValB: number;

      if (this._grayscale) {
        const lGray = 0.299 * lR + 0.587 * lG + 0.114 * lB;
        const rGray = 0.299 * rR + 0.587 * rG + 0.114 * rB;
        lValR = lValG = lValB = lGray;
        rValR = rValG = rValB = rGray;
      } else {
        lValR = lR; lValG = lG; lValB = lB;
        rValR = rR; rValG = rG; rValB = rB;
      }

      // gamma 校正
      if (this._gamma > 0) {
        lValR = this._applyGamma(lValR, this._gamma);
        lValG = this._applyGamma(lValG, this._gamma);
        lValB = this._applyGamma(lValB, this._gamma);
        rValR = this._applyGamma(rValR, this._gamma);
        rValG = this._applyGamma(rValG, this._gamma);
        rValB = this._applyGamma(rValB, this._gamma);
      }

      // 通道映射:每个输出通道从左眼或右眼的对应通道取值
      out[i] = mapping.leftToR ? lValR : mapping.rightToR ? rValR : 0;
      out[i + 1] = mapping.leftToG ? lValG : mapping.rightToG ? rValG : 0;
      out[i + 2] = mapping.leftToB ? lValB : mapping.rightToB ? rValB : 0;
      out[i + 3] = (lA + rA) / 2;
    }

    return { data: out, width: w, height: h };
  }

  /**
   * 获取色彩模式对应的通道映射。
   * 每个输出通道(R/G/B)从左眼或右眼取值。
   */
  private _getChannelMapping(): {
    leftToR: boolean; rightToR: boolean;
    leftToG: boolean; rightToG: boolean;
    leftToB: boolean; rightToB: boolean;
  } {
    switch (this._colorMode) {
      case 'redCyan':
        // 左眼→红,右眼→青(绿+蓝)
        return { leftToR: true, rightToR: false, leftToG: false, rightToG: true, leftToB: false, rightToB: true };
      case 'redGreen':
        // 左眼→红,右眼→绿
        return { leftToR: true, rightToR: false, leftToG: false, rightToG: true, leftToB: false, rightToB: false };
      case 'redBlue':
        // 左眼→红,右眼→蓝
        return { leftToR: true, rightToR: false, leftToG: false, rightToG: false, leftToB: false, rightToB: true };
      case 'amberBlue':
        // 左眼→琥珀色(红+绿),右眼→蓝
        return { leftToR: true, rightToR: false, leftToG: true, rightToG: false, leftToB: false, rightToB: true };
      default:
        return { leftToR: true, rightToR: false, leftToG: false, rightToG: true, leftToB: false, rightToB: true };
    }
  }

  /** 应用 gamma 校正。 */
  private _applyGamma(value: number, gamma: number): number {
    return 255 * Math.pow(value / 255, gamma);
  }
}

/**
 * 创建纯色测试图像。
 * @param width 宽度。
 * @param height 高度。
 * @param r 红色 0-255。
 * @param g 绿色 0-255。
 * @param b 蓝色 0-255。
 */
export function createSolidImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): ImageData4 {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width, height };
}
