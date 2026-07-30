// LightProbe — 光照探针,用球谐函数 (SH) 编码场景入射光。
// 参考 three.js LightProbe.js:不直接发光,而是存储空间中传播的光信息,
// 渲染时用 SH 数据近似物体表面的入射辐照度。
//
// 与 three.js 的差异:
//   * 构造函数签名是 (color, intensity) 而非 (sh, intensity),
//     与 VREEN Light 基类一致;color 用于着色器调试可视化,sh 独立存储。
//   * SphericalHarmonics3 用 Float32Array(27) 而非 Array<Vector3>,
//     减少 9 个 Vector3 对象的开销,适合 GPU uniform 上传。
//
// AmbientLightProbe / HemisphereLightProbe 在构造时预计算 sh 系数,
// 应用层只需提供颜色与强度。

import { Light, type RGBColor } from './Light';
import type { Vector3 } from '../Math/Vector3';

/** 环境光探针用的归一化常数:第一阶 SH 系数 = color / 9。
 *  9 = 3×3,对应 irradiance 卷积后常数项的归一化因子。 */
const SH_CONSTANT_TERM = 9;

/**
 * SphericalHarmonics3 — 三阶实球谐 (9 系数 × 3 通道 = 27 浮点)。
 *
 * 系数布局 (Float32Array(27),每 3 个一组为一个 vec3 系数):
 *   [0..2]   band 0  Y_0^0   常数项 (各向同性环境光)
 *   [3..5]   band 1  Y_1^-1  0.488603 * y  (上下方向)
 *   [6..8]   band 1  Y_1^0   0.488603 * z  (前后方向)
 *   [9..11]  band 1  Y_1^1   0.488603 * x  (左右方向)
 *   [12..14] band 2  Y_2^-2  1.092548 * x*y
 *   [15..17] band 2  Y_2^-1  1.092548 * y*z
 *   [18..20] band 2  Y_2^0   0.315392 * (3z² - 1)
 *   [21..23] band 2  Y_2^1   1.092548 * x*z
 *   [24..26] band 2  Y_2^2   0.546274 * (x² - y²)
 *
 * 参考:
 *   - https://graphics.stanford.edu/papers/envmap/envmap.pdf
 *   - https://www.ppsloan.org/publications/StupidSH36.pdf
 */
export class SphericalHarmonics3 {
  /** 9 个 vec3 系数,扁平存储为 27 浮点。 */
  coefficients: Float32Array;

  constructor() {
    this.coefficients = new Float32Array(27);
  }

  /** 从等长数组拷贝系数 (27 个数)。 */
  set(coefficients: Float32Array | number[] | ArrayLike<number>): this {
    const src = coefficients as ArrayLike<number>;
    for (let i = 0; i < 27; i++) {
      this.coefficients[i] = src[i];
    }
    return this;
  }

  copy(sh: SphericalHarmonics3): this {
    this.coefficients.set(sh.coefficients);
    return this;
  }

  clone(): SphericalHarmonics3 {
    return new SphericalHarmonics3().copy(this);
  }

  /** 逐元素加法: this += sh。 */
  add(sh: SphericalHarmonics3): this {
    const a = this.coefficients;
    const b = sh.coefficients;
    for (let i = 0; i < 27; i++) {
      a[i] += b[i];
    }
    return this;
  }

  /** 加权加法: this += sh * s。 */
  addScaledSH(sh: SphericalHarmonics3, s: number): this {
    const a = this.coefficients;
    const b = sh.coefficients;
    for (let i = 0; i < 27; i++) {
      a[i] += b[i] * s;
    }
    return this;
  }

  /** 缩放: this *= s。 */
  scale(s: number): this {
    const a = this.coefficients;
    for (let i = 0; i < 27; i++) {
      a[i] *= s;
    }
    return this;
  }

  /** 线性插值: this = this + (sh - this) * alpha。 */
  lerp(sh: SphericalHarmonics3, alpha: number): this {
    const a = this.coefficients;
    const b = sh.coefficients;
    for (let i = 0; i < 27; i++) {
      a[i] += (b[i] - a[i]) * alpha;
    }
    return this;
  }

  equals(sh: SphericalHarmonics3): boolean {
    const a = this.coefficients;
    const b = sh.coefficients;
    for (let i = 0; i < 27; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /** 从颜色生成 SH:第一阶系数 = color / 9,其余为 0。
   *  用于 AmbientLightProbe,表示各向同性的环境光。 */
  static fromColor(color: RGBColor): SphericalHarmonics3 {
    const sh = new SphericalHarmonics3();
    const c = sh.coefficients;
    c[0] = color.r / SH_CONSTANT_TERM;
    c[1] = color.g / SH_CONSTANT_TERM;
    c[2] = color.b / SH_CONSTANT_TERM;
    // c[3..26] already 0
    return sh;
  }

  /** 在给定方向上求值二阶实球谐基 (9 个标量系数)。
   *  direction 假设已归一化。返回 Float32Array(9)。
   *  系数顺序与 coefficients 字段中的 vec3 分组一一对应。 */
  static evalSH(direction: Vector3): Float32Array {
    const { x, y, z } = direction;
    const out = new Float32Array(9);
    // band 0
    out[0] = 0.282095;
    // band 1
    out[1] = 0.488603 * y;
    out[2] = 0.488603 * z;
    out[3] = 0.488603 * x;
    // band 2
    out[4] = 1.092548 * x * y;
    out[5] = 1.092548 * y * z;
    out[6] = 0.315392 * (3 * z * z - 1);
    out[7] = 1.092548 * x * z;
    out[8] = 0.546274 * (x * x - y * y);
    return out;
  }
}

/**
 * LightProbe — 用球谐函数编码入射光的光源节点。
 *
 * 与 AmbientLight 不同,LightProbe 可以表达方向性环境光
 * (例如"上方偏暖、下方偏冷")。默认 sh 全零,需要手动填充或
 * 通过 AmbientLightProbe / HemisphereLightProbe 子类预计算。
 */
export class LightProbe extends Light {
  override readonly type: string = 'LightProbe';
  /** 此标志可用于类型测试。 */
  isLightProbe: boolean = true;

  /** 球谐系数,编码 3 阶 SH (27 浮点)。 */
  sh: SphericalHarmonics3;

  constructor(color: number | string = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.sh = new SphericalHarmonics3();
  }

  copy(source: LightProbe): this {
    this.color = { ...source.color };
    this.intensity = source.intensity;
    this.sh.copy(source.sh);
    return this;
  }

  override toJSON(_meta?: unknown): Record<string, unknown> {
    const data = super.toJSON();
    (data as Record<string, unknown>).sh = Array.from(this.sh.coefficients);
    return data;
  }
}
