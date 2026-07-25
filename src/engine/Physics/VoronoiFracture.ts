// VoronoiFracture — 基于 Voronoi 图的几何体破碎。
//
// 设计:
//   - generateSites(geometry, count):在几何体 AABB 内生成 count 个 Voronoi 站点
//     站点是均匀随机分布的点,作为每个碎片的"种子"
//   - fracture(geometry, sites):对每个站点,用它与其它所有站点的中垂面裁剪原几何,
//     得到该站点对应的 Voronoi 单元(凸多面体与原几何的交集)
//   - clipFragment(geometry, site, allSites):核心裁剪 — 把几何体用平面集合裁剪,
//     保留每个三角形在所有平面"内侧"的部分
//
// Voronoi 单元数学:
//   站点 s_i 的单元 = { x : |x - s_i| <= |x - s_j|, ∀j≠i }
//   展开: x · (s_j - s_i) <= (|s_j|² - |s_i|²)/2
//   即平面 normal=(s_j-s_i), constant=-(|s_j|²-|s_i|²)/2,保留 dist<=0 一侧
//
// 三角形裁剪:Sutherland-Hodgman 3D
//   - 对每个三角形 (a,b,c) 每个平面,根据三顶点在内/外分类
//   - 1 内 → 1 个三角形(a, ab 交点, ac 交点)
//   - 2 内 → 2 个三角形(quad 分裂)
//   - 3 内 → 原三角形
//   - 0 内 → 丢弃
//
// 与引擎的集成:
//   - 输入 BufferGeometry(position 属性,可选 index)
//   - 输出 BufferGeometry 数组(每个碎片一个,非索引化,仅 position)
//   - 调用方可对结果 geometry.computeVertexNormals() 重算法线

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math/Vector3';

/** Voronoi 站点(站点 + 可选用户数据)。 */
export interface VoronoiSite {
  position: Vector3;
  /** 站点索引(由 generateSites 填充)。 */
  index: number;
}

/** 内部使用的平面:ax + by + cz + d <= 0 为内侧。 */
interface ClipPlane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

/** 三角形顶点(仅位置,xyz)。 */
interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

export class VoronoiFracture {
  /** 随机数生成器(可注入用于确定性测试)。 */
  rand: () => number = Math.random;

  constructor(rand?: () => number) {
    if (rand) this.rand = rand;
  }

  /** 在 geometry AABB 内生成 count 个 Voronoi 站点。
   *  站点位置在 [min, max] 各轴上均匀分布。 */
  generateSites(geometry: BufferGeometry, count: number): VoronoiSite[] {
    if (count <= 0) {
      throw new Error(`VoronoiFracture.generateSites: count must be > 0 (got ${count})`);
    }
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb || bb.min.x > bb.max.x || bb.min.y > bb.max.y || bb.min.z > bb.max.z) {
      throw new Error(`VoronoiFracture.generateSites: geometry has empty bounding box`);
    }
    const sites: VoronoiSite[] = [];
    for (let i = 0; i < count; i++) {
      const t = this.rand();
      const u = this.rand();
      const v = this.rand();
      sites.push({
        position: new Vector3(
          bb.min.x + t * (bb.max.x - bb.min.x),
          bb.min.y + u * (bb.max.y - bb.min.y),
          bb.min.z + v * (bb.max.z - bb.min.z),
        ),
        index: i,
      });
    }
    return sites;
  }

  /** 根据站点把 geometry 破碎成多个碎片。
   *  每个站点对应一个 Voronoi 单元与原几何的交集(凸多面体)。
   *  返回非索引化 BufferGeometry 数组(仅 position 属性)。 */
  fracture(geometry: BufferGeometry, sites: VoronoiSite[]): BufferGeometry[] {
    if (sites.length === 0) {
      throw new Error(`VoronoiFracture.fracture: sites must be non-empty`);
    }
    // 解码原几何为三角形列表(展开索引)
    const baseTris = this._extractTriangles(geometry);
    if (baseTris.length === 0) return [];

    const results: BufferGeometry[] = [];
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      // 构造裁剪平面集合:对每个其它站点 j,平面 = (s_j - s_i) 与 (|s_i|²-|s_j|²)/2
      const planes: ClipPlane[] = [];
      for (let j = 0; j < sites.length; j++) {
        if (j === i) continue;
        const other = sites[j];
        const nx = other.position.x - site.position.x;
        const ny = other.position.y - site.position.y;
        const nz = other.position.z - site.position.z;
        const si2 = site.position.x * site.position.x
          + site.position.y * site.position.y
          + site.position.z * site.position.z;
        const sj2 = other.position.x * other.position.x
          + other.position.y * other.position.y
          + other.position.z * other.position.z;
        // dist = n · x - (sj2 - si2)/2 = n·x + (si2 - sj2)/2
        // 内侧(dist<=0): x·(s_j-s_i) <= (sj2 - si2)/2
        const d = (si2 - sj2) / 2;
        planes.push({ nx, ny, nz, d });
      }
      // 裁剪
      const fragmentTris = this._clipTriangles(baseTris, planes);
      if (fragmentTris.length === 0) continue;
      // 估算体积:跳过退化(零体积)碎片
      let hasVolume = false;
      for (const t of fragmentTris) {
        if (this._triArea(t) > 1e-12) { hasVolume = true; break; }
      }
      if (!hasVolume) continue;
      results.push(this._buildGeometry(fragmentTris));
    }
    return results;
  }

  /** 把 geometry 用 (site, allSites) 决定的 Voronoi 平面集合裁剪,返回单碎片。 */
  clipFragment(geometry: BufferGeometry, site: VoronoiSite, allSites: VoronoiSite[]): BufferGeometry | null {
    if (allSites.length === 0) return null;
    const baseTris = this._extractTriangles(geometry);
    if (baseTris.length === 0) return null;
    const planes: ClipPlane[] = [];
    for (const other of allSites) {
      if (other.index === site.index) continue;
      const nx = other.position.x - site.position.x;
      const ny = other.position.y - site.position.y;
      const nz = other.position.z - site.position.z;
      const si2 = site.position.x * site.position.x
        + site.position.y * site.position.y
        + site.position.z * site.position.z;
      const sj2 = other.position.x * other.position.x
        + other.position.y * other.position.y
        + other.position.z * other.position.z;
      const d = (si2 - sj2) / 2;
      planes.push({ nx, ny, nz, d });
    }
    const tris = this._clipTriangles(baseTris, planes);
    if (tris.length === 0) return null;
    return this._buildGeometry(tris);
  }

  /** 把 BufferGeometry 解码为三角形列表(展开索引)。 */
  private _extractTriangles(geometry: BufferGeometry): Tri[] {
    const pos = geometry.attributes.position;
    if (!pos) return [];
    const p = pos.array;
    const tris: Tri[] = [];
    const idx = geometry.index;
    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      const triCount = Math.floor(ia.length / 3);
      for (let i = 0; i < triCount; i++) {
        const a = ia[i * 3] * 3;
        const b = ia[i * 3 + 1] * 3;
        const c = ia[i * 3 + 2] * 3;
        tris.push({
          ax: p[a], ay: p[a + 1], az: p[a + 2],
          bx: p[b], by: p[b + 1], bz: p[b + 2],
          cx: p[c], cy: p[c + 1], cz: p[c + 2],
        });
      }
    } else {
      const triCount = Math.floor(p.length / 9);
      for (let i = 0; i < triCount; i++) {
        const a = i * 9;
        tris.push({
          ax: p[a],     ay: p[a + 1], az: p[a + 2],
          bx: p[a + 3], by: p[a + 4], bz: p[a + 5],
          cx: p[a + 6], cy: p[a + 7], cz: p[a + 8],
        });
      }
    }
    return tris;
  }

  /** 用平面集合逐平面裁剪三角形列表(Sutherland-Hodgman 3D)。 */
  private _clipTriangles(tris: Tri[], planes: ClipPlane[]): Tri[] {
    let current = tris;
    for (const plane of planes) {
      if (current.length === 0) break;
      const next: Tri[] = [];
      for (const t of current) {
        this._clipTriangleAgainstPlane(t, plane, next);
      }
      current = next;
    }
    return current;
  }

  /** 单三角形对单平面裁剪,把内侧结果(0/1/2 个三角形)追加到 out。 */
  private _clipTriangleAgainstPlane(t: Tri, plane: ClipPlane, out: Tri[]): void {
    const { nx, ny, nz, d } = plane;
    const da = nx * t.ax + ny * t.ay + nz * t.az + d;
    const db = nx * t.bx + ny * t.by + nz * t.bz + d;
    const dc = nx * t.cx + ny * t.cy + nz * t.cz + d;
    // 内侧 = dist <= 0
    const insideA = da <= 0;
    const insideB = db <= 0;
    const insideC = dc <= 0;
    const count = (insideA ? 1 : 0) + (insideB ? 1 : 0) + (insideC ? 1 : 0);
    if (count === 3) {
      out.push(t);
      return;
    }
    if (count === 0) {
      return;
    }
    // 计算 a-b 边与平面交点参数 t_ab = da/(da-db),交点 = a + t_ab*(b-a)
    // 用内插函数避免重复代码
    const lerp = (ax: number, ay: number, az: number,
                  bx: number, by: number, bz: number,
                  da: number, db: number): [number, number, number] => {
      const t = da / (da - db);
      return [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
    };

    if (count === 1) {
      // 仅一个内点,生成 1 个三角形(内点 + 两条边的交点)
      if (insideA) {
        const [px, py, pz] = lerp(t.ax, t.ay, t.az, t.bx, t.by, t.bz, da, db);
        const [qx, qy, qz] = lerp(t.ax, t.ay, t.az, t.cx, t.cy, t.cz, da, dc);
        out.push({ ax: t.ax, ay: t.ay, az: t.az, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
      } else if (insideB) {
        const [px, py, pz] = lerp(t.bx, t.by, t.bz, t.ax, t.ay, t.az, db, da);
        const [qx, qy, qz] = lerp(t.bx, t.by, t.bz, t.cx, t.cy, t.cz, db, dc);
        out.push({ ax: t.bx, ay: t.by, az: t.bz, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
      } else {
        // insideC
        const [px, py, pz] = lerp(t.cx, t.cy, t.cz, t.ax, t.ay, t.az, dc, da);
        const [qx, qy, qz] = lerp(t.cx, t.cy, t.cz, t.bx, t.by, t.bz, dc, db);
        out.push({ ax: t.cx, ay: t.cy, az: t.cz, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
      }
      return;
    }
    // count === 2: 两个内点,生成 2 个三角形(quad 分裂)
    if (!insideA) {
      // b, c 内; 边 a-b 与 a-c 与平面相交
      const [pbx, pby, pbz] = lerp(t.bx, t.by, t.bz, t.ax, t.ay, t.az, db, da);
      const [pcx, pcy, pcz] = lerp(t.cx, t.cy, t.cz, t.ax, t.ay, t.az, dc, da);
      // quad: b, c, pc, pb → 三角形 (b, c, pc) + (b, pc, pb)
      out.push({
        ax: t.bx, ay: t.by, az: t.bz,
        bx: t.cx, by: t.cy, bz: t.cz,
        cx: pcx, cy: pcy, cz: pcz,
      });
      out.push({
        ax: t.bx, ay: t.by, az: t.bz,
        bx: pcx, by: pcy, bz: pcz,
        cx: pbx, cy: pby, cz: pbz,
      });
    } else if (!insideB) {
      // a, c 内
      const [pax, pay, paz] = lerp(t.ax, t.ay, t.az, t.bx, t.by, t.bz, da, db);
      const [pcx, pcy, pcz] = lerp(t.cx, t.cy, t.cz, t.bx, t.by, t.bz, dc, db);
      // quad: a, c, pc, pa → (a, c, pc) + (a, pc, pa)
      out.push({
        ax: t.ax, ay: t.ay, az: t.az,
        bx: t.cx, by: t.cy, bz: t.cz,
        cx: pcx, cy: pcy, cz: pcz,
      });
      out.push({
        ax: t.ax, ay: t.ay, az: t.az,
        bx: pcx, by: pcy, bz: pcz,
        cx: pax, cy: pay, cz: paz,
      });
    } else {
      // !insideC: a, b 内
      const [pax, pay, paz] = lerp(t.ax, t.ay, t.az, t.cx, t.cy, t.cz, da, dc);
      const [pbx, pby, pbz] = lerp(t.bx, t.by, t.bz, t.cx, t.cy, t.cz, db, dc);
      // quad: a, b, pb, pa → (a, b, pb) + (a, pb, pa)
      out.push({
        ax: t.ax, ay: t.ay, az: t.az,
        bx: t.bx, by: t.by, bz: t.bz,
        cx: pbx, cy: pby, cz: pbz,
      });
      out.push({
        ax: t.ax, ay: t.ay, az: t.az,
        bx: pbx, by: pby, bz: pbz,
        cx: pax, cy: pay, cz: paz,
      });
    }
  }

  /** 三角形面积(叉积模长 / 2),用于退化检测。 */
  private _triArea(t: Tri): number {
    const ex = t.bx - t.ax;
    const ey = t.by - t.ay;
    const ez = t.bz - t.az;
    const fx = t.cx - t.ax;
    const fy = t.cy - t.ay;
    const fz = t.cz - t.az;
    // cross e × f
    const cx = ey * fz - ez * fy;
    const cy = ez * fx - ex * fz;
    const cz = ex * fy - ey * fx;
    return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  /** 把三角形列表组装为非索引化 BufferGeometry(仅 position 属性)。 */
  private _buildGeometry(tris: Tri[]): BufferGeometry {
    const positions = new Float32Array(tris.length * 9);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const o = i * 9;
      positions[o] = t.ax;     positions[o + 1] = t.ay; positions[o + 2] = t.az;
      positions[o + 3] = t.bx; positions[o + 4] = t.by; positions[o + 5] = t.bz;
      positions[o + 6] = t.cx; positions[o + 7] = t.cy; positions[o + 8] = t.cz;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
