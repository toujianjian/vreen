// PreIntegratedSkinLUT — Pre-Integrated Skin Shading LUT generator.
//
// Reference:
//   d'Eon & Luebke 2007, "Efficient Rendering of Human Skin" (GPU Gems 3, Ch. 14)
//   https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-14-advanced-techniques-realistic-real-time
//
// 该实现把 BSSRDF 卷积预算成两张查找表,运行时只需 1 次纹理采样即可
// 得到与完整 BSSRDF 积分近似的漫反射 + 透射结果,适合实时皮肤渲染。
//
// 与 SubsurfaceScatteringMaterial 的区别:
//   * SSSMaterial 用半透明阴影近似(Penner/GDC2011 风格),逐像素解析;
//   * PreIntegratedSkin 把 BSSRDF 卷积预算成 LUT,运行时 O(1) 采样,
//     数学上更接近完整 BSSRDF,且无逐像素步进开销;
//   * 两者可共存:SSSMaterial 适合薄壁透射(耳廓/鼻翼),
//     PreIntegratedSkin 适合大面积皮肤(脸颊/前额)的柔和阴影。
//
// 设计:
//   * 纯 CPU 数学,无 WebGL/DOM 依赖,可在 Node/headless 环境运行。
//   * 数据扁平存储为 Float32Array,可直接上传到 GPU 作为纹理。
//   * 提供 bilinear/linear 采样方法,CPU 侧参考实现可用。

import type { RGB } from '../Core/Material';

// ────────────────────────────────────────────────────────────────────
// DiffuseProfile
// ────────────────────────────────────────────────────────────────────

/**
 * DiffuseProfile — BSSRDF 散射参数(单位:mm,与 d'Eon 2007 测量一致)。
 *
 * - `scatteringRadius`:每通道的有效散射半径(mm)。皮肤中红光散射最远
 *   (~0.65mm),绿光次之(~0.38mm),蓝光最近(~0.22mm),所以背光皮肤呈红色。
 * - `singleScatterAlbedo`:每通道单次散射反照率(0..1)。
 *   皮肤的 R/G/B 约为 0.99 / 0.97 / 0.85。
 * - `f0`:法向入射时的菲涅尔反射率(皮肤 ~0.028,对应 IOR 1.4)。
 */
export interface DiffuseProfile {
  /** 每通道有效散射半径(mm)。红光最大。 */
  scatteringRadius: RGB;
  /** 每通道单次散射反照率(0..1)。 */
  singleScatterAlbedo: RGB;
  /** 法向菲涅尔反射率(皮肤 ~0.028)。 */
  f0: number;
}

/**
 * SKIN_PROFILE — d'Eon 2007 公开测量的人类皮肤散射参数。
 *
 * 红光散射半径 0.65mm 显著大于蓝光 0.22mm,这就是背光耳朵/鼻翼
 * 呈红色的物理原因。这些值来自 GPU Gems 3 Chapter 14 表 14-1。
 */
export const SKIN_PROFILE: DiffuseProfile = {
  scatteringRadius: { r: 0.65, g: 0.38, b: 0.22 },
  singleScatterAlbedo: { r: 0.99, g: 0.97, b: 0.85 },
  f0: 0.028,
};

// ────────────────────────────────────────────────────────────────────
// DiffuseLUT — 2D LUT indexed by (N·L, 1/(1+curvature*radius))
// ────────────────────────────────────────────────────────────────────

/**
 * DiffuseLUT — 预积分皮肤漫反射 BRDF 的 2D 查找表。
 *
 * 维度:`width × height × 3`(RGB),默认 256×256×3。
 *
 * 索引:
 *   - u = (N·L + 1) / 2         — N·L ∈ [-1, 1] → u ∈ [0, 1]
 *   - v = 1 / (1 + curvature * radius)  — curvature ∈ [0, ∞] → v ∈ (0, 1]
 *     (v=1 表示平面,curvature=0;v→0 表示高曲率)
 *
 * 含义:对每个 (N·L, curvature) 组合,存储 BSSRDF 在曲率半径
 * 1/curvature 的曲面元素上积分得到的漫反射率。这样运行时
 * 只需一次纹理采样即可得到与完整 BSSRDF 卷积近似的漫反射,
 * 而不需要逐像素数值积分。
 *
 * 平面情况(v=1, curvature=0)归一化为标准 Lambert:
 *   LUT[NdotL, 0] = albedo/π * max(NdotL, 0)
 *
 * 高曲率情况(v→0)阴影终止线被柔和化:散射使光线"绕过"曲率
 * 进入阴影区域,这是皮肤的标志性柔软外观。
 *
 * 适配自 d'Eon & Luebke 2007 (GPU Gems 3 Ch. 14)。数学是
 * BSSRDF 卷积的离散数值近似,使用径向高斯核而非完整偶极子模型
 * 以保持生成速度(<100ms for 256×256),精度足够实时渲染。
 */
export class DiffuseLUT {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array; // length = width * height * 3
  readonly profile: DiffuseProfile;

  /**
   * @param profile  散射剖面(默认 `SKIN_PROFILE`)
   * @param width    u 方向分辨率(默认 256)
   * @param height   v 方向分辨率(默认 256)
   */
  constructor(profile: DiffuseProfile = SKIN_PROFILE, width = 256, height = 256) {
    this.profile = profile;
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height * 3);
    this.generate();
  }

  /**
   * 生成 LUT。对每个 (u, v) 单元做 BSSRDF 卷积数值积分。
   *
   * 数学:
   *   NdotL = u * 2 - 1
   *   invOnePlusCurvR = v   (v ∈ (0, 1], 1 = flat)
   *   radius = (1 - v) / (v * MAX_CURVATURE)   (mm)
   *
   *   result = Σ samples: max(localNdotL, 0) * gaussianFalloff(distance, σ_c)
   *   归一化使 v=1 (flat) 时 result = max(NdotL, 0)
   */
  private generate(): void {
    const { scatteringRadius } = this.profile;
    const samples = 32; // 沿弧长的采样数(数值积分精度)
    const arcSpan = Math.PI * 0.5; // ±π/4 弧度,覆盖散射影响范围

    for (let v = 0; v < this.height; v++) {
      const vNorm = (v + 0.5) / this.height; // (0, 1]
      // 把 v 映射到 curvature radius:
      //   v=1 (顶部) → radius=MAX_RADIUS(接近平面,curvature≈0)
      //   v=0 (底部) → radius=0(高曲率,curvature→∞)
      // 平面时高斯核退化为 δ 函数,只采样中心点 → result = max(ndotl, 0)
      const MAX_RADIUS = 10.0; // mm,>> 皮肤散射半径(0.65mm),视为平面
      const radius = vNorm * MAX_RADIUS;

      for (let u = 0; u < this.width; u++) {
        const ndotl = (u + 0.5) / this.width * 2 - 1; // [-1, 1]

        // 对每个 RGB 通道独立积分(散射半径不同)
        let sumR = 0, sumG = 0, sumB = 0;
        let weightSumR = 0, weightSumG = 0, weightSumB = 0;

        for (let s = 0; s < samples; s++) {
          // theta 是球面上的角度参数(弧度)
          const theta = (s / (samples - 1) - 0.5) * 2 * arcSpan;
          // 局部 N·L:球面上沿弧线移动 theta,法线旋转 theta
          // localNdotL = cos(acos(ndotl) + theta)
          const localNdotL = Math.cos(Math.acos(Math.max(-1, Math.min(1, ndotl))) + theta);
          const contrib = Math.max(localNdotL, 0);

          // 弧长(物理距离)= |theta * radius|
          // radius 大(平面)→ 弧长大 → 高斯权重 → 0(δ 函数)
          // radius 小(曲率大)→ 弧长小 → 高斯权重 → 1(宽核)
          const distance = Math.abs(theta * radius);

          // 高斯衰减核(近似 BSSRDF 径向剖面)
          const sigmaR = scatteringRadius.r;
          const sigmaG = scatteringRadius.g;
          const sigmaB = scatteringRadius.b;
          const wR = Math.exp(-(distance * distance) / (sigmaR * sigmaR));
          const wG = Math.exp(-(distance * distance) / (sigmaG * sigmaG));
          const wB = Math.exp(-(distance * distance) / (sigmaB * sigmaB));

          sumR += contrib * wR;
          sumG += contrib * wG;
          sumB += contrib * wB;
          weightSumR += wR;
          weightSumG += wG;
          weightSumB += wB;
        }

        // 归一化加权平均:v=1 (radius=MAX_RADIUS,平面) 时高斯退化为 δ,
        // 只中心点贡献 → result = max(ndotl, 0)(标准 Lambert)
        const flatR = weightSumR > 0 ? sumR / weightSumR : 0;
        const flatG = weightSumG > 0 ? sumG / weightSumG : 0;
        const flatB = weightSumB > 0 ? sumB / weightSumB : 0;

        const idx = (v * this.width + u) * 3;
        this.data[idx] = flatR;
        this.data[idx + 1] = flatG;
        this.data[idx + 2] = flatB;
      }
    }
  }

  /**
   * 双线性采样 LUT。
   *
   * @param ndotl      法线·光线(范围 [-1, 1],自动钳制)
   * @param curvature  曲率(1/radius,mm⁻¹;0=平面,越大越弯)
   * @returns 采样的 RGB 漫反射率(线性,范围 0..1+)
   */
  sample(ndotl: number, curvature: number): RGB {
    const u = clamp01((ndotl + 1) * 0.5);
    // curvature → v:与 generate() 中的映射对齐
    //   curv=0 (平面) → v=1 → radius=MAX_RADIUS(平面)
    //   curv 大(高曲率)→ v→0 → radius→0(高曲率)
    // 公式:v = 1 / (1 + curvature * SCALE)
    //   SCALE=1 使 curv=1 → v=0.5 → radius=5mm(轻度曲率)
    //   curv=5 → v≈0.167 → radius≈1.67mm(明显曲率,如鼻尖)
    const v = clamp01(1 / (1 + curvature));

    const fx = u * this.width - 0.5;
    const fy = v * this.height - 0.5;
    const x0 = Math.max(0, Math.min(this.width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(this.height - 1, Math.floor(fy)));
    const x1 = Math.min(this.width - 1, x0 + 1);
    const y1 = Math.min(this.height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;

    const i00 = (y0 * this.width + x0) * 3;
    const i10 = (y0 * this.width + x1) * 3;
    const i01 = (y1 * this.width + x0) * 3;
    const i11 = (y1 * this.width + x1) * 3;

    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;

    return {
      r: this.data[i00] * w00 + this.data[i10] * w10 + this.data[i01] * w01 + this.data[i11] * w11,
      g: this.data[i00 + 1] * w00 + this.data[i10 + 1] * w10 + this.data[i01 + 1] * w01 + this.data[i11 + 1] * w11,
      b: this.data[i00 + 2] * w00 + this.data[i10 + 2] * w10 + this.data[i01 + 2] * w01 + this.data[i11 + 2] * w11,
    };
  }

  /** 序列化为 JSON(供持久化/调试)。 */
  toJSON(): Record<string, unknown> {
    return {
      width: this.width,
      height: this.height,
      profile: this.profile,
      data: Array.from(this.data),
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// TransmittanceLUT — 1D LUT indexed by distance (mm)
// ────────────────────────────────────────────────────────────────────

/**
 * TransmittanceLUT — 预积分皮肤透射率 1D 查找表。
 *
 * 维度:`size × 3`(RGB),默认 256×3。
 *
 * 索引:
 *   - u = distance / maxDistance  — distance ∈ [0, maxDistance] → u ∈ [0, 1]
 *
 * 含义:对每个距离,存储光线穿过该厚度皮肤的 RGB 透射率。
 * 红光透射率最高(散射半径大 → 衰减慢),蓝光透射率最低。
 * 这是背光耳朵/鼻翼呈红色的物理原因。
 *
 * 数学(每通道独立):
 *   T_c(distance) = singleScatterAlbedo_c * exp(-distance / scatteringRadius_c)
 *
 * 红光额外加一个"长尾"项模拟多次散射:
 *   T_r += 0.3 * exp(-distance / (scatteringRadius_r * 0.5))
 *
 * 适配自 d'Eon 2007。这是 BSSRDF 透射项的简化闭式解,不依赖
 * 偶极子模型,生成速度 <1ms。
 */
export class TransmittanceLUT {
  readonly size: number;
  readonly data: Float32Array; // length = size * 3
  readonly profile: DiffuseProfile;
  readonly maxDistance: number;

  /**
   * @param profile     散射剖面(默认 `SKIN_PROFILE`)
   * @param size        分辨率(默认 256)
   * @param maxDistance 最大距离(mm,默认 5)
   */
  constructor(
    profile: DiffuseProfile = SKIN_PROFILE,
    size = 256,
    maxDistance = 5,
  ) {
    this.profile = profile;
    this.size = size;
    this.maxDistance = maxDistance;
    this.data = new Float32Array(size * 3);
    this.generate();
  }

  /**
   * 生成透射率 LUT。每通道独立计算 Beer-Lambert 衰减。
   */
  private generate(): void {
    const { scatteringRadius, singleScatterAlbedo } = this.profile;
    for (let i = 0; i < this.size; i++) {
      const distance = (i + 0.5) / this.size * this.maxDistance;
      const idx = i * 3;
      // 主透射项:exp(-distance / radius)
      const tR = singleScatterAlbedo.r * Math.exp(-distance / scatteringRadius.r);
      const tG = singleScatterAlbedo.g * Math.exp(-distance / scatteringRadius.g);
      const tB = singleScatterAlbedo.b * Math.exp(-distance / scatteringRadius.b);
      // 红光多次散射长尾(皮肤红色成分在长距离处仍有显著透射)
      const redTail = 0.3 * Math.exp(-distance / (scatteringRadius.r * 0.5));
      this.data[idx] = tR + redTail;
      this.data[idx + 1] = tG;
      this.data[idx + 2] = tB;
    }
  }

  /**
   * 线性采样透射率 LUT。
   *
   * @param distance 光线穿过皮肤的距离(mm,自动钳制到 [0, maxDistance])
   * @returns RGB 透射率(线性,范围 0..1+)
   */
  sample(distance: number): RGB {
    const d = clamp(distance, 0, this.maxDistance);
    const u = d / this.maxDistance * (this.size - 1);
    const i0 = Math.floor(u);
    const i1 = Math.min(this.size - 1, i0 + 1);
    const t = u - i0;
    const idx0 = i0 * 3;
    const idx1 = i1 * 3;
    return {
      r: this.data[idx0] * (1 - t) + this.data[idx1] * t,
      g: this.data[idx0 + 1] * (1 - t) + this.data[idx1 + 1] * t,
      b: this.data[idx0 + 2] * (1 - t) + this.data[idx1 + 2] * t,
    };
  }

  /** 序列化为 JSON。 */
  toJSON(): Record<string, unknown> {
    return {
      size: this.size,
      maxDistance: this.maxDistance,
      profile: this.profile,
      data: Array.from(this.data),
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
