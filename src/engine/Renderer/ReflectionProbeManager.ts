// ReflectionProbeManager — 反射探针管理器。
//
// 设计目标:
//   - 集中管理场景中的多个 ReflectionProbe,提供添加 / 移除 / 批量更新;
//   - 给定空间点返回"最近 / 优先级最高"的探针,供 PBR 材质采样 IBL;
//   - getInfluence(point) 返回 0..1 权重(基于到探针中心的距离与 boxSize),
//     用于多探针混合(当前 v1 只返回单一最近探针的权重)。
//
// 更新策略(v1):
//   - update() 遍历所有探针,顺序调用 capture()。
//   - 不做按距离剔除 / 帧分摊 / 异步编译;留作 v2 优化点。
//   - maxProbes 上限避免无限制 capture(每帧 6 面 * maxProbes 次 render 开销大)。
//
// 选择策略:
//   - getProbeAt(point):返回 contains(point) 的探针中 priority 最高者;
//     若无 contains 命中,退回"距离 boxSize 中心最近"的探针。
//   - getInfluence(point):若点在探针 boxSize 内返回 1,否则按距离线性衰减到 0
//     (衰减距离 = boxSize 最长轴的一半)。

import { Scene } from '../Core/Scene';
import { Vector3 } from '../Math';
import type { Renderer } from './Renderer';
import { ReflectionProbe } from './ReflectionProbe';
import { createLogger } from '@/lib/logger';

const log = createLogger('ReflectionProbeManager');

export interface ReflectionProbeManagerOptions {
  /** 最大探针数(超出时 add 抛错;默认 8)。 */
  maxProbes?: number;
}

export class ReflectionProbeManager {
  /** 已注册探针列表(添加顺序)。 */
  probes: ReflectionProbe[] = [];
  /** 最大探针数上限。 */
  maxProbes: number;

  constructor(opts: ReflectionProbeManagerOptions = {}) {
    this.maxProbes = opts.maxProbes ?? 8;
  }

  /**
   * 添加探针。超过 maxProbes 抛错。
   * 同一探针实例重复添加会被忽略(返回 false)。
   */
  addProbe(probe: ReflectionProbe): boolean {
    if (this.probes.includes(probe)) return false;
    if (this.probes.length >= this.maxProbes) {
      throw new Error(
        `ReflectionProbeManager.addProbe: reached maxProbes (${this.maxProbes})`,
      );
    }
    this.probes.push(probe);
    log.info(`probe added (total=${this.probes.length})`);
    return true;
  }

  /** 移除探针。返回是否移除成功。 */
  removeProbe(probe: ReflectionProbe): boolean {
    const i = this.probes.indexOf(probe);
    if (i < 0) return false;
    this.probes.splice(i, 1);
    return true;
  }

  /**
   * 更新所有探针(顺序 capture)。
   * @param gl       WebGL2 上下文(传给 probe.capture)
   * @param renderer 渲染器(传给 probe.capture)
   * @param scene    场景(传给 probe.capture)
   */
  update(gl: WebGL2RenderingContext, renderer: Renderer, scene: Scene): void {
    for (const probe of this.probes) {
      probe.capture(gl, renderer, scene);
    }
  }

  /**
   * 获取某点最匹配的探针(优先 contains 命中且 priority 最高;
   * 无 contains 时退回 boxSize 中心最近者)。
   * 列表为空时返回 null。
   */
  getProbeAt(point: Vector3): ReflectionProbe | null {
    if (this.probes.length === 0) return null;

    // 第一轮:找出 contains(point) 的探针中 priority 最高者
    let best: ReflectionProbe | null = null;
    for (const p of this.probes) {
      if (!p.contains(point)) continue;
      if (!best || p.priority > best.priority) best = p;
    }
    if (best) return best;

    // 退回:距离 boxSize 中心最近(用归一化距离 = 距离 / boxSize 最大轴)
    let bestDist = Infinity;
    for (const p of this.probes) {
      const dx = (point.x - p.position.x) / Math.max(0.001, p.boxSize.x);
      const dy = (point.y - p.position.y) / Math.max(0.001, p.boxSize.y);
      const dz = (point.z - p.position.z) / Math.max(0.001, p.boxSize.z);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  /**
   * 返回探针在指定点的影响权重(0..1)。
   *   - 在 boxSize 内 → 1
   *   - 在 boxSize 外 → 按到 boxSize 中心的归一化距离线性衰减到 0
   *     (衰减半径 = boxSize 最长轴的 2 倍,超过即 0)
   * 列表为空时返回 0。
   */
  getInfluence(point: Vector3): number {
    const probe = this.getProbeAt(point);
    if (!probe) return 0;

    if (probe.contains(point)) return 1;

    // 计算到 boxSize 中心的归一化距离(各轴除以 boxSize)
    const dx = Math.abs(point.x - probe.position.x) / Math.max(0.001, probe.boxSize.x);
    const dy = Math.abs(point.y - probe.position.y) / Math.max(0.001, probe.boxSize.y);
    const dz = Math.abs(point.z - probe.position.z) / Math.max(0.001, probe.boxSize.z);
    // 取最大轴归一化距离(因为 contains 已用 ≤ 判断,这里 max>1 表示至少一轴越界)
    const maxAxis = Math.max(dx, dy, dz);
    // 衰减半径 = 2(即 boxSize 外 1 倍 boxSize 处衰减到 0)
    if (maxAxis >= 2.0) return 0;
    return Math.max(0, 1.0 - (maxAxis - 1.0));
  }

  /** 释放所有探针的 GL 资源。 */
  dispose(gl: WebGL2RenderingContext): void {
    for (const p of this.probes) p.dispose(gl);
    this.probes = [];
  }
}
