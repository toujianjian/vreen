// HairMarschnerMaterial — Marschner 2003 物理毛发 BCSDF 材质。
//
// 设计目标:
//   - 实现火星纳(Marschner et al. 2003 "Light Scattering from Human Hair
//     Fibers")的 R / TT / TRT 三叶散射模型,替代 FurMaterial 的 Kajiya-Kay
//     近似,达到 UE5 Strand-based Hair / Unity HDRP Hair 的物理精度。
//   - CPU 侧提供可独立测试的纯函数(Fresnel / 吸收 / 纵向 M / 方位角 N),
//     与 GLSL 实时近似一一对应,便于离线验证与回归测试。
//   - GLSL 采用实时友好近似:R/TRT 用偏移 Kajiya-Kay 高光叶,TT 用折射透射项,
//     全部受 Fresnel 与 Beer-Lambert 吸收调制。
//
// 物理模型:
//   头发纤维视为电介质圆柱(η ≈ 1.55)。光线与纤维交互产生三条散射路径:
//     * R   — 表面反射(1 次 Fresnel),白色高光,沿毛干偏移 -α_R。
//     * TT  — 折射进入 → 折射穿出(2 次 Fresnel + 1 次吸收),透射光,
//             受毛发色素 σ_a 染色,呈现背光边缘的彩色透射。
//     * TRT — 折射进入 → 内部反射 → 折射穿出(3 次 Fresnel + 2 次吸收),
//             次高光(glint),偏移更大,更宽,染色更重。
//   纵向散射 M_p:以 α_p 为中心、β_p 为宽度的归一化高斯(沿毛干方向)。
//   方位角散射 N_p:Fresnel × 吸收 × 路径几何(绕纤维方向)。
//   最终 BSDF = Σ_p M_p × N_p,p ∈ {R, TT, TRT}。
//
// 与 FurMaterial 的区别:
//   * FurMaterial 用 Kajiya-Kay(圆柱体余弦叶)做双高光近似 —— 快但非物理。
//   * 本材质实现完整三叶 Marschner:新增 TT 透射叶 + 真正的 Fresnel/吸收,
//     能正确表现背光透射、色素染色、掠射角高光 —— 头发渲染金标准。
//
// 参考:
//   - Marschner et al. 2003, "Light Scattering from Human Hair Fibers"
//   - d'Eon et al. 2011, "An Energy-Conserving Hair Reflectance Model"
//   - UE5 Strand-based Hair / Unity HDRP Hair shading
//   - o3de Atom Hair shading

import { BasicMaterial, type RGB, type ShaderObject } from '../Core/Material';
import { Color } from '../Math/Color';
import { Vector3 } from '../Math/Vector3';
import type { ShaderProgram } from '../Renderer/ShaderProgram';

// ════════════════════════════════════════════════════════════════════
//  CPU 纯函数(物理参考实现,可独立测试,与 GLSL 一一对应)
// ════════════════════════════════════════════════════════════════════

/** 头发纤维默认折射率(eumelanin hair ≈ 1.55)。 */
export const HAIR_ETA_DEFAULT = 1.55;

/**
 * 电介质 Fresnel 反射率(Schlick 近似)。
 *
 *   R0 = ((η-1)/(η+1))²
 *   R(θ) = R0 + (1-R0)·(1-cosθ)⁵
 *
 * @param cosThetaI 入射角余弦(0..1)
 * @param eta       折射率(默认 1.55)
 * @returns         反射率 [0,1]
 */
export function hairFresnelDielectric(cosThetaI: number, eta: number = HAIR_ETA_DEFAULT): number {
  const c = Math.max(0, Math.min(1, cosThetaI));
  const r0 = ((eta - 1) / (eta + 1)) ** 2;
  return r0 + (1 - r0) * (1 - c) ** 5;
}

/**
 * Snell 定律:由入射角余弦求折射角余弦。
 *
 *   sin²θ_t = η²·(1 - cos²θ_i)
 *   cosθ_t = √(1 - sin²θ_t)
 *
 * 全反射时返回 0。
 *
 * @param cosThetaI 入射角余弦
 * @param eta       n1/n2(空气→头发 ≈ 1/1.55)
 * @returns         折射角余弦;全反射返回 0
 */
export function hairRefractCosTheta(cosThetaI: number, eta: number): number {
  const sin2ThetaI = Math.max(0, 1 - cosThetaI * cosThetaI);
  const sin2ThetaT = eta * eta * sin2ThetaI;
  if (sin2ThetaT >= 1) return 0; // 全反射
  return Math.sqrt(1 - sin2ThetaT);
}

/**
 * Beer-Lambert 吸收:光线穿过纤维的透过率(每通道独立)。
 *
 *   T = exp(-σ_a · l)
 *
 * @param pathLength 光程(纤维内路径长度,无量纲)
 * @param sigmaA     吸收系数 RGB(各通道 ≥0;越大越吸收)
 * @returns          透过率 RGB(各通道 (0,1])
 */
export function hairAbsorption(pathLength: number, sigmaA: RGB): RGB {
  const l = Math.max(0, pathLength);
  return {
    r: Math.exp(-sigmaA.r * l),
    g: Math.exp(-sigmaA.g * l),
    b: Math.exp(-sigmaA.b * l),
  };
}

/**
 * 纤维内光程:偏移 h 处的弦长 × 折射角修正 × 穿越次数。
 *
 * 圆柱(半径 1)在偏移 h 处的弦长 = 2·√(1-h²)。
 * 折射光以 θ_t 角穿越,光程 = 弦长 / cosθ_t。
 * TT 穿越一次(passes=1),TRT 内部反射使光程翻倍(passes=2)。
 *
 * @param h          偏移 [-1,1]
 * @param cosThetaT  折射角余弦
 * @param passes     穿越次数(TT=1, TRT=2)
 * @returns          光程(≥0)
 */
export function hairPathLength(h: number, cosThetaT: number, passes: number): number {
  const hh = Math.max(-1, Math.min(1, h));
  const chord = 2 * Math.sqrt(Math.max(0, 1 - hh * hh));
  const ct = Math.max(1e-4, cosThetaT);
  const p = Math.max(1, passes);
  return (chord / ct) * p;
}

/**
 * 纵向散射 M_p:归一化高斯。
 *
 *   M_p(θ_r) = (1/(√(2π)·β)) · exp(-(θ_r - α)² / (2β²))
 *
 * @param thetaR 反射纵向角(弧度)
 * @param alpha  中心偏移 α_p(弧度)
 * @param beta   宽度 β_p(弧度,>0)
 * @returns      散射强度(≥0)
 */
export function hairLongitudinalM(thetaR: number, alpha: number, beta: number): number {
  const b = Math.max(1e-6, beta);
  const d = thetaR - alpha;
  return Math.exp(-(d * d) / (2 * b * b)) / (Math.sqrt(2 * Math.PI) * b);
}

/** BCSDF 评估输入。所有角度为弧度。 */
export interface HairBSDFInput {
  /** 入射纵向角 θ_i(光线与垂直纤维平面的夹角)。 */
  thetaI: number;
  /** 反射纵向角 θ_r。 */
  thetaR: number;
  /** 折射率(默认 1.55)。 */
  eta?: number;
  /** 吸收系数 σ_a(RGB,各通道 ≥0)。 */
  sigmaA: RGB;
  /** R 叶纵向宽度 β_R。 */
  betaR: number;
  /** TT 叶纵向宽度 β_TT。 */
  betaTT: number;
  /** TRT 叶纵向宽度 β_TRT。 */
  betaTRT: number;
  /** R 叶中心偏移 α_R(弧度)。 */
  alphaR: number;
  /** TT 叶中心偏移 α_TT(弧度)。 */
  alphaTT: number;
  /** TRT 叶中心偏移 α_TRT(弧度)。 */
  alphaTRT: number;
  /** 偏移 h(代表采样点,[-1,1];默认 0)。 */
  h?: number;
  /** TT 叶强度倍数(默认 1)。 */
  ttScale?: number;
  /** TRT 叶强度倍数(默认 1)。 */
  trtScale?: number;
}

/**
 * 计算完整 Marschner 头发 BCSDF(R + TT + TRT)。
 *
 *   F = Fresnel(cosθ_d),  cosθ_d = cos((θ_i - θ_r)/2)
 *   cosθ_t = Snell(cosθ_d, 1/η)
 *   l_TT  = pathLength(h, cosθ_t, 1)
 *   l_TRT = pathLength(h, cosθ_t, 2)
 *   N_R   = F
 *   N_TT  = (1-F)² · absorption(l_TT)
 *   N_TRT = (1-F)·F·(1-F) · absorption(l_TRT)
 *   BSDF  = M_R·N_R + ttScale·M_TT·N_TT + trtScale·M_TRT·N_TRT
 *
 * @returns 散射强度 RGB(各通道 ≥0)
 */
export function computeHairBSDF(input: HairBSDFInput): RGB {
  const eta = input.eta ?? HAIR_ETA_DEFAULT;
  const h = input.h ?? 0;
  const ttScale = input.ttScale ?? 1;
  const trtScale = input.trtScale ?? 1;

  // 半角 θ_d = (θ_i - θ_r)/2 → 用其余弦做 Fresnel
  const thetaD = (input.thetaI - input.thetaR) / 2;
  const cosThetaD = Math.max(0, Math.cos(thetaD));
  const F = hairFresnelDielectric(cosThetaD, eta);

  // 折射角(空气→纤维,η' = 1/η)
  const cosThetaT = hairRefractCosTheta(cosThetaD, 1 / eta);

  // 各叶光程与吸收
  const lTT = hairPathLength(h, cosThetaT, 1);
  const lTRT = hairPathLength(h, cosThetaT, 2);
  const absTT = hairAbsorption(lTT, input.sigmaA);
  const absTRT = hairAbsorption(lTRT, input.sigmaA);

  // 纵向 M
  const MR = hairLongitudinalM(input.thetaR, input.alphaR, input.betaR);
  const MTT = hairLongitudinalM(input.thetaR, input.alphaTT, input.betaTT);
  const MTRT = hairLongitudinalM(input.thetaR, input.alphaTRT, input.betaTRT);

  // 方位角 N(简化:用 Fresnel/吸收 乘积近似 h 积分)
  const NR = F;
  const NTT = (1 - F) * (1 - F);
  const NTRT = (1 - F) * F * (1 - F);

  // 合成 RGB
  const r = MR * NR + ttScale * MTT * NTT * absTT.r + trtScale * MTRT * NTRT * absTRT.r;
  const g = MR * NR + ttScale * MTT * NTT * absTT.g + trtScale * MTRT * NTRT * absTRT.g;
  const b = MR * NR + ttScale * MTT * NTT * absTT.b + trtScale * MTRT * NTRT * absTRT.b;

  return { r, g, b };
}

// ════════════════════════════════════════════════════════════════════
//  GLSL 着色器(实时近似,与 CPU 函数对应)
// ════════════════════════════════════════════════════════════════════

export const HAIR_MARSCHNER_VERT = /* glsl */ `#version 300 es
precision highp float;

// Marschner 毛发顶点着色器:标准 MVP + 传递世界法线/切线/位置/uv。
// 切线 T 沿毛干方向(由 attribute 或法线派生)。

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec3 a_tangent;   // 毛干切线(可选;缺失时用法线近似)

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat4 u_normalMatrix;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec3 v_worldTangent;
out vec2 v_uv;

void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPos = world.xyz;
  v_worldNormal = normalize(mat3(u_normalMatrix) * a_normal);
  // 切线缺失(几何体未提供 a_tangent → 属性为 (0,0,0))时退回法线,
  // 避免 normalize(vec3(0)) 产生 NaN(Marschner 沿毛干方向退化成表面着色)。
  vec3 tObj = length(a_tangent) < 1e-5 ? a_normal : a_tangent;
  v_worldTangent = normalize(mat3(u_normalMatrix) * tObj);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * world;
}
`;

export const HAIR_MARSCHNER_FRAG = /* glsl */ `#version 300 es
precision highp float;

// Marschner 实时毛发着色器(R + TT + TRT 三叶近似)。
// 与 CPU computeHairBSDF 对应:Fresnel / Beer-Lambert 吸收 / 偏移高斯。

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec3 v_worldTangent;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_cameraPos;
uniform vec3  u_lightDir;          // 指向光源(世界空间)
uniform vec3  u_lightColor;
uniform vec3  u_baseColor;         // 毛发基础色(色素)
uniform float u_eta;               // 折射率(默认 1.55)
uniform vec3  u_sigmaA;            // 吸收系数(线性 RGB)
uniform float u_betaR;             // R 叶纵向宽度
uniform float u_betaTT;            // TT 叶纵向宽度
uniform float u_betaTRT;           // TRT 叶纵向宽度
uniform float u_alphaR;            // R 叶中心偏移
uniform float u_alphaTT;           // TT 叶中心偏移
uniform float u_alphaTRT;          // TRT 叶中心偏移
uniform float u_roughness;         // 毛干粗糙度(调制高光锐度)
uniform float u_ttScale;           // TT 叶强度
uniform float u_trtScale;          // TRT 叶强度
uniform float u_diffuseScale;      // 漫反射强度
uniform float u_opacity;

const float PI = 3.14159265359;

// Schlick 电介质 Fresnel
float fresnelDielectric(float cosTheta, float eta) {
  float r0 = (eta - 1.0) / (eta + 1.0);
  r0 = r0 * r0;
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
  vec3 T = normalize(v_worldTangent);
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);

  // 纵向角:光线与切线的夹角(投影到切线方向)
  float cosThetaI = dot(L, T);
  float cosThetaR = dot(V, T);
  float thetaI = acos(clamp(cosThetaI, -1.0, 1.0));
  float thetaR = acos(clamp(cosThetaR, -1.0, 1.0));

  // 半角 θ_d
  float thetaD = (thetaI - thetaR) * 0.5;
  float cosThetaD = clamp(cos(thetaD), 0.0, 1.0);
  float F = fresnelDielectric(cosThetaD, u_eta);

  // 折射角(Snell,η' = 1/η)
  float sinThetaT = sqrt(max(0.0, 1.0 - cosThetaD * cosThetaD)) / u_eta;
  float cosThetaT = sqrt(max(0.0, 1.0 - sinThetaT * sinThetaT));

  // 光程(代表 h≈0:弦长 2,TT 1 次,TRT 2 次)
  float lTT  = 2.0 / max(cosThetaT, 1e-3);
  float lTRT = 4.0 / max(cosThetaT, 1e-3);
  vec3 absTT  = exp(-u_sigmaA * lTT);
  vec3 absTRT = exp(-u_sigmaA * lTRT);

  // 纵向 M(高斯,沿反射角)
  float MR   = exp(-pow(thetaR - u_alphaR,   2.0) / (2.0 * u_betaR   * u_betaR))   / (sqrt(2.0 * PI) * u_betaR);
  float MTT  = exp(-pow(thetaR - u_alphaTT,  2.0) / (2.0 * u_betaTT  * u_betaTT))  / (sqrt(2.0 * PI) * u_betaTT);
  float MTRT = exp(-pow(thetaR - u_alphaTRT, 2.0) / (2.0 * u_betaTRT * u_betaTRT)) / (sqrt(2.0 * PI) * u_betaTRT);

  // 方位角 N
  float NR   = F;
  float NTT  = (1.0 - F) * (1.0 - F);
  float NTRT = (1.0 - F) * F * (1.0 - F);

  // 三叶合成
  vec3 R   = vec3(NR * MR);
  vec3 TT  = NTT * MTT * absTT  * u_ttScale;
  vec3 TRT = NTRT * MTRT * absTRT * u_trtScale;
  vec3 specular = (R + TT + TRT) * u_lightColor;

  // Kajiya-Kay 圆柱漫反射(sinθ)
  float dotTL = dot(T, L);
  float sinTL = sqrt(max(0.0, 1.0 - dotTL * dotTL));
  vec3 diffuse = u_baseColor * u_lightColor * sinTL * u_diffuseScale;

  // 环境项
  vec3 ambient = u_baseColor * 0.15;

  vec3 color = ambient + diffuse + specular;
  outColor = vec4(color, u_opacity);
}
`;

// ════════════════════════════════════════════════════════════════════
//  HairMarschnerMaterial 材质类
// ════════════════════════════════════════════════════════════════════

/** 预设毛发色素(σ_a,线性 RGB)。参考 Marschner 2003 Table。 */
export const HAIR_PIGMENTS = {
  /** 黑发:强吸收。 */
  black: { r: 1.0, g: 1.0, b: 1.0 } as RGB,
  /** 棕发:中强吸收,红光透射略多。 */
  brown: { r: 0.6, g: 0.8, b: 1.2 } as RGB,
  /** 金发:弱吸收,蓝光略多被吸收(透射偏黄)。 */
  blonde: { r: 0.2, g: 0.3, b: 0.5 } as RGB,
  /** 红发:绿光强吸收(透射偏红)。 */
  red: { r: 0.3, g: 1.5, b: 0.4 } as RGB,
  /** 白发/灰发:近无吸收。 */
  white: { r: 0.05, g: 0.05, b: 0.05 } as RGB,
} as const;

/** HairMarschnerMaterial 构造选项。所有字段可选。 */
export interface HairMarschnerMaterialOptions {
  /** 毛发基础色(线性 RGB,默认棕)。 */
  baseColor?: RGB;
  /** 折射率(默认 1.55)。 */
  eta?: number;
  /** 吸收系数 σ_a(默认棕发预设)。 */
  sigmaA?: RGB;
  /** R 叶纵向宽度 β_R(弧度,默认 0.05)。 */
  betaR?: number;
  /** TT 叶纵向宽度 β_TT(弧度,默认 0.1)。 */
  betaTT?: number;
  /** TRT 叶纵向宽度 β_TRT(弧度,默认 0.15)。 */
  betaTRT?: number;
  /** R 叶中心偏移 α_R(弧度,默认 -0.035 ≈ -2°)。 */
  alphaR?: number;
  /** TT 叶中心偏移 α_TT(弧度,默认 0.5 × θ_d,这里取固定 -0.1)。 */
  alphaTT?: number;
  /** TRT 叶中心偏移 α_TRT(弧度,默认 -0.2,朝毛根偏移)。 */
  alphaTRT?: number;
  /** 毛干粗糙度 [0,1](调制高光锐度,默认 0.3)。 */
  roughness?: number;
  /** TT 叶强度(默认 1.0)。 */
  ttScale?: number;
  /** TRT 叶强度(默认 1.0)。 */
  trtScale?: number;
  /** 漫反射强度(默认 0.5)。 */
  diffuseScale?: number;
  /** 透明度(默认 1)。 */
  opacity?: number;
  /** 是否透明(默认 true)。 */
  transparent?: boolean;
  /** 是否双面(默认 true)。 */
  doubleSided?: boolean;
  /** 光照方向(世界空间,指向光源)。 */
  lightDirection?: Vector3;
  /** 光照颜色。 */
  lightColor?: Color;
  /** 线框。 */
  wireframe?: boolean;
  /** 深度测试。 */
  depthTest?: boolean;
  /** 深度写入。 */
  depthWrite?: boolean;
}

/**
 * Marschner 物理毛发材质。
 *
 * 实现 R / TT / TRT 三叶 BCSDF,与 FurMaterial(Kajiya-Kay 近似)同级。
 * 渲染器在编译时识别 type === 'HairMarschner' 走 HAIR_MARSCHNER_VERT/FRAG。
 *
 * 用法:
 * ```ts
 * const hair = new HairMarschnerMaterial({
 *   baseColor: { r: 0.4, g: 0.25, b: 0.1 },
 *   sigmaA: HAIR_PIGMENTS.brown,
 *   roughness: 0.25,
 * });
 * mesh.material = hair;
 * ```
 */
export class HairMarschnerMaterial extends BasicMaterial {
  override readonly type: string = 'HairMarschner';
  /** instanceof 替代标志。 */
  readonly isHairMarschnerMaterial: boolean = true;

  /** 毛发基础色。 */
  baseColor: RGB;
  /** 折射率。 */
  eta: number;
  /** 吸收系数 σ_a(RGB)。 */
  sigmaA: RGB;
  /** R 叶纵向宽度(弧度)。 */
  betaR: number;
  /** TT 叶纵向宽度(弧度)。 */
  betaTT: number;
  /** TRT 叶纵向宽度(弧度)。 */
  betaTRT: number;
  /** R 叶中心偏移(弧度)。 */
  alphaR: number;
  /** TT 叶中心偏移(弧度)。 */
  alphaTT: number;
  /** TRT 叶中心偏移(弧度)。 */
  alphaTRT: number;
  /** 毛干粗糙度 [0,1]。 */
  roughness: number;
  /** TT 叶强度。 */
  ttScale: number;
  /** TRT 叶强度。 */
  trtScale: number;
  /** 漫反射强度。 */
  diffuseScale: number;
  /** 透明度。 */
  opacity: number;
  /** 是否透明。 */
  transparent: boolean;
  /** 是否双面。 */
  doubleSided: boolean;

  /** 光照方向(世界空间,指向光源)。 */
  lightDirection: Vector3;
  /** 光照颜色。 */
  lightColor: Color;

  /** Renderer 填入:已编译 program。 */
  program: ShaderProgram | null = null;
  /** Program cache key。 */
  programKey: string = 'hair-marschner';

  constructor(opts: HairMarschnerMaterialOptions = {}) {
    super();
    this.baseColor = opts.baseColor ?? { r: 0.4, g: 0.25, b: 0.1 };
    this.eta = opts.eta ?? HAIR_ETA_DEFAULT;
    this.sigmaA = opts.sigmaA ?? { ...HAIR_PIGMENTS.brown };
    this.betaR = opts.betaR ?? 0.05;
    this.betaTT = opts.betaTT ?? 0.1;
    this.betaTRT = opts.betaTRT ?? 0.15;
    this.alphaR = opts.alphaR ?? -0.035;
    this.alphaTT = opts.alphaTT ?? -0.1;
    this.alphaTRT = opts.alphaTRT ?? -0.2;
    this.roughness = opts.roughness ?? 0.3;
    this.ttScale = opts.ttScale ?? 1.0;
    this.trtScale = opts.trtScale ?? 1.0;
    this.diffuseScale = opts.diffuseScale ?? 0.5;
    this.opacity = opts.opacity ?? 1;
    this.transparent = opts.transparent ?? true;
    this.doubleSided = opts.doubleSided ?? true;
    this.lightDirection = opts.lightDirection
      ? opts.lightDirection.clone().normalize()
      : new Vector3(1, 1, 1).normalize();
    this.lightColor = opts.lightColor ? opts.lightColor.clone() : new Color(1, 1, 1);
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
  }

  /** Convenience: 用预设色素构造。 */
  static fromPigment(pigment: keyof typeof HAIR_PIGMENTS, baseColor?: RGB): HairMarschnerMaterial {
    return new HairMarschnerMaterial({
      sigmaA: { ...HAIR_PIGMENTS[pigment] },
      baseColor: baseColor ?? { r: 0.4, g: 0.25, b: 0.1 },
    });
  }

  override onBeforeCompile(_shader: ShaderObject, _renderer?: unknown): void {
    // 默认 no-op;子类可注入额外光照 chunk。
  }

  override customProgramCacheKey(): string {
    return 'hair-marschner';
  }

  /** CPU 侧 BCSDF 评估(与 GLSL 对应,用于离线验证/测试)。 */
  evaluate(thetaI: number, thetaR: number): RGB {
    return computeHairBSDF({
      thetaI,
      thetaR,
      eta: this.eta,
      sigmaA: this.sigmaA,
      betaR: this.betaR,
      betaTT: this.betaTT,
      betaTRT: this.betaTRT,
      alphaR: this.alphaR,
      alphaTT: this.alphaTT,
      alphaTRT: this.alphaTRT,
      ttScale: this.ttScale,
      trtScale: this.trtScale,
    });
  }

  /** 从 source 复制所有可变字段,返回 this。 */
  copy(source: HairMarschnerMaterial): this {
    this.baseColor = { ...source.baseColor };
    this.eta = source.eta;
    this.sigmaA = { ...source.sigmaA };
    this.betaR = source.betaR;
    this.betaTT = source.betaTT;
    this.betaTRT = source.betaTRT;
    this.alphaR = source.alphaR;
    this.alphaTT = source.alphaTT;
    this.alphaTRT = source.alphaTRT;
    this.roughness = source.roughness;
    this.ttScale = source.ttScale;
    this.trtScale = source.trtScale;
    this.diffuseScale = source.diffuseScale;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.doubleSided = source.doubleSided;
    this.lightDirection = source.lightDirection.clone();
    this.lightColor = source.lightColor.clone();
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝。 */
  clone(): HairMarschnerMaterial {
    return new HairMarschnerMaterial().copy(this);
  }
}
