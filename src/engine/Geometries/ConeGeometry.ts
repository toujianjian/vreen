// ConeGeometry — 圆锥几何体,从 three.js 移植并适配 VREEN 引擎。
// 复用 CylinderGeometry(radiusTop=0),底面完整。
// 参考: three.js/src/geometries/ConeGeometry.js

import { CylinderGeometry } from './CylinderGeometry';

/** 圆锥:顶部半径为 0 的圆柱,默认带底面。 */
export class ConeGeometry extends CylinderGeometry {
  constructor(
    radius = 1,
    height = 1,
    radialSegments = 32,
    heightSegments = 1,
    openEnded = false,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
  ) {
    super(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
  }
}
