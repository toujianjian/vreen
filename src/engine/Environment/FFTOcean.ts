// FFTOcean — FFT 海洋渲染系统 (Phillips 频谱 + IFFT + 泡沫 + 反射/折射数据)。
//
// 基于 Tessendorf "Simulating Ocean Water" (SIGGRAPH 2002) 的统计海洋模型:
//   1. 在频域生成 Phillips 谱 h0(k) (含风向、风速、波幅)。
//   2. 每帧由 h0(k) 与色散关系 ω(k)=√(gk) 演化出时间谱 ht(k,t)。
//   3. 对 ht、水平位移谱 Dx/Dz 做二维 IFFT,得到空间域高度场与位移场。
//   4. 由位移场计算 Jacobian 行列式 → 法线 (叉积) 与泡沫 (翻叠判定)。
//
// 本模块是数据/计算层:产出 displacementMap / normalMap / foamMap (Float32Array)
// 与着色器 uniform,由 renderer / 水面 shader 消费 (与 VolumetricClouds 同构)。
//
// 与 WaterSimulation 的区别:
//   * WaterSimulation 解 2D 波动方程 (ripples, 局部扰动传播)。
//   * FFTOcean 基于统计频谱 (全局海面, 风浪涌),适合大范围开阔海域。
//
// FFT 约定:
//   * fft1D/fft2D 使用 *非归一化* 变换 (forward 与 inverse 仅指数符号相反)。
//   * 正向 (inverse=false): X[k] = Σ x[n]·exp(-2πi·kn/N)。
//   * 逆向 (inverse=true):  x[n] = Σ X[k]·exp(+2πi·kn/N)。
//   * 往返性质: ifft(fft(x)) = N·x (1D) / N²·x (2D)。调用方按需自行归一化。
//   * 这样海洋合成 h(x)=Σ ht(k)·exp(ik·x) 直接等于 fft2D(ht, true) 的实部,
//     无需额外缩放 (h0 已含 Δk 因子, 物理量纲正确)。
//
// 用法:
//   const ocean = new FFTOcean({ resolution: 128, windSpeed: 12 });
//   ocean.update(dt);                      // 推进一帧
//   const uniforms = ocean.getShaderUniforms();   // 传给水面 shader
//   const disp = ocean.getDisplacementMap();      // 顶点位移

import { Vector3 } from '../Math/Vector3';

/** 线性 RGB 三元组 (0..1)。 */
export interface OceanRGB {
  r: number;
  g: number;
  b: number;
}

/** FFTOcean 构造选项。 */
export interface FFTOceanOptions {
  /** FFT 分辨率 (须为 2 的幂, 会自动钳制)。 */
  resolution?: number;
  /** 海面物理尺寸 (米, 正方形边长)。 */
  physicalSize?: number;
  /** 风速 (m/s)。 */
  windSpeed?: number;
  /** 风向 (XZ 平面, 无需归一化)。 */
  windDirection?: { x: number; z: number };
  /** 波幅系数 (Phillips 的 A 常数)。 */
  waveAmplitude?: number;
  /** choppiness (水平位移强度, 0=无位移, 1=标准)。 */
  choppyFactor?: number;
  /** 泡沫阈值 (Jacobian 低于此值开始起泡)。 */
  foamThreshold?: number;
  /** 泡沫强度 (起泡速率)。 */
  foamIntensity?: number;
  /** 深水颜色。 */
  deepWaterColor?: OceanRGB;
  /** 浅水颜色。 */
  shallowWaterColor?: OceanRGB;
  /** 泡沫颜色。 */
  foamColor?: OceanRGB;
  /** 太阳方向 (世界空间)。 */
  sunDirection?: Vector3 | { x: number; y: number; z: number };
  /** 太阳颜色。 */
  sunColor?: OceanRGB;
  /** 天空颜色。 */
  skyColor?: OceanRGB;
}

/** 着色器 uniform 集合 (供 renderer 绑定)。 */
export interface FFTOceanUniforms {
  u_resolution: number;
  u_physicalSize: number;
  u_windSpeed: number;
  u_windDirection: [number, number];
  u_waveAmplitude: number;
  u_choppyFactor: number;
  u_foamThreshold: number;
  u_foamIntensity: number;
  u_deepWaterColor: [number, number, number];
  u_shallowWaterColor: [number, number, number];
  u_foamColor: [number, number, number];
  u_sunDirection: [number, number, number];
  u_sunColor: [number, number, number];
  u_skyColor: [number, number, number];
  u_time: number;
  /** 位移图 (dx, dy=高度, dz) 交错, 3 分量/像素。 */
  u_displacementMap: { data: Float32Array | null; resolution: number; components: 3 };
  /** 法线图 (nx, ny, nz), 归一化, 3 分量/像素。 */
  u_normalMap: { data: Float32Array | null; resolution: number; components: 3 };
  /** 泡沫图 (标量强度 0..1), 1 分量/像素。 */
  u_foamMap: { data: Float32Array | null; resolution: number; components: 1 };
}

/** FFTOcean 运行时统计。 */
export interface FFTOceanStats {
  resolution: number;
  physicalSize: number;
  windSpeed: number;
  windDirection: { x: number; z: number };
  waveAmplitude: number;
  choppyFactor: number;
  foamThreshold: number;
  foamIntensity: number;
  time: number;
  h0Generated: boolean;
  htGenerated: boolean;
  displacementGenerated: boolean;
  normalGenerated: boolean;
  foamGenerated: boolean;
  /** 估算显存/内存占用 (字节)。 */
  memoryBytes: number;
}

/** 重力加速度 (m/s²)。 */
const G = 9.81;

/** 将正整数钳制到最近的 2 的幂, 范围 [2, 2048]。 */
function clampPow2(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 2;
  const r = Math.round(Math.log2(n));
  const clamped = Math.max(1, Math.min(11, r)); // 2^1 .. 2^11
  return 1 << clamped;
}

/**
 * FFT 海洋渲染系统 — 统计频谱海面, 产出位移/法线/泡沫图。
 *
 * 在 resolution×resolution 网格上模拟。所有图均为周期性 (FFT 隐含周期边界),
 * 适合可平铺的海面。
 */
export class FFTOcean {
  // ── 模拟参数 ──────────────────────────────────────────
  /** FFT 分辨率 (每边格数, 2 的幂)。 */
  resolution: number;
  /** 海面物理尺寸 (米)。 */
  physicalSize: number;
  /** 风速 (m/s)。 */
  windSpeed: number;
  /** 风向 (XZ 平面, 归一化)。 */
  windDirection: { x: number; z: number };
  /** 波幅系数 (Phillips A)。 */
  waveAmplitude: number;
  /** choppiness (水平位移强度)。 */
  choppyFactor: number;
  /** 泡沫阈值。 */
  foamThreshold: number;
  /** 泡沫强度。 */
  foamIntensity: number;
  /** 深水颜色。 */
  deepWaterColor: OceanRGB;
  /** 浅水颜色。 */
  shallowWaterColor: OceanRGB;
  /** 泡沫颜色。 */
  foamColor: OceanRGB;
  /** 太阳方向 (世界空间)。 */
  sunDirection: Vector3;
  /** 太阳颜色。 */
  sunColor: OceanRGB;
  /** 天空颜色。 */
  skyColor: OceanRGB;

  // ── 计算结果 (供 renderer 消费) ──────────────────────
  /** 位移图 (dx, dy=高度, dz) 交错, 长度 3·N·N, 或 null。 */
  displacementMap: Float32Array | null;
  /** 法线图 (nx, ny, nz) 交错, 长度 3·N·N, 或 null。 */
  normalMap: Float32Array | null;
  /** 泡沫图 (标量 0..1), 长度 N·N, 或 null。 */
  foamMap: Float32Array | null;
  /** 初始频谱 h0(k) (复数交错 re,im), 长度 2·N·N, 或 null。 */
  h0: Float32Array | null;
  /** 时间频谱 ht(k,t) (复数交错), 长度 2·N·N, 或 null。 */
  ht: Float32Array | null;
  /** 当前模拟时间 (秒)。 */
  time: number;

  // ── 内部 scratch ──────────────────────────────────────
  /** 水平 x 位移频谱 (复数交错)。 */
  private _dxSpec: Float32Array | null;
  /** 水平 z 位移频谱 (复数交错)。 */
  private _dzSpec: Float32Array | null;
  /** 行 FFT scratch (复数交错, 长度 2·N)。 */
  private _rowScratch: Float32Array | null;
  /** 列 FFT scratch (复数交错, 长度 2·N)。 */
  private _colScratch: Float32Array | null;

  constructor(opts: FFTOceanOptions = {}) {
    this.resolution = clampPow2(opts.resolution ?? 64);
    this.physicalSize = opts.physicalSize ?? 100;
    this.windSpeed = opts.windSpeed ?? 10;
    this.windDirection = { x: 1, z: 0 };
    this.waveAmplitude = opts.waveAmplitude ?? 1.0;
    this.choppyFactor = opts.choppyFactor ?? 1.0;
    this.foamThreshold = opts.foamThreshold ?? 0.5;
    this.foamIntensity = opts.foamIntensity ?? 2.0;
    this.deepWaterColor = { r: 0.02, g: 0.08, b: 0.15 };
    this.shallowWaterColor = { r: 0.1, g: 0.4, b: 0.5 };
    this.foamColor = { r: 1, g: 1, b: 1 };
    this.sunDirection = new Vector3(0.5, -1, 0.3);
    this.sunColor = { r: 1, g: 0.95, b: 0.85 };
    this.skyColor = { r: 0.5, g: 0.7, b: 0.9 };

    if (opts.windDirection) this.windDirection = { ...opts.windDirection };
    if (opts.deepWaterColor) this.deepWaterColor = { ...opts.deepWaterColor };
    if (opts.shallowWaterColor) this.shallowWaterColor = { ...opts.shallowWaterColor };
    if (opts.foamColor) this.foamColor = { ...opts.foamColor };
    if (opts.sunColor) this.sunColor = { ...opts.sunColor };
    if (opts.skyColor) this.skyColor = { ...opts.skyColor };
    if (opts.sunDirection) {
      this.sunDirection = new Vector3(opts.sunDirection.x, opts.sunDirection.y, opts.sunDirection.z);
    }

    this.displacementMap = null;
    this.normalMap = null;
    this.foamMap = null;
    this.h0 = null;
    this.ht = null;
    this._dxSpec = null;
    this._dzSpec = null;
    this._rowScratch = null;
    this._colScratch = null;
    this.time = 0;

    // 归一化风向
    this._normalizeWind();

    // 分配 ht 并生成初始频谱
    const n = this.resolution;
    this.ht = new Float32Array(2 * n * n);
    this.generateSpectrum();
  }

  // ── 参数 setter ───────────────────────────────────────

  /**
   * 设置分辨率 (会重新分配缓冲并重新生成频谱)。
   * @param resolution 目标分辨率, 自动钳制到 2 的幂。
   */
  setResolution(resolution: number): this {
    this.resolution = clampPow2(resolution);
    const n = this.resolution;
    this.h0 = null;
    this.ht = new Float32Array(2 * n * n);
    this.displacementMap = null;
    this.normalMap = null;
    this.foamMap = null;
    this._dxSpec = null;
    this._dzSpec = null;
    this._rowScratch = null;
    this._colScratch = null;
    this.time = 0;
    this.generateSpectrum();
    return this;
  }

  /**
   * 设置海面物理尺寸。
   * 注意:改变尺寸后需调用 generateSpectrum() 重新生成频谱。
   */
  setPhysicalSize(size: number): this {
    this.physicalSize = Math.max(0.001, size);
    return this;
  }

  /**
   * 设置风速与风向 (风向会被归一化)。
   * 注意:改变后需调用 generateSpectrum() 重新生成频谱。
   */
  setWind(speed: number, direction: { x: number; z: number }): this {
    this.windSpeed = Math.max(0, speed);
    this.windDirection = { x: direction.x, z: direction.z };
    this._normalizeWind();
    return this;
  }

  /** 设置波幅系数。注意:改变后需调用 generateSpectrum()。 */
  setWaveAmplitude(amplitude: number): this {
    this.waveAmplitude = Math.max(0, amplitude);
    return this;
  }

  /** 设置 choppiness。 */
  setChoppy(factor: number): this {
    this.choppyFactor = Math.max(0, factor);
    return this;
  }

  /** 设置泡沫参数。 */
  setFoamParams(threshold: number, intensity: number): this {
    this.foamThreshold = threshold;
    this.foamIntensity = Math.max(0, intensity);
    return this;
  }

  /** 设置深/浅水颜色。 */
  setWaterColors(deep: OceanRGB, shallow: OceanRGB): this {
    this.deepWaterColor = { ...deep };
    this.shallowWaterColor = { ...shallow };
    return this;
  }

  /** 设置泡沫颜色。 */
  setFoamColor(color: OceanRGB): this {
    this.foamColor = { ...color };
    return this;
  }

  /** 设置太阳方向与颜色 (方向会被归一化)。 */
  setSun(direction: Vector3 | { x: number; y: number; z: number }, color: OceanRGB): this {
    this.sunDirection = new Vector3(direction.x, direction.y, direction.z);
    this.sunColor = { ...color };
    return this;
  }

  /** 设置天空颜色。 */
  setSkyColor(color: OceanRGB): this {
    this.skyColor = { ...color };
    return this;
  }

  // ── 频谱生成与演化 ────────────────────────────────────

  /**
   * 生成 Phillips 初始频谱 h0(k)。
   * h0(k) = (1/√2)·(gr + i·gi)·√(P(k)·Δkx·Δkz),
   * 其中 P(k) 为 Phillips 谱, gr/gi 为独立高斯随机数。
   */
  generateSpectrum(): this {
    const n = this.resolution;
    const L = this.physicalSize;
    const dk = (2 * Math.PI) / L;
    if (!this.h0 || this.h0.length !== 2 * n * n) {
      this.h0 = new Float32Array(2 * n * n);
    } else {
      this.h0.fill(0);
    }
    for (let z = 0; z < n; z++) {
      const kz = (z <= n / 2 ? z : z - n) * dk;
      for (let x = 0; x < n; x++) {
        const kx = (x <= n / 2 ? x : x - n) * dk;
        const idx = z * n + x;
        const P = this.phillipsSpectrum({ x: kx, z: kz });
        if (P <= 0) {
          this.h0[2 * idx] = 0;
          this.h0[2 * idx + 1] = 0;
          continue;
        }
        // √(P·Δkx·Δkz) / √2
        const amp = Math.sqrt(P * dk * dk) / Math.SQRT2;
        const gr = this.gaussianRandom();
        const gi = this.gaussianRandom();
        this.h0[2 * idx] = gr * amp;
        this.h0[2 * idx + 1] = gi * amp;
      }
    }
    this.time = 0;
    return this;
  }

  /**
   * Phillips 频谱 P(k)。
   *   P(k) = A·exp(-1/(k·Lw)²) / k⁴ · |k̂·ŵ|² · exp(-k²·l²)
   * 其中 Lw = windSpeed²/g (最大波长), l = Lw·0.1 (小波抑制),
   * ŵ 为风向单位向量。k=0 时返回 0。
   * @param k 波向量 {x, z}。
   */
  phillipsSpectrum(k: { x: number; z: number }): number {
    const kx = k.x;
    const kz = k.z;
    const k2 = kx * kx + kz * kz;
    if (k2 === 0) return 0;
    const kmag = Math.sqrt(k2);
    const Lw = (this.windSpeed * this.windSpeed) / G;
    const kLw2 = k2 * Lw * Lw;
    // 风向单位向量
    const wlen = Math.hypot(this.windDirection.x, this.windDirection.z) || 1;
    const wx = this.windDirection.x / wlen;
    const wz = this.windDirection.z / wlen;
    const kxh = kx / kmag;
    const kzh = kz / kmag;
    const dot = kxh * wx + kzh * wz;
    let P = (this.waveAmplitude * Math.exp(-1 / kLw2)) / (k2 * k2);
    P *= dot * dot;
    // 抑制小波 (避免无穷大高频)
    const l = Lw * 0.1;
    P *= Math.exp(-k2 * l * l);
    return P < 0 ? 0 : P;
  }

  /**
   * Box-Muller 法生成标准正态分布 N(0,1) 随机数。
   */
  gaussianRandom(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * 由 h0(k) 与色散关系演化出时间频谱 ht(k,t)。
   *   ht(k,t) = h0(k)·exp(iωt) + conj(h0(-k))·exp(-iωt)
   * 其中 ω(k)=√(g·k), 共轭项保证高度场为实数。
   * @param time 模拟时间 (秒)。
   */
  updateSpectrum(time: number): this {
    const n = this.resolution;
    const L = this.physicalSize;
    const dk = (2 * Math.PI) / L;
    if (!this.h0) return this;
    if (!this.ht || this.ht.length !== 2 * n * n) {
      this.ht = new Float32Array(2 * n * n);
    }
    for (let z = 0; z < n; z++) {
      const kz = (z <= n / 2 ? z : z - n) * dk;
      for (let x = 0; x < n; x++) {
        const kx = (x <= n / 2 ? x : x - n) * dk;
        const idx = z * n + x;
        const k = Math.sqrt(kx * kx + kz * kz);
        const omega = Math.sqrt(G * k);
        const cosW = Math.cos(omega * time);
        const sinW = Math.sin(omega * time);
        // h0(k)
        const h0r = this.h0[2 * idx];
        const h0i = this.h0[2 * idx + 1];
        // -k 的索引 (周期包裹)
        const nmx = (n - x) % n;
        const nmz = (n - z) % n;
        const nidx = nmz * n + nmx;
        const h0nr = this.h0[2 * nidx];
        const h0ni = this.h0[2 * nidx + 1];
        // conj(h0(-k)) = h0nr - i·h0ni
        const h0ncr = h0nr;
        const h0nci = -h0ni;
        // h0(k)·exp(iωt) = (h0r+ih0i)(cosW+i·sinW)
        const ar = h0r * cosW - h0i * sinW;
        const ai = h0r * sinW + h0i * cosW;
        // conj(h0(-k))·exp(-iωt) = (h0ncr+ih0nci)(cosW - i·sinW)
        const br = h0ncr * cosW + h0nci * sinW;
        const bi = -h0ncr * sinW + h0nci * cosW;
        this.ht[2 * idx] = ar + br;
        this.ht[2 * idx + 1] = ai + bi;
      }
    }
    return this;
  }

  // ── FFT ───────────────────────────────────────────────

  /**
   * 一维 Cooley-Tukey 基-2 FFT (非归一化, 原地)。
   * @param data 复数交错数组 [re0, im0, re1, im1, ...], 长度 2·N (N 为 2 的幂)。
   * @param inverse true=逆变换 (指数 +), false=正向 (指数 -)。均不除以 N。
   */
  fft1D(data: Float32Array, inverse: boolean): void {
    const n = data.length / 2;
    if (n <= 1) return;
    // 位反转排列
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }
      j ^= bit;
      if (i < j) {
        const tr = data[2 * i];
        data[2 * i] = data[2 * j];
        data[2 * j] = tr;
        const ti = data[2 * i + 1];
        data[2 * i + 1] = data[2 * j + 1];
        data[2 * j + 1] = ti;
      }
    }
    // 蝶形运算
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (sign * 2 * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < half; k++) {
          const ar = data[2 * (i + k)];
          const ai = data[2 * (i + k) + 1];
          const br = data[2 * (i + k + half)];
          const bi = data[2 * (i + k + half) + 1];
          const tr = cr * br - ci * bi;
          const ti = cr * bi + ci * br;
          data[2 * (i + k)] = ar + tr;
          data[2 * (i + k) + 1] = ai + ti;
          data[2 * (i + k + half)] = ar - tr;
          data[2 * (i + k + half) + 1] = ai - ti;
          // 更新旋转因子
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  /**
   * 二维 FFT (行 FFT + 列 FFT, 非归一化)。
   * @param data 复数交错数组, 长度 2·N·N (N = resolution)。
   * @param inverse true=逆变换, false=正向。
   */
  fft2D(data: Float32Array, inverse: boolean): void {
    const n = this.resolution;
    if (!this._rowScratch || this._rowScratch.length !== 2 * n) {
      this._rowScratch = new Float32Array(2 * n);
    }
    if (!this._colScratch || this._colScratch.length !== 2 * n) {
      this._colScratch = new Float32Array(2 * n);
    }
    // 局部捕获,避免方法调用后类属性 null 收窄失效
    const row = this._rowScratch;
    const col = this._colScratch;
    // 行方向
    for (let y = 0; y < n; y++) {
      const base = y * n;
      for (let x = 0; x < n; x++) {
        row[2 * x] = data[2 * (base + x)];
        row[2 * x + 1] = data[2 * (base + x) + 1];
      }
      this.fft1D(row, inverse);
      for (let x = 0; x < n; x++) {
        data[2 * (base + x)] = row[2 * x];
        data[2 * (base + x) + 1] = row[2 * x + 1];
      }
    }
    // 列方向
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        col[2 * y] = data[2 * (y * n + x)];
        col[2 * y + 1] = data[2 * (y * n + x) + 1];
      }
      this.fft1D(col, inverse);
      for (let y = 0; y < n; y++) {
        data[2 * (y * n + x)] = col[2 * y];
        data[2 * (y * n + x) + 1] = col[2 * y + 1];
      }
    }
  }

  /**
   * 对 ht 做二维 IFFT (原地)。调用后 ht 实部 = 空间域高度场。
   * 低层方法:完整流水线请用 update() / computeDisplacement()。
   */
  computeIFFT(): this {
    if (!this.ht) return this;
    this.fft2D(this.ht, true);
    return this;
  }

  /**
   * 计算位移图 (高度场 + choppiness 水平位移)。
   * 从 ht 频域构建 Dx/Dz 位移谱, 对三者做 IFFT, 写入 displacementMap。
   * 调用前 ht 必须处于频域 (updateSpectrum 之后)。
   */
  computeDisplacement(): this {
    const n = this.resolution;
    if (!this.ht || !this.h0) return this;
    if (!this._dxSpec || this._dxSpec.length !== 2 * n * n) {
      this._dxSpec = new Float32Array(2 * n * n);
    }
    if (!this._dzSpec || this._dzSpec.length !== 2 * n * n) {
      this._dzSpec = new Float32Array(2 * n * n);
    }
    // 局部捕获,避免方法调用后类属性 null 收窄失效
    const ht = this.ht;
    const dxSpec = this._dxSpec;
    const dzSpec = this._dzSpec;
    const L = this.physicalSize;
    const dk = (2 * Math.PI) / L;
    const choppy = this.choppyFactor;
    // 构建位移谱 D(k) = -i·k̂·choppy·ht(k)
    // -i·(a+bi) = b - ai, 再乘标量 s = k̂·choppy: real=s·b, imag=-s·a
    for (let z = 0; z < n; z++) {
      const kz = (z <= n / 2 ? z : z - n) * dk;
      for (let x = 0; x < n; x++) {
        const kx = (x <= n / 2 ? x : x - n) * dk;
        const idx = z * n + x;
        const k2 = kx * kx + kz * kz;
        const htR = ht[2 * idx];
        const htI = ht[2 * idx + 1];
        if (k2 === 0) {
          dxSpec[2 * idx] = 0;
          dxSpec[2 * idx + 1] = 0;
          dzSpec[2 * idx] = 0;
          dzSpec[2 * idx + 1] = 0;
          continue;
        }
        const kmag = Math.sqrt(k2);
        const sx = (kx / kmag) * choppy;
        const sz = (kz / kmag) * choppy;
        dxSpec[2 * idx] = sx * htI;
        dxSpec[2 * idx + 1] = -sx * htR;
        dzSpec[2 * idx] = sz * htI;
        dzSpec[2 * idx + 1] = -sz * htR;
      }
    }
    // IFFT (非归一化逆变换 → 空间域, 实部即物理量)
    this.computeIFFT();
    this.fft2D(dxSpec, true);
    this.fft2D(dzSpec, true);
    // 写入 displacementMap: (dx, dy=高度, dz)
    if (!this.displacementMap || this.displacementMap.length !== 3 * n * n) {
      this.displacementMap = new Float32Array(3 * n * n);
    }
    const disp = this.displacementMap;
    for (let i = 0; i < n * n; i++) {
      disp[3 * i] = dxSpec[2 * i];
      disp[3 * i + 1] = ht[2 * i];
      disp[3 * i + 2] = dzSpec[2 * i];
    }
    return this;
  }

  /**
   * 计算法线图 (由位移后的曲面叉积得出, 归一化)。
   * 周期边界 (索引包裹 mod N)。
   */
  computeNormals(): this {
    const n = this.resolution;
    const disp = this.displacementMap;
    if (!disp || disp.length !== 3 * n * n) return this;
    if (!this.normalMap || this.normalMap.length !== 3 * n * n) {
      this.normalMap = new Float32Array(3 * n * n);
    }
    const L = this.physicalSize;
    const grid = L / n; // 网格间距
    for (let z = 0; z < n; z++) {
      const z1 = (z + 1) % n;
      for (let x = 0; x < n; x++) {
        const x1 = (x + 1) % n;
        const i00 = z * n + x;
        const i10 = z * n + x1;
        const i01 = z1 * n + x;
        // P(x,z) = (x·grid + dx, h, z·grid + dz)
        // dP/dx (x 索引 +1)
        const dPx_x = grid + (disp[3 * i10] - disp[3 * i00]);
        const dPx_y = disp[3 * i10 + 1] - disp[3 * i00 + 1];
        const dPx_z = disp[3 * i10 + 2] - disp[3 * i00 + 2];
        // dP/dz (z 索引 +1)
        const dPz_x = disp[3 * i01] - disp[3 * i00];
        const dPz_y = disp[3 * i01 + 1] - disp[3 * i00 + 1];
        const dPz_z = grid + (disp[3 * i01 + 2] - disp[3 * i00 + 2]);
        // N = normalize(cross(dP/dz, dP/dx)) → y 朝上
        const nx = dPz_y * dPx_z - dPz_z * dPx_y;
        const ny = dPz_z * dPx_x - dPz_x * dPx_z;
        const nz = dPz_x * dPx_y - dPz_y * dPx_x;
        const len = Math.hypot(nx, ny, nz) || 1;
        const o = 3 * i00;
        this.normalMap[o] = nx / len;
        this.normalMap[o + 1] = ny / len;
        this.normalMap[o + 2] = nz / len;
      }
    }
    return this;
  }

  /**
   * 计算泡沫图 (Jacobian 行列式判定翻叠)。
   *   J = (1+∂dx/∂x)(1+∂dz/∂z) - (∂dx/∂z)(∂dz/∂x)
   *   foam = clamp((foamThreshold - J)·foamIntensity, 0, 1)
   * 平坦海面 J≈1 (无泡沫); 翻叠处 J<0 (满泡沫)。
   */
  computeFoam(): this {
    const n = this.resolution;
    const disp = this.displacementMap;
    if (!disp || disp.length !== 3 * n * n) return this;
    if (!this.foamMap || this.foamMap.length !== n * n) {
      this.foamMap = new Float32Array(n * n);
    }
    const L = this.physicalSize;
    const grid = L / n;
    const inv = 1 / grid;
    const threshold = this.foamThreshold;
    const intensity = this.foamIntensity;
    for (let z = 0; z < n; z++) {
      const z1 = (z + 1) % n;
      for (let x = 0; x < n; x++) {
        const x1 = (x + 1) % n;
        const i00 = z * n + x;
        const i10 = z * n + x1;
        const i01 = z1 * n + x;
        const dxX = (disp[3 * i10] - disp[3 * i00]) * inv; // ∂dx/∂x
        const dzZ = (disp[3 * i01 + 2] - disp[3 * i00 + 2]) * inv; // ∂dz/∂z
        const dxZ = (disp[3 * i01] - disp[3 * i00]) * inv; // ∂dx/∂z
        const dzX = (disp[3 * i10 + 2] - disp[3 * i00 + 2]) * inv; // ∂dz/∂x
        const J = (1 + dxX) * (1 + dzZ) - dxZ * dzX;
        let foam = (threshold - J) * intensity;
        if (foam < 0) foam = 0;
        else if (foam > 1) foam = 1;
        this.foamMap[i00] = foam;
      }
    }
    return this;
  }

  /**
   * 推进一帧:频谱演化 + IFFT + 位移 + 法线 + 泡沫。
   * @param dt 流逝时间 (秒)。
   */
  update(dt: number): this {
    if (dt < 0) dt = 0;
    this.time += dt;
    if (!this.h0) this.generateSpectrum();
    this.updateSpectrum(this.time);
    this.computeDisplacement();
    this.computeNormals();
    this.computeFoam();
    return this;
  }

  // ── 数据访问 ──────────────────────────────────────────

  /** 获取位移图 (可能为 null)。 */
  getDisplacementMap(): Float32Array | null {
    return this.displacementMap;
  }

  /** 获取法线图 (可能为 null)。 */
  getNormalMap(): Float32Array | null {
    return this.normalMap;
  }

  /** 获取泡沫图 (可能为 null)。 */
  getFoamMap(): Float32Array | null {
    return this.foamMap;
  }

  /** 获取着色器 uniform 集合。 */
  getShaderUniforms(): FFTOceanUniforms {
    return {
      u_resolution: this.resolution,
      u_physicalSize: this.physicalSize,
      u_windSpeed: this.windSpeed,
      u_windDirection: [this.windDirection.x, this.windDirection.z],
      u_waveAmplitude: this.waveAmplitude,
      u_choppyFactor: this.choppyFactor,
      u_foamThreshold: this.foamThreshold,
      u_foamIntensity: this.foamIntensity,
      u_deepWaterColor: [this.deepWaterColor.r, this.deepWaterColor.g, this.deepWaterColor.b],
      u_shallowWaterColor: [this.shallowWaterColor.r, this.shallowWaterColor.g, this.shallowWaterColor.b],
      u_foamColor: [this.foamColor.r, this.foamColor.g, this.foamColor.b],
      u_sunDirection: [this.sunDirection.x, this.sunDirection.y, this.sunDirection.z],
      u_sunColor: [this.sunColor.r, this.sunColor.g, this.sunColor.b],
      u_skyColor: [this.skyColor.r, this.skyColor.g, this.skyColor.b],
      u_time: this.time,
      u_displacementMap: { data: this.displacementMap, resolution: this.resolution, components: 3 },
      u_normalMap: { data: this.normalMap, resolution: this.resolution, components: 3 },
      u_foamMap: { data: this.foamMap, resolution: this.resolution, components: 1 },
    };
  }

  /** 获取运行时统计。 */
  getStats(): FFTOceanStats {
    const n = this.resolution;
    let bytes = 0;
    // 复数数组 2·N·N, 3 分量数组 3·N·N, 标量 N·N
    const f4 = 4; // Float32 元素字节数
    if (this.h0) bytes += 2 * n * n * f4;
    if (this.ht) bytes += 2 * n * n * f4;
    if (this._dxSpec) bytes += 2 * n * n * f4;
    if (this._dzSpec) bytes += 2 * n * n * f4;
    if (this.displacementMap) bytes += 3 * n * n * f4;
    if (this.normalMap) bytes += 3 * n * n * f4;
    if (this.foamMap) bytes += n * n * f4;
    return {
      resolution: this.resolution,
      physicalSize: this.physicalSize,
      windSpeed: this.windSpeed,
      windDirection: { x: this.windDirection.x, z: this.windDirection.z },
      waveAmplitude: this.waveAmplitude,
      choppyFactor: this.choppyFactor,
      foamThreshold: this.foamThreshold,
      foamIntensity: this.foamIntensity,
      time: this.time,
      h0Generated: this.h0 !== null,
      htGenerated: this.ht !== null,
      displacementGenerated: this.displacementMap !== null,
      normalGenerated: this.normalMap !== null,
      foamGenerated: this.foamMap !== null,
      memoryBytes: bytes,
    };
  }

  /** 释放所有缓冲 (置空)。 */
  dispose(): void {
    this.h0 = null;
    this.ht = null;
    this.displacementMap = null;
    this.normalMap = null;
    this.foamMap = null;
    this._dxSpec = null;
    this._dzSpec = null;
    this._rowScratch = null;
    this._colScratch = null;
    this.time = 0;
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 归一化风向 (零向量退化为 +x)。 */
  private _normalizeWind(): void {
    const len = Math.hypot(this.windDirection.x, this.windDirection.z);
    if (len > 0) {
      this.windDirection = { x: this.windDirection.x / len, z: this.windDirection.z / len };
    } else {
      this.windDirection = { x: 1, z: 0 };
    }
  }
}
