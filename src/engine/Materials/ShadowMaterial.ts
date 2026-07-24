// ShadowMaterial — 阴影专用材质(只渲染阴影,不渲染物体本身颜色)。
//
// 参考 three.js ShadowMaterial。设计目标:
//   - 把场景中其他物体接收到的阴影以透明叠加方式渲染出来;
//   - 自身不写 base color,只接收 u_shadowMap 采样的可见性因子,
//     输出 vec4(color, opacity * (1.0 - visibility));
//   - 默认 transparent=true / depthWrite=false,以便它只贡献阴影遮罩、
//     不阻挡后续物体。
//
// 与已有 StandardMaterial 区别:
//   - StandardMaterial 是 PBR 不透明主材质,会计算完整 Cook-Torrance 光照;
//   - ShadowMaterial 只关心阴影遮罩,shader 极简,性能开销低;
//   - ShadowMaterial 的 fragment shader 内联了 PCF_SHADOW_FRAG chunk。
//
// 用法:
//   const mat = new ShadowMaterial({ color: 0x000000, opacity: 0.5 });
//   mesh.material = mat; // 该 mesh 渲染时只显示阴影,本体透明
//
// 注意:本材质依赖 ShadowMapManager 已渲染好阴影贴图并绑定到 u_shadowMap。

import { BasicMaterial, type RGB } from '../Core/Material';
import { PBR_VERT, PCF_SHADOW_FRAG } from './shaders';

/** ShadowMaterial 构造选项。 */
export interface ShadowMaterialOptions {
  /** 阴影颜色(线性 0..1,默认黑色)。 */
  color?: RGB;
  /** 阴影不透明度 0..1(默认 0.5)。 */
  opacity?: number;
  /** 是否透明(默认 true,因为阴影通常需要混合到背景)。 */
  transparent?: boolean;
  /** 是否写深度(默认 false,只贡献 alpha 遮罩)。 */
  depthWrite?: boolean;
  /** 是否做深度测试(默认 true)。 */
  depthTest?: boolean;
}

/** 阴影材质 fragment shader 源码:复用 PBR_VERT 的 varyings,内联 PCF chunk。
 *  与 StandardMaterial 共享 PBR_VERT,所以 in 变量(v_worldPos 等)一致。 */
export const SHADOW_MATERIAL_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_color;
uniform float u_opacity;

// PCF chunk 依赖的 uniforms(由 renderer 在主 pass 写入)
uniform sampler2D u_shadowMap;
uniform mat4      u_lightVP;
uniform float     u_shadowBias;
uniform vec2      u_shadowMapSize;
uniform int       u_shadowEnabled;

${PCF_SHADOW_FRAG}

void main() {
  float visibility = sampleShadowPCF(v_worldPos);
  // visibility=1 表示完全被照亮(无阴影);=0 表示完全在阴影中。
  // 阴影部分以 u_color 与 u_opacity 输出,亮部输出透明(alpha=0)。
  float alpha = u_opacity * (1.0 - visibility);
  outColor = vec4(u_color, alpha);
}
`;

/** ShadowMaterial 顶点 shader:复用 PBR_VERT(共享 layout/in 声明)。 */
export const SHADOW_MATERIAL_VERT = PBR_VERT;

export class ShadowMaterial extends BasicMaterial {
  override readonly type: string = 'Shadow';

  /** 阴影颜色(线性 0..1)。默认黑色。 */
  color: RGB = { r: 0, g: 0, b: 0 };
  /** 阴影不透明度 0..1。默认 0.5。 */
  opacity: number = 0.5;
  /** 是否透明(默认 true)。 */
  transparent: boolean;

  constructor(opts: ShadowMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    // 默认 transparent=true,可被 opts.transparent=false 关闭。
    this.transparent = opts.transparent !== undefined ? opts.transparent : true;
    // depthWrite / depthTest 走基类默认(true),除非显式覆盖。
    // ShadowMaterial 默认不写深度,只贡献 alpha 遮罩。
    this.depthWrite = opts.depthWrite !== undefined ? opts.depthWrite : false;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
  }
}
