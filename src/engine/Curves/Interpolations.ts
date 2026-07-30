// Interpolations — Bézier / Catmull-Rom 基函数。
// Adapted from three.js src/extras/core/Interpolations.js (MIT).
// 公式来源: https://en.wikipedia.org/wiki/B%C3%A9zier_curve

/**
 * Catmull-Rom 基函数 (uniform, tension=0.5 标准 Catmull-Rom)。
 * 给定四个控制点 p0..p3 与参数 t∈[0,1],返回插值结果。
 */
export function CatmullRom(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

/** 二次贝塞尔 P0 基函数 (1-t)²·p */
export function QuadraticBezierP0(t: number, p: number): number {
  const k = 1 - t;
  return k * k * p;
}

/** 二次贝塞尔 P1 基函数 2(1-t)t·p */
export function QuadraticBezierP1(t: number, p: number): number {
  return 2 * (1 - t) * t * p;
}

/** 二次贝塞尔 P2 基函数 t²·p */
export function QuadraticBezierP2(t: number, p: number): number {
  return t * t * p;
}

/** 二次贝塞尔曲线 t∈[0,1] → value */
export function QuadraticBezier(t: number, p0: number, p1: number, p2: number): number {
  return QuadraticBezierP0(t, p0) + QuadraticBezierP1(t, p1) + QuadraticBezierP2(t, p2);
}

/** 三次贝塞尔 P0 基函数 (1-t)³·p */
export function CubicBezierP0(t: number, p: number): number {
  const k = 1 - t;
  return k * k * k * p;
}

/** 三次贝塞尔 P1 基函数 3(1-t)²t·p */
export function CubicBezierP1(t: number, p: number): number {
  const k = 1 - t;
  return 3 * k * k * t * p;
}

/** 三次贝塞尔 P2 基函数 3(1-t)t²·p */
export function CubicBezierP2(t: number, p: number): number {
  return 3 * (1 - t) * t * t * p;
}

/** 三次贝塞尔 P3 基函数 t³·p */
export function CubicBezierP3(t: number, p: number): number {
  return t * t * t * p;
}

/** 三次贝塞尔曲线 t∈[0,1] → value */
export function CubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  return CubicBezierP0(t, p0) + CubicBezierP1(t, p1) + CubicBezierP2(t, p2) + CubicBezierP3(t, p3);
}
