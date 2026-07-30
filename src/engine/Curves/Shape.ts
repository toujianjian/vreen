// Shape — 带孔洞的 2D 形状,适配自 three.js src/extras/core/Shape.js (MIT)。
// 继承 Path,额外维护 holes: Path[]。extractPoints 返回轮廓+孔洞的采样点。

import { Path } from './Path';
import { Vector2 } from '../Math/Vector2';

export interface ExtractPointsResult {
  shape: Vector2[];
  holes: Vector2[][];
}

export class Shape extends Path {
  type = 'Shape';
  holes: Path[] = [];

  constructor(points?: Vector2[]) {
    super(points);
  }

  /** 返回各孔洞的采样点。 */
  getPointsHoles(divisions: number): Vector2[][] {
    const holesPts: Vector2[][] = [];
    for (const hole of this.holes) {
      holesPts.push(hole.getPoints(divisions));
    }
    return holesPts;
  }

  /** 返回轮廓 + 孔洞的采样点。 */
  extractPoints(divisions: number): ExtractPointsResult {
    return {
      shape: this.getPoints(divisions),
      holes: this.getPointsHoles(divisions),
    };
  }

  copy(source: this): this {
    super.copy(source);
    this.holes = [];
    for (const hole of source.holes) {
      this.holes.push(hole.clone() as Path);
    }
    return this;
  }
}
