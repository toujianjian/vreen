// SphereGeometry — 球体几何体,从 three.js 移植并适配 VREEN 引擎。
// 通过经纬度网格生成球面,支持起始角与扫掠角度。
// 参考: three.js/src/geometries/SphereGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';

/** UV 球体:经度×纬度网格,原点居中。 */
export class SphereGeometry extends BufferGeometry {
  constructor(
    radius = 1,
    widthSegments = 32,
    heightSegments = 16,
    phiStart = 0,
    phiLength = Math.PI * 2,
    thetaStart = 0,
    thetaLength = Math.PI,
  ) {
    super();

    widthSegments = Math.max(3, Math.floor(widthSegments));
    heightSegments = Math.max(2, Math.floor(heightSegments));

    const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);

    let index = 0;
    const grid: number[][] = [];

    const vertex = new Vector3();
    const normal = new Vector3();

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // 生成顶点、法线与 uv
    for (let iy = 0; iy <= heightSegments; iy++) {
      const verticesRow: number[] = [];

      const v = iy / heightSegments;
      const theta = thetaStart + v * thetaLength;

      const y = radius * Math.cos(theta);
      const ringRadius = Math.sqrt(radius * radius - y * y);

      // 极点处的 UV 偏移,避免极点 UV 退化
      let uOffset = 0;
      if (iy === 0 && thetaStart === 0) {
        uOffset = 0.5 / widthSegments;
      } else if (iy === heightSegments && thetaEnd === Math.PI) {
        uOffset = -0.5 / widthSegments;
      }

      for (let ix = 0; ix <= widthSegments; ix++) {
        const u = ix / widthSegments;
        const phi = phiStart + u * phiLength;

        vertex.x = -ringRadius * Math.cos(phi);
        vertex.y = y;
        vertex.z = ringRadius * Math.sin(phi);
        vertices.push(vertex.x, vertex.y, vertex.z);

        normal.copy(vertex).normalize();
        normals.push(normal.x, normal.y, normal.z);

        uvs.push(u + uOffset, 1 - v);

        verticesRow.push(index++);
      }

      grid.push(verticesRow);
    }

    // 生成索引(极点处退化三角形会被跳过)
    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = grid[iy][ix + 1];
        const b = grid[iy][ix];
        const c = grid[iy + 1][ix];
        const d = grid[iy + 1][ix + 1];

        if (iy !== 0 || thetaStart > 0) indices.push(a, b, d);
        if (iy !== heightSegments - 1 || thetaEnd < Math.PI) indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();
  }
}
