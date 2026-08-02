// SSGIPass — 屏幕空间全局光照 (Screen-Space Global Illumination) 后处理 Pass。
//
// 设计目标:
//   - 基于 GBuffer 的世界位置 + 世界法线 + 场景颜色,在屏幕空间做
//     漫反射间接光采样,产生彩色反弹光(颜色渗透 / bleed)。
//   - 与 SSR 互补:SSR 处理镜面反射(金属 / 湿润表面),SSGI 处理
//     漫反射间接光(粗糙表面的颜色反弹)。
//   - 不依赖 RenderPass.apply(input, ctx) 抽象,因为 SSGI 需要额外的
//     position / normal 纹理,签名不同;本类独立管理内部 FBO + 程序。
//   - 支持 resolution 降采样(典型 0.5)以减轻 GPU 负担。
//
// 流程:
//   1. apply() 首次调用时按 width * resolution × height * resolution
//      分配内部 FBO + RGBA16F 颜色纹理 + 编译 SSGI 程序;
//   2. 绑定 FBO + 视口 → 画全屏四边形,fragment shader 读 input/position/
//      normal 三张纹理,对每像素发射 8 条余弦加权半球射线做屏幕空间
//      射线步进,命中时采样颜色累积间接辐照度;
//   3. 输出纹理为间接辐照度(RGBA16F),调用方将其叠加到场景颜色:
//        finalColor = sceneColor + indirectIrradiance × albedo / π
//
// 不变量:
//   - dispose 后再调用 apply 会重新分配资源(懒重建);
//   - setResolution() 修改降采样比例后,下一帧 apply 自动重建;
//   - 内部纹理为 RGBA16F(HDR 间接光可能 > 1);
//   - 输出纹理所有权归 Pass,调用方不得释放。
//   - frame 计数每 apply 自增 1,用于时序旋转采样模式。
//
// 参考:
//   - Crytek "Real-time Diffuse Global Illumination in Screen Space" (SSDO)
//   - o3de Atom "ScreenSpaceGlobalIllumination" pass
//   - EA SEED "Stable SSAO" GDC 演讲(IGN 时序抖动)

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, SSGI_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('SSGIPass');

export interface SSGIPassOptions {
  /** 每射线最大步进次数(默认 32)。 */
  maxSteps?: number;
  /** 厚度容差,世界单位(默认 0.5)。 */
  thickness?: number;
  /** 降采样比例 0..1(默认 0.5)。1.0 表示全分辨率。 */
  resolution?: number;
  /** 间接光强度(默认 0.5)。 */
  strength?: number;
  /** 采样半径,世界单位(默认 0.5)。控制间接光作用范围。 */
  radius?: number;
  /** 射线数 1..8(默认 8)。更多射线 = 更平滑但更慢。 */
  numRays?: number;
  /** 时序抖动幅度(默认 1.0,0=关闭)。配合 TAA 消除噪声。 */
  jitterScale?: number;
}

/**
 * 屏幕空间全局光照 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * apply() 把 color + position + normal 三张纹理喂给 SSGI fragment shader,
 * 输出到内部 FBO 的 RGBA16F 颜色纹理(间接辐照度)。调用方拿到返回的
 * WebGLTexture 后自行决定如何合成(典型做法:additive blend 到场景颜色)。
 */
export class SSGIPass {
  readonly name = 'ssgi';

  /** 每射线最大步进次数(0..64,shader 上限 64)。 */
  maxSteps: number = 32;
  /** 厚度容差(世界单位)。值太小会漏检;太大会出现"穿透"伪间接光。 */
  thickness: number = 0.5;
  /** 降采样比例(0..1)。1.0 = 全分辨率,0.5 = 半分辨率(默认推荐)。 */
  resolution: number = 0.5;
  /** 间接光强度(0..1+,>1 会过亮,需配合下游 ToneMappingPass)。 */
  strength: number = 0.5;
  /** 采样半径(世界单位)。控制间接光作用范围。 */
  radius: number = 0.5;
  /** 射线数(1..8)。更多射线 = 更平滑的间接光但 GPU 开销线性增长。 */
  numRays: number = 8;
  /** 时序抖动幅度(0=关闭,1=默认)。配合 TAA 消除噪声。 */
  jitterScale: number = 1.0;
  /** 帧计数(每 apply 自增,用于时序旋转采样模式)。 */
  frame: number = 0;

  /** SSGI 输出纹理(apply 后可用,RGBA16F 间接辐照度)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;

  /** 全屏四边形 VAO(本 Pass 自管,不依赖外部 ctx)。 */
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 当前内部缓冲尺寸(像素)。 */
  private _width: number = 0;
  private _height: number = 0;
  /** 是否已初始化。 */
  private _initialized: boolean = false;
  /** 标记下一帧需要重建(分辨率 / 尺寸变更)。 */
  private _dirty: boolean = true;

  constructor(opts: SSGIPassOptions = {}) {
    if (opts.maxSteps !== undefined) this.maxSteps = opts.maxSteps;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.resolution !== undefined) this.resolution = opts.resolution;
    if (opts.strength !== undefined) this.strength = opts.strength;
    if (opts.radius !== undefined) this.radius = opts.radius;
    if (opts.numRays !== undefined) this.numRays = opts.numRays;
    if (opts.jitterScale !== undefined) this.jitterScale = opts.jitterScale;
  }

  /**
   * 执行 SSGI 采样,输出间接辐照度纹理。
   *
   * @param gl              WebGL2 上下文
   * @param inputTexture    当前帧颜色纹理(间接光的反弹光源)
   * @param positionTexture GBuffer 世界位置纹理(RGBA16F)
   * @param normalTexture   GBuffer 世界法线纹理(RGBA16F)
   * @param camera          当前相机(读取 projection / view / position)
   * @returns               SSGI 输出纹理(间接辐照度,RGBA16F)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    positionTexture: WebGLTexture,
    normalTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
    const targetW = Math.max(1, Math.floor(gl.canvas.width * this.resolution));
    const targetH = Math.max(1, Math.floor(gl.canvas.height * this.resolution));

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    // ── SSGI 主 pass ───────────────────────────────────────────────
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
    gl.bindTexture(gl.TEXTURE_2D, positionTexture);
    prog.setUniformSampler('u_positionMap', 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, normalTexture);
    prog.setUniformSampler('u_normalMap', 2);

    prog.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    prog.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1i('u_maxSteps', Math.max(0, Math.min(64, Math.floor(this.maxSteps))));
    prog.setUniform1f('u_thickness', this.thickness);
    prog.setUniform1f('u_strength', this.strength);
    prog.setUniform1f('u_radius', this.radius);
    prog.setUniform1i('u_numRays', Math.max(1, Math.min(8, Math.floor(this.numRays))));
    prog.setUniform1f('u_jitterScale', this.jitterScale);
    prog.setUniform1f('u_frame', this.frame);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 帧计数自增(时序旋转)
    this.frame++;

    return this._outputTexture as WebGLTexture;
  }

  /** 设置降采样比例(0.05..1.0)。 */
  setResolution(r: number): void {
    const clamped = Math.max(0.05, Math.min(1.0, r));
    if (clamped !== this.resolution) {
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
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, SSGI_FRAG);
    log.info('SSGI program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // RGBA16F 输出纹理(HDR 间接辐照度,可能 > 1)
    const tex = gl.createTexture();
    if (!tex) throw new Error('SSGIPass: createTexture() returned null');
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
    if (!fbo) throw new Error('SSGIPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO(position@0 + uv@2)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('SSGIPass: createVertexArray/Buffer() returned null');
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

    log.info(`SSGI FBO created: ${width}x${height}`);
  }
}
