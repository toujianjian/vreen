import { describe, it, expect } from 'vitest';
import { parseSTL, STLLoader } from './STLLoader';

/**
 * 构造最小二进制 STL: 1 个三角形面。
 *
 * 布局:
 *   80 字节头 (全 0)
 *   uint32 faceCount = 1
 *   50 字节 face:
 *     float32 normal[3]
 *     float32 vertex0[3]
 *     float32 vertex1[3]
 *     float32 vertex2[3]
 *     uint16 attribute = 0
 */
function makeBinarySTL(): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50);
  const dv = new DataView(buf);
  // 80 字节头:全 0
  // faceCount
  dv.setUint32(80, 1, true);
  // normal (0, 0, 1)
  dv.setFloat32(84 + 0, 0, true);
  dv.setFloat32(84 + 4, 0, true);
  dv.setFloat32(84 + 8, 1, true);
  // vertex0 (0, 0, 0)
  dv.setFloat32(84 + 12, 0, true);
  dv.setFloat32(84 + 16, 0, true);
  dv.setFloat32(84 + 20, 0, true);
  // vertex1 (1, 0, 0)
  dv.setFloat32(84 + 24, 1, true);
  dv.setFloat32(84 + 28, 0, true);
  dv.setFloat32(84 + 32, 0, true);
  // vertex2 (0, 1, 0)
  dv.setFloat32(84 + 36, 0, true);
  dv.setFloat32(84 + 40, 1, true);
  dv.setFloat32(84 + 44, 0, true);
  // attribute
  dv.setUint16(84 + 48, 0, true);
  return buf;
}

/** 构造最小 ASCII STL: 1 个三角形面。 */
function makeASCIISTL(): string {
  return [
    'solid test',
    '  facet normal 0 0 1',
    '    outer loop',
    '      vertex 0 0 0',
    '      vertex 1 0 0',
    '      vertex 0 1 0',
    '    endloop',
    '  endfacet',
    'endsolid test',
    '',
  ].join('\n');
}

describe('STLLoader', () => {
  describe('parseSTL (binary)', () => {
    it('parses 1 triangle: position + normal', () => {
      const buf = makeBinarySTL();
      const g = parseSTL(buf);
      const pos = g.getAttribute('position');
      expect(pos).toBeDefined();
      expect(pos!.count).toBe(3); // 1 face * 3 verts
      expect(pos!.array[0]).toBe(0); // v0.x
      expect(pos!.array[3]).toBe(1); // v1.x
      expect(pos!.array[7]).toBe(1); // v2.y
      const nrm = g.getAttribute('normal');
      expect(nrm).toBeDefined();
      expect(nrm!.array[2]).toBe(1); // normal.z for v0
      expect(nrm!.array[5]).toBe(1); // normal.z for v1
    });

    it('produces non-indexed geometry', () => {
      const g = parseSTL(makeBinarySTL());
      expect(g.index).toBeNull();
    });

    it('computes bounding box', () => {
      const g = parseSTL(makeBinarySTL());
      expect(g.boundingBox).not.toBeNull();
      expect(g.boundingBox!.min.x).toBe(0);
      expect(g.boundingBox!.max.x).toBe(1);
      expect(g.boundingBox!.max.y).toBe(1);
    });
  });

  describe('parseSTL (ASCII)', () => {
    it('parses 1 triangle vertices', () => {
      const g = parseSTL(makeASCIISTL());
      const pos = g.getAttribute('position')!;
      expect(pos.count).toBe(3);
      expect(pos.array[0]).toBe(0); // v0.x
      expect(pos.array[3]).toBe(1); // v1.x
      expect(pos.array[7]).toBe(1); // v2.y
    });

    it('parses normals from facet line', () => {
      const g = parseSTL(makeASCIISTL());
      const nrm = g.getAttribute('normal')!;
      expect(nrm.array[2]).toBe(1); // normal.z
    });

    it('records group name from solid block', () => {
      const g = parseSTL(makeASCIISTL());
      expect(g.userData['groupNames']).toEqual(['test']);
      expect(g.groups.length).toBe(1);
      expect(g.groups[0].count).toBe(3);
    });

    it('handles multiple solid blocks', () => {
      const text = [
        'solid a',
        '  facet normal 0 0 1',
        '    outer loop',
        '      vertex 0 0 0',
        '      vertex 1 0 0',
        '      vertex 0 1 0',
        '    endloop',
        '  endfacet',
        'endsolid a',
        'solid b',
        '  facet normal 0 0 1',
        '    outer loop',
        '      vertex 0 0 0',
        '      vertex 2 0 0',
        '      vertex 0 2 0',
        '    endloop',
        '  endfacet',
        'endsolid b',
        '',
      ].join('\n');
      const g = parseSTL(text);
      const pos = g.getAttribute('position')!;
      expect(pos.count).toBe(6);
      expect(g.groups.length).toBe(2);
      expect(g.groups[0].count).toBe(3);
      expect(g.groups[1].count).toBe(3);
    });
  });

  describe('STLLoader class', () => {
    it('canLoad detects .stl files', () => {
      const loader = new STLLoader();
      expect(loader.canLoad(new File([], 'x.stl'))).toBe(true);
      expect(loader.canLoad(new File([], 'x.obj'))).toBe(false);
      expect(loader.canLoad('http://e.com/x.stl')).toBe(true);
      expect(loader.canLoad('http://e.com/x.ply')).toBe(false);
    });

    it('load accepts ArrayBuffer', async () => {
      const loader = new STLLoader();
      const g = await loader.load(makeBinarySTL());
      expect(g.getAttribute('position')!.count).toBe(3);
    });

    it('load accepts File', async () => {
      const loader = new STLLoader();
      const file = new File([makeBinarySTL()], 't.stl', { type: 'model/stl' });
      const g = await loader.load(file);
      expect(g.getAttribute('position')!.count).toBe(3);
    });
  });
});
