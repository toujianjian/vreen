// ScreenSpaceLensFlarePass — 屏幕空间镜头光晕后处理 Pass。
//
// 设计目标:
//   - 单 pass 模拟镜头玻璃内部反射产生的重影(ghost)、光环(halo)、
//     星芒(starburst)三类典型镜头光晕现象,叠加到场景色上。
//   - 光源世界位置投影到屏幕,沿"光源→屏幕中心"轴分布 ghost;
//     halo 围绕光源呈环形;starburst 围绕光源呈星形射线。
//   - RGB 色散让每个 ghost 的 R/G/B 通道偏移,模拟棱镜色散。
//   - 深度遮挡让前景几何挡住光晕;屏幕外淡出避免光晕突兀消失。
//   - 独立管理 FBO + 程序,不继承 RenderPass(需要 depth + camera)。
//
// 算法(Jimenez 2014 / Madsen 2011):
//   1. 光源世界位置 → viewProjection → NDC → lightScreenUV;
//   2. 光源在相机后方(clip w <= 0)→ 跳过,输出原场景色;
//   3. 屏幕外淡出:光源超出屏幕边界时 visibilityFade 渐隐;
//   4. 深度遮挡:pixelDepth < maxDepth → occlusion = 0(几何挡住光晕);
//   5. Ghost:沿 lightUV + toCenter * (spacing * i) 轴分布 i=1..ghostCount,
//      每个 ghost 用 radialGauss 掩码 + RGB 色散采样场景色,1/i 衰减;
//   6. Halo:围绕光源的环形高斯,在 dist == haloRadius 处最亮;
//   7. Starburst:围绕光源的多射线 sin(angle * rays + phase) 叠加;
//   8. 全局衰减 exp(-dist * globalFalloff) + 加性合成 sceneColor + flare。
//
// 与 GodRaysPass 的区别:
//   * GodRaysPass 模拟大气散射光束(crepuscular rays),需径向步进采样,
//     开销 O(samples);
//   * LensFlarePass 模拟镜头玻璃反射产生的重影/光环/星芒,单次采样合成,
//     开销 O(ghostCount + starburstRays),~5x 便宜;
//   * 二者可共存:GodRays 给光束,LensFlare 给镜头质感。
//
// 参考:
//   - Jorge Jimenez 2014 "Next Generation Post Processing in Call of Duty: AW"
//   - Madsen 2011 "Real-Time Lens Flare Rendering"
//   - Unity HDRP LensFlareComponent / o3de Atom PostProcess

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, LENS_FLARE_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('ScreenSpaceLensFlarePass');

export interface ScreenSpaceLensFlareOptions {
  /** 光源世界位置(默认 (0, 50, 0))。通常是太阳/强点光源位置。 */
  lightPosition?: [number, number, number];
  /** 光晕颜色(默认 1.0, 0.95, 0.85 = 暖白)。 */
  lightColor?: [number, number, number];
  /** 光晕整体强度(默认 1.0)。 */
  lightIntensity?: number;
  /** ghost 重影数(默认 8,范围 0..16)。0 关闭 ghost。 */
  ghostCount?: number;
  /** ghost 轴向间距(默认 0.2)。每个 ghost 在 lightUV + toCenter * (spacing * i)。 */
  ghostSpacing?: number;
  /** ghost 半径(默认 0.08)。每个 ghost 的高斯衰减半径。 */
  ghostRadius?: number;
  /** ghost 强度(默认 1.0)。ghost 整体亮度缩放。 */
  ghostIntensity?: number;
  /** halo 环半径(默认 0.4)。围绕光源的环形光晕半径。 */
  haloRadius?: number;
  /** halo 环厚度(默认 0.1)。环的高斯衰减宽度。 */
  haloThickness?: number;
  /** halo 强度(默认 0.5)。halo 整体亮度缩放。 */
  haloIntensity?: number;
  /** 星芒强度(默认 0.3)。0 关闭星芒。 */
  starburstIntensity?: number;
  /** 星芒射线数(默认 6,范围 0..16)。 */
  starburstRays?: number;
  /** 前景遮挡深度阈值(默认 0.99)。depth >= 此值视为天空(放行光晕)。 */
  maxDepth?: number;
  /** ghost 色散强度(默认 0.005)。R/B 通道偏移量。 */
  chromaticAberration?: number;
  /** 全局距离衰减率(默认 1.5)。距光源越远光晕越暗。 */
  globalFalloff?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 屏幕空间镜头光晕 Pass。独立管理内部 FBO 与程序。
 *
 * apply() 接收颜色纹理 + 深度纹理 + 相机,输出叠加光晕后的颜色纹理。
 * 调用者每帧更新 `lightPosition` 字段(跟随太阳/强光源位置)。
 *
 * @example
 * ```ts
 * const lensFlare = new ScreenSpaceLensFlarePass({
 *   lightPosition: [100, 80, -50],
 *   ghostCount: 10,
 *   starburstRays: 8,
 * });
 * // 每帧:
 * lensFlare.lightPosition = sunWorldPos;
 * const out = lensFlare.apply(gl, colorTex, depthTex, camera);
 * ```
 */
export class ScreenSpaceLensFlarePass {
  readonly name = 'lensflare';

  lightPosition: [number, number, number];
  lightColor: [number, number, number];
  lightIntensity: number;
  ghostCount: number;
  ghostSpacing: number;
  ghostRadius: number;
  ghostIntensity: number;
  haloRadius: number;
  haloThickness: number;
  haloIntensity: number;
  starburstIntensity: number;
  starburstRays: number;
  maxDepth: number;
  chromaticAberration: number;
  globalFalloff: number;
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

  constructor(opts: ScreenSpaceLensFlareOptions = {}) {
    this.lightPosition = opts.lightPosition ?? [0, 50, 0];
    this.lightColor = opts.lightColor ?? [1.0, 0.95, 0.85];
    this.lightIntensity = opts.lightIntensity ?? 1.0;
    this.ghostCount = opts.ghostCount ?? 8;
    this.ghostSpacing = opts.ghostSpacing ?? 0.2;
    this.ghostRadius = opts.ghostRadius ?? 0.08;
    this.ghostIntensity = opts.ghostIntensity ?? 1.0;
    this.haloRadius = opts.haloRadius ?? 0.4;
    this.haloThickness = opts.haloThickness ?? 0.1;
    this.haloIntensity = opts.haloIntensity ?? 0.5;
    this.starburstIntensity = opts.starburstIntensity ?? 0.3;
    this.starburstRays = opts.starburstRays ?? 6;
    this.maxDepth = opts.maxDepth ?? 0.99;
    this.chromaticAberration = opts.chromaticAberration ?? 0.005;
    this.globalFalloff = opts.globalFalloff ?? 1.5;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 执行屏幕空间镜头光晕后处理。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  当前帧颜色纹理(HDR)
   * @param depthTexture  GBuffer 深度纹理(NDC 0..1)
   * @param camera        当前相机(读取 projection / view)
   * @returns             叠加光晕后的颜色纹理;若禁用则原样返回输入
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

    // Ghost 参数(clamp count 到 [0, 16] 匹配 shader MAX_GHOSTS)
    prog.setUniform1i('u_ghostCount', Math.max(0, Math.min(16, Math.floor(this.ghostCount))));
    prog.setUniform1f('u_ghostSpacing', this.ghostSpacing);
    prog.setUniform1f('u_ghostRadius', this.ghostRadius);
    prog.setUniform1f('u_ghostIntensity', this.ghostIntensity);

    // Halo 参数
    prog.setUniform1f('u_haloRadius', this.haloRadius);
    prog.setUniform1f('u_haloThickness', this.haloThickness);
    prog.setUniform1f('u_haloIntensity', this.haloIntensity);

    // Starburst 参数(clamp rays 到 [0, 16])
    prog.setUniform1f('u_starburstIntensity', this.starburstIntensity);
    prog.setUniform1i('u_starburstRays', Math.max(0, Math.min(16, Math.floor(this.starburstRays))));

    // 全局参数
    prog.setUniform1f('u_maxDepth', this.maxDepth);
    prog.setUniform1f('u_chromaticAberration', this.chromaticAberration);
    prog.setUniform1f('u_globalFalloff', this.globalFalloff);

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
    // 输出纹理(RGBA16F,加性光晕可能产生 HDR 亮度)
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

    // 全屏三角形 VAO(单个大三角形覆盖 [-1,1]²,与 GodRaysPass 一致)
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
    log.info(`LensFlare FBO created: ${w}x${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, LENS_FLARE_FRAG);
    }
    return this._program;
  }

  private _computeVP(camera: Camera): Float32Array {
    // VP = projection × view (column-major 4×4 乘法)
    // 与 GodRaysPass 一致:用 view(matrixWorldInverse) 而非其逆,
    // 因为光源是世界空间→NDC
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
