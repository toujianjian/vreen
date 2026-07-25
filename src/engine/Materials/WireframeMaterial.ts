// WireframeMaterial — 线框材质。
//
// 参考 three.js MeshBasicMaterial(wireframe=true)+ 自定义 line shader。
// 设计为绘制 mesh 边缘的可见线框(常用于 debug / 风格化效果)。
//
// 限制:
//   - WebGL2 的 gl.lineWidth 在多数平台仅支持 1.0(>1 时由 driver 截断)
//   - 真正的粗线框需要 barycentric coord + fragment shader 实现
//   - 本材质 v1 用 gl.LINES 图元 + linewidth 字段(driver 限制下尽量宽)
//
// 用法:
//   const mat = new WireframeMaterial({ color: { r: 0, g: 1, b: 0 }, opacity: 0.7 });
//   mesh.material = mat;
//   // 渲染器需要把 geometry 的图元模式切到 LINES(由 WebGL2Renderer 检测 wireframe)

import { BasicMaterial, type RGB } from '../Core/Material';

export interface WireframeMaterialOptions {
  /** 线条颜色(线性 0..1,默认黑)。 */
  color?: RGB;
  /** 透明度 0..1(默认 1)。 */
  opacity?: number;
  /** 线宽(像素,默认 1)。driver 可能截断为 1。 */
  linewidth?: number;
  /** 是否透明。 */
  transparent?: boolean;
  /** 是否做深度测试(默认 true)。 */
  depthTest?: boolean;
  /** 是否写深度(默认 false,线框通常叠加在实心 mesh 上)。 */
  depthWrite?: boolean;
  /** 渲染顺序(默认 1,确保画在实心 mesh 之后)。 */
  renderOrder?: number;
}

/** WireframeMaterial 顶点 shader:输出 worldPos / uv(unlit)。 */
export const WIREFRAME_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;

out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/** WireframeMaterial 片段 shader:纯色输出。 */
export const WIREFRAME_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec3  u_color;
uniform float u_opacity;

void main() {
  outColor = vec4(u_color, u_opacity);
}
`;

export class WireframeMaterial extends BasicMaterial {
  override readonly type: string = 'Wireframe';
  /** 标志用于 instanceof 替代检测。 */
  readonly isWireframeMaterial: boolean = true;

  /** 线条颜色(线性 0..1,默认黑)。 */
  color: RGB = { r: 0, g: 0, b: 0 };
  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 线宽(像素)。driver 限制下可能被截断为 1。 */
  linewidth: number = 1;
  /** 是否透明。 */
  transparent: boolean = false;

  constructor(opts: WireframeMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.linewidth !== undefined) this.linewidth = opts.linewidth;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    // 线框默认不写深度(避免遮挡实心 mesh 后续渲染)
    this.depthWrite = opts.depthWrite !== undefined ? opts.depthWrite : false;
    if (opts.renderOrder !== undefined) this.renderOrder = opts.renderOrder;
    // 标记 wireframe,WebGL2Renderer 检测后切换图元模式为 LINES
    this.wireframe = true;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: WireframeMaterial): this {
    this.color = { ...source.color };
    this.opacity = source.opacity;
    this.linewidth = source.linewidth;
    this.transparent = source.transparent;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): WireframeMaterial {
    return new WireframeMaterial().copy(this);
  }
}
