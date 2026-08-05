// CameraBob — 行走/奔跑时的相机头部摆动(第一/第三人称 game feel 核心)。
//
// 设计来源:
//   * UE PlayerCameraManager::ApplyCameraBob —— 标准相机摆动框架
//   * Unity 社区 Head Bob 脚本 —— 常见 FPS 头部摆动实现
//   * o3de AzFramework Camera Bob Component —— 编辑器可配置的摆动组件
//   * GDC 2020 "Game Feel in Half-Life: Alyx" —— 摆动幅度与速度的非线性映射
//
// 与 PerlinShake 的关系:
//   * PerlinShake 是「随机、冲击性」震动(爆炸/碰撞)—— trauma² 衰减。
//   * CameraBob 是「周期性、确定性」摆动(行走/奔跑)—— 速度驱动、正弦曲线。
//   * 二者可叠加:CameraBob 提供基础行走节奏,PerlinShake 叠加冲击反馈。
//
// 算法:
//   bobPhase += dt * speed * bobFrequency * 2π
//   speedFactor = clamp(speed / maxSpeed, 0, 1) * crouchScale
//   bobY  = sin(bobPhase)         * bobAmount      * speedFactor
//   swayX = cos(bobPhase * 0.5)   * swayAmount     * speedFactor  // 半频,90° 相位差
//   roll  = sin(bobPhase * 0.5)   * rotationAmount * speedFactor
//   footstep = max(0, sin(bobPhase)) ^ 6 * footstepAmount * speedFactor  // 每步着地冲击
//
// 关键性质:
//   * 速度依赖:静止时 speedFactor=0,无摆动;移动时与速度成正比
//   * bobY 与 swayX 频率比为 2:1 —— 模拟双腿交替(每步一个 bob 峰,一个 sway 周期)
//   * footstep 使用 sin^6 —— 产生尖锐的着地冲击尖峰(非平滑正弦)
//   * 潜行模式:crouchScale 降低幅度,不改变频率(步频不变,步幅变小)
//   * 帧率无关:phase 推进基于 dt,与帧率无关
//   * 可叠加:输出为 translation + rotation 偏移,调用方叠加到相机

import { Vector3 } from '../Math';

/** CameraBob 输出偏移。 */
export interface CameraBobOffset {
  /** 平移偏移(相机本地空间,米)。x=左右 sway, y=上下 bob, z=前后(着地冲击)。 */
  translation: Vector3;
  /** 旋转偏移(弧度)。x=pitch(着地低头), y=yaw(左右摆), z=roll(侧倾)。 */
  rotation: Vector3;
  /** 当前速度因子 [0,1](可供 UI / 调试显示)。 */
  speedFactor: number;
  /** 当前是否在着地冲击相位(footstep > threshold)。 */
  isFootstep: boolean;
}

/** 序列化结构。 */
export interface CameraBobJSON {
  bobFrequency: number;
  bobAmount: number;
  swayAmount: number;
  footstepAmount: number;
  rotationAmount: number;
  maxSpeed: number;
  crouchScale: number;
  phase: number;
}

/**
 * 行走/奔跑相机头部摆动。
 *
 * 用法:
 *   const bob = new CameraBob();
 *   bob.maxSpeed = 5; // 角色最大行走速度(m/s)
 *
 *   // 每帧:
 *   const speed = playerVelocity.length();
 *   bob.update(dt, speed, isCrouching);
 *   const offset = bob.getOffset();
 *   camera.position.add(offset.translation);
 *   // rotation 叠加到 camera quaternion
 *
 * 与 PerlinShake 叠加:
 *   bob.update(dt, speed, crouching);
 *   shake.update(dt);
 *   camera.position.add(bob.getOffset().translation);
 *   camera.position.add(shake.getOffset().translation);
 */
export class CameraBob {
  /** 步频(Hz,每秒步数 / 2)。默认 0.5(每秒1步 = 每秒0.5个完整摆动周期)。 */
  bobFrequency: number = 0.5;
  /** 上下摆动幅度(米)。默认 0.05。 */
  bobAmount: number = 0.05;
  /** 左右摇摆幅度(米)。默认 0.03。 */
  swayAmount: number = 0.03;
  /** 着地冲击幅度(米,向下)。默认 0.02。 */
  footstepAmount: number = 0.02;
  /** 旋转摆动幅度(弧度,roll)。默认 0.01。 */
  rotationAmount: number = 0.01;
  /** 最大行走速度(m/s),用于归一化 speedFactor。默认 5。 */
  maxSpeed: number = 5;
  /** 潜行时的幅度缩放(0-1)。默认 0.4。 */
  crouchScale: number = 0.4;

  /** 当前相位(弧度,内部累积)。 */
  phase: number = 0;

  /** 着地检测阈值(sin^6 超过此值视为着地)。 */
  footstepThreshold: number = 0.5;

  /** 平滑后的速度因子(避免速度突变导致摆动跳变)。 */
  private smoothedSpeedFactor: number = 0;

  /**
   * 每帧更新 — 推进相位 + 计算速度因子。
   *  dt: 帧时间(秒)。
   *  speed: 当前水平速度(m/s,通常为 velocity.length() 或 velocity.xz.length())。
   *  crouching: 是否潜行。
   */
  update(dt: number, speed: number, crouching: boolean = false): this {
    // ── 1. 计算速度因子 ──────────────────────────────────────────────
    const rawFactor = this.maxSpeed > 0 ? Math.min(1, speed / this.maxSpeed) : 0;
    const crouchMult = crouching ? this.crouchScale : 1;
    const targetFactor = rawFactor * crouchMult;

    // 指数平滑速度因子(避免速度突变导致摆动幅度跳变)
    // alpha = 1 - exp(-rate * dt * 60),与 SpringArm 一致的帧率无关平滑
    const smoothAlpha = dt > 0 ? 1 - Math.exp(-8 * dt * 60 / 60) : 0;
    this.smoothedSpeedFactor += (targetFactor - this.smoothedSpeedFactor) * smoothAlpha;

    // ── 2. 推进相位(仅在有速度时推进,避免静止时持续摆动)─────────
    // 相位推进速度 = speed * frequency * 2π
    // 这样高速时步频加快(跑步比走路步频高)
    this.phase += dt * speed * this.bobFrequency * Math.PI * 2;

    return this;
  }

  /**
   * 计算当前摆动偏移。
   *  out: 可选复用对象。
   *
   * 返回的 translation 单位为米,rotation 单位为弧度,
   * 调用方应将其叠加到相机本地空间位置/姿态上。
   */
  getOffset(out?: CameraBobOffset): CameraBobOffset {
    const result: CameraBobOffset = out ?? {
      translation: new Vector3(),
      rotation: new Vector3(),
      speedFactor: 0,
      isFootstep: false,
    };

    const sf = this.smoothedSpeedFactor;
    result.speedFactor = sf;

    if (sf <= 0.0001) {
      result.translation.set(0, 0, 0);
      result.rotation.set(0, 0, 0);
      result.isFootstep = false;
      return result;
    }

    // ── 核心摆动公式 ─────────────────────────────────────────────────
    // bobY: sin(phase) —— 上下摆动,每步一个峰
    // swayX: cos(phase * 0.5) —— 左右摇摆,半频(每两步一个完整周期)
    //   这模拟双腿交替:左脚落地时 bob 在谷,右脚落地时 bob 在峰
    //   sway 在两步之间完成一个周期
    const sinPhase = Math.sin(this.phase);
    const cosHalfPhase = Math.cos(this.phase * 0.5);

    const bobY = sinPhase * this.bobAmount * sf;
    const swayX = cosHalfPhase * this.swayAmount * sf;
    const roll = cosHalfPhase * this.rotationAmount * sf;

    // ── 着地冲击 ─────────────────────────────────────────────────────
    // sin^6 产生尖锐尖峰:大部分时间为 0,仅在 sin > 0 的峰值附近突起
    // 这模拟每步着地时的向下冲击 + 低头
    const footstepRaw = Math.max(0, sinPhase);
    const footstep = Math.pow(footstepRaw, 6) * this.footstepAmount * sf;
    const pitchDown = footstep * 0.5; // 着地时低头

    result.translation.set(swayX, bobY - footstep, 0);
    result.rotation.set(pitchDown, swayX * 0.3, roll);
    result.isFootstep = footstep > this.footstepThreshold * this.footstepAmount * sf;

    return result;
  }

  /** 立即清零状态(用于传送/重生后避免摆动残留)。 */
  reset(): this {
    this.phase = 0;
    this.smoothedSpeedFactor = 0;
    return this;
  }

  /** 导出为 JSON。 */
  exportJSON(): CameraBobJSON {
    return {
      bobFrequency: this.bobFrequency,
      bobAmount: this.bobAmount,
      swayAmount: this.swayAmount,
      footstepAmount: this.footstepAmount,
      rotationAmount: this.rotationAmount,
      maxSpeed: this.maxSpeed,
      crouchScale: this.crouchScale,
      phase: this.phase,
    };
  }

  /** 从 JSON 导入。 */
  importJSON(data: CameraBobJSON): this {
    this.bobFrequency = data.bobFrequency;
    this.bobAmount = data.bobAmount;
    this.swayAmount = data.swayAmount;
    this.footstepAmount = data.footstepAmount;
    this.rotationAmount = data.rotationAmount;
    this.maxSpeed = data.maxSpeed;
    this.crouchScale = data.crouchScale;
    this.phase = data.phase;
    return this;
  }
}

/**
 * 便捷工厂:创建常见相机摆动配置。
 */
export const CameraBobPresets = {
  /** 标准第一人称行走(中等频率,小幅度)。 */
  fpsWalk(): CameraBob {
    const bob = new CameraBob();
    bob.bobFrequency = 0.5;
    bob.bobAmount = 0.05;
    bob.swayAmount = 0.03;
    bob.footstepAmount = 0.02;
    bob.rotationAmount = 0.01;
    bob.maxSpeed = 5;
    bob.crouchScale = 0.4;
    return bob;
  },

  /** 奔跑(高频,大幅度,更明显的着地冲击)。 */
  fpsRun(): CameraBob {
    const bob = new CameraBob();
    bob.bobFrequency = 0.7;
    bob.bobAmount = 0.08;
    bob.swayAmount = 0.05;
    bob.footstepAmount = 0.04;
    bob.rotationAmount = 0.02;
    bob.maxSpeed = 8;
    bob.crouchScale = 0.4;
    return bob;
  },

  /** 潜行(低频,极小幅度)。 */
  fpsCrouch(): CameraBob {
    const bob = new CameraBob();
    bob.bobFrequency = 0.4;
    bob.bobAmount = 0.02;
    bob.swayAmount = 0.01;
    bob.footstepAmount = 0.005;
    bob.rotationAmount = 0.005;
    bob.maxSpeed = 2.5;
    bob.crouchScale = 0.5;
    return bob;
  },

  /** 第三人称(较小幅度,因为相机更远,大摆动会显得不自然)。 */
  tpsWalk(): CameraBob {
    const bob = new CameraBob();
    bob.bobFrequency = 0.5;
    bob.bobAmount = 0.03;
    bob.swayAmount = 0.02;
    bob.footstepAmount = 0.01;
    bob.rotationAmount = 0.005;
    bob.maxSpeed = 5;
    bob.crouchScale = 0.5;
    return bob;
  },

  /** 观察者/飞行模式(极小摆动,仅保留速度感)。 */
  spectator(): CameraBob {
    const bob = new CameraBob();
    bob.bobFrequency = 0.3;
    bob.bobAmount = 0.01;
    bob.swayAmount = 0.005;
    bob.footstepAmount = 0;
    bob.rotationAmount = 0.003;
    bob.maxSpeed = 10;
    bob.crouchScale = 1;
    return bob;
  },
} as const;
