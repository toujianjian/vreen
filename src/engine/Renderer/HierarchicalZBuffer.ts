// HierarchicalZBuffer — 层次化 Z 缓冲遮挡剔除(适配自 o3de Atom / UE5 HZB)。
//
// 概念:
//   把上一帧的深度缓冲构建成 mip 金字塔,每级存储 2×2 子 texel 的**最大**深度。
//   对每个物体的包围盒,投影到屏幕空间,选择合适的 mip 级采样,
//   如果物体最近深度 > HZB 该位置的最大深度 → 被遮挡,可跳过绘制。
//
// 用途(顶级引擎必备,UE5/o3de/Unity 都有):
//   - GPU 驱动渲染:海量物体批量遮挡剔除,减少 draw call
//   - 室内场景:墙后物体被剔除,大幅提升帧率
//   - 开放世界:山体/建筑后的物体被剔除
//   - 与视锥剔除互补:视锥内但被遮挡的物体也被跳过
//
// 与 soup3D 对比:
//   soup3D 无遮挡剔除,所有视锥内物体都提交绘制。
//   VREEN 提供 HZB 遮挡剔除,支持海量场景的快速剔除。
//
// 参考:
//   - o3de Atom `MaskedOcclusionCulling`(Intel SSE/AVX CPU 光栅化器)
//   - o3de Atom `OcclusionCullingPlane`(平面遮挡)
//   - UE5 `HZB Occlusion Culling`(GPU mip 金字塔)
//   - Greene 1993 "Hierarchical Z-Buffer Visibility"
//   - VREEN 用纯 CPU Float32Array 实现,无 WebGL 依赖,可在 Node/无头环境测试。

// ── 类型 ──────────────────────────────────────────────────────────

/** 3D 向量(避免依赖外部 math 库,保持纯函数无副作用)。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** AABB 包围盒。 */
interface AABB {
  min: Vec3;
  max: Vec3;
}

/** 4×4 矩阵(列主序,与 WebGL/three.js 一致)。 */
type Mat4 = Float32Array; // length = 16

/** HZB 的单个 mip 级别。 */
export interface HZBMipLevel {
  /** 该级别的深度数据(存储的是最大深度,不是平均)。 */
  data: Float32Array;
  /** 该级别的宽度。 */
  width: number;
  /** 该级别的高度。 */
  height: number;
}

/** 层次化 Z 缓冲结构。 */
export interface HZB {
  /** mip 级别数组,level 0 = 原始深度,level N = 最粗。 */
  levels: HZBMipLevel[];
  /** 原始(级别 0)宽度。 */
  width: number;
  /** 原始(级别 0)高度。 */
  height: number;
  /** mip 级数(含 level 0)。 */
  mipCount: number;
}

/** 遮挡体(待剔除的物体)。 */
export interface Occludee {
  /** 世界空间 AABB。 */
  bbox: AABB;
  /** 物体 ID(用于结果追踪,可选)。 */
  id?: number | string;
  /** 用户数据(透传,可选)。 */
  data?: unknown;
}

/** 遮挡剔除结果。 */
export interface HZBCullResult {
  /** 可见物体(未被遮挡)。 */
  visible: Occludee[];
  /** 被遮挡物体。 */
  occluded: Occludee[];
  /** 统计信息。 */
  stats: HZBCullStats;
}

/** 剔除统计。 */
export interface HZBCullStats {
  /** 总物体数。 */
  total: number;
  /** 可见物体数。 */
  visibleCount: number;
  /** 被遮挡物体数。 */
  occludedCount: number;
  /** 视锥外物体数(投影后屏幕坐标超出范围)。 */
  offScreenCount: number;
  /** 剔除率(0..1)。 */
  cullRatio: number;
  /** HZB 构建耗时(ms,可选)。 */
  buildTimeMs?: number;
  /** 剔除耗时(ms,可选)。 */
  cullTimeMs?: number;
}

/** 遮挡测试选项。 */
export interface OcclusionTestOptions {
  /**
   * 保守偏移(世界空间)。正值 = 物体深度减去该值后再比较,
   * 使物体"更近"→ 更难被判定为遮挡(保守,减少误剔除)。
   * 典型值:0.01..0.5。默认 0.1。
   */
  conservativeBias?: number;
  /**
   * mip 级别偏移。正值 = 采样更粗的 mip(更保守)。
   * 典型值:-1..2。默认 0。
   */
  mipBias?: number;
  /**
   * 最小屏幕空间尺寸(像素)。物体投影后小于此值视为太小,
   * 直接判定为可见(不剔除远处的小物体,避免误判)。
   * 默认 2。
   */
  minScreenSize?: number;
}

// ── 纯函数:HZB 构建 ─────────────────────────────────────────────

/**
 * 从深度缓冲构建 HZB(层次化 Z 缓冲)mip 金字塔。
 *
 * 每个 mip 级别存储 2×2 子 texel 的**最大**深度(不是平均),
 * 这样在粗级采样时,如果物体的最近深度 > 该位置的最大深度,
 * 则物体一定被遮挡(保守,不会误剔除)。
 *
 * @param depthBuffer  深度缓冲(Float32Array,行主序,length = width * height)
 * @param width        深度缓冲宽度
 * @param height       深度缓冲高度
 * @returns            HZB 结构
 */
export function buildHZB(
  depthBuffer: Float32Array,
  width: number,
  height: number,
): HZB {
  if (depthBuffer.length !== width * height) {
    throw new Error(
      `buildHZB: depthBuffer length ${depthBuffer.length} != width*height ${width * height}`,
    );
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError(`buildHZB: width ${width} and height ${height} must be > 0`);
  }

  const levels: HZBMipLevel[] = [];

  // Level 0: 原始深度(拷贝,不修改原数组)
  levels.push({
    data: new Float32Array(depthBuffer),
    width,
    height,
  });

  // 逐级构建
  let currentW = width;
  let currentH = height;
  while (currentW > 1 || currentH > 1) {
    const nextW = Math.max(1, Math.floor(currentW / 2));
    const nextH = Math.max(1, Math.floor(currentH / 2));
    const prevLevel = levels[levels.length - 1];
    const nextData = new Float32Array(nextW * nextH);

    for (let y = 0; y < nextH; y++) {
      for (let x = 0; x < nextW; x++) {
        // 取 2×2 子 texel 的最大深度
        const x0 = x * 2;
        const y0 = y * 2;
        const x1 = Math.min(x0 + 1, prevLevel.width - 1);
        const y1 = Math.min(y0 + 1, prevLevel.height - 1);

        const d00 = prevLevel.data[y0 * prevLevel.width + x0];
        const d01 = prevLevel.data[y0 * prevLevel.width + x1];
        const d10 = prevLevel.data[y1 * prevLevel.width + x0];
        const d11 = prevLevel.data[y1 * prevLevel.width + x1];

        nextData[y * nextW + x] = Math.max(d00, d01, d10, d11);
      }
    }

    levels.push({ data: nextData, width: nextW, height: nextH });
    currentW = nextW;
    currentH = nextH;
  }

  return {
    levels,
    width,
    height,
    mipCount: levels.length,
  };
}

// ── 纯函数:矩阵运算 ─────────────────────────────────────────────

/**
 * 用 4×4 矩阵变换 3D 点(假设 w=1),返回 NDC 坐标 {x, y, z, w}。
 * 矩阵为列主序(与 WebGL/three.js 一致):
 *   m[0]  m[4]  m[8]  m[12]
 *   m[1]  m[5]  m[9]  m[13]
 *   m[2]  m[6]  m[10] m[14]
 *   m[3]  m[7]  m[11] m[15]
 */
function transformPoint(
  m: Mat4,
  px: number,
  py: number,
  pz: number,
): { x: number; y: number; z: number; w: number } {
  const x = m[0] * px + m[4] * py + m[8] * pz + m[12];
  const y = m[1] * px + m[5] * py + m[9] * pz + m[13];
  const z = m[2] * px + m[6] * py + m[10] * pz + m[14];
  const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
  return { x, y, z, w };
}

// ── 纯函数:遮挡测试 ─────────────────────────────────────────────

/**
 * 判断一个 AABB 包围盒是否被 HZB 遮挡。
 *
 * 算法:
 *   1. 把包围盒 8 个角点用 viewProj 矩阵变换到裁剪空间
 *   2. 透视除法 → NDC,映射到屏幕空间像素坐标
 *   3. 计算屏幕空间包围矩形 (minX, minY, maxX, maxY) 和最近深度
 *   4. 根据包围矩形大小选择合适的 mip 级别
 *   5. 在该 mip 级别采样 HZB 深度
 *   6. 如果物体最近深度 > HZB 深度 → 被遮挡
 *
 * @param hzb             HZB 结构
 * @param bbox            世界空间 AABB
 * @param viewProjMatrix  view × projection 矩阵(列主序 4×4)
 * @param screenW         屏幕宽度(像素)
 * @param screenH         屏幕高度(像素)
 * @param options         测试选项
 * @returns               true = 被遮挡,false = 可见或部分可见
 */
export function isOccluded(
  hzb: HZB,
  bbox: AABB,
  viewProjMatrix: Mat4,
  screenW: number,
  screenH: number,
  options: OcclusionTestOptions = {},
): boolean {
  const {
    conservativeBias = 0.1,
    mipBias = 0,
    minScreenSize = 2,
  } = options;

  // 1. 变换 8 个角点到裁剪空间
  const corners = [
    transformPoint(viewProjMatrix, bbox.min.x, bbox.min.y, bbox.min.z),
    transformPoint(viewProjMatrix, bbox.max.x, bbox.min.y, bbox.min.z),
    transformPoint(viewProjMatrix, bbox.min.x, bbox.max.y, bbox.min.z),
    transformPoint(viewProjMatrix, bbox.max.x, bbox.max.y, bbox.min.z),
    transformPoint(viewProjMatrix, bbox.min.x, bbox.min.y, bbox.max.z),
    transformPoint(viewProjMatrix, bbox.max.x, bbox.min.y, bbox.max.z),
    transformPoint(viewProjMatrix, bbox.min.x, bbox.max.y, bbox.max.z),
    transformPoint(viewProjMatrix, bbox.max.x, bbox.max.y, bbox.max.z),
  ];

  // 2. 透视除法 + 屏幕空间映射
  //    同时找最近深度(最小 depth [0,1])和屏幕包围矩形
  let minDepth = Infinity;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let allBehindCamera = true;

  for (const c of corners) {
    if (c.w <= 0) {
      // 角点在相机后面或齐平 → 不能安全判定为遮挡(保守:视为可见)
      return false;
    }
    allBehindCamera = false;

    const invW = 1 / c.w;
    const ndcX = c.x * invW;
    const ndcY = c.y * invW;
    const ndcZ = c.z * invW;

    // NDC [-1, 1] → 屏幕 [0, screenW/H]
    const sx = (ndcX * 0.5 + 0.5) * screenW;
    const sy = (1 - (ndcY * 0.5 + 0.5)) * screenH; // Y 翻转

    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;

    // NDC z [-1, 1] → 深度 [0, 1](WebGL: 0=near, 1=far)
    // 最近点 = 最小 depth 值
    const depth = (ndcZ + 1) * 0.5;
    if (depth < minDepth) minDepth = depth;
  }

  if (allBehindCamera) {
    return false; // 全在相机后面,由视锥剔除处理
  }

  // 3. 屏幕空间包围矩形太小 → 不剔除(避免远处小物体误判)
  const rectW = maxX - minX;
  const rectH = maxY - minY;
  if (rectW < minScreenSize && rectH < minScreenSize) {
    return false;
  }

  // 4. 选择 mip 级别
  //    原则:选择一个 texel 覆盖约等于包围矩形大小的级别
  //    maxDim = max(rectW, rectH),mipLevel = log2(maxDim / texelSize)
  //    级别越高 = 越粗 = 越保守
  const maxDim = Math.max(rectW, rectH);
  let mipLevel = Math.floor(Math.log2(maxDim)) + mipBias;
  mipLevel = Math.max(0, Math.min(mipLevel, hzb.mipCount - 1));

  const level = hzb.levels[mipLevel];

  // 5. 在该 mip 级别采样 HZB 深度
  //    采样包围矩形中心点(也可采样多点取最大,这里取中心即可)
  const sampleX = Math.floor((minX + maxX) * 0.5);
  const sampleY = Math.floor((minY + maxY) * 0.5);

  // 屏幕坐标 → mip 级纹理坐标
  const u = Math.max(0, Math.min(level.width - 1, Math.floor((sampleX / screenW) * level.width)));
  const v = Math.max(0, Math.min(level.height - 1, Math.floor((sampleY / screenH) * level.height)));

  const hzbDepth = level.data[v * level.width + u];

  // 6. 深度比较:如果物体最近深度 > HZB 深度 → 被遮挡
  //    应用保守偏移:物体深度减去 bias,使其"更近",更难被遮挡
  const adjustedDepth = minDepth - conservativeBias;

  return adjustedDepth > hzbDepth;
}

// ── 纯函数:批量遮挡剔除 ─────────────────────────────────────────

/**
 * 批量遮挡剔除。遍历所有物体,用 HZB 判断每个物体是否被遮挡。
 *
 * @param hzb             HZB 结构
 * @param occludees       待剔除物体列表
 * @param viewProjMatrix  view × projection 矩阵
 * @param screenW         屏幕宽度
 * @param screenH         屏幕高度
 * @param options         测试选项
 * @returns               剔除结果(visible / occluded / stats)
 */
export function occlusionCull(
  hzb: HZB,
  occludees: Occludee[],
  viewProjMatrix: Mat4,
  screenW: number,
  screenH: number,
  options: OcclusionTestOptions = {},
): HZBCullResult {
  const visible: Occludee[] = [];
  const occluded: Occludee[] = [];

  for (const obj of occludees) {
    if (isOccluded(hzb, obj.bbox, viewProjMatrix, screenW, screenH, options)) {
      occluded.push(obj);
    } else {
      visible.push(obj);
    }
  }

  const total = occludees.length;
  const visibleCount = visible.length;
  const occludedCount = occluded.length;
  const cullRatio = total > 0 ? occludedCount / total : 0;

  return {
    visible,
    occluded,
    stats: {
      total,
      visibleCount,
      occludedCount,
      offScreenCount: 0, // isOccluded 内部把 off-screen 当"可见"返回
      cullRatio,
    },
  };
}

// ── 辅助:创建深度缓冲 ───────────────────────────────────────────

/**
 * 创建一个平坦的深度缓冲(所有像素深度 = depth)。
 * 用于测试。
 *
 * @param width   宽度
 * @param height  高度
 * @param depth   深度值(0=near, 1=far)
 * @returns       Float32Array 深度缓冲
 */
export function makeFlatDepth(
  width: number,
  height: number,
  depth: number,
): Float32Array {
  const buf = new Float32Array(width * height);
  buf.fill(depth);
  return buf;
}

/**
 * 创建一个有遮挡物的深度缓冲(中心矩形区域为近深度,其余为远深度)。
 * 用于测试遮挡剔除。
 *
 * @param width       宽度
 * @param height      高度
 * @param occluderDepth  遮挡物深度(近,如 0.3)
 * @param backgroundDepth 背景深度(远,如 0.9)
 * @param occluderX   遮挡物左上角 x(像素)
 * @param occluderY   遮挡物左上角 y(像素)
 * @param occluderW   遮挡物宽度(像素)
 * @param occluderH   遮挡物高度(像素)
 * @returns           Float32Array 深度缓冲
 */
export function makeOccluderDepth(
  width: number,
  height: number,
  occluderDepth: number,
  backgroundDepth: number,
  occluderX: number,
  occluderY: number,
  occluderW: number,
  occluderH: number,
): Float32Array {
  const buf = new Float32Array(width * height);
  buf.fill(backgroundDepth);
  const x0 = Math.max(0, occluderX);
  const y0 = Math.max(0, occluderY);
  const x1 = Math.min(width, occluderX + occluderW);
  const y1 = Math.min(height, occluderY + occluderH);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      buf[y * width + x] = occluderDepth;
    }
  }
  return buf;
}

/**
 * 创建一个单位矩阵(列主序 4×4)。
 * 用于测试(无变换,世界空间 = 裁剪空间)。
 */
export function identityMatrix(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

/**
 * 创建一个正交投影矩阵(列主序 4×4)。
 * 用于测试:把世界空间 [left, right] × [bottom, top] × [near, far] 映射到 NDC [-1,1]³。
 *
 * @param left    左边界
 * @param right   右边界
 * @param bottom  下边界
 * @param top     上边界
 * @param near    近平面
 * @param far     远平面
 * @returns       4×4 矩阵
 */
export function orthoMatrix(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const m = new Float32Array(16);
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const fn = 1 / (far - near);

  // 列主序。z 正方向远离相机(与 VREEN 测试约定一致):
  //   z=near → NDC z = -1(near plane)
  //   z=far  → NDC z = +1(far plane)
  m[0] = 2 * rl;                    // [0][0]
  m[5] = 2 * tb;                    // [1][1]
  m[10] = 2 * fn;                   // [2][2] (positive: z increases away from camera)
  m[12] = -(right + left) * rl;     // [3][0]
  m[13] = -(top + bottom) * tb;     // [3][1]
  m[14] = -(far + near) * fn;       // [3][2]
  m[15] = 1;                        // [3][3]

  return m;
}

// ── GLSL shader chunk(GPU 端 HZB 构建 + 遮挡测试) ────────────────

export const HZB_GLSL = /* glsl */ `
// Hierarchical Z-Buffer (HZB) occlusion culling — GLSL chunk.
// Adapted from UE5 HZB / o3de Atom MaskedOcclusionCulling.
// VREEN uses CPU Float32Array reference; this chunk is for future GPU integration.

// HZB mip level reduction: store MAX depth of 2x2 texels.
// In WebGL2, this would be done via a compute-style ping-pong pass
// using framebuffer blit + manual reduction shader.
float hzbReduceMax2x2(sampler2D srcDepth, vec2 uv, vec2 texelSize) {
  vec2 uv0 = uv;
  vec2 uv1 = uv + vec2(texelSize.x, 0.0);
  vec2 uv2 = uv + vec2(0.0, texelSize.y);
  vec2 uv3 = uv + vec2(texelSize.x, texelSize.y);
  float d0 = texture(srcDepth, uv0).r;
  float d1 = texture(srcDepth, uv1).r;
  float d2 = texture(srcDepth, uv2).r;
  float d3 = texture(srcDepth, uv3).r;
  return max(max(d0, d1), max(d2, d3));
}

// HZB occlusion test: project bbox to screen, sample appropriate mip level.
// Returns true if the bbox is occluded (behind the depth buffer).
bool hzbIsOccluded(sampler2D hzbMips[MAX_HZB_MIPS], int mipCount,
                   vec3 bboxMin, vec3 bboxMax,
                   mat4 viewProjMatrix, vec2 screenSize,
                   float conservativeBias) {
  // Transform 8 corners
  vec4 c0 = viewProjMatrix * vec4(bboxMin, 1.0);
  vec4 c1 = viewProjMatrix * vec4(bboxMax.x, bboxMin.y, bboxMin.z, 1.0);
  vec4 c2 = viewProjMatrix * vec4(bboxMin.x, bboxMax.y, bboxMin.z, 1.0);
  vec4 c3 = viewProjMatrix * vec4(bboxMax.x, bboxMax.y, bboxMin.z, 1.0);
  vec4 c4 = viewProjMatrix * vec4(bboxMin.x, bboxMin.y, bboxMax.z, 1.0);
  vec4 c5 = viewProjMatrix * vec4(bboxMax.x, bboxMin.y, bboxMax.z, 1.0);
  vec4 c6 = viewProjMatrix * vec4(bboxMin.x, bboxMax.y, bboxMax.z, 1.0);
  vec4 c7 = viewProjMatrix * vec4(bboxMax, 1.0);

  // Find min depth and screen-space bounding rect
  float minDepth = 1.0;
  vec2 minScreen = vec2(screenSize);
  vec2 maxScreen = vec2(0.0);

  // Unrolled corner processing
  #define HZB_PROCESS_CORNER(c) {
    if ((c).w <= 0.0) return false;
    float invW = 1.0 / (c).w;
    vec2 ndc = (c).xy * invW;
    float z = (c).z * invW;
    vec2 screen = vec2(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5)) * screenSize;
    minScreen = min(minScreen, screen);
    maxScreen = max(maxScreen, screen);
    minDepth = min(minDepth, z);
  }

  HZB_PROCESS_CORNER(c0)
  HZB_PROCESS_CORNER(c1)
  HZB_PROCESS_CORNER(c2)
  HZB_PROCESS_CORNER(c3)
  HZB_PROCESS_CORNER(c4)
  HZB_PROCESS_CORNER(c5)
  HZB_PROCESS_CORNER(c6)
  HZB_PROCESS_CORNER(c7)

  #undef HZB_PROCESS_CORNER

  // Select mip level based on screen-space rect size
  float maxDim = max(maxScreen.x - minScreen.x, maxScreen.y - minScreen.y);
  int mipLevel = int(clamp(log2(maxDim), 0.0, float(mipCount - 1)));

  // Sample HZB at rect center
  vec2 center = (minScreen + maxScreen) * 0.5 / screenSize;
  float hzbDepth = texture(hzbMips[mipLevel], center).r;

  return (minDepth - conservativeBias) > hzbDepth;
}
`;
