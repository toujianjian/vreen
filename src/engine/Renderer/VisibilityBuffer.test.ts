import { describe, it, expect } from 'vitest';
import {
  // 常量
  MESHINFO_BITS, MAX_MESHINFO, MESHINFO_MASK,
  MESHINFO_INVALID_BIT, MESHINFO_INVALID_MASK,
  FRONTFACE_BIT, FRONTFACE_MASK,
  // 位打包工具
  uintAsFloat, floatAsUint,
  packVisibilityBuffer, unpackVisibilityBuffer, getMeshInfoIndex,
  // 重心坐标
  computeBarycentric2D, edgeFunctionBarycentric,
  // 光栅化
  rasterizeTriangle, buildVisibilityBuffer, pixelOffset,
  // 解压
  decompressPixel, interpolateAttributes,
  fetchTriangleVertices, fetchInterpolatedPosition,
  // GLSL chunks
  VISIBILITY_BUFFER_PACK_UTILITY, VISIBILITY_BUFFER_PACK_VERT,
  VISIBILITY_BUFFER_PACK_FRAG, VISIBILITY_BUFFER_UNPACK_UTILITY,
  // 类型
  type VisibilityBufferEntry, type VisibilityTriangle,
  type MeshInfo,
} from './VisibilityBuffer';

// ── 测试辅助 ─────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function baryApprox(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, eps = 1e-6): boolean {
  return approxEq(a.x, b.x, eps) && approxEq(a.y, b.y, eps) && approxEq(a.z, b.z, eps);
}

/** 标准三角形(屏幕空间,CCW 绕序 = 正面):a=(0,0), b=(10,0), c=(0,10)。 */
function makeCCWTriangle(): VisibilityTriangle {
  return {
    meshInfoIndex: 5,
    triangleId: 42,
    screenPositions: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ],
    depths: [0.5, 0.5, 0.5],
    isFrontFace: true,
  };
}

// ── 常量 ─────────────────────────────────────────────────────────

describe('constants', () => {
  it('MESHINFO_BITS is 30', () => {
    expect(MESHINFO_BITS).toBe(30);
  });
  it('MAX_MESHINFO is 2^30', () => {
    expect(MAX_MESHINFO).toBe(1 << 30);
    expect(MAX_MESHINFO).toBe(1073741824);
  });
  it('MESHINFO_MASK is low 30 bits', () => {
    expect(MESHINFO_MASK).toBe(MAX_MESHINFO - 1);
    expect(MESHINFO_MASK & (1 << 30)).toBe(0);
    expect(MESHINFO_MASK & (1 << 29)).toBe(1 << 29);
  });
  it('MESHINFO_INVALID_BIT is 31', () => {
    expect(MESHINFO_INVALID_BIT).toBe(31);
    // 0x80000000 在 JS 位运算中是 -2147483648(32 位有符号),用 >>> 0 转无符号
    expect(MESHINFO_INVALID_MASK >>> 0).toBe(0x80000000 >>> 0);
  });
  it('FRONTFACE_BIT is 30', () => {
    expect(FRONTFACE_BIT).toBe(30);
    expect(FRONTFACE_MASK >>> 0).toBe(0x40000000 >>> 0);
  });
  it('flags do not overlap meshinfo bits', () => {
    expect(MESHINFO_MASK & MESHINFO_INVALID_MASK).toBe(0);
    expect(MESHINFO_MASK & FRONTFACE_MASK).toBe(0);
    expect(MESHINFO_INVALID_MASK & FRONTFACE_MASK).toBe(0);
  });
});

// ── 位转换工具 ───────────────────────────────────────────────────

describe('uintAsFloat / floatAsUint', () => {
  it('round-trips 0', () => {
    expect(floatAsUint(uintAsFloat(0))).toBe(0);
  });
  it('round-trips 0x80000000 (-0.0f,空像素标记)', () => {
    expect(floatAsUint(uintAsFloat(0x80000000))).toBe(0x80000000);
  });
  it('round-trips arbitrary uint32', () => {
    for (const u of [1, 42, 255, 65535, 0x12345678, 0x7FFFFFFF, 0xFFFFFFFF]) {
      expect(floatAsUint(uintAsFloat(u >>> 0))).toBe(u >>> 0);
    }
  });
  it('uintAsFloat(0x80000000) is -0', () => {
    const f = uintAsFloat(0x80000000);
    expect(Object.is(f, -0)).toBe(true);
    expect(f === 0).toBe(true); // -0 === 0
  });
});

// ── pack / unpack ────────────────────────────────────────────────

describe('packVisibilityBuffer', () => {
  it('packs basic entry correctly', () => {
    const entry: VisibilityBufferEntry = {
      meshInfoIndex: 12345,
      triangleId: 67890,
      isFrontFace: true,
      barycentrics: { x: 0.25, y: 0.35, z: 0.4 },
    };
    const packed = packVisibilityBuffer(entry);

    // first.x = asfloat(flagsAndMeshInfoIndex)
    //   flagsAndMeshInfoIndex = meshInfoIndex | FRONTFACE_MASK
    const raw = floatAsUint(packed.first[0]);
    expect(raw & MESHINFO_MASK).toBe(12345);
    expect(raw & FRONTFACE_MASK).not.toBe(0); // isFrontFace=true
    expect(raw & MESHINFO_INVALID_MASK).toBe(0); // valid

    // first.y = asfloat(triangleId)
    expect(floatAsUint(packed.first[1])).toBe(67890);

    // first.zw = barycentrics.xy
    expect(approxEq(packed.first[2], 0.25)).toBe(true);
    expect(approxEq(packed.first[3], 0.35)).toBe(true);
  });

  it('packs isFrontFace=false correctly', () => {
    const entry: VisibilityBufferEntry = {
      meshInfoIndex: 1, triangleId: 0, isFrontFace: false,
      barycentrics: { x: 0.5, y: 0.5, z: 0 },
    };
    const packed = packVisibilityBuffer(entry);
    const raw = floatAsUint(packed.first[0]);
    expect(raw & FRONTFACE_MASK).toBe(0);
  });

  it('packs derivatives when provided', () => {
    const entry: VisibilityBufferEntry = {
      meshInfoIndex: 0, triangleId: 0, isFrontFace: false,
      barycentrics: { x: 0.1, y: 0.2, z: 0.7 },
      barycentricsDx: { x: 0.01, y: 0.02, z: -0.03 },
      barycentricsDy: { x: 0.04, y: 0.05, z: -0.09 },
    };
    const packed = packVisibilityBuffer(entry);
    expect(approxEq(packed.second[0], 0.01)).toBe(true);
    expect(approxEq(packed.second[1], 0.02)).toBe(true);
    expect(approxEq(packed.second[2], 0.04)).toBe(true);
    expect(approxEq(packed.second[3], 0.05)).toBe(true);
  });

  it('packs derivatives as 0 when not provided', () => {
    const entry: VisibilityBufferEntry = {
      meshInfoIndex: 0, triangleId: 0, isFrontFace: false,
      barycentrics: { x: 0, y: 0, z: 1 },
    };
    const packed = packVisibilityBuffer(entry);
    expect(packed.second[0]).toBe(0);
    expect(packed.second[1]).toBe(0);
    expect(packed.second[2]).toBe(0);
    expect(packed.second[3]).toBe(0);
  });

  it('round-trips through unpackVisibilityBuffer', () => {
    const entry: VisibilityBufferEntry = {
      meshInfoIndex: 987654,
      triangleId: 123456,
      isFrontFace: true,
      barycentrics: { x: 0.3, y: 0.4, z: 0.3 },
      barycentricsDx: { x: 0.001, y: 0.002, z: -0.003 },
      barycentricsDy: { x: 0.004, y: 0.005, z: -0.009 },
    };
    const packed = packVisibilityBuffer(entry);
    const unpacked = unpackVisibilityBuffer(packed.first, packed.second);
    expect(unpacked).not.toBeNull();
    expect(unpacked!.meshInfoIndex).toBe(987654);
    expect(unpacked!.triangleId).toBe(123456);
    expect(unpacked!.isFrontFace).toBe(true);
    expect(baryApprox(unpacked!.barycentrics, { x: 0.3, y: 0.4, z: 0.3 })).toBe(true);
    expect(baryApprox(unpacked!.barycentricsDx!, { x: 0.001, y: 0.002, z: -0.003 })).toBe(true);
    expect(baryApprox(unpacked!.barycentricsDy!, { x: 0.004, y: 0.005, z: -0.009 })).toBe(true);
  });

  it('reconstructs third barycentric coordinate (w = 1 - u - v)', () => {
    const packed = packVisibilityBuffer({
      meshInfoIndex: 0, triangleId: 0, isFrontFace: false,
      barycentrics: { x: 0.2, y: 0.3, z: 0.5 },
    });
    const unpacked = unpackVisibilityBuffer(packed.first, packed.second)!;
    expect(approxEq(unpacked.barycentrics.z, 0.5)).toBe(true);
  });

  it('reconstructs third derivative coordinate from -dx-dy', () => {
    const packed = packVisibilityBuffer({
      meshInfoIndex: 0, triangleId: 0, isFrontFace: false,
      barycentrics: { x: 0, y: 0, z: 1 },
      barycentricsDx: { x: 0.1, y: 0.2, z: 999 }, // z ignored on pack
      barycentricsDy: { x: 0.3, y: 0.4, z: 999 },
    });
    const unpacked = unpackVisibilityBuffer(packed.first, packed.second)!;
    // dx.z should be -dx.x - dx.y = -0.1 - 0.2 = -0.3
    expect(approxEq(unpacked.barycentricsDx!.z, -0.3)).toBe(true);
    // dy.z should be -dy.x - dy.y = -0.3 - 0.4 = -0.7
    expect(approxEq(unpacked.barycentricsDy!.z, -0.7)).toBe(true);
  });
});

describe('getMeshInfoIndex', () => {
  it('returns valid=true and meshInfoIndex for valid pixel', () => {
    const packed = packVisibilityBuffer({
      meshInfoIndex: 42, triangleId: 0, isFrontFace: false,
      barycentrics: { x: 0, y: 0, z: 1 },
    });
    const result = getMeshInfoIndex(packed.first[0]);
    expect(result.valid).toBe(true);
    expect(result.meshInfoIndex).toBe(42);
  });

  it('returns valid=false for empty pixel (-0.0f)', () => {
    const empty = uintAsFloat(0x80000000);
    const result = getMeshInfoIndex(empty);
    expect(result.valid).toBe(false);
    expect(result.meshInfoIndex).toBe(-1);
  });

  it('treats +0.0f as valid pixel with meshInfoIndex=0 (o3de convention)', () => {
    // +0.0f 表示 meshInfoIndex=0 + isFrontFace=false + 无 INVALID 标志,是有效像素
    // (调用方必须先用 -0.0f 初始化 visbuf,buildVisibilityBuffer 已做)
    const result = getMeshInfoIndex(0);
    expect(result.valid).toBe(true);
    expect(result.meshInfoIndex).toBe(0);
  });
});

describe('unpackVisibilityBuffer empty detection', () => {
  it('returns null for -0.0f empty pixel', () => {
    const first = [uintAsFloat(0x80000000), 0, 0, 0];
    const second = [0, 0, 0, 0];
    expect(unpackVisibilityBuffer(first, second)).toBeNull();
  });

  it('treats +0.0f (zero) as valid pixel with meshInfoIndex=0 (o3de convention)', () => {
    // +0.0f 表示 meshInfoIndex=0 + isFrontFace=false,是有效像素
    const first = [0, 0, 0, 0];
    const second = [0, 0, 0, 0];
    const result = unpackVisibilityBuffer(first, second);
    expect(result).not.toBeNull();
    expect(result!.meshInfoIndex).toBe(0);
    expect(result!.isFrontFace).toBe(false);
  });
});

// ── 重心坐标 ────────────────────────────────────────────────────

describe('computeBarycentric2D', () => {
  // 标准三角形:a=(0,0), b=(10,0), c=(0,10)
  it('returns (1,0,0) at vertex a', () => {
    const bary = computeBarycentric2D(0, 0, 0, 0, 10, 0, 0, 10);
    expect(baryApprox(bary, { x: 1, y: 0, z: 0 })).toBe(true);
  });
  it('returns (0,1,0) at vertex b', () => {
    const bary = computeBarycentric2D(10, 0, 0, 0, 10, 0, 0, 10);
    expect(baryApprox(bary, { x: 0, y: 1, z: 0 })).toBe(true);
  });
  it('returns (0,0,1) at vertex c', () => {
    const bary = computeBarycentric2D(0, 10, 0, 0, 10, 0, 0, 10);
    expect(baryApprox(bary, { x: 0, y: 0, z: 1 })).toBe(true);
  });
  it('returns (1/3,1/3,1/3) at centroid', () => {
    const bary = computeBarycentric2D(10 / 3, 10 / 3, 0, 0, 10, 0, 0, 10);
    expect(baryApprox(bary, { x: 1 / 3, y: 1 / 3, z: 1 / 3 })).toBe(true);
  });
  it('u+v+w = 1', () => {
    const bary = computeBarycentric2D(2, 3, 0, 0, 10, 0, 0, 10);
    expect(approxEq(bary.x + bary.y + bary.z, 1.0)).toBe(true);
  });
});

describe('edgeFunctionBarycentric', () => {
  it('detects point inside CCW triangle', () => {
    // a=(0,0), b=(10,0), c=(0,10) — CCW
    const result = edgeFunctionBarycentric(2, 2, 0, 0, 10, 0, 0, 10);
    expect(result.inside).toBe(true);
    expect(result.isFrontFace).toBe(true);
    expect(approxEq(result.bary.x + result.bary.y + result.bary.z, 1.0)).toBe(true);
  });

  it('detects point outside', () => {
    // 远离三角形
    const result = edgeFunctionBarycentric(20, 20, 0, 0, 10, 0, 0, 10);
    expect(result.inside).toBe(false);
  });

  it('detects point on edge (inside=true,包含边界)', () => {
    // 在 a-b 边上:y=0
    const result = edgeFunctionBarycentric(5, 0, 0, 0, 10, 0, 0, 10);
    expect(result.inside).toBe(true);
  });

  it('handles CW triangle (isFrontFace=false)', () => {
    // CW: a=(0,0), b=(0,10), c=(10,0)
    const result = edgeFunctionBarycentric(2, 2, 0, 0, 0, 10, 10, 0);
    expect(result.inside).toBe(true);
    expect(result.isFrontFace).toBe(false);
  });

  it('returns inside=false for degenerate triangle', () => {
    // 共线三点
    const result = edgeFunctionBarycentric(1, 1, 0, 0, 5, 5, 10, 10);
    expect(result.inside).toBe(false);
  });
});

// ── pixelOffset ─────────────────────────────────────────────────

describe('pixelOffset', () => {
  it('returns 0 for (0,0)', () => {
    expect(pixelOffset(0, 0, 10)).toBe(0);
  });
  it('returns 8 for (1,0)', () => {
    expect(pixelOffset(1, 0, 10)).toBe(8);
  });
  it('returns width*8 for (0,1)', () => {
    expect(pixelOffset(0, 1, 10)).toBe(80);
  });
  it('returns (y*width + x)*8', () => {
    expect(pixelOffset(3, 4, 10)).toBe((4 * 10 + 3) * 8);
  });
});

// ── rasterizeTriangle ───────────────────────────────────────────

describe('rasterizeTriangle', () => {
  it('covers all pixels inside triangle', () => {
    const width = 16, height = 16;
    const visbuf = new Float32Array(width * height * 8).fill(uintAsFloat(0x80000000));
    // 注意:fill 会把 -0 写入所有元素,但 0x80000000 用 uintAsFloat 得到的是 -0.0f
    // 然而其他位置也应该初始化为 -0.0f,这里用 buildVisibilityBuffer 更方便
    const depth = new Float32Array(width * height).fill(Infinity);
    const tri = makeCCWTriangle();
    // 三角形顶点在 (0,0),(10,0),(0,10),CCW
    const result = rasterizeTriangle(tri, visbuf, depth, width, height);

    // 三角形覆盖区域:x>=0, y>=0, x+y<=10
    // 像素中心 (0.5,0.5)..(9.5,9.5) 内满足 x+y<=10 的像素
    // 大致估算:覆盖 ~55 像素(三角形面积 50,但包含边界像素)
    expect(result.depthPassed).toBeGreaterThan(40);
    expect(result.depthPassed).toBeLessThan(80);
    expect(result.depthFailed).toBe(0);
  });

  it('writes meshInfoIndex and triangleId to covered pixels', () => {
    const width = 16, height = 16;
    const visbuf = new Float32Array(width * height * 8);
    // 初始化为空像素
    for (let i = 0; i < width * height; i++) {
      visbuf[i * 8] = uintAsFloat(0x80000000);
    }
    const depth = new Float32Array(width * height).fill(Infinity);
    const tri = makeCCWTriangle();
    rasterizeTriangle(tri, visbuf, depth, width, height);

    // 像素 (1,1) 应在三角形内
    const off = pixelOffset(1, 1, width);
    const raw = floatAsUint(visbuf[off]);
    expect(raw & MESHINFO_MASK).toBe(5);
    expect(raw & FRONTFACE_MASK).not.toBe(0); // isFrontFace=true
    expect(floatAsUint(visbuf[off + 1])).toBe(42); // triangleId
  });

  it('writes barycentrics (u, v) to first.zw', () => {
    const width = 16, height = 16;
    const visbuf = new Float32Array(width * height * 8);
    for (let i = 0; i < width * height; i++) {
      visbuf[i * 8] = uintAsFloat(0x80000000);
    }
    const depth = new Float32Array(width * height).fill(Infinity);
    const tri = makeCCWTriangle();
    rasterizeTriangle(tri, visbuf, depth, width, height);

    // 像素中心 (0.5, 0.5) 在三角形内
    // u 对应 a=(0,0):u = 1 - v - w
    // v 对应 b=(10,0):v = ((a.x-c.x)*(p.y-c.y) - (a.y-c.y)*(p.x-c.x)) / area2
    //   = ((0-0)*(0.5-10) - (0-10)*(0.5-0)) / 100 = (0 - (-10)*0.5) / 100 = 5/100 = 0.05
    // w 对应 c=(0,10):w = ((b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x)) / area2
    //   = (10*0.5 - 0*0.5) / 100 = 5/100 = 0.05
    // u = 1 - 0.05 - 0.05 = 0.9
    const off = pixelOffset(0, 0, width);
    const u = visbuf[off + 2];
    const v = visbuf[off + 3];
    expect(approxEq(u, 0.9, 1e-4)).toBe(true);
    expect(approxEq(v, 0.05, 1e-4)).toBe(true);
  });

  it('respects depthFunc="less" (closer pixel wins)', () => {
    const width = 8, height = 8;
    const visbuf = new Float32Array(width * height * 8);
    for (let i = 0; i < width * height; i++) {
      visbuf[i * 8] = uintAsFloat(0x80000000);
    }
    const depth = new Float32Array(width * height).fill(Infinity);

    // 第一个三角形:深度 0.5
    const tri1: VisibilityTriangle = {
      meshInfoIndex: 1, triangleId: 10, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.5, 0.5, 0.5],
    };
    rasterizeTriangle(tri1, visbuf, depth, width, height);

    // 第二个三角形:深度 0.7(更远,应被深度测试淘汰)
    const tri2: VisibilityTriangle = {
      meshInfoIndex: 2, triangleId: 20, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.7, 0.7, 0.7],
    };
    const result = rasterizeTriangle(tri2, visbuf, depth, width, height, { depthFunc: 'less' });

    // 应全部 depth fail
    expect(result.depthPassed).toBe(0);
    expect(result.depthFailed).toBeGreaterThan(0);

    // 像素 (1,1) 仍是 tri1
    const off = pixelOffset(1, 1, width);
    expect(floatAsUint(visbuf[off]) & MESHINFO_MASK).toBe(1);
    expect(floatAsUint(visbuf[off + 1])).toBe(10);
  });

  it('closer triangle overwrites farther (with depthFunc="less")', () => {
    const width = 8, height = 8;
    const visbuf = new Float32Array(width * height * 8);
    for (let i = 0; i < width * height; i++) {
      visbuf[i * 8] = uintAsFloat(0x80000000);
    }
    const depth = new Float32Array(width * height).fill(Infinity);

    const farTri: VisibilityTriangle = {
      meshInfoIndex: 1, triangleId: 10, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.7, 0.7, 0.7],
    };
    rasterizeTriangle(farTri, visbuf, depth, width, height);

    const nearTri: VisibilityTriangle = {
      meshInfoIndex: 2, triangleId: 20, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.3, 0.3, 0.3],
    };
    const result = rasterizeTriangle(nearTri, visbuf, depth, width, height, { depthFunc: 'less' });

    expect(result.depthPassed).toBeGreaterThan(0);

    // 像素 (1,1) 现在是 nearTri
    const off = pixelOffset(1, 1, width);
    expect(floatAsUint(visbuf[off]) & MESHINFO_MASK).toBe(2);
    expect(floatAsUint(visbuf[off + 1])).toBe(20);
  });

  it('applies depthBias', () => {
    const width = 4, height = 4;
    const visbuf = new Float32Array(width * height * 8);
    for (let i = 0; i < width * height; i++) {
      visbuf[i * 8] = uintAsFloat(0x80000000);
    }
    const depth = new Float32Array(width * height).fill(Infinity);

    // 先画 tri1 深度 0.5
    const tri1: VisibilityTriangle = {
      meshInfoIndex: 1, triangleId: 10, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }],
      depths: [0.5, 0.5, 0.5],
    };
    rasterizeTriangle(tri1, visbuf, depth, width, height);

    // 再画 tri2 深度 0.5(相同深度,less 测试应失败)
    const tri2: VisibilityTriangle = {
      meshInfoIndex: 2, triangleId: 20, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }],
      depths: [0.5, 0.5, 0.5],
    };
    const noBiasResult = rasterizeTriangle(tri2, visbuf, depth, width, height, { depthFunc: 'less' });
    expect(noBiasResult.depthPassed).toBe(0); // 0.5 < 0.5 false

    // 带 bias -0.1:0.5 - 0.1 = 0.4 < 0.5 true
    const biasedResult = rasterizeTriangle(tri2, visbuf, depth, width, height, {
      depthFunc: 'less', depthBias: -0.1,
    });
    expect(biasedResult.depthPassed).toBeGreaterThan(0);
  });

  it('writes derivatives when computeDerivatives=true', () => {
    const width = 16, height = 16;
    const visbuf = new Float32Array(width * height * 8);
    for (let i = 0; i < width * height; i++) {
      visbuf[i * 8] = uintAsFloat(0x80000000);
    }
    const depth = new Float32Array(width * height).fill(Infinity);
    const tri = makeCCWTriangle();
    rasterizeTriangle(tri, visbuf, depth, width, height, { computeDerivatives: true });

    // 三角形 (0,0)-(10,0)-(0,10) CCW
    // area2 = (10-0)*(10-0) - (0-0)*(0-0) = 100
    // dwdx = -(b.y-a.y)/area2 = -0/100 = 0
    // dvdx = (c.y-a.y)/area2 = 10/100 = 0.1
    // dudx = -dvdx - dwdx = -0.1
    const off = pixelOffset(1, 1, width);
    expect(approxEq(visbuf[off + 4], -0.1, 1e-4)).toBe(true); // dudx
    expect(approxEq(visbuf[off + 5], 0.1, 1e-4)).toBe(true);  // dvdx
  });

  it('skips degenerate (zero-area) triangle', () => {
    const width = 8, height = 8;
    const visbuf = new Float32Array(width * height * 8);
    const depth = new Float32Array(width * height).fill(Infinity);
    const tri: VisibilityTriangle = {
      meshInfoIndex: 0, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }], // 共线
      depths: [0.5, 0.5, 0.5],
    };
    const result = rasterizeTriangle(tri, visbuf, depth, width, height);
    expect(result.depthPassed).toBe(0);
  });

  it('skips triangle entirely outside viewport', () => {
    const width = 8, height = 8;
    const visbuf = new Float32Array(width * height * 8);
    const depth = new Float32Array(width * height).fill(Infinity);
    const tri: VisibilityTriangle = {
      meshInfoIndex: 0, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 100, y: 110 }],
      depths: [0.5, 0.5, 0.5],
    };
    const result = rasterizeTriangle(tri, visbuf, depth, width, height);
    expect(result.depthPassed).toBe(0);
  });
});

// ── buildVisibilityBuffer ────────────────────────────────────────

describe('buildVisibilityBuffer', () => {
  it('initializes visbuf as empty (-0.0f)', () => {
    const result = buildVisibilityBuffer([], { width: 4, height: 4 });
    // 所有像素应为空
    for (let i = 0; i < 4 * 4; i++) {
      const raw = floatAsUint(result.data[i * 8]);
      expect(raw).toBe(0x80000000);
    }
    expect(result.stats.coverage).toBe(0);
    expect(result.stats.emptyPixels).toBe(16);
  });

  it('rasterizes single triangle and reports coverage', () => {
    const tri: VisibilityTriangle = {
      meshInfoIndex: 1, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.5, 0.5, 0.5],
    };
    const result = buildVisibilityBuffer([tri], { width: 16, height: 16 });
    expect(result.stats.triangleCount).toBe(1);
    expect(result.stats.culledTriangles).toBe(0);
    expect(result.stats.depthPassedFragments).toBeGreaterThan(20);
    expect(result.stats.coverage).toBeGreaterThan(0);
    expect(result.stats.coverage).toBeLessThan(1);
  });

  it('culles triangles fully outside viewport', () => {
    const inside: VisibilityTriangle = {
      meshInfoIndex: 1, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.5, 0.5, 0.5],
    };
    const outside: VisibilityTriangle = {
      meshInfoIndex: 2, triangleId: 1, isFrontFace: true,
      screenPositions: [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 100, y: 110 }],
      depths: [0.5, 0.5, 0.5],
    };
    const result = buildVisibilityBuffer([inside, outside], { width: 16, height: 16 });
    expect(result.stats.culledTriangles).toBe(1);
  });

  it('returns width/height from options', () => {
    const result = buildVisibilityBuffer([], { width: 32, height: 48 });
    expect(result.width).toBe(32);
    expect(result.height).toBe(48);
  });

  it('depth buffer is filled where geometry exists', () => {
    const tri: VisibilityTriangle = {
      meshInfoIndex: 1, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.3, 0.3, 0.3],
    };
    const result = buildVisibilityBuffer([tri], { width: 16, height: 16 });
    // 像素 (1,1) 在三角形内,depth 应为 ~0.3
    const idx = 1 * 16 + 1;
    expect(result.depth[idx]).toBeLessThan(0.35);
    // 像素 (15,15) 在三角形外,depth 应为 Infinity
    const idxOut = 15 * 16 + 15;
    expect(result.depth[idxOut]).toBe(Infinity);
  });
});

// ── decompressPixel ─────────────────────────────────────────────

describe('decompressPixel', () => {
  function makeMeshInfoTable(): MeshInfo[] {
    // 简单三角形:vertices = [(0,0,0), (1,0,0), (0,1,0)], indices = [0,1,2]
    const mesh: MeshInfo = {
      index: 1,
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      vertexStride: 3,
    };
    const table: MeshInfo[] = [];
    table[1] = mesh;
    return table;
  }

  it('returns isEmpty=true for empty pixel', () => {
    const result = buildVisibilityBuffer([], { width: 8, height: 8 });
    const pixel = decompressPixel(result, 0, 0, makeMeshInfoTable());
    expect(pixel.isEmpty).toBe(true);
    expect(pixel.meshInfo).toBeNull();
  });

  it('returns mesh info and barycentrics for valid pixel', () => {
    const tri: VisibilityTriangle = {
      meshInfoIndex: 1, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.5, 0.5, 0.5],
    };
    const result = buildVisibilityBuffer([tri], { width: 16, height: 16 });
    const pixel = decompressPixel(result, 1, 1, makeMeshInfoTable());
    expect(pixel.isEmpty).toBe(false);
    expect(pixel.meshInfo).not.toBeNull();
    expect(pixel.meshInfo!.index).toBe(1);
    expect(pixel.triangleId).toBe(0);
    expect(pixel.isFrontFace).toBe(true);
    // 重心坐标和为 1
    const sum = pixel.barycentrics.x + pixel.barycentrics.y + pixel.barycentrics.z;
    expect(approxEq(sum, 1.0)).toBe(true);
  });

  it('accepts Map for meshInfoTable', () => {
    const tri: VisibilityTriangle = {
      meshInfoIndex: 5, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.5, 0.5, 0.5],
    };
    const result = buildVisibilityBuffer([tri], { width: 16, height: 16 });
    const map = new Map<number, MeshInfo>();
    map.set(5, {
      index: 5,
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      vertexStride: 3,
    });
    const pixel = decompressPixel(result, 1, 1, map);
    expect(pixel.isEmpty).toBe(false);
    expect(pixel.meshInfo).not.toBeNull();
    expect(pixel.meshInfo!.index).toBe(5);
  });

  it('returns meshInfo=null when meshInfoIndex not in table', () => {
    const tri: VisibilityTriangle = {
      meshInfoIndex: 99, triangleId: 0, isFrontFace: true,
      screenPositions: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
      depths: [0.5, 0.5, 0.5],
    };
    const result = buildVisibilityBuffer([tri], { width: 16, height: 16 });
    const pixel = decompressPixel(result, 1, 1, []);
    expect(pixel.isEmpty).toBe(false); // 有几何,但 meshInfo 查不到
    expect(pixel.meshInfo).toBeNull();
  });
});

// ── interpolateAttributes ───────────────────────────────────────

describe('interpolateAttributes', () => {
  it('interpolates scalar attributes', () => {
    const attrs: [Float32Array, Float32Array, Float32Array] = [
      new Float32Array([0]),
      new Float32Array([10]),
      new Float32Array([20]),
    ];
    const result = interpolateAttributes(attrs, { x: 0.5, y: 0.3, z: 0.2 });
    // 0*0.5 + 10*0.3 + 20*0.2 = 0 + 3 + 4 = 7
    expect(approxEq(result[0], 7)).toBe(true);
  });

  it('interpolates vec3 attributes', () => {
    const attrs: [Float32Array, Float32Array, Float32Array] = [
      new Float32Array([0, 0, 0]),
      new Float32Array([10, 20, 30]),
      new Float32Array([100, 200, 300]),
    ];
    const result = interpolateAttributes(attrs, { x: 0.1, y: 0.2, z: 0.7 });
    expect(approxEq(result[0], 0 * 0.1 + 10 * 0.2 + 100 * 0.7)).toBe(true); // 72
    expect(approxEq(result[1], 0 * 0.1 + 20 * 0.2 + 200 * 0.7)).toBe(true); // 144
    expect(approxEq(result[2], 0 * 0.1 + 30 * 0.2 + 300 * 0.7)).toBe(true); // 216
  });

  it('returns vertex a value when bary=(1,0,0)', () => {
    const attrs: [Float32Array, Float32Array, Float32Array] = [
      new Float32Array([5, 6, 7]),
      new Float32Array([10, 20, 30]),
      new Float32Array([100, 200, 300]),
    ];
    const result = interpolateAttributes(attrs, { x: 1, y: 0, z: 0 });
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(6);
    expect(result[2]).toBe(7);
  });
});

// ── fetchTriangleVertices ───────────────────────────────────────

describe('fetchTriangleVertices', () => {
  it('returns three vertices for valid triangleId', () => {
    const mesh: MeshInfo = {
      index: 0,
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      vertexStride: 3,
    };
    const tri = fetchTriangleVertices(mesh, 0);
    expect(tri).not.toBeNull();
    expect(tri![0][0]).toBe(0);
    expect(tri![1][0]).toBe(1);
    expect(tri![2][1]).toBe(1);

    const tri1 = fetchTriangleVertices(mesh, 1);
    expect(tri1).not.toBeNull();
    expect(tri1![0][0]).toBe(1); // vertex 1
    expect(tri1![1][0]).toBe(1); // vertex 3
    expect(tri1![2][1]).toBe(1); // vertex 2
  });

  it('returns null for out-of-range triangleId', () => {
    const mesh: MeshInfo = {
      index: 0,
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      vertexStride: 3,
    };
    expect(fetchTriangleVertices(mesh, 1)).toBeNull();
    expect(fetchTriangleVertices(mesh, -1)).toBeNull();
  });

  it('handles larger vertex stride (e.g. position+uv)', () => {
    const mesh: MeshInfo = {
      index: 0,
      // [x, y, z, u, v] per vertex
      vertices: new Float32Array([
        0, 0, 0, 0, 0,
        1, 0, 0, 1, 0,
        0, 1, 0, 0, 1,
      ]),
      indices: new Uint32Array([0, 1, 2]),
      vertexStride: 5,
      uvOffset: 3,
    };
    const tri = fetchTriangleVertices(mesh, 0);
    expect(tri).not.toBeNull();
    expect(tri![0].length).toBe(3);
    expect(tri![1][0]).toBe(1); // x of vertex 1
  });
});

// ── fetchInterpolatedPosition ───────────────────────────────────

describe('fetchInterpolatedPosition', () => {
  it('returns interpolated position', () => {
    const mesh: MeshInfo = {
      index: 0,
      vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
      indices: new Uint32Array([0, 1, 2]),
      vertexStride: 3,
    };
    // 重心 (0.5, 0.3, 0.2) → (0*0.5 + 10*0.3 + 0*0.2, 0*0.5 + 0*0.3 + 10*0.2, 0)
    //                       = (3, 2, 0)
    const pos = fetchInterpolatedPosition(mesh, 0, { x: 0.5, y: 0.3, z: 0.2 });
    expect(pos).not.toBeNull();
    expect(approxEq(pos![0], 3)).toBe(true);
    expect(approxEq(pos![1], 2)).toBe(true);
    expect(approxEq(pos![2], 0)).toBe(true);
  });

  it('returns null for invalid triangleId', () => {
    const mesh: MeshInfo = {
      index: 0,
      vertices: new Float32Array([0, 0, 0]),
      indices: new Uint32Array([0]),
      vertexStride: 3,
    };
    expect(fetchInterpolatedPosition(mesh, 0, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});

// ── GLSL chunks ─────────────────────────────────────────────────

describe('GLSL chunks', () => {
  it('VISIBILITY_BUFFER_PACK_UTILITY contains packVisibilityBuffer function', () => {
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('void packVisibilityBuffer(');
  });
  it('VISIBILITY_BUFFER_PACK_UTILITY contains unpackVisibilityBuffer function', () => {
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('bool unpackVisibilityBuffer(');
  });
  it('VISIBILITY_BUFFER_PACK_UTILITY contains getMeshInfoIndex function', () => {
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('bool getMeshInfoIndex(');
  });
  it('VISIBILITY_BUFFER_PACK_UTILITY defines bit constants', () => {
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('VB_MESHINFO_BITS');
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('VB_MESHINFO_INVALID_MASK');
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('VB_FRONTFACE_MASK');
  });
  it('VISIBILITY_BUFFER_PACK_UTILITY uses uintBitsToFloat / floatBitsToUint', () => {
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('uintBitsToFloat');
    expect(VISIBILITY_BUFFER_PACK_UTILITY).toContain('floatBitsToUint');
  });

  it('VISIBILITY_BUFFER_PACK_VERT has #version 300 es', () => {
    expect(VISIBILITY_BUFFER_PACK_VERT.startsWith('#version 300 es')).toBe(true);
  });
  it('VISIBILITY_BUFFER_PACK_VERT declares u_viewProjection uniform', () => {
    expect(VISIBILITY_BUFFER_PACK_VERT).toContain('uniform mat4 u_viewProjection;');
  });
  it('VISIBILITY_BUFFER_PACK_VERT outputs v_meshInfoIndex and v_triangleId', () => {
    expect(VISIBILITY_BUFFER_PACK_VERT).toContain('flat out int  v_meshInfoIndex');
    expect(VISIBILITY_BUFFER_PACK_VERT).toContain('flat out uint v_triangleId');
  });

  it('VISIBILITY_BUFFER_PACK_FRAG enables barycentric extension', () => {
    expect(VISIBILITY_BUFFER_PACK_FRAG).toContain('#extension GL_EXT_fragment_shader_barycentric : require');
  });
  it('VISIBILITY_BUFFER_PACK_FRAG outputs two RGBA32F targets', () => {
    expect(VISIBILITY_BUFFER_PACK_FRAG).toContain('layout(location = 0) out vec4 outVisbufFirst');
    expect(VISIBILITY_BUFFER_PACK_FRAG).toContain('layout(location = 1) out vec4 outVisbufSecond');
  });
  it('VISIBILITY_BUFFER_PACK_FRAG calls packVisibilityBuffer', () => {
    expect(VISIBILITY_BUFFER_PACK_FRAG).toContain('packVisibilityBuffer(');
  });

  it('VISIBILITY_BUFFER_UNPACK_UTILITY is same as PACK_UTILITY', () => {
    expect(VISIBILITY_BUFFER_UNPACK_UTILITY).toBe(VISIBILITY_BUFFER_PACK_UTILITY);
  });
});

// ── 集成测试:完整 visbuf → decompress → shading 流程 ────────────

describe('integration: full visbuf pipeline', () => {
  it('rasterizes triangle and decompresses for shading', () => {
    // 简单 mesh:三角形 (0,0,0)-(10,0,0)-(0,10,0)
    const mesh: MeshInfo = {
      index: 7,
      vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
      indices: new Uint32Array([0, 1, 2]),
      vertexStride: 3,
    };
    const meshTable: MeshInfo[] = [];
    meshTable[7] = mesh;

    // 屏幕空间三角形覆盖 (1,1)..(7,7)
    const tri: VisibilityTriangle = {
      meshInfoIndex: 7,
      triangleId: 0,
      screenPositions: [
        { x: 1, y: 1 },
        { x: 7, y: 1 },
        { x: 1, y: 7 },
      ],
      depths: [0.4, 0.4, 0.4],
      isFrontFace: true,
    };

    const result = buildVisibilityBuffer([tri], { width: 16, height: 16 });
    expect(result.stats.coverage).toBeGreaterThan(0);

    // 取像素 (3,3) 解压
    const pixel = decompressPixel(result, 3, 3, meshTable);
    expect(pixel.isEmpty).toBe(false);
    expect(pixel.meshInfo!.index).toBe(7);

    // 用重心坐标插值顶点位置
    const pos = fetchInterpolatedPosition(mesh, pixel.triangleId, pixel.barycentrics);
    expect(pos).not.toBeNull();
    // 像素 (3,3) 在三角形 (1,1)-(7,1)-(1,7) 内,模型空间位置应在 (0,0,0)-(10,0,0)-(0,10,0) 内
    // 检查插值位置 x>=0, y>=0, z=0
    expect(pos![0]).toBeGreaterThanOrEqual(0);
    expect(pos![1]).toBeGreaterThanOrEqual(0);
    expect(approxEq(pos![2], 0, 1e-4)).toBe(true);
  });
});
