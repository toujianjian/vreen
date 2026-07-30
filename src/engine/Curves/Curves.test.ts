import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Vector2 } from '../Math/Vector2';
import {
  LineCurve3,
  QuadraticBezierCurve3,
  CubicBezierCurve3,
  CatmullRomCurve3,
  EllipseCurve,
  Path,
  Shape,
  ShapeUtils,
} from './index';

describe('LineCurve3', () => {
  it('getPoint(0) 返回 v1, getPoint(1) 返回 v2', () => {
    const p1 = new Vector3(0, 0, 0);
    const p2 = new Vector3(3, 4, 5);
    const curve = new LineCurve3(p1, p2);
    expect(curve.getPoint(0).equals(p1)).toBe(true);
    expect(curve.getPoint(1).equals(p2)).toBe(true);
  });

  it('getLength 等于两端点距离', () => {
    const p1 = new Vector3(0, 0, 0);
    const p2 = new Vector3(3, 4, 0);
    const curve = new LineCurve3(p1, p2);
    // distance = 5
    expect(curve.getLength()).toBeCloseTo(5, 5);
  });

  it('中点为线性插值结果', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const mid = curve.getPoint(0.5);
    expect(mid.x).toBeCloseTo(5, 5);
    expect(mid.y).toBeCloseTo(0, 5);
    expect(mid.z).toBeCloseTo(0, 5);
  });

  it('getTangent 返回单位方向', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(0, 0, 5));
    const t = curve.getTangent(0.5);
    expect(t.x).toBeCloseTo(0, 5);
    expect(t.y).toBeCloseTo(0, 5);
    expect(t.z).toBeCloseTo(1, 5);
  });
});

describe('QuadraticBezierCurve3', () => {
  it('端点匹配控制点', () => {
    const v0 = new Vector3(1, 2, 3);
    const v1 = new Vector3(4, 5, 6);
    const v2 = new Vector3(7, 8, 9);
    const curve = new QuadraticBezierCurve3(v0, v1, v2);
    expect(curve.getPoint(0).equals(v0)).toBe(true);
    expect(curve.getPoint(1).equals(v2)).toBe(true);
  });

  it('中点等于 B(0.5) 公式值', () => {
    // B(0.5) = 0.25·p0 + 0.5·p1 + 0.25·p2
    const v0 = new Vector3(0, 0, 0);
    const v1 = new Vector3(2, 4, 6);
    const v2 = new Vector3(4, 0, 0);
    const curve = new QuadraticBezierCurve3(v0, v1, v2);
    const mid = curve.getPoint(0.5);
    // 0.25·0 + 0.5·2 + 0.25·4 = 2
    expect(mid.x).toBeCloseTo(2, 5);
    // 0.25·0 + 0.5·4 + 0.25·0 = 2
    expect(mid.y).toBeCloseTo(2, 5);
    // 0.25·0 + 0.5·6 + 0.25·0 = 3
    expect(mid.z).toBeCloseTo(3, 5);
  });
});

describe('CubicBezierCurve3', () => {
  it('端点匹配控制点', () => {
    const v0 = new Vector3(0, 0, 0);
    const v1 = new Vector3(1, 2, 3);
    const v2 = new Vector3(4, 5, 6);
    const v3 = new Vector3(7, 8, 9);
    const curve = new CubicBezierCurve3(v0, v1, v2, v3);
    expect(curve.getPoint(0).equals(v0)).toBe(true);
    expect(curve.getPoint(1).equals(v3)).toBe(true);
  });

  it('中点等于 B(0.5) 公式值', () => {
    // B(0.5) = 0.125·p0 + 0.375·p1 + 0.375·p2 + 0.125·p3
    const v0 = new Vector3(0, 0, 0);
    const v1 = new Vector3(2, 0, 0);
    const v2 = new Vector3(4, 0, 0);
    const v3 = new Vector3(6, 0, 0);
    const curve = new CubicBezierCurve3(v0, v1, v2, v3);
    const mid = curve.getPoint(0.5);
    // 0.125·0 + 0.375·2 + 0.375·4 + 0.125·6 = 3
    expect(mid.x).toBeCloseTo(3, 5);
  });
});

describe('CatmullRomCurve3', () => {
  it('曲线经过所有控制点', () => {
    const pts = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(1, 1, 0),
      new Vector3(0, 1, 0),
    ];
    const curve = new CatmullRomCurve3(pts);
    // t = i / (n-1) 对应第 i 个点
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const p = curve.getPoint(t);
      expect(p.x).toBeCloseTo(pts[i].x, 4);
      expect(p.y).toBeCloseTo(pts[i].y, 4);
      expect(p.z).toBeCloseTo(pts[i].z, 4);
    }
  });

  it('closed=true 时 t=1 回到起点', () => {
    const pts = [
      new Vector3(0, 0, 0),
      new Vector3(2, 0, 0),
      new Vector3(2, 2, 0),
      new Vector3(0, 2, 0),
    ];
    const curve = new CatmullRomCurve3(pts, true);
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    expect(end.x).toBeCloseTo(start.x, 4);
    expect(end.y).toBeCloseTo(start.y, 4);
    expect(end.z).toBeCloseTo(start.z, 4);
  });

  it('catmullrom 类型支持 tension 参数', () => {
    // 非共线点,否则任意 tension 都共线
    const pts = [
      new Vector3(0, 0, 0),
      new Vector3(1, 2, 0),
      new Vector3(2, 0, 0),
    ];
    const curveLow = new CatmullRomCurve3(pts, false, 'catmullrom', 0);
    const curveHigh = new CatmullRomCurve3(pts, false, 'catmullrom', 1);
    // t=0.25 在 p0→p1 之间,非控制点; 不同 tension 产生不同 y
    const ptLow = curveLow.getPoint(0.25);
    const ptHigh = curveHigh.getPoint(0.25);
    // tension 影响中间段曲率, 两个值应不同
    expect(Math.abs(ptHigh.y - ptLow.y)).toBeGreaterThan(0.001);
  });
});

describe('EllipseCurve', () => {
  it('t=0 返回起点, t=1 返回终点', () => {
    const curve = new EllipseCurve(0, 0, 2, 2, 0, Math.PI / 2, false, 0);
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    // 起点: (2, 0)
    expect(start.x).toBeCloseTo(2, 5);
    expect(start.y).toBeCloseTo(0, 5);
    // 终点: (0, 2)
    expect(end.x).toBeCloseTo(0, 5);
    expect(end.y).toBeCloseTo(2, 5);
  });

  it('整圆弧长约等于 2πr', () => {
    const r = 5;
    const curve = new EllipseCurve(0, 0, r, r, 0, Math.PI * 2, false, 0);
    const len = curve.getLength();
    // arcLengthDivisions 默认 200, 误差 < 0.1
    expect(len).toBeCloseTo(2 * Math.PI * r, 1);
  });

  it('aClockwise=true 时反向 (短弧)', () => {
    // aStartAngle=π/2, aEndAngle=0, clockwise → 短弧从 π/2 顺时针到 0
    const curve = new EllipseCurve(0, 0, 1, 1, Math.PI / 2, 0, true, 0);
    const p = curve.getPoint(0.5);
    // 中点角度 π/4: cos=√2/2, sin=√2/2
    expect(p.x).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    expect(p.y).toBeCloseTo(Math.sin(Math.PI / 4), 5);
  });

  it('aRotation 旋转椭圆', () => {
    const curve = new EllipseCurve(0, 0, 2, 1, 0, 0, false, Math.PI / 2);
    // deltaAngle=0 (samePoints), 起点 = (0,0)+旋转后...
    // aRotation=π/2 旋转 90°: cos(0)·2 → x=0, sin(0)·1→0; 旋转后 x'=-0, y'=2
    const p = curve.getPoint(0);
    // samePoints 时 deltaAngle=0, t 不影响角度, 返回起点 (aX+r·cos(start), aY+r·sin(start))
    // 起点角度 0: (2,0) → 旋转 π/2 → (0, 2)
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(2, 5);
  });
});

describe('Path', () => {
  it('moveTo + lineTo 产生 LineCurve 子曲线', () => {
    const path = new Path();
    path.moveTo(0, 0);
    path.lineTo(1, 0);
    expect(path.curves.length).toBe(1);
    expect(path.curves[0].isLineCurve).toBe(true);
    expect(path.currentPoint.x).toBeCloseTo(1, 5);
    expect(path.currentPoint.y).toBeCloseTo(0, 5);
  });

  it('quadraticCurveTo 产生 QuadraticBezierCurve', () => {
    const path = new Path();
    path.moveTo(0, 0);
    path.quadraticCurveTo(0.5, 1, 1, 0);
    expect(path.curves.length).toBe(1);
    expect(path.curves[0].isQuadraticBezierCurve).toBe(true);
    expect(path.currentPoint.x).toBeCloseTo(1, 5);
    expect(path.currentPoint.y).toBeCloseTo(0, 5);
  });

  it('bezierCurveTo 产生 CubicBezierCurve', () => {
    const path = new Path();
    path.moveTo(0, 0);
    path.bezierCurveTo(0, 1, 1, 1, 1, 0);
    expect(path.curves.length).toBe(1);
    expect(path.curves[0].isCubicBezierCurve).toBe(true);
    expect(path.currentPoint.x).toBeCloseTo(1, 5);
    expect(path.currentPoint.y).toBeCloseTo(0, 5);
  });

  it('fromPoints (构造函数) 构建线段序列', () => {
    const path = new Path([
      new Vector2(0, 0),
      new Vector2(1, 0),
      new Vector2(1, 1),
    ]);
    expect(path.curves.length).toBe(2);
    expect(path.curves[0].isLineCurve).toBe(true);
    expect(path.curves[1].isLineCurve).toBe(true);
    expect(path.currentPoint.x).toBeCloseTo(1, 5);
    expect(path.currentPoint.y).toBeCloseTo(1, 5);
  });

  it('splineThru 产生 SplineCurve', () => {
    const path = new Path();
    path.moveTo(0, 0);
    path.splineThru([new Vector2(1, 1), new Vector2(2, 0)]);
    expect(path.curves.length).toBe(1);
    expect(path.curves[0].isSplineCurve).toBe(true);
    expect(path.currentPoint.x).toBeCloseTo(2, 5);
    expect(path.currentPoint.y).toBeCloseTo(0, 5);
  });
});

describe('Shape', () => {
  it('holes 数组初始为空', () => {
    const shape = new Shape();
    expect(shape.holes).toEqual([]);
  });

  it('extractPoints 返回 shape + holes 采样点', () => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(4, 0);
    shape.lineTo(4, 4);
    shape.lineTo(0, 4);
    shape.lineTo(0, 0);

    // 添加一个矩形孔洞
    const hole = new Path();
    hole.moveTo(1, 1);
    hole.lineTo(2, 1);
    hole.lineTo(2, 2);
    hole.lineTo(1, 2);
    hole.lineTo(1, 1);
    shape.holes.push(hole);

    const result = shape.extractPoints(1);
    expect(result.shape.length).toBeGreaterThan(0);
    expect(result.holes.length).toBe(1);
    expect(result.holes[0].length).toBeGreaterThan(0);
  });

  it('getPointsHoles 返回每个孔洞的采样点', () => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(10, 0);
    shape.lineTo(10, 10);
    shape.lineTo(0, 10);
    shape.lineTo(0, 0);

    const h1 = new Path();
    h1.moveTo(1, 1);
    h1.lineTo(2, 1);
    h1.lineTo(2, 2);
    h1.lineTo(1, 2);
    h1.lineTo(1, 1);

    const h2 = new Path();
    h2.moveTo(5, 5);
    h2.lineTo(6, 5);
    h2.lineTo(6, 6);
    h2.lineTo(5, 6);
    h2.lineTo(5, 5);

    shape.holes.push(h1, h2);
    const holesPts = shape.getPointsHoles(1);
    expect(holesPts.length).toBe(2);
  });
});

describe('Curve.getUtoTmapping', () => {
  it('直线曲线返回恒等映射 (t ≈ u)', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    // 直线弧长均匀, u → t 应接近恒等
    expect(curve.getUtoTmapping(0)).toBeCloseTo(0, 4);
    expect(curve.getUtoTmapping(0.5)).toBeCloseTo(0.5, 4);
    expect(curve.getUtoTmapping(1)).toBeCloseTo(1, 4);
  });

  it('曲线化后 u=0.5 对应中弧长点', () => {
    // 用 EllipseCurve 测试: 整圆 u=0.5 应在半圈处
    const curve = new EllipseCurve(0, 0, 1, 1, 0, Math.PI * 2, false, 0);
    const t = curve.getUtoTmapping(0.5);
    // 整圆弧长均匀, u=0.5 → t≈0.5
    expect(t).toBeCloseTo(0.5, 1);
  });
});

describe('Curve.computeFrenetFrames', () => {
  it('返回 3 个长度 segments+1 的数组', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(0, 0, 10));
    const frames = curve.computeFrenetFrames(5, false);
    expect(frames.tangents.length).toBe(6);
    expect(frames.normals.length).toBe(6);
    expect(frames.binormals.length).toBe(6);
  });

  it('每个 tangent 为单位向量', () => {
    const curve = new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(1, 1, 0),
      new Vector3(2, 0, 1),
      new Vector3(3, 1, 0),
    ]);
    const frames = curve.computeFrenetFrames(10, false);
    for (const t of frames.tangents) {
      expect(t.length()).toBeCloseTo(1, 4);
    }
  });

  it('直线曲线各段切线一致', () => {
    const curve = new LineCurve3(new Vector3(0, 0, 0), new Vector3(0, 0, 5));
    const frames = curve.computeFrenetFrames(4, false);
    for (const t of frames.tangents) {
      expect(t.z).toBeCloseTo(1, 4);
    }
  });
});

describe('ShapeUtils', () => {
  it('area 计算正方形面积 (逆时针为正)', () => {
    const contour = [
      new Vector2(0, 0),
      new Vector2(2, 0),
      new Vector2(2, 2),
      new Vector2(0, 2),
    ];
    expect(ShapeUtils.area(contour)).toBeCloseTo(4, 5);
  });

  it('isClockWise 判定绕向', () => {
    const ccw = [
      new Vector2(0, 0),
      new Vector2(1, 0),
      new Vector2(1, 1),
    ];
    const cw = [
      new Vector2(0, 0),
      new Vector2(1, 1),
      new Vector2(1, 0),
    ];
    expect(ShapeUtils.isClockWise(ccw)).toBe(false);
    expect(ShapeUtils.isClockWise(cw)).toBe(true);
  });

  it('triangulateShape 剖分正方形为 2 个三角形', () => {
    const contour = [
      new Vector2(0, 0),
      new Vector2(1, 0),
      new Vector2(1, 1),
      new Vector2(0, 1),
    ];
    const faces = ShapeUtils.triangulateShape(contour, []);
    expect(faces.length).toBe(2);
    for (const face of faces) {
      expect(face.length).toBe(3);
    }
    // 总共 6 个索引 (2 三角形 × 3)
    const allIndices = faces.flat();
    expect(allIndices.length).toBe(6);
  });
});
