// PolyhedronGeometry — 正多面体几何体,从顶点数组 + 面索引构建可细分的球面多面体。
// 参考: three.js/src/geometries/PolyhedronGeometry.js
//
// 包含 5 个类:
//   * PolyhedronGeometry  — 基类,从任意顶点/索引构建
//   * TetrahedronGeometry — 正四面体 (4 面)
//   * OctahedronGeometry  — 正八面体 (8 面)
//   * DodecahedronGeometry — 正十二面体 (12 面,五边形面被三角化)
//   * IcosahedronGeometry — 正二十面体 (20 面)
//
// 算法:
//   1. subdivide(detail): 对每个三角面递归细分,detail=0 不细分,
//      detail=n 将每条边分成 n+1 段,产生 (n+1)² 个子三角形。
//   2. applyRadius(radius): 将所有顶点归一化到给定半径的球面上。
//   3. generateUVs(): 球面 UV 映射(azimuth/inclination),含接缝修正。
//   4. 法线:detail=0 用 computeVertexNormals() 产生平面着色;
//      detail>0 直接归一化位置(平滑着色)。
//
// 输出: 非索引几何体(position + normal + uv)。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector2, Vector3 } from '../Math';

/**
 * 正多面体几何体基类。从顶点数组 + 面索引构建,支持面细分和球面半径投影。
 *
 * @param vertices 顶点坐标扁平数组 [x0,y0,z0, x1,y1,z1, ...]
 * @param indices  面索引数组(每 3 个为一组三角形)
 * @param radius   所有顶点投影到的球面半径(默认 1)
 * @param detail   细分级别(0 = 不细分,1 = 每面分 4 三角形,2 = 9,以此类推)
 */
export class PolyhedronGeometry extends BufferGeometry {
  constructor(
    vertices: number[] = [],
    indices: number[] = [],
    radius: number = 1,
    detail: number = 0,
  ) {
    super();

    const vertexBuffer: number[] = [];
    const uvBuffer: number[] = [];

    // ── Step 1: 细分 ──
    subdivide(detail);

    // ── Step 2: 投影到球面 ──
    applyRadius(radius);

    // ── Step 3: 生成 UV ──
    generateUVs();

    // ── Step 4: 构建属性 ──
    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(vertexBuffer), 3),
    );
    // 法线初始 = 位置(已在球面上,方向正确)
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(vertexBuffer), 3),
    );
    this.setAttribute(
      'uv',
      new BufferAttribute(new Float32Array(uvBuffer), 2),
    );

    if (detail === 0) {
      this.computeVertexNormals(); // 平面着色
    } else {
      this.normalizeNormals(); // 平滑着色
    }

    this.computeBoundingBox();

    // ── 内部函数 ──────────────────────────────────────────────

    function subdivide(detail: number): void {
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();

      for (let i = 0; i < indices.length; i += 3) {
        getVertexByIndex(indices[i], a);
        getVertexByIndex(indices[i + 1], b);
        getVertexByIndex(indices[i + 2], c);
        subdivideFace(a, b, c, detail);
      }
    }

    function subdivideFace(
      a: Vector3,
      b: Vector3,
      c: Vector3,
      detail: number,
    ): void {
      const cols = detail + 1;
      const v: Vector3[][] = [];

      // 构造细分顶点网格
      for (let i = 0; i <= cols; i++) {
        v[i] = [];
        const aj = a.clone().lerp(c, i / cols);
        const bj = b.clone().lerp(c, i / cols);
        const rows = cols - i;
        for (let j = 0; j <= rows; j++) {
          if (j === 0 && i === cols) {
            v[i][j] = aj;
          } else {
            v[i][j] = aj.clone().lerp(bj, j / rows);
          }
        }
      }

      // 构造三角形
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < 2 * (cols - i) - 1; j++) {
          const k = Math.floor(j / 2);
          if (j % 2 === 0) {
            pushVertex(v[i][k + 1]);
            pushVertex(v[i + 1][k]);
            pushVertex(v[i][k]);
          } else {
            pushVertex(v[i][k + 1]);
            pushVertex(v[i + 1][k + 1]);
            pushVertex(v[i + 1][k]);
          }
        }
      }
    }

    function applyRadius(radius: number): void {
      const vertex = new Vector3();
      for (let i = 0; i < vertexBuffer.length; i += 3) {
        vertex.set(
          vertexBuffer[i],
          vertexBuffer[i + 1],
          vertexBuffer[i + 2],
        );
        vertex.normalize().multiplyScalar(radius);
        vertexBuffer[i] = vertex.x;
        vertexBuffer[i + 1] = vertex.y;
        vertexBuffer[i + 2] = vertex.z;
      }
    }

    function generateUVs(): void {
      const vertex = new Vector3();
      for (let i = 0; i < vertexBuffer.length; i += 3) {
        vertex.set(
          vertexBuffer[i],
          vertexBuffer[i + 1],
          vertexBuffer[i + 2],
        );
        const u = azimuth(vertex) / (2 * Math.PI) + 0.5;
        const v = inclination(vertex) / Math.PI + 0.5;
        uvBuffer.push(u, 1 - v);
      }
      correctUVs();
      correctSeam();
    }

    function correctSeam(): void {
      for (let i = 0; i < uvBuffer.length; i += 6) {
        const x0 = uvBuffer[i];
        const x1 = uvBuffer[i + 2];
        const x2 = uvBuffer[i + 4];
        const max = Math.max(x0, x1, x2);
        const min = Math.min(x0, x1, x2);
        if (max > 0.9 && min < 0.1) {
          if (x0 < 0.2) uvBuffer[i] += 1;
          if (x1 < 0.2) uvBuffer[i + 2] += 1;
          if (x2 < 0.2) uvBuffer[i + 4] += 1;
        }
      }
    }

    function pushVertex(vertex: Vector3): void {
      vertexBuffer.push(vertex.x, vertex.y, vertex.z);
    }

    function getVertexByIndex(index: number, vertex: Vector3): void {
      const stride = index * 3;
      vertex.set(
        vertices[stride],
        vertices[stride + 1],
        vertices[stride + 2],
      );
    }

    function correctUVs(): void {
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      const centroid = new Vector3();
      const uvA = new Vector2();
      const uvB = new Vector2();
      const uvC = new Vector2();

      for (
        let i = 0, j = 0;
        i < vertexBuffer.length;
        i += 9, j += 6
      ) {
        a.set(vertexBuffer[i], vertexBuffer[i + 1], vertexBuffer[i + 2]);
        b.set(
          vertexBuffer[i + 3],
          vertexBuffer[i + 4],
          vertexBuffer[i + 5],
        );
        c.set(
          vertexBuffer[i + 6],
          vertexBuffer[i + 7],
          vertexBuffer[i + 8],
        );
        uvA.set(uvBuffer[j], uvBuffer[j + 1]);
        uvB.set(uvBuffer[j + 2], uvBuffer[j + 3]);
        uvC.set(uvBuffer[j + 4], uvBuffer[j + 5]);

        centroid.copy(a).add(b).add(c).divideScalar(3);
        const azi = azimuth(centroid);
        correctUV(uvA, j, a, azi);
        correctUV(uvB, j + 2, b, azi);
        correctUV(uvC, j + 4, c, azi);
      }
    }

    function correctUV(
      uv: Vector2,
      stride: number,
      vector: Vector3,
      azi: number,
    ): void {
      if (azi < 0 && uv.x === 1) {
        uvBuffer[stride] = uv.x - 1;
      }
      if (vector.x === 0 && vector.z === 0) {
        uvBuffer[stride] = azi / (2 * Math.PI) + 0.5;
      }
    }

    /** 绕 Y 轴的方位角(从上方看逆时针)。 */
    function azimuth(vector: Vector3): number {
      return Math.atan2(vector.z, -vector.x);
    }

    /** XZ 平面以上的倾角。 */
    function inclination(vector: Vector3): number {
      return Math.atan2(
        -vector.y,
        Math.sqrt(vector.x * vector.x + vector.z * vector.z),
      );
    }
  }

  /** 归一化法线缓冲(就地)。 */
  private normalizeNormals(): void {
    const normal = this.attributes.normal;
    if (!normal) return;
    const arr = normal.array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i];
      const y = arr[i + 1];
      const z = arr[i + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 0) {
        const inv = 1 / len;
        arr[i] = x * inv;
        arr[i + 1] = y * inv;
        arr[i + 2] = z * inv;
      }
    }
  }
}

/**
 * 正四面体(Tetrahedron)—— 4 个三角面,4 个顶点。
 *
 * @param radius 外接球半径(默认 1)
 * @param detail 细分级别(默认 0)
 */
export class TetrahedronGeometry extends PolyhedronGeometry {
  constructor(radius: number = 1, detail: number = 0) {
    const vertices = [
      1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1,
    ];
    const indices = [
      2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1,
    ];
    super(vertices, indices, radius, detail);
  }
}

/**
 * 正八面体(Octahedron)—— 8 个三角面,6 个顶点。
 *
 * @param radius 外接球半径(默认 1)
 * @param detail 细分级别(默认 0)
 */
export class OctahedronGeometry extends PolyhedronGeometry {
  constructor(radius: number = 1, detail: number = 0) {
    const vertices = [
      1, 0, 0, -1, 0, 0, 0, 1, 0,
      0, -1, 0, 0, 0, 1, 0, 0, -1,
    ];
    const indices = [
      0, 2, 4, 0, 4, 3, 0, 3, 5,
      0, 5, 2, 1, 2, 5, 1, 5, 3,
      1, 3, 4, 1, 4, 2,
    ];
    super(vertices, indices, radius, detail);
  }
}

/**
 * 正十二面体(Dodecahedron)—— 12 个五边形面(三角化为 36 个三角形),20 个顶点。
 * 使用黄金比例 φ = (1+√5)/2 构造。
 *
 * @param radius 外接球半径(默认 1)
 * @param detail 细分级别(默认 0)
 */
export class DodecahedronGeometry extends PolyhedronGeometry {
  constructor(radius: number = 1, detail: number = 0) {
    const t = (1 + Math.sqrt(5)) / 2;
    const r = 1 / t;
    const vertices = [
      // (±1, ±1, ±1)
      -1, -1, -1, -1, -1, 1,
      -1, 1, -1, -1, 1, 1,
      1, -1, -1, 1, -1, 1,
      1, 1, -1, 1, 1, 1,
      // (0, ±1/φ, ±φ)
      0, -r, -t, 0, -r, t,
      0, r, -t, 0, r, t,
      // (±1/φ, ±φ, 0)
      -r, -t, 0, -r, t, 0,
      r, -t, 0, r, t, 0,
      // (±φ, 0, ±1/φ)
      -t, 0, -r, t, 0, -r,
      -t, 0, r, t, 0, r,
    ];
    const indices = [
      3, 11, 7, 3, 7, 15, 3, 15, 13,
      7, 19, 17, 7, 17, 6, 7, 6, 15,
      17, 4, 8, 17, 8, 10, 17, 10, 6,
      8, 0, 16, 8, 16, 2, 8, 2, 10,
      0, 12, 1, 0, 1, 18, 0, 18, 16,
      6, 10, 2, 6, 2, 13, 6, 13, 15,
      2, 16, 18, 2, 18, 3, 2, 3, 13,
      18, 1, 9, 18, 9, 11, 18, 11, 3,
      4, 14, 12, 4, 12, 0, 4, 0, 8,
      11, 9, 5, 11, 5, 19, 11, 19, 7,
      19, 5, 14, 19, 14, 4, 19, 4, 17,
      1, 12, 14, 1, 14, 5, 1, 5, 9,
    ];
    super(vertices, indices, radius, detail);
  }
}

/**
 * 正二十面体(Icosahedron)—— 20 个三角面,12 个顶点。
 * 使用黄金比例 φ = (1+√5)/2 构造。
 *
 * @param radius 外接球半径(默认 1)
 * @param detail 细分级别(默认 0)
 */
export class IcosahedronGeometry extends PolyhedronGeometry {
  constructor(radius: number = 1, detail: number = 0) {
    const t = (1 + Math.sqrt(5)) / 2;
    const vertices = [
      -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
      0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
      t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
    ];
    const indices = [
      0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
      1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
      3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
      4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
    ];
    super(vertices, indices, radius, detail);
  }
}
