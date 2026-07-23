// CylinderGeometry — 圆柱体几何体,从 three.js 移植并适配 VREEN 引擎。
// 侧面 + 完整顶/底面(默认 openEnded=false),沿 Y 轴,原点居中。
// 参考: three.js/src/geometries/CylinderGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';

/** 圆柱:沿 Y 轴,原点居中。默认带顶底面。 */
export class CylinderGeometry extends BufferGeometry {
  constructor(
    radiusTop = 1,
    radiusBottom = 1,
    height = 1,
    radialSegments = 32,
    heightSegments = 1,
    openEnded = false,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
  ) {
    super();

    radialSegments = Math.floor(radialSegments);
    heightSegments = Math.floor(heightSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    let index = 0;
    const indexArray: number[][] = [];
    const halfHeight = height / 2;

    generateTorso();
    if (openEnded === false) {
      // VREEN 约定:圆柱/圆锥必须用完整顶底面。
      if (radiusTop > 0) generateCap(true);
      if (radiusBottom > 0) generateCap(false);
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();

    /** 生成侧面(可分段)。 */
    function generateTorso(): void {
      const normal = new Vector3();
      const vertex = new Vector3();

      // 用于计算侧面法线的斜率
      const slope = (radiusBottom - radiusTop) / height;

      for (let y = 0; y <= heightSegments; y++) {
        const indexRow: number[] = [];
        const v = y / heightSegments;
        const radius = v * (radiusBottom - radiusTop) + radiusTop;

        for (let x = 0; x <= radialSegments; x++) {
          const u = x / radialSegments;
          const theta = u * thetaLength + thetaStart;
          const sinTheta = Math.sin(theta);
          const cosTheta = Math.cos(theta);

          vertex.x = radius * sinTheta;
          vertex.y = -v * height + halfHeight;
          vertex.z = radius * cosTheta;
          vertices.push(vertex.x, vertex.y, vertex.z);

          normal.set(sinTheta, slope, cosTheta).normalize();
          normals.push(normal.x, normal.y, normal.z);

          uvs.push(u, 1 - v);

          indexRow.push(index++);
        }

        indexArray.push(indexRow);
      }

      for (let x = 0; x < radialSegments; x++) {
        for (let y = 0; y < heightSegments; y++) {
          const a = indexArray[y][x];
          const b = indexArray[y + 1][x];
          const c = indexArray[y + 1][x + 1];
          const d = indexArray[y][x + 1];

          // 顶端收缩为一点时跳过上三角,避免退化三角形
          if (radiusTop > 0 || y !== 0) {
            indices.push(a, b, d);
          }
          // 底端收缩为一点时跳过下三角
          if (radiusBottom > 0 || y !== heightSegments - 1) {
            indices.push(b, c, d);
          }
        }
      }
    }

    /** 生成顶面或底面(扇形三角带)。 */
    function generateCap(top: boolean): void {
      // 该 cap 第一个中心顶点的索引
      const centerIndexStart = index;

      const radius = top ? radiusTop : radiusBottom;
      const sign = top ? 1 : -1;

      // 每个扇形段一个中心顶点(保证各面 UV 独立)
      for (let x = 1; x <= radialSegments; x++) {
        vertices.push(0, halfHeight * sign, 0);
        normals.push(0, sign, 0);
        uvs.push(0.5, 0.5);
        index++;
      }

      const centerIndexEnd = index;

      // 周缘顶点
      for (let x = 0; x <= radialSegments; x++) {
        const u = x / radialSegments;
        const theta = u * thetaLength + thetaStart;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        vertices.push(radius * sinTheta, halfHeight * sign, radius * cosTheta);
        normals.push(0, sign, 0);
        uvs.push(cosTheta * 0.5 + 0.5, sinTheta * 0.5 * sign + 0.5);

        index++;
      }

      // 扇形索引(顶/底面绕向相反以保证外法线)
      for (let x = 0; x < radialSegments; x++) {
        const c = centerIndexStart + x;
        const i = centerIndexEnd + x;

        if (top) {
          indices.push(i, i + 1, c);
        } else {
          indices.push(i + 1, i, c);
        }
      }
    }
  }
}
