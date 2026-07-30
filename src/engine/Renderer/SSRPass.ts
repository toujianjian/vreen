// SSRPass — 屏幕空间反射 (Screen-Space Reflection) 后处理 Pass (增强版)。
//
// 设计目标:
//   - 基于 GBuffer 的世界位置 + 世界法线 + 材质 roughness 做屏幕空间射线步进,
//     产生低开销的反射效果(对金属 / 湿润表面 / 镜面物体尤为有效)。
//   - 不继承 RenderPass 抽象(签名需 GBuffer 整体对象 + 多纹理绑定),
//     独立管理内部 FBO + 程序,与 DeferredRenderer 同构。
//   - 支持 resolutionScale 降采样(典型 0.5)以减轻 GPU 负担。
//   - 支持 roughnessCutoff(粗糙度高于阈值的像素不产生反射)。
//   - 支持 maxDistance / fadeDistance 控制反射距离与边缘淡出。
//   - temporalEnabled 标记位预留(时间抗锯齿累积,需外部 velocity texture;
//     当前版本不实现 TAA,仅保留 API)。
//
// 与 PostProcess/SSRPass 的区别:
//   - 本类位于 Renderer/ 顶层,API 更完整(maxDistance / fadeDistance /
//     roughnessCutoff / stepSize / temporalEnabled);
//   - 接收 GBuffer 整体对象(而非单独传 position/normal 纹理);
//   - 通过 getReflectionBuffer() / getStats() 提供缓冲与统计查询。
//
// 流程:
//   1. render() 首次调用时按 canvas.width * resolutionScale ×
//      canvas.height * resolutionScale 分配内部 FBO + RGBA16F 颜色纹理
//      + 编译 SSR 程序;
//   2. 绑定 FBO + 视口 → 画全屏四边形,fragment shader 读 input/position/
//      normal/material 四张纹理做 ray march + 二分查找 + 边缘/距离衰减;
//   3. 输出纹理可被下游 pass 采样或合成回主颜色缓冲。
//
// 不变量:
//   - enabled=false 时 render() 直接返回 input,不分配资源;
//   - dispose 后再调用 render 会重新分配资源(懒重建);
//   - setResolutionScale() 修改比例后,下一帧 render 自动重建;
//   - 内部纹理为 RGBA16F(高动态范围场景反射需要负数 / >1 的值);
//   - 输出纹理所有权归 Pass,调用方不得释放。

import type { Camera } from '../Cameras/Camera';
import type { GBuffer } from './GBuffer';
import { ShaderProgram } from './ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('SSRPass');

export interface SSRPassOptions {
  enabled?: boolean;
  maxSteps?: number;
  stepSize?: number;
  thickness?: number;
  maxDistance?: number;
  fadeDistance?: number;
  resolutionScale?: number;
  roughnessCutoff?: number;
  temporalEnabled?: boolean;
}

/** SSR Pass 统计信息。 */
export interface SSRStats {
  /** 累计 draw call 次数。 */
  drawCalls: number;
  /** 当前内部缓冲宽度(px)。 */
  width: number;
  /** 当前内部缓冲高度(px)。 */
  height: number;
  /** 当前分辨率缩放比例。 */
  resolutionScale: number;
  /** 当前最大步数。 */
  maxSteps: number;
  /** 当前粗糙度阈值。 */
  roughnessCutoff: number;
  /** 时间抗锯齿开关。 */
  temporalEnabled: boolean;
  /** 上一帧渲染耗时(ms)。 */
  lastFrameTimeMs: number;
}

// ── Shaders ───────────────────────────────────────────────────────────

const SSR_VERT_SRC = /* glsl */ `#version 300 es
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
 * SSR 片段着色器:基于 GBuffer 做屏幕空间射线步进反射。
 *
 * 输入纹理:
 *   u_colorMap    — 当前帧颜色
 *   u_positionMap — GBuffer 世界位置 (RGBA16F, xyz=worldPos)
 *   u_normalMap   — GBuffer 世界法线 (RGBA16F, xyz 编码到 [0,1])
 *   u_materialMap — GBuffer 材质 (RGBA8, g=roughness)
 *
 * uniforms:
 *   u_projection / u_view — 把世界位置投影到屏幕 UV
 *   u_cameraPos           — 视点位置
 *   u_screenSize          — 内部缓冲尺寸
 *   u_maxSteps            — 射线步进次数上限
 *   u_stepSize            — 步长(世界单位)
 *   u_thickness           — 厚度容差(世界单位)
 *   u_maxDistance         — 最大反射距离
 *   u_fadeDistance        — 边缘淡出距离
 *   u_roughnessCutoff     — 粗糙度阈值(高于此值不反射)
 */
const SSR_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_positionMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_materialMap;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform int   u_maxSteps;
uniform float u_stepSize;
uniform float u_thickness;
uniform float u_maxDistance;
uniform float u_fadeDistance;
uniform float u_roughnessCutoff;

// 把世界位置投影到屏幕 UV(0..1)。
vec2 projectToUV(vec3 worldPos) {
  vec4 clip = u_projection * u_view * vec4(worldPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

// 厚度检测:UV 越界返回 false;否则比较 sampledPos.z 与 rayPos.z,
// 当几何在射线前方(深度差为正)且在厚度内 → 击中。
bool hitTest(vec3 rayPos, vec2 uv, out float depthDiff) {
  depthDiff = 1e9;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return false;
  vec3 sampledPos = texture(u_positionMap, uv).xyz;
  depthDiff = sampledPos.z - rayPos.z;
  return depthDiff > 0.0 && depthDiff < u_thickness;
}

void main() {
  vec3 sceneColor  = texture(u_colorMap,    v_uv).rgb;
  vec3 worldPos    = texture(u_positionMap, v_uv).xyz;
  vec3 nrmEncoded  = texture(u_normalMap,   v_uv).xyz;
  vec4 material    = texture(u_materialMap, v_uv);
  float roughness  = material.g;

  // 法线过小 → 几何未写入,直接输出原色(避免反射空中)
  if (length(nrmEncoded) < 0.01) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 粗糙度高于阈值 → 不反射
  if (roughness > u_roughnessCutoff) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  vec3 worldNormal = normalize(nrmEncoded * 2.0 - 1.0);
  vec3 viewDir  = normalize(u_cameraPos - worldPos);
  vec3 reflDir  = reflect(-viewDir, worldNormal);

  vec3 stepDir  = reflDir * u_stepSize;
  vec3 rayPos   = worldPos + stepDir;
  vec2 uv       = projectToUV(rayPos);
  vec2 hitUV    = uv;
  vec3 hitPos   = rayPos;
  bool  hit     = false;
  float totalDist = 0.0;

  // Ray march (GLSL ES 3.0 要求循环上界为常量,用 256 作硬上限)
  for (int i = 0; i < 256; i++) {
    if (i >= u_maxSteps) break;
    if (totalDist > u_maxDistance) break;
    float dd;
    if (hitTest(rayPos, uv, dd)) {
      hit    = true;
      hitPos = rayPos;
      hitUV  = uv;
      break;
    }
    rayPos += stepDir;
    totalDist += u_stepSize;
    uv = projectToUV(rayPos);
  }

  // 二分查找细化(8 步足够把误差压到 thickness/256)
  if (hit) {
    vec3 lo = worldPos;
    vec3 hi = hitPos;
    for (int i = 0; i < 8; i++) {
      vec3 mid   = (lo + hi) * 0.5;
      vec2 midUV = projectToUV(mid);
      float dd;
      if (hitTest(mid, midUV, dd)) {
        hi     = mid;
        hitUV  = midUV;
      } else {
        lo = mid;
      }
    }
  }

  if (hit) {
    vec3 reflectionColor = texture(u_colorMap, hitUV).rgb;

    // 边缘衰减:命中 UV 越靠近屏幕边缘,反射越弱
    vec2  edgeDist = min(hitUV, 1.0 - hitUV);
    float edgeFade = smoothstep(0.0, 0.1, min(edgeDist.x, edgeDist.y));

    // 距离衰减:反射射线走过的距离越长,反射越弱
    float distFade = 1.0 - smoothstep(0.0, u_fadeDistance, totalDist);

    // Fresnel 权重:掠射角反射更强
    float fresnel = pow(1.0 - max(dot(viewDir, worldNormal), 0.0), 3.0);

    // 粗糙度影响反射强度(越光滑反射越强)
    float roughnessFactor = u_roughnessCutoff > 0.0
      ? 1.0 - (roughness / u_roughnessCutoff)
      : 1.0;

    float strength = edgeFade * distFade * (0.5 + 0.5 * fresnel) * roughnessFactor;
    outColor = vec4(mix(sceneColor, reflectionColor, clamp(strength, 0.0, 1.0)), 1.0);
  } else {
    outColor = vec4(sceneColor, 1.0);
  }
}
`;

// ── SSRPass ───────────────────────────────────────────────────────────

/**
 * 屏幕空间反射 Pass(增强版)。独立管理内部 FBO 与程序。
 *
 * 典型用法:
 * ```ts
 * const ssr = new SSRPass(gl, { resolutionScale: 0.5 });
 * function frame() {
 *   const reflection = ssr.render(colorTexture, gbuffer, camera);
 *   // 下游合成 reflection 回主颜色缓冲
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class SSRPass {
  readonly name = 'ssr';

  /** 是否启用。禁用时 render() 直接返回 input。 */
  enabled: boolean = true;
  /** 射线步进次数上限(0..256,shader 硬上限 256)。 */
  maxSteps: number = 64;
  /** 步长(世界单位)。值太小会漏检;太大会跳过薄几何。 */
  stepSize: number = 0.1;
  /** 厚度容差(世界单位)。射线击中检测的深度差上限。 */
  thickness: number = 0.5;
  /** 最大反射距离(世界单位)。超出此距离停止步进。 */
  maxDistance: number = 100.0;
  /** 边缘淡出距离(世界单位)。反射射线走过此距离后开始衰减。 */
  fadeDistance: number = 50.0;
  /** 分辨率缩放(0..1)。1.0 = 全分辨率,0.5 = 半分辨率(默认推荐)。 */
  resolutionScale: number = 0.5;
  /** 粗糙度阈值(0..1)。高于此值的像素不产生反射。 */
  roughnessCutoff: number = 0.6;
  /** 时间抗锯齿开关(预留,当前版本不实现 TAA 累积)。 */
  temporalEnabled: boolean = false;

  private _gl: WebGL2RenderingContext;
  /** 当前输出纹理(render 后可用,null 表示尚未渲染或已 dispose)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
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

  constructor(gl: WebGL2RenderingContext, opts: SSRPassOptions = {}) {
    this._gl = gl;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.maxSteps !== undefined) this.maxSteps = opts.maxSteps;
    if (opts.stepSize !== undefined) this.stepSize = opts.stepSize;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.maxDistance !== undefined) this.maxDistance = opts.maxDistance;
    if (opts.fadeDistance !== undefined) this.fadeDistance = opts.fadeDistance;
    if (opts.resolutionScale !== undefined) this.resolutionScale = opts.resolutionScale;
    if (opts.roughnessCutoff !== undefined) this.roughnessCutoff = opts.roughnessCutoff;
    if (opts.temporalEnabled !== undefined) this.temporalEnabled = opts.temporalEnabled;
  }

  /**
   * 执行 SSR。
   *
   * @param input   当前帧颜色纹理
   * @param gBuffer GBuffer(提供 position / normal / material 纹理)
   * @param camera  当前相机(读取 projection / view / position)
   * @returns       SSR 输出纹理(本 Pass 持有,不要释放);禁用时返回 input
   */
  render(input: WebGLTexture, gBuffer: GBuffer, camera: Camera): WebGLTexture {
    if (!this.enabled) return input;

    // 先校验 GBuffer 纹理齐全,缺失则直接返回 input(不分配资源)
    const posTex = gBuffer.getPosition();
    const nrmTex = gBuffer.getNormal();
    const matTex = gBuffer.getMaterial();
    if (!posTex || !nrmTex || !matTex) {
      log.warn('GBuffer missing required textures (position/normal/material), skipping SSR');
      return input;
    }

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

    // 绑定内部 FBO → 写 SSR 输出
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram();
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, posTex);
    prog.setUniformSampler('u_positionMap', 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, nrmTex);
    prog.setUniformSampler('u_normalMap', 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, matTex);
    prog.setUniformSampler('u_materialMap', 3);

    prog.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    prog.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1i('u_maxSteps', Math.max(0, Math.min(256, Math.floor(this.maxSteps))));
    prog.setUniform1f('u_stepSize', this.stepSize);
    prog.setUniform1f('u_thickness', this.thickness);
    prog.setUniform1f('u_maxDistance', this.maxDistance);
    prog.setUniform1f('u_fadeDistance', this.fadeDistance);
    prog.setUniform1f('u_roughnessCutoff', this.roughnessCutoff);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._drawCalls++;

    // 还原默认 FBO + 视口(避免影响后续渲染)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);

    this._lastFrameTimeMs = performance.now() - t0;
    return this._outputTexture as WebGLTexture;
  }

  /** 启用/禁用 Pass。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 设置最大步数(0..256,超出范围 clamp)。 */
  setMaxSteps(steps: number): void {
    this.maxSteps = Math.max(0, Math.min(256, Math.floor(steps)));
  }

  /** 设置步长(世界单位,最小 0.001)。 */
  setStepSize(size: number): void {
    this.stepSize = Math.max(0.001, size);
  }

  /** 设置厚度容差(世界单位,最小 0.001)。 */
  setThickness(thickness: number): void {
    this.thickness = Math.max(0.001, thickness);
  }

  /** 设置粗糙度阈值(0..1,超出范围 clamp)。 */
  setRoughnessCutoff(cutoff: number): void {
    this.roughnessCutoff = Math.max(0, Math.min(1, cutoff));
  }

  /** 设置分辨率缩放(0.05..1.0)。值变更后下一帧 render 自动重建。 */
  setResolutionScale(scale: number): void {
    const clamped = Math.max(0.05, Math.min(1.0, scale));
    if (Math.abs(clamped - this.resolutionScale) > 1e-6) {
      this.resolutionScale = clamped;
      this._dirty = true;
    }
  }

  /** 设置时间抗锯齿开关(预留,当前版本不实现 TAA 累积)。 */
  setTemporalEnabled(enabled: boolean): void {
    this.temporalEnabled = enabled;
  }

  /** 获取反射缓冲纹理(未渲染或已 dispose 时返回 null)。 */
  getReflectionBuffer(): WebGLTexture | null {
    return this._outputTexture;
  }

  /** 获取统计信息。 */
  getStats(): SSRStats {
    return {
      drawCalls: this._drawCalls,
      width: this._width,
      height: this._height,
      resolutionScale: this.resolutionScale,
      maxSteps: this.maxSteps,
      roughnessCutoff: this.roughnessCutoff,
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
    if (this._fbo) {
      gl.deleteFramebuffer(this._fbo);
      this._fbo = null;
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
    this._program = new ShaderProgram(this._gl, SSR_VERT_SRC, SSR_FRAG_SRC);
    log.info(`SSR program compiled (maxSteps=${this.maxSteps})`);
    return this._program;
  }

  /** (重新)分配内部 FBO + 纹理 + 全屏四边形 VAO。 */
  private _initResources(width: number, height: number): void {
    const gl = this._gl;
    // 释放旧资源
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RGBA16F 输出纹理(反射可能 > 1.0,需浮点)
    const tex = gl.createTexture();
    if (!tex) throw new Error('SSRPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA16F,
      width, height, 0,
      gl.RGBA, gl.HALF_FLOAT, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('SSRPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO(position@0 + uv@2,与 POST_VERT 一致)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('SSRPass: createVertexArray/Buffer() returned null');
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

    this._outputTexture = tex;
    this._fbo = fbo;
    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`SSR FBO created: ${width}x${height} (scale=${this.resolutionScale})`);
  }
}
