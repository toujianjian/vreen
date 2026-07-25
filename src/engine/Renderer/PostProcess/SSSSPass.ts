// SSSSPass — 屏幕空间次表面散射(Screen-Space Subsurface Scattering)后处理 Pass。
//
// 设计目标:
//   - 模拟皮肤 / 蜡 / 玉石等半透明材质的光线穿透与散射;
//   - 可分离高斯模糊(水平 + 垂直两趟),开销远低于全 2D 卷积;
//   - 深度感知权重:深度差大时降低贡献,避免背景渗透到前景;
//   - 次表面颜色混合:把模糊结果向 subsurfaceColor 调色,模拟内部散射光。
//
// 流程:
//   1. apply() 首次调用时分配两个 FBO(中间 + 输出)+ VAO + 编译 SSSS 程序;
//   2. 第一趟(水平):bind FBO_A → input 作为输入 → u_blurDir=(1,0) → 写 _intermediateTexture;
//   3. 第二趟(垂直):bind FBO_B → _intermediateTexture 作为输入 → u_blurDir=(0,1) → 写 _outputTexture;
//   4. 返回 _outputTexture。
//
// 不变量:
//   - dispose 后再调用 apply 自动重建;
//   - 内部纹理为 RGBA16F(次表面散射可能 > 1.0,需浮点);
//   - kernel 数组长度固定 17,通过 maxSamples 控制实际使用数(1..17)。
//
// 参考:
//   - Jorge Jimenez, "Separable SSSS" (SIGGRAPH 2015)
//   - d3xter/separable-sss(GitHub 参考实现)

import { Color } from '../../Math/Color';
import { POST_VERT as POST_VERT_SRC, SSSS_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('SSSSPass');

export interface SSSSPassOptions {
  /** 强度(0..1+,默认 1.0)。 */
  strength?: number;
  /** 深度衰减(越大越锐利,默认 1.0)。 */
  falloff?: number;
  /** 次表面颜色(默认皮肤色 (1, 0.3, 0.2))。 */
  subsurfaceColor?: Color;
  /** 最大采样数(奇数,1..17,默认 17)。 */
  maxSamples?: number;
}

/**
 * SSSS Pass。独立管理两个内部 FBO(中间 + 输出)与一个程序。
 *
 * apply() 通过两趟可分离高斯模糊完成次表面散射:
 * 第一趟水平模糊 input → 中间纹理,第二趟垂直模糊 → 输出纹理。
 * kernel 在 CPU 端计算(computeKernel),通过 u_kernel[17] 传入 shader。
 */
export class SSSSPass {
  readonly name = 'ssss';

  /** 强度。 */
  strength: number = 1.0;
  /** 深度衰减。 */
  falloff: number = 1.0;
  /** 次表面颜色。 */
  subsurfaceColor: Color;
  /** 最大采样数(奇数,1..17)。 */
  maxSamples: number = 17;
  /** 高斯核(长度 17,kernel[half] 为中心权重)。 */
  kernel: Float32Array;

  /** 中间纹理(第一趟输出)。 */
  private _intermediateTexture: WebGLTexture | null = null;
  private _intermediateFbo: WebGLFramebuffer | null = null;
  /** 最终输出纹理(第二趟输出)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _outputFbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: SSSSPassOptions = {}) {
    this.subsurfaceColor = opts.subsurfaceColor ?? new Color(1.0, 0.3, 0.2);
    this.kernel = new Float32Array(17);
    if (opts.strength !== undefined) this.strength = opts.strength;
    if (opts.falloff !== undefined) this.falloff = opts.falloff;
    if (opts.maxSamples !== undefined) this.maxSamples = opts.maxSamples;
    this.computeKernel();
  }

  /**
   * 执行 SSSS(两趟可分离高斯模糊)。
   *
   * @param gl            WebGL2 上下文
   * @param inputTexture  当前帧颜色纹理
   * @param depthTexture  NDC 深度纹理(0..1)
   * @returns             散射后的颜色纹理(本 Pass 持有)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    depthTexture: WebGLTexture,
  ): WebGLTexture {
    const targetW = gl.canvas.width;
    const targetH = gl.canvas.height;
    if (!this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
    }

    const prog = this._getProgram(gl);
    prog.use();

    // ── 第一趟:水平模糊 input → _intermediateTexture ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._intermediateFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    this._setCommonUniforms(gl, prog, 1.0, 0.0);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── 第二趟:垂直模糊 _intermediateTexture → _outputTexture ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._outputFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._intermediateTexture as WebGLTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // depth 仍用原始纹理(避免深度也被模糊)
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    this._setCommonUniforms(gl, prog, 0.0, 1.0);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 设置强度(0..1+)。 */
  setStrength(s: number): void {
    this.strength = Math.max(0, s);
  }

  /** 设置深度衰减(>0)。 */
  setFalloff(f: number): void {
    this.falloff = Math.max(0, f);
  }

  /**
   * 计算高斯核并写入 this.kernel。
   * 基于 maxSamples 与 sigma = half/2,归一化后总和 = 1。
   * 未使用的尾部元素填 0。
   */
  computeKernel(): void {
    const n = Math.max(1, Math.min(17, this.maxSamples));
    this.kernel.fill(0);
    const half = Math.floor(n / 2);
    const sigma = Math.max(0.5, half / 2.0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - half;
      const w = Math.exp(-(x * x) / (2 * sigma * sigma));
      this.kernel[i] = w;
      sum += w;
    }
    if (sum > 0) {
      for (let i = 0; i < n; i++) this.kernel[i] /= sum;
    } else {
      // 退化:中心 1
      this.kernel[half] = 1;
    }
  }

  /** 释放内部 FBO / 纹理 / VAO / program。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._intermediateTexture) {
      gl.deleteTexture(this._intermediateTexture);
      this._intermediateTexture = null;
    }
    if (this._intermediateFbo) {
      gl.deleteFramebuffer(this._intermediateFbo);
      this._intermediateFbo = null;
    }
    if (this._outputTexture) {
      gl.deleteTexture(this._outputTexture);
      this._outputTexture = null;
    }
    if (this._outputFbo) {
      gl.deleteFramebuffer(this._outputFbo);
      this._outputFbo = null;
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
    this._program = new ShaderProgram(gl, POST_VERT_SRC, SSSS_FRAG);
    log.info('SSSS program compiled');
    return this._program;
  }

  /** 设置两趟共用的 uniform(blurDir 不同)。 */
  private _setCommonUniforms(
    gl: WebGL2RenderingContext,
    prog: ShaderProgram,
    dirX: number,
    dirY: number,
  ): void {
    prog.setUniform2f('u_blurDir', dirX, dirY);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_strength', this.strength);
    prog.setUniform1f('u_falloff', this.falloff);
    prog.setUniform3f('u_subsurfaceColor', this.subsurfaceColor.r, this.subsurfaceColor.g, this.subsurfaceColor.b);
    prog.setUniform1i('u_maxSamples', Math.max(1, Math.min(17, Math.floor(this.maxSamples))));
    // u_kernel[17]:ShaderProgram 未封装 1fv,直接走 GL。
    const kernelLoc = prog.uniforms.get('u_kernel');
    if (kernelLoc) {
      gl.uniform1fv(kernelLoc, this.kernel);
    }
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._intermediateTexture) gl.deleteTexture(this._intermediateTexture);
      if (this._intermediateFbo) gl.deleteFramebuffer(this._intermediateFbo);
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._outputFbo) gl.deleteFramebuffer(this._outputFbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    const makeTexture = (label: string): WebGLTexture => {
      const t = gl.createTexture();
      if (!t) throw new Error(`SSSSPass: createTexture() returned null (${label})`);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA16F,
        width, height, 0,
        gl.RGBA, gl.HALF_FLOAT, null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };

    const makeFbo = (tex: WebGLTexture, label: string): WebGLFramebuffer => {
      const f = gl.createFramebuffer();
      if (!f) throw new Error(`SSSSPass: createFramebuffer() returned null (${label})`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return f;
    };

    this._intermediateTexture = makeTexture('intermediate');
    this._intermediateFbo = makeFbo(this._intermediateTexture, 'intermediate');
    this._outputTexture = makeTexture('output');
    this._outputFbo = makeFbo(this._outputTexture, 'output');

    // 全屏四边形 VAO
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('SSSSPass: createVertexArray/Buffer() returned null');
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

    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`SSSS FBOs created: ${width}x${height} (maxSamples=${this.maxSamples})`);
  }
}
