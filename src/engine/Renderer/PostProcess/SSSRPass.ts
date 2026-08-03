// SSSRPass — 随机屏幕空间反射 (Stochastic Screen-Space Reflections)。
//
// 设计目标:
//   - 用 GGX 重要性采样生成每像素射线方向,产生物理正确的粗糙反射。
//   - 与 SSRPass 互补:SSRPass 用镜面反射 + 模糊近似粗糙(快但不物理);
//     SSSRPass 用 GGX NDF 重要性采样半向量 → reflect(-V, H) 得到射线方向,
//     粗糙度越大采样方向越分散,多帧时序累积收敛到正确模糊反射。
//   - 支持时序累积(velocity 重投影 + history 混合),消除单帧噪声。
//   - 独立管理内部 FBO + 程序,不继承 RenderPass(需要 GBuffer 多纹理)。
//
// 算法(Intel "Deferred Stochastic SSR" Stachowiak 2018):
//   1. 读 GBuffer:世界位置、世界法线、粗糙度、场景颜色
//   2. 跳过天空 / 过粗糙 / 背面
//   3. GGX 重要性采样:
//      α = roughness²,  φ = 2π·ξ₁,
//      cosθ = √((1-ξ₂)/(1+(α²-1)·ξ₂))   ← GGX NDF 逆 CDF
//      H = TBN·(sinθcosφ, sinθsinφ, cosθ)
//      rayDir = reflect(-viewDir, H)
//   4. 屏幕空间自适应步长射线步进 + 二分查找细化
//   5. 边缘衰减 + 距离衰减 + Fresnel(Schlick) + 粗糙度衰减
//   6. 时序累积:velocity 重投影历史帧反射,按 confidence 混合
//   7. 输出 RGB=反射色×强度×Fresnel,A=confidence
//
// 与 SSRPass 的对比:
//   | 特性               | SSRPass            | SSSRPass                    |
//   |-------------------|--------------------|-----------------------------|
//   | 射线方向           | 镜面 reflect(-V,N) | GGX 重要性采样 reflect(-V,H)|
//   | 粗糙反射           | H+V 高斯模糊(近似) | 随机采样 + 时序累积(物理)   |
//   | 时序累积           | ✗                  | ✓(velocity 重投影)         |
//   | Fresnel            | ✗                  | ✓(Schlick)                  |
//   | confidence alpha   | ✗                  | ✓(边缘/距离/粗糙度衰减)     |
//   | 物理正确性         | 模糊核固定,不物理  | GGX NDF 驱动,物理正确       |
//   | 性能               | 快(1 ray + blur)   | 慢(1 ray + temporal)        |
//   | 适用场景           | 镜面/低粗糙度      | 全粗糙度范围,尤其中等粗糙   |
//
// 不变量:
//   - dispose 后再调用 apply 会重新分配资源(懒重建);
//   - 内部纹理为 RGBA16F(HDR 反射需要负数 / >1 的值);
//   - history 纹理在首次 apply 时分配,每帧 ping-pong 交换;
//   - temporalWeight=0 时关闭时序累积(纯单帧 SSSR);
//   - 输出纹理所有权归 Pass,调用方不得释放。
//
// 参考:
//   - Intel "Deferred Stochastic Screen-Space Reflections" (Stachowiak 2018)
//   - UE5 "Stochastic SSR" (Karis 2014)
//   - o3de Atom "ScreenSpaceReflections" pass
//   - three.js SSRPass(本实现在其基础上增加 GGX 重要性采样 + 时序累积)

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, SSSR_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('SSSRPass');

export interface SSSRPassOptions {
  /** 射线最大步进次数(默认 64)。 */
  maxSteps?: number;
  /** 厚度容差,世界单位(默认 0.5)。 */
  thickness?: number;
  /** 降采样比例 0..1(默认 0.5)。1.0 = 全分辨率。 */
  resolution?: number;
  /** 反射强度 0..1+(默认 0.5)。 */
  reflectionStrength?: number;
  /** 粗糙度截止(默认 0.8,比 SSRPass 更宽以覆盖中等粗糙表面)。 */
  roughnessCutoff?: number;
  /** 粗糙度偏移(降低有效粗糙度,减少噪声。默认 0.0,Intel 建议 0.0~0.1)。 */
  roughnessBias?: number;
  /** 时序混合权重(0=不累积,0.9=强累积。默认 0.88)。 */
  temporalWeight?: number;
}

// ── CPU 侧 GGX 重要性采样(纯函数,可单元测试) ──────────────────
//
// 以下函数是 SSSR_FRAG 中 importanceSampleGGX 的 TypeScript 镜像,
// 供单元测试验证 GGX NDF 逆 CDF 数学正确性。GPU 着色器实现等价逻辑。

/** 3D 向量(纯数据,避免依赖 Vector3 以保持可独立测试)。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 点积。 */
function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** 叉积。 */
function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** 归一化。 */
function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * GGX 重要性采样:生成半向量 H(在法线半球内,服从 GGX NDF)。
 *
 * 这是 SSSR 的核心数学:给定两个均匀随机数 ξ₁, ξ₂ 和表面粗糙度,
 * 生成一个服从 GGX 法线分布函数的半向量。粗糙度越大,半向量越偏离
 * 法线(散射角越大),反射方向越分散 → 粗糙反射。
 *
 * 数学:
 *   α = roughness²               (GGX 使用 α² = roughness⁴ 作为分布参数)
 *   φ = 2π · ξ₁                  (方位角,均匀分布)
 *   cos²θ = (1-ξ₂) / (1+(α²-1)·ξ₂)   (天顶角,GGX NDF 逆 CDF)
 *   sinθ  = √(1-cos²θ)
 *   H_tangent = (sinθ·cosφ, sinθ·sinφ, cosθ)
 *   H_world   = T · H.x + B · H.y + N · H.z   (切线空间 → 世界空间)
 *
 * 边界情况:
 *   - roughness=0 → α=0,cosθ=1,H=N(纯镜面,采样方向=法线)
 *   - roughness=1 → α=1,cos²θ=1-ξ₂(均匀半球,完全漫反射)
 *   - ξ₂=0 → cosθ=1(H=N);ξ₂=1 → cosθ=1/α(最大散射角)
 *
 * @param xi        两个均匀随机数 [0,1)²
 * @param N         表面法线(世界空间,需归一化)
 * @param roughness 表面粗糙度 [0,1]
 * @returns          半向量 H(世界空间,归一化)
 */
export function importanceSampleGGX(xi: [number, number], N: Vec3, roughness: number): Vec3 {
  const a = roughness * roughness; // α = roughness²
  const phi = 2.0 * Math.PI * xi[0];
  // GGX NDF 逆 CDF:cos²θ = (1-ξ₂) / (1+(α²-1)·ξ₂)
  const cosTheta = Math.sqrt((1.0 - xi[1]) / (1.0 + (a * a - 1.0) * xi[1]));
  const sinTheta = Math.sqrt(Math.max(0.0, 1.0 - cosTheta * cosTheta));

  // 切线空间半向量
  const Ht: Vec3 = {
    x: sinTheta * Math.cos(phi),
    y: sinTheta * Math.sin(phi),
    z: cosTheta,
  };

  // 构建法线 N 为 z 轴的正交基 (T, B, N)
  const up: Vec3 = Math.abs(N.z) < 0.999 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const T = normalize3(cross3(up, N));
  const B = cross3(N, T);

  // 切线空间 → 世界空间
  return normalize3({
    x: T.x * Ht.x + B.x * Ht.y + N.x * Ht.z,
    y: T.y * Ht.x + B.y * Ht.y + N.y * Ht.z,
    z: T.z * Ht.x + B.z * Ht.y + N.z * Ht.z,
  });
}

/**
 * Schlick Fresnel 近似。
 *
 * @param cosTheta  入射角余弦(N·V);负值钳到 0(与着色器 max(dot,0) 一致)
 * @param F0        0° 反射率(默认 0.04 = 非金属)
 * @returns          Fresnel 反射率 [F0, 1]
 */
export function schlickFresnel(cosTheta: number, F0: number = 0.04): number {
  const c = Math.max(0.0, cosTheta);
  return F0 + (1.0 - F0) * Math.pow(1.0 - c, 5.0);
}

/**
 * 计算反射方向 reflect(-V, H)。
 * GLSL reflect(I, N) = I - 2·dot(I,N)·N;这里 I = -V, N = H。
 * 展开:reflect(-V, H) = -V - 2·dot(-V,H)·H = -V + 2·dot(V,H)·H
 */
export function reflectVec(V: Vec3, H: Vec3): Vec3 {
  const d = dot3(V, H);
  return {
    x: -V.x + 2.0 * d * H.x,
    y: -V.y + 2.0 * d * H.y,
    z: -V.z + 2.0 * d * H.z,
  };
}

// ── SSSRPass 类 ──────────────────────────────────────────────────

/**
 * 随机屏幕空间反射 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * apply() 接收 GBuffer 颜色/位置/法线/粗糙度纹理 + 相机,输出反射纹理
 * (RGBA = 反射色×强度×Fresnel, A = confidence)。可选传入 velocity 纹理
 * 启用时序累积。Pass 内部管理 history 纹理(ping-pong),每帧自动交换。
 *
 * 典型用法:
 *   const sssr = new SSSRPass({ resolution: 0.5, temporalWeight: 0.88 });
 *   // 每帧:
 *   const reflTex = sssr.apply(gl, colorTex, posTex, normTex, roughTex, camera, velTex);
 *   // 调用方按 reflTex 的 alpha(confidence)混合反射到场景颜色
 */
export class SSSRPass {
  readonly name = 'sssr';

  /** 射线最大步进次数(0..64,shader 上限 64)。 */
  maxSteps: number = 64;
  /** 厚度容差(世界单位)。值太小漏检;太大出现穿透伪反射。 */
  thickness: number = 0.5;
  /** 降采样比例(0..1)。1.0=全分辨率,0.5=半分辨率(默认推荐)。 */
  resolution: number = 0.5;
  /** 反射强度(0..1+,>1 需配合下游 ToneMappingPass)。 */
  reflectionStrength: number = 0.5;
  /** 粗糙度截止。roughness > cutoff 的像素跳过 SSSR(漫反射面)。 */
  roughnessCutoff: number = 0.8;
  /** 粗糙度偏移(降低有效粗糙度,减少噪声。Intel 建议 0.0~0.1)。 */
  roughnessBias: number = 0.0;
  /** 时序混合权重(0=不累积,0.9=强累积)。 */
  temporalWeight: number = 0.88;
  /** 帧计数(每 apply 自增,用于时序抖动)。 */
  frame: number = 0;

  /** SSSR 输出纹理(apply 后可用)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;

  /** 时序累积 history 纹理(ping-pong:读 _historyTex,写 _outputTexture)。 */
  private _historyTexture: WebGLTexture | null = null;
  private _historyFbo: WebGLFramebuffer | null = null;
  /** history 是否已分配(首次 apply 后 true)。 */
  private _historyInitialized: boolean = false;

  /** 全屏四边形 VAO。 */
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 当前内部缓冲尺寸(像素)。 */
  private _width: number = 0;
  private _height: number = 0;
  /** 是否已初始化。 */
  private _initialized: boolean = false;
  /** 标记下一帧需要重建(分辨率 / 尺寸变更)。 */
  private _dirty: boolean = true;

  constructor(opts: SSSRPassOptions = {}) {
    if (opts.maxSteps !== undefined) this.maxSteps = opts.maxSteps;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.resolution !== undefined) this.resolution = opts.resolution;
    if (opts.reflectionStrength !== undefined) this.reflectionStrength = opts.reflectionStrength;
    if (opts.roughnessCutoff !== undefined) this.roughnessCutoff = opts.roughnessCutoff;
    if (opts.roughnessBias !== undefined) this.roughnessBias = opts.roughnessBias;
    if (opts.temporalWeight !== undefined) this.temporalWeight = opts.temporalWeight;
  }

  /**
   * 执行随机屏幕空间反射(含可选时序累积)。
   *
   * @param gl                WebGL2 上下文
   * @param inputTexture      当前帧颜色纹理(反射源)
   * @param positionTexture   GBuffer 世界位置纹理(RGBA16F)
   * @param normalTexture     GBuffer 世界法线纹理(RGBA16F)
   * @param camera            当前相机(projection / view / position)
   * @param roughnessTexture  GBuffer 粗糙度纹理(R 通道 [0,1]);null=按镜面
   * @param velocityTexture   像素速度纹理(屏幕 UV 偏移);null=关闭时序累积
   * @returns                 SSSR 输出纹理(RGBA16F:RGB=反射色,A=confidence)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    positionTexture: WebGLTexture,
    normalTexture: WebGLTexture,
    camera: Camera,
    roughnessTexture: WebGLTexture | null = null,
    velocityTexture: WebGLTexture | null = null,
  ): WebGLTexture {
    const targetW = Math.max(1, Math.floor(gl.canvas.width * this.resolution));
    const targetH = Math.max(1, Math.floor(gl.canvas.height * this.resolution));

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    const useTemporal = this.temporalWeight > 0.0 && velocityTexture !== null && this._historyInitialized;

    // ── SSSR 主 pass ───────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    // 纹理绑定
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    prog.setUniformSampler('u_colorMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, positionTexture);
    prog.setUniformSampler('u_positionMap', 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, normalTexture);
    prog.setUniformSampler('u_normalMap', 2);

    if (roughnessTexture !== null) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, roughnessTexture);
      prog.setUniformSampler('u_roughnessMap', 3);
    }
    prog.setUniform1i('u_hasRoughness', roughnessTexture !== null ? 1 : 0);

    if (useTemporal) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this._historyTexture as WebGLTexture);
      prog.setUniformSampler('u_historyMap', 4);

      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, velocityTexture as WebGLTexture);
      prog.setUniformSampler('u_velocityMap', 5);
    }
    prog.setUniform1i('u_hasHistory', useTemporal ? 1 : 0);
    prog.setUniform1i('u_hasVelocity', velocityTexture !== null ? 1 : 0);

    // 相机参数
    const cam = camera as unknown as {
      projectionMatrix: { elements: Float32Array };
      matrixWorldInverse: { elements: Float32Array };
      position: { x: number; y: number; z: number };
    };
    prog.setUniformMatrix4fv('u_projection', cam.projectionMatrix.elements);
    prog.setUniformMatrix4fv('u_view', cam.matrixWorldInverse.elements);
    prog.setUniform3f('u_cameraPos', cam.position.x, cam.position.y, cam.position.z);

    // Pass 参数
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1i('u_maxSteps', this.maxSteps);
    prog.setUniform1f('u_thickness', this.thickness);
    prog.setUniform1f('u_reflectionStrength', this.reflectionStrength);
    prog.setUniform1f('u_roughnessCutoff', this.roughnessCutoff);
    prog.setUniform1f('u_roughnessBias', this.roughnessBias);
    prog.setUniform1f('u_temporalWeight', useTemporal ? this.temporalWeight : 0.0);
    prog.setUniform1f('u_frame', this.frame);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── 时序累积:把当前帧输出复制到 history(供下一帧使用) ────────
    if (this.temporalWeight > 0.0 && this._historyInitialized) {
      this._copyToHistory(gl);
    }

    this.frame++;
    return this._outputTexture as WebGLTexture;
  }

  /** 获取当前 history 纹理(供调试 / 外部时序管线使用)。 */
  getHistoryTexture(): WebGLTexture | null {
    return this._historyTexture;
  }

  /** 标记下一帧需要重建(分辨率变更等)。 */
  setDirty(): void {
    this._dirty = true;
  }

  /** 释放 GPU 资源。 */
  dispose(gl?: WebGL2RenderingContext): void {
    if (gl) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._historyTexture) gl.deleteTexture(this._historyTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._historyFbo) gl.deleteFramebuffer(this._historyFbo);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
    }
    this._outputTexture = null;
    this._historyTexture = null;
    this._fbo = null;
    this._historyFbo = null;
    this._program = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._initialized = false;
    this._historyInitialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, SSSR_FRAG);
      log.info('SSSR program compiled');
    }
    return this._program;
  }

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 释放旧资源(尺寸变更时)
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._historyTexture) gl.deleteTexture(this._historyTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._historyFbo) gl.deleteFramebuffer(this._historyFbo);
    }

    // 输出纹理(RGBA16F,HDR 反射)
    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);

    // History 纹理(时序累积用,ping-pong 的读端)
    this._historyTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._historyTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._historyFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._historyFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._historyTexture, 0);

    // 全屏四边形 VAO
    this._fullscreenQuadBuf = gl.createBuffer();
    this._fullscreenQuadVao = gl.createVertexArray();
    gl.bindVertexArray(this._fullscreenQuadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
    // 大三角形覆盖 [-1,1]²(3 顶点,比 2 三角形少 1 顶点)
    const verts = new Float32Array([
      -1, -1, 0, 0,
      3, -1, 0, 0,
      -1, 3, 0, 0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    this._width = w;
    this._height = h;
    this._initialized = true;
    this._historyInitialized = true;
    log.info(`SSSR resources allocated: ${w}x${h} (RGBA16F)`);
  }

  /**
   * 把当前帧的 _outputTexture 复制到 _historyTexture(供下一帧时序累积)。
   * 用 blit 或全屏 quad 拷贝。这里用最简单的 blit。
   */
  private _copyToHistory(gl: WebGL2RenderingContext): void {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._historyFbo);
    gl.blitFramebuffer(
      0, 0, this._width, this._height,
      0, 0, this._width, this._height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
}
