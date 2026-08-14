// GLBufferAttribute — 直接持有原生 WebGLBuffer 句柄的顶点属性,跳过 CPU array。
// 适配 three.js src/core/GLBufferAttribute.js (r169)。
//
// 与 BufferAttribute / InterleavedBufferAttribute 的关键差异:
//   - 普通 BufferAttribute 持有 CPU 侧 TypedArray,渲染器据此 `gl.bufferData` 上传
//     一个独立 VBO;GLBufferAttribute **没有 CPU array**,直接持有一个已在 GPU 上的
//     `WebGLBuffer` 句柄(`buffer` 字段),渲染器跳过上传、直接 `gl.bindBuffer` +
//     `gl.vertexAttribPointer` 用它。
//   - 典型用法:GPGPU(Feedback Buffer / Transform Feedback / Compute 写出的 VBO)
//     产出顶点数据 → 用 GLBufferAttribute 把该 VBO 直接当某顶点属性的源,免去
//     GPU→CPU→GPU 的回读往返。粒子(模拟后直渲染)、GPU 蒙皮后回吐、CTM geometry
//     shrink 等都是这个模式。
//   - 因为没有 array,`count` 必须由调用方显式给出(渲染器不能从 array.length 推断),
//     `type`/`elementSize`(每分量字节数)也由调用方声明(`gl.vertexAttribPointer` 的
//     type 形参)。
//
// 本类目前仅描数据(buffer 句柄 + type/itemSize/count/normalized + version),渲染器侧
// 的 "若 attribute.isGLBufferAttribute 则 bindBuffer 而非 bufferData" 分支由 WebGL2Renderer
// 消费(与 three.js WebGLBindingStates 对应)。无 GL 环境时 buffer 用任意对象占位即可单测。

/** 原生 WebGL 数据类型(gl.FLOAT 等)。 */
export type GLType =
  | typeof GL_BYTE
  | typeof GL_UNSIGNED_BYTE
  | typeof GL_SHORT
  | typeof GL_UNSIGNED_SHORT
  | typeof GL_INT
  | typeof GL_UNSIGNED_INT
  | typeof GL_FLOAT;

/** gl.BYTE = 0x1400。 */
export const GL_BYTE = 0x1400;
/** gl.UNSIGNED_BYTE = 0x1401。 */
export const GL_UNSIGNED_BYTE = 0x1401;
/** gl.SHORT = 0x1402。 */
export const GL_SHORT = 0x1402;
/** gl.UNSIGNED_SHORT = 0x1403。 */
export const GL_UNSIGNED_SHORT = 0x1403;
/** gl.INT = 0x1404。 */
export const GL_INT = 0x1404;
/** gl.UNSIGNED_INT = 0x1405。 */
export const GL_UNSIGNED_INT = 0x1405;
/** gl.FLOAT = 0x1406。 */
export const GL_FLOAT = 0x1406;

/**
 * 每分量字节数(type → elementSize 查表)。
 * `gl.vertexAttribPointer` 需要它把 stride/offset 换算成字节;GLBufferAttribute 因为
 * 没有 array,无法从 TypedArray 构造函数自动推出 elementSize,故集中查表。
 */
export const GL_ELEMENT_SIZE: Record<number, number> = {
  [GL_BYTE]: 1,
  [GL_UNSIGNED_BYTE]: 1,
  [GL_SHORT]: 2,
  [GL_UNSIGNED_SHORT]: 2,
  [GL_INT]: 4,
  [GL_UNSIGNED_INT]: 4,
  [GL_FLOAT]: 4,
};

/**
 * 按 type 查每分量字节数;未知 type 返回 4(最常见 Float 默认),调用方通常会先
 * 显式 setType(...)/setElementSize(...),此处仅作容错兜底。
 */
export function glElementSize(type: number): number {
  return GL_ELEMENT_SIZE[type] ?? 4;
}

/** 原生 WebGL buffer 句柄(无 GL 环境下可传任意对象,只作身份保存/比较)。 */
export type GLBufferHandle = unknown;

/**
 * 直接绑定 GPU VBO 的顶点属性(three.js GLBufferAttribute)。
 *
 * 渲染器约定:见到 `isGLBufferAttribute === true` 的属性,跳过 `gl.bufferData` 上传,
 * 直接用 `buffer` 字段做 `gl.bindBuffer(gl.ARRAY_BUFFER, attribute.buffer)` +
 * `gl.vertexAttribPointer(loc, type, normalized, stride, offset)`。
 */
export class GLBufferAttribute {
  /** 类型测试标志(three.js 约定)。 */
  readonly isGLBufferAttribute = true;
  /** 属性名(可选)。 */
  name: string = '';
  /** 原生 WebGL buffer 句柄(已在 GPU 上的 VBO)。 */
  buffer: GLBufferHandle;
  /** 原生数据类型(gl.FLOAT / gl.UNSIGNED_SHORT 等),作 vertexAttribPointer 的 type。 */
  type: number;
  /** 每顶点内占的分量数(1/2/3/4)。 */
  itemSize: number;
  /** 每分量的字节数(由 type 推出,亦可手动覆盖)。 */
  elementSize: number;
  /** 顶点数(无 array 可推,需显式声明)。 */
  count: number;
  /** 整型数据是否归一化(vertexAttribPointer 的 normalized 形参)。 */
  normalized: boolean;
  /** 版本号,needsUpdate=true 时自增,渲染器据此判定是否要重配 vertex attrib。 */
  version: number = 0;

  /**
   * @param buffer 原生 WebGLBuffer(gpgpu 写出的 VBO,或 caller 已 bufferData 的 buffer)。
   * @param type   原生数据类型(传 GL_FLOAT 等)。
   * @param itemSize 每顶点分量数。
   * @param elementSize 每分量字节数;如省略则按 type 自动查 GL_ELEMENT_SIZE 表。
   * @param count   顶点数(无 array 可推断,必须显式)。
   * @param normalized 整型是否归一化(默认 false)。
   */
  constructor(
    buffer: GLBufferHandle,
    type: number,
    itemSize: number,
    elementSize?: number,
    count: number = 0,
    normalized: boolean = false,
  ) {
    this.buffer = buffer;
    this.type = type;
    this.itemSize = itemSize;
    this.elementSize = elementSize ?? glElementSize(type);
    this.count = count;
    this.normalized = normalized;
  }

  /** 标脏:设 true 自增 version。 */
  set needsUpdate(value: boolean) {
    if (value === true) this.version++;
  }

  /** 整个属性在 VBO 内占的字节数 = 顶点数 × itemSize × elementSize。供渲染器/调试。 */
  get byteLength(): number {
    return this.count * this.itemSize * this.elementSize;
  }

  /** 替换原生 buffer 句柄(例如 GPGPU 每帧产出新 VBO 时)。链式。 */
  setBuffer(buffer: GLBufferHandle): this {
    this.buffer = buffer;
    return this;
  }

  /** 同时设 type 与 elementSize(elementSize 由 type 自动查表)。链式。 */
  setType(type: number, elementSize: number = glElementSize(type)): this {
    this.type = type;
    this.elementSize = elementSize;
    return this;
  }

  /** 设 itemSize。链式。 */
  setItemSize(itemSize: number): this {
    this.itemSize = itemSize;
    return this;
  }

  /** 设 count(无 array 可推,改 VBO 顶点数时调用)。链式。 */
  setCount(count: number): this {
    this.count = count;
    return this;
  }

  /** 从 source 复制 字段(浅拷贝 buffer 句柄别名,因为 VBO 是 GPU 单例)。 */
  copy(source: GLBufferAttribute): this {
    this.buffer = source.buffer;
    this.type = source.type;
    this.itemSize = source.itemSize;
    this.elementSize = source.elementSize;
    this.count = source.count;
    this.normalized = source.normalized;
    this.name = source.name;
    return this;
  }

  /** 克隆(浅拷贝 buffer 句柄别名 — 同一 GPU VBO,新元数据包装)。 */
  clone(): GLBufferAttribute {
    const c = new GLBufferAttribute(
      this.buffer,
      this.type,
      this.itemSize,
      this.elementSize,
      this.count,
      this.normalized,
    );
    c.name = this.name;
    return c;
  }

  /** 序列化为 JSON(buffer 句柄无法序列化,记 null + 元数据)。 */
  toJSON(): Record<string, unknown> {
    return {
      isGLBufferAttribute: true,
      name: this.name,
      type: this.type,
      itemSize: this.itemSize,
      elementSize: this.elementSize,
      count: this.count,
      normalized: this.normalized,
      // WebGLBuffer 句柄不进 JSON(GPU 资源非序列化对象)。
      buffer: null,
    };
  }
}
