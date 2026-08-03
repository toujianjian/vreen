// SharpenPass — Contrast Adaptive Sharpening (CAS) 后处理 Pass。
//
// 移植自 AMD FidelityFX CAS,适配为 GLSL ES 3.0 全屏片段着色器。
// 4 邻域 Laplacian 边缘增强 + 对比度自适应权重 + min/max 钳制防光晕。
//
// 管线位置:通常在 TAA / 抗锯齿之后、最终输出之前。
//   TAA 会引入轻微模糊(半分辨率历史复用 + 邻域裁剪),CAS 恢复细节。
//   o3de Atom 在 TAA 之后运行 SharpenPass,UE5 同样在 USM 之后运行 CAS。
//
// 输入:LDR/HDR 颜色纹理。输出:锐化后颜色纹理(finalTexture)。
// 当 sharpness = 0 时为直通(early-out),零开销。
//
// 参考:
//   - AMD FidelityFX CAS (Contrast Adaptive Sharpening)
//   - o3de Atom SharpenPass (Passes/SharpenPass)
//   - UE5 "Accommodate" sharpening stage

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, CAS_FRAG } from '../../Materials/shaders';

export interface SharpenPassOptions {
  /** 锐化强度 0..1(默认 0.5)。0 = 直通,1 = 最强。 */
  sharpness?: number;
  /** 是否启用(默认 false,需手动开启)。 */
  enabled?: boolean;
}

/**
 * Contrast Adaptive Sharpening Pass。extends RenderPass,可直接加入
 * PostProcessingPipeline。
 *
 * 在低对比度区域(平坦细节)施加强锐化,在高对比度边缘处减弱锐化,
 * 并将结果钳制到邻域 min/max 范围内,从根本上消除传统 unsharp mask
 * 的光晕(halo)伪影。这是 AMD FidelityFX CAS 的核心思想。
 *
 * 典型管线顺序:`... → TAAPass → SharpenPass → TonemappingPass → 输出`
 */
export class SharpenPass extends RenderPass {
  readonly name = 'sharpen';
  enabled = false;

  /** 锐化强度 0..1。0 = 直通,1 = 最强(默认 0.5)。 */
  sharpness = 0.5;

  constructor(opts: SharpenPassOptions = {}) {
    super();
    if (opts.sharpness !== undefined) this.sharpness = opts.sharpness;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('sharpen', POST_VERT_SRC, CAS_FRAG);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform2f('u_screenSize', res.width, res.height);
    prog.setUniform1f('u_sharpness', this.sharpness);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}
