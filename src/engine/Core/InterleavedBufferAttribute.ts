// InterleavedBufferAttribute — 引用 InterleavedBuffer 切片的顶点属性表达。
//
// 适配 three.js src/core/InterleavedBufferAttribute.js。与 BufferAttribute 主要差异:
//   - 不独占 array,而是 `data: InterleavedBuffer` + `offset`(在缓冲内的位置偏移)。
//   - `array`/`count`/`needsUpdate` 通过 data 代理(getter 或转发)。
//   - getX/setX 等按 `index * stride + offset + component` 寻址,而非 `index * itemSize`.
//   - 多个 InterleavedBufferAttribute 共享同一 InterleavedBuffer(同底层数组),只 offset 不同。
//
// 用法:
//   const buffer = new InterleavedBuffer(new Float32Array([
//     x0, y0, z0, nx0, ny0, nz0,  // 顶点0: position + normal
//     x1, y1, z1, nx1, ny1, nz1,  // 顶点1
//   ]), 6);
//   const position = new InterleavedBufferAttribute(buffer, 3, 0);   // itemSize=3, offset=0
//   const normal   = new InterleavedBufferAttribute(buffer, 3, 3);   // itemSize=3, offset=3
//   // 写入共享 array 的两处位置:
//   position.setX(0, 1.5);  // 等价于 buffer.array[0*6+0] = 1.5

import { BufferAttribute } from './BufferAttribute';
import { InterleavedBuffer } from './InterleavedBuffer';
import { Matrix3 } from '../Math/Matrix3';
import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import { denormalize, normalize } from '../Math/MathUtils';
import { createLogger } from '@/lib/logger';

const log = createLogger('InterleavedBufferAttribute');
const _vector = new Vector3();

/** 交错顶点属性(three.js InterleavedBufferAttribute)。 */
export class InterleavedBufferAttribute {
  /** 类型测试标志。 */
  readonly isInterleavedBufferAttribute = true;
  /** 属性名(可选,编辑器显示用)。 */
  name: string = '';
  /** 持有 interleaved 数据的缓冲。 */
  data: InterleavedBuffer;
  /** 每顶点内占的分量数(1/2/3/4)。 */
  itemSize: number;
  /** 在缓冲中相对顶点起点的偏移(以 TypedArray 元素为单位)。 */
  offset: number;
  /** 是否归一化(配合 Uint8/Int16 等 SNP 量化属性)。 */
  normalized: boolean;

  constructor(
    interleavedBuffer: InterleavedBuffer,
    itemSize: number,
    offset: number,
    normalized: boolean = false,
  ) {
    this.data = interleavedBuffer;
    this.itemSize = itemSize;
    this.offset = offset;
    this.normalized = normalized;
  }

  /** 顶点数(等于所属 InterleavedBuffer 的 count)。 */
  get count(): number {
    return this.data.count;
  }

  /** 底层共享 TypedArray(来自 data.array)。 */
  get array() {
    return this.data.array;
  }

  /** 标脏(转发给所属缓冲)。 */
  set needsUpdate(value: boolean) {
    this.data.needsUpdate = value;
  }

  /** 版本号(代理到底层缓冲;渲染器据此判重传,与 BufferAttribute.version 同契约)。 */
  get version(): number {
    return this.data.version;
  }
  set version(value: number) {
    this.data.version = value;
  }

  /** 使用模式(代理到底层缓冲;gl.bufferData hint,与 BufferAttribute.usage 同契约)。 */
  get usage(): number {
    return this.data.usage;
  }
  set usage(value: number) {
    this.data.usage = value;
  }

  /** 把 4×4 矩阵作用到该属性(仅 itemSize=3 合法)。 */
  applyMatrix4(m: Matrix4): this {
    for (let i = 0, l = this.data.count; i < l; i++) {
      _vector.set(this.getX(i), this.getY(i), this.getZ(i)).applyMatrix4(m);
      this.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }
    // applyMatrix4 完成后通知缓冲 needUpdate(下次 getX 看到 setXYZ 已写入但 version
    // 未自增,这里补一步确保重传)。
    this.data.needsUpdate = true;
    return this;
  }

  /** 把 3×3 normal 矩阵作用到该属性(仅 itemSize=3,方向向量)。 */
  applyNormalMatrix(m: Matrix3): this {
    for (let i = 0, l = this.count; i < l; i++) {
      _vector.set(this.getX(i), this.getY(i), this.getZ(i)).applyNormalMatrix(m);
      this.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }
    this.data.needsUpdate = true;
    return this;
  }

  /** 把 4×4 矩阵作用到该属性作方向变换(仅 itemSize=3,方向向量,位移分量忽略)。 */
  transformDirection(m: Matrix4): this {
    for (let i = 0, l = this.count; i < l; i++) {
      _vector.set(this.getX(i), this.getY(i), this.getZ(i)).transformDirection(m);
      this.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }
    this.data.needsUpdate = true;
    return this;
  }

  /** 读取第 index 顶点的第 component 分量(normalized 时反量化)。 */
  getComponent(index: number, component: number): number {
    let value = this.array[index * this.data.stride + this.offset + component];
    if (this.normalized) value = denormalize(value, this.array);
    return value;
  }

  /** 设置第 index 顶点的第 component 分量(normalized 时量化)。 */
  setComponent(index: number, component: number, value: number): this {
    if (this.normalized) value = normalize(value, this.array);
    this.data.array[index * this.data.stride + this.offset + component] = value;
    return this;
  }

  getX(index: number): number {
    let x = this.data.array[index * this.data.stride + this.offset];
    if (this.normalized) x = denormalize(x, this.array);
    return x;
  }

  getY(index: number): number {
    let y = this.data.array[index * this.data.stride + this.offset + 1];
    if (this.normalized) y = denormalize(y, this.array);
    return y;
  }

  getZ(index: number): number {
    let z = this.data.array[index * this.data.stride + this.offset + 2];
    if (this.normalized) z = denormalize(z, this.array);
    return z;
  }

  getW(index: number): number {
    let w = this.data.array[index * this.data.stride + this.offset + 3];
    if (this.normalized) w = denormalize(w, this.array);
    return w;
  }

  setX(index: number, x: number): this {
    if (this.normalized) x = normalize(x, this.array);
    this.data.array[index * this.data.stride + this.offset] = x;
    return this;
  }

  setY(index: number, y: number): this {
    if (this.normalized) y = normalize(y, this.array);
    this.data.array[index * this.data.stride + this.offset + 1] = y;
    return this;
  }

  setZ(index: number, z: number): this {
    if (this.normalized) z = normalize(z, this.array);
    this.data.array[index * this.data.stride + this.offset + 2] = z;
    return this;
  }

  setW(index: number, w: number): this {
    if (this.normalized) w = normalize(w, this.array);
    this.data.array[index * this.data.stride + this.offset + 3] = w;
    return this;
  }

  setXY(index: number, x: number, y: number): this {
    index = index * this.data.stride + this.offset;
    if (this.normalized) {
      x = normalize(x, this.array);
      y = normalize(y, this.array);
    }
    this.data.array[index + 0] = x;
    this.data.array[index + 1] = y;
    return this;
  }

  setXYZ(index: number, x: number, y: number, z: number): this {
    index = index * this.data.stride + this.offset;
    if (this.normalized) {
      x = normalize(x, this.array);
      y = normalize(y, this.array);
      z = normalize(z, this.array);
    }
    this.data.array[index + 0] = x;
    this.data.array[index + 1] = y;
    this.data.array[index + 2] = z;
    return this;
  }

  setXYZW(index: number, x: number, y: number, z: number, w: number): this {
    index = index * this.data.stride + this.offset;
    if (this.normalized) {
      x = normalize(x, this.array);
      y = normalize(y, this.array);
      z = normalize(z, this.array);
      w = normalize(w, this.array);
    }
    this.data.array[index + 0] = x;
    this.data.array[index + 1] = y;
    this.data.array[index + 2] = z;
    this.data.array[index + 3] = w;
    return this;
  }

  /**
   * 克隆。
   *
   * - 不传 data:做 **de-interleave**(把该属性切片抽出来为独立 BufferAttribute),
   *   这是常规"我不需要 interleaved 表达"的便利写,代价是丢掉共享 buffer 的缓存收益。
   * - 传 data(带 interleavedBuffers 字典):克隆为 InterleavedBufferAttribute,
   *   多条属性复用同一底层 InterleavedBuffer(由 dict 去重)。
   */
  clone(data?: {
    interleavedBuffers?: Record<string, InterleavedBuffer>;
  }): BufferAttribute | InterleavedBufferAttribute {
    if (data === undefined) {
      log.warn('clone(): de-interleaving buffer data into a standalone BufferAttribute.');

      // de-interleave:按 itemSize 抽切片到独立 array,统一转 Float32Array。
      // VREEN BufferAttribute 强 Float32Array(见 BufferAttribute.ts:27),
      // 即使底层是 quantized Int16/Uint8,de-interleave 后存为浮点(getX 已反量化)。
      const deinterleaved: number[] = [];
      for (let i = 0; i < this.count; i++) {
        const index = i * this.data.stride + this.offset;
        for (let j = 0; j < this.itemSize; j++) {
          deinterleaved.push(this.data.array[index + j]);
        }
      }
      return new BufferAttribute(new Float32Array(deinterleaved), this.itemSize, this.data.usage);
    }

    if (data.interleavedBuffers === undefined) data.interleavedBuffers = {};

    if (data.interleavedBuffers[this.data.uuid] === undefined) {
      // 这里 clone InterleavedBuffer 时需切到 InterleavedBuffer.clone 的 data 协议(arrayBuffers)。
      const ibData = {} as { arrayBuffers?: Record<string, ArrayBuffer> };
      data.interleavedBuffers[this.data.uuid] = this.data.clone(ibData);
    }
    return new InterleavedBufferAttribute(
      data.interleavedBuffers[this.data.uuid],
      this.itemSize,
      this.offset,
      this.normalized,
    );
  }

  /**
   * 序列化为 JSON。
   *
   * - 无 data:de-interleave 后存为普通 BufferAttribute JSON(独立 array)。
   * - 有 data(with interleavedBuffers):存为真正的 interleaved 引用(只记 uuid/offset)。
   */
  toJSON(data?: {
    interleavedBuffers?: Record<string, InterleavedBuffer>;
  }): Record<string, unknown> {
    if (data === undefined) {
      log.warn('toJSON(): de-interleaving buffer data into standalone attribute JSON.');
      const array: number[] = [];
      for (let i = 0; i < this.count; i++) {
        const index = i * this.data.stride + this.offset;
        for (let j = 0; j < this.itemSize; j++) {
          array.push(this.data.array[index + j]);
        }
      }
      return {
        itemSize: this.itemSize,
        type: this.data.array.constructor.name,
        array,
        normalized: this.normalized,
      };
    }

    if (data.interleavedBuffers === undefined) data.interleavedBuffers = {};
    if (data.interleavedBuffers[this.data.uuid] === undefined) {
      data.interleavedBuffers[this.data.uuid] = this.data;
    }
    return {
      isInterleavedBufferAttribute: true,
      itemSize: this.itemSize,
      data: this.data.uuid,
      offset: this.offset,
      normalized: this.normalized,
    };
  }
}
