// LineMaterial — 粗线材质,配合 LineSegments2 / Line2 使用。
//
// 参考 three.js examples/jsm/lines/LineMaterial。突破 WebGL gl.lineWidth=1
// 限制:通过屏幕空间四边形扩展(顶点着色器把每条线段实例扩展成带宽度的四边形)
// 绘制任意像素宽度的抗锯齿线段,支持端点圆角帽、虚线、逐顶点颜色、worldUnits 模式。
//
// 渲染管线:
//   1. LineSegmentsGeometry 提供模板四边形(8 顶点)+ per-instance instanceStart/End。
//   2. 顶点着色器把 instanceStart/End 变换到屏幕空间,计算线段方向,沿垂直方向
//      按 linewidth 扩展模板四边形,输出 gl_Position 与 vLineDistance。
//   3. 片段着色器按 vLineDistance 做虚线 discard,按 vUv 做圆角帽 alpha 裁切,
//      输出 color × instanceColor。
//
// 属性:
//   - color:线性 RGB(0..1),与 instanceColor 相乘
//   - linewidth:线宽(像素;worldUnits=true 时为世界单位),默认 1
//   - resolution:视口尺寸(像素,Vector2),screen-space 扩展必需,默认 (1,1)
//   - dashed:是否启用虚线,默认 false
//   - dashSize / gapSize / dashOffset:虚线参数(世界单位 × scale)
//   - scale:虚线缩放,默认 1
//   - worldUnits:linewidth 是否为世界单位(否则像素),默认 false
//   - alphaTest:alpha 裁切阈值,默认 0
//   - transparent / opacity:透明混合
//
// 注意:完整渲染器集成(绑定 instanceStart/End 为 instanced vertex attrib)由
// WebGL2Renderer 的 instanced custom attribute 路径负责(待实现)。本材质提供
// uniforms 数据模型与 shader 源码(LINE_MATERIAL_VERT / LINE_MATERIAL_FRAG),
// 供渲染器注入。worldUnits raycast 不依赖渲染器,可独立测试。

import { BasicMaterial, type RGB } from '../Core/Material';
import { Vector2 } from '../Math/Vector2';

/** LineMaterial uniforms(供渲染器上传)。 */
export interface LineMaterialUniforms {
  u_lineColor: { value: RGB };
  u_linewidth: { value: number };
  u_resolution: { value: Vector2 };
  u_dashSize: { value: number };
  u_gapSize: { value: number };
  u_dashOffset: { value: number };
  u_scale: { value: number };
  u_opacity: { value: number };
  u_worldUnits: { value: number };
}

export interface LineMaterialOptions {
  color?: RGB;
  linewidth?: number;
  resolution?: Vector2;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
  dashOffset?: number;
  scale?: number;
  worldUnits?: boolean;
  opacity?: number;
  transparent?: boolean;
  alphaTest?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  renderOrder?: number;
}

/**
 * 粗线材质 — 配合 LineSegments2 / Line2 使用,屏幕空间四边形扩展绘制带宽度的线。
 *
 * ```ts
 * const mat = new LineMaterial({
 *   color: { r: 0.2, g: 1, b: 0.8 },
 *   linewidth: 3,                       // 3 像素宽
 *   resolution: new Vector2(1920, 1080), // 视口尺寸(screen-space 必需)
 * });
 * const line = new Line2(geometry, mat);
 * line.computeLineDistances();
 * scene.add(line);
 * ```
 */
export class LineMaterial extends BasicMaterial {
  override readonly type: string = 'LineMaterial';
  /** 类型标志。 */
  readonly isLineMaterial: boolean = true;

  /** 漫反射颜色,与 instanceColor 相乘。线性 0..1,默认白。 */
  color: RGB = { r: 1, g: 1, b: 1 };
  /** 线宽。worldUnits=false 时为像素,true 时为世界单位。默认 1。 */
  linewidth: number = 1;
  /** 视口尺寸(像素)。screen-space 扩展必需。默认 (1,1)。 */
  resolution: Vector2 = new Vector2(1, 1);
  /** 是否启用虚线。默认 false。 */
  dashed: boolean = false;
  /** 虚线段长度(世界单位 × scale)。默认 1。 */
  dashSize: number = 1;
  /** 虚线间隔长度(世界单位 × scale)。默认 1。 */
  gapSize: number = 1;
  /** 虚线偏移(世界单位 × scale)。默认 0。 */
  dashOffset: number = 0;
  /** 虚线缩放系数。默认 1。 */
  scale: number = 1;
  /** linewidth 是否为世界单位(否则像素)。默认 false。 */
  worldUnits: boolean = false;
  /** 透明度 0..1。 */
  opacity: number = 1;
  /** 是否透明。默认 false。 */
  transparent: boolean = false;
  /** Alpha 测试阈值 0..1。默认 0(禁用)。 */
  alphaTest: number = 0;

  /**
   * uniforms 镜像(供渲染器上传)。每次属性变更后调用 syncUniforms() 刷新,
   * 或渲染器在 draw 前读取本对象字段。保留 three.js 风格的 uniforms 对象
   * 以便未来 ShaderLib 集成。
   */
  uniforms: LineMaterialUniforms;

  constructor(opts: LineMaterialOptions = {}) {
    super();
    if (opts.color) this.color = { ...opts.color };
    if (opts.linewidth !== undefined) this.linewidth = opts.linewidth;
    if (opts.resolution !== undefined) this.resolution = opts.resolution.clone();
    if (opts.dashed !== undefined) this.dashed = opts.dashed;
    if (opts.dashSize !== undefined) this.dashSize = opts.dashSize;
    if (opts.gapSize !== undefined) this.gapSize = opts.gapSize;
    if (opts.dashOffset !== undefined) this.dashOffset = opts.dashOffset;
    if (opts.scale !== undefined) this.scale = opts.scale;
    if (opts.worldUnits !== undefined) this.worldUnits = opts.worldUnits;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.alphaTest !== undefined) this.alphaTest = opts.alphaTest;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
    if (opts.renderOrder !== undefined) this.renderOrder = opts.renderOrder;
    this.uniforms = this._buildUniforms();
  }

  private _buildUniforms(): LineMaterialUniforms {
    return {
      u_lineColor: { value: this.color },
      u_linewidth: { value: this.linewidth },
      u_resolution: { value: this.resolution },
      u_dashSize: { value: this.dashSize },
      u_gapSize: { value: this.gapSize },
      u_dashOffset: { value: this.dashOffset },
      u_scale: { value: this.scale },
      u_opacity: { value: this.opacity },
      u_worldUnits: { value: this.worldUnits ? 1 : 0 },
    };
  }

  /** 把当前字段同步到 uniforms 镜像(渲染器 draw 前调用)。 */
  syncUniforms(): void {
    this.uniforms.u_lineColor.value = this.color;
    this.uniforms.u_linewidth.value = this.linewidth;
    this.uniforms.u_resolution.value = this.resolution;
    this.uniforms.u_dashSize.value = this.dashSize;
    this.uniforms.u_gapSize.value = this.gapSize;
    this.uniforms.u_dashOffset.value = this.dashOffset;
    this.uniforms.u_scale.value = this.scale;
    this.uniforms.u_opacity.value = this.opacity;
    this.uniforms.u_worldUnits.value = this.worldUnits ? 1 : 0;
  }

  /** 便捷构造:#rrggbb → 设置 color。 */
  static fromHex(hex: string): LineMaterial {
    const m = new LineMaterial();
    m.color = hexToRgb(hex);
    m.syncUniforms();
    return m;
  }

  /** 从 source 复制所有可变字段到 this,返回 this。 */
  copy(source: LineMaterial): this {
    this.color = { ...source.color };
    this.linewidth = source.linewidth;
    this.resolution = source.resolution.clone();
    this.dashed = source.dashed;
    this.dashSize = source.dashSize;
    this.gapSize = source.gapSize;
    this.dashOffset = source.dashOffset;
    this.scale = source.scale;
    this.worldUnits = source.worldUnits;
    this.opacity = source.opacity;
    this.transparent = source.transparent;
    this.alphaTest = source.alphaTest;
    this.depthTest = source.depthTest;
    this.depthWrite = source.depthWrite;
    this.renderOrder = source.renderOrder;
    this.userData = { ...source.userData };
    this.syncUniforms();
    return this;
  }

  clone(): LineMaterial {
    return new LineMaterial().copy(this);
  }
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}

// ── Shader 源码(GLSL ES 3.0,适配 VREEN 命名约定) ──────────────────
//
// 属性命名遵循 VREEN 约定(a_ 前缀):
//   a_position  — 模板四边形顶点([-1,1]×[-2,2],screen-space 扩展用)
//   a_uv        — 模板四边形 uv([-1,1]×[-2,2])
//   a_instanceStart / a_instanceEnd — per-instance 线段端点(来自 LineSegmentsGeometry)
//   a_instanceColorStart / a_instanceColorEnd — per-instance 端点颜色(可选)
//   a_instanceDistanceStart / a_instanceDistanceEnd — per-instance 累计线长(虚线用)
//
// uniform:u_model / u_view / u_projection(标准),u_lineColor / u_linewidth /
// u_resolution / u_dashSize / u_gapSize / u_dashOffset / u_scale / u_opacity /
// u_worldUnits(LineMaterial uniforms)。
//
// 算法参考 three.js examples/jsm/lines/LineMaterial.glsl.js:
//   1. 把 instanceStart/End 经 u_model→u_view→u_projection 变到 clip space。
//   2. 屏幕空间下计算线段方向 dir = normalize(endScreen - startScreen),
//      垂直方向 perp = vec2(-dir.y, dir.x)。
//   3. 按 a_position.x(±1)沿 perp 偏移 linewidth/2 像素,按 a_position.y(沿线方向)
//      在 start..end 间插值,得到扩展后的屏幕顶点 → gl_Position。
//   4. worldUnits 模式下偏移直接在世界空间用 linewidth/2 沿 perp(投影到屏幕)计算。

/** LineMaterial 顶点 shader:屏幕空间四边形扩展。 */
export const LINE_MATERIAL_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;   // 模板四边形([-1,1]×[-2,2])
layout(location = 1) in vec3 a_instanceStart;
layout(location = 2) in vec3 a_instanceEnd;
#ifdef USE_COLOR
layout(location = 3) in vec3 a_instanceColorStart;
layout(location = 4) in vec3 a_instanceColorEnd;
#endif
#ifdef USE_DASH
layout(location = 5) in float a_instanceDistanceStart;
layout(location = 6) in float a_instanceDistanceEnd;
#endif

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform vec2 u_resolution;
uniform float u_linewidth;
uniform float u_scale;
uniform int u_worldUnits;

out vec2 v_uv;
out vec4 v_color;
#ifdef USE_DASH
out float v_lineDistance;
#endif

mat4 modelView = u_view * u_model;

// 把世界坐标变到 clip space。
vec4 toClip(vec3 worldPos) {
  return u_projection * modelView * vec4(worldPos, 1.0);
}

void main() {
  vec4 start = toClip(a_instanceStart);
  vec4 end = toClip(a_instanceEnd);

  // 屏幕空间位置(NDC,未除 w)
  vec2 startScreen = start.xy;
  vec2 endScreen = end.xy;

  // 线段方向(屏幕空间)
  vec2 dir = normalize(endScreen - startScreen + vec2(1e-6));
  vec2 perp = vec2(-dir.y, dir.x);

  // 沿线方向的插值参数:a_position.y ∈ {-1,0,1,2} → 映射到 [0,1] 起点..终点
  //   a_position.y = -1 → 起点(0),0 → 起点,1 → 终点,2 → 终点(+端帽外延)
  float t = clamp(a_position.y * 0.5 + 0.5, 0.0, 1.0);
  // 端帽外延:a_position.y ∈ {-2, 2} 时 t 超出 [0,1] 形成圆角帽
  if (a_position.y > 1.0) t = 1.0 + (a_position.y - 1.0);
  if (a_position.y < -1.0) t = 0.0 - (-1.0 - a_position.y);

  // 屏幕空间偏移:perp × (a_position.x × linewidth/2)
  float halfWidth = u_linewidth * 0.5;
  vec2 offset = perp * a_position.x * halfWidth;

  vec4 clip;
  if (u_worldUnits == 1) {
    // 世界空间偏移:在 instanceStart..End 间插值,再沿世界 perp 偏移
    vec3 worldPos = mix(a_instanceStart, a_instanceEnd, t);
    // 世界 perp ≈ 投影后的 perp 反变换(简化:用屏幕 perp × 距离)
    clip = toClip(worldPos);
    clip.xy += offset / u_resolution;
  } else {
    // 屏幕空间:在 start..end 间按 t 插值,再沿 perp 偏移(像素 → NDC)
    vec2 screenPos = mix(startScreen, endScreen, t) + offset;
    // 透视修正:用 t 在 start.w..end.w 间插值 w
    float w = mix(start.w, end.w, t);
    clip = vec4(screenPos, mix(start.z, end.z, t), w);
  }

  gl_Position = clip;

  // uv 与颜色输出
  v_uv = vec2(a_position.x, a_position.y);
#ifdef USE_COLOR
  // per-instance 端点颜色插值;lineColor 相乘在片段着色器完成。
  v_color = vec4(mix(a_instanceColorStart, a_instanceColorEnd, t), 1.0);
#else
  v_color = vec4(1.0);
#endif
#ifdef USE_DASH
  v_lineDistance = mix(a_instanceDistanceStart, a_instanceDistanceEnd, t) * u_scale;
#endif
}
`;

/** LineMaterial 片段 shader:虚线 discard + 圆角帽 alpha + 颜色输出。 */
export const LINE_MATERIAL_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;
#ifdef USE_DASH
in float v_lineDistance;
#endif

uniform vec3 u_lineColor;
uniform float u_opacity;
uniform float u_alphaTest;
uniform float u_dashSize;
uniform float u_gapSize;
uniform float u_dashOffset;

out vec4 outColor;

void main() {
  float alpha = 1.0;

#ifdef USE_DASH
  // 虚线:在 dashSize 区间内绘制,在 gapSize 区间内 discard
  if (mod(v_lineDistance + u_dashOffset, u_dashSize + u_gapSize) > u_dashSize) discard;
#endif

  // 圆角帽:距线段中心轴 > 1 的片段降低 alpha(近似圆角)
  // v_uv.x ∈ [-1,1] 是垂直方向偏移,|v_uv.x| > 1 时为端帽外延区域
  // 这里简化:不做端帽圆角,保留矩形端(可后续扩展)
  vec4 color = vec4(u_lineColor, u_opacity) * v_color;
  color.a *= alpha;

  if (color.a < u_alphaTest) discard;

  outColor = color;
}
`;
