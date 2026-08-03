// FSRUpscalePass — AMD FidelityFX FSR1 EASU (Edge-Adaptive Spatial Upsampling)。
//
// 将低分辨率渲染目标上采样到高分辨率输出。9-tap 双边加权双线性:
// luma 梯度检测边缘 → 4 角按 luma 相似度加权 → 避免跨边缘模糊。
//
// 管线位置:渲染管线末端(TAA/后处理之后),输出到屏幕前。
// 典型用法:
//   1. 以 50%-70% 内部分辨率渲染场景 + 后处理
//   2. FSRUpscalePass.apply() 上采样到全分辨率
//   3. SharpenPass (RCAS) 锐化上采样结果
//   4. 输出到屏幕
//
// 输入:低分辨率颜色纹理 + 输入尺寸。输出:高分辨率上采样纹理。
// 独立管理 FBO(输出分辨率),不继承 RenderPass(分辨率不匹配)。
//
// 参考:
//   - AMD FidelityFX-FSR1 (MIT License)
//   - o3de Atom UpscalingPass

import { POST_VERT as POST_VERT_SRC, FSR_EASU_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('FSRUpscalePass');

export interface FSRUpscaleOptions {
  /** 是否在 apply 时输出调试日志(默认 false)。 */
  debug?: boolean;
}

/**
 * FSR EASU 上采样 Pass。独立管理内部 FBO(输出分辨率)与程序。
 *
 * apply() 接收低分辨率颜色纹理 + 输入尺寸,输出高分辨率上采样纹理。
 * 输出尺寸由 gl.canvas 决定。
 */
export class FSRUpscalePass {
  readonly name = 'fsr-upscale';

  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(_opts: FSRUpscaleOptions = {}) {
    // 目前无运行时选项;接口预留供未来扩展(如 quality level)。
  }

  /**
   * 执行 FSR EASU 上采样。
   *
   * @param gl            WebGL2 上下文(输出尺寸 = gl.canvas 尺寸)
   * @param inputTexture  低分辨率颜色纹理
   * @param inputWidth    低分辨率输入宽度(px)
   * @param inputHeight   低分辨率输入高度(px)
   * @returns             高分辨率上采样纹理(尺寸 = gl.canvas)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    inputWidth: number,
    inputHeight: number,
  ): WebGLTexture {
    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this._dirty || !this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    // 输入颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 输入尺寸
    prog.setUniform2f('u_inputSize', inputWidth, inputHeight);
    prog.setUniform2f('u_invInputSize', 1.0 / inputWidth, 1.0 / inputHeight);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建(分辨率变更等)。 */
  setDirty(): void { this._dirty = true; }

  /** 释放 GPU 资源。 */
  dispose(): void {
    this._outputTexture = null;
    this._fbo = null;
    this._program = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 输出纹理(RGBA8,高分辨率)
    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO(高分辨率)
    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);

    // 全屏四边形 VAO(大三角形覆盖 [-1,1])
    this._fullscreenQuadBuf = gl.createBuffer();
    this._fullscreenQuadVao = gl.createVertexArray();
    gl.bindVertexArray(this._fullscreenQuadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
    const verts = new Float32Array([
      -1, -1, 0, 0,  3, -1, 0, 0,  -1, 3, 0, 0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this._width = w;
    this._height = h;
    this._initialized = true;
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, FSR_EASU_FRAG);
    }
    return this._program;
  }
}
