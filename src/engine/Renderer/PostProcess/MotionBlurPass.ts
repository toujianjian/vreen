// MotionBlurPass — 运动模糊后处理 Pass。
//
// 设计目标:
//   - 基于 VelocityPass 输出的速度缓冲,沿像素速度方向多次采样并平均,
//     产生方向性运动模糊(适合快速运动相机 / 移动物体);
//   - 采样数随速度自适应(clamp 到 maxSamples),低速度像素直接输出避免浪费;
//   - 独立管理内部 FBO + 程序(与 SSRPass / VolumetricFogPass 同构)。
//
// 流程:
//   1. apply() 首次调用时按 canvas 尺寸分配内部 FBO + RGBA16F 颜色纹理
//      + 编译 MOTION_BLUR 程序;
//   2. 绑定 FBO + 全屏视口 → 画全屏四边形,fragment shader 读 color + velocity
//      沿速度向量采样 N 次,平均后输出;
//   3. 输出纹理交由下游 pass 处理。
//
// 不变量:
//   - dispose 后再调用 apply 自动重建;
//   - 内部纹理为 RGBA16F,因为模糊过程中可能产生 > 1 的 HDR 像素;
//   - 输出纹理所有权归 Pass,调用方不得释放;
//   - 调用方需保证 velocityTexture 与 inputTexture 尺寸一致(本 Pass 不验证)。
//
// 参考:
//   - GPU Pro 3 "Real-Time Camera Motion Blur"
//   - three.js examples/jsm/postprocessing/MotionBlurPass(本实现为简化版)

import { POST_VERT as POST_VERT_SRC, MOTION_BLUR_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('MotionBlurPass');

export interface MotionBlurPassOptions {
  /** 模糊强度(0..1+,默认 1.0)。值越大模糊越明显。 */
  strength?: number;
  /** 最大采样数(1..64,默认 16)。 */
  maxSamples?: number;
}

/**
 * 运动模糊 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * apply() 把 input 颜色 + velocity 纹理喂给 MOTION_BLUR fragment shader,
 * 沿像素速度方向多次采样并平均,输出模糊后的颜色纹理。
 */
export class MotionBlurPass {
  readonly name = 'motion-blur';

  /** 模糊强度(0..1+,默认 1.0)。 */
  strength: number = 1.0;
  /** 最大采样数(1..64,默认 16)。 */
  maxSamples: number = 16;

  /** 当前速度缓冲(由外部 VelocityPass 生成;null 时表示尚未设置)。 */
  velocityTexture: WebGLTexture | null = null;

  /** 当前输出纹理。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: MotionBlurPassOptions = {}) {
    if (opts.strength !== undefined) this.strength = opts.strength;
    if (opts.maxSamples !== undefined) this.maxSamples = opts.maxSamples;
  }

  /**
   * 设置模糊强度。
   * @param s  强度(0..1+);负值会被 clamp 到 0。
   */
  setStrength(s: number): void {
    this.strength = Math.max(0, s);
  }

  /**
   * 设置最大采样数。
   * @param n  采样数(1..64);超范围会被 clamp。
   */
  setMaxSamples(n: number): void {
    this.maxSamples = Math.max(1, Math.min(64, Math.floor(n)));
  }

  /**
   * 执行运动模糊。
   *
   * @param gl              WebGL2 上下文
   * @param inputTexture    当前帧颜色
   * @param velocityTexture 速度缓冲(RG = NDC 速度,已乘 0.5);
   *                         若 null 则使用本 Pass 内部缓存的 velocityTexture
   * @returns               模糊输出纹理(本 Pass 持有)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    velocityTexture: WebGLTexture | null,
  ): WebGLTexture {
    const targetW = Math.max(1, gl.canvas.width);
    const targetH = Math.max(1, gl.canvas.height);

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    if (velocityTexture !== null) {
      this.velocityTexture = velocityTexture;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture as WebGLTexture);
    prog.setUniformSampler('u_velocityMap', 1);

    prog.setUniform1f('u_strength', this.strength);
    prog.setUniform1i('u_maxSamples', Math.max(1, Math.min(64, Math.floor(this.maxSamples))));
    prog.setUniform2f('u_screenSize', this._width, this._height);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
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
    this._dirty = true;
    // 不释放外部传入的 velocityTexture(所有权不归本 Pass)
    this.velocityTexture = null;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, MOTION_BLUR_FRAG);
    log.info('MotionBlur program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RGBA16F 输出纹理(模糊过程中可能出现 HDR 像素)
    const tex = gl.createTexture();
    if (!tex) throw new Error('MotionBlurPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA16F,
      width, height, 0,
      gl.RGBA, gl.HALF_FLOAT, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('MotionBlurPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('MotionBlurPass: createVertexArray/Buffer() returned null');
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

    log.info(`MotionBlur FBO created: ${width}x${height}`);
  }
}
