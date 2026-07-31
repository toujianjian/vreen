import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { LineCurve3 } from '../Curves/LineCurve3';
import { CatmullRomCurve3 } from '../Curves/CatmullRomCurve3';
import { TubeGeometry } from './TubeGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('TubeGeometry', () => {
  it('LineCurve3 with radius 1, tubular 4, radial 4 → 25 verts / 32 tris', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const g = new TubeGeometry(curve, {
      radius: 1,
      tubularSegments: 4,
      radialSegments: 4,
    });
    // (tubularSegments + 1) * (radialSegments + 1) = 5 * 5 = 25
    expect(g.attributes.position.count).toBe(25);
    // tubularSegments * radialSegments * 2 triangles * 3 indices = 4 * 4 * 6 = 96
    expect(g.index?.count).toBe(96);
    expect(g.attributes.position.array).toBeInstanceOf(Float32Array);
  });

  it('attribute arrays contain no NaN (LineCurve3)', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const g = new TubeGeometry(curve, {
      radius: 0.5,
      tubularSegments: 16,
      radialSegments: 8,
    });
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
  });

  it('CatmullRomCurve3 through 3 points produces vertices', () => {
    const curve = new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(1, 2, 0),
      new Vector3(3, 0, 1),
    ]);
    const g = new TubeGeometry(curve, {
      radius: 0.3,
      tubularSegments: 16,
      radialSegments: 8,
    });
    expect(g.attributes.position.count).toBeGreaterThan(0);
    expect(g.attributes.position.array.length).toBeGreaterThan(0);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
  });

  it('closed=true connects end to start', () => {
    const curve = new CatmullRomCurve3(
      [
        new Vector3(0, 0, 0),
        new Vector3(2, 1, 0),
        new Vector3(4, 0, 1),
        new Vector3(2, -1, 0),
      ],
      true, // closed
    );
    // radius 0 → every vertex lies exactly on the curve, so we can compare
    // ring positions directly to confirm the closure (start ring == end ring).
    const g = new TubeGeometry(curve, {
      radius: 0,
      tubularSegments: 8,
      radialSegments: 4,
      closed: true,
    });
    expect(g.attributes.position.count).toBeGreaterThan(0);
    expect(hasNaN(g.attributes.position.array)).toBe(false);

    // Ring 0 and ring `tubularSegments` should coincide (curve closes).
    const p = g.attributes.position.array;
    const rs = 4; // radialSegments
    const v0x = p[0], v0y = p[1], v0z = p[2];
    const last = 8 * (rs + 1); // index of ring tubularSegments, vertex 0
    const vLx = p[last * 3], vLy = p[last * 3 + 1], vLz = p[last * 3 + 2];
    expect(v0x).toBeCloseTo(vLx, 4);
    expect(v0y).toBeCloseTo(vLy, 4);
    expect(v0z).toBeCloseTo(vLz, 4);
  });

  it('radius=0 produces a degenerate tube (all vertices on the curve)', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const g = new TubeGeometry(curve, {
      radius: 0,
      tubularSegments: 4,
      radialSegments: 4,
    });
    const p = g.attributes.position.array;
    // For a +X line, every vertex should lie on the line: y ≈ 0, z ≈ 0, x in [0, 10].
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.abs(p[i + 1])).toBeLessThan(1e-6); // y
      expect(Math.abs(p[i + 2])).toBeLessThan(1e-6); // z
      expect(p[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(p[i]).toBeLessThanOrEqual(10 + 1e-6);
    }
  });

  it('tubularSegments=1, radialSegments=3 minimum case does not crash', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    const g = new TubeGeometry(curve, {
      radius: 0.2,
      tubularSegments: 1,
      radialSegments: 3,
    });
    // (1+1) * (3+1) = 8 vertices; 1 * 3 * 6 = 18 indices.
    expect(g.attributes.position.count).toBe(8);
    expect(g.index?.count).toBe(18);
    expect(hasNaN(g.attributes.position.array)).toBe(false);
  });

  it('UV attribute exists and lies in [0, 1]', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const g = new TubeGeometry(curve, {
      radius: 0.5,
      tubularSegments: 8,
      radialSegments: 6,
    });
    expect(g.attributes.uv).toBeDefined();
    const uv = g.attributes.uv.array;
    expect(uv.length).toBeGreaterThan(0);
    for (let i = 0; i < uv.length; i++) {
      expect(uv[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(uv[i]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('vertex normals are unit length (outward radial direction)', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const g = new TubeGeometry(curve, {
      radius: 1,
      tubularSegments: 8,
      radialSegments: 8,
    });
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});
