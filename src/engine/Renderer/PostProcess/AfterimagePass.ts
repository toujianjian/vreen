// AfterimagePass — 残影后处理 Pass。
//
// 把当前帧与上一帧按 damp 系数混合,产生运动残影。damp=0 无残影,
// damp 越接近 1 残影越持久(内部 clamp 到 0.95 避免完全锁定)。
//
// 与其他 pass 不同,本 pass 需要跨帧持有"上一帧"纹理,因此自行
// 创建并管理一对内部 FBO + 纹理(类似 three.js AfterimagePass 的
// _textureComp / _textureOld)。生命周期由 dispose() 释放。
//
// FBO 池(PassContext.resources)不适合做跨帧存储,因为 ping-pong
// 每帧重新绑定。本 pass 的内部纹理独立于 FBO 池,只用于残影累积。
//
// 参考:
//   - three.js examples/jsm/postprocessing/AfterimagePass.js
//   - examples/jsm/shaders/AfterimageShader.js

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, AFTERIMAGE_FRAG } from '../../Materials/shaders';

export interface AfterimageOptions {
  /** 残影衰减(0..1),值越大残影越强。 */
  damp?: number;
  enabled?: boolean;
}

/** 残影 Pass:跨帧累积,产生运动残影。 */
export class AfterimagePass extends RenderPass {
  readonly name = 'afterimage';
  enabled = false;

  /** 残影衰减(0..1)。 */
  damp = 0.85;

  /** 内部"上一帧"纹理 + FBO(跨帧持久化)。 */
  private _oldTexture: WebGLTexture | null = null;
  private _oldFbo: WebGLFramebuffer | null = null;
  /** 内部"合成结果"纹理 + FBO(每帧写入)。 */
  private _compTexture: WebGLTexture | null = null;
  private _compFbo: WebGLFramebuffer | null = null;
  /** 当前缓冲尺寸(检测 resize 后重建)。 */
  private _width = 0;
  private _height = 0;
  /** 是否已初始化(false 时下一帧 apply 会创建资源)。 */
  private _initialized = false;

  constructor(opts: AfterimageOptions = {}) {
    super();
    if (opts.damp !== undefined) this.damp = opts.damp;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    // 检查是否需要(重新)分配内部纹理
    if (!this._initialized || this._width !== res.width || this._height !== res.height) {
      this._initResources(gl, res.width, res.height);
    }

    // 第一帧还没有 old 内容时,把 old 当成全 0(黑)处理,等价于直接输出 cur
    const oldTex = this._oldTexture as WebGLTexture;

    // 把混合结果写入 _compFbo
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._compFbo as WebGLFramebuffer);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('afterimage', POST_VERT_SRC, AFTERIMAGE_FRAG);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, oldTex);
    prog.setUniformSampler('u_oldMap', 1);
    prog.setUniform1f('u_damp', this.damp);

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 把 compTexture 复制到 finalFbo,保持管线一致(下游 pass 读 finalTexture)
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const copyProg = ctx.getProgram(
      'afterimage-copy',
      POST_VERT_SRC,
      // 复用 AFTERIMAGE_FRAG 但 damp=0 即可做纯直通;这里直接重用 shader 节省一个 program
      AFTERIMAGE_FRAG,
    );
    copyProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._compTexture as WebGLTexture);
    copyProg.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._compTexture as WebGLTexture);
    copyProg.setUniformSampler('u_oldMap', 1);
    copyProg.setUniform1f('u_damp', 0.0); // damp=0 → 直接用 cur = compTexture
    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 交换:_oldTexture ← _compTexture(本帧结果作为下一帧的 old)
    const tmp = this._oldTexture;
    this._oldTexture = this._compTexture;
    this._compTexture = tmp;
    const tmpFbo = this._oldFbo;
    this._oldFbo = this._compFbo;
    this._compFbo = tmpFbo;

    return res.finalTexture;
  }

  /** 释放内部纹理与 FBO。可重复调用。 */
  dispose(ctx: PassContext): void {
    const gl = ctx.gl;
    if (this._oldTexture) {
      gl.deleteTexture(this._oldTexture);
      this._oldTexture = null;
    }
    if (this._compTexture) {
      gl.deleteTexture(this._compTexture);
      this._compTexture = null;
    }
    if (this._oldFbo) {
      gl.deleteFramebuffer(this._oldFbo);
      this._oldFbo = null;
    }
    if (this._compFbo) {
      gl.deleteFramebuffer(this._compFbo);
      this._compFbo = null;
    }
    this._initialized = false;
    this._width = 0;
    this._height = 0;
  }

  // ── private ─────────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    // 释放旧资源(可能在 resize)
    if (this._initialized) {
      if (this._oldTexture) gl.deleteTexture(this._oldTexture);
      if (this._compTexture) gl.deleteTexture(this._compTexture);
      if (this._oldFbo) gl.deleteFramebuffer(this._oldFbo);
      if (this._compFbo) gl.deleteFramebuffer(this._compFbo);
    }

    this._oldTexture = createHalfFloatTexture(gl, width, height);
    this._compTexture = createHalfFloatTexture(gl, width, height);
    this._oldFbo = createFbo(gl, this._oldTexture);
    this._compFbo = createFbo(gl, this._compTexture);

    // 把 oldTexture 清成黑(避免首帧读到垃圾数据)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._oldFbo);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this._width = width;
    this._height = height;
    this._initialized = true;
  }
}

/** 创建一张 RGBA16F 纹理(残影需要浮点精度避免多次混合后衰减失真)。 */
function createHalfFloatTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture() returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    width,
    height,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** 创建一个 FBO,把 texture 颜色附加上去。 */
function createFbo(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('createFramebuffer() returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  return fbo;
}
