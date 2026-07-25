// SceneTransition — 场景过渡效果。
//
// 设计目标：
//   - 独立于 SceneManager，可单独使用 / 测试；
//   - 有限状态机：Idle → Running → Complete；begin() 启动，update(dt) 推进，
//     isComplete() 判完成；
//   - render(gl) 留作渲染钩子：实际渲染由 Renderer/PostProcess 接管，
//     本类只产出进度 t (0..1) 与配置，不直接调用 WebGL；
//   - 支持类型：Fade / Crossfade / Slide / Wipe / None。
//
// 与 SceneManager 的关系：
//   - SceneManager.switch(name, transition?) 接收一个 SceneTransition 实例；
//   - 切换过程中 SceneManager 每帧调用 transition.update(dt)，期间可读
//     transition.progress / transition.phase 决定渲染策略。

import { Color } from '../Math/Color';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneTransition');

/** 过渡类型。 */
export type TransitionType = 'Fade' | 'Crossfade' | 'Slide' | 'Wipe' | 'None';

/** 过渡阶段。 */
export type TransitionPhase = 'Idle' | 'FadingOut' | 'Swapping' | 'FadingIn' | 'Complete';

/** 过渡方向（仅 Slide/Wipe 有效）。 */
export type TransitionDirection = 'Left' | 'Right' | 'Up' | 'Down';

/** SceneTransition 构造选项。 */
export interface SceneTransitionOptions {
  /** 过渡类型。默认 'Fade'。 */
  type?: TransitionType;
  /** 总时长 (秒)。默认 1.0。 */
  duration?: number;
  /** 淡入淡出颜色 (Fade/Crossfade/Wipe 用)。默认 黑色。 */
  color?: Color | number | string;
  /** 滑动/擦除方向。默认 'Left'。 */
  direction?: TransitionDirection;
}

/**
 * 场景过渡效果 —— 描述一次场景切换的视觉过渡。
 *
 * 时间模型（以 Fade 为例，duration = 1.0s）：
 *   - 0.0 → 0.5s：FadingOut（旧场景被颜色逐渐覆盖，progress 0 → 1）
 *   - 0.5s：Swapping（瞬切，调用方在此瞬间替换 active scene）
 *   - 0.5 → 1.0s：FadingIn（颜色逐渐透明，露出新场景，progress 1 → 0）
 *
 * 对于 None 类型：duration 强制为 0，begin() 后立即 Complete。
 * 对于 Crossfade：FadingOut 与 FadingIn 重叠（无 Swapping 中间点），调用方
 *   需要同时渲染新旧两份场景并按 progress 混合。
 */
export class SceneTransition {
  /** 过渡类型。 */
  readonly type: TransitionType;
  /** 总时长 (秒)。 */
  readonly duration: number;
  /** 过渡颜色。 */
  readonly color: Color;
  /** 滑动/擦除方向。 */
  readonly direction: TransitionDirection;

  /** 当前阶段。 */
  phase: TransitionPhase = 'Idle';
  /** 当前进度 [0,1]；FadingOut 时 0→1，FadingIn 时 1→0，Crossfade 时 0→1。 */
  progress: number = 0;
  /** 自 begin() 起累计的时间 (秒)。 */
  elapsedTime: number = 0;

  constructor(opts: SceneTransitionOptions = {}) {
    this.type = opts.type ?? 'Fade';
    this.duration = this.type === 'None' ? 0 : Math.max(0, opts.duration ?? 1.0);
    this.direction = opts.direction ?? 'Left';
    // color 接受 Color / number / string / undefined。
    const c = opts.color;
    if (c === undefined) {
      this.color = new Color(0x000000);
    } else if (c instanceof Color) {
      this.color = c.clone();
    } else if (typeof c === 'number') {
      this.color = new Color(c);
    } else {
      this.color = new Color(c);
    }
  }

  /** 开始过渡。重置 elapsedTime / progress / phase。 */
  begin(): void {
    this.elapsedTime = 0;
    this.progress = 0;
    if (this.type === 'None' || this.duration <= 0) {
      this.phase = 'Complete';
      this.progress = 1;
      log.debug('begin — None/instant transition, immediately Complete');
      return;
    }
    if (this.type === 'Crossfade') {
      this.phase = 'FadingOut'; // Crossfade 单阶段 0→1
    } else {
      this.phase = 'FadingOut';
    }
    log.debug(
      `begin — type=${this.type}, duration=${this.duration}s, ` +
        `color=#${this.color.getHexString()}, direction=${this.direction}`,
    );
  }

  /**
   * 推进过渡。
   *
   * @param dt 秒
   * @returns 当前阶段；调用方据此决定是否执行场景切换 (Swapping) 或停止 (Complete)。
   */
  update(dt: number): TransitionPhase {
    if (this.phase === 'Idle' || this.phase === 'Complete') return this.phase;
    if (dt <= 0) return this.phase;

    this.elapsedTime += dt;

    if (this.type === 'Crossfade') {
      // 单阶段：0 → 1，全程 FadingOut
      const t = Math.min(1, this.elapsedTime / this.duration);
      this.progress = t;
      if (t >= 1) {
        this.phase = 'Complete';
        log.debug('update — Crossfade Complete');
      }
      return this.phase;
    }

    // Fade / Slide / Wipe：两阶段 (FadingOut 0→1，Swapping 瞬间，FadingIn 1→0)
    const half = this.duration / 2;
    if (this.elapsedTime < half) {
      // FadingOut
      this.phase = 'FadingOut';
      this.progress = this.elapsedTime / half;
      return this.phase;
    }
    if (this.elapsedTime < half + 0.0001) {
      // Swapping 瞬间（仅在 update 跨过中点时触发一次）
      this.phase = 'Swapping';
      this.progress = 1;
      log.debug('update — Swapping (midpoint)');
      // 不立即进入 FadingIn；下一次 update 才进入 FadingIn。
      // 但为了简化调用方逻辑（不希望看到 Swapping 阶段持续多帧），
      // 这里直接推进到 FadingIn，调用方在 update 返回 Swapping 的那一帧
      // 检测到 phase 后立即切换场景即可。
      return this.phase;
    }
    // FadingIn
    const remaining = this.duration - this.elapsedTime;
    if (remaining <= 0) {
      this.progress = 0;
      this.phase = 'Complete';
      log.debug('update — Complete');
      return this.phase;
    }
    this.phase = 'FadingIn';
    this.progress = Math.max(0, remaining / half);
    return this.phase;
  }

  /** 过渡是否完成。 */
  isComplete(): boolean {
    return this.phase === 'Complete';
  }

  /** 重置回 Idle。 */
  reset(): void {
    this.phase = 'Idle';
    this.progress = 0;
    this.elapsedTime = 0;
  }

  /**
   * 渲染过渡效果 —— 钩子方法。
   *
   * 默认实现为 no-op：实际渲染由 Renderer / PostProcess 在主循环中根据
   * transition.phase / progress / color / direction 决定如何混合新旧场景。
   * 这里留出 gl 参数以便未来子类直接绘制全屏 quad（如纯色 Fade）。
   *
   * @param gl WebGL2 上下文
   */
  render(gl: WebGL2RenderingContext): void {
    void gl;
    // 默认 no-op；具体绘制由 Renderer 主循环接管。
  }
}

/**
 * 工厂：构造一个 None 类型过渡（瞬切，无视觉效果）。
 */
export function instantTransition(): SceneTransition {
  return new SceneTransition({ type: 'None' });
}

/**
 * 工厂：构造一个 Fade 过渡。
 */
export function fadeTransition(
  duration: number = 1.0,
  color: Color | number | string = 0x000000,
): SceneTransition {
  return new SceneTransition({ type: 'Fade', duration, color });
}
