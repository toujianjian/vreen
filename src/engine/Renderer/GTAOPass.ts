// GTAOPass — Ground Truth Ambient Occlusion 后处理 Pass (顶层增强版)。
//
// 设计目标:
//   - 基于 GBuffer 的世界位置 + 世界法线 + (可选)漫反射颜色做半球地平线
//     积分,产生比 SSAO 更精确的环境光遮蔽;
//   - 沿 N 个方向(默认 4)在屏幕空间采样,每方向找地平线角(horizon angle),
//     积分得到 AO;支持颜色渗透(color bleed)从邻域 albedo 采样;
//   - 支持时间抗锯齿(temporal):ping-pong 两张纹理,本帧结果与上帧 history
//     按 temporalScale 混合,减少噪声(与 TAAPass 同构的 ping-pong 策略);
//   - 支持 resolutionScale 降采样(典型 0.5)以减轻 GPU 负担。
//
// 与 PostProcess/GTAOPass 的区别:
//   - 本类位于 Renderer/ 顶层,API 更完整(samples / directions / falloff /
//     viewBias / intensity / colorBleed / temporal / resolutionScale);
//   - 接收 GBuffer 整体对象(而非单独传 depth/normal 纹理);
//   - 通过 getAOBuffer() / getStats() 提供缓冲与统计查询;
//   - 支持颜色渗透与时间抗锯齿,PostProcess 版仅基础 AO。
//
// 流程:
//   1. render() 首次调用时按 canvas.width * resolutionScale ×
//      canvas.height * resolutionScale 分配内部 FBO + RGBA8 颜色纹理
//      (temporal 时分配两张 ping-pong)+ 编译 GTAO 程序;
//   2. 绑定 output FBO + 视口 → 画全屏四边形,fragment shader 读
//      position/normal/(albedo)/history 四张纹理做地平线积分 → 输出 AO;
//   3. temporal 开启时,render 末尾交换 output ↔ history,使下帧的 history
//      为本帧的输出。
//
// 不变量:
//   - enabled=false 时 render() 直接返回 input,不分配资源;
//   - dispose 后再调用 render 会重新分配资源(懒重建);
//   - setResolutionScale() 修改比例后,下一帧 render 自动重建;
//   - 内部纹理为 RGBA8(AO 0..1,无需浮点);
//   - 输出纹理所有权归 Pass,调用方不得释放;
//   - GBuffer 缺失 position/normal 纹理时 render() 返回 input(不渲染)。

import type { Camera } from '../Cameras/Camera';
import type { GBuffer } from './GBuffer';
import { ShaderProgram } from './ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('GTAOPass');

export interface GTAOPassOptions {
  enabled?: boolean;
  radius?: number;
  samples?: number;
  directions?: number;
  falloff?: number;
  viewBias?: number;
  intensity?: number;
  colorBleed?: boolean;
  colorBleedIntensity?: number;
  temporalEnabled?: boolean;
  temporalScale?: number;
  resolutionScale?: number;
}

/** GTAOPass 统计信息。 */
export interface GTAOStats {
  /** 累计 draw call 次数。 */
  drawCalls: number;
  /** 当前内部缓冲宽度(px)。 */
  width: number;
  /** 当前内部缓冲高度(px)。 */
  height: number;
  /** 当前分辨率缩放比例。 */
  resolutionScale: number;
  /** 当前采样半径。 */
  radius: number;
  /** 当前每方向采样数。 */
  samples: number;
  /** 当前方向数。 */
  directions: number;
  /** 当前强度。 */
  intensity: number;
  /** 当前颜色渗透开关。 */
  colorBleed: boolean;
  /** 当前时间抗锯齿开关。 */
  temporalEnabled: boolean;
  /** 上一帧渲染耗时(ms)。 */
  lastFrameTimeMs: number;
}

// ── Shaders ───────────────────────────────────────────────────────────

const GTAO_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;

out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 1.0);
}
`;

/**
 * GTAO 片段着色器:基于 GBuffer 世界位置 + 世界法线做地平线积分。
 *
 * 输入纹理:
 *   u_colorMap    — 当前帧颜色(用于颜色渗透)
 *   u_positionMap — GBuffer 世界位置 (RGBA16F, xyz=worldPos)
 *   u_normalMap   — GBuffer 世界法线 (RGBA16F, xyz 编码到 [0,1])
 *   u_albedoMap   — GBuffer 漫反射颜色 (RGBA8,用于颜色渗透)
 *   u_historyMap  — 上帧 AO 输出(时间抗锯齿用;temporalEnabled=0 时绑定自身)
 *
 * uniforms:
 *   u_projection / u_view — 把世界位置投影到屏幕 UV
 *   u_cameraPos           — 视点位置
 *   u_screenSize          — 内部缓冲尺寸
 *   u_radius              — 采样半径(屏幕空间像素缩放)
 *   u_samples             — 每方向最大采样数(1..32)
 *   u_directions          — 方向数(1..8)
 *   u_falloff             — 距离衰减(世界单位)
 *   u_viewBias            — 视角偏移(避免自遮蔽,0..0.1)
 *   u_intensity           — 强度指数(>1 更锐利)
 *   u_colorBleed          — 1=启用颜色渗透
 *   u_colorBleedIntensity — 颜色渗透强度(0..1)
 *   u_temporalEnabled     — 1=启用时间抗锯齿
 *   u_temporalScale       — 时间混合因子(0..1,history 权重)
 */
const GTAO_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_positionMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_albedoMap;
uniform sampler2D u_historyMap;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform float u_radius;
uniform int   u_samples;
uniform int   u_directions;
uniform float u_falloff;
uniform float u_viewBias;
uniform float u_intensity;
uniform int   u_colorBleed;
uniform float u_colorBleedIntensity;
uniform int   u_temporalEnabled;
uniform float u_temporalScale;

// 把世界位置投影到屏幕 UV(0..1)。
vec2 projectToUV(vec3 worldPos) {
  vec4 clip = u_projection * u_view * vec4(worldPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

void main() {
  vec3 worldPos = texture(u_positionMap, v_uv).xyz;
  vec3 nrmEncoded = texture(u_normalMap, v_uv).xyz;

  // 法线过小 → 几何未写入,输出无遮蔽
  if (length(nrmEncoded) < 0.01) {
    outColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }

  vec3 normal = normalize(nrmEncoded * 2.0 - 1.0);
  vec3 viewDir = normalize(u_cameraPos - worldPos);

  // 视角偏移:把法线朝观察方向倾斜,减少自遮蔽
  vec3 biasNormal = normalize(normal + viewDir * u_viewBias);

  // 在切平面内取 N 个方向(0..2π 均匀分布)
  int dirs = max(1, min(8, u_directions));
  int smp = max(1, min(32, u_samples));

  vec2 texel = 1.0 / u_screenSize;
  float occlusion = 0.0;
  vec3 colorBleed = vec3(0.0);
  float bleedWeight = 0.0;

  for (int d = 0; d < 8; d++) {
    if (d >= dirs) break;
    float angle = float(d) / float(dirs) * 6.2831853;
    vec2 dir = vec2(cos(angle), sin(angle));

    float horizon = 0.0;

    for (int i = 1; i <= 32; i++) {
      if (i > smp) break;
      // 沿方向以递增步长采样(对数分布更集中近处)
      float t = float(i) / float(smp);
      vec2 offset = dir * texel * u_radius * t;
      vec2 sUV = v_uv + offset;
      if (sUV.x < 0.0 || sUV.x > 1.0 || sUV.y < 0.0 || sUV.y > 1.0) break;

      vec3 sPos = texture(u_positionMap, sUV).xyz;
      vec3 delta = sPos - worldPos;
      float dist = length(delta);
      if (dist < 1e-4) continue;
      if (dist > u_falloff) continue;

      vec3 sDir = delta / dist;
      // sin(angle above tangent plane)
      float sinA = dot(sDir, biasNormal);
      float horizonAngle = asin(clamp(sinA, -1.0, 1.0));
      horizon = max(horizon, horizonAngle);

      // 颜色渗透:从邻域 albedo 采样
      if (u_colorBleed == 1) {
        vec3 sAlbedo = texture(u_albedoMap, sUV).rgb;
        float w = 1.0 - smoothstep(0.0, u_falloff, dist);
        colorBleed += sAlbedo * w;
        bleedWeight += w;
      }
    }

    // GTAO 积分:ao += (1 - cos(horizon)) (近似)
    occlusion += 1.0 - cos(max(horizon, 0.0));
  }

  occlusion /= float(dirs);
  // intensity 指数调整(>1 更锐利)
  float ao = 1.0 - pow(clamp(occlusion, 0.0, 1.0), u_intensity);

  // 颜色渗透:把 albedo 染色混入 AO 通道
  vec3 finalColor = vec3(ao);
  if (u_colorBleed == 1 && bleedWeight > 0.0) {
    vec3 bleed = colorBleed / bleedWeight;
    finalColor = mix(vec3(ao), bleed * ao, u_colorBleedIntensity);
  }

  // 时间抗锯齿:与 history 混合
  if (u_temporalEnabled == 1) {
    vec4 history = texture(u_historyMap, v_uv);
    finalColor = mix(finalColor, history.rgb, u_temporalScale);
    ao = (finalColor.r + finalColor.g + finalColor.b) / 3.0;
  }

  outColor = vec4(finalColor, 1.0);
}
`;

// ── GTAOPass ──────────────────────────────────────────────────────────

/**
 * Ground Truth Ambient Occlusion Pass(增强版)。独立管理内部 FBO 与程序。
 *
 * 典型用法:
 * ```ts
 * const gtao = new GTAOPass(gl, { resolutionScale: 0.5, directions: 4 });
 * function frame() {
 *   const ao = gtao.render(colorTexture, gbuffer, camera);
 *   // 下游合成:sceneColor *= ao.rgb
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class GTAOPass {
  readonly name = 'gtao';

  /** 是否启用。禁用时 render() 直接返回 input。 */
  enabled: boolean = true;
  /** 采样半径(屏幕空间像素缩放,默认 0.5)。 */
  radius: number = 0.5;
  /** 每方向采样数(1..32,默认 16)。 */
  samples: number = 16;
  /** 方向数(1..8,默认 4)。 */
  directions: number = 4;
  /** 距离衰减(世界单位,默认 2.0)。 */
  falloff: number = 2.0;
  /** 视角偏移(0..0.1,默认 0.01,减少自遮蔽)。 */
  viewBias: number = 0.01;
  /** 强度指数(默认 1.5,>1 更锐利,<1 更柔)。 */
  intensity: number = 1.5;
  /** 是否启用颜色渗透(从邻域 albedo 采样)。 */
  colorBleed: boolean = false;
  /** 颜色渗透强度(0..1,默认 0.5)。 */
  colorBleedIntensity: number = 0.5;
  /** 是否启用时间抗锯齿(与上帧 history 混合)。 */
  temporalEnabled: boolean = false;
  /** 时间混合因子(0..1,history 权重,默认 0.1)。 */
  temporalScale: number = 0.1;
  /** 分辨率缩放(0.05..1.0,默认 0.5)。 */
  resolutionScale: number = 0.5;

  private _gl: WebGL2RenderingContext;
  /** 当前输出纹理(render 后可用)。 */
  private _outputTexture: WebGLTexture | null = null;
  /** history 纹理(temporal 用,ping-pong 的另一张)。 */
  private _historyTexture: WebGLTexture | null = null;
  /** 输出 FBO(绑定 outputTexture)。 */
  private _outputFbo: WebGLFramebuffer | null = null;
  /** history FBO(绑定 historyTexture)。 */
  private _historyFbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  /** 全屏四边形 VAO(本 Pass 自管,position@0 + uv@2)。 */
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 当前内部缓冲尺寸(像素)。 */
  private _width: number = 0;
  private _height: number = 0;
  /** 是否已初始化。 */
  private _initialized: boolean = false;
  /** 标记下一帧需要重建(分辨率 / 尺寸变更)。 */
  private _dirty: boolean = true;
  /** 累计 draw call 次数。 */
  private _drawCalls: number = 0;
  /** 上一帧渲染耗时(ms)。 */
  private _lastFrameTimeMs: number = 0;

  constructor(gl: WebGL2RenderingContext, opts: GTAOPassOptions = {}) {
    this._gl = gl;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.radius !== undefined) this.radius = opts.radius;
    if (opts.samples !== undefined) this.samples = opts.samples;
    if (opts.directions !== undefined) this.directions = opts.directions;
    if (opts.falloff !== undefined) this.falloff = opts.falloff;
    if (opts.viewBias !== undefined) this.viewBias = opts.viewBias;
    if (opts.intensity !== undefined) this.intensity = opts.intensity;
    if (opts.colorBleed !== undefined) this.colorBleed = opts.colorBleed;
    if (opts.colorBleedIntensity !== undefined) this.colorBleedIntensity = opts.colorBleedIntensity;
    if (opts.temporalEnabled !== undefined) this.temporalEnabled = opts.temporalEnabled;
    if (opts.temporalScale !== undefined) this.temporalScale = opts.temporalScale;
    if (opts.resolutionScale !== undefined) this.resolutionScale = opts.resolutionScale;
  }

  /**
   * 执行 GTAO。
   *
   * @param input   当前帧颜色纹理(颜色渗透时被采样)
   * @param gBuffer GBuffer(提供 position / normal / albedo 纹理)
   * @param camera  当前相机(读取 projection / view / position)
   * @returns       AO 输出纹理(本 Pass 持有,不要释放);禁用时返回 input
   */
  render(input: WebGLTexture, gBuffer: GBuffer, camera: Camera): WebGLTexture {
    if (!this.enabled) return input;

    // 校验 GBuffer 纹理齐全,缺失则直接返回 input(不分配资源)
    const posTex = gBuffer.getPosition();
    const nrmTex = gBuffer.getNormal();
    if (!posTex || !nrmTex) {
      log.warn('GBuffer missing required textures (position/normal), skipping GTAO');
      return input;
    }
    const albedoTex = gBuffer.getAlbedo();

    const t0 = performance.now();
    const gl = this._gl;
    const canvasW = gl.canvas.width;
    const canvasH = gl.canvas.height;
    const targetW = Math.max(1, Math.floor(canvasW * this.resolutionScale));
    const targetH = Math.max(1, Math.floor(canvasH * this.resolutionScale));

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(targetW, targetH);
      this._dirty = false;
    }

    // 绑定 output FBO → 写 AO 输出
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._outputFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);  // AO 默认 1(无遮蔽)
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram();
    prog.use();

    // 绑定 GBuffer 纹理
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, posTex);
    prog.setUniformSampler('u_positionMap', 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, nrmTex);
    prog.setUniformSampler('u_normalMap', 2);

    // albedo 纹理:缺失时绑定 input 兜底(避免 GL 错误)
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, albedoTex ?? input);
    prog.setUniformSampler('u_albedoMap', 3);

    // history 纹理:temporal 关闭时绑定 output 自身(不读取)
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this._historyTexture ?? this._outputTexture);
    prog.setUniformSampler('u_historyMap', 4);

    // 相机 uniforms
    prog.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    prog.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);

    // AO 参数
    prog.setUniform1f('u_radius', this.radius);
    prog.setUniform1i('u_samples', Math.max(1, Math.min(32, Math.floor(this.samples))));
    prog.setUniform1i('u_directions', Math.max(1, Math.min(8, Math.floor(this.directions))));
    prog.setUniform1f('u_falloff', this.falloff);
    prog.setUniform1f('u_viewBias', this.viewBias);
    prog.setUniform1f('u_intensity', this.intensity);
    prog.setUniform1i('u_colorBleed', this.colorBleed ? 1 : 0);
    prog.setUniform1f('u_colorBleedIntensity', this.colorBleedIntensity);
    prog.setUniform1i('u_temporalEnabled', this.temporalEnabled ? 1 : 0);
    prog.setUniform1f('u_temporalScale', this.temporalScale);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._drawCalls++;

    // 还原默认 FBO + 视口
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);

    // temporal:交换 output ↔ history,使下帧 history 为本帧输出
    if (this.temporalEnabled) {
      this._swapHistory();
    }

    this._lastFrameTimeMs = performance.now() - t0;
    return this._outputTexture as WebGLTexture;
  }

  /** 启用/禁用 Pass。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 设置采样半径(最小 0)。 */
  setRadius(radius: number): void {
    this.radius = Math.max(0, radius);
  }

  /** 设置每方向采样数(1..32,clamp 并 floor)。 */
  setSamples(samples: number): void {
    this.samples = Math.max(1, Math.min(32, Math.floor(samples)));
  }

  /** 设置方向数(1..8,clamp 并 floor)。 */
  setDirections(directions: number): void {
    this.directions = Math.max(1, Math.min(8, Math.floor(directions)));
  }

  /** 设置距离衰减(最小 0.01)。 */
  setFalloff(falloff: number): void {
    this.falloff = Math.max(0.01, falloff);
  }

  /** 设置强度指数(最小 0.01)。 */
  setIntensity(intensity: number): void {
    this.intensity = Math.max(0.01, intensity);
  }

  /** 设置颜色渗透开关与强度。 */
  setColorBleed(enabled: boolean, intensity: number = this.colorBleedIntensity): void {
    this.colorBleed = enabled;
    this.colorBleedIntensity = Math.max(0, Math.min(1, intensity));
  }

  /** 设置时间抗锯齿开关与混合因子。 */
  setTemporal(enabled: boolean, scale: number = this.temporalScale): void {
    this.temporalEnabled = enabled;
    this.temporalScale = Math.max(0, Math.min(1, scale));
  }

  /** 设置分辨率缩放(0.05..1.0)。值变更后下一帧 render 自动重建。 */
  setResolutionScale(scale: number): void {
    const clamped = Math.max(0.05, Math.min(1.0, scale));
    if (Math.abs(clamped - this.resolutionScale) > 1e-6) {
      this.resolutionScale = clamped;
      this._dirty = true;
    }
  }

  /** 获取 AO 缓冲纹理(未渲染或已 dispose 时返回 null)。 */
  getAOBuffer(): WebGLTexture | null {
    return this._outputTexture;
  }

  /** 获取统计信息。 */
  getStats(): GTAOStats {
    return {
      drawCalls: this._drawCalls,
      width: this._width,
      height: this._height,
      resolutionScale: this.resolutionScale,
      radius: this.radius,
      samples: this.samples,
      directions: this.directions,
      intensity: this.intensity,
      colorBleed: this.colorBleed,
      temporalEnabled: this.temporalEnabled,
      lastFrameTimeMs: this._lastFrameTimeMs,
    };
  }

  /** 释放内部 FBO / 纹理 / VAO / program。可重复调用。 */
  dispose(): void {
    const gl = this._gl;
    if (this._outputTexture) {
      gl.deleteTexture(this._outputTexture);
      this._outputTexture = null;
    }
    if (this._historyTexture) {
      gl.deleteTexture(this._historyTexture);
      this._historyTexture = null;
    }
    if (this._outputFbo) {
      gl.deleteFramebuffer(this._outputFbo);
      this._outputFbo = null;
    }
    if (this._historyFbo) {
      gl.deleteFramebuffer(this._historyFbo);
      this._historyFbo = null;
    }
    if (this._fullscreenQuadVao) {
      gl.deleteVertexArray(this._fullscreenQuadVao);
      this._fullscreenQuadVao = null;
    }
    if (this._fullscreenQuadBuf) {
      gl.deleteBuffer(this._fullscreenQuadBuf);
      this._fullscreenQuadBuf = null;
    }
    if (this._program) {
      this._program.dispose();
      this._program = null;
    }
    this._initialized = false;
    this._width = 0;
    this._height = 0;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(this._gl, GTAO_VERT_SRC, GTAO_FRAG_SRC);
    log.info(`GTAO program compiled (directions=${this.directions}, samples=${this.samples})`);
    return this._program;
  }

  /** 交换 output ↔ history 纹理 + FBO(temporal 用)。 */
  private _swapHistory(): void {
    const tmpTex = this._outputTexture;
    this._outputTexture = this._historyTexture;
    this._historyTexture = tmpTex;

    const tmpFbo = this._outputFbo;
    this._outputFbo = this._historyFbo;
    this._historyFbo = tmpFbo;
  }

  /** (重新)分配内部 FBO + 纹理 + 全屏四边形 VAO。
   *  temporal 开启时分配两张纹理(output + history)做 ping-pong。 */
  private _initResources(width: number, height: number): void {
    const gl = this._gl;
    // 释放旧资源
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._historyTexture) gl.deleteTexture(this._historyTexture);
      if (this._outputFbo) gl.deleteFramebuffer(this._outputFbo);
      if (this._historyFbo) gl.deleteFramebuffer(this._historyFbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // 创建两张 RGBA8 纹理(output + history)
    const texA = this._createTexture(gl, width, height);
    const texB = this._createTexture(gl, width, height);
    const fboA = this._createFbo(gl, texA, width, height);
    const fboB = this._createFbo(gl, texB, width, height);

    // 全屏四边形 VAO(position@0 + uv@2,与 POST_VERT 一致)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('GTAOPass: createVertexArray/Buffer() returned null');
    const verts = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      1, 1, 1, 1,
      -1, -1, 0, 0,
      1, 1, 1, 1,
      -1, 1, 0, 1,
    ]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._outputTexture = texA;
    this._historyTexture = texB;
    this._outputFbo = fboA;
    this._historyFbo = fboB;
    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`GTAO FBO created: ${width}x${height} (scale=${this.resolutionScale}, temporal=${this.temporalEnabled})`);
  }

  private _createTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
    const tex = gl.createTexture();
    if (!tex) throw new Error('GTAOPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8,
      width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private _createFbo(gl: WebGL2RenderingContext, tex: WebGLTexture, _width: number, _height: number): WebGLFramebuffer {
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('GTAOPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  }
}
