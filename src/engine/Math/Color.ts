// Color — RGB 颜色,r/g/b 为 0..1 浮点,参考 three.js Color.js。
// 简化点:
//   * 不引入 ColorManagement,r/g/b 存储即输入值;线性 ↔ sRGB 转换由
//     convertSRGBToLinear / convertLinearToSRGB 显式调用。
//   * set(string) 仅支持 #rgb / #rrggbb 十六进制字符串,不支持 X11 颜色名
//     与 rgb()/hsl() CSS 函数(保持文件精简)。
//   * setHex/getHex 直接按通道读写,不做色彩空间转换。

import { clamp } from './MathUtils';

/** HSL 输出容器,所有字段范围 0..1。 */
export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** sRGB → Linear 的标准分段函数。 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear → sRGB 的标准分段函数。 */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** 欧几里得模,结果始终落在 [0, n)。 */
function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

export class Color {
  r: number;
  g: number;
  b: number;

  constructor();
  constructor(hex: number);
  constructor(style: string);
  constructor(r: number, g: number, b: number);
  constructor(r?: number | string, g?: number, b?: number) {
    this.r = 1;
    this.g = 1;
    this.b = 1;
    if (r !== undefined) {
      this.set(r, g, b);
    }
  }

  /** 设置颜色:接受 Color / 数字(hex) / 字符串(#hex) / (r, g, b)。 */
  set(r: number | string | Color, g?: number, b?: number): this {
    if (g !== undefined && b !== undefined) {
      this.setRGB(r as number, g, b);
      return this;
    }
    if (typeof r === 'number') {
      this.setHex(r);
      return this;
    }
    if (r instanceof Color) {
      this.copy(r);
      return this;
    }
    // 字符串:仅支持 #rgb / #rrggbb
    if (r.startsWith('#')) {
      const hex = r.slice(1);
      if (hex.length === 3) {
        this.setRGB(
          parseInt(hex.charAt(0), 16) / 15,
          parseInt(hex.charAt(1), 16) / 15,
          parseInt(hex.charAt(2), 16) / 15,
        );
        return this;
      }
      if (hex.length === 6) {
        this.setHex(parseInt(hex, 16));
        return this;
      }
    }
    console.warn(`Color: unknown color string: ${r}`);
    return this;
  }

  setScalar(s: number): this {
    this.r = s;
    this.g = s;
    this.b = s;
    return this;
  }

  /** 从 0xRRGGBB 十六进制设置(r/g/b 归一化到 0..1)。 */
  setHex(hex: number): this {
    hex = Math.floor(hex);
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }

  setRGB(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  /** 从 HSL 设置颜色,h/s/l 范围 0..1。 */
  setHSL(h: number, s: number, l: number): this {
    h = euclideanModulo(h, 1);
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);

    if (s === 0) {
      this.r = this.g = this.b = l;
    } else {
      const p = l <= 0.5 ? l * (1 + s) : l + s - l * s;
      const q = 2 * l - p;
      this.r = hue2rgb(q, p, h + 1 / 3);
      this.g = hue2rgb(q, p, h);
      this.b = hue2rgb(q, p, h - 1 / 3);
    }
    return this;
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b);
  }

  copy(c: Color): this {
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    return this;
  }

  /** 把当前颜色当作 sRGB,就地转换为 Linear。 */
  convertSRGBToLinear(): this {
    this.r = srgbToLinear(this.r);
    this.g = srgbToLinear(this.g);
    this.b = srgbToLinear(this.b);
    return this;
  }

  /** 把当前颜色当作 Linear,就地转换为 sRGB。 */
  convertLinearToSRGB(): this {
    this.r = linearToSrgb(this.r);
    this.g = linearToSrgb(this.g);
    this.b = linearToSrgb(this.b);
    return this;
  }

  /** 拷贝 c 并转 sRGB→Linear,写入 this。 */
  copySRGBToLinear(c: Color): this {
    this.r = srgbToLinear(c.r);
    this.g = srgbToLinear(c.g);
    this.b = srgbToLinear(c.b);
    return this;
  }

  /** 拷贝 c 并转 Linear→sRGB,写入 this。 */
  copyLinearToSRGB(c: Color): this {
    this.r = linearToSrgb(c.r);
    this.g = linearToSrgb(c.g);
    this.b = linearToSrgb(c.b);
    return this;
  }

  /** 返回 0xRRGGBB 整数。 */
  getHex(): number {
    return (
      Math.round(clamp(this.r * 255, 0, 255)) * 65536 +
      Math.round(clamp(this.g * 255, 0, 255)) * 256 +
      Math.round(clamp(this.b * 255, 0, 255))
    );
  }

  /** 返回 6 位十六进制字符串(不含 #)。 */
  getHexString(): string {
    return ('000000' + this.getHex().toString(16)).slice(-6);
  }

  /** 计算 HSL 并写入 target,范围 0..1。 */
  getHSL(target: HSL): HSL {
    const r = this.r, g = this.g, b = this.b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (min + max) / 2;
    let hue = 0;
    let saturation = 0;

    if (min !== max) {
      const delta = max - min;
      saturation = lightness <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
      switch (max) {
        case r: hue = (g - b) / delta + (g < b ? 6 : 0); break;
        case g: hue = (b - r) / delta + 2; break;
        case b: hue = (r - g) / delta + 4; break;
      }
      hue /= 6;
    }

    target.h = hue;
    target.s = saturation;
    target.l = lightness;
    return target;
  }

  add(c: Color): this {
    this.r += c.r;
    this.g += c.g;
    this.b += c.b;
    return this;
  }

  addColors(a: Color, b: Color): this {
    this.r = a.r + b.r;
    this.g = a.g + b.g;
    this.b = a.b + b.b;
    return this;
  }

  addScalar(s: number): this {
    this.r += s;
    this.g += s;
    this.b += s;
    return this;
  }

  multiply(c: Color): this {
    this.r *= c.r;
    this.g *= c.g;
    this.b *= c.b;
    return this;
  }

  multiplyScalar(s: number): this {
    this.r *= s;
    this.g *= s;
    this.b *= s;
    return this;
  }

  /** 线性插值 RGB,this = this + (c - this) * alpha。 */
  lerp(c: Color, alpha: number): this {
    this.r += (c.r - this.r) * alpha;
    this.g += (c.g - this.g) * alpha;
    this.b += (c.b - this.b) * alpha;
    return this;
  }

  lerpColors(a: Color, b: Color, alpha: number): this {
    this.r = a.r + (b.r - a.r) * alpha;
    this.g = a.g + (b.g - a.g) * alpha;
    this.b = a.b + (b.b - a.b) * alpha;
    return this;
  }

  equals(c: Color): boolean {
    return c.r === this.r && c.g === this.g && c.b === this.b;
  }

  fromArray(array: number[], offset = 0): this {
    this.r = array[offset];
    this.g = array[offset + 1];
    this.b = array[offset + 2];
    return this;
  }

  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.r;
    array[offset + 1] = this.g;
    array[offset + 2] = this.b;
    return array;
  }

  /** 序列化为 hex 整数,与 three.js 一致。 */
  toJSON(): number {
    return this.getHex();
  }
}
