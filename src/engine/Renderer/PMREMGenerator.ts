// PMREMGenerator — 预滤波 mipmap 辐照度环境贴图生成器 (CPU 实现)。
//
// 适配自 three.js `PMREMGenerator.js`,遵循 VREEN 无头约定:不调用 GL,
// 纯 CPU 计算,可在 Node / 测试环境运行。
//
// 核心算法:Karis 2013 "Real Shading in Unreal Engine 4" split-sum 近似。
//   1. 预滤波 (specular IBL):对每个输出 texel(方向 N,粗糙度 α)用
//      GGX 重要性采样累积入射辐亮度 L,权重为 NoL。输出 cube mip 链,
//      每级 mip 对应一个 α(从 0 到 1)。
//   2. 漫反射辐照度 (diffuse IBL):余弦加权半球卷积,输出单层 cube。
//      可用 LightProbeGenerator 的 SH2 替代(更低频、更省内存)。
//
// 用途:
//   - PBR 材质的环境反射(specular lobe,按粗糙度查 mip)
//   - PBR 材质的漫反射环境光(diffuse lobe)
//   - 消费 CubeCamera / RoomEnvironment 的输出
//   - IBL 管线的核心组件
//
// 与 three.js 的差异:
//   - three.js PMREMGenerator 直接调 GL(render-to-cube + fragment shader 卷积)。
//   - VREEN PMREMGenerator 纯 CPU;输出是数据(Float32Array),不持有 GL handle。
//   - 采样器使用 Hammersley 低差异序列(three.js 也用),可配置样本数。
//
// 参考:
//   - Karis 2013, "Real Shading in Unreal Engine 4"
//   - three.js src/extras/PMREMGenerator.js
//   - o3de Atom ImageBasedLightProcessor

import type { EnvironmentCubeData, CubeFaceData } from './RoomEnvironment';

// ── 输出类型 ──────────────────────────────────────────────────

/** 单面单 mip 的 RGB 数据。 */
export interface PMREMFaceMip {
  width: number;
  height: number;
  /** RGB float 数据,length = width * height * 3。HDR(值可 > 1)。 */
  data: Float32Array;
}

/** 单面的 mip 链。 */
export interface PMREMFace {
  /** 面名:'+x' | '-x' | '+y' | '-y' | '+z' | '-z'。 */
  face: string;
  /** mip 链,mips[0] = 最高分辨率(最光滑),mips[last] = 最低(最粗糙)。 */
  mips: PMREMFaceMip[];
}

/** 完整的 PMREM 数据(6 面 × mip 链)。 */
export interface PMREMData {
  /** 最高 mip 的面边长(像素)。 */
  size: number;
  /** mip 级数。 */
  mipCount: number;
  /** 6 面,顺序:+x, -x, +y, -y, +z, -z。 */
  faces: PMREMFace[];
}

/** PMREMGenerator 构造选项。 */
export interface PMREMGeneratorOptions {
  /**
   * 每个输出 texel 的最大采样数(重要性采样)。默认 32。
   * 更高 = 更高质量但更慢。mip 0(α=0)始终为 1 样本(直接拷贝)。
   */
  samples?: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 面名顺序(与 RoomEnvironment / LightProbeGenerator 一致)。 */
const FACE_NAMES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;

/** 最小面边长(低于此值无意义)。 */
const MIN_SIZE = 4;

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * Van der Corput 根逆(radical inverse)基 2。
 * 用于 Hammersley 低差异序列:第 i 个点 = (i/N, radicalInverse_2(i))。
 */
function vanDerCorput(bits: number): number {
  bits = (bits << 16) | (bits >>> 16);
  bits = ((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1);
  bits = ((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2);
  bits = ((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4);
  bits = ((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8);
  return (bits >>> 0) * 2.3283064365386963e-10; // 1 / 2^32
}

// ── 立方体采样 ────────────────────────────────────────────────
// 面方向映射与 LightProbeGenerator.cubeMapTexelDirection 保持一致。
// 该函数导出供测试验证方向一致性。

/**
 * 立方体某面 texel 中心对应的世界空间方向。
 *
 * @param face 面索引 0-5 (+x, -x, +y, -y, +z, -z)。
 * @param x    texel X 坐标 [0, size)。
 * @param y    texel Y 坐标 [0, size)。
 * @param size 面边长。
 * @param out  输出向量(避免分配)。
 */
function cubeTexelDirection(
  face: number, x: number, y: number, size: number,
  out: { x: number; y: number; z: number },
): void {
  const u = (2 * (x + 0.5) / size) - 1;
  const v = (2 * (y + 0.5) / size) - 1;
  let dx: number, dy: number, dz: number;
  switch (face) {
    case 0: dx = 1;  dy = -v; dz = -u; break; // +X
    case 1: dx = -1; dy = -v; dz =  u; break; // -X
    case 2: dx = u;  dy =  1; dz =  v; break; // +Y
    case 3: dx = u;  dy = -1; dz = -v; break; // -Y
    case 4: dx = u;  dy = -v; dz =  1; break; // +Z
    default: dx = -u; dy = -v; dz = -1; break; // -Z
  }
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const inv = len > 0 ? 1 / len : 0;
  out.x = dx * inv;
  out.y = dy * inv;
  out.z = dz * inv;
}

/** 临时向量,避免在热循环中分配。 */
const _dir = { x: 0, y: 0, z: 0 };

/**
 * 从方向向量采样立方体贴图(三线性插值)。
 *
 * @param cube   源立方体贴图数据。
 * @param dx,dy,dz 采样方向(归一化)。
 * @param out    输出 RGB(长度 3)。
 */
function sampleCube(
  cube: EnvironmentCubeData,
  dx: number, dy: number, dz: number,
  out: Float32Array,
): void {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  let face: number;
  let uc: number, vc: number; // [-1, 1] 面内坐标
  let ma: number;             // 主轴绝对值

  if (ax >= ay && ax >= az) {
    face = dx > 0 ? 0 : 1;
    ma = ax;
    if (dx > 0) { uc = -dz; vc = -dy; }
    else        { uc =  dz; vc = -dy; }
  } else if (ay >= ax && ay >= az) {
    face = dy > 0 ? 2 : 3;
    ma = ay;
    if (dy > 0) { uc = dx; vc = dz; }
    else        { uc = dx; vc = -dz; }
  } else {
    face = dz > 0 ? 4 : 5;
    ma = az;
    if (dz > 0) { uc = dx;  vc = -dy; }
    else        { uc = -dx; vc = -dy; }
  }

  // 映射到 [0, size) texel 坐标(带 0.5 偏移取中心)
  const size = cube.size;
  const invMa = ma > 0 ? 1 / ma : 0;
  const u = 0.5 * (uc * invMa + 1) * size - 0.5;
  const v = 0.5 * (vc * invMa + 1) * size - 0.5;

  // clamp 到有效范围
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(u)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(v)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = u - x0;
  const fy = v - y0;

  const faceData = cube.faces[face].data;
  const stride = 3; // RGB
  const i00 = (y0 * size + x0) * stride;
  const i10 = (y0 * size + x1) * stride;
  const i01 = (y1 * size + x0) * stride;
  const i11 = (y1 * size + x1) * stride;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  for (let c = 0; c < 3; c++) {
    out[c] =
      faceData[i00 + c] * w00 +
      faceData[i10 + c] * w10 +
      faceData[i01 + c] * w01 +
      faceData[i11 + c] * w11;
  }
}

// ── GGX 重要性采样 ────────────────────────────────────────────

/**
 * GGX 重要性采样:生成半程向量 H(切线空间)。
 *
 * 给定低差异样本 (ξ1, ξ2) 和粗糙度 α:
 *   φ = 2π * ξ1
 *   θ = acos(sqrt((1 - ξ2) / ((α² - 1) * ξ2 + 1)))
 *   H_tangent = (sin θ cos φ, sin θ sin φ, cos θ)
 *
 * @param xi1  第一个样本 ∈ [0, 1)。
 * @param xi2  第二个样本 ∈ [0, 1)。
 * @param alpha 粗糙度(已平方的 perceptual roughness²)。
 * @param out  输出 H(切线空间,归一化)。
 */
function importanceSampleGGX(
  xi1: number, xi2: number, alpha: number,
  out: { x: number; y: number; z: number },
): void {
  const phi = 2 * Math.PI * xi1;
  const a2 = alpha * alpha;
  const cosTheta2 = (1 - xi2) / ((a2 - 1) * xi2 + 1);
  const cosTheta = Math.sqrt(Math.max(0, cosTheta2));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta2));
  out.x = sinTheta * Math.cos(phi);
  out.y = sinTheta * Math.sin(phi);
  out.z = cosTheta;
}

/**
 * 构建正交基(T, B, N)使得 T × B = N。
 * 输入 N(法线),输出 T(切线)和 B(副切线)。
 */
function buildTangentFrame(
  nx: number, ny: number, nz: number,
  outT: { x: number; y: number; z: number },
  outB: { x: number; y: number; z: number },
): void {
  // 选与 N 最不对齐的世界轴作为参考,避免退化
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  let rx: number, ry: number, rz: number;
  if (ax <= ay && ax <= az) { rx = 1; ry = 0; rz = 0; }
  else if (ay <= ax && ay <= az) { rx = 0; ry = 1; rz = 0; }
  else { rx = 0; ry = 0; rz = 1; }

  // B = N × R
  outB.x = ny * rz - nz * ry;
  outB.y = nz * rx - nx * rz;
  outB.z = nx * ry - ny * rx;
  const bLen = Math.sqrt(outB.x * outB.x + outB.y * outB.y + outB.z * outB.z);
  const bInv = bLen > 0 ? 1 / bLen : 0;
  outB.x *= bInv; outB.y *= bInv; outB.z *= bInv;

  // T = B × N
  outT.x = outB.y * nz - outB.z * ny;
  outT.y = outB.z * nx - outB.x * nz;
  outT.z = outB.x * ny - outB.y * nx;
  // T 已经归一化(B 和 N 都是单位正交)
}

// ── 临时变量(避免热循环分配) ────────────────────────────────

const _h = { x: 0, y: 0, z: 0 };
const _l = { x: 0, y: 0, z: 0 };
const _t = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _color = new Float32Array(3);

// ── PMREMGenerator ────────────────────────────────────────────

/**
 * 预滤波 mipmap 辐照度环境贴图生成器(CPU 实现)。
 *
 * ```ts
 * const room = new RoomEnvironment({ size: 256 });
 * const cube = room.generate();
 * const pmrem = new PMREMGenerator({ samples: 32 });
 * const result = pmrem.prefilter(cube);
 * // result.faces[0].mips[3].data → +x 面 mip 3 (roughness ≈ 0.53) 的 RGB 数据
 * const diffuse = pmrem.diffuseIrradiance(cube);
 * // diffuse.faces[0].data → +x 面的余弦卷积辐照度
 * ```
 */
export class PMREMGenerator {
  /** 最大采样数。 */
  readonly samples: number;

  constructor(opts: PMREMGeneratorOptions = {}) {
    this.samples = Math.max(1, Math.floor(opts.samples ?? 32));
  }

  /**
   * 预滤波(specular IBL):对源 cube map 做 GGX 重要性采样卷积,
   * 生成 mip 链(每级 mip 对应一个粗糙度)。
   *
   * @param cube 源环境贴图(RoomEnvironment.generate() 输出)。
   * @returns PMREM 数据(6 面 × mip 链)。
   */
  prefilter(cube: EnvironmentCubeData): PMREMData {
    const srcSize = cube.size;
    if (srcSize < MIN_SIZE) {
      throw new Error(`PMREMGenerator.prefilter: 源尺寸 ${srcSize} < ${MIN_SIZE}`);
    }

    const mipCount = Math.floor(Math.log2(srcSize)) - Math.floor(Math.log2(MIN_SIZE)) + 1;
    const faces: PMREMFace[] = [];

    for (let f = 0; f < 6; f++) {
      const mips: PMREMFaceMip[] = [];
      for (let m = 0; m < mipCount; m++) {
        const mipSize = Math.max(MIN_SIZE, srcSize >> m);
        const data = new Float32Array(mipSize * mipSize * 3);
        mips.push({ width: mipSize, height: mipSize, data });
      }
      faces.push({ face: FACE_NAMES[f], mips });
    }

    // 逐面逐 mip 卷积
    for (let m = 0; m < mipCount; m++) {
      const mipSize = faces[0].mips[m].width;
      // 粗糙度:α = (m / (mipCount - 1))²
      // mip 0 → α=0 (光滑镜面), 最后 mip → α=1 (完全粗糙)
      const t = mipCount > 1 ? m / (mipCount - 1) : 0;
      const alpha = t * t;

      // mip 0(α=0):直接降采样拷贝(无需卷积)
      const isMip0 = m === 0;

      // 样本数:α=0 用 1 样本;否则按 α 缩放,上限 this.samples
      const sampleCount = isMip0 ? 1 : Math.max(1, Math.min(this.samples, Math.ceil(this.samples * alpha + 1)));

      for (let f = 0; f < 6; f++) {
        const mip = faces[f].mips[m];
        const data = mip.data;
        for (let y = 0; y < mipSize; y++) {
          for (let x = 0; x < mipSize; x++) {
            // 输出 texel 对应的世界方向 N
            cubeTexelDirection(f, x, y, mipSize, _dir);
            const nx = _dir.x, ny = _dir.y, nz = _dir.z;

            if (isMip0) {
              // α=0:直接采样源(双线性)
              sampleCube(cube, nx, ny, nz, _color);
              const idx = (y * mipSize + x) * 3;
              data[idx] = _color[0];
              data[idx + 1] = _color[1];
              data[idx + 2] = _color[2];
              continue;
            }

            // GGX 重要性采样卷积
            // V = N(split-sum 近似:假设视图方向 = 法线)
            // 对每个样本:生成 H(切线空间)→ 转 world → reflect(-V, H) = L → 采样源
            buildTangentFrame(nx, ny, nz, _t, _b);

            let rSum = 0, gSum = 0, bSum = 0;
            let weightSum = 0;

            for (let i = 0; i < sampleCount; i++) {
              const xi1 = i / sampleCount;
              const xi2 = vanDerCorput(i);

              importanceSampleGGX(xi1, xi2, alpha, _h);

              // H_world = T * H.x + B * H.y + N * H.z
              const hx = _t.x * _h.x + _b.x * _h.y + nx * _h.z;
              const hy = _t.y * _h.x + _b.y * _h.y + ny * _h.z;
              const hz = _t.z * _h.x + _b.z * _h.y + nz * _h.z;

              // L = reflect(-V, H) = reflect(-N, H) = 2*(N·H)*H - N
              const nDotH = nx * hx + ny * hy + nz * hz;
              _l.x = 2 * nDotH * hx - nx;
              _l.y = 2 * nDotH * hy - ny;
              _l.z = 2 * nDotH * hz - nz;

              // 归一化 L
              const lLen = Math.sqrt(_l.x * _l.x + _l.y * _l.y + _l.z * _l.z);
              if (lLen <= 0) continue;
              const lInv = 1 / lLen;
              _l.x *= lInv; _l.y *= lInv; _l.z *= lInv;

              const nDotL = nx * _l.x + ny * _l.y + nz * _l.z;
              if (nDotL <= 0) continue;

              sampleCube(cube, _l.x, _l.y, _l.z, _color);

              // 权重 = N·L(split-sum:geometry/Fresnel 在 LUT 中处理)
              const w = nDotL;
              rSum += _color[0] * w;
              gSum += _color[1] * w;
              bSum += _color[2] * w;
              weightSum += w;
            }

            const idx = (y * mipSize + x) * 3;
            if (weightSum > 0) {
              const invW = 1 / weightSum;
              data[idx] = rSum * invW;
              data[idx + 1] = gSum * invW;
              data[idx + 2] = bSum * invW;
            } else {
              data[idx] = 0;
              data[idx + 1] = 0;
              data[idx + 2] = 0;
            }
          }
        }
      }
    }

    return { size: srcSize, mipCount, faces };
  }

  /**
   * 漫反射辐照度卷积:对源 cube map 做余弦加权半球积分。
   *
   * 输出单层 cube(无 mip 链),每个 texel = 该方向法线的半球余弦加权辐照度。
   * 这比 SH2(LightProbeGenerator)更高频,但更慢、更耗内存。
   * 对低频环境(室内、阴天)SH2 通常足够且更高效。
   *
   * @param cube    源环境贴图。
   * @param outSize 输出尺寸(默认 = 源尺寸)。降低可加速。
   * @returns 6 面 cube 数据(与 EnvironmentCubeData 兼容格式)。
   */
  diffuseIrradiance(cube: EnvironmentCubeData, outSize?: number): EnvironmentCubeData {
    const srcSize = cube.size;
    const dstSize = Math.max(MIN_SIZE, Math.floor(outSize ?? srcSize));
    const faces: CubeFaceData[] = [];

    // Monte Carlo 余弦加权半球采样
    // 对每个输出 texel(N),在半球内采样 S 个方向 L,
    // 权重 = cos(θ) = N·L,归一化后除以 π( Lambertian)
    const sampleCount = Math.max(16, this.samples);

    for (let f = 0; f < 6; f++) {
      const data = new Float32Array(dstSize * dstSize * 3);
      for (let y = 0; y < dstSize; y++) {
        for (let x = 0; x < dstSize; x++) {
          cubeTexelDirection(f, x, y, dstSize, _dir);
          const nx = _dir.x, ny = _dir.y, nz = _dir.z;
          buildTangentFrame(nx, ny, nz, _t, _b);

          let rSum = 0, gSum = 0, bSum = 0;
          let weightSum = 0;

          for (let i = 0; i < sampleCount; i++) {
            const xi1 = i / sampleCount;
            const xi2 = vanDerCorput(i);

            // 余弦加权半球采样:
            // φ = 2π * ξ1
            // θ = asin(sqrt(ξ2))  ← 余弦加权
            const phi = 2 * Math.PI * xi1;
            const sinTheta = Math.sqrt(xi2);
            const cosTheta = Math.sqrt(1 - xi2);

            _h.x = sinTheta * Math.cos(phi);
            _h.y = sinTheta * Math.sin(phi);
            _h.z = cosTheta;

            // L_world = T * h.x + B * h.y + N * h.z
            const lx = _t.x * _h.x + _b.x * _h.y + nx * _h.z;
            const ly = _t.y * _h.x + _b.y * _h.y + ny * _h.z;
            const lz = _t.z * _h.x + _b.z * _h.y + nz * _h.z;

            const nDotL = nx * lx + ny * ly + nz * lz;
            if (nDotL <= 0) continue;

            sampleCube(cube, lx, ly, lz, _color);

            rSum += _color[0] * nDotL;
            gSum += _color[1] * nDotL;
            bSum += _color[2] * nDotL;
            weightSum += nDotL;
          }

          const idx = (y * dstSize + x) * 3;
          if (weightSum > 0) {
            // 归一化:除以总权重(≈ π * S / S = π),再除以 π(Lambertian BRDF)
            // weightSum / sampleCount ≈ π(半球余弦积分 = π)
            // result = sum / weightSum * (1/1) — 实际上 sum/weightSum 已是余弦加权平均
            // 再乘 π 得到辐照度(irradiance = ∫ L * cos θ dω ≈ avg * π)
            const invW = 1 / weightSum;
            // 辐照度 = 余弦加权平均 × π
            // 但 PBR 中 diffuse = irradiance / π,所以这里返回 irradiance/π = 加权平均
            data[idx] = rSum * invW;
            data[idx + 1] = gSum * invW;
            data[idx + 2] = bSum * invW;
          }
        }
      }
      faces.push({ face: FACE_NAMES[f], data, width: dstSize, height: dstSize });
    }

    return { faces, size: dstSize };
  }
}
