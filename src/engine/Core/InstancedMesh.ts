// InstancedMesh — 批量渲染同一 geometry 的多个实例(Phase 2.2.2)。
//
// 每个实例有自己的 4x4 model matrix(translation/rotation/scale),存在
// `instanceMatrix` Float32Array(count × 16, column-major)里。渲染器
// 用 drawElementsInstanced / drawArraysInstanced 一次 draw call 画完所有实例。
//
// 约定:
//   - instanceMatrix 按 instance index 连续存储,每 16 个 float 一个 mat4。
//   - setMatrixAt(i, m) 写入第 i 个实例的 matrix(m 是 Matrix4 或 16-length)。
//   - instanceMatrixVersion 在数据变更后 +1,渲染器据此决定是否重传 GPU。
//   - InstancedMesh 自身的 matrixWorld 仍存在,但渲染时被忽略(实例矩阵优先);
//     u_model 设为 identity,所有变换来自 a_instanceMatrix。
//
// Per-instance color:
//   - instanceColor 是 Float32Array(count × 3, RGB 0..1) 或 null。
//   - setColorAt(i, color) 写入第 i 个实例颜色(首次调用时分配数组)。
//   - instanceColorVersion 同 instanceMatrixVersion 机制。
//   - 渲染器 USE_INSTANCING_COLOR 变体读取 a_instanceColor,与材质
//     diffuse 相乘(StandardMaterial.map * a_instanceColor)。
//
// 限制(v2):
//   - 法线用 mat3(instanceMatrix) 近似,非均匀缩放光照不准。
//   - frustum culling 用 InstancedMesh 自身 boundingSphere(需手动 setBoundingSphere)
//     或保守地总是渲染(无整体 bounds 时不剔除)。
//   - perInstanceFrustumCulled=true 时启用逐实例剔除(渲染器后续实现);
//     默认 false 以保留单 draw call 优势。

import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import type { Material } from './Material';
import { Matrix4 } from '../Math/Matrix4';
import { Color } from '../Math/Color';
import { Ray } from '../Math/Ray';
import { intersectGeometry, type Raycaster, type Intersection } from './Raycaster';

// InstancedMesh.raycast 复用的临时矩阵/射线(模块级,避免每次拾取分配)
const _invMeshMatrix = new Matrix4();
const _meshLocalRay = new Ray();
const _instMat = new Matrix4();
const _invInst = new Matrix4();
const _instLocalRay = new Ray();
const _worldMatrix = new Matrix4();

export class InstancedMesh extends Mesh {
  override readonly type: string = 'InstancedMesh';
  isInstancedMesh: boolean = true;

  /** 实例数量。 */
  count: number;
  /** 列主序 mat4 数组,count × 16。 */
  instanceMatrix: Float32Array;
  /** 数据版本号,变更后 +1 触发渲染器重传。 */
  instanceMatrixVersion: number = 0;

  /**
   * Per-instance 颜色(RGB 0..1,count × 3)。null 表示不使用 per-instance 颜色
   * (走材质自身 diffuse)。首次调用 setColorAt 时惰性分配。
   * 渲染器据此选择是否启用 USE_INSTANCING_COLOR shader 变体。
   */
  instanceColor: Float32Array | null = null;
  /** instanceColor 数据版本号,变更后 +1 触发渲染器重传。 */
  instanceColorVersion: number = 0;

  /**
   * 是否启用逐实例视锥剔除。
   * - false (默认): 整体作为单个 draw call 渲染(无论实例是否在视锥内)。
   *   适合密集分布、空间相邻的实例(如草地、粒子团)。
   * - true: 渲染器对每个实例做视锥测试,剔除不可见实例。
   *   会破坏单 draw call(渲染器需重新打包可见实例到 staging buffer),
   *   适合稀疏分布在大场景中的实例(如树木分布在 1km × 1km 地形上)。
   *
   * 注意:v2 仅保留标志位,渲染器的逐实例剔除实现为后续工作;
   * 当前的渲染器总是整体渲染。
   */
  perInstanceFrustumCulled: boolean = false;

  constructor(
    geometry: BufferGeometry,
    material: Material | Material[],
    count: number,
  ) {
    super(geometry, material);
    this.count = Math.max(0, Math.floor(count));
    this.instanceMatrix = new Float32Array(this.count * 16);
    // 默认所有实例为 identity。
    for (let i = 0; i < this.count; i++) {
      this._setIdentityAt(i);
    }
  }

  /** 写入第 i 个实例的 model matrix。
   *  @param matrix Matrix4 实例或长度 16 的数组(column-major)。 */
  setMatrixAt(i: number, matrix: Matrix4 | number[] | Float32Array): void {
    if (i < 0 || i >= this.count) {
      throw new RangeError(`InstancedMesh.setMatrixAt: index ${i} out of range [0, ${this.count})`);
    }
    const src = matrix instanceof Matrix4 ? matrix.elements : matrix;
    const off = i * 16;
    for (let k = 0; k < 16; k++) this.instanceMatrix[off + k] = src[k];
    this.instanceMatrixVersion++;
  }

  /** 读取第 i 个实例的 model matrix 到 out(长度 ≥16)。返回 out。 */
  getMatrixAt(i: number, out: Float32Array | number[]): Float32Array | number[] {
    if (i < 0 || i >= this.count) {
      throw new RangeError(`InstancedMesh.getMatrixAt: index ${i} out of range [0, ${this.count})`);
    }
    const off = i * 16;
    for (let k = 0; k < 16; k++) out[k] = this.instanceMatrix[off + k];
    return out;
  }

  /**
   * 写入第 i 个实例的颜色(RGB 0..1)。
   * 首次调用时惰性分配 instanceColor 数组(初始全白,即不改变材质色)。
   * 修改后需调用 instanceColor 的 needsUpdate(此处通过 version+1 自动标记)。
   */
  setColorAt(i: number, color: Color): void {
    if (i < 0 || i >= this.count) {
      throw new RangeError(`InstancedMesh.setColorAt: index ${i} out of range [0, ${this.count})`);
    }
    if (this.instanceColor === null) {
      // 首次分配:初始化为全白(1,1,1),这样未显式设置的实例不影响材质色。
      this.instanceColor = new Float32Array(this.count * 3).fill(1);
    }
    const off = i * 3;
    this.instanceColor[off] = color.r;
    this.instanceColor[off + 1] = color.g;
    this.instanceColor[off + 2] = color.b;
    this.instanceColorVersion++;
  }

  /**
   * 读取第 i 个实例的颜色到 out(返回 out)。
   * 若 instanceColor 未分配,写入白色 (1,1,1)(与 three.js 行为一致)。
   */
  getColorAt(i: number, out: Color): Color {
    if (i < 0 || i >= this.count) {
      throw new RangeError(`InstancedMesh.getColorAt: index ${i} out of range [0, ${this.count})`);
    }
    if (this.instanceColor === null) {
      out.setRGB(1, 1, 1);
      return out;
    }
    const off = i * 3;
    out.setRGB(this.instanceColor[off], this.instanceColor[off + 1], this.instanceColor[off + 2]);
    return out;
  }

  /** 把第 i 个实例设为 identity(快速重置)。 */
  setIdentityAt(i: number): void {
    if (i < 0 || i >= this.count) return;
    this._setIdentityAt(i);
    this.instanceMatrixVersion++;
  }

  /**
   * 显式触发 instanceMatrix 重传 GPU 的信号(等价于 setMatrixAt 后的 version bump)。
   * 当外部直接修改 instanceMatrix 数组(而非走 setMatrixAt)时调用此方法。
   * 也对齐 three.js 中"修改后设置 needsUpdate=true"的语义。
   */
  updateInstanceMatrix(): void {
    this.instanceMatrixVersion++;
  }

  /**
   * 显式触发 instanceColor 重传 GPU 的信号。
   * 当外部直接修改 instanceColor 数组(而非走 setColorAt)时调用此方法。
   */
  updateInstanceColor(): void {
    if (this.instanceColor !== null) this.instanceColorVersion++;
  }

  /** 调整实例数量。会重新分配 instanceMatrix,旧数据保留(截断/补 identity)。
   *  若 instanceColor 已分配,会同步重分配并保留旧颜色(新实例补白)。 */
  setCount(count: number): void {
    const newCount = Math.max(0, Math.floor(count));
    if (newCount === this.count) return;
    const old = this.instanceMatrix;
    const next = new Float32Array(newCount * 16);
    const copyRows = Math.min(this.count, newCount);
    for (let i = 0; i < copyRows; i++) {
      const src = i * 16, dst = i * 16;
      for (let k = 0; k < 16; k++) next[dst + k] = old[src + k];
    }
    for (let i = copyRows; i < newCount; i++) {
      this._setIdentityAt(i, next);
    }
    this.count = newCount;
    this.instanceMatrix = next;
    this.instanceMatrixVersion++;

    // 同步 instanceColor(若已分配)。
    if (this.instanceColor !== null) {
      const oldColors = this.instanceColor;
      const nextColors = new Float32Array(newCount * 3).fill(1);
      const copyColorRows = Math.min(oldColors.length / 3, newCount);
      for (let i = 0; i < copyColorRows; i++) {
        const s = i * 3, d = i * 3;
        nextColors[d] = oldColors[s];
        nextColors[d + 1] = oldColors[s + 1];
        nextColors[d + 2] = oldColors[s + 2];
      }
      this.instanceColor = nextColors;
      this.instanceColorVersion++;
    }
  }

  private _setIdentityAt(i: number, buf: Float32Array = this.instanceMatrix): void {
    const off = i * 16;
    for (let k = 0; k < 16; k++) buf[off + k] = 0;
    buf[off + 0] = 1;
    buf[off + 5] = 1;
    buf[off + 10] = 1;
    buf[off + 15] = 1;
  }

  /**
   * 释放本实例持有的资源。
   *
   * 注意:VREEN 的 InstancedMesh 不直接持有 WebGL 资源(VAO/buffer 由
   * WebGL2Renderer._instancedCache WeakMap 持有),所以本方法仅清理 JS 侧数据:
   *   - 释放 instanceColor 数组(置 null,允许 GC)
   *   - 不释放 instanceMatrix(保留作为 fallback,若实例被复用)
   *   - 重置 count=0(防止后续误用)
   *
   * 渲染器侧的 GPU 资源(VAO/buffer)由 WeakMap 在 InstancedMesh GC 时
   * 自动释放;若需立即释放,调用 renderer.dispose()。
   *
   * 调用 dispose 后不应再使用此实例的 instanceMatrix / instanceColor;
   * 渲染器在下一帧检测到 count=0 会跳过绘制。
   */
  dispose(): void {
    this.instanceColor = null;
    this.instanceColorVersion++;
    this.count = 0;
    // 不直接置空 instanceMatrix(可能被其他地方引用),但清零长度语义上无效。
    // 渲染器读 count=0 时直接跳过 draw。
  }

  /** 射线检测:对每个实例,把射线变到该实例的局部空间(base geometry 空间)
   *  后做三角形求交。命中结果带 instanceId。
   *  调用前需保证 matrixWorld 已更新。 */
  /** 复制源 InstancedMesh 到 this(three.js InstancedMesh.copy 语义)。
   *  在 Mesh.copy 之上额外复制 count / instanceMatrix / instanceColor
   *  (独立新数组,避免共享)与版本号。 */
  override copy(source: InstancedMesh, recursive: boolean = true): this {
    super.copy(source, recursive);
    this.count = source.count;
    this.instanceMatrix = new Float32Array(source.instanceMatrix);
    this.instanceMatrixVersion = source.instanceMatrixVersion;
    this.instanceColor = source.instanceColor !== null ? new Float32Array(source.instanceColor) : null;
    this.instanceColorVersion = source.instanceColorVersion;
    this.perInstanceFrustumCulled = source.perInstanceFrustumCulled;
    return this;
  }

  /** 返回新 InstancedMesh 副本。构造参数含 count,需覆盖 Mesh.clone
   *  (three.js InstancedMesh.clone 同模式)。 */
  override clone(recursive: boolean = true): InstancedMesh {
    // `this.constructor` 静态类型是 Function,TS strict 下不可直接 new;
    // 用构造签名 cast 保持子类克隆语义(同 Object3D.clone)。
    const ctor = this.constructor as new (
      geometry: BufferGeometry,
      material: Material | Material[],
      count: number,
    ) => InstancedMesh;
    return new ctor(this.geometry, this.material, this.count).copy(this, recursive);
  }

  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const geometry = this.geometry;
    if (!geometry.attributes.position) return;
    if (this.count === 0) return;

    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const bs = geometry.boundingSphere;

    // 世界射线 → mesh 局部空间(instanceMatrix 之后的坐标系)
    _invMeshMatrix.getInverse(this.matrixWorld);
    _meshLocalRay.copy(raycaster.ray).applyMatrix4(_invMeshMatrix);

    for (let i = 0; i < this.count; i++) {
      const off = i * 16;
      _instMat.elements.set(this.instanceMatrix.subarray(off, off + 16));
      _invInst.getInverse(_instMat);
      // mesh 局部 → 实例局部(base geometry 空间)
      _instLocalRay.copy(_meshLocalRay).applyMatrix4(_invInst);

      // base geometry 包围球在实例局部空间,直接剔除(内联判定避免适配 Sphere 类)
      if (bs !== null && _instLocalRay.distanceSqToPoint(bs.center) > bs.radius * bs.radius) continue;

      // 该实例的世界矩阵 = matrixWorld * instanceMatrix
      _worldMatrix.multiplyMatrices(this.matrixWorld, _instMat);
      const hits = intersectGeometry(this, geometry, _instLocalRay, raycaster, _worldMatrix, i);
      for (let h = 0; h < hits.length; h++) intersects.push(hits[h]);
    }
  }
}
