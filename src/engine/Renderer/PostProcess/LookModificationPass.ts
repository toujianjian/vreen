// LookModificationPass — ASC-CDL 色彩决策表后处理 Pass。
//
// 实现 ASC-CDL (American Society of Cinematographers Color Decision List) 1.2 规范,
// 影视后期行业标准,用于 DaVinci Resolve / Nuke / Baselight 等工具之间交换色彩分级。
// 与 ColorGradingPass(自有 8 参数)互补:本 Pass 严格遵循 ASC-CDL 标准,
// 可导入/导出 .cdl XML,实现与专业调色工具的互操作。
//
// 算法 (ASC-CDL SOP+Sat):
//   out = (in * S + O) ^ P              // per-channel Slope / Offset / Power
//   luma = dot(out, lumaWeights)        // Rec709 亮度
//   out = luma + sat * (out - luma)     // global saturation
//
// 默认 S=(1,1,1) O=(0,0,0) P=(1,1,1) sat=1 为"不调整"(恒等变换)。
//
// 性能:单 pass,1 次纹理采样 + 3 次 vec3 运算。无降采样依赖。
// 适合在 Tonemapping 之后、最终输出之前应用。
//
// 参考:
//   - ASC-CDL 1.2 规范: https://asc-ddl.org/
//   - o3de Atom: PostProcessing/LookModificationTransformPass
//   - DaVinci Resolve: CDL 节点
//   - ACES 1.0: Look Modification Transform

import { LOOK_MODIFICATION_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('LookModificationPass');

/** Rec709 亮度权重 (线性 RGB → luma)。 */
export const REC709_LUMA: Readonly<[number, number, number]> = [0.2126, 0.7152, 0.0722];

/** CDL 颜色三元组 [r, g, b](与 Core/RGB 接口不同,本类型为 tuple 形式)。 */
export type CDLColor = [r: number, g: number, b: number];

/** ASC-CDL 参数(Slope / Offset / Power + Saturation)。 */
export interface ASCCDLParams {
  /** Slope (gain/multiply),默认 (1,1,1)。每通道乘法。 */
  slope?: CDLColor;
  /** Offset (lift/add),默认 (0,0,0)。每通道加法。 */
  offset?: CDLColor;
  /** Power (gamma),默认 (1,1,1)。每通道幂运算。 */
  power?: CDLColor;
  /** Saturation,默认 1.0。0=灰度,1=原色,>1=更饱和。 */
  saturation?: number;
}

export interface LookModificationOptions extends ASCCDLParams {
  /**
   * 亮度权重(默认 Rec709)。可改为 Rec601 (0.299, 0.587, 0.114)
   * 或 ACES (0.2726876, 0.6746814, 0.0526308) 等。
   */
  lumaWeights?: CDLColor;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 纯 CPU 实现的 ASC-CDL 变换(与 GLSL `LOOK_MODIFICATION_FRAG` 1:1 对应)。
 *
 * 用于无头环境测试、离线校色、.cdl 文件验证。不依赖 WebGL。
 *
 * @param color  输入颜色 [r, g, b](线性 RGB,0..1 或 HDR 均可)
 * @param params  ASC-CDL 参数(slope/offset/power/saturation)
 * @param lumaWeights  亮度权重(默认 Rec709)
 * @returns 变换后颜色 [r, g, b]
 *
 * @example
 * ```ts
 * // 应用 CDL:Slope=1.2, Offset=-0.05, Power=0.9, Sat=1.1
 * const out = ascCDL([0.5, 0.4, 0.3], {
 *   slope: [1.2, 1.2, 1.2],
 *   offset: [-0.05, -0.05, -0.05],
 *   power: [0.9, 0.9, 0.9],
 *   saturation: 1.1,
 * });
 * ```
 */
export function ascCDL(
  color: CDLColor | { 0: number; 1: number; 2: number } | ArrayLike<number>,
  params: ASCCDLParams = {},
  lumaWeights: CDLColor = [...REC709_LUMA] as CDLColor,
): CDLColor {
  const r = color[0];
  const g = color[1];
  const b = color[2];

  const s = params.slope ?? ([1, 1, 1] as CDLColor);
  const o = params.offset ?? ([0, 0, 0] as CDLColor);
  const p = params.power ?? ([1, 1, 1] as CDLColor);
  const sat = params.saturation ?? 1.0;

  // out = (in * S + O) ^ P   (max 0 防止负值 pow NaN)
  let or = r * s[0] + o[0];
  let og = g * s[1] + o[1];
  let ob = b * s[2] + o[2];

  or = or <= 0 ? 0 : Math.pow(or, p[0]);
  og = og <= 0 ? 0 : Math.pow(og, p[1]);
  ob = ob <= 0 ? 0 : Math.pow(ob, p[2]);

  // saturation: out = luma + sat * (out - luma)
  const luma = or * lumaWeights[0] + og * lumaWeights[1] + ob * lumaWeights[2];
  or = luma + sat * (or - luma);
  og = luma + sat * (og - luma);
  ob = luma + sat * (ob - luma);

  return [or, og, ob];
}

/**
 * 检测 ASC-CDL 参数是否为"恒等变换"(即不调整)。
 * 用于跳过 pass 以节省 GPU 开销。
 */
export function isIdentityCDL(params: ASCCDLParams): boolean {
  const s = params.slope ?? ([1, 1, 1] as CDLColor);
  const o = params.offset ?? ([0, 0, 0] as CDLColor);
  const p = params.power ?? ([1, 1, 1] as CDLColor);
  const sat = params.saturation ?? 1.0;
  return (
    s[0] === 1 && s[1] === 1 && s[2] === 1 &&
    o[0] === 0 && o[1] === 0 && o[2] === 0 &&
    p[0] === 1 && p[1] === 1 && p[2] === 1 &&
    sat === 1
  );
}

/**
 * ASC-CDL Look Modification Pass。
 *
 * 在最终颜色上应用 ASC-CDL SOP+Sat 变换。与 ColorGradingPass 互补:
 * ColorGradingPass 使用自有 8 参数(temperature/tint/saturation/contrast/gain/lift/gamma/hueShift);
 * 本 Pass 严格遵循 ASC-CDL 标准,可与 DaVinci Resolve / Nuke 等专业工具交换 .cdl 文件。
 *
 * @example
 * ```ts
 * const pass = new LookModificationPass({
 *   slope: [1.1, 1.05, 0.95],   // 暖色提亮
 *   offset: [-0.02, -0.02, -0.02], // 轻微压暗
 *   power: [0.95, 1.0, 1.05],    // 调整中间调对比
 *   saturation: 1.08,
 * });
 * // 每帧(Tonemapping 之后):
 * const graded = pass.apply(gl, finalColorTexture);
 * ```
 */
export class LookModificationPass {
  readonly name = 'look-modification';

  slope: CDLColor;
  offset: CDLColor;
  power: CDLColor;
  saturation: number;
  lumaWeights: CDLColor;
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

  constructor(opts: LookModificationOptions = {}) {
    this.slope = opts.slope ?? ([1, 1, 1] as CDLColor);
    this.offset = opts.offset ?? ([0, 0, 0] as CDLColor);
    this.power = opts.power ?? ([1, 1, 1] as CDLColor);
    this.saturation = opts.saturation ?? 1.0;
    this.lumaWeights = opts.lumaWeights ?? ([...REC709_LUMA] as CDLColor);
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用 ASC-CDL Look Modification。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  输入颜色纹理(通常为 Tonemapping 后的 LDR;也支持 HDR)
   * @returns             变换后的颜色纹理(禁用或恒等时返回输入)
   */
  apply(gl: WebGL2RenderingContext, colorTexture: WebGLTexture): WebGLTexture {
    if (!this.enabled) {
      return colorTexture;
    }
    // 恒等变换时跳过 GPU 工作
    if (isIdentityCDL({
      slope: this.slope,
      offset: this.offset,
      power: this.power,
      saturation: this.saturation,
    })) {
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
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getProgram(gl);
    prog.use();

    // 输入纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // ASC-CDL 参数
    prog.setUniform3f('u_slope', this.slope[0], this.slope[1], this.slope[2]);
    prog.setUniform3f('u_offset', this.offset[0], this.offset[1], this.offset[2]);
    prog.setUniform3f('u_power', this.power[0], this.power[1], this.power[2]);
    prog.setUniform1f('u_saturation', this.saturation);
    prog.setUniform3f('u_lumaWeights', this.lumaWeights[0], this.lumaWeights[1], this.lumaWeights[2]);

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

    // 输出纹理(默认 LDR pipeline,RGBA8;若上游为 HDR 可改 RGBA16F)
    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
      this._program = new ShaderProgram(gl, POST_VERT, LOOK_MODIFICATION_FRAG);
    }
    return this._program;
  }
}
