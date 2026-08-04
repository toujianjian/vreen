// ScreenSpaceDecalPass — 屏幕空间延迟贴花 Pass。
//
// 把贴花纹理投射到 GBuffer 描述的任意几何表面。与 DecalGeometry(CPU 几何式,
// 每张贴花一个 mesh)互补:本 pass 在屏幕空间工作,单次全屏 draw 即覆盖任意
// 凹凸表面,且按表面法线自动剔除跨墙渗漏。
//
// 算法 (UE5 Deferred Decals / o3de Atom Decal 简化版):
//   1. 读取屏幕 UV 处的线性深度,用 viewProjInv 重建世界位置
//   2. 用 decalMatrix(世界→贴花局部)把世界位置变换到贴花盒局部空间
//   3. 体积剔除:局部坐标超出 [-0.5, 0.5]³ → 跳过(贴花盒外)
//   4. 角度剔除:dot(表面法线, 贴花法线) < threshold → 跳过(防止跨墙渗漏)
//   5. 贴花 UV = local.xy + 0.5,采样贴花纹理
//   6. 边缘淡化 smoothstep(0.5, 0.45, maxComp) 避免硬边
//   7. 4 种混合:Alpha 混合 / 乘法 / 加法 / 正常覆盖
//
// 多贴花支持:内部 ping-pong 双缓冲,连续 apply() 自动交替输出纹理,
// 避免读写同一纹理的反馈循环。调用方只需链式 apply:
//   let color = sceneColor;
//   for (const decal of decals) color = pass.apply(gl, color, depth, normal, decal, ...);
//
// 性能:单 pass,4 次纹理采样(颜色/深度/法线/贴花)+ 1 次矩阵变换。
// 适合在不透明几何渲染后、Tonemapping 之前应用。
//
// 参考:
//   - UE5: Deferred Decals (DBuffer decals)
//   - o3de Atom: Decal pass / DecalComponent
//   - three.js: examples/jsm/geometries/DecalGeometry.js (CPU 几何式,本 pass 为其屏幕空间泛化)

import { DECAL_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('ScreenSpaceDecalPass');

/** 贴花混合模式。 */
export enum DecalBlendMode {
  /** Alpha 混合(最常用:弹孔/血迹/涂鸦)。result = mix(scene, decal, decal.a)。 */
  Alpha = 0,
  /** 乘法(苔藓/潮湿/阴影贴花)。result = scene * mix(white, decal, decal.a)。 */
  Multiply = 1,
  /** 加法(发光涂鸦/霓虹标记)。result = scene + decal.rgb * decal.a。 */
  Additive = 2,
  /** 正常覆盖(替换背景,贴花完全不透明时使用)。 */
  Normal = 3,
}

/** 单张贴花的运行时数据(调用方每帧填充并传入 apply)。 */
export interface Decal {
  /** 贴花纹理(已上传到 GL)。 */
  texture: WebGLTexture;
  /**
   * 世界→贴花局部矩阵(4×4,列主序)。
   * 使贴花盒 [-0.5, 0.5]³ 覆盖目标区域;通常 = inverse(decalWorldMatrix),
   * 其中 decalWorldMatrix = T(position) * R(orientation) * S(size)。
   * 调用方可由 buildDecalMatrix() 辅助构造。
   */
  decalMatrix: Float32Array | number[];
  /**
   * 贴花 +Z 方向(视空间,单位向量,用于角度剔除)。
   * 由世界法线 × viewMatrix 旋转部分得到;调用方可由 transformNormalToView() 辅助。
   */
  decalNormalView: [x: number, y: number, z: number];
  /** 混合模式(默认 Alpha)。 */
  blendMode?: DecalBlendMode;
  /** 整体不透明度(0..1,默认 1)。 */
  opacity?: number;
  /**
   * 法线夹角余弦阈值(默认 0.5 ≈ 60°)。
   * dot(表面法线, 贴花法线) < threshold 的像素不贴花,防止跨墙渗漏。
   * 0 = 不剔除(任意角度都贴);1 = 仅完全平行时贴。
   */
  angleThreshold?: number;
}

export interface ScreenSpaceDecalOptions {
  /** 默认混合模式(单张贴花未指定时用此值,默认 Alpha)。 */
  defaultBlendMode?: DecalBlendMode;
  /** 默认不透明度(默认 1)。 */
  defaultOpacity?: number;
  /** 默认角度阈值(默认 0.5 ≈ 60°)。 */
  defaultAngleThreshold?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

// ════════════════════════════════════════════════════════════════════
//  CPU 纯函数(与 GLSL 1:1 对应,可独立测试)
// ════════════════════════════════════════════════════════════════════

/**
 * 把世界位置变换到贴花局部空间(对应 GLSL `u_decalMatrix * vec4(worldPos, 1.0)`)。
 *
 * @param worldPos     世界坐标 [x, y, z]
 * @param decalMatrix  世界→贴花局部 4×4 矩阵(列主序,16 个数)
 * @returns            局部坐标 + 是否在 [-0.5, 0.5]³ 贴花盒内
 */
export function projectToDecalLocal(
  worldPos: [number, number, number],
  decalMatrix: Float32Array | number[],
): { x: number; y: number; z: number; inside: boolean } {
  const m = decalMatrix;
  const px = worldPos[0], py = worldPos[1], pz = worldPos[2];
  // 列主序:matrix * (px,py,pz,1)
  const x = m[0] * px + m[4] * py + m[8] * pz + m[12];
  const y = m[1] * px + m[5] * py + m[9] * pz + m[13];
  const z = m[2] * px + m[6] * py + m[10] * pz + m[14];
  const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
  const iw = w !== 0 ? 1 / w : 1;
  const lx = x * iw, ly = y * iw, lz = z * iw;
  const inside =
    Math.abs(lx) <= 0.5 && Math.abs(ly) <= 0.5 && Math.abs(lz) <= 0.5;
  return { x: lx, y: ly, z: lz, inside };
}

/**
 * 角度剔除判定(对应 GLSL `dot(normal, decalNormal) < threshold`)。
 *
 * @param surfaceNormal  表面法线(视空间,单位向量)
 * @param decalNormal    贴花法线(视空间,单位向量)
 * @param threshold      余弦阈值(0..1)
 * @returns              true = 通过(应贴花),false = 拒绝(角度过大)
 */
export function decalAnglePass(
  surfaceNormal: [number, number, number],
  decalNormal: [number, number, number],
  threshold: number,
): boolean {
  const dot =
    surfaceNormal[0] * decalNormal[0] +
    surfaceNormal[1] * decalNormal[1] +
    surfaceNormal[2] * decalNormal[2];
  return dot >= threshold;
}

/**
 * 边缘淡化因子(对应 GLSL `smoothstep(0.5, 0.45, maxComp)`)。
 * maxComp 越接近 0.5(贴花盒边缘)→ 淡化越强;越接近 0(中心)→ 不淡化。
 *
 * @param localX / localY / localZ  贴花局部坐标
 * @returns                          淡化因子 [0,1]
 */
export function decalEdgeFade(
  localX: number, localY: number, localZ: number,
): number {
  const maxComp = Math.max(Math.abs(localX), Math.abs(localY), Math.abs(localZ));
  // smoothstep(edge0, edge1, x):x <= edge0 → 0, x >= edge1 → 1
  // 这里 edge0=0.5, edge1=0.45(反向):maxComp=0.5 → 0, maxComp=0.45 → 1
  const e0 = 0.5, e1 = 0.45;
  const x = maxComp;
  if (x >= e0) return 0;
  if (x <= e1) return 1;
  const t = (e0 - x) / (e0 - e1);
  return t * t * (3 - 2 * t);
}

/**
 * CPU 侧混合(对应 GLSL 4 种 blendMode,用于离线验证/测试)。
 *
 * @param sceneColor  背景色 [r, g, b]
 * @param decalColor  贴花采样 [r, g, b, a](a 已含 opacity 调制)
 * @param mode        混合模式
 * @returns           混合后颜色 [r, g, b]
 */
export function decalBlend(
  sceneColor: [number, number, number],
  decalColor: [number, number, number, number],
  mode: DecalBlendMode,
): [number, number, number] {
  const sa = sceneColor;
  const dr = decalColor[0], dg = decalColor[1], db = decalColor[2], da = decalColor[3];
  switch (mode) {
    case DecalBlendMode.Alpha:
      return [
        sa[0] * (1 - da) + dr * da,
        sa[1] * (1 - da) + dg * da,
        sa[2] * (1 - da) + db * da,
      ];
    case DecalBlendMode.Multiply:
      return [
        sa[0] * (1 + (dr - 1) * da),
        sa[1] * (1 + (dg - 1) * da),
        sa[2] * (1 + (db - 1) * da),
      ];
    case DecalBlendMode.Additive:
      return [
        sa[0] + dr * da,
        sa[1] + dg * da,
        sa[2] + db * da,
      ];
    case DecalBlendMode.Normal:
      return da > 0 ? [dr, dg, db] : [sa[0], sa[1], sa[2]];
  }
}

/**
 * 由贴花世界变换构造 decalMatrix(世界→局部)。
 *
 * decalWorld = T(position) * R(orientationQuat) * S(size)
 * decalMatrix = inverse(decalWorld)
 *
 * 调用方也可直接用任意 Matrix4 求逆得到,本函数只是便利封装。
 *
 * @param position    贴花中心(世界空间)
 * @param orientation 贴花朝向(四元数 [x, y, z, w])
 * @param size        贴花盒尺寸 [sx, sy, sz]
 * @returns           世界→贴花局部 4×4 矩阵(列主序,Float32Array(16))
 */
export function buildDecalMatrix(
  position: [number, number, number],
  orientation: [number, number, number, number],
  size: [number, number, number],
): Float32Array {
  // 四元数 → 旋转矩阵 3×3(标准 Hamilton 约定,v' = R * v)
  const [qx, qy, qz, qw] = orientation;
  const r00 = 1 - 2 * (qy * qy + qz * qz);
  const r01 = 2 * (qx * qy - qz * qw);
  const r02 = 2 * (qx * qz + qy * qw);
  const r10 = 2 * (qx * qy + qz * qw);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qx * qw);
  const r20 = 2 * (qx * qz - qy * qw);
  const r21 = 2 * (qy * qz + qx * qw);
  const r22 = 1 - 2 * (qx * qx + qy * qy);

  // world = T * R * S
  // inverse(world) = inverse(S) * inverse(R) * inverse(T)
  //               = scale(1/sx,1/sy,1/sz) * transpose(R) * translate(-pos)
  const sx = size[0], sy = size[1], sz = size[2];
  const invSx = 1 / Math.max(1e-6, sx);
  const invSy = 1 / Math.max(1e-6, sy);
  const invSz = 1 / Math.max(1e-6, sz);

  // 先 translate(-pos): world' = world - pos
  // 再 transpose(R):    view' = R^T * world'
  // 再 scale(1/s):      local = diag(1/sx,1/sy,1/sz) * view'
  // 合成 4×4(列主序):
  //   [ invSx*r00  invSx*r10  invSx*r20  -(invSx*r00*px + invSx*r10*py + invSx*r20*pz) ]
  //   [ invSy*r01  invSy*r11  invSy*r21  -(invSy*r01*px + invSy*r11*py + invSy*r21*pz) ]
  //   [ invSz*r02  invSz*r12  invSz*r22  -(invSz*r02*px + invSz*r12*py + invSz*r22*pz) ]
  //   [ 0          0          0           1                                              ]
  const px = position[0], py = position[1], pz = position[2];
  const m = new Float32Array(16);
  m[0] = invSx * r00; m[4] = invSx * r10; m[8] = invSx * r20;
  m[1] = invSy * r01; m[5] = invSy * r11; m[9] = invSy * r21;
  m[2] = invSz * r02; m[6] = invSz * r12; m[10] = invSz * r22;
  m[3] = 0; m[7] = 0; m[11] = 0;
  m[12] = -(m[0] * px + m[4] * py + m[8] * pz);
  m[13] = -(m[1] * px + m[5] * py + m[9] * pz);
  m[14] = -(m[2] * px + m[6] * py + m[10] * pz);
  m[15] = 1;
  return m;
}

/**
 * 把世界法线变换到视空间(用于填充 Decal.decalNormalView)。
 *
 * @param worldNormal  世界法线(单位向量)
 * @param viewMatrix   视图矩阵(4×4,列主序;取左上 3×3 转置逆 = 法线矩阵)
 * @returns            视空间法线 [x, y, z](未归一化,调用方按需 normalize)
 */
export function transformNormalToView(
  worldNormal: [number, number, number],
  viewMatrix: Float32Array | number[],
): [number, number, number] {
  // 法线矩阵 = transpose(inverse(mat3(viewMatrix)))
  // 对于纯旋转视图矩阵(无缩放),法线矩阵 = mat3(viewMatrix)
  // 列主序矩阵 × 列向量:
  //   [m0 m4 m8 ]   [nx]   [m0*nx + m4*ny + m8*nz ]
  //   [m1 m5 m9 ] * [ny] = [m1*nx + m5*ny + m9*nz ]
  //   [m2 m6 m10]   [nz]   [m2*nx + m6*ny + m10*nz]
  const m = viewMatrix;
  const nx = worldNormal[0], ny = worldNormal[1], nz = worldNormal[2];
  return [
    m[0] * nx + m[4] * ny + m[8] * nz,
    m[1] * nx + m[5] * ny + m[9] * nz,
    m[2] * nx + m[6] * ny + m[10] * nz,
  ];
}

// ════════════════════════════════════════════════════════════════════
//  ScreenSpaceDecalPass 类(GPU 渲染)
// ════════════════════════════════════════════════════════════════════

/**
 * 屏幕空间延迟贴花 Pass。
 *
 * 把贴花纹理投射到 GBuffer 描述的几何表面。内部 ping-pong 双缓冲支持连续
 * 多张贴花链式应用(避免读写同一纹理的反馈循环)。
 *
 * 输入约定:
 *   - depthTexture:   线性深度 [0,1](视空间,1=远裁剪面/skybox)
 *   - normalTexture:  视空间法线,RGB 编码到 [0,1](flat = 0.5, 0.5, 1.0)
 *   - colorTexture:   场景颜色(HDR,RGBA16F 兼容)
 *
 * @example
 * ```ts
 * const decalPass = new ScreenSpaceDecalPass({ defaultAngleThreshold: 0.4 });
 * let color = sceneColorTex;
 * for (const decal of activeDecals) {
 *   color = decalPass.apply(gl, color, depthTex, normalTex, decal, viewProjInv);
 * }
 * // color 即贴花后的场景颜色
 * ```
 */
export class ScreenSpaceDecalPass {
  readonly name = 'screenspacedecal';

  defaultBlendMode: DecalBlendMode;
  defaultOpacity: number;
  defaultAngleThreshold: number;
  enabled: boolean;

  // ping-pong 双缓冲:连续 apply() 自动交替输出,避免反馈
  private _texA: WebGLTexture | null = null;
  private _texB: WebGLTexture | null = null;
  private _fboA: WebGLFramebuffer | null = null;
  private _fboB: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: ScreenSpaceDecalOptions = {}) {
    this.defaultBlendMode = opts.defaultBlendMode ?? DecalBlendMode.Alpha;
    this.defaultOpacity = opts.defaultOpacity ?? 1;
    this.defaultAngleThreshold = opts.defaultAngleThreshold ?? 0.5;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用单张贴花到场景颜色。
   *
   * @param gl             WebGL2 上下文
   * @param colorTexture   输入场景颜色(本张贴花前的结果)
   * @param depthTexture   GBuffer 线性深度 [0,1]
   * @param normalTexture  GBuffer 视空间法线 [0,1]
   * @param decal          贴花数据
   * @param viewProjInv    clip→世界 4×4 矩阵(列主序,16 个数)
   * @returns              贴花后的颜色纹理(与输入不同的纹理,可安全链式调用)
   */
  apply(
    gl: WebGL2RenderingContext,
    colorTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    normalTexture: WebGLTexture,
    decal: Decal,
    viewProjInv: Float32Array | number[],
  ): WebGLTexture {
    if (!this.enabled) return colorTexture;

    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this._dirty || !this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
      this._dirty = false;
    }

    // 选输出缓冲:与输入不同的那个(避免反馈)
    const out = this._pickOutput(colorTexture);
    const outTex = out.tex;
    const outFbo = out.fbo;

    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getProgram(gl);
    prog.use();

    // 颜色 → unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    // 深度 → unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    prog.setUniformSampler('u_depthMap', 1);

    // 法线 → unit 2
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, normalTexture);
    prog.setUniformSampler('u_normalMap', 2);

    // 贴花纹理 → unit 3
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, decal.texture);
    prog.setUniformSampler('u_decalMap', 3);

    // 矩阵
    prog.setUniformMatrix4fv('u_viewProjInv', viewProjInv as Float32Array);
    prog.setUniformMatrix4fv('u_decalMatrix', decal.decalMatrix as Float32Array);

    // 贴花参数
    const n = decal.decalNormalView;
    prog.setUniform3f('u_decalNormalView', n[0], n[1], n[2]);
    prog.setUniform1f('u_angleThreshold', decal.angleThreshold ?? this.defaultAngleThreshold);
    prog.setUniform1i('u_blendMode', decal.blendMode ?? this.defaultBlendMode);
    prog.setUniform1f('u_opacity', decal.opacity ?? this.defaultOpacity);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    return outTex;
  }

  /** 标记下一帧需要重建资源(分辨率变化/上下文丢失等)。 */
  setDirty(): void {
    this._dirty = true;
  }

  /** 释放 GPU 资源。可重复调用。 */
  dispose(gl?: WebGL2RenderingContext): void {
    if (gl) {
      if (this._texA) gl.deleteTexture(this._texA);
      if (this._texB) gl.deleteTexture(this._texB);
      if (this._fboA) gl.deleteFramebuffer(this._fboA);
      if (this._fboB) gl.deleteFramebuffer(this._fboB);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._program) this._program.dispose();
    }
    this._texA = null;
    this._texB = null;
    this._fboA = null;
    this._fboB = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._program = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  /**
   * 选择输出缓冲:与输入纹理不同的那个。
   * - 输入是 texA → 输出 texB
   * - 输入是 texB → 输出 texA
   * - 输入是外部纹理(非 A/B)→ 输出 texA(下次若再传 texA 会切到 texB)
   */
  private _pickOutput(input: WebGLTexture): { tex: WebGLTexture; fbo: WebGLFramebuffer } {
    if (input === this._texA) {
      return { tex: this._texB as WebGLTexture, fbo: this._fboB as WebGLFramebuffer };
    }
    return { tex: this._texA as WebGLTexture, fbo: this._fboA as WebGLFramebuffer };
  }

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    if (this._initialized) {
      if (this._texA) gl.deleteTexture(this._texA);
      if (this._texB) gl.deleteTexture(this._texB);
      if (this._fboA) gl.deleteFramebuffer(this._fboA);
      if (this._fboB) gl.deleteFramebuffer(this._fboB);
    }

    // 两个输出纹理(HDR RGBA16F,与上游一致)
    this._texA = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._texA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._texB = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._texB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // 两个 FBO
    this._fboA = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texA, 0);

    this._fboB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texB, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 全屏三角形 VAO(只创建一次)
    if (!this._fullscreenQuadVao) {
      this._fullscreenQuadBuf = gl.createBuffer();
      this._fullscreenQuadVao = gl.createVertexArray();
      gl.bindVertexArray(this._fullscreenQuadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
      const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }

    this._width = w;
    this._height = h;
    this._initialized = true;
    log.debug(`init: ${w}×${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT, DECAL_FRAG);
    }
    return this._program;
  }
}
