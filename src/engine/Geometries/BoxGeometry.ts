// BoxGeometry — 长方体几何体,从 three.js 移植并适配 VREEN 引擎。
// 生成立方体的六个面,每个面拥有独立顶点(因此各面法线分离),
// 支持 width / height / depth 三个方向上的分段。
// 参考: three.js/src/geometries/BoxGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 轴对齐长方体。每个面拥有独立顶点,以便各面法线互不影响。 */
export class BoxGeometry extends BufferGeometry {
  constructor(
    width = 1,
    height = 1,
    depth = 1,
    widthSegments = 1,
    heightSegments = 1,
    depthSegments = 1,
  ) {
    super();

    widthSegments = Math.floor(widthSegments);
    heightSegments = Math.floor(heightSegments);
    depthSegments = Math.floor(depthSegments);

    const indices: number[] = [];
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    let numberOfVertices = 0;

    // 构建盒子的六个面。uAxis/vAxis/wAxis 为轴索引(0=x,1=y,2=z),
    // udir/vdir 控制朝向,wDepth 为负时会翻转该面法线。
    buildPlane(2, 1, 0, -1, -1, depth, height, width, depthSegments, heightSegments); // +X
    buildPlane(2, 1, 0, 1, -1, depth, height, -width, depthSegments, heightSegments); // -X
    buildPlane(0, 2, 1, 1, 1, width, depth, height, widthSegments, depthSegments); // +Y
    buildPlane(0, 2, 1, 1, -1, width, depth, -height, widthSegments, depthSegments); // -Y
    buildPlane(0, 1, 2, 1, -1, width, height, depth, widthSegments, heightSegments); // +Z
    buildPlane(0, 1, 2, -1, -1, width, height, -depth, widthSegments, heightSegments); // -Z

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();

    /** 在指定朝向上构建一个平面面片,并写入顶点/法线/uv/索引缓冲。 */
    function buildPlane(
      uAxis: number,
      vAxis: number,
      wAxis: number,
      udir: number,
      vdir: number,
      wWidth: number,
      wHeight: number,
      wDepth: number,
      gridX: number,
      gridY: number,
    ): void {
      const segmentWidth = wWidth / gridX;
      const segmentHeight = wHeight / gridY;
      const widthHalf = wWidth / 2;
      const heightHalf = wHeight / 2;
      const depthHalf = wDepth / 2;

      const gridX1 = gridX + 1;
      const gridY1 = gridY + 1;

      let vertexCounter = 0;

      // 复用的分量容器,避免字符串索引访问 Vector3。
      const pos: [number, number, number] = [0, 0, 0];
      const nrm: [number, number, number] = [0, 0, 0];

      for (let iy = 0; iy < gridY1; iy++) {
        const y = iy * segmentHeight - heightHalf;
        for (let ix = 0; ix < gridX1; ix++) {
          const x = ix * segmentWidth - widthHalf;

          pos[uAxis] = x * udir;
          pos[vAxis] = y * vdir;
          pos[wAxis] = depthHalf;
          vertices.push(pos[0], pos[1], pos[2]);

          nrm[uAxis] = 0;
          nrm[vAxis] = 0;
          nrm[wAxis] = wDepth > 0 ? 1 : -1;
          normals.push(nrm[0], nrm[1], nrm[2]);

          uvs.push(ix / gridX, 1 - iy / gridY);

          vertexCounter += 1;
        }
      }

      // 每个网格单元两个三角形(六个索引)
      for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
          const a = numberOfVertices + ix + gridX1 * iy;
          const b = numberOfVertices + ix + gridX1 * (iy + 1);
          const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
          const d = numberOfVertices + (ix + 1) + gridX1 * iy;

          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }

      numberOfVertices += vertexCounter;
    }
  }
}
