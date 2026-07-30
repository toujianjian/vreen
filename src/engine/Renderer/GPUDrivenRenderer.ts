// GPUDrivenRenderer — GPU 驱动渲染(间接绘制 + Compute Shader 驱动)。
//
// 设计目标:
//   - 经典前向渲染在 CPU 端遍历场景 → 每个可见 mesh 调用一次 gl.drawElements,
//     大量小 mesh 时 CPU 是瓶颈(draw call bound)。
//   - GPU 驱动渲染把"哪些 mesh 可见 / 用什么材质 / LOD"等信息打包成
//     DrawCommand 数组,经视锥剔除 / 遮挡剔除 / 排序后写入 indirect buffer,
//     一次性 gl.multiDrawElementsIndirect 提交,把 CPU→GPU 切换开销降到最低。
//   - 与 WebGL2Renderer / DeferredRenderer 互补:
//       WebGL2Renderer 走前向路径,逐 mesh 提交;
//       DeferredRenderer 走 GBuffer + lighting pass;
//       GPUDrivenRenderer 走 indirect draw,适合海量实例(草地 / 粒子 / 树木)。
//
// 实现说明(v1,纯 CPU 侧调度):
//   - 本类不直接绑定 GL 状态;调用方通过 getIndirectBuffer() 拿到打包好的
//     Float32Array(或 Uint32Array 视图),自行调 multiDrawElementsIndirect。
//   - 这样保持引擎零运行时依赖、无头测试友好,且不与 WebGL2Renderer 的
//     内部 GL 状态机耦合。
//   - 视锥剔除复用 Math/Frustum;遮挡剔除为占位实现(基于粗略深度测试,
//     不依赖 GL query);LOD 选择基于距离。
//
// indirect buffer 布局(每 draw command 5 个 uint,共 20 字节):
//   [indexCount, instanceCount, firstIndex, vertexOffset, firstInstance]
// WebGL2 的 drawElementsIndirect 结构如下,本类按此布局写入 Float32Array
// (调用方可用 Uint32Array 视图读取):
//   struct DrawElementsIndirectCommand {
//     uint indexCount;
//     uint instanceCount;
//     uint firstIndex;
//     int  vertexOffset;
//     uint firstInstance;
//   };

import { Frustum } from '../Math/Frustum';
import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import type { Camera } from '../Cameras/Camera';
import { createLogger } from '@/lib/logger';

const log = createLogger('GPUDrivenRenderer');

/** 单个 GPU 间接绘制命令。 */
export interface DrawCommand {
  /** Draw ID(在 indirect buffer 中的索引,由 addDrawCommand 自动分配或调用方指定)。 */
  drawId: number;
  /** 索引数(此 mesh 的 index buffer 长度)。 */
  indexCount: number;
  /** 实例数(instanced rendering;1 表示非实例化)。 */
  instanceCount: number;
  /** 索引缓冲起始偏移(以 1 为单位,非字节)。 */
  firstIndex: number;
  /** 顶点缓冲起始偏移。 */
  vertexOffset: number;
  /** 第一个实例的偏移(instanced rendering)。 */
  firstInstance: number;
  /** 材质索引(供排序与 shader uniform 数组索引用)。 */
  materialIndex: number;
  /** LOD 级别(0 = 最高精度)。 */
  lodLevel: number;
  /** mesh 世界空间位置(用于视锥剔除 / 距离排序 / LOD 选择)。 */
  position: Vector3;
  /** 包围球半径(用于视锥剔除)。 */
  boundingRadius: number;
  /** 是否在最近一次 cull 中可见。 */
  visible: boolean;
}

/** GPUDrivenRenderer 构造选项。 */
export interface GPUDrivenRendererOptions {
  /** 最大 draw command 数(默认 4096)。 */
  maxDrawCommands?: number;
  /** 是否启用视锥剔除(默认 true)。 */
  cullingEnabled?: boolean;
  /** 是否启用遮挡剔除(默认 false,占位实现)。 */
  occlusionCulling?: boolean;
}

/** GPU 驱动渲染统计。 */
export interface GPUDrivenRendererStats {
  /** 当前 draw command 总数。 */
  totalCommands: number;
  /** 上一次 cull 后的可见 command 数。 */
  visibleCount: number;
  /** 上一次 cull 剔除的 command 数。 */
  culledCount: number;
  /** 上一次排序的 swap 次数(0 表示未排序或无需排序)。 */
  sortSwaps: number;
  /** indirect buffer 中的有效 command 数。 */
  indirectCommandCount: number;
  /** indirect buffer 字节大小(有效部分)。 */
  indirectBufferSize: number;
  /** 是否启用视锥剔除。 */
  cullingEnabled: boolean;
  /** 是否启用遮挡剔除。 */
  occlusionCulling: boolean;
  /** 最大 draw command 数。 */
  maxDrawCommands: number;
}

/** 单条 indirect command 的 uint 数(对应 GL drawElementsIndirect 结构)。 */
export const INDIRECT_COMMAND_UINTS = 5;
/** 单条 indirect command 的 float 数(5 个 uint 用 Float32Array 视图表示)。 */
export const INDIRECT_COMMAND_FLOATS = INDIRECT_COMMAND_UINTS;

// 临时变量复用。
const _tmpViewProjection = new Matrix4();
const _tmpViewMatrix = new Matrix4();
const _tmpFrustum = new Frustum();
const _tmpCamPos = new Vector3();

/**
 * GPU 驱动渲染管理器。
 *
 * 用法:
 *   const r = new GPUDrivenRenderer({ maxDrawCommands: 1024 });
 *   r.addDrawCommand({ drawId: 0, indexCount: 36, instanceCount: 1, firstIndex: 0,
 *     vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0,
 *     position: new Vector3(0,0,0), boundingRadius: 1, visible: true });
 *   r.update(dt, camera);
 *   const buf = r.getIndirectBuffer(); // Float32Array, 长度 = visibleCount * 5
 *   // 调用方用 Uint32Array 视图读取并 gl.multiDrawElementsIndirect
 */
export class GPUDrivenRenderer {
  /** 所有 draw command 列表。 */
  drawCommands: DrawCommand[] = [];
  /** 间接绘制缓冲(Float32Array 视图,长度 = maxDrawCommands * 5)。
   *  update() 时按可见 command 顺序填充;getIndirectBuffer() 返回有效长度。 */
  indirectBuffer: Float32Array | null = null;
  /** 实例缓冲表(name → Float32Array),用于 instanced rendering 的 per-instance 数据。 */
  instanceBuffers: Map<string, Float32Array> = new Map();
  /** 可见性缓冲(0/1 标记每条 command 是否可见,供 compute shader 模拟用)。 */
  visibilityBuffer: Float32Array | null = null;
  /** 最大 draw command 数。 */
  maxDrawCommands: number;
  /** 是否启用视锥剔除。 */
  cullingEnabled: boolean;
  /** 是否启用遮挡剔除。 */
  occlusionCulling: boolean;

  /** 当前 indirect buffer 中的有效 command 数。 */
  private _visibleCount: number = 0;
  /** 上一次排序的 swap 次数(统计用)。 */
  private _lastSortSwaps: number = 0;
  /** 上一次 cull 剔除的 command 数。 */
  private _lastCulledCount: number = 0;
  /** drawId → drawCommands 中的索引(便于 removeDrawCommand 快速查找)。 */
  private _drawIdToIndex: Map<number, number> = new Map();
  /** 下一个自动分配的 drawId。 */
  private _nextDrawId: number = 0;

  constructor(opts: GPUDrivenRendererOptions = {}) {
    this.maxDrawCommands = Math.max(1, Math.floor(opts.maxDrawCommands ?? 4096));
    this.cullingEnabled = opts.cullingEnabled ?? true;
    this.occlusionCulling = opts.occlusionCulling ?? false;
    this._reallocateBuffers();
  }

  /**
   * 添加一条 draw command。
   * drawId 由调用方指定(若为 -1 / 未提供,则自动分配)。
   * 超出 maxDrawCommands 时抛错。
   */
  addDrawCommand(command: Omit<DrawCommand, 'drawId' | 'visible'> & {
    drawId?: number;
    visible?: boolean;
  }): DrawCommand {
    if (this.drawCommands.length >= this.maxDrawCommands) {
      throw new Error(
        `GPUDrivenRenderer.addDrawCommand: maxDrawCommands (${this.maxDrawCommands}) exceeded`,
      );
    }
    const drawId = command.drawId ?? this._nextDrawId++;
    if (this._drawIdToIndex.has(drawId)) {
      throw new Error(`GPUDrivenRenderer.addDrawCommand: drawId ${drawId} already exists`);
    }
    const full: DrawCommand = {
      drawId,
      indexCount: Math.max(0, Math.floor(command.indexCount)),
      instanceCount: Math.max(0, Math.floor(command.instanceCount)),
      firstIndex: Math.max(0, Math.floor(command.firstIndex)),
      vertexOffset: Math.floor(command.vertexOffset),
      firstInstance: Math.max(0, Math.floor(command.firstInstance)),
      materialIndex: Math.max(0, Math.floor(command.materialIndex)),
      lodLevel: Math.max(0, Math.floor(command.lodLevel)),
      position: command.position.clone(),
      boundingRadius: Math.max(0, command.boundingRadius),
      visible: command.visible ?? true,
    };
    this._drawIdToIndex.set(drawId, this.drawCommands.length);
    this.drawCommands.push(full);
    return full;
  }

  /** 移除指定 drawId 的 command。返回 true 表示存在并已移除。 */
  removeDrawCommand(drawId: number): boolean {
    const idx = this._drawIdToIndex.get(drawId);
    if (idx === undefined) return false;
    // 用 swap-with-tail 删除(O(1))
    const last = this.drawCommands.length - 1;
    if (idx !== last) {
      const tailCmd = this.drawCommands[last];
      this.drawCommands[idx] = tailCmd;
      this._drawIdToIndex.set(tailCmd.drawId, idx);
    }
    this.drawCommands.pop();
    this._drawIdToIndex.delete(drawId);
    return true;
  }

  /** 清空所有 draw command。 */
  clearDrawCommands(): void {
    const n = this.drawCommands.length;
    this.drawCommands.length = 0;
    this._drawIdToIndex.clear();
    this._visibleCount = 0;
    this._lastCulledCount = 0;
    this._lastSortSwaps = 0;
    if (n > 0) log.debug(`clearDrawCommands() — dropped ${n} commands`);
  }

  /**
   * 每帧更新入口:
   *   1) 若 cullingEnabled,执行 cull(camera) 标记 visible;
   *   2) 若 occlusionCulling,执行 occlusionCull(camera);
   *   3) 执行 sortCommands()(按 materialIndex 排序,减少状态切换);
   *   4) 执行 buildIndirectBuffer() 填充 indirectBuffer。
   */
  update(dt: number, camera?: Camera | null): void {
    void dt;
    // 1) 视锥剔除
    if (this.cullingEnabled && camera) {
      this.cull(camera);
    } else {
      // 不剔除时全部标记可见
      for (const cmd of this.drawCommands) cmd.visible = true;
      this._lastCulledCount = 0;
    }
    // 2) 遮挡剔除
    if (this.occlusionCulling && camera) {
      this.occlusionCull(camera);
    }
    // 3) 排序
    this.sortCommands();
    // 4) 构建 indirect buffer
    this.buildIndirectBuffer();
  }

  /**
   * 视锥体剔除。基于 camera.projectionMatrix * inverse(matrixWorld) 提取 6 平面,
   * 对每条 command 的 position + boundingRadius 做球-视锥相交测试。
   * 标记 cmd.visible = true/false。
   */
  cull(camera: Camera): void {
    _tmpViewMatrix.getInverse(camera.matrixWorld);
    _tmpViewProjection.multiplyMatrices(camera.projectionMatrix, _tmpViewMatrix);
    _tmpFrustum.setFromViewProjectionMatrix(_tmpViewProjection);

    let culled = 0;
    for (const cmd of this.drawCommands) {
      // 包围球与视锥相交测试(在视锥内或与视锥相交 → 可见)
      cmd.visible = _tmpFrustum.intersectsSphere(cmd.position, cmd.boundingRadius);
      if (!cmd.visible) culled++;
    }
    this._lastCulledCount = culled;
  }

  /**
   * 遮挡剔除(占位实现)。
   *
   * 真实 GPU 遮挡剔除需要 GL_QUERY 或 hierarchical-z buffer;本类不依赖 GL,
   * 采用简化策略:对每条 command 计算其包围球在相机视线方向上的距离,
   * 距离过远(超过 camera.far * 0.95)的视为"被遮挡"。
   *
   * 此实现仅用于演示 API 形态;生产环境应替换为基于 depth pyramid 的真实
   * 遮挡剔除。
   */
  occlusionCull(camera: Camera): void {
    // 提取相机视线方向(本地 -Z 在世界空间的方向)
    const e = camera.matrixWorld.elements;
    _tmpCamPos.set(e[12], e[13], e[14]);
    const dirX = -e[8];
    const dirY = -e[9];
    const dirZ = -e[10];

    // 远裁面阈值(从 camera 读取,默认 1000)
    const far = (camera as { far?: number }).far ?? 1000;
    const threshold = far * 0.95;

    let occluded = 0;
    for (const cmd of this.drawCommands) {
      if (!cmd.visible) continue;
      const dx = cmd.position.x - _tmpCamPos.x;
      const dy = cmd.position.y - _tmpCamPos.y;
      const dz = cmd.position.z - _tmpCamPos.z;
      const distAlongView = dx * dirX + dy * dirY + dz * dirZ;
      if (distAlongView > threshold) {
        cmd.visible = false;
        occluded++;
      }
    }
    this._lastCulledCount += occluded;
  }

  /**
   * 排序 draw command(按 materialIndex 升序,减少 shader/uniform 切换)。
   * 仅排序 visible=true 的 command;不可见 command 保留在数组末尾。
   * 使用稳定的插入排序(command 数量通常 < 1e4,插入排序对小数组友好)。
   */
  sortCommands(): void {
    const arr = this.drawCommands;
    let swaps = 0;
    // 把可见的挪到前面(稳定 partition)
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < arr.length; readIdx++) {
      if (arr[readIdx].visible) {
        if (writeIdx !== readIdx) {
          const tmp = arr[writeIdx];
          arr[writeIdx] = arr[readIdx];
          arr[readIdx] = tmp;
          swaps++;
        }
        writeIdx++;
      }
    }
    // 对 [0, writeIdx) 区间按 materialIndex 升序插入排序
    for (let i = 1; i < writeIdx; i++) {
      const key = arr[i];
      let j = i - 1;
      while (j >= 0 && arr[j].materialIndex > key.materialIndex) {
        arr[j + 1] = arr[j];
        j--;
        swaps++;
      }
      arr[j + 1] = key;
    }
    // 同步 drawIdToIndex(整个表重建,O(n))
    this._drawIdToIndex.clear();
    for (let i = 0; i < arr.length; i++) {
      this._drawIdToIndex.set(arr[i].drawId, i);
    }
    this._lastSortSwaps = swaps;
  }

  /**
   * 构建 indirect buffer:把所有 visible=true 的 command 按 5-uint 结构
   * 写入 indirectBuffer(Float32Array 视图)。返回写入的 command 数。
   */
  buildIndirectBuffer(): number {
    if (!this.indirectBuffer) this._reallocateBuffers();
    const buf = this.indirectBuffer as Float32Array;
    let count = 0;
    for (const cmd of this.drawCommands) {
      if (!cmd.visible) continue;
      // 跳过 indexCount=0 或 instanceCount=0 的空 command(避免无效绘制)
      if (cmd.indexCount === 0 || cmd.instanceCount === 0) continue;
      const offset = count * INDIRECT_COMMAND_FLOATS;
      if (offset + INDIRECT_COMMAND_FLOATS > buf.length) break;
      buf[offset + 0] = cmd.indexCount;
      buf[offset + 1] = cmd.instanceCount;
      buf[offset + 2] = cmd.firstIndex;
      buf[offset + 3] = cmd.vertexOffset;
      buf[offset + 4] = cmd.firstInstance;
      count++;
    }
    this._visibleCount = count;
    return count;
  }

  /**
   * 获取 indirect buffer(完整 Float32Array,长度 = maxDrawCommands * 5)。
   * 调用方应只读取前 getDrawCommandCount() * 5 个元素。
   */
  getIndirectBuffer(): Float32Array | null {
    return this.indirectBuffer;
  }

  /** 当前 draw command 总数(含不可见)。 */
  getDrawCommandCount(): number {
    return this.drawCommands.length;
  }

  /** 上一次 update 后的可见 command 数(= indirect buffer 有效条目数)。 */
  getVisibleCount(): number {
    return this._visibleCount;
  }

  /** 设置是否启用视锥剔除。 */
  setCulling(enabled: boolean): void {
    this.cullingEnabled = enabled;
  }

  /** 设置是否启用遮挡剔除。 */
  setOcclusionCulling(enabled: boolean): void {
    this.occlusionCulling = enabled;
  }

  /**
   * 设置最大 draw command 数。
   * 若新值小于当前 command 数,抛错(避免数据丢失;调用方应先 clearDrawCommands)。
   */
  setMaxDrawCommands(max: number): void {
    const newMax = Math.max(1, Math.floor(max));
    if (newMax < this.drawCommands.length) {
      throw new Error(
        `GPUDrivenRenderer.setMaxDrawCommands: new max ${newMax} < current command count ${this.drawCommands.length}`,
      );
    }
    this.maxDrawCommands = newMax;
    this._reallocateBuffers();
  }

  /**
   * 注册一个实例缓冲(供 instanced rendering 用)。
   * @param name 缓冲名(如 'instanceMatrix')
   * @param buffer Float32Array 数据(调用方负责 per-instance 数据布局)
   */
  setInstanceBuffer(name: string, buffer: Float32Array): void {
    this.instanceBuffers.set(name, buffer);
  }

  /** 获取已注册的实例缓冲。 */
  getInstanceBuffer(name: string): Float32Array | undefined {
    return this.instanceBuffers.get(name);
  }

  /** 移除实例缓冲。 */
  removeInstanceBuffer(name: string): boolean {
    return this.instanceBuffers.delete(name);
  }

  /**
   * 获取可见性缓冲(visibilityBuffer)。
   * 长度 = maxDrawCommands,每元素 0/1 标记对应 drawCommand 是否可见。
   * 调用方可把它上传到 GPU 作为 compute shader 输入。
   */
  getVisibilityBuffer(): Float32Array | null {
    if (!this.visibilityBuffer) this._reallocateBuffers();
    const buf = this.visibilityBuffer as Float32Array;
    for (let i = 0; i < this.drawCommands.length && i < buf.length; i++) {
      buf[i] = this.drawCommands[i].visible ? 1 : 0;
    }
    // 末尾清零
    for (let i = this.drawCommands.length; i < buf.length; i++) {
      buf[i] = 0;
    }
    return buf;
  }

  /** 获取统计快照。 */
  getStats(): GPUDrivenRendererStats {
    return {
      totalCommands: this.drawCommands.length,
      visibleCount: this._visibleCount,
      culledCount: this._lastCulledCount,
      sortSwaps: this._lastSortSwaps,
      indirectCommandCount: this._visibleCount,
      indirectBufferSize: this._visibleCount * INDIRECT_COMMAND_FLOATS * 4,
      cullingEnabled: this.cullingEnabled,
      occlusionCulling: this.occlusionCulling,
      maxDrawCommands: this.maxDrawCommands,
    };
  }

  /** 释放所有 CPU 侧缓冲(draw commands / indirect buffer / instance buffers)。 */
  dispose(): void {
    this.drawCommands.length = 0;
    this._drawIdToIndex.clear();
    this._visibleCount = 0;
    this._lastCulledCount = 0;
    this._lastSortSwaps = 0;
    this.indirectBuffer = null;
    this.visibilityBuffer = null;
    this.instanceBuffers.clear();
  }

  // ── 内部 ────────────────────────────────────────────────────────

  /** 重新分配 indirectBuffer / visibilityBuffer(按当前 maxDrawCommands)。 */
  private _reallocateBuffers(): void {
    this.indirectBuffer = new Float32Array(this.maxDrawCommands * INDIRECT_COMMAND_FLOATS);
    this.visibilityBuffer = new Float32Array(this.maxDrawCommands);
  }
}
