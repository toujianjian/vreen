// GlitchPass — 数字故障后处理 Pass (赛博朋克风格)。
//
// 适配自 three.js examples/jsm/postprocessing/GlitchPass.js + DigitalGlitch shader。
//
// 效果:
//   - 随机触发的数字方块位移(水平/垂直条带扭曲)
//   - RGB 色彩分离(chromatic aberration / RGB shift)
//   - 雪花噪声(snow noise)
//   - 位移纹理驱动的数字方块故障
//
// 触发机制:
//   - 每 _randX 帧(120-240 随机)触发一次强故障爆发
//   - 爆发后 1/5 帧数为弱故障衰减
//   - 其余帧旁路(byp=1)直通
//   - goWild=true 时持续强故障(适合赛博朋克过场)
//
// 用法:
//   const glitch = new GlitchPass();
//   glitch.goWild = true;  // 持续故障模式
//   pipeline.add(glitch);
//
// 参考:
//   - three.js GlitchPass.js / DigitalGlitch.js
//   - staffantans unityglitch: https://github.com/staffantan/unityglitch

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, GLITCH_FRAG } from '../../Materials/shaders';
import { DataTexture } from '../../Core/DataTexture';

export interface GlitchPassOptions {
  /** 位移噪声纹理尺寸(默认 64)。 */
  dispSize?: number;
  /** 持续强故障模式(默认 false)。 */
  goWild?: boolean;
  enabled?: boolean;
}

/**
 * 数字故障后处理 Pass — 随机触发的赛博朋克数字故障效果。
 *
 * 包含水平/垂直条带扭曲、RGB 色彩分离、雪花噪声。
 * 默认随机触发;设置 `goWild = true` 进入持续故障模式。
 */
export class GlitchPass extends RenderPass {
  readonly name = 'glitch';
  enabled = false;

  /** 持续强故障模式(适合赛博朋克过场动画)。 */
  goWild = false;

  /** 位移噪声纹理(用于数字方块故障)。 */
  private _dispTexture: DataTexture;
  /** 当前帧计数器。 */
  private _curF = 0;
  /** 下次触发帧间隔(120-240 随机)。 */
  private _randX = 0;

  // 当前帧 uniform 值
  private _amount = 0.08;
  private _angle = 0.02;
  private _seed = 0.02;
  private _seedX = 0.02;
  private _seedY = 0.02;
  private _distortionX = 0.5;
  private _distortionY = 0.6;
  private _byp = 1;

  constructor(opts: GlitchPassOptions = {}) {
    super();
    if (opts.goWild !== undefined) this.goWild = opts.goWild;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    this._dispTexture = this._generateHeightmap(opts.dispSize ?? 64);
    this._generateTrigger();
  }

  apply(_input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    // 更新故障参数(随机触发逻辑)
    this._updateGlitchState();

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('glitch', POST_VERT_SRC, GLITCH_FRAG);
    prog.use();

    // 输入纹理
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _input);
    prog.setUniformSampler('u_colorMap', 0);

    // 位移噪声纹理
    const dispTex = this._resolveDispTexture(ctx);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dispTex);
    prog.setUniformSampler('u_dispMap', 1);

    // uniforms
    prog.setUniform1i('u_byp', this._byp);
    prog.setUniform1f('u_amount', this._amount);
    prog.setUniform1f('u_angle', this._angle);
    prog.setUniform1f('u_seed', this._seed);
    prog.setUniform1f('u_seedX', this._seedX);
    prog.setUniform1f('u_seedY', this._seedY);
    prog.setUniform1f('u_distortionX', this._distortionX);
    prog.setUniform1f('u_distortionY', this._distortionY);
    prog.setUniform1f('u_colS', 0.05);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }

  /** 释放位移纹理资源。 */
  dispose(): void {
    this._dispTexture.data = null;
  }

  // ── 内部方法 ──────────────────────────────────────────────

  private _updateGlitchState(): void {
    this._seed = Math.random();

    if (this._curF % this._randX === 0 || this.goWild) {
      // 强故障爆发
      this._amount = Math.random() / 30;
      this._angle = this._randFloat(-Math.PI, Math.PI);
      this._seedX = this._randFloat(-1, 1);
      this._seedY = this._randFloat(-1, 1);
      this._distortionX = Math.random();
      this._distortionY = Math.random();
      this._byp = 0;
      this._curF = 0;
      this._generateTrigger();
    } else if (this._curF % this._randX < this._randX / 5) {
      // 衰减阶段(弱故障)
      this._amount = Math.random() / 90;
      this._angle = this._randFloat(-Math.PI, Math.PI);
      this._distortionX = Math.random();
      this._distortionY = Math.random();
      this._seedX = this._randFloat(-0.3, 0.3);
      this._seedY = this._randFloat(-0.3, 0.3);
      this._byp = 0;
    } else if (!this.goWild) {
      // 旁路
      this._byp = 1;
    }

    this._curF++;
  }

  private _generateTrigger(): void {
    this._randX = Math.floor(this._randFloat(120, 240));
  }

  private _randFloat(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private _generateHeightmap(size: number): DataTexture {
    const data = new Float32Array(size * size);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random();
    }
    const tex = new DataTexture(data, size, size, {
      format: 'r',
      type: 'float',
      minFilter: 'nearest',
      magFilter: 'nearest',
      wrapS: 'repeat',
      wrapT: 'repeat',
    });
    tex.name = 'glitch-disp';
    return tex;
  }

  /** 通过 renderer 上传位移纹理并获取 GL 句柄(退化:用 glTexture)。 */
  private _resolveDispTexture(ctx: PassContext): WebGLTexture | null {
    const renderer = ctx.renderer as unknown as {
      getGLTexture?: (t: import('../../Core/Texture').Texture) => WebGLTexture | null;
    } | undefined;
    if (renderer?.getGLTexture) {
      return renderer.getGLTexture(this._dispTexture);
    }
    return this._dispTexture.glTexture;
  }
}
