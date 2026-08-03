// GodRaysPass — 屏幕空间体积光束(crepuscular rays)后处理 Pass。
//
// 设计目标:
//   - 单 pass 径向采样,模拟太阳光穿过场景遮挡物时产生的光束散射外观。
//   - 把光源世界位置投影到屏幕,沿 像素→光源 方向步进采样,累积亮区贡献。
//   - 亮度阈值提取光束源(太阳盘 + 亮天空),深度遮挡让前景几何挡住光束。
//   - 指数衰减(illuminationDecay *= decay)让远离光源处光束变弱。
//   - 独立管理 FBO + 程序,不继承 RenderPass(需要 depth + camera)。
//
// 算法(Sekulic 2004 / GPU Gems 3 Ch.13):
//   1. 光源世界位置 → viewProjection → NDC → lightScreenUV;
//   2. 光源在相机后方(clip w <= 0)→ 跳过,输出原场景色;
//   3. delta = (lightScreenUV - pixelUV) * density / samples;
//   4. 径向步进 samples 次:
//      a. sampleColor = texture(colorMap, sampleUV);
//      b. lightMask = max(0, luminance(sampleColor) - threshold);
//      c. occlusion = step(maxDepth, sampleDepth)  // 天空放行,几何遮挡;
//      d. accumulated += sampleColor * lightMask * illuminationDecay * occlusion;
//      e. illuminationDecay *= decay;
//   5. rays = accumulated * exposure * lightColor * intensity;
//   6. outColor = sceneColor + rays(加性合成)。
//
// 与 VolumetricFogPass 的区别:
//   * VolumetricFogPass 是完整 ray-march 体积雾(含参与介质散射),开销大;
//   * GodRaysPass 是屏幕空间径向模糊,仅模拟光束外观,~10x 便宜;
//   * 二者可共存:GodRaysPass 作廉价 fallback 或叠加增强光束。
//
// 参考:
//   - GPU Gems 3, Ch.13 "Volumetric Light Scattering in Post-Space" (Sekulic)
//   - o3de Atom, Volumetric rays pass
//   - Mittring 2007 "Finding Next Gen — CryEngine 2" (light shafts)

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, GOD_RAYS_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('GodRaysPass');

export interface GodRaysOptions {
  /** 光源世界位置(默认 (0, 50, 0))。通常是太阳/方向光位置。 */
  lightPosition?: [number, number, number];
  /** 光束颜色(默认 1.0, 0.9, 0.7 = 暖黄)。 */
  lightColor?: [number, number, number];
  /** 光束强度(默认 1.0)。 */
  lightIntensity?: number;
  /** 径向采样数(默认 80,范围 1..256)。值越大光束越平滑,开销越高。 */
  samples?: number;
  /** 指数衰减率(默认 0.96)。越接近 1 光束越长,接近 0 光束越短。 */
  decay?: number;
  /** 曝光(默认 0.5)。整体光束亮度缩放。 */
  exposure?: number;
  /** 步进密度(默认 1.0)。>1 拉伸采样范围,<1 压缩。 */
  density?: number;
  /** 亮度阈值(默认 0.8)。仅亮度高于此值的像素作为光束源。 */
  threshold?: number;
  /** 前景遮挡深度阈值(默认 0.99)。depth >= 此值视为天空(放行光束)。 */
  maxDepth?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 屏幕空间体积光束 Pass。独立管理内部 FBO 与程序。
 *
 * apply() 接收颜色纹理 + 深度纹理 + 相机,输出叠加光束后的颜色纹理。
 * 调用者每帧更新 `lightPosition` 字段(跟随太阳/方向光位置)。
 *
 * @example
 * ```ts
 * const godRays = new GodRaysPass({ lightPosition: [100, 80, -50], samples: 100 });
 * // 每帧:
 * godRays.lightPosition = sunWorldPos;
 * const out = godRays.apply(gl, colorTex, depthTex, camera);
 * ```
 */
export class GodRaysPass {
  readonly name = 'godrays';

  lightPosition: [number, number, number];
  lightColor: [number, number, number];
  lightIntensity: number;
  samples: number;
  decay: number;
  exposure: number;
  density: number;
  threshold: number;
  maxDepth: number;
  enabled: boolean;

  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: GodRaysOptions = {}) {
    this.lightPosition = opts.lightPosition ?? [0, 50, 0];
    this.lightColor = opts.lightColor ?? [1.0, 0.9, 0.7];
    this.lightIntensity = opts.lightIntensity ?? 1.0;
    this.samples = opts.samples ?? 80;
    this.decay = opts.decay ?? 0.96;
    this.exposure = opts.exposure ?? 0.5;
    this.density = opts.density ?? 1.0;
    this.threshold = opts.threshold ?? 0.8;
    this.maxDepth = opts.maxDepth ?? 0.99;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 执行体积光束后处理。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  当前帧颜色纹理(HDR)
   * @param depthTexture  GBuffer 深度纹理(NDC 0..1)
   * @param camera        当前相机(读取 projection / view)
   * @returns             叠加光束后的颜色纹理;若禁用则原样返回输入
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
    // 禁用 → 直接返回输入(零开销)
    if (!this.enabled) {
      return colorTexture;
    }

    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this._dirty || !this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    // 颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 深度纹理 → unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    // 相机 viewProjection(世界 → NDC,投影光源)
    prog.setUniformMatrix4fv('u_viewProjection', this._computeVP(camera));

    // 光源参数
    const lp = this.lightPosition;
    const lc = this.lightColor;
    prog.setUniform3f('u_lightPosition', lp[0], lp[1], lp[2]);
    prog.setUniform3f('u_lightColor', lc[0], lc[1], lc[2]);
    prog.setUniform1f('u_lightIntensity', this.lightIntensity);

    // 径向采样参数(clamp samples 到 [1, 256] 匹配 shader MAX_SAMPLES)
    const clampedSamples = Math.max(1, Math.min(256, Math.floor(this.samples)));
    prog.setUniform1i('u_samples', clampedSamples);
    prog.setUniform1f('u_decay', this.decay);
    prog.setUniform1f('u_exposure', this.exposure);
    prog.setUniform1f('u_density', this.density);
    prog.setUniform1f('u_threshold', this.threshold);
    prog.setUniform1f('u_maxDepth', this.maxDepth);

    prog.setUniform1i('u_enabled', this.enabled ? 1 : 0);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建(分辨率变更等)。 */
  setDirty(): void { this._dirty = true; }

  /** 释放 GPU 资源。可重复调用。 */
  dispose(gl?: WebGL2RenderingContext): void {
    if (gl) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._program) this._program.dispose();
    }
    this._outputTexture = null;
    this._fbo = null;
    this._program = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 输出纹理(RGBA16F,加性光束可能产生 HDR 亮度)
    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);

    // 全屏三角形 VAO(单个大三角形覆盖 [-1,1]²,与 CausticsPass 一致)
    this._fullscreenQuadBuf = gl.createBuffer();
    this._fullscreenQuadVao = gl.createVertexArray();
    gl.bindVertexArray(this._fullscreenQuadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
    const verts = new Float32Array([
      -1, -1,  3, -1,  -1, 3,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._width = w;
    this._height = h;
    this._initialized = true;
    log.info(`GodRays FBO created: ${w}x${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, GOD_RAYS_FRAG);
    }
    return this._program;
  }

  private _computeVP(camera: Camera): Float32Array {
    // VP = projection × view (column-major 4×4 乘法)
    // 注意:这里用 view(matrixWorldInverse)而非其逆,因为光源是世界空间→NDC
    const proj = camera.projectionMatrix.elements;
    const view = camera.matrixWorldInverse.elements;
    const vp = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += view[k * 4 + r] * proj[c * 4 + k];
        }
        vp[c * 4 + r] = sum;
      }
    }
    return vp;
  }
}
