// VOXLoader — MagicaVoxel (.vox) binary voxel parser. Adapted from
// three.js `src/loaders/VOXLoader.js` (MIT).
//
// .vox format (version 150, the common MagicaVoxel dialect):
//   - 4 bytes magic: 'VOX ' (0x56 0x4F 0x58 0x20)
//   - 4 bytes version (uint32 LE, typically 150)
//   - MAIN chunk (container):
//       chunk header: id (4B ASCII) + contentSize (uint32) + childrenSize (uint32)
//       MAIN has no content; children are SIZE / XYZI / RGBA chunks
//   - SIZE chunk: content = 3 × uint32 (x, y, z) model dimensions
//   - XYZI chunk: content = numVoxels (uint32) + numVoxels × { x, y, z, colorIndex } (4 bytes)
//   - RGBA chunk: content = 256 × { r, g, b, a } (1024 bytes)
//
// Each MAIN child group (SIZE + XYZI) describes one model. Multiple
// models may appear sequentially. The palette (RGBA) is shared across
// all models and is optional (a default palette is used when absent).
//
// Limitations vs three.js: no nTRN/nGRP (transform/node hierarchy),
// no MATT (materials), no LAYR (layers). One model = one geometry.

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Mesh } from '../Core/Mesh';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Color } from '../Math/Color';
import { createLogger } from '@/lib/logger';

const log = createLogger('VOXLoader');

/** A single voxel: integer grid position + palette index (1..255). */
export interface VoxVoxel {
  x: number;
  y: number;
  z: number;
  /** Palette index. 1..255 (0 is reserved/unused in MagicaVoxel). */
  colorIndex: number;
}

/** A voxel model: dimensions + the list of voxels. */
export interface VoxModel {
  size: { x: number; y: number; z: number };
  voxels: VoxVoxel[];
}

/** Result of parsing a .vox file. */
export interface VoxParseResult {
  models: VoxModel[];
  /** 256-entry palette (Color array). Uses a default palette if none in file. */
  palette: Color[];
}

// ── Default palette (MagicaVoxel's built-in palette, truncated to 256) ──
// Used when the .vox file has no RGBA chunk. We fill with a neutral grey
// ramp so colorIndex lookups always return a valid color.
function defaultPalette(): Color[] {
  const palette: Color[] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    palette.push(new Color(t, t, t));
  }
  return palette;
}

// ── Chunk reader ─────────────────────────────────────────────────

interface ChunkHeader {
  id: string;
  contentSize: number;
  childrenSize: number;
}

/**
 * Parse the .vox binary format from an ArrayBuffer.
 * Returns all models and the (possibly default) palette.
 */
export class VOXLoader {
  parse(buffer: ArrayBuffer): VoxParseResult {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);

    // 1. Magic + version.
    if (bytes.length < 8) {
      throw new Error('VOXLoader: buffer too short (expected at least 8 bytes)');
    }
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== 'VOX ') {
      throw new Error(`VOXLoader: invalid magic number "${magic}" (expected "VOX ")`);
    }
    const version = dv.getUint32(4, true);
    log.info('parsing .vox', { version, bytes: bytes.length });

    const models: VoxModel[] = [];
    let palette: Color[] | null = null;

    // 2. MAIN chunk starts at offset 8.
    let offset = 8;
    const mainHeader = readChunkHeader(dv, offset);
    offset += 12;
    if (mainHeader.id !== 'MAIN') {
      throw new Error(`VOXLoader: expected MAIN chunk, got "${mainHeader.id}"`);
    }

    // MAIN content is empty; iterate children until childrenSize exhausted.
    const mainChildrenEnd = offset + mainHeader.childrenSize;
    let pendingSize: { x: number; y: number; z: number } | null = null;

    while (offset < mainChildrenEnd) {
      const header = readChunkHeader(dv, offset);
      offset += 12;
      const contentStart = offset;
      const contentEnd = offset + header.contentSize;

      switch (header.id) {
        case 'SIZE': {
          const x = dv.getUint32(contentStart, true);
          const y = dv.getUint32(contentStart + 4, true);
          const z = dv.getUint32(contentStart + 8, true);
          pendingSize = { x, y, z };
          break;
        }
        case 'XYZI': {
          const numVoxels = dv.getUint32(contentStart, true);
          const voxels: VoxVoxel[] = [];
          let p = contentStart + 4;
          for (let i = 0; i < numVoxels; i++) {
            voxels.push({
              x: bytes[p],
              y: bytes[p + 1],
              z: bytes[p + 2],
              colorIndex: bytes[p + 3],
            });
            p += 4;
          }
          const size = pendingSize ?? { x: 0, y: 0, z: 0 };
          models.push({ size, voxels });
          pendingSize = null;
          break;
        }
        case 'RGBA': {
          const colors: Color[] = [];
          let p = contentStart;
          for (let i = 0; i < 256; i++) {
            // MagicaVoxel stores RGBA as r,g,b,a each one byte. Color
            // stores normalized 0..1 rgb (alpha is on the material).
            colors.push(new Color(bytes[p] / 255, bytes[p + 1] / 255, bytes[p + 2] / 255));
            p += 4;
          }
          palette = colors;
          break;
        }
        default:
          // Unknown chunk (nTRN, nGRP, LAYR, MATT, etc.) — skip.
          log.debug('skipping chunk', header.id);
          break;
      }

      offset = contentEnd;
    }

    if (!palette) palette = defaultPalette();

    log.info('parsed .vox', { models: models.length, paletteEntries: palette.length });
    return { models, palette };
  }

  /**
   * Convert a VoxModel into a BufferGeometry. Each voxel becomes a unit
   * cube positioned at (x, y, z); all cubes are merged into a single
   * indexed geometry with position, normal, and color attributes.
   *
   * Vertex count per voxel: 24 (4 verts × 6 faces).
   * Index count per voxel: 36 (2 triangles × 6 faces).
   */
  static voxelsToGeometry(model: VoxModel, palette: Color[]): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // 6 cube faces: each has 4 corners (relative to voxel origin) + a normal.
    // Winding is CCW when viewed from outside.
    const FACES: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
      // +X
      { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
      // -X
      { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
      // +Y
      { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
      // -Y
      { normal: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
      // +Z
      { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
      // -Z
      { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
    ];

    for (const voxel of model.voxels) {
      const color = palette[voxel.colorIndex] ?? palette[0] ?? new Color(1, 1, 1);
      const base = positions.length / 3;

      for (const face of FACES) {
        const [nx, ny, nz] = face.normal;
        for (const [cx, cy, cz] of face.corners) {
          positions.push(voxel.x + cx, voxel.y + cy, voxel.z + cz);
          normals.push(nx, ny, nz);
          colors.push(color.r, color.g, color.b);
        }
        // Two triangles: (0,1,2) and (0,2,3) relative to face base.
        const fb = base + FACES.indexOf(face) * 4;
        indices.push(fb, fb + 1, fb + 2, fb, fb + 2, fb + 3);
      }
    }

    const geom = new BufferGeometry();
    if (positions.length > 0) {
      geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      geom.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
      geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
      geom.setIndex(indices);
    }
    return geom;
  }

  /**
   * Convenience: parse a .vox buffer and return one Mesh per model, each
   * using a vertex-colored StandardMaterial (vertexColors not yet wired
   * through the renderer, but the 'color' attribute is present).
   */
  parseToMeshes(buffer: ArrayBuffer): Mesh[] {
    const { models, palette } = this.parse(buffer);
    const meshes: Mesh[] = [];
    for (const model of models) {
      const geom = VOXLoader.voxelsToGeometry(model, palette);
      const mat = new StandardMaterial();
      meshes.push(new Mesh(geom, mat));
    }
    return meshes;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/** Read a chunk header (id + contentSize + childrenSize) at `offset`. */
function readChunkHeader(dv: DataView, offset: number): ChunkHeader {
  const id = String.fromCharCode(
    dv.getUint8(offset),
    dv.getUint8(offset + 1),
    dv.getUint8(offset + 2),
    dv.getUint8(offset + 3),
  );
  const contentSize = dv.getUint32(offset + 4, true);
  const childrenSize = dv.getUint32(offset + 8, true);
  return { id, contentSize, childrenSize };
}

/** Parse a .vox ArrayBuffer (function shorthand). */
export function parseVOX(buffer: ArrayBuffer): VoxParseResult {
  return new VOXLoader().parse(buffer);
}
