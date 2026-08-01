// LineGeometry — 折线粗线几何体,配合 Line2 使用。
//
// 参考 three.js examples/jsm/lines/LineGeometry.js。继承 LineSegmentsGeometry,
// 把折线顶点链 [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] 转换为线段端点对格式
// [(x0,y0,z0),(x1,y1,z1), (x1,y1,z1),(x2,y2,z2), ...](每相邻两点构成一段)。
// 这样 Line2 就能像 LineSegments2 一样用实例化四边形扩展绘制连续粗折线。

import { LineSegmentsGeometry } from './LineSegmentsGeometry';

export class LineGeometry extends LineSegmentsGeometry {
  override readonly type: string = 'LineGeometry';
  /** 类型标志。 */
  isLineGeometry: boolean = true;

  /**
   * 设置折线顶点链。array 为 [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...],
   * 相邻顶点构成一段(N 个顶点 → N-1 段)。
   */
  override setPositions(array: ArrayLike<number>): this {
    const src = array instanceof Float32Array ? array : new Float32Array(array);
    if (src.length % 3 !== 0) {
      throw new Error(
        `LineGeometry.setPositions: length must be a multiple of 3 (got ${src.length})`,
      );
    }
    if (src.length < 6) {
      // 少于 2 个顶点 → 无线段,直接走父类(空)。
      return super.setPositions(new Float32Array(0));
    }
    // 链 → 对:N-1 段,每段 6 个 float(起点 + 终点)。
    const segmentCount = src.length / 3 - 1;
    const pairs = new Float32Array(segmentCount * 6);
    for (let i = 0; i < segmentCount; i++) {
      const s = i * 3;
      const d = i * 6;
      pairs[d] = src[s];
      pairs[d + 1] = src[s + 1];
      pairs[d + 2] = src[s + 2];
      pairs[d + 3] = src[s + 3];
      pairs[d + 4] = src[s + 4];
      pairs[d + 5] = src[s + 5];
    }
    return super.setPositions(pairs);
  }

  /**
   * 设置折线顶点颜色链。array 为 [r0,g0,b0, r1,g1,b1, ...],
   * 相邻顶点颜色构成一段的起止颜色。长度必须与 setPositions 的顶点链一致。
   */
  override setColors(array: ArrayLike<number>): this {
    const src = array instanceof Float32Array ? array : new Float32Array(array);
    if (src.length % 3 !== 0) {
      throw new Error(
        `LineGeometry.setColors: length must be a multiple of 3 (got ${src.length})`,
      );
    }
    if (src.length < 6) {
      return super.setColors(new Float32Array(0));
    }
    const segmentCount = src.length / 3 - 1;
    const pairs = new Float32Array(segmentCount * 6);
    for (let i = 0; i < segmentCount; i++) {
      const s = i * 3;
      const d = i * 6;
      pairs[d] = src[s];
      pairs[d + 1] = src[s + 1];
      pairs[d + 2] = src[s + 2];
      pairs[d + 3] = src[s + 3];
      pairs[d + 4] = src[s + 4];
      pairs[d + 5] = src[s + 5];
    }
    return super.setColors(pairs);
  }

  /** 从非索引 Line 的 position 数组导入(折线链)。 */
  fromLine(line: { geometry: { attributes: { position: { array: ArrayLike<number> } } } }): this {
    this.setPositions(line.geometry.attributes.position.array);
    return this;
  }
}
