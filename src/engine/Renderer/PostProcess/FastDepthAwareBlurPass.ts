// FastDepthAwareBlurPass — 深度感知可分离模糊(H + V 双 pass)。
//
// 适配 o3de Atom FastDepthAwareBlurPasses(Horizontal + Vertical)。
// 算法核心:沿模糊方向逐纹素推进,用前后深度斜率差检测边缘,在边缘处
// 递减混合权重,防止前景/背景颜色渗色产生 halo。
//
// 与普通高斯模糊的区别:
//   - 高斯:固定权重邻域混合 → 跨越深度边缘产生 halo(前景色"漏"到背景)
//   - 深度感知:深度斜率突变时 falloff → 0,模糊被限制在同一深度层内
//
// 典型用途:
//   - AO/SSGI 模糊(保持边缘锐利,避免暗角渗到前景)
//   - Bloom 细 mip 模糊(防止亮像素跨越深度边缘扩散)
//   - DoF 近景模糊(深度边缘停止扩散,避免前景被背景色污染)
//   - 屏幕空间反射/折射模糊
//
// 算法(o3de 原版核心,简化为片段 shader 版):
//   for i in 1..blurRadius:
//     prevDepth = currentDepth
//     currentDepth = sampleDepth(uv + i * step)
//     prevSlope = currentSlope
//     currentSlope = currentDepth - prevDepth
//     falloff = saturate(1 - |prevSlope - currentSlope| * strength) * constFalloff
//     currentValue = mix(currentValue, prevValue, falloff)
//     accumulator += currentValue * 0.5
//   双向(正/负方向)各累加一次,最后取平均。
//
// 与 o3de 原版差异:
//   - o3de 用 compute shader + LDS(共享内存)优化,每线程输出 3 像素
//   - 本实现用 fragment shader + 双向各采样 radius 步,简单直接
//   - o3de 单通道(R 通道 AO),本实现支持 RGB(通用模糊)
//   - o3de 用 GatherRGBA(一次采 4 邻域),本实现逐纹素采样
// 性能:O(blurRadius) 采样/方向/像素,2 方向 = 2*blurRadius 采样/像素。
//
// 参考:
//   - o3de Atom FastDepthAwareBlurPasses.h/cpp + FastDepthAwareBlurHor.azsl
//   - o3de Gems/Atom/Feature/Common/Assets/Shaders/PostProcessing/FastDepthAwareBlurCommon.azsli
//   - Jimenez 2014, "Next Generation Post-Processing in Call of Duty" (深度感知模糊思路)

import { POST_VERT as POST_VERT_SRC, FAST_DEPTH_AWARE_BLUR_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('FastDepthAwareBlurPass');

// ── 类型 ──────────────────────────────────────────────────────────

/** 模糊方向。 */
export type BlurDirection = 'horizontal' | 'vertical';

/** RGB 颜色三元组。 */
export type DABColor = [r: number, g: number, b: number];

/** 纯函数模糊参数(与 GPU uniforms 1:1 对应)。 */
export interface DABParams {
  /** 模糊半径(纹素数,默认 8)。 */
  blurRadius: number;
  /** 平面表面恒定衰减(默认 2/3 ≈ 0.667)。越大越模糊。 */
  constFalloff: number;
  /** 深度差阈值(默认 0)。低于此值的深度差被忽略,曲面上更柔和。 */
  depthFalloffThreshold: number;
  /** 深度斜率强度(默认 50)。越大边缘越锐利。 */
  depthFalloffStrength: number;
}

/** Pass 选项。 */
export interface FastDepthAwareBlurPassOptions {
  /** 模糊半径(纹素数,1..32,默认 8)。 */
  blurRadius?: number;
  /** 平面表面恒定衰减(默认 2/3)。 */
  constFalloff?: number;
  /** 深度差阈值(默认 0)。 */
  depthFalloffThreshold?: number;
  /** 深度斜率强度(默认 50)。 */
  depthFalloffStrength?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/** 默认参数(o3de Atom 推荐值)。 */
export const DEFAULT_DAB_PARAMS: DABParams = {
  blurRadius: 8,
  constFalloff: 2.0 / 3.0,
  depthFalloffThreshold: 0.0,
  depthFalloffStrength: 50.0,
};

// ── 纯 CPU 函数(与 GPU shader 1:1 对应) ──────────────────────────

/**
 * 计算深度斜率差对应的衰减权重(0..1)。
 *
 * @param prevSlope          前一个纹素对的深度斜率
 * @param curSlope           当前纹素对的深度斜率
 * @param threshold          深度差阈值(曲面忽略)
 * @param strength           强度(越大边缘越锐利)
 * @returns                  衰减权重 [0,1],1=完全模糊,0=完全停止
 */
export function calculateDepthFalloff(
  prevSlope: number,
  curSlope: number,
  threshold: number,
  strength: number,
): number {
  const diff = Math.abs(prevSlope - curSlope) - threshold;
  return Math.max(0.0, Math.min(1.0, 1.0 - diff * strength));
}

/**
 * 沿指定方向执行单侧模糊(从 startUV 向 dir 步进 radius 步)。
 *
 * 与 GPU shader 中的 blurDirection() 函数 1:1 对应。
 *
 * @param startUV        起点 UV
 * @param dir            方向向量(已归一化到纹素步长,如 [1/w, 0] 表示水平 +1 纹素)
 * @param centerDepth    起点深度
 * @param sampleColor    回调:给定 UV 返回 RGB 颜色
 * @param sampleDepth    回调:给定 UV 返回深度
 * @param params         模糊参数
 * @returns              该方向的累加 RGB(已乘 0.5)
 */
export function blurDirection(
  startUV: [number, number],
  dir: [number, number],
  centerDepth: number,
  sampleColor: (uv: [number, number]) => DABColor,
  sampleDepth: (uv: [number, number]) => number,
  params: DABParams,
): DABColor {
  const step: [number, number] = dir;

  // 初始化:前一个纹素 = 起点
  let prevDepth = centerDepth;
  let prevValue: DABColor = sampleColor(startUV);
  let prevSlope = 0.0;

  // 第一步:前进 1 纹素,建立初始 slope
  let uv: [number, number] = [startUV[0] + step[0], startUV[1] + step[1]];
  let curDepth = sampleDepth(uv);
  let curValue: DABColor = sampleColor(uv);
  prevSlope = curDepth - prevDepth;

  // 第一个采样:无 prevSlope,直接用 constFalloff
  curValue = mixColor(curValue, prevValue, params.constFalloff);

  let accR = curValue[0] * 0.5;
  let accG = curValue[1] * 0.5;
  let accB = curValue[2] * 0.5;

  // 剩余 radius-1 步
  for (let i = 1; i < params.blurRadius; ++i) {
    const prevValueLocal: DABColor = curValue;
    const prevDepthLocal = curDepth;
    const prevSlopeLocal = prevSlope;

    uv = [uv[0] + step[0], uv[1] + step[1]];
    curDepth = sampleDepth(uv);
    curValue = sampleColor(uv);
    const curSlope = curDepth - prevDepthLocal;

    const falloff = calculateDepthFalloff(
      prevSlopeLocal, curSlope,
      params.depthFalloffThreshold, params.depthFalloffStrength,
    ) * params.constFalloff;
    curValue = mixColor(curValue, prevValueLocal, falloff);

    accR += curValue[0] * 0.5;
    accG += curValue[1] * 0.5;
    accB += curValue[2] * 0.5;
  }

  return [accR, accG, accB];
}

/**
 * 完整像素处理:正方向 + 负方向各累加一次,取平均。
 *
 * 与 GPU shader 的 main() 1:1 对应。
 *
 * @param centerUV       中心像素 UV
 * @param sampleColor    回调:给定 UV 返回 RGB 颜色
 * @param sampleDepth    回调:给定 UV 返回深度
 * @param texel          纹素大小 [1/w, 1/h]
 * @param direction      方向:(1,0)=水平,(0,1)=垂直
 * @param params         模糊参数
 * @returns              模糊后的 RGB 颜色
 */
export function fastDepthAwareBlurPixel(
  centerUV: [number, number],
  sampleColor: (uv: [number, number]) => DABColor,
  sampleDepth: (uv: [number, number]) => number,
  texel: [number, number],
  direction: [number, number],
  params: DABParams = DEFAULT_DAB_PARAMS,
): DABColor {
  const centerDepth = sampleDepth(centerUV);

  // 正方向
  const posStep: [number, number] = [direction[0] * texel[0], direction[1] * texel[1]];
  const posAcc = blurDirection(centerUV, posStep, centerDepth, sampleColor, sampleDepth, params);

  // 负方向
  const negStep: [number, number] = [-posStep[0], -posStep[1]];
  const negAcc = blurDirection(centerUV, negStep, centerDepth, sampleColor, sampleDepth, params);

  // 双向平均
  return [
    (posAcc[0] + negAcc[0]) * 0.5,
    (posAcc[1] + negAcc[1]) * 0.5,
    (posAcc[2] + negAcc[2]) * 0.5,
  ];
}

/** RGB 线性插值(与 GLSL mix 等价)。t ∈ [0,1]。 */
function mixColor(a: DABColor, b: DABColor, t: number): DABColor {
  const s = 1.0 - t;
  return [
    a[0] * s + b[0] * t,
    a[1] * s + b[1] * t,
    a[2] * s + b[2] * t,
  ];
}

// ── GPU Pass ──────────────────────────────────────────────────────

/**
 * FastDepthAwareBlur Pass。H + V 双 pass,内部 ping-pong FBO。
 *
 * apply() 把 colorTexture + depthTexture 喂给 H blur shader → 输出到
 * intermediateFbo → 再把 intermediate 作为输入喂给 V blur shader → 输出到
 * outputFbo。返回最终模糊纹理。
 *
 * 典型管线位置:`SSAO/GTAO → FastDepthAwareBlur → Composite`
 * 或:`SSGI → FastDepthAwareBlur → Composite`
 */
export class FastDepthAwareBlurPass {
  readonly name = 'fast-depth-aware-blur';

  /** 模糊半径(纹素数,1..32)。 */
  blurRadius: number = 8;
  /** 平面表面恒定衰减(默认 2/3)。 */
  constFalloff: number = 2.0 / 3.0;
  /** 深度差阈值(默认 0)。 */
  depthFalloffThreshold: number = 0.0;
  /** 深度斜率强度(默认 50)。 */
  depthFalloffStrength: number = 50.0;
  /** 是否启用。 */
  enabled: boolean = true;

  /** 当前输出纹理(apply 后可用)。 */
  private _outputTexture: WebGLTexture | null = null;
  /** H blur 输出纹理(V blur 的输入)。 */
  private _intermediateTexture: WebGLTexture | null = null;
  private _outputFbo: WebGLFramebuffer | null = null;
  private _intermediateFbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: FastDepthAwareBlurPassOptions = {}) {
    if (opts.blurRadius !== undefined) this.blurRadius = opts.blurRadius;
    if (opts.constFalloff !== undefined) this.constFalloff = opts.constFalloff;
    if (opts.depthFalloffThreshold !== undefined) this.depthFalloffThreshold = opts.depthFalloffThreshold;
    if (opts.depthFalloffStrength !== undefined) this.depthFalloffStrength = opts.depthFalloffStrength;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  /** 设置模糊半径(1..32)。 */
  setRadius(r: number): void {
    this.blurRadius = Math.max(1, Math.min(32, Math.floor(r)));
    log.debug(`radius set to ${this.blurRadius}`);
  }

  /**
   * 执行 H + V 双 pass 深度感知模糊。
   *
   * @param gl             WebGL2 上下文
   * @param colorTexture   待模糊的颜色纹理(RGBA8 或 RGBA16F)
   * @param depthTexture   线性深度纹理(单通道 R32F 或 R16F,view space Z)
   * @returns              模糊后的纹理(本 Pass 持有,不要释放)
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    depthTexture: WebGLTexture,
  ): WebGLTexture {
    const targetW = gl.canvas.width;
    const targetH = gl.canvas.height;
    if (!this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
    }

    // disabled 时返回上一帧输出(避免下游 null)
    if (!this.enabled) {
      return this._outputTexture as WebGLTexture;
    }

    const prog = this._getProgram(gl);
    prog.use();

    // ── Pass 1: 水平模糊 colorTexture → intermediateFbo ─────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._intermediateFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    prog.setUniform2f('u_texel', 1.0 / this._width, 1.0 / this._height);
    prog.setUniform2f('u_direction', 1.0, 0.0);  // H
    prog.setUniform1i('u_blurRadius', Math.max(1, Math.min(32, Math.floor(this.blurRadius))));
    prog.setUniform1f('u_constFalloff', this.constFalloff);
    prog.setUniform1f('u_depthFalloffThreshold', this.depthFalloffThreshold);
    prog.setUniform1f('u_depthFalloffStrength', this.depthFalloffStrength);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── Pass 2: 垂直模糊 intermediateTexture → outputFbo ────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._outputFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // intermediateTexture 现在是输入
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._intermediateTexture as WebGLTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 深度纹理不变(同一张)
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    prog.setUniform2f('u_direction', 0.0, 1.0);  // V

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 释放内部 FBO / 纹理 / VAO / program。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._outputTexture) {
      gl.deleteTexture(this._outputTexture);
      this._outputTexture = null;
    }
    if (this._intermediateTexture) {
      gl.deleteTexture(this._intermediateTexture);
      this._intermediateTexture = null;
    }
    if (this._outputFbo) {
      gl.deleteFramebuffer(this._outputFbo);
      this._outputFbo = null;
    }
    if (this._intermediateFbo) {
      gl.deleteFramebuffer(this._intermediateFbo);
      this._intermediateFbo = null;
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

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, FAST_DEPTH_AWARE_BLUR_FRAG);
    log.info('FastDepthAwareBlur program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._intermediateTexture) gl.deleteTexture(this._intermediateTexture);
      if (this._outputFbo) gl.deleteFramebuffer(this._outputFbo);
      if (this._intermediateFbo) gl.deleteFramebuffer(this._intermediateFbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // 输出纹理(RGBA8,适合 AO/SSGI 等低动态范围;若用于 HDR Bloom 可改 RGBA16F)
    this._outputTexture = createColorTexture(gl, width, height);
    this._intermediateTexture = createColorTexture(gl, width, height);

    this._outputFbo = gl.createFramebuffer();
    if (!this._outputFbo) throw new Error('FastDepthAwareBlurPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._outputFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);

    this._intermediateFbo = gl.createFramebuffer();
    if (!this._intermediateFbo) throw new Error('FastDepthAwareBlurPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._intermediateFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._intermediateTexture, 0);

    // 全屏四边形 VAO(position@0 + uv@2)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('FastDepthAwareBlurPass: createVertexArray/Buffer() returned null');
    const verts = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
       1,  1, 1, 1,
      -1, -1, 0, 0,
       1,  1, 1, 1,
      -1,  1, 0, 1,
    ]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`FastDepthAwareBlur FBOs created: ${width}x${height}`);
  }
}

/** 创建一个 RGBA8 颜色纹理(屏幕尺寸,LINEAR + CLAMP_TO_EDGE)。 */
function createColorTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('FastDepthAwareBlurPass: createTexture() returned null');
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
