import { describe, it, expect } from 'vitest';
import { parseGLB, GLBLoader } from './GLBLoader';

/**
 * Build a minimal valid GLB binary buffer.
 *
 * GLB container layout:
 *   12 bytes header (magic=0x46546C67, version=2, length)
 *   JSON chunk  (8 bytes header + JSON data, 4-byte aligned)
 *   BIN chunk   (8 bytes header + binary data, 4-byte aligned)
 *
 * Scene: one triangle mesh (3 vertices) with position accessor and indices.
 */
function makeMinimalGLB(): ArrayBuffer {
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
      }],
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: 3,
        type: 'VEC3',
        max: [1, 1, 0],
        min: [0, 0, 0],
      },
      {
        bufferView: 1,
        componentType: 5123, // UNSIGNED_SHORT
        count: 3,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },   // positions: 3*3*4=36
      { buffer: 0, byteOffset: 36, byteLength: 6 },   // indices: 3*2=6
    ],
    buffers: [
      { byteLength: 42 },
    ],
  };

  const jsonStr = JSON.stringify(json);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);

  // BIN data: 3 position floats (x3) + 3 index u16
  const binData = new Uint8Array(42);
  const dv = new DataView(binData.buffer);
  // positions: v0=(0,0,0), v1=(1,0,0), v2=(0,1,0)
  dv.setFloat32(0, 0, true); dv.setFloat32(4, 0, true); dv.setFloat32(8, 0, true);
  dv.setFloat32(12, 1, true); dv.setFloat32(16, 0, true); dv.setFloat32(20, 0, true);
  dv.setFloat32(24, 0, true); dv.setFloat32(28, 1, true); dv.setFloat32(32, 0, true);
  // indices: 0,1,2
  dv.setUint16(36, 0, true); dv.setUint16(38, 1, true); dv.setUint16(40, 2, true);

  // Pad JSON to 4-byte alignment
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLen = 8 + jsonBytes.length + jsonPad;
  const binChunkLen = 8 + 42;
  const totalLen = 12 + jsonChunkLen + binChunkLen;

  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  let off = 0;

  // GLB header
  view.setUint32(off, 0x46546C67, true); off += 4; // magic 'glTF'
  view.setUint32(off, 2, true); off += 4;            // version 2
  view.setUint32(off, totalLen, true); off += 4;      // total length

  // JSON chunk
  view.setUint32(off, jsonBytes.length + jsonPad, true); off += 4; // chunk length
  view.setUint32(off, 0x4E4F534A, true); off += 4;                // chunk type 'JSON'
  new Uint8Array(buf, off, jsonBytes.length).set(jsonBytes); off += jsonBytes.length;
  off += jsonPad; // skip padding

  // BIN chunk
  view.setUint32(off, 42, true); off += 4;           // chunk length
  view.setUint32(off, 0x004E4942, true); off += 4;   // chunk type 'BIN\0'
  new Uint8Array(buf, off, 42).set(binData);

  return buf;
}

describe('GLBLoader', () => {
  describe('parseGLB', () => {
    it('parses minimal valid GLB', () => {
      const buf = makeMinimalGLB();
      const result = parseGLB(buf);
      expect(result.json).toBeDefined();
      expect(result.json.asset.version).toBe('2.0');
      expect(result.bin).not.toBeNull();
      expect(result.bin!.byteLength).toBe(42);
    });

    it('throws on too-small file', () => {
      expect(() => parseGLB(new ArrayBuffer(4))).toThrow('file too small');
    });

    it('throws on bad magic', () => {
      const buf = new ArrayBuffer(12);
      new DataView(buf).setUint32(0, 0xDEADBEEF, true);
      new DataView(buf).setUint32(4, 2, true);
      new DataView(buf).setUint32(8, 12, true);
      expect(() => parseGLB(buf)).toThrow('bad magic');
    });

    it('accepts version 2 (non-2 warns but continues)', () => {
      // Version 1 GLB with valid but empty JSON chunk
      const json = JSON.stringify({ asset: { version: '2.0' }, scenes: [], nodes: [] });
      const jsonBytes = new TextEncoder().encode(json);
      const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
      const totalLen = 12 + 8 + jsonBytes.length + jsonPad;
      const buf = new ArrayBuffer(totalLen);
      const view = new DataView(buf);
      view.setUint32(0, 0x46546C67, true);
      view.setUint32(4, 1, true);  // version 1
      view.setUint32(8, totalLen, true);
      view.setUint32(12, jsonBytes.length + jsonPad, true);
      view.setUint32(16, 0x4E4F534A, true);
      new Uint8Array(buf, 20, jsonBytes.length).set(jsonBytes);

      const result = parseGLB(buf);
      expect(result.json).toBeDefined();
      expect(result.bin).toBeNull();
    });

    it('throws on missing JSON chunk', () => {
      // GLB with BIN as first chunk (instead of JSON)
      const buf = new ArrayBuffer(20);
      const view = new DataView(buf);
      view.setUint32(0, 0x46546C67, true);
      view.setUint32(4, 2, true);
      view.setUint32(8, 20, true);
      view.setUint32(12, 0, true);   // chunk length = 0
      view.setUint32(16, 0x004E4942, true);  // BIN type, not JSON
      expect(() => parseGLB(buf)).toThrow('first chunk');
    });

    it('handles GLB without BIN chunk', () => {
      // JSON-only GLB (no binary data)
      const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] };
      const jsonStr = JSON.stringify(json);
      const jsonBytes = new TextEncoder().encode(jsonStr);
      const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
      const totalLen = 12 + 8 + jsonBytes.length + jsonPad;

      const buf = new ArrayBuffer(totalLen);
      const view = new DataView(buf);
      let off = 0;
      view.setUint32(off, 0x46546C67, true); off += 4;
      view.setUint32(off, 2, true); off += 4;
      view.setUint32(off, totalLen, true); off += 4;
      view.setUint32(off, jsonBytes.length + jsonPad, true); off += 4;
      view.setUint32(off, 0x4E4F534A, true); off += 4;
      new Uint8Array(buf, off, jsonBytes.length).set(jsonBytes);

      const result = parseGLB(buf);
      expect(result.bin).toBeNull();
      expect(result.json.asset.version).toBe('2.0');
    });

    it('parses JSON content correctly', () => {
      const buf = makeMinimalGLB();
      const { json } = parseGLB(buf);
      expect(json.nodes).toHaveLength(1);
      expect(json.nodes![0].mesh).toBe(0);
      expect(json.meshes).toHaveLength(1);
      expect(json.meshes![0].primitives).toHaveLength(1);
      expect(json.accessors).toHaveLength(2);
      expect(json.bufferViews).toHaveLength(2);
      expect(json.buffers).toHaveLength(1);
      expect(json.scene).toBe(0);
    });
  });

  describe('GLBLoader class', () => {
    it('canLoad detects .glb files', () => {
      const loader = new GLBLoader();
      expect(loader.canLoad(new File([], 'model.glb'))).toBe(true);
      expect(loader.canLoad(new File([], 'model.obj'))).toBe(false);
      expect(loader.canLoad('model.glb')).toBe(true);
      expect(loader.canLoad('model.gltf')).toBe(false);
    });

    it('load returns LoadedGLB from ArrayBuffer', async () => {
      const buf = makeMinimalGLB();
      const loader = new GLBLoader();
      const result = await loader.load(buf);
      expect(result.root).toBeDefined();
      expect(result.animations).toEqual([]);
      expect(result.materials).toEqual([]);
      expect(result.root.children.length).toBeGreaterThan(0);
    });

    it('load accepts Uint8Array', async () => {
      const buf = new Uint8Array(makeMinimalGLB());
      const loader = new GLBLoader();
      const result = await loader.load(buf);
      expect(result.root).toBeDefined();
    });
  });
});