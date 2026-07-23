// TorusKnotGeometry — 环面纽结几何体,从 three.js 移植并适配 VREEN 引擎。
// 由一对互质整数 p/q 决定缠绕形状的纽结。
// 参考: three.js/src/geometries/TorusKnotGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';

/** 环面纽结:radius + tube + 管段数 + 圆周段数 + p + q。 */
export class TorusKnotGeometry extends BufferGeometry {
  constructor(
    radius = 1,
    tube = 0.4,
    tubularSegments = 64,
    radialSegments = 8,
    p = 2,
    q = 3,
  ) {
    super();

    tubularSegments = Math.floor(tubularSegments);
    radialSegments = Math.floor(radialSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const vertex = new Vector3();
    const normal = new Vector3();

    const P1 = new Vector3();
    const P2 = new Vector3();

    const B = new Vector3();
    const T = new Vector3();
    const N = new Vector3();

    // 生成顶点、法线与 uv
    for (let i = 0; i <= tubularSegments; i++) {
      // u 用于在纽结曲线上定位当前管段
      const u = (i / tubularSegments) * p * Math.PI * 2;

      // P1 为当前位置,P2 为稍前方位置,二者构造正交基
      calculatePositionOnCurve(u, p, q, radius, P1);
      calculatePositionOnCurve(u + 0.01, p, q, radius, P2);

      // 计算正交基(T 可忽略,只用 B 与 N)
      T.subVectors(P2, P1);
      N.addVectors(P2, P1);
      crossInto(B, T, N); // B = T × N
      crossInto(N, B, T); // N = B × T

      B.normalize();
      N.normalize();

      for (let j = 0; j <= radialSegments; j++) {
        // 沿管子周向挤出
        const v = (j / radialSegments) * Math.PI * 2;
        const cx = -tube * Math.cos(v);
        const cy = tube * Math.sin(v);

        vertex.x = P1.x + (cx * N.x + cy * B.x);
        vertex.y = P1.y + (cx * N.y + cy * B.y);
        vertex.z = P1.z + (cx * N.z + cy * B.z);
        vertices.push(vertex.x, vertex.y, vertex.z);

        // 法线 = 顶点 - 当前曲线位置(P1 为挤出原点)
        normal.subVectors(vertex, P1).normalize();
        normals.push(normal.x, normal.y, normal.z);

        uvs.push(i / tubularSegments, j / radialSegments);
      }
    }

    // 生成索引
    for (let j = 1; j <= tubularSegments; j++) {
      for (let i = 1; i <= radialSegments; i++) {
        const a = (radialSegments + 1) * (j - 1) + (i - 1);
        const b = (radialSegments + 1) * j + (i - 1);
        const c = (radialSegments + 1) * j + i;
        const d = (radialSegments + 1) * (j - 1) + i;

        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();

    /** 计算纽结曲线上的位置。 */
    function calculatePositionOnCurve(
      u: number,
      p: number,
      q: number,
      radius: number,
      position: Vector3,
    ): void {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const quOverP = (q / p) * u;
      const cs = Math.cos(quOverP);

      position.x = radius * (2 + cs) * 0.5 * cu;
      position.y = radius * (2 + cs) * su * 0.5;
      position.z = radius * Math.sin(quOverP) * 0.5;
    }

    /** out = a × b(VREEN Vector3 未提供 crossVectors,此处内联)。 */
    function crossInto(out: Vector3, a: Vector3, b: Vector3): void {
      const ax = a.x, ay = a.y, az = a.z;
      const bx = b.x, by = b.y, bz = b.z;
      out.x = ay * bz - az * by;
      out.y = az * bx - ax * bz;
      out.z = ax * by - ay * bx;
    }
  }
}
