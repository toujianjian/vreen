// FilmGrainPass — 胶片颗粒后处理 Pass。
//
// 基于哈希噪声在画面上叠加颗粒,模拟胶片质感。可动画(每帧用 time 种子
// 改变噪声图案)。颗粒大小、强度、动画开关均可配置。
//
// 输入:input texture。输出:finalTexture。
//
// 参考:
//   - three.js FilmShader(同时做 scanline + noise)
//   - 颗粒在亮度低处更明显(模拟胶片颗粒的视觉特性)

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, FILM_GRAIN_FRAG } from '../../Materials/shaders';

export interface FilmGrainOptions {
  /** 颗粒强度(0..1)。 */
  intensity?: number;
  /** 颗粒大小(texel 倍数,典型 1..4)。 */
  size?: number;
  /** 是否每帧动画。 */
  animated?: boolean;
  enabled?: boolean;
}

/** 胶片颗粒 Pass。 */
export class FilmGrainPass extends RenderPass {
  readonly name = 'film-grain';
  enabled = false;

  /** 颗粒强度(0..1)。 */
  intensity = 0.25;
  /** 颗粒大小(texel 倍数,1=单像素颗粒)。 */
  size = 1.5;
  /** 是否动画。 */
  animated = true;
  /** 当前时间种子(秒)。由外部每帧更新,animated=true 时生效。 */
  time = 0.0;

  constructor(opts: FilmGrainOptions = {}) {
    super();
    if (opts.intensity !== undefined) this.intensity = opts.intensity;
    if (opts.size !== undefined) this.size = opts.size;
    if (opts.animated !== undefined) this.animated = opts.animated;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('film-grain', POST_VERT_SRC, FILM_GRAIN_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform1f('u_intensity', this.intensity);
    prog.setUniform1f('u_size', this.size);
    prog.setUniform1i('u_animated', this.animated ? 1 : 0);
    prog.setUniform1f('u_time', this.time);
    prog.setUniform2f('u_screenSize', res.width, res.height);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}
