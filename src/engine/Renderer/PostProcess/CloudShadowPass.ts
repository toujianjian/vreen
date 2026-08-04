// CloudShadowPass — 体积云阴影后处理 Pass。
//
// 在场景颜色上应用云层投下的阴影:
//   - 沿太阳方向射线步进穿过云层,采样 3D 云密度场(与 VolumetricClouds /
//     VolumetricCloudsPass 共享同一纹理),累积光学深度;
//   - 由 Beer-Lambert 透射率 T = exp(-τ) 推导阴影因子;
//   - 用 mix(1, T, intensity) 压暗场景颜色,模拟云体在地面的投影。
//
// 与 VolumetricCloudsPass 的区别:
//   - VolumetricCloudsPass 渲染云体本身(天空合成);
//   - CloudShadowPass 把云体作为光源遮挡体,作用于地面/物体像素,
//     让阴影与天空云形状同步漂移、随太阳高度角变化。
//
// 复用契约:
//   - 调用方传入与 VolumetricCloudsPass 相同的 noiseTexture(TEXTURE_3D,
//     由 VolumetricClouds.generateNoise() 上传);
//   - 调用方传入与 VolumetricClouds 一致的 cloudHeight/cloudThickness/
//     cloudCoverage/cloudDensity/windOffset/worldScale/heightDensityBottom/
//     heightDensityTop(由 VolumetricClouds.getShaderUniforms() 提供),
//     保证云阴影与天空云完全一致。
//
// 性能:
//   - 单 pass 全屏,片元沿云层厚度方向步进 u_shadowSteps 次(默认 16);
//   - 天空像素(depth==1)提前退出(云影已在天空合成);
//   - 太阳水平线下时整片提前退出;
//   - 采样密度低于 densityCutoff 的体素跳过(与 VolumetricCloudsPass 一致)。
//
// 算法(与 CLOUD_SHADOW_FRAG 1:1):
//   1. 重建像素世界坐标(由 NDC depth + inverseViewProjection)
//   2. 太阳方向 sunDir(归一化,指向太阳);sunDir.y <= 0 直接返回
//   3. 计算像素沿 sunDir 到云层底/顶的参数 tEnter / tExit
//   4. 沿 [tEnter, tExit] 均匀步进,累积 opticalDepth += density * stepLen
//   5. transmittance = exp(-opticalDepth)
//   6. shadowFactor = mix(1, transmittance, intensity)
//   7. outColor = sceneColor * shadowFactor
//
// 参考:
//   - Schneider & Vosin "Volumetric Clouds" (Horizon Zero Dawn, SIGGRAPH 2015)
//     — 同一密度场用于云体渲染与地面阴影
//   - UE5 Volumetric Clouds shadows(云阴影投射到场景)
//   - o3de Atom SkyAtmosphere + VolumetricClouds shadow pass
//   - VolumetricCloudsPass(同构实现)

import { CLOUD_SHADOW_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('CloudShadowPass');

/** 太阳方向(vec3,归一化,指向太阳)。 */
export type SunDirection = [x: number, y: number, z: number];

/** 风偏移(vec3,由 VolumetricClouds.update 累积)。 */
export type WindOffset = [x: number, y: number, z: number];

/** 高度密度参数(底部/顶部衰减,与 VolumetricClouds 一致)。 */
export interface HeightDensity {
  /** 底部密度衰减(0..1,0=不衰减,1=完全衰减)。 */
  bottom: number;
  /** 顶部密度衰减(0..1)。 */
  top: number;
}

export interface CloudShadowOptions {
  /**
   * 沿太阳方向穿越云层的步数(默认 16)。
   * 越多越精确,代价线性增加。范围 [1, 64]。
   */
  shadowSteps?: number;
  /**
   * 阴影强度 [0,1](默认 0.7)。
   * 0 = 无压暗,1 = 完全按透射率压暗。
   */
  shadowIntensity?: number;
  /**
   * 密度跳过阈值(默认 0.01)。
   * 低于此值的体素不计入光学深度,与 VolumetricCloudsPass.densityCutoff 一致。
   */
  densityCutoff?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/**
 * 体积云阴影 Pass。独立管理内部 FBO / 程序 / 全屏 VAO。
 *
 * 与 VolumetricClouds / VolumetricCloudsPass 配套使用:
 * ```ts
 * const clouds = new VolumetricClouds();
 * clouds.generateNoise(42);
 * const cloudPass = new VolumetricCloudsPass();
 * cloudPass.uploadNoise(gl, clouds.noiseData!, clouds.noiseResolution);
 *
 * const shadowPass = new CloudShadowPass();
 * // 每帧(场景渲染后、Tonemapping 前):
 * const u = clouds.getShaderUniforms();
 * const shadowed = shadowPass.apply(gl, sceneColorTex, depthTex, {
 *   noiseTexture:        cloudPass['_noiseTexture'],   // 复用同一 3D 纹理
 *   inverseViewProjection,
 *   sunDirection:        u.u_sunDirection,
 *   cloudHeight:         u.u_cloudHeight,
 *   cloudThickness:      u.u_cloudThickness,
 *   cloudCoverage:       u.u_cloudCoverage,
 *   cloudDensity:        u.u_cloudDensity,
 *   windOffset:          u.u_windOffset,
 *   worldScale:          cloudPass.worldScale,
 *   heightDensityBottom: u.u_heightDensityBottom,
 *   heightDensityTop:    u.u_heightDensityTop,
 * });
 * ```
 *
 * apply() 把云密度参数 + 3D 噪声纹理 + 太阳方向喂给
 * CLOUD_SHADOW_FRAG fragment shader,执行光线步进累积光学深度并
 * 把 Beer-Lambert 透射率作为阴影因子压暗场景颜色。输出为 RGBA8 颜色纹理
 * (本 Pass 持有)。
 */
export class CloudShadowPass {
  readonly name = 'cloudshadow';

  /** 沿太阳方向穿越云层的步数。范围 [1, 64]。 */
  shadowSteps: number;
  /** 阴影强度 [0,1]。0 = 无压暗,1 = 完全按透射率压暗。 */
  shadowIntensity: number;
  /** 密度跳过阈值。 */
  densityCutoff: number;
  /** 是否启用。 */
  enabled: boolean;

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

  constructor(opts: CloudShadowOptions = {}) {
    this.shadowSteps = opts.shadowSteps ?? 16;
    this.shadowIntensity = opts.shadowIntensity ?? 0.7;
    this.densityCutoff = opts.densityCutoff ?? 0.01;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用云阴影。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  场景颜色纹理(被压暗)
   * @param depthTexture  NDC 深度纹理(0..1)
   * @param params        云阴影参数(详见 CloudShadowParams)
   * @returns             压暗后的颜色纹理;禁用时返回输入
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    params: CloudShadowParams,
  ): WebGLTexture {
    if (!this.enabled) {
      return colorTexture;
    }

    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this._dirty || !this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getProgram(gl);
    prog.use();

    // 颜色纹理 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 深度纹理 → unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    // 3D 噪声纹理 → unit 2(复用 VolumetricCloudsPass 的纹理)
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, params.noiseTexture);
    prog.setUniformSampler('u_noiseMap', 2);

    // 相机变换
    prog.setUniformMatrix4fv('u_inverseViewProjection', params.inverseViewProjection);

    // 太阳方向
    const sun = params.sunDirection;
    prog.setUniform3f('u_sunDirection', sun[0], sun[1], sun[2]);

    // 云参数(与 VolumetricClouds 一致,保证阴影与天空云同步)
    prog.setUniform1f('u_cloudHeight', params.cloudHeight);
    prog.setUniform1f('u_cloudThickness', params.cloudThickness);
    prog.setUniform1f('u_cloudCoverage', params.cloudCoverage);
    prog.setUniform1f('u_cloudDensity', params.cloudDensity);

    const wind = params.windOffset;
    prog.setUniform3f('u_windOffset', wind[0], wind[1], wind[2]);

    prog.setUniform1f('u_worldScale', params.worldScale);
    prog.setUniform1f('u_heightDensityBottom', params.heightDensityBottom);
    prog.setUniform1f('u_heightDensityTop', params.heightDensityTop);

    // 阴影参数
    prog.setUniform1i('u_shadowSteps', this.shadowSteps);
    prog.setUniform1f('u_shadowIntensity', this.shadowIntensity);
    prog.setUniform1f('u_densityCutoff', this.densityCutoff);
    prog.setUniform1i('u_enabled', this.enabled ? 1 : 0);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建资源(分辨率变化/上下文丢失等)。 */
  setDirty(): void {
    this._dirty = true;
  }

  /** 释放 GPU 资源。可重复调用。 */
  dispose(gl?: WebGL2RenderingContext): void {
    if (gl) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._program) this._program.dispose();
    }
    this._outputTexture = null;
    this._fbo = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._program = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 释放旧资源(分辨率变化时)
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
    }

    // 输出纹理(场景颜色通常为 LDR,用 RGBA8;若上游 HDR 可改 RGBA16F)
    this._outputTexture = gl.createTexture();
    if (!this._outputTexture) throw new Error('CloudShadowPass: createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    this._fbo = gl.createFramebuffer();
    if (!this._fbo) throw new Error('CloudShadowPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 全屏四边形 VAO(2 个三角形覆盖 [-1,1]²,带 UV)
    if (!this._fullscreenQuadVao) {
      this._fullscreenQuadBuf = gl.createBuffer();
      this._fullscreenQuadVao = gl.createVertexArray();
      if (!this._fullscreenQuadVao || !this._fullscreenQuadBuf) {
        throw new Error('CloudShadowPass: createVertexArray/Buffer() returned null');
      }
      const verts = new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        1, 1, 1, 1,
        -1, -1, 0, 0,
        1, 1, 1, 1,
        -1, 1, 0, 1,
      ]);
      gl.bindVertexArray(this._fullscreenQuadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);
      gl.bindVertexArray(null);
    }

    this._width = w;
    this._height = h;
    this._initialized = true;
    log.debug(`init: ${w}×${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT, CLOUD_SHADOW_FRAG);
      log.info('CloudShadow program compiled');
    }
    return this._program;
  }
}

/** CloudShadowPass.apply() 的参数包。 */
export interface CloudShadowParams {
  /** 3D 噪声纹理(TEXTURE_3D,由 VolumetricCloudsPass.uploadNoise 创建)。 */
  noiseTexture: WebGLTexture;
  /** 逆视图投影矩阵(world ← NDC),Float32Array(长度 16,列主序)。 */
  inverseViewProjection: Float32Array;
  /** 太阳方向(归一化,指向太阳)。 */
  sunDirection: SunDirection;
  /** 云层底部高度(世界空间,与 VolumetricClouds.u_cloudHeight 一致)。 */
  cloudHeight: number;
  /** 云层厚度(世界空间,与 VolumetricClouds.u_cloudThickness 一致)。 */
  cloudThickness: number;
  /** 云覆盖度 [0,1]。 */
  cloudCoverage: number;
  /** 云密度倍率。 */
  cloudDensity: number;
  /** 风偏移(由 VolumetricClouds.update 累积)。 */
  windOffset: WindOffset;
  /** 世界→UVW 缩放(与 VolumetricCloudsPass.worldScale 一致)。 */
  worldScale: number;
  /** 底部密度衰减(与 VolumetricClouds.u_heightDensityBottom 一致)。 */
  heightDensityBottom: number;
  /** 顶部密度衰减(与 VolumetricClouds.u_heightDensityTop 一致)。 */
  heightDensityTop: number;
}
