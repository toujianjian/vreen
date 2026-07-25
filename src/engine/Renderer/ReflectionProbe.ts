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
// 不变量:
//   - dispose 后 cubeTexture.glTexture 为 null;
//   - capture 失败(如 GL 错误)不抛异常,记录 warn 并保留旧纹理;
//   - position / boxSize 改变不影响已捕获纹理,需重新 capture。

import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { CubeTexture } from '../Core/CubeTexture';
import { Scene } from '../Core/Scene';
import { Matrix4, Vector3 } from '../Math';
import type { Renderer } from './Renderer';
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

  constructor(opts: ReflectionProbeOptions = {}) {
    this.position = opts.position ?? new Vector3(0, 0, 0);
    this.resolution = opts.resolution ?? 256;
    this.boxSize = opts.boxSize ?? new Vector3(10, 10, 10);
    this.priority = opts.priority ?? 0;
    this.near = opts.near ?? 0.1;
    this.far = opts.far ?? 1000;
    this._faceCamera = new PerspectiveCamera(90, 1, this.near, this.far);
    this._faceCamera.matrixAutoUpdate = false;
  }

  /**
   * 从探针位置渲染立方体贴图。
   *
   * 流程:对 6 个面分别设置相机 → 调 renderer.render → gl.readPixels
   * → 上传到 cube texture 对应面。完成后调用方可通过 getTexture() 拿到 GL 句柄。
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

      for (const face of CUBE_FACES) {
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

      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
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
  }

  // ── private ─────────────────────────────────────────────────────────

  /** (懒)创建 CubeTexture + GL 立方体纹理句柄(resolution 变更时重建)。 */
  private _ensureCubeTexture(gl: WebGL2RenderingContext, res: number): void {
    const existing = this.cubeTexture;
    if (existing && existing.glTexture) {
      // 已存在:resolution 变更时 glTexImage2D 在 capture 内部会重设大小,
      // 这里不重建,只保留句柄。
      return;
    }
    const tex = gl.createTexture();
    if (!tex) {
      log.warn('createTexture() returned null; probe will not capture');
      this.cubeTexture = new CubeTexture();
      this.cubeTexture.glTexture = null;
      return;
    }
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    // 预分配 6 面空数据(避免 capture 前 sample 到未初始化内存)
    const empty = new Uint8Array(res * res * 4);
    const faceTargets = [
      gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
      gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
      gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
    ];
    for (const ft of faceTargets) {
      gl.texImage2D(ft, 0, gl.RGBA8, res, res, 0, gl.RGBA, gl.UNSIGNED_BYTE, empty);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    const cubeTex = new CubeTexture();
    cubeTex.glTexture = tex;
    cubeTex.generateMipmaps = true;
    this.cubeTexture = cubeTex;
    log.info(`ReflectionProbe cube texture allocated: ${res}x${res} @ ${this.position.toArray().join(',')}`);
  }
}
