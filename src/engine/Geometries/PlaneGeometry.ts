// PlaneGeometry — 平面几何体,从 three.js 移植并适配 VREEN 引擎。
// XY 平面上的矩形,法线指向 +Z,支持宽高方向分段。
// 参考: three.js/src/geometries/PlaneGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 平面:XY 平面矩形,法线 +Z,原点居中。 */
export class PlaneGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();

    const widthHalf = width / 2;
    const heightHalf = height / 2;

    const gridX = Math.floor(widthSegments);
    const gridY = Math.floor(heightSegments);
    const gridX1 = gridX + 1;
    const gridY1 = gridY + 1;

    const segmentWidth = width / gridX;
    const segmentHeight = height / gridY;

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // 生成顶点、法线与 uv
    for (let iy = 0; iy < gridY1; iy++) {
      const y = iy * segmentHeight - heightHalf;
      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segmentWidth - widthHalf;

        vertices.push(x, -y, 0);
        normals.push(0, 0, 1);
        uvs.push(ix / gridX, 1 - iy / gridY);
      }
    }

    // 生成索引
    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = ix + gridX1 * iy;
        const b = ix + gridX1 * (iy + 1);
        const c = ix + 1 + gridX1 * (iy + 1);
        const d = ix + 1 + gridX1 * iy;

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
