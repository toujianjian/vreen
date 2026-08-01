// BRDFLUT — split-sum BRDF 积分查找表生成器 (CPU 实现)。
//
// Karis 2013 "Real Shading in Unreal Engine 4" split-sum 近似的第二部分。
// PMREMGenerator 生成预滤波环境贴图(第一部分:LD term),本类生成 2D LUT
// 编码 BRDF 的几何 + Fresnel 项(第二部分:BRDF term):
//
//   specularIBL = prefilteredEnv(L) * (scale * F0 + bias)
//
// 其中 (scale, bias) = BRDFLUT[NoV, roughness]。
//
// LUT 布局:
//   X 轴 = N·V (cos θ_view), [0, 1]
//   Y 轴 = roughness (perceptual), [0, 1]
//   R 通道 = scale (F0 系数)
//   G 通道 = bias (F90 常数项)
//
// 算法(Karis 2013, Section 3.4):
//   对每个 (NoV, α):
//     V = (sin θ, 0, cos θ), θ = acos(NoV)
//     N = (0, 0, 1)
//     scale = 0, bias = 0
//     for i in sampleCount:
//       Xi = Hammersley(i, sampleCount)
//       H  = ImportanceSampleGGX(Xi, N, α)
//       L  = reflect(-V, H)
//       NoL = max(N·L, 0), VoH = max(V·H, 0), NoH = max(N·H, 0)
//       if NoL > 0:
//         G     = SmithGGX(NoV, NoL, α)        // 联合遮蔽-阴影
//         G_vis = G * VoH / (NoH * NoV)        // 可见性项
//         Fc    = pow(1 - VoH, 5)              // Schlick Fresnel
//         scale += (1 - Fc) * G_vis
//         bias  += Fc * G_vis
//     scale /= sampleCount
//     bias  /= sampleCount
//
// 用途:
//   - PBR IBL 管线的第二部分(与 PMREMGenerator 配对)
//   - 离线烘焙,运行时作为 RG 纹理上传一次
//   - 与 BRDF.integrateSchlick() 互补:本类是 2D LUT,前者是解析近似
//
// 参考:
//   - Karis 2013, "Real Shading in Unreal Engine 4"
//   - three.js src/renderers/shaders/ShaderLib/equirect_uv_frag.glsl.js (LUT 生成 shader)
//   - o3de Atom BRDF.azsl

/** BRDF LUT 构造选项。 */
export interface BRDFLUTOptions {
  /** LUT 边长(像素)。默认 256。x = NoV, y = roughness。 */
  size?: number;
  /** 每个 texel 的采样数。默认 1024(更高 = 更精确但更慢)。 */
  samples?: number;
}

/** BRDF LUT 数据(RG 2 通道)。 */
export interface BRDFLUTData {
  /** LUT 边长。 */
  size: number;
  /**
   * RG float 数据,length = size * size * 2。
   * 布局:texel (x, y) → data[(y * size + x) * 2 + 0..1]
   *   x = NoV (0..1),y = roughness (0..1)
   *   R = scale (F0 系数),G = bias (F90 常数)
   */
  data: Float32Array;
}

/**
 * 生成 Karis 2013 split-sum BRDF 积分查找表。
 *
 * ```ts
 * const lut = BRDFLUT.generate({ size: 256, samples: 1024 });
 * // 上传为 RG 纹理:texture.rg = lut.data
 * // shader 中:vec2 envBRDF = texture(brdfLUT, vec2(NoV, roughness)).rg;
 * // F = F0 * envBRDF.x + F90 * envBRDF.y;
 * ```
 */
export class BRDFLUT {
  /**
   * 生成 2D BRDF 积分 LUT。
   *
   * @param opts 选项(size / samples)。
   * @returns BRDFLUTData(RG float, size×size)。
   */
  static generate(opts: BRDFLUTOptions = {}): BRDFLUTData {
    const size = Math.max(16, Math.floor(opts.size ?? 256));
    const sampleCount = Math.max(16, Math.floor(opts.samples ?? 1024));
    const data = new Float32Array(size * size * 2);

    for (let y = 0; y < size; y++) {
      // roughness: 0 (光滑) → 1 (粗糙)
      const roughness = size > 1 ? y / (size - 1) : 0;
      const alpha = Math.max(roughness * roughness, 1e-7); // α = roughness²,防 α=0 退化

      for (let x = 0; x < size; x++) {
        // NoV: 0 → 1(避免 NoV=0 导致除零)
        const NoV = size > 1 ? x / (size - 1) : 1;
        const nv = Math.max(NoV, 1e-4);

        // V = (sin θ, 0, cos θ),N = (0, 0, 1)
        const sinTheta = Math.sqrt(Math.max(0, 1 - nv * nv));
        const vx = sinTheta;
        const vy = 0;
        const vz = nv;
        // N = (0, 0, 1)

        let scale = 0;
        let bias = 0;

        for (let i = 0; i < sampleCount; i++) {
          const xi1 = i / sampleCount;
          const xi2 = vanDerCorput(i);

          // GGX 重要性采样:生成 H(切线空间,N=(0,0,1) 时 = world)
          const phi = 2 * Math.PI * xi1;
          const a2 = alpha * alpha;
          const cosTheta2 = (1 - xi2) / ((a2 - 1) * xi2 + 1);
          const cosThetaH = Math.sqrt(Math.max(0, cosTheta2));
          const sinThetaH = Math.sqrt(Math.max(0, 1 - cosTheta2));
          const hx = sinThetaH * Math.cos(phi);
          const hy = sinThetaH * Math.sin(phi);
          const hz = cosThetaH;

          // L = reflect(-V, H) = 2*(V·H)*H - V
          // N = (0,0,1) → N·L = L.z = 2*VoH*Hz - Vz
          const VoH = vx * hx + vy * hy + vz * hz;
          const NoL = Math.max(2 * VoH * hz - vz, 0);
          if (NoL <= 0) continue;

          // N·H (N = (0,0,1))
          const NoH = Math.max(hz, 0);
          if (NoH <= 0) continue;

          const VoHclamp = Math.max(VoH, 0);
          const NoV = nv;

          // Smith 遮蔽-阴影 GGX (uncorrelated, Karis 2013 / Filament):
          // G = G1(NoV) * G1(NoL)
          // G1(n, α) = 2n / (n + sqrt(α² + (1-α²)*n²))
          // 注意:分母中是 (1-α²)*n²,不是 (1-n²)。后者是错误的 Karis fast
          // approximation,会在 α=0、n=1 时给出 G1=2 而非 1,导致 scale > 1。
          const aAlpha = alpha; // α = roughness²
          const aSq = aAlpha * aAlpha; // α²
          const denomA = NoV + Math.sqrt(aSq + (1 - aSq) * NoV * NoV);
          const denomB = NoL + Math.sqrt(aSq + (1 - aSq) * NoL * NoL);
          const G = (2 * NoV / denomA) * (2 * NoL / denomB);

          // 可见性项
          const Gvis = (G * VoHclamp) / (NoH * NoV);

          // Schlick Fresnel (Fc = 1 - Fresnel)
          const Fc = Math.pow(1 - VoHclamp, 5);

          scale += (1 - Fc) * Gvis;
          bias += Fc * Gvis;
        }

        scale /= sampleCount;
        bias /= sampleCount;

        // Clamp to [0, 1]: Monte Carlo 噪声在 α≈0 时可能使 scale 微超 1。
        const idx = (y * size + x) * 2;
        data[idx] = Math.min(1, Math.max(0, scale));
        data[idx + 1] = Math.min(1, Math.max(0, bias));
      }
    }

    return { size, data };
  }
}

// ── 内部工具 ──────────────────────────────────────────────────

/**
 * Van der Corput 根逆(radical inverse)基 2。
 * 用于 Hammersley 低差异序列。
 */
function vanDerCorput(bits: number): number {
  bits = (bits << 16) | (bits >>> 16);
  bits = ((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1);
  bits = ((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2);
  bits = ((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4);
  bits = ((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8);
  return (bits >>> 0) * 2.3283064365386963e-10; // 1 / 2^32
}
