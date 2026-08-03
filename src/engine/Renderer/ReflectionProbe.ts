// ReflectionProbe — 反射探针(捕获环境立方体贴图)。
//
// 设计目标:
//   - 在场景中的某个位置以 90° 视角渲染 6 个方向,合成一张立方体环境贴图,
//     供 PBR 材质做 IBL 反射(替代全局 scene.environment,支持局部反射)。
//   - 通过 boxSize + position 定义探针的影响范围(AABB),供
//     ReflectionProbeManager 按"最近 / 包含"原则挑选。
//   - 不参与每帧主渲染,而是按需 capture()(典型场景:每 N 帧或场景
//     几何变化时刷新一次)。
//
// 实现说明:
//   - WebGL2Renderer 没有暴露"渲染到指定 FBO"的 API,render() 始终输出
//     到自己的 canvas / 后处理 FBO。本探针通过:
//       a) 临时改 renderer canvas 尺寸到 resolution × resolution;
//       b) 每面调用 renderer.render(scene, faceCamera) 渲染到 canvas;
//       c) gl.readPixels 读回像素 → gl.texImage2D 上传到 cube 纹理对应面。
//     这是慢路径,但无需修改主渲染器。
//   - 探针持有 CubeTexture(引擎侧元数据)+ 其内部的 glTexture(GL 句柄)。
//   - 调用方负责在场景几何变化时手动 capture()。
//
// PMREM 预滤波路径(`prefilter: true`):
//   - 捕获的 6 面 RGBA8 像素 → 转 Float32 RGB(EnvironmentCubeData)
//     → PMREMGenerator.prefilter() 做 Karis 2013 split-sum GGX 重要性采样卷积
//     → 生成 mip 链(每级 mip 对应一个粗糙度 α),作为 RGBA16F 上传到 GL。
//   - PBR 着色器 `textureLod(u_envMap, R, roughness * mipCount)` 按粗糙度
//     取对应 mip,得到物理正确的镜面 IBL(粗糙表面反射更模糊)。
//   - 不调用 gl.generateMipmap —— PMREM 的 mip 链已经是预滤波结果,
//     再做 box-filter mipmap 会破坏 GGX 卷积。
//   - 对照:不开启 prefilter 时,捕获的 RGBA8 cube 仅做 generateMipmap,
//     mip 是 box-filter(非 GGX),`textureLod` 取到的粗糙度反射是错的
//     (太锐利,无物理意义)。prefilter 路径修复这一缺陷,使局部反射探针
//     的 IBL 质量匹敌全局 PMREM(RoomEnvironment + PMREMGenerator)。
//
// 不变量:
//   - dispose 后 cubeTexture.glTexture 为 null;
//   - capture 失败(如 GL 错误)不抛异常,记录 warn 并保留旧纹理;
//   - position / boxSize 改变不影响已捕获纹理,需重新 capture;
//   - 切换 prefilter 开关后,下次 capture 会重建 GL 纹理(格式从 RGBA8 ↔ RGBA16F)。

import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { CubeTexture } from '../Core/CubeTexture';
import { Scene } from '../Core/Scene';
import { Matrix4, Vector3 } from '../Math';
import type { Renderer } from './Renderer';
import type { EnvironmentCubeData } from './RoomEnvironment';
import { PMREMGenerator } from './PMREMGenerator';
import { createLogger } from '@/lib/logger';

const log = createLogger('ReflectionProbe');

export interface ReflectionProbeOptions {
  /** 探针世界位置(默认原点)。 */
  position?: Vector3;
  /** 立方体贴图边长(像素,默认 256;必须为 2 的幂以便 mipmap)。 */
  resolution?: number;
  /** 影响范围(AABB 半尺寸,默认 10×10×10)。 */
  boxSize?: Vector3;
  /** 优先级(数字越大越优先;同点多个探针时高优先级胜出)。 */
  priority?: number;
  /** 渲染远裁面(默认 1000)。 */
  far?: number;
  /** 渲染近裁面(默认 0.1)。 */
  near?: number;
  /**
   * 是否对捕获的 cube 做 PMREM 预滤波(默认 false)。
   *
   * - false:捕获的 RGBA8 cube 仅 generateMipmap(box-filter),
   *   `textureLod` 取到的粗糙度反射是错的(太锐利)。
   * - true:捕获后跑 PMREMGenerator.prefilter(Karis 2013 split-sum
   *   GGX 重要性采样),生成 mip 链作为 RGBA16F 上传。PBR 着色器
   *   `textureLod(u_envMap, R, roughness * mipCount)` 得到物理正确的
   *   镜面 IBL。代价:捕获耗时增加(每 mip 一次 GGX 卷积)。
   */
  prefilter?: boolean;
  /**
   * PMREM 预滤波每输出 texel 的最大采样数(默认 32)。
   * 仅 prefilter=true 时生效。更高 = 更高质量但更慢。
   */
  pmremSamples?: number;
}

/** 立方体 6 面的方向 / up 配置(WebGL 立方体约定)。 */
interface CubeFaceConfig {
  /** GL 立方体面枚举(运行时从 gl 上取)。 */
  faceEnumKey: 'TEXTURE_CUBE_MAP_POSITIVE_X' | 'TEXTURE_CUBE_MAP_NEGATIVE_X'
    | 'TEXTURE_CUBE_MAP_POSITIVE_Y' | 'TEXTURE_CUBE_MAP_NEGATIVE_Y'
    | 'TEXTURE_CUBE_MAP_POSITIVE_Z' | 'TEXTURE_CUBE_MAP_NEGATIVE_Z';
  /** 视线方向(从探针看出去)。 */
  dir: Vector3;
  /** 相机 up 向量。 */
  up: Vector3;
}

const CUBE_FACES: CubeFaceConfig[] = [
  { faceEnumKey: 'TEXTURE_CUBE_MAP_POSITIVE_X', dir: new Vector3(1, 0, 0),  up: new Vector3(0, -1, 0) },
  { faceEnumKey: 'TEXTURE_CUBE_MAP_NEGATIVE_X', dir: new Vector3(-1, 0, 0), up: new Vector3(0, -1, 0) },
  { faceEnumKey: 'TEXTURE_CUBE_MAP_POSITIVE_Y', dir: new Vector3(0, 1, 0),  up: new Vector3(0, 0, 1)  },
  { faceEnumKey: 'TEXTURE_CUBE_MAP_NEGATIVE_Y', dir: new Vector3(0, -1, 0), up: new Vector3(0, 0, -1) },
  { faceEnumKey: 'TEXTURE_CUBE_MAP_POSITIVE_Z', dir: new Vector3(0, 0, 1),  up: new Vector3(0, -1, 0) },
  { faceEnumKey: 'TEXTURE_CUBE_MAP_NEGATIVE_Z', dir: new Vector3(0, 0, -1), up: new Vector3(0, -1, 0) },
];

/**
 * 反射探针。在指定位置捕获 6 面环境贴图,供 PBR IBL 使用。
 *
 * 典型用法:
 *   const probe = new ReflectionProbe({ position: new Vector3(0, 2, 0), boxSize: new Vector3(20, 20, 20) });
 *   probe.capture(gl, renderer, scene);
 *   // 下游材质可读 probe.getTexture() 绑定到 u_envMap。
 */
export class ReflectionProbe {
  /** 探针世界位置。 */
  position: Vector3;
  /** 立方体贴图边长(像素)。 */
  resolution: number;
  /** 影响范围(AABB 半尺寸)。 */
  boxSize: Vector3;
  /** 优先级(数字大者胜)。 */
  priority: number;
  /** 渲染近裁面。 */
  near: number;
  /** 渲染远裁面。 */
  far: number;
  /** 是否对捕获的 cube 做 PMREM 预滤波(RGBA16F mip 链)。 */
  prefilter: boolean;
  /** PMREM 每输出 texel 最大采样数。 */
  pmremSamples: number;

  /** 引擎侧立方体贴图元数据(含 GL 句柄)。capture 前为 null。 */
  cubeTexture: CubeTexture | null = null;

  /** 临时面相机(避免每帧 new)。 */
  private _faceCamera: PerspectiveCamera;
  /** 临时 view matrix scratch(makeLookAt 用)。 */
  private _viewMatrix = new Matrix4();
  /** 临时 target scratch。 */
  private _target = new Vector3();
  /** 临时世界矩阵(inverse view)scratch。 */
  private _worldMatrix = new Matrix4();
  /** 像素读回缓冲(Uint8Array,resolution²*4)。 */
  private _pixelBuffer: Uint8Array | null = null;
  /** 当前 GL 纹理是否为 HDR(RGBA16F)格式。false=RGBA8(LDR)。 */
  private _isHDR: boolean = false;
  /** 懒创建的 PMREM 生成器实例(prefilter=true 时使用)。 */
  private _pmrem: PMREMGenerator | null = null;
  /** 临时 Float32 RGB 面数据(prefilter 路径:RGBA8 → RGB float 转换)。 */
  private _faceRGB: Float32Array | null = null;
  /** 临时 Float32 RGBA 上传缓冲(prefilter 路径:PMREM RGB → RGBA float 上传)。 */
  private _uploadRGBA: Float32Array | null = null;

  constructor(opts: ReflectionProbeOptions = {}) {
    this.position = opts.position ?? new Vector3(0, 0, 0);
    this.resolution = opts.resolution ?? 256;
    this.boxSize = opts.boxSize ?? new Vector3(10, 10, 10);
    this.priority = opts.priority ?? 0;
    this.near = opts.near ?? 0.1;
    this.far = opts.far ?? 1000;
    this.prefilter = opts.prefilter ?? false;
    this.pmremSamples = opts.pmremSamples ?? 32;
    this._faceCamera = new PerspectiveCamera(90, 1, this.near, this.far);
    this._faceCamera.matrixAutoUpdate = false;
  }

  /**
   * 从探针位置渲染立方体贴图。
   *
   * 流程:对 6 个面分别设置相机 → 调 renderer.render → gl.readPixels
   * → 上传到 cube texture 对应面。完成后调用方可通过 getTexture() 拿到 GL 句柄。
   *
   * `prefilter=true` 时,捕获的 6 面 RGBA8 会先转成 Float32 RGB
   * (EnvironmentCubeData),经 PMREMGenerator.prefilter 做 Karis 2013
   * split-sum GGX 重要性采样卷积,生成 mip 链作为 RGBA16F 上传
   * (不调 generateMipmap —— PMREM 的 mip 已是预滤波结果)。
   *
   * 注意:此调用会临时修改 renderer canvas 尺寸,完成后恢复。
   */
  capture(gl: WebGL2RenderingContext, renderer: Renderer, scene: Scene): void {
    const res = Math.max(2, Math.floor(this.resolution));
    // 临时改 canvas 尺寸为方形(便于直接 readPixels)
    const savedCanvasW = renderer.canvas.width;
    const savedCanvasH = renderer.canvas.height;
    // 临时关闭后处理避免捕获时被 bloom 等污染
    const wgl2 = renderer as unknown as {
      postProcessingEnabled?: boolean;
      ssaoEnabled?: boolean;
      frustumCullingEnabled?: boolean;
    };
    const savedPost = wgl2.postProcessingEnabled;
    const savedSsao = wgl2.ssaoEnabled;
    const savedCull = wgl2.frustumCullingEnabled;
    if (wgl2.postProcessingEnabled !== undefined) wgl2.postProcessingEnabled = false;
    if (wgl2.ssaoEnabled !== undefined) wgl2.ssaoEnabled = false;
    if (wgl2.frustumCullingEnabled !== undefined) wgl2.frustumCullingEnabled = false;

    try {
      renderer.resize(res, res);
      this._ensureCubeTexture(gl, res);
      if (!this._pixelBuffer || this._pixelBuffer.length !== res * res * 4) {
        this._pixelBuffer = new Uint8Array(res * res * 4);
      }

      const cubeTex = this.cubeTexture as CubeTexture;
      const glTex = cubeTex.glTexture as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, glTex);

      if (this.prefilter) {
        this._capturePrefiltered(gl, renderer, scene, res);
      } else {
        this._captureLDR(gl, renderer, scene, res);
        gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      }
      cubeTex.version++;
    } catch (err) {
      log.warn(`capture failed: ${(err as Error).message ?? err}`);
    } finally {
      // 恢复 canvas / 后处理状态
      renderer.resize(savedCanvasW, savedCanvasH);
      if (wgl2.postProcessingEnabled !== undefined) wgl2.postProcessingEnabled = savedPost as boolean;
      if (wgl2.ssaoEnabled !== undefined) wgl2.ssaoEnabled = savedSsao as boolean;
      if (wgl2.frustumCullingEnabled !== undefined) wgl2.frustumCullingEnabled = savedCull as boolean;
    }
  }

  /**
   * LDR 路径:6 面 RGBA8 直接上传到 level 0,完成后由调用方 generateMipmap。
   * 保留原 capture() 行为(box-filter mip,粗糙度 IBL 不物理正确)。
   */
  private _captureLDR(gl: WebGL2RenderingContext, renderer: Renderer, scene: Scene, res: number): void {
    for (const face of CUBE_FACES) {
      this._renderFace(gl, renderer, scene, face, res);
      const faceTarget = (gl as unknown as Record<string, number>)[face.faceEnumKey] as number;
      gl.texImage2D(
        faceTarget,
        0,
        gl.RGBA8,
        res,
        res,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this._pixelBuffer as Uint8Array,
      );
    }
  }

  /**
   * PMREM 预滤波路径:
   *   1. 捕获 6 面 RGBA8 → 转 Float32 RGB(EnvironmentCubeData)
   *   2. PMREMGenerator.prefilter → mip 链(每级对应一个粗糙度 α)
   *   3. 逐面逐 mip 上传为 RGBA16F(FLOAT 源数据,WebGL2 允许 RGBA16F+FLOAT 组合)
   * 不调 generateMipmap —— PMREM 的 mip 链已是 GGX 预滤波结果。
   */
  private _capturePrefiltered(
    gl: WebGL2RenderingContext,
    renderer: Renderer,
    scene: Scene,
    res: number,
  ): void {
    // 1. 捕获 6 面 RGBA8 → Float32 RGB
    const faceCount = 6;
    if (!this._faceRGB || this._faceRGB.length !== faceCount * res * res * 3) {
      this._faceRGB = new Float32Array(faceCount * res * res * 3);
    }
    const faces = CUBE_FACES;
    const faceNames = ['+x', '-x', '+y', '-y', '+z', '-z'];
    for (let f = 0; f < faceCount; f++) {
      this._renderFace(gl, renderer, scene, faces[f], res);
      // RGBA8 → Float32 RGB(归一化到 [0,1])
      const src = this._pixelBuffer as Uint8Array;
      const dst = this._faceRGB as Float32Array;
      const base = f * res * res * 3;
      for (let i = 0, n = res * res; i < n; i++) {
        dst[base + i * 3] = src[i * 4] / 255;
        dst[base + i * 3 + 1] = src[i * 4 + 1] / 255;
        dst[base + i * 3 + 2] = src[i * 4 + 2] / 255;
      }
    }

    // 2. 构建 EnvironmentCubeData 并预滤波
    const cube: EnvironmentCubeData = {
      size: res,
      faces: faceNames.map((face, i) => ({
        face,
        width: res,
        height: res,
        data: (this._faceRGB as Float32Array).subarray(i * res * res * 3, (i + 1) * res * res * 3),
      })),
    };

    if (!this._pmrem) {
      this._pmrem = new PMREMGenerator({ samples: this.pmremSamples });
    }
    const pmrem = this._pmrem.prefilter(cube);

    // 3. 逐面逐 mip 上传为 RGBA16F
    //    PMREM 数据是 Float32 RGB;交错为 Float32 RGBA(alpha=1.0)后用
    //    gl.RGBA16F + gl.FLOAT 上传(WebGL2 规范允许此组合)。
    for (let f = 0; f < faceCount; f++) {
      const faceTarget = (gl as unknown as Record<string, number>)[faces[f].faceEnumKey] as number;
      for (let m = 0; m < pmrem.mipCount; m++) {
        const mip = pmrem.faces[f].mips[m];
        const w = mip.width;
        const h = mip.height;
        const rgbaLen = w * h * 4;
        if (!this._uploadRGBA || this._uploadRGBA.length < rgbaLen) {
          this._uploadRGBA = new Float32Array(rgbaLen);
        }
        const rgba = this._uploadRGBA;
        const rgb = mip.data;
        for (let i = 0, n = w * h; i < n; i++) {
          rgba[i * 4] = rgb[i * 3];
          rgba[i * 4 + 1] = rgb[i * 3 + 1];
          rgba[i * 4 + 2] = rgb[i * 3 + 2];
          rgba[i * 4 + 3] = 1.0;
        }
        gl.texImage2D(
          faceTarget,
          m,
          gl.RGBA16F,
          w,
          h,
          0,
          gl.RGBA,
          gl.FLOAT,
          rgba.subarray(0, rgbaLen),
        );
      }
    }
  }

  /**
   * 渲染单个 cube 面到 canvas 并读回像素到 _pixelBuffer。
   * 6 面公用,供 LDR / PMREM 路径复用。
   */
  private _renderFace(
    gl: WebGL2RenderingContext,
    renderer: Renderer,
    scene: Scene,
    face: CubeFaceConfig,
    res: number,
  ): void {
    // 构建面 view matrix:eye=position, target=position+dir, up=face.up
    this._target.copy(this.position).add(face.dir);
    this._viewMatrix.makeLookAt(this.position, this._target, face.up);
    // matrixWorld = inverse(viewMatrix)
    this._worldMatrix.getInverse(this._viewMatrix);

    const cam = this._faceCamera;
    cam.aspect = 1;
    cam.near = this.near;
    cam.far = this.far;
    cam.updateProjectionMatrix();
    cam.position.copy(this.position);
    cam.matrix.copy(this._worldMatrix);
    cam.matrixWorld.copy(this._worldMatrix);
    cam.matrixWorldInverse.copy(this._viewMatrix);

    renderer.render(scene, cam);

    // 从 canvas 读回像素(Y 翻转:canvas 顶行 = gl 末行)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, res, res, gl.RGBA, gl.UNSIGNED_BYTE, this._pixelBuffer as Uint8Array);
  }

  /** 获取捕获的 GL 立方体纹理句柄。未捕获 / 已 dispose 时返回 null。 */
  getTexture(): WebGLTexture | null {
    return this.cubeTexture?.glTexture ?? null;
  }

  /**
   * 判断点是否在探针影响范围内(AABB,以 position 为中心 ± boxSize)。
   * 注意 boxSize 是半尺寸,与 boxSize = fullSize/2 等价。
   */
  contains(point: Vector3): boolean {
    const half = this.boxSize;
    return (
      Math.abs(point.x - this.position.x) <= half.x &&
      Math.abs(point.y - this.position.y) <= half.y &&
      Math.abs(point.z - this.position.z) <= half.z
    );
  }

  /** 释放 GL 立方体纹理。可重复调用。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this.cubeTexture?.glTexture) {
      gl.deleteTexture(this.cubeTexture.glTexture);
      this.cubeTexture.glTexture = null;
    }
    this.cubeTexture = null;
    this._pixelBuffer = null;
    this._faceRGB = null;
    this._uploadRGBA = null;
    this._isHDR = false;
    this._pmrem = null;
  }

  // ── private ─────────────────────────────────────────────────────────

  /**
   * (懒)创建 CubeTexture + GL 立方体纹理句柄。
   *
   * - `prefilter=true` → RGBA16F 格式(预分配 level 0 空 HDR 数据);
   *   mip 链由 _capturePrefiltered 逐级上传(PREM 已是预滤波结果)。
   * - `prefilter=false` → RGBA8 格式(预分配 level 0 空 LDR 数据);
   *   mip 链由 capture() 调 generateMipmap 生成(box-filter)。
   *
   * 切换 prefilter 开关导致格式不匹配时,删除旧纹理并重建。
   */
  private _ensureCubeTexture(gl: WebGL2RenderingContext, res: number): void {
    const wantHDR = this.prefilter;
    const existing = this.cubeTexture;
    if (existing && existing.glTexture && this._isHDR === wantHDR) {
      // 已存在且格式匹配:resolution 变更时 glTexImage2D 在 capture 内部会重设大小,
      // 这里不重建,只保留句柄。
      return;
    }
    // 格式不匹配(切换 prefilter):释放旧纹理重建
    if (existing?.glTexture) {
      gl.deleteTexture(existing.glTexture);
      existing.glTexture = null;
    }

    const tex = gl.createTexture();
    if (!tex) {
      log.warn('createTexture() returned null; probe will not capture');
      this.cubeTexture = new CubeTexture();
      this.cubeTexture.glTexture = null;
      this._isHDR = false;
      return;
    }
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    const faceTargets = [
      gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
      gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
      gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
    ];
    if (wantHDR) {
      // RGBA16F:用 FLOAT 空数据预分配 level 0(避免 sample 未初始化内存)
      const empty = new Float32Array(res * res * 4);
      for (const ft of faceTargets) {
        gl.texImage2D(ft, 0, gl.RGBA16F, res, res, 0, gl.RGBA, gl.FLOAT, empty);
      }
    } else {
      // RGBA8:LDR 路径
      const empty = new Uint8Array(res * res * 4);
      for (const ft of faceTargets) {
        gl.texImage2D(ft, 0, gl.RGBA8, res, res, 0, gl.RGBA, gl.UNSIGNED_BYTE, empty);
      }
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    const cubeTex = new CubeTexture();
    cubeTex.glTexture = tex;
    cubeTex.generateMipmaps = !wantHDR; // HDR 路径:PMREM 显式上传 mip,无需 generateMipmaps
    this.cubeTexture = cubeTex;
    this._isHDR = wantHDR;
    log.info(
      `ReflectionProbe cube texture allocated: ${res}x${res} ${wantHDR ? 'RGBA16F (PMREM)' : 'RGBA8 (LDR)'} @ ${this.position.toArray().join(',')}`,
    );
  }
}
