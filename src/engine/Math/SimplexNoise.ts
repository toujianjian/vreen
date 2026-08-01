// SimplexNoise — Simplex 噪声 (Stefan Gustavson 实现)。
//
// 适配 three.js `examples/jsm/math/SimplexNoise.js`。
// 与 ImprovedNoise (Perlin) 互补:Simplex 噪声是 Perlin 2001 年的改进版,
// 在高维空间中计算量更低(O(n) vs O(2^n))且无方向性伪影。
//
// 算法 (2D/3D):
//   1. 将输入坐标斜切变换 (skew) 到单纯形网格 (simplex grid);
//   2. 找到包含点的单纯形 (2D: 三角形, 3D: 四面体);
//   3. 对单纯形各顶点计算梯度贡献;
//   4. 用径向衰减函数 (0.5 - x²-y²-z²)⁴ 加权求和。
//
// 特性:
//   - 确定性:相同输入 → 相同输出;
//   - 无方向性伪影 (不像 Perlin 有轴向偏好);
//   - 2D/3D/4D 支持;
//   - 输出范围约 [-1, 1]。
//
// 用途:
//   - 程序化地形 (比 Perlin 更自然)
//   - 体积云 / 烟雾
//   - 纹理生成
//   - 游戏中的随机但平滑的扰动
//
// 参考:
//   - Stefan Gustavson "Simplex noise demystified" (2005)
//   - Ken Perlin "Noise Hardware" (2001)
//   - three.js examples/jsm/math/SimplexNoise.js

/**
 * Simplex 噪声 (2D/3D/4D)。
 *
 * 不依赖 WebGL,可在 Node/无头环境运行。
 */
export class SimplexNoise {
  private readonly perm: Uint8Array;
  private readonly permMod12: Uint8Array;

  // 梯度向量 (3D, 12 个方向)
  private static readonly grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  ]);

  // 梯度向量 (2D, 8 个方向)
  private static readonly grad2 = new Float32Array([
    1, 0, -1, 0, 0, 1, 0, -1,
    1, 1, -1, 1, 1, -1, -1, -1,
  ]);

  constructor() {
    // 排列表 (与 ImprovedNoise 一致的确定性洗牌)
    const p = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;

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

    const pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      p[i] = base[i & 255];
      pm12[i] = p[i] % 12;
    }

    this.perm = p;
    this.permMod12 = pm12;
  }

  /**
   * 2D Simplex 噪声。
   *
   * @param xin X 坐标。
   * @param yin Y 坐标。
   * @returns 噪声值,范围约 [-1, 1]。
   */
  noise2D(xin: number, yin: number): number {
    const perm = this.perm;
    const grad2 = SimplexNoise.grad2;

    const F2 = 0.5 * (Math.sqrt(3) - 1); // 2D 斜切因子
    const G2 = (3 - Math.sqrt(3)) / 6;    // 2D 反斜切因子

    // 斜切变换: 确定单纯形网格单元
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);

    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    // 确定点在哪个三角形中
    let i1: number, j1: number;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 8;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 8;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 8;

    // 计算三个顶点的贡献
    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (grad2[gi0 * 2] * x0 + grad2[gi0 * 2 + 1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (grad2[gi1 * 2] * x1 + grad2[gi1 * 2 + 1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (grad2[gi2 * 2] * x2 + grad2[gi2 * 2 + 1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  }

  /**
   * 3D Simplex 噪声。
   *
   * @param xin X 坐标。
   * @param yin Y 坐标。
   * @param zin Z 坐标。
   * @returns 噪声值,范围约 [-1, 1]。
   */
  noise3D(xin: number, yin: number, zin: number): number {
    const permMod12 = this.permMod12;
    const perm = this.perm;
    const grad3 = SimplexNoise.grad3;

    const F3 = 1 / 3;  // 3D 斜切因子
    const G3 = 1 / 6;  // 3D 反斜切因子

    // 斜切变换
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);

    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    const z0 = zin - Z0;

    // 确定点在哪个四面体中
    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const gi0 = permMod12[ii + perm[jj + perm[kk]]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
    const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
    const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];

    // 计算四个顶点的贡献
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0 * 3] * x0 + grad3[gi0 * 3 + 1] * y0 + grad3[gi0 * 3 + 2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1 * 3] * x1 + grad3[gi1 * 3 + 1] * y1 + grad3[gi1 * 3 + 2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2 * 3] * x2 + grad3[gi2 * 3 + 1] * y2 + grad3[gi2 * 3 + 2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi3 * 3] * x3 + grad3[gi3 * 3 + 1] * y3 + grad3[gi3 * 3 + 2] * z3);
    }

    return 32 * (n0 + n1 + n2 + n3);
  }

  /**
   * 4D Simplex 噪声。
   *
   * @param x X 坐标。
   * @param y Y 坐标。
   * @param z Z 坐标。
   * @param w W 坐标 (第 4 维,常用于时间动画)。
   * @returns 噪声值,范围约 [-1, 1]。
   */
  noise4D(x: number, y: number, z: number, w: number): number {
    // 4D Simplex 较为复杂,这里使用简化版:对 3D 噪声做 4D 外推
    // 通过两个 3D 噪声的插值近似 4D,避免实现完整的 4D Simplex 网格
    // (32 个顶点贡献 + 顶点排序) 以保持代码可读性与性能。
    const F4 = (Math.sqrt(5) - 1) / 4;
    const s = (x + y + z + w) * F4;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const l = Math.floor(w + s);
    const t = (i + j + k + l) * (1 - F4);
    const W0 = l - t;
    const w0 = w - W0; // w 在 simplex 单元内的局部坐标

    // 简化:使用两个 3D 噪声插值
    const n1 = this.noise3D(x, y, z);
    const n2 = this.noise3D(x + w * 0.5, y + w * 0.3, z + w * 0.7);
    return n1 * (1 - Math.abs(w0) * 0.5) + n2 * (Math.abs(w0) * 0.5);
  }

  /**
   * fBm (Fractal Brownian Motion) — 多倍频 2D Simplex 噪声叠加。
   *
   * @param x X 坐标。
   * @param y Y 坐标。
   * @param octaves 倍频数。默认 4。
   * @param persistence 振幅衰减。默认 0.5。
   * @param lacunarity 频率增长。默认 2.0。
   * @returns 累加噪声值。
   */
  fbm2D(
    x: number,
    y: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
  ): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  /**
   * fBm (Fractal Brownian Motion) — 多倍频 3D Simplex 噪声叠加。
   */
  fbm3D(
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
      total += this.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }
}
