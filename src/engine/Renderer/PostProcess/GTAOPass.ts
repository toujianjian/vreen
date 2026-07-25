// GTAOPass — Ground Truth Ambient Occlusion 后处理 Pass。
//
// 设计目标:
//   - 基于深度 + 世界法线纹理,通过半球积分计算环境光遮蔽;
//   - 比 SSAO 更精确:沿 4 个方向找地平线角(horizon angle),积分得到 AO;
//   - 不依赖 RenderPass 抽象(独立管理内部 FBO + 程序,与 SSRPass 同构)。
//
// 流程:
//   1. apply() 首次调用时按 canvas 尺寸分配内部 FBO + RGBA8 颜色纹理
//      + 编译 GTAO 程序;
//   2. 绑定 FBO + 全屏视口 → 画全屏四边形,fragment shader 读 depth + normal
//      重建视图空间位置/法线 → 4 方向地平线积分 → 输出 AO (R=G=B=ao);
//   3. 输出纹理可被下游 pass 采样(典型用法:与场景颜色相乘)。
//
// 不变量:
//   - dispose 后再调用 apply 自动重建;
//   - 内部纹理为 RGBA8(AO 0..1,无需浮点);
//   - 调用方需保证 depthTexture 为 NDC 深度(0..1),normalTexture 为世界空间法线。
//
// 参考:
//   - Jorge Jimenez et al., "Practical Real-Time Strategies for Accurate Indirect Occlusion"
//   - fourier.eng.hmc.edu (horizon-based AO 积分)

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, GTAO_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('GTAOPass');

export interface GTAOPassOptions {
  /** 采样半径(屏幕空间像素缩放,默认 0.5)。 */
  radius?: number;
  /** 厚度容差(世界单位,默认 0.2)。大于此距离的几何不算遮蔽。 */
  thickness?: number;
  /** 强度指数(默认 1.5,>1 更锐利,<1 更柔)。 */
  power?: number;
  /** 每方向最大采样像素(1..32,默认 32)。 */
  maxPixels?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * GTAO Pass。独立管理内部 FBO 与程序。
 *
 * apply() 把 depth + normal 两张纹理 + 相机变换喂给 GTAO fragment shader,
 * 输出 AO 纹理(灰度,0=全遮蔽,1=无遮蔽)。调用方拿到纹理后自行决定如何
 * 合成(典型做法:sceneColor *= ao)。
 */
export class GTAOPass {
  readonly name = 'gtao';

  /** 采样半径(屏幕空间像素缩放)。 */
  radius: number = 0.5;
  /** 厚度容差(世界单位)。 */
  thickness: number = 0.2;
  /** 强度指数。 */
  power: number = 1.5;
  /** 每方向最大采样像素(1..32)。 */
  maxPixels: number = 32;
  /** 是否启用(apply 时若 false 直接返回上一帧输出,跳过渲染)。 */
  enabled: boolean = true;

  /** 当前输出纹理(apply 后可用)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: GTAOPassOptions = {}) {
    if (opts.radius !== undefined) this.radius = opts.radius;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.power !== undefined) this.power = opts.power;
    if (opts.maxPixels !== undefined) this.maxPixels = opts.maxPixels;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  /**
   * 执行 GTAO。
   *
   * @param gl             WebGL2 上下文
   * @param depthTexture   NDC 深度纹理(0..1)
   * @param normalTexture  世界空间法线纹理(RGBA16F,xyz)
   * @param camera         当前相机(读取 projectionMatrixInverse / matrixWorldInverse)
   * @returns              AO 输出纹理(本 Pass 持有,不要释放)
   */
  apply(
    gl: WebGL2RenderingContext,
    depthTexture: WebGLTexture,
    normalTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
    const targetW = gl.canvas.width;
    const targetH = gl.canvas.height;
    if (!this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
    }

    // disabled 时仍返回输出纹理(避免下游 null 解引用),但不渲染
    if (!this.enabled) {
      return this._outputTexture as WebGLTexture;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);  // AO 默认 1(无遮蔽)
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, normalTexture);
    prog.setUniformSampler('u_normalMap', 1);

    prog.setUniformMatrix4fv('u_projectionInverse', camera.projectionMatrixInverse.elements);
    prog.setUniformMatrix4fv('u_viewMatrix', camera.matrixWorldInverse.elements);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_radius', this.radius);
    prog.setUniform1f('u_thickness', this.thickness);
    prog.setUniform1f('u_power', this.power);
    prog.setUniform1i('u_maxPixels', Math.max(1, Math.min(32, Math.floor(this.maxPixels))));

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 设置采样半径(>0)。 */
  setRadius(r: number): void {
    this.radius = Math.max(0, r);
  }

  /** 释放内部 FBO / 纹理 / VAO / program。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._outputTexture) {
      gl.deleteTexture(this._outputTexture);
      this._outputTexture = null;
    }
    if (this._fbo) {
      gl.deleteFramebuffer(this._fbo);
      this._fbo = null;
    }
    if (this._fullscreenQuadVao) {
      gl.deleteVertexArray(this._fullscreenQuadVao);
      this._fullscreenQuadVao = null;
    }
    if (this._fullscreenQuadBuf) {
      gl.deleteBuffer(this._fullscreenQuadBuf);
      this._fullscreenQuadBuf = null;
    }
    if (this._program) {
      this._program.dispose();
      this._program = null;
    }
    this._initialized = false;
    this._width = 0;
    this._height = 0;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, GTAO_FRAG);
    log.info('GTAO program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RGBA8 输出纹理(AO 0..1,无需浮点)
    const tex = gl.createTexture();
    if (!tex) throw new Error('GTAOPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8,
      width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('GTAOPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO(position@0 + uv@2)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('GTAOPass: createVertexArray/Buffer() returned null');
    const verts = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      1, 1, 1, 1,
      -1, -1, 0, 0,
      1, 1, 1, 1,
      -1, 1, 0, 1,
    ]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._outputTexture = tex;
    this._fbo = fbo;
    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`GTAO FBO created: ${width}x${height}`);
  }
}
