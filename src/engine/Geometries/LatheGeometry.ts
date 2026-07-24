// LatheGeometry — 旋转面几何体,从 three.js 移植并适配 VREEN 引擎。
// 由一条 2D 轮廓线绕 Y 轴旋转生成的回转体(花瓶/杯子等)。
// points 中每个 Vector2 的 x 必须 ≥ 0(到旋转轴的距离),y 为高度。
// 参考: three.js/src/geometries/LatheGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector2 } from '../Math';
import { Vector3 } from '../Math';

/** 旋转面:2D 轮廓绕 Y 轴旋转。 */
export class LatheGeometry extends BufferGeometry {
  constructor(
    points: Vector2[] = [
      new Vector2(0, -0.5),
      new Vector2(0.5, 0),
      new Vector2(0, 0.5),
    ],
    segments = 12,
    phiStart = 0,
    phiLength = Math.PI * 2,
  ) {
    super();

    segments = Math.floor(Math.max(1, segments));

    // 限制 phiLength 在 [0, 2π] 内
    phiLength = Math.min(Math.max(phiLength, 0), Math.PI * 2);

    const indices: number[] = [];
    const vertices: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const initNormals: number[] = [];

    const inverseSegments = 1.0 / segments;
    const vertex = new Vector3();
    const uv = new Vector2();
    const normal = new Vector3();
    const curNormal = new Vector3();
    const prevNormal = new Vector3();
    let dx = 0;
    let dy = 0;

    // 预计算初始经线(φ=0 处)上每个轮廓点的法线方向。
    // 法线位于 XZ 平面内,Y 分量由相邻点切线决定。
    for (let j = 0; j <= points.length - 1; j++) {
      if (j === 0) {
        // 首点:用与前一点切线相反的方向作为法线参考
        dx = points[j + 1].x - points[j].x;
        dy = points[j + 1].y - points[j].y;
        normal.x = dy * 1.0;
        normal.y = -dx;
        normal.z = dy * 0.0;
        prevNormal.copy(normal);
        normal.normalize();
        initNormals.push(normal.x, normal.y, normal.z);
      } else if (j === points.length - 1) {
        // 末点:沿用前一段的法线方向
        initNormals.push(prevNormal.x, prevNormal.y, prevNormal.z);
      } else {
        // 中间点:取两侧切线的平均值
        dx = points[j + 1].x - points[j].x;
        dy = points[j + 1].y - points[j].y;
        normal.x = dy * 1.0;
        normal.y = -dx;
        normal.z = dy * 0.0;
        curNormal.copy(normal);
        normal.x += prevNormal.x;
        normal.y += prevNormal.y;
        normal.z += prevNormal.z;
        normal.normalize();
        initNormals.push(normal.x, normal.y, normal.z);
        prevNormal.copy(curNormal);
      }
    }

    // 生成顶点、uv 与法线
    for (let i = 0; i <= segments; i++) {
      const phi = phiStart + i * inverseSegments * phiLength;
      const sin = Math.sin(phi);
      const cos = Math.cos(phi);

      for (let j = 0; j <= points.length - 1; j++) {
        // 顶点位置:x/z 由半径(轮廓点 x)旋转 φ 决定,y 为轮廓点 y
        vertex.x = points[j].x * sin;
        vertex.y = points[j].y;
        vertex.z = points[j].x * cos;
        vertices.push(vertex.x, vertex.y, vertex.z);

        // UV:u 沿圆周方向,v 沿轮廓方向
        uv.x = i / segments;
        uv.y = j / (points.length - 1);
        uvs.push(uv.x, uv.y);

        // 法线 = 初始法线绕 Y 轴旋转 φ
        const nx = initNormals[3 * j + 0] * sin;
        const ny = initNormals[3 * j + 1];
        const nz = initNormals[3 * j + 0] * cos;
        normals.push(nx, ny, nz);
      }
    }

    // 生成索引:相邻两圈之间的四边形被拆分为两个三角形
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < points.length - 1; j++) {
        const base = j + i * points.length;
        const a = base;
        const b = base + points.length;
        const c = base + points.length + 1;
        const d = base + 1;

        indices.push(a, b, d);
        indices.push(c, d, b);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.computeBoundingBox();
  }
}
