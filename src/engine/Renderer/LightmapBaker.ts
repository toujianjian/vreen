// LightmapBaker — 离线光照贴图烘焙器(CPU 实现)。
//
// 设计:
//   * 输入:Mesh 几何(positions/normals/uv2/indices)+ 光源列表 + 烘焙选项
//   * 输出:Float32Array RGBA(width × height × 4),RGB = 烘焙光照,A = 1
//   * 流程:
//     1) 构建 UV2 → 三角形 索引(网格加速)
//     2) 对每个 lightmap texel:
//        a) 中心 UV → 查找三角形 → 重心坐标 → 世界位置 + 法线
//        b) 直射光:Lambert 漫反射 max(0, N·L) * color * intensity * attenuation
//        c) 环境光:常数 ambient
//        d) 可选:Monte Carlo AO(半球射线采样,统计遮挡率)
//     3) 可选:高斯模糊降噪边缘锯齿
//
// 与实时渲染的关系:
//   * 烘焙结果作为 Mesh 的 lightmap texture,在 fragment shader 中按 UV2 采样,
//     与实时动态光叠加。仅适用于静态几何(动态物体用实时光照)。
//   * 与 PathTracer/GlobalIllumination 互补:PathTracer 是实时近实时全局光,
//     LightmapBaker 是离线高质量静态光,运行时零计算成本。
//
// 参考:
//   - o3de AtomLightmapBaker
//   - Unity Enlighten / Progressive Lightmapper
//   - Unreal Engine Lightmass

import { Vector3 } from '../Math/Vector3';
import type { RGBColor } from '../Lights/Light';

/** 烘焙光源描述(简化:与具体 Light 类解耦,便于外部构造)。 */
export interface BakerLight {
  /** 类型:'directional' | 'point' | 'ambient'。 */
  type: 'directional' | 'point' | 'ambient';
  /** 位置(世界空间,point 用)。接受 Vector3 或 {x,y,z} 字面量。 */
  position?: { x: number; y: number; z: number };
  /** 方向(世界空间,directional 用,从光源指向场景)。接受 Vector3 或 {x,y,z} 字面量。 */
  direction?: { x: number; y: number; z: number };
  /** 颜色 [0,1]^3。 */
  color: RGBColor;
  /** 强度。 */
  intensity: number;
  /** 最大距离(point 用,0 = 无限)。 */
  distance?: number;
  /** 衰减系数(point 用,默认 2 = inverse-square)。 */
  decay?: number;
}

/** 烘焙几何体(扁平数组,与 BufferAttribute 解耦)。 */
export interface BakerGeometry {
  /** 顶点位置(世界空间,扁平 XYZ)。 */
  positions: Float32Array | ArrayLike<number>;
  /** 顶点法线(世界空间,扁平 XYZ)。 */
  normals: Float32Array | ArrayLike<number>;
  /** 第二套 UV(lightmap UV,扁平 UV)。 */
  uv2: Float32Array | ArrayLike<number>;
  /** 三角形索引(可选,无则按顶点数 / 3 处理)。 */
  indices?: Uint16Array | Uint32Array | ArrayLike<number> | null;
}

/** 烘焙选项。 */
export interface BakeOptions {
  /** lightmap 宽度(默认 128)。 */
  width?: number;
  /** lightmap 高度(默认 128)。 */
  height?: number;
  /** 环境光颜色(默认黑)。 */
  ambientColor?: RGBColor;
  /** 环境光强度(默认 0)。 */
  ambientIntensity?: number;
  /** 是否启用 AO(默认 false)。 */
  enableAO?: boolean;
  /** AO 采样数(默认 16)。 */
  aoSamples?: number;
  /** AO 最大距离(默认 1.0)。 */
  aoDistance?: number;
  /** AO 强度(默认 1.0)。 */
  aoStrength?: number;
  /** UV 边距(texel,默认 2,避免相邻三角形渗色)。 */
  padding?: number;
  /** 是否启用高斯模糊后处理(默认 true)。 */
  enableBlur?: boolean;
  /** 模糊核大小(默认 1)。 */
  blurRadius?: number;
  /** 多线程进度回调(每完成一行调用)。 */
  onProgress?: (row: number, totalRows: number) => void;
}

/** 烘焙结果。 */
export interface BakeResult {
  /** 纹素数据(RGBA Float32,长度 = width * height * 4)。 */
  data: Float32Array;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
  /** 有效纹素数(成功映射到三角形的)。 */
  validTexels: number;
  /** 总纹素数。 */
  totalTexels: number;
  /** 烘焙耗时(ms)。 */
  bakingTime: number;
}

// ── 内部工具 ──────────────────────────────────────────────────────

/** 三角形信息(UV2 + 世界坐标)。 */
interface Triangle {
  /** 三角形索引(在 indices 数组中的位置)。 */
  index: number;
  /** 3 个顶点的 UV2。 */
  uvA: [number, number];
  uvB: [number, number];
  uvC: [number, number];
  /** 3 个顶点的世界位置。 */
  posA: Vector3;
  posB: Vector3;
  posC: Vector3;
  /** 3 个顶点的法线。 */
  nrmA: Vector3;
  nrmB: Vector3;
  nrmC: Vector3;
  /** UV 包围盒。 */
  uvMin: [number, number];
  uvMax: [number, number];
}

/** UV 网格索引(加速 texel → triangle 查找)。 */
class UVGrid {
  private cells = new Map<number, Triangle[]>();
  private cols: number;
  private rows: number;
  private cellW: number;
  private cellH: number;

  constructor(triangles: Triangle[], cols = 16, rows = 16) {
    this.cols = cols;
    this.rows = rows;
    this.cellW = 1 / cols;
    this.cellH = 1 / rows;
    // 把每个三角形按其 UV 包围盒分到所有覆盖的 cell
    for (const tri of triangles) {
      const minCx = Math.max(0, Math.floor(tri.uvMin[0] / this.cellW));
      const maxCx = Math.min(cols - 1, Math.floor(tri.uvMax[0] / this.cellW));
      const minCy = Math.max(0, Math.floor(tri.uvMin[1] / this.cellH));
      const maxCy = Math.min(rows - 1, Math.floor(tri.uvMax[1] / this.cellH));
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const key = cy * cols + cx;
          let arr = this.cells.get(key);
          if (!arr) { arr = []; this.cells.set(key, arr); }
          arr.push(tri);
        }
      }
    }
  }

  /** 查询 UV 点所在的候选三角形列表。 */
  query(u: number, v: number): Triangle[] {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(u / this.cellW)));
    const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(v / this.cellH)));
    return this.cells.get(cy * this.cols + cx) ?? [];
  }
}

/** 重心坐标:点 p 在三角形 (a, b, c) 内的 (u, v, w),满足 p = a + u*(b-a) + v*(c-a)。
 *  返回 null 表示点不在三角形内(含容差)。 */
function barycentric(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  tol = 1e-6,
): [number, number, number] | null {
  const v0x = bx - ax, v0y = by - ay;
  const v1x = cx - ax, v1y = cy - ay;
  const v2x = px - ax, v2y = py - ay;
  const denom = v0x * v1y - v1x * v0y;
  if (Math.abs(denom) < 1e-12) return null;
  const v = (v0x * v2y - v2x * v0y) / denom;
  const w = (v2x * v1y - v1x * v2y) / denom;
  const u = 1 - v - w;
  if (u < -tol || v < -tol || w < -tol) return null;
  return [u, v, w];
}

/** 从几何体提取三角形列表。 */
function extractTriangles(geo: BakerGeometry): Triangle[] {
  const positions = geo.positions;
  const normals = geo.normals;
  const uv2 = geo.uv2;
  const indices = geo.indices;
  const nTris = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  const tris: Triangle[] = [];

  const getPos = (i: number, out: Vector3): Vector3 => {
    out.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    return out;
  };
  const getNrm = (i: number, out: Vector3): Vector3 => {
    out.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    return out;
  };

  for (let t = 0; t < nTris; t++) {
    let i0: number, i1: number, i2: number;
    if (indices) {
      i0 = indices[t * 3]; i1 = indices[t * 3 + 1]; i2 = indices[t * 3 + 2];
    } else {
      i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2;
    }
    const posA = getPos(i0, new Vector3());
    const posB = getPos(i1, new Vector3());
    const posC = getPos(i2, new Vector3());
    const nrmA = getNrm(i0, new Vector3());
    const nrmB = getNrm(i1, new Vector3());
    const nrmC = getNrm(i2, new Vector3());
    const ua = uv2[i0 * 2], va = uv2[i0 * 2 + 1];
    const ub = uv2[i1 * 2], vb = uv2[i1 * 2 + 1];
    const uc = uv2[i2 * 2], vc = uv2[i2 * 2 + 1];
    tris.push({
      index: t,
      uvA: [ua, va], uvB: [ub, vb], uvC: [uc, vc],
      posA, posB, posC,
      nrmA, nrmB, nrmC,
      uvMin: [Math.min(ua, ub, uc), Math.min(va, vb, vc)],
      uvMax: [Math.max(ua, ub, uc), Math.max(va, vb, vc)],
    });
  }
  return tris;
}

/** 光线与三角形求交(Möller–Trumbore),返回 t(未命中返回 -1)。 */
function rayTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  maxT: number,
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-10) return -1;
  const invDet = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  if (t < 1e-4 || t > maxT) return -1;
  return t;
}

/** 简单确定性随机数(LCG),避免依赖 Math.random 便于复现。 */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) & 0xffffff) / 0x1000000;
  };
}

/** 余弦加权半球采样(返回单位方向)。 */
function cosineSampleHemisphere(u1: number, u2: number, out: Vector3): Vector3 {
  const r = Math.sqrt(u1);
  const theta = 2 * Math.PI * u2;
  out.set(r * Math.cos(theta), r * Math.sin(theta), Math.sqrt(Math.max(0, 1 - u1)));
  return out;
}

/** 构建 TBN 矩阵的本地版:把局部 +Z 朝向法线 N 的旋转,把 local 向量转到世界空间。 */
function alignToNormal(n: Vector3, local: Vector3, out: Vector3): Vector3 {
  // 选与 n 不平行的辅助向量构造切线
  let tx: number, ty: number, tz: number;
  if (Math.abs(n.z) < 0.999) {
    tx = n.y; ty = -n.x; tz = 0;
  } else {
    tx = 0; ty = 1; tz = 0;
  }
  // T = normalize(T - N*(N·T))
  const ndotT = n.x * tx + n.y * ty + n.z * tz;
  tx -= n.x * ndotT; ty -= n.y * ndotT; tz -= n.z * ndotT;
  const tLen = Math.hypot(tx, ty, tz) || 1;
  tx /= tLen; ty /= tLen; tz /= tLen;
  // B = N × T
  const bx = n.y * tz - n.z * ty;
  const by = n.z * tx - n.x * tz;
  const bz = n.x * ty - n.y * tx;
  out.x = tx * local.x + bx * local.y + n.x * local.z;
  out.y = ty * local.x + by * local.y + n.y * local.z;
  out.z = tz * local.x + bz * local.y + n.z * local.z;
  return out;
}

/** 高斯模糊(单通道 RGB,3x3 或 5x5)。 */
function gaussianBlur(data: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return data;
  const out = new Float32Array(data.length);
  // 简单可分离高斯:水平 + 垂直
  const sigma = radius * 0.5 + 0.5;
  const kernelSize = Math.ceil(radius * 2) + 1;
  const kernel = new Float32Array(kernelSize);
  const half = Math.floor(kernelSize / 2);
  let kSum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    kSum += kernel[i];
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= kSum;

  const tmp = new Float32Array(data.length);
  // 水平
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < kernelSize; k++) {
        const sx = Math.max(0, Math.min(width - 1, x + k - half));
        const idx = (y * width + sx) * 4;
        const w = kernel[k];
        r += data[idx] * w;
        g += data[idx + 1] * w;
        b += data[idx + 2] * w;
      }
      const o = (y * width + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = 1;
    }
  }
  // 垂直
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < kernelSize; k++) {
        const sy = Math.max(0, Math.min(height - 1, y + k - half));
        const idx = (sy * width + x) * 4;
        const w = kernel[k];
        r += tmp[idx] * w;
        g += tmp[idx + 1] * w;
        b += tmp[idx + 2] * w;
      }
      const o = (y * width + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 1;
    }
  }
  return out;
}

// ── 主类 ──────────────────────────────────────────────────────────

export class LightmapBaker {
  /** 烘焙。 */
  bake(geometry: BakerGeometry, lights: BakerLight[], options: BakeOptions = {}): BakeResult {
    const width = options.width ?? 128;
    const height = options.height ?? 128;
    const ambientColor = options.ambientColor ?? { r: 0, g: 0, b: 0 };
    const ambientIntensity = options.ambientIntensity ?? 0;
    const enableAO = options.enableAO ?? false;
    const aoSamples = options.aoSamples ?? 16;
    const aoDistance = options.aoDistance ?? 1.0;
    const aoStrength = options.aoStrength ?? 1.0;
    const enableBlur = options.enableBlur ?? true;
    const blurRadius = options.blurRadius ?? 1;

    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // 1) 提取三角形
    const tris = extractTriangles(geometry);
    const grid = new UVGrid(tris);

    // 2) 烘焙每个 texel
    const data = new Float32Array(width * height * 4);
    let validTexels = 0;
    const totalTexels = width * height;
    const rng = makeRng(0xdeadbeef);
    const _localDir = new Vector3();
    const _worldDir = new Vector3();
    const _normal = new Vector3();
    const _pos = new Vector3();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // 默认黑色
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 1;

        // texel 中心 UV
        const u = (x + 0.5) / width;
        const v = (y + 0.5) / height;

        // 查询候选三角形
        const candidates = grid.query(u, v);
        let hitTri: Triangle | null = null;
        let hitBary: [number, number, number] | null = null;
        for (const tri of candidates) {
          const bary = barycentric(
            u, v,
            tri.uvA[0], tri.uvA[1],
            tri.uvB[0], tri.uvB[1],
            tri.uvC[0], tri.uvC[1],
          );
          if (bary) {
            hitTri = tri;
            hitBary = bary;
            break;
          }
        }
        if (!hitTri || !hitBary) continue;
        validTexels++;

        // 重心坐标插值得到世界位置 + 法线
        const [ba, bb, bc] = hitBary;
        _pos.set(0, 0, 0);
        _pos.x = hitTri.posA.x * ba + hitTri.posB.x * bb + hitTri.posC.x * bc;
        _pos.y = hitTri.posA.y * ba + hitTri.posB.y * bb + hitTri.posC.y * bc;
        _pos.z = hitTri.posA.z * ba + hitTri.posB.z * bb + hitTri.posC.z * bc;
        _normal.set(0, 0, 0);
        _normal.x = hitTri.nrmA.x * ba + hitTri.nrmB.x * bb + hitTri.nrmC.x * bc;
        _normal.y = hitTri.nrmA.y * ba + hitTri.nrmB.y * bb + hitTri.nrmC.y * bc;
        _normal.z = hitTri.nrmA.z * ba + hitTri.nrmB.z * bb + hitTri.nrmC.z * bc;
        const nLen = _normal.length();
        if (nLen > 1e-10) _normal.multiplyScalar(1 / nLen);

        // 累积光照
        let r = 0, g = 0, b = 0;

        // 环境光
        r += ambientColor.r * ambientIntensity;
        g += ambientColor.g * ambientIntensity;
        b += ambientColor.b * ambientIntensity;

        // 直射光
        for (const light of lights) {
          if (light.type === 'ambient') {
            r += light.color.r * light.intensity;
            g += light.color.g * light.intensity;
            b += light.color.b * light.intensity;
            continue;
          }
          let lx = 0, ly = 0, lz = 0; // 光方向(从表面指向光源)
          let attenuation = 1;
          if (light.type === 'directional') {
            // 方向光:方向是从光源指向场景,L = -direction
            lx = -light.direction!.x;
            ly = -light.direction!.y;
            lz = -light.direction!.z;
            const lLen = Math.hypot(lx, ly, lz) || 1;
            lx /= lLen; ly /= lLen; lz /= lLen;
          } else if (light.type === 'point') {
            lx = light.position!.x - _pos.x;
            ly = light.position!.y - _pos.y;
            lz = light.position!.z - _pos.z;
            const dist = Math.hypot(lx, ly, lz);
            if (dist < 1e-6) continue;
            lx /= dist; ly /= dist; lz /= dist;
            const distMax = light.distance ?? 0;
            const decay = light.decay ?? 2;
            if (distMax > 0 && dist >= distMax) continue;
            // 物理衰减:1 / dist^decay,距离过近时钳制
            const dEff = Math.max(dist, 0.01);
            attenuation = 1 / Math.pow(dEff, decay);
            if (distMax > 0) {
              // 距离边缘平滑过渡
              const edge = 1 - Math.pow(dist / distMax, 4);
              attenuation *= Math.max(0, edge);
            }
          }
          // Lambert 漫反射:max(0, N·L) * color * intensity * attenuation
          const ndotl = _normal.x * lx + _normal.y * ly + _normal.z * lz;
          if (ndotl <= 0) continue;
          const factor = ndotl * light.intensity * attenuation;
          r += light.color.r * factor;
          g += light.color.g * factor;
          b += light.color.b * factor;
        }

        // AO:Monte Carlo 半球采样
        if (enableAO && aoSamples > 0) {
          let occluded = 0;
          for (let s = 0; s < aoSamples; s++) {
            const u1 = rng();
            const u2 = rng();
            cosineSampleHemisphere(u1, u2, _localDir);
            alignToNormal(_normal, _localDir, _worldDir);
            const wLen = _worldDir.length() || 1;
            _worldDir.multiplyScalar(1 / wLen);
            // 沿 _worldDir 方向投射射线
            let hit = false;
            for (const tri of tris) {
              if (tri === hitTri) continue;
              const t = rayTriangle(
                _pos.x, _pos.y, _pos.z,
                _worldDir.x, _worldDir.y, _worldDir.z,
                tri.posA.x, tri.posA.y, tri.posA.z,
                tri.posB.x, tri.posB.y, tri.posB.z,
                tri.posC.x, tri.posC.y, tri.posC.z,
                aoDistance,
              );
              if (t > 0) { hit = true; break; }
            }
            if (hit) occluded++;
          }
          const ao = 1 - (occluded / aoSamples) * aoStrength;
          r *= ao; g *= ao; b *= ao;
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 1;
      }
      if (options.onProgress) options.onProgress(y + 1, height);
    }

    // 3) 可选:高斯模糊降噪
    if (enableBlur && blurRadius > 0) {
      const blurred = gaussianBlur(data, width, height, blurRadius);
      // 把无效 texel(原为 0)的模糊结果清零,避免边缘渗色
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) {
          blurred[i] = 0; blurred[i + 1] = 0; blurred[i + 2] = 0;
        }
      }
      for (let i = 0; i < data.length; i++) data[i] = blurred[i];
    }

    const endTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return {
      data,
      width,
      height,
      validTexels,
      totalTexels,
      bakingTime: endTime - startTime,
    };
  }
}
