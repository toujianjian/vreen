// SAOPass — Scalable Ambient Obscurance 后处理 Pass。
//
// 适配 three.js SAOPass.js + SAOShader.js (McGuire, Mara, Luebke 2012,
// "Scalable Ambient Obscurance")。提供比 GTAO 更快、稍低质量的 AO 方案,
// 适用于性能敏感场景(移动端 / VR / 大规模场景)。
//
// 算法核心:
//   1. 从深度 + 法线纹理重建视图空间位置/法线;
//   2. 在像素周围以螺旋模式采样 NUM_SAMPLES * NUM_RINGS 个点(默认 7*4=28);
//   3. 每个采样点计算遮蔽贡献:
//        occlusion = max(0, (dot(N, delta) - minRes) / scaledDist - bias)
//                               / (1 + scaledDist²)
//      其中 scaledDist = scale / cameraFar * dist
//   4. 平均所有采样点的遮蔽值,乘以 intensity;
//   5. 输出 AO 纹理(灰度,0=全遮蔽,1=无遮蔽)。
//
// 与 GTAO 的区别:
//   - SAO:采样点固定螺旋分布,28 个采样,每个采样 O(1) 计算;
//   - GTAO:4 方向地平线积分,每方向最多 32 步,精度更高但更慢;
//   - SAO 适合中低配,GTAO 适合高配。
//
// 参考:
//   - McGuire, Mara, Luebke, "Scalable Ambient Obscurance" (HPG 2012)
//   - three.js SAOPass.js + SAOShader.js
//   - McGuire, "The Scalable Ambient Obscurance Field" (GDC 2012)

import type { Camera } from '../../Cameras/Camera';
import { POST_VERT as POST_VERT_SRC, SAO_FRAG } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('SAOPass');

// ── 类型 ──────────────────────────────────────────────────────────

/** SAO 选项。 */
export interface SAOPassOptions {
  /** 采样半径(屏幕空间像素,默认 100)。 */
  kernelRadius?: number;
  /** AO 强度(默认 0.1,越大越暗)。 */
  intensity?: number;
  /** 偏移(默认 0.5,防止平坦表面产生 AO)。 */
  bias?: number;
  /** 缩放(默认 1.0,控制距离衰减)。 */
  scale?: number;
  /** 最小分辨率(默认 0.0,过滤非常近的采样)。 */
  minResolution?: number;
  /** 每环采样数(默认 7)。 */
  numSamples?: number;
  /** 环数(默认 4)。总采样数 = numSamples * numRings。 */
  numRings?: number;
  /** 随机种子(每帧变化以减少 banding,默认 0)。 */
  randomSeed?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

/** 纯函数 SAO 计算参数。 */
export interface SAOParams {
  kernelRadius: number;
  intensity: number;
  bias: number;
  scale: number;
  minResolution: number;
  numSamples: number;
  numRings: number;
  randomSeed: number;
}

/** 相机参数(纯函数用)。 */
export interface SAOCameraParams {
  near: number;
  far: number;
  /** 投影矩阵(列主序 4×4,16 个元素)。 */
  projectionMatrix: ArrayLike<number>;
  /** 投影矩阵逆(列主序 4×4,16 个元素)。 */
  inverseProjectionMatrix: ArrayLike<number>;
}

/** 视口尺寸 [width, height]。 */
export type ViewSize = [number, number];

/** RGB 颜色三元组。 */
export type SAOColor = [r: number, g: number, b: number];

// ── 纯 CPU 函数(与 GPU shader 1:1 对应) ──────────────────────────

/** 伪随机数 [0,1),基于 UV + seed。与 GLSL fract(sin(...)) 1:1 对应。 */
export function saoRand(uv: [number, number], seed: number = 0): number {
  const x = uv[0] * 12.9898 + uv[1] * 78.233 + seed * 37.719;
  // GLSL fract(x) = x - floor(x),始终返回 [0,1)。JS % 会保留被除数符号,故用 floor。
  const v = Math.sin(x) * 43758.5453;
  return v - Math.floor(v);
}

/** 透视相机 NDC 深度 → 视图空间 Z(正值,前方距离)。 */
export function perspectiveDepthToViewZ(
  depth: number,
  near: number,
  far: number,
): number {
  // perspectiveDepthToViewZ: viewZ = near * far / (far - depth * (far - near))
  const denom = far - depth * (far - near);
  if (Math.abs(denom) < 1e-10) return far;
  return (near * far) / denom;
}

/**
 * 从 UV + NDC 深度重建视图空间位置。
 *
 * 使用投影矩阵逆:ndc → clip → view。
 * 与 GTAO_FRAG 中的 reconstructViewPos() 一致。
 */
export function reconstructViewPos(
  uv: [number, number],
  depth: number,
  inverseProjectionMatrix: ArrayLike<number>,
): [number, number, number] {
  // NDC: uv * 2 - 1, depth * 2 - 1
  const ndcX = uv[0] * 2.0 - 1.0;
  const ndcY = uv[1] * 2.0 - 1.0;
  const ndcZ = depth * 2.0 - 1.0;

  // view = invProj * vec4(ndc, 1.0)
  // 列主序矩阵 m[col * 4 + row]
  const m = inverseProjectionMatrix;
  const vx = m[0] * ndcX + m[4] * ndcY + m[8] * ndcZ + m[12];
  const vy = m[1] * ndcX + m[5] * ndcY + m[9] * ndcZ + m[13];
  const vz = m[2] * ndcX + m[6] * ndcY + m[10] * ndcZ + m[14];
  const vw = m[3] * ndcX + m[7] * ndcY + m[11] * ndcZ + m[15];

  if (Math.abs(vw) < 1e-10) return [0, 0, -1];
  return [vx / vw, vy / vw, vz / vw];
}

/**
 * 计算单个采样点的遮蔽贡献。
 *
 * occlusion = max(0, (dot(N, delta) - minRes) / scaledDist - bias)
 *                          / (1 + scaledDist²)
 *
 * 其中:
 *   delta = samplePos - centerPos
 *   dist = |delta|
 *   scaledDist = (scale / cameraFar) * dist
 *
 * @returns 遮蔽值(≥ 0,越大越遮蔽)
 */
export function saoOcclusion(
  centerPos: [number, number, number],
  centerNormal: [number, number, number],
  samplePos: [number, number, number],
  scale: number,
  bias: number,
  minResolution: number,
  cameraFar: number,
): number {
  const dx = samplePos[0] - centerPos[0];
  const dy = samplePos[1] - centerPos[1];
  const dz = samplePos[2] - centerPos[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return 0;

  const scaledDist = (scale / cameraFar) * dist;
  const dotND = centerNormal[0] * dx + centerNormal[1] * dy + centerNormal[2] * dz;
  const minResScaled = minResolution * cameraFar;

  const numerator = dotND - minResScaled;
  const denom = scaledDist;
  if (denom < 1e-10) return 0;

  let occ = numerator / denom - bias;
  if (occ < 0) occ = 0;
  occ /= 1.0 + scaledDist * scaledDist;

  return occ;
}

/**
 * 计算螺旋采样 UV。
 *
 * 螺旋模式:角度从随机起点开始,每次增加 ANGLE_STEP = 2π * numRings / numSamples;
 * 半径线性增加:radius = kernelRadius * (i + 1) / numSamples / size。
 *
 * @param i           采样索引 [0, numSamples)
 * @param numSamples  每环采样数
 * @param numRings    环数
 * @param centerUV    中心像素 UV
 * @param kernelRadius 采样半径(像素)
 * @param size        视口尺寸 [w, h]
 * @param baseAngle   起始角度(随机)
 * @returns 采样 UV
 */
export function saoSpiralSampleUV(
  i: number,
  numSamples: number,
  numRings: number,
  centerUV: [number, number],
  kernelRadius: number,
  size: [number, number],
  baseAngle: number,
): [number, number] {
  const angleStep = (2 * Math.PI * numRings) / numSamples;
  const angle = baseAngle + i * angleStep;
  const radius = (kernelRadius * (i + 1)) / numSamples;
  const pixelOffsetX = Math.cos(angle) * radius;
  const pixelOffsetY = Math.sin(angle) * radius;
  return [
    centerUV[0] + pixelOffsetX / size[0],
    centerUV[1] + pixelOffsetY / size[1],
  ];
}

/**
 * 完整 SAO 计算(纯 CPU,与 GPU shader 1:1 对应)。
 *
 * @param centerUV       中心像素 UV
 * @param centerDepth    中心 NDC 深度 [0,1]
 * @param centerNormal   中心视图空间法线(归一化)
 * @param sampleDepth    回调:给定 UV 返回 NDC 深度
 * @param params         SAO 参数
 * @param camera         相机参数
 * @param size           视口尺寸
 * @returns AO 值 [0,1](0=无遮蔽,1=全遮蔽)
 */
export function computeSAO(
  centerUV: [number, number],
  centerDepth: number,
  centerNormal: [number, number, number],
  sampleDepth: (uv: [number, number]) => number,
  params: SAOParams,
  camera: SAOCameraParams,
  size: ViewSize,
): number {
  // 跳过天空盒
  if (centerDepth >= 1.0 - 1e-5) return 0;

  // 重建中心点视图空间位置
  const centerPos = reconstructViewPos(centerUV, centerDepth, camera.inverseProjectionMatrix);

  // 预计算常量
  const scaleDividedByCameraFar = params.scale / camera.far;
  const minResScaled = params.minResolution * camera.far;

  // 随机起始角度
  const baseAngle = saoRand(centerUV, params.randomSeed) * 2 * Math.PI;

  let occlusionSum = 0;
  let weightSum = 0;

  for (let i = 0; i < params.numSamples; i++) {
    const sampleUV = saoSpiralSampleUV(
      i,
      params.numSamples,
      params.numRings,
      centerUV,
      params.kernelRadius,
      size,
      baseAngle,
    );

    // 边界检查
    if (sampleUV[0] < 0 || sampleUV[0] > 1 || sampleUV[1] < 0 || sampleUV[1] > 1) continue;

    const sampleDepthVal = sampleDepth(sampleUV);

    // 跳过天空盒
    if (sampleDepthVal >= 1.0 - 1e-5) continue;

    // 重建采样点视图空间位置
    const samplePos = reconstructViewPos(sampleUV, sampleDepthVal, camera.inverseProjectionMatrix);

    // 计算遮蔽
    const dx = samplePos[0] - centerPos[0];
    const dy = samplePos[1] - centerPos[1];
    const dz = samplePos[2] - centerPos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-6) continue;

    const scaledDist = scaleDividedByCameraFar * dist;
    const dotND = centerNormal[0] * dx + centerNormal[1] * dy + centerNormal[2] * dz;

    let occ = (dotND - minResScaled) / scaledDist - params.bias;
    if (occ < 0) occ = 0;
    occ /= 1.0 + scaledDist * scaledDist;

    occlusionSum += occ;
    weightSum += 1;
  }

  if (weightSum === 0) return 0;
  return occlusionSum * (params.intensity / weightSum);
}

/** 默认 SAO 参数。 */
export const DEFAULT_SAO_PARAMS: SAOParams = {
  kernelRadius: 100,
  intensity: 0.1,
  bias: 0.5,
  scale: 1.0,
  minResolution: 0.0,
  numSamples: 7,
  numRings: 4,
  randomSeed: 0,
};

// ── GPU Pass ──────────────────────────────────────────────────────

/**
 * SAO Pass。独立管理内部 FBO 与程序。
 *
 * apply() 把 depth + normal 两张纹理 + 相机变换喂给 SAO fragment shader,
 * 输出 AO 纹理(灰度,0=全遮蔽,1=无遮蔽)。调用方拿到纹理后自行决定如何
 * 合成(典型做法:sceneColor *= ao)。
 */
export class SAOPass {
  readonly name = 'sao';

  /** 采样半径(屏幕空间像素)。 */
  kernelRadius: number = 100;
  /** AO 强度。 */
  intensity: number = 0.1;
  /** 偏移(防止平坦表面产生 AO)。 */
  bias: number = 0.5;
  /** 缩放(控制距离衰减)。 */
  scale: number = 1.0;
  /** 最小分辨率。 */
  minResolution: number = 0.0;
  /** 每环采样数。 */
  numSamples: number = 7;
  /** 环数。 */
  numRings: number = 4;
  /** 随机种子(每帧变化以减少 banding)。 */
  randomSeed: number = 0;
  /** 是否启用。 */
  enabled: boolean = true;

  /** 当前输出纹理(apply 后可用)。 */
  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;

  constructor(opts: SAOPassOptions = {}) {
    if (opts.kernelRadius !== undefined) this.kernelRadius = opts.kernelRadius;
    if (opts.intensity !== undefined) this.intensity = opts.intensity;
    if (opts.bias !== undefined) this.bias = opts.bias;
    if (opts.scale !== undefined) this.scale = opts.scale;
    if (opts.minResolution !== undefined) this.minResolution = opts.minResolution;
    if (opts.numSamples !== undefined) this.numSamples = opts.numSamples;
    if (opts.numRings !== undefined) this.numRings = opts.numRings;
    if (opts.randomSeed !== undefined) this.randomSeed = opts.randomSeed;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  /** 标记需要重新上传 uniforms(下一帧 apply 时刷新)。 */
  setDirty(): void {
    // uniforms 每帧都上传,所以这个方法是空操作(保持 API 一致)。
  }

  /**
   * 执行 SAO。
   *
   * @param gl             WebGL2 上下文
   * @param depthTexture   NDC 深度纹理(0..1)
   * @param normalTexture  世界空间法线纹理(RGBA16F,xyz)
   * @param camera         当前相机(读取 projectionMatrixInverse / matrixWorldInverse / near / far)
   * @returns              AO 输出纹理(本 Pass 持有,不要释放)
   */
  apply(
    gl: WebGL2RenderingContext,
    depthTexture: WebGLTexture,
    normalTexture: WebGLTexture,
    camera: Camera,
  ): WebGLTexture {
    const targetW = gl.canvas.width;
    const targetH = gl.canvas.height;
    if (!this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
    }

    // disabled 时仍返回输出纹理(避免下游 null 解引用),但不渲染
    if (!this.enabled) {
      return this._outputTexture as WebGLTexture;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);  // AO 默认 1(无遮蔽)
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this._getProgram(gl);
    prog.use();

    // 绑定纹理
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, normalTexture);
    prog.setUniformSampler('u_normalMap', 1);

    // 相机参数
    const cam = camera as Camera & { near?: number; far?: number };
    const near = cam.near ?? 0.1;
    const far = cam.far ?? 1000;

    prog.setUniformMatrix4fv('u_projectionInverse', camera.projectionMatrixInverse.elements as Float32Array);
    prog.setUniformMatrix4fv('u_viewMatrix', camera.matrixWorldInverse.elements as Float32Array);
    prog.setUniform2f('u_screenSize', this._width, this._height);
    prog.setUniform1f('u_cameraNear', near);
    prog.setUniform1f('u_cameraFar', far);

    // SAO 参数
    prog.setUniform1f('u_kernelRadius', this.kernelRadius);
    prog.setUniform1f('u_intensity', this.intensity);
    prog.setUniform1f('u_bias', this.bias);
    prog.setUniform1f('u_scale', this.scale);
    prog.setUniform1f('u_minResolution', this.minResolution);
    prog.setUniform1i('u_numSamples', this.numSamples);
    prog.setUniform1i('u_numRings', this.numRings);
    prog.setUniform1f('u_randomSeed', this.randomSeed);

    // 画全屏四边形
    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    return this._outputTexture as WebGLTexture;
  }

  /** 释放 GPU 资源。可在 dispose 后再次 apply(自动重建)。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._program) {
      this._program.dispose();
      this._program = null;
    }
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
    this._initialized = false;
    log.debug('SAOPass disposed');
  }

  // ── 内部 ────────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    // 先释放旧资源
    if (this._initialized) {
      this.dispose(gl);
    }

    this._width = w;
    this._height = h;

    // 输出纹理(RGBA8,AO 0..1)
    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // FBO
    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);

    // 全屏四边形 VAO
    this._fullscreenQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
    // 两个三角形:位置 (x,y) + UV (u,v)
    const verts = new Float32Array([
      // pos      uv
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
       1,  1,  1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this._fullscreenQuadVao = gl.createVertexArray();
    gl.bindVertexArray(this._fullscreenQuadVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._initialized = true;
    log.debug(`SAOPass initialized: ${w}x${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT_SRC, SAO_FRAG);
      // 预编译一次
      this._program.use();
    }
    return this._program;
  }
}
