// CloudSystem — 云系统(粒子化云团)。
//
// 设计:
//   * 每片云由若干 CloudParticle 组成,粒子位置相对云中心
//   * update(dt) 推进云团整体随风漂移;出边界后从对侧循环
//   * coverage 控制可见云数量(>coverage 的云淡出)
//   * getMeshData() 输出 position/size 数组供渲染端实例化绘制
//
// 与 WeatherSystem 的关系:
//   * 外部 update 时把 windStrength / windDirection 传入或直接由本类读取
//   * 这里 windSpeed 是 Vector3,由外部根据 WeatherSystem 设置

import { Vector3 } from '../Math';
import { Box3 } from '../Math';

/** 单个云粒子(构成一片云的子体积)。 */
export interface CloudParticle {
  /** 相对云中心的位置偏移。 */
  offset: Vector3;
  /** 粒子尺寸(米)。 */
  size: number;
  /** 不透明度(0..1)。 */
  opacity: number;
}

/** 单片云。 */
export interface Cloud {
  /** 世界中心。 */
  center: Vector3;
  /** 子粒子(相对 center 的偏移)。 */
  particles: CloudParticle[];
  /** 当前可见不透明度(经 coverage 调制)。 */
  visibility: number;
}

/** 渲染数据(供 instanced mesh)。 */
export interface CloudMeshData {
  /** 每个粒子的世界位置(扁平 xyz)。 */
  positions: Float32Array;
  /** 每个粒子的尺寸。 */
  sizes: Float32Array;
  /** 每个粒子的不透明度。 */
  opacities: Float32Array;
  /** 总粒子数。 */
  count: number;
}

const _tmpVec = new Vector3();

/**
 * 云系统 — 管理云团生成、漂移、可见性。
 */
export class CloudSystem {
  /** 所有云团。 */
  clouds: Cloud[] = [];
  /** 云量(0..1,0=无云,1=满云)。 */
  coverage: number = 0.5;
  /** 云高度(世界 Y)。 */
  altitude: number = 200;
  /** 风速向量(米/秒)。 */
  windSpeed: Vector3 = new Vector3(2, 0, 0);
  /** 云活动边界(水平范围,云出边界后从对侧循环)。 */
  bounds: Box3;

  constructor(bounds: Box3 = new Box3(
    new Vector3(-500, 100, -500),
    new Vector3(500, 300, 500),
  )) {
    this.bounds = bounds;
  }

  /** 生成 numClouds 片随机云,清除已有云。 */
  generate(numClouds: number): this {
    this.clouds = [];
    const sizeX = this.bounds.max.x - this.bounds.min.x;
    const sizeZ = this.bounds.max.z - this.bounds.min.z;
    for (let i = 0; i < numClouds; i++) {
      const cx = this.bounds.min.x + Math.random() * sizeX;
      const cz = this.bounds.min.z + Math.random() * sizeZ;
      const cy = this.altitude + (Math.random() - 0.5) * 50;
      const cloud: Cloud = {
        center: new Vector3(cx, cy, cz),
        particles: [],
        visibility: 1,
      };
      // 每片云 5-10 个粒子
      const pc = 5 + Math.floor(Math.random() * 6);
      for (let p = 0; p < pc; p++) {
        cloud.particles.push({
          offset: new Vector3(
            (Math.random() - 0.5) * 40,
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 40,
          ),
          size: 20 + Math.random() * 30,
          opacity: 0.5 + Math.random() * 0.5,
        });
      }
      this.clouds.push(cloud);
    }
    this.updateVisibility();
    return this;
  }

  /** 推进时间:云团漂移 + 出边界循环。 */
  update(dt: number): this {
    const minBound = this.bounds.min;
    const maxBound = this.bounds.max;
    const sizeX = maxBound.x - minBound.x;
    const sizeZ = maxBound.z - minBound.z;

    for (const cloud of this.clouds) {
      cloud.center.addScaledVector(this.windSpeed, dt);
      // 水平循环
      if (cloud.center.x < minBound.x) cloud.center.x += sizeX;
      if (cloud.center.x > maxBound.x) cloud.center.x -= sizeX;
      if (cloud.center.z < minBound.z) cloud.center.z += sizeZ;
      if (cloud.center.z > maxBound.z) cloud.center.z -= sizeZ;
    }
    return this;
  }

  /** 设置云量(0..1),自动调整可见云数量。 */
  setCoverage(c: number): this {
    this.coverage = Math.max(0, Math.min(1, c));
    this.updateVisibility();
    return this;
  }

  /** 设置云高度。 */
  setAltitude(h: number): this {
    const delta = h - this.altitude;
    for (const cloud of this.clouds) {
      cloud.center.y += delta;
    }
    this.altitude = h;
    return this;
  }

  /** 设置风速向量。 */
  setWindSpeed(wind: Vector3): this {
    this.windSpeed.copy(wind);
    return this;
  }

  /** 重新计算每片云的可见性(按 coverage 比例决定多少云可见)。 */
  private updateVisibility(): void {
    const n = this.clouds.length;
    if (n === 0) return;
    const visibleCount = Math.round(n * this.coverage);
    for (let i = 0; i < n; i++) {
      this.clouds[i].visibility = i < visibleCount ? 1 : 0;
    }
  }

  /** 获取渲染数据(扁平数组)。 */
  getMeshData(): CloudMeshData {
    // 先统计可见粒子数
    let count = 0;
    for (const cloud of this.clouds) {
      if (cloud.visibility <= 0) continue;
      count += cloud.particles.length;
    }
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const opacities = new Float32Array(count);
    let idx = 0;
    for (const cloud of this.clouds) {
      if (cloud.visibility <= 0) continue;
      for (const p of cloud.particles) {
        _tmpVec.copy(cloud.center).add(p.offset);
        positions[idx * 3] = _tmpVec.x;
        positions[idx * 3 + 1] = _tmpVec.y;
        positions[idx * 3 + 2] = _tmpVec.z;
        sizes[idx] = p.size;
        opacities[idx] = p.opacity * cloud.visibility;
        idx++;
      }
    }
    return { positions, sizes, opacities, count };
  }
}
