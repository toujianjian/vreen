// ImprovedNoise — Ken Perlin 改进噪声 (3D Perlin noise)。
//
// 适配 three.js `examples/jsm/math/ImprovedNoise.js`。
// 这是 Ken Perlin 2002 年改进的 Reference Noise,与 HeightmapGenerator 中的
// Perlin2D 互补:本类提供 3D 噪声,用于体素地形/体积云/3D 纹理。
//
// 算法:
//   1. 将输入坐标 (x, y, z) 分解为整数格点 + 小数偏移;
//   2. 用排列表 (permutation table) 为 8 个格点分配梯度向量;
//   3. 用 fade 函数 (6t⁵-15t⁴+10t³) 平滑插值;
//   4. 三线性插值 8 个格点的梯度贡献。
//
// 特性:
//   - 确定性:相同输入 → 相同输出;
//   - 平滑:输出在 [0, 1] 之间连续可微;
//   - 可平铺:通过坐标取模实现;
//   - 3D:支持 (x, y, z) 三维采样。
//
// 用途:
//   - 程序化地形 (3D fBm)
//   - 体积云 (ray marching + 噪声密度)
//   - 3D 纹理 (大理石/木纹/烟雾)
//   - 程序化动画 (流动效果)
//
// 参考:
//   - Ken Perlin "Improving Noise" (SIGGRAPH 2002)
//   - three.js examples/jsm/math/ImprovedNoise.js

/**
 * Ken Perlin 改进噪声 (3D)。
 *
 * 不依赖 WebGL,可在 Node/无头环境运行。
 */
export class ImprovedNoise {
  private readonly perm: Uint8Array;

  constructor() {
    // Ken Perlin 的标准排列表 (512 字节,256 重复一次)
    const p = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;

    // Fisher-Yates 洗牌(使用固定种子保证确定性)
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }

    // 复制两次(避免取模)
    for (let i = 0; i < 512; i++) {
      p[i] = base[i & 255];
    }

    this.perm = p;
  }

  /**
   * 3D Perlin 噪声采样。
   *
   * @param x X 坐标。
   * @param y Y 坐标。
   * @param z Z 坐标。
   * @returns 噪声值,范围约 [-1, 1]。
   */
  noise(x: number, y: number, z: number): number {
    const p = this.perm;

    // 找到包含 (x,y,z) 的单位立方体
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    // 小数部分
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    // fade 函数: 6t⁵ - 15t⁴ + 10t³
    const u = this._fade(x);
    const v = this._fade(y);
    const w = this._fade(z);

    // 排列表哈希 8 个角点
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;

    // 梯度贡献 + 三线性插值
    return this._lerp(
      w,
      this._lerp(
        v,
        this._lerp(
          u,
          this._grad(p[AA], x, y, z),
          this._grad(p[BA], x - 1, y, z),
        ),
        this._lerp(
          u,
          this._grad(p[AB], x, y - 1, z),
          this._grad(p[BB], x - 1, y - 1, z),
        ),
      ),
      this._lerp(
        v,
        this._lerp(
          u,
          this._grad(p[AA + 1], x, y, z - 1),
          this._grad(p[BA + 1], x - 1, y, z - 1),
        ),
        this._lerp(
          u,
          this._grad(p[AB + 1], x, y - 1, z - 1),
          this._grad(p[BB + 1], x - 1, y - 1, z - 1),
        ),
      ),
    );
  }

  /**
   * 2D Perlin 噪声(z=0 的 3D 切片)。
   *
   * @param x X 坐标。
   * @param y Y 坐标。
   * @returns 噪声值,范围约 [-1, 1]。
   */
  noise2D(x: number, y: number): number {
    return this.noise(x, y, 0);
  }

  /**
   * 1D Perlin 噪声(y=0, z=0 的 3D 切片)。
   *
   * @param x X 坐标。
   * @returns 噪声值,范围约 [-1, 1]。
   */
  noise1D(x: number): number {
    return this.noise(x, 0, 0);
  }

  /**
   * fBm (Fractal Brownian Motion) — 多倍频噪声叠加。
   *
   * @param x X 坐标。
   * @param y Y 坐标。
   * @param z Z 坐标。
   * @param octaves 倍频数。默认 4。
   * @param persistence 振幅衰减。默认 0.5。
   * @param lacunarity 频率增长。默认 2.0。
   * @returns 累加噪声值。
   */
  fbm(
    x: number,
    y: number,
    z: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
  ): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency, z * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  /**
   * 2D fBm。
   */
  fbm2D(
    x: number,
    y: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
  ): number {
    return this.fbm(x, y, 0, octaves, persistence, lacunarity);
  }

  // ── 内部方法 ─────────────────────────────────────────────────────

  /** fade 函数: 6t⁵ - 15t⁴ + 10t³。 */
  private _fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** 线性插值。 */
  private _lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  /**
   * 梯度函数。
   * 根据 hash 值选择 12 个梯度方向之一,计算与偏移的点积。
   */
  private _grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
}
