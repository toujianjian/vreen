// ToonMaterial — 卡通材质(阶梯式光照)。
//
// 参考 three.js MeshToonMaterial。把光照值量化为 N 个阶梯(N=3 或 4),
// 形成硬边卡通阴影效果。配合 OutlineMaterial 实现完整 cel-shading 外观。
//
// 设计:
//   - 着色器:基于 Lambert 漫反射 + 镜面量化(NdotL 通过 1D 渐变贴图采样)
//   - gradientMap(1D 贴图):水平方向的 RGBA 纹理,横向 N 个色阶,
//     采样得到离散光照系数(0/0.33/0.66/1.0 等),形成阶梯式阴影
//   - 无 gradientMap 时退化为内置 3 阶梯硬量化
//   - outlineThickness/outlineColor 是描边参数(由 OutlineMaterial 单独渲染背面,
//     本材质不直接绘制描边,只持有配置便于和 OutlineMaterial 配对使用)
//
// 与 StandardMaterial 区别:
//   - Toon 不计算 PBR,只用 Lambert + 阶梯量化;性能开销低
//   - 不支持 IBL / shadow / clearcoat(简化)
//   - 默认透明 false(opaque),需要描边时搭配 OutlineMaterial
//
// 用法:
//   const mat = new ToonMaterial({ color: { r: 0.8, g: 0.6, b: 0.4 } });
//   const outline = new OutlineMaterial({ color: { r: 0, g: 0, b: 0 }, thickness: 0.02 });
//   mesh.material = [mat, outline]; // 多材质:主卡通 + 描边

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface ToonMaterialOptions {
  /** 漫反射颜色(线性 0..1,默认白)。 */
  color?: RGB;
  /** 1D 渐变贴图(可选),用于量化光照。无则用内置 3 阶梯。 */
  gradientMap?: Texture | null;
  /** 阶梯数量(无 gradientMap 时生效,默认 3)。 */
  gradientSteps?: number;
  /** 描边厚度(世界空间,本材质只持有配置,不绘制)。 */
  outlineThickness?: number;
  /** 描边颜色(本材质只持有配置,不绘制)。 */
  outlineColor?: RGB;
  /** 透明度 0..1。 */
  opacity?: number;
  /** 是否透明。 */
  transparent?: boolean;
  /** 是否启用线框。 */
  wireframe?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
}

/** ToonMaterial 顶点 shader:输出 worldPos / worldNormal / uv。 */
export const TOON_VERT = /* glsl */ `#version 300 es
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

/** ToonMaterial 片段 shader:Lambert 漫反射 + 阶梯量化。 */
export const TOON_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_color;
uniform float u_opacity;
uniform int   u_gradientSteps;
uniform int   u_gradientMapEnabled;
uniform sampler2D u_gradientMap;

uniform vec3  u_lightDir;     // 光传播方向
uniform vec3  u_lightColor;
uniform float u_lightIntensity;
uniform vec3  u_ambientColor;

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(-u_lightDir);
  float NdotL = max(dot(N, L), 0.0);

  // 阶梯量化
  float intensity;
  if (u_gradientMapEnabled == 1) {
    // 用 1D 渐变贴图采样:纹理宽度方向存量化值
    intensity = texture(u_gradientMap, vec2(NdotL, 0.5)).r;
  } else {
    // 内置阶梯量化:把 [0,1] 量化到 u_gradientSteps 个值
    float step = 1.0 / float(u_gradientSteps);
    intensity = floor(NdotL / step + 0.5) * step;
    intensity = clamp(intensity, 0.0, 1.0);
  }

  vec3 diffuse = u_color * u_lightColor * u_lightIntensity * intensity;
  vec3 ambient = u_ambientColor * u_color;
  vec3 finalColor = ambient + diffuse;

  outColor = vec4(finalColor, u_opacity);
}
`;

export class ToonMaterial extends BasicMaterial {
  override readonly type: string = 'Toon';
  /** 标志用于 instanceof 替代检测。 */
  readonly isToonMaterial: boolean = true;

  /** 漫反射颜色(线性 0..1,默认白)。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 1D 渐变贴图(可选)。无则用内置阶梯量化。 */
  gradientMap: Texture | null = null;
  /** 阶梯数量(无 gradientMap 时生效,默认 3)。 */
  gradientSteps: number = 3;
  /** 描边厚度(世界空间)。本材质只持有配置,实际描边由 OutlineMaterial 渲染。 */
  outlineThickness: number = 0.02;
  /** 描边颜色(本材质只持有配置,实际描边由 OutlineMaterial 渲染)。 */
  outlineColor: RGB = { r: 0, g: 0, b: 0 };
  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 是否透明。 */
  transparent: boolean = false;

  constructor(opts: ToonMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.gradientMap !== undefined) this.gradientMap = opts.gradientMap;
    if (opts.gradientSteps !== undefined) this.gradientSteps = opts.gradientSteps;
    if (opts.outlineThickness !== undefined) this.outlineThickness = opts.outlineThickness;
    if (opts.outlineColor) this.outlineColor = { ...opts.outlineColor };
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: ToonMaterial): this {
    this.color = { ...source.color };
    this.gradientMap = source.gradientMap;
    this.gradientSteps = source.gradientSteps;
    this.outlineThickness = source.outlineThickness;
    this.outlineColor = { ...source.outlineColor };
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): ToonMaterial {
    return new ToonMaterial().copy(this);
  }
}
