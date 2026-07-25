// InstancedBufferAttribute — 用于实例化渲染的顶点属性(Phase 2.2.2 增强)。
//
// 与普通 BufferAttribute 的差异在于 `meshPerAttribute`:它告诉 GPU
// "每 N 个实例推进一次该属性",对应 `gl.vertexAttribDivisor(loc, N)`。
// 默认 N=1(每个实例都有独立的属性值),>1 时属性在 N 个实例间共享。
//
// 典型用法:
//   const matrixAttr = new InstancedBufferAttribute(
//     new Float32Array(count * 16), 16, // itemSize=16(mat4)
//   );
//   // 或 per-instance color:
//   const colorAttr = new InstancedBufferAttribute(
//     new Float32Array(count * 3).fill(1), 3,
//   );
//
// 注意:本类仅描述数据(数组 + itemSize + meshPerAttribute)。
// 渲染器负责把数据上传到 GL_BUFFER 并调用 vertexAttribDivisor。
// 与 three.js InstancedBufferAttribute 对齐,降低跨引擎迁移成本。

import { BufferAttribute } from './BufferAttribute';

export class InstancedBufferAttribute extends BufferAttribute {
  isInstancedBufferAttribute: boolean = true;

  /**
   * 每多少个实例推进一次该属性。对应 `gl.vertexAttribDivisor(loc, meshPerAttribute)`。
   * - 1 (默认): 每个实例都有自己的属性值(per-instance)。
   * - >1: 同一属性值在 N 个连续实例间共享(罕见,例如每 4 个实例共用一个材质 ID)。
   *
   * 设为 <1 会被 clamp 到 1(避免 div=0 导致 GL 错误)。
   */
  meshPerAttribute: number;

  constructor(
    array: ArrayLike<number> | Float32Array,
    itemSize: number,
    meshPerAttribute: number = 1,
    usage: number = 0x88e4, // gl.STATIC_DRAW
  ) {
    super(array, itemSize, usage);
    this.meshPerAttribute = Math.max(1, Math.floor(meshPerAttribute));
  }

  /**
   * 替换底层数组并重算 count。
   * 覆写父类方法仅为保留多态签名;逻辑委托给 super。
   */
  override setArray(arr: ArrayLike<number>): this {
    super.setArray(arr);
    return this;
  }

  /** 返回底层 Float32Array 引用(非拷贝)。供渲染器零拷贝上传 GPU。 */
  getArray(): Float32Array {
    return this.array;
  }

  /** 设置 meshPerAttribute,自动 clamp 到 >=1。 */
  setMeshPerAttribute(value: number): this {
    this.meshPerAttribute = Math.max(1, Math.floor(value));
    return this;
  }

  /** 从 source 拷贝数据(深拷贝数组)。返回 this。 */
  copy(source: InstancedBufferAttribute): this {
    // 复用 setArray 完成数组深拷贝 + count 重算 + version bump。
    super.setArray(source.array.slice());
    this.meshPerAttribute = source.meshPerAttribute;
    this.usage = source.usage;
    return this;
  }

  /** 深拷贝:新实例 + 拷贝数组 + 同 meshPerAttribute。 */
  clone(): InstancedBufferAttribute {
    return new InstancedBufferAttribute(
      this.array.slice(),
      this.itemSize,
      this.meshPerAttribute,
      this.usage,
    );
  }
}
