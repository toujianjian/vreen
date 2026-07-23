// CircleGeometry — 圆面几何体,从 three.js 移植并适配 VREEN 引擎。
// XY 平面上的圆/扇形,法线指向 +Z,由中心向周缘的三角扇构成。
// 参考: three.js/src/geometries/CircleGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 圆面:中心点 + 周缘扇形三角带,法线 +Z。 */
export class CircleGeometry extends BufferGeometry {
  constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();

    segments = Math.max(3, segments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // 中心点
    vertices.push(0, 0, 0);
    normals.push(0, 0, 1);
    uvs.push(0.5, 0.5);

    // 周缘顶点
    for (let s = 0; s <= segments; s++) {
      const segment = thetaStart + (s / segments) * thetaLength;
      const cos = Math.cos(segment);
      const sin = Math.sin(segment);

      vertices.push(radius * cos, radius * sin, 0);
      normals.push(0, 0, 1);
      // UV 用归一化方向向量,半径为 0 时也不会产生 NaN
      uvs.push((cos + 1) / 2, (sin + 1) / 2);
    }

    // 扇形索引(中心点为索引 0)
    for (let i = 1; i <= segments; i++) {
      indices.push(i, i + 1, 0);
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();
  }
}
