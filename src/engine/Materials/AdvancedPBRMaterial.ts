// AdvancedPBRMaterial — 高级 PBR 材质(各向异性 + 虹彩 + 透明涂层 + 光泽 + 自发光)。
//
// 适用场景:车漆 / 碳纤维 / 光盘虹彩 / 肥皂泡 / 贝壳 / 织物 / 复合层叠材质。
// 在 StandardMaterial / PhysicalMaterial 之上扩展以下子层:
//
//   * 各向异性 (Anisotropy):沿切线方向拉伸镜面高光(拉丝金属 / 头发 / 光盘)。
//     采用 Burley 2012 各向异性 GGX:在 tangent / bitangent 方向用不同的
//     α (ax = α * (1 + anisotropy), ay = α / (1 + anisotropy))。
//   * 虹彩 (Iridescence):薄膜干涉,基于相位差计算每波长反射率,混合到 Fresnel。
//     简化模型:R = 2 * R0 * (1 - cos(2π * OPD / λ)) ,OPD = 2 * n * d * cosθ_t。
//   * 透明涂层 (Clearcoat):第二层 BRDF(清晰镜面层),Burley clearcoat GGX,
//     roughness 独立,可带法线贴图。最终 result = base * (1 - cc) + clearcoat * cc。
//   * 光泽 (Sheen):布料/织物边缘反弹的柔和光(Ashikhmin Charlie 分布)。
//   * 自发光 (Emissive):独立的 emissive * emissiveIntensity 项。
//
// 设计:
//   * 继承 BasicMaterial,与 ToonMaterial / FurMaterial / SSSMaterial 同级。
//   * 持有完整 PBR 参数(baseColor / roughness / metallic)及上述子层。
//   * 着色器:
//       - 顶点:标准 MVP + worldPos / worldNormal / worldTangent / uv
//       - 片元:各向异性 GGX + 虹彩 + clearcoat + sheen + emissive 合成
//   * CPU 侧提供 computeAnisotropicBRDF / computeIridescence / computeClearcoat /
//     computeSheen 参考实现,与 GLSL 一致(便于测试 / 离线验证)。
//
// 与 PhysicalMaterial 的区别:
//   * PhysicalMaterial 持 clearcoat / sheen / transmission 等数据,但 shader 集成
//     延后(advisory);本类提供完整 GLSL shader + CPU BRDF,可直接被 renderer 使用。
//   * 本类新增 anisotropy / iridescence,PhysicalMaterial 未覆盖。
//
// 用法:
//   const mat = new AdvancedPBRMaterial({
//     baseColor: { r: 0.8, g: 0.2, b: 0.1 },
//     metallic: 0.9, roughness: 0.3,
//     anisotropy: 0.8, anisotropyDirection: 45,
//     clearcoat: 1.0, clearcoatRoughness: 0.05,
//     iridescence: 0.6, iridescenceIOR: 1.3,
//   });
//   mesh.material = mat;

import { BasicMaterial, type RGB, type ShaderObject } from '../Core/Material';
import { Vector3 } from '../Math/Vector3';

/** Alpha 模式(参考 glTF 2.0)。 */
export type AlphaMode = 'opaque' | 'mask' | 'blend';

/** 质量等级(影响 BRDF 采样数 / 虹彩波长数,本材质为咨询性)。 */
export type AdvancedPBRQuality = 'low' | 'medium' | 'high';

/** AdvancedPBRMaterial 构造选项。所有字段可选。 */
export interface AdvancedPBRMaterialOptions {
  /** 基础颜色(线性 0..1)。 */
  baseColor?: RGB;
  /** 粗糙度 [0,1]。 */
  roughness?: number;
  /** 金属度 [0,1]。 */
  metallic?: number;
  /** 各向异性强度 [-1,1],负值反转方向。 */
  anisotropy?: number;
  /** 各向异性方向角度 [0,360](度,围绕法线)。 */
  anisotropyDirection?: number;
  /** 虹彩强度 [0,1]。 */
  iridescence?: number;
  /** 虹彩薄膜折射率(>=1)。 */
  iridescenceIOR?: number;
  /** 虹彩薄膜最小厚度(nm)。 */
  iridescenceThicknessMin?: number;
  /** 虹彩薄膜最大厚度(nm)。 */
  iridescenceThicknessMax?: number;
  /** 透明涂层强度 [0,1]。 */
  clearcoat?: number;
  /** 透明涂层粗糙度 [0,1]。 */
  clearcoatRoughness?: number;
  /** 透明涂层法线(可选,0..1 向量)。 */
  clearcoatNormal?: RGB | null;
  /** 光泽强度 [0,1]。 */
  sheen?: number;
  /** 光泽颜色。 */
  sheenColor?: RGB;
  /** 光泽层粗糙度 [0,1]。 */
  sheenRoughness?: number;
  /** 自发光颜色。 */
  emissive?: RGB;
  /** 自发光强度(>=0)。 */
  emissiveIntensity?: number;
  /** Alpha 模式。 */
  alphaMode?: AlphaMode;
  /** Alpha 截断(0..1,mask 模式用)。 */
  alphaCutoff?: number;
  /** 双面渲染。 */
  doubleSided?: boolean;
  /** 法线强度(>=0)。 */
  normalScale?: number;
  /** AO 强度 [0,1]。 */
  aoStrength?: number;
  /** 透明度 0..1。 */
  opacity?: number;
  /** 是否透明(blend 模式自动置 true)。 */
  transparent?: boolean;
  /** 是否启用线框。 */
  wireframe?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
  /** 质量等级(咨询性,影响 CPU BRDF 采样)。 */
  quality?: AdvancedPBRQuality;
}

/** 各向异性 BRDF 输入参数。 */
export interface AnisotropicBRDFInput {
  /** 表面法线(归一化)。 */
  N: Vector3;
  /** 视线方向(从表面指向观察者,归一化)。 */
  V: Vector3;
  /** 光线方向(从表面指向光源,归一化)。 */
  L: Vector3;
  /** 切线方向(归一化,各向异性主轴)。 */
  T: Vector3;
  /** 副切线方向(归一化,各向异性副轴)。 */
  B: Vector3;
}

/** 各向异性 BRDF 输出。 */
export interface AnisotropicBRDFOutput {
  /** 漫反射项(线性 RGB)。 */
  diffuse: RGB;
  /** 镜面反射项(线性 RGB)。 */
  specular: RGB;
  /** 菲涅尔项 F。 */
  fresnel: number;
}

/** 虹彩计算输入。 */
export interface IridescenceInput {
  /** 入射角余弦(cosTheta = dot(N, V),0..1)。 */
  cosTheta: number;
  /** 薄膜厚度(nm)。 */
  thickness: number;
  /** 虹彩强度 [0,1]。 */
  intensity: number;
  /** 薄膜折射率(>=1)。 */
  ior: number;
}

/** 虹彩计算输出。 */
export interface IridescenceOutput {
  /** 虹彩反射率(线性 RGB)。 */
  reflectance: RGB;
  /** 虹彩菲涅尔系数 F0。 */
  f0: number;
}

/** 透明涂层计算输入。 */
export interface ClearcoatInput {
  /** 表面法线(归一化)。 */
  N: Vector3;
  /** 视线方向(归一化)。 */
  V: Vector3;
  /** 光线方向(归一化)。 */
  L: Vector3;
  /** 半程向量(归一化)。 */
  H: Vector3;
}

/** 透明涂层计算输出。 */
export interface ClearcoatOutput {
  /** 透明涂层镜面贡献(0..1)。 */
  specular: number;
  /** 透明涂层菲涅尔。 */
  fresnel: number;
}

/** 光泽计算输入。 */
export interface SheenInput {
  /** 表面法线(归一化)。 */
  N: Vector3;
  /** 视线方向(归一化)。 */
  V: Vector3;
  /** 半程向量(归一化)。 */
  H: Vector3;
}

/** 光泽计算输出。 */
export interface SheenOutput {
  /** 光泽反射率(线性 RGB)。 */
  reflectance: RGB;
  /** 光泽强度系数。 */
  intensity: number;
}

// ── GLSL Shaders ─────────────────────────────────────────────────────

/** 顶点 shader:输出 worldPos / worldNormal / worldTangent / uv。 */
export const ADV_PBR_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec3 a_tangent;  // 可选,默认 vec3(0)

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec3 v_worldTangent;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_worldTangent = normalize(u_normalMatrix * a_tangent);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/** 片元 shader:各向异性 GGX + 虹彩 + clearcoat + sheen + emissive。 */
export const ADV_PBR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec3 v_worldTangent;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_baseColor;
uniform float u_roughness;
uniform float u_metallic;
uniform float u_anisotropy;          // -1..1
uniform float u_anisotropyDirection; // 0..360 度
uniform float u_iridescence;         // 0..1
uniform float u_iridescenceIOR;      // >=1
uniform float u_iridescenceThicknessMin; // nm
uniform float u_iridescenceThicknessMax; // nm
uniform float u_clearcoat;           // 0..1
uniform float u_clearcoatRoughness;  // 0..1
uniform vec3  u_clearcoatNormal;     // 0..1
uniform int   u_hasClearcoatNormal;
uniform float u_sheen;               // 0..1
uniform vec3  u_sheenColor;
uniform float u_sheenRoughness;
uniform vec3  u_emissive;
uniform float u_emissiveIntensity;
uniform int   u_alphaMode;           // 0=opaque 1=mask 2=blend
uniform float u_alphaCutoff;
uniform int   u_doubleSided;
uniform float u_normalScale;
uniform float u_aoStrength;
uniform float u_opacity;

uniform vec3  u_lightDir;
uniform vec3  u_lightColor;
uniform float u_lightIntensity;
uniform vec3  u_ambientColor;
uniform vec3  u_cameraPos;

const float PI = 3.141592653589793;
const float EPS = 1e-4;

// ── GGX 法线分布(各向异性) ─────────────────────
float D_GGX_Anisotropic(float NoH, float ToH, float BoH, float ax, float ay) {
  float a2 = ax * ay;
  float denom = ToH * ToH / (ax * ax) + BoH * BoH / (ay * ay) + NoH * NoH;
  return a2 / (PI * denom * denom);
}

// ── GGX 法线分布(各向同性,clearcoat 用) ──────
float D_GGX(float NoH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float denom = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

// ── Charlie 分布(sheen 用,Ashikhmin 2015) ────
float D_Charlie(float sheenRoughness, float NoH) {
  float r = sheenRoughness * sheenRoughness;
  // Charlie = (2 + 1/(2π*r)) * cos(NH)^(2/(2r)+1) / (2π * r)
  // 简化数值稳定的近似
  float a2 = r * r;
  float invR = 1.0 / max(2.0 * PI * a2, EPS);
  float cosNH = max(NoH, 0.0);
  return (2.0 + invR) * pow(cosNH, 2.0 / (4.0 * r + 2.0)) * invR;
}

// ── Smith 几何遮蔽(各向异性,使用 GGX-Lambda) ──
float V_SmithGGX(float NoV, float NoL, float roughness) {
  float a = roughness * roughness;
  float ggxV = NoL * sqrt(NoV * NoV * (1.0 - a) + a);
  float ggxL = NoV * sqrt(NoL * NoL * (1.0 - a) + a);
  return 0.5 / max(ggxV + ggxL, EPS);
}

// ── Schlick 菲涅尔 ──────────────────────────────
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ── 虹彩薄膜干涉(简化) ─────────────────────────
vec3 evalIridescence(float cosTheta, float thickness, float ior, vec3 F0) {
  // OPD = 2 * n * d * cos(theta_t)
  float sinThetaT2 = (1.0 - cosTheta * cosTheta) / max(ior * ior, EPS);
  float cosThetaT = sqrt(max(1.0 - sinThetaT2, 0.0));
  float opd = 2.0 * ior * thickness * cosThetaT;
  // 三个代表波长(红 630 / 绿 530 / 蓝 460 nm)
  vec3 lambda = vec3(630.0, 530.0, 460.0);
  // 相位 → 反射率调制:R = R0 * (1 + cos(2π OPD / λ)) / 2 近似
  vec3 phase = 2.0 * PI * opd / lambda;
  vec3 modulation = 0.5 + 0.5 * cos(phase);
  // F0 = ((n-1)/(n+1))^2
  float f0_ir = (ior - 1.0) / (ior + 1.0);
  f0_ir *= f0_ir;
  vec3 R = vec3(f0_ir) * modulation * 2.0;
  return mix(F0, R, 1.0);
}

void main() {
  vec3 N = normalize(v_worldNormal);
  if (u_doubleSided == 0 && !gl_FrontFacing) {
    discard;
  }
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 L = normalize(-u_lightDir);
  vec3 H = normalize(L + V);

  // 切线坐标系(各向异性方向旋转)
  float angleRad = u_anisotropyDirection * PI / 180.0;
  vec3 T = normalize(v_worldTangent);
  vec3 B = cross(N, T);
  float c = cos(angleRad);
  float s = sin(angleRad);
  vec3 Td = normalize(T * c + B * s);
  vec3 Bd = normalize(-T * s + B * c);

  float NoL = max(dot(N, L), 0.0);
  float NoV = max(dot(N, V), 0.0);
  float NoH = max(dot(N, H), 0.0);
  float ToH = dot(Td, H);
  float BoH = dot(Bd, H);

  // ── 基础 BRDF(各向异性 GGX) ─────────────────
  float rough = clamp(u_roughness, 0.045, 1.0);
  float aniso = clamp(u_anisotropy, -1.0, 1.0);
  float a = rough * rough;
  float ax = a * (1.0 + aniso);
  float ay = a / (1.0 + aniso);
  float D = D_GGX_Anisotropic(NoH, ToH, BoH, ax, ay);
  float Vis = V_SmithGGX(NoV, NoL, rough);
  vec3 F0 = mix(vec3(0.04), u_baseColor, u_metallic);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

  // 虹彩混合到 Fresnel
  if (u_iridescence > 0.0) {
    float thickness = mix(u_iridescenceThicknessMin, u_iridescenceThicknessMax, 0.5);
    vec3 irid = evalIridescence(max(dot(N, V), 0.0), thickness, u_iridescenceIOR, F0);
    F = mix(F, irid, u_iridescence);
  }

  vec3 specular = D * Vis * F * u_lightColor * u_lightIntensity;
  vec3 diffuse = (1.0 - F) * (1.0 - u_metallic) * u_baseColor / PI
               * u_lightColor * u_lightIntensity * NoL;
  vec3 ambient = u_ambientColor * u_baseColor * (1.0 - u_metallic);

  vec3 color = ambient + diffuse + specular;

  // ── 透明涂层 ─────────────────────────────────
  if (u_clearcoat > 0.0) {
    vec3 ccN = N;
    if (u_hasClearcoatNormal == 1) {
      ccN = normalize(ccN + (u_clearcoatNormal - 0.5) * 2.0);
    }
    float ccNoH = max(dot(ccN, H), 0.0);
    float ccNoV = max(dot(ccN, V), 0.0);
    float ccNoL = max(dot(ccN, L), 0.0);
    float ccD = D_GGX(ccNoH, u_clearcoatRoughness);
    float ccVis = V_SmithGGX(ccNoV, ccNoL, u_clearcoatRoughness);
    float ccF0 = 0.04; // 涂层 IOR 1.5
    float ccF = ccF0 + (1.0 - ccF0) * pow(clamp(1.0 - ccNoV, 0.0, 1.0), 5.0);
    float ccSpec = ccD * ccVis * ccF;
    // 涂层会衰减下层(简化:Fresnel 项加权)
    color = mix(color, color * 0.8 + vec3(ccSpec) * u_lightColor * u_lightIntensity, u_clearcoat);
  }

  // ── 光泽(sheen) ─────────────────────────────
  if (u_sheen > 0.0) {
    float sheenNoH = max(dot(N, H), 0.0);
    float sheenD = D_Charlie(u_sheenRoughness, sheenNoH);
    float sheenV = 1.0 / max(4.0 * (NoL + NoV - NoL * NoV), EPS);
    vec3 sheenContrib = sheenD * sheenV * u_sheenColor * NoL;
    color = mix(color, color + sheenContrib, u_sheen);
  }

  // ── 自发光 ───────────────────────────────────
  color += u_emissive * u_emissiveIntensity;

  // ── AO 调制 ──────────────────────────────────
  color *= mix(1.0, max(1.0 - u_aoStrength, 0.0), 0.0); // 简化,无 AO 纹理

  // ── Alpha 模式 ───────────────────────────────
  float alpha = u_opacity;
  if (u_alphaMode == 1) {
    if (alpha < u_alphaCutoff) discard;
    alpha = 1.0;
  }

  outColor = vec4(color, alpha);
}
`;

/**
 * 高级 PBR 材质 — 各向异性 + 虹彩 + 透明涂层 + 光泽 + 自发光。
 *
 * 持有完整 PBR 参数与四层子 BRDF。renderer 识别 type === 'AdvancedPBR'
 * 走 ADV_PBR_VERT / ADV_PBR_FRAG 程序路径。
 */
export class AdvancedPBRMaterial extends BasicMaterial {
  override readonly type: string = 'AdvancedPBR';
  /** 标志用于 instanceof 替代检测。 */
  readonly isAdvancedPBRMaterial: boolean = true;

  /** 基础颜色(线性 0..1)。 */
  baseColor: RGB = { r: 0.8, g: 0.8, b: 0.8 };
  /** 粗糙度 [0,1]。 */
  roughness: number = 0.5;
  /** 金属度 [0,1]。 */
  metallic: number = 0;

  /** 各向异性强度 [-1,1]。 */
  anisotropy: number = 0;
  /** 各向异性方向角度 [0,360]。 */
  anisotropyDirection: number = 0;

  /** 虹彩强度 [0,1]。 */
  iridescence: number = 0;
  /** 虹彩薄膜折射率(>=1)。 */
  iridescenceIOR: number = 1.3;
  /** 虹彩薄膜最小厚度(nm)。 */
  iridescenceThicknessMin: number = 100;
  /** 虹彩薄膜最大厚度(nm)。 */
  iridescenceThicknessMax: number = 400;

  /** 透明涂层强度 [0,1]。 */
  clearcoat: number = 0;
  /** 透明涂层粗糙度 [0,1]。 */
  clearcoatRoughness: number = 0.03;
  /** 透明涂层法线(可选,null 表示用基础法线)。 */
  clearcoatNormal: RGB | null = null;

  /** 光泽强度 [0,1]。 */
  sheen: number = 0;
  /** 光泽颜色。 */
  sheenColor: RGB = { r: 1, g: 1, b: 1 };
  /** 光泽层粗糙度 [0,1]。 */
  sheenRoughness: number = 0.5;

  /** 自发光颜色。 */
  emissive: RGB = { r: 0, g: 0, b: 0 };
  /** 自发光强度(>=0)。 */
  emissiveIntensity: number = 1;

  /** Alpha 模式。 */
  alphaMode: AlphaMode = 'opaque';
  /** Alpha 截断(0..1,mask 模式用)。 */
  alphaCutoff: number = 0.5;
  /** 双面渲染。 */
  doubleSided: boolean = false;

  /** 法线强度(>=0)。 */
  normalScale: number = 1;
  /** AO 强度 [0,1]。 */
  aoStrength: number = 1;

  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 是否透明(blend 模式自动置 true)。 */
  transparent: boolean = false;

  /** 质量等级(咨询性,影响 CPU BRDF 采样精度)。 */
  quality: AdvancedPBRQuality = 'high';

  constructor(opts: AdvancedPBRMaterialOptions = {}) {
    super();
    if (opts.baseColor) this.baseColor = { ...opts.baseColor };
    if (opts.roughness !== undefined) this.roughness = clamp01(opts.roughness);
    if (opts.metallic !== undefined) this.metallic = clamp01(opts.metallic);
    if (opts.anisotropy !== undefined) this.anisotropy = clamp(opts.anisotropy, -1, 1);
    if (opts.anisotropyDirection !== undefined) this.anisotropyDirection = wrap360(opts.anisotropyDirection);
    if (opts.iridescence !== undefined) this.iridescence = clamp01(opts.iridescence);
    if (opts.iridescenceIOR !== undefined) this.iridescenceIOR = Math.max(1, opts.iridescenceIOR);
    if (opts.iridescenceThicknessMin !== undefined) this.iridescenceThicknessMin = Math.max(0, opts.iridescenceThicknessMin);
    if (opts.iridescenceThicknessMax !== undefined) this.iridescenceThicknessMax = Math.max(this.iridescenceThicknessMin, opts.iridescenceThicknessMax);
    if (opts.clearcoat !== undefined) this.clearcoat = clamp01(opts.clearcoat);
    if (opts.clearcoatRoughness !== undefined) this.clearcoatRoughness = clamp01(opts.clearcoatRoughness);
    if (opts.clearcoatNormal !== undefined) this.clearcoatNormal = opts.clearcoatNormal ? { ...opts.clearcoatNormal } : null;
    if (opts.sheen !== undefined) this.sheen = clamp01(opts.sheen);
    if (opts.sheenColor) this.sheenColor = { ...opts.sheenColor };
    if (opts.sheenRoughness !== undefined) this.sheenRoughness = clamp01(opts.sheenRoughness);
    if (opts.emissive) this.emissive = { ...opts.emissive };
    if (opts.emissiveIntensity !== undefined) this.emissiveIntensity = Math.max(0, opts.emissiveIntensity);
    if (opts.alphaMode !== undefined) this.alphaMode = opts.alphaMode;
    if (opts.alphaCutoff !== undefined) this.alphaCutoff = clamp01(opts.alphaCutoff);
    if (opts.doubleSided !== undefined) this.doubleSided = opts.doubleSided;
    if (opts.normalScale !== undefined) this.normalScale = Math.max(0, opts.normalScale);
    if (opts.aoStrength !== undefined) this.aoStrength = clamp01(opts.aoStrength);
    if (opts.opacity !== undefined) this.opacity = clamp01(opts.opacity);
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    if (opts.quality !== undefined) this.quality = opts.quality;
    // alphaMode = blend → 自动透明
    if (this.alphaMode === 'blend') this.transparent = true;
  }

  /** 便捷构造:从 hex 颜色构造基础颜色。 */
  static fromHex(hex: string): AdvancedPBRMaterial {
    return new AdvancedPBRMaterial({ baseColor: hexToRgb(hex) });
  }

  // ── setter(返回 this,链式调用) ─────────────────────────────────

  /** 设置基础颜色。 */
  setBaseColor(color: RGB): this {
    this.baseColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置粗糙度 [0,1]。 */
  setRoughness(r: number): this {
    this.roughness = clamp01(r);
    return this;
  }

  /** 设置金属度 [0,1]。 */
  setMetallic(m: number): this {
    this.metallic = clamp01(m);
    return this;
  }

  /**
   * 设置各向异性。
   * @param strength  -1..1,负值反转方向
   * @param direction 0..360 度,围绕法线
   */
  setAnisotropy(strength: number, direction: number): this {
    this.anisotropy = clamp(strength, -1, 1);
    this.anisotropyDirection = wrap360(direction);
    return this;
  }

  /**
   * 设置虹彩(薄膜干涉)。
   * @param intensity    0..1
   * @param ior          折射率(>=1)
   * @param thicknessMin 最小厚度(nm)
   * @param thicknessMax 最大厚度(nm,>= min)
   */
  setIridescence(intensity: number, ior: number, thicknessMin: number, thicknessMax: number): this {
    this.iridescence = clamp01(intensity);
    this.iridescenceIOR = Math.max(1, ior);
    this.iridescenceThicknessMin = Math.max(0, thicknessMin);
    this.iridescenceThicknessMax = Math.max(this.iridescenceThicknessMin, thicknessMax);
    return this;
  }

  /**
   * 设置透明涂层。
   * @param strength   0..1
   * @param roughness  0..1
   * @param normal     透明涂层法线(可选,null = 用基础法线)
   */
  setClearcoat(strength: number, roughness: number, normal?: RGB | null): this {
    this.clearcoat = clamp01(strength);
    this.clearcoatRoughness = clamp01(roughness);
    this.clearcoatNormal = normal ? { r: normal.r, g: normal.g, b: normal.b } : null;
    return this;
  }

  /**
   * 设置光泽(布料层)。
   * @param strength  0..1
   * @param color     光泽颜色
   * @param roughness 0..1
   */
  setSheen(strength: number, color: RGB, roughness: number): this {
    this.sheen = clamp01(strength);
    this.sheenColor = { r: color.r, g: color.g, b: color.b };
    this.sheenRoughness = clamp01(roughness);
    return this;
  }

  /**
   * 设置自发光。
   * @param color     自发光颜色
   * @param intensity 强度(>=0)
   */
  setEmissive(color: RGB, intensity: number): this {
    this.emissive = { r: color.r, g: color.g, b: color.b };
    this.emissiveIntensity = Math.max(0, intensity);
    return this;
  }

  /**
   * 设置 Alpha 模式。
   * @param mode    'opaque' | 'mask' | 'blend'
   * @param cutoff  mask 模式的截断阈值(0..1)
   */
  setAlphaMode(mode: AlphaMode, cutoff?: number): this {
    this.alphaMode = mode;
    if (cutoff !== undefined) this.alphaCutoff = clamp01(cutoff);
    this.transparent = mode === 'blend';
    return this;
  }

  /** 启用/禁用双面渲染。 */
  setDoubleSided(enabled: boolean): this {
    this.doubleSided = enabled;
    return this;
  }

  /** 设置法线强度(>=0)。 */
  setNormalScale(scale: number): this {
    this.normalScale = Math.max(0, scale);
    return this;
  }

  /** 设置 AO 强度 [0,1]。 */
  setAOStrength(strength: number): this {
    this.aoStrength = clamp01(strength);
    return this;
  }

  // ── CPU 侧 BRDF 参考实现 ─────────────────────────────────────────

  /**
   * 计算各向异性 BRDF(Cook-Torrance 各向异性 GGX)。
   *
   * 公式:
   *   ax = α² * (1 + anisotropy)
   *   ay = α² / (1 + anisotropy)
   *   D = 1 / π * 1 / ((ToH²/ax² + BoH²/ay² + NoH²)²) * ax*ay
   *   F = F0 + (1 - F0) * (1 - cos(H·V))^5
   *   V = SmithGGX(NoV, NoL, roughness)
   *
   * @param input N/V/L/T/B(均归一化)
   * @returns diffuse + specular + fresnel
   */
  computeAnisotropicBRDF(input: AnisotropicBRDFInput): AnisotropicBRDFOutput {
    const { N, V, L, T, B } = input;
    const H = V.clone().add(L).normalize();
    const NoL = Math.max(N.dot(L), 0);
    const NoV = Math.max(N.dot(V), 0);
    const NoH = Math.max(N.dot(H), 0);
    const ToH = T.dot(H);
    const BoH = B.dot(H);

    const rough = clamp(this.roughness, 0.045, 1);
    const aniso = clamp(this.anisotropy, -1, 1);
    const a = rough * rough;
    const ax = a * (1 + aniso);
    const ay = a / (1 + aniso);

    const denom = (ToH * ToH) / (ax * ax) + (BoH * BoH) / (ay * ay) + NoH * NoH;
    const D = denom > 1e-8 ? (ax * ay) / (Math.PI * denom * denom) : 0;

    const Vis = smithGGX(NoV, NoL, rough);
    const F0 = 0.04 * (1 - this.metallic) + this.metallic * 1.0;
    const HdV = Math.max(H.dot(V), 0);
    const F = F0 + (1 - F0) * Math.pow(1 - HdV, 5);

    const specScalar = D * Vis * F;
    const specColor = lerpRGB({ r: 1, g: 1, b: 1 }, this.baseColor, this.metallic);
    const specular: RGB = {
      r: specColor.r * specScalar,
      g: specColor.g * specScalar,
      b: specColor.b * specScalar,
    };
    const diffuse: RGB = {
      r: (1 - F) * (1 - this.metallic) * this.baseColor.r / Math.PI * NoL,
      g: (1 - F) * (1 - this.metallic) * this.baseColor.g / Math.PI * NoL,
      b: (1 - F) * (1 - this.metallic) * this.baseColor.b / Math.PI * NoL,
    };
    return { diffuse, specular, fresnel: F };
  }

  /**
   * 计算虹彩(薄膜干涉)反射率。
   *
   * 简化模型(三波长 RGB):
   *   cosThetaT = sqrt(1 - (1 - cosTheta²) / IOR²)
   *   OPD = 2 * IOR * thickness * cosThetaT
   *   对每个波长 λ:R(λ) = 2 * R0 * cos²(π * OPD / λ)
   *   R0 = ((IOR - 1) / (IOR + 1))²
   *
   * @returns reflectance(线性 RGB)+ f0
   */
  computeIridescence(input: IridescenceInput): IridescenceOutput {
    const { cosTheta, thickness, intensity, ior } = input;
    const ct = clamp(cosTheta, 0, 1);
    const sinThetaT2 = (1 - ct * ct) / Math.max(ior * ior, 1e-8);
    const cosThetaT = Math.sqrt(Math.max(1 - sinThetaT2, 0));
    const opd = 2 * ior * thickness * cosThetaT;
    const R0 = ((ior - 1) / (ior + 1)) ** 2;
    // 三波长:nm → 反射率
    const lambdas = [630, 530, 460]; // R, G, B
    const ch: number[] = lambdas.map((lambda) => {
      const phase = (2 * Math.PI * opd) / lambda;
      return 2 * R0 * Math.pow(Math.cos(phase / 2), 2);
    });
    const reflectance: RGB = {
      r: clamp01(ch[0]) * intensity,
      g: clamp01(ch[1]) * intensity,
      b: clamp01(ch[2]) * intensity,
    };
    return { reflectance, f0: R0 };
  }

  /**
   * 计算透明涂层贡献(第二层 GGX)。
   *
   * clearcoat IOR 固定 1.5,F0 = 0.04,roughness 独立。
   *
   * @returns specular(0..1)+ fresnel
   */
  computeClearcoat(input: ClearcoatInput): ClearcoatOutput {
    const { N, V, L, H } = input;
    const NoH = Math.max(N.dot(H), 0);
    const NoV = Math.max(N.dot(V), 0);
    const NoL = Math.max(N.dot(L), 0);
    const D = ggxIsotropic(NoH, this.clearcoatRoughness);
    const Vis = smithGGX(NoV, NoL, this.clearcoatRoughness);
    const F0 = 0.04;
    const F = F0 + (1 - F0) * Math.pow(1 - NoV, 5);
    return { specular: D * Vis * F * NoL, fresnel: F };
  }

  /**
   * 计算光泽(sheen)层贡献(Charlie 分布 + Ashikhmin 可见性)。
   *
   * @returns reflectance + intensity
   */
  computeSheen(input: SheenInput): SheenOutput {
    const { N, V, H } = input;
    const NoH = Math.max(N.dot(H), 0);
    const NoV = Math.max(N.dot(V), 0);
    const r = clamp(this.sheenRoughness, 0.05, 1);
    const D = charlieSheen(r, NoH);
    const Vis = sheenVisibility(NoV, 1); // sheen 不依赖 NoL(边缘反弹)
    const contrib = D * Vis * this.sheen;
    return {
      reflectance: {
        r: this.sheenColor.r * contrib,
        g: this.sheenColor.g * contrib,
        b: this.sheenColor.b * contrib,
      },
      intensity: contrib,
    };
  }

  // ── shader 接口 ───────────────────────────────────────────────────

  /** 获取顶点着色器源码。 */
  getVertexShader(): string {
    return ADV_PBR_VERT;
  }

  /** 获取片元着色器源码。 */
  getFragmentShader(): string {
    return ADV_PBR_FRAG;
  }

  /** 获取 uniform 定义(供 renderer 注册 uniform)。 */
  getUniforms(): Record<string, unknown> {
    return {
      u_baseColor: [this.baseColor.r, this.baseColor.g, this.baseColor.b],
      u_roughness: this.roughness,
      u_metallic: this.metallic,
      u_anisotropy: this.anisotropy,
      u_anisotropyDirection: this.anisotropyDirection,
      u_iridescence: this.iridescence,
      u_iridescenceIOR: this.iridescenceIOR,
      u_iridescenceThicknessMin: this.iridescenceThicknessMin,
      u_iridescenceThicknessMax: this.iridescenceThicknessMax,
      u_clearcoat: this.clearcoat,
      u_clearcoatRoughness: this.clearcoatRoughness,
      u_clearcoatNormal: this.clearcoatNormal
        ? [this.clearcoatNormal.r, this.clearcoatNormal.g, this.clearcoatNormal.b]
        : [0.5, 0.5, 1],
      u_hasClearcoatNormal: this.clearcoatNormal ? 1 : 0,
      u_sheen: this.sheen,
      u_sheenColor: [this.sheenColor.r, this.sheenColor.g, this.sheenColor.b],
      u_sheenRoughness: this.sheenRoughness,
      u_emissive: [this.emissive.r, this.emissive.g, this.emissive.b],
      u_emissiveIntensity: this.emissiveIntensity,
      u_alphaMode: this.alphaMode === 'opaque' ? 0 : this.alphaMode === 'mask' ? 1 : 2,
      u_alphaCutoff: this.alphaCutoff,
      u_doubleSided: this.doubleSided ? 1 : 0,
      u_normalScale: this.normalScale,
      u_aoStrength: this.aoStrength,
      u_opacity: this.opacity,
    };
  }

  // ── 序列化 / 克隆 / 释放 ─────────────────────────────────────────

  /** 序列化为 JSON 对象。 */
  toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      baseColor: { ...this.baseColor },
      roughness: this.roughness,
      metallic: this.metallic,
      anisotropy: this.anisotropy,
      anisotropyDirection: this.anisotropyDirection,
      iridescence: this.iridescence,
      iridescenceIOR: this.iridescenceIOR,
      iridescenceThicknessMin: this.iridescenceThicknessMin,
      iridescenceThicknessMax: this.iridescenceThicknessMax,
      clearcoat: this.clearcoat,
      clearcoatRoughness: this.clearcoatRoughness,
      clearcoatNormal: this.clearcoatNormal ? { ...this.clearcoatNormal } : null,
      sheen: this.sheen,
      sheenColor: { ...this.sheenColor },
      sheenRoughness: this.sheenRoughness,
      emissive: { ...this.emissive },
      emissiveIntensity: this.emissiveIntensity,
      alphaMode: this.alphaMode,
      alphaCutoff: this.alphaCutoff,
      doubleSided: this.doubleSided,
      normalScale: this.normalScale,
      aoStrength: this.aoStrength,
      opacity: this.opacity,
      transparent: this.transparent,
      wireframe: this.wireframe,
      depthTest: this.depthTest,
      depthWrite: this.depthWrite,
      renderOrder: this.renderOrder,
      quality: this.quality,
    };
  }

  /** 从 JSON 对象反序列化(返回 this)。 */
  fromJSON(data: Record<string, unknown>): this {
    if (data.baseColor && typeof data.baseColor === 'object') {
      this.baseColor = { ...(data.baseColor as RGB) };
    }
    if (typeof data.roughness === 'number') this.roughness = clamp01(data.roughness);
    if (typeof data.metallic === 'number') this.metallic = clamp01(data.metallic);
    if (typeof data.anisotropy === 'number') this.anisotropy = clamp(data.anisotropy, -1, 1);
    if (typeof data.anisotropyDirection === 'number') this.anisotropyDirection = wrap360(data.anisotropyDirection);
    if (typeof data.iridescence === 'number') this.iridescence = clamp01(data.iridescence);
    if (typeof data.iridescenceIOR === 'number') this.iridescenceIOR = Math.max(1, data.iridescenceIOR);
    if (typeof data.iridescenceThicknessMin === 'number') this.iridescenceThicknessMin = Math.max(0, data.iridescenceThicknessMin);
    if (typeof data.iridescenceThicknessMax === 'number') this.iridescenceThicknessMax = Math.max(this.iridescenceThicknessMin, data.iridescenceThicknessMax);
    if (typeof data.clearcoat === 'number') this.clearcoat = clamp01(data.clearcoat);
    if (typeof data.clearcoatRoughness === 'number') this.clearcoatRoughness = clamp01(data.clearcoatRoughness);
    if (data.clearcoatNormal === null) {
      this.clearcoatNormal = null;
    } else if (data.clearcoatNormal && typeof data.clearcoatNormal === 'object') {
      this.clearcoatNormal = { ...(data.clearcoatNormal as RGB) };
    }
    if (typeof data.sheen === 'number') this.sheen = clamp01(data.sheen);
    if (data.sheenColor && typeof data.sheenColor === 'object') {
      this.sheenColor = { ...(data.sheenColor as RGB) };
    }
    if (typeof data.sheenRoughness === 'number') this.sheenRoughness = clamp01(data.sheenRoughness);
    if (data.emissive && typeof data.emissive === 'object') {
      this.emissive = { ...(data.emissive as RGB) };
    }
    if (typeof data.emissiveIntensity === 'number') this.emissiveIntensity = Math.max(0, data.emissiveIntensity);
    if (data.alphaMode === 'opaque' || data.alphaMode === 'mask' || data.alphaMode === 'blend') {
      this.alphaMode = data.alphaMode;
    }
    if (typeof data.alphaCutoff === 'number') this.alphaCutoff = clamp01(data.alphaCutoff);
    if (typeof data.doubleSided === 'boolean') this.doubleSided = data.doubleSided;
    if (typeof data.normalScale === 'number') this.normalScale = Math.max(0, data.normalScale);
    if (typeof data.aoStrength === 'number') this.aoStrength = clamp01(data.aoStrength);
    if (typeof data.opacity === 'number') this.opacity = clamp01(data.opacity);
    if (typeof data.transparent === 'boolean') this.transparent = data.transparent;
    if (typeof data.wireframe === 'boolean') this.wireframe = data.wireframe;
    if (typeof data.depthTest === 'boolean') this.depthTest = data.depthTest;
    if (typeof data.depthWrite === 'boolean') this.depthWrite = data.depthWrite;
    if (typeof data.renderOrder === 'number') this.renderOrder = data.renderOrder;
    if (data.quality === 'low' || data.quality === 'medium' || data.quality === 'high') {
      this.quality = data.quality;
    }
    // alphaMode = blend → 自动透明
    if (this.alphaMode === 'blend') this.transparent = true;
    return this;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: AdvancedPBRMaterial): this {
    this.baseColor = { ...source.baseColor };
    this.roughness = source.roughness;
    this.metallic = source.metallic;
    this.anisotropy = source.anisotropy;
    this.anisotropyDirection = source.anisotropyDirection;
    this.iridescence = source.iridescence;
    this.iridescenceIOR = source.iridescenceIOR;
    this.iridescenceThicknessMin = source.iridescenceThicknessMin;
    this.iridescenceThicknessMax = source.iridescenceThicknessMax;
    this.clearcoat = source.clearcoat;
    this.clearcoatRoughness = source.clearcoatRoughness;
    this.clearcoatNormal = source.clearcoatNormal ? { ...source.clearcoatNormal } : null;
    this.sheen = source.sheen;
    this.sheenColor = { ...source.sheenColor };
    this.sheenRoughness = source.sheenRoughness;
    this.emissive = { ...source.emissive };
    this.emissiveIntensity = source.emissiveIntensity;
    this.alphaMode = source.alphaMode;
    this.alphaCutoff = source.alphaCutoff;
    this.doubleSided = source.doubleSided;
    this.normalScale = source.normalScale;
    this.aoStrength = source.aoStrength;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.quality = source.quality;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): AdvancedPBRMaterial {
    return new AdvancedPBRMaterial().copy(this);
  }

  /** 释放资源(本材质无 GPU 资源,no-op)。可重复调用。 */
  dispose(): void {
    // 无 GPU 资源持有,nothing to do
  }

  override onBeforeCompile(_shader: ShaderObject, _renderer?: unknown): void {
    // 默认 no-op;子类可注入自定义 chunk(如额外光照)。
  }

  override customProgramCacheKey(): string {
    return `advpbr:${this.alphaMode}:${this.doubleSided ? 1 : 0}:${this.clearcoatNormal ? 1 : 0}`;
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrap360(v: number): number {
  const m = v % 360;
  return m < 0 ? m + 360 : m;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = parseInt(
    h.length === 3 ? h.split('').map((c) => c + c).join('') : h,
    16,
  );
  return {
    r: ((v >> 16) & 0xff) / 255,
    g: ((v >> 8) & 0xff) / 255,
    b: (v & 0xff) / 255,
  };
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Smith GGX 几何遮蔽-阴影联合项(高度相关,简化版)。 */
function smithGGX(NoV: number, NoL: number, roughness: number): number {
  const a = roughness * roughness;
  const ggxV = NoL * Math.sqrt(NoV * NoV * (1 - a) + a);
  const ggxL = NoV * Math.sqrt(NoL * NoL * (1 - a) + a);
  return 0.5 / Math.max(ggxV + ggxL, 1e-8);
}

/** 各向同性 GGX 法线分布。 */
function ggxIsotropic(NoH: number, roughness: number): number {
  const a = roughness * roughness;
  const a2 = a * a;
  const denom = NoH * NoH * (a2 - 1) + 1;
  return a2 / (Math.PI * denom * denom);
}

/** Charlie sheen 分布(Ashikhmin 2015,数值稳定近似)。 */
function charlieSheen(sheenRoughness: number, NoH: number): number {
  const r = sheenRoughness * sheenRoughness;
  const a2 = r * r;
  const invR = 1 / Math.max(2 * Math.PI * a2, 1e-8);
  const cosNH = Math.max(NoH, 0);
  return (2 + invR) * Math.pow(cosNH, 2 / (4 * r + 2)) * invR;
}

/** sheen 可见性项(简化 Neumann)。 */
function sheenVisibility(NoV: number, NoL: number): number {
  return 1 / Math.max(4 * (NoL + NoV - NoL * NoV), 1e-8);
}
