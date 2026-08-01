// FlakesTexture — 程序化金属薄片纹理 (procedural metallic flakes texture)。
//
// 适配 three.js `examples/jsm/textures/FlakesTexture.js` 并重构为纯 CPU 生成器。
// 生成随机分布的金属薄片图案,用于:
//   - 车漆 (car paint) 粗糙度/法线贴图
//   - 金属烤漆 (metallic lacquer) 闪光效果
//   - 珠光漆 (pearlescent paint)
//   - 全息防伪 (holographic security) 纹理
//
// 原理:
//   - 在给定尺寸的纹理上随机撒布 N 个圆形薄片
//   - 每个薄片有随机位置、大小、亮度
//   - 薄片之间可能重叠(模拟真实金属粉末)
//   - 输出为 RGBA Uint8ClampedArray(可直接上传为纹理)
//
// 不变量:
//   - 输出尺寸 = size × size;
//   - 每个像素 RGBA 全通道;薄片区域亮度高,背景亮度低;
//   - 使用确定性 RNG(给定 seed 产生相同结果);
//   - 纹理可平铺(薄片在边缘环绕)。
//
// 参考:
//   - three.js examples/jsm/textures/FlakesTexture.js
//   - Autodesk "Metallic Paint Shader" (Car Paint Material)
//   - o3de Atom MetallicPaintMaterial

/** FlakesTexture 生成选项。 */
export interface FlakesTextureOptions {
  /** 纹理边长(像素)。默认 512。 */
  size?: number;
  /** 薄片数量。默认 200。 */
  flakeCount?: number;
  /** 薄片最小半径(像素)。默认 1。 */
  minRadius?: number;
  /** 薄片最大半径(像素)。默认 3。 */
  maxRadius?: number;
  /** 背景灰度(0-255)。默认 0(纯黑)。 */
  background?: number;
  /** 薄片亮度最小值(0-255)。默认 180。 */
  minBrightness?: number;
  /** 薄片亮度最大值(0-255)。默认 255。 */
  maxBrightness?: number;
  /** 随机种子。默认 0。 */
  seed?: number;
}

/** 生成结果。 */
export interface FlakesTextureResult {
  /** RGBA 像素数据。 */
  data: Uint8ClampedArray;
  /** 纹理宽度。 */
  width: number;
  /** 纹理高度。 */
  height: number;
}

/**
 * 简单的确定性 PRNG (mulberry32)。
 * 给定相同种子产生相同序列。
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 程序化金属薄片纹理生成器。
 *
 * 生成随机分布的金属薄片图案,用于车漆/金属漆效果。
 * 不依赖 WebGL,可在 Node/无头环境运行。
 */
export class FlakesTexture {
  /** 生成薄片纹理。 */
  static generate(opts: FlakesTextureOptions = {}): FlakesTextureResult {
    const size = Math.max(1, Math.floor(opts.size ?? 512));
    const flakeCount = Math.max(0, Math.floor(opts.flakeCount ?? 200));
    const minRadius = Math.max(0.5, opts.minRadius ?? 1);
    const maxRadius = Math.max(minRadius, opts.maxRadius ?? 3);
    const background = Math.max(0, Math.min(255, Math.floor(opts.background ?? 0)));
    const minBrightness = Math.max(0, Math.min(255, Math.floor(opts.minBrightness ?? 180)));
    const maxBrightness = Math.max(minBrightness, Math.min(255, Math.floor(opts.maxBrightness ?? 255)));
    const seed = opts.seed ?? 0;

    const data = new Uint8ClampedArray(size * size * 4);
    // 填充背景
    for (let i = 0; i < data.length; i += 4) {
      data[i] = background;
      data[i + 1] = background;
      data[i + 2] = background;
      data[i + 3] = 255;
    }

    const rng = mulberry32(seed);
    const radiusRange = maxRadius - minRadius;
    const brightnessRange = maxBrightness - minBrightness;

    // 撒布薄片
    for (let f = 0; f < flakeCount; f++) {
      const cx = rng() * size;
      const cy = rng() * size;
      const radius = minRadius + rng() * radiusRange;
      const brightness = minBrightness + rng() * brightnessRange;

      // 绘制圆形薄片(考虑平铺:在边缘附近的薄片也绘制到对面)
      const r = Math.ceil(radius);
      const minX = Math.floor(cx - r);
      const maxX = Math.ceil(cx + r);
      const minY = Math.floor(cy - r);
      const maxY = Math.ceil(cy + r);

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          // 平铺环绕
          const wrappedX = ((px % size) + size) % size;
          const wrappedY = ((py % size) + size) % size;

          const dx = px - cx;
          const dy = py - cy;
          const distSq = dx * dx + dy * dy;
          const radSq = radius * radius;

          if (distSq <= radSq) {
            // 边缘抗锯齿: 在半径的 80%-100% 之间渐变
            const distRatio = Math.sqrt(distSq) / radius;
            let alpha = 1;
            if (distRatio > 0.8) {
              alpha = 1 - (distRatio - 0.8) / 0.2;
            }

            const idx = (wrappedY * size + wrappedX) * 4;
            // 混合:取 max(已有, 新值 * alpha)
            const val = brightness * alpha;
            data[idx] = Math.max(data[idx], val);
            data[idx + 1] = Math.max(data[idx + 1], val);
            data[idx + 2] = Math.max(data[idx + 2], val);
          }
        }
      }
    }

    return { data, width: size, height: size };
  }

  /**
   * 从薄片纹理生成法线贴图。
   *
   * 将灰度高度图转换为 RGB 法线贴图(Sobel 算子)。
   *
   * @param heightMap 高度图(灰度 RGBA)。
   * @param strength 法线强度(0-1)。默认 1。
   */
  static toNormalMap(
    heightMap: FlakesTextureResult,
    strength: number = 1,
  ): FlakesTextureResult {
    const { data: src, width, height } = heightMap;
    const dst = new Uint8ClampedArray(width * height * 4);
    const s = Math.max(0.01, strength);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // 采样 3x3 邻域(环绕)
        const xm = ((x - 1 + width) % width);
        const xp = ((x + 1) % width);
        const ym = ((y - 1 + height) % height);
        const yp = ((y + 1) % height);

        const hL = src[(y * width + xm) * 4];     // 左
        const hR = src[(y * width + xp) * 4];     // 右
        const hD = src[(ym * width + x) * 4];     // 下
        const hU = src[(yp * width + x) * 4];     // 上

        // Sobel
        const dx = (hR - hL) * s;
        const dy = (hU - hD) * s;
        const dz = 255;

        // 归一化
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const nx = dx / len;
        const ny = dy / len;
        const nz = dz / len;

        const idx = (y * width + x) * 4;
        dst[idx] = (nx * 0.5 + 0.5) * 255;
        dst[idx + 1] = (ny * 0.5 + 0.5) * 255;
        dst[idx + 2] = (nz * 0.5 + 0.5) * 255;
        dst[idx + 3] = 255;
      }
    }

    return { data: dst, width, height };
  }
}
