// VignettePass — 增强版暗角后处理 Pass。
//
// 相比 RenderPass.ts 中的基础 VignettePass(仅 darkness + offset),
// 此增强版增加:
//   - color: Color 类型,可染色暗角区域(默认黑色,常见于电影质感配色)
//
// 输入:input texture。输出:finalTexture。
//
// 参考:
//   - three.js VignetteShader / FilmShader
//   - 电影后期中常见的有色暗角(例如暖色调暗角增加怀旧感)

import { Color } from '../../Math/Color';
import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, VIGNETTE_ENHANCED_FRAG } from '../../Materials/shaders';

export interface VignetteEnhancedOptions {
  /** 暗角起始偏移(0..2)。 */
  offset?: number;
  /** 暗角强度(0..2)。 */
  darkness?: number;
  /** 暗角颜色(默认黑色)。 */
  color?: Color;
  enabled?: boolean;
}

/** 增强暗角 Pass:支持 offset/darkness + 颜色染色。 */
export class VignettePass extends RenderPass {
  readonly name = 'vignette';
  enabled = false;

  /** 暗角起始偏移(0..2)。 */
  offset = 0.0;
  /** 暗角强度(0..2)。 */
  darkness = 0.45;
  /** 暗角颜色(默认黑色)。 */
  color: Color;

  constructor(opts: VignetteEnhancedOptions = {}) {
    super();
    this.color = opts.color ?? new Color(0, 0, 0);
    if (opts.offset !== undefined) this.offset = opts.offset;
    if (opts.darkness !== undefined) this.darkness = opts.darkness;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('vignette-enhanced', POST_VERT_SRC, VIGNETTE_ENHANCED_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform1f('u_offset', this.offset);
    prog.setUniform1f('u_darkness', this.darkness);
    prog.setUniform3f('u_color', this.color.r, this.color.g, this.color.b);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}
