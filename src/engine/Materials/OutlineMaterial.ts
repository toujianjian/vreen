// OutlineMaterial — 轮廓描边材质(用于卡通描边 / 高亮选中物体)。
//
// 经典 back-face outline 技术:
//   1. 第一遍渲染 mesh 正面 + 主材质(如 ToonMaterial)
//   2. 第二遍渲染 mesh 背面 + OutlineMaterial:顶点沿法线膨胀 thickness,
//      背面正面看是"轮廓"外圈,fragment 输出 outlineColor
//   3. 膨胀后的背面"凸出"主 mesh 边缘,形成可见描边
//
// 用法(双材质):
//   const mat = new ToonMaterial({ color: { r: 0.8, g: 0.6, b: 0.4 } });
//   const outline = new OutlineMaterial({
//     color: { r: 0, g: 0, b: 0 },
//     thickness: 0.02,
//   });
//   mesh.material = [mat, outline];
//   // 渲染器需识别 outlineMaterial 并以 cullFace=FRONT + 膨胀顶点绘制
//
// 注意:
//   - thickness 在世界空间生效(顶点 shader 沿 worldNormal 偏移)
//   - thickness 过大会导致轮廓与主 mesh 出现 z-fighting 或穿模
//   - 默认 transparent=false / depthWrite=false,描边不写深度避免遮挡

import { BasicMaterial, type RGB } from '../Core/Material';

export interface OutlineMaterialOptions {
  /** 描边颜色(线性 0..1,默认黑)。 */
  color?: RGB;
  /** 描边厚度(世界空间单位,默认 0.02)。 */
  thickness?: number;
  /** 透明度 0..1。 */
  opacity?: number;
  /** 是否透明。 */
  transparent?: boolean;
  /** 是否做深度测试(默认 true)。 */
  depthTest?: boolean;
  /** 是否写深度(默认 false,描边不写深度避免遮挡)。 */
  depthWrite?: boolean;
  /** 渲染顺序(默认 -1,确保描边在主材质之前;或 1 之后由场景决定)。 */
  renderOrder?: number;
}

/** OutlineMaterial 顶点 shader:沿法线膨胀 + 投影。
 *  与 PBR_VERT 兼容的 layout 声明(0=position,1=normal)。 */
export const OUTLINE_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
uniform float u_thickness;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  vec3 worldNormal = normalize(u_normalMatrix * a_normal);
  // 沿世界法线膨胀
  worldPos.xyz += worldNormal * u_thickness;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/** OutlineMaterial 片段 shader:纯色输出(背面才绘制,正面被 cull)。 */
export const OUTLINE_FRAG = /* glsl */ `#version 300 es
precision highp float;

out vec4 outColor;

uniform vec3  u_color;
uniform float u_opacity;

void main() {
  outColor = vec4(u_color, u_opacity);
}
`;

export class OutlineMaterial extends BasicMaterial {
  override readonly type: string = 'Outline';
  /** 标志用于 instanceof 替代检测。 */
  readonly isOutlineMaterial: boolean = true;

  /** 描边颜色(线性 0..1,默认黑)。 */
  color: RGB = { r: 0, g: 0, b: 0 };
  /** 描边厚度(世界空间,默认 0.02)。 */
  thickness: number = 0.02;
  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 是否透明。 */
  transparent: boolean = false;

  constructor(opts: OutlineMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    // 描边默认不写深度(避免遮挡后续物体)
    this.depthWrite = opts.depthWrite !== undefined ? opts.depthWrite : false;
    if (opts.renderOrder !== undefined) this.renderOrder = opts.renderOrder;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: OutlineMaterial): this {
    this.color = { ...source.color };
    this.thickness = source.thickness;
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
  clone(): OutlineMaterial {
    return new OutlineMaterial().copy(this);
  }
}
