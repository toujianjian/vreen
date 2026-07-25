// ChromaticAberrationPass — 增强版色差后处理 Pass。
//
// 相比 RenderPass.ts 中的基础 ChromaticAberrationPass(仅支持 float offset),
// 此增强版支持:
//   - Vector2 offset:R/B 可在不同方向偏移(对角线色差)
//   - radialMod:按到中心距离放大偏移(边缘更强,模拟镜头物理)
//   - center:径向中心(默认屏幕中心 0.5, 0.5)
//
// 输入:input texture。输出:finalTexture。
//
// 参考:
//   - three.js RGBShiftShader / AfterimageShader
//   - 镜头色差的物理特性:边缘强、中心弱

import { Vector2 } from '../../Math/Vector2';
import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, CA_ENHANCED_FRAG } from '../../Materials/shaders';

export interface ChromaticAberrationEnhancedOptions {
  /** 色差偏移(texel 倍数),每通道 0..0.1 量级。 */
  offset?: Vector2;
  /** 是否按到 center 的距离放大偏移。 */
  radialMod?: boolean;
  /** 径向中心(默认 0.5, 0.5)。 */
  center?: Vector2;
  enabled?: boolean;
}

/** 增强色差 Pass:支持 Vector2 偏移 + 径向调制 + 径向中心。
 *  与 RenderPass.ts 中的基础 ChromaticAberrationPass 互补:基础版仅一个 float
 *  offset,本版给 R/B 通道不同方向的偏移并支持径向放大。 */
export class ChromaticAberrationPass extends RenderPass {
  readonly name = 'chromatic-aberration';
  enabled = false;

  /** 色差偏移(每轴 texel 倍数,典型 0.001~0.01)。 */
  offset: Vector2;
  /** 是否按到 center 的距离放大偏移(边缘色差更强)。 */
  radialMod: boolean;
  /** 径向中心(默认屏幕中心)。 */
  center: Vector2;

  constructor(opts: ChromaticAberrationEnhancedOptions = {}) {
    super();
    this.offset = opts.offset ?? new Vector2(0.001, 0.001);
    this.radialMod = opts.radialMod ?? true;
    this.center = opts.center ?? new Vector2(0.5, 0.5);
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('chromatic-aberration-enhanced', POST_VERT_SRC, CA_ENHANCED_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform2f('u_offset', this.offset.x, this.offset.y);
    prog.setUniform1i('u_radialMod', this.radialMod ? 1 : 0);
    prog.setUniform2f('u_center', this.center.x, this.center.y);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}
