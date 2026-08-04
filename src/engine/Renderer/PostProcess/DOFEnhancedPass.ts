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

// ── 类型 ──────────────────────────────────────────────────────────

/** DOF 选项(同时用于 GPU Pass 与 CPU 纯函数)。 */
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

/** 纯函数 DOF 计算参数(与 GPU shader uniforms 1:1 对应)。 */
export interface DOFParams {
  focusDistance: number;
  focusRange: number;
  /** 0=circle, 1=hexagon, 2=octagon。 */
  bokehShape: number;
  bokehSize: number;
  maxRadius: number;
}

/** 相机参数(纯函数用,仅需投影矩阵逆)。 */
export interface DOFCameraParams {
  near: number;
  far: number;
  /** 投影矩阵逆(列主序 4×4,16 个元素)。 */
  inverseProjectionMatrix: ArrayLike<number>;
}

/** RGB 颜色三元组。 */
export type DOFColor = [r: number, g: number, b: number];

/** 散景采样数(与 GPU shader const int SAMPLES = 16 一致)。 */
export const DOF_SAMPLES = 16;

/** 默认 DOF 参数。 */
export const DEFAULT_DOF_PARAMS: DOFParams = {
  focusDistance: 10.0,
  focusRange: 5.0,
  bokehShape: 0,
  bokehSize: 16.0,
  maxRadius: 32.0,
};

// ── 纯 CPU 函数(与 GPU shader 1:1 对应) ──────────────────────────

/**
 * 从 UV + NDC 深度重建视图空间位置。
 *
 * 与 DOF_ENHANCED_FRAG 中的 reconstructViewPos() 1:1 对应:
 *   ndc = (uv*2-1, depth*2-1, 1)
 *   view = inverseProjection * ndc
 *   return view.xyz / view.w
 *
 * @param uv                      屏幕空间 UV [0,1]²
 * @param depth                   NDC 深度 [0,1]
 * @param inverseProjectionMatrix 投影矩阵逆(列主序 4×4)
 * @returns                       视图空间位置 [x, y, z]
 */
export function dofReconstructViewPos(
  uv: [number, number],
  depth: number,
  inverseProjectionMatrix: ArrayLike<number>,
): [number, number, number] {
  const ndcX = uv[0] * 2.0 - 1.0;
  const ndcY = uv[1] * 2.0 - 1.0;
  const ndcZ = depth * 2.0 - 1.0;

  const m = inverseProjectionMatrix;
  // 列主序: m[col*4 + row]
  const vx = m[0] * ndcX + m[4] * ndcY + m[8] * ndcZ + m[12];
  const vy = m[1] * ndcX + m[5] * ndcY + m[9] * ndcZ + m[13];
  const vz = m[2] * ndcX + m[6] * ndcY + m[10] * ndcZ + m[14];
  const vw = m[3] * ndcX + m[7] * ndcY + m[11] * ndcZ + m[15];

  if (Math.abs(vw) < 1e-10) return [0, 0, 0];
  const invW = 1.0 / vw;
  return [vx * invW, vy * invW, vz * invW];
}

/**
 * 散景形状权重:返回 1.0(在形状内) 或 0.0(形状外)。
 *
 * 与 DOF_ENHANCED_FRAG 中的 bokehWeight() 1:1 对应。
 * offset 为单位方向向量(|offset|<=1)。
 *
 * @param offset 方向向量
 * @param shape  0=circle, 1=hexagon, 2=octagon
 * @returns      1.0 = 在形状内, 0.0 = 在形状外
 */
export function dofBokehWeight(
  offset: [number, number],
  shape: number,
): number {
  const r = Math.hypot(offset[0], offset[1]);
  if (r < 1e-4) return 1.0;

  if (shape === 1) {
    // 六边形: 6 条边的菱形近似
    const a = Math.atan2(offset[1], offset[0]);
    const d = 0.8660254 * Math.abs(Math.cos(a)) + 0.5 * Math.abs(Math.sin(a));
    return r * d <= 0.8660254 ? 1.0 : 0.0;
  } else if (shape === 2) {
    // 八边形: max(|cos|,|sin|) 近似
    const a = Math.atan2(offset[1], offset[0]);
    const d = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    return r * d <= 0.9238795 ? 1.0 : 0.0;
  }
  // 圆形(默认)
  return r <= 1.0 ? 1.0 : 0.0;
}

/**
 * 计算 Circle of Confusion (CoC) 归一化值 [0,1]。
 *
 * CoC = clamp(|dist - focusDistance| / focusRange, 0, 1)
 * 0 = 在焦点范围内(清晰),1 = 完全模糊。
 *
 * @param dist           视图空间距离(正值,前方)
 * @param focusDistance  焦点距离
 * @param focusRange     焦点范围
 * @returns              CoC 归一化值 [0,1]
 */
export function computeCoC(
  dist: number,
  focusDistance: number,
  focusRange: number,
): number {
  const range = Math.max(focusRange, 1e-4);
  const coc = Math.abs(dist - focusDistance) / range;
  return coc > 1.0 ? 1.0 : (coc < 0.0 ? 0.0 : coc);
}

/**
 * 计算散景采样半径(像素)。
 *
 * radius = min(coc * bokehSize, maxRadius)
 * 与 GPU shader 一致。
 */
export function dofBokehRadius(
  coc: number,
  bokehSize: number,
  maxRadius: number,
): number {
  const r = coc * bokehSize;
  return r > maxRadius ? maxRadius : r;
}

/**
 * 双线性采样 RGBA 颜色缓冲(Float32Array,行主序)。
 *
 * @param buffer  颜色缓冲 [r,g,b,r,g,b,...] 或 [r,g,b,a,...]
 * @param width   缓冲宽度
 * @param height  缓冲高度
 * @param u       U 坐标 [0,1]
 * @param v       V 坐标 [0,1] (注意:V=0 对应缓冲顶部)
 * @param stride  每像素通道数(3=RGB, 4=RGBA,默认 4)
 * @returns       [r, g, b]
 */
export function dofSampleColor(
  buffer: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
  stride: number = 4,
): DOFColor {
  // clamp UV 到 [0,1]
  const cu = u < 0 ? 0 : (u > 1 ? 1 : u);
  const cv = v < 0 ? 0 : (v > 1 ? 1 : v);

  // 双线性插值
  const fx = cu * (width - 1);
  const fy = cv * (height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = (y0 * width + x0) * stride;
  const i10 = (y0 * width + x1) * stride;
  const i01 = (y1 * width + x0) * stride;
  const i11 = (y1 * width + x1) * stride;

  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;

  return [
    buffer[i00] * w00 + buffer[i10] * w10 + buffer[i01] * w01 + buffer[i11] * w11,
    buffer[i00 + 1] * w00 + buffer[i10 + 1] * w10 + buffer[i01 + 1] * w01 + buffer[i11 + 1] * w11,
    buffer[i00 + 2] * w00 + buffer[i10 + 2] * w10 + buffer[i01 + 2] * w01 + buffer[i11 + 2] * w11,
  ];
}

/**
 * 对单个像素应用 DOF。
 *
 * 与 DOF_ENHANCED_FRAG main() 1:1 对应:
 *   1. 读取中心像素颜色 + 深度
 *   2. 跳过天空盒(depth >= 0.99999)
 *   3. 重建视图空间位置,计算距离
 *   4. 计算 CoC → 散景半径
 *   5. 半径 < 0.5 → 返回原色(清晰)
 *   6. 16 个方向采样,按散景形状加权
 *   7. mix(centerColor, blurredColor, coc)
 *
 * @param colorBuffer  颜色缓冲(RGBA Float32Array)
 * @param depthBuffer  深度缓冲(Float32Array,行主序)
 * @param width        缓冲宽度
 * @param height       缓冲高度
 * @param x            像素 X 坐标
 * @param y            像素 Y 坐标
 * @param params       DOF 参数
 * @param camera       相机参数(含投影矩阵逆)
 * @param stride       颜色缓冲每像素通道数(默认 4)
 * @returns            DOF 后的颜色 [r, g, b]
 */
export function dofPixel(
  colorBuffer: Float32Array,
  depthBuffer: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  params: DOFParams,
  camera: DOFCameraParams,
  stride: number = 4,
): DOFColor {
  const idx = (y * width + x) * stride;
  const centerColor: DOFColor = [
    colorBuffer[idx],
    colorBuffer[idx + 1],
    colorBuffer[idx + 2],
  ];

  const depth = depthBuffer[y * width + x];

  // 天空盒 / 无深度 → 直通
  if (depth >= 0.99999) {
    return centerColor;
  }

  // 重建视图空间位置
  const u = (x + 0.5) / width;
  const v = (y + 0.5) / height;
  const viewPos = dofReconstructViewPos([u, v], depth, camera.inverseProjectionMatrix);
  const dist = -viewPos[2]; // 视图空间 Z(正值=前方)

  // Circle of Confusion
  const coc = computeCoC(dist, params.focusDistance, params.focusRange);
  const radius = dofBokehRadius(coc, params.bokehSize, params.maxRadius);

  // 半径太小 → 跳过(像素清晰)
  if (radius < 0.5) {
    return centerColor;
  }

  // 16 方向散景采样
  const texelU = 1.0 / width;
  const texelV = 1.0 / height;
  let r = 0, g = 0, b = 0;
  let totalWeight = 0.0;

  const shape = Math.max(0, Math.min(2, Math.floor(params.bokehShape)));

  for (let i = 0; i < DOF_SAMPLES; i++) {
    const angle = 6.2831853 * (i + 0.5) / DOF_SAMPLES;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const w = dofBokehWeight([dirX, dirY], shape);

    if (w <= 0) continue;

    const offsetU = dirX * radius * texelU;
    const offsetV = dirY * radius * texelV;
    const sColor = dofSampleColor(colorBuffer, width, height, u + offsetU, v + offsetV, stride);

    r += sColor[0] * w;
    g += sColor[1] * w;
    b += sColor[2] * w;
    totalWeight += w;
  }

  const invW = 1.0 / Math.max(totalWeight, 1e-6);
  const blurred: DOFColor = [r * invW, g * invW, b * invW];

  // mix(center, blurred, coc)
  return [
    centerColor[0] + (blurred[0] - centerColor[0]) * coc,
    centerColor[1] + (blurred[1] - centerColor[1]) * coc,
    centerColor[2] + (blurred[2] - centerColor[2]) * coc,
  ];
}

/**
 * 对整个颜色缓冲应用 DOF(纯 CPU 参考实现)。
 *
 * 遍历每个像素,调用 dofPixel()。用于:
 *   1. 验证 GPU shader 的正确性(参考实现);
 *   2. 离线 / 无头环境渲染;
 *   3. 单元测试数值行为。
 *
 * @param colorBuffer  颜色缓冲(RGBA Float32Array,会被原地修改)
 * @param depthBuffer  深度缓冲(Float32Array)
 * @param width        缓冲宽度
 * @param height       缓冲高度
 * @param params       DOF 参数
 * @param camera       相机参数
 * @param stride       颜色缓冲每像素通道数(默认 4)
 * @returns            传入的 colorBuffer(原地修改)
 */
export function computeDOF(
  colorBuffer: Float32Array,
  depthBuffer: Float32Array,
  width: number,
  height: number,
  params: DOFParams,
  camera: DOFCameraParams,
  stride: number = 4,
): Float32Array {
  const out = new Float32Array(colorBuffer.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = dofPixel(colorBuffer, depthBuffer, width, height, x, y, params, camera, stride);
      const idx = (y * width + x) * stride;
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      if (stride >= 4) out[idx + 3] = colorBuffer[idx + 3];
    }
  }
  // 拷回原缓冲
  colorBuffer.set(out);
  return colorBuffer;
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
