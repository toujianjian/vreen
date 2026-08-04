// ScreenSpaceRefractionPass — 屏幕空间折射后处理 Pass。
//
// 对任意形状的透明表面(玻璃/冰/水洼/全息/热空气扭曲)做屏幕空间折射采样。
// 与 planar Refractor(单平面 CPU 折射)互补:本 pass 在屏幕空间工作,只需一张
// 由透明物体预渲染的"折射法线/遮罩纹理"(RGBA: RGB=视空间法线, A=遮罩)。
//
// 算法 (UE5 Screen-Space Refraction / o3de Atom TransparencySystem 简化版):
//   1. 读取折射法线 n(视空间)与遮罩 mask
//   2. mask == 0 → 直接输出背景色(不透明像素)
//   3. 折射方向 refr = refract(I, n, eta),I = (0,0,-1) 视线方向,eta = 1/IOR
//   4. 屏幕空间 UV 偏移 = refr.xy * strength * mask
//   5. 色散(可选):R/G/B 用不同 eta,蓝光折射率更高 → 偏移更大
//   6. Beer-Lambert 吸收:透过率 = exp(-(1-absorptionColor) * scale * mask)
//      以 mask 作为厚度代理,模拟有色玻璃/酒水的光吸收
//
// 性能:单 pass,无色散 2 次纹理采样,有色散 4 次。无降采样依赖。
// 适合在透明物体渲染后、Tonemapping 之前应用。
//
// 参考:
//   - UE5: Screen-Space Refraction (RealTimeScreenSpaceRayTracing)
//   - o3de Atom: TransparencySystem / ScreenSpaceRefraction
//   - three.js: examples/jsm/objects/Refractor.js (planar, 本 pass 为其屏幕空间泛化)

import { SCREEN_SPACE_REFRACTION_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('ScreenSpaceRefractionPass');

/** RGB 吸收颜色,各通道 0..1(1 = 不吸收该通道)。 */
export type AbsorptionColor = [r: number, g: number, b: number];

export interface ScreenSpaceRefractionOptions {
  /**
   * 折射率 IOR(默认 1.33,水)。
   * 空气=1.0,水=1.33,玻璃=1.5,蓝宝石=1.77,钻石=2.42。
   */
  ior?: number;
  /**
   * 折射强度倍数(默认 1.0)。
   * 放大 UV 偏移,>1 增强扭曲,可用于艺术化效果。
   */
  strength?: number;
  /**
   * RGB 色散强度(默认 0)。
   * >0 启用三通道分离折射,模拟棱镜色散。值越大色边越明显。
   */
  chromaticDispersion?: number;
  /**
   * Beer-Lambert 吸收颜色(默认 [1,1,1] = 无吸收)。
   * 有色玻璃/液体:绿色玻璃 ≈ [0.4, 0.9, 0.4],红酒 ≈ [0.7, 0.2, 0.3]。
   */
  absorptionColor?: AbsorptionColor;
  /**
   * 吸收强度(默认 0)。
   * >0 启用光吸收,以折射遮罩作为厚度代理,值越大颜色越浓。
   */
  absorptionScale?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 屏幕空间折射 Pass。对透明表面做屏幕空间折射采样 + 色散 + Beer-Lambert 吸收。
 *
 * 解决"任意形状透明物体后方背景扭曲"的渲染需求:
 *   - 玻璃杯/窗户:背景透过玻璃变形
 *   - 冰块/晶体:高折射率强扭曲 + 色散
 *   - 水洼/浅水:地面透过水面位移
 *   - 热空气扭曲(mirage):微弱折射扰动
 *
 * 需要透明物体在预渲染阶段写入"折射法线/遮罩纹理":
 *   - RGB:视空间法线(encode 到 [0,1],flat 表面 = (0.5, 0.5, 1.0))
 *   - A:折射遮罩(0 = 不透明,>0 = 折射强度/厚度)
 *
 * @example
 * ```ts
 * const refraction = new ScreenSpaceRefractionPass({
 *   ior: 1.5,                    // 玻璃
 *   chromaticDispersion: 0.02,   // 轻微色散
 *   absorptionColor: [0.4, 0.9, 0.4], // 绿色玻璃
 *   absorptionScale: 1.5,
 * });
 * // 每帧(透明物体渲染后):
 * const refracted = refraction.apply(gl, sceneColor, refractionNormalTex);
 * ```
 */
export class ScreenSpaceRefractionPass {
  readonly name = 'screenspacerefraction';

  ior: number;
  strength: number;
  chromaticDispersion: number;
  absorptionColor: AbsorptionColor;
  absorptionScale: number;
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

  constructor(opts: ScreenSpaceRefractionOptions = {}) {
    this.ior = opts.ior ?? 1.33;
    this.strength = opts.strength ?? 1.0;
    this.chromaticDispersion = opts.chromaticDispersion ?? 0;
    this.absorptionColor = opts.absorptionColor ?? [1, 1, 1];
    this.absorptionScale = opts.absorptionScale ?? 0;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用屏幕空间折射。
   *
   * @param gl                WebGL2 上下文
   * @param colorTexture      不透明场景颜色纹理(被折射的背景)
   * @param refractionTexture 折射法线/遮罩纹理(RGB=视空间法线[0,1], A=遮罩)
   * @returns                 折射后的颜色纹理(禁用时返回输出纹理)
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    refractionTexture: WebGLTexture,
  ): WebGLTexture {
    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this._dirty || !this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getProgram(gl);
    prog.use();

    // 颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 折射法线/遮罩纹理 → unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, refractionTexture);
    prog.setUniformSampler('u_refractionMap', 1);

    // 折射参数
    prog.setUniform1f('u_ior', this.ior);
    prog.setUniform1f('u_strength', this.strength);
    prog.setUniform1f('u_chromaticDispersion', this.chromaticDispersion);
    prog.setUniform3f(
      'u_absorptionColor',
      this.absorptionColor[0],
      this.absorptionColor[1],
      this.absorptionColor[2],
    );
    prog.setUniform1f('u_absorptionScale', this.absorptionScale);
    prog.setUniform1i('u_enabled', this.enabled ? 1 : 0);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建资源(分辨率变化/上下文丢失等)。 */
  setDirty(): void {
    this._dirty = true;
  }

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
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._program = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 释放旧资源(分辨率变化时)
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
    }

    // 输出纹理(与上游 pipeline 一致,RGBA16F 兼容 HDR)
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 全屏三角形 VAO(只创建一次)
    if (!this._fullscreenQuadVao) {
      this._fullscreenQuadBuf = gl.createBuffer();
      this._fullscreenQuadVao = gl.createVertexArray();
      gl.bindVertexArray(this._fullscreenQuadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
      const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }

    this._width = w;
    this._height = h;
    this._initialized = true;
    log.debug(`init: ${w}×${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT, SCREEN_SPACE_REFRACTION_FRAG);
    }
    return this._program;
  }
}
