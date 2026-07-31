// TextGeometry — 3D extruded text from a font definition. Adapted from
// three.js `src/geometries/TextGeometry.js` (MIT).
//
// three.js's TextGeometry loads a TypeFace JSON font (generated from a
// .ttf by opentype.js + a converter) and extrudes each glyph outline.
// VREEN does not yet ship a TypeFace font loader, so this implementation
// takes a simplified `FontDefinition` (a map of character → Vector2[]
// outlines) and extrudes each glyph with `ExtrudeGeometry`, merging the
// results into a single BufferGeometry.
//
// To use a real font: parse a .ttf with opentype.js, extract each glyph's
// outline as Vector2[] (and holes), build a FontDefinition, then pass it
// to TextGeometry. The built-in `createMinimalFont()` provides enough
// glyphs (A, B, C, 0, 1, space) for testing and basic UI labels.

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector2 } from '../Math/Vector2';
import { Shape } from './Shape';
import { ExtrudeGeometry, type ExtrudeOptions } from './ExtrudeGeometry';
import { createLogger } from '@/lib/logger';

const log = createLogger('TextGeometry');

/** A single glyph: character, 2D outline, optional holes, advance width. */
export interface FontCharacter {
  /** Character this glyph represents. */
  char: string;
  /** 2D outline as array of Vector2 points (closed loop, ≥ 3 points). */
  outline: Vector2[];
  /** Optional holes (each a closed Vector2[] loop inside the outline). */
  holes?: Vector2[][];
  /** Advance width (how far to move the pen for the next character). */
  advance: number;
}

/** A font: family name + map of character → glyph + metrics. */
export interface FontDefinition {
  family: string;
  /** Map of character → glyph. */
  glyphs: Record<string, FontCharacter>;
  /** Default line height (vertical advance per line). */
  lineHeight: number;
  /** Nominal size of the font (units). */
  size: number;
}

/** Options for TextGeometry: extrude options + text/font/layout settings. */
export interface TextGeometryOptions extends ExtrudeOptions {
  /** Font definition. */
  font: FontDefinition;
  /** Text to generate. */
  text: string;
  /** Letter spacing (default 0). */
  letterSpacing?: number;
  /** Line spacing multiplier (default 1.0). */
  lineSpacing?: number;
  /** Whether to center the text horizontally around X=0 (default false). */
  centered?: boolean;
}

/**
 * 3D text geometry from a font definition.
 *
 * Each character in `text` is looked up in `font.glyphs`, converted to a
 * `Shape`, extruded with `ExtrudeGeometry`, translated to the current pen
 * position, and merged into this geometry. Newlines advance the pen to the
 * next line; unknown characters are skipped (pen still advances by half a
 * space).
 */
export class TextGeometry extends BufferGeometry {
  readonly text: string;
  readonly font: FontDefinition;

  constructor(options: TextGeometryOptions) {
    super();
    this.text = options.text;
    this.font = options.font;
    this.build(options);
  }

  private build(options: TextGeometryOptions): void {
    const {
      font,
      text,
      letterSpacing = 0,
      lineSpacing = 1.0,
      centered = false,
    } = options;

    // Accumulate merged vertex data in plain arrays (text is small).
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    let currentX = 0;
    let currentY = 0;
    let maxWidth = 0;

    const lines = text.split('\n');
    for (const line of lines) {
      currentX = 0;
      for (const ch of line) {
        const glyph = font.glyphs[ch];
        if (!glyph) {
          // Unknown character: skip geometry, advance by half a space.
          log.debug('glyph not found, skipping', ch);
          currentX += font.size * 0.5 + letterSpacing;
          continue;
        }

        if (glyph.outline.length >= 3) {
          const shape = new Shape(glyph.outline);
          if (glyph.holes) {
            for (const hole of glyph.holes) {
              if (hole.length >= 3) shape.addHole(new Shape(hole));
            }
          }

          // Extrude this glyph. Inherit extrude options but default to a
          // flat (no-bevel) shallow extrude suitable for text.
          const geom = new ExtrudeGeometry(shape, {
            ...options,
            bevelEnabled: options.bevelEnabled ?? false,
            depth: options.depth ?? 0.2,
          });

          // Merge: offset positions by (currentX, currentY, 0), offset
          // indices by the current vertex count.
          const posAttr = geom.getAttribute('position');
          const uvAttr = geom.getAttribute('uv');
          const baseVertex = positions.length / 3;

          if (posAttr) {
            const arr = posAttr.array;
            for (let i = 0; i < arr.length; i += 3) {
              positions.push(arr[i] + currentX, arr[i + 1] + currentY, arr[i + 2]);
            }
          }
          if (uvAttr) {
            const arr = uvAttr.array;
            for (let i = 0; i < arr.length; i++) uvs.push(arr[i]);
          }
          if (geom.index) {
            const idx = geom.index.array as unknown as ArrayLike<number>;
            for (let i = 0; i < idx.length; i++) {
              indices.push(idx[i] + baseVertex);
            }
          }
        }

        currentX += glyph.advance + letterSpacing;
      }

      if (currentX > maxWidth) maxWidth = currentX;
      currentY -= font.lineHeight * lineSpacing;
    }

    if (positions.length === 0) {
      // Empty text or all glyphs missing → leave geometry empty.
      return;
    }

    // Center horizontally around X=0.
    if (centered && maxWidth > 0) {
      const offset = -maxWidth / 2;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += offset;
      }
    }

    this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    if (uvs.length > 0) {
      this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    }
    if (indices.length > 0) {
      this.setIndex(indices);
    }
    // ExtrudeGeometry doesn't emit normals; compute them from the merged
    // indexed positions so lighting works.
    this.computeVertexNormals();

    log.info('built text geometry', {
      text: text.slice(0, 20),
      verts: positions.length / 3,
      indices: indices.length,
    });
  }
}

/**
 * A minimal built-in font with a few basic ASCII characters (A, B, C, 0, 1,
 * space). Each glyph is a simple block-style outline on a unit grid
 * (0..1 wide, 0..1 tall). Sufficient for testing and basic UI labels.
 *
 * For real text, generate a FontDefinition from a .ttf using opentype.js.
 */
export function createMinimalFont(): FontDefinition {
  const V = (x: number, y: number) => new Vector2(x, y);

  const square = [V(0, 0), V(0, 1), V(1, 1), V(1, 0)];
  const triangle = [V(0, 0), V(0.5, 1), V(1, 0)];

  const glyphs: Record<string, FontCharacter> = {
    A: { char: 'A', outline: triangle, advance: 1.0 },
    B: { char: 'B', outline: square.slice(), advance: 1.0 },
    C: { char: 'C', outline: square.slice(), advance: 1.0 },
    '0': { char: '0', outline: square.slice(), advance: 1.0 },
    '1': { char: '1', outline: triangle.slice(), advance: 1.0 },
    ' ': { char: ' ', outline: [], advance: 0.5 },
  };

  return {
    family: 'minimal',
    glyphs,
    lineHeight: 1.2,
    size: 1.0,
  };
}
