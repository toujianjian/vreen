// MeshletRenderer — Meshlet 渲染器(meshlet 生成 + 可见性剔除 + indirect draw 打包)。
//
// 适配自:
//   - three.js meshopt_clusterizer.module.js (meshlet 生成 + bounds)
//   - o3de Atom MeshletsModule (GPU 驱动 meshlet 管线)
//   - UE5 Nanite (meshlet 级别的视锥/遮挡/背面剔除)
//   - meshoptimizer (Arseny Kapoulkine) 的 buildMeshlets 算法
//
// 核心思想:
//   1. 把大网格按顶点/三角形上限切分成若干 meshlet(簇);
//   2. 每个 meshlet 有独立包围球 + 法线锥(用于背面剔除);
//   3. 渲染前对每个 meshlet 做视锥剔除 + 背面剔除 + HZB 遮挡剔除;
//   4. 可见 meshlet 打包成 indirect draw command 数组,一次性提交。
//
// 与 GPUDrivenRenderer 的关系:
//   - GPUDrivenRenderer 在 mesh 粒度做剔除 + indirect draw;
//   - MeshletRenderer 在 meshlet 粒度(更细)做剔除,适合超大网格(百万三角形)。
//   - 两者可组合:GPUDrivenRenderer 管理 mesh 级别,MeshletRenderer 管理单 mesh 内部。
//
// 与 soup3D 的对比:
//   soup3D 没有任何 meshlet / GPU 驱动渲染能力,所有 mesh 整体提交。
//   VREEN 的 meshlet 管线匹配 UE5 Nanite / o3de MeshletsModule 的设计。

// ── 类型 ──────────────────────────────────────────────────────────

/** 3D 向量。 */
export interface MeshletVec3 {
  x: number;
  y: number;
  z: number;
}

/** 单个 meshlet 的数据。 */
export interface MeshletData {
  /** meshlet 在原始网格中的索引。 */
  meshletId: number;
  /** 局部顶点索引(指向 vertices 数组,0..vertexCount-1)。 */
  localVertexIndices: Uint32Array;
  /** 局部三角形索引(每 3 个一组,引用 localVertexIndices)。 */
  localTriangleIndices: Uint32Array;
  /** 全局顶点索引(指向原始网格的顶点数组)。 */
  globalVertexIndices: Uint32Array;
  /** 三角形数量。 */
  triangleCount: number;
  /** 顶点数量。 */
  vertexCount: number;
}

/** meshlet 的包围信息。 */
export interface MeshletBounds {
  /** meshletId(与 MeshletData.meshletId 对应)。 */
  meshletId: number;
  /** 包围球中心(世界空间或模型空间,取决于构建时输入)。 */
  center: MeshletVec3;
  /** 包围球半径。 */
  radius: number;
  /** 法线锥顶点(用于背面剔除)。 */
  coneApex: MeshletVec3;
  /** 法线锥轴向(归一化)。 */
  coneAxis: MeshletVec3;
  /** 法线锥半角(弧度,cos(cutoff)用于背面判定)。 */
  coneCutoff: number;
}

/** meshlet 构建选项。 */
export interface MeshletBuildOptions {
  /** 每个 meshlet 最大顶点数(默认 64,范围 3..256)。 */
  maxVertices?: number;
  /** 每个 meshlet 最大三角形数(默认 124,范围 1..512)。 */
  maxTriangles?: number;
  /** 是否计算法线锥(默认 true,用于背面剔除)。 */
  computeCone?: boolean;
}

/** meshlet 构建结果。 */
export interface MeshletBuildResult {
  /** 所有 meshlet。 */
  meshlets: MeshletData[];
  /** 每个 meshlet 的包围信息。 */
  bounds: MeshletBounds[];
  /** meshlet 总数。 */
  meshletCount: number;
  /** 原始顶点数。 */
  vertexCount: number;
  /** 原始三角形数。 */
  triangleCount: number;
}

/** meshlet 剔除选项。 */
export interface MeshletCullOptions {
  /** 是否启用视锥剔除(默认 true)。 */
  frustumCulling?: boolean;
  /** 是否启用背面剔除(默认 true,需要 bounds 中有法线锥)。 */
  backfaceCulling?: boolean;
  /** 是否启用 HZB 遮挡剔除(默认 false)。 */
  occlusionCulling?: boolean;
  /** 视点位置(世界空间,背面剔除用)。 */
  viewPosition?: MeshletVec3;
  /** 6 个视锥平面(每个 [a, b, c, d],ax+by+cz+d>=0 在内部)。 */
  frustumPlanes?: number[][];
  /** HZB 数据(来自 HierarchicalZBuffer.buildHZB)。 */
  hzb?: Float32Array;
  /** HZB 宽度。 */
  hzbWidth?: number;
  /** HZB 高度。 */
  hzbHeight?: number;
  /** 视图投影矩阵(16 元素,列主序,用于 HZB 投影)。 */
  viewProjectionMatrix?: number[];
  /** 保守偏移(HZB 用,减小误剔除)。 */
  conservativeBias?: number;
}

/** meshlet 剔除结果。 */
export interface MeshletCullResult {
  /** 可见 meshlet 的 ID 列表。 */
  visibleMeshletIds: number[];
  /** 被视锥剔除的数量。 */
  frustumCulled: number;
  /** 被背面剔除的数量。 */
  backfaceCulled: number;
  /** 被遮挡剔除的数量。 */
  occlusionCulled: number;
  /** 总 meshlet 数。 */
  totalMeshlets: number;
  /** 可见 meshlet 数。 */
  visibleCount: number;
}

/** indirect draw command(meshlet 级别)。 */
export interface MeshletDrawCommand {
  /** meshlet 索引(在 MeshletBuildResult.meshlets 中)。 */
  meshletId: number;
  /** 索引数(三角形数 × 3)。 */
  indexCount: number;
  /** 实例数(始终为 1,meshlet 不做 instancing)。 */
  instanceCount: number;
  /** 索引缓冲起始偏移。 */
  firstIndex: number;
  /** 顶点偏移。 */
  vertexOffset: number;
  /** 第一个实例。 */
  firstInstance: number;
}

// ── 向量工具 ─────────────────────────────────────────────────────

function v3(x: number, y: number, z: number): MeshletVec3 {
  return { x, y, z };
}

function vsub(a: MeshletVec3, b: MeshletVec3): MeshletVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vadd(a: MeshletVec3, b: MeshletVec3): MeshletVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vscale(a: MeshletVec3, s: number): MeshletVec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function vdot(a: MeshletVec3, b: MeshletVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vcross(a: MeshletVec3, b: MeshletVec3): MeshletVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vlength(a: MeshletVec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function vnormalize(a: MeshletVec3): MeshletVec3 {
  const len = vlength(a);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  const inv = 1.0 / len;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

// ── meshlet 生成 ─────────────────────────────────────────────────

/**
 * 把三角形网格切分成 meshlet。
 *
 * 算法(贪心,适配自 meshoptimizer buildMeshlets):
 *   1. 遍历三角形,把每个三角形加入当前 meshlet;
 *   2. 如果加入后顶点数超 maxVertices 或三角形数超 maxTriangles,开新 meshlet;
 *   3. 顶点用 Map 做全局→局部映射(避免重复顶点)。
 *
 * 注意:本实现不做三角形重排优化(meshoptimizer 的 cache 优化),
 *       保持纯 TypeScript 无 WASM 依赖。调用方可在外部做优化。
 *
 * @param positions  顶点位置(Float32Array, stride=3)
 * @param indices    索引数组(Uint32Array 或 Uint16Array)
 * @param options    构建选项
 * @returns          构建结果(meshlet 数组 + bounds)
 */
export function buildMeshlets(
  positions: Float32Array | ArrayLike<number>,
  indices: Uint32Array | Uint16Array | ArrayLike<number>,
  options: MeshletBuildOptions = {},
): MeshletBuildResult {
  const maxVertices = Math.max(3, Math.min(256, options.maxVertices ?? 64));
  const maxTriangles = Math.max(1, Math.min(512, options.maxTriangles ?? 124));
  const computeCone = options.computeCone ?? true;

  const vertexCount = Math.floor(positions.length / 3);
  const triangleCount = Math.floor(indices.length / 3);

  const meshlets: MeshletData[] = [];
  const bounds: MeshletBounds[] = [];

  // 当前 meshlet 状态
  let currentLocalIndices: number[] = [];
  let currentGlobalIndices: number[] = [];
  let currentTriangles: number[] = [];
  let currentVertexMap: Map<number, number> = new Map();

  const flushMeshlet = () => {
    if (currentTriangles.length === 0) return;

    const meshletId = meshlets.length;
    const localVertexIndices = new Uint32Array(currentLocalIndices);
    const globalVertexIndices = new Uint32Array(currentGlobalIndices);
    const localTriangleIndices = new Uint32Array(currentTriangles);

    meshlets.push({
      meshletId,
      localVertexIndices,
      localTriangleIndices,
      globalVertexIndices,
      triangleCount: currentTriangles.length / 3,
      vertexCount: currentLocalIndices.length,
    });

    // 计算 bounds
    const meshletBounds = computeMeshletBounds(
      meshletId,
      positions,
      globalVertexIndices,
      localTriangleIndices,
      computeCone,
    );
    bounds.push(meshletBounds);

    // 重置
    currentLocalIndices = [];
    currentGlobalIndices = [];
    currentTriangles = [];
    currentVertexMap = new Map();
  };

  for (let i = 0; i < triangleCount; i++) {
    const i0 = indices[i * 3];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    // 计算加入这个三角形需要多少新顶点
    let newVerts = 0;
    if (!currentVertexMap.has(i0)) newVerts++;
    if (!currentVertexMap.has(i1)) newVerts++;
    if (!currentVertexMap.has(i2)) newVerts++;

    // 检查是否会超限
    if (
      currentLocalIndices.length + newVerts > maxVertices ||
      currentTriangles.length / 3 + 1 > maxTriangles
    ) {
      flushMeshlet();
    }

    // 添加顶点
    for (const idx of [i0, i1, i2]) {
      if (!currentVertexMap.has(idx)) {
        const localIdx = currentLocalIndices.length;
        currentVertexMap.set(idx, localIdx);
        currentLocalIndices.push(localIdx);
        currentGlobalIndices.push(idx);
      }
    }

    // 添加三角形(用局部索引)
    currentTriangles.push(
      currentVertexMap.get(i0)!,
      currentVertexMap.get(i1)!,
      currentVertexMap.get(i2)!,
    );
  }

  // 刷出最后一个 meshlet
  flushMeshlet();

  return {
    meshlets,
    bounds,
    meshletCount: meshlets.length,
    vertexCount,
    triangleCount,
  };
}

// ── 包围球 + 法线锥 ──────────────────────────────────────────────

/**
 * 计算单个 meshlet 的包围球 + 法线锥。
 *
 * 包围球:所有顶点的 AABB 中心 + 最大距离(简易算法,
 *         不是最小包围球但足够用于剔除)。
 *
 * 法线锥(用于背面剔除,适配自 meshoptimizer computeMeshletBounds):
 *   - apex = 顶点加权平均位置;
 *   - axis = 平均法线(归一化);
 *   - cutoff = max(dot(n_i, axis) 的反余弦) → 锥的半角。
 *   如果 dot(viewDir, coneAxis) > coneCutoff,整个 meshlet 背面朝向视点,可剔除。
 *
 * @param meshletId        meshlet ID
 * @param positions        原始顶点位置
 * @param globalVertexIndices meshlet 的全局顶点索引
 * @param localTriangles   局部三角形索引(引用 localVertexIndices)
 * @param computeCone      是否计算法线锥
 */
export function computeMeshletBounds(
  meshletId: number,
  positions: Float32Array | ArrayLike<number>,
  globalVertexIndices: Uint32Array | ArrayLike<number>,
  localTriangles: Uint32Array | ArrayLike<number>,
  computeCone: boolean,
): MeshletBounds {
  const vCount = globalVertexIndices.length;

  // AABB
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < vCount; i++) {
    const gi = globalVertexIndices[i];
    const x = positions[gi * 3];
    const y = positions[gi * 3 + 1];
    const z = positions[gi * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const center = v3(
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  );

  // 半径 = 最远顶点到中心的距离
  let radius = 0;
  for (let i = 0; i < vCount; i++) {
    const gi = globalVertexIndices[i];
    const px = positions[gi * 3];
    const py = positions[gi * 3 + 1];
    const pz = positions[gi * 3 + 2];
    const dx = px - center.x;
    const dy = py - center.y;
    const dz = pz - center.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > radius) radius = d;
  }

  // 法线锥(用于背面剔除)
  let coneApex = v3(0, 0, 0);
  let coneAxis = v3(0, 0, 0);
  let coneCutoff = 0;

  if (computeCone && localTriangles.length >= 3) {
    const triCount = Math.floor(localTriangles.length / 3);

    // 计算每个三角形的法线 + 中心
    const normals: MeshletVec3[] = [];
    const centers: MeshletVec3[] = [];

    for (let i = 0; i < triCount; i++) {
      const li0 = localTriangles[i * 3];
      const li1 = localTriangles[i * 3 + 1];
      const li2 = localTriangles[i * 3 + 2];

      const gi0 = globalVertexIndices[li0];
      const gi1 = globalVertexIndices[li1];
      const gi2 = globalVertexIndices[li2];

      const p0 = v3(positions[gi0 * 3], positions[gi0 * 3 + 1], positions[gi0 * 3 + 2]);
      const p1 = v3(positions[gi1 * 3], positions[gi1 * 3 + 1], positions[gi1 * 3 + 2]);
      const p2 = v3(positions[gi2 * 3], positions[gi2 * 3 + 1], positions[gi2 * 3 + 2]);

      const e1 = vsub(p1, p0);
      const e2 = vsub(p2, p0);
      const n = vnormalize(vcross(e1, e2));
      normals.push(n);

      const tc = vscale(vadd(vadd(p0, p1), p2), 1.0 / 3.0);
      centers.push(tc);
    }

    // apex = 三角形中心的平均值
    let apexSum = v3(0, 0, 0);
    for (const c of centers) {
      apexSum = vadd(apexSum, c);
    }
    coneApex = vscale(apexSum, 1.0 / triCount);

    // axis = 法线平均值(归一化)
    let axisSum = v3(0, 0, 0);
    for (const n of normals) {
      axisSum = vadd(axisSum, n);
    }
    coneAxis = vnormalize(axisSum);

    // cutoff = max(acos(dot(n_i, axis))) → 存 cos 值用于快速判定
    // coneCutoff 存储 cos(cutoff),即 min(dot(n_i, axis))
    let minDot = 1.0;
    for (const n of normals) {
      const d = vdot(n, coneAxis);
      if (d < minDot) minDot = d;
    }
    // coneCutoff = cos(halfAngle),如果 dot(viewDir, axis) > coneCutoff → 背面
    coneCutoff = minDot;
  }

  return {
    meshletId,
    center,
    radius,
    coneApex,
    coneAxis,
    coneCutoff,
  };
}

// ── 视锥剔除 ─────────────────────────────────────────────────────

/**
 * 视锥剔除:测试 meshlet 包围球是否在视锥内。
 *
 * @param bounds    meshlet bounds
 * @param planes    6 个视锥平面 [a, b, c, d],ax+by+cz+d>=0 在内部
 * @returns         true = 可见(在视锥内),false = 剔除
 */
export function meshletInFrustum(
  bounds: MeshletBounds,
  planes: number[][],
): boolean {
  for (const plane of planes) {
    const [a, b, c, d] = plane;
    // 包围球到平面的有符号距离
    const dist = a * bounds.center.x + b * bounds.center.y + c * bounds.center.z + d;
    if (dist < -bounds.radius) {
      return false;
    }
  }
  return true;
}

// ── 背面剔除 ─────────────────────────────────────────────────────

/**
 * 背面剔除:用法线锥判定整个 meshlet 是否背面朝向视点。
 *
 * 原理(适配自 meshoptimizer):
 *   - 如果 dot(viewDir, coneAxis) > coneCutoff,所有三角形背面朝向视点;
 *   - viewDir = normalize(coneApex - viewPosition)。
 *
 * @param bounds       meshlet bounds(含法线锥)
 * @param viewPosition 视点位置
 * @returns            true = 正面(可见),false = 背面(剔除)
 */
export function meshletIsFrontFacing(
  bounds: MeshletBounds,
  viewPosition: MeshletVec3,
): boolean {
  // 如果法线锥未计算(coneCutoff=0 且 axis=0),不做背面剔除
  if (bounds.coneAxis.x === 0 && bounds.coneAxis.y === 0 && bounds.coneAxis.z === 0) {
    return true;
  }

  // 使用包围球中心计算视线方向(比 coneApex 更稳定,避免精度问题)
  const viewDir = vnormalize(vsub(bounds.center, viewPosition));
  const dot = vdot(viewDir, bounds.coneAxis);

  // dot >= coneCutoff → 视点在法线锥内部 → 背面朝向视点(保守:边界也剔除)
  return dot < bounds.coneCutoff;
}

// ── HZB 遮挡剔除 ─────────────────────────────────────────────────

/**
 * HZB 遮挡剔除:测试 meshlet 包围球是否被遮挡。
 *
 * 简化算法(适配自 HierarchicalZBuffer):
 *   1. 把包围球中心投影到屏幕空间;
 *   2. 根据 Screen-space 半径选择 HZB mip 级别;
 *   3. 采样 HZB 深度,如果 meshlet 深度 > HZB 深度 → 遮挡。
 *
 * @param bounds     meshlet bounds
 * @param hzb        HZB 数据
 * @param hzbWidth   HZB 宽度
 * @param hzbHeight  HZB 高度
 * @param viewProj   视图投影矩阵(16 元素,列主序)
 * @param bias       保守偏移
 * @returns          true = 可见(未被遮挡),false = 遮挡
 */
export function meshletIsVisibleHZB(
  bounds: MeshletBounds,
  hzb: Float32Array,
  hzbWidth: number,
  hzbHeight: number,
  viewProj: number[],
  bias: number = 0.0,
): boolean {
  // 投影中心到 clip space
  const cx = bounds.center.x;
  const cy = bounds.center.y;
  const cz = bounds.center.z;

  // 列主序 viewProj: m[col*4 + row]
  const clipX = viewProj[0] * cx + viewProj[4] * cy + viewProj[8] * cz + viewProj[12];
  const clipY = viewProj[1] * cx + viewProj[5] * cy + viewProj[9] * cz + viewProj[13];
  const clipZ = viewProj[2] * cx + viewProj[6] * cy + viewProj[10] * cz + viewProj[14];
  const clipW = viewProj[3] * cx + viewProj[7] * cy + viewProj[11] * cz + viewProj[15];

  if (clipW <= 0) return true; // 在相机后面,保守可见

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const ndcZ = clipZ / clipW;

  // NDC → 屏幕像素
  const screenX = (ndcX * 0.5 + 0.5) * hzbWidth;
  const screenY = (ndcY * 0.5 + 0.5) * hzbHeight;

  // 选择 mip:屏幕半径 → mip 级别
  // 保守估计:投影后的半径(用 NDC 尺度)
  const projectedRadius = (bounds.radius / clipW) * hzbWidth * 0.5;
  const mipLevel = Math.max(0, Math.floor(Math.log2(Math.max(1, projectedRadius))));

  // 采样 HZB(简单的最近 mip 中心采样)
  const mipWidth = Math.max(1, Math.floor(hzbWidth / Math.pow(2, mipLevel)));
  const mipHeight = Math.max(1, Math.floor(hzbHeight / Math.pow(2, mipLevel)));

  const sampleX = Math.min(mipWidth - 1, Math.max(0, Math.floor(screenX / Math.pow(2, mipLevel))));
  const sampleY = Math.min(mipHeight - 1, Math.max(0, Math.floor(screenY / Math.pow(2, mipLevel))));

  // HZB mip 数据是连续的:mip 0 在 [0..w*h),mip 1 在 [w*h..w*h + w/2*h/2),...
  let mipOffset = 0;
  let mipW = hzbWidth;
  let mipH = hzbHeight;
  for (let m = 0; m < mipLevel; m++) {
    mipOffset += mipW * mipH;
    mipW = Math.max(1, Math.floor(mipW / 2));
    mipH = Math.max(1, Math.floor(mipH / 2));
  }

  const sampleIndex = mipOffset + sampleY * mipW + sampleX;
  if (sampleIndex >= hzb.length) return true; // 越界,保守可见

  const hzbDepth = hzb[sampleIndex];
  // meshlet 深度(减去 bias 使其更近,减少误剔除)
  const meshletDepth = ndcZ - bias;

  // HZB 存储最大深度,如果 meshlet 深度 > HZB 深度 → 被遮挡
  return meshletDepth <= hzbDepth;
}

// ── 完整剔除管线 ─────────────────────────────────────────────────

/**
 * 对所有 meshlet 执行完整剔除管线。
 *
 * 流程:
 *   1. 视锥剔除(包围球 vs 视锥平面);
 *   2. 背面剔除(法线锥 vs 视点方向);
 *   3. HZB 遮挡剔除(包围球投影 vs HZB 深度)。
 *
 * @param buildResult meshlet 构建结果
 * @param options     剔除选项
 * @returns           剔除结果(可见 meshlet ID 列表 + 统计)
 */
export function cullMeshlets(
  buildResult: MeshletBuildResult,
  options: MeshletCullOptions = {},
): MeshletCullResult {
  const {
    frustumCulling = true,
    backfaceCulling = true,
    occlusionCulling = false,
    viewPosition,
    frustumPlanes,
    hzb,
    hzbWidth,
    hzbHeight,
    viewProjectionMatrix,
    conservativeBias = 0.0,
  } = options;

  const visibleMeshletIds: number[] = [];
  let frustumCulled = 0;
  let backfaceCulled = 0;
  let occlusionCulled = 0;

  for (const bounds of buildResult.bounds) {
    // 1. 视锥剔除
    if (frustumCulling && frustumPlanes) {
      if (!meshletInFrustum(bounds, frustumPlanes)) {
        frustumCulled++;
        continue;
      }
    }

    // 2. 背面剔除
    if (backfaceCulling && viewPosition) {
      if (!meshletIsFrontFacing(bounds, viewPosition)) {
        backfaceCulled++;
        continue;
      }
    }

    // 3. HZB 遮挡剔除
    if (
      occlusionCulling &&
      hzb &&
      hzbWidth &&
      hzbHeight &&
      viewProjectionMatrix
    ) {
      if (!meshletIsVisibleHZB(
        bounds, hzb, hzbWidth, hzbHeight, viewProjectionMatrix, conservativeBias,
      )) {
        occlusionCulled++;
        continue;
      }
    }

    visibleMeshletIds.push(bounds.meshletId);
  }

  return {
    visibleMeshletIds,
    frustumCulled,
    backfaceCulled,
    occlusionCulled,
    totalMeshlets: buildResult.meshletCount,
    visibleCount: visibleMeshletIds.length,
  };
}

// ── indirect draw 打包 ──────────────────────────────────────────

/**
 * 把可见 meshlet 打包成 indirect draw command 数组。
 *
 * 每个 meshlet 生成一条 draw command:
 *   - indexCount = triangleCount * 3
 *   - instanceCount = 1
 *   - firstIndex = meshlet 在合并索引缓冲中的偏移
 *   - vertexOffset = meshlet 在合并顶点缓冲中的偏移
 *   - firstInstance = meshletId
 *
 * @param buildResult    meshlet 构建结果
 * @param visibleMeshletIds 可见 meshlet ID 列表(来自 cullMeshlets)
 * @returns              draw command 数组
 */
export function packMeshletDrawCommands(
  buildResult: MeshletBuildResult,
  visibleMeshletIds: number[],
): MeshletDrawCommand[] {
  // 计算每个 meshlet 在合并缓冲中的偏移
  const vertexOffsets: number[] = new Array(buildResult.meshletCount);
  const indexOffsets: number[] = new Array(buildResult.meshletCount);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (let i = 0; i < buildResult.meshletCount; i++) {
    vertexOffsets[i] = vertexOffset;
    indexOffsets[i] = indexOffset;
    vertexOffset += buildResult.meshlets[i].vertexCount;
    indexOffset += buildResult.meshlets[i].triangleCount * 3;
  }

  // 为可见 meshlet 生成 draw command
  const commands: MeshletDrawCommand[] = [];
  for (const meshletId of visibleMeshletIds) {
    const meshlet = buildResult.meshlets[meshletId];
    commands.push({
      meshletId,
      indexCount: meshlet.triangleCount * 3,
      instanceCount: 1,
      firstIndex: indexOffsets[meshletId],
      vertexOffset: vertexOffsets[meshletId],
      firstInstance: meshletId,
    });
  }

  return commands;
}

// ── 合并缓冲生成 ────────────────────────────────────────────────

/**
 * 把所有 meshlet 的顶点/索引合并到连续缓冲。
 *
 * 用于一次性上传到 GPU(multiDrawElementsIndirect 需要)。
 *
 * @param buildResult meshlet 构建结果
 * @param positions   原始顶点位置
 * @returns           合并后的 { vertices, indices }
 */
export function buildMeshletVertexIndexBuffers(
  buildResult: MeshletBuildResult,
  positions: Float32Array | ArrayLike<number>,
): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  let totalVertices = 0;
  let totalIndices = 0;
  for (const meshlet of buildResult.meshlets) {
    totalVertices += meshlet.vertexCount;
    totalIndices += meshlet.triangleCount * 3;
  }

  const vertices = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (const meshlet of buildResult.meshlets) {
    // 复制顶点
    for (let i = 0; i < meshlet.vertexCount; i++) {
      const gi = meshlet.globalVertexIndices[i];
      vertices[vOffset * 3] = positions[gi * 3];
      vertices[vOffset * 3 + 1] = positions[gi * 3 + 1];
      vertices[vOffset * 3 + 2] = positions[gi * 3 + 2];
      vOffset++;
    }

    // 复制索引(局部 → 全局,加上当前偏移)
    for (let i = 0; i < meshlet.localTriangleIndices.length; i++) {
      indices[iOffset] = meshlet.localTriangleIndices[i] + vOffset - meshlet.vertexCount;
      iOffset++;
    }
  }

  return { vertices, indices };
}

// ── 统计 ─────────────────────────────────────────────────────────

/**
 * 计算 meshlet 化的统计信息。
 *
 * @param buildResult meshlet 构建结果
 * @returns           统计信息
 */
export function meshletStats(
  buildResult: MeshletBuildResult,
): {
  meshletCount: number;
  avgVerticesPerMeshlet: number;
  avgTrianglesPerMeshlet: number;
  maxVertices: number;
  maxTriangles: number;
  totalVertices: number;
  totalTriangles: number;
  vertexReuseRatio: number;
} {
  let totalVerts = 0;
  let totalTris = 0;
  let maxVerts = 0;
  let maxTris = 0;

  for (const m of buildResult.meshlets) {
    totalVerts += m.vertexCount;
    totalTris += m.triangleCount;
    if (m.vertexCount > maxVerts) maxVerts = m.vertexCount;
    if (m.triangleCount > maxTris) maxTris = m.triangleCount;
  }

  const count = buildResult.meshletCount;

  return {
    meshletCount: count,
    avgVerticesPerMeshlet: count > 0 ? totalVerts / count : 0,
    avgTrianglesPerMeshlet: count > 0 ? totalTris / count : 0,
    maxVertices: maxVerts,
    maxTriangles: maxTris,
    totalVertices: totalVerts,
    totalTriangles: totalTris,
    // 顶点复用率 = 原始顶点数 / 合并后顶点数(越大越好)
    vertexReuseRatio: totalVerts > 0 ? buildResult.vertexCount / totalVerts : 0,
  };
}
