// NoiseGenerator — 程序化噪声生成器(实例化、种子可控)。
//
// 提供 Perlin / Simplex / Worley / fBm / Ridge 噪声,所有方法返回
// 标量值(非数组),供 PCG 其他生成器按需采样。
//
// 算法参考:
//   * Perlin   — Ken Perlin 经典梯度噪声,置换表 + fade 缓动
//   * Simplex  — Stefan Gustavson 简化实现,3D/2D 共享梯度表
//   * Worley   — 区块网格 + 特征点最近邻距离(2D/3D)
//   * fBm      — 多倍频叠加 Perlin,振幅按 persistence 衰减
//   * Ridge    — 1 - |n|,再平方锐化,用于山脊地形
//
// PRNG 使用 mulberry32(种子可控、无外部依赖)。
// 与 Terrain/HeightmapGenerator 中的 Perlin2D 互补:后者是静态函数集合,
// 本类为有状态实例(可热替换种子、复用置换表)。

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

/** 2D Perlin 梯度贡献。 */
function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? 2 * v : -2 * v);
}

/** 3D Perlin 梯度贡献(12 条梯度方向)。 */
function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Simplex 3D 梯度向量表(12 个)。 */
const SIMPLEX_GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

/** Simplex 2D 中的 (i+j) % 3 顶点偏移。 */
const SIMPLEX_2D_F = (Math.sqrt(3) - 1) / 2; // 0.5 * (Math.sqrt(3) - 1)
const SIMPLEX_2D_G = (3 - Math.sqrt(3)) / 6; // 1 / (2 * (1 + 1/Math.sqrt(3) + 1))

/** Simplex 3D 中的 skew/unskew 因子。 */
const SIMPLEX_3D_F = 1 / 3;
const SIMPLEX_3D_G = 1 / 6;

/**
 * 程序化噪声生成器(实例化)。
 *
 * 用法:
 *   const ng = new NoiseGenerator(42);
 *   const v = ng.fbm2D(x, y, 5, 0.5, 2);
 *
 * 重设种子:
 *   ng.setSeed(123);
 */
export class NoiseGenerator {
  /** 512 项置换表(由种子洗牌生成)。 */
  private perm: Uint8Array;
  /** 512 项置换表(双字节,用于 3D 高位偏移)。 */
  private permMod12: Uint8Array;
  /** 当前种子。 */
  private seed: number;

  constructor(seed: number = 0) {
    this.seed = seed >>> 0;
    const { perm, permMod12 } = buildPerm(this.seed);
    this.perm = perm;
    this.permMod12 = permMod12;
  }

  /** 当前种子。 */
  getSeed(): number {
    return this.seed;
  }

  /** 重设种子并重建置换表。 */
  setSeed(seed: number): void {
    this.seed = seed >>> 0;
    const { perm, permMod12 } = buildPerm(this.seed);
    this.perm = perm;
    this.permMod12 = permMod12;
  }

  // ── Perlin ────────────────────────────────────────────────────────

  /**
   * 2D Perlin 噪声。
   * @returns ≈ [-1, 1]
   */
  perlin2D(x: number, y: number): number {
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
    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  /**
   * 3D Perlin 噪声。
   * @returns ≈ [-1, 1]
   */
  perlin3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const perm = this.perm;
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(perm[AA], xf, yf, zf), grad3(perm[BA], xf - 1, yf, zf), u),
        lerp(grad3(perm[AB], xf, yf - 1, zf), grad3(perm[BB], xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(grad3(perm[AA + 1], xf, yf, zf - 1), grad3(perm[BA + 1], xf - 1, yf, zf - 1), u),
        lerp(grad3(perm[AB + 1], xf, yf - 1, zf - 1), grad3(perm[BB + 1], xf - 1, yf - 1, zf - 1), u),
        v,
      ),
      w,
    );
  }

  // ── Simplex ───────────────────────────────────────────────────────

  /**
   * 2D Simplex 噪声(Stefan Gustavson 实现)。
   * @returns ≈ [-1, 1]
   */
  simplex2D(x: number, y: number): number {
    const perm = this.perm;
    const permMod12 = this.permMod12;
    const s = (x + y) * SIMPLEX_2D_F;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * SIMPLEX_2D_G;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    // 确定顶点顺序(下/上三角)
    let i1: number, j1: number;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + SIMPLEX_2D_G;
    const y1 = y0 - j1 + SIMPLEX_2D_G;
    const x2 = x0 - 1 + 2 * SIMPLEX_2D_G;
    const y2 = y0 - 1 + 2 * SIMPLEX_2D_G;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]] % 12;
    const gi1 = permMod12[ii + i1 + perm[jj + j1]] % 12;
    const gi2 = permMod12[ii + 1 + perm[jj + 1]] % 12;

    // 三顶点贡献
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      const g = SIMPLEX_GRAD3[gi0];
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      const g = SIMPLEX_GRAD3[gi1];
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      const g = SIMPLEX_GRAD3[gi2];
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    // 归一化到约 [-1, 1](常量 70 经验值)
    return 70 * (n0 + n1 + n2);
  }

  /**
   * 3D Simplex 噪声(Stefan Gustavson 实现)。
   * @returns ≈ [-1, 1]
   */
  simplex3D(x: number, y: number, z: number): number {
    const perm = this.perm;
    const permMod12 = this.permMod12;
    const s = (x + y + z) * SIMPLEX_3D_F;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * SIMPLEX_3D_G;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    // 确定四面体顶点顺序(6 种情况)
    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else               { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0)       { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0)  { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else               { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + SIMPLEX_3D_G;
    const y1 = y0 - j1 + SIMPLEX_3D_G;
    const z1 = z0 - k1 + SIMPLEX_3D_G;
    const x2 = x0 - i2 + 2 * SIMPLEX_3D_G;
    const y2 = y0 - j2 + 2 * SIMPLEX_3D_G;
    const z2 = z0 - k2 + 2 * SIMPLEX_3D_G;
    const x3 = x0 - 1 + 3 * SIMPLEX_3D_G;
    const y3 = y0 - 1 + 3 * SIMPLEX_3D_G;
    const z3 = z0 - 1 + 3 * SIMPLEX_3D_G;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const gi0 = permMod12[ii + perm[jj + perm[kk]]] % 12;
    const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12;
    const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12;
    const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12;

    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      t0 *= t0;
      const g = SIMPLEX_GRAD3[gi0];
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      t1 *= t1;
      const g = SIMPLEX_GRAD3[gi1];
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      t2 *= t2;
      const g = SIMPLEX_GRAD3[gi2];
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      t3 *= t3;
      const g = SIMPLEX_GRAD3[gi3];
      n3 = t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3);
    }
    // 归一化到约 [-1, 1](常量 32 经验值)
    return 32 * (n0 + n1 + n2 + n3);
  }

  // ── Worley (Cellular) ─────────────────────────────────────────────

  /**
   * 2D Worley 噪声(返回到最近特征点的 F1 距离,值越小越靠近 cell 中心)。
   * 区块大小固定为 1,每个区块随机 1 个特征点。
   * @returns ≈ [0, 1]
   */
  worley2D(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    // 用确定性 hash 给每个 cell 一个固定特征点(基于种子)
    let minDist = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const h = hash2D(this.seed, cx, cy);
        // 在 cell 内的随机偏移 [0.1, 0.9] 避免贴边
        const px = dx + 0.1 + h * 0.8;
        const py = dy + (h * 1.7 % 1) * 0.8 + 0.1;
        const ddx = px - xf;
        const ddy = py - yf;
        const d = ddx * ddx + ddy * ddy;
        if (d < minDist) minDist = d;
      }
    }
    return Math.sqrt(minDist);
  }

  /**
   * 3D Worley 噪声(返回到最近特征点的 F1 距离)。
   * @returns ≈ [0, √3/2]
   */
  worley3D(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    let minDist = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = xi + dx;
          const cy = yi + dy;
          const cz = zi + dz;
          const h = hash3D(this.seed, cx, cy, cz);
          const px = dx + 0.1 + h * 0.8;
          const py = dy + 0.1 + (h * 1.7 % 1) * 0.8;
          const pz = dz + 0.1 + (h * 2.9 % 1) * 0.8;
          const ddx = px - xf;
          const ddy = py - yf;
          const ddz = pz - zf;
          const d = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d < minDist) minDist = d;
        }
      }
    }
    return Math.sqrt(minDist);
  }

  // ── fBm (Fractal Brownian Motion) ────────────────────────────────

  /**
   * 2D 分形布朗运动 — 多倍频 Perlin 叠加。
   * @param octaves      倍频数(通常 4-8)
   * @param persistence  振幅衰减(0-1,通常 0.5)
   * @param lacunarity   频率倍增(通常 2.0)
   * @returns ≈ [-1, 1]
   */
  fbm2D(
    x: number,
    y: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2,
  ): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.perlin2D(x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return sum / (norm > 0 ? norm : 1);
  }

  /**
   * 3D 分形布朗运动 — 多倍频 Perlin 叠加。
   * @returns ≈ [-1, 1]
   */
  fbm3D(
    x: number,
    y: number,
    z: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2,
  ): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.perlin3D(x * frequency, y * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return sum / (norm > 0 ? norm : 1);
  }

  // ── Ridge ─────────────────────────────────────────────────────────

  /**
   * 山脊噪声(基于 fBm):每一层 `1 - |n|` 再平方锐化,叠加后归一化到 [0, 1]。
   * 用于生成锐利山脊地形。
   * @returns ≈ [0, 1]
   */
  ridgenoise(x: number, y: number, octaves: number = 4): number {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.perlin2D(x * frequency, y * frequency));
      sum += n * n * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / (norm > 0 ? norm : 1);
  }
}

/** 由种子构建 512 项置换表 + (mod 12) 表。 */
function buildPerm(seed: number): { perm: Uint8Array; permMod12: Uint8Array } {
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
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  return { perm, permMod12 };
}

/** 确定性 2D hash,返回 [0, 1)。基于种子的整数 hash。 */
function hash2D(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296);
}

/** 确定性 3D hash,返回 [0, 1)。 */
function hash3D(seed: number, x: number, y: number, z: number): number {
  let h = seed
    ^ Math.imul(x | 0, 0x27d4eb2d)
    ^ Math.imul(y | 0, 0x165667b1)
    ^ Math.imul(z | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296);
}
