// PathTracer — CPU 简化路径追踪器(参考/验证用)。
//
// 设计目标:
//   - 不用于实时渲染(纯 CPU,每帧毫秒级到秒级)
//   - 提供离线渲染参考图,用于验证 PBR/材质参数
//   - 支持渐进式累积:多次 render() 调用累积采样,getResult() 返回平均结果
//   - 复用引擎自身的 Ray / Vector3 / BufferGeometry / Mesh 抽象
//
// 算法:
//   - 每像素发射 samplesPerPixel 条主射线(随机抖动)
//   - 每条射线在场景中迭代反弹,最多 maxBounces 次
//   - 命中时按 BRDF 采样新方向(Lambert 漫反射 + 简化金属反射)
//   - 直接光照:每次命中后向光源发射 shadow ray
//   - Russian roulette 在 bounce >= 3 时按 0.5 概率终止路径
//   - accumulationBuffer 累积 Radiance(线性 RGB float),getResult() 平均
//
// 局限:
//   - 仅识别 StandardMaterial 的 baseColor / metallic / roughness / emissive
//   - 仅识别 DirectionalLight / AmbientLight(PointLight 暂未支持)
//   - 无 BVH 加速(暴力遍历所有三角形);适合 < 10k 三角形场景
//   - 无重要性采样(纯 cosine 采样)
//
// 用法:
//   const pt = new PathTracer({ width: 256, height: 256, samplesPerPixel: 4 });
//   pt.reset();
//   for (let i = 0; i < 32; i++) pt.render(scene, camera);  // 累积 32 帧
//   const pixels = pt.getResult();  // Uint8ClampedArray, length = w*h*4

import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { Mesh } from '../Core/Mesh';
import type { Scene } from '../Core/Scene';
import type { Camera } from '../Cameras/Camera';
import type { StandardMaterial } from '../Materials/StandardMaterial';
import type { DirectionalLight } from '../Lights/DirectionalLight';
import type { AmbientLight } from '../Lights/AmbientLight';
import { Light } from '../Lights/Light';

export interface PathTracerOptions {
  /** 最大反弹次数(默认 8)。 */
  maxBounces?: number;
  /** 每像素采样数(默认 4)。 */
  samplesPerPixel?: number;
  /** 渲染宽度(像素)。 */
  width?: number;
  /** 渲染高度(像素)。 */
  height?: number;
  /** 阴影射线偏移(避免自相交,默认 1e-4)。 */
  shadowBias?: number;
  /** 背景色(射线未命中时,默认黑)。 */
  backgroundColor?: Color;
}

/** 命中信息:最近三角形 + 命中点 + 法线 + mesh。 */
interface HitResult {
  t: number;
  point: Vector3;
  normal: Vector3;
  mesh: Mesh;
}

/** 收集到的光源。 */
interface LightCollection {
  directionals: DirectionalLight[];
  ambients: AmbientLight[];
}

export class PathTracer {
  /** 最大反弹次数。 */
  maxBounces: number;
  /** 每像素采样数。 */
  samplesPerPixel: number;
  /** 渲染宽度。 */
  width: number;
  /** 渲染高度。 */
  height: number;
  /** 阴影射线偏移。 */
  shadowBias: number;
  /** 背景色。 */
  backgroundColor: Color;

  /** 累积缓冲(线性 RGB,长度 width*height*3)。 */
  accumulationBuffer: Float32Array;
  /** 累积帧数。 */
  frameCount: number;

  /** 缓存的场景 mesh 列表(render 时刷新)。 */
  private _meshes: Mesh[] = [];
  /** 缓存的光源列表(render 时刷新)。 */
  private _lights: LightCollection = { directionals: [], ambients: [] };

  constructor(opts: PathTracerOptions = {}) {
    this.maxBounces = opts.maxBounces ?? 8;
    this.samplesPerPixel = opts.samplesPerPixel ?? 4;
    this.width = opts.width ?? 256;
    this.height = opts.height ?? 256;
    this.shadowBias = opts.shadowBias ?? 1e-4;
    this.backgroundColor = opts.backgroundColor ? opts.backgroundColor.clone() : new Color(0, 0, 0);
    this.accumulationBuffer = new Float32Array(this.width * this.height * 3);
    this.frameCount = 0;
  }

  /** 渲染一帧:对每个像素发射 samplesPerPixel 条射线,累加到 accumulationBuffer。
   *  frameCount 自增。多次调用可累积以降低噪声。 */
  render(scene: Scene, camera: Camera): void {
    this._collectScene(scene);
    this._ensureBufferSize();

    const w = this.width;
    const h = this.height;
    const spp = this.samplesPerPixel;
    const aspect = w / h;

    // 相机参数:从 camera.matrixWorld + projectionMatrix 反推 fov / 位置 / 朝向
    camera.updateWorldMatrix(true, false);
    // matrixWorld 是 column-major 4x4,平移分量在 elements[12..14]
    const camElems = camera.matrixWorld.elements;
    const camPos = new Vector3(camElems[12], camElems[13], camElems[14]);
    const camDir = new Vector3();
    camera.getWorldDirection(camDir);
    const camUp = new Vector3(0, 1, 0);
    // 右 = 前 × 上
    const camRight = camDir.clone().cross(camUp).normalize();
    const camUpActual = camRight.clone().cross(camDir).normalize();

    // 视锥参数(简化:假设 perspective,fov = 60°)
    const fov = 60 * Math.PI / 180;
    const halfHeight = Math.tan(fov / 2);
    const halfWidth = halfHeight * aspect;

    const buf = this.accumulationBuffer;
    const invSpp = 1 / spp;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let s = 0; s < spp; s++) {
          // 像素内随机抖动 [0,1)
          const u = (x + Math.random()) / w;
          const v = (y + Math.random()) / h;
          // NDC [-1, 1]
          const ndcX = (u * 2 - 1) * halfWidth;
          const ndcY = (1 - v * 2) * halfHeight; // Y 翻转
          // 射线方向 = forward + right * ndcX + up * ndcY
          const dir = new Vector3()
            .copy(camDir)
            .addScaledVector(camRight, ndcX)
            .addScaledVector(camUpActual, ndcY)
            .normalize();

          const ray = new Ray(camPos.clone(), dir);
          const radiance = this._trace(ray, 0);
          r += radiance.r;
          g += radiance.g;
          b += radiance.b;
        }
        // 平均并累积到 buffer
        const idx = (y * w + x) * 3;
        buf[idx] += r * invSpp;
        buf[idx + 1] += g * invSpp;
        buf[idx + 2] += b * invSpp;
      }
    }

    this.frameCount++;
  }

  /** 累积采样(render 的别名,语义化)。 */
  accumulate(scene: Scene, camera: Camera): void {
    this.render(scene, camera);
  }

  /** 获取累积结果(Uint8ClampedArray,RGBA,长度 width*height*4)。
   *  像素值 = 累积平均 / frameCount,然后 clamp 到 [0,255]。 */
  getResult(): Uint8ClampedArray {
    const w = this.width;
    const h = this.height;
    const out = new Uint8ClampedArray(w * h * 4);
    const buf = this.accumulationBuffer;
    const inv = this.frameCount > 0 ? 1 / this.frameCount : 0;
    for (let i = 0; i < w * h; i++) {
      const src = i * 3;
      const dst = i * 4;
      // 线性 → sRGB 近似(伽马 2.2)
      const r = toSRGB(buf[src] * inv);
      const g = toSRGB(buf[src + 1] * inv);
      const b = toSRGB(buf[src + 2] * inv);
      out[dst] = clamp255(r * 255);
      out[dst + 1] = clamp255(g * 255);
      out[dst + 2] = clamp255(b * 255);
      out[dst + 3] = 255;
    }
    return out;
  }

  /** 重置累积:buffer 清零,frameCount 归零。 */
  reset(): void {
    this.accumulationBuffer.fill(0);
    this.frameCount = 0;
  }

  /** 设置最大反弹次数(并 reset 累积)。 */
  setBounces(n: number): void {
    if (n < 1) n = 1;
    if (n > 64) n = 64;
    this.maxBounces = n;
    this.reset();
  }

  /** 设置每像素采样数(并 reset 累积)。 */
  setSamples(n: number): void {
    if (n < 1) n = 1;
    if (n > 256) n = 256;
    this.samplesPerPixel = n;
    this.reset();
  }

  /** 调整渲染分辨率(并 reset 累积)。 */
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.accumulationBuffer = new Float32Array(this.width * this.height * 3);
    this.frameCount = 0;
  }

  /** 释放资源(buffer 清零,引用清空)。 */
  dispose(): void {
    this.accumulationBuffer = new Float32Array(0);
    this._meshes = [];
    this._lights = { directionals: [], ambients: [] };
    this.frameCount = 0;
    this.width = 0;
    this.height = 0;
  }

  // ---------- 内部实现 ----------

  /** 遍历场景,收集 mesh 与光源。 */
  private _collectScene(scene: Scene): void {
    this._meshes = [];
    this._lights = { directionals: [], ambients: [] };
    scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        // 跳过无 position attribute 的 mesh
        if (obj.geometry.attributes.position) {
          this._meshes.push(obj);
        }
      } else if (obj instanceof Light) {
        if (isDirectionalLight(obj)) this._lights.directionals.push(obj);
        else if (isAmbientLight(obj)) this._lights.ambients.push(obj);
      }
    });
  }

  /** 确保 buffer 大小匹配当前 width/height。 */
  private _ensureBufferSize(): void {
    const expected = this.width * this.height * 3;
    if (this.accumulationBuffer.length !== expected) {
      this.accumulationBuffer = new Float32Array(expected);
      this.frameCount = 0;
    }
  }

  /** 路径追踪主循环:从 ray 出发,迭代反弹直到命中光源/背景或达到 maxBounces。 */
  private _trace(ray: Ray, depth: number): Color {
    if (depth >= this.maxBounces) {
      return new Color(0, 0, 0);
    }

    const hit = this._intersectScene(ray);
    if (hit === null) {
      // 未命中 → 返回背景色
      return this.backgroundColor.clone();
    }

    // 取材质参数(只识别 StandardMaterial,其余退化为灰)
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

    // 累积辐射:emissive + 直接光照 + 间接
    const radiance = emissive.clone();

    // 直接光照:对每个方向光发射 shadow ray
    for (const light of this._lights.directionals) {
      const lightDir = new Vector3(
        light.direction.x, light.direction.y, light.direction.z,
      ).normalize().multiplyScalar(-1); // 朝向光源
      const shadowOrigin = hit.point.clone().addScaledVector(hit.normal, this.shadowBias);
      const shadowRay = new Ray(shadowOrigin, lightDir);
      if (this._intersectScene(shadowRay) === null) {
        // 无遮挡 → Lambert
        const nDotL = Math.max(0, hit.normal.dot(lightDir));
        if (nDotL > 0) {
          const lc = light.color;
          const li = light.intensity;
          const contribution = nDotL * li;
          radiance.r += baseColor.r * lc.r * contribution;
          radiance.g += baseColor.g * lc.g * contribution;
          radiance.b += baseColor.b * lc.b * contribution;
        }
      }
    }

    // 环境光
    for (const amb of this._lights.ambients) {
      radiance.r += baseColor.r * amb.color.r * amb.intensity;
      radiance.g += baseColor.g * amb.color.g * amb.intensity;
      radiance.b += baseColor.b * amb.color.b * amb.intensity;
    }

    // Russian roulette:depth >= 3 后按 0.5 概率终止
    if (depth >= 3) {
      if (Math.random() < 0.5) {
        return radiance;
      }
      // 补偿能量
      radiance.multiplyScalar(2);
    }

    // 间接光照:cosine 采样新方向
    const newDir = cosineSampleHemisphere(hit.normal);
    const newOrigin = hit.point.clone().addScaledVector(hit.normal, this.shadowBias);
    const newRay = new Ray(newOrigin, newDir);
    const indirect = this._trace(newRay, depth + 1);

    // 金属度混合:metallic=1 时按 baseColor 染色,否则白
    const tintR = metallic === 0 ? 1 : baseColor.r;
    const tintG = metallic === 0 ? 1 : baseColor.g;
    const tintB = metallic === 0 ? 1 : baseColor.b;

    // cosine 加权采样时 BRDF/pdf = albedo/π * π = albedo
    radiance.r += indirect.r * tintR;
    radiance.g += indirect.g * tintG;
    radiance.b += indirect.b * tintB;

    return radiance;
  }

  /** 暴力遍历所有 mesh 的所有三角形,返回最近命中。
   *  使用局部 scratch 变量避免模块级复用导致的覆盖问题。 */
  private _intersectScene(ray: Ray): HitResult | null {
    let closestT = Infinity;
    let closestHit: HitResult | null = null;

    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();

    for (const mesh of this._meshes) {
      const geom = mesh.geometry;
      const posAttr = geom.attributes.position;
      if (!posAttr) continue;
      const positions = posAttr.array;
      const indexAttr = geom.index;
      const triangleCount = indexAttr ? indexAttr.array.length / 3 : positions.length / 9;

      for (let i = 0; i < triangleCount; i++) {
        let i0: number, i1: number, i2: number;
        if (indexAttr) {
          i0 = indexAttr.array[i * 3];
          i1 = indexAttr.array[i * 3 + 1];
          i2 = indexAttr.array[i * 3 + 2];
        } else {
          i0 = i * 3;
          i1 = i * 3 + 1;
          i2 = i * 3 + 2;
        }

        // 顶点位置(局部 → 世界)
        getVertex(positions, i0, a);
        getVertex(positions, i1, b);
        getVertex(positions, i2, c);
        a.applyMatrix4(mesh.matrixWorld);
        b.applyMatrix4(mesh.matrixWorld);
        c.applyMatrix4(mesh.matrixWorld);

        // Möller–Trumbore
        const t = mollerTrumbore(ray, a, b, c);
        if (t === null) continue;
        if (t < closestT) {
          closestT = t;
          if (closestHit === null) {
            closestHit = { t, point: new Vector3(), normal: new Vector3(), mesh };
          } else {
            closestHit.t = t;
            closestHit.mesh = mesh;
          }
          ray.at(t, closestHit.point);
          // 法线 = (b-a) × (c-a),归一化
          const e1 = b.clone().sub(a);
          const e2 = c.clone().sub(a);
          closestHit.normal.copy(e1.clone().cross(e2)).normalize();
          // 若法线背向射线,翻转(双面)
          if (closestHit.normal.dot(ray.direction) > 0) {
            closestHit.normal.multiplyScalar(-1);
          }
        }
      }
    }

    return closestHit;
  }
}

// ---------- 辅助函数 ----------

/** Möller–Trumbore 射线-三角形求交,返回 t 或 null。
 *  使用纯局部变量,不依赖外部 scratch,避免共享覆盖。 */
function mollerTrumbore(ray: Ray, a: Vector3, b: Vector3, c: Vector3): number | null {
  const EPSILON = 1e-9;
  const edge1x = b.x - a.x, edge1y = b.y - a.y, edge1z = b.z - a.z;
  const edge2x = c.x - a.x, edge2y = c.y - a.y, edge2z = c.z - a.z;

  // h = cross(ray.direction, edge2)
  const hx = ray.direction.y * edge2z - ray.direction.z * edge2y;
  const hy = ray.direction.z * edge2x - ray.direction.x * edge2z;
  const hz = ray.direction.x * edge2y - ray.direction.y * edge2x;

  // det = dot(edge1, h)
  const det = edge1x * hx + edge1y * hy + edge1z * hz;
  if (det > -EPSILON && det < EPSILON) return null; // 平行
  const invDet = 1 / det;

  // s = ray.origin - a
  const sx = ray.origin.x - a.x;
  const sy = ray.origin.y - a.y;
  const sz = ray.origin.z - a.z;

  // u = dot(s, h) * invDet
  const u = (sx * hx + sy * hy + sz * hz) * invDet;
  if (u < 0 || u > 1) return null;

  // q = cross(s, edge1)
  const qx = sy * edge1z - sz * edge1y;
  const qy = sz * edge1x - sx * edge1z;
  const qz = sx * edge1y - sy * edge1x;

  // v = dot(ray.direction, q) * invDet
  const v = (ray.direction.x * qx + ray.direction.y * qy + ray.direction.z * qz) * invDet;
  if (v < 0 || u + v > 1) return null;

  // t = dot(edge2, q) * invDet
  const t = (edge2x * qx + edge2y * qy + edge2z * qz) * invDet;
  return t > EPSILON ? t : null;
}

/** 从 position array 取第 i 个顶点。 */
function getVertex(positions: ArrayLike<number>, i: number, out: Vector3): void {
  out.x = positions[i * 3];
  out.y = positions[i * 3 + 1];
  out.z = positions[i * 3 + 2];
}

/** Cosine 加权半球采样(返回归一化方向)。 */
function cosineSampleHemisphere(normal: Vector3): Vector3 {
  // 在单位圆盘上随机采样,投影到半球
  const r1 = Math.random();
  const r2 = Math.random();
  const phi = 2 * Math.PI * r1;
  const cosTheta = Math.sqrt(1 - r2); // cosine-weighted: cos(theta) = sqrt(1 - r2)
  const sinTheta = Math.sqrt(r2);
  // 局部坐标系(法线为 z 轴)
  const x = sinTheta * Math.cos(phi);
  const y = sinTheta * Math.sin(phi);
  const z = cosTheta;

  // 构建 TBN(法线为 N)
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
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Clamp 到 [0, 255]。 */
function clamp255(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

// ---------- 类型守卫 ----------

function isStandardMaterial(mat: unknown): mat is StandardMaterial {
  return mat !== null && typeof mat === 'object' && (mat as { type?: string }).type === 'Standard';
}

function isDirectionalLight(obj: unknown): obj is DirectionalLight {
  return obj !== null && typeof obj === 'object' && (obj as { type?: string }).type === 'DirectionalLight';
}

function isAmbientLight(obj: unknown): obj is AmbientLight {
  return obj !== null && typeof obj === 'object' && (obj as { type?: string }).type === 'AmbientLight';
}
