// LightPropagationVolume — 光传播体(Light Propagation Volumes, LPV)。
//
// 设计目标:
//   - 实时多 bounce 全局光照,基于 3D 网格 + 球谐函数(SH2)光传播。
//   - 把直接光照注入到 3D SH 网格,迭代传播产生多 bounce 间接光照,
//     采样时三线性插值 + SH 评估得到每像素的漫反射间接光。
//   - 与 SSGI(屏幕空间)、DDGI(探针)、VXGI(体素锥追踪)、PathTracer(离线)互补:
//     LPV 是网格传播方案,无需探针布局,无需体素化,覆盖离屏表面,
//     支持多 bounce,实时性能好(SH 传播 O(N³ × iterations × 6))。
//
// 算法(Kaplanyan 2009 "Light Propagation Volumes in CryEngine 3"):
//   1. 光注入(Injection):
//      a. 点光源:找到影响的网格 cell,按距离衰减计算辐照度,
//         computeSH(光照方向, 辐照度) 注入到 cell 的 SH 系数。
//      b. 方向光:所有 cell 都受影响,方向一致。
//      c. 自发光表面:把 emissive 几何光栅化到网格。
//   2. 光传播(Propagation):
//      a. 对每个 cell,评估其 SH 在 6 个面方向上的辐照度。
//      b. 把辐照度重新投影为 SH(computeSH(-faceDir, radiance)),
//         加到邻居 cell(双缓冲,避免同帧污染)。
//      c. 迭代 N 次(默认 4),每次代表一次 bounce。
//   3. 采样(Sampling):
//      a. 世界坐标 → 网格坐标(浮点)。
//      b. 三线性插值 8 个邻近 cell 的 SH 系数。
//      c. evaluateSH(插值SH, normal) → 漫反射间接光 RGB。
//
// 数据模型:
//   - LPVConfig:网格配置(原点、尺寸、分辨率、传播次数)。
//   - LPVGrid:SH 系数数组(Float32Array, 长度 = dimX*dimY*dimZ*27)。
//   - 27 = 9 SH2 系数 × 3 RGB 通道。
//
// 不变量:
//   - dimX/Y/Z >= 1;
//   - SH 系数数组长度 = dimX*dimY*dimZ*27;
//   - 传播使用双缓冲(读写分离);
//   - 采样位置在网格外时返回 {0,0,0}。
//
// 参考:
//   - Kaplanyan 2009 "Light Propagation Volumes in CryEngine 3" (LPV 原始论文)
//   - Kaplanyan & Dachsbacher 2010 "Propagation of Radiance" (SH 传播理论)
//   - Crytek CryEngine 3 LPV 实现
//   - UE5 "Light Propagation Volume" 插件
//   - DDGIVolume.ts — 探针 GI(互补方案)
//   - VoxelConeTracing.ts — 体素锥追踪 GI(互补方案)
//   - SSGI.ts — 屏幕空间 GI(互补方案)
//   - GlobalIllumination.ts — SH2 工具函数参考

import { createLogger } from '@/lib/logger';

const log = createLogger('LightPropagationVolume');

// ── 类型定义 ────────────────────────────────────────────────────

/** 3D 向量(纯数据,无依赖)。 */
export interface LPVVec3 {
  x: number;
  y: number;
  z: number;
}

/** RGB 颜色(浮点,0-1+ 范围,允许 HDR)。 */
export interface LPVColor {
  r: number;
  g: number;
  b: number;
}

/** 点光源(用于注入)。 */
export interface LPVPointLight {
  /** 世界位置。 */
  position: LPVVec3;
  /** 颜色(线性 RGB,HDR 可 > 1)。 */
  color: LPVColor;
  /** 光照强度(流明/瓦特,任意一致单位)。 */
  intensity: number;
  /** 衰减半径(世界单位,超出此距离不贡献)。 */
  range: number;
}

/** 方向光(用于注入)。 */
export interface LPVDirectionalLight {
  /** 光照方向(从光源指向场景,需归一化)。 */
  direction: LPVVec3;
  /** 颜色(线性 RGB)。 */
  color: LPVColor;
  /** 光照强度。 */
  intensity: number;
}

/** 自发光表面(用于注入)。 */
export interface LPVEmissiveSurface {
  /** 表面世界位置。 */
  position: LPVVec3;
  /** 表面法线(归一化)。 */
  normal: LPVVec3;
  /** 自发光颜色(HDR)。 */
  emissive: LPVColor;
}

/** LPV 网格配置。 */
export interface LPVConfig {
  /** 网格原点(世界坐标,最小角)。 */
  origin: LPVVec3;
  /** 每个 cell 的世界尺寸。 */
  cellSize: number;
  /** X 方向 cell 数。 */
  dimX: number;
  /** Y 方向 cell 数。 */
  dimY: number;
  /** Z 方向 cell 数。 */
  dimZ: number;
  /** 传播迭代次数(默认 4,代表 bounce 次数)。 */
  propagationIterations: number;
  /** 传播强度(默认 0.85,控制每次 bounce 的能量保留)。 */
  propagationStrength: number;
  /** 几何遮挡网格(可选,标记被几何占据的 cell,阻止光传播)。 */
  geometryVolume?: Uint8Array | null;
}

/** SH2 系数数 = 9 基 × 3 RGB = 27 floats per cell。 */
export const SH2_COEFFS_PER_CELL = 27;

/** LPV 网格(SH 系数 + 配置)。 */
export interface LPVGrid {
  /** 配置。 */
  config: LPVConfig;
  /** SH 系数(长度 = dimX*dimY*dimZ*27)。 */
  sh: Float32Array;
  /** 传播缓冲(双缓冲,长度同 sh)。 */
  shBuffer: Float32Array;
}

// ── SH2 工具(自包含,不依赖 Vector3) ───────────────────────────

/** SH2 基函数常量(Ramamoorthi & Hanrahan 2001)。 */
const SH_Y00 = 0.282095;
const SH_Y1m1 = 0.488603;
const SH_Y10 = 0.488603;
const SH_Y11 = 0.488603;
const SH_Y2m2 = 1.092548;
const SH_Y2m1 = 1.092548;
const SH_Y20 = 0.315392;
const SH_Y21 = 1.092548;
const SH_Y22 = 0.546274;

/**
 * 归一化 3D 向量。
 */
export function lpvNormalize(v: LPVVec3): LPVVec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * 点积。
 */
export function lpvDot(a: LPVVec3, b: LPVVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * 计算方向 d 的 SH2 基值(9 个系数)。
 * 返回 Float32Array(9)。
 */
export function shBasis(d: LPVVec3): Float32Array {
  const n = lpvNormalize(d);
  const x = n.x, y = n.y, z = n.z;
  const sh = new Float32Array(9);
  sh[0] = SH_Y00;
  sh[1] = SH_Y1m1 * y;
  sh[2] = SH_Y10 * z;
  sh[3] = SH_Y11 * x;
  sh[4] = SH_Y2m2 * x * y;
  sh[5] = SH_Y2m1 * y * z;
  sh[6] = SH_Y20 * (3 * z * z - 1);
  sh[7] = SH_Y21 * x * z;
  sh[8] = SH_Y22 * (x * x - y * y);
  return sh;
}

/**
 * 把方向光照(方向 + 颜色)投影到 SH2 系数(27 floats, RGB)。
 *
 * @param dir 光照方向(从光源指向表面,或入射方向)
 * @param color 颜色(RGB, 0..1+)
 * @returns Float32Array(27),9 个 RGB SH 系数
 */
export function computeSHRGB(dir: LPVVec3, color: LPVColor): Float32Array {
  const sh = shBasis(dir);
  const out = new Float32Array(SH2_COEFFS_PER_CELL);
  for (let i = 0; i < 9; i++) {
    out[i * 3] = color.r * sh[i];
    out[i * 3 + 1] = color.g * sh[i];
    out[i * 3 + 2] = color.b * sh[i];
  }
  return out;
}

/**
 * 从 SH2 系数评估某方向的辐照度。
 *
 * @param coeffs SH2 系数(27 floats)
 * @param dir 评估方向(通常是表面法线)
 * @returns RGB 颜色
 */
export function evaluateSHRGB(coeffs: Float32Array, dir: LPVVec3): LPVColor {
  const sh = shBasis(dir);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 9; i++) {
    r += coeffs[i * 3] * sh[i];
    g += coeffs[i * 3 + 1] * sh[i];
    b += coeffs[i * 3 + 2] * sh[i];
  }
  return { r, g, b };
}

// ── 网格索引 ────────────────────────────────────────────────────

/**
 * 3D cell 索引 → 1D 线性索引(SH 数组中的起始位置)。
 */
export function cellIndex(x: number, y: number, z: number, dimX: number, dimY: number): number {
  return (x + y * dimX + z * dimX * dimY) * SH2_COEFFS_PER_CELL;
}

/**
 * 世界坐标 → 网格浮点坐标。
 */
export function worldToCellF(p: LPVVec3, grid: LPVGrid): LPVVec3 {
  const cfg = grid.config;
  return {
    x: (p.x - cfg.origin.x) / cfg.cellSize,
    y: (p.y - cfg.origin.y) / cfg.cellSize,
    z: (p.z - cfg.origin.z) / cfg.cellSize,
  };
}

/**
 * 世界坐标 → 网格整数坐标。
 */
export function worldToCellI(p: LPVVec3, grid: LPVGrid): { x: number; y: number; z: number } {
  const f = worldToCellF(p, grid);
  return { x: Math.floor(f.x), y: Math.floor(f.y), z: Math.floor(f.z) };
}

/**
 * 判断 cell 是否在网格内。
 */
export function isCellInside(x: number, y: number, z: number, cfg: LPVConfig): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < cfg.dimX && y < cfg.dimY && z < cfg.dimZ;
}

/**
 * 判断 cell 是否被几何占据(阻挡光传播)。
 */
export function isCellBlocked(x: number, y: number, z: number, cfg: LPVConfig): boolean {
  if (!cfg.geometryVolume) return false;
  if (!isCellInside(x, y, z, cfg)) return true; // 网格外视为阻挡
  const idx = x + y * cfg.dimX + z * cfg.dimX * cfg.dimY;
  return cfg.geometryVolume[idx] > 0;
}

// ── 网格创建与管理 ──────────────────────────────────────────────

/**
 * 创建 LPV 网格(全零 SH 系数)。
 */
export function createLPV(config: LPVConfig): LPVGrid {
  const totalCells = config.dimX * config.dimY * config.dimZ;
  const sh = new Float32Array(totalCells * SH2_COEFFS_PER_CELL);
  const shBuffer = new Float32Array(totalCells * SH2_COEFFS_PER_CELL);
  log.info(`Created LPV: ${config.dimX}×${config.dimY}×${config.dimZ} = ${totalCells} cells, ${sh.byteLength / 1024}KB`);
  return { config, sh, shBuffer };
}

/**
 * 重置网格(清零 SH 系数,用于新一帧)。
 */
export function resetLPV(grid: LPVGrid): void {
  grid.sh.fill(0);
  grid.shBuffer.fill(0);
}

/**
 * 获取 cell 的 SH 系数(27 floats 视图,不拷贝)。
 * 注意:返回的是原数组中的引用,修改会直接影响网格。
 */
export function getCellSH(grid: LPVGrid, x: number, y: number, z: number): Float32Array {
  const idx = cellIndex(x, y, z, grid.config.dimX, grid.config.dimY);
  return grid.sh.subarray(idx, idx + SH2_COEFFS_PER_CELL);
}

/**
 * 累加 SH 系数到 cell。
 */
export function addToCellSH(
  grid: LPVGrid,
  x: number, y: number, z: number,
  sh: Float32Array,
  weight: number = 1,
): void {
  if (!isCellInside(x, y, z, grid.config)) return;
  if (isCellBlocked(x, y, z, grid.config)) return;
  const idx = cellIndex(x, y, z, grid.config.dimX, grid.config.dimY);
  for (let i = 0; i < SH2_COEFFS_PER_CELL; i++) {
    grid.sh[idx + i] += sh[i] * weight;
  }
}

// ── 光注入 ──────────────────────────────────────────────────────

/**
 * 注入点光源到 LPV 网格。
 *
 * 对光源影响范围内的每个 cell:
 *   - 计算光源到 cell 中心的距离和方向
 *   - 按距离衰减计算辐照度(1/r² × smoothstep 衰减)
 *   - computeSHRGB(光照方向, 辐照度) 累加到 cell
 *
 * @param grid LPV 网格
 * @param light 点光源
 */
export function injectPointLight(grid: LPVGrid, light: LPVPointLight): void {
  const cfg = grid.config;
  // 光源影响的 cell 范围
  const rangeInCells = Math.ceil(light.range / cfg.cellSize);
  const lightCell = worldToCellI(light.position, grid);

  for (let z = Math.max(0, lightCell.z - rangeInCells); z <= Math.min(cfg.dimZ - 1, lightCell.z + rangeInCells); z++) {
    for (let y = Math.max(0, lightCell.y - rangeInCells); y <= Math.min(cfg.dimY - 1, lightCell.y + rangeInCells); y++) {
      for (let x = Math.max(0, lightCell.x - rangeInCells); x <= Math.min(cfg.dimX - 1, lightCell.x + rangeInCells); x++) {
        if (isCellBlocked(x, y, z, cfg)) continue;
        // cell 中心世界坐标
        const cellCenter: LPVVec3 = {
          x: cfg.origin.x + (x + 0.5) * cfg.cellSize,
          y: cfg.origin.y + (y + 0.5) * cfg.cellSize,
          z: cfg.origin.z + (z + 0.5) * cfg.cellSize,
        };
        // 光源到 cell 的方向和距离
        const dx = cellCenter.x - light.position.x;
        const dy = cellCenter.y - light.position.y;
        const dz = cellCenter.z - light.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > light.range || dist < 1e-6) continue;

        // 距离衰减(物理 1/r² + smoothstep 边界)
        const distAtten = 1 / (dist * dist);
        const smooth = Math.max(0, 1 - (dist / light.range) ** 4);
        const attenuation = distAtten * smooth * light.intensity;

        // 光照方向(从光源指向 cell)
        const lightDir: LPVVec3 = { x: dx / dist, y: dy / dist, z: dz / dist };

        // 辐照度颜色
        const irradiance: LPVColor = {
          r: light.color.r * attenuation,
          g: light.color.g * attenuation,
          b: light.color.b * attenuation,
        };

        // 投影到 SH 并累加
        const sh = computeSHRGB(lightDir, irradiance);
        const idx = cellIndex(x, y, z, cfg.dimX, cfg.dimY);
        for (let i = 0; i < SH2_COEFFS_PER_CELL; i++) {
          grid.sh[idx + i] += sh[i];
        }
      }
    }
  }
}

/**
 * 注入方向光到 LPV 网格。
 *
 * 所有 cell 都接收方向光,辐照度 = color * intensity * max(0, dot(normal, -lightDir))。
 * 但在 LPV 中,我们直接注入方向光到每个 cell 的 SH(不考虑 cell 法线,
 * 因为 LPV cell 没有法线,光在 cell 内全方向传播)。
 *
 * @param grid LPV 网格
 * @param light 方向光
 */
export function injectDirectionalLight(grid: LPVGrid, light: LPVDirectionalLight): void {
  const cfg = grid.config;
  const dir = lpvNormalize(light.direction);
  const irradiance: LPVColor = {
    r: light.color.r * light.intensity,
    g: light.color.g * light.intensity,
    b: light.color.b * light.intensity,
  };
  const sh = computeSHRGB(dir, irradiance);

  for (let z = 0; z < cfg.dimZ; z++) {
    for (let y = 0; y < cfg.dimY; y++) {
      for (let x = 0; x < cfg.dimX; x++) {
        if (isCellBlocked(x, y, z, cfg)) continue;
        const idx = cellIndex(x, y, z, cfg.dimX, cfg.dimY);
        for (let i = 0; i < SH2_COEFFS_PER_CELL; i++) {
          grid.sh[idx + i] += sh[i];
        }
      }
    }
  }
}

/**
 * 注入自发光表面到 LPV 网格。
 *
 * 找到表面所在的 cell,把 emissive 颜色投影到 SH(沿法线方向)并累加。
 *
 * @param grid LPV 网格
 * @param surface 自发光表面
 */
export function injectEmissiveSurface(grid: LPVGrid, surface: LPVEmissiveSurface): void {
  const cell = worldToCellI(surface.position, grid);
  if (!isCellInside(cell.x, cell.y, cell.z, grid.config)) return;
  if (isCellBlocked(cell.x, cell.y, cell.z, grid.config)) return;

  // 沿法线方向投影 emissive 到 SH
  const sh = computeSHRGB(surface.normal, surface.emissive);
  const idx = cellIndex(cell.x, cell.y, cell.z, grid.config.dimX, grid.config.dimY);
  for (let i = 0; i < SH2_COEFFS_PER_CELL; i++) {
    grid.sh[idx + i] += sh[i];
  }
}

/**
 * 批量注入自发光表面。
 */
export function injectEmissiveSurfaces(grid: LPVGrid, surfaces: LPVEmissiveSurface[]): void {
  for (const s of surfaces) {
    injectEmissiveSurface(grid, s);
  }
}

// ── 光传播 ──────────────────────────────────────────────────────

/** 6 个面方向(+X, -X, +Y, -Y, +Z, -Z)。 */
const FACE_DIRS: LPVVec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/**
 * 单次光传播步骤(双缓冲)。
 *
 * 对每个 cell:
 *   对每个面方向 d:
 *     1. 评估 cell SH 在方向 d 上的辐照度 → radiance
 *     2. 把 radiance 沿 -d 方向投影为 SH → propagatedSH
 *     3. 加到邻居 cell 的 shBuffer(从 -d 方向到达)
 *
 * @param grid LPV 网格(读 grid.sh,写 grid.shBuffer)
 * @param strength 传播强度(0-1,控制能量保留)
 */
export function propagateStep(grid: LPVGrid, strength: number = 0.85): void {
  const cfg = grid.config;
  const { sh, shBuffer } = grid;
  const dimX = cfg.dimX, dimY = cfg.dimY, dimZ = cfg.dimZ;

  // 把当前 SH 拷贝到 buffer(保留注入的光,传播光叠加在上面)
  shBuffer.set(sh);

  // 每个面方向的权重:均匀分配到 6 个方向
  const faceWeight = strength / 6;

  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        if (isCellBlocked(x, y, z, cfg)) continue;

        const srcIdx = cellIndex(x, y, z, dimX, dimY);
        // 获取 cell 的 SH 系数(27 floats)
        const cellSH = sh.subarray(srcIdx, srcIdx + SH2_COEFFS_PER_CELL);

        // 对每个面方向传播
        for (let f = 0; f < 6; f++) {
          const dir = FACE_DIRS[f];
          const nx = x + dir.x;
          const ny = y + dir.y;
          const nz = z + dir.z;

          // 邻居必须在网格内且未被阻挡
          if (!isCellInside(nx, ny, nz, cfg)) continue;
          if (isCellBlocked(nx, ny, nz, cfg)) continue;

          // 评估源 cell SH 在面方向上的辐照度
          const radiance = evaluateSHRGB(cellSH, dir);

          // 如果辐照度太弱,跳过(性能优化)
          if (radiance.r < 1e-6 && radiance.g < 1e-6 && radiance.b < 1e-6) continue;

          // 沿 -d 方向投影到 SH(光从方向 -d 到达邻居)
          const invDir: LPVVec3 = { x: -dir.x, y: -dir.y, z: -dir.z };
          const propagated = computeSHRGB(invDir, radiance);

          // 累加到邻居的 buffer
          const dstIdx = cellIndex(nx, ny, nz, dimX, dimY);
          for (let i = 0; i < SH2_COEFFS_PER_CELL; i++) {
            shBuffer[dstIdx + i] += propagated[i] * faceWeight;
          }
        }
      }
    }
  }

  // 交换:buffer → sh
  sh.set(shBuffer);
}

/**
 * 执行多次光传播(代表多次 bounce)。
 *
 * @param grid LPV 网格
 * @param iterations 传播次数(默认从 config 读取)
 */
export function propagateLight(grid: LPVGrid, iterations?: number): void {
  const iters = iterations ?? grid.config.propagationIterations;
  for (let i = 0; i < iters; i++) {
    propagateStep(grid, grid.config.propagationStrength);
  }
  log.debug(`Propagated light: ${iters} iterations`);
}

// ── 采样 ────────────────────────────────────────────────────────

/**
 * 从 LPV 网格采样某点的间接光照。
 *
 * 三线性插值 8 个邻近 cell 的 SH 系数,然后 evaluateSH 得到漫反射间接光。
 *
 * @param grid LPV 网格
 * @param worldPos 采样点世界坐标
 * @param normal 表面法线(归一化)
 * @returns 漫反射间接光 RGB
 */
export function sampleLPV(grid: LPVGrid, worldPos: LPVVec3, normal: LPVVec3): LPVColor {
  const cfg = grid.config;
  const f = worldToCellF(worldPos, grid);

  // 网格外返回黑色
  if (f.x < 0 || f.y < 0 || f.z < 0 ||
      f.x >= cfg.dimX || f.y >= cfg.dimY || f.z >= cfg.dimZ) {
    return { r: 0, g: 0, b: 0 };
  }

  const x0 = Math.floor(f.x);
  const y0 = Math.floor(f.y);
  const z0 = Math.floor(f.z);
  const x1 = Math.min(cfg.dimX - 1, x0 + 1);
  const y1 = Math.min(cfg.dimY - 1, y0 + 1);
  const z1 = Math.min(cfg.dimZ - 1, z0 + 1);
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cz0 = Math.max(0, z0);

  const tx = f.x - x0;
  const ty = f.y - y0;
  const tz = f.z - z0;

  // 三线性插值 SH 系数
  const interpolated = new Float32Array(SH2_COEFFS_PER_CELL);
  const dimX = cfg.dimX, dimY = cfg.dimY;

  // 8 个角的权重
  const corners = [
    { x: cx0, y: cy0, z: cz0, w: (1 - tx) * (1 - ty) * (1 - tz) },
    { x: x1, y: cy0, z: cz0, w: tx * (1 - ty) * (1 - tz) },
    { x: cx0, y: y1, z: cz0, w: (1 - tx) * ty * (1 - tz) },
    { x: x1, y: y1, z: cz0, w: tx * ty * (1 - tz) },
    { x: cx0, y: cy0, z: z1, w: (1 - tx) * (1 - ty) * tz },
    { x: x1, y: cy0, z: z1, w: tx * (1 - ty) * tz },
    { x: cx0, y: y1, z: z1, w: (1 - tx) * ty * tz },
    { x: x1, y: y1, z: z1, w: tx * ty * tz },
  ];

  for (const c of corners) {
    if (c.w < 1e-8) continue;
    const idx = cellIndex(c.x, c.y, c.z, dimX, dimY);
    for (let i = 0; i < SH2_COEFFS_PER_CELL; i++) {
      interpolated[i] += grid.sh[idx + i] * c.w;
    }
  }

  // 评估 SH 在法线方向的辐照度
  return evaluateSHRGB(interpolated, normal);
}

/**
 * 采样 LPV 并乘以反照率(Albedo)得到最终间接漫反射。
 *
 * @param grid LPV 网格
 * @param worldPos 采样点世界坐标
 * @param normal 表面法线
 * @param albedo 表面反照率(0-1)
 * @returns 间接漫反射颜色
 */
export function sampleDiffuseGI(
  grid: LPVGrid,
  worldPos: LPVVec3,
  normal: LPVVec3,
  albedo: LPVColor,
): LPVColor {
  const indirect = sampleLPV(grid, worldPos, normal);
  // 反照率调制 + 余弦项(SH2 已包含余弦,这里只乘反照率)
  return {
    r: indirect.r * albedo.r,
    g: indirect.g * albedo.g,
    b: indirect.b * albedo.b,
  };
}

// ── 几何体注入 ──────────────────────────────────────────────────

/**
 * 从网格数据构建几何体遮挡体积。
 * 把三角形网格光栅化到 cell 网格,标记被几何占据的 cell。
 *
 * @param config LPV 配置
 * @param meshes 网格数据(位置 + 索引)
 * @returns Uint8Array,1 = 占据,0 = 空
 */
export function buildGeometryVolume(
  config: LPVConfig,
  meshes: { positions: Float32Array; indices: Uint32Array | null }[],
): Uint8Array {
  const totalCells = config.dimX * config.dimY * config.dimZ;
  const geom = new Uint8Array(totalCells);
  const cellSize = config.cellSize;
  const halfCell = cellSize * 0.5;

  for (const mesh of meshes) {
    const pos = mesh.positions;
    const tris: [LPVVec3, LPVVec3, LPVVec3][] = [];
    if (mesh.indices) {
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i] * 3;
        const b = mesh.indices[i + 1] * 3;
        const c = mesh.indices[i + 2] * 3;
        tris.push([
          { x: pos[a], y: pos[a + 1], z: pos[a + 2] },
          { x: pos[b], y: pos[b + 1], z: pos[b + 2] },
          { x: pos[c], y: pos[c + 1], z: pos[c + 2] },
        ]);
      }
    } else {
      for (let i = 0; i < pos.length; i += 9) {
        tris.push([
          { x: pos[i], y: pos[i + 1], z: pos[i + 2] },
          { x: pos[i + 3], y: pos[i + 4], z: pos[i + 5] },
          { x: pos[i + 6], y: pos[i + 7], z: pos[i + 8] },
        ]);
      }
    }

    for (const tri of tris) {
      // 三角形 AABB
      const triMin: LPVVec3 = {
        x: Math.min(tri[0].x, tri[1].x, tri[2].x),
        y: Math.min(tri[0].y, tri[1].y, tri[2].y),
        z: Math.min(tri[0].z, tri[1].z, tri[2].z),
      };
      const triMax: LPVVec3 = {
        x: Math.max(tri[0].x, tri[1].x, tri[2].x),
        y: Math.max(tri[0].y, tri[1].y, tri[2].y),
        z: Math.max(tri[0].z, tri[1].z, tri[2].z),
      };

      // 转换到 cell 坐标
      const vMinX = Math.max(0, Math.floor((triMin.x - config.origin.x) / cellSize));
      const vMaxX = Math.min(config.dimX - 1, Math.floor((triMax.x - config.origin.x) / cellSize));
      const vMinY = Math.max(0, Math.floor((triMin.y - config.origin.y) / cellSize));
      const vMaxY = Math.min(config.dimY - 1, Math.floor((triMax.y - config.origin.y) / cellSize));
      const vMinZ = Math.max(0, Math.floor((triMin.z - config.origin.z) / cellSize));
      const vMaxZ = Math.min(config.dimZ - 1, Math.floor((triMax.z - config.origin.z) / cellSize));

      // 遍历 AABB 内的 cell
      for (let z = vMinZ; z <= vMaxZ; z++) {
        for (let y = vMinY; y <= vMaxY; y++) {
          for (let x = vMinX; x <= vMaxX; x++) {
            // cell 中心
            const cx = config.origin.x + (x + 0.5) * cellSize;
            const cy = config.origin.y + (y + 0.5) * cellSize;
            const cz = config.origin.z + (z + 0.5) * cellSize;

            // 简化检测:cell 中心到三角形平面的距离 < halfCell
            const edge1: LPVVec3 = { x: tri[1].x - tri[0].x, y: tri[1].y - tri[0].y, z: tri[1].z - tri[0].z };
            const edge2: LPVVec3 = { x: tri[2].x - tri[0].x, y: tri[2].y - tri[0].y, z: tri[2].z - tri[0].z };
            const normal: LPVVec3 = {
              x: edge1.y * edge2.z - edge1.z * edge2.y,
              y: edge1.z * edge2.x - edge1.x * edge2.z,
              z: edge1.x * edge2.y - edge1.y * edge2.x,
            };
            const nLen = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
            if (nLen < 1e-10) continue;
            const distToPlane = Math.abs(
              (cx - tri[0].x) * normal.x +
              (cy - tri[0].y) * normal.y +
              (cz - tri[0].z) * normal.z,
            ) / nLen;

            if (distToPlane <= halfCell + 1e-6) {
              const idx = x + y * config.dimX + z * config.dimX * config.dimY;
              geom[idx] = 1;
            }
          }
        }
      }
    }
  }

  const occupied = geom.reduce((s, v) => s + v, 0);
  log.debug(`Geometry volume: ${occupied}/${totalCells} cells occupied`);
  return geom;
}

// ── 统计 ────────────────────────────────────────────────────────

/**
 * 获取 LPV 网格统计。
 */
export function getLPVStats(grid: LPVGrid): {
  totalCells: number;
  occupiedCells: number;
  memoryBytes: number;
  memoryMB: number;
  totalEnergy: number;
} {
  const cfg = grid.config;
  const totalCells = cfg.dimX * cfg.dimY * cfg.dimZ;
  let occupiedCells = 0;
  let totalEnergy = 0;

  for (let c = 0; c < totalCells; c++) {
    const idx = c * SH2_COEFFS_PER_CELL;
    // SH[0,1,2] 是 Y00 系数(常数项),代表各向同性部分
    const energy = Math.abs(grid.sh[idx]) + Math.abs(grid.sh[idx + 1]) + Math.abs(grid.sh[idx + 2]);
    if (energy > 1e-8) occupiedCells++;
    totalEnergy += energy;
  }

  const memoryBytes = grid.sh.byteLength + grid.shBuffer.byteLength;

  return {
    totalCells,
    occupiedCells,
    memoryBytes,
    memoryMB: memoryBytes / (1024 * 1024),
    totalEnergy,
  };
}

// ── GLSL 着色器块 ──────────────────────────────────────────────

/**
 * GLSL:LPV 采样(chunk)。
 * 调用方需提供 u_lpvSH(sampler3D,RGBA32F = SH 系数打包)
 * 和网格参数。
 */
export const LPV_GLSL = /* glsl */ `
// ── Light Propagation Volume Sampling ─────────────────────────
// uniform sampler3D u_lpvSH;       // SH 系数 3D 纹理(RGBA32F,每 cell 7 个 texel)
// uniform vec3 u_lpvOrigin;        // 网格原点(世界坐标)
// uniform float u_lpvCellSize;     // cell 尺寸
// uniform ivec3 u_lpvDims;         // 网格维度
// uniform int u_lpvSHBands;        // SH 阶数(2 = SH2)

// 世界坐标 → cell 浮点坐标
vec3 worldToLPVCell(vec3 worldPos) {
  return (worldPos - u_lpvOrigin) / u_lpvCellSize;
}

// 采样 LPV(cell 中心)的 SH 系数(简化:仅 SH2 常数项)
vec3 sampleLPVConstant(vec3 worldPos) {
  vec3 cellF = worldToLPVCell(worldPos);
  cellF = clamp(cellF, vec3(0.0), vec3(u_lpvDims) - 1.0);
  // 采样 mip 0 的第一个 texel(SH Y00 系数)
  vec3 uvw = (cellF + 0.5) / vec3(u_lpvDims);
  return texture(u_lpvSH, uvw).rgb;
}

// 完整 SH2 评估
vec3 sampleLPVSH2(vec3 worldPos, vec3 normal) {
  vec3 cellF = worldToLPVCell(worldPos);
  cellF = clamp(cellF, vec3(0.0), vec3(u_lpvDims) - 1.0);
  vec3 uvw = (cellF + 0.5) / vec3(u_lpvDims);

  // 采样 9 个 SH 系数(打包在多个 texel 中)
  // 实际实现中,SH 系数存储在 3D 纹理的多个切片或多个纹理中
  // 这里简化为采样常数项 + 1 阶
  vec4 sh0 = texture(u_lpvSH, uvw);          // Y00, Y1m1, Y10, Y11 (打包)
  // vec4 sh1 = texture(u_lpvSH, uvw + vec3(0,0,0.5)); // Y2m2, Y2m1, Y20, Y21

  vec3 n = normalize(normal);
  float Y00 = 0.282095;
  float Y1m1 = 0.488603 * n.y;
  float Y10 = 0.488603 * n.z;
  float Y11 = 0.488603 * n.x;

  vec3 result = vec3(0.0);
  result += sh0.rgb * Y00;  // 简化:sh0.rgb = SH Y00 系数
  return result;
}
`;

/**
 * GLSL:LPV 光注入(chunk)。
 * GPU 注入使用 compute shader 写入 3D 纹理。
 */
export const LPV_INJECTION_GLSL = /* glsl */ `
// ── LPV Light Injection (Compute Shader) ─────────────────────
// layout(binding = 0, rgba32f) uniform image3D u_lpvSHImage;
// uniform vec3 u_lpvOrigin;
// uniform float u_lpvCellSize;
// uniform ivec3 u_lpvDims;

// 点光源注入
void injectPointLight(vec3 lightPos, vec3 lightColor, float intensity, float range) {
  vec3 lightCell = (lightPos - u_lpvOrigin) / u_lpvCellSize;
  float rangeInCells = range / u_lpvCellSize;
  ivec3 lightCellI = ivec3(lightCell);
  int rangeI = int(ceil(rangeInCells));

  for (int z = max(0, lightCellI.z - rangeI); z <= min(u_lpvDims.z - 1, lightCellI.z + rangeI); z++) {
    for (int y = max(0, lightCellI.y - rangeI); y <= min(u_lpvDims.y - 1, lightCellI.y + rangeI); y++) {
      for (int x = max(0, lightCellI.x - rangeI); x <= min(u_lpvDims.x - 1, lightCellI.x + rangeI); x++) {
        vec3 cellCenter = u_lpvOrigin + (vec3(x, y, z) + 0.5) * u_lpvCellSize;
        vec3 toCell = cellCenter - lightPos;
        float dist = length(toCell);
        if (dist > range || dist < 1e-6) continue;

        float atten = 1.0 / (dist * dist) * max(0.0, 1.0 - pow(dist / range, 4.0)) * intensity;
        vec3 dir = toCell / dist;
        vec3 irradiance = lightColor * atten;

        // SH2 投影(简化:仅 Y00 + Y1)
        float Y00 = 0.282095;
        vec4 sh = vec4(
          irradiance * Y00,                    // Y00 RGB packed
          dot(irradiance, vec3(0.488603 * dir.y, 0.488603 * dir.z, 0.488603 * dir.x))
        );

        ivec3 coord = ivec3(x, y, z);
        vec4 prev = imageLoad(u_lpvSHImage, coord);
        imageStore(u_lpvSHImage, coord, prev + sh);
      }
    }
  }
}
`;

/**
 * GLSL:LPV 光传播(chunk)。
 * GPU 传播使用 compute shader + 双缓冲 3D 纹理。
 */
export const LPV_PROPAGATION_GLSL = /* glsl */ `
// ── LPV Light Propagation (Compute Shader) ───────────────────
// layout(binding = 0, rgba32f) readonly uniform image3D u_lpvSHSrc;
// layout(binding = 1, rgba32f) writeonly uniform image3D u_lpvSHDst;
// uniform ivec3 u_lpvDims;
// uniform float u_propagationStrength;

// 6 个面方向
const vec3 FACE_DIRS[6] = vec3[6](
  vec3(1, 0, 0), vec3(-1, 0, 0),
  vec3(0, 1, 0), vec3(0, -1, 0),
  vec3(0, 0, 1), vec3(0, 0, -1)
);

// 单次传播(compute shader:每个线程处理一个 cell)
void propagateCell(ivec3 cellCoord) {
  vec4 accum = imageLoad(u_lpvSHSrc, cellCoord); // 保留当前 SH

  for (int f = 0; f < 6; f++) {
    vec3 dir = FACE_DIRS[f];
    ivec3 neighbor = cellCoord + ivec3(dir);

    if (any(lessThan(neighbor, ivec3(0))) || any(greaterThanEqual(neighbor, u_lpvDims))) continue;

    // 评估源 cell 在面方向上的辐照度
    vec4 srcSH = imageLoad(u_lpvSHSrc, cellCoord);
    vec3 radiance = srcSH.rgb * 0.282095; // 简化:仅 Y00

    // 沿 -d 方向投影到 SH
    vec3 invDir = -dir;
    float Y00 = 0.282095;
    vec3 propagated = radiance * Y00 * (u_propagationStrength / 6.0);

    accum.rgb += propagated;
  }

  imageStore(u_lpvSHDst, cellCoord, accum);
}
`;
