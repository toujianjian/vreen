import { describe, it, expect } from 'vitest';
import {
  // 类型
  type MeshletCullData,
  type MeshShaderVertex,
  type MeshShaderOutput,
  type TaskShaderInput,
  type MeshShaderInput,
  // 默认值
  DEFAULT_TASK_SHADER_OPTIONS,
  DEFAULT_MESH_SHADER_OPTIONS,
  DEFAULT_MESH_SHADER_PIPELINE_OPTIONS,
  // 工具函数
  applyTaskShaderDefaults,
  applyMeshShaderDefaults,
  applyMeshShaderPipelineDefaults,
  // 剔除函数
  sphereInFrustum,
  coneBackfaceCulled,
  isMeshletOccluded,
  computeMeshletLOD,
  // 阶段函数
  executeTaskShader,
  executeMeshShader,
  executeMeshShaderPipeline,
  // 矩阵
  mat4Multiply,
  // 辅助
  meshletBoundsToCullData,
  flattenMeshShaderOutput,
  // GLSL
  TASK_SHADER_GLSL,
  MESH_SHADER_GLSL,
} from './MeshShaderPipeline';

// ── 工具 ──────────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

/** 单位矩阵(列主序)。 */
function identityMatrix(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/** 构造一个简单的透视投影矩阵(列主序)。 */
function perspectiveMatrix(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1.0 / Math.tan(fov / 2);
  const nf = 1.0 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

/** 构造一个简单的 meshlet cull data(中心 + 包围球 + 法线锥)。 */
function makeMeshlet(
  id: number,
  center: [number, number, number],
  radius: number,
  coneAxis: [number, number, number] = [0, 0, 1],
  coneCutoff: number = 0.5,
): MeshletCullData {
  return {
    meshletId: id,
    centerX: center[0],
    centerY: center[1],
    centerZ: center[2],
    radius,
    coneApexX: center[0],
    coneApexY: center[1],
    coneApexZ: center[2],
    coneAxisX: coneAxis[0],
    coneAxisY: coneAxis[1],
    coneAxisZ: coneAxis[2],
    coneCutoff,
  };
}

// ── applyTaskShaderDefaults ──────────────────────────────────────

describe('applyTaskShaderDefaults', () => {
  it('empty options → all defaults', () => {
    const opts = applyTaskShaderDefaults();
    expect(opts).toEqual(DEFAULT_TASK_SHADER_OPTIONS);
  });

  it('partial options → merged', () => {
    const opts = applyTaskShaderDefaults({ taskWorkgroupSize: 16 });
    expect(opts.taskWorkgroupSize).toBe(16);
    expect(opts.frustumCulling).toBe(DEFAULT_TASK_SHADER_OPTIONS.frustumCulling);
  });

  it('full options → use provided', () => {
    const opts = applyTaskShaderDefaults({
      taskWorkgroupSize: 64,
      frustumCulling: false,
      backfaceCulling: false,
      occlusionCulling: true,
      lodCulling: false,
      lodDistance: 500,
      conservativeBias: 0.01,
    });
    expect(opts.taskWorkgroupSize).toBe(64);
    expect(opts.frustumCulling).toBe(false);
    expect(opts.occlusionCulling).toBe(true);
    expect(opts.lodDistance).toBe(500);
  });
});

// ── applyMeshShaderDefaults ──────────────────────────────────────

describe('applyMeshShaderDefaults', () => {
  it('empty options → all defaults', () => {
    const opts = applyMeshShaderDefaults();
    expect(opts).toEqual(DEFAULT_MESH_SHADER_OPTIONS);
  });

  it('partial options → merged', () => {
    const opts = applyMeshShaderDefaults({ meshWorkgroupSize: 64 });
    expect(opts.meshWorkgroupSize).toBe(64);
    expect(opts.perTriangleBackfaceCulling).toBe(true);
  });
});

// ── applyMeshShaderPipelineDefaults ──────────────────────────────

describe('applyMeshShaderPipelineDefaults', () => {
  it('empty options → merged from task + mesh', () => {
    const opts = applyMeshShaderPipelineDefaults();
    expect(opts).toEqual(DEFAULT_MESH_SHADER_PIPELINE_OPTIONS);
    expect(opts.enabled).toBe(true);
    expect(opts.taskWorkgroupSize).toBe(DEFAULT_TASK_SHADER_OPTIONS.taskWorkgroupSize);
    expect(opts.meshWorkgroupSize).toBe(DEFAULT_MESH_SHADER_OPTIONS.meshWorkgroupSize);
  });

  it('partial options overrides specific fields', () => {
    const opts = applyMeshShaderPipelineDefaults({ enabled: false, lodDistance: 200 });
    expect(opts.enabled).toBe(false);
    expect(opts.lodDistance).toBe(200);
  });
});

// ── sphereInFrustum ──────────────────────────────────────────────

describe('sphereInFrustum', () => {
  // 构造一个简单的视锥:6 个平面,中心在原点,各方向 ±10
  const simpleFrustum: number[][] = [
    [1, 0, 0, 10],   // left:   x + 10 >= 0 → x >= -10
    [-1, 0, 0, 10],  // right: -x + 10 >= 0 → x <= 10
    [0, 1, 0, 10],   // bottom
    [0, -1, 0, 10],  // top
    [0, 0, 1, 10],   // near
    [0, 0, -1, 10],  // far
  ];

  it('sphere at origin with radius 1 → visible', () => {
    expect(sphereInFrustum({ x: 0, y: 0, z: 0 }, 1, simpleFrustum)).toBe(true);
  });

  it('sphere at (5, 0, 0) with radius 1 → visible', () => {
    expect(sphereInFrustum({ x: 5, y: 0, z: 0 }, 1, simpleFrustum)).toBe(true);
  });

  it('sphere at (15, 0, 0) with radius 1 → culled (outside right plane)', () => {
    expect(sphereInFrustum({ x: 15, y: 0, z: 0 }, 1, simpleFrustum)).toBe(false);
  });

  it('sphere at (-15, 0, 0) with radius 1 → culled (outside left plane)', () => {
    expect(sphereInFrustum({ x: -15, y: 0, z: 0 }, 1, simpleFrustum)).toBe(false);
  });

  it('sphere at (10, 0, 0) with radius 5 → visible (intersects plane)', () => {
    expect(sphereInFrustum({ x: 10, y: 0, z: 0 }, 5, simpleFrustum)).toBe(true);
  });

  it('sphere at (20, 0, 0) with radius 5 → culled (still outside)', () => {
    expect(sphereInFrustum({ x: 20, y: 0, z: 0 }, 5, simpleFrustum)).toBe(false);
  });

  it('sphere at (0, 0, 0) with radius 100 → visible (encloses frustum)', () => {
    expect(sphereInFrustum({ x: 0, y: 0, z: 0 }, 100, simpleFrustum)).toBe(true);
  });
});

// ── coneBackfaceCulled ───────────────────────────────────────────

describe('coneBackfaceCulled', () => {
  // 约定(与 MeshletRenderer 一致):
  //   viewDir = normalize(coneApex - viewPosition)  // 视点→锥顶方向
  //   coneAxis = 平均外法线(指向正面外侧)
  //   dot(viewDir, coneAxis) >= coneCutoff → 背面

  it('view on back side (along axis) → backface', () => {
    // cone apex at origin, axis = +z (front faces +z), cutoff = 0.5
    // view at (0, 0, -10) → viewDir = (0,0,10) → (0,0,1) → dot = 1 >= 0.5 → backface
    const result = coneBackfaceCulled(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      0.5,
      { x: 0, y: 0, z: -10 },
    );
    expect(result).toBe(true);
  });

  it('view on front side (opposite axis) → front-facing', () => {
    // view at (0, 0, 10) → viewDir = (0,0,-10) → (0,0,-1) → dot = -1 < 0.5 → front
    const result = coneBackfaceCulled(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      0.5,
      { x: 0, y: 0, z: 10 },
    );
    expect(result).toBe(false);
  });

  it('view perpendicular to cone axis with small cutoff → not backface', () => {
    // view at (10, 0, 0) → viewDir = (-10,0,0) → (-1,0,0) → dot = 0 < 0.5 → front
    const result = coneBackfaceCulled(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      0.5,
      { x: 10, y: 0, z: 0 },
    );
    expect(result).toBe(false);
  });

  it('view perpendicular to cone axis with large cutoff → backface', () => {
    // cutoff = -0.5 (very wide cone, >90deg) → dot=0 >= -0.5 → backface
    const result = coneBackfaceCulled(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      -0.5,
      { x: 10, y: 0, z: 0 },
    );
    expect(result).toBe(true);
  });

  it('view at apex → viewDir is zero vector → not backface', () => {
    const result = coneBackfaceCulled(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      0.5,
      { x: 0, y: 0, z: 0 },
    );
    expect(result).toBe(false);
  });
});

// ── computeMeshletLOD ────────────────────────────────────────────

describe('computeMeshletLOD', () => {
  it('very close large meshlet → LOD 0', () => {
    // meshlet at (0, 0, 5), radius 10, view at origin, screen 1920x1080
    const lod = computeMeshletLOD(
      { x: 0, y: 0, z: 5 },
      10,
      { x: 0, y: 0, z: 0 },
      1920,
      1080,
    );
    expect(lod).toBe(0);
  });

  it('far small meshlet → high LOD', () => {
    // meshlet at (0, 0, 1000), radius 1
    const lod = computeMeshletLOD(
      { x: 0, y: 0, z: 1000 },
      1,
      { x: 0, y: 0, z: 0 },
      1920,
      1080,
    );
    // projectionRatio = 1/1000 = 0.001 → projectedPixels = 1.92 → LOD 4
    expect(lod).toBe(4);
  });

  it('meshlet at same position as view → LOD 0 (avoids div by 0)', () => {
    const lod = computeMeshletLOD(
      { x: 0, y: 0, z: 0 },
      1,
      { x: 0, y: 0, z: 0 },
      1920,
      1080,
    );
    expect(lod).toBe(0);
  });

  it('LOD increases with distance', () => {
    const lod1 = computeMeshletLOD(
      { x: 0, y: 0, z: 10 },
      1,
      { x: 0, y: 0, z: 0 },
      1920,
      1080,
    );
    const lod2 = computeMeshletLOD(
      { x: 0, y: 0, z: 100 },
      1,
      { x: 0, y: 0, z: 0 },
      1920,
      1080,
    );
    expect(lod2).toBeGreaterThanOrEqual(lod1);
  });
});

// ── mat4Multiply ─────────────────────────────────────────────────

describe('mat4Multiply', () => {
  it('identity × identity = identity', () => {
    const i = identityMatrix();
    const r = mat4Multiply(i, i);
    for (let k = 0; k < 16; k++) {
      expect(approxEq(r[k], i[k])).toBe(true);
    }
  });

  it('identity × m = m', () => {
    const i = identityMatrix();
    const m = [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      1, 2, 3, 1,
    ];
    const r = mat4Multiply(i, m);
    for (let k = 0; k < 16; k++) {
      expect(approxEq(r[k], m[k])).toBe(true);
    }
  });

  it('m × identity = m', () => {
    const i = identityMatrix();
    const m = [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      1, 2, 3, 1,
    ];
    const r = mat4Multiply(m, i);
    for (let k = 0; k < 16; k++) {
      expect(approxEq(r[k], m[k])).toBe(true);
    }
  });

  it('A × B != B × A (non-commutative)', () => {
    // 列主序存储:
    //   a = [1,2,3,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] → 矩阵 A 行 0 = (1,0,0,0), 行 1 = (2,1,0,0), 行 2 = (3,0,1,0)
    //   b = [1,0,0,0, 5,1,0,0, 0,0,1,0, 0,0,0,1] → 矩阵 B 行 0 = (1,5,0,0), 行 1 = (0,1,0,0)
    // A×B [0,0] = 行 0 of A · 列 0 of B = 1*1 + 0*0 + 0*0 + 0*0 = 1
    // B×A [0,0] = 行 0 of B · 列 0 of A = 1*1 + 5*2 + 0*3 + 0*0 = 11
    const a = [
      1, 2, 3, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const b = [
      1, 0, 0, 0,
      5, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const ab = mat4Multiply(a, b);
    const ba = mat4Multiply(b, a);
    expect(ab[0]).toBe(1);   // (A×B)[0,0]
    expect(ba[0]).toBe(11);  // (B×A)[0,0]
    expect(ab[0]).not.toBe(ba[0]);
  });
});

// ── executeTaskShader ───────────────────────────────────────────

describe('executeTaskShader', () => {
  const frustum: number[][] = [
    [1, 0, 0, 1000],
    [-1, 0, 0, 1000],
    [0, 1, 0, 1000],
    [0, -1, 0, 1000],
    [0, 0, 1, 1000],
    [0, 0, -1, 1000],
  ];
  const viewPos = { x: 0, y: 0, z: 0 };
  const vp = identityMatrix();

  function makeInput(meshlets: MeshletCullData[]): TaskShaderInput {
    return {
      meshlets,
      viewPosition: viewPos,
      frustumPlanes: frustum,
      viewProjectionMatrix: vp,
    };
  }

  it('empty meshlet array → empty dispatches', () => {
    const result = executeTaskShader(makeInput([]), DEFAULT_TASK_SHADER_OPTIONS);
    expect(result.dispatches).toEqual([]);
    expect(result.stats.inputMeshletCount).toBe(0);
    expect(result.stats.visibleMeshletCount).toBe(0);
  });

  // 约定:coneAxis = 外法线方向。meshlet 在 +z,view 在原点 → 正面朝向 view 时外法线 = -z
  const FRONT_AXIS: [number, number, number] = [0, 0, -1];
  const BACK_AXIS: [number, number, number] = [0, 0, 1];

  it('single visible meshlet → 1 dispatch', () => {
    const meshlets = [makeMeshlet(0, [0, 0, 10], 1, FRONT_AXIS, 0.5)];
    const result = executeTaskShader(makeInput(meshlets), DEFAULT_TASK_SHADER_OPTIONS);
    expect(result.dispatches).toHaveLength(1);
    expect(result.dispatches[0].meshletId).toBe(0);
    expect(result.stats.visibleMeshletCount).toBe(1);
  });

  it('meshlet outside frustum → frustumCulled', () => {
    // 关闭 lodCulling 以避免远处 meshlet 先被 LOD 剔除
    const meshlets = [makeMeshlet(0, [10000, 0, 0], 1, FRONT_AXIS, 0.5)];
    const opts = { ...DEFAULT_TASK_SHADER_OPTIONS, lodCulling: false };
    const result = executeTaskShader(makeInput(meshlets), opts);
    expect(result.dispatches).toHaveLength(0);
    expect(result.stats.frustumCulled).toBe(1);
  });

  it('meshlet backface → backfaceCulled', () => {
    // cone axis = +z (背向 view),meshlet at (0, 0, 10)
    // viewDir = (0,0,10) → (0,0,1),dot((0,0,1),(0,0,1)) = 1 >= 0.5 → backface
    const meshlets = [makeMeshlet(0, [0, 0, 10], 1, BACK_AXIS, 0.5)];
    const result = executeTaskShader(makeInput(meshlets), DEFAULT_TASK_SHADER_OPTIONS);
    expect(result.dispatches).toHaveLength(0);
    expect(result.stats.backfaceCulled).toBe(1);
  });

  it('meshlet front-facing → visible', () => {
    // cone axis = -z (外法线指向 view),meshlet at (0, 0, 10)
    // viewDir = (0,0,1),dot((0,0,1),(0,0,-1)) = -1 < 0.5 → front
    const meshlets = [makeMeshlet(0, [0, 0, 10], 1, FRONT_AXIS, 0.5)];
    const result = executeTaskShader(makeInput(meshlets), DEFAULT_TASK_SHADER_OPTIONS);
    expect(result.dispatches).toHaveLength(1);
  });

  it('meshlet too far → lodCulled', () => {
    // z=500 在视锥内(far plane=1000),但超过 lodDistance=100
    const meshlets = [makeMeshlet(0, [0, 0, 500], 1, FRONT_AXIS, 0.5)];
    const opts = { ...DEFAULT_TASK_SHADER_OPTIONS, lodDistance: 100 };
    const result = executeTaskShader(makeInput(meshlets), opts);
    expect(result.dispatches).toHaveLength(0);
    expect(result.stats.lodCulled).toBe(1);
  });

  it('disable lodCulling → far meshlet still visible', () => {
    // 同样 z=500,但关闭 lodCulling → 应通过(在视锥内 + 正面朝向)
    const meshlets = [makeMeshlet(0, [0, 0, 500], 1, FRONT_AXIS, 0.5)];
    const opts = { ...DEFAULT_TASK_SHADER_OPTIONS, lodCulling: false, lodDistance: 100 };
    const result = executeTaskShader(makeInput(meshlets), opts);
    expect(result.dispatches).toHaveLength(1);
    expect(result.stats.lodCulled).toBe(0);
  });

  it('disable frustumCulling → out-of-frustum meshlet still visible', () => {
    const meshlets = [makeMeshlet(0, [10000, 0, 0], 1, FRONT_AXIS, 0.5)];
    const opts = { ...DEFAULT_TASK_SHADER_OPTIONS, frustumCulling: false, lodCulling: false };
    const result = executeTaskShader(makeInput(meshlets), opts);
    expect(result.dispatches).toHaveLength(1);
    expect(result.stats.frustumCulled).toBe(0);
  });

  it('disable backfaceCulling → backface meshlet still visible', () => {
    const meshlets = [makeMeshlet(0, [0, 0, 10], 1, BACK_AXIS, 0.5)];
    const opts = { ...DEFAULT_TASK_SHADER_OPTIONS, backfaceCulling: false };
    const result = executeTaskShader(makeInput(meshlets), opts);
    expect(result.dispatches).toHaveLength(1);
    expect(result.stats.backfaceCulled).toBe(0);
  });

  it('mixed meshlets: some visible, some culled', () => {
    const meshlets = [
      makeMeshlet(0, [0, 0, 10], 1, FRONT_AXIS, 0.5),  // visible
      makeMeshlet(1, [10000, 0, 0], 1, FRONT_AXIS, 0.5),  // frustum culled
      makeMeshlet(2, [0, 0, 20], 1, FRONT_AXIS, 0.5),  // visible
      makeMeshlet(3, [0, 0, 30], 1, BACK_AXIS, 0.5),  // backface culled
    ];
    const opts = { ...DEFAULT_TASK_SHADER_OPTIONS, lodCulling: false };
    const result = executeTaskShader(makeInput(meshlets), opts);
    expect(result.dispatches).toHaveLength(2);
    expect(result.dispatches[0].meshletId).toBe(0);
    expect(result.dispatches[1].meshletId).toBe(2);
    expect(result.stats.frustumCulled).toBe(1);
    expect(result.stats.backfaceCulled).toBe(1);
  });

  it('taskWorkgroupCount is ceil(count / size)', () => {
    const meshlets: MeshletCullData[] = [];
    for (let i = 0; i < 100; i++) {
      meshlets.push(makeMeshlet(i, [0, 0, 10 + i], 1, FRONT_AXIS, 0.5));
    }
    const result = executeTaskShader(makeInput(meshlets), DEFAULT_TASK_SHADER_OPTIONS);
    // 100 meshlets, workgroupSize 32 → ceil(100/32) = 4
    expect(result.stats.taskWorkgroupCount).toBe(4);
  });

  it('taskWorkgroup field reflects workgroup index', () => {
    const meshlets: MeshletCullData[] = [];
    for (let i = 0; i < 64; i++) {
      meshlets.push(makeMeshlet(i, [0, 0, 10 + i], 1, FRONT_AXIS, 0.5));
    }
    const result = executeTaskShader(makeInput(meshlets), DEFAULT_TASK_SHADER_OPTIONS);
    // workgroupSize 32 → first 32 in workgroup 0, next 32 in workgroup 1
    expect(result.dispatches[0].taskWorkgroup).toBe(0);
    expect(result.dispatches[31].taskWorkgroup).toBe(0);
    expect(result.dispatches[32].taskWorkgroup).toBe(1);
  });

  it('lod field is computed when screen size provided', () => {
    const meshlets = [makeMeshlet(0, [0, 0, 5], 10, FRONT_AXIS, 0.5)];
    const input: TaskShaderInput = {
      ...makeInput(meshlets),
      screenWidth: 1920,
      screenHeight: 1080,
    };
    const result = executeTaskShader(input, DEFAULT_TASK_SHADER_OPTIONS);
    expect(result.dispatches).toHaveLength(1);
    // very close, large → LOD 0
    expect(result.dispatches[0].lod).toBe(0);
  });
});

// ── executeMeshShader ───────────────────────────────────────────

describe('executeMeshShader', () => {
  it('single triangle facing view → 1 visible triangle', () => {
    // Triangle at z=5, view at origin. For front-facing, normal must point toward -z (toward view).
    // Winding (0, 2, 1) gives normal = (v2-v0) × (v1-v0) → -z direction.
    const positions = new Float32Array([
      -1, -1, 5,
      1, -1, 5,
      0, 1, 5,
    ]);
    const indices = new Uint32Array([0, 2, 1]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(result.vertices).toHaveLength(3);
    expect(result.triangles).toHaveLength(1);
    expect(result.triangles[0].visible).toBe(true);
    expect(result.outputTriangleCount).toBe(1);
  });

  it('backface triangle → invisible', () => {
    // Triangle at z=5, winding (0, 1, 2) gives normal +z (away from view at origin).
    //   edge1 = v1-v0 = (2,0,0), edge2 = v2-v0 = (1,2,0)
    //   normal = edge1 × edge2 = (0,0,4) → +z
    //   viewDir from center to view = (0,0,0)-(0,-1/3,5) = (0,1/3,-5)
    //   dot(viewDir, normal) = -20 < 0 → backface
    const positions = new Float32Array([
      -1, -1, 5,
      1, -1, 5,
      0, 1, 5,
    ]);
    const indices = new Uint32Array([0, 1, 2]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(result.triangles[0].visible).toBe(false);
    expect(result.outputTriangleCount).toBe(0);
  });

  it('disable perTriangleBackfaceCulling → all triangles visible', () => {
    const positions = new Float32Array([
      -1, -1, 5,
      1, -1, 5,
      0, 1, 5,
    ]);
    const indices = new Uint32Array([0, 1, 2]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const opts = { ...DEFAULT_MESH_SHADER_OPTIONS, perTriangleBackfaceCulling: false };
    const result = executeMeshShader(input, opts);
    expect(result.triangles[0].visible).toBe(true);
    expect(result.outputTriangleCount).toBe(1);
  });

  it('vertices are transformed to clip space', () => {
    const positions = new Float32Array([1, 2, 3]);
    const indices = new Uint32Array([]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(result.vertices).toHaveLength(1);
    expect(approxEq(result.vertices[0].clipX, 1)).toBe(true);
    expect(approxEq(result.vertices[0].clipY, 2)).toBe(true);
    expect(approxEq(result.vertices[0].clipZ, 3)).toBe(true);
    expect(approxEq(result.vertices[0].clipW, 1)).toBe(true);
  });

  it('vertices world position equals clip with identity matrices', () => {
    const positions = new Float32Array([5, 6, 7]);
    const indices = new Uint32Array([]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(approxEq(result.vertices[0].worldX, 5)).toBe(true);
    expect(approxEq(result.vertices[0].worldY, 6)).toBe(true);
    expect(approxEq(result.vertices[0].worldZ, 7)).toBe(true);
  });

  it('model matrix translation is applied', () => {
    const positions = new Float32Array([0, 0, 0]);
    const indices = new Uint32Array([]);
    const modelMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      10, 20, 30, 1,  // translation
    ];
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix,
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(approxEq(result.vertices[0].worldX, 10)).toBe(true);
    expect(approxEq(result.vertices[0].worldY, 20)).toBe(true);
    expect(approxEq(result.vertices[0].worldZ, 30)).toBe(true);
  });

  it('multiple triangles with mixed facing', () => {
    // Two triangles: one facing view, one backface
    // Triangle 0: at z=5, normal +z → backface (view at origin)
    // Triangle 1: at z=5, normal -z → front-facing
    // To make normal -z, reverse winding: (0, 2, 1)
    const positions = new Float32Array([
      -1, -1, 5,  // v0
      1, -1, 5,   // v1
      0, 1, 5,    // v2
    ]);
    const indices = new Uint32Array([
      0, 1, 2,  // normal +z → backface
      0, 2, 1,  // normal -z → front-facing
    ]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(result.triangles).toHaveLength(2);
    expect(result.triangles[0].visible).toBe(false);
    expect(result.triangles[1].visible).toBe(true);
    expect(result.outputTriangleCount).toBe(1);
  });

  it('meshletId is preserved in output', () => {
    const positions = new Float32Array([0, 0, 0]);
    const indices = new Uint32Array([]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 42,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(result.meshletId).toBe(42);
  });

  it('empty indices → no triangles', () => {
    const positions = new Float32Array([0, 0, 0, 1, 1, 1]);
    const indices = new Uint32Array([]);
    const input: MeshShaderInput = {
      positions,
      indices,
      modelMatrix: identityMatrix(),
      viewProjectionMatrix: identityMatrix(),
      meshletId: 0,
      viewPosition: { x: 0, y: 0, z: 0 },
    };
    const result = executeMeshShader(input, DEFAULT_MESH_SHADER_OPTIONS);
    expect(result.triangles).toHaveLength(0);
    expect(result.inputTriangleCount).toBe(0);
    expect(result.outputTriangleCount).toBe(0);
  });
});

// ── executeMeshShaderPipeline ───────────────────────────────────

describe('executeMeshShaderPipeline', () => {
  const frustum: number[][] = [
    [1, 0, 0, 1000],
    [-1, 0, 0, 1000],
    [0, 1, 0, 1000],
    [0, -1, 0, 1000],
    [0, 0, 1, 1000],
    [0, 0, -1, 1000],
  ];

  it('empty input → empty output', () => {
    const result = executeMeshShaderPipeline(
      {
        meshlets: [],
        viewPosition: { x: 0, y: 0, z: 0 },
        frustumPlanes: frustum,
        viewProjectionMatrix: identityMatrix(),
      },
      new Map(),
      new Map(),
      { x: 0, y: 0, z: 0 },
      identityMatrix(),
    );
    expect(result.outputs).toEqual([]);
    expect(result.stats.inputMeshletCount).toBe(0);
    expect(result.stats.visibleMeshletCount).toBe(0);
  });

  it('single visible meshlet → 1 output', () => {
    const meshlets = [makeMeshlet(0, [0, 0, 10], 1, [0, 0, -1], 0.5)];
    const meshletsData = new Map([
      [0, {
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }],
    ]);
    const modelMatrices = new Map([[0, identityMatrix()]]);

    const result = executeMeshShaderPipeline(
      {
        meshlets,
        viewPosition: { x: 0, y: 0, z: 0 },
        frustumPlanes: frustum,
        viewProjectionMatrix: identityMatrix(),
      },
      meshletsData,
      modelMatrices,
      { x: 0, y: 0, z: 0 },
      identityMatrix(),
      { lodCulling: false },
    );

    expect(result.outputs).toHaveLength(1);
    expect(result.stats.visibleMeshletCount).toBe(1);
    expect(result.stats.meshWorkgroupCount).toBe(1);
    expect(result.stats.inputTriangleCount).toBe(1);
  });

  it('culled meshlet → not in output', () => {
    const meshlets = [makeMeshlet(0, [10000, 0, 0], 1, [0, 0, -1], 0.5)];
    const meshletsData = new Map([
      [0, {
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }],
    ]);
    const modelMatrices = new Map([[0, identityMatrix()]]);

    const result = executeMeshShaderPipeline(
      {
        meshlets,
        viewPosition: { x: 0, y: 0, z: 0 },
        frustumPlanes: frustum,
        viewProjectionMatrix: identityMatrix(),
      },
      meshletsData,
      modelMatrices,
      { x: 0, y: 0, z: 0 },
      identityMatrix(),
      { lodCulling: false },  // 关闭 LOD 剔除,让 frustum 剔除生效
    );

    expect(result.outputs).toHaveLength(0);
    expect(result.stats.frustumCulled).toBe(1);
  });

  it('multiple meshlets: stats aggregate', () => {
    const meshlets = [
      makeMeshlet(0, [0, 0, 10], 1, [0, 0, -1], 0.5),
      makeMeshlet(1, [0, 0, 20], 1, [0, 0, -1], 0.5),
    ];
    const meshletsData = new Map([
      [0, {
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }],
      [1, {
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 1]),
      }],
    ]);
    const modelMatrices = new Map([
      [0, identityMatrix()],
      [1, identityMatrix()],
    ]);

    const result = executeMeshShaderPipeline(
      {
        meshlets,
        viewPosition: { x: 0, y: 0, z: 0 },
        frustumPlanes: frustum,
        viewProjectionMatrix: identityMatrix(),
      },
      meshletsData,
      modelMatrices,
      { x: 0, y: 0, z: 0 },
      identityMatrix(),
      { lodCulling: false },
    );

    expect(result.outputs).toHaveLength(2);
    expect(result.stats.inputTriangleCount).toBe(3);  // 1 + 2
  });

  it('missing meshlet data → skipped', () => {
    const meshlets = [makeMeshlet(0, [0, 0, 10], 1, [0, 0, -1], 0.5)];
    const meshletsData = new Map();  // empty
    const modelMatrices = new Map();

    const result = executeMeshShaderPipeline(
      {
        meshlets,
        viewPosition: { x: 0, y: 0, z: 0 },
        frustumPlanes: frustum,
        viewProjectionMatrix: identityMatrix(),
      },
      meshletsData,
      modelMatrices,
      { x: 0, y: 0, z: 0 },
      identityMatrix(),
      { lodCulling: false },
    );

    expect(result.outputs).toHaveLength(0);
    // task shader still counted it as visible, but mesh shader skipped
    expect(result.stats.visibleMeshletCount).toBe(1);
    expect(result.stats.meshWorkgroupCount).toBe(1);
  });
});

// ── meshletBoundsToCullData ─────────────────────────────────────

describe('meshletBoundsToCullData', () => {
  it('converts bounds array to cull data array', () => {
    const bounds = [
      {
        meshletId: 0,
        center: { x: 1, y: 2, z: 3 },
        radius: 0.5,
        coneApex: { x: 1, y: 2, z: 3 },
        coneAxis: { x: 0, y: 0, z: 1 },
        coneCutoff: 0.7,
      },
    ];
    const result = meshletBoundsToCullData(bounds);
    expect(result).toHaveLength(1);
    expect(result[0].meshletId).toBe(0);
    expect(result[0].centerX).toBe(1);
    expect(result[0].centerY).toBe(2);
    expect(result[0].centerZ).toBe(3);
    expect(result[0].radius).toBe(0.5);
    expect(result[0].coneAxisZ).toBe(1);
    expect(result[0].coneCutoff).toBe(0.7);
  });

  it('empty input → empty output', () => {
    expect(meshletBoundsToCullData([])).toEqual([]);
  });

  it('preserves all fields for multiple bounds', () => {
    const bounds = [
      {
        meshletId: 10,
        center: { x: 1, y: 2, z: 3 },
        radius: 1,
        coneApex: { x: 0, y: 0, z: 0 },
        coneAxis: { x: 1, y: 0, z: 0 },
        coneCutoff: 0.5,
      },
      {
        meshletId: 20,
        center: { x: 4, y: 5, z: 6 },
        radius: 2,
        coneApex: { x: 1, y: 1, z: 1 },
        coneAxis: { x: 0, y: 1, z: 0 },
        coneCutoff: 0.3,
      },
    ];
    const result = meshletBoundsToCullData(bounds);
    expect(result).toHaveLength(2);
    expect(result[0].meshletId).toBe(10);
    expect(result[1].meshletId).toBe(20);
    expect(result[1].centerX).toBe(4);
    expect(result[1].coneAxisY).toBe(1);
  });
});

// ── flattenMeshShaderOutput ─────────────────────────────────────

describe('flattenMeshShaderOutput', () => {
  it('empty outputs → empty arrays', () => {
    const result = flattenMeshShaderOutput([]);
    expect(result.positions.length).toBe(0);
    expect(result.indices.length).toBe(0);
    expect(result.vertexCount).toBe(0);
    expect(result.triangleCount).toBe(0);
  });

  it('single output → flattened arrays', () => {
    const outputs: MeshShaderOutput[] = [{
      meshletId: 0,
      vertices: [
        { clipX: 0, clipY: 0, clipZ: 0, clipW: 1, worldX: 1, worldY: 2, worldZ: 3, localIndex: 0 },
        { clipX: 0, clipY: 0, clipZ: 0, clipW: 1, worldX: 4, worldY: 5, worldZ: 6, localIndex: 1 },
        { clipX: 0, clipY: 0, clipZ: 0, clipW: 1, worldX: 7, worldY: 8, worldZ: 9, localIndex: 2 },
      ],
      triangles: [
        { v0: 0, v1: 1, v2: 2, visible: true },
      ],
      inputTriangleCount: 1,
      outputTriangleCount: 1,
    }];
    const result = flattenMeshShaderOutput(outputs);
    expect(result.vertexCount).toBe(3);
    expect(result.triangleCount).toBe(1);
    expect(result.positions[0]).toBe(1);
    expect(result.positions[1]).toBe(2);
    expect(result.positions[2]).toBe(3);
    expect(result.indices[0]).toBe(0);
    expect(result.indices[1]).toBe(1);
    expect(result.indices[2]).toBe(2);
  });

  it('multiple outputs → indices offset correctly', () => {
    const makeVert = (i: number): MeshShaderVertex => ({
      clipX: 0, clipY: 0, clipZ: 0, clipW: 1,
      worldX: i, worldY: 0, worldZ: 0,
      localIndex: i,
    });
    const outputs: MeshShaderOutput[] = [
      {
        meshletId: 0,
        vertices: [makeVert(0), makeVert(1), makeVert(2)],
        triangles: [{ v0: 0, v1: 1, v2: 2, visible: true }],
        inputTriangleCount: 1,
        outputTriangleCount: 1,
      },
      {
        meshletId: 1,
        vertices: [makeVert(3), makeVert(4), makeVert(5)],
        triangles: [{ v0: 0, v1: 1, v2: 2, visible: true }],
        inputTriangleCount: 1,
        outputTriangleCount: 1,
      },
    ];
    const result = flattenMeshShaderOutput(outputs);
    expect(result.vertexCount).toBe(6);
    expect(result.triangleCount).toBe(2);
    // Second triangle indices should be offset by 3 (vertex count of first output)
    expect(result.indices[3]).toBe(3);
    expect(result.indices[4]).toBe(4);
    expect(result.indices[5]).toBe(5);
  });

  it('invisible triangles are excluded', () => {
    const outputs: MeshShaderOutput[] = [{
      meshletId: 0,
      vertices: [
        { clipX: 0, clipY: 0, clipZ: 0, clipW: 1, worldX: 0, worldY: 0, worldZ: 0, localIndex: 0 },
        { clipX: 0, clipY: 0, clipZ: 0, clipW: 1, worldX: 1, worldY: 0, worldZ: 0, localIndex: 1 },
        { clipX: 0, clipY: 0, clipZ: 0, clipW: 1, worldX: 0, worldY: 1, worldZ: 0, localIndex: 2 },
      ],
      triangles: [
        { v0: 0, v1: 1, v2: 2, visible: false },
        { v0: 0, v1: 2, v2: 1, visible: true },
      ],
      inputTriangleCount: 2,
      outputTriangleCount: 1,
    }];
    const result = flattenMeshShaderOutput(outputs);
    expect(result.triangleCount).toBe(1);
    // Only the second (visible) triangle is in indices
    expect(result.indices[0]).toBe(0);
    expect(result.indices[1]).toBe(2);
    expect(result.indices[2]).toBe(1);
  });
});

// ── GLSL chunks ─────────────────────────────────────────────────

describe('GLSL chunks', () => {
  it('TASK_SHADER_GLSL is non-empty string', () => {
    expect(typeof TASK_SHADER_GLSL).toBe('string');
    expect(TASK_SHADER_GLSL.length).toBeGreaterThan(100);
  });

  it('TASK_SHADER_GLSL contains #version 300 es', () => {
    expect(TASK_SHADER_GLSL).toContain('#version 300 es');
  });

  it('TASK_SHADER_GLSL contains MeshletCullData struct', () => {
    expect(TASK_SHADER_GLSL).toContain('MeshletCullData');
  });

  it('TASK_SHADER_GLSL contains sphereInFrustum function', () => {
    expect(TASK_SHADER_GLSL).toContain('sphereInFrustum');
  });

  it('TASK_SHADER_GLSL contains coneBackfaceCulled function', () => {
    expect(TASK_SHADER_GLSL).toContain('coneBackfaceCulled');
  });

  it('MESH_SHADER_GLSL is non-empty string', () => {
    expect(typeof MESH_SHADER_GLSL).toBe('string');
    expect(MESH_SHADER_GLSL.length).toBeGreaterThan(100);
  });

  it('MESH_SHADER_GLSL contains #version 300 es', () => {
    expect(MESH_SHADER_GLSL).toContain('#version 300 es');
  });

  it('MESH_SHADER_GLSL contains u_modelMatrix uniform', () => {
    expect(MESH_SHADER_GLSL).toContain('u_modelMatrix');
  });
});

// ── isMeshletOccluded ───────────────────────────────────────────

describe('isMeshletOccluded', () => {
  it('meshlet behind camera (w<=0) → not occluded', () => {
    // 透视 VP:m[11] = -1,所以 w = -z。z > 0 → w < 0 → 在相机后方。
    const vp = perspectiveMatrix(Math.PI / 2, 1, 0.1, 100);
    // meshlet at z = +5 (behind camera, w = -5 ≤ 0)
    const result = isMeshletOccluded(
      { x: 0, y: 0, z: 5 },
      1,
      vp,
      new Float32Array(64 * 64).fill(0),
      64,
      64,
    );
    expect(result).toBe(false);
  });

  it('meshlet with stored depth closer than meshlet → occluded', () => {
    // Use perspective VP, meshlet at z=-5 (in front of camera)
    const vp = perspectiveMatrix(Math.PI / 2, 1, 0.1, 100);
    const hzb = new Float32Array(64 * 64).fill(0.0); // depth 0 = closest
    const result = isMeshletOccluded(
      { x: 0, y: 0, z: -5 },
      1,
      vp,
      hzb,
      64,
      64,
    );
    expect(typeof result).toBe('boolean');
  });
});

// ── DEFAULT constants ───────────────────────────────────────────

describe('DEFAULT constants', () => {
  it('DEFAULT_TASK_SHADER_OPTIONS has expected values', () => {
    expect(DEFAULT_TASK_SHADER_OPTIONS.taskWorkgroupSize).toBe(32);
    expect(DEFAULT_TASK_SHADER_OPTIONS.frustumCulling).toBe(true);
    expect(DEFAULT_TASK_SHADER_OPTIONS.backfaceCulling).toBe(true);
    expect(DEFAULT_TASK_SHADER_OPTIONS.occlusionCulling).toBe(false);
    expect(DEFAULT_TASK_SHADER_OPTIONS.lodCulling).toBe(true);
    expect(DEFAULT_TASK_SHADER_OPTIONS.lodDistance).toBeGreaterThan(0);
  });

  it('DEFAULT_MESH_SHADER_OPTIONS has expected values', () => {
    expect(DEFAULT_MESH_SHADER_OPTIONS.meshWorkgroupSize).toBe(32);
    expect(DEFAULT_MESH_SHADER_OPTIONS.perTriangleBackfaceCulling).toBe(true);
    expect(DEFAULT_MESH_SHADER_OPTIONS.nearPlane).toBeGreaterThan(0);
  });

  it('DEFAULT_MESH_SHADER_PIPELINE_OPTIONS merges both', () => {
    expect(DEFAULT_MESH_SHADER_PIPELINE_OPTIONS.enabled).toBe(true);
    expect(DEFAULT_MESH_SHADER_PIPELINE_OPTIONS.taskWorkgroupSize).toBe(32);
    expect(DEFAULT_MESH_SHADER_PIPELINE_OPTIONS.meshWorkgroupSize).toBe(32);
  });
});
