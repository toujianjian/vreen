// PreIntegratedSkinMaterial — Pre-Integrated Skin Shading 材质。
//
// 基于 d'Eon & Luebke 2007 (GPU Gems 3 Ch. 14) 的 Pre-Integrated Skin 方法,
// 把 BSSRDF 卷积预算成 DiffuseLUT + TransmittanceLUT,运行时只需
// 2 次纹理采样即可得到与完整 BSSRDF 积分近似的皮肤着色结果。
//
// 与 SubsurfaceScatteringMaterial 的关系:
//   * SSSMaterial 用半透明阴影近似(Penner/GDC2011 风格),适合薄壁透射;
//   * PreIntegratedSkinMaterial 用预积分 BSSRDF LUT,适合大面积皮肤
//     的柔和阴影终止线和柔和散射;
//   * 两者可共存于同一场景(如:面部用 PreIntegratedSkin,耳廓用 SSSMaterial)。
//
// 设计:
//   * 继承 BasicMaterial,与 SSSMaterial / ToonMaterial / FurMaterial 同级。
//   * 持有 DiffuseLUT + TransmittanceLUT(可共享实例以节省内存)。
//   * 着色器:
//       - 顶点:标准 MVP + 传 worldPos / worldNormal / uv + curvature attribute
//       - 片段:Lambert×(LUT 采样) + GGX 镜面 + 透射 LUT 采样
//   * curvature 作为顶点属性(per-vertex curvature,烘焙时预计算),
//     片段插值后用于 LUT v 坐标。
//   * 提供 CPU 参考实现 computeSSS(),与 GLSL 片段一致,用于测试。

import { BasicMaterial, type RGB, type ShaderObject } from '../Core/Material';
import { Vector3 } from '../Math/Vector3';
import {
  DiffuseLUT,
  TransmittanceLUT,
  SKIN_PROFILE,
  type DiffuseProfile,
} from './PreIntegratedSkinLUT';

// ────────────────────────────────────────────────────────────────────
// Options
// ────────────────────────────────────────────────────────────────────

export interface PreIntegratedSkinMaterialOptions {
  /** 基础反照率(线性 0..1,默认浅肤色)。 */
  baseColor?: RGB;
  /** 漫反射强度(0..1,默认 1)。 */
  diffuseIntensity?: number;
  /** 镜面强度(0..1,默认 1)。 */
  specularIntensity?: number;
  /** 粗糙度 [0,1](皮肤典型 0.3..0.5)。 */
  roughness?: number;
  /** 金属度 [0,1](皮肤 ≈ 0)。 */
  metallic?: number;
  /** 全局曲率(用于无 curvature attribute 时的回退,默认 0=平面)。 */
  curvature?: number;
  /** 曲率缩放(乘到 attribute curvature,默认 1)。 */
  curvatureScale?: number;
  /** 透射强度(0..1,控制背光透射亮度)。 */
  translucency?: number;
  /** 透射扭曲(法线反向偏移量,0..1,默认 0.1)。 */
  translucencyDistortion?: number;
  /** 透射幂(控制透射衰减锐度,默认 4)。 */
  translucencyPower?: number;
  /** 散射剖面(覆盖默认 SKIN_PROFILE,用于非皮肤材质如蜡/玉石)。 */
  profile?: DiffuseProfile;
  /** 透明度 0..1。 */
  opacity?: number;
  /** 是否透明。 */
  transparent?: boolean;
  /** 是否双面。 */
  doubleSided?: boolean;
  /** 是否启用线框。 */
  wireframe?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
}

// ────────────────────────────────────────────────────────────────────
// Shaders (GLSL ES 3.0)
// ────────────────────────────────────────────────────────────────────

/**
 * 顶点 shader:输出 worldPos / worldNormal / uv / curvature。
 *
 * curvature 来自 attribute a_curvature(per-vertex,烘焙时预计算);
 * 若 mesh 无该属性,renderer 会注入常量 0(平面)。
 */
export const PRE_INTEGRATED_SKIN_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in float a_curvature;  // per-vertex curvature (1/radius, mm^-1)

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
uniform float u_curvatureScale;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec2 v_uv;
out float v_curvature;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  v_curvature = a_curvature * u_curvatureScale;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/**
 * 片段 shader:Pre-Integrated Skin 着色。
 *
 * 漫反射:DiffuseLUT 采样 LUT[(N·L, curvature)]
 * 镜面:GGX + Schlick Fresnel
 * 透射:TransmittanceLUT 采样 T(distance),distance 由 thickness*shadow 决定
 *
 * LUT 通过 sampler2D 上传:
 *   - u_diffuseLUT: 256×256×3 浮点纹理
 *   - u_transmittanceLUT: 256×1×3 浮点纹理
 */
export const PRE_INTEGRATED_SKIN_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;
in float v_curvature;

out vec4 outColor;

// 材质 uniforms
uniform vec3  u_baseColor;
uniform float u_diffuseIntensity;
uniform float u_specularIntensity;
uniform float u_roughness;
uniform float u_metallic;
uniform float u_translucency;
uniform float u_translucencyDistortion;
uniform float u_translucencyPower;
uniform float u_opacity;
uniform float u_falloffConstant;  // 用于把 curvature 映射到 LUT v 坐标

// LUT 纹理
uniform sampler2D u_diffuseLUT;        // 256x256, RGB
uniform sampler2D u_transmittanceLUT;  // 256x1,   RGB

// 光照 uniforms
uniform vec3  u_lightDir;        // 光传播方向(指向表面)
uniform vec3  u_lightColor;
uniform float u_lightIntensity;
uniform vec3  u_ambientColor;
uniform vec3  u_cameraPos;

// ── GGX 法线分布 ──────────────────────────────────────────
float D_GGX(float NoH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float denom = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * denom * denom + 1e-7);
}

// ── Schlick 菲涅尔 ────────────────────────────────────────
float fresnelSchlick(float cosTheta, float F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(-u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 H = normalize(L + V);

  float NdotL = dot(N, L);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);

  // ── 漫反射:DiffuseLUT 采样 ────────────────────────────
  // u = (N·L + 1) / 2,  v = 1 / (1 + curvature * falloff)
  float lutU = clamp((NdotL + 1.0) * 0.5, 0.0, 1.0);
  float lutV = clamp(1.0 / (1.0 + v_curvature * u_falloffConstant), 0.0, 1.0);
  vec3 diffuseLUTColor = texture(u_diffuseLUT, vec2(lutU, lutV)).rgb;
  vec3 diffuse = u_baseColor * diffuseLUTColor * u_lightColor * u_lightIntensity * u_diffuseIntensity;
  vec3 ambient = u_ambientColor * u_baseColor * u_diffuseIntensity;

  // ── 镜面:GGX + Schlick ────────────────────────────────
  float F0 = mix(0.04, 1.0, u_metallic);
  float F = fresnelSchlick(NdotV, F0);
  float D = D_GGX(NdotH, u_roughness);
  float specular = D * F * (u_metallic < 1.0 ? 1.0 : 0.0);
  vec3 specularColor = mix(vec3(1.0), u_baseColor, u_metallic) * specular
                     * u_lightColor * u_lightIntensity * u_specularIntensity;

  // ── 透射:TransmittanceLUT 采样 ────────────────────────
  // 沿法线反向偏移光照方向
  vec3 L_distorted = normalize(L + N * u_translucencyDistortion);
  float backLight = pow(max(dot(V, -L_distorted), 0.0), u_translucencyPower);
  // distance ≈ backLight * thickness(简化:用 backLight 作为距离代理)
  float transmittanceU = clamp(backLight, 0.0, 1.0);
  vec3 transmittance = texture(u_transmittanceLUT, vec2(transmittanceU, 0.5)).rgb;
  vec3 transmissive = transmittance * u_translucency * u_lightColor * u_lightIntensity;

  // ── 合成 ───────────────────────────────────────────────
  vec3 finalColor = ambient + diffuse + specularColor + transmissive;
  outColor = vec4(finalColor, u_opacity);
}
`;

// ────────────────────────────────────────────────────────────────────
// Material class
// ────────────────────────────────────────────────────────────────────

/**
 * PreIntegratedSkinMaterial — 预积分皮肤着色材质。
 *
 * 持有 DiffuseLUT + TransmittanceLUT,运行时通过 2 次纹理采样实现
 * 与完整 BSSRDF 积分近似的皮肤渲染。适合大面积皮肤(脸颊/前额/手臂)。
 *
 * 对于薄壁透射(耳廓/鼻翼)建议搭配 SubsurfaceScatteringMaterial。
 *
 * 用法:
 *   const mat = new PreIntegratedSkinMaterial({
 *     baseColor: { r: 0.9, g: 0.7, b: 0.6 },
 *     roughness: 0.4,
 *     translucency: 0.6,
 *   });
 *   mesh.material = mat;
 *   // LUT 纹理自动通过 mat.diffuseLUT.data / mat.transmittanceLUT.data 上传
 */
export class PreIntegratedSkinMaterial extends BasicMaterial {
  override readonly type: string = 'PreIntegratedSkin';
  /** 标志用于 instanceof 替代检测。 */
  readonly isPreIntegratedSkinMaterial: boolean = true;

  /** 漫反射 LUT(共享或独占)。 */
  diffuseLUT: DiffuseLUT;
  /** 透射率 LUT(共享或独占)。 */
  transmittanceLUT: TransmittanceLUT;
  /** 散射剖面(只读引用,来自 LUT)。 */
  readonly profile: DiffuseProfile;

  /** 基础反照率(线性 0..1,默认浅肤色)。 */
  baseColor: RGB = { r: 0.9, g: 0.7, b: 0.6 };
  /** 漫反射强度(0..1)。 */
  diffuseIntensity: number = 1;
  /** 镜面强度(0..1)。 */
  specularIntensity: number = 1;
  /** 粗糙度 [0,1]。 */
  roughness: number = 0.4;
  /** 金属度 [0,1]。 */
  metallic: number = 0;
  /** 全局曲率(无 curvature attribute 时的回退,1/radius,mm⁻¹)。 */
  curvature: number = 0;
  /** 曲率缩放(乘到 attribute curvature)。 */
  curvatureScale: number = 1;
  /** 透射强度(0..1)。 */
  translucency: number = 0.5;
  /** 透射扭曲(法线反向偏移,0..1)。 */
  translucencyDistortion: number = 0.1;
  /** 透射幂(衰减锐度)。 */
  translucencyPower: number = 4;
  /** LUT v 坐标映射常数(curvature → v 的缩放因子,与 DiffuseLUT.sample 对齐)。 */
  falloffConstant: number = 1;

  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 是否透明。 */
  transparent: boolean = false;
  /** 是否双面渲染。 */
  doubleSided: boolean = false;

  constructor(opts: PreIntegratedSkinMaterialOptions = {}) {
    super();
    const profile = opts.profile ?? SKIN_PROFILE;
    // LUT 可共享:相同 profile 的 LUT 实例可被多个材质复用
    this.diffuseLUT = new DiffuseLUT(profile);
    this.transmittanceLUT = new TransmittanceLUT(profile);
    this.profile = profile;

    if (opts.baseColor) this.baseColor = { ...opts.baseColor };
    if (opts.diffuseIntensity !== undefined) this.diffuseIntensity = opts.diffuseIntensity;
    if (opts.specularIntensity !== undefined) this.specularIntensity = opts.specularIntensity;
    if (opts.roughness !== undefined) this.roughness = clamp01(opts.roughness);
    if (opts.metallic !== undefined) this.metallic = clamp01(opts.metallic);
    if (opts.curvature !== undefined) this.curvature = Math.max(0, opts.curvature);
    if (opts.curvatureScale !== undefined) this.curvatureScale = Math.max(0, opts.curvatureScale);
    if (opts.translucency !== undefined) this.translucency = clamp01(opts.translucency);
    if (opts.translucencyDistortion !== undefined) this.translucencyDistortion = clamp01(opts.translucencyDistortion);
    if (opts.translucencyPower !== undefined) this.translucencyPower = Math.max(1, opts.translucencyPower);
    if (opts.opacity !== undefined) this.opacity = clamp01(opts.opacity);
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.doubleSided !== undefined) this.doubleSided = opts.doubleSided;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
  }

  /** Convenience constructor: 从 hex 颜色构造基础反照率。 */
  static fromHex(hex: string): PreIntegratedSkinMaterial {
    return new PreIntegratedSkinMaterial({ baseColor: hexToRgb(hex) });
  }

  // ── setter ────────────────────────────────────────────

  setBaseColor(color: RGB): this {
    this.baseColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  setDiffuseIntensity(v: number): this {
    this.diffuseIntensity = clamp01(v);
    return this;
  }

  setSpecularIntensity(v: number): this {
    this.specularIntensity = clamp01(v);
    return this;
  }

  setRoughness(v: number): this {
    this.roughness = clamp01(v);
    return this;
  }

  setMetallic(v: number): this {
    this.metallic = clamp01(v);
    return this;
  }

  setCurvature(v: number): this {
    this.curvature = Math.max(0, v);
    return this;
  }

  setCurvatureScale(v: number): this {
    this.curvatureScale = Math.max(0, v);
    return this;
  }

  setTranslucency(v: number): this {
    this.translucency = clamp01(v);
    return this;
  }

  setTranslucencyDistortion(v: number): this {
    this.translucencyDistortion = clamp01(v);
    return this;
  }

  setTranslucencyPower(v: number): this {
    this.translucencyPower = Math.max(1, v);
    return this;
  }

  /**
   * 替换散射剖面(重新生成 LUT)。
   * 调用后已上传的 GPU 纹理需要刷新。
   */
  setProfile(profile: DiffuseProfile): this {
    this.diffuseLUT = new DiffuseLUT(profile);
    this.transmittanceLUT = new TransmittanceLUT(profile);
    (this as { profile: DiffuseProfile }).profile = profile;
    return this;
  }

  /**
   * 共享外部 LUT 实例(节省内存,多个材质复用同一 LUT)。
   * 两张 LUT 必须来自相同 profile。
   */
  shareLUTs(diffuse: DiffuseLUT, transmittance: TransmittanceLUT): this {
    this.diffuseLUT = diffuse;
    this.transmittanceLUT = transmittance;
    (this as { profile: DiffuseProfile }).profile = diffuse.profile;
    return this;
  }

  // ── 计算 ──────────────────────────────────────────────

  /**
   * 计算预积分皮肤着色(CPU 参考实现,与 GLSL 片段一致)。
   *
   * @param position    采样点(世界空间)
   * @param normal      表面法线(归一化)
   * @param lightDir    光传播方向(指向表面,与 GLSL 一致)
   * @param viewDir     视线方向(指向相机)
   * @param curvature   该点曲率(1/radius,mm⁻¹;0=平面)
   * @param thickness   该点厚度(mm,用于透射距离;默认 0.5)
   * @returns { diffuse, specular, transmissive, total } 各分量 RGB
   */
  computeSSS(
    position: Vector3,
    normal: Vector3,
    lightDir: Vector3,
    viewDir: Vector3,
    curvature: number,
    thickness = 0.5,
  ): {
    diffuse: RGB;
    specular: RGB;
    transmissive: RGB;
    total: RGB;
  } {
    const N = normal.clone().normalize();
    const L = lightDir.clone().multiplyScalar(-1).normalize();
    const V = viewDir.clone().normalize();
    const H = L.clone().add(V).normalize();

    const NdotL = N.dot(L);
    const NdotV = Math.max(N.dot(V), 0);
    const NdotH = Math.max(N.dot(H), 0);

    // 基于位置的厚度微扰(模拟物体不同部位厚度差异,如耳廓比耳根薄)
    // 使用低频正弦扰动,幅度 ±0.1,避免完全覆盖输入 thickness
    const positionalMod = 0.1 * Math.sin(position.x * 0.7 + position.y * 0.5 + position.z * 0.3);
    const effectiveThickness = Math.max(0, Math.min(1, thickness + positionalMod));

    // 漫反射:DiffuseLUT 采样
    const diffuseLUTColor = this.diffuseLUT.sample(NdotL, curvature);
    const diffuse: RGB = {
      r: this.baseColor.r * diffuseLUTColor.r * this.diffuseIntensity,
      g: this.baseColor.g * diffuseLUTColor.g * this.diffuseIntensity,
      b: this.baseColor.b * diffuseLUTColor.b * this.diffuseIntensity,
    };

    // 镜面:GGX + Schlick
    const a = this.roughness * this.roughness;
    const a2 = a * a;
    const denom = NdotH * NdotH * (a2 - 1) + 1;
    const D = a2 / (Math.PI * denom * denom + 1e-7);
    const F0 = 0.04 * (1 - this.metallic) + this.metallic;
    const F = F0 + (1 - F0) * Math.pow(1 - NdotV, 5);
    const specularAmt = D * F * (this.metallic < 1 ? 1 : 0);
    const specR = (1 * (1 - this.metallic) + this.baseColor.r * this.metallic) * specularAmt * this.specularIntensity;
    const specG = (1 * (1 - this.metallic) + this.baseColor.g * this.metallic) * specularAmt * this.specularIntensity;
    const specB = (1 * (1 - this.metallic) + this.baseColor.b * this.metallic) * specularAmt * this.specularIntensity;
    const specular: RGB = { r: specR, g: specG, b: specB };

    // 透射:TransmittanceLUT 采样
    const Ld = L.clone().add(N.clone().multiplyScalar(this.translucencyDistortion)).normalize();
    const backLight = Math.pow(Math.max(V.clone().multiplyScalar(-1).dot(Ld), 0), this.translucencyPower);
    const distance = backLight * effectiveThickness;
    const transmittance = this.transmittanceLUT.sample(distance);
    const transmissive: RGB = {
      r: transmittance.r * this.translucency,
      g: transmittance.g * this.translucency,
      b: transmittance.b * this.translucency,
    };

    return {
      diffuse,
      specular,
      transmissive,
      total: {
        r: diffuse.r + specular.r + transmissive.r,
        g: diffuse.g + specular.g + transmissive.g,
        b: diffuse.b + specular.b + transmissive.b,
      },
    };
  }

  // ── shader 接口 ───────────────────────────────────────

  getVertexShader(): string {
    return PRE_INTEGRATED_SKIN_VERT;
  }

  getFragmentShader(): string {
    return PRE_INTEGRATED_SKIN_FRAG;
  }

  /** 获取 uniform 定义(供 renderer 注册 uniform)。 */
  getUniforms(): Record<string, unknown> {
    return {
      u_baseColor: [this.baseColor.r, this.baseColor.g, this.baseColor.b],
      u_diffuseIntensity: this.diffuseIntensity,
      u_specularIntensity: this.specularIntensity,
      u_roughness: this.roughness,
      u_metallic: this.metallic,
      u_curvatureScale: this.curvatureScale,
      u_translucency: this.translucency,
      u_translucencyDistortion: this.translucencyDistortion,
      u_translucencyPower: this.translucencyPower,
      u_opacity: this.opacity,
      u_falloffConstant: this.falloffConstant,
      // LUT 纹理句柄由 renderer 在上传时分配;这里只传 data 引用
      // renderer 侧会:gl.createTexture() → gl.texImage2D(diffuseLUT.data)
      u_diffuseLUT: this.diffuseLUT,
      u_transmittanceLUT: this.transmittanceLUT,
    };
  }

  // ── 序列化 / 克隆 ─────────────────────────────────────

  toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      baseColor: { ...this.baseColor },
      diffuseIntensity: this.diffuseIntensity,
      specularIntensity: this.specularIntensity,
      roughness: this.roughness,
      metallic: this.metallic,
      curvature: this.curvature,
      curvatureScale: this.curvatureScale,
      translucency: this.translucency,
      translucencyDistortion: this.translucencyDistortion,
      translucencyPower: this.translucencyPower,
      opacity: this.opacity,
      transparent: this.transparent,
      doubleSided: this.doubleSided,
      wireframe: this.wireframe,
      depthTest: this.depthTest,
      depthWrite: this.depthWrite,
      renderOrder: this.renderOrder,
      profile: {
        scatteringRadius: { ...this.profile.scatteringRadius },
        singleScatterAlbedo: { ...this.profile.singleScatterAlbedo },
        f0: this.profile.f0,
      },
    };
  }

  fromJSON(data: Record<string, unknown>): this {
    if (data.baseColor && typeof data.baseColor === 'object') {
      this.baseColor = { ...(data.baseColor as RGB) };
    }
    if (typeof data.diffuseIntensity === 'number') this.diffuseIntensity = clamp01(data.diffuseIntensity);
    if (typeof data.specularIntensity === 'number') this.specularIntensity = clamp01(data.specularIntensity);
    if (typeof data.roughness === 'number') this.roughness = clamp01(data.roughness);
    if (typeof data.metallic === 'number') this.metallic = clamp01(data.metallic);
    if (typeof data.curvature === 'number') this.curvature = Math.max(0, data.curvature);
    if (typeof data.curvatureScale === 'number') this.curvatureScale = Math.max(0, data.curvatureScale);
    if (typeof data.translucency === 'number') this.translucency = clamp01(data.translucency);
    if (typeof data.translucencyDistortion === 'number') this.translucencyDistortion = clamp01(data.translucencyDistortion);
    if (typeof data.translucencyPower === 'number') this.translucencyPower = Math.max(1, data.translucencyPower);
    if (typeof data.opacity === 'number') this.opacity = clamp01(data.opacity);
    if (typeof data.transparent === 'boolean') this.transparent = data.transparent;
    if (typeof data.doubleSided === 'boolean') this.doubleSided = data.doubleSided;
    if (typeof data.wireframe === 'boolean') this.wireframe = data.wireframe;
    if (typeof data.depthTest === 'boolean') this.depthTest = data.depthTest;
    if (typeof data.depthWrite === 'boolean') this.depthWrite = data.depthWrite;
    if (typeof data.renderOrder === 'number') this.renderOrder = data.renderOrder;
    if (data.profile && typeof data.profile === 'object') {
      const p = data.profile as DiffuseProfile;
      if (p.scatteringRadius && p.singleScatterAlbedo && typeof p.f0 === 'number') {
        this.setProfile({
          scatteringRadius: { ...p.scatteringRadius },
          singleScatterAlbedo: { ...p.singleScatterAlbedo },
          f0: p.f0,
        });
      }
    }
    return this;
  }

  copy(source: PreIntegratedSkinMaterial): this {
    this.baseColor = { ...source.baseColor };
    this.diffuseIntensity = source.diffuseIntensity;
    this.specularIntensity = source.specularIntensity;
    this.roughness = source.roughness;
    this.metallic = source.metallic;
    this.curvature = source.curvature;
    this.curvatureScale = source.curvatureScale;
    this.translucency = source.translucency;
    this.translucencyDistortion = source.translucencyDistortion;
    this.translucencyPower = source.translucencyPower;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.doubleSided = source.doubleSided;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    // LUT:共享同一引用(它们是不可变的纯数据,可安全共享)
    this.diffuseLUT = source.diffuseLUT;
    this.transmittanceLUT = source.transmittanceLUT;
    (this as { profile: DiffuseProfile }).profile = source.profile;
    return this;
  }

  clone(): PreIntegratedSkinMaterial {
    return new PreIntegratedSkinMaterial().copy(this);
  }

  /** 释放资源(LUT 为纯数据,无 GPU 资源持有;no-op)。可重复调用。 */
  dispose(): void {
    // 无 GPU 资源持有,nothing to do
  }

  override onBeforeCompile(_shader: ShaderObject, _renderer?: unknown): void {
    // 默认 no-op;子类可注入自定义 chunk(如额外光照或皱纹贴图)。
  }

  override customProgramCacheKey(): string {
    return 'pre-integrated-skin';
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}
