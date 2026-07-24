// HeightmapGenerator — 程序化高度图生成器(纯函数集合)。
//
// 所有方法返回 Float32Array,值域归一化到 [0, 1],可直接喂给 TerrainGeometry。
// 算法:
//   * fromPerlinNoise   — 多倍频 Perlin 噪声(fBm),自然地形
//   * fromDiamondSquare — Diamond-Square 算法,块状山地
//   * fromRidge         — 山脊噪声(1 - |n|)^2,锐利山脊
//   * fromFlat          — 全 0 平坦地形
//
// PRNG 使用 mulberry32(种子可控、无外部依赖)。Perlin 实现参考 Ken Perlin
// 经典 2D 噪声:置换表 + 梯度 + fade 缓动。

/** mulberry32 — 简单高速种子化 PRNG,返回 [0, 1) 浮点。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** fade 缓动:6t^5 - 15t^4 + 10t^3,保证导数连续。 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 线性插值。 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 2D Perlin 噪声。
 * 内部维护 512 项置换表(由种子洗牌生成),输出范围 ≈ [-1, 1]。
 */
class Perlin2D {
  private perm: Uint8Array;

  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates 洗牌
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** 计算梯度贡献。 */
  private grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? 2 * v : -2 * v);
  }

  /**
   * 采样 2D Perlin 噪声。
   * @returns ≈ [-1, 1]
   */
  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const perm = this.perm;
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }
}

/** 将任意范围的高度图归一化到 [0, 1]。 */
function normalizeTo01(map: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < map.length; i++) {
    const v = map[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range <= 0) {
    // 全部相同值 → 全 0(避免除 0)
    map.fill(0);
    return map;
  }
  for (let i = 0; i < map.length; i++) {
    map[i] = (map[i] - min) / range;
  }
  return map;
}

/**
 * 程序化高度图生成器(全部静态方法)。
 *
 * 所有方法返回 Float32Array,值域 [0, 1]。
 */
export class HeightmapGenerator {
  /**
   * 多倍频 Perlin 噪声(fBm)生成自然地形高度图。
   *
   * @param width        输出宽度(像素)
   * @param height       输出高度(像素)
   * @param scale        噪声采样缩放(越大越平缓)
   * @param octaves      倍频数(通常 4-8)
   * @param persistence  振幅衰减(0-1,通常 0.5)
   * @param seed         随机种子
   * @returns Float32Array(width * height),值域 [0, 1]
   */
  static fromPerlinNoise(
    width: number,
    height: number,
    scale: number,
    octaves: number,
    persistence: number,
    seed: number,
  ): Float32Array {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const perlin = new Perlin2D(seed);
    const out = new Float32Array(w * h);
    const safeScale = scale > 0 ? scale : 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let amplitude = 1;
        let frequency = 1;
        let sum = 0;
        let norm = 0;
        for (let o = 0; o < octaves; o++) {
          const nx = (x / safeScale) * frequency;
          const ny = (y / safeScale) * frequency;
          sum += perlin.noise(nx, ny) * amplitude;
          norm += amplitude;
          amplitude *= persistence;
          frequency *= 2;
        }
        const v = sum / (norm > 0 ? norm : 1); // ≈ [-1, 1]
        out[y * w + x] = (v + 1) * 0.5; // → [0, 1]
      }
    }
    // 归一化保证严格 [0, 1]
    return normalizeTo01(out);
  }

  /**
   * Diamond-Square 算法生成块状山地高度图。
   *
   * @param size     输出边长,必须为 2^k + 1(如 33/65/129/257)
   * @param roughness 粗糙度(初始随机位移幅度,通常 0.3-1.0)
   * @param seed     随机种子
   * @returns Float32Array(size * size),值域 [0, 1]
   */
  static fromDiamondSquare(size: number, roughness: number, seed: number): Float32Array {
    const s = Math.floor(size);
    const n = s - 1;
    if (s < 3 || (n & (n - 1)) !== 0) {
      throw new Error(`HeightmapGenerator.fromDiamondSquare: size 必须为 2^k + 1 (k≥1,即 ≥3),收到 ${size}`);
    }
    const rng = mulberry32(seed);
    const map = new Float32Array(s * s);

    // 初始化四角
    map[0] = rng();
    map[s - 1] = rng();
    map[(s - 1) * s] = rng();
    map[(s - 1) * s + (s - 1)] = rng();

    let step = n;
    let scale = roughness;

    while (step > 1) {
      const half = step >> 1;

      // Diamond 步:每个格子中心 = 四角平均 + 随机位移
      for (let y = half; y < s; y += step) {
        for (let x = half; x < s; x += step) {
          const tl = map[(y - half) * s + (x - half)];
          const tr = map[(y - half) * s + (x + half)];
          const bl = map[(y + half) * s + (x - half)];
          const br = map[(y + half) * s + (x + half)];
          map[y * s + x] = (tl + tr + bl + br) * 0.25 + (rng() - 0.5) * scale;
        }
      }

      // Square 步:每条边中点 = 周边菱形顶点平均 + 随机位移
      for (let y = 0; y < s; y += half) {
        for (let x = (y + half) % step; x < s; x += step) {
          let sum = 0;
          let cnt = 0;
          if (x >= half) {
            sum += map[y * s + (x - half)];
            cnt++;
          }
          if (x + half < s) {
            sum += map[y * s + (x + half)];
            cnt++;
          }
          if (y >= half) {
            sum += map[(y - half) * s + x];
            cnt++;
          }
          if (y + half < s) {
            sum += map[(y + half) * s + x];
            cnt++;
          }
          map[y * s + x] = sum / (cnt > 0 ? cnt : 1) + (rng() - 0.5) * scale;
        }
      }

      step = half;
      scale *= 0.5;
    }

    return normalizeTo01(map);
  }

  /**
   * 山脊噪声生成锐利山脊地形。
   * 公式:n = 1 - |perlin(x*f, y*f)|;再平方锐化。
   *
   * @param width      输出宽度
   * @param height     输出高度
   * @param frequency  噪声频率(越大山脊越密)
   * @param amplitude  整体幅度(0-1,通常 1)
   * @param seed       随机种子(可选,默认 0)
   * @returns Float32Array(width * height),值域 [0, 1]
   */
  static fromRidge(
    width: number,
    height: number,
    frequency: number,
    amplitude: number,
    seed: number = 0,
  ): Float32Array {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const perlin = new Perlin2D(seed);
    const out = new Float32Array(w * h);
    const f = frequency > 0 ? frequency : 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = Math.abs(perlin.noise(x * f, y * f));
        const ridge = 1 - n;
        out[y * w + x] = ridge * ridge * amplitude;
      }
    }
    return normalizeTo01(out);
  }

  /**
   * 生成全 0 的平坦高度图。
   *
   * @param width  输出宽度
   * @param height 输出高度
   * @returns Float32Array(width * height),全 0
   */
  static fromFlat(width: number, height: number): Float32Array {
    return new Float32Array(Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height)));
  }
}
