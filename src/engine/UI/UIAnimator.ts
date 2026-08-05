// UIAnimator —— UI 动画系统 (Tween / 缓动 / 序列 / 并行)。
//
// 仿照 o3de LyShine `UiAnimNode` / `SimpleMotion`、UE5 UMG `UWidgetAnimation`
// + `UMG::MovieScene`、Unity DOTween / `UIAnimation`。提供轻量级 tween 引擎:
//   * 对 UIElement 的属性 (position / scale / rotation / opacity / color)
//     做缓动动画。
//   * 支持序列 (Sequence) 与并行 (Parallel) 组合。
//   * 内置缓动函数 (Linear / EaseIn / EaseOut / EaseInOut / Back / Elastic / Bounce)。
//   * 支持循环 (Loop / PingPong) 与完成回调。
//
// 纯 CPU 逻辑,每帧 update(dt) 推进。与 UICanvas.update 并行调用。

import type { UIElement } from './UIElement';
import type { UIColor } from './UIPrimitives';
import { UIImage } from './UIPrimitives';

/** 缓动函数类型。 */
export type EaseFunction = (t: number) => number;

/** 内置缓动函数。 */
export const Easing: Record<string, EaseFunction> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => --t * t * t + 1,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeInBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInOutBack: (t) => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  easeOutElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/** 循环模式。 */
export type LoopMode = 'once' | 'loop' | 'pingPong';

/** Tween 目标属性。 */
export type TweenTarget =
  | { type: 'position'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'scale'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'rotation'; from: number; to: number }
  | { type: 'opacity'; from: number; to: number }
  | { type: 'color'; target: UIImage; from: UIColor; to: UIColor };

/**
 * Tween —— 单个属性动画。
 */
export class UITween {
  target: UIElement;
  prop: TweenTarget;
  duration: number;
  ease: EaseFunction;
  loop: LoopMode;
  delay: number;

  private elapsed: number = 0;
  private delayed: number = 0;
  private direction: 1 | -1 = 1; // pingPong 方向。
  private done: boolean = false;
  onComplete?: () => void;

  constructor(opts: {
    target: UIElement;
    prop: TweenTarget;
    duration: number;
    ease?: EaseFunction;
    loop?: LoopMode;
    delay?: number;
    onComplete?: () => void;
  }) {
    this.target = opts.target;
    this.prop = opts.prop;
    this.duration = Math.max(0.001, opts.duration);
    this.ease = opts.ease ?? Easing.easeOutQuad;
    this.loop = opts.loop ?? 'once';
    this.delay = opts.delay ?? 0;
    this.onComplete = opts.onComplete;
  }

  /** 是否完成。 */
  get isDone(): boolean {
    return this.done;
  }

  /** 每帧推进。返回是否完成。 */
  update(dt: number): boolean {
    if (this.done) return true;

    // 延迟。
    if (this.delayed < this.delay) {
      this.delayed += dt;
      if (this.delayed < this.delay) return false;
      dt = this.delayed - this.delay;
    }

    this.elapsed += dt * this.direction;
    let t = this.elapsed / this.duration;

    if (this.direction === 1 && t >= 1) {
      if (this.loop === 'loop') {
        this.elapsed = 0;
        t = 0;
      } else if (this.loop === 'pingPong') {
        this.direction = -1;
        this.elapsed = this.duration - (this.elapsed - this.duration);
        t = this.elapsed / this.duration;
      } else {
        this.apply(1);
        this.done = true;
        this.onComplete?.();
        return true;
      }
    } else if (this.direction === -1 && t <= 0) {
      this.direction = 1;
      this.elapsed = -this.elapsed;
      t = this.elapsed / this.duration;
    }

    this.apply(this.ease(Math.max(0, Math.min(1, t))));
    return false;
  }

  /** 应用插值到目标。 */
  private apply(t: number): void {
    const p = this.prop;
    switch (p.type) {
      case 'position': {
        const x = p.from.x + (p.to.x - p.from.x) * t;
        const y = p.from.y + (p.to.y - p.from.y) * t;
        // 通过 offsets 移动中心 (保持尺寸)。
        const sd = this.target.transform.sizeDelta;
        this.target.transform.offsets = {
          left: x - sd.x * 0.5,
          bottom: y - sd.y * 0.5,
          right: x + sd.x * 0.5,
          top: y + sd.y * 0.5,
        };
        break;
      }
      case 'scale': {
        this.target.transform.scale = {
          x: p.from.x + (p.to.x - p.from.x) * t,
          y: p.from.y + (p.to.y - p.from.y) * t,
        };
        break;
      }
      case 'rotation': {
        this.target.transform.rotation = p.from + (p.to - p.from) * t;
        break;
      }
      case 'opacity': {
        const op = p.from + (p.to - p.from) * t;
        this.setOpacity(this.target, op);
        break;
      }
      case 'color': {
        p.target.color = {
          r: p.from.r + (p.to.r - p.from.r) * t,
          g: p.from.g + (p.to.g - p.from.g) * t,
          b: p.from.b + (p.to.b - p.from.b) * t,
          a: p.from.a + (p.to.a - p.from.a) * t,
        };
        break;
      }
    }
  }

  /** 递归设置透明度。 */
  private setOpacity(el: UIElement, opacity: number): void {
    const img = el as UIElement & { color?: UIColor };
    if (img.color) {
      img.color = { ...img.color, a: opacity };
    }
    for (const child of el.children) this.setOpacity(child, opacity);
  }

  /** 取消。 */
  cancel(): void {
    this.done = true;
  }
}

/**
 * UIAnimator —— 动画管理器。
 *
 * ```ts
 * const animator = new UIAnimator();
 * animator.tween(button, { type: 'scale', from: {x:1,y:1}, to: {x:1.2,y:1.2} }, 0.2);
 * animator.fadeIn(panel, 0.3);
 *
 * // 每帧:
 * animator.update(dt);
 * ```
 */
export class UIAnimator {
  private tweens: UITween[] = [];

  /** 添加 tween。 */
  add(tween: UITween): UITween {
    this.tweens.push(tween);
    return tween;
  }

  /** 创建并添加 tween。 */
  tween(
    target: UIElement,
    prop: TweenTarget,
    duration: number,
    opts?: { ease?: EaseFunction; loop?: LoopMode; delay?: number; onComplete?: () => void },
  ): UITween {
    return this.add(new UITween({ target, prop, duration, ...opts }));
  }

  /** 淡入 (透明度 0→1)。 */
  fadeIn(target: UIElement, duration: number, onComplete?: () => void): UITween {
    return this.tween(target, { type: 'opacity', from: 0, to: 1 }, duration, { onComplete });
  }

  /** 淡出 (透明度 1→0)。 */
  fadeOut(target: UIElement, duration: number, onComplete?: () => void): UITween {
    return this.tween(target, { type: 'opacity', from: 1, to: 0 }, duration, { onComplete });
  }

  /** 缩放弹出 (0→1,带 back 回弹)。 */
  popIn(target: UIElement, duration: number = 0.3, onComplete?: () => void): UITween {
    return this.tween(
      target,
      { type: 'scale', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
      duration,
      { ease: Easing.easeOutBack, onComplete },
    );
  }

  /** 缩放收回 (1→0)。 */
  popOut(target: UIElement, duration: number = 0.2, onComplete?: () => void): UITween {
    return this.tween(
      target,
      { type: 'scale', from: { x: 1, y: 1 }, to: { x: 0, y: 0 } },
      duration,
      { ease: Easing.easeInBack, onComplete },
    );
  }

  /** 滑入 (从指定方向滑入)。 */
  slideIn(
    target: UIElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
    duration: number = 0.3,
    ease: EaseFunction = Easing.easeOutCubic,
  ): UITween {
    return this.tween(target, { type: 'position', from, to }, duration, { ease });
  }

  /** 颜色渐变。 */
  colorTo(image: UIImage, to: UIColor, duration: number): UITween {
    return this.tween(image, { type: 'color', target: image, from: { ...image.color }, to }, duration);
  }

  /** 每帧推进所有 tween,移除已完成的。 */
  update(dt: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if (this.tweens[i].update(dt)) {
        this.tweens.splice(i, 1);
      }
    }
  }

  /** 取消目标元素的所有 tween。 */
  cancelAll(target: UIElement): void {
    for (const t of this.tweens) {
      if (t.target === target) t.cancel();
    }
    this.tweens = this.tweens.filter((t) => !t.isDone);
  }

  /** 活跃 tween 数量。 */
  get count(): number {
    return this.tweens.length;
  }

  /** 是否有活跃 tween。 */
  get isAnimating(): boolean {
    return this.tweens.length > 0;
  }
}

/**
 * UISequence —— 序列播放 (一个完成后播下一个)。
 * 仿 UE5 UMG Widget Animation sequence / DOTween Sequence。
 */
export class UISequence {
  private tweens: UITween[] = [];
  private currentIndex: number = 0;
  private started: boolean = false;
  onComplete?: () => void;

  append(tween: UITween): this {
    this.tweens.push(tween);
    return this;
  }

  update(dt: number): boolean {
    if (this.tweens.length === 0) return true;
    if (!this.started) {
      this.started = true;
      this.currentIndex = 0;
    }
    if (this.currentIndex >= this.tweens.length) {
      this.onComplete?.();
      return true;
    }
    if (this.tweens[this.currentIndex].update(dt)) {
      this.currentIndex++;
    }
    return false;
  }

  get isDone(): boolean {
    return this.started && this.currentIndex >= this.tweens.length;
  }
}
