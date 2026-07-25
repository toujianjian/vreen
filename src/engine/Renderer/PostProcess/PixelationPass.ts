// PixelationPass — 像素化后处理 Pass。
//
// 把屏幕按 pixelSize 分块,每块取中心单点颜色,产生马赛克像素化效果。
// pixelSize=1 等价于无效果,pixelSize 越大越像马赛克。
//
// 输入:input texture。输出:finalTexture。
//
// 参考:
//   - three.js PixelShader(在 examples/jsm/shaders/PixelShader.js)
//   - 复古/MV 风格常用,小尺寸像素化可作为性能优化手段

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, PIXELATION_FRAG } from '../../Materials/shaders';

export interface PixelationOptions {
  /** 像素块大小(texel 倍数,>=1)。 */
  pixelSize?: number;
  enabled?: boolean;
}

/** 像素化 Pass:把画面分块降采样,产生马赛克。 */
export class PixelationPass extends RenderPass {
  readonly name = 'pixelation';
  enabled = false;

  /** 像素块大小(texel 倍数,>=1)。 */
  pixelSize = 8.0;

  constructor(opts: PixelationOptions = {}) {
    super();
    if (opts.pixelSize !== undefined) this.pixelSize = opts.pixelSize;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('pixelation', POST_VERT_SRC, PIXELATION_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform1f('u_pixelSize', this.pixelSize);
    prog.setUniform2f('u_screenSize', res.width, res.height);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}
