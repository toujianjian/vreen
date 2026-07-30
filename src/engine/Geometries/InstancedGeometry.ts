// InstancedGeometry — 实例化几何体,参考 three.js InstancedBufferGeometry 设计。
//
// 在普通 BufferGeometry 之上叠加 per-instance 数据:
//   - instanceMatrix: 每实例 16 个 float 的 column-major mat4
//   - instanceColor:   每实例 RGBA 4 个 float (0..1),null 表示不使用
//   - customAttributes: Map<name, Float32Array>,任意 itemSize 的 per-instance 属性
//
// 与 Core/InstancedMesh 的差异:
//   - InstancedMesh 是 Mesh (Object3D + geometry + material),管理场景对象 + raycast
//   - InstancedGeometry 是纯几何数据,负责实例缓冲分配 / 读写 / 序列化
//   - 渲染器从 InstancedGeometry 读取 instanceMatrix/instanceColor/customAttributes
//     上传到 instanced vertex buffer 并配置 vertexAttribDivisor
//
// 与 three.js InstancedBufferGeometry 的差异:
//   - three.js 仅暴露 instanceCount 字段,矩阵/颜色由 InstancedMesh 管理
//   - VREEN 把 per-instance 数据全部聚合到几何体里,简化渲染器管线
//   - 暴露显式 allocate/setInstanceMatrix/getInstanceMatrix API,无需 Mesh 介入

import { BufferGeometry } from '../Core/BufferGeometry';

/** Per-instance RGBA 颜色分量数。 */
const COLOR_ITEM_SIZE = 4;
/** column-major mat4 的 float 数。 */
const MATRIX_ITEM_SIZE = 16;

/**
 * 实例化几何体。在 BufferGeometry 之上叠加 per-instance 矩阵 / 颜色 / 自定义属性。
 *
 * 用法:
 *   const geom = new InstancedGeometry();
 *   geom.allocate(100);
 *   geom.setInstanceMatrix(0, matrix.elements);
 *   geom.setInstanceColor(0, 1, 0, 0, 1);
 *   geom.setCustomAttribute('a_offset', 0, [0.5, 0.5]);
 */
export class InstancedGeometry extends BufferGeometry {
  /** 类型标志,用于运行时类型测试。 */
  readonly isInstancedGeometry: boolean = true;

  /** 实例数量。allocate(count) 后等于 count;dispose() 后置 0。 */
  instanceCount: number = 0;

  /**
   * Per-instance mat4 数组,column-major,instanceCount × 16 个 float。
   * allocate() 后初始化为 identity,渲染器据此调用 drawElementsInstanced。
   */
  instanceMatrix: Float32Array = new Float32Array(0);

  /**
   * Per-instance RGBA 颜色数组 (0..1),instanceCount × 4 个 float。
   * null 表示不使用 per-instance 颜色 (走材质自身 diffuse)。
   * 首次调用 setInstanceColor 时惰性分配。
   */
  instanceColor: Float32Array | null = null;

  /**
   * 自定义 per-instance 属性表。键为属性名 (如 'a_offset'),值为 Float32Array,
   * 长度 = instanceCount × itemSize。itemSize 通过 setCustomAttribute 首次写入推断。
   * 渲染器据此配置额外的 instanced vertex attrib。
   */
  customAttributes: Map<string, Float32Array> = new Map();

  /** 自定义属性的 itemSize 元数据 (与 customAttributes 同步维护,序列化用)。 */
  customAttributeSizes: Map<string, number> = new Map();

  /** instanceMatrix 变更版本号,渲染器据此判断是否重传 GPU。 */
  instanceMatrixVersion: number = 0;
  /** instanceColor 变更版本号。 */
  instanceColorVersion: number = 0;
  /** 自定义属性变更版本号 (按属性名分别标记)。 */
  customAttributeVersions: Map<string, number> = new Map();

  /**
   * 分配实例缓冲区。会重置 instanceMatrix (全 identity) 和 instanceColor (置 null)。
   * 已存在的 customAttributes 会被重分配 (保留 itemSize,清零数据)。
   *
   * @param count 实例数量,会被 clamp 到 >=0。
   */
  allocate(count: number): this {
    const n = Math.max(0, Math.floor(count));
    this.instanceCount = n;
    this.instanceMatrix = new Float32Array(n * MATRIX_ITEM_SIZE);
    for (let i = 0; i < n; i++) this._writeIdentityAt(i);
    this.instanceMatrixVersion++;

    // 已有的 instanceColor / customAttributes 重新分配 (保留 itemSize,清零数据)。
    if (this.instanceColor !== null) {
      this.instanceColor = new Float32Array(n * COLOR_ITEM_SIZE).fill(1); // 默认白色
      this.instanceColorVersion++;
    }
    for (const [name, sizes] of this.customAttributeSizes) {
      const itemSize = sizes;
      this.customAttributes.set(name, new Float32Array(n * itemSize));
      this.customAttributeVersions.set(name, (this.customAttributeVersions.get(name) ?? 0) + 1);
    }
    return this;
  }

  /** 设置实例数量 (等价于 allocate,但不会清零已写好的 customAttributes itemSize 元数据)。 */
  setInstanceCount(count: number): this {
    return this.allocate(count);
  }

  /** 获取实例数量。 */
  getInstanceCount(): number {
    return this.instanceCount;
  }

  /**
   * 写入第 index 个实例的 model matrix。
   * @param matrix 长度 16 的 column-major 数组或 Matrix4.elements。
   */
  setInstanceMatrix(index: number, matrix: ArrayLike<number>): this {
    this._assertIndex(index);
    if (matrix.length < MATRIX_ITEM_SIZE) {
      throw new RangeError(`InstancedGeometry.setInstanceMatrix: matrix.length < 16`);
    }
    const off = index * MATRIX_ITEM_SIZE;
    for (let k = 0; k < MATRIX_ITEM_SIZE; k++) {
      this.instanceMatrix[off + k] = matrix[k];
    }
    this.instanceMatrixVersion++;
    return this;
  }

  /**
   * 读取第 index 个实例的 model matrix 到 out (长度 >=16),返回 out。
   * 若不传 out 则分配新的 Float32Array(16)。
   */
  getInstanceMatrix(index: number, out?: Float32Array | number[]): Float32Array | number[] {
    this._assertIndex(index);
    const target = out ?? new Float32Array(MATRIX_ITEM_SIZE);
    const off = index * MATRIX_ITEM_SIZE;
    for (let k = 0; k < MATRIX_ITEM_SIZE; k++) target[k] = this.instanceMatrix[off + k];
    return target;
  }

  /**
   * 写入第 index 个实例的颜色 (RGBA 0..1)。
   * 首次调用时惰性分配 instanceColor 数组 (初始全白)。
   */
  setInstanceColor(index: number, r: number, g: number, b: number, a: number = 1): this {
    this._assertIndex(index);
    if (this.instanceColor === null) {
      this.instanceColor = new Float32Array(this.instanceCount * COLOR_ITEM_SIZE).fill(1);
    }
    const off = index * COLOR_ITEM_SIZE;
    this.instanceColor[off] = r;
    this.instanceColor[off + 1] = g;
    this.instanceColor[off + 2] = b;
    this.instanceColor[off + 3] = a;
    this.instanceColorVersion++;
    return this;
  }

  /**
   * 读取第 index 个实例的颜色,返回长度 4 的数组 [r, g, b, a]。
   * 若 instanceColor 未分配,返回白色 (1,1,1,1) (与 three.js 行为一致)。
   */
  getInstanceColor(index: number, out?: Float32Array | number[]): Float32Array | number[] {
    this._assertIndex(index);
    const target = out ?? new Float32Array(COLOR_ITEM_SIZE);
    if (this.instanceColor === null) {
      target[0] = 1; target[1] = 1; target[2] = 1; target[3] = 1;
      return target;
    }
    const off = index * COLOR_ITEM_SIZE;
    for (let k = 0; k < COLOR_ITEM_SIZE; k++) target[k] = this.instanceColor[off + k];
    return target;
  }

  /**
   * 写入第 index 个实例的某个自定义属性值。
   * 首次写入该 name 时会根据 values.length 推断 itemSize 并分配整个数组 (清零)。
   * 后续写入相同 name 时,values.length 必须与首次一致。
   *
   * @param name 属性名 (如 'a_offset')
   * @param index 实例索引
   * @param values per-instance 值数组,长度即 itemSize
   */
  setCustomAttribute(name: string, index: number, values: ArrayLike<number>): this {
    this._assertIndex(index);
    let buf = this.customAttributes.get(name);
    let itemSize = this.customAttributeSizes.get(name);
    if (buf === undefined || itemSize === undefined) {
      itemSize = values.length;
      if (itemSize <= 0) {
        throw new Error(`InstancedGeometry.setCustomAttribute: empty values for "${name}"`);
      }
      buf = new Float32Array(this.instanceCount * itemSize);
      this.customAttributes.set(name, buf);
      this.customAttributeSizes.set(name, itemSize);
    } else if (itemSize !== values.length) {
      throw new Error(
        `InstancedGeometry.setCustomAttribute: itemSize mismatch for "${name}" ` +
        `(expected ${itemSize}, got ${values.length})`,
      );
    }
    const off = index * itemSize;
    for (let k = 0; k < itemSize; k++) buf[off + k] = values[k];
    this.customAttributeVersions.set(name, (this.customAttributeVersions.get(name) ?? 0) + 1);
    return this;
  }

  /**
   * 获取自定义属性的整个 Float32Array (引用,非拷贝)。
   * 不存在时返回 undefined。
   */
  getCustomAttribute(name: string): Float32Array | undefined {
    return this.customAttributes.get(name);
  }

  /** 获取自定义属性的 itemSize。不存在时返回 undefined。 */
  getCustomAttributeSize(name: string): number | undefined {
    return this.customAttributeSizes.get(name);
  }

  /** 列出所有自定义属性名。 */
  getCustomAttributes(): string[] {
    return Array.from(this.customAttributes.keys());
  }

  /** 删除某个自定义属性。 */
  deleteCustomAttribute(name: string): this {
    if (this.customAttributes.delete(name)) {
      this.customAttributeSizes.delete(name);
      this.customAttributeVersions.delete(name);
    }
    return this;
  }

  /** 把第 index 个实例的矩阵重置为 identity (快速重置)。 */
  setIdentityInstance(index: number): this {
    this._assertIndex(index);
    this._writeIdentityAt(index);
    this.instanceMatrixVersion++;
    return this;
  }

  /** 显式触发 instanceMatrix 重传 (外部直接改 instanceMatrix 时调用)。 */
  updateInstanceMatrix(): this {
    this.instanceMatrixVersion++;
    return this;
  }

  /** 显式触发 instanceColor 重传。 */
  updateInstanceColor(): this {
    if (this.instanceColor !== null) this.instanceColorVersion++;
    return this;
  }

  /**
   * 从 source 拷贝到 this (深拷贝所有 per-instance 数据)。
   * 父类 BufferGeometry 的 attributes / index / groups / boundingBox 不拷贝
   * (几何体本身通常共享,per-instance 数据才是实例化几何体的状态)。
   */
  copy(source: InstancedGeometry): this {
    this.instanceCount = source.instanceCount;
    this.instanceMatrix = source.instanceMatrix.slice();
    this.instanceMatrixVersion = source.instanceMatrixVersion + 1;

    if (source.instanceColor !== null) {
      this.instanceColor = source.instanceColor.slice();
    } else {
      this.instanceColor = null;
    }
    this.instanceColorVersion = source.instanceColorVersion + 1;

    this.customAttributes = new Map();
    this.customAttributeSizes = new Map();
    this.customAttributeVersions = new Map();
    for (const [name, srcBuf] of source.customAttributes) {
      const itemSize = source.customAttributeSizes.get(name)!;
      this.customAttributes.set(name, srcBuf.slice());
      this.customAttributeSizes.set(name, itemSize);
      this.customAttributeVersions.set(name, source.customAttributeVersions.get(name) ?? 0);
    }

    // 同时拷贝父类 attributes / index / groups (与 BufferGeometry 行为一致)
    this.attributes = { ...source.attributes };
    this.index = source.index;
    this.groups = source.groups.slice();
    this.boundingBox = source.boundingBox;
    this.boundingSphere = source.boundingSphere;
    this.userData = { ...source.userData };
    return this;
  }

  /** 深拷贝。 */
  clone(): InstancedGeometry {
    const c = new InstancedGeometry();
    c.copy(this);
    return c;
  }

  /** 序列化为 JSON (供 .vreen 包导出与跨引擎 SDK 互操作)。 */
  override toJSON(): Record<string, unknown> {
    const out = super.toJSON();
    out.instanceCount = this.instanceCount;
    out.instanceMatrix = Array.from(this.instanceMatrix);
    if (this.instanceColor !== null) {
      out.instanceColor = Array.from(this.instanceColor);
    }
    if (this.customAttributes.size > 0) {
      const customs: Record<string, { itemSize: number; array: number[] }> = {};
      for (const name of this.customAttributes.keys()) {
        const itemSize = this.customAttributeSizes.get(name)!;
        const arr = this.customAttributes.get(name)!;
        customs[name] = { itemSize, array: Array.from(arr) };
      }
      out.customAttributes = customs;
    }
    out.isInstancedGeometry = true;
    return out;
  }

  /**
   * 释放资源。把所有 per-instance 缓冲清空,GC 可回收。
   * 与 BufferGeometry.dispose 一致,自研引擎不直接持有 GL 资源
   * (渲染器在 WeakMap 中缓存,实例 GC 时自动释放)。
   */
  override dispose(): void {
    super.dispose();
    this.instanceCount = 0;
    this.instanceMatrix = new Float32Array(0);
    this.instanceColor = null;
    this.customAttributes.clear();
    this.customAttributeSizes.clear();
    this.customAttributeVersions.clear();
    this.instanceMatrixVersion++;
    this.instanceColorVersion++;
  }

  // ── 内部辅助 ────────────────────────────────────────────────

  private _assertIndex(index: number): void {
    if (index < 0 || index >= this.instanceCount) {
      throw new RangeError(
        `InstancedGeometry: instance index ${index} out of range [0, ${this.instanceCount})`,
      );
    }
  }

  private _writeIdentityAt(i: number): void {
    const off = i * MATRIX_ITEM_SIZE;
    for (let k = 0; k < MATRIX_ITEM_SIZE; k++) this.instanceMatrix[off + k] = 0;
    this.instanceMatrix[off + 0] = 1;
    this.instanceMatrix[off + 5] = 1;
    this.instanceMatrix[off + 10] = 1;
    this.instanceMatrix[off + 15] = 1;
  }
}
