// EventQueue — 延迟分发的事件队列。
//
// 设计原则：
//   - 收集一帧内产生的事件，统一在帧末（或指定时机）通过 EventBus 分发。
//   - 与 EventBus 解耦：构造时传入 bus 实例，dispatch() 时把队列里的事件
//     逐个 emit 到 bus。
//   - dispatch() 处理全部已排队事件并清空队列（正常帧末调用）。
//   - flush() 立即清空队列但不分发（丢弃待发事件，用于场景切换 / 重置）。
//
// 不变量：
//   - enqueue 不触发分发，只入队。
//   - dispatch 后队列必为空。
//   - flush 后队列必为空且这些事件不会被分发。

import { GameEvent } from './GameEvent';
import type { EventBus } from './EventBus';

export class EventQueue {
  /** 待分发事件队列（FIFO）。 */
  private readonly queue: GameEvent[] = [];
  /** 绑定的事件总线；dispatch 时把事件 emit 到这里。 */
  readonly bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /** 入队一个事件（不分发）。 */
  enqueue(event: GameEvent): void {
    this.queue.push(event);
  }

  /** 把队列中所有事件按 FIFO 顺序通过 bus.emit 分发，然后清空队列。
   *  返回实际分发的事件数。 */
  dispatch(): number {
    const n = this.queue.length;
    if (n === 0) return 0;
    // 迭代中可能又有监听器 enqueue 新事件 —— 只分发本次快照，避免无限循环。
    const snapshot = this.queue.splice(0, n);
    for (const ev of snapshot) {
      this.bus.emit(ev.type, ev);
    }
    return snapshot.length;
  }

  /** 立即清空队列，未分发的事件将被丢弃。返回被丢弃的事件数。 */
  flush(): number {
    const n = this.queue.length;
    this.queue.length = 0;
    return n;
  }

  /** 当前待分发事件数。 */
  size(): number {
    return this.queue.length;
  }

  /** 队列是否为空。 */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** 取队首事件但不移除（peek）。队空返回 undefined。 */
  peek(): GameEvent | undefined {
    return this.queue[0];
  }
}
