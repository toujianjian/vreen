// RayTracingRenderer — 实时光线追踪渲染器(CPU 路径追踪 + BVH 加速 + 蒙特卡洛采样)。
//
// 设计:
//   * 与 PathTracer 互补:PathTracer 是"参考验证器"(暴力遍历,无 BVH,小场景);
//     本类面向"准实时"渲染,引入 BVH 加速、分块渲染、环境贴图、降噪。
//   * 复用引擎 Acceleration.MeshBVH 做最近命中 / 任意命中查询,把射线变到 mesh
//     局部空间求交,再把命中点 / 法线变回世界空间。
//   * 蒙特卡洛积分:每像素发射 samplesPerPixel 条主射线,cosine 加权半球采样
//     间接光,Russian roulette 在 depth >= 3 后按 0.5 概率终止路径。
//   * 累积缓冲 accumulationBuffer(Float32Array,线性 RGB,长度 w*h*3),
//     多帧 accumulate 后由 getAccumulationBuffer / getResult 取平均降低噪声。
//   * 分块 tileSize:大分辨率下按块渲染,便于中断 / 进度回调(本类不回调,
//     仅做顺序分块,避免单帧长阻塞)。
//   * 降噪 denoiserEnabled:简单邻域均值(3x3 box),边缘保留弱,仅作演示。
//
// 局限(v1):
//   * 仅 CPU 单线程(无 Worker);分辨率 / SPP 高时耗时显著
//   * 仅识别 StandardMaterial 的 baseColor / metallic / roughness / emissive;
//     其余材质退化为灰
//   * 仅 DirectionalLight / AmbientLight;PointLight 暂未采样
//   * 降噪为简化 box blur,非 SVGF / OIDN 级
//
// 用法:
//   const rt = new RayTracingRenderer({ width: 256, height: 256, samplesPerPixel: 2 });
//   rt.buildBVH(scene);
//   for (let i = 0; i < 32; i++) rt.render(scene, camera);  // 累积 32 帧
//   const pixels = rt.getResult();  // Uint8ClampedArray RGBA

import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { Matrix4 } from '../Math/Matrix4';
import { Mesh } from '../Core/Mesh';
import type { Scene } from '../Core/Scene';
import type { Camera } from '../Cameras/Camera';
import { MeshBVH, type BVHIntersection } from '../Acceleration/MeshBVH';
import type { StandardMaterial } from '../Materials/StandardMaterial';
import type { DirectionalLight } from '../Lights/DirectionalLight';
import type { AmbientLight } from '../Lights/AmbientLight';
import { Light } from '../Lights/Light';
import { createLogger } from '@/lib/logger';

const log = createLogger('RayTracingRenderer');

/** 环境贴图采样接口(可选,由调用方注入)。 */
export interface EnvironmentMap {
  /** 按方向采样环境辐射(线性 RGB,0..∞)。 */
  sample(direction: Vector3): Color;
}

/** RayTracingRenderer 构造选项。 */
export interface RayTracingRendererOptions {
  /** 最大反弹次数(默认 8)。 */
  maxBounces?: number;
  /** 每像素采样数(默认 2)。 */
  samplesPerPixel?: number;
  /** 最大递归深度(默认 16,与 maxBounces 互补,防栈溢出)。 */
  maxDepth?: number;
  /** 渲染宽度(像素)。 */
  width?: number;
  /** 渲染高度(像素)。 */
  height?: number;
  /** 分块大小(像素,默认 32)。 */
  tileSize?: number;
  /** 阴影射线偏移(避免自相交,默认 1e-4)。 */
  shadowBias?: number;
  /** 背景色(射线未命中时,默认黑)。 */
  backgroundColor?: Color;
  /** 环境光强度(默认 1)。 */
  environmentIntensity?: number;
}

/** 射线命中信息(世界空间)。 */
export interface RayTracingHit {
  /** 命中点(世界空间)。 */
  point: Vector3;
  /** 命中点法线(世界空间,归一化,已翻转朝向射线)。 */
  normal: Vector3;
  /** 命中 mesh。 */
  mesh: Mesh;
  /** 世界空间距离。 */
  distance: number;
}

/** 渲染统计。 */
export interface RayTracingStats {
  /** 累积帧数。 */
  frameCount: number;
  /** 当前是否正在累积。 */
  isAccumulating: boolean;
  /** 已构建 BVH 的 mesh 数。 */
  bvhMeshCount: number;
  /** 上一帧发射的主射线数。 */
  primaryRays: number;
  /** 上一帧发射的阴影射线数。 */
  shadowRays: number;
  /** 上一帧发射的总射线数(主 + 阴影 + 间接)。 */
  totalRays: number;
  /** 上一帧耗时(ms)。 */
  frameTimeMs: number;
  /** 当前每像素采样数。 */
  samplesPerPixel: number;
  /** 当前最大反弹次数。 */
  maxBounces: number;
  /** 降噪是否启用。 */
  denoiserEnabled: boolean;
}

/** 内部 mesh + BVH 缓存项。 */
interface MeshBVHEntry {
  mesh: Mesh;
  bvh: MeshBVH;
  /** 每帧刷新的 inverse(matrixWorld)。 */
  inverseMatrix: Matrix4;
  /** 每帧刷新的世界矩阵引用。 */
  worldMatrix: Matrix4;
  /** 每帧刷新的法线矩阵(upper-left 3x3 inverse-transpose,9 元素 column-major)。 */
  normalMatrix: Float32Array;
}

/** 收集到的光源。 */
interface LightCollection {
  directionals: DirectionalLight[];
  ambients: AmbientLight[];
}

/**
 * 实时光线追踪渲染器 — CPU 路径追踪 + BVH 加速 + 蒙特卡洛采样 + 分块 + 降噪。
 *
 * 不持有 WebGL 上下文,纯 CPU 计算,可在 Node / 无头环境运行。
 */
export class RayTracingRenderer {
  /** 最大反弹次数。 */
  maxBounces: number;
  /** 每像素采样数。 */
  samplesPerPixel: number;
  /** 最大递归深度。 */
  maxDepth: number;
  /** 渲染宽度。 */
  width: number;
  /** 渲染高度。 */
  height: number;
  /** 分块大小。 */
  tileSize: number;
  /** 阴影射线偏移。 */
  shadowBias: number;
  /** 背景色。 */
  backgroundColor: Color;

  /** 累积缓冲(线性 RGB,长度 width*height*3)。 */
  accumulationBuffer: Float32Array;
  /** 累积帧数。 */
  frameCount: number;
  /** 是否正在累积。 */
  isAccumulating: boolean;

  /** 已构建的 BVH 树(任意类型,外部读取用)。 */
  bvh: MeshBVH[] | null = null;
  /** 环境贴图。 */
  environmentMap: EnvironmentMap | null = null;
  /** 环境光强度。 */
  environmentIntensity: number;
  /** 降噪是否启用。 */
  denoiserEnabled: boolean;

  /** 上一帧统计。 */
  stats: RayTracingStats = {
    frameCount: 0,
    isAccumulating: false,
    bvhMeshCount: 0,
    primaryRays: 0,
    shadowRays: 0,
    totalRays: 0,
    frameTimeMs: 0,
    samplesPerPixel: 0,
    maxBounces: 0,
    denoiserEnabled: false,
  };

  /** 缓存的 mesh + BVH 列表(buildBVH 时填充,render 时刷新矩阵)。 */
  private _entries: MeshBVHEntry[] = [];
  /** 缓存的光源列表。 */
  private _lights: LightCollection = { directionals: [], ambients: [] };
  /** 每帧射线计数(渲染开始时重置)。 */
  private _primaryRays: number = 0;
  private _shadowRays: number = 0;
  private _indirectRays: number = 0;
  /** 复用临时变量,避免热路径分配。 */
  private _localRay = new Ray();
  private _tmpVec = new Vector3();

  constructor(opts: RayTracingRendererOptions = {}) {
    this.maxBounces = opts.maxBounces ?? 8;
    this.samplesPerPixel = opts.samplesPerPixel ?? 2;
    this.maxDepth = opts.maxDepth ?? 16;
    this.width = opts.width ?? 256;
    this.height = opts.height ?? 256;
    this.tileSize = opts.tileSize ?? 32;
    this.shadowBias = opts.shadowBias ?? 1e-4;
    this.backgroundColor = opts.backgroundColor ? opts.backgroundColor.clone() : new Color(0, 0, 0);
    this.environmentIntensity = opts.environmentIntensity ?? 1;
    this.denoiserEnabled = false;
    this.accumulationBuffer = new Float32Array(this.width * this.height * 3);
    this.frameCount = 0;
    this.isAccumulating = false;
  }

  // ── 配置 ─────────────────────────────────────────────────────────

  /** 设置最大反弹次数(并 reset 累积)。 */
  setBounces(bounces: number): this {
    this.maxBounces = clamp(Math.floor(bounces), 1, 64);
    this.resetAccumulation();
    return this;
  }

  /** 设置每像素采样数(并 reset 累积)。 */
  setSamplesPerPixel(samples: number): this {
    this.samplesPerPixel = clamp(Math.floor(samples), 1, 256);
    this.resetAccumulation();
    return this;
  }

  /** 设置最大递归深度。 */
  setMaxDepth(depth: number): this {
    this.maxDepth = clamp(Math.floor(depth), 1, 64);
    this.resetAccumulation();
    return this;
  }

  /** 设置分块大小。 */
  setTileSize(size: number): this {
    this.tileSize = clamp(Math.floor(size), 1, 256);
    return this;
  }

  /** 设置环境贴图。 */
  setEnvironmentMap(map: EnvironmentMap | null): this {
    this.environmentMap = map;
    this.resetAccumulation();
    return this;
  }

  /** 设置环境光强度。 */
  setEnvironmentIntensity(intensity: number): this {
    this.environmentIntensity = Math.max(0, intensity);
    this.resetAccumulation();
    return this;
  }

  /** 启用 / 禁用降噪(影响 getResult 输出,不改变累积缓冲)。 */
  enableDenoiser(enabled: boolean): this {
    this.denoiserEnabled = enabled;
    return this;
  }

  /** 调整渲染分辨率(并 reset 累积)。 */
  resize(width: number, height: number): this {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.accumulationBuffer = new Float32Array(this.width * this.height * 3);
    this.frameCount = 0;
    return this;
  }

  // ── BVH 构建 ─────────────────────────────────────────────────────

  /**
   * 为场景中所有 Mesh 构建 BVH(局部空间)。
   *
   * BVH 在 mesh 局部空间构建;render 时把世界射线变到局部空间查询,
   * 命中点 / 法线再变回世界空间。mesh 的 geometry 变更后需重新调用。
   */
  buildBVH(scene: Scene): this {
    this._entries = [];
    scene.traverse((obj) => {
      if (obj instanceof Mesh && obj.geometry && obj.geometry.attributes.position) {
        const bvh = new MeshBVH(obj.geometry);
        this._entries.push({
          mesh: obj,
          bvh,
          inverseMatrix: new Matrix4(),
          worldMatrix: obj.matrixWorld,
          normalMatrix: new Float32Array(9),
        });
      }
    });
    this.bvh = this._entries.map((e) => e.bvh);
    log.debug(`buildBVH: ${this._entries.length} mesh(es) indexed`);
    return this;
  }

  // ── 渲染 ─────────────────────────────────────────────────────────

  /**
   * 渲染一帧:分块遍历像素,每像素发射 samplesPerPixel 条主射线,
   * 累加到 accumulationBuffer,frameCount 自增。
   */
  render(scene: Scene, camera: Camera): void {
    if (this._entries.length === 0) this.buildBVH(scene);
    this._collectLights(scene);
    this._refreshMatrices(camera);
    this._ensureBufferSize();

    const t0 = performance.now();
    this._primaryRays = 0;
    this._shadowRays = 0;
    this._indirectRays = 0;
    this.isAccumulating = true;

    const w = this.width;
    const h = this.height;
    const spp = this.samplesPerPixel;
    const aspect = w / h;
    const tile = this.tileSize;
    const invSpp = 1 / spp;

    camera.updateWorldMatrix(true, false);
    const camElems = camera.matrixWorld.elements;
    const camPos = new Vector3(camElems[12], camElems[13], camElems[14]);
    const camDir = new Vector3();
    camera.getWorldDirection(camDir);
    const camUp = new Vector3(0, 1, 0);
    const camRight = camDir.clone().cross(camUp).normalize();
    const camUpActual = camRight.clone().cross(camDir).normalize();

    const fov = 60 * Math.PI / 180;
    const halfHeight = Math.tan(fov / 2);
    const halfWidth = halfHeight * aspect;

    const buf = this.accumulationBuffer;

    // 分块遍历(tileSize 向下取整对齐 + 边缘余块)
    for (let ty = 0; ty < h; ty += tile) {
      const yEnd = Math.min(ty + tile, h);
      for (let tx = 0; tx < w; tx += tile) {
        const xEnd = Math.min(tx + tile, w);
        for (let y = ty; y < yEnd; y++) {
          for (let x = tx; x < xEnd; x++) {
            let r = 0, g = 0, b = 0;
            for (let s = 0; s < spp; s++) {
              const u = (x + Math.random()) / w;
              const v = (y + Math.random()) / h;
              const ndcX = (u * 2 - 1) * halfWidth;
              const ndcY = (1 - v * 2) * halfHeight;
              const dir = new Vector3()
                .copy(camDir)
                .addScaledVector(camRight, ndcX)
                .addScaledVector(camUpActual, ndcY)
                .normalize();

              this._primaryRays++;
              const radiance = this.traceRay(camPos, dir, 0);
              r += radiance.r;
              g += radiance.g;
              b += radiance.b;
            }
            const idx = (y * w + x) * 3;
            buf[idx] += r * invSpp;
            buf[idx + 1] += g * invSpp;
            buf[idx + 2] += b * invSpp;
          }
        }
      }
    }

    this.frameCount++;
    this.isAccumulating = false;
    const dt = performance.now() - t0;
    this.stats = {
      frameCount: this.frameCount,
      isAccumulating: this.isAccumulating,
      bvhMeshCount: this._entries.length,
      primaryRays: this._primaryRays,
      shadowRays: this._shadowRays,
      totalRays: this._primaryRays + this._shadowRays + this._indirectRays,
      frameTimeMs: dt,
      samplesPerPixel: this.samplesPerPixel,
      maxBounces: this.maxBounces,
      denoiserEnabled: this.denoiserEnabled,
    };
    log.debug(`render frame ${this.frameCount}: ${dt.toFixed(1)}ms, ${this.stats.totalRays} rays`);
  }

  /** 累积采样(render 的语义别名)。 */
  accumulate(scene: Scene, camera: Camera): void {
    this.render(scene, camera);
  }

  /** 获取累积结果(Uint8ClampedArray RGBA,长度 w*h*4),可选降噪。
   *  像素值 = 累积平均 / frameCount,线性 → sRGB,clamp [0,255]。 */
  getResult(): Uint8ClampedArray {
    const w = this.width;
    const h = this.height;
    const out = new Uint8ClampedArray(w * h * 4);
    const buf = this.accumulationBuffer;
    const inv = this.frameCount > 0 ? 1 / this.frameCount : 0;

    if (this.denoiserEnabled) {
      // 简单 3x3 box blur(线性空间)
      const tmp = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              const i = (yy * w + xx) * 3;
              r += buf[i];
              g += buf[i + 1];
              b += buf[i + 2];
              n++;
            }
          }
          const o = (y * w + x) * 3;
          tmp[o] = (r / n) * inv;
          tmp[o + 1] = (g / n) * inv;
          tmp[o + 2] = (b / n) * inv;
        }
      }
      for (let i = 0; i < w * h; i++) {
        const s = i * 3;
        const d = i * 4;
        out[d] = clamp255(toSRGB(tmp[s]) * 255);
        out[d + 1] = clamp255(toSRGB(tmp[s + 1]) * 255);
        out[d + 2] = clamp255(toSRGB(tmp[s + 2]) * 255);
        out[d + 3] = 255;
      }
    } else {
      for (let i = 0; i < w * h; i++) {
        const s = i * 3;
        const d = i * 4;
        out[d] = clamp255(toSRGB(buf[s] * inv) * 255);
        out[d + 1] = clamp255(toSRGB(buf[s + 1] * inv) * 255);
        out[d + 2] = clamp255(toSRGB(buf[s + 2] * inv) * 255);
        out[d + 3] = 255;
      }
    }
    return out;
  }

  /** 重置累积:buffer 清零,frameCount 归零。 */
  resetAccumulation(): void {
    this.accumulationBuffer.fill(0);
    this.frameCount = 0;
  }

  /** 获取累积缓冲(线性 RGB Float32,长度 w*h*3)。 */
  getAccumulationBuffer(): Float32Array {
    return this.accumulationBuffer;
  }

  /** 获取累积帧数。 */
  getFrameCount(): number {
    return this.frameCount;
  }

  /** 获取统计。 */
  getStats(): RayTracingStats {
    return { ...this.stats };
  }

  /** 释放资源(buffer 清零,引用清空)。 */
  dispose(): void {
    this.accumulationBuffer = new Float32Array(0);
    this._entries = [];
    this._lights = { directionals: [], ambients: [] };
    this.bvh = null;
    this.environmentMap = null;
    this.frameCount = 0;
    this.isAccumulating = false;
    this.width = 0;
    this.height = 0;
    log.info('RayTracingRenderer disposed');
  }

  // ── 光线追踪核心 ─────────────────────────────────────────────────

  /**
   * 追踪光线(递归路径追踪)。
   * @param origin    世界空间射线起点
   * @param direction 世界空间射线方向(归一化)
   * @param depth     当前递归深度
   * @returns 辐射(线性 RGB Color)
   */
  traceRay(origin: Vector3, direction: Vector3, depth: number): Color {
    if (depth >= this.maxDepth || depth >= this.maxBounces) {
      return new Color(0, 0, 0);
    }

    const hit = this.closestHit(origin, direction);
    if (hit === null) {
      return this.miss({ origin, direction });
    }

    return this.shade(hit, direction, depth);
  }

  /**
   * 最近命中(BVH 加速):遍历所有 mesh 的 BVH,返回世界空间最近命中。
   * 无命中返回 null。
   */
  closestHit(origin: Vector3, direction: Vector3): RayTracingHit | null {
    let bestWorldDist = Infinity;
    let bestEntry: MeshBVHEntry | null = null;
    let bestLocalHit: BVHIntersection | null = null;

    const localRay = this._localRay;
    const tmp = this._tmpVec;

    for (const entry of this._entries) {
      // 世界射线 → mesh 局部空间
      localRay.origin.copy(origin).applyMatrix4(entry.inverseMatrix);
      localRay.direction.copy(direction).transformDirection(entry.inverseMatrix);
      // 不归一化方向,使 localHit.distance 与世界距离成比例;但 MeshBVH.raycast
      // 内部用 Ray.at 计算命中点,需要归一化方向以保证 distance 是局部 t。
      // 这里归一化后,distance 即局部距离;世界距离用世界点重算。
      localRay.direction.normalize();

      const hits = entry.bvh.raycast(localRay);
      if (hits.length === 0) continue;
      // hits 按 distance 升序,取第一个
      const localHit = hits[0];
      // 命中点(局部)→ 世界
      tmp.copy(localHit.point).applyMatrix4(entry.worldMatrix);
      const worldDist = tmp.distanceTo(origin);
      if (worldDist < bestWorldDist) {
        bestWorldDist = worldDist;
        bestEntry = entry;
        bestLocalHit = localHit;
      }
    }

    if (bestEntry === null || bestLocalHit === null) return null;

    // 世界法线 = normalMatrix * localNormal(归一化)
    const localNormal = bestLocalHit.face.normal;
    const worldNormal = new Vector3();
    transformNormal(localNormal, bestEntry.normalMatrix, worldNormal).normalize();
    // 若法线背向射线,翻转(双面)
    if (worldNormal.dot(direction) > 0) worldNormal.multiplyScalar(-1);

    // 世界命中点
    const worldPoint = new Vector3();
    worldPoint.copy(bestLocalHit.point).applyMatrix4(bestEntry.worldMatrix);

    return {
      point: worldPoint,
      normal: worldNormal,
      mesh: bestEntry.mesh,
      distance: bestWorldDist,
    };
  }

  /**
   * 任意命中(阴影射线):沿方向在 maxDist 内是否有任何遮挡。
   * 命中返回 true(被遮挡),未命中返回 false(无遮挡)。
   */
  anyHit(origin: Vector3, direction: Vector3, maxDist: number): boolean {
    const localRay = this._localRay;
    const tmp = this._tmpVec;
    const bias = this.shadowBias;

    for (const entry of this._entries) {
      localRay.origin.copy(origin).applyMatrix4(entry.inverseMatrix);
      localRay.direction.copy(direction).transformDirection(entry.inverseMatrix);
      localRay.direction.normalize();

      const hits = entry.bvh.raycast(localRay);
      if (hits.length === 0) continue;
      // 检查最近命中是否在 maxDist 内(世界空间)
      const localHit = hits[0];
      tmp.copy(localHit.point).applyMatrix4(entry.worldMatrix);
      const worldDist = tmp.distanceTo(origin);
      if (worldDist > bias && worldDist < maxDist) {
        return true;
      }
    }
    return false;
  }

  /**
   * 未命中处理:返回环境贴图采样或背景色。
   */
  miss(ray: { origin: Vector3; direction: Vector3 }): Color {
    if (this.environmentMap !== null) {
      const c = this.environmentMap.sample(ray.direction);
      return new Color(
        c.r * this.environmentIntensity,
        c.g * this.environmentIntensity,
        c.b * this.environmentIntensity,
      );
    }
    return this.backgroundColor.clone();
  }

  /**
   * 着色:emissive + 直接光 + 间接光(Russian roulette 终止)。
   * @param hit       命中信息
   * @param direction 入射方向(从上一命中点指向当前命中点,用于求视角 V)
   * @param depth     当前递归深度
   */
  shade(hit: RayTracingHit, direction: Vector3, depth: number): Color {
    const mat = hit.mesh.material;
    let baseColor = new Color(0.8, 0.8, 0.8);
    let emissive = new Color(0, 0, 0);
    let metallic = 0;
    if (isStandardMaterial(mat)) {
      baseColor = new Color(mat.baseColor.r, mat.baseColor.g, mat.baseColor.b);
      emissive = new Color(
        mat.emissive.r * mat.emissiveIntensity,
        mat.emissive.g * mat.emissiveIntensity,
        mat.emissive.b * mat.emissiveIntensity,
      );
      metallic = mat.metallic;
    }

    // 视角 V = -direction(closestHit 已把法线翻向射线,故 N·V > 0)
    const viewFacing = Math.max(0, -hit.normal.dot(direction));

    // 直接光(direct 已包含 N·L 与光色,需再乘 baseColor)
    const direct = this.sampleDirectLight(hit);
    direct.multiply(baseColor);

    const radiance = emissive.clone().add(direct);

    // Russian roulette:depth >= 3 后按 0.5 概率终止
    if (depth >= 3) {
      if (Math.random() < 0.5) {
        return radiance;
      }
      radiance.multiplyScalar(2);
    }

    // 间接光(乘视角朝向因子,避免背面泄漏能量)
    const indirect = this.sampleIndirectLight(hit, depth);
    const tintR = metallic === 0 ? 1 : baseColor.r;
    const tintG = metallic === 0 ? 1 : baseColor.g;
    const tintB = metallic === 0 ? 1 : baseColor.b;
    radiance.r += indirect.r * tintR * viewFacing;
    radiance.g += indirect.g * tintG * viewFacing;
    radiance.b += indirect.b * tintB * viewFacing;

    return radiance;
  }

  /**
   * 采样直接光:对每个方向光发射阴影射线 + Lambert 漫反射。
   * 返回未乘 baseColor 的光照贡献(光线颜色 × 强度 × N·L)。
   */
  sampleDirectLight(hit: RayTracingHit): Color {
    const result = new Color(0, 0, 0);
    const shadowOrigin = hit.point.clone().addScaledVector(hit.normal, this.shadowBias);

    for (const light of this._lights.directionals) {
      const lightDir = new Vector3(
        light.direction.x, light.direction.y, light.direction.z,
      ).normalize().multiplyScalar(-1);
      this._shadowRays++;
      if (!this.anyHit(shadowOrigin, lightDir, Infinity)) {
        const nDotL = Math.max(0, hit.normal.dot(lightDir));
        if (nDotL > 0) {
          result.r += light.color.r * light.intensity * nDotL;
          result.g += light.color.g * light.intensity * nDotL;
          result.b += light.color.b * light.intensity * nDotL;
        }
      }
    }

    // 环境光(无阴影)
    for (const amb of this._lights.ambients) {
      result.r += amb.color.r * amb.intensity;
      result.g += amb.color.g * amb.intensity;
      result.b += amb.color.b * amb.intensity;
    }

    return result;
  }

  /**
   * 采样间接光:cosine 加权半球采样新方向,递归 traceRay。
   */
  sampleIndirectLight(hit: RayTracingHit, depth: number): Color {
    const newDir = cosineSampleHemisphere(hit.normal);
    const newOrigin = hit.point.clone().addScaledVector(hit.normal, this.shadowBias);
    this._indirectRays++;
    return this.traceRay(newOrigin, newDir, depth + 1);
  }

  /**
   * 采样 BRDF(cosine 加权 Lambert,返回反射率 / π)。
   * 简化:仅返回 albedo / π,供外部离线积分验证。
   */
  sampleBRDF(hit: RayTracingHit, wi: Vector3, wo: Vector3): Color {
    const nDotWi = Math.max(0, hit.normal.dot(wi));
    const nDotWo = Math.max(0, hit.normal.dot(wo));
    const mat = hit.mesh.material;
    let r = 0.8, g = 0.8, b = 0.8;
    if (isStandardMaterial(mat)) {
      r = mat.baseColor.r;
      g = mat.baseColor.g;
      b = mat.baseColor.b;
    }
    const k = (nDotWi * nDotWo) / Math.PI;
    return new Color(r * k, g * k, b * k);
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  /** 遍历场景收集光源。 */
  private _collectLights(scene: Scene): void {
    this._lights = { directionals: [], ambients: [] };
    scene.traverse((obj) => {
      if (obj instanceof Light) {
        if (isDirectionalLight(obj)) this._lights.directionals.push(obj);
        else if (isAmbientLight(obj)) this._lights.ambients.push(obj);
      }
    });
  }

  /** 刷新每个 entry 的 inverseMatrix / normalMatrix + 相机 / mesh 世界矩阵。 */
  private _refreshMatrices(camera: Camera): void {
    camera.updateMatrixWorld(true);
    for (const entry of this._entries) {
      entry.mesh.updateMatrixWorld(true);
      entry.worldMatrix = entry.mesh.matrixWorld;
      entry.inverseMatrix.getInverse(entry.mesh.matrixWorld);
      // 法线矩阵 = upper-left 3x3 的 inverse-transpose
      computeNormalMatrix(entry.mesh.matrixWorld, entry.normalMatrix);
    }
  }

  /** 确保 buffer 大小匹配当前 width/height。 */
  private _ensureBufferSize(): void {
    const expected = this.width * this.height * 3;
    if (this.accumulationBuffer.length !== expected) {
      this.accumulationBuffer = new Float32Array(expected);
      this.frameCount = 0;
    }
  }
}

// ── 辅助函数 ─────────────────────────────────────────────────────

/** 法线变换:用 normalMatrix(9 元素 column-major)变换法线。 */
function transformNormal(n: Vector3, nm: Float32Array, out: Vector3): Vector3 {
  // column-major:nm = [m00, m10, m20, m01, m11, m21, m02, m12, m22]
  const x = n.x, y = n.y, z = n.z;
  out.x = nm[0] * x + nm[3] * y + nm[6] * z;
  out.y = nm[1] * x + nm[4] * y + nm[7] * z;
  out.z = nm[2] * x + nm[5] * y + nm[8] * z;
  return out;
}

/** 从 matrix4 计算 upper-left 3x3 的 inverse-transpose,写入 9 元素 column-major。 */
function computeNormalMatrix(matrixWorld: Matrix4, out: Float32Array): void {
  const e = matrixWorld.elements;
  // upper-left 3x3 (column-major in elements[0..8] of Matrix4)
  const a00 = e[0], a10 = e[1], a20 = e[2];
  const a01 = e[4], a11 = e[5], a21 = e[6];
  const a02 = e[8], a12 = e[9], a22 = e[10];
  // 行列式
  const det =
    a00 * (a11 * a22 - a21 * a12) -
    a01 * (a10 * a22 - a20 * a12) +
    a02 * (a10 * a21 - a20 * a11);
  const invDet = Math.abs(det) > 1e-12 ? 1 / det : 0;
  // inverse-transpose:先求 inverse,再转置。等价于把 cofactor 矩阵按 row-major 写入。
  // inverse[i][j] = cofactor[j][i] / det
  // transpose 后 → out(column-major)[col*3 + row] = inverse[row][col] = cofactor[col][row] / det
  // 所以 out[col*3 + row] = cofactor[col][row] * invDet
  // cofactor[col][row]:
  const c00 = (a11 * a22 - a21 * a12) * invDet;
  const c01 = -(a10 * a22 - a20 * a12) * invDet;
  const c02 = (a10 * a21 - a20 * a11) * invDet;
  const c10 = -(a01 * a22 - a21 * a02) * invDet;
  const c11 = (a00 * a22 - a20 * a02) * invDet;
  const c12 = -(a00 * a21 - a20 * a01) * invDet;
  const c20 = (a01 * a12 - a11 * a02) * invDet;
  const c21 = -(a00 * a12 - a10 * a02) * invDet;
  const c22 = (a00 * a11 - a10 * a01) * invDet;
  // out 是 column-major:out[col*3 + row] = cofactor[col][row]
  out[0] = c00; out[3] = c01; out[6] = c02;
  out[1] = c10; out[4] = c11; out[7] = c12;
  out[2] = c20; out[5] = c21; out[8] = c22;
}

/** Cosine 加权半球采样(返回归一化方向)。 */
function cosineSampleHemisphere(normal: Vector3): Vector3 {
  const r1 = Math.random();
  const r2 = Math.random();
  const phi = 2 * Math.PI * r1;
  const cosTheta = Math.sqrt(1 - r2);
  const sinTheta = Math.sqrt(r2);
  const x = sinTheta * Math.cos(phi);
  const y = sinTheta * Math.sin(phi);
  const z = cosTheta;

  let up: Vector3;
  if (Math.abs(normal.z) < 0.999) {
    up = new Vector3(0, 0, 1);
  } else {
    up = new Vector3(1, 0, 0);
  }
  const tangent = normal.clone().cross(up).normalize();
  const bitangent = normal.clone().cross(tangent);

  return new Vector3()
    .copy(tangent).multiplyScalar(x)
    .addScaledVector(bitangent, y)
    .addScaledVector(normal, z)
    .normalize();
}

/** 线性 → sRGB 近似(标准 gamma 2.2)。 */
function toSRGB(c: number): number {
  if (c <= 0) return 0;
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Clamp 到 [0, 255]。 */
function clamp255(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

/** Clamp 到 [lo, hi]。 */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── 类型守卫 ─────────────────────────────────────────────────────

function isStandardMaterial(mat: unknown): mat is StandardMaterial {
  return mat !== null && typeof mat === 'object' && (mat as { type?: string }).type === 'Standard';
}

function isDirectionalLight(obj: unknown): obj is DirectionalLight {
  return obj !== null && typeof obj === 'object' && (obj as { type?: string }).type === 'DirectionalLight';
}

function isAmbientLight(obj: unknown): obj is AmbientLight {
  return obj !== null && typeof obj === 'object' && (obj as { type?: string }).type === 'AmbientLight';
}
