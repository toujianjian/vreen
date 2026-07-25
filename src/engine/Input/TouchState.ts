// TouchState — 触摸输入状态。
//
// 跟踪多个同时存在的触摸点,每个 Touch 携带 id / position / delta / phase。
// phase 取值: 'began' | 'moved' | 'ended' | 'cancelled'。
//
// 由 InputManager 在 touchstart / touchmove / touchend / touchcancel 事件中
// 调用 begin() / move() / end() / cancel() 推动状态机。
//
// 帧末 update() 移除 ended / cancelled 触摸,清零仍存活触摸的 delta。

import { Vector2 } from '../Math/Vector2';

/** 触摸阶段。 */
export type TouchPhase = 'began' | 'moved' | 'ended' | 'cancelled';

/** 单个触摸点的状态快照。 */
export interface Touch {
  /** 触摸点 ID (由浏览器分配)。 */
  id: number;
  /** 当前位置 (相对于 attach 的 DOM 元素,px)。 */
  position: Vector2;
  /** 本帧位移。帧末 update() 清零 (仍存活的触摸)。 */
  delta: Vector2;
  /** 当前阶段。 */
  phase: TouchPhase;
}

export class TouchState {
  /** 当前所有活跃 / 刚结束的触摸 (id → Touch)。 */
  readonly touches: Map<number, Touch> = new Map();
  /** 同时跟踪的最大触摸点数。超出时新触摸被忽略。默认 5。 */
  maxTouches: number;

  constructor(maxTouches: number = 5) {
    this.maxTouches = maxTouches;
  }

  /** 由 InputManager 在 touchstart 事件中调用。 */
  begin(id: number, x: number, y: number): void {
    if (this.touches.size >= this.maxTouches && !this.touches.has(id)) return;
    const t: Touch = {
      id,
      position: new Vector2(x, y),
      delta: new Vector2(0, 0),
      phase: 'began',
    };
    this.touches.set(id, t);
  }

  /** 由 InputManager 在 touchmove 事件中调用。 */
  move(id: number, x: number, y: number): void {
    const t = this.touches.get(id);
    if (!t) return;
    const dx = x - t.position.x;
    const dy = y - t.position.y;
    t.position.set(x, y);
    t.delta.x += dx;
    t.delta.y += dy;
    t.phase = 'moved';
  }

  /** 由 InputManager 在 touchend 事件中调用。 */
  end(id: number): void {
    const t = this.touches.get(id);
    if (!t) return;
    t.phase = 'ended';
  }

  /** 由 InputManager 在 touchcancel 事件中调用。 */
  cancel(id: number): void {
    const t = this.touches.get(id);
    if (!t) return;
    t.phase = 'cancelled';
  }

  /** 获取指定 id 的触摸点。 */
  getTouch(id: number): Touch | undefined {
    return this.touches.get(id);
  }

  /** 当前触摸点数量 (含本帧刚 ended / cancelled 的)。 */
  getTouchCount(): number {
    return this.touches.size;
  }

  /** 是否存在任何活跃触摸 (含本帧刚 ended / cancelled 的)。 */
  isTouching(): boolean {
    return this.touches.size > 0;
  }

  /**
   * 双指距离 —— 用于捏合手势。
   *
   * 返回当前前两个活跃触摸点之间的欧氏距离;不足两点时返回 0。
   */
  getMultiTouchDistance(): number {
    const active = this._activeTouches();
    if (active.length < 2) return 0;
    return active[0].position.distanceTo(active[1].position);
  }

  /** 帧末调用 — 移除 ended / cancelled,清零存活触摸的 delta。 */
  update(): void {
    for (const [id, t] of this.touches) {
      if (t.phase === 'ended' || t.phase === 'cancelled') {
        this.touches.delete(id);
      } else {
        t.delta.set(0, 0);
        if (t.phase === 'began') t.phase = 'moved';
      }
    }
  }

  /** 清空所有触摸 (失焦 / 解绑 / 重置时调用)。 */
  reset(): void {
    this.touches.clear();
  }

  /** 返回所有非 ended / cancelled 的触摸点。 */
  private _activeTouches(): Touch[] {
    const out: Touch[] = [];
    for (const t of this.touches.values()) {
      if (t.phase !== 'ended' && t.phase !== 'cancelled') out.push(t);
    }
    return out;
  }
}
