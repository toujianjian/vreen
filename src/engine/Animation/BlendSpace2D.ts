// BlendSpace2D — 2D animation blend space.
//
// 根据二维输入参数(如前向速度 + 横向速度)在多个 AnimationClip 之间
// 通过 Delaunay 三角剖分 + 重心坐标进行混合。BlendSpace1D 处理单速度轴,
// BlendSpace2D 处理方向轴(前进/后退/左移/右移),自然支持任意方向混合。
//
// 算法(adapted from o3de EMotionFX BlendSpace2DNode):
//   1. 对样本点做 Delaunay 三角剖分(Bowyer-Watson 增量算法)。
//   2. 找到包含查询点的三角形。
//   3. 计算重心坐标 → 三个顶点的权重。
//   4. 若点在凸包外,投影到最近边,在两端点间插值。
//   5. 若样本共线(无法构成三角形),在所有样本对中找最近线段插值。
//
// 与 BlendSpace1D 的区别:1D 在数轴上找 bracket 线性插值;
// 2D 在平面上找三角形做重心插值。本类只负责权重计算,不直接驱动 playhead
// (混合结果交由调用方与 AnimationMixer 组合,与 1D 解耦)。

import { Vector2 } from '../Math/Vector2';
import { createLogger } from '@/lib/logger';

const log = createLogger('BlendSpace2D');

export interface BlendSpace2DSample {
  /** Animation clip id. */
  clipId: string;
  /** 2D position in blend space (e.g. forward speed, strafe speed). */
  position: Vector2;
  /** Optional weight override (default 1). */
  weight?: number;
}

export interface BlendSpace2DResult {
  /** Up to 3 sampled clips with their blend weights (sum to 1). */
  samples: Array<{ clipId: string; weight: number }>;
}

/**
 * 2D animation blend space. Given a 2D input (e.g. move direction),
 * finds the triangle of sample points surrounding the input and
 * computes barycentric weights for each.
 *
 * Adapted from o3de EMotionFX `BlendSpace2DNode`. VREEN's `BlendSpace1D`
 * handles 1D (Idle↔Walk↔Run); this handles 2D (forward/strafe).
 */
export class BlendSpace2D {
  samples: BlendSpace2DSample[] = [];
  /** Triangulation (computed on rebuild). Each triangle is 3 sample indices. */
  private triangles: Array<[number, number, number]> = [];
  private dirty: boolean = true;

  addSample(sample: BlendSpace2DSample): this {
    this.samples.push(sample);
    this.dirty = true;
    return this;
  }

  removeSample(clipId: string): boolean {
    const idx = this.samples.findIndex(s => s.clipId === clipId);
    if (idx < 0) return false;
    this.samples.splice(idx, 1);
    this.dirty = true;
    return true;
  }

  clear(): void {
    this.samples.length = 0;
    this.triangles.length = 0;
    this.dirty = true;
  }

  /** Rebuild the triangulation. Call after adding/removing samples. */
  rebuild(): void {
    if (!this.dirty) return;
    this.triangles = this.computeDelaunay(this.samples.map(s => s.position));
    this.dirty = false;
    log.debug('rebuilt triangulation', { samples: this.samples.length, triangles: this.triangles.length });
  }

  /**
   * Sample the blend space at a 2D point.
   * Returns up to 3 clips with barycentric weights.
   */
  sample(point: Vector2): BlendSpace2DResult {
    if (this.dirty) this.rebuild();
    const n = this.samples.length;
    if (n === 0) return { samples: [] };
    if (n === 1) return { samples: [{ clipId: this.samples[0].clipId, weight: 1 }] };
    if (n === 2) {
      const w = projectOnSegment(point, this.samples[0].position, this.samples[1].position);
      return { samples: [
        { clipId: this.samples[0].clipId, weight: 1 - w },
        { clipId: this.samples[1].clipId, weight: w },
      ] };
    }

    // 3+ samples: try to find a containing triangle.
    if (this.triangles.length > 0) {
      for (const tri of this.triangles) {
        const bary = barycentric(
          point,
          this.samples[tri[0]].position,
          this.samples[tri[1]].position,
          this.samples[tri[2]].position,
        );
        if (bary !== null && bary.a >= -EPS && bary.b >= -EPS && bary.c >= -EPS) {
          return { samples: [
            { clipId: this.samples[tri[0]].clipId, weight: clampNonNeg(bary.a) },
            { clipId: this.samples[tri[1]].clipId, weight: clampNonNeg(bary.b) },
            { clipId: this.samples[tri[2]].clipId, weight: clampNonNeg(bary.c) },
          ] };
        }
      }
      // Outside convex hull: project to nearest triangle edge.
      let bestEdge: [number, number] | null = null;
      let bestDist = Infinity;
      let bestT = 0;
      for (const tri of this.triangles) {
        for (let i = 0; i < 3; i++) {
          const a = tri[i], b = tri[(i + 1) % 3];
          const t = projectOnSegment(point, this.samples[a].position, this.samples[b].position);
          const proj = lerp(this.samples[a].position, this.samples[b].position, t);
          const d = distance(point, proj);
          if (d < bestDist) { bestDist = d; bestEdge = [a, b]; bestT = t; }
        }
      }
      if (bestEdge) {
        return { samples: [
          { clipId: this.samples[bestEdge[0]].clipId, weight: 1 - bestT },
          { clipId: this.samples[bestEdge[1]].clipId, weight: bestT },
        ] };
      }
    }

    // Fallback: no triangles (collinear / degenerate samples).
    // Find the nearest segment among all sample pairs and interpolate.
    let bestPair: [number, number] | null = null;
    let bestSegDist = Infinity;
    let bestSegT = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const t = projectOnSegment(point, this.samples[i].position, this.samples[j].position);
        const proj = lerp(this.samples[i].position, this.samples[j].position, t);
        const d = distance(point, proj);
        if (d < bestSegDist) { bestSegDist = d; bestPair = [i, j]; bestSegT = t; }
      }
    }
    if (bestPair) {
      return { samples: [
        { clipId: this.samples[bestPair[0]].clipId, weight: 1 - bestSegT },
        { clipId: this.samples[bestPair[1]].clipId, weight: bestSegT },
      ] };
    }
    return { samples: [{ clipId: this.samples[0].clipId, weight: 1 }] };
  }

  /**
   * Delaunay triangulation via the Bowyer-Watson incremental algorithm.
   * Robust for small N (< 100). Returns triangles as sample-index triples.
   * Returns an empty array when points are collinear or fewer than 3.
   */
  private computeDelaunay(points: Vector2[]): Array<[number, number, number]> {
    const n = points.length;
    if (n < 3) return [];

    // Bounding box → super-triangle enclosing all points.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const dx = (maxX - minX) || 1;
    const dy = (maxY - minY) || 1;
    const delta = Math.max(dx, dy) * 20;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    // Vertex pool: real points [0..n-1], super-triangle [n, n+1, n+2].
    const verts: Vector2[] = points.slice();
    verts.push(new Vector2(midX - delta * 5, midY - delta));
    verts.push(new Vector2(midX + delta * 5, midY - delta));
    verts.push(new Vector2(midX, midY + delta * 5));

    let triangles: Array<[number, number, number]> = [[n, n + 1, n + 2]];

    for (let p = 0; p < n; p++) {
      const point = verts[p];
      const bad: Array<[number, number, number]> = [];
      const good: Array<[number, number, number]> = [];
      for (const tri of triangles) {
        if (inCircumcircle(point, verts[tri[0]], verts[tri[1]], verts[tri[2]])) {
          bad.push(tri);
        } else {
          good.push(tri);
        }
      }
      // Boundary edges of the bad-triangles polygon (edges appearing once).
      const edgeMap = new Map<string, [number, number]>();
      for (const tri of bad) {
        const edges: Array<[number, number]> = [
          [tri[0], tri[1]],
          [tri[1], tri[2]],
          [tri[2], tri[0]],
        ];
        for (const [a, b] of edges) {
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (edgeMap.has(key)) {
            edgeMap.delete(key);
          } else {
            edgeMap.set(key, [a, b]);
          }
        }
      }
      triangles = good;
      for (const [a, b] of edgeMap.values()) {
        triangles.push([a, b, p]);
      }
    }

    // Drop triangles that touch the super-triangle.
    const result: Array<[number, number, number]> = [];
    for (const tri of triangles) {
      if (tri[0] < n && tri[1] < n && tri[2] < n) {
        result.push([tri[0], tri[1], tri[2]]);
      }
    }
    return result;
  }
}

// ── Helper functions ─────────────────────────────────────────────

const EPS = 1e-9;

function clampNonNeg(v: number): number {
  return v < 0 ? 0 : v;
}

/**
 * Barycentric coordinates of `p` in triangle (`a`, `b`, `c`).
 * Returns `null` if the triangle is degenerate (zero area).
 */
function barycentric(
  p: Vector2, a: Vector2, b: Vector2, c: Vector2,
): { a: number; b: number; c: number } | null {
  const v0x = c.x - a.x, v0y = c.y - a.y;
  const v1x = b.x - a.x, v1y = b.y - a.y;
  const v2x = p.x - a.x, v2y = p.y - a.y;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-12) return null;
  const wb = (dot11 * dot02 - dot01 * dot12) / denom;
  const wc = (dot00 * dot12 - dot01 * dot02) / denom;
  const wa = 1 - wb - wc;
  return { a: wa, b: wb, c: wc };
}

/** Project `p` onto segment `a`-`b`, return parameter `t` clamped to [0, 1]. */
function projectOnSegment(p: Vector2, a: Vector2, b: Vector2): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return 0;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** Linear interpolation between two vectors. */
function lerp(a: Vector2, b: Vector2, t: number): Vector2 {
  return new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

/** Euclidean distance between two points. */
function distance(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Circumcenter of triangle (`a`, `b`, `c`); `null` if collinear. */
function circumcenter(a: Vector2, b: Vector2, c: Vector2): Vector2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  const ux = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
  const uy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
  return new Vector2(ux, uy);
}

/** In-circumcircle test for the Bowyer-Watson algorithm. */
function inCircumcircle(p: Vector2, a: Vector2, b: Vector2, c: Vector2): boolean {
  const center = circumcenter(a, b, c);
  if (center === null) return false;
  const r = distance(a, center);
  return distance(p, center) < r - 1e-10;
}
