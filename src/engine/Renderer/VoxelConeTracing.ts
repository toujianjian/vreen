// VoxelConeTracing — 体素锥追踪全局光照(Voxel Cone Tracing GI, VXGI)。
//
// 设计目标:
//   - 把场景体素化为 3D 网格(存颜色 + 占据率),构建 mip 链用于多分辨率采样。
//   - 沿锥形方向追踪,累积遮挡率与间接光照,同时产生 diffuse GI(宽锥)
//     和 specular GI(窄锥)。为离屏表面提供间接光照,无需探针布局。
//   - 与 SSGI(屏幕空间,仅可见表面)、DDGI(探针,需布局)、PathTracer(离线,
//     最高质量)互补:VXGI 是体素空间方案,覆盖离屏表面,无需探针,
//     比 SSGI 精确(不受屏幕边界限制),比 DDGI 灵活(无需手动放置探针),
//     比 PathTracer 快(锥追踪 ≈ 10-30 步,路径追踪 ≈ 1000+ 步)。
//
// 数据模型:
//   - VoxelScene:体素化场景(3D 网格 + mip 链)。
//   - VoxelMipLevel:单层 mip(占据率 + 颜色 + 法线)。
//   - Cone:锥追踪参数(方向 + 半角 + 最大距离)。
//   - ConeTraceResult:追踪结果(遮挡率 + 透射颜色)。
//
// 算法:
//   1. 体素化:把三角形网格光栅化到 3D 网格,存占据率 + 颜色 + 法线。
//   2. mip 链:逐层降采样,更高层 = 更粗粒度(更大覆盖范围)。
//   3. 锥追踪:沿锥方向步进,每步采样对应 mip 层级(锥半径 ∝ 步进距离),
//      累积遮挡率(α)和透射颜色(预乘 α 混合)。
//   4. Diffuse GI:在半球面发射多个宽锥(半角 ~30°),加权求和。
//   5. Specular GI:沿反射方向发射单个窄锥(半角 ∝ 粗糙度),采样间接高光。
//
// 参考:
//   - Crassin et al. 2011 "Interactive Indirect Illumination Using Voxel
//     Cone Tracing" (VXGI 原始论文)
//   - El Garawany 2013 "Voxel Cone Tracing" (SIGGRAPH course)
//   - o3de Atom "Diffuse Global Illumination" (DDGI) — 互补方案
//   - UE5 "Lumen" — GI 综合方案(VXGI + SSGI + DDGI 融合)
//   - MeshDistanceField.ts — SDF 网格化模式(类似 3D 网格架构)
//   - DDGIVolume.ts — 探针 GI(互补方案)
//   - SSGI.ts — 屏幕空间 GI(互补方案)

import { createLogger } from '@/lib/logger';

const log = createLogger('VoxelConeTracing');

// ── 类型定义 ────────────────────────────────────────────────────

/** RGBA 颜色(浮点,0-1 范围)。 */
export interface VCTColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 3D 向量。 */
export interface VCTVec3 {
  x: number;
  y: number;
  z: number;
}

/** 三角形(3 个顶点)。 */
export type VCTTriangle = [VCTVec3, VCTVec3, VCTVec3];

/** 网格数据(位置 + 索引)。 */
export interface VCTMeshData {
  positions: Float32Array;
  indices: Uint32Array | null;
  /** 每顶点颜色(可选,RGBA,0-1)。 */
  colors?: Float32Array | null;
}

/** 单层 mip 级别。 */
export interface VoxelMipLevel {
  /** mip 层级(0 = 最高分辨率)。 */
  mip: number;
  /** 该层每边体素数。 */
  dim: number;
  /** 占据率(0=空,1=占据),长度 dim³。 */
  occupancy: Float32Array;
  /** 颜色(预乘 α),长度 dim³ × 4。 */
  color: Float32Array;
  /** 法线(归一化),长度 dim³ × 3。 */
  normal: Float32Array;
}

/** 体素化场景。 */
export interface VoxelScene {
  /** 场景 AABB 最小点。 */
  boundsMin: VCTVec3;
  /** 场景 AABB 最大点。 */
  boundsMax: VCTVec3;
  /** 每边体素数(mip 0)。 */
  baseDim: number;
  /** 体素尺寸(boundsSize / baseDim)。 */
  voxelSize: VCTVec3;
  /** mip 层级数。 */
  mipCount: number;
  /** mip 链。 */
  mips: VoxelMipLevel[];
}

/** 锥追踪参数。 */
export interface Cone {
  /** 起点。 */
  origin: VCTVec3;
  /** 方向(归一化)。 */
  direction: VCTVec3;
  /** 半角(弧度)。 */
  halfAngle: number;
  /** 最大追踪距离。 */
  maxDistance: number;
}

/** 锥追踪结果。 */
export interface ConeTraceResult {
  /** 累积遮挡率(0=无遮挡,1=完全遮挡)。 */
  occlusion: number;
  /** 透射颜色(预乘 α 混合后的颜色)。 */
  color: VCTColor;
  /** 是否命中任何体素。 */
  hit: boolean;
  /** 步数。 */
  steps: number;
}

/** diffuse GI 追踪选项。 */
export interface DiffuseGIOptions {
  /** 锥数量(默认 6,更多 = 更平滑但更慢)。 */
  coneCount?: number;
  /** 锥半角(弧度,默认 π/6 = 30°)。 */
  coneHalfAngle?: number;
  /** 最大追踪距离(默认 = 场景对角线)。 */
  maxDistance?: number;
  /** 法线偏置(默认 1 体素,避免自相交)。 */
  normalBias?: number;
}

/** specular GI 追踪选项。 */
export interface SpecularGIOptions {
  /** 锥半角(弧度,默认根据粗糙度计算)。 */
  coneHalfAngle?: number;
  /** 最大追踪距离(默认 = 场景对角线)。 */
  maxDistance?: number;
  /** 法线偏置。 */
  normalBias?: number;
}

// ── 向量工具 ────────────────────────────────────────────────────

export function vctVadd(a: VCTVec3, b: VCTVec3): VCTVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vctVsub(a: VCTVec3, b: VCTVec3): VCTVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vctVscale(a: VCTVec3, s: number): VCTVec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vctVdot(a: VCTVec3, b: VCTVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vctVcross(a: VCTVec3, b: VCTVec3): VCTVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vctVlength(a: VCTVec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vctVnormalize(a: VCTVec3): VCTVec3 {
  const len = vctVlength(a);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function vctVreflect(incident: VCTVec3, normal: VCTVec3): VCTVec3 {
  const d = vctVdot(incident, normal);
  return {
    x: incident.x - 2 * d * normal.x,
    y: incident.y - 2 * d * normal.y,
    z: incident.z - 2 * d * normal.z,
  };
}

// ── 颜色工具 ────────────────────────────────────────────────────

export function vctColorLerp(a: VCTColor, b: VCTColor, t: number): VCTColor {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

// ── 体素场景构建 ────────────────────────────────────────────────

/**
 * 3D 索引 → 1D 线性索引。
 */
export function vctIdx3(x: number, y: number, z: number, dim: number): number {
  return x + y * dim + z * dim * dim;
}

/**
 * 世界坐标 → 体素坐标(浮点)。
 */
export function worldToVoxelF(p: VCTVec3, scene: VoxelScene): VCTVec3 {
  return {
    x: (p.x - scene.boundsMin.x) / scene.voxelSize.x,
    y: (p.y - scene.boundsMin.y) / scene.voxelSize.y,
    z: (p.z - scene.boundsMin.z) / scene.voxelSize.z,
  };
}

/**
 * 世界坐标 → 体素坐标(整数)。
 */
export function worldToVoxelI(p: VCTVec3, scene: VoxelScene): { x: number; y: number; z: number } {
  const f = worldToVoxelF(p, scene);
  return {
    x: Math.floor(f.x),
    y: Math.floor(f.y),
    z: Math.floor(f.z),
  };
}

/**
 * 体素坐标 → 世界坐标(体素中心)。
 */
export function voxelToWorld(v: { x: number; y: number; z: number }, scene: VoxelScene): VCTVec3 {
  return {
    x: scene.boundsMin.x + (v.x + 0.5) * scene.voxelSize.x,
    y: scene.boundsMin.y + (v.y + 0.5) * scene.voxelSize.y,
    z: scene.boundsMin.z + (v.z + 0.5) * scene.voxelSize.z,
  };
}

/**
 * 判断体素坐标是否在网格内。
 */
export function isVoxelInside(v: { x: number; y: number; z: number }, dim: number): boolean {
  return v.x >= 0 && v.y >= 0 && v.z >= 0 && v.x < dim && v.y < dim && v.z < dim;
}

/**
 * 收集网格的所有三角形。
 */
export function collectTriangles(mesh: VCTMeshData): VCTTriangle[] {
  const result: VCTTriangle[] = [];
  const pos = mesh.positions;
  if (mesh.indices) {
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] * 3;
      const b = mesh.indices[i + 1] * 3;
      const c = mesh.indices[i + 2] * 3;
      result.push([
        { x: pos[a], y: pos[a + 1], z: pos[a + 2] },
        { x: pos[b], y: pos[b + 1], z: pos[b + 2] },
        { x: pos[c], y: pos[c + 1], z: pos[c + 2] },
      ]);
    }
  } else {
    for (let i = 0; i < pos.length; i += 9) {
      result.push([
        { x: pos[i], y: pos[i + 1], z: pos[i + 2] },
        { x: pos[i + 3], y: pos[i + 4], z: pos[i + 5] },
        { x: pos[i + 6], y: pos[i + 7], z: pos[i + 8] },
      ]);
    }
  }
  return result;
}

/**
 * 计算网格 AABB。
 */
export function computeMeshAABB(mesh: VCTMeshData): { min: VCTVec3; max: VCTVec3 } {
  let min: VCTVec3 = { x: Infinity, y: Infinity, z: Infinity };
  let max: VCTVec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    if (x < min.x) min.x = x;
    if (y < min.y) min.y = y;
    if (z < min.z) min.z = z;
    if (x > max.x) max.x = x;
    if (y > max.y) max.y = y;
    if (z > max.z) max.z = z;
  }
  if (!Number.isFinite(min.x)) {
    min = { x: 0, y: 0, z: 0 };
    max = { x: 0, y: 0, z: 0 };
  }
  return { min, max };
}

/**
 * 计算三角形重心坐标。
 */
function barycentric(p: VCTVec3, a: VCTVec3, b: VCTVec3, c: VCTVec3): { u: number; v: number; w: number } {
  const v0 = vctVsub(b, a);
  const v1 = vctVsub(c, a);
  const v2 = vctVsub(p, a);
  const d00 = vctVdot(v0, v0);
  const d01 = vctVdot(v0, v1);
  const d11 = vctVdot(v1, v1);
  const d20 = vctVdot(v2, v0);
  const d21 = vctVdot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-10) {
    return { u: 1, v: 0, w: 0 };
  }
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  return { u, v, w };
}

/**
 * 体素化网格到 3D 网格。
 * 使用"采样法":对每个体素中心,检查是否在某个三角形附近。
 * 简化实现:对每个三角形,光栅化其 AABB 范围内的体素。
 *
 * @param meshes 网格数组
 * @param boundsMin 场景 AABB 最小点
 * @param boundsMax 场景 AABB 最大点
 * @param dim 每边体素数(2 的幂,如 64/128/256)
 */
export function voxelizeScene(
  meshes: VCTMeshData[],
  boundsMin: VCTVec3,
  boundsMax: VCTVec3,
  dim: number,
): VoxelScene {
  const sizeX = boundsMax.x - boundsMin.x;
  const sizeY = boundsMax.y - boundsMin.y;
  const sizeZ = boundsMax.z - boundsMin.z;
  const voxelSize: VCTVec3 = { x: sizeX / dim, y: sizeY / dim, z: sizeZ / dim };

  // mip 0: 最高分辨率
  const occupancy = new Float32Array(dim * dim * dim);
  const color = new Float32Array(dim * dim * dim * 4);
  const normal = new Float32Array(dim * dim * dim * 3);

  // 默认颜色(白色)
  for (let i = 0; i < dim * dim * dim; i++) {
    color[i * 4] = 0.8;
    color[i * 4 + 1] = 0.8;
    color[i * 4 + 2] = 0.8;
    color[i * 4 + 3] = 0;
  }

  // 对每个网格体素化
  for (const mesh of meshes) {
    const tris = collectTriangles(mesh);
    for (const tri of tris) {
      // 三角形法线
      const edge1 = vctVsub(tri[1], tri[0]);
      const edge2 = vctVsub(tri[2], tri[0]);
      const triNormal = vctVnormalize(vctVcross(edge1, edge2));

      // 三角形 AABB
      const triMin: VCTVec3 = {
        x: Math.min(tri[0].x, tri[1].x, tri[2].x),
        y: Math.min(tri[0].y, tri[1].y, tri[2].y),
        z: Math.min(tri[0].z, tri[1].z, tri[2].z),
      };
      const triMax: VCTVec3 = {
        x: Math.max(tri[0].x, tri[1].x, tri[2].x),
        y: Math.max(tri[0].y, tri[1].y, tri[2].y),
        z: Math.max(tri[0].z, tri[1].z, tri[2].z),
      };

      // 转换到体素坐标(clamp 到 [0, dim-1] 以处理正好在网格上边界的三角形)
      const clampi = (v: number) => Math.max(0, Math.min(dim - 1, v));
      const sceneStub = { boundsMin, boundsMax, baseDim: dim, voxelSize, mipCount: 0, mips: [] as VoxelMipLevel[] };
      const vMin = worldToVoxelI(triMin, sceneStub);
      const vMax = worldToVoxelI(triMax, sceneStub);
      const vxMin = clampi(vMin.x), vxMax = clampi(vMax.x);
      const vyMin = clampi(vMin.y), vyMax = clampi(vMax.y);
      const vzMin = clampi(vMin.z), vzMax = clampi(vMax.z);

      // 遍历三角形 AABB 内的体素
      for (let z = vzMin; z <= vzMax; z++) {
        for (let y = vyMin; y <= vyMax; y++) {
          for (let x = vxMin; x <= vxMax; x++) {
            const voxelCenter = voxelToWorld({ x, y, z }, sceneStub);
            // 计算重心坐标
            const bary = barycentric(voxelCenter, tri[0], tri[1], tri[2]);
            // 在三角形平面上的投影点
            const projPoint: VCTVec3 = {
              x: tri[0].x * bary.u + tri[1].x * bary.v + tri[2].x * bary.w,
              y: tri[0].y * bary.u + tri[1].y * bary.v + tri[2].y * bary.w,
              z: tri[0].z * bary.u + tri[1].z * bary.v + tri[2].z * bary.w,
            };
            const distToPlane = vctVlength(vctVsub(voxelCenter, projPoint));

            // 体素中心到三角形平面的距离 <= 半体素尺寸(含等号,处理边界对齐),
            // 且重心坐标有效(投影点在三角形内或边缘)
            const halfVoxel = Math.max(voxelSize.x, voxelSize.y, voxelSize.z) * 0.5;
            if (distToPlane <= halfVoxel + 1e-6 && bary.u >= -0.01 && bary.v >= -0.01 && bary.w >= -0.01) {
              const idx = vctIdx3(x, y, z, dim);
              occupancy[idx] = 1;
              // 设置法线
              normal[idx * 3] = triNormal.x;
              normal[idx * 3 + 1] = triNormal.y;
              normal[idx * 3 + 2] = triNormal.z;
              // 颜色(如果有顶点颜色,用重心坐标插值)
              if (mesh.colors) {
                const ca = mesh.colors;
                const aIdx = 0; // 简化:用第一个顶点的颜色
                color[idx * 4] = ca[aIdx] * 0.8 + 0.2;
                color[idx * 4 + 1] = ca[aIdx + 1] * 0.8 + 0.2;
                color[idx * 4 + 2] = ca[aIdx + 2] * 0.8 + 0.2;
                color[idx * 4 + 3] = 1;
              } else {
                // 默认颜色:基于法线的色调
                const shade = 0.5 + 0.5 * Math.abs(triNormal.y);
                color[idx * 4] = shade * 0.8;
                color[idx * 4 + 1] = shade * 0.85;
                color[idx * 4 + 2] = shade * 0.9;
                color[idx * 4 + 3] = 1;
              }
            }
          }
        }
      }
    }
  }

  const mip0: VoxelMipLevel = { mip: 0, dim, occupancy, color, normal };
  const mips = [mip0];

  // 构建 mip 链
  const maxMips = Math.floor(Math.log2(dim)) + 1;
  for (let m = 1; m < maxMips; m++) {
    const prev = mips[m - 1];
    const prevDim = prev.dim;
    const curDim = Math.max(1, prevDim >> 1);
    if (curDim < 1) break;

    const curOccupancy = new Float32Array(curDim * curDim * curDim);
    const curColor = new Float32Array(curDim * curDim * curDim * 4);
    const curNormal = new Float32Array(curDim * curDim * curDim * 3);

    for (let z = 0; z < curDim; z++) {
      for (let y = 0; y < curDim; y++) {
        for (let x = 0; x < curDim; x++) {
          const srcX = x * 2;
          const srcY = y * 2;
          const srcZ = z * 2;
          let occSum = 0;
          let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
          let nxSum = 0, nySum = 0, nzSum = 0;
          let count = 0;

          for (let dz = 0; dz < 2; dz++) {
            for (let dy = 0; dy < 2; dy++) {
              for (let dx = 0; dx < 2; dx++) {
                const sx = srcX + dx;
                const sy = srcY + dy;
                const sz = srcZ + dz;
                if (sx < prevDim && sy < prevDim && sz < prevDim) {
                  const sIdx = vctIdx3(sx, sy, sz, prevDim);
                  const occ = prev.occupancy[sIdx];
                  if (occ > 0) {
                    occSum += occ;
                    rSum += prev.color[sIdx * 4] * occ;
                    gSum += prev.color[sIdx * 4 + 1] * occ;
                    bSum += prev.color[sIdx * 4 + 2] * occ;
                    aSum += prev.color[sIdx * 4 + 3] * occ;
                    nxSum += prev.normal[sIdx * 3] * occ;
                    nySum += prev.normal[sIdx * 3 + 1] * occ;
                    nzSum += prev.normal[sIdx * 3 + 2] * occ;
                    count++;
                  }
                }
              }
            }
          }

          const idx = vctIdx3(x, y, z, curDim);
          if (count > 0) {
            curOccupancy[idx] = Math.min(1, occSum / count);
            curColor[idx * 4] = rSum / occSum;
            curColor[idx * 4 + 1] = gSum / occSum;
            curColor[idx * 4 + 2] = bSum / occSum;
            curColor[idx * 4 + 3] = aSum / count;
            const nLen = Math.sqrt(nxSum * nxSum + nySum * nySum + nzSum * nzSum);
            if (nLen > 1e-6) {
              curNormal[idx * 3] = nxSum / nLen;
              curNormal[idx * 3 + 1] = nySum / nLen;
              curNormal[idx * 3 + 2] = nzSum / nLen;
            }
          }
        }
      }
    }

    mips.push({
      mip: m,
      dim: curDim,
      occupancy: curOccupancy,
      color: curColor,
      normal: curNormal,
    });
  }

  const scene: VoxelScene = {
    boundsMin,
    boundsMax,
    baseDim: dim,
    voxelSize,
    mipCount: mips.length,
    mips,
  };

  log.info(`Voxelized scene: ${dim}³ base dim, ${mips.length} mips, ${meshes.length} meshes`);
  return scene;
}

// ── 体素采样 ────────────────────────────────────────────────────

/**
 * 三线性采样占据率。
 */
export function sampleOccupancyTrilinear(scene: VoxelScene, p: VCTVec3, mip: number): number {
  const m = scene.mips[Math.min(mip, scene.mipCount - 1)];
  if (!m) return 0;
  const dim = m.dim;
  const vf = worldToVoxelF(p, scene);
  // 缩放到当前 mip
  const scale = dim / scene.baseDim;
  // 远离网格的点返回 0(允许 1 体素的边界容差用于三线性插值)
  const fxRaw = vf.x * scale;
  const fyRaw = vf.y * scale;
  const fzRaw = vf.z * scale;
  if (fxRaw < -1 || fyRaw < -1 || fzRaw < -1 || fxRaw > dim || fyRaw > dim || fzRaw > dim) {
    return 0;
  }
  // clamp 到 [0, dim-1] 以处理正好在边界上的采样
  const fx = Math.max(0, Math.min(dim - 1, fxRaw));
  const fy = Math.max(0, Math.min(dim - 1, fyRaw));
  const fz = Math.max(0, Math.min(dim - 1, fzRaw));

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;

  const getOcc = (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= dim || y >= dim || z >= dim) return 0;
    return m.occupancy[vctIdx3(x, y, z, dim)];
  };

  const c000 = getOcc(x0, y0, z0);
  const c100 = getOcc(x1, y0, z0);
  const c010 = getOcc(x0, y1, z0);
  const c110 = getOcc(x1, y1, z0);
  const c001 = getOcc(x0, y0, z1);
  const c101 = getOcc(x1, y0, z1);
  const c011 = getOcc(x0, y1, z1);
  const c111 = getOcc(x1, y1, z1);

  const c00 = c000 * (1 - tx) + c100 * tx;
  const c10 = c010 * (1 - tx) + c110 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx;
  const c11 = c011 * (1 - tx) + c111 * tx;

  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;

  return c0 * (1 - tz) + c1 * tz;
}

/**
 * 三线性采样颜色(预乘 α)。
 */
export function sampleColorTrilinear(scene: VoxelScene, p: VCTVec3, mip: number): VCTColor {
  const m = scene.mips[Math.min(mip, scene.mipCount - 1)];
  if (!m) return { r: 0, g: 0, b: 0, a: 0 };
  const dim = m.dim;
  const vf = worldToVoxelF(p, scene);
  const scale = dim / scene.baseDim;
  const fxRaw = vf.x * scale;
  const fyRaw = vf.y * scale;
  const fzRaw = vf.z * scale;
  if (fxRaw < -1 || fyRaw < -1 || fzRaw < -1 || fxRaw > dim || fyRaw > dim || fzRaw > dim) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const fx = Math.max(0, Math.min(dim - 1, fxRaw));
  const fy = Math.max(0, Math.min(dim - 1, fyRaw));
  const fz = Math.max(0, Math.min(dim - 1, fzRaw));

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;

  const getCol = (x: number, y: number, z: number): VCTColor => {
    if (x < 0 || y < 0 || z < 0 || x >= dim || y >= dim || z >= dim) return { r: 0, g: 0, b: 0, a: 0 };
    const idx = vctIdx3(x, y, z, dim);
    return {
      r: m.color[idx * 4],
      g: m.color[idx * 4 + 1],
      b: m.color[idx * 4 + 2],
      a: m.color[idx * 4 + 3],
    };
  };

  const c000 = getCol(x0, y0, z0);
  const c100 = getCol(x1, y0, z0);
  const c010 = getCol(x0, y1, z0);
  const c110 = getCol(x1, y1, z0);
  const c001 = getCol(x0, y0, z1);
  const c101 = getCol(x1, y0, z1);
  const c011 = getCol(x0, y1, z1);
  const c111 = getCol(x1, y1, z1);

  const lerp = (a: VCTColor, b: VCTColor, t: number): VCTColor => ({
    r: a.r * (1 - t) + b.r * t,
    g: a.g * (1 - t) + b.g * t,
    b: a.b * (1 - t) + b.b * t,
    a: a.a * (1 - t) + b.a * t,
  });

  const c00 = lerp(c000, c100, tx);
  const c10 = lerp(c010, c110, tx);
  const c01 = lerp(c001, c101, tx);
  const c11 = lerp(c011, c111, tx);
  const c0 = lerp(c00, c10, ty);
  const c1 = lerp(c01, c11, ty);

  return lerp(c0, c1, tz);
}

// ── 锥追踪 ──────────────────────────────────────────────────────

/**
 * 单个锥追踪:沿锥方向步进,累积遮挡率和透射颜色。
 *
 * 算法(Crassin 2011):
 *   t = 起始偏置
 *   while t < maxDistance and occlusion < 1:
 *     coneRadius = t * tan(halfAngle)
 *     mipLevel = log2(coneRadius / voxelSize)  // 锥半径越大,采样越粗的 mip
 *     sample = sampleColorTrilinear(p + t * dir, mipLevel)
 *     alpha = sample.a * occupancy_weight
 *     color += sample.rgb * alpha * (1 - occlusion)
 *     occlusion += alpha * (1 - occlusion)
 *     t += coneRadius * stepScale  // 步长 = 锥半径(保证覆盖)
 *
 * @param scene 体素场景
 * @param cone 锥参数
 * @param stepScale 步长缩放(默认 1.0,更大 = 更快但更粗糙)
 */
export function traceCone(
  scene: VoxelScene,
  cone: Cone,
  stepScale = 1.0,
): ConeTraceResult {
  const dir = vctVnormalize(cone.direction);
  const tanHalfAngle = Math.tan(cone.halfAngle);
  const maxDist = Math.min(cone.maxDistance, vctVlength(vctVsub(scene.boundsMax, scene.boundsMin)) * 2);

  // 起始偏置(避免自相交)
  const startBias = Math.max(scene.voxelSize.x, scene.voxelSize.y, scene.voxelSize.z);

  let t = startBias;
  let occlusion = 0;
  let r = 0, g = 0, b = 0;
  let hit = false;
  let steps = 0;
  const maxSteps = 64;

  while (t < maxDist && occlusion < 0.99 && steps < maxSteps) {
    // 当前采样点
    const p: VCTVec3 = {
      x: cone.origin.x + dir.x * t,
      y: cone.origin.y + dir.y * t,
      z: cone.origin.z + dir.z * t,
    };

    // 锥半径 = t * tan(halfAngle)
    const coneRadius = t * tanHalfAngle;

    // mip 层级 = log2(coneRadius / voxelSize)
    const voxelDiag = Math.sqrt(
      scene.voxelSize.x ** 2 + scene.voxelSize.y ** 2 + scene.voxelSize.z ** 2,
    );
    const mipLevel = Math.max(0, Math.floor(Math.log2(Math.max(1, coneRadius / voxelDiag))));

    // 采样颜色和占据率
    const color = sampleColorTrilinear(scene, p, mipLevel);
    const occ = sampleOccupancyTrilinear(scene, p, mipLevel);

    if (occ > 0.01) {
      hit = true;
    }

    // 预乘 α 混合
    const alpha = color.a * occ;
    if (alpha > 0.001) {
      const transmittance = 1 - occlusion;
      r += color.r * alpha * transmittance;
      g += color.g * alpha * transmittance;
      b += color.b * alpha * transmittance;
      occlusion += alpha * transmittance;
    }

    // 步长 = max(coneRadius * stepScale, voxelSize)
    const step = Math.max(coneRadius * stepScale, voxelDiag * 0.5);
    t += step;
    steps++;
  }

  return {
    occlusion: Math.min(1, occlusion),
    color: { r, g, b, a: 1 },
    hit,
    steps,
  };
}

// ── Diffuse GI ──────────────────────────────────────────────────

/**
 * Fibonacci 半球采样:生成均匀分布的半球方向。
 */
export function fibonacciHemisphere(n: number, normal: VCTVec3): VCTVec3[] {
  const result: VCTVec3[] = [];
  const golden = (1 + Math.sqrt(5)) / 2;

  // 构建 TBN 基(Normal-Tangent-Bitangent)
  let up: VCTVec3;
  if (Math.abs(normal.y) < 0.99) {
    up = { x: 0, y: 1, z: 0 };
  } else {
    up = { x: 1, y: 0, z: 0 };
  }
  const tangent = vctVnormalize(vctVcross(up, normal));
  const bitangent = vctVcross(normal, tangent);

  for (let i = 0; i < n; i++) {
    const phi = (2 * Math.PI * i) / golden;
    const cosTheta = 1 - (2 * i + 1) / (2 * n);
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const x = Math.cos(phi) * sinTheta;
    const y = Math.sin(phi) * sinTheta;
    const z = cosTheta;

    // 从半球局部坐标转换到世界坐标
    const worldDir: VCTVec3 = {
      x: tangent.x * x + bitangent.x * y + normal.x * z,
      y: tangent.y * x + bitangent.y * y + normal.y * z,
      z: tangent.z * x + bitangent.z * y + normal.z * z,
    };
    result.push(vctVnormalize(worldDir));
  }

  return result;
}

/**
 * Diffuse GI:在法线半球面发射多个宽锥,加权求和。
 *
 * @param scene 体素场景
 * @param point 采样点(世界坐标)
 * @param normal 表面法线(归一化)
 * @param options 追踪选项
 * @returns 间接 diffuse 颜色 + 遮挡率
 */
export function traceDiffuseGI(
  scene: VoxelScene,
  point: VCTVec3,
  normal: VCTVec3,
  options: DiffuseGIOptions = {},
): { color: VCTColor; occlusion: number } {
  const coneCount = options.coneCount ?? 6;
  const coneHalfAngle = options.coneHalfAngle ?? Math.PI / 6; // 30°
  const diag = vctVlength(vctVsub(scene.boundsMax, scene.boundsMin));
  const maxDistance = options.maxDistance ?? diag;
  const voxelDiag = Math.sqrt(
    scene.voxelSize.x ** 2 + scene.voxelSize.y ** 2 + scene.voxelSize.z ** 2,
  );
  const normalBias = (options.normalBias ?? 1) * voxelDiag;

  // 沿法线偏移起点(避免自相交)
  const origin: VCTVec3 = {
    x: point.x + normal.x * normalBias,
    y: point.y + normal.y * normalBias,
    z: point.z + normal.z * normalBias,
  };

  // 生成半球方向
  const directions = fibonacciHemisphere(coneCount, normal);

  let r = 0, g = 0, b = 0;
  let occlusion = 0;

  for (const dir of directions) {
    const cone: Cone = {
      origin,
      direction: dir,
      halfAngle: coneHalfAngle,
      maxDistance,
    };
    const result = traceCone(scene, cone);
    r += result.color.r;
    g += result.color.g;
    b += result.color.b;
    occlusion += result.occlusion;
  }

  // 平均
  const invN = 1 / coneCount;
  r *= invN;
  g *= invN;
  b *= invN;
  occlusion *= invN;

  // 余弦加权(简化:Lambert)
  return {
    color: { r, g, b, a: 1 },
    occlusion: Math.min(1, occlusion),
  };
}

// ── Specular GI ────────────────────────────────────────────────

/**
 * Specular GI:沿反射方向发射单个窄锥,采样间接高光。
 *
 * @param scene 体素场景
 * @param point 采样点(世界坐标)
 * @param normal 表面法线(归一化)
 * @param viewDir 视线方向(从点到相机,归一化)
 * @param roughness 粗糙度(0=镜面,1=漫反射)
 * @param options 追踪选项
 * @returns 间接 specular 颜色
 */
export function traceSpecularGI(
  scene: VoxelScene,
  point: VCTVec3,
  normal: VCTVec3,
  viewDir: VCTVec3,
  roughness: number,
  options: SpecularGIOptions = {},
): VCTColor {
  // 反射方向
  const reflectDir = vctVnormalize(vctVreflect(vctVscale(viewDir, -1), normal));

  // 锥半角 = roughness * π/4(粗糙度越大,锥越宽)
  const coneHalfAngle = options.coneHalfAngle ?? roughness * Math.PI / 4;
  const diag = vctVlength(vctVsub(scene.boundsMax, scene.boundsMin));
  const maxDistance = options.maxDistance ?? diag;
  const voxelDiag = Math.sqrt(
    scene.voxelSize.x ** 2 + scene.voxelSize.y ** 2 + scene.voxelSize.z ** 2,
  );
  const normalBias = (options.normalBias ?? 1) * voxelDiag;

  // 沿法线偏移起点
  const origin: VCTVec3 = {
    x: point.x + normal.x * normalBias,
    y: point.y + normal.y * normalBias,
    z: point.z + normal.z * normalBias,
  };

  const cone: Cone = {
    origin,
    direction: reflectDir,
    halfAngle: coneHalfAngle,
    maxDistance,
  };

  const result = traceCone(scene, cone);

  // Fresnel 简化(Schlick 近似)
  const NdotV = Math.max(0, vctVdot(normal, viewDir));
  const fresnel = 0.04 + 0.96 * Math.pow(1 - NdotV, 5);

  return {
    r: result.color.r * fresnel,
    g: result.color.g * fresnel,
    b: result.color.b * fresnel,
    a: 1,
  };
}

// ── 多bounce 间接光照 ──────────────────────────────────────────

/**
 * 完整间接光照:diffuse GI + specular GI + ambient occlusion。
 *
 * @param scene 体素场景
 * @param point 采样点(世界坐标)
 * @param normal 表面法线(归一化)
 * @param viewDir 视线方向(从点到相机,归一化)
 * @param albedo 表面反照率(0-1)
 * @param roughness 粗糙度(0-1)
 * @param options 选项
 * @returns 间接光照颜色(diffuse + specular + AO)
 */
export function traceIndirectLighting(
  scene: VoxelScene,
  point: VCTVec3,
  normal: VCTVec3,
  viewDir: VCTVec3,
  albedo: VCTColor,
  roughness: number,
  options: DiffuseGIOptions & SpecularGIOptions = {},
): {
  diffuse: VCTColor;
  specular: VCTColor;
  ao: number;
  combined: VCTColor;
} {
  // Diffuse GI
  const diffuseResult = traceDiffuseGI(scene, point, normal, options);
  // albedo 调制
  const diffuse: VCTColor = {
    r: diffuseResult.color.r * albedo.r,
    g: diffuseResult.color.g * albedo.g,
    b: diffuseResult.color.b * albedo.b,
    a: 1,
  };

  // Specular GI
  const specular = traceSpecularGI(scene, point, normal, viewDir, roughness, options);

  // AO(从 diffuse GI 的遮挡率获取)
  const ao = diffuseResult.occlusion;

  // 合并
  const combined: VCTColor = {
    r: diffuse.r * ao + specular.r,
    g: diffuse.g * ao + specular.g,
    b: diffuse.b * ao + specular.b,
    a: 1,
  };

  return { diffuse, specular, ao, combined };
}

// ── 统计 ────────────────────────────────────────────────────────

/**
 * 获取体素场景的内存统计。
 */
export function getVoxelSceneStats(scene: VoxelScene): {
  baseDim: number;
  mipCount: number;
  totalVoxels: number;
  occupiedVoxels: number;
  memoryBytes: number;
  memoryMB: number;
} {
  let totalVoxels = 0;
  let occupiedVoxels = 0;
  let memoryBytes = 0;

  for (const mip of scene.mips) {
    totalVoxels += mip.dim ** 3;
    for (let i = 0; i < mip.occupancy.length; i++) {
      if (mip.occupancy[i] > 0) occupiedVoxels++;
    }
    // occupancy: Float32, color: Float32×4, normal: Float32×3 = 8 floats per voxel
    memoryBytes += mip.occupancy.byteLength + mip.color.byteLength + mip.normal.byteLength;
  }

  return {
    baseDim: scene.baseDim,
    mipCount: scene.mipCount,
    totalVoxels,
    occupiedVoxels,
    memoryBytes,
    memoryMB: memoryBytes / (1024 * 1024),
  };
}

// ── GLSL 着色器块 ──────────────────────────────────────────────

/**
 * GLSL:体素锥追踪采样(chunk)。
 * 调用方需提供 voxelTexture(sampler3D,RGBA = 颜色+占据率)
 * 和 mip 链(或使用 textureLod 自动选择 mip)。
 */
export const VOXEL_CONE_TRACING_GLSL = /* glsl */ `
// ── Voxel Cone Tracing ───────────────────────────────────────
// uniform sampler3D u_voxelTexture;    // 体素纹理(RGBA = 颜色+占据率)
// uniform float u_voxelWorldSize;      // 单个体素的世界空间尺寸
// uniform vec3 u_voxelGridMin;         // 体素网格最小点(世界空间)
// uniform int u_voxelDim;              // 体素网格每边维度

// 世界坐标 → 体素 UVW
vec3 worldToVoxelUVW(vec3 worldPos) {
  return (worldPos - u_voxelGridMin) / (u_voxelWorldSize * float(u_voxelDim));
}

// 采样体素(RGBA = 颜色 * 占据率 + α = 占据率)
vec4 sampleVoxel(vec3 worldPos, float mipLevel) {
  vec3 uvw = worldToVoxelUVW(worldPos);
  return textureLod(u_voxelTexture, uvw, mipLevel);
}

// 单个锥追踪
vec4 traceCone(vec3 origin, vec3 direction, float halfAngle,
               float maxDistance, float stepScale) {
  vec4 accumColor = vec4(0.0);
  float occlusion = 0.0;
  float t = u_voxelWorldSize; // 起始偏置
  float tanHalfAngle = tan(halfAngle);

  while (t < maxDistance && occlusion < 0.99) {
    vec3 samplePos = origin + direction * t;
    float coneRadius = t * tanHalfAngle;
    float mipLevel = log2(max(1.0, coneRadius / u_voxelWorldSize));

    vec4 voxel = sampleVoxel(samplePos, mipLevel);
    float alpha = voxel.a;
    if (alpha > 0.001) {
      float transmittance = 1.0 - occlusion;
      accumColor.rgb += voxel.rgb * alpha * transmittance;
      occlusion += alpha * transmittance;
    }

    t += max(coneRadius * stepScale, u_voxelWorldSize * 0.5);
  }

  accumColor.a = occlusion;
  return accumColor;
}

// Diffuse GI:半球多锥追踪
vec3 traceDiffuseGI(vec3 point, vec3 normal, int coneCount, float maxDistance) {
  vec3 accum = vec3(0.0);
  float coneHalfAngle = 0.5236; // π/6 ≈ 30°

  // 构建 TBN 基
  vec3 up = abs(normal.y) < 0.99 ? vec3(0,1,0) : vec3(1,0,0);
  vec3 tangent = normalize(cross(up, normal));
  vec3 bitangent = cross(normal, tangent);

  float golden = 1.6180339;
  for (int i = 0; i < coneCount; i++) {
    float phi = 2.0 * 3.14159 * float(i) / golden;
    float cosTheta = 1.0 - (2.0 * float(i) + 1.0) / (2.0 * float(coneCount));
    float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    vec3 localDir = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
    vec3 dir = normalize(tangent * localDir.x + bitangent * localDir.y + normal * localDir.z);

    vec3 origin = point + normal * u_voxelWorldSize;
    vec4 result = traceCone(origin, dir, coneHalfAngle, maxDistance, 1.0);
    accum += result.rgb;
  }

  return accum / float(coneCount);
}

// Specular GI:反射方向单锥追踪
vec3 traceSpecularGI(vec3 point, vec3 normal, vec3 viewDir,
                     float roughness, float maxDistance) {
  vec3 reflectDir = reflect(-viewDir, normal);
  float coneHalfAngle = roughness * 0.7854; // roughness * π/4
  vec3 origin = point + normal * u_voxelWorldSize;
  vec4 result = traceCone(origin, reflectDir, coneHalfAngle, maxDistance, 1.0);

  float NdotV = max(0.0, dot(normal, viewDir));
  float fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);
  return result.rgb * fresnel;
}
`;

/**
 * GLSL:体素化(chunk)。
 * GPU 体素化使用几何着色器将三角形投影到主轴并光栅化到 3D 纹理。
 */
export const VOXELIZATION_GLSL = /* glsl */ `
// ── GPU Voxelization ─────────────────────────────────────────
// 1. 顶点着色器:变换到世界空间
// 2. 几何着色器:选择三角形主轴,投影到 2D 光栅化平面
// 3. 片段着色器:计算体素坐标,写入 3D 纹理(imageStore)

// uniform vec3 u_voxelGridMin;
// uniform float u_voxelWorldSize;
// uniform int u_voxelDim;
// layout(binding = 0, rgba8) uniform image3D u_voxelImage;

// 几何着色器:选择主轴
vec3 projectToAxis(vec3 normal) {
  vec3 absN = abs(normal);
  if (absN.x > absN.y && absN.x > absN.z) {
    return vec3(1, 0, 0); // X 轴
  } else if (absN.y > absN.z) {
    return vec3(0, 1, 0); // Y 轴
  } else {
    return vec3(0, 0, 1); // Z 轴
  }
}

// 片段着色器:写入体素
void voxelizeFragment(vec3 worldPos, vec3 normal, vec3 albedo) {
  vec3 voxelCoord = (worldPos - u_voxelGridMin) / u_voxelWorldSize;
  ivec3 coord = ivec3(voxelCoord);
  vec4 voxelValue = vec4(albedo, 1.0);
  imageStore(u_voxelImage, coord, voxelValue);
}
`;

/**
 * GLSL:mip 链构建(chunk)。
 * 逐层降采样:8 个子体素的加权平均。
 */
export const VOXEL_MIP_CHAIN_GLSL = /* glsl */ `
// ── Voxel Mip Chain Build ────────────────────────────────────
// 对每一层 mip,8 个子体素加权平均:
//   occupancy_parent = average(occupancy_children)
//   color_parent = sum(color_child * occ_child) / sum(occ_child)

void buildMipLevel(ivec3 coord, int mipLevel) {
  ivec3 parentCoord = coord;
  ivec3 childBase = parentCoord * 2;
  float occSum = 0.0;
  vec4 colorSum = vec4(0.0);

  for (int dz = 0; dz < 2; dz++) {
    for (int dy = 0; dy < 2; dy++) {
      for (int dx = 0; dx < 2; dx++) {
        ivec3 childCoord = childBase + ivec3(dx, dy, dz);
        vec4 child = imageLoad(u_voxelImage, childCoord);
        occSum += child.a;
        colorSum.rgb += child.rgb * child.a;
        colorSum.a += child.a;
      }
    }
  }

  if (occSum > 0.0) {
    vec4 parentValue = vec4(colorSum.rgb / occSum, occSum / 8.0);
    imageStore(u_voxelImage, parentCoord, parentValue);
  }
}
`;
