// InputBuffer + Cooldown — 游戏感 (game feel) 核心系统。
//
// 设计来源:
//   * UE Motion Warping / Anim Montage Buffering —— 蒙太奇输入缓冲
//   * Unity Input System Interaction Settings —— 交互缓冲
//   * o3de AzFramework InputSystemEventSerializers —— 输入事件序列化
//   * GDC 2016 "Game Feel in Smash Bros" —— 输入缓冲窗口设计
//
// 问题:
//   玩家在「攻击动画的第 3 帧」按了跳跃键,但跳跃只能在动画结束后触发。
//   没有缓冲:输入丢失,玩家感觉「按了没反应」。
//   有缓冲:输入被存储 150ms,动画结束后立即检查缓冲 → 跳跃执行。
//
// InputBuffer 与 Cooldown 的关系:
//   * InputBuffer 解决「按早了」:输入被记住,稍后执行。
//   * Cooldown 解决「按快了」:同一动作在冷却时间内不能重复触发。
//   * 二者组合 = 标准游戏感管线:push → 检查 cooldown → 消费 buffer。
//
// 用法:
//   const buffer = new InputBuffer();
//   buffer.bufferWindow = 0.15; // 150ms
//
//   const cooldown = new Cooldown();
//   cooldown.set('jump', 0.3); // 跳跃 300ms 冷却
//
//   // 每帧:
//   inputManager.update();
//   inputMap.update(inputManager);
//   if (inputMap.getAction('jump').isPressed()) {
//     buffer.push('jump', currentTime);
//   }
//   buffer.update(currentTime);
//
//   // 在可以跳跃的状态(如地面):
//   if (isGrounded && buffer.has('jump', currentTime) && cooldown.canTrigger('jump', currentTime)) {
//     player.jump();
//     buffer.consume('jump', currentTime);
//     cooldown.trigger('jump', currentTime);
//   }

// ── InputBuffer ──────────────────────────────────────────────────

/** 缓冲中的输入条目。 */
export interface BufferedInput {
  /** 动作名 (与 InputMap 中的 key 对应,如 'jump' / 'dash' / 'attack')。 */
  action: string;
  /** 按下时的时间戳 (秒)。 */
  timestamp: number;
  /** 优先级 (数字越大越优先,默认 0)。用于 consumeHighestPriority。 */
  priority: number;
  /** 是否已被消费。已消费的条目不再被 has() / consume() 匹配。 */
  consumed: boolean;
}

/** 序列化结构。 */
export interface InputBufferJSON {
  bufferWindow: number;
  maxEntries: number;
  entries: BufferedInput[];
}

/** 调试统计。 */
export interface InputBufferStats {
  /** 当前缓冲区中的条目数 (含已消费未清理的)。 */
  totalEntries: number;
  /** 未消费的有效条目数。 */
  activeEntries: number;
  /** 累计 push 次数。 */
  totalPushed: number;
  /** 累计 consume 次数。 */
  totalConsumed: number;
  /** 累计过期清理次数。 */
  totalExpired: number;
}

/**
 * 输入缓冲区 —— 存储玩家输入一段窗口期,让「按早了」的输入不丢失。
 *
 * 核心概念:
 *   - bufferWindow: 输入在缓冲区中保持有效的时长 (秒,默认 0.15 = 150ms)
 *   - push: 记录一个输入 (通常在 action.isPressed() 时调用)
 *   - has: 检查缓冲区中是否有指定动作的未消费输入
 *   - consume: 消费指定动作 (标记为已用,返回 true 表示成功)
 *   - update: 清理过期和已消费的条目 (每帧调用)
 *
 * 设计:
 *   - 时间戳由调用方传入 (秒),支持暂停 / 慢动作 / 确定性测试
 *   - 同一动作多次 push 只保留最新 (刷新时间戳,不创建副本)
 *   - 已消费的条目在下次 update() 时被清除
 *   - maxEntries 防止无界增长 (超出时丢弃最旧条目)
 *   - consumeHighestPriority: 按优先级消费,适合「输入队列」模式
 */
export class InputBuffer {
  /** 缓冲窗口 (秒)。超过此时间的条目在 update() 时被清除。默认 0.15。 */
  bufferWindow: number = 0.15;
  /** 最大条目数。超出时丢弃最旧条目。默认 16。 */
  maxEntries: number = 16;

  private entries: BufferedInput[] = [];

  // 统计计数器
  private _totalPushed = 0;
  private _totalConsumed = 0;
  private _totalExpired = 0;

  /**
   * 推入一个输入。
   *  action: 动作名
   *  timestamp: 当前时间 (秒)
   *  priority: 优先级 (默认 0)
   *
   * 如果同一动作已在缓冲区中,刷新其时间戳和优先级 (不创建副本)。
   */
  push(action: string, timestamp: number, priority: number = 0): this {
    // 查找已有条目
    const existing = this.entries.find(
      (e) => e.action === action && !e.consumed,
    );

    if (existing) {
      // 刷新时间戳和优先级
      existing.timestamp = timestamp;
      existing.priority = priority;
    } else {
      // 添加新条目
      this.entries.push({
        action,
        timestamp,
        priority,
        consumed: false,
      });

      // 超出容量时丢弃最旧条目
      if (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }
    }

    this._totalPushed++;
    return this;
  }

  /**
   * 检查缓冲区中是否有指定动作的未消费、未过期输入。
   *  action: 动作名
   *  currentTime: 当前时间 (秒)
   */
  has(action: string, currentTime: number): boolean {
    return this.findIndex(action, currentTime) !== -1;
  }

  /**
   * 消费指定动作 (标记为已用)。
   *  action: 动作名
   *  currentTime: 当前时间 (秒)
   *  返回: true 表示找到并消费了匹配的输入
   *
   * 消费后条目不会立即移除,而是在下次 update() 时被清除。
   */
  consume(action: string, currentTime: number): boolean {
    const idx = this.findIndex(action, currentTime);
    if (idx === -1) return false;

    this.entries[idx].consumed = true;
    this._totalConsumed++;
    return true;
  }

  /**
   * 查看指定动作的缓冲条目 (不消费)。
   *  action: 动作名
   *  currentTime: 当前时间 (秒)
   *  返回: 匹配的条目副本,或 null
   *
   * 返回的是条目的浅拷贝,修改它不影响内部状态。
   */
  peek(action: string, currentTime: number): BufferedInput | null {
    const idx = this.findIndex(action, currentTime);
    if (idx === -1) return null;
    return { ...this.entries[idx] };
  }

  /**
   * 消费缓冲区中优先级最高的未消费、未过期输入。
   *  currentTime: 当前时间 (秒)
   *  返回: 被消费的动作名,或 null (缓冲区为空)
   *
   * 优先级相同时,时间戳更新(更近期)的条目优先。
   * 适合「输入队列」模式:每帧只执行一个动作,按优先级选择。
   */
  consumeHighestPriority(currentTime: number): string | null {
    let bestIdx = -1;
    let bestPriority = -Infinity;
    let bestTimestamp = -Infinity;

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.consumed) continue;
      // 检查过期
      if (currentTime - e.timestamp > this.bufferWindow) continue;

      // 优先级更高,或优先级相同但更近期
      if (
        e.priority > bestPriority ||
        (e.priority === bestPriority && e.timestamp > bestTimestamp)
      ) {
        bestIdx = i;
        bestPriority = e.priority;
        bestTimestamp = e.timestamp;
      }
    }

    if (bestIdx === -1) return null;

    const action = this.entries[bestIdx].action;
    this.entries[bestIdx].consumed = true;
    this._totalConsumed++;
    return action;
  }

  /**
   * 清理过期和已消费的条目。每帧调用。
   *  currentTime: 当前时间 (秒)
   */
  update(currentTime: number): this {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) =>
        !e.consumed && currentTime - e.timestamp <= this.bufferWindow,
    );
    this._totalExpired += before - this.entries.length;
    return this;
  }

  /** 立即清空所有条目 (用于传送 / 重生 / 场景切换)。 */
  clear(): this {
    this.entries.length = 0;
    return this;
  }

  /** 获取条目列表 (只读,用于调试 / UI 显示)。 */
  getEntries(): readonly BufferedInput[] {
    return this.entries;
  }

  /** 获取调试统计。 */
  getStats(): InputBufferStats {
    let active = 0;
    for (const e of this.entries) {
      if (!e.consumed) active++;
    }
    return {
      totalEntries: this.entries.length,
      activeEntries: active,
      totalPushed: this._totalPushed,
      totalConsumed: this._totalConsumed,
      totalExpired: this._totalExpired,
    };
  }

  /** 导出为 JSON (用于存档 / 回放)。 */
  exportJSON(): InputBufferJSON {
    return {
      bufferWindow: this.bufferWindow,
      maxEntries: this.maxEntries,
      entries: this.entries.map((e) => ({ ...e })),
    };
  }

  /** 从 JSON 导入 (用于读档 / 回放)。不重置统计计数器。 */
  importJSON(data: InputBufferJSON): this {
    this.bufferWindow = data.bufferWindow;
    this.maxEntries = data.maxEntries;
    this.entries = data.entries.map((e) => ({ ...e }));
    return this;
  }

  /** 重置统计计数器 (不清空缓冲区)。 */
  resetStats(): this {
    this._totalPushed = 0;
    this._totalConsumed = 0;
    this._totalExpired = 0;
    return this;
  }

  // ── 内部实现 ────────────────────────────────────────────────────

  /** 查找指定动作的未消费、未过期的条目索引。 */
  private findIndex(action: string, currentTime: number): number {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.action !== action) continue;
      if (e.consumed) continue;
      if (currentTime - e.timestamp > this.bufferWindow) continue;
      return i;
    }
    return -1;
  }
}

// ── Cooldown ─────────────────────────────────────────────────────

/** 冷却配置。 */
export interface CooldownEntry {
  /** 冷却时长 (秒)。 */
  duration: number;
  /** 上次触发时间 (秒)。 */
  lastTrigger: number;
}

/** Cooldown 序列化结构。 */
export interface CooldownJSON {
  entries: Record<string, CooldownEntry>;
}

/**
 * 动作冷却管理器 —— 防止同一动作在短时间内重复触发。
 *
 * 与 InputBuffer 的区别:
 *   - InputBuffer: 「按早了」→ 记住输入,稍后执行
 *   - Cooldown:    「按快了」→ 冷却期内拒绝触发
 *
 * 典型用法:
 *   const cooldown = new Cooldown();
 *   cooldown.set('jump', 0.3);  // 跳跃 300ms 冷却
 *   cooldown.set('dash', 1.5);  // 冲刺 1.5s 冷却
 *
 *   if (cooldown.canTrigger('jump', currentTime)) {
 *     player.jump();
 *     cooldown.trigger('jump', currentTime);
 *   }
 *
 *   // UI 显示冷却剩余时间:
 *   const remaining = cooldown.getRemaining('jump', currentTime);
 *   ui.showCooldownBar(remaining / cooldown.getDuration('jump'));
 */
export class Cooldown {
  private entries = new Map<string, CooldownEntry>();

  /**
   * 设置动作的冷却时长。
   *  action: 动作名
   *  duration: 冷却时长 (秒)
   */
  set(action: string, duration: number): this {
    const existing = this.entries.get(action);
    this.entries.set(action, {
      duration,
      lastTrigger: existing?.lastTrigger ?? -Infinity,
    });
    return this;
  }

  /**
   * 检查动作是否可以触发 (冷却已过)。
   *  action: 动作名
   *  currentTime: 当前时间 (秒)
   */
  canTrigger(action: string, currentTime: number): boolean {
    const entry = this.entries.get(action);
    if (!entry) return true; // 未配置冷却 = 无限制
    return currentTime - entry.lastTrigger >= entry.duration;
  }

  /**
   * 标记动作为已触发 (开始冷却)。
   *  action: 动作名
   *  currentTime: 当前时间 (秒)
   *
   * 如果动作未配置冷却,此操作无效 (no-op)。
   */
  trigger(action: string, currentTime: number): this {
    const entry = this.entries.get(action);
    if (!entry) return this;
    entry.lastTrigger = currentTime;
    return this;
  }

  /**
   * 获取冷却剩余时间 (秒)。
   *  返回 0 表示冷却已过或未配置。
   */
  getRemaining(action: string, currentTime: number): number {
    const entry = this.entries.get(action);
    if (!entry) return 0;
    const elapsed = currentTime - entry.lastTrigger;
    return Math.max(0, entry.duration - elapsed);
  }

  /**
   * 获取冷却总时长 (秒)。
   *  返回 0 表示未配置。
   */
  getDuration(action: string): number {
    return this.entries.get(action)?.duration ?? 0;
  }

  /**
   * 获取冷却进度 [0, 1]。
   *  0 = 刚触发, 1 = 冷却完成。
   *  未配置冷却时返回 1。
   */
  getProgress(action: string, currentTime: number): number {
    const entry = this.entries.get(action);
    if (!entry) return 1;
    const elapsed = currentTime - entry.lastTrigger;
    if (elapsed >= entry.duration) return 1;
    return elapsed / entry.duration;
  }

  /** 重置指定动作的冷却 (立即可以再次触发)。 */
  reset(action?: string): this {
    if (action === undefined) {
      this.entries.clear();
    } else {
      const entry = this.entries.get(action);
      if (entry) entry.lastTrigger = -Infinity;
    }
    return this;
  }

  /** 导出为 JSON。 */
  exportJSON(): CooldownJSON {
    const obj: Record<string, CooldownEntry> = {};
    for (const [key, val] of this.entries) {
      obj[key] = { ...val };
    }
    return { entries: obj };
  }

  /** 从 JSON 导入。 */
  importJSON(data: CooldownJSON): this {
    this.entries.clear();
    for (const [key, val] of Object.entries(data.entries)) {
      this.entries.set(key, { ...val });
    }
    return this;
  }
}

// ── 预设 ─────────────────────────────────────────────────────────

/**
 * 便捷工厂:创建常见游戏的冷却配置。
 */
export const CooldownPresets = {
  /** 动作游戏 (跳跃 200ms / 冲刺 1s / 攻击 400ms / 格挡 800ms)。 */
  actionGame(): Cooldown {
    const cd = new Cooldown();
    cd.set('jump', 0.2);
    cd.set('dash', 1.0);
    cd.set('attack', 0.4);
    cd.set('block', 0.8);
    return cd;
  },

  /** FPS (射击 100ms / 换弹 2s / 近战 500ms)。 */
  fps(): Cooldown {
    const cd = new Cooldown();
    cd.set('shoot', 0.1);
    cd.set('reload', 2.0);
    cd.set('melee', 0.5);
    return cd;
  },

  /** RPG (攻击 600ms / 施法 1.5s / 闪避 800ms / 物品 300ms)。 */
  rpg(): Cooldown {
    const cd = new Cooldown();
    cd.set('attack', 0.6);
    cd.set('cast', 1.5);
    cd.set('dodge', 0.8);
    cd.set('item', 0.3);
    return cd;
  },
} as const;

/**
 * 便捷工厂:创建常见游戏的输入缓冲配置。
 */
export const InputBufferPresets = {
  /** 标准动作游戏 (150ms 窗口,16 条目)。 */
  actionGame(): InputBuffer {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.15;
    buf.maxEntries = 16;
    return buf;
  },

  /** 格斗游戏 (200ms 窗口,32 条目 —— 连招需要更长缓冲)。 */
  fighting(): InputBuffer {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.2;
    buf.maxEntries = 32;
    return buf;
  },

  /** 精确平台跳跃 (100ms 窗口 —— 土狼时间 + 输入缓冲)。 */
  precisionPlatformer(): InputBuffer {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.1;
    buf.maxEntries = 8;
    return buf;
  },

  /** 休闲游戏 (250ms 窗口 —— 更宽容的输入时机)。 */
  casual(): InputBuffer {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.25;
    buf.maxEntries = 8;
    return buf;
  },
} as const;
