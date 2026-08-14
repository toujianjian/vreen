// DataUtils — 半精度浮点 (FP16 ↔ FP32) 转换工具。
//
// 适配 three.js src/extras/DataUtils.js,移植"Fast Half Float Conversions"
// (http://www.fox-toolkit.org/ftp/fasthalffloatconversion.pdf)的查表实现:
//   - FP32→FP16:用 512 项 baseTable + shiftTable 查表位移,绕开分支判断
//   - FP16→FP32:用 2048 项 mantissaTable + 64 项 exponentTable/offsetTable 查表
// 表在模块加载时一次性构造(module-scope 常量),之后所有 toHalfFloat /
// fromHalfFloat 调用都是 O(1) 查表,适合热路径(后处理 ping-pong、morph
// target 编码、HDR texture readback)。
//
// 为什么放在 Math/ 而不是 extras/:VREEN 无 extras/ 目录,且 half-float
// 转换是纯数学位运算,与 MathUtils/Tonemapping/Color 一类工具并列更合理;
// 渲染器 / 后处理 / 资产加载器都可从 Math barrel 直接 import。
//
// 覆盖范围(three.js r169 等价):
//   - toHalfFloat(val)  →  number  16-bit IEEE 754(对 ±65504 钳位,溢出 warn)
//   - fromHalfFloat(val) →  number  32-bit 浮点(支持 denorm/normal/Inf/NaN)
//   - DataUtils.{toHalfFloat, fromHalfFloat}  静态类接口(three.js 用法对齐)
//
// 与 soup3D 对比:soup3D 无任何半精度路径,光照/纹理全走 8-bit LDR;
// VREEN 的 MRTTarget / Texture / WebGL2Renderer 已声明 'half-float' (RGBA16F)
// 格式,本工具把这些"声明"落地为真实 CPU 侧精度转换,贯通 HDR 后处理与
// GPU-Driven renderer 的 G-Buffer half-float 路径。

import { clamp } from './MathUtils';
import { createLogger } from '@/lib/logger';

const log = createLogger('DataUtils');

// ─── 查表构造─────────────────────────────────────────────────────
// float32 ↔ uint32 共享 buffer,做位 reinterpret 位运算。

interface HalfFloatTables {
  floatView: Float32Array;
  uint32View: Uint32Array;
  baseTable: Uint32Array;
  shiftTable: Uint32Array;
  mantissaTable: Uint32Array;
  exponentTable: Uint32Array;
  offsetTable: Uint32Array;
}

function generateHalfFloatTables(): HalfFloatTables {
  const buffer = new ArrayBuffer(4);
  const floatView = new Float32Array(buffer);
  const uint32View = new Uint32Array(buffer);

  // float32 → float16 查表:512 项(256 正常 + 256 符号位变体)。
  const baseTable = new Uint32Array(512);
  const shiftTable = new Uint32Array(512);

  for (let i = 0; i < 256; ++i) {
    const e = i - 127;

    if (e < -27) {
      // 非常小(0、-0)
      baseTable[i] = 0x0000;
      baseTable[i | 0x100] = 0x8000;
      shiftTable[i] = 24;
      shiftTable[i | 0x100] = 24;
    } else if (e < -14) {
      // 小数(denormalized,非规格化)
      baseTable[i] = 0x0400 >> (-e - 14);
      baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
      shiftTable[i] = -e - 1;
      shiftTable[i | 0x100] = -e - 1;
    } else if (e <= 15) {
      // 规格化(normal)
      baseTable[i] = (e + 15) << 10;
      baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000;
      shiftTable[i] = 13;
      shiftTable[i | 0x100] = 13;
    } else if (e < 128) {
      // 大数(Infinity、-Infinity)
      baseTable[i] = 0x7c00;
      baseTable[i | 0x100] = 0xfc00;
      shiftTable[i] = 24;
      shiftTable[i | 0x100] = 24;
    } else {
      // 保持(NaN、Infinity、-Infinity)
      baseTable[i] = 0x7c00;
      baseTable[i | 0x100] = 0xfc00;
      shiftTable[i] = 13;
      shiftTable[i | 0x100] = 13;
    }
  }

  // float16 → float32 查表:2048 项 mantissa + 64 项 exponent/offset。
  const mantissaTable = new Uint32Array(2048);
  const exponentTable = new Uint32Array(64);
  const offsetTable = new Uint32Array(64);

  for (let i = 1; i < 1024; ++i) {
    let m = i << 13; // 低位补零
    let e = 0;
    // 规格化:左移直到首位为 1
    while ((m & 0x00800000) === 0) {
      m <<= 1;
      e -= 0x00800000;
    }
    m &= ~0x00800000; // 清隐含最高位
    e += 0x38800000; // bias 调整(float16 → float32)
    mantissaTable[i] = m | e;
  }

  for (let i = 1024; i < 2048; ++i) {
    mantissaTable[i] = 0x38000000 + ((i - 1024) << 13);
  }

  for (let i = 1; i < 31; ++i) {
    exponentTable[i] = i << 23;
  }
  exponentTable[31] = 0x47800000;
  exponentTable[32] = 0x80000000;
  for (let i = 33; i < 63; ++i) {
    exponentTable[i] = 0x80000000 + ((i - 32) << 23);
  }
  exponentTable[63] = 0xc7800000;

  for (let i = 1; i < 64; ++i) {
    if (i !== 32) {
      offsetTable[i] = 1024;
    }
  }

  return {
    floatView,
    uint32View,
    baseTable,
    shiftTable,
    mantissaTable,
    exponentTable,
    offsetTable,
  };
}

// 模块级常量:加载时构造一次,之后所有调用 O(1) 查表。
const _tables = generateHalfFloatTables();

/**
 * 把单精度浮点 (FP32) 转换为半精度浮点 (FP16, IEEE 754 binary16)。
 *
 * 溢出 ±65504(Half-Float 最大可表示值)会 warn 并钳位到 ±65504。
 *
 * @param val 单精度浮点值
 * @returns 16-bit 半精度值(以 JS number 承载,低 16 位有效)
 */
export function toHalfFloat(val: number): number {
  if (Math.abs(val) > 65504) {
    log.warn('DataUtils.toHalfFloat(): Value out of range, clamping to ±65504.');
  }

  val = clamp(val, -65504, 65504);

  _tables.floatView[0] = val;
  const f = _tables.uint32View[0];
  const e = (f >> 23) & 0x1ff;
  return _tables.baseTable[e] + ((f & 0x007fffff) >> _tables.shiftTable[e]);
}

/**
 * 把半精度浮点 (FP16, IEEE 754 binary16) 转换为单精度浮点 (FP32)。
 *
 * 支持 denormalized(非规格化)/ normal / Infinity / NaN 全部 IEEE 754 类别。
 *
 * @param val 16-bit 半精度值(以 JS number 承载,低 16 位有效)
 * @returns 单精度浮点值
 */
export function fromHalfFloat(val: number): number {
  const m = val >> 10;
  _tables.uint32View[0] =
    _tables.mantissaTable[_tables.offsetTable[m] + (val & 0x3ff)] +
    _tables.exponentTable[m];
  return _tables.floatView[0];
}

/**
 * 数据工具静态类(three.js 用法对齐)。
 *
 * ```ts
 * import { DataUtils } from '@vreen/engine/math';
 * const h = DataUtils.toHalfFloat(1.5);       // 0x3e00
 * const f = DataUtils.fromHalfFloat(0x3e00);  // 1.5
 * ```
 */
export class DataUtils {
  /** @see {@link toHalfFloat} */
  static toHalfFloat(val: number): number {
    return toHalfFloat(val);
  }

  /** @see {@link fromHalfFloat} */
  static fromHalfFloat(val: number): number {
    return fromHalfFloat(val);
  }
}
