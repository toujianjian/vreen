import { describe, it, expect } from 'vitest';
import { TextGeometry, createMinimalFont, type FontDefinition } from './TextGeometry';
import { Vector2 } from '../Math';

/** Compute the AABB of the position attribute (or null if empty). */
function bbox(geom: TextGeometry): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const pos = geom.getAttribute('position');
  if (!pos) return null;
  const a = pos.array;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i], y = a[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

describe('TextGeometry', () => {
  it('constructor with minimal font, text "A" → geometry with positions', () => {
    const font = createMinimalFont();
    const g = new TextGeometry({ font, text: 'A', depth: 0.2, bevelEnabled: false });
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBeGreaterThan(0);
    expect(g.text).toBe('A');
    expect(g.font).toBe(font);
  });

  it('constructor with text "AB" → geometry larger than single char', () => {
    const font = createMinimalFont();
    const gA = new TextGeometry({ font, text: 'A', bevelEnabled: false });
    const gAB = new TextGeometry({ font, text: 'AB', bevelEnabled: false });
    expect(gAB.getAttribute('position')!.count).toBeGreaterThan(
      gA.getAttribute('position')!.count,
    );
    // Bounding box width of "AB" should exceed that of "A".
    const bbA = bbox(gA)!;
    const bbAB = bbox(gAB)!;
    expect(bbAB.maxX - bbAB.minX).toBeGreaterThan(bbA.maxX - bbA.minX);
  });

  it('constructor with text "A\\nB" (newline) → characters at different Y', () => {
    const font = createMinimalFont();
    const g = new TextGeometry({ font, text: 'A\nB', bevelEnabled: false });
    const bb = bbox(g)!;
    // 'A' occupies y ∈ [0, 1]; 'B' is on the next line at y ∈ [-1.2, -0.2].
    // So the combined bbox spans both positive and negative Y.
    expect(bb.minY).toBeLessThan(0);
    expect(bb.maxY).toBeGreaterThan(0);
  });

  it('constructor with letterSpacing=2 → wider than letterSpacing=0', () => {
    const font = createMinimalFont();
    const g0 = new TextGeometry({ font, text: 'AB', letterSpacing: 0, bevelEnabled: false });
    const g2 = new TextGeometry({ font, text: 'AB', letterSpacing: 2, bevelEnabled: false });
    const bb0 = bbox(g0)!;
    const bb2 = bbox(g2)!;
    expect(bb2.maxX - bb2.minX).toBeGreaterThan(bb0.maxX - bb0.minX);
  });

  it('constructor with centered=true → geometry centered around X=0', () => {
    const font = createMinimalFont();
    const g = new TextGeometry({ font, text: 'A', centered: true, bevelEnabled: false });
    const bb = bbox(g)!;
    // Centered → minX ≈ -maxX (symmetric around 0).
    expect(Math.abs(bb.minX + bb.maxX)).toBeLessThan(1e-6);
  });

  it('createMinimalFont returns valid FontDefinition with glyphs', () => {
    const font = createMinimalFont();
    expect(font.family).toBe('minimal');
    expect(font.lineHeight).toBeGreaterThan(0);
    expect(font.size).toBeGreaterThan(0);
    expect(font.glyphs['A']).toBeDefined();
    expect(font.glyphs['A'].outline.length).toBeGreaterThanOrEqual(3);
    expect(font.glyphs['A'].advance).toBeGreaterThan(0);
    expect(font.glyphs['B']).toBeDefined();
    expect(font.glyphs['C']).toBeDefined();
    expect(font.glyphs['0']).toBeDefined();
    expect(font.glyphs['1']).toBeDefined();
    expect(font.glyphs[' ']).toBeDefined();
  });

  it('empty text → empty geometry', () => {
    const font = createMinimalFont();
    const g = new TextGeometry({ font, text: '', bevelEnabled: false });
    expect(g.getAttribute('position')).toBeUndefined();
    expect(g.index).toBeNull();
  });

  it('character not in font → skipped (no crash)', () => {
    const font = createMinimalFont();
    // 'X' and 'Z' are not in the minimal font; should be skipped without error.
    const g = new TextGeometry({ font, text: 'XZ', bevelEnabled: false });
    expect(g.getAttribute('position')).toBeUndefined();
    // A mix of known and unknown chars: 'AX' should still produce geometry for 'A'.
    const g2 = new TextGeometry({ font, text: 'AX', bevelEnabled: false });
    expect(g2.getAttribute('position')).toBeDefined();
    expect(g2.getAttribute('position')!.count).toBeGreaterThan(0);
  });

  it('accepts a custom FontDefinition with holes', () => {
    const font: FontDefinition = {
      family: 'test',
      lineHeight: 1.5,
      size: 1,
      glyphs: {
        O: {
          char: 'O',
          outline: [new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0)],
          holes: [[new Vector2(0.25, 0.25), new Vector2(0.75, 0.25), new Vector2(0.75, 0.75), new Vector2(0.25, 0.75)]],
          advance: 1.0,
        },
      },
    };
    const g = new TextGeometry({ font, text: 'O', bevelEnabled: false });
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBeGreaterThan(0);
    // A glyph with a hole should have more vertices than one without
    // (the hole adds inner contour vertices).
    const gNoHole = new TextGeometry({
      font: { ...font, glyphs: { O: { ...font.glyphs.O, holes: undefined } } },
      text: 'O',
      bevelEnabled: false,
    });
    expect(g.getAttribute('position')!.count).toBeGreaterThan(
      gNoHole.getAttribute('position')!.count,
    );
  });
});
