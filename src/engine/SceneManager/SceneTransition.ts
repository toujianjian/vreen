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

// ════════════════════════════════════════════════════════════════════════
// SceneTransitionSystem — 高级场景过渡系统(管理器风格)
// ════════════════════════════════════════════════════════════════════════
//
// 设计目标:
//   - 与上面的 SceneTransition(单次过渡实例)互补:本类是"管理器",一个实例
//     管理多次过渡,持 currentTransition 表示当前进行中的过渡效果;
//   - 支持 6 种过渡类型:fade / slide / zoom / dissolve / wipe / iris;
//   - 内置加载屏(loadingScreen)叠加:过渡期间可显示加载进度,适配异步场景
//     加载(streaming);
//   - 最小显示时间(minDisplayTime):即使目标场景已就绪,过渡至少持续 N 秒,
//     避免闪烁;
//   - 缓动函数集合(easingFunctions):line/easeIn/easeOut/easeInOut/bounceBack;
//   - getRenderData() 输出覆盖层渲染数据(alpha/color/offset 等),供 Renderer
//     绘制全屏过渡覆盖,本类不直接调用 GL;
//   - 与 SceneManager 解耦:SceneManager 仍用基础 SceneTransition 类;调用方
//     可选用本类获得更丰富的过渡效果与加载屏支持。
//
// 时间模型:
//   - progress 单调 0 → 1(progress 经缓动函数塑形为 easedProgress);
//   - progress < 0.5:覆盖层渐入(旧场景被遮挡);progress >= 0.5:覆盖层渐出
//     (新场景露出);0.5 为切换点(swapPoint),调用方在此替换场景;
//   - fade: 覆盖层 alpha = 1 - |2p-1|(中点最不透明);
//   - slide: 覆盖层从方向外滑入,中点全覆盖,再滑出;
//   - zoom: 旧场景缩小淡出,新场景放大淡入;
//   - dissolve: 噪声纹理阈值溶解(alpha = smoothstep 基于 noise + p);
//   - wipe: 覆盖层按方向擦除,暴露新场景;
//   - iris: 圆形光圈从中心扩缩。

/** SceneTransitionSystem 过渡类型(小写,与基础类 TransitionType 区分)。 */
export type SceneTransitionSystemType =
  | 'fade'
  | 'slide'
  | 'zoom'
  | 'dissolve'
  | 'wipe'
  | 'iris';

/** 过渡方向(slide/wipe/iris 用)。 */
export type TransitionSystemDirection = 'left' | 'right' | 'up' | 'down' | 'in' | 'out';

/** 缓动函数名。 */
export type EasingName = 'line' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bounceBack';

/** 缓动函数类型:输入 [0,1] 返回 [0,1]。 */
export type EasingFn = (t: number) => number;

/** 过渡效果描述。 */
export interface TransitionEffect {
  /** 过渡类型。 */
  type: SceneTransitionSystemType;
  /** 总时长(秒)。 */
  duration: number;
  /** 覆盖色(默认黑色;接受 Color / hex 数字 / #hex 字符串)。 */
  color?: Color | number | string;
  /** 方向(slide/wipe/iris 用)。 */
  direction?: TransitionSystemDirection;
  /** 缓动函数名(默认 line)。 */
  easing?: EasingName;
  /** 完成回调。 */
  onComplete?: () => void;
  /** 溶解纹理标识(dissolve 用,调用方解释)。 */
  texture?: string;
}

/** 把 Color / number / string 转为 Color 实例(clone,不持有调用方引用)。 */
function toColor(c: Color | number | string | undefined): Color {
  if (c === undefined) return new Color(0x000000);
  if (c instanceof Color) return c.clone();
  if (typeof c === 'number') return new Color(c);
  return new Color(c);
}

/** 覆盖层渲染数据(供 Renderer 绘制全屏过渡 quad)。 */
export interface TransitionRenderData {
  /** 是否活跃(有过渡进行)。 */
  active: boolean;
  /** 过渡类型。 */
  type: SceneTransitionSystemType;
  /** 原始进度 [0,1]。 */
  progress: number;
  /** 缓动后进度 [0,1]。 */
  easedProgress: number;
  /** 覆盖层不透明度 [0,1](fade: 中点峰值;其他: 类型相关)。 */
  alpha: number;
  /** 覆盖色 [r,g,b] 0..1。 */
  color: [number, number, number];
  /** 滑动/擦除偏移(归一化屏幕坐标,-1..1)。 */
  offset: number;
  /** 方向(供 shader 决定轴向)。 */
  direction: TransitionSystemDirection;
  /** 是否显示加载屏。 */
  loadingScreen: boolean;
  /** 加载进度 [0,1]。 */
  loadingProgress: number;
  /** 溶解纹理标识(dissolve 用)。 */
  texture?: string;
  /** 是否到达切换点(progress >= 0.5)。 */
  shouldSwap: boolean;
}

/** SceneTransitionSystem 统计。 */
export interface SceneTransitionSystemStats {
  /** 是否过渡中。 */
  transitioning: boolean;
  /** 当前过渡类型(null = 无)。 */
  type: SceneTransitionSystemType | null;
  /** 当前进度 [0,1]。 */
  progress: number;
  /** 累计过渡次数。 */
  totalTransitions: number;
  /** 累计完成次数。 */
  completedTransitions: number;
  /** 累计取消次数。 */
  cancelledTransitions: number;
  /** 加载屏是否开启。 */
  loadingScreen: boolean;
  /** 加载进度 [0,1]。 */
  loadingProgress: number;
}

/**
 * 高级场景过渡系统 —— 管理 currentTransition,支持 6 种过渡 + 加载屏 + 缓动。
 *
 * 与基础 SceneTransition 类的关系:
 *   - 基础类是"一次过渡的值对象",SceneManager 内部使用;
 *   - 本类是"过渡管理器",持当前过渡状态,适合需要加载屏 / 多类型切换 /
 *     渲染数据输出的上层场景(如 ViewerPage 的场景切换 UI)。
 */
export class SceneTransitionSystem {
  /** 当前过渡效果(null = 无过渡)。 */
  currentTransition: TransitionEffect | null = null;
  /** 当前过渡进度 [0,1]。 */
  transitionProgress: number = 0;
  /** 当前过渡总时长(秒)。 */
  transitionDuration: number = 0;
  /** 当前过渡类型。 */
  transitionType: SceneTransitionSystemType = 'fade';
  /** 是否正在过渡。 */
  isTransitioning: boolean = false;
  /** 完成回调(过渡自然结束时触发,与 effect.onComplete 同步触发)。 */
  onComplete: (() => void) | null = null;
  /** 是否显示加载屏(叠加在过渡覆盖层上)。 */
  loadingScreen: boolean = false;
  /** 加载进度 [0,1](由外部 setLoadingProgress 更新)。 */
  loadingProgress: number = 0;
  /** 最小显示时间(秒):过渡至少持续这么久,即使进度已到 1。 */
  minDisplayTime: number = 0;

  /** 缓动函数集合。 */
  readonly easingFunctions: Record<EasingName, EasingFn> = {
    line: (t) => t,
    easeIn: (t) => t * t,
    easeOut: (t) => 1 - (1 - t) * (1 - t),
    easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    bounceBack: (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
  };

  /** 累计过渡次数。 */
  private _totalTransitions: number = 0;
  /** 累计完成次数。 */
  private _completedTransitions: number = 0;
  /** 累计取消次数。 */
  private _cancelledTransitions: number = 0;
  /** 当前过渡已用时(秒)。 */
  private _elapsed: number = 0;
  /** 当前过渡的缓动函数名。 */
  private _easing: EasingName = 'line';
  /** 当前过渡方向。 */
  private _direction: TransitionSystemDirection = 'left';
  /** 当前过渡覆盖色。 */
  private _color: Color = new Color(0x000000);
  /** 当前过渡纹理标识(dissolve)。 */
  private _texture: string | undefined = undefined;
  /** 标记完成回调是否已触发(避免重复)。 */
  private _completeFired: boolean = false;

  /**
   * 开始过渡。
   *
   * @param type 过渡类型
   * @param duration 总时长(秒)
   * @param options 额外选项(color/direction/easing/onComplete/texture)
   */
  startTransition(
    type: SceneTransitionSystemType,
    duration: number,
    options: Omit<TransitionEffect, 'type' | 'duration'> = {},
  ): void {
    if (this.isTransitioning) {
      // 正在过渡中又请求新过渡:先完成当前(触发回调)再开始新的
      this._fireComplete();
    }
    this.currentTransition = {
      type,
      duration: Math.max(0, duration),
      color: options.color,
      direction: options.direction,
      easing: options.easing,
      onComplete: options.onComplete,
      texture: options.texture,
    };
    this.transitionType = type;
    this.transitionDuration = Math.max(0, duration);
    this.transitionProgress = 0;
    this.isTransitioning = true;
    // onComplete 字段与 effect.onComplete 是两个独立回调来源:
    //   - effect.onComplete(currentTransition.onComplete)由 options 传入;
    //   - this.onComplete 字段由外部直接设置(sys.onComplete = cb)。
    // 二者都在 _fireComplete 触发,互不重复。新过渡开始时清空字段回调,
    // 避免上一轮遗留的字段回调被误触发(外部需在新过渡后重新设置)。
    this.onComplete = null;
    this._elapsed = 0;
    this._easing = options.easing ?? 'line';
    this._direction = options.direction ?? this._defaultDirection(type);
    this._color = toColor(options.color);
    this._texture = options.texture;
    this._completeFired = false;
    this._totalTransitions++;
    // duration <= 0:立即完成
    if (this.transitionDuration <= 0) {
      this.transitionProgress = 1;
      this._finish();
    }
  }

  /** 类型默认方向。 */
  private _defaultDirection(type: SceneTransitionSystemType): TransitionSystemDirection {
    switch (type) {
      case 'slide': return 'left';
      case 'wipe': return 'left';
      case 'zoom': return 'in';
      case 'iris': return 'in';
      default: return 'left';
    }
  }

  /**
   * 每帧更新 —— 推进过渡进度。
   *
   * @param dt 秒
   */
  update(dt: number): void {
    if (!this.isTransitioning) return;
    if (dt <= 0) return;
    this._elapsed += dt;
    const duration = this.transitionDuration;
    if (duration <= 0) {
      this.transitionProgress = 1;
    } else {
      this.transitionProgress = Math.min(1, this._elapsed / duration);
    }
    // 最小显示时间:即使进度到 1,若 _elapsed < minDisplayTime 不结束
    if (this.transitionProgress >= 1 && this._elapsed >= this.minDisplayTime) {
      this._finish();
    }
  }

  /** 内部:结束过渡(触发回调,清理状态)。 */
  private _finish(): void {
    this.isTransitioning = false;
    this._fireComplete();
    this.currentTransition = null;
  }

  /** 触发完成回调(仅一次)。 */
  private _fireComplete(): void {
    if (this._completeFired) return;
    this._completeFired = true;
    this._completedTransitions++;
    try {
      this.currentTransition?.onComplete?.();
    } catch (err) {
      // 回调异常不影响状态机
      void err;
    }
    try {
      this.onComplete?.();
    } catch (err) {
      void err;
    }
  }

  /** 是否正在过渡。 */
  isInTransition(): boolean {
    return this.isTransitioning;
  }

  /** 获取当前进度 [0,1](原始,未经缓动)。 */
  getProgress(): number {
    return this.transitionProgress;
  }

  /** 获取缓动后进度 [0,1]。 */
  getEasedProgress(): number {
    return this.easingFunctions[this._easing](this.transitionProgress);
  }

  /** 获取当前过渡类型。 */
  getTransitionType(): SceneTransitionSystemType | null {
    return this.isTransitioning ? this.transitionType : null;
  }

  /**
   * 设置过渡时长 —— 仅影响尚未开始或进行中的过渡的剩余节奏。
   * 进行中过渡:按已用比例重算 duration,_elapsed 不变。
   */
  setDuration(duration: number): void {
    const d = Math.max(0, duration);
    this.transitionDuration = d;
    if (this.currentTransition) {
      this.currentTransition.duration = d;
    }
  }

  /** 开启/关闭加载屏。 */
  setLoadingScreen(enabled: boolean): void {
    this.loadingScreen = enabled;
  }

  /** 设置加载进度 [0,1](自动夹到 0..1)。 */
  setLoadingProgress(progress: number): void {
    this.loadingProgress = Math.max(0, Math.min(1, progress));
  }

  /** 设置最小显示时间(秒)。 */
  setMinDisplayTime(time: number): void {
    this.minDisplayTime = Math.max(0, time);
  }

  // ── 便捷工厂方法 ───────────────────────────────────────────────────

  /** 淡入淡出过渡。 */
  fade(duration: number, color: Color | number | string = 0x000000, direction?: TransitionSystemDirection): void {
    this.startTransition('fade', duration, { color, direction });
  }

  /** 滑动过渡。 */
  slide(duration: number, direction: TransitionSystemDirection): void {
    this.startTransition('slide', duration, { direction });
  }

  /** 缩放过渡(direction: in=新场景放大进入, out=旧场景缩小退出)。 */
  zoom(duration: number, direction: TransitionSystemDirection): void {
    this.startTransition('zoom', duration, { direction });
  }

  /** 溶解过渡(texture 为噪声纹理标识,由调用方解释)。 */
  dissolve(duration: number, texture?: string): void {
    this.startTransition('dissolve', duration, { texture });
  }

  /** 擦除过渡。 */
  wipe(duration: number, direction: TransitionSystemDirection): void {
    this.startTransition('wipe', duration, { direction });
  }

  /** 光圈过渡(direction: in=光圈缩小露出新场景, out=光圈扩大遮盖)。 */
  iris(duration: number, direction: TransitionSystemDirection): void {
    this.startTransition('iris', duration, { direction });
  }

  /** 提前完成过渡(触发回调)。 */
  complete(): void {
    if (!this.isTransitioning) return;
    this.transitionProgress = 1;
    this._finish();
  }

  /** 取消过渡(不触发回调,直接归零)。 */
  cancel(): void {
    if (!this.isTransitioning) return;
    this.isTransitioning = false;
    this.currentTransition = null;
    this.transitionProgress = 0;
    this._completeFired = true; // 抑制回调
    this._cancelledTransitions++;
  }

  /**
   * 获取覆盖层渲染数据(供 Renderer 绘制全屏过渡 quad)。
   * 无过渡时返回 active=false 的占位数据。
   */
  getRenderData(): TransitionRenderData {
    const p = this.transitionProgress;
    const eased = this.getEasedProgress();
    const type = this.transitionType;
    const dir = this._direction;

    // alpha 计算(覆盖层不透明度)
    let alpha = 0;
    // offset 计算(slide/wipe 的屏幕偏移)
    let offset = 0;

    switch (type) {
      case 'fade':
        // 中点最不透明:alpha = 1 - |2p-1|
        alpha = 1 - Math.abs(2 * p - 1);
        break;
      case 'slide': {
        // 覆盖层从屏幕外滑入,中点全覆盖,再滑出
        // offset: -1(屏外左)→ 0(全覆盖)→ +1(屏外右)
        // 方向决定符号
        const sign = (dir === 'left' || dir === 'up') ? -1 : 1;
        offset = sign * (p < 0.5 ? -1 + 2 * p : 1 - 2 * (p - 0.5) * 2);
        // 修正:简化为覆盖层位置
        offset = sign * (1 - 2 * p); // 0..0.5: 1→0; 0.5..1: 0→-1
        alpha = 1; // 覆盖层本身不透明
        break;
      }
      case 'zoom':
        // 缩放:前半旧场景缩小(alpha 渐增),后半新场景放大(alpha 渐减)
        alpha = 1 - Math.abs(2 * p - 1);
        offset = (dir === 'in') ? (1 - p) : p; // scale 因子提示
        break;
      case 'dissolve':
        // 溶解:alpha 基于 noise 阈值,这里用 eased 进度近似
        alpha = eased;
        break;
      case 'wipe': {
        // 擦除:覆盖层按方向退去,暴露新场景
        // offset 表示擦除边界位置 0..1
        const sign = (dir === 'left' || dir === 'up') ? 1 : -1;
        offset = sign * p;
        alpha = 1;
        break;
      }
      case 'iris':
        // 光圈:前半光圈扩大遮盖(alpha 渐增),后半光圈缩小露出(alpha 渐减)
        alpha = 1 - Math.abs(2 * p - 1);
        offset = (dir === 'in') ? p : (1 - p); // 半径因子
        break;
    }

    return {
      active: this.isTransitioning,
      type,
      progress: p,
      easedProgress: eased,
      alpha: Math.max(0, Math.min(1, alpha)),
      color: [this._color.r, this._color.g, this._color.b],
      offset,
      direction: dir,
      loadingScreen: this.loadingScreen,
      loadingProgress: this.loadingProgress,
      texture: this._texture,
      shouldSwap: p >= 0.5,
    };
  }

  /** 获取统计快照。 */
  getStats(): SceneTransitionSystemStats {
    return {
      transitioning: this.isTransitioning,
      type: this.isTransitioning ? this.transitionType : null,
      progress: this.transitionProgress,
      totalTransitions: this._totalTransitions,
      completedTransitions: this._completedTransitions,
      cancelledTransitions: this._cancelledTransitions,
      loadingScreen: this.loadingScreen,
      loadingProgress: this.loadingProgress,
    };
  }
}
