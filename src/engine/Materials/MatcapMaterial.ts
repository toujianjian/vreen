// MatcapMaterial — Matcap(Material Capture)材质。
//
// 参考 three.js MeshMatcapMaterial。Matcap 是一张预烘焙的法线 → 颜色查找表
// (通常是圆形球面光照快照),fragment shader 用法线方向采样这张纹理得到完整
// 光照效果,无需运行时计算光照。
//
// 优势:
//   - 性能极高(只采样一次纹理,无光照计算)
//   - 视觉风格统一(适合风格化渲染)
//   - 不依赖场景光源(可在无光场景下渲染)
//
// 实现:
//   - 顶点 shader 输出 view-space 法线 + world-space 法线
//   - fragment shader 用 view-space 法线的 xy 坐标(归一化到 [0,1])采样 matcap
//   - 可选 normalMap 扰动法线(细节增强)
//   - color 与 matcap 相乘(整体色调调整)
//
// 用法:
//   const matcapTex = await textureLoader.load('matcap.png');
//   const mat = new MatcapMaterial({
//     matcap: matcapTex,
//     color: { r: 1, g: 1, b: 1 },
//   });
//   mesh.material = mat;

import { BasicMaterial, type RGB } from '../Core/Material';
import type { Texture } from '../Core/Texture';

export interface MatcapMaterialOptions {
  /** Matcap 纹理(法线 → 颜色查找表)。 */
  matcap?: Texture | null;
  /** 整体颜色色调(线性 0..1,默认白,与 matcap 相乘)。 */
  color?: RGB;
  /** 法线贴图(可选,扰动法线以增加细节)。 */
  normalMap?: Texture | null;
  /** 法线贴图强度(0=无影响,1=完全替换,默认 1)。 */
  normalScale?: number;
  /** 透明度 0..1。 */
  opacity?: number;
  /** 是否透明。 */
  transparent?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
  /** 是否启用线框。 */
  wireframe?: boolean;
}

/** MatcapMaterial 顶点 shader:输出 view-space 法线 + uv。 */
export const MATCAP_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
uniform mat4 u_viewMatrix; // = u_view,用于 view-space 法线变换

out vec3 v_viewNormal;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  // view-space 法线 = mat3(view) * mat3(normalMatrix) * a_normal
  // 简化:用 u_normalMatrix (model→world) 再 × view 的 3x3
  vec3 worldNormal = normalize(u_normalMatrix * a_normal);
  v_viewNormal = normalize(mat3(u_viewMatrix) * worldNormal);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/** MatcapMaterial 片段 shader:用 view-space 法线采样 matcap。 */
export const MATCAP_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_viewNormal;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_color;
uniform float u_opacity;
uniform sampler2D u_matcap;
uniform int   u_matcapEnabled;
uniform sampler2D u_normalMap;
uniform int   u_normalMapEnabled;
uniform float u_normalScale;

void main() {
  vec3 N = normalize(v_viewNormal);

  // 可选法线贴图扰动
  if (u_normalMapEnabled == 1) {
    vec3 n = texture(u_normalMap, v_uv).rgb * 2.0 - 1.0;
    N = normalize(N + n * u_normalScale);
  }

  // matcap 采样:把 view-space 法线 xy 映射到 [0,1] uv
  // 法线在 view space,xy 平面 → 屏幕空间法线方向
  vec2 matcapUv = N.xy * 0.5 + 0.5;

  vec3 matcapColor = vec3(1.0);
  if (u_matcapEnabled == 1) {
    matcapColor = texture(u_matcap, matcapUv).rgb;
  }

  vec3 finalColor = matcapColor * u_color;
  outColor = vec4(finalColor, u_opacity);
}
`;

export class MatcapMaterial extends BasicMaterial {
  override readonly type: string = 'Matcap';
  /** 标志用于 instanceof 替代检测。 */
  readonly isMatcapMaterial: boolean = true;

  /** Matcap 纹理(法线 → 颜色查找表)。 */
  matcap: Texture | null = null;
  /** 整体颜色色调(与 matcap 相乘,默认白)。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 法线贴图(可选)。 */
  normalMap: Texture | null = null;
  /** 法线贴图强度(0..1,默认 1)。 */
  normalScale: number = 1;
  /** 透明度。 */
  opacity: number = 1;
  /** 是否透明。 */
  transparent: boolean = false;

  constructor(opts: MatcapMaterialOptions = {}) {
    super();
    if (opts.matcap !== undefined) this.matcap = opts.matcap;
    if (opts.color) this.color = { ...opts.color };
    if (opts.normalMap !== undefined) this.normalMap = opts.normalMap;
    if (opts.normalScale !== undefined) this.normalScale = opts.normalScale;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: MatcapMaterial): this {
    this.matcap = source.matcap;
    this.color = { ...source.color };
    this.normalMap = source.normalMap;
    this.normalScale = source.normalScale;
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
  clone(): MatcapMaterial {
    return new MatcapMaterial().copy(this);
  }
}
