import { describe, it, expect } from 'vitest';
import {
  // 类型
  type SSGIVec3,
  type SSGITextureData,
  type SSGIInput,
  // 向量函数
  vadd,
  vsub,
  vscale,
  vdot,
  vcross,
  vlength,
  vnormalize,
  // 矩阵函数
  mat4TransformVec3,
  mat4ProjectVec3,
  // 纯函数
  ign,
  buildTBN,
  cosineSampleHemisphere,
  projectToUV,
  viewDepth,
  sampleTextureClamp,
  hitTestVS,
  smoothstep,
  marchRay,
  computeSSGIPixel,
  executeSSGI,
  temporalAccumulate,
  ssgiNeighborhoodMinMax,
  denoiseSpatial,
  varianceClip,
  // 默认值
  DEFAULT_SSGI_OPTIONS,
  applySSGIDefaults,
  // GLSL
  SSGI_TEMPORAL_FRAG,
  SSGI_DENOISE_FRAG,
} from './SSGI';

// ── 工具 ──────────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function approxVec3(a: SSGIVec3, b: SSGIVec3, eps = 1e-4): boolean {
  return approxEq(a.x, b.x, eps) && approxEq(a.y, b.y, eps) && approxEq(a.z, b.z, eps);
}

/** 单位矩阵(列主序)。 */
function identityMat4(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/** 透视投影矩阵(列主序)。 */
function perspectiveMat4(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1.0 / Math.tan(fov / 2);
  const nf = 1.0 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

/** 构造一个 RGBA Float32Array 纹理(width×height,所有像素同色)。 */
function makeSolidTexture(width: number, height: number, r: number, g: number, b: number, a = 1): SSGITextureData {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

/** 构造 position map:所有像素 = (x, y, z)。 */
function makePositionMap(width: number, height: number, pos: SSGIVec3): SSGITextureData {
  return makeSolidTexture(width, height, pos.x, pos.y, pos.z);
}

/** 构造 normal map:所有像素 = (nx, ny, nz)。 */
function makeNormalMap(width: number, height: number, nrm: SSGIVec3): SSGITextureData {
  return makeSolidTexture(width, height, nrm.x, nrm.y, nrm.z);
}

// ── 向量函数测试 ──────────────────────────────────────────────────

describe('vadd', () => {
  it('adds two vectors', () => {
    const r = vadd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(approxVec3(r, { x: 5, y: 7, z: 9 })).toBe(true);
  });
});

describe('vsub', () => {
  it('subtracts two vectors', () => {
    const r = vsub({ x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 });
    expect(approxVec3(r, { x: 3, y: 3, z: 3 })).toBe(true);
  });
});

describe('vscale', () => {
  it('scales a vector by scalar', () => {
    const r = vscale({ x: 1, y: 2, z: 3 }, 2.5);
    expect(approxVec3(r, { x: 2.5, y: 5, z: 7.5 })).toBe(true);
  });
});

describe('vdot', () => {
  it('computes dot product', () => {
    expect(vdot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
  });
  it('orthogonal vectors → 0', () => {
    expect(approxEq(vdot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 0)).toBe(true);
  });
});

describe('vcross', () => {
  it('computes cross product (right-hand rule)', () => {
    const r = vcross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(approxVec3(r, { x: 0, y: 0, z: 1 })).toBe(true);
  });
  it('X × Y = Z', () => {
    const r = vcross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(r.z).toBe(1);
  });
  it('Y × Z = X', () => {
    const r = vcross({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(r.x).toBe(1);
  });
});

describe('vlength', () => {
  it('computes length', () => {
    expect(approxEq(vlength({ x: 3, y: 4, z: 0 }), 5)).toBe(true);
  });
  it('zero vector → 0', () => {
    expect(vlength({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe('vnormalize', () => {
  it('normalizes to unit length', () => {
    const r = vnormalize({ x: 3, y: 4, z: 0 });
    expect(approxEq(vlength(r), 1)).toBe(true);
  });
  it('zero vector → zero', () => {
    const r = vnormalize({ x: 0, y: 0, z: 0 });
    expect(approxVec3(r, { x: 0, y: 0, z: 0 })).toBe(true);
  });
});

// ── 矩阵函数测试 ──────────────────────────────────────────────────

describe('mat4TransformVec3', () => {
  it('identity matrix → same vector', () => {
    const r = mat4TransformVec3(identityMat4(), { x: 1, y: 2, z: 3 });
    expect(approxVec3(r, { x: 1, y: 2, z: 3 })).toBe(true);
  });
  it('translation matrix → translated vector', () => {
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      10, 20, 30, 1,
    ];
    const r = mat4TransformVec3(m, { x: 1, y: 2, z: 3 });
    expect(approxVec3(r, { x: 11, y: 22, z: 33 })).toBe(true);
  });
});

describe('mat4ProjectVec3', () => {
  it('identity → w=1', () => {
    const r = mat4ProjectVec3(identityMat4(), { x: 1, y: 2, z: 3 });
    expect(approxEq(r.x, 1)).toBe(true);
    expect(approxEq(r.y, 2)).toBe(true);
    expect(approxEq(r.z, 3)).toBe(true);
    expect(approxEq(r.w, 1)).toBe(true);
  });
});

// ── ign(Interleaved Gradient Noise) ─────────────────────────────

describe('ign', () => {
  it('returns value in [0, 1)', () => {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const v = ign(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
  it('same input → same output (deterministic)', () => {
    expect(ign(3.5, 7.2)).toBe(ign(3.5, 7.2));
  });
  it('different inputs → likely different outputs', () => {
    const v1 = ign(1, 1);
    const v2 = ign(2, 2);
    const v3 = ign(3, 3);
    // 至少有两个不同
    const unique = new Set([v1, v2, v3]);
    expect(unique.size).toBeGreaterThan(1);
  });
  it('origin (0,0) → specific known value', () => {
    // ign(0,0) = fract(52.9829189 * fract(0)) = fract(52.9829189 * 0) = 0
    expect(approxEq(ign(0, 0), 0, 1e-6)).toBe(true);
  });
});

// ── buildTBN ─────────────────────────────────────────────────────

describe('buildTBN', () => {
  it('produces orthonormal basis (N = +Z)', () => {
    const { T, B, N } = buildTBN({ x: 0, y: 0, z: 1 });
    expect(approxEq(vlength(T), 1)).toBe(true);
    expect(approxEq(vlength(B), 1)).toBe(true);
    expect(approxEq(vlength(N), 1)).toBe(true);
    // T ⊥ B
    expect(approxEq(vdot(T, B), 0)).toBe(true);
    // T ⊥ N
    expect(approxEq(vdot(T, N), 0)).toBe(true);
    // B ⊥ N
    expect(approxEq(vdot(B, N), 0)).toBe(true);
  });
  it('produces orthonormal basis (N = +Y)', () => {
    const { T, B, N } = buildTBN({ x: 0, y: 1, z: 0 });
    expect(approxEq(vlength(T), 1)).toBe(true);
    expect(approxEq(vlength(B), 1)).toBe(true);
    expect(approxEq(vdot(T, B), 0)).toBe(true);
    expect(approxEq(vdot(T, N), 0)).toBe(true);
    expect(approxEq(vdot(B, N), 0)).toBe(true);
  });
  it('produces orthonormal basis (N = +X)', () => {
    const { T, B, N } = buildTBN({ x: 1, y: 0, z: 0 });
    expect(approxEq(vlength(T), 1)).toBe(true);
    expect(approxEq(vlength(B), 1)).toBe(true);
    expect(approxEq(vdot(T, B), 0)).toBe(true);
    expect(approxEq(vdot(T, N), 0)).toBe(true);
    expect(approxEq(vdot(B, N), 0)).toBe(true);
  });
  it('handles arbitrary normal', () => {
    const { T, B, N } = buildTBN({ x: 0.5, y: 0.5, z: 0.7071 });
    expect(approxEq(vlength(N), 1)).toBe(true);
    expect(approxEq(vdot(T, N), 0, 1e-3)).toBe(true);
    expect(approxEq(vdot(B, N), 0, 1e-3)).toBe(true);
  });
});

// ── cosineSampleHemisphere ────────────────────────────────────────

describe('cosineSampleHemisphere', () => {
  it('produces unit-length direction', () => {
    const tbn = buildTBN({ x: 0, y: 0, z: 1 });
    for (let i = 0; i < 10; i++) {
      const xi1 = (i + 0.1) * 0.1;
      const xi2 = (i + 0.2) * 0.1;
      const dir = cosineSampleHemisphere(xi1, xi2, tbn, 0);
      expect(approxEq(vlength(dir), 1, 1e-3)).toBe(true);
    }
  });
  it('direction is in hemisphere (dot with N >= 0)', () => {
    const tbn = buildTBN({ x: 0, y: 0, z: 1 });
    for (let i = 0; i < 20; i++) {
      const xi1 = (i * 0.37) % 1;
      const xi2 = (i * 0.73) % 1;
      const dir = cosineSampleHemisphere(xi1, xi2, tbn, 0);
      expect(vdot(dir, tbn.N)).toBeGreaterThanOrEqual(-1e-4);
    }
  });
  it('xi1=0 → theta=0 → direction = N', () => {
    const tbn = buildTBN({ x: 0, y: 0, z: 1 });
    const dir = cosineSampleHemisphere(0, 0.5, tbn, 0);
    expect(approxVec3(dir, tbn.N, 1e-3)).toBe(true);
  });
  it('xi1=1 → theta=π/2 → direction in tangent plane', () => {
    const tbn = buildTBN({ x: 0, y: 0, z: 1 });
    const dir = cosineSampleHemisphere(1, 0, tbn, 0);
    // theta = asin(√1) = π/2, so cos(theta)=0 → N component = 0
    expect(approxEq(vdot(dir, tbn.N), 0, 1e-3)).toBe(true);
  });
  it('frameRot rotates the sample in tangent plane', () => {
    const tbn = buildTBN({ x: 0, y: 0, z: 1 });
    const dir0 = cosineSampleHemisphere(0.5, 0, tbn, 0);
    const dirRot = cosineSampleHemisphere(0.5, 0, tbn, Math.PI);
    // 旋转 π → T 分量反转
    expect(dir0.x * dirRot.x).toBeLessThanOrEqual(0.001);
  });
});

// ── projectToUV ──────────────────────────────────────────────────

describe('projectToUV', () => {
  it('origin at camera → UV (0.5, 0.5) for centered point', () => {
    // 世界原点在相机正前方,投影到屏幕中心
    const proj = perspectiveMat4(Math.PI / 2, 1, 0.1, 100);
    const view = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -5, 1, // 相机在 (0,0,5),看向 -Z
    ];
    const r = projectToUV({ x: 0, y: 0, z: 0 }, proj, view);
    expect(r.valid).toBe(true);
    expect(approxEq(r.u, 0.5, 1e-3)).toBe(true);
    expect(approxEq(r.v, 0.5, 1e-3)).toBe(true);
  });
  it('point behind camera → valid=false', () => {
    const proj = perspectiveMat4(Math.PI / 2, 1, 0.1, 100);
    const view = identityMat4();
    const r = projectToUV({ x: 0, y: 0, z: 5 }, proj, view);
    expect(r.valid).toBe(false);
  });
});

// ── viewDepth ────────────────────────────────────────────────────

describe('viewDepth', () => {
  it('identity view → depth = -z', () => {
    const d = viewDepth({ x: 0, y: 0, z: -5 }, identityMat4());
    expect(approxEq(d, 5)).toBe(true);
  });
  it('point at origin → depth = 0', () => {
    const d = viewDepth({ x: 0, y: 0, z: 0 }, identityMat4());
    expect(approxEq(d, 0)).toBe(true);
  });
  it('point behind camera → negative depth', () => {
    const d = viewDepth({ x: 0, y: 0, z: 5 }, identityMat4());
    expect(d).toBeLessThan(0);
  });
});

// ── sampleTextureClamp ───────────────────────────────────────────

describe('sampleTextureClamp', () => {
  it('samples within bounds', () => {
    const tex = makeSolidTexture(4, 4, 0.5, 0.6, 0.7);
    const c = sampleTextureClamp(tex, 0.5, 0.5);
    expect(approxVec3(c, { x: 0.5, y: 0.6, z: 0.7 })).toBe(true);
  });
  it('clamps UV < 0 to edge', () => {
    const tex = makeSolidTexture(4, 4, 0.5, 0.6, 0.7);
    const c = sampleTextureClamp(tex, -1, -1);
    expect(approxVec3(c, { x: 0.5, y: 0.6, z: 0.7 })).toBe(true);
  });
  it('clamps UV > 1 to edge', () => {
    const tex = makeSolidTexture(4, 4, 0.5, 0.6, 0.7);
    const c = sampleTextureClamp(tex, 2, 2);
    expect(approxVec3(c, { x: 0.5, y: 0.6, z: 0.7 })).toBe(true);
  });
  it('samples different pixels', () => {
    const tex: SSGITextureData = {
      data: new Float32Array([
        1, 0, 0, 1,  0, 1, 0, 1,
        0, 0, 1, 1,  1, 1, 0, 1,
      ]),
      width: 2,
      height: 2,
    };
    // UV (0.25, 0.25) → pixel (0, 0) → red
    const c1 = sampleTextureClamp(tex, 0.25, 0.25);
    expect(approxVec3(c1, { x: 1, y: 0, z: 0 })).toBe(true);
    // UV (0.75, 0.25) → pixel (1, 0) → green
    const c2 = sampleTextureClamp(tex, 0.75, 0.25);
    expect(approxVec3(c2, { x: 0, y: 1, z: 0 })).toBe(true);
  });
});

// ── hitTestVS ────────────────────────────────────────────────────

describe('hitTestVS', () => {
  const view = identityMat4();

  it('UV out of bounds → no hit', () => {
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const r = hitTestVS({ x: 0, y: 0, z: -3 }, -0.5, 0.5, posMap, view, 0.5);
    expect(r.hit).toBe(false);
  });
  it('ray in front of geometry → no hit (depthDiff < 0)', () => {
    // 位置图 z=-5,射线 z=-3(更近)→ depthDiff = 3-5 = -2 < 0 → no hit
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const r = hitTestVS({ x: 0, y: 0, z: -3 }, 0.5, 0.5, posMap, view, 0.5);
    expect(r.hit).toBe(false);
  });
  it('ray behind geometry within thickness → hit', () => {
    // 位置图 z=-5,射线 z=-5.2(更远)→ depthDiff = 5.2-5 = 0.2 < 0.5 → hit
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const r = hitTestVS({ x: 0, y: 0, z: -5.2 }, 0.5, 0.5, posMap, view, 0.5);
    expect(r.hit).toBe(true);
  });
  it('ray behind geometry beyond thickness → no hit', () => {
    // 位置图 z=-5,射线 z=-10(更远)→ depthDiff = 10-5 = 5 > 0.5 → no hit
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const r = hitTestVS({ x: 0, y: 0, z: -10 }, 0.5, 0.5, posMap, view, 0.5);
    expect(r.hit).toBe(false);
  });
});

// ── smoothstep ───────────────────────────────────────────────────

describe('smoothstep', () => {
  it('x < edge0 → 0', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
  });
  it('x > edge1 → 1', () => {
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
  it('x at midpoint → 0.5', () => {
    expect(approxEq(smoothstep(0, 1, 0.5), 0.5)).toBe(true);
  });
  it('edge0 == edge1 → degenerate', () => {
    // smoothstep with zero range: t = (x - edge0) / 0 → clamp to [0,1]
    // Implementation: (x - 0) / (0 - 0) = NaN → clamp(0,1,NaN)
    // Our impl: t = max(0, min(1, NaN)) → min(1, NaN) = NaN, max(0, NaN) = NaN
    // This is a known GLSL edge case; we just test it doesn't crash
    expect(() => smoothstep(0.5, 0.5, 0.5)).not.toThrow();
  });
});

// ── marchRay ─────────────────────────────────────────────────────

describe('marchRay', () => {
  const proj = perspectiveMat4(Math.PI / 2, 1, 0.1, 100);
  const view = identityMat4();

  it('ray hitting geometry → hit=true', () => {
    // 位置图:所有像素 z=-5(一堵墙在 z=-5)
    const posMap = makePositionMap(8, 8, { x: 0, y: 0, z: -5 });
    // 射线从 (0,0,-1) 向 -Z 方向射 → 会穿过 z=-5 的墙
    const r = marchRay(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
      posMap, proj, view,
      32, 0.5, 0.5, 0,
    );
    expect(r.hit).toBe(true);
    expect(r.steps).toBeGreaterThan(0);
  });

  it('ray missing geometry → hit=false', () => {
    // 位置图:所有像素 z=5(在射线后方)
    const posMap = makePositionMap(8, 8, { x: 0, y: 0, z: 5 });
    // 射线从 (0,0,-1) 向 -Z 方向射 → 不会命中 z=5 的几何
    const r = marchRay(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
      posMap, proj, view,
      8, 0.5, 0.5, 0,
    );
    expect(r.hit).toBe(false);
  });

  it('maxSteps=0 → no hit, steps=0', () => {
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const r = marchRay(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
      posMap, proj, view,
      0, 0.5, 0.5, 0,
    );
    expect(r.hit).toBe(false);
    expect(r.steps).toBe(0);
  });

  it('returns hitUV within [0,1] on hit', () => {
    const posMap = makePositionMap(8, 8, { x: 0, y: 0, z: -5 });
    const r = marchRay(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
      posMap, proj, view,
      32, 0.5, 0.5, 0,
    );
    if (r.hit) {
      expect(r.hitUV.u).toBeGreaterThanOrEqual(0);
      expect(r.hitUV.u).toBeLessThanOrEqual(1);
      expect(r.hitUV.v).toBeGreaterThanOrEqual(0);
      expect(r.hitUV.v).toBeLessThanOrEqual(1);
    }
  });

  it('totalDistance > 0', () => {
    const posMap = makePositionMap(8, 8, { x: 0, y: 0, z: -5 });
    const r = marchRay(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
      posMap, proj, view,
      32, 0.5, 0.5, 0,
    );
    expect(r.totalDistance).toBeGreaterThan(0);
  });
});

// ── computeSSGIPixel ─────────────────────────────────────────────

describe('computeSSGIPixel', () => {
  const proj = perspectiveMat4(Math.PI / 2, 1, 0.1, 100);
  const view = identityMat4();

  function makeInput(
    pos: SSGIVec3,
    nrm: SSGIVec3,
    color: SSGIVec3,
    camPos: SSGIVec3,
  ): SSGIInput {
    return {
      colorMap: makeSolidTexture(4, 4, color.x, color.y, color.z),
      positionMap: makePositionMap(4, 4, pos),
      normalMap: makeNormalMap(4, 4, nrm),
      camera: { position: camPos, projection: proj, view },
    };
  }

  it('sky pixel (zero normal) → zero irradiance, 0 rays', () => {
    const input = makeInput(
      { x: 0, y: 0, z: -5 },
      { x: 0, y: 0, z: 0 }, // 零法线 = 天空
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0 },
    );
    const r = computeSSGIPixel(0, 0, input, applySSGIDefaults({}));
    expect(approxVec3(r.irradiance, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(r.rays).toBe(0);
  });

  it('back-facing normal → zero irradiance, 0 rays', () => {
    // 法线指向 -Z(背离相机),相机在原点
    const input = makeInput(
      { x: 0, y: 0, z: -5 },
      { x: 0, y: 0, z: -1 }, // 法线指向 -Z(背离相机)
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0 },
    );
    const r = computeSSGIPixel(0, 0, input, applySSGIDefaults({}));
    expect(approxVec3(r.irradiance, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(r.rays).toBe(0);
  });

  it('front-facing normal with hit → non-zero irradiance', () => {
    // 相机在原点,看 -Z
    // 像素位置 z=-5,法线 +Z(朝向相机)
    // 颜色 = 红色 (1,0,0)
    const input = makeInput(
      { x: 0, y: 0, z: -5 },
      { x: 0, y: 0, z: 1 }, // 朝向相机
      { x: 1, y: 0, z: 0 }, // 红色
      { x: 0, y: 0, z: 0 }, // 相机在原点
    );
    const r = computeSSGIPixel(1, 1, input, applySSGIDefaults({ numRays: 4 }));
    expect(r.rays).toBe(4);
    // 如果有命中,irradiance 的 R 分量应该 > 0(因为颜色是红色)
    if (r.hits > 0) {
      expect(r.irradiance.x).toBeGreaterThan(0);
    }
  });

  it('strength=0 → zero irradiance', () => {
    const input = makeInput(
      { x: 0, y: 0, z: -5 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0 },
    );
    const r = computeSSGIPixel(0, 0, input, applySSGIDefaults({ strength: 0, numRays: 4 }));
    expect(approxVec3(r.irradiance, { x: 0, y: 0, z: 0 })).toBe(true);
  });

  it('numRays=1 → 1 ray', () => {
    const input = makeInput(
      { x: 0, y: 0, z: -5 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0 },
    );
    const r = computeSSGIPixel(0, 0, input, applySSGIDefaults({ numRays: 1 }));
    expect(r.rays).toBe(1);
  });

  it('returns steps >= 0', () => {
    const input = makeInput(
      { x: 0, y: 0, z: -5 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0 },
    );
    const r = computeSSGIPixel(0, 0, input, applySSGIDefaults({ numRays: 2 }));
    expect(r.steps).toBeGreaterThanOrEqual(0);
  });
});

// ── executeSSGI ──────────────────────────────────────────────────

describe('executeSSGI', () => {
  const proj = perspectiveMat4(Math.PI / 2, 1, 0.1, 100);
  const view = identityMat4();

  it('returns output with correct dimensions', () => {
    const input: SSGIInput = {
      colorMap: makeSolidTexture(4, 4, 1, 0, 0),
      positionMap: makePositionMap(4, 4, { x: 0, y: 0, z: -5 }),
      normalMap: makeNormalMap(4, 4, { x: 0, y: 0, z: 1 }),
      camera: { position: { x: 0, y: 0, z: 0 }, projection: proj, view },
    };
    const { output } = executeSSGI(input, { numRays: 2 });
    expect(output.width).toBe(4);
    expect(output.height).toBe(4);
    expect(output.data.length).toBe(4 * 4 * 4);
  });

  it('sky-only input → all zero irradiance', () => {
    const input: SSGIInput = {
      colorMap: makeSolidTexture(4, 4, 1, 1, 1),
      positionMap: makePositionMap(4, 4, { x: 0, y: 0, z: -5 }),
      normalMap: makeNormalMap(4, 4, { x: 0, y: 0, z: 0 }), // 天空
      camera: { position: { x: 0, y: 0, z: 0 }, projection: proj, view },
    };
    const { output, stats } = executeSSGI(input, { numRays: 4 });
    for (let i = 0; i < 4 * 4; i++) {
      expect(output.data[i * 4]).toBe(0);
      expect(output.data[i * 4 + 1]).toBe(0);
      expect(output.data[i * 4 + 2]).toBe(0);
    }
    expect(stats.pixelsSkipped).toBe(4 * 4);
    expect(stats.raysShot).toBe(0);
  });

  it('stats are consistent', () => {
    const input: SSGIInput = {
      colorMap: makeSolidTexture(4, 4, 1, 0, 0),
      positionMap: makePositionMap(4, 4, { x: 0, y: 0, z: -5 }),
      normalMap: makeNormalMap(4, 4, { x: 0, y: 0, z: 1 }),
      camera: { position: { x: 0, y: 0, z: 0 }, projection: proj, view },
    };
    const { stats } = executeSSGI(input, { numRays: 4 });
    expect(stats.pixelsProcessed).toBe(4 * 4);
    expect(stats.raysShot).toBeGreaterThan(0);
    expect(stats.raysHit).toBeGreaterThanOrEqual(0);
    expect(stats.raysHit).toBeLessThanOrEqual(stats.raysShot);
    expect(stats.totalSteps).toBeGreaterThanOrEqual(0);
    expect(stats.avgHitsPerPixel).toBeGreaterThanOrEqual(0);
  });

  it('alpha channel = 1 for all pixels', () => {
    const input: SSGIInput = {
      colorMap: makeSolidTexture(2, 2, 1, 1, 1),
      positionMap: makePositionMap(2, 2, { x: 0, y: 0, z: -5 }),
      normalMap: makeNormalMap(2, 2, { x: 0, y: 0, z: 1 }),
      camera: { position: { x: 0, y: 0, z: 0 }, projection: proj, view },
    };
    const { output } = executeSSGI(input, { numRays: 1 });
    for (let i = 0; i < 2 * 2; i++) {
      expect(output.data[i * 4 + 3]).toBe(1);
    }
  });
});

// ── temporalAccumulate ───────────────────────────────────────────

describe('temporalAccumulate', () => {
  it('null history → returns current', () => {
    const current = makeSolidTexture(2, 2, 0.5, 0.6, 0.7);
    const result = temporalAccumulate(current, null, null, 0.1);
    for (let i = 0; i < 2 * 2; i++) {
      expect(approxEq(result.data[i * 4], 0.5)).toBe(true);
      expect(approxEq(result.data[i * 4 + 1], 0.6)).toBe(true);
    }
  });

  it('alpha=1 → returns current (ignores history)', () => {
    const current = makeSolidTexture(2, 2, 0.9, 0.9, 0.9);
    const history = makeSolidTexture(2, 2, 0.1, 0.1, 0.1);
    const result = temporalAccumulate(current, history, null, 1.0);
    for (let i = 0; i < 2 * 2; i++) {
      expect(approxEq(result.data[i * 4], 0.9)).toBe(true);
    }
  });

  it('alpha=0 → returns history (when no velocity)', () => {
    const current = makeSolidTexture(2, 2, 0.9, 0.9, 0.9);
    const history = makeSolidTexture(2, 2, 0.1, 0.1, 0.1);
    const result = temporalAccumulate(current, history, null, 0.0);
    for (let i = 0; i < 2 * 2; i++) {
      expect(approxEq(result.data[i * 4], 0.1)).toBe(true);
    }
  });

  it('alpha=0.5 → average of current and history', () => {
    const current = makeSolidTexture(2, 2, 1.0, 0.0, 0.0);
    const history = makeSolidTexture(2, 2, 0.0, 1.0, 0.0);
    const result = temporalAccumulate(current, history, null, 0.5);
    for (let i = 0; i < 2 * 2; i++) {
      expect(approxEq(result.data[i * 4], 0.5, 1e-3)).toBe(true);
      expect(approxEq(result.data[i * 4 + 1], 0.5, 1e-3)).toBe(true);
    }
  });

  it('velocity shifts history lookup', () => {
    // history 左半红右半蓝
    const histData = new Float32Array(2 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      histData[(y * 2 + 0) * 4] = 1; // 左 = 红
      histData[(y * 2 + 1) * 4 + 2] = 1; // 右 = 蓝
    }
    const history: SSGITextureData = { data: histData, width: 2, height: 2 };
    const current = makeSolidTexture(2, 2, 0, 0, 0);

    // velocity = (-1, 0) → 从右采样历史(px - vx = 0 - (-1) = 1)
    const velocity = new Float32Array(2 * 2 * 2).fill(0);
    for (let y = 0; y < 2; y++) {
      velocity[(y * 2 + 0) * 2] = -1; // 左像素 velocity=(-1,0) → 从右采样
    }

    const result = temporalAccumulate(current, history, velocity, 0.0);
    // 左像素应该从右像素采样历史 → 蓝色
    expect(approxEq(result.data[0], 0, 1e-3)).toBe(true); // R=0
    expect(approxEq(result.data[2], 1, 1e-3)).toBe(true); // B=1
  });

  it('clamps alpha to [0,1]', () => {
    const current = makeSolidTexture(1, 1, 1, 1, 1);
    const history = makeSolidTexture(1, 1, 0, 0, 0);
    const r1 = temporalAccumulate(current, history, null, -1);
    expect(approxEq(r1.data[0], 0)).toBe(true); // alpha=0 → history
    const r2 = temporalAccumulate(current, history, null, 2);
    expect(approxEq(r2.data[0], 1)).toBe(true); // alpha=1 → current
  });
});

// ── ssgiNeighborhoodMinMax ───────────────────────────────────────

describe('ssgiNeighborhoodMinMax', () => {
  it('returns correct min/max for 3×3', () => {
    const tex: SSGITextureData = {
      data: new Float32Array(3 * 3 * 4),
      width: 3,
      height: 3,
    };
    // 中心像素 = 0.5,周围 = 0.0 和 1.0
    for (let i = 0; i < 9; i++) {
      tex.data[i * 4] = 0;
      tex.data[i * 4 + 1] = 0;
      tex.data[i * 4 + 2] = 0;
    }
    tex.data[(0 * 3 + 0) * 4] = 0.0; // 左上 R=0
    tex.data[(1 * 3 + 1) * 4] = 0.5; // 中心 R=0.5
    tex.data[(2 * 3 + 2) * 4] = 1.0; // 右下 R=1.0

    const r = ssgiNeighborhoodMinMax(tex, 1, 1);
    expect(approxEq(r.minR, 0)).toBe(true);
    expect(approxEq(r.maxR, 1)).toBe(true);
  });

  it('corner pixel handles out-of-bounds gracefully', () => {
    const tex = makeSolidTexture(4, 4, 0.5, 0.3, 0.7);
    const r = ssgiNeighborhoodMinMax(tex, 0, 0);
    expect(approxEq(r.minR, 0.5)).toBe(true);
    expect(approxEq(r.maxR, 0.5)).toBe(true);
  });
});

// ── denoiseSpatial ───────────────────────────────────────────────

describe('denoiseSpatial', () => {
  it('preserves uniform input', () => {
    const input = makeSolidTexture(4, 4, 0.5, 0.5, 0.5);
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const nrmMap = makeNormalMap(4, 4, { x: 0, y: 0, z: 1 });
    const result = denoiseSpatial(input, posMap, nrmMap, 2, 1.0);
    for (let i = 0; i < 4 * 4; i++) {
      expect(approxEq(result.data[i * 4], 0.5, 1e-3)).toBe(true);
    }
  });

  it('strength=0 → returns input unchanged', () => {
    const input = makeSolidTexture(4, 4, 0.8, 0.2, 0.3);
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const nrmMap = makeNormalMap(4, 4, { x: 0, y: 0, z: 1 });
    const result = denoiseSpatial(input, posMap, nrmMap, 2, 0.0);
    for (let i = 0; i < 4 * 4; i++) {
      expect(approxEq(result.data[i * 4], 0.8, 1e-6)).toBe(true);
    }
  });

  it('smooths noisy input', () => {
    // 创建一个有噪声的 4×4 纹理
    const data = new Float32Array(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const noise = (x + y) % 2 === 0 ? 1.0 : 0.0;
        data[(y * 4 + x) * 4] = noise;
        data[(y * 4 + x) * 4 + 1] = noise;
        data[(y * 4 + x) * 4 + 2] = noise;
        data[(y * 4 + x) * 4 + 3] = 1;
      }
    }
    const input: SSGITextureData = { data, width: 4, height: 4 };
    const posMap = makePositionMap(4, 4, { x: 0, y: 0, z: -5 });
    const nrmMap = makeNormalMap(4, 4, { x: 0, y: 0, z: 1 });
    const result = denoiseSpatial(input, posMap, nrmMap, 1, 1.0);
    // 中心像素应该被平滑到 0.5 左右
    const centerIdx = (1 * 4 + 1) * 4;
    expect(result.data[centerIdx]).toBeGreaterThan(0.1);
    expect(result.data[centerIdx]).toBeLessThan(0.9);
  });

  it('returns same dimensions', () => {
    const input = makeSolidTexture(3, 5, 0.5, 0.5, 0.5);
    const posMap = makePositionMap(3, 5, { x: 0, y: 0, z: -5 });
    const nrmMap = makeNormalMap(3, 5, { x: 0, y: 0, z: 1 });
    const result = denoiseSpatial(input, posMap, nrmMap, 1, 0.5);
    expect(result.width).toBe(3);
    expect(result.height).toBe(5);
    expect(result.data.length).toBe(3 * 5 * 4);
  });
});

// ── varianceClip ─────────────────────────────────────────────────

describe('varianceClip', () => {
  it('uniform input → history unchanged (within variance = 0)', () => {
    const current = makeSolidTexture(4, 4, 0.5, 0.5, 0.5);
    const history = makeSolidTexture(4, 4, 0.5, 0.5, 0.5);
    const result = varianceClip(current, history, 1.0);
    for (let i = 0; i < 4 * 4; i++) {
      expect(approxEq(result.data[i * 4], 0.5, 1e-3)).toBe(true);
    }
  });

  it('outlier history value → clamped to neighborhood range', () => {
    // 当前帧邻域都是 0.5
    const current = makeSolidTexture(4, 4, 0.5, 0.5, 0.5);
    // 历史帧有一个离群值 10.0
    const histData = new Float32Array(4 * 4 * 4).fill(0.5);
    histData[(1 * 4 + 1) * 4] = 10.0; // 中心 R=10(离群)
    histData[(1 * 4 + 1) * 4 + 1] = 10.0;
    histData[(1 * 4 + 1) * 4 + 2] = 10.0;
    const history: SSGITextureData = { data: histData, width: 4, height: 4 };

    const result = varianceClip(current, history, 1.0);
    // 中心像素的历史值应该被裁剪到合理范围
    const centerIdx = (1 * 4 + 1) * 4;
    expect(result.data[centerIdx]).toBeLessThan(10.0);
    expect(result.data[centerIdx]).toBeGreaterThanOrEqual(0.5);
  });

  it('larger gamma → less aggressive clipping', () => {
    const current = makeSolidTexture(4, 4, 0.5, 0.5, 0.5);
    const histData = new Float32Array(4 * 4 * 4).fill(0.5);
    histData[(1 * 4 + 1) * 4] = 2.0;
    const history: SSGITextureData = { data: histData, width: 4, height: 4 };

    const r1 = varianceClip(current, history, 0.5);
    const r2 = varianceClip(current, history, 5.0);
    // gamma=5 应该保留更多原始历史值
    const centerIdx = (1 * 4 + 1) * 4;
    expect(r2.data[centerIdx]).toBeGreaterThanOrEqual(r1.data[centerIdx]);
  });

  it('returns same dimensions', () => {
    const current = makeSolidTexture(3, 2, 0.5, 0.5, 0.5);
    const history = makeSolidTexture(3, 2, 0.5, 0.5, 0.5);
    const result = varianceClip(current, history, 1.0);
    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
  });
});

// ── applySSGIDefaults ────────────────────────────────────────────

describe('applySSGIDefaults', () => {
  it('undefined opts → all defaults', () => {
    const r = applySSGIDefaults(undefined);
    expect(r.maxSteps).toBe(DEFAULT_SSGI_OPTIONS.maxSteps);
    expect(r.thickness).toBe(DEFAULT_SSGI_OPTIONS.thickness);
    expect(r.strength).toBe(DEFAULT_SSGI_OPTIONS.strength);
    expect(r.radius).toBe(DEFAULT_SSGI_OPTIONS.radius);
    expect(r.numRays).toBe(DEFAULT_SSGI_OPTIONS.numRays);
    expect(r.jitterScale).toBe(DEFAULT_SSGI_OPTIONS.jitterScale);
    expect(r.frame).toBe(DEFAULT_SSGI_OPTIONS.frame);
  });

  it('partial opts → defaults for missing fields', () => {
    const r = applySSGIDefaults({ strength: 0.8 });
    expect(r.strength).toBe(0.8);
    expect(r.maxSteps).toBe(DEFAULT_SSGI_OPTIONS.maxSteps);
  });

  it('clamps maxSteps to [0, 64]', () => {
    expect(applySSGIDefaults({ maxSteps: -5 }).maxSteps).toBe(0);
    expect(applySSGIDefaults({ maxSteps: 100 }).maxSteps).toBe(64);
    expect(applySSGIDefaults({ maxSteps: 32 }).maxSteps).toBe(32);
  });

  it('clamps numRays to [1, 8]', () => {
    expect(applySSGIDefaults({ numRays: 0 }).numRays).toBe(1);
    expect(applySSGIDefaults({ numRays: 20 }).numRays).toBe(8);
    expect(applySSGIDefaults({ numRays: 4 }).numRays).toBe(4);
  });

  it('clamps thickness to >= 0.001', () => {
    expect(applySSGIDefaults({ thickness: 0 }).thickness).toBe(0.001);
    expect(applySSGIDefaults({ thickness: -1 }).thickness).toBe(0.001);
  });

  it('clamps radius to >= 0.001', () => {
    expect(applySSGIDefaults({ radius: 0 }).radius).toBe(0.001);
  });

  it('clamps frame to >= 0', () => {
    expect(applySSGIDefaults({ frame: -5 }).frame).toBe(0);
    expect(applySSGIDefaults({ frame: 10 }).frame).toBe(10);
  });
});

// ── GLSL chunks ──────────────────────────────────────────────────

describe('SSGI_TEMPORAL_FRAG', () => {
  it('is a non-empty GLSL string', () => {
    expect(SSGI_TEMPORAL_FRAG).toBeTruthy();
    expect(SSGI_TEMPORAL_FRAG.length).toBeGreaterThan(100);
  });
  it('contains version directive', () => {
    expect(SSGI_TEMPORAL_FRAG).toContain('#version 300 es');
  });
  it('contains key uniforms', () => {
    expect(SSGI_TEMPORAL_FRAG).toContain('u_currentMap');
    expect(SSGI_TEMPORAL_FRAG).toContain('u_historyMap');
    expect(SSGI_TEMPORAL_FRAG).toContain('u_velocityMap');
    expect(SSGI_TEMPORAL_FRAG).toContain('u_alpha');
  });
  it('contains neighborhoodMinMax function', () => {
    expect(SSGI_TEMPORAL_FRAG).toContain('neighborhoodMinMax');
  });
});

describe('SSGI_DENOISE_FRAG', () => {
  it('is a non-empty GLSL string', () => {
    expect(SSGI_DENOISE_FRAG).toBeTruthy();
    expect(SSGI_DENOISE_FRAG.length).toBeGreaterThan(100);
  });
  it('contains version directive', () => {
    expect(SSGI_DENOISE_FRAG).toContain('#version 300 es');
  });
  it('contains key uniforms', () => {
    expect(SSGI_DENOISE_FRAG).toContain('u_ssgiMap');
    expect(SSGI_DENOISE_FRAG).toContain('u_positionMap');
    expect(SSGI_DENOISE_FRAG).toContain('u_normalMap');
    expect(SSGI_DENOISE_FRAG).toContain('u_strength');
  });
  it('contains bilateral filter logic', () => {
    expect(SSGI_DENOISE_FRAG).toContain('normalWeight');
    expect(SSGI_DENOISE_FRAG).toContain('depthWeight');
  });
});
