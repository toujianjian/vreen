// WhiteBalancePass — 白平衡后处理 Pass(Bradford 色彩适应变换)。
//
// 适配自 o3de Atom WhiteBalancePass + WhiteBalance.azsl。
// 通过 Temperature(色温)和 Tint(色调)参数调整场景白点,
// 使用 CIE xy 色度图 + LMS 锥响应空间(Bradford CAT)实现物理可信的白平衡。
//
// 算法:
//   1. (temperature, tint) → CIE xy 色度(目标白点)
//   2. xy → XYZ → LMS(Bradford 矩阵)
//   3. balance = D65_LMS / target_LMS(每通道缩放)
//   4. input → LMS → LMS*balance → linear(逆矩阵)
//
// 与 ColorGradingPass 的 temperature/tint 不同:
//   - ColorGradingPass: 简单 RGB 偏移(暖/冷色染色)
//   - WhiteBalancePass: 物理 CAT 变换(改变场景感知白点,
//     保持色域内其他颜色相对关系,与相机/电影白平衡一致)
//
// 默认 temperature=0 tint=0 为"不调整"(恒等变换)。
// 典型范围:temperature ∈ [-1.67, 1.67],tint ∈ [-1.67, 1.67]。
//   - temperature > 0: 变暖(降低色温,如夕阳、烛光)
//   - temperature < 0: 变冷(升高色温,如阴天、阴影)
//   - tint > 0: 偏品红
//   - tint < 0: 偏绿
//
// 参考:
//   - o3de Atom: PostProcessing/WhiteBalancePass.cpp + WhiteBalance.azsl
//   - Bradford CAT: Bradford (1996), "A discussion of the theory and
//     practice of chromatic adaptation"
//   - CIE Colorimetry: ISO/CIE 11664-3:2019
//   - ACES 1.0: white balance in IDT (Input Device Transform)

import { WHITE_BALANCE_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';

/** D65 白点在 CIE xy 色度空间的 x 坐标(标准照明体 D65)。 */
export const D65_WHITE_X = 0.31271;

/** D65 白点在 LMS 空间的参考值(由 xy=(0.31271, 0.32902) 经 Bradford 矩阵计算)。 */
export const D65_WHITE_LMS: Readonly<[number, number, number]> = [0.949237, 1.03542, 1.08728];

/**
 * 线性 RGB → LMS 转换矩阵(行主序,9 元素 flat 数组)。
 * 来自 o3de WhiteBalance.azsl LIN_2_LMS_MAT。
 * 基于 Bradford 雉响应函数。
 */
export const LIN_2_LMS_MAT: Readonly<[
  number, number, number,
  number, number, number,
  number, number, number,
]> = [
  3.90405e-1, 5.49941e-1, 8.92632e-3,
  7.08416e-2, 9.63172e-1, 1.35775e-3,
  2.31082e-2, 1.28021e-1, 9.36245e-1,
];

/**
 * LMS → 线性 RGB 转换矩阵(行主序,LIN_2_LMS_MAT 的逆)。
 * 来自 o3de WhiteBalance.azsl LMS_2_LIN_MAT。
 */
export const LMS_2_LIN_MAT: Readonly<[
  number, number, number,
  number, number, number,
  number, number, number,
]> = [
  2.85847e+0, -1.62879e+0, -2.48910e-2,
  -2.10182e-1, 1.15820e+0, 3.24281e-4,
  -4.18120e-2, -1.18169e-1, 1.06867e+0,
];

/** RGB 颜色三元组 [r, g, b]。 */
export type WBColor = [r: number, g: number, b: number];

/** 白平衡选项。 */
export interface WhiteBalanceOptions {
  /** 色温偏移(默认 0)。> 0 变暖,< 0 变冷。范围约 [-1.67, 1.67]。 */
  temperature?: number;
  /** 色调偏移(默认 0)。> 0 偏品红,< 0 偏绿。范围约 [-1.67, 1.67]。 */
  tint?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 将 (temperature, tint) 转换为目标白点的 CIE xy 色度坐标。
 *
 * 算法(与 o3de WhiteBalance.azsl 1:1 对应):
 *   x = 0.31271 - temperature * (temperature < 0 ? 0.1 : 0.05)
 *   y = 2.87*x - 3*x² - 0.27509507 + tint * 0.05
 *
 * @param temperature  色温偏移
 * @param tint         色调偏移
 * @returns [x, y] CIE 色度坐标
 */
export function temperatureTintToWhiteXY(
  temperature: number = 0,
  tint: number = 0,
): [number, number] {
  // x:基于 D65 白点 x=0.31271 偏移
  // 负温度(变冷)时偏移系数 0.1,正温度(变暖)时 0.05
  const x = D65_WHITE_X - temperature * (temperature < 0 ? 0.1 : 0.05);
  // y:普朗克黑体辐射轨迹的近似多项式 + tint 偏移
  const yBase = 2.87 * x - 3 * x * x - 0.27509507;
  const y = yBase + tint * 0.05;
  return [x, y];
}

/**
 * 将 CIE xy 色度坐标转换为 LMS 锥响应空间(Bradford 变换)。
 *
 * 算法:
 *   Y = 1 (归一化)
 *   X = Y * x / y
 *   Z = Y * (1 - x - y) / y
 *   L =  0.7328 * X + 0.4296 * Y - 0.1624 * Z
 *   M = -0.7036 * X + 1.6975 * Y + 0.0061 * Z
 *   S =  0.0030 * X + 0.0136 * Y + 0.9834 * Z
 *
 * @param x  CIE x 色度坐标
 * @param y  CIE y 色度坐标
 * @returns [L, M, S] 锥响应
 */
export function xyToLMS(x: number, y: number): [number, number, number] {
  // 防 y=0 除零
  const safeY = y === 0 ? 1e-10 : y;
  const Y = 1;
  const X = (Y * x) / safeY;
  const Z = (Y * (1 - x - y)) / safeY;
  const L = 0.7328 * X + 0.4296 * Y - 0.1624 * Z;
  const M = -0.7036 * X + 1.6975 * Y + 0.0061 * Z;
  const S = 0.0030 * X + 0.0136 * Y + 0.9834 * Z;
  return [L, M, S];
}

/**
 * 计算 LMS 空间的白平衡缩放向量。
 *
 * balance[i] = D65_LMS[i] / target_LMS[i]
 *
 * 该向量表示"将目标白点映射到 D65"所需的每通道缩放。
 *
 * @param temperature  色温偏移
 * @param tint         色调偏移
 * @returns [balanceL, balanceM, balanceS]
 */
export function computeWhiteBalance(
  temperature: number = 0,
  tint: number = 0,
): [number, number, number] {
  const [x, y] = temperatureTintToWhiteXY(temperature, tint);
  const [L, M, S] = xyToLMS(x, y);
  // 防除零
  const safeL = L === 0 ? 1e-10 : L;
  const safeM = M === 0 ? 1e-10 : M;
  const safeS = S === 0 ? 1e-10 : S;
  return [
    D65_WHITE_LMS[0] / safeL,
    D65_WHITE_LMS[1] / safeM,
    D65_WHITE_LMS[2] / safeS,
  ];
}

/**
 * 检测白平衡参数是否为"恒等变换"(temperature=0 且 tint=0)。
 * 用于跳过 pass 以节省 GPU 开销。
 */
export function isIdentityWhiteBalance(
  temperature: number = 0,
  tint: number = 0,
): boolean {
  return temperature === 0 && tint === 0;
}

/**
 * 行主序 3×3 矩阵 × 向量。
 * 矩阵布局:[r0c0, r0c1, r0c2, r1c0, r1c1, r1c2, r2c0, r2c1, r2c2]
 */
function mulMat3Vec3(
  m: Readonly<ArrayLike<number>>,
  v: Readonly<[number, number, number]>,
): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * 纯 CPU 实现的白平衡变换(与 GLSL `WHITE_BALANCE_FRAG` 1:1 对应)。
 *
 * 用于无头环境测试、离线校色、白平衡参数预览。不依赖 WebGL。
 *
 * @param color        输入颜色 [r, g, b](线性 RGB,推荐 ACEScg 工作空间)
 * @param temperature  色温偏移(默认 0)
 * @param tint         色调偏移(默认 0)
 * @returns 变换后颜色 [r, g, b]
 *
 * @example
 * ```ts
 * // 暖色调(夕阳场景)
 * const out = whiteBalance([0.5, 0.4, 0.3], 0.8, 0.0);
 * // 冷色调(阴天场景)
 * const cool = whiteBalance([0.5, 0.4, 0.3], -0.8, 0.0);
 * // 偏品红修正(荧光灯补偿)
 * const magenta = whiteBalance([0.5, 0.4, 0.3], 0.0, 0.3);
 * ```
 */
export function whiteBalance(
  color: WBColor | { 0: number; 1: number; 2: number } | ArrayLike<number>,
  temperature: number = 0,
  tint: number = 0,
): WBColor {
  // 恒等优化
  if (temperature === 0 && tint === 0) {
    return [color[0], color[1], color[2]];
  }

  const balance = computeWhiteBalance(temperature, tint);

  // input → LMS
  const input: [number, number, number] = [color[0], color[1], color[2]];
  const lms = mulMat3Vec3(LIN_2_LMS_MAT, input);

  // LMS * balance
  const balanced: [number, number, number] = [
    lms[0] * balance[0],
    lms[1] * balance[1],
    lms[2] * balance[2],
  ];

  // LMS → linear
  const out = mulMat3Vec3(LMS_2_LIN_MAT, balanced);
  return [out[0], out[1], out[2]];
}

/**
 * White Balance Pass。
 *
 * 在场景颜色上应用 Bradford 色彩适应变换,调整白点。
 * 与 ColorGradingPass 互补:ColorGradingPass 做创意调色,
 * 本 Pass 做物理白平衡(模拟相机白平衡设置)。
 *
 * @example
 * ```ts
 * const pass = new WhiteBalancePass({
 *   temperature: 0.5,   // 变暖(夕阳)
 *   tint: 0.1,          // 轻微品红
 * });
 * // 每帧(Tonemapping 之前,在线性空间应用):
 * const balanced = pass.apply(gl, hdrColorTexture);
 * ```
 */
export class WhiteBalancePass {
  readonly name = 'white-balance';

  temperature: number;
  tint: number;
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

  constructor(opts: WhiteBalanceOptions = {}) {
    this.temperature = opts.temperature ?? 0;
    this.tint = opts.tint ?? 0;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用白平衡变换。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  输入颜色纹理(推荐 HDR 线性空间,Tonemapping 之前)
   * @returns             变换后的颜色纹理(禁用或恒等时返回输入)
   */
  apply(gl: WebGL2RenderingContext, colorTexture: WebGLTexture): WebGLTexture {
    if (!this.enabled) {
      return colorTexture;
    }
    // 恒等变换时跳过 GPU 工作
    if (isIdentityWhiteBalance(this.temperature, this.tint)) {
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

    // 预计算 balance 向量(CPU 端,避免 GPU 重复计算)
    const balance = computeWhiteBalance(this.temperature, this.tint);
    prog.setUniform3f('u_balance', balance[0], balance[1], balance[2]);

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
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT, WHITE_BALANCE_FRAG);
    }
    return this._program;
  }
}
