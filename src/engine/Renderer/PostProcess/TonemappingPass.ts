// TonemappingPass — HDR → LDR 色调映射后处理 Pass。
//
// 支持 5 种算子:
//   - Linear   : 仅裁剪(直通,无色调映射)
//   - ACES     : ACES Filmic(Narkowicz 近似)— 行业标准,UE5/o3de 默认
//   - Reinhard : 经典 Reinhard(简单,高光柔和)
//   - AGX      : Blender AGX 简化版(更自然的中间调,不饱和)
//   - Uncharted2: Hable 2010(Uncharted 2 游戏级,高对比)
//
// 管线位置:必须在所有 HDR 效果(Bloom/SSR/SSGI)之后、最终显示之前。
// 输入:HDR 颜色纹理(RGBA16F)。输出:LDR 颜色纹理(RGBA8,finalTexture)。
//
// 参考:
//   - Narkowicz 2015 "ACES Filmic Tone Mapping Curve"
//   - Reinhard et al. 2002 "Photographic Tone Reproduction"
//   - Blender AGX (Troy Sobotka)
//   - Hable 2010 "Uncharted 2: HDR Lighting"

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, TONEMAP_FRAG } from '../../Materials/shaders';

/** 色调映射算子类型。 */
export type TonemappingMode = 'linear' | 'aces' | 'reinhard' | 'agx' | 'uncharted2';

const MODE_MAP: Record<TonemappingMode, number> = {
  linear: 0,
  aces: 1,
  reinhard: 2,
  agx: 3,
  uncharted2: 4,
};

export interface TonemappingPassOptions {
  /** 色调映射算子(默认 'aces')。 */
  mode?: TonemappingMode;
  /** 曝光倍数(默认 1.0)。>1 提亮,<1 压暗。 */
  exposure?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * HDR → LDR 色调映射 Pass。extends RenderPass,可直接加入 PostProcessingPipeline。
 *
 * 必须在所有 HDR 效果(Bloom/SSR/SSGI)之后、最终显示之前应用。
 * 默认使用 ACES Filmic(Narkowicz 近似)— UE5 / o3de Atom 行业标准。
 */
export class TonemappingPass extends RenderPass {
  readonly name = 'tonemapping';
  enabled = true;

  /** 色调映射算子。 */
  mode: TonemappingMode = 'aces';
  /** 曝光倍数(>1 提亮,<1 压暗)。 */
  exposure = 1.0;

  constructor(opts: TonemappingPassOptions = {}) {
    super();
    if (opts.mode !== undefined) this.mode = opts.mode;
    if (opts.exposure !== undefined) this.exposure = opts.exposure;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('tonemapping', POST_VERT_SRC, TONEMAP_FRAG);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    prog.setUniform1f('u_exposure', this.exposure);
    prog.setUniform1i('u_mode', MODE_MAP[this.mode] ?? 1);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}
