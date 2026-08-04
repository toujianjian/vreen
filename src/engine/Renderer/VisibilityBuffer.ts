// VisibilityBuffer — 可见性缓冲(UE5 Nanite / o3de Atom 核心配套)。
//
// 适配自:
//   - o3de Atom `VisibilityBuffer.azsli`( packing 格式 + unpack 工具)
//   - o3de Atom `DeferredMaterial`( visibility buffer pass + deferred shading)
//   - UE5 Nanite `Visibility Buffer`(软件光栅化 + 延迟着色)
//   - Cruncher/Bentley 2018 "Visibility Buffer: A Framework for Sub-pixel
//     Anti-aliased Decoupled Shading"(理论框架)
//
// 核心思想(与 GBuffer 的对比):
//   传统延迟渲染(GBuffer)为每个像素写多张 MRT(albedo/normal/material/...),
//   带宽高、内存大、材质类型受限(必须统一 GBuffer layout)。
//   可见性缓冲只写一张"几何 ID"纹理(每像素 64..128 bit):
//     - meshInfoIndex  → 哪个 mesh(查 MeshInfo 表拿材质)
//     - triangleId     → mesh 内第几个三角形(查 vertex buffer 拿位置/uv/法线)
//     - barycentrics   → 三角形内重心坐标(插值顶点属性)
//     - isFrontFace    → 背面标记(双面材质用)
//   后续 shading pass 读 visbuf → 查表 → 插值 → 着色(完全解耦材质类型)。
//
// 优势:
//   - 极低带宽(单像素 64 bit vs GBuffer 128+ bit)
//   - 材质解耦(shading pass 可任意复杂,支持无数材质类型)
//   - 与 meshlet / GPU 驱动渲染天然配合(meshlet 软件光栅化直接写 visbuf)
//   - 抗锯齿友好(visbuf 可与 MSAA/TAA 结合,几何采样与着色解耦)
//
// 与 MeshletRenderer 的关系:
//   MeshletRenderer 做剔除 + indirect draw 打包(GPU 硬件光栅化 meshlet)。
//   本模块提供 visibility buffer pass 的"软件参考实现":
//     - CPU 光栅化三角形 → 写 visbuf(可测试、可离线烘焙)
//     - 位打包/解包工具(GPU 着色器可直接复用同一格式)
//     - 解压工具(从 visbuf 取出 mesh/triangle/bary → 插值属性 → 着色)
//   实际引擎中 GPU 端用 VISIBILITY_BUFFER_PACK_VERT/FRAG 着色器写 visbuf,
//   shading pass 用 VISIBILITY_BUFFER_UNPACK_UTILITY chunk 解包。
//
// 与 soup3D 的对比:
//   soup3D 无 visibility buffer / 延迟材质系统,采用前向渲染 + 简单 GBuffer。
//   VREEN 提供 o3de Atom 同款 visbuf 格式 + CPU 参考实现 + GLSL chunks,
//   为 meshlet/GPU 驱动渲染闭环提供基础。
//
// 参考:
//   - o3de `Gems/Atom/Feature/Common/Assets/ShaderLib/Atom/Features/Pipeline/Deferred/VisibilityBuffer.azsli`
//   - o3de `Gems/Atom/Feature/Common/Code/Source/DeferredMaterial/`
//   - UE5 Nanite "Software Occlusion Culling & Visibility Buffer"
//   - Schied, Pettineo "Decoupled Deferred Shading"(GDC 2018)
//   - VREEN 用纯 CPU Float32Array 实现,无 WebGL 依赖,可在 Node/无头环境测试。

// ── 位打包常量(与 o3de VisibilityBuffer.azsli 一致) ────────────────

/** meshInfoIndex 占用的位数(低 30 位)。 */
export const MESHINFO_BITS = 30;
/** meshInfoIndex 最大值 + 1(2^30 = 1073741824)。 */
export const MAX_MESHINFO = 1 << MESHINFO_BITS;
/** meshInfoIndex 掩码(低 30 位)。 */
export const MESHINFO_MASK = MAX_MESHINFO - 1;
/** "meshInfoIndex 无效"标志位(第 31 位,最高位)。 */
export const MESHINFO_INVALID_BIT = 31;
/** "meshInfoIndex 无效"掩码。 */
export const MESHINFO_INVALID_MASK = 1 << MESHINFO_INVALID_BIT;
/** "三角形为正面"标志位(第 30 位)。 */
export const FRONTFACE_BIT = 30;
/** "三角形为正面"掩码。 */
export const FRONTFACE_MASK = 1 << FRONTFACE_BIT;

// ── 类型 ──────────────────────────────────────────────────────────

/** 3D 向量(纯数据,避免依赖外部 math 库)。 */
export interface VBVec3 {
  x: number;
  y: number;
  z: number;
}

/** 2D 向量(屏幕空间)。 */
export interface VBVec2 {
  x: number;
  y: number;
}

/** 已解包的可见性缓冲条目(每像素一个)。 */
export interface VisibilityBufferEntry {
  /** mesh 在 MeshInfo 表中的索引(低 30 位有效,-1 表示无效)。 */
  meshInfoIndex: number;
  /** mesh 内的三角形索引(从 0 开始)。 */
  triangleId: number;
  /** 是否为正面(逆时针绕序,与 gl_FrontFacing 一致)。 */
  isFrontFace: boolean;
  /** 三角形内重心坐标(u, v, w),u+v+w=1。 */
  barycentrics: VBVec3;
  /** 重心坐标在 x 方向的导数(用于 mip 选择,可选)。 */
  barycentricsDx?: VBVec3;
  /** 重心坐标在 y 方向的导数(用于 mip 选择,可选)。 */
  barycentricsDy?: VBVec3;
}

/** 打包后的可见性缓冲条目(两个 RGBA32F texel,与 o3de 一致)。 */
export interface VisibilityBufferPacked {
  /** 第一个 texel:[flagsAndMeshInfoIndex, triangleId, baryU, baryV]。 */
  first: Float32Array; // length = 4
  /** 第二个 texel:[baryDxU, baryDxV, baryDyU, baryDyV]。 */
  second: Float32Array; // length = 4
}

/** 单个 mesh 的元数据(查表用,不写进 visbuf)。 */
export interface MeshInfo {
  /** mesh 在表中的索引(对应 meshInfoIndex)。 */
  index: number;
  /** mesh 的顶点缓冲(Float32Array, stride=3 或更多,见 vertexStride)。 */
  vertices: Float32Array;
  /** mesh 的索引缓冲(Uint32Array)。 */
  indices: Uint32Array;
  /** 顶点 stride(单位:float,默认 3 = position only)。 */
  vertexStride: number;
  /** 可选:UV 偏移(在 stride 中的起始位置,默认 -1 表示无 UV)。 */
  uvOffset?: number;
  /** 可选:法线偏移(在 stride 中的起始位置,默认 -1 表示无法线)。 */
  normalOffset?: number;
  /** 可选:材质索引(用于延迟着色分流)。 */
  materialIndex?: number;
  /** 用户数据(透传)。 */
  userData?: unknown;
}

/** 待光栅化的三角形(已变换到屏幕空间)。 */
export interface VisibilityTriangle {
  /** mesh 在 MeshInfo 表中的索引。 */
  meshInfoIndex: number;
  /** mesh 内的三角形索引(每 3 个 indices 为一个三角形,triangleId × 3 起始)。 */
  triangleId: number;
  /** 三角形三个顶点的屏幕空间坐标(像素坐标,top-left 原点)。 */
  screenPositions: [VBVec2, VBVec2, VBVec2];
  /** 三角形三个顶点的深度(NDC 0..1,经透视除后)。 */
  depths: [number, number, number];
  /** 是否为正面(逆时针绕序,可预计算)。 */
  isFrontFace: boolean;
}

/** 可见性缓冲光栅化选项。 */
export interface VisibilityBufferOptions {
  /** 目标宽度(像素)。 */
  width: number;
  /** 目标高度(像素)。 */
  height: number;
  /** 是否计算重心坐标导数(默认 false,仅 shading 需要 mip 时开)。 */
  computeDerivatives?: boolean;
  /** 深度测试模式:'less' | 'lequal'(默认 'less',与 GL 一致)。 */
  depthFunc?: 'less' | 'lequal';
  /** 深度偏移(可选,缓解 z-fighting)。 */
  depthBias?: number;
}

/** 可见性缓冲光栅化结果。 */
export interface VisibilityBufferResult {
  /** 打包后的 visbuf(first + second 交错,长度 = width × height × 8)。 */
  data: Float32Array;
  /** 深度缓冲(可选,长度 = width × height)。 */
  depth: Float32Array;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
  /** 统计信息。 */
  stats: VisibilityBufferStats;
}

/** 光栅化统计。 */
export interface VisibilityBufferStats {
  /** 输入三角形数。 */
  triangleCount: number;
  /** 被视锥/屏幕裁剪掉的三角形数。 */
  culledTriangles: number;
  /** 被深度测试淘汰的片元数(累计)。 */
  depthFailedFragments: number;
  /** 通过深度测试并写入的片元数(累计)。 */
  depthPassedFragments: number;
  /** 空像素数(无任何三角形覆盖)。 */
  emptyPixels: number;
  /** 覆盖率(0..1)。 */
  coverage: number;
}

/** 解压后的像素信息(用于延迟着色)。 */
export interface DecompressedPixel {
  /** mesh 信息(若像素为空则为 null)。 */
  meshInfo: MeshInfo | null;
  /** 三角形索引。 */
  triangleId: number;
  /** 重心坐标。 */
  barycentrics: VBVec3;
  /** 是否为正面。 */
  isFrontFace: boolean;
  /** 是否为空像素(无几何)。 */
  isEmpty: boolean;
}

// ── 位打包工具(纯函数,与 o3de packVisibilityBuffer 1:1 对应) ───────

/**
 * 把 uint32 解释为 float32(对应 GLSL `asfloat` / JS `DataView.setUint32`)。
 *
 * 注意:JS 没有原生 reinterpret,用 DataView 做位转换。
 */
const uintAsFloatBuffer = new DataView(new ArrayBuffer(4));

export function uintAsFloat(u: number): number {
  uintAsFloatBuffer.setUint32(0, u >>> 0, true);
  return uintAsFloatBuffer.getFloat32(0, true);
}

/**
 * 把 float32 解释为 uint32(对应 GLSL `asuint(float)`)。
 */
export function floatAsUint(f: number): number {
  uintAsFloatBuffer.setFloat32(0, f, true);
  return uintAsFloatBuffer.getUint32(0, true);
}

/**
 * 打包可见性缓冲条目为两个 RGBA32F texel(与 o3de `packVisibilityBuffer` 一致)。
 *
 * 内存布局:
 *   first.x  = asfloat(flagsAndMeshInfoIndex)
 *              - bit 31: meshInfoIndex 无效标志
 *              - bit 30: isFrontFace 标志
 *              - bit 29..0: meshInfoIndex(低 30 位)
 *   first.y  = asfloat(triangleId)
 *   first.zw = barycentrics.xy
 *   second.xy = barycentricsDx.xy
 *   second.zw = barycentricsDy.xy
 *
 * 注意:与 o3de 一致,如果 meshInfoIndex < 0(无效),bit 31 置 1。
 * 重心坐标的第三个分量 w 可由 1-u-v 重建,无需存储。
 */
export function packVisibilityBuffer(entry: VisibilityBufferEntry): VisibilityBufferPacked {
  const first = new Float32Array(4);
  const second = new Float32Array(4);

  // meshInfoIndex 低 30 位
  let flagsAndMeshInfoIndex = (entry.meshInfoIndex >>> 0) & MESHINFO_MASK;

  // bit 31: meshInfoIndex 无效
  if (entry.meshInfoIndex < 0) {
    flagsAndMeshInfoIndex |= MESHINFO_INVALID_MASK;
  }

  // bit 30: isFrontFace
  if (entry.isFrontFace) {
    flagsAndMeshInfoIndex |= FRONTFACE_MASK;
  }

  first[0] = uintAsFloat(flagsAndMeshInfoIndex);
  first[1] = uintAsFloat(entry.triangleId >>> 0);
  first[2] = entry.barycentrics.x;
  first[3] = entry.barycentrics.y;

  // 导数(可选)
  const dx = entry.barycentricsDx ?? { x: 0, y: 0, z: 0 };
  const dy = entry.barycentricsDy ?? { x: 0, y: 0, z: 0 };
  second[0] = dx.x;
  second[1] = dx.y;
  second[2] = dy.x;
  second[3] = dy.y;

  return { first, second };
}

/**
 * 仅取 meshInfoIndex(快速路径,不解析重心坐标)。
 *
 * 返回 { valid, meshInfoIndex }:
 *   - valid=false 表示该像素为空(无几何,即 -0.0f 标记)。
 *   - meshInfoIndex 为低 30 位(若无效,返回 -1)。
 *
 * 注意:空像素标记为 -0.0f(0x80000000),与 +0.0f(0x00000000)在位级不同。
 * meshInfoIndex=0 + isFrontFace=false + 无 INVALID 标志 → raw=0(+0.0f),是**有效**像素。
 * 调用方必须先用 -0.0f 初始化 visbuf(buildVisibilityBuffer 已做)。
 */
export function getMeshInfoIndex(firstX: number): { valid: boolean; meshInfoIndex: number } {
  // 用 Object.is 区分 -0.0f(空)和 +0.0f(meshInfoIndex=0,有效)
  if (Object.is(firstX, -0)) {
    return { valid: false, meshInfoIndex: -1 };
  }
  const raw = floatAsUint(firstX);
  const meshInfoInvalid = (raw & MESHINFO_INVALID_MASK) !== 0;
  let meshInfoIndex = raw & MESHINFO_MASK;
  if (meshInfoInvalid) {
    meshInfoIndex = -meshInfoIndex;
  }
  return { valid: !meshInfoInvalid, meshInfoIndex };
}

/**
 * 解包可见性缓冲条目(与 o3de `unpackVisibilityBuffer` 一致)。
 *
 * 重建:
 *   - isFrontFace = (raw & FRONTFACE_MASK) != 0
 *   - meshInfoIndex = raw & MESHINFO_MASK(若 INVALID 位置 1,取负)
 *   - triangleId = asuint(first.y)
 *   - barycentrics.z = 1 - x - y
 *   - barycentricsDx.z / barycentricsDy.z 由邻接像素重建
 *
 * 返回 null 表示该像素为空(无几何)。
 */
export function unpackVisibilityBuffer(
  first: ArrayLike<number>,
  second: ArrayLike<number>,
): VisibilityBufferEntry | null {
  // 空像素检测:用 Object.is 区分 -0.0f(空)和 +0.0f(meshInfoIndex=0,有效)
  if (Object.is(first[0], -0)) {
    return null;
  }
  const raw = floatAsUint(first[0]);

  const meshInfoInvalid = (raw & MESHINFO_INVALID_MASK) !== 0;
  const isFrontFace = (raw & FRONTFACE_MASK) !== 0;
  let meshInfoIndex = raw & MESHINFO_MASK;
  if (meshInfoInvalid) {
    meshInfoIndex = -meshInfoIndex;
  }

  const triangleId = floatAsUint(first[1]);
  const bx = first[2];
  const by = first[3];
  const bz = 1.0 - bx - by;

  const dxX = second[0];
  const dxY = second[1];
  const dyX = second[2];
  const dyY = second[3];

  // 重建第三个分量的导数(与 o3de 一致)
  // 邻接像素 x 的重心:(bx + dxX, by + dxY, 1 - (bx+dxX) - (by+dxY))
  //                       = (bx + dxX, by + dxY, bz - dxX - dxY)
  // 所以 dxZ = -dxX - dxY
  const dxZ = -dxX - dxY;
  const dyZ = -dyX - dyY;

  return {
    meshInfoIndex,
    triangleId,
    isFrontFace,
    barycentrics: { x: bx, y: by, z: bz },
    barycentricsDx: { x: dxX, y: dxY, z: dxZ },
    barycentricsDy: { x: dyX, y: dyY, z: dyZ },
  };
}

// ── 重心坐标 ──────────────────────────────────────────────────────

/**
 * 计算点 p 在三角形 (a, b, c) 内的 2D 重心坐标(u, v, w)。
 *
 * 公式(标准重心坐标):
 *   v0 = b - a, v1 = c - a, v2 = p - a
 *   d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1)
 *   d20 = dot(v2, v0), d21 = dot(v2, v1)
 *   denom = d00 * d11 - d01 * d01
 *   v = (d11 * d20 - d01 * d21) / denom
 *   w = (d00 * d21 - d01 * d20) / denom
 *   u = 1 - v - w
 *
 * 这里 u 对应顶点 a,v 对应 b,w 对应 c。
 *
 * 返回 { u, v, w }(若 denom 接近 0 返回 { 1, 0, 0 } 退化值)。
 */
export function computeBarycentric2D(
  px: number,
  py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): VBVec3 {
  const v0x = bx - ax;
  const v0y = by - ay;
  const v1x = cx - ax;
  const v1y = cy - ay;
  const v2x = px - ax;
  const v2y = py - ay;

  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) {
    return { x: 1, y: 0, z: 0 };
  }
  const invDenom = 1.0 / denom;
  const v = (d11 * d20 - d01 * d21) * invDenom;
  const w = (d00 * d21 - d01 * d20) * invDenom;
  const u = 1.0 - v - w;
  return { x: u, y: v, z: w };
}

/**
 * 通过 edge function 判断点 (px, py) 是否在三角形内,并返回重心坐标。
 *
 * Edge function(线性重心坐标的快速版本):
 *   area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
 *   若 area2 == 0:退化,返回 false
 *   若 area2 < 0:顺时针绕序,需翻转符号(支持 CCW 和 CW)
 *   w = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area2
 *   v = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) / area2
 *   u = 1 - v - w
 *
 * 包含边界(>=0)。
 */
export function edgeFunctionBarycentric(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): { inside: boolean; bary: VBVec3; isFrontFace: boolean } {
  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area2) < 1e-12) {
    return { inside: false, bary: { x: 0, y: 0, z: 0 }, isFrontFace: false };
  }
  const isFrontFace = area2 > 0;
  const invArea2 = 1.0 / area2;
  const w = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * invArea2;
  const v = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * invArea2;
  const u = 1.0 - v - w;
  // 允许在边界上(>=0);若 area2 < 0(CW),u/v/w 已自动翻转符号
  const inside = u >= 0 && v >= 0 && w >= 0;
  return { inside, bary: { x: u, y: v, z: w }, isFrontFace };
}

// ── 软件光栅化(CPU 参考实现,无 WebGL 依赖) ───────────────────────

/** 把打包后的 visbuf 数据索引(像素坐标 → first/second 数组偏移)。 */
export function pixelOffset(x: number, y: number, width: number): number {
  return (y * width + x) * 8; // first(4) + second(4)
}

/**
 * 光栅化单个三角形到 visbuf(深度测试)。
 *
 * 算法:
 *   1. 计算三角形屏幕空间 AABB;
 *   2. 遍历 AABB 内像素;
 *   3. 用 edge function 判断是否在三角形内;
 *   4. 用重心坐标插值深度;
 *   5. 深度测试(less / lequal),通过则写入 visbuf + depth。
 *
 * 不做早期 z 剔除(每像素都做深度测试),与 GPU 行为一致。
 * 不做混合(后绘制的覆盖先绘制的,即 painter's algorithm 不适用)。
 *
 * @param tri       待光栅化的三角形
 * @param visbuf    visbuf 数据(长度 = width × height × 8)
 * @param depth     深度缓冲(长度 = width × height)
 * @param width     目标宽度
 * @param height    目标高度
 * @param options   光栅化选项
 * @returns         统计(深度通过/失败计数)
 */
export function rasterizeTriangle(
  tri: VisibilityTriangle,
  visbuf: Float32Array,
  depth: Float32Array,
  width: number,
  height: number,
  options: Pick<VisibilityBufferOptions, 'depthFunc' | 'depthBias' | 'computeDerivatives'> = {},
): { depthPassed: number; depthFailed: number } {
  const [p0, p1, p2] = tri.screenPositions;
  const [z0, z1, z2] = tri.depths;
  const depthFunc = options.depthFunc ?? 'less';
  const depthBias = options.depthBias ?? 0;
  const computeDerivatives = options.computeDerivatives ?? false;

  // 屏幕空间 AABB
  const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));

  if (minX > maxX || minY > maxY) {
    return { depthPassed: 0, depthFailed: 0 };
  }

  // 三角形面积(2×)= edge function 在 (a, b, c) 处的值
  const area2 = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
  if (Math.abs(area2) < 1e-12) {
    return { depthPassed: 0, depthFailed: 0 };
  }
  const invArea2 = 1.0 / area2;

  // 重心坐标对屏幕 x/y 的导数(用于 mip 选择)
  // 设 a=p0, b=p1, c=p2,area2 = (b-a) × (c-a)(2× 三角形有符号面积)
  //   w(对应 c)= ((b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x)) / area2
  //     → dw/dx = -(b.y-a.y)/area2,  dw/dy =  (b.x-a.x)/area2
  //   v(对应 b)= ((a.x-c.x)*(p.y-c.y) - (a.y-c.y)*(p.x-c.x)) / area2
  //     → dv/dx =  (c.y-a.y)/area2,  dv/dy = -(c.x-a.x)/area2
  //   u(对应 a)= 1 - v - w
  //     → du/dx = -dv/dx - dw/dx,   du/dy = -dv/dy - dw/dy
  const dwdx = -(p1.y - p0.y) * invArea2;
  const dwdy = (p1.x - p0.x) * invArea2;
  const dvdx = (p2.y - p0.y) * invArea2;
  const dvdy = -(p2.x - p0.x) * invArea2;
  const dudx = -dvdx - dwdx;
  const dudy = -dvdy - dwdy;

  let depthPassed = 0;
  let depthFailed = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // 像素中心 +0.5
      const px = x + 0.5;
      const py = y + 0.5;

      // edge function 重心坐标
      const w = ((p1.x - p0.x) * (py - p0.y) - (p1.y - p0.y) * (px - p0.x)) * invArea2;
      const v = ((p0.x - p2.x) * (py - p2.y) - (p0.y - p2.y) * (px - p2.x)) * invArea2;
      const u = 1.0 - v - w;

      // 在三角形内(包含边界,与 GL 默认一致)
      // 注意:若 area2 < 0(CW 绕序),u/v/w 会自动翻转,但仍需全部 >=0
      if (u < 0 || v < 0 || w < 0) continue;

      // 插值深度(透视正确需要 w/w0/w1/w2,这里用屏幕空间线性插值近似)
      const z = z0 * u + z1 * v + z2 * w;

      const pixelIdx = y * width + x;
      const storedDepth = depth[pixelIdx];

      // 深度测试
      const zBiased = z + depthBias;
      let pass: boolean;
      if (depthFunc === 'less') {
        pass = zBiased < storedDepth;
      } else {
        pass = zBiased <= storedDepth;
      }
      if (!pass) {
        depthFailed++;
        continue;
      }
      depth[pixelIdx] = zBiased;
      depthPassed++;

      // 写入 visbuf
      const off = pixelOffset(x, y, width);
      let flagsAndMeshInfoIndex = (tri.meshInfoIndex >>> 0) & MESHINFO_MASK;
      if (tri.meshInfoIndex < 0) {
        flagsAndMeshInfoIndex |= MESHINFO_INVALID_MASK;
      }
      if (tri.isFrontFace) {
        flagsAndMeshInfoIndex |= FRONTFACE_MASK;
      }
      visbuf[off + 0] = uintAsFloat(flagsAndMeshInfoIndex);
      visbuf[off + 1] = uintAsFloat(tri.triangleId >>> 0);
      visbuf[off + 2] = u;
      visbuf[off + 3] = v;

      if (computeDerivatives) {
        // second.xy = barycentricsDx.xy = (du/dx, dv/dx)
        // second.zw = barycentricsDy.xy = (du/dy, dv/dy)
        visbuf[off + 4] = dudx;
        visbuf[off + 5] = dvdx;
        visbuf[off + 6] = dudy;
        visbuf[off + 7] = dvdy;
      } else {
        visbuf[off + 4] = 0;
        visbuf[off + 5] = 0;
        visbuf[off + 6] = 0;
        visbuf[off + 7] = 0;
      }
    }
  }

  return { depthPassed, depthFailed };
}

/**
 * 构建完整可见性缓冲(光栅化所有三角形)。
 *
 * @param triangles  待光栅化的三角形数组
 * @param options    光栅化选项
 * @returns          光栅化结果(visbuf + depth + stats)
 */
export function buildVisibilityBuffer(
  triangles: VisibilityTriangle[],
  options: VisibilityBufferOptions,
): VisibilityBufferResult {
  const { width, height } = options;
  const computeDerivatives = options.computeDerivatives ?? false;
  const depthFunc = options.depthFunc ?? 'less';
  const depthBias = options.depthBias ?? 0;

  // 初始化 visbuf(first.x = -0.0f 表示空,即 0x80000000)
  const data = new Float32Array(width * height * 8);
  for (let i = 0; i < width * height; i++) {
    const off = i * 8;
    data[off + 0] = uintAsFloat(0x80000000); // -0.0f
    data[off + 1] = 0;
    data[off + 2] = 0;
    data[off + 3] = 0;
    data[off + 4] = 0;
    data[off + 5] = 0;
    data[off + 6] = 0;
    data[off + 7] = 0;
  }

  // 初始化深度缓冲(最大值,确保首个三角形通过 less 测试)
  const depth = new Float32Array(width * height).fill(Infinity);

  let culledTriangles = 0;
  let depthPassedFragments = 0;
  let depthFailedFragments = 0;

  for (const tri of triangles) {
    const [p0, p1, p2] = tri.screenPositions;
    // 屏幕外裁剪(整个三角形在视口外)
    const minX = Math.min(p0.x, p1.x, p2.x);
    const maxX = Math.max(p0.x, p1.x, p2.x);
    const minY = Math.min(p0.y, p1.y, p2.y);
    const maxY = Math.max(p0.y, p1.y, p2.y);
    if (maxX < 0 || minX >= width || maxY < 0 || minY >= height) {
      culledTriangles++;
      continue;
    }

    const result = rasterizeTriangle(tri, data, depth, width, height, {
      depthFunc,
      depthBias,
      computeDerivatives,
    });
    depthPassedFragments += result.depthPassed;
    depthFailedFragments += result.depthFailed;
  }

  // 统计空像素(只认 -0.0f 标记,+0.0f 是有效像素 meshInfoIndex=0)
  let emptyPixels = 0;
  for (let i = 0; i < width * height; i++) {
    if (Object.is(data[i * 8], -0)) {
      emptyPixels++;
    }
  }

  const coverage = 1.0 - emptyPixels / (width * height);

  return {
    data,
    depth,
    width,
    height,
    stats: {
      triangleCount: triangles.length,
      culledTriangles,
      depthFailedFragments,
      depthPassedFragments,
      emptyPixels,
      coverage,
    },
  };
}

// ── 解压(用于延迟着色) ───────────────────────────────────────────

/**
 * 解压单个像素的可见性缓冲,返回三角形/重心信息。
 *
 * @param result         buildVisibilityBuffer 的结果
 * @param x              像素 x 坐标
 * @param y              像素 y 坐标
 * @param meshInfoTable  mesh 信息表(meshInfoIndex → MeshInfo)
 * @returns              解压结果(若像素为空,isEmpty=true)
 */
export function decompressPixel(
  result: VisibilityBufferResult,
  x: number,
  y: number,
  meshInfoTable: Map<number, MeshInfo> | MeshInfo[],
): DecompressedPixel {
  const off = pixelOffset(x, y, result.width);
  const first = [
    result.data[off + 0],
    result.data[off + 1],
    result.data[off + 2],
    result.data[off + 3],
  ];
  const second = [
    result.data[off + 4],
    result.data[off + 5],
    result.data[off + 6],
    result.data[off + 7],
  ];

  const entry = unpackVisibilityBuffer(first, second);
  if (entry === null) {
    return {
      meshInfo: null,
      triangleId: 0,
      barycentrics: { x: 0, y: 0, z: 0 },
      isFrontFace: false,
      isEmpty: true,
    };
  }

  let meshInfo: MeshInfo | null = null;
  if (meshInfoTable instanceof Map) {
    meshInfo = meshInfoTable.get(entry.meshInfoIndex) ?? null;
  } else {
    meshInfo = meshInfoTable[entry.meshInfoIndex] ?? null;
  }

  return {
    meshInfo,
    triangleId: entry.triangleId,
    barycentrics: entry.barycentrics,
    isFrontFace: entry.isFrontFace,
    isEmpty: false,
  };
}

/**
 * 用重心坐标插值顶点属性(通用版本)。
 *
 * @param attrs   顶点属性数组(每个顶点一个 Float32Array,长度可不同)
 * @param bary    重心坐标(u, v, w)对应 attrs[0], attrs[1], attrs[2]
 * @returns       插值结果(长度与输入属性相同)
 */
export function interpolateAttributes(
  attrs: [Float32Array, Float32Array, Float32Array],
  bary: VBVec3,
): Float32Array {
  const len = attrs[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = attrs[0][i] * bary.x + attrs[1][i] * bary.y + attrs[2][i] * bary.z;
  }
  return out;
}

/**
 * 从 MeshInfo + triangleId 取出三角形的三个顶点位置(用于 shading)。
 *
 * @param meshInfo    mesh 信息
 * @param triangleId  三角形索引(每 3 个 indices 为一个三角形)
 * @returns           三个顶点位置(Float32Array, 每个 length=3),或 null 表示越界
 */
export function fetchTriangleVertices(
  meshInfo: MeshInfo,
  triangleId: number,
): [Float32Array, Float32Array, Float32Array] | null {
  if (triangleId < 0) return null;
  const baseIdx = triangleId * 3;
  if (baseIdx + 2 >= meshInfo.indices.length) return null;

  const i0 = meshInfo.indices[baseIdx];
  const i1 = meshInfo.indices[baseIdx + 1];
  const i2 = meshInfo.indices[baseIdx + 2];
  const stride = meshInfo.vertexStride;

  const p0 = meshInfo.vertices.subarray(i0 * stride, i0 * stride + 3).slice() as Float32Array;
  const p1 = meshInfo.vertices.subarray(i1 * stride, i1 * stride + 3).slice() as Float32Array;
  const p2 = meshInfo.vertices.subarray(i2 * stride, i2 * stride + 3).slice() as Float32Array;
  return [p0, p1, p2];
}

/**
 * 从 MeshInfo + triangleId + 重心坐标取出插值后的顶点位置。
 *
 * 这是延迟着色的"几何重建"步骤:visbuf → 插值位置 → 着色。
 */
export function fetchInterpolatedPosition(
  meshInfo: MeshInfo,
  triangleId: number,
  bary: VBVec3,
): Float32Array | null {
  const tri = fetchTriangleVertices(meshInfo, triangleId);
  if (tri === null) return null;
  return interpolateAttributes(tri, bary);
}

// ── GLSL 着色器 chunks(GPU 端可直接使用,与 CPU 参考实现同格式) ────

/**
 * Visibility Buffer 打包 utility(GLSL ES 3.0 chunk,可内嵌到打包 fragment shader)。
 *
 * 与 o3de `VisibilityBuffer.azsli` packVisibilityBuffer 函数一致。
 *
 * 用法:在 fragment shader 中:
 *   layout(location = 0) out vec4 outVisbufFirst;
 *   layout(location = 1) out vec4 outVisbufSecond;
 *   ...
 *   packVisibilityBuffer(meshInfoIndex, triangleId, isFrontFace, bary,
 *                       baryDx, baryDy, outVisbufFirst, outVisbufSecond);
 */
export const VISIBILITY_BUFFER_PACK_UTILITY = /* glsl */ `
#define VB_MESHINFO_BITS 30
#define VB_MAX_MESHINFO (1 << VB_MESHINFO_BITS)
#define VB_MESHINFO_MASK (VB_MAX_MESHINFO - 1)
#define VB_MESHINFO_INVALID_BIT 31
#define VB_MESHINFO_INVALID_MASK (1u << VB_MESHINFO_INVALID_BIT)
#define VB_FRONTFACE_BIT 30
#define VB_FRONTFACE_MASK (1u << VB_FRONTFACE_BIT)

// 打包可见性缓冲条目到两个 RGBA32F texel。
// 第三个重心坐标 w = 1 - u - v,无需存储。
void packVisibilityBuffer(
    int meshInfoIndex, uint triangleId, bool isFrontFace,
    vec3 barycentrics, vec3 barycentricsDx, vec3 barycentricsDy,
    inout vec4 first, inout vec4 second)
{
    uint flagsAndMeshInfoIndex = uint(VB_MESHINFO_MASK) & uint(meshInfoIndex);
    if (meshInfoIndex < 0) {
        flagsAndMeshInfoIndex |= VB_MESHINFO_INVALID_MASK;
    }
    if (isFrontFace) {
        flagsAndMeshInfoIndex |= VB_FRONTFACE_MASK;
    }
    first.x = uintBitsToFloat(flagsAndMeshInfoIndex);
    first.y = uintBitsToFloat(triangleId);
    first.zw = barycentrics.xy;
    second.xy = barycentricsDx.xy;
    second.zw = barycentricsDy.xy;
}

// 仅取 meshInfoIndex(快速路径)
// 返回 true 表示该像素有几何,false 表示空像素。
bool getMeshInfoIndex(vec4 first, out int meshInfoIndex) {
    uint raw = floatBitsToUint(first.x);
    if (raw == 0x80000000u || raw == 0u) {
        meshInfoIndex = -1;
        return false;
    }
    bool meshInfoInvalid = (VB_MESHINFO_INVALID_MASK & raw) != 0u;
    meshInfoIndex = int(VB_MESHINFO_MASK & raw);
    if (meshInfoInvalid) {
        meshInfoIndex = -meshInfoIndex;
    }
    return !meshInfoInvalid;
}

// 解包可见性缓冲条目(完整版,包含重心坐标重建)
bool unpackVisibilityBuffer(vec4 first, vec4 second,
    out int meshInfoIndex, out uint triangleId, out bool isFrontFace,
    out vec3 barycentrics, out vec3 barycentricsDx, out vec3 barycentricsDy)
{
    uint raw = floatBitsToUint(first.x);
    if (raw == 0x80000000u || raw == 0u) {
        meshInfoIndex = -1;
        triangleId = 0u;
        isFrontFace = false;
        barycentrics = vec3(0.0);
        barycentricsDx = vec3(0.0);
        barycentricsDy = vec3(0.0);
        return false;
    }
    bool meshInfoInvalid = (VB_MESHINFO_INVALID_MASK & raw) != 0u;
    isFrontFace = (VB_FRONTFACE_MASK & raw) != 0u;
    meshInfoIndex = int(VB_MESHINFO_MASK & raw);
    if (meshInfoInvalid) {
        meshInfoIndex = -meshInfoIndex;
    }
    triangleId = floatBitsToUint(first.y);
    barycentrics.xy = first.zw;
    barycentrics.z = 1.0 - barycentrics.x - barycentrics.y;
    barycentricsDx.xy = second.xy;
    barycentricsDx.z = -barycentricsDx.x - barycentricsDx.y;
    barycentricsDy.xy = second.zw;
    barycentricsDy.z = -barycentricsDy.x - barycentricsDy.y;
    return true;
}
`;

/**
 * Visibility Buffer 打包 vertex shader(基础版,展示用法)。
 *
 * 实际引擎中通常与 meshlet software rasterizer 结合,
 * 这里给出硬件光栅化路径的参考实现。
 *
 * uniform:
 *   - mat4 u_viewProjection       视图投影矩阵
 *   - int  u_meshInfoIndex        mesh 在 MeshInfo 表中的索引
 *   - ivec2 u_viewportSize        视口大小(像素)
 *
 * attribute:
 *   - vec3 a_position             顶点位置(模型空间)
 *   - uint a_vertexIndex          顶点索引(gl_VertexID)
 *
 * varying(out):
 *   - flat int  v_meshInfoIndex
 *   - flat uint v_triangleId      (= gl_VertexID / 3)
 *   - flat bool v_isFrontFace
 *   - vec3 v_barycentrics         (在 fragment 中由 gl_BarycentricEXT 计算)
 *   - vec3 v_barycentricsDx, v_barycentricsDy (在 fragment 中由 fwidth 计算)
 */
export const VISIBILITY_BUFFER_PACK_VERT = /* glsl */ `#version 300 es
${VISIBILITY_BUFFER_PACK_UTILITY}

uniform mat4 u_viewProjection;
uniform int  u_meshInfoIndex;
uniform ivec2 u_viewportSize;

in vec3 a_position;

flat out int  v_meshInfoIndex;
flat out uint v_triangleId;
flat out bool v_isFrontFace;
out vec3 v_barycentrics;
out vec3 v_barycentricsDx;
out vec3 v_barycentricsDy;

void main() {
    v_meshInfoIndex = u_meshInfoIndex;
    v_triangleId = uint(gl_VertexID) / 3u;
    // isFrontFace 在 fragment 中由 gl_FrontFacing 决定,这里先置 true
    v_isFrontFace = true;
    vec4 clip = u_viewProjection * vec4(a_position, 1.0);
    gl_Position = clip;
    // 初始化 varying(gl_BarycentricEXT 需要 GL_EXT_fragment_shader_barycentric)
    v_barycentrics = vec3(0.0);
    v_barycentricsDx = vec3(0.0);
    v_barycentricsDy = vec3(0.0);
}
`;

/**
 * Visibility Buffer 打包 fragment shader(基础版,展示用法)。
 *
 * 需要扩展:
 *   #extension GL_EXT_fragment_shader_barycentric : require
 *
 * varying(in):
 *   - flat int  v_meshInfoIndex
 *   - flat uint v_triangleId
 *   - flat bool v_isFrontFace
 *
 * output:
 *   - layout(location = 0) out vec4 outVisbufFirst
 *   - layout(location = 1) out vec4 outVisbufSecond
 */
export const VISIBILITY_BUFFER_PACK_FRAG = /* glsl */ `#version 300 es
#extension GL_EXT_fragment_shader_barycentric : require
precision highp float;
precision highp int;

${VISIBILITY_BUFFER_PACK_UTILITY}

flat in int  v_meshInfoIndex;
flat in uint v_triangleId;
flat in bool v_isFrontFace;

layout(location = 0) out vec4 outVisbufFirst;
layout(location = 1) out vec4 outVisbufSecond;

void main() {
    // gl_BarycentricEXT 提供 (u, v, w) 重心坐标(无透视)
    vec3 bary = gl_BarycentricEXT;
    // 导数(用于 mip 选择)
    vec3 baryDx = dFdx(bary);
    vec3 baryDy = dFdy(bary);

    vec4 first = vec4(0.0);
    vec4 second = vec4(0.0);
    packVisibilityBuffer(v_meshInfoIndex, v_triangleId, gl_FrontFacing,
                         bary, baryDx, baryDy, first, second);
    outVisbufFirst = first;
    outVisbufSecond = second;
}
`;

/**
 * Visibility Buffer 解包 utility(GLSL ES 3.0 chunk,用于延迟着色 pass)。
 *
 * 用法:在 deferred shading fragment shader 中:
 *   uniform sampler2D u_visbufFirst;
 *   uniform sampler2D u_visbufSecond;
 *   ...
 *   vec4 first = texelFetch(u_visbufFirst, ivec2(gl_FragCoord.xy), 0);
 *   vec4 second = texelFetch(u_visbufSecond, ivec2(gl_FragCoord.xy), 0);
 *   int meshInfoIndex; uint triangleId; bool isFrontFace;
 *   vec3 bary, baryDx, baryDy;
 *   if (!unpackVisibilityBuffer(first, second, meshInfoIndex, triangleId,
 *                                isFrontFace, bary, baryDx, baryDy)) {
 *       discard; // 空像素,跳过着色
 *   }
 *   // 用 meshInfoIndex 查 MeshInfo 表(SSBO / texture)
 *   // 用 triangleId 查 vertex buffer
 *   // 用 bary 插值顶点属性
 *   // 着色...
 */
export const VISIBILITY_BUFFER_UNPACK_UTILITY = VISIBILITY_BUFFER_PACK_UTILITY;
