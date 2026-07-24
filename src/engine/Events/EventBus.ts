// EventBus — 发布 / 订阅事件总线。
//
// 设计原则：
//   - 经典 Map<string, Set<Function>> 结构；同一事件多监听器按注册顺序触发。
//   - on() 返回 unsubscribe 函数，方便临时订阅；off() 也可用回调引用解绑。
//   - once() 注册一次性监听器，触发后自动移除。
//   - emit() 同步分发；如需延迟分发配合 EventQueue 使用。
//   - 不捕获异常传播：单个监听器抛错会中断后续监听器（调用方应在监听器内 try/catch）。
//
// 不变量：
//   - 同一 (event, callback) 重复 on() 会被 Set 自动去重（不会触发两次）。
//   - off() 不存在的 callback 返回 false，不抛错。
//   - clear() 清空所有事件；clearEvent(event) 只清单个事件。

/** 事件监听器签名：接收任意参数（与 emit(...args) 对应）。 */
export type EventListener = (...args: any[]) => void;

export class EventBus {
  /** 按 event 名分桶的监听器集合。 */
  private readonly listeners: Map<string, Set<EventListener>> = new Map();

  /** 订阅事件。返回 unsubscribe 函数（调用即解除该订阅）。 */
  on(event: string, callback: EventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
    return () => this.off(event, callback);
  }

  /** 解除订阅。返回是否成功移除（false = 未找到）。 */
  off(event: string, callback: EventListener): boolean {
    const set = this.listeners.get(event);
    if (!set) return false;
    const removed = set.delete(callback);
    if (removed && set.size === 0) {
      this.listeners.delete(event);
    }
    return removed;
  }

  /** 订阅一次性事件：触发一次后自动移除。 */
  once(event: string, callback: EventListener): () => void {
    const wrapper: EventListener = (...args: any[]) => {
      // 先解绑，再调用，避免回调内部 emit 同名事件时被重复触发。
      this.off(event, wrapper);
      callback(...args);
    };
    return this.on(event, wrapper);
  }

  /** 同步分发事件。按注册顺序调用监听器；返回实际触发的监听器数量。 */
  emit(event: string, ...args: any[]): number {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return 0;
    // 复制一份遍历，防止回调内 on/off 改动原 Set 导致迭代异常。
    const snapshot = Array.from(set);
    let count = 0;
    for (const fn of snapshot) {
      // 跳过迭代中被 off 掉的监听器。
      if (!set.has(fn)) continue;
      fn(...args);
      count++;
    }
    return count;
  }

  /** 清空所有事件的所有监听器。 */
  clear(): void {
    this.listeners.clear();
  }

  /** 清空单个事件的所有监听器。返回是否命中（false = 该事件本无监听器）。 */
  clearEvent(event: string): boolean {
    return this.listeners.delete(event);
  }

  /** 返回某事件的监听器数量（调试 / 测试用）。 */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** 返回当前已注册的事件名列表（快照）。 */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}
