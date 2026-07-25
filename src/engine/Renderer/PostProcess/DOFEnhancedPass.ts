// DOFEnhancedPass — 增强景深后处理 Pass。
//
// 设计目标:
//   - 比基础 DOF 更高质量:基于 Circle of Confusion (CoC) 的物理散景模型;
//   - 支持三种散景形状:圆形(circle)/ 六边形(hexagon)/ 八边形(octagon);
//   - maxRadius 限制最大散景半径,控制 GPU 开销;
//   - 不依赖 RenderPass 抽象(独立管理内部 FBO + 程序,与 VolumetricFogPass 同构)。
//
// 流程:
//   1. apply() 首次调用时按 canvas 尺寸分配内部 FBO + RGBA16F 颜色纹理
//      + 编译 DOF_ENHANCED 程序;
//   2. 绑定 FBO + 全屏视口 → 画全屏四边形,fragment shader 读 color + depth
//      重建视图空间 Z → 计算 CoC → 按散景形状采样 16 个方向 → 输出合成色;
//   3. 返回输出纹理。
//
// 不变量:
//   - dispose 后再调用 apply 自动重建;
//   - 内部纹理为 RGBA16F(散景高亮可能 > 1.0);
//   - 调用方需保证 depthTexture 为 NDC 深度(0..1)。
//
// 参考:
//   - Potmesil & Chakravarty, "A Lens and Aperture Camera Model for Synthetic Image Generation"
//   - GPU Gems 1, Ch. 23 "Depth of Field: A Survey of Techniques"

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, DOF_ENHANCED_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('DOFEnhancedPass');

export interface DOFEnhancedPassOptions {
  /** 焦点距离(视图空间 Z,正值,默认 10)。 */
  focusDistance?: number;
  /** 焦点范围(范围内清晰,默认 5)。 */
  focusRange?: number;
  /** 散景形状(0=circle, 1=hexagon, 2=octagon,默认 0)。 */
  bokehShape?: number;
  /** 散景大小(像素,默认 16)。 */
  bokehSize?: number;
  /** 最大散景半径(像素,默认 32)。 */
  maxRadius?: number;
}

/**
 * 增强景深 Pass。独立管理内部 FBO 与程序。
 *
 * apply() 把 color + depth + 相机 projectionMatrixInverse 喂给 DOF_ENHANCED
 * fragment shader,输出散景模糊后的颜色纹理。
 */
export class DOFEnhancedPass {
  readonly name = 'dof-enhanced';

  /** 焦点距离(视图空间 Z,正值)。 */
  focusDistance: number = 10.0;
  /** 焦点范围。 */
  focusRange: number = 5.0;
  /** 散景形状(0=circle, 1=hexagon, 2=octagon)。 */
  bokehShape: number = 0;
  /** 散景大小(像素)。 */
  bokehSize: number = 16.0;
  /** 最大散景半径(像素)。 */
  maxRadius: number = 32.0;

  /** 当前输出纹理。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: DOFEnhancedPassOptions = {}) {
    if (opts.focusDistance !== undefined) this.focusDistance = opts.focusDistance;
    if (opts.focusRange !== undefined) this.focusRange = opts.focusRange;
    if (opts.bokehShape !== undefined) this.bokehShape = opts.bokehShape;
    if (opts.bokehSize !== undefined) this.bokehSize = opts.bokehSize;
    if (opts.maxRadius !== undefined) this.maxRadius = opts.maxRadius;
  }

  /**
   * 执行增强景深。
   *
   * @param gl            WebGL2 上下文
   * @param inputTexture  当前帧颜色纹理
   * @param depthTexture  NDC 深度纹理(0..1)
   * @param camera        当前相机(读取 projectionMatrixInverse)
   * @returns             散景模糊后的颜色纹理(本 Pass 持有)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
    const targetW = gl.canvas.width;
    const targetH = gl.canvas.height;
    if (!this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
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
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    prog.setUniformMatrix4fv('u_projectionInverse', camera.projectionMatrixInverse.elements);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_focusDistance', this.focusDistance);
    prog.setUniform1f('u_focusRange', this.focusRange);
    prog.setUniform1i('u_bokehShape', Math.max(0, Math.min(2, Math.floor(this.bokehShape))));
    prog.setUniform1f('u_bokehSize', this.bokehSize);
    prog.setUniform1f('u_maxRadius', this.maxRadius);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 设置焦点距离与范围。 */
  setFocus(distance: number, range: number): void {
    this.focusDistance = Math.max(0, distance);
    this.focusRange = Math.max(0.0001, range);
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
    this._program = new ShaderProgram(gl, POST_VERT_SRC, DOF_ENHANCED_FRAG);
    log.info('DOFEnhanced program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RGBA16F 输出纹理(散景高亮可能 > 1.0)
    const tex = gl.createTexture();
    if (!tex) throw new Error('DOFEnhancedPass: createTexture() returned null');
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
    if (!fbo) throw new Error('DOFEnhancedPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('DOFEnhancedPass: createVertexArray/Buffer() returned null');
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

    log.info(`DOFEnhanced FBO created: ${width}x${height}`);
  }
}
