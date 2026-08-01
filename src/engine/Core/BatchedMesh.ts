// BatchedMesh — 动态多几何体合并渲染(减少 draw call)。
//
// 适配:
//   - three.js `BatchedMesh.js` (r163+)
//   - o3de Atom `BatchedMesh` (RPI::BatchedMesh)
//
// 设计要点:
//   * 与 InstancedMesh 互补:
//       - InstancedMesh:同一几何体渲染 N 次(每实例不同变换);
//       - BatchedMesh:多个不同几何体合并到一个缓冲区(每批次不同几何体 + 变换)。
//   * 预分配大缓冲区,addGeometry() 将几何体数据复制到缓冲区指定偏移;
//   * deleteGeometry() 标记空间为空闲(不立即压缩),optimize() 压缩碎片;
//   * 每批次独立:变换矩阵 / 可见性 / 包围盒;
//   * 通过 BufferGeometry.groups 提供每批次的 draw range,渲染器按 group 提交;
//   * 每批次矩阵存储为 Float32Array(16 个 float per matrix),可上传为
//     instanced attribute 或纹理供 shader 应用。
//
// 不变量:
//   - addGeometry 返回的 batchId 在 deleteGeometry 前始终有效;
//   - deleteGeometry 后 batchId 被标记为空闲,可被 optimize 回收;
//   - 顶点/索引偏移在 addGeometry 时确定,deleteGeometry 不移动已有数据;
//   - getDrawRanges() 仅返回可见批次的 draw range;
//   - getMatrixTextureData() 返回连续的 Float32Array,每 16 个 float 为一个矩阵。
//
// 参考:
//   - three.js examples/jsm/objects/BatchedMesh.js
//   - o3de Atom RPI::BatchedMesh

import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { Matrix4 } from '../Math/Matrix4';
import { Box3 } from '../Math/Box3';
import { Material } from './Material';

/** 单个批次的内部状态。 */
interface Batch {
  /** 顶点偏移(在合并缓冲区中的起始顶点索引)。 */
  vertexOffset: number;
  /** 顶点数。 */
  vertexCount: number;
  /** 索引偏移(在合并索引缓冲区中的起始索引位置)。 */
  indexOffset: number;
  /** 索引数(0 = 无索引,使用 drawArrays)。 */
  indexCount: number;
  /** 是否已删除(空间可回收)。 */
  deleted: boolean;
  /** 是否可见。 */
  visible: boolean;
  /** 变换矩阵(列主序,16 个 float)。 */
  matrix: Float32Array;
  /** 包围盒(批次局部空间)。 */
  boundingBox: Box3;
  /** 预留顶点数(可能 > vertexCount,用于未来扩展)。 */
  reservedVertexCount: number;
  /** 预留索引数。 */
  reservedIndexCount: number;
}

/** Draw range(供渲染器提交)。 */
export interface BatchedDrawRange {
  /** 批次 ID。 */
  batchId: number;
  /** 索引起始位置。 */
  start: number;
  /** 索引数(0 = 使用 drawArrays)。 */
  count: number;
  /** 变换矩阵(列主序,16 个 float)。 */
  matrix: Float32Array;
}

/**
 * 动态多几何体合并渲染。
 *
 * 将多个不同几何体合并到一个预分配的顶点/索引缓冲区中,
 * 通过 groups + draw ranges 实现单次或少量 draw call 渲染所有批次。
 * 每批次独立变换矩阵 / 可见性 / 包围盒。
 *
 * 用法:
 * ```ts
 * const batched = new BatchedMesh(10000, 30000, material);
 * const id1 = batched.addGeometry(boxGeo);
 * const id2 = batched.addGeometry(sphereGeo);
 * batched.setMatrixAt(id1, new Matrix4().makeTranslation(0, 0, 0));
 * batched.setMatrixAt(id2, new Matrix4().makeTranslation(5, 0, 0));
 * // 渲染器按 batched.geometry.groups 提交 draw call
 * ```
 */
export class BatchedMesh extends Mesh {
  readonly maxVertexCount: number;
  readonly maxIndexCount: number;

  /** 批次状态数组(按 batchId 索引)。 */
  private batches: Batch[] = [];
  /** 已删除批次的 ID 栈(供 addGeometry 复用)。 */
  private freeIds: number[] = [];
  /** 下一个可用的顶点偏移。 */
  private nextVertexOffset = 0;
  /** 下一个可用的索引偏移。 */
  private nextIndexOffset = 0;
  /** 当前活跃(未删除)批次数。 */
  private _activeCount = 0;

  /** 内部预分配缓冲区。 */
  private positionArray: Float32Array;
  private normalArray: Float32Array;
  private uvArray: Float32Array;
  private indexArray: Float32Array;

  constructor(
    maxVertexCount: number,
    maxIndexCount: number,
    material: Material,
  ) {
    // 创建内部几何体,预分配缓冲区
    const geometry = new BufferGeometry();
    super(geometry, material);

    this.maxVertexCount = Math.max(1, Math.floor(maxVertexCount));
    this.maxIndexCount = Math.max(0, Math.floor(maxIndexCount));

    // 预分配顶点缓冲区
    this.positionArray = new Float32Array(this.maxVertexCount * 3);
    this.normalArray = new Float32Array(this.maxVertexCount * 3);
    this.uvArray = new Float32Array(this.maxVertexCount * 2);

    geometry.setAttribute('position', new BufferAttribute(this.positionArray, 3));
    geometry.setAttribute('normal', new BufferAttribute(this.normalArray, 3));
    geometry.setAttribute('uv', new BufferAttribute(this.uvArray, 2));

    // 预分配索引缓冲区(使用 Float32Array 以与 BufferAttribute 共享引用)
    if (this.maxIndexCount > 0) {
      this.indexArray = new Float32Array(this.maxIndexCount);
      geometry.setIndex(new BufferAttribute(this.indexArray, 1));
    } else {
      this.indexArray = new Float32Array(0);
    }
  }

  /** 当前活跃(未删除)批次数。 */
  get activeInstances(): number {
    return this._activeCount;
  }

  /** 总批次数(含已删除的空位)。 */
  get batchCount(): number {
    return this.batches.length;
  }

  /**
   * 添加几何体到批处理。
   *
   * @param geometry          要添加的几何体(必须有 position 属性)
   * @param reservedVertexCount 预留顶点数(默认 = geometry 顶点数)
   * @param reservedIndexCount  预留索引数(默认 = geometry 索引数)
   * @returns 批次 ID
   * @throws 如果缓冲区空间不足
   */
  addGeometry(
    geometry: BufferGeometry,
    reservedVertexCount?: number,
    reservedIndexCount?: number,
  ): number {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) throw new Error('BatchedMesh.addGeometry: geometry must have position attribute');

    const vertexCount = posAttr.count;
    const indexCount = geometry.index ? geometry.index.count : 0;

    const rvc = Math.max(vertexCount, reservedVertexCount ?? vertexCount);
    const ric = Math.max(indexCount, reservedIndexCount ?? indexCount);

    // 检查空间
    if (this.nextVertexOffset + rvc > this.maxVertexCount) {
      throw new Error(
        `BatchedMesh.addGeometry: vertex buffer overflow (need ${this.nextVertexOffset + rvc}, max ${this.maxVertexCount})`,
      );
    }
    if (ric > 0 && this.nextIndexOffset + ric > this.maxIndexCount) {
      throw new Error(
        `BatchedMesh.addGeometry: index buffer overflow (need ${this.nextIndexOffset + ric}, max ${this.maxIndexCount})`,
      );
    }

    // 复制顶点数据
    const vertexOffset = this.nextVertexOffset;
    this._copyAttribute(geometry, 'position', vertexOffset, vertexCount, 3);
    this._copyAttribute(geometry, 'normal', vertexOffset, vertexCount, 3);
    this._copyAttribute(geometry, 'uv', vertexOffset, vertexCount, 2);

    // 复制索引数据(偏移顶点索引)
    const indexOffset = this.nextIndexOffset;
    if (indexCount > 0 && geometry.index) {
      const srcIdx = geometry.index.array;
      for (let i = 0; i < indexCount; i++) {
        this.indexArray[indexOffset + i] = (srcIdx[i] as number) + vertexOffset;
      }
    }

    // 创建批次
    const batch: Batch = {
      vertexOffset,
      vertexCount,
      indexOffset,
      indexCount,
      deleted: false,
      visible: true,
      matrix: new Matrix4().elements.slice(),
      boundingBox: geometry.boundingBox
        ? new Box3(geometry.boundingBox.min.clone(), geometry.boundingBox.max.clone())
        : new Box3(),
      reservedVertexCount: rvc,
      reservedIndexCount: ric,
    };

    // 复用已删除的 ID 或创建新 ID
    let batchId: number;
    if (this.freeIds.length > 0) {
      batchId = this.freeIds.pop()!;
      this.batches[batchId] = batch;
    } else {
      batchId = this.batches.length;
      this.batches.push(batch);
    }

    // 推进偏移
    this.nextVertexOffset += rvc;
    this.nextIndexOffset += ric;
    this._activeCount++;


    // 更新 groups
    this._updateGroups();

    return batchId;
  }

  /**
   * 删除指定批次。
   *
   * 标记为已删除,空间不立即回收。调用 optimize() 压缩碎片。
   *
   * @param batchId 要删除的批次 ID
   */
  deleteGeometry(batchId: number): void {
    const batch = this.batches[batchId];
    if (!batch || batch.deleted) return;

    batch.deleted = true;
    batch.visible = false;
    this._activeCount--;
    this.freeIds.push(batchId);

    this._updateGroups();
  }

  /**
   * 设置批次变换矩阵。
   *
   * @param batchId 批次 ID
   * @param matrix  变换矩阵(列主序)
   */
  setMatrixAt(batchId: number, matrix: Matrix4): void {
    const batch = this.batches[batchId];
    if (!batch || batch.deleted) return;
    batch.matrix.set(matrix.elements);
  }

  /**
   * 获取批次变换矩阵。
   *
   * @param batchId 批次 ID
   * @param matrix  可选复用 Matrix4
   * @returns 变换矩阵
   */
  getMatrixAt(batchId: number, matrix?: Matrix4): Matrix4 {
    const batch = this.batches[batchId];
    const out = matrix ?? new Matrix4();
    if (batch) {
      out.elements.set(batch.matrix);
    }
    return out;
  }

  /**
   * 设置批次可见性。
   *
   * @param batchId 批次 ID
   * @param visible 是否可见
   */
  setVisibleAt(batchId: number, visible: boolean): void {
    const batch = this.batches[batchId];
    if (!batch || batch.deleted) return;
    if (batch.visible !== visible) {
      batch.visible = visible;
  
      this._updateGroups();
    }
  }

  /**
   * 获取批次可见性。
   *
   * @param batchId 批次 ID
   * @returns 是否可见
   */
  getVisibleAt(batchId: number): boolean {
    const batch = this.batches[batchId];
    return batch ? batch.visible : false;
  }

  /**
   * 设置批次包围盒。
   *
   * @param batchId 批次 ID
   * @param box     包围盒
   */
  setBoundingBoxAt(batchId: number, box: Box3): void {
    const batch = this.batches[batchId];
    if (!batch || batch.deleted) return;
    batch.boundingBox = box.clone();
  }

  /**
   * 获取批次包围盒。
   *
   * @param batchId 批次 ID
   * @param box     可选复用 Box3
   * @returns 包围盒
   */
  getBoundingBoxAt(batchId: number, box?: Box3): Box3 {
    const batch = this.batches[batchId];
    const out = box ?? new Box3();
    if (batch) {
      out.copy(batch.boundingBox);
    }
    return out;
  }

  /**
   * 压缩碎片:将所有活跃批次的数据紧凑排列,回收已删除批次的空间。
   *
   * 调用后所有 batchId 失效,需要重新获取。内部会重建缓冲区。
   */
  optimize(): void {
    if (this.freeIds.length === 0) return;

    const activeBatches = this.batches.filter((b) => !b.deleted);
    if (activeBatches.length === this.batches.length) return;

    // 重建缓冲区
    const newPos = new Float32Array(this.maxVertexCount * 3);
    const newNorm = new Float32Array(this.maxVertexCount * 3);
    const newUV = new Float32Array(this.maxVertexCount * 2);
    const newIdx = new Float32Array(this.maxIndexCount);

    let vOff = 0;
    let iOff = 0;
    const newBatches: Batch[] = [];

    for (const batch of activeBatches) {
      const oldVOff = batch.vertexOffset;
      const oldIOff = batch.indexOffset;
      const vc = batch.vertexCount;
      const ic = batch.indexCount;

      // 复制顶点
      for (let i = 0; i < vc * 3; i++) {
        newPos[vOff * 3 + i] = this.positionArray[oldVOff * 3 + i];
        newNorm[vOff * 3 + i] = this.normalArray[oldVOff * 3 + i];
      }
      for (let i = 0; i < vc * 2; i++) {
        newUV[vOff * 2 + i] = this.uvArray[oldVOff * 2 + i];
      }

      // 复制索引(重新偏移)
      if (ic > 0) {
        for (let i = 0; i < ic; i++) {
          newIdx[iOff + i] = this.indexArray[oldIOff + i] - oldVOff + vOff;
        }
      }

      newBatches.push({
        ...batch,
        vertexOffset: vOff,
        indexOffset: iOff,
        reservedVertexCount: vc,
        reservedIndexCount: ic,
      });

      vOff += vc;
      iOff += ic;
    }

    // 替换缓冲区
    this.positionArray.set(newPos);
    this.normalArray.set(newNorm);
    this.uvArray.set(newUV);
    this.indexArray.set(newIdx);

    this.batches = newBatches;
    this.freeIds = [];
    this.nextVertexOffset = vOff;
    this.nextIndexOffset = iOff;

    this._updateGroups();
  }

  /**
   * 获取可见批次的 draw range 列表(供渲染器提交)。
   *
   * @returns Draw range 数组
   */
  getDrawRanges(): BatchedDrawRange[] {
    const ranges: BatchedDrawRange[] = [];
    for (let i = 0; i < this.batches.length; i++) {
      const batch = this.batches[i];
      if (!batch || batch.deleted || !batch.visible) continue;
      ranges.push({
        batchId: i,
        start: batch.indexCount > 0 ? batch.indexOffset : batch.vertexOffset,
        count: batch.indexCount > 0 ? batch.indexCount : batch.vertexCount,
        matrix: batch.matrix,
      });
    }
    return ranges;
  }

  /**
   * 获取所有批次的矩阵数据(连续 Float32Array)。
   *
   * 每 16 个 float 为一个矩阵(列主序)。可用于上传为 instanced attribute 或纹理。
   * 已删除的批次矩阵为全零。
   *
   * @returns Float32Array,长度 = batchCount × 16
   */
  getMatrixTextureData(): Float32Array {
    const data = new Float32Array(this.batches.length * 16);
    for (let i = 0; i < this.batches.length; i++) {
      const batch = this.batches[i];
      if (batch && !batch.deleted) {
        data.set(batch.matrix, i * 16);
      }
    }
    return data;
  }

  /** 内部:复制几何体属性到合并缓冲区。 */
  private _copyAttribute(
    geometry: BufferGeometry,
    name: string,
    vertexOffset: number,
    vertexCount: number,
    itemSize: number,
  ): void {
    const attr = geometry.getAttribute(name);
    const dst = name === 'position' ? this.positionArray
              : name === 'normal' ? this.normalArray
              : name === 'uv' ? this.uvArray
              : null;
    if (!dst) return;

    if (attr) {
      const src = attr.array;
      for (let i = 0; i < vertexCount * itemSize; i++) {
        dst[vertexOffset * itemSize + i] = src[i];
      }
    }
    // 如果源几何体没有该属性,目标区域保持全零
  }

  /** 内部:更新 geometry.groups,每个可见批次一个 group。 */
  private _updateGroups(): void {
    this.geometry.clearGroups();
    for (let i = 0; i < this.batches.length; i++) {
      const batch = this.batches[i];
      if (!batch || batch.deleted || !batch.visible) continue;
      if (batch.indexCount > 0) {
        this.geometry.addGroup(batch.indexOffset, batch.indexCount, i);
      } else {
        this.geometry.addGroup(batch.vertexOffset, batch.vertexCount, i);
      }
    }
    // 标记属性版本
    const pos = this.geometry.getAttribute('position');
    if (pos) pos.version++;
    const idx = this.geometry.index;
    if (idx) idx.version++;
  }
}
