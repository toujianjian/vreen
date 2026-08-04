// BloomEnhancedPass — 深度感知保边 Bloom(单 mip,H + V 双 pass)。
//
// 与 UnrealBloomPass 的差异:
//   - UnrealBloomPass:5 级 mip + 普通高斯模糊 → 跨越深度边缘产生 halo
//     (前景亮像素"漏"到背景,背景亮像素"渗"到前景)。
//   - BloomEnhancedPass:单 mip + FastDepthAwareBlur(深度斜率边缘停止)→
//     bloom 被限制在同一深度层内,前景/背景不互相污染。
//
// 适用场景:
//   - 高对比度场景(Neon 边缘 + 暗背景):UnrealBloom 会让暗背景发灰,
//     BloomEnhanced 保持背景纯黑。
//   - 角色/物体边缘高光:UnrealBloom 会让边缘"漏光"到周围空间,
//     BloomEnhanced 保持边缘锐利。
//   - 性能敏感场景:单 mip 比 5 级 mip 便宜很多(2 次 draw vs 12 次)。
//
// 管线阶段(4 次 GPU draw):
//   1. Bright pass(soft knee)         → brightTex (FBO)
//   2. FastDepthAwareBlur H           → blurHTex (FBO)
//   3. FastDepthAwareBlur V           → blurVTex (FBO)
//   4. Composite(源 + bloom * strength) → outputTex (FBO)
//
// 与 soup3D 对比:
//   - soup3D 仅有单级 box blur Bloom(看源码),无深度感知,无 soft knee,
//     无 lens dirt,无 tint 染色。
//   - VREEN BloomEnhancedPass 用深度感知模糊保持边缘锐利,soft knee 避免
//     亮部硬边,lens dirt 提供电影感,tint 支持 RGB 染色。
//
// 参考:
//   - o3de Atom FastDepthAwareBlurPasses(深度感知模糊核心算法)
//   - three.js UnrealBloomPass.js(bright pass soft knee 公式)
//   - Jorge Jiminez @ SIGGRAPH 2014,"Next Generation Post-Processing
//     in Call of Duty Advanced Warfare"(soft knee 与 lens dirt 原理)

import {
  POST_VERT as POST_VERT_SRC,
  BLOOM_HIGHPASS_FRAG,
  FAST_DEPTH_AWARE_BLUR_FRAG,
  BLOOM_ENHANCED_COMPOSITE_FRAG,
} from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('BloomEnhancedPass');

// ── 类型 ──────────────────────────────────────────────────────────

/** RGB 颜色三元组(0..1 或 HDR >1)。 */
export type BEColor = [r: number, g: number, b: number];

/** Bright pass 参数(与 BLOOM_HIGHPASS_FRAG uniforms 1:1 对应)。 */
export interface BrightPassParams {
  /** 亮度阈值,低于此值的像素不贡献 bloom。默认 0.85。 */
  threshold: number;
  /** knee 软边宽度(相对 threshold 的比例)。默认 0.01。越大越柔和。 */
  smoothWidth: number;
}

/** BloomEnhancedPass 选项。 */
export interface BloomEnhancedOptions {
  /** bloom 强度,默认 1.0。 */
  strength?: number;
  /** 亮度阈值,默认 0.85。 */
  threshold?: number;
  /** knee 软边宽度,默认 0.01。 */
  smoothWidth?: number;
  /** 模糊半径(纹素数,1..32,默认 8)。 */
  blurRadius?: number;
  /** 平面表面恒定衰减(默认 2/3)。 */
  constFalloff?: number;
  /** 深度差阈值(默认 0)。 */
  depthFalloffThreshold?: number;
  /** 深度斜率强度(默认 50)。越大边缘越锐利。 */
  depthFalloffStrength?: number;
  /** bloom RGB 染色,默认 [1,1,1](不染色)。 */
  tint?: BEColor;
  /** 镜头污渍纹理(可选)。 */
  dirtTexture?: WebGLTexture | null;
  /** 污渍强度,0 = 禁用,默认 0。 */
  dirtStrength?: number;
  /** 是否启用,默认 true。 */
  enabled?: boolean;
}

/** 默认参数。 */
export const DEFAULT_BLOOM_ENHANCED_PARAMS = {
  strength: 1.0,
  threshold: 0.85,
  smoothWidth: 0.01,
  blurRadius: 8,
  constFalloff: 2.0 / 3.0,
  depthFalloffThreshold: 0.0,
  depthFalloffStrength: 50.0,
  tint: [1, 1, 1] as BEColor,
  dirtStrength: 0.0,
};

// ── 纯 CPU 函数(与 GPU shader 1:1 对应) ──────────────────────────

/**
 * 计算像素的 Rec.709 亮度。
 * 与 BLOOM_HIGHPASS_FRAG 中的 luminance() 1:1 对应。
 */
export function luminance(c: BEColor): number {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

/**
 * Bright pass(soft knee)单像素处理。
 *
 * 与 BLOOM_HIGHPASS_FRAG 的 main() 1:1 对应:
 *   knee = threshold * smoothWidth + ε
 *   soft = clamp(v - threshold + knee, 0, 2*knee)
 *   soft = soft² / (4*knee + ε)
 *   contribution = max(soft, v - threshold) / max(v, ε)
 *   out = color * contribution
 *
 * @param color    源 RGB 颜色
 * @param params   bright pass 参数
 * @returns         贡献到 bloom 的 RGB(可能为 0)
 */
export function brightPassPixel(color: BEColor, params: BrightPassParams): BEColor {
  const v = luminance(color);
  const knee = params.threshold * params.smoothWidth + 1e-5;
  let soft = v - params.threshold + knee;
  soft = Math.max(0.0, Math.min(2.0 * knee, soft));
  soft = (soft * soft) / (4.0 * knee + 1e-5);
  const contribution = Math.max(soft, v - params.threshold) / Math.max(v, 1e-5);
  return [
    color[0] * contribution,
    color[1] * contribution,
    color[2] * contribution,
  ];
}

/**
 * Bloom 合成单像素处理。
 *
 * 与 BLOOM_ENHANCED_COMPOSITE_FRAG 的 main() 1:1 对应:
 *   bloomFinal = bloom * tint * strength
 *   bloomFinal *= (1 + dirt * dirtStrength)
 *   out = color + bloomFinal
 *
 * @param color         源 RGB
 * @param bloom         模糊后的 bloom RGB
 * @param dirt          污渍 RGB(无污渍时传 [0,0,0])
 * @param strength      bloom 强度
 * @param dirtStrength  污渍强度
 * @param tint          bloom 染色
 * @returns             合成后 RGB
 */
export function bloomCompositePixel(
  color: BEColor,
  bloom: BEColor,
  dirt: BEColor,
  strength: number,
  dirtStrength: number,
  tint: BEColor,
): BEColor {
  const bf0 = bloom[0] * tint[0] * strength;
  const bf1 = bloom[1] * tint[1] * strength;
  const bf2 = bloom[2] * tint[2] * strength;
  const dMul = 1.0 + dirt[0] * dirtStrength; // dirt 用 R 通道近似亮度(与 shader 一致:shader 用 vec3 dirt 但乘到标量)
  // 注:shader 中 bloomFinal *= (1.0 + dirt * u_dirtStrength) 是 vec3 运算,
  //     即每通道独立。这里为保持 1:1,改为三通道独立。
  const dMul1 = 1.0 + dirt[1] * dirtStrength;
  const dMul2 = 1.0 + dirt[2] * dirtStrength;
  return [
    color[0] + bf0 * dMul,
    color[1] + bf1 * dMul1,
    color[2] + bf2 * dMul2,
  ];
}

// ── GPU Pass ──────────────────────────────────────────────────────

/**
 * BloomEnhancedPass。深度感知保边 Bloom。
 *
 * apply() 流程:
 *   1. Bright pass(soft knee)把源 colorTexture 中亮度 > threshold 的像素
 *      提取到 brightTex。
 *   2. FastDepthAwareBlur H 把 brightTex 沿水平方向模糊 → blurHTex。
 *   3. FastDepthAwareBlur V 把 blurHTex 沿垂直方向模糊 → blurVTex。
 *      (H+V 双 pass,深度边缘停止扩散)
 *   4. Composite 把 blurVTex 加法混合回源 colorTexture → outputTex。
 *
 * 典型管线位置:`SceneColor → BloomEnhanced → OutputTransform`
 */
export class BloomEnhancedPass {
  readonly name = 'bloom-enhanced';

  /** bloom 强度。 */
  strength: number;
  /** 亮度阈值。 */
  threshold: number;
  /** knee 软边宽度。 */
  smoothWidth: number;
  /** 模糊半径(纹素数,1..32)。 */
  blurRadius: number;
  /** 平面表面恒定衰减。 */
  constFalloff: number;
  /** 深度差阈值。 */
  depthFalloffThreshold: number;
  /** 深度斜率强度。 */
  depthFalloffStrength: number;
  /** bloom RGB 染色。 */
  tint: BEColor;
  /** 镜头污渍纹理(null 时禁用)。 */
  dirtTexture: WebGLTexture | null;
  /** 污渍强度。 */
  dirtStrength: number;
  /** 是否启用。 */
  enabled: boolean;

  private _brightTex: WebGLTexture | null = null;
  private _brightFbo: WebGLFramebuffer | null = null;
  private _blurHTex: WebGLTexture | null = null;
  private _blurHFbo: WebGLFramebuffer | null = null;
  private _blurVTex: WebGLTexture | null = null;
  private _blurVFbo: WebGLFramebuffer | null = null;
  private _outputTex: WebGLTexture | null = null;
  private _outputFbo: WebGLFramebuffer | null = null;
  private _blackTex: WebGLTexture | null = null;
  private _brightProg: ShaderProgram | null = null;
  private _blurProg: ShaderProgram | null = null;
  private _compositeProg: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: BloomEnhancedOptions = {}) {
    this.strength = opts.strength ?? DEFAULT_BLOOM_ENHANCED_PARAMS.strength;
    this.threshold = opts.threshold ?? DEFAULT_BLOOM_ENHANCED_PARAMS.threshold;
    this.smoothWidth = opts.smoothWidth ?? DEFAULT_BLOOM_ENHANCED_PARAMS.smoothWidth;
    this.blurRadius = opts.blurRadius ?? DEFAULT_BLOOM_ENHANCED_PARAMS.blurRadius;
    this.constFalloff = opts.constFalloff ?? DEFAULT_BLOOM_ENHANCED_PARAMS.constFalloff;
    this.depthFalloffThreshold = opts.depthFalloffThreshold ?? DEFAULT_BLOOM_ENHANCED_PARAMS.depthFalloffThreshold;
    this.depthFalloffStrength = opts.depthFalloffStrength ?? DEFAULT_BLOOM_ENHANCED_PARAMS.depthFalloffStrength;
    this.tint = opts.tint ?? DEFAULT_BLOOM_ENHANCED_PARAMS.tint;
    this.dirtTexture = opts.dirtTexture ?? null;
    this.dirtStrength = opts.dirtStrength ?? DEFAULT_BLOOM_ENHANCED_PARAMS.dirtStrength;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 执行深度感知保边 Bloom。
   *
   * @param gl             WebGL2 上下文
   * @param colorTexture   源颜色纹理(HDR,线性空间)
   * @param depthTexture   线性深度纹理(单通道,view space Z)
   * @returns              合成后的纹理(本 Pass 持有,不要释放)
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    depthTexture: WebGLTexture,
  ): WebGLTexture {
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    if (!this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
    }

    if (!this.enabled) {
      return this._outputTex as WebGLTexture;
    }

    // ── 1. Bright pass(soft knee)→ brightTex ───────────────────
    const brightProg = this._getProgram(gl, 'bright', this._brightProg, BLOOM_HIGHPASS_FRAG);
    this._brightProg = brightProg;
    brightProg.use();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._brightFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    brightProg.setUniformSampler('u_colorMap', 0);
    brightProg.setUniform1f('u_luminosityThreshold', this.threshold);
    brightProg.setUniform1f('u_smoothWidth', Math.max(1e-4, this.smoothWidth));

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── 2. FastDepthAwareBlur H → blurHTex ───────────────────────
    const blurProg = this._getProgram(gl, 'blur', this._blurProg, FAST_DEPTH_AWARE_BLUR_FRAG);
    this._blurProg = blurProg;
    blurProg.use();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._blurHFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._brightTex as WebGLTexture);
    blurProg.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    blurProg.setUniformSampler('u_depthMap', 1);
    blurProg.setUniform2f('u_texel', 1.0 / this._width, 1.0 / this._height);
    blurProg.setUniform2f('u_direction', 1.0, 0.0);  // H
    blurProg.setUniform1i('u_blurRadius', Math.max(1, Math.min(32, Math.floor(this.blurRadius))));
    blurProg.setUniform1f('u_constFalloff', this.constFalloff);
    blurProg.setUniform1f('u_depthFalloffThreshold', this.depthFalloffThreshold);
    blurProg.setUniform1f('u_depthFalloffStrength', this.depthFalloffStrength);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── 3. FastDepthAwareBlur V → blurVTex ───────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._blurVFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._blurHTex as WebGLTexture);
    blurProg.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    blurProg.setUniformSampler('u_depthMap', 1);
    blurProg.setUniform2f('u_direction', 0.0, 1.0);  // V

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── 4. Composite → outputTex ────────────────────────────────
    const compProg = this._getProgram(gl, 'composite', this._compositeProg, BLOOM_ENHANCED_COMPOSITE_FRAG);
    this._compositeProg = compProg;
    compProg.use();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._outputFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    compProg.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._blurVTex as WebGLTexture);
    compProg.setUniformSampler('u_bloomMap', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, (this.dirtTexture ?? this._blackTex) as WebGLTexture);
    compProg.setUniformSampler('u_dirtTexture', 2);
    compProg.setUniform1f('u_bloomStrength', this.strength);
    compProg.setUniform1f('u_dirtStrength', this.dirtTexture ? this.dirtStrength : 0.0);
    compProg.setUniform3f('u_bloomTint', this.tint[0], this.tint[1], this.tint[2]);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTex as WebGLTexture;
  }

  /** 释放内部资源。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._brightTex) { gl.deleteTexture(this._brightTex); this._brightTex = null; }
    if (this._brightFbo) { gl.deleteFramebuffer(this._brightFbo); this._brightFbo = null; }
    if (this._blurHTex) { gl.deleteTexture(this._blurHTex); this._blurHTex = null; }
    if (this._blurHFbo) { gl.deleteFramebuffer(this._blurHFbo); this._blurHFbo = null; }
    if (this._blurVTex) { gl.deleteTexture(this._blurVTex); this._blurVTex = null; }
    if (this._blurVFbo) { gl.deleteFramebuffer(this._blurVFbo); this._blurVFbo = null; }
    if (this._outputTex) { gl.deleteTexture(this._outputTex); this._outputTex = null; }
    if (this._outputFbo) { gl.deleteFramebuffer(this._outputFbo); this._outputFbo = null; }
    if (this._blackTex) { gl.deleteTexture(this._blackTex); this._blackTex = null; }
    if (this._fullscreenQuadVao) { gl.deleteVertexArray(this._fullscreenQuadVao); this._fullscreenQuadVao = null; }
    if (this._fullscreenQuadBuf) { gl.deleteBuffer(this._fullscreenQuadBuf); this._fullscreenQuadBuf = null; }
    if (this._brightProg) { this._brightProg.dispose(); this._brightProg = null; }
    if (this._blurProg) { this._blurProg.dispose(); this._blurProg = null; }
    if (this._compositeProg) { this._compositeProg.dispose(); this._compositeProg = null; }
    this._initialized = false;
    this._width = 0;
    this._height = 0;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────

  private _getProgram(
    gl: WebGL2RenderingContext,
    kind: 'bright' | 'blur' | 'composite',
    existing: ShaderProgram | null,
    frag: string,
  ): ShaderProgram {
    if (existing) return existing;
    const prog = new ShaderProgram(gl, POST_VERT_SRC, frag);
    log.info(`${kind} program compiled`);
    return prog;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) this._disposeGPU(gl);

    // RGBA16F 适合 HDR bloom;若不支持可降级 RGBA8
    this._brightTex = createHDRTexture(gl, width, height);
    this._blurHTex = createHDRTexture(gl, width, height);
    this._blurVTex = createHDRTexture(gl, width, height);
    this._outputTex = createHDRTexture(gl, width, height);

    this._brightFbo = createFBO(gl, this._brightTex);
    this._blurHFbo = createFBO(gl, this._blurHTex);
    this._blurVFbo = createFBO(gl, this._blurVTex);
    this._outputFbo = createFBO(gl, this._outputTex);

    // 1x1 黑色纹理(dirtTexture=null 时的 placeholder)
    this._blackTex = gl.createTexture();
    if (this._blackTex) {
      gl.bindTexture(gl.TEXTURE_2D, this._blackTex);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    // 全屏四边形 VAO(position@0 + uv@2)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('BloomEnhancedPass: createVertexArray/Buffer() returned null');
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

    log.info(`BloomEnhanced FBOs created: ${width}x${height}`);
  }

  private _disposeGPU(gl: WebGL2RenderingContext): void {
    if (this._brightTex) { gl.deleteTexture(this._brightTex); this._brightTex = null; }
    if (this._brightFbo) { gl.deleteFramebuffer(this._brightFbo); this._brightFbo = null; }
    if (this._blurHTex) { gl.deleteTexture(this._blurHTex); this._blurHTex = null; }
    if (this._blurHFbo) { gl.deleteFramebuffer(this._blurHFbo); this._blurHFbo = null; }
    if (this._blurVTex) { gl.deleteTexture(this._blurVTex); this._blurVTex = null; }
    if (this._blurVFbo) { gl.deleteFramebuffer(this._blurVFbo); this._blurVFbo = null; }
    if (this._outputTex) { gl.deleteTexture(this._outputTex); this._outputTex = null; }
    if (this._outputFbo) { gl.deleteFramebuffer(this._outputFbo); this._outputFbo = null; }
    if (this._fullscreenQuadVao) { gl.deleteVertexArray(this._fullscreenQuadVao); this._fullscreenQuadVao = null; }
    if (this._fullscreenQuadBuf) { gl.deleteBuffer(this._fullscreenQuadBuf); this._fullscreenQuadBuf = null; }
  }
}

// ── helpers ──────────────────────────────────────────────────────

/** 创建 RGBA16F HDR 颜色纹理(屏幕尺寸,LINEAR + CLAMP_TO_EDGE)。 */
function createHDRTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('BloomEnhancedPass: createTexture() returned null');
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
  return tex;
}

/** 创建 FBO 并绑定颜色纹理。 */
function createFBO(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('BloomEnhancedPass: createFramebuffer() returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return fbo;
}
