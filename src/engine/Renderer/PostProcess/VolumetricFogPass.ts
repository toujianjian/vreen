// VolumetricFogPass — 体积雾后处理 Pass。
//
// 设计目标:
//   - 基于深度纹理重建像素世界位置,按指数衰减计算雾密度;
//   - 支持距离范围 (fogStart / fogEnd) 限定雾作用区域;
//   - 沿光照方向计算简化光散射项,模拟体积光 (god rays);
//   - 不依赖 RenderPass 抽象(独立管理内部 FBO + 程序,与 SSRPass 同构)。
//
// 流程:
//   1. apply() 首次调用时按 canvas 尺寸分配内部 FBO + RGBA16F 颜色纹理
//      + 编译 VOLUMETRIC_FOG 程序;
//   2. 绑定 FBO + 全屏视口 → 画全屏四边形,fragment shader 读 color + depth
//      重建世界位置 → 计算 fogFactor 与散射 → 输出合成色;
//   3. 输出纹理交由下游 pass 处理。
//
// 不变量:
//   - dispose 后再调用 apply 自动重建;
//   - 内部纹理为 RGBA16F,因为体积光散射可能让像素亮度 > 1;
//   - 调用方需保证 depthTexture 为 NDC 深度(0..1)。
//
// 参考:
//   - fourier.eng.hmc.edu/e85/lectures/lectures.html (Mie / Rayleigh 散射)
//   - GPU Pro 2 "Real-Time Rendering of Accumulated Snow"

import type { Camera } from '../../Cameras/Camera';
import { Color } from '../../Math/Color';
import { Vector3 } from '../../Math/Vector3';
import { POST_VERT as POST_VERT_SRC, VOLUMETRIC_FOG_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('VolumetricFogPass');

export interface VolumetricFogPassOptions {
  /** 雾密度(指数衰减系数,0..1+;典型 0.02~0.1)。 */
  density?: number;
  /** 雾色。 */
  fogColor?: Color;
  /** 雾作用起始距离(世界单位,小于此距离无雾)。 */
  fogStart?: number;
  /** 雾作用结束距离(超出此距离全雾)。 */
  fogEnd?: number;
  /** 光照方向(指向光源,世界空间)。 */
  lightDir?: Vector3;
  /** 光色。 */
  lightColor?: Color;
  /** 体积光强度(0 关闭,典型 0.3~1.0)。 */
  godRaysStrength?: number;
}

/**
 * 体积雾 Pass。独立管理内部 FBO 与程序。
 *
 * apply() 把 input 颜色 + 深度纹理 + 相机变换喂给 VOLUMETRIC_FOG fragment
 * shader,输出合成后的颜色纹理。体积光散射通过沿光源方向的相函数近似,
 * 不做真实 ray march(开销过高),适合中等画质场景。
 */
export class VolumetricFogPass {
  readonly name = 'volumetric-fog';

  /** 雾密度(指数衰减系数)。 */
  density: number = 0.05;
  /** 雾色(默认浅灰,模拟空气雾)。 */
  fogColor: Color;
  /** 雾作用起始距离。 */
  fogStart: number = 5.0;
  /** 雾作用结束距离。 */
  fogEnd: number = 200.0;
  /** 光照方向(指向光源)。 */
  lightDir: Vector3;
  /** 光色。 */
  lightColor: Color;
  /** 体积光强度(0 关闭)。 */
  godRaysStrength: number = 0.4;

  /** 当前输出纹理。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: VolumetricFogPassOptions = {}) {
    this.fogColor = opts.fogColor ?? new Color(0.5, 0.55, 0.6);
    this.lightDir = opts.lightDir ?? new Vector3(-0.5, -1.0, -0.3);
    this.lightColor = opts.lightColor ?? new Color(1.0, 0.95, 0.85);
    if (opts.density !== undefined) this.density = opts.density;
    if (opts.fogStart !== undefined) this.fogStart = opts.fogStart;
    if (opts.fogEnd !== undefined) this.fogEnd = opts.fogEnd;
    if (opts.godRaysStrength !== undefined) this.godRaysStrength = opts.godRaysStrength;
  }

  /**
   * 执行体积雾合成。
   *
   * @param gl            WebGL2 上下文
   * @param inputTexture  当前帧颜色纹理
   * @param depthTexture  NDC 深度纹理(0..1)
   * @param camera        当前相机(读取 projectionInverse / viewInverse / position)
   * @returns             合成后的颜色纹理(本 Pass 持有)
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
    prog.setUniformMatrix4fv('u_viewInverse', camera.matrixWorld.elements);
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_density', this.density);
    prog.setUniform3f('u_fogColor', this.fogColor.r, this.fogColor.g, this.fogColor.b);
    prog.setUniform1f('u_fogStart', this.fogStart);
    prog.setUniform1f('u_fogEnd', this.fogEnd);
    prog.setUniform3f('u_lightDir', this.lightDir.x, this.lightDir.y, this.lightDir.z);
    prog.setUniform3f('u_lightColor', this.lightColor.r, this.lightColor.g, this.lightColor.b);
    prog.setUniform1f('u_godRaysStrength', this.godRaysStrength);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 设置雾密度(0..1+,过大可能完全遮蔽场景)。 */
  setDensity(d: number): void {
    this.density = Math.max(0, d);
  }

  /** 设置雾色(复制传入 Color,不持有引用)。 */
  setColor(c: Color): void {
    this.fogColor.copy(c);
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
    this._program = new ShaderProgram(gl, POST_VERT_SRC, VOLUMETRIC_FOG_FRAG);
    log.info('VolumetricFog program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    const tex = gl.createTexture();
    if (!tex) throw new Error('VolumetricFogPass: createTexture() returned null');
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
    if (!fbo) throw new Error('VolumetricFogPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('VolumetricFogPass: createVertexArray/Buffer() returned null');
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

    log.info(`VolumetricFog FBO created: ${width}x${height}`);
  }
}
