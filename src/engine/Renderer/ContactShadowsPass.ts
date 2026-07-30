// ContactShadowsPass — 接触阴影 (Contact Shadows) 后处理 Pass。
//
// 设计目标:
//   - 在物体与地面接触处产生柔和阴影,增强 grounded 感;
//   - 不依赖 GBuffer,仅基于输入颜色纹理的亮度作为高度代理
//     (与 RenderPass.ts 中 DOFPass 的 "亮度即深度" 哲学一致);
//   - 支持高斯 / 方框两种模糊核 (blurType),通过 samples / radius /
//     distance / falloff 控制阴影形态;
//   - groundHeight 作为高度场偏移,使阴影集中于地面附近的接触处。
//
// 与 RenderPass.ts 中 SSAOPass 的区别:
//   - SSAOPass 是边缘暗化 (邻域亮度对比),接触阴影关注 "接触处" 柔和阴影;
//   - ContactShadowsPass 独立管理内部 FBO + 程序,与 SSRPass 同构;
//   - 通过 getShadowBuffer() / getStats() 提供缓冲与统计查询。
//
// 流程:
//   1. render() 首次调用时按 canvas 尺寸分配内部 FBO + RGBA8 颜色纹理
//      + 编译接触阴影程序;
//   2. 绑定 FBO + 全屏视口 → 画全屏四边形,fragment shader 读 input 纹理,
//      在 disk 采样 pattern 内比较邻域亮度 (作为高度代理) → 计算遮蔽,
//      根据 blurType 应用高斯或方框核 → 输出阴影纹理 (R=G=B=shadow, A=1);
//   3. 输出纹理可被下游 pass 采样 (典型用法:与场景颜色相乘)。
//
// 不变量:
//   - enabled=false 时 render() 直接返回 input,不分配资源;
//   - dispose 后再调用 render 会重新分配资源 (懒重建);
//   - 内部纹理为 RGBA8 (阴影 0..1,无需浮点);
//   - 输出纹理所有权归 Pass,调用方不得释放。

import type { Camera } from '../Cameras/Camera';
import { ShaderProgram } from './ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('ContactShadowsPass');

export interface ContactShadowsPassOptions {
  enabled?: boolean;
  radius?: number;
  distance?: number;
  samples?: number;
  opacity?: number;
  falloff?: number;
  groundHeight?: number;
  blurType?: 'gaussian' | 'box';
}

/** ContactShadowsPass 统计信息。 */
export interface ContactShadowsStats {
  /** 累计 draw call 次数。 */
  drawCalls: number;
  /** 当前内部缓冲宽度(px)。 */
  width: number;
  /** 当前内部缓冲高度(px)。 */
  height: number;
  /** 当前模糊半径(texel 倍数)。 */
  radius: number;
  /** 当前采样数。 */
  samples: number;
  /** 当前模糊类型。 */
  blurType: 'gaussian' | 'box';
  /** 当前不透明度。 */
  opacity: number;
  /** 上一帧渲染耗时(ms)。 */
  lastFrameTimeMs: number;
}

// ── Shaders ───────────────────────────────────────────────────────────

const CONTACT_SHADOWS_VERT_SRC = /* glsl */ `#version 300 es
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
 * 接触阴影片段着色器:基于输入亮度作为高度代理,在 disk 内采样并比较
 * 邻域高度,计算接触处柔和阴影。
 *
 * 输入纹理:
 *   u_colorMap — 当前帧颜色(亮度作为高度场)
 *
 * uniforms:
 *   u_screenSize  — 内部缓冲尺寸
 *   u_radius      — 采样半径(texel 倍数)
 *   u_distance   — 采样距离缩放(影响搜索范围)
 *   u_samples    — 每像素采样数(1..32)
 *   u_opacity    — 阴影不透明度(0..1,1=最暗)
 *   u_falloff    — 距离衰减(越大阴影越集中于接触处)
 *   u_groundHeight — 地面高度偏移(亮度空间,0..1)
 *   u_blurType   — 0=gaussian, 1=box
 */
const CONTACT_SHADOWS_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2  u_screenSize;
uniform float u_radius;
uniform float u_distance;
uniform int   u_samples;
uniform float u_opacity;
uniform float u_falloff;
uniform float u_groundHeight;
uniform int   u_blurType;

// 亮度 → 高度代理 (Rec. 709 luma)
float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Halton 序列低差异采样 (简化版,2..3 位)
vec2 haltonSample(int i) {
  // 4 个方向的旋转角度 + 径向偏移
  float angle = float(i) * 2.3999633;  // golden angle
  float r = sqrt((float(i) + 0.5) / float(u_samples));
  return vec2(cos(angle), sin(angle)) * r;
}

void main() {
  vec3 baseColor = texture(u_colorMap, v_uv).rgb;
  float baseHeight = luminance(baseColor);

  // groundHeight 偏移:只有高度接近 groundHeight 的像素才生成接触阴影
  float heightDist = abs(baseHeight - u_groundHeight);

  vec2 texel = 1.0 / u_screenSize;
  float occlusion = 0.0;
  float totalWeight = 0.0;

  int n = max(1, min(32, u_samples));

  for (int i = 0; i < 32; i++) {
    if (i >= n) break;

    vec2 offset = haltonSample(i) * u_radius * u_distance * texel;
    vec2 sUV = v_uv + offset;

    // 越界跳过 (clamp 到边缘避免回绕)
    if (sUV.x < 0.0 || sUV.x > 1.0 || sUV.y < 0.0 || sUV.y > 1.0) continue;

    vec3 sColor = texture(u_colorMap, sUV).rgb;
    float sHeight = luminance(sColor);

    // 邻域高于自身 → 被遮蔽
    float heightDiff = sHeight - baseHeight;
    if (heightDiff <= 0.0) continue;

    // 距离衰减
    float dist = length(offset) / (u_radius * u_distance * max(length(texel), 1e-6));
    float distWeight = 1.0 - smoothstep(0.0, 1.0, dist);
    distWeight = pow(distWeight, u_falloff);

    // 高度差权重(越高越遮蔽)
    float heightWeight = clamp(heightDiff * 3.0, 0.0, 1.0);

    // 模糊核:gaussian 用 exp(-d²),box 用均匀权重
    float blurWeight = (u_blurType == 0)
      ? exp(-dist * dist * 2.0)
      : 1.0;

    float w = distWeight * heightWeight * blurWeight;
    occlusion += w;
    totalWeight += blurWeight;
  }

  // 归一化
  float shadow = totalWeight > 0.0
    ? occlusion / totalWeight
    : 0.0;

  // 接触处加权:高度越接近 groundHeight,阴影越强
  float contactWeight = 1.0 - smoothstep(0.0, 0.3, heightDist);
  shadow *= contactWeight;

  // 不透明度调整
  shadow = clamp(shadow * u_opacity, 0.0, 1.0);

  // 输出:R=G=B=shadow (0=全阴影,1=无阴影),A=1
  float v = 1.0 - shadow;
  outColor = vec4(v, v, v, 1.0);
}
`;

// ── ContactShadowsPass ───────────────────────────────────────────────

/**
 * 接触阴影 Pass。独立管理内部 FBO 与程序。
 *
 * 典型用法:
 * ```ts
 * const cs = new ContactShadowsPass(gl, { radius: 4.0, blurType: 'gaussian' });
 * function frame() {
 *   const shadow = cs.render(colorTexture, camera);
 *   // 下游合成 shadow 回主颜色缓冲 (sceneColor *= shadow.rgb)
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class ContactShadowsPass {
  readonly name = 'contact-shadows';

  /** 是否启用。禁用时 render() 直接返回 input。 */
  enabled: boolean = true;
  /** 模糊半径(texel 倍数,默认 4.0)。 */
  radius: number = 4.0;
  /** 采样距离缩放(默认 1.0,影响搜索范围)。 */
  distance: number = 1.0;
  /** 每像素采样数(1..32,默认 16)。 */
  samples: number = 16;
  /** 阴影不透明度(0..1,默认 0.6)。 */
  opacity: number = 0.6;
  /** 距离衰减(默认 2.0,越大阴影越集中于接触处)。 */
  falloff: number = 2.0;
  /** 地面高度(亮度空间 0..1,默认 0.0)。 */
  groundHeight: number = 0.0;
  /** 模糊类型:gaussian (高斯加权) / box (均匀加权)。 */
  blurType: 'gaussian' | 'box' = 'gaussian';

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
  /** 累计 draw call 次数。 */
  private _drawCalls: number = 0;
  /** 上一帧渲染耗时(ms)。 */
  private _lastFrameTimeMs: number = 0;

  constructor(gl: WebGL2RenderingContext, opts: ContactShadowsPassOptions = {}) {
    this._gl = gl;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.radius !== undefined) this.radius = opts.radius;
    if (opts.distance !== undefined) this.distance = opts.distance;
    if (opts.samples !== undefined) this.samples = opts.samples;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.falloff !== undefined) this.falloff = opts.falloff;
    if (opts.groundHeight !== undefined) this.groundHeight = opts.groundHeight;
    if (opts.blurType !== undefined) this.blurType = opts.blurType;
  }

  /**
   * 执行接触阴影。
   *
   * @param input   当前帧颜色纹理
   * @param camera  当前相机(预留,本 Pass 不使用相机参数,但保留 API 一致性)
   * @returns       阴影输出纹理(本 Pass 持有,不要释放);禁用时返回 input
   */
  render(input: WebGLTexture, camera: Camera): WebGLTexture {
    if (!this.enabled) return input;

    const t0 = performance.now();
    const gl = this._gl;
    const canvasW = gl.canvas.width;
    const canvasH = gl.canvas.height;
    const targetW = canvasW;
    const targetH = canvasH;

    if (!this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(targetW, targetH);
    }

    // 绑定内部 FBO → 写阴影输出
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);  // 默认无阴影
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram();
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);

    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_radius', this.radius);
    prog.setUniform1f('u_distance', this.distance);
    prog.setUniform1i('u_samples', Math.max(1, Math.min(32, Math.floor(this.samples))));
    prog.setUniform1f('u_opacity', this.opacity);
    prog.setUniform1f('u_falloff', this.falloff);
    prog.setUniform1f('u_groundHeight', this.groundHeight);
    prog.setUniform1i('u_blurType', this.blurType === 'gaussian' ? 0 : 1);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._drawCalls++;

    // 还原默认 FBO + 视口(避免影响后续渲染)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);

    this._lastFrameTimeMs = performance.now() - t0;
    // camera 参数预留,避免 unused 警告
    void camera;
    return this._outputTexture as WebGLTexture;
  }

  /** 启用/禁用 Pass。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 设置模糊半径(最小 0)。 */
  setRadius(radius: number): void {
    this.radius = Math.max(0, radius);
  }

  /** 设置采样距离缩放(最小 0.01)。 */
  setDistance(distance: number): void {
    this.distance = Math.max(0.01, distance);
  }

  /** 设置采样数(1..32,clamp 并 floor)。 */
  setSamples(samples: number): void {
    this.samples = Math.max(1, Math.min(32, Math.floor(samples)));
  }

  /** 设置不透明度(0..1,clamp)。 */
  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
  }

  /** 设置距离衰减(最小 0.01)。 */
  setFalloff(falloff: number): void {
    this.falloff = Math.max(0.01, falloff);
  }

  /** 设置地面高度(亮度空间 0..1,clamp)。 */
  setGroundHeight(height: number): void {
    this.groundHeight = Math.max(0, Math.min(1, height));
  }

  /** 设置模糊类型。 */
  setBlurType(type: 'gaussian' | 'box'): void {
    this.blurType = type;
  }

  /** 获取阴影缓冲纹理(未渲染或已 dispose 时返回 null)。 */
  getShadowBuffer(): WebGLTexture | null {
    return this._outputTexture;
  }

  /** 获取统计信息。 */
  getStats(): ContactShadowsStats {
    return {
      drawCalls: this._drawCalls,
      width: this._width,
      height: this._height,
      radius: this.radius,
      samples: this.samples,
      blurType: this.blurType,
      opacity: this.opacity,
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
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(this._gl, CONTACT_SHADOWS_VERT_SRC, CONTACT_SHADOWS_FRAG_SRC);
    log.info('ContactShadows program compiled');
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

    // RGBA8 输出纹理(阴影 0..1,无需浮点)
    const tex = gl.createTexture();
    if (!tex) throw new Error('ContactShadowsPass: createTexture() returned null');
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

    // FBO
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('ContactShadowsPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO(position@0 + uv@2,与 POST_VERT 一致)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('ContactShadowsPass: createVertexArray/Buffer() returned null');
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

    log.info(`ContactShadows FBO created: ${width}x${height}`);
  }
}
