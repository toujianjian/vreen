// WaterMaterial — 水面材质。
//
// 参考 three.js Water(简化版)+ 自定义水面 shader。基于:
//   - 法线扰动:用 normalMap + 时间偏移模拟波纹
//   - 菲涅尔反射:用 reflectionMap + 视角相关系数控制反射强度
//   - 高光:Blinn-Phong 镜面项受 sunDirection 与波纹法线影响
//
// 与 StandardMaterial 区别:
//   - 不计算 PBR,用经验式水面着色
//   - 法线在 fragment shader 中由 normalMap 双层混合(smallWave + bigWave 偏移)
//   - 不支持阴影 / IBL(简化)
//
// 用法:
//   const mat = new WaterMaterial({
//     waterColor: { r: 0.1, g: 0.3, b: 0.5 },
//     normalMap: waterNormalTex,
//     reflectionMap: envMap,
//     sunDirection: { x: 0.5, y: -1, z: 0.3 },
//     waveSpeed: { x: 0.03, y: 0.04 },
//   });

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface WaterMaterialOptions {
  /** 水的固有色(线性 0..1)。 */
  waterColor?: RGB;
  /** 水面法线贴图(波纹)。 */
  normalMap?: Texture | null;
  /** 反射贴图(环境贴图)。 */
  reflectionMap?: Texture | null;
  /** 波纹强度(0=平静,1=汹涌)。 */
  waveScale?: number;
  /** 波纹移动速度(uv 方向)。 */
  waveSpeed?: { x: number; y: number };
  /** 太阳方向(归一化向量,世界空间)。 */
  sunDirection?: { x: number; y: number; z: number };
  /** 太阳颜色(线性 0..1)。 */
  sunColor?: RGB;
  /** 菲涅尔系数(0=无反射,1=全反射)。 */
  fresnelScale?: number;
  /** 透明度 0..1。 */
  opacity?: number;
  /** 是否透明(默认 true,水面通常带 alpha)。 */
  transparent?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
  // ── Gerstner 波顶点位移 ──
  /** 是否启用 Gerstner 波顶点位移(默认 false,保持平面波纹行为)。 */
  gerstnerEnabled?: boolean;
  /** Gerstner 波全局陡度 [0,1](0=平滑正弦,1=最陡)。 */
  gerstnerSteepness?: number;
  /** Gerstner 波速度倍率(默认 1.0)。 */
  gerstnerSpeed?: number;
  /** 4 个 Gerstner 波参数,每个 (dirX, dirY, amplitude, wavelength)。 */
  gerstnerWaves?: { x: number; y: number; z: number; w: number }[];
  // ── 浮沫 ──
  /** 浮沫波高阈值 [0,1](默认 0.6)。 */
  foamThreshold?: number;
  /** 浮沫强度(默认 0.5)。 */
  foamIntensity?: number;
  /** 浮沫颜色(默认白)。 */
  foamColor?: RGB;
  // ── 焦散 ──
  /** 焦散图案缩放(默认 2.0)。 */
  causticScale?: number;
  /** 焦散动画速度(默认 0.8)。 */
  causticSpeed?: number;
  /** 焦散亮度(默认 0.3)。 */
  causticIntensity?: number;
}

/** WaterMaterial 顶点 shader:Gerstner 波顶点位移 + 输出 worldPos / worldNormal / uv + 屏幕坐标。 */
export const WATER_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
uniform float u_time;

// Gerstner 波参数:4 个波,每个 (dirX, dirY, amplitude, wavelength)
uniform vec4  u_gerstnerWaves[4];
uniform float u_gerstnerSteepness;
uniform float u_gerstnerSpeed;
uniform int   u_gerstnerEnabled;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec2 v_uv;
out vec4 v_clipPos;
out float v_waveHeight;  // 传递给 frag 用于浮沫计算

const float PI = 3.14159265359;
const float G  = 9.8;  // 重力加速度(m/s²)

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;

  // === Gerstner 波顶点位移 ===
  v_waveHeight = 0.0;
  if (u_gerstnerEnabled == 1) {
    vec3 displaced = worldPos.xyz;
    vec3 gerstnerN = vec3(0.0, 1.0, 0.0);
    for (int i = 0; i < 4; i++) {
      vec2  dir = normalize(u_gerstnerWaves[i].xy);
      float A   = u_gerstnerWaves[i].z;
      float L   = max(0.1, u_gerstnerWaves[i].w);
      float w   = 2.0 * PI / L;                    // 角频率
      float phi = u_gerstnerSpeed * sqrt(G / w);   // 深水色散关系
      float phase = dot(dir, displaced.xz) * w + phi * u_time;
      float Q   = u_gerstnerSteepness / (w * A * 4.0 + 0.01);

      // 顶点位移
      displaced.x += Q * A * dir.x * cos(phase);
      displaced.z += Q * A * dir.y * cos(phase);
      displaced.y += A * sin(phase);
      v_waveHeight += A * sin(phase);

      // 法线累加(解析 Gerstner 法线)
      gerstnerN.x -= dir.x * w * A * cos(phase);
      gerstnerN.z -= dir.y * w * A * cos(phase);
      gerstnerN.y -= Q * w * A * sin(phase);
    }
    worldPos = vec4(displaced, 1.0);
    v_worldNormal = normalize(gerstnerN);
  }

  v_worldPos = worldPos.xyz;
  vec4 clipPos = u_projection * u_view * worldPos;
  v_clipPos = clipPos;
  gl_Position = clipPos;
}
`;

/** WaterMaterial 片段 shader:法线扰动 + 菲涅尔 + 高光 + 浮沫 + 焦散。 */
export const WATER_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;
in vec4 v_clipPos;
in float v_waveHeight;   // 来自 Gerstner 顶点位移

out vec4 outColor;

uniform vec3  u_cameraPos;
uniform vec3  u_waterColor;
uniform float u_opacity;
uniform sampler2D u_normalMap;
uniform sampler2D u_reflectionMap;
uniform int   u_normalMapEnabled;
uniform int   u_reflectionMapEnabled;
uniform float u_waveScale;
uniform vec2  u_waveSpeed;
uniform float u_time;
uniform vec3  u_sunDirection;
uniform vec3  u_sunColor;
uniform float u_fresnelScale;

// 浮沫参数
uniform float u_foamThreshold;    // 波高阈值 [0,1]
uniform float u_foamIntensity;    // 浮沫强度
uniform vec3  u_foamColor;        // 浮沫颜色

// 焦散参数
uniform float u_causticScale;     // 焦散图案缩放
uniform float u_causticSpeed;     // 焦散动画速度
uniform float u_causticIntensity; // 焦散亮度

// 简化菲涅尔近似:Schlick
float fresnelSchlick(float cosTheta, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

// 程序化焦散:3 方向叠加的高次幂正弦(近似水下光焦散)
float causticPattern(vec2 uv, float time) {
  vec2 p = uv * u_causticScale;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float angle = float(i) * 2.094395;  // 2π/3 = 120°
    vec2 dir = vec2(cos(angle), sin(angle));
    c += pow(abs(sin(dot(p, dir) + time * u_causticSpeed + float(i) * 0.5)), 8.0);
  }
  return c / 3.0;
}

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);

  // 法线扰动:双层 normalMap 偏移(模拟双层波纹)
  vec3 perturbedN = N;
  if (u_normalMapEnabled == 1) {
    vec2 uv1 = v_uv * u_waveScale + u_waveSpeed * u_time;
    vec2 uv2 = v_uv * u_waveScale * 1.7 - u_waveSpeed * u_time * 0.8;
    vec3 n1 = texture(u_normalMap, uv1).rgb * 2.0 - 1.0;
    vec3 n2 = texture(u_normalMap, uv2).rgb * 2.0 - 1.0;
    perturbedN = normalize(N + (n1 + n2) * 0.5);
  }

  // 菲涅尔系数
  float cosTheta = max(dot(perturbedN, V), 0.0);
  float fresnel = fresnelSchlick(cosTheta, 0.02) * u_fresnelScale;

  // 反射方向与采样反射贴图
  vec3 R = reflect(-V, perturbedN);
  vec3 reflColor = vec3(0.0);
  if (u_reflectionMapEnabled == 1) {
    vec2 reflUv = R.xy * 0.5 + 0.5;
    reflColor = texture(u_reflectionMap, reflUv).rgb;
  }

  // 高光:Blinn-Phong
  vec3 L = normalize(-u_sunDirection);
  vec3 H = normalize(L + V);
  float NdotH = max(dot(perturbedN, H), 0.0);
  float spec = pow(NdotH, 64.0);

  // 漫反射
  float NdotL = max(dot(perturbedN, L), 0.0);
  vec3 diffuse = u_waterColor * NdotL * 0.5;

  // === 浮沫:基于 Gerstner 波高 ===
  float foam = smoothstep(u_foamThreshold, u_foamThreshold + 0.2, v_waveHeight) * u_foamIntensity;

  // === 焦散:程序化动画图案 ===
  float caustic = causticPattern(v_worldPos.xz, u_time) * u_causticIntensity;

  // 合成:反射(fresnel) + 漫反射 + 高光 + 焦散
  vec3 finalColor = mix(diffuse, reflColor, clamp(fresnel, 0.0, 1.0))
                  + u_sunColor * spec * 0.6
                  + u_sunColor * caustic * 0.3;

  // 叠加浮沫(替换基色)
  finalColor = mix(finalColor, u_foamColor, clamp(foam, 0.0, 1.0));

  outColor = vec4(finalColor, u_opacity);
}
`;

export class WaterMaterial extends BasicMaterial {
  override readonly type: string = 'Water';
  /** 标志用于 instanceof 替代检测。 */
  readonly isWaterMaterial: boolean = true;

  /** 水的固有色。 */
  waterColor: RGB = { r: 0.1, g: 0.3, b: 0.5 };
  /** 水面法线贴图(波纹)。 */
  normalMap: Texture | null = null;
  /** 反射贴图。 */
  reflectionMap: Texture | null = null;
  /** 波纹强度。 */
  waveScale: number = 0.5;
  /** 波纹移动速度。 */
  waveSpeed: { x: number; y: number } = { x: 0.03, y: 0.04 };
  /** 太阳方向(世界空间)。 */
  sunDirection: { x: number; y: number; z: number } = { x: 0.5, y: -1, z: 0.3 };
  /** 太阳颜色。 */
  sunColor: RGB = { r: 1, g: 1, b: 1 };
  /** 菲涅尔系数。 */
  fresnelScale: number = 1.0;
  /** 透明度。 */
  opacity: number = 0.9;
  /** 是否透明。 */
  transparent: boolean = true;

  // ── Gerstner 波顶点位移 ──
  /** 是否启用 Gerstner 波顶点位移。 */
  gerstnerEnabled: boolean = false;
  /** Gerstner 波全局陡度 [0,1]。 */
  gerstnerSteepness: number = 0.5;
  /** Gerstner 波速度倍率。 */
  gerstnerSpeed: number = 1.0;
  /** 4 个 Gerstner 波参数 (dirX, dirY, amplitude, wavelength)。 */
  gerstnerWaves: { x: number; y: number; z: number; w: number }[];

  // ── 浮沫 ──
  /** 浮沫波高阈值。 */
  foamThreshold: number = 0.6;
  /** 浮沫强度。 */
  foamIntensity: number = 0.5;
  /** 浮沫颜色。 */
  foamColor: RGB = { r: 1, g: 1, b: 1 };

  // ── 焦散 ──
  /** 焦散图案缩放。 */
  causticScale: number = 2.0;
  /** 焦散动画速度。 */
  causticSpeed: number = 0.8;
  /** 焦散亮度。 */
  causticIntensity: number = 0.3;

  constructor(opts: WaterMaterialOptions = {}) {
    super();
    if (opts.waterColor) this.waterColor = { ...opts.waterColor };
    if (opts.normalMap !== undefined) this.normalMap = opts.normalMap;
    if (opts.reflectionMap !== undefined) this.reflectionMap = opts.reflectionMap;
    if (opts.waveScale !== undefined) this.waveScale = opts.waveScale;
    if (opts.waveSpeed) this.waveSpeed = { ...opts.waveSpeed };
    if (opts.sunDirection) this.sunDirection = { ...opts.sunDirection };
    if (opts.sunColor) this.sunColor = { ...opts.sunColor };
    if (opts.fresnelScale !== undefined) this.fresnelScale = opts.fresnelScale;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    // 水面默认不写深度(让水下物体可见)
    this.depthWrite = opts.depthWrite !== undefined ? opts.depthWrite : false;
    // Gerstner 波
    this.gerstnerEnabled = opts.gerstnerEnabled ?? false;
    this.gerstnerSteepness = opts.gerstnerSteepness ?? 0.5;
    this.gerstnerSpeed = opts.gerstnerSpeed ?? 1.0;
    this.gerstnerWaves = opts.gerstnerWaves
      ? opts.gerstnerWaves.map((w) => ({ ...w }))
      : [
          { x: 1.0, y: 0.0, z: 0.15, w: 8.0 },
          { x: 0.7, y: 0.7, z: 0.10, w: 12.0 },
          { x: -0.5, y: 0.8, z: 0.08, w: 5.0 },
          { x: 0.3, y: -0.9, z: 0.06, w: 3.0 },
        ];
    // 浮沫
    this.foamThreshold = opts.foamThreshold ?? 0.6;
    this.foamIntensity = opts.foamIntensity ?? 0.5;
    if (opts.foamColor) this.foamColor = { ...opts.foamColor };
    // 焦散
    this.causticScale = opts.causticScale ?? 2.0;
    this.causticSpeed = opts.causticSpeed ?? 0.8;
    this.causticIntensity = opts.causticIntensity ?? 0.3;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: WaterMaterial): this {
    this.waterColor = { ...source.waterColor };
    this.normalMap = source.normalMap;
    this.reflectionMap = source.reflectionMap;
    this.waveScale = source.waveScale;
    this.waveSpeed = { ...source.waveSpeed };
    this.sunDirection = { ...source.sunDirection };
    this.sunColor = { ...source.sunColor };
    this.fresnelScale = source.fresnelScale;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    // Gerstner 波
    this.gerstnerEnabled = source.gerstnerEnabled;
    this.gerstnerSteepness = source.gerstnerSteepness;
    this.gerstnerSpeed = source.gerstnerSpeed;
    this.gerstnerWaves = source.gerstnerWaves.map((w) => ({ ...w }));
    // 浮沫
    this.foamThreshold = source.foamThreshold;
    this.foamIntensity = source.foamIntensity;
    this.foamColor = { ...source.foamColor };
    // 焦散
    this.causticScale = source.causticScale;
    this.causticSpeed = source.causticSpeed;
    this.causticIntensity = source.causticIntensity;
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): WaterMaterial {
    return new WaterMaterial().copy(this);
  }
}
