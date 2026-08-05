// MeshDistanceField — 网格距离场(Mesh Distance Field, MDF)+ 距离场软阴影(DFSS)。
//
// 适配自:
//   - UE5 "Mesh Distance Fields" + "Distance Field Shadowing" + "Distance Field Ambient Occlusion"
//   - Hart 1996 "Sphere Tracing: A Geometric Method for the Antialiased Ray Tracing of Implicit Surfaces"
//   - Crassin et al. 2011 "Interactive Indirect Illumination Using Voxel Cone Tracing"(锥追踪思想)
//   - Ericson 2005 "Real-Time Collision Detection"(点-三角形距离)
//
// 核心思想:
//   传统阴影贴图 (basic / PCF / PCSS / ESM / VSM) 在 *光空间* 栅格化深度,受限于
//   纹理分辨率与光空间投影几何,会产生 aliasing、acne、peter-panning、漏光等问题。
//   Mesh Distance Field 把网格表面编码为 *3D 均匀网格上的有符号距离场*:
//     - 表面外:正值(到最近表面的距离)
//     - 表面上:0
//     - 表面内:负值(到最近表面的距离的负数)
//   球面追踪 (Sphere Tracing) 沿光线步进,每步前进 `当前点到表面的最短距离`,
//   保证不穿透表面 → 无 aliasing,无 acne,自然软阴影。
//
// 优势(对比 PCF / PCSS / ESM / VSM):
//   - 无 aliasing:距离场是连续函数,采样即得到平滑距离
//   - 无 acne / peter-panning:无光空间深度比较,无 bias 调参
//   - 无漏光:锥追踪软阴影数学严格,大光源自然柔和
//   - 多用途:同一 SDF 可用于阴影 (DFSS)、AO (DFAO)、碰撞、GI、粒子碰撞
//   - 内存固定:SDF 分辨率独立于场景复杂度,适合 Nanite 风格海量网格
//
// 劣势:
//   - 内存占用:3D 纹理(O(N³)),需要分块/streaming
//   - 构建成本:O(voxels × triangles),需要离线烘焙或 BVH 加速
//   - 静态网格 only:动态网格需重建 SDF(或用 SDF 拼接)
//
// 与现有 ShadowMapManager / PCSSSampler / ExponentialShadowMap 的关系:
//   - ShadowMapManager(basic / pcf / pcss)+ ESM + VSM 是 *光空间* 阴影方案;
//   - 本模块是 *世界空间* SDF 阴影方案,与光空间方案互补:
//     · 大场景户外:CSM + VSM(光空间)
//     · 室内 / 角色 / 静态网格:DFSS(世界空间 SDF)
//     · 动态网格:PCSS / ESM(光空间)
//   - DFSS 的软阴影质量 > PCSS(无 aliasing,锥追踪数学严格)
//
// 与 soup3D 的对比:
//   soup3D 只有 basic 硬阴影,无 SDF / DFSS / DFAO。
//   VREEN 现在有 basic / PCF / PCSS / ESM / VSM / DFSS 六种阴影方案,
//   覆盖全精度-性能谱,且 DFSS 是 *世界空间* 方案,光空间方案无法替代。
//
// 参考:
//   - UE5 `Engine/Source/Runtime/Engine/Private/DistanceFieldAtlas.cpp`
//   - UE5 `Engine/Source/Runtime/Renderer/Private/DistanceFieldShading.cpp`
//   - Hart 1996 "Sphere Tracing"
//   - Ericson 2005 "Real-Time Collision Detection" §5.1.5 点-三角形距离
//   - VREEN 用纯 CPU Float32Array 实现,无 WebGL 依赖,可在 Node/无头环境测试。

// ── 类型 ──────────────────────────────────────────────────────────

/** 三维向量(纯数据,避免依赖 Math/Vector3)。 */
export interface MDFVec3 {
  x: number;
  y: number;
  z: number;
}

/** 网格数据(三角剖分)。positions 为 xyz 交错;indices 可选(非索引则按每 3 个顶点一组)。 */
export interface MeshData {
  /** 顶点位置,长度 = vertexCount × 3,xyz 交错。 */
  positions: Float32Array | number[];
  /** 顶点索引(可选)。非索引时为 null,按 positions 每 3 个顶点为一三角形。 */
  indices: Uint32Array | Uint16Array | number[] | null;
}

/** SDF 3D 网格(均匀栅格 + 世界边界)。 */
export interface SDFGrid {
  /** 距离数据,长度 = dimX × dimY × dimZ,行主序(z → y → x)。
   *  负值 = 网格内部,0 = 表面,正值 = 网格外部。 */
  data: Float32Array;
  /** X 维度(体素数)。 */
  dimX: number;
  /** Y 维度。 */
  dimY: number;
  /** Z 维度。 */
  dimZ: number;
  /** 世界空间 AABB 最小角。 */
  boundsMin: MDFVec3;
  /** 世界空间 AABB 最大角。 */
  boundsMax: MDFVec3;
  /** 单体素世界尺寸(x, y, z)。 */
  voxelSize: MDFVec3;
  /** 构建时使用的最大绝对距离(超出此距离的体素被截断,节省内存)。 */
  maxDistance: number;
}

/** SDF 构建选项。 */
export interface SDFBuildOptions {
  /** 每轴体素分辨率(默认 32)。最终网格 = resolution³。 */
  resolution?: number;
  /** AABB 扩展量(世界单位,默认 0.1),避免表面恰好在网格边界。
   *  设为 0 时 AABB 严格包围网格,表面可能贴边导致外距离截断。 */
  padding?: number;
  /** 最大绝对距离(默认 = padding + 最长轴)。
   *  超出此距离的体素被截断到 ±maxDistance,节省内存 + 加速采样。 */
  maxDistance?: number;
  /** 是否使用符号判定(默认 true)。
   *  true:射线投射判定内外,负值内部 / 正值外部(标准 SDF)。
   *  false:仅计算无符号距离场(UDF),全为正值(用于粒子碰撞等不需内外判定的场景)。 */
  signed?: boolean;
}

/** 球面追踪结果。 */
export interface RayMarchResult {
  /** 是否命中表面(距离 < ε)。 */
  hit: boolean;
  /** 命中点世界坐标(未命中时为射线终点)。 */
  point: MDFVec3;
  /** 命中点距离(从 origin 沿 dir 走过的距离)。 */
  distance: number;
  /** 步进次数。 */
  steps: number;
  /** 终点处的 SDF 值(命中时接近 0,未命中时为终点 SDF 值)。 */
  finalSDF: number;
}

/** DFSS(距离场软阴影)选项。 */
export interface DFSSOptions {
  /** 光源尺寸(世界单位,默认 0.1)。越大阴影越软。
   *  对应 UE5 LightSourceAngle / LightSourceRadius。 */
  lightSize?: number;
  /** 最大追踪距离(世界单位,默认 10.0)。超出此距离认为无遮挡。 */
  maxDistance?: number;
  /** 球面追踪步数(默认 32)。越多越精确,越少越快。 */
  maxSteps?: number;
  /** 表面偏置(世界单位,默认 0.01)。沿法线偏移采样起点,避免自相交。 */
  bias?: number;
  /** 锐度(默认 1.0)。>1 阴影更硬,<1 阴影更软。 */
  sharpness?: number;
}

/** DFAO(距离场环境光遮蔽)选项。 */
export interface DFAOOptions {
  /** 采样半径(世界单位,默认 1.0)。AO 影响范围。 */
  radius?: number;
  /** 采样方向数(默认 8)。半球采样数,越多越平滑。
   *  对应 UE5 DistanceFieldAmbientOcclusionNumSamples。 */
  numSamples?: number;
  /** 最大追踪距离(世界单位,默认 = radius)。 */
  maxDistance?: number;
  /** 球面追踪步数(默认 16)。 */
  maxSteps?: number;
  /** 强度(默认 1.0)。>1 AO 更深,<1 AO 更浅。 */
  strength?: number;
  /** 半球偏移(默认 0.05)。沿法线偏移采样起点。 */
  bias?: number;
}

// ── 向量工具 ────────────────────────────────────────────────────────

export function vadd(a: MDFVec3, b: MDFVec3): MDFVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vsub(a: MDFVec3, b: MDFVec3): MDFVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vscale(a: MDFVec3, s: number): MDFVec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vdot(a: MDFVec3, b: MDFVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vcross(a: MDFVec3, b: MDFVec3): MDFVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vlength(a: MDFVec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vnormalize(a: MDFVec3): MDFVec3 {
  const len = vlength(a);
  if (len < 1e-8) return { x: 0, y: 0, z: 0 };
  const inv = 1 / len;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

// ── 几何基础:点-三角形距离(Ericson RTCD §5.1.5) ──────────────────

/**
 * 点 P 到三角形 ABC 的最短距离。
 * 返回距离平方 + 最近点。
 *
 * Ericson "Real-Time Collision Detection" §5.1.5 "Closest Point on Triangle to Point"。
 * 算法:把 P 投影到 ABC 所在平面,根据重心坐标落在哪个 Voronoi 区域,
 *  分别计算到边 AB / BC / CA 或到顶点 A / B / C 的距离。
 */
export function pointTriangleDistanceSq(
  p: MDFVec3,
  a: MDFVec3,
  b: MDFVec3,
  c: MDFVec3,
): { distSq: number; closest: MDFVec3 } {
  const ab = vsub(b, a);
  const ac = vsub(c, a);
  const ap = vsub(p, a);

  const d1 = vdot(ab, ap);
  const d2 = vdot(ac, ap);
  if (d1 <= 0 && d2 <= 0) {
    // Voronoi 区域:顶点 A
    return { distSq: vdot(ap, ap), closest: a };
  }

  const bp = vsub(p, b);
  const d3 = vdot(ab, bp);
  const d4 = vdot(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    // Voronoi 区域:顶点 B
    return { distSq: vdot(bp, bp), closest: b };
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    // Voronoi 区域:边 AB
    const t = d1 / (d1 - d3);
    const closest = vadd(a, vscale(ab, t));
    const diff = vsub(p, closest);
    return { distSq: vdot(diff, diff), closest };
  }

  const cp = vsub(p, c);
  const d5 = vdot(ab, cp);
  const d6 = vdot(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    // Voronoi 区域:顶点 C
    return { distSq: vdot(cp, cp), closest: c };
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    // Voronoi 区域:边 AC
    const t = d2 / (d2 - d6);
    const closest = vadd(a, vscale(ac, t));
    const diff = vsub(p, closest);
    return { distSq: vdot(diff, diff), closest };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    // Voronoi 区域:边 BC
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const closest = vadd(b, vscale(vsub(c, b), t));
    const diff = vsub(p, closest);
    return { distSq: vdot(diff, diff), closest };
  }

  // Voronoi 区域:三角形内部(投影点在面内)
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const closest = vadd(a, vadd(vscale(ab, v), vscale(ac, w)));
  const diff = vsub(p, closest);
  return { distSq: vdot(diff, diff), closest };
}

/**
 * 点到 AABB 的有符号距离(外部为正,内部为负)。
 * 用于快速剔除:体素中心距 AABB 表面的距离。
 */
export function pointAABBSignedDistance(p: MDFVec3, min: MDFVec3, max: MDFVec3): number {
  const cx = Math.max(min.x - p.x, 0, p.x - max.x);
  const cy = Math.max(min.y - p.y, 0, p.y - max.y);
  const cz = Math.max(min.z - p.z, 0, p.z - max.z);
  const outsideDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (outsideDist > 0) return outsideDist;
  // 内部:到 6 个面的最短距离(取负)
  const dx = Math.min(p.x - min.x, max.x - p.x);
  const dy = Math.min(p.y - min.y, max.y - p.y);
  const dz = Math.min(p.z - min.z, max.z - p.z);
  return -Math.min(dx, Math.min(dy, dz));
}

// ── SDF 构建 ────────────────────────────────────────────────────────

/**
 * 计算网格 AABB。
 */
export function computeMeshAABB(mesh: MeshData): { min: MDFVec3; max: MDFVec3 } {
  const p = mesh.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/**
 * 收集网格的所有三角形为顶点三元组数组。
 */
export function collectTriangles(mesh: MeshData): MDFVec3[][] {
  const p = mesh.positions;
  const indices = mesh.indices;
  const tris: MDFVec3[][] = [];
  if (indices && indices.length > 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      tris.push([
        { x: p[a * 3], y: p[a * 3 + 1], z: p[a * 3 + 2] },
        { x: p[b * 3], y: p[b * 3 + 1], z: p[b * 3 + 2] },
        { x: p[c * 3], y: p[c * 3 + 1], z: p[c * 3 + 2] },
      ]);
    }
  } else {
    for (let i = 0; i + 2 < p.length; i += 9) {
      tris.push([
        { x: p[i], y: p[i + 1], z: p[i + 2] },
        { x: p[i + 3], y: p[i + 4], z: p[i + 5] },
        { x: p[i + 6], y: p[i + 7], z: p[i + 8] },
      ]);
    }
  }
  return tris;
}

/**
 * 通过射线投射判定点是否在网格内部。
 * 沿一条非轴对齐方向发射射线,统计与三角形的交点数:
 *   - 偶数 = 外部
 *   - 奇数 = 内部
 *
 * 这是经典的奇偶规则 (parity rule),对封闭网格严格正确。
 * 对非封闭网格(有洞)可能误判,但 SDF 构建通常假设输入为封闭网格。
 *
 * 使用非轴对齐方向(1, 1e-4, 1e-4)避免恰好命中三角形边/顶点导致的奇偶歧义。
 */
export function isPointInsideMesh(p: MDFVec3, triangles: MDFVec3[][], axis: 'x' | 'y' | 'z' = 'x'): boolean {
  let count = 0;
  // 使用非对称扰动方向避免命中共享边/顶点/对角线导致的奇偶错误。
  // 黄金比例方向 (1, φ⁻¹, φ⁻²) 在各轴上有不同的量级,几乎不可能命中任何特殊几何位置。
  const phiInv = 1 / 1.6180339887498949;
  const dir: MDFVec3 = axis === 'x' ? { x: 1, y: phiInv, z: phiInv * phiInv }
    : axis === 'y' ? { x: phiInv * phiInv, y: 1, z: phiInv }
    : { x: phiInv, y: phiInv * phiInv, z: 1 };
  const dirN = vnormalize(dir);
  for (const tri of triangles) {
    if (rayTriangleIntersect(p, dirN, tri[0], tri[1], tri[2])) {
      count++;
    }
  }
  return (count % 2) === 1;
}

/**
 * Möller–Trumbore 射线-三角形相交测试。
 * 仅返回是否相交(忽略 t),用于内外判定。
 */
export function rayTriangleIntersect(
  origin: MDFVec3,
  dir: MDFVec3,
  a: MDFVec3,
  b: MDFVec3,
  c: MDFVec3,
): boolean {
  const epsilon = 1e-9;
  const edge1 = vsub(b, a);
  const edge2 = vsub(c, a);
  const h = vcross(dir, edge2);
  const det = vdot(edge1, h);
  if (det > -epsilon && det < epsilon) return false; // 平行
  const invDet = 1 / det;
  const s = vsub(origin, a);
  const u = invDet * vdot(s, h);
  if (u < 0 || u > 1) return false;
  const q = vcross(s, edge1);
  const v = invDet * vdot(dir, q);
  if (v < 0 || u + v > 1) return false;
  const t = invDet * vdot(edge2, q);
  return t > epsilon;
}

/**
 * 构建网格的 SDF(Signed Distance Field)。
 *
 * 算法:对每个体素中心,
 *   1. 计算到所有三角形的最近距离(O(voxels × triangles),brute-force);
 *   2. 用射线投射判定内外,外部赋正值,内部赋负值;
 *   3. 超出 maxDistance 的体素截断到 ±maxDistance(节省内存 + 加速)。
 *
 * 对小网格(32³ = 32768 体素,几百三角形)足够快;
 * 大网格需要 BVH 加速(本模块不实现,留给 GPU 路径)。
 *
 * @param mesh 三角网格
 * @param opts 构建选项
 * @returns SDF 网格
 */
export function buildMeshSDF(mesh: MeshData, opts: SDFBuildOptions = {}): SDFGrid {
  const resolution = opts.resolution ?? 32;
  const padding = opts.padding ?? 0.1;
  const signed = opts.signed ?? true;

  const aabb = computeMeshAABB(mesh);
  const boundsMin: MDFVec3 = {
    x: aabb.min.x - padding,
    y: aabb.min.y - padding,
    z: aabb.min.z - padding,
  };
  const boundsMax: MDFVec3 = {
    x: aabb.max.x + padding,
    y: aabb.max.y + padding,
    z: aabb.max.z + padding,
  };
  const voxelSize: MDFVec3 = {
    x: (boundsMax.x - boundsMin.x) / resolution,
    y: (boundsMax.y - boundsMin.y) / resolution,
    z: (boundsMax.z - boundsMin.z) / resolution,
  };
  const maxAxis = Math.max(
    boundsMax.x - boundsMin.x,
    boundsMax.y - boundsMin.y,
    boundsMax.z - boundsMin.z,
  );
  const maxDistance = opts.maxDistance ?? (padding + maxAxis);

  const triangles = collectTriangles(mesh);
  const data = new Float32Array(resolution * resolution * resolution);

  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const center: MDFVec3 = {
          x: boundsMin.x + (x + 0.5) * voxelSize.x,
          y: boundsMin.y + (y + 0.5) * voxelSize.y,
          z: boundsMin.z + (z + 0.5) * voxelSize.z,
        };

        // 快速 AABB 剔除:如果到网格 AABB 的距离 > maxDistance,直接截断
        const aabbDist = pointAABBSignedDistance(center, aabb.min, aabb.max);
        if (aabbDist > maxDistance) {
          data[idx3(x, y, z, resolution)] = maxDistance;
          continue;
        }

        // 暴力遍历所有三角形,取最小距离
        let minDistSq = Infinity;
        for (const tri of triangles) {
          const r = pointTriangleDistanceSq(center, tri[0], tri[1], tri[2]);
          if (r.distSq < minDistSq) minDistSq = r.distSq;
        }
        const dist = Math.sqrt(minDistSq);

        // 内外判定
        if (signed) {
          const inside = isPointInsideMesh(center, triangles);
          data[idx3(x, y, z, resolution)] = inside ? -dist : Math.min(dist, maxDistance);
        } else {
          data[idx3(x, y, z, resolution)] = Math.min(dist, maxDistance);
        }
      }
    }
  }

  return { data, dimX: resolution, dimY: resolution, dimZ: resolution, boundsMin, boundsMax, voxelSize, maxDistance };
}

/**
 * 构建球体 SDF(解析公式)。
 * 用于测试 / 简单场景。
 */
export function buildSphereSDF(
  center: MDFVec3,
  radius: number,
  boundsMin: MDFVec3,
  boundsMax: MDFVec3,
  resolution: number,
  maxDistance?: number,
): SDFGrid {
  const voxelSize: MDFVec3 = {
    x: (boundsMax.x - boundsMin.x) / resolution,
    y: (boundsMax.y - boundsMin.y) / resolution,
    z: (boundsMax.z - boundsMin.z) / resolution,
  };
  const maxDist = maxDistance ?? radius * 4;
  const data = new Float32Array(resolution * resolution * resolution);
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const p: MDFVec3 = {
          x: boundsMin.x + (x + 0.5) * voxelSize.x,
          y: boundsMin.y + (y + 0.5) * voxelSize.y,
          z: boundsMin.z + (z + 0.5) * voxelSize.z,
        };
        const d = Math.sqrt(
          (p.x - center.x) ** 2 + (p.y - center.y) ** 2 + (p.z - center.z) ** 2,
        ) - radius;
        data[idx3(x, y, z, resolution)] = Math.max(-maxDist, Math.min(d, maxDist));
      }
    }
  }
  return { data, dimX: resolution, dimY: resolution, dimZ: resolution, boundsMin, boundsMax, voxelSize, maxDistance: maxDist };
}

/**
 * 构建立方体 SDF(解析公式)。
 */
export function buildBoxSDF(
  boxMin: MDFVec3,
  boxMax: MDFVec3,
  boundsMin: MDFVec3,
  boundsMax: MDFVec3,
  resolution: number,
  maxDistance?: number,
): SDFGrid {
  const voxelSize: MDFVec3 = {
    x: (boundsMax.x - boundsMin.x) / resolution,
    y: (boundsMax.y - boundsMin.y) / resolution,
    z: (boundsMax.z - boundsMin.z) / resolution,
  };
  const maxDist = maxDistance ?? Math.max(
    boundsMax.x - boundsMin.x,
    boundsMax.y - boundsMin.y,
    boundsMax.z - boundsMin.z,
  );
  const data = new Float32Array(resolution * resolution * resolution);
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const p: MDFVec3 = {
          x: boundsMin.x + (x + 0.5) * voxelSize.x,
          y: boundsMin.y + (y + 0.5) * voxelSize.y,
          z: boundsMin.z + (z + 0.5) * voxelSize.z,
        };
        const d = pointAABBSignedDistance(p, boxMin, boxMax);
        data[idx3(x, y, z, resolution)] = Math.max(-maxDist, Math.min(d, maxDist));
      }
    }
  }
  return { data, dimX: resolution, dimY: resolution, dimZ: resolution, boundsMin, boundsMax, voxelSize, maxDistance: maxDist };
}

// ── 索引与坐标变换 ──────────────────────────────────────────────────

/** 体素 (x, y, z) 在 data 中的索引(z → y → x 行主序)。 */
export function idx3(x: number, y: number, z: number, dim: number): number {
  return (z * dim + y) * dim + x;
}

/** 体素 (x, y, z) 在 data 中的索引(分别指定维度)。 */
export function idx3Dim(x: number, y: number, z: number, dimX: number, dimY: number): number {
  return (z * dimY + y) * dimX + x;
}

/**
 * 世界坐标 → 体素坐标(浮点)。
 * 越界时返回越界坐标(由采样器决定如何处理)。
 */
export function worldToVoxel(p: MDFVec3, sdf: SDFGrid): MDFVec3 {
  return {
    x: (p.x - sdf.boundsMin.x) / sdf.voxelSize.x - 0.5,
    y: (p.y - sdf.boundsMin.y) / sdf.voxelSize.y - 0.5,
    z: (p.z - sdf.boundsMin.z) / sdf.voxelSize.z - 0.5,
  };
}

/**
 * 体素坐标(浮点)→ 世界坐标。
 */
export function voxelToWorld(v: MDFVec3, sdf: SDFGrid): MDFVec3 {
  return {
    x: (v.x + 0.5) * sdf.voxelSize.x + sdf.boundsMin.x,
    y: (v.y + 0.5) * sdf.voxelSize.y + sdf.boundsMin.y,
    z: (v.z + 0.5) * sdf.voxelSize.z + sdf.boundsMin.z,
  };
}

/** 点是否在 SDF 网格边界内(包含)。 */
export function isInsideGrid(p: MDFVec3, sdf: SDFGrid): boolean {
  return p.x >= sdf.boundsMin.x && p.x <= sdf.boundsMax.x
    && p.y >= sdf.boundsMin.y && p.y <= sdf.boundsMax.y
    && p.z >= sdf.boundsMin.z && p.z <= sdf.boundsMax.z;
}

// ── SDF 采样 ────────────────────────────────────────────────────────

/**
 * 最近邻采样 SDF(体素中心值)。
 * 越界返回 +∞(视为完全外部,无遮挡)。
 */
export function sampleSDFNearest(sdf: SDFGrid, p: MDFVec3): number {
  if (!isInsideGrid(p, sdf)) return Infinity;
  const vx = Math.floor((p.x - sdf.boundsMin.x) / sdf.voxelSize.x);
  const vy = Math.floor((p.y - sdf.boundsMin.y) / sdf.voxelSize.y);
  const vz = Math.floor((p.z - sdf.boundsMin.z) / sdf.voxelSize.z);
  const cx = Math.max(0, Math.min(sdf.dimX - 1, vx));
  const cy = Math.max(0, Math.min(sdf.dimY - 1, vy));
  const cz = Math.max(0, Math.min(sdf.dimZ - 1, vz));
  return sdf.data[idx3Dim(cx, cy, cz, sdf.dimX, sdf.dimY)];
}

/**
 * 三线性插值采样 SDF(连续距离值)。
 * 越界返回 +∞(视为完全外部,无遮挡)。
 *
 * 与 GLSL `texture(sampler3D, uvw)` 在 LINEAR 过滤下一致。
 */
export function sampleSDFTrilinear(sdf: SDFGrid, p: MDFVec3): number {
  if (!isInsideGrid(p, sdf)) return Infinity;
  // 浮点体素坐标(中心对齐)
  const fx = (p.x - sdf.boundsMin.x) / sdf.voxelSize.x - 0.5;
  const fy = (p.y - sdf.boundsMin.y) / sdf.voxelSize.y - 0.5;
  const fz = (p.z - sdf.boundsMin.z) / sdf.voxelSize.z - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;

  const get = (x: number, y: number, z: number): number => {
    const cx = Math.max(0, Math.min(sdf.dimX - 1, x));
    const cy = Math.max(0, Math.min(sdf.dimY - 1, y));
    const cz = Math.max(0, Math.min(sdf.dimZ - 1, z));
    return sdf.data[idx3Dim(cx, cy, cz, sdf.dimX, sdf.dimY)];
  };

  const c000 = get(x0, y0, z0);
  const c100 = get(x1, y0, z0);
  const c010 = get(x0, y1, z0);
  const c110 = get(x1, y1, z0);
  const c001 = get(x0, y0, z1);
  const c101 = get(x1, y0, z1);
  const c011 = get(x0, y1, z1);
  const c111 = get(x1, y1, z1);

  // 三线性插值
  const c00 = c000 * (1 - tx) + c100 * tx;
  const c10 = c010 * (1 - tx) + c110 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx;
  const c11 = c011 * (1 - tx) + c111 * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

/**
 * 计算 SDF 梯度(法线估计)。
 * 使用中心差分,步长 = 体素尺寸。
 *
 * 与 GLSL `computeNormalFromSDF()` 一致。
 * 用于 DFSS / DFAO 中的表面法线重建。
 */
export function sampleSDFGradient(sdf: SDFGrid, p: MDFVec3): MDFVec3 {
  const eps = sdf.voxelSize.x;
  const dx = sampleSDFTrilinear(sdf, { x: p.x + eps, y: p.y, z: p.z }) - sampleSDFTrilinear(sdf, { x: p.x - eps, y: p.y, z: p.z });
  const dy = sampleSDFTrilinear(sdf, { x: p.x, y: p.y + eps, z: p.z }) - sampleSDFTrilinear(sdf, { x: p.x, y: p.y - eps, z: p.z });
  const dz = sampleSDFTrilinear(sdf, { x: p.x, y: p.y, z: p.z + eps }) - sampleSDFTrilinear(sdf, { x: p.x, y: p.y, z: p.z - eps });
  return vnormalize({ x: dx, y: dy, z: dz });
}

// ── 球面追踪(Sphere Tracing, Hart 1996) ──────────────────────────

/**
 * 射线-AABB 相交(slab 法),返回进入 t。
 * 不相交返回 -1。
 */
function rayAABBEnterT(
  origin: MDFVec3,
  dir: MDFVec3,
  min: MDFVec3,
  max: MDFVec3,
): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [min.x, min.y, min.z];
  const mx = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-10) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  // 起点在盒内时 tmin < 0,从 0 开始;否则从 tmin 开始
  return tmin > 0 ? tmin : 0;
}

/**
 * 球面追踪:沿射线 origin + t·dir 步进,每步前进当前 SDF 值。
 *
 * 算法:
 *   t = 0(若起点在网格外,先推进到网格边界)
 *   loop maxSteps:
 *     p = origin + t * dir
 *     d = sampleSDF(p)
 *     if d < epsilon: 命中表面,返回 hit=true
 *     if t > maxDistance: 超出范围,返回 hit=false
 *     t += d  // 球面追踪核心:前进距离 = 当前到表面的最短距离
 *
 * 优势:自适应步长(远处快进,近表面慢进),无穿透,无 aliasing。
 *
 * @param sdf  SDF 网格
 * @param origin  射线起点(世界坐标,可在网格外)
 * @param dir  射线方向(归一化)
 * @param maxDistance  最大追踪距离
 * @param maxSteps  最大步数
 * @param epsilon  命中阈值(默认 = 体素尺寸 × 0.5)
 */
export function rayMarchSDF(
  sdf: SDFGrid,
  origin: MDFVec3,
  dir: MDFVec3,
  maxDistance: number,
  maxSteps: number = 32,
  epsilon: number = sdf.voxelSize.x * 0.5,
): RayMarchResult {
  const dirN = vnormalize(dir);

  // 起点在网格外时,先推进到网格边界
  let t = 0;
  if (!isInsideGrid(origin, sdf)) {
    const enterT = rayAABBEnterT(origin, dirN, sdf.boundsMin, sdf.boundsMax);
    if (enterT < 0 || enterT > maxDistance) {
      // 射线不与网格相交,或交点超出最大距离
      const endPoint: MDFVec3 = {
        x: origin.x + dirN.x * maxDistance,
        y: origin.y + dirN.y * maxDistance,
        z: origin.z + dirN.z * maxDistance,
      };
      return { hit: false, point: endPoint, distance: maxDistance, steps: 0, finalSDF: Infinity };
    }
    t = enterT;
  }

  let steps = 0;
  let lastSDF = 0;

  while (steps < maxSteps && t < maxDistance) {
    const p: MDFVec3 = {
      x: origin.x + dirN.x * t,
      y: origin.y + dirN.y * t,
      z: origin.z + dirN.z * t,
    };
    const d = sampleSDFTrilinear(sdf, p);
    if (!Number.isFinite(d)) {
      // 离开网格,未命中
      const endPoint: MDFVec3 = {
        x: origin.x + dirN.x * t,
        y: origin.y + dirN.y * t,
        z: origin.z + dirN.z * t,
      };
      return { hit: false, point: endPoint, distance: t, steps, finalSDF: d };
    }
    lastSDF = d;
    if (d < epsilon) {
      return { hit: true, point: p, distance: t, steps, finalSDF: d };
    }
    // 球面追踪核心:前进距离 = 当前 SDF 值(但不超过剩余距离)
    t += Math.max(d, epsilon * 0.5);
    steps++;
  }

  const endPoint: MDFVec3 = {
    x: origin.x + dirN.x * t,
    y: origin.y + dirN.y * t,
    z: origin.z + dirN.z * t,
  };
  return { hit: false, point: endPoint, distance: t, steps, finalSDF: lastSDF };
}

// ── DFSS:距离场软阴影(Distance Field Soft Shadows) ────────────────

/**
 * 距离场软阴影(DFSS)— 锥追踪近似。
 *
 * 算法(UE5 DistanceFieldShadowing):
 *   沿光线方向球面追踪,每步记录"最近遮挡距离"。
 *   阴影系数 = 1 - (最近遮挡距离 / (步进距离 × 光源尺寸))。
 *   累积所有步的阴影系数,取最小值(最暗)。
 *
 * 物理含义:
 *   - 光线从表面点出发,沿光方向步进;
 *   - 每步的 SDF 值表示"当前点到最近表面的距离";
 *   - 如果 SDF 值 < (步进距离 × 光源张角),则该位置在光源的"半影"区内,
 *     部分被遮挡 → 阴影变软;
 *   - 累积最小遮挡 → 最终可见性。
 *
 * 优势:
 *   - 自然软阴影:无需 PCF / Gaussian blur,锥追踪数学严格;
 *   - 无 aliasing:SDF 连续,采样即平滑;
 *   - 无 acne / peter-panning:无光空间深度比较;
 *   - 大光源自然柔和:光源尺寸 → 半影宽度,无需调参。
 *
 * @param sdf  SDF 网格
 * @param point  表面点(世界坐标)
 * @param lightDir  光方向(从表面指向光源,归一化)
 * @param lightDistance  光源距离(世界单位,无穷远光源用大值)
 * @param opts  选项
 * @returns 可见性 [0,1],0 = 完全阴影,1 = 完全照亮
 */
export function dfssShadow(
  sdf: SDFGrid,
  point: MDFVec3,
  lightDir: MDFVec3,
  lightDistance: number = Infinity,
  opts: DFSSOptions = {},
): number {
  const lightSize = opts.lightSize ?? 0.1;
  const maxDistance = opts.maxDistance ?? 10.0;
  const maxSteps = opts.maxSteps ?? 32;
  // 偏置至少为 2 倍体素尺寸,避免表面附近 SDF≈0 被误判为命中
  const minBias = sdf.voxelSize.x * 2;
  const bias = Math.max(opts.bias ?? 0.01, minBias);
  const sharpness = opts.sharpness ?? 1.0;

  const dirN = vnormalize(lightDir);
  // 沿光方向偏移起点,避免自相交
  const origin: MDFVec3 = {
    x: point.x + dirN.x * bias,
    y: point.y + dirN.y * bias,
    z: point.z + dirN.z * bias,
  };

  let t = 0;
  let minVisibility = 1.0;
  // 命中阈值:小于体素尺寸的 0.25 认为命中表面
  const hitEpsilon = sdf.voxelSize.x * 0.25;
  const effectiveMaxDist = Math.min(maxDistance, lightDistance);

  for (let step = 0; step < maxSteps && t < effectiveMaxDist; step++) {
    const p: MDFVec3 = {
      x: origin.x + dirN.x * t,
      y: origin.y + dirN.y * t,
      z: origin.z + dirN.z * t,
    };
    const d = sampleSDFTrilinear(sdf, p);

    if (!Number.isFinite(d)) {
      // 离开网格,无遮挡
      break;
    }

    if (d < hitEpsilon) {
      // 命中表面 → 完全遮挡
      return 0.0;
    }

    // 锥追踪:当前 SDF 值 / (步进距离 × 光源张角) = 该位置的可见性
    // 光源张角 = lightSize / lightDistance(近光源张角大,远光源张角小)
    // 但 UE5 用 lightSize 直接作为锥角半径,因此:
    const penumbra = d / (t * lightSize + bias * lightSize);
    const visibility = Math.min(1.0, penumbra * sharpness);
    if (visibility < minVisibility) {
      minVisibility = visibility;
    }

    // 球面追踪步进(步长 = 当前 SDF 值)
    t += Math.max(d, hitEpsilon * 0.5);
  }

  return minVisibility;
}

// ── DFAO:距离场环境光遮蔽(Distance Field Ambient Occlusion) ───────

/**
 * 距离场环境光遮蔽(DFAO)— 锥追踪半球采样。
 *
 * 算法(UE5 DistanceFieldAmbientOcclusion):
 *   在表面法线半球内发射 numSamples 条射线,
 *   每条射线做球面追踪,记录最近遮挡距离;
 *   AO = 1 - strength × average(occlusion)
 *   其中 occlusion = max(0, 1 - distance / radius)
 *
 * 优势:
 *   - 比 SSAO / GTAO 更稳定:无屏幕空间噪声,无边缘伪影;
 *   - 比 HBAO 更准确:半球采样覆盖完整法线半球;
 *   - 比 DDGI AO 更精确:世界空间 SDF,不受探针分辨率限制。
 *
 * @param sdf  SDF 网格
 * @param point  表面点(世界坐标)
 * @param normal  表面法线(归一化)
 * @param opts  选项
 * @returns AO 系数 [0,1],0 = 完全遮蔽,1 = 完全照亮
 */
export function dfao(
  sdf: SDFGrid,
  point: MDFVec3,
  normal: MDFVec3,
  opts: DFAOOptions = {},
): number {
  const radius = opts.radius ?? 1.0;
  const numSamples = opts.numSamples ?? 8;
  const maxDistance = opts.maxDistance ?? radius;
  const maxSteps = opts.maxSteps ?? 16;
  const strength = opts.strength ?? 1.0;
  // 偏置至少为 2 倍体素尺寸,避免表面附近自相交
  const minBias = sdf.voxelSize.x * 2;
  const bias = Math.max(opts.bias ?? 0.05, minBias);

  const nN = vnormalize(normal);
  // 沿法线偏移起点,避免自相交
  const origin: MDFVec3 = {
    x: point.x + nN.x * bias,
    y: point.y + nN.y * bias,
    z: point.z + nN.z * bias,
  };

  // 在法线半球内均匀采样方向(使用 Fibonacci 球面分布)
  let totalOcclusion = 0;
  let validSamples = 0;

  for (let i = 0; i < numSamples; i++) {
    const dir = fibonacciHemisphere(i, numSamples, nN);
    const march = rayMarchSDF(sdf, origin, dir, maxDistance, maxSteps, sdf.voxelSize.x * 0.5);
    if (march.hit) {
      // 命中表面 → 距离越近遮蔽越强
      const occ = Math.max(0, 1 - march.distance / radius);
      totalOcclusion += occ;
    } else if (march.distance < maxDistance) {
      // 未命中但距离较近 → 部分遮蔽
      const occ = Math.max(0, 1 - march.distance / radius) * 0.5;
      totalOcclusion += occ;
    }
    validSamples++;
  }

  const avgOcclusion = validSamples > 0 ? totalOcclusion / validSamples : 0;
  const ao = 1 - Math.min(1, avgOcclusion * strength);
  return Math.max(0, Math.min(1, ao));
}

/**
 * Fibonacci 半球采样(在 normal 半球内均匀分布)。
 * 算法:球面 Fibonacci 分布 + 法线对齐。
 */
function fibonacciHemisphere(i: number, n: number, normal: MDFVec3): MDFVec3 {
  const golden = (1 + Math.sqrt(5)) / 2;
  const t = (i + 0.5) / n;
  const phi = Math.acos(1 - 2 * t); // [0, π/2] 半球
  const theta = 2 * Math.PI * i / golden;
  const localDir: MDFVec3 = {
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.sin(phi) * Math.sin(theta),
    z: Math.cos(phi),
  };
  // 把局部 +Z 对齐到 normal(TBN 构建)
  const up: MDFVec3 = Math.abs(normal.z) < 0.999 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const tangent = vnormalize(vcross(up, normal));
  const bitangent = vcross(normal, tangent);
  return vnormalize({
    x: tangent.x * localDir.x + bitangent.x * localDir.y + normal.x * localDir.z,
    y: tangent.y * localDir.x + bitangent.y * localDir.y + normal.y * localDir.z,
    z: tangent.z * localDir.x + bitangent.z * localDir.y + normal.z * localDir.z,
  });
}

// ── 工具函数 ────────────────────────────────────────────────────────

/**
 * 计算 SDF 内存占用(字节)。
 */
export function sdfMemoryBytes(sdf: SDFGrid): number {
  return sdf.data.byteLength;
}

/**
 * 计算 SDF 内存占用(MB)。
 */
export function sdfMemoryMB(sdf: SDFGrid): number {
  return sdfMemoryBytes(sdf) / (1024 * 1024);
}

/**
 * 获取 SDF 统计信息(用于调试)。
 */
export function getSDFStats(sdf: SDFGrid): {
  dimX: number;
  dimY: number;
  dimZ: number;
  totalVoxels: number;
  memoryMB: number;
  maxDistance: number;
  bounds: { min: MDFVec3; max: MDFVec3 };
  voxelSize: MDFVec3;
} {
  return {
    dimX: sdf.dimX,
    dimY: sdf.dimY,
    dimZ: sdf.dimZ,
    totalVoxels: sdf.dimX * sdf.dimY * sdf.dimZ,
    memoryMB: sdfMemoryMB(sdf),
    maxDistance: sdf.maxDistance,
    bounds: { min: sdf.boundsMin, max: sdf.boundsMax },
    voxelSize: sdf.voxelSize,
  };
}

// ── GLSL 着色器块(供 GPU 集成参考) ────────────────────────────────

/**
 * SDF 采样 GLSL 片段(三线性插值)。
 * 对应 `sampleSDFTrilinear()` 的 GPU 实现。
 *
 * 使用方法:
 *   uniform sampler3D uSDF;
 *   uniform vec3 uSDFMin;
 *   uniform vec3 uSDFMax;
 *   uniform vec3 uSDFDim;
 *
 *   float d = sampleSDF(uSDF, uSDFMin, uSDFMax, worldPos);
 */
export const SDF_SAMPLE_GLSL = /* glsl */ `#version 300 es
precision highp float;

// SDF 三线性采样(GLSL texture3D LINEAR 等价)
// 参数:sampler3D sdf / 网格 AABB min / max / 世界坐标
// 返回:该点的 SDF 值(负=内部,0=表面,正=外部)
float sampleSDF(sampler3D sdf, vec3 boundsMin, vec3 boundsMax, vec3 worldPos) {
  vec3 uvw = (worldPos - boundsMin) / (boundsMax - boundsMin);
  // 越界返回 +∞(完全外部,无遮挡)
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
    return 1e10;
  }
  return texture(sdf, uvw).r;
}

// SDF 梯度(法线估计,中心差分)
vec3 sampleSDFGradient(sampler3D sdf, vec3 boundsMin, vec3 boundsMax, vec3 worldPos, vec3 voxelSize) {
  float eps = voxelSize.x;
  float dx = sampleSDF(sdf, boundsMin, boundsMax, worldPos + vec3(eps, 0.0, 0.0))
           - sampleSDF(sdf, boundsMin, boundsMax, worldPos - vec3(eps, 0.0, 0.0));
  float dy = sampleSDF(sdf, boundsMin, boundsMax, worldPos + vec3(0.0, eps, 0.0))
           - sampleSDF(sdf, boundsMin, boundsMax, worldPos - vec3(0.0, eps, 0.0));
  float dz = sampleSDF(sdf, boundsMin, boundsMax, worldPos + vec3(0.0, 0.0, eps))
           - sampleSDF(sdf, boundsMin, boundsMax, worldPos - vec3(0.0, 0.0, eps));
  return normalize(vec3(dx, dy, dz));
}
`;

/**
 * DFSS 软阴影 GLSL 片段。
 * 对应 `dfssShadow()` 的 GPU 实现。
 *
 * 使用方法:
 *   float visibility = dfssShadow(uSDF, uSDFMin, uSDFMax, worldPos, lightDir, lightSize, maxDist);
 */
export const DFSS_SHADOW_GLSL = /* glsl */ `#version 300 es
precision highp float;

// DFSS 距离场软阴影(锥追踪)
// 参数:SDF / AABB / 表面点 / 光方向(指向光源) / 光源尺寸 / 最大距离
// 返回:可见性 [0,1],0=阴影,1=照亮
float dfssShadow(sampler3D sdf, vec3 boundsMin, vec3 boundsMax, vec3 worldPos,
                 vec3 lightDir, float lightSize, float maxDist, int maxSteps) {
  vec3 dir = normalize(lightDir);
  float bias = 0.01;
  vec3 origin = worldPos + dir * bias;

  float t = 0.0;
  float minVisibility = 1.0;

  for (int i = 0; i < 64; i++) {
    if (i >= maxSteps) break;
    if (t > maxDist) break;

    vec3 p = origin + dir * t;
    float d = sampleSDF(sdf, boundsMin, boundsMax, p);

    if (d < 0.001) {
      return 0.0;  // 命中表面 → 完全遮挡
    }

    // 锥追踪:penumbra = d / (t * lightSize)
    float penumbra = d / (t * lightSize + 1e-6);
    float vis = min(1.0, penumbra);
    minVisibility = min(minVisibility, vis);

    t += max(d, 0.001);
  }

  return minVisibility;
}
`;

/**
 * DFAO 环境光遮蔽 GLSL 片段。
 * 对应 `dfao()` 的 GPU 实现。
 */
export const DFAO_GLSL = /* glsl */ `#version 300 es
precision highp float;

// DFAO 距离场环境光遮蔽(半球锥追踪)
// 参数:SDF / AABB / 表面点 / 法线 / 半径 / 采样数
// 返回:AO [0,1],0=遮蔽,1=照亮
float dfao(sampler3D sdf, vec3 boundsMin, vec3 boundsMax, vec3 worldPos, vec3 normal,
           float radius, int numSamples, int maxSteps) {
  vec3 n = normalize(normal);
  vec3 origin = worldPos + n * 0.05;

  // 构建法线半球的 TBN
  vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(up, n));
  vec3 bitangent = cross(n, tangent);

  float golden = (1.0 + sqrt(5.0)) / 2.0;
  float totalOcc = 0.0;

  for (int i = 0; i < 32; i++) {
    if (i >= numSamples) break;
    float t = (float(i) + 0.5) / float(numSamples);
    float phi = acos(1.0 - 2.0 * t);
    float theta = 2.0 * 3.14159265 * float(i) / golden;
    vec3 localDir = vec3(sin(phi) * cos(theta), sin(phi) * sin(theta), cos(phi));
    vec3 dir = normalize(tangent * localDir.x + bitangent * localDir.y + n * localDir.z);

    // 球面追踪
    float dist = 0.0;
    float occ = 0.0;
    for (int j = 0; j < 32; j++) {
      if (j >= maxSteps) break;
      if (dist > radius) break;
      vec3 p = origin + dir * dist;
      float d = sampleSDF(sdf, boundsMin, boundsMax, p);
      if (d < 0.001) {
        occ = max(0.0, 1.0 - dist / radius);
        break;
      }
      dist += max(d, 0.001);
    }
    totalOcc += occ;
  }

  float avgOcc = totalOcc / float(numSamples);
  return clamp(1.0 - avgOcc, 0.0, 1.0);
}
`;

/**
 * 完整 GLSL 块(SDF 采样 + DFSS + DFAO),供 ShaderProgram 注入。
 */
export const MESH_DISTANCE_FIELD_GLSL = /* glsl */ `#version 300 es
precision highp float;

${SDF_SAMPLE_GLSL}

${DFSS_SHADOW_GLSL}

${DFAO_GLSL}
`;
