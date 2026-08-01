// ParallaxBarrierEffect — 视差屏障立体合成 (parallax barrier stereo)。
//
// 适配 three.js `examples/jsm/effects/ParallaxBarrierEffect.js` 并重构为 CPU 侧合成。
// 与 StereoCamera / AnaglyphEffect 互补:Anaglyph 用颜色分离,ParallaxBarrier 用
// 空间分离(隔行/隔列交错左右眼画面)。
//
// 原理:
//   - 水平隔行 (horizontal interlace):偶数行 = 左眼,奇数行 = 右眼
//   - 垂直隔列 (vertical interlace):偶数列 = 左眼,奇数列 = 右眼
//   - 棋盘格 (checkerboard):(row+col) 偶数 = 左眼,奇数 = 右眼
//   - 配合物理视差屏障屏幕(如 Nintendo 3DS)或柱状透镜屏,每只眼只看到对应行/列
//
// 用途:
//   - 裸眼 3D 显示器(视差屏障 / 柱状透镜)
//   - 3DS 风格掌机
//   - 自动立体显示
//   - 立体照片预览
//
// 不变量:
//   - 左右眼图像尺寸必须相同;
//   - 输出尺寸 = 输入尺寸;
//   - 每个像素严格来自左眼或右眼(无混合)。
//
// 参考:
//   - three.js examples/jsm/effects/ParallaxBarrierEffect.js
//   - H. Urey et al. "State of the Art in Stereoscopic and Autostereoscopic Displays"

/** 交错模式。 */
export type InterlaceMode = 'horizontal' | 'vertical' | 'checkerboard';

/** ParallaxBarrierEffect 配置。 */
export interface ParallaxBarrierOptions {
  /** 交错模式。默认 horizontal。 */
  mode?: InterlaceMode;
  /** 是否反转左右眼顺序(默认 false:偶数=左眼)。 */
  swapEyes?: boolean;
}

/** 图像数据(与 Uint8ClampedArray 兼容)。 */
export interface PBImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * 视差屏障立体合成器。
 *
 * 输入左右眼 RGBA 图像,输出隔行/隔列交错的 RGBA 图像。
 * 不依赖 WebGL,可在 Node/无头环境测试。
 */
export class ParallaxBarrierEffect {
  private _mode: InterlaceMode;
  private _swapEyes: boolean;

  constructor(opts: ParallaxBarrierOptions = {}) {
    this._mode = opts.mode ?? 'horizontal';
    this._swapEyes = opts.swapEyes ?? false;
  }

  get mode(): InterlaceMode {
    return this._mode;
  }

  get swapEyes(): boolean {
    return this._swapEyes;
  }

  setMode(mode: InterlaceMode): this {
    this._mode = mode;
    return this;
  }

  setSwapEyes(enabled: boolean): this {
    this._swapEyes = enabled;
    return this;
  }

  /**
   * 合成左右眼图像为隔行交错立体图。
   *
   * @param left 左眼 RGBA 图像。
   * @param right 右眼 RGBA 图像。
   * @returns 交错的 RGBA 图像(新分配)。
   */
  composite(left: PBImageData, right: PBImageData): PBImageData {
    if (left.width !== right.width || left.height !== right.height) {
      throw new Error(
        `ParallaxBarrierEffect: left/right size mismatch ` +
        `(${left.width}x${left.height} vs ${right.width}x${right.height})`,
      );
    }

    const w = left.width;
    const h = left.height;
    const len = w * h * 4;
    const out = new Uint8ClampedArray(len);

    const ld = left.data;
    const rd = right.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pixelIdx = (y * w + x) * 4;
        const useLeft = this._isLeftPixel(x, y);
        const src = useLeft ? ld : rd;

        out[pixelIdx] = src[pixelIdx];
        out[pixelIdx + 1] = src[pixelIdx + 1];
        out[pixelIdx + 2] = src[pixelIdx + 2];
        out[pixelIdx + 3] = src[pixelIdx + 3];
      }
    }

    return { data: out, width: w, height: h };
  }

  /**
   * 判断像素 (x, y) 是否取左眼数据。
   */
  private _isLeftPixel(x: number, y: number): boolean {
    let isEven: boolean;
    switch (this._mode) {
      case 'horizontal':
        isEven = y % 2 === 0;
        break;
      case 'vertical':
        isEven = x % 2 === 0;
        break;
      case 'checkerboard':
        isEven = (x + y) % 2 === 0;
        break;
      default:
        isEven = y % 2 === 0;
    }
    // swapEyes 时反转
    return this._swapEyes ? !isEven : isEven;
  }

  /**
   * 生成掩码图(调试用):左眼=白色,右眼=黑色。
   * 可用于验证交错模式是否正确。
   */
  generateMask(width: number, height: number): PBImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const isLeft = this._isLeftPixel(x, y);
        const val = isLeft ? 255 : 0;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }
    return { data, width, height };
  }
}
