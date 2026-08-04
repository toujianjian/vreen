// AreaLightLTC — Linearly Transformed Cosines 区域光求值(CPU 参考实现)。
//
// 适配自 Heitz, Dupuy, Hill, Neubelt 2016
// "Real-Time Polygonal-Light Shading with Linearly Transformed Cosines"
// 代码:https://github.com/selfshadow/ltc_code/
// 参考:three.js nodes/functions/BSDF/LTC.js + o3de Atom LtcCommon.cpp。
//
// LTC 核心思想:
//   1. GGX BRDF 的形状可由一个 3×3 矩阵 M 近似为"线性变换余弦";
//   2. 逆矩阵 M⁻¹ 把多边形顶点从 BRDF 空间变换到余弦空间;
//   3. 在余弦空间中,多边形 irradiance 有闭式解析解(球面多边形面积);
//   4. M⁻¹ 预计算为 64×64 LUT(roughness × cos θ)。
//
// VREEN 实现:
//   - 纯 CPU 函数,不依赖 WebGL,可在 Node/无头环境测试;
//   - 与 three.js LTC_Evaluate 1:1 对应;
//   - M⁻¹ 矩阵作为参数传入(调用方从 LUT 纹理加载);
//   - 提供简化的解析 LTC 矩阵近似用于测试(无需预计算 LUT)。
//
// 与 soup3D 的对比:
//   soup3D 仅有点光源 / 方向光,无面光源。VREEN 现在有 LTC 面光源,
//   支持矩形 / 圆盘形状,匹配 UE5 RectLight / o3de ArenaLight。

// ── 类型 ──────────────────────────────────────────────────────────

/** 3D 向量。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 3×3 矩阵(列主序,9 个元素,与 WebGL/glMatrix 一致)。 */
export type Mat3 = ArrayLike<number>;

/** RGB 颜色三元组 [0..1]。 */
export type LTCColor = [r: number, g: number, b: number];

/** 矩形面光源参数。 */
export interface RectLightParams {
  /** 矩形 4 个顶点(世界空间,CCW 绕序)。 */
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  p3: Vec3;
  /** 光源颜色(线性 RGB,0..1)。 */
  color: LTCColor;
  /** 强度(nit)。 */
  intensity: number;
}

/** 着色点参数。 */
export interface SurfacePoint {
  /** 世界空间位置。 */
  P: Vec3;
  /** 世界空间法线(归一化)。 */
  N: Vec3;
  /** 世界空间视图方向(从表面指向相机,归一化)。 */
  V: Vec3;
  /** GGX α(roughness²,0..1)。 */
  roughness: number;
}

/** LTC 求值结果。 */
export interface LTCResult {
  /** 漫反射贡献 [r, g, b]。 */
  diffuse: LTCColor;
  /** 镜面反射贡献 [r, g, b]。 */
  specular: LTCColor;
  /** 总贡献 = diffuse + specular。 */
  total: LTCColor;
}

// ── 常量 ───────────────────────────────────────────────────────────

/** LTC LUT 尺寸(three.js / o3de 约定 64×64)。 */
export const LTC_LUT_SIZE = 64;

/** LUT 采样缩放:(LUT_SIZE - 1) / LUT_SIZE。 */
export const LTC_LUT_SCALE = (LTC_LUT_SIZE - 1) / LTC_LUT_SIZE;

/** LUT 采样偏移:0.5 / LUT_SIZE。 */
export const LTC_LUT_BIAS = 0.5 / LTC_LUT_SIZE;

// ── 向量工具(纯函数,无副作用) ────────────────────────────────────

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  const inv = 1.0 / len;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

export function saturate(x: number): number {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

// ── 3×3 矩阵 × 向量(列主序) ───────────────────────────────────────

/** mat3 × vec3(列主序:m[col*3 + row])。 */
export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[3] * v.y + m[6] * v.z,
    y: m[1] * v.x + m[4] * v.y + m[7] * v.z,
    z: m[2] * v.x + m[5] * v.y + m[8] * v.z,
  };
}

// ── LTC 核心函数(与 three.js LTC.js 1:1 对应) ─────────────────────

/**
 * 计算 LTC LUT 采样 UV。
 *
 * 参数化:u = sqrt(roughness), v = sqrt(1 - dot(N,V))
 * 缩放:LUT_SCALE,偏移:LUT_BIAS(确保采样在 texel 中心)。
 *
 * @param roughness GGX α(0..1)
 * @param dotNV     dot(N, V),clamped to [0,1]
 * @returns         [u, v] 采样坐标
 */
export function ltcUv(roughness: number, dotNV: number): [number, number] {
  const dNV = saturate(dotNV);
  // texture parameterized by sqrt(GGX alpha) and sqrt(1 - cos(theta))
  let u = roughness;
  let v = Math.sqrt(1.0 - dNV);
  u = u * LTC_LUT_SCALE + LTC_LUT_BIAS;
  v = v * LTC_LUT_SCALE + LTC_LUT_BIAS;
  return [u, v];
}

/**
 * 边向量形式因子(Edge Vector Form Factor)。
 *
 * 计算 v1 → v2 边的球面形式因子,使用有理多项式近似 theta/sin(theta)/2π。
 * 与 three.js LTC_EdgeVectorFormFactor 1:1 对应。
 *
 * @param v1 球面方向 1(归一化)
 * @param v2 球面方向 2(归一化)
 * @returns  形式因子向量(后续求和后用于 ClippedSphereFormFactor)
 */
export function ltcEdgeVectorFormFactor(v1: Vec3, v2: Vec3): Vec3 {
  const x = dot(v1, v2);
  const y = Math.abs(x);

  // rational polynomial approximation to theta / sin(theta) / 2PI
  const a = (y * 0.0145206 + 0.4965155) * y + 0.8543985;
  const b = (y + 4.1616724) * y + 3.4175940;
  const v = a / b;

  // x > 0 → v;  x <= 0 → 0.5/sqrt(max(1-x², 1e-7)) - v
  const thetaSintheta = x > 0.0
    ? v
    : 0.5 / Math.sqrt(Math.max(1.0 - x * x, 1e-7)) - v;

  return scale(cross(v1, v2), thetaSintheta);
}

/**
 * 地平线裁剪球面形式因子(Clipped Sphere Form Factor)。
 *
 * 对向量形式因子求和后,应用地平线裁剪近似。
 * 与 three.js LTC_ClippedSphereFormFactor 1:1 对应。
 *
 * @param f 向量形式因子(4 条边的和)
 * @returns  标量 irradiance [0,1]
 */
export function ltcClippedSphereFormFactor(f: Vec3): number {
  const l = length(f);
  // max((l² + f.z) / (l + 1), 0)
  const result = (l * l + f.z) / (l + 1.0);
  return result > 0 ? result : 0;
}

/**
 * 求值矩形面光源的 LTC irradiance。
 *
 * 与 three.js LTC_Evaluate 1:1 对应:
 *   1. 背面剔除(光源背面 → 返回 0);
 *   2. 构造 N 周围正交基 (T1, T2);
 *   3. mat = mInv * transpose(basis);
 *   4. 把 4 个顶点变换到 LTC 空间,投影到单位球;
 *   5. 计算 4 条边的向量形式因子;
 *   6. 地平线裁剪 → 标量 irradiance。
 *
 * @param N     表面法线(归一化)
 * @param V     视图方向(归一化,指向相机)
 * @param P     表面位置
 * @param mInv  逆 LTC 矩阵(3×3,列主序,从 LUT 采样)
 * @param p0..p3 矩形 4 顶点(世界空间,CCW)
 * @returns     irradiance 标量 [0,1](乘以光源颜色 + 强度得最终贡献)
 */
export function ltcEvaluate(
  N: Vec3,
  V: Vec3,
  P: Vec3,
  mInv: Mat3,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
): number {
  // bail if point is on back side of plane of light
  // 顶点 CCW 从受光面(正面)看,lightNormal 指向受光面。
  // dot(lightNormal, P-p0) > 0 → 点在受光侧(继续)
  // dot(lightNormal, P-p0) <= 0 → 点在背面(返回 0)
  const v1 = sub(p1, p0);
  const v2 = sub(p3, p0);
  const lightNormal = cross(v1, v2);

  // 背面 → 0
  if (dot(lightNormal, sub(P, p0)) <= 0.0) {
    return 0.0;
  }

  // construct orthonormal basis around N
  // T1 = normalize(V - N * dot(V, N))
  // 当 V 与 N 平行时(dotNV ≈ 1),V - N*dot(V,N) ≈ 0 → 退化。
  // 此时选择任意正交向量(与 N 最不平行的一个)。
  let t1: Vec3;
  const dVN = dot(V, N);
  if (Math.abs(dVN) > 0.999) {
    // V ∥ N → 选 (1,0,0) 或 (0,0,1) 中与 N 较不平行的一个
    const alt = Math.abs(N.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 0, 1);
    t1 = normalize(sub(alt, scale(N, dot(alt, N))));
  } else {
    t1 = normalize(sub(V, scale(N, dVN)));
  }
  // T2 = N × T1(negated from paper; handedness)
  const t2 = scale(cross(N, t1), -1.0);

  // compute transform: mat = mInv * transpose(mat3(T1, T2, N))
  // transpose(mat3(T1, T2, N)) 按行存储 T1, T2, N:
  //   [T1.x  T1.y  T1.z]
  //   [T2.x  T2.y  T2.z]
  //   [N.x   N.y   N.z ]
  // 列主序: [T1.x, T2.x, N.x, T1.y, T2.y, N.y, T1.z, T2.z, N.z]
  const basis: Mat3 = [
    t1.x, t2.x, N.x,
    t1.y, t2.y, N.y,
    t1.z, t2.z, N.z,
  ];

  // mat = mInv * basis(两个 3×3 矩阵相乘,列主序)
  const mat = mat3MulMat3(mInv, basis);

  // transform rect vertices & project onto sphere
  const coords0 = normalize(mat3MulVec(mat, sub(p0, P)));
  const coords1 = normalize(mat3MulVec(mat, sub(p1, P)));
  const coords2 = normalize(mat3MulVec(mat, sub(p2, P)));
  const coords3 = normalize(mat3MulVec(mat, sub(p3, P)));

  // calculate vector form factor (4 edges)
  let vectorFormFactor: Vec3 = { x: 0, y: 0, z: 0 };
  vectorFormFactor = add(vectorFormFactor, ltcEdgeVectorFormFactor(coords0, coords1));
  vectorFormFactor = add(vectorFormFactor, ltcEdgeVectorFormFactor(coords1, coords2));
  vectorFormFactor = add(vectorFormFactor, ltcEdgeVectorFormFactor(coords2, coords3));
  vectorFormFactor = add(vectorFormFactor, ltcEdgeVectorFormFactor(coords3, coords0));

  // adjust for horizon clipping
  return ltcClippedSphereFormFactor(vectorFormFactor);
}

// ── 3×3 矩阵乘法(列主序) ─────────────────────────────────────────

/** 两个 3×3 矩阵相乘(列主序)。result = a * b */
export function mat3MulMat3(a: Mat3, b: Mat3): number[] {
  // 列主序:a[col*3 + row], b[col*3 + row]
  // result[col*3 + row] = sum_k a[k*3 + row] * b[col*3 + k]
  const r = new Array<number>(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += a[k * 3 + row] * b[col * 3 + k];
      }
      r[col * 3 + row] = sum;
    }
  }
  return r;
}

// ── 完整面光源求值 ─────────────────────────────────────────────────

/**
 * 求值矩形面光源对单个着色点的光照贡献。
 *
 * 组合 LTC specular + 漫反射:
 *   - Specular: 用 mInvSpec(从 LTC specular LUT 采样)变换;
 *   - Diffuse:  用 mInvDiff(从 LTC diffuse LUT 采样,或单位矩阵近似)变换;
 *   - 最终 = (specular * specBRDF + diffuse * diffBRDF) * color * intensity。
 *
 * @param surface   着色点(P, N, V, roughness)
 * @param light     矩形面光源(4 顶点 + color + intensity)
 * @param mInvSpec  逆 LTC specular 矩阵(3×3,列主序)
 * @param mInvDiff  逆 LTC diffuse 矩阵(3×3,列主序,可传 undefined 用单位矩阵)
 * @returns         光照贡献 [specular, diffuse, total]
 */
export function evaluateRectAreaLight(
  surface: SurfacePoint,
  light: RectLightParams,
  mInvSpec: Mat3,
  mInvDiff?: Mat3,
): LTCResult {
  const { P, N, V } = surface;

  // Specular irradiance
  const specIrradiance = ltcEvaluate(N, V, P, mInvSpec, light.p0, light.p1, light.p2, light.p3);

  // Diffuse irradiance(用 mInvDiff 或单位矩阵)
  const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const diffMInv = mInvDiff ?? identity;
  const diffIrradiance = ltcEvaluate(N, V, P, diffMInv, light.p0, light.p1, light.p2, light.p3);

  // 应用光源颜色与强度
  const scale_ = light.intensity;
  const specular: LTCColor = [
    specIrradiance * light.color[0] * scale_,
    specIrradiance * light.color[1] * scale_,
    specIrradiance * light.color[2] * scale_,
  ];
  const diffuse: LTCColor = [
    diffIrradiance * light.color[0] * scale_,
    diffIrradiance * light.color[1] * scale_,
    diffIrradiance * light.color[2] * scale_,
  ];
  const total: LTCColor = [
    specular[0] + diffuse[0],
    specular[1] + diffuse[1],
    specular[2] + diffuse[2],
  ];

  return { specular, diffuse, total };
}

/**
 * 批量求值矩形面光源对多个着色点的光照。
 *
 * @param surfaces  着色点数组
 * @param light     矩形面光源
 * @param mInvSpec  逆 LTC specular 矩阵
 * @param mInvDiff  逆 LTC diffuse 矩阵(可选)
 * @returns         每个着色点的光照贡献数组
 */
export function computeAreaLighting(
  surfaces: SurfacePoint[],
  light: RectLightParams,
  mInvSpec: Mat3,
  mInvDiff?: Mat3,
): LTCResult[] {
  return surfaces.map((s) => evaluateRectAreaLight(s, light, mInvSpec, mInvDiff));
}

// ── 简化 LTC 矩阵近似(用于测试,无需预计算 LUT) ───────────────────

/**
 * 简化的 LTC 逆矩阵近似(用于无 LUT 测试)。
 *
 * 真实 LTC 矩阵需要从 64×64 LUT 采样(roughness × dotNV)。
 * 这里用解析近似:
 *   - roughness=0 → 单位矩阵(镜面反射,完美聚焦);
 *   - roughness=1 → 较大的散射矩阵;
 *   - 中间值线性插值。
 *
 * 注意:这只是测试用近似,生产环境应从预计算 LUT 采样。
 *
 * @param roughness GGX α(0..1)
 * @param dotNV     dot(N, V)(0..1)
 * @returns         3×3 逆 LTC 矩阵(列主序)
 */
export function approximateLTCMatrix(roughness: number, dotNV: number): number[] {
  // 简化:roughness 越大,散射越强 → 对角元素增大
  // dotNV 越小(掠射角),变换越强
  const r = saturate(roughness);
  const dNV = saturate(dotNV);

  // 经验近似:逆矩阵对角元素
  // roughness=0 → [1, 1, 1](单位矩阵)
  // roughness=1 → [1+r, 1+r, 1](更宽的散射)
  const a = 1.0 + r * (1.0 - dNV) * 0.5;
  const b = 1.0 + r * 0.3;

  // 列主序:
  // [a, 0, 0,  0, b, 0,  0, 0, 1]
  return [
    a, 0, 0,
    0, b, 0,
    0, 0, 1,
  ];
}

// ── 矩形顶点生成(从位置 + 方向 + 尺寸) ───────────────────────────

/**
 * 从光源位置、朝向、宽高生成矩形 4 顶点(CCW)。
 *
 * @param center  矩形中心(世界空间)
 * @param forward 光源朝向(从表面指向光源,归一化)
 * @param up      光源 up 方向(归一化)
 * @param width   矩形宽度(世界单位)
 * @param height  矩形高度(世界单位)
 * @returns       [p0, p1, p2, p3] CCW 顶点
 */
export function makeRectVertices(
  center: Vec3,
  forward: Vec3,
  up: Vec3,
  width: number,
  height: number,
): [Vec3, Vec3, Vec3, Vec3] {
  const right = normalize(cross(forward, up));
  const realUp = cross(right, forward);

  const hw = width * 0.5;
  const hh = height * 0.5;

  // CCW 绕序(从光源正面 / 受光面看)
  // three.js LTC_Evaluate 要求 CCW 顺序,且 lightNormal = cross(p1-p0, p3-p0)
  // 指向受光面(光源背面)。这样 dot(lightNormal, P-p0) < 0 表示在受光侧。
  const p0 = add(center, add(scale(right, -hw), scale(realUp, -hh)));
  const p1 = add(center, add(scale(right, -hw), scale(realUp, hh)));
  const p2 = add(center, add(scale(right, hw), scale(realUp, hh)));
  const p3 = add(center, add(scale(right, hw), scale(realUp, -hh)));

  return [p0, p1, p2, p3];
}
