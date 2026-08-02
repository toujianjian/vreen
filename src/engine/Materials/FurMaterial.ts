// FurMaterial — Shell-based 毛发材质。
//
// 设计思路:
//   Shell-based fur 是经典实时毛发技术:沿法线方向把同一网格复制 N 层
//   (N = shellCount,通常 16~32),每层在顶点 shader 中沿 normal 外推
//   `furLength * layerPercent` 距离;片段 shader 用噪声纹理决定该层
//   该像素是否属于毛发(毛发截面随 layerPercent 增大而稀疏,呈"毛尖"
//   形态)。所有层叠加形成体积毛发外观。
//
//   - 顶点 shader:沿法线外推 + 重力/风偏移(layerPercent 越大偏移越大)
//   - 片段 shader:噪声纹理 + furDensity 控制密度;furOcclusion 控制
//     根部阴影;furColor 染色
//   - 单层渲染 = 一个 draw call;N 层 = N 个 draw call,故 shellCount
//     不宜过大(16 是性能/质量平衡点)
//
// 与 FurShell 配合:
//   FurMaterial 持有着色器与参数;FurShell(Core/)负责生成多层 shell
//   网格并在每帧 update(dt) 时推进 u_time / 重力 / 风。
//
// 用法:
//   const furMat = new FurMaterial({ furLength: 0.2, furColor: new Color(0.8, 0.6, 0.4) });
//   const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 16 });
//   shell.generate();
//   // 每帧:
//   shell.update(dt);
//
// 注意:
//   - FurMaterial 继承自 BasicMaterial,与 ToonMaterial/OutlineMaterial 同级
//   - 渲染器在编译时识别 type === 'Fur' 走 FUR_VERT/FUR_FRAG 程序路径
//   - shellLayer / u_time 等 uniform 由 FurShell 在 draw 前设置
//   - 不支持阴影投射(多层 shell 投影阴影代价高,默认关闭 castShadow)

import { BasicMaterial, type ShaderObject } from '../Core/Material';
import { Color } from '../Math/Color';
import { Vector3 } from '../Math/Vector3';
import type { Texture } from '../Core/Texture';
import type { ShaderProgram } from '../Renderer/ShaderProgram';

export interface FurMaterialOptions {
  /** 毛发长度(世界空间,默认 0.1)。 */
  furLength?: number;
  /** 毛发密度 [0,1](噪声阈值,越高毛发越浓密,默认 0.5)。 */
  furDensity?: number;
  /** 毛发颜色(默认浅棕)。 */
  furColor?: Color;
  /** 毛根遮蔽强度 [0,1],毛尖越向根部越暗(默认 0.5)。 */
  furOcclusion?: number;
  /** 重力方向(世界空间,默认 (0,-1,0))。 */
  gravity?: Vector3;
  /** 风力方向 + 强度(世界空间,默认 (0,0,0) 无风)。 */
  wind?: Vector3;
  /** 噪声纹理(决定毛发分布;无则用内置 hash 噪声)。 */
  noiseTexture?: Texture | null;
  /** 透明度 0..1。 */
  opacity?: number;
  /** 是否透明(毛发通常需要 alpha test/blend,默认 true)。 */
  transparent?: boolean;
  /** 是否双面渲染(毛发从内侧也能看到,默认 true)。 */
  doubleSided?: boolean;
  /** 是否启用线框(调试)。 */
  wireframe?: boolean;
  /** 是否做深度测试。 */
  depthTest?: boolean;
  /** 是否写深度。 */
  depthWrite?: boolean;
  // ── Kajiya-Kay 各向异性毛发着色 ──
  /** 光照方向(世界空间,指向光源,默认 (1,1,1) 归一化)。 */
  lightDirection?: Vector3;
  /** 光照颜色(默认白)。 */
  lightColor?: Color;
  /** 毛根颜色(默认 null = 用 furColor)。 */
  rootColor?: Color | null;
  /** 毛尖颜色(默认 null = 用 furColor)。 */
  tipColor?: Color | null;
  /** 主高光颜色(默认白)。 */
  specularColor?: Color;
  /** 主高光指数(默认 64,越大高光越锐)。 */
  specularPower?: number;
  /** 次高光颜色(Marschner glint,默认暖色 (0.8,0.7,0.5))。 */
  secondarySpecularColor?: Color;
  /** 次高光指数(默认 16,比主高光更宽)。 */
  secondarySpecularPower?: number;
  /** 次高光切线偏移(朝毛根偏移,默认 0.1)。 */
  specularShift?: number;
}

/** FurMaterial 顶点 shader:沿法线外推 + 重力/风偏移。 */
export const FUR_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;

// Fur 专属 uniforms
uniform float u_furLength;       // 毛发总长度
uniform float u_shellLayer;      // 当前层 [0,1],0=毛根,1=毛尖
uniform vec3  u_gravity;         // 重力方向(世界空间)
uniform vec3  u_wind;            // 风力(世界空间)
uniform float u_time;            // 时间(用于风摆动)

out vec2 v_uv;
out float v_layer;               // 传给 frag 的当前层
out vec3 v_worldNormal;
out vec3 v_worldPos;              // 世界位置(用于视方向)

void main() {
  // 沿法线外推:毛根 (layer=0) 不外推,毛尖 (layer=1) 外推 furLength
  float ext = u_shellLayer * u_furLength;
  vec3 displaced = a_position + a_normal * ext;

  // 重力偏移:毛尖越远偏移越大(layer² 让根部更硬)
  float gravityScale = u_shellLayer * u_shellLayer;
  displaced += u_gravity * gravityScale * u_furLength;

  // 风力偏移:加上时间相关摆动(正弦扰动)
  float windScale = u_shellLayer * u_shellLayer;
  vec3 windForce = u_wind + vec3(
    sin(u_time * 2.0 + a_position.x * 5.0) * 0.1,
    0.0,
    cos(u_time * 1.7 + a_position.z * 5.0) * 0.1
  );
  displaced += windForce * windScale * u_furLength;

  vec4 worldPos = u_model * vec4(displaced, 1.0);
  v_uv = a_uv;
  v_layer = u_shellLayer;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_worldPos = worldPos.xyz;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/** FurMaterial 片段 shader:噪声密度 + Kajiya-Kay 各向异性毛发着色 + 根尖色梯度 + 尖端透明衰减。 */
export const FUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_layer;
in vec3 v_worldNormal;
in vec3 v_worldPos;

out vec4 outColor;

uniform vec3  u_furColor;          // 基础毛色(向后兼容,根/尖色未设时使用)
uniform float u_furDensity;        // 密度阈值 [0,1]
uniform float u_furOcclusion;      // 毛根遮蔽 [0,1]
uniform float u_opacity;
uniform int   u_noiseTexEnabled;
uniform sampler2D u_noiseTex;

// Kajiya-Kay 各向异性毛发着色 uniforms
uniform vec3  u_lightDir;          // 光照方向(世界空间,指向光源)
uniform vec3  u_lightColor;        // 光照颜色
uniform vec3  u_cameraPos;         // 相机位置(世界空间)
uniform vec3  u_rootColor;         // 毛根颜色
uniform vec3  u_tipColor;          // 毛尖颜色
uniform vec3  u_specularColor;     // 主高光颜色
uniform float u_specularPower;     // 主高光指数
uniform vec3  u_secondarySpecularColor; // 次高光颜色(Marschner glint)
uniform float u_secondarySpecularPower; // 次高光指数
uniform float u_specularShift;     // 次高光切线偏移(朝毛根偏移)

// 简易 hash 噪声(无纹理时使用)
float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  // 噪声采样:有纹理用纹理,无则用 hash
  float n;
  if (u_noiseTexEnabled == 1) {
    n = texture(u_noiseTex, v_uv).r;
  } else {
    n = hash(v_uv * 200.0);
  }

  // 密度阈值:层越靠毛尖越稀疏(layer² 让毛尖更细)
  float threshold = u_furDensity * (1.0 - v_layer * v_layer * 0.7);
  if (n < threshold) {
    discard;
  }

  // === Kajiya-Kay 各向异性毛发着色 ===
  // 毛发切线 T ≈ 生长方向(壳层沿法线外推,法线即切线)
  vec3 T = normalize(v_worldNormal);
  vec3 L = normalize(u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 H = normalize(L + V);

  // Kajiya-Kay 漫反射(圆柱体投影宽度 ∝ sinθ)
  float dotTL = dot(T, L);
  float sinTL = sqrt(max(0.0, 1.0 - dotTL * dotTL));
  float diffuse = sinTL;

  // 主高光(Kajiya-Kay specular:cos 叶沿切线 → sin 沿垂直平面)
  float dotTH = dot(T, H);
  float sinTH = sqrt(max(0.0, 1.0 - dotTH * dotTH));
  float spec1 = pow(sinTH, u_specularPower);

  // 次高光(偏移切线朝毛根,模拟 Marschner 的 glint 反射)
  vec3 Tshift = normalize(T - v_worldNormal * u_specularShift);
  float dotTH2 = dot(Tshift, H);
  float sinTH2 = sqrt(max(0.0, 1.0 - dotTH2 * dotTH2));
  float spec2 = pow(sinTH2, u_secondarySpecularPower);

  // 根/尖颜色梯度
  vec3 hairColor = mix(u_rootColor, u_tipColor, v_layer);

  // 毛根遮蔽:layer 越小越暗
  float occlusion = mix(1.0 - u_furOcclusion, 1.0, v_layer);

  // 组合光照:环境 + 漫反射 + 主高光 + 次高光
  vec3 color = hairColor * 0.2                                  // 环境
             + hairColor * u_lightColor * diffuse * 0.7         // 漫反射
             + u_specularColor * u_lightColor * spec1           // 主高光
             + u_secondarySpecularColor * u_lightColor * spec2 * 0.6; // 次高光
  color *= occlusion;

  // 尖端透明衰减(毛尖更透明,柔和轮廓)
  float tipAlpha = mix(1.0, 0.3, smoothstep(0.7, 1.0, v_layer));

  outColor = vec4(color, u_opacity * tipAlpha);
}
`;

export class FurMaterial extends BasicMaterial {
  override readonly type: string = 'Fur';
  /** 标志用于 instanceof 替代检测。 */
  readonly isFurMaterial: boolean = true;

  /** 毛发长度(世界空间)。 */
  furLength: number;
  /** 毛发密度 [0,1]。 */
  furDensity: number;
  /** 毛发颜色。 */
  furColor: Color;
  /** 毛根遮蔽强度 [0,1]。 */
  furOcclusion: number;
  /** 重力方向(世界空间)。 */
  gravity: Vector3;
  /** 风力方向 + 强度(世界空间)。 */
  wind: Vector3;
  /** 噪声纹理(可选)。 */
  noiseTexture: Texture | null;
  /** 透明度。 */
  opacity: number;
  /** 是否透明。 */
  transparent: boolean;
  /** 是否双面渲染。 */
  doubleSided: boolean;

  /** 当前 shell 层 [0,1](由 FurShell 在 draw 各层前设置)。 */
  shellLayer: number = 0;
  /** 当前时间(秒,由 FurShell.update 推进)。 */
  time: number = 0;
  /** Renderer 填入:已编译的 program。 */
  program: ShaderProgram | null = null;
  /** Program cache key。 */
  programKey: string = 'fur';

  // ── Kajiya-Kay 各向异性毛发着色参数 ──
  /** 光照方向(世界空间,指向光源)。 */
  lightDirection: Vector3;
  /** 光照颜色。 */
  lightColor: Color;
  /** 毛根颜色(null = 用 furColor)。 */
  rootColor: Color | null;
  /** 毛尖颜色(null = 用 furColor)。 */
  tipColor: Color | null;
  /** 主高光颜色。 */
  specularColor: Color;
  /** 主高光指数(越大越锐)。 */
  specularPower: number;
  /** 次高光颜色(Marschner glint)。 */
  secondarySpecularColor: Color;
  /** 次高光指数(比主高光更宽)。 */
  secondarySpecularPower: number;
  /** 次高光切线偏移(朝毛根偏移)。 */
  specularShift: number;

  constructor(opts: FurMaterialOptions = {}) {
    super();
    this.furLength = opts.furLength ?? 0.1;
    this.furDensity = opts.furDensity ?? 0.5;
    this.furColor = opts.furColor ? opts.furColor.clone() : new Color(0.6, 0.45, 0.3);
    this.furOcclusion = opts.furOcclusion ?? 0.5;
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -1, 0);
    this.wind = opts.wind ? opts.wind.clone() : new Vector3(0, 0, 0);
    this.noiseTexture = opts.noiseTexture ?? null;
    this.opacity = opts.opacity ?? 1;
    this.transparent = opts.transparent ?? true;
    this.doubleSided = opts.doubleSided ?? true;
    if (opts.wireframe !== undefined) this.wireframe = opts.wireframe;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    // Kajiya-Kay 着色参数
    this.lightDirection = opts.lightDirection
      ? opts.lightDirection.clone().normalize()
      : new Vector3(1, 1, 1).normalize();
    this.lightColor = opts.lightColor ? opts.lightColor.clone() : new Color(1, 1, 1);
    this.rootColor = opts.rootColor ? opts.rootColor.clone() : null;
    this.tipColor = opts.tipColor ? opts.tipColor.clone() : null;
    this.specularColor = opts.specularColor ? opts.specularColor.clone() : new Color(1, 1, 1);
    this.specularPower = opts.specularPower ?? 64;
    this.secondarySpecularColor = opts.secondarySpecularColor
      ? opts.secondarySpecularColor.clone()
      : new Color(0.8, 0.7, 0.5);
    this.secondarySpecularPower = opts.secondarySpecularPower ?? 16;
    this.specularShift = opts.specularShift ?? 0.1;
  }

  /** Convenience constructor: 从 hex 颜色构造。 */
  static fromHex(hex: string): FurMaterial {
    return new FurMaterial({ furColor: new Color(hex) });
  }

  override onBeforeCompile(_shader: ShaderObject, _renderer?: unknown): void {
    // 默认 no-op;子类可注入自定义 chunk(例如额外光照)。
  }

  override customProgramCacheKey(): string {
    return 'fur';
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: FurMaterial): this {
    this.furLength = source.furLength;
    this.furDensity = source.furDensity;
    this.furColor = source.furColor.clone();
    this.furOcclusion = source.furOcclusion;
    this.gravity = source.gravity.clone();
    this.wind = source.wind.clone();
    this.noiseTexture = source.noiseTexture;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.doubleSided = source.doubleSided;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.wireframe = source.wireframe;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    // Kajiya-Kay 着色参数
    this.lightDirection = source.lightDirection.clone();
    this.lightColor = source.lightColor.clone();
    this.rootColor = source.rootColor ? source.rootColor.clone() : null;
    this.tipColor = source.tipColor ? source.tipColor.clone() : null;
    this.specularColor = source.specularColor.clone();
    this.specularPower = source.specularPower;
    this.secondarySpecularColor = source.secondarySpecularColor.clone();
    this.secondarySpecularPower = source.secondarySpecularPower;
    this.specularShift = source.specularShift;
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): FurMaterial {
    return new FurMaterial().copy(this);
  }
}
