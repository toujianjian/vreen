// PCSSSampler — Percentage-Closer Soft Shadows (PCSS) CPU 参考实现。
//
// 实现 Ferrari 2005 "Percentage-Closer Soft Shadows" 三步算法的纯函数版本,
// 与 GLSL `PCSS_SHADOW_FRAG` chunk 1:1 对应,可在无头 / Node / 测试环境运行,
// 不依赖 WebGL。用途:
//   1. 验证 GPU shader 正确性(参考实现);
//   2. 离线渲染 / 光照贴图烘焙的软阴影采样;
//   3. 单元测试可断言数值行为(深度差、半影宽度、可见性)。
//
// 三步算法:
//   1. Blocker Search — 在阴影贴图上以搜索半径采样,统计平均遮挡器深度;
//   2. Penumbra Estimation — 由 (receiver - blocker) 距离与光源尺寸估算半影宽度;
//   3. Variable-rate PCF — 以半影宽度为半径做 Poisson-disk PCF,产生渐变软阴影。
//
// 与 ShadowMapManager(type='pcss') 的关系:
//   - ShadowMapManager 负责 GPU 端渲染阴影贴图 + 设置 type='pcss';
//   - consumer shader 注入 PCSS_SHADOW_FRAG 调用 sampleShadowPCSS(worldPos);
//   - 本类是 CPU 侧参考实现,不参与 GPU 渲染,仅供测试 / 离线 / 验证。
//
// 参考:
//   - Ferrari 2005 "Percentage-Closer Soft Shadows"
//   - UE5 ShadowPenumbra / PCSS
//   - o3de Atom Shadow (PCSS filter mode)
//   - NVIDIA "Common Techniques to Improve Shadow Depth Maps"
//   - three.js PCSSShadowNode (参考实现思路)

import { createLogger } from '@/lib/logger';

const log = createLogger('PCSSSampler');

/** 阴影贴图数据:Float32Array + 尺寸。深度值范围 [0,1]。 */
export interface ShadowMapData {
  /** 深度数据,长度 = width * height,行主序(从左上到右下)。 */
  data: Float32Array;
  width: number;
  height: number;
}

/** Blocker Search 结果。 */
export interface BlockerSearchResult {
  /** 平均遮挡器深度([0,1])。count=0 时为 0。 */
  avgDepth: number;
  /** 找到的遮挡器数量。 */
  count: number;
}

/** PCSS 采样选项。 */
export interface PCSSOptions {
  /** 光源尺寸(世界单位 / texel 缩放因子,默认 1.0)。控制半影宽度。 */
  lightSize?: number;
  /** 阴影偏置(默认 0.001),消除自阴影 acne。 */
  bias?: number;
  /** 阻挡器深度偏置(默认 0.001),区分遮挡器与接收者。 */
  blockerBias?: number;
  /** PCF 采样数(默认 16)。1=硬阴影,16=高质量软阴影。 */
  pcfSamples?: number;
  /** 半影半径上限(默认 16 texel),防止过采样。 */
  maxPenumbra?: number;
  /** 半影半径下限(默认 1 texel),保证最小模糊。 */
  minPenumbra?: number;
}

/** PCSS 采样统计(调试用)。 */
export interface PCSSStats {
  /** 是否找到遮挡器。 */
  hasBlocker: boolean;
  /** 平均遮挡器深度。 */
  blockerDepth: number;
  /** 遮挡器数量。 */
  blockerCount: number;
  /** 估算的半影半径(texel)。 */
  penumbra: number;
  /** 最终可见性 [0,1]。 */
  visibility: number;
}

// ── 纯函数 ──────────────────────────────────────────────────────────

/**
 * 采样阴影贴图在 (u, v) 处的深度。UV 超界时钳制到边缘(CLAMP_TO_EDGE)。
 *
 * @param map    阴影贴图
 * @param u      水平坐标 [0,1]
 * @param v      垂直坐标 [0,1]
 * @returns      深度值 [0,1]
 */
export function sampleShadowDepth(map: ShadowMapData, u: number, v: number): number {
  const cu = u < 0 ? 0 : u > 1 ? 1 : u;
  const cv = v < 0 ? 0 : v > 1 ? 1 : v;
  const x = Math.min(map.width - 1, Math.floor(cu * map.width));
  const y = Math.min(map.height - 1, Math.floor(cv * map.height));
  return map.data[y * map.width + x];
}

/**
 * Step 1: Blocker Search。
 *
 * 在阴影贴图上以 (u, v) 为中心,searchRadius (texel) 为半径采样 5×5 网格,
 * 统计遮挡器(shadowDepth < receiverDepth - blockerBias)的平均深度。
 *
 * @param map            阴影贴图
 * @param u              接收者 UV.x [0,1]
 * @param v              接收者 UV.y [0,1]
 * @param receiverDepth  接收者深度 [0,1]
 * @param searchRadius   搜索半径(texel 单位)
 * @param blockerBias    阻挡器偏置(默认 0.001)
 * @returns              BlockerSearchResult(avgDepth, count)
 */
export function findBlocker(
  map: ShadowMapData,
  u: number,
  v: number,
  receiverDepth: number,
  searchRadius: number,
  blockerBias: number = 0.001,
): BlockerSearchResult {
  let blockerSum = 0;
  let blockerCount = 0;
  const step = searchRadius / 2;
  const texelU = 1 / map.width;
  const texelV = 1 / map.height;

  // 5×5 网格(与 GLSL 一致)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const su = u + dx * step * texelU;
      const sv = v + dy * step * texelV;
      const shadowDepth = sampleShadowDepth(map, su, sv);
      if (shadowDepth < receiverDepth - blockerBias) {
        blockerSum += shadowDepth;
        blockerCount++;
      }
    }
  }

  if (blockerCount === 0) {
    return { avgDepth: 0, count: 0 };
  }
  return { avgDepth: blockerSum / blockerCount, count: blockerCount };
}

/**
 * Step 2: Penumbra Estimation。
 *
 * 半影宽度公式(相似三角形):
 *   penumbra = (receiverDepth - blockerDepth) * lightSize / blockerDepth
 *
 * 钳制到 [minPenumbra, maxPenumbra] 防止极端值。
 *
 * @param blockerDepth    遮挡器平均深度
 * @param receiverDepth   接收者深度
 * @param lightSize       光源尺寸
 * @param minPenumbra     最小半影(texel,默认 1)
 * @param maxPenumbra     最大半影(texel,默认 16)
 * @returns               半影半径(texel)
 */
export function computePenumbra(
  blockerDepth: number,
  receiverDepth: number,
  lightSize: number,
  minPenumbra: number = 1,
  maxPenumbra: number = 16,
): number {
  // 防止除零
  const bd = Math.max(blockerDepth, 1e-4);
  const penumbra = (receiverDepth - bd) * lightSize / bd;
  return Math.max(minPenumbra, Math.min(maxPenumbra, penumbra));
}

// ── Poisson disk 采样模式(16-tap,与 GLSL 一致) ──────────────────
export const POISSON_DISK_16: ReadonlyArray<readonly [number, number]> = [
  [-0.94201624, -0.39906216],
  [ 0.94558609, -0.76890725],
  [-0.09418410, -0.92938870],
  [ 0.34495938,  0.29387733],
  [-0.91588581,  0.45771432],
  [-0.81544232, -0.87912464],
  [ 0.38277543,  0.89668509],
  [-0.38277444, -0.38277642],
  [ 0.19311636,  0.89668509],
  [ 0.77512345,  0.52934567],
  [-0.52934567,  0.19311636],
  [ 0.52934567, -0.19311636],
  [-0.19311636,  0.52934567],
  [ 0.89668509,  0.19311636],
  [-0.67654321,  0.77512345],
  [ 0.67654321, -0.77512345],
];

/**
 * Step 3: Variable-rate PCF。
 *
 * 以 penumbraRadius (texel) 为半径,用 Poisson-disk 采样做 PCF,
 * 返回可见性 [0,1]。旋转角度由 UV 哈希驱动,消除 banding。
 *
 * @param map             阴影贴图
 * @param u               接收者 UV.x
 * @param v               接收者 UV.y
 * @param receiverDepth   接收者深度
 * @param penumbraRadius  半影半径(texel)
 * @param bias            阴影偏置(默认 0.001)
 * @param samples         采样数(1..16,默认 16)
 * @returns               可见性 [0,1](1=完全照亮)
 */
export function samplePCF(
  map: ShadowMapData,
  u: number,
  v: number,
  receiverDepth: number,
  penumbraRadius: number,
  bias: number = 0.001,
  samples: number = 16,
): number {
  const texelU = 1 / map.width;
  const texelV = 1 / map.height;
  const n = Math.max(1, Math.min(16, Math.floor(samples)));

  // 旋转角度(UV 哈希,与 GLSL 一致)
  const angle = (Math.sin(u * 12.9898 + v * 78.233) * 43758.5453) % 1;
  const a = (angle < 0 ? angle + 1 : angle) * Math.PI * 2;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);

  let visible = 0;
  for (let i = 0; i < n; i++) {
    const px = POISSON_DISK_16[i][0];
    const py = POISSON_DISK_16[i][1];
    // 旋转
    const rx = px * cosA - py * sinA;
    const ry = px * sinA + py * cosA;
    const su = u + rx * penumbraRadius * texelU;
    const sv = v + ry * penumbraRadius * texelV;
    const shadowDepth = sampleShadowDepth(map, su, sv);
    if (shadowDepth > receiverDepth - bias) visible++;
  }
  return visible / n;
}

/**
 * PCSS 完整采样(三步合一)。
 *
 * 调用顺序:
 *   1. findBlocker → 平均遮挡器深度
 *   2. computePenumbra → 半影半径
 *   3. samplePCF → 可见性
 *
 * 无遮挡器时返回 1.0(完全照亮)。
 *
 * @param map             阴影贴图
 * @param u               接收者 UV.x
 * @param v               接收者 UV.y
 * @param receiverDepth   接收者深度 [0,1]
 * @param opts            选项(lightSize / bias / blockerBias / pcfSamples / ...)
 * @returns               可见性 [0,1]
 */
export function samplePCSS(
  map: ShadowMapData,
  u: number,
  v: number,
  receiverDepth: number,
  opts: PCSSOptions = {},
): number {
  const lightSize = opts.lightSize ?? 1.0;
  const bias = opts.bias ?? 0.001;
  const blockerBias = opts.blockerBias ?? 0.001;
  const pcfSamples = opts.pcfSamples ?? 16;
  const maxPenumbra = opts.maxPenumbra ?? 16;
  const minPenumbra = opts.minPenumbra ?? 1;

  // Step 1: Blocker Search
  const searchRadius = Math.max(lightSize, 1);
  const blocker = findBlocker(map, u, v, receiverDepth, searchRadius, blockerBias);
  if (blocker.count === 0) return 1.0;  // 无遮挡器 → 无阴影

  // Step 2: Penumbra Estimation
  const penumbra = computePenumbra(
    blocker.avgDepth, receiverDepth, lightSize, minPenumbra, maxPenumbra,
  );

  // Step 3: Variable-rate PCF
  return samplePCF(map, u, v, receiverDepth, penumbra, bias, pcfSamples);
}

/**
 * PCSS 完整采样 + 统计(调试用)。
 * 与 samplePCSS 相同,但返回中间结果(blockerDepth / penumbra / visibility)。
 */
export function samplePCSSWithStats(
  map: ShadowMapData,
  u: number,
  v: number,
  receiverDepth: number,
  opts: PCSSOptions = {},
): PCSSStats {
  const lightSize = opts.lightSize ?? 1.0;
  const bias = opts.bias ?? 0.001;
  const blockerBias = opts.blockerBias ?? 0.001;
  const pcfSamples = opts.pcfSamples ?? 16;
  const maxPenumbra = opts.maxPenumbra ?? 16;
  const minPenumbra = opts.minPenumbra ?? 1;

  const searchRadius = Math.max(lightSize, 1);
  const blocker = findBlocker(map, u, v, receiverDepth, searchRadius, blockerBias);

  if (blocker.count === 0) {
    return {
      hasBlocker: false,
      blockerDepth: 0,
      blockerCount: 0,
      penumbra: 0,
      visibility: 1,
    };
  }

  const penumbra = computePenumbra(
    blocker.avgDepth, receiverDepth, lightSize, minPenumbra, maxPenumbra,
  );
  const visibility = samplePCF(map, u, v, receiverDepth, penumbra, bias, pcfSamples);

  return {
    hasBlocker: true,
    blockerDepth: blocker.avgDepth,
    blockerCount: blocker.count,
    penumbra,
    visibility,
  };
}

/**
 * 构造一个全平面的阴影贴图(所有 texel = depth)。
 * 用于测试:模拟"无遮挡"场景。
 */
export function makeFlatShadowMap(
  width: number, height: number, depth: number,
): ShadowMapData {
  const data = new Float32Array(width * height).fill(depth);
  return { data, width, height };
}

/**
 * 构造一个带矩形遮挡器的阴影贴图。
 * 中心 [cx-0.5*r, cx+0.5*r] × [cy-0.5*r, cy+0.5*r] 区域 = blockerDepth,
 * 其余 = backgroundDepth。
 *
 * 用于测试:验证 blocker search 能正确找到遮挡器。
 */
export function makeBlockerShadowMap(
  width: number, height: number,
  blockerDepth: number, backgroundDepth: number,
  cx: number, cy: number, r: number,
): ShadowMapData {
  const data = new Float32Array(width * height).fill(backgroundDepth);
  const x0 = Math.max(0, Math.floor((cx - 0.5 * r) * width));
  const x1 = Math.min(width, Math.ceil((cx + 0.5 * r) * width));
  const y0 = Math.max(0, Math.floor((cy - 0.5 * r) * height));
  const y1 = Math.min(height, Math.ceil((cy + 0.5 * r) * height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      data[y * width + x] = blockerDepth;
    }
  }
  log.debug(`blocker map: ${width}×${height}, blocker=${blockerDepth}, bg=${backgroundDepth}`);
  return { data, width, height };
}
