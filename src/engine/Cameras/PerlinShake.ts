// PerlinShake — 高品质相机震动(基于 trauma² 模型 + 多倍频 Perlin 噪声)。
//
// 设计来源:
//   * NVIDIA GDC 2016 "Mission Improbable: A Gentle Introduction to Camera Shake"
//     (演讲话题:为何直接线性衰减 amplitude 显得「假」,以及 trauma² 模型的优越性)
//   * o3de AzFramework Camera Shake Component
//   * Unity Cinemachine BasicDamping / Noise Settings
//
// 与 CinematicCamera.shake() 的关系:
//   * CinematicCamera.shake() 是简陋实现:基于 sin/cos + 线性衰减。
//     适合「快速示意」,但低频周期感明显,假。
//   * PerlinShake 是专业实现:
//     - trauma² 衰减(自然「冲击 → 余震」曲线)
//     - 多倍频 Perlin 噪声(无周期感)
//     - 平移/旋转独立通道(6 路噪声)
//     - 每轴独立频率(避免同步对齐)
//     - 种子可复现(录像/回放一致)
//   * 二者并存:简单需求用 CinematicCamera.shake();
//     专业需求(战斗、爆炸、碰撞反馈)用 PerlinShake 叠加到相机。
//
// 算法:
//   shake_amount = trauma²  (trauma ∈ [0, 1])
//   translation[i] = noise(t * freq[i] + seed[i]) * maxOffset * shake_amount
//   rotation[i]    = noise(t * freq[i+3] + seed[i+3]) * maxAngle  * shake_amount
//   trauma = max(0, trauma - decay * dt)
//
// 关键性质:
//   * trauma² 让初始冲击大、尾段余震小 —— 与人眼对震动的感知匹配
//   * 多倍频 noise 在低频噪声上叠加高频细节,产生「重击 + 颤抖」层次
//   * 每轴独立频率 + 独立相位偏移,避免三轴同步(同步会显得「机械」)

import { Vector3 } from '../Math';
import { ImprovedNoise } from '../Math';

/** 震动偏移输出。 */
export interface ShakeOffset {
  /** 平移偏移(世界坐标,米)。 */
  translation: Vector3;
  /** 旋转偏移(pitch / yaw / roll,弧度)。 */
  rotation: Vector3;
  /** 当前 trauma²(0..1,可供 UI / 调试显示)。 */
  amount: number;
}

/** 序列化结构。 */
export interface PerlinShakeJSON {
  maxOffset: number;
  maxAngle: number;
  frequency: number;
  decay: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  seed: number;
  trauma: number;
}

// 注:getOffset 不复用模块级临时向量,因为 ShakeOffset 需要返回独立的
// Vector3 实例(调用方可能持有 translation 引用)。若需零分配热路径,
// 调用方应传入 out 参数并复用 out.translation / out.rotation。

/**
 * 高品质 Perlin 噪声相机震动。
 *
 * 用法:
 *   const shake = new PerlinShake();
 *   shake.maxOffset = 0.5;  // 最大平移 0.5 米
 *   shake.maxAngle = 0.05; // 最大旋转 ~3°
 *   shake.decay = 1.5;     // trauma 每秒衰减 1.5
 *
 *   // 触发震动(爆炸/碰撞/开火):
 *   shake.addTrauma(0.8);
 *
 *   // 每帧:
 *   shake.update(dt);
 *   const offset = shake.getOffset();
 *   camera.position.add(offset.translation);
 *   // 应用 rotation 到 camera.quaternion(由调用方处理)
 *
 * 多次触发会叠加 trauma(上限 1.0),实现「连击震动累积」。
 */
export class PerlinShake {
  /** 最大平移幅度(米)。 */
  maxOffset: number = 0.5;
  /** 最大旋转幅度(弧度)。 */
  maxAngle: number = 0.05;
  /** 基础频率(Hz,各轴频率由此派生)。 */
  frequency: number = 1.0;
  /** trauma 每秒衰减量(典型 1..3)。 */
  decay: number = 1.5;
  /** Perlin 倍频数(典型 2..4)。 */
  octaves: number = 3;
  /** 倍频振幅衰减(典型 0.5)。 */
  persistence: number = 0.5;
  /** 倍频频率增长(典型 2.0)。 */
  lacunarity: number = 2.0;

  /** 当前 trauma 值 [0, 1]。 */
  trauma: number = 0;
  /** 噪声种子(改变它会让噪声模式完全不同)。 */
  seed: number = 0;

  /** 内部 Perlin 噪声器。 */
  private noise: ImprovedNoise;
  /** 累积时间(用于推进噪声相位)。 */
  private time: number = 0;

  constructor(seed: number = 0) {
    this.noise = new ImprovedNoise();
    this.seed = seed;
  }

  /** 增加 trauma(累加,截断到 1.0)。返回新 trauma 值。 */
  addTrauma(amount: number): number {
    this.trauma = Math.max(0, Math.min(1, this.trauma + amount));
    return this.trauma;
  }

  /** 直接设置 trauma(截断到 [0, 1])。 */
  setTrauma(value: number): this {
    this.trauma = Math.max(0, Math.min(1, value));
    return this;
  }

  /** 立即清零 trauma(用于显式停止)。 */
  reset(): this {
    this.trauma = 0;
    this.time = 0;
    return this;
  }

  /** 是否仍在震动中(trauma > 0)。 */
  isActive(): boolean {
    return this.trauma > 0;
  }

  /** 当前震动强度 = trauma²。 */
  getAmount(): number {
    return this.trauma * this.trauma;
  }

  /**
   * 每帧更新 — 推进时间 + 衰减 trauma。
   *  dt: 帧时间(秒)。
   */
  update(dt: number): this {
    this.time += dt;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.decay * dt);
    }
    return this;
  }

  /**
   * 计算当前震动偏移(平移 + 旋转)。
   *  out: 可选复用对象。
   *
   * 返回的 translation 单位为米,rotation 单位为弧度,
   * 调用方应将其叠加到相机位置/姿态上。
   */
  getOffset(out?: ShakeOffset): ShakeOffset {
    const result: ShakeOffset = out ?? {
      translation: new Vector3(),
      rotation: new Vector3(),
      amount: 0,
    };

    const amount = this.getAmount();
    result.amount = amount;

    if (amount <= 0) {
      result.translation.set(0, 0, 0);
      result.rotation.set(0, 0, 0);
      return result;
    }

    // 6 路独立噪声:translation.x / y / z + rotation.x / y / z
    // 每路使用不同频率(基础频率的 1.0 / 1.3 / 1.7 倍)和相位偏移(seed + i*100)
    // 避免三轴同步对齐(同步会让震动显得「机械」)
    const t = this.time * this.frequency;
    const s = this.seed;

    // 多倍频采样:低频提供主冲击,高频提供颤抖细节
    const tx = this.fbm(t * 1.0, s + 0);
    const ty = this.fbm(t * 1.3, s + 100);
    const tz = this.fbm(t * 1.7, s + 200);
    const rx = this.fbm(t * 1.1, s + 300);
    const ry = this.fbm(t * 1.5, s + 400);
    const rz = this.fbm(t * 1.9, s + 500);

    result.translation.set(
      tx * this.maxOffset * amount,
      ty * this.maxOffset * amount,
      tz * this.maxOffset * amount,
    );
    result.rotation.set(
      rx * this.maxAngle * amount,
      ry * this.maxAngle * amount,
      rz * this.maxAngle * amount,
    );

    return result;
  }

  /** 导出为 JSON。 */
  exportJSON(): PerlinShakeJSON {
    return {
      maxOffset: this.maxOffset,
      maxAngle: this.maxAngle,
      frequency: this.frequency,
      decay: this.decay,
      octaves: this.octaves,
      persistence: this.persistence,
      lacunarity: this.lacunarity,
      seed: this.seed,
      trauma: this.trauma,
    };
  }

  /** 从 JSON 导入。 */
  importJSON(data: PerlinShakeJSON): this {
    this.maxOffset = data.maxOffset;
    this.maxAngle = data.maxAngle;
    this.frequency = data.frequency;
    this.decay = data.decay;
    this.octaves = data.octaves;
    this.persistence = data.persistence;
    this.lacunarity = data.lacunarity;
    this.seed = data.seed;
    this.trauma = data.trauma;
    return this;
  }

  // ── 内部实现 ────────────────────────────────────────────────────────

  /** 多倍频 Perlin 采样(返回约 [-1, 1])。 */
  private fbm(t: number, phase: number): number {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    for (let i = 0; i < this.octaves; i++) {
      // 用 1D 噪声切片:t 作为 x,phase 作为 y(提供相位偏移)
      total += this.noise.noise(t * frequency, phase, 0) * amplitude;
      maxValue += amplitude;
      amplitude *= this.persistence;
      frequency *= this.lacunarity;
    }
    return maxValue > 0 ? total / maxValue : 0;
  }
}

/**
 * 便捷工厂:创建适合不同场景的预设震动配置。
 */
export const PerlinShakePresets = {
  /** 轻微手持风格(纪录片/第一人称探索)。 */
  handheld(): PerlinShake {
    const s = new PerlinShake(Math.random() * 1000);
    s.maxOffset = 0.05;
    s.maxAngle = 0.005;
    s.frequency = 0.8;
    s.decay = 0.5; // 持续较久
    s.octaves = 2;
    s.trauma = 1.0; // 持续生效(由调用方在不需要时 reset)
    return s;
  },

  /** 战斗后坐力(每次开火触发)。 */
  recoil(): PerlinShake {
    const s = new PerlinShake(Math.random() * 1000);
    s.maxOffset = 0.02;
    s.maxAngle = 0.03;
    s.frequency = 8.0;
    s.decay = 4.0; // 快速衰减
    s.octaves = 2;
    return s;
  },

  /** 中等爆炸(近距但非致命)。 */
  explosion(): PerlinShake {
    const s = new PerlinShake(Math.random() * 1000);
    s.maxOffset = 0.4;
    s.maxAngle = 0.08;
    s.frequency = 2.5;
    s.decay = 1.2;
    s.octaves = 4;
    return s;
  },

  /** 重击/碰撞(载具撞击、坠落)。 */
  impact(): PerlinShake {
    const s = new PerlinShake(Math.random() * 1000);
    s.maxOffset = 0.3;
    s.maxAngle = 0.06;
    s.frequency = 5.0;
    s.decay = 2.5;
    s.octaves = 3;
    return s;
  },

  /** 地震/环境震感(持续低频晃动)。 */
  earthquake(): PerlinShake {
    const s = new PerlinShake(Math.random() * 1000);
    s.maxOffset = 0.15;
    s.maxAngle = 0.02;
    s.frequency = 0.6;
    s.decay = 0.3; // 缓慢衰减
    s.octaves = 3;
    return s;
  },
} as const;
