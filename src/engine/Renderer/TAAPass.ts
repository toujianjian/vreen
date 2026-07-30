// TAAPass — CPU 侧时间抗锯齿(Temporal Anti-Aliasing)Pass。
//
// 设计目标:
//   - 与 PostProcess/TAAPass.ts(GPU 纹理版)互补:本 Pass 在 CPU 侧维护
//     Float32Array 历史缓冲与速度缓冲,不依赖 WebGL 上下文,可在无头环境
//     (Node / 测试 / SSR)运行,适合离线渲染 / 截图 / 回放;
//   - 完整 TAA 流程:Halton 低差异序列抖动 → 投影矩阵偏移 → 当前帧渲染 →
//     重投影(velocity) → 邻域夹紧(AABB / Catmull-Rom) → 方差裁剪 →
//     历史混合 → 可选锐化;
//   - 与 MotionBlurPass.ts 同构:CPU 侧基于 Uint8ClampedArray 像素 +
//     Float32Array 速度缓冲,不持有 GL 资源,可在 Node 环境 vitest 中直跑。
//
// 流程:
//   1. 调用方在主场景渲染前调用 `getNextJitter()` 获取下一帧 Halton 抖动,
//      再调用 `applyJitter(projectionMatrix)` 把抖动叠加到相机投影矩阵。
//   2. 主场景用抖动后的投影矩阵渲染出当前帧 RGBA 像素。
//   3. 调用 `render(input, velocityBuffer, camera)` 执行 TAA:
//      a. 首帧:分配 historyBuffer,直接拷贝当前帧作为历史,返回当前帧副本;
//      b. 后续帧:逐像素 reproject → sample history(bilinear)→ neighborhood
//         clamp(AABB 或 Catmull-Rom 软夹紧)→ 可选 variance clip → resolve
//         (history * (1-blend) + current * blend)→ 可选 sharpen;
//      c. 把结果写入 historyBuffer 供下一帧使用。
//
// 不变量:
//   - 首帧(historyBuffer === null)输出 = 输入副本,history 初始化为输入;
//   - velocityBuffer 长度 = width * height * 2(RG 逐像素,像素单位);
//   - render 不修改输入 data 与传入 velocityBuffer,返回新分配的 Uint8ClampedArray;
//   - dispose / reset 后下一帧 render 视为首帧(重新建立 history);
//   - useCatmullRom=true 时邻域夹紧退化为软夹紧(加权收敛到邻域中心),
//     保留更多历史细节;useVarianceClip=true 时在 AABB 之上叠加方差裁剪。
//
// 参考:
//   - "High Quality Temporal Supersampling" (Karis 2014)
//   - "Temporal Antialiasing in NEXT" (Jimenez et al. 2012)
//   - PostProcess/TAAPass.ts(GPU 版,本类为其 CPU 回退)

import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import { createLogger } from '@/lib/logger';

const log = createLogger('TAAPass');

/** TAA 统计(上次 render 的指标)。 */
export interface TAAStats {
  /** 上次 render 处理的像素数。 */
  pixelsProcessed: number;
  /** 历史缓冲重置次数(首帧 / reset / 尺寸变更后 +1)。 */
  historyResets: number;
  /** 上一帧渲染耗时(ms)。 */
  lastFrameTimeMs: number;
  /** 当前 jitter 索引(Halton 序列位置)。 */
  jitterIndex: number;
  /** 当前是否启用。 */
  enabled: boolean;
  /** 当前 blendFactor。 */
  blendFactor: number;
  /** 当前 samples。 */
  samples: number;
  /** 当前 sharpness。 */
  sharpness: number;
  /** 当前 jitterScale。 */
  jitterScale: number;
}

/** TAAPass 构造选项。 */
export interface TAAOptions {
  /** 是否启用(默认 true)。禁用时 render 返回输入副本。 */
  enabled?: boolean;
  /** 抖动采样数(默认 8,典型 8-16)。Halton 序列长度上限。 */
  samples?: number;
  /** 历史混合因子(0..1,默认 0.1)。值越大当前帧权重越高,响应越快但越抖。 */
  blendFactor?: number;
  /** 锐化强度(默认 0.0,不锐化)。0 关闭,典型 0.2-0.5。 */
  sharpness?: number;
  /** 抖动缩放(像素,默认 1.0)。0 关闭 jitter。 */
  jitterScale?: number;
  /** 邻域夹紧是否使用 Catmull-Rom 软夹紧(默认 false,使用 AABB 硬夹紧)。 */
  useCatmullRom?: boolean;
  /** 是否启用方差裁剪(默认 false)。在 AABB 之上叠加 mean±N*stddev 裁剪。 */
  useVarianceClip?: boolean;
  /** 内部缓冲宽度(默认 256)。首次 render 会从输入同步。 */
  width?: number;
  /** 内部缓冲高度(默认 256)。 */
  height?: number;
}

/** render 输入:RGBA 像素数据 + 尺寸。 */
export interface TAAInput {
  /** RGBA 字节流,长度 = width * height * 4。 */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 相机结构类型:任何带 projectionMatrix 的对象都可接受(解耦具体 Camera 类)。 */
export interface TAACamera {
  projectionMatrix: Matrix4;
  matrixWorldInverse?: Matrix4;
  position?: Vector3;
}

/** 2D 向量(像素或 UV 单位由调用上下文决定)。 */
export interface Vec2 {
  x: number;
  y: number;
}

/** RGB 颜色三元组(浮点,范围 0..255 与输入像素一致)。 */
type RGB = [number, number, number];

/** 3x3 邻域(9 个 RGB 颜色,顺序:左上→右下,行优先)。 */
type Neighborhood = [RGB, RGB, RGB, RGB, RGB, RGB, RGB, RGB, RGB];

/**
 * CPU 侧时间抗锯齿 Pass。维护 Float32Array 历史缓冲,不依赖 WebGL。
 *
 * 典型每帧用法:
 *   1. const j = taa.getNextJitter();              // 推进 Halton 序列
 *   2. taa.applyJitter(camera.projectionMatrix);   // 抖动叠加到投影
 *   3. 用 camera 渲染主场景 → currPixels
 *   4. const out = taa.render({ data: currPixels, width, height }, velocityBuffer, camera);
 */
export class TAAPass {
  readonly name = 'taa';

  enabled: boolean = true;
  /** 抖动采样数(Halton 序列长度,8-16 典型)。 */
  samples: number = 8;
  /** 历史混合因子(0..1)。 */
  blendFactor: number = 0.1;
  /** 锐化强度(0=不锐化)。 */
  sharpness: number = 0.0;
  /** 抖动缩放(像素)。 */
  jitterScale: number = 1.0;

  /** 历史缓冲(RGBA float,长度 = width*height*4);null 表示未分配。 */
  historyBuffer: Float32Array | null = null;
  /** 当前帧速度缓冲(RG 逐像素,像素单位);null 时按 0 速度处理。 */
  velocityBuffer: Float32Array | null = null;
  /** 当前 jitter(像素单位)。 */
  currentJitter: Vec2 = { x: 0, y: 0 };
  /** 当前 Halton 序列索引。 */
  jitterIndex: number = 0;
  /** 邻域夹紧是否使用 Catmull-Rom 软夹紧。 */
  useCatmullRom: boolean = false;
  /** 是否启用方差裁剪。 */
  useVarianceClip: boolean = false;

  /** 内部缓冲宽度。 */
  width: number = 256;
  /** 内部缓冲高度。 */
  height: number = 256;

  private _stats: TAAStats = {
    pixelsProcessed: 0,
    historyResets: 0,
    lastFrameTimeMs: 0,
    jitterIndex: 0,
    enabled: true,
    blendFactor: 0.1,
    samples: 8,
    sharpness: 0.0,
    jitterScale: 1.0,
  };

  constructor(opts: TAAOptions = {}) {
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.samples !== undefined) this.samples = Math.max(1, Math.floor(opts.samples));
    if (opts.blendFactor !== undefined) this.blendFactor = opts.blendFactor;
    if (opts.sharpness !== undefined) this.sharpness = opts.sharpness;
    if (opts.jitterScale !== undefined) this.jitterScale = opts.jitterScale;
    if (opts.useCatmullRom !== undefined) this.useCatmullRom = opts.useCatmullRom;
    if (opts.useVarianceClip !== undefined) this.useVarianceClip = opts.useVarianceClip;
    if (opts.width !== undefined) this.width = Math.max(1, Math.floor(opts.width));
    if (opts.height !== undefined) this.height = Math.max(1, Math.floor(opts.height));
  }

  // ── setters ────────────────────────────────────────────────────────

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 设置采样数(1..1024,超出范围 clamp)。 */
  setSamples(samples: number): void {
    this.samples = Math.max(1, Math.min(1024, Math.floor(samples)));
  }

  /** 设置混合因子(0..1,超出范围 clamp)。 */
  setBlendFactor(factor: number): void {
    this.blendFactor = Math.max(0, Math.min(1, factor));
  }

  /** 设置锐化强度(0..1,超出范围 clamp)。 */
  setSharpness(sharpness: number): void {
    this.sharpness = Math.max(0, Math.min(1, sharpness));
  }

  /** 设置抖动缩放(>=0)。 */
  setJitterScale(scale: number): void {
    this.jitterScale = Math.max(0, scale);
  }

  /** 设置内部缓冲尺寸(下次 render 检测到尺寸不匹配时重新分配)。 */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      // 尺寸变更:清历史(下次 render 视为首帧)
      this.historyBuffer = null;
    }
  }

  // ── jitter ─────────────────────────────────────────────────────────

  /** 获取当前抖动偏移(像素单位)。 */
  getJitter(): Vec2 {
    return { x: this.currentJitter.x, y: this.currentJitter.y };
  }

  /**
   * 获取下一个抖动偏移(Halton 序列),推进 jitterIndex 并写入 currentJitter。
   *
   * Halton(2,3) 序列在 [0,1)² 上分布,减去 0.5 后映射到 [-0.5, 0.5]²,
   * 再乘 jitterScale(像素)得到像素偏移。
   *
   * @returns 当前 jitter(像素单位),范围 [-jitterScale/2, jitterScale/2]
   */
  getNextJitter(): Vec2 {
    const idx = this.jitterIndex % Math.max(1, this.samples);
    const hx = halton(idx, 2) - 0.5;
    const hy = halton(idx, 3) - 0.5;
    this.currentJitter.x = hx * this.jitterScale;
    this.currentJitter.y = hy * this.jitterScale;
    this.jitterIndex = (this.jitterIndex + 1) % Math.max(1, this.samples);
    return { x: this.currentJitter.x, y: this.currentJitter.y };
  }

  /**
   * 把 currentJitter 叠加到投影矩阵(原地修改)。
   *
   * 投影矩阵的 [2][0] / [2][1](column-major 索引 8 / 9)对应 NDC xy 偏移。
   * 像素 → NDC 转换:ndc = pixel * 2 / dimension。
   *
   * 若 width / height 为 0(尚未 render),记录警告并跳过。
   *
   * @param projectionMatrix  待修改的投影矩阵(通常是 camera.projectionMatrix)
   * @returns                 修改后的矩阵(同一引用,便于链式)
   */
  applyJitter(projectionMatrix: Matrix4): Matrix4 {
    if (this.width <= 0 || this.height <= 0) {
      log.warn('applyJitter called before dimensions known; skipping');
      return projectionMatrix;
    }
    const ndcX = (this.currentJitter.x * 2) / this.width;
    const ndcY = (this.currentJitter.y * 2) / this.height;
    const e = projectionMatrix.elements;
    e[8] += ndcX;
    e[9] += ndcY;
    return projectionMatrix;
  }

  // ── 核心算法(公开,便于单测) ──────────────────────────────────────

  /**
   * 重投影:根据当前像素 UV 与速度,求上一帧该像素的 UV。
   *
   * @param currentUV  当前帧像素 UV(0..1)
   * @param velocity   速度(UV 单位,0..1;prevUV = currentUV - velocity)
   * @returns          上一帧 UV(可能越界,由调用方裁剪)
   */
  reproject(currentUV: Vec2, velocity: Vec2): Vec2 {
    return { x: currentUV.x - velocity.x, y: currentUV.y - velocity.y };
  }

  /**
   * 邻域夹紧:把 history 颜色夹到 current 邻域的 AABB 内(硬夹紧)。
   *
   * useCatmullRom=true 时改用软夹紧:history 与邻域中心做 Catmull-Rom 加权混合,
   * 保留更多历史细节(残影更明显但更平滑)。
   *
   * @param current  3x3 邻域(9 个 RGB)
   * @param history  历史 RGB
   * @returns         夹紧后的历史 RGB
   */
  neighborhoodClamp(current: Neighborhood, history: RGB): RGB {
    if (this.useCatmullRom) {
      // 软夹紧:Catmull-Rom 核(中心权重 0.5,上下左右 0.125,对角 0.0)
      // 实际是把 history 朝邻域中心收敛 50%,保留 50% 原值
      const center = current[4];
      const out: RGB = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        out[c] = history[c] * 0.5 + center[c] * 0.5;
      }
      return out;
    }

    // 硬夹紧:AABB clamp
    let rMin = Infinity, gMin = Infinity, bMin = Infinity;
    let rMax = -Infinity, gMax = -Infinity, bMax = -Infinity;
    for (let i = 0; i < 9; i++) {
      const c = current[i];
      if (c[0] < rMin) rMin = c[0];
      if (c[0] > rMax) rMax = c[0];
      if (c[1] < gMin) gMin = c[1];
      if (c[1] > gMax) gMax = c[1];
      if (c[2] < bMin) bMin = c[2];
      if (c[2] > bMax) bMax = c[2];
    }
    return [
      clamp(history[0], rMin, rMax),
      clamp(history[1], gMin, gMax),
      clamp(history[2], bMin, bMax),
    ];
  }

  /**
   * 方差裁剪:计算 current 邻域的 mean / stddev,把 history 夹到
   * [mean - N*stddev, mean + N*stddev](N=1.0)。
   *
   * 通常在 neighborhoodClamp 之后调用,进一步抑制历史离群值。
   * 若 stddev 接近 0(均匀区域),返回 history 不变。
   *
   * @param current  3x3 邻域
   * @param history  待裁剪的 RGB(通常已过 neighborhoodClamp)
   * @returns         方差裁剪后的 RGB
   */
  varianceClip(current: Neighborhood, history: RGB): RGB {
    const N = 1.0; // 标准差倍数
    const out: RGB = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let mean = 0;
      for (let i = 0; i < 9; i++) mean += current[i][c];
      mean /= 9;
      let variance = 0;
      for (let i = 0; i < 9; i++) {
        const d = current[i][c] - mean;
        variance += d * d;
      }
      variance /= 9;
      const stddev = Math.sqrt(variance);
      if (stddev < 1e-6) {
        out[c] = history[c];
      } else {
        out[c] = clamp(history[c], mean - N * stddev, mean + N * stddev);
      }
    }
    return out;
  }

  /**
   * 混合当前与历史:`current * blendFactor + history * (1 - blendFactor)`。
   *
   * @param current  当前帧 RGB
   * @param history  历史 RGB(已过夹紧 / 裁剪)
   * @returns         混合后的 RGB
   */
  resolve(current: RGB, history: RGB): RGB {
    const b = this.blendFactor;
    return [
      current[0] * b + history[0] * (1 - b),
      current[1] * b + history[1] * (1 - b),
      current[2] * b + history[2] * (1 - b),
    ];
  }

  /**
   * 锐化(Unsharp Mask):out = input + amount * (input - blurred)。
   * blurred 用 3x3 box filter 计算。
   *
   * @param input   RGBA 字节流
   * @param width   宽度
   * @param height  高度
   * @param amount  锐化强度(0..1)
   * @returns        锐化后的 RGBA(新分配)
   */
  sharpen(input: Uint8ClampedArray, width: number, height: number, amount: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(input.length);
    if (amount <= 0) {
      out.set(input);
      return out;
    }
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const di = (py * width + px) * 4;
        // 3x3 box blur(边缘像素 clamp 到边界)
        let r = 0, g = 0, b = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = clampi(px + dx, 0, width - 1);
            const sy = clampi(py + dy, 0, height - 1);
            const si = (sy * width + sx) * 4;
            r += input[si];
            g += input[si + 1];
            b += input[si + 2];
            count++;
          }
        }
        r /= count; g /= count; b /= count;
        // Unsharp: out = in + amount * (in - blurred)
        out[di] = clampByte(input[di] + amount * (input[di] - r));
        out[di + 1] = clampByte(input[di + 1] + amount * (input[di + 1] - g));
        out[di + 2] = clampByte(input[di + 2] + amount * (input[di + 2] - b));
        out[di + 3] = input[di + 3];
      }
    }
    return out;
  }

  // ── render ─────────────────────────────────────────────────────────

  /**
   * 执行 TAA。
   *
   * @param input           输入像素(当前帧 RGBA)
   * @param velocityBuffer  速度缓冲(RG 逐像素,像素单位);null 时用 this.velocityBuffer
   * @param camera          当前相机(主要预留,当前实现不强依赖)
   * @returns                抗锯齿后的 RGBA(新分配)
   */
  render(
    input: TAAInput,
    velocityBuffer: Float32Array | null,
    camera: TAACamera,
  ): Uint8ClampedArray {
    void camera; // 当前实现不依赖 camera;预留供未来扩展(如内部计算速度)
    const t0 = performance.now();
    const { data, width: iw, height: ih } = input;
    const out = new Uint8ClampedArray(data.length);

    if (!this.enabled) {
      out.set(data);
      this._updateStats(0, t0);
      return out;
    }

    // 同步尺寸(尺寸变更触发历史重置)
    if (iw !== this.width || ih !== this.height) {
      this.setSize(iw, ih);
    }

    const vbuf = velocityBuffer !== null ? velocityBuffer : this.velocityBuffer;
    // blendFactor 在 resolve() 内通过 this.blendFactor 读取,此处无需局部变量

    // 首帧:historyBuffer 为 null → 直接拷贝当前帧作为历史,返回当前帧副本
    if (!this.historyBuffer) {
      this.historyBuffer = new Float32Array(iw * ih * 4);
      for (let i = 0; i < data.length; i++) {
        this.historyBuffer[i] = data[i];
      }
      out.set(data);
      this._stats.historyResets++;
      this._updateStats(iw * ih, t0);
      log.debug(`historyBuffer initialized: ${iw}x${ih} (first frame)`);
      return out;
    }

    // 后续帧:逐像素 TAA
    const history = this.historyBuffer;
    const tmpResolved = new Float32Array(iw * ih * 4);

    for (let py = 0; py < ih; py++) {
      for (let px = 0; px < iw; px++) {
        const pi = py * iw + px;
        const di = pi * 4;

        // 当前像素 RGB
        const curR = data[di];
        const curG = data[di + 1];
        const curB = data[di + 2];

        // 速度(像素单位 → UV 单位)
        let velX = 0, velY = 0;
        if (vbuf) {
          velX = vbuf[pi * 2] / iw;
          velY = vbuf[pi * 2 + 1] / ih;
        }

        // 重投影:prevUV = currentUV - velocity(使用像素中心 UV)
        const currU = (px + 0.5) / iw;
        const currV = (py + 0.5) / ih;
        const prevU = currU - velX;
        const prevV = currV - velY;

        // 双线性采样 history
        const hist = sampleBilinear(history, iw, ih, prevU, prevV);

        // 3x3 邻域(从当前帧 data 提取)
        const neighborhood = extractNeighborhood(data, iw, ih, px, py);

        // 邻域夹紧
        let clamped: RGB = this.neighborhoodClamp(neighborhood, [hist[0], hist[1], hist[2]]);

        // 方差裁剪(可选)
        if (this.useVarianceClip) {
          clamped = this.varianceClip(neighborhood, clamped);
        }

        // 混合
        const resolved = this.resolve([curR, curG, curB], clamped);

        // 写入临时缓冲(浮点)
        tmpResolved[di] = resolved[0];
        tmpResolved[di + 1] = resolved[1];
        tmpResolved[di + 2] = resolved[2];
        tmpResolved[di + 3] = data[di + 3];
      }
    }

    // 可选锐化(对字节输出做 unsharp mask)
    if (this.sharpness > 0) {
      // 先把 tmpResolved 转 byte
      const tmpByte = new Uint8ClampedArray(data.length);
      for (let i = 0; i < tmpResolved.length; i++) {
        tmpByte[i] = clampByte(tmpResolved[i]);
      }
      const sharpened = this.sharpen(tmpByte, iw, ih, this.sharpness);
      out.set(sharpened);
    } else {
      // 直接转 byte
      for (let i = 0; i < tmpResolved.length; i++) {
        out[i] = clampByte(tmpResolved[i]);
      }
    }

    // 把本帧结果写入 history(供下一帧使用)
    for (let i = 0; i < tmpResolved.length; i++) {
      history[i] = tmpResolved[i];
    }

    this._updateStats(iw * ih, t0);
    return out;
  }

  /** 获取历史缓冲(只读查询;调用方不得修改)。 */
  getHistoryBuffer(): Float32Array | null {
    return this.historyBuffer;
  }

  /** 重置:清空历史(下一帧 render 视为首帧)。jitterIndex 不变。 */
  reset(): void {
    this.historyBuffer = null;
    this.velocityBuffer = null;
    this._stats.historyResets++;
    log.debug('reset');
  }

  /** 获取统计。 */
  getStats(): TAAStats {
    return { ...this._stats };
  }

  /** 释放状态:清空缓冲(等价于 reset,语义对齐 MotionBlurPass.dispose)。 */
  dispose(): void {
    this.historyBuffer = null;
    this.velocityBuffer = null;
    this.currentJitter = { x: 0, y: 0 };
    this.jitterIndex = 0;
    this._stats = {
      pixelsProcessed: 0,
      historyResets: 0,
      lastFrameTimeMs: 0,
      jitterIndex: 0,
      enabled: this.enabled,
      blendFactor: this.blendFactor,
      samples: this.samples,
      sharpness: this.sharpness,
      jitterScale: this.jitterScale,
    };
    log.debug('disposed');
  }

  // ── private ────────────────────────────────────────────────────────

  private _updateStats(pixelsProcessed: number, t0: number): void {
    this._stats.pixelsProcessed = pixelsProcessed;
    this._stats.lastFrameTimeMs = performance.now() - t0;
    this._stats.jitterIndex = this.jitterIndex;
    this._stats.enabled = this.enabled;
    this._stats.blendFactor = this.blendFactor;
    this._stats.samples = this.samples;
    this._stats.sharpness = this.sharpness;
    this._stats.jitterScale = this.jitterScale;
  }
}

// ── Halton 序列 ─────────────────────────────────────────────────────
// Halton(i, b):基 b 上的低差异序列,i 从 0 开始。
// 把 i 写成基 b 表示,然后按 radical inverse 计算。
function halton(index: number, base: number): number {
  let f = 1.0;
  let r = 0.0;
  let i = Math.max(0, Math.floor(index));
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

// ── helpers ─────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function clampi(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

/**
 * 双线性采样 RGBA Float32Array(UV 单位,0..1)。
 * UV 越界时 clamp 到边缘。
 */
function sampleBilinear(
  data: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
): [number, number, number, number] {
  // UV → 像素坐标(中心对齐)
  const fx = clamp(u * width - 0.5, 0, width - 1);
  const fy = clamp(v * height - 0.5, 0, height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;

  const r = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
  const g = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
  const b = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
  const a = data[i00 + 3] * w00 + data[i10 + 3] * w10 + data[i01 + 3] * w01 + data[i11 + 3] * w11;

  return [r, g, b, a];
}

/** 从 RGBA 字节流提取 3x3 邻域(边缘像素 clamp 到边界)。行优先:左上→右下。 */
function extractNeighborhood(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  px: number,
  py: number,
): Neighborhood {
  const result: RGB[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sx = clampi(px + dx, 0, width - 1);
      const sy = clampi(py + dy, 0, height - 1);
      const si = (sy * width + sx) * 4;
      result.push([data[si], data[si + 1], data[si + 2]]);
    }
  }
  return result as Neighborhood;
}
