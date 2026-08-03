// VolumetricCloudsPass — GPU 体积云渲染 Pass。
//
// 设计目标:
//   - 把 VolumetricClouds(数据/计算层)产出的密度场 + 光照参数灌入
//     VOLUMETRIC_CLOUDS_FRAG 片元 shader,执行 GPU ray-march 渲染。
//   - 与 VolumetricFogPass / HeightFogPass 同构:独立管理 FBO + 程序 + 全屏 VAO,
//     不依赖 RenderPass 抽象。
//   - 输入:场景颜色纹理 + NDC 深度纹理 + 3D 噪声纹理(WebGL2 TEXTURE_3D)
//     + VolumetricClouds uniform 包 + 相机变换。
//   - 输出:RGBA16F 颜色纹理(体积云在场景之上合成)。
//
// 流程:
//   1. apply() 首次调用时按 canvas 尺寸分配内部 FBO + RGBA16F 颜色纹理
//      + 编译 VOLUMETRIC_CLOUDS 程序 + 创建全屏 VAO;
//   2. 调用方提供 3D 噪声纹理(由 VolumetricClouds.generateNoise() 生成的
//      Float32Array 上传而来,VolumetricCloudsPass.uploadNoise() 负责
//      把 CPU 数据上传为 TEXTURE_3D);
//   3. apply() 绑定 FBO → 全屏四边形 → fragment shader 重建射线方向、
//      与云层 AABB 求交、光线步进采样 3D 噪声 + Beer-Lambert/Powder +
//      双叶 HG + 多散射 → 输出合成色;
//   4. 输出纹理交由下游 pass 处理(如 TAA、Tonemapping)。
//
// 不变量:
//   - dispose 后再调用 apply 自动重建;
//   - 内部颜色纹理为 RGBA16F(体积云亮度可能 > 1,需要 HDR 缓冲);
//   - 调用方需保证 depthTexture 为 NDC 深度(0..1);
//   - noiseTexture 由 uploadNoise() 创建并持有,dispose 时释放;
//   - 若未上传噪声纹理,apply() 直接返回输入颜色(降级)。
//
// 参考:
//   - Schneider & Vosin "Volumetric Clouds" (Horizon Zero Dawn, SIGGRAPH 2015)
//   - UE5 Volumetric Clouds plugin
//   - o3de Atom SkyAtmosphere + Clouds pass
//   - VolumetricFogPass / HeightFogPass(同构实现)

import type { Camera } from '../../Cameras/Camera';
import { VolumetricClouds } from '../../Environment/VolumetricClouds';
import { POST_VERT as POST_VERT_SRC, VOLUMETRIC_CLOUDS_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('VolumetricCloudsPass');

export interface VolumetricCloudsPassOptions {
  /** 世界→UVW 缩放(默认 1024,与 VolumetricClouds._sampleDensity 一致)。 */
  worldScale?: number;
  /** 阴影步长(世界单位,默认 8)。 */
  shadowStepLen?: number;
  /** 密度跳过阈值(默认 0.01,密度低于此值的体素跳过)。 */
  densityCutoff?: number;
  /**
   * 时序累积 EMA 系数 [0, 0.95)。
   * - 0 = 禁用(默认,单帧渲染,向后兼容)
   * - 0.85..0.9 = 强累积(blue-noise 抖动 + 重投影 EMA,等效 10x 步进数)
   * 启用后 Pass 额外分配一张 RGBA16F history 纹理,每帧 blit 当前结果到 history
   * 供下一帧重投影采样。
   */
  temporalBlend?: number;
}

/**
 * GPU 体积云 Pass。独立管理内部 FBO / 程序 / 全屏 VAO / 3D 噪声纹理。
 *
 * 与 VolumetricClouds(数据层)配套使用:
 * ```ts
 * const clouds = new VolumetricClouds();
 * clouds.generateNoise(42);
 * const pass = new VolumetricCloudsPass();
 * pass.uploadNoise(gl, clouds.noiseData!, clouds.noiseResolution);
 * // 每帧:
 * clouds.update(dt);
 * pass.apply(gl, colorTex, depthTex, camera, clouds);
 * ```
 *
 * apply() 把 VolumetricClouds 的 uniform 包 + 3D 噪声纹理喂给
 * VOLUMETRIC_CLOUDS_FRAG fragment shader,执行 GPU ray-march 并把云合成
 * 到场景颜色之上。输出为 RGBA16F 颜色纹理(本 Pass 持有)。
 */
export class VolumetricCloudsPass {
  readonly name = 'volumetric-clouds';

  /** 世界→UVW 缩放(与 VolumetricClouds._sampleDensity 一致)。 */
  worldScale: number = 1024;
  /** 阴影步长(世界单位)。 */
  shadowStepLen: number = 8;
  /** 密度跳过阈值。 */
  densityCutoff: number = 0.01;
  /**
   * 时序累积 EMA 系数 [0, 0.95)。0 = 禁用(默认)。
   * 设为 0.85..0.9 启用 blue-noise 抖动 + 重投影 EMA,显著降低步进数需求。
   */
  temporalBlend: number = 0;

  /** 当前输出纹理。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 3D 噪声纹理(由 uploadNoise 创建)。 */
  private _noiseTexture: WebGLTexture | null = null;
  /** 噪声纹理分辨率(用于检测是否需要重新上传)。 */
  private _noiseResolution: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  /** v3 时序:上一帧合成结果纹理(供下一帧重投影采样)。 */
  private _historyTexture: WebGLTexture | null = null;
  /** v3 时序:history FBO(blit 目标)。 */
  private _historyFbo: WebGLFramebuffer | null = null;
  /** v3 时序:上一帧 VP(world → NDC,重投影用)。null = 首帧。 */
  private _prevVP: Float32Array | null = null;
  /** v3 时序:帧序号(IGN 动画)。 */
  private _frameIndex: number = 0;
  /** v3 时序:history 是否有效(首帧/resize 后为 false)。 */
  private _hasHistory: boolean = false;

  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: VolumetricCloudsPassOptions = {}) {
    if (opts.worldScale !== undefined) this.worldScale = opts.worldScale;
    if (opts.shadowStepLen !== undefined) this.shadowStepLen = opts.shadowStepLen;
    if (opts.densityCutoff !== undefined) this.densityCutoff = opts.densityCutoff;
    if (opts.temporalBlend !== undefined) this.temporalBlend = opts.temporalBlend;
  }

  /**
   * 把 VolumetricClouds 生成的 3D 噪声数据上传为 TEXTURE_3D。
   *
   * @param gl    WebGL2 上下文
   * @param data  Float32Array 噪声体素(长度 = nx*ny*nz,每体素 1 float)
   * @param res   噪声分辨率 {x, y, z}
   */
  uploadNoise(
    gl: WebGL2RenderingContext,
    data: Float32Array,
    res: { x: number; y: number; z: number },
  ): void {
    // 分辨率变化 → 重新分配
    const needRealloc =
      !this._noiseTexture ||
      this._noiseResolution.x !== res.x ||
      this._noiseResolution.y !== res.y ||
      this._noiseResolution.z !== res.z;

    if (needRealloc) {
      if (this._noiseTexture) gl.deleteTexture(this._noiseTexture);
      this._noiseTexture = gl.createTexture();
      this._noiseResolution = { x: res.x, y: res.y, z: res.z };
      log.info(`noise texture allocated: ${res.x}x${res.y}x${res.z}`);
    }

    gl.bindTexture(gl.TEXTURE_3D, this._noiseTexture as WebGLTexture);
    // R16F 单通道浮点纹理(密度场)
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.R16F,
      res.x, res.y, res.z, 0,
      gl.RED, gl.FLOAT, data,
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
  }

  /** 噪声纹理是否已上传。 */
  get hasNoise(): boolean {
    return this._noiseTexture !== null;
  }

  /**
   * 执行体积云渲染。
   *
   * @param gl            WebGL2 上下文
   * @param inputTexture  当前帧颜色纹理
   * @param depthTexture  NDC 深度纹理(0..1)
   * @param camera        当前相机
   * @param clouds        VolumetricClouds 数据层(读取 uniform 包)
   * @returns             合成后的颜色纹理(本 Pass 持有);若未上传噪声则返回 inputTexture
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    camera: Camera,
    clouds: VolumetricClouds,
  ): WebGLTexture {
    // 降级:未上传噪声 → 直接返回输入(无云)
    if (!this._noiseTexture || !clouds.enabled) {
      return inputTexture;
    }

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

    // 颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 深度纹理 → unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    // 3D 噪声纹理 → unit 2
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this._noiseTexture as WebGLTexture);
    prog.setUniformSampler('u_noiseMap', 2);

    // v3 时序:history 纹理 → unit 3(仅 temporalBlend > 0 时有效)
    const temporalActive = this.temporalBlend > 0 && this._historyTexture !== null;
    if (temporalActive) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this._historyTexture as WebGLTexture);
      prog.setUniformSampler('u_historyMap', 3);
    }
    // 重投影用上一帧 VP;首帧/resize 后用当前 VP(无害,u_hasHistory=0 跳过混合)
    const prevVP = this._prevVP ?? this._computeVP(camera);
    prog.setUniformMatrix4fv('u_prevViewProjection', prevVP);
    prog.setUniform1f('u_temporalBlend', temporalActive ? this.temporalBlend : 0);
    prog.setUniform1i('u_frameIndex', this._frameIndex);
    prog.setUniform1i('u_hasHistory', this._hasHistory ? 1 : 0);

    // 相机变换
    prog.setUniformMatrix4fv('u_inverseViewProjection', this._computeInverseVP(camera));
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);

    // 从 VolumetricClouds 拉 uniform 包
    const u = clouds.getShaderUniforms();
    prog.setUniform3f('u_cloudColor', u.u_cloudColor[0], u.u_cloudColor[1], u.u_cloudColor[2]);
    prog.setUniform1f('u_cloudCoverage', u.u_cloudCoverage);
    prog.setUniform1f('u_cloudDensity', u.u_cloudDensity);
    prog.setUniform1f('u_cloudHeight', u.u_cloudHeight);
    prog.setUniform1f('u_cloudThickness', u.u_cloudThickness);
    prog.setUniform3f('u_windOffset', u.u_windOffset[0], u.u_windOffset[1], u.u_windOffset[2]);
    prog.setUniform1f('u_worldScale', this.worldScale);

    prog.setUniform3f('u_ambientColor', u.u_ambientColor[0], u.u_ambientColor[1], u.u_ambientColor[2]);
    prog.setUniform3f('u_sunColor', u.u_sunColor[0], u.u_sunColor[1], u.u_sunColor[2]);
    prog.setUniform3f('u_sunDirection', u.u_sunDirection[0], u.u_sunDirection[1], u.u_sunDirection[2]);

    prog.setUniform1i('u_steps', u.u_steps);
    prog.setUniform1i('u_shadowSteps', u.u_shadowSteps);
    prog.setUniform1f('u_shadowStepLen', this.shadowStepLen);

    prog.setUniform1f('u_multiScatteringFactor', u.u_multiScatteringFactor);
    prog.setUniform1i('u_multiScatteringSteps', u.u_multiScatteringSteps);
    prog.setUniform1f('u_hgForwardG', u.u_hgForwardG);
    prog.setUniform1f('u_hgBackwardG', u.u_hgBackwardG);
    prog.setUniform1f('u_hgForwardWeight', u.u_hgForwardWeight);
    prog.setUniform1f('u_heightDensityBottom', u.u_heightDensityBottom);
    prog.setUniform1f('u_heightDensityTop', u.u_heightDensityTop);
    prog.setUniform1f('u_coneRadius', u.u_coneRadius);
    prog.setUniform1f('u_densityCutoff', this.densityCutoff);

    prog.setUniform1i('u_enabled', u.u_enabled);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // v3 时序:把当前结果 blit 到 history 纹理,供下一帧重投影
    if (temporalActive) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._fbo as WebGLFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._historyFbo as WebGLFramebuffer);
      gl.blitFramebuffer(
        0, 0, this._width, this._height,
        0, 0, this._width, this._height,
        gl.COLOR_BUFFER_BIT, gl.LINEAR,
      );
      this._prevVP = this._computeVP(camera);
      this._hasHistory = true;
      this._frameIndex = (this._frameIndex + 1) & 0x7fffffff;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 释放内部 FBO / 纹理 / VAO / program / 噪声纹理。可重复调用。 */
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
    if (this._noiseTexture) {
      gl.deleteTexture(this._noiseTexture);
      this._noiseTexture = null;
    }
    if (this._historyTexture) {
      gl.deleteTexture(this._historyTexture);
      this._historyTexture = null;
    }
    if (this._historyFbo) {
      gl.deleteFramebuffer(this._historyFbo);
      this._historyFbo = null;
    }
    if (this._program) {
      this._program.dispose();
      this._program = null;
    }
    this._initialized = false;
    this._width = 0;
    this._height = 0;
    this._noiseResolution = { x: 0, y: 0, z: 0 };
    // v3 时序状态重置
    this._prevVP = null;
    this._frameIndex = 0;
    this._hasHistory = false;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._program) return this._program;
    this._program = new ShaderProgram(gl, POST_VERT_SRC, VOLUMETRIC_CLOUDS_FRAG);
    log.info('VolumetricClouds program compiled');
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._historyTexture) gl.deleteTexture(this._historyTexture);
      if (this._historyFbo) gl.deleteFramebuffer(this._historyFbo);
    }

    // HDR 颜色纹理(RGBA16F,体积云亮度可能 > 1)
    const tex = gl.createTexture();
    if (!tex) throw new Error('VolumetricCloudsPass: createTexture() returned null');
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
    if (!fbo) throw new Error('VolumetricCloudsPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO(2 个三角形覆盖 [-1,1]²)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('VolumetricCloudsPass: createVertexArray/Buffer() returned null');
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

    // v3 时序:history 纹理 + FBO(仅 temporalBlend > 0 时分配)
    if (this.temporalBlend > 0) {
      const htex = gl.createTexture();
      if (!htex) throw new Error('VolumetricCloudsPass: history createTexture() returned null');
      gl.bindTexture(gl.TEXTURE_2D, htex);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA16F,
        width, height, 0,
        gl.RGBA, gl.HALF_FLOAT, null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const hfbo = gl.createFramebuffer();
      if (!hfbo) throw new Error('VolumetricCloudsPass: history createFramebuffer() returned null');
      gl.bindFramebuffer(gl.FRAMEBUFFER, hfbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, htex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this._historyTexture = htex;
      this._historyFbo = hfbo;
    } else {
      this._historyTexture = null;
      this._historyFbo = null;
    }

    // resize → history 失效,重置时序状态
    this._prevVP = null;
    this._frameIndex = 0;
    this._hasHistory = false;

    this._outputTexture = tex;
    this._fbo = fbo;
    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`VolumetricClouds FBO created: ${width}x${height}${this.temporalBlend > 0 ? ' (+history)' : ''}`);
  }

  /**
   * 计算 inverse(viewProjection) — NDC → 世界。
   *
   * VP = projection × matrixWorldInverse
   * 然后 4×4 通用求逆(列主序)。
   */
  private _computeInverseVP(camera: Camera): Float32Array {
    return invertMat4(this._computeVP(camera));
  }

  /**
   * 计算 viewProjection — world → NDC(v3 时序重投影用)。
   * VP = projection × matrixWorldInverse(列主序)。
   */
  private _computeVP(camera: Camera): Float32Array {
    const proj = camera.projectionMatrix.elements;
    const view = camera.matrixWorldInverse.elements;
    const vp = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += view[k * 4 + r] * proj[c * 4 + k];
        }
        vp[c * 4 + r] = sum;
      }
    }
    return vp;
  }
}

/** 通用 4×4 矩阵求逆(列主序,与 HeightFogPass 一致)。 */
function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  const det = (
    m[0]  * (m[5]  * m[10] * m[15] - m[5]  * m[11] * m[14] - m[9]  * m[6]  * m[15] +
             m[9]  * m[7]  * m[14] + m[13] * m[6]  * m[11] - m[13] * m[7]  * m[10]) -
    m[1]  * (m[4]  * m[10] * m[15] - m[4]  * m[11] * m[14] - m[8]  * m[6]  * m[15] +
             m[8]  * m[7]  * m[14] + m[12] * m[6]  * m[11] - m[12] * m[7]  * m[10]) +
    m[2]  * (m[4]  * m[9]  * m[15] - m[4]  * m[11] * m[13] - m[8]  * m[5]  * m[15] +
             m[8]  * m[7]  * m[13] + m[12] * m[5]  * m[11] - m[12] * m[7]  * m[9]) -
    m[3]  * (m[4]  * m[9]  * m[14] - m[4]  * m[10] * m[13] - m[8]  * m[5]  * m[14] +
             m[8]  * m[6]  * m[13] + m[12] * m[5]  * m[10] - m[12] * m[6]  * m[9])
  );

  if (Math.abs(det) < 1e-10) {
    inv[0] = 1; inv[5] = 1; inv[10] = 1; inv[15] = 1;
    return inv;
  }

  const invDet = 1.0 / det;
  inv[0]  = ( m[5]  * m[10] * m[15] - m[5]  * m[11] * m[14] - m[9]  * m[6]  * m[15] + m[9]  * m[7]  * m[14] + m[13] * m[6]  * m[11] - m[13] * m[7]  * m[10]) * invDet;
  inv[1]  = (-m[1]  * m[10] * m[15] + m[1]  * m[11] * m[14] + m[9]  * m[2]  * m[15] - m[9]  * m[3]  * m[14] - m[13] * m[2]  * m[11] + m[13] * m[3]  * m[10]) * invDet;
  inv[2]  = ( m[1]  * m[6]  * m[15] - m[1]  * m[7]  * m[14] - m[5]  * m[2]  * m[15] + m[5]  * m[3]  * m[14] + m[13] * m[2]  * m[7]  - m[13] * m[3]  * m[6])  * invDet;
  inv[3]  = (-m[1]  * m[6]  * m[11] + m[1]  * m[7]  * m[10] + m[5]  * m[2]  * m[11] - m[5]  * m[3]  * m[10] - m[13] * m[2]  * m[7]  + m[13] * m[3]  * m[6])  * invDet;
  inv[4]  = (-m[4]  * m[10] * m[15] + m[4]  * m[11] * m[14] + m[8]  * m[6]  * m[15] - m[8]  * m[7]  * m[14] - m[12] * m[6]  * m[11] + m[12] * m[7]  * m[10]) * invDet;
  inv[5]  = ( m[0]  * m[10] * m[15] - m[0]  * m[11] * m[14] - m[8]  * m[2]  * m[15] + m[8]  * m[3]  * m[14] + m[12] * m[2]  * m[11] - m[12] * m[3]  * m[10]) * invDet;
  inv[6]  = (-m[0]  * m[6]  * m[15] + m[0]  * m[7]  * m[14] + m[4]  * m[2]  * m[15] - m[4]  * m[3]  * m[14] - m[12] * m[2]  * m[7]  + m[12] * m[3]  * m[6])  * invDet;
  inv[7]  = ( m[0]  * m[6]  * m[11] - m[0]  * m[7]  * m[10] - m[4]  * m[2]  * m[11] + m[4]  * m[3]  * m[10] + m[12] * m[2]  * m[7]  - m[12] * m[3]  * m[6])  * invDet;
  inv[8]  = ( m[4]  * m[9]  * m[15] - m[4]  * m[11] * m[13] - m[8]  * m[5]  * m[15] + m[8]  * m[7]  * m[13] + m[12] * m[5]  * m[11] - m[12] * m[7]  * m[9])  * invDet;
  inv[9]  = (-m[0]  * m[9]  * m[15] + m[0]  * m[11] * m[13] + m[8]  * m[1]  * m[15] - m[8]  * m[3]  * m[13] - m[12] * m[1]  * m[11] + m[12] * m[3]  * m[9])  * invDet;
  inv[10] = ( m[0]  * m[5]  * m[15] - m[0]  * m[7]  * m[13] - m[4]  * m[1]  * m[15] + m[4]  * m[3]  * m[13] + m[12] * m[1]  * m[7]  - m[12] * m[3]  * m[5])  * invDet;
  inv[11] = (-m[0]  * m[5]  * m[11] + m[0]  * m[7]  * m[9]  + m[4]  * m[1]  * m[11] - m[4]  * m[3]  * m[9]  - m[12] * m[1]  * m[7]  + m[12] * m[3]  * m[5])  * invDet;
  inv[12] = (-m[4]  * m[9]  * m[14] + m[4]  * m[10] * m[13] + m[8]  * m[5]  * m[14] - m[8]  * m[6]  * m[13] - m[12] * m[5]  * m[10] + m[12] * m[6]  * m[9])  * invDet;
  inv[13] = ( m[0]  * m[9]  * m[14] - m[0]  * m[10] * m[13] - m[8]  * m[1]  * m[14] + m[8]  * m[2]  * m[13] + m[12] * m[1]  * m[10] - m[12] * m[2]  * m[9])  * invDet;
  inv[14] = (-m[0]  * m[5]  * m[14] + m[0]  * m[6]  * m[13] + m[4]  * m[1]  * m[14] - m[4]  * m[2]  * m[13] - m[12] * m[1]  * m[6]  + m[12] * m[2]  * m[5])  * invDet;
  inv[15] = ( m[0]  * m[5]  * m[10] - m[0]  * m[6]  * m[9]  - m[4]  * m[1]  * m[10] + m[4]  * m[2]  * m[9]  + m[12] * m[1]  * m[6]  - m[12] * m[2]  * m[5])  * invDet;
  return inv;
}
