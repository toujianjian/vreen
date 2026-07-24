// vreenPublish 测试 — Phase 4.3
//
// 验证:
//   • computeShaderHashes: PBR_VERT/PBR_FRAG 的 sha256,确定性
//   • generateLodLevels: 顶点聚类抽稀,三角形数递减
//   • generateMipmapChain: box filter,尺寸减半
//   • publishVreenPackage: 端到端,LOD 资产注入,报告正确
//   • extractFirstMeshFromGlbSync: GLB 二进制解析(最小 GLB 构造)
import { describe, it, expect } from 'vitest';
import {
  computeShaderHashes,
  generateLodLevels,
  generateMipmapChain,
  publishVreenPackage,
} from './vreenPublish';
import { BufferGeometry } from '../engine/Core/BufferGeometry';
import { BufferAttribute } from '../engine/Core/BufferAttribute';
import { unpackVreenPackage, packVreenPackage } from './vreenPack';
import type { UnpackedVreen } from './vreenPack';

// ── shader 哈希 ────────────────────────────────────────────────

describe('vreenPublish — computeShaderHashes', () => {
  it('返回 PBR_VERT 和 PBR_FRAG 的 sha256', () => {
    const hashes = computeShaderHashes();
    expect(hashes.PBR_VERT).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes.PBR_FRAG).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同输入产生相同哈希(确定性)', () => {
    const h1 = computeShaderHashes();
    const h2 = computeShaderHashes();
    expect(h1).toEqual(h2);
  });

  it('VERT 和 FRAG 哈希不同', () => {
    const hashes = computeShaderHashes();
    expect(hashes.PBR_VERT).not.toBe(hashes.PBR_FRAG);
  });
});

// ── LOD 生成 ───────────────────────────────────────────────────

/** 构造一个简单的网格平面 geometry:grid×grid 个四边形。 */
function makePlaneGeometry(grid: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= grid; y++) {
    for (let x = 0; x <= grid; x++) {
      positions.push(x, y, 0);
    }
  }
  const stride = grid + 1;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = y * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

describe('vreenPublish — generateLodLevels', () => {
  it('对密集网格生成 LOD,顶点数递减', () => {
    const geom = makePlaneGeometry(10); // 11×11 = 121 vertices, 200 triangles
    const lods = generateLodLevels(geom, 2);
    expect(lods.length).toBe(2);

    const originalCount = geom.getAttribute('position')!.count;
    const lod1Count = lods[0].getAttribute('position')!.count;
    const lod2Count = lods[1].getAttribute('position')!.count;

    expect(lod1Count).toBeLessThan(originalCount);
    expect(lod2Count).toBeLessThan(lod1Count);
  });

  it('levels=0 返回空数组', () => {
    const geom = makePlaneGeometry(5);
    expect(generateLodLevels(geom, 0)).toHaveLength(0);
  });

  it('LOD geometry 有 position 和 index 属性', () => {
    const geom = makePlaneGeometry(8);
    const lods = generateLodLevels(geom, 1);
    expect(lods).toHaveLength(1);
    expect(lods[0].getAttribute('position')).toBeDefined();
    expect(lods[0].index).not.toBeNull();
  });

  it('LOD 有法线(computeVertexNormals 被调用)', () => {
    const geom = makePlaneGeometry(6);
    const lods = generateLodLevels(geom, 1);
    expect(lods[0].getAttribute('normal')).toBeDefined();
  });

  it('退化三角形被丢弃(3 顶点落到同一格子)', () => {
    // 所有点都在同一位置 → 所有三角形退化 → LOD 为空
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]), 3));
    g.setIndex([0, 1, 2]);
    const lods = generateLodLevels(g, 1);
    expect(lods).toHaveLength(0);
  });
});

// ── mipmap 链 ──────────────────────────────────────────────────

describe('vreenPublish — generateMipmapChain', () => {
  it('4×4 纹理生成 2 级 mipmap (2×2 + 1×1)', () => {
    const rgba = new Uint8Array(4 * 4 * 4); // 全黑
    const chain = generateMipmapChain(4, 4, rgba);
    expect(chain).toHaveLength(2);
    expect(chain[0].width).toBe(2);
    expect(chain[0].height).toBe(2);
    expect(chain[1].width).toBe(1);
    expect(chain[1].height).toBe(1);
  });

  it('1×1 纹理不生成 mipmap', () => {
    const rgba = new Uint8Array(4);
    expect(generateMipmapChain(1, 1, rgba)).toHaveLength(0);
  });

  it('box filter 正确平均 2×2 像素', () => {
    // 2×2 纹理:左上=255, 右上=0, 左下=0, 右下=0
    const rgba = new Uint8Array(16);
    rgba[0] = 255; // 左上 R
    const chain = generateMipmapChain(2, 2, rgba);
    expect(chain).toHaveLength(1);
    expect(chain[0].width).toBe(1);
    // 平均 = (255 + 0 + 0 + 0) / 4 = 63
    expect(chain[0].data[0]).toBe(63);
  });

  it('非正方形纹理 (4×2) 生成 mipmap', () => {
    const rgba = new Uint8Array(4 * 2 * 4);
    const chain = generateMipmapChain(4, 2, rgba);
    expect(chain).toHaveLength(2);
    expect(chain[0].width).toBe(2);
    expect(chain[0].height).toBe(1);
    expect(chain[1].width).toBe(1);
    expect(chain[1].height).toBe(1);
  });

  it('数据过短抛错', () => {
    const short = new Uint8Array(10);
    expect(() => generateMipmapChain(4, 4, short)).toThrow(/too short/);
  });
});

// ── 端到端发布 ─────────────────────────────────────────────────

/** 构造最小 GLB 字节(含 1 个 mesh primitive,三角形 POSITION + index)。 */
function buildMinimalGlb(): Uint8Array {
  // glTF JSON
  const gltfJson = {
    asset: { version: '2.0', generator: 'test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', byteOffset: 0 },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR', byteOffset: 0 },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 }, // 3 verts × 3 floats × 4
      { buffer: 0, byteOffset: 36, byteLength: 6 },  // 3 indices × 2 bytes
    ],
    buffers: [{ byteLength: 42 }],
  };

  // BIN: 3 positions (36 bytes) + 3 uint16 indices (6 bytes) = 42 bytes
  const bin = new Uint8Array(42);
  const binDv = new DataView(bin.buffer);
  // positions: (0,0,0), (1,0,0), (0,1,0)
  binDv.setFloat32(0, 0, true);
  binDv.setFloat32(4, 0, true);
  binDv.setFloat32(8, 0, true);
  binDv.setFloat32(12, 1, true);
  binDv.setFloat32(16, 0, true);
  binDv.setFloat32(20, 0, true);
  binDv.setFloat32(24, 0, true);
  binDv.setFloat32(28, 1, true);
  binDv.setFloat32(32, 0, true);
  // indices: 0, 1, 2
  binDv.setUint16(36, 0, true);
  binDv.setUint16(38, 1, true);
  binDv.setUint16(40, 2, true);

  return buildGlbFile(gltfJson, bin);
}

/** 把 JSON + BIN 组装成 GLB 二进制。 */
function buildGlbFile(json: unknown, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  // JSON chunk 需要空格 padding 到 4 字节对齐
  const jsonPadded = padTo4(jsonBytes, 0x20);
  // BIN chunk 也需要 4 字节对齐
  const binPadded = padTo4(bin, 0x00);

  // GLB: 12 (header) + 8 (json chunk header) + jsonPadded + 8 (bin chunk header) + binPadded
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = new Uint8Array(totalLength);
  const dv = new DataView(out.buffer);

  // header
  dv.setUint32(0, 0x46546C67, true); // "glTF"
  dv.setUint32(4, 2, true); // version
  dv.setUint32(8, totalLength, true);

  // JSON chunk
  let off = 12;
  dv.setUint32(off, jsonPadded.length, true);
  dv.setUint32(off + 4, 0x4E4F534A, true); // "JSON"
  off += 8;
  out.set(jsonPadded, off);
  off += jsonPadded.length;

  // BIN chunk
  dv.setUint32(off, binPadded.length, true);
  dv.setUint32(off + 4, 0x004E4942, true); // "BIN\0"
  off += 8;
  out.set(binPadded, off);

  return out;
}

function padTo4(bytes: Uint8Array, fill: number): Uint8Array {
  const rem = bytes.length % 4;
  if (rem === 0) return bytes;
  const padded = new Uint8Array(bytes.length + (4 - rem));
  padded.set(bytes);
  for (let i = bytes.length; i < padded.length; i++) padded[i] = fill;
  return padded;
}

/** 构造一个带 model 资产的 UnpackedVreen(用于 publish 测试)。 */
function makeUnpackedWithModel(glbBytes: Uint8Array): UnpackedVreen {
  const packed = packVreenPackage({
    name: 'test-pkg',
    assetName: 'test-model.glb',
    assets: [
      { id: 'model-1', kind: 'model', data: glbBytes, originalName: 'test.glb' },
    ],
    primaryModelId: 'model-1',
  });
  // unpackVreenPackage 是 async,但我们同步构造 — 直接返回 UnpackedVreen 结构
  return {
    manifest: packed.manifest,
    scene: {
      version: '0.2.1' as const,
      camera: {},
      animation: { speed: 1 },
      environment: {},
      postFX: {},
      materials: {},
    },
    assets: new Map([['model-1', glbBytes]]),
    legacy: {} as never,
    world: null,
    scripts: [],
  };
}

describe('vreenPublish — publishVreenPackage', () => {
  it('对空包:不生成 LOD,报告正确', () => {
    const empty: UnpackedVreen = {
      manifest: {
        version: '0.2.1' as const,
        exportedAt: '2026-01-01T00:00:00Z',
        name: 'empty',
        assetName: 'empty',
        assets: [],
        primaryModelId: null,
        generator: 'test',
      },
      scene: {
        version: '0.2.1' as const,
        camera: {},
        animation: { speed: 1 },
        environment: {},
        postFX: {},
        materials: {},
      },
      assets: new Map(),
      legacy: {} as never,
      world: null,
      scripts: [],
    };
    const result = publishVreenPackage(empty, { lods: 2, shaderHashes: true });
    expect(result.report.lodLevels).toBe(0);
    expect(result.report.processed).toHaveLength(0);
    expect(result.report.shaderHashes).toBeDefined();
    expect(result.report.shaderHashes!.PBR_VERT).toMatch(/^[0-9a-f]{64}$/);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('shaderHashes=false 时不生成哈希', () => {
    const empty: UnpackedVreen = {
      manifest: {
        version: '0.2.1' as const,
        exportedAt: '2026-01-01T00:00:00Z',
        name: 'empty',
        assetName: 'empty',
        assets: [],
        primaryModelId: null,
        generator: 'test',
      },
      scene: {
        version: '0.2.1' as const,
        camera: {},
        animation: { speed: 1 },
        environment: {},
        postFX: {},
        materials: {},
      },
      assets: new Map(),
      legacy: {} as never,
      world: null,
      scripts: [],
    };
    const result = publishVreenPackage(empty, { shaderHashes: false });
    expect(result.report.shaderHashes).toBeUndefined();
  });

  it('对 GLB model 资产:尝试生成 LOD(三角形太少可能为空,但不应报错)', () => {
    const glb = buildMinimalGlb();
    const unpacked = makeUnpackedWithModel(glb);
    // 3 顶点 1 三角形的 GLB 太小,LOD 可能生成 0 级(所有三角形退化)
    const result = publishVreenPackage(unpacked, { lods: 2, shaderHashes: true });
    expect(result.report.processed).toHaveLength(1);
    expect(result.report.processed[0].id).toBe('model-1');
    // 不抛错就算通过
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('压缩比 > 0', () => {
    const empty: UnpackedVreen = {
      manifest: {
        version: '0.2.1' as const,
        exportedAt: '2026-01-01T00:00:00Z',
        name: 'empty',
        assetName: 'empty',
        assets: [],
        primaryModelId: null,
        generator: 'test',
      },
      scene: {
        version: '0.2.1' as const,
        camera: {},
        animation: { speed: 1 },
        environment: {},
        postFX: {},
        materials: {},
      },
      assets: new Map(),
      legacy: {} as never,
      world: null,
      scripts: [],
    };
    const result = publishVreenPackage(empty);
    expect(result.report.compressionRatio).toBeGreaterThan(0);
  });

  it('发布的包可被 unpackVreenPackage 正确解包', async () => {
    const glb = buildMinimalGlb();
    const unpacked = makeUnpackedWithModel(glb);
    const result = publishVreenPackage(unpacked, { lods: 0, shaderHashes: true });
    const repacked = await unpackVreenPackage(result.bytes);
    expect(repacked.manifest.name).toBe('test-pkg');
    expect(repacked.assets.size).toBeGreaterThanOrEqual(1);
    expect(repacked.assets.has('model-1')).toBe(true);
  });
});

// ── GLB 同步提取器 ─────────────────────────────────────────────

describe('vreenPublish — GLB 提取(通过 publishVreenPackage 间接验证)', () => {
  it('大网格 GLB 能生成有效 LOD', () => {
    // 构造 10×10 网格 GLB(121 顶点, 200 三角形)
    const glb = buildLargeGridGlb(10);
    const unpacked = makeUnpackedWithModel(glb);
    const result = publishVreenPackage(unpacked, { lods: 2, shaderHashes: false });
    // 应该至少生成 1 级 LOD
    expect(result.report.lodLevels).toBeGreaterThan(0);
    // LOD 资产被注入
    const lodAssetCount = result.manifest.assets.filter((a) => a.meta?.['lod'] === true).length;
    expect(lodAssetCount).toBeGreaterThan(0);
  });
});

/** 构造大网格 GLB(grid×grid 个四边形)。 */
function buildLargeGridGlb(grid: number): Uint8Array {
  const stride = grid + 1;
  const vertexCount = stride * stride;
  const positions = new Float32Array(vertexCount * 3);
  for (let y = 0; y <= grid; y++) {
    for (let x = 0; x <= grid; x++) {
      const i = (y * stride + x) * 3;
      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = 0;
    }
  }

  const triCount = grid * grid * 2;
  const indices = new Uint16Array(triCount * 3);
  let idxOff = 0;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = y * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[idxOff++] = a;
      indices[idxOff++] = b;
      indices[idxOff++] = c;
      indices[idxOff++] = b;
      indices[idxOff++] = d;
      indices[idxOff++] = c;
    }
  }

  const binByteLen = positions.byteLength + indices.byteLength;
  const gltfJson = {
    asset: { version: '2.0', generator: 'test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', byteOffset: 0 },
      { bufferView: 1, componentType: 5123, count: triCount * 3, type: 'SCALAR', byteOffset: 0 },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
    ],
    buffers: [{ byteLength: binByteLen }],
  };

  const bin = new Uint8Array(binByteLen);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);

  return buildGlbFile(gltfJson, bin);
}
