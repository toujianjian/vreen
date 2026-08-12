// VelocityPass — 速度缓冲(motion vectors)生成 Pass。
//
// 设计目标:
//   - 从 GBuffer 世界位置纹理 + 当前/上一帧 view-projection 矩阵,
//     计算屏幕空间速度向量(供 TAA / MotionBlur 等下游 pass 消费)。
//   - 独立管理内部 FBO + 程序(与 SSRPass / VolumetricFogPass 同构),
//     不继承 RenderPass,因为 apply() 签名需要额外的 positionTexture。
//
// 流程:
//   1. updateMatrices(camera) 在每帧渲染前调用,把上一帧 currViewProjection
//      推到 prevViewProjection,再用当前 camera 计算新的 currViewProjection。
//      (调用方负责在主场景渲染前调用一次。)
//   2. apply(gl, positionTexture, camera) 把 GBuffer 世界位置 + 当前/上一帧
//      view-projection 喂给 VELOCITY_FRAG,输出 RG = NDC 速度(已乘 0.5)。
//   3. 输出纹理交由下游 pass(TAA / MotionBlur)采样。
//
// 不变量:
//   - dispose 后再 apply 自动重建(懒分配);
//   - 内部纹理为 RG16F(只需双通道浮点,比 RGBA16F 节省带宽),
//     若实现不支持 RG16F 则回退到 RGBA16F;
//   - 输出纹理所有权归 Pass,调用方不得释放。
//   - 首帧(prevViewProjection 为零矩阵)时速度全为 0,等价于无运动。
//
// 参考:
//   - GPU Pro 5 "Practical Frame Interpolation"
//   - three.js examples/jsm/postprocessing/AfterimagePass(生命周期参考)

import type { Camera } from '../../Cameras/Camera';
import { Matrix4 } from '../../Math';
import { POST_VERT as POST_VERT_SRC, VELOCITY_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('VelocityPass');

export interface VelocityPassOptions {
  /** 降采样比例(0..1,默认 1.0 = 全分辨率)。 */
  resolution?: number;
}

/**
 * 速度缓冲 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * 调用方职责:
 *   1. 每帧主场景渲染前调用 `updateMatrices(camera)`,
 *      让 Pass 滚动 prevViewProjection / currViewProjection;
 *   2. 主场景渲染后调用 `apply(gl, positionTexture, camera)` 生成速度纹理;
 *   3. 把返回的速度纹理喂给 TAAPass / MotionBlurPass。
 */
export class VelocityPass {
  readonly name = 'velocity';

  /** 降采样比例(0..1)。1.0 = 全分辨率,0.5 = 半分辨率(默认推荐全分辨率)。 */
  resolution: number = 1.0;

  /** 上一帧 view-projection(用于反推 prev 屏幕坐标)。 */
  prevViewProjection: Matrix4;
  /** 当前帧 view-projection。 */
  currViewProjection: Matrix4;

  /** 当前输出纹理(apply 后可用,null 表示尚未渲染或已 dispose)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  /** 全屏四边形 VAO(本 Pass 自管)。 */
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 当前内部缓冲尺寸(像素)。 */
  private _width: number = 0;
  private _height: number = 0;
  /** 是否已初始化。 */
  private _initialized: boolean = false;
  /** 标记下一帧需要重建(分辨率 / 尺寸变更)。 */
  private _dirty: boolean = true;

  constructor(opts: VelocityPassOptions = {}) {
    if (opts.resolution !== undefined) this.resolution = opts.resolution;
    this.prevViewProjection = new Matrix4();
    this.currViewProjection = new Matrix4();
  }

  /**
   * 滚动矩阵:把当前 currViewProjection 推到 prevViewProjection,
   * 再用 camera 计算新的 currViewProjection。
   *
   * 必须在主场景渲染前调用一次,保证 apply() 看到正确的"上一帧"矩阵。
   */
  updateMatrices(camera: Camera): void {
    // prev ← curr
    this.prevViewProjection.copy(this.currViewProjection);
    // curr ← projection * view(camera.matrixWorldInverse 是 view,projectionMatrix 是 projection)。
    // VELOCITY_FRAG 中 u_currViewProjection * vec4(worldPos,1.0) 把世界坐标变换到 clip 空间,
    // 标准列主序 multiplyMatrices(a, b) = a × b,故取 (projection, view)。
    this.currViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  /**
   * 执行速度缓冲生成。
   *
   * @param gl              WebGL2 上下文
   * @param positionTexture GBuffer 世界位置纹理(RGBA16F)
   * @param camera          当前相机(apply 内部不更新矩阵,需先调 updateMatrices)
   * @returns               速度纹理(RG16F / RGBA16F,本 Pass 持有)
   */
  apply(
    gl: WebGL2RenderingContext,
    positionTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
    void camera; // apply 不再读 camera;矩阵已在 updateMatrices 中算好
    const targetW = Math.max(1, Math.floor(gl.canvas.width * this.resolution));
    const targetH = Math.max(1, Math.floor(gl.canvas.height * this.resolution));

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, positionTexture);
    prog.setUniformSampler('u_positionMap', 0);

    prog.setUniformMatrix4fv('u_currViewProjection', this.currViewProjection.elements);
    prog.setUniformMatrix4fv('u_prevViewProjection', this.prevViewProjection.elements);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 设置降采样比例(0..1)。值变化后下一帧 apply 自动重建。 */
  setResolution(scale: number): void {
    const clamped = Math.max(0.05, Math.min(1.0, scale));
    if (Math.abs(clamped - this.resolution) > 1e-6) {
      this.resolution = clamped;
      this._dirty = true;
    }
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
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, VELOCITY_FRAG);
    log.info('Velocity program compiled');
    return this._program;
  }

  /** (重新)分配内部 FBO + 纹理 + 全屏四边形 VAO。 */
  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RG16F 优先(只需 RG 双通道浮点);不可用回退 RGBA16F。
    const internalFormat = gl.RG16F ?? gl.RGBA16F;
    const format = internalFormat === gl.RG16F ? gl.RG : gl.RGBA;

    const tex = gl.createTexture();
    if (!tex) throw new Error('VelocityPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, internalFormat,
      width, height, 0,
      format, gl.HALF_FLOAT, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('VelocityPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO(position@0 + uv@2,与 POST_VERT 一致)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('VelocityPass: createVertexArray/Buffer() returned null');
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

    log.info(`Velocity FBO created: ${width}x${height} (resolution=${this.resolution})`);
  }
}
