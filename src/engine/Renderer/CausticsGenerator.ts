// CausticsGenerator — 水下焦散 CPU 参考实现(与 GLSL `CAUSTICS_FRAG` 1:1 对应)。
//
// 设计目标:
//   - 为 CausticsPass(GPU 版)提供无头可测试的纯函数参考实现;
//   - 在原有 3-sine 程序化焦散之上,新增物理更准确的 Gerstner 波 + 法线聚焦模式;
//   - 匹配 UE5 Water / o3de Atom Water caustics 的质量级别。
//
// 三种焦散模式:
//   1. 'procedural' — 原有 3 方向正弦波叠加(快速、艺术化,与 WaterSurfacePass 无关);
//   2. 'gerstner'   — 在水面 XZ 处计算 Gerstner 波法线,用法线-光向点积的幂
//      模拟光线聚焦(物理正确:水面凸起处法线指向太阳 → 光线汇聚 → 亮带);
//   3. 'hybrid'      — procedural × gerstner,既有程序化纹理细节又有物理聚焦(默认推荐)。
//
// 算法(参考):
//   - GPU Gems 2 Ch.18 "Effective Water Simulation" — 3-sine 程序化焦散
//   - Shah & Konttinen 2005 "Caustic Mapping" — 法线聚焦因子
//   - Tessendorf 2001 "Simulating Ocean Water" — Gerstner 波模型
//   - UE5 Water plugin / o3de Atom Water — 工业级实现参考
//
// 不变量:
//   - 纯函数不修改输入数据,返回新值/新数组;
//   - 所有角度/方向用归一化向量;
//   - 焦散强度非负(负值钳为 0);
//   - Beer-Lambert 衰减单调递减(深度增加 → 衰减增加);
//   - 水面以上(worldY > waterLevel)焦散 = 0;
//   - 天空(depth >= 1.0)焦散 = 0。

import { createLogger } from '@/lib/logger';

const log = createLogger('CausticsGenerator');

// ── 类型 ──────────────────────────────────────────────────────────

/** 2D 向量。 */
export interface Vec2 { x: number; y: number; }
/** 3D 向量。 */
export interface Vec3 { x: number; y: number; z: number; }

/** 焦散模式。 */
export type CausticMode = 'procedural' | 'gerstner' | 'hybrid';

/** Gerstner 波参数(单组波)。 */
export interface GerstnerWave {
  /** 水平传播方向(归一化)。 */
  dir: Vec2;
  /** 振幅(世界单位)。 */
  amplitude: number;
  /** 波长(世界单位)。频率 w = 2π / wavelength。 */
  wavelength: number;
  /** 相位速度(世界单位/秒)。 */
  speed: number;
  /** 陡度因子(0..1/(w*A),控制波峰锐度)。 */
  steepness: number;
}

/** CausticsGenerator 选项。 */
export interface CausticsOptions {
  /** 焦散模式(默认 'hybrid')。 */
  mode?: CausticMode;
  /** 焦散颜色 RGB(0..1,默认 [0.2, 0.7, 0.9] 青蓝)。 */
  causticColor?: Vec3;
  /** 焦散强度(默认 0.6)。 */
  causticIntensity?: number;
  /** 水面高度(世界 Y,默认 0)。 */
  waterLevel?: number;
  /** 世界→UV 缩放(默认 8,procedural 模式用)。 */
  worldScale?: number;
  /** 波纹动画速度(默认 0.8)。 */
  waveSpeed?: number;
  /** 波纹频率(默认 8,procedural 模式用)。 */
  waveFrequency?: number;
  /** 相位偏移(默认 0)。 */
  wavePhase?: number;
  /** 深度吸收率(默认 0.02,Beer-Lambert)。 */
  absorption?: number;
  /** RGB 色散偏移(默认 0.3,0 = 无色散)。 */
  dispersion?: number;
  /** 聚焦幂(默认 3.0,越大亮带越锐利)。 */
  power?: number;
  /** 太阳方向(归一化,默认 [0.5, -1.0, 0.3],gerstner/hybrid 模式用)。 */
  lightDir?: Vec3;
  /** 水面线渐变范围(世界单位,默认 1.0)。越接近水面渐变越平滑。 */
  waterLineFade?: number;
  /** Gerstner 波参数数组(gerstner/hybrid 模式用,默认 4 组波)。 */
  waves?: GerstnerWave[];
  /** 时序累积 EMA 系数 [0, 0.95)(默认 0 = 禁用)。 */
  temporalBlend?: number;
}

/** CausticsGenerator 统计(调试用)。 */
export interface CausticsStats {
  /** 处理的像素数。 */
  pixelsProcessed: number;
  /** 应用焦散的像素数(水面以下 + 非天空)。 */
  causticPixels: number;
  /** 平均焦散强度(0..1)。 */
  avgIntensity: number;
  /** 最大焦散强度(0..1)。 */
  maxIntensity: number;
  /** 上一帧总耗时(ms)。 */
  lastFrameTimeMs: number;
}

// ── 默认 Gerstner 波 ─────────────────────────────────────────────

/**
 * 4 组默认 Gerstner 波(与 WaterSurfacePass 一致,覆盖 4 个主方向)。
 * 振幅递减、波长递增,模拟海浪多频叠加。
 */
export function defaultGerstnerWaves(): GerstnerWave[] {
  return [
    { dir: normalize2(1.0, 0.6),  amplitude: 0.20, wavelength: 8.0,  speed: 1.2, steepness: 0.8 },
    { dir: normalize2(-0.7, 0.8), amplitude: 0.15, wavelength: 12.0, speed: 1.0, steepness: 0.7 },
    { dir: normalize2(0.3, -0.9), amplitude: 0.10, wavelength: 5.0,  speed: 1.5, steepness: 0.6 },
    { dir: normalize2(-0.5, -0.5),amplitude: 0.06, wavelength: 3.0,  speed: 1.8, steepness: 0.5 },
  ];
}

// ── 向量工具 ──────────────────────────────────────────────────────

/** 归一化 2D 向量。 */
export function normalize2(x: number, y: number): Vec2 {
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-10) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

/** 归一化 3D 向量。 */
export function normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-10) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** 3D 点积。 */
export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** 2D 点积。 */
export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

// ── 阶段 1:程序化 3-sine 焦散 ────────────────────────────────────

/**
 * 三方向正弦波叠加焦散图案(与 CAUSTICS_FRAG.causticPattern 1:1 对应)。
 *
 * 算法:三组方向(30°/120°/-60°)正弦波叠加,取正瓣并幂增强。
 *
 * @param p        世界 XZ 投影 UV(已缩放)
 * @param time     时间(秒)
 * @param frequency 波纹频率
 * @param speed    波纹速度
 * @param power    聚焦幂(>1 增强亮带)
 * @returns        焦散强度 [0, 1]
 */
export function causticPattern3Sin(
  p: Vec2,
  time: number,
  frequency: number = 8,
  speed: number = 0.8,
  power: number = 3.0,
): number {
  const t = time * speed;
  // 三组方向:30°/120°/-60°(单位向量)
  const w1 = Math.sin(dot2(p, { x: 0.8660, y: 0.5000 }) * frequency + t * 1.3);
  const w2 = Math.sin(dot2(p, { x: -0.5000, y: 0.8660 }) * frequency + t * 1.7);
  const w3 = Math.sin(dot2(p, { x: 0.5000, y: -0.8660 }) * frequency + t * 0.9);
  const s = (w1 + w2 + w3) / 3.0; // [-1, 1]
  // 仅保留正瓣并幂增强(光线聚焦处更亮)
  return Math.pow(Math.max(0, s), power);
}

// ── 阶段 2:Gerstner 波法线 ───────────────────────────────────────

/**
 * 在水面 (x, z) 处计算 Gerstner 波叠加的高度与法线。
 *
 * Gerstner 波参数化:
 *   x' = x + Σ Q_i A_i D_i.x cos(w_i (D_i · (x,z)) + φ_i t)
 *   y' = Σ A_i sin(w_i (D_i · (x,z)) + φ_i t)
 *   z' = z + Σ Q_i A_i D_i.z cos(w_i (D_i · (x,z)) + φ_i t)
 *
 * 法线(解析):
 *   Nx = -Σ D_i.x w_i A_i cos(...)
 *   Ny = 1 - Σ Q_i w_i A_i sin(...)
 *   Nz = -Σ D_i.z w_i A_i cos(...)
 *
 * @param x, z   水面水平坐标
 * @param time   时间(秒)
 * @param waves  Gerstner 波参数数组
 * @returns      { height, normal }(normal 已归一化)
 */
export function gerstnerHeightNormal(
  x: number,
  z: number,
  time: number,
  waves: GerstnerWave[],
): { height: number; normal: Vec3 } {
  let height = 0;
  let nx = 0;
  let ny = 1;
  let nz = 0;

  for (const w of waves) {
    const wFreq = (2 * Math.PI) / w.wavelength;
    const phase = wFreq * dot2(w.dir, { x, y: z }) + w.speed * time;
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);
    const WA = wFreq * w.amplitude;

    height += w.amplitude * sinP;

    // 法线分量(解析导数)
    nx -= w.dir.x * WA * cosP;
    ny -= w.steepness * WA * sinP;
    nz -= w.dir.y * WA * cosP;
  }

  const normal = normalize3({ x: nx, y: ny, z: nz });
  return { height, normal };
}

// ── 阶段 3:法线聚焦因子 ─────────────────────────────────────────

/**
 * 基于水面法线与太阳方向的焦散聚焦因子。
 *
 * 物理原理:水面凸起处法线指向太阳 → 折射光线汇聚 → 亮带;
 * 水面凹陷处法线背离太阳 → 折射光线发散 → 暗带。
 *
 * 近似(Shah & Konttinen 2005 "Caustic Mapping"):
 *   focusing = max(0, dot(N, -L))^power
 *
 * 其中 N 为水面法线,L 为太阳方向(指向太阳)。
 *
 * @param surfaceNormal  水面法线(归一化)
 * @param lightDir       太阳方向(归一化,指向太阳)
 * @param power          聚焦幂(默认 8,越大亮带越锐利)
 * @returns              聚焦因子 [0, 1]
 */
export function causticFocusing(
  surfaceNormal: Vec3,
  lightDir: Vec3,
  power: number = 8.0,
): number {
  const d = dot3(surfaceNormal, { x: -lightDir.x, y: -lightDir.y, z: -lightDir.z });
  return Math.pow(Math.max(0, d), power);
}

// ── 阶段 4:Beer-Lambert 深度衰减 ────────────────────────────────

/**
 * Beer-Lambert 深度衰减:越深焦散越弱。
 *
 * atten = 1 / (1 + depth * absorption)
 *
 * @param depth      水面以下深度(世界单位,>= 0)
 * @param absorption 吸收率(默认 0.02)
 * @returns          衰减因子 (0, 1]
 */
export function beerLambertAttenuation(
  depth: number,
  absorption: number = 0.02,
): number {
  if (depth <= 0) return 1.0;
  return 1.0 / (1.0 + depth * absorption);
}

// ── 阶段 5:水面线渐变 ───────────────────────────────────────────

/**
 * 水面线平滑渐变:越接近水面焦散越弱(避免硬边)。
 *
 * fade = clamp(depthBelow / fadeRange, 0, 1)
 *
 * @param worldY     像素世界 Y
 * @param waterLevel 水面高度
 * @param fadeRange  渐变范围(世界单位)
 * @returns          渐变因子 [0, 1](0 = 水面线上,1 = 充分水下)
 */
export function waterLineFade(
  worldY: number,
  waterLevel: number,
  fadeRange: number = 1.0,
): number {
  if (worldY >= waterLevel) return 0;
  const depthBelow = waterLevel - worldY;
  if (fadeRange <= 0) return 1;
  return Math.max(0, Math.min(1, depthBelow / fadeRange));
}

// ── 阶段 6:RGB 色散 ─────────────────────────────────────────────

/**
 * RGB 色散采样:对 R/G/B 三通道用略有偏移的 UV 采样焦散图案。
 *
 * @param uv         基础 UV
 * @param dispersion 色散偏移量(0 = 无色散)
 * @param patternFn  焦散图案函数 (uv → 强度)
 * @returns          [r, g, b] 焦散强度
 */
export function rgbDispersion(
  uv: Vec2,
  dispersion: number,
  patternFn: (uv: Vec2) => number,
): [number, number, number] {
  if (dispersion <= 0) {
    const v = patternFn(uv);
    return [v, v, v];
  }
  const r = patternFn({ x: uv.x + dispersion * 0.5, y: uv.y });
  const g = patternFn(uv);
  const b = patternFn({ x: uv.x - dispersion * 0.5, y: uv.y });
  return [r, g, b];
}

// ── 主入口:单像素焦散计算 ──────────────────────────────────────

/**
 * 在单个世界位置计算焦散颜色与强度。
 *
 * 流程:
 *   1. 水面以上 → 返回 0;
 *   2. 计算水面线渐变 + Beer-Lambert 深度衰减;
 *   3. 按模式计算焦散图案:
 *      - 'procedural': 3-sine 叠加;
 *      - 'gerstner':   Gerstner 法线聚焦;
 *      - 'hybrid':     procedural × gerstner;
 *   4. RGB 色散偏移;
 *   5. 输出焦散颜色 = causticColor × pattern × intensity × depthAtten × lineFade。
 *
 * @param worldPos  世界位置
 * @param time      时间(秒)
 * @param opts      选项
 * @returns         { r, g, b } 焦散颜色(加性合成用,已含 intensity × atten)
 */
export function computeCaustics(
  worldPos: Vec3,
  time: number,
  opts: CausticsOptions = {},
): Vec3 {
  const mode = opts.mode ?? 'hybrid';
  const causticColor = opts.causticColor ?? { x: 0.2, y: 0.7, z: 0.9 };
  const intensity = opts.causticIntensity ?? 0.6;
  const waterLevel = opts.waterLevel ?? 0;
  const worldScale = opts.worldScale ?? 8;
  const waveSpeed = opts.waveSpeed ?? 0.8;
  const waveFrequency = opts.waveFrequency ?? 8;
  const wavePhase = opts.wavePhase ?? 0;
  const absorption = opts.absorption ?? 0.02;
  const dispersion = opts.dispersion ?? 0.3;
  const power = opts.power ?? 3.0;
  const lightDir = normalize3(opts.lightDir ?? { x: 0.5, y: -1.0, z: 0.3 });
  const fadeRange = opts.waterLineFade ?? 1.0;
  const waves = opts.waves ?? defaultGerstnerWaves();

  // 水面以上 → 无焦散
  if (worldPos.y > waterLevel) {
    return { x: 0, y: 0, z: 0 };
  }

  const depthBelow = waterLevel - worldPos.y;
  const depthAtten = beerLambertAttenuation(depthBelow, absorption);
  const lineFade = waterLineFade(worldPos.y, waterLevel, fadeRange);

  // 水面 XZ 投影 UV
  const baseUV: Vec2 = {
    x: worldPos.x / worldScale + wavePhase,
    y: worldPos.z / worldScale + wavePhase,
  };

  // 焦散图案函数(用于 RGB 色散)
  const patternFn = (uv: Vec2): number => {
    let value: number;

    if (mode === 'procedural') {
      value = causticPattern3Sin(uv, time, waveFrequency, waveSpeed, power);
    } else if (mode === 'gerstner') {
      // 在水面 (x, z) 处计算 Gerstner 法线 → 聚焦因子
      const { normal } = gerstnerHeightNormal(worldPos.x, worldPos.z, time, waves);
      value = causticFocusing(normal, lightDir, power * 2.0);
    } else {
      // hybrid: procedural × gerstner
      const proc = causticPattern3Sin(uv, time, waveFrequency, waveSpeed, power);
      const { normal } = gerstnerHeightNormal(worldPos.x, worldPos.z, time, waves);
      const focus = causticFocusing(normal, lightDir, power * 2.0);
      value = proc * focus;
    }

    return value;
  };

  // RGB 色散
  const [r, g, b] = rgbDispersion(baseUV, dispersion, patternFn);

  // 合成
  const factor = intensity * depthAtten * lineFade;
  return {
    x: causticColor.x * r * factor,
    y: causticColor.y * g * factor,
    z: causticColor.z * b * factor,
  };
}

// ── 全屏 resolve:像素缓冲级 ─────────────────────────────────────

/** RGBA 像素缓冲(Uint8,0-255)。 */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 深度缓冲(Float32,NDC [0,1])。 */
export interface DepthBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * 从 NDC 深度 + 逆 viewProjection 重建世界位置。
 *
 * @param ndcX, ndcY  NDC 坐标 [-1, 1]
 * @param ndcZ         NDC 深度 [-1, 1](从 depth*2-1 得)
 * @param inverseVP    逆 viewProjection 矩阵(列主序 16 元素)
 * @returns            世界位置 { x, y, z }
 */
export function reconstructWorldPos(
  ndcX: number,
  ndcY: number,
  ndcZ: number,
  inverseVP: Float32Array,
): Vec3 {
  // worldPos = inverseVP * vec4(ndc, 1)
  const w =
    inverseVP[3] * ndcX + inverseVP[7] * ndcY + inverseVP[11] * ndcZ + inverseVP[15];
  if (Math.abs(w) < 1e-10) return { x: 0, y: 0, z: 0 };
  const invW = 1 / w;
  return {
    x: (inverseVP[0] * ndcX + inverseVP[4] * ndcY + inverseVP[8] * ndcZ + inverseVP[12]) * invW,
    y: (inverseVP[1] * ndcX + inverseVP[5] * ndcY + inverseVP[9] * ndcZ + inverseVP[13]) * invW,
    z: (inverseVP[2] * ndcX + inverseVP[6] * ndcY + inverseVP[10] * ndcZ + inverseVP[14]) * invW,
  };
}

/**
 * 完整焦散 resolve:场景颜色 + 深度 → 叠加焦散后的颜色。
 *
 * 与 CausticsPass.apply() GPU 路径 1:1 对应:
 *   1. 逐像素读深度 → 重建世界位置;
 *   2. 调用 computeCaustics() 计算焦散;
 *   3. 加性合成:outColor = sceneColor + causticColor;
 *   4. 可选时序累积(EMA)。
 *
 * @param sceneColor   场景颜色缓冲
 * @param depth        NDC 深度缓冲
 * @param inverseVP    逆 viewProjection(列主序)
 * @param time         时间(秒)
 * @param opts         选项
 * @param history      上一帧焦散输出(null = 首帧,时序累积用)
 * @returns            { output: 合成后颜色, history: 当前焦散, stats: 统计 }
 */
export function resolveCaustics(
  sceneColor: PixelBuffer,
  depth: DepthBuffer,
  inverseVP: Float32Array,
  time: number,
  opts: CausticsOptions = {},
  history: PixelBuffer | null = null,
): { output: PixelBuffer; history: PixelBuffer; stats: CausticsStats } {
  const { width: w, height: h } = sceneColor;
  const outData = new Uint8ClampedArray(w * h * 4);
  const histData = new Uint8ClampedArray(w * h * 4);
  const temporalAlpha = opts.temporalBlend ?? 0;

  const startTime = typeof performance !== 'undefined' ? performance.now() : 0;

  let causticPixels = 0;
  let totalIntensity = 0;
  let maxIntensity = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const sceneR = sceneColor.data[idx];
      const sceneG = sceneColor.data[idx + 1];
      const sceneB = sceneColor.data[idx + 2];
      const sceneA = sceneColor.data[idx + 3];

      const ndcDepth = depth.data[y * w + x];
      // 天空(depth >= 1.0)→ 无焦散
      if (ndcDepth >= 1.0) {
        outData[idx] = sceneR;
        outData[idx + 1] = sceneG;
        outData[idx + 2] = sceneB;
        outData[idx + 3] = sceneA;
        histData[idx] = 0;
        histData[idx + 1] = 0;
        histData[idx + 2] = 0;
        histData[idx + 3] = 255;
        continue;
      }

      // 重建世界位置
      const ndcX = (x / (w - 1)) * 2 - 1;
      const ndcY = (y / (h - 1)) * 2 - 1;
      const ndcZ = ndcDepth * 2 - 1;
      const worldPos = reconstructWorldPos(ndcX, ndcY, ndcZ, inverseVP);

      // 计算焦散
      const caustic = computeCaustics(worldPos, time, opts);

      // 转为 0-255(焦散是加性的,HDR 允许 > 255 但 Uint8 钳制)
      let caustR = caustic.x * 255;
      let caustG = caustic.y * 255;
      let caustB = caustic.z * 255;

      // 时序累积(EMA)
      if (temporalAlpha > 0 && history) {
        const hR = history.data[idx];
        const hG = history.data[idx + 1];
        const hB = history.data[idx + 2];
        const invA = 1 - temporalAlpha;
        caustR = hR * invA + caustR * temporalAlpha;
        caustG = hG * invA + caustG * temporalAlpha;
        caustB = hB * invA + caustB * temporalAlpha;
      }

      // 记录历史
      histData[idx] = Math.max(0, Math.min(255, caustR));
      histData[idx + 1] = Math.max(0, Math.min(255, caustG));
      histData[idx + 2] = Math.max(0, Math.min(255, caustB));
      histData[idx + 3] = 255;

      // 加性合成
      outData[idx] = Math.max(0, Math.min(255, sceneR + caustR));
      outData[idx + 1] = Math.max(0, Math.min(255, sceneG + caustG));
      outData[idx + 2] = Math.max(0, Math.min(255, sceneB + caustB));
      outData[idx + 3] = sceneA;

      // 统计
      const intensity = (Math.abs(caustR) + Math.abs(caustG) + Math.abs(caustB)) / (3 * 255);
      if (intensity > 0.001) {
        causticPixels++;
        totalIntensity += intensity;
        if (intensity > maxIntensity) maxIntensity = intensity;
      }
    }
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : 0;
  const pixelCount = w * h;

  const stats: CausticsStats = {
    pixelsProcessed: pixelCount,
    causticPixels,
    avgIntensity: causticPixels > 0 ? totalIntensity / causticPixels : 0,
    maxIntensity,
    lastFrameTimeMs: endTime - startTime,
  };

  log.debug(
    `Caustics: ${w}x${h}, mode=${opts.mode ?? 'hybrid'}, ` +
    `causticPx=${causticPixels}, ` +
    `avgI=${stats.avgIntensity.toFixed(3)}, ` +
    `maxI=${stats.maxIntensity.toFixed(3)}, ` +
    `${stats.lastFrameTimeMs.toFixed(1)}ms`,
  );

  return {
    output: { data: outData, width: w, height: h },
    history: { data: histData, width: w, height: h },
    stats,
  };
}

// ── 辅助:构造测试缓冲 ──────────────────────────────────────────

/**
 * 构造纯色像素缓冲(测试用)。
 */
export function makeSolidBuffer(
  width: number, height: number,
  r: number, g: number, b: number, a: number = 255,
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width, height };
}

/**
 * 构造常量深度缓冲(测试用)。
 */
export function makeConstantDepth(
  width: number, height: number, value: number = 0.5,
): DepthBuffer {
  const data = new Float32Array(width * height);
  data.fill(value);
  return { data, width, height };
}

/**
 * 构造单位矩阵(逆 viewProjection,测试用)。
 * worldPos = inverseVP * ndc → 当 inverseVP = I 时 worldPos = ndc。
 */
export function makeIdentityMatrix(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}
