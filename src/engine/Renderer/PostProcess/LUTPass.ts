// LUTPass — 颜色查找表 (Look-Up Table) 后处理 Pass。
//
// 支持两种 LUT 格式:
//   - 3D LUT:WebGL2 sampler3D,通过 TEXTURE_3D 上传(推荐,精度高)
//   - 2D strip LUT:横向排布的 2D 纹理,每片 lutSize×lutSize,共 lutSize 片
//
// 纹理来源(二选一):
//   1. 直接传入 WebGLTexture(已上传,低级用法)
//   2. 传入 VREEN Texture(Data3DTexture 或 2D Texture),PassContext.renderer
//      自动上传并获取 GL 句柄(推荐,与 LUTCubeLoader.toData3DTexture() 配套)
//
// intensity = 0 时无效果,1 时完全使用 LUT 颜色。
//
// 参考:
//   - three.js examples/jsm/postprocessing/LUTPass.js
//   - examples/jsm/shaders/LUTShader.js(使用 sampler3D)
//
// 注意:WebGL2 才支持 sampler3D,WebGL1 不支持。本引擎使用 WebGL2,
// 所以 3D LUT 路径始终可用。

import { RenderPass, type PassContext } from '../RenderPass';
import {
  POST_VERT as POST_VERT_SRC,
  LUT_3D_FRAG,
  LUT_2D_STRIP_FRAG,
} from '../../Materials/shaders';
import type { Texture } from '../../Core/Texture';

export interface LUTPassOptions {
  /**
   * LUT 纹理。可为:
   *   - WebGLTexture(已上传的低级句柄)
   *   - VREEN Texture(Data3DTexture for 3D, Texture for 2D strip)
   *   - null(无 LUT,直通)
   */
  lut?: WebGLTexture | Texture | null;
  /** LUT 每轴格点数(典型 16 或 32)。 */
  lutSize?: number;
  /** true=sampler3D,false=sampler2D strip。默认 true。 */
  is3D?: boolean;
  /** 混合强度(0..1)。 */
  intensity?: number;
  enabled?: boolean;
}

/** LUT 色彩查找表 Pass。 */
export class LUTPass extends RenderPass {
  readonly name = 'lut';
  enabled = false;

  /**
   * LUT 纹理。可为 WebGLTexture 或 VREEN Texture。
   * 若为 Texture,apply() 时通过 ctx.renderer.getGLTexture() 上传并获取句柄。
   */
  lut: WebGLTexture | Texture | null = null;
  /** 每轴格点数。 */
  lutSize = 16;
  /** 是否使用 3D 纹理(true)或 2D strip 纹理(false)。 */
  is3D = true;
  /** 混合强度(0..1)。 */
  intensity = 1.0;

  constructor(opts: LUTPassOptions = {}) {
    super();
    if (opts.lut !== undefined) this.lut = opts.lut;
    if (opts.lutSize !== undefined) this.lutSize = opts.lutSize;
    if (opts.is3D !== undefined) this.is3D = opts.is3D;
    if (opts.intensity !== undefined) this.intensity = opts.intensity;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  /** 解析 lut 字段为 WebGLTexture 句柄。 */
  private _resolveLut(ctx: PassContext): WebGLTexture | null {
    if (this.lut === null) return null;
    // 已是 WebGLTexture
    if (typeof this.lut === 'object' && 'uuid' in this.lut && 'glTexture' in this.lut) {
      // VREEN Texture — 通过 renderer 上传
      const renderer = ctx.renderer as unknown as {
        getGLTexture?: (t: Texture) => WebGLTexture | null;
      };
      if (renderer.getGLTexture) {
        return renderer.getGLTexture(this.lut as Texture);
      }
      // 退化:直接读 glTexture(可能尚未上传)
      return (this.lut as Texture).glTexture;
    }
    return this.lut as WebGLTexture;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const lutTex = this._resolveLut(ctx);
    if (lutTex === null) {
      // 无 LUT 时直通输入,避免阻塞管线
      return input;
    }

    if (this.is3D) {
      const prog = ctx.getProgram('lut-3d', POST_VERT_SRC, LUT_3D_FRAG);
      prog.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      prog.setUniformSampler('u_colorMap', 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      prog.setUniformSampler('u_lut3D', 1);
      prog.setUniform1f('u_lutSize', this.lutSize);
      prog.setUniform1f('u_intensity', this.intensity);
      gl.bindVertexArray(ctx.fullscreenQuad);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      const prog = ctx.getProgram('lut-2d-strip', POST_VERT_SRC, LUT_2D_STRIP_FRAG);
      prog.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      prog.setUniformSampler('u_colorMap', 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      prog.setUniformSampler('u_lut2D', 1);
      prog.setUniform1f('u_lutSize', this.lutSize);
      prog.setUniform1f('u_intensity', this.intensity);
      gl.bindVertexArray(ctx.fullscreenQuad);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    return res.finalTexture;
  }
}
