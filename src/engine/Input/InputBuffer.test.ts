import { describe, it, expect } from 'vitest';
import {
  InputBuffer,
  Cooldown,
  CooldownPresets,
  InputBufferPresets,
} from './InputBuffer';

describe('InputBuffer', () => {
  // ── 构造与默认值 ──────────────────────────────────────────────────

  it('默认构造:bufferWindow=0.15, maxEntries=16', () => {
    const buf = new InputBuffer();
    expect(buf.bufferWindow).toBe(0.15);
    expect(buf.maxEntries).toBe(16);
    expect(buf.getEntries().length).toBe(0);
  });

  // ── push / has ───────────────────────────────────────────────────

  it('push 后 has 返回 true', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    expect(buf.has('jump', 1.0)).toBe(true);
  });

  it('未 push 的 action,has 返回 false', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    expect(buf.has('dash', 1.0)).toBe(false);
  });

  it('同一 action 多次 push 只保留一个条目', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.push('jump', 1.1);
    buf.push('jump', 1.2);
    expect(buf.getEntries().length).toBe(1);
    // 时间戳应为最后一次 push
    expect(buf.getEntries()[0].timestamp).toBe(1.2);
  });

  it('不同 action 各自独立存储', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.push('dash', 1.0);
    buf.push('attack', 1.0);
    expect(buf.getEntries().length).toBe(3);
    expect(buf.has('jump', 1.0)).toBe(true);
    expect(buf.has('dash', 1.0)).toBe(true);
    expect(buf.has('attack', 1.0)).toBe(true);
  });

  // ── 过期 ─────────────────────────────────────────────────────────

  it('超过 bufferWindow 后 has 返回 false', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.15;
    buf.push('jump', 1.0);
    // 150ms 后仍有效
    expect(buf.has('jump', 1.15)).toBe(true);
    // 151ms 后过期
    expect(buf.has('jump', 1.151)).toBe(false);
  });

  it('update 清理过期条目', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.1;
    buf.push('jump', 1.0);
    buf.push('dash', 1.05);
    buf.update(1.2); // jump 过期,dash 过期
    expect(buf.getEntries().length).toBe(0);
  });

  it('update 清理已消费条目', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.consume('jump', 1.0);
    expect(buf.getEntries().length).toBe(1); // 消费后不移除
    buf.update(1.0);
    expect(buf.getEntries().length).toBe(0); // update 后清除
  });

  it('update 保留未过期未消费的条目', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.2;
    buf.push('jump', 1.0);
    buf.push('dash', 1.1);
    buf.update(1.15); // 都未过期
    expect(buf.getEntries().length).toBe(2);
  });

  // ── consume ──────────────────────────────────────────────────────

  it('consume 返回 true 并标记为已消费', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    expect(buf.consume('jump', 1.0)).toBe(true);
    expect(buf.has('jump', 1.0)).toBe(false); // 已消费,不再匹配
  });

  it('consume 未缓冲的 action 返回 false', () => {
    const buf = new InputBuffer();
    expect(buf.consume('jump', 1.0)).toBe(false);
  });

  it('consume 已消费的 action 返回 false', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.consume('jump', 1.0);
    expect(buf.consume('jump', 1.0)).toBe(false);
  });

  it('consume 过期的 action 返回 false', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.1;
    buf.push('jump', 1.0);
    expect(buf.consume('jump', 1.2)).toBe(false);
  });

  // ── peek ────────────────────────────────────────────────────────

  it('peek 返回条目副本,不消费', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0, 5);
    const entry = buf.peek('jump', 1.0);
    expect(entry).not.toBeNull();
    expect(entry!.action).toBe('jump');
    expect(entry!.timestamp).toBe(1.0);
    expect(entry!.priority).toBe(5);
    // peek 后仍可 consume
    expect(buf.consume('jump', 1.0)).toBe(true);
  });

  it('peek 未缓冲的 action 返回 null', () => {
    const buf = new InputBuffer();
    expect(buf.peek('jump', 1.0)).toBeNull();
  });

  it('peek 返回的副本不影响内部状态', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    const entry = buf.peek('jump', 1.0);
    entry!.consumed = true; // 修改副本
    // 内部条目不受影响
    expect(buf.has('jump', 1.0)).toBe(true);
  });

  // ── consumeHighestPriority ──────────────────────────────────────

  it('consumeHighestPriority 返回优先级最高的 action', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0, 1);
    buf.push('dash', 1.0, 5);
    buf.push('attack', 1.0, 3);
    expect(buf.consumeHighestPriority(1.0)).toBe('dash');
  });

  it('优先级相同时返回更近期的 action', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0, 2);
    buf.push('dash', 1.1, 2); // 同优先级但更近期
    expect(buf.consumeHighestPriority(1.2)).toBe('dash');
  });

  it('缓冲区为空时返回 null', () => {
    const buf = new InputBuffer();
    expect(buf.consumeHighestPriority(1.0)).toBeNull();
  });

  it('所有条目已消费时返回 null', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.consume('jump', 1.0);
    expect(buf.consumeHighestPriority(1.0)).toBeNull();
  });

  it('所有条目已过期时返回 null', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.1;
    buf.push('jump', 1.0);
    expect(buf.consumeHighestPriority(1.2)).toBeNull();
  });

  it('消费后再次调用返回次高优先级', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0, 1);
    buf.push('dash', 1.0, 5);
    buf.push('attack', 1.0, 3);
    expect(buf.consumeHighestPriority(1.0)).toBe('dash');
    expect(buf.consumeHighestPriority(1.0)).toBe('attack');
    expect(buf.consumeHighestPriority(1.0)).toBe('jump');
    expect(buf.consumeHighestPriority(1.0)).toBeNull();
  });

  // ── maxEntries ──────────────────────────────────────────────────

  it('超过 maxEntries 时丢弃最旧条目', () => {
    const buf = new InputBuffer();
    buf.maxEntries = 3;
    buf.push('a', 1.0);
    buf.push('b', 1.1);
    buf.push('c', 1.2);
    buf.push('d', 1.3); // 超出,a 被丢弃
    expect(buf.getEntries().length).toBe(3);
    expect(buf.has('a', 1.3)).toBe(false);
    expect(buf.has('d', 1.3)).toBe(true);
  });

  // ── clear ───────────────────────────────────────────────────────

  it('clear 清空所有条目', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.push('dash', 1.0);
    buf.clear();
    expect(buf.getEntries().length).toBe(0);
    expect(buf.has('jump', 1.0)).toBe(false);
  });

  // ── 统计 ────────────────────────────────────────────────────────

  it('getStats 返回正确的统计', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.push('dash', 1.0);
    buf.push('jump', 1.1); // 刷新,不计为新 push
    buf.consume('jump', 1.1);

    const stats = buf.getStats();
    expect(stats.totalPushed).toBe(3); // 3 次 push 调用
    expect(stats.totalConsumed).toBe(1);
    expect(stats.totalEntries).toBe(2); // jump(已消费) + dash
    expect(stats.activeEntries).toBe(1); // 仅 dash 未消费
  });

  it('update 累计过期计数', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.1;
    buf.push('jump', 1.0);
    buf.push('dash', 1.0);
    buf.update(1.2); // 2 个过期
    const stats = buf.getStats();
    expect(stats.totalExpired).toBe(2);
  });

  it('resetStats 清零统计但不影响缓冲区', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.resetStats();
    expect(buf.getStats().totalPushed).toBe(0);
    expect(buf.getEntries().length).toBe(1);
  });

  // ── 序列化 ──────────────────────────────────────────────────────

  it('export/import JSON 往返保持状态', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.2;
    buf.maxEntries = 24;
    buf.push('jump', 1.0, 3);
    buf.push('dash', 1.1, 5);
    const json = buf.exportJSON();

    const buf2 = new InputBuffer();
    buf2.importJSON(json);
    expect(buf2.bufferWindow).toBe(0.2);
    expect(buf2.maxEntries).toBe(24);
    expect(buf2.getEntries().length).toBe(2);
    expect(buf2.has('jump', 1.0)).toBe(true);
    expect(buf2.has('dash', 1.1)).toBe(true);
  });

  it('importJSON 不重置统计计数器', () => {
    const buf = new InputBuffer();
    buf.push('jump', 1.0);
    buf.push('dash', 1.0);
    const statsBefore = buf.getStats();
    expect(statsBefore.totalPushed).toBe(2);
    buf.importJSON({ bufferWindow: 0.1, maxEntries: 8, entries: [] });
    const statsAfter = buf.getStats();
    // 统计计数器不受 importJSON 影响
    expect(statsAfter.totalPushed).toBe(2);
  });

  // ── 边界情况 ────────────────────────────────────────────────────

  it('bufferWindow=0 时输入立即过期', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0;
    buf.push('jump', 1.0);
    // 任何时间差 > 0 都过期
    expect(buf.has('jump', 1.001)).toBe(false);
  });

  it('负时间差不导致过期 (timestamp > currentTime)', () => {
    const buf = new InputBuffer();
    buf.bufferWindow = 0.15;
    buf.push('jump', 2.0); // 未来时间戳
    expect(buf.has('jump', 1.0)).toBe(true); // currentTime < timestamp
  });

  // ── 预设 ─────────────────────────────────────────────────────────

  it('actionGame 预设:150ms 窗口,16 条目', () => {
    const buf = InputBufferPresets.actionGame();
    expect(buf.bufferWindow).toBe(0.15);
    expect(buf.maxEntries).toBe(16);
  });

  it('fighting 预设:200ms 窗口,32 条目', () => {
    const buf = InputBufferPresets.fighting();
    expect(buf.bufferWindow).toBe(0.2);
    expect(buf.maxEntries).toBe(32);
  });

  it('precisionPlatformer 预设:100ms 窗口,8 条目', () => {
    const buf = InputBufferPresets.precisionPlatformer();
    expect(buf.bufferWindow).toBe(0.1);
    expect(buf.maxEntries).toBe(8);
  });

  it('casual 预设:250ms 窗口,8 条目', () => {
    const buf = InputBufferPresets.casual();
    expect(buf.bufferWindow).toBe(0.25);
    expect(buf.maxEntries).toBe(8);
  });

  it('所有预设产生的实例可用', () => {
    const presets = [
      InputBufferPresets.actionGame(),
      InputBufferPresets.fighting(),
      InputBufferPresets.precisionPlatformer(),
      InputBufferPresets.casual(),
    ];
    for (const buf of presets) {
      buf.push('jump', 0);
      expect(buf.has('jump', 0)).toBe(true);
      buf.update(1);
      expect(buf.getEntries().length).toBe(0);
    }
  });
});

// ──────────────────────────────────────────────────────────────────

describe('Cooldown', () => {
  // ── set / canTrigger / trigger ──────────────────────────────────

  it('未配置冷却的 action,canTrigger 始终返回 true', () => {
    const cd = new Cooldown();
    expect(cd.canTrigger('jump', 1.0)).toBe(true);
    expect(cd.canTrigger('jump', 100.0)).toBe(true);
  });

  it('配置冷却后,首次 canTrigger 返回 true', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    expect(cd.canTrigger('jump', 1.0)).toBe(true);
  });

  it('trigger 后冷却期内 canTrigger 返回 false', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    cd.trigger('jump', 1.0);
    expect(cd.canTrigger('jump', 1.1)).toBe(false); // 100ms < 300ms
    expect(cd.canTrigger('jump', 1.29)).toBe(false); // 290ms < 300ms
    expect(cd.canTrigger('jump', 1.3)).toBe(true); // 300ms = 冷却完成
    expect(cd.canTrigger('jump', 1.5)).toBe(true); // 超过冷却
  });

  it('trigger 未配置冷却的 action 是 no-op', () => {
    const cd = new Cooldown();
    expect(() => cd.trigger('unknown', 1.0)).not.toThrow();
  });

  it('多次 trigger 刷新 lastTrigger 时间', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    cd.trigger('jump', 1.0);
    cd.trigger('jump', 1.2); // 刷新
    // 从 1.2 开始算 300ms 冷却
    expect(cd.canTrigger('jump', 1.4)).toBe(false);
    expect(cd.canTrigger('jump', 1.5)).toBe(true);
  });

  // ── getRemaining / getDuration / getProgress ────────────────────

  it('getRemaining 返回剩余冷却时间', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    cd.trigger('jump', 1.0);
    expect(cd.getRemaining('jump', 1.0)).toBeCloseTo(0.3, 2);
    expect(cd.getRemaining('jump', 1.1)).toBeCloseTo(0.2, 2);
    expect(cd.getRemaining('jump', 1.3)).toBe(0); // 冷却完成
    expect(cd.getRemaining('jump', 1.5)).toBe(0); // 超过
  });

  it('getRemaining 未配置冷却返回 0', () => {
    const cd = new Cooldown();
    expect(cd.getRemaining('jump', 1.0)).toBe(0);
  });

  it('getDuration 返回配置的冷却时长', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    expect(cd.getDuration('jump')).toBe(0.3);
    expect(cd.getDuration('unknown')).toBe(0);
  });

  it('getProgress 返回 [0, 1] 进度', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    cd.trigger('jump', 1.0);
    expect(cd.getProgress('jump', 1.0)).toBe(0); // 刚触发
    expect(cd.getProgress('jump', 1.15)).toBeCloseTo(0.5, 2); // 一半
    expect(cd.getProgress('jump', 1.3)).toBe(1); // 完成
    expect(cd.getProgress('jump', 1.5)).toBe(1); // 超过
  });

  it('getProgress 未配置冷却返回 1', () => {
    const cd = new Cooldown();
    expect(cd.getProgress('jump', 1.0)).toBe(1);
  });

  // ── reset ───────────────────────────────────────────────────────

  it('reset 指定 action 立即可再次触发', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    cd.trigger('jump', 1.0);
    expect(cd.canTrigger('jump', 1.1)).toBe(false);
    cd.reset('jump');
    expect(cd.canTrigger('jump', 1.1)).toBe(true);
  });

  it('reset 无参数清空所有冷却', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    cd.set('dash', 1.0);
    cd.trigger('jump', 1.0);
    cd.trigger('dash', 1.0);
    cd.reset();
    expect(cd.canTrigger('jump', 1.0)).toBe(true);
    expect(cd.canTrigger('dash', 1.0)).toBe(true);
  });

  // ── 序列化 ──────────────────────────────────────────────────────

  it('export/import JSON 往返保持配置和状态', () => {
    const cd = new Cooldown();
    cd.set('jump', 0.3);
    cd.set('dash', 1.0);
    cd.trigger('jump', 2.5);
    const json = cd.exportJSON();

    const cd2 = new Cooldown();
    cd2.importJSON(json);
    expect(cd2.getDuration('jump')).toBe(0.3);
    expect(cd2.getDuration('dash')).toBe(1.0);
    expect(cd2.canTrigger('jump', 2.6)).toBe(false); // 冷却中
    expect(cd2.canTrigger('dash', 2.6)).toBe(true); // 未触发过
  });

  // ── 预设 ─────────────────────────────────────────────────────────

  it('actionGame 预设包含 jump/dash/attack/block', () => {
    const cd = CooldownPresets.actionGame();
    expect(cd.getDuration('jump')).toBe(0.2);
    expect(cd.getDuration('dash')).toBe(1.0);
    expect(cd.getDuration('attack')).toBe(0.4);
    expect(cd.getDuration('block')).toBe(0.8);
  });

  it('fps 预设包含 shoot/reload/melee', () => {
    const cd = CooldownPresets.fps();
    expect(cd.getDuration('shoot')).toBe(0.1);
    expect(cd.getDuration('reload')).toBe(2.0);
    expect(cd.getDuration('melee')).toBe(0.5);
  });

  it('rpg 预设包含 attack/cast/dodge/item', () => {
    const cd = CooldownPresets.rpg();
    expect(cd.getDuration('attack')).toBe(0.6);
    expect(cd.getDuration('cast')).toBe(1.5);
    expect(cd.getDuration('dodge')).toBe(0.8);
    expect(cd.getDuration('item')).toBe(0.3);
  });

  it('所有预设产生的实例可用', () => {
    const presets = [
      CooldownPresets.actionGame(),
      CooldownPresets.fps(),
      CooldownPresets.rpg(),
    ];
    for (const cd of presets) {
      expect(cd.canTrigger('jump', 0)).toBe(true);
    }
  });
});
