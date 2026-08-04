// SpecularAA — 高光抗锯齿工具集(Toksvig / LEAN / CLEAN / GSAA)。
//
// 解决问题:法线贴图的高频细节在屏幕空间欠采样时,高光项(specular term)
// 会出现锯齿 / 闪烁 / 走样 — 相机或几何一动就"爬行"。根本原因:
// 微表面法线分布 GGX 期望 NDF 在像素覆盖范围内积分,但逐像素单次采样
// 法线贴图只取一个 texel,忽略了该像素覆盖的多个微法线 → 高光能量泄漏。
//
// 解决思路:把法线方差转换为粗糙度增量,让高光"撑开"以覆盖真实微法线分布。
// 四种主流技术:
//
//   1. **Toksvig (2005)** — 运行时,从滤波后法线长度估算方差:
//        方差 ∝ (1 - |N|),adjustedRoughness = f(roughness, 1 - |N|)
//      无需预计算,适用于任意法线贴图(包括 mip 链滤波后)。
//
//   2. **LEAN Mapping (Olano & Baker 2010)** — 预计算法线贴图的二阶矩
//      (m11, m22, m12),存到 3 通道 LEAN 贴图。运行时从二阶矩重建方差,
//      直接调整粗糙度。质量最高(精确协方差),需 3 通道额外贴图。
//
//   3. **CLEAN Mapping** — LEAN 的简化版,只存对角二阶矩(m11, m22),
//      忽略协方差(m12)。2 通道,质量略低于 LEAN,但贴图开销更小。
//
//   4. **Geometric Specular AA (GSAA)** — 从三角形几何(面积 / 边长 /
//      顶点法线差)推导方差,在顶点 / 像素阶段调整粗糙度。无需法线贴图,
//      适用于低多边形 / 硬边几何的高光稳定化。
//
// 纯函数,不依赖 WebGL,可在 Node / 无头环境测试。与 GLSL `SPECULAR_AA_FRAG`
// chunk 1:1 对应。
//
// 参考:
//   - Toksvig 2005 "Mipmapping Normal Maps"
//   - Olano & Baker 2010 "LEAN Mapping"
//   - McAuley 2012 "LEAN Mapping Incorrectly" (CLEAN correction)
//   - UE5 MaterialSpecularAA / GetRoughnessFromNormalLength
//   - o3de Atom SpecularAA (MaterialContext modifier)
//   - three.js GeometryUtils (normal variance reference)
//   - Stephen Hill 2011 "Specular AA"

import { createLogger } from '@/lib/logger';

const log = createLogger('SpecularAA');

// ── Toksvig (2005) ─────────────────────────────────────────────────

/**
 * Toksvig 高光抗锯齿:从滤波后法线长度估算粗糙度增量。
 *
 * 原理:法线贴图经 mip 滤波后,|N| < 1(多个微法线平均)。|N| 越小 →
 * 方差越大 → 高光越应撑开。Toksvig 公式把 (1 - |N|) 转为粗糙度增量:
 *
 *   k = (1 - normalLength) / normalLength
 *   adjustedRoughness² = roughness² + k * (1 - roughness²) * strength
 *
 * @param normalLength  滤波后法线长度 [0,1](1=无方差,平滑法线)
 * @param roughness      原始粗糙度 [0,1]
 * @param strength       强度 [0,1](默认 1.0);0=禁用
 * @returns              调整后粗糙度 [0,1]
 */
export function toksvigRoughness(
  normalLength: number,
  roughness: number,
  strength: number = 1.0,
): number {
  // 法线已归一化(|N|=1)→ 无需调整
  if (normalLength >= 1.0) return roughness;
  // 法线长度过小 → 钳制,防止除零 / 过度模糊
  const nl = Math.max(normalLength, 1e-4);
  const k = (1 - nl) / nl * strength;
  const r2 = roughness * roughness;
  const adjusted = Math.sqrt(r2 + k * (1 - r2));
  return Math.min(1, adjusted);
}

/**
 * Toksvig 方差估算(用于调试 / 可视化)。
 * 返回 (1 - |N|) / |N|,即方差代理量。
 */
export function toksvigVariance(normalLength: number): number {
  if (normalLength >= 1.0) return 0;
  const nl = Math.max(normalLength, 1e-4);
  return (1 - nl) / nl;
}

// ── LEAN Mapping (Olano & Baker 2010) ──────────────────────────────

/** LEAN 贴图的二阶矩采样结果。 */
export interface LEANMoments {
  /** E[nx²] — x 方向二阶矩。 */
  m11: number;
  /** E[ny²] — y 方向二阶矩。 */
  m22: number;
  /** E[nx·ny] — 协方差。 */
  m12: number;
}

/**
 * LEAN mapping:从二阶矩计算法线方差(协方差矩阵的迹)。
 *
 * 方差 = (m11 - bx²) + (m22 - by²),其中 (bx, by) = (E[nx], E[ny]) 是一阶矩。
 * 简化:若 LEAN 贴图已存"中心化"二阶矩(已减去 bx²/by²),则方差 = m11 + m22。
 * 本函数假设输入是原始二阶矩,并接受 bx/by 一阶矩参数。
 *
 * @param m11    E[nx²]
 * @param m22    E[ny²]
 * @param m12    E[nx·ny](协方差)
 * @param bx     E[nx](一阶矩,默认 0,假设已中心化)
 * @param by     E[ny](一阶矩,默认 0)
 * @returns      方差 σ² = Var(nx) + Var(ny)
 */
export function leanMappingVariance(
  m11: number, m22: number, _m12: number,
  bx: number = 0, by: number = 0,
): number {
  // Var(nx) = E[nx²] - E[nx]²
  const varX = m11 - bx * bx;
  const varY = m22 - by * by;
  // 方差非负(数值误差时钳制)
  return Math.max(0, varX + varY);
}

/**
 * LEAN mapping:从二阶矩 + 基础粗糙度计算调整后粗糙度。
 *
 * 把方差转为粗糙度增量:Δroughness² = variance * strength。
 *
 * @param moments        LEAN 二阶矩
 * @param baseRoughness  原始粗糙度 [0,1]
 * @param bx             E[nx](默认 0)
 * @param by             E[ny](默认 0)
 * @param strength       强度(默认 1.0)
 * @returns              调整后粗糙度 [0,1]
 */
export function leanRoughness(
  moments: LEANMoments,
  baseRoughness: number,
  bx: number = 0,
  by: number = 0,
  strength: number = 1.0,
): number {
  const variance = leanMappingVariance(moments.m11, moments.m22, moments.m12, bx, by);
  const r2 = baseRoughness * baseRoughness;
  const adjusted = Math.sqrt(r2 + variance * strength);
  return Math.min(1, adjusted);
}

/**
 * LEAN mapping:计算法线锥的方向(协方差主轴角度)。
 * 用于各向异性高光(可选)。
 *
 * @returns 主轴角度(弧度),0 = x 轴
 */
export function leanAnisoAngle(m11: number, m22: number, m12: number): number {
  // 协方差矩阵 [[m11, m12], [m12, m22]] 的特征向量角度
  // θ = 0.5 * atan2(2*m12, m11 - m22)
  return 0.5 * Math.atan2(2 * m12, m11 - m22);
}

// ── CLEAN Mapping (简化 LEAN,2 通道) ──────────────────────────────

/**
 * CLEAN mapping:从对角二阶矩(m11, m22)计算方差,忽略协方差。
 * 适用于各向同性场景(法线方差无方向性)。
 *
 * @returns 方差 = (m11 - 0) + (m22 - 0)(假设已中心化)
 */
export function cleanVariance(m11: number, m22: number): number {
  return Math.max(0, m11 + m22);
}

/**
 * CLEAN mapping:从对角二阶矩 + 基础粗糙度计算调整后粗糙度。
 */
export function cleanRoughness(
  m11: number, m22: number,
  baseRoughness: number, strength: number = 1.0,
): number {
  const variance = cleanVariance(m11, m22);
  const r2 = baseRoughness * baseRoughness;
  const adjusted = Math.sqrt(r2 + variance * strength);
  return Math.min(1, adjusted);
}

// ── Geometric Specular AA (GSAA) ───────────────────────────────────

/** 三角形顶点(位置 + 法线)。 */
export interface GSAAVertex {
  x: number; y: number; z: number;  // 位置
  nx: number; ny: number; nz: number;  // 法线
}

/**
 * Geometric Specular AA:从三角形几何推导法线方差。
 *
 * 原理:大三角形 + 顶点法线差异大 → 像素内法线变化大 → 高光应撑开。
 * 方差估算:顶点法线夹角的正弦² × 缩放因子。
 *
 * @param v0,v1,v2  三角形三顶点
 * @returns          方差 [0, ∞)
 */
export function gsaaVariance(
  v0: GSAAVertex, v1: GSAAVertex, v2: GSAAVertex,
): number {
  // 三条边的顶点法线差
  const d01x = v1.nx - v0.nx, d01y = v1.ny - v0.ny, d01z = v1.nz - v0.nz;
  const d12x = v2.nx - v1.nx, d12y = v2.ny - v1.ny, d12z = v2.nz - v1.nz;
  const d20x = v0.nx - v2.nx, d20y = v0.ny - v2.ny, d20z = v0.nz - v2.nz;

  // 平均法线差的平方长度
  const l01 = d01x * d01x + d01y * d01y + d01z * d01z;
  const l12 = d12x * d12x + d12y * d12y + d12z * d12z;
  const l20 = d20x * d20x + d20y * d20y + d20z * d20z;
  const avgSq = (l01 + l12 + l20) / 3;

  // 三角形面积(叉积模长 / 2)
  const ex = v1.x - v0.x, ey = v1.y - v0.y, ez = v1.z - v0.z;
  const fx = v2.x - v0.x, fy = v2.y - v0.y, fz = v2.z - v0.z;
  const cx = ey * fz - ez * fy;
  const cy = ez * fx - ex * fz;
  const cz = ex * fy - ey * fx;
  const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);

  // 面积过小 → 钳制,防止除零
  const a = Math.max(area, 1e-8);
  // 方差 ∝ 法线差² / 面积(小三角形 + 大法线差 → 高方差)
  return avgSq / a;
}

/**
 * GSAA:从三角形几何 + 基础粗糙度计算调整后粗糙度。
 */
export function gsaaRoughness(
  v0: GSAAVertex, v1: GSAAVertex, v2: GSAAVertex,
  baseRoughness: number, strength: number = 1.0,
): number {
  const variance = gsaaVariance(v0, v1, v2);
  const r2 = baseRoughness * baseRoughness;
  const adjusted = Math.sqrt(r2 + variance * strength);
  return Math.min(1, adjusted);
}

// ── 法线贴图邻域方差(运行时 / 离线) ───────────────────────────────

/**
 * 计算法线贴图在 (x, y) 处邻域内的法线方差。
 *
 * 对 radius×radius 邻域内所有法线求均值与协方差,返回方差(迹)。
 * 用于离线生成 LEAN / CLEAN 贴图,或运行时估算方差(无预计算时)。
 *
 * @param normals   法线数据(RGBA,xyz=法线,w=未用),长度 = w*h*4
 * @param width     贴图宽度
 * @param height    贴图高度
 * @param x         中心 x(像素)
 * @param y         中心 y(像素)
 * @param radius    邻域半径(默认 1 = 3×3)
 * @returns         方差 σ² = Var(nx) + Var(ny)
 */
export function computeNormalVariance(
  normals: Float32Array,
  width: number, height: number,
  x: number, y: number,
  radius: number = 1,
): number {
  let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = Math.max(0, Math.min(width - 1, x + dx));
      const sy = Math.max(0, Math.min(height - 1, y + dy));
      const i = (sy * width + sx) * 4;
      const nx = normals[i];
      const ny = normals[i + 1];
      sumX += nx;
      sumY += ny;
      sumX2 += nx * nx;
      sumY2 += ny * ny;
      count++;
    }
  }
  if (count < 1) return 0;
  const ex = sumX / count;   // E[nx]
  const ey = sumY / count;   // E[ny]
  const ex2 = sumX2 / count; // E[nx²]
  const ey2 = sumY2 / count; // E[ny²]
  // Var = E[X²] - E[X]²
  const varX = Math.max(0, ex2 - ex * ex);
  const varY = Math.max(0, ey2 - ey * ey);
  return varX + varY;
}

/**
 * 从法线贴图邻域方差 + 基础粗糙度计算调整后粗糙度。
 * 适用于无 LEAN 预计算的运行时场景(开销较高,建议离线生成 LEAN 贴图)。
 */
export function varianceToRoughness(
  variance: number,
  baseRoughness: number,
  strength: number = 1.0,
): number {
  const r2 = baseRoughness * baseRoughness;
  const adjusted = Math.sqrt(r2 + variance * strength);
  return Math.min(1, adjusted);
}

// ── 工具:法线长度计算 ─────────────────────────────────────────────

/**
 * 计算法线贴图在 (x, y) 处的滤波后法线长度。
 *
 * 用于 Toksvig:若法线贴图经 mip 滤波,|N| < 1。本函数对邻域求平均后
 * 返回平均向量的长度(不归一化)。
 *
 * @param normals   法线数据(已归一化的 xyz)
 * @param width,height
 * @param x,y       中心像素
 * @param radius    邻域半径(默认 1 = 3×3)
 * @returns         平均法线长度 [0,1]
 */
export function filteredNormalLength(
  normals: Float32Array,
  width: number, height: number,
  x: number, y: number,
  radius: number = 1,
): number {
  let sx = 0, sy = 0, sz = 0, count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.max(0, Math.min(width - 1, x + dx));
      const py = Math.max(0, Math.min(height - 1, y + dy));
      const i = (py * width + px) * 4;
      sx += normals[i];
      sy += normals[i + 1];
      sz += normals[i + 2];
      count++;
    }
  }
  if (count < 1) return 1;
  const ax = sx / count, ay = sy / count, az = sz / count;
  return Math.sqrt(ax * ax + ay * ay + az * az);
}

// ── LEAN 贴图离线生成 ──────────────────────────────────────────────

/** LEAN 贴图数据:每像素 3 通道(m11, m22, m12)。 */
export interface LEANMapData {
  /** 每像素 3 float,长度 = width*height*3。 */
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * 从法线贴图离线生成 LEAN 贴图(二阶矩)。
 *
 * 对每个像素取 radius×radius 邻域,计算:
 *   m11 = E[nx²], m22 = E[ny²], m12 = E[nx·ny]
 *
 * 生成后可在运行时用 leanRoughness() 采样调整粗糙度。
 *
 * @param normals   法线贴图(已归一化 xyz,RGBA)
 * @param width,height
 * @param radius    邻域半径(默认 1 = 3×3)
 * @returns         LEAN 贴图
 */
export function generateLEANMap(
  normals: Float32Array,
  width: number, height: number,
  radius: number = 1,
): LEANMapData {
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumX2 = 0, sumY2 = 0, sumXY = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          const sy = Math.max(0, Math.min(height - 1, y + dy));
          const i = (sy * width + sx) * 4;
          const nx = normals[i];
          const ny = normals[i + 1];
          sumX2 += nx * nx;
          sumY2 += ny * ny;
          sumXY += nx * ny;
          count++;
        }
      }
      const o = (y * width + x) * 3;
      data[o] = sumX2 / count;
      data[o + 1] = sumY2 / count;
      data[o + 2] = sumXY / count;
    }
  }
  log.debug(`LEAN map generated: ${width}x${height}, radius=${radius}`);
  return { data, width, height };
}

/**
 * 从法线贴图离线生成 CLEAN 贴图(简化,2 通道:仅 m11, m22)。
 */
export function generateCLEANMap(
  normals: Float32Array,
  width: number, height: number,
  radius: number = 1,
): { data: Float32Array; width: number; height: number } {
  const data = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumX2 = 0, sumY2 = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          const sy = Math.max(0, Math.min(height - 1, y + dy));
          const i = (sy * width + sx) * 4;
          const nx = normals[i];
          const ny = normals[i + 1];
          sumX2 += nx * nx;
          sumY2 += ny * ny;
          count++;
        }
      }
      const o = (y * width + x) * 2;
      data[o] = sumX2 / count;
      data[o + 1] = sumY2 / count;
    }
  }
  return { data, width, height };
}

// ── 采样 LEAN 贴图 ─────────────────────────────────────────────────

/**
 * 双线性采样 LEAN 贴图在 (u, v) 处的二阶矩。
 * 越界钳制到边缘(CLAMP_TO_EDGE)。
 */
export function sampleLEANMap(
  lean: LEANMapData, u: number, v: number,
): LEANMoments {
  const cu = u < 0 ? 0 : u > 1 ? 1 : u;
  const cv = v < 0 ? 0 : v > 1 ? 1 : v;
  const fx = cu * (lean.width - 1);
  const fy = cv * (lean.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(lean.width - 1, x0 + 1);
  const y1 = Math.min(lean.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = (y0 * lean.width + x0) * 3;
  const i10 = (y0 * lean.width + x1) * 3;
  const i01 = (y1 * lean.width + x0) * 3;
  const i11 = (y1 * lean.width + x1) * 3;

  const m11 = (1 - tx) * (1 - ty) * lean.data[i00]
            + tx * (1 - ty) * lean.data[i10]
            + (1 - tx) * ty * lean.data[i01]
            + tx * ty * lean.data[i11];
  const m22 = (1 - tx) * (1 - ty) * lean.data[i00 + 1]
            + tx * (1 - ty) * lean.data[i10 + 1]
            + (1 - tx) * ty * lean.data[i01 + 1]
            + tx * ty * lean.data[i11 + 1];
  const m12 = (1 - tx) * (1 - ty) * lean.data[i00 + 2]
            + tx * (1 - ty) * lean.data[i10 + 2]
            + (1 - tx) * ty * lean.data[i01 + 2]
            + tx * ty * lean.data[i11 + 2];

  return { m11, m22, m12 };
}
