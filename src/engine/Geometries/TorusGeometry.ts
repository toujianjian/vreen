// TorusGeometry — 圆环几何体,从 three.js 移植并适配 VREEN 引擎。
// 环面:中心圆环绕一周,管子沿径向环绕。
// 参考: three.js/src/geometries/TorusGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';

/** 圆环:中心半径 + 管半径。 */
export class TorusGeometry extends BufferGeometry {
  constructor(
    radius = 1,
    tube = 0.4,
    radialSegments = 12,
    tubularSegments = 48,
    arc = Math.PI * 2,
  ) {
    super();

    radialSegments = Math.floor(radialSegments);
    tubularSegments = Math.floor(tubularSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const center = new Vector3();
    const vertex = new Vector3();
    const normal = new Vector3();

    // 生成顶点、法线与 uv
    for (let j = 0; j <= radialSegments; j++) {
      for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * arc;
        const v = (j / radialSegments) * Math.PI * 2;

        vertex.x = (radius + tube * Math.cos(v)) * Math.cos(u);
        vertex.y = (radius + tube * Math.cos(v)) * Math.sin(u);
        vertex.z = tube * Math.sin(v);
        vertices.push(vertex.x, vertex.y, vertex.z);

        // 法线 = 顶点 - 该角度对应的中心圆上的点
        center.x = radius * Math.cos(u);
        center.y = radius * Math.sin(u);
        normal.subVectors(vertex, center).normalize();
        normals.push(normal.x, normal.y, normal.z);

        uvs.push(i / tubularSegments, j / radialSegments);
      }
    }

    // 生成索引
    for (let j = 1; j <= radialSegments; j++) {
      for (let i = 1; i <= tubularSegments; i++) {
        const a = (tubularSegments + 1) * j + i - 1;
        const b = (tubularSegments + 1) * (j - 1) + i - 1;
        const c = (tubularSegments + 1) * (j - 1) + i;
        const d = (tubularSegments + 1) * j + i;

        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();
  }
}
