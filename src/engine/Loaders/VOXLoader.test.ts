import { describe, it, expect } from 'vitest';
import { VOXLoader, parseVOX } from './VOXLoader';

/**
 * Build a minimal .vox binary buffer.
 * Layout:
 *   'VOX ' (4B) + version uint32
 *   MAIN chunk header (12B) + children:
 *     SIZE chunk (12B header + 12B content)
 *     XYZI chunk (12B header + 4B numVoxels + numVoxels*4B)
 *     optional RGBA chunk (12B header + 1024B content)
 */
function buildVox(
  size: [number, number, number],
  voxels: { x: number; y: number; z: number; colorIndex: number }[],
  palette?: number[][], // 256 entries of [r,g,b,a], or omit for default
): ArrayBuffer {
  // Compute children payload.
  const sizeContent = 12; // 3 × uint32
  const xyziContent = 4 + voxels.length * 4; // numVoxels + voxels
  const rgbaContent = 1024; // 256 × 4
  const hasRGBA = palette !== undefined;

  const childrenSize = (12 + sizeContent) + (12 + xyziContent) + (hasRGBA ? 12 + rgbaContent : 0);
  const total = 8 + 12 + childrenSize; // magic+version + MAIN header + children
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let p = 0;

  // Magic 'VOX '
  u8[0] = 0x56; u8[1] = 0x4f; u8[2] = 0x58; u8[3] = 0x20;
  dv.setUint32(4, 150, true); // version
  p = 8;

  // MAIN header
  writeStr(u8, p, 'MAIN'); dv.setUint32(p + 4, 0, true); dv.setUint32(p + 8, childrenSize, true);
  p += 12;

  // SIZE chunk
  writeStr(u8, p, 'SIZE'); dv.setUint32(p + 4, sizeContent, true); dv.setUint32(p + 8, 0, true);
  p += 12;
  dv.setUint32(p, size[0], true); dv.setUint32(p + 4, size[1], true); dv.setUint32(p + 8, size[2], true);
  p += 12;

  // XYZI chunk
  writeStr(u8, p, 'XYZI'); dv.setUint32(p + 4, xyziContent, true); dv.setUint32(p + 8, 0, true);
  p += 12;
  dv.setUint32(p, voxels.length, true); p += 4;
  for (const v of voxels) {
    u8[p] = v.x & 0xff; u8[p + 1] = v.y & 0xff; u8[p + 2] = v.z & 0xff; u8[p + 3] = v.colorIndex & 0xff;
    p += 4;
  }

  // RGBA chunk (optional)
  if (hasRGBA) {
    writeStr(u8, p, 'RGBA'); dv.setUint32(p + 4, rgbaContent, true); dv.setUint32(p + 8, 0, true);
    p += 12;
    for (let i = 0; i < 256; i++) {
      const c = palette![i] ?? [0, 0, 0, 255];
      u8[p] = c[0] & 0xff; u8[p + 1] = c[1] & 0xff; u8[p + 2] = c[2] & 0xff; u8[p + 3] = c[3] & 0xff;
      p += 4;
    }
  }

  return buf;
}

function writeStr(arr: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) arr[offset + i] = s.charCodeAt(i);
}

describe('VOXLoader', () => {
  it('parses a minimal .vox with 1 model, 1 voxel', () => {
    const buf = buildVox([2, 2, 2], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const { models, palette } = new VOXLoader().parse(buf);
    expect(models.length).toBe(1);
    expect(models[0].size).toEqual({ x: 2, y: 2, z: 2 });
    expect(models[0].voxels.length).toBe(1);
    expect(models[0].voxels[0]).toEqual({ x: 0, y: 0, z: 0, colorIndex: 1 });
    // Default palette has 256 entries.
    expect(palette.length).toBe(256);
  });

  it('parses a .vox with multiple voxels → correct count', () => {
    const voxels = [
      { x: 0, y: 0, z: 0, colorIndex: 1 },
      { x: 1, y: 0, z: 0, colorIndex: 2 },
      { x: 0, y: 1, z: 0, colorIndex: 3 },
      { x: 0, y: 0, z: 1, colorIndex: 4 },
    ];
    const buf = buildVox([3, 3, 3], voxels);
    const { models } = parseVOX(buf);
    expect(models[0].voxels.length).toBe(4);
    expect(models[0].voxels[3]).toEqual({ x: 0, y: 0, z: 1, colorIndex: 4 });
  });

  it('parses a .vox with a custom palette → 256 colors', () => {
    const palette: number[][] = [];
    for (let i = 0; i < 256; i++) palette.push([i, 0, 0, 255]); // red ramp
    const buf = buildVox([1, 1, 1], [{ x: 0, y: 0, z: 0, colorIndex: 5 }], palette);
    const { palette: pal } = new VOXLoader().parse(buf);
    expect(pal.length).toBe(256);
    // Index 5 → r = 5/255.
    expect(pal[5].r).toBeCloseTo(5 / 255, 4);
    expect(pal[5].g).toBeCloseTo(0, 4);
    expect(pal[5].b).toBeCloseTo(0, 4);
  });

  it('voxelsToGeometry produces correct vertex/index count (1 voxel = 24 verts, 36 indices)', () => {
    const buf = buildVox([1, 1, 1], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const { models, palette } = parseVOX(buf);
    const geom = VOXLoader.voxelsToGeometry(models[0], palette);
    expect(geom.attributes.position.count).toBe(24); // 6 faces × 4 verts
    expect(geom.attributes.normal.count).toBe(24);
    expect(geom.attributes.color.count).toBe(24);
    expect(geom.index?.count).toBe(36); // 6 faces × 2 triangles × 3
  });

  it('voxelsToGeometry with multiple voxels → scaled vertex count', () => {
    const voxels = [
      { x: 0, y: 0, z: 0, colorIndex: 1 },
      { x: 1, y: 0, z: 0, colorIndex: 2 },
      { x: 2, y: 0, z: 0, colorIndex: 3 },
    ];
    const buf = buildVox([4, 1, 1], voxels);
    const { models, palette } = parseVOX(buf);
    const geom = VOXLoader.voxelsToGeometry(models[0], palette);
    expect(geom.attributes.position.count).toBe(3 * 24); // 3 voxels × 24
    expect(geom.index?.count).toBe(3 * 36);
  });

  it('throws on invalid magic number', () => {
    const buf = new ArrayBuffer(16);
    const u8 = new Uint8Array(buf);
    u8[0] = 0x00; u8[1] = 0x00; u8[2] = 0x00; u8[3] = 0x00;
    expect(() => new VOXLoader().parse(buf)).toThrow(/invalid magic/);
  });

  it('empty model (0 voxels) → empty geometry', () => {
    const buf = buildVox([1, 1, 1], []);
    const { models, palette } = parseVOX(buf);
    expect(models[0].voxels.length).toBe(0);
    const geom = VOXLoader.voxelsToGeometry(models[0], palette);
    expect(geom.attributes.position).toBeUndefined();
    expect(geom.index).toBeNull();
  });

  it('parseToMeshes returns one Mesh per model', () => {
    const buf = buildVox([2, 2, 2], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const meshes = new VOXLoader().parseToMeshes(buf);
    expect(meshes.length).toBe(1);
    expect(meshes[0].geometry.attributes.position.count).toBe(24);
  });
});
