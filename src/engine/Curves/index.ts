// Curves barrel — 统一导出。
// Adapted from three.js src/extras/curves/Curves.js (MIT)。

// 基类 & 集合
export { Curve, type CurvePoint, type FrenetFrames } from './Curve';
export { CurvePath } from './CurvePath';

// 3D 曲线
export { LineCurve3 } from './LineCurve3';
export { QuadraticBezierCurve3 } from './QuadraticBezierCurve3';
export { CubicBezierCurve3 } from './CubicBezierCurve3';
export { CatmullRomCurve3, type CatmullRomCurveType } from './CatmullRomCurve3';

// 2D 曲线
export { LineCurve } from './LineCurve';
export { QuadraticBezierCurve } from './QuadraticBezierCurve';
export { CubicBezierCurve } from './CubicBezierCurve';
export { SplineCurve } from './SplineCurve';
export { EllipseCurve } from './EllipseCurve';

// 2D 路径 & 形状
export { Path } from './Path';
export { Shape, type ExtractPointsResult } from './Shape';

// 工具
export { ShapeUtils } from './ShapeUtils';
export { Earcut } from './Earcut';

// 插值基函数
export {
  CatmullRom,
  QuadraticBezier,
  CubicBezier,
  QuadraticBezierP0,
  QuadraticBezierP1,
  QuadraticBezierP2,
  CubicBezierP0,
  CubicBezierP1,
  CubicBezierP2,
  CubicBezierP3,
} from './Interpolations';
