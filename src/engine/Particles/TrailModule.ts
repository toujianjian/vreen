// TrailModule — 粒子拖尾模块。
//
// 为每个活跃粒子维护最近 length 帧的位置历史,渲染时连成 line strip。
//
// 属性:
//   - length:拖尾段数(保留的历史点数)
//   - width:线宽(渲染器读取,本模块不绘制)
//   - colorMode:'fade' 沿拖尾方向 alpha 衰减;'constant' 整条拖尾同色
//
// 数据结构:Map<ParticleData, Vector3[]>。粒子死亡后被清理。
// 注意:Map 用对象引用做 key,粒子对象池复用时若不清理会残留旧拖尾,
// 因此 update() 每帧先扫描清理"不在传入列表里"的 entry。

import { Vector3 } from '../Math/Vector3';
import { ParticleData } from './ParticleData';

/** 拖尾颜色模式。 */
export type TrailColorMode = 'fade' | 'constant';

/** 拖尾渲染数据。每条拖尾作为一个独立 line strip,counts[i] 是第 i 条的点数。 */
export interface TrailRenderData {
  /** 拖尾顶点位置扁平数组 [x,y,z, ...]。 */
  positions: Float32Array;
  /** 拖尾顶点颜色扁平数组 [r,g,b, ...]。 */
  colors: Float32Array;
  /** 每条拖尾的点数(用于按 strip 绘制)。 */
  counts: number[];
  /** 拖尾条数。 */
  trailCount: number;
}

export class TrailModule {
  /** 拖尾段数(保留的历史点数,实际线段 = length-1)。 */
  length: number;
  /** 线宽。 */
  width: number;
  /** 颜色模式。 */
  colorMode: TrailColorMode;

  /** 每个粒子的位置历史(最近 length 个位置,最新在尾部)。 */
  private histories: Map<ParticleData, Vector3[]>;

  constructor(length: number = 8, width: number = 0.1, colorMode: TrailColorMode = 'fade') {
    this.length = length;
    this.width = width;
    this.colorMode = colorMode;
    this.histories = new Map();
  }

  /** 每帧推进:为活跃粒子追加当前位置,清理已死粒子的历史。 */
  update(particles: ParticleData[], _dt: number): void {
    // 1. 清理:不在 particles 列表或已死亡的 entry
    const aliveSet = new Set<ParticleData>();
    for (const p of particles) {
      if (p.alive) aliveSet.add(p);
    }
    for (const key of this.histories.keys()) {
      if (!aliveSet.has(key)) {
        this.histories.delete(key);
      }
    }
    // 2. 追加位置
    for (const p of particles) {
      if (!p.alive) continue;
      let trail = this.histories.get(p);
      if (!trail) {
        trail = [];
        this.histories.set(p, trail);
      }
      trail.push(new Vector3(p.position.x, p.position.y, p.position.z));
      while (trail.length > this.length) {
        trail.shift();
      }
    }
  }

  /** 返回所有拖尾的渲染数据。 */
  getTrailData(): TrailRenderData {
    const positions: number[] = [];
    const colors: number[] = [];
    const counts: number[] = [];
    for (const [p, trail] of this.histories) {
      const n = trail.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        positions.push(trail[i].x, trail[i].y, trail[i].z);
        const fade = this.colorMode === 'fade' ? i / Math.max(1, n - 1) : 1;
        colors.push(p.color.r * fade, p.color.g * fade, p.color.b * fade);
      }
      counts.push(n);
    }
    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      counts,
      trailCount: counts.length,
    };
  }

  /** 清空所有拖尾历史。 */
  reset(): void {
    this.histories.clear();
  }

  /** 当前拖尾条数。 */
  get trailCount(): number {
    return this.histories.size;
  }
}
