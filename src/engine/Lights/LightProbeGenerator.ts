// LightProbeGenerator — 从环境贴图生成球谐光探针。
//
// 适配 three.js `examples/jsm/lights/LightProbeGenerator.js` 并重构为纯 CPU 计算。
// 从立方体贴图(cube map)的 6 面 RGBA 数据中积分球谐(SH2)系数,
// 生成 SphericalHarmonics3 用于 IBL(基于图像的光照)间接光。
//
// 原理:
//   SH 系数 = ∫_Ω L(ω) * Y_l^m(ω) dω
//   其中 L(ω) 是方向 ω 上的辐照度,Y_l^m 是球谐基函数。
//
//   对于立方体贴图,每个 texel 代表一个立体角:
//   dω = 4π / (6 * size²) (近似,实际随方向变化)
//
//   离散积分:
//   c_l^m = Σ_texel L(texel) * Y_l^m(dir(texel)) * solidAngle(texel)
//
// 用途:
//   - 从 HDR 环境贴图生成漫反射 IBL
//   - 动态光探针捕获(实时反射探针)
//   - 场景全局环境光提取
//
// 不变量:
//   - 6 面数据尺寸必须相同;
//   - 输出为 SphericalHarmonics3(27 floats,9 系数 × 3 通道);
//   - 颜色值线性(无 gamma);
//   - 采样使用面中心方向。
//
// 参考:
//   - three.js examples/jsm/lights/LightProbeGenerator.js
//   - Ramamoorthi & Hanrahan "An Efficient Representation for Irradiance
//     Environment Maps" (SIGGRAPH 2001)
//   - Sloan "Stupid Spherical Harmonics (SH) Tricks" (GDC 2008)

import { SphericalHarmonics3 } from '../Lights/LightProbe';
import { Vector3 } from '../Math/Vector3';

/** 单面 RGBA 数据。 */
export interface LightProbeCubeFace {
  /** RGBA 像素数据,每像素 4 字节。 */
  data: Uint8ClampedArray | Float32Array;
  /** 面边长(像素)。 */
  size: number;
}

/** 完整立方体贴图(6 面)。 */
export interface CubeMapData {
  /** 6 面,顺序: +X, -X, +Y, -Y, +Z, -Z (three.js / WebGL 标准)。 */
  faces: [LightProbeCubeFace, LightProbeCubeFace, LightProbeCubeFace, LightProbeCubeFace, LightProbeCubeFace, LightProbeCubeFace];
}

/** LightProbeGenerator 选项。 */
export interface LightProbeGeneratorOptions {
  /**
   * 采样步长(每隔 step 个 texel 采样一次)。
   * 默认 1(全采样)。增大可加速但降低精度。
   */
  step?: number;
}

// ── 球谐基函数 (SH2, 9 系数) ──────────────────────────────────────
// 参考: Ramamoorthi & Hanrahan 2001, Sloan 2008

/** 计算 SH2 基函数值(9 个)给定向方向 (x, y, z)(归一化)。 */
function shBasis(x: number, y: number, z: number, out: Float64Array): void {
  // L=0
  out[0] = 0.282095; // Y_0^0
  // L=1
  out[1] = 0.488603 * y;  // Y_1^{-1}
  out[2] = 0.488603 * z;  // Y_1^0
  out[3] = 0.488603 * x;  // Y_1^1
  // L=2
  out[4] = 1.092548 * x * y;              // Y_2^{-2}
  out[5] = 1.092548 * y * z;              // Y_2^{-1}
  out[6] = 0.315392 * (3 * z * z - 1);    // Y_2^0
  out[7] = 1.092548 * x * z;              // Y_2^1
  out[8] = 0.546274 * (x * x - y * y);    // Y_2^2
}

/**
 * 立方体贴图光探针生成器。
 *
 * 从 CubeMapData 积分 SH2 系数,返回 SphericalHarmonics3。
 * 不依赖 WebGL,可在 Node/无头环境运行。
 */
export class LightProbeGenerator {
  /**
   * 从立方体贴图生成球谐系数。
   *
   * @param cubeMap 6 面立方体贴图数据。
   * @param opts 选项(采样步长等)。
   * @returns SphericalHarmonics3(27 floats)。
   */
  static fromCubeMap(
    cubeMap: CubeMapData,
    opts: LightProbeGeneratorOptions = {},
  ): SphericalHarmonics3 {
    const step = Math.max(1, Math.floor(opts.step ?? 1));
    const sh = new SphericalHarmonics3();
    const coeffs = sh.coefficients; // 27 floats (9 SH × 3 RGB)
    coeffs.fill(0);

    const basis = new Float64Array(9);
    const size = cubeMap.faces[0].size;

    // 验证所有面尺寸一致
    for (let f = 0; f < 6; f++) {
      if (cubeMap.faces[f].size !== size) {
        throw new Error(
          `LightProbeGenerator: face ${f} size ${cubeMap.faces[f].size} != ${size}`,
        );
      }
    }

    let totalWeight = 0;

    // 遍历 6 面
    for (let face = 0; face < 6; face++) {
      const faceData = cubeMap.faces[face].data;

      for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
          // 计算立方体贴图 texel 对应的方向向量
          const dir = cubeMapTexelDirection(face, x, y, size);

          // 计算立体角(更精确的公式)
          const solidAngle = texelSolidAngle(x, y, size);

          // 采样颜色(RGB,归一化到 0-1)
          const texelIdx = (y * size + x) * 4;
          const r = faceData[texelIdx] / 255;
          const g = faceData[texelIdx + 1] / 255;
          const b = faceData[texelIdx + 2] / 255;

          // 计算 SH 基函数
          shBasis(dir.x, dir.y, dir.z, basis);

          // 累加:coeffs[i*3 + ch] += color[ch] * basis[i] * solidAngle
          for (let i = 0; i < 9; i++) {
            const bVal = basis[i] * solidAngle;
            coeffs[i * 3] += r * bVal;
            coeffs[i * 3 + 1] += g * bVal;
            coeffs[i * 3 + 2] += b * bVal;
          }

          totalWeight += solidAngle;
        }
      }
    }

    // 归一化(除以总立体角,理论上 = 4π)
    if (totalWeight > 0) {
      const invWeight = 1 / totalWeight;
      for (let i = 0; i < coeffs.length; i++) {
        coeffs[i] *= invWeight;
      }
    }

    // 应用卷积核(漫反射 IBL 的 cos 卷积)
    // Ramamoorthi 2001: c1 = c1 * 2/3, c_2^0 *= 1/4, c_2^2 *= 1/4
    // 这里不做卷积,返回原始 SH 系数(使用者可自行卷积)
    // 但 three.js LightProbeGenerator 返回的是 convolved(漫反射)系数
    // 我们也做漫反射卷积
    const c1Scale = 2 / 3;
    const c2Scale = 1 / 4;
    for (let ch = 0; ch < 3; ch++) {
      // L=1 系数(index 1,2,3)乘 2/3
      coeffs[1 * 3 + ch] *= c1Scale;
      coeffs[2 * 3 + ch] *= c1Scale;
      coeffs[3 * 3 + ch] *= c1Scale;
      // L=2 系数(index 4..8)乘 1/4
      for (let i = 4; i < 9; i++) {
        coeffs[i * 3 + ch] *= c2Scale;
      }
    }

    return sh;
  }

  /**
   * 从单一颜色生成球谐系数(均匀环境光)。
   *
   * @param color RGB 颜色(0-1)。
   * @returns SphericalHarmonics3。
   */
  static fromColor(color: { r: number; g: number; b: number }): SphericalHarmonics3 {
    return SphericalHarmonics3.fromColor(color);
  }
}

// ── 立方体贴图辅助函数 ─────────────────────────────────────────────

/**
 * 计算立方体贴图某面某 texel 的方向向量。
 *
 * 面顺序 (WebGL 标准):
 *   0: +X (right)
 *   1: -X (left)
 *   2: +Y (top)
 *   3: -Y (bottom)
 *   4: +Z (front)
 *   5: -Z (back)
 *
 * @param face 面索引 0-5。
 * @param x texel X 坐标 [0, size)。
 * @param y texel Y 坐标 [0, size)。
 * @param size 面边长。
 * @returns 归一化方向向量。
 */
function cubeMapTexelDirection(face: number, x: number, y: number, size: number): Vector3 {
  // 将 texel 坐标映射到 [-1, 1],+0.5 取 texel 中心
  const u = (2 * (x + 0.5) / size) - 1;
  const v = (2 * (y + 0.5) / size) - 1;

  let dx: number, dy: number, dz: number;

  switch (face) {
    case 0: // +X (right): u→-z, v→-y
      dx = 1; dy = -v; dz = -u;
      break;
    case 1: // -X (left): u→z, v→-y
      dx = -1; dy = -v; dz = u;
      break;
    case 2: // +Y (top): u→x, v→z
      dx = u; dy = 1; dz = v;
      break;
    case 3: // -Y (bottom): u→x, v→-z
      dx = u; dy = -1; dz = -v;
      break;
    case 4: // +Z (front): u→x, v→-y
      dx = u; dy = -v; dz = 1;
      break;
    case 5: // -Z (back): u→-x, v→-y
      dx = -u; dy = -v; dz = -1;
      break;
    default:
      dx = 0; dy = 0; dz = 1;
  }

  // 归一化
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const inv = len > 0 ? 1 / len : 0;
  return new Vector3(dx * inv, dy * inv, dz * inv);
}

/**
 * 计算立方体贴图 texel 的立体角。
 *
 * 使用更精确的公式 (基于面积投影):
 *   dω = 4 / (size² * (1 + u² + v²)^(3/2))
 *
 * @param x texel X 坐标。
 * @param y texel Y 坐标。
 * @param size 面边长。
 * @returns 立体角(球面度)。
 */
function texelSolidAngle(x: number, y: number, size: number): number {
  const u = (2 * (x + 0.5) / size) - 1;
  const v = (2 * (y + 0.5) / size) - 1;
  const denom = Math.pow(1 + u * u + v * v, 1.5);
  return 4 / (size * size * denom);
}
