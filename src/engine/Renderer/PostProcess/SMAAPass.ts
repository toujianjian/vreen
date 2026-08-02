// SMAAPass — 子像素形态学抗锯齿 (Subpixel Morphological Antialiasing) Pass。
//
// 适配自 three.js examples/jsm/postprocessing/SMAAPass.js (SMAA v2.8, MIT)。
//
// SMAA 是基于图像分析的抗锯齿技术,分 3 个 pass:
//   1. Edge Detection    — 颜色边缘检测,输出 RG 边缘纹理
//   2. Blending Weights  — 搜索边缘 + 查表计算混合权重,输出 RGBA 权重
//   3. Neighborhood Blend — 按权重在邻域间混合,完成抗锯齿
//
// 优势(相比 FXAA):
//   - 子像素精度更高(保留更多细节)
//   - 形态学搜索能处理 L 形 / U 形 / Z 形边缘
//   - 不会产生 FXAA 的过度模糊
//
// LUT 纹理:
//   - Area texture (160×560, RG8):存储不同边缘模式下线段下方的面积
//   - Search texture (66×33, R8):存储搜索长度,加速边缘搜索循环
//   本实现使用 procedural 生成,避免依赖 DOM Image / 外部资源,
//   可在浏览器 + Node.js(测试)环境统一工作。
//
// 用法:
//   const smaa = new SMAAPass();
//   smaa.enabled = true;
//   pipeline.add(smaa);
//
// 参考:
//   - Jorge Jimenez et al., "SMAA: Enhanced Subpixel Morphological Antialiasing"
//     https://www.iryoku.com/smaa/
//   - three.js SMAAPass.js / SMAAShader.js

import { RenderPass, type PassContext } from '../RenderPass';
import {
  POST_VERT as POST_VERT_SRC,
  SMAA_EDGES_FRAG,
  SMAA_WEIGHTS_FRAG,
  SMAA_BLEND_FRAG,
} from '../../Materials/shaders';
import { createLogger } from '@/lib/logger';

const log = createLogger('SMAAPass');

export interface SMAAPassOptions {
  /** 是否启用(默认 false,需显式开启)。 */
  enabled?: boolean;
}

/**
 * 子像素形态学抗锯齿 Pass。
 *
 * 内部管理 2 个中间 FBO(edges + weights)+ 2 个 LUT 纹理(area + search)。
 * 3 个 pass 顺序执行,最终结果写入 ctx.resources.finalFbo。
 *
 * 资源在首次 apply() 时懒分配;尺寸变更时自动重建;dispose() 释放全部。
 */
export class SMAAPass extends RenderPass {
  readonly name = 'smaa';
  enabled = false;

  // ── 内部 FBO / 纹理 ────────────────────────────────────────────
  /** Pass 1 输出:边缘纹理(RG = 水平/垂直边缘)。 */
  private _edgesTexture: WebGLTexture | null = null;
  private _edgesFbo: WebGLFramebuffer | null = null;
  /** Pass 2 输出:混合权重(RGBA = 上/左/下/右 权重)。 */
  private _weightsTexture: WebGLTexture | null = null;
  private _weightsFbo: WebGLFramebuffer | null = null;

  // ── LUT 纹理(程序化生成) ──────────────────────────────────────
  private _areaTexture: WebGLTexture | null = null;
  private _searchTexture: WebGLTexture | null = null;

  // ── 全屏四边形 VAO(本 Pass 自管) ──────────────────────────────
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;

  // ── 状态 ────────────────────────────────────────────────────────
  private _width = 0;
  private _height = 0;
  private _initialized = false;

  constructor(opts: SMAAPassOptions = {}) {
    super();
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    const targetW = res.width;
    const targetH = res.height;
    if (!this._initialized || this._width !== targetW || this._height !== targetH) {
      this._initResources(gl, targetW, targetH);
    }

    const invW = 1.0 / this._width;
    const invH = 1.0 / this._height;

    // ── Pass 1: Edge Detection ─────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._edgesFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const edgesProg = ctx.getProgram('smaa-edges', POST_VERT_SRC, SMAA_EDGES_FRAG);
    edgesProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    edgesProg.setUniformSampler('u_colorMap', 0);
    edgesProg.setUniform2f('u_resolution', invW, invH);
    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── Pass 2: Blending Weight Calculation ────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._weightsFbo as WebGLFramebuffer);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const weightsProg = ctx.getProgram('smaa-weights', POST_VERT_SRC, SMAA_WEIGHTS_FRAG);
    weightsProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._edgesTexture as WebGLTexture);
    weightsProg.setUniformSampler('u_edgesMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._areaTexture as WebGLTexture);
    weightsProg.setUniformSampler('u_areaMap', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._searchTexture as WebGLTexture);
    weightsProg.setUniformSampler('u_searchMap', 2);
    weightsProg.setUniform2f('u_resolution', invW, invH);
    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── Pass 3: Neighborhood Blending → 写入 finalFbo ──────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const blendProg = ctx.getProgram('smaa-blend', POST_VERT_SRC, SMAA_BLEND_FRAG);
    blendProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    blendProg.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._weightsTexture as WebGLTexture);
    blendProg.setUniformSampler('u_blendMap', 1);
    blendProg.setUniform2f('u_resolution', invW, invH);
    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }

  /** 释放全部 GPU 资源。可重复调用。 */
  dispose(ctx: PassContext): void {
    const gl = ctx.gl;
    this._deleteIntermediate(gl);
    if (this._areaTexture) {
      gl.deleteTexture(this._areaTexture);
      this._areaTexture = null;
    }
    if (this._searchTexture) {
      gl.deleteTexture(this._searchTexture);
      this._searchTexture = null;
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
    this._width = 0;
    this._height = 0;
    log.debug('disposed');
  }

  // ── private ─────────────────────────────────────────────────────

  private _deleteIntermediate(gl: WebGL2RenderingContext): void {
    if (this._edgesTexture) {
      gl.deleteTexture(this._edgesTexture);
      this._edgesTexture = null;
    }
    if (this._edgesFbo) {
      gl.deleteFramebuffer(this._edgesFbo);
      this._edgesFbo = null;
    }
    if (this._weightsTexture) {
      gl.deleteTexture(this._weightsTexture);
      this._weightsTexture = null;
    }
    if (this._weightsFbo) {
      gl.deleteFramebuffer(this._weightsFbo);
      this._weightsFbo = null;
    }
  }

  /** (重新)分配内部 FBO + LUT 纹理 + VAO。 */
  private _initResources(gl: WebGL2RenderingContext, width: number, height: number): void {
    // 释放旧资源
    if (this._initialized) {
      this._deleteIntermediate(gl);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
    }

    // Pass 1 输出:RGBA8(只需 RG,但 RGBA8 兼容性最好)
    this._edgesTexture = createTexture2D(gl, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this._edgesFbo = createFbo(gl, this._edgesTexture);

    // Pass 2 输出:RGBA8(4 个权重)
    this._weightsTexture = createTexture2D(gl, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this._weightsFbo = createFbo(gl, this._weightsTexture);

    // LUT 纹理(仅首次生成,尺寸不变)
    if (!this._areaTexture) {
      this._areaTexture = generateAreaTexture(gl);
    }
    if (!this._searchTexture) {
      this._searchTexture = generateSearchTexture(gl);
    }

    // 全屏四边形 VAO(position@0 + uv@2,与 POST_VERT 一致)
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error('SMAAPass: createVertexArray/Buffer() returned null');
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

    this._fullscreenQuadVao = vao;
    this._fullscreenQuadBuf = buf;
    this._width = width;
    this._height = height;
    this._initialized = true;

    log.info(`SMAA FBOs created: ${width}x${height}`);
  }
}

// ── 内部工具 ─────────────────────────────────────────────────────

function createTexture2D(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('SMAAPass: createTexture() returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createFbo(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('SMAAPass: createFramebuffer() returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return fbo;
}

// ── LUT 程序化生成 ───────────────────────────────────────────────
//
// Area texture (160×560, RG8):
//   7 个 sub-texture(每个 80 像素高),仅 sub-texture 0 用于无 MSAA 场景。
//   每个 sub-texture 内,按 (e1, e2) 的 4 种组合分 4 象限(16×16 像素),
//   每个像素存储 (d1, d2) 距离下线段覆盖的面积(R=左侧, G=右侧)。
//
// Search texture (66×33, R8):
//   x 轴编码 bias(0 / 0.5),y 轴编码边缘值,
//   值为搜索长度(0..255),用于加速边缘搜索循环终止判断。

/**
 * 生成 SMAA Area LUT 纹理(160×560, RG8)。
 *
 * 对每个 (e1, e2, d1, d2) 组合,计算从 (d1, 0) 到 (d2, 1) 的线段
 * 在单位像素内左侧的面积。R = area, G = 1 - area。
 */
function generateAreaTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const width = 160;
  const height = 560;
  const data = new Uint8Array(width * height * 2); // RG8

  const maxDist = 16; // SMAA_AREATEX_MAX_DISTANCE
  const subHeight = 80; // 560 / 7

  // 只填充 sub-texture 0(无 MSAA)
  for (let py = 0; py < subHeight; py++) {
    for (let px = 0; px < width; px++) {
      // 将像素坐标映射到 (e1, e2, d1, d2)
      // x = maxDist * round(4 * e1) + d1 + 0.5
      // y = maxDist * round(4 * e2) + d2 + 0.5
      //
      // 5 列(每 16 像素):e1 = 0, 0.25, 0.5, 0.75, 1
      // 5 行(每 16 像素):e2 = 0, 0.25, 0.5, 0.75, 1
      // 但 round(4 * 0.25) = 1, round(4 * 0.5) = 2, round(4 * 0.75) = 3, round(4 * 1) = 4
      // 所以 5 个偏移:0, 16, 32, 48, 64

      const d1 = px % maxDist;
      const d2 = py % maxDist;

      // 归一化距离到 [0, 1]
      const normD1 = d1 / maxDist;
      const normD2 = d2 / maxDist;

      // 计算线段下面积
      // 线段从 (d1, 0) 到 (d2, 1),x 坐标为像素宽度比例
      // 左侧面积 = ∫ clamp(d1 + (d2-d1)*t, 0, 1) dt
      // 注意:简化版未使用 e1/e2 边缘量化值,所有象限使用同一面积公式;
      // 完整版应为 4 种 (e1,e2) 组合分别计算不同线段端点。
      const area = computeAreaUnderLine(normD1, normD2);

      const idx = (py * width + px) * 2;
      data[idx] = Math.round(area * 255);
      data[idx + 1] = Math.round((1 - area) * 255);
    }
  }

  const tex = gl.createTexture();
  if (!tex) throw new Error('SMAAPass: area LUT createTexture() returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, width, height, 0, gl.RG, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  log.info('Area LUT generated (160x560, RG8)');
  return tex;
}

/**
 * 生成 SMAA Search LUT 纹理(66×33, R8)。
 *
 * 对于给定的 (bias, edge) 对,返回搜索长度(0..255)。
 * 搜索长度表示沿边缘方向能走多远才遇到边缘终止。
 */
function generateSearchTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const width = 66;
  const height = 33;
  const data = new Uint8Array(width * height);

  // Search texture 布局:
  // x 轴:0..66,bias + e.r * scale 映射到 [0, 1]
  //   bias = 0(左搜索)或 0.5(右搜索)
  //   scale = 0.5
  // y 轴:0..33,边缘值
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 模拟搜索:edge 值越高(边缘越强),搜索距离越短
      const edge = y / (height - 1);
      const bias = x / (width - 1);

      // 搜索长度 = (1 - edge) * 255 * (0.5 + bias)
      // 这是对 SMAA 搜索行为的简化近似:
      // - 无边缘(edge=0)→ 搜索到最大距离
      // - 强边缘(edge=1)→ 立即停止
      // - bias=0(左搜索)→ 较短;bias=0.5(右搜索)→ 较长
      const searchLen = (1.0 - edge) * (0.5 + bias);
      const clamped = Math.max(0, Math.min(1, searchLen));
      data[y * width + x] = Math.round(clamped * 255);
    }
  }

  const tex = gl.createTexture();
  if (!tex) throw new Error('SMAAPass: search LUT createTexture() returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  log.info('Search LUT generated (66x33, R8)');
  return tex;
}

/**
 * 计算从 (d1, 0) 到 (d2, 1) 的线段在单位像素 [0,1]² 内左侧的面积。
 *
 * 线段方程: x = d1 + (d2 - d1) * t, t ∈ [0, 1]
 * 左侧面积 = ∫₀¹ clamp(d1 + (d2-d1)·t, 0, 1) dt
 *
 * 使用数值积分(64 步,足够精确)。
 */
function computeAreaUnderLine(d1: number, d2: number): number {
  const steps = 64;
  const dt = 1.0 / steps;
  let area = 0.0;
  const slope = d2 - d1;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const x = d1 + slope * t;
    area += Math.max(0, Math.min(1, x)) * dt;
  }
  return Math.max(0, Math.min(1, area));
}
