// SSGI — 屏幕空间全局光照 (Screen-Space Global Illumination) CPU 参考实现。
//
// 设计目标:
//   - 与 PostProcess/SSGIPass.ts(GPU 纹理版)互补:本模块在 CPU 侧维护
//     Float32Array 纹理,不依赖 WebGL 上下文,可在无头环境(Node / 测试 /
//     离线渲染)运行,适合验证 GPU shader 正确性 + 离线光照贴图烘焙;
//   - 与 GLSL `SSGI_FRAG` chunk 1:1 对应:ign 抖动 / TBN 正交基 /
//     余弦加权半球采样 / 视空间厚度检测 / 自适应步长 / 边缘衰减;
//   - 额外提供生产级特性(超越基础 SSGI_FRAG):
//       1. temporalAccumulate() — 时序累积(历史帧重投影 + 邻域夹紧);
//       2. denoiseSpatial() — 空间降噪(边保持模糊,基于法线/深度);
//       3. varianceClip() — 方差裁剪(抑制时序鬼影);
//   - 纯函数,无 WebGL 依赖,可在 Node / 无头环境测试。
//
// 与 SSR / GTAO 的关系:
//   - SSR 处理镜面反射(金属 / 湿润表面);
//   - SSGI 处理漫反射间接光(粗糙表面的颜色反弹 / 颜色渗透);
//   - GTAO 处理环境遮蔽(暗角);
//   - 三者互补,可同时启用,共同提升画面真实感。
//
// 与 GlobalIllumination / DDGIVolume 的关系:
//   - GlobalIllumination / DDGIVolume 是世界空间 GI(光探针 / 体素),
//     覆盖完整场景但精度低;
//   - SSGI 是屏幕空间 GI,只覆盖可见像素但精度高(像素级颜色反弹);
//   - 实际引擎中常组合使用:DDGI 提供低频基底,SSGI 叠加高频细节。
//
// 参考:
//   - Crytek "Real-time Diffuse Global Illumination in Screen Space" (SSDO) Ritschel 2009
//   - o3de Atom "ScreenSpaceGlobalIllumination" pass
//   - EA SEED "Stable SSAO" GDC 演讲(IGN 时序抖动)
//   - UE5 Lumen Screen Space GI
//   - Jorge Jimenez 2014 "Interleaved Gradient Noise"

// ── 类型 ──────────────────────────────────────────────────────────

/** 三维向量(纯数据,避免依赖 Math/Vector3)。 */
export interface SSGIVec3 {
  x: number;
  y: number;
  z: number;
}

/** RGBA 纹理数据(Float32Array,行主序,从左上到右下)。 */
export interface SSGITextureData {
  /** RGBA 浮点数据,长度 = width * height * 4。 */
  data: Float32Array;
  width: number;
  height: number;
}

/** 4×4 矩阵(列主序,与 WebGL 一致)。长度 16。 */
export type SSGIMat4 = number[];

/** SSGI 相机(解耦具体 Camera 类,只需 position + 矩阵)。 */
export interface SSGICamera {
  position: SSGIVec3;
  /** 列主序 projection 矩阵。 */
  projection: SSGIMat4;
  /** 列主序 view 矩阵(matrixWorldInverse)。 */
  view: SSGIMat4;
}

/** SSGI 输入:color + position + normal 三张纹理 + 相机。 */
export interface SSGIInput {
  /** 场景颜色(反弹光源)。RGBA Float32Array。 */
  colorMap: SSGITextureData;
  /** GBuffer 世界位置(RGBA16F,xyz=worldPos)。 */
  positionMap: SSGITextureData;
  /** GBuffer 世界法线(RGBA16F,xyz=normal,已归一化或待归一化)。 */
  normalMap: SSGITextureData;
  /** 相机。 */
  camera: SSGICamera;
}

/** SSGI 选项。 */
export interface SSGIOptions {
  /** 每射线最大步进次数(默认 32,范围 0..64)。 */
  maxSteps?: number;
  /** 厚度容差(视空间,默认 0.5)。值太小漏检;太大出现穿透伪间接光。 */
  thickness?: number;
  /** 间接光强度(默认 0.5,>1 会过亮,需配合下游 ToneMapping)。 */
  strength?: number;
  /** 采样半径(世界单位,默认 0.5)。控制间接光作用范围。 */
  radius?: number;
  /** 射线数(1..8,默认 8)。更多射线 = 更平滑但更慢。 */
  numRays?: number;
  /** 时序抖动幅度(0=关,1=默认)。配合 TAA 消除噪声。 */
  jitterScale?: number;
  /** 帧计数(时序旋转,每帧 +1)。 */
  frame?: number;
}

/** SSGI 统计(调试用)。 */
export interface SSGIStats {
  /** 处理的像素总数。 */
  pixelsProcessed: number;
  /** 跳过的像素数(天空 / 背面)。 */
  pixelsSkipped: number;
  /** 发射的射线总数。 */
  raysShot: number;
  /** 命中的射线数。 */
  raysHit: number;
  /** 总步进次数(所有射线)。 */
  totalSteps: number;
  /** 平均每像素命中数。 */
  avgHitsPerPixel: number;
}

/** 单条射线的步进结果。 */
export interface SSGIRayHit {
  /** 是否命中。 */
  hit: boolean;
  /** 命中点 UV(0..1)。hit=false 时无意义。 */
  hitUV: { u: number; v: number };
  /** 命中点世界位置。 */
  hitPos: SSGIVec3;
  /** 步进次数。 */
  steps: number;
  /** 射线走过的总距离(世界单位)。 */
  totalDistance: number;
}

// ── 向量工具(纯函数,不依赖 Math/Vector3) ────────────────────────

export function vadd(a: SSGIVec3, b: SSGIVec3): SSGIVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vsub(a: SSGIVec3, b: SSGIVec3): SSGIVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vscale(a: SSGIVec3, s: number): SSGIVec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vdot(a: SSGIVec3, b: SSGIVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vcross(a: SSGIVec3, b: SSGIVec3): SSGIVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vlength(a: SSGIVec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vnormalize(a: SSGIVec3): SSGIVec3 {
  const len = vlength(a);
  if (len < 1e-8) return { x: 0, y: 0, z: 0 };
  const inv = 1 / len;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

// ── 矩阵工具(列主序) ────────────────────────────────────────────

/**
 * 矩阵 × 向量(列主序):result = M * v。
 * 矩阵布局:m[col*4 + row]。
 */
export function mat4TransformVec3(m: SSGIMat4, v: SSGIVec3): SSGIVec3 {
  const x = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12];
  const y = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13];
  const z = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
  return { x, y, z };
}

/**
 * 矩阵 × 点(列主序,带 w 透视除法):result = M * (v, 1) / w。
 * 用于把世界位置投影到裁剪空间再归一化。
 */
export function mat4ProjectVec3(m: SSGIMat4, v: SSGIVec3): { x: number; y: number; z: number; w: number } {
  const x = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12];
  const y = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13];
  const z = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
  const w = m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15];
  return { x, y, z, w };
}

// ── 纯函数(与 GLSL SSGI_FRAG 1:1 对应) ──────────────────────────

/**
 * Interleaved Gradient Noise (Jorge Jimenez 2014)。
 * 与 GLSL `ign()` 函数 1:1 对应。产生 [0,1) 的伪随机数。
 *
 * 用于每像素抖动 + 余弦半球采样,比白噪声更好的采样模式
 * (低差异 + 对齐像素网格 → 蓝噪声特性)。
 */
export function ign(px: number, py: number): number {
  // fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y))
  const inner = 0.06711056 * px + 0.00583715 * py;
  const fractInner = inner - Math.floor(inner);
  const result = 52.9829189 * fractInner;
  return result - Math.floor(result);
}

/**
 * 从法线构建 TBN 正交基(不依赖切线属性)。
 * 与 GLSL SSGI_FRAG 的 TBN 构建逻辑一致:
 *   up = |N.z| < 0.999 ? (0,0,1) : (1,0,0)
 *   T = normalize(cross(up, N))
 *   B = cross(N, T)
 */
export function buildTBN(n: SSGIVec3): { T: SSGIVec3; B: SSGIVec3; N: SSGIVec3 } {
  const N = vnormalize(n);
  const up: SSGIVec3 = Math.abs(N.z) < 0.999 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const T = vnormalize(vcross(up, N));
  const B = vcross(N, T);
  return { T, B, N };
}

/**
 * 余弦加权半球采样(重要性采样)。
 * 与 GLSL SSGI_FRAG 的采样逻辑一致:
 *   θ = asin(√ξ₁), φ = 2π·ξ₂ + frameRot
 *   dir = T·(sinθ·cosφ) + B·(sinθ·sinφ) + N·cosθ
 *
 * @param xi1  随机数 1 [0,1)
 * @param xi2  随机数 2 [0,1)
 * @param TBN  正交基
 * @param frameRot  时序旋转角(弧度,黄金角 ≈ 137.5° × frame)
 */
export function cosineSampleHemisphere(
  xi1: number,
  xi2: number,
  tbn: { T: SSGIVec3; B: SSGIVec3; N: SSGIVec3 },
  frameRot: number,
): SSGIVec3 {
  const theta = Math.asin(Math.sqrt(Math.max(0, Math.min(1, xi1))));
  const phi = 2 * Math.PI * xi2 + frameRot;
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return {
    x: tbn.T.x * (sinTheta * cosPhi) + tbn.B.x * (sinTheta * sinPhi) + tbn.N.x * cosTheta,
    y: tbn.T.y * (sinTheta * cosPhi) + tbn.B.y * (sinTheta * sinPhi) + tbn.N.y * cosTheta,
    z: tbn.T.z * (sinTheta * cosPhi) + tbn.B.z * (sinTheta * sinPhi) + tbn.N.z * cosTheta,
  };
}

/**
 * 把世界位置投影到屏幕 UV(0..1)。
 * 与 GLSL `projectToUV()` 1:1 对应。
 * 返回 UV + valid 标志(w ≤ 0 表示点在相机后方,UV 无效)。
 */
export function projectToUV(
  worldPos: SSGIVec3,
  projection: SSGIMat4,
  view: SSGIMat4,
): { u: number; v: number; valid: boolean } {
  // clip = projection * view * worldPos
  const viewPos = mat4TransformVec3(view, worldPos);
  const clip = mat4ProjectVec3(projection, viewPos);
  if (Math.abs(clip.w) < 1e-8) {
    return { u: 0, v: 0, valid: false };
  }
  const invW = 1 / clip.w;
  const u = clip.x * invW * 0.5 + 0.5;
  const v = clip.y * invW * 0.5 + 0.5;
  return { u, v, valid: clip.w > 0 };
}

/**
 * 视空间深度(沿相机轴的距离,正值表示在相机前方)。
 * 与 GLSL `viewDepth()` 1:1 对应:viewDepth = -(view * worldPos).z。
 */
export function viewDepth(worldPos: SSGIVec3, view: SSGIMat4): number {
  const vp = mat4TransformVec3(view, worldPos);
  return -vp.z;
}

/**
 * 采样纹理(CLAMP_TO_EDGE + 最近邻)。
 * 与 GLSL `texture(sampler, uv)` 在 NEAREST + CLAMP_TO_EDGE 模式下一致。
 */
export function sampleTextureClamp(tex: SSGITextureData, u: number, v: number): SSGIVec3 {
  const cu = u < 0 ? 0 : u > 1 ? 1 : u;
  const cv = v < 0 ? 0 : v > 1 ? 1 : v;
  const x = Math.min(tex.width - 1, Math.max(0, Math.floor(cu * tex.width)));
  const y = Math.min(tex.height - 1, Math.max(0, Math.floor(cv * tex.height)));
  const idx = (y * tex.width + x) * 4;
  return {
    x: tex.data[idx],
    y: tex.data[idx + 1],
    z: tex.data[idx + 2],
  };
}

/**
 * 厚度检测(视空间)。
 * 与 GLSL `hitTestVS()` 1:1 对应:
 *   - UV 越界 → 未命中;
 *   - 采样位置图得到 sampledPos;
 *   - depthDiff = rayDepth - sampledDepth;
 *   - 命中条件:depthDiff > 0 且 depthDiff < thickness。
 *
 * @returns {hit, depthDiff}
 */
export function hitTestVS(
  rayPos: SSGIVec3,
  u: number,
  v: number,
  positionMap: SSGITextureData,
  view: SSGIMat4,
  thickness: number,
): { hit: boolean; depthDiff: number } {
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    return { hit: false, depthDiff: 1e9 };
  }
  const sampledPos = sampleTextureClamp(positionMap, u, v);
  const rayDepth = viewDepth(rayPos, view);
  const sampledDepth = viewDepth(sampledPos, view);
  const depthDiff = rayDepth - sampledDepth;
  return {
    hit: depthDiff > 0 && depthDiff < thickness,
    depthDiff,
  };
}

// ── 射线步进 ──────────────────────────────────────────────────────

/**
 * 单条射线步进(屏幕空间)。
 * 与 GLSL SSGI_FRAG 内层循环一致:自适应步长(近小远大)。
 *
 * @param origin       射线起点(世界位置)
 * @param dir          射线方向(归一化)
 * @param positionMap  GBuffer 位置纹理
 * @param projection   投影矩阵
 * @param view         视图矩阵
 * @param maxSteps     最大步数
 * @param radius       采样半径(控制步长基准)
 * @param thickness    厚度容差
 * @param jitter       抖动值 [0,1)
 */
export function marchRay(
  origin: SSGIVec3,
  dir: SSGIVec3,
  positionMap: SSGITextureData,
  projection: SSGIMat4,
  view: SSGIMat4,
  maxSteps: number,
  radius: number,
  thickness: number,
  jitter: number,
): SSGIRayHit {
  const baseStep = radius * 0.1;
  let rayPos = vadd(origin, vscale(dir, baseStep * (0.5 + jitter)));
  let uv = projectToUV(rayPos, projection, view);
  let steps = 0;
  let totalDistance = baseStep * (0.5 + jitter);

  for (let i = 0; i < maxSteps; i++) {
    steps++;
    const test = hitTestVS(rayPos, uv.u, uv.v, positionMap, view, thickness);
    if (test.hit) {
      return {
        hit: true,
        hitUV: { u: uv.u, v: uv.v },
        hitPos: rayPos,
        steps,
        totalDistance,
      };
    }
    // 自适应步长:近小远大(1 + i*0.5)
    const stepSize = baseStep * (1 + i * 0.5) * (1 + jitter * 0.25);
    rayPos = vadd(rayPos, vscale(dir, stepSize));
    totalDistance += stepSize;
    uv = projectToUV(rayPos, projection, view);
  }

  return {
    hit: false,
    hitUV: { u: 0, v: 0 },
    hitPos: { x: 0, y: 0, z: 0 },
    steps,
    totalDistance,
  };
}

// ── 单像素 SSGI ───────────────────────────────────────────────────

/**
 * 计算单个像素的 SSGI 间接辐照度。
 * 与 GLSL SSGI_FRAG `main()` 逻辑 1:1 对应。
 *
 * @param px           像素 x 坐标
 * @param py           像素 y 坐标
 * @param input        SSGI 输入(color + position + normal + camera)
 * @param opts         SSGI 选项(已应用默认值)
 * @returns            间接辐照度(RGB) + 命中数 + 发射射线数
 */
export function computeSSGIPixel(
  px: number,
  py: number,
  input: SSGIInput,
  opts: Required<SSGIOptions>,
): { irradiance: SSGIVec3; hits: number; rays: number; steps: number } {
  const { colorMap, positionMap, normalMap, camera } = input;
  const w = positionMap.width;

  const idx = (py * w + px) * 4;
  const worldPos: SSGIVec3 = {
    x: positionMap.data[idx],
    y: positionMap.data[idx + 1],
    z: positionMap.data[idx + 2],
  };
  const worldNormal: SSGIVec3 = {
    x: normalMap.data[idx],
    y: normalMap.data[idx + 1],
    z: normalMap.data[idx + 2],
  };

  // 跳过天空(无法线)
  const nlen = vlength(worldNormal);
  if (nlen < 0.01) {
    return { irradiance: { x: 0, y: 0, z: 0 }, hits: 0, rays: 0, steps: 0 };
  }

  const N = vnormalize(worldNormal);
  const viewDir = vnormalize(vsub(camera.position, worldPos));

  // 背面剔除:法线背离相机不产生间接光
  if (vdot(viewDir, N) <= 0) {
    return { irradiance: { x: 0, y: 0, z: 0 }, hits: 0, rays: 0, steps: 0 };
  }

  // TBN 正交基
  const tbn = buildTBN(N);

  // 时序旋转(黄金角 ≈ 137.5°)
  const goldenAngle = 2.39996323;
  const frameRot = opts.frame * goldenAngle;

  // 每像素抖动(IGN)
  const jitter = ign(px + opts.frame * 0.61803398875, py);
  const jitterVal = (jitter - 0.5) * opts.jitterScale;

  let indirect: SSGIVec3 = { x: 0, y: 0, z: 0 };
  let totalWeight = 0;
  let hits = 0;
  let totalSteps = 0;
  const rays = Math.min(opts.numRays, 8);

  for (let r = 0; r < rays; r++) {
    // 余弦加权半球采样(IGN 提供低差异序列)
    const xi1 = ign(px + r * 7.13 + opts.frame * 0.31, py + r * 3.17) + jitterVal;
    const xi2 = ign(px + r * 5.91, py + r * 11.37 + opts.frame * 0.47) + jitterVal;
    const xi1Clamped = xi1 - Math.floor(xi1);
    const xi2Clamped = xi2 - Math.floor(xi2);

    const rayDir = cosineSampleHemisphere(xi1Clamped, xi2Clamped, tbn, frameRot);

    const ray = marchRay(
      worldPos,
      rayDir,
      positionMap,
      camera.projection,
      camera.view,
      opts.maxSteps,
      opts.radius,
      opts.thickness,
      jitterVal,
    );
    totalSteps += ray.steps;

    if (ray.hit) {
      // 边缘衰减:命中 UV 靠近屏幕边缘 → 权重衰减
      const edgeDistX = Math.min(ray.hitUV.u, 1 - ray.hitUV.u);
      const edgeDistY = Math.min(ray.hitUV.v, 1 - ray.hitUV.v);
      const edgeMin = Math.min(edgeDistX, edgeDistY);
      const edgeFade = smoothstep(0, 0.1, edgeMin);

      // 采样命中点颜色作为间接光
      const hitColor = sampleTextureClamp(colorMap, ray.hitUV.u, ray.hitUV.v);

      // 距离衰减:远处命中贡献更弱
      const hitDist = ray.totalDistance;
      const distAtten = 1 / (1 + hitDist * hitDist * 2);

      // 余弦权重
      const cosWeight = Math.max(vdot(N, rayDir), 0);

      const weight = edgeFade * distAtten * cosWeight;
      indirect = vadd(indirect, vscale(hitColor, weight));
      totalWeight += weight;
      hits++;
    }
  }

  let irradiance: SSGIVec3;
  if (totalWeight > 0) {
    irradiance = vscale(indirect, 1 / totalWeight);
  } else {
    irradiance = { x: 0, y: 0, z: 0 };
  }

  // 乘以强度
  irradiance = vscale(irradiance, opts.strength);

  return { irradiance, hits, rays, steps: totalSteps };
}

/** smoothstep(GLSL 兼容)。 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── 全屏 SSGI 执行 ────────────────────────────────────────────────

/**
 * 执行全屏 SSGI Pass。
 *
 * @param input   SSGI 输入
 * @param opts    选项(未提供的字段使用默认值)
 * @returns       输出纹理(RGBA Float32Array,rgb=间接辐照度,a=1)+ 统计
 */
export function executeSSGI(
  input: SSGIInput,
  opts?: SSGIOptions,
): { output: SSGITextureData; stats: SSGIStats } {
  const o = applySSGIDefaults(opts);
  const { positionMap } = input;
  const w = positionMap.width;
  const h = positionMap.height;
  const out = new Float32Array(w * h * 4);

  let pixelsProcessed = 0;
  let pixelsSkipped = 0;
  let raysShot = 0;
  let raysHit = 0;
  let totalSteps = 0;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const result = computeSSGIPixel(px, py, input, o);
      const idx = (py * w + px) * 4;
      out[idx] = result.irradiance.x;
      out[idx + 1] = result.irradiance.y;
      out[idx + 2] = result.irradiance.z;
      out[idx + 3] = 1;

      pixelsProcessed++;
      if (result.rays === 0) {
        pixelsSkipped++;
      }
      raysShot += result.rays;
      raysHit += result.hits;
      totalSteps += result.steps;
    }
  }

  return {
    output: { data: out, width: w, height: h },
    stats: {
      pixelsProcessed,
      pixelsSkipped,
      raysShot,
      raysHit,
      totalSteps,
      avgHitsPerPixel: pixelsProcessed > 0 ? raysHit / pixelsProcessed : 0,
    },
  };
}

// ── 时序累积(生产级特性) ─────────────────────────────────────────

/**
 * 时序累积:把当前帧 SSGI 结果与历史帧混合。
 *
 * 算法:
 *   1. 用 velocity buffer 把历史帧重投影到当前帧像素位置;
 *   2. 对重投影后的历史值做邻域夹紧(避免鬼影);
 *   3. 按 alpha 混合:out = lerp(history, current, alpha)。
 *
 * 与 GLSL `SSGI_TEMPORAL_FRAG` chunk 1:1 对应。
 *
 * @param current      当前帧 SSGI 输出(RGBA)
 * @param history      上一帧累积结果(RGBA)
 * @param velocity     逐像素速度(RG,像素单位,长度 = w*h*2)
 * @param alpha        混合因子(0..1,0=全历史,1=全当前。典型 0.1)
 * @param width        纹理宽度
 * @param height       纹理高度
 * @returns            累积结果(RGBA Float32Array)
 */
export function temporalAccumulate(
  current: SSGITextureData,
  history: SSGITextureData | null,
  velocity: Float32Array | null,
  alpha: number,
): SSGITextureData {
  const w = current.width;
  const h = current.height;
  const out = new Float32Array(w * h * 4);
  const alphaClamped = Math.max(0, Math.min(1, alpha));

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;
      const cr = current.data[idx];
      const cg = current.data[idx + 1];
      const cb = current.data[idx + 2];

      if (!history) {
        // 首帧:直接使用当前帧
        out[idx] = cr;
        out[idx + 1] = cg;
        out[idx + 2] = cb;
        out[idx + 3] = 1;
        continue;
      }

      // 重投影:用速度找到历史帧中的对应像素
      let hx = px;
      let hy = py;
      if (velocity) {
        const vIdx = (py * w + px) * 2;
        const vx = velocity[vIdx];
        const vy = velocity[vIdx + 1];
        hx = Math.round(px - vx);
        hy = Math.round(py - vy);
      }

      // 邻域夹紧:取历史帧 3×3 邻域的 min/max 作为夹紧范围
      const clamp = ssgiNeighborhoodMinMax(history, px, py);

      let hr = 0;
      let hg = 0;
      let hb = 0;
      if (hx >= 0 && hx < w && hy >= 0 && hy < h) {
        const hIdx = (hy * w + hx) * 4;
        hr = history.data[hIdx];
        hg = history.data[hIdx + 1];
        hb = history.data[hIdx + 2];
      }

      // 夹紧历史值到邻域范围(抑制鬼影)
      hr = Math.max(clamp.minR, Math.min(clamp.maxR, hr));
      hg = Math.max(clamp.minG, Math.min(clamp.maxG, hg));
      hb = Math.max(clamp.minB, Math.min(clamp.maxB, hb));

      // 混合
      out[idx] = hr * (1 - alphaClamped) + cr * alphaClamped;
      out[idx + 1] = hg * (1 - alphaClamped) + cg * alphaClamped;
      out[idx + 2] = hb * (1 - alphaClamped) + cb * alphaClamped;
      out[idx + 3] = 1;
    }
  }

  return { data: out, width: w, height: h };
}

/**
 * 计算 3×3 邻域的 RGB min/max(用于时序累积的邻域夹紧)。
 */
export function ssgiNeighborhoodMinMax(
  tex: SSGITextureData,
  px: number,
  py: number,
): { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number } {
  const w = tex.width;
  const h = tex.height;
  let minR = Infinity, maxR = -Infinity;
  let minG = Infinity, maxG = -Infinity;
  let minB = Infinity, maxB = -Infinity;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const idx = (y * w + x) * 4;
      const r = tex.data[idx];
      const g = tex.data[idx + 1];
      const b = tex.data[idx + 2];
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
  }

  return { minR, maxR, minG, maxG, minB, maxB };
}

// ── 空间降噪(边保持模糊) ─────────────────────────────────────────

/**
 * 空间降噪:基于法线/深度的边保持模糊。
 *
 * 算法:对每个像素,在其半径邻域内采样,根据法线相似度 + 深度相似度
 * 计算权重,做加权平均。与 cross-bilateral filter 等价。
 *
 * 与 GLSL `SSGI_DENOISE_FRAG` chunk 1:1 对应。
 *
 * @param input        SSGI 输入(RGBA)
 * @param positionMap  GBuffer 位置(用于深度相似度)
 * @param normalMap    GBuffer 法线(用于法线相似度)
 * @param radius       采样半径(像素,默认 2)
 * @param strength     降噪强度(0..1,0=不降噪,1=全降噪)
 */
export function denoiseSpatial(
  input: SSGITextureData,
  positionMap: SSGITextureData,
  normalMap: SSGITextureData,
  radius: number,
  strength: number,
): SSGITextureData {
  const w = input.width;
  const h = input.height;
  const out = new Float32Array(w * h * 4);
  const r = Math.max(1, Math.floor(radius));
  const str = Math.max(0, Math.min(1, strength));
  const normalWeightScale = 8.0; // 法线权重陡峭度
  const depthWeightScale = 4.0;  // 深度权重陡峭度

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;
      const centerPos: SSGIVec3 = {
        x: positionMap.data[idx],
        y: positionMap.data[idx + 1],
        z: positionMap.data[idx + 2],
      };
      const centerNrm: SSGIVec3 = {
        x: normalMap.data[idx],
        y: normalMap.data[idx + 1],
        z: normalMap.data[idx + 2],
      };
      const centerN = vnormalize(centerNrm);
      const centerVal: SSGIVec3 = {
        x: input.data[idx],
        y: input.data[idx + 1],
        z: input.data[idx + 2],
      };

      let accumR = centerVal.x;
      let accumG = centerVal.y;
      let accumB = centerVal.z;
      let totalWeight = 1;

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || x >= w || y < 0 || y >= h) continue;

          const sIdx = (y * w + x) * 4;
          const samplePos: SSGIVec3 = {
            x: positionMap.data[sIdx],
            y: positionMap.data[sIdx + 1],
            z: positionMap.data[sIdx + 2],
          };
          const sampleNrm: SSGIVec3 = {
            x: normalMap.data[sIdx],
            y: normalMap.data[sIdx + 1],
            z: normalMap.data[sIdx + 2],
          };
          const sampleN = vnormalize(sampleNrm);

          // 法线权重:dot(N_center, N_sample) 越大权重越高
          const nDot = Math.max(0, vdot(centerN, sampleN));
          const normalWeight = Math.pow(nDot, normalWeightScale);

          // 深度权重:世界距离越小权重越高(边保持)
          const worldDist = vlength(vsub(centerPos, samplePos));
          const depthWeight = Math.exp(-worldDist * depthWeightScale);

          // 距离权重(高斯)
          const distSq = dx * dx + dy * dy;
          const spatialWeight = Math.exp(-distSq / (2 * r * r));

          const weight = normalWeight * depthWeight * spatialWeight;
          accumR += input.data[sIdx] * weight;
          accumG += input.data[sIdx + 1] * weight;
          accumB += input.data[sIdx + 2] * weight;
          totalWeight += weight;
        }
      }

      // 混合:降噪强度控制原始与降噪结果的混合
      const invW = 1 / totalWeight;
      const denoisedR = accumR * invW;
      const denoisedG = accumG * invW;
      const denoisedB = accumB * invW;

      out[idx] = centerVal.x * (1 - str) + denoisedR * str;
      out[idx + 1] = centerVal.y * (1 - str) + denoisedG * str;
      out[idx + 2] = centerVal.z * (1 - str) + denoisedB * str;
      out[idx + 3] = 1;
    }
  }

  return { data: out, width: w, height: h };
}

// ── 方差裁剪(时序鬼影抑制) ───────────────────────────────────────

/**
 * 方差裁剪:对历史帧做基于统计的裁剪,抑制时序鬼影。
 *
 * 算法:
 *   1. 计算当前帧 3×3 邻域的均值 μ 和标准差 σ;
 *   2. 把历史值裁剪到 [μ - γ·σ, μ + γ·σ] 范围;
 *   3. 与 temporalAccumulate 的邻域夹紧互补:方差裁剪更激进地去除离群值。
 *
 * 参考:SVGF (Spatiotemporal Variance-Guided Filtering) Schied 2017。
 *
 * @param current  当前帧 SSGI 输出
 * @param history  历史帧累积结果
 * @param gamma    裁剪范围因子(默认 1.0,越大越宽松)
 */
export function varianceClip(
  current: SSGITextureData,
  history: SSGITextureData,
  gamma: number,
): SSGITextureData {
  const w = current.width;
  const h = current.height;
  const out = new Float32Array(w * h * 4);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;

      // 计算当前帧 3×3 邻域的均值和方差
      let sumR = 0, sumG = 0, sumB = 0;
      let sumR2 = 0, sumG2 = 0, sumB2 = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          const sIdx = (y * w + x) * 4;
          const r = current.data[sIdx];
          const g = current.data[sIdx + 1];
          const b = current.data[sIdx + 2];
          sumR += r; sumG += g; sumB += b;
          sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
          count++;
        }
      }

      if (count === 0) {
        out[idx] = history.data[idx];
        out[idx + 1] = history.data[idx + 1];
        out[idx + 2] = history.data[idx + 2];
        out[idx + 3] = 1;
        continue;
      }

      const invCount = 1 / count;
      const meanR = sumR * invCount;
      const meanG = sumG * invCount;
      const meanB = sumB * invCount;
      const varR = Math.max(0, sumR2 * invCount - meanR * meanR);
      const varG = Math.max(0, sumG2 * invCount - meanG * meanG);
      const varB = Math.max(0, sumB2 * invCount - meanB * meanB);
      const stdR = Math.sqrt(varR);
      const stdG = Math.sqrt(varG);
      const stdB = Math.sqrt(varB);

      // 裁剪范围 [μ - γ·σ, μ + γ·σ]
      const minR = meanR - gamma * stdR;
      const maxR = meanR + gamma * stdR;
      const minG = meanG - gamma * stdG;
      const maxG = meanG + gamma * stdG;
      const minB = meanB - gamma * stdB;
      const maxB = meanB + gamma * stdB;

      // 裁剪历史值
      const hr = history.data[idx];
      const hg = history.data[idx + 1];
      const hb = history.data[idx + 2];

      out[idx] = Math.max(minR, Math.min(maxR, hr));
      out[idx + 1] = Math.max(minG, Math.min(maxG, hg));
      out[idx + 2] = Math.max(minB, Math.min(maxB, hb));
      out[idx + 3] = 1;
    }
  }

  return { data: out, width: w, height: h };
}

// ── 默认值 ────────────────────────────────────────────────────────

export const DEFAULT_SSGI_OPTIONS: Required<SSGIOptions> = {
  maxSteps: 32,
  thickness: 0.5,
  strength: 0.5,
  radius: 0.5,
  numRays: 8,
  jitterScale: 1.0,
  frame: 0,
};

export function applySSGIDefaults(opts?: SSGIOptions): Required<SSGIOptions> {
  if (!opts) return { ...DEFAULT_SSGI_OPTIONS };
  return {
    maxSteps: opts.maxSteps !== undefined ? Math.max(0, Math.min(64, Math.floor(opts.maxSteps))) : DEFAULT_SSGI_OPTIONS.maxSteps,
    thickness: opts.thickness !== undefined ? Math.max(0.001, opts.thickness) : DEFAULT_SSGI_OPTIONS.thickness,
    strength: opts.strength !== undefined ? opts.strength : DEFAULT_SSGI_OPTIONS.strength,
    radius: opts.radius !== undefined ? Math.max(0.001, opts.radius) : DEFAULT_SSGI_OPTIONS.radius,
    numRays: opts.numRays !== undefined ? Math.max(1, Math.min(8, Math.floor(opts.numRays))) : DEFAULT_SSGI_OPTIONS.numRays,
    jitterScale: opts.jitterScale !== undefined ? opts.jitterScale : DEFAULT_SSGI_OPTIONS.jitterScale,
    frame: opts.frame !== undefined ? Math.max(0, Math.floor(opts.frame)) : DEFAULT_SSGI_OPTIONS.frame,
  };
}

// ── GLSL chunks(补充现有 SSGI_FRAG) ─────────────────────────────

/**
 * SSGI 时序累积 GLSL 片段。
 * 与 temporalAccumulate() CPU 函数 1:1 对应。
 * 输入:当前帧 SSGI 纹理 + 历史帧累积纹理 + 速度纹理。
 */
export const SSGI_TEMPORAL_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_currentMap;     // 当前帧 SSGI
uniform sampler2D u_historyMap;     // 历史帧累积
uniform sampler2D u_velocityMap;    // 逐像素速度(RG,像素单位)
uniform vec2 u_screenSize;
uniform float u_alpha;              // 混合因子(0=全历史,1=全当前)

// 3×3 邻域 min/max
void neighborhoodMinMax(vec2 uv, out vec3 minVal, out vec3 maxVal) {
  minVal = vec3(1e9);
  maxVal = vec3(-1e9);
  vec2 texel = 1.0 / u_screenSize;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture(u_historyMap, uv + vec2(float(x), float(y)) * texel).rgb;
      minVal = min(minVal, c);
      maxVal = max(maxVal, c);
    }
  }
}

void main() {
  vec3 current = texture(u_currentMap, v_uv).rgb;

  // 重投影:用速度找到历史帧中的对应像素
  vec2 velocity = texture(u_velocityMap, v_uv).xy;
  vec2 histUV = v_uv - velocity;

  vec3 minVal, maxVal;
  neighborhoodMinMax(v_uv, minVal, maxVal);

  vec3 history = texture(u_historyMap, histUV).rgb;
  // 邻域夹紧(抑制鬼影)
  history = clamp(history, minVal, maxVal);

  vec3 result = mix(history, current, u_alpha);
  outColor = vec4(result, 1.0);
}
`;

/**
 * SSGI 空间降噪 GLSL 片段(边保持模糊)。
 * 与 denoiseSpatial() CPU 函数 1:1 对应。
 * 输入:SSGI 纹理 + GBuffer 位置 + GBuffer 法线。
 */
export const SSGI_DENOISE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_ssgiMap;        // SSGI 输入
uniform sampler2D u_positionMap;    // GBuffer 位置
uniform sampler2D u_normalMap;      // GBuffer 法线
uniform vec2 u_screenSize;
uniform int u_radius;               // 采样半径(像素)
uniform float u_strength;           // 降噪强度(0..1)
uniform float u_normalWeight;       // 法线权重陡峭度(默认 8)
uniform float u_depthWeight;        // 深度权重陡峭度(默认 4)

void main() {
  vec2 texel = 1.0 / u_screenSize;
  vec3 centerVal = texture(u_ssgiMap, v_uv).rgb;
  vec3 centerPos = texture(u_positionMap, v_uv).xyz;
  vec3 centerNrm = normalize(texture(u_normalMap, v_uv).xyz);

  vec3 accum = centerVal;
  float totalWeight = 1.0;

  for (int y = -4; y <= 4; y++) {
    for (int x = -4; x <= 4; x++) {
      if (x == 0 && y == 0) continue;
      if (abs(x) > u_radius || abs(y) > u_radius) continue;

      vec2 uv = v_uv + vec2(float(x), float(y)) * texel;
      vec3 sampleVal = texture(u_ssgiMap, uv).rgb;
      vec3 samplePos = texture(u_positionMap, uv).xyz;
      vec3 sampleNrm = normalize(texture(u_normalMap, uv).xyz);

      // 法线权重
      float nDot = max(dot(centerNrm, sampleNrm), 0.0);
      float nw = pow(nDot, u_normalWeight);

      // 深度权重
      float worldDist = length(samplePos - centerPos);
      float dw = exp(-worldDist * u_depthWeight);

      // 空间权重(高斯)
      float distSq = float(x * x + y * y);
      float sw = exp(-distSq / (2.0 * float(u_radius) * float(u_radius)));

      float w = nw * dw * sw;
      accum += sampleVal * w;
      totalWeight += w;
    }
  }

  vec3 denoised = accum / totalWeight;
  outColor = vec4(mix(centerVal, denoised, u_strength), 1.0);
}
`;
