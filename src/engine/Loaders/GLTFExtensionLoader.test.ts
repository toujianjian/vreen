// GLTFExtensionLoader 单元测试。
// 验证扩展注册 / DRACO/KTX2 注入 / 缓存 / 细粒度 parse* API。

import { describe, it, expect } from 'vitest';
import {
  GLTFExtensionLoader,
  type GLTFJson,
  type GLTFNode,
  type GLTFMesh,
  type GLTFMaterial,
  type GLTFAccessor,
  type GLTFBufferView,
  type GLTFExtensionHandler,
} from './GLTFExtensionLoader';

/**
 * 构造一个最小可解析的 GLB 二进制 (单 mesh / 单 triangle / position+indices)。
 * 复用 GLBLoader.test.ts 中的构造逻辑,但内联在此避免跨测试文件依赖。
 */
function makeMinimalGLB(): ArrayBuffer {
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'TestNode' }],
    meshes: [{
      name: 'TestMesh',
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        material: 0,
      }],
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', max: [1, 1, 0], min: [0, 0, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 42 }],
    materials: [{ name: 'TestMaterial', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
  };
  const jsonStr = JSON.stringify(json);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);

  // BIN: 3 floats × 3 + 3 u16 indices
  const binData = new Uint8Array(42);
  const dv = new DataView(binData.buffer);
  dv.setFloat32(0, 0, true);  dv.setFloat32(4, 0, true);  dv.setFloat32(8, 0, true);
  dv.setFloat32(12, 1, true); dv.setFloat32(16, 0, true); dv.setFloat32(20, 0, true);
  dv.setFloat32(24, 0, true); dv.setFloat32(28, 1, true); dv.setFloat32(32, 0, true);
  dv.setUint16(36, 0, true); dv.setUint16(38, 1, true); dv.setUint16(40, 2, true);

  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLen = 8 + jsonBytes.length + jsonPad;
  const binChunkLen = 8 + 42;
  const totalLen = 12 + jsonChunkLen + binChunkLen;

  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  let off = 0;
  view.setUint32(off, 0x46546C67, true); off += 4;
  view.setUint32(off, 2, true); off += 4;
  view.setUint32(off, totalLen, true); off += 4;
  view.setUint32(off, jsonBytes.length + jsonPad, true); off += 4;
  view.setUint32(off, 0x4E4F534A, true); off += 4;
  new Uint8Array(buf, off, jsonBytes.length).set(jsonBytes);
  off += jsonBytes.length + jsonPad;
  view.setUint32(off, 42, true); off += 4;
  view.setUint32(off, 0x004E4942, true); off += 4;
  new Uint8Array(buf, off, 42).set(binData);
  return buf;
}

describe('GLTFExtensionLoader', () => {
  describe('constructor & defaults', () => {
    it('constructs with default state', () => {
      const loader = new GLTFExtensionLoader();
      expect(loader.format).toBe('gltf');
      expect(loader.dracoSupported).toBe(false);
      expect(loader.ktx2Supported).toBe(false);
      expect(loader.extensionHandlers.size).toBe(0);
      expect(loader.loadedScenes.size).toBe(0);
    });
  });

  describe('extension registration', () => {
    it('registerExtension adds to extensionHandlers', () => {
      const loader = new GLTFExtensionLoader();
      const handler: GLTFExtensionHandler = { name: 'KHR_test' };
      loader.registerExtension('KHR_test', handler);
      expect(loader.hasExtension('KHR_test')).toBe(true);
      expect(loader.extensionHandlers.size).toBe(1);
    });

    it('registerExtension overwrites same-name extension', () => {
      const loader = new GLTFExtensionLoader();
      const h1: GLTFExtensionHandler = { name: 'KHR_test' };
      const h2: GLTFExtensionHandler = { name: 'KHR_test' };
      loader.registerExtension('KHR_test', h1);
      loader.registerExtension('KHR_test', h2);
      expect(loader.extensionHandlers.size).toBe(1);
      expect(loader.extensionHandlers.get('KHR_test')).toBe(h2);
    });

    it('unregisterExtension removes the handler', () => {
      const loader = new GLTFExtensionLoader();
      loader.registerExtension('KHR_test', { name: 'KHR_test' });
      expect(loader.hasExtension('KHR_test')).toBe(true);
      loader.unregisterExtension('KHR_test');
      expect(loader.hasExtension('KHR_test')).toBe(false);
    });

    it('unregisterExtension calls handler.dispose when present', () => {
      const loader = new GLTFExtensionLoader();
      let disposed = false;
      loader.registerExtension('KHR_test', {
        name: 'KHR_test',
        dispose: () => { disposed = true; },
      });
      loader.unregisterExtension('KHR_test');
      expect(disposed).toBe(true);
    });

    it('is chainable', () => {
      const loader = new GLTFExtensionLoader();
      const ret = loader.registerExtension('a', { name: 'a' });
      expect(ret).toBe(loader);
    });
  });

  describe('extension query helpers', () => {
    it('isExtensionUsed checks extensionsUsed', () => {
      const loader = new GLTFExtensionLoader();
      const json: GLTFJson = { asset: { version: '2.0' }, extensionsUsed: ['KHR_test'] };
      expect(loader.isExtensionUsed(json, 'KHR_test')).toBe(true);
      expect(loader.isExtensionUsed(json, 'KHR_other')).toBe(false);
    });

    it('isExtensionUsed handles missing extensionsUsed', () => {
      const loader = new GLTFExtensionLoader();
      const json: GLTFJson = { asset: { version: '2.0' } };
      expect(loader.isExtensionUsed(json, 'KHR_test')).toBe(false);
    });

    it('isExtensionRequired checks extensionsRequired', () => {
      const loader = new GLTFExtensionLoader();
      const json: GLTFJson = { asset: { version: '2.0' }, extensionsRequired: ['KHR_test'] };
      expect(loader.isExtensionRequired(json, 'KHR_test')).toBe(true);
      expect(loader.isExtensionRequired(json, 'KHR_other')).toBe(false);
    });
  });

  describe('DRACO / KTX2 decoder injection', () => {
    it('setDRACODecoder sets dracoSupported flag', () => {
      const loader = new GLTFExtensionLoader();
      const fake = { decode: async () => ({ positions: null, normals: null, uvs: null, tangents: null, colors: null, indices: new Uint32Array(), vertexCount: 0 }) };
      loader.setDRACODecoder(fake);
      expect(loader.dracoSupported).toBe(true);
      expect(loader.getDRACODecoder()).toBe(fake);
    });

    it('setDRACODecoder(null) clears support', () => {
      const loader = new GLTFExtensionLoader();
      loader.setDRACODecoder({ decode: async () => ({ positions: null, normals: null, uvs: null, tangents: null, colors: null, indices: new Uint32Array(), vertexCount: 0 }) });
      loader.setDRACODecoder(null);
      expect(loader.dracoSupported).toBe(false);
      expect(loader.getDRACODecoder()).toBeNull();
    });

    it('setKTX2Decoder sets ktx2Supported flag', () => {
      const loader = new GLTFExtensionLoader();
      loader.setKTX2Decoder({ parse: async () => null });
      expect(loader.ktx2Supported).toBe(true);
      expect(loader.getKTX2Decoder()).toBeDefined();
    });

    it('setKTX2Decoder(null) clears support', () => {
      const loader = new GLTFExtensionLoader();
      loader.setKTX2Decoder({ parse: async () => null });
      loader.setKTX2Decoder(null);
      expect(loader.ktx2Supported).toBe(false);
      expect(loader.getKTX2Decoder()).toBeNull();
    });

    it('is chainable', () => {
      const loader = new GLTFExtensionLoader();
      expect(loader.setDRACODecoder(null)).toBe(loader);
      expect(loader.setKTX2Decoder(null)).toBe(loader);
    });
  });

  describe('parseGLTFJSON', () => {
    it('returns the json when valid', () => {
      const loader = new GLTFExtensionLoader();
      const json: GLTFJson = { asset: { version: '2.0' } };
      expect(loader.parseGLTFJSON(json)).toBe(json);
    });

    it('throws on missing asset.version', () => {
      const loader = new GLTFExtensionLoader();
      expect(() => loader.parseGLTFJSON({})).toThrow('missing asset.version');
    });

    it('throws when required extension is not registered', () => {
      const loader = new GLTFExtensionLoader();
      const json: GLTFJson = {
        asset: { version: '2.0' },
        extensionsRequired: ['KHR_materials_unlit'],
      };
      expect(() => loader.parseGLTFJSON(json)).toThrow('required extensions not registered');
    });

    it('passes when required extension is registered', () => {
      const loader = new GLTFExtensionLoader();
      loader.registerExtension('KHR_materials_unlit', { name: 'KHR_materials_unlit' });
      const json: GLTFJson = {
        asset: { version: '2.0' },
        extensionsRequired: ['KHR_materials_unlit'],
      };
      expect(loader.parseGLTFJSON(json)).toBe(json);
    });

    it('passes when required extension is builtin (DRACO)', () => {
      const loader = new GLTFExtensionLoader();
      loader.setDRACODecoder({ decode: async () => ({ positions: null, normals: null, uvs: null, tangents: null, colors: null, indices: new Uint32Array(), vertexCount: 0 }) });
      const json: GLTFJson = {
        asset: { version: '2.0' },
        extensionsRequired: ['KHR_draco_mesh_compression'],
      };
      expect(loader.parseGLTFJSON(json)).toBe(json);
    });

    it('warns but does not throw on v1 asset', () => {
      const loader = new GLTFExtensionLoader();
      const json: GLTFJson = { asset: { version: '1.0' } };
      expect(() => loader.parseGLTFJSON(json)).not.toThrow();
    });
  });

  describe('parseNode', () => {
    it('returns TRS defaults when missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseNode({}, { asset: { version: '2.0' } });
      expect(result.translation).toEqual([0, 0, 0]);
      expect(result.rotation).toEqual([0, 0, 0, 1]);
      expect(result.scale).toEqual([1, 1, 1]);
      expect(result.meshIndex).toBeNull();
      expect(result.skinIndex).toBeNull();
    });

    it('reads TRS from node', () => {
      const loader = new GLTFExtensionLoader();
      const node: GLTFNode = {
        translation: [1, 2, 3],
        rotation: [0, 0, 0, 1],
        scale: [2, 2, 2],
        mesh: 5,
        skin: 2,
        children: [1, 2, 3],
        camera: 0,
        extensions: { KHR_test: { foo: 1 } },
      };
      const result = loader.parseNode(node, { asset: { version: '2.0' } });
      expect(result.translation).toEqual([1, 2, 3]);
      expect(result.meshIndex).toBe(5);
      expect(result.skinIndex).toBe(2);
      expect(result.children).toEqual([1, 2, 3]);
      expect(result.cameraIndex).toBe(0);
      expect(result.extensions).toEqual({ KHR_test: { foo: 1 } });
    });

    it('returns name from node', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseNode({ name: 'Cube' }, { asset: { version: '2.0' } });
      expect(result.name).toBe('Cube');
    });
  });

  describe('parseMesh', () => {
    it('returns primitive metadata', () => {
      const loader = new GLTFExtensionLoader();
      const mesh: GLTFMesh = {
        name: 'CubeMesh',
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1 },
          indices: 2,
          material: 0,
          mode: 4,
          extensions: { KHR_test: {} },
        }],
        weights: [0.5, 0.5],
        extensions: { KHR_test: {} },
      };
      const result = loader.parseMesh(mesh, { asset: { version: '2.0' } });
      expect(result.name).toBe('CubeMesh');
      expect(result.primitives).toHaveLength(1);
      expect(result.primitives[0].attributes).toEqual({ POSITION: 0, NORMAL: 1 });
      expect(result.primitives[0].indices).toBe(2);
      expect(result.primitives[0].material).toBe(0);
      expect(result.primitives[0].mode).toBe(4);
      expect(result.weights).toEqual([0.5, 0.5]);
    });

    it('defaults mode to 4 (TRIANGLES) when missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseMesh({ primitives: [{ attributes: {} }] }, { asset: { version: '2.0' } });
      expect(result.primitives[0].mode).toBe(4);
    });

    it('returns null material when missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseMesh({ primitives: [{ attributes: {} }] }, { asset: { version: '2.0' } });
      expect(result.primitives[0].material).toBeNull();
    });
  });

  describe('parseMaterial', () => {
    it('returns defaults when fields missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseMaterial({}, { asset: { version: '2.0' } });
      expect(result.baseColorFactor).toEqual([1, 1, 1, 1]);
      expect(result.metallicFactor).toBe(1);
      expect(result.roughnessFactor).toBe(1);
      expect(result.alphaMode).toBe('OPAQUE');
      expect(result.doubleSided).toBe(false);
    });

    it('reads PBR values', () => {
      const loader = new GLTFExtensionLoader();
      const mat: GLTFMaterial = {
        name: 'PbrMat',
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 0.8],
          metallicFactor: 0.7,
          roughnessFactor: 0.3,
        },
        emissiveFactor: [1, 0, 0],
        alphaMode: 'BLEND',
        alphaCutoff: 0.6,
        doubleSided: true,
      };
      const result = loader.parseMaterial(mat, { asset: { version: '2.0' } });
      expect(result.name).toBe('PbrMat');
      expect(result.baseColorFactor).toEqual([0.5, 0.5, 0.5, 0.8]);
      expect(result.metallicFactor).toBe(0.7);
      expect(result.roughnessFactor).toBe(0.3);
      expect(result.emissiveFactor).toEqual([1, 0, 0]);
      expect(result.alphaMode).toBe('BLEND');
      expect(result.alphaCutoff).toBe(0.6);
      expect(result.doubleSided).toBe(true);
    });
  });

  describe('parseAccessor', () => {
    it('returns componentCount for VEC types', () => {
      const loader = new GLTFExtensionLoader();
      const json: GLTFJson = { asset: { version: '2.0' } };
      const cases: { type: GLTFAccessor['type']; expected: number }[] = [
        { type: 'SCALAR', expected: 1 },
        { type: 'VEC2', expected: 2 },
        { type: 'VEC3', expected: 3 },
        { type: 'VEC4', expected: 4 },
        { type: 'MAT2', expected: 4 },
        { type: 'MAT3', expected: 9 },
        { type: 'MAT4', expected: 16 },
      ];
      for (const c of cases) {
        const acc: GLTFAccessor = { componentType: 5126, count: 1, type: c.type };
        const result = loader.parseAccessor(acc, json);
        expect(result.componentCount).toBe(c.expected);
      }
    });

    it('returns accessor metadata', () => {
      const loader = new GLTFExtensionLoader();
      const acc: GLTFAccessor = {
        bufferView: 1,
        componentType: 5126,
        count: 100,
        type: 'VEC3',
        byteOffset: 12,
        normalized: true,
        min: [0, 0, 0],
        max: [1, 1, 1],
      };
      const result = loader.parseAccessor(acc, { asset: { version: '2.0' } });
      expect(result.bufferView).toBe(1);
      expect(result.count).toBe(100);
      expect(result.normalized).toBe(true);
      expect(result.byteOffset).toBe(12);
      expect(result.min).toEqual([0, 0, 0]);
      expect(result.max).toEqual([1, 1, 1]);
    });

    it('defaults bufferView to null when missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseAccessor({ componentType: 5126, count: 1, type: 'SCALAR' }, { asset: { version: '2.0' } });
      expect(result.bufferView).toBeNull();
    });

    it('defaults byteOffset to 0 when missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseAccessor({ componentType: 5126, count: 1, type: 'SCALAR' }, { asset: { version: '2.0' } });
      expect(result.byteOffset).toBe(0);
    });
  });

  describe('parseBufferView', () => {
    it('returns bufferView metadata', () => {
      const loader = new GLTFExtensionLoader();
      const bv: GLTFBufferView = {
        buffer: 0,
        byteOffset: 100,
        byteLength: 200,
        byteStride: 12,
        target: 34962,
      };
      const result = loader.parseBufferView(bv, { asset: { version: '2.0' } });
      expect(result.buffer).toBe(0);
      expect(result.byteOffset).toBe(100);
      expect(result.byteLength).toBe(200);
      expect(result.byteStride).toBe(12);
      expect(result.target).toBe(34962);
    });

    it('defaults byteOffset to 0 when missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseBufferView({ buffer: 0, byteLength: 10 }, { asset: { version: '2.0' } });
      expect(result.byteOffset).toBe(0);
    });

    it('defaults byteStride and target to null when missing', () => {
      const loader = new GLTFExtensionLoader();
      const result = loader.parseBufferView({ buffer: 0, byteLength: 10 }, { asset: { version: '2.0' } });
      expect(result.byteStride).toBeNull();
      expect(result.target).toBeNull();
    });
  });

  describe('cache management', () => {
    it('getLoadedScenes returns a copy of the map', () => {
      const loader = new GLTFExtensionLoader();
      const map = loader.getLoadedScenes();
      expect(map.size).toBe(0);
      // 不影响内部 map
      map.set('test', null as unknown as never);
      expect(loader.loadedScenes.size).toBe(0);
    });

    it('evictFromCache removes a key (no-op when missing)', () => {
      const loader = new GLTFExtensionLoader();
      loader.evictFromCache('nonexistent');
      expect(loader.loadedScenes.size).toBe(0);
    });

    it('clearCache empties the cache', () => {
      const loader = new GLTFExtensionLoader();
      // 直接造一个假的缓存项以测试清空逻辑
      loader.loadedScenes.set('test', null as unknown as never);
      expect(loader.loadedScenes.size).toBe(1);
      loader.clearCache();
      expect(loader.loadedScenes.size).toBe(0);
    });
  });

  describe('parse (integration with real GLB)', () => {
    it('parses a minimal GLB into a LoadedGLB', async () => {
      const loader = new GLTFExtensionLoader();
      const buf = makeMinimalGLB();
      const result = await loader.parse(buf);
      expect(result.root).toBeDefined();
      expect(result.animations).toEqual([]);
      expect(result.materials).toBeDefined();
      expect(result.materials.length).toBe(1);
    });

    it('accepts Uint8Array input', async () => {
      const loader = new GLTFExtensionLoader();
      const u8 = new Uint8Array(makeMinimalGLB());
      const result = await loader.parse(u8);
      expect(result.root).toBeDefined();
    });

    it('throws on bad GLB magic', async () => {
      const loader = new GLTFExtensionLoader();
      const buf = new ArrayBuffer(20);
      const dv = new DataView(buf);
      dv.setUint32(0, 0xDEADBEEF, true);
      dv.setUint32(4, 2, true);
      dv.setUint32(8, 20, true);
      dv.setUint32(12, 0, true);
      dv.setUint32(16, 0x4E4F534A, true);
      await expect(loader.parse(buf)).rejects.toThrow('bad magic');
    });
  });

  describe('load / loadAsync', () => {
    it('loadAsync parses ArrayBuffer source', async () => {
      const loader = new GLTFExtensionLoader();
      const buf = makeMinimalGLB();
      const result = await loader.loadAsync(buf);
      expect(result.root).toBeDefined();
      expect(result.materials.length).toBe(1);
    });

    it('load caches by source key', async () => {
      const loader = new GLTFExtensionLoader();
      const buf = makeMinimalGLB();
      const r1 = await loader.load(buf);
      // 再次加载相同 buffer → 应命中缓存 (返回同一引用)
      const r2 = await loader.load(buf);
      expect(r2).toBe(r1);
      expect(loader.loadedScenes.size).toBe(1);
    });

    it('loadAsync is alias for load', async () => {
      const loader = new GLTFExtensionLoader();
      const buf = makeMinimalGLB();
      const r = await loader.loadAsync(buf);
      expect(r.root).toBeDefined();
    });
  });

  describe('extension hooks (beforeParse)', () => {
    it('beforeParse is invoked with json + bin', async () => {
      const loader = new GLTFExtensionLoader();
      let called = false;
      loader.registerExtension('KHR_test', {
        name: 'KHR_test',
        beforeParse: (json, bin) => {
          called = true;
          expect(json).toBeDefined();
          expect(bin).toBeDefined(); // 这个 GLB 有 BIN chunk
        },
      });
      const buf = makeMinimalGLB();
      await loader.parse(buf);
      expect(called).toBe(true);
    });

    it('beforeParse return value replaces json', async () => {
      const loader = new GLTFExtensionLoader();
      const modified: GLTFJson = {
        asset: { version: '2.0' },
        scenes: [{ nodes: [] }],
        nodes: [],
      };
      let seen = false;
      loader.registerExtension('KHR_test', {
        name: 'KHR_test',
        beforeParse: () => {
          seen = true;
          return modified;
        },
      });
      // 这个测试只验证 hook 被调用并返回值;不验证 buildFromGltf 的结果
      // (替换后的 JSON 是空的,buildFromGltf 会返回空场景)
      const buf = makeMinimalGLB();
      const result = await loader.parse(buf);
      expect(seen).toBe(true);
      expect(result).toBeDefined();
    });
  });

  describe('extension hooks (afterParseNode)', () => {
    it('afterParseNode is invoked for nodes with matching extension', async () => {
      const loader = new GLTFExtensionLoader();
      // 我们需要在 GLB 里给 node 添加 extensions,但 makeMinimalGLB 没有
      // 直接通过 beforeParse 注入 extensions 到 node[0]
      let invoked = false;
      loader.registerExtension('KHR_test', {
        name: 'KHR_test',
        beforeParse: (json) => {
          const j = json as unknown as GLTFJson;
          if (j.nodes && j.nodes[0]) {
            (j.nodes[0] as { extensions?: Record<string, unknown> }).extensions = {
              KHR_test: { tag: 'custom' },
            };
          }
        },
        afterParseNode: (_node, ctx) => {
          invoked = true;
          expect(ctx.extensionData).toEqual({ tag: 'custom' });
        },
      });
      const buf = makeMinimalGLB();
      await loader.parse(buf);
      expect(invoked).toBe(true);
    });

    it('afterParseNode hook errors do not abort parsing', async () => {
      const loader = new GLTFExtensionLoader();
      loader.registerExtension('KHR_test', {
        name: 'KHR_test',
        beforeParse: (json) => {
          const j = json as unknown as GLTFJson;
          if (j.nodes && j.nodes[0]) {
            (j.nodes[0] as { extensions?: Record<string, unknown> }).extensions = { KHR_test: {} };
          }
        },
        afterParseNode: () => {
          throw new Error('intentional hook error');
        },
      });
      const buf = makeMinimalGLB();
      // 应该不抛 (错误被吞掉,只 warn)
      await expect(loader.parse(buf)).resolves.toBeDefined();
    });
  });

  describe('dispose', () => {
    it('clears all state', () => {
      const loader = new GLTFExtensionLoader();
      loader.registerExtension('KHR_test', { name: 'KHR_test' });
      loader.loadedScenes.set('test', null as unknown as never);
      loader.setDRACODecoder({ decode: async () => ({ positions: null, normals: null, uvs: null, tangents: null, colors: null, indices: new Uint32Array(), vertexCount: 0 }) });
      loader.dispose();
      expect(loader.extensionHandlers.size).toBe(0);
      expect(loader.loadedScenes.size).toBe(0);
      expect(loader.dracoSupported).toBe(false);
      expect(loader.ktx2Supported).toBe(false);
    });

    it('calls dispose on each handler', () => {
      const loader = new GLTFExtensionLoader();
      let count = 0;
      loader.registerExtension('a', { name: 'a', dispose: () => count++ });
      loader.registerExtension('b', { name: 'b', dispose: () => count++ });
      loader.dispose();
      expect(count).toBe(2);
    });

    it('handler dispose errors are caught', () => {
      const loader = new GLTFExtensionLoader();
      loader.registerExtension('a', {
        name: 'a',
        dispose: () => { throw new Error('boom'); },
      });
      expect(() => loader.dispose()).not.toThrow();
    });
  });
});
