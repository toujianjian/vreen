// CapsuleGeometry — 胶囊体几何体,从 three.js 移植并适配 VREEN 引擎。
// 圆柱中段 + 两端半球帽,沿 Y 轴,原点居中。
// 参考: three.js/src/geometries/CapsuleGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';

/** 胶囊:半径 + 中段长度 + 帽段数 + 圆周段数。 */
export class CapsuleGeometry extends BufferGeometry {
  constructor(radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
    super();

    // 中段高度分段固定为 1(three.js 默认值)。
    const heightSegments = 1;

    length = Math.max(0, length);
    capSegments = Math.max(1, Math.floor(capSegments));
    radialSegments = Math.max(3, Math.floor(radialSegments));

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const halfHeight = length / 2;
    const capArcLength = (Math.PI / 2) * radius;
    const cylinderPartLength = length;
    const totalArcLength = 2 * capArcLength + cylinderPartLength;

    const numVerticalSegments = capSegments * 2 + heightSegments;
    const verticesPerRow = radialSegments + 1;

    const normal = new Vector3();
    const vertex = new Vector3();

    // 生成顶点、法线与 uv
    for (let iy = 0; iy <= numVerticalSegments; iy++) {
      let currentArcLength = 0;
      let profileY = 0;
      let profileRadius = 0;
      let normalYComponent = 0;

      if (iy <= capSegments) {
        // 底部半球帽
        const segmentProgress = iy / capSegments;
        const angle = (segmentProgress * Math.PI) / 2;
        profileY = -halfHeight - radius * Math.cos(angle);
        profileRadius = radius * Math.sin(angle);
        normalYComponent = -radius * Math.cos(angle);
        currentArcLength = segmentProgress * capArcLength;
      } else if (iy <= capSegments + heightSegments) {
        // 中段圆柱
        const segmentProgress = (iy - capSegments) / heightSegments;
        profileY = -halfHeight + segmentProgress * length;
        profileRadius = radius;
        normalYComponent = 0;
        currentArcLength = capArcLength + segmentProgress * cylinderPartLength;
      } else {
        // 顶部半球帽
        const segmentProgress = (iy - capSegments - heightSegments) / capSegments;
        const angle = (segmentProgress * Math.PI) / 2;
        profileY = halfHeight + radius * Math.sin(angle);
        profileRadius = radius * Math.cos(angle);
        normalYComponent = radius * Math.sin(angle);
        currentArcLength = capArcLength + cylinderPartLength + segmentProgress * capArcLength;
      }

      const v = Math.max(0, Math.min(1, currentArcLength / totalArcLength));

      // 极点处的 UV 偏移
      let uOffset = 0;
      if (iy === 0) {
        uOffset = 0.5 / radialSegments;
      } else if (iy === numVerticalSegments) {
        uOffset = -0.5 / radialSegments;
      }

      for (let ix = 0; ix <= radialSegments; ix++) {
        const u = ix / radialSegments;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        vertex.x = -profileRadius * cosTheta;
        vertex.y = profileY;
        vertex.z = profileRadius * sinTheta;
        vertices.push(vertex.x, vertex.y, vertex.z);

        normal.set(-profileRadius * cosTheta, normalYComponent, profileRadius * sinTheta).normalize();
        normals.push(normal.x, normal.y, normal.z);

        uvs.push(u + uOffset, v);
      }

      // 与上一行构成四边形(两个三角形)
      if (iy > 0) {
        const prevIndexRow = (iy - 1) * verticesPerRow;
        for (let ix = 0; ix < radialSegments; ix++) {
          const i1 = prevIndexRow + ix;
          const i2 = prevIndexRow + ix + 1;
          const i3 = iy * verticesPerRow + ix;
          const i4 = iy * verticesPerRow + ix + 1;

          indices.push(i1, i2, i3);
          indices.push(i2, i4, i3);
        }
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();
  }
}
