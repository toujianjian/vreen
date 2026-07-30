// SubsurfaceScatteringMaterial — 次表面散射材质(SSS)。
//
// 适用场景:皮肤 / 蜡 / 玉石 / 牛奶 / 大理石 / 叶子等半透明材质。
// 光线进入物体内部,经多次散射后从另一侧透出,产生柔和的"通透感"。
//
// 设计:
//   * 继承 BasicMaterial,与 ToonMaterial / FurMaterial 同级。
//   * 持有 SSS 参数 + Cook-Torrance 镜面项(roughness/metallic 咨询性)。
//   * 着色器:
//       - 顶点:标准 MVP + 传 worldPos / worldNormal / uv
//       - 片段:Lambert 漫反射 + 镜面(GGX 近似)+ SSS 透射
//   * SSS 模型:基于"半透明阴影"近似(d'Eon / Jimenez 简化版),
//     不做完整 BSSRDF 卷积(代价高)。核心公式:
//       - distortion = 沿法线反向偏移光照方向
//       - backLight = pow(saturate(dot(V, -L_distorted)), sssPower)
//         * subsurfaceColor * thickness * translucency
//       - 前向:diffuse * subsurfaceColor * subsurfaceMix
//     该近似在薄壁(耳廓/鼻翼/叶子边缘)处产生明显透射效果。
//   * 三通道 subsurfaceRadius (r/g/b):不同波长散射半径不同(红光散射最远,
//     皮肤透光呈红色),用半径调制透射颜色。
//
// 与 MeshPhysicalMaterial 的区别:
//   * PhysicalMaterial 持有 transmission / thickness / attenuationColor,
//     但那是"薄壁折射"模型(玻璃/水);
//   * SSSMaterial 关注"内部多次散射",半透明阴影近似,适合有机物;
//   * 二者可并存,根据场景选用。
//
// 用法:
//   const mat = new SubsurfaceScatteringMaterial({
//     baseColor: { r: 0.9, g: 0.7, b: 0.6 },
//     subsurfaceColor: { r: 1.0, g: 0.3, b: 0.2 },
//     thickness: 0.5,
//     translucency: 0.8,
//   });
//   mesh.material = mat;

import { BasicMaterial, type RGB, type ShaderObject } from '../Core/Material';
import { Vector3 } from '../Math/Vector3';

export interface SubsurfaceScatteringMaterialOptions {
  /** 基础颜色(线性 0..1,默认浅肤色)。 */
  baseColor?: RGB;
  /** 次表面颜色(透射光颜色,默认红橙)。 */
  subsurfaceColor?: RGB;
  /** 三通道散射半径(0..1,红光通常最大)。 */
  subsurfaceRadius?: RGB;
  /** 次表面混合度 [0,1],0=无 SSS,1=完全 SSS。 */
  subsurfaceMix?: number;
  /** 次表面幂(控制透射衰减锐度,默认 4)。 */
  subsurfacePower?: number;
  /** 次表面扭曲(法线反向偏移量,0..1,默认 0.3)。 */
  subsurfaceDistortion?: number;
  /** 粗糙度 [0,1]。 */
  roughness?: number;
  /** 金属度 [0,1]。 */
  metallic?: number;
  /** 厚度 [0,1],1=厚,0=薄(薄壁透射更明显)。 */
  thickness?: number;
  /** 半透明度 [0,1],控制透射强度。 */
  translucency?: number;
  /** 是否启用 SSS。 */
  sssEnabled?: boolean;
  /** SSS 步进数(透射光线步进,默认 4)。 */
  sssSteps?: number;
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

/** SSS 顶点 shader:输出 worldPos / worldNormal / uv。 */
export const SSS_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/** SSS 片段 shader:Lambert + 镜面 + 次表面散射透射。 */
export const SSS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_baseColor;
uniform vec3  u_subsurfaceColor;
uniform vec3  u_subsurfaceRadius;     // r/g/b 散射半径(调制透射颜色)
uniform float u_subsurfaceMix;        // 0..1
uniform float u_subsurfacePower;      // 透射衰减幂
uniform float u_subsurfaceDistortion; // 法线偏移量 0..1
uniform float u_roughness;
uniform float u_metallic;
uniform float u_thickness;            // 0..1
uniform float u_translucency;         // 0..1
uniform int   u_sssEnabled;           // 0/1
uniform int   u_sssSteps;             // SSS 步进数
uniform float u_opacity;

uniform vec3  u_lightDir;             // 光传播方向
uniform vec3  u_lightColor;
uniform float u_lightIntensity;
uniform vec3  u_ambientColor;
uniform vec3  u_cameraPos;            // 视点位置(用于 V 方向)

// GGX 法线分布函数(简化)
float D_GGX(float NoH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float denom = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * denom * denom);
}

// Schlick 菲涅尔近似
float fresnelSchlick(float cosTheta, float F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(-u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);

  // ── Lambert 漫反射 ──────────────────────────────
  vec3 diffuse = u_baseColor * u_lightColor * u_lightIntensity * NdotL;
  vec3 ambient = u_ambientColor * u_baseColor;

  // ── Cook-Torrance 镜面(简化 GGX) ──────────────
  float F0 = mix(0.04, 1.0, u_metallic);
  float F = fresnelSchlick(NdotV, F0);
  float D = D_GGX(NdotH, u_roughness);
  float specular = D * F * (u_metallic < 1.0 ? 1.0 : 0.0);
  vec3 specularColor = mix(vec3(1.0), u_baseColor, u_metallic) * specular
                     * u_lightColor * u_lightIntensity;

  // ── 次表面散射透射(半透明阴影近似) ────────────
  vec3 sssContribution = vec3(0.0);
  if (u_sssEnabled == 1) {
    // 沿法线反向偏移光照方向(distortion 控制)
    vec3 L_distorted = normalize(L + N * u_subsurfaceDistortion);
    // 计算透射:视线与偏移后光线的对齐度
    float backLight = pow(max(dot(V, -L_distorted), 0.0), u_subsurfacePower);
    // 厚度调制:薄壁更易透射
    float thicknessFactor = 1.0 - u_thickness;
    // 三通道半径调制透射颜色(红光散射更远 → 皮肤透红)
    vec3 radiusColor = u_subsurfaceColor * u_subsurfaceRadius;
    // 多步进近似(简化为步进累加,真实 SSS 会沿光源方向采样多次)
    float stepContribution = backLight * u_translucency * thicknessFactor;
    for (int i = 0; i < 8; i++) {
      if (i >= u_sssSteps) break;
      // 每步衰减(模拟多次散射吸收)
      stepContribution *= 0.85;
    }
    sssContribution = radiusColor * stepContribution * u_lightColor * u_lightIntensity;
    sssContribution *= u_subsurfaceMix;
  }

  // ── 合成 ────────────────────────────────────────
  // 前向 SSS:漫反射中也混入 subsurfaceColor
  vec3 diffuseSSS = mix(diffuse, diffuse * u_subsurfaceColor, u_subsurfaceMix * 0.3);
  vec3 finalColor = ambient + diffuseSSS + specularColor + sssContribution;

  outColor = vec4(finalColor, u_opacity);
}
`;

/**
 * 次表面散射材质 — 适用于皮肤 / 蜡 / 玉石 / 牛奶等半透明材质。
 *
 * 持有 SSS 参数与简化 Cook-Torrance 镜面项。renderer 识别 type === 'SSS'
 * 走 SSS_VERT / SSS_FRAG 程序路径。
 */
export class SubsurfaceScatteringMaterial extends BasicMaterial {
  override readonly type: string = 'SSS';
  /** 标志用于 instanceof 替代检测。 */
  readonly isSubsurfaceScatteringMaterial: boolean = true;

  /** 基础颜色(线性 0..1,默认浅肤色)。 */
  baseColor: RGB = { r: 0.9, g: 0.7, b: 0.6 };
  /** 次表面颜色(透射光颜色,默认红橙 — 皮肤常见色调)。 */
  subsurfaceColor: RGB = { r: 1.0, g: 0.3, b: 0.2 };
  /** 三通道散射半径(0..1,红光通常最大)。 */
  subsurfaceRadius: RGB = { r: 1.0, g: 0.4, b: 0.2 };
  /** 次表面混合度 [0,1]。 */
  subsurfaceMix: number = 0.5;
  /** 次表面幂(透射衰减锐度,默认 4)。 */
  subsurfacePower: number = 4;
  /** 次表面扭曲(法线反向偏移量,0..1,默认 0.3)。 */
  subsurfaceDistortion: number = 0.3;
  /** 粗糙度 [0,1]。 */
  roughness: number = 0.5;
  /** 金属度 [0,1]。 */
  metallic: number = 0;
  /** 厚度 [0,1],1=厚,0=薄。 */
  thickness: number = 0.5;
  /** 半透明度 [0,1]。 */
  translucency: number = 0.5;
  /** 是否启用 SSS。 */
  sssEnabled: boolean = true;
  /** SSS 步进数。 */
  sssSteps: number = 4;

  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 是否透明。 */
  transparent: boolean = false;
  /** 是否双面渲染。 */
  doubleSided: boolean = false;

  constructor(opts: SubsurfaceScatteringMaterialOptions = {}) {
    super();
    if (opts.baseColor) this.baseColor = { ...opts.baseColor };
    if (opts.subsurfaceColor) this.subsurfaceColor = { ...opts.subsurfaceColor };
    if (opts.subsurfaceRadius) this.subsurfaceRadius = { ...opts.subsurfaceRadius };
    if (opts.subsurfaceMix !== undefined) this.subsurfaceMix = opts.subsurfaceMix;
    if (opts.subsurfacePower !== undefined) this.subsurfacePower = opts.subsurfacePower;
    if (opts.subsurfaceDistortion !== undefined) this.subsurfaceDistortion = opts.subsurfaceDistortion;
    if (opts.roughness !== undefined) this.roughness = opts.roughness;
    if (opts.metallic !== undefined) this.metallic = opts.metallic;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.translucency !== undefined) this.translucency = opts.translucency;
    if (opts.sssEnabled !== undefined) this.sssEnabled = opts.sssEnabled;
    if (opts.sssSteps !== undefined) this.sssSteps = opts.sssSteps;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.doubleSided !== undefined) this.doubleSided = opts.doubleSided;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
  }

  /** Convenience constructor: 从 hex 颜色构造基础颜色。 */
  static fromHex(hex: string): SubsurfaceScatteringMaterial {
    return new SubsurfaceScatteringMaterial({ baseColor: hexToRgb(hex) });
  }

  // ── setter ────────────────────────────────────────────

  /** 设置基础颜色。 */
  setBaseColor(color: RGB): this {
    this.baseColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置次表面颜色。 */
  setSubsurfaceColor(color: RGB): this {
    this.subsurfaceColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置三通道散射半径。 */
  setSubsurfaceRadius(r: number, g: number, b: number): this {
    this.subsurfaceRadius = { r, g, b };
    return this;
  }

  /** 设置次表面混合度 [0,1]。 */
  setSubsurfaceMix(mix: number): this {
    this.subsurfaceMix = clamp01(mix);
    return this;
  }

  /** 设置次表面幂(>=1)。 */
  setSubsurfacePower(power: number): this {
    this.subsurfacePower = Math.max(1, power);
    return this;
  }

  /** 设置次表面扭曲 [0,1]。 */
  setSubsurfaceDistortion(distortion: number): this {
    this.subsurfaceDistortion = clamp01(distortion);
    return this;
  }

  /** 设置粗糙度 [0,1]。 */
  setRoughness(roughness: number): this {
    this.roughness = clamp01(roughness);
    return this;
  }

  /** 设置金属度 [0,1]。 */
  setMetallic(metallic: number): this {
    this.metallic = clamp01(metallic);
    return this;
  }

  /** 设置厚度 [0,1]。 */
  setThickness(thickness: number): this {
    this.thickness = clamp01(thickness);
    return this;
  }

  /** 设置半透明度 [0,1]。 */
  setTranslucency(translucency: number): this {
    this.translucency = clamp01(translucency);
    return this;
  }

  /** 启用/禁用 SSS。 */
  enableSSS(enabled: boolean): this {
    this.sssEnabled = enabled;
    return this;
  }

  /** 设置 SSS 步进数(1..8)。 */
  setSSSSteps(steps: number): this {
    this.sssSteps = Math.max(1, Math.min(8, Math.floor(steps)));
    return this;
  }

  // ── 计算 ──────────────────────────────────────────────

  /**
   * 计算次表面散射透射贡献(CPU 侧参考实现,与 GLSL 片段一致)。
   *
   * @param position   采样点(世界空间,用于基于位置的厚度微扰)
   * @param normal     表面法线(归一化)
   * @param lightDir   光传播方向(指向光源的反向,即指向光)
   * @param thickness  该点厚度 [0,1](可由厚度图采样)
   * @returns SSS 透射颜色(0..1+)
   */
  computeSSS(
    position: Vector3,
    normal: Vector3,
    lightDir: Vector3,
    thickness: number,
  ): RGB {
    if (!this.sssEnabled) return { r: 0, g: 0, b: 0 };
    // L:指向光源(注意 lightDir 传入约定 — 这里假设 lightDir 已指向光源)
    const L = lightDir.clone().normalize();
    const N = normal.clone().normalize();
    // 视线方向:简化为 -N(面向法线的观察者),CPU 参考实现不依赖相机
    const V = N.clone().multiplyScalar(-1);
    // 偏移后的光照方向:沿法线反向偏移
    const Ld = L.clone().add(N.clone().multiplyScalar(this.subsurfaceDistortion)).normalize();
    // backLight:视线与偏移后光线对齐度
    const backLight = Math.pow(Math.max(V.clone().multiplyScalar(-1).dot(Ld), 0), this.subsurfacePower);
    // 基于位置的厚度微扰(模拟物体不同部位厚度差异,如耳廓比耳根薄)
    // 使用低频正弦扰动,幅度 ±0.1,避免完全覆盖输入 thickness
    const positionalMod = 0.1 * Math.sin(position.x * 0.7 + position.y * 0.5 + position.z * 0.3);
    const effectiveThickness = clamp01(thickness + positionalMod);
    // 厚度调制:薄壁更易透射
    const thicknessFactor = 1 - effectiveThickness;
    // 三通道半径调制
    const radiusColor = {
      r: this.subsurfaceColor.r * this.subsurfaceRadius.r,
      g: this.subsurfaceColor.g * this.subsurfaceRadius.g,
      b: this.subsurfaceColor.b * this.subsurfaceRadius.b,
    };
    // 多步进衰减
    let stepContribution = backLight * this.translucency * thicknessFactor;
    for (let i = 0; i < this.sssSteps; i++) {
      stepContribution *= 0.85;
    }
    return {
      r: radiusColor.r * stepContribution * this.subsurfaceMix,
      g: radiusColor.g * stepContribution * this.subsurfaceMix,
      b: radiusColor.b * stepContribution * this.subsurfaceMix,
    };
  }

  /** 获取顶点着色器源码。 */
  getVertexShader(): string {
    return SSS_VERT;
  }

  /** 获取片段着色器源码。 */
  getFragmentShader(): string {
    return SSS_FRAG;
  }

  /** 获取 uniform 定义(供 renderer 注册 uniform)。 */
  getUniforms(): Record<string, unknown> {
    return {
      u_baseColor: [this.baseColor.r, this.baseColor.g, this.baseColor.b],
      u_subsurfaceColor: [this.subsurfaceColor.r, this.subsurfaceColor.g, this.subsurfaceColor.b],
      u_subsurfaceRadius: [this.subsurfaceRadius.r, this.subsurfaceRadius.g, this.subsurfaceRadius.b],
      u_subsurfaceMix: this.subsurfaceMix,
      u_subsurfacePower: this.subsurfacePower,
      u_subsurfaceDistortion: this.subsurfaceDistortion,
      u_roughness: this.roughness,
      u_metallic: this.metallic,
      u_thickness: this.thickness,
      u_translucency: this.translucency,
      u_sssEnabled: this.sssEnabled ? 1 : 0,
      u_sssSteps: this.sssSteps,
      u_opacity: this.opacity,
    };
  }

  // ── 序列化 / 克隆 / 释放 ─────────────────────────────

  /** 序列化为 JSON 对象。 */
  toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      baseColor: { ...this.baseColor },
      subsurfaceColor: { ...this.subsurfaceColor },
      subsurfaceRadius: { ...this.subsurfaceRadius },
      subsurfaceMix: this.subsurfaceMix,
      subsurfacePower: this.subsurfacePower,
      subsurfaceDistortion: this.subsurfaceDistortion,
      roughness: this.roughness,
      metallic: this.metallic,
      thickness: this.thickness,
      translucency: this.translucency,
      sssEnabled: this.sssEnabled,
      sssSteps: this.sssSteps,
      opacity: this.opacity,
      transparent: this.transparent,
      doubleSided: this.doubleSided,
      wireframe: this.wireframe,
      depthTest: this.depthTest,
      depthWrite: this.depthWrite,
      renderOrder: this.renderOrder,
    };
  }

  /** 从 JSON 对象反序列化(返回 this)。 */
  fromJSON(data: Record<string, unknown>): this {
    if (data.baseColor && typeof data.baseColor === 'object') {
      this.baseColor = { ...(data.baseColor as RGB) };
    }
    if (data.subsurfaceColor && typeof data.subsurfaceColor === 'object') {
      this.subsurfaceColor = { ...(data.subsurfaceColor as RGB) };
    }
    if (data.subsurfaceRadius && typeof data.subsurfaceRadius === 'object') {
      this.subsurfaceRadius = { ...(data.subsurfaceRadius as RGB) };
    }
    if (typeof data.subsurfaceMix === 'number') this.subsurfaceMix = clamp01(data.subsurfaceMix);
    if (typeof data.subsurfacePower === 'number') this.subsurfacePower = Math.max(1, data.subsurfacePower);
    if (typeof data.subsurfaceDistortion === 'number') this.subsurfaceDistortion = clamp01(data.subsurfaceDistortion);
    if (typeof data.roughness === 'number') this.roughness = clamp01(data.roughness);
    if (typeof data.metallic === 'number') this.metallic = clamp01(data.metallic);
    if (typeof data.thickness === 'number') this.thickness = clamp01(data.thickness);
    if (typeof data.translucency === 'number') this.translucency = clamp01(data.translucency);
    if (typeof data.sssEnabled === 'boolean') this.sssEnabled = data.sssEnabled;
    if (typeof data.sssSteps === 'number') this.sssSteps = Math.max(1, Math.min(8, Math.floor(data.sssSteps)));
    if (typeof data.opacity === 'number') this.opacity = data.opacity;
    if (typeof data.transparent === 'boolean') this.transparent = data.transparent;
    if (typeof data.doubleSided === 'boolean') this.doubleSided = data.doubleSided;
    if (typeof data.wireframe === 'boolean') this.wireframe = data.wireframe;
    if (typeof data.depthTest === 'boolean') this.depthTest = data.depthTest;
    if (typeof data.depthWrite === 'boolean') this.depthWrite = data.depthWrite;
    if (typeof data.renderOrder === 'number') this.renderOrder = data.renderOrder;
    return this;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: SubsurfaceScatteringMaterial): this {
    this.baseColor = { ...source.baseColor };
    this.subsurfaceColor = { ...source.subsurfaceColor };
    this.subsurfaceRadius = { ...source.subsurfaceRadius };
    this.subsurfaceMix = source.subsurfaceMix;
    this.subsurfacePower = source.subsurfacePower;
    this.subsurfaceDistortion = source.subsurfaceDistortion;
    this.roughness = source.roughness;
    this.metallic = source.metallic;
    this.thickness = source.thickness;
    this.translucency = source.translucency;
    this.sssEnabled = source.sssEnabled;
    this.sssSteps = source.sssSteps;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.doubleSided = source.doubleSided;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): SubsurfaceScatteringMaterial {
    return new SubsurfaceScatteringMaterial().copy(this);
  }

  /** 释放资源(本材质无 GPU 资源,no-op)。可重复调用。 */
  dispose(): void {
    // 无 GPU 资源持有,nothing to do
  }

  override onBeforeCompile(_shader: ShaderObject, _renderer?: unknown): void {
    // 默认 no-op;子类可注入自定义 chunk(如额外光照)。
  }

  override customProgramCacheKey(): string {
    return 'sss';
  }
}

// ── 工具函数 ─────────────────────────────────────────────

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
