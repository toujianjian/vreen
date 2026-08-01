// ReflectorMaterial — 平面镜面反射材质。
//
// 与 Renderer/Reflector.ts(CPU 反射数学库)配套使用。
// Reflector 负责计算反射矩阵、镜像相机、斜截投影、纹理矩阵;
// ReflectorMaterial 负责把这些数据传入 GLSL,在镜面网格上渲染反射纹理。
//
// 适配 three.js examples/jsm/objects/Reflector.js 的 shader 部分,
// 并扩展:色调 (tint)、菲涅尔混合 (fresnelBlend)、基础颜色 (baseColor)。
//
// 着色流程:
//   Vertex:
//     1. worldPos = u_model * vec4(position, 1.0)
//     2. v_reflectionCoord = u_textureMatrix * worldPos
//        (textureMatrix = scaleBias × projection × viewMirror,把世界坐标
//         变换到镜像相机的裁剪空间,再映射到 [0,1] UV)
//     3. gl_Position = u_projection * u_view * worldPos
//
//   Fragment:
//     1. 透视除法: reflUv = v_reflectionCoord.xy / v_reflectionCoord.w
//     2. 采样反射纹理: reflColor = texture(u_reflectionMap, reflUv)
//     3. 色调: reflColor.rgb *= u_tint
//     4. 菲涅尔混合(可选): fresnel = pow(1 - dot(N, V), u_fresnelPower)
//        finalColor = mix(reflColor, baseColor, fresnel * u_fresnelScale)
//     5. 输出: outColor = vec4(finalColor, u_opacity)
//
// 用法:
//   const reflector = new Reflector({ plane: new Plane(N, C), resolution: 1024 });
//   const material = new ReflectorMaterial({
//     tint: [0.9, 0.9, 1.0],
//     opacity: 0.85,
//     fresnelScale: 0.3,
//   });
//   // 每帧更新:
//   material.textureMatrix = reflector.computeTextureMatrix(proj, viewMirror);
//   material.reflectionTexture = reflectorRenderTargetTexture;
//   const mesh = new Mesh(planeGeometry, material);
//
// 参考:
//   - three.js examples/jsm/objects/Reflector.js
//   - VREEN Renderer/Reflector.ts (CPU 反射数学)
//   - o3de Atom ReflectionProbe / SSR

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';
import type { Matrix4 } from '../Math/Matrix4';

/** ReflectorMaterial 配置选项。 */
export interface ReflectorMaterialOptions {
  /** 反射纹理(由 Reflector 渲染到纹理的输出)。 */
  reflectionTexture?: Texture | null;
  /**
   * 纹理矩阵(world → reflection texture UV)。
   * 由 Reflector.computeTextureMatrix(projection, viewMirror) 计算。
   * 4×4 列主序矩阵,传为 mat4 uniform。
   */
  textureMatrix?: Matrix4 | null;
  /** 镜面色调 RGB 0..1(默认 [1,1,1] = 无色调)。 */
  tint?: [number, number, number] | RGB;
  /** 镜面不透明度 0..1(默认 1.0)。 */
  opacity?: number;
  /**
   * 菲涅尔混合系数 0..1(默认 0.0 = 纯反射)。
   * 0 = 纯反射(所有角度都是镜面);
   * >0 = 掠射角反射更强,正面反射更弱(更真实)。
   */
  fresnelScale?: number;
  /** 菲涅尔指数(默认 3.0)。 */
  fresnelPower?: number;
  /**
   * 基础颜色 RGB 0..1(默认 [0.02, 0.02, 0.03] = 深色镜面底色)。
   * 在菲涅尔混合中使用:正面(低反射)→ 基础色,掠射(高反射)→ 反射色。
   */
  baseColor?: [number, number, number] | RGB;
  /** 是否透明(默认 false,镜面通常不透明)。 */
  transparent?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
}

/**
 * ReflectorMaterial 顶点 shader。
 *
 * 输入属性:
 *   a_position (vec3)  — 顶点位置(模型空间)
 *   a_normal  (vec3)   — 顶点法线(模型空间)
 *   a_uv      (vec2)   — 顶点 UV
 *
 * Uniforms:
 *   u_model         (mat4) — 模型矩阵(local → world)
 *   u_view          (mat4) — 视图矩阵(world → camera)
 *   u_projection    (mat4) — 投影矩阵(camera → clip)
 *   u_normalMatrix  (mat3) — 法线矩阵(model → world,逆转置)
 *   u_textureMatrix (mat4) — 纹理矩阵(world → reflection texture UV)
 *
 * 输出:
 *   v_worldPos       (vec3) — 世界空间位置
 *   v_worldNormal    (vec3) — 世界空间法线
 *   v_reflectionCoord(vec4) — 反射纹理坐标(待透视除法)
 *   v_uv             (vec2) — 顶点 UV
 */
export const REFLECTOR_VERT = /* glsl */ `#version 300 es
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
out vec4 v_reflectionCoord;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  // 纹理矩阵把世界坐标变换到镜像相机的裁剪空间(已含 scaleBias → [0,1] UV)
  v_reflectionCoord = u_textureMatrix * worldPos;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/**
 * ReflectorMaterial 片段 shader。
 *
 * Uniforms:
 *   u_reflectionMap   (sampler2D) — 反射纹理
 *   u_tint            (vec3)      — 色调
 *   u_opacity         (float)     — 不透明度
 *   u_cameraPos       (vec3)      — 相机世界位置(菲涅尔用)
 *   u_fresnelScale    (float)     — 菲涅尔混合系数
 *   u_fresnelPower    (float)     — 菲涅尔指数
 *   u_baseColor       (vec3)      — 基础颜色(菲涅尔低反射区)
 *   u_reflectionMapEnabled (int)  — 反射纹理是否可用
 */
export const REFLECTOR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec4 v_reflectionCoord;
in vec2 v_uv;

out vec4 outColor;

uniform sampler2D u_reflectionMap;
uniform vec3  u_tint;
uniform float u_opacity;
uniform vec3  u_cameraPos;
uniform float u_fresnelScale;
uniform float u_fresnelPower;
uniform vec3  u_baseColor;
uniform int   u_reflectionMapEnabled;

// Schlick 菲涅尔近似
float fresnelSchlick(float cosTheta, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);

  // 默认输出基础色
  vec3 finalColor = u_baseColor;

  // 反射纹理采样(透视除法后)
  if (u_reflectionMapEnabled == 1) {
    // 透视除法:NDC → UV
    vec2 reflUv = v_reflectionCoord.xy / v_reflectionCoord.w;
    // 边界钳制(反射纹理可能在镜面外为空)
    reflUv = clamp(reflUv, vec2(0.0), vec2(1.0));
    vec3 reflColor = texture(u_reflectionMap, reflUv).rgb;
    reflColor *= u_tint;

    if (u_fresnelScale > 0.0) {
      // 菲涅尔:掠射角反射更强,正面反射更弱
      float cosTheta = max(dot(N, V), 0.0);
      float fresnel = fresnelSchlick(cosTheta, 0.04); // f0 ≈ 0.04 (电介质)
      float blend = clamp(fresnel * u_fresnelScale, 0.0, 1.0);
      finalColor = mix(u_baseColor, reflColor, blend);
    } else {
      // 纯反射(无菲涅尔)
      finalColor = reflColor;
    }
  }

  outColor = vec4(finalColor, u_opacity);
}
`;

/**
 * 平面镜面反射材质。
 *
 * 与 Renderer/Reflector.ts 配套:
 *   - Reflector.computeTextureMatrix() → 设置 textureMatrix
 *   - Reflector 渲染到纹理的输出 → 设置 reflectionTexture
 *   - 本材质在镜面网格上采样反射纹理,应用色调/菲涅尔/不透明度
 *
 * 扩展(three.js Reflector 不具备):
 *   - 菲涅尔混合(fresnelScale):掠射角反射更强,正面透出底色,更真实
 *   - 色调(tint):彩色镜面(铜镜、金镜等)
 *   - 基础色(baseColor):非反射区域的底色
 */
export class ReflectorMaterial extends BasicMaterial {
  override readonly type: string = 'Reflector';
  /** 类型标志(用于 instanceof 替代检测)。 */
  readonly isReflectorMaterial: boolean = true;

  /** 反射纹理(由 Reflector 渲染到纹理的输出)。 */
  reflectionTexture: Texture | null = null;
  /**
   * 纹理矩阵(world → reflection texture UV)。
   * 由 Reflector.computeTextureMatrix() 计算。
   */
  textureMatrix: Matrix4 | null = null;
  /** 镜面色调 RGB 0..1。 */
  tint: [number, number, number] = [1, 1, 1];
  /** 镜面不透明度 0..1。 */
  opacity: number = 1.0;
  /** 菲涅尔混合系数 0..1(0 = 纯反射)。 */
  fresnelScale: number = 0.0;
  /** 菲涅尔指数。 */
  fresnelPower: number = 3.0;
  /** 基础颜色(菲涅尔低反射区)。 */
  baseColor: [number, number, number] = [0.02, 0.02, 0.03];
  /** 是否透明。 */
  transparent: boolean = false;

  constructor(opts: ReflectorMaterialOptions = {}) {
    super();
    if (opts.reflectionTexture !== undefined) this.reflectionTexture = opts.reflectionTexture;
    if (opts.textureMatrix !== undefined) this.textureMatrix = opts.textureMatrix;
    if (opts.tint) {
      if (Array.isArray(opts.tint)) {
        this.tint = [...opts.tint] as [number, number, number];
      } else {
        this.tint = [opts.tint.r, opts.tint.g, opts.tint.b];
      }
    }
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.fresnelScale !== undefined) this.fresnelScale = opts.fresnelScale;
    if (opts.fresnelPower !== undefined) this.fresnelPower = opts.fresnelPower;
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
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: ReflectorMaterial): this {
    this.reflectionTexture = source.reflectionTexture;
    this.textureMatrix = source.textureMatrix;
    this.tint = [...source.tint] as [number, number, number];
    this.opacity = source.opacity;
    this.fresnelScale = source.fresnelScale;
    this.fresnelPower = source.fresnelPower;
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
  clone(): ReflectorMaterial {
    return new ReflectorMaterial().copy(this);
  }
}
