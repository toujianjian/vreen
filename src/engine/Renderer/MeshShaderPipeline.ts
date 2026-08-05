// MeshShaderPipeline — Mesh Shader 管线(Task + Mesh 两阶段,CPU 参考 + GLSL 模拟)。
//
// 适配自:
//   - o3de Atom MeshShaderPass / MeshShaderDispatchItem
//   - NVIDIA "Mesh Shaders" (Turing, SIGGRAPH 2019)
//   - AMD RDNA2 Mesh Shader Programming Guide
//   - Vulkan VK_EXT_mesh_shader / GL_NV_mesh_shader / D3D12 Mesh Shader
//
// 设计目标:
//   1. 把传统 IA → VS → HS → DS → GS → RS → PS 管线替换为
//      Task Shader(可选) → Mesh Shader → RS → PS;
//   2. Task Shader 在 GPU 上做 meshlet 级剔除/LOD/可见性判定,
//      只发射可见 meshlet 给 Mesh Shader;
//   3. Mesh Shader 在 workgroup 内(线程协作)直接发射顶点和三角形,
//      无需 IA、无 vertex buffer fetch、无 index buffer 间接。
//
// VREEN 实现说明:
//   WebGL2 不原生支持 Mesh Shader,本文件提供:
//     - CPU 参考实现(可在 Node/无头环境运行,与 MeshletRenderer 同构);
//     - GLSL chunks(用于未来 WebGL2 模拟:Task 阶段用 compute-like 1D 通道,
//       Mesh 阶段用 instanced quads 模拟,或集成到 WebGPU 后端)。
//   与 MeshletRenderer 互补:
//     - MeshletRenderer 在 CPU 上做 meshlet 构建 + culling + indirect draw 打包;
//     - MeshShaderPipeline 在 GPU 上做 meshlet culling + dispatch(更高效,
//       避免 GPU→CPU readback,适合实时渲染)。
//
// 与 soup3D 的对比:
//   soup3D 没有任何 Mesh Shader / Task Shader / GPU-driven meshlet 管线,
//   所有 mesh 走传统 IA + VS 路径,大场景性能受限。
//   VREEN 提供 Meshlet + MeshShader + VisibilityBuffer + HZB 完整 GPU-driven 栈。

// ── 类型 ──────────────────────────────────────────────────────────

/** 3D 向量(与 MeshletRenderer.MeshletVec3 同构)。 */
export interface MSVec3 {
  x: number;
  y: number;
  z: number;
}

/** 4x4 矩阵(列主序,16 个 number,与 WebGL uniformMatrix4fv 一致)。 */
export type MSMatrix4 = number[];

/**
 * 单个 meshlet 的紧凑剔除数据(传给 Task Shader)。
 * 与 MeshletRenderer.MeshletBounds 同构,但扁平化为 SoA 结构便于批量上传。
 */
export interface MeshletCullData {
  /** 包围球中心(世界空间)。 */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** 包围球半径(世界空间)。 */
  radius: number;
  /** 法线锥顶点(世界空间)。 */
  coneApexX: number;
  coneApexY: number;
  coneApexZ: number;
  /** 法线锥轴向(归一化)。 */
  coneAxisX: number;
  coneAxisY: number;
  coneAxisZ: number;
  /** 法线锥 cos(cutoff)。 */
  coneCutoff: number;
  /** meshlet 在原始 build result 中的索引。 */
  meshletId: number;
}

/**
 * Task Shader 输出项:一个 meshlet 的可见性调度。
 * 每个 task workgroup 输出 0..N 个 dispatch item。
 */
export interface TaskDispatchItem {
  /** meshlet 索引(在 MeshletCullData 数组中)。 */
  meshletId: number;
  /** 该 meshlet 的 mesh shader workgroup 数(通常为 1,大 meshlet 可拆分)。 */
  meshWorkgroupCount: number;
  /** 该 meshlet 的目标 LOD 级别(0 = 最高,>0 = 更低)。 */
  lod: number;
  /** 调试用:被发射的 task workgroup 索引。 */
  taskWorkgroup: number;
}

/**
 * Mesh Shader 输出顶点(clip 空间 + 顶点属性)。
 * 与传统 VS 输出同构,但由 mesh shader workgroup 内线程协作产生。
 */
export interface MeshShaderVertex {
  /** Clip 空间 x。 */
  clipX: number;
  /** Clip 空间 y。 */
  clipY: number;
  /** Clip 空间 z。 */
  clipZ: number;
  /** Clip 空间 w。 */
  clipW: number;
  /** 世界空间 x(供 PS 用)。 */
  worldX: number;
  /** 世界空间 y。 */
  worldY: number;
  /** 世界空间 z。 */
  worldZ: number;
  /** 局部顶点索引(在 meshlet 内,0..vertexCount-1)。 */
  localIndex: number;
}

/**
 * Mesh Shader 输出三角形(三个顶点索引 + cull flag)。
 */
export interface MeshShaderTriangle {
  /** 顶点索引 0(在 MeshShaderVertex 数组中)。 */
  v0: number;
  /** 顶点索引 1。 */
  v1: number;
  /** 顶点索引 2。 */
  v2: number;
  /** 是否可见(背面剔除后)。 */
  visible: boolean;
}

/**
 * 单个 meshlet 在 Mesh Shader 阶段的输出。
 */
export interface MeshShaderOutput {
  /** meshlet 索引。 */
  meshletId: number;
  /** 输出顶点数组(已变换到 clip 空间)。 */
  vertices: MeshShaderVertex[];
  /** 输出三角形数组(已做背面剔除)。 */
  triangles: MeshShaderTriangle[];
  /** 输入三角形数。 */
  inputTriangleCount: number;
  /** 输出三角形数(背面剔除后)。 */
  outputTriangleCount: number;
}

/**
 * Mesh Shader 管线整体执行结果。
 */
export interface MeshShaderPipelineStats {
  /** Task shader 阶段输入 meshlet 数。 */
  inputMeshletCount: number;
  /** Task shader 输出 dispatch item 数(可见 meshlet 数)。 */
  visibleMeshletCount: number;
  /** 被视锥剔除的 meshlet 数。 */
  frustumCulled: number;
  /** 被背面剔除的 meshlet 数(整个 meshlet 法线锥判定)。 */
  backfaceCulled: number;
  /** 被遮挡剔除的 meshlet 数。 */
  occlusionCulled: number;
  /** 被 LOD 剔除的 meshlet 数(过远跳过)。 */
  lodCulled: number;
  /** Mesh shader 阶段输入三角形数。 */
  inputTriangleCount: number;
  /** Mesh shader 阶段输出三角形数(背面剔除后)。 */
  outputTriangleCount: number;
  /** Mesh shader 阶段输出顶点数。 */
  outputVertexCount: number;
  /** Task shader workgroup 数。 */
  taskWorkgroupCount: number;
  /** Mesh shader workgroup 数(= visibleMeshletCount)。 */
  meshWorkgroupCount: number;
}

/** Task Shader 配置。 */
export interface TaskShaderOptions {
  /** Task workgroup 大小(每个 workgroup 处理多少 meshlet,默认 32)。 */
  taskWorkgroupSize?: number;
  /** 是否启用视锥剔除(默认 true)。 */
  frustumCulling?: boolean;
  /** 是否启用背面剔除(meshlet 法线锥,默认 true)。 */
  backfaceCulling?: boolean;
  /** 是否启用 HZB 遮挡剔除(默认 false)。 */
  occlusionCulling?: boolean;
  /** 是否启用 LOD 剔除(默认 true,过远 meshlet 跳过)。 */
  lodCulling?: boolean;
  /** LOD 距离阈值(世界空间,超过此距离的 meshlet 跳过)。 */
  lodDistance?: number;
  /** 保守偏置(HZB 用,默认 0.005)。 */
  conservativeBias?: number;
}

/** Mesh Shader 配置。 */
export interface MeshShaderOptions {
  /** Mesh workgroup 大小(每个 meshlet 用多少线程处理,默认 32)。 */
  meshWorkgroupSize?: number;
  /** 是否在 mesh shader 内做逐三角形背面剔除(默认 true)。 */
  perTriangleBackfaceCulling?: boolean;
  /** 是否裁剪到近平面(默认 false,由 hardware RS 处理)。 */
  nearPlaneClipping?: boolean;
  /** 近平面距离(默认 0.1)。 */
  nearPlane?: number;
}

/** 管线整体配置。 */
export interface MeshShaderPipelineOptions extends TaskShaderOptions, MeshShaderOptions {
  /** Task + Mesh 阶段是否启用(默认 true)。 */
  enabled?: boolean;
}

/** Task 阶段输入。 */
export interface TaskShaderInput {
  /** meshlet 剔除数据数组(SoA 友好)。 */
  meshlets: MeshletCullData[];
  /** 视点位置(世界空间)。 */
  viewPosition: MSVec3;
  /** 6 个视锥平面(每个 [a, b, c, d],ax+by+cz+d>=0 在内部)。 */
  frustumPlanes: number[][];
  /** 视图投影矩阵(16 元素,列主序)。 */
  viewProjectionMatrix: MSMatrix4;
  /** HZB 数据(可选,遮挡剔除用)。 */
  hzb?: Float32Array;
  /** HZB 宽度。 */
  hzbWidth?: number;
  /** HZB 高度。 */
  hzbHeight?: number;
  /** 屏幕宽度(用于 LOD 计算的 texel 密度)。 */
  screenWidth?: number;
  /** 屏幕高度。 */
  screenHeight?: number;
}

/** Mesh 阶段输入。 */
export interface MeshShaderInput {
  /** meshlet 的局部顶点位置(stride=3)。 */
  positions: Float32Array | ArrayLike<number>;
  /** meshlet 的局部索引(Uint32)。 */
  indices: Uint32Array | Uint16Array | ArrayLike<number>;
  /** meshlet 的局部法线(可选,stride=3,用于背面剔除回退)。 */
  normals?: Float32Array | ArrayLike<number>;
  /** 模型矩阵(局部→世界,16 元素)。 */
  modelMatrix: MSMatrix4;
  /** 视图投影矩阵(世界→clip,16 元素)。 */
  viewProjectionMatrix: MSMatrix4;
  /** meshlet 索引(用于输出关联)。 */
  meshletId: number;
  /** 视点位置(世界空间,用于背面剔除)。 */
  viewPosition: MSVec3;
}

// ── 向量与矩阵工具 ───────────────────────────────────────────────

function v3(x: number, y: number, z: number): MSVec3 {
  return { x, y, z };
}

function vsub(a: MSVec3, b: MSVec3): MSVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vdot(a: MSVec3, b: MSVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vlength(a: MSVec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function vnormalize(a: MSVec3): MSVec3 {
  const len = vlength(a);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  const inv = 1.0 / len;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

/**
 * 矩阵 × 向量(齐次),返回 (x, y, z, w)。
 * m 为列主序 16 元素,m[12..14] 是平移。
 */
function mat4TransformPoint(m: MSMatrix4, v: MSVec3): { x: number; y: number; z: number; w: number } {
  const x = v.x, y = v.y, z = v.z;
  // 列主序:column 0 = m[0..2], column 1 = m[4..6], column 2 = m[8..10], column 3 = m[12..14]
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
    w: m[3] * x + m[7] * y + m[11] * z + m[15],
  };
}

// ── 视锥剔除 ─────────────────────────────────────────────────────

/**
 * 判定包围球是否在视锥内(保守,可能与平面相切)。
 * 与 MeshletRenderer.sphereInFrustum 一致。
 */
export function sphereInFrustum(
  center: MSVec3,
  radius: number,
  frustumPlanes: number[][],
): boolean {
  for (let i = 0; i < 6; i++) {
    const p = frustumPlanes[i];
    // ax + by + cz + d >= -radius 表示球体与平面相交或在内部
    const d = p[0] * center.x + p[1] * center.y + p[2] * center.z + p[3];
    if (d < -radius) return false;
  }
  return true;
}

// ── 法线锥背面剔除 ───────────────────────────────────────────────

/**
 * 判定 meshlet 法线锥是否对视点背面朝向。
 * 与 MeshletRenderer.meshletIsFrontFacing 一致:
 *   - viewDir = normalize(coneApex - viewPosition)(视点→锥顶方向);
 *   - coneAxis = 平均法线方向(指向正面外侧);
 *   - dot(viewDir, coneAxis) >= coneCutoff → 背面朝向视点(可剔除)。
 *
 * 直觉:如果"视点→表面"方向与"表面外法线"方向夹角小于锥半角,
 * 说明视点在法线锥内部 → 看到的是背面。
 */
export function coneBackfaceCulled(
  coneApex: MSVec3,
  coneAxis: MSVec3,
  coneCutoff: number,
  viewPosition: MSVec3,
): boolean {
  const viewDir = vnormalize(vsub(coneApex, viewPosition));
  return vdot(viewDir, coneAxis) >= coneCutoff;
}

// ── HZB 遮挡剔除(简化,与 MeshletRenderer.isOccluded 一致) ────

/**
 * 把世界空间包围球投影到屏幕 AABB,与 HZB mip 深度比较。
 * 若 meshlet 最近深度 > HZB 存储深度 → 被遮挡。
 */
export function isMeshletOccluded(
  center: MSVec3,
  radius: number,
  viewProjectionMatrix: MSMatrix4,
  hzb: Float32Array,
  hzbWidth: number,
  hzbHeight: number,
  conservativeBias: number = 0.005,
): boolean {
  // 投影中心到 clip 空间
  const projected = mat4TransformPoint(viewProjectionMatrix, center);
  if (projected.w <= 0) return false; // 在视点后方或齐次 w 异常 → 不剔除

  const invW = 1.0 / projected.w;
  // NDC 中心
  const ndcX = projected.x * invW;
  const ndcY = projected.y * invW;
  const ndcZ = projected.z * invW;

  // 半径估算(在 NDC 空间):用 radius / w 作为保守估算
  const ndcRadius = radius * invW;

  // 屏幕 UV 范围
  const u = ndcX * 0.5 + 0.5;
  const v = ndcY * 0.5 + 0.5;
  const rU = Math.min(0.5, ndcRadius);

  // 选 mip:用屏幕空间半径估算
  const screenSize = Math.max(hzbWidth, hzbHeight);
  const pixelRadius = Math.max(1, Math.floor(rU * screenSize));
  let mip = 0;
  let size = screenSize;
  while (size > pixelRadius * 2 && size > 1) {
    size = Math.floor(size / 2);
    mip++;
  }
  const mipCount = Math.floor(Math.log2(screenSize)) + 1;
  if (mip >= mipCount) mip = mipCount - 1;

  // 采样 HZB(取 mip 上中心的最近深度)
  const mipWidth = Math.max(1, Math.floor(hzbWidth >> mip));
  const mipHeight = Math.max(1, Math.floor(hzbHeight >> mip));
  const texX = Math.max(0, Math.min(mipWidth - 1, Math.floor(u * mipWidth)));
  const texY = Math.max(0, Math.min(mipHeight - 1, Math.floor(v * mipHeight)));
  const storedDepth = hzb[texY * hzbWidth + texX];

  // meshlet 最近深度 = ndcZ - bias(HZB 存储最远可见深度,depth > stored 表示被遮挡)
  return ndcZ - conservativeBias > storedDepth;
}

// ── LOD 计算 ─────────────────────────────────────────────────────

/**
 * 计算 meshlet 的 LOD 级别。
 * 简化方案:基于包围球到视点的距离 / 屏幕投影大小。
 */
export function computeMeshletLOD(
  center: MSVec3,
  radius: number,
  viewPosition: MSVec3,
  screenWidth: number,
  screenHeight: number,
): number {
  const dx = center.x - viewPosition.x;
  const dy = center.y - viewPosition.y;
  const dz = center.z - viewPosition.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6) return 0;

  // 屏幕空间投影大小估算:radius / distance * screenSize
  const screenSize = Math.max(screenWidth, screenHeight);
  const projectionRatio = radius / distance;
  const projectedPixels = projectionRatio * screenSize;

  // LOD 0: > 64 pixels; LOD 1: 32-64; LOD 2: 16-32; LOD 3: 8-16; LOD 4: < 8
  if (projectedPixels > 64) return 0;
  if (projectedPixels > 32) return 1;
  if (projectedPixels > 16) return 2;
  if (projectedPixels > 8) return 3;
  return 4;
}

// ── Task Shader 阶段 ─────────────────────────────────────────────

/**
 * 执行 Task Shader 阶段:对 meshlet 数组做剔除,输出可见 meshlet 的 dispatch 列表。
 *
 * 算法(对应 o3de Atom TaskShader):
 *   1. 把输入 meshlet 数组分成 taskWorkgroupSize 个一组;
 *   2. 每个 workgroup 遍历自己负责的 meshlet:
 *      a. 视锥剔除(可选);
 *      b. 法线锥背面剔除(可选);
 *      c. HZB 遮挡剔除(可选);
 *      d. LOD 距离剔除(可选);
 *   3. 通过所有剔除的 meshlet → 输出 TaskDispatchItem;
 *   4. 输出数组是紧凑的(已剔除的 meshlet 不占位置)。
 *
 * CPU 参考实现单线程遍历,GPU 上每个 workgroup 并行处理。
 *
 * @param input   task 阶段输入(meshlet 数据 + 相机)
 * @param options task 阶段配置
 * @returns        dispatch items + 统计
 */
export function executeTaskShader(
  input: TaskShaderInput,
  options: Required<TaskShaderOptions>,
): { dispatches: TaskDispatchItem[]; stats: Pick<MeshShaderPipelineStats, 'inputMeshletCount' | 'visibleMeshletCount' | 'frustumCulled' | 'backfaceCulled' | 'occlusionCulled' | 'lodCulled' | 'taskWorkgroupCount'> } {
  const {
    taskWorkgroupSize,
    frustumCulling,
    backfaceCulling,
    occlusionCulling,
    lodCulling,
    lodDistance,
    conservativeBias,
  } = options;

  const meshlets = input.meshlets;
  const inputMeshletCount = meshlets.length;
  const taskWorkgroupCount = Math.max(1, Math.ceil(inputMeshletCount / taskWorkgroupSize));

  const dispatches: TaskDispatchItem[] = [];
  let frustumCulled = 0;
  let backfaceCulled = 0;
  let occlusionCulled = 0;
  let lodCulled = 0;

  for (let i = 0; i < inputMeshletCount; i++) {
    const m = meshlets[i];
    const taskWorkgroup = Math.floor(i / taskWorkgroupSize);

    // 1. LOD 距离剔除(过远 → 跳过)
    if (lodCulling) {
      const dx = m.centerX - input.viewPosition.x;
      const dy = m.centerY - input.viewPosition.y;
      const dz = m.centerZ - input.viewPosition.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > lodDistance) {
        lodCulled++;
        continue;
      }
    }

    // 2. 视锥剔除
    if (frustumCulling) {
      const center = v3(m.centerX, m.centerY, m.centerZ);
      if (!sphereInFrustum(center, m.radius, input.frustumPlanes)) {
        frustumCulled++;
        continue;
      }
    }

    // 3. 法线锥背面剔除
    if (backfaceCulling) {
      const apex = v3(m.coneApexX, m.coneApexY, m.coneApexZ);
      const axis = v3(m.coneAxisX, m.coneAxisY, m.coneAxisZ);
      if (coneBackfaceCulled(apex, axis, m.coneCutoff, input.viewPosition)) {
        backfaceCulled++;
        continue;
      }
    }

    // 4. HZB 遮挡剔除
    if (occlusionCulling && input.hzb && input.hzbWidth && input.hzbHeight) {
      const center = v3(m.centerX, m.centerY, m.centerZ);
      if (isMeshletOccluded(
        center, m.radius, input.viewProjectionMatrix,
        input.hzb, input.hzbWidth!, input.hzbHeight!, conservativeBias,
      )) {
        occlusionCulled++;
        continue;
      }
    }

    // 5. 计算 LOD 级别(用于 mesh shader 内部细化级别选择)
    const lod = (input.screenWidth && input.screenHeight)
      ? computeMeshletLOD(
          v3(m.centerX, m.centerY, m.centerZ), m.radius,
          input.viewPosition, input.screenWidth, input.screenHeight,
        )
      : 0;

    dispatches.push({
      meshletId: m.meshletId,
      meshWorkgroupCount: 1,
      lod,
      taskWorkgroup,
    });
  }

  return {
    dispatches,
    stats: {
      inputMeshletCount,
      visibleMeshletCount: dispatches.length,
      frustumCulled,
      backfaceCulled,
      occlusionCulled,
      lodCulled,
      taskWorkgroupCount,
    },
  };
}

// ── Mesh Shader 阶段 ─────────────────────────────────────────────

/**
 * 执行单个 meshlet 的 Mesh Shader 阶段。
 *
 * 算法(对应 o3de Atom MeshShader):
 *   1. 把 meshlet 的局部顶点位置变换到世界空间(modelMatrix);
 *   2. 把世界空间顶点变换到 clip 空间(viewProjectionMatrix);
 *   3. 对每个三角形做背面剔除(可选):
 *      a. 计算三角形法线(世界空间);
 *      b. 判定 dot(viewDir, normal) <= 0 → 背面;
 *   4. 输出可见顶点 + 三角形列表。
 *
 * CPU 参考实现单线程遍历顶点/三角形,GPU 上每个 workgroup 并行处理。
 *
 * @param input   mesh 阶段输入(meshlet 顶点 + 矩阵 + 视点)
 * @param options mesh 阶段配置
 * @returns        mesh shader 输出(顶点 + 三角形)
 */
export function executeMeshShader(
  input: MeshShaderInput,
  options: Required<MeshShaderOptions>,
): MeshShaderOutput {
  const { perTriangleBackfaceCulling } = options;

  const positions = input.positions;
  const indices = input.indices;
  const modelMatrix = input.modelMatrix;
  const viewProjectionMatrix = input.viewProjectionMatrix;

  // MVP = viewProjection * model(列主序乘法)
  const mvp = mat4Multiply(viewProjectionMatrix, modelMatrix);

  const vertexCount = Math.floor(positions.length / 3);
  const triangleCount = Math.floor(indices.length / 3);

  // 1. 变换所有顶点到 clip + world 空间
  const vertices: MeshShaderVertex[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const localX = positions[i * 3];
    const localY = positions[i * 3 + 1];
    const localZ = positions[i * 3 + 2];

    // 世界空间
    const world = mat4TransformPoint(modelMatrix, v3(localX, localY, localZ));
    // clip 空间(用 MVP 直接算)
    const clip = mat4TransformPoint(mvp, v3(localX, localY, localZ));

    vertices[i] = {
      clipX: clip.x,
      clipY: clip.y,
      clipZ: clip.z,
      clipW: clip.w,
      worldX: world.x,
      worldY: world.y,
      worldZ: world.z,
      localIndex: i,
    };
  }

  // 2. 对每个三角形做背面剔除(可选)
  const triangles: MeshShaderTriangle[] = [];
  let outputTriangleCount = 0;

  for (let i = 0; i < triangleCount; i++) {
    const i0 = indices[i * 3];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    let visible = true;
    if (perTriangleBackfaceCulling && i0 < vertexCount && i1 < vertexCount && i2 < vertexCount) {
      const v0 = vertices[i0];
      const v1 = vertices[i1];
      const v2 = vertices[i2];

      // 三角形法线(世界空间)
      const ex = v1.worldX - v0.worldX;
      const ey = v1.worldY - v0.worldY;
      const ez = v1.worldZ - v0.worldZ;
      const fx = v2.worldX - v0.worldX;
      const fy = v2.worldY - v0.worldY;
      const fz = v2.worldZ - v0.worldZ;
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;

      // 视线方向(从三角形中心到视点)
      const cx = (v0.worldX + v1.worldX + v2.worldX) / 3;
      const cy = (v0.worldY + v1.worldY + v2.worldY) / 3;
      const cz = (v0.worldZ + v1.worldZ + v2.worldZ) / 3;
      const vx = input.viewPosition.x - cx;
      const vy = input.viewPosition.y - cy;
      const vz = input.viewPosition.z - cz;

      // dot(view, normal) <= 0 → 背面
      const dot = vx * nx + vy * ny + vz * nz;
      if (dot <= 0) visible = false;
    }

    triangles.push({ v0: i0, v1: i1, v2: i2, visible });
    if (visible) outputTriangleCount++;
  }

  return {
    meshletId: input.meshletId,
    vertices,
    triangles,
    inputTriangleCount: triangleCount,
    outputTriangleCount,
  };
}

// ── 矩阵乘法 ─────────────────────────────────────────────────────

/** 列主序 4x4 矩阵乘法:result = a × b。 */
export function mat4Multiply(a: MSMatrix4, b: MSMatrix4): MSMatrix4 {
  const r = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        // a[row, k] * b[k, col]
        // 列主序:a[colA * 4 + rowA],b[colB * 4 + rowB]
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      r[col * 4 + row] = sum;
    }
  }
  return r;
}

// ── Mesh Shader 管线(整体编排) ──────────────────────────────────

/** 默认 Task Shader 选项。 */
export const DEFAULT_TASK_SHADER_OPTIONS: Required<TaskShaderOptions> = {
  taskWorkgroupSize: 32,
  frustumCulling: true,
  backfaceCulling: true,
  occlusionCulling: false,
  lodCulling: true,
  lodDistance: 1000.0,
  conservativeBias: 0.005,
};

/** 默认 Mesh Shader 选项。 */
export const DEFAULT_MESH_SHADER_OPTIONS: Required<MeshShaderOptions> = {
  meshWorkgroupSize: 32,
  perTriangleBackfaceCulling: true,
  nearPlaneClipping: false,
  nearPlane: 0.1,
};

/** 默认管线选项。 */
export const DEFAULT_MESH_SHADER_PIPELINE_OPTIONS: Required<MeshShaderPipelineOptions> = {
  ...DEFAULT_TASK_SHADER_OPTIONS,
  ...DEFAULT_MESH_SHADER_OPTIONS,
  enabled: true,
};

/** 应用默认值到 Task Shader 选项。 */
export function applyTaskShaderDefaults(options?: TaskShaderOptions): Required<TaskShaderOptions> {
  if (!options) return { ...DEFAULT_TASK_SHADER_OPTIONS };
  return { ...DEFAULT_TASK_SHADER_OPTIONS, ...options };
}

/** 应用默认值到 Mesh Shader 选项。 */
export function applyMeshShaderDefaults(options?: MeshShaderOptions): Required<MeshShaderOptions> {
  if (!options) return { ...DEFAULT_MESH_SHADER_OPTIONS };
  return { ...DEFAULT_MESH_SHADER_OPTIONS, ...options };
}

/** 应用默认值到管线选项。 */
export function applyMeshShaderPipelineDefaults(options?: MeshShaderPipelineOptions): Required<MeshShaderPipelineOptions> {
  if (!options) return { ...DEFAULT_MESH_SHADER_PIPELINE_OPTIONS };
  return { ...DEFAULT_MESH_SHADER_PIPELINE_OPTIONS, ...options };
}

/**
 * 执行完整的 Mesh Shader 管线(Task → Mesh)。
 *
 * @param taskInput       task 阶段输入
 * @param meshletsData    meshlet 顶点/索引数据(按 meshletId 索引)
 * @param modelMatrices   每个 meshlet 的模型矩阵(按 meshletId 索引,可与 meshletsData 共用)
 * @param viewPosition    视点位置(世界空间)
 * @param viewProjectionMatrix  视图投影矩阵
 * @param options         管线选项
 * @returns                管线输出(每个可见 meshlet 的 mesh shader 输出 + 统计)
 */
export function executeMeshShaderPipeline(
  taskInput: TaskShaderInput,
  meshletsData: Map<number, { positions: Float32Array | ArrayLike<number>; indices: Uint32Array | ArrayLike<number>; normals?: Float32Array | ArrayLike<number> }>,
  modelMatrices: Map<number, MSMatrix4>,
  viewPosition: MSVec3,
  viewProjectionMatrix: MSMatrix4,
  options?: MeshShaderPipelineOptions,
): { outputs: MeshShaderOutput[]; stats: MeshShaderPipelineStats } {
  const opts = applyMeshShaderPipelineDefaults(options);

  // 1. Task shader 阶段
  const taskResult = executeTaskShader(taskInput, opts);
  const dispatches = taskResult.dispatches;
  const taskStats = taskResult.stats;

  // 2. Mesh shader 阶段:对每个 dispatch item 执行 mesh shader
  const outputs: MeshShaderOutput[] = [];
  let inputTriangleCount = 0;
  let outputTriangleCount = 0;
  let outputVertexCount = 0;

  for (const dispatch of dispatches) {
    const meshletData = meshletsData.get(dispatch.meshletId);
    const modelMatrix = modelMatrices.get(dispatch.meshletId);
    if (!meshletData || !modelMatrix) continue;

    const meshInput: MeshShaderInput = {
      positions: meshletData.positions,
      indices: meshletData.indices,
      normals: meshletData.normals,
      modelMatrix,
      viewProjectionMatrix,
      meshletId: dispatch.meshletId,
      viewPosition,
    };

    const meshOutput = executeMeshShader(meshInput, opts);
    outputs.push(meshOutput);

    inputTriangleCount += meshOutput.inputTriangleCount;
    outputTriangleCount += meshOutput.outputTriangleCount;
    outputVertexCount += meshOutput.vertices.length;
  }

  return {
    outputs,
    stats: {
      ...taskStats,
      inputTriangleCount,
      outputTriangleCount,
      outputVertexCount,
      meshWorkgroupCount: dispatches.length,
    },
  };
}

// ── 辅助:从 MeshletRenderer.MeshletBuildResult 转 MeshletCullData ─

/**
 * 把 MeshletRenderer 的 MeshletBounds 数组转成 MeshShaderPipeline 的 MeshletCullData 数组。
 * 用于在 MeshShaderPipeline 中复用 MeshletRenderer 构建的 meshlet 数据。
 *
 * @param bounds  MeshletRenderer.MeshletBounds 数组
 * @returns        MeshletCullData 数组(SoA 友好)
 */
export function meshletBoundsToCullData(
  bounds: Array<{
    meshletId: number;
    center: { x: number; y: number; z: number };
    radius: number;
    coneApex: { x: number; y: number; z: number };
    coneAxis: { x: number; y: number; z: number };
    coneCutoff: number;
  }>,
): MeshletCullData[] {
  return bounds.map((b) => ({
    meshletId: b.meshletId,
    centerX: b.center.x,
    centerY: b.center.y,
    centerZ: b.center.z,
    radius: b.radius,
    coneApexX: b.coneApex.x,
    coneApexY: b.coneApex.y,
    coneApexZ: b.coneApex.z,
    coneAxisX: b.coneAxis.x,
    coneAxisY: b.coneAxis.y,
    coneAxisZ: b.coneAxis.z,
    coneCutoff: b.coneCutoff,
  }));
}

// ── GLSL chunks(用于未来 WebGL2 模拟 / WebGPU 集成) ────────────

/**
 * Task Shader GLSL 模拟(用 compute-like 1D dispatch 模拟)。
 *
 * 真正的 Mesh Shader 需要 Vulkan VK_EXT_mesh_shader / GL_NV_mesh_shader,
 * WebGL2 不支持。本 chunk 用于在 WebGL2 上用 transform feedback / SSBO 写入
 * 间接 dispatch buffer,模拟 task shader 输出。
 *
 * 集成方式:
 *   1. 用 compute-like 全屏 quad + instanced 渲染,每个实例代表一个 task workgroup;
 *   2. workgroup 内对 meshlet 数组做剔除;
 *   3. 通过 SSBO 写入可见 meshlet 的 dispatch item。
 */
export const TASK_SHADER_GLSL = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

// 输入:meshlet 剔除数据 SSBO
struct MeshletCullData {
  vec4 centerRadius;   // xyz=center, w=radius
  vec4 coneApexCutoff; // xyz=apex, w=cutoff
  vec4 coneAxis;       // xyz=axis (normalized)
};

layout(std140) uniform TaskShaderUniforms {
  vec4 u_viewPosition;       // xyz=view pos, w=lodDistance
  vec4 u_frustumPlanes[6];   // xyz=normal, w=d
  mat4 u_viewProjectionMatrix;
  vec4 u_screenSize;         // xy=size, zw=1/size
  ivec4 u_options;           // x=frustumCulling, y=backfaceCulling, z=occlusionCulling, w=lodCulling
  vec4 u_hzbInfo;            // x=width, y=height, z=bias, w=pad
};

layout(std430, binding=0) readonly buffer MeshletBuffer {
  MeshletCullData meshlets[];
};
layout(std430, binding=1) writeonly buffer DispatchBuffer {
  // 每个 dispatch item:meshletId, meshWorkgroupCount, lod, taskWorkgroup
  ivec4 dispatches[];
};
layout(std430, binding=2) buffer CountBuffer {
  uint visibleCount;
};

uniform int u_meshletCount;
uniform int u_taskWorkgroupSize;

bool sphereInFrustum(vec3 center, float radius) {
  for (int i = 0; i < 6; i++) {
    vec4 p = u_frustumPlanes[i];
    float d = dot(p.xyz, center) + p.w;
    if (d < -radius) return false;
  }
  return true;
}

bool coneBackfaceCulled(vec3 apex, vec3 axis, float cutoff, vec3 viewPos) {
  vec3 viewDir = normalize(viewPos - apex);
  return dot(viewDir, axis) > cutoff;
}

void main() {
  uint tid = gl_VertexID;  // 用 vertex shader 模拟 task shader
  if (int(tid) >= u_meshletCount) return;

  MeshletCullData m = meshlets[tid];
  vec3 center = m.centerRadius.xyz;
  float radius = m.centerRadius.w;

  // LOD 距离剔除
  if (u_options.w != 0) {
    float dist = length(center - u_viewPosition.xyz);
    if (dist > u_viewPosition.w) return;
  }

  // 视锥剔除
  if (u_options.x != 0 && !sphereInFrustum(center, radius)) return;

  // 法线锥背面剔除
  if (u_options.y != 0) {
    vec3 apex = m.coneApexCutoff.xyz;
    float cutoff = m.coneApexCutoff.w;
    if (coneBackfaceCulled(apex, m.coneAxis.xyz, cutoff, u_viewPosition.xyz)) return;
  }

  // (HZB 遮挡剔除在 GLSL 中需要 sampler2D,此处省略,留作集成层注入)

  // 输出 dispatch item
  uint slot = atomicAdd(visibleCount, 1);
  dispatches[slot] = ivec4(int(tid), 1, 0, int(tid) / u_taskWorkgroupSize);
}
`;

/**
 * Mesh Shader GLSL 模拟(用 instanced rendering 模拟)。
 *
 * 每个可见 meshlet 用 1 个 instance 提交,顶点 shader 在 instance 内
 * 读取 meshlet 顶点数据并变换。
 */
export const MESH_SHADER_GLSL = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location=0) in vec3 a_position;  // meshlet 局部位置
layout(location=1) in vec3 a_normal;    // meshlet 局部法线

layout(std140) uniform MeshShaderUniforms {
  mat4 u_modelMatrix;
  mat4 u_viewProjectionMatrix;
  vec4 u_viewPosition;       // xyz=view pos, w=perTriangleCulling
  vec4 u_options;            // x=perTriangleBackfaceCulling
};

out vec3 v_worldPosition;
out vec3 v_viewPosition;
out vec3 v_normal;

void main() {
  vec4 worldPos = u_modelMatrix * vec4(a_position, 1.0);
  vec4 clipPos = u_viewProjectionMatrix * worldPos;

  v_worldPosition = worldPos.xyz;
  v_viewPosition = u_viewPosition.xyz;
  v_normal = mat3(u_modelMatrix) * a_normal;

  gl_Position = clipPos;
}
`;

// ── 调试辅助 ─────────────────────────────────────────────────────

/**
 * 把管线输出转成可用于传统 drawElements 的扁平顶点/索引数组。
 * 用于在不支持 mesh shader 的环境中回退到传统渲染路径。
 */
export function flattenMeshShaderOutput(
  outputs: MeshShaderOutput[],
): { positions: Float32Array; indices: Uint32Array; vertexCount: number; triangleCount: number } {
  let totalVerts = 0;
  let totalTris = 0;
  for (const o of outputs) {
    totalVerts += o.vertices.length;
    totalTris += o.outputTriangleCount;
  }

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalTris * 3);

  let vOff = 0;
  let iOff = 0;
  for (const o of outputs) {
    const base = vOff;
    for (const v of o.vertices) {
      positions[vOff * 3] = v.worldX;
      positions[vOff * 3 + 1] = v.worldY;
      positions[vOff * 3 + 2] = v.worldZ;
      vOff++;
    }
    for (const t of o.triangles) {
      if (!t.visible) continue;
      indices[iOff * 3] = base + t.v0;
      indices[iOff * 3 + 1] = base + t.v1;
      indices[iOff * 3 + 2] = base + t.v2;
      iOff++;
    }
  }

  return {
    positions,
    indices,
    vertexCount: totalVerts,
    triangleCount: totalTris,
  };
}
