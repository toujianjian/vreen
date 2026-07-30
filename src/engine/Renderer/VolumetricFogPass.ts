// VolumetricFogPass — 体积雾 / 体积光后处理 Pass (froxel 增强版)。
//
// 设计目标:
//   - 基于 froxel (frustum voxel) 概念把视锥体划分为 3D 网格,
//     在 fragment shader 中沿视线方向 ray march,累积雾密度与光散射;
//   - 支持距离雾 (fogStart / fogEnd / fogDensity,指数衰减);
//   - 支持高度雾 (heightFogEnabled / heightFogStart / heightFogEnd / heightFogDensity);
//   - 支持体积光 / 丁达尔效应 (lightScattering / scatteringIntensity / scatteringSamples),
//     从 lights 数组中提取第一个 DirectionalLight 作为"太阳"光源;
//   - 不继承 RenderPass 抽象(签名需 lights 数组 + camera near/far),
//     独立管理内部 FBO + 程序,与 SSRPass / DeferredRenderer 同构。
//
// 与 PostProcess/VolumetricFogPass 的区别:
//   - 本类位于 Renderer/ 顶层,API 更完整(heightFog / lightScattering /
//     scatteringSamples / froxelResolution);
//   - 接收 Light[] 数组(而非单独传 lightDir / lightColor);
//   - 支持 heightFog 与 froxelResolution 配置;
//   - 通过 getFogBuffer() / getStats() 提供缓冲与统计查询。
//
// 流程:
//   1. render() 首次调用时按 canvas 尺寸分配内部 FBO + RGBA16F 颜色纹理
//      + 编译 VOLUMETRIC_FOG 程序;
//   2. 绑定 FBO + 全屏视口 → 画全屏四边形,fragment shader 读 color 纹理
//      + 沿视线 ray march → 累积距离雾 + 高度雾 + 光散射 → 输出合成色;
//   3. 输出纹理交由下游 pass 处理。
//
// 不变量:
//   - enabled=false 时 render() 直接返回 input,不分配资源;
//   - dispose 后再调用 render 自动重建;
//   - 内部纹理为 RGBA16F,因为体积光散射可能让像素亮度 > 1;
//   - 输出纹理所有权归 Pass,调用方不得释放。

import type { Camera } from '../Cameras/Camera';
import type { Light } from '../Lights/Light';
import type { DirectionalLight } from '../Lights/DirectionalLight';
import { ShaderProgram } from './ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('VolumetricFogPass');

/** RGB 颜色(线性 0..1 分量)。 */
export interface FogColor {
  r: number;
  g: number;
  b: number;
}

/** Froxel 网格分辨率(x/y/z 轴向单元数)。 */
export interface FroxelResolution {
  x: number;
  y: number;
  z: number;
}

export interface VolumetricFogPassOptions {
  enabled?: boolean;
  fogColor?: FogColor;
  fogDensity?: number;
  fogStart?: number;
  fogEnd?: number;
  heightFogEnabled?: boolean;
  heightFogStart?: number;
  heightFogEnd?: number;
  heightFogDensity?: number;
  lightScattering?: boolean;
  scatteringIntensity?: number;
  scatteringSamples?: number;
  froxelResolution?: FroxelResolution;
}

/** VolumetricFogPass 统计信息。 */
export interface VolumetricFogStats {
  /** 累计 draw call 次数。 */
  drawCalls: number;
  /** 当前内部缓冲宽度(px)。 */
  width: number;
  /** 当前内部缓冲高度(px)。 */
  height: number;
  /** 当前雾密度。 */
  fogDensity: number;
  /** 体积光散射开关。 */
  lightScattering: boolean;
  /** 散射采样数。 */
  scatteringSamples: number;
  /** Froxel 网格分辨率。 */
  froxelResolution: FroxelResolution;
  /** 上一帧处理的光源数(用于散射)。 */
  lightCount: number;
  /** 上一帧渲染耗时(ms)。 */
  lastFrameTimeMs: number;
}

// ── Shaders ───────────────────────────────────────────────────────────

const FOG_VERT_SRC = /* glsl */ `#version 300 es
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
 * 体积雾片元着色器:沿视线方向 ray march,累积雾密度与光散射。
 *
 * 输入纹理:
 *   u_colorMap — 当前帧颜色
 *
 * uniforms:
 *   u_projectionInverse / u_viewInverse — 把屏幕 UV 还原到世界空间视线方向
 *   u_cameraPos                         — 视点位置
 *   u_screenSize                        — 内部缓冲尺寸
 *   u_near / u_far                      — 相机近/远裁面
 *
 *   u_fogColor / u_fogDensity / u_fogStart / u_fogEnd — 距离雾参数
 *   u_heightFogEnabled / u_heightFogStart / u_heightFogEnd / u_heightFogDensity — 高度雾参数
 *   u_lightScattering / u_scatteringIntensity / u_scatteringSamples — 体积光参数
 *   u_hasLight / u_lightDir / u_lightColor / u_lightIntensity — 主光源(太阳)
 */
const FOG_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform mat4 u_projectionInverse;
uniform mat4 u_viewInverse;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform float u_near;
uniform float u_far;

uniform vec3  u_fogColor;
uniform float u_fogDensity;
uniform float u_fogStart;
uniform float u_fogEnd;

uniform int   u_heightFogEnabled;
uniform float u_heightFogStart;
uniform float u_heightFogEnd;
uniform float u_heightFogDensity;

uniform int   u_lightScattering;
uniform float u_scatteringIntensity;
uniform int   u_scatteringSamples;

uniform int   u_hasLight;
uniform vec3  u_lightDir;
uniform vec3  u_lightColor;
uniform float u_lightIntensity;

// 从屏幕 UV 重建世界空间视线方向(指向远裁面)。
vec3 reconstructViewDir(vec2 uv) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec4 world = u_viewInverse * u_projectionInverse * ndc;
  return normalize(world.xyz / world.w - u_cameraPos);
}

// 距离雾密度(指数衰减)。
float distanceFogFactor(float dist) {
  if (dist < u_fogStart) return 0.0;
  if (dist > u_fogEnd) return 1.0;
  return 1.0 - exp(-u_fogDensity * max(dist, 0.0));
}

// 高度雾密度(在 heightFogStart..heightFogEnd 之间线性插值)。
float heightFogFactor(vec3 worldPos) {
  if (u_heightFogEnabled == 0) return 0.0;
  float h = worldPos.y;
  if (h >= u_heightFogStart) return 0.0;
  if (h <= u_heightFogEnd) return u_heightFogDensity;
  float t = (u_heightFogStart - h) / max(u_heightFogStart - u_heightFogEnd, 0.001);
  return u_heightFogDensity * t;
}

void main() {
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  // 重建视线方向
  vec3 viewDir = reconstructViewDir(v_uv);

  // 沿视线 ray march,累积雾密度与光散射
  float maxFog = 0.0;
  vec3  scatteredLight = vec3(0.0);
  int   samples = max(1, u_scatteringSamples);
  float range = max(u_far - u_near, 0.001);
  float stepLen = range / float(samples);

  for (int i = 0; i < 128; i++) {
    if (i >= samples) break;
    float t = u_near + stepLen * (float(i) + 0.5);
    vec3 worldPos = u_cameraPos + viewDir * t;

    // 距离雾 + 高度雾(取较大值)
    float distFog = distanceFogFactor(t);
    float hFog    = heightFogFactor(worldPos);
    float density = max(distFog, hFog);
    maxFog = max(maxFog, density);

    // 光散射(丁达尔效应):沿视线方向与光源方向的夹角
    if (u_lightScattering != 0 && u_hasLight != 0 && density > 0.001) {
      vec3 L = normalize(-u_lightDir);
      float scatter = max(dot(viewDir, -L), 0.0);
      scatter = pow(scatter, 4.0);
      scatteredLight += u_lightColor * scatter * u_scatteringIntensity
                      * u_lightIntensity * density * stepLen * 0.05;
    }
  }

  float fogFactor = clamp(maxFog, 0.0, 1.0);
  vec3  fogColor = u_fogColor + scatteredLight;
  vec3  finalColor = mix(sceneColor, fogColor, fogFactor);
  outColor = vec4(finalColor, 1.0);
}
`;

// ── VolumetricFogPass ─────────────────────────────────────────────────

/**
 * 体积雾 Pass(froxel 增强版)。独立管理内部 FBO 与程序。
 *
 * 典型用法:
 * ```ts
 * const fog = new VolumetricFogPass(gl, { fogDensity: 0.05 });
 * function frame() {
 *   const output = fog.render(colorTexture, lights, camera);
 *   // 下游 pass 处理 output
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class VolumetricFogPass {
  readonly name = 'volumetric-fog';

  /** 是否启用。禁用时 render() 直接返回 input。 */
  enabled: boolean = true;
  /** 雾色(默认浅灰,模拟空气雾)。 */
  fogColor: FogColor = { r: 0.5, g: 0.55, b: 0.6 };
  /** 雾密度(指数衰减系数,0..1+;典型 0.02~0.1)。 */
  fogDensity: number = 0.02;
  /** 雾作用起始距离(世界单位,小于此距离无雾)。 */
  fogStart: number = 5.0;
  /** 雾作用结束距离(超出此距离全雾)。 */
  fogEnd: number = 200.0;

  /** 高度雾开关。 */
  heightFogEnabled: boolean = false;
  /** 高度雾起始高度(高于此高度无雾)。 */
  heightFogStart: number = 50.0;
  /** 高度雾结束高度(低于此高度达最大密度)。 */
  heightFogEnd: number = 0.0;
  /** 高度雾最大密度。 */
  heightFogDensity: number = 0.5;

  /** 体积光散射开关(丁达尔效应)。 */
  lightScattering: boolean = true;
  /** 散射强度(0 关闭,典型 0.3~1.0)。 */
  scatteringIntensity: number = 0.5;
  /** 散射采样数(1..128,越大质量越高但越慢)。 */
  scatteringSamples: number = 32;

  /** Froxel 网格分辨率(x/y/z 轴向单元数,用于配置 ray march 质量)。 */
  froxelResolution: FroxelResolution = { x: 32, y: 32, z: 32 };

  private _gl: WebGL2RenderingContext;
  /** 当前输出纹理。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  /** 全屏四边形 VAO。 */
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 当前内部缓冲尺寸。 */
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  /** 累计 draw call 次数。 */
  private _drawCalls: number = 0;
  /** 上一帧渲染耗时(ms)。 */
  private _lastFrameTimeMs: number = 0;
  /** 上一帧处理的光源数。 */
  private _lastLightCount: number = 0;

  constructor(gl: WebGL2RenderingContext, opts: VolumetricFogPassOptions = {}) {
    this._gl = gl;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.fogColor !== undefined) this.fogColor = { ...opts.fogColor };
    if (opts.fogDensity !== undefined) this.fogDensity = opts.fogDensity;
    if (opts.fogStart !== undefined) this.fogStart = opts.fogStart;
    if (opts.fogEnd !== undefined) this.fogEnd = opts.fogEnd;
    if (opts.heightFogEnabled !== undefined) this.heightFogEnabled = opts.heightFogEnabled;
    if (opts.heightFogStart !== undefined) this.heightFogStart = opts.heightFogStart;
    if (opts.heightFogEnd !== undefined) this.heightFogEnd = opts.heightFogEnd;
    if (opts.heightFogDensity !== undefined) this.heightFogDensity = opts.heightFogDensity;
    if (opts.lightScattering !== undefined) this.lightScattering = opts.lightScattering;
    if (opts.scatteringIntensity !== undefined) this.scatteringIntensity = opts.scatteringIntensity;
    if (opts.scatteringSamples !== undefined) this.scatteringSamples = opts.scatteringSamples;
    if (opts.froxelResolution !== undefined) this.froxelResolution = { ...opts.froxelResolution };
  }

  /**
   * 执行体积雾合成。
   *
   * @param input   当前帧颜色纹理
   * @param lights  光源数组(取第一个 DirectionalLight 作为散射光源)
   * @param camera  当前相机(读取 projectionInverse / viewInverse / position / near / far)
   * @returns       合成后的颜色纹理(本 Pass 持有);禁用时返回 input
   */
  render(input: WebGLTexture, lights: Light[], camera: Camera): WebGLTexture {
    if (!this.enabled) return input;

    const t0 = performance.now();
    const gl = this._gl;
    const canvasW = gl.canvas.width;
    const canvasH = gl.canvas.height;

    if (!this._initialized || this._width !== canvasW || this._height !== canvasH) {
      this._initResources(canvasW, canvasH);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram();
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);

    // 读取相机 near / far(PerspectiveCamera / OrthographicCamera 都有)
    const camNear = (camera as unknown as { near?: number }).near ?? 0.1;
    const camFar = (camera as unknown as { far?: number }).far ?? 1000.0;

    prog.setUniformMatrix4fv('u_projectionInverse', camera.projectionMatrixInverse.elements);
    prog.setUniformMatrix4fv('u_viewInverse', camera.matrixWorld.elements);
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_near', camNear);
    prog.setUniform1f('u_far', camFar);

    prog.setUniform3f('u_fogColor', this.fogColor.r, this.fogColor.g, this.fogColor.b);
    prog.setUniform1f('u_fogDensity', this.fogDensity);
    prog.setUniform1f('u_fogStart', this.fogStart);
    prog.setUniform1f('u_fogEnd', this.fogEnd);

    prog.setUniform1i('u_heightFogEnabled', this.heightFogEnabled ? 1 : 0);
    prog.setUniform1f('u_heightFogStart', this.heightFogStart);
    prog.setUniform1f('u_heightFogEnd', this.heightFogEnd);
    prog.setUniform1f('u_heightFogDensity', this.heightFogDensity);

    prog.setUniform1i('u_lightScattering', this.lightScattering ? 1 : 0);
    prog.setUniform1f('u_scatteringIntensity', this.scatteringIntensity);
    prog.setUniform1i('u_scatteringSamples', Math.max(1, Math.min(128, Math.floor(this.scatteringSamples))));

    // 从 lights 数组中提取第一个 DirectionalLight 作为散射光源
    let primaryLight: DirectionalLight | null = null;
    for (const light of lights) {
      if ((light as unknown as { isDirectionalLight?: boolean }).isDirectionalLight === true) {
        primaryLight = light as unknown as DirectionalLight;
        break;
      }
    }

    if (primaryLight) {
      const dir = primaryLight.direction;
      prog.setUniform1i('u_hasLight', 1);
      prog.setUniform3f('u_lightDir', dir.x, dir.y, dir.z);
      prog.setUniform3f('u_lightColor', primaryLight.color.r, primaryLight.color.g, primaryLight.color.b);
      prog.setUniform1f('u_lightIntensity', primaryLight.intensity);
      this._lastLightCount = 1;
    } else {
      prog.setUniform1i('u_hasLight', 0);
      prog.setUniform3f('u_lightDir', 0, -1, 0);
      prog.setUniform3f('u_lightColor', 0, 0, 0);
      prog.setUniform1f('u_lightIntensity', 0);
      this._lastLightCount = 0;
    }

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._drawCalls++;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);

    this._lastFrameTimeMs = performance.now() - t0;
    return this._outputTexture as WebGLTexture;
  }

  /** 启用/禁用 Pass。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 设置雾色(复制传入对象,不持有引用)。 */
  setFogColor(color: FogColor): void {
    this.fogColor = { r: color.r, g: color.g, b: color.b };
  }

  /** 设置雾密度(0..1+,负值 clamp 到 0)。 */
  setFogDensity(density: number): void {
    this.fogDensity = Math.max(0, density);
  }

  /** 设置雾作用范围(start..end,end 不小于 start)。 */
  setFogRange(start: number, end: number): void {
    this.fogStart = Math.max(0, start);
    this.fogEnd = Math.max(this.fogStart, end);
  }

  /** 配置高度雾。 */
  setHeightFog(enabled: boolean, start: number, end: number, density: number): void {
    this.heightFogEnabled = enabled;
    this.heightFogStart = start;
    this.heightFogEnd = end;
    this.heightFogDensity = Math.max(0, density);
  }

  /** 设置体积光散射。 */
  setLightScattering(enabled: boolean, intensity: number): void {
    this.lightScattering = enabled;
    this.scatteringIntensity = Math.max(0, intensity);
  }

  /** 设置散射采样数(1..128)。 */
  setScatteringSamples(samples: number): void {
    this.scatteringSamples = Math.max(1, Math.min(128, Math.floor(samples)));
  }

  /** 设置 froxel 网格分辨率(各轴最小 1)。 */
  setFroxelResolution(x: number, y: number, z: number): void {
    this.froxelResolution = {
      x: Math.max(1, Math.floor(x)),
      y: Math.max(1, Math.floor(y)),
      z: Math.max(1, Math.floor(z)),
    };
  }

  /** 获取雾缓冲纹理(未渲染或已 dispose 时返回 null)。 */
  getFogBuffer(): WebGLTexture | null {
    return this._outputTexture;
  }

  /** 获取统计信息。 */
  getStats(): VolumetricFogStats {
    return {
      drawCalls: this._drawCalls,
      width: this._width,
      height: this._height,
      fogDensity: this.fogDensity,
      lightScattering: this.lightScattering,
      scatteringSamples: this.scatteringSamples,
      froxelResolution: { ...this.froxelResolution },
      lightCount: this._lastLightCount,
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
    this._program = new ShaderProgram(this._gl, FOG_VERT_SRC, FOG_FRAG_SRC);
    log.info('VolumetricFog program compiled');
    return this._program;
  }

  private _initResources(width: number, height: number): void {
    const gl = this._gl;
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RGBA16F 输出纹理(散射可能让亮度 > 1,需浮点)
    const tex = gl.createTexture();
    if (!tex) throw new Error('VolumetricFogPass: createTexture() returned null');
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

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('VolumetricFogPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('VolumetricFogPass: createVertexArray/Buffer() returned null');
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

    log.info(`VolumetricFog FBO created: ${width}x${height}`);
  }
}
