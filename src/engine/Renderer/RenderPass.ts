// RenderPass — 后处理管线的可组合单元。
//
// 设计目标(对标 Phase 2.1.2):
//   - 把 WebGL2Renderer 里硬编码的 5 个后处理效果(bloom / chromatic
//     aberration / vignette / final-compose)拆成独立 pass 类,用数组
//     编排,便于后续加新效果(如 SSAO / FXAA / ToneMapping)。
//   - 每个 pass 只负责"读 input texture → 写 output FBO",FBO 池由
//     pipeline 管理(ping-pong),pass 不自己分配 FBO(除了 bloom 需要
//     专用双 blur FBO,通过 resources 复用)。
//   - pass.enabled 控制是否跳过;pipeline 按顺序调用 enabled 的 pass。
//
// 当前状态:
//   - 本模块提供抽象 + 4 个具体 pass + PostProcessingPipeline 编排器。
//   - WebGL2Renderer 的 _renderPostProcessingPass (legacy) 暂保留,因为
//     它与现有 FBO 池紧密耦合且无回归测试。新 pipeline 作为独立基础
//     设施,后续可替换 legacy(需先加视觉回归测试)。
//
// 不变量:
//   - pass.apply() 必须同步完成 GPU 命令提交。
//   - pass 不得跨帧持有 input/output 引用(ping-pong 每帧重新绑定)。
//   - pipeline.render() 第一个 pass 的 input 是 mainTexture,最后一个
//     pass 必须输出到 screen(framebuffer=null)。

import type { ShaderProgram } from './ShaderProgram';
import {
  POST_VERT as POST_VERT_SRC,
  BLOOM_EXTRACT_FRAG,
  BLOOM_BLUR_FRAG,
  FINAL_COMPOSE_FRAG,
  SSAO_POST_FRAG,
  FXAA_FRAG,
  TONE_MAPPING_FRAG,
  GAMMA_CORRECT_FRAG,
  DOF_FRAG,
} from '../Materials/shaders';

// 注意:增强版 ChromaticAberrationPass / VignettePass 已移至 ./PostProcess/。
// CHROMATIC_ABERRATION_FRAG / VIGNETTE_FRAG shader 字符串仍由 WebGL2Renderer
// 的 legacy 后处理路径直接使用(从 ../Materials/shaders 导入);同名 Pass
// 类的"增强版"由 PostProcess/ 目录提供,并通过 Renderer/index.ts 重新导出。

/** 色调映射模式。 */
export enum ToneMappingMode {
  /** 直通,不做色调映射。 */
  Linear = 0,
  /** Reinhard 全局色调映射。 */
  Reinhard = 1,
  /** ACES Filmic 曲线(默认推荐)。 */
  ACES = 2,
}

/** Pass 执行上下文:由 pipeline 提供给每个 pass。 */
export interface PassContext {
  readonly gl: WebGL2RenderingContext;
  /** 当前帧 backing 尺寸(px,已含 dpr)。 */
  readonly width: number;
  readonly height: number;
  /** Fullscreen quad VAO,pass 用它画全屏三角形。 */
  readonly fullscreenQuad: WebGLVertexArrayObject;
  /** 由 pipeline 管理的 FBO 池(ping-pong 双缓冲)。 */
  readonly resources: PostProcessingFBOs;
  /** 编译/复用 shader program(pipeline 委托给 renderer 的 cache)。 */
  getProgram(key: string, vert: string, frag: string, defines?: string[]): ShaderProgram;
  /**
   * 宿主渲染器(可选)。某些 Pass(如 LUTPass)需要通过渲染器上传
   * VREEN Texture 到 GPU 并获取 WebGLTexture 句柄。
   */
  readonly renderer?: unknown;
}

/** Pipeline 管理的 FBO 池:main(bloom 提取用) + bloom 双 blur + final(ping-pong)。
 *  与 WebGL2Renderer.PostProcessingResources 结构一致,便于后续替换。 */
export interface PostProcessingFBOs {
  mainFbo: WebGLFramebuffer;
  mainTexture: WebGLTexture;
  bloomFbo1: WebGLFramebuffer;
  bloomTexture1: WebGLTexture;
  bloomFbo2: WebGLFramebuffer;
  bloomTexture2: WebGLTexture;
  finalFbo: WebGLFramebuffer;
  finalTexture: WebGLTexture;
  width: number;
  height: number;
}

/** 后处理 pass 抽象基类。 */
export abstract class RenderPass {
  /** pass 名(调试/排序用)。 */
  abstract readonly name: string;
  /** 是否启用。pipeline 会跳过 enabled=false 的 pass。 */
  enabled: boolean = true;

  /** 执行 pass。
   *  @param input  上一个 pass 输出的纹理(第一个 pass 是 mainTexture)
   *  @param ctx    共享上下文(gl / FBO 池 / program cache)
   *  @returns      本 pass 输出的纹理(供下一个 pass 作 input) */
  abstract apply(input: WebGLTexture, ctx: PassContext): WebGLTexture;

  /** pass 需要释放自身资源时实现(通常 pass 不持有资源,空实现)。 */
  dispose(_ctx: PassContext): void { /* noop */ }
}

// ── 具体后处理 pass 实现 ────────────────────────────────────────────

/** Bloom 效果:extract bright → blur H → blur V。
 *  输入:input texture。输出:bloomTexture1(模糊后的亮部)。 */
export class BloomPass extends RenderPass {
  readonly name = 'bloom';
  enabled = false;

  threshold = 0.85;
  blurStrength = 2.0;

  constructor(opts: { threshold?: number; blurStrength?: number; enabled?: boolean } = {}) {
    super();
    if (opts.threshold !== undefined) this.threshold = opts.threshold;
    if (opts.blurStrength !== undefined) this.blurStrength = opts.blurStrength;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    // 1. extract bright pixels → bloomFbo1
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo1);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const extractProg = ctx.getProgram('bloom-extract', POST_VERT_SRC, BLOOM_EXTRACT_FRAG);
    extractProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    extractProg.setUniformSampler('u_colorMap', 0);
    extractProg.setUniform1f('u_bloomThreshold', this.threshold);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. blur horizontal → bloomFbo2
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo2);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const blurProg = ctx.getProgram('bloom-blur', POST_VERT_SRC, BLOOM_BLUR_FRAG);
    blurProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.bloomTexture1);
    blurProg.setUniformSampler('u_colorMap', 0);
    blurProg.setUniform2f('u_blurDir', 1.0, 0.0);
    blurProg.setUniform1f('u_blurStrength', this.blurStrength);
    blurProg.setUniform2f('u_screenSize', res.width, res.height);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3. blur vertical → bloomFbo1
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo1);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    blurProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.bloomTexture2);
    blurProg.setUniformSampler('u_colorMap', 0);
    blurProg.setUniform2f('u_blurDir', 0.0, 1.0);
    blurProg.setUniform1f('u_blurStrength', this.blurStrength);
    blurProg.setUniform2f('u_screenSize', res.width, res.height);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.bloomTexture1;
  }
}

// ChromaticAberrationPass 与 VignettePass 已移至 ./PostProcess/(增强版)。
// 本文件不再保留同名基础版,以避免与 Renderer/index.ts 的重导出冲突。

/** 最终合成:把 color + bloom 合到屏幕。
 *  输出:null(输出到 screen,framebuffer=null)。 */
export class FinalComposePass extends RenderPass {
  readonly name = 'final-compose';
  enabled = true;
  bloomIntensity = 0.6;
  bloomEnabled = false;

  constructor(opts: { bloomIntensity?: number; bloomEnabled?: boolean; enabled?: boolean } = {}) {
    super();
    if (opts.bloomIntensity !== undefined) this.bloomIntensity = opts.bloomIntensity;
    if (opts.bloomEnabled !== undefined) this.bloomEnabled = opts.bloomEnabled;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);

    const prog = ctx.getProgram('final-compose', POST_VERT_SRC, FINAL_COMPOSE_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomEnabled ? res.bloomTexture1 : res.mainTexture);
    prog.setUniformSampler('u_bloomMap', 1);
    prog.setUniform1f('u_bloomIntensity', this.bloomIntensity);
    prog.setUniform1i('u_bloomEnabled', this.bloomEnabled ? 1 : 0);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return input; // 已输出到 screen,返回值无意义
  }
}

// ── 扩展后处理 pass(参考 three.js 后处理效果) ───────────────────────

/** SSAO 简化版:基于邻域亮度对比度的近似遮蔽。
 *  输入:input texture。输出:finalTexture。
 *  注:真实 SSAO 需 G-buffer(depth+normal),见 SSAO_FRAG;此处仅
 *  作 pipeline 兼容的框架占位,效果为边缘暗化。 */
export class SSAOPass extends RenderPass {
  readonly name = 'ssao';
  enabled = false;
  /** 采样半径(texel 倍数)。 */
  radius = 1.5;
  /** 遮蔽强度(0..1+,越大越暗)。 */
  intensity = 0.6;

  constructor(opts: { radius?: number; intensity?: number; enabled?: boolean } = {}) {
    super();
    if (opts.radius !== undefined) this.radius = opts.radius;
    if (opts.intensity !== undefined) this.intensity = opts.intensity;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = ctx.getProgram('ssao-post', POST_VERT_SRC, SSAO_POST_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform2f('u_screenSize', res.width, res.height);
    prog.setUniform1f('u_ssaoRadius', this.radius);
    prog.setUniform1f('u_ssaoIntensity', this.intensity);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}

/** FXAA 抗锯齿:基于亮度梯度的单 pass 边缘检测。
 *  输入:input texture。输出:finalTexture。 */
export class FXAAPass extends RenderPass {
  readonly name = 'fxaa';
  enabled = false;

  constructor(opts: { enabled?: boolean } = {}) {
    super();
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = ctx.getProgram('fxaa', POST_VERT_SRC, FXAA_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform2f('u_screenSize', res.width, res.height);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}

/** 色调映射:支持 ACES Filmic / Reinhard / Linear。
 *  输入:input texture。输出:finalTexture。 */
export class ToneMappingPass extends RenderPass {
  readonly name = 'tone-mapping';
  enabled = true;
  /** 曝光系数(>0,1.0=不调整)。 */
  exposure = 1.0;
  /** 色调映射模式。 */
  mode: ToneMappingMode = ToneMappingMode.ACES;

  constructor(opts: { exposure?: number; mode?: ToneMappingMode; enabled?: boolean } = {}) {
    super();
    if (opts.exposure !== undefined) this.exposure = opts.exposure;
    if (opts.mode !== undefined) this.mode = opts.mode;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = ctx.getProgram('tone-mapping', POST_VERT_SRC, TONE_MAPPING_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform1f('u_exposure', this.exposure);
    prog.setUniform1i('u_mode', this.mode);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}

/** 伽马校正:线性 → sRGB。
 *  输入:input texture。输出:finalTexture。 */
export class GammaCorrectPass extends RenderPass {
  readonly name = 'gamma-correct';
  enabled = true;
  /** 伽马值(默认 2.2)。 */
  gamma = 2.2;

  constructor(opts: { gamma?: number; enabled?: boolean } = {}) {
    super();
    if (opts.gamma !== undefined) this.gamma = opts.gamma;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = ctx.getProgram('gamma-correct', POST_VERT_SRC, GAMMA_CORRECT_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform1f('u_gamma', this.gamma);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}

/** 景深(简化版):基于亮度近似深度的散景模糊。
 *  输入:input texture。输出:finalTexture。
 *  注:真实 DOF 需 depth buffer,此处仅作框架占位。 */
export class DOFPass extends RenderPass {
  readonly name = 'dof';
  enabled = false;
  /** 焦点距离(0..1,基于亮度代理)。 */
  focusDistance = 0.5;
  /** 焦点范围(范围内不模糊)。 */
  focusRange = 0.2;
  /** 散景圆半径(texel 倍数)。 */
  bokeh = 4.0;

  constructor(opts: { focusDistance?: number; focusRange?: number; bokeh?: number; enabled?: boolean } = {}) {
    super();
    if (opts.focusDistance !== undefined) this.focusDistance = opts.focusDistance;
    if (opts.focusRange !== undefined) this.focusRange = opts.focusRange;
    if (opts.bokeh !== undefined) this.bokeh = opts.bokeh;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = ctx.getProgram('dof', POST_VERT_SRC, DOF_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform2f('u_screenSize', res.width, res.height);
    prog.setUniform1f('u_focusDistance', this.focusDistance);
    prog.setUniform1f('u_focusRange', this.focusRange);
    prog.setUniform1f('u_bokeh', this.bokeh);
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}

// 后处理管线:管理 pass 列表,按顺序调用 enabled pass。
export class PostProcessingPipeline {
  private _passes: RenderPass[] = [];
  private _disposed = false;

  /** 添加 pass 到管线末尾。返回 this 便于链式。 */
  add(pass: RenderPass): this {
    this._passes.push(pass);
    return this;
  }

  /** 移除指定 pass。返回是否移除成功。 */
  remove(pass: RenderPass): boolean {
    const i = this._passes.indexOf(pass);
    if (i < 0) return false;
    this._passes.splice(i, 1);
    return true;
  }

  /** 按名字查 pass(找不到返回 undefined)。 */
  getByName(name: string): RenderPass | undefined {
    return this._passes.find((p) => p.name === name);
  }

  /** 当前 pass 列表(只读快照)。 */
  get passes(): readonly RenderPass[] {
    return this._passes;
  }

  /** 执行管线:把 input 依次喂给 enabled 的 pass。
   *  最后一个 enabled pass 通常是 FinalComposePass,输出到 screen。
   *  返回最后一个 pass 的输出纹理(若管线为空,返回 input)。 */
  render(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    let current = input;
    for (const pass of this._passes) {
      if (!pass.enabled) continue;
      current = pass.apply(current, ctx);
    }
    return current;
  }

  /** 释放所有 pass 资源。 */
  dispose(ctx: PassContext): void {
    if (this._disposed) return;
    for (const p of this._passes) p.dispose(ctx);
    this._passes = [];
    this._disposed = true;
  }

  get disposed(): boolean { return this._disposed; }
}
