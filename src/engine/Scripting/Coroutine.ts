// Coroutine — 协程系统（基于 ES Generator）。
//
// 设计原则：
//   - 用 generator function 实现协作式协程：yield number = 等待该秒数；
//     yield (void/undefined) = 等待一帧。
//   - start() 返回 CoroutineHandle；stop() 可提前终止；update(dt) 每帧推进。
//   - 协程在 done 后自动从活跃列表移除。
//   - 一帧内每个协程最多推进一次（标准游戏协程语义，避免长 dt 下的雪崩）。
//
// 不变量：
//   - handle.done = true 后 update 不再推进它，且会被清理。
//   - stop(handle) 对已 done 的协程返回 false。
//   - generator 抛错时该协程被标记 done 并记录日志，不中断其他协程。

import { createLogger } from '@/lib/logger';

const log = createLogger('Scripting.Coroutine');

/** 协程 yield 值：number = 等待秒数；void/undefined = 等待一帧。 */
export type CoroutineYield = number | void | undefined;

/** 协程句柄。done 后不再被推进。 */
export interface CoroutineHandle {
  /** 全局唯一 id（调试 / stop 用）。 */
  id: number;
  /** 底层 generator。 */
  generator: Generator<CoroutineYield, void, unknown>;
  /** 是否已完成（generator return 或抛错或被 stop）。 */
  done: boolean;
  /** 距离下次 resume 的剩余秒数（<=0 表示本帧可推进）。 */
  wait: number;
}

export class CoroutineSystem {
  /** 活跃协程列表（done 的会在 update 末尾被清理）。 */
  private coroutines: CoroutineHandle[] = [];
  /** 自增 id 分配器。 */
  private nextId: number = 1;

  /** 启动一个协程。generator 由 `function*(){...}` 创建。
   *  首次 update 前 wait=0，因此 yield 之前的代码会在下一帧 update 时执行。
   *  若希望立即执行首段，可在 start 内调用一次 generator.next() —— 这里选择
   *  统一在 update 推进，保证时序可预测。 */
  start(generator: Generator<CoroutineYield, void, unknown>): CoroutineHandle {
    const handle: CoroutineHandle = {
      id: this.nextId++,
      generator,
      done: false,
      wait: 0,
    };
    this.coroutines.push(handle);
    return handle;
  }

  /** 提前终止协程。返回是否成功（false = 已 done 或不属于本系统）。 */
  stop(handle: CoroutineHandle): boolean {
    if (handle.done) return false;
    const idx = this.coroutines.indexOf(handle);
    if (idx === -1) return false;
    handle.done = true;
    // 尝试关闭 generator（执行 finally 块）
    try {
      handle.generator.return(undefined);
    } catch (e) {
      log.error(`coroutine #${handle.id} throw during stop:`, e);
    }
    this.coroutines.splice(idx, 1);
    return true;
  }

  /** 每帧推进所有活跃协程。
   *  - wait -= dt；wait <= 0 时调用 generator.next()。
   *  - 若 next().done === true，标记 done。
   *  - 否则按 yield 值设置新 wait（number>0 → 该秒数；其他 → 0，下帧再推进）。
   *  - generator 抛错 → 标记 done 并记录。
   *  - 末尾清理所有 done 协程。 */
  update(dt: number): void {
    for (const c of this.coroutines) {
      if (c.done) continue;
      c.wait -= dt;
      if (c.wait > 0) continue;
      // 推进一次
      let result: IteratorResult<CoroutineYield, void>;
      try {
        result = c.generator.next();
      } catch (e) {
        log.error(`coroutine #${c.id} threw:`, e);
        c.done = true;
        continue;
      }
      if (result.done) {
        c.done = true;
        continue;
      }
      const v = result.value;
      c.wait = typeof v === 'number' && v > 0 ? v : 0;
    }
    // 清理已 done 的协程（原地过滤，避免 GC 压力时也可用 splice）。
    if (this.coroutines.some((c) => c.done)) {
      this.coroutines = this.coroutines.filter((c) => !c.done);
    }
  }

  /** 当前活跃协程数（含本帧刚 done 尚未清理的）。 */
  size(): number {
    return this.coroutines.length;
  }

  /** 终止所有协程（调用 generator.return 触发 finally）。 */
  clear(): void {
    for (const c of this.coroutines) {
      if (c.done) continue;
      c.done = true;
      try {
        c.generator.return(undefined);
      } catch (e) {
        log.error(`coroutine #${c.id} threw during clear:`, e);
      }
    }
    this.coroutines.length = 0;
  }
}
