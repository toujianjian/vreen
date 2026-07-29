// CinematicCamera — 电影级摄像机系统(多机位/镜头切换/平滑过渡/景深控制)。
//
// 设计:
//   * 持有 PerspectiveCamera 实例,按镜头序列(shots)驱动其位置/朝向/FOV
//   * 镜头切换支持四种过渡类型:
//       - cut    : 硬切(瞬间切换)
//       - fade   : 淡入淡出(通过位置线性插值模拟,renderer 层可叠加 alpha)
//       - dolly  : 推拉(平滑插值,smoothstep 缓动)
//       - orbit  : 轨道(切换期间绕 lookAt 旋转半圈)
//   * 过渡发生在镜头开头 transitionDuration 秒内,剩余时间为稳定镜头
//   * 景深(DOF):dofEnabled + focusDistance + aperture + focalLength,
//     由调用方(渲染器/后处理 DOF Pass)读取这些字段配置实际模糊
//   * 镜头震动(shake):叠加 Perlin 风格噪声到位置与朝向,衰减时长由 shakeDuration 控制
//   * 时间线导出/导入:往返 JSON,便于存档与编辑器联动
//
// 与 CameraRig 的关系:
//   * CinematicCamera 关注「镜头序列叙事」(预定机位 + 时间)
//   * CameraRig 关注「实时跟随目标」(crane/dolly/orbit 跟随 Object3D)
//   * 二者可组合:Rig 跟随主角,Cinematic 取 Rig 的相机做镜头切换

import { Vector3 } from '../Math';
import { PerspectiveCamera } from './PerspectiveCamera';

/** 镜头过渡类型。 */
export type ShotTransitionType = 'cut' | 'fade' | 'dolly' | 'orbit';

/** 单个镜头描述。 */
export interface CameraShot {
  /** 镜头名称(便于编辑器展示与序列化)。 */
  name: string;
  /** 摄像机位置(世界坐标)。 */
  position: Vector3;
  /** 摄像机注视点(世界坐标)。 */
  lookAt: Vector3;
  /** 视场角(度)。 */
  fov: number;
  /** 镜头持续时间(秒)。 */
  duration: number;
  /** 进入此镜头时的过渡类型。 */
  transitionType: ShotTransitionType;
}

/** 时间线序列化结构(往返 JSON)。 */
export interface CameraTimelineJSON {
  shots: Array<{
    name: string;
    position: [number, number, number];
    lookAt: [number, number, number];
    fov: number;
    duration: number;
    transitionType: ShotTransitionType;
  }>;
  transitionDuration: number;
  dofEnabled: boolean;
  focusDistance: number;
  aperture: number;
  focalLength: number;
}

/** 当前镜头运行时信息(供 UI / HUD 显示)。 */
export interface ShotInfo {
  /** 当前镜头在 shots 中的索引。 */
  index: number;
  /** 镜头名称。 */
  name: string;
  /** 当前镜头已播放时间(秒)。 */
  elapsed: number;
  /** 镜头总时长(秒)。 */
  duration: number;
  /** 当前过渡进度 [0,1](1 表示过渡完成,处于稳定阶段)。 */
  transitionProgress: number;
  /** 是否正在播放序列。 */
  playing: boolean;
  /** 是否处于过渡阶段。 */
  inTransition: boolean;
}

// 复用临时向量,避免 update 内每帧分配
const _desiredPos = new Vector3();
const _desiredLook = new Vector3();
const _prevPos = new Vector3();
const _prevLook = new Vector3();
const _shakeOffset = new Vector3();
const _orbitOffset = new Vector3();
const _diff = new Vector3();

/** 平滑插值(smoothstep):t∈[0,1] → [0,1] 平滑曲线。 */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * 电影级摄像机系统 — 镜头序列驱动 PerspectiveCamera。
 *
 * 用法:
 *   const cine = new CinematicCamera();
 *   cine.addShot({ name: 'A', position: new Vector3(0,5,10), lookAt: new Vector3(),
 *                  fov: 50, duration: 3, transitionType: 'cut' });
 *   cine.play();
 *   // 每帧:
 *   cine.update(dt);
 *   renderer.render(scene, cine.camera);
 */
export class CinematicCamera {
  /** 被驱动的透视相机。 */
  camera: PerspectiveCamera;
  /** 镜头序列。 */
  shots: CameraShot[] = [];
  /** 当前镜头索引。 */
  currentShot: number = 0;
  /** 当前镜头已播放时间(秒)。 */
  shotTime: number = 0;
  /** 过渡时长(秒,所有镜头共享,可按需改为 per-shot)。 */
  transitionDuration: number = 0.5;
  /** 是否启用景深。 */
  dofEnabled: boolean = false;
  /** 对焦距离(世界单位)。 */
  focusDistance: number = 10;
  /** 光圈(f 值,越小越虚化)。 */
  aperture: number = 2.8;
  /** 焦距(mm,影响 FOV 换算与景深)。 */
  focalLength: number = 50;
  /** 震动幅度(米)。 */
  shakeAmount: number = 0;
  /** 震动频率(Hz)。 */
  shakeFrequency: number = 5;

  /** 是否正在播放。 */
  private playing: boolean = false;
  /** 上一镜头索引(过渡起点,-1 表示无)。 */
  private _prevShotIndex: number = -1;
  /** 当前震动剩余时长(秒)。 */
  private shakeRemaining: number = 0;
  /** 当前震动初始幅度(用于衰减)。 */
  private shakeInitial: number = 0;
  /** 当前震动初始总时长(秒,用于线性衰减比例计算)。 */
  private shakeDurationInitial: number = 0;
  /** 震动相位(随时间推进)。 */
  private shakePhase: number = 0;
  /** 镜头循环(true 时到达末尾回到开头)。 */
  loop: boolean = false;

  constructor(camera?: PerspectiveCamera) {
    this.camera = camera ?? new PerspectiveCamera(50, 1, 0.1, 1000);
  }

  /** 添加镜头到序列末尾。 */
  addShot(shot: CameraShot): this {
    this.shots.push(shot);
    return this;
  }

  /** 移除指定索引的镜头(越界返回 false)。 */
  removeShot(index: number): boolean {
    if (index < 0 || index >= this.shots.length) return false;
    this.shots.splice(index, 1);
    if (this.currentShot >= this.shots.length) {
      this.currentShot = Math.max(0, this.shots.length - 1);
    }
    if (this._prevShotIndex >= this.shots.length) this._prevShotIndex = -1;
    return true;
  }

  /** 开始播放镜头序列(从当前 currentShot 开始)。 */
  play(): this {
    if (this.shots.length === 0) return this;
    this.playing = true;
    this.shotTime = 0;
    this._prevShotIndex = -1;
    this.applyShotImmediate(this.currentShot);
    return this;
  }

  /** 停止播放(保持当前帧)。 */
  stop(): this {
    this.playing = false;
    return this;
  }

  /** 跳到下一个镜头(循环时回到开头)。返回新索引,-1 表示空序列。 */
  nextShot(): number {
    if (this.shots.length === 0) return -1;
    this._prevShotIndex = this.currentShot;
    this.currentShot = (this.currentShot + 1) % this.shots.length;
    this.shotTime = 0;
    this.beginTransition();
    return this.currentShot;
  }

  /** 跳到上一个镜头(循环时回到末尾)。返回新索引。 */
  prevShot(): number {
    if (this.shots.length === 0) return -1;
    this._prevShotIndex = this.currentShot;
    this.currentShot = (this.currentShot - 1 + this.shots.length) % this.shots.length;
    this.shotTime = 0;
    this.beginTransition();
    return this.currentShot;
  }

  /** 直接跳转到指定索引的镜头。 */
  seekShot(index: number): boolean {
    if (index < 0 || index >= this.shots.length) return false;
    if (index === this.currentShot) return true;
    this._prevShotIndex = this.currentShot;
    this.currentShot = index;
    this.shotTime = 0;
    this.beginTransition();
    return true;
  }

  /** 触发震动效果(覆盖当前震动)。
   *  amount: 初始幅度(米);duration: 持续时长(秒,衰减到 0)。 */
  shake(amount: number, duration: number): this {
    this.shakeAmount = amount;
    this.shakeInitial = amount;
    this.shakeDurationInitial = Math.max(duration, 1e-6);
    this.shakeRemaining = duration;
    this.shakePhase = Math.random() * Math.PI * 2;
    return this;
  }

  /** 设置景深参数。 */
  setDOF(enabled: boolean, focus: number = this.focusDistance, aperture: number = this.aperture): this {
    this.dofEnabled = enabled;
    this.focusDistance = focus;
    this.aperture = aperture;
    return this;
  }

  /**
   * 每帧更新 — 推进镜头时间,执行过渡插值与震动叠加,写入 camera。
   *  dt: 帧时间(秒)。
   */
  update(dt: number): this {
    if (this.shots.length === 0) return this;

    if (this.playing) {
      this.shotTime += dt;
      const shot = this.shots[this.currentShot];
      // 镜头时长到 → 切到下一镜头
      if (this.shotTime >= shot.duration) {
        if (this.currentShot + 1 < this.shots.length) {
          this.nextShot();
        } else if (this.loop) {
          this.nextShot();
        } else {
          this.playing = false;
        }
      }
    }

    this.applyCurrentShot(dt);
    return this;
  }

  /** 获取当前镜头运行时信息。 */
  getShotInfo(): ShotInfo {
    const shot = this.shots[this.currentShot];
    const duration = shot ? shot.duration : 0;
    const transitionProgress = this.transitionDuration > 0
      ? Math.min(1, this.shotTime / this.transitionDuration)
      : 1;
    return {
      index: this.currentShot,
      name: shot ? shot.name : '',
      elapsed: this.shotTime,
      duration,
      transitionProgress,
      playing: this.playing,
      inTransition: this._prevShotIndex !== -1 && this.shotTime < this.transitionDuration,
    };
  }

  /** 导出时间线为 JSON(可序列化)。 */
  exportTimeline(): CameraTimelineJSON {
    return {
      shots: this.shots.map((s) => ({
        name: s.name,
        position: s.position.toArray(),
        lookAt: s.lookAt.toArray(),
        fov: s.fov,
        duration: s.duration,
        transitionType: s.transitionType,
      })),
      transitionDuration: this.transitionDuration,
      dofEnabled: this.dofEnabled,
      focusDistance: this.focusDistance,
      aperture: this.aperture,
      focalLength: this.focalLength,
    };
  }

  /** 从 JSON 导入时间线(替换现有 shots)。 */
  importTimeline(data: CameraTimelineJSON): this {
    this.shots = data.shots.map((s) => ({
      name: s.name,
      position: new Vector3(s.position[0], s.position[1], s.position[2]),
      lookAt: new Vector3(s.lookAt[0], s.lookAt[1], s.lookAt[2]),
      fov: s.fov,
      duration: s.duration,
      transitionType: s.transitionType,
    }));
    this.transitionDuration = data.transitionDuration;
    this.dofEnabled = data.dofEnabled;
    this.focusDistance = data.focusDistance;
    this.aperture = data.aperture;
    this.focalLength = data.focalLength;
    this.currentShot = 0;
    this.shotTime = 0;
    this._prevShotIndex = -1;
    this.playing = false;
    return this;
  }

  // ── 内部实现 ────────────────────────────────────────────────────────

  /** 立即应用镜头(无过渡,用于 play/seekShot 切换)。 */
  private applyShotImmediate(index: number): void {
    const shot = this.shots[index];
    if (!shot) return;
    this.camera.position.copy(shot.position);
    this.camera.lookAt(shot.lookAt.x, shot.lookAt.y, shot.lookAt.z);
    if (this.camera.fov !== shot.fov) {
      this.camera.fov = shot.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** 标记开始过渡(记录前一镜头位置供插值)。 */
  private beginTransition(): void {
    // 若过渡类型为 cut,直接应用;否则保留 prevShot 供 update 插值
    const shot = this.shots[this.currentShot];
    if (!shot) return;
    if (shot.transitionType === 'cut' || this.transitionDuration <= 0) {
      this.applyShotImmediate(this.currentShot);
      this._prevShotIndex = -1;
    }
  }

  /** 应用当前镜头(含过渡 + 震动)。 */
  private applyCurrentShot(dt: number): void {
    const shot = this.shots[this.currentShot];
    if (!shot) return;

    // 震动相位推进 + 线性衰减
    if (this.shakeRemaining > 0) {
      this.shakeRemaining -= dt;
      this.shakePhase += dt * this.shakeFrequency * Math.PI * 2;
      if (this.shakeRemaining <= 0) {
        this.shakeAmount = 0;
        this.shakeRemaining = 0;
      }
    }

    // 计算目标位置/朝向
    if (this._prevShotIndex !== -1 && this.shotTime < this.transitionDuration && this.transitionDuration > 0) {
      const prev = this.shots[this._prevShotIndex];
      if (prev) {
        const t = this.shotTime / this.transitionDuration;
        this.computeTransition(prev, shot, t, _desiredPos, _desiredLook);
      } else {
        _desiredPos.copy(shot.position);
        _desiredLook.copy(shot.lookAt);
      }
      if (this.shotTime >= this.transitionDuration) {
        this._prevShotIndex = -1;
      }
    } else {
      _desiredPos.copy(shot.position);
      _desiredLook.copy(shot.lookAt);
      this._prevShotIndex = -1;
    }

    // 应用震动偏移(线性衰减:剩余时长 / 初始时长)
    if (this.shakeInitial > 0 && this.shakeRemaining > 0) {
      const currentAmplitude = this.shakeInitial * (this.shakeRemaining / this.shakeDurationInitial);
      _shakeOffset.set(
        Math.sin(this.shakePhase) * currentAmplitude,
        Math.sin(this.shakePhase * 1.3 + 1.1) * currentAmplitude * 0.7,
        Math.cos(this.shakePhase * 0.9) * currentAmplitude,
      );
      _desiredPos.add(_shakeOffset);
    }

    // 应用到相机
    this.camera.position.copy(_desiredPos);
    this.camera.lookAt(_desiredLook.x, _desiredLook.y, _desiredLook.z);

    // FOV 过渡(cut 之外的过渡都做 FOV 插值)
    if (this._prevShotIndex !== -1 && this.shotTime < this.transitionDuration && this.transitionDuration > 0) {
      const prev = this.shots[this._prevShotIndex];
      if (prev) {
        const t = smoothstep(this.shotTime / this.transitionDuration);
        const fov = prev.fov + (shot.fov - prev.fov) * t;
        if (Math.abs(this.camera.fov - fov) > 1e-4) {
          this.camera.fov = fov;
          this.camera.updateProjectionMatrix();
        }
      }
    } else if (this.camera.fov !== shot.fov) {
      this.camera.fov = shot.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** 计算过渡中的位置与朝向(按 transitionType 分派)。 */
  private computeTransition(
    prev: CameraShot,
    cur: CameraShot,
    t: number,
    outPos: Vector3,
    outLook: Vector3,
  ): void {
    _prevPos.copy(prev.position);
    _prevLook.copy(prev.lookAt);
    const targetPos = cur.position;
    const targetLook = cur.lookAt;

    switch (cur.transitionType) {
      case 'cut':
        outPos.copy(targetPos);
        outLook.copy(targetLook);
        break;
      case 'fade':
        // 线性插值位置与朝向(配合 renderer alpha 叠加黑场)
        outPos.lerpVectors(_prevPos, targetPos, t);
        outLook.lerpVectors(_prevLook, targetLook, t);
        break;
      case 'dolly':
        // smoothstep 缓动推拉
        outPos.lerpVectors(_prevPos, targetPos, smoothstep(t));
        outLook.lerpVectors(_prevLook, targetLook, smoothstep(t));
        break;
      case 'orbit': {
        // 绕起点 lookAt 做轨道旋转,从 prevPos 圆弧过渡到 targetPos 方向。
        // 旋转量 = 起止偏航角之差(取最短弧);半径取起点偏移长度。
        // 此实现保证过渡期间相机始终在圆弧上(半径恒定),t=1 时方向对齐 targetPos。
        const startOffset = _orbitOffset.subVectors(_prevPos, _prevLook);
        const radius = startOffset.length();
        const startAngle = Math.atan2(startOffset.x, startOffset.z);
        // 终点相对 prevLook 的偏航角(若 targetPos 与 prevLook 重合则保持 startAngle)
        const endOffset = _diff.subVectors(targetPos, _prevLook);
        const endAngle = endOffset.lengthSq() > 1e-6
          ? Math.atan2(endOffset.x, endOffset.z)
          : startAngle;
        // 取最短弧(差值归一到 [-π, π])
        let delta = endAngle - startAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const newAngle = startAngle + delta * smoothstep(t);
        const newY = _prevLook.y + (targetLook.y - _prevLook.y) * smoothstep(t);
        outPos.set(
          _prevLook.x + Math.sin(newAngle) * radius,
          newY,
          _prevLook.z + Math.cos(newAngle) * radius,
        );
        outLook.lerpVectors(_prevLook, targetLook, smoothstep(t));
        break;
      }
      default:
        outPos.lerpVectors(_prevPos, targetPos, t);
        outLook.lerpVectors(_prevLook, targetLook, t);
    }
  }
}
