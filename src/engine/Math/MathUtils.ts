// MathUtils — 自研数学小工具，避免污染 Vector3/Matrix4 等核心类原型。
// 之所以不放进各自类内部，是为了让 "工具" 与 "实例方法" 在 import 上
// 清晰分离；性能敏感的代码仍走实例方法。

/** 把 v 限制在 [min, max] 之间。 */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 线性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 计算 from → to 的最短角距离（带正负号），结果范围 [-π, π]。
 * 用于球坐标方位角跨越 ±π 时的阻尼插值。
 */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 把弧度折叠到 [-π, π]。 */
export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** 数值转 dB。 */
export function toDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(amplitude, 1e-12));
}

/** dB 转数值。 */
export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}
