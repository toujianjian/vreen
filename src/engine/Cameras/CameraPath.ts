// CameraPath — Catmull-Rom 样条关键帧路径动画(电影级飞掠/环绕/过场)。
//
// 设计来源:
//   * o3de Track View / Sequence Cinematics —— 时间轴驱动的关键帧相机
//   * Unity Timeline Cinemachine Path —— 平滑样条 + 自动朝向
//   * three.js CatmullRomCurve3 —— 数学原语
//
// 与 CinematicCamera 的关系:
//   * CinematicCamera 持有离散镜头序列(cut/fade/dolly/orbit 切换),
//     每个镜头是一个「稳态机位」;适合叙事分镜。
//   * CameraPath 持有连续关键帧样条(position/lookAt/fov/roll 随时间平滑插值),
//     适合飞掠、环绕、推拉一气呵成的运动镜头。
//   * 二者可组合:CameraPath 输出 CameraPose,作为 CinematicCamera 的「虚拟镜头源」,
//     或由 WebGL2Renderer 直接读取驱动 PerspectiveCamera。
//
// 算法:
//   * 位置与朝向:Catmull-Rom 样条插值(支持 uniform / centripetal 参数化)
//     - centripetal (alpha=0.5) 避免尖点与自相交,适合相机路径
//   * FOV / Roll:线性插值(避免样条过冲导致畸变)
//   * 时间映射:关键帧时间戳非均匀分布时,先在时间轴上定位段,再归一化到 [0,1]
//   * 循环模式:once / loop / pingpong
//   * 速度缓动:可选 easing 函数作用于归一化段内进度,实现「慢入慢出」

import { Vector3 } from '../Math';
import { ImprovedNoise } from '../Math';

/** 关键帧相机位姿。 */
export interface CameraPathKeyframe {
  /** 关键帧时间戳(秒,从路径起点起,非递减)。 */
  time: number;
  /** 相机位置(世界坐标)。 */
  position: Vector3;
  /** 相机注视点(世界坐标)。 */
  lookAt: Vector3;
  /** 视场角(度)。 */
  fov: number;
  /** 相机横滚角(度,正值顺时针)。0 = 水平。 */
  roll: number;
}

/** 路径采样结果(运行时传递给相机)。 */
export interface CameraPose {
  /** 位置(世界坐标)。 */
  position: Vector3;
  /** 注视点(世界坐标)。 */
  lookAt: Vector3;
  /** 视场角(度)。 */
  fov: number;
  /** 横滚角(度)。 */
  roll: number;
}

/** 循环模式。 */
export type PathLoopMode = 'once' | 'loop' | 'pingpong';

/** Catmull-Rom 参数化类型。 */
export type SplineParametrization = 'uniform' | 'centripetal';

/** 缓动函数(t∈[0,1] → [0,1])。 */
export type EasingFn = (t: number) => number;

/** 序列化结构(往返 JSON)。 */
export interface CameraPathJSON {
  keyframes: Array<{
    time: number;
    position: [number, number, number];
    lookAt: [number, number, number];
    fov: number;
    roll: number;
  }>;
  loopMode: PathLoopMode;
  parametrization: SplineParametrization;
  duration: number;
}

// 复用临时向量,避免采样内部分配
const _p0 = new Vector3();
const _p1 = new Vector3();
const _p2 = new Vector3();
const _p3 = new Vector3();
const _tangent = new Vector3();

/** 默认缓动:线性。 */
const identityEasing: EasingFn = (t) => t;

/** smoothstep 缓动。 */
export const smoothstepEasing: EasingFn = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** ease-in-out(三次)。 */
export const easeInOutCubic: EasingFn = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/**
 * Catmull-Rom 样条关键帧相机路径。
 *
 * 用法:
 *   const path = new CameraPath();
 *   path.addKeyframe({ time: 0,   position: new Vector3(0, 5, 10), lookAt: new Vector3(), fov: 50, roll: 0 });
 *   path.addKeyframe({ time: 3,   position: new Vector3(10, 5, 0),  lookAt: new Vector3(), fov: 50, roll: 0 });
 *   path.addKeyframe({ time: 6,   position: new Vector3(0, 5, -10), lookAt: new Vector3(), fov: 60, roll: 5 });
 *   path.play();
 *   // 每帧:
 *   path.update(dt);
 *   const pose = path.sample();
 *   camera.position.copy(pose.position);
 *   camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
 *
 * 关键帧时间戳不必均匀分布:路径会按真实时间在样条上推进。
 */
export class CameraPath {
  /** 关键帧列表(按 time 升序)。 */
  keyframes: CameraPathKeyframe[] = [];
  /** 循环模式。 */
  loopMode: PathLoopMode = 'once';
  /** 样条参数化。 */
  parametrization: SplineParametrization = 'centripetal';
  /** 缓动函数(作用于段内归一化进度)。 */
  easing: EasingFn = identityEasing;
  /** 是否启用相机横滚(关闭则忽略 roll)。 */
  enableRoll: boolean = true;
  /** 自动朝向:启用后忽略关键帧 lookAt,改用路径切线方向。 */
  autoLookAlongPath: boolean = false;
  /** 自动朝向时的前向偏移距离(lookAt = position + tangent * distance)。 */
  autoLookDistance: number = 10;

  /** 当前播放时间(秒)。 */
  private currentTime: number = 0;
  /** 路径总时长(秒,等于末关键帧 time - 首关键帧 time)。 */
  private duration: number = 0;
  /** 是否正在播放。 */
  private playing: boolean = false;
  /** ping-pong 方向(+1 正向 / -1 反向)。 */
  private pingpongDir: number = 1;
  /** 上次采样的段索引(热路径优化:多数帧在同一段内推进)。 */
  private lastSegment: number = 0;
  /** 噪声扰动器(可选,用于手持风格抖动)。 */
  private noise: ImprovedNoise | null = null;
  /** 噪声幅度(米)。 */
  private noiseAmplitude: number = 0;
  /** 噪声频率(Hz)。 */
  private noiseFrequency: number = 1;
  /** 噪声相位(随时间推进)。 */
  private noisePhase: number = 0;

  /**
   * 添加关键帧。若 time < 末帧 time,会插入到正确位置以保持升序。
   * 自动重算 duration。
   */
  addKeyframe(kf: CameraPathKeyframe): this {
    this.keyframes.push({ ...kf });
    this.sortAndRecalculate();
    return this;
  }

  /** 批量设置关键帧(替换现有)。 */
  setKeyframes(kfs: CameraPathKeyframe[]): this {
    this.keyframes = kfs.map((k) => ({ ...k }));
    this.sortAndRecalculate();
    return this;
  }

  /** 移除指定索引的关键帧。 */
  removeKeyframe(index: number): boolean {
    if (index < 0 || index >= this.keyframes.length) return false;
    this.keyframes.splice(index, 1);
    this.sortAndRecalculate();
    return true;
  }

  /** 清空关键帧。 */
  clear(): this {
    this.keyframes = [];
    this.duration = 0;
    this.currentTime = 0;
    this.lastSegment = 0;
    this.playing = false;
    return this;
  }

  /** 开始播放。 */
  play(): this {
    if (this.keyframes.length === 0) return this;
    this.playing = true;
    this.currentTime = 0;
    this.pingpongDir = 1;
    this.lastSegment = 0;
    return this;
  }

  /** 暂停播放(保持当前时间)。 */
  pause(): this {
    this.playing = false;
    return this;
  }

  /** 停止并重置到起点。 */
  stop(): this {
    this.playing = false;
    this.currentTime = 0;
    this.pingpongDir = 1;
    this.lastSegment = 0;
    return this;
  }

  /** 跳转到指定时间(秒)。 */
  seek(time: number): this {
    this.currentTime = Math.max(0, Math.min(this.duration, time));
    this.lastSegment = this.findSegment(this.currentTime);
    return this;
  }

  /** 获取总时长(秒)。 */
  getDuration(): number {
    return this.duration;
  }

  /** 获取当前播放时间(秒)。 */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /** 是否正在播放。 */
  isPlaying(): boolean {
    return this.playing;
  }

  /** 获取播放进度 [0,1](ping-pong 反向时返回 0..1..0 的归一化值)。 */
  getProgress(): number {
    if (this.duration <= 0) return 0;
    return this.currentTime / this.duration;
  }

  /**
   * 启用手持风格噪声扰动(用于纪录片/手持镜头效果)。
   *  amount: 幅度(米,典型 0.05..0.3)
   *  frequency: 频率(Hz,典型 0.5..2)
   */
  enableHandheldNoise(amount: number, frequency: number = 1): this {
    this.noise = new ImprovedNoise();
    this.noiseAmplitude = Math.max(0, amount);
    this.noiseFrequency = Math.max(0.001, frequency);
    this.noisePhase = Math.random() * 1000;
    return this;
  }

  /** 关闭手持噪声。 */
  disableHandheldNoise(): this {
    this.noise = null;
    this.noiseAmplitude = 0;
    return this;
  }

  /**
   * 每帧更新 — 推进时间,处理循环。
   *  dt: 帧时间(秒)。
   */
  update(dt: number): this {
    if (!this.playing || this.duration <= 0) return this;

    this.noisePhase += dt * this.noiseFrequency;

    switch (this.loopMode) {
      case 'once':
        this.currentTime += dt * this.pingpongDir;
        if (this.currentTime >= this.duration) {
          this.currentTime = this.duration;
          this.playing = false;
        } else if (this.currentTime < 0) {
          this.currentTime = 0;
        }
        break;
      case 'loop':
        this.currentTime += dt * this.pingpongDir;
        // 模运算处理任意大的 dt(支持 dt > duration 的极端情况)
        if (this.duration > 0) {
          this.currentTime = ((this.currentTime % this.duration) + this.duration) % this.duration;
          this.lastSegment = 0;
        }
        break;
      case 'pingpong': {
        // pingpong 需要处理 dt 过冲:可能在单帧内多次反弹
        // 算法:消耗 dt 直到用完或停止
        let remaining = dt;
        const twoDuration = this.duration * 2;
        // 若 dt 极大(超过一个完整往返),先模到 [0, 2*duration]
        if (twoDuration > 0 && remaining > twoDuration) {
          remaining = remaining % twoDuration;
        }
        while (remaining > 0) {
          const step = this.pingpongDir > 0
            ? this.duration - this.currentTime      // 正向到末尾的剩余
            : this.currentTime;                      // 反向到起点的剩余
          if (remaining < step) {
            this.currentTime += remaining * this.pingpongDir;
            remaining = 0;
          } else {
            // 到达端点,反弹
            this.currentTime = this.pingpongDir > 0 ? this.duration : 0;
            this.pingpongDir = -this.pingpongDir;
            remaining -= step;
          }
        }
        break;
      }
    }
    return this;
  }

  /**
   * 在当前时间采样相机位姿。
   *  out: 可选复用的输出对象,避免分配。
   */
  sample(out?: CameraPose): CameraPose {
    const result: CameraPose = out ?? {
      position: new Vector3(),
      lookAt: new Vector3(),
      fov: 50,
      roll: 0,
    };

    if (this.keyframes.length === 0) {
      result.position.set(0, 0, 0);
      result.lookAt.set(0, 0, -1);
      result.fov = 50;
      result.roll = 0;
      return result;
    }
    if (this.keyframes.length === 1) {
      const kf = this.keyframes[0];
      result.position.copy(kf.position);
      result.lookAt.copy(kf.lookAt);
      result.fov = kf.fov;
      result.roll = kf.roll;
      return result;
    }

    // 定位段
    const seg = this.findSegment(this.currentTime);
    this.lastSegment = seg;
    const k0 = this.keyframes[seg];
    const k1 = this.keyframes[seg + 1];

    // 段内归一化进度
    const segDuration = k1.time - k0.time;
    let localT = segDuration > 0 ? (this.currentTime - k0.time) / segDuration : 0;
    localT = Math.max(0, Math.min(1, localT));
    // 缓动
    const easedT = this.easing(localT);

    // Catmull-Rom:需要前后控制点
    const kPrev = this.keyframes[Math.max(0, seg - 1)];
    const kNext = this.keyframes[Math.min(this.keyframes.length - 1, seg + 2)];

    // 位置样条
    this.catmullRom(
      kPrev.position, k0.position, k1.position, kNext.position,
      easedT, result.position,
    );

    // 朝向:样条或自动切线
    if (this.autoLookAlongPath) {
      // 切线 = 样条在 t 处的导数(中心差分)
      const eps = 1e-3;
      const tA = Math.max(0, easedT - eps);
      const tB = Math.min(1, easedT + eps);
      this.catmullRom(kPrev.position, k0.position, k1.position, kNext.position, tA, _p0);
      this.catmullRom(kPrev.position, k0.position, k1.position, kNext.position, tB, _p1);
      _tangent.subVectors(_p1, _p0).normalize();
      result.lookAt.copy(result.position).addScaledVector(_tangent, this.autoLookDistance);
    } else {
      this.catmullRom(
        kPrev.lookAt, k0.lookAt, k1.lookAt, kNext.lookAt,
        easedT, result.lookAt,
      );
    }

    // FOV / Roll 线性插值
    result.fov = k0.fov + (k1.fov - k0.fov) * localT;
    result.roll = this.enableRoll ? k0.roll + (k1.roll - k0.roll) * localT : 0;

    // 手持噪声扰动(只影响位置,不改变 lookAt 以保持注视稳定)
    if (this.noise && this.noiseAmplitude > 0) {
      const p = this.noisePhase;
      result.position.x += this.noise.noise(p, 0, 0) * this.noiseAmplitude;
      result.position.y += this.noise.noise(0, p, 0) * this.noiseAmplitude;
      result.position.z += this.noise.noise(0, 0, p) * this.noiseAmplitude;
    }

    return result;
  }

  /** 导出为 JSON。 */
  exportJSON(): CameraPathJSON {
    return {
      keyframes: this.keyframes.map((k) => ({
        time: k.time,
        position: k.position.toArray(),
        lookAt: k.lookAt.toArray(),
        fov: k.fov,
        roll: k.roll,
      })),
      loopMode: this.loopMode,
      parametrization: this.parametrization,
      duration: this.duration,
    };
  }

  /** 从 JSON 导入(替换现有关键帧)。 */
  importJSON(data: CameraPathJSON): this {
    this.keyframes = data.keyframes.map((k) => ({
      time: k.time,
      position: new Vector3(k.position[0], k.position[1], k.position[2]),
      lookAt: new Vector3(k.lookAt[0], k.lookAt[1], k.lookAt[2]),
      fov: k.fov,
      roll: k.roll,
    }));
    this.loopMode = data.loopMode;
    this.parametrization = data.parametrization;
    this.duration = data.duration;
    this.currentTime = 0;
    this.lastSegment = 0;
    this.playing = false;
    this.pingpongDir = 1;
    return this;
  }

  // ── 内部实现 ────────────────────────────────────────────────────────

  /** 排序关键帧并重算 duration。 */
  private sortAndRecalculate(): void {
    this.keyframes.sort((a, b) => a.time - b.time);
    if (this.keyframes.length >= 2) {
      this.duration = this.keyframes[this.keyframes.length - 1].time - this.keyframes[0].time;
    } else {
      this.duration = 0;
    }
    this.lastSegment = 0;
  }

  /** 二分查找当前时间所属的段索引 [0, n-2]。 */
  private findSegment(time: number): number {
    const n = this.keyframes.length;
    if (n < 2) return 0;
    // 热路径优化:多数帧在同一段或下一段
    if (this.lastSegment >= 0 && this.lastSegment < n - 1) {
      const k = this.keyframes[this.lastSegment];
      const kNext = this.keyframes[this.lastSegment + 1];
      if (time >= k.time && time <= kNext.time) return this.lastSegment;
      if (this.lastSegment + 1 < n - 1) {
        const k2 = this.keyframes[this.lastSegment + 1];
        const k2Next = this.keyframes[this.lastSegment + 2];
        if (time >= k2.time && time <= k2Next.time) {
          this.lastSegment++;
          return this.lastSegment;
        }
      }
    }
    // 二分回退
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (time < this.keyframes[mid].time) {
        hi = mid - 1;
      } else if (time > this.keyframes[mid + 1].time) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return Math.max(0, Math.min(n - 2, lo));
  }

  /**
   * Catmull-Rom 样条插值(支持 uniform / centripetal 参数化)。
   *
   * 数学:
   *   alpha=0   (uniform)     : 经典 CR,可能产生尖点
   *   alpha=0.5 (centripetal) : 无尖点无自相交,适合相机路径
   *
   * 实现:先用相邻点距离计算节点参数 t_i,再在 [t_i, t_{i+1}] 内
   * 反求局部 u ∈ [0,1],最后套用 CR 三次多项式。
   *
   * @param p0 前一控制点(端点处复制)
   * @param p1 段起点
   * @param p2 段终点
   * @param p3 后一控制点(端点处复制)
   * @param t  段内归一化进度 [0,1]
   * @param out 输出向量
   */
  private catmullRom(
    p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3,
    t: number, out: Vector3,
  ): void {
    if (this.parametrization === 'uniform') {
      // 经典 uniform Catmull-Rom:0.5 * [(2P1) + (-P0+P2)t + (2P0-5P1+4P2-P3)t² + (-P0+3P1-3P2+P3)t³]
      const t2 = t * t;
      const t3 = t2 * t;
      _p0.copy(p0); _p1.copy(p1); _p2.copy(p2); _p3.copy(p3);
      out.set(
        0.5 * (
          2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        ),
        0.5 * (
          2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        ),
        0.5 * (
          2 * p1.z +
          (-p0.z + p2.z) * t +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
          (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
        ),
      );
      return;
    }

    // centripetal (alpha = 0.5):用累积弦长的平方根作为节点参数
    const d1 = Math.sqrt(p0.distanceToSquared(p1)) || 1e-6;
    const d2 = Math.sqrt(p1.distanceToSquared(p2)) || 1e-6;
    const d3 = Math.sqrt(p2.distanceToSquared(p3)) || 1e-6;
    // 节点参数(以 sqrt 弦长为间距)
    const t0 = 0;
    const t1 = t0 + Math.sqrt(d1);
    const t2 = t1 + Math.sqrt(d2);
    const t3 = t2 + Math.sqrt(d3);
    // 段内归一化时间映射到 [t1, t2]
    const tt = t1 + (t2 - t1) * t;

    // 标准 CR 在任意节点参数下的三次基函数(Barry-Goldman 算法)
    // 用向量分解避免重复计算
    const a1x = (t1 - tt) / (t1 - t0) * p0.x + (tt - t0) / (t1 - t0) * p1.x;
    const a1y = (t1 - tt) / (t1 - t0) * p0.y + (tt - t0) / (t1 - t0) * p1.y;
    const a1z = (t1 - tt) / (t1 - t0) * p0.z + (tt - t0) / (t1 - t0) * p1.z;
    const a2x = (t2 - tt) / (t2 - t1) * p1.x + (tt - t1) / (t2 - t1) * p2.x;
    const a2y = (t2 - tt) / (t2 - t1) * p1.y + (tt - t1) / (t2 - t1) * p2.y;
    const a2z = (t2 - tt) / (t2 - t1) * p1.z + (tt - t1) / (t2 - t1) * p2.z;
    const a3x = (t3 - tt) / (t3 - t2) * p2.x + (tt - t2) / (t3 - t2) * p3.x;
    const a3y = (t3 - tt) / (t3 - t2) * p2.y + (tt - t2) / (t3 - t2) * p3.y;
    const a3z = (t3 - tt) / (t3 - t2) * p2.z + (tt - t2) / (t3 - t2) * p3.z;

    const b1x = (t2 - tt) / (t2 - t0) * a1x + (tt - t0) / (t2 - t0) * a2x;
    const b1y = (t2 - tt) / (t2 - t0) * a1y + (tt - t0) / (t2 - t0) * a2y;
    const b1z = (t2 - tt) / (t2 - t0) * a1z + (tt - t0) / (t2 - t0) * a2z;
    const b2x = (t3 - tt) / (t3 - t1) * a2x + (tt - t1) / (t3 - t1) * a3x;
    const b2y = (t3 - tt) / (t3 - t1) * a2y + (tt - t1) / (t3 - t1) * a3y;
    const b2z = (t3 - tt) / (t3 - t1) * a2z + (tt - t1) / (t3 - t1) * a3z;

    out.set(
      (t2 - tt) / (t2 - t1) * b1x + (tt - t1) / (t2 - t1) * b2x,
      (t2 - tt) / (t2 - t1) * b1y + (tt - t1) / (t2 - t1) * b2y,
      (t2 - tt) / (t2 - t1) * b1z + (tt - t1) / (t2 - t1) * b2z,
    );
  }
}
