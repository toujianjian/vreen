// ShapeUtils — 2D 形状工具,适配自 three.js src/extras/ShapeUtils.js (MIT)。
// 提供多边形面积、绕向判定、earcut 三角剖分。

import { Vector2 } from '../Math/Vector2';
import { Earcut } from './Earcut';

export class ShapeUtils {
  /** 计算 2D 多边形有符号面积 (正=逆时针, 负=顺时针)。 */
  static area(contour: Vector2[]): number {
    const n = contour.length;
    let a = 0.0;
    for (let p = n - 1, q = 0; q < n; p = q++) {
      a += contour[p].x * contour[q].y - contour[q].x * contour[p].y;
    }
    return a * 0.5;
  }

  /** 判断点序列是否为顺时针 (面积 < 0)。 */
  static isClockWise(pts: Vector2[]): boolean {
    return ShapeUtils.area(pts) < 0;
  }

  /**
   * 对带孔洞的多边形做三角剖分。
   * @param contour 外轮廓顶点
   * @param holes 孔洞顶点数组
   * @returns 三角形面数组,每个面为 [a, b, c] 顶点索引
   */
  static triangulateShape(contour: Vector2[], holes: Vector2[][]): number[][] {
    const vertices: number[] = [];
    const holeIndices: number[] = [];
    const faces: number[][] = [];

    removeDupEndPts(contour);
    addContour(vertices, contour);

    let holeIndex = contour.length;
    for (const hole of holes) {
      removeDupEndPts(hole);
      holeIndices.push(holeIndex);
      holeIndex += hole.length;
      addContour(vertices, hole);
    }

    const triangles = Earcut.triangulate(vertices, holeIndices);
    for (let i = 0; i < triangles.length; i += 3) {
      faces.push(triangles.slice(i, i + 3));
    }
    return faces;
  }
}

/** 移除与首点重复的末点。 */
function removeDupEndPts(points: Vector2[]): void {
  const l = points.length;
  if (l > 2 && points[l - 1].equals(points[0])) {
    points.pop();
  }
}

/** 把轮廓顶点展平为 [x0,y0, x1,y1, ...]。 */
function addContour(vertices: number[], contour: Vector2[]): void {
  for (const p of contour) {
    vertices.push(p.x);
    vertices.push(p.y);
  }
}
