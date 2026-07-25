// PrecipitationSystem — 降水系统(雨/雪)。
//
// 设计:
//   * 在 Box3 bounds 内维持 density 个粒子,出边界后从顶部重生
//   * 雨滴下落速度高、几乎无横向漂移;雪片下落慢、受风影响大
//   * update(dt, wind) 推进位置并处理重生
//   * getMeshData() 输出 position/velocity 数组供渲染端绘制
//
// 与 WeatherSystem 的关系:
//   * type 与 WeatherSystem.type 对齐('rain'/'snow')
//   * 外部把 WeatherSystem.windDirection * windStrength 作为 wind 参数传入

import { Vector3 } from '../Math';
import { Box3 } from '../Math';

/** 降水类型。 */
export type PrecipitationType = 'rain' | 'snow';

/** 单个降水粒子。 */
export interface PrecipitationParticle {
  /** 当前世界位置。 */
  position: Vector3;
  /** 当前速度(米/秒)。 */
  velocity: Vector3;
  /** 粒子尺寸(米,用于渲染端大小)。 */
  size: number;
  /** 不透明度(0..1)。 */
  opacity: number;
}

/** 渲染数据(供 instanced mesh)。 */
export interface PrecipitationMeshData {
  /** 每个粒子的世界位置(扁平 xyz)。 */
  positions: Float32Array;
  /** 每个粒子的尺寸。 */
  sizes: Float32Array;
  /** 每个粒子的不透明度。 */
  opacities: Float32Array;
  /** 总粒子数。 */
  count: number;
}

const DEFAULT_RAIN_SPEED = 25; // m/s 下落
const DEFAULT_SNOW_SPEED = 1.5;

/**
 * 降水系统 — 在 bounds 内模拟雨/雪粒子。
 */
export class PrecipitationSystem {
  /** 降水类型。 */
  type: PrecipitationType = 'rain';
  /** 粒子列表。 */
  particles: PrecipitationParticle[] = [];
  /** 活动边界(粒子在此范围内循环)。 */
  bounds: Box3;
  /** 期望粒子数(实际粒子数会跟随 setDensity 调整)。 */
  density: number = 1000;

  constructor(
    type: PrecipitationType = 'rain',
    bounds: Box3 = new Box3(
      new Vector3(-50, 0, -50),
      new Vector3(50, 100, 50),
    ),
    density: number = 1000,
  ) {
    this.type = type;
    this.bounds = bounds;
    this.density = density;
    this.respawnParticles();
  }

  /** 推进粒子位置,出边界后从顶部重生。
   *  wind: 风速向量(米/秒),用于横向漂移。 */
  update(dt: number, wind: Vector3): this {
    const minY = this.bounds.min.y;
    const sizeX = this.bounds.max.x - this.bounds.min.x;
    const sizeY = this.bounds.max.y - this.bounds.min.y;
    const sizeZ = this.bounds.max.z - this.bounds.min.z;
    const fallSpeed = this.type === 'rain' ? DEFAULT_RAIN_SPEED : DEFAULT_SNOW_SPEED;
    const windInfluence = this.type === 'rain' ? 0.3 : 1.0;

    for (const p of this.particles) {
      p.position.addScaledVector(p.velocity, dt);
      // 横向漂移(雪受风影响更大)
      p.position.addScaledVector(wind, dt * windInfluence);
      // 出边界 → 从顶部重生
      if (p.position.y < minY) {
        p.position.x = this.bounds.min.x + Math.random() * sizeX;
        p.position.y = this.bounds.min.y + sizeY;
        p.position.z = this.bounds.min.z + Math.random() * sizeZ;
        p.velocity.set(
          wind.x * windInfluence * 0.5,
          -fallSpeed,
          wind.z * windInfluence * 0.5,
        );
      }
      // 横向出边界 → 从对侧循环
      if (p.position.x < this.bounds.min.x) p.position.x += sizeX;
      if (p.position.x > this.bounds.max.x) p.position.x -= sizeX;
      if (p.position.z < this.bounds.min.z) p.position.z += sizeZ;
      if (p.position.z > this.bounds.max.z) p.position.z -= sizeZ;
    }
    return this;
  }

  /** 设置粒子密度(立即调整粒子数到 d)。 */
  setDensity(d: number): this {
    this.density = Math.max(0, Math.floor(d));
    if (this.particles.length < this.density) {
      while (this.particles.length < this.density) {
        this.particles.push(this.spawnParticle());
      }
    } else if (this.particles.length > this.density) {
      this.particles.length = this.density;
    }
    return this;
  }

  /** 设置降水类型(同时调整下落速度)。 */
  setType(type: PrecipitationType): this {
    this.type = type;
    const fallSpeed = type === 'rain' ? DEFAULT_RAIN_SPEED : DEFAULT_SNOW_SPEED;
    for (const p of this.particles) {
      p.velocity.y = -fallSpeed;
    }
    return this;
  }

  /** 重置所有粒子(随机分布到 bounds 内)。 */
  respawnParticles(): this {
    const sizeX = this.bounds.max.x - this.bounds.min.x;
    const sizeY = this.bounds.max.y - this.bounds.min.y;
    const sizeZ = this.bounds.max.z - this.bounds.min.z;
    const fallSpeed = this.type === 'rain' ? DEFAULT_RAIN_SPEED : DEFAULT_SNOW_SPEED;
    this.particles = new Array(this.density);
    for (let i = 0; i < this.density; i++) {
      this.particles[i] = {
        position: new Vector3(
          this.bounds.min.x + Math.random() * sizeX,
          this.bounds.min.y + Math.random() * sizeY,
          this.bounds.min.z + Math.random() * sizeZ,
        ),
        velocity: new Vector3(0, -fallSpeed, 0),
        size: this.type === 'rain' ? 0.05 : 0.15,
        opacity: 0.6 + Math.random() * 0.4,
      };
    }
    return this;
  }

  /** 获取渲染数据。 */
  getMeshData(): PrecipitationMeshData {
    const count = this.particles.length;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const opacities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      positions[i * 3] = p.position.x;
      positions[i * 3 + 1] = p.position.y;
      positions[i * 3 + 2] = p.position.z;
      sizes[i] = p.size;
      opacities[i] = p.opacity;
    }
    return { positions, sizes, opacities, count };
  }

  /** 内部:生成一个新粒子(随机分布在 bounds 内,初始速度向下)。 */
  private spawnParticle(): PrecipitationParticle {
    const sizeX = this.bounds.max.x - this.bounds.min.x;
    const sizeY = this.bounds.max.y - this.bounds.min.y;
    const sizeZ = this.bounds.max.z - this.bounds.min.z;
    const fallSpeed = this.type === 'rain' ? DEFAULT_RAIN_SPEED : DEFAULT_SNOW_SPEED;
    return {
      position: new Vector3(
        this.bounds.min.x + Math.random() * sizeX,
        this.bounds.min.y + Math.random() * sizeY,
        this.bounds.min.z + Math.random() * sizeZ,
      ),
      velocity: new Vector3(0, -fallSpeed, 0),
      size: this.type === 'rain' ? 0.05 : 0.15,
      opacity: 0.6 + Math.random() * 0.4,
    };
  }
}
