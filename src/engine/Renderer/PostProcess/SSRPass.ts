// SSRPass — 屏幕空间反射 (Screen-Space Reflection) 后处理 Pass。
//
// 设计目标:
//   - 基于 GBuffer 的世界位置 + 世界法线 + 颜色缓冲做屏幕空间射线步进,
//     产生低开销的反射效果(对金属 / 湿润表面 / 镜面物体尤为有效)。
//   - 不依赖 RenderPass.apply(input, ctx) 抽象,因为 SSR 需要额外的
//     position / normal 纹理,签名不同;本类独立管理内部 FBO + 程序。
//   - 支持 resolution 降采样(典型 0.5)以减轻 GPU 负担。
//   - 可选的粗糙反射空间降噪(blurEnabled):9-tap 可分离高斯模糊,
//     带逐像素粗糙度半径和法线边缘感知权重,运行 H+V 两遍产生 9×9 等效核。
//
// 流程:
//   1. apply() 首次调用时按 width * resolution × height * resolution
//      分配内部 FBO + RGBA16F 颜色纹理 + 编译 SSR 程序;
//   2. 绑定 FBO + 视口 → 画全屏四边形,fragment shader 读 input/position/
//      normal 三张纹理做 ray march + 二分查找 + 边缘衰减;
//   3. (可选)blurEnabled + roughnessTexture 提供时,运行 H+V 两遍
//      SSR_BLUR_FRAG,产生平滑的粗糙反射;
//   4. 输出纹理可被下游 pass 采样或合成回主颜色缓冲。
//
// 不变量:
//   - dispose 后再调用 apply 会重新分配资源(懒重建);
//   - setResolution() 修改降采样比例后,下一帧 apply 自动重建;
//   - 内部纹理为 RGBA16F(高动态范围场景反射需要负数 / >1 的值);
//   - blur 资源仅在 blurEnabled=true 且 apply() 收到 roughnessTexture 时分配;
//   - 输出纹理所有权归 Pass,调用方不得释放。
//
// 参考:
//   - EA SEED "Stable SSR" GDC 演讲
//   - McGuire & Mara "Efficient GPU Screen-Space Ray Tracing" (2014) §4.3
//   - three.js examples/jsm/postprocessing/SSRPass(本实现为简化版 + 扩展)

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, SSR_FRAG, SSR_BLUR_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('SSRPass');

export interface SSRPassOptions {
  /** 射线步进次数(默认 64)。 */
  maxSteps?: number;
  /** 厚度容差,世界单位(默认 0.5)。 */
  thickness?: number;
  /** 降采样比例 0..1(默认 0.5)。1.0 表示全分辨率。 */
  resolution?: number;
  /** 反射强度 0..1+(默认 0.5)。 */
  reflectionStrength?: number;
  /** 粗糙度截止(默认 0.6)。roughness > cutoff 的像素跳过 SSR(漫反射面)。 */
  roughnessCutoff?: number;
  /** 时序抖动幅度(默认 1.0,0=关闭)。配合 TAA 消除条带/痤疮。 */
  jitterScale?: number;
  /** 自适应步长增长因子(默认 0.5,线性增长)。1.0=每步翻倍。 */
  stepGrowth?: number;
  /** 是否启用粗糙反射空间降噪(默认 true)。需要 roughnessTexture 才会实际运行。 */
  blurEnabled?: boolean;
  /** 粗糙反射模糊最大半径(默认 4.0 texel)。粗糙面更模糊。 */
  blurRadiusScale?: number;
}

/**
 * 屏幕空间反射 Pass。独立管理内部 FBO 与程序,不继承 RenderPass。
 *
 * apply() 把 input + position + normal 三张纹理喂给 SSR fragment shader,
 * 输出到内部 FBO 的颜色纹理。当 blurEnabled=true 且提供 roughnessTexture 时,
 * 接着运行 H+V 两遍 SSR_BLUR_FRAG 产生平滑的粗糙反射。调用方拿到返回的
 * WebGLTexture 后自行决定如何合成回主颜色缓冲。
 */
export class SSRPass {
  readonly name = 'ssr';

  /** 射线步进次数(0..64,shader 上限 64)。 */
  maxSteps: number = 64;
  /** 厚度容差(世界单位)。值太小会漏检;太大会出现"穿透"伪反射。 */
  thickness: number = 0.5;
  /** 降采样比例(0..1)。1.0 = 全分辨率,0.5 = 半分辨率(默认推荐)。 */
  resolution: number = 0.5;
  /** 反射强度(0..1+,>1 会过亮,需配合下游 ToneMappingPass)。 */
  reflectionStrength: number = 0.5;
  /** 粗糙度截止。roughness > cutoff 的像素跳过 SSR(漫反射面)。 */
  roughnessCutoff: number = 0.6;
  /** 时序抖动幅度(0=关闭,1=默认)。配合 TAA 消除条带/痤疮。 */
  jitterScale: number = 1.0;
  /** 自适应步长增长因子(线性增长,0=匀速,1.0=每步翻倍)。 */
  stepGrowth: number = 0.5;
  /** 帧计数(每 apply 自增,用于时序抖动)。 */
  frame: number = 0;

  /** 是否启用粗糙反射空间降噪(默认 true)。需要 roughnessTexture 才会实际运行。 */
  blurEnabled: boolean = true;
  /** 粗糙反射模糊最大半径(texel 数,默认 4.0)。粗糙面更模糊。 */
  blurRadiusScale: number = 4.0;

  /** SSR 主 pass 输出纹理(apply 后可用)。 */
  private _ssrTexture: WebGLTexture | null = null;
  private _ssrFbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;

  /** 粗糙反射模糊资源(H pass 写 _blurTexH,V pass 写 _blurTexV = 最终输出)。 */
  private _blurTexH: WebGLTexture | null = null;
  private _blurFboH: WebGLFramebuffer | null = null;
  private _blurTexV: WebGLTexture | null = null;
  private _blurFboV: WebGLFramebuffer | null = null;
  private _blurProgram: ShaderProgram | null = null;
  /** 标记 blur 资源已分配(仅在 blurEnabled + roughnessTexture 时分配)。 */
  private _blurInitialized: boolean = false;

  /** 全屏四边形 VAO(本 Pass 自管,不依赖外部 ctx)。 */
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  /** 当前内部缓冲尺寸(像素)。 */
  private _width: number = 0;
  private _height: number = 0;
  /** 是否已初始化(SSR 主 pass 资源)。 */
  private _initialized: boolean = false;
  /** 标记下一帧需要重建(分辨率 / 尺寸变更)。 */
  private _dirty: boolean = true;

  constructor(opts: SSRPassOptions = {}) {
    if (opts.maxSteps !== undefined) this.maxSteps = opts.maxSteps;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.resolution !== undefined) this.resolution = opts.resolution;
    if (opts.reflectionStrength !== undefined) this.reflectionStrength = opts.reflectionStrength;
    if (opts.roughnessCutoff !== undefined) this.roughnessCutoff = opts.roughnessCutoff;
    if (opts.jitterScale !== undefined) this.jitterScale = opts.jitterScale;
    if (opts.stepGrowth !== undefined) this.stepGrowth = opts.stepGrowth;
    if (opts.blurEnabled !== undefined) this.blurEnabled = opts.blurEnabled;
    if (opts.blurRadiusScale !== undefined) this.blurRadiusScale = opts.blurRadiusScale;
  }

  /**
   * 执行 SSR(可选 + 粗糙反射空间降噪)。
   *
   * @param gl              WebGL2 上下文
   * @param inputTexture    当前帧颜色纹理
   * @param positionTexture GBuffer 世界位置纹理(RGBA16F)
   * @param normalTexture   GBuffer 世界法线纹理(RGBA16F)
   * @param camera          当前相机(读取 projection / view / position)
   * @param roughnessTexture 可选 GBuffer 粗糙度纹理(R 通道 [0,1]);null=按镜面处理
   * @returns               SSR 输出纹理(blur 启用时为 V-blurred 纹理;否则为 SSR 主纹理)
   */
  apply(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    positionTexture: WebGLTexture,
    normalTexture: WebGLTexture,
    camera: Camera,
    roughnessTexture: WebGLTexture | null = null,
  ): WebGLTexture {
    const targetW = Math.max(1, Math.floor(gl.canvas.width * this.resolution));
    const targetH = Math.max(1, Math.floor(gl.canvas.height * this.resolution));

    if (this._dirty || !this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
      this._dirty = false;
    }

    // 是否实际运行 blur(需要 blurEnabled + roughnessTexture)
    const runBlur = this.blurEnabled && roughnessTexture !== null;
    if (runBlur && !this._blurInitialized) {
      this._initBlurResources(gl, this._width, this._height);
    }

    // ── 1. SSR 主 pass ───────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._ssrFbo as WebGLFramebuffer);
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

    // 粗糙度纹理(可选):有则绑定 TEXTURE3 + u_hasRoughness=1;无则用颜色纹理占位 + 0
    gl.activeTexture(gl.TEXTURE3);
    if (roughnessTexture) {
      gl.bindTexture(gl.TEXTURE_2D, roughnessTexture);
      prog.setUniformSampler('u_roughnessMap', 3);
      prog.setUniform1i('u_hasRoughness', 1);
    } else {
      // 绑定一个有效纹理占位(避免采样未绑定纹理单元的 UB);hasRoughness=0 时不读取
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      prog.setUniformSampler('u_roughnessMap', 3);
      prog.setUniform1i('u_hasRoughness', 0);
    }

    prog.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    prog.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    prog.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    // GLSL ES 3.0 要求 int uniform 用 uniform1i;ShaderProgram 已封装。
    prog.setUniform1i('u_maxSteps', Math.max(0, Math.min(64, Math.floor(this.maxSteps))));
    prog.setUniform1f('u_thickness', this.thickness);
    prog.setUniform1f('u_reflectionStrength', this.reflectionStrength);
    prog.setUniform1f('u_roughnessCutoff', this.roughnessCutoff);
    prog.setUniform1f('u_jitterScale', this.jitterScale);
    prog.setUniform1f('u_stepGrowth', this.stepGrowth);
    prog.setUniform1f('u_frame', this.frame);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── 2. (可选)粗糙反射空间降噪 H + V ────────────────────────────
    let outputTexture = this._ssrTexture as WebGLTexture;
    if (runBlur && this._blurInitialized) {
      const blurProg = this._getBlurProgram(gl);
      blurProg.use();

      // 绑定共享纹理:normal + roughness 在 H/V 两遍中相同
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, normalTexture);
      blurProg.setUniformSampler('u_normalMap', 1);

      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, roughnessTexture as WebGLTexture);
      blurProg.setUniformSampler('u_roughnessMap', 3);
      blurProg.setUniform1i('u_hasRoughness', 1);

      blurProg.setUniform2f('u_screenSize', this._width, this._height);
      blurProg.setUniform1f('u_blurRadiusScale', this.blurRadiusScale);
      blurProg.setUniform1f('u_roughnessCutoff', this.roughnessCutoff);

      // H pass: input = SSR 主纹理 → output = _blurTexH
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._blurFboH as WebGLFramebuffer);
      gl.viewport(0, 0, this._width, this._height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._ssrTexture as WebGLTexture);
      blurProg.setUniformSampler('u_colorMap', 0);
      blurProg.setUniform2f('u_blurDir', 1.0, 0.0); // H

      gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // V pass: input = _blurTexH → output = _blurTexV (最终)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._blurFboV as WebGLFramebuffer);
      gl.viewport(0, 0, this._width, this._height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._blurTexH as WebGLTexture);
      blurProg.setUniformSampler('u_colorMap', 0);
      blurProg.setUniform2f('u_blurDir', 0.0, 1.0); // V

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      outputTexture = this._blurTexV as WebGLTexture;
    }

    // 还原默认 FBO + 视口(避免影响后续渲染)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // 帧计数自增(时序抖动)
    this.frame += 1;

    return outputTexture;
  }

  /** 设置降采样比例(0..1)。值变更后下一帧 apply 自动重建。 */
  setResolution(scale: number): void {
    const clamped = Math.max(0.05, Math.min(1.0, scale));
    if (Math.abs(clamped - this.resolution) > 1e-6) {
      this.resolution = clamped;
      this._dirty = true;
    }
  }

  /** 释放内部 FBO / 纹理 / VAO / program(SSR 主 + blur)。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._ssrTexture) {
      gl.deleteTexture(this._ssrTexture);
      this._ssrTexture = null;
    }
    if (this._ssrFbo) {
      gl.deleteFramebuffer(this._ssrFbo);
      this._ssrFbo = null;
    }
    this._disposeBlur(gl);
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
    this._program = new ShaderProgram(gl, POST_VERT_SRC, SSR_FRAG);
    log.info(`SSR program compiled (maxSteps=${this.maxSteps})`);
    return this._program;
  }

  private _getBlurProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (this._blurProgram) return this._blurProgram;
    this._blurProgram = new ShaderProgram(gl, POST_VERT_SRC, SSR_BLUR_FRAG);
    log.info('SSR blur program compiled (9-tap separable Gaussian, edge-aware)');
    return this._blurProgram;
  }

  /** (重新)分配 SSR 主 pass FBO + 纹理 + 全屏四边形 VAO。 */
  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    // 释放旧 SSR 资源(blur 资源也会一并重建以匹配新尺寸)
    if (this._initialized) {
      if (this._ssrTexture) gl.deleteTexture(this._ssrTexture);
      if (this._ssrFbo) gl.deleteFramebuffer(this._ssrFbo);
    }
    this._disposeBlur(gl);
    if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
    if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);

    // RGBA16F 输出纹理(反射可能 > 1.0,需浮点)
    const tex = gl.createTexture();
    if (!tex) throw new Error('SSRPass: createTexture() returned null');
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

    // FBO
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('SSRPass: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // 全屏四边形 VAO(position@0 + uv@2,与 POST_VERT 一致)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('SSRPass: createVertexArray/Buffer() returned null');
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

    this._ssrTexture = tex;
    this._ssrFbo = fbo;
    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`SSR FBO created: ${width}x${height} (resolution=${this.resolution})`);
  }

  /** 分配 blur 资源(H + V 两个 FBO + 纹理)。 */
  private _initBlurResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    this._disposeBlur(gl);

    // H blur 输出
    const texH = this._createHalfFloatTexture(gl, width, height);
    const fboH = gl.createFramebuffer();
    if (!fboH) throw new Error('SSRPass: blur H createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboH);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texH, 0);

    // V blur 输出(最终输出)
    const texV = this._createHalfFloatTexture(gl, width, height);
    const fboV = gl.createFramebuffer();
    if (!fboV) throw new Error('SSRPass: blur V createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboV);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texV, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._blurTexH = texH;
    this._blurFboH = fboH;
    this._blurTexV = texV;
    this._blurFboV = fboV;
    this._blurInitialized = true;

    log.info(`SSR blur FBOs created: ${width}x${height} (H+V, 9-tap Gaussian)`);
  }

  /** 创建一个 RGBA16F 纹理(LINEAR 过滤 + CLAMP_TO_EDGE 包裹)。 */
  private _createHalfFloatTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
    const tex = gl.createTexture();
    if (!tex) throw new Error('SSRPass: blur createTexture() returned null');
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
    return tex;
  }

  /** 释放 blur 资源(H + V 纹理 + FBO + program)。 */
  private _disposeBlur(gl: WebGL2RenderingContext): void {
    if (this._blurTexH) { gl.deleteTexture(this._blurTexH); this._blurTexH = null; }
    if (this._blurFboH) { gl.deleteFramebuffer(this._blurFboH); this._blurFboH = null; }
    if (this._blurTexV) { gl.deleteTexture(this._blurTexV); this._blurTexV = null; }
    if (this._blurFboV) { gl.deleteFramebuffer(this._blurFboV); this._blurFboV = null; }
    if (this._blurProgram) { this._blurProgram.dispose(); this._blurProgram = null; }
    this._blurInitialized = false;
  }
}
