// MathUtils — 自研数学小工具,避免污染 Vector3/Matrix4 等核心类原型。
// 与 three.js MathUtils.js 对齐:提供与 `THREE.MathUtils` 相同的函数表面。
// 之所以不放进各自类内部,是为了让 "工具" 与 "实例方法" 在 import 上
// 清晰分离;性能敏感的代码仍走实例方法。
// 除 three.js 全集外,另保留 VREEN 自有的角度/分贝小工具
// (angleDelta / wrapAngle / toDb / fromDb)。

const _lut = ['00','01','02','03','04','05','06','07','08','09','0a','0b','0c','0d','0e','0f','10','11','12','13','14','15','16','17','18','19','1a','1b','1c','1d','1e','1f','20','21','22','23','24','25','26','27','28','29','2a','2b','2c','2d','2e','2f','30','31','32','33','34','35','36','37','38','39','3a','3b','3c','3d','3e','3f','40','41','42','43','44','45','46','47','48','49','4a','4b','4c','4d','4e','4f','50','51','52','53','54','55','56','57','58','59','5a','5b','5c','5d','5e','5f','60','61','62','63','64','65','66','67','68','69','6a','6b','6c','6d','6e','6f','70','71','72','73','74','75','76','77','78','79','7a','7b','7c','7d','7e','7f','80','81','82','83','84','85','86','87','88','89','8a','8b','8c','8d','8e','8f','90','91','92','93','94','95','96','97','98','99','9a','9b','9c','9d','9e','9f','a0','a1','a2','a3','a4','a5','a6','a7','a8','a9','aa','ab','ac','ad','ae','af','b0','b1','b2','b3','b4','b5','b6','b7','b8','b9','ba','bb','bc','bd','be','bf','c0','c1','c2','c3','c4','c5','c6','c7','c8','c9','ca','cb','cc','cd','ce','cf','d0','d1','d2','d3','d4','d5','d6','d7','d8','d9','da','db','dc','dd','de','df','e0','e1','e2','e3','e4','e5','e6','e7','e8','e9','ea','eb','ec','ed','ee','ef','f0','f1','f2','f3','f4','f5','f6','f7','f8','f9','fa','fb','fc','fd','fe','ff'];

let _seed = 1234567;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

// http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript/21963136#21963136
export function generateUUID(): string {
  const d0 = Math.random() * 0xffffffff | 0;
  const d1 = Math.random() * 0xffffffff | 0;
  const d2 = Math.random() * 0xffffffff | 0;
  const d3 = Math.random() * 0xffffffff | 0;
  const uuid =
    _lut[d0 & 0xff] + _lut[d0 >> 8 & 0xff] + _lut[d0 >> 16 & 0xff] + _lut[d0 >> 24 & 0xff] + '-' +
    _lut[d1 & 0xff] + _lut[d1 >> 8 & 0xff] + '-' + _lut[d1 >> 16 & 0x0f | 0x40] + _lut[d1 >> 24 & 0xff] + '-' +
    _lut[d2 & 0x3f | 0x80] + _lut[d2 >> 8 & 0xff] + '-' + _lut[d2 >> 16 & 0xff] + _lut[d2 >> 24 & 0xff] +
    _lut[d3 & 0xff] + _lut[d3 >> 8 & 0xff] + _lut[d3 >> 16 & 0xff] + _lut[d3 >> 24 & 0xff];
  // .toLowerCase() here flattens concatenated strings to save heap memory space.
  return uuid.toLowerCase();
}

/** 把 v 限制在 [min, max] 之间。 */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// compute euclidean modulo of m % n
// https://en.wikipedia.org/wiki/Modulo_operation
export function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// Linear mapping from range <a1, a2> to range <b1, b2>
export function mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number {
  return b1 + (x - a1) * (b2 - b1) / (a2 - a1);
}

// https://www.gamedev.net/tutorials/programming/general-and-gameplay-programming/inverse-lerp-a-super-useful-yet-often-overlooked-function-r5230/
export function inverseLerp(x: number, y: number, value: number): number {
  if (x !== y) {
    return (value - x) / (y - x);
  } else {
    return 0;
  }
}

// https://en.wikipedia.org/wiki/Linear_interpolation
export function lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}

// http://www.rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/
export function damp(x: number, y: number, lambda: number, dt: number): number {
  return lerp(x, y, 1 - Math.exp(-lambda * dt));
}

// https://www.desmos.com/calculator/vcsjnyz7x4
export function pingpong(x: number, length = 1): number {
  return length - Math.abs(euclideanModulo(x, length * 2) - length);
}

// http://en.wikipedia.org/wiki/Smoothstep
export function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  x = (x - min) / (max - min);
  return x * x * (3 - 2 * x);
}

export function smootherstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  x = (x - min) / (max - min);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// Random integer from <low, high> interval
export function randInt(low: number, high: number): number {
  return low + Math.floor(Math.random() * (high - low + 1));
}

// Random float from <low, high> interval
export function randFloat(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

// Random float from <-range/2, range/2> interval
export function randFloatSpread(range: number): number {
  return range * (0.5 - Math.random());
}

// Deterministic pseudo-random float in the interval [ 0, 1 ]
export function seededRandom(s?: number): number {
  if (s !== undefined) _seed = s;
  // Mulberry32 generator
  let t = _seed += 0x6D2B79F5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

export function degToRad(degrees: number): number {
  return degrees * DEG2RAD;
}

export function radToDeg(radians: number): number {
  return radians * RAD2DEG;
}

export function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0 && value !== 0;
}

export function ceilPowerOfTwo(value: number): number {
  return Math.pow(2, Math.ceil(Math.log(value) / Math.LN2));
}

export function floorPowerOfTwo(value: number): number {
  return Math.pow(2, Math.floor(Math.log(value) / Math.LN2));
}

/** 从固有 Proper Euler 角 (intrinsic proper Euler angles) 设置四元数。
 * 旋转按 order 指定轴序依次应用:先 a 再 b 再 c,角度为弧度。
 * 与 three.js MathUtils.setQuaternionFromProperEuler 一致。 */
export function setQuaternionFromProperEuler(
  q: { set(x: number, y: number, z: number, w: number): void },
  a: number,
  b: number,
  c: number,
  order: string
): void {
  const cos = Math.cos;
  const sin = Math.sin;

  const c2 = cos(b / 2);
  const s2 = sin(b / 2);

  const c13 = cos((a + c) / 2);
  const s13 = sin((a + c) / 2);

  const c1_3 = cos((a - c) / 2);
  const s1_3 = sin((a - c) / 2);

  const c3_1 = cos((c - a) / 2);
  const s3_1 = sin((c - a) / 2);

  switch (order) {
    case 'XYX':
      q.set(c2 * s13, s2 * c1_3, s2 * s1_3, c2 * c13);
      break;
    case 'YZY':
      q.set(s2 * s1_3, c2 * s13, s2 * c1_3, c2 * c13);
      break;
    case 'ZXZ':
      q.set(s2 * c1_3, s2 * s1_3, c2 * s13, c2 * c13);
      break;
    case 'XZX':
      q.set(c2 * s13, s2 * s3_1, s2 * c3_1, c2 * c13);
      break;
    case 'YXY':
      q.set(s2 * c3_1, c2 * s13, s2 * s3_1, c2 * c13);
      break;
    case 'ZYZ':
      q.set(s2 * s3_1, s2 * c3_1, c2 * s13, c2 * c13);
      break;
    default:
      console.warn('THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: ' + order);
  }
}

/** 把归一化浮点换算回整型分量 (与 three.js 相反方向)。
 * 注意:此 normalize 是 "值 → 整型存储" 的量化,与 Vector.normalize() 方向量归一不同。 */
// 量化属性支持的 TypedArray 联合(与 InterleavedBuffer.TypedArray 对齐)。
// 注意 Uint8ClampedArray 用于归一化时归到 Uint8 的 0..255 量化(three.js r169 一致)。
export type NormalizedArray =
  | Float32Array
  | Uint32Array
  | Uint16Array
  | Uint8Array
  | Uint8ClampedArray
  | Int32Array
  | Int16Array
  | Int8Array;

export function normalize(value: number, array: NormalizedArray): number {
  if (array instanceof Float32Array) return value;
  if (array instanceof Uint32Array) return Math.round(value * 4294967295.0);
  if (array instanceof Uint16Array) return Math.round(value * 65535.0);
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return Math.round(value * 255.0);
  if (array instanceof Int32Array) return Math.round(value * 2147483647.0);
  if (array instanceof Int16Array) return Math.round(value * 32767.0);
  if (array instanceof Int8Array) return Math.round(value * 127.0);
  throw new Error('Invalid component type.');
}

/** 整型分量 → 归一化浮点 (与 three.js 相反方向)。 */
export function denormalize(value: number, array: NormalizedArray): number {
  if (array instanceof Float32Array) return value;
  if (array instanceof Uint32Array) return value / 4294967295.0;
  if (array instanceof Uint16Array) return value / 65535.0;
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return value / 255.0;
  if (array instanceof Int32Array) return Math.max(value / 2147483647.0, -1.0);
  if (array instanceof Int16Array) return Math.max(value / 32767.0, -1.0);
  if (array instanceof Int8Array) return Math.max(value / 127.0, -1.0);
  throw new Error('Invalid component type.');
}

/** 计算 from → to 的最短角距离(带正负号),结果范围 [-π, π]。
 * 用于球坐标方位角跨越 ±π 时的阻尼插值。VREEN 扩展,非 three.js 表面。 */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 把弧度折叠到 [-π, π]。VREEN 扩展,非 three.js 表面。 */
export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** 数值转 dB。VREEN 扩展,非 three.js 表面。 */
export function toDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(amplitude, 1e-12));
}

/** dB 转数值。VREEN 扩展,非 three.js 表面。 */
export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

export const MathUtils = {
  DEG2RAD,
  RAD2DEG,
  generateUUID,
  clamp,
  euclideanModulo,
  mapLinear,
  inverseLerp,
  lerp,
  damp,
  pingpong,
  smoothstep,
  smootherstep,
  randInt,
  randFloat,
  randFloatSpread,
  seededRandom,
  degToRad,
  radToDeg,
  isPowerOfTwo,
  ceilPowerOfTwo,
  floorPowerOfTwo,
  setQuaternionFromProperEuler,
  normalize,
  denormalize,
};
