import { describe, it, expect } from 'vitest';
import { parsePLY, PLYLoader } from './PLYLoader';

/** 构造最小 ASCII PLY: 3 顶点 1 三角面,带 normal/uv/color。 */
function makeASCIIPly(): string {
  return [
    'ply',
    'format ascii 1.0',
    'comment test',
    'element vertex 3',
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float s',
    'property float t',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'element face 1',
    'property list uchar int vertex_indices',
    'end_header',
    '0 0 0  0 0 1  0 0  255 0 0',
    '1 0 0  0 0 1  1 0  0 255 0',
    '0 1 0  0 0 1  0 1  0 0 255',
    '3 0 1 2',
    '',
  ].join('\n');
}

/** 构造最小二进制 PLY (little-endian): 3 顶点 1 面。 */
function makeBinaryPly(): ArrayBuffer {
  // 头部
  const headerText = [
    'ply',
    'format binary_little_endian 1.0',
    'element vertex 3',
    'property float x',
    'property float y',
    'property float z',
    'element face 1',
    'property list uchar uchar vertex_indices',
    'end_header',
    '',
  ].join('\n');
  const headerBytes = new TextEncoder().encode(headerText);
  // body: 3 顶点 (每顶点 12 字节) + 1 面 (1+3 字节)
  const bodySize = 3 * 12 + 4;
  const buf = new ArrayBuffer(headerBytes.length + bodySize);
  const u8 = new Uint8Array(buf);
  u8.set(headerBytes, 0);
  const dv = new DataView(buf);
  let off = headerBytes.length;
  // 顶点
  const verts: number[] = [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ];
  for (const v of verts) {
    dv.setFloat32(off, v, true);
    off += 4;
  }
  // 面: count=3, indices=[0,1,2] (uchar)
  dv.setUint8(off, 3); off++;
  dv.setUint8(off, 0); off++;
  dv.setUint8(off, 1); off++;
  dv.setUint8(off, 2); off++;
  return buf;
}

describe('PLYLoader', () => {
  describe('parsePLY (ASCII)', () => {
    it('parses positions', () => {
      const g = parsePLY(new TextEncoder().encode(makeASCIIPly()).buffer);
      const pos = g.getAttribute('position')!;
      expect(pos.count).toBe(3);
      expect(pos.array[0]).toBe(0);
      expect(pos.array[3]).toBe(1);
      expect(pos.array[7]).toBe(1);
    });

    it('parses normals', () => {
      const g = parsePLY(new TextEncoder().encode(makeASCIIPly()).buffer);
      const nrm = g.getAttribute('normal')!;
      expect(nrm.array[2]).toBe(1); // v0 nz
      expect(nrm.array[5]).toBe(1); // v1 nz
    });

    it('parses uvs', () => {
      const g = parsePLY(new TextEncoder().encode(makeASCIIPly()).buffer);
      const uv = g.getAttribute('uv')!;
      expect(uv.count).toBe(3);
      expect(uv.array[0]).toBe(0); // v0.s
      expect(uv.array[2]).toBe(1); // v1.s
      expect(uv.array[5]).toBe(1); // v2.t
    });

    it('parses colors and normalizes to 0..1', () => {
      const g = parsePLY(new TextEncoder().encode(makeASCIIPly()).buffer);
      const col = g.getAttribute('color')!;
      expect(col.array[0]).toBeCloseTo(1, 2);  // 255 → 1
      expect(col.array[4]).toBeCloseTo(1, 2);  // green 255 → 1
      expect(col.array[8]).toBeCloseTo(1, 2);  // blue 255 → 1
    });

    it('parses face indices', () => {
      const g = parsePLY(new TextEncoder().encode(makeASCIIPly()).buffer);
      expect(g.index).not.toBeNull();
      const idx = g.index!.array as unknown as ArrayLike<number>;
      expect(idx.length).toBe(3);
      expect(idx[0]).toBe(0);
      expect(idx[1]).toBe(1);
      expect(idx[2]).toBe(2);
    });
  });

  describe('parsePLY (binary)', () => {
    it('parses positions and indices', () => {
      const g = parsePLY(makeBinaryPly());
      const pos = g.getAttribute('position')!;
      expect(pos.count).toBe(3);
      expect(pos.array[3]).toBe(1);
      expect(pos.array[7]).toBe(1);
      expect(g.index).not.toBeNull();
      const idx = g.index!.array as unknown as ArrayLike<number>;
      expect(idx.length).toBe(3);
      expect(idx[0]).toBe(0);
      expect(idx[1]).toBe(1);
      expect(idx[2]).toBe(2);
    });
  });

  describe('PLYLoader class', () => {
    it('canLoad detects .ply', () => {
      const loader = new PLYLoader();
      expect(loader.canLoad(new File([], 'x.ply'))).toBe(true);
      expect(loader.canLoad(new File([], 'x.stl'))).toBe(false);
      expect(loader.canLoad('x.ply')).toBe(true);
    });

    it('load accepts ArrayBuffer', async () => {
      const loader = new PLYLoader();
      const g = await loader.load(new TextEncoder().encode(makeASCIIPly()).buffer);
      expect(g.getAttribute('position')!.count).toBe(3);
    });
  });
});
