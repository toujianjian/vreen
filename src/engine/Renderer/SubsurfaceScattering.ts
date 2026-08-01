// SubsurfaceScattering — 次表面散射运行时工具集 (CPU 实现)。
//
// 补充 Core/PreIntegratedSkinLUT.ts(LUT 生成 + 采样)和
// Materials/SubsurfaceScatteringMaterial.ts(材质 + shader)和
// Renderer/PostProcess/SSSSPass.ts(屏幕空间模糊),提供:
//
//   1. computeCurvature     — 从相邻法线估算曲率(供 shader 上传 curvature attribute)
//   2. backLightTransmission — 背光透射颜色(耳翼/鼻翼逆光透红效果)
//   3. mixSSSDiffuse         — 将 LUT 采样结果与标准 diffuse 混合
//
// 并从 Core 重新导出 LUT 生成/采样 API,使 Renderer barrel 提供完整的 SSS 工具链。
//
// 参考:
//   - Penner & Borshukov 2011, "Pre-Integrated Skin Shading"
//   - d'Eon 2007, GPU Gems 3 Ch.14 (skin diffuse profile)
//   - Jimenez 2012, "Separable SSSS" (屏幕空间方法,对应 SSSSPass)
//   - o3de Atom Skin material (curvature + transmission)

// 从 Core 重新导出 LUT 工具(避免 Renderer 用户跨目录导入)
export {
  generatePreIntegratedSkinLUT,
  samplePreIntegratedSkinLUT,
  skinScatterProfile,
  curvatureFromRadius,
  type PreIntegratedSkinLUTOptions,
  type PreIntegratedSkinLUTResult,
  type SkinColor,
} from '../Core/PreIntegratedSkinLUT';

// ── 曲率计算 ──────────────────────────────────────────────────

/**
 * 从相邻法线估算曲率 (1/r)。
 *
 * 对于网格表面,曲率 ≈ |ΔN| / |ΔP|,其中 ΔN 是法线变化,ΔP 是位置变化。
 * 可用于在 CPU 端预计算曲率属性,上传为 vertex attribute 供 shader 采样 LUT。
 *
 * @param n0 中心法线(归一化)。
 * @param n1 相邻法线(归一化)。
 * @param edgeLength 两点间距(与 LUT 的 maxCurvature 单位一致)。
 * @returns 曲率 1/r(≥ 0,0 = 平面)。
 */
export function computeCurvature(
  n0: { x: number; y: number; z: number },
  n1: { x: number; y: number; z: number },
  edgeLength: number,
): number {
  if (edgeLength <= 0) return 0;
  const dx = n1.x - n0.x;
  const dy = n1.y - n0.y;
  const dz = n1.z - n0.z;
  const dn = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return dn / edgeLength;
}

/**
 * 多邻居平均曲率(更稳定的估算)。
 *
 * @param center 中心法线(归一化)。
 * @param neighbors 相邻法线数组(归一化)。
 * @param edgeLengths 对应边长数组(与 neighbors 等长)。
 * @returns 平均曲率 1/r。
 */
export function computeCurvatureAveraged(
  center: { x: number; y: number; z: number },
  neighbors: Array<{ x: number; y: number; z: number }>,
  edgeLengths: number[],
): number {
  if (neighbors.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < neighbors.length; i++) {
    sum += computeCurvature(center, neighbors[i], edgeLengths[i] ?? 0);
  }
  return sum / neighbors.length;
}

// ── 背光透射 ──────────────────────────────────────────────────

/** 皮肤透射颜色(RGB,线性,归一化)。红色主导(血液吸收蓝绿光)。 */
const SKIN_TRANSMISSION_COLOR: readonly [number, number, number] = [1.0, 0.45, 0.32];

/**
 * 背光透射颜色(耳翼/鼻翼逆光透红效果)。
 *
 * 当光从背面照射薄组织时,光穿过组织被血液吸收,
 * 透射光呈红色。透射强度与厚度、角度有关。
 *
 * 与 SubsurfaceScatteringMaterial 的透射 shader 互补:
 * 该函数是 CPU 侧工具(预计算 / 测试 / 离线烘焙),
 * shader 端在 SSS_VERT/SSS_FRAG 中做等效计算。
 *
 * @param thickness  组织厚度(归一化,0 = 薄,1 = 厚)。
 * @param NoL        法线与光照方向点积(前向)。
 * @param VoL        视线与光照方向点积(背面 = -1)。
 * @returns RGB 透射颜色(已含强度,可直接加到最终颜色)。
 */
export function backLightTransmission(
  thickness: number,
  NoL: number,
  VoL: number,
): [number, number, number] {
  const backLight = Math.max(0, -NoL);
  const backView = Math.max(0, -VoL);
  const thicknessFactor = 1 - Math.min(1, Math.max(0, thickness));
  const fresnel = Math.pow(backView, 0.5);
  const intensity = backLight * thicknessFactor * fresnel;
  return [
    SKIN_TRANSMISSION_COLOR[0] * intensity,
    SKIN_TRANSMISSION_COLOR[1] * intensity,
    SKIN_TRANSMISSION_COLOR[2] * intensity,
  ];
}

// ── SSS 颜色混合工具 ─────────────────────────────────────────

/**
 * 将 Pre-Integrated Skin LUT 采样结果与标准 diffuse 混合。
 *
 * @param diffuseColor 标准 Lambertian diffuse 颜色(albedo * NoL)。
 * @param sssColor     从 LUT 采样的 SSS 颜色(samplePreIntegratedSkinLUT 返回值)。
 * @param sssAmount    SSS 混合权重(0 = 纯 Lambertian,1 = 纯 SSS)。
 * @returns 混合后的 RGB 颜色。
 */
export function mixSSSDiffuse(
  diffuseColor: [number, number, number],
  sssColor: [number, number, number],
  sssAmount: number,
): [number, number, number] {
  const t = Math.min(1, Math.max(0, sssAmount));
  return [
    diffuseColor[0] * (1 - t) + sssColor[0] * t,
    diffuseColor[1] * (1 - t) + sssColor[1] * t,
    diffuseColor[2] * (1 - t) + sssColor[2] * t,
  ];
}
