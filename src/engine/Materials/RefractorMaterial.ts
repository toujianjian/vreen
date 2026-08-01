// RefractorMaterial — 平面折射材质(玻璃/水面透视/热扭曲)。
//
// 与 Renderer/Refractor.ts(CPU 折射数学库)配套使用。
// 与 ReflectorMaterial 互补:Reflector 做镜面反射(角度翻转),
// RefractorMaterial 做透射折射(UV 弯折)。
//
// 适配 three.js examples/jsm/objects/Refractor.js 的 shader 部分,
// 并扩展:色调 (tint)、菲涅尔反射混合 (fresnelBlend)、基础颜色 (baseColor)、
// 折射强度 (refractionScale)、色散 (dispersion)。
//
// 着色流程:
//   Vertex:
//     1. worldPos = u_model * vec4(position, 1.0)
//     2. v_screenCoord = u_textureMatrix * worldPos
//        (textureMatrix = scaleBias × projection × view,主相机)
//     3. v_worldNormal = u_normalMatrix * a_normal
//     4. gl_Position = u_projection * u_view * worldPos
//
//   Fragment:
//     1. 屏幕空间 UV: screenUv = v_screenCoord.xy / v_screenCoord.w
//     2. 视线方向: V = normalize(u_cameraPos - v_worldPos)
//     3. 折射方向: R = refract(-V, N, u_eta)
//        (GLSL refract:全反射时返回 (0,0,0))
//     4. UV 位移: offset = R.xy * u_refractionScale
//     5. 色散(可选): R/G/B 三通道用不同 eta → 彩色边缘
//     6. 采样折射纹理: refrColor = texture(u_refractionMap, screenUv + offset)
//     7. 色调: refrColor.rgb *= u_tint
//     8. 菲涅尔反射混合(可选):
//        fresnel = Schlick(dot(N, V), f0)
//        finalColor = mix(refrColor, reflColor, fresnel * u_fresnelScale)
//     9. 输出: outColor = vec4(finalColor, u_opacity)
//
// 用法:
//   const refractor = new Refractor({ plane: new Plane(N, C), eta: 0.75 });
//   const material = new RefractorMaterial({
//     eta: 0.75,           // 空气→水
//     tint: [0.9, 0.95, 1.0],
//     opacity: 0.85,
//     refractionScale: 0.02,
//     fresnelScale: 0.5,   // 掠射角反射
//     dispersion: 0.02,    // 色散
//   });
//   // 每帧:
//   material.textureMatrix = computeTextureMatrix(mainCamProj, mainCamView);
//   material.refractionTexture = sceneRenderTargetTexture;
//
// 参考:
//   - three.js examples/jsm/objects/Refractor.js
//   - VREEN Renderer/Refractor.ts (CPU 折射数学)
//   - GLSL refract() spec (Snell's law, TIR returns vec3(0))
//   - o3de Atom WaterSystem / GlassMaterial

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';
import type { Matrix4 } from '../Math/Matrix4';

/** RefractorMaterial 配置选项。 */
export interface RefractorMaterialOptions {
  /** 折射纹理(主相机渲染的场景纹理,排除折射面本身)。 */
  refractionTexture?: Texture | null;
  /**
   * 纹理矩阵(world → screen UV)。
   * = scaleBias × projection × view(主相机,非镜像)。
   */
  textureMatrix?: Matrix4 | null;
  /**
   * 折射率比 η = n1/n2。
   * 空气→水 ≈ 0.75;空气→玻璃 ≈ 0.667;水→空气 ≈ 1.33。
   * 默认 0.75。
   */
  eta?: number;
  /** 镜面色调 RGB 0..1(默认 [1,1,1] = 无色调)。 */
  tint?: [number, number, number] | RGB;
  /** 不透明度 0..1(默认 1.0)。 */
  opacity?: number;
  /**
   * 折射 UV 位移强度(默认 0.02)。
   * 控制折射偏移的视觉强度;越大越"扭曲"。
   */
  refractionScale?: number;
  /**
   * 菲涅尔反射混合系数 0..1(默认 0.0 = 纯折射)。
   * 0 = 纯折射(透过);
   * >0 = 掠射角出现反射(真实玻璃同时折射+反射)。
   */
  fresnelScale?: number;
  /** 菲涅尔指数(默认 5.0)。 */
  fresnelPower?: number;
  /**
   * 色散强度(默认 0.0 = 无色散)。
   * 模拟棱镜色散:R/G/B 三通道用略微不同的 eta,
   * 产生彩色边缘。值越大色散越明显。
   */
  dispersion?: number;
  /**
   * 基础颜色 RGB 0..1(默认 [0.02, 0.02, 0.03])。
   * 折射纹理不可用或全反射时的底色。
   */
  baseColor?: [number, number, number] | RGB;
  /** 是否透明(默认 true,玻璃/水面通常带 alpha)。 */
  transparent?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
}

/**
 * RefractorMaterial 顶点 shader。
 *
 * 输入属性:
 *   a_position (vec3)  — 顶点位置(模型空间)
 *   a_normal  (vec3)   — 顶点法线(模型空间)
 *   a_uv      (vec2)   — 顶点 UV
 *
 * Uniforms:
 *   u_model         (mat4) — 模型矩阵
 *   u_view          (mat4) — 视图矩阵(主相机)
 *   u_projection    (mat4) — 投影矩阵(主相机)
 *   u_normalMatrix  (mat3) — 法线矩阵
 *   u_textureMatrix (mat4) — 纹理矩阵(world → screen UV)
 *
 * 输出:
 *   v_worldPos     (vec3) — 世界空间位置
 *   v_worldNormal  (vec3) — 世界空间法线
 *   v_screenCoord  (vec4) — 屏幕空间坐标(待透视除法)
 *   v_uv           (vec2) — 顶点 UV
 */
export const REFRACTOR_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
uniform mat4 u_textureMatrix;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec4 v_screenCoord;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  // 纹理矩阵把世界坐标变换到主相机裁剪空间(已含 scaleBias → [0,1] UV)
  v_screenCoord = u_textureMatrix * worldPos;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/**
 * RefractorMaterial 片段 shader。
 *
 * Uniforms:
 *   u_refractionMap       (sampler2D) — 折射纹理(主相机场景渲染)
 *   u_tint                (vec3)      — 色调
 *   u_opacity             (float)     — 不透明度
 *   u_cameraPos           (vec3)      — 相机世界位置
 *   u_eta                 (float)     — 折射率比 n1/n2
 *   u_refractionScale     (float)     — 折射 UV 位移强度
 *   u_fresnelScale        (float)     — 菲涅尔反射混合系数
 *   u_fresnelPower        (float)     — 菲涅尔指数
 *   u_dispersion          (float)     — 色散强度
 *   u_baseColor           (vec3)      — 基础颜色
 *   u_refractionMapEnabled(int)       — 折射纹理是否可用
 */
export const REFRACTOR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec4 v_screenCoord;
in vec2 v_uv;

out vec4 outColor;

uniform sampler2D u_refractionMap;
uniform vec3  u_tint;
uniform float u_opacity;
uniform vec3  u_cameraPos;
uniform float u_eta;
uniform float u_refractionScale;
uniform float u_fresnelScale;
uniform float u_fresnelPower;
uniform float u_dispersion;
uniform vec3  u_baseColor;
uniform int   u_refractionMapEnabled;

// Schlick 菲涅尔近似
float fresnelSchlick(float cosTheta, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);

  // 默认输出基础色
  vec3 finalColor = u_baseColor;

  if (u_refractionMapEnabled == 1) {
    // 屏幕空间 UV(透视除法)
    vec2 screenUv = v_screenCoord.xy / v_screenCoord.w;

    // 折射方向(GLSL refract: 入射方向 = -V,法线 = N,eta = n1/n2)
    // refract(I, N, eta): I 是入射方向(指向表面),这里 I = -V
    vec3 I = -V;

    if (u_dispersion > 0.0) {
      // 色散:R/G/B 三通道用不同 eta
      float etaR = u_eta + u_dispersion;
      float etaG = u_eta;
      float etaB = u_eta - u_dispersion;
      vec3 refrR = refract(I, N, etaR);
      vec3 refrG = refract(I, N, etaG);
      vec3 refrB = refract(I, N, etaB);
      vec2 offsetR = refrR.xy * u_refractionScale;
      vec2 offsetG = refrG.xy * u_refractionScale;
      vec2 offsetB = refrB.xy * u_refractionScale;
      float r = texture(u_refractionMap, clamp(screenUv + offsetR, vec2(0.0), vec2(1.0))).r;
      float g = texture(u_refractionMap, clamp(screenUv + offsetG, vec2(0.0), vec2(1.0))).g;
      float b = texture(u_refractionMap, clamp(screenUv + offsetB, vec2(0.0), vec2(1.0))).b;
      finalColor = vec3(r, g, b) * u_tint;
    } else {
      // 无色散:三通道统一折射
      vec3 refractDir = refract(I, N, u_eta);
      vec2 offset = refractDir.xy * u_refractionScale;
      vec2 refrUv = clamp(screenUv + offset, vec2(0.0), vec2(1.0));
      vec3 refrColor = texture(u_refractionMap, refrUv).rgb;
      finalColor = refrColor * u_tint;
    }

    // 菲涅尔反射混合(真实玻璃同时折射+反射)
    if (u_fresnelScale > 0.0) {
      float cosTheta = max(dot(N, V), 0.0);
      float fresnel = fresnelSchlick(cosTheta, 0.04); // f0 ≈ 0.04 (电介质)
      float blend = clamp(fresnel * u_fresnelScale, 0.0, 1.0);
      // 掠射角 → 基础色(近似反射环境色)
      finalColor = mix(finalColor, u_baseColor, blend);
    }
  }

  outColor = vec4(finalColor, u_opacity);
}
`;

/**
 * 平面折射材质(玻璃/水面透视/热扭曲)。
 *
 * 与 Renderer/Refractor.ts 配套:
 *   - Refractor.refractDirection() → CPU 侧折射方向(参考实现)
 *   - 本材质在 GPU 侧用 GLSL refract() 实时计算折射 UV 位移
 *
 * 扩展(three.js Refractor 不具备):
 *   - 色散 (dispersion):R/G/B 三通道不同 eta → 彩色边缘(棱镜效果)
 *   - 菲涅尔反射混合 (fresnelScale):掠射角出现反射(真实玻璃)
 *   - 色调 (tint):彩色玻璃(绿玻璃、琥珀色等)
 *   - 基础色 (baseColor):全反射/无纹理时的底色
 *   - 折射强度 (refractionScale):控制 UV 位移幅度
 */
export class RefractorMaterial extends BasicMaterial {
  override readonly type: string = 'Refractor';
  /** 类型标志(用于 instanceof 替代检测)。 */
  readonly isRefractorMaterial: boolean = true;

  /** 折射纹理(主相机渲染的场景纹理)。 */
  refractionTexture: Texture | null = null;
  /**
   * 纹理矩阵(world → screen UV)。
   * = scaleBias × projection × view(主相机)。
   */
  textureMatrix: Matrix4 | null = null;
  /** 折射率比 η = n1/n2。 */
  eta: number = 0.75;
  /** 镜面色调 RGB 0..1。 */
  tint: [number, number, number] = [1, 1, 1];
  /** 不透明度 0..1。 */
  opacity: number = 1.0;
  /** 折射 UV 位移强度。 */
  refractionScale: number = 0.02;
  /** 菲涅尔反射混合系数 0..1(0 = 纯折射)。 */
  fresnelScale: number = 0.0;
  /** 菲涅尔指数。 */
  fresnelPower: number = 5.0;
  /** 色散强度(0 = 无色散)。 */
  dispersion: number = 0.0;
  /** 基础颜色。 */
  baseColor: [number, number, number] = [0.02, 0.02, 0.03];
  /** 是否透明。 */
  transparent: boolean = true;

  constructor(opts: RefractorMaterialOptions = {}) {
    super();
    if (opts.refractionTexture !== undefined) this.refractionTexture = opts.refractionTexture;
    if (opts.textureMatrix !== undefined) this.textureMatrix = opts.textureMatrix;
    if (opts.eta !== undefined) this.eta = opts.eta;
    if (opts.tint) {
      if (Array.isArray(opts.tint)) {
        this.tint = [...opts.tint] as [number, number, number];
      } else {
        this.tint = [opts.tint.r, opts.tint.g, opts.tint.b];
      }
    }
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.refractionScale !== undefined) this.refractionScale = opts.refractionScale;
    if (opts.fresnelScale !== undefined) this.fresnelScale = opts.fresnelScale;
    if (opts.fresnelPower !== undefined) this.fresnelPower = opts.fresnelPower;
    if (opts.dispersion !== undefined) this.dispersion = opts.dispersion;
    if (opts.baseColor) {
      if (Array.isArray(opts.baseColor)) {
        this.baseColor = [...opts.baseColor] as [number, number, number];
      } else {
        this.baseColor = [opts.baseColor.r, opts.baseColor.g, opts.baseColor.b];
      }
    }
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    // 折射面通常不写深度(让折射后的物体可见)
    this.depthWrite = opts.depthWrite !== undefined ? opts.depthWrite : false;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: RefractorMaterial): this {
    this.refractionTexture = source.refractionTexture;
    this.textureMatrix = source.textureMatrix;
    this.eta = source.eta;
    this.tint = [...source.tint] as [number, number, number];
    this.opacity = source.opacity;
    this.refractionScale = source.refractionScale;
    this.fresnelScale = source.fresnelScale;
    this.fresnelPower = source.fresnelPower;
    this.dispersion = source.dispersion;
    this.baseColor = [...source.baseColor] as [number, number, number];
    this.transparent = source.transparent;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): RefractorMaterial {
    return new RefractorMaterial().copy(this);
  }
}
