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
// 限制(v1):
//   - 不支持 per-instance 颜色/其他属性(仅 model matrix)。
//   - 法线用 mat3(instanceMatrix) 近似,非均匀缩放光照不准。
//   - frustum culling 用 InstancedMesh 自身 boundingSphere(需手动 setBoundingSphere)
//     或保守地总是渲染(无整体 bounds 时不剔除)。

import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import type { Material } from './Material';
import { Matrix4 } from '../Math/Matrix4';
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

  /** 把第 i 个实例设为 identity(快速重置)。 */
  setIdentityAt(i: number): void {
    if (i < 0 || i >= this.count) return;
    this._setIdentityAt(i);
    this.instanceMatrixVersion++;
  }

  /** 调整实例数量。会重新分配 instanceMatrix,旧数据保留(截断/补 identity)。 */
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
  }

  private _setIdentityAt(i: number, buf: Float32Array = this.instanceMatrix): void {
    const off = i * 16;
    for (let k = 0; k < 16; k++) buf[off + k] = 0;
    buf[off + 0] = 1;
    buf[off + 5] = 1;
    buf[off + 10] = 1;
    buf[off + 15] = 1;
  }

  /** 射线检测:对每个实例,把射线变到该实例的局部空间(base geometry 空间)
   *  后做三角形求交。命中结果带 instanceId。
   *  调用前需保证 matrixWorld 已更新。 */
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
