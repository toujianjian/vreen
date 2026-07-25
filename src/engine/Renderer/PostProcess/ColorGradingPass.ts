// ColorGradingPass — 色彩分级后处理 Pass。
//
// 一站式 color grading,把 8 个色彩控制参数合并到单 pass shader:
//   - temperature / tint        : 色温/色调(白平衡)
//   - saturation / contrast     : 饱和度/对比度
//   - gain / lift / gamma       : ASC-CDL 风格的亮部/暗部/中调
//   - hueShift                  : 色相偏移(0..360)
//
// 所有参数都用公开字段,可在运行时直接修改或由动画系统驱动。
// 输入:input texture。输出:finalTexture(ping-pong 缓冲之一)。
//
// 参考:
//   - three.js ColorCorrectionShader / AfterimageShader
//   - DaVinci Resolve 的 Lift/Gamma/Gain 控件
//   - ASC-CDL(美国电影摄影师协会色彩决策表)

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, COLOR_GRADING_FRAG } from '../../Materials/shaders';

export interface ColorGradingOptions {
  temperature?: number;
  tint?: number;
  saturation?: number;
  contrast?: number;
  gain?: number;
  lift?: number;
  gamma?: number;
  hueShift?: number;
  enabled?: boolean;
}

/** 色彩分级 Pass:把 8 个色彩参数合到单 pass。
 *  默认参数全部为"不调整"状态(temperature=0, saturation=1, gamma=1, hueShift=0...)。 */
export class ColorGradingPass extends RenderPass {
  readonly name = 'color-grading';
  enabled = false;

  /** 色温(-1..1),负=冷蓝,正=暖橙。 */
  temperature = 0.0;
  /** 色调(-1..1),负=绿,正=洋红。 */
  tint = 0.0;
  /** 饱和度(0..2),1=原色。 */
  saturation = 1.0;
  /** 对比度(0..2),1=原色。 */
  contrast = 1.0;
  /** 增益/高光(0..2),1=原色。 */
  gain = 1.0;
  /** 提升/阴影(-1..1),0=不调整。 */
  lift = 0.0;
  /** 伽马(0.1..4),1=不调整。 */
  gamma = 1.0;
  /** 色相偏移(0..360 度)。 */
  hueShift = 0.0;

  constructor(opts: ColorGradingOptions = {}) {
    super();
    if (opts.temperature !== undefined) this.temperature = opts.temperature;
    if (opts.tint !== undefined) this.tint = opts.tint;
    if (opts.saturation !== undefined) this.saturation = opts.saturation;
    if (opts.contrast !== undefined) this.contrast = opts.contrast;
    if (opts.gain !== undefined) this.gain = opts.gain;
    if (opts.lift !== undefined) this.lift = opts.lift;
    if (opts.gamma !== undefined) this.gamma = opts.gamma;
    if (opts.hueShift !== undefined) this.hueShift = opts.hueShift;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('color-grading', POST_VERT_SRC, COLOR_GRADING_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform1f('u_temperature', this.temperature);
    prog.setUniform1f('u_tint', this.tint);
    prog.setUniform1f('u_saturation', this.saturation);
    prog.setUniform1f('u_contrast', this.contrast);
    prog.setUniform1f('u_gain', this.gain);
    prog.setUniform1f('u_lift', this.lift);
    prog.setUniform1f('u_gamma', this.gamma);
    prog.setUniform1f('u_hueShift', this.hueShift);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}
