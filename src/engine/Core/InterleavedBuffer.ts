// InterleavedBuffer — 把多个顶点属性(position/normal/uv/color…)打包进单个共享
// TypedArray 的"交错缓冲"。适配 three.js src/core/InterleavedBuffer.js。
//
// Interleaved(交错)意味着一组属性共用一个底层 ArrayBuffer,各自以不同 offset
// 引用其中切片。这样 GPU 一次 vertex fetch 就能拿到一顶点的多个属性,缓存命中
// 率高于多 buffer 模型;glTF 量化属性(`KHR_mesh_quantization`)与
// `EXT_mesh_gpu_instancing` 产出的几何体也是 interleaved,VREEN 现需在加载侧
// de-interleave 回独立 Float32Array,本类提供"原生 interleaved 表达"避免这次拷贝。
//
// 与现有 BufferAttribute 的关系:
//   - BufferAttribute 是"独占 buffer + itemSize"的独立属性;
//   - InterleavedBuffer 是"共享 buffer + stride",本身不直接作 vertex attribute,
//     而是被若干 InterleavedBufferAttribute(offset/itemSize 引用)组合使用。
//   - array 类型放宽到任意 TypedArray(Float32Array / Int16Array / Uint8Array 等),
//     支持 glTF 量化(int16/unorm8 等)与 half-float(DataUtils) 编码。
//
// 渲染侧:vertexAttribPointer 用同一 buffer 配 `stride` 与 `offset`(非 0 stride),
// three.js WebGLAttributes 对应;VREEN 的 MeshShaderPipeline/WebGL2Renderer 本类
// 已提供 buffer 配置入口(后续接入使用 buildInterleavedXxx)。

import { generateUUID } from '../Math/MathUtils';

/** VREEN 支持的顶点属性 TypedArray 范围(与 MathUtils.normalize 对齐)。 */
export type TypedArray =
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray;

/** 使用模式(gl.bufferData hint)。0x88e4 = gl.STATIC_DRAW。 */
export const STATIC_DRAW = 0x88e4;

/**
 * 单条更新区间(updateRanges 元素):start 起 count 个分量需重传 GPU。
 * 用于只刷新一段顶点(如蒙皮子集)的场景。
 */
export interface UpdateRange {
  start: number;
  count: number;
}

/** 交错缓冲 — 共享 TypedArray + stride。 */
export class InterleavedBuffer {
  /** 类型测试标志(three.js 约定)。 */
  isInterleavedBuffer = true;
  /** 共享 TypedArray(被多个 InterleavedBufferAttribute 通过 offset 引用)。 */
  array: TypedArray;
  /** 每顶点的 TypedArray 元素数(各属性 itemSize 之和)。 */
  stride: number;
  /** 元素总数 / stride = 顶点数(等于 array.length / stride)。 */
  count: number;
  /** hint,见 STATIC_DRAW / gl.DYNAMIC_DRAW / gl.STREAM_DRAW。 */
  usage: number = STATIC_DRAW;
  /** 局部更新区间列表(每渲染帧由 clearUpdateRanges 清空)。 */
  updateRanges: UpdateRange[] = [];
  /** 版本号,needsUpdate=true 时自增,渲染侧据此重传。 */
  version: number = 0;
  /** 实例 UUID(供 clone/toJSON 跨引用)。 */
  uuid: string = generateUUID();

  constructor(array: TypedArray, stride: number) {
    this.array = array;
    this.stride = stride;
    this.count = array !== undefined ? array.length / stride : 0;
  }

  /** 渲染器把数据传到 GPU 后调用(默认 noop,可挂钩做回收)。 */
  onUploadCallback(): void {}

  /** 标记脏:设 true 自增 version。 */
  set needsUpdate(value: boolean) {
    if (value === true) this.version++;
  }

  /** 设使用模式(gl.STATIC_DRAW / DYNAMIC_DRAW / STREAM_DRAW)。 */
  setUsage(value: number): this {
    this.usage = value;
    return this;
  }

  /** 增加一段待更新区间。 */
  addUpdateRange(start: number, count: number): this {
    this.updateRanges.push({ start, count });
    return this;
  }

  /** 清空全部待更新区间。 */
  clearUpdateRanges(): this {
    this.updateRanges.length = 0;
    return this;
  }

  /** 从 source 赋值(深拷贝 array)。 */
  copy(source: InterleavedBuffer): this {
    // 用同种 TypedArray 构造函数复制底层 buffer。
    // 构造函数既接受 length(number),也接受 ArrayLike<number>(如另一个 TypedArray)——
    // 这里传源 array 做元素拷贝。
    const Ctor = source.array.constructor as new (arg: number | ArrayLike<number>) => TypedArray;
    this.array = new Ctor(source.array as ArrayLike<number>);
    this.count = source.count;
    this.stride = source.stride;
    this.usage = source.usage;
    return this;
  }

  /** 把 source 的第 index2 个顶点整条拷到本 buffer 第 index1 个顶点槽位。 */
  copyAt(index1: number, interleavedBuffer: InterleavedBuffer, index2: number): this {
    const i1 = index1 * this.stride;
    const i2 = index2 * interleavedBuffer.stride;
    for (let i = 0, l = this.stride; i < l; i++) {
      this.array[i1 + i] = interleavedBuffer.array[i2 + i];
    }
    return this;
  }

  /** 从 value 数组批量写入,offset 为本 array 起始下标。 */
  set(value: ArrayLike<number>, offset: number = 0): this {
    this.array.set(value, offset as unknown as number);
    return this;
  }

  /** 注册 GPU 上传完成回调(传数据后回收 CPU buffer 用)。 */
  onUpload(callback: () => void): this {
    this.onUploadCallback = callback;
    return this;
  }

  /**
   * 克隆(保留 interleaved 语义)。
   * @param data 共享上下文,带 arrayBuffers 字典使多条 attribute 复用同一底层 buffer,
   *             避免顶点数据被复制多份。
   */
  clone(data: { arrayBuffers?: Record<string, ArrayBuffer> } = {}): InterleavedBuffer {
    if (data.arrayBuffers === undefined) data.arrayBuffers = {};

    // 给底层 ArrayBuffer 一个稳定 UUID 字段,作为 dedup 钥匙(副作用绑定到 ArrayBuffer 对象)。
    const buf = this.array.buffer as ArrayBuffer & { _uuid?: string };
    if (buf._uuid === undefined) buf._uuid = generateUUID();

    if (data.arrayBuffers[buf._uuid] === undefined) {
      data.arrayBuffers[buf._uuid] = this.array.slice(0).buffer;
    }
    const shared = data.arrayBuffers[buf._uuid];
    const Ctor = this.array.constructor as new (b: ArrayBuffer) => TypedArray;
    const array = new Ctor(shared);

    const ib = new InterleavedBuffer(array, this.stride);
    ib.setUsage(this.usage);
    return ib;
  }

  /** 序列化为 JSON(meta 里存 arrayBuffers 字典,引用同一底层 buffer)。 */
  toJSON(data: { arrayBuffers?: Record<string, number[]> } = {}): Record<string, unknown> {
    if (data.arrayBuffers === undefined) data.arrayBuffers = {};

    const buf = this.array.buffer as ArrayBuffer & { _uuid?: string };
    if (buf._uuid === undefined) buf._uuid = generateUUID();

    if (data.arrayBuffers[buf._uuid] === undefined) {
      // 用 Uint32 视图把任意字节按 32-bit 切片序列化(JSON 不能存字节)。
      data.arrayBuffers[buf._uuid] = Array.from(new Uint32Array(this.array.buffer));
    }

    const json: Record<string, unknown> = {
      uuid: this.uuid,
      buffer: buf._uuid,
      type: this.array.constructor.name,
      stride: this.stride,
    };
    if (this.usage !== STATIC_DRAW) json.usage = this.usage;
    return json;
  }
}

/**
 * InterleavedBuffer 的实例化版本(per-instance stride 推进)。
 *
 * 与 InstancedBufferAttribute 类似 — meshPerAttribute 对应
 * `gl.vertexAttribDivisor(loc, N)`,N 由 meshPerAttribute 决定(1 = 每个实例一份)。
 */
export class InstancedInterleavedBuffer extends InterleavedBuffer {
  /** 类型测试标志(子类新增,与父类 isInterleavedBuffer 并存)。 */
  readonly isInstancedInterleavedBuffer?: true = true;
  /** 每 N 个实例复用一份该 attribute(见 InstancedBufferAttribute.meshPerAttribute)。 */
  meshPerAttribute: number;

  constructor(array: TypedArray, stride: number, meshPerAttribute: number = 1) {
    super(array, stride);
    this.meshPerAttribute = meshPerAttribute;
  }

  override copy(source: InstancedInterleavedBuffer): this {
    super.copy(source);
    this.meshPerAttribute = source.meshPerAttribute;
    return this;
  }

  override clone(data: { arrayBuffers?: Record<string, ArrayBuffer> } = {}): InstancedInterleavedBuffer {
    const ib = super.clone(data);
    // super.clone 返回 InterleavedBuffer,但底层 array/stride 已具备;重新包装为子类。
    const inst = new InstancedInterleavedBuffer(ib.array, ib.stride, this.meshPerAttribute);
    inst.setUsage(ib.usage);
    return inst;
  }

  override toJSON(data: { arrayBuffers?: Record<string, number[]> } = {}): Record<string, unknown> {
    const json = super.toJSON(data);
    json.isInstancedInterleavedBuffer = true;
    json.meshPerAttribute = this.meshPerAttribute;
    return json;
  }
}
