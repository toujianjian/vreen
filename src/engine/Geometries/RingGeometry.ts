// RingGeometry — 二维圆环面几何体,从 three.js 移植并适配 VREEN 引擎。
// XY 平面上由内半径到外半径的环形带,法线指向 +Z。
// 参考: three.js/src/geometries/RingGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 圆环面:内半径到外半径的环形带,法线 +Z。 */
export class RingGeometry extends BufferGeometry {
  constructor(
    innerRadius = 0.5,
    outerRadius = 1,
    thetaSegments = 32,
    phiSegments = 1,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
  ) {
    super();

    thetaSegments = Math.max(3, thetaSegments);
    phiSegments = Math.max(1, phiSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    let radius = innerRadius;
    const radiusStep = (outerRadius - innerRadius) / phiSegments;

    // 由内向外逐层生成顶点
    for (let j = 0; j <= phiSegments; j++) {
      for (let i = 0; i <= thetaSegments; i++) {
        const segment = thetaStart + (i / thetaSegments) * thetaLength;

        const x = radius * Math.cos(segment);
        const y = radius * Math.sin(segment);

        vertices.push(x, y, 0);
        normals.push(0, 0, 1);
        uvs.push((x / outerRadius + 1) / 2, (y / outerRadius + 1) / 2);
      }

      radius += radiusStep;
    }

    // 生成索引
    for (let j = 0; j < phiSegments; j++) {
      const thetaSegmentLevel = j * (thetaSegments + 1);

      for (let i = 0; i < thetaSegments; i++) {
        const segment = i + thetaSegmentLevel;

        const a = segment;
        const b = segment + thetaSegments + 1;
        const c = segment + thetaSegments + 2;
        const d = segment + 1;

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
